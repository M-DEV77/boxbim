// GIZMO DA ORIGEM (0, 0): eixos X (vermelho), Y (verde) e Z (azul, no 3D e nas elevações) saindo do ponto 0,0 do
// projeto, com o rótulo "0,0". Tamanho fixo na tela (SVG por cima do canvas, refeito a cada quadro), na cota do
// nível nas plantas. Fora da tela, uma seta na borda aponta para a origem — clicar nela enquadra a origem.
// Ligar/desligar: chip "Origem" na vista (fica neste navegador).
import * as THREE from 'three';
import { h } from './ui.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
const LEN = 46; // comprimento das setas na tela (px)
const AXES = [
  { key: 'x', v: [1, 0, 0], color: '#ff5a52' },
  { key: 'y', v: [0, 1, 0], color: '#3fd16b' },
  { key: 'z', v: [0, 0, 1], color: '#4c9bff' },
];

export class OriginGizmo {
  constructor(app) {
    this.app = app;
    try { this.on = localStorage.getItem('boxbim.origem') !== '0'; } catch { this.on = true; }
    this.svg = svg('svg', { class: 'origin-svg' });
    this.parts = AXES.map(a => {
      const g = svg('g', { 'data-axis': a.key });
      const line = svg('line', { stroke: a.color, 'stroke-width': 2, 'stroke-linecap': 'round' });
      const head = svg('path', { fill: a.color });
      const label = svg('text', { fill: a.color, 'font-size': 11, 'font-weight': 700, 'text-anchor': 'middle', 'dominant-baseline': 'central' });
      label.textContent = a.key.toUpperCase();
      g.append(line, head, label);
      this.svg.append(g);
      return { ...a, g, line, head, label };
    });
    this.dot = svg('circle', { r: 4.5, class: 'origin-dot' });
    this.ring = svg('circle', { r: 9, class: 'origin-ring' });
    this.svg.append(this.ring, this.dot);
    this.tag = h('div', { class: 'origin-tag' }, '0,0');
    this.edge = h('button', { class: 'origin-edge', title: 'A origem (0,0) está fora da tela — clique para enquadrá-la', onclick: () => this.frame() }, '0,0');
    this.box = h('div', { class: 'origin-gizmo' }, this.svg, this.tag, this.edge);
    document.querySelector('.center').append(this.box);
    app.viewer.frameHooks.push(() => this.update());
  }

  setVisible(on) {
    this.on = !!on;
    try { localStorage.setItem('boxbim.origem', on ? '1' : '0'); } catch { /* sem armazenamento */ }
    this.update();
  }

  /** Cota da origem na vista ativa (plantas: cota do nível). */
  z() { return this.app.views.activeLevel()?.elevation ?? 0; }

  /** Leva a vista até a origem (mantém a direção e o zoom). */
  frame() {
    const v = this.app.viewer;
    const offset = v.camera.position.clone().sub(v.controls.target);
    v.controls.target.set(0, 0, this.z());
    v.camera.position.copy(v.controls.target).add(offset);
    v.controls.update();
  }

  update() {
    const app = this.app, v = app.viewer;
    const show = this.on && !v.renderOverride;
    if (!show) { if (!this.box.hidden) this.box.hidden = true; return; }
    this.box.hidden = false;
    const c = v.renderer.domElement.getBoundingClientRect(), pr = this.box.getBoundingClientRect();
    const kind = app.views.active.kind;
    const z = this.z();
    const toScreen = p => { const q = p.clone().project(v.camera); return { x: (q.x + 1) / 2 * c.width + c.left - pr.left, y: (1 - q.y) / 2 * c.height + c.top - pr.top, behind: q.z > 1 || q.z < -1 }; };
    const o = toScreen(new THREE.Vector3(0, 0, z));
    const inside = !o.behind && o.x > 8 && o.y > 8 && o.x < c.width - 8 && o.y < c.height - 8;
    this.svg.style.display = inside ? '' : 'none';
    this.tag.hidden = !inside;
    this.edge.hidden = inside;
    if (!inside) {
      // seta na borda, na direção da origem
      const cx = c.width / 2, cy = c.height / 2;
      let dx = o.x - cx, dy = o.y - cy;
      if (o.behind) { dx = -dx; dy = -dy; }
      const k = Math.min((c.width / 2 - 30) / Math.abs(dx || 1e-6), (c.height / 2 - 18) / Math.abs(dy || 1e-6));
      const ang = Math.atan2(dy, dx) * 180 / Math.PI;
      Object.assign(this.edge.style, { left: `${cx + dx * k}px`, top: `${cy + dy * k}px` });
      this.edge.style.setProperty('--ang', `${ang}deg`);
      return;
    }
    // escala da seta: um passo pequeno no mundo, normalizado para LEN px na tela
    const step = Math.max(1e-3, v._worldPerPixel(o.x + pr.left, o.y + pr.top) * 10);
    for (const p of this.parts) {
      const hide = p.key === 'z' && (kind === 'plan' || kind === 'ceiling');
      p.g.style.display = hide ? 'none' : '';
      if (hide) continue;
      const e = toScreen(new THREE.Vector3(p.v[0] * step, p.v[1] * step, z + p.v[2] * step));
      let dx = e.x - o.x, dy = e.y - o.y;
      const L = Math.hypot(dx, dy);
      if (L < 0.5) { p.g.style.display = 'none'; continue; } // eixo apontando para quem olha
      dx /= L; dy /= L;
      const tx = o.x + dx * LEN, ty = o.y + dy * LEN;
      p.line.setAttribute('x1', o.x + dx * 9); p.line.setAttribute('y1', o.y + dy * 9);
      p.line.setAttribute('x2', tx - dx * 6); p.line.setAttribute('y2', ty - dy * 6);
      const nx = -dy, ny = dx;
      p.head.setAttribute('d', `M${tx} ${ty}L${tx - dx * 9 + nx * 4.5} ${ty - dy * 9 + ny * 4.5}L${tx - dx * 9 - nx * 4.5} ${ty - dy * 9 - ny * 4.5}Z`);
      p.label.setAttribute('x', tx + dx * 9); p.label.setAttribute('y', ty + dy * 9);
    }
    for (const el of [this.dot, this.ring]) { el.setAttribute('cx', o.x); el.setAttribute('cy', o.y); }
    Object.assign(this.tag.style, { left: `${o.x}px`, top: `${o.y}px` });
  }
}
