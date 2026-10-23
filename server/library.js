// Biblioteca de Objetos fora do editor (página /biblioteca.html): lista com miniatura, ícone e preço.
'use strict';
const db = require('./db');

function routes(app, { requireUser }) {
  app.get('/api/biblioteca', requireUser(), async (req, res, next) => {
    try {
      const rows = await db.Objeto.findAll({ order: [['categoria', 'ASC'], ['nome', 'ASC']] });
      res.json({
        objetos: rows.map(o => ({
          id: o.id, nome: o.nome, categoria: o.categoria, sistema: o.sistema, descricao: o.definicao?.description || '',
          preco: o.preco === null ? null : Number(o.preco), unidade: o.unidade, moeda: o.moeda, icone: o.icone, miniatura: o.miniatura,
          parametros: (o.definicao?.parameters || []).length, atualizadoEm: o.updatedAt,
        })),
      });
    } catch (e) { next(e); }
  });
}

/**
 * Conjuntos de ferramentas de cada usuário (grupos com nome na faixa do editor):
 *   GET /api/ferramentas → { conjuntos: [{ id, nome, itens: [{ tipo: 'comando'|'objeto', id }] }] }
 *   PUT /api/ferramentas { conjuntos } → substitui todos os do usuário
 */
function toolRoutes(app, { requireUser }) {
  app.get('/api/ferramentas', requireUser(), async (req, res, next) => {
    try {
      const rows = await db.Ferramentas.findAll({ where: { UsuarioId: req.user.id }, order: [['ordem', 'ASC']] });
      res.json({ conjuntos: rows.map(r => ({ id: r.id, nome: r.nome, itens: r.itens })), inicial: !rows.length });
    } catch (e) { next(e); }
  });
  app.put('/api/ferramentas', requireUser(), async (req, res, next) => {
    try {
      const list = Array.isArray(req.body?.conjuntos) ? req.body.conjuntos.slice(0, 20) : [];
      const clean = list.map((c, i) => ({
        UsuarioId: req.user.id, ordem: i, nome: String(c.nome || 'Ferramentas').slice(0, 80),
        itens: (Array.isArray(c.itens) ? c.itens : []).slice(0, 60)
          .filter(x => x && ['comando', 'objeto'].includes(x.tipo) && typeof x.id === 'string')
          .map(x => ({ tipo: x.tipo, id: x.id.slice(0, 80) })),
      }));
      await db.sequelize.transaction(async transaction => {
        await db.Ferramentas.destroy({ where: { UsuarioId: req.user.id }, transaction });
        await db.Ferramentas.bulkCreate(clean, { transaction });
      });
      res.json({ ok: true });
    } catch (e) { next(e); }
  });
}

/**
 * Presets de menus e janelas (por usuário). Um preset guarda as abas da faixa — cada uma com grupos nomeados de
 * comandos e objetos — e o arranjo das janelas (barras recolhidas, larguras, aba à direita).
 *   GET /api/presets → { presets: [{ id, nome, dados }], ativo }
 *   PUT /api/presets { presets, ativo } → substitui todos
 * Primeiro acesso: o preset "Padrão" nasce dos conjuntos de ferramentas antigos (aba Início) ou do conjunto
 * "Elementos".
 */
const cleanItems = itens => (Array.isArray(itens) ? itens : []).slice(0, 60)
  .filter(x => x && ['comando', 'objeto'].includes(x.tipo) && typeof x.id === 'string')
  .map(x => ({ tipo: x.tipo, id: x.id.slice(0, 200) }));
const cleanDados = d => ({
  versao: Number(d?.versao) || 1,
  abas: (Array.isArray(d?.abas) ? d.abas : []).slice(0, 20).map(a => ({
    nome: String(a?.nome || 'Aba').slice(0, 40),
    grupos: (Array.isArray(a?.grupos) ? a.grupos : []).slice(0, 20).map(g => ({ nome: String(g?.nome || 'Grupo').slice(0, 60), itens: cleanItems(g?.itens) })),
  })),
  janelas: typeof d?.janelas === 'object' && d.janelas ? Object.fromEntries(Object.entries(d.janelas).filter(([, v]) => ['number', 'boolean', 'string'].includes(typeof v)).slice(0, 20)) : {},
});

function presetRoutes(app, { requireUser }) {
  app.get('/api/presets', requireUser(), async (req, res, next) => {
    try {
      let rows = await db.Preset.findAll({ where: { UsuarioId: req.user.id }, order: [['ordem', 'ASC']] });
      if (!rows.length) {
        const old = await db.Ferramentas.findAll({ where: { UsuarioId: req.user.id }, order: [['ordem', 'ASC']] });
        const grupos = old.length
          ? old.map(f => ({ nome: f.nome, itens: f.itens }))
          : [{ nome: 'Elementos', itens: ['parede', 'laje', 'pilar', 'viga', 'caixa'].map(id => ({ tipo: 'objeto', id })).concat([{ tipo: 'comando', id: 'ortho' }]) }];
        await db.Preset.create({ UsuarioId: req.user.id, nome: 'Padrão', ativo: true, dados: { abas: [{ nome: 'Início', grupos }], janelas: {} } });
        rows = await db.Preset.findAll({ where: { UsuarioId: req.user.id }, order: [['ordem', 'ASC']] });
      }
      const ativo = (rows.find(r => r.ativo) || rows[0]).id;
      res.json({ presets: rows.map(r => ({ id: r.id, nome: r.nome, dados: r.dados })), ativo });
    } catch (e) { next(e); }
  });
  app.put('/api/presets', requireUser(), async (req, res, next) => {
    try {
      const list = (Array.isArray(req.body?.presets) ? req.body.presets : []).slice(0, 30);
      if (!list.length) return res.status(400).json({ erro: 'Precisa de pelo menos um preset.' });
      const ativo = String(req.body?.ativo || '');
      await db.sequelize.transaction(async transaction => {
        await db.Preset.destroy({ where: { UsuarioId: req.user.id }, transaction });
        await db.Preset.bulkCreate(list.map((p, i) => ({
          id: typeof p.id === 'string' && /^[0-9a-f-]{36}$/i.test(p.id) ? p.id : undefined,
          UsuarioId: req.user.id, ordem: i, nome: String(p.nome || `Preset ${i + 1}`).slice(0, 80),
          ativo: p.id === ativo, dados: cleanDados(p.dados),
        })), { transaction });
      });
      res.json({ ok: true });
    } catch (e) { next(e); }
  });
}

module.exports = { routes: (app, opts) => { routes(app, opts); toolRoutes(app, opts); presetRoutes(app, opts); } };
