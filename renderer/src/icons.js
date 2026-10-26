// ÍCONES DA FAIXA E DOS MENUS — 24 × 24, nas cores do ícone do BoxBim:
//   traço claro (currentColor) para o desenho, .b = azul petróleo da marca (#26536E, preenchido),
//   .g = verde da marca (#169E2E / #1FBF3B, destaque), .gf = verde preenchido, .t = sigla de arquivo (verde).
// A classe antiga "accent" continua valendo (= .g) para os ícones de Objetos e presets antigos.
// Os ícones genéricos (abrir, câmera, mover, girar, copiar, olho, configurações, IA…) vêm da TABLER (MIT, embutidos
// em icons-tabler.js); os de CAD que ela não tem (parede, laje, níveis, aparar/estender, offset, extrudar, vãos,
// elevações, formatos de arquivo…) são desenhados aqui no mesmo traço.
import { TABLER } from './icons-tabler.js';

/** Documento com a sigla do formato (IFC, DWG…). */
const file = ext => `<path class="b" d="M5.5 2.5h8.5l4.5 4.5v14.5h-13z"/><path d="M14 2.5V7h4.5"/><text class="t" x="12" y="17.6">${ext}</text>`;

export const ICONS = {
  // ---------------- arquivo
  open: '<path class="b" d="M2.5 7h6.5l2 2.2h10.5V19.5H2.5z"/><path d="M2.5 7V5h6l1.5 2"/><path class="g" d="M12 17.5v-6m-2.6 2.6L12 11.5l2.6 2.6"/>',
  export: '<path class="b" d="M4 13.5v6.5h16v-6.5"/><path class="g" d="M12 15.5V3.5m-4 4l4-4 4 4"/>',
  shot: '<path class="b" d="M3 7.5h4l1.6-2.5h6.8L17 7.5h4V19H3z"/><circle cx="12" cy="13" r="3.6"/><circle class="gf" cx="12" cy="13" r="1.4"/>',
  ifc: file('IFC'), dwg: file('DWG'), dxf: file('DXF'), fbx: file('FBX'), dae: file('DAE'), glb: file('GLB'), rvt: file('RVT'), png: file('PNG'), bbo: file('BBO'),

  // ---------------- modelar
  library: '<rect class="b" x="3" y="4" width="5" height="16" rx=".6"/><rect class="b" x="9.5" y="4" width="5" height="16" rx=".6"/><path class="g" d="M16.5 5.5l3.8 1-3.4 13.2-3.8-1z"/>',
  layers: '<path class="b" d="M12 3l9 4.8-9 4.8-9-4.8z"/><path class="g" d="M3 12.2l9 4.8 9-4.8M3 16.4l9 4.8 9-4.8"/>',
  roof: '<path class="b" d="M5 11.5v9h14v-9"/><path class="g" d="M1.8 13L12 4.5 22.2 13"/><path d="M10 20.5v-5h4v5"/>',
  slab: '<path class="b" d="M2.5 12l9.5-5 9.5 5-9.5 5z"/><path class="g" d="M2.5 12v2.6l9.5 5 9.5-5V12"/>',
  floorLines: '<path d="M3 13l9-4.8 9 4.8-9 4.8z" stroke-dasharray="2.4 1.8"/><path class="g" d="M3 13v2.4l9 4.8 9-4.8V13"/><circle class="gf" cx="12" cy="8.2" r="1.4"/>',
  level: '<path class="g" d="M2.5 8h13M2.5 16h13" stroke-dasharray="3 2"/><path class="b" d="M16 8l3-3 3 3-3 3z"/><path class="b" d="M16 16l3-3 3 3-3 3z"/>',
  levelEdit: '<path class="g" d="M2.5 8h11M2.5 16h11" stroke-dasharray="3 2"/><path class="b" d="M14.5 18.5l1-3.5 5.5-5.5 2.5 2.5-5.5 5.5z"/>',
  ortho: '<path d="M5 3.5v15.5h15.5"/><path class="b" d="M5 12.5h6.5V19H5z"/><path class="g" d="M5 3.5l-1.8 2.2M5 3.5l1.8 2.2M20.5 19l-2.2-1.8M20.5 19l-2.2 1.8"/>',
  object: '<path class="b" d="M12 2.8l8.2 4.6v9.2L12 21.2l-8.2-4.6V7.4z"/><path d="M3.8 7.4l8.2 4.6 8.2-4.6M12 12v9.2"/>',
  newObj: '<path class="b" d="M11 3l7.5 4.2V12M11 21.2l-7.5-4.2V7.2L11 3"/><path d="M3.5 7.2l7.5 4.2 7.5-4.2M11 11.4V21"/><circle class="gf" cx="18" cy="18" r="4.2"/><path d="M18 15.8v4.4M15.8 18h4.4" stroke="#fff"/>',
  importObj: file('BBO'),
  wallLayers: '<rect class="b" x="3" y="4" width="4.2" height="16"/><rect class="gf" x="8.4" y="4" width="7.2" height="16" opacity=".85"/><rect class="b" x="16.8" y="4" width="4.2" height="16"/>',
  budget: '<path class="b" d="M5 2.8h10l4 4v14.4H5z"/><path d="M15 2.8v4h4"/><path class="g" d="M8 11h8M8 14.5h8M8 18h5"/>',

  // ---------------- desenho 2D e sólidos
  select: '<path class="b" d="M5 3l12 8.2-5.2 1 3.2 6.2-2.2 1.1-3.2-6.2L5.5 17z"/><rect class="g" x="14" y="14.5" width="7.5" height="6.5" stroke-dasharray="2 1.6"/>',
  workplane: '<path class="b" d="M2.5 17.5l5-12h14l-5 12z"/><path class="g" d="M8 14.5l3-6M12.5 14.5l3-6"/>',
  workplaneOff: '<path d="M2.5 14l5-10h14l-5 10z" stroke-dasharray="2.6 2"/><path class="b" d="M2 17.5h20v3H2z"/><path class="g" d="M12 15.5V9m-2.5 4L12 15.5l2.5-2.5"/>',
  trim: '<path d="M2.5 12h19"/><path class="g" d="M8 3.5v17M16 3.5v17"/><path class="b" d="M9.8 9.8l4.4 4.4M14.2 9.8l-4.4 4.4" stroke-width="2.2"/>',
  extend: '<path d="M2.5 12h11"/><path class="b" d="M18.5 3.5h3v17h-3z"/><path class="g" d="M13.5 12h4" stroke-dasharray="2 1.6"/><path class="g" d="M14.8 9l3 3-3 3"/>',
  fillet: '<path d="M4 20.5V12a8 8 0 0 1 8-8h8.5"/><path class="g" d="M4 4h4.5M4 4v4.5" stroke-dasharray="2 1.6"/><circle class="gf" cx="6.4" cy="6.4" r="1.4"/>',
  offset2d: '<path d="M3.5 18.5L18.5 3.5"/><path class="g" d="M7.5 21.5l14-14" stroke-dasharray="3 2"/><path class="b" d="M9.5 9.5l3 3" stroke-width="2"/>',
  offset3d: '<rect class="b" x="7.5" y="7.5" width="9" height="9"/><rect class="g" x="3" y="3" width="18" height="18" rx="1" stroke-dasharray="3 2"/>',
  edges: '<path class="b" d="M4 18l6-12 10 4-6 10z"/><path class="g" d="M4 18l6-12" stroke-width="2.6"/>',
  extrude: '<path class="b" d="M3.5 16l8.5 4.5 8.5-4.5L12 11.5z"/><path class="g" d="M12 11.5V2.8M9 5.8l3-3 3 3"/>',
  sweep: '<path class="g" d="M3 18.5c4 0 5-12.5 9-12.5s5 12.5 9 12.5"/><rect class="b" x="1.5" y="15.5" width="3.2" height="5.5"/>',
  cut: '<rect class="b" x="2.5" y="8" width="13.5" height="13"/><rect class="g" x="9.5" y="3" width="12" height="10.5" stroke-dasharray="3 2"/>',
  uncut: '<rect class="b" x="2.5" y="8" width="13.5" height="13"/><path class="g" d="M15.5 3.5l6 6M21.5 3.5l-6 6"/>',

  dim: '<path class="g" d="M3 6v12M21 6v12"/><path d="M3 12h18"/><path class="b" d="M6.5 10l-3.5 2 3.5 2zM17.5 10l3.5 2-3.5 2z"/><path class="g" d="M9 8.5h6"/>',

  // ---------------- modificar
  move: '<path d="M12 3v18M3 12h18"/><path class="g" d="M12 3l-2.8 2.8M12 3l2.8 2.8M12 21l-2.8-2.8M12 21l2.8-2.8M3 12l2.8-2.8M3 12l2.8 2.8M21 12l-2.8-2.8M21 12l-2.8 2.8"/><rect class="b" x="9.6" y="9.6" width="4.8" height="4.8"/>',
  rotate: '<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path class="g" d="M20 3.8v5h-5"/><path class="b" d="M9 9h6v6H9z" transform="rotate(20 12 12)"/>',
  undo: '<path class="g" d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  copy: '<rect class="b" x="8" y="8" width="12.5" height="12.5" rx="1.2"/><path class="g" d="M4 16V5a1.2 1.2 0 0 1 1.2-1.2h10.8"/>',
  mirror: '<path class="g" d="M12 2.5v19" stroke-dasharray="2 1.6"/><path d="M9 6L3 18h6z"/><path class="b" d="M15 6l6 12h-6z"/>',
  joints: '<path class="b" d="M4 20.5V4h6v10h10.5v6.5z"/><path class="g" d="M10 14l4-4"/>',
  wallRoof: '<path class="g" d="M2.5 11.5L12 4l9.5 7.5"/><path class="b" d="M6 21v-8.5l6-4.6 6 4.6V21z"/>',

  // ---------------- vistas e aparência
  views: '<rect class="b" x="2.5" y="4" width="19" height="14" rx="1.5"/><path d="M8 21h8M12 18v3"/><path class="g" d="M12 7l4.2 2.4v4.8L12 16.6l-4.2-2.4V9.4z"/>',
  view3d: '<path class="b" d="M12 2.8l8.2 4.6v9.2L12 21.2l-8.2-4.6V7.4z"/><path class="g" d="M3.8 7.4l8.2 4.6 8.2-4.6M12 12v9.2"/>',
  plan: '<rect class="b" x="3" y="3" width="18" height="18"/><path class="g" d="M3 12h9v9M12 3v5"/>',
  ceiling: '<rect class="b" x="3" y="3" width="18" height="18"/><path class="g" d="M3 8h18M3 13h18M3 18h18"/>',
  elev: '<path class="b" d="M4 20.5V10l8-6 8 6v10.5z"/><path class="g" d="M1.5 20.5h21M1.5 14h21" stroke-dasharray="3 2"/>',
  fit: '<path class="g" d="M3.5 9V3.5H9M20.5 9V3.5H15M3.5 15v5.5H9M20.5 15v5.5H15"/><rect class="b" x="8.5" y="8.5" width="7" height="7"/>',
  look: '<path class="b" d="M12 3a9 9 0 1 0 0 18c1.2 0 1.7-1 1.2-1.9-.6-1.1.1-2.3 1.5-2.3H17a4 4 0 0 0 4-4C21 7.3 17 3 12 3z"/><circle class="gf" cx="7.6" cy="11.2" r="1.4"/><circle class="gf" cx="10.6" cy="7.2" r="1.4"/><circle class="gf" cx="15.2" cy="7.6" r="1.4"/>',
  render: '<circle class="b" cx="12" cy="12" r="4.2"/><path class="g" d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9L7 7M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  material: '<circle class="b" cx="12" cy="12" r="8.5"/><path class="g" d="M7.5 10a5 5 0 0 1 4.5-3.5"/><path d="M3.5 12c3 2.6 14 2.6 17 0"/>',
  texture: '<rect class="b" x="3.5" y="3.5" width="17" height="17" rx="1"/><path class="g" d="M3.5 9.2h17M3.5 14.8h17M9 3.5v5.7M15 9.2v5.6M9 14.8v5.7"/>',

  // ---------------- Revit
  revit: '<rect class="b" x="3" y="3" width="18" height="18" rx="2"/><path d="M8.5 17V7h4.2a2.8 2.8 0 0 1 0 5.6H8.5M12.5 12.6L16 17" class="g"/>',
  rvtIn: '<rect class="b" x="2.5" y="4" width="11" height="16" rx="1"/><path d="M5.5 8h5M5.5 12h5"/><path class="g" d="M21.5 12h-6.5m2.6-2.6L15 12l2.6 2.6"/>',
  rvtOut: '<rect class="b" x="10.5" y="4" width="11" height="16" rx="1"/><path d="M13.5 8h5M13.5 12h5"/><path class="g" d="M2.5 12H9M6.4 9.4L9 12l-2.6 2.6"/>',
  lvIn: '<path class="b" d="M2.5 7h11M2.5 12h11M2.5 17h11" stroke-dasharray="3 2"/><path class="g" d="M21.5 12h-5.5m2.2-2.2L16 12l2.2 2.2"/>',
  lvOut: '<path class="b" d="M10.5 7h11M10.5 12h11M10.5 17h11" stroke-dasharray="3 2"/><path class="g" d="M2.5 12H8M5.8 9.8L8 12l-2.2 2.2"/>',
  sync: '<path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3"/><path class="g" d="M18 3v4h-4M6 21v-4h4"/><circle class="b" cx="12" cy="12" r="2.6"/>',

  // ---------------- IA
  ai: '<path class="b" d="M3.5 4.5h17v11.5H9.5l-6 4.5z"/><path class="g" d="M12 6.8l1.1 2.4 2.4 1.1-2.4 1.1L12 13.8l-1.1-2.4-2.4-1.1 2.4-1.1z"/>',
  chat: '<path class="b" d="M3.5 4.5h17v11.5H9.5l-6 4.5z"/><path class="g" d="M7.5 9h9M7.5 12.3h5.5"/>',
  agent: '<circle class="b" cx="12" cy="8.5" r="4.2"/><path d="M4 21.5c1-4.2 4-6.2 8-6.2s7 2 8 6.2"/><path class="g" d="M12 4.3V2.5"/><circle class="gf" cx="12" cy="2.2" r="1"/>',
  memory: '<path class="b" d="M6 2.8h9l4 4v14.4H6z"/><path d="M15 2.8v4h4"/><path class="g" d="M9 11h7M9 14.5h7M9 7.5h3"/>',
  settings: '<circle class="gf" cx="12" cy="12" r="3"/><path class="b" d="M12 2.5l1.8 2.6 3.1-.6.6 3.1 2.6 1.8-1.5 2.6 1.5 2.6-2.6 1.8-.6 3.1-3.1-.6L12 21.5l-1.8-2.6-3.1.6-.6-3.1-2.6-1.8L5.4 12 3.9 9.4l2.6-1.8.6-3.1 3.1.6z" fill-opacity=".55"/>',
};

Object.assign(ICONS, TABLER);

export const icon = name => `<svg viewBox="0 0 24 24" class="ico24">${ICONS[name] || ''}</svg>`;
