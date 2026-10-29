// TALUDE do piso: em volta de um piso com slab.talude.ativo, o terreno é cortado (onde está acima do piso) ou aterrado
// (onde está abaixo) seguindo o perfil do talude, em INSTÂNCIAS (trechos inclinados) separadas por bermas:
//   slab.talude = { ativo, corte: { ativo, v, h, altura, berma }, aterro: { … } }
//     v : h ....... proporção do trecho (1 : 1,5 = sobe 1 a cada 1,5 na horizontal)
//     altura ...... altura de cada instância (0 = um talude só, contínuo)
//     berma ....... distância (horizontal, plana) entre as instâncias
//   slab.talude.material: material da SUPERFÍCIE do talude (grama, pedra, concreto projetado…) — uma pele por cima
//     do terreno, só onde o talude mudou o terreno (fora do piso); vazio = o material do próprio terreno
//   slab.talude.suavizar + raio: arredonda as quinas (crista, pé, bordas das bermas) e o encontro com o terreno
//     natural — média do perfil numa faixa de "raio" e mínimo/máximo suaves no encontro com o terreno.
// Aplicado nos terrenos (slab.terreno) pelo sistema de cortes (sketch/cuts.js): a superfície do terreno fica presa entre
// o perfil de aterro (embaixo) e o de corte (em cima), medidos a partir do contorno do piso, na cota do topo dele.
import * as THREE from 'three';
import { slabShapeFn, subdivide } from './elements.js';
import { retainEdges } from './retaining.js';

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
    material: t.material || '',
    caminhao: Number(t.caminhao) > 0 ? Number(t.caminhao) : 0, // m³ da caçamba (só para a conta de caminhões)
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

/**
 * Ponto mais perto no contorno e a distância até ele (planta); dentro do contorno a distância é 0. F = contorno em
 * lista plana [x0, y0, x1, y1, …] (sem objetos por lado: roda para cada ponto da malha).
 */
function nearestOnPoly(x, y, F) {
  let best = Infinity, nx = x, ny = y, inn = false, bi = 0;
  const n = F.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const ax = F[i], ay = F[i + 1], k = (i + 2) % n, dx = F[k] - ax, dy = F[k + 1] - ay, L2 = dx * dx + dy * dy || 1;
    let u = ((x - ax) * dx + (y - ay) * dy) / L2;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    const px = ax + dx * u, py = ay + dy * u, dd = (px - x) * (px - x) + (py - y) * (py - y);
    if (dd < best) { best = dd; nx = px; ny = py; bi = i / 2; }
    // dentro/fora (par/ímpar) com o lado j → i
    const xj = F[j], yj = F[j + 1];
    if ((ay > y) !== (yj > y) && x < (xj - ax) * (y - ay) / (yj - ay) + ax) inn = !inn;
  }
  best = Math.sqrt(best);
  return inn ? { d: 0, x, y, edge: best, i: bi } : { d: best, x: nx, y: ny, edge: best, i: bi };
}

/** Pisos com talude ligado (menos o próprio terreno). */
export const slopeFloors = (elements, except) => elements.filter(o => o !== except && o.userData.bim.slab && slopeConfig(o.userData.bim.slab).ativo);

/** Dados do piso que mudam a geometria (a caçamba do caminhão é só para a conta: fica fora, sem recalcular à toa). */
export const slabKey = s => JSON.stringify(s?.talude?.caminhao ? { ...s, talude: { ...s.talude, caminhao: 0 } } : s);

export function slopeSignature(floors) {
  return floors.map(o => { o.updateMatrixWorld(true); return `${o.userData.bim.guid}:${o.matrixWorld.elements.map(x => x.toFixed(5)).join(',')}:${slabKey(o.userData.bim.slab)}`; }).join('|');
}

/** O piso do talude nas coordenadas locais do terreno: contorno, cota do topo em cada ponto, configuração. */
function floorTop(o, terrainEl, inv) {
  o.updateMatrixWorld(true);
  const so = o.userData.bim.slab, fo = slabShapeFn(so);
  const toFloor = o.matrixWorld.clone().invert().multiply(terrainEl.matrixWorld), fromFloor = inv.clone().multiply(o.matrixWorld);
  const poly = so.points.map(([x, y]) => new THREE.Vector3(x, y, so.elevation).applyMatrix4(fromFloor));
  const v = new THREE.Vector3();
  // topo do piso (com as alturas dos pontos) num ponto do terreno (coordenadas locais do terreno)
  const zAt = (x, y) => {
    v.set(x, y, 0).applyMatrix4(toFloor);
    v.z = so.elevation + (fo ? fo(v.x, v.y) : 0);
    return v.applyMatrix4(fromFloor).z;
  };
  const cfg = slopeConfig(so);
  const pl = poly.map(p => [p.x, p.y]);
  return { poly: pl, flat: Float64Array.from(pl.flat()), zAt, cfg, r: cfg.suavizar ? cfg.raio : 0, thick: so.thickness || 0.15, arr: retainEdges(so) };
}

/** Cota do terreno com o talude de UM piso, a uma distância d (> 0) do contorno, partindo da cota natural nat. */
function slopedZ(t, nat, d, z0) {
  const hi = t.cfg.corte.ativo ? z0 + slopeRiseSmooth(d, t.cfg.corte, t.r) : Infinity;
  const lo = t.cfg.aterro.ativo ? z0 - slopeRiseSmooth(d, t.cfg.aterro, t.r) : -Infinity;
  const kc = t.r * (t.cfg.corte.v / t.cfg.corte.h), ka = t.r * (t.cfg.aterro.v / t.cfg.aterro.h);
  let top = nat;
  if (t.r > 0) {
    top = Number.isFinite(lo) ? smax(top, lo, ka) : top;
    top = Number.isFinite(hi) ? smin(top, hi, kc) : top;
  } else top = Math.min(Math.max(top, lo), hi);
  return top;
}

/**
 * VOLUMES de corte e aterro (m³) do talude de um piso num terreno — por amostragem numa grade (até ~250 mil pontos):
 * em cada ponto, a diferença entre o terreno natural e o terreno final. Dentro do piso o terreno final fica no
 * FUNDO do piso (a plataforma: o piso corta o que está acima e o aterro preenche o que está abaixo).
 * Devolve { corte, aterro, corteTalude, aterroTalude } (os dois últimos: só fora do piso).
 */
export function slopeVolumes(terrainEl, floorEl) {
  terrainEl.updateMatrixWorld(true);
  const inv = terrainEl.matrixWorld.clone().invert();
  const s = terrainEl.userData.bim.slab, f = slabShapeFn(s);
  const t = floorTop(floorEl, terrainEl, inv);
  const hs = [0, ...(s.alturas || []), ...(s.forma || []).map(p => p[2])].filter(Number.isFinite);
  const zTop = s.elevation + Math.max(...hs), zLow = s.elevation + Math.min(...hs);
  const zb = zLow - (s.thickness || 0.15); // fundo plano do terreno
  const zs = t.poly.map(([x, y]) => t.zAt(x, y));
  const reach = (c, need) => { if (!c.ativo || need <= 0) return 0; let d = 0; while (d < 2000 && slopeRise(d, c) < need) d += 0.25; return d; };
  const R = Math.max(reach(t.cfg.corte, zTop - Math.min(...zs)), reach(t.cfg.aterro, Math.max(...zs) - zb)) + t.r + 0.5;
  // região: o terreno ∩ (o piso + o alcance do talude)
  const txs = s.points.map(p => p[0]), tys = s.points.map(p => p[1]), fxs = t.poly.map(p => p[0]), fys = t.poly.map(p => p[1]);
  const x0 = Math.max(Math.min(...txs), Math.min(...fxs) - R), x1 = Math.min(Math.max(...txs), Math.max(...fxs) + R);
  const y0 = Math.max(Math.min(...tys), Math.min(...fys) - R), y1 = Math.min(Math.max(...tys), Math.max(...fys) + R);
  const out = { corte: 0, aterro: 0, corteTalude: 0, aterroTalude: 0 };
  if (!(x1 > x0 && y1 > y0)) return out;
  const step = Math.max(0.05, Math.sqrt((x1 - x0) * (y1 - y0) / 250000)), dA = step * step;
  const tFlat = Float64Array.from(s.points.flat()), holes = (s.holes || []).map(hl => Float64Array.from(hl.flat()));
  for (let y = y0 + step / 2; y < y1; y += step) {
    for (let x = x0 + step / 2; x < x1; x += step) {
      if (nearestOnPoly(x, y, tFlat).d > 0 || holes.some(H => nearestOnPoly(x, y, H).d === 0)) continue;
      const nat = s.elevation + (f ? f(x, y) : 0);
      const n = nearestOnPoly(x, y, t.flat), z0 = t.zAt(n.x, n.y);
      let fin;
      if (n.d === 0) fin = (nat > z0 - t.thick || t.cfg.aterro.ativo) ? z0 - t.thick : nat; // plataforma: fundo do piso
      else if (t.arr?.edges.has(n.i) && (nat >= z0 ? t.arr.corte : t.arr.aterro)) fin = nat; // arrimo: sem talude
      else fin = slopedZ(t, nat, n.d, z0);
      fin = Math.max(fin, zb);
      const dz = fin - nat;
      if (dz < 0) { out.corte -= dz * dA; if (n.d > 0) out.corteTalude -= dz * dA; } else if (dz > 0) { out.aterro += dz * dA; if (n.d > 0) out.aterroTalude += dz * dA; }
    }
  }
  return out;
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
  const tops = floors.map(o => floorTop(o, terrainEl, inv));
  const xs = s.points.map(p => p[0]), ys = s.points.map(p => p[1]);
  const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  // malha: fina perto da aresta dos pisos (o talude começa ali), mais grossa longe
  // (o fundo, plano e escondido, não precisa ser subdividido)
  geo.computeBoundingBox();
  const zb0 = geo.boundingBox.min.z;
  // malha: 10 cm junto da aresta (a dobra do talude fica bem desenhada), 20 cm até 1,5 m, e grossa longe
  const far = Math.max(0.4, size / 80), near = Math.min(far, 0.1), mid = Math.min(far, 0.2);
  const band = mid * 1.37; // faixa do perfil que entra no piso (maior que a malha fina)
  // até onde cada talude pode chegar (onde o perfil já passou de toda a altura do terreno): fora disso nada muda
  const zTop = geo.boundingBox.max.z, zLow = s.elevation + Math.min(0, ...((s.alturas || []).concat((s.forma || []).map(p => p[2])).filter(Number.isFinite)));
  for (const t of tops) {
    const zs = t.poly.map(([x, y]) => t.zAt(x, y)), fmin = Math.min(...zs), fmax = Math.max(...zs);
    const reach = (c, need) => { if (!c.ativo || need <= 0) return 0; let d = 0; while (d < 2000 && slopeRise(d, c) < need) d += 0.25; return d; };
    t.reach = Math.max(reach(t.cfg.corte, zTop - fmin), reach(t.cfg.aterro, fmax - zLow)) + t.r + 0.5;
  }
  // distância até o contorno (só a conta, sem objetos nem teste de dentro/fora: roda para cada aresta da malha)
  const edgeDist = (x, y, F) => {
    let best = Infinity;
    const n = F.length;
    for (let i = 0; i < n; i += 2) {
      const ax = F[i], ay = F[i + 1], j = (i + 2) % n, dx = F[j] - ax, dy = F[j + 1] - ay, L2 = dx * dx + dy * dy || 1;
      let u = ((x - ax) * dx + (y - ay) * dy) / L2;
      u = u < 0 ? 0 : u > 1 ? 1 : u;
      const px = ax + dx * u - x, py = ay + dy * u - y, dd = px * px + py * py;
      if (dd < best) best = dd;
    }
    return Math.sqrt(best);
  };
  const out = subdivide(geo, (cx, cy, cz, m) => {
    if (cz <= zb0 + 1e-4) return Infinity;
    let e = Infinity, reach = 0;
    for (const t of tops) { const q = edgeDist(cx, cy, t.flat) - m; if (q < e) e = q; if (q < t.reach) reach = 1; }
    return !reach ? Infinity : e < 0.4 ? near : e < 1.5 ? mid : far;
  });
  const pos = out.attributes.position;
  let zb = Infinity;
  for (let i = 0; i < pos.count; i++) zb = Math.min(zb, pos.getZ(i));
  // quem mudou cada vértice da SUPERFÍCIE (índice do piso do talude; -1 = ninguém, -2 = dentro de um piso)
  const who = new Int32Array(pos.count).fill(-1);
  // caixa de alcance de cada talude (contorno + alcance): vértice fora dela não é tocado por ele
  for (const t of tops) {
    const xs = t.poly.map(p => p[0]), ys = t.poly.map(p => p[1]);
    t.box = [Math.min(...xs) - t.reach, Math.min(...ys) - t.reach, Math.max(...xs) + t.reach, Math.max(...ys) + t.reach];
  }
  // a malha não é indexada: o mesmo ponto aparece em ~6 cantos — calcula uma vez por ponto
  const memo = new Map(), pidOf = out.pointIds;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (z <= zb + 1e-4) continue; // fundo fica
    const mk = pidOf ? pidOf[i] : `${x.toFixed(5)},${y.toFixed(5)},${z.toFixed(5)}`;
    const hit = memo.get(mk);
    if (hit) { who[i] = hit[1]; if (hit[0] !== null) pos.setZ(i, hit[0]); continue; }
    const top0 = s.elevation + (f ? f(x, y) : 0);
    const onTop = Math.abs(z - top0) < 1e-4; // vértice da superfície de cima (não de uma camada de dentro)
    let top = top0;
    for (let ti = 0; ti < tops.length; ti++) {
      const t = tops[ti];
      if (x < t.box[0] || y < t.box[1] || x > t.box[2] || y > t.box[3]) continue;
      const before = top;
      // o talude sai da ARESTA do piso: cota do topo do piso no ponto mais perto do contorno
      const n = nearestOnPoly(x, y, t.flat), d = n.d, z0 = t.zAt(n.x, n.y);
      if (d === 0) {
        if (onTop) who[i] = -2;
        // dentro do piso: o perfil continua um pouco para dentro (a faixa da malha fina), assim a superfície cruza a
        // ARESTA DE CIMA do piso exatamente na cota do topo — sem serrilhado na face lateral (o piso tira o resto)
        // (no corte, fica acima do fundo do piso: o piso corta essa sobra inteira, sem faces coincidentes)
        const e = Math.min(n.edge, band), cutSide = top >= z0;
        if (cutSide && t.cfg.corte.ativo) top = z0 - Math.min(e * (t.cfg.corte.v / t.cfg.corte.h), t.thick * 0.45);
        else if (!cutSide && t.cfg.aterro.ativo) top = z0 + e * (t.cfg.aterro.v / t.cfg.aterro.h);
        continue;
      }
      // lado com muro de arrimo (no corte ou no aterro): o terreno fica natural até o muro
      if (t.arr?.edges.has(n.i) && (top >= z0 ? t.arr.corte : t.arr.aterro)) continue;
      const hi = t.cfg.corte.ativo ? z0 + slopeRiseSmooth(d, t.cfg.corte, t.r) : Infinity;
      const lo = t.cfg.aterro.ativo ? z0 - slopeRiseSmooth(d, t.cfg.aterro, t.r) : -Infinity;
      // suavizado: o encontro com o terreno natural também concorda (largura em altura ≈ raio × inclinação)
      const kc = t.r * (t.cfg.corte.v / t.cfg.corte.h), ka = t.r * (t.cfg.aterro.v / t.cfg.aterro.h);
      if (t.r > 0) {
        if (Number.isFinite(lo) && d > 0) top = smax(top, lo, ka); else top = Math.max(top, lo);
        if (Number.isFinite(hi) && d > 0) top = smin(top, hi, kc); else top = Math.min(top, hi);
      } else top = Math.min(Math.max(top, lo), hi);
      if (onTop && who[i] !== -2 && Math.abs(top - before) > 1e-6) who[i] = ti;
    }
    if (Math.abs(top - top0) < 1e-6) { memo.set(mk, [null, who[i]]); continue; }
    top = Math.max(top, zb + 0.01);
    const k = (z - zb) / (top0 - zb || 1);
    const nz = zb + k * (top - zb);
    pos.setZ(i, nz);
    memo.set(mk, [nz, who[i]]);
  }
  pos.needsUpdate = true;
  out.computeVertexNormals(); out.computeBoundingBox(); out.computeBoundingSphere();
  // PELE do talude: os triângulos da superfície com os 3 vértices mudados pelo mesmo piso (que tem material), 2 mm
  // acima — vira uma malha à parte com o material do talude (sketch/cuts.js)
  const skins = new Map();
  for (let i = 0; i + 2 < pos.count; i += 3) {
    const w = who[i];
    if (w < 0 || who[i + 1] !== w || who[i + 2] !== w) continue;
    const mat = tops[w].cfg.material;
    if (!mat) continue;
    if (!skins.has(mat)) skins.set(mat, []);
    const arr = skins.get(mat);
    for (let k = 0; k < 3; k++) arr.push(pos.getX(i + k), pos.getY(i + k), pos.getZ(i + k) + 0.002);
  }
  out.userData.taludeSkins = [...skins].map(([material, positions]) => ({ material, positions }));
  return out;
}
