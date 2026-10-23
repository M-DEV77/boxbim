// Chamadas do navegador para o servidor: POST /api/rpc/<canal> { args: [...] } → { ok, value } | { ok:false, error }.
// São os mesmos canais da versão desktop (window.boxbim.*), agora com usuário, projeto (cabeçalho X-Projeto) e
// permissões:
//   - configurações (chaves de IA, caminhos de ferramentas): só o administrador altera;
//   - arquivos: só dentro da pasta de trabalho do usuário no servidor (envios, conversões, exportações);
//   - Revit, Unreal e abrir pastas: só quando o navegador está NESTE computador (servidor local).
// Binários viajam como { __b64: '...' }.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const store = require('./lib/store');
const ai = require('./lib/ai');
const conv = require('./lib/converters');
const unreal = require('./lib/unreal');
const db = require('./db');
const { access } = require('./projects');

const err = (status, msg) => Object.assign(new Error(msg), { status });

// ---------------------------------------------------------------- binários

function decode(v) {
  if (Array.isArray(v)) return v.map(decode);
  if (v && typeof v === 'object') {
    if (typeof v.__b64 === 'string') return Buffer.from(v.__b64, 'base64');
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = decode(x);
    return o;
  }
  return v;
}
function encode(v) {
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return { __b64: Buffer.from(v).toString('base64') };
  if (Array.isArray(v)) return v.map(encode);
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = encode(x);
    return o;
  }
  return v;
}

// ---------------------------------------------------------------- pastas

/** Pasta de trabalho do usuário no servidor (envios, conversões e exportações). */
function workspace(user) {
  const d = path.join(store.SERVER_DIR, 'trabalho', user.id);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function allowedPath(user, p) {
  const full = path.resolve(String(p || ''));
  const roots = [workspace(user), path.resolve(conv.tmpDir())];
  if (!roots.some(r => full === r || full.startsWith(r + path.sep))) throw err(403, 'Caminho fora da pasta de trabalho.');
  return full;
}

// "Local" = o navegador está no próprio computador do servidor (Revit, Unreal, arquivos). Na nuvem (BOXBIM_REMOTO=1)
// nunca: um proxy reverso na mesma máquina chegaria por 127.0.0.1 e pareceria local.
const isLocal = req => process.env.BOXBIM_REMOTO !== '1' && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);

// ---------------------------------------------------------------- biblioteca (banco)

const plainObj = (row, escopo) => ({
  ...(row.definicao || {}), id: row.objetoId || row.id, escopo,
  preco: row.preco === null || row.preco === undefined ? null : Number(row.preco), unidade: row.unidade || 'un', moeda: row.moeda || 'BRL',
  icone: row.icone || null, miniatura: row.miniatura || null,
});

async function listObjects(pid) {
  const geral = await db.Objeto.findAll({ order: [['nome', 'ASC']] });
  const map = new Map(geral.map(o => [o.id, plainObj(o, 'geral')]));
  if (pid) for (const o of await db.ObjetoProjeto.findAll({ where: { ProjetoId: pid } })) map.set(o.objetoId, plainObj(o, 'projeto'));
  return [...map.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

const META = ['preco', 'unidade', 'moeda', 'icone', 'miniatura'];
function splitDef(o) {
  const def = { ...o };
  const meta = {};
  for (const k of [...META, 'escopo']) { if (k in def) meta[k] = def[k]; delete def[k]; }
  def.format = 'boxbim-objeto';
  if (!def.name || typeof def.script !== 'string' || !Array.isArray(def.parameters)) throw err(400, 'Objeto incompleto: precisa de name, parameters e script.');
  return { def, meta };
}
const metaCols = m => {
  const o = {};
  if ('preco' in m) o.preco = m.preco === '' || m.preco === null || m.preco === undefined || Number.isNaN(Number(m.preco)) ? null : Number(m.preco);
  if ('unidade' in m) o.unidade = String(m.unidade || 'un').slice(0, 10);
  if ('moeda' in m) o.moeda = String(m.moeda || 'BRL').slice(0, 5);
  if ('icone' in m) o.icone = m.icone ? String(m.icone).slice(0, 200000) : null;
  if ('miniatura' in m) o.miniatura = m.miniatura && String(m.miniatura).startsWith('data:image/') ? String(m.miniatura).slice(0, 600000) : null;
  return o;
};

/** Grava um objeto: no projeto (cópia do projeto) ou na biblioteca geral. Objeto novo entra também na geral. */
async function saveObject(ctx, o, { geral = false } = {}) {
  const { def, meta } = splitDef(o);
  const id = def.id || store.slug(def.name);
  def.id = id;
  def.updated = new Date().toISOString();
  const cols = metaCols(meta);
  const g = await db.Objeto.findByPk(id);
  if (!g) await db.Objeto.create({ id, nome: def.name, categoria: def.category, sistema: def.sistema || null, definicao: def, autorId: ctx.user.id, ...cols });
  else if (geral || !ctx.pid) {
    // biblioteca geral é compartilhada: qualquer usuário edita
    Object.assign(g, { nome: def.name, categoria: def.category, sistema: def.sistema || null, definicao: def, ...cols });
    await g.save();
  }
  if (ctx.pid && !geral) {
    const [p] = await db.ObjetoProjeto.findOrCreate({ where: { ProjetoId: ctx.pid, objetoId: id }, defaults: { definicao: def, ...cols } });
    Object.assign(p, { definicao: def, ...cols });
    await p.save();
    ctx.realtime.notify(ctx.pid, { t: 'objeto', id, autor: ctx.user.id });
  }
  return id;
}

async function setObjectMeta(ctx, id, meta, { geral = false } = {}) {
  const cols = metaCols(meta || {});
  if (ctx.pid && !geral) {
    let p = await db.ObjetoProjeto.findOne({ where: { ProjetoId: ctx.pid, objetoId: id } });
    if (!p) {
      const g = await db.Objeto.findByPk(id);
      if (!g) throw err(404, 'Objeto não encontrado.');
      p = await db.ObjetoProjeto.create({ ProjetoId: ctx.pid, objetoId: id, definicao: g.definicao, preco: g.preco, unidade: g.unidade, moeda: g.moeda, icone: g.icone, miniatura: g.miniatura });
    }
    Object.assign(p, cols);
    await p.save();
    ctx.realtime.notify(ctx.pid, { t: 'objeto', id, autor: ctx.user.id });
  } else {
    const g = await db.Objeto.findByPk(id);
    if (!g) throw err(404, 'Objeto não encontrado.');
    Object.assign(g, cols);
    await g.save();
  }
  return true;
}

/** Na primeira execução: biblioteca geral a partir dos objetos de fábrica e da pasta "objetos" da versão desktop. */
async function seedLibrary() {
  const dirs = [path.join(__dirname, '..', 'defaults', 'objetos'), store.dirs().objetos];
  for (const d of dirs) {
    let files = [];
    try { files = fs.readdirSync(d).filter(f => f.endsWith('.bbo')); } catch { continue; }
    for (const f of files) {
      try {
        const def = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'));
        const id = def.id || f.replace(/\.bbo$/, '');
        const cur = await db.Objeto.findByPk(id);
        // de fábrica: entra se não existe ou se a revisão é mais nova e ninguém editou
        if (!cur) await db.Objeto.create({ id, nome: def.name, categoria: def.category, sistema: def.sistema || null, definicao: { ...def, id } });
        else if (d.includes('defaults') && !cur.definicao?.updated && (def.revision || 1) > (cur.definicao?.revision || 1)) { cur.definicao = { ...def, id }; await cur.save(); }
      } catch { /* inválido: ignora */ }
    }
  }
  if (!(await db.Config.findByPk('tipos'))) {
    try { await db.Config.create({ chave: 'tipos', valor: JSON.parse(fs.readFileSync(store.dirs().tipos, 'utf8')) }); } catch { /* usa os de fábrica do app */ }
  }
}

// ---------------------------------------------------------------- canais

function channels(ctx) {
  const { user, req } = ctx;
  const admin = () => { if (!user.admin) throw err(403, 'Só o administrador do servidor altera as configurações.'); };
  const local = what => { if (!isLocal(req)) throw err(403, `${what} só funciona quando o BoxBim é aberto no próprio computador do servidor.`); };
  const editor = async () => { if (ctx.pid) await access(ctx.pid, user, 'editor'); };
  return {
    'app:version': () => require('../package.json').version,
    'app:info': () => ({ version: require('../package.json').version, local: isLocal(req), usuario: { id: user.id, nome: user.nome, admin: !!user.admin } }),
    'app:capacidades': () => {
      const s = store.loadSettings();
      const exists = p => !!p && fs.existsSync(p);
      return {
        local: isLocal(req),
        blender: exists(s.tools.blenderPath), oda: exists(s.tools.odaPath),
        revit: isLocal(req), unreal: isLocal(req) && unreal.findEngines().length > 0,
      };
    },

    'types:load': async () => {
      if (ctx.pid) { const p = await db.Projeto.findByPk(ctx.pid); if (p?.dados?.tipos) return p.dados.tipos; }
      return (await db.Config.findByPk('tipos'))?.valor || null;
    },
    'types:save': async d => {
      if (ctx.pid) {
        await editor();
        const p = await db.Projeto.findByPk(ctx.pid);
        p.dados = { ...p.dados, tipos: d };
        await p.save();
        ctx.realtime.notify(ctx.pid, { t: 'tipos', autor: user.id });
      } else await db.Config.upsert({ chave: 'tipos', valor: d });
      return true;
    },
    'types:publish': async d => { await db.Config.upsert({ chave: 'tipos', valor: d }); return true; },

    'objects:list': () => listObjects(ctx.pid),
    'objects:save': async o => { await editor(); return saveObject(ctx, o); },
    'objects:publish': async o => saveObject(ctx, o, { geral: true }),
    'objects:meta': async (id, meta, opts) => { await editor(); return setObjectMeta(ctx, id, meta, opts || {}); },
    'objects:delete': async id => {
      if (ctx.pid) {
        await editor();
        const n = await db.ObjetoProjeto.destroy({ where: { ProjetoId: ctx.pid, objetoId: id } });
        if (n) { ctx.realtime.notify(ctx.pid, { t: 'objeto', id, autor: user.id }); return true; }
      }
      const g = await db.Objeto.findByPk(id);
      if (g && (user.admin || g.autorId === user.id)) await g.destroy();
      else if (g) throw err(403, 'Só quem criou o objeto (ou o administrador) apaga da biblioteca geral.');
      return true;
    },
    'objects:import': async file => {
      const o = JSON.parse(fs.readFileSync(allowedPath(user, file), 'utf8'));
      if (o.format !== 'boxbim-objeto') throw err(400, 'Arquivo não é um Objeto do BoxBim (.bbo).');
      let id = o.id || store.slug(o.name);
      const cur = await db.Objeto.findByPk(id);
      if (cur && (cur.definicao?.script !== o.script || JSON.stringify(cur.definicao?.parameters) !== JSON.stringify(o.parameters))) {
        let n = 2;
        while (await db.Objeto.findByPk(`${id}-${n}`)) n++;
        id = `${id}-${n}`;
      }
      return saveObject(ctx, { ...o, id });
    },
    'objects:export': async (id, file) => {
      const o = (await listObjects(ctx.pid)).find(x => x.id === id);
      if (!o) throw err(404, 'Objeto não encontrado.');
      const { escopo, miniatura, ...rest } = o;
      fs.writeFileSync(allowedPath(user, file), JSON.stringify(rest, null, 2));
      return true;
    },

    'settings:get': () => store.publicSettings(),
    'settings:set': s => { admin(); return store.saveSettings(s); },

    'ai:chat': r => ai.chat(r),
    'ai:cancel': id => ai.cancel(id),
    'ai:models': id => ai.listModels(id),

    'agents:list': () => store.listAgents(),
    'agents:save': a => store.saveAgent(a),
    'agents:delete': id => store.deleteAgent(id),
    'skills:list': () => store.listSkills(),
    'skills:save': s => store.saveSkill(s),
    'skills:delete': id => store.deleteSkill(id),
    'memory:list': () => store.listMemories(),
    'memory:index': () => store.readMemoryIndex(),
    'memory:save': m => store.saveMemory(m),
    'memory:delete': id => store.deleteMemory(id),
    'chat:save': (t, md) => store.saveChat(t, md),
    'data:dirs': () => { admin(); return store.dirs(); },

    'unreal:engines': () => unreal.findEngines().map(e => ({ ...e, dlss: !!unreal.dlssPluginIn(e.root) })),
    'unreal:open': (glb, meta) => { local('Abrir no Unreal'); return unreal.openInUnreal(glb, meta); },
    'revit': (route, body) => { local('A ponte com o Revit'); return conv.revit(route, body); },
    'convert:blender': (src, dst) => conv.blenderConvert(allowedPath(user, src), allowedPath(user, dst)),
    'convert:oda': (src, fmt, outDir) => conv.odaConvert(allowedPath(user, src), fmt, outDir ? allowedPath(user, outDir) : undefined),

    'file:read': p => fs.readFileSync(allowedPath(user, p)),
    'file:readText': p => fs.readFileSync(allowedPath(user, p), 'utf8'),
    'file:write': (p, data) => { const f = allowedPath(user, p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof data === 'string' ? data : Buffer.from(data)); return f; },
    'file:exists': p => fs.existsSync(allowedPath(user, p)),
    'file:list': p => fs.readdirSync(allowedPath(user, p)),
    'file:tmp': name => path.join(workspace(user), `${Date.now()}-${path.basename(String(name))}`),
    'file:workspace': () => workspace(user),
    'shell:open': p => { local('Abrir pastas'); execFile('explorer.exe', [path.resolve(String(p))]); return true; },
    'shell:show': p => { local('Mostrar arquivos'); execFile('explorer.exe', ['/select,', path.resolve(String(p))]); return true; },
  };
}

function routes(app, { requireUser, realtime }) {
  app.post('/api/rpc/:canal', requireUser(), async (req, res) => {
    try {
      const pid = req.get('X-Projeto') || null;
      if (pid) await access(pid, req.user);
      const ctx = { user: req.user, req, pid, realtime };
      const fn = channels(ctx)[req.params.canal];
      if (!fn) throw err(404, `Canal desconhecido: ${req.params.canal}`);
      const value = await fn(...decode(req.body?.args || []));
      res.json({ ok: true, value: encode(value === undefined ? null : value) });
    } catch (e) {
      res.status(e.status || 200).json({ ok: false, error: e.message || String(e) });
    }
  });

  // envio de arquivo (importar) → caminho na pasta de trabalho do usuário
  app.post('/api/enviar', requireUser(), async (req, res) => {
    try {
      const name = path.basename(String(req.get('X-Nome-Arquivo') || 'arquivo')).replace(/[^\w.\- ()À-ú]/g, '_');
      const f = path.join(workspace(req.user), `${Date.now()}-${name}`);
      const out = fs.createWriteStream(f);
      let size = 0;
      req.on('data', c => { size += c.length; if (size > 1024 * 1024 * 1024) { req.destroy(); out.destroy(); } });
      req.pipe(out);
      out.on('finish', () => res.json({ ok: true, caminho: f, tamanho: size }));
      out.on('error', e => res.status(500).json({ ok: false, error: e.message }));
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // baixar um arquivo da pasta de trabalho (resultado de conversões/exportações)
  app.get('/api/baixar', requireUser(), (req, res) => {
    try {
      const f = allowedPath(req.user, req.query.caminho);
      res.download(f, String(req.query.nome || path.basename(f).replace(/^\d+-/, '')));
    } catch (e) { res.status(e.status || 500).json({ erro: e.message }); }
  });
}

module.exports = { routes, seedLibrary, workspace };
