// MURO DE ARRIMO DO PISO (slab.arrimo = { ativo, corte, aterro, espessura, off: [lados desligados] }): ao longo de
// cada lado do contorno, por FORA do piso, um muro da espessura do piso (ou a informada) que segura o terreno:
//   corte .... o terreno natural está ACIMA do topo do piso: o muro vai do fundo do piso até o terreno
//   aterro ... o terreno natural está ABAIXO do piso: o muro vai do terreno até o topo do piso
// A altura acompanha o terreno ao longo do lado (amostras a cada ~0,5 m). Onde há arrimo o talude não age — o
// terreno fica natural até o muro (slopes.js). Os lados podem ser desligados clicando neles (pickEdges).
// As malhas ficam num grupo filho do piso (userData.arrimo); são refeitas quando o piso ou os terrenos mudam.
import * as THREE from 'three';
import { h } from './ui.js';
import { slabShapeFn, materialByName } from './elements.js';
import { toolCursor } from './cursors.js';

export const RETAIN_DEFAULT = { ativo: false, corte: true, aterro: true, espessura: 0, off: [] };
export const retainConfig = s => ({ ...RETAIN_DEFAULT, ...(s.arrimo || {}), off: [...(s.arrimo?.off || [])] });

/** Lados com arrimo (índices do contorno) — para o talude não agir neles. null = sem arrimo. */
export function retainEdges(s) {
  const c = retainConfig(s);
  if (!c.ativo) return null;
  const off = new Set(c.off);
  return { edges: new Set(s.points.map((_, i) => i).filter(i => !off.has(i))), corte: c.corte, aterro: c.aterro };
}

const STEP = 0.5;

export class Retaining {
  constructor(app) {
    this.app = app;
    app.viewer.addEventListener('change', () => this.schedule());
  }

  get viewer() { return this.app.viewer; }

  schedule() {
    clearTimeout(this._t);
    this._t = setTimeout(() => this.update(), 220);
  }

  /** Terrenos (pisos com slab.terreno) e a cota natural de cada um num ponto do modelo. */
  terrains(except) {
    return this.viewer.elements().filter(o => o !== except && o.visible !== false && o.userData.bim?.slab?.terreno).map(o => {
      o.updateMatrixWorld(true);
      const s = o.userData.bim.slab, f = slabShapeFn(s), inv = o.matrixWorld.clone().invert(), M = o.matrixWorld;
      const poly = s.points;
      const inside = (x, y) => { let r = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) r = !r; } return r; };
      const v = new THREE.Vector3();
      return { el: o, at: (x, y) => { v.set(x, y, 0).applyMatrix4(inv); if (!inside(v.x, v.y)) return null; v.z = s.elevation + (f ? f(v.x, v.y) : 0); return v.applyMatrix4(M).z; } };
    });
  }

  update() {
    for (const el of this.viewer.elements()) {
      const s = el.userData.bim?.slab;
      if (!s) continue;
      const cfg = retainConfig(s);
      const group = el.children.find(c => c.userData.arrimo);
      if (!cfg.ativo || s.terreno) { if (group) { el.remove(group); dispose(group); this.viewer._bucketsDirty = true; } continue; }
      const ts = this.terrains(el);
      el.updateMatrixWorld(true);
      const sig = JSON.stringify([s.points, s.elevation, s.thickness, s.alturas, s.forma, cfg, el.matrixWorld.elements.map(x => +x.toFixed(4)),
        ts.map(t => [t.el.userData.bim.guid, t.el.matrixWorld.elements.map(x => +x.toFixed(4)), t.el.userData.bim.slab.points, t.el.userData.bim.slab.alturas, t.el.userData.bim.slab.forma, t.el.userData.bim.slab.elevation])]);
      if (group?.userData.sig === sig) continue;
      if (group) { el.remove(group); dispose(group); }
      const g = this.build(el, cfg, ts);
      g.userData.sig = sig;
      el.add(g);
      if (this.viewer.selected.has(el)) this.viewer._highlight(el, true);
      this.viewer._prepare2D(g);
      this.viewer._bucketsDirty = true;
    }
  }

  /** O muro de cada lado ligado: perfil (fundo/topo) em amostras, por fora do piso. */
  build(el, cfg, ts) {
    const s = el.userData.bim.slab, f = slabShapeFn(s), M = el.matrixWorld, inv = M.clone().invert();
    const T = cfg.espessura > 0 ? cfg.espessura : (s.thickness || 0.15), th = s.thickness || 0.15;
    const pts = s.points, n = pts.length;
    const ccw = pts.reduce((t, p, i) => { const q = pts[(i + 1) % n]; return t + p[0] * q[1] - q[0] * p[1]; }, 0) > 0;
    const off = new Set(cfg.off);
    const P = [];
    const w = new THREE.Vector3();
    // cota natural (modelo) num ponto local do piso: o terreno mais alto que cobre o ponto
    const natural = (x, y) => {
      w.set(x, y, 0).applyMatrix4(M);
      let z = null;
      for (const t of ts) { const zt = t.at(w.x, w.y); if (zt !== null && (z === null || zt > z)) z = zt; }
      return z === null ? null : new THREE.Vector3(w.x, w.y, z).applyMatrix4(inv).z; // de volta ao local do piso
    };
    const quad = (a, b, c, d) => P.push(...a, ...b, ...c, ...a, ...c, ...d);
    for (let i = 0; i < n; i++) {
      if (off.has(i)) continue;
      const a = pts[i], b = pts[(i + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 0.01) continue;
      const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
      const ox = ccw ? uy : -uy, oy = ccw ? -ux : ux; // para fora do piso
      // amostras ao longo do lado, começando e terminando "T" além das pontas (cobre a quina do vizinho)
      const k = Math.max(1, Math.ceil((L + 2 * T) / STEP));
      const prof = [];
      for (let j = 0; j <= k; j++) {
        const t = -T + (L + 2 * T) * j / k, x = a[0] + ux * t, y = a[1] + uy * t;
        const tc = Math.max(0, Math.min(L, t)), cx = a[0] + ux * tc, cy = a[1] + uy * tc;
        const z0 = s.elevation + (f ? f(cx, cy) : 0);
        // o terreno é lido um pouco além da face de fora (onde o muro segura)
        const zt = natural(cx + ox * (T + 0.05), cy + oy * (T + 0.05));
        let bot = z0 - th, top = z0 - th;
        if (zt !== null) {
          if (cfg.corte && zt > z0 + 0.01) { top = zt; bot = z0 - th; }
          else if (cfg.aterro && zt < z0 - 0.01) { top = z0; bot = zt; }
        }
        prof.push({ x, y, bot, top });
      }
      if (!prof.some(p => p.top - p.bot > 0.02)) continue;
      const I = p => [p.x, p.y], O = p => [p.x + ox * T, p.y + oy * T];
      for (let j = 0; j < prof.length - 1; j++) {
        const p = prof[j], q = prof[j + 1];
        if (p.top - p.bot < 0.005 && q.top - q.bot < 0.005) continue;
        const [pix, piy] = I(p), [qix, qiy] = I(q), [pox, poy] = O(p), [qox, qoy] = O(q);
        quad([pox, poy, p.bot], [qox, qoy, q.bot], [qox, qoy, q.top], [pox, poy, p.top]);   // face de fora
        quad([qix, qiy, q.bot], [pix, piy, p.bot], [pix, piy, p.top], [qix, qiy, q.top]);   // face de dentro
        quad([pix, piy, p.top], [pox, poy, p.top], [qox, qoy, q.top], [qix, qiy, q.top]);   // topo
        quad([pix, piy, p.bot], [qix, qiy, q.bot], [qox, qoy, q.bot], [pox, poy, p.bot]);   // fundo
      }
      // cabeceiras
      const cap = (p, flip) => {
        const [ix, iy] = I(p), [qx, qy] = O(p);
        const quadArgs = [[ix, iy, p.bot], [qx, qy, p.bot], [qx, qy, p.top], [ix, iy, p.top]];
        if (flip) quadArgs.reverse();
        quad(...quadArgs);
      };
      cap(prof[0], false); cap(prof[prof.length - 1], true);
    }
    const group = new THREE.Group();
    group.name = 'Arrimo';
    group.userData.arrimo = true;
    if (P.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, materialByName('Concreto', 0xb9b4aa));
      mesh.name = 'Muro de arrimo';
      Object.assign(mesh.userData, { arrimo: true, layer: { name: 'Arrimo', material: 'Concreto' } });
      group.add(mesh);
    }
    return group;
  }

  // ------------------------------------------------------------ escolher os lados

  /**
   * Liga/desliga os lados do arrimo clicando neles: ligados em laranja, desligados tracejados. Esc, botão direito ou
   * clique fora dos lados termina.
   */
  pickEdges(el, onChange) {
    this.stopPick?.();
    const v = this.viewer, cv = v.renderer.domElement, fp = this.app.floorPoints;
    const live = () => fp.live(el);
    const group = new THREE.Group();
    v.overlay.add(group);
    const MAT_ON = new THREE.LineBasicMaterial({ color: 0xff9f1a, depthTest: false });
    const MAT_OFF = new THREE.LineDashedMaterial({ color: 0x8a96a3, dashSize: 0.25, gapSize: 0.18, depthTest: false });
    const MAT_HOT = new THREE.LineBasicMaterial({ color: 0x39ff6a, depthTest: false });
    const edgesW = () => {
      const e = live(), s = e.userData.bim.slab, f = slabShapeFn(s);
      e.updateMatrixWorld(true);
      return s.points.map((p, i) => {
        const q = s.points[(i + 1) % s.points.length];
        return [p, q].map(([x, y]) => new THREE.Vector3(x, y, s.elevation + (f ? f(x, y) : 0) + 0.02).applyMatrix4(e.matrixWorld));
      });
    };
    const screen = p => { const q = p.clone().project(v.camera), r = cv.getBoundingClientRect(); return [(q.x + 1) / 2 * r.width + r.left, (1 - q.y) / 2 * r.height + r.top]; };
    const near = e => {
      let best = -1, bd = 10;
      edgesW().forEach(([A, B], i) => {
        const a = screen(A), b = screen(B), dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((e.clientX - a[0]) * dx + (e.clientY - a[1]) * dy) / L));
        const d = Math.hypot(a[0] + dx * t - e.clientX, a[1] + dy * t - e.clientY);
        if (d < bd) { bd = d; best = i; }
      });
      return best;
    };
    const draw = hot => {
      for (const c of [...group.children]) { group.remove(c); c.geometry.dispose(); }
      const off = new Set(retainConfig(live().userData.bim.slab).off);
      edgesW().forEach(([A, B], i) => {
        const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([A, B]), i === hot ? MAT_HOT : off.has(i) ? MAT_OFF : MAT_ON);
        if (off.has(i) && i !== hot) l.computeLineDistances(); // tracejada
        l.renderOrder = 1000;
        group.add(l);
      });
    };
    const move = e => { const i = near(e); draw(i); cv.style.cursor = toolCursor('arrimo', i >= 0 ? 'ok' : ''); };
    const stop = () => {
      cv.removeEventListener('pointerdown', down, true); cv.removeEventListener('pointermove', move);
      document.removeEventListener('keydown', key, true);
      cv.style.cursor = '';
      for (const c of [...group.children]) c.geometry.dispose();
      group.parent?.remove(group);
      this.stopPick = null;
      this.app.status('Lados do arrimo: terminado.');
    };
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); stop(); } };
    const down = e => {
      if (e.button === 2) { stop(); return; }
      if (e.button !== 0) return;
      const i = near(e);
      if (i < 0) { stop(); return; }
      e.preventDefault(); e.stopPropagation();
      const cur = live(), s = cur.userData.bim.slab, c = retainConfig(s);
      const set = new Set(c.off);
      if (set.has(i)) set.delete(i); else set.add(i);
      s.arrimo = { ...c, off: [...set].sort((a, b) => a - b) };
      fp.commit(cur);
      draw(i);
      onChange?.();
      this.app.status(`Arrimo: lado ${i + 1} ${set.has(i) ? 'desligado' : 'ligado'} · clique em outros lados · Esc termina.`);
    };
    cv.addEventListener('pointerdown', down, true);
    cv.addEventListener('pointermove', move);
    document.addEventListener('keydown', key, true);
    cv.style.cursor = toolCursor('arrimo');
    draw(-1);
    this.stopPick = stop;
    this.app.status('Lados do arrimo · clique num lado para ligar/desligar (laranja = com muro, tracejado = sem) · Esc termina.');
  }
}

/** Seção "Arrimo" nas propriedades do piso. */
export function retainSection(app, el) {
  const fp = app.floorPoints, s = el.userData.bim.slab, cfg = retainConfig(s);
  const save = patch => { const cur = fp.live(el), cs = cur.userData.bim.slab; cs.arrimo = { ...retainConfig(cs), ...patch }; fp.commit(cur); };
  if (s.terreno) return [];
  const total = s.points.length, on = total - cfg.off.filter(i => i < total).length;
  return [
    h('h4', {}, 'Arrimo'),
    h('label', { class: 'inline', title: 'Muro de arrimo em volta do piso, por fora, da espessura do piso: segura o terreno no corte (acima do piso) e/ou no aterro (abaixo do piso). Onde há arrimo, o talude não age.' },
      h('input', { type: 'checkbox', checked: cfg.ativo, onchange: e => save({ ativo: e.target.checked }) }), 'Muro de arrimo'),
    cfg.ativo ? h('table', { class: 'slope-table' },
      h('tr', {}, h('td', { colspan: 2 },
        h('label', { class: 'inline', title: 'Muro onde o terreno está acima do piso (vai do fundo do piso até o terreno)' }, h('input', { type: 'checkbox', checked: cfg.corte, onchange: e => save({ corte: e.target.checked }) }), 'No corte'),
        ' ',
        h('label', { class: 'inline', title: 'Muro onde o terreno está abaixo do piso (vai do terreno até o topo do piso)' }, h('input', { type: 'checkbox', checked: cfg.aterro, onchange: e => save({ aterro: e.target.checked }) }), 'No aterro'))),
      h('tr', { title: 'Espessura do muro (0 = a do piso)' }, h('td', {}, 'Espessura (m)'),
        h('td', {}, h('input', { type: 'number', min: 0, step: 'any', value: cfg.espessura || '', placeholder: `${(s.thickness || 0.15).toFixed(3)} (do piso)`, style: 'width:100%',
          onchange: e => { const x = Number(e.target.value); save({ espessura: x > 0 ? x : 0 }); } }))),
      h('tr', {}, h('td', {}, 'Lados com muro'), h('td', {}, `${on} de ${total}`))) : null,
    cfg.ativo ? h('div', { class: 'row-buttons' },
      h('button', { onclick: () => app.retaining.pickEdges(el, () => app.renderProps()), title: 'Clique nos lados do piso, na vista, para ligar ou desligar o muro de cada um' }, '▭ Escolher lados…'),
      cfg.off.length ? h('button', { onclick: () => save({ off: [] }), title: 'Liga o muro em todos os lados' }, 'Todos os lados') : null) : null,
  ];
}

function dispose(g) { g.traverse(o => o.geometry?.dispose()); }

