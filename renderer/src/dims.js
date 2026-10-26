// COTAS COMO OBJETO: cada cota é um elemento do projeto (IfcAnnotation, userData.bim.cota) — grava, sincroniza com a
// equipe, desfaz/refaz, apaga e entra em camadas como os outros. Desenhada em SVG por cima da vista (nítida em qualquer
// zoom), nas plantas e forros do nível dela e no 3D; tamanhos em mm de PAPEL, convertidos pela escala da vista.
//
// bim.cota = { a: [x, y, z], b: [x, y, z] (no referencial do elemento), orientacao: 'alinhada'|'horizontal'|'vertical',
//              offset (m, distância da linha de cota ao ponto a, no lado positivo da normal), estilo (id),
//              params: { … } (substituem os do estilo só nesta cota) }
// ESTILOS DE COTA (dados.estilosCota, do projeto): [{ id, nome, ...PARAMS }] — como os tipos de cota do Revit.
// Ferramenta "Cota": clique o 1º ponto, o 2º (encaixe em pontas e quinas; Shift solta o encaixe) e a posição da linha.
// Arrastar o texto de uma cota selecionada muda o afastamento.
import * as THREE from 'three';
import { h, modal, toast } from './ui.js';
import { getUnit, UNITS } from './units.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
const SNAP_PX = 12;

/** Parâmetros de uma cota (todos configuráveis no estilo e em cada cota). */
export const PARAMS = {
  textoAltura: { label: 'Altura do texto (mm)', type: 'number', min: 0.5, max: 20, step: 0.1, def: 2.5 },
  textoCor: { label: 'Cor do texto', type: 'color', def: '#1f2328' },
  textoPosicao: { label: 'Posição do texto', type: 'select', options: { acima: 'Acima da linha', centro: 'Sobre a linha', abaixo: 'Abaixo da linha' }, def: 'acima' },
  textoFundo: { label: 'Fundo atrás do texto', type: 'bool', def: true },
  unidade: { label: 'Unidade', type: 'select', options: { projeto: 'A do projeto', m: 'metros', cm: 'centímetros', mm: 'milímetros' }, def: 'projeto' },
  casas: { label: 'Casas decimais', type: 'number', min: 0, max: 4, step: 1, def: 2 },
  mostrarUnidade: { label: 'Mostrar a unidade', type: 'bool', def: false },
  prefixo: { label: 'Prefixo', type: 'text', def: '' },
  sufixo: { label: 'Sufixo', type: 'text', def: '' },
  marca: { label: 'Marca', type: 'select', options: { traco: 'Traço 45°', seta: 'Seta', ponto: 'Ponto', nenhuma: 'Nenhuma' }, def: 'traco' },
  marcaTamanho: { label: 'Tamanho da marca (mm)', type: 'number', min: 0.5, max: 10, step: 0.1, def: 2 },
  linhaCor: { label: 'Cor da linha', type: 'color', def: '#3a3f46' },
  linhaPeso: { label: 'Peso da linha (mm)', type: 'number', min: 0.05, max: 1, step: 0.01, def: 0.18 },
  chamadaAfastamento: { label: 'Afastamento da chamada (mm)', type: 'number', min: 0, max: 20, step: 0.1, def: 1.5 },
  chamadaAlem: { label: 'Chamada além da linha (mm)', type: 'number', min: 0, max: 20, step: 0.1, def: 2 },
};
const DEFAULT_STYLE = { id: 'padrao', nome: 'Padrão BoxBim', ...Object.fromEntries(Object.entries(PARAMS).map(([k, p]) => [k, p.def])) };
const ORIENT = { alinhada: 'Alinhada (aos pontos)', horizontal: 'Horizontal', vertical: 'Vertical' };

export const isDimension = el => !!el?.userData?.bim?.cota;

/** Cria o elemento de uma cota (o desenho é do overlay; uma malha invisível dá o tamanho para mover/enquadrar). */
export function buildDimension(bim) {
  const g = new THREE.Group();
  g.name = bim.name || 'Cota';
  g.userData.bim = bim;
  refreshHelper(g);
  return g;
}

/** Malha invisível (quadrilátero a, b, B', A') — refeita quando a cota muda. */
function refreshHelper(g) {
  const c = g.userData.bim.cota, sig = JSON.stringify(c);
  if (g.userData._sig === sig) return;
  g.userData._sig = sig;
  const old = g.userData.helper;
  if (old) { g.remove(old); old.geometry.dispose(); }
  const G = Dimensions.prototype.geom(c, null);
  const pts = [G.a, G.b, G.B, G.a, G.B, G.A];
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ visible: false }));
  m.visible = false;
  Object.assign(m.userData, { noCap: true, noHighlight: true, dimHelper: true });
  m.raycast = () => {};
  g.add(m);
  g.userData.helper = m;
}

export class Dimensions {
  constructor(app) {
    this.app = app;
    this.styles = [structuredClone(DEFAULT_STYLE)];
    this.svg = svg('svg', { class: 'dims-svg' });
    this.box = h('div', { class: 'dims-layer' }, this.svg);
    document.querySelector('.center').append(this.box);
    this.nodes = new Map(); // uuid da cota → { g, path, bg, text }
    app.viewer.frameHooks.push(() => this.update());
  }

  // ------------------------------------------------------------ estilos

  load(list) {
    const ok = (Array.isArray(list) ? list : []).filter(s => s?.id).map(s => ({ ...DEFAULT_STYLE, ...s }));
    this.styles = ok.length ? ok : [structuredClone(DEFAULT_STYLE)];
  }

  saveStyles() { this.app.project?.send({ t: 'projeto', dados: { estilosCota: this.styles } }); }
  style(id) { return this.styles.find(s => s.id === id) || this.styles[0]; }
  paramsOf(el) { const c = el.userData.bim.cota; return { ...this.style(c.estilo), ...(c.params || {}) }; }

  // ------------------------------------------------------------ geometria

  /** Pontos da cota no mundo: a, b, A', B' (linha de cota), d (direção), n (normal), valor medido. */
  geom(c, matrix) {
    const a = new THREE.Vector3(...c.a), b = new THREE.Vector3(...c.b);
    if (matrix) { a.applyMatrix4(matrix); b.applyMatrix4(matrix); }
    let d;
    if (c.orientacao === 'horizontal') d = new THREE.Vector3(1, 0, 0);
    else if (c.orientacao === 'vertical') d = new THREE.Vector3(0, 1, 0);
    else { d = b.clone().sub(a).setZ(0); if (d.lengthSq() < 1e-12) d.set(1, 0, 0); d.normalize(); }
    const n = new THREE.Vector3(-d.y, d.x, 0);
    const lineAt = n.dot(a) + (c.offset || 0); // a linha de cota fica em n·p = lineAt
    const A = a.clone().addScaledVector(n, lineAt - n.dot(a));
    const B = b.clone().addScaledVector(n, lineAt - n.dot(b));
    A.z = B.z = a.z;
    const value = Math.abs(B.clone().sub(A).dot(d));
    return { a, b, A, B, d, n, value };
  }

  text(p, value) {
    const u = p.unidade === 'projeto' ? getUnit() : p.unidade;
    const f = UNITS[u]?.f ?? 1;
    const num = (value * f).toFixed(Math.max(0, Math.min(4, p.casas | 0))).replace('.', ',');
    return `${p.prefixo || ''}${num}${p.mostrarUnidade ? ` ${UNITS[u]?.label || u}` : ''}${p.sufixo || ''}`;
  }

  // ------------------------------------------------------------ desenho (a cada quadro)

  visibleIn(el, view) {
    if (!el.visible && !this.app.viewer.revealHidden) return false;
    if (view.kind === '3d') return true;
    if (view.kind !== 'plan' && view.kind !== 'ceiling') return false;
    const lv = el.userData.bim.levelId;
    return !lv || lv === view.levelId;
  }

  update() {
    const app = this.app, v = app.viewer, view = app.views.active;
    const els = v.renderOverride ? [] : v.elements().filter(e => isDimension(e) && this.visibleIn(e, view));
    const keep = new Set(els.map(e => e.uuid));
    for (const [id, n] of this.nodes) if (!keep.has(id)) { n.g.remove(); this.nodes.delete(id); }
    if (this.preview) els.push(this.preview);
    if (!els.length) { this.box.hidden = true; return; }
    this.box.hidden = false;
    const c = v.renderer.domElement.getBoundingClientRect(), pr = this.box.getBoundingClientRect();
    const scr = p => { const q = p.clone().project(v.camera); return { x: (q.x + 1) / 2 * c.width + c.left - pr.left, y: (1 - q.y) / 2 * c.height + c.top - pr.top, z: q.z }; };
    const mm = x => app.drawing.mmToPx(x);
    for (const el of els) {
      const id = el.uuid || 'preview';
      let n = this.nodes.get(id);
      if (!n) {
        n = { g: svg('g', { class: 'dim' }), path: svg('path', { fill: 'none' }), heads: svg('path', {}), bg: svg('rect', { rx: 2 }), text: svg('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central' }) };
        n.g.append(n.path, n.heads, n.bg, n.text);
        n.g.dataset.id = id;
        if (el.uuid) {
          n.g.addEventListener('pointerdown', e => this.onPointer(e, el));
          n.g.addEventListener('dblclick', e => { e.stopPropagation(); this.app.viewer.select([el]); });
        }
        this.svg.append(n.g);
        this.nodes.set(id, n);
      }
      if (el.uuid) refreshHelper(el);
      el.updateMatrixWorld?.();
      const bim = el.userData.bim, p = el.uuid ? this.paramsOf(el) : { ...this.style(bim.cota.estilo) };
      const G = this.geom(bim.cota, el.uuid ? el.matrixWorld : null);
      const a = scr(G.a), b = scr(G.b), A = scr(G.A), B = scr(G.B);
      if ([a, b, A, B].some(q => q.z > 1)) { n.g.style.display = 'none'; continue; }
      n.g.style.display = '';
      const L = Math.hypot(B.x - A.x, B.y - A.y) || 1;
      const ux = (B.x - A.x) / L, uy = (B.y - A.y) / L;
      // normal na tela: do ponto medido para a linha de cota
      let nx = A.x - a.x, ny = A.y - a.y;
      const nl = Math.hypot(nx, ny);
      if (nl < 0.5) { nx = -uy; ny = ux; } else { nx /= nl; ny /= nl; }
      const gap = mm(p.chamadaAfastamento), beyond = mm(p.chamadaAlem);
      const ext = (from, to) => {
        const len = Math.hypot(to.x - from.x, to.y - from.y);
        if (len < 0.5) return '';
        const s = Math.min(gap, len), ex = to.x + nx * beyond, ey = to.y + ny * beyond;
        return `M${from.x + nx * s} ${from.y + ny * s}L${ex} ${ey}`;
      };
      n.path.setAttribute('d', `M${A.x} ${A.y}L${B.x} ${B.y}${ext(a, A)}${ext(b, B)}`);
      const sel = el.uuid && v.selected.has(el);
      const lc = sel ? '#2f9bff' : p.linhaCor;
      n.path.setAttribute('stroke', lc);
      n.path.setAttribute('stroke-width', Math.max(1, mm(p.linhaPeso)));
      // marcas nas pontas
      const m = Math.max(3, mm(p.marcaTamanho));
      let hd = '';
      for (const [P, s] of [[A, 1], [B, -1]]) {
        if (p.marca === 'traco') { const tx = (ux + nx) * 0.7071 * m * 0.5, ty = (uy + ny) * 0.7071 * m * 0.5; hd += `M${P.x - tx} ${P.y - ty}L${P.x + tx} ${P.y + ty}`; }
        else if (p.marca === 'seta') { const bx = P.x + ux * s * m, by = P.y + uy * s * m; hd += `M${P.x} ${P.y}L${bx + nx * m * 0.3} ${by + ny * m * 0.3}L${bx - nx * m * 0.3} ${by - ny * m * 0.3}Z`; }
        else if (p.marca === 'ponto') { const r = m * 0.28; hd += `M${P.x - r} ${P.y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`; }
      }
      n.heads.setAttribute('d', hd);
      n.heads.setAttribute('stroke', lc);
      n.heads.setAttribute('stroke-width', Math.max(1, mm(p.linhaPeso) * (p.marca === 'traco' ? 2 : 1)));
      n.heads.setAttribute('fill', p.marca === 'traco' ? 'none' : lc);
      // texto (paralelo à linha, sempre de pé)
      const fs = mm(p.textoAltura);
      const label = bim.cota.texto ? bim.cota.texto : this.text(p, G.value);
      n.text.textContent = label;
      n.text.setAttribute('font-size', Math.max(1, fs));
      n.text.setAttribute('fill', sel ? '#2f9bff' : p.textoCor);
      n.text.style.display = fs < 4 ? 'none' : '';
      let ang = Math.atan2(uy, ux) * 180 / Math.PI;
      if (ang > 90) ang -= 180; else if (ang < -90) ang += 180;
      const side = p.textoPosicao === 'centro' ? 0 : (p.textoPosicao === 'abaixo' ? -1 : 1) * (fs * 0.75 + 1);
      // "acima" = para o lado de fora (do objeto para a linha de cota)
      const mx = (A.x + B.x) / 2 + nx * side, my = (A.y + B.y) / 2 + ny * side;
      n.text.setAttribute('x', mx); n.text.setAttribute('y', my);
      n.text.setAttribute('transform', `rotate(${ang} ${mx} ${my})`);
      const tw = label.length * fs * 0.56 + 4, th = fs * 1.15;
      const showBg = (p.textoFundo || p.textoPosicao === 'centro') && fs >= 4;
      n.bg.style.display = showBg ? '' : 'none';
      Object.entries({ x: mx - tw / 2, y: my - th / 2, width: tw, height: th, transform: `rotate(${ang} ${mx} ${my})` }).forEach(([k, val]) => n.bg.setAttribute(k, val));
      n.g.classList.toggle('sel', !!sel);
      n.g.classList.toggle('preview', !el.uuid);
    }
  }

  // ------------------------------------------------------------ selecionar / arrastar o texto

  onPointer(e, el) {
    if (e.button !== 0 || this.tool) return;
    e.preventDefault(); e.stopPropagation();
    const v = this.app.viewer;
    if (!v.selected.has(el)) { v.select([el], e.ctrlKey || e.shiftKey); return; }
    // já selecionada: arrastar muda o afastamento da linha de cota
    const c = el.userData.bim.cota, z = new THREE.Vector3(...c.a).applyMatrix4(el.matrixWorld).z;
    const G0 = this.geom(c, el.matrixWorld);
    const p0 = this.ground(e.clientX, e.clientY, z);
    if (!p0) return;
    const start = c.offset || 0, k0 = G0.n.dot(p0);
    const move = ev => {
      const p = this.ground(ev.clientX, ev.clientY, z);
      if (!p) return;
      c.offset = +(start + (G0.n.dot(p) - k0)).toFixed(4);
    };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); if ((c.offset || 0) !== start) { v.changed(); this.app.renderProps(); } };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  }

  /** Ponto do plano horizontal z sob o cursor. */
  ground(x, y, z) {
    const v = this.app.viewer, r = v.renderer.domElement.getBoundingClientRect();
    v.raycaster.setFromCamera({ x: ((x - r.left) / r.width) * 2 - 1, y: -((y - r.top) / r.height) * 2 + 1 }, v.camera);
    const ray = v.raycaster.ray;
    if (Math.abs(ray.direction.z) < 1e-9) return null;
    return ray.origin.clone().addScaledVector(ray.direction, (z - ray.origin.z) / ray.direction.z);
  }

  // ------------------------------------------------------------ ferramenta Cota

  start() {
    const app = this.app, v = app.viewer, view = app.views.active;
    if (view.kind !== 'plan' && view.kind !== 'ceiling') { toast('Abra uma planta para cotar.', 'error'); return; }
    this.stop();
    const lvl = app.views.activeLevel();
    this.tool = { pts: [], z: (lvl?.elevation ?? 0) + 0.01, level: lvl, orient: this._orient || 'alinhada', estilo: this._estilo || this.styles[0].id };
    v.tool = this;
    // esquerdo clica os pontos (não arrasta a vista); o do meio continua arrastando
    const ctl = v.controls;
    this._saved = { ctl, buttons: { ...ctl.mouseButtons } };
    ctl.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: null };
    const el = v.renderer.domElement;
    this._h = {
      move: e => this.toolMove(e),
      down: e => { if (e.button === 0) this.toolClick(e); else if (e.button === 2) this.stop(); },
      key: e => { if (e.key === 'Escape') this.stop(); },
    };
    el.addEventListener('pointermove', this._h.move);
    el.addEventListener('pointerdown', this._h.down);
    addEventListener('keydown', this._h.key);
    this.marker = h('div', { class: 'snap-marker', hidden: true });
    document.querySelector('.center').append(this.marker);
    const orient = h('select', { onchange: e => { this.tool.orient = this._orient = e.target.value; } }, Object.entries(ORIENT).map(([k, l]) => h('option', { value: k, selected: k === this.tool.orient }, l)));
    const est = h('select', { onchange: e => { this.tool.estilo = this._estilo = e.target.value; } }, this.styles.map(s => h('option', { value: s.id, selected: s.id === this.tool.estilo }, s.nome)));
    this.bar = h('div', { class: 'draw-bar' }, h('strong', {}, '⟷ Cota'), h('label', {}, 'Orientação ', orient), h('label', {}, 'Estilo ', est),
      h('button', { class: 'mini', onclick: () => this.stylesDialog() }, 'Estilos…'),
      h('span', { class: 'muted' }, '1º ponto · 2º ponto · posição da linha — Shift solta o encaixe · Esc sai'),
      h('button', { onclick: () => this.stop() }, 'Sair'));
    document.querySelector('.center').append(this.bar);
    app.status('Cota: clique o primeiro ponto.');
  }

  stop() {
    if (!this.tool) return;
    const v = this.app.viewer, el = v.renderer.domElement;
    el.removeEventListener('pointermove', this._h.move);
    el.removeEventListener('pointerdown', this._h.down);
    removeEventListener('keydown', this._h.key);
    this.bar?.remove(); this.marker?.remove();
    if (this._saved) { this._saved.ctl.mouseButtons = this._saved.buttons; this._saved = null; }
    if (v.tool === this) v.tool = null;
    this.tool = null;
    this.preview = null;
    this.app.status('Pronto.');
  }

  /** Pontos de encaixe da planta: pontas e quinas de paredes/vigas/linhas e cantos das caixas das peças do nível. */
  snapPoints() {
    const v = this.app.viewer, z = this.tool.z, out = [];
    for (const el of v.elements()) {
      if (!el.visible || isDimension(el) || el.userData.bim.eixo) continue;
      const b = el.userData.bim;
      el.updateMatrixWorld(true);
      const d = b.wall || b.beam;
      if (d) {
        const A = new THREE.Vector3(d.start[0], d.start[1], 0).applyMatrix4(el.matrixWorld), B = new THREE.Vector3(d.end[0], d.end[1], 0).applyMatrix4(el.matrixWorld);
        const dir = B.clone().sub(A).setZ(0).normalize(), nn = new THREE.Vector3(-dir.y, dir.x, 0), t = (b.wall ? d.thickness : d.width) / 2;
        for (const P of [A, B]) for (const s of [-1, 0, 1]) out.push(P.clone().addScaledVector(nn, s * t).setZ(z));
        // e os cantos da caixa (quina externa das junções em meia-esquadria)
      }
      const box = new THREE.Box3().setFromObject(el);
      if (box.isEmpty() || box.min.z > z + 3 || box.max.z < z - 3) continue;
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) out.push(new THREE.Vector3(x, y, z));
    }
    return out;
  }

  pick(e) {
    let p = this.ground(e.clientX, e.clientY, this.tool.z);
    if (!p) return null;
    this.marker.hidden = true;
    if (!e.shiftKey) {
      this.tool.snaps ||= this.snapPoints();
      const v = this.app.viewer, r = v.renderer.domElement.getBoundingClientRect();
      let best = null, bd = SNAP_PX;
      for (const s of this.tool.snaps) {
        const q = s.clone().project(v.camera), sx = (q.x + 1) / 2 * r.width + r.left, sy = (1 - q.y) / 2 * r.height + r.top;
        const d = Math.hypot(sx - e.clientX, sy - e.clientY);
        if (d < bd) { bd = d; best = { s, sx, sy }; }
      }
      if (best) {
        p = best.s.clone();
        const pr = this.marker.parentElement.getBoundingClientRect();
        Object.assign(this.marker.style, { left: `${best.sx - pr.left}px`, top: `${best.sy - pr.top}px` });
        this.marker.hidden = false;
      } else { p.x = Math.round(p.x * 100) / 100; p.y = Math.round(p.y * 100) / 100; }
    }
    return p;
  }

  toolMove(e) {
    const t = this.tool;
    const p = this.pick(e);
    if (!p || !t.pts.length) { this.preview = null; return; }
    const a = t.pts[0], b = t.pts[1] || p;
    const cota = { a: a.toArray(), b: b.toArray(), orientacao: t.orient, offset: 0, estilo: t.estilo };
    if (t.pts.length === 2) {
      const G = this.geom({ ...cota, offset: 0 });
      cota.offset = +(G.n.dot(p) - G.n.dot(a)).toFixed(4);
    }
    this.preview = { userData: { bim: { cota } } };
  }

  toolClick(e) {
    e.preventDefault(); e.stopPropagation();
    const t = this.tool, p = this.pick(e);
    if (!p) return;
    if (t.pts.length < 2) {
      t.pts.push(p);
      this.app.status(t.pts.length === 1 ? 'Cota: clique o segundo ponto.' : 'Cota: clique onde fica a linha de cota.');
      return;
    }
    const cota = this.preview?.userData.bim.cota;
    if (!cota) return;
    this.create(cota, t.level);
    t.pts = [];
    t.snaps = null;
    this.preview = null;
    this.app.status('Cota criada. Clique o primeiro ponto da próxima (Esc sai).');
  }

  create(cota, level) {
    const app = this.app;
    const bim = {
      type: 'IfcAnnotation', name: 'Cota', guid: crypto.randomUUID(), levelId: level?.id || null,
      cota: { a: cota.a, b: cota.b, orientacao: cota.orientacao || 'alinhada', offset: cota.offset || 0, estilo: cota.estilo || this.styles[0].id, params: {} },
      props: level ? { Nivel: level.name } : {},
    };
    const el = buildDimension(bim);
    app.viewer.add(el);
    app.viewer.changed();
    app.refreshTree?.();
    return el;
  }

  // ------------------------------------------------------------ propriedades e estilos

  /** Seção do painel Propriedades para uma cota: orientação, afastamento, estilo e todos os parâmetros. */
  propsSection(el) {
    const app = this.app, c = el.userData.bim.cota, st = this.style(c.estilo), p = this.paramsOf(el);
    const commit = () => { app.viewer.changed(); app.renderProps(); };
    const rows = [];
    const row = (label, input, extra) => h('tr', {}, h('td', {}, label), h('td', {}, input, extra || null));
    rows.push(row('Medida', h('strong', {}, this.text(p, this.geom(c, el.matrixWorld).value))));
    rows.push(row('Estilo', h('select', { onchange: e => { c.estilo = e.target.value; commit(); } }, this.styles.map(s => h('option', { value: s.id, selected: s.id === c.estilo }, s.nome))),
      h('button', { class: 'mini', style: 'margin-left:4px', onclick: () => this.stylesDialog(c.estilo) }, 'Estilos…')));
    rows.push(row('Orientação', h('select', { onchange: e => { c.orientacao = e.target.value; commit(); } }, Object.entries(ORIENT).map(([k, l]) => h('option', { value: k, selected: k === c.orientacao }, l)))));
    rows.push(row('Afastamento (m)', h('input', { type: 'number', step: 0.05, value: c.offset || 0, onchange: e => { c.offset = Number(e.target.value) || 0; commit(); } })));
    rows.push(row('Texto substituto', h('input', { value: c.texto || '', placeholder: 'vazio = a medida', onchange: e => { c.texto = e.target.value.trim(); if (!c.texto) delete c.texto; commit(); } })));
    const params = Object.entries(PARAMS).map(([k, d]) => {
      const own = c.params && k in c.params;
      const set = val => { c.params = { ...(c.params || {}), [k]: val }; commit(); };
      const reset = own ? h('button', { class: 'mini', title: 'Voltar ao valor do estilo', style: 'margin-left:4px', onclick: () => { delete c.params[k]; commit(); } }, '↺') : null;
      return row(h('span', { class: own ? 'own' : '' }, d.label), this.input(d, p[k], set), reset);
    });
    return [
      h('h4', {}, 'Cota'),
      h('table', {}, rows),
      h('h4', {}, `Parâmetros (estilo "${st.nome}"; em negrito, mudados só nesta cota)`),
      h('table', { class: 'dim-params' }, params),
      h('button', { class: 'mini', style: 'margin-top:6px', onclick: () => this.saveAsStyle(el) }, 'Salvar como novo estilo…'),
    ];
  }

  input(d, value, set) {
    if (d.type === 'select') return h('select', { onchange: e => set(e.target.value) }, Object.entries(d.options).map(([k, l]) => h('option', { value: k, selected: k === value }, l)));
    if (d.type === 'bool') return h('input', { type: 'checkbox', checked: !!value, onchange: e => set(e.target.checked) });
    if (d.type === 'color') return h('input', { type: 'color', value, oninput: e => set(e.target.value) });
    if (d.type === 'text') return h('input', { value, onchange: e => set(e.target.value) });
    return h('input', { type: 'number', min: d.min, max: d.max, step: d.step, value, onchange: e => set(Math.min(d.max, Math.max(d.min, Number(e.target.value) || d.def))) });
  }

  saveAsStyle(el) {
    const p = this.paramsOf(el);
    const nome = `Estilo ${this.styles.length + 1}`;
    const st = { ...p, id: `s${Date.now().toString(36)}`, nome };
    delete st.estilo;
    this.styles.push(st);
    const c = el.userData.bim.cota;
    c.estilo = st.id; c.params = {};
    this.saveStyles();
    this.app.viewer.changed();
    this.app.renderProps();
    toast(`Estilo "${nome}" criado — renomeie em Estilos…`);
  }

  /** Estilos de cota do projeto: criar, duplicar, renomear, apagar e mudar todos os parâmetros. */
  stylesDialog(startId) {
    const work = structuredClone(this.styles);
    let cur = work.find(s => s.id === startId) || work[0];
    const list = h('div', { class: 'me-list' }), form = h('div', { class: 'me-controls' });
    const render = () => {
      list.replaceChildren(...work.map(s => h('div', { class: `me-item${s === cur ? ' active' : ''}`, onclick: () => { cur = s; render(); } }, '⟷ ', s.nome)),
        h('div', { class: 'me-new' },
          h('button', { class: 'mini', onclick: () => { const n = { ...structuredClone(cur), id: `s${Date.now().toString(36)}`, nome: `${cur.nome} (cópia)` }; work.push(n); cur = n; render(); } }, 'Duplicar'),
          h('button', { class: 'mini danger', disabled: work.length <= 1, onclick: () => { const i = work.indexOf(cur); work.splice(i, 1); cur = work[0]; render(); } }, 'Apagar')));
      form.replaceChildren(
        h('label', { class: 'me-row' }, h('span', {}, 'Nome'), h('input', { value: cur.nome, oninput: e => { cur.nome = e.target.value; } }), h('span')),
        ...Object.entries(PARAMS).map(([k, d]) => h('label', { class: 'me-row' }, h('span', {}, d.label), this.input(d, cur[k], val => { cur[k] = val; }), h('span'))));
    };
    render();
    const dlg = modal({
      title: 'Estilos de cota',
      body: h('div', { class: 'mat-editor dim-styles' }, list, form),
      actions: [{ label: 'Cancelar' }, { label: 'Salvar', class: 'primary', action: () => {
        // cotas com estilo apagado passam para o primeiro
        const ids = new Set(work.map(s => s.id));
        for (const el of this.app.viewer.elements()) if (isDimension(el) && !ids.has(el.userData.bim.cota.estilo)) el.userData.bim.cota.estilo = work[0].id;
        this.styles = work;
        this.saveStyles();
        this.app.viewer.changed();
        this.app.renderProps();
        toast('Estilos de cota salvos no projeto.');
      } }],
    });
    dlg.el.classList.add('wide');
  }
}

