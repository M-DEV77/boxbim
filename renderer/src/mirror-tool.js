// Ferramenta ESPELHAR (como o MIRROR do AutoCAD / Espelhar do Revit) usando uma LINHA como base:
//   1. selecione o que espelhar (antes, ou clicando com a ferramenta; Shift soma) e Enter
//   2. a linha do espelho: dois cliques (2D no plano do nível · 3D sobre os sólidos) ou clique numa linha 2D/parede
//      existente ("Pegar linha")
// O plano do espelho contém a linha e é: vertical (espelho em planta — o comum) · horizontal (vira de cabeça para
// baixo, linha na horizontal) · ou perpendicular ao eixo de trabalho ativo (espelho na fachada desenhada nele).
// "Manter o original" espelha cópias. Linhas, paredes e vigas são espelhadas nos dados (a parede troca início e fim,
// para a face externa continuar do lado espelhado); o resto, pela matriz do elemento.
import * as THREE from 'three';
import { h, toast } from './ui.js';
import { rebuildElement } from './elements.js';
import { isSketch, bake, rebuildSketch, frameOf, distToSeg, sweepOf } from './sketch/sketch.js';
import { handlesOf } from './sketch/linear.js';
import { CopyTool, copyElements } from './copy-tool.js';

const store = (k, v) => { try { localStorage.setItem(k, v); } catch { /* sem armazenamento */ } };
const load = k => { try { return localStorage.getItem(k); } catch { return null; } };
const AXIS = new THREE.LineDashedMaterial({ color: 0xff9f1c, dashSize: 0.3, gapSize: 0.15, depthTest: false });
const PLANES = { vertical: 'Vertical (planta)', horizontal: 'Horizontal', eixo: '⊥ ao eixo de trabalho' };

export class MirrorTool extends CopyTool {
  constructor(app) {
    super(app);
    this.keep = load('boxbim.espelhoManter') !== '0';
    this.planeKind = PLANES[load('boxbim.espelhoPlano')] ? load('boxbim.espelhoPlano') : 'vertical';
    this.pickLine = false;
  }

  start() {
    for (const t of [this.app.copyTool]) if (t?.active) t.stop();
    super.start();
    this.a = null;
  }

  stop() {
    const n = this.made;
    super.stop();
    this.app.status(n ? `${n} elemento(s) espelhado(s).` : 'Pronto.');
  }

  buildPanel() {
    const seg = (opts, get, set) => h('div', { class: 'seg-btns' }, Object.entries(opts).map(([k, label]) => {
      const b = h('button', { class: get() === k ? 'on' : '', onclick: () => { set(k); b.parentElement.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); this.sync(); } }, label);
      return b;
    }));
    this.selInfo = h('div', { class: 'small muted' });
    this.help = h('p', { class: 'small muted' });
    this.panel = h('div', { class: 'tool-panel' },
      h('div', { class: 'tool-panel-head' }, h('strong', {}, '⇋ Espelhar'), h('span', { class: 'spacer' }),
        h('button', { class: 'primary', onclick: () => this.stop(), title: 'Termina (Esc)' }, 'Sair')),
      this.selInfo,
      h('h4', {}, 'Linha do espelho'),
      seg({ pontos: 'Dois pontos', linha: 'Pegar linha' }, () => (this.pickLine ? 'linha' : 'pontos'), k => { this.pickLine = k === 'linha'; this.a = null; }),
      seg({ '2d': '2D · plano do nível', '3d': '3D · sobre os sólidos' }, () => (this.mode3d ? '3d' : '2d'), k => { this.mode3d = k === '3d'; store('boxbim.copia3d', this.mode3d ? '1' : '0'); }),
      h('h4', {}, 'Plano do espelho (contém a linha)'),
      seg(PLANES, () => this.planeKind, k => { this.planeKind = k; store('boxbim.espelhoPlano', k); }),
      h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: this.keep, onchange: e => { this.keep = e.target.checked; store('boxbim.espelhoManter', this.keep ? '1' : '0'); } }), 'Manter o original (espelha uma cópia)'),
      h('div', { class: 'row-buttons' }, h('button', { onclick: () => { if (this.viewer.selected.size) { this.step = 'base'; this.a = null; this.sync(); } }, title: 'Enter' }, 'Definir a linha')),
      this.help);
    this._sidebarWasCollapsed = document.querySelector('.layout')?.classList.contains('right-collapsed');
    if (this._sidebarWasCollapsed) this.app.setSidebar('right', false, false);
    this.app.showTab('props');
    (document.querySelector('.tab-body[data-body="props"]') || document.querySelector('.center')).prepend(this.panel);
    this.tip = h('div', { class: 'draw-tip', hidden: true });
    this.marker = h('div', { class: 'snap-marker', hidden: true });
    document.querySelector('.center').append(this.tip, this.marker);
  }

  sync() {
    if (!this.panel) return;
    const n = this.viewer.selected.size;
    this.selInfo.textContent = n ? `${n} elemento(s) selecionado(s)` : 'Nada selecionado ainda.';
    const msg = this.step === 'selecionar' ? 'Clique nos elementos a espelhar (Shift soma) e Enter.'
      : this.pickLine ? 'Clique numa linha 2D ou numa parede: ela é a linha do espelho.'
        : !this.a ? 'Clique o 1º ponto da linha do espelho.' : 'Clique o 2º ponto da linha do espelho (F8/Shift ORTO).';
    this.help.textContent = msg;
    this.app.status(`Espelhar: ${msg}`);
  }

  move(e) {
    this.lastEvent = e;
    for (const c of [...this.group.children]) { this.group.remove(c); c.geometry?.dispose(); }
    if (this.step === 'selecionar') { this.tip.hidden = true; return; }
    let line = null;
    if (this.pickLine) line = this.lineAt(e);
    else {
      this.base = this.a; // ORTO/snap relativos ao 1º ponto
      const res = this.resolve(e);
      if (res && this.a) line = [this.a, res.p];
    }
    if (line) {
      const ext = line[1].clone().sub(line[0]).multiplyScalar(0.5);
      const ln = new THREE.Line(new THREE.BufferGeometry().setFromPoints([line[0].clone().sub(ext), line[1].clone().add(ext)]), AXIS);
      ln.computeLineDistances();
      this.group.add(ln);
      // prévia: a caixa da seleção espelhada
      const R = this.reflection(line);
      if (R) {
        const box = new THREE.Box3();
        for (const el of this.viewer.selected) box.expandByObject(el);
        if (!box.isEmpty()) this.group.add(new THREE.Box3Helper(box.clone().applyMatrix4(R), 0xff9f1c));
      }
    }
    this.tip.hidden = !line;
  }

  /** Linha 2D ou eixo de parede sob o cursor (no plano do nível): [A, B] no modelo. */
  lineAt(e) {
    const ray = this.ray(e);
    const z = this.level.elevation;
    const hit = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), -z), new THREE.Vector3());
    if (!hit) return null;
    const p = [hit.x, hit.y];
    const px = (() => { const r2 = this.ray({ clientX: e.clientX + 1, clientY: e.clientY }).ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), -z), new THREE.Vector3()); return r2 ? r2.distanceTo(hit) : 0.02; })();
    let best = null, bd = 10 * px;
    for (const el of this.viewer.elements()) {
      if (!el.visible) continue;
      let segs = [];
      if (isSketch(el) && !el.userData.bim.linha.arco) {
        const l = bake(el).userData.bim.linha, f = frameOf(l);
        const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...f.u), new THREE.Vector3(...f.v), new THREE.Vector3(...f.u).cross(new THREE.Vector3(...f.v))).setPosition(...f.o);
        const A = new THREE.Vector3(l.a[0], l.a[1], 0).applyMatrix4(m), B = new THREE.Vector3(l.b[0], l.b[1], 0).applyMatrix4(m);
        segs = [[A, B]];
      } else if (el.userData.bim.wall || el.userData.bim.beam) {
        const hd = handlesOf(this.app, el)[0];
        if (hd) segs = [[new THREE.Vector3(hd.l.a[0], hd.l.a[1], z), new THREE.Vector3(hd.l.b[0], hd.l.b[1], z)]];
      }
      for (const [A, B] of segs) {
        const d = distToSeg({ a: [A.x, A.y], b: [B.x, B.y], arco: null }, p);
        if (d < bd) { bd = d; best = [A, B]; }
      }
    }
    return best;
  }

  /** Matriz de reflexão pelo plano que contém a linha [A, B] (tipo escolhido no painel). */
  reflection([A, B]) {
    const d = B.clone().sub(A);
    if (d.length() < 1e-6) return null;
    d.normalize();
    let other;
    if (this.planeKind === 'vertical') other = new THREE.Vector3(0, 0, 1);
    else if (this.planeKind === 'horizontal') other = new THREE.Vector3(-d.y, d.x, 0).lengthSq() > 1e-9 ? new THREE.Vector3(-d.y, d.x, 0).normalize() : new THREE.Vector3(1, 0, 0);
    else {
      const wp = this.app.workPlanes.active;
      if (!wp) { toast('Ative um eixo de trabalho para espelhar perpendicular a ele.', 'error'); return null; }
      const f = this.app.workPlanes.frameOf(wp);
      other = new THREE.Vector3(...f.u).cross(new THREE.Vector3(...f.v)).normalize();
    }
    const N = d.clone().cross(other);
    if (N.lengthSq() < 1e-9) { toast('A linha é paralela à direção do plano escolhido: escolha outro plano do espelho.', 'error'); return null; }
    N.normalize();
    const R = new THREE.Matrix4().set(
      1 - 2 * N.x * N.x, -2 * N.x * N.y, -2 * N.x * N.z, 0,
      -2 * N.y * N.x, 1 - 2 * N.y * N.y, -2 * N.y * N.z, 0,
      -2 * N.z * N.x, -2 * N.z * N.y, 1 - 2 * N.z * N.z, 0,
      0, 0, 0, 1);
    const T = new THREE.Matrix4().makeTranslation(A.x, A.y, A.z), Ti = new THREE.Matrix4().makeTranslation(-A.x, -A.y, -A.z);
    const M = T.multiply(R).multiply(Ti);
    M.userData = { N, P: A.clone() };
    return M;
  }

  down(e) {
    if (e.button !== 0) return;
    if (this.step === 'selecionar') return super.down(e);
    let line = null;
    if (this.pickLine) { line = this.lineAt(e); if (!line) { this.app.status('Espelhar: clique sobre uma linha 2D ou uma parede.'); return; } }
    else {
      this.base = this.a;
      const res = this.resolve(e);
      if (!res) return;
      if (!this.a) { this.a = res.p.clone(); this.sync(); return; }
      line = [this.a, res.p.clone()];
    }
    const R = this.reflection(line);
    if (!R) return;
    this.mirror(R);
  }

  key(e) {
    if (e.target.matches?.('input, select, textarea')) return;
    if (e.key === 'Enter' && this.step === 'selecionar' && this.viewer.selected.size) { e.preventDefault(); e.stopPropagation(); this.step = 'base'; this.sync(); return; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (this.a) { this.a = null; this.sync(); } else this.stop(); return; }
    if (e.key === 'F8') { e.preventDefault(); this.app.wallTool.toggleOrtho(); }
  }

  async mirror(R) {
    const sel = [...this.viewer.selected];
    if (!sel.length) return;
    const targets = this.keep ? await copyElements(this.app, sel, new THREE.Vector3()) : sel;
    const done = mirrorElements(this.app, targets, R);
    this.made += done;
    this.a = null;
    this.viewer.select(targets.filter(t => t.parent));
    this.app.status(`${done} elemento(s) espelhado(s)${this.keep ? ' (cópias)' : ''}. Defina outra linha ou Esc.`);
    this.sync();
  }
}

/** Espelha os elementos pela matriz de reflexão R (com R.userData = { N, P }). Devolve quantos. */
export function mirrorElements(app, els, R) {
  const { N, P } = R.userData;
  const vertical = Math.abs(N.z) < 1e-9;
  const refl = q => { const v = new THREE.Vector3(q[0], q[1], q[2] ?? 0); return v.applyMatrix4(R); };
  const reflDir = d => { const v = new THREE.Vector3(...d); return v.sub(N.clone().multiplyScalar(2 * v.dot(N))); };
  const walls = [];
  let n = 0;
  for (const el of els) {
    const b = el.userData.bim;
    if (b.host) continue; // portas/janelas acompanham a parede (refeitas abaixo)
    if (isSketch(el)) {
      bake(el);
      const l = b.linha;
      if (!l.plano && vertical) {
        // linha de nível com espelho vertical: só os pontos em planta (arco: centro e ângulos)
        const r2 = q => { const v = refl([q[0], q[1], l.z]); return [+v.x.toFixed(6), +v.y.toFixed(6)]; };
        if (l.arco) {
          const c = r2(l.arco.c), A = r2(l.b), Bp = r2(l.a), s = sweepOf(l.arco);
          const a0 = Math.atan2(A[1] - c[1], A[0] - c[0]);
          l.arco = { c, r: l.arco.r, a0, a1: a0 + s };
          l.a = A; l.b = Bp;
        } else { l.a = r2(l.a); l.b = r2(l.b); }
      } else {
        // linha num plano qualquer: espelha o plano (as coordenadas no plano não mudam)
        const f = frameOf(l);
        const o = refl(f.o);
        l.plano = { o: o.toArray().map(v => +v.toFixed(6)), u: reflDir(f.u).toArray(), v: reflDir(f.v).toArray() };
        l.z = 0;
      }
      rebuildSketch(el);
    } else if ((b.wall || b.beam) && vertical) {
      // eixo espelhado; a parede troca início/fim (a face externa fica do lado espelhado) e os vãos acompanham
      const hd = handlesOf(app, el)[0];
      const A = refl([hd.l.a[0], hd.l.a[1], 0]), B = refl([hd.l.b[0], hd.l.b[1], 0]);
      const d = b.wall || b.beam;
      el.updateMatrixWorld(true);
      const inv = el.matrixWorld.clone().invert();
      const z = b.wall ? d.base : d.top;
      const [s, e] = b.wall ? [B, A] : [A, B];
      const ls = new THREE.Vector3(s.x, s.y, z).applyMatrix4(inv), le = new THREE.Vector3(e.x, e.y, z).applyMatrix4(inv);
      d.start = [+ls.x.toFixed(6), +ls.y.toFixed(6)]; d.end = [+le.x.toFixed(6), +le.y.toFixed(6)];
      if (b.wall) {
        const L = Math.hypot(d.end[0] - d.start[0], d.end[1] - d.start[1]);
        [d.miterStart, d.miterEnd] = [-(d.miterEnd || 0), -(d.miterStart || 0)];
        [d.extendStart, d.extendEnd] = [d.extendEnd || 0, d.extendStart || 0];
        for (const o of d.openings || []) o.offset = L - o.offset;
        walls.push({ el, L });
      } else { [d.miterStart, d.miterEnd] = [-(d.miterStart || 0), -(d.miterEnd || 0)]; }
      rebuildElement(el);
    } else {
      // demais: reflexão na matriz do elemento (o renderizador inverte as faces sozinho)
      el.updateMatrix();
      el.matrix.premultiply(R);
      el.matrix.decompose(el.position, el.quaternion, el.scale);
    }
    app.viewer._prepare2D(el);
    n++;
  }
  // portas e janelas das paredes espelhadas: deslocamento a partir do novo início e lado trocado
  for (const { el: wall, L } of walls) {
    for (const inst of app.hosting.hostedOf(wall)) {
      const hb = inst.userData.bim.host;
      try { app.hosting.attach(inst, wall, { offset: L - hb.offset, flip: !hb.flip }); n++; } catch { /* fica onde está */ }
    }
  }
  // portas/janelas soltas (sem parede na seleção): pela matriz
  for (const el of els) {
    const b = el.userData.bim;
    if (!b.host || walls.some(w => app.hosting.hostedOf(w.el).includes(el))) continue;
    el.updateMatrix(); el.matrix.premultiply(R); el.matrix.decompose(el.position, el.quaternion, el.scale);
    n++;
  }
  void P;
  app.viewer.changed();
  return n;
}
