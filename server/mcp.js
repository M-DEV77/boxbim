// SERVIDOR MCP do BoxBim (Model Context Protocol, transporte "Streamable HTTP", sem estado): Claude Desktop/Code e
// outros clientes MCP leem e modelam os projetos do usuário. O que eles criam aparece na hora para quem está com o
// projeto aberto (vai pela mesma sala de tempo real do navegador).
//   POST /mcp   JSON-RPC 2.0 (initialize, tools/list, tools/call, ping)   Authorization: Bearer <token>
//   /api/tokens       GET lista · POST { nome } cria (o token aparece UMA vez) · DELETE /api/tokens/:id revoga
// Os tokens pertencem a um usuário e valem com as permissões dele (dono/editor/leitor de cada projeto).
'use strict';
const crypto = require('crypto');
const db = require('./db');
const { access } = require('./projects');

const PROTOCOL = '2025-06-18';
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const uuid = () => crypto.randomUUID();
const r6 = v => +Number(v).toFixed(6);

// ---------------------------------------------------------------- tokens

function tokenRoutes(app, { requireUser }) {
  app.get('/api/tokens', requireUser(), async (req, res, next) => {
    try {
      const rows = await db.TokenApi.findAll({ where: { UsuarioId: req.user.id }, order: [['createdAt', 'DESC']] });
      res.json({ tokens: rows.map(t => ({ id: t.id, nome: t.nome, prefixo: t.prefixo, criadoEm: t.createdAt, usadoEm: t.usadoEm })) });
    } catch (e) { next(e); }
  });
  app.post('/api/tokens', requireUser(), async (req, res, next) => {
    try {
      const nome = String(req.body?.nome || 'Cliente MCP').slice(0, 80);
      if ((await db.TokenApi.count({ where: { UsuarioId: req.user.id } })) >= 20) return res.status(400).json({ erro: 'Limite de 20 tokens: revogue algum antes.' });
      const token = `bbx_${crypto.randomBytes(32).toString('base64url')}`;
      const t = await db.TokenApi.create({ UsuarioId: req.user.id, nome, hash: sha(token), prefixo: token.slice(0, 10) });
      res.json({ id: t.id, nome, token });
    } catch (e) { next(e); }
  });
  app.delete('/api/tokens/:id', requireUser(), async (req, res, next) => {
    try {
      await db.TokenApi.destroy({ where: { id: req.params.id, UsuarioId: req.user.id } });
      res.json({ ok: true });
    } catch (e) { next(e); }
  });
}

async function userFromToken(req) {
  const m = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') || '');
  if (!m) return null;
  const t = await db.TokenApi.findOne({ where: { hash: sha(m[1]) }, include: db.Usuario });
  if (!t?.Usuario) return null;
  if (!t.usadoEm || Date.now() - new Date(t.usadoEm).getTime() > 60e3) { t.usadoEm = new Date(); await t.save(); }
  return t.Usuario;
}

// ---------------------------------------------------------------- dados do projeto

const levelsOf = p => (p.dados?.niveis?.length ? p.dados.niveis : [{ id: null, nome: 'Nível 0', cota: 0 }]).slice().sort((a, b) => a.cota - b.cota);

function findLevel(p, ref) {
  const lv = levelsOf(p);
  if (ref === undefined || ref === null || ref === '') return lv[0];
  const s = String(ref).toLowerCase();
  const l = lv.find(x => x.id === ref || String(x.nome).toLowerCase() === s);
  if (!l) throw new Error(`Nível "${ref}" não existe. Níveis: ${lv.map(x => x.nome).join(', ')}`);
  return l;
}

const heightOf = (p, lvl) => { const lv = levelsOf(p); const up = lv.find(x => x.cota > lvl.cota + 1e-6); return up ? r6(up.cota - lvl.cota) : 3; };

/** Tipo (camadas) da biblioteca do projeto ou do servidor, por id/nome; sem ref, o ativo. */
async function typeSpec(p, cat, ref) {
  const lib = p.dados?.tipos || (await db.Config.findByPk('tipos'))?.valor || null;
  const list = lib?.types?.[cat] || [];
  if (!list.length) return null;
  const s = ref ? String(ref).toLowerCase() : null;
  const t = s ? list.find(x => x.id === ref || x.name.toLowerCase() === s) : (list.find(x => x.id === lib.active?.[cat]) || list[0]);
  if (!t) throw new Error(`Tipo "${ref}" não existe. Tipos: ${list.map(x => x.name).join(', ')}`);
  return { layers: JSON.parse(JSON.stringify(t.layers)), typeId: t.id, typeName: t.name, thickness: t.layers.reduce((a, l) => a + (Number(l.thickness) || 0), 0) };
}

const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Grava elementos e manda para quem está com o projeto aberto. */
async function upsert(ctx, p, els) {
  await db.sequelize.transaction(async transaction => {
    for (const e of els) {
      const cur = await db.Elemento.findByPk(e.id, { transaction });
      if (cur) { cur.tipo = e.tipo; cur.dados = e.dados; cur.versao += 1; cur.autorId = ctx.user.id; await cur.save({ transaction }); }
      else await db.Elemento.create({ id: e.id, ProjetoId: p.id, tipo: e.tipo, dados: e.dados, autorId: ctx.user.id }, { transaction });
    }
  });
  ctx.realtime.notify(p.id, { t: 'upsert', elementos: els, autor: ctx.user.id });
  await db.Projeto.update({ updatedAt: new Date() }, { where: { id: p.id } });
}

/** Resumo de um elemento para o modelo de IA. */
function summary(e) {
  const b = e.dados?.bim || {};
  const out = { id: e.id, tipo: b.type || e.tipo, nome: b.name || null, nivel: b.props?.Nivel || null };
  if (b.wall) Object.assign(out, { parede: { inicio: b.wall.start, fim: b.wall.end, altura: b.wall.height, espessura: b.wall.thickness, base: b.wall.base, tipo: b.typeName || null } });
  if (b.slab) Object.assign(out, { laje: { pontos: b.slab.points, topo: b.slab.elevation, espessura: b.slab.thickness, furos: b.slab.holes?.length || 0 } });
  if (b.linha) Object.assign(out, { linha: { a: b.linha.a, b: b.linha.b, cota: b.linha.z, arco: !!b.linha.arco } });
  if (b.objectName && !b.sistema) out.objeto = b.objectName;
  const m = e.dados?.matriz;
  if (m && (m[12] || m[13] || m[14])) out.deslocamento = [r6(m[12]), r6(m[13]), r6(m[14])];
  return out;
}

// ---------------------------------------------------------------- ferramentas

const P_PROJ = { projeto: { type: 'string', description: 'id ou nome do projeto (veja listar_projetos)' } };
const PT = { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 };

const TOOLS = [
  { name: 'listar_projetos', description: 'Lista os projetos BIM que o usuário pode abrir (id, nome, papel, número de elementos).', inputSchema: { type: 'object', properties: {} },
    readOnly: true },
  { name: 'ler_projeto', description: 'Níveis (nome e cota em metros) e elementos do projeto, com o resumo de cada um (paredes: início/fim/altura; lajes: contorno; linhas 2D). Coordenadas em metros, Z para cima.',
    inputSchema: { type: 'object', properties: { ...P_PROJ, tipo: { type: 'string', description: 'filtra por tipo IFC (ex.: IfcWall, IfcSlab)' }, limite: { type: 'integer', description: 'máximo de elementos (padrão 200)' } }, required: ['projeto'] }, readOnly: true },
  { name: 'criar_nivel', description: 'Cria um nível (pavimento) no projeto.',
    inputSchema: { type: 'object', properties: { ...P_PROJ, nome: { type: 'string' }, cota: { type: 'number', description: 'cota em metros' } }, required: ['projeto', 'nome', 'cota'] } },
  { name: 'criar_parede', description: 'Cria uma parede reta do ponto inicio ao fim (em planta, metros), num nível. A face externa fica à esquerda do sentido inicio→fim. Altura padrão: até o nível de cima (ou 3 m).',
    inputSchema: { type: 'object', properties: { ...P_PROJ, inicio: PT, fim: PT, nivel: { type: 'string', description: 'nome ou id do nível (padrão: o mais baixo)' }, altura: { type: 'number' }, tipo: { type: 'string', description: 'tipo de parede (camadas), por nome ou id' }, espessura: { type: 'number', description: 'só sem tipo' } }, required: ['projeto', 'inicio', 'fim'] } },
  { name: 'criar_laje', description: 'Cria uma laje/piso pelo contorno em planta (pontos [x, y] em metros), com o topo no nível (+ deslocamento). Furos opcionais.',
    inputSchema: { type: 'object', properties: { ...P_PROJ, pontos: { type: 'array', items: PT, minItems: 3 }, furos: { type: 'array', items: { type: 'array', items: PT } }, nivel: { type: 'string' }, deslocamento: { type: 'number', description: 'topo em relação ao nível (m)' }, tipo: { type: 'string' } }, required: ['projeto', 'pontos'] } },
  { name: 'criar_linhas', description: 'Desenha linhas 2D (polilinha) no plano de um nível. fechar = true liga o último ponto ao primeiro.',
    inputSchema: { type: 'object', properties: { ...P_PROJ, pontos: { type: 'array', items: PT, minItems: 2 }, fechar: { type: 'boolean' }, nivel: { type: 'string' } }, required: ['projeto', 'pontos'] } },
  { name: 'mover_elementos', description: 'Desloca elementos (ids de ler_projeto) de dx, dy, dz metros.',
    inputSchema: { type: 'object', properties: { ...P_PROJ, ids: { type: 'array', items: { type: 'string' } }, dx: { type: 'number' }, dy: { type: 'number' }, dz: { type: 'number' } }, required: ['projeto', 'ids'] } },
  { name: 'apagar_elementos', description: 'Apaga elementos do projeto pelos ids (de ler_projeto).',
    inputSchema: { type: 'object', properties: { ...P_PROJ, ids: { type: 'array', items: { type: 'string' } } }, required: ['projeto', 'ids'] } },
];

async function projectFor(ctx, ref, need = 'leitor') {
  let id = ref;
  if (id && !/^[0-9a-f-]{36}$/i.test(id)) {
    // por nome: entre os do usuário
    const own = await db.Projeto.findAll({ where: { donoId: ctx.user.id } });
    const shared = await db.Membro.findAll({ where: { UsuarioId: ctx.user.id }, include: db.Projeto });
    const all = [...own, ...shared.map(m => m.Projeto).filter(Boolean)];
    const p = all.find(x => x.nome.toLowerCase() === String(ref).toLowerCase());
    if (!p) throw new Error(`Projeto "${ref}" não encontrado. Use listar_projetos.`);
    id = p.id;
  }
  return (await access(id, ctx.user, need)).projeto;
}

const HANDLERS = {
  async listar_projetos(ctx) {
    const own = await db.Projeto.findAll({ where: { donoId: ctx.user.id } });
    const shared = await db.Membro.findAll({ where: { UsuarioId: ctx.user.id }, include: db.Projeto });
    const rows = [...own.map(p => ({ p, papel: 'dono' })), ...shared.filter(m => m.Projeto).map(m => ({ p: m.Projeto, papel: m.papel }))];
    const out = [];
    for (const { p, papel } of rows) out.push({ id: p.id, nome: p.nome, papel, elementos: await db.Elemento.count({ where: { ProjetoId: p.id } }), atualizadoEm: p.updatedAt });
    return out;
  },
  async ler_projeto(ctx, a) {
    const p = await projectFor(ctx, a.projeto);
    const els = await db.Elemento.findAll({ where: { ProjetoId: p.id } });
    const list = els.filter(e => !a.tipo || (e.dados?.bim?.type || e.tipo) === a.tipo);
    const porTipo = {};
    for (const e of els) { const t = e.dados?.bim?.type || e.tipo; porTipo[t] = (porTipo[t] || 0) + 1; }
    const lim = Math.min(1000, Math.max(1, Number(a.limite) || 200));
    return { id: p.id, nome: p.nome, unidade: p.dados?.unidade || 'm', niveis: levelsOf(p).map(l => ({ id: l.id, nome: l.nome, cota: l.cota })), total: els.length, porTipo, elementos: list.slice(0, lim).map(summary), truncado: list.length > lim };
  },
  async criar_nivel(ctx, a) {
    const p = await projectFor(ctx, a.projeto, 'editor');
    const lv = levelsOf(p).filter(l => l.id);
    if (lv.some(l => String(l.nome).toLowerCase() === String(a.nome).toLowerCase())) throw new Error(`Já existe um nível "${a.nome}".`);
    const nivel = { id: uuid(), nome: String(a.nome).slice(0, 80), cota: r6(a.cota) };
    const niveis = [...lv, nivel].sort((x, y) => x.cota - y.cota);
    p.dados = { ...p.dados, niveis };
    await p.save();
    ctx.realtime.notify(p.id, { t: 'projeto', dados: { niveis }, autor: ctx.user.id });
    return { criado: nivel };
  },
  async criar_parede(ctx, a) {
    const p = await projectFor(ctx, a.projeto, 'editor');
    const lvl = findLevel(p, a.nivel);
    const L = Math.hypot(a.fim[0] - a.inicio[0], a.fim[1] - a.inicio[1]);
    if (L < 0.01) throw new Error('Início e fim são o mesmo ponto.');
    const spec = a.espessura && !a.tipo ? null : await typeSpec(p, 'wall', a.tipo);
    const thickness = spec ? spec.thickness : Number(a.espessura) || 0.15;
    const height = Number(a.altura) || heightOf(p, lvl);
    const guid = uuid();
    const bim = {
      type: 'IfcWall', name: 'Parede', guid, levelId: lvl.id, sistema: 'parede',
      wall: { start: a.inicio.map(r6), end: a.fim.map(r6), height, thickness, base: lvl.cota, extendStart: 0, extendEnd: 0, openings: [] },
      layers: spec?.layers || null, typeId: spec?.typeId || null, typeName: spec?.typeName || null,
      props: { Nivel: lvl.nome, Espessura: thickness, Altura: height, Comprimento: r6(L) },
    };
    await upsert(ctx, p, [{ id: guid, tipo: 'IfcWall', dados: { bim, matriz: IDENT } }]);
    return { criado: summary({ id: guid, dados: { bim } }) };
  },
  async criar_laje(ctx, a) {
    const p = await projectFor(ctx, a.projeto, 'editor');
    const lvl = findLevel(p, a.nivel);
    const spec = await typeSpec(p, 'slab', a.tipo);
    const top = r6(lvl.cota + (Number(a.deslocamento) || 0));
    const guid = uuid();
    const slab = { points: a.pontos.map(q => q.map(r6)), elevation: top, thickness: spec?.thickness || 0.15, ...(a.furos?.length ? { holes: a.furos.map(f => f.map(q => q.map(r6))) } : {}) };
    const bim = { type: 'IfcSlab', name: 'Laje', guid, levelId: lvl.id, sistema: 'laje', slab, layers: spec?.layers || null, typeId: spec?.typeId || null, typeName: spec?.typeName || null, props: { Nivel: lvl.nome, Cota: top } };
    await upsert(ctx, p, [{ id: guid, tipo: 'IfcSlab', dados: { bim, matriz: IDENT } }]);
    return { criado: summary({ id: guid, dados: { bim } }) };
  },
  async criar_linhas(ctx, a) {
    const p = await projectFor(ctx, a.projeto, 'editor');
    const lvl = findLevel(p, a.nivel);
    const pts = a.pontos.map(q => q.map(r6));
    if (a.fechar && pts.length > 2) pts.push(pts[0]);
    const els = [];
    for (let i = 1; i < pts.length; i++) {
      const guid = uuid();
      const L = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      els.push({ id: guid, tipo: 'IfcAnnotation', dados: { bim: { type: 'IfcAnnotation', name: 'Linha', guid, levelId: lvl.id, linha: { z: lvl.cota, a: pts[i - 1], b: pts[i], arco: null }, props: { Comprimento: r6(L), Cota: lvl.cota } }, matriz: IDENT } });
    }
    await upsert(ctx, p, els);
    return { criadas: els.map(e => e.id) };
  },
  async mover_elementos(ctx, a) {
    const p = await projectFor(ctx, a.projeto, 'editor');
    const rows = await db.Elemento.findAll({ where: { id: a.ids || [], ProjetoId: p.id } });
    const els = rows.map(e => {
      const m = [...(e.dados?.matriz || IDENT)];
      m[12] = r6(m[12] + (Number(a.dx) || 0)); m[13] = r6(m[13] + (Number(a.dy) || 0)); m[14] = r6(m[14] + (Number(a.dz) || 0));
      return { id: e.id, tipo: e.tipo, dados: { ...e.dados, matriz: m } };
    });
    if (els.length) await upsert(ctx, p, els);
    return { movidos: els.length };
  },
  async apagar_elementos(ctx, a) {
    const p = await projectFor(ctx, a.projeto, 'editor');
    const ids = (a.ids || []).filter(x => typeof x === 'string');
    const n = await db.Elemento.destroy({ where: { id: ids, ProjetoId: p.id } });
    ctx.realtime.notify(p.id, { t: 'remove', ids, autor: ctx.user.id });
    return { apagados: n };
  },
};

// ---------------------------------------------------------------- JSON-RPC

async function handle(ctx, msg) {
  const { id, method, params = {} } = msg || {};
  const ok = result => ({ jsonrpc: '2.0', id, result });
  const fail = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
  if (id === undefined || id === null) return null; // notificação (ex.: notifications/initialized): sem resposta
  switch (method) {
    case 'initialize':
      return ok({
        protocolVersion: params.protocolVersion || PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'boxbim', title: 'BoxBim', version: require('../package.json').version },
        instructions: 'BoxBim: modelagem BIM. Use listar_projetos para achar o projeto, ler_projeto para ver níveis e elementos (metros, Z para cima) e as ferramentas criar_* para modelar. O que você cria aparece ao vivo para quem está com o projeto aberto.',
      });
    case 'ping': return ok({});
    case 'tools/list':
      return ok({ tools: TOOLS.map(({ readOnly, ...t }) => ({ ...t, annotations: { readOnlyHint: !!readOnly, destructiveHint: t.name === 'apagar_elementos' } })) });
    case 'tools/call': {
      const fn = HANDLERS[params.name];
      if (!fn) return fail(-32602, `Ferramenta desconhecida: ${params.name}`);
      try {
        const out = await fn(ctx, params.arguments || {});
        return ok({ content: [{ type: 'text', text: JSON.stringify(out, null, 1) }], structuredContent: Array.isArray(out) ? { itens: out } : out });
      } catch (e) {
        return ok({ content: [{ type: 'text', text: `Erro: ${e.message}` }], isError: true });
      }
    }
    default: return fail(-32601, `Método não suportado: ${method}`);
  }
}

function routes(app, { realtime, requireUser }) {
  tokenRoutes(app, { requireUser });
  app.post('/mcp', async (req, res, next) => {
    try {
      const user = await userFromToken(req);
      if (!user) return res.status(401).set('WWW-Authenticate', 'Bearer realm="boxbim"').json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Token inválido. Gere um em BoxBim › ⚙ Configurações › MCP.' } });
      const ctx = { user, realtime };
      const body = req.body;
      if (Array.isArray(body)) {
        const out = (await Promise.all(body.map(m => handle(ctx, m)))).filter(Boolean);
        return out.length ? res.json(out) : res.status(202).end();
      }
      const out = await handle(ctx, body);
      return out ? res.json(out) : res.status(202).end();
    } catch (e) { next(e); }
  });
  // sem fluxo SSE do servidor (modo sem estado)
  app.get('/mcp', (req, res) => res.status(405).set('Allow', 'POST').end());
  app.delete('/mcp', (req, res) => res.status(200).end());
}

module.exports = { routes, TOOLS };
