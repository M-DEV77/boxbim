// Visualizador. Convenção do BoxBim: Z para cima, unidades em metros (como o Revit).
// Duas câmeras: perspectiva (vista 3D, órbita livre) e ortográfica (plantas e elevações: só pan e zoom).
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { HATCH_VERT, HATCH_FRAG, hatchCode } from './hatch.js';

THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

const DARK_BG = new THREE.Color(0x1b1f26);
const PAPER_BG = new THREE.Color(0xf4f5f2);

// Preenchimento de corte (poché) por stencil: conta faces de trás (+1) e da frente (−1) da geometria recortada;
// onde a soma ≠ 0 o plano de corte está dentro de um sólido e recebe a tampa. Funciona com sólidos sobrepostos.
const stencilMat = (side, op) => new THREE.MeshBasicMaterial({
  side, colorWrite: false, depthWrite: false, depthTest: false,
  stencilWrite: true, stencilFunc: THREE.AlwaysStencilFunc,
  stencilFail: op, stencilZFail: op, stencilZPass: op,
});
const STENCIL_BACK = stencilMat(THREE.BackSide, THREE.IncrementWrapStencilOp);
const STENCIL_FRONT = stencilMat(THREE.FrontSide, THREE.DecrementWrapStencilOp);
// tampa do corte: cor de fundo + HACHURA do material (hatch.js), desenhada em coordenadas do modelo
const CAP_MAT = new THREE.ShaderMaterial({
  vertexShader: HATCH_VERT, fragmentShader: HATCH_FRAG, side: THREE.DoubleSide,
  uniforms: {
    uBg: { value: new THREE.Color(0x262626) }, uLine: { value: new THREE.Color(0x2b2b2b) }, uPattern: { value: 0 },
    uSpacing: { value: 0.25 }, uAngle: { value: 0.785 }, uLinePx: { value: 1 },
  },
  stencilWrite: true, stencilRef: 0, stencilFunc: THREE.NotEqualStencilFunc,
  stencilFail: THREE.ReplaceStencilOp, stencilZFail: THREE.ReplaceStencilOp, stencilZPass: THREE.ReplaceStencilOp,
});
const LINE_LAYER = 1; // linhas ficam fora da contagem do stencil
const DEFAULT_CAP = 0x262626; // preenchimento de corte de elementos sem material de biblioteca

// Linhas com espessura de verdade (LineMaterial, em px): arestas de PROJEÇÃO das peças e linhas de CORTE (contorno onde
// o plano de corte atravessa as peças). A espessura vem do peso em mm de papel × escala da vista × zoom (drawing.js).
export const EDGE_MAT = new LineMaterial({ color: 0x1d1d1d, linewidth: 1 });
export const CUT_MAT = new LineMaterial({ color: 0x111111, linewidth: 2.5, depthTest: false });
CUT_MAT.clipping = false; // fica exatamente no plano de corte
// divisas internas do corte (entre camadas de uma parede, entre peças encostadas): peso de projeção
export const CUT_INNER_MAT = new LineMaterial({ color: 0x3a3a3a, linewidth: 1, depthTest: false });
CUT_INNER_MAT.clipping = false;
const MAX_EDGE_TRIS = 1_500_000;

export class Viewer extends EventTarget {
  constructor(container) {
    super();
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = DARK_BG.clone();

    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, stencil: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.perspCam = new THREE.PerspectiveCamera(50, 1, 0.05, 20000);
    this.perspCam.position.set(18, -22, 14);
    this.orthoCam = new THREE.OrthographicCamera(-10, 10, 10, -10, -10000, 10000);
    this.orthoHalfH = 10;
    this.camera = this.perspCam;
    for (const c of [this.perspCam, this.orthoCam]) c.layers.enable(LINE_LAYER);

    // tampa do plano de corte (desenhada só onde o stencil indica interior de sólido)
    this.capScene = new THREE.Scene();
    this.cap = new THREE.Mesh(new THREE.PlaneGeometry(1e5, 1e5), CAP_MAT);
    this.cap.renderOrder = 1;
    this.cap.layers.enableAll(); // desenhada com a câmera na camada de cada cor de corte
    this.capScene.add(this.cap);
    this.capPlane = null;
    this._capBuckets = new Map();
    this._bucketsDirty = true;

    const mkControls = cam => {
      const c = new OrbitControls(cam, this.renderer.domElement);
      c.enableDamping = true;
      c.dampingFactor = 0.12;
      c.screenSpacePanning = true;
      return c;
    };
    this.perspControls = mkControls(this.perspCam);
    // mouse: esquerdo gira (clique seleciona), meio arrasta, roda aproxima, DIREITO SELECIONA (clique ou janela);
    // Alt + direito gira (nas plantas e elevações, arrasta) — ver _bindPicking
    this.perspControls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: null };
    this.orthoControls = mkControls(this.orthoCam);
    this.orthoControls.enableRotate = false;
    this.orthoControls.zoomToCursor = true;
    this.orthoControls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.PAN, RIGHT: null };
    this.orthoControls.enabled = false;
    this.controls = this.perspControls;

    this.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a3328, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(30, -40, 60);
    this.scene.add(sun);

    this.grid = new THREE.GridHelper(100, 100, 0x4a5568, 0x2c333d);
    this.grid.rotation.x = Math.PI / 2;
    this.grid.position.z = -0.005; // evita z-fighting com lajes na cota 0
    this.scene.add(this.grid);
    this.axes = new THREE.AxesHelper(2);
    this.scene.add(this.axes);

    /** Tudo que pertence ao modelo fica aqui; o que está fora (grade, luzes, anotações) não é exportado. */
    this.model = new THREE.Group();
    this.model.name = 'Projeto';
    this.scene.add(this.model);

    /** Anotações da vista ativa (linhas de nível nas elevações). */
    this.annotations = new THREE.Group();
    this.scene.add(this.annotations);

    /** Contornos magenta dos ocultos enquanto "Revelar ocultos" está ligado (barra inferior, 👁). */
    this.revealGroup = new THREE.Group();
    this.scene.add(this.revealGroup);
    this.revealHidden = false;
    this.hiddenCats = new Set(); // categorias ocultas na tela (ex.: 'eixos' = eixos de trabalho)
    /** Cotas temporárias e outros rótulos que acompanham o zoom (além das anotações da vista). */
    this.labelGroups = [];

    this.clipPlanes = [];
    this.frameHooks = [];   // chamados a cada quadro (ex.: widget de eixos)
    // camada desenhada por cima de tudo e SEM os planos de corte das plantas (gizmo de mover/girar):
    // assim ele aparece mesmo quando o centro do elemento está acima do corte ou fora da faixa da vista
    this.overlay = new THREE.Scene();
    this.showEdges = false;
    this.selected = new Set();
    this.raycaster = new THREE.Raycaster();
    this._bindPicking();

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    const loop = () => {
      this.controls.update();
      if (this.annotations.children.length || this.labelGroups.length) this._scaleLabels();
      for (const fn of this.frameHooks) fn();
      if (this.renderOverride) this.renderOverride(); // vista Render (pós-processamento / path tracing)
      else if (this.capPlane !== null && this.capsEnabled !== false) this._renderWithCaps();
      else this.renderer.render(this.scene, this.camera);
      if (this.overlay.children.some(o => o.visible)) this._renderOverlay();
      requestAnimationFrame(loop);
    };
    loop();
  }

  resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    EDGE_MAT.resolution.set(w, h);
    CUT_MAT.resolution.set(w, h);
    CUT_INNER_MAT.resolution.set(w, h);
    this.perspCam.aspect = w / h;
    this.perspCam.updateProjectionMatrix();
    this._applyOrthoFrustum();
    this.renderer.setSize(w, h);
  }

  /**
   * Plantas com corte: para cada cor de material (camada de parede, piso…), conta no stencil as faces da
   * geometria daquele material e desenha a tampa do plano de corte nessa cor. Elementos sem material de
   * biblioteca usam o preenchimento escuro padrão.
   */
  _renderWithCaps() {
    const r = this.renderer, cam = this.camera, scene = this.scene;
    if (this._bucketsDirty) this._assignCapBuckets();
    r.autoClear = false;
    r.setClearColor(scene.background, 1);
    r.clear(true, true, true);
    const planes = r.clippingPlanes;
    const bg = scene.background;
    scene.background = null;
    const gizmo = this.gizmoHelper?.visible;
    if (gizmo) this.gizmoHelper.visible = false; // o gizmo não entra na contagem do corte
    for (const [, { layer, color, spec }] of this._capBuckets) {
      // 1) contagem só com o plano de corte: se a profundidade também recortasse, geraria tampas falsas
      r.clippingPlanes = this.clipPlanes.slice(0, 1);
      cam.layers.set(layer);
      scene.overrideMaterial = STENCIL_BACK; r.render(scene, cam);
      scene.overrideMaterial = STENCIL_FRONT; r.render(scene, cam);
      scene.overrideMaterial = null;
      // 2) tampa desta cor no plano de corte (sem recorte, senão ela mesma seria cortada)
      const u = CAP_MAT.uniforms;
      if (spec && spec.padrao !== 'nenhuma') {
        u.uBg.value.set(spec.fundo);
        u.uLine.value.set(spec.cor);
        u.uPattern.value = hatchCode(spec);
        u.uSpacing.value = Math.max(0.0005, spec.escala * (this.paperScale || 100) / 1000);
        u.uAngle.value = (spec.angulo || 0) * Math.PI / 180;
      } else { u.uBg.value.setHex(color); u.uPattern.value = 0; }
      r.clippingPlanes = [];
      r.render(this.capScene, cam);
      r.clearStencil();
    }
    if (gizmo) this.gizmoHelper.visible = true;
    // 3) cena normal por cima, testando profundidade contra as tampas
    r.clippingPlanes = planes;
    cam.layers.set(0);
    cam.layers.enable(LINE_LAYER);
    r.render(scene, cam);
    scene.background = bg;
    r.autoClear = true;
  }

  /** Distribui as malhas do modelo em camadas de render (2..31), uma por cor de preenchimento de corte. */
  _assignCapBuckets() {
    const buckets = new Map();
    let next = 2;
    this.model.traverse(o => {
      if (!o.isMesh || o.userData.isEdge) return;
      if (o.userData.noCap) { o.layers.set(0); return; } // vazios não recebem preenchimento de corte
      const mat = [].concat(o.userData._origMat || o.material)[0];
      // material de verdade da peça (o estilo da vista troca o material; a hachura é do material da biblioteca)
      const base = [].concat(o.userData._styleBase || o.userData._origMat || o.material)[0];
      const spec = this.hatchFor?.(base) || null;
      let color = mat?.userData?.capColor ?? DEFAULT_CAP;
      let key = spec ? `h:${JSON.stringify(spec)}` : `c:${color}`;
      if (!buckets.has(key)) {
        if (next > 31) key = `c:${DEFAULT_CAP}`; // limite de camadas de render: o resto usa o padrão
        if (!buckets.has(key)) buckets.set(key, { layer: next++, color: key === `c:${DEFAULT_CAP}` ? DEFAULT_CAP : color, spec: key.startsWith('h:') ? spec : null });
      }
      o.layers.set(0);
      o.layers.enable(buckets.get(key).layer);
    });
    this._capBuckets = buckets;
    this._bucketsDirty = false;
  }

  _renderOverlay() {
    const r = this.renderer;
    const planes = r.clippingPlanes;
    r.clippingPlanes = [];
    r.autoClear = false;
    r.render(this.overlay, this.camera);
    r.autoClear = true;
    r.clippingPlanes = planes;
  }

  get aspect() { return (this.container.clientWidth || 1) / (this.container.clientHeight || 1); }

  _applyOrthoFrustum() {
    const hh = this.orthoHalfH, a = this.aspect;
    // Planta de forro: a câmera olha de baixo, o que inverte o eixo Y da tela; espelhar o vertical
    // devolve a mesma orientação da planta de piso (como o Revit faz).
    const m = this.orthoMirror ? -1 : 1;
    Object.assign(this.orthoCam, { left: -hh * a, right: hh * a, top: hh * m, bottom: -hh * m });
    this.orthoCam.updateProjectionMatrix();
  }

  changed() { this._bucketsDirty = true; this.dispatchEvent(new Event('change')); }

  add(obj, { fit = false } = {}) {
    this.model.add(obj);
    this.onAdd?.(obj); // ambientes: camada dos elementos novos, visibilidade e trava
    if (obj.userData?.bim) this.updateVisibility(obj);
    if (this.clipPlanes.length || this.showEdges) this._prepare2D(obj);
    obj.traverse(o => { if (o.isLine) o.layers.set(LINE_LAYER); });
    if (fit) this.fit();
    this.changed();
    return obj;
  }

  remove(obj) {
    this.selected.delete(obj);
    obj.parent?.remove(obj);
    obj.traverse(o => { o.geometry?.dispose?.(); });
    // a hospedagem (portas/janelas em paredes) reage a remoções
    this.dispatchEvent(new CustomEvent('remove', { detail: obj }));
    this.changed();
  }

  clear() {
    for (const c of [...this.model.children]) this.remove(c);
    this.selected.clear();
    this.dispatchEvent(new Event('select'));
  }

  // ---------------------------------------------------------------- visibilidade

  /**
   * Um elemento fica oculto por: userHidden (você ocultou — H, árvore; só nesta tela), envHidden (camada do ambiente
   * oculta) ou catHidden (categoria oculta na tela, ex.: eixos de trabalho). Com "Revelar ocultos" eles aparecem com
   * contorno magenta e podem ser clicados para voltar.
   */
  isHidden(el) { const u = el.userData; return !!(u.userHidden || u.envHidden || u.catHidden); }

  updateVisibility(el) {
    const u = el.userData;
    u.catHidden = !!u.bim?.eixo && this.hiddenCats.has('eixos');
    el.visible = !this.isHidden(el) || this.revealHidden;
  }

  updateAllVisibility() {
    for (const el of this.elements()) this.updateVisibility(el);
    this.refreshReveal();
    this.dispatchEvent(new Event('visibility'));
  }

  setCategoryHidden(cat, hidden) {
    if (hidden) this.hiddenCats.add(cat); else this.hiddenCats.delete(cat);
    this.updateAllVisibility();
  }

  setHidden(els, hidden) {
    for (const el of els) { el.userData.userHidden = !!hidden; this.updateVisibility(el); }
    if (hidden) this.select([...this.selected].filter(o => !els.includes(o)));
    this.refreshReveal();
    this.dispatchEvent(new Event('visibility'));
  }

  hiddenCount() { return this.elements().filter(e => this.isHidden(e)).length; }

  setReveal(on) {
    this.revealHidden = !!on;
    this.container.classList.toggle('revealing', this.revealHidden);
    this.updateAllVisibility();
  }

  /** Contorno magenta (caixa) em cada elemento oculto enquanto revela. */
  refreshReveal() {
    for (const c of [...this.revealGroup.children]) { this.revealGroup.remove(c); c.geometry?.dispose?.(); }
    if (!this.revealHidden) return;
    for (const el of this.elements()) {
      if (!this.isHidden(el)) continue;
      const box = new THREE.Box3().setFromObject(el);
      if (box.isEmpty()) continue;
      const helper = new THREE.Box3Helper(box, 0xff2fd6);
      helper.material.depthTest = false;
      helper.renderOrder = 8;
      this.revealGroup.add(helper);
    }
  }

  /** Elementos BIM do modelo (cada arquivo importado é um grupo; cada elemento, um filho). */
  elements() {
    const out = [];
    this.model.traverse(o => { if (o.userData?.bim) out.push(o); });
    return out;
  }

  findById(id) {
    let found = null;
    this.model.traverse(o => { if (!found && (o.uuid === id || o.userData?.bim?.guid === id)) found = o; });
    return found;
  }

  modelBox() {
    const box = new THREE.Box3();
    this.model.traverse(o => {
      if (!o.visible || o.userData.isEdge || !(o.isMesh || o.isLine || o.isLineSegments)) return;
      box.expandByObject(o);
    });
    return box;
  }

  // ---------------------------------------------------------------- câmeras e vistas

  /**
   * Aplica uma vista. state: {
   *   camera: 'persp' | 'ortho', dir: [x,y,z] (direção de onde a câmera olha, só ortho),
   *   clip: [{ normal: [x,y,z], constant }], paper: bool, rotate: bool, grid: bool, gridZ: number
   * }
   */
  applyView(state) {
    const ortho = state.camera === 'ortho';
    this.camera = ortho ? this.orthoCam : this.perspCam;
    this.perspControls.enabled = !ortho;
    this.orthoControls.enabled = ortho;
    this.controls = ortho ? this.orthoControls : this.perspControls;
    this.orthoControls.enableRotate = !!state.rotate;
    // vista 3D ortogonal gira como a perspectiva; plantas e elevações só deslocam
    this.orthoControls.mouseButtons = state.rotate
      ? { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: null }
      : { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.PAN, RIGHT: null };

    this.clipPlanes = (state.clip || []).map(p => new THREE.Plane(new THREE.Vector3(...p.normal), p.constant));
    this.renderer.clippingPlanes = this.clipPlanes;
    this.orthoMirror = ortho && !!state.mirror;
    this._applyOrthoFrustum();
    // plano onde vai a tampa de corte (cota z)
    this.capPlane = state.capZ ?? null;
    if (this.capPlane !== null) this.cap.position.set(0, 0, this.capPlane);

    // a vista Render troca o fundo por uma textura de céu: aqui volta a ser cor
    if (this.scene.background?.isColor) this.scene.background.copy(state.paper ? PAPER_BG : DARK_BG);
    else this.scene.background = (state.paper ? PAPER_BG : DARK_BG).clone();
    this.grid.visible = this.axes.visible = state.grid !== false && !state.paper;
    this.grid.position.z = (state.gridZ ?? 0) - 0.005;

    this.showEdges = !!state.paper;
    if (this.clipPlanes.length || this.showEdges) this._prepare2D(this.model);
    this.model.traverse(o => { if (o.userData.isEdge) o.visible = this.showEdges; });
  }

  /** Salva/restaura a câmera de cada vista ao trocar de aba. */
  cameraState() {
    return { pos: this.camera.position.toArray(), target: this.controls.target.toArray(), zoom: this.camera.zoom, halfH: this.orthoHalfH, ortho: !!this.camera.isOrthographicCamera };
  }

  restoreCamera(s) {
    const cam = this.camera;
    const target = new THREE.Vector3().fromArray(s.target);
    const pos = new THREE.Vector3().fromArray(s.pos);
    const tan = Math.tan(this.perspCam.fov / 2 * Math.PI / 180);
    if (cam.isOrthographicCamera && !s.ortho) {
      // perspectiva → ortogonal: mesma direção; a altura visível vem da distância ao alvo
      this.orthoHalfH = Math.max(0.5, pos.distanceTo(target) * tan);
      cam.zoom = 1;
      cam.position.copy(target).add(pos.clone().sub(target).normalize().multiplyScalar(1000));
    } else if (!cam.isOrthographicCamera && s.ortho) {
      // ortogonal → perspectiva: distância que mostra a mesma altura
      const half = (s.halfH ?? this.orthoHalfH) / (s.zoom || 1);
      cam.position.copy(target).add(pos.clone().sub(target).normalize().multiplyScalar(half / tan));
      cam.zoom = 1;
    } else {
      cam.position.copy(pos);
      cam.zoom = s.zoom ?? 1;
      if (cam.isOrthographicCamera) this.orthoHalfH = s.halfH ?? this.orthoHalfH;
    }
    this.controls.target.copy(target);
    if (cam.isOrthographicCamera) this._applyOrthoFrustum();
    cam.updateProjectionMatrix();
    this.controls.update();
  }

  /** Fundo da vista: papel (desenho) ou escuro (3D). */
  setBackground(kind) {
    const c = kind === 'paper' ? PAPER_BG : DARK_BG;
    if (this.scene.background?.isColor) this.scene.background.copy(c); else this.scene.background = c.clone();
  }

  /** Arestas (contornos) das peças: liga/desliga e cor. */
  setEdges(on, color = 0x1d1d1d) {
    this.showEdges = on;
    EDGE_MAT.color.setHex(color);
    if (on) this._prepare2D(this.model);
    this.model.traverse(o => { if (o.userData.isEdge) o.visible = on; });
  }

  /** Enquadra o modelo (ou objetos) olhando ao longo de dir na câmera ortográfica. */
  frameOrtho(dir, target, pad = 1.15) {
    const box = new THREE.Box3();
    for (const o of [].concat(target || this.model)) {
      if (o === this.model) box.union(this.modelBox()); else box.expandByObject(o);
    }
    if (box.isEmpty()) box.set(new THREE.Vector3(-10, -10, 0), new THREE.Vector3(10, 10, 3));
    const center = box.getCenter(new THREE.Vector3());
    const d = new THREE.Vector3(...dir).normalize();
    const cam = this.orthoCam;
    cam.position.copy(center).addScaledVector(d, 1000);
    this.orthoControls.target.copy(center);
    cam.lookAt(center);
    cam.updateMatrixWorld(true);
    const inv = cam.matrixWorldInverse;
    const c = center.clone().applyMatrix4(inv);
    let w = 0, h = 0;
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      const p = new THREE.Vector3(x, y, z).applyMatrix4(inv).sub(c);
      w = Math.max(w, Math.abs(p.x)); h = Math.max(h, Math.abs(p.y));
    }
    this.orthoHalfH = Math.max(h, w / this.aspect, 1) * pad;
    cam.zoom = 1;
    cam.near = -5000; cam.far = 5000;
    this._applyOrthoFrustum();
    this.orthoControls.update();
  }

  /** Enquadra o modelo, um objeto ou uma lista de objetos. */
  fit(target) {
    if (this.camera.isOrthographicCamera) {
      const dir = this.camera.position.clone().sub(this.orthoControls.target).normalize();
      // nas elevações, o enquadramento inclui as linhas e os rótulos de nível
      if (!target && this.annotations.children.length) return this.frameOrtho(dir.toArray(), [this.model, this.annotations], 1.45);
      return this.frameOrtho(dir.toArray(), target);
    }
    const box = new THREE.Box3();
    for (const o of [].concat(target || this.model)) {
      if (o === this.model) box.union(this.modelBox()); else box.expandByObject(o);
    }
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3()).length() || 10;
    const center = box.getCenter(new THREE.Vector3());
    const dir = new THREE.Vector3(0.9, -1.1, 0.75).normalize();
    this.perspCam.position.copy(center).addScaledVector(dir, size * 1.1);
    this.perspCam.near = Math.max(size / 5000, 0.01);
    this.perspCam.far = size * 50 + 1000;
    this.perspCam.updateProjectionMatrix();
    this.perspControls.target.copy(center);
    const g = Math.max(10, Math.ceil(size / 10) * 10 * 2);
    this.grid.scale.setScalar(g / 100);
  }

  setView(name) {
    const dirs0 = { top: [0, -0.0001, 1], front: [0, -1, 0], back: [0, 1, 0], left: [-1, 0, 0], right: [1, 0, 0], iso: [0.9, -1.1, 0.75] };
    if (this.camera.isOrthographicCamera) {
      // só a vista 3D ortogonal gira; plantas e elevações têm direção fixa
      if (this.orthoControls.enableRotate) this.frameOrtho(dirs0[name] || dirs0.iso);
      return;
    }
    const box = this.modelBox();
    const center = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
    const d = box.isEmpty() ? 30 : box.getSize(new THREE.Vector3()).length() * 1.2;
    const dirs = {
      top: [0, -0.0001, 1], front: [0, -1, 0], back: [0, 1, 0], left: [-1, 0, 0], right: [1, 0, 0], iso: [0.9, -1.1, 0.75],
    };
    const v = new THREE.Vector3(...(dirs[name] || dirs.iso)).normalize();
    this.perspCam.position.copy(center).addScaledVector(v, d);
    this.perspControls.target.copy(center);
  }

  // ---------------------------------------------------------------- vistas 2D: poché e contornos

  _prepare2D(root) {
    this._bucketsDirty = true;
    if (!this.showEdges) return;
    let tris = 0;
    root.traverse(o => {
      if (!o.isMesh || o.userData.isEdge || o.userData.edges) return;
      const g = o.geometry;
      tris += (g.index ? g.index.count : g.attributes.position?.count || 0) / 3;
      if (tris > MAX_EDGE_TRIS) return;
      // peça cortada por vazio: o booleano deixa arestas soltas (junções em T) — só as quinas de verdade
      const src = o.userData._csgOrig ? creaseEdges(g, 25) : new THREE.EdgesGeometry(g, 25);
      const geo = new LineSegmentsGeometry().setPositions(src.attributes.position.array);
      src.dispose();
      const edges = new LineSegments2(geo, EDGE_MAT);
      Object.assign(edges.userData, { isEdge: true, noHighlight: true, noCap: true });
      edges.layers.set(LINE_LAYER);
      edges.raycast = () => {};
      o.add(edges);
      o.userData.edges = edges;
    });
  }

  /**
   * Linhas de CORTE das plantas: o contorno onde o plano horizontal z atravessa as peças visíveis (triângulo a
   * triângulo, em coordenadas de mundo). z = null tira as linhas.
   */
  updateSectionLines(z) {
    for (const k of ['sectionLines', 'sectionInner']) {
      if (this[k]) { this.scene.remove(this[k]); this[k].geometry.dispose(); this[k] = null; }
    }
    if (z === null || z === undefined) return;
    const out = [];
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const cut = (p, q) => { const t = (z - p.z) / (q.z - p.z); return [p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t, z]; };
    this.model.traverseVisible(o => {
      if (!o.isMesh || o.userData.isEdge || o.userData.noCap || !o.geometry?.attributes?.position) return;
      const g = o.geometry, pos = g.attributes.position, idx = g.index, m = o.matrixWorld;
      g.boundingBox || g.computeBoundingBox();
      const bb = g.boundingBox.clone().applyMatrix4(m);
      if (bb.min.z > z || bb.max.z < z) return;
      const n = idx ? idx.count : pos.count;
      for (let i = 0; i < n; i += 3) {
        const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2;
        a.fromBufferAttribute(pos, i0).applyMatrix4(m);
        b.fromBufferAttribute(pos, i1).applyMatrix4(m);
        c.fromBufferAttribute(pos, i2).applyMatrix4(m);
        const da = a.z - z, db = b.z - z, dc = c.z - z;
        if ((da > 0 && db > 0 && dc > 0) || (da < 0 && db < 0 && dc < 0)) continue;
        const pts = [];
        if (da * db < 0) pts.push(cut(a, b));
        if (db * dc < 0) pts.push(cut(b, c));
        if (dc * da < 0) pts.push(cut(c, a));
        if (pts.length === 2) out.push(...pts[0], ...pts[1]);
      }
    });
    if (!out.length) return;
    // divisa: o mesmo segmento vindo de duas malhas (camadas encostadas) → linha fina; o resto é contorno → grossa
    const q = v => Math.round(v * 2000);
    const key = i => { const a = `${q(out[i])},${q(out[i + 1])}`, b = `${q(out[i + 3])},${q(out[i + 4])}`; return a < b ? `${a}|${b}` : `${b}|${a}`; };
    const count = new Map();
    for (let i = 0; i < out.length; i += 6) { const k = key(i); count.set(k, (count.get(k) || 0) + 1); }
    const outer = [], inner = [];
    for (let i = 0; i < out.length; i += 6) (count.get(key(i)) > 1 ? inner : outer).push(...out.slice(i, i + 6));
    const make = (arr, mat, order) => {
      if (!arr.length) return null;
      const l = new LineSegments2(new LineSegmentsGeometry().setPositions(arr), mat);
      l.layers.set(LINE_LAYER);
      l.renderOrder = order;
      l.raycast = () => {};
      l.frustumCulled = false;
      this.scene.add(l);
      return l;
    };
    this.sectionInner = make(inner, CUT_INNER_MAT, 6);
    this.sectionLines = make(outer, CUT_MAT, 7);
  }

  // ---------------------------------------------------------------- anotações

  setAnnotations(objects) {
    for (const c of [...this.annotations.children]) {
      this.annotations.remove(c);
      c.geometry?.dispose?.();
      c.material?.map?.dispose?.();
      c.material?.dispose?.();
    }
    for (const o of objects) this.annotations.add(o);
  }

  /** Rótulos (sprites) com tamanho constante na tela, independentemente do zoom (ortográfica ou perspectiva). */
  _scaleLabels() {
    const cam = this.camera, hPx = this.container.clientHeight || 1;
    const ortho = cam.isOrthographicCamera ? (cam.top - cam.bottom) / cam.zoom / hPx : 0;
    const k = ortho ? 0 : 2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) / hPx;
    const fwd = ortho ? null : cam.getWorldDirection(new THREE.Vector3());
    const p = new THREE.Vector3();
    for (const s of [...this.annotations.children, ...this.labelGroups.flatMap(g => g.children)]) {
      if (!s.isSprite || !s.userData.px) continue;
      const worldPerPx = ortho || Math.max(0.01, p.copy(s.position).sub(cam.position).dot(fwd)) * k;
      s.scale.set(s.userData.px[0] * worldPerPx, s.userData.px[1] * worldPerPx, 1);
    }
  }

  // ---------------------------------------------------------------- seleção

  _bindPicking() {
    let down = null;
    const el = this.renderer.domElement;
    // Alt + botão direito = girar (3D) ou arrastar (plantas/elevações): decidido ANTES do OrbitControls (captura)
    el.addEventListener('pointerdown', e => {
      if (e.button !== 2) return;
      const ortho2d = this.controls === this.orthoControls && !this.orthoControls.enableRotate;
      this.controls.mouseButtons.RIGHT = e.altKey ? (ortho2d ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE) : null;
    }, { capture: true });
    el.addEventListener('contextmenu', e => e.preventDefault());
    el.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, button: e.button, alt: e.altKey }; });

    // janela de seleção do botão direito (→ janela: só o que está inteiro dentro; ← cruzamento: o que toca)
    const band = document.createElement('div');
    band.className = 'select-band';
    band.hidden = true;
    this.container.appendChild(band);
    const rectOf = (a, b) => ({ x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) });
    el.addEventListener('pointermove', e => {
      if (!down || down.button !== 2 || down.alt || this.tool) return;
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) return;
      const r = rectOf(down, { x: e.clientX, y: e.clientY }), c = this.container.getBoundingClientRect();
      band.hidden = false;
      band.classList.toggle('crossing', e.clientX < down.x);
      Object.assign(band.style, { left: `${r.x0 - c.left}px`, top: `${r.y0 - c.top}px`, width: `${r.x1 - r.x0}px`, height: `${r.y1 - r.y0}px` });
    });

    el.addEventListener('pointerup', e => {
      const d = down;
      down = null;
      band.hidden = true;
      if (!d || e.button !== d.button) return;
      if (e.button === 2 && d.alt) return;                     // Alt + direito girou a vista
      if (e.button !== 0 && e.button !== 2) return;
      if (this.tool) return;                                    // uma ferramenta de desenho ativa trata os cliques
      if (this._gizmoClick) { this._gizmoClick = false; return; } // clique no gizmo de mover/girar
      const additive = e.ctrlKey || e.shiftKey;
      const moved = Math.hypot(e.clientX - d.x, e.clientY - d.y);
      if (e.button === 2 && moved >= 5) { this.select(this.pickRect(rectOf(d, { x: e.clientX, y: e.clientY }), e.clientX < d.x), additive); return; }
      if (moved > 4) return;
      if (e.button === 2 && this.rightClickTaken?.()) return;     // Mover/Girar ativo: o direito põe o pivô
      const obj = this.pickAt(e.clientX, e.clientY);
      // revelando os ocultos: clicar num oculto o mostra de volta
      if (obj && this.revealHidden && this.isHidden(obj)) {
        if (obj.userData.catHidden) this.setCategoryHidden('eixos', false);
        this.setHidden([obj], false);
        this.dispatchEvent(new CustomEvent('revealed', { detail: obj }));
        return;
      }
      this.select(obj ? [obj] : [], additive);
    });

    // passar o mouse: avisa qual elemento está sob o cursor (barra de status)
    let hoverT = 0;
    el.addEventListener('pointermove', e => {
      if (e.buttons || this.tool) return;
      const now = performance.now();
      if (now - hoverT < 90) return;
      hoverT = now;
      let obj = this.pickAt(e.clientX, e.clientY);
      if (obj && this.selectFilter && !this.selectFilter(obj)) obj = null; // fora do filtro: nem destaca
      if (obj !== this.hovered) { this.hovered = obj; el.style.cursor = obj ? 'pointer' : ''; this.dispatchEvent(new Event('hover')); }
    });
  }

  /** Elementos na janela da tela (crossing: os que tocam; senão, os inteiramente dentro). */
  pickRect(r, crossing) {
    const c = this.renderer.domElement.getBoundingClientRect();
    const out = [];
    const v = new THREE.Vector3();
    for (const el of this.elements()) {
      if (!el.visible) continue;
      const box = new THREE.Box3().setFromObject(el);
      if (box.isEmpty()) continue;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, behind = false;
      for (let i = 0; i < 8; i++) {
        v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(this.camera);
        if (v.z > 1) behind = true;
        const sx = (v.x + 1) / 2 * c.width + c.left, sy = (1 - v.y) / 2 * c.height + c.top;
        x0 = Math.min(x0, sx); y0 = Math.min(y0, sy); x1 = Math.max(x1, sx); y1 = Math.max(y1, sy);
      }
      if (behind) continue;
      const inside = x0 >= r.x0 && x1 <= r.x1 && y0 >= r.y0 && y1 <= r.y1;
      const touches = x1 >= r.x0 && x0 <= r.x1 && y1 >= r.y0 && y0 <= r.y1;
      if (inside || (crossing && touches)) out.push(el);
    }
    return out;
  }

  /** Elemento BIM sob o ponto da tela (respeitando o recorte das plantas), ou null. */
  pickAt(x, y) { return this.pickHit(x, y)?.obj || null; }

  /** Elemento BIM e ponto da superfície sob o ponto da tela, ou null. */
  pickHit(x, y) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    // linhas do desenho 2D também são clicáveis (tolerância de ~6 px na tela)
    this.raycaster.layers.enable(LINE_LAYER);
    this.raycaster.params.Line.threshold = this._worldPerPixel(x, y) * 6;
    const visibleThroughCut = p => this.clipPlanes.every(pl => pl.distanceToPoint(p) >= -1e-4);
    const owner = o => { while (o && !o.userData?.bim && o.parent !== this.model) o = o.parent; return o; };
    let hits = this.raycaster.intersectObject(this.model, true)
      .filter(h => h.object.visible && (h.object.isMesh || h.object.userData.sketchLine) && visibleThroughCut(h.point))
      .map(h => ({ h, obj: owner(h.object) })).filter(x => x.obj);
    // com filtro de seleção (ex.: editando o contorno do piso), o clique atravessa o que não pode ser selecionado
    if (this.selectFilter) hits = hits.filter(x => this.selectFilter(x.obj));
    if (!hits.length) return null;
    // uma linha 2D logo acima/abaixo de uma superfície (no mesmo plano) ganha da superfície: dá para clicar nela
    let pick = hits[0];
    const line = hits.find(x => x.h.object.userData.sketchLine);
    if (line && line !== pick && line.h.distance - pick.h.distance < 0.25) pick = line;
    return { obj: pick.obj, point: pick.h.point.clone() };
  }

  /** Metros por pixel perto do ponto da tela (para tolerâncias de clique). */
  _worldPerPixel(x, y) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const at = px => {
      const ndc = new THREE.Vector2(((px - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
      const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, this.camera);
      return ray.ray.at(this.camera.isOrthographicCamera ? 0 : ray.ray.origin.distanceTo(this.controls.target), new THREE.Vector3());
    };
    return Math.max(1e-4, at(x).distanceTo(at(x + 1)));
  }

  select(objs, additive = false) {
    objs = objs.filter(o => !o.userData?.locked); // camada travada ou não liberada: não seleciona
    if (this.selectFilter) objs = objs.filter(this.selectFilter); // ex.: editando o contorno do piso, só as linhas dele
    if (!additive) for (const o of this.selected) this._highlight(o, false);
    if (!additive) this.selected.clear();
    for (const o of objs) {
      if (additive && this.selected.has(o)) { this.selected.delete(o); this._highlight(o, false); continue; }
      this.selected.add(o);
      this._highlight(o, true);
    }
    this.dispatchEvent(new Event('select'));
  }

  _highlight(obj, on) {
    obj.traverse(o => {
      if (o.userData?.wide) {
        // traçado de exibição (tracejado/espesso) das linhas 2D: uma cópia azul do próprio material
        if (on) { if (!o.userData._origMat) { o.userData._origMat = o.material; o.material = o.material.clone(); o.material.color.set(0x2f9bff); } }
        else if (o.userData._origMat) { o.material.dispose(); o.material = o.userData._origMat; delete o.userData._origMat; }
        return;
      }
      if (o.userData?.sketchLine) {
        if (on) { if (!o.userData._origMat) o.userData._origMat = o.material; o.material = SELECT_LINE; }
        else if (o.userData._origMat) { o.material = o.userData._origMat; delete o.userData._origMat; }
        return;
      }
      if (!o.isMesh || o.userData.noHighlight) return;
      if (on) {
        if (!o.userData._origMat) o.userData._origMat = o.material;
        o.material = SELECT_MAT;
      } else if (o.userData._origMat) {
        o.material = o.userData._origMat;
        delete o.userData._origMat;
      }
    });
  }

  screenshot() { return this.renderer.domElement.toDataURL('image/png'); }
}

/**
 * Arestas de quina de uma malha (ângulo entre as faces vizinhas > limite). Diferente do EdgesGeometry, arestas
 * usadas por um triângulo só (junções em T do corte booleano) não são desenhadas.
 */
function creaseEdges(geo, thresholdDeg) {
  const pos = geo.attributes.position, n = pos.count, P = pos.array;
  const cos = Math.cos(thresholdDeg * Math.PI / 180);
  // cada ponto ganha um número (o mesmo para cantos no mesmo lugar); aresta = par de números, sem textos por aresta
  const ids = new Int32Array(n), byKey = new Map();
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(P[i * 3] * 1e4)},${Math.round(P[i * 3 + 1] * 1e4)},${Math.round(P[i * 3 + 2] * 1e4)}`;
    let id = byKey.get(k);
    if (id === undefined) byKey.set(k, id = byKey.size);
    ids[i] = id;
  }
  const nT = Math.floor(n / 3), N = new Float32Array(nT * 3), ok = new Uint8Array(nT);
  for (let t = 0; t < nT; t++) {
    const a = t * 9;
    const ux = P[a + 6] - P[a + 3], uy = P[a + 7] - P[a + 4], uz = P[a + 8] - P[a + 5];
    const vx = P[a] - P[a + 3], vy = P[a + 1] - P[a + 4], vz = P[a + 2] - P[a + 5];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, L = Math.hypot(nx, ny, nz);
    if (L * L < 1e-14) continue;
    N[t * 3] = nx / L; N[t * 3 + 1] = ny / L; N[t * 3 + 2] = nz / L; ok[t] = 1;
  }
  // aresta → [vértice i, vértice j, 1º triângulo, 2º triângulo, quantos]
  const map = new Map();
  for (let t = 0; t < nT; t++) {
    if (!ok[t]) continue;
    for (let s = 0; s < 3; s++) {
      const i = t * 3 + s, j = t * 3 + (s + 1) % 3, a = ids[i], b = ids[j];
      const k = a < b ? a * 67108864 + b : b * 67108864 + a;
      const e = map.get(k);
      if (e) { if (e[4] === 1) e[3] = t; e[4]++; } else map.set(k, [i, j, t, -1, 1]);
    }
  }
  const out = [];
  for (const [i, j, t1, t2, c] of map.values()) {
    if (c !== 2 || N[t1 * 3] * N[t2 * 3] + N[t1 * 3 + 1] * N[t2 * 3 + 1] + N[t1 * 3 + 2] * N[t2 * 3 + 2] > cos) continue;
    out.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2], P[j * 3], P[j * 3 + 1], P[j * 3 + 2]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  return g;
}

const SELECT_LINE = new THREE.LineBasicMaterial({ color: 0x2f9bff, depthTest: false });
const SELECT_MAT = new THREE.MeshStandardMaterial({ color: 0x2f9bff, emissive: 0x0b3a6b, transparent: true, opacity: 0.85, side: THREE.DoubleSide });

/** Material original (ignora o destaque de seleção) — usado pelos exportadores. */
export function baseMaterial(mesh) {
  return mesh.userData._origMat || mesh.material;
}

/** Sprite de texto para rótulos (nível, cota). px = tamanho em pixels na tela. */
export function textSprite(lines, { color = '#1f6f2e', font = 600, size = 26 } = {}) {
  const text = [].concat(lines);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = `${font} ${size}px Segoe UI, sans-serif`;
  const w = Math.ceil(Math.max(...text.map(t => ctx.measureText(t).width))) + 16;
  const h = text.length * (size + 6) + 8;
  canvas.width = w; canvas.height = h;
  ctx.font = `${font} ${size}px Segoe UI, sans-serif`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'top';
  text.forEach((t, i) => ctx.fillText(t, 8, 4 + i * (size + 6)));
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.center.set(0, 0.5);
  sprite.renderOrder = 10;
  sprite.userData.px = [w / 2, h / 2];
  return sprite;
}
