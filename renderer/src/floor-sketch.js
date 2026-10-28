// EDITAR CONTORNO DO PISO COM LINHAS 2D (como o "Editar contorno" do piso no Revit) — clique duplo no piso:
//   o contorno e os furos viram linhas 2D na cota do topo, o piso some enquanto isso e as ferramentas 2D da faixa
//   (Linha, Aparar, Estender, Canto, Offset, Mover, Copiar…) trabalham nessas linhas. ✔ Concluir refaz o piso com os
//   contornos fechados (o maior é o piso, os de dentro viram furos); ✖ Cancelar volta como estava.
// As linhas do esboço (e as que surgirem durante a edição) ficam só nesta tela: não vão para o servidor.
import * as THREE from 'three';
import { h, toast } from './ui.js';
import { createSketch, isSketch, worldPoints, chainSegments, outerWithHoles, area } from './sketch/sketch.js';
import { slabShapeFn } from './elements.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { toolCursor } from './cursors.js';

// NEON (rosa, fino) das linhas do esboço: núcleo claro e brilho, por cima de tudo (na cena de sobreposição)
const NEON_CORE = new LineMaterial({ color: 0xffd6f6, linewidth: 1.3, depthTest: false, transparent: true });
const NEON_GLOW = new LineMaterial({ color: 0xff2bd6, linewidth: 4, depthTest: false, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending });
const NEON_HALO = new LineMaterial({ color: 0xff4fe0, linewidth: 8, depthTest: false, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending });
// selecionadas: ciano (a cor muda ao selecionar, para ver o que vai ser editado)
const SEL_CORE = new LineMaterial({ color: 0xd9fbff, linewidth: 1.8, depthTest: false, transparent: true });
const SEL_GLOW = new LineMaterial({ color: 0x00e5ff, linewidth: 6, depthTest: false, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending });
const SEL_HALO = new LineMaterial({ color: 0x00b3ff, linewidth: 12, depthTest: false, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending });

const r6 = v => +v.toFixed(6);
const keyOf = p => `${p[0].toFixed(4)},${p[1].toFixed(4)}`;

export class FloorSketch {
  constructor(app) {
    this.app = app;
    this.active = null; // { el, guid, before: Set(uuid dos elementos de antes), z }
    // Enter conclui e Esc cancela (sem ferramenta ativa e fora de campos de texto)
    document.addEventListener('keydown', e => {
      if (!this.active || this.viewer.tool || e.target.matches?.('input, textarea, select')) return;
      if (e.key === 'Enter') { e.preventDefault(); this.finish(true); }
      else if (e.key === 'Escape' && !this.viewer.selected.size) { e.preventDefault(); this.finish(false); }
    });
  }

  get viewer() { return this.app.viewer; }

  /** Linha que é do esboço (não vai para o servidor): as criadas aqui e as novas surgidas durante a edição. */
  isTemp(el) {
    return !!this.active && isSketch(el) && !this.active.before.has(el.uuid);
  }

  start(el) {
    if (this.active) this.finish(false);
    for (const t of [this.app.wallTool, this.app.sketchTool, this.app.placeTool, this.app.slabTool]) if (t?.active) t.stop();
    el.updateMatrixWorld(true);
    const s = el.userData.bim.slab, M = el.matrixWorld;
    const z = new THREE.Vector3(0, 0, s.elevation).applyMatrix4(M).z;
    const level = this.app.levels.ofElement(el);
    const before = new Set(this.viewer.elements().map(e => e.uuid));
    this.active = { el, guid: el.userData.bim.guid, before, z, slab: structuredClone(s) };
    // contorno e furos → linhas 2D no plano horizontal da cota do topo
    const toW = ([x, y]) => { const v = new THREE.Vector3(x, y, s.elevation).applyMatrix4(M); return [r6(v.x), r6(v.y)]; };
    const lines = [];
    for (const ring of [s.points, ...(s.holes || [])]) {
      ring.forEach((p, i) => {
        const a = toW(p), b = toW(ring[(i + 1) % ring.length]);
        const line = createSketch({ z, a, b, arco: null }, level);
        line.userData.bim.name = line.name = 'Contorno do piso';
        this.viewer.add(line);
        lines.push(line);
      });
    }
    el.visible = false;
    this.viewer.select(lines);
    this.buildPanel();
    this.app.status('Editar contorno do piso · use as ferramentas 2D (Linha, Aparar, Estender, Canto, Offset…) nas linhas · ✔ Concluir ou ✖ Cancelar.');
    this.viewer.changed();
  }

  buildPanel() {
    this.panel?.remove();
    this.info = h('div', { class: 'small muted' });
    this.panel = h('div', { class: 'tool-panel' },
      h('div', { class: 'tool-panel-head' }, h('strong', {}, '▱ Editar contorno do piso'), h('span', { class: 'spacer' })),
      h('div', { class: 'small muted' }, 'O contorno virou linhas 2D: edite com as ferramentas 2D da faixa. Contornos fechados: o maior é o piso, os de dentro são furos.'),
      this.info,
      h('div', { class: 'row-buttons' },
        h('button', { onclick: () => this.pickLines(), title: 'Clique em linhas 2D do desenho: entram cópias delas (e das ligadas a elas) no contorno' }, '⧉ Copiar linhas'),
        h('button', { onclick: () => this.pickSolidEdges(), title: 'Clique nas arestas (cantos) dos sólidos: entram como linhas do contorno, projetadas na planta' }, '⧉ Copiar arestas de sólidos'),
        h('button', { onclick: () => this.pickFloorOutline(), title: 'Clique na face de outro piso: o contorno dele (e os furos) entram como linhas do contorno' }, '⧉ Copiar contorno de piso')),
      h('div', { class: 'row-buttons' },
        h('button', { class: 'primary', onclick: () => this.finish(true), title: 'Refaz o piso com as linhas (Enter)' }, '✔ Concluir'),
        h('button', { onclick: () => this.finish(false), title: 'Volta o piso como estava (Esc)' }, '✖ Cancelar')));
    this.app.showTab?.('props');
    (document.querySelector('.tab-body[data-body="props"]') || document.querySelector('.center')).prepend(this.panel);
    this.refreshInfo();
    this.neon();
    this._chg = () => { this.refreshInfo(); this.neon(); };
    this._sel = () => this.neon(); // a cor das selecionadas muda
    this.viewer.addEventListener('select', this._sel);
    this.viewer.addEventListener('change', this._chg);
  }

  /** Desenha as linhas do esboço em neon (por cima da vista) — refeito a cada mudança. */
  neon() {
    const v = this.viewer;
    if (!this.neonGroup) { this.neonGroup = new THREE.Group(); this.neonGroup.renderOrder = 999; }
    for (const c of [...this.neonGroup.children]) { this.neonGroup.remove(c); c.geometry.dispose(); }
    if (!this.active) { this.neonGroup.parent?.remove(this.neonGroup); return; }
    if (!this.neonGroup.parent) v.overlay.add(this.neonGroup);
    const arr = [], sel = [];
    for (const e of v.elements().filter(x => this.isTemp(x) && x.visible)) {
      const pts = worldPoints(e.userData.bim.linha), out = v.selected.has(e) ? sel : arr;
      for (let i = 1; i < pts.length; i++) out.push(pts[i - 1].x, pts[i - 1].y, pts[i - 1].z + 0.01, pts[i].x, pts[i].y, pts[i].z + 0.01);
    }
    const size = v.renderer.getSize(new THREE.Vector2());
    const draw = (pos, mats) => {
      if (!pos.length) return;
      for (const mat of mats) {
        mat.resolution.set(size.x, size.y);
        const l = new LineSegments2(new LineSegmentsGeometry().setPositions(pos), mat);
        l.renderOrder = 999;
        this.neonGroup.add(l);
      }
    };
    draw(arr, [NEON_HALO, NEON_GLOW, NEON_CORE]);
    draw(sel, [SEL_HALO, SEL_GLOW, SEL_CORE]);
  }

  /** Copiar contorno de piso: cada clique na face de outro piso põe o contorno e os furos dele no esboço. Esc termina. */
  pickFloorOutline() {
    if (!this.active) return;
    const v = this.viewer, cv = v.renderer.domElement;
    for (const t of [this.app.sketchTool, this.app.wallTool, this.app.placeTool]) if (t?.active) t.stop();
    this.picking?.();
    const level = this.app.levels.ofElement(this.active.el);
    const stop = () => { cv.removeEventListener('pointerdown', down, true); document.removeEventListener('keydown', key, true); cv.style.cursor = ''; this.picking = null; };
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); stop(); this.app.status('Copiar contorno terminado.'); } };
    const owner = o => { while (o && !o.userData?.bim) o = o.parent; return o; };
    const down = e => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      const r = cv.getBoundingClientRect(), ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1), v.camera);
      const hit = ray.intersectObject(v.model, true).map(x => owner(x.object)).find(o => o?.visible && o.userData.bim.slab && o !== this.active.el);
      if (!hit) { this.app.status('Copiar contorno · clique na face de um piso · Esc termina.'); return; }
      hit.updateMatrixWorld(true);
      const s = hit.userData.bim.slab;
      const W = ([x, y]) => { const p = new THREE.Vector3(x, y, s.elevation).applyMatrix4(hit.matrixWorld); return [r6(p.x), r6(p.y)]; };
      let n = 0;
      for (const ring of [s.points, ...(s.holes || [])]) {
        ring.forEach((p, i) => {
          const line = createSketch({ z: this.active.z, a: W(p), b: W(ring[(i + 1) % ring.length]), arco: null }, level);
          line.userData.bim.name = line.name = 'Contorno do piso';
          v.add(line);
          n++;
        });
      }
      v.changed();
      this.app.status(`Contorno de "${hit.userData.bim.name || 'Piso'}" copiado (${n} linha(s)) · clique em outro · Esc termina.`);
    };
    cv.addEventListener('pointerdown', down, true);
    document.addEventListener('keydown', key, true);
    cv.style.cursor = toolCursor('copiar-contorno');
    this.picking = stop;
    this.app.status('Copiar contorno · clique na face de outro piso (entram o contorno e os furos) · Esc termina.');
  }

  /** Copiar arestas dos sólidos: a ferramenta "Linhas do sólido", projetando na planta (as linhas novas entram no contorno). */
  pickSolidEdges() {
    const st = this.app.sketchTool;
    st.edgeProject = true;
    st.edgeMode = 'aresta';
    st.start('arestas');
    this.app.status('Copiar arestas · clique nas arestas dos sólidos (ou numa face: Contorno da face) · Esc termina · depois ✔ Concluir o piso.');
  }

  /**
   * Copiar linhas 2D: cada clique numa linha do desenho (que não é do esboço) põe no contorno uma cópia dela e das
   * ligadas a ela pelas pontas. Esc termina.
   */
  pickLines() {
    if (!this.active) return;
    this.picking?.();
    const v = this.viewer, cv = v.renderer.domElement;
    for (const t of [this.app.sketchTool, this.app.wallTool, this.app.placeTool]) if (t?.active) t.stop();
    const level = this.app.levels.ofElement(this.active.el);
    const stop = () => { cv.removeEventListener('pointerdown', down, true); document.removeEventListener('keydown', key, true); cv.style.cursor = ''; this.picking = null; };
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); stop(); this.app.status('Copiar linhas terminado.'); } };
    const screen = p => { const q = p.clone().project(v.camera), r = cv.getBoundingClientRect(); return [(q.x + 1) / 2 * r.width + r.left, (1 - q.y) / 2 * r.height + r.top]; };
    const distSeg = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)); return Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1]); };
    const down = e => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      // linha do desenho mais perto do clique (até 10 px), fora do esboço
      const lines = v.elements().filter(x => isSketch(x) && x.visible && !this.isTemp(x));
      let best = null, bd = 10;
      for (const x of lines) {
        const pts = worldPoints(x.userData.bim.linha).map(screen);
        for (let i = 1; i < pts.length; i++) { const d = distSeg([e.clientX, e.clientY], pts[i - 1], pts[i]); if (d < bd) { bd = d; best = x; } }
      }
      if (!best) { this.app.status('Copiar linhas · clique sobre uma linha 2D do desenho · Esc termina.'); return; }
      // a linha e as ligadas a ela pelas pontas (no mesmo plano horizontal)
      const key2 = p => `${p.x.toFixed(4)},${p.y.toFixed(4)},${p.z.toFixed(3)}`;
      const ends = x => { const w = worldPoints(x.userData.bim.linha); return [w[0], w[w.length - 1]]; };
      const chain = new Set([best]), queue = [best];
      while (queue.length) {
        const cur = queue.pop(), ks = new Set(ends(cur).map(key2));
        for (const x of lines) if (!chain.has(x) && ends(x).some(p => ks.has(key2(p)))) { chain.add(x); queue.push(x); }
      }
      let n = 0;
      for (const x of chain) {
        const w = worldPoints(x.userData.bim.linha);
        if (w.some(p => Math.abs(p.z - w[0].z) > 0.01)) continue; // só as horizontais
        for (let i = 1; i < w.length; i++) {
          const line = createSketch({ z: this.active.z, a: [r6(w[i - 1].x), r6(w[i - 1].y)], b: [r6(w[i].x), r6(w[i].y)], arco: null }, level);
          line.userData.bim.name = line.name = 'Contorno do piso';
          v.add(line);
          n++;
        }
      }
      v.changed();
      this.app.status(`${n} linha(s) copiada(s) para o contorno · clique em outras · Esc termina.`);
    };
    cv.addEventListener('pointerdown', down, true);
    document.addEventListener('keydown', key, true);
    cv.style.cursor = toolCursor('copiar-linhas');
    this.picking = stop;
    this.app.status('Copiar linhas · clique numa linha 2D do desenho (entram ela e as ligadas) · Esc termina.');
  }

  /** Linhas do esboço (no modelo) e os contornos que elas fecham. */
  loops() {
    const els = this.viewer.elements().filter(e => this.isTemp(e));
    const z = this.active.z;
    const segs = [];
    for (const e of els) {
      const pts = worldPoints(e.userData.bim.linha);
      if (pts.some(p => Math.abs(p.z - pts[0].z) > 0.01)) continue; // só as horizontais (contam pela planta)
      for (let i = 1; i < pts.length; i++) segs.push({ a: [r6(pts[i - 1].x), r6(pts[i - 1].y)], b: [r6(pts[i].x), r6(pts[i].y)], arco: null, z });
    }
    return { els, ...chainSegments(segs) };
  }

  refreshInfo() {
    if (!this.active || !this.info) return;
    const { els, loops, chains } = this.loops();
    this.info.textContent = `${els.length} linha(s) · ${loops.length} contorno(s) fechado(s)${chains.length ? ` · ${chains.length} aberto(s) — feche para concluir` : ''}`;
  }

  /** Concluir (ok = true) refaz o piso com as linhas; cancelar volta como estava. Tira as linhas do esboço. */
  finish(ok) {
    const st = this.active;
    if (!st) return;
    let el = st.el;
    if (!el.parent) el = this.viewer.elements().find(x => x.userData.bim?.guid === st.guid) || el; // refeito pela sincronização
    if (ok) {
      const { loops, chains } = this.loops();
      const shapes = outerWithHoles(loops).filter(o => Math.abs(area(o.perfil)) > 1e-6);
      if (!shapes.length) { toast(chains.length ? 'As linhas não fecham um contorno: feche o contorno (Estender, Canto…) para concluir.' : 'Não há contorno fechado.', 'error'); return; }
      if (shapes.length > 1) toast(`${shapes.length} contornos separados: o piso fica com o maior.`, 'info');
      const main = shapes.sort((a, b) => Math.abs(area(b.perfil)) - Math.abs(area(a.perfil)))[0];
      el.updateMatrixWorld(true);
      const inv = el.matrixWorld.clone().invert(), s = el.userData.bim.slab;
      const toL = ([x, y]) => { const v = new THREE.Vector3(x, y, st.z).applyMatrix4(inv); return [r6(v.x), r6(v.y)]; };
      // alturas: pontos que já existiam mantêm a sua; os novos seguem a superfície que o piso tinha
      const oldAlt = new Map(st.slab.points.map((p, i) => [keyOf(p), st.slab.alturas?.[i] || 0]));
      const f = slabShapeFn(st.slab);
      s.points = main.perfil.map(toL);
      if (st.slab.alturas?.some(v => v)) s.alturas = s.points.map(p => (oldAlt.has(keyOf(p)) ? oldAlt.get(keyOf(p)) : r6(f ? f(p[0], p[1]) : 0)));
      else delete s.alturas;
      if (main.furos.length) s.holes = main.furos.map(hl => hl.map(toL)); else delete s.holes;
    }
    this.picking?.();
    if (this.app.sketchTool.active) this.app.sketchTool.stop();
    // tira as linhas do esboço (nunca foram para o servidor)
    for (const e of this.viewer.elements().filter(x => this.isTemp(x))) this.viewer.remove(e);
    this.viewer.removeEventListener('change', this._chg);
    this.viewer.removeEventListener('select', this._sel);
    this.panel?.remove(); this.panel = null;
    this.active = null;
    this.neon(); // tira o neon
    el.visible = true;
    this.viewer.select([el]);
    if (ok) this.app.floorPoints.commit(el);
    else this.viewer.changed();
    this.app.status(ok ? 'Contorno do piso atualizado.' : 'Edição do contorno cancelada.');
  }
}
