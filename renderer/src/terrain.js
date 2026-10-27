// TERRENO (topografia): superfície triangulada (Delaunay) a partir de pontos com cota, fechada num bloco de terra
// (saias e fundo) para o corte das plantas, com as CURVAS DE NÍVEL desenhadas sobre ela (mestra a cada 5).
//
// bim.terreno = { pontos: [[x, y, z], …] (modelo), espessura (m abaixo do ponto mais baixo), intervalo (m entre
//                 curvas), material (nome na biblioteca; padrão "Terreno") }
// Três formas de criar (Modelar › Terreno):
//   1. PONTOS na planta — clique cada ponto com a cota da barra (digite a cota antes de clicar); Enter cria.
//   2. CURVAS DE NÍVEL — selecione linhas (desenhadas ou importadas de DXF): as que se encostam viram uma curva;
//      cada curva ganha a sua cota (a altura da própria linha, se ela já tem, ou a digitada); amostra a cada "passo".
//   3. LISTA de pontos — cole "x y z" por linha (levantamento topográfico, planilha; separador espaço, ; ou tab).
import * as THREE from 'three';
import { h, modal, toast } from './ui.js';
import { materialFor, libraryMaterial } from './elements.js';
import { fmtLen } from './units.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };

export const isTerrain = el => !!el?.userData?.bim?.terreno;

// ---------------------------------------------------------------- triangulação (Bowyer–Watson)

/** Triângulos [i, j, k] (índices de pts) da triangulação de Delaunay em XY. */
export function delaunay(pts) {
  const n = pts.length;
  if (n < 3) return [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  const d = Math.max(maxX - minX, maxY - minY) || 1, mx = (minX + maxX) / 2, my = (minY + maxY) / 2;
  const P = pts.map(p => [p[0], p[1]]).concat([[mx - 20 * d, my - d], [mx, my + 20 * d], [mx + 20 * d, my - d]]);
  const circ = (a, b, c) => {
    const [ax, ay] = P[a], [bx, by] = P[b], [cx, cy] = P[c];
    const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(D) < 1e-12) return { x: 0, y: 0, r2: Infinity };
    const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / D;
    const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / D;
    return { x: ux, y: uy, r2: (ax - ux) ** 2 + (ay - uy) ** 2 };
  };
  let tris = [{ v: [n, n + 1, n + 2], c: circ(n, n + 1, n + 2) }];
  for (let i = 0; i < n; i++) {
    const [px, py] = P[i];
    const bad = [], keep = [];
    for (const t of tris) ((px - t.c.x) ** 2 + (py - t.c.y) ** 2 < t.c.r2 * (1 + 1e-12) ? bad : keep).push(t);
    // borda do "buraco": arestas que aparecem uma vez só entre os triângulos ruins
    const count = new Map();
    for (const t of bad) for (let e = 0; e < 3; e++) {
      const a = t.v[e], b = t.v[(e + 1) % 3], k = a < b ? `${a},${b}` : `${b},${a}`;
      count.set(k, (count.get(k) || 0) + 1);
    }
    tris = keep;
    for (const t of bad) for (let e = 0; e < 3; e++) {
      const a = t.v[e], b = t.v[(e + 1) % 3], k = a < b ? `${a},${b}` : `${b},${a}`;
      if (count.get(k) === 1) tris.push({ v: [a, b, i], c: circ(a, b, i) });
    }
  }
  return tris.filter(t => t.v.every(v => v < n)).map(t => {
    const [a, b, c] = t.v;
    // sentido anti-horário visto de cima (normal para +Z)
    const cross = (P[b][0] - P[a][0]) * (P[c][1] - P[a][1]) - (P[b][1] - P[a][1]) * (P[c][0] - P[a][0]);
    return cross >= 0 ? [a, b, c] : [a, c, b];
  });
}

/** Tira pontos repetidos (mesmo XY a menos de 1 cm; fica a média das cotas). */
function dedupe(pts) {
  const map = new Map();
  for (const p of pts) {
    const k = `${Math.round(p[0] * 100)},${Math.round(p[1] * 100)}`;
    const cur = map.get(k);
    if (cur) { cur[2] = (cur[2] * cur.n + p[2]) / (cur.n + 1); cur.n++; } else map.set(k, Object.assign([p[0], p[1], p[2]], { n: 1 }));
  }
  return [...map.values()].map(p => [p[0], p[1], p[2]]);
}

// ---------------------------------------------------------------- elemento

/** Grupo do terreno (bloco de terra + curvas de nível). */
export function buildTerrain(bim) {
  const g = new THREE.Group();
  g.name = bim.name || 'Terreno';
  g.userData.bim = bim;
  rebuildTerrain(g);
  return g;
}

export function rebuildTerrain(g) {
  for (const c of [...g.children]) { g.remove(c); c.geometry?.dispose?.(); }
  delete g.userData.edges;
  const t = g.userData.bim.terreno;
  const pts = dedupe(t.pontos || []);
  const tris = delaunay(pts);
  if (!tris.length) return g;
  const zMin = Math.min(...pts.map(p => p[2])), zMax = Math.max(...pts.map(p => p[2]));
  const base = zMin - Math.max(0.05, Number(t.espessura) || 1);
  // superfície + fundo + saias nas bordas (arestas de um triângulo só)
  const pos = [];
  const push = (...ps) => ps.forEach(p => pos.push(p[0], p[1], p[2]));
  for (const [a, b, c] of tris) push(pts[a], pts[b], pts[c]);
  for (const [a, b, c] of tris) push([pts[a][0], pts[a][1], base], [pts[c][0], pts[c][1], base], [pts[b][0], pts[b][1], base]);
  const edges = new Map();
  for (const [a, b, c] of tris) for (const [p, q] of [[a, b], [b, c], [c, a]]) {
    const k = p < q ? `${p},${q}` : `${q},${p}`;
    edges.set(k, edges.has(k) ? null : [p, q]);
  }
  for (const e of edges.values()) {
    if (!e) continue;
    const [p, q] = e, A = pts[p], B = pts[q];
    push(A, [A[0], A[1], base], [B[0], B[1], base], A, [B[0], B[1], base], B);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, libraryMaterial(t.material || 'Terreno') || materialFor(0x7a8f55));
  mesh.name = 'Terreno';
  g.add(mesh);
  // curvas de nível na superfície (mestra a cada 5 intervalos)
  const I = Math.max(0.05, Number(t.intervalo) || 1);
  const minor = [], major = [];
  for (let k = Math.ceil(zMin / I); k * I <= zMax + 1e-9; k++) {
    const z = k * I, out = Math.round(k) % 5 === 0 ? major : minor;
    for (const [a, b, c] of tris) {
      const P = [pts[a], pts[b], pts[c]], dz = P.map(p => p[2] - z);
      const seg = [];
      for (let e = 0; e < 3; e++) {
        const p = P[e], q = P[(e + 1) % 3], dp = dz[e], dq = dz[(e + 1) % 3];
        if ((dp < 0 && dq >= 0) || (dp >= 0 && dq < 0)) { const s = dp / (dp - dq); seg.push(p[0] + (q[0] - p[0]) * s, p[1] + (q[1] - p[1]) * s, z + 0.01); }
      }
      if (seg.length === 6) out.push(...seg);
    }
  }
  const lines = (arr, color, name) => {
    if (!arr.length) return;
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    const l = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color }));
    l.name = name;
    l.userData.contour = true;
    l.raycast = () => {};
    g.add(l);
  };
  lines(minor, 0x6d5a3e, 'Curvas de nível');
  lines(major, 0x3b2d1c, 'Curvas mestras');
  g.userData.bim.props = { ...(g.userData.bim.props || {}), Pontos: pts.length, Triângulos: tris.length, 'Cota mínima': +zMin.toFixed(3), 'Cota máxima': +zMax.toFixed(3) };
  return g;
}

export function createTerrain(app, pontos, { nome = 'Terreno', espessura = 1, intervalo = 1, level = null } = {}) {
  const pts = dedupe(pontos.filter(p => p.every(Number.isFinite)));
  if (pts.length < 3) { toast('O terreno precisa de pelo menos 3 pontos (não alinhados).', 'error'); return null; }
  if (!delaunay(pts).length) { toast('Os pontos estão todos alinhados: não formam uma superfície.', 'error'); return null; }
  const bim = { type: 'IfcGeographicElement', name: nome, guid: crypto.randomUUID(), levelId: level?.id || null, terreno: { pontos: pts.map(p => p.map(v => +v.toFixed(4))), espessura, intervalo, material: 'Terreno' }, props: {} };
  const el = buildTerrain(bim);
  app.viewer.add(el);
  app.viewer._prepare2D?.(el);
  app.viewer.changed();
  app.refreshTree?.();
  app.status(`Terreno criado: ${pts.length} pontos, curvas de ${fmtLen(intervalo, { suffix: true })} em ${fmtLen(intervalo, { suffix: true })}.`);
  return el;
}

// ---------------------------------------------------------------- linhas → curvas de nível

/** Segmentos em mundo das linhas de um elemento (linhas desenhadas, DXF…). */
function segmentsOf(el) {
  const segs = [];
  el.updateMatrixWorld(true);
  el.traverse(o => {
    if (!(o.isLine || o.isLineSegments) || o.userData.isEdge || o.userData.contour || !o.geometry?.attributes?.position) return;
    const p = o.geometry.attributes.position, m = o.matrixWorld, v = i => new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(m);
    if (o.isLineSegments) for (let i = 0; i + 1 < p.count; i += 2) segs.push([v(i), v(i + 1)]);
    else for (let i = 0; i + 1 < p.count; i++) segs.push([v(i), v(i + 1)]);
  });
  // traçado de exibição (tracejado/espesso) das linhas 2D duplica o desenho: fica um só
  const seen = new Set();
  return segs.filter(([a, b]) => { const k = [a, b].map(q => `${q.x.toFixed(3)},${q.y.toFixed(3)}`).sort().join('|'); if (seen.has(k)) return false; seen.add(k); return true; });
}

/** Junta segmentos que se encostam (1 cm) em cadeias — cada cadeia é uma curva de nível. */
function chains(segs) {
  const out = [], used = new Array(segs.length).fill(false), near = (a, b) => a.distanceTo(b) < 0.01;
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const pts = [segs[i][0].clone(), segs[i][1].clone()];
    let grew = true;
    while (grew) {
      grew = false;
      for (let j = 0; j < segs.length; j++) {
        if (used[j]) continue;
        const [a, b] = segs[j], head = pts[0], tail = pts[pts.length - 1];
        if (near(a, tail)) pts.push(b.clone()); else if (near(b, tail)) pts.push(a.clone());
        else if (near(a, head)) pts.unshift(b.clone()); else if (near(b, head)) pts.unshift(a.clone());
        else continue;
        used[j] = true; grew = true;
      }
    }
    out.push(pts);
  }
  return out;
}

const lengthOf = pts => pts.slice(1).reduce((s, p, i) => s + p.distanceTo(pts[i]), 0);

/** Pontos ao longo da cadeia a cada "passo" (e os vértices), na cota z. */
function sample(pts, step, z) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    out.push([pts[i].x, pts[i].y, z]);
    if (i + 1 < pts.length) {
      const L = pts[i].distanceTo(pts[i + 1]), n = Math.floor(L / step);
      for (let k = 1; k < n; k++) { const p = pts[i].clone().lerp(pts[i + 1], k / n); out.push([p.x, p.y, z]); }
    }
  }
  return out;
}

/** Pontos ao longo de uma cadeia 3D (a cota de cada linha), interpolando a altura em cada trecho. */
function sample3d(pts, step) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    out.push([pts[i].x, pts[i].y, pts[i].z]);
    if (i + 1 < pts.length) {
      const L = pts[i].distanceTo(pts[i + 1]), n = Math.floor(L / step);
      for (let k = 1; k < n; k++) { const p = pts[i].clone().lerp(pts[i + 1], k / n); out.push([p.x, p.y, p.z]); }
    }
  }
  return out;
}

/** Lista "x y z" colada (espaço, ponto e vírgula ou tabulação; vírgula decimal aceita quando o separador não é vírgula). */
export function parsePoints(text) {
  const out = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^[a-z#/]/i.test(line)) continue; // cabeçalho ou comentário
    let parts = line.split(/[;\t]+|\s+/).filter(Boolean);
    if (parts.length < 3 && line.includes(',')) parts = line.split(',');
    const nums = parts.map(s => Number(s.replace(',', '.'))).filter(Number.isFinite);
    if (nums.length >= 3) out.push(nums.slice(-3)); // aceita "id x y z"
  }
  return out;
}

// ---------------------------------------------------------------- ferramenta

export class TerrainTool {
  constructor(app) { this.app = app; }

  /** Janela de escolha: pontos na planta, curvas de nível (linhas selecionadas) ou lista de pontos. */
  open() {
    const app = this.app;
    const sel = [...app.viewer.selected].filter(el => segmentsOf(el).length);
    const opt = (title, text, action, disabled) => h('button', { class: 'terrain-opt', disabled, onclick: () => { dlg.close(); action(); } }, h('strong', {}, title), h('span', { class: 'muted' }, text));
    const dlg = modal({
      title: 'Terreno',
      body: h('div', { class: 'terrain-opts' },
        opt('Por pontos de elevação', 'Clique os pontos na planta, cada um com a sua cota.', () => this.startPoints()),
        opt('Por curvas de nível', sel.length ? `Usar as ${sel.length} linha(s) selecionada(s): cada curva ganha a sua cota.` : 'Selecione antes as linhas das curvas (desenhadas ou importadas de DXF).', () => this.fromLines(sel), !sel.length),
        opt('Por lista de pontos (x y z)', 'Cole o levantamento topográfico: um ponto por linha.', () => this.fromList())),
      actions: [{ label: 'Cancelar' }],
    });
  }

  // ------------------------------------------------------------ 1. pontos clicados

  startPoints() {
    const app = this.app, v = app.viewer, view = app.views.active;
    if (view.kind !== 'plan') { toast('Abra uma planta de piso para clicar os pontos.', 'error'); return; }
    this.stop();
    const lvl = app.views.activeLevel();
    this.pts = [];
    this.z0 = lvl?.elevation ?? 0;
    v.tool = this;
    const ctl = v.controls;
    this._saved = { ctl, buttons: { ...ctl.mouseButtons } };
    ctl.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: null };
    this.cota = h('input', { type: 'number', step: 0.1, value: 0, style: 'width:80px', title: 'Cota do próximo ponto (m, relativa ao nível)' });
    this.count = h('span', { class: 'muted' }, '0 pontos');
    this.bar = h('div', { class: 'draw-bar' }, h('strong', {}, '⛰ Terreno'),
      h('label', {}, 'Cota do ponto (m) ', this.cota), this.count,
      h('span', { class: 'muted' }, 'Clique os pontos · Ctrl+Z tira o último · Enter cria'),
      h('button', { onclick: () => this.undoPoint() }, 'Desfazer ponto'),
      h('button', { class: 'primary', onclick: () => this.finishPoints() }, 'Criar terreno'),
      h('button', { onclick: () => this.stop() }, 'Sair'));
    this.layer = svg('svg', { class: 'terrain-pts' });
    document.querySelector('.center').append(this.bar, this.layer);
    const el = v.renderer.domElement;
    this._h = {
      down: e => { if (e.button === 0) { e.preventDefault(); this.addPoint(e); } else if (e.button === 2) this.finishPoints(); },
      key: e => {
        if (e.target === this.cota && e.key !== 'Enter' && e.key !== 'Escape') return;
        if (e.key === 'Escape') this.stop();
        if (e.key === 'Enter') { e.preventDefault(); this.finishPoints(); }
        if (e.ctrlKey && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); e.stopPropagation(); this.undoPoint(); }
      },
    };
    el.addEventListener('pointerdown', this._h.down);
    addEventListener('keydown', this._h.key, true);
    this._hook = () => this.drawPoints();
    v.frameHooks.push(this._hook);
    app.status('Terreno: digite a cota e clique o ponto na planta (repita). Enter cria o terreno.');
  }

  ground(x, y, z) {
    const v = this.app.viewer, r = v.renderer.domElement.getBoundingClientRect();
    v.raycaster.setFromCamera({ x: ((x - r.left) / r.width) * 2 - 1, y: -((y - r.top) / r.height) * 2 + 1 }, v.camera);
    const ray = v.raycaster.ray;
    if (Math.abs(ray.direction.z) < 1e-9) return null;
    return ray.origin.clone().addScaledVector(ray.direction, (z - ray.origin.z) / ray.direction.z);
  }

  addPoint(e) {
    const p = this.ground(e.clientX, e.clientY, this.z0);
    if (!p) return;
    const z = this.z0 + (Number(String(this.cota.value).replace(',', '.')) || 0);
    this.pts.push([+p.x.toFixed(3), +p.y.toFixed(3), +z.toFixed(3)]);
    this.count.textContent = `${this.pts.length} ponto${this.pts.length === 1 ? '' : 's'}`;
  }

  undoPoint() { this.pts.pop(); this.count.textContent = `${this.pts.length} pontos`; }

  drawPoints() {
    if (!this.layer) return;
    const v = this.app.viewer, c = v.renderer.domElement.getBoundingClientRect(), pr = this.layer.getBoundingClientRect();
    this.layer.replaceChildren(...this.pts.flatMap(p => {
      const q = new THREE.Vector3(p[0], p[1], this.z0).project(v.camera);
      const x = (q.x + 1) / 2 * c.width + c.left - pr.left, y = (1 - q.y) / 2 * c.height + c.top - pr.top;
      const t = svg('text', { x: x + 7, y: y - 6 });
      t.textContent = fmtLen(p[2] - this.z0, { suffix: true });
      return [svg('circle', { cx: x, cy: y, r: 4 }), t];
    }));
  }

  finishPoints() {
    const pts = this.pts || [];
    const lvl = this.app.views.activeLevel();
    this.stop();
    if (pts.length) createTerrain(this.app, pts, { level: lvl });
  }

  stop() {
    const v = this.app.viewer;
    if (this._h) {
      v.renderer.domElement.removeEventListener('pointerdown', this._h.down);
      removeEventListener('keydown', this._h.key, true);
      this._h = null;
    }
    if (this._hook) { v.frameHooks.splice(v.frameHooks.indexOf(this._hook), 1); this._hook = null; }
    if (this._saved) { this._saved.ctl.mouseButtons = this._saved.buttons; this._saved = null; }
    this.bar?.remove(); this.layer?.remove();
    this.bar = this.layer = null;
    if (v.tool === this) v.tool = null;
  }

  // ------------------------------------------------------------ 2. curvas de nível (linhas selecionadas)

  fromLines(sel) {
    const app = this.app, lvl = app.views.activeLevel() || app.levels.list[0];
    const base = lvl?.elevation ?? 0;
    const curves = chains(sel.flatMap(segmentsOf)).map(pts => {
      const zs = pts.map(p => p.z), flat = Math.max(...zs) - Math.min(...zs) < 0.005;
      const own = !flat || Math.abs(zs[0] - base) > 0.005; // a linha já tem altura própria (DXF 3D, desenhada em outra cota)
      return { pts, len: lengthOf(pts), cota: flat ? zs[0] - base : null, propria: own && flat ? zs[0] : null, z3d: !flat };
    }).sort((a, b) => b.len - a.len);
    // sem altura própria: sugere cotas crescentes de 1 em 1 m
    curves.forEach((c, i) => { if (c.propria === null && !c.z3d) c.cota = i; else if (c.propria !== null) c.cota = c.propria - base; });
    const passo = h('input', { type: 'number', step: 0.1, min: 0.1, value: 1, style: 'width:70px' });
    const espessura = h('input', { type: 'number', step: 0.1, min: 0.1, value: 1, style: 'width:70px' });
    const intervalo = h('input', { type: 'number', step: 0.1, min: 0.05, value: 1, style: 'width:70px' });
    const rows = curves.map((c, i) => h('tr', {},
      h('td', {}, `Curva ${i + 1}`),
      h('td', { class: 'muted' }, `${fmtLen(c.len, { suffix: true })} · ${c.pts.length} vértices`),
      h('td', {}, c.z3d ? h('span', { class: 'muted' }, 'altura das linhas (3D)') : h('input', { type: 'number', step: 0.1, value: +c.cota.toFixed(3), style: 'width:80px', oninput: e => { c.cota = Number(e.target.value) || 0; } }))));
    modal({
      title: 'Terreno por curvas de nível',
      body: h('div', {},
        h('p', { class: 'muted', style: 'margin-top:0' }, `${curves.length} curva(s) nas linhas selecionadas. Cota de cada curva em metros, relativa ao nível "${lvl?.name || '—'}".`),
        h('table', { class: 'terrain-table' }, h('tr', {}, h('th', {}, ''), h('th', {}, 'Tamanho'), h('th', {}, 'Cota (m)')), rows),
        h('div', { class: 'terrain-params' }, h('label', {}, 'Amostrar a cada (m) ', passo), h('label', {}, 'Espessura do terreno (m) ', espessura), h('label', {}, 'Curvas de nível a cada (m) ', intervalo))),
      actions: [{ label: 'Cancelar' }, { label: 'Criar terreno', class: 'primary', action: () => {
        const step = Math.max(0.1, Number(passo.value) || 1);
        const pts = curves.flatMap(c => (c.z3d ? sample3d(c.pts, step) : sample(c.pts, step, base + c.cota)));
        createTerrain(app, pts, { level: lvl, espessura: Number(espessura.value) || 1, intervalo: Number(intervalo.value) || 1 });
      } }],
    });
  }

  // ------------------------------------------------------------ 3. lista de pontos

  fromList(el = null) {
    const app = this.app, lvl = app.views.activeLevel() || app.levels.list[0];
    const t = el?.userData.bim.terreno;
    const area = h('textarea', { rows: 12, style: 'width:100%;font-family:ui-monospace,Consolas,monospace;font-size:12px', placeholder: '# x y z (m) — um ponto por linha\n0 0 100,0\n20 0 101,5\n20 30 103,2\n0 30 102,0' },
      t ? t.pontos.map(p => p.join(' ')).join('\n') : '');
    const absol = h('input', { type: 'checkbox', checked: true });
    const espessura = h('input', { type: 'number', step: 0.1, min: 0.1, value: t?.espessura ?? 1, style: 'width:70px' });
    const intervalo = h('input', { type: 'number', step: 0.1, min: 0.05, value: t?.intervalo ?? 1, style: 'width:70px' });
    const info = h('span', { class: 'muted small' });
    const count = () => { info.textContent = `${parsePoints(area.value).length} ponto(s) reconhecido(s)`; };
    area.addEventListener('input', count);
    count();
    modal({
      title: el ? 'Pontos do terreno' : 'Terreno por lista de pontos',
      body: h('div', {},
        h('p', { class: 'muted', style: 'margin-top:0' }, 'Um ponto por linha: x y z em metros (separados por espaço, ponto e vírgula ou tabulação; "id x y z" também serve). Linhas começando com letra ou # são ignoradas.'),
        area, info,
        h('div', { class: 'terrain-params' },
          el ? null : h('label', { title: 'Desmarcado: z é relativo ao nível ativo' }, absol, ` cotas absolutas (z do projeto)`),
          h('label', {}, 'Espessura (m) ', espessura), h('label', {}, 'Curvas a cada (m) ', intervalo))),
      actions: [{ label: 'Cancelar' }, { label: el ? 'Atualizar terreno' : 'Criar terreno', class: 'primary', action: () => {
        let pts = parsePoints(area.value);
        if (!el && !absol.checked) pts = pts.map(([x, y, z]) => [x, y, z + (lvl?.elevation ?? 0)]);
        if (pts.length < 3) { toast('Preciso de pelo menos 3 pontos.', 'error'); return false; }
        if (el) {
          Object.assign(t, { pontos: pts, espessura: Number(espessura.value) || 1, intervalo: Number(intervalo.value) || 1 });
          this.rebuild(el);
        } else createTerrain(app, pts, { level: lvl, espessura: Number(espessura.value) || 1, intervalo: Number(intervalo.value) || 1 });
      } }],
    }).el.classList.add('terrain-list');
  }

  rebuild(el) {
    rebuildTerrain(el);
    this.app.viewer._prepare2D?.(el);
    this.app.viewer.changed();
    this.app.renderProps();
  }

  /** Seção do painel Propriedades. */
  propsSection(el) {
    const t = el.userData.bim.terreno, set = (k, v) => { t[k] = v; this.rebuild(el); };
    const num = (k, label, step, min) => h('tr', {}, h('td', {}, label), h('td', {}, h('input', { type: 'number', step, min, value: t[k], onchange: e => set(k, Math.max(min, Number(e.target.value) || t[k])) })));
    const mats = Object.keys(this.app.types.materials);
    return [
      h('h4', {}, 'Terreno'),
      h('table', {},
        num('intervalo', 'Curvas de nível a cada (m)', 0.1, 0.05),
        num('espessura', 'Espessura do terreno (m)', 0.1, 0.05),
        h('tr', {}, h('td', {}, 'Material'), h('td', {}, h('select', { onchange: e => set('material', e.target.value) }, mats.map(m => h('option', { value: m, selected: m === (t.material || 'Terreno') }, m)))))),
      h('button', { class: 'mini', style: 'margin-top:6px', onclick: () => this.fromList(el) }, `Editar os ${t.pontos.length} pontos…`),
    ];
  }
}
