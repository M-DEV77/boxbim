// Chat de IA: monta o prompt do agente (skills + memórias + contexto da cena) e roda o loop de ferramentas.
import { $, h, esc, markdown, toast } from './ui.js';
import { toolsFor, runTool, sceneSummary } from './tools.js';

const B = window.boxbim;

export class Chat {
  constructor(app) {
    this.app = app;
    this.messages = [];      // histórico no formato neutro (sem o system)
    this.busy = false;
    this.requestId = null;
    this.stopped = false;
    this.el = $('#messages');
    this.input = $('#chat-input');

    $('#chat-form').addEventListener('submit', e => { e.preventDefault(); this.send(); });
    this.input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.send(); }
    });
    $('#chat-stop').addEventListener('click', () => this.stop());
    $('#chat-new').addEventListener('click', () => this.reset());
    $('#chat-save').addEventListener('click', () => this.saveMarkdown());
    $('#chat-remember').addEventListener('click', () => this.remember());
    this.reset();
  }

  get agent() { return this.app.currentAgent(); }

  reset() {
    this.stop();
    this.messages = [];
    this.el.innerHTML = '';
    this.info('Nova conversa. O agente pode consultar e modelar a cena, importar/exportar arquivos, falar com o Revit e guardar memórias em Markdown.');
  }

  info(text) { this.el.append(h('div', { class: 'msg info' }, text)); this.scroll(); }
  scroll() { this.el.scrollTop = this.el.scrollHeight; }

  // ---------------------------------------------------------------- prompt de sistema

  async systemPrompt(agent) {
    const s = this.app.settings;
    const parts = [agent.systemPrompt || 'Você é um assistente BIM.'];
    parts.push(`\n## Ambiente
Você está dentro do BoxBim, um aplicativo BIM desktop que importa e exporta Revit (via ponte com o Revit 2025), IFC, DWG, DXF, FBX, COLLADA, glTF, OBJ e STL.
Convenções do modelo: metros, eixo Z para cima, coordenadas [x, y] em planta. Data de hoje: ${new Date().toLocaleDateString('pt-BR')}.
Como no Revit, o projeto tem níveis (${this.app.levels.list.map(l => `${l.name} ${l.elevation} m`).join('; ')}); cada nível tem planta de piso e de forro, e há elevações Norte/Sul/Leste/Oeste. Vista ativa: ${this.app.views.label(this.app.views.active)}.
Ao modelar, informe "level": as cotas passam a ser deslocamentos a partir do nível e paredes/pilares vão até o nível de cima.
Responda em português do Brasil, de forma objetiva. Use as ferramentas em vez de pedir ao usuário para fazer o que você mesmo consegue fazer.`);

    // Skills
    const skills = (await B.skills.list()).filter(sk => agent.skills.includes(sk.id));
    if (skills.length) {
      if (agent.useTools) {
        parts.push('\n## Skills disponíveis\nAntes de uma tarefa que combine com uma skill, chame `use_skill` com o nome dela para carregar as instruções completas.\n' +
          skills.map(sk => `- **${sk.id}**: ${sk.description}`).join('\n'));
      } else {
        parts.push('\n## Skills\n' + skills.map(sk => `### ${sk.name}\n${sk.body}`).join('\n\n'));
      }
    }

    // Memória
    if (s.memory.enabled && agent.memory !== false) {
      if (s.memory.injectIndex) {
        const index = (await B.memory.index()).trim();
        const mems = await B.memory.list();
        parts.push(`\n## Memória (arquivos Markdown em ${this.app.dirs?.memory || 'memory/'})\n${index || '(vazia)'}`);
        // Memórias de usuário e feedback entram inteiras: são curtas e mudam o comportamento
        const always = mems.filter(m => m.type === 'user' || m.type === 'feedback').slice(0, 12);
        if (always.length) parts.push(always.map(m => `### ${m.name}\n${m.body}`).join('\n\n'));
      }
      if (agent.useTools) {
        parts.push(s.memory.autoSave
          ? 'Quando o usuário compartilhar preferências, correções, fatos do projeto ou decisões que valham para próximas conversas, salve com `save_memory` (sem perguntar), atualizando a memória existente em vez de duplicar. Não salve o que é óbvio pelo modelo ou só importa nesta conversa. Leia memórias relevantes com `read_memory`.'
          : 'Só salve memórias com `save_memory` quando o usuário pedir explicitamente.');
      }
    }
    return parts.join('\n');
  }

  // ---------------------------------------------------------------- envio

  async send(textOverride) {
    const text = (textOverride ?? this.input.value).trim();
    if (!text || this.busy) return;
    const agent = this.agent;
    if (!agent) return toast('Crie ou selecione um agente.', 'error');
    this.input.value = '';

    let content = text;
    if ($('#chat-scene').checked && this.app.viewer.elements().length) {
      const sum = sceneSummary(this.app.viewer, 25);
      const sel = [...this.app.viewer.selected].map(o => o.uuid);
      content += `\n\n<contexto_da_cena>${JSON.stringify({ total: sum.total, porTipo: sum.byType, limites: sum.bounds, selecionados: sel })}</contexto_da_cena>`;
    }
    this.messages.push({ role: 'user', content });
    this.el.append(h('div', { class: 'msg user' }, text));
    this.scroll();
    await this.run(agent);
  }

  setBusy(b) {
    this.busy = b;
    $('#chat-send').disabled = b;
    $('#chat-stop').hidden = !b;
  }

  stop() {
    this.stopped = true;
    if (this.requestId) B.ai.cancel(this.requestId).catch(() => {});
  }

  async run(agent) {
    this.setBusy(true);
    this.stopped = false;
    const settings = this.app.settings;
    const tools = agent.useTools ? toolsFor(agent, settings) : [];
    const providerLabel = settings.providers[agent.provider]?.label || agent.provider;
    const typing = h('div', { class: 'msg assistant' }, h('span', { class: 'typing' }, h('i'), h('i'), h('i')));
    try {
      const system = await this.systemPrompt(agent);
      for (let step = 0; step < agent.maxSteps; step++) {
        if (this.stopped) break;
        this.el.append(typing); this.scroll();
        this.requestId = crypto.randomUUID();
        const res = await B.ai.chat({
          requestId: this.requestId,
          providerId: agent.provider,
          model: agent.model,
          temperature: agent.temperature,
          maxTokens: agent.maxTokens,
          messages: [{ role: 'system', content: system }, ...this.messages],
          tools: tools.map(({ name, description, parameters }) => ({ name, description, parameters })),
        });
        typing.remove();
        this.messages.push({ role: 'assistant', content: res.content || '', tool_calls: res.tool_calls, raw: res.raw });
        this.renderAssistant(res, `${agent.name} · ${providerLabel}${agent.model ? ' · ' + agent.model : ''}`);
        if (!res.tool_calls?.length) break;

        for (const tc of res.tool_calls) {
          if (this.stopped) {
            this.messages.push({ role: 'tool', tool_call_id: tc.id, name: tc.name, content: 'Interrompido pelo usuário.', isError: true });
            continue;
          }
          const card = h('details', { class: 'tool' }, h('summary', {}, `⚙ ${tc.name}`), h('pre', {}, JSON.stringify(tc.arguments, null, 2)));
          this.el.append(card); this.scroll();
          let out, isError = false;
          try {
            out = await runTool(tc.name, tc.arguments || {}, this.toolContext());
          } catch (e) {
            out = `Erro: ${e.message}`; isError = true;
            card.classList.add('err');
          }
          out = String(out);
          if (out.length > 30000) out = out.slice(0, 30000) + '\n…(truncado)';
          card.querySelector('summary').textContent = `${isError ? '✖' : '✔'} ${tc.name}`;
          card.append(h('pre', {}, out.length > 3000 ? out.slice(0, 3000) + '…' : out));
          this.messages.push({ role: 'tool', tool_call_id: tc.id, name: tc.name, content: out, isError });
        }
        if (step === agent.maxSteps - 1) this.info(`Limite de ${agent.maxSteps} passos atingido. Envie "continue" para seguir.`);
      }
    } catch (e) {
      typing.remove();
      this.el.append(h('div', { class: 'msg error' }, e.message));
      // remove a última mensagem do usuário que falhou? Mantemos para permitir "tentar de novo"
    } finally {
      typing.remove();
      this.requestId = null;
      this.setBusy(false);
      this.scroll();
    }
  }

  toolContext() {
    return {
      app: this.app,
      viewer: this.app.viewer,
      levels: this.app.levels,
      views: this.app.views,
      settings: this.app.settings,
      agent: this.agent,
      log: msg => this.app.status(msg),
      refresh: () => this.app.refreshTree(),
      onMemory: () => this.app.panels.renderMemory(),
      confirm: text => this.confirm(text),
    };
  }

  confirm(text) {
    return new Promise(resolve => {
      const card = h('div', { class: 'confirm-card' },
        h('div', {}, 'O agente quer executar uma ação que altera o projeto ou o Revit:'),
        h('code', {}, text),
        h('div', { class: 'row' },
          h('button', { onclick: () => { card.remove(); resolve(false); } }, 'Recusar'),
          h('button', { class: 'primary', onclick: () => { card.replaceWith(h('div', { class: 'msg info' }, 'Ação permitida.')); resolve(true); } }, 'Permitir')));
      this.el.append(card); this.scroll();
    });
  }

  renderAssistant(res, meta) {
    const box = h('div', { class: 'msg assistant' }, h('div', { class: 'meta' }, meta));
    if (res.reasoning) box.append(h('details', { class: 'reasoning' }, h('summary', {}, 'raciocínio'), h('div', {}, res.reasoning)));
    if (res.content) box.append(h('div', { html: markdown(res.content) }));
    else if (!res.tool_calls?.length) box.append(h('div', { class: 'muted' }, '(resposta vazia)'));
    if (res.usage) box.append(h('div', { class: 'meta', style: 'margin-top:4px' }, `tokens: ${res.usage.input ?? '?'} → ${res.usage.output ?? '?'}`));
    if (res.content || res.reasoning || !res.tool_calls?.length) { this.el.append(box); this.scroll(); }
  }

  // ---------------------------------------------------------------- Markdown

  transcript() {
    const lines = [`# Conversa BoxBim — ${new Date().toLocaleString('pt-BR')}`, '', `Agente: ${this.agent?.name || '?'}`, ''];
    for (const m of this.messages) {
      if (m.role === 'user') lines.push('## Usuário', '', m.content.replace(/<contexto_da_cena>[\s\S]*?<\/contexto_da_cena>/, '').trim(), '');
      else if (m.role === 'assistant') {
        if (m.content) lines.push('## Assistente', '', m.content, '');
        for (const tc of m.tool_calls || []) lines.push(`> ferramenta \`${tc.name}\` ${JSON.stringify(tc.arguments)}`, '');
      } else if (m.role === 'tool') lines.push('```', m.content.slice(0, 2000), '```', '');
    }
    return lines.join('\n');
  }

  async saveMarkdown() {
    if (!this.messages.length) return toast('Conversa vazia.');
    const first = this.messages.find(m => m.role === 'user')?.content.slice(0, 40) || 'conversa';
    const file = await B.chats.save(first, this.transcript());
    toast(`Conversa salva em\n${file}`);
  }

  async remember() {
    if (!this.messages.length) return toast('Conversa vazia.');
    if (!this.app.settings.memory.enabled) return toast('A memória está desativada nas Configurações.', 'error');
    await this.send('Revise esta conversa e salve com `save_memory` o que vale lembrar em conversas futuras (preferências, decisões, fatos do projeto). Atualize memórias existentes em vez de duplicar e diga o que salvou.');
  }
}

export { esc };
