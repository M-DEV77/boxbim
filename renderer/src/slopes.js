// TALUDE do piso: em volta de um piso com slab.talude.ativo, o terreno é cortado (onde está acima do piso) ou aterrado
// (onde está abaixo) seguindo o perfil do talude, em INSTÂNCIAS (trechos inclinados) separadas por bermas:
//   slab.talude = { ativo, corte: { ativo, v, h, altura, berma }, aterro: { … } }
//     v : h ....... proporção do trecho (1 : 1,5 = sobe 1 a cada 1,5 na horizontal)
//     altura ...... altura de cada instância (0 = um talude só, contínuo)
//     berma ....... distância (horizontal, plana) entre as instâncias
//   slab.talude.suavizar + raio: arredonda as quinas (crista, pé, bordas das bermas) e o encontro com o terreno
//     natural — média do perfil numa faixa de "raio" e mínimo/máximo suaves no encontro com o terreno.
// Aplicado nos terrenos (slab.terreno) pelo sistema de cortes (sketch/cuts.js): a superfície do terreno fica presa entre
// o perfil de aterro (embaixo) e o de corte (em cima), medidos a partir do contorno do piso, na cota do topo dele.
import * as THREE from 'three';
import { slabShapeFn, subdivide } from './elements.js';

export const SLOPE_DEFAULTS = {
  corte: { ativo: true, v: 1, h: 1, altura: 3, berma: 2 },
  aterro: { ativo: true, v: 1, h: 1.5, altura: 3, berma: 2 },
};

/** Configuração completa (com os padrões) do talude de um piso. */
export function slopeConfig(s) {
  const t = s.talude || {};
  return {
    ativo: !!t.ativo,
    suavizar: !!t.suavizar,
    raio: Number.isFinite(Number(t.raio)) && Number(t.raio) > 0 ? Number(t.raio) : 1,
    corte: { ...SLOPE_DEFAULTS.corte, ...(t.corte || {}) },
    aterro: { ...SLOPE_DEFAULTS.aterro, ...(t.aterro || {}) },
  };
}

/** Quanto o talude sobe (ou desce) a uma distância d do contorno: trechos inclinados de "altura", bermas no meio. */
export function slopeRise(d, c) {
  if (d <= 0) return 0;
  const k = (Number(c.v) || 1) / (Number(c.h) || 1); // inclinação (vertical por horizontal)
  const H = Number(c.altura) || 0, B = Math.max(0, Number(c.berma) || 0);
  if (!(H > 0)) return d * k;
  const run = H / k, cycle = run + B;
  const n = Math.floor(d / cycle), rem = d - n * cycle;
  return n * H + Math.min(rem, run) * k;
}

/**
 * Perfil suavizado: média do perfil na faixa [d − r, d] (o lado de dentro do contorno vale 0, então na borda do
 * piso continua em 0 — o piso não muda) — as quinas viram curvas de largura r.
 */
export function slopeRiseSmooth(d, c, r) {
  if (!(r > 0)) return slopeRise(d, c);
  if (d <= 0) return 0;
  const N = 10;
  let s = 0;
  for (let i = 0; i <= N; i++) s += slopeRise(d - r * i / N, c);
  return s / (N + 1);
}

/** Mínimo e máximo suaves (concordância de largura k entre as duas superfícies). */
const smin = (a, b, k) => { if (!(k > 0)) return Math.min(a, b); const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k / 4; };
const smax = (a, b, k) => -smin(-a, -b, k);

const inside = (x, y, poly) => {
  let r = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) r = !r;
  }
  return r;
};

/** Distância (planta) ao contorno; 0 dentro. */
function distOut(x, y, poly) {
  if (inside(x, y, poly)) return 0;
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % poly.length];
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2));
    best = Math.min(best, Math.hypot(ax + dx * t - x, ay + dy * t - y));
  }
  return best;
}

/** Pisos com talude ligado (menos o próprio terreno). */
export const slopeFloors = (elements, except) => elements.filter(o => o !== except && o.userData.bim.slab && slopeConfig(o.userData.bim.slab).ativo);

export function slopeSignature(floors) {
  return floors.map(o => { o.updateMatrixWorld(true); return `${o.userData.bim.guid}:${o.matrixWorld.elements.map(x => x.toFixed(5)).join(',')}:${JSON.stringify(o.userData.bim.slab)}`; }).join('|');
}

/**
 * Aplica os taludes na geometria de um terreno (coordenadas locais do terreno). Devolve uma geometria nova
 * (subdividida para o perfil aparecer) ou a mesma, se nenhum talude chega nela.
 */
export function applySlopes(geo, terrainEl, floors) {
  if (!floors.length) return geo;
  terrainEl.updateMatrixWorld(true);
  const inv = terrainEl.matrixWorld.clone().invert();
  const s = terrainEl.userData.bim.slab, f = slabShapeFn(s);
  const tops = floors.map(o => {
    o.updateMatrixWorld(true);
    const so = o.userData.bim.slab;
    const poly = so.points.map(([x, y]) => new THREE.Vector3(x, y, so.elevation).applyMatrix4(o.matrixWorld).applyMatrix4(inv));
    const cfg = slopeConfig(so);
    return { poly: poly.map(p => [p.x, p.y]), z: poly[0].z, cfg, r: cfg.suavizar ? cfg.raio : 0 };
  });
  const xs = s.points.map(p => p[0]), ys = s.points.map(p => p[1]);
  const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const out = subdivide(geo, Math.max(0.4, size / 80));
  const pos = out.attributes.position;
  let zb = Infinity;
  for (let i = 0; i < pos.count; i++) zb = Math.min(zb, pos.getZ(i));
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (z <= zb + 1e-4) continue; // fundo fica
    const top0 = s.elevation + (f ? f(x, y) : 0);
    let top = top0;
    for (const t of tops) {
      const d = distOut(x, y, t.poly);
      const hi = t.cfg.corte.ativo ? t.z + slopeRiseSmooth(d, t.cfg.corte, t.r) : Infinity;
      const lo = t.cfg.aterro.ativo ? t.z - slopeRiseSmooth(d, t.cfg.aterro, t.r) : -Infinity;
      // suavizado: o encontro com o terreno natural também concorda (largura em altura ≈ raio × inclinação)
      const kc = t.r * (t.cfg.corte.v / t.cfg.corte.h), ka = t.r * (t.cfg.aterro.v / t.cfg.aterro.h);
      if (t.r > 0) {
        if (Number.isFinite(lo) && d > 0) top = smax(top, lo, ka); else top = Math.max(top, lo);
        if (Number.isFinite(hi) && d > 0) top = smin(top, hi, kc); else top = Math.min(top, hi);
      } else top = Math.min(Math.max(top, lo), hi);
    }
    if (Math.abs(top - top0) < 1e-6) continue;
    top = Math.max(top, zb + 0.01);
    const k = (z - zb) / (top0 - zb || 1);
    pos.setZ(i, zb + k * (top - zb));
  }
  pos.needsUpdate = true;
  out.computeVertexNormals(); out.computeBoundingBox(); out.computeBoundingSphere();
  return out;
}
