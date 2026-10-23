// ELEMENTOS LINEARES nas ferramentas de desenho: Aparar, Estender, Canto (vivo, raio, chanfro) e Offset valem também
// para paredes, vigas e varreduras (canos, perfis, corrimãos…), não só para as linhas 2D.
// Cada elemento vira um ou mais "trechos" no plano (XY do modelo): { kind, el, i, l: { a, b, arco: null, z }, apply }.
//   apply(pedaços) ... grava o resultado da ferramenta no elemento (o 1º pedaço fica no próprio elemento; os outros
//                      viram cópias); arcos (canto com raio) viram vários trechos curtos (paredes e vigas) ou um
//                      caminho curvo (varreduras).
// Paredes e vigas ligadas pelas pontas recebem cantos em meia-esquadria (autoMiter); a ponta que chega no meio de
// outra (junção em T) para na FACE dela, cortada no ângulo dela (fixTees).
import * as THREE from 'three';
import { uuid, rebuildElement } from '../elements.js';
import { rebuildForm } from './forms.js';
import { offsetPolyline, pointInPoly, area, distToSeg } from './sketch.js';

const MITER_MAX = 150 * Math.PI / 180;
const ARC_STEP = Math.PI / 18; // arco em trechos de até 10°
const r6 = v => +(+v).toFixed(6);
const key = p => `${p[0].toFixed(4)},${p[1].toFixed(4)}`;

export const linearKind = el => {
  const b = el?.userData?.bim;
  if (!b) return null;
  if (b.wall) return 'parede';
  if (b.beam) return 'viga';
  if (b.forma?.tipo === 'varredura') return 'varredura';
  return null;
};
export const KIND_LABEL = { parede: 'parede', viga: 'viga', varredura: 'varredura' };

/** Leva a transformação de uma forma (mover/girar) para o caminho, para editar nas coordenadas do modelo. */
function bakeSweep(el) {
  el.updateMatrix();
  if (el.matrix.equals(new THREE.Matrix4())) return;
  const f = el.userData.bim.forma;
  f.caminho = f.caminho.map(p => new THREE.Vector3(p[0], p[1], p[2] ?? 0).applyMatrix4(el.matrix).toArray().map(r6));
  el.position.set(0, 0, 0); el.quaternion.identity(); el.scale.set(1, 1, 1);
  rebuildForm(el);
}

/** Dados do eixo (parede/viga): { d, z } com d = bim.wall | bim.beam. */
const axisData = el => { const b = el.userData.bim; return b.wall ? { d: b.wall, z: b.wall.base } : { d: b.beam, z: b.beam.top }; };

/** Trechos editáveis de um elemento linear (coordenadas XY do modelo). */
export function handlesOf(app, el) {
  const kind = linearKind(el);
  if (!kind) return [];
  el.updateMatrixWorld(true);
  if (kind === 'varredura') {
    bakeSweep(el);
    const c = el.userData.bim.forma.caminho;
    return c.slice(1).map((p, i) => ({
      kind, el, i, l: { a: [c[i][0], c[i][1]], b: [p[0], p[1]], arco: null, z: c[i][2] ?? 0 },
      apply: pieces => applySweep(app, el, i, pieces),
    }));
  }
  const { d, z } = axisData(el);
  const A = new THREE.Vector3(d.start[0], d.start[1], z).applyMatrix4(el.matrixWorld);
  const B = new THREE.Vector3(d.end[0], d.end[1], z).applyMatrix4(el.matrixWorld);
  return [{ kind, el, i: 0, l: { a: [A.x, A.y], b: [B.x, B.y], arco: null, z: A.z }, apply: pieces => applyAxis(app, el, pieces) }];
}

/** Arco → pontos (trechos de até 10°). */
function arcPts(l) {
  if (!l.arco) return [l.a, l.b];
  const s = l.arco.a1 - l.arco.a0, n = Math.max(2, Math.ceil(Math.abs(s) / ARC_STEP));
  return Array.from({ length: n + 1 }, (_, k) => { const t = l.arco.a0 + s * k / n; return [l.arco.c[0] + l.arco.r * Math.cos(t), l.arco.c[1] + l.arco.r * Math.sin(t)]; });
}

/** Ordena os pontos de um trecho extra (arco/chanfro) para continuar a sequência do trecho reto vizinho. */
function follow(pts, s) {
  if (!s) return pts;
  const near = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-6;
  const last = pts[pts.length - 1];
  if (near(s.b, pts[0]) || near(s.a, last)) return pts;      // o reto chega no começo / sai do fim do extra
  if (near(s.b, last) || near(s.a, pts[0])) return [...pts].reverse();
  return pts;
}

/** Pedaço na mesma orientação do original (paredes têm lado interno/externo; vãos medem a partir do início). */
function oriented(orig, pc) {
  if (pc.arco) return pc;
  const d0 = [orig.b[0] - orig.a[0], orig.b[1] - orig.a[1]], d1 = [pc.b[0] - pc.a[0], pc.b[1] - pc.a[1]];
  return d0[0] * d1[0] + d0[1] * d1[1] < 0 ? { ...pc, a: pc.b, b: pc.a } : pc;
}

/** Cópia de parede/viga com novo eixo (pontas no modelo). Os vãos ficam na original. */
function cloneAxis(el, a, b) {
  const copy = new THREE.Group();
  const bim = structuredClone(el.userData.bim);
  bim.guid = uuid();
  if (bim.wall) { bim.wall.openings = []; bim.wall.miterStart = 0; bim.wall.miterEnd = 0; bim.wall.extendStart = 0; bim.wall.extendEnd = 0; }
  if (bim.beam) { bim.beam.miterStart = 0; bim.beam.miterEnd = 0; }
  copy.userData.bim = bim;
  copy.name = bim.name;
  setAxis(copy, a, b, el.userData.bim.wall ? el.userData.bim.wall.base : el.userData.bim.beam.top);
  return copy;
}

/** Grava o eixo (pontas no modelo, Z ignorado) nos dados locais do elemento. */
function setAxis(el, a, b, z) {
  el.updateMatrixWorld(true);
  const inv = el.matrixWorld.clone().invert();
  const { d } = axisData(el);
  const pa = new THREE.Vector3(a[0], a[1], z).applyMatrix4(inv), pb = new THREE.Vector3(b[0], b[1], z).applyMatrix4(inv);
  // vãos medidos do início: acompanham o deslocamento do início ao longo do eixo
  if (d.openings?.length) {
    const L = Math.hypot(d.end[0] - d.start[0], d.end[1] - d.start[1]) || 1;
    const ux = (d.end[0] - d.start[0]) / L, uy = (d.end[1] - d.start[1]) / L;
    const shift = (pa.x - d.start[0]) * ux + (pa.y - d.start[1]) * uy;
    d.openings.forEach(o => { o.offset -= shift; });
  }
  d.start = [r6(pa.x), r6(pa.y)];
  d.end = [r6(pb.x), r6(pb.y)];
  rebuildElement(el);
}

async function finishAxis(app, els) {
  autoMiter(app, els);
  fixTees(app, els);
  for (const el of els) {
    await app.system.pending(el);
    if (el.userData.bim.wall) await app.hosting.refreshHostedOf(el);
    app.viewer._prepare2D(el);
    if (app.viewer.selected.has(el)) app.viewer._highlight(el, true);
  }
  app.viewer.changed();
}

/** Resultado da ferramenta numa parede/viga: 1º pedaço no próprio elemento, os outros (e arcos) viram cópias. */
function applyAxis(app, el, pieces) {
  const orig = handlesOf(app, el)[0].l, z = axisData(el).z;
  if (!pieces.length) { app.viewer.remove(el); return []; }
  const out = [el];
  const straight = [], extra = [];
  pieces.forEach((pc, k) => (k === 0 && !pc.arco ? straight : extra).push(oriented(orig, pc)));
  if (straight.length) setAxis(el, straight[0].a, straight[0].b, z);
  for (const pc of extra) {
    const pts = follow(arcPts(pc), straight[0]);
    for (let k = 1; k < pts.length; k++) {
      const c = cloneAxis(el, pts[k - 1], pts[k]);
      app.viewer.add(c);
      out.push(c);
    }
  }
  if (!straight.length) app.viewer.remove(el);
  finishAxis(app, out.filter(x => x.parent));
  return out;
}

/** Resultado da ferramenta no trecho i do caminho de uma varredura. */
function applySweep(app, el, i, pieces) {
  const f = el.userData.bim.forma, c = f.caminho;
  const orig = { a: [c[i][0], c[i][1]], b: [c[i + 1][0], c[i + 1][1]] };
  const za = c[i][2] ?? 0, zb = c[i + 1][2] ?? 0;
  if (!pieces.length) { app.viewer.remove(el); return []; }
  const [first, ...rest] = pieces.map(pc => oriented(orig, pc));
  const out = [el];
  if (first.arco) {
    // o trecho virou arco: o caminho passa pelos pontos do arco
    const pts = arcPts(first).map(p => [r6(p[0]), r6(p[1]), za]);
    f.caminho = [...c.slice(0, i), ...pts, ...c.slice(i + 2)];
  } else if (rest.length && !rest[0].arco) {
    // aparado no meio: a varredura se divide em duas
    const p2 = [[r6(rest[0].a[0]), r6(rest[0].a[1]), za], ...c.slice(i + 1)];
    f.caminho = [...c.slice(0, i + 1), [r6(first.b[0]), r6(first.b[1]), zb]];
    f.caminho[i] = [r6(first.a[0]), r6(first.a[1]), za];
    rest.shift();
    const copy = cloneSweep(el, p2);
    app.viewer.add(copy);
    out.push(copy);
  } else {
    c[i] = [r6(first.a[0]), r6(first.a[1]), za];
    c[i + 1] = [r6(first.b[0]), r6(first.b[1]), zb];
  }
  // arcos extras (canto com raio): uma varredura curva com o mesmo perfil
  for (const pc of rest) {
    const pts = follow(arcPts(pc), first.arco ? null : first).map(p => [r6(p[0]), r6(p[1]), za]);
    const copy = cloneSweep(el, pts);
    app.viewer.add(copy);
    out.push(copy);
  }
  f.caminho = f.caminho.filter((p, k, arr) => k === 0 || Math.hypot(p[0] - arr[k - 1][0], p[1] - arr[k - 1][1], (p[2] ?? 0) - (arr[k - 1][2] ?? 0)) > 1e-6);
  if (f.caminho.length < 2) app.viewer.remove(el); else rebuildForm(el);
  out.filter(x => x.parent).forEach(x => app.viewer._prepare2D(x));
  app.viewer.changed();
  return out;
}

function cloneSweep(el, caminho) {
  const copy = new THREE.Group();
  const bim = structuredClone(el.userData.bim);
  bim.guid = uuid();
  bim.forma.caminho = caminho;
  copy.userData.bim = bim;
  copy.name = bim.name;
  rebuildForm(copy);
  return copy;
}

/**
 * Meia-esquadria automática: em cada ponta de parede/viga onde exatamente dois elementos do mesmo tipo se
 * encontram, corta na bissetriz (como ao desenhar em sequência). Recalcula os elementos dados e seus vizinhos.
 */
export function autoMiter(app, els) {
  const pool = app.viewer.elements().filter(e => e.userData.bim.wall || e.userData.bim.beam);
  const ends = new Map();
  const info = new Map();
  for (const e of pool) {
    const h = handlesOf(app, e)[0];
    if (!h) continue;
    info.set(e, h.l);
    for (const [side, p] of [['start', h.l.a], ['end', h.l.b]]) {
      const k = `${e.userData.bim.wall ? 'w' : 'b'}|${key(p)}`;
      if (!ends.has(k)) ends.set(k, []);
      ends.get(k).push({ e, side });
    }
  }
  const touched = new Set(els);
  for (const list of ends.values()) if (list.some(x => touched.has(x.e))) list.forEach(x => touched.add(x.e));
  const ang = v => Math.atan2(v[1], v[0]);
  const norm = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  for (const e of touched) {
    const l = info.get(e);
    if (!l) continue;
    const d = e.userData.bim.wall || e.userData.bim.beam;
    const t = e.userData.bim.wall ? e.userData.bim.wall.thickness : 0;
    const dir = [l.b[0] - l.a[0], l.b[1] - l.a[1]];
    const patch = {};
    for (const side of ['start', 'end']) {
      const list = ends.get(`${e.userData.bim.wall ? 'w' : 'b'}|${key(side === 'start' ? l.a : l.b)}`) || [];
      const other = list.length === 2 ? list.find(x => x.e !== e) : null;
      let phi = 0;
      if (other) {
        const ol = info.get(other.e);
        // direção do outro saindo / chegando nesta ponta
        const oAway = other.side === 'start' ? [ol.b[0] - ol.a[0], ol.b[1] - ol.a[1]] : [ol.a[0] - ol.b[0], ol.a[1] - ol.b[1]];
        phi = side === 'end' ? norm(ang(oAway) - ang(dir)) : norm(ang(dir) - ang([-oAway[0], -oAway[1]]));
      }
      const ok = Math.abs(phi) > 1e-4 && Math.abs(phi) <= MITER_MAX;
      if (side === 'start') { patch.miterStart = ok ? phi : 0; if (e.userData.bim.wall) patch.extendStart = other && !ok && Math.abs(phi) > 1e-4 ? t / 2 : 0; }
      else { patch.miterEnd = ok ? phi : 0; if (e.userData.bim.wall) patch.extendEnd = other && !ok && Math.abs(phi) > 1e-4 ? t / 2 : 0; }
    }
    const changed = Object.entries(patch).some(([k, v]) => Math.abs((d[k] || 0) - v) > 1e-9);
    if (changed) { Object.assign(d, patch); rebuildElement(e); }
  }
}

// ---------------------------------------------------------------- junções em T

const normAng = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a <= -Math.PI) a += 2 * Math.PI; return a; };

/**
 * Junção em T: a ponta de uma parede (viga) que cai DENTRO de outra do mesmo tipo — no eixo ou entre as faces, longe
 * das pontas dela — recua (ou avança) até a face da outra do seu lado e é cortada no ângulo dessa face. A de
 * passagem não muda. Devolve quantas pontas foram ajustadas.
 */
export function fixTees(app, els) {
  const pool = app.viewer.elements().filter(e => (e.userData.bim.wall || e.userData.bim.beam) && e.visible);
  const H = new Map(pool.map(e => [e, handlesOf(app, e)[0]?.l]));
  const kindKey = e => (e.userData.bim.wall ? 'w' : 'b');
  const half = e => (e.userData.bim.wall ? e.userData.bim.wall.thickness : e.userData.bim.beam.width) / 2;
  let n = 0;
  for (const E of els) {
    const l = H.get(E);
    if (!E.parent || !l) continue;
    const d = axisData(E).d;
    let a = [...l.a], b = [...l.b];
    const patch = {};
    for (const side of ['start', 'end']) {
      const P = side === 'start' ? a : b, Q = side === 'start' ? b : a;
      const len = Math.hypot(P[0] - Q[0], P[1] - Q[1]);
      if (len < 1e-6) continue;
      const eOut = [(P[0] - Q[0]) / len, (P[1] - Q[1]) / len]; // de dentro do elemento para a ponta
      for (const F of pool) {
        if (F === E || kindKey(F) !== kindKey(E)) continue;
        const fl = H.get(F);
        if (!fl) continue;
        const L = Math.hypot(fl.b[0] - fl.a[0], fl.b[1] - fl.a[1]);
        if (L < 1e-6) continue;
        const fu = [(fl.b[0] - fl.a[0]) / L, (fl.b[1] - fl.a[1]) / L], fn = [-fu[1], fu[0]];
        const rel = [P[0] - fl.a[0], P[1] - fl.a[1]];
        const t = rel[0] * fu[0] + rel[1] * fu[1];
        const tf = half(F);
        if (t < tf + 1e-3 || t > L - tf - 1e-3) continue;          // perto das pontas de F: é canto, não T
        if (Math.abs(rel[0] * fn[0] + rel[1] * fn[1]) > tf + 1e-3) continue; // a ponta não está dentro de F
        const den = eOut[0] * fn[0] + eOut[1] * fn[1];
        if (Math.abs(den) < 0.05) continue;                          // quase paralelas
        const sQ = Math.sign((Q[0] - fl.a[0]) * fn[0] + (Q[1] - fl.a[1]) * fn[1]) || 1; // lado do corpo de E
        const F0 = [fl.a[0] + fn[0] * sQ * tf, fl.a[1] + fn[1] * sQ * tf];
        const sDist = ((F0[0] - Q[0]) * fn[0] + (F0[1] - Q[1]) * fn[1]) / den;
        const NP = [Q[0] + eOut[0] * sDist, Q[1] + eOut[1] * sDist];
        // corte no ângulo da face: θ = ângulo do sentido próprio de E (início→fim) até F
        const dE = [l.b[0] - l.a[0], l.b[1] - l.a[1]];
        const th = Math.atan2(dE[0] * fu[1] - dE[1] * fu[0], dE[0] * fu[0] + dE[1] * fu[1]);
        if (side === 'start') { a = NP; patch.miterStart = normAng(Math.PI - 2 * th); if (E.userData.bim.wall) patch.extendStart = 0; }
        else { b = NP; patch.miterEnd = normAng(2 * th - Math.PI); if (E.userData.bim.wall) patch.extendEnd = 0; }
        n++;
        break;
      }
    }
    if (!Object.keys(patch).length) continue;
    const moved = Math.hypot(a[0] - l.a[0], a[1] - l.a[1]) + Math.hypot(b[0] - l.b[0], b[1] - l.b[1]) > 1e-7;
    const changed = moved || Object.entries(patch).some(([k, v]) => Math.abs((d[k] || 0) - v) > 1e-9);
    if (!changed) continue;
    Object.assign(d, patch);
    setAxis(E, a, b, axisData(E).z);
  }
  return n;
}

/** Ajusta todas as junções do projeto: cantos em meia-esquadria e T na face. */
export async function fixAllJoints(app) {
  const all = app.viewer.elements().filter(e => e.userData.bim.wall || e.userData.bim.beam);
  autoMiter(app, all);
  const n = fixTees(app, all);
  for (const el of all) { await app.system.pending(el); app.viewer._prepare2D(el); }
  app.viewer.changed();
  return { total: all.length, tees: n };
}

// ---------------------------------------------------------------- offset

/** Offset de um elemento linear (e da cadeia do mesmo tipo ligada a ele) para o lado de p — só calcula. */
export function offsetPlan(app, hit, p, dist, chain = true) {
  if (hit.kind === 'varredura') {
    const f = hit.el.userData.bim.forma, c = f.caminho;
    const pts = c.map(q => [q[0], q[1]]);
    const closed = !!f.fechado;
    const segs = offsetPolyline(pts, sideOf(pts, closed, p, hit.i) * dist, closed);
    return { kind: hit.kind, segs, closed, els: [hit.el] };
  }
  const items = chain ? chainOfAxis(app, hit.el) : { els: [hit.el], pts: [hit.l.a, hit.l.b], closed: false };
  const segs = offsetPolyline(items.pts, sideOf(items.pts, items.closed, p, items.els.indexOf(hit.el)) * dist, items.closed);
  return { kind: hit.kind, segs, closed: items.closed, els: items.els };
}

/** Cria as cópias do offset calculado (paredes/vigas com os tipos de origem; varredura com o mesmo perfil). */
export function offsetLinear(app, plan) {
  if (plan.kind === 'varredura') {
    const src = plan.els[0], c = src.userData.bim.forma.caminho;
    const pts = plan.closed ? plan.segs.map(s => s.a) : [plan.segs[0].a, ...plan.segs.map(s => s.b)];
    const copy = cloneSweep(src, pts.map((q, k) => [r6(q[0]), r6(q[1]), c[k]?.[2] ?? c[0][2] ?? 0]));
    app.viewer.add(copy);
    app.viewer.changed();
    return [copy];
  }
  const made = plan.segs.map((s, k) => {
    const c = cloneAxis(plan.els[k] || plan.els[0], s.a, s.b);
    app.viewer.add(c);
    return c;
  });
  finishAxis(app, made);
  return made;
}

/** +1 = esquerda do sentido (ou para dentro do contorno fechado anti-horário), conforme o lado do ponto. */
function sideOf(pts, closed, p, segIdx) {
  if (closed && pts.length > 2) return (pointInPoly(p, pts) ? 1 : -1) * (Math.sign(area(pts)) || 1);
  let s = Math.max(0, Math.min(pts.length - 2, segIdx));
  let best = Infinity;
  for (let k = 0; k < pts.length - 1; k++) { const dd = distToSeg({ a: pts[k], b: pts[k + 1], arco: null }, p); if (dd < best) { best = dd; s = k; } }
  const a = pts[s], b = pts[s + 1];
  return ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) >= 0 ? 1 : -1;
}

/** Paredes (ou vigas) encadeadas pelas pontas com a dada, na ordem: { els, pts, closed }. */
function chainOfAxis(app, el) {
  const same = app.viewer.elements().filter(e => (el.userData.bim.wall ? e.userData.bim.wall : e.userData.bim.beam) && e.visible);
  const L = new Map(same.map(e => [e, handlesOf(app, e)[0].l]));
  const ends = new Map();
  for (const [e, l] of L) for (const p of [l.a, l.b]) { const k = key(p); if (!ends.has(k)) ends.set(k, []); ends.get(k).push(e); }
  const used = new Set([el]);
  const l0 = L.get(el);
  let pts = [l0.a, l0.b], els = [el];
  for (const side of ['fim', 'inicio']) {
    for (;;) {
      const endP = side === 'fim' ? pts[pts.length - 1] : pts[0];
      const near = ends.get(key(endP)) || [];
      if (near.length !== 2) break;
      const nx = near.find(x => !used.has(x));
      if (!nx) break;
      used.add(nx);
      const l = L.get(nx), other = key(l.a) === key(endP) ? l.b : l.a;
      if (side === 'fim') { pts.push(other); els.push(nx); } else { pts.unshift(other); els.unshift(nx); }
    }
  }
  let closed = false;
  if (pts.length > 3 && key(pts[0]) === key(pts[pts.length - 1])) { pts.pop(); closed = true; }
  return { pts, closed, els };
}
