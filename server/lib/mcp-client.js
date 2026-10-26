// CLIENTE MCP (transporte Streamable HTTP): o Chat IA do BoxBim usa as ferramentas de servidores MCP cadastrados em
// ⚙ Configurações › MCP (URL + token opcional). Mantém uma sessão por servidor (cabeçalho Mcp-Session-Id) e aceita
// respostas em JSON ou em SSE (text/event-stream). Servidores no computador de quem usa (localhost) com o BoxBim na
// nuvem são chamados pelo navegador (renderer/src/web/mcp-browser.js).
'use strict';

const PROTOCOL = '2025-06-18';
const sessions = new Map();   // id do servidor → { sessionId, protocol }
const toolCache = new Map();  // id do servidor → { at, tools }

function headersFor(cfg, sess) {
  const h = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  if (cfg.token) h.Authorization = /^\w+\s/.test(cfg.token) ? cfg.token : `Bearer ${cfg.token}`;
  if (sess?.sessionId) h['Mcp-Session-Id'] = sess.sessionId;
  if (sess?.protocol) h['MCP-Protocol-Version'] = sess.protocol;
  return h;
}

/** Lê a resposta JSON-RPC de id dado (corpo JSON ou eventos SSE). */
async function readResponse(res, id) {
  const text = await res.text();
  const type = res.headers.get('content-type') || '';
  if (type.includes('text/event-stream')) {
    for (const block of text.split(/\r?\n\r?\n/)) {
      const data = block.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
      if (!data) continue;
      try { const m = JSON.parse(data); if (m.id === id) return m; } catch { /* evento que não é JSON */ }
    }
    throw new Error('O servidor MCP não devolveu a resposta no fluxo SSE.');
  }
  if (!text) return null;
  const m = JSON.parse(text);
  return Array.isArray(m) ? m.find(x => x.id === id) : m;
}

let seq = 1;
async function rpc(cfg, method, params, { notify = false, retry = true } = {}) {
  const sess = sessions.get(cfg.id);
  const id = notify ? undefined : seq++;
  const res = await fetch(cfg.url, { method: 'POST', headers: headersFor(cfg, sess), body: JSON.stringify({ jsonrpc: '2.0', ...(notify ? {} : { id }), method, ...(params ? { params } : {}) }), signal: AbortSignal.timeout(60000) });
  // sessão expirada: abre outra e repete
  if ((res.status === 404 || res.status === 400) && sess?.sessionId && retry) { sessions.delete(cfg.id); await connect(cfg); return rpc(cfg, method, params, { notify, retry: false }); }
  if (res.status === 401 || res.status === 403) throw new Error(`MCP "${cfg.nome}": acesso negado (${res.status}) — confira o token.`);
  if (!res.ok && res.status !== 202) throw new Error(`MCP "${cfg.nome}": HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  if (notify) return null;
  const sid = res.headers.get('mcp-session-id');
  if (sid) sessions.set(cfg.id, { ...(sessions.get(cfg.id) || {}), sessionId: sid });
  const m = await readResponse(res, id);
  if (m?.error) throw new Error(`MCP "${cfg.nome}": ${m.error.message || JSON.stringify(m.error)}`);
  return m?.result;
}

async function connect(cfg) {
  if (sessions.has(cfg.id)) return;
  sessions.set(cfg.id, {});
  try {
    const r = await rpc(cfg, 'initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'boxbim', version: require('../../package.json').version } }, { retry: false });
    sessions.set(cfg.id, { ...(sessions.get(cfg.id) || {}), protocol: r?.protocolVersion || PROTOCOL });
    await rpc(cfg, 'notifications/initialized', null, { notify: true, retry: false });
  } catch (e) { sessions.delete(cfg.id); throw e; }
}

/** Ferramentas de um servidor (guardadas por 60 s). */
async function listTools(cfg, fresh = false) {
  const c = toolCache.get(cfg.id);
  if (!fresh && c && Date.now() - c.at < 60000) return c.tools;
  await connect(cfg);
  const tools = [];
  let cursor;
  do {
    const r = await rpc(cfg, 'tools/list', cursor ? { cursor } : {});
    tools.push(...(r?.tools || []));
    cursor = r?.nextCursor;
  } while (cursor && tools.length < 500);
  toolCache.set(cfg.id, { at: Date.now(), tools });
  return tools;
}

/** Chama uma ferramenta; devolve o texto (conteúdo de texto + estruturado). */
async function callTool(cfg, name, args) {
  await connect(cfg);
  const r = await rpc(cfg, 'tools/call', { name, arguments: args || {} });
  const parts = (r?.content || []).map(c => (c.type === 'text' ? c.text : c.type === 'resource' ? (c.resource?.text || `[recurso ${c.resource?.uri}]`) : `[${c.type}]`));
  if (!parts.length && r?.structuredContent) parts.push(JSON.stringify(r.structuredContent));
  const text = parts.join('\n');
  if (r?.isError) throw new Error(text || 'a ferramenta MCP devolveu erro');
  return text;
}

function forget(id) { sessions.delete(id); toolCache.delete(id); }

module.exports = { listTools, callTool, forget };
