// DESENHO 2D E EIXOS DE TRABALHO NO EDITOR DE OBJETOS.
// O código continua sendo a fonte do objeto: cada ferramenta escreve (ou reescreve) chamadas no script —
//   Linha / Retângulo ....... g.line([[u, v], [u, v]], { plane })   (uma chamada por segmento)
//   Círculo ................. g.circle(cu, cv, r, { plane })
//   Aparar / Estender / Canto  reescrevem as linhas tocadas (só as chamadas simples, uma por linha do código)
//   Extrudar / Varrer ....... contorno fechado / caminho selecionado → g.extrude / g.sweep (com "vazio" opcional)
//   Eixo de trabalho ........ g.workplane('Eixo A', { x, y, z, rotX, rotY, rotZ }) no começo do script
// O plano de desenho é XY (planta), XZ (frente), YZ (lado) ou um eixo de trabalho do script.
import * as THREE from 'three';
import { h, toast, formDialog } from '../ui.js';
import { trim, extend, corner, snapPointsOf, distToSeg, chainSegments, outerWithHoles, dist, segPoints, offsetPolyline, pointInPoly, area } from '../sketch/sketch.js';
import { styleControls, DEFAULT_STYLE } from '../sketch/style.js';
import { sweepFromGroups } from '../sketch/sweep.js';
import { fmtLen, fromUnit, toUnit, unitLabel } from '../units.js';
import { toolCursor } from '../cursors.js';

const SNAP_PX = 12;
const GRID = 0.001; // objetos são pequenos: arredonda em 1 mm
const DEG = 180 / Math.PI;
const BASE = {
  xy: { o: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], label: 'XY (planta)' },
  xz: { o: [0, 0, 0], u: [1, 0, 0], v: [0, 0, 1], label: 'XZ (frente)' },
  yz: { o: [0, 0, 0], u: [0, 1, 0], v: [0, 0, 1], label: 'YZ (lado)' },
};
const MODES = {
  linha: { label: 'Linha', tip: 'Clique os pontos · número + Enter = comprimento · C fecha · Enter/Esc termina' },
  retangulo: { label: 'Retângulo', tip: 'Clique dois cantos opostos' },
  circulo: { label: 'Círculo', tip: 'Clique o centro e um ponto (ou digite o raio + Enter)' },
  selecao: { label: 'Seleção', tip: 'Clique nas linhas (Shift soma) · Delete apaga · depois Extrudar ou Varrer' },
  aparar: { label: 'Aparar', tip: 'Clique no trecho a remover' },
  estender: { label: 'Estender', tip: 'Clique perto da ponta a estender' },
  canto: { label: 'Canto', tip: 'Clique a primeira e a segunda linha (no lado que fica)' },
  offset: { label: 'Offset', tip: 'Passe o mouse do lado desejado da linha e clique: cópia paralela (linhas ligadas vão juntas)' },
  eixo: { label: 'Eixo por 2 pontos', tip: 'Clique dois pontos: o eixo de trabalho vertical passa por eles' },
};
const RUBBER = new THREE.LineDashedMaterial({ color: 0x1fbf3b, dashSize: 0.02, gapSize: 0.01, depthTest: false });
const SEL_COLOR = 0x2f9bff;

const r4 = v => +(+v).toFixed(4);
const pt = p => `[${r4(p[0])}, ${r4(p[1])}]`;
const store = (k, v) => { try { localStorage.setItem(k, v); } catch { /* sem armazenamento */ } };
const load = k => { try { return localStorage.getItem(k); } catch { return null; } };

export class ObjectSketch {
  constructor(editor) {
    this.ed = editor;
    this.mode = null;
    this.plane = load('boxbim.oePlano') || 'xy';
    this.sel = new Set();      // linhas do código selecionadas
    this.pts = [];
    this.typed = '';
    this.ortho = false;
    this.corner = { modo: 'vivo', raio: 0.05, distancia: 0.03, angulo: 45 };
    try { this.style = JSON.parse(load('boxbim.oeEstilo')) || null; } catch { this.style = null; }
    this.buildToolbar();
  }

  get stage() { return this.ed.stage; }
  get active() { return !!this.mode; }
  get workplanes() { return this.ed.lastOk?.workplanes || []; }

  // ------------------------------------------------------------ barra

  buildToolbar() {
    const b = (mode, title) => { const el = h('button', { title: `${MODES[mode].label}: ${MODES[mode].tip}`, onclick: () => (this.mode === mode ? this.stop() : this.start(mode)) }, title || MODES[mode].label); el.dataset.mode = mode; return el; };
    this.planeSel = h('select', { title: 'Plano do desenho 2D', onchange: e => this.setPlane(e.target.value) });
    this.orthoBtn = h('button', { title: 'ORTO: trava 0°/90° (F8; Shift inverte)', onclick: () => this.toggleOrtho() }, 'ORTO');
    this.btns = [b('linha'), b('retangulo', 'Retâng.'), b('circulo'), b('selecao', '↖ 2D'), b('aparar'), b('estender'), b('canto'), b('offset')];
    this.offsetDist = Number(load('boxbim.oeOffset')) || 0.02;
    this.offsetBox = h('span', { class: 'oe-corner', hidden: true }, h('input', { type: 'number', step: 'any', min: 0, value: toUnit(this.offsetDist), title: `Distância do offset (${unitLabel()})`, style: 'width:60px',
      onchange: e => { this.offsetDist = Math.max(0, fromUnit(e.target.value) || 0); store('boxbim.oeOffset', this.offsetDist); } }));
    const cornerBox = this.cornerBox = h('span', { class: 'oe-corner', hidden: true },
      h('select', { onchange: e => { this.corner.modo = e.target.value; } }, [['vivo', 'Vivo'], ['raio', 'Raio'], ['chanfro', 'Chanfro']].map(([v, l]) => h('option', { value: v }, l))),
      h('input', { type: 'number', step: 'any', value: toUnit(this.corner.raio), title: 'Raio / distância', style: 'width:56px', onchange: e => { this.corner.raio = this.corner.distancia = fromUnit(e.target.value) || 0; } }),
      h('input', { type: 'number', step: 5, value: 45, title: 'Ângulo do chanfro (°)', style: 'width:46px', onchange: e => { this.corner.angulo = Number(e.target.value) || 45; } }));
    this.toolbar = h('div', { class: 'oe-tools oe-tools2' },
      h('strong', { class: 'small' }, '2D'), this.planeSel,
      ...this.btns, cornerBox, this.offsetBox,
      h('span', { class: 'sep' }),
      h('button', { title: 'Extrudar o contorno fechado das linhas selecionadas (g.extrude)', onclick: () => this.extrude() }, 'Extrudar'),
      h('button', { title: 'Varrer um perfil ao longo das linhas selecionadas (g.sweep)', onclick: () => this.sweep() }, 'Varrer'),
      h('span', { class: 'sep' }),
      h('button', { title: 'Novo eixo de trabalho (g.workplane): plano de desenho com nome', onclick: () => this.newWorkplane() }, '⌗ Eixo de trabalho'),
      this.orthoBtn,
      h('span', { class: 'style-ctl', title: 'Estilo das linhas novas' }, ...styleControls(this.style || DEFAULT_STYLE, patch => {
        this.style = { ...DEFAULT_STYLE, ...(this.style || {}), ...patch };
        store('boxbim.oeEstilo', JSON.stringify(this.style));
      }, { compact: true })));
    this.tip = h('div', { class: 'oe-tip', hidden: true });
    this.marker = h('div', { class: 'snap-marker', hidden: true });
    this.fillPlanes();
  }

  fillPlanes() {
    const opts = [...Object.entries(BASE).map(([k, p]) => [k, p.label]), ...this.workplanes.map(w => [w.name, `⌗ ${w.name}`])];
    if (!opts.some(([k]) => k === this.plane)) this.plane = 'xy';
    this.planeSel.replaceChildren(...opts.map(([k, l]) => h('option', { value: k, selected: k === this.plane }, l)));
  }

  setPlane(name) {
    this.plane = name;
    store('boxbim.oePlano', name);
    this.pts = [];
    this.clearPreview();
    this.drawPlaneGuides();
    this.lookAtPlane();
  }

  toggleOrtho() { this.ortho = !this.ortho; this.orthoBtn.classList.toggle('on', this.ortho); }

  /** Câmera de frente para o plano ativo. */
  lookAtPlane() {
    const f = this.frame();
    const st = this.stage, b = st.box();
    const size = b.isEmpty() ? 2 : b.getSize(new THREE.Vector3()).length() || 2;
    const n = new THREE.Vector3().setFromMatrixColumn(f.m, 2);
    const c = b.isEmpty() ? new THREE.Vector3(...f.o) : b.getCenter(new THREE.Vector3());
    // centro projetado no plano
    const o = new THREE.Vector3(...f.o);
    c.addScaledVector(n, -c.clone().sub(o).dot(n));
    if (n.dot(st.cam.position.clone().sub(c)) < 0) n.negate();
    if (Math.abs(n.z) > 0.999) n.set(0, -0.001, Math.sign(n.z)).normalize();
    st.controls.target.copy(c);
    st.cam.position.copy(c).addScaledVector(n, size * 1.8);
  }

  // ------------------------------------------------------------ plano e linhas

  frame(name = this.plane) {
    const f = BASE[name] || this.workplanes.find(w => w.name === name) || BASE.xy;
    const u = new THREE.Vector3(...f.u).normalize(), v = new THREE.Vector3(...f.v).normalize();
    const m = new THREE.Matrix4().makeBasis(u, v, u.clone().cross(v)).setPosition(...f.o);
    return { ...f, m, inv: m.clone().invert() };
  }

  toWorld(p, f = this.frame()) { return new THREE.Vector3(p[0], p[1], 0).applyMatrix4(f.m); }

  /**
   * Segmentos 2D do plano ativo, a partir das peças da última execução. editable = chamada simples
   * (g.line de 2 pontos, g.arc, g.circle) sozinha numa linha do código, sem g.at nem deslocamento.
   */
  segments(plane = this.plane) {
    const parts = this.ed.lastOk?.parts || [];
    const lines = this.ed.code.value.split('\n');
    const out = [];
    for (const p of parts) {
      if (p.kind !== 'line' || p.plane !== plane || p.nested) continue;
      const plain = !p.m && !p.x && !p.y && !p.z && !p.rotX && !p.rotY && !p.rotZ;
      const src = lines[(p.line || 0) - 1] || '';
      const simple = plain && /^\s*g\.(line|arc|circle)\(/.test(src) && (src.match(/\bg\./g) || []).length === 1;
      if (p.arco) {
        const a = [p.arco.c[0] + p.arco.r * Math.cos(p.arco.a0), p.arco.c[1] + p.arco.r * Math.sin(p.arco.a0)];
        const b = [p.arco.c[0] + p.arco.r * Math.cos(p.arco.a1), p.arco.c[1] + p.arco.r * Math.sin(p.arco.a1)];
        out.push({ l: { z: 0, a, b, arco: { ...p.arco } }, line: p.line, editable: simple && plain, style: p.style, part: p });
        continue;
      }
      const ptsList = p.closed ? [...p.points, p.points[0]] : p.points;
      const single = ptsList.length === 2;
      for (let i = 1; i < ptsList.length; i++) {
        if (!plain) continue;
        out.push({ l: { z: 0, a: ptsList[i - 1], b: ptsList[i], arco: null }, line: p.line, editable: simple && single, style: p.style, part: p });
      }
    }
    return out;
  }

  // ------------------------------------------------------------ código

  /** Opções da chamada: plano e estilo (só o que difere do padrão). */
  opts(style = this.style) {
    const o = [];
    if (this.plane !== 'xy') o.push(`plane: '${this.plane.replace(/'/g, "\\'")}'`);
    const s = { ...DEFAULT_STYLE, ...(style || {}) };
    if (s.tipo !== DEFAULT_STYLE.tipo) o.push(`tipo: '${s.tipo}'`);
    if (Number(s.espessura) !== DEFAULT_STYLE.espessura) o.push(`espessura: ${s.espessura}`);
    if (s.cor !== DEFAULT_STYLE.cor) o.push(`color: '${s.cor}'`);
    return o.length ? `, { ${o.join(', ')} }` : '';
  }

  /** Chamada de uma linha/arco/círculo. */
  callOf(l, style) {
    const o = this.opts(style);
    if (l.arco) {
      const { c, r, a0, a1 } = l.arco;
      if (a1 - a0 >= Math.PI * 2 - 1e-9) return `g.circle(${r4(c[0])}, ${r4(c[1])}, ${r4(r)}${o});`;
      return `g.arc(${r4(c[0])}, ${r4(c[1])}, ${r4(r)}, ${r4(a0 * DEG)}, ${r4(a1 * DEG)}${o});`;
    }
    return `g.line([${pt(l.a)}, ${pt(l.b)}]${o});`;
  }

  /**
   * Edita o script: replace = { linha: texto | '' (apaga) }, append = linhas novas no fim, prepend = no começo.
   * Executa logo em seguida (as ferramentas precisam das peças novas).
   */
  async writeCode({ replace = {}, append = [], prepend = [] } = {}) {
    const lines = this.ed.code.value.split('\n');
    for (const n of Object.keys(replace).map(Number).sort((a, b) => b - a)) {
      const indent = (lines[n - 1].match(/^\s*/) || [''])[0];
      const t = replace[n];
      if (t === '') lines.splice(n - 1, 1); else lines.splice(n - 1, 1, ...[].concat(t).map(x => indent + x));
    }
    if (append.length) {
      while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
      if (!lines.some(l => l.includes('// desenho 2D'))) lines.push('', '// desenho 2D (ferramentas da prévia)');
      lines.push(...append, '');
    }
    if (prepend.length) lines.unshift(...prepend);
    this.sel.clear();
    this.ed.code.setValue(lines.join('\n'));
    await this.ed.run();
  }

  // ------------------------------------------------------------ ferramenta ativa

  start(mode) {
    if (this.mode) this.stop();
    if (!this.ed.lastOk && mode !== 'linha' && mode !== 'retangulo' && mode !== 'circulo' && mode !== 'eixo') { toast('Execute o script primeiro.', 'error'); return; }
    this.mode = mode;
    this.pts = [];
    this.typed = '';
    this.picked = null;
    const st = this.stage;
    st.selectLine(null);
    st.tc.enabled = false;
    this._buttons = { ...st.controls.mouseButtons };
    st.controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
    this.group = new THREE.Group();
    st.scene.add(this.group);
    const el = st.renderer.domElement;
    this._h = {
      down: e => this.down(e), move: e => this.move(e), up: e => this.up(e),
      ctx: e => e.preventDefault(), leave: () => { this.tip.hidden = true; this.marker.hidden = true; },
    };
    el.addEventListener('pointerdown', this._h.down, true);
    el.addEventListener('pointermove', this._h.move, true);
    el.addEventListener('pointerup', this._h.up, true);
    el.addEventListener('contextmenu', this._h.ctx);
    el.addEventListener('pointerleave', this._h.leave);
    el.style.cursor = mode === 'selecao' ? 'default' : toolCursor(mode);
    st.el.append(this.tip, this.marker);
    this.btns.forEach(x => x.classList.toggle('on', x.dataset.mode === mode));
    this.cornerBox.hidden = mode !== 'canto';
    this.offsetBox.hidden = mode !== 'offset';
    this.ed.status('run', `${MODES[mode].label}: ${MODES[mode].tip} · Esc sai`);
    this.drawPlaneGuides();
  }

  stop() {
    if (!this.mode) return;
    this.finish();
    const st = this.stage, el = st.renderer.domElement;
    el.removeEventListener('pointerdown', this._h.down, true);
    el.removeEventListener('pointermove', this._h.move, true);
    el.removeEventListener('pointerup', this._h.up, true);
    el.removeEventListener('contextmenu', this._h.ctx);
    el.removeEventListener('pointerleave', this._h.leave);
    el.style.cursor = '';
    st.controls.mouseButtons = this._buttons;
    st.tc.enabled = st.mode !== 'select';
    st.scene.remove(this.group);
    this.tip.hidden = true; this.marker.hidden = true;
    this.mode = null;
    this.btns.forEach(x => x.classList.remove('on'));
    this.cornerBox.hidden = true;
    this.offsetBox.hidden = true;
    this.ed.status('ok', 'Pronto.');
  }

  finish() { this.pts = []; this.picked = null; this.typed = ''; this.clearPreview(); }

  /** Teclas (chamado pelo editor antes dos atalhos dele). Devolve true se tratou. */
  onKey(e) {
    if (!this.mode || e.target.matches?.('input, textarea, select')) return false;
    const k = e.key;
    let done = true;
    if (k === 'Escape') { if (this.typed) this.typed = ''; else if (this.pts.length || this.picked) this.finish(); else this.stop(); }
    else if (k === 'F8') this.toggleOrtho();
    else if (['linha', 'circulo'].includes(this.mode) && (/^[0-9]$/.test(k) || ((k === ',' || k === '.') && !this.typed.includes('.')))) this.typed += k === ',' ? '.' : k;
    else if (k === 'Backspace' && this.typed) this.typed = this.typed.slice(0, -1);
    else if (k === 'Enter') { if (this.typed) this.applyTyped(); else this.finish(); }
    else if ((k === 'c' || k === 'C') && this.mode === 'linha' && this.pts.length >= 3) this.place(this.pts[0]);
    else if (k === 'Delete' && this.mode === 'selecao') this.deleteSelected();
    else done = false;
    if (done) { e.preventDefault(); e.stopPropagation(); if (this.lastEvent) this.move(this.lastEvent); }
    return done;
  }

  worldAt(e, f = this.frame()) {
    const r = this.stage.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.stage.cam);
    const n = new THREE.Vector3().setFromMatrixColumn(f.m, 2);
    if (Math.abs(ray.ray.direction.dot(n)) < 0.02) return null; // plano visto de lado
    const hit = ray.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(n, new THREE.Vector3(...f.o)), new THREE.Vector3());
    if (!hit) return null;
    hit.applyMatrix4(f.inv);
    return [hit.x, hit.y];
  }

  toScreen(p, f) {
    const el = this.stage.renderer.domElement;
    const q = this.toWorld(p, f).project(this.stage.cam);
    return [(q.x + 1) / 2 * el.clientWidth, (1 - q.y) / 2 * el.clientHeight];
  }

  resolve(e) {
    const f = this.frame();
    const raw = this.worldAt(e, f);
    if (!raw) return null;
    const rs = this.toScreen(raw, f);
    const cands = [{ p: [0, 0], kind: 'origem' }];
    for (const s of this.segments()) cands.push(...snapPointsOf(s.l));
    if (this.pts.length >= 2) cands.push({ p: this.pts[0], kind: 'início' });
    const last = this.pts[this.pts.length - 1];
    let best = null, bestD = SNAP_PX;
    for (const c of cands) {
      if (last && dist(c.p, last) < 1e-9) continue;
      const s = this.toScreen(c.p, f);
      const d = Math.hypot(s[0] - rs[0], s[1] - rs[1]);
      if (d < bestD) { bestD = d; best = c; }
    }
    if (best) return { p: [...best.p], snap: best.kind };
    let p = raw;
    // ORTO não vale para círculo nem retângulo (os lados do retângulo já são 0°/90°; travar zeraria uma medida)
    if (last && this.ortho !== !!e.shiftKey && !['circulo', 'retangulo'].includes(this.mode)) {
      p = Math.abs(p[0] - last[0]) >= Math.abs(p[1] - last[1]) ? [p[0], last[1]] : [last[0], p[1]];
    }
    return { p: p.map(v => Math.round(v / GRID) * GRID), ortho: this.ortho !== !!e.shiftKey && !['circulo', 'retangulo'].includes(this.mode) };
  }

  pickSeg(e) {
    const f = this.frame(), raw = this.worldAt(e, f);
    if (!raw) return null;
    const a = this.worldAt({ clientX: e.clientX + 1, clientY: e.clientY }, f);
    const px = a ? dist(a, raw) : 0.005;
    let best = null, bestD = 8 * px;
    for (const s of this.segments()) { const d = distToSeg(s.l, raw); if (d < bestD) { bestD = d; best = s; } }
    return best ? { ...best, p: raw } : null;
  }

  clearPreview() { for (const c of [...(this.group?.children || [])]) { this.group.remove(c); c.geometry?.dispose(); } }

  preview(pts2, closed = false) {
    const f = this.frame();
    const v = pts2.map(p => this.toWorld(p, f));
    if (closed && v.length) v.push(v[0].clone());
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(v), RUBBER);
    line.computeLineDistances();
    line.renderOrder = 10;
    this.group.add(line);
  }

  showTip(res, text, e) {
    const r = this.stage.el.getBoundingClientRect();
    this.tip.textContent = text + (this.typed ? `  ⌨ ${this.typed.replace('.', ',')} ${unitLabel()}` : '') + (res?.snap ? `  ◻ ${res.snap}` : res?.ortho ? '  ORTO' : '');
    this.tip.hidden = false;
    Object.assign(this.tip.style, { left: `${e.clientX - r.left + 16}px`, top: `${e.clientY - r.top + 14}px` });
    this.marker.hidden = !res?.snap;
    if (res?.snap) {
      const s = this.toScreen(res.p), cr = this.stage.renderer.domElement.getBoundingClientRect();
      Object.assign(this.marker.style, { left: `${s[0] + cr.left - r.left}px`, top: `${s[1] + cr.top - r.top}px` });
    }
  }

  move(e) {
    this.lastEvent = e;
    if (!this.mode) return;
    this.clearPreview();
    if (this.mode === 'offset') {
      const r = this.offsetAt(e);
      if (r) r.forEach(sg => this.preview(segPoints(sg)));
      this.tip.hidden = true;
      return;
    }
    if (['aparar', 'estender', 'canto', 'selecao'].includes(this.mode)) {
      const hit = this.pickSeg(e);
      if (hit) this.preview(segPoints(hit.l));
      this.tip.hidden = true;
      return;
    }
    const res = this.resolve(e);
    this.cursor = res;
    if (!res) { this.tip.hidden = true; return; }
    const last = this.pts[this.pts.length - 1];
    let text = `u ${fmtLen(res.p[0])}  v ${fmtLen(res.p[1])}`;
    if ((this.mode === 'linha' || this.mode === 'eixo') && last) {
      this.preview([...this.pts, res.p]);
      text = fmtLen(dist(last, res.p), { suffix: true });
    } else if (this.mode === 'retangulo' && last) {
      const [a, b] = [last, res.p];
      this.preview([a, [b[0], a[1]], b, [a[0], b[1]]], true);
      text = `${fmtLen(Math.abs(b[0] - a[0]))} × ${fmtLen(Math.abs(b[1] - a[1]), { suffix: true })}`;
    } else if (this.mode === 'circulo' && last) {
      const r = dist(last, res.p);
      this.preview(Array.from({ length: 65 }, (_, i) => [last[0] + r * Math.cos(i / 32 * Math.PI), last[1] + r * Math.sin(i / 32 * Math.PI)]));
      text = `raio ${fmtLen(r, { suffix: true })}`;
    }
    this.showTip(res, text, e);
  }

  down(e) {
    if (e.button !== 0) return;
    e.stopImmediatePropagation(); // a prévia não seleciona peça nem mexe no gizmo enquanto desenha
    if (this.mode === 'selecao') return this.select(e);
    if (this.mode === 'offset') return this.createOffset(e);
    if (['aparar', 'estender', 'canto'].includes(this.mode)) return this.edit(e);
    const res = this.resolve(e);
    if (res) this.place(res.p);
  }

  up(e) {
    if (e.button === 0) e.stopImmediatePropagation();
    if (e.button === 2 && this.pts.length && this.mode === 'linha') this.finish(); // botão direito termina a polilinha
  }

  applyTyped() {
    const v = fromUnit(this.typed);
    this.typed = '';
    const last = this.pts[this.pts.length - 1];
    if (!last || !(v > 0) || !this.cursor) return;
    if (this.mode === 'circulo') { this.place([last[0] + v, last[1]]); return; }
    const dx = this.cursor.p[0] - last[0], dy = this.cursor.p[1] - last[1], d = Math.hypot(dx, dy);
    if (d < 1e-9) return;
    this.place([last[0] + dx / d * v, last[1] + dy / d * v]);
  }

  async place(p) {
    const last = this.pts[this.pts.length - 1];
    if (this.mode === 'linha') {
      if (last && dist(last, p) < GRID / 2) return;
      this.pts.push(p);
      if (last) {
        const closing = this.pts.length > 2 && dist(p, this.pts[0]) < 1e-9;
        await this.writeCode({ append: [this.callOf({ a: last, b: p })] });
        if (closing) this.finish();
      }
      return;
    }
    if (this.mode === 'retangulo') {
      if (!last) { this.pts.push(p); return; }
      if (Math.abs(p[0] - last[0]) < GRID || Math.abs(p[1] - last[1]) < GRID) return;
      const c = [last, [p[0], last[1]], p, [last[0], p[1]]];
      this.finish();
      await this.writeCode({ append: c.map((q, i) => this.callOf({ a: q, b: c[(i + 1) % 4] })) });
      return;
    }
    if (this.mode === 'circulo') {
      if (!last) { this.pts.push(p); return; }
      const r = dist(last, p);
      if (r < GRID) return;
      this.finish();
      await this.writeCode({ append: [this.callOf({ arco: { c: last, r, a0: 0, a1: Math.PI * 2 } })] });
      return;
    }
    if (this.mode === 'eixo') {
      if (!last) { this.pts.push(p); return; }
      if (dist(last, p) < GRID) return;
      const f = this.frame(), A = this.toWorld(last, f), B = this.toWorld(p, f);
      const ang = Math.atan2(B.y - A.y, B.x - A.x) * DEG;
      this.finish();
      this.stop();
      await this.addWorkplane({ x: A.x, y: A.y, z: A.z, rotX: 90, rotZ: ang });
    }
  }

  // ------------------------------------------------------------ seleção, aparar, estender, canto

  select(e) {
    const hit = this.pickSeg(e);
    if (!e.shiftKey && !e.ctrlKey) this.sel.clear();
    if (hit) { if (this.sel.has(hit.line)) this.sel.delete(hit.line); else this.sel.add(hit.line); }
    this.highlight();
    this.ed.status('ok', `${this.sel.size} linha(s) do desenho selecionada(s)${this.sel.size ? ' · Delete apaga · Extrudar / Varrer' : ''}`);
  }

  /** Pinta de azul as linhas selecionadas (as peças são refeitas a cada execução). */
  highlight() {
    for (const m of this.stage.group.children) {
      const part = m.userData.part;
      if (part?.kind !== 'line') continue;
      const on = this.sel.has(part.line);
      if (!m.userData._c) m.userData._c = { color: m.material.color.getHex(), opacity: m.material.opacity, transparent: m.material.transparent };
      const c = m.userData._c;
      m.material.color.setHex(on ? SEL_COLOR : c.color);
      m.material.opacity = on ? 1 : c.opacity;
      m.material.transparent = on ? false : c.transparent;
      m.material.depthTest = !on;
      m.renderOrder = on ? 9 : 0;
    }
  }

  async deleteSelected() {
    const segs = this.segments().filter(s => this.sel.has(s.line));
    if (!segs.length) return;
    const replace = {};
    for (const s of segs) replace[s.line] = '';
    await this.writeCode({ replace });
    this.ed.status('ok', `${segs.length} linha(s) apagada(s) do código.`);
  }

  async edit(e) {
    const hit = this.pickSeg(e);
    if (!hit) return;
    if (!hit.editable) { toast(`A linha ${hit.line} do código não é uma chamada simples (g.line de 2 pontos, g.arc ou g.circle, sozinha na linha): edite pelo código.`, 'error'); return; }
    const segs = this.segments();
    const others = segs.filter(s => s.line !== hit.line || s.l !== hit.l).map(s => s.l);
    try {
      if (this.mode === 'aparar') {
        const r = trim(hit.l, hit.p, others);
        if (!r) { this.ed.status('err', 'Aparar: nenhuma outra linha cruza esta.'); return; }
        await this.writeCode({ replace: { [hit.line]: r.length ? r.map(x => this.callOf(x, hit.style)) : '' } });
      } else if (this.mode === 'estender') {
        const r = extend(hit.l, hit.p, others);
        if (!r) { this.ed.status('err', 'Estender: nenhuma linha à frente desta ponta (arcos não estendem).'); return; }
        await this.writeCode({ replace: { [hit.line]: this.callOf(r, hit.style) } });
      } else if (this.mode === 'canto') {
        if (!this.picked) { this.picked = hit; this.ed.status('run', 'Canto: agora clique a segunda linha.'); return; }
        if (this.picked.line === hit.line) return;
        const a = this.picked;
        this.picked = null;
        const r = corner(a.l, a.p, hit.l, hit.p, this.corner);
        const replace = { [a.line]: [this.callOf(r.l1, a.style)].concat(r.extra ? [this.callOf(r.extra, a.style)] : []), [hit.line]: this.callOf(r.l2, hit.style) };
        await this.writeCode({ replace });
      }
    } catch (err) { this.picked = null; toast(err.message, 'error'); }
  }

  // ------------------------------------------------------------ offset

  /** Cópia paralela da linha/arco (e da cadeia de linhas ligadas) do lado do cursor: lista de segmentos. */
  offsetAt(e) {
    const hit = this.pickSeg(e);
    const d = this.offsetDist;
    if (!hit || !(d > 0)) return null;
    const p = hit.p, l = hit.l;
    if (l.arco) {
      const r = dist(p, l.arco.c) > l.arco.r ? l.arco.r + d : l.arco.r - d;
      if (r <= 1e-5) return null;
      const ar = { ...l.arco, r };
      const pt2 = t => [ar.c[0] + r * Math.cos(t), ar.c[1] + r * Math.sin(t)];
      return [{ a: pt2(ar.a0), b: pt2(ar.a1), arco: ar, style: hit.style }];
    }
    // cadeia: linhas retas ligadas pelas pontas (só onde a ligação é única)
    const segs = this.segments().filter(x => !x.l.arco);
    const key = q => `${q[0].toFixed(5)},${q[1].toFixed(5)}`;
    const ends = new Map();
    segs.forEach((x, i) => { for (const q of [x.l.a, x.l.b]) { const k = key(q); if (!ends.has(k)) ends.set(k, []); ends.get(k).push(i); } });
    // segments() devolve objetos novos a cada chamada: acha o trecho clicado pela linha do código e pelas pontas
    const start = segs.findIndex(x => x.line === hit.line && key(x.l.a) === key(l.a) && key(x.l.b) === key(l.b));
    if (start < 0) return null;
    const used = new Set([start]);
    const pts = [l.a, l.b];
    for (const side of ['fim', 'inicio']) {
      for (;;) {
        const endP = side === 'fim' ? pts[pts.length - 1] : pts[0];
        const near = ends.get(key(endP)) || [];
        if (near.length !== 2) break;
        const nx = near.find(i => !used.has(i));
        if (nx === undefined) break;
        used.add(nx);
        const o = key(segs[nx].l.a) === key(endP) ? segs[nx].l.b : segs[nx].l.a;
        if (side === 'fim') pts.push(o); else pts.unshift(o);
      }
    }
    let closed = false;
    if (pts.length > 3 && key(pts[0]) === key(pts[pts.length - 1])) { pts.pop(); closed = true; }
    let dl;
    if (closed) dl = (pointInPoly(p, pts) ? 1 : -1) * d * (Math.sign(area(pts)) || 1);
    else {
      let s = 0, best = Infinity;
      for (let i = 0; i < pts.length - 1; i++) { const dd = distToSeg({ a: pts[i], b: pts[i + 1], arco: null }, p); if (dd < best) { best = dd; s = i; } }
      const a = pts[s], b = pts[s + 1];
      dl = ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) >= 0 ? d : -d;
    }
    return offsetPolyline(pts, dl, closed).map(x => ({ a: x.a, b: x.b, arco: null, style: hit.style }));
  }

  async createOffset(e) {
    const r = this.offsetAt(e);
    if (!r) { this.ed.status('err', this.offsetDist > 0 ? 'Offset: passe o mouse sobre uma linha, do lado da cópia, e clique.' : 'Offset: informe a distância.'); return; }
    this.clearPreview();
    await this.writeCode({ append: r.map(sg => this.callOf(sg, sg.style)) });
    this.ed.status('ok', `Offset de ${fmtLen(this.offsetDist, { suffix: true })}: ${r.length} linha(s) no código.`);
  }

  // ------------------------------------------------------------ sólidos

  selectedSegs() {
    const segs = this.segments().filter(s => this.sel.has(s.line));
    if (!segs.length) toast('Selecione as linhas (ferramenta ↖ 2D, Shift soma) e use de novo.', 'error');
    return segs;
  }

  async extrude() {
    const segs = this.selectedSegs();
    if (!segs.length) return;
    const { loops } = chainSegments(segs.map(s => s.l));
    if (!loops.length) { toast('As linhas selecionadas não formam um contorno fechado.', 'error'); return; }
    const v = await formDialog('Extrudar (g.extrude)', [
      { key: 'altura', label: `Altura (${unitLabel()})`, type: 'number', value: toUnit(0.1) },
      { key: 'material', label: 'Material (nome da biblioteca, opcional)', value: '' },
      { key: 'vazio', label: 'Vazio: corta as outras peças do objeto', type: 'checkbox', value: false },
      { key: 'apagar', label: 'Tirar as linhas do código', type: 'checkbox', value: true },
    ], { ok: 'Extrudar' });
    if (!v) return;
    const hgt = fromUnit(v.altura) || 0.1;
    const calls = outerWithHoles(loops).map(({ perfil, furos }) => {
      const o = [];
      if (this.plane !== 'xy') o.push(`plane: '${this.plane}'`);
      if (furos.length) o.push(`holes: [${furos.map(f => `[${f.map(pt).join(', ')}]`).join(', ')}]`);
      if (v.material) o.push(`material: '${String(v.material).replace(/'/g, "\\'")}'`);
      if (v.vazio) o.push('vazio: true');
      o.push(`name: '${v.vazio ? 'Vazio' : 'Extrusão'}'`);
      return `g.extrude([${perfil.map(pt).join(', ')}], ${r4(hgt)}, { ${o.join(', ')} });`;
    });
    const replace = {};
    if (v.apagar) for (const s of segs) if (s.editable) replace[s.line] = '';
    await this.writeCode({ replace, append: calls });
    this.ed.status('ok', `${calls.length} extrusão(ões) no código${v.vazio ? ' (vazio)' : ''}.`);
  }

  /**
   * Varrer: caminho + PERFIL desenhado (contorno 2D fechado), selecionados juntos — o perfil pode estar em outro
   * plano (selecione o caminho, troque o plano e selecione o perfil com Shift). Ver sketch/sweep.js.
   */
  async sweep() {
    const planesUsed = [...new Set((this.ed.lastOk?.parts || []).filter(p => p.kind === 'line' && this.sel.has(p.line)).map(p => p.plane))];
    const groups = planesUsed.map(name => ({ name, m: this.frame(name).m, all: this.segments(name).filter(s => this.sel.has(s.line)) }))
      .filter(g => g.all.length).map(g => ({ ...g, segs: g.all.map(s => s.l) }));
    if (!groups.length) { toast('Selecione as linhas do caminho e o contorno fechado do perfil (↖ 2D, Shift soma; dá para trocar de plano no meio) e use Varrer.', 'error'); return; }
    let sw;
    try { sw = sweepFromGroups(groups); } catch (err) { toast(err.message, 'error'); return; }
    const v = await formDialog('Varrer (g.sweep)', [
      { key: 'material', label: 'Material (nome da biblioteca, opcional)', value: '' },
      { key: 'vazio', label: 'Vazio: corta as outras peças do objeto', type: 'checkbox', value: false },
      { key: 'apagar', label: 'Tirar as linhas do código (caminho e perfil)', type: 'checkbox', value: true },
    ], { ok: 'Varrer' });
    if (!v) return;
    const o = [];
    if (sw.fechado) o.push('closed: true');
    if (v.material) o.push(`material: '${String(v.material).replace(/'/g, "\\'")}'`);
    if (v.vazio) o.push('vazio: true');
    o.push(`name: '${v.vazio ? 'Vazio' : 'Varredura'}'`);
    const call = `g.sweep([${sw.caminho.map(q => `[${r4(q[0])}, ${r4(q[1])}, ${r4(q[2])}]`).join(', ')}], [${sw.perfil.map(pt).join(', ')}], { ${o.join(', ')} });`;
    const replace = {};
    if (v.apagar) for (const g of groups) for (const s of g.all) if (s.editable) replace[s.line] = '';
    await this.writeCode({ replace, append: [call] });
    this.ed.status('ok', `Varredura no código${v.vazio ? ' (vazio)' : ''} — perfil ${sw.posicionado ? 'onde foi desenhado' : 'centrado no caminho'}.`);
  }

  // ------------------------------------------------------------ eixos de trabalho

  nextName() {
    const used = new Set(this.workplanes.map(w => w.name));
    for (let i = 0; i < 26; i++) { const n = `Eixo ${String.fromCharCode(65 + i)}`; if (!used.has(n)) return n; }
    return `Eixo ${used.size + 1}`;
  }

  async newWorkplane() {
    const v = await formDialog('Novo eixo de trabalho (g.workplane)', [
      { key: 'name', label: 'Nome', value: this.nextName() },
      { key: 'tipo', label: 'Tipo', type: 'select', value: 'xz', options: [
        { value: 'xz', label: 'Vertical de frente (paralelo a XZ), numa distância Y' },
        { value: 'yz', label: 'Vertical de lado (paralelo a YZ), numa distância X' },
        { value: 'xy', label: 'Horizontal (paralelo a XY), numa altura Z' },
        { value: 'clicar', label: 'Vertical por dois pontos (clicar no plano atual)' },
        { value: 'livre', label: 'Livre: origem e giros X/Y/Z' }] },
      { key: 'd', label: `Distância / altura (${unitLabel()})`, type: 'number', value: 0 },
      { key: 'x', label: `Livre: origem X (${unitLabel()})`, type: 'number', value: 0 },
      { key: 'y', label: `Livre: origem Y (${unitLabel()})`, type: 'number', value: 0 },
      { key: 'z', label: `Livre: origem Z (${unitLabel()})`, type: 'number', value: 0 },
      { key: 'rotX', label: 'Livre: giro X (°)', type: 'number', value: 90 },
      { key: 'rotY', label: 'Livre: giro Y (°)', type: 'number', value: 0 },
      { key: 'rotZ', label: 'Livre: giro Z (°)', type: 'number', value: 0 },
    ], { ok: 'Criar' });
    if (!v) return;
    this._pendingName = v.name || this.nextName();
    const d = fromUnit(v.d) || 0;
    if (v.tipo === 'clicar') { this.start('eixo'); return; }
    const t = {
      xz: { y: d, rotX: 90 }, yz: { x: d, rotX: 90, rotZ: 90 }, xy: { z: d },
      livre: { x: fromUnit(v.x), y: fromUnit(v.y), z: fromUnit(v.z), rotX: Number(v.rotX) || 0, rotY: Number(v.rotY) || 0, rotZ: Number(v.rotZ) || 0 },
    }[v.tipo];
    await this.addWorkplane(t);
  }

  /** Escreve o g.workplane no começo do script e passa a desenhar nele. */
  async addWorkplane(t) {
    const name = this._pendingName || this.nextName();
    this._pendingName = null;
    const o = Object.entries(t).filter(([, val]) => Math.abs(val) > 1e-9).map(([k, val]) => `${k}: ${r4(val)}`);
    await this.writeCode({ prepend: [`g.workplane('${name.replace(/'/g, "\\'")}'${o.length ? `, { ${o.join(', ')} }` : ''}); // eixo de trabalho`] });
    this.fillPlanes();
    this.setPlane(name);
    this.planeSel.value = name;
    this.ed.status('ok', `Eixo de trabalho "${name}" criado — o desenho 2D agora é nele.`);
  }

  /** Mostra os eixos de trabalho do script e o plano ativo (refeito a cada execução). */
  drawPlaneGuides() {
    const st = this.stage;
    if (!st.helpers) return;
    st.helpers.children.filter(c => c.userData.planeGuide).forEach(c => { st.helpers.remove(c); c.traverse(o => o.geometry?.dispose()); });
    const b = st.box();
    const size = Math.max(0.6, b.isEmpty() ? 1 : b.getSize(new THREE.Vector3()).length() * 0.6);
    const draw = (name, active) => {
      const f = this.frame(name);
      const s = active ? size : Math.max(size * 0.6, 0.3);
      const g = new THREE.Group();
      g.userData.planeGuide = true;
      const P = (u, v) => new THREE.Vector3(u, v, 0).applyMatrix4(f.m);
      const color = active ? 0xff9f1c : 0x3aa0ff;
      const border = new THREE.Line(new THREE.BufferGeometry().setFromPoints([P(-s, -s), P(s, -s), P(s, s), P(-s, s), P(-s, -s)]),
        new THREE.LineDashedMaterial({ color, dashSize: s / 20, gapSize: s / 40, transparent: true, opacity: active ? 0.9 : 0.6 }));
      border.computeLineDistances();
      const fill = new THREE.Mesh(new THREE.PlaneGeometry(2 * s, 2 * s).applyMatrix4(f.m), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: active ? 0.06 : 0.03, depthWrite: false, side: THREE.DoubleSide }));
      fill.raycast = () => {};
      border.raycast = () => {};
      g.add(border, fill);
      st.helpers.add(g);
    };
    for (const w of this.workplanes) if (w.name !== this.plane) draw(w.name, false);
    if (this.mode || !BASE[this.plane]) draw(this.plane, true);
  }

  /** Depois de cada execução do script: planos, guias e destaque. */
  afterRun() {
    this.fillPlanes();
    this.drawPlaneGuides();
    this.highlight();
  }
}
