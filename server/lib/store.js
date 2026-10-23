// Configurações do app + arquivos de agentes, skills e memórias (Markdown com frontmatter).
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// Servidor web: a pasta de dados (agentes, skills, memórias, chats) é a mesma da versão desktop por padrão
// (Documentos/BoxBim); o banco, as configurações e a chave de cifragem ficam em <dados>/.servidor
const DATA_ROOT = process.env.BOXBIM_DATA || path.join(os.homedir(), 'Documents', 'BoxBim');
const SERVER_DIR = path.join(DATA_ROOT, '.servidor');
const SETTINGS_FILE = () => path.join(SERVER_DIR, 'settings.json');

const DEFAULT_PROVIDERS = {
  anthropic:  { type: 'anthropic', label: 'Claude (Anthropic)',  baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-5-5', local: false },
  openai:     { type: 'openai',    label: 'OpenAI',              baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1', local: false },
  gemini:     { type: 'gemini',    label: 'Google Gemini',       baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.5-flash', local: false },
  openrouter: { type: 'openai',    label: 'OpenRouter',          baseUrl: 'https://openrouter.ai/api/v1', model: '', local: false },
  groq:       { type: 'openai',    label: 'Groq',                baseUrl: 'https://api.groq.com/openai/v1', model: '', local: false },
  deepseek:   { type: 'openai',    label: 'DeepSeek',            baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', local: false },
  mistral:    { type: 'openai',    label: 'Mistral',             baseUrl: 'https://api.mistral.ai/v1', model: '', local: false },
  xai:        { type: 'openai',    label: 'xAI (Grok)',          baseUrl: 'https://api.x.ai/v1', model: '', local: false },
  lmstudio:   { type: 'openai',    label: 'LM Studio (local)',   baseUrl: 'http://localhost:1234/v1', model: '', local: true },
  ollama:     { type: 'openai',    label: 'Ollama (local)',      baseUrl: 'http://localhost:11434/v1', model: '', local: true },
  llamacpp:   { type: 'openai',    label: 'llama.cpp server (local)', baseUrl: 'http://localhost:8080/v1', model: '', local: true },
};

function defaultSettings() {
  return {
    dataDir: DATA_ROOT,
    providers: JSON.parse(JSON.stringify(DEFAULT_PROVIDERS)),
    activeAgent: 'arquiteto-bim',
    memory: { enabled: true, autoSave: true, injectIndex: true },
    revit: { port: 48884 },
    tools: {
      blenderPath: findBlender(),
      odaPath: findOda(),
    },
  };
}

function findBlender() {
  const root = 'C:\\Program Files\\Blender Foundation';
  try {
    const dirs = fs.readdirSync(root).filter(d => /^Blender/i.test(d)).sort().reverse();
    for (const d of dirs) {
      const exe = path.join(root, d, 'blender.exe');
      if (fs.existsSync(exe)) return exe;
    }
  } catch { /* não instalado */ }
  return '';
}

function findOda() {
  const root = 'C:\\Program Files\\ODA';
  try {
    for (const d of fs.readdirSync(root).filter(d => /ODAFileConverter/i.test(d)).sort().reverse()) {
      const exe = path.join(root, d, 'ODAFileConverter.exe');
      if (fs.existsSync(exe)) return exe;
    }
  } catch { /* não instalado */ }
  return '';
}

// ---------------------------------------------------------------- settings

let cache = null;

// Chaves de API cifradas com AES-256-GCM; a chave fica em <dados>/.servidor/segredo.key (só o servidor lê)
function secretKey() {
  const f = path.join(SERVER_DIR, 'segredo.key');
  try { return Buffer.from(fs.readFileSync(f, 'utf8').trim(), 'hex'); } catch { /* cria abaixo */ }
  fs.mkdirSync(SERVER_DIR, { recursive: true });
  const k = crypto.randomBytes(32);
  fs.writeFileSync(f, k.toString('hex'), { mode: 0o600 });
  return k;
}
function encrypt(s) {
  if (!s) return '';
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', secretKey(), iv);
  const data = Buffer.concat([c.update(String(s), 'utf8'), c.final()]);
  return 'gcm:' + Buffer.concat([iv, c.getAuthTag(), data]).toString('base64');
}
function decrypt(s) {
  if (!s) return '';
  if (s.startsWith('gcm:')) {
    try {
      const b = Buffer.from(s.slice(4), 'base64');
      const d = crypto.createDecipheriv('aes-256-gcm', secretKey(), b.subarray(0, 12));
      d.setAuthTag(b.subarray(12, 28));
      return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
    } catch { return ''; }
  }
  if (s.startsWith('enc:')) return ''; // cifrada pelo Electron (DPAPI): precisa ser informada de novo
  return s.startsWith('raw:') ? s.slice(4) : s;
}

function loadSettings() {
  if (cache) return cache;
  const def = defaultSettings();
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(SETTINGS_FILE(), 'utf8')); } catch { /* primeira execução */ }
  cache = {
    ...def, ...saved,
    memory: { ...def.memory, ...(saved.memory || {}) },
    revit: { ...def.revit, ...(saved.revit || {}) },
    tools: { ...def.tools, ...(saved.tools || {}) },
    providers: { ...def.providers },
  };
  for (const [id, p] of Object.entries(saved.providers || {})) {
    cache.providers[id] = { ...(def.providers[id] || {}), ...p };
  }
  if (!cache.tools.blenderPath) cache.tools.blenderPath = def.tools.blenderPath;
  if (!cache.tools.odaPath) cache.tools.odaPath = def.tools.odaPath;
  ensureDataDir(cache.dataDir);
  return cache;
}

function saveSettings(next) {
  const cur = loadSettings();
  const merged = { ...cur, ...next };
  if (next.providers) {
    merged.providers = {};
    for (const [id, p] of Object.entries(next.providers)) {
      const old = cur.providers[id] || {};
      const apiKey = p.apiKey === undefined ? old.apiKey : encrypt(p.apiKey);
      merged.providers[id] = { ...old, ...p, apiKey };
    }
  }
  cache = merged;
  fs.mkdirSync(path.dirname(SETTINGS_FILE()), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(merged, null, 2));
  ensureDataDir(merged.dataDir);
  return publicSettings();
}

/** Configurações sem as chaves (o renderer só sabe se há chave). */
function publicSettings() {
  const s = loadSettings();
  const providers = {};
  for (const [id, p] of Object.entries(s.providers)) {
    const { apiKey, ...rest } = p;
    providers[id] = { ...rest, hasKey: !!decrypt(apiKey) };
  }
  return { ...s, providers };
}

function providerWithKey(id) {
  const p = loadSettings().providers[id];
  if (!p) throw new Error(`Provedor desconhecido: ${id}`);
  return { id, ...p, apiKey: decrypt(p.apiKey) };
}

// ---------------------------------------------------------------- frontmatter

function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  let key = null;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (kv) {
      key = kv[1];
      meta[key] = parseValue(kv[2]);
    } else if (key && /^\s+/.test(line)) {
      const item = /^\s+-\s*(.*)$/.exec(line);
      if (item) { if (!Array.isArray(meta[key])) meta[key] = []; meta[key].push(parseValue(item[1])); }
      else if (typeof meta[key] === 'object' && !Array.isArray(meta[key])) {
        const sub = /^\s+([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
        if (sub) meta[key][sub[1]] = parseValue(sub[2]);
      }
    }
    if (kv && kv[2] === '') meta[key] = {};
  }
  for (const k of Object.keys(meta)) if (meta[k] && typeof meta[k] === 'object' && !Array.isArray(meta[k]) && !Object.keys(meta[k]).length) meta[k] = '';
  return { meta, body: m[2] };
}

function parseValue(v) {
  v = v.trim();
  if (v === '') return '';
  if (/^\[.*\]$/.test(v)) return v.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (v === 'true' || v === 'false') return v === 'true';
  return v.replace(/^["']|["']$/g, '');
}

function toFrontmatter(meta, body) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(meta)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) lines.push(`${k}: [${v.join(', ')}]`);
    else if (typeof v === 'object') {
      lines.push(`${k}:`);
      for (const [sk, sv] of Object.entries(v)) lines.push(`  ${sk}: ${sv}`);
    } else lines.push(`${k}: ${String(v).replace(/\r?\n/g, ' ')}`);
  }
  lines.push('---', '', (body || '').trim(), '');
  return lines.join('\n');
}

const slug = s => String(s || 'item').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'item';

// ---------------------------------------------------------------- data dir

function dirs() {
  const root = loadSettings().dataDir;
  return {
    root,
    agents: path.join(root, 'agents'),
    skills: path.join(root, 'skills'),
    memory: path.join(root, 'memory'),
    chats: path.join(root, 'chats'),
    objetos: path.join(root, 'objetos'),
    tipos: path.join(root, 'tipos.json'),
  };
}

function ensureDataDir(root) {
  for (const d of ['agents', 'skills', 'memory', 'chats', 'objetos']) fs.mkdirSync(path.join(root, d), { recursive: true });
  // Itens de fábrica (agentes, skills, objetos): cada um é copiado uma única vez, registrado em .seeded.json.
  // Assim itens novos de uma atualização chegam, e os que o usuário apagou não voltam.
  const seed = path.join(__dirname, '..', 'defaults');
  const recordFile = path.join(root, '.seeded.json');
  let record = {};
  try { record = JSON.parse(fs.readFileSync(recordFile, 'utf8')); } catch { /* primeira vez */ }
  let changed = false;
  for (const kind of ['agents', 'skills', 'objetos']) {
    const src = path.join(seed, kind);
    if (!fs.existsSync(src)) continue;
    const done = new Set(record[kind] || []);
    for (const item of fs.readdirSync(src)) {
      if (kind === 'objetos' && done.has(item)) {
        // objeto de fábrica com revisão nova: atualiza a cópia do usuário se ele nunca a editou (sem "updated")
        try {
          const dst = path.join(root, kind, item);
          const mine = JSON.parse(fs.readFileSync(dst, 'utf8'));
          const def = JSON.parse(fs.readFileSync(path.join(src, item), 'utf8'));
          if (!mine.updated && mine.author === 'BoxBim' && (def.revision || 1) > (mine.revision || 1)) fs.copyFileSync(path.join(src, item), dst);
        } catch { /* apagado ou inválido: deixa como está */ }
        continue;
      }
      if (done.has(item)) continue;
      const dst = path.join(root, kind, item);
      if (!fs.existsSync(dst)) fs.cpSync(path.join(src, item), dst, { recursive: true });
      done.add(item);
      changed = true;
    }
    record[kind] = [...done];
  }
  if (changed) fs.writeFileSync(recordFile, JSON.stringify(record, null, 2));
  const index = path.join(root, 'memory', 'MEMORY.md');
  if (!fs.existsSync(index)) fs.writeFileSync(index, '# Memórias do BoxBim\n\n');
}

// Agentes: agents/<id>.md
function listAgents() {
  const d = dirs().agents;
  return fs.readdirSync(d).filter(f => f.endsWith('.md')).map(f => {
    const { meta, body } = parseFrontmatter(fs.readFileSync(path.join(d, f), 'utf8'));
    return {
      id: f.replace(/\.md$/, ''),
      name: meta.name || f,
      description: meta.description || '',
      provider: meta.provider || 'anthropic',
      model: meta.model || '',
      temperature: meta.temperature === '' || meta.temperature === undefined ? null : Number(meta.temperature),
      maxTokens: Number(meta.max_tokens) || 4096,
      maxSteps: Number(meta.max_steps) || 8,
      skills: Array.isArray(meta.skills) ? meta.skills : (meta.skills ? [meta.skills] : []),
      tools: Array.isArray(meta.tools) ? meta.tools : (meta.tools ? [meta.tools] : ['scene', 'files', 'revit', 'memory', 'skills']),
      useTools: meta.use_tools !== false,
      memory: meta.memory !== false,
      systemPrompt: body.trim(),
    };
  });
}

function saveAgent(a) {
  const id = a.id || slug(a.name);
  const meta = {
    name: a.name, description: a.description, provider: a.provider, model: a.model,
    temperature: a.temperature ?? '', max_tokens: a.maxTokens, max_steps: a.maxSteps,
    skills: a.skills || [], tools: a.tools || [], use_tools: a.useTools !== false, memory: a.memory !== false,
  };
  fs.writeFileSync(path.join(dirs().agents, id + '.md'), toFrontmatter(meta, a.systemPrompt));
  return id;
}

function deleteAgent(id) {
  fs.rmSync(path.join(dirs().agents, path.basename(id) + '.md'), { force: true });
}

// Skills: skills/<id>/SKILL.md (mesmo formato das Agent Skills)
function listSkills() {
  const d = dirs().skills;
  return fs.readdirSync(d, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => {
    const file = path.join(d, e.name, 'SKILL.md');
    if (!fs.existsSync(file)) return null;
    const { meta, body } = parseFrontmatter(fs.readFileSync(file, 'utf8'));
    return { id: e.name, name: meta.name || e.name, description: meta.description || '', body: body.trim(), path: file };
  }).filter(Boolean);
}

function saveSkill(s) {
  const id = s.id || slug(s.name);
  const dir = path.join(dirs().skills, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), toFrontmatter({ name: s.name, description: s.description }, s.body));
  return id;
}

function deleteSkill(id) {
  fs.rmSync(path.join(dirs().skills, path.basename(id)), { recursive: true, force: true });
}

// Memórias: memory/<id>.md + memory/MEMORY.md (índice, uma linha por memória)
function listMemories() {
  const d = dirs().memory;
  return fs.readdirSync(d).filter(f => f.endsWith('.md') && f !== 'MEMORY.md').map(f => {
    const full = path.join(d, f);
    const { meta, body } = parseFrontmatter(fs.readFileSync(full, 'utf8'));
    return {
      id: f.replace(/\.md$/, ''), name: meta.name || f, description: meta.description || '',
      type: meta.type || 'project', body: body.trim(), updated: fs.statSync(full).mtimeMs,
    };
  }).sort((a, b) => b.updated - a.updated);
}

function readMemoryIndex() {
  try { return fs.readFileSync(path.join(dirs().memory, 'MEMORY.md'), 'utf8'); } catch { return ''; }
}

function saveMemory(m) {
  const id = m.id || slug(m.name);
  const d = dirs().memory;
  fs.writeFileSync(path.join(d, id + '.md'),
    toFrontmatter({ name: m.name || id, description: m.description, type: m.type || 'project' }, m.body || m.content));
  rebuildIndex();
  return id;
}

function deleteMemory(id) {
  fs.rmSync(path.join(dirs().memory, path.basename(id) + '.md'), { force: true });
  rebuildIndex();
}

function rebuildIndex() {
  const lines = ['# Memórias do BoxBim', ''];
  for (const m of listMemories()) lines.push(`- [${m.name}](${m.id}.md) (${m.type}) — ${m.description}`);
  fs.writeFileSync(path.join(dirs().memory, 'MEMORY.md'), lines.join('\n') + '\n');
}

function saveChat(title, markdown) {
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  const file = path.join(dirs().chats, `${stamp}-${slug(title)}.md`);
  fs.writeFileSync(file, markdown);
  return file;
}

// Tipos de sistema (paredes, pisos, pilares, vigas) e materiais: tipos.json na pasta de dados
function loadTypes() {
  try { return JSON.parse(fs.readFileSync(dirs().tipos, 'utf8')); } catch { return null; }
}

function saveTypes(data) {
  fs.writeFileSync(dirs().tipos, JSON.stringify(data, null, 2));
  return true;
}

// Objetos (famílias paramétricas em JavaScript): objetos/<id>.bbo (JSON)
const OBJ_FORMAT = 'boxbim-objeto';

function validObject(o) {
  if (!o || o.format !== OBJ_FORMAT) throw new Error('Arquivo não é um Objeto do BoxBim (.bbo).');
  if (!o.name || typeof o.script !== 'string' || !Array.isArray(o.parameters)) throw new Error('Objeto incompleto: precisa de name, parameters e script.');
  return o;
}

function listObjects() {
  const d = dirs().objetos;
  const out = [];
  for (const f of fs.readdirSync(d).filter(f => f.endsWith('.bbo'))) {
    try { out.push({ ...validObject(JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'))), id: f.replace(/\.bbo$/, '') }); }
    catch (e) { out.push({ id: f.replace(/\.bbo$/, ''), name: f, broken: e.message, parameters: [], script: '' }); }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function saveObject(o) {
  const id = o.id || slug(o.name);
  const data = { ...o, format: OBJ_FORMAT, id, updated: new Date().toISOString() };
  validObject(data);
  fs.writeFileSync(path.join(dirs().objetos, id + '.bbo'), JSON.stringify(data, null, 2));
  return id;
}

function deleteObject(id) {
  fs.rmSync(path.join(dirs().objetos, path.basename(id) + '.bbo'), { force: true });
}

/** Importa um .bbo para a biblioteca; se o id já existe com outro conteúdo, cria um id novo. */
function importObject(file) {
  const o = validObject(JSON.parse(fs.readFileSync(file, 'utf8')));
  let id = o.id || slug(o.name);
  const exists = i => fs.existsSync(path.join(dirs().objetos, i + '.bbo'));
  if (exists(id)) {
    const cur = JSON.parse(fs.readFileSync(path.join(dirs().objetos, id + '.bbo'), 'utf8'));
    if (cur.script !== o.script || JSON.stringify(cur.parameters) !== JSON.stringify(o.parameters)) {
      let n = 2;
      while (exists(`${id}-${n}`)) n++;
      id = `${id}-${n}`;
    }
  }
  return saveObject({ ...o, id });
}

function exportObject(id, file) {
  const src = path.join(dirs().objetos, path.basename(id) + '.bbo');
  fs.copyFileSync(src, file);
  return file;
}

module.exports = {
  DATA_ROOT, SERVER_DIR,
  loadTypes, saveTypes, listObjects, saveObject, deleteObject, importObject, exportObject,
  loadSettings, saveSettings, publicSettings, providerWithKey, dirs,
  listAgents, saveAgent, deleteAgent, listSkills, saveSkill, deleteSkill,
  listMemories, readMemoryIndex, saveMemory, deleteMemory, saveChat,
  parseFrontmatter, slug,
};
