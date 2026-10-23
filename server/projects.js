// Projetos: cada um tem um DONO; outros usuários entram como EDITOR (modelam junto) ou LEITOR (só veem).
'use strict';
const crypto = require('crypto');
const { Op } = require('sequelize');
const db = require('./db');
const { publicUser } = require('./auth');

const err = (status, msg) => Object.assign(new Error(msg), { status });

/** Projeto + papel do usuário nele ('dono' | 'editor' | 'leitor'); lança 404/403. */
async function access(projectId, user, need = 'leitor') {
  const p = await db.Projeto.findByPk(projectId);
  if (!p) throw err(404, 'Projeto não encontrado.');
  let papel = p.donoId === user.id ? 'dono' : null;
  if (!papel) {
    const m = await db.Membro.findOne({ where: { ProjetoId: p.id, UsuarioId: user.id } });
    papel = m?.papel || null;
  }
  if (!papel) throw err(403, 'Você não participa deste projeto.');
  const rank = { leitor: 0, editor: 1, dono: 2 };
  if (rank[papel] < rank[need]) throw err(403, need === 'dono' ? 'Só o dono pode fazer isso.' : 'Você só tem acesso de leitura a este projeto.');
  return { projeto: p, papel };
}

/** Novo projeto: só o Nível 0 (os outros níveis o usuário cria depois). */
function dadosIniciais() {
  return {
    niveis: [{ id: crypto.randomUUID(), nome: 'Nível 0', cota: 0 }],
    grade: { espacamento: 1, visivel: true },
  };
}

const resumo = (p, papel, extra = {}) => ({
  id: p.id, nome: p.nome, descricao: p.descricao, papel, atualizadoEm: p.updatedAt, criadoEm: p.createdAt,
  miniatura: p.miniatura || null, dono: p.dono ? publicUser(p.dono) : undefined, ...extra,
});

function routes(app, { requireUser, realtime }) {
  const wrap = fn => (req, res, next) => fn(req, res).catch(next);

  app.get('/api/projetos', requireUser(), wrap(async (req, res) => {
    const meus = await db.Projeto.findAll({ where: { donoId: req.user.id }, include: [{ model: db.Usuario, as: 'dono' }], order: [['updatedAt', 'DESC']] });
    const membros = await db.Membro.findAll({ where: { UsuarioId: req.user.id }, include: [{ model: db.Projeto, include: [{ model: db.Usuario, as: 'dono' }] }] });
    const contagem = async id => db.Elemento.count({ where: { ProjetoId: id } });
    const list = [
      ...await Promise.all(meus.map(async p => resumo(p, 'dono', { elementos: await contagem(p.id) }))),
      ...await Promise.all(membros.filter(m => m.Projeto).map(async m => resumo(m.Projeto, m.papel, { elementos: await contagem(m.Projeto.id) }))),
    ];
    res.json({ projetos: list });
  }));

  app.post('/api/projetos', requireUser(), wrap(async (req, res) => {
    const nome = String(req.body?.nome || '').trim() || 'Novo projeto';
    const p = await db.Projeto.create({ nome, descricao: String(req.body?.descricao || ''), donoId: req.user.id, dados: dadosIniciais() });
    res.json({ projeto: resumo(p, 'dono') });
  }));

  app.get('/api/projetos/:id', requireUser(), wrap(async (req, res) => {
    const { projeto, papel } = await access(req.params.id, req.user);
    const dono = await db.Usuario.findByPk(projeto.donoId);
    const membros = await db.Membro.findAll({ where: { ProjetoId: projeto.id }, include: db.Usuario });
    const elementos = await db.Elemento.findAll({ where: { ProjetoId: projeto.id }, order: [['createdAt', 'ASC']] });
    res.json({
      projeto: { ...resumo(projeto, papel), dados: projeto.dados, dono: publicUser(dono) },
      membros: membros.map(m => ({ ...publicUser(m.Usuario), papel: m.papel })),
      elementos: elementos.map(e => ({ id: e.id, tipo: e.tipo, dados: e.dados, versao: e.versao })),
      online: realtime.online(projeto.id),
    });
  }));

  app.patch('/api/projetos/:id', requireUser(), wrap(async (req, res) => {
    const b = req.body || {};
    const { projeto } = await access(req.params.id, req.user, b.nome !== undefined || b.descricao !== undefined ? 'dono' : 'editor');
    if (b.nome !== undefined) projeto.nome = String(b.nome).trim() || projeto.nome;
    if (b.descricao !== undefined) projeto.descricao = String(b.descricao);
    if (b.miniatura !== undefined) projeto.miniatura = typeof b.miniatura === 'string' && b.miniatura.startsWith('data:image/') ? b.miniatura.slice(0, 600000) : null;
    if (b.dados !== undefined) projeto.dados = { ...projeto.dados, ...b.dados };
    await projeto.save();
    res.json({ ok: true });
  }));

  app.delete('/api/projetos/:id', requireUser(), wrap(async (req, res) => {
    const { projeto } = await access(req.params.id, req.user, 'dono');
    realtime.closeProject(projeto.id, 'O projeto foi excluído pelo dono.');
    await projeto.destroy();
    res.json({ ok: true });
  }));

  // compartilhar: o dono convida pelo e-mail de quem já tem conta
  app.post('/api/projetos/:id/membros', requireUser(), wrap(async (req, res) => {
    const { projeto } = await access(req.params.id, req.user, 'dono');
    const email = String(req.body?.email || '').trim().toLowerCase();
    const papel = req.body?.papel === 'leitor' ? 'leitor' : 'editor';
    const u = await db.Usuario.findOne({ where: { email } });
    if (!u) throw err(404, 'Nenhuma conta com este e-mail. Peça para a pessoa se cadastrar primeiro.');
    if (u.id === projeto.donoId) throw err(400, 'O dono já tem acesso total.');
    const [m] = await db.Membro.findOrCreate({ where: { ProjetoId: projeto.id, UsuarioId: u.id }, defaults: { papel } });
    if (m.papel !== papel) { m.papel = papel; await m.save(); }
    res.json({ membro: { ...publicUser(u), papel } });
  }));

  app.delete('/api/projetos/:id/membros/:uid', requireUser(), wrap(async (req, res) => {
    // o dono remove qualquer um; o próprio membro pode sair
    const self = req.params.uid === req.user.id;
    const { projeto } = await access(req.params.id, req.user, self ? 'leitor' : 'dono');
    await db.Membro.destroy({ where: { ProjetoId: projeto.id, UsuarioId: req.params.uid } });
    realtime.kick(projeto.id, req.params.uid, 'Seu acesso a este projeto foi removido.');
    res.json({ ok: true });
  }));

  // duplicar (o usuário vira dono da cópia)
  app.post('/api/projetos/:id/duplicar', requireUser(), wrap(async (req, res) => {
    const { projeto } = await access(req.params.id, req.user);
    const copia = await db.Projeto.create({ nome: `${projeto.nome} (cópia)`, descricao: projeto.descricao, donoId: req.user.id, dados: projeto.dados, miniatura: projeto.miniatura });
    const els = await db.Elemento.findAll({ where: { ProjetoId: projeto.id } });
    const map = new Map(els.map(e => [e.id, crypto.randomUUID()]));
    // GUIDs novos; referências de hospedagem (porta → parede) acompanham
    const remap = d => JSON.parse(JSON.stringify(d).replace(/"([0-9a-f-]{36})"/gi, (m, id) => (map.has(id) ? `"${map.get(id)}"` : m)));
    await db.Elemento.bulkCreate(els.map(e => ({ id: map.get(e.id), ProjetoId: copia.id, tipo: e.tipo, dados: remap(e.dados), autorId: req.user.id })));
    const objs = await db.ObjetoProjeto.findAll({ where: { ProjetoId: projeto.id } });
    await db.ObjetoProjeto.bulkCreate(objs.map(o => ({ ...o.get({ plain: true }), id: undefined, ProjetoId: copia.id })));
    res.json({ projeto: resumo(copia, 'dono') });
  }));

  // busca de usuários por e-mail (para o convite) — só devolve correspondência exata
  app.get('/api/usuarios', requireUser(), wrap(async (req, res) => {
    const email = String(req.query.email || '').trim().toLowerCase();
    const u = email && await db.Usuario.findOne({ where: { email: { [Op.eq]: email } } });
    res.json({ usuario: u ? publicUser(u) : null });
  }));
}

module.exports = { routes, access, dadosIniciais };
