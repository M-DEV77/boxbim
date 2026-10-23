// Adaptador: a API do pacote "sqlite3" (a que o Sequelize usa) sobre o SQLite embutido no Node (node:sqlite).
// Sem módulo nativo para compilar e sem script de instalação. Só o que o dialeto sqlite do Sequelize chama:
//   new Database(arquivo, modo, cb) · run/all/exec(sql, params, cb) · serialize(fn) · close(cb)
'use strict';
const { DatabaseSync } = require('node:sqlite');

const OPEN_READONLY = 0x1;
const OPEN_READWRITE = 0x2;
const OPEN_CREATE = 0x4;
const OPEN_FULLMUTEX = 0x10000;

// códigos estendidos do SQLite → nomes que o Sequelize reconhece em formatError
const CODES = { 19: 'SQLITE_CONSTRAINT', 787: 'SQLITE_CONSTRAINT_FOREIGNKEY', 1555: 'SQLITE_CONSTRAINT_PRIMARYKEY', 2067: 'SQLITE_CONSTRAINT_UNIQUE', 1811: 'SQLITE_CONSTRAINT_TRIGGER', 1299: 'SQLITE_CONSTRAINT_NOTNULL', 5: 'SQLITE_BUSY' };

function toSqliteError(e) {
  const code = CODES[e.errcode] || (e.errcode & 0xff) === 19 && 'SQLITE_CONSTRAINT' || 'SQLITE_ERROR';
  const err = new Error(`${code}: ${e.errstr ? e.message : e.message}`);
  err.code = code;
  err.errno = e.errcode;
  return err;
}

// o sqlite3 aceita booleanos e undefined; o node:sqlite não
const val = v => (v === true ? 1 : v === false ? 0 : v === undefined ? null : v);

function bind(params) {
  if (params === undefined || params === null) return [];
  if (Array.isArray(params)) return params.map(val);
  if (typeof params === 'object' && !Buffer.isBuffer(params)) {
    const o = {};
    for (const [k, v] of Object.entries(params)) o[k] = val(v);
    return [o];
  }
  return [val(params)];
}

class Database {
  constructor(filename, mode, cb) {
    if (typeof mode === 'function') { cb = mode; mode = OPEN_READWRITE | OPEN_CREATE; }
    this.filename = filename;
    try {
      this.db = new DatabaseSync(filename, { readOnly: (mode & OPEN_READWRITE) === 0 });
      this.db.exec('PRAGMA journal_mode = WAL');
      this.db.exec('PRAGMA busy_timeout = 5000');
      setImmediate(() => cb && cb(null));
    } catch (e) {
      setImmediate(() => cb && cb(toSqliteError(e)));
    }
  }

  _call(kind, sql, params, cb) {
    if (typeof params === 'function') { cb = params; params = undefined; }
    let ctx = { lastID: undefined, changes: 0 };
    let rows;
    let error = null;
    try {
      const stmt = this.db.prepare(sql);
      const args = bind(params);
      if (kind === 'run') {
        const r = stmt.run(...args);
        ctx = { lastID: Number(r.lastInsertRowid), changes: Number(r.changes) };
      } else {
        rows = stmt.all(...args).map(r => ({ ...r }));
      }
    } catch (e) {
      error = toSqliteError(e);
    }
    // o Sequelize lê "this.lastID/changes" do callback e checa metaData.constructor.name === 'Statement'
    const meta = Object.assign(new Statement(), ctx);
    if (cb) setImmediate(() => cb.call(meta, error, rows));
    return this;
  }

  run(sql, params, cb) { return this._call('run', sql, params, cb); }
  all(sql, params, cb) { return this._call('all', sql, params, cb); }
  get(sql, params, cb) {
    if (typeof params === 'function') { cb = params; params = undefined; }
    return this._call('all', sql, params, (err, rows) => cb && cb(err, rows && rows[0]));
  }
  exec(sql, cb) {
    let error = null;
    try { this.db.exec(sql); } catch (e) { error = toSqliteError(e); }
    if (cb) setImmediate(() => cb(error));
    return this;
  }
  serialize(fn) { if (fn) fn(); return this; }
  parallelize(fn) { if (fn) fn(); return this; }
  close(cb) {
    try { this.db.close(); } catch { /* já fechado */ }
    if (cb) setImmediate(() => cb(null));
  }
}

class Statement {}

module.exports = { Database, OPEN_READONLY, OPEN_READWRITE, OPEN_CREATE, OPEN_FULLMUTEX, verbose() { return module.exports; } };
