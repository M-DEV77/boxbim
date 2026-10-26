// MEDIDOR DO CHAT IA (no topo do chat):
//   Modelo .... barra de carregamento: animada enquanto a IA trabalha (com o tempo); com LM Studio/Ollama mostra se o
//               modelo está carregado na memória — a primeira chamada a um modelo descarregado demora para carregar
//   Contexto .. quanto da janela de contexto do modelo a conversa ocupa (tokens da última chamada ÷ limite do modelo;
//               o limite vem do LM Studio/Ollama, do agente ou de uma tabela por modelo); verde → âmbar → vermelho
//   Tokens .... os da última chamada (entrada ↑ / saída ↓) e o total da conversa (Σ), com o número de chamadas
import { h } from './ui.js';

const B = window.boxbim;

/** Janela de contexto conhecida por modelo (tokens); o agente pode definir a dele (agent.contexto). */
function knownWindow(model = '', provider = '') {
  const m = `${provider} ${model}`.toLowerCase();
  const table = [
    [/claude/, 200000], [/gpt-4\.1/, 1047576], [/gpt-5/, 400000], [/gpt-4o|gpt-4-turbo/, 128000], [/\bo[134]\b|o3-|o4-/, 200000],
    [/gemini-2\.5|gemini-1\.5|gemini/, 1048576], [/deepseek/, 128000], [/mistral|codestral/, 128000], [/grok/, 131072],
    [/llama-3\.[123]|llama3\.[123]/, 131072], [/qwen/, 32768], [/gemma/, 8192],
  ];
  for (const [re, n] of table) if (re.test(m)) return n;
  return null;
}

const fmtK = n => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1000 ? `${(n / 1000).toFixed(n >= 1e5 ? 0 : 1)}k` : String(Math.round(n))).replace('.', ',');

export class ChatMeter {
  constructor(app, chat) {
    this.app = app;
    this.chat = chat;
    this.reset();
    this.load = h('div', { class: 'cm-bar load' }, h('i'));
    this.loadVal = h('span', { class: 'cm-val' }, '—');
    this.ctx = h('div', { class: 'cm-bar ctx' }, h('i'));
    this.ctxVal = h('span', { class: 'cm-val' }, '—');
    this.tok = h('span', { class: 'cm-tokens', title: 'Tokens da última chamada (↑ entrada, ↓ saída) e o total desta conversa' }, '');
    this.el = h('div', { class: 'chat-meter' },
      h('div', { class: 'cm-item', title: 'Modelo: carregamento e trabalho da IA' }, h('span', { class: 'cm-lbl' }, 'Modelo'), this.load, this.loadVal),
      h('div', { class: 'cm-item', title: 'Contexto: quanto da janela do modelo a conversa ocupa' }, h('span', { class: 'cm-lbl' }, 'Contexto'), this.ctx, this.ctxVal),
      this.tok);
    document.querySelector('#chat-dock .chat-head')?.after(this.el); // faixa própria logo abaixo do cabeçalho do chat
    this.refreshModel();
    this.render();
  }

  reset() {
    this.used = { input: 0, output: 0, calls: 0, last: null };
    this.contextNow = 0;
    this.render?.();
  }

  /** Limite de contexto do agente atual (LM Studio/Ollama > agente > tabela > padrão). */
  windowSize() {
    const a = this.chat.agent;
    return Number(a?.contexto) || this.info?.contexto || knownWindow(a?.model || this.app.settings?.providers?.[a?.provider]?.model, a?.provider) || (this.app.settings?.providers?.[a?.provider]?.local ? 8192 : 128000);
  }

  /** Consulta o estado do modelo local (carregado? contexto?). */
  async refreshModel() {
    const a = this.chat.agent;
    if (!a) { this.info = null; this.render(); return; }
    this.info = await B.ai.modelInfo?.(a.provider, a.model).catch(() => null) || null;
    this.render();
  }

  /** Antes de cada chamada: estimativa do contexto pelo tamanho das mensagens (≈ 4 caracteres por token). */
  start(messages) {
    const chars = messages.reduce((n, m) => n + String(m.content || '').length + JSON.stringify(m.tool_calls || '').length, 0);
    this.estimate = Math.round(chars / 4);
    this.t0 = performance.now();
    clearInterval(this.timer);
    this.timer = setInterval(() => this.render(), 100);
    this.busy = true;
    this.render();
  }

  /** Depois de cada chamada: uso real (quando o provedor informa). */
  done(usage) {
    this.busy = false;
    clearInterval(this.timer);
    if (usage) {
      const i = Number(usage.input) || 0, o = Number(usage.output) || 0;
      this.used.input += i; this.used.output += o; this.used.calls++;
      this.used.last = { input: i, output: o };
      this.contextNow = i + o;
    } else {
      this.used.calls++;
      this.used.last = null;
      this.contextNow = this.estimate || this.contextNow;
    }
    this.lastMs = performance.now() - this.t0;
    if (this.info?.estado === 'descarregado') this.refreshModel(); // a chamada carregou o modelo
    this.render();
  }

  fail() { this.busy = false; clearInterval(this.timer); this.render(); }

  render() {
    if (!this.el) return;
    // carregamento / trabalho
    const secs = this.busy ? (performance.now() - this.t0) / 1000 : 0;
    const cold = this.info?.estado === 'descarregado';
    this.load.classList.toggle('busy', !!this.busy);
    this.load.classList.toggle('cold', cold && !this.busy);
    this.load.querySelector('i').style.width = this.busy ? '' : (cold ? '0%' : '100%');
    this.loadVal.textContent = this.busy
      ? `${cold && secs > 1.5 ? 'carregando o modelo' : 'pensando'} ${secs.toFixed(1).replace('.', ',')} s`
      : cold ? 'descarregado' : this.lastMs ? `pronto · ${(this.lastMs / 1000).toFixed(1).replace('.', ',')} s` : (this.info ? 'carregado' : 'pronto');
    // contexto
    const win = this.windowSize();
    const now = this.busy ? Math.max(this.contextNow, this.estimate || 0) : this.contextNow;
    const pct = Math.min(1, now / win);
    const bar = this.ctx.querySelector('i');
    bar.style.width = `${(pct * 100).toFixed(1)}%`;
    this.ctx.classList.toggle('warn', pct >= 0.6 && pct < 0.85);
    this.ctx.classList.toggle('full', pct >= 0.85);
    this.ctxVal.textContent = `${fmtK(now)} / ${fmtK(win)}${this.used.last || !now ? '' : ' (estim.)'}`;
    this.ctx.parentElement.title = `Contexto: ${Math.round(pct * 100)}% da janela de ${win.toLocaleString('pt-BR')} tokens${this.info?.contexto ? ' (informada pelo servidor local)' : ''}. Perto de cheio, o modelo esquece o começo da conversa — use "Nova".`;
    // tokens
    const u = this.used, last = u.last;
    this.tok.textContent = u.calls
      ? `${last ? `↑${fmtK(last.input)} ↓${fmtK(last.output)} · ` : ''}Σ ${fmtK(u.input + u.output)} tokens · ${u.calls} chamada${u.calls === 1 ? '' : 's'}`
      : '0 tokens';
  }
}
