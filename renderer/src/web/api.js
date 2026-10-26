// window.boxbim no NAVEGADOR: a mesma API que o Electron expunha, agora sobre o servidor (/api/rpc).
//   - abrir arquivo: o navegador escolhe, o arquivo sobe para a pasta de trabalho do usuário no servidor e o
//     caminho devolvido funciona em leituras, conversões (Blender/ODA) e na ponte com o Revit;
//   - salvar arquivo: dialog.save devolve "download:<nome>"; gravar nesse caminho baixa o arquivo no navegador
//     (se um conversor do servidor precisa gravar nele, grava num temporário e o navegador baixa em seguida).
// O projeto aberto vai no cabeçalho X-Projeto (biblioteca de objetos e tipos do projeto).

import { localChat, localModels, cancelLocal, isLocalUrl, localMcpTools, localMcpCall, forgetLocalMcp } from './local-ai.js';

const params = new URLSearchParams(location.search);
export const projectId = params.get('projeto') || null;

// ---------------------------------------------------------------- binários (JSON ⇄ base64)

function toB64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(s) {
  const bin = atob(s);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}
function encode(v) {
  if (v instanceof Uint8Array) return { __b64: toB64(v) };
  if (v instanceof ArrayBuffer) return { __b64: toB64(new Uint8Array(v)) };
  if (Array.isArray(v)) return v.map(encode);
  if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = encode(x); return o; }
  return v;
}
function decode(v) {
  if (Array.isArray(v)) return v.map(decode);
  if (v && typeof v === 'object') {
    if (typeof v.__b64 === 'string') return fromB64(v.__b64);
    const o = {}; for (const [k, x] of Object.entries(v)) o[k] = decode(x); return o;
  }
  return v;
}

export async function call(canal, ...args) {
  const r = await fetch(`/api/rpc/${canal}`, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(projectId ? { 'X-Projeto': projectId } : {}) },
    body: JSON.stringify({ args: encode(args) }),
  });
  if (r.status === 401) { location.href = `/login.html?volta=${encodeURIComponent(location.pathname + location.search)}`; throw new Error('Sessão expirada.'); }
  const j = await r.json().catch(() => ({ ok: false, error: `Erro ${r.status}` }));
  if (!j.ok) throw new Error(j.error || 'Erro no servidor.');
  return decode(j.value);
}

export async function rest(method, url, body) {
  const r = await fetch(url, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.erro || `Erro ${r.status}`), { status: r.status });
  return j;
}

// ---------------------------------------------------------------- arquivos

const uploaded = new Map(); // caminho no servidor → bytes já conhecidos no navegador (evita baixar de volta)

async function upload(file) {
  const r = await fetch('/api/enviar', { method: 'POST', credentials: 'same-origin', headers: { 'X-Nome-Arquivo': encodeURIComponent(file.name).replace(/%20/g, ' ') }, body: file });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || 'Falha ao enviar o arquivo.');
  uploaded.set(j.caminho, file);
  return j.caminho;
}

function downloadBlob(name, data) {
  const blob = data instanceof Blob ? data : new Blob([typeof data === 'string' ? data : data]);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

const isDownload = p => typeof p === 'string' && p.startsWith('download:');
const dlName = p => p.slice('download:'.length) || 'arquivo';

/** Baixa um arquivo da pasta de trabalho do usuário no servidor. */
function downloadServer(serverPath, name) {
  const a = document.createElement('a');
  a.href = `/api/baixar?caminho=${encodeURIComponent(serverPath)}&nome=${encodeURIComponent(name)}`;
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => a.remove(), 2000);
}

/** Troca "download:x" por um temporário no servidor, roda fn e baixa os temporários usados. */
async function viaTmp(values, fn) {
  const pending = [];
  const map = async v => {
    if (isDownload(v)) { const tmp = await call('file:tmp', dlName(v)); pending.push([tmp, dlName(v)]); return tmp; }
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Uint8Array)) {
      const o = {}; for (const [k, x] of Object.entries(v)) o[k] = await map(x); return o;
    }
    return v;
  };
  const args = [];
  for (const v of values) args.push(await map(v));
  const r = await fn(...args);
  for (const [tmp, name] of pending) downloadServer(tmp, name);
  return r;
}

function pickFiles({ filters = [], properties = [] } = {}) {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = properties.includes('multiSelections');
    const exts = filters.flatMap(f => f.extensions || []).filter(e => e && e !== '*');
    if (exts.length) input.accept = exts.map(e => `.${e}`).join(',');
    input.onchange = () => resolve([...input.files]);
    // cancelado: o navegador avisa com "cancel" (Chrome 113+)
    input.addEventListener('cancel', () => resolve([]));
    input.click();
  });
}

// ---------------------------------------------------------------- API

// provedor de IA local que o servidor (na nuvem) não alcança: o navegador chama
let remoteServer = null;
async function localProvider(id) {
  if (remoteServer === null) { try { remoteServer = !(await call('app:info')).local; } catch { remoteServer = false; } }
  if (!remoteServer) return null;
  const p = (await call('settings:get')).providers?.[id];
  return p && (p.local || isLocalUrl(p.baseUrl)) && isLocalUrl(p.baseUrl) ? p : null;
}

const api = {
  web: true,
  version: () => call('app:version'),
  info: () => call('app:info'),
  capacidades: () => call('app:capacidades'),
  types: { load: () => call('types:load'), save: d => call('types:save', d), publish: d => call('types:publish', d) },
  objects: {
    list: () => call('objects:list'), save: o => call('objects:save', o), remove: id => call('objects:delete', id),
    publish: o => call('objects:publish', o), meta: (id, m, opts) => call('objects:meta', id, m, opts),
    import: file => call('objects:import', file),
    export: (id, file) => viaTmp([file], f => call('objects:export', id, f)),
  },
  settings: { get: () => call('settings:get'), set: s => call('settings:set', s) },
  // IA local (LM Studio, Ollama…) com o servidor na nuvem: o navegador chama direto (ver local-ai.js)
  ai: {
    chat: async req => { const p = await localProvider(req.providerId); return p ? localChat(p, req) : call('ai:chat', req); },
    cancel: id => (cancelLocal(id) ? Promise.resolve(true) : call('ai:cancel', id)),
    models: async id => { const p = await localProvider(id); return p ? localModels(p) : call('ai:models', id); },
  },
  // servidores MCP do Chat IA: os do servidor por ele; os "no meu computador" pelo navegador
  mcp: {
    tools: async () => {
      const s = await call('settings:get');
      const out = await call('mcp:tools');
      for (const m of (s.mcp || []).filter(x => x.ativo && x.local)) {
        try { out.push({ server: m.id, nome: m.nome, local: true, tools: await localMcpTools(m) }); } catch (e) { out.push({ server: m.id, nome: m.nome, local: true, erro: e.message, tools: [] }); }
      }
      return out;
    },
    call: async (id, name, args) => {
      const m = ((await call('settings:get')).mcp || []).find(x => x.id === id);
      return m?.local ? localMcpCall(m, name, args) : call('mcp:call', id, name, args);
    },
    test: async id => {
      const m = ((await call('settings:get')).mcp || []).find(x => x.id === id);
      if (m?.local) { forgetLocalMcp(id); return (await localMcpTools(m)).map(t => t.name); }
      return call('mcp:test', id);
    },
  },
  agents: { list: () => call('agents:list'), save: a => call('agents:save', a), remove: id => call('agents:delete', id) },
  skills: { list: () => call('skills:list'), save: s => call('skills:save', s), remove: id => call('skills:delete', id) },
  memory: { list: () => call('memory:list'), index: () => call('memory:index'), save: m => call('memory:save', m), remove: id => call('memory:delete', id) },
  chats: { save: (title, md) => call('chat:save', title, md) },
  dirs: () => call('data:dirs'),
  unreal: { engines: () => call('unreal:engines'), open: (glb, meta) => call('unreal:open', glb, meta) },
  dialog: {
    /** Escolhe arquivo(s) no computador de quem usa e envia ao servidor; devolve os caminhos no servidor. */
    open: async opts => {
      const files = await pickFiles(opts);
      const out = [];
      for (const f of files) out.push(await upload(f));
      return out;
    },
    /** Salvar: o arquivo vai para a pasta de downloads do navegador. */
    save: async (opts = {}) => `download:${String(opts.defaultPath || 'arquivo').split(/[\\/]/).pop()}`,
    /** Pasta: a pasta de trabalho do usuário no servidor. */
    dir: () => call('file:workspace'),
  },
  file: {
    read: async p => (uploaded.has(p) ? new Uint8Array(await uploaded.get(p).arrayBuffer()) : call('file:read', p)),
    readText: async p => (uploaded.has(p) ? uploaded.get(p).text() : call('file:readText', p)),
    write: async (p, data) => {
      if (isDownload(p)) { downloadBlob(dlName(p), data); return p; }
      return call('file:write', p, data);
    },
    exists: p => (isDownload(p) ? false : call('file:exists', p)),
    tmp: name => call('file:tmp', name),
  },
  revit: (route, body) => viaTmp([body], b => call('revit', route, b)),
  convert: {
    blender: (src, dst) => viaTmp([src, dst], (s, d) => call('convert:blender', s, d)),
    oda: (src, fmt, outDir) => call('convert:oda', src, fmt, outDir),
  },
  shell: { open: p => call('shell:open', p).catch(() => false), show: p => call('shell:show', p).catch(() => false) },
  /** Arquivo solto na janela: envia ao servidor e devolve o caminho (assíncrono no navegador). */
  pathForFile: file => upload(file),
  download: downloadBlob,
};

window.boxbim = api;
export default api;
