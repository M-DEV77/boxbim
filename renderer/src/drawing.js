// ESCALA DAS VISTAS E PESO DAS LINHAS (vistas de desenho: plantas, forros, elevações).
//   escala ........ cada vista tem a sua (1:1 … 1:1000; padrão 1:100), no seletor da barra de baixo; gravada no
//                   projeto (dados.escalas). As cotas usam a escala para o tamanho do texto e das marcas.
//   peso .......... em mm de papel, como numa prancha: CORTE (contorno onde o plano de corte atravessa as peças) e
//                   PROJEÇÃO (arestas vistas). Na tela: px = mm × escala/1000 × (px por metro do zoom) — aproximar
//                   engrossa, como no Revit. Configurável em "Pesos de linha…" (dados.pesos).
//   linhas finas .. botão LF: tudo com 1 px (como o TL do Revit); fica neste navegador.
import { h, modal, toast } from './ui.js';
import { EDGE_MAT, CUT_MAT, CUT_INNER_MAT } from './viewer.js';

export const SCALES = [1, 2, 5, 10, 20, 25, 50, 75, 100, 125, 200, 250, 500, 1000];
const DEFAULT_WEIGHTS = { corte: 0.5, projecao: 0.25, anotacao: 0.18 };
const DRAWING_KINDS = new Set(['plan', 'ceiling', 'elevation']);

export class Drawing extends EventTarget {
  constructor(app) {
    super();
    this.app = app;
    this.scales = {};                       // id da vista → denominador (100 = 1:100)
    this.weights = { ...DEFAULT_WEIGHTS };   // mm de papel
    try { this.thin = localStorage.getItem('boxbim.linhasFinas') === '1'; } catch { this.thin = false; }
    this.buildUi();
    const v = app.viewer;
    v.frameHooks.push(() => this.updateWidths());
    app.views.addEventListener('activate', () => { this.syncUi(); this.refreshSection(); });
    v.addEventListener('change', () => this.scheduleSection());
    v.addEventListener('visibility', () => this.scheduleSection());
  }

  /** Dados do projeto (ao abrir e quando alguém muda). */
  load(dados = {}) {
    if (dados.escalas) this.scales = { ...dados.escalas };
    if (dados.pesos) this.weights = { ...DEFAULT_WEIGHTS, ...dados.pesos };
    this.syncUi();
    this.dispatchEvent(new Event('change'));
  }

  isDrawing(view = this.app.views.active) { return DRAWING_KINDS.has(view.kind); }
  scaleOf(view = this.app.views.active) { return Number(this.scales[view.id]) || 100; }

  setScale(n, view = this.app.views.active) {
    this.scales[view.id] = Number(n) || 100;
    this.app.project?.send({ t: 'projeto', dados: { escalas: this.scales } });
    this.syncUi();
    this.dispatchEvent(new Event('change'));
  }

  setThin(on) {
    this.thin = !!on;
    try { localStorage.setItem('boxbim.linhasFinas', on ? '1' : '0'); } catch { /* sem armazenamento */ }
    this.syncUi();
  }

  /** Metros do modelo → px na tela (vista ortográfica), ou null na perspectiva. */
  pxPerMeter() {
    const v = this.app.viewer, cam = v.camera;
    if (!cam.isOrthographicCamera) return null;
    return (v.container.clientHeight || 1) / ((cam.top - cam.bottom) / cam.zoom);
  }

  /** mm de papel → px na tela (para as cotas e textos das vistas de desenho). */
  mmToPx(mm, view = this.app.views.active) {
    const p = this.pxPerMeter();
    return p ? mm * this.scaleOf(view) / 1000 * p : mm * 3.78;
  }

  /** mm de papel → metros do modelo na escala da vista. */
  mmToModel(mm, view = this.app.views.active) { return mm * this.scaleOf(view) / 1000; }

  /** A cada quadro: espessura das linhas pelo peso, pela escala e pelo zoom. */
  updateWidths() {
    this.app.viewer.paperScale = this.scaleOf(); // espaçamento das hachuras do corte
    // plano de corte mudou (outra vista, altura de corte do nível): refaz as linhas de corte
    const cap = this.app.viewer.showEdges ? this.app.viewer.capPlane : null;
    if (cap !== this._cap) { this._cap = cap; this.scheduleSection(); }
    const paper = this.isDrawing() && this.app.viewer.showEdges;
    const px = mm => (this.thin || !paper ? 1 : Math.min(9, Math.max(1, this.mmToPx(mm))));
    const e = px(this.weights.projecao), c = px(this.weights.corte);
    if (EDGE_MAT.linewidth !== e) EDGE_MAT.linewidth = e;
    if (CUT_MAT.linewidth !== c) CUT_MAT.linewidth = c;
    if (CUT_INNER_MAT.linewidth !== e) CUT_INNER_MAT.linewidth = e;
  }

  // ------------------------------------------------------------ linhas de corte

  scheduleSection() {
    clearTimeout(this._t);
    this._t = setTimeout(() => this.refreshSection(), 140);
  }

  refreshSection() {
    const v = this.app.viewer;
    const show = v.capPlane !== null && v.capPlane !== undefined && v.showEdges && !v.renderOverride;
    v.updateSectionLines(show ? v.capPlane : null);
  }

  // ------------------------------------------------------------ interface (barra de baixo)

  buildUi() {
    this.select = h('select', { class: 'scale-select', title: 'Escala da vista (texto das cotas e peso das linhas)', onchange: e => {
      if (e.target.value === 'pesos') { e.target.value = String(this.scaleOf()); this.weightsDialog(); return; }
      this.setScale(Number(e.target.value));
    } },
    SCALES.map(n => h('option', { value: n }, `1:${n}`)),
    h('option', { value: 'pesos' }, 'Pesos de linha…'));
    this.thinBtn = h('button', { class: 'toggle', title: 'Linhas finas: todas as linhas com 1 px (para desenhar com precisão)', onclick: () => this.setThin(!this.thin) }, 'LF');
    const right = document.querySelector('.status-right');
    right.prepend(this.select, this.thinBtn);
    this.syncUi();
  }

  syncUi() {
    if (!this.select) return;
    this.select.value = String(this.scaleOf());
    this.select.hidden = !this.isDrawing();
    this.thinBtn.classList.toggle('on', this.thin);
  }

  weightsDialog() {
    const w = { ...this.weights };
    const row = (key, label, hint) => h('label', { class: 'color-row', title: hint },
      h('input', { type: 'number', min: 0.05, max: 3, step: 0.05, value: w[key], style: 'width:80px', oninput: e => { w[key] = Math.max(0.05, Number(e.target.value) || DEFAULT_WEIGHTS[key]); } }),
      `${label} (mm)`);
    modal({
      title: 'Pesos de linha',
      small: true,
      body: h('div', {},
        h('p', { class: 'muted', style: 'margin-top:0' }, 'Espessura no papel. Na tela, segue a escala da vista e o zoom (LF na barra de baixo põe tudo fino).'),
        row('corte', 'Corte', 'Contorno onde o plano de corte atravessa as peças'),
        row('projecao', 'Projeção', 'Arestas das peças vistas além do corte'),
        row('anotacao', 'Anotação', 'Cotas e linhas de anotação')),
      actions: [{ label: 'Cancelar' }, { label: 'Salvar', class: 'primary', action: () => {
        this.weights = w;
        this.app.project?.send({ t: 'projeto', dados: { pesos: w } });
        toast('Pesos de linha salvos no projeto.');
        this.dispatchEvent(new Event('change'));
      } }],
    });
  }
}
