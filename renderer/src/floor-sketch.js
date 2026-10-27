// EDITAR CONTORNO DO PISO COM LINHAS 2D (como o "Editar contorno" do piso no Revit) — clique duplo no piso:
//   o contorno e os furos viram linhas 2D na cota do topo, o piso some enquanto isso e as ferramentas 2D da faixa
//   (Linha, Aparar, Estender, Canto, Offset, Mover, Copiar…) trabalham nessas linhas. ✔ Concluir refaz o piso com os
//   contornos fechados (o maior é o piso, os de dentro viram furos); ✖ Cancelar volta como estava.
// As linhas do esboço (e as que surgirem durante a edição) ficam só nesta tela: não vão para o servidor.
import * as THREE from 'three';
import { h, toast } from './ui.js';
import { createSketch, isSketch, worldPoints, chainSegments, outerWithHoles, area } from './sketch/sketch.js';
import { slabShapeFn } from './elements.js';

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
        h('button', { class: 'primary', onclick: () => this.finish(true), title: 'Refaz o piso com as linhas (Enter)' }, '✔ Concluir'),
        h('button', { onclick: () => this.finish(false), title: 'Volta o piso como estava (Esc)' }, '✖ Cancelar')));
    this.app.showTab?.('props');
    (document.querySelector('.tab-body[data-body="props"]') || document.querySelector('.center')).prepend(this.panel);
    this.refreshInfo();
    this._chg = () => this.refreshInfo();
    this.viewer.addEventListener('change', this._chg);
  }

  /** Linhas do esboço (no modelo) e os contornos que elas fecham. */
  loops() {
    const els = this.viewer.elements().filter(e => this.isTemp(e));
    const z = this.active.z;
    const segs = [];
    for (const e of els) {
      const pts = worldPoints(e.userData.bim.linha);
      if (pts.some(p => Math.abs(p.z - z) > 0.01)) continue; // só as da cota do piso
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
    // tira as linhas do esboço (nunca foram para o servidor)
    for (const e of this.viewer.elements().filter(x => this.isTemp(x))) this.viewer.remove(e);
    this.viewer.removeEventListener('change', this._chg);
    this.panel?.remove(); this.panel = null;
    this.active = null;
    el.visible = true;
    this.viewer.select([el]);
    if (ok) this.app.floorPoints.commit(el);
    else this.viewer.changed();
    this.app.status(ok ? 'Contorno do piso atualizado.' : 'Edição do contorno cancelada.');
  }
}
