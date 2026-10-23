// SÓLIDOS a partir do desenho 2D:
//   extrusão ... contorno fechado (com furos) levantado na vertical:  forma = { tipo: 'extrusao', perfil, furos, z0, altura }
//                (com plano = { o, u, v }: perfil no eixo de trabalho, levantado na normal dele)
//   varredura .. perfil (seção) que percorre um caminho de linhas:     forma = { tipo: 'varredura', caminho, fechado, perfil }
//                (seção em coordenadas [u, v]: u para a esquerda do sentido do caminho, v para cima)
//   vazio ...... qualquer um dos dois com forma.vazio = true: aparece translúcido e CORTA os elementos marcados
// Os dados ficam em userData.bim.forma (sincronizam com o projeto); a malha é refeita a partir deles.
import * as THREE from 'three';
import { uuid, materialFor } from '../elements.js';
import { area, planeMatrix } from './sketch.js';

export const VOID_MAT = new THREE.MeshStandardMaterial({ color: 0xff4d4d, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });

/** Deixa a geometria só com position, normal e uv (exigência do corte booleano: atributos iguais). */
export function normalizeGeometry(geo) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  g.clearGroups();
  return g;
}

function extrusionGeometry(f) {
  const ccw = pts => (area(pts) < 0 ? [...pts].reverse() : pts);
  const shape = new THREE.Shape(ccw(f.perfil).map(([x, y]) => new THREE.Vector2(x, y)));
  for (const hole of f.furos || []) shape.holes.push(new THREE.Path([...ccw(hole)].reverse().map(([x, y]) => new THREE.Vector2(x, y))));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.001, f.altura), bevelEnabled: false });
  geo.translate(0, 0, f.z0);
  if (f.plano) geo.applyMatrix4(planeMatrix(f.plano)); // desenhado num eixo de trabalho: sobe na normal do plano
  return geo;
}

/**
 * Varredura com juntas em esquadria: em cada vértice do caminho a seção fica no plano bissetor (como um perfil
 * cortado a 45° num canto de 90°), então trechos retos se encontram sem frestas.
 */
export function sweepGeometry(f) {
  const P = f.caminho.map(p => new THREE.Vector3(p[0], p[1], p[2] ?? 0));
  const closed = !!f.fechado && P.length > 2;
  const n = P.length;
  if (n < 2) throw new Error('O caminho precisa de pelo menos dois pontos.');
  const up = new THREE.Vector3(0, 0, 1);
  const dirOf = i => P[(i + 1) % n].clone().sub(P[i]).normalize();
  const segDirs = Array.from({ length: closed ? n : n - 1 }, (_, i) => dirOf(i));
  const lateral = d => { const l = up.clone().cross(d); return l.lengthSq() < 1e-8 ? new THREE.Vector3(1, 0, 0) : l.normalize(); };
  // seção anti-horária no plano (u, v)
  let prof = f.perfil;
  if (area(prof) < 0) prof = [...prof].reverse();
  const rings = [];
  for (let i = 0; i < n; i++) {
    const dIn = closed ? segDirs[(i - 1 + n) % n] : segDirs[Math.max(0, i - 1)];
    const dOut = closed ? segDirs[i % n] : segDirs[Math.min(segDirs.length - 1, i)];
    const lIn = lateral(dIn), lOut = lateral(dOut);
    let miter = lIn.clone().add(lOut);
    if (miter.lengthSq() < 1e-8) miter = lOut.clone(); else miter.normalize();
    const k = 1 / Math.max(0.25, miter.dot(lOut)); // alongamento da esquadria
    rings.push(prof.map(([u, v]) => P[i].clone().addScaledVector(miter, u * k).addScaledVector(up, v)));
  }
  const pos = [];
  const tri = (a, b, c) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  const m = prof.length;
  const spans = closed ? n : n - 1;
  for (let i = 0; i < spans; i++) {
    const A = rings[i], Bn = rings[(i + 1) % n];
    for (let j = 0; j < m; j++) {
      const j2 = (j + 1) % m;
      tri(A[j], A[j2], Bn[j2]);
      tri(A[j], Bn[j2], Bn[j]);
    }
  }
  if (!closed) {
    // tampas: triangulação da seção (no início ao contrário, para a normal apontar para fora)
    const faces = THREE.ShapeUtils.triangulateShape(prof.map(([u, v]) => new THREE.Vector2(u, v)), []);
    for (const [a, b, c] of faces) {
      tri(rings[0][a], rings[0][c], rings[0][b]);
      tri(rings[n - 1][a], rings[n - 1][b], rings[n - 1][c]);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  // a seção pode ter sido percorrida "para dentro" (caminho no sentido horário): confere o volume com sinal
  if (signedVolume(geo) < 0) {
    const arr = geo.attributes.position.array;
    for (let t = 0; t < arr.length; t += 9) for (let q = 0; q < 3; q++) { const tmp = arr[t + 3 + q]; arr[t + 3 + q] = arr[t + 6 + q]; arr[t + 6 + q] = tmp; }
    geo.computeVertexNormals();
  }
  return geo;
}

function signedVolume(geo) {
  const p = geo.attributes.position.array;
  let v = 0;
  for (let i = 0; i < p.length; i += 9) {
    v += (p[i] * (p[i + 4] * p[i + 8] - p[i + 5] * p[i + 7]) - p[i + 1] * (p[i + 3] * p[i + 8] - p[i + 5] * p[i + 6]) + p[i + 2] * (p[i + 3] * p[i + 7] - p[i + 4] * p[i + 6])) / 6;
  }
  return v;
}

/** Material do sólido: o da biblioteca de tipos (por nome) ou a cor padrão. */
let resolveLibMaterial = () => null;
export function setFormMaterialResolver(fn) { resolveLibMaterial = fn; }

export function rebuildForm(el) {
  const b = el.userData.bim, f = b.forma;
  for (const c of [...el.children]) { el.remove(c); c.traverse(o => o.geometry?.dispose()); }
  const geo = normalizeGeometry(f.tipo === 'varredura' ? sweepGeometry(f) : extrusionGeometry(f));
  geo.computeBoundingBox(); geo.computeBoundingSphere();
  const mat = f.vazio ? VOID_MAT : (f.material && resolveLibMaterial(f.material)) || materialFor(0xb8c4a8);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = f.vazio ? 'Vazio' : f.tipo === 'varredura' ? 'Varredura' : 'Extrusão';
  if (f.vazio) { mesh.userData.noCap = true; mesh.castShadow = false; }
  el.add(mesh);
  const vol = Math.abs(signedVolume(geo));
  b.props = { ...(b.props || {}), Forma: f.tipo === 'varredura' ? 'Varredura' : 'Extrusão', Volume: +vol.toFixed(4),
    ...(f.tipo === 'extrusao' ? { Altura: f.altura, Area: +Math.abs(area(f.perfil)).toFixed(3) } : { Caminho: +pathLength(f.caminho).toFixed(3) }),
    ...(f.material && !f.vazio ? { Material: f.material } : {}), ...(f.vazio ? { Vazio: 'sim' } : {}) };
  return el;
}

const pathLength = c => c.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - c[i][0], p[1] - c[i][1], (p[2] || 0) - (c[i][2] || 0)), 0);

export function buildForm(bim) {
  const g = new THREE.Group();
  g.userData.bim = bim;
  g.name = bim.name;
  rebuildForm(g);
  return g;
}

export function createForm(forma, { level, name } = {}) {
  const vazio = !!forma.vazio;
  const bim = {
    type: vazio ? 'IfcOpeningElement' : 'IfcBuildingElementProxy',
    name: name || (vazio ? 'Vazio' : forma.tipo === 'varredura' ? 'Varredura' : 'Extrusão'),
    guid: uuid(), levelId: level?.id || null, forma, props: level ? { Nivel: level.name } : {},
  };
  return buildForm(bim);
}

export const isForm = el => !!el?.userData?.bim?.forma;
export const isVoid = el => !!el?.userData?.bim?.forma?.vazio;
