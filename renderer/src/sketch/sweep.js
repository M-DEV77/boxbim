// VARRER com PERFIL DESENHADO: o perfil é sempre um contorno 2D FECHADO desenhado pelo usuário, selecionado junto
// com o caminho (linhas encadeadas, abertas ou fechadas). O perfil pode estar em qualquer plano:
//   - num plano perpendicular ao início do caminho (ex.: um eixo de trabalho vertical cruzando o caminho), ele é
//     usado onde foi desenhado — a posição em relação ao caminho vale (como o perfil de varredura do Revit);
//   - em outro plano (ex.: desenhado na planta), é centrado no caminho: u do desenho → lateral, v → altura.
import * as THREE from 'three';
import { chainSegments } from './sketch.js';

const r6 = v => +v.toFixed(6);

/**
 * groups: [{ m: Matrix4 plano → modelo, segs: [linha 2D nas coordenadas do plano] }]
 * Devolve { caminho: [[x, y, z]…], fechado, perfil: [[u, v]…], posicionado } ou lança erro com o motivo.
 */
export function sweepFromGroups(groups) {
  const items = [];
  for (const g of groups) {
    const { loops, chains } = chainSegments(g.segs);
    const n = new THREE.Vector3().setFromMatrixColumn(g.m, 2).normalize();
    const W = p => new THREE.Vector3(p[0], p[1], 0).applyMatrix4(g.m);
    const add = (pts, closed) => {
      const world = pts.map(W);
      let len = 0;
      for (let i = 1; i < world.length; i++) len += world[i].distanceTo(world[i - 1]);
      if (closed) len += world[0].distanceTo(world[world.length - 1]);
      items.push({ closed, pts, world, n, len });
    };
    loops.forEach(p => add(p, true));
    chains.forEach(p => add(p, false));
  }
  const loops = items.filter(i => i.closed), chains = items.filter(i => !i.closed);
  if (!loops.length) {
    throw new Error('O perfil precisa ser um contorno FECHADO desenhado em 2D (as pontas das linhas se encontrando). Desenhe-o — de preferência num eixo de trabalho perpendicular ao início do caminho — e selecione junto com o caminho.');
  }
  // caminho: a cadeia aberta mais longa; sem cadeia aberta, o maior contorno fechado (caminho fechado)
  let path;
  if (chains.length) path = chains.sort((a, b) => b.len - a.len)[0];
  else if (loops.length >= 2) path = [...loops].sort((a, b) => b.len - a.len)[0];
  else throw new Error('Falta o caminho: selecione também as linhas por onde o perfil vai correr (além do contorno fechado do perfil).');
  const P0 = path.world[0], T = path.world[1].clone().sub(P0).normalize();
  const up = new THREE.Vector3(0, 0, 1);
  let lat = up.clone().cross(T);
  if (lat.lengthSq() < 1e-8) lat = new THREE.Vector3(1, 0, 0); else lat.normalize();
  // perfil: o contorno fechado perpendicular ao caminho (se houver); senão o menor contorno
  const cands = loops.filter(l => l !== path);
  const perp = cands.filter(l => Math.abs(l.n.dot(T)) > 0.9).sort((a, b) => a.world[0].distanceTo(P0) - b.world[0].distanceTo(P0));
  const prof = perp[0] || cands.sort((a, b) => a.len - b.len)[0];
  if (!prof) throw new Error('Falta o perfil: um contorno fechado desenhado em 2D, selecionado junto com o caminho.');
  let perfil, posicionado = false;
  if (Math.abs(prof.n.dot(T)) > 0.9) {
    // desenhado de frente para o caminho: vale a posição em relação ao início dele
    perfil = prof.world.map(X => { const d = X.clone().sub(P0); return [r6(d.dot(lat)), r6(d.dot(up))]; });
    posicionado = true;
  } else {
    const xs = prof.pts.map(p => p[0]), ys = prof.pts.map(p => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    perfil = prof.pts.map(([x, y]) => [r6(x - cx), r6(y - cy)]);
  }
  return { caminho: path.world.map(v => [r6(v.x), r6(v.y), r6(v.z)]), fechado: path.closed, perfil, posicionado, usados: [path, prof] };
}
