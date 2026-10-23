// Vistas do projeto, no modelo do Revit: Vista 3D, Plantas de piso e Plantas de forro (uma por nível)
// e Elevações (Norte, Sul, Leste, Oeste). Cada vista abre numa aba e guarda a própria câmera.
import * as THREE from 'three';
import { textSprite } from './viewer.js';
import { fmtElev, cutOf } from './levels.js';
import { h } from './ui.js';

export const ELEVATIONS = {
  N: { name: 'Norte', dir: [0, 1, 0] },
  S: { name: 'Sul', dir: [0, -1, 0] },
  L: { name: 'Leste', dir: [1, 0, 0] },
  O: { name: 'Oeste', dir: [-1, 0, 0] },
};

const DEFAULT_RANGE = { cutHeight: 1.2, viewDepth: -0.3 };
const LEVEL_COLOR = 0x1f6f2e;
const LEVEL_COLOR_3D = 0x35b860; // mais claro: o fundo do 3D costuma ser escuro

/** Linha tracejada de um nível (por cima do modelo). */
function levelLine(points, l, { opacity = 1, color = LEVEL_COLOR } = {}) {
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineDashedMaterial({ color, dashSize: 0.6, gapSize: 0.25, depthTest: false, transparent: opacity < 1, opacity }));
  line.computeLineDistances();
  line.renderOrder = 9;
  line.userData.levelId = l.id;
  return line;
}

/** Rótulo "Nome  +0,00" de um nível (no 3D, com a "cabeça" ◉ no texto). */
function levelLabel(l, head = false) {
  const label = textSprite(`${head ? '◉ ' : ''}${l.name}  ${fmtElev(l.elevation)}${l.fixo ? '  🔒' : ''}`, { size: 22, color: head ? '#35b860' : undefined });
  label.userData.levelId = l.id;
  label.userData.levelLabel = true;
  return label;
}

export class ViewManager extends EventTarget {
  constructor(viewer, levels, tabsEl) {
    super();
    this.viewer = viewer;
    this.levels = levels;
    this.tabsEl = tabsEl;
    this.open = ['3d'];        // ids das abas abertas, em ordem
    this.activeId = '3d';
    this.cams = new Map();     // câmera salva por vista
    this.ranges = new Map();   // faixa de vista por planta (cutHeight, viewDepth)
    levels.addEventListener('change', () => this._onLevelsChanged());
    viewer.addEventListener('change', () => this._refreshAnnotations());
    this.renderTabs();
  }

  // ---------------------------------------------------------------- catálogo

  list() {
    const views = [{ id: '3d', kind: '3d', name: '{3D}' }];
    for (const l of this.levels.list) views.push({ id: `plan:${l.id}`, kind: 'plan', levelId: l.id, name: l.name });
    for (const l of this.levels.list) views.push({ id: `ceiling:${l.id}`, kind: 'ceiling', levelId: l.id, name: l.name });
    for (const [k, e] of Object.entries(ELEVATIONS)) views.push({ id: `elev:${k}`, kind: 'elevation', dir: e.dir, name: e.name });
    return views;
  }

  get(id) { return this.list().find(v => v.id === id) || null; }
  get active() { return this.get(this.activeId) || this.get('3d'); }

  /** Nível da vista ativa (plantas); nulo no 3D e nas elevações. */
  activeLevel() {
    const v = this.active;
    return v.levelId ? this.levels.get(v.levelId) : null;
  }

  /**
   * Faixa da vista (plano de corte e profundidade) — nas plantas, é a configuração de corte do NÍVEL (fica no projeto
   * e vale para todos). Para mudar, use setRange (grava no nível).
   */
  range(id) {
    const v = this.get(id);
    const lvl = v?.levelId ? this.levels.get(v.levelId) : null;
    if (lvl) return cutOf(lvl);
    if (!this.ranges.has(id)) this.ranges.set(id, { ...DEFAULT_RANGE });
    return this.ranges.get(id);
  }

  setRange(id, patch) {
    const v = this.get(id);
    const lvl = v?.levelId ? this.levels.get(v.levelId) : null;
    if (lvl) { this.levels.update(lvl.id, { corte: { ...cutOf(lvl), ...patch } }); return; } // muda o nível → refaz as vistas
    Object.assign(this.range(id), patch);
    this.refresh();
  }

  label(v) {
    if (v.kind === '3d') return 'Vista 3D';
    if (v.kind === 'plan') return v.name;
    if (v.kind === 'ceiling') return `${v.name} (forro)`;
    return `${v.name} (elevação)`;
  }

  /** Encontra uma vista por descrição: { kind, level, direction } ou id. */
  find({ id, kind, level, direction } = {}) {
    if (id) return this.get(id);
    if (kind === '3d' || !kind) return this.get('3d');
    if (kind === 'elevation') {
      const d = String(direction || 'S').toLowerCase();
      const key = Object.entries(ELEVATIONS).find(([k, e]) => k.toLowerCase() === d || e.name.toLowerCase() === d)?.[0];
      return key ? this.get(`elev:${key}`) : null;
    }
    const lvl = this.levels.get(level) || this.levels.list[0];
    return lvl ? this.get(`${kind}:${lvl.id}`) : null;
  }

  // ---------------------------------------------------------------- abrir / fechar

  openView(id) {
    const v = this.get(id);
    if (!v) throw new Error(`Vista não encontrada: ${id}`);
    if (this.activeId && this.get(this.activeId)) this.cams.set(this.activeId, this.viewer.cameraState());
    if (!this.open.includes(id)) this.open.push(id);
    this.activeId = id;
    this._apply(v);
    this.renderTabs();
    this.dispatchEvent(new Event('activate'));
    return v;
  }

  closeView(id) {
    const i = this.open.indexOf(id);
    if (i < 0) return;
    this.open.splice(i, 1);
    this.cams.delete(id);
    if (!this.open.length) this.open.push('3d');
    if (this.activeId === id) this.openView(this.open[Math.max(0, i - 1)] || this.open[0]);
    else this.renderTabs();
  }

  /** Reaplica a vista ativa (ex.: depois de mudar a faixa de vista ou a cota de um nível). */
  refresh() { this._apply(this.active, { keepCamera: true }); }

  _apply(v, { keepCamera = false } = {}) {
    const viewer = this.viewer;
    const saved = keepCamera ? viewer.cameraState() : this.cams.get(v.id);

    if (v.kind === '3d') {
      // perspectiva ou ortogonal (botão na vista); a ortogonal gira como a perspectiva
      const ortho = this.projectionOf?.(v) === 'ortho';
      viewer.applyView({ camera: ortho ? 'ortho' : 'persp', rotate: ortho, grid: true });
      this._refreshAnnotations();
      if (saved) viewer.restoreCamera(saved);
      return;
    }

    if (v.kind === 'plan' || v.kind === 'ceiling') {
      const lvl = this.levels.get(v.levelId);
      const r = this.range(v.id);
      const up = this.levels.above(lvl);
      const cut = lvl.elevation + r.cutHeight;
      let clip; // o primeiro plano é sempre o plano de corte (o viewer desenha a tampa nele)
      if (v.kind === 'plan') {
        // mostra de (nível + profundidade) até o plano de corte
        clip = [{ normal: [0, 0, -1], constant: cut }, { normal: [0, 0, 1], constant: -(lvl.elevation + r.viewDepth) }];
      } else {
        // forro: do plano de corte até o nível de cima (inclui a laje dele)
        const top = up ? up.elevation + 0.05 : lvl.elevation + 50;
        clip = [{ normal: [0, 0, 1], constant: -cut }, { normal: [0, 0, -1], constant: top }];
      }
      // A planta de forro olha de baixo para cima e é espelhada, como no Revit, para manter a orientação da planta.
      const ceiling = v.kind === 'ceiling';
      viewer.applyView({ camera: 'ortho', clip, paper: true, grid: false, mirror: ceiling, capZ: cut });
      viewer.setAnnotations([]);
      if (saved) viewer.restoreCamera(saved); else viewer.frameOrtho(ceiling ? [0, -0.0001, -1] : [0, -0.0001, 1]);
      return;
    }

    // elevação
    viewer.applyView({ camera: 'ortho', paper: true, grid: false });
    this._refreshAnnotations();
    // enquadra modelo + linhas de nível, com folga para os rótulos à direita
    if (saved) viewer.restoreCamera(saved); else viewer.frameOrtho(v.dir, [viewer.model, viewer.annotations], 1.45);
  }

  /** Mostra (ou esconde) as linhas de nível na Vista 3D; fica guardado neste navegador. */
  get levels3d() { try { return localStorage.getItem('boxbim.niveis3d') !== '0'; } catch { return true; } }
  set levels3d(on) {
    try { localStorage.setItem('boxbim.niveis3d', on ? '1' : '0'); } catch { /* sem armazenamento */ }
    if (this.active.kind === '3d') this._refreshAnnotations();
  }

  /**
   * Linhas e rótulos de nível nas elevações e na Vista 3D (um contorno tracejado em volta do modelo em cada cota).
   * Cada objeto leva userData.levelId: o editor de níveis (levels-edit.js) os arrasta e abre com clique duplo.
   */
  _refreshAnnotations() {
    const v = this.active;
    if (v.kind === '3d') return this._levels3d();
    if (v.kind !== 'elevation') return;
    const box = this.viewer.modelBox();
    if (box.isEmpty()) box.set(new THREE.Vector3(-10, -10, 0), new THREE.Vector3(10, 10, 3));
    const d = new THREE.Vector3(...v.dir);
    // eixo horizontal da elevação (da esquerda para a direita de quem olha)
    const right = new THREE.Vector3(0, 0, 1).cross(d).normalize();
    const size = box.getSize(new THREE.Vector3());
    const ext = Math.max(2, Math.max(size.x, size.y) * 0.08);
    const center = box.getCenter(new THREE.Vector3());
    const half = Math.abs(right.x) * size.x / 2 + Math.abs(right.y) * size.y / 2 + ext;
    // plano das anotações: à frente do modelo, do lado da câmera
    const front = Math.abs(d.x) * size.x / 2 + Math.abs(d.y) * size.y / 2 + 0.5;
    const objs = [];
    // Níveis muito próximos alternam a cabeça entre direita e esquerda (como o Revit) para os rótulos não colidirem
    const lv = this.levels.list;
    const span = Math.max(1, lv.at(-1).elevation - lv[0].elevation, size.z);
    let side = 1;
    lv.forEach((l, i) => {
      if (i > 0 && l.elevation - lv[i - 1].elevation < span * 0.06) side = -side; else side = 1;
      const base = center.clone().addScaledVector(d, front).setZ(l.elevation);
      const a = base.clone().addScaledVector(right, -half), b = base.clone().addScaledVector(right, half);
      const line = levelLine([a, b], l);
      const end = side > 0 ? b : a;
      const head = new THREE.Mesh(new THREE.CircleGeometry(0.18, 20), new THREE.MeshBasicMaterial({ color: LEVEL_COLOR, depthTest: false, side: THREE.DoubleSide }));
      head.position.copy(end);
      head.lookAt(end.clone().add(d));
      head.renderOrder = 9;
      head.userData.levelId = l.id;
      const label = levelLabel(l);
      if (side < 0) label.center.set(1, 0.5);
      label.position.copy(end).addScaledVector(right, 0.35 * side);
      objs.push(line, head, label);
    });
    this.viewer.setAnnotations(objs);
  }

  /** Vista 3D: contorno tracejado do modelo em cada nível, com o rótulo numa quina. */
  _levels3d() {
    if (!this.levels3d) return this.viewer.setAnnotations([]);
    const box = this.viewer.modelBox();
    if (box.isEmpty()) box.set(new THREE.Vector3(-5, -5, 0), new THREE.Vector3(5, 5, 3));
    const size = box.getSize(new THREE.Vector3());
    const m = Math.max(1, Math.max(size.x, size.y) * 0.08);
    const x0 = box.min.x - m, x1 = box.max.x + m, y0 = box.min.y - m, y1 = box.max.y + m;
    const objs = [];
    for (const l of this.levels.list) {
      const z = l.elevation;
      const pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]].map(([x, y]) => new THREE.Vector3(x, y, z));
      const label = levelLabel(l, true);
      label.position.set(x1, y0, z);
      objs.push(levelLine(pts, l, { color: LEVEL_COLOR_3D, opacity: 0.85 }), label);
    }
    this.viewer.setAnnotations(objs);
  }

  _onLevelsChanged() {
    // fecha abas de níveis que deixaram de existir
    const valid = new Set(this.list().map(v => v.id));
    this.open = this.open.filter(id => valid.has(id));
    if (!valid.has(this.activeId)) this.openView(this.open[0] || '3d');
    else this.refresh();
    this.renderTabs();
  }

  // ---------------------------------------------------------------- abas

  renderTabs() {
    const el = this.tabsEl;
    if (!el) return;
    el.innerHTML = '';
    for (const id of this.open) {
      const v = this.get(id);
      if (!v) continue;
      const icon = { '3d': '⬡', plan: '▦', ceiling: '▤', elevation: '⌂' }[v.kind];
      el.append(h('div', { class: `vtab${id === this.activeId ? ' active' : ''}`, title: this.label(v), onclick: () => this.openView(id) },
        h('span', { class: 'vicon' }, icon), this.label(v),
        h('button', { class: 'vclose', title: 'Fechar', onclick: e => { e.stopPropagation(); this.closeView(id); } }, '✕')));
    }
  }
}
