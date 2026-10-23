// OBJETOS: famílias paramétricas do BoxBim (como as famílias carregáveis do Revit), programadas em JavaScript.
//
// Definição (.bbo, JSON):
//   { format: 'boxbim-objeto', version: 1, id, name, category (classe IFC), description, author,
//     parameters: [{ name, label, type, default, min, max, step, options, group }], script }
// Tipos de parâmetro: comprimento (m), numero, inteiro, angulo (graus), booleano, texto, opcao, material, cor
//
// Instância no modelo: THREE.Group posicionado no ponto de inserção, com
//   userData.bim = { type, name, guid, objectId, objectName, params, levelId, props }
import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';
import { sweepGeometry, normalizeGeometry, VOID_MAT } from '../sketch/forms.js';
import { styledLine } from '../sketch/style.js';
import { materialFor, IFC_COLORS, uuid } from '../elements.js';

const B = window.boxbim;

export const PARAM_TYPES = {
  comprimento: 'Comprimento (m)', numero: 'Número', inteiro: 'Inteiro', angulo: 'Ângulo (°)',
  booleano: 'Sim/Não', texto: 'Texto', opcao: 'Opção', material: 'Material', cor: 'Cor',
};

export const OBJECT_CATEGORIES = ['IfcAnnotation', 'IfcFurniture', 'IfcDoor', 'IfcWindow', 'IfcStair', 'IfcRailing', 'IfcColumn', 'IfcBeam',
  'IfcSlab', 'IfcWall', 'IfcRoof', 'IfcCovering', 'IfcMember', 'IfcPlate', 'IfcFlowTerminal', 'IfcSanitaryTerminal',
  'IfcLightFixture', 'IfcBuildingElementProxy'];

// ---------------------------------------------------------------- execução isolada

const TIMEOUT_MS = 3000;
let worker = null;
let seq = 0;
const pending = new Map();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./dist/object-worker.js', location.href));
  worker.onmessage = e => {
    const job = pending.get(e.data?.id);
    if (!job) return;
    pending.delete(e.data.id);
    clearTimeout(job.timer);
    job.resolve(e.data);
  };
  worker.onerror = e => {
    for (const job of pending.values()) { clearTimeout(job.timer); job.resolve({ ok: false, error: e.message || 'Erro no executor de objetos.' }); }
    pending.clear();
    worker?.terminate(); worker = null;
  };
  return worker;
}

/** Executa o script de um objeto no Worker; resolve { ok, parts, logs } ou { ok:false, error, line }. */
/**
 * Executa o script de um objeto no Worker. library = definições disponíveis para g.object (objetos aninhados);
 * rootId = id do objeto executado (impede que ele se inclua).
 */
export function runScript(script, params, library = [], rootId = null) {
  const w = getWorker();
  const id = ++seq;
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      // laço infinito ou cálculo pesado demais: derruba o Worker e cria outro na próxima execução
      pending.delete(id);
      worker?.terminate(); worker = null;
      for (const job of pending.values()) { clearTimeout(job.timer); job.resolve({ ok: false, error: 'Interrompido.' }); }
      pending.clear();
      resolve({ ok: false, error: `O script passou de ${TIMEOUT_MS / 1000} s e foi interrompido (laço infinito?).` });
    }, TIMEOUT_MS);
    pending.set(id, { resolve, timer });
    w.postMessage({ id, script, params, library, rootId });
  });
}

// ---------------------------------------------------------------- parâmetros

export { coerceParams, optionList } from './params.js';
import { coerceParams } from './params.js';

// ---------------------------------------------------------------- geometria

const DEG = Math.PI / 180;

/** Matriz do plano de desenho (u, v, normal = u × v) de uma peça. */
function frameMatrix(f) {
  const u = new THREE.Vector3(...f.u).normalize(), v = new THREE.Vector3(...f.v).normalize();
  return new THREE.Matrix4().makeBasis(u, v, u.clone().cross(v)).setPosition(...f.o);
}

/** Transformação da peça: (x, y, z, rotX, rotY, rotZ) e a acumulada de g.at / g.object. */
function partMatrix(part) {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(part.x, part.y, part.z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(part.rotX * DEG, part.rotY * DEG, part.rotZ * DEG, 'ZYX')),
    new THREE.Vector3(1, 1, 1));
  if (part.m) m.premultiply(new THREE.Matrix4().fromArray(part.m));
  return m;
}

/** Pontos 3D (coordenadas do objeto) de uma linha 2D. */
export function linePartPoints(part) {
  const fm = frameMatrix(part.frame), pm = partMatrix(part);
  const pts = part.points.map(([u, v]) => new THREE.Vector3(u, v, 0).applyMatrix4(fm).applyMatrix4(pm));
  if (part.closed && pts.length > 2) pts.push(pts[0].clone());
  return pts;
}

/** Linha 2D: linha de dados (clicável) + traçado com o estilo (tipo, espessura, cor). */
function buildLine(part) {
  const pts = linePartPoints(part);
  const { base, display } = styledLine(pts, part.style);
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), base);
  line.userData.sketchLine = true;
  if (display) line.add(display);
  return line;
}

function partGeometry(part) {
  let geo;
  switch (part.kind) {
    case 'box':
      geo = new THREE.BoxGeometry(Math.max(part.w, 1e-4), Math.max(part.d, 1e-4), Math.max(part.h, 1e-4));
      geo.translate(0, 0, part.h / 2);
      break;
    case 'cylinder':
      geo = new THREE.CylinderGeometry(Math.max(part.rTop, 0), Math.max(part.r, 1e-4), Math.max(part.h, 1e-4), part.segments);
      geo.rotateX(Math.PI / 2);
      geo.translate(0, 0, part.h / 2);
      break;
    case 'sphere':
      geo = new THREE.SphereGeometry(Math.max(part.r, 1e-4), part.segments, Math.max(4, Math.round(part.segments * 0.66)));
      break;
    case 'extrude': {
      const shape = new THREE.Shape(part.points.map(([x, y]) => new THREE.Vector2(x, y)));
      for (const hole of part.holes || []) shape.holes.push(new THREE.Path(hole.map(([x, y]) => new THREE.Vector2(x, y))));
      geo = new THREE.ExtrudeGeometry(shape, { depth: Math.max(part.h, 1e-4), bevelEnabled: false });
      if (part.plane === 'xz') { geo.rotateX(Math.PI / 2); geo.translate(0, part.h, 0); }          // perfil (x, z), avança em +Y
      else if (part.plane === 'yz') { geo.rotateX(Math.PI / 2); geo.rotateZ(Math.PI / 2); }         // perfil (y, z), avança em +X
      else if (part.plane === 'frame' && part.frame) geo.applyMatrix4(frameMatrix(part.frame));    // eixo de trabalho: sobe na normal
      break;
    }
    case 'sweep':
      geo = sweepGeometry({ caminho: part.path, perfil: part.points, fechado: part.closed });
      break;
    case 'revolve':
      if (part.points.length < 2) return null;
      geo = new THREE.LatheGeometry(part.points.map(([r, z]) => new THREE.Vector2(r, z)), part.segments, 0, Math.max(1, Math.min(360, part.angle)) * DEG);
      geo.rotateX(Math.PI / 2);
      break;
    default: return null;
  }
  // posição/giro da peça e a transformação acumulada de g.at / g.object (objetos aninhados)
  geo.applyMatrix4(partMatrix(part));
  geo.computeVertexNormals();
  return geo;
}

// ---------------------------------------------------------------- vazios (corte dentro do objeto)

const csg = new Evaluator();
csg.useGroups = false;
csg.attributes = ['position', 'normal', 'uv'];

/** Os vazios do objeto ({ vazio: true }) cortam as outras peças que eles tocam. */
function applyVoids(meshes, voids) {
  if (!voids.length) return;
  const vb = voids.map(v => { v.geometry.computeBoundingBox(); return { geo: normalizeGeometry(v.geometry.clone()), box: v.geometry.boundingBox.clone() }; });
  for (const m of meshes) {
    if (!m.isMesh) continue;
    m.geometry.computeBoundingBox();
    const hits = vb.filter(v => v.box.intersectsBox(m.geometry.boundingBox));
    if (!hits.length) continue;
    try {
      let a = new Brush(normalizeGeometry(m.geometry.clone()));
      a.updateMatrixWorld();
      for (const v of hits) {
        const b = new Brush(v.geo);
        b.updateMatrixWorld();
        a = csg.evaluate(a, b, SUBTRACTION);
      }
      m.geometry.dispose();
      m.geometry = a.geometry;
      m.geometry.computeBoundingBox(); m.geometry.computeBoundingSphere();
    } catch (err) { console.warn('vazio do objeto não cortou', err); }
  }
}

/** Monta as malhas das peças devolvidas pelo script (coordenadas locais do objeto). */
export function buildParts(parts, types, category, { showVoids = false } = {}) {
  const meshes = [], voids = [];
  for (const part of parts) {
    if (part.kind === 'line') {
      const line = buildLine(part);
      line.name = part.name || (part.arco ? 'Arco' : 'Linha');
      line.userData.part = { kind: 'line', line: part.line ?? null, nested: part.nested || null, cm: part.cm || null, origin: part.origin || null, data: part };
      meshes.push(line);
      continue;
    }
    const geo = partGeometry(part);
    if (!geo) continue;
    if (part.vazio) {
      // vazio: corta as outras peças; na prévia do editor aparece translúcido, na instância some
      const vm = new THREE.Mesh(geo, VOID_MAT);
      vm.name = part.name || 'Vazio';
      vm.userData.part = { kind: part.kind, vazio: true, line: part.line ?? null, nested: part.nested || null, cm: part.cm || null, origin: part.origin || null };
      vm.userData.noCap = true;
      voids.push(vm);
      continue;
    }
    let mat = part.material && types?.material(part.material);
    if (mat && part.opacity !== null && part.opacity !== undefined && part.opacity < 1) {
      // material da biblioteca com transparência própria da peça (ex.: concreto translúcido para ver a armadura)
      mat = mat.clone();
      mat.transparent = true;
      mat.opacity = part.opacity;
      mat.depthWrite = false;
    }
    if (!mat) {
      const color = part.color ? new THREE.Color(part.color).getHex() : (IFC_COLORS[category] ?? 0xb8c4a8);
      mat = materialFor(color, part.opacity ?? 1);
    }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = part.name || part.kind;
    mesh.userData.part = { kind: part.kind, material: part.material || null, layer: part.layer ?? null, line: part.line ?? null, nested: part.nested || null, cm: part.cm || null, origin: part.origin || null };
    meshes.push(mesh);
  }
  applyVoids(meshes, voids);
  return showVoids ? meshes.concat(voids) : meshes;
}

// ---------------------------------------------------------------- biblioteca e instâncias

export class ObjectLibrary extends EventTarget {
  constructor(types) {
    super();
    this.types = types;
    this.items = [];
  }

  async load() {
    this.items = await B.objects.list();
    this.dispatchEvent(new Event('change'));
    return this.items;
  }

  get(ref) {
    if (!ref) return null;
    const s = String(ref).toLowerCase();
    return this.items.find(o => o.id === ref || o.name.toLowerCase() === s) || null;
  }

  async save(def) {
    const id = await B.objects.save(def);
    await this.load();
    return this.get(id);
  }

  async remove(id) { await B.objects.remove(id); await this.load(); }

  async publish(def) { await B.objects.publish(def); await this.load(); }

  async importFile(file) {
    const id = await B.objects.import(file);
    await this.load();
    return this.get(id);
  }

  async exportFile(id, file) { return B.objects.export(id, file); }

  /**
   * Gera as malhas de um objeto com os valores dados. Lança erro com a linha do script, se houver.
   * extra: dados que não são parâmetros, entregues ao script em p (camadas, perfis, pontos dos objetos de sistema).
   */
  async generate(def, values, extra = null, category = def.category, opts = {}) {
    const params = coerceParams(def, values);
    const library = this.items.filter(o => !o.broken).map(({ id, name, parameters, script }) => ({ id, name, parameters, script }));
    const r = await runScript(def.script, extra ? { ...params, ...extra } : params, library, def.id || null);
    if (!r.ok) {
      const err = new Error(`${def.name}: ${r.error}${r.line ? ` (linha ${r.line})` : ''}`);
      err.line = r.line;
      err.logs = r.logs;
      throw err;
    }
    const meshes = buildParts(r.parts, this.types, category, { showVoids: !!opts.showVoids });
    return { params, meshes, logs: r.logs, count: r.parts.length, opening: r.opening || fallbackOpening(def, meshes.filter(m => !m.userData.part?.vazio)), nested: r.nested || [], parts: r.parts, workplanes: r.workplanes || [] };
  }

  /** Cria uma instância no ponto (x, y, z absoluto) com rotação em Z (graus). */
  async createInstance(def, { position = [0, 0, 0], rotation = 0, values = {}, level } = {}) {
    const { params, meshes, opening, nested } = await this.generate(def, values);
    const g = new THREE.Group();
    g.name = def.name;
    g.position.set(position[0], position[1], position[2] || 0);
    g.rotation.z = rotation * DEG;
    meshes.forEach(m => g.add(m));
    g.userData.bim = {
      type: def.category || 'IfcBuildingElementProxy', name: def.name, guid: uuid(),
      objectId: def.id, objectName: def.name, params, levelId: level?.id || null, opening,
      nested: nested.map(x => x.id), // objetos aninhados (para atualizar quando eles mudarem)
      props: { Objeto: def.name, ...(level ? { Nivel: level.name } : {}), ...labelledParams(def, params) },
    };
    return g;
  }

  /** Regenera uma instância depois de mudar parâmetros (ou depois de editar o objeto na biblioteca). */
  async regenerate(el, values) {
    const b = el.userData.bim;
    if (b.sistema && this.system) return this.system.build(el, values); // parede, laje, pilar, viga, caixa
    const def = this.get(b.objectId) || this.get(b.objectName);
    if (!def) throw new Error(`O objeto "${b.objectName}" não está na biblioteca.`);
    const { params, meshes, opening, nested } = await this.generate(def, { ...b.params, ...(values || {}) });
    for (const c of [...el.children]) { el.remove(c); c.traverse(o => o.geometry?.dispose()); }
    meshes.forEach(m => el.add(m));
    b.params = params;
    b.opening = opening;
    b.nested = nested.map(x => x.id);
    b.objectId = def.id;
    b.type = def.category || b.type;
    const keep = { Objeto: def.name, ...(b.props?.Nivel ? { Nivel: b.props.Nivel } : {}) };
    b.props = { ...keep, ...labelledParams(def, params) };
    return el;
  }
}

/** Objeto de sistema (usado pelas ferramentas Parede, Laje, Pilar, Viga, Caixa): 'parede' | 'laje' | … ou null. */
export const systemKind = def => def?.sistema || null;

/** Objeto hospedável: declara g.opening() ou é porta/janela. */
export const isHostable = def => HOSTED_CATEGORIES.has(def?.category) || /g\.opening\s*\(/.test(def?.script || '');
const HOSTED_CATEGORIES = new Set(['IfcDoor', 'IfcWindow']);

/** Porta/janela sem g.opening(): o vão é a caixa envolvente do próprio objeto (em coordenadas locais). */
function fallbackOpening(def, meshes) {
  if (!HOSTED_CATEGORIES.has(def.category) || !meshes.length) return null;
  const box = new THREE.Box3();
  meshes.forEach(m => box.expandByObject(m));
  return { width: box.max.x - box.min.x, height: box.max.z - box.min.z, sill: box.min.z, x: (box.min.x + box.max.x) / 2 };
}

function labelledParams(def, params) {
  const out = {};
  for (const p of def.parameters || []) out[p.label || p.name] = params[p.name];
  return out;
}

/** Novo objeto em branco (modelo para o editor). */
export function blankObject() {
  return {
    format: 'boxbim-objeto', version: 1, name: 'Novo objeto', category: 'IfcFurniture', description: '', author: '',
    parameters: [
      { name: 'largura', label: 'Largura', type: 'comprimento', default: 1, min: 0.1, max: 10, group: 'Dimensões' },
      { name: 'profundidade', label: 'Profundidade', type: 'comprimento', default: 0.6, min: 0.1, max: 10, group: 'Dimensões' },
      { name: 'altura', label: 'Altura', type: 'comprimento', default: 0.8, min: 0.1, max: 10, group: 'Dimensões' },
      { name: 'material', label: 'Material', type: 'material', default: 'Madeira', group: 'Materiais' },
    ],
    script: `// p = parâmetros · g = geometria (metros, graus, Z para cima, origem no ponto de inserção)
g.box(p.largura, p.profundidade, p.altura, { material: p.material, name: 'Corpo' });
g.log('volume (m³):', (p.largura * p.profundidade * p.altura).toFixed(3));
`,
  };
}
