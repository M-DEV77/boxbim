// SNAP DO PROJETO (encaixe de objeto, como o OSNAP do AutoCAD) — usado por todas as ferramentas que pegam pontos:
//   ponta ........... extremidades de linhas, lados de pisos (e furos), eixos de paredes e vigas (canto)
//   meio ............ ponto do meio de cada trecho
//   perpendicular ... pé da perpendicular a partir do último ponto (ou do ponto fixo da ferramenta) até um trecho
// Prioridade: ponta > meio > perpendicular (dentro do raio, em pixels). O marcador mostra o tipo (quadrado, triângulo,
// símbolo ⊥) — classe .snap-marker com data-kind.
import * as THREE from 'three';
import { worldPoints } from './sketch/sketch.js';

export const SNAP_PX = 12;
export const SNAP_LABEL = { ponta: 'ponta', meio: 'meio', perpendicular: 'perpendicular', centro: 'centro' };

/**
 * Trechos do projeto em planta (coordenadas do modelo): linhas 2D horizontais, lados dos pisos e dos furos, eixos de
 * paredes e vigas. level: só desse nível (null = todos); except: elementos a ignorar.
 */
export function snapSegments(app, { level = null, except = [] } = {}) {
  const skip = new Set(except);
  const out = [];
  const v3 = (x, y, z, m) => new THREE.Vector3(x, y, z).applyMatrix4(m);
  for (const el of app.viewer.elements()) {
    if (skip.has(el) || !el.visible) continue;
    const b = el.userData.bim;
    if (!b) continue;
    if (level && !b.linha && app.levels.ofElement(el) !== level) continue;
    el.updateMatrixWorld(true);
    if (b.linha) {
      const w = worldPoints(b.linha);
      if (w.some(p => Math.abs(p.z - w[0].z) > 0.01)) continue; // só as horizontais
      for (let i = 1; i < w.length; i++) out.push({ a: [w[i - 1].x, w[i - 1].y], b: [w[i].x, w[i].y], arc: !!b.linha.arco, el });
    } else if (b.slab) {
      for (const ring of [b.slab.points, ...(b.slab.holes || [])]) ring.forEach((p, i) => {
        const q = ring[(i + 1) % ring.length], A = v3(p[0], p[1], 0, el.matrixWorld), B = v3(q[0], q[1], 0, el.matrixWorld);
        out.push({ a: [A.x, A.y], b: [B.x, B.y], el });
      });
    } else if (b.wall || b.beam) {
      const d = b.wall || b.beam, A = v3(d.start[0], d.start[1], 0, el.matrixWorld), B = v3(d.end[0], d.end[1], 0, el.matrixWorld);
      out.push({ a: [A.x, A.y], b: [B.x, B.y], el });
    }
  }
  // linhas guia da edição do piso (informativas): encaixe nelas e nos cruzamentos delas
  for (const g of app.floorSketch?.guideSegments?.() || []) out.push({ ...g, guia: true });
  return out;
}

/** Pontos de encaixe dos trechos: pontas e meios (os arcos em pedaços só dão as pontas de verdade). */
export function snapPointsOfSegments(segs) {
  const pts = [];
  for (const s of segs) {
    if (s.guia) continue; // a guia é "infinita": sem pontas nem meio
    pts.push({ p: s.a, kind: 'ponta' }, { p: s.b, kind: 'ponta' });
    if (!s.arc) pts.push({ p: [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2], kind: 'meio' });
  }
  return pts;
}

/**
 * Melhor encaixe para o cursor. toScreen([x, y]) → [px, py] (tela); cursor [px, py]; from: ponto de partida (para a
 * perpendicular); points: pontos extras ({ p, kind }); tol: raio em px. Devolve { p, kind } ou null.
 */
export function snapPick({ segs, points = [], toScreen, cursor, from = null, tol = SNAP_PX }) {
  const same = p => from && Math.hypot(p[0] - from[0], p[1] - from[1]) < 1e-6; // não encaixa no próprio ponto de partida
  const order = { ponta: 0, centro: 1, intersecao: 1.5, meio: 2, perpendicular: 3, guia: 4 };
  let best = null;
  const consider = (p, kind) => {
    if (same(p)) return;
    const s = toScreen(p), d = Math.hypot(s[0] - cursor[0], s[1] - cursor[1]);
    if (d > tol) return;
    const rank = order[kind] ?? 1;
    // prioridade por tipo; empate pela distância
    if (!best || rank < best.rank || (rank === best.rank && d < best.d)) best = { p: [p[0], p[1]], kind, d, rank };
  };
  for (const c of [...points, ...snapPointsOfSegments(segs)]) consider(c.p, c.kind);
  // linhas guia: cruzamento com as outras linhas (e entre guias) e o ponto da guia sob o cursor
  const guides = segs.filter(s => s.guia);
  if (guides.length) {
    const cross = (s, t) => {
      const r = [s.b[0] - s.a[0], s.b[1] - s.a[1]], q = [t.b[0] - t.a[0], t.b[1] - t.a[1]], den = r[0] * q[1] - r[1] * q[0];
      if (Math.abs(den) < 1e-12) return null;
      const u = ((t.a[0] - s.a[0]) * q[1] - (t.a[1] - s.a[1]) * q[0]) / den, w = ((t.a[0] - s.a[0]) * r[1] - (t.a[1] - s.a[1]) * r[0]) / den;
      return u >= -1e-9 && u <= 1 + 1e-9 && w >= -1e-9 && w <= 1 + 1e-9 ? [s.a[0] + r[0] * u, s.a[1] + r[1] * u] : null;
    };
    for (const g of guides) for (const s of segs) if (s !== g && !s.arc) { const p = cross(g, s); if (p) consider(p, 'intersecao'); }
    for (const g of guides) {
      const A = toScreen(g.a), B = toScreen(g.b), dx = B[0] - A[0], dy = B[1] - A[1], L2 = dx * dx + dy * dy;
      if (L2 < 1) continue;
      const t = Math.max(0, Math.min(1, ((cursor[0] - A[0]) * dx + (cursor[1] - A[1]) * dy) / L2));
      consider([g.a[0] + (g.b[0] - g.a[0]) * t, g.a[1] + (g.b[1] - g.a[1]) * t], 'guia');
    }
  }
  if (from) {
    for (const s of segs) {
      if (s.arc) continue;
      const dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1], L2 = dx * dx + dy * dy;
      if (L2 < 1e-12) continue;
      const t = ((from[0] - s.a[0]) * dx + (from[1] - s.a[1]) * dy) / L2;
      if (t <= 1e-6 || t >= 1 - 1e-6) continue; // pé fora do trecho (ou numa ponta: já é ponta)
      const foot = [s.a[0] + dx * t, s.a[1] + dy * t];
      if (Math.hypot(foot[0] - from[0], foot[1] - from[1]) < 1e-6) continue;
      consider(foot, 'perpendicular');
    }
  }
  return best ? { p: best.p, kind: best.kind } : null;
}

/** Mostra o marcador do encaixe (posição em px relativa ao contêiner do marcador). */
export function showSnapMarker(marker, kind, x, y) {
  if (!marker) return;
  marker.hidden = !kind;
  if (!kind) return;
  marker.dataset.kind = kind;
  Object.assign(marker.style, { left: `${x}px`, top: `${y}px` });
}
