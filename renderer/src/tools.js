// Ferramentas que os agentes de IA podem chamar. Cada grupo pode ser ligado/desligado por agente.
import * as THREE from 'three';
import { materialFor } from './elements.js';
import { createOnLevel, setElementType, categoryOf } from './modeling.js';
import { isHostable } from './objects/objects.js';
import { CATEGORIES } from './types.js';
import { PATTERNS, GENERATORS, CHANNELS, BLEND, normalizeTexture, materialProps, patternList } from './materials.js';
import { importFile, exportFile, importFromRevit, sendToRevit, EXPORT_FORMATS } from './io/formats.js';

const B = window.boxbim;
const xy = { type: 'array', items: { type: 'number' }, description: '[x, y] em metros' };
const typeRef = { type: 'string', description: 'Tipo com camadas (nome ou id; veja list_types). Sem ele, usa o tipo padrão da categoria.' };
const level = { type: 'string', description: 'Nível hospedeiro (nome). Com nível, base/elevation/top/z são deslocamentos a partir dele e a altura padrão vai até o nível de cima. Sem nível, usa o da planta ativa.' };

export const TOOL_GROUPS = {
  scene: 'Cena 3D (consultar e modelar)',
  files: 'Arquivos (importar/exportar)',
  revit: 'Revit (ponte com o Revit 2025)',
  memory: 'Memória (arquivos Markdown)',
  skills: 'Skills (carregar instruções)',
};

/** Definições no formato neutro { name, description, parameters (JSON Schema), group, confirm? } */
export const TOOLS = [
  // ---------------- cena
  { group: 'scene', name: 'scene_summary', description: 'Lista os elementos do projeto aberto no BoxBim (id, tipo IFC, nome, caixa envolvente) e a contagem por tipo.',
    parameters: { type: 'object', properties: { limit: { type: 'number', description: 'Máximo de elementos listados (padrão 80)' } } } },
  { group: 'scene', name: 'get_selection', description: 'Retorna os elementos selecionados pelo usuário com suas propriedades.', parameters: { type: 'object', properties: {} } },
  { group: 'scene', name: 'add_wall', description: 'Cria uma parede reta num nível. Coordenadas em metros, Z para cima.',
    parameters: { type: 'object', properties: { start: xy, end: xy, level, type: typeRef, height: { type: 'number', description: 'Padrão: até o nível de cima' }, thickness: { type: 'number' }, base: { type: 'number', description: 'Deslocamento da base em relação ao nível' }, name: { type: 'string' } }, required: ['start', 'end'] } },
  { group: 'scene', name: 'add_slab', description: 'Cria um piso a partir de um contorno em planta. O topo fica no nível (+ "elevation" como deslocamento).',
    parameters: { type: 'object', properties: { points: { type: 'array', items: xy, description: 'Contorno [[x,y],…]' }, level, type: typeRef, thickness: { type: 'number' }, elevation: { type: 'number', description: 'Deslocamento do topo' }, name: { type: 'string' } }, required: ['points'] } },
  { group: 'scene', name: 'add_column', description: 'Cria um pilar retangular ou circular, do nível até o nível de cima.',
    parameters: { type: 'object', properties: { position: xy, level, type: typeRef, width: { type: 'number' }, depth: { type: 'number' }, height: { type: 'number' }, base: { type: 'number', description: 'Deslocamento da base' }, round: { type: 'boolean' }, name: { type: 'string' } }, required: ['position'] } },
  { group: 'scene', name: 'add_beam', description: 'Cria uma viga entre dois pontos com o topo no nível (+ "top" como deslocamento).',
    parameters: { type: 'object', properties: { start: xy, end: xy, level, type: typeRef, width: { type: 'number' }, height: { type: 'number' }, top: { type: 'number', description: 'Deslocamento do topo' }, name: { type: 'string' } }, required: ['start', 'end'] } },
  { group: 'scene', name: 'add_box', description: 'Cria uma caixa genérica (mobiliário, volume de estudo, equipamento) com tipo IFC opcional.',
    parameters: { type: 'object', properties: { position: { type: 'array', items: { type: 'number' }, description: '[x,y,z] do centro da base' }, size: { type: 'array', items: { type: 'number' }, description: '[dx,dy,dz]' }, level, type: { type: 'string', description: 'Ex.: IfcFurniture, IfcBuildingElementProxy' }, name: { type: 'string' } }, required: ['position', 'size'] } },
  { group: 'scene', name: 'modify_elements', description: 'Move, gira (graus, em torno de Z), escala, recolore, renomeia ou oculta elementos pelo id.',
    parameters: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } }, translate: { type: 'array', items: { type: 'number' } }, rotate_z_deg: { type: 'number' }, scale: { type: 'number' }, color: { type: 'string', description: '#rrggbb' }, name: { type: 'string' }, visible: { type: 'boolean' }, props: { type: 'object', description: 'Propriedades a gravar no elemento' } }, required: ['ids'] } },
  { group: 'scene', name: 'delete_elements', description: 'Apaga elementos do projeto pelo id.', confirm: true,
    parameters: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } }, required: ['ids'] } },
  { group: 'scene', name: 'select_elements', description: 'Seleciona e enquadra elementos na vista.',
    parameters: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } }, required: ['ids'] } },
  { group: 'scene', name: 'set_view', description: 'Muda a vista da câmera: iso, top, front, back, left, right, ou fit.',
    parameters: { type: 'object', properties: { view: { type: 'string' } }, required: ['view'] } },
  { group: 'scene', name: 'clear_scene', description: 'Remove todos os elementos do projeto.', confirm: true, parameters: { type: 'object', properties: {} } },

  // ---------------- tipos com camadas
  { group: 'scene', name: 'list_types', description: 'Lista os tipos com camadas (paredes, pisos, pilares, vigas): camadas, materiais, espessuras e o tipo padrão.',
    parameters: { type: 'object', properties: { category: { type: 'string', enum: ['wall', 'slab', 'column', 'beam'] } } } },
  // ---------------- materiais e texturas procedurais
  { group: 'scene', name: 'list_materials', description: 'Lista os materiais da biblioteca (cor e propriedades de render: padrão/textura, escala, rugosidade, metal, mapas…), os padrões de fábrica e as texturas procedurais próprias com as camadas.',
    parameters: { type: 'object', properties: {} } },
  { group: 'scene', name: 'create_texture', description: `Cria (ou atualiza, se "id" ou o mesmo nome já existir) uma TEXTURA PROCEDURAL própria do projeto, feita de camadas aplicadas de cima para baixo. Valores iniciais de cada ponto: tom 1, altura 1, rugosidade 1, metal 0, opacidade 1, detalhe 0,5. Cada camada gera um valor 0–1 (gerador), aplica "inverter", remapeia para de→ate e escreve nos "canais" pelo "modo" (multiplicar; misturar = substituir; somar = soma valor−0,5; minimo; maximo) com "forca" 0–1.
Canais: tom (multiplica a cor do material; >1 clareia), altura (1 = face, 0 = fundo da junta; gera normal, AO e deslocamento), rugosidade (multiplica a rugosidade do material), metal, opacidade (0 = furo; usar com mapaOpacidade), detalhe (bump fino).
Geradores e parâmetros: constante; ruido {escala, oitavas, semente}; escovado {escala, oitavas, direcao u|v, semente}; celulas = pedras/Voronoi {escala, junta, bisel, semente, saida}; ladrilhos = tijolos/pisos {colunas, linhas, junta, bisel, desencontro 0–1, saida}; listras = tábuas {escala, largura (fração cheia), suavidade, direcao, saida}; pontos = furos/bolinhas {escala, raio, suavidade, desencontro, saida}; veios = madeira {escala, distorcao, direcao, semente}; ondas {escala, distorcao, direcao, semente}. junta/bisel/raio são frações do quadro ou da célula; saida "peca" dá um tom aleatório por peça (tijolo, pedra, tábua) em vez da forma. O quadro inteiro cobre "escala" metros do material (ajustada em set_material).
Exemplo (tijolo): [{gerador:"ladrilhos",colunas:2,linhas:3,junta:0.02,bisel:0.012,desencontro:0.5,canais:["altura"],de:0.15,ate:1},{gerador:"ladrilhos",colunas:2,linhas:3,junta:0.02,desencontro:0.5,canais:["tom"],modo:"misturar",de:1.15,ate:0.85},{gerador:"ladrilhos",colunas:2,linhas:3,desencontro:0.5,saida:"peca",canais:["tom"],de:0.8,ate:1.05},{gerador:"ruido",escala:32,canais:["tom","detalhe"],de:0.88,ate:1}]`,
    parameters: { type: 'object', properties: {
      nome: { type: 'string' },
      id: { type: 'string', description: 'Id de uma textura existente para substituir (opcional)' },
      camadas: { type: 'array', items: { type: 'object', properties: {
        nome: { type: 'string' },
        gerador: { type: 'string', enum: Object.keys(GENERATORS) },
        escala: { type: 'number' }, oitavas: { type: 'number' }, semente: { type: 'number' }, colunas: { type: 'number' }, linhas: { type: 'number' },
        junta: { type: 'number' }, bisel: { type: 'number' }, desencontro: { type: 'number' }, largura: { type: 'number' }, suavidade: { type: 'number' },
        raio: { type: 'number' }, distorcao: { type: 'number' }, direcao: { type: 'string', enum: ['u', 'v'] }, saida: { type: 'string', enum: ['valor', 'peca'] },
        canais: { type: 'array', items: { type: 'string', enum: Object.keys(CHANNELS) } },
        modo: { type: 'string', enum: Object.keys(BLEND) }, forca: { type: 'number' }, de: { type: 'number' }, ate: { type: 'number' }, inverter: { type: 'boolean' },
      }, required: ['gerador', 'canais'] } },
      material: { type: 'string', description: 'Material da biblioteca que passa a usar a textura (opcional)' },
    }, required: ['nome', 'camadas'] } },
  { group: 'scene', name: 'set_material', description: 'Muda (ou cria, com create=true) um material da biblioteca: cor e propriedades de render. "textura" aceita um padrão de fábrica (veja list_materials), "tx:<id>" ou o nome de uma textura própria. Mapas: relevo (bump 0–3), normal (0–3), ao (0–2), deslocamento (cm 0–5, paralaxe), displacement (cm 0–10: o relevo move a geometria no Render), mapaRugosidade, mapaMetal, mapaEspecular, mapaOpacidade, mapaEmissao (true/false); escalares: escala (m), rugosidade 0–1 (brilho = 1 − rugosidade), metal 0–1, especular 0–1, corEspecular, opacidade 0–1, transmissao 0–1 (vidro), emissao (cor) e intensidadeEmissao (0–20).',
    parameters: { type: 'object', properties: {
      material: { type: 'string' }, create: { type: 'boolean' }, color: { type: 'string', description: '#rrggbb' },
      render: { type: 'object', description: 'Propriedades de render a mudar (as outras ficam)' },
    }, required: ['material'] } },
  { group: 'scene', name: 'set_element_type', description: 'Troca o tipo (camadas) de paredes, pisos, pilares ou vigas existentes. type vazio = genérico.',
    parameters: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } }, type: { type: 'string' } }, required: ['ids'] } },
  { group: 'scene', name: 'save_type', description: 'Cria ou atualiza um tipo com camadas e o salva na biblioteca. Parede: externa→interna; piso: topo→fundo; pilar/viga: 1ª camada = núcleo (thickness 0).',
    parameters: { type: 'object', properties: {
      category: { type: 'string', enum: ['wall', 'slab', 'column', 'beam'] }, name: { type: 'string' }, default: { type: 'boolean', description: 'Tornar o tipo padrão da categoria' },
      layers: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, material: { type: 'string' }, thickness: { type: 'number', description: 'metros' }, function: { type: 'string' } } } },
    }, required: ['category', 'name', 'layers'] } },

  // ---------------- objetos (famílias paramétricas em JavaScript)
  { group: 'scene', name: 'list_objects', description: 'Lista os Objetos da biblioteca (nome, categoria, parâmetros com padrão).', parameters: { type: 'object', properties: {} } },
  { group: 'scene', name: 'get_object', description: 'Retorna a definição completa de um Objeto (parâmetros e script) para estudo ou edição.',
    parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { group: 'scene', name: 'save_object', description: 'Cria ou atualiza um Objeto paramétrico: parâmetros + script JavaScript (veja a skill objetos-parametricos). O script é testado antes de salvar; erros voltam com a linha.',
    parameters: { type: 'object', properties: {
      name: { type: 'string' }, category: { type: 'string', description: 'Classe IFC, ex.: IfcFurniture, IfcDoor, IfcWindow, IfcStair' },
      description: { type: 'string' },
      parameters: { type: 'array', items: { type: 'object', properties: {
        name: { type: 'string' }, label: { type: 'string' }, type: { type: 'string', enum: ['comprimento', 'numero', 'inteiro', 'angulo', 'booleano', 'texto', 'opcao', 'material', 'cor'] },
        default: {}, min: { type: 'number' }, max: { type: 'number' }, options: { type: 'string' }, group: { type: 'string' } } } },
      script: { type: 'string', description: 'Corpo da função (p, g). Portas/janelas: chame g.opening(largura, altura, { sill }) para abrir o vão na parede; um parâmetro espessuraParede recebe a espessura da parede. Para usar outro objeto da biblioteca dentro deste: g.object("Nome", { valores }, { x, y, z, rotX, rotY, rotZ }) — parâmetros de mesmo nome são compartilhados.' },
    }, required: ['name', 'parameters', 'script'] } },
  { group: 'scene', name: 'place_object', description: 'Insere uma instância de um Objeto. Portas e janelas (objetos com vão) são HOSPEDADAS numa parede e abrem o vão nela: informe "wall" (id) e "offset" (centro do vão, m a partir do início da parede), ou só "position" perto de uma parede.',
    parameters: { type: 'object', properties: {
      object: { type: 'string' }, position: xy, rotation: { type: 'number', description: 'graus em torno de Z (objetos soltos)' }, level,
      wall: { type: 'string', description: 'id da parede hospedeira (portas/janelas)' },
      offset: { type: 'number', description: 'centro do vão, em m a partir do início da parede' },
      flip: { type: 'boolean', description: 'inverte o lado de abertura' },
      params: { type: 'object', description: 'Valores dos parâmetros (os omitidos usam o padrão)' },
    }, required: ['object'] } },
  { group: 'scene', name: 'set_object_params', description: 'Altera parâmetros de instâncias de Objeto e regenera a geometria.',
    parameters: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } }, params: { type: 'object' } }, required: ['ids', 'params'] } },

  // ---------------- níveis e vistas
  { group: 'scene', name: 'list_levels', description: 'Lista os níveis do projeto (nome, cota em m, nº de elementos) e a vista ativa.', parameters: { type: 'object', properties: {} } },
  { group: 'scene', name: 'add_level', description: 'Cria um nível (gera a planta de piso e a de forro dele).',
    parameters: { type: 'object', properties: { name: { type: 'string' }, elevation: { type: 'number', description: 'Cota em metros' } }, required: ['elevation'] } },
  { group: 'scene', name: 'modify_level', description: 'Renomeia um nível ou muda a cota dele.',
    parameters: { type: 'object', properties: { level: { type: 'string' }, name: { type: 'string' }, elevation: { type: 'number' } }, required: ['level'] } },
  { group: 'scene', name: 'delete_level', description: 'Apaga um nível (os elementos continuam no projeto).', confirm: true,
    parameters: { type: 'object', properties: { level: { type: 'string' } }, required: ['level'] } },
  { group: 'scene', name: 'open_view', description: 'Abre uma vista: kind "3d", "plan" (planta de piso) ou "ceiling" (planta de forro) com level, ou "elevation" com direction Norte/Sul/Leste/Oeste.',
    parameters: { type: 'object', properties: { kind: { type: 'string', enum: ['3d', 'plan', 'ceiling', 'elevation'] }, level: { type: 'string' }, direction: { type: 'string' } }, required: ['kind'] } },
  { group: 'scene', name: 'set_view_range', description: 'Ajusta a faixa da planta ativa: altura do plano de corte e profundidade (m, relativos ao nível).',
    parameters: { type: 'object', properties: { cut_height: { type: 'number' }, view_depth: { type: 'number' } } } },

  // ---------------- arquivos
  { group: 'files', name: 'import_model', description: 'Importa um arquivo (rvt, ifc, dwg, dxf, fbx, dae, glb, gltf, obj, stl) pelo caminho absoluto.',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { group: 'files', name: 'export_model', description: `Exporta o projeto inteiro. Formatos: ${Object.keys(EXPORT_FORMATS).join(', ')}. Sem "path", o usuário escolhe onde salvar.`,
    parameters: { type: 'object', properties: { format: { type: 'string' }, path: { type: 'string' } }, required: ['format'] } },

  // ---------------- revit
  { group: 'revit', name: 'revit_status', description: 'Verifica se o Revit está aberto com a ponte BoxBim e qual documento está ativo.', parameters: { type: 'object', properties: {} } },
  { group: 'revit', name: 'revit_summary', description: 'Resumo do projeto ativo no Revit: contagem de elementos por categoria e níveis.', parameters: { type: 'object', properties: {} } },
  { group: 'revit', name: 'revit_bring_model', description: 'Traz o modelo ativo do Revit (ou um .rvt pelo caminho) para o BoxBim via IFC ou FBX.',
    parameters: { type: 'object', properties: { path: { type: 'string', description: 'Opcional: .rvt a abrir em segundo plano' }, format: { type: 'string', enum: ['ifc', 'fbx', 'obj'] } } } },
  { group: 'revit', name: 'revit_sync_levels', description: 'Sincroniza níveis: direction "from_revit" traz os níveis do projeto ativo do Revit; "to_revit" cria/atualiza no Revit os níveis do BoxBim (com plantas).',
    parameters: { type: 'object', properties: { direction: { type: 'string', enum: ['from_revit', 'to_revit'] } }, required: ['direction'] } },
  { group: 'revit', name: 'revit_export', description: 'Faz o Revit exportar o projeto ativo para uma pasta (ifc, dwg, dxf, fbx, obj, stl).', confirm: true,
    parameters: { type: 'object', properties: { format: { type: 'string' }, folder: { type: 'string' }, name: { type: 'string' } }, required: ['format'] } },
  { group: 'revit', name: 'revit_send_model', description: 'Envia o projeto do BoxBim ao Revit: mode "link" (vincula ao projeto ativo), "import" (importa DXF/OBJ como geometria) ou "open" (abre como novo projeto).', confirm: true,
    parameters: { type: 'object', properties: { mode: { type: 'string', enum: ['link', 'import', 'open'] }, format: { type: 'string', enum: ['ifc', 'dxf', 'obj', 'stl'] } } } },

  // ---------------- memória
  { group: 'memory', name: 'save_memory', description: 'Guarda uma memória duradoura em Markdown (preferências do usuário, fatos do projeto, decisões). Use um nome curto; se já existir, é atualizada.',
    parameters: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string', description: 'Resumo de uma linha' }, type: { type: 'string', enum: ['user', 'feedback', 'project', 'reference'] }, content: { type: 'string', description: 'Conteúdo em Markdown' } }, required: ['name', 'description', 'content'] } },
  { group: 'memory', name: 'list_memories', description: 'Lista as memórias salvas (nome, tipo, descrição).', parameters: { type: 'object', properties: {} } },
  { group: 'memory', name: 'read_memory', description: 'Lê o conteúdo completo de uma memória.', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { group: 'memory', name: 'delete_memory', description: 'Apaga uma memória que ficou errada ou obsoleta.', confirm: true, parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },

  // ---------------- skills
  { group: 'skills', name: 'use_skill', description: 'Carrega as instruções completas de uma skill disponível antes de executar a tarefa correspondente.',
    parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
];

export function toolsFor(agent, settings) {
  const groups = new Set(agent.tools?.length ? agent.tools : Object.keys(TOOL_GROUPS));
  if (!settings.memory.enabled || agent.memory === false) groups.delete('memory');
  if (!agent.skills?.length) groups.delete('skills');
  return TOOLS.filter(t => groups.has(t.group));
}

// ---------------------------------------------------------------- execução

const round = v => Math.round(v * 1000) / 1000;
function describe(o) {
  const b = o.userData.bim;
  const box = new THREE.Box3().setFromObject(o);
  return {
    id: o.uuid, type: b.type, name: b.name,
    min: box.isEmpty() ? null : [round(box.min.x), round(box.min.y), round(box.min.z)],
    max: box.isEmpty() ? null : [round(box.max.x), round(box.max.y), round(box.max.z)],
    visible: o.visible,
  };
}

export function sceneSummary(viewer, limit = 80) {
  const els = viewer.elements();
  const byType = {};
  for (const e of els) byType[e.userData.bim.type] = (byType[e.userData.bim.type] || 0) + 1;
  const box = new THREE.Box3().setFromObject(viewer.model);
  return {
    total: els.length, byType,
    bounds: box.isEmpty() ? null : { min: box.min.toArray().map(round), max: box.max.toArray().map(round) },
    elements: els.slice(0, limit).map(describe),
    truncated: els.length > limit,
  };
}

/**
 * ctx: { viewer, settings, agent, log, confirm(text) → Promise<boolean>, refresh() }
 * Retorna string (o que volta para o modelo).
 */
export async function runTool(name, args, ctx) {
  const { viewer } = ctx;
  const def = TOOLS.find(t => t.name === name);
  if (!def) throw new Error(`Ferramenta desconhecida: ${name}`);
  const needsConfirm = def.confirm || (name === 'revit_sync_levels' && args.direction === 'to_revit');
  if (needsConfirm && !(ctx.settings.autoApprove && !name.startsWith('revit')) && !(await ctx.confirm(`${name}(${JSON.stringify(args)})`))) {
    return 'O usuário recusou esta ação.';
  }
  const byIds = ids => (ids || []).map(id => viewer.findById(id)).filter(Boolean);
  const created = el => { viewer.add(el); ctx.refresh?.(); return JSON.stringify({ created: describe(el) }); };

  switch (name) {
    case 'scene_summary': return JSON.stringify(sceneSummary(viewer, args.limit || 80));
    case 'get_selection': return JSON.stringify([...viewer.selected].map(o => ({ ...describe(o), props: o.userData.bim?.props })));
    case 'add_wall': return created(createOnLevel('wall', args, ctx.levels, ctx.views.activeLevel()));
    case 'add_slab': return created(createOnLevel('slab', args, ctx.levels, ctx.views.activeLevel()));
    case 'add_column': return created(createOnLevel('column', args, ctx.levels, ctx.views.activeLevel()));
    case 'add_beam': return created(createOnLevel('beam', args, ctx.levels, ctx.views.activeLevel()));
    case 'add_box': return created(createOnLevel('box', args, ctx.levels, ctx.views.activeLevel()));
    case 'modify_elements': {
      const els = byIds(args.ids);
      for (const o of els) {
        if (args.translate) {
          const [dx = 0, dy = 0, dz = 0] = args.translate;
          o.position.add(new THREE.Vector3(dx, dy, dz));
          if (o.userData.bim.wall) for (const inst of ctx.app.hosting.hostedOf(o)) inst.position.add(new THREE.Vector3(dx, dy, dz));
          if (o.userData.bim.host) ctx.app.hosting.reproject(o);
        }
        if (args.rotate_z_deg) {
          const c = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
          o.position.sub(c).applyAxisAngle(new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(args.rotate_z_deg)).add(c);
          o.rotateZ(THREE.MathUtils.degToRad(args.rotate_z_deg));
        }
        if (args.scale) o.scale.multiplyScalar(args.scale);
        if (args.color) o.traverse(m => { if (m.isMesh && !m.userData.isEdge) { const mat = materialFor(new THREE.Color(args.color).getHex()); if (m.userData._origMat) m.userData._origMat = mat; else m.material = mat; } });
        if (args.name) { o.name = args.name; o.userData.bim.name = args.name; }
        if (typeof args.visible === 'boolean') o.visible = args.visible;
        if (args.props) Object.assign(o.userData.bim.props ||= {}, args.props);
      }
      viewer.changed(); ctx.refresh?.();
      return JSON.stringify({ modified: els.length, missing: args.ids.length - els.length });
    }
    case 'delete_elements': {
      const els = byIds(args.ids);
      els.forEach(o => viewer.remove(o));
      ctx.refresh?.();
      return JSON.stringify({ deleted: els.length });
    }
    case 'select_elements': {
      const els = byIds(args.ids);
      viewer.select(els);
      if (els.length) viewer.fit(els);
      return JSON.stringify({ selected: els.length });
    }
    case 'set_view': args.view === 'fit' ? viewer.fit() : viewer.setView(args.view); return 'ok';
    case 'clear_scene': viewer.clear(); ctx.refresh?.(); return 'Projeto limpo.';

    case 'list_materials': {
      const lib = ctx.app.types;
      return JSON.stringify({
        materiais: Object.fromEntries(Object.entries(lib.materials).map(([n, m]) => [n, { cor: m.color, render: materialProps(n, m) }])),
        padroes_de_fabrica: Object.keys(PATTERNS),
        texturas_proprias: Object.fromEntries(Object.entries(lib.textures || {}).map(([id, t]) => [`tx:${id}`, t])),
      });
    }
    case 'create_texture': {
      const lib = ctx.app.types;
      lib.textures ||= {};
      const def = normalizeTexture({ nome: args.nome, camadas: args.camadas });
      if (!def.camadas.length) throw new Error('A textura precisa de pelo menos uma camada.');
      const given = args.id ? String(args.id).replace(/^tx:/, '') : null;
      let id = given && lib.textures[given] ? given : null;
      id ||= Object.entries(lib.textures).find(([, t]) => t.nome.toLowerCase() === def.nome.toLowerCase())?.[0];
      id ||= `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      lib.textures[id] = def;
      if (args.material) {
        const m = lib.materials[args.material];
        if (!m) throw new Error(`Material "${args.material}" não existe (veja list_materials).`);
        m.render = { ...(m.render || {}), textura: `tx:${id}` };
      }
      await lib.save();
      ctx.app.renderProps();
      return JSON.stringify({ id: `tx:${id}`, nome: def.nome, camadas: def.camadas.length, material: args.material || null,
        dica: 'Veja no estilo de vista Textura ou Render; ajuste escala, normal, deslocamento e mapas com set_material.' });
    }
    case 'set_material': {
      const lib = ctx.app.types;
      let m = lib.materials[args.material];
      if (!m) {
        if (!args.create) throw new Error(`Material "${args.material}" não existe (use create=true para criar).`);
        m = lib.materials[args.material] = { color: args.color || '#bbbbbb' };
      }
      if (args.color) m.color = args.color;
      const r = { ...(args.render || {}) };
      if (r.textura && !patternList()[r.textura]) {
        const found = Object.entries(lib.textures || {}).find(([id, t]) => t.nome.toLowerCase() === String(r.textura).toLowerCase() || id === r.textura);
        if (!found) throw new Error(`Padrão/textura "${r.textura}" não existe (veja list_materials).`);
        r.textura = `tx:${found[0]}`;
      }
      m.render = { ...(m.render || {}), ...r };
      lib._mats.clear();
      await lib.save();
      ctx.app.viewer.changed();
      ctx.app.renderProps();
      return JSON.stringify({ material: args.material, cor: m.color, render: materialProps(args.material, m) });
    }
    case 'list_types': {
      const lib = ctx.app.types;
      const cats = args.category ? [args.category] : Object.keys(CATEGORIES);
      return JSON.stringify(Object.fromEntries(cats.map(c => [c, lib.list(c).map(t => ({
        id: t.id, name: t.name, default: lib.active[c] === t.id, total_m: lib.thickness(t),
        layers: t.layers.map(l => `${l.name} | ${l.material} | ${l.thickness} m | ${l.function}`),
      }))])));
    }
    case 'set_element_type': {
      let n = 0;
      for (const el of byIds(args.ids)) if (categoryOf(el)) {
        setElementType(el, args.type || null); viewer._prepare2D(el); n++;
        if (el.userData.bim.wall) await ctx.app.hosting.refreshHostedOf(el);
      }
      viewer.changed(); ctx.refresh?.();
      return JSON.stringify({ changed: n });
    }
    case 'save_type': {
      const lib = ctx.app.types;
      if (!CATEGORIES[args.category]) throw new Error('category deve ser wall, slab, column ou beam.');
      for (const l of args.layers) if (l.material && !lib.materials[l.material]) lib.materials[l.material] = { color: '#bbbbbb' };
      const existing = lib.get(args.category, args.name);
      const t = lib.upsert(args.category, { id: existing?.id, name: args.name, layers: args.layers.map(l => ({ name: l.name || l.material || 'Camada', material: l.material || 'Genérico', thickness: Number(l.thickness) || 0, function: l.function || 'estrutura' })) });
      if (args.default) lib.active[args.category] = t.id;
      await lib.save();
      return JSON.stringify({ saved: t.id, total_m: lib.thickness(t) });
    }

    case 'list_objects':
      return JSON.stringify(ctx.app.objects.items.filter(o => !o.broken).map(o => ({
        id: o.id, name: o.name, category: o.category, description: o.description,
        parameters: o.parameters.map(p => `${p.name} (${p.type}) = ${p.default}`),
      })));
    case 'get_object': {
      const o = ctx.app.objects.get(args.name);
      return o ? JSON.stringify(o) : 'Objeto não encontrado.';
    }
    case 'save_object': {
      const lib = ctx.app.objects;
      const prev = lib.get(args.name);
      const def = { ...(prev || {}), format: 'boxbim-objeto', version: 1, name: args.name, category: args.category || prev?.category || 'IfcBuildingElementProxy',
        description: args.description ?? prev?.description ?? '', parameters: args.parameters, script: args.script };
      await lib.generate(def, {});   // testa antes de salvar: erro volta com a linha para o agente corrigir
      const saved = await lib.save(def);
      const n = await ctx.app.refreshObjectInstances(saved.id);
      return JSON.stringify({ saved: saved.id, instancesUpdated: n });
    }
    case 'place_object': {
      const def = ctx.app.objects.get(args.object);
      if (!def) return `Objeto não encontrado. Disponíveis: ${ctx.app.objects.items.map(o => o.name).join(', ')}`;
      // objetos de sistema são criados pelas ferramentas próprias (eixo da parede, contorno da laje, tipo com camadas)
      const sysTool = { parede: 'add_wall', laje: 'add_slab', pilar: 'add_column', viga: 'add_beam', caixa: 'add_box' }[def.sistema];
      if (['linha', 'retangulo', 'circulo'].includes(def.sistema)) return `"${def.name}" é desenho 2D: o usuário desenha com o mouse (Inserir objeto › ${def.name}).`;
      if (sysTool) return `"${def.name}" é um objeto de sistema: crie com ${sysTool} (a geometria sai do script do objeto).`;
      if (isHostable(def)) {
        // porta/janela: precisa de parede; usa a informada ou a mais próxima do ponto
        const hosting = ctx.app.hosting;
        let wall = args.wall && viewer.findById(args.wall);
        let offset = args.offset, flip = !!args.flip;
        if (!wall && args.position) {
          const lvl = ctx.levels.get(args.level) || null;
          const hit = hosting.findWall(args.position, lvl, 1.0);
          if (hit) { wall = hit.wall; offset ??= hit.t; if (args.flip === undefined) flip = hit.side < 0; }
        }
        if (!wall?.userData.bim.wall) return `"${def.name}" é hospedado: informe "wall" (id de uma parede) e "offset", ou uma "position" a menos de 1 m de uma parede.`;
        if (offset === undefined) offset = hosting.axisOf(wall).len / 2;
        const el = await ctx.app.placeHosted(def, args.params || {}, wall, { offset: Number(offset), flip });
        ctx.refresh?.();
        return JSON.stringify({ created: describe(el), host: { wall: wall.uuid, name: wall.name, ...el.userData.bim.host }, opening: el.userData.bim.opening });
      }
      if (!args.position) return 'Informe "position" [x, y].';
      const lvl = ctx.levels.get(args.level) || ctx.views.activeLevel() || ctx.levels.list[0];
      const [x = 0, y = 0] = args.position || [];
      const el = await ctx.app.objects.createInstance(def, { values: args.params || {}, position: [x, y, lvl.elevation], rotation: Number(args.rotation) || 0, level: lvl });
      viewer.add(el); ctx.refresh?.();
      return JSON.stringify({ created: describe(el), params: el.userData.bim.params });
    }
    case 'set_object_params': {
      let n = 0;
      for (const el of byIds(args.ids)) if (el.userData.bim.objectId) { await ctx.app.objects.regenerate(el, args.params); ctx.app.hosting.sync(el); viewer._prepare2D(el); n++; }
      viewer.changed(); ctx.refresh?.();
      return JSON.stringify({ regenerated: n });
    }

    case 'list_levels': {
      const count = new Map();
      for (const e of viewer.elements()) { const l = ctx.levels.ofElement(e); count.set(l.id, (count.get(l.id) || 0) + 1); }
      return JSON.stringify({
        levels: ctx.levels.list.map(l => ({ name: l.name, elevation: l.elevation, elements: count.get(l.id) || 0 })),
        activeView: ctx.views.label(ctx.views.active),
      });
    }
    case 'add_level': return JSON.stringify(ctx.levels.add({ name: args.name || ctx.levels.nextName(), elevation: args.elevation }));
    case 'modify_level': return JSON.stringify(ctx.levels.update(args.level, args));
    case 'delete_level': ctx.levels.remove(args.level); return 'Nível apagado.';
    case 'open_view': {
      const v = ctx.views.find(args);
      if (!v) return `Vista não encontrada. Níveis: ${ctx.levels.list.map(l => l.name).join(', ')}; elevações: Norte, Sul, Leste, Oeste.`;
      ctx.views.openView(v.id);
      return `Vista aberta: ${ctx.views.label(v)}`;
    }
    case 'set_view_range': {
      const v = ctx.views.active;
      if (v.kind !== 'plan' && v.kind !== 'ceiling') return 'A vista ativa não é uma planta. Abra uma planta com open_view.';
      const r = { ...ctx.views.range(v.id) };
      if (args.cut_height !== undefined) r.cutHeight = Number(args.cut_height);
      if (args.view_depth !== undefined) r.viewDepth = Number(args.view_depth);
      ctx.views.setRange(v.id, r); // grava no nível (configuração de corte)
      ctx.views.refresh();
      return JSON.stringify({ view: ctx.views.label(v), ...r });
    }

    case 'import_model': return JSON.stringify(await importFile(viewer, args.path, { log: ctx.log, levels: ctx.levels }));
    case 'export_model': {
      const fmt = String(args.format).toLowerCase().replace(/^\./, '');
      let path = args.path;
      if (!path) path = await B.dialog.save({ defaultPath: `projeto.${fmt}`, filters: [{ name: EXPORT_FORMATS[fmt] || fmt, extensions: [fmt] }] });
      if (!path) return 'O usuário cancelou a escolha do arquivo.';
      return JSON.stringify({ exported: await exportFile(viewer, fmt, path, { log: ctx.log, levels: ctx.levels }) });
    }

    case 'revit_status': return JSON.stringify(await B.revit('/status'));
    case 'revit_summary': return JSON.stringify(await B.revit('/summary'));
    case 'revit_bring_model': return JSON.stringify(await importFromRevit(viewer, { path: args.path, format: args.format || 'ifc', log: ctx.log, levels: ctx.levels }));
    case 'revit_sync_levels': return JSON.stringify(await syncLevels(args.direction, ctx.levels));
    case 'revit_export': return JSON.stringify(await B.revit('/export', args));
    case 'revit_send_model': {
      const mode = args.mode || 'link';
      const format = args.format || (mode === 'import' ? 'dxf' : 'ifc');
      return JSON.stringify(await sendToRevit(viewer, { mode, format, log: ctx.log, levels: ctx.levels }));
    }

    case 'save_memory': {
      const id = await B.memory.save({ name: args.name, description: args.description, type: args.type || 'project', body: args.content });
      ctx.onMemory?.();
      return `Memória salva: memory/${id}.md`;
    }
    case 'list_memories': return JSON.stringify((await B.memory.list()).map(m => ({ id: m.id, name: m.name, type: m.type, description: m.description })));
    case 'read_memory': {
      const m = (await B.memory.list()).find(x => x.id === args.id || x.name === args.id);
      return m ? m.body : 'Memória não encontrada.';
    }
    case 'delete_memory': await B.memory.remove(args.id); ctx.onMemory?.(); return 'Memória apagada.';

    case 'use_skill': {
      const skills = await B.skills.list();
      const s = skills.find(x => x.id === args.name || x.name.toLowerCase() === String(args.name).toLowerCase());
      if (!s) return `Skill não encontrada. Disponíveis: ${skills.map(x => x.id).join(', ')}`;
      return `# Skill: ${s.name}\n\n${s.body}`;
    }
  }
  throw new Error(`Ferramenta sem implementação: ${name}`);
}

/** Sincroniza níveis com o projeto ativo do Revit. */
export async function syncLevels(direction, levels) {
  if (direction === 'from_revit') {
    const r = await B.revit('/summary');
    if (!r.levels?.length) throw new Error('O projeto ativo do Revit não tem níveis.');
    levels.replace(r.levels.map(l => ({ name: l.name, elevation: l.elevation_m })));
    return { from: r.title, levels: levels.toJSON() };
  }
  return B.revit('/levels', { levels: levels.toJSON(), createPlans: true });
}
