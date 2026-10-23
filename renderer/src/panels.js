// Painéis laterais (Agentes, Skills, Memória) e a janela de Configurações.
import { $, h, toast, modal, confirmDialog, markdown } from './ui.js';
import { TOOL_GROUPS } from './tools.js';

const B = window.boxbim;

export class Panels {
  constructor(app) {
    this.app = app;
    this.editingAgent = null;
    this.editingSkill = null;
  }

  async renderAll() {
    await Promise.all([this.renderAgents(), this.renderSkills(), this.renderMemory()]);
  }

  // ---------------------------------------------------------------- Agentes

  async renderAgents() {
    const root = $('#agents-panel');
    const agents = this.app.agents;
    const skills = await B.skills.list();
    root.innerHTML = '';
    root.append(
      h('div', { class: 'section-title' }, 'Agentes', h('span', { class: 'spacer' }),
        h('button', { onclick: () => this.editAgent(newAgent(this.app.settings)) }, '+ Novo agente')),
      h('div', { class: 'list' }, agents.map(a => h('div', {
        class: `item${a.id === this.app.settings.activeAgent ? ' active' : ''}`,
        onclick: () => this.editAgent(a),
      }, h('div', {}, h('div', { class: 'title' }, a.name), h('div', { class: 'desc' }, a.description || a.systemPrompt.slice(0, 80))),
      h('span', { class: 'badge' }, this.app.settings.providers[a.provider]?.label?.split(' ')[0] || a.provider)))),
    );
    if (this.editingAgent) root.append(this.agentForm(this.editingAgent, skills));
  }

  editAgent(a) {
    this.editingAgent = structuredClone(a);
    this.renderAgents();
  }

  agentForm(a, skills) {
    const s = this.app.settings;
    const f = {};
    const providerSel = f.provider = h('select', {}, Object.entries(s.providers).map(([id, p]) => h('option', { value: id, selected: id === a.provider }, p.label)));
    const modelList = h('datalist', { id: 'agent-models' });
    f.model = h('input', { value: a.model || '', list: 'agent-models', placeholder: s.providers[a.provider]?.model || 'modelo' });
    const loadModels = async () => {
      modelList.innerHTML = '';
      try {
        const models = await B.ai.models(providerSel.value);
        models.forEach(m => modelList.append(h('option', { value: m })));
        toast(`${models.length} modelos encontrados.`);
      } catch (e) { toast(e.message, 'error'); }
    };
    f.name = h('input', { value: a.name });
    f.description = h('input', { value: a.description || '' });
    f.temperature = h('input', { type: 'number', step: '0.1', min: 0, max: 2, value: a.temperature ?? '', placeholder: 'padrão' });
    f.maxTokens = h('input', { type: 'number', value: a.maxTokens || 4096 });
    f.maxSteps = h('input', { type: 'number', value: a.maxSteps || 8 });
    f.useTools = h('input', { type: 'checkbox', checked: a.useTools !== false });
    f.memory = h('input', { type: 'checkbox', checked: a.memory !== false });
    f.system = h('textarea', { rows: 10 }, a.systemPrompt || '');
    const toolChecks = Object.entries(TOOL_GROUPS).map(([g, label]) => h('label', {}, h('input', { type: 'checkbox', value: g, checked: (a.tools || []).includes(g) }), label));
    const skillChecks = skills.map(sk => h('label', { title: sk.description }, h('input', { type: 'checkbox', value: sk.id, checked: (a.skills || []).includes(sk.id) }), sk.name));

    const save = async () => {
      const agent = {
        id: a.id, name: f.name.value.trim() || 'Agente', description: f.description.value.trim(),
        provider: providerSel.value, model: f.model.value.trim(),
        temperature: f.temperature.value === '' ? null : Number(f.temperature.value),
        maxTokens: Number(f.maxTokens.value) || 4096, maxSteps: Number(f.maxSteps.value) || 8,
        useTools: f.useTools.checked, memory: f.memory.checked,
        tools: toolChecks.map(l => l.querySelector('input')).filter(i => i.checked).map(i => i.value),
        skills: skillChecks.map(l => l.querySelector('input')).filter(i => i.checked).map(i => i.value),
        systemPrompt: f.system.value,
      };
      const id = await B.agents.save(agent);
      this.editingAgent = null;
      await this.app.loadAgents(id);
      toast(`Agente "${agent.name}" salvo.`);
    };

    return h('div', { class: 'form', style: 'border-top:1px solid var(--line);padding-top:10px' },
      h('div', { class: 'section-title' }, a.id ? `Editar: ${a.name}` : 'Novo agente'),
      h('label', {}, 'Nome', f.name),
      h('label', {}, 'Descrição', f.description),
      h('div', { class: 'row' }, h('label', {}, 'Provedor', providerSel), h('label', {}, 'Modelo', h('div', { style: 'display:flex;gap:4px' }, f.model, h('button', { type: 'button', title: 'Listar modelos do provedor', onclick: loadModels }, '↻')), modelList)),
      h('div', { class: 'row' }, h('label', {}, 'Temperatura', f.temperature), h('label', {}, 'Máx. tokens', f.maxTokens), h('label', {}, 'Máx. passos', f.maxSteps)),
      h('label', { class: 'inline' }, f.useTools, 'Usar ferramentas (function calling) — desligue para modelos locais sem suporte'),
      h('label', { class: 'inline' }, f.memory, 'Usar memória em Markdown'),
      h('label', {}, 'Ferramentas permitidas', h('div', { class: 'checks' }, toolChecks)),
      h('label', {}, 'Skills', skills.length ? h('div', { class: 'checks' }, skillChecks) : h('span', {}, 'Nenhuma skill — crie na aba Skills.')),
      h('label', {}, 'Prompt de sistema (instruções do agente)', f.system),
      h('div', { class: 'actions' },
        a.id ? h('button', { class: 'danger', onclick: async () => {
          if (!(await confirmDialog(`Apagar o agente "${a.name}"?`, { danger: true, ok: 'Apagar' }))) return;
          await B.agents.remove(a.id); this.editingAgent = null; await this.app.loadAgents();
        } }, 'Apagar') : null,
        h('span', { class: 'spacer' }),
        h('button', { onclick: () => { this.editingAgent = null; this.renderAgents(); } }, 'Fechar'),
        a.id ? h('button', { onclick: async () => { await save(); this.app.selectAgent(a.id); } }, 'Salvar e usar') : null,
        h('button', { class: 'primary', onclick: save }, 'Salvar')),
    );
  }

  // ---------------------------------------------------------------- Skills

  async renderSkills() {
    const root = $('#skills-panel');
    const skills = await B.skills.list();
    root.innerHTML = '';
    root.append(
      h('div', { class: 'section-title' }, 'Skills', h('span', { class: 'spacer' }),
        h('button', { onclick: async () => B.shell.open((await B.dirs()).skills) }, 'Abrir pasta'),
        h('button', { onclick: () => { this.editingSkill = { name: '', description: '', body: '' }; this.renderSkills(); } }, '+ Nova skill')),
      h('div', { class: 'small muted' }, 'Cada skill é uma pasta com SKILL.md (frontmatter name/description + instruções). O agente vê a descrição e carrega o conteúdo com use_skill quando precisa.'),
      h('div', { class: 'list' }, skills.map(sk => h('div', { class: 'item', onclick: () => { this.editingSkill = sk; this.renderSkills(); } },
        h('div', {}, h('div', { class: 'title' }, sk.name), h('div', { class: 'desc' }, sk.description))))),
    );
    if (this.editingSkill) root.append(this.skillForm(this.editingSkill));
  }

  skillForm(sk) {
    const name = h('input', { value: sk.name, placeholder: 'ex.: Compatibilização IFC' });
    const desc = h('input', { value: sk.description, placeholder: 'Quando usar esta skill (o agente decide por esta frase)' });
    const body = h('textarea', { rows: 14 }, sk.body);
    return h('div', { class: 'form', style: 'border-top:1px solid var(--line);padding-top:10px' },
      h('label', {}, 'Nome', name), h('label', {}, 'Descrição', desc), h('label', {}, 'Instruções (Markdown)', body),
      h('div', { class: 'actions' },
        sk.id ? h('button', { class: 'danger', onclick: async () => {
          if (!(await confirmDialog(`Apagar a skill "${sk.name}"?`, { danger: true, ok: 'Apagar' }))) return;
          await B.skills.remove(sk.id); this.editingSkill = null; this.renderSkills(); this.renderAgents();
        } }, 'Apagar') : null,
        h('span', { class: 'spacer' }),
        h('button', { onclick: () => { this.editingSkill = null; this.renderSkills(); } }, 'Fechar'),
        h('button', { class: 'primary', onclick: async () => {
          if (!name.value.trim()) return toast('Dê um nome à skill.', 'error');
          await B.skills.save({ id: sk.id, name: name.value.trim(), description: desc.value.trim(), body: body.value });
          this.editingSkill = null; toast('Skill salva.'); this.renderSkills(); this.renderAgents();
        } }, 'Salvar')),
    );
  }

  // ---------------------------------------------------------------- Memória

  async renderMemory() {
    const root = $('#memory-panel');
    const s = this.app.settings;
    const mems = await B.memory.list();
    const dirs = await B.dirs();
    const toggle = (key, label) => h('label', { class: 'inline' }, h('input', {
      type: 'checkbox', checked: s.memory[key],
      onchange: async e => { await this.app.saveSettings({ memory: { ...s.memory, [key]: e.target.checked } }); },
    }), label);
    root.innerHTML = '';
    root.append(
      h('div', { class: 'section-title' }, 'Memória em Markdown', h('span', { class: 'spacer' }),
        h('button', { onclick: () => B.shell.open(dirs.memory) }, 'Abrir pasta'),
        h('button', { onclick: () => this.editMemory({ name: '', description: '', type: 'project', body: '' }) }, '+ Nova')),
      h('div', { class: 'form' },
        toggle('enabled', 'Guardar memórias em arquivos Markdown'),
        toggle('autoSave', 'O agente salva memórias sozinho quando aprende algo duradouro'),
        toggle('injectIndex', 'Incluir o índice MEMORY.md no contexto de cada conversa')),
      h('div', { class: 'small muted' }, `Pasta: ${dirs.memory}`),
      mems.length ? h('div', { class: 'list' }, mems.map(m => h('div', { class: 'item', onclick: () => this.editMemory(m) },
        h('div', {}, h('div', { class: 'title' }, m.name), h('div', { class: 'desc' }, m.description)),
        h('span', { class: 'badge' }, m.type)))) : h('div', { class: 'muted' }, 'Nenhuma memória ainda.'),
    );
  }

  editMemory(m) {
    const name = h('input', { value: m.name });
    const desc = h('input', { value: m.description });
    const type = h('select', {}, ['user', 'feedback', 'project', 'reference'].map(t => h('option', { value: t, selected: t === m.type }, t)));
    const body = h('textarea', { rows: 12 }, m.body);
    const preview = h('div', { class: 'msg assistant', html: markdown(m.body) });
    body.addEventListener('input', () => { preview.innerHTML = markdown(body.value); });
    modal({
      title: m.id ? `Memória: ${m.name}` : 'Nova memória',
      body: h('div', { class: 'form' }, h('div', { class: 'row' }, h('label', {}, 'Nome', name), h('label', {}, 'Tipo', type)),
        h('label', {}, 'Descrição (uma linha)', desc), h('label', {}, 'Conteúdo (Markdown)', body), h('label', {}, 'Prévia', preview)),
      actions: [
        ...(m.id ? [{ label: 'Apagar', class: 'danger', action: async () => { await B.memory.remove(m.id); this.renderMemory(); } }] : []),
        { label: 'Cancelar' },
        { label: 'Salvar', class: 'primary', action: async () => {
          if (!name.value.trim()) { toast('Dê um nome.', 'error'); return false; }
          if (m.id && m.name !== name.value.trim()) await B.memory.remove(m.id);
          await B.memory.save({ id: m.name === name.value.trim() ? m.id : undefined, name: name.value.trim(), description: desc.value.trim(), type: type.value, body: body.value });
          this.renderMemory();
        } },
      ],
    });
  }

  // ---------------------------------------------------------------- Configurações

  openSettings(section = 'providers') {
    const s = structuredClone(this.app.settings);
    const keys = {}; // chaves digitadas nesta sessão
    const pane = h('div', { class: 'pane' });
    const nav = h('nav', {});
    const sections = {
      providers: ['Provedores de IA', () => this.providersPane(s, keys)],
      tools: ['Ferramentas', () => this.toolsPane(s)],
      data: ['Dados', () => this.dataPane(s)],
      about: ['Sobre', () => aboutPane()],
    };
    const show = id => {
      nav.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.id === id));
      pane.innerHTML = '';
      pane.append(sections[id][1]());
    };
    for (const [id, [label]] of Object.entries(sections)) nav.append(h('button', { 'data-id': id, onclick: () => show(id) }, label));
    show(section);
    modal({
      title: 'Configurações',
      body: h('div', {}, this.app.info?.usuario?.admin ? null : h('div', { class: 'small muted', style: 'margin-bottom:8px' }, 'Somente leitura: só o administrador do servidor altera estas configurações.'), h('div', { class: 'settings' }, nav, pane)),
      // só o administrador do servidor altera (chaves de IA e caminhos valem para todos)
      actions: !this.app.info?.usuario?.admin ? [{ label: 'Fechar', class: 'primary' }] : [{ label: 'Cancelar' }, { label: 'Salvar', class: 'primary', action: async () => {
        const providers = {};
        for (const [id, p] of Object.entries(s.providers)) {
          const { hasKey, ...rest } = p;
          providers[id] = id in keys ? { ...rest, apiKey: keys[id] } : rest;
        }
        await this.app.saveSettings({ providers, tools: s.tools, revit: s.revit, dataDir: s.dataDir, autoApprove: s.autoApprove });
        await this.app.loadAgents();
        await this.renderAll();
        toast('Configurações salvas.');
      } }],
    });
  }

  providersPane(s, keys) {
    const list = h('div', {});
    const render = () => {
      list.innerHTML = '';
      for (const [id, p] of Object.entries(s.providers)) {
        const key = h('input', { type: 'password', placeholder: p.hasKey ? '•••••••• (salva — digite para trocar)' : (p.local ? 'opcional para servidor local' : 'chave de API'), oninput: e => { keys[id] = e.target.value; } });
        const url = h('input', { value: p.baseUrl, oninput: e => { p.baseUrl = e.target.value.trim(); } });
        const models = h('datalist', { id: `dl-${id}` });
        const model = h('input', { value: p.model || '', list: `dl-${id}`, placeholder: 'modelo padrão', oninput: e => { p.model = e.target.value.trim(); } });
        const status = h('span', { class: `tag${p.hasKey || p.local ? ' ok' : ''}` }, p.local ? 'local' : p.hasKey ? 'chave salva' : 'sem chave');
        const test = async () => {
          // salva primeiro para o processo principal usar URL/chave atuais
          const { hasKey, ...rest } = p;
          await this.app.saveSettings({ providers: { ...Object.fromEntries(Object.entries(s.providers).map(([k, v]) => { const { hasKey: _, ...r } = v; return [k, r]; })), [id]: id in keys ? { ...rest, apiKey: keys[id] } : rest } });
          try {
            const ms = await B.ai.models(id);
            models.innerHTML = '';
            ms.forEach(m => models.append(h('option', { value: m })));
            status.textContent = `${ms.length} modelos`; status.className = 'tag ok';
            if (!p.model && ms[0]) { p.model = ms[0]; model.value = ms[0]; }
          } catch (e) { status.textContent = 'falhou'; status.className = 'tag'; toast(e.message, 'error'); }
        };
        list.append(h('div', { class: 'provider' },
          h('div', { class: 'head' }, p.label, status, h('span', { class: 'spacer' }),
            h('button', { onclick: test, title: 'Testa a conexão e lista os modelos' }, 'Testar / listar modelos'),
            p.custom ? h('button', { class: 'danger', onclick: () => { delete s.providers[id]; render(); } }, '✕') : null),
          h('div', { class: 'form' },
            h('div', { class: 'row' }, h('label', {}, `URL base (${p.type === 'openai' ? 'compatível com OpenAI' : p.type})`, url), h('label', {}, 'Modelo padrão', model, models)),
            h('label', {}, 'Chave de API (guardada criptografada pelo Windows)', key))));
      }
    };
    render();
    const addCustom = () => {
      const id = 'custom-' + Date.now().toString(36);
      s.providers[id] = { type: 'openai', label: 'Personalizado (OpenAI-compatível)', baseUrl: 'http://localhost:8000/v1', model: '', local: true, custom: true };
      render();
    };
    return h('div', {},
      h('div', { class: 'small muted', style: 'margin-bottom:8px' },
        'Locais: LM Studio (Developer › Start Server, porta 1234), Ollama (porta 11434) e llama.cpp (llama-server, porta 8080) usam a API compatível com OpenAI. Nuvem: Claude, OpenAI, Gemini, OpenRouter, Groq, DeepSeek, Mistral e xAI.'),
      list,
      h('button', { onclick: addCustom }, '+ Provedor personalizado (OpenAI-compatível)'));
  }

  toolsPane(s) {
    const input = {
      blenderPath: h('input', { value: s.tools.blenderPath || '', oninput: e => { s.tools.blenderPath = e.target.value; } }),
      odaPath: h('input', { value: s.tools.odaPath || '', oninput: e => { s.tools.odaPath = e.target.value; } }),
      unrealPath: h('input', { value: s.tools.unrealPath || '', placeholder: 'automático (Epic Games Launcher)', oninput: e => { s.tools.unrealPath = e.target.value; } }),
    };
    const port = h('input', { type: 'number', value: s.revit.port, oninput: e => { s.revit.port = Number(e.target.value) || 48884; } });
    const auto = h('input', { type: 'checkbox', checked: !!s.autoApprove, onchange: e => { s.autoApprove = e.target.checked; } });
    return h('div', { class: 'form' },
      h('div', { class: 'small muted' }, 'Caminhos NO COMPUTADOR DO SERVIDOR. Revit, Unreal e abrir pastas só funcionam quando o BoxBim é aberto no próprio servidor (localhost); Blender e ODA convertem para todos.'),
      h('div', { class: 'section-title' }, 'Revit 2025'),
      h('label', {}, 'Porta da ponte BoxBim Bridge (add-in)', port),
      h('div', { class: 'small muted' }, 'Instale o add-in com revit-addin\\install-addin.ps1 e reinicie o Revit. Ele cria a aba "BoxBim" na faixa de opções.'),
      h('div', { class: 'section-title' }, 'Conversores'),
      h('label', {}, 'Blender (exportar FBX)', input.blenderPath),
      h('label', {}, 'ODA File Converter (ler/gravar DWG)', input.odaPath),
      h('label', {}, 'Unreal Engine 5 (render com DLSS)', input.unrealPath),
      h('div', { class: 'small muted' }, 'O ODA File Converter é gratuito (opendesign.com/guestfiles/oda_file_converter). Sem ele, o DWG passa pelo Revit: importe o DWG no Revit e traga o modelo, ou peça ao Revit para exportar DWG.'),
      h('div', { class: 'section-title' }, 'Agentes'),
      h('label', { class: 'inline' }, auto, 'Permitir que o agente apague/limpe elementos do BoxBim sem perguntar (ações no Revit sempre perguntam)'));
  }

  dataPane(s) {
    const dir = h('input', { value: s.dataDir, oninput: e => { s.dataDir = e.target.value; } });
    return h('div', { class: 'form' },
      h('label', {}, 'Pasta de dados (agentes, skills, memória, conversas)', h('div', { style: 'display:flex;gap:4px' }, dir,
        h('button', { onclick: () => B.shell.open(s.dataDir) }, 'Abrir'))),
      h('pre', { class: 'small muted' }, `${s.dataDir}\n├─ agents/<agente>.md\n├─ skills/<skill>/SKILL.md\n├─ memory/MEMORY.md + <memória>.md\n└─ chats/<data>-<título>.md`));
  }
}

function aboutPane() {
  const pane = h('div', { class: 'form' },
    h('div', { style: 'display:flex;gap:12px;align-items:center' }, h('img', { src: '/assets/icon.svg', style: 'width:72px' }),
      h('div', {}, h('div', { style: 'font-size:18px;font-weight:700', 'data-version': '' }, 'BoxBim'), h('div', { class: 'muted' }, 'Modelagem BIM no navegador, em equipe, com IA e ponte com o Revit 2025.'))),
    h('div', { class: 'small muted' }, 'Formatos: RVT (ponte Revit), IFC, DWG (ODA), DXF, FBX (Blender), COLLADA, glTF, OBJ, STL. Bibliotecas: three.js, web-ifc, dxf-parser, three-gpu-pathtracer; servidor Express + Sequelize + SQLite.'));
  B.version().then(v => { pane.querySelector('[data-version]').textContent = `BoxBim ${v}`; });
  return pane;
}

function newAgent(settings) {
  return {
    name: 'Novo agente', description: '', provider: 'anthropic', model: settings.providers.anthropic?.model || '',
    temperature: null, maxTokens: 4096, maxSteps: 8, useTools: true, memory: true,
    tools: Object.keys(TOOL_GROUPS), skills: [], systemPrompt: 'Você é um especialista em BIM que ajuda o usuário dentro do BoxBim.',
  };
}
