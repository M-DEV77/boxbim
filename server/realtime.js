// Colaboração em tempo real: uma "sala" por projeto (WebSocket em /ws?projeto=<id>).
// Mensagens do cliente:
//   { t: 'upsert', elementos: [{ id, tipo, dados }] }   cria/atualiza elementos (grava e repassa aos outros)
//   { t: 'remove', ids: [...] }                         apaga elementos
//   { t: 'projeto', dados: {...} }                      níveis, tipos e configurações do projeto (mescla)
//   { t: 'presenca', selecao: [ids], vista }            o que cada um está selecionando/vendo
// Camadas: um editor pode ter só algumas camadas liberadas (Membro.camadas); elementos de outras camadas ele não
// grava nem apaga (o servidor confere aqui) — ambientes e camadas só o dono define.
// O servidor repassa às outras conexões do mesmo projeto e avisa quem entrou/saiu ({ t: 'online', usuarios }).
// Última gravação vence, por elemento. Leitores não gravam.
'use strict';
const { WebSocketServer } = require('ws');
const db = require('./db');
const { userFromRequest, publicUser } = require('./auth');
const { access } = require('./projects');

const MAX_MSG = 32 * 1024 * 1024;

/** O usuário da conexão pode gravar um elemento desta camada? (dono e editor sem restrição: sim; leitor: não) */
function canEdit(ws, camadaId, existing) {
  if (ws.papel === 'leitor') return false;
  if (!Array.isArray(ws.camadas)) return true;
  if (existing === null) return true; // elemento novo: a camada é conferida pelo dado novo
  return !!camadaId && ws.camadas.includes(camadaId);
}

function create(server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MSG });
  const rooms = new Map(); // projetoId → Set<ws>
  const projectLocks = new Map(); // projetoId → Promise da última gravação de dados do projeto

  const send = (ws, msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };
  const broadcast = (pid, msg, except) => { for (const ws of rooms.get(pid) || []) if (ws !== except) send(ws, msg); };
  const online = pid => [...new Map([...(rooms.get(pid) || [])].map(ws => [ws.user.id, { ...publicUser(ws.user), cor: ws.cor, papel: ws.papel, selecao: ws.selecao || [], vista: ws.vista || null }])).values()];
  const announce = pid => broadcast(pid, { t: 'online', usuarios: online(pid) });

  const COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#e84393'];

  server.on('upgrade', async (req, socket, head) => {
    try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname !== '/ws') return socket.destroy();
      // mesma origem (evita que outro site use o cookie de quem está logado)
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) return socket.destroy();
      const user = await userFromRequest(req);
      if (!user) return socket.destroy();
      const { projeto, papel, camadas } = await access(url.searchParams.get('projeto'), user);
      wss.handleUpgrade(req, socket, head, ws => {
        ws.user = user;
        ws.papel = papel;
        ws.camadas = camadas;
        ws.pid = projeto.id;
        ws.cor = COLORS[[...user.id].reduce((s, c) => s + c.charCodeAt(0), 0) % COLORS.length];
        if (!rooms.has(ws.pid)) rooms.set(ws.pid, new Set());
        rooms.get(ws.pid).add(ws);
        send(ws, { t: 'ola', eu: { ...publicUser(user), cor: ws.cor, papel } });
        announce(ws.pid);
        ws.on('message', data => handle(ws, data).catch(e => send(ws, { t: 'erro', msg: e.message })));
        ws.on('close', () => { rooms.get(ws.pid)?.delete(ws); announce(ws.pid); });
      });
    } catch {
      socket.destroy();
    }
  });

  async function handle(ws, data) {
    const msg = JSON.parse(String(data));
    const pid = ws.pid;
    if (msg.t === 'presenca') {
      ws.selecao = Array.isArray(msg.selecao) ? msg.selecao.slice(0, 500) : [];
      ws.vista = msg.vista || null;
      broadcast(pid, { t: 'presenca', usuario: ws.user.id, cor: ws.cor, nome: ws.user.nome, selecao: ws.selecao, vista: ws.vista }, ws);
      return;
    }
    if (ws.papel === 'leitor') throw new Error('Você só tem acesso de leitura a este projeto.');
    if (msg.t === 'upsert') {
      let els = (msg.elementos || []).filter(e => e && typeof e.id === 'string' && e.id.length <= 64);
      const recusados = [];
      await db.sequelize.transaction(async transaction => {
        const ok = [];
        for (const e of els) {
          const cur = await db.Elemento.findByPk(e.id, { transaction });
          if (cur && cur.ProjetoId !== pid) continue; // GUID de outro projeto: ignora
          // camadas liberadas: o elemento (como estava e como fica) precisa estar numa delas
          if (!canEdit(ws, cur?.dados?.bim?.camadaId, cur) || !canEdit(ws, e.dados?.bim?.camadaId)) { recusados.push(e.id); continue; }
          ok.push(e);
          if (cur) { cur.tipo = e.tipo; cur.dados = e.dados; cur.versao = cur.versao + 1; cur.autorId = ws.user.id; await cur.save({ transaction }); }
          else await db.Elemento.create({ id: e.id, ProjetoId: pid, tipo: e.tipo, dados: e.dados, autorId: ws.user.id }, { transaction });
          // objeto usado pela primeira vez no projeto: guarda uma cópia da biblioteca geral
          const oid = e.dados?.bim?.objectId;
          if (oid && !(await db.ObjetoProjeto.findOne({ where: { ProjetoId: pid, objetoId: oid }, transaction }))) {
            const g = await db.Objeto.findByPk(oid, { transaction });
            if (g) await db.ObjetoProjeto.create({ ProjetoId: pid, objetoId: oid, definicao: g.definicao, preco: g.preco, unidade: g.unidade, moeda: g.moeda, icone: g.icone, miniatura: g.miniatura }, { transaction });
          }
        }
        els = ok;
      });
      if (recusados.length) send(ws, { t: 'recusado', ids: recusados, msg: `${recusados.length} elemento(s) não gravado(s): fora das camadas liberadas para você.` });
      if (!els.length) return;
      broadcast(pid, { t: 'upsert', elementos: els, autor: ws.user.id }, ws);
      await db.Projeto.update({ updatedAt: new Date() }, { where: { id: pid } });
    } else if (msg.t === 'remove') {
      let ids = (msg.ids || []).filter(x => typeof x === 'string');
      if (Array.isArray(ws.camadas)) {
        const rows = await db.Elemento.findAll({ where: { id: ids, ProjetoId: pid } });
        const ok = new Set(rows.filter(r => canEdit(ws, r.dados?.bim?.camadaId, r)).map(r => r.id));
        const recusados = ids.filter(x => !ok.has(x) && rows.some(r => r.id === x));
        if (recusados.length) send(ws, { t: 'recusado', ids: recusados, msg: `${recusados.length} elemento(s) não apagado(s): fora das camadas liberadas para você.` });
        ids = ids.filter(x => ok.has(x) || !rows.some(r => r.id === x));
      }
      await db.Elemento.destroy({ where: { id: ids, ProjetoId: pid } });
      broadcast(pid, { t: 'remove', ids, autor: ws.user.id }, ws);
    } else if (msg.t === 'projeto') {
      // ambientes e camadas: só o dono (administrador do projeto) define
      if (msg.dados?.ambientes !== undefined && ws.papel !== 'dono') delete msg.dados.ambientes;
      // uma gravação por vez por projeto: duas mensagens seguidas liam o mesmo estado e a última apagava a outra
      const prev = projectLocks.get(pid) || Promise.resolve();
      const run = prev.then(async () => {
        const p = await db.Projeto.findByPk(pid);
        p.dados = { ...p.dados, ...(msg.dados || {}) };
        await p.save();
      });
      projectLocks.set(pid, run.catch(() => {}));
      await run;
      broadcast(pid, { t: 'projeto', dados: msg.dados, autor: ws.user.id }, ws);
    } else if (msg.t === 'objeto') {
      // um objeto do projeto foi editado (cópia do projeto): os outros recarregam a biblioteca
      broadcast(pid, { t: 'objeto', id: msg.id, autor: ws.user.id }, ws);
    }
  }

  return {
    online,
    /** Permissões novas de um membro: vale na hora para as conexões abertas dele. */
    setPermissions(pid, uid, papel, camadas) {
      for (const ws of rooms.get(pid) || []) if (ws.user.id === uid) { ws.papel = papel; ws.camadas = camadas; send(ws, { t: 'permissoes', papel, camadas }); }
    },
    closeProject(pid, motivo) { for (const ws of rooms.get(pid) || []) { send(ws, { t: 'fechado', msg: motivo }); ws.close(); } rooms.delete(pid); },
    kick(pid, uid, motivo) { for (const ws of rooms.get(pid) || []) if (ws.user.id === uid) { send(ws, { t: 'fechado', msg: motivo }); ws.close(); } },
    notify(pid, msg) { broadcast(pid, msg); },
  };
}

module.exports = { create };
