// PONTOS DO PISO: com um piso selecionado, aparecem os pontos do contorno e os pontos de forma (como "Editar forma"
// do piso no Revit).
//   arrastar um ponto ......... move o ponto (snap nos pontos de outros pisos e nas pontas de paredes/linhas; ORTO/F8
//                               ou Shift trava 0°/90° em relação ao ponto anterior)
//   arrastar o "+" de um lado .. coloca um ponto novo no contorno
//   clicar num ponto ........... digita a ALTURA do ponto (deslocamento em relação ao topo do piso): o piso inclina
//   botão direito no ponto ..... apaga o ponto (o contorno fica com pelo menos 3)
//   ＋ Ponto interno ............ clique dentro do piso para colocar um ponto de forma (rampa, caimento, ralo…)
// Dados: slab.points (contorno), slab.alturas[i] (altura de cada ponto do contorno), slab.forma [[x, y, dz], …].
import * as THREE from 'three';
import { h, toast } from './ui.js';
import { rebuildElement } from './elements.js';
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
    this.svg.append(this.outline);
    this.labels = h('div');
    this.box = h('div', { class: 'grips floor-grips', hidden: true }, this.svg, this.labels);
    this.tip = h('div', { class: 'draw-tip', hidden: true });
    this.marker = h('div', { class: 'snap-marker', hidden: true });
    center.append(this.box, this.tip, this.marker);
    app.viewer.addEventListener('select', () => this.refresh());
    app.viewer.frameHooks.push(() => this.update());
    addEventListener('pointermove', e => this.onMove(e));
    addEventListener('pointerup', e => this.endDrag(e));
    this._place = e => this.placeAt(e);
    this._esc = e => { if (e.key === 'Escape' && this.placing) { e.stopPropagation(); this.stopPlacing(); } };
  }

  get viewer() { return this.app.viewer; }

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
    this.startPlacing();
  }

  refresh() {
    const sel = [...this.viewer.selected];
    const el = sel.length === 1 && sel[0].userData.bim?.slab ? sel[0] : null;
    if (el !== this.el) { this.stopPlacing(); this.cancelType(); }
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
    const add = (kind, i, cls, title) => {
      const dom = h('div', { class: `grip-point ${cls}`, title });
      dom.addEventListener('pointerdown', e => this.startDrag(e, kind, i));
      dom.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); this.remove(kind, i); });
      this.box.append(dom);
      this.handles.push({ dom, kind, i });
    };
    s.points.forEach((_, i) => add('v', i, '', 'Ponto do contorno: arraste para mover · clique para a altura · botão direito apaga'));
    s.points.forEach((_, i) => add('m', i, 'floor-add', 'Arraste para colocar um ponto novo neste lado'));
    (s.forma || []).forEach((_, i) => add('f', i, 'floor-shape', 'Ponto de forma: arraste para mover · clique para a altura · botão direito apaga'));
  }

  /** Ponto no modelo de cada alça. */
  world(kind, i, el = this.el) {
    const s = el.userData.bim.slab, al = s.alturas || [];
    let p, dz;
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
    const show = el && el.parent && el.visible && !this.viewer.tool && !this.viewer.renderOverride;
    if (!show) { if (!this.box.hidden) this.box.hidden = true; return; }
    const s = el.userData.bim.slab;
    if (this.handles.filter(x => x.kind === 'v').length !== s.points.length || this.handles.filter(x => x.kind === 'f').length !== (s.forma || []).length) this.rebuildHandles();
    el.updateMatrixWorld(true);
    this.box.hidden = false;
    let d = '';
    const labels = [];
    for (const hd of this.handles) {
      const sc = this.screen(this.world(hd.kind, hd.i));
      hd.dom.hidden = sc.behind;
      hd.dom.style.transform = `translate(${sc.x}px, ${sc.y}px)`;
      if (hd.kind === 'v') d += `${hd.i ? 'L' : 'M'}${sc.x} ${sc.y}`;
      const dz = hd.kind === 'v' ? s.alturas?.[hd.i] : hd.kind === 'f' ? s.forma[hd.i][2] : 0;
      if (dz && !sc.behind) labels.push(h('div', { class: 'floor-dz', style: `transform: translate(${sc.x + 9}px, ${sc.y - 20}px)` }, fmtDz(dz)));
    }
    this.outline.setAttribute('d', d ? `${d}Z` : '');
    if (!this.typing) this.labels.replaceChildren(...labels);
  }

  // ------------------------------------------------------------ arrastar

  startDrag(e, kind, i) {
    if (e.button !== 0 || !this.el) return;
    e.preventDefault(); e.stopPropagation();
    const el = this.el = this.live(this.el), s = el.userData.bim.slab;
    el.updateMatrixWorld(true);
    const inv = el.matrixWorld.clone().invert();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 0, 1).transformDirection(el.matrixWorld), this.world(kind, i));
    const toData = v => { const q = v.clone().applyMatrix4(inv); return [q.x, q.y]; };
    if (kind === 'm') {
      // "+" de um lado: entra um ponto novo no contorno (altura = média dos vizinhos) e já começa a arrastá-lo
      const a = s.points[i], b = s.points[(i + 1) % s.points.length];
      s.points.splice(i + 1, 0, [round6((a[0] + b[0]) / 2), round6((a[1] + b[1]) / 2)]);
      if (s.alturas) s.alturas.splice(i + 1, 0, round6(((s.alturas[i] || 0) + (s.alturas[(i + 1) % (s.points.length - 1)] || 0)) / 2));
      kind = 'v'; i += 1;
      this.rebuildHandles();
      this.dirty = true;
    }
    const prev = kind === 'v' ? s.points[(i - 1 + s.points.length) % s.points.length] : null;
    this.drag = { kind, i, el, plane, toData, prev, start: [e.clientX, e.clientY], moved: !!this.dirty, snaps: this.snapCandidates(el) };
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
    else s.forma[d.i] = [p[0], p[1], s.forma[d.i][2] || 0];
    d.moved = true;
    this.rebuild(d.el, true);
    const pr = this.box.parentElement.getBoundingClientRect();
    const sc = this.screen(this.world(d.kind, d.i));
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
    } else if (d.kind !== 'm') this.typeHeight(d.kind, d.i);
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

  remove(kind, i) {
    const el = this.live(this.el);
    if (!el || kind === 'm') return;
    const s = el.userData.bim.slab;
    if (kind === 'v') {
      if (s.points.length <= 3) { toast('O contorno do piso precisa de pelo menos 3 pontos.', 'error'); return; }
      s.points.splice(i, 1);
      s.alturas?.splice(i, 1);
    } else s.forma.splice(i, 1);
    this.rebuildHandles();
    this.commit(el);
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
    ];
  }
}
