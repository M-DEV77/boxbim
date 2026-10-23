// Ferramenta "Desenhar parede": paredes encadeadas desenhadas com o mouse, como uma polilinha do AutoCAD.
//
//   clique ............ ponto inicial / próximo ponto (cada trecho vira uma parede)
//   F8 ................ liga/desliga ORTO (trava em 0° / 90°); Shift inverte enquanto pressionado
//   número + Enter .... comprimento digitado na direção do cursor (entrada direta de distância)
//   C ................. fecha o contorno no ponto inicial
//   Backspace ......... desfaz o último trecho
//   Enter / botão dir.  termina a sequência (a ferramenta continua ativa)
//   Esc ............... termina a sequência; Esc de novo sai da ferramenta
//   botão do meio ..... arrasta a vista; roda do mouse = zoom
//
// Modo "Por linha de referência": clicar numa linha do desenho 2D cria as paredes ao longo dela (e das linhas
// ligadas a ela pelas pontas). Nos dois modos, a LINHA DE LOCALIZAÇÃO diz onde a parede fica em relação à linha
// clicada/desenhada: no centro, na parte interna ou na externa (num contorno fechado, interna = para dentro;
// numa linha aberta, interna = à esquerda do sentido do desenho — "Inverter lado" troca).
// As opções ficam no painel da direita (aba Propriedades) enquanto a ferramenta está ativa.
import * as THREE from 'three';
import { h, toast } from './ui.js';
import { wallGeometry, rebuildElement } from './elements.js';
import { createOnLevel } from './modeling.js';
import { fmtElev } from './levels.js';
import { fmtLen, fromUnit, toUnit, unitLabel } from './units.js';
import { isSketch, bake, distToSeg, offsetPolyline } from './sketch/sketch.js';
import { fixTees } from './sketch/linear.js';

const SNAP_PX = 12;      // raio do snap de ponta, em pixels
const GRID = 0.01;       // arredondamento sem snap: 1 cm
const fmtM = v => fmtLen(v);
const store = (k, v) => { try { localStorage.setItem(k, v); } catch { /* sem armazenamento */ } };
const load = k => { try { return localStorage.getItem(k); } catch { return null; } };

const LOCATIONS = { centro: 'Centro', interna: 'Parte interna', externa: 'Parte externa' };

/** Área com sinal (positiva = anti-horário). */
const signedArea = pts => pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;

// eixos das paredes = polilinha de referência deslocada (cantos em esquadria) — ver offsetPolyline em sketch.js
export const axisPolyline = offsetPolyline;

const MITER_MAX = 150 * Math.PI / 180; // curvas mais fechadas que isto: canto por prolongamento (a esquadria ficaria comprida demais)

/** Ângulo da curva entre dois trechos (rad, + = vira à esquerda). */
const turn = (s1, s2) => {
  const a = Math.atan2(s1.b[1] - s1.a[1], s1.b[0] - s1.a[0]), b = Math.atan2(s2.b[1] - s2.a[1], s2.b[0] - s2.a[0]);
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
};

/**
 * Junções de uma sequência de eixos: em cada ponta, meia-esquadria (miter) ou, em curva muito fechada,
 * prolongamento de meia espessura. Devolve [{ miterStart, miterEnd, extendStart, extendEnd }] por trecho.
 */
export function chainJoints(axes, closed, t) {
  const n = axes.length;
  const joint = (i, j) => {
    const phi = turn(axes[i], axes[j]);
    if (Math.abs(phi) < 1e-4) return { miter: 0, ext: 0 };          // alinhadas: emenda reta
    if (Math.abs(phi) <= MITER_MAX) return { miter: phi, ext: 0 };   // canto em meia-esquadria
    return { miter: 0, ext: t / 2 };                                 // curva muito fechada: prolonga
  };
  return axes.map((_, i) => {
    const prev = i > 0 ? i - 1 : (closed && n > 1 ? n - 1 : null);
    const next = i < n - 1 ? i + 1 : (closed && n > 1 ? 0 : null);
    const s = prev === null ? { miter: 0, ext: 0 } : joint(prev, i);
    const e = next === null ? { miter: 0, ext: 0 } : joint(i, next);
    return { miterStart: s.miter, miterEnd: e.miter, extendStart: s.ext, extendEnd: e.ext };
  });
}

const PREVIEW_MAT = new THREE.MeshStandardMaterial({ color: 0x1fbf3b, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false });
const RUBBER_MAT = new THREE.LineDashedMaterial({ color: 0x1fbf3b, dashSize: 0.25, gapSize: 0.12, depthTest: false });

export class WallDrawTool extends EventTarget {
  constructor(app) {
    super();
    this.app = app;
    this.active = false;
    this.ortho = load('boxbim.ortho') === '1';
    this.height = null;          // null = até o nível de cima
    this.typeId = load('boxbim.wallType') || null; // tipo de parede (camadas); a espessura vem dele
    this.mode = load('boxbim.wallMode') === 'linha' ? 'linha' : 'desenhar'; // clicar pontos | linha de referência
    this.loc = LOCATIONS[load('boxbim.wallLoc')] ? load('boxbim.wallLoc') : 'centro';
    this.flip = false;            // linha aberta: troca o lado interno/externo
    this.wholeChain = load('boxbim.wallChain') !== '0'; // linha de referência: as linhas ligadas também
    this._reset();
  }

  get viewer() { return this.app.viewer; }

  get type() { return this.app.types.get('wall', this.typeId) || this.app.types.get('wall'); }
  get thickness() { return this.app.types.thickness(this.type) || 0.15; }

  _reset() {
    this.chain = [];             // paredes desta sequência: { el }
    this.refPts = [];            // pontos clicados (linha de referência da sequência)
    this.last = null;            // último ponto [x, y]
    this.first = null;           // primeiro ponto da sequência
    this.typed = '';             // comprimento digitado
    this.cursor = null;          // último resultado de _resolve
  }

  // ---------------------------------------------------------------- ORTO

  setOrtho(on) {
    this.ortho = on;
    store('boxbim.ortho', on ? '1' : '0');
    this.dispatchEvent(new Event('ortho'));
    if (this.active) { this._syncBar(); if (this._lastEvent) this._move(this._lastEvent); }
  }

  toggleOrtho() { this.setOrtho(!this.ortho); }

  // ---------------------------------------------------------------- ativar / desativar

  start() {
    if (this.active) return;
    const v = this.app.views.active;
    if (v.kind === 'elevation') {
      toast('Para desenhar paredes, abra uma planta de piso ou a vista 3D.', 'error');
      return;
    }
    this.level = this.app.views.activeLevel() || this.app.levels.list[0];
    this.active = true;
    this._reset();
    this.viewer.tool = this;
    this.viewer.select([]);

    this.group = new THREE.Group();
    this.viewer.scene.add(this.group);
    this._lockControls();
    this._buildOverlay();

    const el = this.viewer.renderer.domElement;
    this._h = {
      move: e => this._move(e),
      down: e => this._down(e),
      dbl: e => { e.preventDefault(); this.finishChain(); },
      ctx: e => e.preventDefault(),
      key: e => this._key(e),
      keyup: e => { if (e.key === 'Shift' && this._lastEvent) this._move(this._lastEvent); },
      leave: () => { this.tip.hidden = true; this.marker.hidden = true; },
      view: () => this._onViewChange(),
    };
    el.addEventListener('pointermove', this._h.move);
    el.addEventListener('pointerdown', this._h.down);
    el.addEventListener('dblclick', this._h.dbl);
    el.addEventListener('contextmenu', this._h.ctx);
    el.addEventListener('pointerleave', this._h.leave);
    document.addEventListener('keydown', this._h.key, true);
    document.addEventListener('keyup', this._h.keyup, true);
    this.app.views.addEventListener('activate', this._h.view);
    el.style.cursor = 'crosshair';
    this._statusHelp();
    this.dispatchEvent(new Event('change'));
  }

  _statusHelp() {
    this.app.status(this.mode === 'linha'
      ? 'Parede por linha de referência: clique numa linha do desenho 2D (as ligadas a ela vêm junto) · Esc sai.'
      : 'Desenhar parede: clique o ponto inicial. F8 = ORTO · digite o comprimento + Enter · C fecha · Esc termina.');
  }

  stop() {
    if (!this.active) return;
    this.finishChain();
    this.active = false;
    const el = this.viewer.renderer.domElement;
    el.removeEventListener('pointermove', this._h.move);
    el.removeEventListener('pointerdown', this._h.down);
    el.removeEventListener('dblclick', this._h.dbl);
    el.removeEventListener('contextmenu', this._h.ctx);
    el.removeEventListener('pointerleave', this._h.leave);
    document.removeEventListener('keydown', this._h.key, true);
    document.removeEventListener('keyup', this._h.keyup, true);
    this.app.views.removeEventListener('activate', this._h.view);
    el.style.cursor = '';
    this._unlockControls();
    this.viewer.scene.remove(this.group);
    this._clearPreview();
    this.bar.remove(); this.tip.remove(); this.marker.remove();
    this.bar = null;
    if (this._sidebarWasCollapsed) this.app.setSidebar('right', true, false);
    this.viewer.tool = null;
    this.app.status('Pronto.');
    this.dispatchEvent(new Event('change'));
  }

  _onViewChange() {
    if (this.app.views.active.kind === 'elevation') { this.stop(); return; }
    this.finishChain();
    this._unlockControls();
    this._lockControls();
    const lvl = this.app.views.activeLevel();
    if (lvl) { this.level = lvl; this._syncBar(); }
  }

  /** Botão esquerdo desenha; o do meio arrasta a vista; o direito termina a sequência. */
  _lockControls() {
    const c = this.viewer.controls;
    this._savedButtons = { controls: c, buttons: { ...c.mouseButtons } };
    c.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: null };
  }

  _unlockControls() {
    if (!this._savedButtons) return;
    this._savedButtons.controls.mouseButtons = this._savedButtons.buttons;
    this._savedButtons = null;
  }

  // ---------------------------------------------------------------- barra de opções e dicas

  /** Opções da ferramenta no painel da direita (aba Propriedades), acima das propriedades. */
  _buildOverlay() {
    const center = document.querySelector('.center');
    const levels = this.app.levels.list;
    this.levelSel = h('select', { title: 'Nível de base', onchange: e => { this.level = this.app.levels.get(e.target.value); this.finishChain(); } },
      levels.map(l => h('option', { value: l.id, selected: l === this.level }, `${l.name} (${fmtElev(l.elevation)})`)));
    this.heightIn = h('input', { type: 'number', step: 'any', min: '0', placeholder: 'até o nível de cima', value: this.height === null ? '' : toUnit(this.height), title: 'Altura (vazio = até o nível de cima)',
      onchange: e => { this.height = e.target.value === '' ? null : fromUnit(e.target.value); } });
    this.typeSel = h('select', { title: 'Tipo de parede (camadas)', onchange: e => {
      this.typeId = e.target.value; store('boxbim.wallType', this.typeId); this._syncBar(); this.finishChain();
    } }, this.app.types.list('wall').map(t => h('option', { value: t.id, selected: t.id === this.type?.id }, t.name)));
    this.thickOut = h('span', { class: 'muted small', title: 'Espessura total do tipo' });
    this.orthoBtn = h('button', { class: 'toggle', title: 'ORTO: trava o ângulo em 0°/90° (F8)', onclick: () => this.toggleOrtho() }, 'ORTO');
    const seg = (opts, get, set) => h('div', { class: 'seg-btns' }, Object.entries(opts).map(([k, label]) => {
      const b = h('button', { class: get() === k ? 'on' : '', onclick: () => { set(k); b.parentElement.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); } }, label);
      return b;
    }));
    this.modeBtns = seg({ desenhar: '✎ Desenhar', linha: '⟋ Por linha de referência' }, () => this.mode, k => {
      this.mode = k; store('boxbim.wallMode', k); this.finishChain(); this._clearPreview(); this._syncBar(); this._statusHelp();
    });
    this.locBtns = seg(LOCATIONS, () => this.loc, k => { this.loc = k; store('boxbim.wallLoc', k); if (this._lastEvent) this._move(this._lastEvent); });
    this.flipChk = h('input', { type: 'checkbox', onchange: e => { this.flip = e.target.checked; if (this._lastEvent) this._move(this._lastEvent); } });
    this.chainChk = h('input', { type: 'checkbox', checked: this.wholeChain, onchange: e => { this.wholeChain = e.target.checked; store('boxbim.wallChain', this.wholeChain ? '1' : '0'); } });
    this.help = h('p', { class: 'small muted' });
    this.drawRow = h('div', { class: 'row-buttons' }, this.orthoBtn, h('button', { onclick: () => this.finishChain(), title: 'Termina a sequência (Enter)' }, 'Terminar'));
    this.chainRow = h('label', { class: 'inline' }, this.chainChk, 'Linhas ligadas também (cadeia inteira)');
    this.bar = h('div', { class: 'tool-panel' },
      h('div', { class: 'tool-panel-head' }, h('strong', {}, '▭ Parede'), h('span', { class: 'spacer' }),
        h('button', { class: 'primary', onclick: () => this.stop(), title: 'Sai da ferramenta (Esc)' }, 'Sair')),
      h('h4', {}, 'Modo'), this.modeBtns,
      h('h4', {}, 'Linha de localização'), this.locBtns,
      h('label', { class: 'inline', title: 'Linha aberta: a parte interna passa para o outro lado (num contorno fechado, interna é sempre para dentro)' }, this.flipChk, 'Inverter lado (linha aberta)'),
      this.chainRow,
      h('h4', {}, 'Parede'),
      h('div', { class: 'form' },
        h('label', {}, 'Nível', this.levelSel),
        h('label', {}, `Altura (${unitLabel()})`, this.heightIn),
        h('label', {}, 'Tipo', this.typeSel, this.thickOut)),
      this.drawRow,
      this.help);
    // painel da direita: mostra a aba Propriedades (e a barra, se estava recolhida)
    this._sidebarWasCollapsed = document.querySelector('.layout')?.classList.contains('right-collapsed');
    if (this._sidebarWasCollapsed) this.app.setSidebar('right', false, false);
    this.app.showTab('props');
    const body = document.querySelector('.tab-body[data-body="props"]');
    (body || center).prepend(this.bar);
    this.tip = h('div', { class: 'draw-tip', hidden: true });
    this.marker = h('div', { class: 'snap-marker', hidden: true });
    center.append(this.tip, this.marker);
    this._syncBar();
  }

  _syncBar() {
    if (!this.bar) return;
    this.orthoBtn.classList.toggle('on', this.ortho);
    this.thickOut.textContent = ` ${fmtLen(this.thickness, { suffix: true })}`;
    if (this.level) this.levelSel.value = this.level.id;
    const byLine = this.mode === 'linha';
    this.drawRow.hidden = byLine;
    this.chainRow.hidden = !byLine;
    this.help.textContent = byLine
      ? 'Clique numa linha do desenho 2D (Linha/Retângulo): as paredes seguem a linha — e as ligadas a ela, se marcado. Num contorno fechado, "Parte interna" põe a parede para dentro.'
      : 'Clique os pontos · digite o comprimento + Enter · C fecha · Backspace desfaz · Enter/botão direito termina · Esc sai. A localização vale para a linha que você desenha.';
  }

  /** Deslocamento do eixo (à esquerda do sentido) para a linha de localização escolhida. */
  _offset(pts, closed) {
    if (this.loc === 'centro') return 0;
    let d = (this.loc === 'interna' ? 1 : -1) * this.thickness / 2;
    if (closed) { if (signedArea(pts) < 0) d = -d; } // contorno horário: o lado de dentro é a direita
    else if (this.flip) d = -d;
    return d;
  }

  // ---------------------------------------------------------------- geometria do cursor

  _worldAt(e) {
    const el = this.viewer.renderer.domElement;
    const r = el.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.viewer.camera);
    const hit = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), -this.level.elevation), new THREE.Vector3());
    return hit ? [hit.x, hit.y] : null;
  }

  _toScreen([x, y]) {
    const el = this.viewer.renderer.domElement;
    const p = new THREE.Vector3(x, y, this.level.elevation).project(this.viewer.camera);
    return [(p.x + 1) / 2 * el.clientWidth, (1 - p.y) / 2 * el.clientHeight];
  }

  /** Pontas de parede para o snap: início da sequência e eixos de todas as paredes do mesmo nível. */
  _snapCandidates() {
    const pts = [];
    if (this.first && this.chain.length >= 2) pts.push({ p: this.first, kind: 'início' });
    for (const e of this.viewer.elements()) {
      const w = e.userData.bim?.wall;
      if (!w || !e.visible) continue;
      if (Math.abs(w.base - this.level.elevation) > 0.01 && this.app.levels.ofElement(e) !== this.level) continue;
      // pontas em coordenadas de mundo (a parede pode ter sido movida/girada)
      e.updateMatrixWorld(true);
      for (const q of [w.start, w.end]) {
        const v = new THREE.Vector3(q[0], q[1], 0).applyMatrix4(e.matrixWorld);
        pts.push({ p: [v.x, v.y], kind: 'ponta' });
      }
    }
    return pts;
  }

  /** Ponto final do cursor: snap de ponta > ORTO > arredondamento de 1 cm. */
  _resolve(e) {
    const raw = this._worldAt(e);
    if (!raw) return null;
    const rs = this._toScreen(raw);
    let best = null, bestD = SNAP_PX;
    for (const c of this._snapCandidates()) {
      if (this.last && Math.hypot(c.p[0] - this.last[0], c.p[1] - this.last[1]) < 1e-6) continue;
      const s = this._toScreen(c.p);
      const d = Math.hypot(s[0] - rs[0], s[1] - rs[1]);
      if (d < bestD) { bestD = d; best = c; }
    }
    if (best) return { p: [...best.p], snap: best.kind };
    let p = raw;
    const ortho = this.ortho !== !!e.shiftKey; // Shift inverte o ORTO, como no AutoCAD
    if (this.last && ortho) {
      const dx = p[0] - this.last[0], dy = p[1] - this.last[1];
      p = Math.abs(dx) >= Math.abs(dy) ? [p[0], this.last[1]] : [this.last[0], p[1]];
    }
    p = p.map(v => Math.round(v / GRID) * GRID);
    if (this.last && ortho) p = Math.abs(p[0] - this.last[0]) < 1e-9 ? [this.last[0], p[1]] : [p[0], this.last[1]];
    return { p, ortho };
  }

  // ---------------------------------------------------------------- eventos

  // ---------------------------------------------------------------- por linha de referência

  /** Linhas retas horizontais do desenho 2D (no plano de algum nível), com os dados já sem transformação. */
  _refLines() {
    return this.viewer.elements().filter(e => isSketch(e) && e.visible && !e.userData.bim.linha.plano && !bake(e).userData.bim.linha.arco);
  }

  /** Linha sob o cursor (até 10 px) e a cadeia ligada a ela: { pts, closed } (na ordem das pontas). */
  _pickRef(e) {
    const raw = this._worldAt(e);
    if (!raw) return null;
    const a = this._worldAt({ clientX: e.clientX + 1, clientY: e.clientY });
    const px = a ? Math.hypot(a[0] - raw[0], a[1] - raw[1]) : 0.02;
    const lines = this._refLines();
    let best = null, bestD = 10 * px;
    for (const el of lines) { const d = distToSeg(el.userData.bim.linha, raw); if (d < bestD) { bestD = d; best = el; } }
    if (!best) return null;
    const segOf = el => ({ a: el.userData.bim.linha.a, b: el.userData.bim.linha.b });
    if (!this.wholeChain) return { pts: [segOf(best).a, segOf(best).b], closed: false, els: [best] };
    // cadeia: anda pelas pontas compartilhadas (só onde a ligação é única — num "T" a cadeia para)
    const key = p => `${p[0].toFixed(4)},${p[1].toFixed(4)}`;
    const ends = new Map();
    for (const el of lines) for (const p of [segOf(el).a, segOf(el).b]) { const k = key(p); if (!ends.has(k)) ends.set(k, []); ends.get(k).push(el); }
    const used = new Set([best]);
    let pts = [segOf(best).a, segOf(best).b];
    for (const side of ['fim', 'inicio']) {
      for (;;) {
        const endP = side === 'fim' ? pts[pts.length - 1] : pts[0];
        const near = ends.get(key(endP)) || [];
        if (near.length !== 2) break;
        const next = near.find(x => !used.has(x));
        if (!next) break;
        used.add(next);
        const sg = segOf(next);
        const other = key(sg.a) === key(endP) ? sg.b : sg.a;
        if (side === 'fim') pts.push(other); else pts.unshift(other);
      }
    }
    let closed = false;
    if (pts.length > 3 && key(pts[0]) === key(pts[pts.length - 1])) { pts.pop(); closed = true; }
    return { pts, closed, els: [...used] };
  }

  _moveRef(e) {
    this._clearPreview();
    this.marker.hidden = true;
    const hit = this._pickRef(e);
    if (!hit) { this.tip.hidden = true; this.viewer.renderer.domElement.style.cursor = 'crosshair'; return; }
    this.viewer.renderer.domElement.style.cursor = 'pointer';
    const axes = axisPolyline(hit.pts, this._offset(hit.pts, hit.closed), hit.closed);
    axes.forEach((s, i) => this._preview(s.a, s.b, { ext0: i > 0 || hit.closed, ext1: i < axes.length - 1 || hit.closed, ref: [hit.pts[i], hit.pts[(i + 1) % hit.pts.length]] }));
    const pr = this.tip.parentElement.getBoundingClientRect();
    this.tip.textContent = `${axes.length} parede(s) · ${LOCATIONS[this.loc]}${hit.closed ? ' · contorno fechado' : ''} — clique para criar`;
    this.tip.hidden = false;
    Object.assign(this.tip.style, { left: `${e.clientX - pr.left + 16}px`, top: `${e.clientY - pr.top + 14}px` });
  }

  /** Cria as paredes ao longo da linha de referência clicada. */
  _createFromRef(e) {
    const hit = this._pickRef(e);
    if (!hit) { this.app.status('Clique sobre uma linha do desenho 2D (Linha, Retângulo) para criar as paredes nela.'); return; }
    const made = this._buildWalls(hit.pts, hit.closed);
    if (made.length) { fixTees(this.app, made); this.viewer.changed(); } // pontas que caem no meio de outra parede
    this._clearPreview();
    this.app.refreshTree();
    if (made.length) this.app.status(`${made.length} parede(s) criada(s) na linha de referência (${LOCATIONS[this.loc].toLowerCase()}). Clique outra linha ou Esc.`);
  }

  /** Paredes ao longo da polilinha de referência (eixos em esquadria, cantos fechados). */
  _buildWalls(pts, closed) {
    const t = this.thickness;
    const axes = axisPolyline(pts, this._offset(pts, closed), closed);
    const joints = chainJoints(axes, closed, t);
    const made = [];
    axes.forEach((s, i) => {
      if (Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) < GRID / 2) return;
      try {
        const el = createOnLevel('wall', {
          level: this.level.id, start: s.a, end: s.b, type: this.type.id,
          ...(this.height ? { height: this.height } : {}),
          extendStart: joints[i].extendStart, extendEnd: joints[i].extendEnd,
        }, this.app.levels);
        if (joints[i].miterStart || joints[i].miterEnd) {
          Object.assign(el.userData.bim.wall, { miterStart: joints[i].miterStart, miterEnd: joints[i].miterEnd });
          rebuildElement(el);
        }
        el.userData.bim.name = el.name = `Parede ${this._nextNumber()}`;
        this.viewer.add(el);
        made.push(el);
      } catch (err) { toast(err.message, 'error'); }
    });
    return made;
  }

  _move(e) {
    this._lastEvent = e;
    if (this.mode === 'linha') return this._moveRef(e);
    const res = this._resolve(e);
    this.cursor = res;
    if (!res) { this.tip.hidden = true; return; }
    // dica e marcador ficam na área central; o canvas começa abaixo das abas de vista
    const cr = this.viewer.renderer.domElement.getBoundingClientRect();
    const pr = this.tip.parentElement.getBoundingClientRect();
    let [sx, sy] = this._toScreen(res.p);
    sx += cr.left - pr.left; sy += cr.top - pr.top;
    this.marker.hidden = !res.snap;
    if (res.snap) Object.assign(this.marker.style, { left: `${sx}px`, top: `${sy}px` });

    this._clearPreview();
    let text;
    if (this.last) {
      const dx = res.p[0] - this.last[0], dy = res.p[1] - this.last[1];
      const len = Math.hypot(dx, dy);
      let ang = Math.atan2(dy, dx) * 180 / Math.PI;
      if (ang < 0) ang += 360;
      text = `${fmtLen(len, { suffix: true })}  ∠ ${ang.toFixed(1).replace('.', ',')}°`;
      if (len > 1e-3) {
        const [ax] = axisPolyline([this.last, res.p], this._offset([this.last, res.p], false), false);
        this._preview(ax.a, ax.b, { ext0: this.chain.length > 0, ref: [this.last, res.p] });
      }
    } else {
      text = `x ${fmtM(res.p[0])}  y ${fmtM(res.p[1])}`;
    }
    if (this.typed) text += `  ⌨ ${this.typed.replace('.', ',')} ${unitLabel()}`;
    if (res.snap) text += `  ◻ ${res.snap}`;
    else if (res.ortho) text += '  ORTO';
    this.tip.textContent = text;
    this.tip.hidden = false;
    Object.assign(this.tip.style, { left: `${sx + 16}px`, top: `${sy + 14}px` });
  }

  _down(e) {
    if (e.button === 2) { e.preventDefault(); this.finishChain(); return; }
    if (e.button !== 0) return;
    if (this.mode === 'linha') { this._createFromRef(e); return; }
    const res = this._resolve(e);
    if (res) this.place(res.p);
  }

  _key(e) {
    if (e.target.matches?.('input, select, textarea')) {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    const k = e.key;
    let handled = true;
    if (k === 'F8') this.toggleOrtho();
    else if (/^[0-9]$/.test(k) || ((k === ',' || k === '.') && !this.typed.includes('.'))) this.typed += k === ',' ? '.' : k;
    else if (k === 'Backspace') { if (this.typed) this.typed = this.typed.slice(0, -1); else this.undoLast(); }
    else if (k === 'Enter') { if (this.typed) this._applyTyped(); else this.finishChain(); }
    else if (k === 'Escape') {
      if (this.typed) this.typed = '';
      else if (this.last) this.finishChain();
      else this.stop();
    } else if (k === 'c' || k === 'C') this.closeChain();
    else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
      if (this.active && this._lastEvent) this._move(this._lastEvent);
    }
  }

  /** Entrada direta de distância: comprimento digitado na direção do cursor (já com ORTO). */
  _applyTyped() {
    const len = fromUnit(this.typed); // digitado na unidade do projeto
    this.typed = '';
    if (!this.last || !(len > 0) || !this.cursor) return;
    const dx = this.cursor.p[0] - this.last[0], dy = this.cursor.p[1] - this.last[1];
    const d = Math.hypot(dx, dy);
    if (d < 1e-9) { toast('Mova o cursor para indicar a direção.', 'error'); return; }
    this.place([this.last[0] + dx / d * len, this.last[1] + dy / d * len].map(v => +v.toFixed(6)));
  }

  // ---------------------------------------------------------------- criação das paredes

  place(p) {
    if (!this.last) {
      this.last = p; this.first = p;
      this.refPts = [p];
      this.app.status('Clique o próximo ponto (ou digite o comprimento + Enter).');
      return;
    }
    if (Math.hypot(p[0] - this.last[0], p[1] - this.last[1]) < GRID / 2) return;
    const closing = this.chain.length >= 2 && Math.hypot(p[0] - this.first[0], p[1] - this.first[1]) < 1e-6;
    let el;
    try {
      el = createOnLevel('wall', {
        level: this.level.id, start: this.last, end: p, type: this.type.id,
        ...(this.height ? { height: this.height } : {}),
      }, this.app.levels);
    } catch (err) { toast(err.message, 'error'); return; }
    el.userData.bim.name = el.name = `Parede ${this._nextNumber()}`;
    this.viewer.add(el);
    this.chain.push({ el });
    if (!closing) this.refPts.push(p);
    // eixos de toda a sequência pela linha de localização (cantos em esquadria)
    this._updateChain(closing);
    if (closing) {
      this.app.status(`Contorno fechado: ${this.chain.length} paredes.`);
      this._endChain();
      return;
    }
    this.last = p;
    this.app.status(`${this.chain.length} parede(s) nesta sequência. Enter termina · C fecha · Backspace desfaz.`);
  }

  /** Recalcula início/fim e prolongamentos das paredes da sequência a partir dos pontos clicados. */
  _updateChain(closed = false) {
    const t = this.thickness, n = this.chain.length;
    if (!n) return;
    const axes = axisPolyline(this.refPts, this._offset(this.refPts, closed), closed).slice(0, n);
    const joints = chainJoints(axes, closed && axes.length === n, t);
    this.chain.forEach(({ el }, i) => {
      const w = el.userData.bim.wall, s = axes[i];
      if (!s) return;
      w.start = s.a; w.end = s.b;
      Object.assign(w, joints[i]);
      rebuildElement(el);
      this.viewer._prepare2D(el);
    });
    this.viewer.changed();
  }

  closeChain() {
    if (this.chain.length < 2) { toast('São necessários pelo menos 2 trechos para fechar.', 'error'); return; }
    this.place(this.first);
  }

  undoLast() {
    const item = this.chain.pop();
    if (!item) { this.last = null; this.first = null; this.refPts = []; this._clearPreview(); return; }
    this.viewer.remove(item.el);
    this.refPts.pop();
    this.last = this.refPts.at(-1) || null;
    if (!this.chain.length) this.first = this.last;
    this._updateChain(false);
    this.app.refreshTree();
  }

  finishChain() {
    if (!this.last && !this.chain.length) return;
    this._endChain();
    if (this.active) this.app.status('Sequência terminada. Clique um novo ponto inicial ou Esc para sair.');
  }

  _endChain() {
    // junções em T: as pontas da sequência que caem no meio de outra parede param na face dela
    const els = this.chain.map(c => c.el).filter(e => e.parent);
    if (els.length) { fixTees(this.app, els); this.viewer.changed(); }
    this._reset();
    this._clearPreview();
    this.app.refreshTree();
  }

  _nextNumber() {
    return this.viewer.elements().filter(e => e.userData.bim.type === 'IfcWall').length + 1;
  }

  // ---------------------------------------------------------------- prévia

  /** Prévia da parede (eixo a→b) e da linha de referência tracejada. */
  _preview(a, b, { ext0 = false, ext1 = false, ref = [a, b] } = {}) {
    const top = this.height ?? this.app.levels.heightOf(this.level);
    const t = this.thickness;
    const { geo } = wallGeometry({ start: a, end: b, height: top, thickness: t, base: this.level.elevation, extendStart: ext0 ? t / 2 : 0, extendEnd: ext1 ? t / 2 : 0 });
    const mesh = new THREE.Mesh(geo, PREVIEW_MAT);
    mesh.renderOrder = 5;
    const z = this.level.elevation + 0.005;
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(ref[0][0], ref[0][1], z), new THREE.Vector3(ref[1][0], ref[1][1], z)]), RUBBER_MAT);
    line.computeLineDistances();
    line.layers.set(1);
    line.renderOrder = 6;
    this.group.add(mesh, line);
  }

  _clearPreview() {
    if (!this.group) return;
    for (const c of [...this.group.children]) { this.group.remove(c); c.geometry?.dispose(); }
  }
}
