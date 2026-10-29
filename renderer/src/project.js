// PROJETO aberto no navegador: carrega do servidor, grava e sincroniza em tempo real com quem está no projeto.
//   - cada elemento (userData.bim) é um registro no banco: { id: guid, tipo, dados };
//   - paredes, lajes, pilares, vigas e caixas viajam pelos dados de modelagem (eixo, contorno, tipo, vãos) e são
//     refeitos no outro lado; instâncias de Objetos pelo objeto + parâmetros; geometria importada (IFC, FBX…)
//     como malha (uma vez) + posição;
//   - mudanças locais são detectadas por diferença (a cada alteração do modelo, com atraso curto) e enviadas;
//     as de outros chegam pelo WebSocket e substituem o elemento (a última gravação vence);
//   - presença: quem está no projeto, com a cor de cada um destacando o que ele selecionou.
import { buildDimension } from './dims.js';
import * as THREE from 'three';
import { rest, projectId } from './web/api.js';
import { rebuildElement, systemKindOf } from './elements.js';
import { buildSketch } from './sketch/sketch.js';
import { buildForm } from './sketch/forms.js';
import { buildWorkPlane } from './workplanes.js';
import { setUnit } from './units.js';
import { h, toast } from './ui.js';

const SYNC_DELAY = 250;

const round = v => Math.round(v * 1e6) / 1e6;
const clone = v => JSON.parse(JSON.stringify(v ?? null));

export class ProjectSession extends EventTarget {
  constructor(app) {
    super();
    this.app = app;
    this.id = projectId;
    this.sent = new Map();      // guid → JSON enviado/recebido por último (para achar o que mudou)
    // DESFAZER / REFAZER: cada lote de mudanças locais gravado é um passo [{ id, before, after }] (JSON ou null)
    this.undoStack = [];
    this.redoStack = [];
    this.applying = false;      // aplicando mudança remota: não reenvia
    this.online = [];
    this.remoteSel = new Map(); // usuário → { cor, ids }
    this.readonly = false;
  }

  get viewer() { return this.app.viewer; }

  // ------------------------------------------------------------ abrir

  async open() {
    const r = await rest('GET', `/api/projetos/${this.id}`);
    this.info = r.projeto;
    this.papel = r.projeto.papel;
    this.readonly = this.papel === 'leitor';
    this.membros = r.membros;
    document.title = `${r.projeto.nome} — BoxBim`;
    this.applying = true;
    try {
      this.loadLevels(r.projeto.dados?.niveis);
      this.loadOptions(r.projeto.dados);
      this.app.envs?.load({ ambientes: r.projeto.dados?.ambientes || [], mine: r.projeto.minhasCamadas ?? null, papel: this.papel });
      // paredes primeiro (portas e janelas se hospedam nelas)
      const order = e => (e.dados?.bim?.wall ? 0 : e.dados?.bim?.host ? 2 : 1);
      for (const e of [...r.elementos].sort((a, b) => order(a) - order(b))) {
        try { await this.createFrom(e); } catch (err) { console.warn('elemento não carregado', e.id, err); }
      }
    } finally { this.applying = false; }
    // portas/janelas gravadas com o uuid antigo da parede: religa pelo GUID
    const relinked = this.app.hosting?.repair() || 0;
    if (relinked) console.info(`hospedagem: ${relinked} vínculo(s) parede ↔ porta/janela refeito(s)`);
    this.viewer.fit();
    this.connect();
    this.viewer.addEventListener('change', () => this.schedule());
    if (relinked) { this._skipUndo = true; this.schedule(); } // grava os vínculos refeitos (sem virar passo do desfazer)
    this.viewer.addEventListener('select', () => this.sendPresence());
    this.app.levels.addEventListener('change', () => { if (!this.applying) this.sendLevels(); });
    addEventListener('beforeunload', () => this.flush());
    setInterval(() => this.saveThumbnail(), 60000);
    this.dispatchEvent(new Event('open'));
    return this;
  }

  /** Grade e cores do estilo Colorido do projeto. */
  loadOptions(dados = {}) {
    if (dados.grade) this.app.guides?.setOptions(dados.grade);
    if (dados.cores) this.app.viewStyles?.setColors(dados.cores);
    if (dados.unidade) setUnit(dados.unidade);
    if (dados.elevacoes) this.app.views?.setElevations(dados.elevacoes);
    if (dados.escalas || dados.pesos) this.app.drawing?.load(dados);
    if (dados.vistas) this.app.views?.loadViews(dados.vistas);
    if (dados.estilosCota) this.app.dims?.load(dados.estilosCota);
    if ('geo' in dados || 'norte' in dados || dados.orientacoes || dados.orientacaoVistas) this.app.orientations?.load(dados);
  }

  loadLevels(niveis) {
    if (!niveis?.length) return;
    this.app.levels.load(niveis.map(n => ({ id: n.id, name: n.nome, elevation: Number(n.cota) || 0, fixo: !!n.fixo, corte: n.corte || null })));
  }

  // ------------------------------------------------------------ serialização

  /** Matriz do elemento relativa ao modelo (elementos dentro de grupos importados também). */
  matrixOf(el) {
    this.viewer.model.updateMatrixWorld(true);
    const inv = this.viewer.model.matrixWorld.clone().invert();
    return inv.multiply(el.matrixWorld).toArray().map(round);
  }

  serialize(el) {
    const b = el.userData.bim;
    const bim = clone(b);
    const dados = { bim, matriz: this.matrixOf(el) };
    if (!systemKindOf(b) && !b.objectId && !b.linha && !b.forma && !b.eixo && !b.cota) {
      // geometria importada: a malha vai uma vez (com os materiais originais, sem o destaque de seleção)
      if (!el.userData._malha) el.userData._malha = meshJSON(el);
      dados.malha = el.userData._malha;
    }
    return { id: b.guid, tipo: b.type, dados };
  }

  /** Cria um elemento a partir do registro do banco. */
  async createFrom(rec) {
    const el = await this.build(rec.dados);
    if (!el) return null;
    this.place(el, rec.dados.matriz);
    this.sent.set(rec.id, JSON.stringify(rec.dados));
    this.viewer.add(el);
    return el;
  }

  async build(dados) {
    const bim = clone(dados.bim);
    if (!bim?.guid) return null;
    // desenho 2D e sólidos (extrusão, varredura, vazio): refeitos pelos dados
    if (bim.linha) return buildSketch(bim);
    if (bim.forma) return buildForm(bim);
    if (bim.eixo) return buildWorkPlane(bim);
    if (bim.cota) return buildDimension(bim); // cota (desenho em overlay; dims.js)
    if (systemKindOf(bim)) {
      // parede, laje, pilar, viga, caixa: refeitos pelos dados (o script do objeto de sistema desenha)
      const g = new THREE.Group();
      g.name = bim.name;
      g.userData.bim = bim;
      rebuildElement(g);
      return g;
    }
    if (bim.objectId) {
      const def = this.app.objects.get(bim.objectId) || this.app.objects.get(bim.objectName);
      if (def) {
        const g = await this.app.objects.createInstance(def, { values: bim.params || {} });
        Object.assign(g.userData.bim, bim);
        return g;
      }
      // objeto ausente da biblioteca: guarda os dados (não se perdem) e mostra um marcador
      const g = new THREE.Group();
      g.name = bim.name;
      g.userData.bim = bim;
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshStandardMaterial({ color: 0xff00ff, wireframe: true })));
      return g;
    }
    if (dados.malha) {
      const obj = await new THREE.ObjectLoader().parseAsync(dados.malha);
      obj.userData.bim = bim;
      obj.userData._malha = dados.malha;
      return obj;
    }
    return null;
  }

  place(el, matriz) {
    if (!matriz) return;
    new THREE.Matrix4().fromArray(matriz).decompose(el.position, el.quaternion, el.scale);
  }

  // ------------------------------------------------------------ envio (mudanças locais)

  schedule() {
    if (this.applying) return;
    clearTimeout(this._t);
    this._t = setTimeout(() => this.flush(), SYNC_DELAY);
  }

  flush() {
    clearTimeout(this._t);
    if (this.applying || this.readonly || !this.ws || this.ws.readyState !== 1) return;
    const up = [];
    const seen = new Set();
    const step = [];
    for (const el of this.viewer.elements()) {
      if (this.app.floorSketch?.isTemp(el)) continue; // linhas do esboço do contorno do piso: só nesta tela
      const b = el.userData.bim;
      if (!b.guid) b.guid = crypto.randomUUID();
      if (seen.has(b.guid)) b.guid = crypto.randomUUID(); // cópia com o mesmo GUID: vira outro elemento
      seen.add(b.guid);
      const rec = this.serialize(el);
      const s = JSON.stringify(rec.dados);
      if (this.sent.get(rec.id) !== s) { step.push({ id: rec.id, before: this.sent.get(rec.id) ?? null, after: s }); up.push(rec); this.sent.set(rec.id, s); }
    }
    const gone = [...this.sent.keys()].filter(id => !seen.has(id));
    gone.forEach(id => { step.push({ id, before: this.sent.get(id), after: null }); this.sent.delete(id); });
    if (step.length && !this._replaying && !this._skipUndo) {
      this.undoStack.push(step);
      if (this.undoStack.length > 100) this.undoStack.shift();
      this.redoStack.length = 0;
      this.dispatchEvent(new Event('history'));
    }
    this._skipUndo = false;
    if (up.length) this.send({ t: 'upsert', elementos: up });
    if (gone.length) this.send({ t: 'remove', ids: gone });
    if (up.length || gone.length) { this.dirtyThumb = true; this.setSaved(true); }
  }

  /** Tira um elemento que vai ser trocado pela versão nova (parede trocada não apaga as portas que hospeda). */
  replaceRemove(old) {
    this.viewer._replacing = true;
    try { this.viewer.remove(old); } finally { this.viewer._replacing = false; }
  }

  // ------------------------------------------------------------ desfazer / refazer

  get canUndo() { return !this.readonly && this.undoStack.length > 0; }
  get canRedo() { return !this.readonly && this.redoStack.length > 0; }

  /** Descrição curta de um passo ("Parede", "3 elementos"…), para o título dos botões. */
  describe(step) {
    if (!step) return '';
    const names = step.map(e => { try { return JSON.parse(e.after || e.before)?.bim?.name; } catch { return null; } }).filter(Boolean);
    const verb = step.every(e => !e.before) ? 'criar' : step.every(e => !e.after) ? 'apagar' : 'alterar';
    return `${verb} ${names.length === 1 ? `"${names[0]}"` : `${step.length} elemento(s)`}`;
  }

  async undo() { return this._travel(this.undoStack, this.redoStack, 'before', 'Desfeito'); }
  async redo() { return this._travel(this.redoStack, this.undoStack, 'after', 'Refeito'); }

  async _travel(from, to, key, label) {
    if (this.readonly || this._busyUndo) return;
    if (!this.ws || this.ws.readyState !== 1) { this.app.status('Sem conexão com o servidor: desfazer/refazer espera a conexão voltar.'); return; }
    this.flush(); // o que acabou de mudar vira passo antes de voltar
    const step = from.pop();
    if (!step) return;
    this._busyUndo = true;
    this._replaying = true;
    try {
      this.viewer.select([]);
      this.app.transformTool?.stop?.();
      // paredes primeiro (portas e janelas se hospedam nelas)
      const order = e => { const d = e[key] && JSON.parse(e[key]); return d?.bim?.wall ? 0 : d?.bim?.host ? 2 : 1; };
      for (const e of [...step].sort((a, b) => order(a) - order(b))) {
        const old = this.viewer.findById(e.id);
        if (e[key] === null) { if (old) this.viewer.remove(old); continue; }
        const dados = JSON.parse(e[key]);
        const el = await this.build(dados);
        if (!el) continue;
        this.place(el, dados.matriz);
        if (old) this.replaceRemove(old);
        this.viewer.add(el);
      }
      this.flush(); // grava (sem virar outro passo)
      // reajustes automáticos que vêm depois (eixos de trabalho, portas acompanhando a parede…) também não viram passo
      await new Promise(r => setTimeout(r, SYNC_DELAY + 80));
      this.flush();
    } finally { this._replaying = false; this._busyUndo = false; }
    to.push(step);
    this.app.refreshTree?.();
    this.app.renderProps?.();
    this.app.status(`${label}: ${this.describe(step)}.`);
    this.dispatchEvent(new Event('history'));
  }

  sendLevels() {
    const niveis = this.app.levels.list.map(l => ({ id: l.id, nome: l.name, cota: l.elevation, fixo: !!l.fixo, ...(l.corte ? { corte: l.corte } : {}) }));
    this.send({ t: 'projeto', dados: { niveis } });
  }

  sendPresence() {
    this.send({ t: 'presenca', selecao: [...this.viewer.selected].map(o => o.userData.bim?.guid).filter(Boolean), vista: this.app.views?.activeId });
  }

  send(msg) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(msg));
    else (this.queue ||= []).push(msg);
  }

  // ------------------------------------------------------------ recebimento (mudanças de outros)

  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws?projeto=${encodeURIComponent(this.id)}`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      for (const m of this.queue || []) ws.send(JSON.stringify(m));
      this.queue = [];
      this.flush();
      this.sendPresence();
      this.setConnected(true);
    };
    ws.onmessage = e => this.onMessage(JSON.parse(e.data)).catch(err => console.error(err));
    ws.onclose = () => {
      this.setConnected(false);
      if (this.closed) return;
      // reconecta e, ao voltar, recarrega o projeto (pode ter perdido mudanças de outros)
      this.retry = Math.min((this.retry || 0) + 1, 6);
      setTimeout(() => this.reconnect(), 500 * 2 ** this.retry);
    };
  }

  async reconnect() {
    try {
      const r = await rest('GET', `/api/projetos/${this.id}`);
      await this.applyUpsert(r.elementos, { replaceAll: true });
      this.loadLevels(r.projeto.dados?.niveis);
    } catch { /* sem servidor: tenta de novo */ }
    this.connect();
  }

  async onMessage(m) {
    if (m.t === 'ola') { this.eu = m.eu; return; }
    if (m.t === 'online') { this.online = m.usuarios; this.renderPresence(); return; }
    if (m.t === 'presenca') { this.remoteSel.set(m.usuario, { cor: m.cor, nome: m.nome, ids: m.selecao }); this.drawRemoteSelection(); return; }
    if (m.t === 'erro') { toast(m.msg, 'error'); return; }
    if (m.t === 'fechado') { this.closed = true; toast(m.msg, 'error'); setTimeout(() => { location.href = '/projetos.html'; }, 2500); return; }
    if (m.t === 'upsert') { await this.applyUpsert(m.elementos); this.app.status(`${this.nameOf(m.autor)} alterou ${m.elementos.length} elemento(s).`); return; }
    if (m.t === 'remove') {
      this.applying = true;
      try {
        for (const id of m.ids) { this.sent.delete(id); const el = this.viewer.findById(id); if (el) this.viewer.remove(el); }
      } finally { this.applying = false; }
      this.drawRemoteSelection();
      return;
    }
    if (m.t === 'projeto') {
      this.applying = true;
      try { this.loadLevels(m.dados?.niveis); this.loadOptions(m.dados); if (m.dados?.ambientes) this.app.envs?.load({ ambientes: m.dados.ambientes }); } finally { this.applying = false; }
      return;
    }
    if (m.t === 'permissoes') {
      this.papel = m.papel; this.readonly = m.papel === 'leitor';
      this.app.envs?.load({ mine: m.camadas, papel: m.papel });
      toast(m.camadas ? `Suas camadas mudaram: ${m.camadas.map(id => this.app.envs.label(id)).join(', ') || 'nenhuma'}.` : 'Agora você pode editar todas as camadas.');
      return;
    }
    if (m.t === 'recusado') { toast(m.msg, 'error'); return; }
    if (m.t === 'objeto') { await this.app.objects.load(); await this.app.refreshObjectInstances(m.id); return; }
    if (m.t === 'tipos') { await this.app.types.load(); return; }
  }

  async applyUpsert(recs, { replaceAll = false } = {}) {
    this.applying = true;
    try {
      const ids = new Set(recs.map(r => r.id));
      if (replaceAll) for (const el of this.viewer.elements()) if (!ids.has(el.userData.bim.guid)) { this.sent.delete(el.userData.bim.guid); this.viewer.remove(el); }
      const order = e => (e.dados?.bim?.wall ? 0 : e.dados?.bim?.host ? 2 : 1);
      for (const rec of [...recs].sort((a, b) => order(a) - order(b))) {
        const s = JSON.stringify(rec.dados);
        if (this.sent.get(rec.id) === s && this.viewer.findById(rec.id)) continue;
        const old = this.viewer.findById(rec.id);
        const wasSelected = old && this.viewer.selected.has(old);
        const el = await this.build(rec.dados);
        if (!el) continue;
        this.place(el, rec.dados.matriz);
        if (old) this.replaceRemove(old);
        this.viewer.add(el);
        this.sent.set(rec.id, s);
        if (wasSelected) this.viewer.select([el], true);
      }
    } finally { this.applying = false; }
    this.app.refreshTree?.();
    this.drawRemoteSelection();
  }

  nameOf(uid) { return this.online.find(u => u.id === uid)?.nome || 'Alguém'; }

  // ------------------------------------------------------------ presença

  renderPresence() {
    const root = document.querySelector('#presence');
    if (!root) return;
    root.innerHTML = '';
    for (const u of this.online) {
      root.append(h('span', { class: `avatar${u.id === this.eu?.id ? ' me' : ''}`, style: `background:${u.cor}`, title: `${u.nome} (${u.papel})${u.id === this.eu?.id ? ' — você' : ''}` },
        u.nome.split(/\s+/).map(s => s[0]).join('').slice(0, 2).toUpperCase()));
    }
    // quem saiu deixa de destacar a seleção
    for (const uid of [...this.remoteSel.keys()]) if (!this.online.some(u => u.id === uid)) this.remoteSel.delete(uid);
    this.drawRemoteSelection();
  }

  /** Caixa na cor de cada colaborador em volta do que ele selecionou. */
  drawRemoteSelection() {
    const v = this.viewer;
    if (!this.selGroup) { this.selGroup = new THREE.Group(); this.selGroup.name = 'Seleção dos colaboradores'; v.overlay.add(this.selGroup); }
    for (const c of [...this.selGroup.children]) { this.selGroup.remove(c); c.geometry?.dispose(); }
    for (const [uid, s] of this.remoteSel) {
      if (uid === this.eu?.id) continue;
      for (const id of s.ids || []) {
        const el = v.findById(id);
        if (!el) continue;
        const box = new THREE.Box3().setFromObject(el);
        if (box.isEmpty()) continue;
        const helper = new THREE.Box3Helper(box.expandByScalar(0.03), new THREE.Color(s.cor));
        helper.material.depthTest = false;
        this.selGroup.add(helper);
      }
    }
  }

  // ------------------------------------------------------------ estado e miniatura

  setConnected(on) {
    const el = document.querySelector('#sync-state');
    if (el) { el.textContent = on ? (this.readonly ? 'Somente leitura' : 'Sincronizado') : 'Reconectando…'; el.className = `sync-state ${on ? 'ok' : 'off'}`; }
  }

  setSaved() {
    const el = document.querySelector('#sync-state');
    if (el && this.ws?.readyState === 1) { el.textContent = 'Salvo'; el.className = 'sync-state ok'; clearTimeout(this._st); this._st = setTimeout(() => { el.textContent = 'Sincronizado'; }, 1500); }
  }

  /** Miniatura do projeto para a lista de projetos (a vista atual, reduzida). */
  async saveThumbnail(force = false) {
    if ((!this.dirtyThumb && !force) || this.readonly) return;
    this.dirtyThumb = false;
    try {
      const src = this.viewer.renderer.domElement;
      const c = document.createElement('canvas');
      c.width = 320; c.height = Math.round(320 * src.height / src.width) || 200;
      c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
      await rest('PATCH', `/api/projetos/${this.id}`, { miniatura: c.toDataURL('image/jpeg', 0.8) });
    } catch { /* tenta de novo depois */ }
  }
}

/** JSON (ObjectLoader) de um elemento importado, sem transformação própria e com os materiais originais. */
function meshJSON(el) {
  const c = el.clone(true);
  c.position.set(0, 0, 0); c.quaternion.identity(); c.scale.set(1, 1, 1);
  const drop = [];
  c.traverse(o => {
    if (o.userData?._origMat) o.material = o.userData._origMat;
    if (o.userData?._flatMat) o.material = o.userData._flatMat;
    // linhas de contorno são refeitas pelo viewer; elementos BIM aninhados são sincronizados à parte
    if (o !== c && (o.userData?.isEdge || o.userData?.bim)) drop.push(o);
    o.userData = {};
  });
  drop.forEach(o => o.removeFromParent());
  return c.toJSON();
}
