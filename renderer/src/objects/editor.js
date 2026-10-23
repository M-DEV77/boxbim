// Editor de OBJETOS em tela cheia: parâmetros com controles ao vivo, prévia 3D interativa e código JavaScript.
//
//   ┌ cabeçalho: nome · categoria · estado · Exportar / Salvar e inserir / Salvar ─────────────────────┐
//   │ PARÂMETROS            │ PRÉVIA 3D (vistas, arame, cotas, vão;   │ CÓDIGO (trechos prontos,       │
//   │ cartões com controle  │ clique numa peça → linha do código)     │ cores, linhas, console)        │
//   └───────────────────────┴─────────────────────────────────────────┴────────────────────────────────┘
// Na prévia, a barra "2D" desenha linhas, círculos, aparar/estender/canto, extrudar/varrer e eixos de trabalho
// escrevendo no código (sketch2d.js).
// Atalhos: Ctrl+S salva · Ctrl+Enter executa · Ctrl+/ comenta a linha · Esc fecha.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { AxisWidget } from '../nav.js';
import { applyDelta } from './codeedit.js';
import { snapPivot } from '../snap.js';
import { h, modal, toast, confirmDialog, dropdown, esc } from '../ui.js';
import { PARAM_TYPES, OBJECT_CATEGORIES, coerceParams, optionList, blankObject } from './objects.js';
import { ObjectSketch } from './sketch2d.js';

const B = window.boxbim;

// ---------------------------------------------------------------- catálogos

const TYPE_ICON = { comprimento: '↔', numero: '#', inteiro: '①', angulo: '∠', booleano: '☑', texto: 'T', opcao: '☰', material: '◧', cor: '●' };
const NUMERIC = new Set(['comprimento', 'numero', 'inteiro', 'angulo']);

const NEW_PARAM = {
  comprimento: { default: 1, min: 0.1, max: 5, group: 'Dimensões' },
  numero: { default: 1, min: 0, max: 10, group: 'Geral' },
  inteiro: { default: 3, min: 1, max: 10, group: 'Geral' },
  angulo: { default: 0, min: 0, max: 90, group: 'Geral' },
  booleano: { default: true, group: 'Opções' },
  texto: { default: '', group: 'Geral' },
  opcao: { default: 'A', options: 'A;B;C', group: 'Opções' },
  material: { default: 'Madeira', group: 'Materiais' },
  cor: { default: '#c8a165', group: 'Materiais' },
};

const QUICK_CATEGORIES = [
  ['IfcFurniture', 'Mobiliário'], ['IfcDoor', 'Porta'], ['IfcWindow', 'Janela'], ['IfcStair', 'Escada'], ['IfcBuildingElementProxy', 'Genérico'],
];

const SNIPPETS = [
  ['Caixa', 'g.box(largura, profundidade, altura, { … })', `g.box(1, 0.5, 0.8, { x: 0, y: 0, z: 0, material: 'Madeira', name: 'Caixa' });\n`],
  ['Cilindro', 'g.cylinder(raio, altura, { … })', `g.cylinder(0.1, 1, { x: 0, y: 0, z: 0, material: 'Aço', name: 'Cilindro' });\n`],
  ['Esfera', 'g.sphere(raio, { … })', `g.sphere(0.2, { z: 0.2, material: 'Vidro', name: 'Esfera' });\n`],
  ['Extrusão', 'perfil 2D extrudado — plane: xy (sobe), xz (avança em Y), yz (avança em X)', `g.extrude([[0, 0], [0.5, 0], [0.5, 0.05], [0.05, 0.05], [0.05, 0.5], [0, 0.5]], 1, { plane: 'xz', material: 'Aço', name: 'Perfil L' });\n`],
  ['Revolução', 'perfil [raio, z] girado em torno de Z', `g.revolve([[0, 0], [0.15, 0], [0.12, 0.3], [0.05, 0.45], [0.04, 0.6]], { segments: 48, material: 'Vidro', name: 'Vaso' });\n`],
  ['Repetir', 'laço for: várias peças iguais', `for (let i = 0; i < 4; i++) {\n  g.box(0.05, 0.05, 1, { x: i * 0.3, name: 'Peça ' + (i + 1) });\n}\n`],
  ['Deslocar/girar', 'g.at: desenha com a origem deslocada/girada (rotX, rotY, rotZ)', `g.at({ x: 0, y: 0, z: 0, rotZ: 45 }, () => {\n  // peças aqui dentro ficam deslocadas e giradas\n  g.box(0.5, 0.05, 1, { name: 'Peça girada' });\n});\n`],
  ['Condição', 'if: parte opcional controlada por um parâmetro Sim/Não', `if (p.comPuxador) {\n  g.sphere(0.02, { x: 0, y: -0.3, z: 0.8, color: '#c8c8c8', name: 'Puxador' });\n}\n`],
  ['Vão', 'g.opening: vão que porta/janela abre na parede', `g.opening(p.largura, p.altura, { sill: 0 });\n`],
  ['Linha 2D', 'g.line: linha/polilinha no plano (xy, xz, yz ou eixo de trabalho), com tipo, espessura e cor', `g.line([[0, 0], [1, 0], [1, 0.5]], { plane: 'xy', tipo: 'tracejada', espessura: 0.35, color: '#2fd18a' });\n`],
  ['Círculo 2D', 'g.circle / g.arc: círculo e arco no plano', `g.circle(0, 0, 0.3, { plane: 'xy' });\ng.arc(0, 0, 0.5, 0, 90, { plane: 'xy' });\n`],
  ['Eixo de trabalho', 'g.workplane: plano de desenho com nome (o plano XY girado e deslocado)', `g.workplane('Eixo A', { y: 0.2, rotX: 90 }); // vertical, de frente\n`],
  ['Varredura', 'g.sweep: perfil [[u, v]…] ao longo de um caminho [[x, y, z]…]', `g.sweep([[0, 0, 0], [1, 0, 0], [1, 1, 0]], [[-0.02, -0.02], [0.02, -0.02], [0.02, 0.02], [-0.02, 0.02]], { material: 'Aço', name: 'Barra' });\n`],
  ['Vazio', '{ vazio: true }: a peça corta as outras do objeto', `g.cylinder(0.05, 1, { z: 0, vazio: true, name: 'Furo' });\n`],
  ['Mensagem', 'g.log: escreve no console abaixo', `g.log('largura =', p.largura);\n`],
];

const EXAMPLES = [
  {
    name: 'Luminária pendente', category: 'IfcLightFixture', description: 'Cúpula por revolução pendurada por um cabo.',
    parameters: [
      { name: 'diametro', label: 'Diâmetro da cúpula', type: 'comprimento', default: 0.4, min: 0.15, max: 1.2, group: 'Dimensões' },
      { name: 'alturaCupula', label: 'Altura da cúpula', type: 'comprimento', default: 0.25, min: 0.1, max: 0.8, group: 'Dimensões' },
      { name: 'pendente', label: 'Comprimento do cabo', type: 'comprimento', default: 0.8, min: 0.1, max: 3, group: 'Dimensões' },
      { name: 'cor', label: 'Cor da cúpula', type: 'cor', default: '#2f3640', group: 'Materiais' },
    ],
    script: `// Luminária: cúpula (revolução) + cabo (cilindro fino); a origem fica no teto
const r = p.diametro / 2, hc = p.alturaCupula;
g.cylinder(0.004, p.pendente, { z: -p.pendente, color: '#222222', name: 'Cabo' });
g.revolve([[0.02, 0], [r * 0.35, -hc * 0.15], [r * 0.8, -hc * 0.6], [r, -hc]], {
  z: -p.pendente, segments: 64, color: p.cor, name: 'Cúpula',
});
g.sphere(0.04, { z: -p.pendente - hc * 0.45, color: '#fff6d5', name: 'Lâmpada' });
`,
  },
  {
    name: 'Perfil L (cantoneira)', category: 'IfcMember', description: 'Cantoneira de abas iguais por extrusão de perfil.',
    parameters: [
      { name: 'aba', label: 'Aba', type: 'comprimento', default: 0.05, min: 0.02, max: 0.2, group: 'Seção' },
      { name: 'espessura', label: 'Espessura', type: 'comprimento', default: 0.005, min: 0.002, max: 0.02, group: 'Seção' },
      { name: 'comprimento', label: 'Comprimento', type: 'comprimento', default: 1, min: 0.1, max: 12, group: 'Dimensões' },
      { name: 'material', label: 'Material', type: 'material', default: 'Aço', group: 'Materiais' },
    ],
    script: `// Cantoneira: o perfil em L fica no plano XZ e é extrudado ao longo de Y
const a = p.aba, t = p.espessura;
g.extrude([[0, 0], [a, 0], [a, t], [t, t], [t, a], [0, a]], p.comprimento, {
  plane: 'xz', material: p.material, name: 'Cantoneira',
});
g.log('massa ≈', (7850 * (2 * a - t) * t * p.comprimento).toFixed(2), 'kg');
`,
  },
];

const camel = s => {
  const words = String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^A-Za-z0-9]+/).filter(Boolean);
  let out = words.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join('');
  if (!out) out = 'param';
  if (/^\d/.test(out)) out = 'p' + out;
  return out;
};
const isIdent = s => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(s);
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fmt = v => (Math.round(v * 1000) / 1000).toString().replace('.', ',');

// ---------------------------------------------------------------- entrada

/** Abre o editor. Objeto novo (sem id) começa pela escolha de um modelo. */
export function openObjectEditor(app, def) {
  if (!def.id && !def._template) return chooseTemplate(app);
  const { _template, ...clean } = def;
  return new ObjectWorkspace(app, clean).open();
}

function chooseTemplate(app) {
  const start = d => {
    dlg.close();
    const copy = structuredClone(d);
    delete copy.id; delete copy.updated; delete copy.revision; delete copy.created;
    copy.author = '';
    new ObjectWorkspace(app, { format: 'boxbim-objeto', version: 1, ...copy, name: copy.name }).open();
  };
  const card = (title, sub, desc, d, accent) => h('button', { class: `oe-tpl${accent ? ' accent' : ''}`, onclick: () => start(d) },
    h('div', { class: 'oe-tpl-title' }, title), h('div', { class: 'oe-tpl-sub' }, sub), h('div', { class: 'oe-tpl-desc' }, desc));
  const lib = app.objects.items.filter(o => !o.broken);
  const body = h('div', {},
    h('div', { class: 'oe-tpl-group' }, 'Começar do zero'),
    h('div', { class: 'oe-tpl-grid' },
      card('Em branco', 'uma caixa e 4 parâmetros', 'O ponto de partida mais simples: ajuste os parâmetros e escreva o script.', blankObject(), true)),
    h('div', { class: 'oe-tpl-group' }, 'Exemplos para aprender'),
    h('div', { class: 'oe-tpl-grid' }, EXAMPLES.map(e => card(e.name, e.category, e.description, { ...e, name: e.name }))),
    lib.length ? h('div', { class: 'oe-tpl-group' }, 'Copiar um objeto da biblioteca') : null,
    h('div', { class: 'oe-tpl-grid' }, lib.map(o => card(o.name, `${o.category} · ${o.parameters.length} parâmetro(s)`, o.description || '', { ...o, name: `${o.name} (cópia)` }))));
  const dlg = modal({ title: 'Novo objeto — escolha um ponto de partida', body, actions: [{ label: 'Cancelar' }] });
  dlg.el.classList.add('wide');
}

// ---------------------------------------------------------------- área de trabalho

class ObjectWorkspace {
  constructor(app, def) {
    this.app = app;
    this.obj = structuredClone(def);
    this.obj.parameters ||= [];
    this.obj.script ||= '';
    this.saved = JSON.stringify(this.snapshot());
    this.values = coerceParams(this.obj, {});
    this.editing = null;          // índice do parâmetro com a definição aberta
    this.autoName = new Set();    // parâmetros cujo nome segue o rótulo automaticamente
    this.runSeq = 0;
  }

  snapshot() {
    const { name, category, description, parameters, script } = this.obj;
    return { name, category, description, parameters, script };
  }

  get dirty() { return JSON.stringify(this.snapshot()) !== this.saved; }

  open() {
    this.build();
    document.body.append(this.root);
    this.stage.mount();
    this.sketch = new ObjectSketch(this);
    // as duas barras da prévia empilhadas (a de cima pode quebrar em duas linhas)
    const stack = h('div', { class: 'oe-toolstack' });
    this.stage.toolbar.replaceWith(stack);
    stack.append(this.stage.toolbar, this.sketch.toolbar);
    this.renderParams();
    this.code.refresh();
    this.run(true);
    this._key = e => this.onKey(e);
    document.addEventListener('keydown', this._key, true);
    this.app.objectEditor = this; // editor aberto (útil no DevTools)
    setTimeout(() => this.nameIn.select(), 50);
    return this;
  }

  async close(force = false) {
    if (!force && this.dirty && !(await confirmDialog('Há alterações não salvas neste objeto. Fechar mesmo assim?', { danger: true, ok: 'Fechar sem salvar' }))) return;
    this.sketch?.stop();
    document.removeEventListener('keydown', this._key, true);
    if (this.app.objectEditor === this) this.app.objectEditor = null;
    this.stage.dispose();
    this.root.remove();
  }

  // ---------------------------------------------------------------- montagem

  build() {
    const o = this.obj;
    this.nameIn = h('input', { class: 'oe-name', value: o.name, placeholder: 'Nome do objeto', oninput: e => { o.name = e.target.value; this.updateHeader(); } });
    this.catSel = h('select', { class: 'oe-catsel', title: 'Categoria IFC', onchange: e => this.setCategory(e.target.value) },
      OBJECT_CATEGORIES.map(c => h('option', { value: c, selected: c === o.category }, c)));
    this.catChips = h('div', { class: 'oe-chips' }, QUICK_CATEGORIES.map(([c, label]) =>
      h('button', { 'data-cat': c, class: c === o.category ? 'on' : '', onclick: () => this.setCategory(c) }, label)));
    this.statusEl = h('div', { class: 'oe-status' }, '…');
    this.dirtyEl = h('span', { class: 'oe-dirty', title: 'Alterações não salvas' }, '●');
    const head = h('header', { class: 'oe-head' },
      h('button', { class: 'oe-back', title: 'Fechar (Esc)', onclick: () => this.close() }, '←'),
      h('div', { class: 'oe-title' }, h('div', { class: 'oe-kicker' }, 'Objeto paramétrico', this.dirtyEl), this.nameIn),
      h('div', { class: 'oe-cat' }, this.catChips, this.catSel),
      this.statusEl,
      h('div', { class: 'spacer' }),
      h('button', { onclick: () => this.exportBbo(), title: 'Salva e exporta um arquivo .bbo para usar em outro projeto' }, 'Exportar .bbo'),
      h('button', { onclick: () => this.save(true), title: 'Salva e começa a inserir no projeto' }, 'Salvar e inserir'),
      h('button', { class: 'primary', onclick: () => this.save(), title: 'Ctrl+S' }, 'Salvar'));

    // parâmetros
    this.paramList = h('div', { class: 'oe-plist' });
    this.descIn = h('textarea', { class: 'oe-desc', rows: 2, placeholder: 'Descrição: para que serve, como é inserido…', oninput: e => { o.description = e.target.value; this.updateHeader(); } }, o.description || '');
    const params = h('aside', { class: 'oe-params' },
      h('div', { class: 'oe-pane-head' }, h('span', {}, 'Parâmetros'), h('span', { class: 'spacer' }),
        h('button', { class: 'mini primary', onclick: e => this.addParamMenu(e.currentTarget) }, '+ Adicionar ▾')),
      h('div', { class: 'oe-hint' }, 'Mexa nos controles para testar. ✎ edita a definição; no código, use p.<nome>.'),
      this.paramList,
      this.nestedBox = h('div', { class: 'oe-nested' }),
      h('div', { class: 'oe-pane-head small' }, 'Descrição'), this.descIn);

    // prévia
    this.stage = new Stage({ onPick: line => line && this.code.gotoLine(line, true), onTransform: info => this.onPartTransform(info) });
    const stage = h('section', { class: 'oe-stage' }, this.stage.el);

    // código
    this.code = new CodeEditor({ value: o.script, onChange: v => { o.script = v; this.updateHeader(); this.renderUsage(); this.schedule(); } });
    this.consoleEl = h('div', { class: 'oe-console' });
    const snippets = h('div', { class: 'oe-snippets' }, h('span', { class: 'muted small' }, 'Inserir:'),
      h('button', { class: 'mini primary', title: 'Colocar outro objeto da biblioteca dentro deste (parâmetros compartilhados)', onclick: e => this.nestMenu(e.currentTarget) }, 'Objeto ▾'),
      SNIPPETS.map(([label, tip, code]) => h('button', { class: 'mini', title: tip, onclick: () => this.code.insert(code) }, label)));
    const codePane = h('section', { class: 'oe-codepane' },
      h('div', { class: 'oe-pane-head' }, h('span', {}, 'Código (JavaScript)'), h('span', { class: 'spacer' }),
        h('span', { class: 'muted small' }, 'Ctrl+Enter executa · Ctrl+/ comenta'),
        h('button', { class: 'mini', onclick: () => this.run() }, '▶ Executar'),
        h('button', { class: 'mini', onclick: () => this.toggleHelp() }, '? API')),
      snippets,
      this.code.el,
      this.help = h('div', { class: 'oe-help', hidden: true, html: HELP_HTML }),
      h('div', { class: 'oe-pane-head small' }, 'Console'),
      this.consoleEl);

    const splitter = h('div', { class: 'oe-split', title: 'Arraste para redimensionar' });
    this.body = h('div', { class: 'oe-body' }, params, stage, splitter, codePane);
    splitter.addEventListener('pointerdown', e => {
      const startX = e.clientX, startW = codePane.offsetWidth;
      const move = ev => { this.body.style.setProperty('--code-w', `${Math.min(window.innerWidth * 0.7, Math.max(320, startW - (ev.clientX - startX)))}px`); };
      const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
      addEventListener('pointermove', move); addEventListener('pointerup', up);
    });
    this.root = h('div', { class: 'oe' }, head, this.body);
    this.updateHeader();
  }

  setCategory(c) {
    this.obj.category = c;
    this.catSel.value = c;
    this.catChips.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.cat === c));
    this.updateHeader();
    this.schedule();
  }

  updateHeader() {
    this.dirtyEl.hidden = !this.dirty;
  }

  toggleHelp() { this.help.hidden = !this.help.hidden; }

  // ---------------------------------------------------------------- parâmetros

  renderParams() {
    const list = this.paramList;
    list.innerHTML = '';
    const params = this.obj.parameters;
    if (!params.length) list.append(h('div', { class: 'oe-empty' }, 'Nenhum parâmetro ainda. Clique em “+ Adicionar” para criar largura, altura, material…'));
    const groups = [];
    params.forEach((p, i) => {
      const g = p.group || 'Geral';
      let grp = groups.find(x => x.name === g);
      if (!grp) groups.push(grp = { name: g, items: [] });
      grp.items.push(i);
    });
    for (const grp of groups) {
      list.append(h('div', { class: 'oe-pgroup' }, grp.name));
      for (const i of grp.items) list.append(this.paramCard(i));
    }
    this.renderUsage();
  }

  /** Marca os parâmetros não usados no código (dica para o usuário). */
  renderUsage() {
    const code = this.obj.script;
    this.paramList.querySelectorAll('.oe-pcard').forEach(card => {
      const p = this.obj.parameters[Number(card.dataset.i)];
      const used = p && new RegExp(`\\bp\\.${reEsc(p.name)}\\b`).test(code);
      card.querySelector('.oe-unused').hidden = used;
    });
  }

  paramCard(i) {
    const p = this.obj.parameters[i];
    const card = h('div', { class: `oe-pcard${this.editing === i ? ' editing' : ''}`, 'data-i': i });
    const control = this.liveControl(p);
    card.append(
      h('div', { class: 'oe-prow' },
        h('span', { class: 'oe-ptype', title: PARAM_TYPES[p.type] }, TYPE_ICON[p.type] || '?'),
        h('div', { class: 'oe-plabel' }, h('div', {}, p.label || p.name), h('code', { title: 'Use no código assim' }, `p.${p.name}`)),
        h('span', { class: 'oe-unused', title: 'Este parâmetro ainda não é usado no código' }, 'não usado'),
        h('button', { class: 'icon', title: 'Inserir p.' + p.name + ' no código', onclick: () => this.code.insert(`p.${p.name}`) }, '⤵'),
        h('button', { class: `icon${this.editing === i ? ' on' : ''}`, title: 'Editar definição', onclick: () => { this.editing = this.editing === i ? null : i; this.renderParams(); } }, '✎')),
      control);
    if (this.editing === i) card.append(this.paramEditor(i));
    return card;
  }

  liveControl(p) {
    const v = this.values[p.name];
    const set = val => { this.values[p.name] = val; this.schedule(); };
    let input;
    switch (p.type) {
      case 'booleano': input = h('label', { class: 'oe-switch' }, h('input', { type: 'checkbox', checked: !!v, onchange: e => set(e.target.checked) }), h('span', {}, v ? 'Sim' : 'Não')); break;
      case 'opcao': input = h('select', { onchange: e => set(e.target.value) }, optionList(p).map(x => h('option', { value: x, selected: x === v }, x))); break;
      case 'material': input = h('select', { onchange: e => set(e.target.value) }, Object.keys(this.app.types.materials).map(m => h('option', { value: m, selected: m === v }, m))); break;
      case 'cor': input = h('input', { type: 'color', value: v || '#cccccc', oninput: e => set(e.target.value) }); break;
      case 'texto': input = h('input', { value: v, oninput: e => set(e.target.value) }); break;
      default: {
        const num = h('input', { type: 'number', class: 'oe-num', step: p.type === 'inteiro' ? 1 : 'any', value: v, oninput: e => { range && (range.value = e.target.value); set(e.target.value); } });
        const hasRange = p.min !== '' && p.min != null && p.max !== '' && p.max != null && Number(p.max) > Number(p.min);
        const range = hasRange ? h('input', { type: 'range', min: p.min, max: p.max, step: p.type === 'inteiro' || p.type === 'angulo' ? 1 : p.type === 'comprimento' ? 0.005 : (Number(p.max) - Number(p.min)) / 200, value: v,
          oninput: e => { num.value = e.target.value; set(e.target.value); } }) : null;
        const unit = { comprimento: 'm', angulo: '°' }[p.type] || '';
        input = h('div', { class: 'oe-numrow' }, range, num, unit ? h('span', { class: 'muted small' }, unit) : null);
      }
    }
    if (p.type === 'booleano') input.querySelector('input').addEventListener('change', e => { input.querySelector('span').textContent = e.target.checked ? 'Sim' : 'Não'; });
    return h('div', { class: 'oe-pctl' }, input);
  }

  paramEditor(i) {
    const p = this.obj.parameters[i];
    const changed = (rerender = false) => { this.updateHeader(); this.values = coerceParams(this.obj, this.values); this.schedule(); if (rerender) this.renderParams(); };
    const label = h('input', { value: p.label || '', placeholder: 'ex.: Largura do tampo', oninput: e => {
      p.label = e.target.value;
      if (this.autoName.has(i)) this.renameParam(i, this.uniqueName(camel(p.label), i), false);
      card.querySelector('.oe-plabel div').textContent = p.label || p.name;
      card.querySelector('.oe-plabel code').textContent = `p.${p.name}`;
      nameIn.value = p.name;
      changed();
    } });
    const nameIn = h('input', { value: p.name, class: 'mono', onchange: e => {
      const n = e.target.value.trim();
      if (!isIdent(n)) { toast('Nome no código: só letras, números e _ (sem espaços nem acentos), começando por letra.', 'error'); e.target.value = p.name; return; }
      if (this.obj.parameters.some((x, j) => j !== i && x.name === n)) { toast(`Já existe um parâmetro "${n}".`, 'error'); e.target.value = p.name; return; }
      this.autoName.delete(i);
      this.renameParam(i, n, true);
      changed(true);
    } });
    const typeSel = h('select', { onchange: e => { p.type = e.target.value; Object.assign(p, { ...NEW_PARAM[p.type], label: p.label, name: p.name, group: p.group }); changed(true); } },
      Object.entries(PARAM_TYPES).map(([k, v]) => h('option', { value: k, selected: k === p.type }, `${TYPE_ICON[k]}  ${v}`)));
    const field = (lbl, key, attrs = {}) => h('label', {}, lbl, h('input', { value: p[key] ?? '', ...attrs, onchange: e => { p[key] = attrs.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value; changed(key === 'group' || key === 'options' || key === 'min' || key === 'max'); } }));
    const numeric = NUMERIC.has(p.type);
    const move = d => () => {
      const j = i + d;
      if (j < 0 || j >= this.obj.parameters.length) return;
      const ps = this.obj.parameters;
      [ps[i], ps[j]] = [ps[j], ps[i]];
      this.editing = j;
      changed(true);
    };
    const card = h('div', { class: 'oe-pedit' },
      h('div', { class: 'row' }, h('label', {}, 'Rótulo', label), h('label', {}, 'Nome no código', nameIn)),
      h('div', { class: 'row' }, h('label', {}, 'Tipo', typeSel), field('Grupo', 'group', { placeholder: 'Dimensões' })),
      numeric ? h('div', { class: 'row three' }, field('Padrão', 'default', { type: 'number', step: 'any' }), field('Mínimo', 'min', { type: 'number', step: 'any' }), field('Máximo', 'max', { type: 'number', step: 'any' })) : null,
      !numeric && p.type !== 'booleano' ? h('div', { class: 'row' }, field('Padrão', 'default'), p.type === 'opcao' ? field('Opções (separadas por ;)', 'options', { placeholder: 'A;B;C' }) : h('span')) : null,
      p.type === 'booleano' ? h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: !!p.default, onchange: e => { p.default = e.target.checked; changed(); } }), 'Padrão: Sim') : null,
      h('div', { class: 'oe-pactions' },
        h('button', { class: 'mini', title: 'O valor de teste atual vira o padrão', onclick: () => { p.default = this.values[p.name]; changed(true); toast(`Padrão de "${p.label || p.name}" = ${this.values[p.name]}`); } }, 'Usar valor atual como padrão'),
        h('span', { class: 'spacer' }),
        h('button', { class: 'mini', title: 'Subir', onclick: move(-1) }, '↑'),
        h('button', { class: 'mini', title: 'Descer', onclick: move(1) }, '↓'),
        h('button', { class: 'mini danger', onclick: async () => {
          const used = new RegExp(`\\bp\\.${reEsc(p.name)}\\b`).test(this.obj.script);
          if (used && !(await confirmDialog(`"p.${p.name}" é usado no código. Remover o parâmetro mesmo assim?`, { danger: true, ok: 'Remover' }))) return;
          this.obj.parameters.splice(i, 1);
          this.editing = null;
          changed(true);
        } }, 'Remover')));
    return card;
  }

  uniqueName(base, except) {
    let n = base, k = 2;
    while (this.obj.parameters.some((x, j) => j !== except && x.name === n)) n = `${base}${k++}`;
    return n;
  }

  /** Renomeia o parâmetro e atualiza p.<antigo> → p.<novo> no código. */
  renameParam(i, next, announce) {
    const p = this.obj.parameters[i];
    const prev = p.name;
    if (!next || next === prev) return;
    const re = new RegExp(`\\bp\\.${reEsc(prev)}\\b`, 'g');
    const count = (this.obj.script.match(re) || []).length;
    if (count) this.code.setValue(this.obj.script.replace(re, `p.${next}`));
    if (prev in this.values) { this.values[next] = this.values[prev]; delete this.values[prev]; }
    p.name = next;
    if (announce && count) toast(`p.${prev} → p.${next} (${count} ocorrência(s) no código)`);
  }

  addParamMenu(anchor) {
    dropdown(anchor, Object.entries(PARAM_TYPES).map(([k, v]) => ({
      label: `${TYPE_ICON[k]}   ${v}`,
      action: () => {
        const label = { comprimento: 'Largura', material: 'Material', cor: 'Cor', booleano: 'Opcional', opcao: 'Modelo', angulo: 'Ângulo', inteiro: 'Quantidade' }[k] || 'Novo parâmetro';
        const name = this.uniqueName(camel(label), -1);
        this.obj.parameters.push({ name, label, type: k, ...structuredClone(NEW_PARAM[k]) });
        const i = this.obj.parameters.length - 1;
        this.autoName.add(i);
        this.editing = i;
        this.values = coerceParams(this.obj, this.values);
        this.renderParams();
        this.updateHeader();
        const inp = this.paramList.querySelector('.oe-pcard.editing .oe-pedit input');
        inp?.focus(); inp?.select();
        this.schedule();
      },
    })));
  }

  // ---------------------------------------------------------------- mover/girar peças na prévia

  /**
   * Arraste do gizmo terminado: converte o deslocamento (coordenadas do objeto) para o referencial da chamada
   * (g.at) e soma nas opções { x, y, z, rotX, rotY, rotZ } da linha que criou a peça.
   */
  onPartTransform({ line, cm, dT, axis, deg, count }) {
    const R = new THREE.Matrix4();
    if (cm) R.extractRotation(new THREE.Matrix4().fromArray(cm));
    const inv = R.clone().invert();
    const changes = {};
    const r4 = v => Math.round(v * 10000) / 10000;
    if (dT) {
      const d = dT.clone().applyMatrix4(inv);
      if (Math.abs(d.x) > 1e-6) changes.x = r4(d.x);
      if (Math.abs(d.y) > 1e-6) changes.y = r4(d.y);
      if (Math.abs(d.z) > 1e-6) changes.z = r4(d.z);
    }
    if (axis && Math.abs(deg) > 1e-6) {
      const a = axis.clone().transformDirection(inv);
      const comp = [['rotX', a.x], ['rotY', a.y], ['rotZ', a.z]].find(([, v]) => Math.abs(v) > 0.999);
      if (!comp) { toast('Esse eixo não está alinhado com os eixos desta chamada (g.at girado): gire pelo código.', 'error'); this.run(); return; }
      changes[comp[0]] = r4(Math.sign(comp[1]) * deg);
    }
    if (!Object.keys(changes).length) { this.run(); return; }
    try {
      const { script } = applyDelta(this.obj.script, line, changes);
      this.code.setValue(script);
      this.code.gotoLine(line, true);
      const desc = Object.entries(changes).map(([k, v]) => `${k} ${v > 0 ? '+' : '−'}${fmt(Math.abs(v))}${k.startsWith('rot') ? '°' : ''}`).join(' · ');
      this.extraLog = { kind: 'log', text: `linha ${line}: ${desc}${count > 1 ? ` (afeta as ${count} peças criadas por esta linha)` : ''}` };
    } catch (e) {
      toast(e.message, 'error');
      this.run();
    }
  }

  // ---------------------------------------------------------------- objetos aninhados

  /** Menu "Objeto ▾": escreve g.object(...) com os parâmetros do objeto escolhido. */
  nestMenu(anchor) {
    const items = this.app.objects.items.filter(o => !o.broken && o.id !== this.obj.id);
    if (!items.length) return toast('A biblioteca não tem outros objetos.', 'error');
    dropdown(anchor, items.map(o => ({ label: o.name, hint: o.category, action: () => this.code.insert(this.nestCode(o)) })));
  }

  nestCode(child) {
    const mine = new Set(this.obj.parameters.map(p => p.name));
    const shared = child.parameters.filter(p => mine.has(p.name)).map(p => p.name);
    const lit = v => (typeof v === 'string' ? JSON.stringify(v) : String(v));
    const lines = [`g.object(${JSON.stringify(child.name)}, {`];
    if (shared.length) lines.push(`  // compartilhados (mesmo nome, passam sozinhos): ${shared.join(', ')}`);
    for (const p of child.parameters.filter(q => !mine.has(q.name))) {
      lines.push(`  ${p.name}: ${lit(p.default)}, // ${p.label || p.name}${p.type === 'comprimento' ? ' (m)' : p.type === 'angulo' ? ' (°)' : ''}`);
    }
    lines.push('}, { x: 0, y: 0, z: 0 });', '');
    return lines.join('\n');
  }

  /** Lista os objetos usados dentro deste, com os parâmetros compartilhados. */
  renderNested(nested = []) {
    const box = this.nestedBox;
    box.innerHTML = '';
    if (!nested.length) return;
    const mine = new Set(this.obj.parameters.map(p => p.name));
    box.append(h('div', { class: 'oe-pane-head small' }, 'Objetos dentro deste'));
    for (const n of nested) {
      const def = this.app.objects.get(n.id);
      if (!def) continue;
      const explicit = new Set(n.explicit || []);
      const shared = def.parameters.filter(p => mine.has(p.name) && !explicit.has(p.name));
      const given = def.parameters.filter(p => explicit.has(p.name));
      const missing = def.parameters.filter(p => !mine.has(p.name) && !explicit.has(p.name));
      box.append(h('div', { class: 'oe-ncard' },
        h('div', { class: 'oe-nrow' }, h('b', {}, def.name), h('span', { class: 'muted small' }, def.category), h('span', { class: 'spacer' }),
          h('button', { class: 'mini', title: 'Abrir este objeto no editor', onclick: () => openObjectEditor(this.app, def) }, 'Abrir')),
        h('div', { class: 'oe-shared' },
          shared.length ? shared.map(p => h('span', { class: 'chip on', title: `${p.label || p.name}: recebe p.${p.name} deste objeto` }, `⇄ ${p.name}`)) : h('span', { class: 'muted small' }, 'nenhum parâmetro compartilhado'),
          given.map(p => h('span', { class: 'chip given', title: `${p.label || p.name}: valor informado no g.object (tem prioridade sobre o compartilhado)` }, `= ${p.name}`)),
          missing.map(p => h('span', { class: 'chip', title: `${p.label || p.name}: usa o padrão dele (informe em g.object ou traga para compartilhar)` }, p.name))),
        missing.length ? h('button', { class: 'mini', title: 'Cria neste objeto os parâmetros que faltam, com a mesma definição: passam a ser compartilhados', onclick: () => {
          for (const p of missing) this.obj.parameters.push(structuredClone(p));
          this.values = coerceParams(this.obj, this.values);
          this.renderParams();
          this.updateHeader();
          this.schedule();
          toast(`${missing.length} parâmetro(s) de "${def.name}" agora são compartilhados.`);
        } }, `Trazer parâmetros (${missing.length})`) : null));
    }
  }

  // ---------------------------------------------------------------- execução

  schedule() { clearTimeout(this._t); this._t = setTimeout(() => this.run(), 220); }

  async run(first = false) {
    clearTimeout(this._t);
    const seq = ++this.runSeq;
    this.status('run', 'executando…');
    const t0 = performance.now();
    try {
      const r = await this.app.objects.generate(this.obj, this.values, null, this.obj.category, { showVoids: true });
      if (seq !== this.runSeq) return false;
      this.lastOk = r;
      this.renderNested(r.nested);
      this.stage.show(r.meshes, r.opening, { keepCamera: !first });
      this.sketch?.afterRun();
      this.code.setError(null);
      const ms = Math.round(performance.now() - t0);
      this.status('ok', `✔ ${r.count} peça(s) · ${ms} ms`);
      this.log([{ kind: 'ok', text: `✔ ${r.count} peça(s) geradas em ${ms} ms${r.opening ? ` · vão ${fmt(r.opening.width)} × ${fmt(r.opening.height)} m` : ''}` },
        ...(this.extraLog ? [this.extraLog] : []), ...r.logs.map(text => ({ kind: 'log', text }))]);
      this.extraLog = null;
      return true;
    } catch (e) {
      if (seq !== this.runSeq) return false;
      this.code.setError(e.line || null);
      this.status('err', e.line ? `✖ erro na linha ${e.line}` : '✖ erro');
      this.log([{ kind: 'err', text: e.message.replace(/^[^:]*:\s*/, ''), line: e.line }, ...(e.logs || []).map(text => ({ kind: 'log', text }))]);
      return false;
    }
  }

  status(kind, text) {
    this.statusEl.className = `oe-status ${kind}`;
    this.statusEl.textContent = text;
  }

  log(entries) {
    this.consoleEl.innerHTML = '';
    for (const en of entries) {
      const row = h('div', { class: `oe-log ${en.kind}` }, en.text);
      if (en.line) {
        row.append(h('button', { class: 'mini', onclick: () => this.code.gotoLine(en.line) }, `ir para a linha ${en.line}`));
      }
      this.consoleEl.append(row);
    }
  }

  // ---------------------------------------------------------------- salvar / exportar

  async save(andInsert = false) {
    const o = this.obj;
    if (!o.name.trim()) { toast('Dê um nome ao objeto.', 'error'); this.nameIn.focus(); return null; }
    const names = o.parameters.map(p => p.name);
    if (names.some(n => !isIdent(n))) { toast('Há nomes de parâmetro inválidos (use letras, números e _).', 'error'); return null; }
    if (new Set(names).size !== names.length) { toast('Há nomes de parâmetro repetidos.', 'error'); return null; }
    const ok = await this.run();
    if (!ok && !(await confirmDialog('O script tem erro. Salvar mesmo assim?', { ok: 'Salvar' }))) return null;
    for (const p of o.parameters) p.default = coerceParams({ parameters: [p] }, {})[p.name];
    const saved = await this.app.objects.save(o);
    o.id = saved.id;
    this.saved = JSON.stringify(this.snapshot());
    this.updateHeader();
    const n = await this.app.refreshObjectInstances(saved.id);
    toast(`"${saved.name}" salvo na biblioteca${n ? ` · ${n} instância(s) atualizada(s) no projeto` : ''}.`);
    if (andInsert) { await this.close(true); this.app.placeObject(saved, this.values); }
    return saved;
  }

  async exportBbo() {
    const saved = await this.save();
    if (!saved) return;
    const file = await B.dialog.save({ defaultPath: `${saved.id}.bbo`, filters: [{ name: 'Objeto BoxBim', extensions: ['bbo'] }] });
    if (file) { await this.app.objects.exportFile(saved.id, file); toast(`Exportado: ${file}`); }
  }

  // ---------------------------------------------------------------- teclado

  onKey(e) {
    if (document.querySelector('#modal-root .modal-back')) return; // um diálogo por cima tem a vez
    if (this.sketch?.onKey(e)) return; // ferramenta 2D ativa: Esc, Enter, números…
    const k = e.key.toLowerCase();
    // V / M / R: selecionar, mover, girar peças na prévia (fora do código e dos campos)
    if (!e.ctrlKey && !e.target.matches?.('input, textarea, select') && ['v', 'm', 'r'].includes(k)) {
      e.preventDefault();
      this.stage.setMode({ v: 'select', m: 'translate', r: 'rotate' }[k]);
      return;
    }
    if (e.ctrlKey && k === 's') { e.preventDefault(); this.save(); }
    else if (e.ctrlKey && k === 'enter') { e.preventDefault(); this.run(); }
    else if (k === 'escape') {
      if (e.target.matches?.('input, select') && e.target.closest('.oe-pedit')) { e.target.blur(); return; }
      e.preventDefault();
      this.close();
    }
  }
}

// ---------------------------------------------------------------- prévia 3D

class Stage {
  constructor({ onPick, onTransform }) {
    this.onPick = onPick;
    this.onTransform = onTransform;
    this.mode = 'translate'; // clicar numa peça já mostra o gizmo de mover
    this.snap = true;
    this.selected = [];
    this.el = h('div', { class: 'oe-canvas' });
    this.tip = h('div', { class: 'oe-tip', hidden: true });
    this.dims = h('div', { class: 'oe-dims' });
    this.opts = { wire: false, dims: true, opening: true };
    const tool = (label, title, fn, key) => {
      const b = h('button', { title, onclick: () => { fn(); if (key) b.classList.toggle('on', this.opts[key]); } }, label);
      if (key && this.opts[key]) b.classList.add('on');
      return b;
    };
    this.modeBtns = {
      select: h('button', { title: 'Selecionar: clique numa peça para ir à linha do código (V)', onclick: () => this.setMode('select') }, '↖ Selecionar'),
      translate: h('button', { class: 'on', title: 'Mover a peça com as setas X/Y/Z: o código é ajustado (M)', onclick: () => this.setMode('translate') }, '✥ Mover'),
      rotate: h('button', { title: 'Girar a peça nos anéis X/Y/Z: o código é ajustado (R)', onclick: () => this.setMode('rotate') }, '⟳ Girar'),
    };
    const snapBtn = h('button', { class: 'on', title: 'Encaixe: 1 cm / 5° (Ctrl durante o arraste desliga)', onclick: () => {
      this.snap = !this.snap; snapBtn.classList.toggle('on', this.snap); this.applySnap(this.snap);
    } }, 'Encaixe');
    this.toolbar = h('div', { class: 'oe-tools' },
      ...Object.values(this.modeBtns), snapBtn,
      h('span', { class: 'sep' }),
      tool('ISO', 'Vista isométrica', () => this.view('iso')),
      tool('Frente', 'Vista frontal', () => this.view('front')),
      tool('Topo', 'Vista de cima', () => this.view('top')),
      tool('Lado', 'Vista lateral', () => this.view('side')),
      tool('⤢', 'Enquadrar', () => this.view(this.lastView || 'iso')),
      h('span', { class: 'sep' }),
      tool('Arame', 'Mostrar como arame', () => { this.opts.wire = !this.opts.wire; this.applyWire(); }, 'wire'),
      tool('Cotas', 'Mostrar dimensões totais', () => { this.opts.dims = !this.opts.dims; this.updateDims(); }, 'dims'),
      tool('Vão', 'Mostrar o vão (portas/janelas)', () => { this.opts.opening = !this.opts.opening; if (this.openingBox) this.openingBox.visible = this.opts.opening; }, 'opening'));
    this.empty = h('div', { class: 'oe-empty-stage', hidden: true }, 'O script não gerou nenhuma peça. Use os botões “Inserir” acima do código para começar.');
    this.el.append(this.toolbar, this.dims, this.tip, this.empty);
  }

  mount() {
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true });
    r.setPixelRatio(window.devicePixelRatio);
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.el.prepend(r.domElement);
    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1d232b);
    scene.add(new THREE.HemisphereLight(0xe6eeff, 0x40382c, 1.7));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(3, -4, 6);
    scene.add(sun);
    this.grid = new THREE.GridHelper(20, 40, 0x4a5568, 0x2c333d);
    this.grid.rotation.x = Math.PI / 2;
    scene.add(this.grid, new THREE.AxesHelper(0.5));
    this.cam = new THREE.PerspectiveCamera(40, 1, 0.005, 1000);
    this.cam.up.set(0, 0, 1);
    this.cam.position.set(3, -4, 2.5);
    this.controls = new OrbitControls(this.cam, r.domElement);
    this.controls.enableDamping = true;
    this.group = new THREE.Group();
    this.helpers = new THREE.Group();
    scene.add(this.group, this.helpers);
    this.ray = new THREE.Raycaster();
    this.alive = true;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.el);
    this.resize();
    // gizmo de mover/girar peças
    this.pivot = new THREE.Object3D();
    scene.add(this.pivot);
    this.tc = new TransformControls(this.cam, r.domElement);
    this.tcHelper = this.tc.getHelper();
    scene.add(this.tcHelper);
    this.tc.enabled = false;
    this.tc.addEventListener('dragging-changed', e => { this.controls.enabled = !e.value; });
    this.tc.addEventListener('mouseDown', () => { this.gizmoClick = true; this.beginDrag(); });
    this.tc.addEventListener('objectChange', () => this.dragLive());
    this.tc.addEventListener('mouseUp', () => this.endDrag());
    this.applySnap(true);
    this.setMode(this.mode);
    addEventListener('keydown', this._ctrlDown = e => { if (e.key === 'Control') this.applySnap(false); });
    addEventListener('keyup', this._ctrlUp = e => { if (e.key === 'Control') this.applySnap(this.snap); });

    // eixos com órbita em X/Y/Z
    this.axes = new AxisWidget({ getCamera: () => this.cam, getControls: () => this.controls });
    this.el.append(this.axes.el);

    const loop = () => { if (!this.alive) return; this.controls.update(); this.axes.update(); r.render(scene, this.cam); requestAnimationFrame(loop); };
    loop();

    let down = null;
    r.domElement.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
    r.domElement.addEventListener('pointermove', e => this.hover(e));
    r.domElement.addEventListener('pointerleave', () => this.hover(null));
    r.domElement.addEventListener('pointerup', e => {
      if (this.gizmoClick) { this.gizmoClick = false; return; }
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
      const hit = this.pick(e);
      const line = hit?.object.userData.part?.line;
      if (this.mode === 'select') { if (hit) this.onPick(line); return; }
      this.selectLine(hit ? line : null);
      if (hit) this.onPick(line);
    });
  }

  // ---------------------------------------------------------------- mover / girar

  setMode(mode) {
    this.mode = mode;
    Object.entries(this.modeBtns).forEach(([k, b]) => b.classList.toggle('on', k === mode));
    if (mode === 'select') { this.selectLine(null); this.tc.enabled = false; return; }
    this.tc.setMode(mode);
    this.tc.enabled = true;
    if (this.selLine) this.selectLine(this.selLine);
  }

  /** Encaixe de 1 cm / 5° sobre o deslocamento (Ctrl desliga durante o arraste). */
  applySnap(on) { this.snapNow = on; }

  /** Seleciona todas as peças criadas pela mesma linha e prende o gizmo na origem da chamada. */
  selectLine(line) {
    for (const m of this.selected) m.material.emissive?.setHex(0x000000);
    this.selLine = line || null;
    this.selected = line ? this.group.children.filter(m => m.userData.part?.line === line) : [];
    if (!this.selected.length || this.mode === 'select') { this.tc.detach(); return; }
    for (const m of this.selected) m.material.emissive?.setHex(0x2a6b37);
    const part = this.selected[0].userData.part;
    const origin = new THREE.Vector3(...(part.origin || [0, 0, 0]));
    if (part.cm) origin.applyMatrix4(new THREE.Matrix4().fromArray(part.cm));
    this.pivot.position.copy(origin);
    this.pivot.quaternion.identity();
    this.pivot.updateMatrixWorld(true);
    this.tc.attach(this.pivot);
  }

  beginDrag() {
    this.pivot.updateMatrixWorld(true);
    this.dragStart = { matrix: this.pivot.matrixWorld.clone(), pos: this.pivot.position.clone(), quat: this.pivot.quaternion.clone() };
  }

  dragLive() {
    if (!this.dragStart) return;
    if (this.snapNow) snapPivot(this.pivot, this.dragStart.pos, this.dragStart.quat, 0.01, 5);
    this.pivot.updateMatrixWorld(true);
    const delta = this.pivot.matrixWorld.clone().multiply(this.dragStart.matrix.clone().invert());
    for (const m of this.selected) delta.decompose(m.position, m.quaternion, m.scale);
  }

  endDrag() {
    if (!this.dragStart) return;
    const dT = this.pivot.position.clone().sub(this.dragStart.pos);
    const dq = this.pivot.quaternion.clone().multiply(this.dragStart.quat.clone().invert());
    this.dragStart = null;
    let axis = null, deg = 0;
    const w = Math.min(1, Math.abs(dq.w));
    const angle = 2 * Math.acos(w);
    if (angle > 1e-6) {
      const sinH = Math.sqrt(1 - w * w);
      axis = new THREE.Vector3(dq.x, dq.y, dq.z).divideScalar(sinH || 1).multiplyScalar(Math.sign(dq.w) || 1).normalize();
      deg = angle * 180 / Math.PI;
    }
    if (dT.lengthSq() < 1e-12 && !axis) return;
    const part = this.selected[0]?.userData.part;
    if (!part?.line) return;
    this.onTransform({ line: part.line, cm: part.cm, dT: this.mode === 'translate' ? dT : null, axis, deg, count: this.selected.length });
  }

  resize() {
    if (!this.renderer) return;
    const w = this.el.clientWidth || 600, hh = this.el.clientHeight || 400;
    this.renderer.setSize(w, hh);
    this.cam.aspect = w / hh;
    this.cam.updateProjectionMatrix();
  }

  show(meshes, opening, { keepCamera } = {}) {
    for (const c of [...this.group.children]) { this.group.remove(c); c.geometry?.dispose(); c.material?.dispose?.(); }
    for (const m of meshes) {
      m.material = m.material.clone(); // materiais próprios: arame e destaque não afetam o modelo
      this.group.add(m);
    }
    this.helpers.clear();
    this.openingBox = null;
    if (opening && opening.width > 0 && opening.height > 0) {
      const geo = new THREE.BoxGeometry(opening.width, 0.4, opening.height);
      geo.translate(opening.x || 0, 0, (opening.sill || 0) + opening.height / 2);
      this.openingBox = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xff5a4f, transparent: true, opacity: 0.13, depthWrite: false }));
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0xff5a4f }));
      this.openingBox.add(edges);
      this.openingBox.visible = this.opts.opening;
      this.helpers.add(this.openingBox);
    }
    this.applyWire();
    if (this.selLine && this.mode !== 'select') this.selectLine(this.selLine); else { this.selected = []; this.tc?.detach(); }
    this.empty.hidden = meshes.length > 0;
    this.updateDims();
    if (!keepCamera || !this.framed) { this.view('iso'); this.framed = meshes.length > 0; }
  }

  box() {
    const b = new THREE.Box3();
    this.group.children.forEach(m => b.expandByObject(m));
    return b;
  }

  view(name) {
    this.lastView = name;
    const b = this.box();
    const size = b.isEmpty() ? 2 : b.getSize(new THREE.Vector3()).length() || 2;
    const c = b.isEmpty() ? new THREE.Vector3() : b.getCenter(new THREE.Vector3());
    const dir = { iso: [0.9, -1.2, 0.8], front: [0, -1, 0.08], top: [0, -0.001, 1], side: [1, 0, 0.08] }[name] || [0.9, -1.2, 0.8];
    this.controls.target.copy(c);
    this.cam.position.copy(c).add(new THREE.Vector3(...dir).normalize().multiplyScalar(size * 2));
    const g = Math.max(2, Math.ceil(size * 2));
    this.grid.scale.setScalar(g / 20);
  }

  applyWire() { this.group.children.forEach(m => { m.material.wireframe = this.opts.wire; }); }

  updateDims() {
    this.helpers.children.filter(c => c.userData.dims).forEach(c => this.helpers.remove(c));
    const b = this.box();
    if (b.isEmpty() || !this.opts.dims) { this.dims.hidden = true; return; }
    const s = b.getSize(new THREE.Vector3());
    const helper = new THREE.Box3Helper(b, 0x1fbf3b);
    helper.userData.dims = true;
    this.helpers.add(helper);
    this.dims.hidden = false;
    this.dims.innerHTML = `<b>L</b> ${fmt(s.x)} × <b>P</b> ${fmt(s.y)} × <b>A</b> ${fmt(s.z)} m`;
  }

  pick(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.cam);
    // linhas 2D: tolerância de ~5 px na distância do alvo da câmera
    this.ray.params.Line.threshold = this.cam.position.distanceTo(this.controls.target) * Math.tan(this.cam.fov * Math.PI / 360) * 2 / (r.height || 1) * 5;
    return this.ray.intersectObjects(this.group.children, false)[0] || null;
  }

  hover(e) {
    if (this.hovered) { this.hovered.material.emissive?.setHex(this.selected.includes(this.hovered) ? 0x2a6b37 : 0x000000); this.hovered = null; }
    if (this.tc?.dragging) return;
    if (!e) { this.tip.hidden = true; return; }
    const hit = this.pick(e);
    if (!hit) { this.tip.hidden = true; this.renderer.domElement.style.cursor = ''; return; }
    this.hovered = hit.object;
    this.hovered.material.emissive?.setHex(0x1d4f7a);
    const part = hit.object.userData.part || {};
    const r = this.el.getBoundingClientRect();
    this.tip.innerHTML = `<b>${esc(hit.object.name)}</b>${part.nested ? ` <span class="nest">⧉ ${esc(part.nested)}</span>` : ''}${part.material ? ` · ${esc(part.material)}` : ''}${part.line ? ` · linha ${part.line} <span class="muted">(clique)</span>` : ''}`;
    this.tip.hidden = false;
    Object.assign(this.tip.style, { left: `${e.clientX - r.left + 14}px`, top: `${e.clientY - r.top + 12}px` });
    this.renderer.domElement.style.cursor = part.line ? 'pointer' : '';
  }

  dispose() {
    this.alive = false;
    removeEventListener('keydown', this._ctrlDown);
    removeEventListener('keyup', this._ctrlUp);
    this.tc?.dispose();
    this.ro?.disconnect();
    this.renderer?.dispose();
  }
}

// ---------------------------------------------------------------- editor de código

const KEYWORDS = /^(const|let|var|for|of|in|if|else|return|function|new|while|break|continue|switch|case|default|true|false|null|undefined|Math|typeof)$/;
const TOKEN = /(\/\/.*$)|(\/\*[\s\S]*?(?:\*\/|$))|('(?:\\.|[^'\\])*'?|"(?:\\.|[^"\\])*"?|`(?:\\.|[^`\\])*`?)|(\b\d+(?:\.\d+)?\b)|(\bp\.[A-Za-z_$][\w$]*)|(\bg\.[A-Za-z_$][\w$]*)|([A-Za-z_$][\w$]*)/gm;

function highlightLine(line, state) {
  let out = '', last = 0, src = line;
  if (state.block) {
    const end = src.indexOf('*/');
    if (end < 0) return `<span class="t-com">${esc(src)}</span>`;
    out += `<span class="t-com">${esc(src.slice(0, end + 2))}</span>`;
    src = src.slice(end + 2);
    state.block = false;
    return out + highlightLine(src, state); // continua com o resto da linha
  }
  TOKEN.lastIndex = 0;
  let m;
  while ((m = TOKEN.exec(src))) {
    out += esc(src.slice(last, m.index));
    const [t, com, block, str, num, param, api, word] = m;
    if (com) out += `<span class="t-com">${esc(t)}</span>`;
    else if (block) { out += `<span class="t-com">${esc(t)}</span>`; if (!t.endsWith('*/')) state.block = true; }
    else if (str) out += `<span class="t-str">${esc(t)}</span>`;
    else if (num) out += `<span class="t-num">${t}</span>`;
    else if (param) out += `<span class="t-p">p</span>.<span class="t-param">${esc(t.slice(2))}</span>`;
    else if (api) out += `<span class="t-g">g</span>.<span class="t-api">${esc(t.slice(2))}</span>`;
    else if (word && KEYWORDS.test(word)) out += `<span class="t-kw">${t}</span>`;
    else out += esc(t);
    last = m.index + t.length;
    if (t.length === 0) TOKEN.lastIndex++;
  }
  return out + esc(src.slice(last));
}

class CodeEditor {
  constructor({ value, onChange }) {
    this.onChange = onChange;
    this.errLine = null;
    this.pickLine = null;
    this.gutter = h('div', { class: 'oe-gutter' });
    this.pre = h('pre', { class: 'oe-hl', 'aria-hidden': 'true' });
    this.ta = h('textarea', { class: 'oe-ta', spellcheck: false, autocapitalize: 'off', autocomplete: 'off' }, value);
    this.el = h('div', { class: 'oe-code' }, this.gutter, h('div', { class: 'oe-code-area' }, this.pre, this.ta));
    this.ta.addEventListener('input', () => { this.pickLine = null; this.refresh(); this.onChange(this.ta.value); });
    this.ta.addEventListener('scroll', () => this.syncScroll());
    this.ta.addEventListener('keydown', e => this.onKey(e));
  }

  get value() { return this.ta.value; }

  /** Troca o texto todo (ex.: renomear parâmetro) mantendo o cursor. */
  setValue(v) {
    const pos = this.ta.selectionStart;
    this.ta.value = v;
    this.ta.setSelectionRange(Math.min(pos, v.length), Math.min(pos, v.length));
    this.refresh();
    this.onChange(v);
  }

  refresh() {
    const lines = this.ta.value.split('\n');
    const state = { block: false };
    this.pre.innerHTML = lines.map((ln, i) => {
      const n = i + 1;
      const cls = n === this.errLine ? ' err' : n === this.pickLine ? ' pick' : '';
      return `<span class="ln${cls}">${highlightLine(ln, state) || ' '}</span>`;
    }).join('\n') + '\n';
    this.gutter.innerHTML = lines.map((_, i) => `<div class="${i + 1 === this.errLine ? 'err' : i + 1 === this.pickLine ? 'pick' : ''}">${i + 1}</div>`).join('');
    this.syncScroll();
  }

  syncScroll() {
    this.pre.scrollTop = this.ta.scrollTop;
    this.pre.scrollLeft = this.ta.scrollLeft;
    this.gutter.scrollTop = this.ta.scrollTop;
  }

  setError(line) { this.errLine = line; this.refresh(); }

  /** Insere texto no cursor (entra no desfazer do Ctrl+Z). */
  insert(text) {
    this.ta.focus();
    if (!document.execCommand('insertText', false, text)) this.ta.setRangeText(text, this.ta.selectionStart, this.ta.selectionEnd, 'end');
    this.refresh();
    this.onChange(this.ta.value);
  }

  gotoLine(n, pick = false) {
    const lines = this.ta.value.split('\n');
    if (n < 1 || n > lines.length) return;
    const start = lines.slice(0, n - 1).reduce((s, l) => s + l.length + 1, 0);
    this.ta.focus();
    this.ta.setSelectionRange(start, start + lines[n - 1].length);
    const lh = parseFloat(getComputedStyle(this.ta).lineHeight) || 20;
    this.ta.scrollTop = Math.max(0, (n - 4) * lh);
    if (pick) { this.pickLine = n; this.refresh(); }
  }

  onKey(e) {
    const ta = this.ta;
    if (e.key === 'Tab' && !e.ctrlKey) {
      e.preventDefault();
      if (e.shiftKey) {
        const start = ta.value.lastIndexOf('\n', ta.selectionStart - 1) + 1;
        if (ta.value.startsWith('  ', start)) { ta.setSelectionRange(start, start + 2); this.insert(''); }
      } else this.insert('  ');
    } else if (e.key === 'Enter' && !e.ctrlKey && !e.shiftKey) {
      // mantém a indentação (e aumenta depois de "{")
      e.preventDefault();
      const before = ta.value.slice(0, ta.selectionStart);
      const line = before.slice(before.lastIndexOf('\n') + 1);
      const indent = (line.match(/^\s*/) || [''])[0] + (/[{(\[]\s*$/.test(line) ? '  ' : '');
      this.insert('\n' + indent);
    } else if (e.key === '/' && e.ctrlKey) {
      e.preventDefault();
      const start = ta.value.lastIndexOf('\n', ta.selectionStart - 1) + 1;
      let end = ta.value.indexOf('\n', ta.selectionStart);
      if (end < 0) end = ta.value.length;
      const line = ta.value.slice(start, end);
      ta.setSelectionRange(start, end);
      this.insert(/^\s*\/\/ ?/.test(line) ? line.replace(/^(\s*)\/\/ ?/, '$1') : line.replace(/^(\s*)/, '$1// '));
    }
  }
}

// ---------------------------------------------------------------- ajuda da API

const HELP_HTML = `
<table>
<tr><td><code>g.box(L, P, A, opts)</code></td><td>caixa com a <b>base</b> centrada em (x, y, z)</td></tr>
<tr><td><code>g.cylinder(r, A, { rTop, segments })</code></td><td>cilindro / tronco de cone vertical</td></tr>
<tr><td><code>g.sphere(r, opts)</code></td><td>esfera com centro em (x, y, z)</td></tr>
<tr><td><code>g.extrude([[u,v],…], A, { plane, holes })</code></td><td>perfil extrudado — plane 'xy' sobe em Z, 'xz' avança em Y, 'yz' avança em X</td></tr>
<tr><td><code>g.revolve([[raio,z],…], { segments, angle })</code></td><td>revolução em torno de Z</td></tr>
<tr><td><code>g.at({ x, y, z, rotZ }, () =&gt; { … })</code></td><td>desenha com a origem deslocada/girada</td></tr>
<tr><td><code>g.opening(L, A, { sill, x })</code></td><td>vão que porta/janela abre na parede</td></tr>
<tr><td><code>g.workplane('Eixo A', { x, y, z, rotX, rotY, rotZ })</code></td><td>eixo de trabalho: o plano XY girado/deslocado, com nome (rotX: 90 = vertical)</td></tr>
<tr><td><code>g.line([[u,v],…], { plane, closed, tipo, espessura, color })</code></td><td>linha 2D no plano 'xy' / 'xz' / 'yz' ou no eixo de trabalho (nome); tipo: continua, tracejada, pontilhada, traco-ponto…; espessura em mm</td></tr>
<tr><td><code>g.arc(cu, cv, r, a0, a1, opts)</code> · <code>g.circle(cu, cv, r, opts)</code></td><td>arco (graus, anti-horário) e círculo no plano</td></tr>
<tr><td><code>g.extrude(perfil, A, { plane: 'Eixo A' })</code></td><td>no eixo de trabalho, o perfil sobe na normal dele</td></tr>
<tr><td><code>g.sweep([[x,y,z],…], [[u,v],…], { closed })</code></td><td>perfil varrido ao longo do caminho</td></tr>
<tr><td><code>{ vazio: true }</code></td><td>em box, cylinder, extrude ou sweep: a peça corta as outras do objeto</td></tr>
<tr><td><code>g.object('Nome', { valores }, { x, y, z, rotX, rotY, rotZ })</code></td><td>coloca outro objeto da biblioteca dentro deste; parâmetros de <b>mesmo nome</b> são compartilhados (passam sozinhos), os de <code>valores</code> têm prioridade</td></tr>
<tr><td><code>g.log(…)</code></td><td>mensagem no console</td></tr>
</table>
<p><code>opts = { x, y, z, rotX, rotY, rotZ, material, color, opacity, name }</code> · metros e graus · Z para cima ·
origem = ponto de inserção · <code>p.&lt;nome&gt;</code> = valor do parâmetro. Dê <code>name</code> às peças: aparece ao passar o mouse na prévia.</p>`;
