// Banco do BoxBim (SQLite) com o ORM Sequelize.
//   Usuario, Sessao ............ login e cadastro
//   Projeto, Membro ............ cada projeto tem um dono; outros usuários entram como editor ou leitor
//   Elemento ................... um registro por elemento do projeto (sincronizado em tempo real)
//   Objeto ..................... biblioteca geral de Objetos (famílias .bbo) com preço, ícone e miniatura
//   ObjetoProjeto .............. cópia de um Objeto dentro de um projeto (editar não afeta outros projetos)
//   Config ..................... chave/valor (biblioteca de tipos e materiais geral)
//   Ferramentas ................ conjuntos de ferramentas da faixa, escolhidos por cada usuário
'use strict';
const path = require('path');
const { Sequelize, DataTypes } = require('sequelize');
const sqliteNode = require('./sqlite-node');
const { SERVER_DIR } = require('../lib/store');

const storage = process.env.BOXBIM_DB || path.join(SERVER_DIR, 'boxbim.sqlite');
const sequelize = new Sequelize({ dialect: 'sqlite', dialectModule: sqliteNode, storage, logging: false });

// JSON guardado como texto (o SQLite não tem tipo JSON nativo no Sequelize 6 para consultas, só para guardar)
const json = (name, def = null) => ({
  type: DataTypes.TEXT,
  allowNull: true,
  get() { const v = this.getDataValue(name); return v === null || v === undefined ? def : JSON.parse(v); },
  set(v) { this.setDataValue(name, v === null || v === undefined ? null : JSON.stringify(v)); },
});

const Usuario = sequelize.define('Usuario', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  nome: { type: DataTypes.STRING(120), allowNull: false },
  email: { type: DataTypes.STRING(200), allowNull: false, unique: true, validate: { isEmail: true } },
  senhaHash: { type: DataTypes.STRING(300), allowNull: false },
  admin: { type: DataTypes.BOOLEAN, defaultValue: false },
}, { tableName: 'usuarios' });

const Sessao = sequelize.define('Sessao', {
  token: { type: DataTypes.STRING(80), primaryKey: true },
  expiraEm: { type: DataTypes.DATE, allowNull: false },
}, { tableName: 'sessoes' });

const Projeto = sequelize.define('Projeto', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  nome: { type: DataTypes.STRING(200), allowNull: false },
  descricao: { type: DataTypes.TEXT, defaultValue: '' },
  // níveis, vistas, configurações de render, tipos e materiais do projeto
  dados: json('dados', {}),
  miniatura: { type: DataTypes.TEXT, allowNull: true }, // dataURL PNG
}, { tableName: 'projetos' });

const Membro = sequelize.define('Membro', {
  papel: { type: DataTypes.ENUM('editor', 'leitor'), defaultValue: 'editor' },
}, { tableName: 'membros' });

const Elemento = sequelize.define('Elemento', {
  id: { type: DataTypes.STRING(64), primaryKey: true }, // GUID do elemento (o mesmo do IFC)
  tipo: { type: DataTypes.STRING(60) },
  dados: json('dados', {}),
  versao: { type: DataTypes.INTEGER, defaultValue: 1 },
}, { tableName: 'elementos' });

const Objeto = sequelize.define('Objeto', {
  id: { type: DataTypes.STRING(80), primaryKey: true },
  nome: { type: DataTypes.STRING(200), allowNull: false },
  categoria: { type: DataTypes.STRING(60) },
  sistema: { type: DataTypes.STRING(20), allowNull: true },
  definicao: json('definicao', {}),   // o .bbo inteiro (parâmetros, script…)
  preco: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
  unidade: { type: DataTypes.STRING(10), defaultValue: 'un' }, // un, m, m², m³, kg
  moeda: { type: DataTypes.STRING(5), defaultValue: 'BRL' },
  icone: { type: DataTypes.TEXT, allowNull: true },      // SVG, emoji ou dataURL
  miniatura: { type: DataTypes.TEXT, allowNull: true }, // dataURL PNG gerado no navegador
}, { tableName: 'objetos' });

const ObjetoProjeto = sequelize.define('ObjetoProjeto', {
  objetoId: { type: DataTypes.STRING(80), allowNull: false },
  definicao: json('definicao', {}),
  preco: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
  unidade: { type: DataTypes.STRING(10), defaultValue: 'un' },
  moeda: { type: DataTypes.STRING(5), defaultValue: 'BRL' },
  icone: { type: DataTypes.TEXT, allowNull: true },
  miniatura: { type: DataTypes.TEXT, allowNull: true },
}, { tableName: 'objetos_projeto', indexes: [{ unique: true, fields: ['ProjetoId', 'objetoId'] }] });

const Config = sequelize.define('Config', {
  chave: { type: DataTypes.STRING(80), primaryKey: true },
  valor: json('valor', null),
}, { tableName: 'config' });

const Ferramentas = sequelize.define('Ferramentas', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  nome: { type: DataTypes.STRING(80), allowNull: false },
  itens: json('itens', []), // [{ tipo: 'comando'|'objeto', id }]
  ordem: { type: DataTypes.INTEGER, defaultValue: 0 },
}, { tableName: 'ferramentas' });

// presets de menus e janelas de cada usuário: abas da faixa (com grupos e ferramentas) e o arranjo das janelas
const Preset = sequelize.define('Preset', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  nome: { type: DataTypes.STRING(80), allowNull: false },
  dados: json('dados', {}),
  ativo: { type: DataTypes.BOOLEAN, defaultValue: false },
  ordem: { type: DataTypes.INTEGER, defaultValue: 0 },
}, { tableName: 'presets' });

// relações
Usuario.hasMany(Preset, { onDelete: 'CASCADE' }); Preset.belongsTo(Usuario);
Usuario.hasMany(Sessao, { onDelete: 'CASCADE' }); Sessao.belongsTo(Usuario);
Projeto.belongsTo(Usuario, { as: 'dono', foreignKey: 'donoId' });
Usuario.hasMany(Projeto, { as: 'projetos', foreignKey: 'donoId' });
Projeto.belongsToMany(Usuario, { through: Membro, as: 'membros' });
Usuario.belongsToMany(Projeto, { through: Membro, as: 'compartilhados' });
Projeto.hasMany(Membro, { onDelete: 'CASCADE' }); Membro.belongsTo(Projeto); Membro.belongsTo(Usuario); Usuario.hasMany(Membro, { onDelete: 'CASCADE' });
Projeto.hasMany(Elemento, { onDelete: 'CASCADE' }); Elemento.belongsTo(Projeto);
Elemento.belongsTo(Usuario, { as: 'autor', foreignKey: 'autorId' });
Projeto.hasMany(ObjetoProjeto, { onDelete: 'CASCADE' }); ObjetoProjeto.belongsTo(Projeto);
Objeto.belongsTo(Usuario, { as: 'autor', foreignKey: 'autorId' });
Usuario.hasMany(Ferramentas, { onDelete: 'CASCADE' }); Ferramentas.belongsTo(Usuario);

async function init() {
  await sequelize.sync();
  return sequelize;
}

module.exports = { sequelize, init, Preset, Usuario, Sessao, Projeto, Membro, Elemento, Objeto, ObjetoProjeto, Config, Ferramentas, storage };
