// Ferramenta LAJE: monta o contorno da laje (como o "esboço" do piso no Revit) e cria a laje ao concluir.
// O contorno é juntado de várias fontes, em qualquer combinação:
//   ✎ Croqui ........ desenhar: polilinha (clique os pontos; C fecha) ou retângulo (dois cantos)
//   ⟋ Linhas 2D ..... clicar numa linha do desenho: entra ela e as ligadas pelas pontas
//   ▭ Paredes ....... clicar numa parede: entra o contorno das paredes ligadas (face externa, interna ou eixo)
//   ◧ Sólido ........ clicar numa face horizontal de um sólido: entra o contorno dela (arestas da face)
// Contornos fechados viram lajes; contornos dentro de outro viram FUROS. Opções no painel da direita.
import * as THREE from 'three';
import { h, toast } from './ui.js';
import { createOnLevel } from './modeling.js';
import { fmtElev } from './levels.js';
import { fmtLen, fromUnit, toUnit, unitLabel } from './units.js';
import { isSketch, bake, distToSeg, chainSegments, outerWithHoles, offsetLoop, area, dist } from './sketch/sketch.js';
import { handlesOf } from './sketch/linear.js';

const SNAP_PX = 12;
const GRID = 0.01;
const store = (k, v) => { try { localStorage.setItem(k, v); } catch { /* sem armazenamento */ } };
const load = k => { try { return localStorage.getItem(k); } catch { return null; } };
const BOUND_MAT = new THREE.LineBasicMaterial({ color: 0xff3fd0, depthTest: false });
const RUBBER = new THREE.LineDashedMaterial({ color: 0xff3fd0, dashSize: 0.2, gapSize: 0.1, depthTest: false });
const MODES = { croqui: '✎ Croqui', linhas: '⟋ Linhas 2D', paredes: '▭ Paredes', solido: '◧ Sólido' };
const FACES = { externa: 'Face externa', interna: 'Face interna', eixo: 'Eixo' };
const key = p => `${p[0].toFixed(4)},${p[1].toFixed(4)}`;

export class SlabTool {
  constructor(app) {
    this.app = app;
    this.active = false;
    this.mode = MODES[load('boxbim.lajeModo')] ? load('boxbim.lajeModo') : 'croqui';
    this.shape = load('boxbim.lajeForma') === 'retangulo' ? 'retangulo' : 'linha';
    this.face = FACES[load('boxbim.lajeFace')] ? load('boxbim.lajeFace') : 'externa';
    this.typeId = load('boxbim.lajeTipo') || null;
    this.offset = 0;          // topo em relação ao nível
    this.atFace = true;       // modo sólido: topo na cota da face clicada
  }

  get viewer() { return this.app.viewer; }

  start() {
    if (this.active) return;
    if (this.app.views.active.kind === 'elevation') { toast('Para criar pisos, abra uma planta ou a Vista 3D.', 'error'); return; }
    for (const t of [this.app.wallTool, this.app.sketchTool, this.app.placeTool]) if (t?.active) t.stop();
    this.level = this.app.views.activeLevel() || this.app.levels.list[0];
    this.active = true;
    this.groups = [];   // grupos de trechos adicionados (para desfazer): [{ segs: [{a, b}], z? }]
    this.pts = [];      // croqui em curso
    this.faceZ = null;
    this.viewer.tool = this;
    this.viewer.select([]);
    this.group = new THREE.Group();
    this.viewer.overlay.add(this.group);
    const c = this.viewer.controls;
    this._saved = { controls: c, buttons: { ...c.mouseButtons } };
    c.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: c.mouseButtons.RIGHT };
    const el = this.viewer.renderer.domElement;
    this._h = { move: e => this.move(e), down: e => this.down(e), key: e => this.key(e), ctx: e => e.preventDefault() };
    el.addEventListener('pointermove', this._h.move);
    el.addEventListener('pointerdown', this._h.down);
    el.addEventListener('contextmenu', this._h.ctx);
    document.addEventListener('keydown', this._h.key, true);
    el.style.cursor = 'crosshair';
    this.buildPanel();
    this.redraw();
    this.help();
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    const el = this.viewer.renderer.domElement;
    el.removeEventListener('pointermove', this._h.move);
    el.removeEventListener('pointerdown', this._h.down);
    el.removeEventListener('contextmenu', this._h.ctx);
    document.removeEventListener('keydown', this._h.key, true);
    el.style.cursor = '';
    this._saved.controls.mouseButtons = this._saved.buttons;
    this.viewer.overlay.remove(this.group);
    this.panel?.remove(); this.tip?.remove(); this.marker?.remove();
    if (this._sidebarWasCollapsed) this.app.setSidebar('right', true, false);
    this.viewer.tool = null;
    this.app.status('Pronto.');
  }

  help() {
    const t = {
      croqui: this.shape === 'retangulo' ? 'Croqui: clique dois cantos opostos.' : 'Croqui: clique os pontos do contorno · C fecha · Enter termina o trecho · Backspace desfaz o ponto.',
      linhas: 'Linhas 2D: clique numa linha do desenho (entram as ligadas a ela).',
      paredes: 'Paredes: clique numa parede — entra o contorno das paredes ligadas, na face escolhida.',
      solido: 'Sólido: clique na face horizontal de um sólido (topo, base) — entra o contorno dela.',
    }[this.mode];
    this.app.status(`Piso · ${t} Depois: ✔ Concluir (contornos internos viram furos) · Esc sai.`);
  }

  // ------------------------------------------------------------ painel da direita

  buildPanel() {
    const seg = (opts, get, set) => h('div', { class: 'seg-btns' }, Object.entries(opts).map(([k, label]) => {
      const b = h('button', { class: get() === k ? 'on' : '', onclick: () => { set(k); b.parentElement.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); this.sync(); } }, label);
      return b;
    }));
    const types = this.app.types.list('slab');
    if (!types.some(t => t.id === this.typeId)) this.typeId = types[0]?.id || null;
    this.levelSel = h('select', { onchange: e => { this.level = this.app.levels.get(e.target.value); this.redraw(); } },
      this.app.levels.list.map(l => h('option', { value: l.id, selected: l === this.level }, `${l.name} (${fmtElev(l.elevation)})`)));
    const typeSel = h('select', { onchange: e => { this.typeId = e.target.value; store('boxbim.lajeTipo', this.typeId); this.sync(); } },
      types.map(t => h('option', { value: t.id, selected: t.id === this.typeId }, t.name)));
    this.thick = h('span', { class: 'muted small' });
    const offIn = h('input', { type: 'number', step: 'any', value: toUnit(this.offset), onchange: e => { this.offset = fromUnit(e.target.value) || 0; } });
    this.shapeRow = h('div', {}, seg({ linha: 'Polilinha', retangulo: 'Retângulo' }, () => this.shape, k => { this.shape = k; store('boxbim.lajeForma', k); this.pts = []; this.redraw(); }));
    this.faceRow = h('div', {}, seg(FACES, () => this.face, k => { this.face = k; store('boxbim.lajeFace', k); }));
    this.atFaceRow = h('label', { class: 'inline', title: 'O topo do piso fica na cota da face clicada (senão, no nível + deslocamento)' },
      h('input', { type: 'checkbox', checked: this.atFace, onchange: e => { this.atFace = e.target.checked; } }), 'Topo na cota da face do sólido');
    this.count = h('div', { class: 'small muted' });
    this.panel = h('div', { class: 'tool-panel' },
      h('div', { class: 'tool-panel-head' }, h('strong', {}, '▱ Piso'), h('span', { class: 'spacer' }),
        h('button', { onclick: () => this.stop(), title: 'Sai sem criar (Esc)' }, 'Sair')),
      h('h4', {}, 'Contorno a partir de'), seg(MODES, () => this.mode, k => { this.mode = k; store('boxbim.lajeModo', k); this.pts = []; this.redraw(); this.help(); }),
      this.shapeRow, this.faceRow, this.atFaceRow,
      h('div', { class: 'row-buttons' },
        h('button', { onclick: () => this.undo(), title: 'Tira o último trecho adicionado (Backspace)' }, '↶ Desfazer'),
        h('button', { onclick: () => { this.groups = []; this.pts = []; this.faceZ = null; this.redraw(); } }, 'Limpar')),
      this.count,
      h('h4', {}, 'Piso'),
      h('div', { class: 'form' },
        h('label', {}, 'Nível', this.levelSel),
        h('label', {}, 'Tipo', typeSel, this.thick),
        h('label', {}, `Deslocamento do topo (${unitLabel()})`, offIn)),
      h('button', { class: 'primary', onclick: () => this.finish(), title: 'Cria o piso com os contornos fechados (Enter com o croqui parado)' }, '✔ Concluir piso'));
    this._sidebarWasCollapsed = document.querySelector('.layout')?.classList.contains('right-collapsed');
    if (this._sidebarWasCollapsed) this.app.setSidebar('right', false, false);
    this.app.showTab('props');
    (document.querySelector('.tab-body[data-body="props"]') || document.querySelector('.center')).prepend(this.panel);
    this.tip = h('div', { class: 'draw-tip', hidden: true });
    this.marker = h('div', { class: 'snap-marker', hidden: true });
    document.querySelector('.center').append(this.tip, this.marker);
    this.sync();
  }

  sync() {
    if (!this.panel) return;
    this.shapeRow.hidden = this.mode !== 'croqui';
    this.faceRow.hidden = this.mode !== 'paredes';
    this.atFaceRow.hidden = this.mode !== 'solido';
    const t = this.app.types.get('slab', this.typeId);
    this.thick.textContent = t ? ` ${fmtLen(this.app.types.thickness(t), { suffix: true })}` : '';
    const segs = this.allSegs();
    const { loops, chains } = chainSegments(segs);
    this.count.textContent = `${segs.length} trecho(s) no contorno · ${loops.length} fechado(s)${chains.length ? ` · ${chains.length} aberto(s)` : ''}`;
  }

  // ------------------------------------------------------------ geometria

  get z() { return this.level.elevation; }

  worldAt(e) {
    const r = this.viewer.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.viewer.camera);
    const hit = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), -this.z), new THREE.Vector3());
    return hit ? [hit.x, hit.y] : null;
  }

  toScreen([x, y]) {
    const el = this.viewer.renderer.domElement;
    const p = new THREE.Vector3(x, y, this.z).project(this.viewer.camera);
    return [(p.x + 1) / 2 * el.clientWidth, (1 - p.y) / 2 * el.clientHeight];
  }

  pxSize(e) {
    const a = this.worldAt(e), b = this.worldAt({ clientX: e.clientX + 1, clientY: e.clientY });
    return a && b ? dist(a, b) : 0.02;
  }

  allSegs() { return this.groups.flatMap(g => g.segs).map(s => ({ a: s.a, b: s.b, arco: null, z: 0 })); }

  /** Croqui: snap nas pontas do contorno, das linhas 2D e das paredes; ORTO (F8, Shift inverte). */
  resolve(e) {
    const raw = this.worldAt(e);
    if (!raw) return null;
    const rs = this.toScreen(raw);
    const cands = [];
    for (const s of this.allSegs()) cands.push(s.a, s.b);
    if (this.pts.length > 2) cands.push(this.pts[0]);
    for (const el of this.viewer.elements()) {
      if (isSketch(el) && !el.userData.bim.linha.plano && !el.userData.bim.linha.arco) { const l = bake(el).userData.bim.linha; cands.push(l.a, l.b); }
      else if (el.userData.bim.wall && el.visible) { const hd = handlesOf(this.app, el)[0]; if (hd) cands.push(hd.l.a, hd.l.b); }
    }
    let best = null, bd = SNAP_PX;
    for (const c of cands) { const s = this.toScreen(c); const d = Math.hypot(s[0] - rs[0], s[1] - rs[1]); if (d < bd) { bd = d; best = c; } }
    if (best) return { p: [...best], snap: true };
    const last = this.pts[this.pts.length - 1];
    let p = raw;
    if (last && this.shape === 'linha' && this.app.wallTool.ortho !== !!e.shiftKey) {
      p = Math.abs(p[0] - last[0]) >= Math.abs(p[1] - last[1]) ? [p[0], last[1]] : [last[0], p[1]];
    }
    return { p: p.map(v => Math.round(v / GRID) * GRID) };
  }

  // ------------------------------------------------------------ fontes do contorno

  /** Linhas 2D ligadas à clicada (no plano dos níveis). */
  pickLines(e) {
    const raw = this.worldAt(e);
    if (!raw) return null;
    const lines = this.viewer.elements().filter(x => isSketch(x) && x.visible && !x.userData.bim.linha.plano && !bake(x).userData.bim.linha.arco);
    let best = null, bd = 10 * this.pxSize(e);
    for (const x of lines) { const d = distToSeg(x.userData.bim.linha, raw); if (d < bd) { bd = d; best = x; } }
    if (!best) return null;
    const ends = new Map();
    for (const x of lines) for (const p of [x.userData.bim.linha.a, x.userData.bim.linha.b]) { const k = key(p); if (!ends.has(k)) ends.set(k, []); ends.get(k).push(x); }
    const seen = new Set([best]), queue = [best];
    while (queue.length) {
      const cur = queue.pop().userData.bim.linha;
      for (const p of [cur.a, cur.b]) for (const x of ends.get(key(p)) || []) if (!seen.has(x)) { seen.add(x); queue.push(x); }
    }
    return { segs: [...seen].map(x => ({ a: [...x.userData.bim.linha.a], b: [...x.userData.bim.linha.b] })) };
  }

  /** Paredes: o contorno das paredes ligadas à clicada, na face escolhida (fechado) ou a face da própria parede. */
  pickWalls(e) {
    const raw = this.worldAt(e);
    if (!raw) return null;
    const walls = this.viewer.elements().filter(x => x.userData.bim.wall && x.visible);
    const H = new Map(walls.map(w => [w, handlesOf(this.app, w)[0].l]));
    let best = null, bd = Infinity;
    for (const [w, l] of H) { const d = distToSeg(l, raw); if (d < bd && d < w.userData.bim.wall.thickness / 2 + 10 * this.pxSize(e)) { bd = d; best = w; } }
    if (!best) return null;
    // cadeia pelas pontas (só onde a ligação é única)
    const ends = new Map();
    for (const [w, l] of H) for (const p of [l.a, l.b]) { const k = key(p); if (!ends.has(k)) ends.set(k, []); ends.get(k).push(w); }
    const used = new Set([best]);
    const l0 = H.get(best);
    const pts = [l0.a, l0.b];
    for (const side of ['fim', 'inicio']) {
      for (;;) {
        const endP = side === 'fim' ? pts[pts.length - 1] : pts[0];
        const near = ends.get(key(endP)) || [];
        if (near.length !== 2) break;
        const nx = near.find(x => !used.has(x));
        if (!nx) break;
        used.add(nx);
        const l = H.get(nx), other = key(l.a) === key(endP) ? l.b : l.a;
        if (side === 'fim') pts.push(other); else pts.unshift(other);
      }
    }
    const t = best.userData.bim.wall.thickness;
    if (pts.length > 3 && key(pts[0]) === key(pts[pts.length - 1])) {
      pts.pop();
      const d = this.face === 'externa' ? t / 2 : this.face === 'interna' ? -t / 2 : 0;
      const loop = d ? offsetLoop(pts, d) : pts;
      return { segs: loop.map((p, i) => ({ a: p, b: loop[(i + 1) % loop.length] })), closed: true };
    }
    // paredes soltas: a linha da face do lado do clique (externa) ou do outro lado (interna)
    const L = H.get(best), dx = L.b[0] - L.a[0], dy = L.b[1] - L.a[1], len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const side = Math.sign((raw[0] - L.a[0]) * nx + (raw[1] - L.a[1]) * ny) || 1;
    const off = this.face === 'eixo' ? 0 : (this.face === 'externa' ? side : -side) * t / 2;
    return { segs: [{ a: [L.a[0] + nx * off, L.a[1] + ny * off], b: [L.b[0] + nx * off, L.b[1] + ny * off] }], closed: false };
  }

  /** Sólido: o contorno da face horizontal clicada. */
  pickSolid(e) {
    const st = this.app.sketchTool;
    const prev = st.edgeMode;
    st.edgeMode = 'face';
    let r;
    try { r = st.edgesAt(e); } finally { st.edgeMode = prev; }
    if (!r) return null;
    if (Math.abs(Math.abs(r.normal.z) - 1) > 1e-3) return { error: 'Clique numa face horizontal do sólido (topo ou base).' };
    return { segs: r.edges.map(([a, b]) => ({ a: [a.x, a.y], b: [b.x, b.y] })), z: r.point.z };
  }

  pick(e) {
    if (this.mode === 'linhas') return this.pickLines(e);
    if (this.mode === 'paredes') return this.pickWalls(e);
    if (this.mode === 'solido') return this.pickSolid(e);
    return null;
  }

  // ------------------------------------------------------------ eventos

  move(e) {
    this.lastEvent = e;
    this.redraw();
    const pr = document.querySelector('.center').getBoundingClientRect();
    if (this.mode === 'croqui') {
      const res = this.resolve(e);
      if (!res) { this.tip.hidden = true; return; }
      const last = this.pts[this.pts.length - 1];
      if (last && this.shape === 'linha') this.rubber([last, res.p]);
      if (last && this.shape === 'retangulo') this.rubber([last, [res.p[0], last[1]], res.p, [last[0], res.p[1]], last]);
      this.tip.textContent = last ? `${fmtLen(dist(last, res.p), { suffix: true })}` : 'clique o primeiro ponto';
      const s = this.toScreen(res.p), cr = this.viewer.renderer.domElement.getBoundingClientRect();
      this.marker.hidden = !res.snap;
      if (res.snap) Object.assign(this.marker.style, { left: `${s[0] + cr.left - pr.left}px`, top: `${s[1] + cr.top - pr.top}px` });
    } else {
      const r = this.pick(e);
      if (r?.segs) this.rubber(null, r.segs);
      this.tip.textContent = r?.error || (r?.segs ? `${r.segs.length} trecho(s) — clique para pôr no contorno` : 'aponte para ' + { linhas: 'uma linha 2D', paredes: 'uma parede', solido: 'a face de um sólido' }[this.mode]);
    }
    this.tip.hidden = false;
    Object.assign(this.tip.style, { left: `${e.clientX - pr.left + 16}px`, top: `${e.clientY - pr.top + 14}px` });
  }

  down(e) {
    if (e.button !== 0) return;
    if (this.mode === 'croqui') {
      const res = this.resolve(e);
      if (res) this.place(res.p);
      return;
    }
    const r = this.pick(e);
    if (!r || r.error) { if (r?.error) toast(r.error, 'error'); return; }
    // não repete trechos que já estão no contorno
    const have = new Set(this.allSegs().map(s => [key(s.a), key(s.b)].sort().join('|')));
    const segs = r.segs.filter(s => dist(s.a, s.b) > 1e-6 && !have.has([key(s.a), key(s.b)].sort().join('|')));
    if (!segs.length) { this.app.status('Esses trechos já estão no contorno.'); return; }
    this.groups.push({ segs });
    if (r.z !== undefined && this.atFace) this.faceZ = r.z;
    this.redraw(); this.sync();
  }

  place(p) {
    const last = this.pts[this.pts.length - 1];
    if (this.shape === 'retangulo') {
      if (!last) { this.pts = [p]; return; }
      if (Math.abs(p[0] - last[0]) < GRID || Math.abs(p[1] - last[1]) < GRID) return;
      const c = [last, [p[0], last[1]], p, [last[0], p[1]]];
      this.groups.push({ segs: c.map((q, i) => ({ a: q, b: c[(i + 1) % 4] })) });
      this.pts = [];
    } else {
      if (last && dist(last, p) < GRID / 2) return;
      if (last) this.groups.push({ segs: [{ a: last, b: p }] });
      const closing = this.pts.length > 2 && dist(p, this.pts[0]) < 1e-6;
      this.pts = closing ? [] : [...this.pts, p];
    }
    this.redraw(); this.sync();
  }

  key(e) {
    if (e.target.matches?.('input, select, textarea')) return;
    let done = true;
    if (e.key === 'Escape') { if (this.pts.length) this.pts = []; else this.stop(); }
    else if (e.key === 'Enter') { if (this.pts.length) this.pts = []; else this.finish(); }
    else if (e.key === 'Backspace') { if (this.pts.length) { this.pts.pop(); if (this.pts.length) this.groups.pop(); } else this.undo(); }
    else if ((e.key === 'c' || e.key === 'C') && this.pts.length > 2) this.place(this.pts[0]);
    else if (e.key === 'F8') this.app.wallTool.toggleOrtho();
    else done = false;
    if (done) { e.preventDefault(); e.stopPropagation(); if (this.active) { this.redraw(); this.sync(); } }
  }

  undo() { this.groups.pop(); if (!this.groups.some(g => g.z !== undefined)) this.faceZ = null; this.redraw(); this.sync(); }

  // ------------------------------------------------------------ desenho

  rubber(pts, segs) {
    const z = this.z + 0.01;
    const v = pts ? pts.map(p => new THREE.Vector3(p[0], p[1], z)) : segs.flatMap(s => [new THREE.Vector3(s.a[0], s.a[1], z), new THREE.Vector3(s.b[0], s.b[1], z)]);
    const line = pts ? new THREE.Line(new THREE.BufferGeometry().setFromPoints(v), RUBBER) : new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(v), RUBBER);
    line.computeLineDistances();
    this.group.add(line);
  }

  /** Contorno já montado (magenta), na cota do nível. */
  redraw() {
    for (const c of [...this.group.children]) { this.group.remove(c); c.geometry?.dispose(); }
    const segs = this.allSegs();
    if (!segs.length) return;
    const z = this.z + 0.01;
    const v = segs.flatMap(s => [new THREE.Vector3(s.a[0], s.a[1], z), new THREE.Vector3(s.b[0], s.b[1], z)]);
    this.group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(v), BOUND_MAT));
  }

  // ------------------------------------------------------------ concluir

  finish() {
    const segs = this.allSegs();
    if (!segs.length) { toast('Monte o contorno do piso primeiro (croqui, linhas, paredes ou sólido).', 'error'); return; }
    const { loops, chains } = chainSegments(segs);
    if (!loops.length) { toast(`O contorno não fechou (${chains.length} trecho(s) aberto(s)): as pontas precisam se encontrar.`, 'error'); return; }
    // topo: na cota da face do sólido (se veio de um e a opção está marcada) ou no nível; mais o deslocamento
    const useFace = this.faceZ !== null && this.atFace;
    const top = (useFace ? this.faceZ : this.z) + this.offset;
    const level = useFace ? this.app.levels.forZ(top) : this.level;
    const made = [];
    for (const { perfil, furos } of outerWithHoles(loops)) {
      if (Math.abs(area(perfil)) < 1e-6) continue;
      try {
        const el = createOnLevel('slab', {
          level: level.id, points: perfil.map(p => [+p[0].toFixed(6), +p[1].toFixed(6)]),
          holes: furos.map(hl => hl.map(p => [+p[0].toFixed(6), +p[1].toFixed(6)])),
          elevation: +(top - level.elevation).toFixed(6), ...(this.typeId ? { type: this.typeId } : {}),
        }, this.app.levels);
        el.userData.bim.name = el.name = `Piso ${this.viewer.elements().filter(x => x.userData.bim.slab).length + 1}`;
        this.viewer.add(el);
        made.push(el);
      } catch (err) { toast(err.message, 'error'); }
    }
    if (!made.length) return;
    const holes = made.reduce((s, el) => s + (el.userData.bim.slab.holes?.length || 0), 0);
    this.groups = []; this.pts = []; this.faceZ = null;
    this.redraw(); this.sync();
    this.app.refreshTree?.();
    this.app.status(`${made.length} piso(s) criado(s) com o topo em ${fmtElev(top)}${holes ? ` e ${holes} furo(s)` : ''}. Monte outro contorno ou Sair.`);
  }
}
