// EDIÇÃO DE LINHAS PELOS PONTOS (como os grips do AutoCAD): com uma linha do desenho 2D, parede ou viga selecionada
// aparecem uma cota com a medida e dois pontos nas extremidades.
//   arrastar um ponto ...... move aquela ponta (snap nas pontas de linhas/paredes/vigas; ORTO/F8 ou Shift trava 0°/90°)
//   clicar na medida ....... digita o comprimento (Enter): a primeira ponta fica, a segunda anda na direção da linha
// Tudo em DOM/SVG por cima do canvas: os pontos ficam sempre do mesmo tamanho na tela.
import * as THREE from 'three';
import { h, toast } from './ui.js';
import { isSketch, bake, rebuildSketch, planeMatrix, frameOf, worldPoints } from './sketch/sketch.js';
import { rebuildElement } from './elements.js';
import { fmtLen, fromUnit, toUnit, unitLabel, unitStep } from './units.js';
import { snapSegments, snapPick, showSnapMarker } from './osnap.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const SNAP_PX = 12;
const GRID = 0.01;
const fmtM = v => fmtLen(v);
const svg = (tag, attrs = {}) => { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };

/** Tipo de elemento "linha" editável e onde ficam as pontas nos dados. */
function kindOf(el) {
  const b = el?.userData?.bim;
  if (!b) return null;
  if (b.linha && !b.linha.arco) return 'linha';
  if (b.wall) return 'parede';
  if (b.beam) return 'viga';
  return null;
}

export class Grips {
  constructor(app) {
    this.app = app;
    this.el = null;
    this.drag = null;
    const center = document.querySelector('.center');
    this.svg = svg('svg', { class: 'grips-svg' });
    this.dimLine = svg('path', { class: 'grip-dim' });
    this.svg.append(this.dimLine);
    this.label = h('button', { class: 'grip-label', title: 'Clique para digitar o comprimento', onclick: () => this.typeLength() });
    this.points = [0, 1].map(i => {
      const p = h('div', { class: 'grip-point', title: i ? 'Ponta final: arraste para mover' : 'Ponta inicial: arraste para mover' });
      p.addEventListener('pointerdown', e => this.startDrag(e, i));
      return p;
    });
    this.tip = h('div', { class: 'draw-tip', hidden: true });
    this.marker = h('div', { class: 'snap-marker', hidden: true });
    this.box = h('div', { class: 'grips', hidden: true }, this.svg, this.label, ...this.points);
    center.append(this.box, this.tip, this.marker);
    app.viewer.addEventListener('select', () => this.refresh());
    app.viewer.frameHooks.push(() => this.update());
    addEventListener('pointermove', e => this.onMove(e));
    addEventListener('pointerup', e => this.endDrag(e));
  }

  get viewer() { return this.app.viewer; }

  refresh() {
    const sel = [...this.viewer.selected];
    this.el = sel.length === 1 && kindOf(sel[0]) ? sel[0] : null;
    this.cancelType();
    if (!this.el) this.box.hidden = true;
    this.update();
  }

  /** Pontas no modelo [A, B]. */
  ends(el = this.el) {
    el.updateMatrixWorld(true);
    const b = el.userData.bim;
    if (b.linha) return worldPoints(b.linha).map(v => v.applyMatrix4(el.matrixWorld));
    const d = b.wall || b.beam, z = b.wall ? d.base : d.top;
    return [d.start, d.end].map(p => new THREE.Vector3(p[0], p[1], z).applyMatrix4(el.matrixWorld));
  }

  screen(v) {
    const c = this.viewer.renderer.domElement, r = c.getBoundingClientRect(), pr = this.box.parentElement.getBoundingClientRect();
    const p = v.clone().project(this.viewer.camera);
    return { x: (p.x + 1) / 2 * r.width + r.left - pr.left, y: (1 - p.y) / 2 * r.height + r.top - pr.top, behind: p.z > 1, cx: (p.x + 1) / 2 * r.width + r.left, cy: (1 - p.y) / 2 * r.height + r.top };
  }

  /** A cada quadro: pontos e cota acompanham a câmera. */
  update() {
    const el = this.el;
    const show = el && el.parent && el.visible && !this.viewer.tool && !this.viewer.renderOverride;
    if (!show) { if (!this.box.hidden) this.box.hidden = true; return; }
    const [A, B] = this.ends();
    const a = this.screen(A), b = this.screen(B);
    if (a.behind || b.behind) { this.box.hidden = true; return; }
    this.box.hidden = false;
    this.points[0].style.transform = `translate(${a.x}px, ${a.y}px)`;
    this.points[1].style.transform = `translate(${b.x}px, ${b.y}px)`;
    // cota paralela à linha, afastada 22 px (para o lado de cima da tela)
    let nx = -(b.y - a.y), ny = b.x - a.x;
    const L = Math.hypot(nx, ny) || 1;
    nx /= L; ny /= L;
    if (ny > 0) { nx = -nx; ny = -ny; }
    const off = 22, ext = 6;
    const a2 = { x: a.x + nx * off, y: a.y + ny * off }, b2 = { x: b.x + nx * off, y: b.y + ny * off };
    const tick = (p) => `M${p.x - 4 * (nx + ny)} ${p.y - 4 * (ny - nx)}L${p.x + 4 * (nx + ny)} ${p.y + 4 * (ny - nx)}`;
    this.dimLine.setAttribute('d', `M${a.x + nx * 5} ${a.y + ny * 5}L${a.x + nx * (off + ext)} ${a.y + ny * (off + ext)}`
      + `M${b.x + nx * 5} ${b.y + ny * 5}L${b.x + nx * (off + ext)} ${b.y + ny * (off + ext)}`
      + `M${a2.x} ${a2.y}L${b2.x} ${b2.y}${tick(a2)}${tick(b2)}`);
    const len = A.distanceTo(B);
    if (!this.typing) this.label.textContent = fmtM(len);
    let ang = Math.atan2(b2.y - a2.y, b2.x - a2.x) * 180 / Math.PI;
    if (ang > 90) ang -= 180; else if (ang < -90) ang += 180;
    Object.assign(this.label.style, { left: `${(a2.x + b2.x) / 2}px`, top: `${(a2.y + b2.y) / 2}px`, transform: `translate(-50%, -50%) rotate(${ang}deg) translateY(-9px)` });
  }

  // ------------------------------------------------------------ arrastar uma ponta

  startDrag(e, i) {
    if (e.button !== 0 || !this.el) return;
    e.preventDefault(); e.stopPropagation();
    const el = this.el, b = el.userData.bim;
    if (b.linha) bake(el);
    el.updateMatrixWorld(true);
    const [A, B] = this.ends();
    // plano do arraste e conversão modelo ↔ dados
    let toData, fromData, plane;
    if (b.linha) {
      const M = planeMatrix(frameOf(b.linha)), inv = M.clone().invert();
      plane = new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3().setFromMatrixColumn(M, 2), A);
      toData = v => { const q = v.clone().applyMatrix4(inv); return [q.x, q.y]; };
      fromData = p => new THREE.Vector3(p[0], p[1], 0).applyMatrix4(M);
    } else {
      const inv = el.matrixWorld.clone().invert(), z = (b.wall ? b.wall.base : b.beam.top);
      plane = new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 0, 1).transformDirection(el.matrixWorld), A);
      toData = v => { const q = v.clone().applyMatrix4(inv); return [q.x, q.y]; };
      fromData = p => new THREE.Vector3(p[0], p[1], z).applyMatrix4(el.matrixWorld);
    }
    const data = b.linha || b.wall || b.beam;
    const keys = b.linha ? ['a', 'b'] : ['start', 'end'];
    this.drag = { i, el, plane, toData, fromData, data, key: keys[i], other: data[keys[1 - i]], start: [...data[keys[i]]], snaps: this.snapCandidates(el), moved: false };
    this.points[i].setPointerCapture?.(e.pointerId);
    this.viewer.controls.enabled = false;
  }

  /** Pontas de linhas, paredes e vigas (no modelo) para o snap. */
  snapCandidates(except) {
    const out = [];
    for (const e of this.viewer.elements()) {
      if (e === except || !e.visible || !kindOf(e)) continue;
      const [A, B] = this.ends(e);
      out.push(A, B, A.clone().lerp(B, 0.5));
    }
    return out;
  }

  onMove(e) {
    const d = this.drag;
    if (!d) return;
    const r = this.viewer.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.viewer.camera);
    const hit = ray.ray.intersectPlane(d.plane, new THREE.Vector3());
    if (!hit) return;
    let p = d.toData(hit), snapped = false, kind = null;
    // snap do projeto: ponta, meio e perpendicular (a partir da outra ponta) — em planta, nos outros elementos
    const toS = q => { const s = this.screen(new THREE.Vector3(q[0], q[1], hit.z)); return [s.cx, s.cy]; };
    const wFrom = d.fromData(d.other);
    if (Math.abs(d.plane.normal.z) > 0.999) {
      const best = snapPick({ segs: snapSegments(this.app, { except: [d.el] }), toScreen: toS, cursor: [e.clientX, e.clientY], from: [wFrom.x, wFrom.y] });
      if (best) { p = d.toData(new THREE.Vector3(best.p[0], best.p[1], hit.z)); snapped = true; kind = best.kind; }
    } else {
      // linha num eixo de trabalho (plano inclinado/vertical): pontas e meios dos outros, como antes
      let bd = 12;
      for (const c of d.snaps) { const s = this.screen(c), dd = Math.hypot(s.cx - e.clientX, s.cy - e.clientY); if (dd < bd) { bd = dd; p = d.toData(c); snapped = true; kind = 'ponta'; } }
    }
    if (!snapped) {
      const ortho = this.app.wallTool.ortho !== !!e.shiftKey;
      if (ortho) {
        const dx = p[0] - d.other[0], dy = p[1] - d.other[1];
        p = Math.abs(dx) >= Math.abs(dy) ? [p[0], d.other[1]] : [d.other[0], p[1]];
      }
      p = p.map(v => Math.round(v / GRID) * GRID);
    }
    if (Math.hypot(p[0] - d.other[0], p[1] - d.other[1]) < GRID) return; // não deixa a linha sumir
    d.data[d.key] = p;
    d.moved = true;
    this.rebuild(d.el, true);
    // dica e marcador de snap
    const pr = this.box.parentElement.getBoundingClientRect();
    const s = this.screen(d.fromData(p));
    showSnapMarker(this.marker, snapped ? kind : null, s.x, s.y);
    const L = Math.hypot(p[0] - d.other[0], p[1] - d.other[1]);
    this.tip.textContent = `${fmtLen(L, { suffix: true })}${snapped ? `  ◻ ${kind}` : ''}`;
    Object.assign(this.tip.style, { left: `${e.clientX - pr.left + 16}px`, top: `${e.clientY - pr.top + 14}px` });
    this.tip.hidden = false;
  }

  endDrag() {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    this.viewer.controls.enabled = true;
    this.tip.hidden = true; this.marker.hidden = true;
    if (d.moved) this.commit(d.el);
  }

  /** Refaz a geometria do elemento (live = durante o arraste: sem esperar o script do objeto). */
  rebuild(el, live = false) {
    const b = el.userData.bim;
    if (b.linha) { rebuildSketch(el); this.viewer._highlight(el, true); return Promise.resolve(); }
    if (live) {
      // no máximo uma regeneração por quadro
      if (this._raf) return Promise.resolve();
      this._raf = requestAnimationFrame(() => { this._raf = 0; rebuildElement(el); this.viewer._highlight(el, true); });
      return Promise.resolve();
    }
    rebuildElement(el);
    this.viewer._highlight(el, true);
    return this.app.system.pending(el).then(() => { if (this.viewer.selected.has(el)) this.viewer._highlight(el, true); });
  }

  async commit(el) {
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
    try {
      await this.rebuild(el);
      if (el.userData.bim.wall) await this.app.hosting.refreshHostedOf(el);
    } catch (err) { toast(err.message, 'error'); }
    this.viewer._prepare2D(el);
    this.viewer.changed();
    this.app.renderProps();
  }

  // ------------------------------------------------------------ digitar o comprimento

  typeLength() {
    if (!this.el || this.typing) return;
    const el = this.el;
    const [A, B] = this.ends();
    this.typing = true;
    const input = h('input', { type: 'number', step: unitStep(), min: '0', value: toUnit(A.distanceTo(B)), class: 'grip-input', title: `Comprimento (${unitLabel()})` });
    this.label.replaceChildren(input);
    input.focus(); input.select();
    const done = ok => {
      if (!this.typing) return;
      const v = fromUnit(input.value);
      this.cancelType();
      if (ok && v > 0.005) this.setLength(el, v);
    };
    input.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') done(true);
      else if (e.key === 'Escape') done(false);
    });
    input.addEventListener('blur', () => done(true));
    input.addEventListener('click', e => e.stopPropagation());
  }

  cancelType() {
    if (!this.typing) return;
    this.typing = false;
    this.label.replaceChildren();
    this.update();
  }

  /** Novo comprimento: a primeira ponta fica, a segunda anda na direção da linha. */
  setLength(el, L) {
    const b = el.userData.bim;
    if (b.linha) bake(el);
    const d = b.linha || b.wall || b.beam;
    const [k0, k1] = b.linha ? ['a', 'b'] : ['start', 'end'];
    const p0 = d[k0], p1 = d[k1];
    const cur = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1;
    d[k1] = [p0[0] + (p1[0] - p0[0]) / cur * L, p0[1] + (p1[1] - p0[1]) / cur * L].map(v => +v.toFixed(6));
    this.commit(el);
    this.app.status(`Comprimento: ${fmtLen(L, { suffix: true })}.`);
  }
}
