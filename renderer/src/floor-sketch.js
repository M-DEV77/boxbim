// EDITAR CONTORNO DO PISO COM LINHAS 2D (como o "Editar contorno" do piso no Revit) — clique duplo no piso:
//   o contorno e os furos viram linhas 2D na cota do topo, o piso some enquanto isso e as ferramentas 2D da faixa
//   (Linha, Aparar, Estender, Canto, Offset, Mover, Copiar…) trabalham nessas linhas. ✔ Concluir refaz o piso com os
//   contornos fechados (o maior é o piso, os de dentro viram furos); ✖ Cancelar volta como estava.
// As linhas do esboço (e as que surgirem durante a edição) ficam só nesta tela: não vão para o servidor.
import * as THREE from 'three';
import { h, toast } from './ui.js';
import { createSketch, isSketch, worldPoints, chainSegments, outerWithHoles, area, polylineArcs } from './sketch/sketch.js';
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
// abertas (contorno sem fechar): vermelho
const OPEN_CORE = new LineMaterial({ color: 0xffd0d0, linewidth: 1.5, depthTest: false, transparent: true });
const OPEN_GLOW = new LineMaterial({ color: 0xff2a2a, linewidth: 5, depthTest: false, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending });
const OPEN_HALO = new LineMaterial({ color: 0xff3b3b, linewidth: 11, depthTest: false, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending });
const SEL_HALO = new LineMaterial({ color: 0x00b3ff, linewidth: 12, depthTest: false, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending });

const r6 = v => +v.toFixed(6);
const keyOf = p => `${p[0].toFixed(4)},${p[1].toFixed(4)}`;

/** Trechos de um contorno fechado com os cantos arredondados de volta a arcos (ver polylineArcs em sketch.js). */
export const ringToSegments = pts => polylineArcs(pts, true);

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
    // (os cantos arredondados — guardados como vários pontos — voltam a ser UMA linha curva)
    const toWArc = arco => {
      const c = toW(arco.c), rot = Math.atan2(M.elements[1], M.elements[0]); // piso girado: os ângulos giram junto
      return { c, r: arco.r, a0: arco.a0 + rot, a1: arco.a1 + rot };
    };
    for (const ring of [s.points, ...(s.holes || [])]) {
      for (const sg of ringToSegments(ring)) {
        const line = createSketch({ z, a: toW(sg.a), b: toW(sg.b), arco: sg.arco ? toWArc(sg.arco) : null }, level);
        line.userData.bim.name = line.name = 'Contorno do piso';
        this.viewer.add(line);
        lines.push(line);
      }
    }
    el.visible = false;
    // durante a edição só as linhas do contorno são selecionáveis (os outros elementos ficam bloqueados)
    this.viewer.selectFilter = x => this.isTemp(x);
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
        h('button', { onclick: () => this.pickFloorOutline(), title: 'Clique na face de outro piso: o contorno dele (e os furos) entram como linhas do contorno' }, '⧉ Copiar contorno de piso'),
        this.closeBtn = h('button', { onclick: () => this.closeGaps(), title: 'Liga cada ponta solta (X vermelho) à mais perto com uma linha nova', hidden: true }, '⟷ Fechar pontas')),
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
    const arr = [], sel = [], open = [];
    // contorno sem fechar (mesma conta do Concluir, com as pontas soldadas): as linhas do pedaço que não fecha ficam
    // em VERMELHO; X nas pontas soltas e círculo nos cruzamentos de 3+ linhas — é o que falta acertar
    const g = this.graph(), els = g.els, zz = this.active.z + 0.01;
    const W = new Map(els.map(e => [e, worldPoints(e.userData.bim.linha)]));
    for (const e of els) {
      const pts = W.get(e), out = v.selected.has(e) ? sel : g.openEls.has(e) ? open : arr;
      for (let i = 1; i < pts.length; i++) out.push(pts[i - 1].x, pts[i - 1].y, pts[i - 1].z + 0.01, pts[i].x, pts[i].y, pts[i].z + 0.01);
    }
    if (g.loose.length || g.branch.length) {
      const all = [...W.values()].flat(), xs = all.map(p => p.x), ys = all.map(p => p.y);
      const s = Math.max(0.12, Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 0.012);
      for (const [x, y] of g.loose) open.push(x - s, y - s, zz, x + s, y + s, zz, x - s, y + s, zz, x + s, y - s, zz);
      for (const [x, y] of g.branch) for (let k = 0; k < 12; k++) {
        const a0 = k / 12 * Math.PI * 2, a1 = (k + 1) / 12 * Math.PI * 2;
        open.push(x + s * Math.cos(a0), y + s * Math.sin(a0), zz, x + s * Math.cos(a1), y + s * Math.sin(a1), zz);
      }
    }
    this.openEnds = g.loose.length;
    this.branches = g.branch.length;
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
    draw(open, [OPEN_HALO, OPEN_GLOW, OPEN_CORE]);
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
      if (e.button === 2) { stop(); this.app.status('Copiar contorno terminado.'); return; }
      if (e.button !== 0) return;
      const r = cv.getBoundingClientRect(), ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1), v.camera);
      const hit = ray.intersectObject(v.model, true).map(x => owner(x.object)).find(o => o?.visible && o.userData.bim.slab && o !== this.active.el);
      // fora de um piso: termina a cópia e o clique segue normal (seleção, ferramentas)
      if (!hit) { stop(); this.app.status('Copiar contorno terminado (o clique não pegou um piso).'); return; }
      e.preventDefault(); e.stopPropagation();
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
      stop(); // um clique por vez: as ferramentas (seleção, aparar, canto…) voltam a funcionar
      this.app.status(`Contorno de "${hit.userData.bim.name || 'Piso'}" copiado (${n} linha(s)). Para copiar outro, clique de novo em "Copiar contorno de piso".`);
    };
    cv.addEventListener('pointerdown', down, true);
    document.addEventListener('keydown', key, true);
    cv.style.cursor = toolCursor('copiar-contorno');
    this.picking = stop;
    this.app.status('Copiar contorno · clique na face de outro piso (entram o contorno e os furos) · um clique · Esc cancela.');
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
      if (e.button === 2) { stop(); this.app.status('Copiar linhas terminado.'); return; }
      if (e.button !== 0) return;
      // linha do desenho mais perto do clique (até 10 px), fora do esboço
      const lines = v.elements().filter(x => isSketch(x) && x.visible && !this.isTemp(x));
      let best = null, bd = 10;
      for (const x of lines) {
        const pts = worldPoints(x.userData.bim.linha).map(screen);
        for (let i = 1; i < pts.length; i++) { const d = distSeg([e.clientX, e.clientY], pts[i - 1], pts[i]); if (d < bd) { bd = d; best = x; } }
      }
      if (!best) { stop(); this.app.status('Copiar linhas terminado (o clique não pegou uma linha).'); return; }
      e.preventDefault(); e.stopPropagation();
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
      stop(); // um clique por vez: as ferramentas voltam a funcionar
      this.app.status(`${n} linha(s) copiada(s) para o contorno. Para copiar outras, clique de novo em "Copiar linhas".`);
    };
    cv.addEventListener('pointerdown', down, true);
    document.addEventListener('keydown', key, true);
    cv.style.cursor = toolCursor('copiar-linhas');
    this.picking = stop;
    this.app.status('Copiar linhas · clique numa linha 2D do desenho (entram ela e as ligadas) · um clique · Esc cancela.');
  }

  /** Linhas do esboço (no modelo) e os contornos que elas fecham. */
  /**
   * Grafo das linhas do esboço, à prova de pontas "quase iguais": pontas a menos de 5 mm viram o MESMO ponto (arcos
   * do Canto, cópias e arredondamentos deixam diferenças de décimos de milímetro), trechos repetidos e de tamanho
   * zero saem. Devolve os contornos fechados/abertos, as pontas soltas (grau 1), os cruzamentos de 3+ linhas e as
   * linhas que estão num pedaço que não fecha.
   */
  graph() {
    const els = this.viewer.elements().filter(e => this.isTemp(e) && e.visible);
    const z = this.active?.z ?? 0, TOL = 0.005;
    const nodes = [], cell = new Map(), ck = (x, y) => `${x},${y}`;
    const nodeOf = p => {
      const cx = Math.round(p[0] / TOL), cy = Math.round(p[1] / TOL);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        for (const i of cell.get(ck(cx + dx, cy + dy)) || []) if (Math.hypot(nodes[i].p[0] - p[0], nodes[i].p[1] - p[1]) <= TOL) return i;
      }
      nodes.push({ p: [r6(p[0]), r6(p[1])], deg: 0, segs: [] });
      const k = ck(cx, cy);
      if (!cell.has(k)) cell.set(k, []);
      cell.get(k).push(nodes.length - 1);
      return nodes.length - 1;
    };
    const segs = [], seen = new Set(), raw = [];
    for (const el of els) {
      const w = worldPoints(el.userData.bim.linha);
      if (w.some(q => Math.abs(q.z - w[0].z) > 0.01)) continue; // só as horizontais (contam pela planta)
      for (let i = 1; i < w.length; i++) raw.push({ ia: nodeOf([w[i - 1].x, w[i - 1].y]), ib: nodeOf([w[i].x, w[i].y]), el });
    }
    // ponta que cai no MEIO de outra linha (T, linhas sobrepostas): a outra é dividida ali — vira um nó de verdade
    const pieces = [];
    for (const r of raw) {
      const A = nodes[r.ia].p, B = nodes[r.ib].p, dx = B[0] - A[0], dy = B[1] - A[1], L2 = dx * dx + dy * dy;
      const cuts = [];
      if (L2 > 1e-12) nodes.forEach((n, i) => {
        if (i === r.ia || i === r.ib) return;
        const t = ((n.p[0] - A[0]) * dx + (n.p[1] - A[1]) * dy) / L2;
        if (t <= 1e-6 || t >= 1 - 1e-6) return;
        if (Math.hypot(A[0] + dx * t - n.p[0], A[1] + dy * t - n.p[1]) <= TOL) cuts.push({ t, i });
      });
      cuts.sort((p, q) => p.t - q.t);
      const chain = [r.ia, ...cuts.map(c => c.i), r.ib];
      for (let k = 1; k < chain.length; k++) pieces.push({ ia: chain[k - 1], ib: chain[k], el: r.el });
    }
    for (const r of pieces) {
      {
        const { ia, ib, el } = r;
        if (ia === ib) continue; // trecho de tamanho zero
        const k = ia < ib ? `${ia}|${ib}` : `${ib}|${ia}`;
        if (seen.has(k)) continue; // trecho repetido (linha em cima de linha)
        seen.add(k);
        const s = { ia, ib, el };
        segs.push(s);
        nodes[ia].deg++; nodes[ib].deg++;
        nodes[ia].segs.push(s); nodes[ib].segs.push(s);
      }
    }
    const loose = nodes.filter(n => n.deg === 1), branch = nodes.filter(n => n.deg > 2);
    // linhas num pedaço com ponta solta ou cruzamento: não fecha (vermelho)
    const openEls = new Set(), visited = new Set();
    for (const start of [...loose, ...branch]) {
      const q = [start];
      while (q.length) {
        const n = q.pop();
        if (visited.has(n)) continue;
        visited.add(n);
        for (const s of n.segs) { openEls.add(s.el); q.push(nodes[s.ia], nodes[s.ib]); }
      }
    }
    const { loops, chains } = chainSegments(segs.map(s => ({ a: nodes[s.ia].p, b: nodes[s.ib].p, arco: null, z })));
    return { els, loops, chains, loose: loose.map(n => n.p), branch: branch.map(n => n.p), openEls };
  }

  /** Linhas do esboço e os contornos que elas fecham (com as pontas soldadas). */
  loops() {
    const g = this.graph();
    return { els: g.els, loops: g.loops, chains: g.chains };
  }

  /** Fechar pontas: liga cada ponta solta à ponta solta mais perto (uma linha nova), até não sobrar par. */
  closeGaps() {
    if (!this.active) return;
    const g = this.graph();
    const ends = g.loose.map(p => [...p]);
    if (ends.length < 2) { this.app.status(ends.length ? 'Só uma ponta solta: desenhe a linha que falta até ela.' : 'Não há pontas soltas: o contorno já fecha (veja se há linhas cruzando).'); return; }
    const level = this.app.levels.ofElement(this.active.el);
    let n = 0;
    while (ends.length >= 2) {
      let bi = 0, bj = 1, bd = Infinity;
      for (let i = 0; i < ends.length; i++) for (let j = i + 1; j < ends.length; j++) {
        const d = Math.hypot(ends[i][0] - ends[j][0], ends[i][1] - ends[j][1]);
        if (d < bd) { bd = d; bi = i; bj = j; }
      }
      const line = createSketch({ z: this.active.z, a: ends[bi].map(r6), b: ends[bj].map(r6), arco: null }, level);
      line.userData.bim.name = line.name = 'Contorno do piso';
      this.viewer.add(line);
      n++;
      ends.splice(bj, 1); ends.splice(bi, 1);
    }
    this.viewer.changed();
    this.app.status(`${n} linha(s) criada(s) ligando as pontas soltas mais próximas.`);
  }

  refreshInfo() {
    if (!this.active || !this.info) return;
    const { els, loops, chains } = this.loops();
    const g = this.graph();
    const prob = [g.loose.length ? `${g.loose.length} ponta(s) solta(s) (X)` : '', g.branch.length ? `${g.branch.length} cruzamento(s) de 3+ linhas (○) — apare` : ''].filter(Boolean).join(' · ');
    this.info.textContent = `${els.length} linha(s) · ${loops.length} contorno(s) fechado(s)${chains.length || prob ? ` · ${chains.length} aberto(s)${prob ? ` — ${prob}` : ''} — acerte o que está em vermelho para concluir` : ''}`;
    this.info.classList.toggle('floor-open', chains.length > 0 || !!prob);
    if (this.closeBtn) this.closeBtn.hidden = g.loose.length < 2;
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
      if (!shapes.length) { toast(chains.length ? 'As linhas não fecham um contorno: veja o que está em vermelho (X = ponta solta, ○ = cruzamento) e use Fechar pontas, Aparar ou Estender.' : 'Não há contorno fechado.', 'error'); return; }
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
    this.viewer.selectFilter = null; // libera a seleção
    this.active = null;
    this.neon(); // tira o neon
    el.visible = true;
    this.viewer.select([el]);
    if (ok) this.app.floorPoints.commit(el);
    else this.viewer.changed();
    this.app.status(ok ? 'Contorno do piso atualizado.' : 'Edição do contorno cancelada.');
  }
}
