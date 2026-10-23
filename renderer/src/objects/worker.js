// Executor isolado dos scripts de OBJETOS (famílias paramétricas em JavaScript).
// Roda num Web Worker: sem DOM, sem acesso ao app (window.boxbim), sem rede. O script só descreve
// primitivas geométricas; quem monta as malhas é a thread principal, a partir desses dados.
//
// O script é o corpo de uma função (p, g):
//   p ... valores dos parâmetros (já convertidos: números em metros/graus, booleanos, textos)
//   g ... API geométrica (unidades em metros, ângulos em graus, Z para cima, origem = ponto de inserção)
//
// Desenho 2D (g.line, g.arc, g.circle) em planos 'xy' / 'xz' / 'yz' ou em EIXOS DE TRABALHO (g.workplane);
// g.extrude e g.sweep fazem sólidos; com { vazio: true } a peça vira um vazio que corta as outras do objeto.
//
// Objetos podem conter outros objetos da biblioteca (g.object), como as famílias aninhadas do Revit:
// parâmetros do objeto de dentro com o MESMO NOME de um parâmetro do objeto de fora recebem o valor dele.
import { coerceParams } from './params.js';

const post = self.postMessage.bind(self);

// Sem rede nem carregamento de código externo dentro do sandbox.
for (const k of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'Worker', 'SharedWorker',
  'indexedDB', 'caches', 'BroadcastChannel', 'WebTransport', 'navigator']) {
  try { Object.defineProperty(self, k, { value: undefined, configurable: false, writable: false }); } catch { /* ignora */ }
}

const MAX_PARTS = 20000;
const MAX_DEPTH = 8;
const DEG = Math.PI / 180;

// ---------------------------------------------------------------- matrizes 4×4 (coluna-maior, como o three.js)

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}

/** Translação + rotação na ordem ZYX (R = Rz·Ry·Rx), igual ao Euler 'ZYX' usado nas peças. */
function trs(x, y, z, rx, ry, rz) {
  const [a, b, c] = [rx * DEG, ry * DEG, rz * DEG];
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c);
  // R = Rz * Ry * Rx
  const m00 = cc * cb, m01 = cc * sb * sa - sc * ca, m02 = cc * sb * ca + sc * sa;
  const m10 = sc * cb, m11 = sc * sb * sa + cc * ca, m12 = sc * sb * ca - cc * sa;
  const m20 = -sb, m21 = cb * sa, m22 = cb * ca;
  return [m00, m10, m20, 0, m01, m11, m21, 0, m02, m12, m22, 0, x, y, z, 1];
}

const isIdentity = m => m.every((v, i) => Math.abs(v - IDENTITY[i]) < 1e-12);

/** Aplica a matriz (coluna-maior) a um ponto / a uma direção. */
const xfPoint = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
const xfDir = (m, d) => [m[0] * d[0] + m[4] * d[1] + m[8] * d[2], m[1] * d[0] + m[5] * d[1] + m[9] * d[2], m[2] * d[0] + m[6] * d[1] + m[10] * d[2]];
const unit = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return v.map(x => +(x / l).toFixed(12)); };

/** Planos fixos de desenho: origem, u (eixo horizontal do desenho) e v (vertical do desenho). */
const BASE_PLANES = {
  xy: { o: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0] },
  xz: { o: [0, 0, 0], u: [1, 0, 0], v: [0, 0, 1] },
  yz: { o: [0, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
};

// ---------------------------------------------------------------- execução

function run({ script, params, library = [], rootId = null }) {
  const parts = [];
  const logs = [];
  const nested = new Map();         // objetos usados dentro deste (id → { name, explicit: nomes informados em g.object })
  let opening = null;
  let depth = 0;                    // 0 = script principal; >0 = dentro de g.object
  let logPrefix = '';
  const chain = rootId ? [rootId] : []; // ids em execução (detecta referência circular)
  const stack = [IDENTITY];
  const n = (v, d = 0) => { const x = Number(v); return Number.isFinite(x) ? x : d; };

  // transformação local da peça (x, y, z, rotX, rotY, rotZ) + matriz acumulada de g.at/g.object
  const place = (o = {}) => {
    const top = stack[stack.length - 1];
    return {
      x: n(o.x), y: n(o.y), z: n(o.z), rotX: n(o.rotX), rotY: n(o.rotY), rotZ: n(o.rotZ),
      m: isIdentity(top) ? null : top,
      color: typeof o.color === 'string' ? o.color : null,
      material: typeof o.material === 'string' ? o.material : null,
      opacity: o.opacity === undefined ? null : Math.min(1, Math.max(0.05, n(o.opacity, 1))),
      name: typeof o.name === 'string' ? o.name.slice(0, 80) : null,
      layer: Number.isInteger(o.layer) ? o.layer : null, // camada do tipo (objetos de sistema)
    };
  };
  // linha do script que criou a peça (o editor usa para ir do clique na prévia ao código)
  const callerLine = () => {
    const m = /<anonymous>:(\d+):\d+/.exec(new Error().stack || '');
    return m ? Number(m[1]) - 3 : null;
  };
  const push = part => {
    if (parts.length >= MAX_PARTS) throw new Error(`Limite de ${MAX_PARTS} peças por objeto.`);
    part.line = callerLine();
    if (depth === 0) {
      // referencial (g.at) e ponto de origem da chamada no script principal: o editor converte o arraste da
      // prévia em deslocamentos nas opções desta linha
      part.cm = part.m;
      part.origin = [part.x, part.y, part.z];
    }
    parts.push(part);
    return parts.length - 1;
  };
  const pts = (list, what) => {
    if (!Array.isArray(list) || list.length < 3) throw new Error(`${what}: informe pelo menos 3 pontos [x, y].`);
    return list.map(p => [n(p[0]), n(p[1])]);
  };
  // eixos de trabalho declarados no script (g.workplane), por nome
  const planes = new Map();
  const workplanes = [];
  /** Plano de desenho: 'xy' | 'xz' | 'yz' | nome de um eixo de trabalho | objeto devolvido por g.workplane. */
  const planeOf = spec => {
    if (spec === undefined || spec === null) return { ...BASE_PLANES.xy, name: 'xy' };
    if (typeof spec === 'string') {
      if (BASE_PLANES[spec]) return { ...BASE_PLANES[spec], name: spec };
      const wp = planes.get(spec);
      if (!wp) throw new Error(`plano "${spec}" não existe (declare antes com g.workplane('${spec}', { … })).`);
      return wp;
    }
    if (spec && Array.isArray(spec.o) && Array.isArray(spec.u) && Array.isArray(spec.v)) return { o: spec.o.map(v => n(v)), u: spec.u.map(v => n(v)), v: spec.v.map(v => n(v)), name: spec.name || null };
    throw new Error('plano inválido (use \'xy\', \'xz\', \'yz\' ou o nome de um eixo de trabalho).');
  };
  const styleOf = (o = {}) => ({
    tipo: typeof o.tipo === 'string' ? o.tipo : 'continua',
    espessura: o.espessura === undefined ? 0.25 : Math.min(5, Math.max(0.05, n(o.espessura, 0.25))),
    cor: typeof o.color === 'string' ? o.color : (typeof o.cor === 'string' ? o.cor : '#2fd18a'),
  });
  const pts2 = (list, what, min = 2) => {
    if (!Array.isArray(list) || list.length < min) throw new Error(`${what}: informe pelo menos ${min} pontos [u, v].`);
    return list.map(p => [n(p[0]), n(p[1])]);
  };
  const solid = o => ({ vazio: !!o.vazio });

  const findDef = ref => {
    const s = String(ref ?? '').toLowerCase();
    return library.find(d => d.id === ref || String(d.name).toLowerCase() === s);
  };

  const g = {
    /** Caixa: largura (X) × profundidade (Y) × altura (Z), base centrada no ponto (x, y, z). */
    box: (w, d, h, o = {}) => push({ kind: 'box', w: n(w), d: n(d), h: n(h), ...solid(o), ...place(o) }),
    /** Cilindro vertical (ou tronco de cone com o.rTop), base no ponto. */
    cylinder: (r, h, o = {}) => push({ kind: 'cylinder', r: n(r), rTop: o.rTop === undefined ? n(r) : n(o.rTop), h: n(h), segments: Math.min(128, Math.max(3, n(o.segments, 32))), ...solid(o), ...place(o) }),
    /** Esfera com centro no ponto. */
    sphere: (r, o = {}) => push({ kind: 'sphere', r: n(r), segments: Math.min(64, Math.max(6, n(o.segments, 24))), ...place(o) }),
    /**
     * Extrusão de um perfil: plane 'xy' (planta, sobe em Z — padrão), 'xz' (avança em Y), 'yz' (avança em X) ou um
     * eixo de trabalho (nome): aí o perfil fica no plano do eixo e sobe na normal dele (u × v).
     */
    extrude: (profile, h, o = {}) => {
      const fixed = ['xy', 'xz', 'yz'].includes(o.plane) || o.plane === undefined;
      return push({
        kind: 'extrude', points: pts(profile, 'extrude'), h: n(h),
        holes: (o.holes || []).map(hole => pts(hole, 'extrude (furo)')),
        plane: fixed ? (o.plane || 'xy') : 'frame', frame: fixed ? null : planeOf(o.plane), ...solid(o), ...place(o),
      });
    },
    /** Varredura: perfil [[u, v], …] ao longo do caminho [[x, y, z], …] (u à esquerda do caminho, v para cima). */
    sweep: (path, profile, o = {}) => {
      if (!Array.isArray(path) || path.length < 2) throw new Error('sweep: o caminho precisa de pelo menos 2 pontos [x, y, z].');
      return push({ kind: 'sweep', path: path.map(p => [n(p[0]), n(p[1]), n(p[2])]), points: pts(profile, 'sweep (perfil)'), closed: !!o.closed, ...solid(o), ...place(o) });
    },
    /**
     * Eixo de trabalho: plano de desenho com nome, na posição (x, y, z) e giro (rotX, rotY, rotZ) dados — o plano
     * XY girado. Ex.: rotX: 90 = vertical (u = X, v = Z). Use o nome em { plane: 'Eixo A' } nas linhas e extrusões.
     */
    workplane: (name, o = {}) => {
      const key = String(name || `Eixo ${planes.size + 1}`).slice(0, 60);
      const m = mul(stack[stack.length - 1], trs(n(o.x), n(o.y), n(o.z), n(o.rotX), n(o.rotY), n(o.rotZ)));
      const wp = Object.freeze({ name: key, o: xfPoint(m, [0, 0, 0]), u: unit(xfDir(m, [1, 0, 0])), v: unit(xfDir(m, [0, 1, 0])) });
      planes.set(key, wp);
      if (depth === 0) workplanes.push({ ...wp, size: Math.max(0.2, n(o.size, 1)), line: callerLine() });
      return wp;
    },
    /** Linha (polilinha) 2D no plano: [[u, v], …]; { plane, closed, tipo, espessura (mm), color }. */
    line: (points, o = {}) => {
      const fr = planeOf(o.plane);
      return push({ kind: 'line', points: pts2(points, 'line'), closed: !!o.closed, frame: fr, plane: fr.name, style: styleOf(o), ...place(o) });
    },
    /** Arco no plano: centro (u, v), raio, ângulos inicial e final em graus (anti-horário). */
    arc: (cu, cv, r, a0, a1, o = {}) => {
      const fr = planeOf(o.plane);
      const arco = { c: [n(cu), n(cv)], r: Math.max(1e-4, n(r)), a0: n(a0) * DEG, a1: n(a1) * DEG };
      if (arco.a1 <= arco.a0) arco.a1 += Math.PI * 2;
      const steps = Math.max(8, Math.ceil((arco.a1 - arco.a0) / (Math.PI / 36)));
      const points = Array.from({ length: steps + 1 }, (_, i) => { const t = arco.a0 + (arco.a1 - arco.a0) * i / steps; return [arco.c[0] + arco.r * Math.cos(t), arco.c[1] + arco.r * Math.sin(t)]; });
      return push({ kind: 'line', points, arco, closed: false, frame: fr, plane: fr.name, style: styleOf(o), ...place(o) });
    },
    /** Círculo no plano: centro (u, v) e raio. */
    circle: (cu, cv, r, o = {}) => g.arc(cu, cv, r, 0, 360, o),
    /** Revolução de um perfil [[raio, z], …] em torno do eixo Z (angle em graus, padrão 360). */
    revolve: (profile, o = {}) => push({
      kind: 'revolve', points: (profile || []).map(p => [Math.max(0, n(p[0])), n(p[1])]),
      segments: Math.min(128, Math.max(3, n(o.segments, 32))), angle: n(o.angle, 360), ...place(o),
    }),
    /** Executa fn com a origem deslocada/girada: g.at({ x, y, z, rotX, rotY, rotZ }, () => { … }). */
    at: (o = {}, fn) => {
      stack.push(mul(stack[stack.length - 1], trs(n(o.x), n(o.y), n(o.z), n(o.rotX), n(o.rotY), n(o.rotZ))));
      try { fn(); } finally { stack.pop(); }
    },
    /**
     * Coloca outro Objeto da biblioteca dentro deste: g.object('Barra de aço', { comprimento: 2.8 }, { x, y, z, rotZ }).
     * Parâmetros do objeto de dentro com o mesmo nome de um parâmetro deste recebem o valor dele
     * (compartilhados); os informados em "valores" têm prioridade.
     */
    object: (ref, values = {}, o = {}) => {
      const def = findDef(ref);
      if (!def) throw new Error(`g.object: o objeto "${ref}" não está na biblioteca.`);
      if (chain.includes(def.id)) throw new Error(`g.object: referência circular (${[...chain, def.id].join(' → ')}).`);
      if (depth >= MAX_DEPTH) throw new Error(`g.object: mais de ${MAX_DEPTH} níveis de objetos aninhados.`);
      const callLine = callerLine();
      const callFrame = stack[stack.length - 1];
      const shared = {};
      for (const p of def.parameters || []) if (p.name in currentParams()) shared[p.name] = currentParams()[p.name];
      const childParams = coerceParams(def, { ...shared, ...(values || {}) });
      if (!nested.has(def.id)) nested.set(def.id, { name: def.name, explicit: new Set() });
      if (depth === 0) Object.keys(values || {}).forEach(k => nested.get(def.id).explicit.add(k));
      const first = parts.length;
      const prevPrefix = logPrefix;
      stack.push(mul(stack[stack.length - 1], trs(n(o.x), n(o.y), n(o.z), n(o.rotX), n(o.rotY), n(o.rotZ))));
      chain.push(def.id);
      depth++;
      logPrefix = `[${def.name}] `;
      paramStack.push(childParams);
      try {
        // eslint-disable-next-line no-new-func
        new Function('p', 'g', `"use strict";\n${def.script}`)(Object.freeze({ ...childParams }), g);
      } catch (err) {
        // cada nível acrescenta o próprio nome ao caminho e aponta para a linha do g.object no script dele;
        // o nível mais externo fica por último, então a linha final é a do script que está sendo editado
        let e2 = err;
        if (err?.nestedLine) e2.message = `"${def.name}" › ${err.message}`;
        else {
          const m = /<anonymous>:(\d+):\d+/.exec(err?.stack || '');
          e2 = new Error(`dentro de "${def.name}"${m ? ` (linha ${Number(m[1]) - 3} dele)` : ''}: ${err?.message || err}`);
        }
        e2.nestedLine = callLine;
        throw e2;
      } finally {
        paramStack.pop();
        logPrefix = prevPrefix;
        depth--;
        chain.pop();
        stack.pop();
      }
      // peças do objeto aninhado apontam para a linha do g.object neste script e guardam o caminho
      // ("Barra" ou "Estribo › Gancho"); o nível mais externo é o último a escrever
      for (let i = first; i < parts.length; i++) {
        parts[i].line = callLine;
        parts[i].nested = parts[i].nested ? `${def.name} › ${parts[i].nested}` : def.name;
        if (depth === 0) {
          parts[i].cm = isIdentity(callFrame) ? null : callFrame;
          parts[i].origin = [n(o.x), n(o.y), n(o.z)];
        }
      }
      return childParams;
    },
    /**
     * Vão que o objeto abre na parede que o hospeda (portas, janelas): largura × altura, com peitoril
     * (o.sill) acima da base da parede e centro deslocado em X (o.x). Vale a última chamada do objeto principal.
     */
    opening: (w, h, o = {}) => {
      if (depth > 0) return;
      opening = { width: Math.max(0, n(w)), height: Math.max(0, n(h)), sill: n(o.sill), x: n(o.x) };
    },
    /** Mensagem para o painel de saída do editor. */
    log: (...a) => { if (logs.length < 200) logs.push(logPrefix + a.map(v => (typeof v === 'object' ? JSON.stringify(v) : String(v))).join(' ')); },
  };
  Object.freeze(g);

  const paramStack = [Object.freeze({ ...params })];
  const currentParams = () => paramStack[paramStack.length - 1];

  // eslint-disable-next-line no-new-func
  const fn = new Function('p', 'g', `"use strict";\n${script}`);
  fn(paramStack[0], g);
  return { parts, logs, opening, workplanes, nested: [...nested].map(([id, v]) => ({ id, name: v.name, explicit: [...v.explicit] })) };
}

self.onmessage = e => {
  const { id } = e.data || {};
  try {
    post({ id, ok: true, ...run(e.data) });
  } catch (err) {
    // linha do erro relativa ao script do usuário (a 1ª linha do corpo é o "use strict")
    const m = /<anonymous>:(\d+):(\d+)/.exec(err?.stack || '');
    post({ id, ok: false, error: String(err?.message || err), line: err?.nestedLine ?? (m ? Number(m[1]) - 3 : null) });
  }
};
