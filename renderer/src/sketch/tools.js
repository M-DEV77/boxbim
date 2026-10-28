// FERRAMENTAS DE DESENHO 2D (plano do nível da vista; plantas e vista 3D):
//   Linha ....... polilinha: clique pontos · número + Enter = comprimento · C fecha · Enter/botão dir. termina
//   Retângulo ... dois cantos            Círculo ... centro e raio (clique ou número + Enter)
//   Seleção ..... clique seleciona; arrastar da esquerda p/ direita = janela (só o que está inteiro dentro),
//                 da direita p/ esquerda = cruzamento (o que encosta); Shift soma
//   Aparar ...... clique no trecho a remover (as outras linhas cortam)
//   Estender .... clique perto da ponta: vai até a próxima linha
//   Canto ....... clique duas linhas: vivo (sem raio), arredondado (raio) ou chanfro (distância + ângulo°)
//   Eixo ........ dois pontos: cria um eixo de trabalho vertical por eles (workplanes.js)
//   Linhas do sólido  clique numa aresta (ou face) de um sólido: vira linha 2D no plano da face (ou projetada)
//   Offset ...... distância + clique do lado: cópia paralela da linha, arco, círculo ou cadeia de linhas
// Aparar, Estender, Canto e Offset valem também para paredes, vigas e varreduras (canos…) no plano do nível
// (linear.js): o eixo delas entra como uma linha.
// Snap em pontas, meios, centros e quadrantes; ORTO (F8, compartilhado com as paredes); Esc sai.
// O plano do desenho é o do nível da vista ou o EIXO DE TRABALHO ativo (this.frame).
// Extrudar, Varrer e Cortar com vazio são comandos sobre a seleção (sketchCommands).
import * as THREE from 'three';
import { h, toast, formDialog, floatBar } from '../ui.js';
import { createSketch, rebuildSketch, isSketch, bake, trim, extend, corner, snapPointsOf, distToSeg, chainSegments, outerWithHoles, dist, segPoints, planeMatrix, frameOf, samePlane, toFrame, worldPoints, offsetPolyline, offsetLoop, area, pointInPoly, isCircle } from './sketch.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createForm, isVoid, isForm, rebuildForm } from './forms.js';
import { createOnLevel } from '../modeling.js';
import { fmtElev } from '../levels.js';
import { uuid, rebuildElement as rebuildElementLazy } from '../elements.js';
import { styleControls, DEFAULT_STYLE } from './style.js';
import { sweepFromGroups } from './sweep.js';
import { handlesOf, linearKind, offsetPlan, offsetLinear, KIND_LABEL } from './linear.js';
import { fmtLen, fromUnit, toUnit, unitLabel, unitStep } from '../units.js';
import { toolCursor } from '../cursors.js';

const SNAP_PX = 12;
const GRID = 0.01;
const fmtM = v => fmtLen(v);
const RUBBER = new THREE.LineDashedMaterial({ color: 0x1fbf3b, dashSize: 0.2, gapSize: 0.1, depthTest: false });
const store = (k, v) => { try { localStorage.setItem(k, v); } catch { /* sem armazenamento */ } };
const load = k => { try { return localStorage.getItem(k); } catch { return null; } };

export const SKETCH_MODES = {
  selecao: { label: 'Seleção', tip: 'Clique seleciona · arraste → janela (inteiro dentro) · arraste ← cruzamento (encosta) · Shift soma · Esc sai.' },
  linha: { label: 'Linha', tip: 'Clique os pontos · número + Enter = comprimento · C fecha · Enter/botão direito termina · F8 ORTO · Esc sai.' },
  retangulo: { label: 'Retângulo', tip: 'Clique um canto e o canto oposto · Esc sai.' },
  circulo: { label: 'Círculo', tip: 'Clique o centro e um ponto do círculo (ou digite o raio + Enter) · Esc sai.' },
  aparar: { label: 'Aparar', tip: 'Clique no trecho da linha a remover (as outras linhas cortam) · Esc sai.' },
  estender: { label: 'Estender', tip: 'Clique perto da ponta da linha: ela vai até a próxima linha · Esc sai.' },
  canto: { label: 'Canto', tip: 'Clique a primeira e a segunda linha (no lado que deve ficar) · Esc sai.' },
  eixo: { label: 'Eixo de trabalho', tip: 'Clique dois pontos: o eixo vertical passa por eles · Esc sai.' },
  arestas: { label: 'Linhas do sólido', tip: 'Clique numa aresta de um sólido (Aresta) ou numa face (Contorno da face) · Esc sai.' },
  offset: { label: 'Offset', tip: 'Passe o mouse do lado desejado da linha e clique: cópia paralela na distância · Esc sai.' },
};

export class SketchTool extends EventTarget {
  constructor(app) {
    super();
    this.app = app;
    this.active = false;
    this.mode = null;
    this.edgeMode = load('boxbim.arestaModo') === 'face' ? 'face' : 'aresta';
    this.edgeProject = load('boxbim.arestaProj') === '1';
    this.offsetDist = Number(load('boxbim.offsetDist')) || 0.15;
    this.offsetChain = load('boxbim.offsetChain') !== '0';
    this.corner = { modo: load('boxbim.cantoModo') || 'vivo', raio: Number(load('boxbim.cantoRaio')) || 0.5, distancia: Number(load('boxbim.cantoDist')) || 0.3, angulo: Number(load('boxbim.cantoAng')) || 45 };
  }

  get viewer() { return this.app.viewer; }
  get ortho() { return this.app.wallTool.ortho; }

  start(mode) {
    if (this.active) this.stop();
    const v = this.app.views.active;
    const wp = mode === 'eixo' ? null : this.app.workPlanes?.active;
    if (v.kind === 'elevation' && !wp) { toast('O desenho 2D é no plano do nível ou de um eixo de trabalho: abra uma planta, a vista 3D ou ative um eixo.', 'error'); return; }
    if (this.app.wallTool.active) this.app.wallTool.stop();
    if (this.app.placeTool.active) this.app.placeTool.stop();
    if (this.app.transformTool.mode) this.app.transformTool.stop();
    this.mode = mode;
    this.level = this.app.views.activeLevel() || this.app.levels.list[0];
    // editando o contorno de um piso: o nível é o do piso (o plano fica na cota do topo dele — ver setFrame)
    const fs = this.app.floorSketch?.active;
    if (fs && !wp) this.level = this.app.levels.ofElement(fs.el) || this.level;
    this.setFrame(wp);
    this.active = true;
    this.pts = [];         // pontos da operação em curso
    this.picked = null;    // canto: primeira linha
    this.typed = '';
    this.viewer.tool = this;
    if (mode !== 'selecao') this.viewer.select([]);
    this.group = new THREE.Group();
    this.viewer.overlay.add(this.group);
    const c = this.viewer.controls;
    this._saved = { controls: c, buttons: { ...c.mouseButtons } };
    c.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: mode === 'selecao' ? c.mouseButtons.RIGHT : null };
    const el = this.viewer.renderer.domElement;
    this._h = {
      move: e => this.move(e), down: e => this.down(e), up: e => this.up(e),
      ctx: e => e.preventDefault(), key: e => this.key(e),
      leave: () => { this.tip.hidden = true; this.marker.hidden = true; },
      view: () => this.onView(),
    };
    el.addEventListener('pointermove', this._h.move);
    el.addEventListener('pointerdown', this._h.down);
    el.addEventListener('pointerup', this._h.up);
    el.addEventListener('contextmenu', this._h.ctx);
    el.addEventListener('pointerleave', this._h.leave);
    document.addEventListener('keydown', this._h.key, true);
    this.app.views.addEventListener('activate', this._h.view);
    el.style.cursor = mode === 'selecao' ? 'default' : toolCursor(mode);
    this.buildBar();
    this.app.status(`${SKETCH_MODES[mode].label}: ${SKETCH_MODES[mode].tip}`);
    this.dispatchEvent(new Event('change'));
  }

  stop() {
    if (!this.active) return;
    this.finish();
    this.active = false;
    const el = this.viewer.renderer.domElement;
    el.removeEventListener('pointermove', this._h.move);
    el.removeEventListener('pointerdown', this._h.down);
    el.removeEventListener('pointerup', this._h.up);
    el.removeEventListener('contextmenu', this._h.ctx);
    el.removeEventListener('pointerleave', this._h.leave);
    document.removeEventListener('keydown', this._h.key, true);
    this.app.views.removeEventListener('activate', this._h.view);
    el.style.cursor = '';
    if (this._saved) { this._saved.controls.mouseButtons = this._saved.buttons; this._saved = null; }
    this.clearPreview();
    this.viewer.overlay.remove(this.group);
    this.bar?.remove(); this.tip?.remove(); this.marker?.remove(); this.box?.remove();
    this.viewer.tool = null;
    this.mode = null;
    this.app.status('Pronto.');
    this.dispatchEvent(new Event('change'));
  }

  /**
   * Plano do desenho: o eixo de trabalho dado ou o horizontal do nível. Editando o contorno de um piso (clique duplo),
   * o horizontal fica na cota das linhas do contorno — Aparar, Estender, Canto, Offset… trabalham nelas.
   */
  setFrame(wp) {
    this.workPlane = wp || null;
    const fs = this.app.floorSketch?.active;
    this.frame = wp ? { plano: this.app.workPlanes.frameOf(wp), z: 0 } : { plano: null, z: fs ? fs.z : this.level.elevation };
    this.matrix = planeMatrix(this.frame.plano || { o: [0, 0, this.frame.z], u: [1, 0, 0], v: [0, 1, 0] });
    this.inverse = this.matrix.clone().invert();
  }

  toWorld([x, y], dz = 0) { return new THREE.Vector3(x, y, dz).applyMatrix4(this.matrix); }

  /** Dados de linha no formato deste plano (z, plano). */
  canon(l) {
    const out = { arco: null, ...l, z: this.frame.z };
    if (this.frame.plano) out.plano = this.frame.plano; else delete out.plano;
    return out;
  }

  /** A linha do elemento nas coordenadas deste plano. */
  local(el) { return toFrame(bake(el).userData.bim.linha, this.frame); }

  onView() {
    if (this.app.views.active.kind === 'elevation' && !this.workPlane) { this.stop(); return; }
    this.finish();
    const lvl = this.app.views.activeLevel();
    if (lvl) this.level = lvl;
    const m = this.mode;
    this.stop();
    this.start(m);
  }

  // ------------------------------------------------------------ barra (no fim da faixa) e dicas

  buildBar() {
    const fields = [];
    if (['linha', 'retangulo', 'circulo'].includes(this.mode)) {
      const ob = h('button', { class: `toggle${this.ortho ? ' on' : ''}`, title: 'ORTO (F8)', onclick: () => { this.app.wallTool.toggleOrtho(); ob.classList.toggle('on', this.ortho); } }, 'ORTO');
      fields.push(ob);
      if (this.mode === 'linha') fields.push(h('button', { onclick: () => this.finish(), title: 'Termina a polilinha (Enter)' }, 'Terminar'));
      // estilo das linhas novas: tipo, espessura (pena) e cor
      fields.push(h('span', { class: 'style-ctl', title: 'Estilo das linhas novas' }, ...styleControls(this.newStyle || DEFAULT_STYLE, patch => { this.newStyle = { ...DEFAULT_STYLE, ...(this.newStyle || {}), ...patch }; }, { compact: true })));
    }
    if (this.mode === 'arestas') {
      const pick = h('select', { title: 'O que vira linha', onchange: e => { this.edgeMode = e.target.value; store('boxbim.arestaModo', this.edgeMode); } },
        [['aresta', 'Aresta'], ['face', 'Contorno da face'], ['piso', 'Piso do contorno da face']].map(([v, l]) => h('option', { value: v, selected: v === this.edgeMode }, l)));
      const proj = h('input', { type: 'checkbox', checked: this.edgeProject, onchange: e => { this.edgeProject = e.target.checked; store('boxbim.arestaProj', this.edgeProject ? '1' : '0'); } });
      fields.push(h('label', {}, 'Pegar', pick), h('label', { title: 'Projeta a linha no plano do desenho (nível ou eixo de trabalho ativo) em vez de ficar no plano da face' }, proj, 'Projetar no plano do desenho'));
    }
    if (this.mode === 'offset') {
      const dIn = h('input', { type: 'number', step: 'any', min: 0, value: toUnit(this.offsetDist), style: 'width:70px', onchange: e => { this.offsetDist = Math.max(0, fromUnit(e.target.value) || 0); store('boxbim.offsetDist', this.offsetDist); } });
      const ch = h('input', { type: 'checkbox', checked: this.offsetChain, onchange: e => { this.offsetChain = e.target.checked; store('boxbim.offsetChain', this.offsetChain ? '1' : '0'); } });
      fields.push(h('label', {}, `Distância (${unitLabel()})`, dIn), h('label', { title: 'Linhas ligadas pelas pontas são deslocadas juntas (cantos em esquadria)' }, ch, 'Cadeia inteira'));
    }
    if (this.mode === 'canto') {
      const c = this.corner;
      const save = () => { store('boxbim.cantoModo', c.modo); store('boxbim.cantoRaio', c.raio); store('boxbim.cantoDist', c.distancia); store('boxbim.cantoAng', c.angulo); sync(); };
      const modo = h('select', { onchange: e => { c.modo = e.target.value; save(); } },
        [['vivo', 'Vivo (sem raio)'], ['raio', 'Arredondado (raio)'], ['chanfro', 'Chanfro (com graus)']].map(([v, l]) => h('option', { value: v, selected: v === c.modo }, l)));
      const num = (k, step, len = true) => h('input', { type: 'number', step, min: 0, value: len ? toUnit(c[k]) : c[k], style: 'width:64px', onchange: e => { c[k] = len ? fromUnit(e.target.value) || 0 : Number(e.target.value) || 0; save(); } });
      const raio = h('label', {}, `Raio (${unitLabel()})`, num('raio', unitStep()));
      const dd = h('label', {}, `Distância (${unitLabel()})`, num('distancia', unitStep()));
      const ang = h('label', {}, 'Ângulo (°)', num('angulo', 5, false));
      const sync = () => { raio.hidden = c.modo !== 'raio'; dd.hidden = ang.hidden = c.modo !== 'chanfro'; };
      sync();
      fields.push(h('label', {}, 'Canto', modo), raio, dd, ang);
    }
    this.bar = h('div', { class: 'draw-bar transform-bar sketch-bar' },
      h('strong', {}, `✎ ${SKETCH_MODES[this.mode].label}`),
      this.mode === 'eixo' ? h('span', { class: 'muted small' }, this.level ? `${this.level.name}` : '') : this.planeSelect(),
      ...fields,
      h('button', { class: 'primary', onclick: () => this.stop(), title: 'Sai da ferramenta (Esc)' }, 'Sair'));
    floatBar(this.bar, 'desenho'); // flutuante na vista, arrastável
    const center = document.querySelector('.center');
    this.tip = h('div', { class: 'draw-tip', hidden: true });
    this.marker = h('div', { class: 'snap-marker', hidden: true });
    this.box = h('div', { class: 'select-box', hidden: true });
    center.append(this.tip, this.marker, this.box);
  }

  /** Escolha do plano de desenho (nível da vista ou um eixo de trabalho). */
  planeSelect() {
    const wps = this.app.workPlanes?.list() || [];
    return h('select', { title: 'Plano do desenho', onchange: e => {
      const wp = wps.find(w => w.userData.bim.guid === e.target.value) || null;
      this.app.workPlanes.activate(wp);
      const m = this.mode;
      this.stop();
      this.start(m);
    } },
    h('option', { value: '' }, `Plano: ${this.level?.name || 'nível'}`),
    wps.map(w => h('option', { value: w.userData.bim.guid, selected: w === this.workPlane }, `Eixo: ${w.userData.bim.name}`)));
  }

  // ------------------------------------------------------------ geometria do cursor

  worldAt(e) {
    const el = this.viewer.renderer.domElement, r = el.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.viewer.camera);
    const n = new THREE.Vector3().setFromMatrixColumn(this.matrix, 2);
    // plano visto de lado (ex.: eixo vertical numa planta): não dá para desenhar nele
    if (Math.abs(ray.ray.direction.dot(n)) < 0.02) return null;
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, new THREE.Vector3().setFromMatrixPosition(this.matrix));
    const hit = ray.ray.intersectPlane(plane, new THREE.Vector3());
    if (!hit) return null;
    hit.applyMatrix4(this.inverse);
    return [hit.x, hit.y];
  }

  toScreen(p) {
    const el = this.viewer.renderer.domElement;
    const q = this.toWorld(p).project(this.viewer.camera);
    return [(q.x + 1) / 2 * el.clientWidth, (1 - q.y) / 2 * el.clientHeight];
  }

  /** Linhas do desenho neste plano (com a transformação já nos dados). */
  sketches() {
    const f = this.frame.plano || { o: [0, 0, this.frame.z], u: [1, 0, 0], v: [0, 1, 0] };
    return this.viewer.elements().filter(e => isSketch(e) && e.visible && samePlane(frameOf(bake(e).userData.bim.linha), f));
  }

  snapCandidates() {
    const out = [];
    for (const e of this.sketches()) for (const c of snapPointsOf(this.local(e))) out.push(c);
    if (this.pts.length >= 2) out.push({ p: this.pts[0], kind: 'início' });
    // pontas das paredes do nível
    for (const e of this.frame.plano ? [] : this.viewer.elements()) {
      const w = e.userData.bim?.wall;
      if (!w || this.app.levels.ofElement(e) !== this.level) continue;
      e.updateMatrixWorld(true);
      for (const q of [w.start, w.end]) { const v = new THREE.Vector3(q[0], q[1], 0).applyMatrix4(e.matrixWorld); out.push({ p: [v.x, v.y], kind: 'ponta de parede' }); }
    }
    return out;
  }

  resolve(e) {
    const raw = this.worldAt(e);
    if (!raw) return null;
    const rs = this.toScreen(raw);
    let best = null, bestD = SNAP_PX;
    const last = this.pts[this.pts.length - 1];
    for (const c of this.snapCandidates()) {
      if (last && dist(c.p, last) < 1e-6) continue;
      const s = this.toScreen(c.p);
      const d = Math.hypot(s[0] - rs[0], s[1] - rs[1]);
      if (d < bestD) { bestD = d; best = c; }
    }
    if (best) return { p: [...best.p], snap: best.kind };
    let p = raw;
    // ORTO não vale para círculo nem retângulo (os lados do retângulo já são 0°/90°; travar zeraria uma medida)
    const ortho = this.ortho !== !!e.shiftKey && !['circulo', 'retangulo'].includes(this.mode);
    if (last && ortho) {
      const dx = p[0] - last[0], dy = p[1] - last[1];
      p = Math.abs(dx) >= Math.abs(dy) ? [p[0], last[1]] : [last[0], p[1]];
    }
    p = p.map(v => Math.round(v / GRID) * GRID);
    return { p, ortho };
  }

  /**
   * Trechos que as ferramentas de edição enxergam: linhas 2D deste plano e, no plano do nível, os eixos de paredes,
   * vigas e varreduras. { kind, el, l, apply(pedaços) }.
   */
  handles() {
    const out = this.sketches().map(el => ({ kind: 'linha', el, l: this.local(el), apply: pieces => this.replace(el, pieces) }));
    if (!this.frame.plano) {
      for (const el of this.viewer.elements()) {
        if (!el.visible || !linearKind(el)) continue;
        if (linearKind(el) !== 'varredura' && this.app.levels.ofElement(el) !== this.level) continue;
        out.push(...handlesOf(this.app, el));
      }
      // lados dos pisos deste nível (contorno e furos): o Canto da faixa funciona neles
      for (const el of this.viewer.elements()) {
        const s = el.userData.bim?.slab;
        if (!s || !el.visible || this.app.levels.ofElement(el) !== this.level) continue;
        el.updateMatrixWorld(true);
        const W = ([x, y]) => { const v = new THREE.Vector3(x, y, s.elevation).applyMatrix4(el.matrixWorld); return [v.x, v.y]; };
        [s.points, ...(s.holes || [])].forEach((ring, r) => ring.forEach((p, k) => {
          out.push({ kind: 'piso', el, i: r * 100000 + k, ring: r, edge: k, l: { a: W(p), b: W(ring[(k + 1) % ring.length]), arco: null, z: 0 }, apply: () => {} });
        }));
      }
    }
    return out;
  }

  /** Trecho (linha ou eixo de elemento linear) sob o cursor (até 10 px). */
  pickHandle(e) {
    const raw = this.worldAt(e);
    if (!raw) return null;
    const px = this.worldPerPixel();
    let best = null, bestD = 10 * px;
    for (const hd of this.handles()) {
      const d = distToSeg(hd.l, raw);
      if (d < bestD) { bestD = d; best = hd; }
    }
    return best ? { ...best, p: raw } : null;
  }

  /** Linha do desenho sob o cursor (até 10 px). */
  pickSketch(e) {
    const raw = this.worldAt(e);
    if (!raw) return null;
    const px = this.worldPerPixel();
    let best = null, bestD = 10 * px;
    for (const el of this.sketches()) {
      const d = distToSeg(this.local(el), raw);
      if (d < bestD) { bestD = d; best = el; }
    }
    return best ? { el: best, p: raw } : null;
  }

  worldPerPixel() {
    const a = this.worldAt({ clientX: 100, clientY: 100 }), b = this.worldAt({ clientX: 101, clientY: 100 });
    return a && b ? dist(a, b) : 0.01;
  }

  // ------------------------------------------------------------ prévia

  clearPreview() { for (const c of [...(this.group?.children || [])]) { this.group.remove(c); c.geometry?.dispose(); } }

  previewPts(pts, closed = false) {
    const v = pts.map(p => this.toWorld(p, 0.003));
    if (closed && v.length) v.push(v[0].clone());
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(v), RUBBER);
    line.computeLineDistances();
    line.renderOrder = 10;
    this.group.add(line);
  }

  showTip(res, text) {
    const cr = this.viewer.renderer.domElement.getBoundingClientRect(), pr = this.tip.parentElement.getBoundingClientRect();
    let [sx, sy] = this.toScreen(res.p);
    sx += cr.left - pr.left; sy += cr.top - pr.top;
    this.marker.hidden = !res.snap;
    if (res.snap) Object.assign(this.marker.style, { left: `${sx}px`, top: `${sy}px` });
    this.tip.textContent = text + (this.typed ? `  ⌨ ${this.typed.replace('.', ',')} ${unitLabel()}` : '') + (res.snap ? `  ◻ ${res.snap}` : res.ortho ? '  ORTO' : '');
    this.tip.hidden = false;
    Object.assign(this.tip.style, { left: `${sx + 16}px`, top: `${sy + 14}px` });
  }

  // ------------------------------------------------------------ eventos

  move(e) {
    this.lastEvent = e;
    if (this.mode === 'selecao') return this.moveBox(e);
    if (this.mode === 'arestas') return this.moveEdges(e);
    if (this.mode === 'offset') return this.moveOffset(e);
    if (['aparar', 'estender', 'canto'].includes(this.mode)) {
      const hit = this.pickHandle(e);
      this.clearPreview();
      if (hit) this.previewPts(segPoints(hit.l));
      this.tip.hidden = !hit || hit.kind === 'linha';
      if (hit && hit.kind !== 'linha') {
        const pr = this.tip.parentElement.getBoundingClientRect();
        this.tip.textContent = `${KIND_LABEL[hit.kind]}: ${hit.el.userData.bim.name || ''}`;
        Object.assign(this.tip.style, { left: `${e.clientX - pr.left + 16}px`, top: `${e.clientY - pr.top + 14}px` });
      }
      return;
    }
    const res = this.resolve(e);
    this.cursor = res;
    if (!res) return;
    this.clearPreview();
    const last = this.pts[this.pts.length - 1];
    let text = `x ${fmtM(res.p[0])}  y ${fmtM(res.p[1])}`;
    if (this.mode === 'linha' && last) {
      this.previewPts([...this.pts, res.p]);
      const d = dist(last, res.p);
      let ang = Math.atan2(res.p[1] - last[1], res.p[0] - last[0]) * 180 / Math.PI; if (ang < 0) ang += 360;
      text = `${fmtLen(d, { suffix: true })}  ∠ ${ang.toFixed(1).replace('.', ',')}°`;
    } else if (this.mode === 'eixo' && last) {
      this.previewPts([last, res.p]);
      text = `eixo: ${fmtLen(dist(last, res.p), { suffix: true })}`;
    } else if (this.mode === 'retangulo' && last) {
      const [a, b] = [last, res.p];
      this.previewPts([a, [b[0], a[1]], b, [a[0], b[1]]], true);
      text = `${fmtM(Math.abs(b[0] - a[0]))} × ${fmtLen(Math.abs(b[1] - a[1]), { suffix: true })}`;
    } else if (this.mode === 'circulo' && last) {
      const r = dist(last, res.p);
      this.previewPts(Array.from({ length: 65 }, (_, i) => [last[0] + r * Math.cos(i / 64 * Math.PI * 2), last[1] + r * Math.sin(i / 64 * Math.PI * 2)]));
      text = `raio ${fmtLen(r, { suffix: true })}`;
    }
    this.showTip(res, text);
  }

  down(e) {
    if (e.button === 2 && this.mode !== 'selecao') { e.preventDefault(); this.finish(); return; }
    if (e.button !== 0) return;
    if (this.mode === 'selecao') { this.boxStart = { x: e.clientX, y: e.clientY }; return; }
    if (this.mode === 'arestas') { this.createFromEdges(e); return; }
    if (this.mode === 'offset') { this.createOffset(e); return; }
    if (['aparar', 'estender', 'canto'].includes(this.mode)) { this.edit(e); return; }
    const res = this.resolve(e);
    if (res) this.place(res.p);
  }

  up(e) {
    if (this.mode !== 'selecao' || e.button !== 0 || !this.boxStart) return;
    const s = this.boxStart;
    this.boxStart = null;
    this.box.hidden = true;
    if (Math.hypot(e.clientX - s.x, e.clientY - s.y) < 5) {
      const obj = this.viewer.pickAt(e.clientX, e.clientY) || this.pickSketch(e)?.el || null;
      this.viewer.select(obj ? [obj] : [], e.shiftKey || e.ctrlKey);
      return;
    }
    this.selectBox(s, { x: e.clientX, y: e.clientY }, e.shiftKey || e.ctrlKey);
  }

  key(e) {
    if (e.target.matches?.('input, select, textarea')) { if (e.key === 'Escape') e.target.blur(); return; }
    const k = e.key;
    let handled = true;
    if (k === 'F8') this.app.wallTool.toggleOrtho();
    else if (['linha', 'circulo', 'eixo'].includes(this.mode) && (/^[0-9]$/.test(k) || ((k === ',' || k === '.') && !this.typed.includes('.')))) this.typed += k === ',' ? '.' : k;
    else if (k === 'Backspace' && this.typed) this.typed = this.typed.slice(0, -1);
    else if (k === 'Backspace' && this.mode === 'linha' && this.pts.length) { this.undoLast(); }
    else if (k === 'Enter') { if (this.typed) this.applyTyped(); else this.finish(); }
    else if (k === 'Escape') { if (this.typed) this.typed = ''; else if (this.pts.length || this.picked) this.finish(); else this.stop(); }
    else if ((k === 'c' || k === 'C') && this.mode === 'linha') this.closePoly();
    else if (k === 'Delete' && this.mode === 'selecao') { this.app.deleteSelected(); }
    else handled = false;
    if (handled) { e.preventDefault(); e.stopPropagation(); if (this.active && this.lastEvent) this.move(this.lastEvent); }
  }

  applyTyped() {
    const v = fromUnit(this.typed); // digitado na unidade do projeto
    this.typed = '';
    const last = this.pts[this.pts.length - 1];
    if (!last || !(v > 0) || !this.cursor) return;
    if (this.mode === 'circulo') { this.place([last[0] + v, last[1]]); return; }
    const dx = this.cursor.p[0] - last[0], dy = this.cursor.p[1] - last[1], d = Math.hypot(dx, dy);
    if (d < 1e-9) { toast('Mova o cursor para indicar a direção.', 'error'); return; }
    this.place([last[0] + dx / d * v, last[1] + dy / d * v].map(x => +x.toFixed(6)));
  }

  // ------------------------------------------------------------ criação

  /** Estilo das linhas novas (guardado neste navegador); null = padrão. */
  get newStyle() { try { return JSON.parse(load('boxbim.estiloLinha')) || null; } catch { return null; } }
  set newStyle(v) { store('boxbim.estiloLinha', JSON.stringify(v)); }

  addSeg(linha) {
    const data = this.canon(linha);
    if (!data.estilo && this.newStyle) data.estilo = this.newStyle;
    const el = createSketch(data, this.level);
    this.viewer.add(el);
    this.created = (this.created || 0) + 1;
    return el;
  }

  place(p) {
    const last = this.pts[this.pts.length - 1];
    if (this.mode === 'linha') {
      if (last && dist(last, p) < GRID / 2) return;
      if (last) {
        const el = this.addSeg({ a: last, b: p });
        (this.polyEls ||= []).push(el);
        if (this.pts.length >= 2 && dist(p, this.pts[0]) < 1e-6) { this.finish(); return; }
      }
      this.pts.push(p);
      return;
    }
    if (this.mode === 'eixo') {
      if (!last) { this.pts.push(p); return; }
      if (dist(last, p) < GRID) return;
      const el = this.app.workPlanes.fromClicks(last, p);
      this.stop();
      if (el) this.viewer.select([el]);
      return;
    }
    if (this.mode === 'retangulo') {
      if (!last) { this.pts.push(p); return; }
      const [a, b] = [last, p];
      if (Math.abs(b[0] - a[0]) < GRID || Math.abs(b[1] - a[1]) < GRID) return;
      const c = [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]];
      c.forEach((q, i) => this.addSeg({ a: q, b: c[(i + 1) % 4] }));
      this.finish();
      return;
    }
    if (this.mode === 'circulo') {
      if (!last) { this.pts.push(p); return; }
      const r = dist(last, p);
      if (r < GRID) return;
      this.addSeg({ a: [last[0] + r, last[1]], b: [last[0] + r, last[1]], arco: { c: last, r, a0: 0, a1: Math.PI * 2 } });
      this.finish();
    }
  }

  undoLast() {
    const el = this.polyEls?.pop();
    if (el) this.viewer.remove(el);
    this.pts.pop();
    if (this.pts.length === 1 && !this.polyEls.length) this.pts = [];
  }

  closePoly() {
    if (this.mode !== 'linha' || this.pts.length < 3) return;
    this.place(this.pts[0]);
  }

  finish() {
    this.pts = [];
    this.polyEls = [];
    this.picked = null;
    this.typed = '';
    this.clearPreview();
    if (this.created) { this.app.refreshTree?.(); this.created = 0; }
  }

  // ------------------------------------------------------------ aparar, estender, canto

  replace(el, segs) {
    const level = this.app.levels.get(el.userData.bim.levelId) || this.level;
    const keepName = el.userData.bim.name;
    if (!segs.length) { this.viewer.remove(el); return []; }
    // o primeiro pedaço continua sendo o mesmo elemento (mesmo GUID); os outros são novos
    const b = el.userData.bim;
    b.linha = this.canon(segs[0]);
    rebuildSketch(el);
    this.viewer._prepare2D(el);
    const extra = segs.slice(1).map(s => { const n = createSketch(this.canon(s), level); n.userData.bim.name = keepName; this.viewer.add(n); return n; });
    this.viewer.changed();
    return [el, ...extra];
  }

  edit(e) {
    const hit = this.pickHandle(e);
    if (!hit) { this.app.status(`${SKETCH_MODES[this.mode].label}: clique sobre uma linha, parede, viga, varredura ou lado de piso.`); return; }
    // lados de piso: só o Canto (entre dois lados do mesmo contorno); aparar/estender pelo contorno em linhas 2D
    if (hit.kind === 'piso' || this.picked?.kind === 'piso') {
      if (this.mode !== 'canto') { this.app.status('Para aparar ou estender o piso, dê clique duplo nele: o contorno vira linhas 2D.'); return; }
      if (!this.picked) { this.picked = hit; this.app.status('Canto no piso: agora clique o outro lado do piso.'); return; }
      const a = this.picked;
      this.picked = null;
      if (a.kind !== 'piso' || hit.kind !== 'piso' || a.el !== hit.el || a.ring !== hit.ring) { toast('Canto no piso: clique dois lados do mesmo contorno do piso.', 'error'); return; }
      if (a.edge === hit.edge) return;
      try {
        this.app.floorPoints.cornerEdges(a.el, a.ring, a.edge, hit.edge, this.corner);
        this.app.status(`Canto ${this.corner.modo === 'vivo' ? 'vivo' : this.corner.modo === 'raio' ? `com raio ${fmtLen(this.corner.raio, { suffix: true })}` : `chanfrado ${fmtLen(this.corner.distancia, { suffix: true })}`} no piso. Clique o próximo ou Esc.`);
      } catch (err) { toast(err.message, 'error'); }
      return;
    }
    const same = (a, b) => a.el === b.el && a.i === b.i;
    const others = () => this.handles().filter(o => !same(o, hit)).map(o => o.l);
    try {
      if (this.mode === 'aparar') {
        const r = trim(hit.l, hit.p, others());
        if (!r) { this.app.status('Aparar: nada cruza este trecho (para apagar inteiro, selecione e use Delete).'); return; }
        hit.apply(r);
        this.app.status('Aparado. Clique em outro trecho ou Esc.');
      } else if (this.mode === 'estender') {
        const r = extend(hit.l, hit.p, others());
        if (!r) { this.app.status('Estender: nada à frente desta ponta (arcos não estendem).'); return; }
        hit.apply([r]);
        this.app.status('Estendido. Clique em outra ponta ou Esc.');
      } else if (this.mode === 'canto') {
        if (!this.picked) { this.picked = hit; this.app.status('Canto: agora clique o segundo (linha, parede, viga ou varredura).'); return; }
        if (same(this.picked, hit)) return;
        const a = this.picked;
        this.picked = null;
        const r = corner(a.l, a.p, hit.l, hit.p, this.corner);
        // o trecho do canto (arco/chanfro) é do mesmo tipo do primeiro escolhido: linha, parede, viga ou varredura
        if (a.kind === 'linha') { a.apply([r.l1]); if (r.extra) this.addSeg(r.extra); }
        else a.apply(r.extra ? [r.l1, r.extra] : [r.l1]);
        hit.apply([r.l2]);
        this.app.status(`Canto ${this.corner.modo === 'vivo' ? 'vivo' : this.corner.modo === 'raio' ? `com raio ${fmtLen(this.corner.raio, { suffix: true })}` : `chanfrado ${fmtLen(this.corner.distancia, { suffix: true })} / ${this.corner.angulo}°`} feito. Clique o próximo ou Esc.`);
      }
    } catch (err) {
      this.picked = null;
      toast(err.message, 'error');
    }
  }

  // ------------------------------------------------------------ linhas a partir dos sólidos

  /** Malha do modelo sob o cursor (respeitando o recorte das plantas): { mesh, point, normal } ou null. */
  meshHit(e) {
    const v = this.viewer, r = v.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), v.camera);
    const ok = p => v.clipPlanes.every(pl => pl.distanceToPoint(p) >= -1e-4);
    const hit = ray.intersectObject(v.model, true).find(x => x.object.isMesh && x.object.visible && !x.object.userData.isEdge && !x.object.userData.part?.vazio && x.face && ok(x.point));
    if (!hit) return null;
    const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
    return { mesh: hit.object, point: hit.point, normal };
  }

  /** Arestas (vincos de 20°) da malha, no modelo; guardadas por geometria. */
  meshEdges(mesh) {
    mesh.updateMatrixWorld(true);
    const key = `${mesh.geometry.uuid}|${mesh.matrixWorld.elements.join(',')}`;
    if (mesh.userData._edgeKey !== key) {
      const pos = new THREE.EdgesGeometry(mesh.geometry, 20).attributes.position;
      const out = [];
      for (let i = 0; i < pos.count; i += 2) {
        out.push([new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld), new THREE.Vector3().fromBufferAttribute(pos, i + 1).applyMatrix4(mesh.matrixWorld)]);
      }
      mesh.userData._edgeKey = key;
      mesh.userData._edgeList = out;
    }
    return mesh.userData._edgeList;
  }

  /** Arestas escolhidas pelo clique: a mais próxima (Aresta) ou o contorno da face (Contorno da face). */
  edgesAt(e) {
    const hit = this.meshHit(e);
    if (!hit) return null;
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(hit.normal, hit.point);
    const size = Math.max(1e-3, hit.point.distanceTo(this.viewer.camera.position) * 1e-4);
    const onFace = this.meshEdges(hit.mesh).filter(([a, b]) => Math.abs(plane.distanceToPoint(a)) < size * 5 + 1e-4 && Math.abs(plane.distanceToPoint(b)) < size * 5 + 1e-4);
    if (!onFace.length) return null;
    const seg = new THREE.Line3(), tmp = new THREE.Vector3();
    let best = null, bestD = Infinity;
    for (const ed of onFace) { seg.set(ed[0], ed[1]); const d = seg.closestPointToPoint(hit.point, true, tmp).distanceTo(hit.point); if (d < bestD) { bestD = d; best = ed; } }
    let edges = [best];
    if (this.edgeMode !== 'aresta') {
      // contorno (e piso do contorno): as arestas da face ligadas (pelas pontas) à mais próxima do clique
      const k = v => `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`;
      const seen = new Set([best]), queue = [best];
      while (queue.length) {
        const cur = queue.pop();
        for (const ed of onFace) {
          if (seen.has(ed)) continue;
          if ([k(ed[0]), k(ed[1])].some(x => x === k(cur[0]) || x === k(cur[1]))) { seen.add(ed); queue.push(ed); }
        }
      }
      edges = [...seen];
    }
    return { edges, normal: hit.normal, point: hit.point };
  }

  previewWorld(pairs) {
    const line = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pairs.flat()), RUBBER);
    line.computeLineDistances();
    line.renderOrder = 10;
    this.group.add(line);
  }

  moveEdges(e) {
    this.clearPreview();
    const r = this.edgesAt(e);
    if (r) this.previewWorld(r.edges);
    this.tip.hidden = !r;
    if (r) {
      const pr = this.tip.parentElement.getBoundingClientRect();
      this.tip.textContent = `${r.edges.length} linha(s) — clique para criar${this.edgeProject ? ' (projetadas no plano do desenho)' : ' (no plano da face)'}`;
      Object.assign(this.tip.style, { left: `${e.clientX - pr.left + 16}px`, top: `${e.clientY - pr.top + 14}px` });
    }
  }

  createFromEdges(e) {
    const r = this.edgesAt(e);
    if (!r) { this.app.status('Linhas do sólido: clique sobre um sólido, perto da aresta (ou na face, no modo Contorno da face).'); return; }
    if (this.edgeMode === 'piso') {
      // piso direto do contorno da face horizontal clicada (topo do piso na cota da face)
      if (Math.abs(Math.abs(r.normal.z) - 1) > 1e-3) { toast('Piso do contorno: clique numa face horizontal (topo ou base de um sólido).', 'error'); return; }
      const segs = r.edges.map(([a, b]) => ({ a: [a.x, a.y], b: [b.x, b.y], arco: null, z: r.point.z }));
      const made = createFloors(this.app, segs, r.point.z, {});
      this.app.status(made.length ? `${made.length} piso(s) criado(s) do contorno da face (cota ${fmtElev(r.point.z)}).` : 'O contorno da face não fechou.');
      return;
    }
    let made = 0;
    if (this.edgeProject) {
      // no plano do desenho (nível ou eixo ativo): só a projeção
      for (const [a, b] of r.edges) {
        const pa = a.clone().applyMatrix4(this.inverse), pb = b.clone().applyMatrix4(this.inverse);
        if (Math.hypot(pb.x - pa.x, pb.y - pa.y) < 1e-4) continue; // aresta perpendicular ao plano: vira ponto
        this.addSeg({ a: [pa.x, pa.y], b: [pb.x, pb.y] });
        made++;
      }
    } else {
      // no plano da própria face (horizontal = plano de nível na cota da face; senão, um plano como o de um eixo)
      const n = r.normal;
      let target;
      if (Math.abs(Math.abs(n.z) - 1) < 1e-6) target = { plano: null, z: +r.point.z.toFixed(6) };
      else {
        const [a, b] = r.edges[0];
        const u = b.clone().sub(a).normalize(), v = n.clone().cross(u).normalize();
        target = { plano: { o: a.toArray().map(x => +x.toFixed(6)), u: u.toArray().map(x => +x.toFixed(9)), v: v.toArray().map(x => +x.toFixed(9)) }, z: 0 };
      }
      const inv = planeMatrix(target.plano || { o: [0, 0, target.z], u: [1, 0, 0], v: [0, 1, 0] }).invert();
      const level = this.app.levels.forZ(r.point.z);
      for (const [a, b] of r.edges) {
        const pa = a.clone().applyMatrix4(inv), pb = b.clone().applyMatrix4(inv);
        const data = { a: [+pa.x.toFixed(6), +pa.y.toFixed(6)], b: [+pb.x.toFixed(6), +pb.y.toFixed(6)], arco: null, z: target.z };
        if (target.plano) data.plano = target.plano;
        if (this.newStyle) data.estilo = this.newStyle;
        this.viewer.add(createSketch(data, level));
        made++;
      }
    }
    this.app.refreshTree?.();
    this.app.status(`${made} linha(s) criada(s) a partir do sólido. Clique outra aresta/face ou Esc.`);
  }

  // ------------------------------------------------------------ offset 2D

  /** Cadeia de linhas retas ligadas à linha dada (no plano do desenho): { pts, closed, els }. */
  chainOf(el) {
    const lines = this.sketches().filter(x => !x.userData.bim.linha.arco);
    const L = x => this.local(x);
    const key = p => `${p[0].toFixed(4)},${p[1].toFixed(4)}`;
    const ends = new Map();
    for (const x of lines) for (const p of [L(x).a, L(x).b]) { const k = key(p); if (!ends.has(k)) ends.set(k, []); ends.get(k).push(x); }
    const used = new Set([el]);
    const pts = [L(el).a, L(el).b];
    for (const side of ['fim', 'inicio']) {
      for (;;) {
        const endP = side === 'fim' ? pts[pts.length - 1] : pts[0];
        const near = ends.get(key(endP)) || [];
        if (near.length !== 2) break;
        const next = near.find(x => !used.has(x));
        if (!next) break;
        used.add(next);
        const s2 = L(next), other = key(s2.a) === key(endP) ? s2.b : s2.a;
        if (side === 'fim') pts.push(other); else pts.unshift(other);
      }
    }
    let closed = false;
    if (pts.length > 3 && key(pts[0]) === key(pts[pts.length - 1])) { pts.pop(); closed = true; }
    return { pts, closed, els: [...used] };
  }

  /** Resultado do offset para o cursor: lista de segmentos (dados de linha) ou null. */
  offsetAt(e) {
    if (!(this.offsetDist > 0)) return null;
    const any = this.pickHandle(e);
    if (any && any.kind !== 'linha') {
      // parede, viga ou varredura: cópia paralela do elemento (e da cadeia do mesmo tipo)
      const plan = offsetPlan(this.app, any, any.p, this.offsetDist, this.offsetChain);
      return { segs: plan.segs.map(x => ({ a: x.a, b: x.b, arco: null })), plan, src: any.el };
    }
    const hit = this.pickSketch(e);
    if (!hit) return null;
    const l = this.local(hit.el), p = hit.p, d = this.offsetDist;
    const style = hit.el.userData.bim.linha.estilo;
    if (l.arco) {
      const r = dist(p, l.arco.c) > l.arco.r ? l.arco.r + d : l.arco.r - d;
      if (r <= 1e-4) return null;
      const ar = { ...l.arco, r };
      const pt = t => [ar.c[0] + r * Math.cos(t), ar.c[1] + r * Math.sin(t)];
      return { segs: [{ a: pt(ar.a0), b: pt(ar.a1), arco: ar, estilo: style }], src: hit.el };
    }
    const ch = this.offsetChain ? this.chainOf(hit.el) : { pts: [l.a, l.b], closed: false };
    let dl;
    if (ch.closed) {
      // contorno fechado: para dentro se o cursor está dentro, para fora se está fora
      const inside = pointInPoly(p, ch.pts);
      dl = (inside ? 1 : -1) * d * (Math.sign(area(ch.pts)) || 1);
    } else {
      // linha aberta: o lado do cursor em relação ao trecho apontado
      let s = 0, best = Infinity;
      for (let i = 0; i < ch.pts.length - 1; i++) { const dd = distToSeg({ a: ch.pts[i], b: ch.pts[i + 1], arco: null }, p); if (dd < best) { best = dd; s = i; } }
      const a = ch.pts[s], b = ch.pts[s + 1];
      dl = ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) >= 0 ? d : -d;
    }
    const segs = offsetPolyline(ch.pts, dl, ch.closed).map(x => ({ a: x.a, b: x.b, arco: null, estilo: style }));
    return { segs, src: hit.el };
  }

  moveOffset(e) {
    this.clearPreview();
    const r = this.offsetAt(e);
    this.tip.hidden = !r;
    if (!r) return;
    for (const sg of r.segs) this.previewPts(segPoints(sg));
    const pr = this.tip.parentElement.getBoundingClientRect();
    this.tip.textContent = `Offset ${fmtLen(this.offsetDist, { suffix: true })} · ${r.segs.length} ${r.plan ? KIND_LABEL[r.plan.kind] + '(s)' : 'linha(s)'} — clique para criar`;
    Object.assign(this.tip.style, { left: `${e.clientX - pr.left + 16}px`, top: `${e.clientY - pr.top + 14}px` });
  }

  createOffset(e) {
    const r = this.offsetAt(e);
    if (!r) { this.app.status(this.offsetDist > 0 ? 'Offset: passe o mouse sobre uma linha, parede, viga ou varredura, do lado em que a cópia deve ficar, e clique.' : 'Offset: informe a distância na barra.'); return; }
    if (r.plan) {
      const made = offsetLinear(this.app, r.plan);
      this.finish();
      this.app.status(`Offset de ${fmtLen(this.offsetDist, { suffix: true })}: ${made.length} ${KIND_LABEL[r.plan.kind]}(s). Clique em outro ou Esc.`);
      return;
    }
    for (const sg of r.segs) {
      const { estilo, ...lin } = sg;
      const el = this.addSeg(estilo ? { ...lin, estilo } : lin);
      el.userData.bim.name = r.src.userData.bim.name;
    }
    this.finish();
    this.app.status(`Offset de ${fmtLen(this.offsetDist, { suffix: true })}: ${r.segs.length} linha(s). Clique em outra linha ou Esc.`);
  }

  // ------------------------------------------------------------ seleção por janela / cruzamento

  moveBox(e) {
    if (!this.boxStart) return;
    const s = this.boxStart, pr = this.box.parentElement.getBoundingClientRect();
    const x0 = Math.min(s.x, e.clientX), x1 = Math.max(s.x, e.clientX), y0 = Math.min(s.y, e.clientY), y1 = Math.max(s.y, e.clientY);
    const crossing = e.clientX < s.x;
    Object.assign(this.box.style, { left: `${x0 - pr.left}px`, top: `${y0 - pr.top}px`, width: `${x1 - x0}px`, height: `${y1 - y0}px` });
    this.box.className = `select-box${crossing ? ' crossing' : ''}`;
    this.box.hidden = false;
  }

  selectBox(a, b, additive) {
    const crossing = b.x < a.x;
    const el = this.viewer.renderer.domElement, r = el.getBoundingClientRect();
    const x0 = Math.min(a.x, b.x) - r.left, x1 = Math.max(a.x, b.x) - r.left, y0 = Math.min(a.y, b.y) - r.top, y1 = Math.max(a.y, b.y) - r.top;
    const cam = this.viewer.camera;
    const scr = v => { const p = v.clone().project(cam); return [(p.x + 1) / 2 * r.width, (1 - p.y) / 2 * r.height, p.z]; };
    const inside = ([x, y]) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
    const chosen = [];
    for (const e of this.viewer.elements()) {
      if (!e.visible) continue;
      let pts;
      if (isSketch(e)) {
        e.updateMatrixWorld(true);
        pts = worldPoints(e.userData.bim.linha).map(v => v.applyMatrix4(e.matrixWorld));
      } else {
        const box = new THREE.Box3().setFromObject(e);
        if (box.isEmpty()) continue;
        pts = [];
        for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) pts.push(new THREE.Vector3(x, y, z));
      }
      const s = pts.map(scr).filter(p => p[2] < 1);
      if (!s.length) continue;
      if (crossing) {
        // encosta: algum ponto dentro, ou a caixa na tela cruza o retângulo
        const bx0 = Math.min(...s.map(p => p[0])), bx1 = Math.max(...s.map(p => p[0])), by0 = Math.min(...s.map(p => p[1])), by1 = Math.max(...s.map(p => p[1]));
        if (bx1 >= x0 && bx0 <= x1 && by1 >= y0 && by0 <= y1) chosen.push(e);
      } else if (s.every(inside)) chosen.push(e);
    }
    this.viewer.select(chosen, additive);
    this.app.status(`${chosen.length} elemento(s) selecionado(s) por ${crossing ? 'cruzamento' : 'janela'}.`);
  }
}

// ---------------------------------------------------------------- comandos sobre a seleção

const selectedSketches = app => [...app.viewer.selected].filter(isSketch).map(e => bake(e));
// tudo no referencial da primeira linha (as do mesmo plano podem ter referenciais diferentes)
const segsOf = els => { const f = els[0].userData.bim.linha; return els.map(e => toFrame(e.userData.bim.linha, { plano: f.plano || null, z: f.z })); };

function materialOptions(app) {
  return [{ value: '', label: '(cor padrão)' }, ...Object.keys(app.types.materials).map(m => ({ value: m, label: m }))];
}

/** Extrudar: contornos fechados das linhas selecionadas viram sólidos (furos ficam vazados). */
export async function extrudeSelection(app) {
  const els = selectedSketches(app);
  if (!els.length) { toast('Selecione as linhas de um contorno fechado (ferramenta Seleção) e use Extrudar.', 'error'); return; }
  const { loops } = chainSegments(segsOf(els));
  if (!loops.length) { toast('As linhas selecionadas não formam um contorno fechado (as pontas precisam se encontrar).', 'error'); return; }
  const v = await formDialog('Extrudar', [
    { key: 'altura', label: `Altura (${unitLabel()})`, type: 'number', value: toUnit(1) },
    { key: 'base', label: `Deslocamento da base (${unitLabel()})`, type: 'number', value: 0 },
    { key: 'material', label: 'Material', type: 'select', value: '', options: materialOptions(app) },
    { key: 'vazio', label: 'Objeto vazio (corta outros elementos)', type: 'checkbox', value: false },
    { key: 'apagar', label: 'Apagar as linhas usadas', type: 'checkbox', value: true },
  ], { ok: 'Extrudar' });
  if (!v) return;
  v.altura = fromUnit(v.altura); v.base = fromUnit(v.base);
  const l0 = els[0].userData.bim.linha;
  const z = l0.z + (Number(v.base) || 0);
  const level = app.levels.get(els[0].userData.bim.levelId) || app.levels.forZ(l0.plano ? l0.plano.o[2] : z);
  const made = outerWithHoles(loops).map(({ perfil, furos }) => {
    const el = createForm({ tipo: 'extrusao', perfil, furos, z0: z, altura: Number(v.altura) || 1, material: v.material || null, vazio: !!v.vazio, ...(l0.plano ? { plano: l0.plano } : {}) }, { level });
    app.viewer.add(el);
    return el;
  });
  if (v.apagar) els.forEach(e => app.viewer.remove(e));
  app.viewer.select(made);
  app.status(`${made.length} sólido(s) extrudado(s)${v.vazio ? ' como vazio' : ''}.`);
}

/**
 * Varrer: a seleção tem o caminho (linhas encadeadas) e o PERFIL — um contorno 2D fechado desenhado, em qualquer
 * plano (num eixo de trabalho perpendicular ao início do caminho ele fica onde foi desenhado). Ver sweep.js.
 */
export async function sweepSelection(app) {
  const els = selectedSketches(app);
  if (!els.length) { toast('Selecione as linhas do caminho e o contorno fechado do perfil (ferramenta Seleção) e use Varrer.', 'error'); return; }
  // agrupa por plano: cada grupo é encadeado nas coordenadas do próprio plano
  const groups = [];
  for (const e of els) {
    const l = e.userData.bim.linha, f = frameOf(l);
    let g = groups.find(x => samePlane(x.f, f));
    if (!g) groups.push(g = { f, target: { plano: l.plano || null, z: l.z }, m: planeMatrix(f), segs: [], els: [] });
    g.segs.push(toFrame(l, g.target));
    g.els.push(e);
  }
  let sw;
  try { sw = sweepFromGroups(groups); } catch (err) { toast(err.message, 'error'); return; }
  const v = await formDialog('Varrer perfil ao longo do caminho', [
    { key: 'material', label: 'Material', type: 'select', value: '', options: materialOptions(app) },
    { key: 'vazio', label: 'Objeto vazio (corta outros elementos)', type: 'checkbox', value: false },
    { key: 'apagar', label: 'Apagar as linhas usadas (caminho e perfil)', type: 'checkbox', value: true },
  ], { ok: 'Varrer' });
  if (!v) return;
  const level = app.levels.get(els[0].userData.bim.levelId) || app.levels.forZ(sw.caminho[0][2]);
  const el = createForm({ tipo: 'varredura', caminho: sw.caminho, fechado: sw.fechado, perfil: sw.perfil, material: v.material || null, vazio: !!v.vazio }, { level });
  app.viewer.add(el);
  if (v.apagar) els.forEach(e => app.viewer.remove(e));
  app.viewer.select([el]);
  app.status(`Varredura criada${v.vazio ? ' como vazio' : ''}: perfil ${sw.posicionado ? 'na posição em que foi desenhado (de frente para o caminho)' : 'centrado no caminho'} · ${sw.caminho.length} pontos no caminho.`);
}

/**
 * OFFSET 3D: cópia (ou o próprio elemento) crescida/encolhida de uma distância.
 *   Extrusão ..... perfil (e furos) deslocados; com "todas as direções", também a base e o topo
 *   Varredura .... o perfil é deslocado
 *   Caixa ........ as medidas crescem 2 × a distância
 *   Outros ....... a malha é "inflada" pelas normais médias dos vértices (vira um sólido simples)
 */
export async function offset3dSelection(app) {
  const sel = [...app.viewer.selected].filter(e => !isSketch(e) && !e.userData.bim?.eixo);
  if (!sel.length) { toast('Selecione um ou mais sólidos (extrusão, varredura, caixa, objetos…) e use Offset 3D.', 'error'); return; }
  const last = Number(load('boxbim.offset3d')) || 0.05;
  const v = await formDialog('Offset 3D', [
    { key: 'd', label: `Distância (${unitLabel()}) — positiva cresce, negativa encolhe`, type: 'number', value: toUnit(last) },
    { key: 'todas', label: 'Em todas as direções (extrusão: também base e topo)', type: 'checkbox', value: true },
    { key: 'manter', label: 'Manter o original (cria uma cópia)', type: 'checkbox', value: true },
    { key: 'vazio', label: 'A cópia é um vazio (para cortar — ex.: casca)', type: 'checkbox', value: false },
  ], { ok: 'Offset' });
  if (!v) return;
  const d = fromUnit(v.d) || 0;
  if (Math.abs(d) < 1e-6) return;
  store('boxbim.offset3d', d);
  const made = [];
  for (const el of sel) {
    try {
      const out = offsetElement(app, el, d, v);
      if (!out) continue;
      app.viewer.add(out);
      made.push(out);
      if (!v.manter) app.viewer.remove(el);
    } catch (err) { toast(`${el.userData.bim?.name || 'Elemento'}: ${err.message}`, 'error'); }
  }
  if (made.length) app.viewer.select(made);
  app.status(`Offset 3D de ${fmtLen(d, { suffix: true })}: ${made.length} sólido(s).`);
}

function offsetElement(app, el, d, { todas, vazio }) {
  const b = el.userData.bim;
  const level = app.levels.get(b.levelId) || app.levels.ofElement(el);
  if (b.forma) {
    bakeForm(el);
    const f = structuredClone(b.forma);
    if (f.tipo === 'extrusao') {
      f.perfil = offsetLoop(f.perfil, d);
      f.furos = (f.furos || []).map(hl => offsetLoop(hl, d, true)).filter(hl => Math.abs(area(hl)) > 1e-8);
      if (todas) { f.z0 -= d; f.altura += 2 * d; }
      if (!(f.altura > 1e-4)) throw new Error('a distância negativa é maior que a altura.');
    } else {
      f.perfil = offsetLoop(f.perfil, d);
    }
    if (Math.abs(area(f.perfil)) < 1e-8) throw new Error('o perfil sumiu (distância grande demais).');
    f.vazio = !!vazio;
    return createForm(f, { level, name: `${b.name} (offset)` });
  }
  if (b.box) {
    const copy = new THREE.Group();
    copy.userData.bim = structuredClone({ ...b, guid: uuid(), name: `${b.name} (offset)` });
    const bx = copy.userData.bim.box;
    bx.size = bx.size.map(s => s + 2 * d);
    if (bx.size.some(s => s <= 1e-4)) throw new Error('a caixa sumiu (distância grande demais).');
    if (bx.position) bx.position = [bx.position[0], bx.position[1], bx.position[2] - (todas ? d : 0)];
    rebuildElementLazy(copy);
    el.updateMatrix();
    copy.matrix.copy(el.matrix); copy.matrix.decompose(copy.position, copy.quaternion, copy.scale);
    return copy;
  }
  // malha genérica: infla pelos normais médios dos vértices (geometria assada no modelo)
  el.updateMatrixWorld(true);
  const g = new THREE.Group();
  g.name = `${b.name || 'Elemento'} (offset)`;
  el.traverse(o => {
    if (!o.isMesh || o.userData.isEdge || o.userData.noHighlight) return;
    let geo = o.geometry.clone();
    for (const k of Object.keys(geo.attributes)) if (k !== 'position') geo.deleteAttribute(k);
    geo = mergeVertices(geo, 1e-5);
    geo.applyMatrix4(o.matrixWorld);
    geo.computeVertexNormals();
    const pos = geo.attributes.position, nrm = geo.attributes.normal;
    for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i) + nrm.getX(i) * d, pos.getY(i) + nrm.getY(i) * d, pos.getZ(i) + nrm.getZ(i) * d);
    geo.computeVertexNormals();
    const mat = (o.userData._origMat || o.material);
    const m = new THREE.Mesh(geo, vazio ? VOID_OFFSET : (Array.isArray(mat) ? mat[0] : mat));
    if (vazio) m.userData.noCap = true;
    g.add(m);
  });
  if (!g.children.length) return null;
  g.userData.bim = { type: vazio ? 'IfcOpeningElement' : (b.type || 'IfcBuildingElementProxy'), name: g.name, guid: uuid(), levelId: level?.id || null, props: { Origem: `offset de ${b.name || 'elemento'}` } };
  return g;
}

const VOID_OFFSET = new THREE.MeshStandardMaterial({ color: 0xff4d4d, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });

/** Leva a transformação do sólido (mover/girar) para os dados da forma, para o offset partir da forma certa. */
function bakeForm(el) {
  el.updateMatrix();
  if (el.matrix.equals(new THREE.Matrix4())) return;
  const f = el.userData.bim.forma;
  if (f.tipo === 'varredura') {
    f.caminho = f.caminho.map(p => new THREE.Vector3(p[0], p[1], p[2] ?? 0).applyMatrix4(el.matrix).toArray());
  } else if (!f.plano) {
    // extrusão vertical: o perfil vai para um plano que acompanha a transformação
    const m = el.matrix;
    const o = new THREE.Vector3(0, 0, 0).applyMatrix4(m), u = new THREE.Vector3(1, 0, 0).transformDirection(m), w = new THREE.Vector3(0, 1, 0).transformDirection(m);
    f.plano = { o: o.toArray(), u: u.toArray(), v: w.toArray() };
  } else {
    const M = planeMatrix(f.plano).premultiply(el.matrix);
    f.plano = { o: new THREE.Vector3().setFromMatrixPosition(M).toArray(), u: new THREE.Vector3().setFromMatrixColumn(M, 0).normalize().toArray(), v: new THREE.Vector3().setFromMatrixColumn(M, 1).normalize().toArray() };
  }
  el.position.set(0, 0, 0); el.quaternion.identity(); el.scale.set(1, 1, 1);
  rebuildForm(el);
}

/**
 * Pisos a partir de linhas 2D horizontais: cada contorno fechado vira um piso com o topo na cota das linhas
 * (mais o deslocamento). typeId: tipo de piso (camadas); sem tipo, o padrão.
 */
export function createFloors(app, segs, z, { typeId, offset = 0 } = {}) {
  const { loops } = chainSegments(segs);
  const made = [];
  for (const { perfil, furos } of outerWithHoles(loops)) {
    if (Math.abs(area(perfil)) < 1e-6) continue;
    const top = z + offset;
    const level = app.levels.forZ(top);
    try {
      const el = createOnLevel('slab', { level: level.id, points: perfil.map(p => [+p[0].toFixed(6), +p[1].toFixed(6)]), elevation: +(top - level.elevation).toFixed(6), ...(typeId ? { type: typeId } : {}) }, app.levels);
      el.userData.bim.name = el.name = `Piso ${app.viewer.elements().filter(x => x.userData.bim.slab).length + 1}`;
      app.viewer.add(el);
      made.push(el);
      if (furos.length) toast(`${el.name}: ${furos.length} furo(s) do contorno não entram (o piso ainda não tem furos).`);
    } catch (err) { toast(err.message, 'error'); }
  }
  app.refreshTree?.();
  return made;
}

/** Piso das linhas selecionadas (contornos fechados, horizontais — ex.: linhas tiradas das quinas dos sólidos). */
export async function floorFromSelection(app) {
  const els = selectedSketches(app).filter(e => { const l = e.userData.bim.linha; return !l.plano || Math.abs(Math.abs(new THREE.Vector3().setFromMatrixColumn(planeMatrix(l.plano), 2).z) - 1) < 1e-6; });
  if (!els.length) { toast('Selecione as linhas 2D de um contorno fechado horizontal (ferramenta Seleção) e use Piso das linhas.', 'error'); return; }
  // linhas na cota da primeira (as horizontais de outras cotas ficam de fora)
  const world = els.map(e => { const pts = worldPoints(e.userData.bim.linha); return { e, pts }; });
  const z = world[0].pts[0].z;
  const segs = world.filter(w => Math.abs(w.pts[0].z - z) < 0.01).flatMap(w => w.pts.slice(1).map((p, i) => ({ a: [w.pts[i].x, w.pts[i].y], b: [p.x, p.y], arco: null, z })));
  const { loops } = chainSegments(segs);
  if (!loops.length) { toast('As linhas selecionadas não formam um contorno fechado.', 'error'); return; }
  const types = app.types.list('slab');
  const v = await formDialog('Piso das linhas', [
    { key: 'type', label: 'Tipo de piso', type: 'select', value: types[0]?.id || '', options: types.map(t => ({ value: t.id, label: `${t.name} (${fmtLen(app.types.thickness(t), { suffix: true })})` })) },
    { key: 'offset', label: `Deslocamento do topo em relação às linhas (${unitLabel()})`, type: 'number', value: 0 },
    { key: 'apagar', label: 'Apagar as linhas usadas', type: 'checkbox', value: false },
  ], { ok: 'Criar piso' });
  if (!v) return;
  const made = createFloors(app, segs, z, { typeId: v.type || undefined, offset: fromUnit(v.offset) || 0 });
  if (v.apagar && made.length) els.forEach(e => app.viewer.remove(e));
  if (made.length) app.viewer.select(made);
  app.status(`${made.length} piso(s) criado(s) com o topo na cota ${fmtElev(z + (fromUnit(v.offset) || 0))}.`);
}

/** Cortar: na seleção, os vazios cortam os demais elementos. */
export function cutSelection(app) {
  const sel = [...app.viewer.selected];
  const voids = sel.filter(isVoid), targets = sel.filter(e => !isVoid(e) && !isSketch(e));
  if (!voids.length || !targets.length) { toast('Selecione um ou mais vazios e os elementos que eles devem cortar (Ctrl+clique ou janela).', 'error'); return; }
  app.cuts.add(targets, voids);
  app.status(`${targets.length} elemento(s) cortado(s) por ${voids.length} vazio(s).`);
}

export function uncutSelection(app) {
  const sel = [...app.viewer.selected];
  const voids = sel.filter(isVoid), targets = sel.filter(e => !isVoid(e));
  if (!targets.length) { toast('Selecione os elementos cortados (e, opcionalmente, só os vazios a tirar).', 'error'); return; }
  app.cuts.remove(targets, voids.length ? voids : null);
  app.status('Corte removido.');
}

/** Transforma a seleção em vazio / sólido (extrusões e varreduras). */
export function toggleVoid(app) {
  const forms = [...app.viewer.selected].filter(isForm);
  if (!forms.length) { toast('Selecione extrusões ou varreduras.', 'error'); return; }
  return forms;
}
