// PRESETS DE MENUS E JANELAS (por usuário, no banco — /api/presets).
// Um preset guarda:
//   abas ..... as abas da faixa: "Início" (fixa, com os grupos de sempre + os do usuário) e as abas que o usuário
//              cria e nomeia, cada uma com grupos nomeados de comandos e Objetos;
//   janelas .. o arranjo da tela: faixa e barras laterais recolhidas, larguras, aba aberta à direita.
// O seletor fica no canto superior direito; trocar de preset troca menus e janelas de uma vez. Mudanças no
// arranjo das janelas são gravadas no preset ativo.
import { h, modal, toast, dropdown, formDialog, confirmDialog } from './ui.js';
import { rest } from './web/api.js';
import { iconView } from './objects/meta-ui.js';

export const HOME = 'Início'; // nome da aba que os presets antigos tinham fixa (migração)
// grupos de sempre que a migração e o preset padrão colocam na aba Início (os outros ficam para o usuário)
const START_GROUPS = ['Arquivo', 'Modelar', 'Desenho', 'Modificar', 'Vistas'];
const SKETCH_OBJECTS = ['linha', 'retangulo', 'circulo'];
// comandos que chegaram depois que os presets passaram a lembrar os comandos vistos (entram nos presets antigos)
const NEW_COMMANDS = ['ambientes', 'materiais', 'texturas'];

// comandos que viraram Objetos (presets antigos são convertidos)
const AS_OBJECT = { laje: 'laje', pilar: 'pilar', viga: 'viga', caixa: 'caixa', 'parede-coord': 'parede', 'desenhar-parede': 'parede', linha: 'linha', retangulo: 'retangulo', circulo: 'circulo' };

export class Toolbars extends EventTarget {
  constructor(app, commands) {
    super();
    this.app = app;
    this.commands = commands; // id → { label, svg, action, title, drop, bind }
    this.presets = [];
    this.activeId = null;
  }

  get active() { return this.presets.find(p => p.id === this.activeId) || this.presets[0]; }
  get tabs() { return this.active?.dados.abas || []; }
  get layout() { return this.active?.dados.janelas || {}; }

  /** Abas na ordem da faixa (todas do preset; nenhuma é fixa). */
  tabNames() { return this.tabs.map(a => a.nome); }

  groupsOf(tabName) { return this.tabs.find(a => a.nome === tabName)?.grupos || []; }

  async load() {
    const r = await rest('GET', '/api/presets');
    this.presets = r.presets;
    this.activeId = r.ativo;
    let changed = false;
    for (const p of this.presets) {
      p.dados ||= {};
      p.dados.abas ||= [];
      p.dados.janelas ||= {};
      // versão 2: não há mais aba fixa — a aba Início vira comum, com os grupos que ela mostrava fixos
      if (p.dados.versao !== 2) { this.upgrade(p); changed = true; }
      for (const a of p.dados.abas) for (const g of a.grupos) changed = this.migrate(g) || changed;
      changed = this.addNewCommands(p) || changed;
    }
    if (changed) this.save().catch(() => {});
    this.dispatchEvent(new Event('change'));
    this.dispatchEvent(new Event('layout'));
  }

  upgrade(p) {
    let home = p.dados.abas.find(a => a.nome === HOME);
    if (!home) { home = { nome: HOME, grupos: [] }; p.dados.abas.unshift(home); }
    for (const name of START_GROUPS) {
      if (home.grupos.some(g => g.nome === name)) continue;
      const def = (this.defaultGroups || []).find(g => g.nome === name);
      if (!def) continue;
      const g = structuredClone(def);
      if (name === 'Desenho') g.itens = [...SKETCH_OBJECTS.map(id => ({ tipo: 'objeto', id })), ...g.itens];
      home.grupos.push(g);
    }
    p.dados.versao = 2;
  }

  /**
   * Comandos novos do BoxBim entram nos presets já gravados: no grupo de mesmo nome (logo depois do vizinho que
   * eles têm no padrão), ou no fim da primeira aba. O preset lembra os comandos que já viu — um comando que o
   * usuário tirou não volta.
   */
  addNewCommands(p) {
    const all = Object.keys(this.commands);
    const seen = new Set(p.dados.comandosVistos || all.filter(id => !NEW_COMMANDS.includes(id)));
    const fresh = all.filter(id => !seen.has(id));
    const present = new Set(p.dados.abas.flatMap(a => a.grupos.flatMap(g => g.itens.filter(i => i.tipo === 'comando').map(i => i.id))));
    let changed = !p.dados.comandosVistos;
    for (const id of fresh) {
      changed = true;
      if (present.has(id)) continue;
      const def = (this.defaultGroups || []).find(g => g.itens.some(i => i.id === id));
      const group = def && p.dados.abas.flatMap(a => a.grupos).find(g => g.nome === def.nome);
      const item = { tipo: 'comando', id };
      if (group) {
        const di = def.itens.findIndex(i => i.id === id);
        const prev = def.itens.slice(0, di).reverse().find(i => group.itens.some(x => x.id === i.id));
        const at = prev ? group.itens.findIndex(x => x.id === prev.id) + 1 : group.itens.length;
        group.itens.splice(at, 0, item);
      } else if (p.dados.abas[0]) {
        const tab = p.dados.abas[0];
        let g = tab.grupos.find(x => x.nome === (def?.nome || 'Novos'));
        if (!g) { g = { nome: def?.nome || 'Novos', itens: [] }; tab.grupos.push(g); }
        g.itens.push(item);
      }
    }
    p.dados.comandosVistos = all;
    return changed;
  }

  /** Comandos que saíram da faixa viram os objetos correspondentes; os que não existem mais saem. */
  migrate(g) {
    const out = [];
    let changed = false;
    for (const it of g.itens) {
      if (it.tipo === 'comando' && !this.commands[it.id]) {
        changed = true;
        const oid = AS_OBJECT[it.id];
        if (oid && ![...g.itens, ...out].some(x => x.tipo === 'objeto' && x.id === oid)) out.push({ tipo: 'objeto', id: oid });
        continue;
      }
      out.push(it);
    }
    g.itens = out;
    return changed;
  }

  async save() { await rest('PUT', '/api/presets', { presets: this.presets, ativo: this.activeId }); }

  refresh() { this.dispatchEvent(new Event('change')); }

  /** Arranjo das janelas mudou (barra recolhida, largura…): grava no preset ativo (com atraso). */
  setLayout(patch) {
    if (!this.active) return;
    Object.assign(this.active.dados.janelas, patch);
    clearTimeout(this._t);
    this._t = setTimeout(() => this.save().catch(() => {}), 600);
  }

  async activate(id) {
    this.activeId = id;
    await this.save().catch(() => {});
    this.dispatchEvent(new Event('change'));
    this.dispatchEvent(new Event('layout'));
  }

  // ------------------------------------------------------------ botões da faixa

  buttons(group) {
    const out = [];
    for (const it of group.itens) {
      if (it.tipo === 'comando') {
        const c = this.commands[it.id];
        if (!c) continue;
        const b = h('button', { class: `rbtn${c.drop ? ' drop' : ''}`, title: c.title || c.label.replace('\n', ' '), html: c.svg + `<span>${c.label.replace('\n', '<br>')}</span>` });
        b.addEventListener('click', () => c.action(b));
        if (c.bind) c.bind(b);
        out.push(b);
      } else {
        const o = this.app.objects.get(it.id);
        if (!o) continue;
        const ico = iconView(o.icone, 'rbtn-icon') || (o.miniatura ? h('img', { class: 'rbtn-icon', src: o.miniatura, alt: '' }) : h('span', { class: 'rbtn-icon' }, '▣'));
        const b = h('button', { class: 'rbtn obj', title: `${o.name}${o.preco ? ` · ${Number(o.preco).toLocaleString('pt-BR', { style: 'currency', currency: o.moeda || 'BRL' })}/${o.unidade}` : ''}` }, ico, h('span', {}, o.name));
        b.addEventListener('click', () => this.app.placeObject(o));
        out.push(b);
      }
    }
    return out;
  }

  // ------------------------------------------------------------ seletor (canto superior direito)

  menu(anchor) {
    const items = this.presets.map(p => ({ label: `${p.id === this.activeId ? '● ' : '○ '}${p.nome}`, action: () => this.activate(p.id) }));
    dropdown(anchor, [
      ...items,
      '-',
      { label: 'Personalizar menus…', action: () => this.customize() },
      { label: 'Novo preset (cópia deste)…', action: () => this.duplicate() },
      { label: 'Renomear preset…', action: () => this.rename() },
      { label: 'Apagar preset', disabled: this.presets.length <= 1, action: () => this.remove() },
    ]);
  }

  async duplicate() {
    const v = await formDialog('Novo preset', [{ key: 'nome', label: 'Nome', value: `${this.active.nome} (cópia)` }], { ok: 'Criar' });
    if (!v) return;
    const p = { id: crypto.randomUUID(), nome: v.nome.trim() || 'Preset', dados: structuredClone(this.active.dados) };
    this.presets.push(p);
    await this.activate(p.id);
    toast(`Preset "${p.nome}" criado e ativo.`);
  }

  async rename() {
    const v = await formDialog('Renomear preset', [{ key: 'nome', label: 'Nome', value: this.active.nome }], { ok: 'Salvar' });
    if (!v?.nome.trim()) return;
    this.active.nome = v.nome.trim();
    await this.save();
    this.dispatchEvent(new Event('change'));
  }

  async remove() {
    if (this.presets.length <= 1) return;
    if (!(await confirmDialog(`Apagar o preset "${this.active.nome}"?`, { danger: true, ok: 'Apagar' }))) return;
    this.presets = this.presets.filter(p => p !== this.active);
    await this.activate(this.presets[0].id);
  }

  // ------------------------------------------------------------ personalizar menus

  /** Abas (com nome) → grupos (com nome) → comandos e objetos escolhidos, na ordem da faixa. */
  customize() {
    const dados = structuredClone(this.active.dados);
    let tab = 0, grp = 0;
    const tree = h('div', { class: 'tb-sets' });
    const right = h('div', { class: 'tb-edit' });
    const tabs = () => dados.abas;

    const renderTree = () => {
      tree.replaceChildren(h('div', { class: 'section-title' }, 'Abas e grupos'));
      tabs().forEach((a, ti) => {
        tree.append(h('div', { class: `tb-tab${ti === tab && grp < 0 ? ' active' : ''}`, onclick: () => { tab = ti; grp = -1; renderAll(); } }, `▤ ${a.nome}`));
        a.grupos.forEach((g, gi) => tree.append(h('button', { class: `tb-set${ti === tab && gi === grp ? ' active' : ''}`, onclick: () => { tab = ti; grp = gi; renderAll(); } }, g.nome || '(sem nome)')));
        tree.append(h('button', { class: 'mini tb-add', onclick: () => { a.grupos.push({ nome: `Grupo ${a.grupos.length + 1}`, itens: [] }); tab = ti; grp = a.grupos.length - 1; renderAll(); } }, '+ Grupo'));
      });
      tree.append(h('button', { class: 'mini', onclick: () => { tabs().push({ nome: `Aba ${tabs().length + 1}`, grupos: [] }); tab = tabs().length - 1; grp = -1; renderAll(); } }, '+ Aba'));
      tree.append(h('button', { class: 'mini', title: 'Uma aba com cada grupo de ferramentas do BoxBim (para escolher e reorganizar)', onclick: () => {
        for (const g of this.defaultGroups || []) {
          const nome = g.nome;
          if (tabs().some(a => a.nome === nome)) continue;
          tabs().push({ nome, grupos: [structuredClone(g)] });
        }
        renderAll();
      } }, '+ Abas de cada grupo'));
    };

    const renderTab = () => {
      const a = tabs()[tab];
      if (!a) { right.replaceChildren(h('div', { class: 'muted' }, 'Nenhuma aba. Use "+ Aba".')); return; }
      const name = h('input', { value: a.nome, oninput: e => { a.nome = e.target.value; renderTree(); } });
      const move = d => { const j = tab + d; if (j < 0 || j >= tabs().length) return; [tabs()[tab], tabs()[j]] = [tabs()[j], tabs()[tab]]; tab = j; renderAll(); };
      right.replaceChildren(
        h('div', { class: 'row' }, h('label', {}, 'Nome da aba', name),
          h('button', { class: 'mini', onclick: () => move(-1) }, '◀'),
          h('button', { class: 'mini', onclick: () => move(1) }, '▶'),
          h('button', { class: 'mini danger', onclick: () => { tabs().splice(tab, 1); tab = 0; grp = -1; renderAll(); } }, 'Apagar aba')),
        h('p', { class: 'small muted' }, `${a.grupos.length} grupo(s). Use "+ Grupo" na lista para acrescentar. Todas as abas são suas: renomeie, reordene ou apague.`));
    };

    const renderGroup = () => {
      const a = tabs()[tab], g = a.grupos[grp];
      const has = (tipo, id) => g.itens.some(x => x.tipo === tipo && x.id === id);
      const toggle = (tipo, id, on) => { g.itens = on ? [...g.itens, { tipo, id }] : g.itens.filter(x => !(x.tipo === tipo && x.id === id)); renderChosen(); };
      const chosen = h('div', { class: 'tb-chosen' });
      const renderChosen = () => {
        chosen.replaceChildren(...(g.itens.length ? g.itens.map((it, i) => {
          const label = it.tipo === 'comando' ? this.commands[it.id]?.label.replace('\n', ' ') : this.app.objects.get(it.id)?.name;
          return h('div', { class: 'tb-item' }, h('span', {}, label || `(${it.id})`),
            h('button', { class: 'mini', disabled: i === 0, onclick: () => { [g.itens[i - 1], g.itens[i]] = [g.itens[i], g.itens[i - 1]]; renderChosen(); } }, '◀'),
            h('button', { class: 'mini', disabled: i === g.itens.length - 1, onclick: () => { [g.itens[i + 1], g.itens[i]] = [g.itens[i], g.itens[i + 1]]; renderChosen(); } }, '▶'),
            h('button', { class: 'mini danger', onclick: () => { g.itens.splice(i, 1); renderGroup(); } }, '✕'));
        }) : [h('div', { class: 'muted small' }, 'Nada escolhido ainda.')]));
      };
      renderChosen();
      const name = h('input', { value: g.nome, oninput: e => { g.nome = e.target.value; renderTree(); } });
      const moveTo = h('select', { onchange: e => {
        const to = Number(e.target.value);
        if (to === tab) return;
        tabs()[to].grupos.push(...a.grupos.splice(grp, 1));
        tab = to; grp = tabs()[to].grupos.length - 1; renderAll();
      } }, tabs().map((t, i) => h('option', { value: i, selected: i === tab }, t.nome)));
      const filter = h('input', { placeholder: 'Filtrar…', oninput: () => renderLists() });
      const lists = h('div', { class: 'tb-cols' });
      const renderLists = () => {
        const q = filter.value.trim().toLowerCase();
        // rótulos repetidos (IFC de importar e de exportar…) mostram o título completo
        const count = {};
        for (const c of Object.values(this.commands)) count[c.label] = (count[c.label] || 0) + 1;
        const nameOf = c => (count[c.label] > 1 && c.title ? c.title : c.label.replace('\n', ' '));
        const cmds = Object.entries(this.commands).filter(([, c]) => !q || c.label.toLowerCase().includes(q) || (c.title || '').toLowerCase().includes(q))
          .map(([id, c]) => h('label', { class: 'tb-check', title: c.title || '' }, h('input', { type: 'checkbox', checked: has('comando', id), onchange: e => toggle('comando', id, e.target.checked) }), nameOf(c)));
        const objs = this.app.objects.items.filter(o => !o.broken && (!q || o.name.toLowerCase().includes(q)))
          .map(o => h('label', { class: 'tb-check' }, h('input', { type: 'checkbox', checked: has('objeto', o.id), onchange: e => toggle('objeto', o.id, e.target.checked) }), iconView(o.icone, 'obj-icon'), o.name));
        lists.replaceChildren(
          h('div', {}, h('div', { class: 'section-title' }, 'Comandos'), h('div', { class: 'tb-list' }, cmds)),
          h('div', {}, h('div', { class: 'section-title' }, 'Objetos'), h('div', { class: 'tb-list' }, objs)));
      };
      renderLists();
      right.replaceChildren(
        h('div', { class: 'row' }, h('label', {}, 'Nome do grupo', name), h('label', {}, 'Na aba', moveTo),
          h('button', { class: 'mini', disabled: grp === 0, onclick: () => { [a.grupos[grp - 1], a.grupos[grp]] = [a.grupos[grp], a.grupos[grp - 1]]; grp--; renderAll(); } }, '◀'),
          h('button', { class: 'mini', disabled: grp === a.grupos.length - 1, onclick: () => { [a.grupos[grp + 1], a.grupos[grp]] = [a.grupos[grp], a.grupos[grp + 1]]; grp++; renderAll(); } }, '▶'),
          h('button', { class: 'mini danger', onclick: () => { a.grupos.splice(grp, 1); grp = -1; renderAll(); } }, 'Apagar grupo')),
        h('div', { class: 'section-title' }, 'Na ordem da faixa'), chosen,
        filter, lists);
    };

    const renderAll = () => {
      renderTree();
      if (!tabs()[tab]) tab = 0;
      if (grp >= 0 && tabs()[tab]?.grupos[grp]) renderGroup(); else { grp = -1; renderTab(); }
    };
    grp = tabs()[0]?.grupos.length ? 0 : -1;
    renderAll();
    const dlg = modal({
      title: `Personalizar menus — preset "${this.active.nome}"`,
      body: h('div', { class: 'tb-custom' }, tree, right),
      actions: [
        { label: 'Cancelar' },
        { label: 'Salvar', class: 'primary', action: async () => {
          // nomes de aba vazios ou repetidos não podem (a aba é escolhida pelo nome)
          const seen = new Set();
          for (const a of dados.abas) {
            a.nome = a.nome.trim() || 'Aba';
            while (seen.has(a.nome)) a.nome += ' 2';
            seen.add(a.nome);
          }
          this.active.dados.abas = dados.abas;
          try { await this.save(); this.refresh(); toast('Menus salvos no preset.'); } catch (e) { toast(e.message, 'error'); return false; }
        } },
      ],
    });
    dlg.el.classList.add('wide');
  }
}
