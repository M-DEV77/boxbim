// PISO SOBREPOSTO (slab.sobrepor = { host: GUID do piso hospedeiro }): o piso fica deitado sobre o hospedeiro e
// acompanha o relevo dele — o fundo encosta na superfície de cima do hospedeiro e a espessura fica na vertical
// (calçada sobre o terreno, revestimento sobre uma rampa…). A superfície vem da malha que está no modelo (já com
// pontos de altura, taludes e cortes), por raio vertical acelerado (three-mesh-bvh). Aplicado pelo sistema de cortes.
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { subdivide } from './elements.js';

const bvhCache = new WeakMap(); // geometria do hospedeiro → BVH (feito numa cópia: a original não muda)

function bvhOf(geo) {
  let b = bvhCache.get(geo);
  if (!b) { b = new MeshBVH(geo.clone()); bvhCache.set(geo, b); }
  return b;
}

const meshesOf = el => {
  const out = [];
  el.traverse(o => { if (o.isMesh && !o.userData.isEdge && !o.userData.rodape && !o.userData.taludeSkin && !o.userData.mapSkin && o.geometry) out.push(o); });
  return out;
};

/** Assinatura do hospedeiro (muda quando a malha dele muda ou ele se move). */
export function hostSignature(host) {
  host.updateMatrixWorld(true);
  return `${host.userData.bim.guid}:${host.matrixWorld.elements.map(x => x.toFixed(5)).join(',')}:${meshesOf(host).map(m => m.geometry.uuid).join(',')}`;
}

/** Função (x, y) no modelo → cota da superfície de cima do hospedeiro, ou null fora dele. */
export function hostTopFn(host) {
  host.updateMatrixWorld(true);
  const items = meshesOf(host).map(m => ({ b: bvhOf(m.geometry), mw: m.matrixWorld, inv: m.matrixWorld.clone().invert() }));
  const ray = new THREE.Ray(), o = new THREE.Vector3(), dir = new THREE.Vector3(0, 0, -1);
  const cache = new Map();
  return (x, y) => {
    const k = `${x.toFixed(5)},${y.toFixed(5)}`;
    if (cache.has(k)) return cache.get(k);
    let top = null;
    for (const it of items) {
      ray.origin.copy(o.set(x, y, 1e5)).applyMatrix4(it.inv);
      ray.direction.copy(dir).transformDirection(it.inv);
      const hit = it.b.raycastFirst(ray, THREE.DoubleSide);
      if (hit) { const z = hit.point.clone().applyMatrix4(it.mw).z; if (top === null || z > top) top = z; }
    }
    cache.set(k, top);
    return top;
  };
}

/**
 * Geometria do piso (local, matriz mw) deitada sobre o hospedeiro: cada coluna de vértices sobe/desce para o fundo
 * encostar na superfície do hospedeiro. Fora do hospedeiro, fica onde está.
 */
export function drapeGeometry(geo, mw, s, host) {
  const top = hostTopFn(host);
  const xs = s.points.map(p => p[0]), ys = s.points.map(p => p[1]);
  const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const out = subdivide(geo, Math.max(0.2, size / 60));
  const inv = mw.clone().invert();
  const bottomW = new THREE.Vector3(0, 0, s.elevation - (s.thickness || 0.15)).applyMatrix4(mw).z;
  const pos = out.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mw);
    const t = top(v.x, v.y);
    if (t === null) continue;
    v.z += t - bottomW;
    v.applyMatrix4(inv);
    pos.setZ(i, v.z);
  }
  pos.needsUpdate = true;
  out.computeVertexNormals(); out.computeBoundingBox(); out.computeBoundingSphere();
  return out;
}
