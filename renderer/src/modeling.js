// Criação de elementos hospedados em níveis (como a "Restrição da base" do Revit).
// Com nível: as cotas (base, elevation, top, z) são deslocamentos a partir do nível e a altura padrão vai até o nível de cima.
// Sem nível: as cotas são absolutas e o nível é deduzido pela base do elemento.
import { createWall, createSlab, createColumn, createBeam, createBox, rebuildElement } from './elements.js';

// Biblioteca de tipos com camadas (registrada pelo app)
let typeLib = null;
export function setTypeLibrary(lib) { typeLib = lib; }

/**
 * Tipo do elemento: "type" (id ou nome) explícito; senão, se veio só uma espessura (parede/piso), elemento
 * genérico com essa espessura; senão, o tipo ativo da categoria. type: "nenhum" força o genérico.
 */
function typeSpec(cat, args) {
  if (!typeLib || args.type === 'nenhum') return {};
  if (args.type) {
    const t = typeLib.get(cat, args.type);
    if (!t) throw new Error(`Tipo "${args.type}" não encontrado. Tipos de ${cat}: ${typeLib.list(cat).map(x => x.name).join(', ')}`);
    return typeLib.spec(cat, t.id);
  }
  if ((cat === 'wall' || cat === 'slab') && args.thickness !== undefined && args.thickness !== null && args.thickness !== '') return {};
  return typeLib.spec(cat);
}

const num = (v, d) => (v === undefined || v === null || v === '' || Number.isNaN(Number(v)) ? d : Number(v));

export function createOnLevel(kind, args, levels, fallbackLevel) {
  const lvl = levels.get(args.level) || (args.level ? null : fallbackLevel);
  if (args.level && !lvl) throw new Error(`Nível não encontrado: ${args.level}. Níveis: ${levels.list.map(l => l.name).join(', ')}`);
  const z0 = lvl ? lvl.elevation : 0;
  const defH = lvl ? levels.heightOf(lvl) : 3;
  let el, baseZ;

  switch (kind) {
    case 'wall':
      baseZ = z0 + num(args.base, 0);
      el = createWall({ ...args, ...typeSpec('wall', args), base: baseZ, height: num(args.height, defH) });
      break;
    case 'slab':
      baseZ = z0 + num(args.elevation, 0);
      el = createSlab({ ...args, ...typeSpec('slab', args), elevation: baseZ });
      break;
    case 'column':
      baseZ = z0 + num(args.base, 0);
      el = createColumn({ ...args, ...typeSpec('column', args), base: baseZ, height: num(args.height, defH) });
      break;
    case 'beam': {
      // viga: o topo fica no nível (ou no nível + deslocamento)
      const top = lvl ? z0 + num(args.top, 0) : num(args.top, 3);
      baseZ = top;
      el = createBeam({ ...args, ...typeSpec('beam', args), top });
      break;
    }
    case 'box': {
      const p = args.position || [0, 0, 0];
      baseZ = z0 + num(p[2], 0);
      el = createBox({ ...args, type: args.ifcType || args.type, position: [p[0], p[1], baseZ] });
      break;
    }
    default: throw new Error(`Tipo desconhecido: ${kind}`);
  }

  const host = lvl || levels.forZ(baseZ);
  el.userData.bim.levelId = host.id;
  el.userData.bim.props = { Nivel: host.name, ...el.userData.bim.props };
  if (lvl) el.userData.bim.props.Deslocamento = +(baseZ - lvl.elevation).toFixed(4);
  return el;
}

/** Mantém a propriedade Nivel em dia quando um nível é renomeado. */
export function syncLevelNames(viewer, levels) {
  for (const e of viewer.elements()) {
    const b = e.userData.bim;
    const lvl = b.levelId && levels.get(b.levelId);
    if (lvl && b.props) b.props.Nivel = lvl.name;
  }
}

/** Categoria de tipo do elemento (wall, slab, column, beam) ou null se não usa camadas. */
export const categoryOf = el => {
  const b = el.userData.bim;
  return b.wall ? 'wall' : b.slab ? 'slab' : b.column ? 'column' : b.beam ? 'beam' : null;
};

/** Troca o tipo de um elemento em camadas (ou o torna genérico com type = null). */
export function setElementType(el, typeRef) {
  const cat = categoryOf(el);
  if (!cat) throw new Error('Este elemento não usa tipos com camadas.');
  const b = el.userData.bim;
  const spec = typeRef ? typeLib.spec(cat, typeRef) : { layers: null, typeId: null, typeName: null };
  if (typeRef && !spec.typeId) throw new Error(`Tipo não encontrado: ${typeRef}`);
  Object.assign(b, spec);
  if (!spec.typeId) { delete b.props.Tipo; delete b.props.Camadas; }
  rebuildElement(el);
  return el;
}

/** Propaga a edição de tipos (camadas, materiais) para todas as instâncias do modelo, como no Revit. */
export function refreshTypedElements(viewer) {
  let n = 0;
  for (const el of viewer.elements()) {
    const cat = categoryOf(el);
    const b = el.userData.bim;
    if (!cat || !b.typeId) continue;
    const t = typeLib.get(cat, b.typeId);
    if (t) { b.layers = structuredClone(t.layers); b.typeName = t.name; }
    rebuildElement(el);
    n++;
  }
  return n;
}
