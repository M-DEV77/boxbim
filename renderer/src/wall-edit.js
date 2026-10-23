// PAREDE: editar (clique duplo) e ligar ao telhado.
//   editWall ........ diálogo da parede: nome, tipo, base, altura, comprimento e o PERFIL de elevação, num editor 2D
//                     (arrastar vértices; clique duplo numa aresta acrescenta; Delete/botão direito tira; vãos à vista)
//   attachToRoof .... "Parede até o telhado": o topo da parede passa a seguir a FACE DE BAIXO do telhado que está em
//                     cima dela (estende ou recorta) — vira o perfil da parede; trechos sem telhado mantêm a altura.
import * as THREE from 'three';
import { h, modal, toast } from './ui.js';
import { rebuildElement, roofFrame, roofUnderside, totalThickness, wallTop } from './elements.js';
import { handlesOf } from './sketch/linear.js';
import { fmtLen, fromUnit, toUnit, unitLabel } from './units.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
const r4 = v => +(+v).toFixed(4);
const wallLen = w => Math.hypot(w.end[0] - w.start[0], w.end[1] - w.start[1]);
const rectOf = w => [[0, 0], [wallLen(w), 0], [wallLen(w), w.height], [0, w.height]];

/** Grava a mudança da parede: refaz a geometria, o script, as portas/janelas e sincroniza. */
async function commitWall(app, el) {
  rebuildElement(el);
  await app.system.pending(el);
  await app.hosting.refreshHostedOf(el);
  app.viewer._prepare2D(el);
  if (app.viewer.selected.has(el)) app.viewer._highlight(el, true);
  app.viewer.changed();
  app.renderProps();
}

// ---------------------------------------------------------------- parede até o telhado

/** Z (absoluto) da face de baixo do telhado no ponto (x, y), ou null se o telhado não cobre o ponto. */
function undersideZ(roof, x, y) {
  const r = roof.userData.bim.roof;
  roof.updateMatrixWorld(true);
  const M = roofFrame(r).premultiply(roof.matrixWorld);
  // o plano do perfil é vertical: o ponto (x, y) cai numa reta vertical do plano; acha u e n sem depender de z
  const U = new THREE.Vector3().setFromMatrixColumn(M, 0), V = new THREE.Vector3().setFromMatrixColumn(M, 1);
  if (Math.abs(V.z) < 0.99) return null; // só telhados de perfil em plano vertical
  const o = new THREE.Vector3().setFromMatrixPosition(M);
  const Nn = new THREE.Vector3().setFromMatrixColumn(M, 2).normalize();
  const d = new THREE.Vector3(x - o.x, y - o.y, 0);
  const u = d.dot(U) / U.lengthSq(), n = d.dot(Nn);
  if (n < r.inicio - 1e-6 || n > r.fim + 1e-6) return null;
  const ls = roof.userData.bim.layers;
  const total = totalThickness(ls?.length ? ls : [{ thickness: 0.15 }]);
  const line = roofUnderside(r, total);
  for (let i = 1; i < line.length; i++) {
    const [u0, v0] = line[i - 1], [u1, v1] = line[i];
    if ((u - u0) * (u - u1) <= 1e-9 && Math.abs(u1 - u0) > 1e-9) {
      const v = v0 + (v1 - v0) * (u - u0) / (u1 - u0);
      return o.z + v * V.z;
    }
  }
  return null;
}

/** Valores de u do telhado onde a linha de baixo quebra (para achar as quinas do topo da parede). */
function roofBreaks(roof) {
  const r = roof.userData.bim.roof;
  const ls = roof.userData.bim.layers;
  const total = totalThickness(ls?.length ? ls : [{ thickness: 0.15 }]);
  return roofUnderside(r, total).map(p => p[0]);
}

/**
 * Perfil da parede seguindo a face de baixo dos telhados acima dela. Devolve o perfil [[u, z], …] (z relativo à
 * base) ou null se nenhum telhado cobre a parede.
 */
export function roofProfile(app, wallEl, roofs) {
  const w = wallEl.userData.bim.wall;
  const hd = handlesOf(app, wallEl)[0];
  const A = hd.l.a, B = hd.l.b, L = wallLen(w);
  const dir = [(B[0] - A[0]) / L, (B[1] - A[1]) / L], nrm = [-dir[1], dir[0]], t = w.thickness / 2;
  const at = (u, side) => [A[0] + dir[0] * u + nrm[0] * side, A[1] + dir[1] * u + nrm[1] * side];
  // pontos de amostra: pontas, quinas da linha de baixo de cada telhado e onde a extrusão começa/termina
  const us = new Set([0, L]);
  for (const roof of roofs) {
    const r = roof.userData.bim.roof;
    roof.updateMatrixWorld(true);
    const M = roofFrame(r).premultiply(roof.matrixWorld);
    const o = new THREE.Vector3().setFromMatrixPosition(M), U = new THREE.Vector3().setFromMatrixColumn(M, 0), Nn = new THREE.Vector3().setFromMatrixColumn(M, 2).normalize();
    const lin = (vec, off) => { // u_parede onde (ponto da parede − o)·vec = off
      const a0 = (A[0] - o.x) * vec.x + (A[1] - o.y) * vec.y, k = dir[0] * vec.x + dir[1] * vec.y;
      return Math.abs(k) < 1e-9 ? null : (off - a0) / k;
    };
    for (const ub of roofBreaks(roof)) { const x = lin(U, ub * U.lengthSq()); if (x !== null) us.add(x); }
    for (const nb of [r.inicio, r.fim]) { const x = lin(Nn, nb); if (x !== null) { us.add(x - 1e-4); us.add(x + 1e-4); } }
  }
  const samples = [...us].filter(u => u >= -1e-9 && u <= L + 1e-9).sort((a, b) => a - b);
  let covered = false;
  const top = samples.map(u => {
    let best = null;
    for (const roof of roofs) for (const side of [0, t, -t]) { // pelas duas faces: o telhado não entra na parede
      const p = at(Math.min(L, Math.max(0, u)), side);
      const z = undersideZ(roof, p[0], p[1]);
      if (z !== null && z > w.base + 0.05 && (best === null || z < best)) best = z;
    }
    if (best !== null) covered = true;
    return [r4(Math.min(L, Math.max(0, u))), r4(best === null ? w.height : best - w.base)];
  });
  if (!covered) return null;
  // limpa pontos repetidos/colineares
  const clean = [];
  for (const p of top) {
    if (clean.length && Math.abs(clean[clean.length - 1][0] - p[0]) < 1e-4) { clean[clean.length - 1] = p; continue; }
    if (clean.length >= 2) {
      const [a, b] = clean.slice(-2);
      const cr = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
      if (Math.abs(cr) < 1e-6) clean.pop();
    }
    clean.push(p);
  }
  return [[0, 0], [r4(L), 0], ...clean.reverse()];
}

/** Comando "Parede até o telhado" nas paredes selecionadas (telhados: os selecionados ou todos). */
export async function attachToRoof(app, walls = null) {
  const sel = [...app.viewer.selected];
  const ws = walls || sel.filter(e => e.userData.bim.wall);
  if (!ws.length) { toast('Selecione as paredes (e, se quiser, o telhado) e use "Parede até o telhado".', 'error'); return 0; }
  const pickedRoofs = sel.filter(e => e.userData.bim.roof);
  const roofs = pickedRoofs.length ? pickedRoofs : app.viewer.elements().filter(e => e.userData.bim.roof && e.visible);
  if (!roofs.length) { toast('Não há telhado no projeto. Crie um com Modelar › Telhado.', 'error'); return 0; }
  let n = 0;
  for (const el of ws) {
    const perfil = roofProfile(app, el, roofs);
    if (!perfil) continue;
    el.userData.bim.wall.perfil = perfil;
    el.userData.bim.wall.height = r4(Math.max(...perfil.map(p => p[1])));
    el.userData.bim.wall.ateTelhado = true;
    await commitWall(app, el);
    n++;
  }
  app.status(n ? `${n} parede(s) até o telhado (topo pela face de baixo do telhado).` : 'Nenhuma das paredes está debaixo de um telhado.');
  if (!n) toast('Nenhuma parede selecionada fica debaixo de um telhado (o telhado precisa cobri-la em planta).', 'error');
  return n;
}

// ---------------------------------------------------------------- editor da parede (clique duplo)

export function editWall(app, el) {
  const b = el.userData.bim, w = b.wall;
  const L = wallLen(w);
  let pts = (w.perfil?.length ? w.perfil : rectOf(w)).map(p => [...p]);
  const types = app.types.list('wall');
  const name = h('input', { value: b.name || '' });
  const typeSel = h('select', {}, types.map(t => h('option', { value: t.id, selected: t.id === b.typeId }, `${t.name} (${fmtLen(app.types.thickness(t), { suffix: true })})`)));
  const lenIn = h('input', { type: 'number', step: 'any', value: toUnit(L) });
  const baseIn = h('input', { type: 'number', step: 'any', value: toUnit(w.base) });
  const hIn = h('input', { type: 'number', step: 'any', value: toUnit(wallTop({ ...w, perfil: pts })), title: 'Altura (com perfil próprio: estica o perfil inteiro)' });
  const info = h('div', { class: 'small muted' });

  // ---- editor SVG do perfil (elevação: u para a direita, z para cima)
  const W = 560, H = 300, pad = 30;
  const box = h('div', { class: 'wall-profile' });
  const sv = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%' });
  box.append(sv);
  let sel = -1;
  const view = () => {
    const zs = pts.map(p => p[1]), us = pts.map(p => p[0]);
    const umin = Math.min(0, ...us), umax = Math.max(L, ...us), zmax = Math.max(0.5, ...zs);
    const k = Math.min((W - 2 * pad) / (umax - umin || 1), (H - 2 * pad) / (zmax || 1));
    return { k, X: u => pad + (u - umin) * k, Y: z => H - pad - z * k, U: x => (x - pad) / k + umin, Z: y => (H - pad - y) / k };
  };
  const draw = () => {
    hIn.value = toUnit(r4(Math.max(...pts.map(p => p[1])))); // a altura acompanha o perfil
    sv.replaceChildren();
    const v = view();
    sv.append(svg('line', { x1: 0, x2: W, y1: v.Y(0), y2: v.Y(0), class: 'wp-base' }));
    sv.append(svg('polygon', { points: pts.map(p => `${v.X(p[0])},${v.Y(p[1])}`).join(' '), class: 'wp-outline' }));
    for (const o of w.openings || []) {
      sv.append(svg('rect', { x: v.X(o.offset - o.width / 2), y: v.Y(o.sill + o.height), width: o.width * v.k, height: o.height * v.k, class: 'wp-opening' }));
    }
    pts.forEach((p, i) => {
      const c = svg('circle', { cx: v.X(p[0]), cy: v.Y(p[1]), r: 6, class: `wp-pt${i === sel ? ' on' : ''}` });
      c.addEventListener('pointerdown', e => startDrag(e, i));
      c.addEventListener('contextmenu', e => { e.preventDefault(); removePt(i); });
      sv.append(c);
    });
    info.textContent = `${pts.length} vértices · altura máx. ${fmtLen(Math.max(...pts.map(p => p[1])), { suffix: true })} · arraste os pontos; clique duplo numa aresta acrescenta um ponto; botão direito (ou Delete) tira`;
  };
  const toLocal = e => {
    const r = sv.getBoundingClientRect(), v = view();
    const x = (e.clientX - r.left) * W / r.width, y = (e.clientY - r.top) * H / r.height;
    return [Math.round(v.U(x) * 100) / 100, Math.round(v.Z(y) * 100) / 100];
  };
  const startDrag = (e, i) => {
    e.preventDefault(); e.stopPropagation();
    sel = i;
    const v0 = view(); // escala fixa durante o arraste (senão o desenho "foge" do mouse)
    const r = sv.getBoundingClientRect();
    const move = ev => {
      const x = (ev.clientX - r.left) * W / r.width, y = (ev.clientY - r.top) * H / r.height;
      let p = [Math.round(v0.U(x) * 100) / 100, Math.round(v0.Z(y) * 100) / 100];
      if (ev.shiftKey) { const q = pts[(i - 1 + pts.length) % pts.length]; p = Math.abs(p[0] - q[0]) > Math.abs(p[1] - q[1]) ? [p[0], q[1]] : [q[0], p[1]]; }
      p[1] = Math.max(0, p[1]);
      pts[i] = p;
      draw();
    };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); hIn.value = toUnit(Math.max(...pts.map(p => p[1]))); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
    draw();
  };
  const removePt = i => { if (pts.length <= 3) { toast('O perfil precisa de pelo menos 3 pontos.', 'error'); return; } pts.splice(i, 1); sel = -1; draw(); };
  sv.addEventListener('dblclick', e => {
    const p = toLocal(e);
    let best = 0, bd = Infinity;
    pts.forEach((a, i) => {
      const b2 = pts[(i + 1) % pts.length];
      const dx = b2[0] - a[0], dy = b2[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
      const d = Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1]);
      if (d < bd) { bd = d; best = i; }
    });
    pts.splice(best + 1, 0, p);
    sel = best + 1;
    draw();
  });
  const keyDel = e => { if ((e.key === 'Delete' || e.key === 'Backspace') && sel >= 0 && !e.target.matches?.('input, select')) { e.preventDefault(); removePt(sel); } };
  document.addEventListener('keydown', keyDel, true);

  const presets = h('div', { class: 'row-buttons' },
    h('button', { onclick: () => { pts = rectOf({ ...w, height: fromUnit(hIn.value) || w.height }); draw(); }, title: 'Volta ao retângulo da altura' }, 'Retângulo'),
    h('button', { onclick: () => { const hh = fromUnit(hIn.value) || w.height; pts = [[0, 0], [L, 0], [L, hh], [L / 2, hh * 1.4], [0, hh]]; draw(); }, title: 'Oitão (empena) no meio' }, 'Oitão'),
    h('button', { onclick: () => { const hh = fromUnit(hIn.value) || w.height; pts = [[0, 0], [L, 0], [L, hh * 1.25], [0, hh]]; draw(); }, title: 'Topo inclinado' }, 'Inclinado'),
    h('button', { onclick: () => {
      const roofs = app.viewer.elements().filter(e => e.userData.bim.roof && e.visible);
      const p = roofs.length ? roofProfile(app, el, roofs) : null;
      if (!p) { toast('Nenhum telhado cobre esta parede.', 'error'); return; }
      pts = p; draw();
    }, title: 'Topo pela face de baixo do telhado acima' }, '⌂ Até o telhado'));

  draw();
  modal({
    title: `Editar parede — ${b.name || ''}`,
    body: h('div', { class: 'wall-edit' },
      h('div', { class: 'form grid2' },
        h('label', {}, 'Nome', name),
        h('label', {}, 'Tipo (camadas)', typeSel),
        h('label', {}, `Comprimento (${unitLabel()})`, lenIn),
        h('label', {}, `Base (${unitLabel()}, cota absoluta)`, baseIn),
        h('label', {}, `Altura (${unitLabel()})`, hIn)),
      h('h4', {}, 'Perfil da parede (elevação)'), presets, box, info),
    actions: [
      { label: 'Cancelar' },
      { label: 'Aplicar', class: 'primary', action: async () => {
        const newL = fromUnit(lenIn.value), newH = fromUnit(hIn.value), base = fromUnit(baseIn.value);
        if (!(newL > 0.01) || !(newH > 0.01)) { toast('Comprimento e altura precisam ser maiores que zero.', 'error'); return false; }
        b.name = el.name = name.value.trim() || b.name;
        // tipo: camadas e espessura do tipo novo
        if (typeSel.value && typeSel.value !== b.typeId) Object.assign(b, app.types.spec('wall', typeSel.value));
        w.base = Number.isFinite(base) ? base : w.base;
        // comprimento: o fim anda na direção do eixo; o perfil acompanha (escala em u)
        const sx = newL / L;
        if (Math.abs(sx - 1) > 1e-6) {
          w.end = [w.start[0] + (w.end[0] - w.start[0]) * sx, w.start[1] + (w.end[1] - w.start[1]) * sx];
          pts = pts.map(([u, z]) => [r4(u * sx), z]);
        }
        // altura: estica o perfil inteiro na vertical
        const top = Math.max(...pts.map(p => p[1]));
        if (Math.abs(newH - top) > 1e-6 && top > 0) pts = pts.map(([u, z]) => [u, r4(z * newH / top)]);
        const isRect = pts.length === 4 && [[0, 0], [newL, 0], [newL, newH], [0, newH]].every((q, i) => Math.abs(q[0] - pts[i][0]) < 1e-4 && Math.abs(q[1] - pts[i][1]) < 1e-4);
        if (isRect) { delete w.perfil; w.height = newH; } else { w.perfil = pts.map(p => [r4(p[0]), r4(p[1])]); w.height = r4(Math.max(...pts.map(p => p[1]))); }
        await commitWall(app, el);
        app.status(`Parede atualizada${isRect ? '' : ' (perfil próprio)'}.`);
      } },
    ],
    onClose: () => document.removeEventListener('keydown', keyDel, true),
  });
}
