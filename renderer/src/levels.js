// Níveis do projeto (como no Revit): nome + cota em metros. Cada nível gera uma planta de piso e uma de forro.
// corte = { cutHeight, viewDepth }: plano de corte e profundidade da vista das plantas do nível (relativos à cota).
import * as THREE from 'three';
import { fmtLen } from './units.js';

export class Levels extends EventTarget {
  constructor() {
    super();
    this.list = [];
    this.reset();
  }

  /** Projeto novo: só o Nível 0 (os outros níveis o usuário cria depois). */
  reset() {
    this.list = [{ id: crypto.randomUUID(), name: 'Nível 0', elevation: 0 }];
    this.changed();
  }

  /** Níveis vindos do projeto salvo (mantém os ids, que os elementos referenciam). */
  load(list) {
    if (!list?.length) return;
    this.list = list.map(l => ({ id: l.id || crypto.randomUUID(), name: l.name, elevation: Number(l.elevation) || 0, fixo: !!l.fixo, corte: cleanCut(l.corte) }));
    this.changed();
  }

  changed() {
    this.list.sort((a, b) => a.elevation - b.elevation);
    this.dispatchEvent(new Event('change'));
  }

  /** Aceita id, nome (sem diferenciar maiúsculas) ou o próprio objeto. */
  get(ref) {
    if (!ref) return null;
    if (typeof ref === 'object') return this.list.includes(ref) ? ref : null;
    const s = String(ref).toLowerCase();
    return this.list.find(l => l.id === ref || l.name.toLowerCase() === s) || null;
  }

  add({ name, elevation }) {
    if (this.list.some(l => l.name.toLowerCase() === String(name).toLowerCase())) throw new Error(`Já existe um nível "${name}".`);
    const lvl = { id: crypto.randomUUID(), name: name || this.nextName(), elevation: Number(elevation) || 0 };
    this.list.push(lvl);
    this.changed();
    return lvl;
  }

  /** fixo: nível travado — a cota não muda (nem arrastando a linha) até destravar. */
  update(ref, { name, elevation, fixo, corte }) {
    const lvl = this.get(ref);
    if (!lvl) throw new Error(`Nível não encontrado: ${ref}`);
    if (fixo !== undefined) lvl.fixo = !!fixo;
    if (corte) lvl.corte = cleanCut({ ...cutOf(lvl), ...corte });
    const z = Number(elevation);
    if (lvl.fixo && elevation !== undefined && elevation !== null && elevation !== '' && Math.abs(z - lvl.elevation) > 1e-9) {
      throw new Error(`O nível "${lvl.name}" está fixado (🔒): destrave para mudar a cota.`);
    }
    if (name && name !== lvl.name) {
      if (this.list.some(l => l !== lvl && l.name.toLowerCase() === name.toLowerCase())) throw new Error(`Já existe um nível "${name}".`);
      lvl.name = name;
    }
    if (elevation !== undefined && elevation !== null && elevation !== '') lvl.elevation = Number(elevation);
    this.changed();
    return lvl;
  }

  remove(ref) {
    const lvl = this.get(ref);
    if (!lvl) return false;
    if (this.list.length <= 1) throw new Error('O projeto precisa de pelo menos um nível.');
    this.list = this.list.filter(l => l !== lvl);
    this.changed();
    return true;
  }

  /** Substitui todos os níveis (ex.: vindos do Revit ou de um IFC), mantendo os ids de nomes iguais. */
  replace(levels) {
    const old = new Map(this.list.map(l => [l.name.toLowerCase(), l.id]));
    this.list = levels.map(l => ({ id: old.get(l.name.toLowerCase()) || crypto.randomUUID(), name: l.name, elevation: Number(l.elevation) }));
    if (!this.list.length) return this.reset();
    this.changed();
  }

  /** Acrescenta níveis que ainda não existem (mesmo nome ou cota a menos de 1 cm). */
  merge(levels) {
    let added = 0;
    for (const l of levels) {
      if (this.list.some(x => x.name.toLowerCase() === l.name.toLowerCase() || Math.abs(x.elevation - l.elevation) < 0.01)) continue;
      this.list.push({ id: crypto.randomUUID(), name: l.name, elevation: Number(l.elevation) });
      added++;
    }
    if (added) this.changed();
    return added;
  }

  nextName() {
    let i = this.list.length; // começa no Nível 0: o próximo é o Nível 1
    while (this.get(`Nível ${i}`)) i++;
    return `Nível ${i}`;
  }

  above(lvl) { return this.list.find(l => l.elevation > lvl.elevation + 1e-6) || null; }
  below(lvl) { return [...this.list].reverse().find(l => l.elevation < lvl.elevation - 1e-6) || null; }

  /** Altura até o nível de cima (padrão para paredes e pilares). */
  heightOf(lvl, fallback = 3) {
    const up = this.above(lvl);
    return up ? +(up.elevation - lvl.elevation).toFixed(4) : fallback;
  }

  /** Nível que "hospeda" uma cota: o mais alto com cota ≤ z (com 1 cm de tolerância). */
  forZ(z) {
    let best = this.list[0];
    for (const l of this.list) if (l.elevation <= z + 0.01) best = l;
    return best;
  }

  /** Nível do elemento: propriedade Nivel, se existir; senão pela base da caixa envolvente. */
  ofElement(obj) {
    const named = this.get(obj.userData?.bim?.props?.Nivel);
    if (named) return named;
    const box = new THREE.Box3().setFromObject(obj);
    return box.isEmpty() ? this.list[0] : this.forZ(box.min.z);
  }

  toJSON() { return this.list.map(({ name, elevation, corte }) => ({ name, elevation, ...(corte ? { corte } : {}) })); }
}

export const DEFAULT_CUT = { cutHeight: 1.2, viewDepth: -0.3 };
const cleanCut = c => (c && Number.isFinite(Number(c.cutHeight)) ? { cutHeight: Number(c.cutHeight), viewDepth: Number.isFinite(Number(c.viewDepth)) ? Number(c.viewDepth) : DEFAULT_CUT.viewDepth } : null);
/** Configuração de corte do nível (a padrão se ele não tiver uma). */
export const cutOf = lvl => ({ ...DEFAULT_CUT, ...(lvl?.corte || {}) });

export const fmtElev = v => (v >= 0 ? '+' : '−') + fmtLen(Math.abs(v));
