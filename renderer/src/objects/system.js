// OBJETOS DE SISTEMA: Parede, Piso (laje), Pilar, Viga e Caixa são objetos da biblioteca (.bbo, com "sistema") como os
// demais, editáveis no editor de Objetos. Os elementos continuam guardando os dados de modelagem (eixo da parede,
// contorno da laje, tipo com camadas, vãos…) em userData.bim; daqui sai a geometria, rodando o script do objeto:
//   - parâmetros "dirigidos" (comprimento, altura, espessura…) vêm desses dados;
//   - os demais parâmetros (os que o usuário acrescentar ao objeto) ficam em bim.params, por instância;
//   - camadas, perfis da elevação (com os vãos) e contorno chegam ao script em p.camadas, p.perfis, p.pontos.
// O script desenha num referencial local (ver o cabeçalho de cada objeto); aqui as malhas são levadas ao lugar e
// "assadas" nas coordenadas do modelo, como a geometria nativa — o resto do app (hospedagem, IFC, plantas) não muda.
import * as THREE from 'three';
import { coerceParams } from './params.js';
import { wallProfiles, wallOutline, rebuildElement, applyWallMiter, applySlabShape, roofFrame, roofBands } from '../elements.js';
import { toast } from '../ui.js';

const len2 = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const bboxOf = pts => {
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
};

/** Camadas no formato do script (as do tipo, ou vazio para o elemento genérico). */
const camadas = layers => (layers || []).map(l => ({ nome: l.name, material: l.material || null, espessura: Number(l.thickness) || 0, funcao: l.function || '' }));

/** Eixo horizontal início→fim: matriz com X ao longo do eixo, Y à esquerda, Z para cima, origem no início (cota z). */
function axisFrame(start, end, z) {
  const L = len2(start, end) || 1;
  const ux = (end[0] - start[0]) / L, uy = (end[1] - start[1]) / L;
  return new THREE.Matrix4().makeBasis(new THREE.Vector3(ux, uy, 0), new THREE.Vector3(-uy, ux, 0), new THREE.Vector3(0, 0, 1))
    .setPosition(start[0], start[1], z);
}

const withEnd = (start, end, L) => {
  const d = len2(start, end) || 1;
  return [start[0] + (end[0] - start[0]) / d * L, start[1] + (end[1] - start[1]) / d * L];
};

/**
 * Por tipo de sistema: dados do elemento (bim.<chave>), parâmetros dirigidos (get/set), dados extras do script e
 * o referencial local → modelo.
 */
export const SYSTEM = {
  parede: {
    key: 'wall', tool: 'wall',
    driven: {
      comprimento: { get: (w) => len2(w.start, w.end), set: (w, v) => { if (v > 0.01) w.end = withEnd(w.start, w.end, v); } },
      altura: { get: w => w.height, set: (w, v) => { w.height = v; } },
      espessura: { get: w => w.thickness, set: (w, v, b) => { if (!b.layers) w.thickness = v; }, typed: true },
    },
    extra: (w, b) => {
      const L = len2(w.start, w.end);
      const ops = (w.openings || []).map(o => ({ a: o.offset - o.width / 2, b: o.offset + o.width / 2, z0: o.sill, z1: o.sill + o.height }));
      // perfil próprio (topo inclinado, recorte pelo telhado…) ou o retângulo da altura
      const perfis = (w.perfil?.length ? wallOutline(w, 0, ops) : wallProfiles(-(w.extendStart || 0), L + (w.extendEnd || 0), 0, w.height, ops))
        .map(pr => ({ contorno: pr.outer, furos: pr.holes }));
      return { camadas: camadas(b.layers), perfis, inicio: -(w.extendStart || 0), fim: L + (w.extendEnd || 0) };
    },
    frame: w => axisFrame(w.start, w.end, w.base),
  },
  laje: {
    key: 'slab', tool: 'slab',
    driven: {
      espessura: { get: s => s.thickness, set: (s, v, b) => { if (!b.layers) s.thickness = v; }, typed: true },
      largura: { get: s => bboxOf(s.points)[0], hidden: true },
      profundidade: { get: s => bboxOf(s.points)[1], hidden: true },
    },
    extra: (s, b) => ({ camadas: camadas(b.layers), pontos: s.points.map(p => [p[0], p[1]]), furos: (s.holes || []).map(hl => hl.map(p => [p[0], p[1]])) }),
    frame: s => new THREE.Matrix4().makeTranslation(0, 0, s.elevation),
  },
  pilar: {
    key: 'column', tool: 'column',
    driven: {
      largura: { get: c => c.width, set: (c, v) => { c.width = v; } },
      profundidade: { get: c => c.depth, set: (c, v) => { c.depth = v; } },
      altura: { get: c => c.height, set: (c, v) => { c.height = v; } },
      circular: { get: c => !!c.round, set: (c, v) => { c.round = !!v; } },
    },
    extra: (c, b) => ({ camadas: camadas(b.layers) }),
    frame: c => new THREE.Matrix4().makeTranslation(c.position[0], c.position[1], c.base),
  },
  viga: {
    key: 'beam', tool: 'beam',
    driven: {
      comprimento: { get: bm => len2(bm.start, bm.end), set: (bm, v) => { if (v > 0.01) bm.end = withEnd(bm.start, bm.end, v); } },
      largura: { get: bm => bm.width, set: (bm, v) => { bm.width = v; } },
      altura: { get: bm => bm.height, set: (bm, v) => { bm.height = v; } },
    },
    extra: (bm, b) => ({ camadas: camadas(b.layers) }),
    frame: bm => axisFrame(bm.start, bm.end, bm.top),
  },
  telhado: {
    key: 'roof', tool: 'roof',
    driven: {
      comprimento: { get: r => r.fim - r.inicio, set: (r, v) => { if (v > 0.01) r.fim = r.inicio + v; } },
    },
    // seções das camadas já prontas no plano do perfil (o script só extruda cada uma)
    extra: (r, b) => {
      const cs = camadas(b.layers);
      const list = cs.length ? cs : [{ nome: 'Genérico', material: null, espessura: 0.15 }];
      return { camadas: list, faixas: roofBands(r, list.map(c => c.espessura)), inicio: r.inicio, profundidade: r.fim - r.inicio };
    },
    frame: r => roofFrame(r),
  },
  caixa: {
    key: 'box', tool: 'box',
    driven: {
      largura: { get: x => x.size[0], set: (x, v) => { x.size[0] = v; } },
      profundidade: { get: x => x.size[1], set: (x, v) => { x.size[1] = v; } },
      altura: { get: x => x.size[2], set: (x, v) => { x.size[2] = v; } },
      material: { get: x => x.material || '', set: (x, v) => { x.material = v || null; } },
      cor: { get: x => x.color || '', set: (x, v) => { x.color = v || null; } },
    },
    extra: () => null,
    frame: x => new THREE.Matrix4().makeTranslation(x.position[0], x.position[1], x.position[2]),
  },
};

export class SystemObjects {
  constructor(app) {
    this.app = app;
    this.failed = new Set(); // objetos com erro já avisados (não repete o aviso a cada parede)
  }

  get library() { return this.app.objects; }

  /** Objeto da biblioteca para o tipo de sistema (o de id igual ao tipo; senão, o primeiro marcado com ele). */
  defFor(kind) {
    const items = this.library.items.filter(o => !o.broken && o.sistema === kind);
    return items.find(o => o.id === kind) || items[0] || null;
  }

  /** Valores dos parâmetros da instância: dirigidos (dos dados do elemento) + os próprios dela. */
  values(el, def) {
    const b = el.userData.bim, sys = SYSTEM[b.sistema], data = b[sys.key];
    const out = { ...(b.params || {}) };
    for (const [name, d] of Object.entries(sys.driven)) {
      if (def.parameters.some(p => p.name === name)) out[name] = d.get(data, b);
    }
    return out;
  }

  /** Muda um parâmetro: dirigido → nos dados do elemento; senão → em bim.params. Depois regenera. */
  async setParam(el, name, value) {
    const b = el.userData.bim, sys = SYSTEM[b.sistema], d = sys?.driven[name];
    if (d?.set) {
      const def = this.defFor(b.sistema);
      const p = def?.parameters.find(x => x.name === name);
      const v = p ? coerceParams({ parameters: [p] }, { [name]: value })[name] : value;
      d.set(b[sys.key], v, b);
      this.syncProps(el);
    } else b.params = { ...(b.params || {}), [name]: value };
    rebuildElement(el); // nativa na hora + script em seguida
    return this.pending(el);
  }

  /** Mantém as propriedades exibidas em dia com os dados do elemento. */
  syncProps(el) {
    const b = el.userData.bim, P = b.props || (b.props = {});
    if (b.column) Object.assign(P, { Largura: b.column.width, Profundidade: b.column.depth, Altura: b.column.height, Circular: !!b.column.round });
    if (b.beam) Object.assign(P, { Largura: b.beam.width, Altura: b.beam.height });
    if (b.box) { P.Dimensoes = b.box.size.join(' x '); if (b.box.material) P.Material = b.box.material; else delete P.Material; }
  }

  /** Promessa da geração em andamento (para quem precisa esperar o script terminar). */
  pending(el) { return el.userData._sys?.promise || Promise.resolve(el); }

  /**
   * Regenera a geometria do elemento pelo script do objeto. Chamado depois de toda montagem nativa; gerações
   * antigas que terminarem depois de uma mais nova são descartadas.
   */
  build(el, values) {
    const b = el.userData.bim;
    const sys = SYSTEM[b.sistema];
    if (!sys || !b[sys.key]) return Promise.resolve(el);
    if (values) for (const [k, v] of Object.entries(values)) {
      if (!sys.driven[k]?.set) b.params = { ...(b.params || {}), [k]: v };
    }
    const def = this.defFor(b.sistema);
    if (!def) return Promise.resolve(el); // sem o objeto na biblioteca: fica a geometria nativa
    // laje com furos e um objeto Laje antigo (que não conhece p.furos): fica a geometria nativa, que fura
    if (b.slab?.holes?.length && !/p\.furos/.test(def.script || '')) return Promise.resolve(el);
    const st = el.userData._sys || (el.userData._sys = { gen: 0 });
    const gen = ++st.gen;
    const data = b[sys.key];
    const extra = sys.extra(data, b);
    const frame = sys.frame(data);
    const layers = b.layers || null;
    st.promise = this.library.generate(def, this.values(el, def), extra, b.type).then(({ params, meshes }) => {
      if (st.gen !== gen) return el; // já existe uma geração mais nova
      this.failed.delete(def.id);
      for (const m of meshes) {
        m.geometry.applyMatrix4(frame);
        if (b.wall || b.beam) applyWallMiter(m.geometry, b.wall || b.beam); // cantos em meia-esquadria
        if (b.slab) m.geometry = applySlabShape(m.geometry, b.slab); // pontos de altura do piso
        m.geometry.computeBoundingBox();
        m.geometry.computeBoundingSphere();
        const li = m.userData.part?.layer;
        if (layers && Number.isInteger(li) && layers[li]) m.userData.layer = { ...layers[li] };
      }
      for (const c of [...el.children]) { el.remove(c); c.traverse(o => o.geometry?.dispose()); }
      meshes.forEach(m => el.add(m));
      b.objectId = def.id;
      b.objectName = def.name;
      // guarda só os valores próprios da instância (os dirigidos vêm dos dados do elemento)
      const own = {};
      for (const p of def.parameters) if (!(p.name in sys.driven)) own[p.name] = params[p.name];
      b.params = own;
      this.afterBuild(el);
      return el;
    }).catch(err => {
      if (st.gen !== gen) return el;
      // erro no script: mantém a geometria nativa e avisa uma vez por objeto
      if (!this.failed.has(def.id)) { this.failed.add(def.id); toast(`Objeto "${def.name}": ${err.message}. Usando a geometria padrão.`, 'error'); }
      return el;
    });
    return st.promise;
  }

  /** Depois de trocar as malhas: destaque de seleção, cortes das plantas, gizmo. */
  afterBuild(el) {
    const v = this.app.viewer;
    if (!el.parent) return; // ainda não entrou no modelo: viewer.add prepara
    if (v.selected.has(el)) v._highlight(el, true);
    v._prepare2D(el);
    if (v.selected.has(el)) this.app.transformTool?.attach();
    v.changed();
  }

  /** Regenera todos os elementos de sistema de um tipo (depois de editar o objeto na biblioteca). */
  async refreshKind(kind) {
    const els = this.app.viewer.elements().filter(e => e.userData.bim.sistema === kind);
    await Promise.all(els.map(e => this.build(e)));
    return els.length;
  }
}
