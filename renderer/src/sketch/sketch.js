// DESENHO 2D: linhas, arcos e círculos no plano de um nível (como entidades do AutoCAD), editáveis com
// aparar, estender e canto, e que viram sólidos (extrusão, varredura) e vazios.
//
// Cada segmento é um elemento do projeto (sincroniza com quem está no projeto):
//   userData.bim = { type: 'IfcAnnotation', name, guid, levelId, props,
//                    linha: { z, a: [x, y], b: [x, y], arco: null | { c: [x, y], r, a0, a1 } } }
//   arco: anti-horário de a0 a a1 (radianos); círculo: a1 = a0 + 2π (a e b coincidem).
//   plano (opcional): linha desenhada num EIXO DE TRABALHO — { o, u, v } (origem e eixos do plano, no modelo);
//   aí a, b e arco ficam nas coordenadas do plano (u, v) e z = 0. Sem plano, o plano é o horizontal na cota z.
// A geometria fica nas coordenadas do modelo (grupo na origem); se o grupo for movido/girado, bake() leva a
// transformação para os dados antes de editar.
import * as THREE from 'three';
import { uuid } from '../elements.js';
import { styledLine } from './style.js';

export const EPS = 1e-6;
const TAU = Math.PI * 2;
export const SELECT_LINE_MAT = new THREE.LineBasicMaterial({ color: 0x2f9bff, depthTest: false });

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const len = a => Math.hypot(a[0], a[1]);
const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const normAng = a => ((a % TAU) + TAU) % TAU;

// ---------------------------------------------------------------- elementos

/** Ângulo varrido de um arco (0..2π]. */
export const sweepOf = arco => { let s = arco.a1 - arco.a0; if (s <= 0) s += TAU; return Math.min(s, TAU); };
export const isCircle = l => !!l.arco && sweepOf(l.arco) >= TAU - 1e-9;
const arcPoint = (arco, t) => [arco.c[0] + arco.r * Math.cos(t), arco.c[1] + arco.r * Math.sin(t)];

/** Pontos do segmento (arcos em trechos de ~5°). */
export function segPoints(l) {
  if (!l.arco) return [l.a, l.b];
  const s = sweepOf(l.arco), n = Math.max(4, Math.ceil(s / (Math.PI / 36)));
  return Array.from({ length: n + 1 }, (_, i) => arcPoint(l.arco, l.arco.a0 + s * i / n));
}

// ---------------------------------------------------------------- planos (nível ou eixo de trabalho)

/** Plano de desenho de uma linha: { o, u, v } (o do nível é o horizontal na cota z). */
export const frameOf = l => l.plano || { o: [0, 0, l.z], u: [1, 0, 0], v: [0, 1, 0] };

/** Matriz plano → modelo (X = u, Y = v, Z = normal). */
export function planeMatrix(f) {
  const u = new THREE.Vector3(...f.u).normalize(), v = new THREE.Vector3(...f.v).normalize();
  return new THREE.Matrix4().makeBasis(u, v, u.clone().cross(v)).setPosition(...f.o);
}

/** Os dois planos são o mesmo (normais paralelas e distância < 1 cm)? */
export function samePlane(f1, f2) {
  const m1 = planeMatrix(f1), m2 = planeMatrix(f2);
  const n1 = new THREE.Vector3().setFromMatrixColumn(m1, 2), n2 = new THREE.Vector3().setFromMatrixColumn(m2, 2);
  if (Math.abs(Math.abs(n1.dot(n2)) - 1) > 1e-6) return false;
  return Math.abs(new THREE.Vector3(...f2.o).sub(new THREE.Vector3(...f1.o)).dot(n1)) < 0.01;
}

/** Pontos 3D (modelo) de uma linha. */
export function worldPoints(l) {
  const m = planeMatrix(frameOf(l));
  return segPoints(l).map(p => new THREE.Vector3(p[0], p[1], 0).applyMatrix4(m));
}

/**
 * Re-expressa a linha nas coordenadas de outro plano (o mesmo plano geométrico, outro referencial).
 * target: { plano: null | { o, u, v }, z } — o formato das linhas daquele plano.
 */
export function toFrame(l, target) {
  const tf = target.plano || { o: [0, 0, target.z], u: [1, 0, 0], v: [0, 1, 0] };
  const src = planeMatrix(frameOf(l)), inv = planeMatrix(tf).invert();
  const m = inv.multiply(src);
  const tp = p => { const q = new THREE.Vector3(p[0], p[1], 0).applyMatrix4(m); return [q.x, q.y]; };
  const out = { ...l, z: target.plano ? 0 : target.z, a: tp(l.a), b: tp(l.b) };
  if (target.plano) out.plano = target.plano; else delete out.plano;
  if (l.arco) {
    const flip = new THREE.Vector3().setFromMatrixColumn(m, 2).z < 0; // normal ao contrário: o arco inverte o sentido
    const c = tp(l.arco.c), s = sweepOf(l.arco);
    const ang = p => Math.atan2(p[1] - c[1], p[0] - c[0]);
    const A = out.a, B = out.b;
    const a0 = flip ? ang(B) : ang(A);
    out.arco = { c, r: l.arco.r, a0, a1: a0 + s };
    if (flip) { out.a = B; out.b = A; }
  }
  return out;
}

function linePoints(l) {
  const m = planeMatrix(frameOf(l));
  return segPoints(l).map(p => new THREE.Vector3(p[0], p[1], 0.002).applyMatrix4(m));
}

const labelOf = l => (l.arco ? (isCircle(l) ? 'Círculo' : 'Arco') : 'Linha');

function propsOf(l) {
  const where = l.plano ? { Plano: 'Eixo de trabalho' } : { Cota: l.z };
  if (!l.arco) return { Comprimento: +dist(l.a, l.b).toFixed(3), ...where };
  return { Raio: +l.arco.r.toFixed(3), Comprimento: +(l.arco.r * sweepOf(l.arco)).toFixed(3), ...where };
}

/** Elemento de linha/arco/círculo a partir dos dados. */
export function buildSketch(bim) {
  const g = new THREE.Group();
  g.userData.bim = bim;
  rebuildSketch(g);
  return g;
}

export function createSketch(linha, level) {
  const bim = { type: 'IfcAnnotation', name: labelOf(linha), guid: uuid(), levelId: level?.id || null, linha, props: {} };
  return buildSketch(bim);
}

export function rebuildSketch(el) {
  const b = el.userData.bim, l = b.linha;
  for (const c of [...el.children]) {
    el.remove(c);
    c.geometry?.dispose();
    (c.userData._origMat || c.material)?.dispose?.(); // material próprio (o de seleção da linha de dados é compartilhado)
    if (c.userData.wide && c.userData._origMat) c.material.dispose(); // cópia azul do traçado selecionado
  }
  const pts = linePoints(l);
  const { base, display } = styledLine(pts, l.estilo);
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), base);
  line.userData.sketchLine = true;
  el.add(line);
  if (display) el.add(display);
  b.name = b.name && !/^(Linha|Arco|Círculo)$/.test(b.name) ? b.name : labelOf(l);
  el.name = b.name;
  b.props = { ...(b.props || {}), ...propsOf(l) };
  return el;
}

export const isSketch = el => !!el?.userData?.bim?.linha;

/** Leva a transformação do grupo (mover/girar) para os dados e zera a transformação. */
export function bake(el) {
  const m = el.matrix;
  el.updateMatrix();
  const isId = m.equals(new THREE.Matrix4());
  if (isId) return el;
  const l = el.userData.bim.linha;
  if (l.plano) {
    // linha num eixo de trabalho: a transformação vai para o plano (origem e eixos); escala nas coordenadas
    const M = planeMatrix(l.plano).premultiply(el.matrix);
    const col = i => new THREE.Vector3().setFromMatrixColumn(M, i);
    const sc = col(0).length() || 1;
    const o = new THREE.Vector3().setFromMatrixPosition(M);
    l.plano = { o: o.toArray(), u: col(0).normalize().toArray(), v: col(1).normalize().toArray() };
    const s2 = p => [p[0] * sc, p[1] * sc];
    l.a = s2(l.a); l.b = s2(l.b);
    if (l.arco) l.arco = { ...l.arco, c: s2(l.arco.c), r: l.arco.r * sc };
    el.position.set(0, 0, 0); el.quaternion.identity(); el.scale.set(1, 1, 1);
    rebuildSketch(el);
    return el;
  }
  const tp = p => { const v = new THREE.Vector3(p[0], p[1], l.z).applyMatrix4(el.matrix); return [v.x, v.y, v.z]; };
  const a = tp(l.a), b = tp(l.b);
  const rot = new THREE.Euler().setFromQuaternion(el.quaternion, 'ZYX').z;
  const sc = el.scale.x;
  l.z = a[2];
  l.a = [a[0], a[1]]; l.b = [b[0], b[1]];
  if (l.arco) { const c = tp(l.arco.c); l.arco = { c: [c[0], c[1]], r: l.arco.r * sc, a0: l.arco.a0 + rot, a1: l.arco.a1 + rot }; }
  el.position.set(0, 0, 0); el.quaternion.identity(); el.scale.set(1, 1, 1);
  rebuildSketch(el);
  return el;
}

// ---------------------------------------------------------------- interseções

/** Parâmetro t ao longo de uma reta (a→b) ou ângulo ao longo de um arco, para um ponto sobre ela. */
export function paramOf(l, p) {
  if (!l.arco) { const d = sub(l.b, l.a); return dot(sub(p, l.a), d) / (dot(d, d) || 1); }
  return normAng(Math.atan2(p[1] - l.arco.c[1], p[0] - l.arco.c[0]) - l.arco.a0); // 0..2π a partir de a0
}

/** O ponto (já sobre a curva) está dentro do trecho desenhado? */
function onSeg(l, p, tol = 1e-7) {
  if (!l.arco) { const t = paramOf(l, p); return t >= -tol && t <= 1 + tol; }
  return paramOf(l, p) <= sweepOf(l.arco) + tol;
}

/** Interseções das curvas suporte (retas infinitas / círculos completos). */
function rawIntersections(l1, l2) {
  if (!l1.arco && !l2.arco) {
    const d1 = sub(l1.b, l1.a), d2 = sub(l2.b, l2.a), den = cross(d1, d2);
    if (Math.abs(den) < 1e-12) return [];
    const t = cross(sub(l2.a, l1.a), d2) / den;
    return [add(l1.a, mul(d1, t))];
  }
  if (l1.arco && l2.arco) {
    const c1 = l1.arco.c, c2 = l2.arco.c, r1 = l1.arco.r, r2 = l2.arco.r, d = dist(c1, c2);
    if (d < EPS || d > r1 + r2 + EPS || d < Math.abs(r1 - r2) - EPS) return [];
    const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d), hh = Math.sqrt(Math.max(0, r1 * r1 - a * a));
    const m = add(c1, mul(sub(c2, c1), a / d)), perp = [-(c2[1] - c1[1]) / d, (c2[0] - c1[0]) / d];
    return hh < EPS ? [m] : [add(m, mul(perp, hh)), sub(m, mul(perp, hh))];
  }
  const ln = l1.arco ? l2 : l1, ar = (l1.arco ? l1 : l2).arco;
  const d = sub(ln.b, ln.a), f = sub(ln.a, ar.c);
  const A = dot(d, d), B = 2 * dot(f, d), C = dot(f, f) - ar.r * ar.r, disc = B * B - 4 * A * C;
  if (disc < 0 || A < EPS) return [];
  const s = Math.sqrt(disc);
  return [(-B - s) / (2 * A), (-B + s) / (2 * A)].map(t => add(ln.a, mul(d, t)));
}

/** Interseções dentro dos dois trechos. */
export function intersections(l1, l2) {
  return rawIntersections(l1, l2).filter(p => onSeg(l1, p) && onSeg(l2, p));
}

// ---------------------------------------------------------------- aparar e estender

/**
 * Aparar (como o TRIM do AutoCAD): remove o trecho do segmento entre as duas interseções que cercam o ponto
 * clicado. Devolve a lista de segmentos que ficam (0, 1 ou 2) ou null se não há o que aparar.
 */
export function trim(l, click, others) {
  const cuts = [];
  for (const o of others) for (const p of intersections(l, o)) cuts.push(p);
  if (!l.arco) {
    const tc = paramOf(l, click);
    const ts = [...new Set(cuts.map(p => paramOf(l, p)).filter(t => t > 1e-6 && t < 1 - 1e-6).map(t => +t.toFixed(9)))].sort((x, y) => x - y);
    if (!ts.length) return null;
    const lo = Math.max(0, ...ts.filter(t => t < tc)), hi = Math.min(1, ...ts.filter(t => t > tc));
    const at = t => add(l.a, mul(sub(l.b, l.a), t));
    const out = [];
    if (lo > 1e-6) out.push({ ...l, a: l.a, b: at(lo) });
    if (hi < 1 - 1e-6) out.push({ ...l, a: at(hi), b: l.b });
    return out;
  }
  const ar = l.arco;
  if (isCircle(l)) {
    // círculo: precisa de pelo menos dois cortes; fica o arco oposto ao clique
    const as = [...new Set(cuts.map(p => +normAng(Math.atan2(p[1] - ar.c[1], p[0] - ar.c[0])).toFixed(9)))].sort((x, y) => x - y);
    if (as.length < 2) return null;
    const ac = normAng(Math.atan2(click[1] - ar.c[1], click[0] - ar.c[0]));
    let i = as.findIndex(a => a > ac); if (i < 0) i = 0;
    const end = as[i], start = as[(i - 1 + as.length) % as.length];
    // remove de start a end (passando pelo clique); fica de end até start
    return [mkArc(ar.c, ar.r, end, start)];
  }
  const s = sweepOf(ar), tc = paramOf(l, click);
  const ts = [...new Set(cuts.map(p => paramOf(l, p)).filter(t => t > 1e-6 && t < s - 1e-6).map(t => +t.toFixed(9)))].sort((x, y) => x - y);
  if (!ts.length) return null;
  const lo = Math.max(0, ...ts.filter(t => t < tc)), hi = Math.min(s, ...ts.filter(t => t > tc));
  const out = [];
  if (lo > 1e-6) out.push(mkArc(ar.c, ar.r, ar.a0, ar.a0 + lo, l.z));
  if (hi < s - 1e-6) out.push(mkArc(ar.c, ar.r, ar.a0 + hi, ar.a0 + s, l.z));
  return out.map(x => ({ ...x, z: l.z }));
}

export function mkArc(c, r, a0, a1, z = 0) {
  const arco = { c: [...c], r, a0, a1 };
  return { z, a: arcPoint(arco, a0), b: arcPoint(arco, a1), arco };
}

/**
 * Estender (como o EXTEND do AutoCAD): leva a ponta mais próxima do clique até a primeira curva que a reta
 * encontra além dela. Só retas. Devolve o segmento novo ou null.
 */
export function extend(l, click, others) {
  if (l.arco) return null;
  const endB = dist(click, l.b) <= dist(click, l.a);
  const from = endB ? l.b : l.a, dir = norm(endB ? sub(l.b, l.a) : sub(l.a, l.b));
  const ray = { a: from, b: add(from, dir) };
  let best = null, bestT = Infinity;
  for (const o of others) {
    for (const p of rawIntersections(ray, o)) {
      if (!onSeg(o, p)) continue;
      const t = dot(sub(p, from), dir);
      if (t > 1e-6 && t < bestT) { bestT = t; best = p; }
    }
  }
  if (!best) return null;
  return endB ? { ...l, b: best } : { ...l, a: best };
}

// ---------------------------------------------------------------- canto (vivo, arredondado, chanfro)

/**
 * Canto entre duas retas (como FILLET/CHAMFER do AutoCAD). As partes mantidas são as do lado dos cliques.
 *   modo 'vivo' ....... estende/apara as duas até se encontrarem (raio 0)
 *   modo 'raio' ....... arco tangente às duas, de raio r
 *   modo 'chanfro' .... corta a quina: distância d na primeira reta e ângulo θ (graus) a partir dela
 * Devolve { l1, l2, extra } (extra = arco ou reta do canto) ou lança erro com o motivo.
 */
export function corner(l1, c1, l2, c2, { modo = 'vivo', raio = 0.5, distancia = 0.3, angulo = 45 } = {}) {
  if (l1.arco || l2.arco) throw new Error('O canto funciona entre duas linhas retas.');
  const P = rawIntersections(l1, l2)[0];
  if (!P) throw new Error('As linhas são paralelas.');
  // ponta de cada linha que vai até o canto: a do lado oposto ao clique (mantém o trecho clicado)
  // ponta mantida: a do lado do clique em relação ao canto (com P além da linha, a ponta oposta a P)
  const keepFar = (l, c) => (paramOf(l, c) > paramOf(l, P) ? l.b : l.a);
  const far1 = keepFar(l1, c1), far2 = keepFar(l2, c2);
  const u1 = norm(sub(far1, P)), u2 = norm(sub(far2, P)); // direções do canto para fora, ao longo de cada linha
  if (modo === 'vivo' || (modo === 'raio' && !(raio > 0))) {
    return { l1: { ...l1, a: far1, b: P }, l2: { ...l2, a: P, b: far2 }, extra: null };
  }
  if (modo === 'raio') {
    const th = Math.acos(Math.max(-1, Math.min(1, dot(u1, u2)))); // ângulo entre as linhas
    if (th < 1e-3 || th > Math.PI - 1e-3) throw new Error('As linhas estão alinhadas.');
    const t = raio / Math.tan(th / 2); // distância do vértice até os pontos de tangência
    if (t > dist(far1, P) + 1e-9 || t > dist(far2, P) + 1e-9) throw new Error('Raio grande demais para estas linhas.');
    const T1 = add(P, mul(u1, t)), T2 = add(P, mul(u2, t));
    const bis = norm(add(u1, u2));
    const C = add(P, mul(bis, raio / Math.sin(th / 2)));
    let a0 = Math.atan2(T1[1] - C[1], T1[0] - C[0]), a1 = Math.atan2(T2[1] - C[1], T2[0] - C[0]);
    // arco curto entre T1 e T2, no sentido anti-horário
    let s = normAng(a1 - a0);
    if (s > Math.PI) [a0, a1] = [a1, a0];
    return { l1: { ...l1, a: far1, b: T1 }, l2: { ...l2, a: T2, b: far2 }, extra: mkArc(C, raio, a0, a0 + normAng(a1 - a0), l1.z) };
  }
  // chanfro: distância d na linha 1 e ângulo θ medido a partir da linha 1
  const th = Math.acos(Math.max(-1, Math.min(1, dot(u1, u2))));
  const ang = angulo * Math.PI / 180;
  if (!(distancia > 0) || ang <= 0 || ang >= Math.PI - th) throw new Error('Distância ou ângulo inválidos para este canto.');
  const A = add(P, mul(u1, distancia));
  // lei dos senos no triângulo P-A-B: ângulo em A = θc, em P = th → |PB| = d·sin(θc)/sin(π − th − θc)
  const pb = distancia * Math.sin(ang) / Math.sin(Math.PI - th - ang);
  if (pb > dist(far2, P) + 1e-9 || distancia > dist(far1, P) + 1e-9) throw new Error('Chanfro maior que as linhas.');
  const Bp = add(P, mul(u2, pb));
  return { l1: { ...l1, a: far1, b: A }, l2: { ...l2, a: Bp, b: far2 }, extra: { z: l1.z, a: A, b: Bp, arco: null } };
}

/**
 * OFFSET de uma polilinha: cada trecho deslocado de d (positivo = à esquerda do sentido), com os cantos em
 * esquadria (interseção das retas deslocadas). Devolve [{ a, b }] — um por trecho. Usado pelo Offset 2D/3D e
 * pelos eixos das paredes (linha de localização).
 */
export function offsetPolyline(pts, d, closed) {
  const n = pts.length, m = closed ? n : n - 1;
  const segs = [];
  for (let i = 0; i < m; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const nx = -(b[1] - a[1]) / L, ny = (b[0] - a[0]) / L;
    segs.push({ a: [a[0] + nx * d, a[1] + ny * d], b: [b[0] + nx * d, b[1] + ny * d] });
  }
  const meet = (s1, s2) => {
    const d1 = [s1.b[0] - s1.a[0], s1.b[1] - s1.a[1]], d2 = [s2.b[0] - s2.a[0], s2.b[1] - s2.a[1]];
    const den = d1[0] * d2[1] - d1[1] * d2[0];
    if (Math.abs(den) < 1e-12) return [...s1.b]; // trechos alinhados: continua reto
    const t = ((s2.a[0] - s1.a[0]) * d2[1] - (s2.a[1] - s1.a[1]) * d2[0]) / den;
    return [s1.a[0] + d1[0] * t, s1.a[1] + d1[1] * t];
  };
  const out = segs.map(x => ({ a: [...x.a], b: [...x.b] }));
  for (let i = 0; i < segs.length; i++) {
    let j = i + 1;
    if (j >= segs.length) { if (!closed || segs.length < 2) break; j = 0; }
    const p = meet(segs[i], segs[j]).map(v => +v.toFixed(6));
    out[i].b = p; out[j].a = [...p];
  }
  return out;
}

/**
 * OFFSET LIMPO: como offsetPolyline, mas os trechos que "somem" no deslocamento (ficam invertidos ou com tamanho zero
 * — ex.: um chanfro curto num offset para dentro maior que ele) saem, e os vizinhos se encontram direto. Evita o
 * contorno cruzado (laço). Pode devolver menos trechos que a polilinha original.
 */
export function offsetPolylineClean(pts, d, closed) {
  let P = pts.map(p => [...p]);
  for (let guard = 0; guard < pts.length; guard++) {
    const out = offsetPolyline(P, d, closed);
    const n = P.length;
    // trecho invertido (ou nulo) em relação ao original
    const bad = out.findIndex((s, i) => {
      if (!closed && (i === 0 || i === out.length - 1) && out.length > 1) return false; // pontas da aberta: ficam
      const a = P[i], b = P[(i + 1) % n];
      const ox = b[0] - a[0], oy = b[1] - a[1], nx = s.b[0] - s.a[0], ny = s.b[1] - s.a[1];
      return ox * nx + oy * ny <= 1e-9;
    });
    if (bad < 0) return out;
    if ((closed && n <= 3) || (!closed && n <= 2)) return out;
    // tira o trecho: os pontos dele viram o encontro das retas vizinhas (a polilinha perde um ponto)
    const A = P[(bad - 1 + n) % n], B = P[bad], C = P[(bad + 1) % n], D = P[(bad + 2) % n];
    const d1 = [B[0] - A[0], B[1] - A[1]], d2 = [C[0] - D[0], C[1] - D[1]], den = d1[0] * d2[1] - d1[1] * d2[0];
    let X;
    if (Math.abs(den) < 1e-12) X = [(B[0] + C[0]) / 2, (B[1] + C[1]) / 2];
    else { const t = ((D[0] - A[0]) * d2[1] - (D[1] - A[1]) * d2[0]) / den; X = [A[0] + d1[0] * t, A[1] + d1[1] * t]; }
    P = P.filter((_, k) => k !== bad && k !== (bad + 1) % n);
    P.splice(Math.min(bad, P.length), 0, X);
  }
  return offsetPolyline(P, d, closed);
}

/**
 * Offset de um contorno fechado para FORA da região (d > 0 cresce, d < 0 encolhe). hole = true: o contorno é um
 * furo (para fora da região = para dentro do furo). Devolve os pontos.
 */
export function offsetLoop(pts, d, hole = false) {
  const sgn = Math.sign(area(pts)) || 1;
  const dl = (hole ? d : -d) * sgn; // anti-horário: o lado de dentro é a esquerda
  return offsetPolylineClean(pts, dl, true).map(s => s.a);
}

// ---------------------------------------------------------------- contornos (para extrudar e varrer)

const key = p => `${p[0].toFixed(5)},${p[1].toFixed(5)}`;

/**
 * Encadeia segmentos pelas pontas. Devolve { loops: [[ponto]…] fechados, chains: [[ponto]…] abertos }, com os
 * arcos já em pontos. Círculos inteiros viram um contorno cada.
 */
export function chainSegments(segs) {
  const loops = [], chains = [];
  const rest = [];
  for (const s of segs) {
    if (isCircle(s)) { const pts = segPoints(s); pts.pop(); loops.push(pts); } else rest.push(s);
  }
  const used = new Set();
  const ends = new Map();
  rest.forEach((s, i) => { for (const p of [s.a, s.b]) { const k = key(p); if (!ends.has(k)) ends.set(k, []); ends.get(k).push(i); } });
  const ptsOf = (s, fromA) => { const p = segPoints(s); return fromA ? p : p.reverse(); };
  for (let i = 0; i < rest.length; i++) {
    if (used.has(i)) continue;
    used.add(i);
    let pts = ptsOf(rest[i], true);
    // cresce para os dois lados
    for (const side of ['fim', 'inicio']) {
      for (;;) {
        const endP = side === 'fim' ? pts[pts.length - 1] : pts[0];
        const next = (ends.get(key(endP)) || []).find(j => !used.has(j));
        if (next === undefined) break;
        used.add(next);
        const s = rest[next];
        const fromA = key(s.a) === key(endP);
        const add2 = ptsOf(s, fromA).slice(1);
        pts = side === 'fim' ? pts.concat(add2) : add2.reverse().concat(pts);
      }
    }
    if (pts.length > 3 && key(pts[0]) === key(pts[pts.length - 1])) { pts.pop(); loops.push(pts); } else chains.push(pts);
  }
  return { loops, chains };
}

export const area = pts => pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;

export function pointInPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Contornos externos com os furos dentro deles. */
export function outerWithHoles(loops) {
  const items = loops.map(l => ({ pts: l, a: Math.abs(area(l)) })).sort((x, y) => y.a - x.a);
  const outers = [];
  for (const it of items) {
    const host = outers.find(o => pointInPoly(it.pts[0], o.pts) && !o.holes.some(hl => pointInPoly(it.pts[0], hl)));
    if (host) host.holes.push(it.pts); else outers.push({ pts: it.pts, holes: [] });
  }
  return outers.map(o => ({ perfil: o.pts, furos: o.holes }));
}

/**
 * ARCOS numa polilinha (fechada ou aberta): curvas guardadas como vários trechos retos — canto arredondado do piso,
 * arestas de cilindros e furos redondos — voltam a ser UM arco. Uma sequência de 3+ trechos do mesmo tamanho com a
 * mesma curva (até 30° por trecho) vira arco. Devolve [{ a, b, arco: null | { c, r, a0, a1 } }] (arco anti-horário
 * de a0 a a1, como nas linhas 2D). Uma volta inteira vira um círculo.
 */
export function polylineArcs(pts, closed) {
  const n = pts.length, m = closed ? n : n - 1; // m trechos
  if (m < 1) return [];
  const P = k => pts[closed ? ((k % n) + n) % n : k];
  const len = k => Math.hypot(P(k + 1)[0] - P(k)[0], P(k + 1)[1] - P(k)[1]);
  const dirOf = k => Math.atan2(P(k + 1)[1] - P(k)[1], P(k + 1)[0] - P(k)[0]);
  const turn = k => { let t = dirOf(k + 1) - dirOf(k); while (t > Math.PI) t -= 2 * Math.PI; while (t < -Math.PI) t += 2 * Math.PI; return t; }; // no ponto k+1
  const eqLen = (i, j) => Math.abs(len(i) - len(j)) <= Math.max(1e-4, len(i) * 0.02);
  const okTurn = t => Math.abs(t) > 1e-4 && Math.abs(t) < Math.PI / 6;
  // trecho k continua o arco do anterior? (contorno fechado)
  const cont = k => eqLen(k, k - 1) && okTurn(turn(k - 1)) && Math.abs(turn(k - 1) - turn(k - 2)) < 0.02; // (só na fechada)
  // volta inteira (círculo): todos os trechos iguais e com a mesma curva
  if (closed && n >= 6 && [...Array(n).keys()].every(k => eqLen(k, 0) && okTurn(turn(k)) && Math.abs(turn(k) - turn(0)) < 0.02)) {
    const cx = pts.reduce((s, p) => s + p[0], 0) / n, cy = pts.reduce((s, p) => s + p[1], 0) / n;
    const r = pts.reduce((s, p) => s + Math.hypot(p[0] - cx, p[1] - cy), 0) / n;
    return [{ a: [cx + r, cy], b: [cx + r, cy], arco: { c: [cx, cy], r, a0: 0, a1: 2 * Math.PI } }];
  }
  // fechada: começa num trecho que não continua um arco
  let s = 0;
  if (closed) for (let k = 0; k < m; k++) if (!cont(k)) { s = k; break; }
  const out = [];
  let k = 0;
  while (k < m) {
    const i = s + k;
    let q = 1;
    while (k + q < m && eqLen(i + q, i) && okTurn(turn(i + q - 1)) && (q === 1 || Math.abs(turn(i + q - 1) - turn(i + q - 2)) < 0.02)) q++;
    if (q >= 3) {
      const A = P(i), B = P(i + 1), C = P(i + q), M = P(i + Math.floor(q / 2));
      const d = 2 * (A[0] * (M[1] - C[1]) + M[0] * (C[1] - A[1]) + C[0] * (A[1] - M[1]));
      if (Math.abs(d) > 1e-12) {
        const a2 = A[0] ** 2 + A[1] ** 2, m2 = M[0] ** 2 + M[1] ** 2, c2 = C[0] ** 2 + C[1] ** 2;
        const c = [(a2 * (M[1] - C[1]) + m2 * (C[1] - A[1]) + c2 * (A[1] - M[1])) / d, (a2 * (C[0] - M[0]) + m2 * (A[0] - C[0]) + c2 * (M[0] - A[0])) / d];
        const r = Math.hypot(A[0] - c[0], A[1] - c[1]);
        const ccw = (B[0] - A[0]) * (c[1] - A[1]) - (B[1] - A[1]) * (c[0] - A[0]) > 0; // centro à esquerda = anti-horário
        const angA = Math.atan2(A[1] - c[1], A[0] - c[0]), angC = Math.atan2(C[1] - c[1], C[0] - c[0]);
        let a0 = ccw ? angA : angC, a1 = ccw ? angC : angA;
        while (a1 <= a0) a1 += 2 * Math.PI;
        out.push({ a: ccw ? A : C, b: ccw ? C : A, arco: { c, r, a0, a1 } });
        k += q;
        continue;
      }
    }
    out.push({ a: P(i), b: P(i + 1), arco: null });
    k += 1;
  }
  return out;
}

// pontos de encaixe das linhas: pontas, meios e centros
export function snapPointsOf(l) {
  if (!l.arco) return [{ p: l.a, kind: 'ponta' }, { p: l.b, kind: 'ponta' }, { p: mul(add(l.a, l.b), 0.5), kind: 'meio' }];
  const out = [{ p: l.arco.c, kind: 'centro' }];
  if (!isCircle(l)) out.push({ p: l.a, kind: 'ponta' }, { p: l.b, kind: 'ponta' }, { p: arcPoint(l.arco, l.arco.a0 + sweepOf(l.arco) / 2), kind: 'meio' });
  else for (let k = 0; k < 4; k++) out.push({ p: arcPoint(l.arco, k * Math.PI / 2), kind: 'quadrante' });
  return out;
}

/** Distância de um ponto ao segmento (para escolher o segmento clicado). */
export function distToSeg(l, p) {
  if (!l.arco) {
    const d = sub(l.b, l.a), t = Math.max(0, Math.min(1, dot(sub(p, l.a), d) / (dot(d, d) || 1)));
    return dist(p, add(l.a, mul(d, t)));
  }
  const ang = normAng(Math.atan2(p[1] - l.arco.c[1], p[0] - l.arco.c[0]) - l.arco.a0);
  if (ang <= sweepOf(l.arco)) return Math.abs(dist(p, l.arco.c) - l.arco.r);
  return Math.min(dist(p, l.a), dist(p, l.b));
}
