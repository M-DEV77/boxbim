// Hospedagem de portas e janelas (Objetos com vão) em paredes, como no Revit.
//
// Instância hospedada:  userData.bim.host    = { wallId (uuid da parede), offset (m do início do eixo), flip }
//                       userData.bim.opening = { width, height, sill, x } (vão em coordenadas locais do objeto)
// Parede:               userData.bim.wall.openings = [{ id (uuid da instância), offset, width, sill, height }]
//
// O objeto é orientado com o eixo X local ao longo da parede e Y local na espessura; "flip" gira 180°
// (inverte o lado de abertura). Apagar a instância fecha o vão; apagar a parede apaga o que ela hospeda.
import * as THREE from 'three';
import { rebuildElement } from './elements.js';

const DEG = Math.PI / 180;

export class Hosting {
  constructor(app) {
    this.app = app;
    app.viewer.addEventListener('remove', e => this._onRemove(e.detail));
  }

  get viewer() { return this.app.viewer; }

  /** Paredes do modelo (opcionalmente só as de um nível). */
  walls(level) {
    return this.viewer.elements().filter(e => e.userData.bim.wall && e.visible && (!level || this.app.levels.ofElement(e) === level));
  }

  /** Eixo da parede em coordenadas de mundo. */
  axisOf(wall) {
    const w = wall.userData.bim.wall;
    wall.updateMatrixWorld(true);
    const a = new THREE.Vector3(w.start[0], w.start[1], w.base).applyMatrix4(wall.matrixWorld);
    const b = new THREE.Vector3(w.end[0], w.end[1], w.base).applyMatrix4(wall.matrixWorld);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    return { a, b, len, dir: new THREE.Vector3((b.x - a.x) / len, (b.y - a.y) / len, 0), base: a.z, thickness: w.thickness };
  }

  /** Parede mais próxima de um ponto em planta: { wall, t (m ao longo do eixo), dist, side (+1 esquerda / −1 direita) }. */
  findWall([x, y], level, maxDist = 0.6) {
    let best = null;
    for (const wall of this.walls(level)) {
      const ax = this.axisOf(wall);
      if (ax.len < 1e-6) continue;
      const rx = x - ax.a.x, ry = y - ax.a.y;
      const t = Math.min(ax.len, Math.max(0, rx * ax.dir.x + ry * ax.dir.y));
      const px = ax.a.x + ax.dir.x * t, py = ax.a.y + ax.dir.y * t;
      const dist = Math.hypot(x - px, y - py);
      const limit = Math.max(maxDist, ax.thickness / 2 + 0.15);
      if (dist <= limit && (!best || dist < best.dist)) {
        const side = ax.dir.x * ry - ax.dir.y * rx >= 0 ? 1 : -1;
        best = { wall, t, dist, side };
      }
    }
    return best;
  }

  /** Posição e rotação de uma instância no ponto t da parede; o vão fica inteiro dentro do comprimento. */
  pose(wall, t, flip, opening) {
    const ax = this.axisOf(wall);
    const w = opening?.width || 0;
    const ox = (opening?.x || 0) * (flip ? -1 : 1);
    if (w > ax.len + 1e-6) return null;
    // t é o centro do vão; a origem do objeto fica deslocada de −ox
    const center = Math.min(ax.len - w / 2, Math.max(w / 2, t));
    const origin = center - ox;
    return {
      offset: +center.toFixed(4),
      position: [ax.a.x + ax.dir.x * origin, ax.a.y + ax.dir.y * origin, ax.base],
      rotation: Math.atan2(ax.dir.y, ax.dir.x) / DEG + (flip ? 180 : 0),
    };
  }

  /** Hospeda (ou re-hospeda) a instância na parede, no centro de vão "offset". */
  attach(inst, wall, { offset, flip = false }) {
    const b = inst.userData.bim;
    const p = this.pose(wall, offset, flip, b.opening);
    if (!p) throw new Error(`O vão (${(b.opening?.width || 0).toFixed(2)} m) não cabe na parede "${wall.name}".`);
    inst.position.set(...p.position);
    inst.rotation.set(0, 0, p.rotation * DEG);
    b.host = { wallId: wall.uuid, offset: p.offset, flip: !!flip };
    b.levelId = wall.userData.bim.levelId || b.levelId;
    b.props = { ...b.props, Hospedeiro: wall.name, 'Deslocamento na parede': p.offset };
    this._writeOpening(wall, inst);
    return inst;
  }

  /** Reaplica o vão na parede depois que a instância mudou (parâmetros, dimensões). */
  sync(inst) {
    const host = inst.userData.bim.host;
    const wall = host && this.viewer.findById(host.wallId);
    if (!wall) return false;
    this.attach(inst, wall, host);
    return true;
  }

  /** Depois de mover a instância à mão: projeta de volta no eixo da parede. */
  reproject(inst) {
    const host = inst.userData.bim.host;
    const wall = host && this.viewer.findById(host.wallId);
    if (!wall) return false;
    const ax = this.axisOf(wall);
    const ox = (inst.userData.bim.opening?.x || 0) * (host.flip ? -1 : 1);
    const t = (inst.position.x - ax.a.x) * ax.dir.x + (inst.position.y - ax.a.y) * ax.dir.y + ox;
    this.attach(inst, wall, { offset: t, flip: host.flip });
    return true;
  }

  detach(inst) {
    const host = inst.userData.bim.host;
    const wall = host && this.viewer.findById(host.wallId);
    delete inst.userData.bim.host;
    if (inst.userData.bim.props) { delete inst.userData.bim.props.Hospedeiro; delete inst.userData.bim.props['Deslocamento na parede']; }
    if (wall?.parent) {
      wall.userData.bim.wall.openings = (wall.userData.bim.wall.openings || []).filter(o => o.id !== inst.uuid);
      this._rebuild(wall);
    }
  }

  hostedOf(wall) {
    const ids = new Set((wall.userData.bim.wall?.openings || []).map(o => o.id));
    return this.viewer.elements().filter(e => ids.has(e.uuid));
  }

  /** Depois de trocar o tipo (espessura) da parede: atualiza o parâmetro espessuraParede e o vão dos hospedados. */
  async refreshHostedOf(wall) {
    for (const inst of this.hostedOf(wall)) {
      const def = this.app.objects.get(inst.userData.bim.objectId);
      if (def?.parameters.some(p => p.name === 'espessuraParede')) {
        await this.app.objects.regenerate(inst, { espessuraParede: wall.userData.bim.wall.thickness });
        this.viewer._prepare2D(inst);
      }
      this.sync(inst);
    }
  }

  _writeOpening(wall, inst) {
    const b = inst.userData.bim, o = b.opening || { width: 0, height: 0, sill: 0 };
    const w = wall.userData.bim.wall;
    w.openings = (w.openings || []).filter(x => x.id !== inst.uuid);
    w.openings.push({ id: inst.uuid, offset: b.host.offset, width: o.width, sill: o.sill, height: o.height });
    this._rebuild(wall);
  }

  _rebuild(wall) {
    rebuildElement(wall);
    this.viewer._prepare2D(wall);
    this.viewer.changed();
  }

  _onRemove(obj) {
    if (!obj?.userData?.bim) return;
    if (obj.userData.bim.host) this.detach(obj);
    // parede apagada: some com as portas e janelas que ela hospedava (como no Revit)
    for (const o of obj.userData.bim.wall?.openings || []) {
      const inst = this.viewer.findById(o.id);
      if (inst) { delete inst.userData.bim.host; this.viewer.remove(inst); }
    }
  }
}
