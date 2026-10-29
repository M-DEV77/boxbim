// ESTILOS DE VISTA (em todas as vistas) e PROJEÇÃO das vistas 3D.
//   arame ........ só as arestas, tudo vazado
//   projeto ...... desenho técnico: faces brancas, arestas pretas, fundo de papel, corte cinza nas plantas
//   colorido ..... uma cor por categoria (paredes, pisos, pilares…), para entender o projeto rápido
//   transparente . as mesmas cores, translúcidas, para ver o que está escondido
//   textura ...... os materiais com cor, relevo e todos os mapas, na luz normal da vista (leve, para modelar)
//   render ....... materiais reais em tempo real (céu, sol, sombras; path tracing) — o RenderMode
// Cada vista guarda o próprio estilo (3D começa em colorido; plantas e elevações, em projeto).
// As cores do colorido são do projeto (dados.cores) e editáveis.
import * as THREE from 'three';

export const STYLES = {
  arame: { label: 'Arame', icon: '⬚', title: 'Só as linhas: tudo vazado' },
  projeto: { label: 'Projeto', icon: '✎', title: 'Desenho técnico: faces brancas, linhas pretas' },
  colorido: { label: 'Colorido', icon: '◧', title: 'Uma cor por categoria, para entender o projeto' },
  transparente: { label: 'Transparente', icon: '◌', title: 'Cores translúcidas: mostra o que está escondido' },
  textura: { label: 'Textura', icon: '▦', title: 'Materiais com texturas e mapas, sem céu/sol/sombras (leve, antes do Render)' },
  render: { label: 'Render', icon: '☀', title: 'Materiais reais em tempo real (céu, sol, sombras, path tracing)' },
};

export const DEFAULT_COLORS = {
  IfcWall: '#e8b04a', IfcWallStandardCase: '#e8b04a', IfcSlab: '#9aa5b1', IfcColumn: '#3d8bd9', IfcBeam: '#8e5cd9',
  IfcDoor: '#b8733a', IfcWindow: '#47c4e0', IfcStair: '#d9604a', IfcRailing: '#7a7f87', IfcRoof: '#c0504d',
  IfcFurniture: '#4caf6a', IfcFurnishingElement: '#4caf6a', IfcCovering: '#c9b28a', IfcBuildingElementProxy: '#a0a8b5',
  IfcSanitaryTerminal: '#7fb3d5', IfcLightFixture: '#f4d03f', IfcMember: '#7d6bb0', IfcPlate: '#95a5a6', outros: '#b0b6bf',
};
export const COLOR_LABELS = {
  IfcWall: 'Paredes', IfcSlab: 'Pisos', IfcColumn: 'Pilares', IfcBeam: 'Vigas', IfcDoor: 'Portas', IfcWindow: 'Janelas',
  IfcStair: 'Escadas', IfcRailing: 'Guarda-corpos', IfcRoof: 'Coberturas', IfcFurniture: 'Mobiliário', IfcCovering: 'Revestimentos',
  IfcBuildingElementProxy: 'Genéricos / caixas', IfcSanitaryTerminal: 'Louças', IfcLightFixture: 'Iluminação', outros: 'Outros',
};

const TEXTURED = new Set(['textura', 'render']); // estilos com os materiais do RenderMode
const EDGE_DARK = 0x1d1d1d, EDGE_LIGHT = 0xc9d3df;

export class ViewStyles extends EventTarget {
  constructor(app) {
    super();
    this.app = app;
    this.byView = new Map();    // vista → estilo
    this.projByView = new Map(); // vista 3D → 'persp' | 'ortho'
    this.colors = { ...DEFAULT_COLORS };
    this.current = null;
    this.mats = new Map();
    this.styleSet = new WeakSet();
    app.views.addEventListener('activate', () => this.apply());
    app.viewer.addEventListener('change', () => { if (this.current && !TEXTURED.has(this.current)) this.applyMaterials(); });
  }

  get viewer() { return this.app.viewer; }

  defaultFor(v) { return v.kind === '3d' ? 'colorido' : 'projeto'; }
  styleOf(v = this.app.views.active) { return this.byView.get(v.id) || this.defaultFor(v); }
  projectionOf(v = this.app.views.active) { return this.projByView.get(v.id) || 'persp'; }

  set(style) {
    const v = this.app.views.active;
    this.byView.set(v.id, style);
    this.apply();
  }

  setProjection(p) {
    const v = this.app.views.active;
    if (v.kind !== '3d') return;
    this.projByView.set(v.id, p);
    this.app.views.refresh(); // reaplica a vista com a câmera nova (mantendo o enquadramento)
  }

  setColors(colors) {
    this.colors = { ...DEFAULT_COLORS, ...(colors || {}) };
    for (const m of this.mats.values()) m.dispose();
    this.mats.clear();
    if (this.current && !TEXTURED.has(this.current)) { this.restoreMaterials(); this.applyMaterials(true); }
  }

  /** Aplica o estilo da vista ativa (chamado a cada troca de vista). */
  apply() {
    const v = this.app.views.active;
    const style = this.styleOf(v);
    const rm = this.app.renderMode;
    // o render reconstrói fundo, luzes e materiais a cada vista; os outros estilos trocam só materiais e linhas
    if (rm?.active) rm.disable();
    if (rm?.texActive) rm.disableTextures();
    this.restoreMaterials();
    this.current = style;
    const viewer = this.viewer;
    viewer.wireOnly = style === 'arame'; // em arame, o clique só pega as linhas dos objetos (viewer.pickHit)
    if (style === 'render') {
      viewer.setEdges(false);
      viewer.capsEnabled = true;
      this.app.guides?.update(v, { hidden: true });
      rm.enable();
    } else if (style === 'textura') {
      const bg = v.kind !== '3d' ? 'paper' : 'dark';
      viewer.setBackground(bg);
      viewer.setEdges(true, v.kind !== '3d' ? EDGE_DARK : 0x2a2f36);
      viewer.capsEnabled = true;
      rm.enableTextures();
      this.app.guides?.update(v, { paper: bg === 'paper', z: this.app.views.activeLevel()?.elevation ?? 0 });
    } else {
      const bg = style === 'projeto' || v.kind !== '3d' ? 'paper' : 'dark';
      viewer.setBackground(bg);
      viewer.setEdges(true, style === 'arame' && v.kind === '3d' ? EDGE_LIGHT : style === 'projeto' || v.kind !== '3d' ? EDGE_DARK : 0x2a2f36);
      viewer.capsEnabled = style !== 'arame' && style !== 'transparente';
      this.applyMaterials(true);
      this.app.guides?.update(v, { paper: bg === 'paper', z: this.app.views.activeLevel()?.elevation ?? 0 });
    }
    this.renderBar();
    this.dispatchEvent(new Event('change'));
  }

  // ------------------------------------------------------------ materiais

  category(mesh) {
    for (let o = mesh; o; o = o.parent) if (o.userData?.bim) return o.userData.bim.type;
    return 'outros';
  }

  material(style, type) {
    const key = `${style}|${type}`;
    if (this.mats.has(key)) return this.mats.get(key);
    const color = new THREE.Color(this.colors[type] || this.colors.outros);
    let m;
    if (type === 'IfcOpeningElement') {
      // vazio: sempre vermelho translúcido (em arame some, como o resto)
      m = style === 'arame' ? new THREE.MeshBasicMaterial({ visible: false }) : new THREE.MeshBasicMaterial({ color: 0xff4d4d, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
      m.userData.styleMat = true;
      this.styleSet.add(m);
      this.mats.set(key, m);
      return m;
    }
    const off = { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, side: THREE.DoubleSide };
    if (style === 'arame') m = new THREE.MeshBasicMaterial({ visible: false });
    else if (style === 'projeto') { m = new THREE.MeshBasicMaterial({ color: 0xffffff, ...off }); m.userData.capColor = 0x5a5a5a; }
    else if (style === 'transparente') m = new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.28, depthWrite: false, ...off });
    else { m = new THREE.MeshLambertMaterial({ color, ...off }); m.userData.capColor = color.clone().multiplyScalar(0.7).getHex(); }
    m.userData.styleMat = true;
    this.styleSet.add(m);
    this.mats.set(key, m);
    return m;
  }

  /** Troca o material das malhas pelo do estilo (o original fica em _styleBase para a volta). */
  applyMaterials(force = false) {
    const style = this.current;
    if (!style || TEXTURED.has(style)) return;
    let changed = false;
    this.viewer.model.traverse(o => {
      if (!o.isMesh || o.userData.isEdge) return;
      const ud = o.userData;
      const selected = !!ud._origMat;
      const cur = selected ? ud._origMat : o.material;
      if (!force && this.styleSet.has(cur) && ud._styleKey === style) return;
      if (!ud._styleBase || !this.styleSet.has(cur)) ud._styleBase = cur;
      const m = this.material(style, this.category(o));
      if (selected) ud._origMat = m; else o.material = m;
      ud._styleKey = style;
      changed = true;
    });
    if (changed) this.viewer._bucketsDirty = true;
  }

  restoreMaterials() {
    this.viewer.model.traverse(o => {
      const ud = o.userData;
      if (!o.isMesh || !ud._styleBase) return;
      if (ud._origMat) ud._origMat = ud._styleBase; else o.material = ud._styleBase;
      delete ud._styleBase;
      delete ud._styleKey;
    });
    this.viewer._bucketsDirty = true;
  }

  // ------------------------------------------------------------ barra de estilos (em todas as vistas)

  renderBar() {
    const bar = document.querySelector('#style-bar');
    if (!bar) return;
    const v = this.app.views.active;
    bar.replaceChildren();
    if (v.kind === '3d') {
      const p = this.projectionOf(v);
      const proj = document.createElement('button');
      proj.className = 'proj-btn';
      proj.textContent = p === 'ortho' ? 'Ortogonal' : 'Perspectiva';
      proj.title = 'Alternar entre perspectiva e ortogonal';
      proj.onclick = () => this.setProjection(p === 'ortho' ? 'persp' : 'ortho');
      bar.append(proj, Object.assign(document.createElement('span'), { className: 'sep' }));
    }
    for (const [id, s] of Object.entries(STYLES)) {
      const b = document.createElement('button');
      b.className = `style-btn${this.current === id ? ' active' : ''}`;
      b.title = s.title;
      b.innerHTML = `<span class="ico">${s.icon}</span><span class="lbl">${s.label}</span>`;
      b.title = `${s.label}: ${s.title}`;
      b.onclick = () => this.set(id);
      bar.append(b);
    }
  }
}
