// PONTOS DO PISO (pontos de elevação): com o piso selecionado, DOIS CLIQUES COM UMA PAUSA no piso (ou Propriedades ›
// Pontos de elevação) mostram os pontos do contorno e os de forma (como "Editar forma" do piso no Revit). O clique
// duplo rápido edita o contorno com linhas 2D (floor-sketch.js).
//   arrastar um ponto ......... move o ponto (snap nos pontos de outros pisos e nas pontas de paredes/linhas; ORTO/F8
//                               ou Shift trava 0°/90° em relação ao ponto anterior)
//   arrastar o "+" de um lado .. coloca um ponto novo no contorno
//   clicar num ponto ........... digita a ALTURA do ponto (deslocamento em relação ao topo do piso): o piso inclina
//   botão direito no ponto ..... apaga o ponto (o contorno fica com pelo menos 3)
//   ＋ Ponto interno ............ clique dentro do piso para colocar um ponto de forma (rampa, caimento, ralo…)
//   medida de cada lado ........ aparece na tela (como no Editar piso); clique nela para digitar o comprimento
//   furos ...................... pontos, "+" e medidas também nos furos (botão direito no último ponto apaga o furo)
//   Edição 2D (Propriedades) ... Canto com raio ou chanfro (clique no ponto), canto vivo (clique no "+" do lado) e
//                                Offset do contorno — como as ferramentas 2D, direto no piso
// Dados: slab.points (contorno), slab.alturas[i] (altura de cada ponto do contorno), slab.forma [[x, y, dz], …].
import * as THREE from 'three';
import { h, toast } from './ui.js';
import { rebuildElement, slabShapeFn } from './elements.js';
import { slopeConfig } from './slopes.js';
import { fmtLen, fromUnit, toUnit, unitLabel, unitStep } from './units.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const SNAP_PX = 12;
const GRID = 0.01;
const svg = (tag, attrs = {}) => { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
const round6 = v => +v.toFixed(6);
const fmtDz = v => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmtLen(Math.abs(v))}`;

/** Ponto dentro do polígono (par-ímpar). */
function inside([x, y], poly) {
  let r = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) r = !r;
  }
  return r;
}

const polyArea = pts => Math.abs(pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);


// ---------------------------------------------------------------- edição 2D do contorno (canto e offset)

const sub2 = (a, b) => [a[0] - b[0], a[1] - b[1]];
const len2 = v => Math.hypot(v[0], v[1]);
const signedArea = pts => pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;

/** Pontos que substituem o vértice P (entre A e B) num canto de RAIO (arco) ou CHANFRO. null se não cabe. */
function cornerPoints(A, P, B, mode, value) {
  const u1 = sub2(A, P), u2 = sub2(B, P), l1 = len2(u1), l2 = len2(u2);
  if (l1 < 1e-9 || l2 < 1e-9) return null;
  u1[0] /= l1; u1[1] /= l1; u2[0] /= l2; u2[1] /= l2;
  const cos = Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1])), th = Math.acos(cos);
  if (th < 1e-3 || Math.PI - th < 1e-3) return null; // lados alinhados: não há canto
  const t = mode === 'chanfro' ? value : value / Math.tan(th / 2); // recuo em cada lado
  if (!(t > 1e-6) || t > l1 + 1e-9 || t > l2 + 1e-9) return null;
  const T1 = [P[0] + u1[0] * t, P[1] + u1[1] * t], T2 = [P[0] + u2[0] * t, P[1] + u2[1] * t];
  if (mode === 'chanfro') return [T1, T2];
  // arco de T1 a T2 com centro na bissetriz
  const bis = [u1[0] + u2[0], u1[1] + u2[1]], lb = len2(bis);
  const dc = value / Math.sin(th / 2), C = [P[0] + bis[0] / lb * dc, P[1] + bis[1] / lb * dc];
  const a1 = Math.atan2(T1[1] - C[1], T1[0] - C[0]);
  let da = Math.atan2(T2[1] - C[1], T2[0] - C[0]) - a1;
  while (da > Math.PI) da -= 2 * Math.PI;
  while (da < -Math.PI) da += 2 * Math.PI;
  const n = Math.max(2, Math.ceil(Math.abs(da) / (Math.PI / 16)));
  return Array.from({ length: n + 1 }, (_, k) => [C[0] + value * Math.cos(a1 + da * k / n), C[1] + value * Math.sin(a1 + da * k / n)]);
}

/** Canto VIVO num lado (i → i+1): os lados vizinhos se estendem até se encontrar e o lado some. null se paralelos. */
function sharpEdge(ring, i) {
  const n = ring.length;
  const A = ring[(i - 1 + n) % n], P = ring[i], Q = ring[(i + 1) % n], B = ring[(i + 2) % n];
  const d1 = sub2(P, A), d2 = sub2(Q, B), den = d1[0] * d2[1] - d1[1] * d2[0];
  if (Math.abs(den) < 1e-12) return null;
  const w = sub2(B, A), t = (w[0] * d2[1] - w[1] * d2[0]) / den;
  return [A[0] + d1[0] * t, A[1] + d1[1] * t];
}

/** Contorno fechado deslocado de d (positivo = para fora), cantos em esquadria. */
function offsetRing(ring, d) {
  const n = ring.length, ccw = signedArea(ring) > 0;
  const lines = ring.map((a, i) => {
    const b = ring[(i + 1) % n], v = sub2(b, a), L = len2(v) || 1;
    let nx = v[1] / L, ny = -v[0] / L; // à direita do sentido
    if (!ccw) { nx = -nx; ny = -ny; }   // "para fora" depende do sentido do contorno
    return [[a[0] + nx * d, a[1] + ny * d], [b[0] + nx * d, b[1] + ny * d]];
  });
  return lines.map((l, i) => {
    const p = lines[(i - 1 + n) % n], d1 = sub2(p[1], p[0]), d2 = sub2(l[1], l[0]), den = d1[0] * d2[1] - d1[1] * d2[0];
    if (Math.abs(den) < 1e-12) return l[0];
    const w = sub2(l[0], p[0]), t = (w[0] * d2[1] - w[1] * d2[0]) / den;
    return [p[0][0] + d1[0] * t, p[0][1] + d1[1] * t];
  });
}

export class FloorPoints {
  constructor(app) {
    this.app = app;
    this.el = null;
    this.drag = null;
    this.placing = false;
    this.handles = [];   // [{ dom, kind: 'v'|'m'|'f', i }]
    const center = document.querySelector('.center');
    this.svg = svg('svg', { class: 'grips-svg' });
    this.outline = svg('path', { class: 'floor-outline' });
    this.holesPath = svg('path', { class: 'floor-outline hole' });
    this.svg.append(this.outline, this.holesPath);
    this.labels = h('div');
    this.lens = h('div');       // medidas dos lados (clicáveis)
    this.lenPool = [];
    this.box = h('div', { class: 'grips floor-grips', hidden: true }, this.svg, this.lens, this.labels);
    this.tip = h('div', { class: 'draw-tip', hidden: true });
    this.marker = h('div', { class: 'snap-marker', hidden: true });
    center.append(this.box, this.tip, this.marker);
    app.viewer.addEventListener('select', () => this.refresh());
    app.viewer.frameHooks.push(() => this.update());
    addEventListener('pointermove', e => this.onMove(e));
    addEventListener('pointerup', e => this.endDrag(e));
    this._place = e => this.placeAt(e);
    this._esc = e => { if (e.key === 'Escape' && this.placing) { e.stopPropagation(); this.stopPlacing(); } };
    this.tool2d = null; // { mode: 'raio' | 'chanfro' | 'vivo', value } — próximo clique num ponto/lado aplica
    this.corner = { mode: 'raio', value: 1 };
    this.offsetValue = 0.5;
    this._esc2d = e => { if (e.key === 'Escape' && this.tool2d) { e.stopPropagation(); this.stopTool2d(); } };
    this.pointsFor = null; // GUID do piso com os pontos de elevação à mostra
    // dois cliques com uma pausa no piso já selecionado: mostra os pontos (o clique duplo rápido cancela)
    const cv = app.viewer.renderer.domElement;
    cv.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      this._down = { x: e.clientX, y: e.clientY, sel: this.el ? this.el.userData.bim.guid : null };
    });
    cv.addEventListener('click', e => {
      const d = this._down;
      this._down = null;
      if (!d || !d.sel || this.viewer.tool || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return;
      const obj = this.viewer.pickAt(e.clientX, e.clientY);
      if (obj?.userData.bim?.guid !== d.sel || !obj.userData.bim.slab) return;
      this.cancelSlowClick();
      this._slow = setTimeout(() => { this._slow = 0; this.showPoints(obj); }, 320);
    });
    cv.addEventListener('dblclick', () => this.cancelSlowClick());
  }

  get viewer() { return this.app.viewer; }

  cancelSlowClick() { if (this._slow) { clearTimeout(this._slow); this._slow = 0; } }

  /** Mostra os pontos de elevação do piso na vista. */
  showPoints(el) {
    el = this.live(el);
    if (!el?.userData.bim?.slab) return;
    if (!this.viewer.selected.has(el)) this.viewer.select([el]);
    this.pointsFor = el.userData.bim.guid;
    this.refresh();
    this.app.status('Pontos de elevação do piso · arraste os pontos · clique num ponto para a altura · "+" coloca ponto · botão direito apaga.');
  }

  /** O elemento pode ter sido refeito pela sincronização (outro objeto, mesmo GUID): usa o que está no modelo. */
  live(el) {
    if (!el || el.parent) return el;
    return this.viewer.elements().find(x => x.userData.bim?.guid === el.userData.bim.guid) || el;
  }

  /** Comando da faixa: com um piso selecionado, entra direto em "colocar ponto interno". */
  start() {
    const sel = [...this.viewer.selected];
    if (sel.length !== 1 || !sel[0].userData.bim?.slab) {
      toast('Selecione um piso para editar os pontos.', 'error');
      return;
    }
    this.app.showTab?.('props');
    this.pointsFor = sel[0].userData.bim.guid;
    this.startPlacing();
  }

  refresh() {
    const sel = [...this.viewer.selected];
    const el = sel.length === 1 && sel[0].userData.bim?.slab ? sel[0] : null;
    if (el !== this.el && !(el && this.el && el.userData.bim.guid === this.el.userData.bim.guid)) { this.stopPlacing(); this.cancelType(); this.stopTool2d(); }
    if (!el || el.userData.bim.guid !== this.pointsFor) this.pointsFor = null; // outro piso (ou nada): esconde os pontos
    this.el = el;
    this.rebuildHandles();
    this.update();
  }

  /** Recria os pontos na tela (quando o número de pontos muda). */
  rebuildHandles() {
    for (const hd of this.handles) hd.dom.remove();
    this.handles = [];
    if (!this.el) { this.box.hidden = true; return; }
    const s = this.el.userData.bim.slab;
    const add = (kind, i, cls, title, r = 0) => {
      const dom = h('div', { class: `grip-point ${cls}`, title });
      dom.addEventListener('pointerdown', e => this.startDrag(e, kind, i, r));
      dom.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); this.remove(kind, i, r); });
      this.box.append(dom);
      this.handles.push({ dom, kind, i, r });
    };
    s.points.forEach((_, i) => add('v', i, '', 'Ponto do contorno: arraste para mover · clique para a altura · botão direito apaga'));
    s.points.forEach((_, i) => add('m', i, 'floor-add', 'Arraste para colocar um ponto novo neste lado'));
    (s.forma || []).forEach((_, i) => add('f', i, 'floor-shape', 'Ponto de forma: arraste para mover · clique para a altura · botão direito apaga'));
    (s.holes || []).forEach((hl, k) => {
      hl.forEach((_, i) => add('h', i, 'floor-hole-pt', 'Ponto do furo: arraste para mover · botão direito apaga (com 3 pontos, apaga o furo)', k + 1));
      hl.forEach((_, i) => add('hm', i, 'floor-add', 'Arraste para colocar um ponto novo neste lado do furo', k + 1));
    });
  }

  /** Pontos de um contorno: 0 = o externo, 1… = os furos. */
  ring(s, r) { return r ? s.holes[r - 1] : s.points; }

  /** Quantos pontos tem cada contorno (para saber quando refazer as alças). */
  shapeKey(s) { return [s.points.length, (s.forma || []).length, ...(s.holes || []).map(hl => hl.length)].join(','); }

  /** Ponto no modelo de cada alça. */
  world(kind, i, el = this.el, r = 0) {
    const s = el.userData.bim.slab, al = s.alturas || [];
    let p, dz;
    if (kind === 'h' || kind === 'hm') {
      const ring = this.ring(s, r), a = ring[i], b = ring[(i + 1) % ring.length];
      p = kind === 'h' ? a : [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const f = slabShapeFn(s);
      dz = f ? f(p[0], p[1]) : 0;
      return new THREE.Vector3(p[0], p[1], s.elevation + dz).applyMatrix4(el.matrixWorld);
    }
    if (kind === 'v') { p = s.points[i]; dz = al[i] || 0; }
    else if (kind === 'f') { p = s.forma[i]; dz = p[2] || 0; }
    else {
      const a = s.points[i], b = s.points[(i + 1) % s.points.length];
      p = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      dz = ((al[i] || 0) + (al[(i + 1) % s.points.length] || 0)) / 2;
    }
    return new THREE.Vector3(p[0], p[1], s.elevation + dz).applyMatrix4(el.matrixWorld);
  }

  screen(v) {
    const c = this.viewer.renderer.domElement, r = c.getBoundingClientRect(), pr = this.box.parentElement.getBoundingClientRect();
    const p = v.clone().project(this.viewer.camera);
    return { x: (p.x + 1) / 2 * r.width + r.left - pr.left, y: (1 - p.y) / 2 * r.height + r.top - pr.top, behind: p.z > 1, cx: (p.x + 1) / 2 * r.width + r.left, cy: (1 - p.y) / 2 * r.height + r.top };
  }

  /** A cada quadro: os pontos acompanham a câmera. */
  update() {
    const el = this.el;
    const show = el && el.parent && el.visible && !this.viewer.tool && !this.viewer.renderOverride
      && (this.pointsFor === el.userData.bim.guid || this.tool2d || this.placing);
    if (!show) { if (!this.box.hidden) this.box.hidden = true; return; }
    const s = el.userData.bim.slab;
    if (this._key !== this.shapeKey(s)) { this._key = this.shapeKey(s); this.rebuildHandles(); }
    el.updateMatrixWorld(true);
    this.box.hidden = false;
    let d = '', dh = '';
    const labels = [];
    const pts = new Map(); // tela de cada ponto dos contornos, para as medidas
    for (const hd of this.handles) {
      const sc = this.screen(this.world(hd.kind, hd.i, el, hd.r));
      hd.dom.hidden = sc.behind;
      hd.dom.style.transform = `translate(${sc.x}px, ${sc.y}px)`;
      if (hd.kind === 'v') d += `${hd.i ? 'L' : 'M'}${sc.x} ${sc.y}`;
      if (hd.kind === 'h') dh += `${hd.i ? 'L' : (dh ? 'ZM' : 'M')}${sc.x} ${sc.y}`;
      if (hd.kind === 'v' || hd.kind === 'h') pts.set(`${hd.r}:${hd.i}`, sc);
      const dz = hd.kind === 'v' ? s.alturas?.[hd.i] : hd.kind === 'f' ? s.forma[hd.i][2] : 0;
      if (dz && !sc.behind) labels.push(h('div', { class: 'floor-dz', style: `transform: translate(${sc.x + 9}px, ${sc.y - 20}px)` }, fmtDz(dz)));
    }
    this.outline.setAttribute('d', d ? `${d}Z` : '');
    this.holesPath.setAttribute('d', dh ? `${dh}Z` : '');
    if (!this.typing) this.labels.replaceChildren(...labels);
    this.updateLengths(s, pts);
  }

  /** Medida de cada lado (contorno e furos), do lado de fora do contorno (dentro do furo), alinhada com o lado. */
  updateLengths(s, pts) {
    let n = 0;
    const rings = [s.points, ...(s.holes || [])];
    rings.forEach((ring, r) => {
      const scr = ring.map((_, i) => pts.get(`${r}:${i}`)).filter(Boolean);
      if (scr.length !== ring.length) return;
      const cx = scr.reduce((a, p) => a + p.x, 0) / scr.length, cy = scr.reduce((a, p) => a + p.y, 0) / scr.length;
      ring.forEach((a, i) => {
        const b = ring[(i + 1) % ring.length], A = scr[i], B = scr[(i + 1) % ring.length];
        const Ls = Math.hypot(B.x - A.x, B.y - A.y);
        if (A.behind || B.behind || Ls < 36) return;
        let nx = -(B.y - A.y) / Ls, ny = (B.x - A.x) / Ls;
        const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
        const away = (mx - cx) * nx + (my - cy) * ny > 0;
        if (r ? away : !away) { nx = -nx; ny = -ny; } // contorno: para fora · furo: para dentro do furo
        let ang = Math.atan2(B.y - A.y, B.x - A.x) * 180 / Math.PI;
        if (ang > 90) ang -= 180; else if (ang < -90) ang += 180;
        const lab = this.lenPool[n] || (this.lenPool[n] = this.lenLabel());
        if (!lab.isConnected) this.lens.append(lab);
        lab._edge = { r, i };
        if (!(this.typingLen && this.typingLen.lab === lab)) lab.textContent = fmtLen(Math.hypot(b[0] - a[0], b[1] - a[1]));
        Object.assign(lab.style, { left: `${mx + nx * 13}px`, top: `${my + ny * 13}px`, transform: `translate(-50%, -50%) rotate(${ang}deg)` });
        lab.hidden = false;
        n++;
      });
    });
    for (let k = n; k < this.lenPool.length; k++) if (!(this.typingLen && this.typingLen.lab === this.lenPool[k])) this.lenPool[k].hidden = true;
  }

  lenLabel() {
    const lab = h('button', { class: 'grip-label floor-len', title: 'Clique para digitar o comprimento deste lado (a ponta final anda na direção do lado)' });
    lab.addEventListener('pointerdown', e => e.stopPropagation());
    lab.addEventListener('click', e => { e.stopPropagation(); if (lab._edge && !this.typingLen) this.typeLength(lab, lab._edge.r, lab._edge.i); });
    return lab;
  }

  /** Digita o comprimento de um lado: a primeira ponta fica, a segunda anda na direção do lado. */
  typeLength(lab, r, i) {
    const el = this.el = this.live(this.el);
    if (!el || this.typingLen) return;
    const s = el.userData.bim.slab, ring = this.ring(s, r), a = ring[i], b = ring[(i + 1) % ring.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const input = h('input', { type: 'number', step: unitStep(), min: 0, value: toUnit(+L.toFixed(4)), class: 'grip-input', title: `Comprimento (${unitLabel()}). Enter confirma, Esc cancela.` });
    this.typingLen = { lab };
    lab.replaceChildren(input);
    input.focus(); input.select();
    const done = ok => {
      if (!this.typingLen) return;
      this.typingLen = null;
      const v = fromUnit(input.value);
      lab.textContent = fmtLen(L);
      if (!ok || !(v > 0.005) || L < 1e-9) return;
      const cur = this.live(el), cs = cur.userData.bim.slab, cr = this.ring(cs, r), p0 = cr[i];
      cr[(i + 1) % cr.length] = [round6(p0[0] + (b[0] - a[0]) / L * v), round6(p0[1] + (b[1] - a[1]) / L * v)];
      this.commit(cur);
      this.app.status(`Lado com ${fmtLen(v, { suffix: true })}.`);
    };
    input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') done(true); else if (e.key === 'Escape') done(false); });
    input.addEventListener('blur', () => done(true));
    input.addEventListener('click', e => e.stopPropagation());
  }

  // ------------------------------------------------------------ arrastar

  startDrag(e, kind, i, r = 0) {
    if (e.button !== 0 || !this.el) return;
    e.preventDefault(); e.stopPropagation();
    if (this.tool2d) { this.apply2d(kind, i, r); return; }
    const el = this.el = this.live(this.el), s = el.userData.bim.slab;
    el.updateMatrixWorld(true);
    const inv = el.matrixWorld.clone().invert();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 0, 1).transformDirection(el.matrixWorld), this.world(kind, i, el, r));
    const toData = v => { const q = v.clone().applyMatrix4(inv); return [q.x, q.y]; };
    if (kind === 'm') {
      // "+" de um lado: entra um ponto novo no contorno (altura = média dos vizinhos) e já começa a arrastá-lo
      const a = s.points[i], b = s.points[(i + 1) % s.points.length];
      s.points.splice(i + 1, 0, [round6((a[0] + b[0]) / 2), round6((a[1] + b[1]) / 2)]);
      if (s.alturas) s.alturas.splice(i + 1, 0, round6(((s.alturas[i] || 0) + (s.alturas[(i + 1) % (s.points.length - 1)] || 0)) / 2));
      kind = 'v'; i += 1;
      this.rebuildHandles(); this._key = this.shapeKey(s);
      this.dirty = true;
    }
    if (kind === 'hm') {
      // "+" de um lado do furo: ponto novo no furo
      const ring = this.ring(s, r), a = ring[i], b = ring[(i + 1) % ring.length];
      ring.splice(i + 1, 0, [round6((a[0] + b[0]) / 2), round6((a[1] + b[1]) / 2)]);
      kind = 'h'; i += 1;
      this.rebuildHandles(); this._key = this.shapeKey(s);
      this.dirty = true;
    }
    const ringOf = kind === 'v' ? s.points : kind === 'h' ? this.ring(s, r) : null;
    const prev = ringOf ? ringOf[(i - 1 + ringOf.length) % ringOf.length] : null;
    this.drag = { kind, i, r, el, plane, toData, prev, start: [e.clientX, e.clientY], moved: !!this.dirty, snaps: this.snapCandidates(el) };
    this.dirty = false;
    this.viewer.controls.enabled = false;
  }

  /** Pontos de outros pisos e pontas de paredes, vigas e linhas (no modelo) para o snap. */
  snapCandidates(except) {
    const out = this.app.grips?.snapCandidates(except) || [];
    for (const e of this.viewer.elements()) {
      if (e === except || !e.visible || !e.userData.bim?.slab) continue;
      e.updateMatrixWorld(true);
      e.userData.bim.slab.points.forEach((_, i) => out.push(this.world('v', i, e)));
    }
    return out;
  }

  onMove(e) {
    const d = this.drag;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.start[0], e.clientY - d.start[1]) < 4) return; // ainda é um clique
    const r = this.viewer.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.viewer.camera);
    const hit = ray.ray.intersectPlane(d.plane, new THREE.Vector3());
    if (!hit) return;
    let p = d.toData(hit), snapped = false, best = SNAP_PX;
    for (const c of d.snaps) {
      const sc = this.screen(c);
      const dd = Math.hypot(sc.cx - e.clientX, sc.cy - e.clientY);
      if (dd < best) { best = dd; p = d.toData(c); snapped = true; }
    }
    if (!snapped) {
      if (d.prev && this.app.wallTool.ortho !== !!e.shiftKey) {
        const dx = p[0] - d.prev[0], dy = p[1] - d.prev[1];
        p = Math.abs(dx) >= Math.abs(dy) ? [p[0], d.prev[1]] : [d.prev[0], p[1]];
      }
      p = p.map(v => Math.round(v / GRID) * GRID);
    }
    p = p.map(round6);
    const s = d.el.userData.bim.slab;
    if (d.kind === 'v') s.points[d.i] = p;
    else if (d.kind === 'h') this.ring(s, d.r)[d.i] = p;
    else s.forma[d.i] = [p[0], p[1], s.forma[d.i][2] || 0];
    d.moved = true;
    this.rebuild(d.el, true);
    const pr = this.box.parentElement.getBoundingClientRect();
    const sc = this.screen(this.world(d.kind, d.i, d.el, d.r));
    this.marker.hidden = !snapped;
    if (snapped) Object.assign(this.marker.style, { left: `${sc.x}px`, top: `${sc.y}px` });
    this.tip.textContent = d.prev ? `${fmtLen(Math.hypot(p[0] - d.prev[0], p[1] - d.prev[1]), { suffix: true })}${snapped ? '  ◻ ponto' : ''}` : (snapped ? '◻ ponto' : 'ponto de forma');
    Object.assign(this.tip.style, { left: `${e.clientX - pr.left + 16}px`, top: `${e.clientY - pr.top + 14}px` });
    this.tip.hidden = false;
  }

  endDrag() {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    this.viewer.controls.enabled = true;
    this.tip.hidden = true; this.marker.hidden = true;
    if (d.moved) {
      const s = d.el.userData.bim.slab;
      if (d.kind === 'f' && !inside(s.forma[d.i], s.points)) toast('O ponto de forma ficou fora do contorno do piso: ele só vale dentro.', 'info');
      // refeito pela sincronização durante o arraste: o que foi arrastado vai para o elemento que está no modelo
      const cur = this.live(d.el);
      if (cur !== d.el) cur.userData.bim.slab = structuredClone(s);
      this.commit(cur);
    } else if (d.kind === 'v' || d.kind === 'f') this.typeHeight(d.kind, d.i);
  }

  /** Refaz a geometria (live = durante o arraste: no máximo uma vez por quadro, sem esperar o script). */
  rebuild(el, live = false) {
    if (live) {
      if (this._raf) return Promise.resolve();
      this._raf = requestAnimationFrame(() => { this._raf = 0; rebuildElement(el); this.viewer._highlight(el, true); });
      return Promise.resolve();
    }
    rebuildElement(el);
    this.viewer._highlight(el, true);
    return this.app.system.pending(el).then(() => { if (this.viewer.selected.has(el)) this.viewer._highlight(el, true); });
  }

  async commit(el) {
    el = this.live(el);
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
    const s = el.userData.bim.slab, P = el.userData.bim.props ||= {};
    // limpa: alturas zeradas não ficam guardadas
    if (s.alturas && !s.alturas.some(v => v)) delete s.alturas;
    if (s.forma && !s.forma.length) delete s.forma;
    const holes = (s.holes || []).reduce((a, hl) => a + polyArea(hl), 0);
    P.Area = +(polyArea(s.points) - holes).toFixed(3);
    if (s.alturas || s.forma) P.Forma = `${(s.alturas || []).filter(v => v).length + (s.forma || []).length} ponto(s) com altura`;
    else delete P.Forma;
    if (s.terreno) P.Terreno = 'sim (só a superfície segue os pontos; cortado pelos outros pisos)'; else delete P.Terreno;
    try { await this.rebuild(el); } catch (err) { toast(err.message, 'error'); }
    this.viewer._prepare2D(el);
    this.viewer.changed();
    this.app.renderProps();
  }

  remove(kind, i, r = 0) {
    const el = this.live(this.el);
    if (!el || kind === 'm' || kind === 'hm') return;
    const s = el.userData.bim.slab;
    if (kind === 'h') {
      const ring = this.ring(s, r);
      if (ring.length <= 3) { s.holes.splice(r - 1, 1); if (!s.holes.length) delete s.holes; this.app.status('Furo apagado.'); }
      else ring.splice(i, 1);
    } else if (kind === 'v') {
      if (s.points.length <= 3) { toast('O contorno do piso precisa de pelo menos 3 pontos.', 'error'); return; }
      s.points.splice(i, 1);
      s.alturas?.splice(i, 1);
    } else s.forma.splice(i, 1);
    this.rebuildHandles();
    this.commit(el);
  }

  // ------------------------------------------------------------ edição 2D (canto e offset)

  startTool2d(el) {
    this.el = this.live(el);
    this.pointsFor = this.el.userData.bim.guid;
    this.tool2d = { ...this.corner };
    document.addEventListener('keydown', this._esc2d, true);
    this.app.status(this.tool2d.mode === 'vivo'
      ? 'Canto vivo · clique no "+" de um lado do piso: os lados vizinhos se estendem até se encontrar · Esc termina.'
      : `Canto ${this.tool2d.mode === 'raio' ? `com raio ${fmtLen(this.tool2d.value, { suffix: true })}` : `chanfrado ${fmtLen(this.tool2d.value, { suffix: true })}`} · clique nos pontos (cantos) do piso · Esc termina.`);
    this.app.renderProps();
  }

  stopTool2d() {
    if (!this.tool2d) return;
    this.tool2d = null;
    document.removeEventListener('keydown', this._esc2d, true);
    this.app.status('Pronto.');
    if (this.el) this.app.renderProps();
  }

  /** Aplica o canto no ponto (raio/chanfro) ou no lado (vivo) clicado. */
  apply2d(kind, i, r) {
    const el = this.el = this.live(this.el), s = el.userData.bim.slab, t = this.tool2d;
    const ring = this.ring(s, r), n = ring.length, outer = !r;
    if (t.mode === 'vivo') {
      if (kind !== 'm' && kind !== 'hm') { toast('Canto vivo: clique no "+" do lado que deve sumir.', 'error'); return; }
      if (n <= 3) { toast('O contorno precisa de pelo menos 3 pontos.', 'error'); return; }
      const X = sharpEdge(ring, i);
      if (!X) { toast('Os lados vizinhos são paralelos: não se encontram.', 'error'); return; }
      const j = (i + 1) % n;
      ring[i] = X.map(round6);
      ring.splice(j, 1);
      if (outer && s.alturas) { s.alturas[i] = round6(((s.alturas[i] || 0) + (s.alturas[j] || 0)) / 2); s.alturas.splice(j, 1); }
    } else {
      if (kind !== 'v' && kind !== 'h') { toast('Canto: clique num ponto (canto) do piso.', 'error'); return; }
      const pts = cornerPoints(ring[(i - 1 + n) % n], ring[i], ring[(i + 1) % n], t.mode, t.value);
      if (!pts) { toast(`Não cabe: ${t.mode === 'raio' ? 'raio' : 'chanfro'} de ${fmtLen(t.value, { suffix: true })} é maior que os lados (ou os lados estão alinhados).`, 'error'); return; }
      ring.splice(i, 1, ...pts.map(p => p.map(round6)));
      if (outer && s.alturas) s.alturas.splice(i, 1, ...pts.map(() => s.alturas[i] || 0));
    }
    this.rebuildHandles(); this._key = this.shapeKey(s);
    this.commit(el);
  }

  /**
   * Canto entre dois lados (i e j) do mesmo contorno do piso, como o Canto das linhas 2D: os dois lados se estendem
   * até se encontrar (somem os lados entre eles, pelo caminho mais curto) e, com raio ou chanfro, o canto é arredondado
   * ou chanfrado. opts = { modo: 'vivo'|'raio'|'chanfro', raio, distancia }.
   */
  cornerEdges(el, r, i, j, opts) {
    el = this.live(el);
    const s = el.userData.bim.slab, ring = this.ring(s, r), n = ring.length;
    const P = k => ring[((k % n) + n) % n];
    // encontro das retas dos dois lados
    const meet = (u, w) => {
      const A = P(u), A2 = P(u + 1), B = P(w), B2 = P(w + 1);
      const d1 = [A2[0] - A[0], A2[1] - A[1]], d2 = [B2[0] - B[0], B2[1] - B[1]], den = d1[0] * d2[1] - d1[1] * d2[0];
      if (Math.abs(den) < 1e-12) return null;
      const t = ((B[0] - A[0]) * d2[1] - (B[1] - A[1]) * d2[0]) / den;
      return [A[0] + d1[0] * t, A[1] + d1[1] * t];
    };
    const X = meet(i, j);
    if (!X) throw new Error('Os dois lados são paralelos: não se encontram.');
    // somem os pontos do lado do encontro: entre os dois caminhos, o que tem os pontos mais perto de X
    const far = (u, w) => { let m = 0; for (let k = u + 1; k !== w + 1 + (w < u ? n : 0); k++) m = Math.max(m, Math.hypot(P(k)[0] - X[0], P(k)[1] - X[1])); return m; };
    if (far(j, i + (i < j ? n : 0)) < far(i, j + (j < i ? n : 0))) [i, j] = [j, i];
    const between = (j - i - 1 + n) % n; // lados entre os dois
    // novo contorno: de j+1 até i (inclusive) e o encontro X no lugar dos pontos i+1…j
    const keep = [];
    for (let k = 0; k < n - (between + 1); k++) keep.push(((j + 1 + k) % n + n) % n);
    if (keep.length + 1 < 3) throw new Error('O contorno ficaria com menos de 3 pontos.');
    const f = slabShapeFn(s), alt = s.alturas;
    const pts = keep.map(k => ring[k]);
    const ins = (opts.modo === 'raio' || opts.modo === 'chanfro')
      ? cornerPoints(pts[pts.length - 1], X, pts[0], opts.modo, opts.modo === 'raio' ? opts.raio : opts.distancia)
      : [X];
    if (!ins) throw new Error(`Não cabe: ${opts.modo === 'raio' ? `raio de ${fmtLen(opts.raio, { suffix: true })}` : `chanfro de ${fmtLen(opts.distancia, { suffix: true })}`} é maior que os lados.`);
    const next = [...pts, ...ins].map(p => p.map(round6));
    if (!r && alt) s.alturas = [...keep.map(k => alt[k] || 0), ...ins.map(p => round6(f ? f(p[0], p[1]) : 0))];
    if (r) s.holes[r - 1] = next; else s.points = next;
    this.rebuildHandles(); this._key = this.shapeKey(s);
    return this.commit(el);
  }

  /** Offset do contorno externo (positivo = para fora). */
  offsetOutline(el, d) {
    el = this.live(el);
    const s = el.userData.bim.slab;
    const out = offsetRing(s.points, d);
    if (Math.abs(signedArea(out)) < 1e-4 || Math.sign(signedArea(out)) !== Math.sign(signedArea(s.points))) { toast('O offset para dentro é maior que o piso.', 'error'); return; }
    s.points = out.map(p => p.map(round6));
    this.commit(el);
    this.app.status(`Offset de ${fmtLen(d, { suffix: true })} no contorno do piso.`);
  }

  /** Liga/desliga o modo Terreno do piso. */
  setTerrain(el, on) {
    el = this.live(el);
    const s = el.userData.bim.slab;
    if (on) s.terreno = true; else delete s.terreno;
    this.commit(el);
    this.app.status(on ? 'Terreno: só a superfície segue os pontos e os outros pisos cortam o terreno.' : 'Piso comum (não é mais terreno).');
  }

  /** Seção "Talude" nas propriedades do piso: corte e aterro, cada um com proporção, altura das instâncias e berma. */
  slopeSection(el) {
    const s = el.userData.bim.slab, cfg = slopeConfig(s);
    const save = patch => {
      const cur = this.live(el), cs = cur.userData.bim.slab;
      cs.talude = { ...slopeConfig(cs), ...patch };
      this.commit(cur);
    };
    const u = unitLabel();
    const part = (key, title) => {
      const c = cfg[key];
      const set = (k, v) => save({ [key]: { ...c, [k]: v } });
      const num = (val, onset, attrs = {}) => h('input', { type: 'number', step: 'any', value: val, style: 'width:100%', ...attrs, onchange: e => { const x = Number(e.target.value); if (Number.isFinite(x)) onset(x); } });
      return h('table', { class: 'slope-table' },
        h('tr', {}, h('td', { colspan: 2 }, h('label', { class: 'inline' },
          h('input', { type: 'checkbox', checked: c.ativo, onchange: e => set('ativo', e.target.checked) }), h('strong', {}, title)))),
        h('tr', { title: 'Proporção do trecho inclinado: vertical : horizontal (1 : 1,5 sobe 1 a cada 1,5)' }, h('td', {}, 'Proporção V : H'),
          h('td', {}, h('div', { class: 'slope-ratio' }, num(c.v, x => x > 0 && set('v', x), { min: 0.01 }), h('span', {}, ':'), num(c.h, x => x > 0 && set('h', x), { min: 0.01 })))),
        h('tr', { title: 'Altura de cada instância (trecho inclinado). 0 = um talude contínuo, sem bermas' }, h('td', {}, `Altura da instância (${u})`),
          h('td', {}, num(toUnit(c.altura), x => set('altura', Math.max(0, fromUnit(x))), { min: 0, step: unitStep() }))),
        h('tr', { title: 'Distância horizontal (berma, plana) entre uma instância e a próxima' }, h('td', {}, `Distância entre instâncias (${u})`),
          h('td', {}, num(toUnit(c.berma), x => set('berma', Math.max(0, fromUnit(x))), { min: 0, step: unitStep() }))));
    };
    return [
      h('h4', {}, 'Talude'),
      h('label', { class: 'inline', title: 'O terreno em volta do piso é cortado ou aterrado em talude até encontrar o piso (na cota do topo dele)' },
        h('input', { type: 'checkbox', checked: cfg.ativo, onchange: e => save({ ativo: e.target.checked }) }), 'Talude em volta do piso'),
      cfg.ativo ? h('div', { class: 'small muted' }, 'Vale nos terrenos em volta: acima do piso o terreno é cortado, abaixo é aterrado.') : null,
      cfg.ativo ? h('table', { class: 'slope-table' }, h('tr', { title: 'Arredonda a crista, o pé, as bordas das bermas e o encontro com o terreno natural' },
        h('td', {}, h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: cfg.suavizar, onchange: e => save({ suavizar: e.target.checked }) }), `Suavizar · raio (${u})`)),
        h('td', {}, h('input', { type: 'number', min: 0, step: unitStep(), value: toUnit(cfg.raio), disabled: !cfg.suavizar, title: `Raio da suavização (${u})`, style: 'width:100%',
          onchange: e => { const x = fromUnit(e.target.value); if (x > 0) save({ raio: x }); } })))) : null,
      cfg.ativo ? part('corte', 'Corte') : null,
      cfg.ativo ? part('aterro', 'Aterro') : null,
    ];
  }

  // ------------------------------------------------------------ altura de um ponto

  height(kind, i, el = this.el) {
    const s = el.userData.bim.slab;
    return kind === 'v' ? s.alturas?.[i] || 0 : s.forma[i][2] || 0;
  }

  setHeight(kind, i, dz, el = this.el) {
    el = this.live(el);
    const s = el.userData.bim.slab;
    dz = round6(dz);
    if (kind === 'v') {
      s.alturas ||= s.points.map(() => 0);
      while (s.alturas.length < s.points.length) s.alturas.push(0);
      s.alturas[i] = dz;
    } else if (s.forma?.[i]) s.forma[i][2] = dz;
    else return;
    this.commit(el);
  }

  typeHeight(kind, i) {
    const el = this.el = this.live(this.el);
    if (!el || this.typing) return;
    this.typing = true;
    const sc = this.screen(this.world(kind, i));
    const input = h('input', { type: 'number', step: unitStep(), value: toUnit(this.height(kind, i)), class: 'grip-input', title: `Altura do ponto em relação ao topo do piso (${unitLabel()}). Enter confirma, Esc cancela.` });
    const wrap = h('div', { class: 'grip-label', style: `left:${sc.x + 10}px; top:${sc.y - 26}px` }, h('span', {}, 'Altura '), input);
    this.labels.replaceChildren(wrap);
    input.focus(); input.select();
    const done = ok => {
      if (!this.typing) return;
      const v = fromUnit(input.value);
      this.cancelType();
      if (ok && Number.isFinite(v)) this.setHeight(kind, i, v, el);
    };
    input.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') done(true);
      else if (e.key === 'Escape') done(false);
    });
    input.addEventListener('blur', () => done(true));
    input.addEventListener('pointerdown', e => e.stopPropagation());
  }

  cancelType() {
    if (!this.typing) return;
    this.typing = false;
    this.labels.replaceChildren();
  }

  // ------------------------------------------------------------ ponto interno (de forma)

  startPlacing() {
    if (!this.el || this.placing) return;
    this.placing = true;
    const c = this.viewer.renderer.domElement;
    c.addEventListener('pointerdown', this._place, true);
    document.addEventListener('keydown', this._esc, true);
    c.style.cursor = 'crosshair';
    this.app.status('Pontos do piso · clique dentro do piso para colocar um ponto de forma (depois digite a altura) · Esc termina.');
    this.app.renderProps();
  }

  stopPlacing() {
    if (!this.placing) return;
    this.placing = false;
    const c = this.viewer.renderer.domElement;
    c.removeEventListener('pointerdown', this._place, true);
    document.removeEventListener('keydown', this._esc, true);
    c.style.cursor = '';
    this.app.status('Pronto.');
    if (this.el) this.app.renderProps();
  }

  placeAt(e) {
    if (e.button !== 0 || !this.el) return;
    e.preventDefault(); e.stopPropagation();
    const el = this.el = this.live(this.el), s = el.userData.bim.slab;
    el.updateMatrixWorld(true);
    const r = this.viewer.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1), this.viewer.camera);
    // na face do piso (já inclinada) ou, se errar, no plano do topo
    let hit = ray.intersectObject(el, true).find(x => x.object.isMesh)?.point;
    if (!hit) hit = ray.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 0, 1).transformDirection(el.matrixWorld), this.world('v', 0)), new THREE.Vector3());
    if (!hit) return;
    const q = hit.clone().applyMatrix4(el.matrixWorld.clone().invert());
    const p = [q.x, q.y].map(v => round6(Math.round(v / GRID) * GRID));
    if (!inside(p, s.points)) { toast('Clique dentro do contorno do piso.', 'error'); return; }
    s.forma ||= [];
    s.forma.push([p[0], p[1], round6(q.z - s.elevation)]);
    this.commit(el).then(() => { this.rebuildHandles(); this.update(); this.typeHeight('f', s.forma.length - 1); });
  }

  // ------------------------------------------------------------ seção nas propriedades

  propsSection(el) {
    const s = el.userData.bim.slab;
    const num = (v, onset, title) => h('input', { type: 'number', step: unitStep(), value: toUnit(v), title, style: 'width:100%',
      onchange: e => { const x = fromUnit(e.target.value); if (Number.isFinite(x)) onset(x); } });
    const rows = [];
    s.points.forEach((p, i) => rows.push(h('tr', {},
      h('td', {}, String(i + 1)),
      h('td', {}, num(p[0], x => { s.points[i] = [round6(x), p[1]]; this.commit(el); }, 'X')),
      h('td', {}, num(p[1], y => { s.points[i] = [p[0], round6(y)]; this.commit(el); }, 'Y')),
      h('td', {}, num(s.alturas?.[i] || 0, v => this.setHeight('v', i, v, el), 'Altura do ponto (deslocamento do topo do piso)')),
      h('td', {}, h('button', { class: 'icon-btn', title: 'Apagar o ponto', onclick: () => { this.el = el; this.remove('v', i); } }, '×')))));
    (s.forma || []).forEach((p, i) => rows.push(h('tr', { class: 'floor-shape-row' },
      h('td', { title: 'Ponto de forma (interno)' }, `◆${i + 1}`),
      h('td', {}, num(p[0], x => { p[0] = round6(x); this.commit(el); }, 'X')),
      h('td', {}, num(p[1], y => { p[1] = round6(y); this.commit(el); }, 'Y')),
      h('td', {}, num(p[2] || 0, v => this.setHeight('f', i, v, el), 'Altura do ponto (deslocamento do topo do piso)')),
      h('td', {}, h('button', { class: 'icon-btn', title: 'Apagar o ponto', onclick: () => { this.el = el; this.remove('f', i); } }, '×')))));
    const u = unitLabel();
    return [
      h('h4', {}, 'Pontos do piso'),
      h('label', { class: 'inline', title: 'Terreno: só a superfície se desloca com os pontos (o fundo fica plano) e os outros pisos cortam o terreno' },
        h('input', { type: 'checkbox', checked: !!s.terreno, onchange: e => this.setTerrain(el, e.target.checked) }), 'Terreno'),
      h('div', { class: 'small muted' }, 'Arraste os pontos na vista; o "+" no meio de um lado coloca um ponto novo; clique num ponto para a altura; botão direito apaga.'),
      h('div', { class: 'floor-points-table' }, h('table', {},
        h('tr', {}, h('th', {}, '#'), h('th', {}, `X (${u})`), h('th', {}, `Y (${u})`), h('th', {}, `Altura (${u})`), h('th', {}, '')),
        rows)),
      h('div', { class: 'row-buttons' },
        h('button', { class: this.placing ? 'on' : '', onclick: () => { this.el = el; this.placing ? this.stopPlacing() : this.startPlacing(); },
          title: 'Clique dentro do piso para colocar um ponto de forma e digite a altura dele' }, this.placing ? '✔ Terminar pontos' : '＋ Ponto interno'),
        h('button', { onclick: () => { delete s.alturas; delete s.forma; this.commit(el); }, title: 'Volta o piso a plano (tira as alturas e os pontos internos)' }, 'Piso plano')),
      ...this.tools2dSection(el),
    ];
  }

  /** Bloco "Edição 2D do contorno": canto (raio, chanfro, vivo) e offset. */
  tools2dSection(el) {
    const u = unitLabel(), c = this.corner, active = this.tool2d;
    const modes = { raio: 'Raio', chanfro: 'Chanfro', vivo: 'Vivo' };
    const seg = h('div', { class: 'seg-btns' }, Object.entries(modes).map(([k, l]) => h('button', { class: c.mode === k ? 'on' : '',
      onclick: () => { c.mode = k; if (this.tool2d) this.startTool2d(el); else this.app.renderProps(); } }, l)));
    const val = h('input', { type: 'number', min: 0, step: unitStep(), value: toUnit(c.value), disabled: c.mode === 'vivo', style: 'width:80px',
      title: c.mode === 'raio' ? `Raio (${u})` : `Recuo do chanfro em cada lado (${u})`,
      onchange: e => { const x = fromUnit(e.target.value); if (x > 0) { c.value = x; if (this.tool2d) this.startTool2d(el); } } });
    const off = h('input', { type: 'number', step: unitStep(), value: toUnit(this.offsetValue), style: 'width:80px', title: `Distância (${u}); negativo = para dentro`,
      onchange: e => { const x = fromUnit(e.target.value); if (Number.isFinite(x)) this.offsetValue = x; } });
    return [
      h('h4', {}, 'Edição 2D do contorno'),
      h('div', { class: 'small muted' }, active ? (active.mode === 'vivo' ? 'Clique no "+" de um lado (o lado some e os vizinhos se encontram). Esc termina.' : 'Clique nos pontos (cantos) do piso na vista. Esc termina.')
        : 'Canto: escolha raio, chanfro ou vivo e clique em "Canto"; depois clique nos cantos do piso (vivo: no "+" do lado).'),
      h('div', { class: 'row-buttons' }, seg, val,
        h('button', { class: active ? 'on' : '', title: 'Liga o canto: os próximos cliques nos cantos do piso aplicam', onclick: () => (active ? this.stopTool2d() : this.startTool2d(el)) }, active ? '✔ Terminar canto' : '⌜ Canto')),
      h('div', { class: 'row-buttons' }, h('span', { class: 'small' }, `Offset (${u})`), off,
        h('button', { title: 'Desloca o contorno externo do piso (positivo = para fora)', onclick: () => this.offsetOutline(el, this.offsetValue) }, 'Aplicar offset')),
    ];
  }
}
