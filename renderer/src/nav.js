// Widget de eixos (canto da vista 3D): mostra a orientação X/Y/Z da câmera, olha a partir de um eixo com um
// clique na ponta dele e ORBITA a câmera em torno de X, Y ou Z (botões ↺/↻; Shift = passos de 90°).
import * as THREE from 'three';
import { h } from './ui.js';

const AXES = [
  { key: 'X', dir: new THREE.Vector3(1, 0, 0), color: '#e5534b' },
  { key: 'Y', dir: new THREE.Vector3(0, 1, 0), color: '#3fb950' },
  { key: 'Z', dir: new THREE.Vector3(0, 0, 1), color: '#4493f8' },
];
const SIZE = 92, R = 34;
const SVG = 'http://www.w3.org/2000/svg';

export class AxisWidget {
  /** getCamera/getControls: funções (o viewer troca de câmera entre 3D e vistas 2D). */
  constructor({ getCamera, getControls, step = 15 }) {
    this.getCamera = getCamera;
    this.getControls = getControls;
    this.step = step;
    this.svg = document.createElementNS(SVG, 'svg');
    this.svg.setAttribute('width', SIZE);
    this.svg.setAttribute('height', SIZE);
    this.svg.setAttribute('viewBox', `${-SIZE / 2} ${-SIZE / 2} ${SIZE} ${SIZE}`);
    const orbit = (axis, sign) => h('button', {
      title: `Orbitar em torno de ${axis} (${sign > 0 ? 'anti-horário' : 'horário'}) — Shift: 90°`,
      onclick: e => this.orbit(axis, sign * (e.shiftKey ? 90 : this.step)),
    }, sign > 0 ? '↺' : '↻');
    this.el = h('div', { class: 'axis-widget' },
      h('div', { class: 'aw-gizmo', title: 'Clique numa ponta para olhar a partir daquele eixo' }, this.svg),
      h('div', { class: 'aw-orbit' }, AXES.map(a => h('div', { class: 'aw-row' },
        orbit(a.key, 1), h('span', { style: `color:${a.color}` }, a.key), orbit(a.key, -1)))));
    this._q = new THREE.Quaternion();
  }

  /** Redesenha os eixos conforme a câmera (chamar a cada quadro). */
  update() {
    const cam = this.getCamera();
    if (!cam) return;
    this._q.copy(cam.quaternion).invert();
    const items = [];
    for (const a of AXES) {
      for (const s of [1, -1]) {
        const v = a.dir.clone().multiplyScalar(s).applyQuaternion(this._q);
        items.push({ a, s, x: v.x * R, y: -v.y * R, z: v.z });
      }
    }
    items.sort((p, q) => p.z - q.z); // de trás para a frente
    const key = items.map(i => `${i.a.key}${i.s}${i.x.toFixed(1)},${i.y.toFixed(1)}`).join('|');
    if (key === this._last) return;
    this._last = key;
    this.svg.innerHTML = '';
    for (const i of items) {
      const pos = i.s > 0;
      if (pos) {
        const line = document.createElementNS(SVG, 'line');
        Object.entries({ x1: 0, y1: 0, x2: i.x, y2: i.y, stroke: i.a.color, 'stroke-width': 2.5, 'stroke-linecap': 'round' }).forEach(([k, v]) => line.setAttribute(k, v));
        this.svg.append(line);
      }
      const c = document.createElementNS(SVG, 'circle');
      Object.entries({ cx: i.x, cy: i.y, r: pos ? 9 : 6, fill: pos ? i.a.color : '#1b1f26', stroke: i.a.color, 'stroke-width': pos ? 0 : 1.5 }).forEach(([k, v]) => c.setAttribute(k, v));
      c.style.cursor = 'pointer';
      const title = document.createElementNS(SVG, 'title');
      title.textContent = `Olhar a partir de ${pos ? '+' : '−'}${i.a.key}`;
      c.append(title);
      c.addEventListener('click', () => this.lookFrom(i.a.dir.clone().multiplyScalar(i.s)));
      this.svg.append(c);
      if (pos) {
        const t = document.createElementNS(SVG, 'text');
        Object.entries({ x: i.x, y: i.y + 3.5, 'text-anchor': 'middle', 'font-size': 10, 'font-weight': 700, fill: '#fff' }).forEach(([k, v]) => t.setAttribute(k, v));
        t.textContent = i.a.key;
        t.style.pointerEvents = 'none';
        this.svg.append(t);
      }
    }
  }

  /** Olha a partir de uma direção (a câmera fica do lado dela, olhando para o alvo). */
  lookFrom(dir) {
    const cam = this.getCamera(), ctl = this.getControls();
    const dist = cam.position.distanceTo(ctl.target);
    // Z puro coincide com o "para cima" da câmera: desloca um fio para manter a orientação
    const d = Math.abs(dir.z) > 0.99 ? new THREE.Vector3(0, -0.001 * Math.sign(dir.z), dir.z).normalize() : dir;
    this.animate(ctl.target.clone().addScaledVector(d, dist));
  }

  /** Orbita a câmera em torno de um eixo do mundo que passa pelo alvo. */
  orbit(axis, deg) {
    const cam = this.getCamera(), ctl = this.getControls();
    const a = AXES.find(x => x.key === axis).dir;
    const off = cam.position.clone().sub(ctl.target).applyAxisAngle(a, THREE.MathUtils.degToRad(deg));
    // evita cair exatamente no polo (o "para cima" é Z)
    if (Math.abs(off.clone().normalize().z) > 0.999) off.applyAxisAngle(new THREE.Vector3(1, 0, 0), 0.01);
    this.animate(ctl.target.clone().add(off));
  }

  animate(to) {
    const cam = this.getCamera(), ctl = this.getControls();
    const from = cam.position.clone();
    const target = ctl.target.clone();
    const r0 = from.distanceTo(target), r1 = to.distanceTo(target);
    const u0 = from.clone().sub(target).normalize(), u1 = to.clone().sub(target).normalize();
    const t0 = performance.now(), dur = 220;
    cancelAnimationFrame(this._raf);
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / dur);
      const k = t * (2 - t);
      // interpola a direção na esfera (mantém a distância ao alvo)
      const u = u0.clone().lerp(u1, k);
      if (u.lengthSq() < 1e-8) u.copy(u1); else u.normalize();
      cam.position.copy(target).addScaledVector(u, r0 + (r1 - r0) * k);
      cam.lookAt(target);
      ctl.update();
      if (t < 1) this._raf = requestAnimationFrame(step);
    };
    step();
  }
}
