// IA e MCP "LOCAIS" pelo NAVEGADOR. Com o BoxBim numa VPS, http://127.0.0.1:1234 no servidor é a própria VPS — o
// LM Studio (ou Ollama, llama.cpp, servidores MCP) está no computador de quem usa. Então, quando o servidor é remoto e
// o endereço é local/da rede interna, quem chama é o navegador, que está nesse computador.
//   LM Studio: Developer › Server Settings › "Enable CORS" ligado. Ollama: variável OLLAMA_ORIGINS=* (ou o domínio).
//   O navegador pode pedir permissão para "acessar dispositivos da rede local": permita.

const controllers = new Map();

/** Endereço que só existe no computador/rede de quem usa (localhost, 127.x, ::1, 10.x, 192.168.x, 172.16–31.x, .local). */
export function isLocalUrl(url) {
  try {
    const h = new URL(url).hostname.replace(/^\[|\]$/g, '');
    return h === 'localhost' || h === '::1' || h.endsWith('.local') || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h);
  } catch { return false; }
}

function friendly(e, url, label) {
  if (e.name === 'AbortError') return new Error('Requisição cancelada.');
  if (e instanceof TypeError) {
    return new Error(`O navegador não conseguiu falar com ${label} em ${url}. Confira: o programa está aberto e com o servidor ligado; no LM Studio, Developer › Server Settings › "Enable CORS" (no Ollama, OLLAMA_ORIGINS=*); e, se o navegador pediu permissão para acessar a rede local, permita.`);
  }
  return e;
}

const safeParse = s => { if (s && typeof s === 'object') return s; try { return JSON.parse(s || '{}'); } catch { return { _raw: s }; } };

/** Chat no formato interno do BoxBim, direto num servidor OpenAI-compatível local. */
export async function localChat(p, req) {
  const ctrl = new AbortController();
  if (req.requestId) controllers.set(req.requestId, ctrl);
  const timer = setTimeout(() => ctrl.abort(), (req.timeoutSec || 600) * 1000);
  const messages = req.messages.map(m => {
    if (m.role === 'assistant' && m.tool_calls?.length) {
      return { role: 'assistant', content: m.content || null, tool_calls: m.tool_calls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.arguments || {}) } })) };
    }
    if (m.role === 'tool') return { role: 'tool', tool_call_id: m.tool_call_id, content: m.content };
    return { role: m.role, content: m.content };
  });
  const body = { model: req.model || p.model, messages };
  if (req.tools?.length) body.tools = req.tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
  if (req.temperature !== null && req.temperature !== undefined) body.temperature = req.temperature;
  if (req.maxTokens) body.max_tokens = req.maxTokens;
  const url = p.baseUrl.replace(/\/$/, '') + '/chat/completions';
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* corpo não-JSON */ }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${json?.error?.message || json?.error || text.slice(0, 300)}`);
    const msg = json?.choices?.[0]?.message || {};
    let content = msg.content || '';
    if (Array.isArray(content)) content = content.map(c => c.text || '').join('');
    const think = /<think>([\s\S]*?)<\/think>/.exec(content);
    if (think) content = content.replace(think[0], '').trim();
    return {
      content,
      reasoning: msg.reasoning_content || msg.reasoning || (think ? think[1].trim() : ''),
      tool_calls: (msg.tool_calls || []).map(tc => ({ id: tc.id || 'call_' + Math.random().toString(36).slice(2), name: tc.function?.name, arguments: safeParse(tc.function?.arguments) })),
      usage: json?.usage ? { input: json.usage.prompt_tokens, output: json.usage.completion_tokens } : null,
      via: 'navegador',
    };
  } catch (e) { throw friendly(e, p.baseUrl, p.label); }
  finally { clearTimeout(timer); controllers.delete(req.requestId); }
}

export function cancelLocal(id) { controllers.get(id)?.abort(); return controllers.has(id); }

export async function localModels(p) {
  const url = p.baseUrl.replace(/\/$/, '') + '/models';
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return (json.data || json.models || []).map(m => m.id || m.name).filter(Boolean).sort();
  } catch (e) { throw friendly(e, p.baseUrl, p.label); }
}

// ---------------------------------------------------------------- cliente MCP no navegador (servidores locais)

const sessions = new Map();
let seq = 1;

async function mcpRpc(cfg, method, params, notify = false) {
  const sess = sessions.get(cfg.id) || {};
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  if (sess.sessionId) headers['Mcp-Session-Id'] = sess.sessionId;
  if (sess.protocol) headers['MCP-Protocol-Version'] = sess.protocol;
  const id = notify ? undefined : seq++;
  let res;
  try {
    res = await fetch(cfg.url, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', ...(notify ? {} : { id }), method, ...(params ? { params } : {}) }), signal: AbortSignal.timeout(60000) });
  } catch (e) { throw friendly(e, cfg.url, `o servidor MCP "${cfg.nome}"`); }
  if (!res.ok && res.status !== 202) throw new Error(`MCP "${cfg.nome}": HTTP ${res.status}`);
  if (notify) return null;
  const sid = res.headers.get('mcp-session-id');
  if (sid) sessions.set(cfg.id, { ...sessions.get(cfg.id), sessionId: sid });
  const text = await res.text();
  let m = null;
  if ((res.headers.get('content-type') || '').includes('text/event-stream')) {
    for (const block of text.split(/\r?\n\r?\n/)) {
      const data = block.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
      try { const x = JSON.parse(data); if (x.id === id) { m = x; break; } } catch { /* outro evento */ }
    }
  } else if (text) m = JSON.parse(text);
  if (m?.error) throw new Error(`MCP "${cfg.nome}": ${m.error.message}`);
  return m?.result;
}

async function mcpConnect(cfg) {
  if (sessions.has(cfg.id)) return;
  sessions.set(cfg.id, {});
  try {
    const r = await mcpRpc(cfg, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'boxbim-navegador', version: '1' } });
    sessions.set(cfg.id, { ...sessions.get(cfg.id), protocol: r?.protocolVersion });
    await mcpRpc(cfg, 'notifications/initialized', null, true);
  } catch (e) { sessions.delete(cfg.id); throw e; }
}

export async function localMcpTools(cfg) {
  await mcpConnect(cfg);
  return (await mcpRpc(cfg, 'tools/list', {}))?.tools || [];
}

export async function localMcpCall(cfg, name, args) {
  await mcpConnect(cfg);
  const r = await mcpRpc(cfg, 'tools/call', { name, arguments: args || {} });
  const text = (r?.content || []).map(c => (c.type === 'text' ? c.text : `[${c.type}]`)).join('\n') || (r?.structuredContent ? JSON.stringify(r.structuredContent) : '');
  if (r?.isError) throw new Error(text || 'a ferramenta MCP devolveu erro');
  return text;
}

export function forgetLocalMcp(id) { sessions.delete(id); }
