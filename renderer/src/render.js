// VISTA RENDER: os materiais em tempo real (PBR) — céu procedural, sol com sombras, oclusão ambiente (GTAO),
// tonemapping e texturas procedurais triplanares (concreto, tijolo, cerâmica, madeira, metal…). Modo
// "Path tracing" acumula amostras de luz global (three-gpu-pathtracer) para a imagem final.
//
// Ativada pela vista {Render}; ao sair, o viewer volta exatamente ao estado BIM (materiais chapados, grade, linhas).
// Os materiais da biblioteca (tipos.json) ganham propriedades de render: rugosidade, metal, textura, escala,
// transmissão (vidro) — editáveis ao vivo no painel Propriedades enquanto a vista Render está aberta.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { WebGLPathTracer, ProceduralEquirectTexture } from 'three-gpu-pathtracer';

const DEG = Math.PI / 180;
const LINE_LAYER = 1;
const store = (k, v) => { try { localStorage.setItem(k, v); } catch { /* sem armazenamento */ } };
const load = k => { try { return localStorage.getItem(k); } catch { return null; } };

// ---------------------------------------------------------------- propriedades de render dos materiais

export const TEXTURES = { nenhuma: 'Nenhuma', concreto: 'Concreto', reboco: 'Reboco', tijolo: 'Tijolo', ceramica: 'Cerâmica', madeira: 'Madeira', metal: 'Metal escovado', pedra: 'Pedra', grama: 'Grama' };

/** Padrões por nome de material (o que o usuário gravar no material tem prioridade). */
const RENDER_DEFAULTS = {
  'Concreto': { rugosidade: 0.9, textura: 'concreto', escala: 1.2 },
  'Bloco cerâmico': { rugosidade: 0.85, textura: 'tijolo', escala: 0.6 },
  'Bloco de concreto': { rugosidade: 0.9, textura: 'tijolo', escala: 0.8 },
  'Reboco': { rugosidade: 0.95, textura: 'reboco', escala: 0.6 },
  'Gesso acartonado': { rugosidade: 0.9, textura: 'reboco', escala: 1.5 },
  'Lã mineral': { rugosidade: 1, textura: 'reboco', escala: 0.3 },
  'Contrapiso': { rugosidade: 0.95, textura: 'concreto', escala: 0.8 },
  'Piso cerâmico': { rugosidade: 0.35, textura: 'ceramica', escala: 0.9 },
  'Porcelanato': { rugosidade: 0.2, textura: 'ceramica', escala: 1.2 },
  'Madeira': { rugosidade: 0.55, textura: 'madeira', escala: 1.2 },
  'Aço': { rugosidade: 0.35, metal: 0.9, textura: 'metal', escala: 0.5 },
  'Vidro': { rugosidade: 0.03, transmissao: 1 },
  'Impermeabilização': { rugosidade: 0.6 },
  'Isolamento térmico': { rugosidade: 1, textura: 'reboco', escala: 0.4 },
};

/** Propriedades de render de um material da biblioteca (padrões + o que estiver gravado). */
export function renderProps(name, def = {}) {
  return { rugosidade: 0.8, metal: 0, textura: 'nenhuma', escala: 1, transmissao: 0, ...(RENDER_DEFAULTS[name] || {}), ...(def.render || {}) };
}

// ---------------------------------------------------------------- texturas procedurais (sem arquivos)

const SIZE = 1024;

/** Ruído de valor periódico (repete a cada "period" células): texturas sem emenda. */
function makeNoise(seed = 1) {
  const hash = (x, y) => {
    let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
    h = (h ^ (h >>> 13)) * 1274126177 | 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const smooth = t => t * t * (3 - 2 * t);
  const value = (u, v, period) => {
    const x = u * period, y = v * period;
    const xi = Math.floor(x), yi = Math.floor(y), xf = smooth(x - xi), yf = smooth(y - yi);
    const m = i => ((i % period) + period) % period;
    const a = hash(m(xi), m(yi)), b = hash(m(xi + 1), m(yi)), c = hash(m(xi), m(yi + 1)), d = hash(m(xi + 1), m(yi + 1));
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
  return (u, v, base = 4, octaves = 4) => {
    let s = 0, amp = 0.5, norm = 0;
    for (let o = 0; o < octaves; o++) { s += amp * value(u, v, base << o); norm += amp; amp *= 0.5; }
    return s / norm;
  };
}

const texCache = new Map();

/** Textura de detalhe em tons de cinza (multiplica a cor do material); u, v em [0, 1) cobrem "escala" metros. */
function proceduralTexture(kind) {
  if (texCache.has(kind)) return texCache.get(kind);
  const n = makeNoise(kind.length * 7 + 3), n2 = makeNoise(91);
  const cv = document.createElement('canvas');
  cv.width = cv.height = SIZE;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(SIZE, SIZE);
  const px = (u, v) => {
    switch (kind) {
      case 'concreto': {
        const pores = n2(u, v, 64, 2) > 0.8 ? 0.82 : 1;
        return (0.84 + 0.14 * n(u, v, 6, 5)) * pores;
      }
      case 'reboco': return 0.88 + 0.1 * n(u, v, 24, 4);
      case 'pedra': return 0.7 + 0.3 * n(u, v, 5, 5) * (0.8 + 0.2 * n2(u, v, 40, 2));
      case 'grama': return 0.55 + 0.45 * n(u, v, 48, 4) * (0.75 + 0.25 * n2(u, v, 4, 3));
      case 'metal': return 0.86 + 0.1 * n(u * 0.02, v, 128, 3) + 0.04 * n(u, v, 8, 2);
      case 'tijolo': {
        // 3 fiadas de 20 cm, tijolos de 30 cm, juntas de 1 cm (em um quadro de 60 cm), fiadas desencontradas
        const rows = 3, cols = 2, joint = 0.012;
        const r = Math.floor(v * rows), fy = v * rows - r;
        const x = u * cols + (r % 2) * 0.5, c = Math.floor(x), fx = x - c;
        if (fy < joint * rows || fx < joint * cols / 2) return 1.05 + 0.03 * n(u, v, 32, 2);
        const tone = 0.72 + 0.16 * makeTone(r, ((c % cols) + cols) % cols);
        return tone * (0.9 + 0.1 * n(u, v, 16, 4));
      }
      case 'ceramica': {
        // 2 × 2 peças por quadro, rejunte fino, leve variação de tom por peça
        const t = 2, g = 0.004;
        const cx = Math.floor(u * t), cy = Math.floor(v * t), fx = u * t - cx, fy = v * t - cy;
        if (fx < g * t || fy < g * t) return 0.62;
        return (0.9 + 0.08 * makeTone(cx, cy)) * (0.97 + 0.03 * n(u, v, 16, 3));
      }
      case 'madeira': {
        // 4 tábuas ao longo de U, veios ondulados
        const planks = 4, pl = Math.floor(v * planks), fv = v * planks - pl;
        if (fv < 0.006) return 0.45;
        const warp = n(u, v, 3, 3) * 6;
        const grain = 0.5 + 0.5 * Math.sin((fv * 18 + warp + pl * 3.1) * Math.PI);
        return (0.68 + 0.18 * makeTone(pl, 7)) * (0.82 + 0.18 * grain) * (0.94 + 0.06 * n(u, v, 64, 2));
      }
      default: return 1;
    }
  };
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const val = Math.max(0, Math.min(1.2, px(x / SIZE, y / SIZE)));
      const c = Math.round(Math.min(1, val) * 255), i = (y * SIZE + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = c;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  texCache.set(kind, tex);
  return tex;
}

function makeTone(a, b) {
  let h = (a * 73856093) ^ (b * 19349663);
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/**
 * Projeção triplanar em coordenadas de mundo: a textura cobre "escala" metros em qualquer face, sem depender das
 * UVs da geometria (caixas, cilindros e extrusões ficam com a mesma escala real).
 */
function triplanar(mat, scaleRef) {
  mat.onBeforeCompile = sh => {
    sh.uniforms.uTriScale = scaleRef;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTriPos;\nvarying vec3 vTriNrm;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvTriPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvTriNrm = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTriPos;\nvarying vec3 vTriNrm;\nuniform float uTriScale;')
      .replace('#include <map_fragment>', `#ifdef USE_MAP
  vec3 tw = pow(abs(normalize(vTriNrm)), vec3(4.0));
  tw /= (tw.x + tw.y + tw.z);
  vec3 tp = vTriPos / uTriScale;
  vec4 tcol = texture2D(map, tp.yz) * tw.x + texture2D(map, tp.xz) * tw.y + texture2D(map, tp.xy) * tw.z;
  diffuseColor *= tcol;
#endif`);
  };
  mat.customProgramCacheKey = () => 'boxbim-triplanar';
}

// ---------------------------------------------------------------- céu

export const SKIES = { dia: 'Dia claro', entardecer: 'Entardecer', nublado: 'Nublado' };

const SKY_PRESETS = {
  dia: { zenith: [0.18, 0.36, 0.78], horizon: [0.78, 0.86, 0.95], ground: [0.32, 0.31, 0.29], sun: [1, 0.97, 0.9], glow: 1, sunI: 3.2, envI: 1 },
  entardecer: { zenith: [0.2, 0.25, 0.5], horizon: [1, 0.62, 0.38], ground: [0.25, 0.2, 0.18], sun: [1, 0.66, 0.4], glow: 1.6, sunI: 2.4, envI: 0.8 },
  nublado: { zenith: [0.62, 0.66, 0.72], horizon: [0.82, 0.84, 0.86], ground: [0.3, 0.3, 0.3], sun: [1, 1, 1], glow: 0.15, sunI: 0.6, envI: 1.25 },
};

const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);

// ---------------------------------------------------------------- modo render

export class RenderMode extends EventTarget {
  constructor(app) {
    super();
    this.app = app;
    this.active = false;
    this.settings = {
      azimute: 135, altura: 42, exposicao: 1, ceu: 'dia', chao: 'grama', ao: true, qualidade: 'tempo-real',
      ...JSON.parse(load('boxbim.render') || '{}'),
    };
    this.mats = new Map();          // nome do material da biblioteca → material de render
    this.colorMats = new Map();     // cor/opacidade → material de render (malhas sem material da biblioteca)
    this.renderSet = new WeakSet();
    app.viewer.addEventListener('change', () => { if (this.active) this.onModelChange(); });
    app.types.addEventListener('change', () => { if (this.active) this.refreshMaterials(); });
  }

  get viewer() { return this.app.viewer; }

  save() { store('boxbim.render', JSON.stringify(this.settings)); }

  // ------------------------------------------------------------ ligar / desligar

  enable() {
    const v = this.viewer, r = v.renderer;
    this.active = true;
    this.prev = {
      toneMapping: r.toneMapping, exposure: r.toneMappingExposure, shadows: r.shadowMap.enabled,
      background: v.scene.background, environment: v.scene.environment,
      lights: v.scene.children.filter(o => o.isLight && o.visible),
      grid: v.grid.visible, axes: v.axes.visible, edges: v.showEdges,
    };
    this.prev.lights.forEach(l => { l.visible = false; });
    v.grid.visible = v.axes.visible = false;
    for (const c of [v.perspCam, v.orthoCam]) c.layers.disable(LINE_LAYER);
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.toneMapping = THREE.AgXToneMapping;

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 2.5;
    v.scene.add(this.sun, this.sun.target);

    this.ground = new THREE.Mesh(new THREE.CircleGeometry(400, 96), new THREE.MeshStandardMaterial({ color: 0x6f8f4e, roughness: 1 }));
    this.ground.name = 'Chão (render)';
    this.ground.receiveShadow = true;
    v.scene.add(this.ground);

    this.sky = new ProceduralEquirectTexture(512, 256);
    v.scene.environmentRotation.set(Math.PI / 2, 0, 0);
    v.scene.backgroundRotation.set(Math.PI / 2, 0, 0);

    this.buildComposer();
    v.renderOverride = () => this.renderFrame();
    this._onControls = () => { if (this.pt) this.pt.updateCamera(); };
    this._ctl = v.controls;
    this._ctl.addEventListener('change', this._onControls);
    this.applyMaterials();
    this.applySettings();
    this.buildBar();
    this.app.renderProps();
    this.dispatchEvent(new Event('change'));
  }

  disable() {
    const v = this.viewer, r = v.renderer, p = this.prev;
    this.active = false;
    this.stopPathTracing();
    v.renderOverride = null;
    this._ctl?.removeEventListener('change', this._onControls);
    this.restoreMaterials();
    r.toneMapping = p.toneMapping;
    r.toneMappingExposure = p.exposure;
    r.shadowMap.enabled = p.shadows;
    if (v.scene.background === this.sky) v.scene.background = p.background; // senão a nova vista já pôs o fundo dela
    v.scene.environment = p.environment;
    v.scene.environmentRotation.set(0, 0, 0);
    v.scene.backgroundRotation.set(0, 0, 0);
    p.lights.forEach(l => { l.visible = true; });
    v.grid.visible = p.grid;
    v.axes.visible = p.axes;
    for (const c of [v.perspCam, v.orthoCam]) c.layers.enable(LINE_LAYER);
    v.scene.remove(this.sun, this.sun.target, this.ground);
    this.ground.geometry.dispose();
    this.sky.dispose();
    this.composer?.dispose();
    this.composer = null;
    this.bar?.remove();
    this.bar = null;
    // força recompilar os materiais sem sombras/tonemapping
    v.model.traverse(o => { if (o.isMesh && o.material) [].concat(o.material).forEach(m => { m.needsUpdate = true; }); });
    this.app.renderProps();
    this.dispatchEvent(new Event('change'));
  }

  // ------------------------------------------------------------ quadro

  buildComposer() {
    const v = this.viewer, r = v.renderer;
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(r, rt);
    this.renderPass = new RenderPass(v.scene, v.camera);
    this.gtao = new GTAOPass(v.scene, v.camera, size.x, size.y);
    this.gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1, scale: 1 });
    this.gtao.blendIntensity = 0.9;
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.gtao);
    this.composer.addPass(new OutputPass());
    this._size = size;
  }

  renderFrame() {
    const v = this.viewer, r = v.renderer;
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    if (!size.equals(this._size)) {
      this._size = size;
      const pr = r.getPixelRatio();
      this.composer.setPixelRatio(pr);
      this.composer.setSize(size.x / pr, size.y / pr);
      this.pt?.reset();
    }
    if (this.pt) {
      if (this.pt.isCompiling) {
        // o shader do path tracer é grande: a primeira compilação (ANGLE/D3D no Windows) leva dezenas de segundos
        if (!this._compiling) { this._compiling = true; this.app.status('Path tracing: compilando o shader na GPU (só na primeira vez; pode levar até ~40 s)…'); }
      } else this._compiling = false;
      this.pt.renderSample();
      const n = Math.floor(this.pt.samples);
      if (n !== this._lastSamples) { this._lastSamples = n; this.updateStatus(); }
      return;
    }
    this.renderPass.camera = this.gtao.camera = v.camera;
    this.gtao.enabled = this.settings.ao;
    this.composer.render();
  }

  // ------------------------------------------------------------ sol, céu e chão

  sunDir() {
    // azimute: graus a partir do Norte (+Y) no sentido horário; altura: graus acima do horizonte
    const az = this.settings.azimute * DEG, el = this.settings.altura * DEG;
    return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el)).normalize();
  }

  applySettings() {
    if (!this.active) return;
    const v = this.viewer, s = this.settings, P = SKY_PRESETS[s.ceu] || SKY_PRESETS.dia;
    v.renderer.toneMappingExposure = s.exposicao;
    const dir = this.sunDir();
    // céu equiretangular no referencial Y para cima do three.js; a cena gira +90° em X para ficar Z para cima
    const toWorld = d => new THREE.Vector3(d.x, -d.z, d.y);
    const w = new THREE.Vector3();
    this.sky.generationCallback = (polar, uv, coord, color) => {
      w.setFromSpherical(polar);
      const d = toWorld(w);
      const el = d.z;
      let c;
      if (el >= 0) c = mix(P.horizon, P.zenith, Math.pow(Math.min(1, el), 0.45));
      else c = mix(P.horizon, P.ground, Math.min(1, -el * 6));
      const cos = Math.max(0, d.dot(dir));
      const glow = P.glow * (Math.pow(cos, 12) * 0.35 + Math.pow(cos, 200) * 1.5) * (el > -0.02 ? 1 : 0);
      color.setRGB((c[0] + P.sun[0] * glow) * P.envI, (c[1] + P.sun[1] * glow) * P.envI, (c[2] + P.sun[2] * glow) * P.envI);
    };
    this.sky.update();
    v.scene.background = this.sky;
    v.scene.environment = this.sky;

    this.sun.color.setRGB(...P.sun);
    this.sun.intensity = s.altura > 0 ? P.sunI * Math.min(1, s.altura / 12) : 0;
    this.fitSun();

    const g = this.ground;
    g.visible = s.chao !== 'nenhum';
    if (s.chao === 'grama') { g.material.color.set(0x6f8f4e); this.setTexture(g.material, 'grama', 2); }
    else { g.material.color.set(0x9a958c); this.setTexture(g.material, 'concreto', 3); }
    this.pt?.updateEnvironment();
    this.pt?.updateLights();
    this.pt?.updateMaterials();
    this.save();
    this.updateStatus();
  }

  /** Sombra do sol ajustada à caixa do modelo (nítida em qualquer tamanho de projeto). */
  fitSun() {
    const v = this.viewer;
    const box = new THREE.Box3().setFromObject(v.model);
    if (box.isEmpty()) box.set(new THREE.Vector3(-5, -5, 0), new THREE.Vector3(5, 5, 3));
    const c = box.getCenter(new THREE.Vector3()), R = Math.max(1, box.getSize(new THREE.Vector3()).length() / 2);
    const dir = this.sunDir();
    const groundZ = box.min.z - 0.004;
    this.sun.target.position.copy(c);
    this.sun.position.copy(c).addScaledVector(dir, R * 4);
    this.sun.updateMatrixWorld();
    this.sun.target.updateMatrixWorld();
    // a sombra cai no chão longe do modelo (sol baixo): o quadro da câmera de sombra cobre as quinas do modelo e
    // as projeções delas no chão, no referencial do sol
    const pts = [];
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      const p = new THREE.Vector3(x, y, z);
      pts.push(p);
      const t = Math.min((z - groundZ) / Math.max(dir.z, 0.02), R * 12); // limita sombras quase horizontais
      pts.push(p.clone().addScaledVector(dir, -t));
    }
    const cam = this.sun.shadow.camera;
    cam.position.copy(this.sun.position);
    cam.lookAt(c);
    cam.updateMatrixWorld();
    const inv = cam.matrixWorld.clone().invert();
    const lb = new THREE.Box3().setFromPoints(pts.map(p => p.applyMatrix4(inv)));
    const pad = 0.5;
    cam.left = lb.min.x - pad; cam.right = lb.max.x + pad;
    cam.bottom = lb.min.y - pad; cam.top = lb.max.y + pad;
    cam.near = Math.max(0.1, -lb.max.z - pad);
    cam.far = -lb.min.z + pad;
    cam.updateProjectionMatrix();
    this.ground.position.set(c.x, c.y, groundZ);
  }

  onModelChange() {
    clearTimeout(this._chg);
    this._chg = setTimeout(() => {
      if (!this.active) return;
      this.applyMaterials();
      this.fitSun();
      if (this.pt) this.rebuildPathTracerScene();
    }, 120);
  }

  // ------------------------------------------------------------ materiais

  setTexture(mat, kind, scale) {
    if (!kind || kind === 'nenhuma') {
      if (mat.map) { mat.map = null; mat.needsUpdate = true; }
      return;
    }
    if (!mat.userData.triScale) { mat.userData.triScale = { value: scale }; triplanar(mat, mat.userData.triScale); }
    mat.userData.triScale.value = scale;
    if (mat.map && mat.userData.texKind === kind) { mat.map.repeat.set(1 / scale, 1 / scale); return; }
    const tex = proceduralTexture(kind).clone(); // mesma imagem; repetição própria
    tex.needsUpdate = true;
    tex.repeat.set(1 / scale, 1 / scale); // usado pelo path tracing e pelo glTF (UVs em metros nas extrusões)
    const had = !!mat.map;
    mat.map?.dispose();
    mat.map = tex;
    mat.userData.texKind = kind;
    if (!had) mat.needsUpdate = true;
  }

  /** Material de render de um material da biblioteca (atualizado no lugar quando as propriedades mudam). */
  libraryMaterial(name) {
    const def = this.app.types.materials[name];
    if (!def) return null;
    let m = this.mats.get(name);
    if (!m) {
      m = new THREE.MeshPhysicalMaterial({ side: THREE.DoubleSide, ior: 1.5, thickness: 0.01 });
      m.name = name;
      this.mats.set(name, m);
      this.renderSet.add(m);
      this.updateLibraryMaterial(m, def); // depois, só refreshMaterials/setMaterialProp atualizam
    }
    return m;
  }

  updateLibraryMaterial(m, def) {
    const p = renderProps(m.name, def);
    m.color.set(def.color || '#cccccc');
    m.roughness = p.rugosidade;
    m.metalness = p.metal;
    const glass = p.transmissao > 0;
    m.transmission = p.transmissao;
    const opacity = glass ? 1 : (def.opacity ?? 1);
    if (m.transparent !== opacity < 1) { m.transparent = opacity < 1; m.needsUpdate = true; }
    m.opacity = opacity;
    m.depthWrite = opacity >= 1;
    this.setTexture(m, p.textura, Math.max(0.05, p.escala));
  }

  colorMaterial(src) {
    const c = src.color ? src.color.getHexString() : 'cccccc';
    const key = `${c}|${src.opacity ?? 1}`;
    let m = this.colorMats.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: src.color?.clone() || 0xcccccc, roughness: 0.7, metalness: 0, side: THREE.DoubleSide,
        transparent: (src.opacity ?? 1) < 1, opacity: src.opacity ?? 1, depthWrite: (src.opacity ?? 1) >= 1 });
      this.colorMats.set(key, m);
      this.renderSet.add(m);
    }
    return m;
  }

  renderFor(flat) {
    if (Array.isArray(flat)) return flat.map(f => this.renderFor(f));
    return (flat?.name && this.libraryMaterial(flat.name)) || this.colorMaterial(flat || {});
  }

  /** Troca o material das malhas do modelo pelo de render (o original fica guardado para a volta). */
  applyMaterials() {
    this.viewer.model.traverse(o => {
      if (!o.isMesh || o.userData.isEdge) return;
      if (o.userData.noCap) { o.visible = false; o.userData._hiddenByRender = true; return; } // vazio
      o.castShadow = o.receiveShadow = true;
      const ud = o.userData;
      const selected = !!ud._origMat; // destaque de seleção ativo: o material "real" está em _origMat
      const cur = selected ? ud._origMat : o.material;
      if ([].concat(cur).every(m => this.renderSet.has(m))) return;
      ud._flatMat = cur;
      const rm = this.renderFor(cur);
      if (selected) ud._origMat = rm; else o.material = rm;
    });
  }

  restoreMaterials() {
    this.viewer.model.traverse(o => {
      const ud = o.userData;
      if (ud._hiddenByRender) { o.visible = true; delete ud._hiddenByRender; }
      if (!o.isMesh || !ud._flatMat) return;
      if (ud._origMat) ud._origMat = ud._flatMat; else o.material = ud._flatMat;
      delete ud._flatMat;
    });
  }

  /** Depois de editar a biblioteca de materiais: atualiza os materiais de render no lugar. */
  refreshMaterials() {
    for (const [name, m] of this.mats) {
      const def = this.app.types.materials[name];
      if (def) this.updateLibraryMaterial(m, def);
    }
    this.applyMaterials();
    this.pt?.updateMaterials();
  }

  /** Materiais da biblioteca usados por um elemento (para o painel Propriedades). */
  materialsOf(el) {
    const names = new Set();
    el.traverse(o => {
      if (!o.isMesh) return;
      const flat = o.userData._flatMat || o.userData._origMat || o.material;
      for (const m of [].concat(flat)) if (m?.name && this.app.types.materials[m.name]) names.add(m.name);
    });
    return [...names];
  }

  /** Muda uma propriedade de render (ou a cor) de um material e grava na biblioteca. */
  async setMaterialProp(name, key, value) {
    const def = this.app.types.materials[name];
    if (!def) return;
    if (key === 'color') def.color = value;
    else def.render = { ...renderProps(name, def), [key]: value };
    const m = this.mats.get(name);
    if (m) this.updateLibraryMaterial(m, def);
    this.pt?.updateMaterials();
    clearTimeout(this._saveT);
    this._saveT = setTimeout(() => this.app.types.save(), 400);
  }

  // ------------------------------------------------------------ path tracing

  async startPathTracing() {
    const v = this.viewer;
    if (this.pt) return;
    if (v.camera !== v.perspCam) { this.app.status('Path tracing só na vista 3D em perspectiva.'); return; }
    const pt = new WebGLPathTracer(v.renderer);
    pt.tiles.set(2, 2);
    pt.minSamples = 1;
    pt.renderDelay = 0;
    pt.fadeDuration = 300;
    pt.bounces = 6;
    pt.filterGlossyFactor = 0.5;
    pt.dynamicLowRes = true;
    pt.lowResScale = 0.35;
    this.pt = pt;
    this._lastSamples = -1;
    this.app.status('Path tracing: preparando a cena…');
    await this.rebuildPathTracerScene();
  }

  async rebuildPathTracerScene() {
    const pt = this.pt;
    if (!pt) return;
    const v = this.viewer;
    // o path tracer só entende malhas e materiais padrão: esconde o que é do app (grade, gizmo, anotações)
    const hidden = [v.annotations].filter(o => o.visible);
    hidden.forEach(o => { o.visible = false; });
    // montagem síncrona da BVH (a assíncrona exige um worker próprio); modelos de projeto montam em milissegundos
    try { pt.setScene(v.scene, v.camera); this.ptError = null; }
    catch (e) { console.error(e); this.ptError = e.message; this.stopPathTracing(); }
    finally { hidden.forEach(o => { o.visible = true; }); }
    this.updateStatus();
  }

  stopPathTracing() {
    if (!this.pt) return;
    this.pt.dispose();
    this.pt = null;
    this.updateStatus();
  }

  setQuality(q) {
    this.settings.qualidade = q;
    this.save();
    if (q === 'path-tracing') this.startPathTracing(); else this.stopPathTracing();
    this.buildBar();
  }

  updateStatus() {
    if (!this.active) return;
    if (this.ptError && !this.pt) this.app.status(`Path tracing indisponível: ${this.ptError}`);
    else if (this.pt) this.app.status(`Path tracing: ${Math.max(0, this._lastSamples)} amostra(s) — a imagem fica mais limpa a cada amostra; mexer na câmera recomeça.`);
    else this.app.status('Render em tempo real: arraste para orbitar · Path tracing na barra para a imagem final · Captura salva a imagem.');
  }

  // ------------------------------------------------------------ barra

  buildBar() {
    this.bar?.remove();
    const s = this.settings;
    const set = (k, val) => { s[k] = val; this.applySettings(); };
    const range = (k, min, max, step, title) => {
      const out = h2('span', { class: 'rb-val' }, String(s[k]));
      const inp = h2('input', { type: 'range', min, max, step, value: s[k], title });
      inp.addEventListener('input', () => { out.textContent = inp.value; set(k, Number(inp.value)); });
      return [inp, out];
    };
    const sel = (k, opts) => {
      const e = h2('select', {});
      for (const [val, label] of Object.entries(opts)) { const o = h2('option', { value: val }, label); if (val === s[k]) o.selected = true; e.append(o); }
      e.addEventListener('change', () => set(k, e.value));
      return e;
    };
    const ao = h2('input', { type: 'checkbox' });
    ao.checked = s.ao;
    ao.addEventListener('change', () => { s.ao = ao.checked; this.save(); });
    const q = h2('select', { title: 'Tempo real (rasterização) ou path tracing progressivo (luz global, reflexos e vidro corretos)' });
    for (const [val, label] of [['tempo-real', 'Tempo real'], ['path-tracing', 'Path tracing']]) {
      const o = h2('option', { value: val }, label); if (val === s.qualidade) o.selected = true; q.append(o);
    }
    q.addEventListener('change', () => this.setQuality(q.value));
    const shot = h2('button', { class: 'primary', title: 'Salvar a imagem renderizada (PNG)' }, 'Salvar imagem');
    shot.addEventListener('click', () => this.app.saveScreenshot());
    this.bar = h2('div', { class: 'draw-bar render-bar' },
      h2('strong', {}, '☀ Render'),
      h2('label', { title: 'Direção do sol (graus a partir do Norte, sentido horário)' }, 'Azimute', ...range('azimute', 0, 360, 1)),
      h2('label', { title: 'Altura do sol acima do horizonte (graus)' }, 'Altura', ...range('altura', 1, 89, 1)),
      h2('label', {}, 'Céu', sel('ceu', SKIES)),
      h2('label', {}, 'Chão', sel('chao', { grama: 'Grama', neutro: 'Neutro', nenhum: 'Nenhum' })),
      h2('label', { title: 'Exposição' }, 'Exposição', ...range('exposicao', 0.2, 3, 0.05)),
      h2('label', { title: 'Oclusão ambiente (cantos mais escuros)' }, ao, 'AO'),
      h2('label', {}, 'Qualidade', q),
      shot);
    document.querySelector('.center').append(this.bar);
    if (s.qualidade === 'path-tracing' && !this.pt) this.startPathTracing();
  }
}

/** Criação de elementos sem depender de ui.js (evita ciclo de importação). */
function h2(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  for (const c of children.flat()) if (c !== null && c !== undefined) e.append(c instanceof Node ? c : String(c));
  return e;
}
