// CORTE POR VAZIO: um elemento marcado com bim.cortes = [guid do vazio, …] tem a geometria subtraída pelos
// vazios (operação booleana, three-bvh-csg). O corte acompanha: mover o vazio ou a peça, mudar a forma, refazer
// uma parede pelo script — tudo recalcula sozinho (assinatura das matrizes e das geometrias).
// A geometria original de cada malha fica em userData._csgOrig (tirar o corte devolve a peça inteira).
import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';
import { normalizeGeometry } from './forms.js';

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

const meshesOf = el => {
  const out = [];
  el.traverse(o => { if (o.isMesh && !o.userData.isEdge) out.push(o); });
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

  restore(el) {
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

  /** Recalcula os cortes que mudaram. */
  update(force = false) {
    const v = this.viewer;
    let changed = false;
    for (const el of v.elements()) {
      const ids = el.userData.bim.cortes;
      if (!ids?.length) { if (el.userData._cutSig) this.restore(el); continue; }
      const voids = ids.map(id => v.findById(id)).filter(Boolean);
      const sig = this.signature(el, voids);
      if (!force && sig === el.userData._cutSig) continue;
      el.userData._cutSig = sig;
      this.apply(el, voids);
      changed = true;
    }
    if (changed) { v._prepare2D(v.model); v._bucketsDirty = true; }
  }

  apply(el, voids) {
    const voidBrushes = [];
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
      if (!voidBrushes.length) { m.geometry = orig; this.refreshEdges(m); continue; }
      m.updateMatrixWorld(true);
      try {
        let a = new Brush(normalizeGeometry(orig.clone()));
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
  }
}
