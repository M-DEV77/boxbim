// Servidor web do BoxBim: páginas (login, projetos, editor), API REST, chamadas do editor (/api/rpc) e
// colaboração em tempo real (/ws). Roda neste PC (acesso pela rede) ou num servidor na internet:
//   PORTA (padrão 3000) · HOST (padrão 0.0.0.0) · BOXBIM_DATA (pasta de dados) · BOXBIM_HTTPS=1 (cookie Secure)
// Sem o Revit/Blender/ODA/Unreal nesta máquina, essas pontes ficam desligadas (app:capacidades).
'use strict';
const http = require('http');
const os = require('os');
const path = require('path');
const express = require('express');
const db = require('./db');
const auth = require('./auth');
const projects = require('./projects');
const rpc = require('./rpc');
const realtimeMod = require('./realtime');
const library = require('./library');

const ROOT = path.join(__dirname, '..', 'renderer');
const PORT = Number(process.env.PORTA || process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

async function main() {
  await db.init();
  await rpc.seedLibrary();

  const app = express();
  const server = http.createServer(app);
  const realtime = realtimeMod.create(server);
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');

  // cabeçalhos de segurança; o worker dos scripts de Objetos não pode acessar a rede
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    // o worker roda o script do objeto (new Function), mas sem rede: connect-src cai em default-src 'none'
    if (req.path.endsWith('object-worker.js')) res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-eval'");
    else res.setHeader('Content-Security-Policy', [
      "default-src 'self'", "script-src 'self' 'wasm-unsafe-eval'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
      "connect-src 'self'", "worker-src 'self' blob:", "font-src 'self' data:", "object-src 'none'", "base-uri 'self'", "frame-ancestors 'self'",
    ].join('; '));
    next();
  });
  // pedidos que mudam algo só da mesma origem (cookie de sessão não serve para outro site)
  app.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    const origin = req.get('origin');
    if (origin && new URL(origin).host !== req.get('host')) return res.status(403).json({ erro: 'Origem não permitida.' });
    next();
  });
  app.use('/api/enviar', (req, res, next) => next()); // corpo cru (arquivo): sem parser JSON
  app.use(/^\/api\/(?!enviar).*/, express.json({ limit: '200mb' }));

  auth.routes(app);
  projects.routes(app, { requireUser: auth.requireUser, realtime });
  rpc.routes(app, { requireUser: auth.requireUser, realtime });
  library.routes(app, { requireUser: auth.requireUser });

  app.get('/api/changelog', auth.requireUser(), (req, res) => res.type('text/markdown').sendFile(path.join(__dirname, '..', 'CHANGELOG.md')));
  app.use('/assets', express.static(path.join(__dirname, '..', 'assets')));

  // páginas: o editor e a lista de projetos exigem login
  app.get('/', (req, res) => res.redirect('/projetos.html'));
  app.get(['/projetos.html', '/app.html', '/biblioteca.html'], auth.requireUser(true), (req, res, next) => next());
  app.use(express.static(ROOT, { index: false, extensions: ['html'] }));

  app.use((e, req, res, _next) => {
    if (!e.status || e.status >= 500) console.error(e);
    res.status(e.status || 500).json({ erro: e.message || 'Erro no servidor.' });
  });

  server.listen(PORT, HOST, () => {
    const ips = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
    console.log(`BoxBim ${require('../package.json').version} — banco ${db.storage}`);
    console.log(`  neste PC:  http://localhost:${PORT}`);
    for (const ip of ips) console.log(`  na rede:   http://${ip}:${PORT}`);
  });
}

main().catch(e => { console.error(e); process.exit(1); });
