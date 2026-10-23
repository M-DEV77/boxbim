// Visualizador. Convenção do BoxBim: Z para cima, unidades em metros (como o Revit).
// Duas câmeras: perspectiva (vista 3D, órbita livre) e ortográfica (plantas e elevações: só pan e zoom).
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

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
const CAP_MAT = new THREE.MeshBasicMaterial({
  color: 0x262626, side: THREE.DoubleSide,
  stencilWrite: true, stencilRef: 0, stencilFunc: THREE.NotEqualStencilFunc,
  stencilFail: THREE.ReplaceStencilOp, stencilZFail: THREE.ReplaceStencilOp, stencilZPass: THREE.ReplaceStencilOp,
});
const LINE_LAYER = 1; // linhas ficam fora da contagem do stencil
const DEFAULT_CAP = 0x262626; // preenchimento de corte de elementos sem material de biblioteca

const EDGE_MAT = new THREE.LineBasicMaterial({ color: 0x1d1d1d });
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
    this.orthoControls = mkControls(this.orthoCam);
    this.orthoControls.enableRotate = false;
    this.orthoControls.zoomToCursor = true;
    this.orthoControls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
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
      if (this.annotations.children.length) this._scaleLabels();
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
    for (const [color, layer] of this._capBuckets) {
      // 1) contagem só com o plano de corte: se a profundidade também recortasse, geraria tampas falsas
      r.clippingPlanes = this.clipPlanes.slice(0, 1);
      cam.layers.set(layer);
      scene.overrideMaterial = STENCIL_BACK; r.render(scene, cam);
      scene.overrideMaterial = STENCIL_FRONT; r.render(scene, cam);
      scene.overrideMaterial = null;
      // 2) tampa desta cor no plano de corte (sem recorte, senão ela mesma seria cortada)
      CAP_MAT.color.setHex(color);
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
      let color = mat?.userData?.capColor ?? DEFAULT_CAP;
      if (!buckets.has(color)) {
        if (next > 31) color = DEFAULT_CAP; // limite de camadas de render: o resto usa o padrão
        if (!buckets.has(color)) buckets.set(color, next++);
      }
      o.layers.set(0);
      o.layers.enable(buckets.get(color));
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
      ? { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }
      : { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };

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
      const edges = new THREE.LineSegments(o.userData._csgOrig ? creaseEdges(g, 25) : new THREE.EdgesGeometry(g, 25), EDGE_MAT);
      edges.userData.isEdge = true;
      edges.layers.set(LINE_LAYER);
      edges.raycast = () => {};
      o.add(edges);
      o.userData.edges = edges;
    });
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
    for (const s of this.annotations.children) {
      if (!s.isSprite || !s.userData.px) continue;
      const worldPerPx = ortho || Math.max(0.01, p.copy(s.position).sub(cam.position).dot(fwd)) * k;
      s.scale.set(s.userData.px[0] * worldPerPx, s.userData.px[1] * worldPerPx, 1);
    }
  }

  // ---------------------------------------------------------------- seleção

  _bindPicking() {
    let down = null;
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
    el.addEventListener('pointerup', e => {
      if (e.button !== 0) return; // botão direito posiciona o pivô (TransformTool)
      if (this.tool) return; // uma ferramenta de desenho ativa trata os cliques
      if (this._gizmoClick) { this._gizmoClick = false; return; } // clique no gizmo de mover/girar
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
      const obj = this.pickAt(e.clientX, e.clientY);
      this.select(obj ? [obj] : [], e.ctrlKey || e.shiftKey);
    });
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
    const hit = this.raycaster.intersectObject(this.model, true)
      .find(h => h.object.visible && (h.object.isMesh || h.object.userData.sketchLine) && visibleThroughCut(h.point));
    let obj = hit?.object || null;
    while (obj && !obj.userData?.bim && obj.parent !== this.model) obj = obj.parent;
    return obj ? { obj, point: hit.point.clone() } : null;
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
  const pos = geo.attributes.position, n = pos.count;
  const cos = Math.cos(thresholdDeg * Math.PI / 180);
  const q = i => `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
  const map = new Map();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let t = 0; t + 2 < n; t += 3) {
    a.fromBufferAttribute(pos, t); b.fromBufferAttribute(pos, t + 1); c.fromBufferAttribute(pos, t + 2);
    const nrm = new THREE.Vector3().subVectors(c, b).cross(new THREE.Vector3().subVectors(a, b));
    if (nrm.lengthSq() < 1e-14) continue;
    nrm.normalize();
    for (const [i, j] of [[t, t + 1], [t + 1, t + 2], [t + 2, t]]) {
      const ki = q(i), kj = q(j);
      const k = ki < kj ? `${ki}|${kj}` : `${kj}|${ki}`;
      const e = map.get(k);
      if (e) e.normals.push(nrm); else map.set(k, { i, j, normals: [nrm] });
    }
  }
  const out = [];
  for (const e of map.values()) {
    if (e.normals.length !== 2 || e.normals[0].dot(e.normals[1]) > cos) continue;
    out.push(pos.getX(e.i), pos.getY(e.i), pos.getZ(e.i), pos.getX(e.j), pos.getY(e.j), pos.getZ(e.j));
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
