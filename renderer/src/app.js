import { Viewer } from './viewer.js';
import { $, $$, h, toast, dropdown, formDialog, confirmDialog, modal, markdown } from './ui.js';
import { importFile, exportFile, importFromRevit, sendToRevit, IMPORT_FORMATS, EXPORT_FORMATS, extOf } from './io/formats.js';
import { ifcPropertySets } from './io/ifc.js';
import { Levels, fmtElev } from './levels.js';
import { ViewManager, ELEVATIONS } from './views.js';
import { LevelEditor } from './levels-edit.js';
import { WorkPlanes } from './workplanes.js';
import { Grips } from './grips.js';
import { createOnLevel, syncLevelNames } from './modeling.js';
import { Chat } from './chat.js';
import { runTool, syncLevels } from './tools.js';
import { Panels } from './panels.js';
import { buildRibbon, COMMANDS } from './ribbon.js';
import { Toolbars } from './toolbars.js';
import { openBudget, quantityOf } from './budget.js';
import { money } from './objects/library-ui.js';
import { WallDrawTool } from './draw.js';
import { SlabTool } from './slab-tool.js';
import { RoofTool } from './roof-tool.js';
import { CopyTool } from './copy-tool.js';
import { MirrorTool } from './mirror-tool.js';
import { editWall, attachToRoof } from './wall-edit.js';
import { TypeLibrary, CATEGORIES } from './types.js';
import { openTypesEditor } from './types-ui.js';
import { setTypeLibrary, setElementType, categoryOf } from './modeling.js';
import { ObjectLibrary, coerceParams, optionList, blankObject } from './objects/objects.js';
import { openLibrary, importObjects, PlaceTool } from './objects/library-ui.js';
import { openObjectEditor } from './objects/editor.js';
import { SystemObjects, SYSTEM } from './objects/system.js';
import { setScriptedBuilder } from './elements.js';
import { RenderMode, renderProps, TEXTURES } from './render.js';
import { Hosting } from './hosting.js';
import { TransformTool } from './transform.js';
import { AxisWidget } from './nav.js';
import { ProjectSession } from './project.js';
import { SketchTool, extrudeSelection, sweepSelection, cutSelection, uncutSelection, offset3dSelection, floorFromSelection } from './sketch/tools.js';
import { fixAllJoints } from './sketch/linear.js';
import { Cuts } from './sketch/cuts.js';
import { setFormMaterialResolver } from './sketch/forms.js';
import { isSketch, rebuildSketch } from './sketch/sketch.js';
import { styleControls, DEFAULT_STYLE } from './sketch/style.js';
import { Guides } from './guides.js';
import { ViewStyles, COLOR_LABELS, DEFAULT_COLORS } from './viewstyle.js';
import { rest, projectId } from './web/api.js';
import { units, setUnit, getUnit, UNITS, toUnit, fromUnit, unitLabel, fmtLen, LENGTH_PROPS } from './units.js';

const B = window.boxbim;

class App {
  async init() {
    if (!projectId) { location.href = '/projetos.html'; return; }
    this.settings = await B.settings.get();
    this.version = await B.version();
    document.title = `BoxBim ${this.version}`;
    $('#version-btn').textContent = `v${this.version}`;
    $('#credits-version').textContent = `v${this.version}`;
    $('#version-btn').addEventListener('click', () => this.showChangelog());
    this.dirs = await B.dirs().catch(() => null); // só o administrador vê as pastas do servidor
    this.info = await B.info();
    this.viewer = new Viewer($('#viewport'));
    this.levels = new Levels();
    this.views = new ViewManager(this.viewer, this.levels, $('#view-tabs'));
    this.levels.addEventListener('change', () => { syncLevelNames(this.viewer, this.levels); this.renderBrowser(); this.refreshTree(); });
    this.views.addEventListener('activate', () => this.onViewActivated());
    this.panels = new Panels(this);
    this.agents = [];
    await this.loadAgents();
    this.chat = new Chat(this);
    await this.panels.renderAll();

    this.viewer.addEventListener('change', () => this.refreshTree());
    this.viewer.addEventListener('select', () => { this.renderProps(); this.highlightTree(); });
    this.bindMenus();
    // tipos com camadas e objetos (famílias paramétricas) — carregados antes das ferramentas
    this.types = new TypeLibrary();
    await this.types.load();
    setTypeLibrary(this.types);
    this.objects = new ObjectLibrary(this.types);
    await this.objects.load();
    // Parede, Laje, Pilar, Viga e Caixa: geometria pelo script do objeto de sistema da biblioteca
    this.system = new SystemObjects(this);
    this.objects.system = this.system;
    setScriptedBuilder(el => this.system.build(el));
    this.placeTool = new PlaceTool(this);
    this.hosting = new Hosting(this);
    this.transformTool = new TransformTool(this);
    this.levelEditor = new LevelEditor(this);
    this.workPlanes = new WorkPlanes(this);
    this.grips = new Grips(this);
    // widget de eixos (orbitar em X/Y/Z) no canto da vista 3D
    const axes = new AxisWidget({ getCamera: () => this.viewer.camera, getControls: () => this.viewer.controls });
    $('.center').append(axes.el);
    this.viewer.frameHooks.push(() => {
      axes.el.hidden = !['3d', 'render'].includes(this.views.active.kind);
      if (!axes.el.hidden) axes.update();
    });
    // desenho 2D (linhas, aparar, estender, canto), sólidos (extrudar, varrer) e corte por vazio
    this.sketchTool = new SketchTool(this);
    this.cuts = new Cuts(this);
    setFormMaterialResolver(name => this.types.material(name));
    this.renderMode = new RenderMode(this); // estilo Render: materiais em tempo real e path tracing
    // grade e ponto base em todas as vistas; estilos (arame, projeto, colorido, transparente, render)
    this.guides = new Guides(this.viewer);
    this.viewStyles = new ViewStyles(this);
    this.views.projectionOf = v => this.viewStyles.projectionOf(v);
    this.wallTool = new WallDrawTool(this);
    this.slabTool = new SlabTool(this);
    this.roofTool = new RoofTool(this);
    this.copyTool = new CopyTool(this);
    this.mirrorTool = new MirrorTool(this);
    // clique duplo numa parede (sem ferramenta ativa): editar a parede e o perfil dela
    this.viewer.renderer.domElement.addEventListener('dblclick', e => {
      if (this.viewer.tool) return;
      const obj = this.viewer.pickAt(e.clientX, e.clientY);
      if (obj?.userData.bim?.wall) { this.viewer.select([obj]); editWall(this, obj); }
    });
    const syncOrtho = () => $('#ortho-btn').classList.toggle('on', this.wallTool.ortho);
    this.wallTool.addEventListener('ortho', syncOrtho);
    syncOrtho();
    $('#ortho-btn').addEventListener('click', () => this.wallTool.toggleOrtho());
    // conjuntos de ferramentas do usuário (o registro de comandos é preenchido pela faixa)
    this.toolbars = new Toolbars(this, COMMANDS);
    buildRibbon(this);
    // presets de menus e janelas (canto superior direito)
    this.toolbars.addEventListener('layout', () => this.applyLayout());
    this.toolbars.addEventListener('change', () => { $('#preset-name').textContent = this.toolbars.active?.nome || 'Preset'; });
    $('#preset-btn').addEventListener('click', e => this.toolbars.menu(e.currentTarget));
    this.bindSidebars();
    await this.toolbars.load().catch(e => console.warn('presets', e));
    this.bindTabs();
    this.bindChatDock();
    this.bindSplitter();
    this.bindDrop();
    $('#btn-settings').addEventListener('click', () => this.panels.openSettings());
    $('#btn-add-level').addEventListener('click', () => this.levelDialog());
    $('#levels-btn').addEventListener('click', () => this.levelEditor.openTable());
    $('#grid-btn').addEventListener('click', () => this.setGrid({ visivel: !this.guides.visible }));
    $('#grid-btn').classList.toggle('on', this.guides.visible);
    // unidade de comprimento do projeto (m, cm, mm): exibição e digitação
    const us = $('#unit-select');
    us.append(...Object.entries(UNITS).map(([k, u]) => h('option', { value: k }, u.label)));
    us.value = getUnit();
    us.addEventListener('change', () => { setUnit(us.value); this.project?.send({ t: 'projeto', dados: { unidade: us.value } }); });
    units.addEventListener('change', () => this.onUnitChanged());
    $('#revit-pill').addEventListener('click', () => this.checkRevit(true));
    $('#tree-filter').addEventListener('input', () => this.refreshTree());
    $$('.viewbar button').forEach(b => b.addEventListener('click', () => b.dataset.view === 'fit' ? this.viewer.fit() : this.viewer.setView(b.dataset.view)));
    $('#agent-select').addEventListener('change', e => this.selectAgent(e.target.value));
    document.addEventListener('keydown', e => {
      if (e.target.matches('input, textarea, select')) return;
      if (e.key === 'Delete' && this.viewer.selected.size) this.deleteSelected();
      if (e.key === 'f' || e.key === 'F') this.viewer.fit(this.viewer.selected.size ? [...this.viewer.selected] : undefined);
      // durante o desenho, F8 é tratado pela ferramenta (fase de captura)
      if (e.key === 'F8') { e.preventDefault(); this.wallTool.toggleOrtho(); }
      if ((e.key === 'w' || e.key === 'W') && !e.ctrlKey && !this.wallTool.active) this.wallTool.start();
      // desenho 2D: L linha, T aparar, E estender (fora de outras ferramentas)
      if (!e.ctrlKey && !this.sketchTool.active && !this.wallTool.active && !this.placeTool.active) {
        if (e.key === 'l' || e.key === 'L') this.sketchTool.start('linha');
        if (e.key === 't' || e.key === 'T') this.sketchTool.start('aparar');
        if (e.key === 'e' || e.key === 'E') this.sketchTool.start('estender');
        if (e.key === 'o' || e.key === 'O') this.sketchTool.start('offset');
      }
      // mover / girar com gizmo (fora das outras ferramentas, que tratam as próprias teclas)
      if (!e.ctrlKey && !this.wallTool.active && !this.placeTool.active) {
        if (e.key === 'm' || e.key === 'M') this.transformTool.start('translate');
        if (e.key === 'r' || e.key === 'R') this.transformTool.start('rotate');
        // Esc: some o gizmo e limpa a seleção (com 'Ao selecionar', ele voltaria na próxima seleção)
        if (e.key === 'Escape' && this.transformTool.mode) { this.transformTool.stop(); this.viewer.select([]); }
      }
      if (e.ctrlKey && e.key.toLowerCase() === 'z' && this.transformTool.history.length) { e.preventDefault(); this.transformTool.undo(); }
      if (e.ctrlKey && e.key.toLowerCase() === 'o') { e.preventDefault(); this.openFiles(); }
    });

    // projeto do servidor: carrega os elementos e liga a sincronização com quem está nele
    this.project = new ProjectSession(this);
    await this.project.open();
    this.renderProjectHead();
    this.viewStyles.apply(); // estilo da vista inicial, já com os elementos do projeto
    this.refreshTree();
    this.renderBrowser();
    this.onViewActivated();
    this.checkRevit();
    setInterval(() => this.checkRevit(), 15000);
    if (!Object.values(this.settings.providers).some(p => p.hasKey)) {
      this.chat.info('Dica: configure uma chave de API (Claude, OpenAI, Gemini…) ou um servidor local (LM Studio, Ollama, llama.cpp) em ⚙ Configurações.');
    }
  }

  status(msg) { $('#status').textContent = msg; }

  // ---------------------------------------------------------------- projeto (servidor)

  /** Topo: nome do projeto, papel, quem está online e o estado da sincronização. */
  renderProjectHead() {
    const p = this.project.info;
    const name = $('#project-name');
    name.textContent = p.nome;
    name.title = `${p.nome} — dono: ${this.project.info.dono?.nome || '?'} · você: ${p.papel}`;
    $('#project-role').textContent = { dono: 'dono', editor: 'editor', leitor: 'somente leitura' }[p.papel];
    $('#project-role').className = `tag role-${p.papel}`;
    $('#btn-share').hidden = p.papel !== 'dono';
    $('#btn-share').onclick = () => this.shareDialog();
    $('#user-name').textContent = this.info.usuario.nome;
  }

  /** Grade do projeto (vale para todos que estão nele). */
  setGrid(patch) {
    if (patch.visivel !== undefined) {
      // mostrar/ocultar é de cada usuário (não muda a vista dos outros)
      this.guides.setVisible(patch.visivel);
      $('#grid-btn').classList.toggle('on', this.guides.visible);
      if (Object.keys(patch).length === 1) return;
    }
    const grade = { espacamento: this.guides.step };
    if (patch.espacamento) grade.espacamento = patch.espacamento;
    this.guides.setOptions(grade);
    this.project?.send({ t: 'projeto', dados: { grade } });
  }

  async gridDialog() {
    const v = await formDialog('Grade', [{ key: 'espacamento', label: `Espaçamento (${unitLabel()})`, type: 'number', value: toUnit(this.guides.step) }], { ok: 'Aplicar' });
    if (v) this.setGrid({ espacamento: fromUnit(v.espacamento) || 1 });
  }

  /** Cores por categoria do estilo Colorido (do projeto). */
  async colorsDialog() {
    const cur = { ...this.viewStyles.colors };
    const pair = { IfcWall: 'IfcWallStandardCase', IfcFurniture: 'IfcFurnishingElement' };
    const rows = Object.entries(COLOR_LABELS).map(([k, label]) => h('label', { class: 'color-row' },
      h('input', { type: 'color', value: cur[k] || DEFAULT_COLORS.outros, oninput: e => { cur[k] = e.target.value; if (pair[k]) cur[pair[k]] = e.target.value; this.viewStyles.setColors(cur); } }), label));
    modal({
      title: 'Cores do estilo Colorido',
      body: h('div', { class: 'color-grid' }, rows),
      actions: [
        { label: 'Padrão', action: () => { this.viewStyles.setColors(DEFAULT_COLORS); this.project?.send({ t: 'projeto', dados: { cores: DEFAULT_COLORS } }); } },
        { label: 'Salvar no projeto', class: 'primary', action: () => this.project?.send({ t: 'projeto', dados: { cores: cur } }) },
      ],
    });
  }

  async newProject() {
    const v = await formDialog('Novo projeto', [{ key: 'nome', label: 'Nome', value: 'Novo projeto' }, { key: 'descricao', label: 'Descrição', value: '' }], { ok: 'Criar' });
    if (!v) return;
    const { projeto } = await rest('POST', '/api/projetos', v);
    location.href = `/app.html?projeto=${projeto.id}`;
  }

  /** Dono: convida pelo e-mail (editor modela junto; leitor só vê) e remove participantes. */
  async shareDialog() {
    const pid = this.project.id;
    const list = h('div', { class: 'members' });
    const render = async () => {
      const r = await rest('GET', `/api/projetos/${pid}`);
      list.innerHTML = '';
      list.append(h('div', { class: 'member' }, h('strong', {}, r.projeto.dono.nome), h('span', { class: 'muted' }, r.projeto.dono.email), h('span', { class: 'tag role-dono' }, 'dono')));
      for (const m of r.membros) {
        const role = h('select', { onchange: async e => { await rest('POST', `/api/projetos/${pid}/membros`, { email: m.email, papel: e.target.value }); toast(`${m.nome}: ${e.target.value}.`); } },
          ['editor', 'leitor'].map(x => h('option', { value: x, selected: x === m.papel }, x === 'editor' ? 'editor (modela)' : 'leitor (só vê)')));
        list.append(h('div', { class: 'member' }, h('strong', {}, m.nome), h('span', { class: 'muted' }, m.email), role,
          h('button', { class: 'mini danger', title: 'Remover do projeto', onclick: async () => { await rest('DELETE', `/api/projetos/${pid}/membros/${m.id}`); render(); } }, '✕')));
      }
    };
    const email = h('input', { type: 'email', placeholder: 'e-mail de quem já tem conta' });
    const papel = h('select', {}, h('option', { value: 'editor' }, 'editor (modela)'), h('option', { value: 'leitor' }, 'leitor (só vê)'));
    const invite = async () => {
      try { await rest('POST', `/api/projetos/${pid}/membros`, { email: email.value, papel: papel.value }); email.value = ''; render(); toast('Convidado. O projeto já aparece na lista dele.'); }
      catch (e) { toast(e.message, 'error'); }
    };
    modal({
      title: `Compartilhar — ${this.project.info.nome}`,
      body: h('div', { class: 'share' },
        h('div', { class: 'row' }, email, papel, h('button', { class: 'primary', onclick: invite }, 'Convidar')),
        h('div', { class: 'small muted' }, `Endereço para os outros abrirem: ${location.origin}/app.html?projeto=${pid}`),
        list),
      actions: [{ label: 'Fechar', class: 'primary' }],
    });
    render();
  }

  /** Indicador de versão (canto inferior direito): mostra o CHANGELOG.md renderizado. */
  async showChangelog() {
    let text;
    try { text = await (await fetch('/api/changelog')).text(); } catch { text = 'CHANGELOG.md não encontrado.'; }
    modal({ title: `BoxBim ${this.version} — novidades`, body: h('div', { class: 'msg assistant changelog', html: markdown(text) }), actions: [{ label: 'Fechar', class: 'primary' }] });
  }

  /** Executa uma ferramenta de agente manualmente (útil no DevTools: app.runTool('scene_summary', {})). */
  runTool(name, args = {}) { return runTool(name, args, this.chat.toolContext()); }

  async saveSettings(patch) {
    this.settings = await B.settings.set(patch);
    this.dirs = await B.dirs().catch(() => null);
    return this.settings;
  }

  // ---------------------------------------------------------------- agentes

  async loadAgents(selectId) {
    this.agents = await B.agents.list();
    if (selectId) await this.saveSettings({ activeAgent: selectId });
    const sel = $('#agent-select');
    sel.innerHTML = '';
    for (const a of this.agents) sel.append(h('option', { value: a.id, selected: a.id === this.settings.activeAgent }, a.name));
    if (!this.agents.find(a => a.id === this.settings.activeAgent) && this.agents[0]) await this.saveSettings({ activeAgent: this.agents[0].id });
    this.updateAgentLabel();
    this.panels.renderAgents();
  }

  currentAgent() { return this.agents.find(a => a.id === this.settings.activeAgent) || this.agents[0]; }

  async selectAgent(id) {
    await this.saveSettings({ activeAgent: id });
    $('#agent-select').value = id;
    this.updateAgentLabel();
    this.panels.renderAgents();
  }

  updateAgentLabel() {
    const a = this.currentAgent();
    const p = a && this.settings.providers[a.provider];
    $('#agent-model').textContent = a ? `${p?.label || a.provider} · ${a.model || p?.model || 'modelo?'}` : '';
  }

  // ---------------------------------------------------------------- menus

  bindMenus() {
    const menus = {
      file: () => [
        { label: 'Meus projetos', action: () => { location.href = '/projetos.html'; } },
        { label: 'Novo projeto…', action: () => this.newProject() },
        { label: 'Compartilhar projeto…', action: () => this.shareDialog(), disabled: this.project?.papel !== 'dono' },
        '-',
        { label: 'Importar arquivo para o projeto…', hint: 'Ctrl+O', action: () => this.openFiles() },
        { label: 'Salvar captura da vista (PNG)…', action: () => this.saveScreenshot() },
        { label: 'Limpar projeto…', action: async () => {
          if (!(await confirmDialog('Apagar todos os elementos do projeto? Os outros participantes também perdem.', { danger: true, ok: 'Apagar tudo' }))) return;
          this.viewer.clear();
        }, disabled: this.project?.readonly },
        '-',
        { label: 'Configurações…', action: () => this.panels.openSettings() },
        { label: 'Sair', action: async () => { await rest('POST', '/api/auth/sair'); location.href = '/login.html'; } },
      ],
      import: () => Object.entries(IMPORT_FORMATS).map(([ext, label]) => ({ label, action: () => this.openFiles([ext]) })),
      export: () => Object.entries(EXPORT_FORMATS).map(([ext, label]) => ({ label, action: () => this.exportAs(ext) })),
      revit: () => [
        { label: 'Verificar conexão com o Revit', action: () => this.checkRevit(true) },
        '-',
        { label: 'Trazer modelo ativo do Revit (IFC)', action: () => this.task('Trazendo do Revit…', () => importFromRevit(this.viewer, { log: m => this.status(m), levels: this.levels })) },
        { label: 'Trazer modelo ativo do Revit (FBX, com materiais)', action: () => this.task('Trazendo do Revit…', () => importFromRevit(this.viewer, { format: 'fbx', log: m => this.status(m), levels: this.levels })) },
        { label: 'Abrir arquivo .rvt no BoxBim…', action: () => this.openFiles(['rvt']) },
        '-',
        { label: 'Enviar projeto ao Revit — vincular (IFC)', action: () => this.task('Enviando ao Revit…', () => sendToRevit(this.viewer, { mode: 'link', log: m => this.status(m), levels: this.levels })) },
        { label: 'Enviar projeto ao Revit — importar geometria (DXF)', action: () => this.task('Enviando ao Revit…', () => sendToRevit(this.viewer, { mode: 'import', format: 'dxf', log: m => this.status(m), levels: this.levels })) },
        { label: 'Enviar projeto ao Revit — abrir como novo projeto do Revit', action: () => this.task('Enviando ao Revit…', () => sendToRevit(this.viewer, { mode: 'open', log: m => this.status(m), levels: this.levels })) },
        { label: 'Salvar como .rvt…', action: () => this.exportAs('rvt') },
        '-',
        { label: 'Trazer níveis do Revit', action: () => this.syncLevelsUI('from_revit') },
        { label: 'Enviar níveis ao Revit (cria plantas)', action: () => this.syncLevelsUI('to_revit') },
        '-',
        { label: 'Revit: exportar projeto ativo para pasta…', action: () => this.revitExportDialog() },
        { label: 'Revit: importar arquivo no projeto ativo…', action: () => this.revitImportDialog() },
      ],
      create: () => [
        { label: 'Nível…', action: () => this.levelDialog() },
        { label: 'Inserir objeto…', action: () => openLibrary(this) },
        { label: 'Tipos e camadas…', action: () => openTypesEditor(this) },
        '-',
        { label: 'Mover', hint: 'M', action: () => this.transformTool.start('translate') },
        { label: 'Girar', hint: 'R', action: () => this.transformTool.start('rotate') },
        { label: 'Desfazer movimento', hint: 'Ctrl+Z', action: () => this.transformTool.undo(), disabled: !this.transformTool.history.length },
        '-',
        { label: this.wallTool.ortho ? 'Desligar ORTO' : 'Ligar ORTO', hint: 'F8', action: () => this.wallTool.toggleOrtho() },
        '-',
        { label: 'Apagar selecionados', hint: 'Del', action: () => this.deleteSelected(), disabled: !this.viewer.selected.size },
      ],
      view: () => [
        { label: 'Vista 3D', action: () => this.views.openView('3d') },
        ...this.levels.list.map(l => ({ label: `Planta de piso: ${l.name}`, hint: fmtElev(l.elevation), action: () => this.views.openView(`plan:${l.id}`) })),
        ...Object.entries(ELEVATIONS).map(([k, e]) => ({ label: `Elevação ${e.name}`, action: () => this.views.openView(`elev:${k}`) })),
        '-',
        ...['iso', 'top', 'front', 'back', 'left', 'right'].map(v => ({ label: `3D: ${{ iso: 'isométrica', top: 'de cima', front: 'frontal', back: 'posterior', left: 'esquerda', right: 'direita' }[v]}`, disabled: this.views.active.kind !== '3d', action: () => this.viewer.setView(v) })),
        '-',
        { label: 'Enquadrar tudo', hint: 'F', action: () => this.viewer.fit() },
        { label: this.guides.visible ? 'Ocultar grade e ponto base' : 'Mostrar grade e ponto base', action: () => this.setGrid({ visivel: !this.guides.visible }) },
        { label: 'Espaçamento da grade…', action: () => this.gridDialog() },
        { label: 'Cores do estilo Colorido…', action: () => this.colorsDialog() },
        { label: 'Mostrar todos os elementos', action: () => { this.viewer.model.traverse(o => { o.visible = true; }); this.refreshTree(); } },
      ],
    };
    $$('[data-menu]').forEach(btn => btn.addEventListener('click', () => dropdown(btn, menus[btn.dataset.menu]())));
  }

  bindTabs() {
    $$('#tabs button[data-tab]').forEach(b => b.addEventListener('click', () => this.showTab(b.dataset.tab)));
  }

  // ---------------------------------------------------------------- Chat IA (barra inferior)

  /** Recolhe/mostra o chat da barra inferior; o estado e a altura vão para o preset ativo. */
  setChat(collapsed, persist = true) {
    $('.center').classList.toggle('chat-collapsed', collapsed);
    if (persist) this.toolbars?.setLayout({ chatRecolhido: collapsed });
    this.viewer?.resize();
  }

  setChatHeight(px, persist = true) {
    const center = $('.center');
    const max = Math.max(140, center.clientHeight - 160);
    const h = Math.round(Math.min(max, Math.max(110, px)));
    center.style.setProperty('--dock-h', `${h}px`);
    if (persist) this.toolbars?.setLayout({ alturaChat: h });
    this.viewer?.resize();
  }

  bindChatDock() {
    $('#chat-toggle').addEventListener('click', () => this.setChat(!$('.center').classList.contains('chat-collapsed')));
    document.addEventListener('keydown', e => {
      if (e.ctrlKey && (e.key === 'j' || e.key === 'J')) { e.preventDefault(); const c = $('.center').classList.contains('chat-collapsed'); this.setChat(!c); if (c) $('#chat-input').focus(); }
    });
    // arrastar a borda de cima muda a altura
    const grip = $('#chat-resize');
    grip.addEventListener('pointerdown', e => {
      e.preventDefault();
      grip.setPointerCapture(e.pointerId);
      const bottom = $('.center').getBoundingClientRect().bottom - 26;
      const move = ev => this.setChatHeight(bottom - ev.clientY, false);
      const up = ev => {
        grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up);
        this.setChatHeight(bottom - ev.clientY, true);
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up);
    });
  }

  showTab(name) {
    if (name === 'chat') { this.setChat(false); $('#chat-input').focus(); return; } // o chat fica na barra inferior
    $$('#tabs button[data-tab]').forEach(x => x.classList.toggle('active', x.dataset.tab === name));
    $$('.tab-body').forEach(x => { x.hidden = x.dataset.body !== name; });
  }

  bindSplitter() {
    const right = $('#right');
    $('#splitter').addEventListener('pointerdown', e => {
      const startX = e.clientX, startW = right.offsetWidth;
      const move = ev => { right.style.width = `${Math.min(900, Math.max(320, startW - (ev.clientX - startX)))}px`; };
      const up = () => {
        removeEventListener('pointermove', move); removeEventListener('pointerup', up);
        this.toolbars?.setLayout({ larguraDireita: right.offsetWidth }); // a largura vai para o preset ativo
      };
      addEventListener('pointermove', move); addEventListener('pointerup', up);
    });
  }

  // ---------------------------------------------------------------- barras laterais e presets de janelas

  /** Recolher/mostrar as barras da esquerda e da direita (como a faixa); o estado vai para o preset ativo. */
  setSidebar(side, collapsed, persist = true) {
    const layout = $('.layout');
    layout.classList.toggle(`${side}-collapsed`, collapsed);
    $(`#${side}-expand`).hidden = !collapsed;
    if (persist) this.toolbars?.setLayout({ [side === 'left' ? 'esquerdaRecolhida' : 'direitaRecolhida']: collapsed });
    this.viewer?.resize();
  }

  bindSidebars() {
    $('#left-toggle').addEventListener('click', () => this.setSidebar('left', true));
    $('#right-toggle').addEventListener('click', () => this.setSidebar('right', true));
    $('#left-expand').addEventListener('click', () => this.setSidebar('left', false));
    $('#right-expand').addEventListener('click', () => this.setSidebar('right', false));
    document.addEventListener('keydown', e => {
      if (!e.ctrlKey || e.target.matches?.('input, textarea, select')) return;
      if (e.key === '[') { e.preventDefault(); this.setSidebar('left', !$('.layout').classList.contains('left-collapsed')); }
      if (e.key === ']') { e.preventDefault(); this.setSidebar('right', !$('.layout').classList.contains('right-collapsed')); }
    });
    $$('#tabs button[data-tab]').forEach(b => b.addEventListener('click', () => this.toolbars?.setLayout({ abaDireita: b.dataset.tab })));
  }

  /** Aplica o arranjo de janelas do preset ativo. */
  applyLayout() {
    const j = this.toolbars.layout;
    this.setSidebar('left', !!j.esquerdaRecolhida, false);
    this.setSidebar('right', !!j.direitaRecolhida, false);
    if (j.larguraDireita) $('#right').style.width = `${Math.min(900, Math.max(320, j.larguraDireita))}px`;
    if (j.abaDireita && $(`#tabs button[data-tab="${j.abaDireita}"]`)) this.showTab(j.abaDireita);
    else this.showTab('props');
    this.setChat(!!j.chatRecolhido, false);
    if (j.alturaChat) this.setChatHeight(j.alturaChat, false);
    $('#preset-name').textContent = this.toolbars.active?.nome || 'Preset';
  }

  bindDrop() {
    const hint = $('#drop-hint');
    const center = $('.center');
    center.addEventListener('dragover', e => { e.preventDefault(); hint.hidden = false; });
    center.addEventListener('dragleave', () => { hint.hidden = true; });
    center.addEventListener('drop', async e => {
      e.preventDefault(); hint.hidden = true;
      for (const f of e.dataTransfer.files) {
        const path = await this.task(`Enviando ${f.name}…`, () => B.pathForFile(f));
        if (path) await this.task(`Importando ${f.name}…`, () => importFile(this.viewer, path, { log: m => this.status(m), levels: this.levels, onProgress: p => this.progress(p) }));
      }
    });
  }

  progress(p) {
    const bar = $('#progress');
    bar.hidden = p === null || p >= 1;
    bar.firstElementChild.style.width = `${Math.round((p || 0) * 100)}%`;
  }

  /** Executa uma operação longa mostrando status e erros. */
  async task(label, fn) {
    this.status(label);
    document.body.style.cursor = 'progress';
    try {
      const r = await fn();
      this.refreshTree();
      return r;
    } catch (e) {
      toast(e.message, 'error');
      this.status('Erro: ' + e.message);
    } finally {
      document.body.style.cursor = '';
      this.progress(null);
    }
  }

  // ---------------------------------------------------------------- arquivos

  async openFiles(exts) {
    const all = Object.keys(IMPORT_FORMATS);
    const paths = await B.dialog.open({
      multi: true,
      filters: exts ? [{ name: IMPORT_FORMATS[exts[0]], extensions: exts }] : [{ name: 'Modelos suportados', extensions: all }, ...all.map(e => ({ name: IMPORT_FORMATS[e], extensions: [e] }))],
    });
    for (const p of paths) {
      await this.task(`Importando ${p.split(/[\\/]/).pop()}…`, () => importFile(this.viewer, p, { log: m => this.status(m), levels: this.levels, onProgress: x => this.progress(x) }));
    }
  }

  async exportAs(format) {
    const path = await B.dialog.save({ defaultPath: `${this.project?.info?.nome || 'projeto'}.${format}`, filters: [{ name: EXPORT_FORMATS[format], extensions: [format] }] });
    if (!path) return;
    const out = await this.task(`Exportando ${format.toUpperCase()}…`, () => exportFile(this.viewer, format, path, { log: m => this.status(m), levels: this.levels }));
    if (out) toast(`Exportado:\n${out}`);
  }

  async saveScreenshot() {
    const path = await B.dialog.save({ defaultPath: 'vista.png', filters: [{ name: 'PNG', extensions: ['png'] }] });
    if (!path) return;
    const data = this.viewer.screenshot().split(',')[1];
    await B.file.write(path, Uint8Array.from(atob(data), c => c.charCodeAt(0)));
    toast('Captura salva.');
  }

  // ---------------------------------------------------------------- Revit

  async checkRevit(verbose) {
    const pill = $('#revit-pill');
    // servidor na nuvem: a ponte com o Revit é do computador do servidor — não fica perguntando (o servidor recusa)
    if (this.info?.local === false) {
      pill.className = 'pill off';
      pill.querySelector('.label').textContent = 'Revit (só local)';
      pill.title = 'A ponte com o Revit funciona quando o BoxBim roda no mesmo computador do Revit (BoxBim.cmd).';
      this.revitOnline = false;
      if (verbose) toast(pill.title, 'error');
      return;
    }
    try {
      const s = await B.revit('/status');
      pill.className = 'pill on';
      pill.querySelector('.label').textContent = s.document ? `Revit · ${s.document.title}` : 'Revit · sem projeto';
      pill.title = `${s.revit} (${s.build}) — ponte na porta ${s.port}`;
      this.revitOnline = true;
      if (verbose) toast(`Conectado ao ${s.revit}.\nDocumento: ${s.document?.title || '(nenhum)'}`);
    } catch (e) {
      pill.className = 'pill off';
      pill.querySelector('.label').textContent = 'Revit offline';
      pill.title = e.message;
      this.revitOnline = false;
      if (verbose) toast(e.message, 'error');
    }
  }

  async revitExportDialog() {
    const v = await formDialog('Revit: exportar projeto ativo', [
      { key: 'format', label: 'Formato', type: 'select', value: 'ifc', options: ['ifc', 'dwg', 'dxf', 'fbx', 'obj', 'stl'] },
      { key: 'ifcVersion', label: 'Versão IFC', type: 'select', value: 'IFC4', options: ['IFC4', 'IFC2X3', 'IFC4RV', 'IFC4DTV'] },
      { key: 'load', label: 'Abrir o resultado no BoxBim', type: 'checkbox', value: true },
    ], { ok: 'Escolher pasta…' });
    if (!v) return;
    const folder = await B.dialog.dir();
    if (!folder) return;
    const r = await this.task('Revit exportando…', () => B.revit('/export', { format: v.format, ifcVersion: v.ifcVersion, folder }));
    if (!r) return;
    toast(`Revit exportou ${r.files.length} arquivo(s) em\n${folder}`);
    const main = r.files.find(f => extOf(f) === v.format);
    if (v.load && main && IMPORT_FORMATS[v.format]) await this.task('Importando…', () => importFile(this.viewer, main, { log: m => this.status(m), levels: this.levels }));
  }

  async revitImportDialog() {
    const [path] = await B.dialog.open({ filters: [{ name: 'Arquivos que o Revit importa', extensions: ['ifc', 'rvt', 'dwg', 'dxf', 'obj', 'stl', 'skp', 'sat', 'step', 'stp', '3dm'] }] });
    if (!path) return;
    const v = await formDialog('Revit: importar no projeto ativo', [
      { key: 'mode', label: 'Modo', type: 'select', value: 'link', options: [{ value: 'link', label: 'Vincular' }, { value: 'import', label: 'Importar' }, { value: 'open', label: 'Abrir como projeto (IFC/RVT)' }] },
    ]);
    if (!v) return;
    const r = await this.task('Revit importando…', () => B.revit('/import', { path, link: v.mode === 'link', open: v.mode === 'open' }));
    if (r) toast('Revit: concluído.');
  }

  // ---------------------------------------------------------------- modelagem

  async createDialog(kind) {
    const lvl = this.views.activeLevel() || this.levels.list[0];
    const levelField = { key: 'level', label: 'Nível', type: 'select', value: lvl.id, options: this.levels.list.map(l => ({ value: l.id, label: `${l.name} (${fmtElev(l.elevation)})` })) };
    const defH = this.levels.heightOf(lvl);
    const forms = {
      wall: ['Parede', [levelField,
        { key: 'x0', label: 'Início X (m)', type: 'number', value: 0 }, { key: 'y0', label: 'Início Y (m)', type: 'number', value: 0 },
        { key: 'x1', label: 'Fim X (m)', type: 'number', value: 5 }, { key: 'y1', label: 'Fim Y (m)', type: 'number', value: 0 },
        { key: 'height', label: 'Altura (m) — padrão até o nível de cima', type: 'number', value: defH }, { key: 'thickness', label: 'Espessura (m)', type: 'number', value: 0.15 },
        { key: 'base', label: 'Deslocamento da base (m)', type: 'number', value: 0 }],
        v => ['wall', { level: v.level, start: [v.x0, v.y0], end: [v.x1, v.y1], height: v.height, thickness: v.thickness, base: v.base }]],
      slab: ['Laje retangular', [levelField,
        { key: 'x', label: 'Canto X (m)', type: 'number', value: 0 }, { key: 'y', label: 'Canto Y (m)', type: 'number', value: 0 },
        { key: 'w', label: 'Largura X (m)', type: 'number', value: 6 }, { key: 'd', label: 'Profundidade Y (m)', type: 'number', value: 4 },
        { key: 'thickness', label: 'Espessura (m)', type: 'number', value: 0.12 }, { key: 'elevation', label: 'Deslocamento do topo (m)', type: 'number', value: 0 }],
        v => ['slab', { level: v.level, points: [[v.x, v.y], [v.x + v.w, v.y], [v.x + v.w, v.y + v.d], [v.x, v.y + v.d]], thickness: v.thickness, elevation: v.elevation }]],
      column: ['Pilar', [levelField,
        { key: 'x', label: 'X (m)', type: 'number', value: 0 }, { key: 'y', label: 'Y (m)', type: 'number', value: 0 },
        { key: 'width', label: 'Largura (m)', type: 'number', value: 0.3 }, { key: 'depth', label: 'Profundidade (m)', type: 'number', value: 0.3 },
        { key: 'height', label: 'Altura (m) — padrão até o nível de cima', type: 'number', value: defH }, { key: 'round', label: 'Circular', type: 'checkbox', value: false }],
        v => ['column', { level: v.level, position: [v.x, v.y], width: v.width, depth: v.depth, height: v.height, round: v.round }]],
      beam: ['Viga', [levelField,
        { key: 'x0', label: 'Início X (m)', type: 'number', value: 0 }, { key: 'y0', label: 'Início Y (m)', type: 'number', value: 0 },
        { key: 'x1', label: 'Fim X (m)', type: 'number', value: 5 }, { key: 'y1', label: 'Fim Y (m)', type: 'number', value: 0 },
        { key: 'width', label: 'Largura (m)', type: 'number', value: 0.15 }, { key: 'height', label: 'Altura (m)', type: 'number', value: 0.4 },
        { key: 'top', label: 'Deslocamento do topo (m)', type: 'number', value: 0 }],
        v => ['beam', { level: v.level, start: [v.x0, v.y0], end: [v.x1, v.y1], width: v.width, height: v.height, top: v.top }]],
      box: ['Caixa / volume', [levelField,
        { key: 'x', label: 'Centro X (m)', type: 'number', value: 0 }, { key: 'y', label: 'Centro Y (m)', type: 'number', value: 0 }, { key: 'z', label: 'Deslocamento da base (m)', type: 'number', value: 0 },
        { key: 'dx', label: 'Tamanho X (m)', type: 'number', value: 1 }, { key: 'dy', label: 'Tamanho Y (m)', type: 'number', value: 1 }, { key: 'dz', label: 'Tamanho Z (m)', type: 'number', value: 1 },
        { key: 'type', label: 'Tipo IFC', type: 'select', value: 'IfcBuildingElementProxy', options: ['IfcBuildingElementProxy', 'IfcFurniture', 'IfcCovering', 'IfcFooting', 'IfcRoof', 'IfcStair'] },
        { key: 'name', label: 'Nome', value: 'Volume' }],
        v => ['box', { level: v.level, position: [v.x, v.y, v.z], size: [v.dx, v.dy, v.dz], type: v.type, name: v.name }]],
    };
    const [title, fields, make] = forms[kind];
    const v = await formDialog(title, fields, { ok: 'Criar' });
    if (!v) return;
    try {
      const [k, args] = make(v);
      const el = createOnLevel(k, args, this.levels);
      this.viewer.add(el);
      this.viewer.select([el]);
      if (this.viewer.elements().length === 1) this.viewer.fit();
    } catch (e) { toast(e.message, 'error'); }
  }

  // ---------------------------------------------------------------- níveis e vistas

  async levelDialog(level) {
    if (level) return this.levelEditor.edit(level); // nível existente: nome, cota (move os elementos junto) e apagar
    const below = this.levels.list.at(-1);
    const v = await formDialog(level ? `Nível: ${level.name}` : 'Novo nível', [
      { key: 'name', label: 'Nome', value: level ? level.name : this.levels.nextName() },
      { key: 'elevation', label: `Cota (${unitLabel()})`, type: 'number', value: toUnit(level ? level.elevation : +((below?.elevation ?? 0) + 3).toFixed(2)) },
    ], { ok: level ? 'Salvar' : 'Criar' });
    if (!v) return;
    v.elevation = fromUnit(v.elevation);
    try {
      if (level) this.levels.update(level.id, v);
      else {
        const l = this.levels.add(v);
        this.views.openView(`plan:${l.id}`);
      }
    } catch (e) { toast(e.message, 'error'); }
  }

  async deleteLevel(level) {
    if (!(await confirmDialog(`Apagar o nível "${level.name}"? As vistas dele serão fechadas; os elementos continuam no projeto.`, { danger: true, ok: 'Apagar' }))) return;
    try { this.levels.remove(level.id); } catch (e) { toast(e.message, 'error'); }
  }

  async syncLevelsUI(direction) {
    if (direction === 'to_revit' && !(await confirmDialog(`Criar/atualizar no projeto ativo do Revit os níveis do BoxBim (${this.levels.list.map(l => l.name).join(', ')}) com plantas de piso?`, { ok: 'Enviar ao Revit' }))) return;
    const r = await this.task(direction === 'to_revit' ? 'Enviando níveis ao Revit…' : 'Trazendo níveis do Revit…', () => syncLevels(direction, this.levels));
    if (!r) return;
    toast(direction === 'to_revit'
      ? `Revit: ${r.created ?? 0} nível(is) criado(s), ${r.updated ?? 0} atualizado(s), ${r.plans ?? 0} planta(s) criada(s).`
      : `${r.levels.length} nível(is) trazido(s) de "${r.from}".`);
  }

  onViewActivated() {
    const v = this.views.active;
    const is3d = v.kind === '3d';
    $$('.viewbar button').forEach(b => { b.hidden = !is3d && b.dataset.view !== 'fit'; });
    const info = $('#view-info');
    const lvl = this.views.activeLevel();
    const r = v.levelId ? this.views.range(v.id) : null;
    info.className = `view-info${is3d ? ' dark' : ''}`;
    info.textContent = is3d ? 'Vista 3D'
      : v.kind === 'elevation' ? `Elevação ${v.name}`
        : `${v.kind === 'plan' ? 'Planta de piso' : 'Planta de forro'} · ${lvl.name} ${fmtElev(lvl.elevation)} · corte ${fmtElev(r.cutHeight)}`;
    this.renderBrowser();
    if (!this.viewer.selected.size) this.renderProps();
  }

  renderBrowser() {
    const root = $('#browser');
    if (!root || !this.views) return;
    const open = new Set([...root.querySelectorAll('details[open]')].map(d => d.dataset.key));
    const first = !root.childElementCount;
    const isOpen = key => first || open.has(key);
    const active = this.views.activeId;
    const node = (id, label, extra) => h('div', {
      class: `node${id === active ? ' active' : ''}`, title: label,
      onclick: () => this.views.openView(id),
    }, label, extra);
    const group = (key, title, icon, children) => h('details', { 'data-key': key, open: isOpen(key) },
      h('summary', {}, h('span', { class: 'ico' }, icon), title), children);

    const lv = this.levels.list;
    root.innerHTML = '';
    root.append(
      group('views', 'Vistas (todas)', '▣', [
        h('div', { style: 'padding-left:12px' },
          group('3d', 'Vistas 3D', '⬡', [node('3d', '{3D}')]),
          group('plans', 'Plantas de piso', '▦', [...lv].reverse().map(l => node(`plan:${l.id}`, l.name))),
          group('ceilings', 'Plantas de forro', '▤', [...lv].reverse().map(l => node(`ceiling:${l.id}`, l.name))),
          group('elevs', 'Elevações (Elevação da construção)', '⌂',
            Object.entries(ELEVATIONS).sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([k, e]) => node(`elev:${k}`, e.name)))),
      ]),
      group('levels', 'Níveis', '≡', [...lv].reverse().map(l => h('div', { class: 'node', title: 'Clique duplo para editar', ondblclick: () => this.levelDialog(l) },
        l.name,
        h('span', { class: 'elev' }, fmtElev(l.elevation)),
        h('span', { class: 'act', title: 'Editar', onclick: e => { e.stopPropagation(); this.levelDialog(l); } }, '✎'),
        h('span', { class: 'act', title: 'Apagar', onclick: e => { e.stopPropagation(); this.deleteLevel(l); } }, '✕')))),
    );
  }

  /** Propriedades da vista ativa (quando nada está selecionado), como no Revit. */
  renderViewProps(root) {
    const v = this.views.active;
    const row = (k, val) => h('tr', {}, h('td', {}, k), h('td', {}, val));
    root.append(h('h4', {}, 'Vista ativa'), h('table', {},
      row('Nome', this.views.label(v)),
      row('Tipo', { '3d': 'Vista 3D', plan: 'Planta de piso', ceiling: 'Planta de forro', elevation: 'Elevação' }[v.kind])));
    if (v.levelId) {
      const lvl = this.levels.get(v.levelId);
      const r = this.views.range(v.id);
      const cut = h('input', { type: 'number', step: 'any', value: toUnit(r.cutHeight), style: 'width:100%' });
      const depth = h('input', { type: 'number', step: 'any', value: toUnit(r.viewDepth), style: 'width:100%' });
      // a faixa é do nível (configuração de corte): vale para as plantas dele e fica no projeto
      const apply = () => { this.views.setRange(v.id, { cutHeight: fromUnit(cut.value), viewDepth: fromUnit(depth.value) }); this.onViewActivated(); };
      cut.addEventListener('change', apply); depth.addEventListener('change', apply);
      root.append(h('h4', {}, 'Faixa da vista'), h('table', {},
        row('Nível associado', `${lvl.name} (${fmtElev(lvl.elevation)})`),
        row(`Plano de corte do nível (${unitLabel()})`, cut),
        row(v.kind === 'plan' ? `Profundidade da vista (${unitLabel()})` : '—', v.kind === 'plan' ? depth : '')));
    }
    root.append(h('div', { class: 'muted small', style: 'margin-top:10px' }, 'Selecione um elemento na vista ou na árvore para ver as propriedades dele.'));
  }

  async deleteSelected() {
    const sel = [...this.viewer.selected];
    if (!sel.length) return;
    if (!(await confirmDialog(`Apagar ${sel.length} elemento(s)?`, { danger: true, ok: 'Apagar' }))) return;
    sel.forEach(o => this.viewer.remove(o));
    this.viewer.select([]);
  }

  // ---------------------------------------------------------------- árvore e propriedades

  refreshTree() {
    clearTimeout(this._treeT);
    this._treeT = setTimeout(() => this.renderTree(), 50);
  }

  renderTree() {
    const tree = $('#tree');
    const filter = $('#tree-filter').value.trim().toLowerCase();
    const els = this.viewer.elements();
    $('#counts').textContent = `${els.length} elemento(s)`;
    tree.innerHTML = '';
    if (!els.length) {
      tree.append(h('div', { class: 'empty' }, 'Projeto vazio. Insira objetos (Inserir objeto), importe um arquivo (Ctrl+O), arraste-o para a vista, traga do Revit ou peça pelo chat.'));
      return;
    }
    // Agrupa por origem (arquivo) e depois por tipo IFC
    const sources = new Map();
    for (const e of els) {
      let src = e;
      while (src.parent && src.parent !== this.viewer.model) src = src.parent;
      const key = src === e ? 'BoxBim (nativo)' : src.name || 'Importado';
      if (!sources.has(key)) sources.set(key, new Map());
      const byType = sources.get(key);
      const t = e.userData.bim.type;
      if (!byType.has(t)) byType.set(t, []);
      byType.get(t).push(e);
    }
    for (const [src, byType] of sources) {
      const total = [...byType.values()].reduce((n, l) => n + l.length, 0);
      const det = h('details', { open: sources.size <= 3 }, h('summary', {}, '📦 ', src, h('span', { class: 'count' }, total)));
      for (const [type, list] of [...byType].sort()) {
        const items = list.filter(e => !filter || `${e.userData.bim.name} ${type}`.toLowerCase().includes(filter));
        if (!items.length) continue;
        const td = h('details', { open: !!filter || byType.size === 1, style: 'padding-left:12px' }, h('summary', {}, type, h('span', { class: 'count' }, items.length)));
        for (const e of items.slice(0, 2000)) {
          const node = h('div', { class: `node${this.viewer.selected.has(e) ? ' sel' : ''}`, 'data-id': e.uuid, title: e.userData.bim.name,
            onclick: ev => this.viewer.select([e], ev.ctrlKey || ev.shiftKey),
            ondblclick: () => this.viewer.fit([e]) },
          e.userData.bim.name || '(sem nome)',
          h('span', { class: 'eye', title: 'Mostrar/ocultar', onclick: ev => { ev.stopPropagation(); e.visible = !e.visible; ev.target.textContent = e.visible ? '👁' : '—'; } }, e.visible ? '👁' : '—'));
          td.append(node);
        }
        if (items.length > 2000) td.append(h('div', { class: 'node muted' }, `… +${items.length - 2000}`));
        det.append(td);
      }
      tree.append(det);
    }
  }

  highlightTree() {
    $$('#tree .node').forEach(n => n.classList.toggle('sel', [...this.viewer.selected].some(o => o.uuid === n.dataset.id)));
  }

  // ---------------------------------------------------------------- objetos e tipos

  openObjectLibrary() { openLibrary(this); }
  openBudget() { openBudget(this); }
  extrude() { return extrudeSelection(this); }
  sweep() { return sweepSelection(this); }
  offset3d() { return offset3dSelection(this); }
  wallsToRoof() { return attachToRoof(this); }
  floorFromLines() { return floorFromSelection(this); }
  async fixJoints() {
    const r = await fixAllJoints(this);
    this.status(`Junções ajustadas: ${r.total} parede(s)/viga(s) verificadas, ${r.tees} ponta(s) em T paradas na face.`);
  }
  cut() { return cutSelection(this); }
  uncut() { return uncutSelection(this); }
  newObject() { openObjectEditor(this, blankObject()); }
  importObjects() { return importObjects(this); }
  openTypes(cat) { openTypesEditor(this, cat); }

  /** Inicia a inserção de um objeto (por definição, id ou nome) com o mouse. */
  /**
   * Cria uma porta/janela hospedada na parede: o parâmetro "espessuraParede" (se existir) recebe a espessura
   * da parede, a instância é alinhada ao eixo e o vão é aberto em todas as camadas.
   */
  async placeHosted(def, values, wall, { offset, flip = false }) {
    const v = { ...values };
    if (def.parameters.some(p => p.name === 'espessuraParede')) v.espessuraParede = wall.userData.bim.wall.thickness;
    const level = this.levels.ofElement(wall);
    const inst = await this.objects.createInstance(def, { values: v, level });
    this.viewer.add(inst);
    try { this.hosting.attach(inst, wall, { offset, flip }); }
    catch (e) { this.viewer.remove(inst); throw e; }
    this.refreshTree();
    return inst;
  }

  placeObject(def, values = {}) {
    const d = typeof def === 'string' ? this.objects.get(def) : def;
    if (!d) return toast('Objeto não encontrado na biblioteca.', 'error');
    // objetos de sistema são criados pelas ferramentas da faixa (desenho da parede, contorno da laje…)
    // desenho 2D (Linha, Retângulo, Círculo): abre a ferramenta de desenho no plano do nível
    const SKETCH = { linha: 'linha', retangulo: 'retangulo', circulo: 'circulo' };
    if (SKETCH[d.sistema]) return this.sketchTool.start(SKETCH[d.sistema]);
    if (d.sistema && SYSTEM[d.sistema]) {
      const tool = SYSTEM[d.sistema].tool;
      if (tool === 'slab') return this.slabTool.start(); // laje: contorno por croqui, linhas, paredes ou sólido
      if (tool === 'roof') return this.roofTool.start(); // telhado: perfil num eixo de trabalho
      return tool === 'wall' ? this.wallTool.start() : this.createDialog(tool);
    }
    this.placeTool.start(d, values);
  }

  /** Regenera as instâncias de um objeto depois que a definição dele mudou. */
  async refreshObjectInstances(objectId) {
    let n = 0;
    const kind = this.objects.get(objectId)?.sistema;
    for (const el of this.viewer.elements()) {
      // instâncias do objeto, de objetos que o têm aninhado dentro e elementos do mesmo tipo de sistema
      const b = el.userData.bim;
      if (b.objectId !== objectId && !b.nested?.includes(objectId) && !(kind && b.sistema === kind)) continue;
      try {
        await this.objects.regenerate(el);
        if (!b.sistema) this.hosting.sync(el);
        n++;
      } catch (e) { toast(e.message, 'error'); }
    }
    if (n) { this.viewer.changed(); this.renderProps(); }
    return n;
  }

  /** Tipo (com camadas) do elemento selecionado: seletor + tabela de camadas. */
  renderTypeProps(root, o) {
    const cat = categoryOf(o);
    if (!cat) return;
    const b = o.userData.bim;
    const sel = h('select', { style: 'width:100%', onchange: async e => {
      try {
        setElementType(o, e.target.value || null);
        this.viewer._prepare2D(o);
        // portas/janelas hospedadas acompanham a nova espessura
        if (cat === 'wall') await this.hosting.refreshHostedOf(o);
        this.viewer.changed();
        this.renderProps();
      } catch (err) { toast(err.message, 'error'); }
    } },
    h('option', { value: '', selected: !b.typeId }, '(genérico, sem camadas)'),
    this.types.list(cat).map(t => h('option', { value: t.id, selected: t.id === b.typeId }, t.name)));
    const layers = b.layers || [];
    root.append(h('h4', {}, `Tipo — ${CATEGORIES[cat].label}`),
      h('table', {}, h('tr', {}, h('td', {}, 'Tipo'), h('td', {}, sel))),
      layers.length ? h('table', { class: 'layers-table' }, layers.map((l, i) => h('tr', {},
        h('td', {}, h('span', { class: 'swatch', style: `background:${this.types.materials[l.material]?.color || '#ccc'}` }), l.name),
        h('td', {}, `${l.material} · ${(cat === 'column' || cat === 'beam') && i === 0 ? 'núcleo' : `${(l.thickness * 100).toFixed(1).replace('.', ',')} cm`}`)))) : null,
      h('button', { class: 'mini', style: 'margin-top:6px', onclick: () => openTypesEditor(this, cat) }, 'Editar tipos e camadas…'));
  }

  /** Vista Render: materiais do elemento com cor, rugosidade, metal, textura, escala e vidro — ao vivo. */
  renderMaterialProps(root, o) {
    const rm = this.renderMode;
    if (!rm?.active) return;
    const names = rm.materialsOf(o);
    if (!names.length) return;
    root.append(h('h4', {}, 'Materiais (render)'));
    for (const name of names) {
      const def = this.types.materials[name];
      const p = renderProps(name, def);
      const set = (k, v) => rm.setMaterialProp(name, k, v);
      const slider = (k, label, min, max, step) => {
        const out = h('span', { class: 'muted' }, String(p[k]));
        return h('tr', {}, h('td', {}, label), h('td', {}, h('input', { type: 'range', min, max, step, value: p[k],
          oninput: e => { out.textContent = e.target.value; set(k, Number(e.target.value)); } }), out));
      };
      root.append(h('div', { class: 'render-mat' },
        h('div', { class: 'rm-head' },
          h('input', { type: 'color', value: def.color || '#cccccc', title: 'Cor', style: 'width:28px;padding:0', oninput: e => set('color', e.target.value) }), name),
        h('table', {},
          slider('rugosidade', 'Rugosidade', 0, 1, 0.01),
          slider('metal', 'Metal', 0, 1, 0.01),
          slider('transmissao', 'Vidro (transmissão)', 0, 1, 0.01),
          h('tr', {}, h('td', {}, 'Textura'), h('td', {}, h('select', { style: 'width:100%', onchange: e => set('textura', e.target.value) },
            Object.entries(TEXTURES).map(([k, l]) => h('option', { value: k, selected: k === p.textura }, l))))),
          h('tr', {}, h('td', {}, 'Escala (m)'), h('td', {}, h('input', { type: 'number', step: 0.05, min: 0.05, value: p.escala, style: 'width:100%',
            onchange: e => set('escala', Math.max(0.05, Number(e.target.value) || 1)) }))))));
    }
    root.append(h('div', { class: 'muted', style: 'font-size:11px' }, 'Vale para todos os elementos com o material; fica gravado na biblioteca de tipos.'));
  }

  /** Parâmetros de uma instância de Objeto, editáveis (regenera a geometria ao mudar). */
  renderObjectProps(root, o) {
    const b = o.userData.bim;
    if (!b.objectId && !b.sistema) return;
    const sys = b.sistema && SYSTEM[b.sistema];
    const def = sys ? this.system.defFor(b.sistema) : (this.objects.get(b.objectId) || this.objects.get(b.objectName));
    if (!def) { root.append(h('h4', {}, 'Objeto'), h('div', { class: 'muted' }, `"${b.objectName || b.sistema}" não está na biblioteca (geometria padrão).`)); return; }
    const values = coerceParams(def, sys ? this.system.values(o, def) : b.params);
    const apply = async (name, v) => {
      try {
        if (sys) {
          // parâmetro dirigido (comprimento, altura…) muda os dados do elemento; os demais ficam na instância
          await this.system.setParam(o, name, v);
          if (b.wall) await this.hosting.refreshHostedOf(o);
          this.renderProps();
        } else {
          await this.objects.regenerate(o, { [name]: v });
          this.hosting.sync(o); // vão da parede acompanha as novas dimensões
        }
        this.viewer._prepare2D(o);
        this.viewer.changed();
      } catch (e) { toast(e.message, 'error'); }
    };
    const params = def.parameters.filter(p => !(sys?.driven[p.name]?.hidden));
    const rows = params.map(p => {
      let input;
      if (p.type === 'booleano') input = h('input', { type: 'checkbox', checked: !!values[p.name], onchange: e => apply(p.name, e.target.checked) });
      else if (p.type === 'opcao') input = h('select', { onchange: e => apply(p.name, e.target.value) }, optionList(p).map(x => h('option', { value: x, selected: x === values[p.name] }, x)));
      else if (p.type === 'material') input = h('select', { onchange: e => apply(p.name, e.target.value) }, Object.keys(this.types.materials).map(m => h('option', { value: m, selected: m === values[p.name] }, m)));
      else if (p.type === 'cor') input = h('input', { type: 'color', value: values[p.name] || '#cccccc', onchange: e => apply(p.name, e.target.value) });
      else if (p.type === 'texto') input = h('input', { value: values[p.name], onchange: e => apply(p.name, e.target.value) });
      else input = h('input', { type: 'number', step: p.type === 'inteiro' ? 1 : 'any', min: p.min, max: p.max, value: values[p.name], onchange: e => apply(p.name, e.target.value) });
      input.style.width = '100%';
      // espessura vem do tipo com camadas: só leitura
      if (sys?.driven[p.name]?.typed && b.layers?.length) { input.disabled = true; input.title = 'Definida pelas camadas do tipo'; }
      return h('tr', {}, h('td', {}, `${p.label || p.name}${p.type === 'comprimento' ? ' (m)' : p.type === 'angulo' ? ' (°)' : ''}`), h('td', {}, input));
    });
    // hospedado: posição ao longo da parede e lado; solto: rotação livre
    let placement = [];
    const host = b.host && this.viewer.findById(b.host.wallId);
    if (sys) { /* posição pelos dados do elemento (eixo, contorno) e pelo gizmo */ } else if (host) {
      const rehost = patch => {
        try { this.hosting.attach(o, host, { ...b.host, ...patch }); this.renderProps(); }
        catch (e) { toast(e.message, 'error'); }
      };
      placement = [
        h('tr', {}, h('td', {}, 'Hospedeiro'), h('td', {}, host.name)),
        h('tr', {}, h('td', {}, 'Centro do vão (m do início)'), h('td', {}, h('input', { type: 'number', step: 0.05, value: b.host.offset, style: 'width:100%',
          onchange: e => rehost({ offset: Number(e.target.value) || 0 }) }))),
        h('tr', {}, h('td', {}, 'Inverter lado'), h('td', {}, h('input', { type: 'checkbox', checked: !!b.host.flip, onchange: e => rehost({ flip: e.target.checked }) }))),
      ];
    } else {
      const rot = h('input', { type: 'number', step: 15, value: Math.round(o.rotation.z * 180 / Math.PI), style: 'width:100%',
        onchange: e => { o.rotation.z = (Number(e.target.value) || 0) * Math.PI / 180; this.viewer.changed(); } });
      placement = [h('tr', {}, h('td', {}, 'Rotação (°)'), h('td', {}, rot))];
    }
    if (def.preco !== null && def.preco !== undefined) {
      const u = def.unidade || 'un', q = quantityOf(o, u);
      placement = [...placement,
        h('tr', {}, h('td', {}, 'Preço unitário'), h('td', {}, `${money(def.preco, def.moeda)} / ${u}`)),
        h('tr', {}, h('td', {}, 'Quantidade'), h('td', {}, `${(Math.round(q * 100) / 100).toLocaleString('pt-BR')} ${u}`)),
        h('tr', {}, h('td', {}, 'Total'), h('td', {}, h('strong', {}, money(q * def.preco, def.moeda))))];
    }
    root.append(h('h4', {}, `Objeto${sys ? ' de sistema' : ''} — ${def.name}`),
      h('table', {}, rows, placement),
      h('div', { style: 'display:flex;gap:4px;margin-top:6px' },
        h('button', { class: 'mini', onclick: () => openObjectEditor(this, def) }, 'Editar objeto…'),
        h('button', { class: 'mini', onclick: () => this.placeObject(def, values) }, 'Inserir outro igual')));
  }

  /** A unidade mudou (aqui ou por outro usuário): refaz rótulos, barras e painéis. */
  onUnitChanged() {
    $('#unit-select').value = getUnit();
    this.views.refresh();
    this.onViewActivated();
    this.renderProps();
    if (this.transformTool.bar?.isConnected) this.transformTool.buildBar();
    if (this.sketchTool.active) { const m = this.sketchTool.mode; this.sketchTool.stop(); this.sketchTool.start(m); }
    this.status(`Unidade de comprimento: ${unitLabel()}.`);
  }

  /** Tipo, espessura e cor das linhas 2D selecionadas. */
  renderLineStyle(root, els) {
    const apply = patch => {
      for (const e of els) {
        const l = e.userData.bim.linha;
        l.estilo = { ...DEFAULT_STYLE, ...(l.estilo || {}), ...patch };
        rebuildSketch(e);
        if (this.viewer.selected.has(e)) this.viewer._highlight(e, true);
      }
      this.viewer.changed();
    };
    root.append(h('h4', {}, els.length > 1 ? `Estilo das ${els.length} linhas` : 'Estilo da linha'),
      h('div', { class: 'style-form' }, ...styleControls(els[0].userData.bim.linha.estilo, apply)));
  }

  async renderProps() {
    const root = $('#props');
    const sel = [...this.viewer.selected];
    root.innerHTML = '';
    if (!sel.length) { this.renderViewProps(root); return; }
    if (sel.length > 1) {
      root.append(h('div', {}, `${sel.length} elementos selecionados.`));
      if (sel.every(isSketch)) this.renderLineStyle(root, sel); // muda o estilo de todas as linhas de uma vez
      return;
    }
    const o = sel[0];
    const b = o.userData.bim || {};
    // comprimentos na unidade do projeto (os dados ficam em metros)
    const row = (k, v) => h('tr', {}, h('td', {}, k), h('td', {}, typeof v === 'number' && LENGTH_PROPS.has(k) ? fmtLen(v, { suffix: true }) : typeof v === 'object' ? JSON.stringify(v) : String(v)));
    const nameInput = h('input', { value: b.name || '', style: 'width:100%', onchange: e => { b.name = o.name = e.target.value; this.refreshTree(); } });
    root.append(
      h('h4', {}, 'Identidade'),
      h('table', {}, h('tr', {}, h('td', {}, 'Nome'), h('td', {}, nameInput)), row('Tipo IFC', b.type), row('Nível', this.levels.ofElement(o).name), row('GUID', b.guid), row('ID BoxBim', o.uuid)),
    );
    if (b.eixo) root.append(...this.workPlanes.propsSection(o));
    if (b.linha) this.renderLineStyle(root, [o]);
    if (b.wall) root.append(h('h4', {}, 'Parede'), h('div', { class: 'row-buttons' },
      h('button', { onclick: () => editWall(this, o), title: 'Também com clique duplo na parede' }, 'Editar parede e perfil…'),
      h('button', { onclick: () => attachToRoof(this, [o]), title: 'Topo pela face de baixo do telhado acima' }, '⌂ Até o telhado')));
    this.renderTypeProps(root, o);
    this.renderObjectProps(root, o);
    this.renderMaterialProps(root, o);
    root.append(
      h('h4', {}, 'Propriedades'),
      h('table', {}, Object.entries(b.props || {}).map(([k, v]) => row(k, v))),
    );
    const psets = await ifcPropertySets(o);
    if (psets && this.viewer.selected.has(o)) {
      for (const [name, props] of Object.entries(psets)) {
        root.append(h('h4', {}, name), h('table', {}, Object.entries(props).map(([k, v]) => row(k, v))));
      }
    }
  }
}

const app = new App();
window.app = app;
app.init().catch(e => { console.error(e); toast('Falha ao iniciar: ' + e.message, 'error'); });
