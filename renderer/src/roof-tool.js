// Ferramenta TELHADO (por extrusão, como no Revit): escolha um EIXO DE TRABALHO vertical, desenhe nele o PERFIL do
// telhado (a linha de cima: um "^" para duas águas, uma rampa para uma água, um arco em trechos…) e defina até onde
// ele vai na normal do eixo (início/fim). O telhado é um objeto de sistema (Telhado) com o TIPO de camadas
// (Telhados: telha, ripas, caibros… de cima para baixo). Opções no painel da direita.
//   clique ........... pontos do perfil (snap nas pontas das linhas do eixo, nos níveis e nos pontos já dados)
//   número + Enter ... comprimento na direção do cursor · F8/Shift ORTO · Backspace desfaz · Enter conclui
import * as THREE from 'three';
import { h, toast } from './ui.js';
import { createRoof } from './elements.js';
import { fmtElev } from './levels.js';
import { fmtLen, fromUnit, toUnit, unitLabel } from './units.js';
import { isSketch, bake, toFrame, chainSegments, frameOf, samePlane, dist } from './sketch/sketch.js';
import { toolCursor } from './cursors.js';

const SNAP_PX = 12;
const GRID = 0.01;
const store = (k, v) => { try { localStorage.setItem(k, v); } catch { /* sem armazenamento */ } };
const load = k => { try { return localStorage.getItem(k); } catch { return null; } };
const LINE = new THREE.LineBasicMaterial({ color: 0xff3fd0, depthTest: false });
const RUBBER = new THREE.LineDashedMaterial({ color: 0xff3fd0, dashSize: 0.2, gapSize: 0.1, depthTest: false });

export class RoofTool {
  constructor(app) {
    this.app = app;
    this.active = false;
    this.typeId = load('boxbim.telhadoTipo') || null;
    this.overhang = Number(load('boxbim.telhadoBeiral')) || 0.5;
  }

  get viewer() { return this.app.viewer; }
  get planes() { return this.app.workPlanes.list().filter(e => Math.abs(new THREE.Vector3(...this.app.workPlanes.frameOf(e).v).z) > 0.99); }

  start() {
    if (this.active) return;
    for (const t of [this.app.wallTool, this.app.sketchTool, this.app.slabTool, this.app.placeTool]) if (t?.active) t.stop();
    this.active = true;
    this.pts = [];
    this.typed = '';
    // eixo: o ativo (se vertical) ou o primeiro vertical
    const act = this.app.workPlanes.active;
    this.plane = this.planes.includes(act) ? act : this.planes[0] || null;
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
    el.style.cursor = toolCursor('telhado');
    this.buildPanel();
    this.setPlane(this.plane);
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

  // ------------------------------------------------------------ painel

  buildPanel() {
    const types = this.app.types.list('roof');
    if (!types.some(t => t.id === this.typeId)) this.typeId = this.app.types.get('roof')?.id || types[0]?.id || null;
    this.planeSel = h('select', { onchange: e => this.setPlane(this.planes.find(p => p.userData.bim.guid === e.target.value) || null) });
    const typeSel = h('select', { onchange: e => { this.typeId = e.target.value; store('boxbim.telhadoTipo', this.typeId); this.sync(); } },
      types.map(t => h('option', { value: t.id, selected: t.id === this.typeId }, t.name)));
    this.thick = h('span', { class: 'muted small' });
    this.iniIn = h('input', { type: 'number', step: 'any', value: 0, oninput: () => { this.manualExtent = true; } });
    this.fimIn = h('input', { type: 'number', step: 'any', value: toUnit(6), oninput: () => { this.manualExtent = true; } });
    const beiral = h('input', { type: 'number', step: 'any', value: toUnit(this.overhang), style: 'width:70px', onchange: e => { this.overhang = fromUnit(e.target.value) || 0; store('boxbim.telhadoBeiral', this.overhang); } });
    this.info = h('div', { class: 'small muted' });
    this.panel = h('div', { class: 'tool-panel' },
      h('div', { class: 'tool-panel-head' }, h('strong', {}, '⌂ Telhado'), h('span', { class: 'spacer' }),
        h('button', { onclick: () => this.stop(), title: 'Sai sem criar (Esc)' }, 'Sair')),
      h('h4', {}, '1 · Eixo de trabalho (vertical)'),
      h('div', { class: 'form' }, h('label', {}, 'Desenhar o perfil em', this.planeSel)),
      h('div', { class: 'row-buttons' },
        h('button', { onclick: () => this.newPlane(), title: 'Cria um eixo vertical clicando dois pontos na planta ou no 3D' }, '＋ Novo eixo (2 pontos)'),
        h('button', { onclick: () => this.plane && this.app.workPlanes.lookAt(this.plane), title: 'Vista 3D de frente para o eixo' }, 'Olhar para o eixo')),
      h('h4', {}, '2 · Perfil (linha de cima do telhado)'),
      h('div', { class: 'row-buttons' },
        h('button', { onclick: () => this.fromSelection(), title: 'Usa as linhas 2D selecionadas neste eixo como perfil' }, 'Usar linhas selecionadas'),
        h('button', { onclick: () => { this.pts.pop(); this.redraw(); this.sync(); }, title: 'Backspace' }, '↶ Ponto'),
        h('button', { onclick: () => { this.pts = []; this.redraw(); this.sync(); } }, 'Limpar')),
      h('h4', {}, '3 · Extrusão (na normal do eixo)'),
      h('div', { class: 'form' },
        h('label', {}, `Início (${unitLabel()})`, this.iniIn),
        h('label', {}, `Fim (${unitLabel()})`, this.fimIn)),
      h('div', { class: 'row-buttons' },
        h('button', { onclick: () => this.autoExtent(), title: 'Cobre o modelo inteiro na direção da extrusão, mais o beiral' }, 'Pelo modelo'),
        h('label', {}, ` + beiral (${unitLabel()}) `, beiral)),
      h('h4', {}, '4 · Tipo'),
      h('div', { class: 'form' }, h('label', {}, 'Tipo de telhado (camadas)', typeSel, this.thick)),
      this.info,
      h('button', { class: 'primary', onclick: () => this.finish(), title: 'Cria o telhado (Enter)' }, '✔ Concluir telhado'));
    this._sidebarWasCollapsed = document.querySelector('.layout')?.classList.contains('right-collapsed');
    if (this._sidebarWasCollapsed) this.app.setSidebar('right', false, false);
    this.app.showTab('props');
    (document.querySelector('.tab-body[data-body="props"]') || document.querySelector('.center')).prepend(this.panel);
    this.tip = h('div', { class: 'draw-tip', hidden: true });
    this.marker = h('div', { class: 'snap-marker', hidden: true });
    document.querySelector('.center').append(this.tip, this.marker);
  }

  fillPlanes() {
    const list = this.planes;
    this.planeSel.replaceChildren(...(list.length ? list.map(p => h('option', { value: p.userData.bim.guid, selected: p === this.plane }, p.userData.bim.name))
      : [h('option', { value: '' }, '(nenhum eixo vertical — crie um)')]));
  }

  setPlane(el) {
    this.plane = el;
    this.pts = [];
    if (el) {
      const f = this.app.workPlanes.frameOf(el);
      this.frame = f;
      const u = new THREE.Vector3(...f.u).normalize(), v = new THREE.Vector3(...f.v).normalize();
      this.M = new THREE.Matrix4().makeBasis(u, v, u.clone().cross(v)).setPosition(...f.o);
      this.inv = this.M.clone().invert();
      this.autoExtent(true);
    }
    this.fillPlanes();
    this.redraw();
    this.sync();
  }

  newPlane() {
    // a ferramenta de eixo usa o mouse: sai, cria o eixo e volta com ele
    this.stop();
    this.app.workPlanes._pending = { z: (this.app.views.activeLevel() || this.app.levels.list[0]).elevation, h: 3 };
    this.app.sketchTool.start('eixo');
    const back = () => { if (!this.app.sketchTool.active) { this.app.sketchTool.removeEventListener('change', back); setTimeout(() => this.start(), 0); } };
    this.app.sketchTool.addEventListener('change', back);
    this.app.status('Telhado: clique dois pontos para o eixo vertical (ex.: na planta, atravessando a casa); depois desenhe o perfil nele.');
  }

  /**
   * Início e fim pela extensão, na normal do eixo, dos elementos que ficam DEBAIXO do perfil (a faixa do perfil em u;
   * sem perfil, o modelo todo), mais o beiral.
   */
  autoExtent(quiet = false) {
    if (!this.M) return;
    const n = new THREE.Vector3().setFromMatrixColumn(this.M, 2), u = new THREE.Vector3().setFromMatrixColumn(this.M, 0), o = new THREE.Vector3(...this.frame.o);
    const us = this.pts.map(p => p[0]);
    const [u0, u1] = us.length >= 2 ? [Math.min(...us), Math.max(...us)] : [-Infinity, Infinity];
    const zs = [];
    for (const e of this.viewer.elements()) {
      if (e.userData.bim.eixo || e.userData.bim.linha || e.userData.bim.roof || !e.visible) continue;
      const box = new THREE.Box3().setFromObject(e);
      if (box.isEmpty()) continue;
      const cs = [];
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) cs.push(new THREE.Vector3(x, y, o.z).sub(o));
      const cu = cs.map(c => c.dot(u));
      if (Math.max(...cu) < u0 - 1e-6 || Math.min(...cu) > u1 + 1e-6) continue; // fora da faixa do perfil
      const cn = cs.map(c => c.dot(n));
      zs.push([Math.min(...cn), Math.max(...cn)]);
    }
    if (!zs.length) { if (!quiet) toast('Nada debaixo do perfil: informe início e fim.', 'error'); return; }
    // só o bloco contínuo de elementos que começa no eixo (vãos maiores que 1 m separam outra edificação)
    zs.sort((a, b) => a[0] - b[0]);
    const near = zs.reduce((best, z) => (Math.min(Math.abs(z[0]), Math.abs(z[1]), z[0] <= 0 && z[1] >= 0 ? 0 : Infinity) < Math.min(Math.abs(best[0]), Math.abs(best[1]), best[0] <= 0 && best[1] >= 0 ? 0 : Infinity) ? z : best), zs[0]);
    let lo = near[0], hi = near[1], grew = true;
    while (grew) {
      grew = false;
      for (const z of zs) if (z[1] >= lo - 1 && z[0] <= hi + 1 && (z[0] < lo || z[1] > hi)) { lo = Math.min(lo, z[0]); hi = Math.max(hi, z[1]); grew = true; }
    }
    this.iniIn.value = toUnit(+(lo - this.overhang).toFixed(3));
    this.fimIn.value = toUnit(+(hi + this.overhang).toFixed(3));
    this.manualExtent = false;
  }

  sync() {
    if (!this.panel) return;
    const t = this.app.types.get('roof', this.typeId);
    this.thick.textContent = t ? ` ${fmtLen(this.app.types.thickness(t), { suffix: true })}` : '';
    this.info.textContent = !this.plane ? 'Crie ou escolha um eixo de trabalho vertical para desenhar o perfil.'
      : `Perfil: ${this.pts.length} ponto(s)${this.pts.length >= 2 ? ` · ${this.slopes()}` : ''} — clique no eixo para desenhar.`;
    this.app.status(this.plane ? 'Telhado: clique os pontos do perfil no eixo (a linha de cima do telhado) · número + Enter = comprimento · Enter conclui · Esc sai.' : 'Telhado: escolha ou crie um eixo de trabalho vertical.');
  }

  slopes() {
    const out = [];
    for (let i = 1; i < this.pts.length; i++) {
      const dx = this.pts[i][0] - this.pts[i - 1][0], dy = this.pts[i][1] - this.pts[i - 1][1];
      if (Math.abs(dx) > 1e-6) out.push(`${(Math.abs(dy / dx) * 100).toFixed(0)}%`);
    }
    return out.length ? `inclinação ${out.join(' / ')}` : '';
  }

  // ------------------------------------------------------------ cursor no eixo

  local(e) {
    if (!this.M) return null;
    const r = this.viewer.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.viewer.camera);
    const n = new THREE.Vector3().setFromMatrixColumn(this.M, 2);
    if (Math.abs(ray.ray.direction.dot(n)) < 0.02) return null; // eixo visto de lado
    const hit = ray.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(n, new THREE.Vector3(...this.frame.o)), new THREE.Vector3());
    if (!hit) return null;
    hit.applyMatrix4(this.inv);
    return [hit.x, hit.y];
  }

  world(p, dz = 0) { return new THREE.Vector3(p[0], p[1], dz).applyMatrix4(this.M); }

  screen(p) {
    const el = this.viewer.renderer.domElement;
    const q = this.world(p).project(this.viewer.camera);
    return [(q.x + 1) / 2 * el.clientWidth, (1 - q.y) / 2 * el.clientHeight];
  }

  /** Linhas 2D desenhadas neste eixo (no referencial dele). */
  planeLines() {
    return this.viewer.elements().filter(x => isSketch(x) && x.visible && samePlane(frameOf(bake(x).userData.bim.linha), this.frame))
      .map(x => ({ el: x, l: toFrame(x.userData.bim.linha, { plano: this.frame, z: 0 }) }));
  }

  resolve(e) {
    const raw = this.local(e);
    if (!raw) return null;
    const rs = this.screen(raw);
    const cands = [...this.pts];
    for (const { l } of this.planeLines()) cands.push(l.a, l.b);
    // cotas dos níveis: pontos sobre a linha de cada nível, na vertical do cursor
    const oz = this.frame.o[2], sv = Math.sign(this.frame.v[2]) || 1;
    for (const lv of this.app.levels.list) cands.push([raw[0], (lv.elevation - oz) * sv]);
    let best = null, bd = SNAP_PX;
    for (const c of cands) { const s = this.screen(c); const d = Math.hypot(s[0] - rs[0], s[1] - rs[1]); if (d < bd) { bd = d; best = c; } }
    if (best) return { p: [...best], snap: true };
    const last = this.pts[this.pts.length - 1];
    let p = raw;
    if (last && this.app.wallTool.ortho !== !!e.shiftKey) p = Math.abs(p[0] - last[0]) >= Math.abs(p[1] - last[1]) ? [p[0], last[1]] : [last[0], p[1]];
    return { p: p.map(v => Math.round(v / GRID) * GRID) };
  }

  // ------------------------------------------------------------ eventos

  move(e) {
    this.lastEvent = e;
    this.redraw();
    const res = this.resolve(e);
    this.cursor = res;
    if (!res) { this.tip.hidden = true; return; }
    const last = this.pts[this.pts.length - 1];
    const pr = document.querySelector('.center').getBoundingClientRect(), cr = this.viewer.renderer.domElement.getBoundingClientRect();
    let text = 'clique o primeiro ponto do perfil';
    if (last) {
      this.rubber([last, res.p]);
      const dx = res.p[0] - last[0], dy = res.p[1] - last[1];
      text = `${fmtLen(Math.hypot(dx, dy), { suffix: true })}${Math.abs(dx) > 1e-6 ? `  ·  ${(Math.abs(dy / dx) * 100).toFixed(0)}% (${(Math.atan2(Math.abs(dy), Math.abs(dx)) * 180 / Math.PI).toFixed(1).replace('.', ',')}°)` : ''}`;
    }
    if (this.typed) text += `  ⌨ ${this.typed.replace('.', ',')} ${unitLabel()}`;
    this.tip.textContent = text;
    this.tip.hidden = false;
    Object.assign(this.tip.style, { left: `${e.clientX - pr.left + 16}px`, top: `${e.clientY - pr.top + 14}px` });
    const s = this.screen(res.p);
    this.marker.hidden = !res.snap;
    if (res.snap) Object.assign(this.marker.style, { left: `${s[0] + cr.left - pr.left}px`, top: `${s[1] + cr.top - pr.top}px` });
  }

  down(e) {
    if (e.button !== 0) return;
    if (!this.plane) { toast('Escolha ou crie um eixo de trabalho vertical primeiro.', 'error'); return; }
    const res = this.resolve(e);
    if (res) this.add(res.p);
  }

  add(p) {
    const last = this.pts[this.pts.length - 1];
    if (last && dist(last, p) < GRID / 2) return;
    this.pts.push(p);
    if (!this.manualExtent && this.pts.length >= 2) this.autoExtent(true);
    this.redraw(); this.sync();
  }

  key(e) {
    if (e.target.matches?.('input, select, textarea')) return;
    const k = e.key;
    let done = true;
    if (/^[0-9]$/.test(k) || ((k === ',' || k === '.') && !this.typed.includes('.'))) this.typed += k === ',' ? '.' : k;
    else if (k === 'Backspace') { if (this.typed) this.typed = this.typed.slice(0, -1); else this.pts.pop(); }
    else if (k === 'Enter') {
      if (this.typed) {
        const v = fromUnit(this.typed); this.typed = '';
        const last = this.pts[this.pts.length - 1];
        if (last && v > 0 && this.cursor) {
          const dx = this.cursor.p[0] - last[0], dy = this.cursor.p[1] - last[1], d = Math.hypot(dx, dy);
          if (d > 1e-9) this.add([last[0] + dx / d * v, last[1] + dy / d * v]);
        }
      } else this.finish();
    } else if (k === 'Escape') { if (this.typed) this.typed = ''; else if (this.pts.length) this.pts = []; else this.stop(); }
    else if (k === 'F8') this.app.wallTool.toggleOrtho();
    else done = false;
    if (done) { e.preventDefault(); e.stopPropagation(); if (this.active) { this.redraw(); this.sync(); if (this.lastEvent) this.move(this.lastEvent); } }
  }

  /** Perfil a partir das linhas 2D selecionadas (desenhadas neste eixo e encadeadas). */
  fromSelection() {
    if (!this.plane) { toast('Escolha o eixo de trabalho primeiro.', 'error'); return; }
    const sel = new Set(this.viewer.selected);
    const segs = this.planeLines().filter(x => sel.has(x.el) && !x.l.arco).map(x => x.l);
    if (!segs.length) { toast('Selecione as linhas do perfil desenhadas neste eixo (ferramenta Seleção) e use de novo.', 'error'); return; }
    const { chains, loops } = chainSegments(segs);
    const path = chains.sort((a, b) => b.length - a.length)[0];
    if (!path) { toast(loops.length ? 'O perfil do telhado é uma linha ABERTA (a linha de cima), não um contorno fechado.' : 'As linhas não se encadeiam.', 'error'); return; }
    // da esquerda para a direita (u crescente)
    this.pts = path[0][0] <= path[path.length - 1][0] ? path : [...path].reverse();
    this.redraw(); this.sync();
  }

  // ------------------------------------------------------------ desenho

  rubber(pts) {
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.map(p => this.world(p, 0.01))), RUBBER);
    line.computeLineDistances();
    this.group.add(line);
  }

  redraw() {
    for (const c of [...this.group.children]) { this.group.remove(c); c.geometry?.dispose(); }
    if (this.pts.length >= 2) this.group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(this.pts.map(p => this.world(p, 0.01))), LINE));
  }

  // ------------------------------------------------------------ concluir

  finish() {
    if (!this.plane) { toast('Escolha ou crie um eixo de trabalho vertical primeiro.', 'error'); return; }
    if (this.pts.length < 2) { toast('Desenhe o perfil do telhado (pelo menos dois pontos) no eixo.', 'error'); return; }
    if (!this.manualExtent) this.autoExtent(true); // sem edição à mão: cobre o que está debaixo do perfil desenhado
    const inicio = fromUnit(this.iniIn.value) || 0, fim = fromUnit(this.fimIn.value) || 0;
    if (!(fim - inicio > 0.01)) { toast('O fim da extrusão precisa ser maior que o início.', 'error'); return; }
    const spec = this.app.types.spec('roof', this.typeId);
    const roof = createRoof({ plano: this.frame, perfil: this.pts.map(p => [+p[0].toFixed(6), +p[1].toFixed(6)]), inicio: +inicio.toFixed(6), fim: +fim.toFixed(6), ...spec });
    // nível: o mais alto abaixo do ponto mais baixo do perfil
    const zmin = Math.min(...this.pts.map(p => this.world(p).z));
    const lvl = this.app.levels.forZ(zmin);
    Object.assign(roof.userData.bim, { levelId: lvl.id });
    roof.userData.bim.props.Nivel = lvl.name;
    roof.userData.bim.name = roof.name = `Telhado ${this.viewer.elements().filter(x => x.userData.bim.roof).length + 1}`;
    this.viewer.add(roof);
    this.app.refreshTree?.();
    this.pts = [];
    this.redraw(); this.sync();
    this.app.status(`${roof.name} criado (${spec.typeName || 'genérico'}), nível ${lvl.name} ${fmtElev(lvl.elevation)}. Desenhe outro perfil ou Sair.`);
    return roof;
  }
}
