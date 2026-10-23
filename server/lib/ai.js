// Camada única de chat para todos os provedores.
// Formato interno das mensagens (estilo OpenAI):
//   { role: 'system'|'user'|'assistant'|'tool', content, tool_calls?: [{id, name, arguments}], tool_call_id?, name?, raw? }
// Três dialetos: 'openai' (OpenAI, OpenRouter, Groq, DeepSeek, Mistral, xAI, LM Studio, Ollama, llama.cpp),
// 'anthropic' (Claude) e 'gemini' (Google).
const store = require('./store');

const controllers = new Map();

function cancel(requestId) {
  controllers.get(requestId)?.abort();
}

async function chat(req) {
  const p = store.providerWithKey(req.providerId);
  const model = req.model || p.model;
  if (!model) throw new Error(`Escolha um modelo para "${p.label}" nas Configurações.`);
  if (!p.local && !p.apiKey) throw new Error(`Falta a chave de API de "${p.label}" nas Configurações.`);

  const ctrl = new AbortController();
  if (req.requestId) controllers.set(req.requestId, ctrl);
  const timer = setTimeout(() => ctrl.abort(), (req.timeoutSec || 600) * 1000);
  try {
    if (p.type === 'anthropic') return await chatAnthropic(p, model, req, ctrl.signal);
    if (p.type === 'gemini') return await chatGemini(p, model, req, ctrl.signal);
    return await chatOpenAI(p, model, req, ctrl.signal);
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Requisição cancelada ou expirou.');
    if (e.cause?.code === 'ECONNREFUSED') throw new Error(`Não foi possível conectar em ${p.baseUrl}. O servidor ${p.label} está rodando?`);
    throw e;
  } finally {
    clearTimeout(timer);
    controllers.delete(req.requestId);
  }
}

async function postJson(url, headers, body, signal) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  if (!res.ok) {
    const msg = json?.error?.message || json?.error || json?.message || text.slice(0, 500);
    throw new Error(`HTTP ${res.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
  }
  return json;
}

function safeParse(s) {
  if (s && typeof s === 'object') return s;
  try { return JSON.parse(s || '{}'); } catch { return { _raw: s }; }
}

// ---------------------------------------------------------------- assinaturas de raciocínio (Gemini 3)
// Os modelos Gemini com raciocínio devolvem uma "thought signature" junto de cada chamada de ferramenta e EXIGEM
// recebê-la de volta no histórico (senão: HTTP 400 "Function call is missing a thought_signature"). Ela é guardada
// em raw e reenviada como veio: nativo → parts[].thoughtSignature; OpenAI-compatível do Google →
// tool_calls[].extra_content.google.thought_signature; OpenRouter → message.reasoning_details.
// Chamadas que não vieram do Gemini (outro modelo/agente na mesma conversa) levam o valor que a própria Google indica
// para pular a validação.
const SKIP_SIGNATURE = 'skip_thought_signature_validator';
const isGemini = model => /gemini/i.test(String(model || ''));

// ---------------------------------------------------------------- OpenAI-compatível

async function chatOpenAI(p, model, req, signal) {
  const gemini = isGemini(model);
  const messages = req.messages.map(m => {
    if (m.role === 'assistant' && m.tool_calls?.length) {
      const rawCalls = m.raw?.message?.tool_calls || [];
      const out = {
        role: 'assistant', content: m.content || null,
        tool_calls: m.tool_calls.map((tc, i) => {
          const call = { id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.arguments || {}) } };
          // assinatura de raciocínio do Gemini (endpoint OpenAI do Google): devolve como veio
          const orig = rawCalls.find(r => r.id === tc.id) || rawCalls[i];
          if (orig?.extra_content) call.extra_content = orig.extra_content;
          else if (gemini && i === 0) call.extra_content = { google: { thought_signature: SKIP_SIGNATURE } };
          return call;
        }),
      };
      // OpenRouter: o raciocínio (com as assinaturas) vai de volta em reasoning_details
      if (m.raw?.message?.reasoning_details) out.reasoning_details = m.raw.message.reasoning_details;
      else if (gemini && p.baseUrl.includes('openrouter.ai')) {
        out.reasoning_details = m.tool_calls.slice(0, 1).map((tc, i) => ({ type: 'reasoning.encrypted', id: tc.id, format: 'google-gemini-v1', index: i, data: SKIP_SIGNATURE }));
      }
      return out;
    }
    if (m.role === 'tool') return { role: 'tool', tool_call_id: m.tool_call_id, content: m.content };
    return { role: m.role, content: m.content };
  });
  const body = { model, messages };
  if (req.tools?.length) body.tools = req.tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
  if (req.temperature !== null && req.temperature !== undefined) body.temperature = req.temperature;
  if (p.local && req.maxTokens) body.max_tokens = req.maxTokens;

  const headers = {};
  if (p.apiKey) headers.Authorization = `Bearer ${p.apiKey}`;
  if (p.baseUrl.includes('openrouter.ai')) { headers['HTTP-Referer'] = 'https://boxbim.local'; headers['X-Title'] = 'BoxBim'; }

  const json = await postJson(p.baseUrl.replace(/\/$/, '') + '/chat/completions', headers, body, signal);
  const msg = json.choices?.[0]?.message || {};
  let content = msg.content || '';
  if (Array.isArray(content)) content = content.map(c => c.text || '').join('');
  // Alguns modelos locais (Qwen/DeepSeek) devolvem o raciocínio entre <think>…</think>
  const think = /<think>([\s\S]*?)<\/think>/.exec(content);
  if (think) content = content.replace(think[0], '').trim();
  // ids estáveis (o mesmo id vai no raw e na chamada, para casar a assinatura na volta)
  const calls = (msg.tool_calls || []).map(tc => ({ ...tc, id: tc.id || 'call_' + Math.random().toString(36).slice(2) }));
  const keep = {};
  if (calls.some(c => c.extra_content)) keep.tool_calls = calls.map(c => ({ id: c.id, ...(c.extra_content ? { extra_content: c.extra_content } : {}) }));
  if (msg.reasoning_details) keep.reasoning_details = msg.reasoning_details;
  return {
    content,
    reasoning: msg.reasoning_content || msg.reasoning || (think ? think[1].trim() : ''),
    tool_calls: calls.map(tc => ({ id: tc.id, name: tc.function?.name, arguments: safeParse(tc.function?.arguments) })),
    ...(Object.keys(keep).length ? { raw: { message: keep } } : {}),
    usage: json.usage ? { input: json.usage.prompt_tokens, output: json.usage.completion_tokens } : null,
  };
}

// ---------------------------------------------------------------- Anthropic (Claude)

async function chatAnthropic(p, model, req, signal) {
  const system = req.messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
  const messages = [];
  const push = (role, block) => {
    const last = messages[messages.length - 1];
    if (last && last.role === role) last.content.push(block);
    else messages.push({ role, content: [block] });
  };
  for (const m of req.messages) {
    if (m.role === 'system') continue;
    if (m.role === 'user') push('user', { type: 'text', text: m.content || ' ' });
    else if (m.role === 'assistant') {
      if (m.content) push('assistant', { type: 'text', text: m.content });
      for (const tc of m.tool_calls || []) push('assistant', { type: 'tool_use', id: tc.id, name: tc.name, input: tc.arguments || {} });
    } else if (m.role === 'tool') {
      push('user', { type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content, is_error: !!m.isError });
    }
  }
  const body = { model, max_tokens: req.maxTokens || 4096, messages };
  if (system) body.system = system;
  if (req.tools?.length) body.tools = req.tools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  if (req.temperature !== null && req.temperature !== undefined) body.temperature = req.temperature;

  const json = await postJson(p.baseUrl.replace(/\/$/, '') + '/v1/messages',
    { 'x-api-key': p.apiKey, 'anthropic-version': '2023-06-01' }, body, signal);
  const blocks = json.content || [];
  return {
    content: blocks.filter(b => b.type === 'text').map(b => b.text).join(''),
    reasoning: blocks.filter(b => b.type === 'thinking').map(b => b.thinking).join('\n'),
    tool_calls: blocks.filter(b => b.type === 'tool_use').map(b => ({ id: b.id, name: b.name, arguments: b.input || {} })),
    usage: json.usage ? { input: json.usage.input_tokens, output: json.usage.output_tokens } : null,
    stop: json.stop_reason,
  };
}

// ---------------------------------------------------------------- Google Gemini

function geminiSchema(s) {
  // Gemini aceita um subconjunto do JSON Schema
  if (!s || typeof s !== 'object') return s;
  const out = {};
  for (const [k, v] of Object.entries(s)) {
    if (['additionalProperties', '$schema', 'default', 'examples'].includes(k)) continue;
    if (k === 'properties') out.properties = Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, geminiSchema(pv)]));
    else if (k === 'items') out.items = geminiSchema(v);
    else out[k] = v;
  }
  return out;
}

async function chatGemini(p, model, req, signal) {
  const system = req.messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
  const contents = [];
  const push = (role, part) => {
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts.push(part);
    else contents.push({ role, parts: [part] });
  };
  for (const m of req.messages) {
    if (m.role === 'system') continue;
    if (m.role === 'user') push('user', { text: m.content || ' ' });
    else if (m.role === 'assistant') {
      if (m.raw?.parts) {
        // preserva as thoughtSignature como vieram; se a 1ª chamada do turno veio sem, põe a de pular a validação
        const parts = m.raw.parts.map(x => ({ ...x }));
        const first = parts.find(x => x.functionCall);
        if (first && !parts.some(x => x.thoughtSignature)) first.thoughtSignature = SKIP_SIGNATURE;
        contents.push({ role: 'model', parts });
        continue;
      }
      if (m.content) push('model', { text: m.content });
      // chamadas feitas por outro modelo/agente nesta conversa: sem assinatura do Gemini
      (m.tool_calls || []).forEach((tc, i) => push('model', { functionCall: { name: tc.name, args: tc.arguments || {} }, ...(i === 0 ? { thoughtSignature: SKIP_SIGNATURE } : {}) }));
    } else if (m.role === 'tool') {
      push('user', { functionResponse: { name: m.name, response: { result: m.content } } });
    }
  }
  const body = { contents, generationConfig: {} };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (req.tools?.length) body.tools = [{ functionDeclarations: req.tools.map(t => ({ name: t.name, description: t.description, parameters: geminiSchema(t.parameters) })) }];
  if (req.temperature !== null && req.temperature !== undefined) body.generationConfig.temperature = req.temperature;
  if (req.maxTokens) body.generationConfig.maxOutputTokens = req.maxTokens;

  const url = `${p.baseUrl.replace(/\/$/, '')}/models/${encodeURIComponent(model.replace(/^models\//, ''))}:generateContent`;
  const json = await postJson(url, { 'x-goog-api-key': p.apiKey }, body, signal);
  const cand = json.candidates?.[0];
  const parts = cand?.content?.parts || [];
  if (!parts.length && json.promptFeedback?.blockReason) throw new Error('Gemini bloqueou a resposta: ' + json.promptFeedback.blockReason);
  return {
    content: parts.filter(x => x.text && !x.thought).map(x => x.text).join(''),
    reasoning: parts.filter(x => x.thought && x.text).map(x => x.text).join('\n'),
    tool_calls: parts.filter(x => x.functionCall).map((x, i) => ({ id: `gem_${Date.now()}_${i}`, name: x.functionCall.name, arguments: x.functionCall.args || {} })),
    raw: { parts },
    usage: json.usageMetadata ? { input: json.usageMetadata.promptTokenCount, output: json.usageMetadata.candidatesTokenCount } : null,
  };
}

// ---------------------------------------------------------------- listagem de modelos

async function listModels(providerId) {
  const p = store.providerWithKey(providerId);
  const base = p.baseUrl.replace(/\/$/, '');
  let url, headers = {};
  if (p.type === 'anthropic') { url = base + '/v1/models?limit=100'; headers = { 'x-api-key': p.apiKey, 'anthropic-version': '2023-06-01' }; }
  else if (p.type === 'gemini') { url = base + '/models?pageSize=200'; headers = { 'x-goog-api-key': p.apiKey }; }
  else { url = base + '/models'; if (p.apiKey) headers.Authorization = `Bearer ${p.apiKey}`; }

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${json?.error?.message || JSON.stringify(json).slice(0, 300)}`);
    if (p.type === 'gemini') {
      return (json.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map(m => m.name.replace(/^models\//, ''));
    }
    return (json.data || json.models || []).map(m => m.id || m.name).filter(Boolean).sort();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`Tempo esgotado ao consultar ${p.label}.`);
    if (e.cause?.code === 'ECONNREFUSED') throw new Error(`${p.label} não está rodando em ${p.baseUrl}.`);
    throw e;
  } finally { clearTimeout(t); }
}

module.exports = { chat, cancel, listModels };
