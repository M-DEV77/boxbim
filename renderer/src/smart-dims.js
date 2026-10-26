// COTAS AUTOMÁTICAS DA SELEÇÃO: com UMA peça selecionada aparecem as distâncias até as peças paralelas vizinhas.
//   parede, viga, linha 2D ... distância livre (face a face) até a peça paralela mais próxima de cada lado, no trecho
//                              em que as duas se sobrepõem
//   outras peças ............. distância até a vizinha mais próxima em +X, −X, +Y e −Y (caixas, pilares, objetos…)
// Só peças do mesmo andar (que se sobrepõem na altura). Clicar no número digita outra distância: a peça
// selecionada anda até ela (Desfazer movimento / Ctrl+Z volta). Tudo em SVG por cima do canvas (tamanho fixo na tela).
import * as THREE from 'three';
import { h } from './ui.js';
import { worldPoints } from './sketch/sketch.js';
import { fmtLen, fromUnit, toUnit, unitLabel } from './units.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
const MAX_DIST = 60;      // m: vizinhas mais longe que isso não entram
const PARALLEL = 0.02;    // seno do ângulo aceito como paralelo (~1,1°)

/** Eixo de uma peça linear no plano: { a, b (Vector2), half (meia espessura), z }, ou null. */
function axisOf(el) {
  const b = el.userData.bim;
  el.updateMatrixWorld(true);
  if (b.linha && !b.linha.arco) {
    const [A, B] = worldPoints(b.linha).map(v => v.applyMatrix4(el.matrixWorld));
    if (Math.abs(A.z - B.z) > 1e-3) return null; // só linhas no plano horizontal
    return { a: new THREE.Vector2(A.x, A.y), b: new THREE.Vector2(B.x, B.y), half: 0, z: A.z };
  }
  const d = b.wall || b.beam;
  if (!d) return null;
  const z = b.wall ? d.base : d.top;
  const [A, B] = [d.start, d.end].map(p => new THREE.Vector3(p[0], p[1], z).applyMatrix4(el.matrixWorld));
  return { a: new THREE.Vector2(A.x, A.y), b: new THREE.Vector2(B.x, B.y), half: (b.wall ? d.thickness : d.width) / 2, z: A.z };
}

const zOverlap = (b1, b2) => Math.min(b1.max.z, b2.max.z) - Math.max(b1.min.z, b2.min.z) > -0.01;

export class SmartDims {
  constructor(app) {
    this.app = app;
    this.dims = [];
    this.svg = svg('svg', { class: 'smart-dims-svg' });
    this.path = svg('path', { class: 'smart-dim' });
    this.svg.append(this.path);
    this.labels = h('div');
    this.box = h('div', { class: 'smart-dims', hidden: true }, this.svg, this.labels);
    document.querySelector('.center').append(this.box);
    const v = app.viewer;
    v.addEventListener('select', () => this.refresh());
    v.addEventListener('change', () => { clearTimeout(this._t); this._t = setTimeout(() => this.refresh(), 60); });
    v.frameHooks.push(() => this.update());
  }

  get viewer() { return this.app.viewer; }

  refresh() {
    const sel = [...this.viewer.selected];
    this.el = sel.length === 1 && sel[0].parent ? sel[0] : null;
    this.dims = this.el ? this.compute(this.el) : [];
    this.labels.replaceChildren(...this.dims.map(d => {
      d.label = h('button', { class: 'smart-dim-label', title: 'Distância até a peça paralela — clique para digitar outra (a peça selecionada anda)', onclick: () => this.edit(d) }, fmtLen(d.gap));
      return d.label;
    }));
    this.update();
  }

  /** Cotas até as vizinhas paralelas: [{ A, B (Vector3, face a face), gap, away (Vector3: afasta da vizinha) }] */
  compute(el) {
    const v = this.viewer;
    if (el.userData.bim?.cota) return []; // cota não tem cota automática
    const others = v.elements().filter(o => o !== el && o.visible && !o.userData.bim?.eixo && !o.userData.bim?.host && !o.userData.bim?.cota);
    const myBox = new THREE.Box3().setFromObject(el);
    if (myBox.isEmpty()) return [];
    const ax = axisOf(el);
    return ax ? this.linear(el, ax, myBox, others) : this.boxes(myBox, others);
  }

  linear(el, ax, myBox, others) {
    const u = ax.b.clone().sub(ax.a), L = u.length();
    if (L < 1e-4) return [];
    u.divideScalar(L);
    const n = new THREE.Vector2(-u.y, u.x);
    const best = { 1: null, '-1': null };
    for (const o of others) {
      const oa = axisOf(o);
      if (!oa) continue;
      const u2 = oa.b.clone().sub(oa.a);
      if (u2.length() < 1e-4 || Math.abs(u.cross(u2.normalize())) > PARALLEL) continue;
      if (!zOverlap(myBox, new THREE.Box3().setFromObject(o))) continue;
      const s = oa.a.clone().sub(ax.a).dot(n);
      const gap = Math.abs(s) - ax.half - oa.half;
      if (gap <= 1e-3 || gap > MAX_DIST) continue;
      // trecho comum (projeção no eixo da selecionada)
      const t1 = oa.a.clone().sub(ax.a).dot(u), t2 = oa.b.clone().sub(ax.a).dot(u);
      const lo = Math.max(0, Math.min(t1, t2)), hi = Math.min(L, Math.max(t1, t2));
      if (hi - lo < 0.02) continue;
      const side = Math.sign(s);
      if (!best[side] || gap < best[side].gap) best[side] = { gap, t: (lo + hi) / 2, side };
    }
    const z = ax.z + 0.02;
    return Object.values(best).filter(Boolean).map(({ gap, t, side }) => {
      const p = ax.a.clone().addScaledVector(u, t).addScaledVector(n, side * ax.half);
      const q = p.clone().addScaledVector(n, side * gap);
      return { A: new THREE.Vector3(p.x, p.y, z), B: new THREE.Vector3(q.x, q.y, z), gap, away: new THREE.Vector3(-n.x * side, -n.y * side, 0) };
    });
  }

  boxes(me, others) {
    const out = [];
    const dirs = [['x', 1], ['x', -1], ['y', 1], ['y', -1]];
    const z = me.min.z + 0.02;
    for (const [axis, sgn] of dirs) {
      const perp = axis === 'x' ? 'y' : 'x';
      let best = null;
      for (const o of others) {
        const b = new THREE.Box3().setFromObject(o);
        if (b.isEmpty() || !zOverlap(me, b)) continue;
        const lo = Math.max(me.min[perp], b.min[perp]), hi = Math.min(me.max[perp], b.max[perp]);
        if (hi - lo < 0.02) continue;
        const gap = sgn > 0 ? b.min[axis] - me.max[axis] : me.min[axis] - b.max[axis];
        if (gap <= 1e-3 || gap > MAX_DIST) continue;
        if (!best || gap < best.gap) best = { gap, mid: (lo + hi) / 2 };
      }
      if (!best) continue;
      const from = sgn > 0 ? me.max[axis] : me.min[axis];
      const A = new THREE.Vector3(), B = new THREE.Vector3();
      A[axis] = from; A[perp] = best.mid; A.z = z;
      B.copy(A); B[axis] = from + sgn * best.gap;
      const away = new THREE.Vector3(); away[axis] = -sgn;
      out.push({ A, B, gap: best.gap, away });
    }
    return out;
  }

  screen(p) {
    const c = this.viewer.renderer.domElement.getBoundingClientRect(), pr = this.box.getBoundingClientRect();
    const v = p.clone().project(this.viewer.camera);
    return { x: (v.x + 1) / 2 * c.width + c.left - pr.left, y: (1 - v.y) / 2 * c.height + c.top - pr.top, behind: v.z > 1 };
  }

  update() {
    const v = this.viewer;
    const show = this.dims.length && this.el?.parent && this.el.visible && !v.tool && !v.renderOverride && !this.typing;
    if (!show) { if (!this.box.hidden && !this.typing) this.box.hidden = true; return; }
    this.box.hidden = false;
    let d = '';
    for (const dim of this.dims) {
      const a = this.screen(dim.A), b = this.screen(dim.B);
      if (a.behind || b.behind) { dim.label.hidden = true; continue; }
      dim.label.hidden = false;
      const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const ux = (b.x - a.x) / L, uy = (b.y - a.y) / L, nx = -uy, ny = ux;
      const sx = (ux + nx) * 3.6, sy = (uy + ny) * 3.6; // traço a 45° (desenho técnico)
      d += `M${a.x} ${a.y}L${b.x} ${b.y}`;
      for (const p of [a, b]) d += `M${p.x - sx} ${p.y - sy}L${p.x + sx} ${p.y + sy}M${p.x - 7 * nx} ${p.y - 7 * ny}L${p.x + 7 * nx} ${p.y + 7 * ny}`;
      let ang = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
      if (ang > 90) ang -= 180; else if (ang < -90) ang += 180;
      const short = Math.hypot(b.x - a.x, b.y - a.y) < 46;
      Object.assign(dim.label.style, { left: `${(a.x + b.x) / 2}px`, top: `${(a.y + b.y) / 2}px`, transform: `translate(-50%, -50%) rotate(${ang}deg) translateY(${short ? -14 : -10}px)` });
    }
    this.path.setAttribute('d', d);
  }

  /** Digita a distância: a peça selecionada anda (afastando ou aproximando da vizinha). */
  edit(dim) {
    if (!this.el || this.typing) return;
    this.typing = true;
    const input = h('input', { class: 'smart-dim-input', type: 'number', step: 'any', value: toUnit(dim.gap), title: `Distância (${unitLabel()}) — Enter aplica, Esc cancela` });
    const r = dim.label.getBoundingClientRect(), pr = this.box.getBoundingClientRect();
    Object.assign(input.style, { left: `${r.left - pr.left + r.width / 2}px`, top: `${r.top - pr.top + r.height / 2}px` });
    this.box.append(input);
    input.focus(); input.select();
    const done = apply => {
      if (!this.typing) return;
      this.typing = false;
      input.remove();
      const val = fromUnit(Number(input.value));
      if (apply && Number.isFinite(val) && val >= 0 && Math.abs(val - dim.gap) > 1e-5) this.move(dim.away.clone().multiplyScalar(val - dim.gap));
      this.refresh();
    };
    input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
    input.addEventListener('blur', () => done(false));
  }

  move(vec) {
    const el = this.el, t = this.app.transformTool;
    el.updateMatrix();
    const before = el.matrix.clone();
    el.position.add(vec);
    el.updateMatrix();
    el.updateMatrixWorld(true);
    t?.history?.push([{ obj: el, before, after: el.matrix.clone() }]);
    if (t?.afterTransform) t.afterTransform([el]); else { this.viewer.changed(); this.app.renderProps(); }
    this.app.status(`Movido ${fmtLen(vec.length(), { suffix: true })} — Ctrl+Z desfaz.`);
  }
}
