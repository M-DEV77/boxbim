// Barra de ferramentas superior (faixa de opções no estilo do Revit), recolhível.
// Ferramentas parecidas ficam juntas num BOTÃO DE FAMÍLIA: o clique repete a última usada (o botão mostra qual) e
// a seta ▾ abre a lista com as outras. Os comandos continuam existindo um a um (presets e Personalizar menus).
import { $, h, dropdown, toast } from './ui.js';
import { editFloor } from './floor-edit.js';
import { importFromRevit, sendToRevit } from './io/formats.js';
import { fmtElev } from './levels.js';

import { icon } from './icons.js';

const slug = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Comandos da faixa (id → rótulo, ícone, ação): os grupos fixos e os conjuntos de ferramentas do usuário usam. */
export const COMMANDS = {};

const store = (k, v) => { try { localStorage.setItem(k, v); } catch { /* sem armazenamento */ } };
const load = k => { try { return localStorage.getItem(k); } catch { return null; } };

/** Botão de uma família: mostra a última ferramenta usada; ▾ (ou família só de menu) lista as outras. */
function familyButton(fid) {
  const f = COMMANDS[fid];
  const key = `boxbim.familia.${fid}`;
  const current = () => { const id = load(key); return f.family.includes(id) ? id : f.family[0]; };
  const b = h('button', { class: 'rbtn split' });
  const caret = h('span', { class: 'caret', title: `Mais: ${f.label.replace('\n', ' ')}` }, '▾');
  const paint = () => {
    const c = f.menuOnly ? f : COMMANDS[current()];
    b.innerHTML = c.svg + `<span>${c.label.replace('\n', '<br>')}</span>`;
    b.append(caret);
    const others = f.family.map(id => COMMANDS[id].label.replace('\n', ' ')).join(' · ');
    b.title = f.menuOnly ? `${f.title} — ${others}` : `${c.title}\n▾ ${f.label.replace('\n', ' ')}: ${others}`;
  };
  const run = id => { if (!f.menuOnly) store(key, id); paint(); COMMANDS[id].action(b); };
  const menu = () => dropdown(b, f.family.map(id => {
    const c = COMMANDS[id];
    return { label: c.menu || c.label.replace('\n', ' '), icon: c.svg, hint: c.hint, action: () => run(id) };
  }));
  b.addEventListener('click', e => { if (f.menuOnly || e.target.closest('.caret')) menu(); else run(current()); });
  b.dataset.cmd = fid;
  paint();
  return b;
}

export function buildRibbon(app) {
  const tb = app.toolbars;
  const log = m => app.status(m);
  const L = () => app.levels;
  /** Registra um comando (sem botão): usado sozinho, em família ou nos presets. */
  const cmd = (label, ic, action, { title, drop, id, bind, menu, hint } = {}) => {
    const cid = id || slug(title || label);
    COMMANDS[cid] = { label, svg: icon(ic), action, title: title || label.replace('\n', ' '), drop, bind, menu, hint };
    return cid;
  };
  const button = cid => {
    const c = COMMANDS[cid];
    if (c.family) return familyButton(cid);
    const b = h('button', { class: `rbtn${c.drop ? ' drop' : ''}`, title: c.title, html: c.svg + `<span>${c.label.replace('\n', '<br>')}</span>` });
    b.addEventListener('click', () => c.action(b));
    c.bind?.(b);
    b.dataset.cmd = cid;
    return b;
  };
  /** Família de ferramentas parecidas (menuOnly: o clique sempre abre a lista, ex.: vistas e Revit). */
  const fam = (id, label, ic, members, { title, menuOnly } = {}) => {
    COMMANDS[id] = { label, svg: icon(ic), title: title || label.replace('\n', ' '), family: members, menuOnly, render: () => familyButton(id),
      action: b => dropdown(b, members.map(m => ({ label: COMMANDS[m].menu || COMMANDS[m].label.replace('\n', ' '), icon: COMMANDS[m].svg, action: () => COMMANDS[m].action(b) }))) };
    return familyButton(id);
  };

  const group = (title, ...buttons) => h('div', { class: 'rgroup' }, h('div', { class: 'rbtns' }, buttons), h('div', { class: 'rtitle' }, title));

  // menus de escolha de vista por nível
  const levelMenu = (b, kind) => dropdown(b, [...L().list].reverse().map(l => ({
    label: l.name, hint: fmtElev(l.elevation), action: () => app.views.openView(`${kind}:${l.id}`),
  })));
  const elevMenu = b => dropdown(b, [
    ...app.views.elevations().map(e => ({ label: e.nome, action: () => app.views.openView(`elev:${e.id}`) })),
    '-', { label: 'Elevações…', hint: 'criar, nomear, profundidade', action: () => app.display.elevationsDialog() },
  ]);
  const revit = (label, fn) => app.task(label, fn);

  // ORTO: botão que fica aceso enquanto o modo está ligado
  const bindOrtho = b => { const sync = () => b.classList.toggle('on', app.wallTool.ortho); app.wallTool.addEventListener('ortho', sync); sync(); };

  // ---------------- comandos (um a um; os ids continuam os mesmos dos presets gravados)
  const C = {
    abrir: cmd('Abrir', 'open', () => app.openFiles(), { title: 'Abrir / importar arquivo (Ctrl+O)', menu: 'Abrir / importar…', hint: 'Ctrl+O' }),
    impIfc: cmd('Importar\nIFC', 'ifc', () => app.openFiles(['ifc']), { title: 'Importar IFC', menu: 'IFC' }),
    impDwg: cmd('Importar\nDWG', 'dwg', () => app.openFiles(['dwg']), { title: 'Importar DWG', menu: 'DWG' }),
    impDxf: cmd('Importar\nDXF', 'dxf', () => app.openFiles(['dxf']), { title: 'Importar DXF', menu: 'DXF' }),
    impFbx: cmd('Importar\nFBX', 'fbx', () => app.openFiles(['fbx']), { title: 'Importar FBX', menu: 'FBX' }),
    impDae: cmd('Importar\nCollada', 'dae', () => app.openFiles(['dae']), { title: 'Importar Collada', menu: 'Collada (.dae)' }),
    abrirRvt: cmd('Abrir\n.rvt', 'rvt', () => app.openFiles(['rvt']), { menu: 'Revit (.rvt)' }),
    expIfc: cmd('Exportar\nIFC', 'ifc', () => app.exportAs('ifc'), { title: 'Exportar IFC', menu: 'IFC' }),
    expDwg: cmd('Exportar\nDWG', 'dwg', () => app.exportAs('dwg'), { title: 'Exportar DWG', menu: 'DWG' }),
    expFbx: cmd('Exportar\nFBX', 'fbx', () => app.exportAs('fbx'), { title: 'Exportar FBX', menu: 'FBX' }),
    expDae: cmd('Exportar\nCollada', 'dae', () => app.exportAs('dae'), { title: 'Exportar Collada', menu: 'Collada (.dae)' }),
    expGlb: cmd('Exportar\nglTF', 'glb', () => app.exportAs('glb'), { title: 'Exportar glTF', menu: 'glTF (.glb)' }),
    salvarRvt: cmd('Salvar\n.rvt', 'rvt', () => app.exportAs('rvt'), { menu: 'Revit (.rvt)' }),
    captura: cmd('Captura', 'shot', () => app.saveScreenshot(), { title: 'Salvar a vista atual como PNG', menu: 'Imagem da vista (PNG)' }),

    inserir: cmd('Inserir\nobjeto', 'object', () => app.openObjectLibrary(), { id: 'inserir-objeto', title: 'Inserir um Objeto da biblioteca (parede, piso, pilar, viga, caixa, portas, móveis…)' }),
    ambientes: cmd('Ambientes', 'layers', () => app.envs.openManager(), { id: 'ambientes', title: 'Ambientes e camadas do projeto (administrador): nomes, camadas e os desenhos de cada uma' }),
    telhado: cmd('Telhado', 'roof', () => app.roofTool.start(), { id: 'telhado', title: 'Telhado: desenhe o perfil num eixo de trabalho vertical e extrude; tipo com camadas (telha, ripas, caibros…)' }),
    laje: cmd('Piso', 'slab', () => app.slabTool.start(), { id: 'laje-contorno', title: 'Piso: contorno por croqui 2D, linhas 2D, paredes (face externa/interna/eixo) ou face de sólido; contornos internos viram furos', menu: 'Piso por contorno' }),
    editarPiso: cmd('Editar\npiso', 'slab', () => { const o = [...app.viewer.selected].find(x => x.userData.bim?.slab); if (o) editFloor(app, o); else toast('Selecione um piso (ou dê clique duplo nele).', 'error'); }, { id: 'editar-piso', title: 'Editar o piso selecionado: nome, tipo, cota do topo e as linhas do contorno e dos furos (como Editar parede)', menu: 'Editar piso e linhas' }),
    pontosPiso: cmd('Pontos do\npiso', 'floorPoints', () => app.floorPoints.start(), { id: 'pontos-piso', title: 'Pontos do piso selecionado: arrastar, colocar no meio dos lados (+), apagar (botão direito), altura de cada ponto e pontos internos de forma (rampas, caimentos)', menu: 'Editar pontos do piso' }),
    pisoLinhas: cmd('Piso das\nlinhas', 'floorLines', () => app.floorFromLines(), { id: 'piso-linhas', title: 'Piso a partir das linhas 2D selecionadas — contornos fechados horizontais, ex.: tiradas das quinas dos sólidos' }),
    ortho: cmd('Orto', 'ortho', () => app.wallTool.toggleOrtho(), { id: 'ortho', title: 'ORTO: trava o ângulo em 0°/90° (F8)', bind: bindOrtho }),
    nivel: cmd('Nível', 'level', () => app.levelDialog(), { title: 'Novo nível', menu: 'Novo nível' }),
    editarNiveis: cmd('Editar\nníveis', 'levelEdit', () => app.levelEditor.openTable(), { id: 'editar-niveis', title: 'Editar níveis: nomes e cotas (em qualquer vista; nas elevações e no 3D também arrastando a linha)' }),

    eixo: cmd('Eixo de\ntrabalho', 'workplane', () => app.workPlanes.openCreate(), { id: 'eixo-trabalho', title: 'Novo eixo de trabalho (plano de desenho vertical ou horizontal); o novo fica ativo para desenhar', menu: 'Novo eixo de trabalho' }),
    planoNivel: cmd('Plano do\nnível', 'workplaneOff', () => app.workPlanes.activate(null), { id: 'plano-nivel', title: 'Volta a desenhar no plano do nível da vista (desativa o eixo de trabalho)', menu: 'Voltar ao plano do nível' }),
    selecao: cmd('Seleção', 'select', () => app.sketchTool.start('selecao'), { id: 'selecao', title: 'Seleção: clique, janela (arraste →) ou cruzamento (arraste ←)' }),
    aparar: cmd('Aparar', 'trim', () => app.sketchTool.start('aparar'), { id: 'aparar', title: 'Aparar linhas (T)', hint: 'T' }),
    estender: cmd('Estender', 'extend', () => app.sketchTool.start('estender'), { id: 'estender', title: 'Estender linhas (E)', hint: 'E' }),
    canto: cmd('Canto', 'fillet', () => app.sketchTool.start('canto'), { id: 'canto', title: 'Canto entre duas linhas: vivo, arredondado (raio) ou chanfro (graus)', menu: 'Canto (vivo, raio, chanfro)' }),
    offset2d: cmd('Offset', 'offset2d', () => app.sketchTool.start('offset'), { id: 'offset-2d', title: 'Offset 2D: cópia paralela de linha, arco, círculo ou cadeia, na distância e do lado do cursor (O)', menu: 'Offset 2D (linhas)', hint: 'O' }),
    offset3d: cmd('Offset\n3D', 'offset3d', () => app.offset3d(), { id: 'offset-3d', title: 'Offset 3D: cópia crescida/encolhida dos sólidos selecionados (extrusão, varredura, caixa, malhas)', menu: 'Offset 3D (sólidos)' }),
    cota: cmd('Cota', 'dim', () => app.dims.start(), { id: 'cota', title: 'Cota: clique dois pontos (encaixe em pontas e quinas) e a posição da linha; estilos e todos os parâmetros no painel Propriedades' }),
    arestas: cmd('Linhas do\nsólido', 'edges', () => app.sketchTool.start('arestas'), { id: 'linhas-solido', title: 'Cria linhas 2D a partir das arestas (ou do contorno de uma face) dos sólidos' }),
    extrudar: cmd('Extrudar', 'extrude', () => app.extrude(), { id: 'extrudar', title: 'Extrudar o contorno fechado das linhas selecionadas' }),
    varrer: cmd('Varrer', 'sweep', () => app.sweep(), { id: 'varrer', title: 'Perfil ao longo do caminho das linhas selecionadas' }),
    cortar: cmd('Cortar\ncom vazio', 'cut', () => app.cut(), { id: 'cortar-vazio', title: 'Os vazios selecionados cortam os outros elementos selecionados' }),
    tirarCorte: cmd('Tirar\ncorte', 'uncut', () => app.uncut(), { id: 'tirar-corte', title: 'Tira o corte dos elementos selecionados' }),

    mover: cmd('Mover', 'move', () => app.transformTool.start('translate'), { title: 'Mover a seleção com o gizmo X/Y/Z (M)', hint: 'M' }),
    girar: cmd('Girar', 'rotate', () => app.transformTool.start('rotate'), { title: 'Girar a seleção em X/Y/Z (R)', hint: 'R' }),
    desfazer: cmd('Desfazer\nmovimento', 'undo', () => app.transformTool.undo(), { title: 'Ctrl+Z', hint: 'Ctrl+Z' }),
    copiar: cmd('Copiar', 'copy', () => app.copyTool.start(), { id: 'copiar', title: 'Copiar a seleção: ponto base e destinos (2D no plano do nível ou 3D sobre os sólidos), repetições, para outro nível' }),
    espelhar: cmd('Espelhar', 'mirror', () => app.mirrorTool.start(), { id: 'espelhar', title: 'Espelhar a seleção por uma linha (2D na planta ou 3D; manter o original = cópia espelhada)' }),
    juncoes: cmd('Ajustar\njunções', 'joints', () => app.fixJoints(), { id: 'ajustar-juncoes', title: 'Paredes e vigas: cantos em meia-esquadria e junções em T paradas na face da outra (projeto todo)' }),
    paredeTelhado: cmd('Parede até\no telhado', 'wallRoof', () => app.wallsToRoof(), { id: 'parede-telhado', title: 'Estende/recorta as paredes selecionadas até a face de baixo do telhado' }),

    vista3d: cmd('Vista 3D', 'view3d', () => app.views.openView('3d')),
    plantaPiso: cmd('Planta\nde piso', 'plan', b => levelMenu(b, 'plan'), { drop: true, menu: 'Planta de piso…' }),
    plantaForro: cmd('Planta\nde forro', 'ceiling', b => levelMenu(b, 'ceiling'), { drop: true, menu: 'Planta de forro…' }),
    elevacao: cmd('Elevação', 'elev', b => elevMenu(b), { drop: true, menu: 'Elevação…' }),
    elevacoes: cmd('Elevações', 'elev', () => app.display.elevationsDialog(), { id: 'gerenciar-elevacoes', title: 'Elevações do projeto: criar, nomear, linha, profundidade e visíveis ou não', menu: 'Gerenciar elevações…' }),
    enquadrar: cmd('Enquadrar', 'fit', () => app.viewer.fit(), { title: 'Enquadrar tudo (F)' }),
    render: cmd('Render', 'render', () => app.viewStyles.set('render'), { id: 'render', title: 'Estilo Render na vista ativa: materiais em tempo real, sol, céu, sombras, path tracing', menu: 'Render (estilo da vista)' }),
    textura: cmd('Estilo\nTextura', 'texture', () => app.viewStyles.set('textura'), { id: 'estilo-textura', title: 'Estilo Textura na vista ativa: materiais com mapas, sem céu/sol/sombras', menu: 'Textura (estilo da vista)' }),
    materiais: cmd('Materiais', 'material', () => app.openMaterials(), { id: 'materiais', title: 'Editor de materiais: padrões procedurais com mapas de relevo, normal, AO, deslocamento, brilho/rugosidade, metal, especular, opacidade e emissão', menu: 'Editor de materiais…' }),
    texturas: cmd('Texturas', 'texture', () => app.openTextures(), { id: 'texturas', title: 'Editor de texturas procedurais próprias: camadas de ruído, ladrilhos, pedras, listras, furos, veios… (também pelo Chat IA)', menu: 'Editor de texturas…' }),

    rvtTrazer: cmd('Trazer\nmodelo', 'rvtIn', () => revit('Trazendo do Revit…', () => importFromRevit(app.viewer, { log, levels: L() })), { title: 'Trazer o modelo ativo do Revit (IFC)', menu: 'Trazer o modelo do Revit' }),
    rvtEnviar: cmd('Enviar\nprojeto', 'rvtOut', () => revit('Enviando ao Revit…', () => sendToRevit(app.viewer, { mode: 'link', log, levels: L() })), { title: 'Vincular o projeto do BoxBim ao projeto ativo do Revit (IFC)', menu: 'Enviar o projeto ao Revit' }),
    rvtNivIn: cmd('Trazer\nníveis', 'lvIn', () => app.syncLevelsUI('from_revit'), { menu: 'Trazer níveis do Revit' }),
    rvtNivOut: cmd('Enviar\nníveis', 'lvOut', () => app.syncLevelsUI('to_revit'), { menu: 'Enviar níveis ao Revit' }),
    rvtConexao: cmd('Conexão', 'sync', () => app.checkRevit(true), { title: 'Verificar a conexão com o Revit', menu: 'Verificar a conexão' }),

    biblioteca: cmd('Biblioteca', 'library', () => app.openObjectLibrary(), { title: 'Biblioteca de Objetos: inserir, editar, exportar' }),
    novoObjeto: cmd('Novo\nobjeto', 'newObj', () => app.newObject(), { title: 'Criar um Objeto paramétrico em JavaScript' }),
    importarBbo: cmd('Importar\n.bbo', 'bbo', () => app.importObjects(), { title: 'Importar Objetos (.bbo) para a biblioteca' }),
    tipos: cmd('Tipos e\ncamadas', 'wallLayers', () => app.openTypes('wall'), { id: 'tipos-com-camadas-e-materiais-usados-pelos-objetos-parede-laje-pilar-e-viga', title: 'Tipos com camadas e materiais (usados pelos objetos Parede, Piso, Pilar e Viga)' }),
    orcamento: cmd('Orçamento', 'budget', () => app.openBudget(), { id: 'orcamento', title: 'Quantidades e preços dos objetos do projeto' }),

    chat: cmd('Chat', 'chat', () => app.showTab('chat')),
    agentes: cmd('Agentes', 'agent', () => app.showTab('agents')),
    memoria: cmd('Memória', 'memory', () => app.showTab('memory')),
    config: cmd('Config.', 'settings', () => app.panels.openSettings(), { title: 'Configurações', menu: 'Configurações' }),
  };

  // ---------------- faixa padrão: ferramentas parecidas juntas
  const groups = [
    group('Arquivo',
      fam('f-abrir', 'Abrir', 'open', [C.abrir, C.impIfc, C.impDwg, C.impDxf, C.impFbx, C.impDae, C.abrirRvt], { title: 'Abrir e importar arquivos' }),
      fam('f-exportar', 'Exportar', 'export', [C.expIfc, C.expDwg, C.expFbx, C.expDae, C.expGlb, C.salvarRvt, C.captura], { title: 'Exportar o projeto ou a imagem da vista' })),
    group('Modelar',
      button(C.inserir),
      fam('f-laje', 'Piso', 'slab', [C.laje, C.editarPiso, C.pontosPiso, C.pisoLinhas]),
      button(C.telhado),
      fam('f-niveis', 'Níveis', 'level', [C.nivel, C.editarNiveis]),
      button(C.ortho),
      button(C.ambientes)),
    group('Desenho',
      button(C.selecao),
      fam('f-eixo', 'Eixo de trabalho', 'workplane', [C.eixo, C.planoNivel]),
      fam('f-editar-linhas', 'Editar linhas', 'trim', [C.aparar, C.estender, C.canto]),
      fam('f-offset', 'Offset', 'offset2d', [C.offset2d, C.offset3d]),
      button(C.cota),
      button(C.arestas),
      fam('f-solido', 'Sólido', 'extrude', [C.extrudar, C.varrer]),
      fam('f-vazio', 'Vazio', 'cut', [C.cortar, C.tirarCorte])),
    group('Modificar',
      fam('f-mover', 'Mover e girar', 'move', [C.mover, C.girar, C.desfazer]),
      fam('f-copiar', 'Copiar e espelhar', 'copy', [C.copiar, C.espelhar]),
      fam('f-ajustar', 'Ajustar paredes', 'joints', [C.juncoes, C.paredeTelhado])),
    group('Vistas',
      fam('f-vistas', 'Vistas', 'views', [C.vista3d, C.plantaPiso, C.plantaForro, C.elevacao, C.elevacoes], { menuOnly: true, title: 'Abrir uma vista: 3D, planta de piso, planta de forro ou elevação' }),
      button(C.enquadrar),
      fam('f-aparencia', 'Aparência', 'look', [C.render, C.textura, C.materiais, C.texturas], { title: 'Render, estilo Textura, materiais e texturas' })),
    group('Objetos',
      fam('f-biblioteca', 'Biblioteca', 'library', [C.biblioteca, C.novoObjeto, C.importarBbo]),
      button(C.tipos),
      button(C.orcamento)),
    group('Revit',
      fam('f-revit', 'Revit', 'revit', [C.rvtTrazer, C.rvtEnviar, C.rvtNivIn, C.rvtNivOut, C.rvtConexao, C.abrirRvt, C.salvarRvt], { menuOnly: true, title: 'Ponte com o Revit 2025' })),
    group('IA',
      fam('f-ia', 'IA', 'ai', [C.chat, C.agentes, C.memoria, C.config], { title: 'Chat IA, agentes, memória e configurações' })),
  ];
  // os grupos de sempre (Arquivo, Modelar, Desenho…) não aparecem fixos: viram o modelo dos presets — cada
  // aba e cada grupo da faixa vem do preset ativo e é editável (Personalizar menus)
  tb.defaultGroups = groups.map(g => ({ nome: g.querySelector('.rtitle').textContent, itens: [...g.querySelectorAll('[data-cmd]')].map(b => ({ tipo: 'comando', id: b.dataset.cmd })) }));
  const userGroups = tab => tb.groupsOf(tab).map(g => group(g.nome, ...tb.buttons(g)));

  const ribbon = $('#ribbon'), toggle = $('#ribbon-toggle'), tabsEl = $('#ribbon-tabs');
  const set = (collapsed, persist = true) => {
    ribbon.classList.toggle('collapsed', collapsed);
    toggle.textContent = collapsed ? '﹀' : '︿';
    toggle.title = collapsed ? 'Mostrar a barra de ferramentas (Ctrl+F1)' : 'Recolher a barra de ferramentas (Ctrl+F1)';
    if (persist) tb.setLayout({ faixaRecolhida: collapsed });
    window.dispatchEvent(new Event('resize'));
  };
  let current = null;
  const showTab = name => {
    if (!tb.tabNames().includes(name)) name = tb.tabNames()[0] || null;
    current = name;
    tabsEl.querySelectorAll('button').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    const mine = name ? userGroups(name) : [];
    const empty = !mine.length
      ? [h('div', { class: 'rgroup-empty' }, name ? 'Aba vazia — ' : 'Nenhuma aba — ', h('a', { href: '#', onclick: e => { e.preventDefault(); tb.customize(); } }, name ? 'escolha as ferramentas' : 'crie abas e grupos'))]
      : [];
    $('#ribbon-groups').replaceChildren(...mine, ...empty);
  };
  const renderTabs = () => {
    tabsEl.replaceChildren();
    for (const name of tb.tabNames()) {
      const t = h('button', { 'data-tab': name, title: 'Clique duplo recolhe/mostra a barra' }, name);
      t.addEventListener('click', () => { showTab(name); if (ribbon.classList.contains('collapsed')) set(false); });
      t.addEventListener('dblclick', () => set(!ribbon.classList.contains('collapsed')));
      tabsEl.append(t);
    }
    tabsEl.append(h('button', { class: 'tab-add', title: 'Criar abas e grupos de ferramentas (Personalizar menus)', onclick: () => tb.customize() }, '+'));
    showTab(current);
  };
  renderTabs();
  set(!!tb.layout.faixaRecolhida, false);
  toggle.addEventListener('click', () => set(!ribbon.classList.contains('collapsed')));
  // preset trocado ou menus personalizados: refaz as abas; trocado: também o estado recolhido
  tb.addEventListener('change', () => renderTabs());
  tb.addEventListener('layout', () => set(!!tb.layout.faixaRecolhida, false));
  document.addEventListener('keydown', e => { if (e.ctrlKey && e.key === 'F1') { e.preventDefault(); set(!ribbon.classList.contains('collapsed')); } });
}
