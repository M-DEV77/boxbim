// SISTEMA DE MATERIAIS: padrões procedurais (sem arquivos de imagem). Cada padrão gera os seus mapas — cor,
// relevo fino (bump), normal, oclusão ambiente (AO), deslocamento (altura, por paralaxe), rugosidade (o brilho/
// glossiness é 1 − rugosidade), metal, especular, opacidade (recorte) e emissão — e o material da biblioteca
// escolhe quais usar e com que intensidade (tipos.json › materials[nome].render).
//
// As texturas usam UVs em metros projetadas em caixa (boxUv): a mesma escala real em qualquer face, e o path
// tracing enxerga os mesmos mapas (ele ignora AO, bump e paralaxe, que ele mesmo calcula ou não precisa).
// Além dos padrões de fábrica, o projeto pode ter TEXTURAS PRÓPRIAS ('tx:<id>'), feitas de camadas de geradores.
import * as THREE from 'three';

export const PATTERNS = {
  nenhuma: 'Nenhuma', concreto: 'Concreto', reboco: 'Reboco', tijolo: 'Tijolo', ceramica: 'Cerâmica',
  pastilha: 'Pastilha', madeira: 'Madeira', ripado: 'Ripado (vazado)', metal: 'Metal escovado',
  perfurado: 'Chapa perfurada', pedra: 'Pedra', grama: 'Grama',
};

/** Os mapas que cada padrão gera (nome → rótulo); a ordem é a dos quadros do editor. */
export const MAPS = {
  cor: 'Cor', relevo: 'Relevo (bump)', normal: 'Normal', ao: 'Oclusão (AO)', deslocamento: 'Deslocamento',
  rugosidade: 'Rugosidade', brilho: 'Brilho', metal: 'Metal', especular: 'Especular', opacidade: 'Opacidade', emissao: 'Emissão',
};

/** Valores de um material sem nada gravado. */
const BASE = {
  textura: 'nenhuma', escala: 1, rugosidade: 0.8, metal: 0, transmissao: 0,
  relevo: 0.5, normal: 1, ao: 1, deslocamento: 0,
  mapaRugosidade: true, mapaMetal: false,
  especular: 1, corEspecular: '#ffffff', mapaEspecular: false,
  mapaOpacidade: false,
  emissao: '#000000', intensidadeEmissao: 0, mapaEmissao: false,
};

/** Padrões por nome de material (o que o usuário gravar no material tem prioridade). */
const DEFAULTS = {
  'Concreto': { rugosidade: 0.9, textura: 'concreto', escala: 1.2 },
  'Bloco cerâmico': { rugosidade: 0.85, textura: 'tijolo', escala: 0.6, deslocamento: 0.6 },
  'Bloco de concreto': { rugosidade: 0.9, textura: 'tijolo', escala: 0.8, deslocamento: 0.5 },
  'Reboco': { rugosidade: 0.95, textura: 'reboco', escala: 0.6 },
  'Gesso acartonado': { rugosidade: 0.9, textura: 'reboco', escala: 1.5, normal: 0.4 },
  'Lã mineral': { rugosidade: 1, textura: 'reboco', escala: 0.3 },
  'Contrapiso': { rugosidade: 0.95, textura: 'concreto', escala: 0.8 },
  'Piso cerâmico': { rugosidade: 0.35, textura: 'ceramica', escala: 0.9, especular: 1 },
  'Porcelanato': { rugosidade: 0.2, textura: 'ceramica', escala: 1.2 },
  'Madeira': { rugosidade: 0.55, textura: 'madeira', escala: 1.2 },
  'Aço': { rugosidade: 0.35, metal: 0.9, textura: 'metal', escala: 0.5, mapaMetal: true },
  'Vidro': { rugosidade: 0.03, transmissao: 1 },
  'Impermeabilização': { rugosidade: 0.6 },
  'Isolamento térmico': { rugosidade: 1, textura: 'reboco', escala: 0.4 },
  'Telha cerâmica': { rugosidade: 0.7, textura: 'tijolo', escala: 0.5 },
  'Terreno': { rugosidade: 1, textura: 'grama', escala: 2.5, normal: 0.9 },
};

/** Propriedades de render de um material da biblioteca (base + padrões do nome + o que estiver gravado). */
export function materialProps(name, def = {}) {
  return { ...BASE, ...(DEFAULTS[name] || {}), ...(def.render || {}) };
}

// ---------------------------------------------------------------- campos procedurais

const SIZE = 512;

/** Ruído de valor periódico (repete a cada "period" células): texturas sem emenda. */
function makeNoise(seed = 1) {
  const hash = (x, y) => {
    let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
    h = (h ^ (h >>> 13)) * 1274126177 | 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const smooth = t => t * t * (3 - 2 * t);
  const value = (u, v, period) => {
    const x = u * period, y = v * period;
    const xi = Math.floor(x), yi = Math.floor(y), xf = smooth(x - xi), yf = smooth(y - yi);
    const m = i => ((i % period) + period) % period;
    const a = hash(m(xi), m(yi)), b = hash(m(xi + 1), m(yi)), c = hash(m(xi), m(yi + 1)), d = hash(m(xi + 1), m(yi + 1));
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
  return (u, v, base = 4, octaves = 4) => {
    let s = 0, amp = 0.5, norm = 0;
    for (let o = 0; o < octaves; o++) { s += amp * value(u, v, base << o); norm += amp; amp *= 0.5; }
    return s / norm;
  };
}

function tone(a, b) {
  let h = (a * 73856093) ^ (b * 19349663);
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);
const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/**
 * Um texel do padrão em (u, v) ∈ [0, 1)²; o quadro inteiro cobre "escala" metros. Preenche:
 * t = tom (multiplica a cor), h = altura (1 = face, 0 = fundo da junta), r = rugosidade relativa,
 * m = máscara de metal, a = opacidade (0 = furo), f = detalhe fino (bump).
 */
function texelFn(kind) {
  if (String(kind).startsWith('tx:')) return customTexel(kind);
  const n = makeNoise(kind.length * 7 + 3), n2 = makeNoise(91), nf = makeNoise(517);
  return (u, v, o) => {
    o.m = 0; o.a = 1; o.f = nf(u, v, 96, 3);
    switch (kind) {
      case 'concreto': {
        const pore = n2(u, v, 64, 2) > 0.8;
        o.t = (0.84 + 0.14 * n(u, v, 6, 5)) * (pore ? 0.82 : 1);
        o.h = pore ? 0.35 : 0.75 + 0.25 * n(u, v, 24, 4);
        o.r = 0.8 + 0.2 * n2(u, v, 16, 3);
        return;
      }
      case 'reboco': o.t = 0.88 + 0.1 * n(u, v, 24, 4); o.h = 0.4 + 0.6 * n(u, v, 32, 5); o.r = 0.9 + 0.1 * o.h; return;
      case 'pedra': {
        const a = n(u, v, 5, 5);
        o.t = 0.7 + 0.3 * a * (0.8 + 0.2 * n2(u, v, 40, 2)); o.h = 0.3 + 0.7 * a; o.r = 0.7 + 0.3 * n2(u, v, 20, 3);
        return;
      }
      case 'grama': o.t = 0.55 + 0.45 * n(u, v, 48, 4) * (0.75 + 0.25 * n2(u, v, 4, 3)); o.h = n(u, v, 48, 4); o.r = 1; return;
      case 'metal': {
        const brush = n(u * 0.02, v, 128, 3);
        o.t = 0.86 + 0.1 * brush + 0.04 * n(u, v, 8, 2); o.h = 0.5 + 0.5 * brush; o.r = 0.65 + 0.35 * n(u * 0.02, v, 64, 2); o.m = 1;
        o.f = brush;
        return;
      }
      case 'perfurado': {
        // furos redondos em malha desencontrada: 8 × 8 por quadro, raio 32% da célula
        const k = 8, rows = Math.floor(v * k), x = u * k + (rows % 2) * 0.5;
        const fx = x - Math.floor(x) - 0.5, fy = v * k - rows - 0.5, d = Math.hypot(fx, fy);
        const brush = n(u * 0.02, v, 128, 3);
        o.a = d < 0.32 ? 0 : 1;
        o.h = d < 0.32 ? 0 : sstep(0.32, 0.4, d);
        o.t = 0.85 + 0.1 * brush; o.r = 0.6 + 0.3 * brush; o.m = 1;
        return;
      }
      case 'tijolo': {
        // 3 fiadas de 20 cm, tijolos de 30 cm, juntas de 1 cm (em um quadro de 60 cm), fiadas desencontradas
        const rows = 3, cols = 2, joint = 0.012;
        const r = Math.floor(v * rows), fy = v * rows - r;
        const x = u * cols + (r % 2) * 0.5, c = Math.floor(x), fx = x - c;
        const dj = Math.min(fy / rows, (1 - fy) / rows, fx / cols, (1 - fx) / cols); // distância à junta (quadro = 1)
        if (dj < joint / 2) { o.t = 1.05 + 0.03 * n(u, v, 32, 2); o.h = 0.15 + 0.1 * n(u, v, 32, 2); o.r = 1; return; }
        o.t = (0.72 + 0.16 * tone(r, ((c % cols) + cols) % cols)) * (0.9 + 0.1 * n(u, v, 16, 4));
        o.h = (0.25 + 0.75 * sstep(joint / 2, joint * 1.6, dj)) * (0.9 + 0.1 * n(u, v, 16, 4));
        o.r = 0.8 + 0.2 * n(u, v, 24, 3);
        return;
      }
      case 'ceramica': case 'pastilha': {
        // cerâmica: 2 × 2 peças por quadro; pastilha: 10 × 10, rejunte proporcionalmente mais largo
        const t = kind === 'ceramica' ? 2 : 10, g = kind === 'ceramica' ? 0.004 : 0.012;
        const cx = Math.floor(u * t), cy = Math.floor(v * t), fx = u * t - cx, fy = v * t - cy;
        const dj = Math.min(fx, 1 - fx, fy, 1 - fy) / t;
        if (dj < g / 2) { o.t = 0.62; o.h = 0.2; o.r = 1; return; }
        const var_ = kind === 'pastilha' ? 0.3 : 0.08;
        o.t = (1 - var_ + var_ * tone(cx, cy)) * (0.97 + 0.03 * n(u, v, 16, 3));
        o.h = 0.4 + 0.6 * sstep(g / 2, g * 1.5, dj);
        o.r = 0.45 + 0.1 * n(u, v, 32, 2);
        return;
      }
      case 'madeira': case 'ripado': {
        // madeira: 4 tábuas ao longo de U com veios ondulados; ripado: 6 ripas com 35% de vão (furo)
        const planks = kind === 'madeira' ? 4 : 6, pl = Math.floor(v * planks), fv = v * planks - pl;
        if (kind === 'ripado' && fv > 0.65) { o.a = 0; o.t = 0.4; o.h = 0; o.r = 1; return; }
        const gap = kind === 'madeira' ? 0.006 : 0.02;
        if (fv < gap) { o.t = 0.45; o.h = 0.1; o.r = 1; return; }
        const warp = n(u, v, 3, 3) * 6;
        const grain = 0.5 + 0.5 * Math.sin((fv * 18 + warp + pl * 3.1) * Math.PI);
        o.t = (0.68 + 0.18 * tone(pl, 7)) * (0.82 + 0.18 * grain) * (0.94 + 0.06 * n(u, v, 64, 2));
        o.h = 0.75 + 0.25 * grain;
        o.r = 0.75 + 0.25 * grain;
        o.f = 0.5 * grain + 0.5 * o.f;
        return;
      }
      default: o.t = 1; o.h = 1; o.r = 1;
    }
  };
}

// ---------------------------------------------------------------- texturas procedurais próprias (camadas)
//
// Uma textura própria é uma pilha de camadas, de cima para baixo. Cada camada tem um GERADOR (um valor 0–1 por
// ponto do quadro), um remapeamento (de → ate, inverter), os CANAIS em que escreve e como (modo, força):
//   canais: tom (multiplica a cor), altura (relevo/normal/AO/deslocamento; 1 = face, 0 = fundo), rugosidade,
//           metal, opacidade (0 = furo), detalhe (bump fino)
//   valores iniciais: tom 1, altura 1, rugosidade 1, metal 0, opacidade 1, detalhe 0,5
// Só dados (nada de código): seguro num projeto compartilhado, editável à mão e pela IA.

export const GENERATORS = {
  constante: { label: 'Constante', params: [] },
  ruido: { label: 'Ruído', params: ['escala', 'oitavas', 'semente'] },
  escovado: { label: 'Escovado (riscos)', params: ['escala', 'oitavas', 'direcao', 'semente'] },
  celulas: { label: 'Células (pedras)', params: ['escala', 'junta', 'bisel', 'semente', 'saida'] },
  ladrilhos: { label: 'Ladrilhos / tijolos', params: ['colunas', 'linhas', 'junta', 'bisel', 'desencontro', 'saida'] },
  listras: { label: 'Listras / tábuas', params: ['escala', 'largura', 'suavidade', 'direcao', 'saida'] },
  pontos: { label: 'Pontos / furos', params: ['escala', 'raio', 'suavidade', 'desencontro', 'saida'] },
  veios: { label: 'Veios (madeira)', params: ['escala', 'distorcao', 'direcao', 'semente'] },
  ondas: { label: 'Ondas', params: ['escala', 'distorcao', 'direcao', 'semente'] },
};

export const LAYER_PARAMS = {
  escala: { label: 'Escala (repetições)', min: 1, max: 256, step: 1, def: 8 },
  oitavas: { label: 'Oitavas', min: 1, max: 6, step: 1, def: 4 },
  semente: { label: 'Semente', min: 0, max: 999, step: 1, def: 1 },
  colunas: { label: 'Colunas', min: 1, max: 64, step: 1, def: 2 },
  linhas: { label: 'Linhas', min: 1, max: 64, step: 1, def: 3 },
  junta: { label: 'Junta (fração)', min: 0, max: 0.3, step: 0.002, def: 0.02 },
  bisel: { label: 'Bisel (fração)', min: 0, max: 0.2, step: 0.002, def: 0.01 },
  desencontro: { label: 'Desencontro', min: 0, max: 1, step: 0.05, def: 0.5 },
  largura: { label: 'Largura cheia', min: 0.02, max: 1, step: 0.01, def: 0.8 },
  suavidade: { label: 'Suavidade', min: 0, max: 0.5, step: 0.01, def: 0.02 },
  raio: { label: 'Raio (fração)', min: 0.02, max: 0.5, step: 0.01, def: 0.3 },
  distorcao: { label: 'Distorção', min: 0, max: 20, step: 0.1, def: 4 },
  direcao: { label: 'Direção', options: { u: 'Horizontal (U)', v: 'Vertical (V)' }, def: 'u' },
  saida: { label: 'Saída', options: { valor: 'Forma (juntas, furos…)', peca: 'Tom aleatório por peça' }, def: 'valor' },
};

export const CHANNELS = { tom: 'Tom (cor)', altura: 'Altura (relevo)', rugosidade: 'Rugosidade', metal: 'Metal', opacidade: 'Opacidade', detalhe: 'Detalhe (bump)' };
export const BLEND = { multiplicar: 'Multiplicar', misturar: 'Misturar', somar: 'Somar', minimo: 'Mínimo', maximo: 'Máximo' };

const fract = x => x - Math.floor(x);
const num = (v, p) => { const d = LAYER_PARAMS[p]; const n = Number(v); return Number.isFinite(n) ? Math.min(d.max, Math.max(d.min, n)) : d.def; };

/** Textura própria limpa e completa (o que vier da tela ou da IA é conferido aqui). */
export function normalizeTexture(t = {}) {
  const camadas = (Array.isArray(t.camadas) ? t.camadas : []).slice(0, 16).map(c => {
    const gerador = GENERATORS[c?.gerador] ? c.gerador : 'ruido';
    const out = { gerador };
    for (const p of GENERATORS[gerador].params) {
      const d = LAYER_PARAMS[p];
      out[p] = d.options ? (d.options[c[p]] ? c[p] : d.def) : num(c[p], p);
    }
    const canais = (Array.isArray(c?.canais) ? c.canais : [c?.canais]).filter(k => CHANNELS[k]);
    out.canais = canais.length ? [...new Set(canais)] : ['tom'];
    out.modo = BLEND[c?.modo] ? c.modo : 'multiplicar';
    out.forca = Number.isFinite(Number(c?.forca)) ? Math.min(1, Math.max(0, Number(c.forca))) : 1;
    out.de = Number.isFinite(Number(c?.de)) ? Number(c.de) : 0;
    out.ate = Number.isFinite(Number(c?.ate)) ? Number(c.ate) : 1;
    out.inverter = !!c?.inverter;
    if (c?.nome) out.nome = String(c.nome).slice(0, 60);
    return out;
  });
  return { nome: String(t.nome || 'Textura').slice(0, 60), camadas };
}

/** Ruído periódico com períodos próprios em U e V (riscos esticados sem emenda). */
function makeNoiseXY(seed) {
  const hash = (x, y) => {
    let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
    h = (h ^ (h >>> 13)) * 1274126177 | 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const sm = t => t * t * (3 - 2 * t);
  const value = (u, v, px, py) => {
    const x = u * px, y = v * py, xi = Math.floor(x), yi = Math.floor(y), xf = sm(x - xi), yf = sm(y - yi);
    const mx = i => ((i % px) + px) % px, my = i => ((i % py) + py) % py;
    const a = hash(mx(xi), my(yi)), b = hash(mx(xi + 1), my(yi)), c = hash(mx(xi), my(yi + 1)), d = hash(mx(xi + 1), my(yi + 1));
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
  return (u, v, px, py, oct = 4) => {
    let s = 0, amp = 0.5, norm = 0;
    for (let o = 0; o < oct; o++) { s += amp * value(u, v, px << o, py << o); norm += amp; amp *= 0.5; }
    return s / norm;
  };
}

/** Função (u, v) → valor 0–1 de uma camada. */
function generator(c) {
  const seed = (c.semente ?? 1) + 7, n = makeNoiseXY(seed), E = Math.max(1, Math.round(c.escala ?? 8));
  const along = (u, v) => (c.direcao === 'v' ? [v, u] : [u, v]); // [ao longo, através]
  const peca = c.saida === 'peca';
  switch (c.gerador) {
    case 'constante': return () => 1;
    case 'ruido': return (u, v) => n(u, v, E, E, c.oitavas);
    case 'escovado': return (u, v) => { const [a, b] = along(u, v); return n(a, b, 1, E * 8, c.oitavas); };
    case 'celulas': {
      // Voronoi periódico: distância à borda da célula (F2 − F1)
      const H = (x, y, k) => tone(((x % E) + E) % E + k * 1013, ((y % E) + E) % E + seed * 7919);
      return (u, v) => {
        const x = u * E, y = v * E, xi = Math.floor(x), yi = Math.floor(y);
        let d1 = 9, d2 = 9, id = 0;
        for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
          const cx = xi + i, cy = yi + j, px = cx + H(cx, cy, 1), py = cy + H(cx, cy, 2);
          const d = Math.hypot(px - x, py - y);
          if (d < d1) { d2 = d1; d1 = d; id = H(cx, cy, 3); } else if (d < d2) d2 = d;
        }
        if (peca) return id;
        const edge = (d2 - d1) / 2 / E; // em frações do quadro
        return sstep(c.junta / 2, c.junta / 2 + c.bisel + 1e-4, edge);
      };
    }
    case 'ladrilhos': {
      const C = Math.round(c.colunas), R = Math.round(c.linhas);
      return (u, v) => {
        const r = Math.floor(v * R), fy = v * R - r;
        const x = u * C + (r % 2) * c.desencontro, col = Math.floor(x), fx = x - col;
        if (peca) return tone(r, ((col % C) + C) % C);
        const dj = Math.min(fy / R, (1 - fy) / R, fx / C, (1 - fx) / C);
        return sstep(c.junta / 2, c.junta / 2 + c.bisel + 1e-4, dj);
      };
    }
    case 'listras': return (u, v) => {
      const [, b] = along(u, v), k = Math.floor(b * E), t = fract(b * E);
      if (peca) return tone(k, 11);
      const s = c.suavidade + 1e-4;
      return sstep(0, s, t) * (1 - sstep(c.largura - s, c.largura, t));
    };
    case 'pontos': return (u, v) => {
      const row = Math.floor(v * E), x = u * E + (row % 2) * c.desencontro, col = Math.floor(x);
      if (peca) return tone(row, ((col % E) + E) % E);
      const d = Math.hypot(fract(x) - 0.5, v * E - row - 0.5);
      return 1 - sstep(c.raio - c.suavidade - 1e-4, c.raio, d);
    };
    case 'veios': return (u, v) => { const [, b] = along(u, v); return 0.5 + 0.5 * Math.sin((b * E + n(u, v, 3, 3, 3) * c.distorcao) * Math.PI * 2); };
    case 'ondas': return (u, v) => { const [a] = along(u, v); return 0.5 + 0.5 * Math.sin((a * E + n(u, v, 2, 2, 2) * c.distorcao / 4) * Math.PI * 2); };
    default: return () => 1;
  }
}

const customTextures = new Map(); // 'tx:<id>' → { def, json }

/** Atualiza o registro de texturas próprias (da biblioteca de tipos); refaz só as que mudaram. */
export function setCustomTextures(textures = {}) {
  const keep = new Set();
  for (const [id, t] of Object.entries(textures || {})) {
    const kind = `tx:${id}`, def = normalizeTexture(t), json = JSON.stringify(def);
    keep.add(kind);
    if (customTextures.get(kind)?.json === json) continue;
    customTextures.set(kind, { def, json });
    forget(kind);
  }
  for (const kind of [...customTextures.keys()]) if (!keep.has(kind)) { customTextures.delete(kind); forget(kind); }
}

function forget(kind) {
  fieldCache.delete(kind);
  for (const k of [...texCache.keys()]) if (k.startsWith(`${kind}|`)) texCache.delete(k);
}

/** Padrões para escolher: os de fábrica e as texturas próprias ('tx:<id>'). */
export function patternList() {
  const out = { ...PATTERNS };
  for (const [kind, { def }] of customTextures) out[kind] = `★ ${def.nome}`;
  return out;
}

export function patternLabel(kind) { return patternList()[kind] || (String(kind).startsWith('tx:') ? '(textura apagada)' : kind); }

/** Texel de uma textura própria: aplica as camadas em ordem sobre os valores iniciais. */
function customTexel(kind) {
  const def = customTextures.get(kind)?.def || { camadas: [] };
  const layers = def.camadas.map(c => ({ c, g: generator(c) }));
  const KEY = { tom: 't', altura: 'h', rugosidade: 'r', metal: 'm', opacidade: 'a', detalhe: 'f' };
  return (u, v, o) => {
    o.t = 1; o.h = 1; o.r = 1; o.m = 0; o.a = 1; o.f = 0.5;
    for (const { c, g } of layers) {
      let x = g(u, v);
      if (c.inverter) x = 1 - x;
      x = c.de + (c.ate - c.de) * x;
      for (const ch of c.canais) {
        const k = KEY[ch], cur = o[k];
        let nv;
        switch (c.modo) {
          case 'misturar': nv = x; break;
          case 'somar': nv = cur + (x - 0.5); break;
          case 'minimo': nv = Math.min(cur, x); break;
          case 'maximo': nv = Math.max(cur, x); break;
          default: nv = cur * x;
        }
        o[k] = cur + (nv - cur) * c.forca;
      }
    }
  };
}

/** Modelos para começar uma textura nova. */
export const TEXTURE_TEMPLATES = {
  vazia: { nome: 'Nova textura', camadas: [{ gerador: 'ruido', escala: 8, canais: ['tom', 'altura'], de: 0.85, ate: 1 }] },
  tijolo: { nome: 'Tijolo aparente', camadas: [
    { nome: 'Juntas', gerador: 'ladrilhos', colunas: 2, linhas: 3, junta: 0.02, bisel: 0.012, desencontro: 0.5, canais: ['altura'], de: 0.15, ate: 1 },
    { nome: 'Argamassa clara', gerador: 'ladrilhos', colunas: 2, linhas: 3, junta: 0.02, bisel: 0.002, desencontro: 0.5, canais: ['tom'], modo: 'misturar', de: 1.15, ate: 0.85 },
    { nome: 'Tom por tijolo', gerador: 'ladrilhos', colunas: 2, linhas: 3, desencontro: 0.5, saida: 'peca', canais: ['tom'], de: 0.8, ate: 1.05 },
    { nome: 'Grão', gerador: 'ruido', escala: 32, canais: ['tom', 'detalhe'], de: 0.88, ate: 1 },
  ] },
  pedra: { nome: 'Pedra rústica', camadas: [
    { nome: 'Pedras', gerador: 'celulas', escala: 5, junta: 0.012, bisel: 0.03, canais: ['altura'], de: 0.1, ate: 1 },
    { nome: 'Tom por pedra', gerador: 'celulas', escala: 5, saida: 'peca', canais: ['tom'], de: 0.7, ate: 1.05 },
    { nome: 'Superfície', gerador: 'ruido', escala: 12, oitavas: 5, canais: ['altura', 'tom', 'detalhe'], de: 0.75, ate: 1 },
    { nome: 'Rugosa', gerador: 'constante', canais: ['rugosidade'], modo: 'misturar', de: 0, ate: 0.9 },
  ] },
  deck: { nome: 'Deck de madeira', camadas: [
    { nome: 'Tábuas', gerador: 'listras', escala: 6, largura: 0.93, suavidade: 0.01, direcao: 'u', canais: ['altura', 'opacidade'], de: 0.05, ate: 1 },
    { nome: 'Veios', gerador: 'veios', escala: 14, distorcao: 5, direcao: 'u', canais: ['tom', 'detalhe'], de: 0.8, ate: 1 },
    { nome: 'Tom por tábua', gerador: 'listras', escala: 6, direcao: 'u', saida: 'peca', canais: ['tom'], de: 0.8, ate: 1 },
  ] },
  chapa: { nome: 'Chapa perfurada fina', camadas: [
    { nome: 'Furos', gerador: 'pontos', escala: 16, raio: 0.28, suavidade: 0.02, desencontro: 0.5, canais: ['opacidade', 'altura'], inverter: true },
    { nome: 'Escovado', gerador: 'escovado', escala: 32, canais: ['tom', 'rugosidade', 'detalhe'], de: 0.75, ate: 1 },
    { nome: 'Metal', gerador: 'constante', canais: ['metal'], modo: 'misturar' },
  ] },
};

const fieldCache = new Map();

/** Campos do padrão (Float32Array SIZE²): tom, altura, rugosidade, metal, opacidade, detalhe fino. */
function fields(kind) {
  if (fieldCache.has(kind)) return fieldCache.get(kind);
  const N = SIZE * SIZE, F = { t: new Float32Array(N), h: new Float32Array(N), r: new Float32Array(N), m: new Float32Array(N), a: new Float32Array(N), f: new Float32Array(N) };
  const px = texelFn(kind), o = {};
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      px(x / SIZE, y / SIZE, o);
      const i = y * SIZE + x;
      F.t[i] = Math.min(1.2, Math.max(0, o.t)); F.h[i] = clamp01(o.h); F.r[i] = clamp01(o.r);
      F.m[i] = o.m; F.a[i] = o.a; F.f[i] = clamp01(o.f);
    }
  }
  fieldCache.set(kind, F);
  return F;
}

/** Desfoque em caixa periódico (imagem integral) — base da oclusão ambiente. */
function boxBlur(src, r) {
  const S = SIZE, tmp = new Float32Array(S * S), out = new Float32Array(S * S), w = 2 * r + 1;
  for (let y = 0; y < S; y++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += src[y * S + ((k + S) % S)];
    for (let x = 0; x < S; x++) {
      tmp[y * S + x] = acc / w;
      acc += src[y * S + ((x + r + 1) % S)] - src[y * S + ((x - r + S) % S)];
    }
  }
  for (let x = 0; x < S; x++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += tmp[((k + S) % S) * S + x];
    for (let y = 0; y < S; y++) {
      out[y * S + x] = acc / w;
      acc += tmp[((y + r + 1) % S) * S + x] - tmp[((y - r + S) % S) * S + x];
    }
  }
  return out;
}

/** Gera a imagem RGBA de um mapa a partir dos campos do padrão. */
function mapPixels(kind, map) {
  const F = fields(kind), S = SIZE, N = S * S, px = new Uint8ClampedArray(N * 4);
  const gray = fn => { for (let i = 0; i < N; i++) { const c = fn(i) * 255; px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = px[i * 4 + 3] = c; } };
  switch (map) {
    case 'cor': gray(i => Math.min(1, F.t[i])); break;
    case 'deslocamento': gray(i => F.h[i]); break;
    case 'relevo': gray(i => 0.55 * F.h[i] + 0.45 * F.f[i]); break;
    case 'rugosidade': gray(i => F.r[i]); break;
    case 'brilho': gray(i => 1 - F.r[i]); break;
    case 'metal': gray(i => F.m[i]); break;
    case 'opacidade': gray(i => F.a[i]); break;
    case 'especular': gray(i => 0.35 + 0.65 * F.h[i]); break;
    case 'emissao': gray(i => F.h[i] * F.a[i]); break;
    case 'ao': {
      const b = boxBlur(F.h, 10);
      gray(i => clamp01(1 - 2.6 * Math.max(0, b[i] - F.h[i])) * (0.88 + 0.12 * F.h[i]));
      break;
    }
    case 'normal': {
      // derivadas centrais da altura; linha 0 = v 0 (DataTexture sem flipY); profundidade de relevo fixa (normalScale ajusta)
      const K = 5;
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const at = (xx, yy) => F.h[((yy + S) % S) * S + ((xx + S) % S)];
          const du = (at(x + 1, y) - at(x - 1, y)) * K, dv = (at(x, y + 1) - at(x, y - 1)) * K;
          const l = Math.hypot(du, dv, 1), i = (y * S + x) * 4;
          px[i] = (-du / l * 0.5 + 0.5) * 255; px[i + 1] = (-dv / l * 0.5 + 0.5) * 255; px[i + 2] = (1 / l * 0.5 + 0.5) * 255; px[i + 3] = 255;
        }
      }
      break;
    }
  }
  return px;
}

const texCache = new Map();

/** Textura-base de um mapa (compartilhada; cada material usa um clone com a própria repetição). */
export function patternTexture(kind, map) {
  const key = `${kind}|${map}`;
  if (texCache.has(key)) return texCache.get(key);
  const tex = new THREE.DataTexture(mapPixels(kind, map), SIZE, SIZE, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.colorSpace = map === 'cor' || map === 'emissao' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.needsUpdate = true;
  texCache.set(key, tex);
  return tex;
}

/** Miniatura (canvas) de um mapa, para o editor. */
export function mapThumbnail(kind, map, size = 72) {
  const tex = patternTexture(kind, map), src = tex.image.data, step = SIZE / size;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const s = ((Math.floor((size - 1 - y) * step)) * SIZE + Math.floor(x * step)) * 4, d = (y * size + x) * 4;
      img.data[d] = src[s]; img.data[d + 1] = src[s + 1]; img.data[d + 2] = src[s + 2]; img.data[d + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

// ---------------------------------------------------------------- UVs em metros (projeção em caixa)

/**
 * UVs em metros pela face dominante de cada vértice (coordenadas locais). Guarda as UVs originais para
 * restoreUv; refaz quando a geometria muda (position.version).
 */
export function boxUv(g) {
  const pos = g?.attributes?.position, nrm = g?.attributes?.normal;
  if (!pos || !nrm) return;
  if (g.userData._boxUvVer === pos.version && g.attributes.uv) return;
  if (!('_bimUv' in g.userData)) g.userData._bimUv = g.attributes.uv || null;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = nrm.getX(i), ny = nrm.getY(i), nz = nrm.getZ(i), ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    let u, v;
    if (ax >= ay && ax >= az) { u = nx >= 0 ? y : -y; v = z; }
    else if (ay >= az) { u = ny >= 0 ? -x : x; v = z; }
    else { u = nz >= 0 ? x : -x; v = y; }
    uv[i * 2] = u; uv[i * 2 + 1] = v;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.userData._boxUvVer = pos.version;
}

export function restoreUv(g) {
  if (!g || !('_bimUv' in g.userData)) return;
  const orig = g.userData._bimUv;
  if (orig) g.setAttribute('uv', orig); else g.deleteAttribute('uv');
  delete g.userData._bimUv;
  delete g.userData._boxUvVer;
}

// ---------------------------------------------------------------- material

/**
 * Deslocamento por paralaxe (POM) no fragmento: o mapa de altura afunda as juntas sem precisar de malha densa;
 * todas as UVs dos mapas recebem o mesmo deslocamento. E o bump passa a valer junto com o mapa normal
 * (o three.js usa um OU outro): o normal dá o relevo das peças, o bump o detalhe fino.
 */
function patchShader(m) {
  m.onBeforeCompile = sh => {
    sh.uniforms.uPlxMap = m.userData.plx.map;
    sh.uniforms.uPlxDepth = m.userData.plx.depth;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
#ifdef USE_PARALLAX
uniform sampler2D uPlxMap;
uniform float uPlxDepth;
#endif`)
      .replace('#include <map_fragment>', `#ifdef USE_PARALLAX
  vec2 plxUv = vMapUv;
  {
    vec3 q0 = dFdx(-vViewPosition), q1 = dFdy(-vViewPosition);
    vec2 st0 = dFdx(vMapUv), st1 = dFdy(vMapUv);
    vec3 N = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
    vec3 q1p = cross(q1, N), q0p = cross(N, q0);
    vec3 T = q1p * st0.x + q0p * st1.x, Bt = q1p * st0.y + q0p * st1.y;
    float det = max(dot(T, T), dot(Bt, Bt));
    float sc = det == 0.0 ? 0.0 : inversesqrt(det);
    vec3 V = normalize(vViewPosition);
    vec3 Vt = vec3(dot(V, T * sc), dot(V, Bt * sc), dot(V, N));
    float layers = mix(28.0, 8.0, abs(Vt.z));
    float dl = 1.0 / layers;
    vec2 dUv = Vt.xy / max(Vt.z, 0.2) * uPlxDepth / layers;
    vec2 cur = vMapUv;
    float d = 0.0, hm = 1.0 - textureGrad(uPlxMap, cur, st0, st1).r;
    for (int i = 0; i < 32; i++) {
      if (d >= hm) break;
      cur -= dUv; d += dl;
      hm = 1.0 - textureGrad(uPlxMap, cur, st0, st1).r;
    }
    vec2 prev = cur + dUv;
    float after = hm - d, before = (1.0 - textureGrad(uPlxMap, prev, st0, st1).r) - d + dl;
    float w = after / (after - before + 1e-5);
    plxUv = mix(cur, prev, clamp(w, 0.0, 1.0));
  }
  vec2 plxOff = plxUv - vMapUv;
  #define vMapUv (vMapUv + plxOff)
  #define vNormalMapUv (vNormalMapUv + plxOff)
  #define vBumpMapUv (vBumpMapUv + plxOff)
  #define vAoMapUv (vAoMapUv + plxOff)
  #define vRoughnessMapUv (vRoughnessMapUv + plxOff)
  #define vMetalnessMapUv (vMetalnessMapUv + plxOff)
  #define vEmissiveMapUv (vEmissiveMapUv + plxOff)
  #define vAlphaMapUv (vAlphaMapUv + plxOff)
  #define vSpecularIntensityMapUv (vSpecularIntensityMapUv + plxOff)
#endif
#include <map_fragment>`)
      .replace('#include <normal_fragment_maps>', `#ifdef USE_NORMALMAP_TANGENTSPACE
  vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
  mapN.xy *= normalScale;
  normal = normalize( tbn * mapN );
#endif
#ifdef USE_BUMPMAP
  normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );
#endif`);
  };
  m.customProgramCacheKey = () => 'boxbim-mat';
}

/** Clona a textura-base do mapa com a repetição do material (reaproveita o clone quando já é o mesmo). */
function setMap(m, slot, kind, map, repeat) {
  const base = kind && kind !== 'nenhuma' && map ? patternTexture(kind, map) : null;
  const cur = m[slot];
  if (!base) {
    if (cur) { m[slot] = null; m.needsUpdate = true; }
    return null;
  }
  if (cur && cur.source === base.source) { cur.repeat.set(repeat, repeat); return cur; }
  const tex = base.clone();
  tex.repeat.set(repeat, repeat);
  if (!cur) m.needsUpdate = true;
  m[slot] = tex;
  return tex;
}

/**
 * Aplica as propriedades de render (materialProps) num MeshPhysicalMaterial: cor, padrão e escala, todos os
 * mapas procedurais e as intensidades. Chamado de novo a cada mudança (atualiza no lugar).
 */
export function applyMaterial(m, name, def = {}) {
  const p = materialProps(name, def);
  if (!m.userData.plx) { m.userData.plx = { map: { value: null }, depth: { value: 0 } }; patchShader(m); }
  const kind = p.textura, on = kind && kind !== 'nenhuma';
  const rep = 1 / Math.max(0.05, p.escala);
  m.color.set(def.color || '#cccccc');

  setMap(m, 'map', kind, 'cor', rep);
  // relevo: bump fino + normal das peças + oclusão + deslocamento (paralaxe)
  setMap(m, 'bumpMap', kind, p.relevo > 0 && 'relevo', rep);
  m.bumpScale = p.relevo;
  setMap(m, 'normalMap', kind, p.normal > 0 && 'normal', rep);
  m.normalScale.set(p.normal, p.normal);
  setMap(m, 'aoMap', kind, p.ao > 0 && 'ao', rep);
  m.aoMapIntensity = p.ao;
  const plx = on && p.deslocamento > 0;
  m.userData.plx.map.value = plx ? patternTexture(kind, 'deslocamento') : null;
  m.userData.plx.depth.value = plx ? (p.deslocamento / 100) * rep : 0; // cm → unidades de UV
  if (!!m.defines?.USE_PARALLAX !== plx) {
    m.defines = { ...(m.defines || {}) };
    if (plx) m.defines.USE_PARALLAX = 1; else delete m.defines.USE_PARALLAX;
    m.needsUpdate = true;
  }

  // superfície
  m.roughness = p.rugosidade;
  setMap(m, 'roughnessMap', kind, p.mapaRugosidade && 'rugosidade', rep);
  m.metalness = p.metal;
  setMap(m, 'metalnessMap', kind, p.mapaMetal && 'metal', rep);
  m.specularIntensity = p.especular;
  m.specularColor.set(p.corEspecular);
  setMap(m, 'specularIntensityMap', kind, p.mapaEspecular && 'especular', rep);

  // transparência: vidro (transmissão), opacidade do material e recorte pelo mapa (furos, vãos do ripado)
  m.transmission = p.transmissao;
  const opacity = p.transmissao > 0 ? 1 : (p.opacidade ?? def.opacity ?? 1);
  const alpha = setMap(m, 'alphaMap', kind, p.mapaOpacidade && 'opacidade', rep);
  const transparent = opacity < 1;
  if (m.transparent !== transparent || (m.alphaTest > 0) !== !!alpha) m.needsUpdate = true;
  m.transparent = transparent;
  m.opacity = opacity;
  m.alphaTest = alpha ? 0.5 : 0;
  m.depthWrite = !transparent;

  // emissão
  m.emissive.set(p.emissao);
  m.emissiveIntensity = p.intensidadeEmissao;
  setMap(m, 'emissiveMap', kind, p.mapaEmissao && 'emissao', rep);
  return p;
}

/** Material de render novo, já com as propriedades do material da biblioteca. */
export function createMaterial(name, def) {
  const m = new THREE.MeshPhysicalMaterial({ side: THREE.DoubleSide, ior: 1.5, thickness: 0.01 });
  m.name = name;
  applyMaterial(m, name, def);
  return m;
}
