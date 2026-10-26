// Vistas do projeto, no modelo do Revit: Vista 3D, Plantas de piso e Plantas de forro (uma por nível)
// e Elevações. Cada vista abre numa aba e guarda a própria câmera.
// ELEVAÇÕES do projeto (dados.elevacoes): as quatro de fábrica (Norte, Sul, Leste, Oeste) e as que o usuário criar,
//   { id, nome, dir: [x, y] (lado de onde se olha), origem: [x, y] | null (linha da elevação; null = borda do modelo),
//     profundidade: m | null (até onde enxerga a partir da linha; null = tudo), largura: m | null (centrada na
//     origem, ao longo da linha; null = toda a extensão), visivel (no navegador, nos menus e
//     com o marcador nas plantas) }
// NOMES E CÓPIAS (dados.vistas = { nomes: { idDaVista: nome }, duplicadas: [{ id: 'dup:…', base, nome }] }): qualquer
//   vista pode ser renomeada; uma vista duplicada mostra o mesmo que a original, com câmera, estilo e escala próprios.
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
const ELEV_COLOR = 0x2f6fb0;

/** Elevações de fábrica (as quatro direções, olhando o modelo inteiro). */
export const defaultElevations = () => Object.entries(ELEVATIONS).map(([id, e]) => ({ id, nome: e.name, dir: e.dir.slice(0, 2), origem: null, profundidade: null, largura: null, visivel: true }));

/** Confere e completa uma lista de elevações (vinda da tela, do projeto ou da IA). */
export function normalizeElevations(list) {
  const out = [];
  for (const e of Array.isArray(list) ? list : []) {
    const d = Array.isArray(e?.dir) ? e.dir.map(Number) : [0, -1];
    const L = Math.hypot(d[0], d[1]) || 1;
    out.push({
      id: String(e?.id || `e${Date.now().toString(36)}${out.length}`),
      nome: String(e?.nome || 'Elevação').slice(0, 60),
      dir: [d[0] / L, d[1] / L],
      origem: Array.isArray(e?.origem) && e.origem.every(Number.isFinite) ? e.origem.slice(0, 2).map(Number) : null,
      profundidade: Number(e?.profundidade) > 0 ? Number(e.profundidade) : null,
      largura: Number(e?.largura) > 0 ? Number(e.largura) : null,
      visivel: e?.visivel !== false,
    });
  }
  return out.length ? out : defaultElevations();
}
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
    this.elevs = defaultElevations();
    this.names = {};           // id da vista → nome dado pelo usuário
    this.dups = [];            // vistas duplicadas: { id, base, nome }
    levels.addEventListener('change', () => this._onLevelsChanged());
    viewer.addEventListener('change', () => this._refreshAnnotations());
    this.renderTabs();
  }

  // ---------------------------------------------------------------- catálogo

  list() {
    const views = [{ id: '3d', kind: '3d', name: '{3D}' }];
    for (const l of this.levels.list) views.push({ id: `plan:${l.id}`, kind: 'plan', levelId: l.id, name: l.name });
    for (const l of this.levels.list) views.push({ id: `ceiling:${l.id}`, kind: 'ceiling', levelId: l.id, name: l.name });
    for (const e of this.elevs) views.push({ id: `elev:${e.id}`, kind: 'elevation', dir: [e.dir[0], e.dir[1], 0], name: e.nome, elev: e, hidden: !e.visivel });
    for (const d of this.dups) {
      const b = views.find(v => v.id === d.base);
      if (b) views.push({ ...b, id: d.id, dupOf: b.id, name: d.nome, renamed: true });
    }
    for (const v of views) if (this.names[v.id]) { v.name = this.names[v.id]; v.renamed = true; }
    return views;
  }

  // ------------------------------------------------------------ renomear / duplicar

  /** Dados gravados no projeto (dados.vistas). */
  loadViews(d = {}) {
    this.names = { ...(d.nomes || {}) };
    this.dups = (Array.isArray(d.duplicadas) ? d.duplicadas : []).filter(x => x?.id && x.base).map(x => ({ id: String(x.id), base: String(x.base), nome: String(x.nome || 'Vista') }));
    this._onLevelsChanged();
  }

  viewsData() { return { nomes: this.names, duplicadas: this.dups }; }

  _changedViews() {
    this.renderTabs();
    this.dispatchEvent(new Event('views'));
  }

  rename(id, nome) {
    const v = this.get(id);
    if (!v) return;
    nome = String(nome || '').trim().slice(0, 80);
    const dup = this.dups.find(d => d.id === id);
    if (dup) dup.nome = nome || dup.nome;
    else if (nome && nome !== this.defaultName(v)) this.names[id] = nome;
    else delete this.names[id];
    this._changedViews();
  }

  /** Nome da vista sem o que o usuário mudou. */
  defaultName(v) {
    const fresh = { ...v, renamed: false };
    if (v.kind === 'plan' || v.kind === 'ceiling') fresh.name = this.levels.get(v.levelId)?.name || v.name;
    if (v.kind === 'elevation') fresh.name = v.elev?.nome || v.name;
    if (v.kind === '3d') fresh.name = '{3D}';
    return this.label(fresh);
  }

  /** Duplica uma vista (abre a cópia); copia câmera e configurações via o evento "duplicate". */
  duplicate(id) {
    const v = this.get(id);
    if (!v) return null;
    const nid = `dup:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    let nome = `${this.label(v)} — cópia`, n = 2;
    while (this.list().some(x => this.label(x) === nome)) nome = `${this.label(v)} — cópia ${n++}`;
    this.dups.push({ id: nid, base: v.dupOf || v.id, nome });
    if (this.activeId === id) this.cams.set(id, this.viewer.cameraState());
    if (this.cams.has(id)) this.cams.set(nid, this.cams.get(id));
    this.dispatchEvent(new CustomEvent('duplicate', { detail: { from: id, to: nid } }));
    this._changedViews();
    this.openView(nid);
    return nid;
  }

  removeDuplicate(id) {
    if (!this.dups.some(d => d.id === id)) return;
    this.dups = this.dups.filter(d => d.id !== id);
    delete this.names[id];
    this.closeView(id);
    this._changedViews();
  }

  /** Elevações (visíveis, ou todas). */
  elevations({ all = false } = {}) { return all ? this.elevs : this.elevs.filter(e => e.visivel); }

  /** Troca a lista de elevações (gravada no projeto por quem chamou); fecha abas de elevações apagadas. */
  setElevations(list) {
    this.elevs = normalizeElevations(list);
    this._onLevelsChanged();
    this.dispatchEvent(new Event('elevations'));
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
    if (v.renamed) return v.name;
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
      const e = this.elevs.find(x => x.id.toLowerCase() === d || x.nome.toLowerCase() === d);
      return e ? this.get(`elev:${e.id}`) : null;
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
      viewer.setAnnotations(ceiling ? [] : this._elevMarkers(lvl.elevation + Math.min(0.5, r.cutHeight * 0.5)));
      if (saved) viewer.restoreCamera(saved); else viewer.frameOrtho(ceiling ? [0, -0.0001, -1] : [0, -0.0001, 1]);
      return;
    }

    // elevação: com linha (origem) e profundidade, só o que está à frente da linha e até a profundidade
    const e = v.elev, clip = [];
    if (e?.origem) {
      const [dx, dy] = e.dir, k = dx * e.origem[0] + dy * e.origem[1];
      clip.push({ normal: [-dx, -dy, 0], constant: k + 0.001 });
      if (e.profundidade) clip.push({ normal: [dx, dy, 0], constant: -k + e.profundidade });
      if (e.largura) {
        // eixo da linha (da esquerda para a direita de quem olha): r = Z × dir
        const rx = -dy, ry = dx, kr = rx * e.origem[0] + ry * e.origem[1], w = e.largura / 2;
        clip.push({ normal: [rx, ry, 0], constant: -kr + w }, { normal: [-rx, -ry, 0], constant: kr + w });
      }
    }
    viewer.applyView({ camera: 'ortho', paper: true, grid: false, clip });
    this._refreshAnnotations();
    // enquadra modelo + linhas de nível, com folga para os rótulos à direita
    // com linha: enquadra só o que está na faixa da elevação (entre a linha e a profundidade)
    let targets = [viewer.model, viewer.annotations];
    if (e?.origem) {
      const [dx, dy] = e.dir, k = dx * e.origem[0] + dy * e.origem[1], far = k - (e.profundidade || 1e6);
      const inRange = viewer.elements().filter(o => {
        if (!o.visible) return false;
        const b = new THREE.Box3().setFromObject(o);
        if (b.isEmpty()) return false;
        const pts = [b.min.x, b.max.x].flatMap(x => [b.min.y, b.max.y].map(y => [x, y]));
        const vals = pts.map(([x, y]) => dx * x + dy * y);
        if (Math.max(...vals) < far || Math.min(...vals) > k) return false;
        if (!e.largura) return true;
        const kr = -dy * e.origem[0] + dx * e.origem[1], lat = pts.map(([x, y]) => -dy * x + dx * y - kr);
        return Math.max(...lat) >= -e.largura / 2 && Math.min(...lat) <= e.largura / 2;
      });
      if (inRange.length) targets = inRange;
    }
    if (saved) viewer.restoreCamera(saved); else viewer.frameOrtho(v.dir, targets, e?.origem ? 1.25 : 1.45);
  }

  /** Mostra (ou esconde) as linhas de nível na Vista 3D e nas elevações; fica guardado neste navegador. */
  get levels3d() { try { return localStorage.getItem('boxbim.niveis3d') !== '0'; } catch { return true; } }
  set levels3d(on) {
    try { localStorage.setItem('boxbim.niveis3d', on ? '1' : '0'); } catch { /* sem armazenamento */ }
    this.refresh();
    this.dispatchEvent(new Event('display'));
  }

  /** Mostra (ou esconde) os marcadores das elevações nas plantas; fica guardado neste navegador. */
  get elevMarkers() { try { return localStorage.getItem('boxbim.marcadoresElev') !== '0'; } catch { return true; } }
  set elevMarkers(on) {
    try { localStorage.setItem('boxbim.marcadoresElev', on ? '1' : '0'); } catch { /* sem armazenamento */ }
    this.refresh();
    this.dispatchEvent(new Event('display'));
  }

  /** Linha de uma elevação no modelo: a dada, ou na borda do modelo do lado de onde se olha. */
  elevationLine(e) {
    const box = this.viewer.modelBox();
    if (box.isEmpty()) box.set(new THREE.Vector3(-10, -10, 0), new THREE.Vector3(10, 10, 3));
    const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    const d = new THREE.Vector3(e.dir[0], e.dir[1], 0);
    const right = new THREE.Vector3(0, 0, 1).cross(d).normalize();
    const half = e.largura ? e.largura / 2 : Math.abs(right.x) * size.x / 2 + Math.abs(right.y) * size.y / 2 + 1;
    const o = e.origem ? new THREE.Vector3(e.origem[0], e.origem[1], 0)
      : c.clone().setZ(0).addScaledVector(d, Math.abs(d.x) * size.x / 2 + Math.abs(d.y) * size.y / 2 + 2.5);
    return { o, d, right, half };
  }

  /** Marcadores das elevações visíveis numa planta (cota z): círculo com a seta para onde se olha e o nome. */
  _elevMarkers(z) {
    if (!this.elevMarkers) return [];
    const objs = [];
    for (const e of this.elevations()) {
      const { o, d, right, half } = this.elevationLine(e);
      const p = o.clone().setZ(z);
      const mat = new THREE.MeshBasicMaterial({ color: ELEV_COLOR, depthTest: false, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 32), mat);
      ring.position.copy(p);
      // seta (triângulo) apontando para o modelo (para onde a câmera olha: −dir)
      const look = d.clone().negate();
      const tip = p.clone().addScaledVector(look, 0.95), b1 = p.clone().addScaledVector(right, 0.45), b2 = p.clone().addScaledVector(right, -0.45);
      const tri = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([b1, b2, tip]), mat);
      // linha da elevação (tracejada) quando tem origem, mostrando a largura
      const objsE = [ring, tri];
      if (e.origem) {
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([p.clone().addScaledVector(right, -half), p.clone().addScaledVector(right, half)]),
          new THREE.LineDashedMaterial({ color: ELEV_COLOR, dashSize: 0.4, gapSize: 0.25, depthTest: false }));
        line.computeLineDistances();
        objsE.push(line);
        if (e.profundidade) {
          const q = p.clone().addScaledVector(look, e.profundidade);
          const far = new THREE.Line(new THREE.BufferGeometry().setFromPoints([q.clone().addScaledVector(right, -half), q.clone().addScaledVector(right, half)]),
            new THREE.LineDashedMaterial({ color: ELEV_COLOR, dashSize: 0.15, gapSize: 0.3, depthTest: false, transparent: true, opacity: 0.6 }));
          far.computeLineDistances();
          objsE.push(far);
        }
      }
      const label = textSprite(e.nome, { size: 20, color: '#2f6fb0' });
      label.position.copy(p).addScaledVector(d, 0.75);
      label.center.set(0.5, 0.5);
      objsE.push(label);
      for (const x of objsE) { x.renderOrder = 9; x.userData.elevId = e.id; }
      objs.push(...objsE);
    }
    return objs;
  }

  /** Marcador de elevação perto do ponto da tela (clique duplo abre a elevação). */
  elevationAt(clientX, clientY) {
    const c = this.viewer.renderer.domElement.getBoundingClientRect();
    let best = null, bd = 22;
    for (const o of this.viewer.annotations.children) {
      if (!o.userData.elevId || !o.isSprite) continue;
      const v = o.position.clone().project(this.viewer.camera);
      const d = Math.hypot((v.x + 1) / 2 * c.width + c.left - clientX, (1 - v.y) / 2 * c.height + c.top - clientY);
      if (d < bd) { bd = d; best = o.userData.elevId; }
    }
    if (!best) {
      // o círculo do marcador também vale
      for (const o of this.viewer.annotations.children) {
        if (!o.userData.elevId || !o.isMesh) continue;
        const v = o.position.clone().project(this.viewer.camera);
        const d = Math.hypot((v.x + 1) / 2 * c.width + c.left - clientX, (1 - v.y) / 2 * c.height + c.top - clientY);
        if (d < bd) { bd = d; best = o.userData.elevId; }
      }
    }
    return best;
  }

  /**
   * Linhas e rótulos de nível nas elevações e na Vista 3D (um contorno tracejado em volta do modelo em cada cota).
   * Cada objeto leva userData.levelId: o editor de níveis (levels-edit.js) os arrasta e abre com clique duplo.
   */
  _refreshAnnotations() {
    const v = this.active;
    if (v.kind === '3d') return this._levels3d();
    if (v.kind !== 'elevation') return;
    if (!this.levels3d) return this.viewer.setAnnotations([]);
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
