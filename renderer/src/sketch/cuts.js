// CORTE POR VAZIO: um elemento marcado com bim.cortes = [guid do vazio, …] tem a geometria subtraída pelos
// vazios (operação booleana, three-bvh-csg). O corte acompanha: mover o vazio ou a peça, mudar a forma, refazer
// uma parede pelo script — tudo recalcula sozinho (assinatura das matrizes e das geometrias).
// A geometria original de cada malha fica em userData._csgOrig (tirar o corte devolve a peça inteira).
// TERRENO (piso com slab.terreno): os outros pisos cortam o terreno — sai o volume do contorno deles, do fundo do
// piso para cima (escavação), como o "building pad" do Revit. Também recalcula sozinho.
// TERRENO dentro de TERRENO: o terreno menor (área do contorno) corta o maior em toda a profundidade e desce até o
// fundo dele — onde a superfície do menor fica abaixo da do maior é corte; onde fica acima, aterro (preenche).
// TALUDE: os pisos com talude ligado moldam a superfície dos terrenos em volta (slopes.js), antes dos cortes.
// SOBREPOR: piso com slab.sobrepor.host deita sobre o hospedeiro (drape.js) — por último, depois do hospedeiro pronto.
import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';
import { normalizeGeometry } from './forms.js';
import { applySlopes, slopeFloors, slopeSignature } from '../slopes.js';
import { drapeGeometry, hostSignature } from '../drape.js';
import { materialByName } from '../elements.js';

const evaluator = new Evaluator();
evaluator.useGroups = false;
evaluator.attributes = ['position', 'normal', 'uv'];

/** Resultado do CSG sem drawRange (os exportadores leem o atributo inteiro). */
function compact(geo) {
  const n = Math.min(geo.drawRange.count, geo.attributes.position.count);
  const out = new THREE.BufferGeometry();
  for (const k of ['position', 'normal', 'uv']) {
    const a = geo.attributes[k];
    if (a) out.setAttribute(k, new THREE.BufferAttribute(a.array.slice(0, (Number.isFinite(n) ? n : a.count) * a.itemSize), a.itemSize));
  }
  out.computeBoundingBox(); out.computeBoundingSphere();
  return out;
}

/** Área do contorno de um piso (m²). */
const areaOf = el => Math.abs(THREE.ShapeUtils.area(el.userData.bim.slab.points.map(p => new THREE.Vector2(p[0], p[1]))));

/** Caixa no modelo pela geometria ORIGINAL (sem cortes) das malhas do elemento. */
function worldBox(el) {
  el.updateMatrixWorld(true);
  const box = new THREE.Box3();
  el.traverse(o => {
    if (!o.isMesh || o.userData.isEdge || o.userData.rodape || o.userData.taludeSkin || !o.geometry) return;
    const g = o.userData._csgOrig || o.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    box.union(g.boundingBox.clone().applyMatrix4(o.matrixWorld));
  });
  return box;
}

const overlapXY = (a, b) => {
  const A = worldBox(a), B = worldBox(b);
  return A.min.x < B.max.x && A.max.x > B.min.x && A.min.y < B.max.y && A.max.y > B.min.y;
};

/** Cópia da geometria com o fundo (vértices na cota "from", no modelo) levado até "to". */
function deepened(geo, matrixWorld, from, to) {
  const g = geo.clone(), inv = matrixWorld.clone().invert(), v = new THREE.Vector3(), pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(matrixWorld);
    if (Math.abs(v.z - from) > 1e-4) continue;
    v.z = to;
    v.applyMatrix4(inv);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}

const meshesOf = el => {
  const out = [];
  el.traverse(o => { if (o.isMesh && !o.userData.isEdge && !o.userData.rodape && !o.userData.taludeSkin) out.push(o); }); // rodapé e pele do talude não entram
  return out;
};

export class Cuts {
  constructor(app) {
    this.app = app;
    app.viewer.addEventListener('change', () => this.schedule());
  }

  get viewer() { return this.app.viewer; }

  schedule() {
    clearTimeout(this._t);
    this._t = setTimeout(() => this.update(), 150);
  }

  /** Marca os alvos para serem cortados pelos vazios. */
  add(targets, voids) {
    const ids = voids.map(v => v.userData.bim.guid);
    for (const t of targets) {
      const b = t.userData.bim;
      b.cortes = [...new Set([...(b.cortes || []), ...ids])];
    }
    this.update(true);
    this.viewer.changed();
  }

  /** Tira os cortes (de todos os vazios, ou só dos informados). */
  remove(targets, voids = null) {
    const ids = voids && new Set(voids.map(v => v.userData.bim.guid));
    for (const t of targets) {
      const b = t.userData.bim;
      if (!b.cortes) continue;
      b.cortes = ids ? b.cortes.filter(g => !ids.has(g)) : [];
      if (!b.cortes.length) { delete b.cortes; this.restore(t); }
    }
    this.update(true);
    this.viewer.changed();
  }

  /** Tira a pele do talude (malhas avulsas do terreno). */
  clearSkins(el) {
    for (const c of el.children.filter(c => c.userData.taludeSkin)) { el.remove(c); c.geometry.dispose(); }
  }

  restore(el) {
    this.clearSkins(el);
    for (const m of meshesOf(el)) {
      if (!m.userData._csgOrig) continue;
      m.geometry = m.userData._csgOrig;
      delete m.userData._csgOrig;
      this.refreshEdges(m);
    }
    delete el.userData._cutSig;
  }

  refreshEdges(m) {
    const e = m.userData.edges;
    if (e) { m.remove(e); e.geometry.dispose(); delete m.userData.edges; }
  }

  signature(el, voids) {
    el.updateMatrixWorld(true);
    const parts = [el.matrixWorld.elements.map(v => v.toFixed(5)).join(',')];
    for (const m of meshesOf(el)) parts.push((m.userData._csgOrig || m.geometry).uuid);
    for (const v of voids) { v.updateMatrixWorld(true); parts.push(v.userData.bim.guid, v.matrixWorld.elements.map(x => x.toFixed(5)).join(','), JSON.stringify(v.userData.bim.forma)); }
    return parts.join('|');
  }

  /** Pisos que cortam um terreno: os pisos comuns e os terrenos menores que se sobrepõem a ele. */
  padsFor(el) {
    if (!el.userData.bim.slab?.terreno) return [];
    const A = areaOf(el);
    return this.viewer.elements().filter(o => o !== el && o.userData.bim.slab && !o.userData.bim.slab.sobrepor?.host // o sobreposto não escava
      && (!o.userData.bim.slab.terreno || (areaOf(o) < A - 1e-6 && overlapXY(o, el))));
  }

  /**
   * Fundo até onde um terreno desce: o fundo do terreno maior em que ele está (aterro até lá), ou null.
   * Em cadeia (terreno dentro de terreno dentro de terreno) vale o fundo mais baixo.
   */
  hostBottom(el, depth = 0) {
    if (!el.userData.bim.slab?.terreno || depth > 8) return null;
    const A = areaOf(el), own = worldBox(el).min.z;
    let low = null;
    for (const o of this.viewer.elements()) {
      if (o === el || !o.userData.bim.slab?.terreno || areaOf(o) <= A + 1e-6 || !overlapXY(o, el)) continue;
      const z = this.hostBottom(o, depth + 1) ?? worldBox(o).min.z;
      if (low === null || z < low) low = z;
    }
    return low !== null && low < own - 1e-4 ? low : null;
  }

  padSignature(pads) {
    return pads.map(p => { p.updateMatrixWorld(true); return `${p.userData.bim.guid}:${p.matrixWorld.elements.map(x => x.toFixed(5)).join(',')}:${JSON.stringify(p.userData.bim.slab)}`; }).join('|');
  }

  /** Volume que o piso tira do terreno: o contorno dele, do ponto mais baixo do piso para cima. */
  padBrush(pad) {
    pad.updateMatrixWorld(true);
    const s = pad.userData.bim.slab;
    let pts = s.points.map(([x, y]) => new THREE.Vector3(x, y, 0).applyMatrix4(pad.matrixWorld)).map(p => new THREE.Vector2(p.x, p.y));
    if (THREE.ShapeUtils.isClockWise(pts)) pts = pts.reverse();
    const box = new THREE.Box3();
    pad.traverse(o => { if (o.isMesh && !o.userData.isEdge && !o.userData.rodape && o.geometry) { const g = o.userData._csgOrig || o.geometry; g.computeBoundingBox(); box.union(g.boundingBox.clone().applyMatrix4(o.matrixWorld)); } });
    // terreno menor: corta o maior em toda a profundidade (ele mesmo desce e preenche)
    const z0 = s.terreno ? -1000 : Number.isFinite(box.min.z) ? box.min.z : s.elevation - s.thickness;
    const geo = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: s.terreno ? 2000 : 1000, bevelEnabled: false });
    geo.translate(0, 0, z0);
    const b = new Brush(normalizeGeometry(geo));
    b.updateMatrixWorld(true);
    return b;
  }

  /** Recalcula os cortes que mudaram. */
  update(force = false) {
    const v = this.viewer;
    let changed = false;
    // os sobrepostos por último: o hospedeiro já tem a malha final (cortes, taludes) quando eles deitam sobre ele
    const isOver = e => !!e.userData.bim.slab?.sobrepor?.host;
    const all = v.elements();
    for (const el of [...all.filter(e => !isOver(e)), ...all.filter(isOver)]) {
      const ids = el.userData.bim.cortes || [];
      const pads = this.padsFor(el);
      const deepen = this.hostBottom(el);
      // taludes dos pisos em volta (só nos terrenos)
      const slopes = el.userData.bim.slab?.terreno ? slopeFloors(v.elements(), el) : [];
      const host = isOver(el) ? v.findById(el.userData.bim.slab.sobrepor.host) : null;
      const drape = host && host !== el ? host : null;
      if (!ids.length && !pads.length && deepen === null && !slopes.length && !drape) { if (el.userData._cutSig) this.restore(el); continue; }
      const voids = ids.map(id => v.findById(id)).filter(Boolean);
      const sig = this.signature(el, voids) + (pads.length ? `#${this.padSignature(pads)}` : '') + (deepen !== null ? `~${deepen.toFixed(5)}` : '')
        + (slopes.length ? `^${slopeSignature(slopes)}` : '') + (drape ? `@${hostSignature(drape)}:${JSON.stringify(el.userData.bim.slab)}` : '');
      if (!force && sig === el.userData._cutSig) continue;
      el.userData._cutSig = sig;
      this.apply(el, voids, pads, deepen, slopes, drape);
      changed = true;
    }
    if (changed) { v._prepare2D(v.model); v._bucketsDirty = true; }
  }

  apply(el, voids, pads = [], deepen = null, slopes = [], drape = null) {
    this.clearSkins(el);
    const skins = [];
    const ownBottom = deepen !== null ? worldBox(el).min.z : null;
    const voidBrushes = [];
    for (const p of pads) { try { voidBrushes.push(this.padBrush(p)); } catch (e) { console.warn('terreno', p.name, e); } }
    for (const vd of voids) for (const m of meshesOf(vd)) {
      m.updateMatrixWorld(true);
      const b = new Brush(normalizeGeometry(m.geometry.clone()));
      m.matrixWorld.decompose(b.position, b.quaternion, b.scale);
      b.updateMatrixWorld(true);
      voidBrushes.push(b);
    }
    for (const m of meshesOf(el)) {
      const orig = m.userData._csgOrig || m.geometry;
      m.userData._csgOrig = orig;
      m.updateMatrixWorld(true);
      let base = deepen !== null ? deepened(orig, m.matrixWorld, ownBottom, deepen) : orig;
      if (slopes.length) { base = applySlopes(base === orig ? orig.clone() : base, el, slopes); skins.push(...(base.userData.taludeSkins || [])); }
      if (drape) base = drapeGeometry(base === orig ? orig.clone() : base, m.matrixWorld, el.userData.bim.slab, drape);
      if (!voidBrushes.length) { m.geometry = base; this.refreshEdges(m); continue; }
      try {
        let a = new Brush(normalizeGeometry(base.clone()));
        m.matrixWorld.decompose(a.position, a.quaternion, a.scale);
        a.updateMatrixWorld(true);
        for (const vb of voidBrushes) {
          // só corta o que encosta (caixas que não se tocam ficam como estão)
          const ba = new THREE.Box3().setFromObject(a), bb = new THREE.Box3().setFromObject(vb);
          if (!ba.intersectsBox(bb)) continue;
          a = evaluator.evaluate(a, vb, SUBTRACTION);
          a.updateMatrixWorld(true);
        }
        m.geometry = compact(a.geometry);
      } catch (e) {
        console.warn('corte', el.name, e);
        m.geometry = orig;
      }
      this.refreshEdges(m);
    }
    // pele do talude: uma malha por material, por cima do terreno (só onde o talude mudou o terreno, fora dos pisos)
    for (const { material, positions } of skins) {
      if (!positions.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere();
      const skin = new THREE.Mesh(g, materialByName(material));
      skin.name = `Talude (${material})`;
      skin.userData.taludeSkin = true;
      skin.userData.layer = { name: 'Talude', material };
      el.add(skin);
    }
  }
}
