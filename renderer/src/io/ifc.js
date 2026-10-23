// IFC: importação via web-ifc e exportação IFC4 própria (malhas trianguladas + cores + Psets).
import * as THREE from 'three';
import { IfcAPI, IFCBUILDINGSTOREY, IFCSIUNIT, IFCCONVERSIONBASEDUNIT, IFCRELCONTAINEDINSPATIALSTRUCTURE } from 'web-ifc';
import { baseMaterial } from '../viewer.js';
import { materialFor, IFC_COLORS } from '../elements.js';

let api = null;
async function getApi() {
  if (api) return api;
  api = new IfcAPI();
  const base = new URL('./', location.href).href;
  await api.Init(file => base + 'dist/' + file, true);
  return api;
}

// Nomes legíveis dos tipos mais comuns (o web-ifc devolve em maiúsculas)
const PRETTY = {};
for (const n of ['IfcWall', 'IfcWallStandardCase', 'IfcSlab', 'IfcColumn', 'IfcBeam', 'IfcRoof', 'IfcDoor', 'IfcWindow', 'IfcStair',
  'IfcStairFlight', 'IfcRailing', 'IfcMember', 'IfcPlate', 'IfcCovering', 'IfcFooting', 'IfcPile', 'IfcFurnishingElement',
  'IfcFurniture', 'IfcBuildingElementProxy', 'IfcSpace', 'IfcCurtainWall', 'IfcRamp', 'IfcRampFlight', 'IfcOpeningElement',
  'IfcFlowSegment', 'IfcFlowTerminal', 'IfcFlowFitting', 'IfcPipeSegment', 'IfcDuctSegment', 'IfcSite', 'IfcBuildingStorey',
  'IfcSanitaryTerminal', 'IfcLightFixture', 'IfcElementAssembly', 'IfcReinforcingBar', 'IfcGeographicElement', 'IfcAnnotation']) {
  PRETTY[n.toUpperCase()] = n;
}
const pretty = t => {
  if (!t) return 'IfcBuildingElementProxy';
  if (PRETTY[t.toUpperCase()]) return PRETTY[t.toUpperCase()];
  if (/^Ifc[A-Z]/.test(t)) return t; // já vem em CamelCase
  return 'Ifc' + t.slice(3).toLowerCase().replace(/^./, c => c.toUpperCase());
};

const Y_TO_Z = new THREE.Matrix4().makeRotationX(Math.PI / 2);

export async function importIfc(bytes, fileName, onProgress) {
  const ifc = await getApi();
  const modelID = ifc.OpenModel(bytes, { COORDINATE_TO_ORIGIN: false });
  const root = new THREE.Group();
  root.name = fileName;
  root.userData.source = { format: 'ifc', file: fileName, modelID };

  const { storeys, storeyOf } = readStoreys(ifc, modelID);
  root.userData.storeys = storeys;

  const byElement = new Map();
  ifc.StreamAllMeshes(modelID, (flat, index, total) => {
    const id = flat.expressID;
    let group = byElement.get(id);
    if (!group) {
      group = new THREE.Group();
      let line = null, type = 'IFCBUILDINGELEMENTPROXY';
      try { line = ifc.GetLine(modelID, id); } catch { /* entidade sem linha */ }
      try { type = ifc.GetNameFromTypeCode(ifc.GetLineType(modelID, id)) || type; } catch { /* versão antiga */ }
      const name = line?.Name?.value || pretty(type).slice(3);
      group.name = name;
      group.userData.bim = {
        type: pretty(type), name, guid: line?.GlobalId?.value || crypto.randomUUID(),
        props: { ExpressID: id, ObjectType: line?.ObjectType?.value || '', Tag: line?.Tag?.value || '', ...(storeyOf.has(id) ? { Nivel: storeyOf.get(id) } : {}) },
        ifc: { modelID, expressID: id },
      };
      byElement.set(id, group);
      root.add(group);
    }
    const geoms = flat.geometries;
    for (let i = 0; i < geoms.size(); i++) {
      const pg = geoms.get(i);
      const g = ifc.GetGeometry(modelID, pg.geometryExpressID);
      const v = ifc.GetVertexArray(g.GetVertexData(), g.GetVertexDataSize());
      const idx = ifc.GetIndexArray(g.GetIndexData(), g.GetIndexDataSize());
      const pos = new Float32Array(v.length / 2), nor = new Float32Array(v.length / 2);
      for (let k = 0, j = 0; k < v.length; k += 6, j += 3) {
        pos[j] = v[k]; pos[j + 1] = v[k + 1]; pos[j + 2] = v[k + 2];
        nor[j] = v[k + 3]; nor[j + 1] = v[k + 4]; nor[j + 2] = v[k + 5];
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
      // web-ifc entrega Y para cima; o BoxBim trabalha com Z para cima
      geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(Y_TO_Z, new THREE.Matrix4().fromArray(pg.flatTransformation)));
      const c = pg.color;
      const color = new THREE.Color(c.x, c.y, c.z);
      const mesh = new THREE.Mesh(geo, materialFor(color.getHex(), Math.min(1, c.w)));
      group.add(mesh);
      g.delete?.();
    }
    if (onProgress && total) onProgress(index / total);
  });
  return root;
}

/** Escala da unidade de comprimento do projeto IFC para metros. */
function lengthScale(ifc, modelID) {
  const PREFIX = { MILLI: 0.001, CENTI: 0.01, DECI: 0.1, KILO: 1000 };
  const si = ifc.GetLineIDsWithType(modelID, IFCSIUNIT);
  for (let i = 0; i < si.size(); i++) {
    const u = ifc.GetLine(modelID, si.get(i));
    if (u.UnitType?.value === 'LENGTHUNIT') return PREFIX[u.Prefix?.value] ?? 1;
  }
  const cb = ifc.GetLineIDsWithType(modelID, IFCCONVERSIONBASEDUNIT);
  for (let i = 0; i < cb.size(); i++) {
    const u = ifc.GetLine(modelID, cb.get(i));
    if (u.UnitType?.value === 'LENGTHUNIT') return /INCH/i.test(u.Name?.value) ? 0.0254 : 0.3048;
  }
  return 1;
}

/** Pavimentos (IfcBuildingStorey) em metros e o pavimento de cada elemento. */
function readStoreys(ifc, modelID) {
  const storeys = [], storeyOf = new Map(), names = new Map();
  try {
    const scale = lengthScale(ifc, modelID);
    const ids = ifc.GetLineIDsWithType(modelID, IFCBUILDINGSTOREY);
    for (let i = 0; i < ids.size(); i++) {
      const s = ifc.GetLine(modelID, ids.get(i));
      const name = s.Name?.value || s.LongName?.value || `Pavimento ${i + 1}`;
      names.set(ids.get(i), name);
      storeys.push({ name, elevation: +((Number(s.Elevation?.value) || 0) * scale).toFixed(4) });
    }
    const rels = ifc.GetLineIDsWithType(modelID, IFCRELCONTAINEDINSPATIALSTRUCTURE);
    for (let i = 0; i < rels.size(); i++) {
      const r = ifc.GetLine(modelID, rels.get(i));
      const name = names.get(r.RelatingStructure?.value);
      if (!name) continue;
      for (const e of r.RelatedElements || []) storeyOf.set(e.value, name);
    }
  } catch (e) { console.warn('IFC: não foi possível ler os pavimentos', e); }
  storeys.sort((a, b) => a.elevation - b.elevation);
  return { storeys, storeyOf };
}

/** Property sets do elemento IFC (carregados sob demanda ao selecionar). */
export async function ifcPropertySets(obj) {
  const ref = obj.userData?.bim?.ifc;
  if (!ref || !api) return null;
  try {
    const psets = await api.properties.getPropertySets(ref.modelID, ref.expressID, true);
    const out = {};
    for (const ps of psets || []) {
      const name = ps.Name?.value || 'Pset';
      const props = {};
      for (const p of ps.HasProperties || ps.Quantities || []) {
        const k = p.Name?.value;
        const v = p.NominalValue?.value ?? p.LengthValue?.value ?? p.AreaValue?.value ?? p.VolumeValue?.value ?? p.CountValue?.value ?? p.WeightValue?.value;
        if (k) props[k] = v ?? '';
      }
      out[name] = props;
    }
    return out;
  } catch { return null; }
}

// ---------------------------------------------------------------- exportação IFC4

const B64 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';
export function ifcGuid(uuid) {
  const hex = String(uuid || crypto.randomUUID()).replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(hex)) return /^[0-9A-Za-z_$]{22}$/.test(uuid) ? uuid : ifcGuid();
  let n = BigInt('0x' + hex);
  const out = [];
  for (let i = 0; i < 22; i++) { out.unshift(B64[Number(n & 63n)]); n >>= 6n; }
  return out.join('');
}

function str(s) {
  if (s === null || s === undefined || s === '') return '$';
  let out = "'";
  for (const ch of String(s)) {
    const code = ch.codePointAt(0);
    if (ch === "'") out += "''";
    else if (ch === '\\') out += '\\\\';
    else if (code >= 32 && code < 127) out += ch;
    else if (code <= 0xffff) out += '\\X2\\' + code.toString(16).toUpperCase().padStart(4, '0') + '\\X0\\';
    else out += '\\X4\\' + code.toString(16).toUpperCase().padStart(8, '0') + '\\X0\\';
  }
  return out + "'";
}

function num(n) {
  if (!Number.isFinite(n)) return '0.';
  const s = (Math.abs(n) < 1e-9 ? 0 : n).toFixed(6).replace(/0+$/, '');
  return s === '-0.' ? '0.' : s;
}

// Tipos com 9 atributos (GlobalId…PredefinedType) que o BoxBim exporta diretamente
const SIMPLE = new Set(['IFCWALL', 'IFCSLAB', 'IFCCOLUMN', 'IFCBEAM', 'IFCROOF', 'IFCSTAIR', 'IFCRAILING', 'IFCMEMBER',
  'IFCPLATE', 'IFCCOVERING', 'IFCFOOTING', 'IFCBUILDINGELEMENTPROXY', 'IFCCURTAINWALL', 'IFCRAMP', 'IFCFURNITURE']);

function ifcEntity(type) {
  const t = String(type || '').toUpperCase();
  if (t === 'IFCWALLSTANDARDCASE') return 'IFCWALL';
  if (t === 'IFCFURNISHINGELEMENT') return 'IFCFURNITURE';
  if (SIMPLE.has(t) || t === 'IFCDOOR' || t === 'IFCWINDOW') return t;
  return 'IFCBUILDINGELEMENTPROXY';
}

export function exportIfc(viewer, { projectName = 'BoxBim', levels = null } = {}) {
  const lines = [];
  let id = 0;
  const add = s => { lines.push(`#${++id}=${s};`); return `#${id}`; };
  const now = Math.floor(Date.now() / 1000);

  const person = add(`IFCPERSON($,$,'BoxBim',$,$,$,$,$)`);
  const org = add(`IFCORGANIZATION($,'BoxBim',$,$,$)`);
  const po = add(`IFCPERSONANDORGANIZATION(${person},${org},$)`);
  const appl = add(`IFCAPPLICATION(${org},'1.0','BoxBim','BoxBim')`);
  const oh = add(`IFCOWNERHISTORY(${po},${appl},$,.ADDED.,$,$,$,${now})`);
  const units = [
    add(`IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)`), add(`IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)`),
    add(`IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)`), add(`IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)`),
  ];
  const ua = add(`IFCUNITASSIGNMENT((${units.join(',')}))`);
  const origin = add(`IFCCARTESIANPOINT((0.,0.,0.))`);
  const zDir = add(`IFCDIRECTION((0.,0.,1.))`);
  const xDir = add(`IFCDIRECTION((1.,0.,0.))`);
  const axis = add(`IFCAXIS2PLACEMENT3D(${origin},${zDir},${xDir})`);
  const ctx = add(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,${axis},$)`);
  const body = add(`IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,${ctx},$,.MODEL_VIEW.,$)`);
  const project = add(`IFCPROJECT('${ifcGuid()}',${oh},${str(projectName)},$,$,$,$,(${ctx}),${ua})`);
  const sitePl = add(`IFCLOCALPLACEMENT($,${axis})`);
  const site = add(`IFCSITE('${ifcGuid()}',${oh},'Terreno',$,$,${sitePl},$,$,.ELEMENT.,$,$,$,$,$)`);
  const bldPl = add(`IFCLOCALPLACEMENT(${sitePl},${axis})`);
  const building = add(`IFCBUILDING('${ifcGuid()}',${oh},'Edificação',$,$,${bldPl},$,$,.ELEMENT.,$,$,$)`);
  // Um IfcBuildingStorey por nível do BoxBim (o Revit cria os níveis ao abrir o IFC)
  const lvls = levels?.list?.length ? levels.list : [{ id: 'default', name: 'Pavimento 1', elevation: 0 }];
  const storeyRef = new Map();
  for (const l of lvls) {
    const p = add(`IFCCARTESIANPOINT((0.,0.,${num(l.elevation)}))`);
    const pl = add(`IFCLOCALPLACEMENT(${bldPl},${add(`IFCAXIS2PLACEMENT3D(${p},${zDir},${xDir})`)})`);
    storeyRef.set(l.id, add(`IFCBUILDINGSTOREY('${ifcGuid()}',${oh},${str(l.name)},$,$,${pl},$,$,.ELEMENT.,${num(l.elevation)})`));
  }
  const productsBy = new Map([...storeyRef.keys()].map(k => [k, []]));
  add(`IFCRELAGGREGATES('${ifcGuid()}',${oh},$,$,${project},(${site}))`);
  add(`IFCRELAGGREGATES('${ifcGuid()}',${oh},$,$,${site},(${building}))`);
  add(`IFCRELAGGREGATES('${ifcGuid()}',${oh},$,$,${building},(${[...storeyRef.values()].join(',')}))`);

  const styleCache = new Map();
  const styleFor = (color, opacity) => {
    const key = color.getHexString() + opacity;
    if (!styleCache.has(key)) {
      const c = add(`IFCCOLOURRGB($,${num(color.r)},${num(color.g)},${num(color.b)})`);
      const shading = add(`IFCSURFACESTYLESHADING(${c},${num(1 - opacity)})`);
      styleCache.set(key, add(`IFCSURFACESTYLE($,.BOTH.,(${shading}))`));
    }
    return styleCache.get(key);
  };

  viewer.model.updateMatrixWorld(true);
  const productOf = new Map(); // uuid do elemento → entidade IFC (para vãos e preenchimentos)
  for (const el of viewer.elements()) {
    if (el.userData.bim.forma?.vazio || el.userData.bim.linha || el.userData.bim.eixo) continue; // vazios, linhas de desenho e eixos de trabalho não exportam
    const meshes = [];
    el.traverse(o => {
      if (!o.isMesh || !o.visible) return;
      let owner = o;
      while (owner && !owner.userData?.bim) owner = owner.parent;
      if (owner === el) meshes.push(o);
    });
    const items = [];
    for (const m of meshes) {
      const g = m.geometry;
      const pos = g.attributes.position;
      if (!pos || pos.count < 3) continue;
      const v = new THREE.Vector3();
      const coords = [];
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        coords.push(`(${num(v.x)},${num(v.y)},${num(v.z)})`);
      }
      const tri = [];
      const index = g.index;
      const n = index ? index.count : pos.count;
      for (let i = 0; i + 2 < n; i += 3) {
        const a = index ? index.getX(i) : i, b = index ? index.getX(i + 1) : i + 1, c = index ? index.getX(i + 2) : i + 2;
        if (a === b || b === c || a === c) continue;
        tri.push(`(${a + 1},${b + 1},${c + 1})`);
      }
      if (!tri.length) continue;
      const pl = add(`IFCCARTESIANPOINTLIST3D((${coords.join(',')}))`);
      const fs = add(`IFCTRIANGULATEDFACESET(${pl},$,$,(${tri.join(',')}),$)`);
      const mat = baseMaterial(m);
      const mm = Array.isArray(mat) ? mat[0] : mat;
      add(`IFCSTYLEDITEM(${fs},(${styleFor(mm?.color || new THREE.Color(0xcccccc), mm?.transparent ? mm.opacity : 1)}),$)`);
      items.push(fs);
    }
    if (!items.length) continue;
    const bim = el.userData.bim;
    const rep = add(`IFCSHAPEREPRESENTATION(${body},'Body','Tessellation',(${items.join(',')}))`);
    const pds = add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${rep}))`);
    // geometria já está em coordenadas de mundo: posicionada em relação ao edifício (identidade)
    const lp = add(`IFCLOCALPLACEMENT(${bldPl},${axis})`);
    const ent = ifcEntity(bim.type);
    const head = `'${ifcGuid(bim.guid)}',${oh},${str(bim.name || el.name)},$,${str(bim.props?.ObjectType || '')},${lp},${pds},$`;
    // portas/janelas: altura e largura totais = vão que abrem na parede
    const op = bim.opening;
    const overall = op ? `${num(op.height)},${num(op.width)}` : '$,$';
    const prod = ent === 'IFCDOOR' || ent === 'IFCWINDOW'
      ? add(`${ent}(${head},${overall},$,$,$)`)
      : add(`${ent}(${head},$)`);
    productOf.set(el.uuid, prod);
    productsBy.get(levels?.list?.length ? levels.ofElement(el).id : 'default').push(prod);

    const props = Object.entries(bim.props || {}).filter(([k, v]) => v !== '' && v !== null && v !== undefined && k !== 'ExpressID');
    if (props.length) {
      const ps = props.map(([k, val]) => add(`IFCPROPERTYSINGLEVALUE(${str(k)},$,${typeof val === 'number' ? `IFCREAL(${num(val)})` : typeof val === 'boolean' ? `IFCBOOLEAN(.${val ? 'T' : 'F'}.)` : `IFCLABEL(${str(String(val))})`},$)`));
      const pset = add(`IFCPROPERTYSET('${ifcGuid()}',${oh},'BoxBim',$,(${ps.join(',')}))`);
      add(`IFCRELDEFINESBYPROPERTIES('${ifcGuid()}',${oh},$,$,(${prod}),${pset})`);
    }
  }
  // Vãos: um IfcOpeningElement por porta/janela hospedada, que esvazia a parede (IfcRelVoidsElement) e é
  // preenchido pela porta/janela (IfcRelFillsElement). A malha da parede já sai com o vão recortado.
  const BOX_TRIS = [[0, 1, 3], [0, 3, 2], [4, 6, 7], [4, 7, 5], [0, 4, 5], [0, 5, 1], [2, 3, 7], [2, 7, 6], [0, 2, 6], [0, 6, 4], [1, 5, 7], [1, 7, 3]];
  for (const el of viewer.elements()) {
    const w = el.userData.bim.wall;
    if (!w?.openings?.length || !productOf.has(el.uuid)) continue;
    const len = Math.hypot(w.end[0] - w.start[0], w.end[1] - w.start[1]);
    if (len < 1e-6) continue;
    const ux = (w.end[0] - w.start[0]) / len, uy = (w.end[1] - w.start[1]) / len;
    const depth = w.thickness + 0.02; // um pouco mais espesso que a parede, para atravessá-la por inteiro
    for (const o of w.openings) {
      const pts = [];
      for (const du of [-o.width / 2, o.width / 2]) for (const dn of [-depth / 2, depth / 2]) for (const dz of [o.sill, o.sill + o.height]) {
        const u = o.offset + du;
        pts.push(new THREE.Vector3(w.start[0] + ux * u - uy * dn, w.start[1] + uy * u + ux * dn, w.base + dz).applyMatrix4(el.matrixWorld));
      }
      const pl = add(`IFCCARTESIANPOINTLIST3D((${pts.map(v => `(${num(v.x)},${num(v.y)},${num(v.z)})`).join(',')}))`);
      const fs = add(`IFCTRIANGULATEDFACESET(${pl},$,.T.,(${BOX_TRIS.map(t => `(${t.map(i => i + 1).join(',')})`).join(',')}),$)`);
      const rep = add(`IFCSHAPEREPRESENTATION(${body},'Body','Tessellation',(${fs}))`);
      const pds = add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${rep}))`);
      const lp = add(`IFCLOCALPLACEMENT(${bldPl},${axis})`);
      const opening = add(`IFCOPENINGELEMENT('${ifcGuid()}',${oh},'Vão',$,$,${lp},${pds},$,.OPENING.)`);
      add(`IFCRELVOIDSELEMENT('${ifcGuid()}',${oh},$,$,${productOf.get(el.uuid)},${opening})`);
      const fill = productOf.get(o.id);
      if (fill) add(`IFCRELFILLSELEMENT('${ifcGuid()}',${oh},$,$,${opening},${fill})`);
    }
  }

  for (const [lid, prods] of productsBy) {
    if (prods.length) add(`IFCRELCONTAINEDINSPATIALSTRUCTURE('${ifcGuid()}',${oh},$,$,(${prods.join(',')}),${storeyRef.get(lid)})`);
  }

  const ts = new Date().toISOString().slice(0, 19);
  return [
    'ISO-10303-21;', 'HEADER;',
    `FILE_DESCRIPTION(('ViewDefinition [ReferenceView]'),'2;1');`,
    `FILE_NAME(${str(projectName + '.ifc')},'${ts}',('BoxBim'),('BoxBim'),'BoxBim 1.0','BoxBim','');`,
    `FILE_SCHEMA(('IFC4'));`, 'ENDSEC;', 'DATA;', ...lines, 'ENDSEC;', 'END-ISO-10303-21;', '',
  ].join('\n');
}

export { IFC_COLORS };
