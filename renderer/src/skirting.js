// RODAPÉ DO PISO (slab.rodape = { ativo, objeto, furos, params }): uma peça por lado do contorno (e dos furos, se
// pedido), feita pelo OBJETO de perfil da biblioteca (padrão "Rodapé", editável no editor de Objetos): o objeto
// desenha o perfil no plano YZ e extruda ao longo de X; aqui cada peça é levada ao lado — X ao longo do lado, Y para
// dentro do piso, Z para cima a partir do topo. As peças sobram a espessura nos cantos (cobrem a quina).
// As malhas ficam num grupo filho do piso (userData.rodape); são refeitas quando o piso, o contorno ou o objeto mudam.
import * as THREE from 'three';
import { slabShapeFn } from './elements.js';

export const SKIRT_DEFAULT = { ativo: false, objeto: 'rodape', furos: false, params: {} };

export const skirtConfig = s => ({ ...SKIRT_DEFAULT, ...(s.rodape || {}), params: { ...(s.rodape?.params || {}) } });

export class Skirting {
  constructor(app) {
    this.app = app;
    this.gen = new Map(); // guid → geração em andamento (descarta as antigas)
    app.viewer.addEventListener('change', () => this.schedule());
  }

  get viewer() { return this.app.viewer; }

  schedule() {
    clearTimeout(this._t);
    this._t = setTimeout(() => this.update(), 180);
  }

  /** Objeto do perfil (o escolhido; senão, o de fábrica). */
  defOf(cfg) {
    const lib = this.app.objects;
    return lib.get(cfg.objeto) || lib.get('rodape') || null;
  }

  update() {
    for (const el of this.viewer.elements()) {
      const s = el.userData.bim?.slab;
      if (!s) continue;
      const cfg = skirtConfig(s);
      const group = el.children.find(c => c.userData.rodape);
      if (!cfg.ativo) { if (group) { el.remove(group); dispose(group); this.viewer.changed(); } continue; }
      const def = this.defOf(cfg);
      if (!def) continue;
      const sig = JSON.stringify([s.points, s.holes, s.elevation, s.alturas, s.forma, cfg, def.id, def.revision, def.updated, def.script?.length]);
      if (group?.userData.sig === sig || this.gen.get(el.userData.bim.guid) === sig) continue;
      this.build(el, def, cfg, sig).catch(err => console.warn('rodapé', err));
    }
  }

  async build(el, def, cfg, sig) {
    const guid = el.userData.bim.guid;
    this.gen.set(guid, sig);
    const s = el.userData.bim.slab, f = slabShapeFn(s);
    const area = pts => pts.reduce((t, p, i) => { const q = pts[(i + 1) % pts.length]; return t + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;
    const rings = [{ pts: s.points, hole: false }, ...(cfg.furos ? (s.holes || []).map(hl => ({ pts: hl, hole: true })) : [])];
    const e = Number(cfg.params.espessura ?? def.parameters.find(p => p.name === 'espessura')?.default ?? 0.015) || 0.015;
    const group = new THREE.Group();
    group.name = 'Rodapé';
    group.userData.rodape = true;
    for (const { pts, hole } of rings) {
      // "para dentro do piso": à esquerda num contorno anti-horário; nos furos, o contrário
      const ccw = area(pts) > 0, inwardLeft = hole ? !ccw : ccw;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (L < 0.01) continue;
        const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
        const nx = inwardLeft ? -uy : uy, ny = inwardLeft ? ux : -ux;
        const { meshes } = await this.app.objects.generate(def, { ...cfg.params, comprimento: L + 2 * e });
        if (this.gen.get(guid) !== sig) return; // já existe uma geração mais nova
        const zA = s.elevation + (f ? f(a[0], a[1]) : 0), zB = s.elevation + (f ? f(b[0], b[1]) : 0);
        // X ao longo do lado (inclina com o piso), Y para dentro, Z para cima; começa "e" antes do ponto a
        const X = new THREE.Vector3(b[0] - a[0], b[1] - a[1], zB - zA).normalize();
        const Y = new THREE.Vector3(nx, ny, 0), Z = new THREE.Vector3().crossVectors(X, Y).normalize();
        const m = new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(a[0] - ux * e, a[1] - uy * e, zA - X.z * e);
        for (const mesh of meshes) {
          mesh.geometry.applyMatrix4(m);
          mesh.geometry.computeBoundingBox(); mesh.geometry.computeBoundingSphere();
          mesh.userData.rodape = true;
          group.add(mesh);
        }
      }
    }
    if (this.gen.get(guid) !== sig) return;
    this.gen.delete(guid);
    const cur = el.parent ? el : this.viewer.elements().find(x => x.userData.bim?.guid === guid);
    if (!cur) return;
    for (const old of cur.children.filter(c => c.userData.rodape)) { cur.remove(old); dispose(old); }
    group.userData.sig = sig;
    cur.add(group);
    if (this.viewer.selected.has(cur)) this.viewer._highlight(cur, true);
    this.viewer._prepare2D(cur);
    this.viewer.changed();
  }
}

function dispose(g) { g.traverse(o => o.geometry?.dispose()); }
