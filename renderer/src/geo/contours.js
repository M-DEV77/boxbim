// PISO POR CURVAS DE NÍVEL: com um DWG/DXF importado selecionado (as camadas das curvas, com a cota de cada uma no
// Z — o "elevation" das polilinhas) ou linhas 2D em cotas diferentes, cria um TERRENO que passa pelas curvas:
//   pontos .... os vértices das curvas (e pontos ao longo dos trechos longos), um por célula de uma grade de
//               "espaçamento" (no máximo ~2500 — a superfície é a triangulação deles)
//   contorno .. a envoltória (convexa) dos pontos, ou o retângulo deles
//   alturas ... em relação à curva mais baixa; o piso fica no nível escolhido, na cota da curva mais baixa
import * as THREE from 'three';
import { h, modal, toast, busy } from '../ui.js';
import { createOnLevel } from '../modeling.js';
import { fmtLen } from '../units.js';

const MAX_POINTS = 2500;
const round6 = v => +v.toFixed(6);

/** Pontos 3D (modelo) das linhas dos elementos selecionados. */
function collect(els) {
  const pts = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  for (const el of els) {
    el.updateMatrixWorld(true);
    el.traverse(o => {
      if (!(o.isLine || o.isLineSegments) || o.userData.isEdge || !o.geometry?.attributes?.position) return;
      const p = o.geometry.attributes.position, step = o.isLineSegments ? 2 : 1;
      for (let i = 0; i + 1 < p.count; i += step) {
        a.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); b.fromBufferAttribute(p, i + 1).applyMatrix4(o.matrixWorld);
        pts.push([a.x, a.y, a.z, b.x, b.y, b.z]);
      }
    });
  }
  return pts; // trechos [ax, ay, az, bx, by, bz]
}

/** Envoltória convexa (cadeia monótona) de [x, y]. */
function hull(P) {
  const s = [...P].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of s) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (const p of s.reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  return [...lo.slice(0, -1), ...up.slice(0, -1)];
}

/** Monta os pontos (um por célula) e o contorno. */
export function contourTerrain(segs, { spacing, shape = 'envoltoria' }) {
  const all = [];
  for (const [ax, ay, az, bx, by, bz] of segs) {
    const L = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(L / spacing));
    for (let k = 0; k < n; k++) { const t = k / n; all.push([ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t]); }
    all.push([bx, by, bz]);
  }
  if (all.length < 3) throw new Error('Selecione as curvas de nível (linhas do DWG/DXF importado).');
  const zs = new Set(all.map(p => Math.round(p[2] * 100)));
  if (zs.size < 2) throw new Error('As linhas estão todas na mesma cota: as curvas do DWG precisam ter a cota (elevação) de cada uma.');
  const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys), x1 = Math.max(...xs), y1 = Math.max(...ys);
  // grade: o espaçamento pedido, aumentado se passar do máximo de pontos
  let cell = spacing;
  while (((x1 - x0) / cell + 1) * ((y1 - y0) / cell + 1) > MAX_POINTS * 4) cell *= 1.25;
  const pick = c => {
    const grid = new Map();
    for (const p of all) {
      const k = `${Math.floor((p[0] - x0) / c)},${Math.floor((p[1] - y0) / c)}`;
      if (!grid.has(k)) grid.set(k, p);
    }
    return [...grid.values()];
  };
  let pts = pick(cell);
  while (pts.length > MAX_POINTS) { cell *= 1.2; pts = pick(cell); }
  const zMin = Math.min(...pts.map(p => p[2]));
  const nearestZ = (x, y) => { let best = Infinity, z = zMin; for (const p of pts) { const d = (p[0] - x) ** 2 + (p[1] - y) ** 2; if (d < best) { best = d; z = p[2]; } } return z; };
  let ring = shape === 'retangulo' ? [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] : hull(pts.map(p => [p[0], p[1]]));
  // lados longos do contorno ganham pontos (a borda acompanha o relevo)
  const dense = [];
  ring.forEach((p, i) => {
    const q = ring[(i + 1) % ring.length], L = Math.hypot(q[0] - p[0], q[1] - p[1]), n = Math.max(1, Math.round(L / (cell * 2)));
    for (let k = 0; k < n; k++) dense.push([p[0] + (q[0] - p[0]) * k / n, p[1] + (q[1] - p[1]) * k / n]);
  });
  ring = dense;
  const onRing = new Set(ring.map(p => `${p[0].toFixed(4)},${p[1].toFixed(4)}`));
  return {
    zMin,
    points: ring.map(p => [round6(p[0]), round6(p[1])]),
    alturas: ring.map(p => round6(nearestZ(p[0], p[1]) - zMin)),
    forma: pts.filter(p => !onRing.has(`${p[0].toFixed(4)},${p[1].toFixed(4)}`)).map(p => [round6(p[0]), round6(p[1]), round6(p[2] - zMin)]),
    size: [x1 - x0, y1 - y0],
    curvas: zs.size,
  };
}

/** Comando: diálogo e criação do terreno pelas curvas selecionadas. */
export function floorFromContours(app) {
  const sel = [...app.viewer.selected];
  const segs = collect(sel);
  if (!segs.length) { toast('Selecione o DWG/DXF importado com as curvas de nível (ou as camadas delas).', 'error'); return; }
  const xs = segs.flatMap(s => [s[0], s[3]]), ys = segs.flatMap(s => [s[1], s[4]]);
  const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const spacing = h('input', { type: 'number', min: 0.1, step: 'any', value: +(Math.max(0.5, size / 50)).toPrecision(2), style: 'width:90px', title: 'Distância entre os pontos de altura tirados das curvas (m)' });
  const shape = h('select', {}, h('option', { value: 'envoltoria' }, 'Envoltória das curvas'), h('option', { value: 'retangulo' }, 'Retângulo das curvas'));
  const level = h('select', {}, app.levels.list.map(l => h('option', { value: l.id, selected: l.id === app.views.activeLevel()?.id }, l.name)));
  modal({
    title: 'Piso por curvas de nível', small: true,
    body: h('div', {},
      h('div', { class: 'small muted' }, `${segs.length} trecho(s) de linha selecionado(s), ${fmtLen(size, { suffix: true })} de extensão.`),
      h('table', { class: 'slope-table' },
        h('tr', {}, h('td', {}, 'Espaçamento dos pontos (m)'), h('td', {}, spacing)),
        h('tr', {}, h('td', {}, 'Contorno'), h('td', {}, shape)),
        h('tr', {}, h('td', {}, 'Nível'), h('td', {}, level))),
      h('div', { class: 'small muted' }, 'As curvas precisam ter a cota no Z (elevação das polilinhas). O terreno fica na cota da curva mais baixa.')),
    actions: [
      { label: 'Cancelar' },
      { label: 'Criar terreno', class: 'primary', action: () => {
        busy(true, 'Montando o terreno pelas curvas…');
        try {
          const t = contourTerrain(segs, { spacing: Math.max(0.05, Number(spacing.value) || size / 50), shape: shape.value });
          const lvl = app.levels.get(level.value) || app.levels.list[0];
          const el = createOnLevel('slab', { level: lvl.id, points: t.points, elevation: round6(t.zMin - lvl.elevation) }, app.levels);
          const s = el.userData.bim.slab;
          s.terreno = true; s.alturas = t.alturas; s.forma = t.forma;
          el.userData.bim.name = el.name = 'Terreno (curvas de nível)';
          el.userData.bim.props = { ...(el.userData.bim.props || {}), Origem: `Curvas de nível (${t.curvas} cotas)` };
          app.viewer.add(el);
          app.viewer.select([el]);
          app.status(`Terreno pelas curvas: ${t.points.length + t.forma.length} pontos de altura, ${t.curvas} cotas, de ${fmtLen(t.zMin, { suffix: true })}.`);
        } catch (err) { toast(err.message, 'error'); return false; } finally { busy(false); }
        return true;
      } },
    ],
  });
}
