// Login e cadastro: senha com scrypt (sal por usuário), sessão em cookie HttpOnly guardada no banco.
// O primeiro usuário cadastrado vira administrador (configurações do servidor: chaves de IA, caminhos).
'use strict';
const crypto = require('crypto');
const { promisify } = require('util');
const { Op } = require('sequelize');
const db = require('./db');

const scrypt = promisify(crypto.scrypt);
const COOKIE = 'boxbim_sessao';
const DAYS = 30;

async function hashPassword(senha) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(senha, salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

async function checkPassword(senha, stored) {
  const [alg, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const key = await scrypt(senha, Buffer.from(salt, 'hex'), 64);
  const ref = Buffer.from(hash, 'hex');
  return ref.length === key.length && crypto.timingSafeEqual(ref, key);
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setCookie(res, token, maxAgeS) {
  const secure = process.env.BOXBIM_HTTPS === '1' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeS}${secure}`);
}

async function createSession(res, user) {
  const token = crypto.randomBytes(32).toString('base64url');
  await db.Sessao.create({ token, UsuarioId: user.id, expiraEm: new Date(Date.now() + DAYS * 864e5) });
  setCookie(res, token, DAYS * 86400);
}

/** Usuário da requisição (cookie de sessão válido) ou null. */
async function userFromRequest(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return null;
  const s = await db.Sessao.findOne({ where: { token, expiraEm: { [Op.gt]: new Date() } }, include: db.Usuario });
  return s?.Usuario || null;
}

const publicUser = u => u && { id: u.id, nome: u.nome, email: u.email, admin: !!u.admin };

// tentativas de login por IP (freio contra força bruta)
const attempts = new Map();
function throttle(ip) {
  const now = Date.now();
  const a = (attempts.get(ip) || []).filter(t => now - t < 10 * 60e3);
  if (a.length >= 20) throw Object.assign(new Error('Muitas tentativas. Aguarde alguns minutos.'), { status: 429 });
  a.push(now);
  attempts.set(ip, a);
}

function routes(app) {
  app.post('/api/auth/cadastro', async (req, res) => {
    const nome = String(req.body?.nome || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const senha = String(req.body?.senha || '');
    if (!nome || !email || senha.length < 8) return res.status(400).json({ erro: 'Informe nome, e-mail e uma senha com pelo menos 8 caracteres.' });
    throttle(req.ip);
    const admin = (await db.Usuario.count()) === 0;
    // servidor público: com BOXBIM_CODIGO_CADASTRO, novas contas precisam do código (a 1ª, do administrador, não)
    const codigo = process.env.BOXBIM_CODIGO_CADASTRO;
    if (codigo && !admin && String(req.body?.codigo || '') !== codigo) return res.status(403).json({ erro: 'Código de cadastro inválido. Peça o código ao administrador do BoxBim.' });
    if (await db.Usuario.findOne({ where: { email } })) return res.status(409).json({ erro: 'Já existe uma conta com este e-mail.' });
    const user = await db.Usuario.create({ nome, email, senhaHash: await hashPassword(senha), admin });
    await createSession(res, user);
    res.json({ usuario: publicUser(user) });
  });

  // a página de cadastro pergunta se precisa do código de convite
  app.get('/api/auth/config', async (req, res) => {
    res.json({ codigoCadastro: !!process.env.BOXBIM_CODIGO_CADASTRO && (await db.Usuario.count()) > 0 });
  });

  app.post('/api/auth/login', async (req, res) => {
    throttle(req.ip);
    const email = String(req.body?.email || '').trim().toLowerCase();
    const user = await db.Usuario.findOne({ where: { email } });
    if (!user || !(await checkPassword(String(req.body?.senha || ''), user.senhaHash))) {
      return res.status(401).json({ erro: 'E-mail ou senha incorretos.' });
    }
    await createSession(res, user);
    res.json({ usuario: publicUser(user) });
  });

  app.post('/api/auth/sair', async (req, res) => {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) await db.Sessao.destroy({ where: { token } });
    setCookie(res, '', 0);
    res.json({ ok: true });
  });

  app.get('/api/auth/eu', async (req, res) => {
    const u = await userFromRequest(req);
    if (!u) return res.status(401).json({ erro: 'Sem sessão.' });
    res.json({ usuario: publicUser(u) });
  });
}

/** Middleware: exige login (API responde 401; páginas redirecionam para /login.html). */
function requireUser(page = false) {
  return async (req, res, next) => {
    try {
      const u = await userFromRequest(req);
      if (!u) return page ? res.redirect(`/login.html?volta=${encodeURIComponent(req.originalUrl)}`) : res.status(401).json({ erro: 'Faça login.' });
      req.user = u;
      next();
    } catch (e) { next(e); }
  };
}

module.exports = { routes, requireUser, userFromRequest, publicUser, hashPassword, checkPassword };
