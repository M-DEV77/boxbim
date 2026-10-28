// COTAS GUIAS (como as cotas temporárias do Revit): a medida de cada linha aparece ao lado dela, na tela —
//   · editando o contorno de um piso (clique duplo): em todas as linhas do contorno;
//   · em qualquer lugar do projeto: nas linhas 2D, paredes e vigas selecionadas (duas ou mais; com uma só, os pontos
//     da seleção já mostram a medida).
// Arraste a cota (a linha ou o número) para mudar a POSIÇÃO dela (mais longe/perto, de um lado ou do outro); a
// posição fica guardada por elemento. Clique no número para digitar o comprimento. Duplo clique volta à posição padrão.
import * as THREE from 'three';
import { h } from './ui.js';
import { isSketch, worldPoints } from './sketch/sketch.js';
import { fmtLen, fromUnit, toUnit, unitLabel, unitStep } from './units.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
const DEFAULT_OFF = 20; // px
const KEY = 'boxbim.cotasGuia';

export class GuideDims {
  constructor(app) {
    this.app = app;
    this.offsets = new Map(); // guid → afastamento em px (com sinal: lado da cota)
    try { for (const [k, v] of Object.entries(JSON.parse(localStorage.getItem(KEY) || '{}'))) this.offsets.set(k, v); } catch { /* sem armazenamento */ }
    const center = document.querySelector('.center');
    this.svg = svg('svg', { class: 'guide-dims-svg' });
    this.labels = h('div');
    this.box = h('div', { class: 'guide-dims', hidden: true }, this.svg, this.labels);
    center.append(this.box);
    this.pool = []; // [{ path, hit, label }]
    app.viewer.frameHooks.push(() => this.update());
    addEventListener('pointermove', e => this.onMove(e));
    addEventListener('pointerup', () => this.endDrag());
  }

  get viewer() { return this.app.viewer; }

  /** Elementos com cota guia agora: linhas do esboço do piso, ou a seleção (2+ linhas/paredes/vigas). */
  targets() {
    const v = this.viewer, fs = this.app.floorSketch;
    if (fs?.active) return v.elements().filter(e => fs.isTemp(e) && e.visible && !e.userData.bim.linha.arco);
    const sel = [...v.selected].filter(e => e.visible && ((isSketch(e) && !e.userData.bim.linha.arco) || e.userData.bim?.wall || e.userData.bim?.beam));
    return sel.length >= 2 && sel.length <= 60 ? sel : [];
  }

  /** Pontas (no modelo) do elemento. */
  ends(el) {
    const b = el.userData.bim;
    if (b.linha) { const w = worldPoints(b.linha); return [w[0], w[w.length - 1]]; }
    el.updateMatrixWorld(true);
    const d = b.wall || b.beam, z = b.wall ? d.base : d.top;
    return [d.start, d.end].map(p => new THREE.Vector3(p[0], p[1], z).applyMatrix4(el.matrixWorld));
  }

  screen(v) {
    const c = this.viewer.renderer.domElement, r = c.getBoundingClientRect(), pr = this.box.parentElement.getBoundingClientRect();
    const p = v.clone().project(this.viewer.camera);
    return { x: (p.x + 1) / 2 * r.width + r.left - pr.left, y: (1 - p.y) / 2 * r.height + r.top - pr.top, behind: p.z > 1 };
  }

  item(i) {
    if (this.pool[i]) return this.pool[i];
    const path = svg('path', { class: 'guide-dim-line' });
    const hit = svg('path', { class: 'guide-dim-hit' }); // faixa larga para pegar a cota com o mouse
    const label = h('button', { class: 'guide-dim-label', title: 'Arraste para mudar a posição da cota · clique para digitar o comprimento · duplo clique volta à posição padrão' });
    this.svg.append(path, hit);
    this.labels.append(label);
    const it = { path, hit, label };
    const down = e => this.startDrag(e, it);
    hit.addEventListener('pointerdown', down);
    label.addEventListener('pointerdown', down);
    label.addEventListener('dblclick', e => { e.stopPropagation(); if (it.el) { this.offsets.delete(it.el.userData.bim.guid); this.save(); } });
    this.pool[i] = it;
    return it;
  }

  update() {
    const els = this.viewer.renderOverride || this.viewer.tool && !this.app.floorSketch?.active ? [] : this.targets();
    if (!els.length) { if (!this.box.hidden) this.box.hidden = true; return; }
    this.box.hidden = false;
    let n = 0;
    for (const el of els) {
      const [A, B] = this.ends(el), a = this.screen(A), b = this.screen(B);
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      if (a.behind || b.behind || L < 30) continue;
      const it = this.item(n++);
      it.el = el;
      let nx = -(b.y - a.y) / L, ny = (b.x - a.x) / L;
      if (ny > 0 || (ny === 0 && nx > 0)) { nx = -nx; ny = -ny; } // lado padrão: para cima na tela
      const off = this.offsets.get(el.userData.bim.guid) ?? DEFAULT_OFF;
      it.n = [nx, ny]; it.mid = [(a.x + b.x) / 2, (a.y + b.y) / 2];
      const a2 = { x: a.x + nx * off, y: a.y + ny * off }, b2 = { x: b.x + nx * off, y: b.y + ny * off };
      const s = Math.sign(off) || 1, ext = 5 * s;
      const tick = p => `M${p.x - 4 * (nx + ny)} ${p.y - 4 * (ny - nx)}L${p.x + 4 * (nx + ny)} ${p.y + 4 * (ny - nx)}`;
      const d = `M${a.x + nx * 4 * s} ${a.y + ny * 4 * s}L${a2.x + nx * ext} ${a2.y + ny * ext}M${b.x + nx * 4 * s} ${b.y + ny * 4 * s}L${b2.x + nx * ext} ${b2.y + ny * ext}`
        + `M${a2.x} ${a2.y}L${b2.x} ${b2.y}${tick(a2)}${tick(b2)}`;
      it.path.setAttribute('d', d);
      it.hit.setAttribute('d', `M${a2.x} ${a2.y}L${b2.x} ${b2.y}`);
      it.path.style.display = it.hit.style.display = '';
      if (!it.typing) it.label.textContent = fmtLen(A.distanceTo(B));
      let ang = Math.atan2(b2.y - a2.y, b2.x - a2.x) * 180 / Math.PI;
      if (ang > 90) ang -= 180; else if (ang < -90) ang += 180;
      Object.assign(it.label.style, { left: `${(a2.x + b2.x) / 2}px`, top: `${(a2.y + b2.y) / 2}px`, transform: `translate(-50%, -50%) rotate(${ang}deg) translateY(${off >= 0 ? -8 : 8}px)`, display: '' });
    }
    for (let k = n; k < this.pool.length; k++) { const it = this.pool[k]; it.path.style.display = it.hit.style.display = it.label.style.display = 'none'; it.el = null; }
  }

  // ------------------------------------------------------------ arrastar (posição) e clicar (comprimento)

  startDrag(e, it) {
    if (e.button !== 0 || !it.el || it.typing) return;
    e.preventDefault(); e.stopPropagation();
    this.drag = { it, x: e.clientX, y: e.clientY, moved: false };
  }

  onMove(e) {
    const d = this.drag;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 3) return;
    d.moved = true;
    const pr = this.box.parentElement.getBoundingClientRect();
    const px = e.clientX - pr.left, py = e.clientY - pr.top, [mx, my] = d.it.mid, [nx, ny] = d.it.n;
    let off = (px - mx) * nx + (py - my) * ny; // distância do cursor à linha, na normal (com sinal)
    if (Math.abs(off) < 8) off = 8 * (Math.sign(off) || 1);
    this.offsets.set(d.it.el.userData.bim.guid, Math.round(off));
  }

  endDrag() {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    if (d.moved) { this.save(); return; }
    this.typeLength(d.it);
  }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries([...this.offsets].slice(-500)))); } catch { /* ok */ }
  }

  typeLength(it) {
    const el = it.el;
    if (!el) return;
    const [A, B] = this.ends(el);
    it.typing = true;
    const input = h('input', { type: 'number', step: unitStep(), min: '0', value: toUnit(+A.distanceTo(B).toFixed(4)), class: 'grip-input', title: `Comprimento (${unitLabel()}) · Enter confirma, Esc cancela` });
    it.label.replaceChildren(input);
    input.focus(); input.select();
    const done = ok => {
      if (!it.typing) return;
      it.typing = false;
      const v = fromUnit(input.value);
      it.label.textContent = fmtLen(A.distanceTo(B));
      if (ok && v > 0.005) this.app.grips.setLength(el, v); // a primeira ponta fica, a segunda anda na direção da linha
    };
    input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') done(true); else if (e.key === 'Escape') done(false); });
    input.addEventListener('blur', () => done(true));
    input.addEventListener('pointerdown', e => e.stopPropagation());
  }
}
