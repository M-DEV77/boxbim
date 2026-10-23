// Ponto único de importação/exportação de arquivos do BoxBim.
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { importIfc, exportIfc } from './ifc.js';
import { importDxf, exportDxf } from './dxf.js';
import { exportCollada } from './collada.js';
import { tagImported, materialFor } from '../elements.js';

const B = window.boxbim;

export const IMPORT_FORMATS = {
  rvt: 'Revit (.rvt) — via ponte do Revit',
  ifc: 'IFC (.ifc)',
  dwg: 'AutoCAD DWG (.dwg) — via ODA',
  dxf: 'AutoCAD DXF (.dxf)',
  fbx: 'Autodesk FBX (.fbx)',
  dae: 'COLLADA (.dae)',
  glb: 'glTF binário (.glb)',
  gltf: 'glTF (.gltf)',
  obj: 'Wavefront OBJ (.obj)',
  stl: 'STL (.stl)',
};

export const EXPORT_FORMATS = {
  rvt: 'Revit (.rvt) — via ponte do Revit',
  ifc: 'IFC4 (.ifc)',
  dwg: 'AutoCAD DWG (.dwg) — via ODA',
  dxf: 'AutoCAD DXF (.dxf)',
  fbx: 'Autodesk FBX (.fbx) — via Blender',
  dae: 'COLLADA (.dae)',
  glb: 'glTF binário (.glb)',
  obj: 'Wavefront OBJ (.obj)',
  stl: 'STL (.stl)',
};

export const extOf = p => (p.split('.').pop() || '').toLowerCase();
const baseName = p => p.split(/[\\/]/).pop();
const text = bytes => new TextDecoder().decode(bytes);
const ab = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

/** Os formatos de malha usam Y para cima; o BoxBim usa Z. */
function yUpToZUp(obj) {
  const g = new THREE.Group();
  g.rotation.x = Math.PI / 2;
  g.add(obj);
  return g;
}

/** Arquivos em cm/mm chegam gigantes: normaliza para metros por heurística. */
function autoScale(root, ext, log) {
  const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
  const max = Math.max(size.x, size.y, size.z);
  let s = 1;
  if (max > 5000) s = 0.001;
  else if (max > 500 && (ext === 'fbx' || ext === 'obj')) s = 0.01;
  if (s !== 1) {
    root.scale.multiplyScalar(s);
    log?.(`Escala ajustada para metros (×${s}) — o arquivo parecia estar em ${s === 0.01 ? 'centímetros' : 'milímetros'}.`);
  }
}

// ---------------------------------------------------------------- importação

export async function importFile(viewer, path, { log = () => {}, onProgress, levels } = {}) {
  const ext = extOf(path);
  const name = baseName(path);
  let root;

  if (ext === 'rvt') return importFromRevit(viewer, { path, log, levels });
  const wasEmpty = !viewer.elements().length;
  if (ext === 'dwg') {
    log('Convertendo DWG → DXF com o ODA File Converter…');
    const dxfPath = await B.convert.oda(path, 'DXF');
    root = importDxf(text(await B.file.read(dxfPath)), name);
  } else {
    const bytes = await B.file.read(path);
    switch (ext) {
      case 'ifc': root = await importIfc(bytes, name, onProgress); break;
      case 'dxf': root = importDxf(text(bytes), name); break;
      case 'fbx': root = yUpToZUp(new FBXLoader().parse(ab(bytes), '')); break;
      case 'dae': {
        const dir = path.replace(/[^\\/]+$/, '');
        root = yUpToZUp(new ColladaLoader().parse(text(bytes), 'file:///' + dir.replace(/\\/g, '/')).scene);
        break;
      }
      case 'glb':
      case 'gltf': {
        const gltf = await new Promise((res, rej) => new GLTFLoader().parse(ab(bytes), 'file:///' + path.replace(/[^\\/]+$/, '').replace(/\\/g, '/'), res, rej));
        root = yUpToZUp(gltf.scene);
        break;
      }
      case 'obj': root = yUpToZUp(new OBJLoader().parse(text(bytes))); break;
      case 'stl': {
        const geo = new STLLoader().parse(ab(bytes));
        geo.computeVertexNormals();
        root = new THREE.Mesh(geo, materialFor(0xb8c4a8));
        break;
      }
      default: throw new Error(`Formato não suportado para importação: .${ext}`);
    }
    if (['fbx', 'dae', 'glb', 'gltf', 'obj', 'stl'].includes(ext)) {
      autoScale(root, ext, log);
      // materiais de FBX/OBJ costumam vir sem lado duplo; deixa visível por dentro também
      root.traverse(o => { if (o.isMesh) for (const m of [].concat(o.material)) if (m) m.side = THREE.DoubleSide; });
    }
  }

  const wrapper = root.isGroup && root.name === name ? root : Object.assign(new THREE.Group(), { name }).add(root);
  wrapper.userData.source ??= { format: ext, file: name, path };
  tagImported(wrapper, name);

  // Pavimentos do IFC viram níveis do BoxBim (substituem os padrões se o modelo estava vazio)
  let levelInfo = '';
  const storeys = wrapper.userData.storeys || root.userData?.storeys;
  if (levels && storeys?.length) {
    if (wasEmpty) { levels.replace(storeys); levelInfo = ` ${storeys.length} nível(is) do IFC.`; }
    else { const n = levels.merge(storeys); if (n) levelInfo = ` ${n} nível(is) novo(s) do IFC.`; }
  }
  if (levels) {
    wrapper.traverse(o => {
      const b = o.userData.bim;
      if (b && !b.levelId) b.levelId = levels.ofElement(o).id;
    });
  }
  viewer.add(wrapper, { fit: true });
  const count = wrapper.children.length;
  log(`Importado ${name} (${ext.toUpperCase()}).${levelInfo}`);
  return { name, format: ext, elements: viewer.elements().filter(e => isInside(e, wrapper)).length || count };
}

function isInside(obj, root) {
  for (let o = obj; o; o = o.parent) if (o === root) return true;
  return false;
}

// ---------------------------------------------------------------- exportação

/** Remove o destaque de seleção e os contornos das vistas 2D durante a exportação. */
async function withoutSelection(viewer, fn) {
  const sel = [...viewer.selected];
  viewer.select([]);
  const edges = [];
  viewer.model.traverse(o => { if (o.userData.isEdge) edges.push([o, o.parent]); });
  edges.forEach(([e, p]) => p.remove(e));
  try { return await fn(); } finally {
    edges.forEach(([e, p]) => p.add(e));
    if (sel.length) viewer.select(sel);
  }
}

async function exportGlb(viewer) {
  // glTF é Y para cima: embrulha o modelo numa rotação temporária
  const wrap = new THREE.Group();
  wrap.rotation.x = -Math.PI / 2;
  const parent = viewer.model.parent;
  parent.remove(viewer.model);
  wrap.add(viewer.model);
  wrap.updateMatrixWorld(true);
  try {
    return await new Promise((res, rej) => new GLTFExporter().parse(wrap, res, rej, { binary: true, onlyVisible: true }));
  } finally {
    wrap.remove(viewer.model);
    parent.add(viewer.model);
  }
}

export async function exportFile(viewer, format, path, { log = () => {}, projectName, levels } = {}) {
  if (!viewer.elements().length) throw new Error('O projeto está vazio — nada para exportar.');
  return withoutSelection(viewer, async () => {
    const name = projectName || baseName(path).replace(/\.[^.]+$/, '');
    switch (format) {
      case 'ifc': await B.file.write(path, exportIfc(viewer, { projectName: name, levels })); break;
      case 'dxf': await B.file.write(path, exportDxf(viewer)); break;
      case 'dae': await B.file.write(path, exportCollada(viewer, { title: name })); break;
      case 'glb': await B.file.write(path, new Uint8Array(await exportGlb(viewer))); break;
      case 'obj': {
        const wrap = new THREE.Group(); wrap.rotation.x = -Math.PI / 2;
        const clone = viewer.model.clone(); wrap.add(clone); wrap.updateMatrixWorld(true);
        await B.file.write(path, new OBJExporter().parse(wrap));
        break;
      }
      case 'stl': {
        viewer.model.updateMatrixWorld(true);
        const data = new STLExporter().parse(viewer.model, { binary: true });
        await B.file.write(path, new Uint8Array(data.buffer));
        break;
      }
      case 'fbx': {
        log('Gerando FBX com o Blender…');
        const tmp = await B.file.tmp(name + '.glb');
        await B.file.write(tmp, new Uint8Array(await exportGlb(viewer)));
        await B.convert.blender(tmp, path);
        break;
      }
      case 'dwg': {
        log('Gerando DWG (DXF → ODA File Converter)…');
        const tmp = await B.file.tmp(name + '.dxf');
        await B.file.write(tmp, exportDxf(viewer));
        const out = await B.convert.oda(tmp, 'DWG');
        await B.file.write(path, await B.file.read(out));
        break;
      }
      case 'rvt': {
        log('Gerando IFC e convertendo para RVT no Revit…');
        const ifc = await B.file.tmp(name + '.ifc');
        await B.file.write(ifc, exportIfc(viewer, { projectName: name, levels }));
        await B.revit('/ifc-to-rvt', { ifcPath: ifc, rvtPath: path, open: false });
        break;
      }
      default: throw new Error(`Formato não suportado para exportação: ${format}`);
    }
    log(`Exportado: ${path}`);
    return path;
  });
}

// ---------------------------------------------------------------- Revit

/** Traz para o BoxBim o documento ativo do Revit (ou um .rvt, aberto em segundo plano). */
export async function importFromRevit(viewer, { path, format = 'ifc', log = () => {}, levels } = {}) {
  log(path ? `Pedindo ao Revit para exportar ${baseName(path)}…` : 'Pedindo ao Revit para exportar o modelo ativo…');
  const r = await B.revit('/export', { format, path: path || undefined });
  const file = (r.files || []).find(f => extOf(f) === format) || r.files?.[0];
  if (!file) throw new Error('O Revit não gerou arquivo de exportação.');
  return importFile(viewer, file, { log, levels });
}

/** Envia o projeto do BoxBim para o Revit: vincula (padrão), importa ou abre como novo projeto. */
export async function sendToRevit(viewer, { mode = 'link', format = 'ifc', log = () => {}, levels } = {}) {
  const name = 'BoxBim-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const tmp = await B.file.tmp(`${name}.${format}`);
  await exportFile(viewer, format, tmp, { log, projectName: name, levels });
  const body = { path: tmp, format, link: mode === 'link', open: mode === 'open' };
  const r = await B.revit('/import', body);
  log(`Revit: ${mode === 'open' ? 'aberto como projeto' : mode === 'link' ? 'vinculado ao projeto ativo' : 'importado no projeto ativo'}.`);
  return r;
}
