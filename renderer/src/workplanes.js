// EIXOS DE TRABALHO: planos de desenho com nome, em qualquer posição — horizontal numa cota ou vertical (por dois
// pontos clicados na planta, ou por origem e ângulo). O desenho 2D (Linha, Retângulo, Círculo, Aparar, Estender,
// Canto) acontece no eixo ativo; Extrudar levanta o contorno na normal do eixo.
//
// Cada eixo é um elemento do projeto (sincroniza com quem está no projeto):
//   userData.bim = { type: 'IfcGrid', name, guid, eixo: { o, u, v, x0, x1, y0, y1 } }
//   o = origem, u e v = direções do plano (no modelo); x0..x1 × y0..y1 = retângulo mostrado (coordenadas do plano).
// Se o elemento for movido/girado, o plano vai junto (frameOf usa a matriz do elemento).
// Tamanho automático (eixo.auto, padrão): o retângulo acompanha os níveis (do mais baixo ao topo do mais alto) e a
// largura do modelo, como os planos de referência do Revit; muda sozinho quando níveis ou modelo mudam.
import * as THREE from 'three';
import { uuid } from './elements.js';
import { planeMatrix } from './sketch/sketch.js';
import { textSprite } from './viewer.js';
import { h, toast, formDialog } from './ui.js';
import { toUnit, fromUnit, unitLabel } from './units.js';

const COLOR = 0x3aa0ff, ACTIVE = 0xff9f1c;
const DEG = Math.PI / 180;

export const isWorkPlane = el => !!el?.userData?.bim?.eixo;

/** Monta o elemento a partir dos dados. */
export function buildWorkPlane(bim) {
  const g = new THREE.Group();
  g.userData.bim = bim;
  g.name = bim.name;
  rebuildWorkPlane(g);
  return g;
}

export function rebuildWorkPlane(el, active = el.userData._ativo) {
  const b = el.userData.bim, e = b.eixo;
  for (const c of [...el.children]) { el.remove(c); c.geometry?.dispose(); c.material?.map?.dispose?.(); }
  const m = planeMatrix(e);
  const P = (x, y) => new THREE.Vector3(x, y, 0).applyMatrix4(m);
  const color = active ? ACTIVE : COLOR;
  // contorno (clicável e destacado na seleção, como as linhas do desenho)
  const border = new THREE.Line(new THREE.BufferGeometry().setFromPoints([P(e.x0, e.y0), P(e.x1, e.y0), P(e.x1, e.y1), P(e.x0, e.y1), P(e.x0, e.y0)]),
    new THREE.LineDashedMaterial({ color, dashSize: 0.4, gapSize: 0.2 }));
  border.computeLineDistances();
  border.userData.sketchLine = true;
  el.add(border);
  // grade de 1 m e preenchimento leve (não pegam clique nem recebem corte)
  const pts = [];
  const step = Math.max(1, Math.ceil(Math.max(e.x1 - e.x0, e.y1 - e.y0) / 60));
  for (let x = Math.ceil(e.x0 / step) * step; x <= e.x1 + 1e-9; x += step) pts.push(P(x, e.y0), P(x, e.y1));
  for (let y = Math.ceil(e.y0 / step) * step; y <= e.y1 + 1e-9; y += step) pts.push(P(e.x0, y), P(e.x1, y));
  const grid = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, transparent: true, opacity: active ? 0.28 : 0.14 }));
  grid.raycast = () => {};
  el.add(grid);
  const fill = new THREE.Mesh(new THREE.PlaneGeometry(e.x1 - e.x0, e.y1 - e.y0).translate((e.x0 + e.x1) / 2, (e.y0 + e.y1) / 2, 0).applyMatrix4(m),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: active ? 0.08 : 0.04, depthWrite: false, side: THREE.DoubleSide }));
  Object.assign(fill.userData, { noCap: true, isEdge: true, noHighlight: true }); // sem preenchimento de corte e sem contorno
  fill.raycast = () => {};
  fill.castShadow = false;
  el.add(fill);
  // nome na quina, com tamanho fixo no modelo
  const label = textSprite(`⌗ ${b.name}${active ? '  (ativo)' : ''}`, { color: active ? '#ff9f1c' : '#3aa0ff', size: 24 });
  const k = 0.35 / label.userData.px[1];
  label.scale.set(label.userData.px[0] * k, 0.35, 1);
  label.center.set(0, 0);
  label.position.copy(P(e.x0, e.y1));
  label.raycast = () => {};
  el.add(label);
  const w = +(e.x1 - e.x0).toFixed(3), hh = +(e.y1 - e.y0).toFixed(3);
  const n = new THREE.Vector3().setFromMatrixColumn(m, 2);
  b.props = { ...(b.props || {}), Orientacao: Math.abs(n.z) > 0.99 ? 'Horizontal' : Math.abs(n.z) < 0.01 ? 'Vertical' : 'Inclinado', Largura: w, Altura: hh,
    Origem: e.o.map(v => +v.toFixed(3)).join('; ') };
  return el;
}

export class WorkPlanes extends EventTarget {
  constructor(app) {
    super();
    this.app = app;
    this.activeId = null;
    // eixo apagado (por mim ou por outro usuário): volta ao plano do nível
    app.viewer.addEventListener('change', () => { if (this.activeId && !this.active) this.activate(null); this.scheduleFit(); });
    app.levels.addEventListener('change', () => this.scheduleFit());
  }

  scheduleFit() { clearTimeout(this._fitT); this._fitT = setTimeout(() => this.fitAll(), 250); }

  /** Caixa do modelo sem os próprios eixos de trabalho. */
  modelBox() {
    const box = new THREE.Box3();
    for (const e of this.viewer.elements()) if (!isWorkPlane(e) && e.visible && !e.userData.bim.linha) box.expandByObject(e);
    return box;
  }

  /**
   * Ajusta o retângulo dos eixos automáticos: na vertical, do nível mais baixo ao topo do mais alto; na horizontal
   * (largura), a extensão do modelo com folga. Planos inclinados ficam como estão.
   */
  fitAll() {
    const list = this.list().filter(e => e.userData.bim.eixo.auto !== false);
    if (!list.length) return;
    const lv = this.app.levels.list;
    const zMin = lv[0].elevation, zMax = lv.at(-1).elevation + this.app.levels.heightOf(lv.at(-1));
    const box = this.modelBox();
    if (box.isEmpty()) box.set(new THREE.Vector3(-5, -5, zMin), new THREE.Vector3(5, 5, zMax));
    const size = box.getSize(new THREE.Vector3());
    const m = Math.max(1, Math.max(size.x, size.y) * 0.08);
    const corners = [];
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) corners.push(new THREE.Vector3(x, y, 0));
    let changed = false;
    for (const el of list) {
      const e = el.userData.bim.eixo;
      const o = new THREE.Vector3(...e.o), u = new THREE.Vector3(...e.u).normalize(), v = new THREE.Vector3(...e.v).normalize();
      const along = vec => corners.map(c => c.clone().setZ(o.z).sub(o).dot(vec));
      let ext;
      if (Math.abs(Math.abs(v.z) - 1) < 1e-6 && Math.abs(u.z) < 1e-6) {
        // vertical: largura do modelo ao longo de u; altura dos níveis ao longo de v (Z)
        const xs = along(u), sz = Math.sign(v.z);
        const y0 = (zMin - o.z) * sz, y1 = (zMax - o.z) * sz;
        ext = { x0: Math.min(...xs) - m, x1: Math.max(...xs) + m, y0: Math.min(y0, y1), y1: Math.max(y0, y1) };
      } else if (Math.abs(u.z) < 1e-6 && Math.abs(v.z) < 1e-6) {
        // horizontal: o modelo em planta
        const xs = along(u), ys = along(v);
        ext = { x0: Math.min(...xs) - m, x1: Math.max(...xs) + m, y0: Math.min(...ys) - m, y1: Math.max(...ys) + m };
      } else continue;
      for (const k of Object.keys(ext)) ext[k] = +ext[k].toFixed(3);
      if (Object.keys(ext).every(k => Math.abs(ext[k] - e[k]) < 1e-3)) continue;
      Object.assign(e, ext);
      rebuildWorkPlane(el);
      if (this.viewer.selected.has(el)) this.viewer._highlight(el, true);
      changed = true;
    }
    if (changed) this.viewer.changed(); // sincroniza; a próxima rodada não muda nada e para
  }

  get viewer() { return this.app.viewer; }
  list() { return this.viewer.elements().filter(isWorkPlane); }
  get active() { return this.activeId ? this.list().find(e => e.userData.bim.guid === this.activeId) || null : null; }

  /** Plano do eixo no modelo (com a transformação do elemento): { o, u, v }. */
  frameOf(el) {
    el.updateMatrixWorld(true);
    const M = planeMatrix(el.userData.bim.eixo).premultiply(el.matrixWorld);
    const col = i => new THREE.Vector3().setFromMatrixColumn(M, i).normalize().toArray().map(v => +v.toFixed(9));
    return { o: new THREE.Vector3().setFromMatrixPosition(M).toArray().map(v => +v.toFixed(6)), u: col(0), v: col(1) };
  }

  /** Ativa um eixo para o desenho 2D (null = volta ao plano do nível da vista). */
  activate(el) {
    const prev = this.active;
    this.activeId = el ? el.userData.bim.guid : null;
    for (const e of this.list()) {
      const on = e === el;
      if (!!e.userData._ativo !== on || e === prev) { e.userData._ativo = on; rebuildWorkPlane(e, on); if (this.viewer.selected.has(e)) this.viewer._highlight(e, true); }
    }
    this.app.status(el ? `Eixo de trabalho ativo: ${el.userData.bim.name} — o desenho 2D acontece nele.` : 'Desenho 2D no plano do nível da vista.');
    this.dispatchEvent(new Event('change'));
  }

  /** Nomes Eixo A, Eixo B… */
  nextName() {
    const used = new Set(this.list().map(e => e.userData.bim.name));
    for (let i = 0; i < 26 * 27; i++) {
      const s = i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26));
      if (!used.has(`Eixo ${s}`)) return `Eixo ${s}`;
    }
    return `Eixo ${used.size + 1}`;
  }

  create(eixo, { name, level, activate = true } = {}) {
    const bim = { type: 'IfcGrid', name: name || this.nextName(), guid: uuid(), levelId: level?.id || null, eixo, props: level ? { Nivel: level.name } : {} };
    if (eixo.auto === undefined) eixo.auto = true;
    const el = buildWorkPlane(bim);
    this.viewer.add(el);
    if (eixo.auto) this.fitAll();
    if (activate) this.activate(el);
    this.app.refreshTree?.();
    return el;
  }

  /** Vertical passando por A → B (na cota z), com a altura dada. */
  createVertical(a, b, z, height, opts) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 0.01) { toast('Os dois pontos são iguais.', 'error'); return null; }
    const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L, 0];
    return this.create({ o: [a[0], a[1], z], u, v: [0, 0, 1], x0: 0, x1: +L.toFixed(4), y0: 0, y1: height }, opts);
  }

  /** Diálogo "Novo eixo de trabalho". */
  async openCreate() {
    const lvl = this.app.views.activeLevel() || this.app.levels.list[0];
    const box = this.viewer.modelBox();
    const size = box.isEmpty() ? 10 : Math.ceil(Math.max(4, ...box.getSize(new THREE.Vector3()).toArray().slice(0, 2)) + 2);
    const c = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
    const v = await formDialog('Novo eixo de trabalho', [
      { key: 'name', label: 'Nome', value: this.nextName() },
      { key: 'tipo', label: 'Tipo', type: 'select', value: 'clicar', options: [
        { value: 'clicar', label: 'Vertical — clicar dois pontos (planta ou 3D)' },
        { value: 'vertical', label: 'Vertical — origem e ângulo' },
        { value: 'horizontal', label: 'Horizontal — numa cota' }] },
      { key: 'z', label: `Cota da base / do plano (${unitLabel()})`, type: 'number', value: toUnit(lvl.elevation) },
      { key: 'x', label: `Origem X (${unitLabel()}) — vertical/horizontal`, type: 'number', value: toUnit(+c.x.toFixed(2)) },
      { key: 'y', label: `Origem Y (${unitLabel()})`, type: 'number', value: toUnit(+c.y.toFixed(2)) },
      { key: 'ang', label: 'Ângulo em planta (°)', type: 'number', value: 0 },
      { key: 'w', label: `Largura (${unitLabel()})`, type: 'number', value: toUnit(size) },
      { key: 'h', label: `Altura (${unitLabel()}) — vertical`, type: 'number', value: toUnit(this.app.levels.heightOf(lvl)) },
    ], { ok: 'Criar' });
    if (!v) return;
    for (const k of ['z', 'x', 'y', 'w', 'h']) v[k] = fromUnit(v[k]);
    const a = (Number(v.ang) || 0) * DEG, w = Math.max(0.1, Number(v.w) || 10), hgt = Math.max(0.1, Number(v.h) || 3);
    const u = [+Math.cos(a).toFixed(9), +Math.sin(a).toFixed(9), 0];
    const opts = { name: v.name || undefined, level: this.app.levels.forZ(Number(v.z) || 0) };
    if (v.tipo === 'clicar') {
      this._pending = { name: v.name, z: Number(v.z) || 0, h: hgt, level: lvl };
      this.app.sketchTool.start('eixo');
      return;
    }
    if (v.tipo === 'horizontal') {
      this.create({ o: [Number(v.x) || 0, Number(v.y) || 0, Number(v.z) || 0], u, v: [-u[1], u[0], 0], x0: -w / 2, x1: w / 2, y0: -w / 2, y1: w / 2 }, opts);
    } else {
      this.create({ o: [Number(v.x) || 0, Number(v.y) || 0, Number(v.z) || 0], u, v: [0, 0, 1], x0: -w / 2, x1: w / 2, y0: 0, y1: hgt }, opts);
    }
  }

  /** Segundo clique da ferramenta 'eixo' (SketchTool). */
  fromClicks(a, b) {
    const p = this._pending || { z: this.app.levels.list[0].elevation, h: 3 };
    this._pending = null;
    return this.createVertical(a, b, p.z, p.h, { name: p.name || undefined, level: p.level });
  }

  /** Câmera de frente para o eixo (na Vista 3D), para desenhar nele. */
  lookAt(el) {
    if (this.app.views.active.kind !== '3d') this.app.views.openView('3d');
    const f = this.frameOf(el), M = planeMatrix(f), e = el.userData.bim.eixo;
    const center = new THREE.Vector3((e.x0 + e.x1) / 2, (e.y0 + e.y1) / 2, 0).applyMatrix4(planeMatrix(e)).applyMatrix4(el.matrixWorld);
    const n = new THREE.Vector3().setFromMatrixColumn(M, 2);
    const v = this.viewer;
    // lado de onde a câmera já está; olhando de cima, um nadinha inclinado (a órbita trava em Z exato)
    if (n.dot(v.camera.position.clone().sub(center)) < 0) n.negate();
    if (Math.abs(n.z) > 0.999) n.set(0, -0.0001, Math.sign(n.z)).normalize();
    if (v.camera.isOrthographicCamera) { v.frameOrtho(n.toArray(), [el], 1.15); return; }
    const size = Math.max(e.x1 - e.x0, e.y1 - e.y0);
    const d = size * 0.6 / Math.tan(THREE.MathUtils.degToRad(v.camera.fov) / 2);
    v.camera.position.copy(center).addScaledVector(n, d);
    v.controls.target.copy(center);
    v.controls.update();
  }

  /** Seção do painel de propriedades de um eixo. */
  propsSection(el) {
    const on = this.active === el;
    return [
      h('h4', {}, 'Eixo de trabalho'),
      h('div', { class: 'row-buttons' },
        h('button', { class: on ? '' : 'primary', onclick: () => { this.activate(on ? null : el); this.app.renderProps(); } }, on ? 'Voltar ao plano do nível' : 'Desenhar neste eixo'),
        h('button', { onclick: () => this.lookAt(el), title: 'Vista 3D de frente para o eixo' }, 'Olhar para o eixo'),
        h('button', { onclick: () => { this.activate(el); this.app.sketchTool.start('linha'); } }, 'Linha nele')),
      h('label', { class: 'inline', title: 'O retângulo acompanha os níveis (altura) e o modelo (largura)' },
        h('input', { type: 'checkbox', checked: el.userData.bim.eixo.auto !== false, onchange: e => { el.userData.bim.eixo.auto = e.target.checked; this.fitAll(); this.viewer.changed(); } }),
        'Tamanho automático (acompanha os níveis e o modelo)'),
      h('p', { class: 'small muted' }, 'Com o eixo ativo, Linha, Retângulo, Círculo, Aparar, Estender e Canto trabalham no plano dele; Extrudar levanta na normal do eixo.'),
    ];
  }
}
