// Elementos BIM nativos do BoxBim (paredes, lajes, pilares, vigas, caixas).
// Paredes, lajes, pilares e vigas são grupos com uma malha por CAMADA (tipos compostos, como no Revit):
//   userData.bim = { type: 'IfcWall'|…, name, guid, props, typeId, typeName, layers, wall|slab|column|beam }
//   cada malha filha tem userData.layer = { name, material, thickness, function }
// rebuildElement() regenera a geometria a partir desses dados (troca de tipo, junções, edição).
// Todos são OBJETOS de sistema (userData.bim.sistema = 'parede' | 'laje' | 'pilar' | 'viga' | 'caixa'): a geometria
// nativa daqui é montada na hora e logo substituída pela do script do objeto da biblioteca (objects/system.js);
// sem o objeto na biblioteca, a nativa fica.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const IFC_COLORS = {
  IfcWall: 0xd9d4c7, IfcWallStandardCase: 0xd9d4c7, IfcSlab: 0xa7a9ac, IfcColumn: 0x9fb3c8, IfcBeam: 0x8ea6bf,
  IfcRoof: 0xa0522d, IfcDoor: 0x8b5a2b, IfcWindow: 0x8fd3ff, IfcStair: 0xb0a48a, IfcRailing: 0x606060,
  IfcFurnishingElement: 0xc8a165, IfcBuildingElementProxy: 0xb8c4a8,
};

const matCache = new Map();
export function materialFor(color, opacity = 1) {
  const key = `${color}-${opacity}`;
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshStandardMaterial({
      color, roughness: 0.85, metalness: 0.02, transparent: opacity < 1, opacity, side: THREE.DoubleSide,
    }));
  }
  return matCache.get(key);
}

// Os materiais das camadas vêm da biblioteca de tipos (types.js), que registra o resolvedor aqui.
let resolveMaterial = () => null;
export function setMaterialResolver(fn) { resolveMaterial = fn; }

// Construtor da geometria pelo script do objeto de sistema (registrado pelo app; assíncrono)
let scripted = null;
export function setScriptedBuilder(fn) { scripted = fn; }
export const systemKindOf = b => (b?.wall ? 'parede' : b?.slab ? 'laje' : b?.column ? 'pilar' : b?.beam ? 'viga' : b?.box ? 'caixa' : b?.roof ? 'telhado' : null);

export function uuid() {
  return crypto.randomUUID();
}

/** Prisma vertical a partir de um contorno em planta (pontos [x,y] em metros), com furos opcionais. */
function prism(points, z0, z1, holes = []) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const hole of holes) shape.holes.push(new THREE.Path(hole.map(([x, y]) => new THREE.Vector2(x, y))));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: z1 - z0, bevelEnabled: false });
  geo.translate(0, 0, z0);
  return geo;
}

const rect = (cx, cy, w, d) => [[cx - w / 2, cy - d / 2], [cx + w / 2, cy - d / 2], [cx + w / 2, cy + d / 2], [cx - w / 2, cy + d / 2]];
const circle = (cx, cy, r, n = 40) => Array.from({ length: n }, (_, i) => [cx + r * Math.cos(i / n * Math.PI * 2), cy + r * Math.sin(i / n * Math.PI * 2)]);

/** Camadas efetivas: as do tipo, ou uma camada única com a cor padrão do elemento. */
function effectiveLayers(layers, fallbackThickness, ifcType) {
  if (layers?.length) return layers;
  return [{ name: 'Genérico', material: null, thickness: fallbackThickness, function: 'estrutura', _ifc: ifcType }];
}

function layerMaterial(l, ifcType) {
  return (l.material && resolveMaterial(l.material)) || materialFor(IFC_COLORS[l._ifc || ifcType] ?? 0xcccccc);
}

export const totalThickness = layers => +(layers || []).reduce((s, l) => s + (Number(l.thickness) || 0), 0).toFixed(4);

// ---------------------------------------------------------------- partes (geometria por camada)

/**
 * Parede: camadas paralelas ao eixo. A primeira camada fica à ESQUERDA do sentido de desenho (lado externo,
 * como no Revit). Cada camada é a extrusão do perfil da ELEVAÇÃO da parede (u ao longo do eixo, z absoluto)
 * na espessura da camada — assim os vãos de portas e janelas hospedadas (w.openings) atravessam todas as camadas.
 */
function wallParts(w, layers) {
  const { start: [x0, y0], end: [x1, y1], height, base, extendStart = 0, extendEnd = 0, openings = [] } = w;
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len < 1e-6) throw new Error('Parede com comprimento zero.');
  const ux = (x1 - x0) / len, uy = (y1 - y0) / len, nx = -uy, ny = ux;
  const ops = openings.map(o => ({ a: o.offset - o.width / 2, b: o.offset + o.width / 2, z0: base + o.sill, z1: base + o.sill + o.height }));
  const profiles = w.perfil?.length ? wallOutline(w, base, ops) : wallProfiles(-extendStart, len + extendEnd, base, base + height, ops);
  const dir = new THREE.Vector3(ux, uy, 0), up = new THREE.Vector3(0, 0, 1), nrm = new THREE.Vector3(nx, ny, 0);
  const T = totalThickness(layers);
  let outer = T / 2;
  return layers.map(l => {
    const inner = outer - l.thickness;
    outer = inner;
    if (!(l.thickness > 1e-6)) return null;
    // local x → eixo da parede, local y → Z, extrusão (local z) → normal, da face interna da camada para fora
    const basis = new THREE.Matrix4().makeBasis(dir, up, nrm).setPosition(x0 + nx * inner, y0 + ny * inner, 0);
    const geos = profiles.map(pr => {
      const shape = new THREE.Shape(pr.outer.map(([u, z]) => new THREE.Vector2(u, z)));
      for (const hole of pr.holes) shape.holes.push(new THREE.Path(hole.map(([u, z]) => new THREE.Vector2(u, z))));
      return new THREE.ExtrudeGeometry(shape, { depth: l.thickness, bevelEnabled: false }).applyMatrix4(basis);
    });
    return { geo: geos.length === 1 ? geos[0] : mergeGeometries(geos, false), layer: l };
  }).filter(Boolean);
}

const EPS = 1e-4;

/**
 * Perfis da elevação da parede ([u0,u1] × [zb,zt]) menos os vãos {a, b, z0, z1}.
 * Caso comum (vãos separados, dentro do comprimento, sem ocupar a altura toda): um único contorno, com
 * recortes na base (portas), no topo e furos (janelas). Caso contrário: faixas retangulares.
 */
export function wallProfiles(u0, u1, zb, zt, openings) {
  const ops = openings
    .map(o => ({ a: Math.max(u0, o.a), b: Math.min(u1, o.b), z0: Math.max(zb, o.z0), z1: Math.min(zt, o.z1) }))
    .filter(o => o.b - o.a > EPS && o.z1 - o.z0 > EPS)
    .sort((p, q) => p.a - q.a);
  const rect = (a, b, c, d) => [[a, c], [b, c], [b, d], [a, d]];
  if (!ops.length) return [{ outer: rect(u0, u1, zb, zt), holes: [] }];

  const simple = ops.every((o, i) => o.a > u0 + EPS && o.b < u1 - EPS && !(o.z0 <= zb + EPS && o.z1 >= zt - EPS)
    && (i === 0 || o.a > ops[i - 1].b + EPS));
  if (simple) {
    const bottom = ops.filter(o => o.z0 <= zb + EPS);
    const top = ops.filter(o => o.z1 >= zt - EPS && o.z0 > zb + EPS);
    const holes = ops.filter(o => o.z0 > zb + EPS && o.z1 < zt - EPS).map(o => rect(o.a, o.b, o.z0, o.z1));
    const outer = [[u0, zb]];
    for (const o of bottom) outer.push([o.a, zb], [o.a, o.z1], [o.b, o.z1], [o.b, zb]);
    outer.push([u1, zb], [u1, zt]);
    for (const o of [...top].reverse()) outer.push([o.b, zt], [o.b, o.z0], [o.a, o.z0], [o.a, zt]);
    outer.push([u0, zt]);
    return [{ outer, holes }];
  }

  // faixas verticais entre as bordas dos vãos; em cada faixa, os trechos de altura livres viram retângulos
  const xs = [...new Set([u0, u1, ...ops.flatMap(o => [o.a, o.b])])].sort((p, q) => p - q);
  const out = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    const xa = xs[i], xb = xs[i + 1];
    if (xb - xa <= EPS) continue;
    const xm = (xa + xb) / 2;
    const cuts = ops.filter(o => o.a < xm && o.b > xm).map(o => [o.z0, o.z1]).sort((p, q) => p[0] - q[0]);
    let z = zb;
    for (const [c0, c1] of cuts) {
      if (c0 > z + EPS) out.push({ outer: rect(xa, xb, z, c0), holes: [] });
      z = Math.max(z, c1);
    }
    if (zt > z + EPS) out.push({ outer: rect(xa, xb, z, zt), holes: [] });
  }
  return out;
}

/**
 * Perfil de elevação próprio da parede (wall.perfil): contorno fechado [[u, z], …] com u a partir do início do eixo
 * (0…L) e z a partir da base — topo inclinado, recortado pelo telhado, oitão… As pontas em u = 0 e u = L acompanham
 * os prolongamentos (cantos). Vãos: os que tocam a base viram recortes no pé do contorno; os de dentro, furos.
 */
export function wallOutline(w, zb, ops) {
  const L = Math.hypot(w.end[0] - w.start[0], w.end[1] - w.start[1]);
  const e0 = w.extendStart || 0, e1 = w.extendEnd || 0;
  const pts = w.perfil.map(([u, z]) => [u <= 1e-6 ? u - e0 : u >= L - 1e-6 ? u + e1 : u, zb + z]);
  const rect = (a, b, c, d) => [[a, c], [b, c], [b, d], [a, d]];
  const holes = [];
  let outer = pts;
  for (const o of ops) {
    if (o.z0 > zb + EPS) { holes.push(rect(o.a, o.b, o.z0, o.z1)); continue; }
    // vão no pé (porta): entra como recorte no trecho da base que o contém
    const k = outer.findIndex((p, i) => {
      const q = outer[(i + 1) % outer.length];
      return Math.abs(p[1] - zb) < EPS && Math.abs(q[1] - zb) < EPS && Math.min(p[0], q[0]) <= o.a + EPS && Math.max(p[0], q[0]) >= o.b - EPS;
    });
    if (k < 0) continue;
    const p = outer[k], q = outer[(k + 1) % outer.length];
    const notch = p[0] < q[0] ? [[o.a, zb], [o.a, o.z1], [o.b, o.z1], [o.b, zb]] : [[o.b, zb], [o.b, o.z1], [o.a, o.z1], [o.a, zb]];
    outer = [...outer.slice(0, k + 1), ...notch, ...outer.slice(k + 1)];
  }
  return [{ outer, holes }];
}

/** Altura máxima do perfil próprio (ou a altura da parede). */
export const wallTop = w => (w.perfil?.length ? Math.max(...w.perfil.map(p => p[1])) : w.height);

/** Laje/piso: camadas empilhadas de cima (cota do topo) para baixo. */
function slabParts(s, layers) {
  let top = s.elevation;
  return layers.map(l => {
    const part = { geo: prism(s.points, top - l.thickness, top, s.holes || []), layer: l };
    top -= l.thickness;
    return part;
  });
}

// ---------------------------------------------------------------- telhado (por extrusão de perfil)

/** Matriz do plano do telhado: X = u, Y = v, Z = normal (u × v), origem o. */
export function roofFrame(r) {
  const u = new THREE.Vector3(...r.plano.u).normalize(), v = new THREE.Vector3(...r.plano.v).normalize();
  return new THREE.Matrix4().makeBasis(u, v, u.clone().cross(v)).setPosition(...r.plano.o);
}

/** Polilinha aberta deslocada de d (positivo = à esquerda do sentido), com cantos em esquadria. */
function offsetOpen(pts, d) {
  if (!d) return pts.map(p => [...p]);
  const segs = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const nx = -(b[1] - a[1]) / L, ny = (b[0] - a[0]) / L;
    segs.push([[a[0] + nx * d, a[1] + ny * d], [b[0] + nx * d, b[1] + ny * d]]);
  }
  const out = [segs[0][0]];
  for (let i = 0; i < segs.length - 1; i++) {
    const [a1, b1] = segs[i], [a2, b2] = segs[i + 1];
    const d1 = [b1[0] - a1[0], b1[1] - a1[1]], d2 = [b2[0] - a2[0], b2[1] - a2[1]];
    const den = d1[0] * d2[1] - d1[1] * d2[0];
    if (Math.abs(den) < 1e-12) { out.push(b1); continue; }
    const t = ((a2[0] - a1[0]) * d2[1] - (a2[1] - a1[1]) * d2[0]) / den;
    out.push([a1[0] + d1[0] * t, a1[1] + d1[1] * t]);
  }
  out.push(segs[segs.length - 1][1]);
  return out;
}

/**
 * Faixas (seções) das camadas do telhado no plano do perfil: a 1ª camada fica logo ABAIXO da linha desenhada, as
 * outras descem em seguida. Cada faixa é um contorno fechado [[u, v], …].
 */
export function roofBands(r, thicknesses) {
  const pts = r.perfil;
  // "para baixo" = o lado do perfil em que o deslocamento abaixa v
  const meanV = arr => arr.reduce((s, p) => s + p[1], 0) / arr.length;
  const side = meanV(offsetOpen(pts, 0.01)) < meanV(pts) ? 1 : -1;
  const bands = [];
  let acc = 0;
  for (const t of thicknesses) {
    const top = offsetOpen(pts, side * acc), bot = offsetOpen(pts, side * (acc + t));
    acc += t;
    bands.push(t > 1e-6 ? [...top, ...bot.reverse()].map(p => [+p[0].toFixed(6), +p[1].toFixed(6)]) : null);
  }
  return bands;
}

/** Linha de BAIXO do telhado (face inferior da última camada), no plano do perfil: polilinha [[u, v], …]. */
export function roofUnderside(r, total) {
  const meanV = arr => arr.reduce((s, p) => s + p[1], 0) / arr.length;
  const side = meanV(offsetOpen(r.perfil, 0.01)) < meanV(r.perfil) ? 1 : -1;
  return offsetOpen(r.perfil, side * total);
}

function roofParts(r, layers) {
  const M = roofFrame(r);
  const depth = Math.max(0.01, r.fim - r.inicio);
  const bands = roofBands(r, layers.map(l => l.thickness));
  return layers.map((l, i) => {
    if (!bands[i]) return null;
    const shape = new THREE.Shape(bands[i].map(([x, y]) => new THREE.Vector2(x, y)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
    geo.translate(0, 0, r.inicio);
    geo.applyMatrix4(M);
    return { geo, layer: l };
  }).filter(Boolean);
}

/**
 * Telhado por extrusão: perfil (polilinha aberta, a linha de cima do telhado) desenhado num plano vertical — um eixo
 * de trabalho — e extrudado na normal dele de "inicio" até "fim". Camadas do tipo (Telhados) descem a partir do perfil.
 *   bim.roof = { plano: { o, u, v }, perfil: [[u, v], …], inicio, fim }
 */
export function createRoof({ plano, perfil, inicio = 0, fim = 5, layers, typeId, typeName, name } = {}) {
  const ls = effectiveLayers(layers, 0.15, 'IfcRoof');
  const roof = { plano: structuredClone(plano), perfil: perfil.map(p => [...p]), inicio, fim };
  return layeredElement('IfcRoof', name || 'Telhado', roofProps(roof, ls, typeName), { roof, layers: layers || null, typeId, typeName }, roofParts(roof, ls));
}

function roofProps(r, ls, typeName) {
  let len = 0;
  const slopes = [];
  for (let i = 1; i < r.perfil.length; i++) {
    const dx = r.perfil[i][0] - r.perfil[i - 1][0], dy = r.perfil[i][1] - r.perfil[i - 1][1];
    len += Math.hypot(dx, dy);
    if (Math.abs(dx) > 1e-6) slopes.push(+(Math.abs(dy / dx) * 100).toFixed(1));
  }
  return { Comprimento: +(r.fim - r.inicio).toFixed(3), Area: +(len * (r.fim - r.inicio)).toFixed(3), 'Inclinação (%)': slopes.join(' / '), Espessura: totalThickness(ls), ...typeProps(ls, typeName) };
}

/** Pilar: a primeira camada é o núcleo (dimensões da instância); as demais revestem em volta. */
function columnParts(c, layers) {
  const { position: [x, y], width, depth, height, base, round } = c;
  const outline = grow => (round ? circle(x, y, width / 2 + grow) : rect(x, y, width + 2 * grow, depth + 2 * grow));
  let grow = 0;
  return layers.map((l, i) => {
    if (i === 0) return { geo: prism(outline(0), base, base + height), layer: l };
    const inner = outline(grow);
    grow += l.thickness;
    return { geo: prism(outline(grow), base, base + height, [inner]), layer: l };
  });
}

/** Viga: seção com núcleo (largura × altura) e revestimentos nas laterais e no fundo; o topo fica na cota "top". */
function beamParts(bm, layers) {
  const { start: [x0, y0], end: [x1, y1], width, height, top } = bm;
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len < 1e-6) throw new Error('Viga com comprimento zero.');
  const dir = new THREE.Vector3((x1 - x0) / len, (y1 - y0) / len, 0);
  const across = new THREE.Vector3(-dir.y, dir.x, 0);
  const basis = new THREE.Matrix4().makeBasis(across, new THREE.Vector3(0, 0, 1), dir).setPosition(x0, y0, 0);
  // seção no plano local (x = transversal, y = cota absoluta), extrudada ao longo do eixo
  const section = grow => [[-width / 2 - grow, top - height - grow], [width / 2 + grow, top - height - grow], [width / 2 + grow, top], [-width / 2 - grow, top]];
  const extrude = (outer, hole) => {
    const shape = new THREE.Shape(outer.map(([u, v]) => new THREE.Vector2(u, v)));
    if (hole) shape.holes.push(new THREE.Path(hole.map(([u, v]) => new THREE.Vector2(u, v))));
    return new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false }).applyMatrix4(basis);
  };
  let grow = 0;
  return layers.map((l, i) => {
    if (i === 0) return { geo: extrude(section(0)), layer: l };
    const inner = section(grow);
    grow += l.thickness;
    return { geo: extrude(section(grow), inner), layer: l };
  });
}

// ---------------------------------------------------------------- montagem

function fill(group, parts, ifcType) {
  for (const { geo, layer } of parts) {
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, layer._mat || (layer._color !== undefined ? materialFor(layer._color) : layerMaterial(layer, ifcType)));
    m.name = layer.name;
    const { _ifc, _mat, _color, ...clean } = layer;
    m.userData.layer = clean;
    group.add(m);
  }
}

function layeredElement(ifcType, name, props, data, parts) {
  const g = new THREE.Group();
  g.name = name;
  g.userData.bim = { type: ifcType, name, guid: uuid(), props, ...data };
  g.userData.bim.sistema = systemKindOf(g.userData.bim);
  fill(g, parts, ifcType);
  scripted?.(g);
  return g;
}

const layerSummary = layers => layers.map(l => `${l.name} ${(l.thickness * 100).toFixed(1).replace('.', ',')} cm`).join(' | ');

function typeProps(layers, typeName) {
  return typeName ? { Tipo: typeName, Camadas: layerSummary(layers) } : {};
}

/** Geometria simples da parede (sem camadas) — usada pela prévia da ferramenta de desenho. */
export function wallGeometry({ start, end, height, thickness, base, extendStart = 0, extendEnd = 0, openings = [] }) {
  const [{ geo }] = wallParts({ start, end, height, base, extendStart, extendEnd, openings }, [{ thickness }]);
  geo.computeVertexNormals();
  return { geo, len: Math.hypot(end[0] - start[0], end[1] - start[1]) };
}

export function createWall({ start = [0, 0], end = [5, 0], height = 3, thickness = 0.2, base = 0, extendStart = 0, extendEnd = 0, layers, typeId, typeName, name } = {}) {
  const ls = effectiveLayers(layers, thickness, 'IfcWall');
  const T = totalThickness(ls);
  // eixo da parede (sem os prolongamentos), usado pelo snap e pelas junções da ferramenta de desenho
  // openings: vãos de portas/janelas hospedadas { id (instância), offset (centro, m do início), width, sill, height }
  const wall = { start: [...start], end: [...end], height, thickness: T, base, extendStart, extendEnd, openings: [] };
  const len = Math.hypot(end[0] - start[0], end[1] - start[1]);
  return layeredElement('IfcWall', name || 'Parede',
    { Comprimento: +len.toFixed(3), Altura: height, Espessura: T, Base: base, ...typeProps(ls, typeName) },
    { wall, layers: layers || null, typeId, typeName }, wallParts(wall, ls));
}

export function createSlab({ points = [[0, 0], [5, 0], [5, 5], [0, 5]], holes = [], thickness = 0.15, elevation = 0, layers, typeId, typeName, name } = {}) {
  const ls = effectiveLayers(layers, thickness, 'IfcSlab');
  // holes: furos (aberturas, shafts) — contornos dentro do contorno da laje
  const slab = { points: points.map(p => [...p]), elevation, thickness: totalThickness(ls), ...(holes?.length ? { holes: holes.map(hl => hl.map(p => [...p])) } : {}) };
  const ar = pts => Math.abs(THREE.ShapeUtils.area(pts.map(p => new THREE.Vector2(...p))));
  const area = +(ar(points) - (holes || []).reduce((s, hl) => s + ar(hl), 0)).toFixed(3);
  return layeredElement('IfcSlab', name || 'Laje',
    { Espessura: slab.thickness, Cota: elevation, Area: area, ...typeProps(ls, typeName) },
    { slab, layers: layers || null, typeId, typeName }, slabParts(slab, ls));
}

export function createColumn({ position = [0, 0], width = 0.3, depth = 0.3, height = 3, base = 0, round = false, layers, typeId, typeName, name } = {}) {
  const ls = effectiveLayers(layers, 0, 'IfcColumn');
  const column = { position: [...position], width, depth, height, base, round };
  return layeredElement('IfcColumn', name || 'Pilar',
    { Largura: width, Profundidade: depth, Altura: height, Base: base, Circular: round, ...typeProps(ls, typeName) },
    { column, layers: layers || null, typeId, typeName }, columnParts(column, ls));
}

export function createBeam({ start = [0, 0], end = [5, 0], width = 0.2, height = 0.5, top = 3, layers, typeId, typeName, name } = {}) {
  const ls = effectiveLayers(layers, 0, 'IfcBeam');
  const beam = { start: [...start], end: [...end], width, height, top };
  return layeredElement('IfcBeam', name || 'Viga',
    { Largura: width, Altura: height, Topo: top, ...typeProps(ls, typeName) },
    { beam, layers: layers || null, typeId, typeName }, beamParts(beam, ls));
}

/** Regenera a geometria de um elemento em camadas a partir de userData.bim (após trocar tipo, pontas ou dimensões). */
/**
 * Cantos em MEIA-ESQUADRIA: wall.miterStart / wall.miterEnd = ângulo da curva (rad, + = vira à esquerda) na junção
 * com a parede de antes / de depois. As faces das pontas são cortadas na bissetriz: a parede de cada lado vai até o
 * plano do canto, sem sobrepor a vizinha (sem faces brigando nem camadas cruzadas no corte). Aplica na geometria já
 * no modelo (nativa ou do script do objeto Parede).
 */
export function applyWallMiter(geo, w) {
  const mS = w.miterStart || 0, mE = w.miterEnd || 0;
  if (!mS && !mE) return geo;
  const [x0, y0] = w.start, [x1, y1] = w.end;
  const L = Math.hypot(x1 - x0, y1 - y0);
  if (L < 1e-6) return geo;
  const ux = (x1 - x0) / L, uy = (y1 - y0) / L, nx = -uy, ny = ux;
  const u0 = -(w.extendStart || 0), u1 = L + (w.extendEnd || 0);
  const tS = Math.tan(mS / 2), tE = Math.tan(mE / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const dx = pos.getX(i) - x0, dy = pos.getY(i) - y0;
    const u = dx * ux + dy * uy, y = dx * nx + dy * ny;
    let nu = u;
    if (mE && Math.abs(u - u1) < 1e-5) nu = L - y * tE;       // ponta final no plano do canto
    else if (mS && Math.abs(u - u0) < 1e-5) nu = y * tS;      // ponta inicial no plano do canto
    if (nu !== u) pos.setXY(i, pos.getX(i) + ux * (nu - u), pos.getY(i) + uy * (nu - u));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingBox(); geo.computeBoundingSphere();
  return geo;
}

export function rebuildElement(el) {
  const b = el.userData.bim;
  let parts;
  if (b.wall) {
    const ls = effectiveLayers(b.layers, b.wall.thickness, 'IfcWall');
    b.wall.thickness = totalThickness(ls);
    parts = wallParts(b.wall, ls);
    for (const pt of parts) applyWallMiter(pt.geo, b.wall);
    Object.assign(b.props, { Espessura: b.wall.thickness, Altura: +wallTop(b.wall).toFixed(3), Base: b.wall.base, ...(b.wall.perfil?.length ? { Perfil: 'próprio' } : {}),
      Comprimento: +Math.hypot(b.wall.end[0] - b.wall.start[0], b.wall.end[1] - b.wall.start[1]).toFixed(3) }, typeProps(ls, b.typeName));
  } else if (b.slab) {
    const ls = effectiveLayers(b.layers, b.slab.thickness, 'IfcSlab');
    b.slab.thickness = totalThickness(ls);
    parts = slabParts(b.slab, ls);
    Object.assign(b.props, { Espessura: b.slab.thickness }, typeProps(ls, b.typeName));
  } else if (b.column) {
    const ls = effectiveLayers(b.layers, 0, 'IfcColumn');
    parts = columnParts(b.column, ls);
    Object.assign(b.props, typeProps(ls, b.typeName));
  } else if (b.beam) {
    const ls = effectiveLayers(b.layers, 0, 'IfcBeam');
    parts = beamParts(b.beam, ls);
    for (const pt of parts) applyWallMiter(pt.geo, b.beam);
    Object.assign(b.props, typeProps(ls, b.typeName));
  } else if (b.roof) {
    const ls = effectiveLayers(b.layers, 0.15, 'IfcRoof');
    parts = roofParts(b.roof, ls);
    Object.assign(b.props, roofProps(b.roof, ls, b.typeName));
  } else if (b.box) {
    parts = boxParts(b.box, b.type);
  } else return false;
  for (const c of [...el.children]) {
    el.remove(c);
    c.traverse(o => o.geometry?.dispose());
  }
  fill(el, parts, b.type);
  b.sistema = systemKindOf(b);
  scripted?.(el);
  return true;
}

/** Caixa: base centrada em "position", tamanho [X, Y, Z]; material da biblioteca ou cor. */
function boxParts({ position, size, color, material }, ifcType) {
  const geo = new THREE.BoxGeometry(...size);
  geo.translate(position[0], position[1], position[2] + size[2] / 2);
  const mat = (material && resolveMaterial(material)) || null;
  const c = color ? new THREE.Color(color).getHex() : undefined;
  return [{ geo, layer: { name: 'Caixa', material: material || null, _ifc: ifcType, _mat: mat, _color: c } }];
}

export function createBox({ position = [0, 0, 0], size = [1, 1, 1], type = 'IfcBuildingElementProxy', name, color, material } = {}) {
  const box = { position: [...position], size: [...size], color: color ? `#${new THREE.Color(color).getHexString()}` : null, material: material || null };
  return layeredElement(type, name || 'Caixa', { Dimensoes: size.join(' x '), ...(material ? { Material: material } : {}) },
    { box }, boxParts(box, type));
}

/** Marca como elemento BIM um mesh vindo de um arquivo (FBX, DAE, OBJ…). */
export function tagImported(root, sourceName) {
  const insideElement = o => { for (let p = o.parent; p; p = p.parent) if (p.userData?.bim) return true; return false; };
  root.traverse(o => {
    if (o.isMesh && !o.userData.bim && !insideElement(o)) {
      o.userData.bim = { type: 'IfcBuildingElementProxy', name: o.name || sourceName, guid: uuid(), props: { Origem: sourceName } };
    }
  });
}
