// Ferramentas MOVER (M) e GIRAR (R) do projeto, com gizmo visual dos eixos X/Y/Z.
//   - arraste a seta (mover) ou o anel (girar) do eixo; o plano entre duas setas move em duas direções
//   - encaixe em passos (padrão 0,05 m / 15°); segurar Ctrl desliga o encaixe durante o arraste
//   - barra de opções: ΔX ΔY ΔZ ou ângulo + eixo digitados, passo do encaixe, Desfazer, Sair
//   - Ctrl+Z desfaz o último movimento; Esc sai
// Pivô: botão direito põe o pivô no ponto clicado (encaixa em quinas, meios de aresta e centros); Alt + arrastar o
// gizmo move só o pivô. O pivô acompanha o elemento ao mover/girar.
// Paredes levam junto as portas/janelas que hospedam; uma porta/janela movida sozinha volta ao eixo da parede.
import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { h, toast } from './ui.js';
import { snapPivot } from './snap.js';
import { fmtLen, fromUnit, toUnit, unitLabel } from './units.js';

const DEG = Math.PI / 180;
const store = (k, v) => { try { localStorage.setItem(k, v); } catch { /* sem armazenamento */ } };
const load = k => { try { return localStorage.getItem(k); } catch { return null; } };

export class TransformTool extends EventTarget {
  constructor(app) {
    super();
    this.app = app;
    this.mode = null;
    this.snap = load('boxbim.tSnap') !== '0';
    this.moveStep = Number(load('boxbim.tMove')) || 0.05;
    this.rotStep = Number(load('boxbim.tRot')) || 15;
    this.history = [];
    this.autoOnSelect = load('boxbim.tAuto') !== '0'; // gizmo e barra aparecem sozinhos ao selecionar
    this.lastMode = load('boxbim.tMode') || 'translate';
    const v = app.viewer;

    this.pivot = new THREE.Object3D();
    this.pivot.name = 'pivô';
    v.scene.add(this.pivot);
    this.tc = new TransformControls(v.camera, v.renderer.domElement);
    this.tc.setSize(0.9);
    this.helper = this.tc.getHelper();
    this.helper.visible = false;
    v.overlay.add(this.helper); // fora do recorte das plantas: o gizmo aparece em todas as vistas
    v.gizmoHelper = this.helper; // o viewer esconde o gizmo nas passadas de stencil das plantas
    // marca do ponto de encaixe do pivô
    this.marker = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3)),
      new THREE.PointsMaterial({ color: 0xf5d90a, size: 11, sizeAttenuation: false, depthTest: false }));
    this.marker.visible = false;
    this.marker.renderOrder = 999;
    v.overlay.add(this.marker);
    this.tc.enabled = false;

    this.tc.addEventListener('dragging-changed', e => {
      // trava a órbita/pan enquanto arrasta o gizmo
      if (e.value) { this._ctl = v.controls; this._ctlWas = v.controls.enabled; v.controls.enabled = false; }
      else if (this._ctl) { this._ctl.enabled = this._ctlWas; this._ctl = null; }
    });
    this.tc.addEventListener('mouseDown', () => { v._gizmoClick = true; this.begin(); });
    addEventListener('pointerdown', e => { this.altDown = e.altKey; }, true); // antes do gizmo: Alt = só o pivô
    addEventListener('pointermove', e => { this.lastPointer = { x: e.clientX, y: e.clientY }; }, true);
    this.tc.addEventListener('objectChange', () => this.applyLive());
    this.tc.addEventListener('mouseUp', () => this.commit());
    v.addEventListener('select', () => { this.anchor = null; this.onSelect(); });
    this._bindPivotPick();
    app.views.addEventListener('activate', () => { this.tc.camera = v.camera; this.axesForView(); this.attach(); });

    // Ctrl durante o arraste: movimento livre
    const ctrl = on => { if (this.mode) this.applySnap(!on && this.snap); };
    addEventListener('keydown', e => { if (e.key === 'Control') ctrl(true); });
    addEventListener('keyup', e => { if (e.key === 'Control') ctrl(false); });
    this.applySnap(this.snap);
  }

  get viewer() { return this.app.viewer; }

  /** Encaixe ligado/desligado (Ctrl desliga durante o arraste); aplicado sobre o deslocamento em applyLive. */
  applySnap(on) { this.snapNow = on; }

  // ---------------------------------------------------------------- ativar

  /**
   * Seleção mudou: com "Ao selecionar" ligado, mostra o gizmo e a barra de mover/girar (no último modo usado)
   * quando há algo selecionado e some quando a seleção fica vazia. Não interfere nas ferramentas de desenho.
   */
  onSelect() {
    const busy = this.app.wallTool?.active || this.app.placeTool?.active || (this.app.sketchTool?.active && this.app.sketchTool.mode !== 'selecao');
    const has = this.viewer.selected.size > 0;
    if (this.mode) {
      if (!has && this.auto) this.stop();
      else this.attach();
      return;
    }
    if (has && this.autoOnSelect && !busy) this.start(this.lastMode, { auto: true });
  }

  start(mode, opts = {}) {
    // trocar Mover ↔ Girar com as opções já abertas pela seleção mantém o comportamento automático
    this.auto = opts.auto ?? (this.mode ? this.auto : false);
    this.lastMode = mode;
    store('boxbim.tMode', mode);
    if (this.app.wallTool.active) this.app.wallTool.stop();
    if (this.app.placeTool.active) this.app.placeTool.stop();
    this.mode = mode;
    this.tc.setMode(mode === 'rotate' ? 'rotate' : 'translate');
    this.tc.camera = this.viewer.camera;
    this.tc.enabled = true;
    this.axesForView();
    this.buildBar();
    this.attach();
    if (!this.viewer.selected.size) this.app.status(`${this.label()}: selecione um ou mais elementos (clique; Ctrl+clique soma).`);
    this.dispatchEvent(new Event('change'));
  }

  stop() {
    this.marker.visible = false;
    if (!this.mode) return;
    this.mode = null;
    this.tc.detach();
    this.tc.enabled = false;
    this.helper.visible = false;
    this.bar?.remove();
    this.bar = null;
    this.app.status('Pronto.');
    this.dispatchEvent(new Event('change'));
  }

  label() { return this.mode === 'rotate' ? 'Girar' : 'Mover'; }

  /** Nas plantas só faz sentido mover em X/Y e girar em Z; nas elevações, esconde o eixo da direção de visão. */
  axesForView() {
    const v = this.app.views.active;
    const t = this.tc;
    t.showX = t.showY = t.showZ = true;
    if (v.kind === 'plan' || v.kind === 'ceiling') {
      if (this.mode === 'rotate') { t.showX = false; t.showY = false; } else t.showZ = false;
    } else if (v.kind === 'elevation') {
      const [dx, dy] = v.dir;
      if (this.mode === 'rotate') { t.showZ = false; if (Math.abs(dx) > 0.5) t.showY = false; else t.showX = false; }
      else if (Math.abs(dx) > 0.5) t.showX = false; else t.showY = false;
    }
  }

  // ---------------------------------------------------------------- alvos e pivô

  /** Elementos que se movem: a seleção + portas/janelas hospedadas nas paredes selecionadas. */
  targets() {
    const set = new Set(this.viewer.selected);
    for (const el of [...set]) if (el.userData.bim?.wall) this.app.hosting.hostedOf(el).forEach(x => set.add(x));
    return [...set].filter(o => o.parent);
  }

  attach() {
    if (!this.mode) return;
    const sel = [...this.viewer.selected];
    if (!sel.length) { this.tc.detach(); this.helper.visible = false; return; }
    const f = this.frameBox();
    if (f.box.isEmpty()) return;
    // pivô escolhido (guardado no referencial do 1º elemento, acompanha o movimento) ou o padrão
    if (this.anchor) this.pivot.position.copy(sel[0].localToWorld(this.anchor.clone()));
    else this.pivot.position.copy(this.boxPoint(f, this.mode === 'rotate' ? [0.5, 0.5, 0] : [0.5, 0.5, 0.5]));
    this.pivot.quaternion.identity();
    this.pivot.scale.set(1, 1, 1);
    this.pivot.updateMatrixWorld(true);
    this.tc.attach(this.pivot);
    this.helper.visible = true;
    const n = this.targets().length;
    this.app.status(`${this.label()} ${n} elemento(s): arraste ${this.mode === 'rotate' ? 'o anel do eixo' : 'a seta do eixo (ou o plano entre duas setas)'} · botão direito = pivô no ponto · Alt+arraste = só o pivô · Ctrl+Z desfaz · Esc sai.`);
  }

  // ---------------------------------------------------------------- pivô

  /**
   * Caixa de elementos no referencial deles: um elemento só usa os próprios eixos (a quina de uma parede girada
   * é a quina de verdade); vários usam os eixos do mundo.
   */
  frameBox(objs = [...this.viewer.selected]) {
    const q = objs.length === 1 ? objs[0].getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
    const inv = new THREE.Matrix4().makeRotationFromQuaternion(q).invert();
    const box = new THREE.Box3(), tmp = new THREE.Box3(), m = new THREE.Matrix4();
    for (const o of objs) {
      o.updateMatrixWorld(true);
      o.traverse(n => {
        if (!n.isMesh || !n.geometry) return;
        if (!n.geometry.boundingBox) n.geometry.computeBoundingBox();
        box.union(tmp.copy(n.geometry.boundingBox).applyMatrix4(m.multiplyMatrices(inv, n.matrixWorld)));
      });
    }
    return { box, q };
  }

  /** Ponto da caixa em frações [x, y, z] (0 = mínimo, 0,5 = meio, 1 = máximo). */
  boxPoint({ box, q }, a) {
    const size = box.getSize(new THREE.Vector3());
    return new THREE.Vector3(box.min.x + size.x * a[0], box.min.y + size.y * a[1], box.min.z + size.z * a[2]).applyQuaternion(q);
  }

  /** Pontos de encaixe do pivô: quinas, meios de aresta, centros de face e centro de cada elemento visível. */
  snapPoints() {
    const pts = [];
    const fr = [0, 0.5, 1];
    for (const el of this.viewer.elements()) {
      if (!el.visible) continue;
      const f = this.frameBox([el]);
      if (f.box.isEmpty()) continue;
      for (const x of fr) for (const y of fr) for (const z of fr) pts.push(this.boxPoint(f, [x, y, z]));
    }
    return pts;
  }

  /** Ponto de encaixe mais próximo do cursor na tela (até `tol` px), ou null. Pontos fora do recorte da planta não contam. */
  nearestSnap(x, y, pts = this.snapPoints(), tol = 14) {
    const v = this.viewer, r = v.renderer.domElement.getBoundingClientRect();
    let best = null, bestD = tol;
    for (const p of pts) {
      if (!v.clipPlanes.every(pl => pl.distanceToPoint(p) >= -1e-3)) continue;
      const q = p.clone().project(v.camera);
      if (q.z < -1 || q.z > 1) continue;
      const d = Math.hypot(r.left + (q.x + 1) / 2 * r.width - x, r.top + (1 - q.y) / 2 * r.height - y);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }

  /** Fixa o pivô num ponto do mundo (guardado no referencial do 1º elemento selecionado). */
  setPivot(world) {
    const first = [...this.viewer.selected][0];
    if (!first) return;
    first.updateMatrixWorld(true);
    this.anchor = world ? first.worldToLocal(world.clone()) : null;
    this.attach();
    const f = v => fmtLen(v);
    this.app.status(world ? `Pivô em X ${f(world.x)} · Y ${f(world.y)} · Z ${f(world.z)} ${unitLabel()}.` : 'Pivô no ponto padrão.');
  }

  /**
   * Com Mover/Girar ATIVO, o botão direito (sem arrastar) põe o pivô no ponto — a seleção fica (o ponto pode ser de
   * outro elemento, para alinhar). Fora dele o botão direito seleciona (viewer).
   */
  _bindPivotPick() {
    const el = this.viewer.renderer.domElement;
    let down = null;
    this.viewer.rightClickTaken = () => !!this.mode && this.viewer.selected.size > 0;
    el.addEventListener('pointerdown', e => { if (e.button === 2) down = { x: e.clientX, y: e.clientY }; });
    el.addEventListener('contextmenu', e => {
      e.preventDefault();
      const moved = down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4; // arrastou: foi pan
      down = null;
      if (moved || e.altKey || !this.mode || this.viewer.tool || this.app.wallTool?.active || this.app.placeTool?.active) return;
      const hit = this.viewer.pickHit(e.clientX, e.clientY);
      if (!this.viewer.selected.size) return;
      const p = this.nearestSnap(e.clientX, e.clientY) || hit?.point;
      if (p) this.setPivot(p);
    });
  }

  begin() {
    // Alt + arrastar (mover): desloca só o pivô, encaixando nos pontos dos elementos
    this.pivotOnly = this.altDown && this.mode === 'translate';
    if (this.pivotOnly) { this.items = []; this.snapCache = this.snapPoints(); return; }
    this.pivot.updateMatrixWorld(true);
    this.pivotStart = this.pivot.matrixWorld.clone();
    this.pivotPos0 = this.pivot.position.clone();
    this.pivotQuat0 = this.pivot.quaternion.clone();
    this.items = this.targets().map(obj => {
      obj.updateMatrix();
      obj.parent.updateMatrixWorld(true);
      return { obj, start: obj.matrix.clone(), parentWorld: obj.parent.matrixWorld.clone() };
    });
  }

  /** Aplica a variação do pivô (desde o início do arraste) em cada alvo, respeitando o pai de cada um. */
  applyLive() {
    if (!this.items) return;
    if (this.pivotOnly) { this.dragPivot(); return; }
    if (this.snapNow && this.tc.dragging) snapPivot(this.pivot, this.pivotPos0, this.pivotQuat0, this.moveStep, this.rotStep);
    this.pivot.updateMatrixWorld(true);
    const delta = this.pivot.matrixWorld.clone().multiply(this.pivotStart.clone().invert());
    for (const it of this.items) {
      const world = it.parentWorld.clone().multiply(it.start);
      const local = it.parentWorld.clone().invert().multiply(delta.clone().multiply(world));
      local.decompose(it.obj.position, it.obj.quaternion, it.obj.scale);
    }
    this.showDelta(delta);
  }

  dragPivot() {
    const m = this.lastPointer;
    const p = m && this.nearestSnap(m.x, m.y, this.snapCache);
    if (p) this.pivot.position.copy(p);
    this.marker.visible = !!p;
    if (p) this.marker.position.copy(p);
    this.pivot.updateMatrixWorld(true);
    const f = v => fmtLen(v);
    const w = this.pivot.position;
    this.app.status(`Pivô: X ${f(w.x)} · Y ${f(w.y)} · Z ${f(w.z)} ${unitLabel()}${p ? ' (encaixado)' : ''} — solte para fixar.`);
  }

  showDelta(delta) {
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    delta.decompose(p, q, s);
    const f = v => (Math.round(v * 1000) / 1000).toString().replace('.', ',');
    if (this.mode === 'rotate') {
      const ang = 2 * Math.acos(Math.min(1, Math.abs(q.w))) / DEG;
      this.app.status(`Girar: ${f(ang)}°`);
    } else this.app.status(`Mover: ΔX ${fmtLen(p.x)} · ΔY ${fmtLen(p.y)} · ΔZ ${fmtLen(p.z)} ${unitLabel()}`);
  }

  commit() {
    if (!this.items) return;
    if (this.pivotOnly) {
      this.items = null; this.pivotOnly = false; this.snapCache = null; this.marker.visible = false;
      this.setPivot(this.pivot.position.clone());
      return;
    }
    const entry = this.items.map(it => { it.obj.updateMatrix(); return { obj: it.obj, before: it.start, after: it.obj.matrix.clone() }; });
    this.items = null;
    if (!entry.some(e => !e.before.equals(e.after))) return;
    this.history.push(entry);
    if (this.history.length > 50) this.history.shift();
    this.afterTransform(entry.map(e => e.obj));
    this.attach();
  }

  /** Hospedagem e atualização da interface depois de mover/girar. */
  afterTransform(objs) {
    const set = new Set(objs);
    for (const o of objs) {
      const host = o.userData.bim?.host;
      if (!host) continue;
      const wall = this.viewer.findById(host.wallId);
      // porta/janela movida sem a parede: volta para o eixo da parede (e para a orientação dela)
      if (wall && !set.has(wall)) this.app.hosting.reproject(o);
    }
    this.viewer.changed();
    this.app.renderProps();
  }

  undo() {
    const entry = this.history.pop();
    if (!entry) { toast('Nada para desfazer.'); return; }
    for (const e of entry) if (e.obj.parent) e.before.decompose(e.obj.position, e.obj.quaternion, e.obj.scale);
    this.afterTransform(entry.map(e => e.obj));
    this.attach();
    this.app.status('Movimento desfeito.');
  }

  /** Movimento digitado (ΔX ΔY ΔZ) ou rotação digitada (ângulo em torno de um eixo). */
  applyNumeric({ dx = 0, dy = 0, dz = 0, angle = 0, axis = 'Z' }) {
    if (!this.viewer.selected.size) { toast('Selecione um elemento primeiro.', 'error'); return; }
    this.attach();
    this.begin();
    if (this.mode === 'rotate') {
      const a = { X: new THREE.Vector3(1, 0, 0), Y: new THREE.Vector3(0, 1, 0), Z: new THREE.Vector3(0, 0, 1) }[axis];
      this.pivot.quaternion.setFromAxisAngle(a, angle * DEG);
    } else this.pivot.position.add(new THREE.Vector3(dx, dy, dz));
    this.applyLive();
    this.commit();
  }

  // ---------------------------------------------------------------- barra de opções

  buildBar() {
    this.bar?.remove();
    const num = (val, title, w = 70) => h('input', { type: 'number', step: 'any', value: val, title, style: `width:${w}px` });
    let fields, apply;
    if (this.mode === 'rotate') {
      const ang = num(90, 'Ângulo em graus (positivo = anti-horário olhando de cima do eixo)');
      const axis = h('select', { title: 'Eixo' }, ['Z', 'X', 'Y'].map(a => h('option', { value: a }, a)));
      fields = [h('label', {}, 'Ângulo (°)', ang), h('label', {}, 'Eixo', axis)];
      apply = () => this.applyNumeric({ angle: Number(ang.value) || 0, axis: axis.value });
    } else {
      const u = unitLabel(), dx = num(0, `Deslocamento em X (${u})`), dy = num(0, `Deslocamento em Y (${u})`), dz = num(0, `Deslocamento em Z (${u})`);
      fields = [h('label', {}, 'ΔX', dx), h('label', {}, 'ΔY', dy), h('label', {}, 'ΔZ', dz)];
      apply = () => this.applyNumeric({ dx: fromUnit(dx.value) || 0, dy: fromUnit(dy.value) || 0, dz: fromUnit(dz.value) || 0 });
    }
    const snapChk = h('input', { type: 'checkbox', checked: this.snap, onchange: e => { this.snap = e.target.checked; store('boxbim.tSnap', this.snap ? '1' : '0'); this.applySnap(this.snap); } });
    const stepIn = this.mode === 'rotate'
      ? num(this.rotStep, 'Passo do encaixe (graus)', 54)
      : num(toUnit(this.moveStep), `Passo do encaixe (${unitLabel()})`, 60);
    stepIn.addEventListener('change', e => {
      const v = Math.max(0.001, (this.mode === 'rotate' ? Number(e.target.value) : fromUnit(e.target.value)) || 0);
      if (this.mode === 'rotate') { this.rotStep = v; store('boxbim.tRot', v); } else { this.moveStep = v; store('boxbim.tMove', v); }
      this.applySnap(this.snap);
    });
    this.bar = h('div', { class: 'draw-bar transform-bar' },
      h('strong', {}, this.mode === 'rotate' ? '⟳ Girar' : '✥ Mover'),
      ...fields,
      h('button', { class: 'primary', onclick: apply, title: 'Aplica o valor digitado na seleção' }, 'Aplicar'),
      h('label', { title: 'Encaixe em passos (Ctrl desliga durante o arraste)' }, snapChk, 'Encaixe', stepIn, this.mode === 'rotate' ? '°' : unitLabel()),
      h('button', { onclick: () => this.undo(), title: 'Ctrl+Z' }, 'Desfazer'),
      h('button', { onclick: () => this.start(this.mode === 'rotate' ? 'translate' : 'rotate', { auto: this.auto }), title: 'M / R' }, this.mode === 'rotate' ? 'Mover' : 'Girar'),
      h('label', { title: 'Mostrar estas opções sempre que algo for selecionado' },
        h('input', { type: 'checkbox', checked: this.autoOnSelect, onchange: e => { this.autoOnSelect = e.target.checked; store('boxbim.tAuto', this.autoOnSelect ? '1' : '0'); } }), 'Ao selecionar'),
      h('button', { onclick: () => { this.stop(); this.viewer.select([]); }, title: 'Esc: sai e limpa a seleção' }, 'Sair'));
    // no fim da faixa (à direita dos grupos); sem faixa, flutuando na vista
    (document.querySelector('#ribbon-context') || document.querySelector('.center')).append(this.bar);
  }
}
