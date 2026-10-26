// Ferramenta COPIAR (como o COPY do AutoCAD), para tudo: linhas 2D, paredes, lajes, objetos, sólidos, eixos…
//   1. selecione (antes, ou clicando com a ferramenta ativa; Shift soma) e Enter / "Ponto base"
//   2. clique o ponto base e os pontos de destino — cada clique é uma cópia (Esc termina)
//   modo 2D ... pontos no plano do nível da vista (snap em pontas de linhas e paredes), ORTO (F8/Shift)
//   modo 3D ... pontos sobre os sólidos (snap nos vértices perto do clique): o deslocamento leva o Z junto
//   número + Enter = distância na direção do cursor · Repetições: cópias em série (matriz linear)
//   Copiar para nível: a seleção vai para outro nível (mesma posição em planta)
// As cópias são feitas pelos dados de cada elemento (os mesmos que sincronizam o projeto), com GUID novo; portas e
// janelas copiadas junto com a parede ficam hospedadas na parede copiada.
import * as THREE from 'three';
import { h, toast, formDialog } from './ui.js';
import { uuid } from './elements.js';
import { fmtElev } from './levels.js';
import { fmtLen, fromUnit, toUnit, unitLabel } from './units.js';
import { isSketch, bake } from './sketch/sketch.js';
import { handlesOf } from './sketch/linear.js';

const SNAP_PX = 12;
const GRID = 0.01;
const store = (k, v) => { try { localStorage.setItem(k, v); } catch { /* sem armazenamento */ } };
const load = k => { try { return localStorage.getItem(k); } catch { return null; } };
const RUBBER = new THREE.LineDashedMaterial({ color: 0x2f9bff, dashSize: 0.2, gapSize: 0.1, depthTest: false });
const BOX = new THREE.LineBasicMaterial({ color: 0x2f9bff, depthTest: false, transparent: true, opacity: 0.8 });

export class CopyTool {
  constructor(app) {
    this.app = app;
    this.active = false;
    this.mode3d = load('boxbim.copia3d') === '1';
    this.multiple = load('boxbim.copiaMultipla') !== '0';
    this.count = 1;
  }

  get viewer() { return this.app.viewer; }

  start() {
    if (this.active) return;
    for (const t of [this.app.wallTool, this.app.sketchTool, this.app.slabTool, this.app.roofTool, this.app.placeTool]) if (t?.active) t.stop();
    this.active = true;
    this.base = null;
    this.typed = '';
    this.made = 0;
    this.level = this.app.views.activeLevel() || this.app.levels.list[0];
    this.viewer.tool = this;
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
    this.step = this.viewer.selected.size ? 'base' : 'selecionar';
    this.buildPanel();
    this.sync();
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
    this.app.status(this.made ? `${this.made} cópia(s) criada(s).` : 'Pronto.');
  }

  // ------------------------------------------------------------ painel

  buildPanel() {
    const seg = (opts, get, set) => h('div', { class: 'seg-btns' }, Object.entries(opts).map(([k, label]) => {
      const b = h('button', { class: get() === k ? 'on' : '', onclick: () => { set(k); b.parentElement.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); this.sync(); } }, label);
      return b;
    }));
    this.selInfo = h('div', { class: 'small muted' });
    this.help = h('p', { class: 'small muted' });
    const rep = h('input', { type: 'number', min: 1, step: 1, value: this.count, style: 'width:70px', title: 'Cópias em série a cada clique (1, 2, 3… vezes o deslocamento)', onchange: e => { this.count = Math.max(1, Math.round(Number(e.target.value) || 1)); } });
    this.panel = h('div', { class: 'tool-panel' },
      h('div', { class: 'tool-panel-head' }, h('strong', {}, '⧉ Copiar'), h('span', { class: 'spacer' }),
        h('button', { class: 'primary', onclick: () => this.stop(), title: 'Termina (Esc)' }, 'Sair')),
      this.selInfo,
      h('h4', {}, 'Pontos'),
      seg({ '2d': '2D · no plano do nível', '3d': '3D · sobre os sólidos' }, () => (this.mode3d ? '3d' : '2d'), k => { this.mode3d = k === '3d'; store('boxbim.copia3d', this.mode3d ? '1' : '0'); }),
      h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: this.multiple, onchange: e => { this.multiple = e.target.checked; store('boxbim.copiaMultipla', this.multiple ? '1' : '0'); } }), 'Várias cópias (cada clique copia de novo)'),
      h('label', {}, 'Repetições por clique ', rep),
      h('div', { class: 'row-buttons' },
        h('button', { onclick: () => { if (this.viewer.selected.size) { this.step = 'base'; this.base = null; this.sync(); } }, title: 'Enter' }, 'Ponto base'),
        h('button', { onclick: () => this.toLevel(), title: 'Copia a seleção para outro nível (mesma posição em planta)' }, 'Copiar para nível…'),
        h('button', { onclick: () => this.byDistance(), title: 'Deslocamento digitado (ΔX, ΔY, ΔZ)' }, 'Por distância…')),
      this.help);
    this._sidebarWasCollapsed = document.querySelector('.layout')?.classList.contains('right-collapsed');
    if (this._sidebarWasCollapsed) this.app.setSidebar('right', false, false);
    this.app.showTab('props');
    (document.querySelector('.tab-body[data-body="props"]') || document.querySelector('.center')).prepend(this.panel);
    this.tip = h('div', { class: 'draw-tip', hidden: true });
    this.marker = h('div', { class: 'snap-marker', hidden: true });
    document.querySelector('.center').append(this.tip, this.marker);
  }

  sync() {
    if (!this.panel) return;
    const n = this.viewer.selected.size;
    this.selInfo.textContent = n ? `${n} elemento(s) selecionado(s)` : 'Nada selecionado ainda.';
    const msg = {
      selecionar: 'Clique nos elementos a copiar (Shift soma) e Enter (ou "Ponto base").',
      base: `Clique o PONTO BASE (${this.mode3d ? 'num sólido — vértices têm snap' : 'no plano do nível — pontas têm snap'}).`,
      destino: `Clique o DESTINO${this.multiple ? ' (cada clique é uma cópia)' : ''} · número + Enter = distância · F8/Shift ORTO · Esc termina.`,
    }[this.step];
    this.help.textContent = msg;
    this.app.status(`Copiar: ${msg}`);
  }

  // ------------------------------------------------------------ pontos

  ray(e) {
    const r = this.viewer.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.viewer.camera);
    return ray;
  }

  screen(v) {
    const el = this.viewer.renderer.domElement;
    const q = v.clone().project(this.viewer.camera);
    return [(q.x + 1) / 2 * el.clientWidth, (1 - q.y) / 2 * el.clientHeight];
  }

  /** Ponto do cursor: 3D = sobre o sólido (snap no vértice mais perto); 2D = no plano do nível (snap em pontas). */
  resolve(e) {
    const ray = this.ray(e);
    const near = cands => {
      let best = null, bd = SNAP_PX;
      for (const c of cands) { const s = this.screen(c); const d = Math.hypot(s[0] - (e.clientX - this.viewer.renderer.domElement.getBoundingClientRect().left), s[1] - (e.clientY - this.viewer.renderer.domElement.getBoundingClientRect().top)); if (d < bd) { bd = d; best = c; } }
      return best;
    };
    if (this.mode3d) {
      const ok = p => this.viewer.clipPlanes.every(pl => pl.distanceToPoint(p) >= -1e-4);
      const hit = ray.intersectObject(this.viewer.model, true).find(x => x.object.isMesh && x.object.visible && !x.object.userData.isEdge && x.face && ok(x.point));
      if (!hit) return null;
      const g = hit.object.geometry, pos = g.attributes.position, m = hit.object.matrixWorld;
      const tri = [hit.face.a, hit.face.b, hit.face.c].map(i => new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(m));
      const v = near(tri);
      return v ? { p: v, snap: true } : { p: hit.point.clone() };
    }
    const hit = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), -this.level.elevation), new THREE.Vector3());
    if (!hit) return null;
    const z = this.level.elevation;
    const cands = [];
    for (const el of this.viewer.elements()) {
      if (!el.visible) continue;
      if (isSketch(el) && !el.userData.bim.linha.plano) { const l = bake(el).userData.bim.linha; if (!l.arco) cands.push(new THREE.Vector3(l.a[0], l.a[1], z), new THREE.Vector3(l.b[0], l.b[1], z)); }
      else if (el.userData.bim.wall || el.userData.bim.beam) { const hd = handlesOf(this.app, el)[0]; if (hd) cands.push(new THREE.Vector3(hd.l.a[0], hd.l.a[1], z), new THREE.Vector3(hd.l.b[0], hd.l.b[1], z)); }
    }
    const v = near(cands);
    if (v) return { p: v, snap: true };
    if (this.base && this.app.wallTool.ortho !== !!e.shiftKey) {
      const d = hit.clone().sub(this.base);
      if (Math.abs(d.x) >= Math.abs(d.y)) hit.y = this.base.y; else hit.x = this.base.x;
    }
    hit.x = Math.round(hit.x / GRID) * GRID; hit.y = Math.round(hit.y / GRID) * GRID;
    if (this.base) hit.z = this.base.z;
    return { p: hit };
  }

  // ------------------------------------------------------------ eventos

  move(e) {
    this.lastEvent = e;
    for (const c of [...this.group.children]) { this.group.remove(c); c.geometry?.dispose(); }
    if (this.step === 'selecionar') { this.tip.hidden = true; this.marker.hidden = true; return; }
    const res = this.resolve(e);
    this.cursor = res;
    if (!res) { this.tip.hidden = true; return; }
    const pr = document.querySelector('.center').getBoundingClientRect(), cr = this.viewer.renderer.domElement.getBoundingClientRect();
    const s = this.screen(res.p);
    this.marker.hidden = !res.snap;
    if (res.snap) Object.assign(this.marker.style, { left: `${s[0] + cr.left - pr.left}px`, top: `${s[1] + cr.top - pr.top}px` });
    let text = this.step === 'base' ? 'ponto base' : '';
    if (this.base) {
      const d = res.p.clone().sub(this.base);
      // prévia: linha do deslocamento e a caixa da seleção na posição da cópia
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([this.base, res.p]), RUBBER);
      line.computeLineDistances();
      this.group.add(line);
      const box = new THREE.Box3();
      for (const el of this.viewer.selected) box.expandByObject(el);
      if (!box.isEmpty()) for (let k = 1; k <= this.count; k++) {
        const b = box.clone().translate(d.clone().multiplyScalar(k));
        this.group.add(new THREE.Box3Helper(b, 0x2f9bff));
      }
      this.group.children.forEach(c => { if (c.material && c.isLineSegments) { c.material = BOX; c.renderOrder = 9; } });
      text = `${fmtLen(d.length(), { suffix: true })}${Math.abs(d.z) > 1e-4 ? `  ΔZ ${fmtLen(d.z)}` : ''}${this.count > 1 ? `  × ${this.count}` : ''}`;
    }
    if (this.typed) text += `  ⌨ ${this.typed.replace('.', ',')} ${unitLabel()}`;
    this.tip.textContent = text + (res.snap ? '  ◻' : '');
    this.tip.hidden = false;
    Object.assign(this.tip.style, { left: `${e.clientX - pr.left + 16}px`, top: `${e.clientY - pr.top + 14}px` });
  }

  down(e) {
    if (e.button !== 0) return;
    if (this.step === 'selecionar') {
      const obj = this.viewer.pickAt(e.clientX, e.clientY);
      this.viewer.select(obj ? [obj] : [], e.shiftKey || e.ctrlKey);
      this.sync();
      return;
    }
    const res = this.resolve(e);
    if (!res) return;
    if (this.step === 'base') { this.base = res.p.clone(); this.step = 'destino'; this.sync(); return; }
    this.copyBy(res.p.clone().sub(this.base));
  }

  key(e) {
    if (e.target.matches?.('input, select, textarea')) return;
    const k = e.key;
    let done = true;
    if (this.step === 'destino' && (/^[0-9]$/.test(k) || ((k === ',' || k === '.') && !this.typed.includes('.')))) this.typed += k === ',' ? '.' : k;
    else if (k === 'Backspace' && this.typed) this.typed = this.typed.slice(0, -1);
    else if (k === 'Enter') {
      if (this.step === 'selecionar') { if (this.viewer.selected.size) { this.step = 'base'; this.sync(); } }
      else if (this.typed && this.cursor && this.base) {
        const v = fromUnit(this.typed); this.typed = '';
        const d = this.cursor.p.clone().sub(this.base);
        if (v > 0 && d.length() > 1e-9) this.copyBy(d.normalize().multiplyScalar(v));
      } else this.stop();
    } else if (k === 'Escape') { if (this.typed) this.typed = ''; else this.stop(); }
    else if (k === 'F8') this.app.wallTool.toggleOrtho();
    else done = false;
    if (done) { e.preventDefault(); e.stopPropagation(); if (this.active && this.lastEvent) this.move(this.lastEvent); }
  }

  // ------------------------------------------------------------ cópia

  /** Cópias da seleção deslocadas de d (× 1..Repetições). */
  async copyBy(d) {
    const sel = [...this.viewer.selected];
    if (!sel.length) { toast('Selecione o que copiar.', 'error'); return; }
    if (d.length() < 1e-6) return;
    const all = [];
    for (let k = 1; k <= this.count; k++) all.push(...(await copyElements(this.app, sel, d.clone().multiplyScalar(k))));
    this.made += all.length;
    this.app.status(`${all.length} cópia(s) a ${fmtLen(d.length(), { suffix: true })}${this.count > 1 ? ` (× ${this.count})` : ''}.${this.multiple ? ' Clique outro destino ou Esc.' : ''}`);
    if (!this.multiple) this.stop();
  }

  async toLevel() {
    const sel = [...this.viewer.selected];
    if (!sel.length) { toast('Selecione o que copiar.', 'error'); return; }
    const from = this.app.levels.ofElement(sel[0]);
    const v = await formDialog('Copiar para nível', [
      { key: 'to', label: `De ${from.name} (${fmtElev(from.elevation)}) para`, type: 'select', value: this.app.levels.list.find(l => l !== from)?.id,
        options: this.app.levels.list.filter(l => l !== from).map(l => ({ value: l.id, label: `${l.name} (${fmtElev(l.elevation)})` })) },
    ], { ok: 'Copiar' });
    if (!v) return;
    const to = this.app.levels.get(v.to);
    if (!to) return;
    const made = await copyElements(this.app, sel, new THREE.Vector3(0, 0, to.elevation - from.elevation), { level: to });
    this.made += made.length;
    this.app.status(`${made.length} elemento(s) copiado(s) para ${to.name}.`);
  }

  async byDistance() {
    const sel = [...this.viewer.selected];
    if (!sel.length) { toast('Selecione o que copiar.', 'error'); return; }
    const v = await formDialog('Copiar por distância', [
      { key: 'x', label: `ΔX (${unitLabel()})`, type: 'number', value: 0 },
      { key: 'y', label: `ΔY (${unitLabel()})`, type: 'number', value: 0 },
      { key: 'z', label: `ΔZ (${unitLabel()})`, type: 'number', value: 0 },
    ], { ok: 'Copiar' });
    if (!v) return;
    await this.copyBy(new THREE.Vector3(fromUnit(v.x) || 0, fromUnit(v.y) || 0, fromUnit(v.z) || 0));
  }
}

/**
 * Copia elementos deslocados de d (Vector3, no modelo): pelos dados de cada um (como o projeto sincroniza), com GUID
 * novo. Hospedados copiados junto com a parede ficam nela; sem a parede, viram soltos. Devolve as cópias.
 */
export async function copyElements(app, els, d, { level } = {}) {
  const v = app.viewer, project = app.project;
  const set = new Set(els);
  // portas/janelas da parede vão junto
  for (const el of els) if (el.userData.bim.wall) for (const x of app.hosting.hostedOf(el)) set.add(x);
  const list = [...set];
  const map = new Map();   // original → cópia
  for (const el of list) {
    const dados = structuredClone(project.serialize(el).dados);
    dados.bim.guid = uuid();
    if (level && dados.bim.levelId) { dados.bim.levelId = level.id; if (dados.bim.props?.Nivel) dados.bim.props.Nivel = level.name; }
    if (dados.bim.wall) dados.bim.wall.openings = []; // refeitos ao hospedar as cópias das portas/janelas
    const host = dados.bim.host;
    delete dados.bim.host;
    const copy = await project.build(dados);
    if (!copy) continue;
    project.place(copy, dados.matriz);
    copy.position.add(d);
    copy.updateMatrix();
    v.add(copy);
    map.set(el, { copy, host });
  }
  // hospedagem: a cópia da porta vai para a cópia da parede (se a parede foi copiada)
  for (const [el, { copy, host }] of map) {
    if (!host) continue;
    const wall = list.find(x => x.uuid === host.wallId || x.userData.bim.guid === host.wallId);
    const wcopy = wall && map.get(wall)?.copy;
    if (wcopy) { try { app.hosting.attach(copy, wcopy, { offset: host.offset, flip: host.flip }); } catch { /* fica solta */ } }
  }
  v.changed();
  app.refreshTree?.();
  return [...map.values()].map(x => x.copy);
}
