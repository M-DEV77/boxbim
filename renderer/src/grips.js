// EDIÇÃO DE LINHAS PELOS PONTOS (como os grips do AutoCAD): com uma linha do desenho 2D, parede ou viga selecionada
// aparecem uma cota com a medida e dois pontos nas extremidades.
//   arrastar um ponto ...... move aquela ponta (snap nas pontas de linhas/paredes/vigas; ORTO/F8 ou Shift trava 0°/90°)
//   clicar na medida ....... digita o comprimento (Enter): a primeira ponta fica, a segunda anda na direção da linha
//                            (linhas 2D: as linhas ligadas na ponta que anda acompanham — followEnd)
//   pegar a linha (ou o losango do meio) e puxar ... a linha anda paralela a si mesma; as linhas LIGADAS nas pontas
//                            esticam/encolhem até ela (na direção delas) e os arcos dos cantos vão junto — nada descola
//   nas linhas 2D, arrastar uma ponta leva junto as pontas das outras linhas ligadas nela
//   PAREDE: setas em cima, embaixo, na esquerda e na direita — cima muda a altura, baixo desce/sobe a base (o topo
//           fica), esquerda/direita alongam ou encurtam a parede na direção dela (a outra ponta fica)
// Tudo em DOM/SVG por cima do canvas: os pontos ficam sempre do mesmo tamanho na tela.
import * as THREE from 'three';
import { h, toast } from './ui.js';
import { isSketch, bake, rebuildSketch, planeMatrix, frameOf, worldPoints, samePlane } from './sketch/sketch.js';
import { toolCursor } from './cursors.js';
import { rebuildElement } from './elements.js';
import { fmtLen, fromUnit, toUnit, unitLabel, unitStep } from './units.js';
import { snapSegments, snapPick, showSnapMarker } from './osnap.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const SNAP_PX = 12;
const JOIN = 0.005; // pontas a menos de 5 mm estão ligadas
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
    // losango do meio (linhas 2D): pegar e puxar a linha inteira
    const mid = h('div', { class: 'grip-point grip-mid', title: 'Arraste para puxar a linha (as linhas ligadas acompanham)' });
    mid.addEventListener('pointerdown', e => this.startDrag(e, 2));
    this.points.push(mid);
    // setas da parede: cima, baixo, esquerda (início) e direita (fim)
    const ARROW = { up: 'Arraste para cima ou para baixo: altura da parede', down: 'Arraste: base da parede (o topo fica)',
      left: 'Arraste: alonga ou encurta a parede pelo início', right: 'Arraste: alonga ou encurta a parede pelo fim' };
    this.arrows = Object.fromEntries(Object.entries(ARROW).map(([k, title]) => {
      const a = h('div', { class: `grip-arrow ${k}`, title, hidden: true });
      a.addEventListener('pointerdown', e => this.startWallDrag(e, k));
      return [k, a];
    }));
    this.box = h('div', { class: 'grips', hidden: true }, this.svg, this.label, ...this.points, ...Object.values(this.arrows));
    // pegar a própria linha selecionada (perto dela, na tela) também puxa
    const cv = app.viewer.renderer.domElement;
    cv.addEventListener('pointerdown', e => { if (e.button === 0 && this.nearLine(e)) this.startDrag(e, 2); }, true);
    cv.addEventListener('pointermove', e => {
      if (this.drag) return;
      const near = this.nearLine(e);
      if (near) { cv.style.cursor = toolCursor('puxar'); this._cur = true; } else if (this._cur) { cv.style.cursor = ''; this._cur = false; }
    });
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
    this.points[2].hidden = !el.userData.bim.linha;
    this.points[2].style.transform = `translate(${(a.x + b.x) / 2}px, ${(a.y + b.y) / 2}px)`;
    this.placeArrows(el);
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
    const el = this.el, b = el.userData.bim;
    if (i === 2 && !b.linha) return;
    e.preventDefault(); e.stopImmediatePropagation();
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
    this.drag = { i, el, plane, toData, fromData, data, key: keys[i], other: data[keys[1 - i]], start: [...(data[keys[i]] || [])], snaps: this.snapCandidates(el), moved: false };
    if (b.linha) {
      // linhas ligadas nas pontas (no mesmo plano): acompanham o arraste
      this.drag.links = [0, 1].map(k => (i === 2 || i === k ? this.linksAt([A, B][k], el, i === 2) : []));
      this.drag.A0 = [...data.a]; this.drag.B0 = [...data.b];
      if (i === 2) {
        const hit0 = this.rayHit(e, plane);
        this.drag.grab = hit0 ? toData(hit0) : [(data.a[0] + data.b[0]) / 2, (data.a[1] + data.b[1]) / 2];
        const dx = data.b[0] - data.a[0], dy = data.b[1] - data.a[1], L = Math.hypot(dx, dy) || 1;
        this.drag.n = [-dy / L, dx / L];
        this.drag.key = null;
      }
    }
    (this.points[i] || this.viewer.renderer.domElement).setPointerCapture?.(e.pointerId);
    if (i === 2) this.viewer.renderer.domElement.style.cursor = toolCursor('puxar');
    this.viewer.controls.enabled = false;
  }

  // ------------------------------------------------------------ setas da parede

  /** Pontos (modelo) das setas da parede e a direção de "fora" de cada uma. */
  wallHandles(el) {
    const w = el.userData.bim.wall, m = el.matrixWorld, top = w.base + w.height, mid = w.base + w.height / 2;
    const P = (p, z) => new THREE.Vector3(p[0], p[1], z).applyMatrix4(m);
    const cx = (w.start[0] + w.end[0]) / 2, cy = (w.start[1] + w.end[1]) / 2;
    return {
      up: [P([cx, cy], top), P([cx, cy], top + 1)],
      down: [P([cx, cy], w.base), P([cx, cy], w.base - 1)],
      left: [P(w.start, mid), P([2 * w.start[0] - w.end[0], 2 * w.start[1] - w.end[1]], mid)],
      right: [P(w.end, mid), P([2 * w.end[0] - w.start[0], 2 * w.end[1] - w.start[1]], mid)],
    };
  }

  placeArrows(el) {
    const w = el.userData.bim.wall;
    // parede com perfil próprio (desenhado): cima e baixo ficam no editor do perfil
    const show = { up: !!w && !w.perfil?.length, down: !!w && !w.perfil?.length, left: !!w, right: !!w };
    if (!w) { for (const a of Object.values(this.arrows)) if (!a.hidden) a.hidden = true; return; }
    const hs = this.wallHandles(el);
    for (const [k, a] of Object.entries(this.arrows)) {
      const [p, q] = hs[k], s = this.screen(p), t = this.screen(q);
      if (!show[k] || s.behind) { a.hidden = true; continue; }
      a.hidden = false;
      const ang = Math.atan2(t.y - s.y, t.x - s.x) * 180 / Math.PI;
      // um pouco para fora (10 px), apontando para fora
      const L = Math.hypot(t.x - s.x, t.y - s.y) || 1, ox = (t.x - s.x) / L * 12, oy = (t.y - s.y) / L * 12;
      a.style.transform = `translate(${s.x + ox}px, ${s.y + oy}px) rotate(${ang}deg)`;
    }
  }

  startWallDrag(e, k) {
    if (e.button !== 0 || !this.el?.userData.bim.wall) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const el = this.el, w = el.userData.bim.wall;
    el.updateMatrixWorld(true);
    const inv = el.matrixWorld.clone().invert();
    const [p] = this.wallHandles(el)[k];
    let plane;
    if (k === 'up' || k === 'down') {
      // plano vertical de frente para a câmera, passando pela seta
      const n = new THREE.Vector3().subVectors(this.viewer.camera.position, p); n.z = 0;
      if (n.lengthSq() < 1e-9) n.set(0, 1, 0);
      plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n.normalize(), p);
    } else plane = new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 0, 1).transformDirection(el.matrixWorld), p);
    this.drag = { wall: k, el, plane, inv, start: [...w.start], end: [...w.end], base: w.base, height: w.height, moved: false };
    this.arrows[k].setPointerCapture?.(e.pointerId);
    this.viewer.controls.enabled = false;
  }

  moveWall(e) {
    const d = this.drag, w = d.el.userData.bim.wall;
    const hit = this.rayHit(e, d.plane);
    if (!hit) return;
    const q = hit.clone().applyMatrix4(d.inv);
    const snap = v => Math.round(v / GRID) * GRID;
    let text;
    if (d.wall === 'up') {
      w.height = Math.max(0.05, snap(q.z - d.base));
      text = `altura ${fmtLen(w.height, { suffix: true })}`;
    } else if (d.wall === 'down') {
      const top = d.base + d.height;
      w.base = Math.min(top - 0.05, snap(q.z));
      w.height = +(top - w.base).toFixed(6);
      text = `base ${fmtLen(w.base, { suffix: true })} · altura ${fmtLen(w.height, { suffix: true })}`;
    } else {
      // ao longo do eixo: a outra ponta fica; comprimento novo pela projeção do ponteiro
      const fixed = d.wall === 'left' ? d.end : d.start, moving = d.wall === 'left' ? d.start : d.end;
      const ux = moving[0] - fixed[0], uy = moving[1] - fixed[1], L0 = Math.hypot(ux, uy) || 1;
      const L = Math.max(0.05, snap(((q.x - fixed[0]) * ux + (q.y - fixed[1]) * uy) / L0));
      const p = [fixed[0] + ux / L0 * L, fixed[1] + uy / L0 * L].map(v => +v.toFixed(6));
      w[d.wall === 'left' ? 'start' : 'end'] = p;
      text = `comprimento ${fmtLen(L, { suffix: true })}`;
    }
    d.moved = true;
    this.rebuild(d.el, true);
    const pr = this.box.parentElement.getBoundingClientRect();
    this.tip.textContent = text;
    Object.assign(this.tip.style, { left: `${e.clientX - pr.left + 16}px`, top: `${e.clientY - pr.top + 14}px` });
    this.tip.hidden = false;
  }

  /** O ponteiro está sobre a linha 2D selecionada (a menos de 6 px dela, longe das pontas)? */
  nearLine(e) {
    const el = this.el;
    if (!el?.userData.bim.linha || this.box.hidden || this.drag || this.viewer.tool) return false;
    const [A, B] = this.ends(), a = this.screen(A), b = this.screen(B);
    const dx = b.cx - a.cx, dy = b.cy - a.cy, L2 = dx * dx + dy * dy;
    if (L2 < 400) return false;
    const t = ((e.clientX - a.cx) * dx + (e.clientY - a.cy) * dy) / L2;
    if (t < 0.08 || t > 0.92) return false;
    return Math.hypot(a.cx + dx * t - e.clientX, a.cy + dy * t - e.clientY) < 6;
  }

  rayHit(e, plane) {
    const r = this.viewer.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1), this.viewer.camera);
    return ray.ray.intersectPlane(plane, new THREE.Vector3());
  }

  /**
   * Linhas 2D ligadas no ponto P (modelo), no mesmo plano da linha arrastada: { el, key, orig, inv, M, arc, next }.
   * Com deep, os arcos ligados guardam também as linhas ligadas na outra ponta deles (vão junto quando o arco anda).
   */
  linksAt(P, except, deep, seen = new Set([except])) {
    const f0 = frameOf(except.userData.bim.linha), out = [];
    for (const n of this.viewer.elements()) {
      const l = n.userData.bim?.linha;
      if (!l || seen.has(n) || !n.visible || !n.parent || !samePlane(frameOf(l), f0)) continue;
      n.updateMatrixWorld(true);
      const pts = worldPoints(l).map(v => v.applyMatrix4(n.matrixWorld));
      const key = pts[0].distanceTo(P) < JOIN ? 'a' : pts[pts.length - 1].distanceTo(P) < JOIN ? 'b' : null;
      if (!key) continue;
      if (l.arco && !deep) continue; // ponta solta de arco: o arco não estica
      seen.add(n);
      bake(n);
      const M = planeMatrix(frameOf(l));
      const link = { el: n, key, orig: JSON.parse(JSON.stringify(l)), M, inv: M.clone().invert(), arc: !!l.arco, next: [] };
      if (link.arc) {
        const far = (key === 'a' ? pts[pts.length - 1] : pts[0]);
        link.next = this.linksAt(far, except, false, seen).filter(x => !x.arc);
      }
      out.push(link);
    }
    return out;
  }

  /** Move a ponta de uma linha ligada para W (modelo). */
  setLinkEnd(lk, W) {
    const q = W.clone().applyMatrix4(lk.inv);
    lk.el.userData.bim.linha[lk.key] = [q.x, q.y];
    rebuildSketch(lk.el);
  }

  /** Arco ligado (e as linhas presas na outra ponta dele) deslocado de Dw (modelo). */
  shiftArc(lk, Dw) {
    const l = lk.el.userData.bim.linha, o = lk.orig;
    const d0 = new THREE.Vector3().applyMatrix4(lk.inv), d1 = Dw.clone().applyMatrix4(lk.inv).sub(d0);
    const s = p => [p[0] + d1.x, p[1] + d1.y];
    l.a = s(o.a); l.b = s(o.b);
    l.arco = { ...o.arco, c: s(o.arco.c) };
    rebuildSketch(lk.el);
    for (const nx of lk.next) {
      const w = new THREE.Vector3(...nx.orig[nx.key], 0).applyMatrix4(nx.M).add(Dw);
      this.setLinkEnd(nx, w);
    }
  }

  /** Puxar a linha: deslocamento perpendicular t (dados da linha) e as ligações acompanhando. */
  applyPull(t) {
    const d = this.drag, n = d.n;
    const D = [n[0] * t, n[1] * t];
    d.data.a = [d.A0[0] + D[0], d.A0[1] + D[1]];
    d.data.b = [d.B0[0] + D[0], d.B0[1] + D[1]];
    const Dw = d.fromData(D).sub(d.fromData([0, 0]));
    const dir = [d.B0[0] - d.A0[0], d.B0[1] - d.A0[1]];
    for (let k = 0; k < 2; k++) {
      const P = k ? d.data.b : d.data.a;
      let corner = null; // a ponta da linha puxada vai para o encontro com a 1ª linha ligada (não paralela)
      for (const lk of d.links[k]) {
        if (lk.arc) { this.shiftArc(lk, Dw); continue; }
        // a linha ligada estica/encolhe na direção dela até a linha nova (paralelas: anda junto)
        const o = lk.orig, other = o[lk.key === 'a' ? 'b' : 'a'];
        const F = d.toData(new THREE.Vector3(...other, 0).applyMatrix4(lk.M));
        const E = d.toData(new THREE.Vector3(...o[lk.key], 0).applyMatrix4(lk.M));
        const v = [E[0] - F[0], E[1] - F[1]];
        const cr = v[0] * dir[1] - v[1] * dir[0];
        let W;
        if (Math.abs(cr) < 1e-9 * Math.hypot(...v) * Math.hypot(...dir) + 1e-12) W = [E[0] + D[0], E[1] + D[1]];
        else {
          const s = ((P[0] - F[0]) * dir[1] - (P[1] - F[1]) * dir[0]) / cr;
          W = [F[0] + v[0] * s, F[1] + v[1] * s];
          corner = corner || W;
        }
        this.setLinkEnd(lk, d.fromData(W));
      }
      if (corner) d.data[k ? 'b' : 'a'] = corner;
    }
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
    if (d.wall) return this.moveWall(e);
    const r = this.viewer.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.viewer.camera);
    const hit = ray.ray.intersectPlane(d.plane, new THREE.Vector3());
    if (!hit) return;
    let p = d.toData(hit), snapped = false, kind = null;
    if (d.i === 2) return this.movePull(e, hit, p);
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
    // linhas ligadas nesta ponta vão junto
    for (const lk of d.links?.[d.i] || []) this.setLinkEnd(lk, d.fromData(p));
    // dica e marcador de snap
    const pr = this.box.parentElement.getBoundingClientRect();
    const s = this.screen(d.fromData(p));
    showSnapMarker(this.marker, snapped ? kind : null, s.x, s.y);
    const L = Math.hypot(p[0] - d.other[0], p[1] - d.other[1]);
    this.tip.textContent = `${fmtLen(L, { suffix: true })}${snapped ? `  ◻ ${kind}` : ''}`;
    Object.assign(this.tip.style, { left: `${e.clientX - pr.left + 16}px`, top: `${e.clientY - pr.top + 14}px` });
    this.tip.hidden = false;
  }

  /** Arraste do corpo da linha: distância perpendicular (com snap do projeto e grade). */
  movePull(e, hit, p) {
    const d = this.drag, n = d.n;
    let t = (p[0] - d.grab[0]) * n[0] + (p[1] - d.grab[1]) * n[1], kind = null;
    if (Math.abs(d.plane.normal.z) > 0.999) {
      const toS = q => { const s = this.screen(new THREE.Vector3(q[0], q[1], hit.z)); return [s.cx, s.cy]; };
      const except = [d.el, ...d.links.flat().flatMap(l => [l.el, ...l.next.map(x => x.el)])];
      const best = snapPick({ segs: snapSegments(this.app, { except }), toScreen: toS, cursor: [e.clientX, e.clientY] });
      if (best) { const q = d.toData(new THREE.Vector3(best.p[0], best.p[1], hit.z)); t = (q[0] - d.A0[0]) * n[0] + (q[1] - d.A0[1]) * n[1]; kind = best.kind; }
    }
    if (!kind) t = Math.round(t / GRID) * GRID;
    this.applyPull(t);
    d.moved = true;
    this.rebuild(d.el, true);
    const pr = this.box.parentElement.getBoundingClientRect();
    const s = this.screen(d.fromData([(d.data.a[0] + d.data.b[0]) / 2, (d.data.a[1] + d.data.b[1]) / 2]));
    showSnapMarker(this.marker, kind, s.x, s.y);
    this.tip.textContent = `↔ ${fmtLen(Math.abs(t), { suffix: true })}${kind ? `  ◻ ${kind}` : ''}`;
    Object.assign(this.tip.style, { left: `${e.clientX - pr.left + 16}px`, top: `${e.clientY - pr.top + 14}px` });
    this.tip.hidden = false;
  }

  endDrag() {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    this.viewer.controls.enabled = true;
    this.tip.hidden = true; this.marker.hidden = true;
    if (d.i === 2) { this.viewer.renderer.domElement.style.cursor = ''; this._cur = false; }
    if (d.moved) {
      for (const lk of (d.links || []).flat().flatMap(l => [l, ...l.next])) this.viewer._prepare2D(lk.el);
      this.commit(d.el);
    }
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
    const next = [p0[0] + (p1[0] - p0[0]) / cur * L, p0[1] + (p1[1] - p0[1]) / cur * L].map(v => +v.toFixed(6));
    // linha 2D: as linhas ligadas na ponta que anda acompanham (a perpendicular vai junto, paralela a si mesma)
    const touched = b.linha ? this.followEnd(el, [...p1], next) : [];
    d[k1] = next;
    for (const n of touched) this.viewer._prepare2D(n);
    this.commit(el);
    this.app.status(`Comprimento: ${fmtLen(L, { suffix: true })}.`);
  }

  /**
   * A ponta oldP da linha el vai para newP (dados da linha): as linhas ligadas nela acompanham. Reta ligada (não
   * paralela) anda junto, paralela a si mesma, passando pela ponta nova, e as linhas presas na outra ponta dela
   * esticam ou encolhem até ela. Reta na mesma direção só estica ou encolhe. Arco ligado anda inteiro, e as retas
   * presas nele seguem a mesma regra. Devolve os elementos mexidos.
   */
  followEnd(el, oldP, newP) {
    const l = el.userData.bim.linha, M = planeMatrix(frameOf(l)), inv = M.clone().invert();
    const toD = w => { const q = w.clone().applyMatrix4(inv); return [q.x, q.y]; };
    const fromD = p => new THREE.Vector3(p[0], p[1], 0).applyMatrix4(M);
    const own = lk => ({ to: p => toD(new THREE.Vector3(p[0], p[1], 0).applyMatrix4(lk.M)), set: (key, p) => { const q = fromD(p).applyMatrix4(lk.inv); lk.el.userData.bim.linha[key] = [+q.x.toFixed(6), +q.y.toFixed(6)]; } });
    const D = [newP[0] - oldP[0], newP[1] - oldP[1]];
    const seen = new Set([el]), touched = [];
    const carry = (lk, P) => {
      const o = lk.orig, ok = lk.key === 'a' ? 'b' : 'a', f = own(lk);
      const E = f.to(o[lk.key]), F = f.to(o[ok]), u = [F[0] - E[0], F[1] - E[1]], uu = u[0] * u[0] + u[1] * u[1] || 1;
      const dd = [P[0] - E[0], P[1] - E[1]];
      touched.push(lk.el);
      if (Math.abs(u[0] * dd[1] - u[1] * dd[0]) < 1e-9 * Math.sqrt(uu) * Math.hypot(...dd) + 1e-12) { f.set(lk.key, P); rebuildSketch(lk.el); return; }
      // anda paralela a si mesma: só a parte do deslocamento que é perpendicular a ela
      const al = (dd[0] * u[0] + dd[1] * u[1]) / uu, tv = [dd[0] - u[0] * al, dd[1] - u[1] * al];
      const F2 = [F[0] + tv[0], F[1] + tv[1]];
      const far = this.linksAt(fromD(F), el, false, seen); // antes de mexer: acha pela posição atual
      f.set(lk.key, P); f.set(ok, F2); rebuildSketch(lk.el);
      for (const g of far) {
        const go = g.orig, gk = g.key === 'a' ? 'b' : 'a', gf = own(g);
        const Ge = gf.to(go[g.key]), Gf = gf.to(go[gk]), v = [Ge[0] - Gf[0], Ge[1] - Gf[1]];
        const cr = v[0] * u[1] - v[1] * u[0];
        let W;
        if (Math.abs(cr) < 1e-9 * Math.hypot(...v) * Math.sqrt(uu) + 1e-12) W = [Ge[0] + tv[0], Ge[1] + tv[1]];
        else { const s = ((P[0] - Gf[0]) * u[1] - (P[1] - Gf[1]) * u[0]) / cr; W = [Gf[0] + v[0] * s, Gf[1] + v[1] * s]; }
        gf.set(g.key, W); rebuildSketch(g.el); touched.push(g.el);
      }
    };
    for (const lk of this.linksAt(fromD(oldP), el, true, seen)) {
      if (!lk.arc) { carry(lk, newP); continue; }
      // arco: anda inteiro; as retas presas na outra ponta dele seguem a outra ponta
      const o = lk.orig, f = own(lk), sh = p => { const q = f.to(p); return [q[0] + D[0], q[1] + D[1]]; };
      const farKey = lk.key === 'a' ? 'b' : 'a', farNew = sh(o[farKey]);
      f.set('a', sh(o.a)); f.set('b', sh(o.b));
      const c = fromD(sh(o.arco.c)).applyMatrix4(lk.inv);
      lk.el.userData.bim.linha.arco = { ...o.arco, c: [+c.x.toFixed(6), +c.y.toFixed(6)] };
      rebuildSketch(lk.el); touched.push(lk.el);
      for (const nx of lk.next) carry(nx, farNew);
    }
    return touched;
  }
}
