// Biblioteca de TIPOS de sistema (paredes, pisos/lajes, pilares, vigas) com CAMADAS, e de MATERIAIS.
// Fica em <pasta de dados>/tipos.json; os tipos de fábrica abaixo são usados enquanto o arquivo não existe.
//
// Camada: { name, material, thickness (m), function }
//   parede: da face externa (esquerda do sentido de desenho) para a interna
//   piso/laje: de cima para baixo (o topo fica na cota do nível)
//   telhado: de cima para baixo (a 1ª camada fica na linha do perfil desenhado; as outras descem)
//   pilar/viga: a 1ª camada é o NÚCLEO (dimensões da instância); as seguintes revestem em volta
import * as THREE from 'three';
import { setMaterialResolver, totalThickness } from './elements.js';
import { setCustomTextures } from './materials.js';

const B = window.boxbim;

export const CATEGORIES = {
  wall: { label: 'Paredes', ifc: 'IfcWall', order: 'externa → interna' },
  slab: { label: 'Pisos e lajes', ifc: 'IfcSlab', order: 'topo → fundo' },
  column: { label: 'Pilares', ifc: 'IfcColumn', order: 'núcleo → revestimentos' },
  beam: { label: 'Vigas', ifc: 'IfcBeam', order: 'núcleo → revestimentos' },
  roof: { label: 'Telhados', ifc: 'IfcRoof', order: 'topo → fundo' },
};

export const FUNCTIONS = ['estrutura', 'núcleo', 'substrato', 'isolamento', 'acabamento', 'membrana'];

export const DEFAULT_MATERIALS = {
  'Concreto': { color: '#a7a9ac' },
  'Bloco cerâmico': { color: '#b8693a' },
  'Bloco de concreto': { color: '#8f9295' },
  'Reboco': { color: '#ded7c8' },
  'Gesso acartonado': { color: '#f1efea' },
  'Lã mineral': { color: '#e6cf62' },
  'Contrapiso': { color: '#9c9a8c' },
  'Piso cerâmico': { color: '#c9b394' },
  'Porcelanato': { color: '#d8d3cb' },
  'Madeira': { color: '#a0703c' },
  'Aço': { color: '#7f8c99' },
  'Vidro': { color: '#9fd3ef', opacity: 0.45 },
  'Impermeabilização': { color: '#3b3b3b' },
  'Isolamento térmico': { color: '#f2e27a' },
  'Telha cerâmica': { color: '#b5522e' },
  'Fibrocimento': { color: '#b9b8b0' },
  'Genérico': { color: '#c4c4c4' },
};

const L = (name, material, thickness, fn = 'acabamento') => ({ name, material, thickness, function: fn });

export const DEFAULT_TYPES = {
  wall: [
    { id: 'parede-alvenaria-14', name: 'Alvenaria 14 + reboco', layers: [L('Reboco externo', 'Reboco', 0.025), L('Bloco cerâmico', 'Bloco cerâmico', 0.14, 'estrutura'), L('Reboco interno', 'Reboco', 0.02)] },
    { id: 'parede-alvenaria-9', name: 'Alvenaria 9 + reboco', layers: [L('Reboco', 'Reboco', 0.02), L('Bloco cerâmico', 'Bloco cerâmico', 0.09, 'estrutura'), L('Reboco', 'Reboco', 0.02)] },
    { id: 'parede-drywall-95', name: 'Drywall 95 (lã mineral)', layers: [L('Gesso acartonado', 'Gesso acartonado', 0.0125), L('Montante + lã mineral', 'Lã mineral', 0.07, 'isolamento'), L('Gesso acartonado', 'Gesso acartonado', 0.0125)] },
    { id: 'parede-concreto-15', name: 'Concreto 15', layers: [L('Concreto', 'Concreto', 0.15, 'estrutura')] },
    { id: 'parede-generica-15', name: 'Genérica 15', layers: [L('Genérico', 'Genérico', 0.15, 'estrutura')] },
  ],
  slab: [
    { id: 'laje-macica-12-acabada', name: 'Laje maciça 12 + contrapiso + piso', layers: [L('Piso cerâmico', 'Piso cerâmico', 0.01), L('Contrapiso', 'Contrapiso', 0.04, 'substrato'), L('Laje de concreto', 'Concreto', 0.12, 'estrutura'), L('Reboco do teto', 'Reboco', 0.015)] },
    { id: 'laje-macica-10', name: 'Laje maciça 10', layers: [L('Concreto', 'Concreto', 0.10, 'estrutura')] },
    { id: 'piso-terreo-impermeabilizado', name: 'Piso térreo impermeabilizado', layers: [L('Porcelanato', 'Porcelanato', 0.012), L('Contrapiso', 'Contrapiso', 0.05, 'substrato'), L('Impermeabilização', 'Impermeabilização', 0.005, 'membrana'), L('Lastro de concreto', 'Concreto', 0.08, 'estrutura')] },
    { id: 'laje-generica-15', name: 'Genérica 15', layers: [L('Genérico', 'Genérico', 0.15, 'estrutura')] },
  ],
  column: [
    { id: 'pilar-concreto-reboco', name: 'Concreto + reboco', layers: [L('Núcleo de concreto', 'Concreto', 0, 'núcleo'), L('Reboco', 'Reboco', 0.02)] },
    { id: 'pilar-concreto', name: 'Concreto aparente', layers: [L('Núcleo de concreto', 'Concreto', 0, 'núcleo')] },
    { id: 'pilar-metalico', name: 'Metálico com proteção', layers: [L('Perfil de aço', 'Aço', 0, 'núcleo'), L('Proteção passiva', 'Gesso acartonado', 0.025, 'isolamento')] },
  ],
  beam: [
    { id: 'viga-concreto-reboco', name: 'Concreto + reboco', layers: [L('Núcleo de concreto', 'Concreto', 0, 'núcleo'), L('Reboco', 'Reboco', 0.015)] },
    { id: 'viga-concreto', name: 'Concreto aparente', layers: [L('Núcleo de concreto', 'Concreto', 0, 'núcleo')] },
    { id: 'viga-metalica', name: 'Metálica', layers: [L('Perfil de aço', 'Aço', 0, 'núcleo')] },
  ],
  roof: [
    { id: 'telhado-ceramico', name: 'Telha cerâmica + madeiramento', layers: [L('Telha cerâmica', 'Telha cerâmica', 0.02), L('Ripas', 'Madeira', 0.025, 'substrato'), L('Caibros', 'Madeira', 0.05, 'estrutura')] },
    { id: 'telhado-sanduiche-50', name: 'Telha metálica sanduíche 50', layers: [L('Chapa de aço', 'Aço', 0.005), L('Isolamento', 'Isolamento térmico', 0.04, 'isolamento'), L('Chapa de aço', 'Aço', 0.005, 'estrutura')] },
    { id: 'telhado-fibrocimento', name: 'Fibrocimento 6 mm', layers: [L('Telha de fibrocimento', 'Fibrocimento', 0.006, 'estrutura')] },
    { id: 'telhado-laje-impermeabilizada', name: 'Laje inclinada impermeabilizada', layers: [L('Impermeabilização', 'Impermeabilização', 0.005, 'membrana'), L('Laje de concreto', 'Concreto', 0.10, 'estrutura')] },
    { id: 'telhado-generico-15', name: 'Genérico 15', layers: [L('Genérico', 'Genérico', 0.15, 'estrutura')] },
  ],
};

const DEFAULT_ACTIVE = { wall: 'parede-alvenaria-14', slab: 'laje-macica-12-acabada', column: 'pilar-concreto-reboco', beam: 'viga-concreto-reboco', roof: 'telhado-ceramico' };

const slug = s => String(s || 'tipo').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'tipo';

export class TypeLibrary extends EventTarget {
  constructor() {
    super();
    this.materials = structuredClone(DEFAULT_MATERIALS);
    this.types = structuredClone(DEFAULT_TYPES);
    this.active = { ...DEFAULT_ACTIVE };
    this.textures = {}; // texturas procedurais próprias: id → { nome, camadas } (materials.js)
    this._mats = new Map();
    setMaterialResolver(name => this.material(name));
  }

  async load() {
    const d = await B.types.load().catch(() => null);
    if (d) {
      this.materials = { ...structuredClone(DEFAULT_MATERIALS), ...(d.materials || {}) };
      this.types = {};
      for (const cat of Object.keys(CATEGORIES)) this.types[cat] = d.types?.[cat]?.length ? d.types[cat] : structuredClone(DEFAULT_TYPES[cat]);
      this.active = { ...DEFAULT_ACTIVE, ...(d.active || {}) };
      this.textures = d.textures || {};
    }
    this._mats.clear();
    this.changed();
  }

  async save() {
    await B.types.save({ format: 'boxbim-tipos', version: 1, materials: this.materials, types: this.types, active: this.active, textures: this.textures });
    this.changed();
  }

  changed() { setCustomTextures(this.textures); this.dispatchEvent(new Event('change')); }

  list(cat) { return this.types[cat] || []; }

  /** Tipo por id ou nome (sem diferenciar maiúsculas); sem ref, o tipo ativo da categoria. */
  get(cat, ref) {
    const list = this.list(cat);
    if (!ref) return list.find(t => t.id === this.active[cat]) || list[0] || null;
    const s = String(ref).toLowerCase();
    return list.find(t => t.id === ref || t.name.toLowerCase() === s) || null;
  }

  thickness(t) { return totalThickness(t?.layers); }

  upsert(cat, type) {
    const list = this.types[cat];
    if (!type.id) {
      let id = slug(`${cat}-${type.name}`), n = 2;
      while (list.some(t => t.id === id)) id = `${slug(`${cat}-${type.name}`)}-${n++}`;
      type.id = id;
    }
    const i = list.findIndex(t => t.id === type.id);
    if (i >= 0) list[i] = type; else list.push(type);
    return type;
  }

  remove(cat, id) {
    if (this.list(cat).length <= 1) throw new Error('Cada categoria precisa de pelo menos um tipo.');
    this.types[cat] = this.list(cat).filter(t => t.id !== id);
    if (this.active[cat] === id) this.active[cat] = this.types[cat][0].id;
  }

  /** Material do three.js para um material da biblioteca (cache por nome + cor). */
  material(name) {
    const def = this.materials[name];
    if (!def) return null;
    const key = `${name}|${def.color}|${def.opacity ?? 1}`;
    if (!this._mats.has(key)) {
      const color = new THREE.Color(def.color);
      const m = new THREE.MeshStandardMaterial({
        color, roughness: 0.85, metalness: name === 'Aço' ? 0.4 : 0.02,
        transparent: (def.opacity ?? 1) < 1, opacity: def.opacity ?? 1, side: THREE.DoubleSide,
      });
      m.name = name;
      // cor do preenchimento de corte nas plantas: o próprio material, um pouco mais escuro
      m.userData.capColor = color.clone().multiplyScalar(0.72).getHex();
      this._mats.set(key, m);
    }
    return this._mats.get(key);
  }

  /** Dados prontos para os construtores de elementos: { layers, typeId, typeName }. */
  spec(cat, ref) {
    const t = this.get(cat, ref);
    if (!t) return {};
    return { layers: structuredClone(t.layers), typeId: t.id, typeName: t.name };
  }
}
