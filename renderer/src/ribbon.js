// Barra de ferramentas superior (faixa de opções no estilo do Revit), recolhível.
import { $, h, dropdown } from './ui.js';
import { importFromRevit, sendToRevit } from './io/formats.js';
import { ELEVATIONS } from './views.js';
import { fmtElev } from './levels.js';

// Ícones 24×24 em traço (a cor vem do CSS); a classe "accent" usa o verde do BoxBim.
const I = {
  open: '<path d="M3 7h6l2 2h10v10H3z"/><path class="accent" d="M12 12v5m-2.5-2.5L12 17l2.5-2.5"/>',
  select: '<path d="M5 3l12 8-5 1 3 6-2 1-3-6-4 3z"/><rect class="accent" x="13" y="14" width="8" height="7" stroke-dasharray="2 2"/>',
  line: '<path d="M4 19L20 5"/><circle class="accent" cx="4" cy="19" r="2"/><circle class="accent" cx="20" cy="5" r="2"/>',
  rect: '<rect x="4" y="6" width="16" height="12"/><circle class="accent" cx="4" cy="6" r="1.6"/><circle class="accent" cx="20" cy="18" r="1.6"/>',
  circle: '<circle cx="12" cy="12" r="8"/><path class="accent" d="M12 12h8"/>',
  trim: '<path d="M3 12h18"/><path class="accent" d="M8 4v16M16 4v16"/><path d="M10 10l4 4M14 10l-4 4"/>',
  extend: '<path d="M3 12h11"/><path class="accent" d="M19 4v16"/><path d="M14 12h4" stroke-dasharray="2 2"/><path d="M15 9l3 3-3 3"/>',
  fillet: '<path d="M4 20V12a8 8 0 0 1 8-8h8"/><path class="accent" d="M4 4h4M4 4v4" stroke-dasharray="2 2"/>',
  extrude: '<path d="M4 16l8 4 8-4-8-4z"/><path class="accent" d="M12 12V3M9 6l3-3 3 3"/>',
  sweep: '<path d="M3 18c4 0 5-12 9-12s5 12 9 12"/><rect class="accent" x="1.5" y="15" width="3" height="5"/>',
  cut: '<rect x="3" y="8" width="13" height="12"/><rect class="accent" x="10" y="3" width="11" height="10" stroke-dasharray="3 2"/>',
  uncut: '<rect x="3" y="8" width="13" height="12"/><path class="accent" d="M15 4l6 6M21 4l-6 6"/>',
  budget: '<rect x="5" y="3" width="14" height="18" rx="1"/><path class="accent" d="M8 8h8M8 12h8M8 16h5"/>',
  render: '<circle cx="12" cy="12" r="4"/><path class="accent" d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  shot: '<rect x="3" y="6" width="18" height="13" rx="2"/><circle cx="12" cy="12.5" r="3.5"/><path d="M8 6l1.5-2h5L16 6"/>',
  ifc: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path class="accent" d="M4 7.5l8 4.5 8-4.5M12 12v9"/>',
  dwg: '<path d="M5 19L19 5M5 5h6M5 5v6"/><rect class="accent" x="13" y="13" width="7" height="7"/>',
  dxf: '<path d="M4 18h16M4 18V6M4 14l5-5 4 4 7-7"/>',
  fbx: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><circle class="accent" cx="12" cy="12" r="3"/>',
  dae: '<path d="M4 8l8-4 8 4-8 4z"/><path class="accent" d="M4 12l8 4 8-4M4 16l8 4 8-4"/>',
  glb: '<circle cx="12" cy="12" r="8"/><path class="accent" d="M4 12h16M12 4c3 3 3 13 0 16M12 4c-3 3-3 13 0 16"/>',
  rvtIn: '<rect x="3" y="4" width="11" height="16" rx="1"/><path d="M6 8h5M6 12h5"/><path class="accent" d="M21 12h-6m2.5-2.5L15 12l2.5 2.5"/>',
  rvtOut: '<rect x="10" y="4" width="11" height="16" rx="1"/><path d="M13 8h5M13 12h5"/><path class="accent" d="M3 12h6m-2.5-2.5L9 12l-2.5 2.5"/>',
  wall: '<path d="M3 20V8l9-4 9 4v12"/><path class="accent" d="M3 13h18M8 8v5M16 8v5M12 13v7"/>',
  slab: '<path d="M3 14l9-5 9 5-9 5z"/><path class="accent" d="M3 14v2l9 5 9-5v-2"/>',
  column: '<rect x="9" y="4" width="6" height="16"/><path class="accent" d="M6 4h12M6 20h12"/>',
  beam: '<path d="M3 9h18v5H3z"/><path class="accent" d="M5 14v6M19 14v6"/>',
  box: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>',
  draw: '<path d="M3 21V11h8v10"/><path d="M11 15h6"/><path class="accent" d="M14 3l5 5-7 7H7v-5z"/>',
  ortho: '<path d="M5 19V5"/><path d="M5 19h14"/><path class="accent" d="M5 13h6v6"/>',
  move: '<path d="M12 3v18M3 12h18"/><path class="accent" d="M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>',
  rotate: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path class="accent" d="M20 4v5h-5"/>',
  undo: '<path d="M9 14l-5-5 5-5"/><path class="accent" d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  library: '<rect x="3" y="4" width="5" height="16"/><rect x="10" y="4" width="5" height="16"/><path class="accent" d="M17 5l4 1-3 14-4-1z"/>',
  newObj: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path class="accent" d="M12 9v6M9 12h6"/>',
  code: '<path d="M8 7l-5 5 5 5M16 7l5 5-5 5"/><path class="accent" d="M14 4l-4 16"/>',
  importObj: '<path d="M4 15v5h16v-5"/><path class="accent" d="M12 3v12m-4-4l4 4 4-4"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path class="accent" d="M3 12l9 5 9-5M3 16l9 5 9-5"/>',
  wallLayers: '<rect x="3" y="4" width="4" height="16"/><rect class="accent" x="7" y="4" width="10" height="16"/><rect x="17" y="4" width="4" height="16"/>',
  slabLayers: '<rect x="3" y="5" width="18" height="3"/><rect class="accent" x="3" y="8" width="18" height="8"/><rect x="3" y="16" width="18" height="3"/>',
  level: '<path class="accent" d="M3 8h13M3 16h13" stroke-dasharray="3 2"/><circle cx="19" cy="8" r="2"/><circle cx="19" cy="16" r="2"/>',
  workplane: '<path d="M3 17l5-12h13l-5 12z" stroke-dasharray="3 2"/><path class="accent" d="M8 14l3-6M12 14l3-6"/>',
  edges: '<path d="M4 18l6-12 10 4-6 10z"/><path class="accent" d="M4 18l6-12" stroke-width="3"/>',
  offset2d: '<path d="M4 18L18 4"/><path class="accent" d="M8 21L21 8" stroke-dasharray="3 2"/>',
  offset3d: '<rect x="7" y="7" width="10" height="10"/><rect class="accent" x="3" y="3" width="18" height="18" stroke-dasharray="3 2"/>',
  floor: '<path d="M3 15l9-5 9 5-9 5z"/><path class="accent" d="M3 15v2l9 5 9-5v-2"/>',
  joints: '<path d="M4 20V4h6v10h10v6z"/><path class="accent" d="M10 14l4-4"/>',
  roof: '<path d="M2 13l10-8 10 8"/><path class="accent" d="M5 11v9h14v-9"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="1"/><path class="accent" d="M4 16V5a1 1 0 0 1 1-1h11"/>',
  mirror: '<path d="M12 3v18" stroke-dasharray="2 2"/><path d="M9 6L3 18h6z"/><path class="accent" d="M15 6l6 12h-6z"/>',
  wallRoof: '<path d="M3 11l9-7 9 7"/><path class="accent" d="M6 21v-8l6-4.5 6 4.5v8z"/>',
  workplaneOff: '<path d="M3 17l5-12h13l-5 12z" stroke-dasharray="3 2"/><path class="accent" d="M4 20h16"/>',
  view3d: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path class="accent" d="M4 7.5l8 4.5 8-4.5M12 12v9"/>',
  plan: '<rect x="3" y="3" width="18" height="18"/><path class="accent" d="M3 12h9v9M12 3v5"/>',
  ceiling: '<rect x="3" y="3" width="18" height="18"/><path class="accent" d="M3 8h18M3 13h18M3 18h18"/>',
  elev: '<path d="M4 20V10l8-6 8 6v10z"/><path class="accent" d="M2 20h20M2 14h20" stroke-dasharray="3 2"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/><rect class="accent" x="9" y="9" width="6" height="6"/>',
  sync: '<path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3"/><path class="accent" d="M18 3v4h-4M6 21v-4h4"/>',
  lvIn: '<path d="M3 7h10M3 12h10M3 17h10" stroke-dasharray="3 2"/><path class="accent" d="M21 12h-5m2-2l-2 2 2 2"/>',
  lvOut: '<path d="M11 7h10M11 12h10M11 17h10" stroke-dasharray="3 2"/><path class="accent" d="M3 12h5m-2-2l2 2-2 2"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/><path class="accent" d="M8 9h8M8 12h5"/>',
  agent: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/><path class="accent" d="M12 4v-1"/>',
  memory: '<path d="M6 3h9l4 4v14H6z"/><path class="accent" d="M9 11h7M9 15h7M9 7h3"/>',
  settings: '<circle class="accent" cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
};

const icon = name => `<svg viewBox="0 0 24 24">${I[name] || ''}</svg>`;

const slug = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Comandos da faixa (id → rótulo, ícone, ação): os grupos fixos e os conjuntos de ferramentas do usuário usam. */
export const COMMANDS = {};

export function buildRibbon(app) {
  const tb = app.toolbars;
  const log = m => app.status(m);
  const L = () => app.levels;
  const btn = (label, ic, action, { title, drop, id, bind } = {}) => {
    const cid = id || slug(title || label);
    COMMANDS[cid] = { label, svg: icon(ic), action, title: title || label.replace('\n', ' '), drop, bind };
    const b = h('button', { class: `rbtn${drop ? ' drop' : ''}`, title: title || label.replace('\n', ' '), html: icon(ic) + `<span>${label.replace('\n', '<br>')}</span>` });
    b.addEventListener('click', () => action(b));
    bind?.(b);
    b.dataset.cmd = cid;
    return b;
  };

  const group = (title, ...buttons) => h('div', { class: 'rgroup' }, h('div', { class: 'rbtns' }, buttons), h('div', { class: 'rtitle' }, title));

  // menus de escolha de vista por nível
  const levelMenu = (b, kind) => dropdown(b, [...L().list].reverse().map(l => ({
    label: l.name, hint: fmtElev(l.elevation), action: () => app.views.openView(`${kind}:${l.id}`),
  })));
  const elevMenu = b => dropdown(b, Object.entries(ELEVATIONS).map(([k, e]) => ({ label: e.name, action: () => app.views.openView(`elev:${k}`) })));
  const revit = (label, fn) => app.task(label, fn);

  // ORTO: botão que fica aceso enquanto o modo está ligado
  const bindOrtho = b => { const sync = () => b.classList.toggle('on', app.wallTool.ortho); app.wallTool.addEventListener('ortho', sync); sync(); };
  const orthoBtn = btn('Orto', 'ortho', () => app.wallTool.toggleOrtho(), { id: 'ortho', title: 'ORTO: trava o ângulo em 0°/90° (F8)', bind: bindOrtho });

  // parede, laje, pilar, viga e caixa não são comandos: são Objetos (biblioteca e conjuntos do usuário);
  // os tipos e camadas de cada um abrem pelo próprio objeto (biblioteca e painel Propriedades)

  const groups = [
    group('Arquivo',
      btn('Abrir', 'open', () => app.openFiles(), { title: 'Abrir / importar arquivo (Ctrl+O)' }),
      btn('Captura', 'shot', () => app.saveScreenshot(), { title: 'Salvar a vista atual como PNG' })),
    group('Importar',
      btn('IFC', 'ifc', () => app.openFiles(['ifc']), { title: 'Importar IFC' }),
      btn('DWG', 'dwg', () => app.openFiles(['dwg']), { title: 'Importar DWG' }),
      btn('DXF', 'dxf', () => app.openFiles(['dxf']), { title: 'Importar DXF' }),
      btn('FBX', 'fbx', () => app.openFiles(['fbx']), { title: 'Importar FBX' }),
      btn('Collada', 'dae', () => app.openFiles(['dae']), { title: 'Importar Collada' })),
    group('Exportar',
      btn('IFC', 'ifc', () => app.exportAs('ifc'), { title: 'Exportar IFC' }),
      btn('DWG', 'dwg', () => app.exportAs('dwg'), { title: 'Exportar DWG' }),
      btn('FBX', 'fbx', () => app.exportAs('fbx'), { title: 'Exportar FBX' }),
      btn('Collada', 'dae', () => app.exportAs('dae'), { title: 'Exportar Collada' }),
      btn('glTF', 'glb', () => app.exportAs('glb'), { title: 'Exportar glTF' })),
    group('Modelar',
      btn('Inserir\nobjeto', 'library', () => app.openObjectLibrary(), { id: 'inserir-objeto', title: 'Inserir um Objeto da biblioteca (parede, laje, pilar, viga, caixa, portas, móveis…)' }),
      btn('Telhado', 'roof', () => app.roofTool.start(), { id: 'telhado', title: 'Telhado: desenhe o perfil num eixo de trabalho vertical e extrude; tipo com camadas (telha, ripas, caibros…)' }),
      btn('Laje', 'slabLayers', () => app.slabTool.start(), { id: 'laje-contorno', title: 'Laje: contorno por croqui 2D, linhas 2D, paredes (face externa/interna/eixo) ou face de sólido; contornos internos viram furos' }),
      orthoBtn,
      btn('Nível', 'level', () => app.levelDialog(), { title: 'Novo nível' }),
      btn('Editar\nníveis', 'level', () => app.levelEditor.openTable(), { id: 'editar-niveis', title: 'Editar níveis: nomes e cotas (em qualquer vista; nas elevações e no 3D também arrastando a linha)' })),
    group('Desenho',
      btn('Eixo de\ntrabalho', 'workplane', () => app.workPlanes.openCreate(), { id: 'eixo-trabalho', title: 'Novo eixo de trabalho (plano de desenho vertical ou horizontal); o novo fica ativo para desenhar' }),
      btn('Plano do\nnível', 'workplaneOff', () => app.workPlanes.activate(null), { id: 'plano-nivel', title: 'Volta a desenhar no plano do nível da vista (desativa o eixo de trabalho)' }),
      btn('Seleção', 'select', () => app.sketchTool.start('selecao'), { id: 'selecao', title: 'Seleção: clique, janela (arraste →) ou cruzamento (arraste ←)' }),
      btn('Aparar', 'trim', () => app.sketchTool.start('aparar'), { id: 'aparar', title: 'Aparar linhas (T)' }),
      btn('Estender', 'extend', () => app.sketchTool.start('estender'), { id: 'estender', title: 'Estender linhas (E)' }),
      btn('Canto', 'fillet', () => app.sketchTool.start('canto'), { id: 'canto', title: 'Canto entre duas linhas: vivo, arredondado (raio) ou chanfro (graus)' }),
      btn('Offset', 'offset2d', () => app.sketchTool.start('offset'), { id: 'offset-2d', title: 'Offset 2D: cópia paralela de linha, arco, círculo ou cadeia, na distância e do lado do cursor (O)' }),
      btn('Linhas do\nsólido', 'edges', () => app.sketchTool.start('arestas'), { id: 'linhas-solido', title: 'Cria linhas 2D a partir das arestas (ou do contorno de uma face) dos sólidos' }),
      btn('Extrudar', 'extrude', () => app.extrude(), { id: 'extrudar', title: 'Extrudar o contorno fechado das linhas selecionadas' }),
      btn('Varrer', 'sweep', () => app.sweep(), { id: 'varrer', title: 'Perfil ao longo do caminho das linhas selecionadas' }),
      btn('Piso das\nlinhas', 'floor', () => app.floorFromLines(), { id: 'piso-linhas', title: 'Piso (laje) a partir das linhas 2D selecionadas — contornos fechados horizontais, ex.: tiradas das quinas dos sólidos' }),
      btn('Offset\n3D', 'offset3d', () => app.offset3d(), { id: 'offset-3d', title: 'Offset 3D: cópia crescida/encolhida dos sólidos selecionados (extrusão, varredura, caixa, malhas)' }),
      btn('Cortar\ncom vazio', 'cut', () => app.cut(), { id: 'cortar-vazio', title: 'Os vazios selecionados cortam os outros elementos selecionados' }),
      btn('Tirar\ncorte', 'uncut', () => app.uncut(), { id: 'tirar-corte', title: 'Tira o corte dos elementos selecionados' })),
    group('Modificar',
      btn('Mover', 'move', () => app.transformTool.start('translate'), { title: 'Mover a seleção com o gizmo X/Y/Z (M)' }),
      btn('Girar', 'rotate', () => app.transformTool.start('rotate'), { title: 'Girar a seleção em X/Y/Z (R)' }),
      btn('Espelhar', 'mirror', () => app.mirrorTool.start(), { id: 'espelhar', title: 'Espelhar a seleção por uma linha (2D na planta ou 3D; manter o original = cópia espelhada)' }),
      btn('Parede até\no telhado', 'wallRoof', () => app.wallsToRoof(), { id: 'parede-telhado', title: 'Estende/recorta as paredes selecionadas até a face de baixo do telhado' }),
      btn('Copiar', 'copy', () => app.copyTool.start(), { id: 'copiar', title: 'Copiar a seleção: ponto base e destinos (2D no plano do nível ou 3D sobre os sólidos), repetições, para outro nível' }),
      btn('Desfazer\nmovimento', 'undo', () => app.transformTool.undo(), { title: 'Ctrl+Z' }),
      btn('Ajustar\njunções', 'joints', () => app.fixJoints(), { id: 'ajustar-juncoes', title: 'Paredes e vigas: cantos em meia-esquadria e junções em T paradas na face da outra (projeto todo)' })),
    group('Vistas',
      btn('Vista 3D', 'view3d', () => app.views.openView('3d')),
      btn('Render', 'render', () => app.viewStyles.set('render'), { id: 'render', title: 'Estilo Render na vista ativa: materiais em tempo real, sol, céu, sombras, path tracing' }),
      btn('Planta\nde piso', 'plan', b => levelMenu(b, 'plan'), { drop: true }),
      btn('Planta\nde forro', 'ceiling', b => levelMenu(b, 'ceiling'), { drop: true }),
      btn('Elevação', 'elev', b => elevMenu(b), { drop: true }),
      btn('Enquadrar', 'fit', () => app.viewer.fit(), { title: 'Enquadrar tudo (F)' })),
    group('Revit',
      btn('Trazer\nmodelo', 'rvtIn', () => revit('Trazendo do Revit…', () => importFromRevit(app.viewer, { log, levels: L() })), { title: 'Trazer o modelo ativo do Revit (IFC)' }),
      btn('Abrir\n.rvt', 'open', () => app.openFiles(['rvt'])),
      btn('Enviar\nprojeto', 'rvtOut', () => revit('Enviando ao Revit…', () => sendToRevit(app.viewer, { mode: 'link', log, levels: L() })), { title: 'Vincular o projeto do BoxBim ao projeto ativo do Revit (IFC)' }),
      btn('Salvar\n.rvt', 'rvtOut', () => app.exportAs('rvt')),
      btn('Trazer\nníveis', 'lvIn', () => app.syncLevelsUI('from_revit')),
      btn('Enviar\nníveis', 'lvOut', () => app.syncLevelsUI('to_revit')),
      btn('Conexão', 'sync', () => app.checkRevit(true), { title: 'Verificar a conexão com o Revit' })),
    group('Objetos',
      btn('Biblioteca', 'library', () => app.openObjectLibrary(), { title: 'Biblioteca de Objetos: inserir, editar, exportar' }),
      btn('Orçamento', 'budget', () => app.openBudget(), { id: 'orcamento', title: 'Quantidades e preços dos objetos do projeto' }),
      btn('Tipos e\ncamadas', 'layers', () => app.openTypes('wall'), { title: 'Tipos com camadas e materiais (usados pelos objetos Parede, Laje, Pilar e Viga)' }),
      btn('Novo\nobjeto', 'newObj', () => app.newObject(), { title: 'Criar um Objeto paramétrico em JavaScript' }),
      btn('Importar\n.bbo', 'importObj', () => app.importObjects(), { title: 'Importar Objetos (.bbo) para a biblioteca' })),
    group('IA',
      btn('Chat', 'chat', () => app.showTab('chat')),
      btn('Agentes', 'agent', () => app.showTab('agents')),
      btn('Memória', 'memory', () => app.showTab('memory')),
      btn('Config.', 'settings', () => app.panels.openSettings(), { title: 'Configurações' })),
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
