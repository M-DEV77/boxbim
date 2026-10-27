// AMBIENTES e CAMADAS do projeto. O administrador (dono) cria os ambientes — ex.: Arquitetura, Estrutura,
// Instalações — e, em cada um, as camadas com os tipos de desenho que entram nelas: Arquitetura › Paredes (paredes),
// Arquitetura › Esquadrias (portas, janelas)… Todo elemento guarda a camada em bim.camadaId.
//   dados.ambientes = [{ id, nome, cor, camadas: [{ id, nome, cor, tipos: ['IfcWall', …] }] }]   (só o dono grava)
//   Membro.camadas  = ids das camadas que o membro pode editar (null = todas) — o servidor confere cada gravação.
// Cada usuário escolhe a camada ativa (onde caem os elementos novos), oculta e trava camadas na própria tela.
// Elementos de camadas que a pessoa não pode editar ficam visíveis, mas não são selecionáveis (nem editáveis).
import { h, modal, toast } from './ui.js';

export const DRAWING_TYPES = {
  IfcWall: 'Paredes', IfcSlab: 'Pisos', IfcRoof: 'Telhados', IfcColumn: 'Pilares', IfcBeam: 'Vigas',
  IfcDoor: 'Portas', IfcWindow: 'Janelas', IfcStair: 'Escadas', IfcRailing: 'Guarda-corpos', IfcFurniture: 'Mobiliário',
  IfcCovering: 'Revestimentos', IfcMember: 'Peças estruturais', IfcPlate: 'Chapas', IfcReinforcingBar: 'Armaduras',
  IfcFlowTerminal: 'Instalações (terminais)', IfcSanitaryTerminal: 'Louças e metais', IfcLightFixture: 'Iluminação',
  IfcAnnotation: 'Desenho 2D (linhas)', IfcGrid: 'Eixos de trabalho', IfcBuildingElementProxy: 'Sólidos e genéricos', IfcOpeningElement: 'Vazios',
};

/** Modelo inicial de ambientes (o administrador ajusta à vontade). */
export const TEMPLATE = [
  { nome: 'Arquitetura', cor: '#2fd18a', camadas: [
    { nome: 'Paredes', tipos: ['IfcWall'] }, { nome: 'Pisos', tipos: ['IfcSlab', 'IfcCovering'] },
    { nome: 'Esquadrias', tipos: ['IfcDoor', 'IfcWindow'] }, { nome: 'Mobiliário', tipos: ['IfcFurniture', 'IfcSanitaryTerminal', 'IfcLightFixture'] },
    { nome: 'Cobertura', tipos: ['IfcRoof'] }, { nome: 'Desenho 2D', tipos: ['IfcAnnotation', 'IfcGrid'] }] },
  { nome: 'Estrutura', cor: '#3aa0ff', camadas: [
    { nome: 'Pilares', tipos: ['IfcColumn'] }, { nome: 'Vigas', tipos: ['IfcBeam', 'IfcMember'] },
    { nome: 'Pisos estruturais', tipos: [] }, { nome: 'Armaduras', tipos: ['IfcReinforcingBar'] }] },
  { nome: 'Instalações', cor: '#ff9f1c', camadas: [{ nome: 'Hidráulica', tipos: ['IfcFlowTerminal', 'IfcSanitaryTerminal'] }, { nome: 'Elétrica', tipos: ['IfcLightFixture'] }] },
];

const uid = () => crypto.randomUUID();
const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem armazenamento */ } };
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };

export class Environments extends EventTarget {
  constructor(app) {
    super();
    this.app = app;
    this.list = [];
    this.mine = null;     // camadas que eu posso editar (null = todas)
    this.papel = 'dono';
    this.hidden = new Set();
    this.locked = new Set();
    this.activeId = null;
  }

  get viewer() { return this.app.viewer; }
  get key() { return `boxbim.amb.${this.app.project?.id || 'local'}`; }
  get isAdmin() { return this.papel === 'dono'; }

  /** Ambientes do projeto + as minhas permissões (ao abrir e quando mudam). */
  load({ ambientes, mine, papel } = {}) {
    if (ambientes !== undefined) this.list = Array.isArray(ambientes) ? ambientes : [];
    if (mine !== undefined) this.mine = Array.isArray(mine) ? mine : null;
    if (papel !== undefined) this.papel = papel;
    const st = load(this.key, {});
    this.hidden = new Set(st.hidden || []);
    this.locked = new Set(st.locked || []);
    const ids = new Set(this.camadas().map(c => c.id));
    this.activeId = ids.has(st.active) && this.editable(st.active) ? st.active : (this.camadas().find(c => this.editable(c.id))?.id || null);
    this.apply();
    this.dispatchEvent(new Event('change'));
  }

  persist() { store(this.key, { hidden: [...this.hidden], locked: [...this.locked], active: this.activeId }); }

  camadas() { return this.list.flatMap(a => (a.camadas || []).map(c => ({ ...c, ambiente: a.nome, ambienteId: a.id, corAmbiente: a.cor }))); }
  camada(id) { return this.camadas().find(c => c.id === id) || null; }
  label(id) { const c = this.camada(id); return c ? `${c.ambiente} › ${c.nome}` : 'Sem camada'; }

  /** Tenho permissão de editar esta camada? (sem considerar a minha trava visual) */
  allowed(id) {
    if (this.papel === 'leitor') return false;
    if (!this.mine) return true;
    return !!id && this.mine.includes(id);
  }
  editable(id) { return this.allowed(id) && !this.locked.has(id ?? '_sem'); }
  canEdit(el) { return this.editable(el?.userData?.bim?.camadaId ?? null); }

  /** Camada de um elemento novo: a ativa (se aceita o tipo) ou a primeira que aceita o tipo, entre as que posso editar. */
  assign(el) {
    const b = el.userData.bim;
    if (!b || b.camadaId || !this.list.length) return;
    const type = b.type;
    const ok = this.camadas().filter(c => this.editable(c.id));
    const act = ok.find(c => c.id === this.activeId);
    const accepts = c => !c.tipos?.length || c.tipos.includes(type);
    const pick = (act && accepts(act) ? act : null) || ok.find(c => c.tipos?.includes(type)) || act || ok[0] || null;
    if (pick) { b.camadaId = pick.id; b.props = { ...(b.props || {}), Camada: this.label(pick.id) }; }
  }

  /** Elemento entrando no modelo: novos ganham camada; todos recebem visibilidade e trava. */
  onAdd(el) {
    if (!this.app.project?.applying) this.assign(el);
    this.applyTo(el);
  }

  applyTo(el) {
    const id = el.userData.bim?.camadaId ?? null;
    el.userData.envHidden = !!id && this.hidden.has(id);
    this.app.viewer.updateVisibility(el); // junta camada, oculto por você e categorias (viewer)
    el.userData.locked = !this.canEdit(el);
  }

  apply() {
    for (const el of this.viewer.elements()) this.applyTo(el);
    // o que ficou travado sai da seleção
    const sel = [...this.viewer.selected].filter(o => !o.userData.locked);
    if (sel.length !== this.viewer.selected.size) this.viewer.select(sel);
  }

  count(id) { return this.viewer.elements().filter(e => (e.userData.bim.camadaId ?? null) === id).length; }

  setActive(id) { if (!this.editable(id)) return; this.activeId = id; this.persist(); this.dispatchEvent(new Event('change')); }
  toggleHidden(id) { if (this.hidden.has(id)) this.hidden.delete(id); else this.hidden.add(id); this.persist(); this.apply(); this.dispatchEvent(new Event('change')); }
  toggleLocked(id) { if (this.locked.has(id)) this.locked.delete(id); else this.locked.add(id); this.persist(); this.apply(); this.dispatchEvent(new Event('change')); }

  /** Move elementos para outra camada (só entre camadas que posso editar). */
  moveTo(els, id) {
    if (!this.editable(id)) { toast('Você não pode editar esta camada.', 'error'); return 0; }
    let n = 0;
    for (const el of els) if (this.canEdit(el)) { el.userData.bim.camadaId = id; el.userData.bim.props = { ...(el.userData.bim.props || {}), Camada: this.label(id) }; this.applyTo(el); n++; }
    this.viewer.changed();
    this.dispatchEvent(new Event('change'));
    return n;
  }

  /** Grava os ambientes (só o administrador do projeto). */
  save(list) {
    if (!this.isAdmin) { toast('Só o administrador do projeto (dono) define ambientes e camadas.', 'error'); return; }
    this.list = list;
    this.app.project?.send({ t: 'projeto', dados: { ambientes: list } });
    this.load({});
  }

  // ------------------------------------------------------------ painel (navegador de projeto)

  panel() {
    const rows = [];
    for (const a of this.list) {
      const cams = (a.camadas || []).map(c => {
        const allowed = this.allowed(c.id);
        return h('div', { class: `node env-layer${c.id === this.activeId ? ' active' : ''}${allowed ? '' : ' denied'}`, title: allowed ? 'Clique: camada ativa (onde entram os elementos novos)' : 'Camada não liberada para você',
          onclick: () => this.setActive(c.id) },
        h('span', { class: 'env-dot', style: `background:${c.cor || a.cor || '#888'}` }),
        c.nome,
        h('span', { class: 'elev' }, String(this.count(c.id))),
        h('span', { class: 'act', title: this.hidden.has(c.id) ? 'Mostrar' : 'Ocultar', onclick: e => { e.stopPropagation(); this.toggleHidden(c.id); } }, this.hidden.has(c.id) ? '◌' : '👁'),
        allowed ? h('span', { class: 'act', title: this.locked.has(c.id) ? 'Destravar' : 'Travar (só na sua tela)', onclick: e => { e.stopPropagation(); this.toggleLocked(c.id); } }, this.locked.has(c.id) ? '🔒' : '🔓')
          : h('span', { class: 'act', title: 'Não liberada para você' }, '⛔'));
      });
      rows.push(h('details', { open: true, class: 'env' }, h('summary', {}, h('span', { class: 'env-dot', style: `background:${a.cor || '#888'}` }), a.nome), cams));
    }
    const semCamada = this.count(null);
    if (this.list.length && semCamada) rows.push(h('div', { class: 'node muted', title: 'Elementos criados antes dos ambientes: o administrador pode movê-los (Propriedades › Camada)' }, `Sem camada`, h('span', { class: 'elev' }, String(semCamada))));
    if (!this.list.length) rows.push(h('div', { class: 'node muted' }, this.isAdmin ? 'Nenhum ambiente: crie em ⚙ Ambientes.' : 'O projeto não tem ambientes.'));
    if (this.mine && this.papel !== 'leitor') rows.unshift(h('div', { class: 'small muted', style: 'padding:2px 8px' }, `Liberadas para você: ${this.mine.map(id => this.label(id)).join(', ') || 'nenhuma'}`));
    return rows;
  }

  // ------------------------------------------------------------ administrador: ambientes e camadas

  openManager() {
    if (!this.isAdmin) { toast('Só o administrador do projeto (dono) define ambientes e camadas.', 'error'); return; }
    let list = structuredClone(this.list);
    const box = h('div', { class: 'env-manager' });
    const render = () => {
      box.replaceChildren();
      if (!list.length) box.append(h('div', { class: 'small muted' }, 'Nenhum ambiente. Comece pelo modelo (Arquitetura, Estrutura, Instalações) ou crie o seu.'));
      list.forEach((a, ai) => {
        const cams = (a.camadas ||= []).map((c, ci) => {
          const tipos = h('div', { class: 'env-types' }, Object.entries(DRAWING_TYPES).map(([k, label]) =>
            h('label', { class: `chip${c.tipos?.includes(k) ? ' on' : ''}` }, h('input', { type: 'checkbox', checked: !!c.tipos?.includes(k), onchange: e => {
              c.tipos = e.target.checked ? [...new Set([...(c.tipos || []), k])] : (c.tipos || []).filter(x => x !== k);
              e.target.parentElement.classList.toggle('on', e.target.checked);
            } }), label)));
          return h('div', { class: 'env-cam' },
            h('div', { class: 'row-buttons' },
              h('input', { type: 'color', value: c.cor || a.cor || '#888888', onchange: e => { c.cor = e.target.value; } }),
              h('input', { value: c.nome, placeholder: 'Nome da camada', oninput: e => { c.nome = e.target.value; } }),
              h('button', { class: 'mini danger', title: 'Apagar a camada (os elementos dela ficam "sem camada")', onclick: () => { a.camadas.splice(ci, 1); render(); } }, '✕')),
            h('div', { class: 'small muted' }, 'Desenhos desta camada (os elementos novos desses tipos caem nela):'), tipos);
        });
        box.append(h('div', { class: 'env-amb' },
          h('div', { class: 'row-buttons' },
            h('input', { type: 'color', value: a.cor || '#888888', onchange: e => { a.cor = e.target.value; } }),
            h('input', { class: 'env-name', value: a.nome, placeholder: 'Nome do ambiente', oninput: e => { a.nome = e.target.value; } }),
            h('button', { class: 'mini', onclick: () => { a.camadas.push({ id: uid(), nome: 'Nova camada', cor: a.cor, tipos: [] }); render(); } }, '+ Camada'),
            h('button', { class: 'mini danger', title: 'Apagar o ambiente e as camadas dele', onclick: () => { list.splice(ai, 1); render(); } }, '✕')),
          cams));
      });
    };
    render();
    modal({
      title: 'Ambientes e camadas do projeto',
      body: h('div', {},
        h('p', { class: 'small muted' }, 'Ambiente = disciplina/conjunto de desenhos (ex.: Arquitetura). Cada ambiente tem camadas (ex.: Paredes) com os tipos de desenho feitos nelas. Libere camadas para cada pessoa em Compartilhar › Camadas.'),
        h('div', { class: 'row-buttons' },
          h('button', { onclick: () => { list.push({ id: uid(), nome: 'Novo ambiente', cor: '#2fd18a', camadas: [{ id: uid(), nome: 'Geral', tipos: [] }] }); render(); } }, '+ Ambiente'),
          h('button', { onclick: () => { list = [...list, ...structuredClone(TEMPLATE).map(a => ({ ...a, id: uid(), camadas: a.camadas.map(c => ({ ...c, id: uid(), cor: a.cor })) }))]; render(); } }, 'Usar o modelo (Arquitetura, Estrutura, Instalações)')),
        box),
      actions: [{ label: 'Cancelar' }, { label: 'Salvar', class: 'primary', action: () => {
        list = list.filter(a => a.nome.trim()).map(a => ({ ...a, nome: a.nome.trim(), camadas: a.camadas.filter(c => c.nome.trim()).map(c => ({ ...c, nome: c.nome.trim() })) }));
        this.save(list);
        // elementos sem camada: o administrador pode distribuir pelos tipos
        const sem = this.viewer.elements().filter(e => !e.userData.bim.camadaId && !e.userData.bim.host);
        if (sem.length && list.length) {
          let n = 0;
          for (const el of sem) { this.assign(el); if (el.userData.bim.camadaId) { this.applyTo(el); n++; } }
          if (n) { this.viewer.changed(); toast(`${n} elemento(s) existente(s) distribuído(s) nas camadas pelos tipos.`); }
        }
      } }],
    });
  }

  /** Camadas liberadas para um membro (Compartilhar). onSave(ids | null). */
  memberDialog(m, onSave) {
    const sel = new Set(m.camadas || []);
    const all = h('input', { type: 'checkbox', checked: !m.camadas });
    const body = h('div', { class: 'env-perms' },
      h('label', { class: 'inline' }, all, h('strong', {}, 'Todas as camadas'), h('span', { class: 'small muted' }, ' (inclusive as que forem criadas depois)')),
      ...this.list.map(a => h('div', { class: 'env-amb' }, h('div', {}, h('span', { class: 'env-dot', style: `background:${a.cor || '#888'}` }), h('strong', {}, a.nome)),
        (a.camadas || []).map(c => h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: sel.has(c.id), onchange: e => { if (e.target.checked) sel.add(c.id); else sel.delete(c.id); all.checked = false; } }), c.nome)))));
    if (!this.list.length) body.append(h('div', { class: 'small muted' }, 'O projeto ainda não tem ambientes: crie em ⚙ Ambientes.'));
    modal({
      title: `Camadas liberadas — ${m.nome}`,
      small: true, body,
      actions: [{ label: 'Cancelar' }, { label: 'Salvar', class: 'primary', action: () => onSave(all.checked ? null : [...sel]) }],
    });
  }
}
