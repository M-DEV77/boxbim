// MAPA E GEOLOCALIZAÇÃO (servidor): o navegador só fala com o próprio BoxBim (CSP 'self'); estas rotas buscam nos
// serviços abertos, com identificação (User-Agent) e cache em disco — gentil com os servidores e mais rápido na 2ª vez.
//   GET  /api/mapa/tile/:fonte/:z/:x/:y ... um ladrilho (256 px) de uma fonte aberta:
//          osm ....... OpenStreetMap (mapa) — © colaboradores do OpenStreetMap, ODbL
//          satelite .. EOX Sentinel-2 cloudless 2016 — CC BY 4.0 (dados modificados do Copernicus Sentinel 2016)
//          topo ...... OpenTopoMap — © OpenStreetMap, SRTM · estilo © OpenTopoMap (CC BY-SA)
//          elevacao .. AWS Terrain Tiles (Terrarium, Mapzen/Tilezen) — dados abertos; altura = R·256 + G + B/256 − 32768
//   GET  /api/mapa/busca?q= .............. endereço → lugares (Nominatim/OpenStreetMap, no máximo 1 pedido por segundo)
//   POST /api/mapa/imagem ................ guarda a imagem (JPEG/PNG) da textura do terreno → { id }
//   GET  /api/mapa/imagem/:id ............ devolve a imagem guardada
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const store = require('./lib/store');

const VERSION = require('../package.json').version;
const UA = `BoxBim/${VERSION} (modelagem BIM; +https://marceloolimpio.com.br/)`;

const SOURCES = {
  osm: { url: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`, max: 19, type: 'image/png' },
  satelite: { url: (z, x, y) => `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/${z}/${y}/${x}.jpg`, max: 15, type: 'image/jpeg' },
  topo: { url: (z, x, y) => `https://${'abc'[(x + y) % 3]}.tile.opentopomap.org/${z}/${x}/${y}.png`, max: 17, type: 'image/png' },
  elevacao: { url: (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`, max: 15, type: 'image/png' },
};

const cacheDir = () => path.join(store.SERVER_DIR, 'cache', 'mapa');
const imgDir = () => path.join(store.SERVER_DIR, 'mapas');

/** Busca com tempo limite e identificação. */
async function get(url, ms = 15000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' }, signal: ctl.signal });
    if (!r.ok) { const e = new Error(`O serviço de mapa respondeu ${r.status}.`); e.status = 502; throw e; }
    return Buffer.from(await r.arrayBuffer());
  } catch (e) {
    if (e.name === 'AbortError') { const x = new Error('O serviço de mapa não respondeu a tempo.'); x.status = 504; throw x; }
    if (!e.status) e.status = 502;
    throw e;
  } finally { clearTimeout(t); }
}

// ladrilhos sendo baixados agora (dois pedidos iguais ao mesmo tempo baixam uma vez)
const pending = new Map();

async function tile(fonte, z, x, y) {
  const src = SOURCES[fonte];
  if (!src) { const e = new Error('Fonte de mapa desconhecida.'); e.status = 404; throw e; }
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > src.max || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) {
    const e = new Error('Ladrilho fora do mapa.'); e.status = 400; throw e;
  }
  const f = path.join(cacheDir(), fonte, String(z), String(x), `${y}`);
  if (fs.existsSync(f)) return { buf: fs.readFileSync(f), type: src.type };
  const key = `${fonte}/${z}/${x}/${y}`;
  if (!pending.has(key)) {
    pending.set(key, get(src.url(z, x, y)).then(buf => {
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, buf);
      return buf;
    }).finally(() => pending.delete(key)));
  }
  return { buf: await pending.get(key), type: src.type };
}

// Nominatim: no máximo 1 pedido por segundo (política de uso); as respostas ficam em memória
let lastSearch = 0;
const searches = new Map();
async function search(q) {
  q = String(q || '').trim().slice(0, 200);
  if (!q) return [];
  if (searches.has(q)) return searches.get(q);
  const wait = lastSearch + 1100 - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastSearch = Date.now();
  const buf = await get(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&accept-language=pt-BR&q=${encodeURIComponent(q)}`);
  const out = JSON.parse(buf.toString('utf8')).map(p => ({ nome: p.display_name, lat: Number(p.lat), lon: Number(p.lon), caixa: p.boundingbox?.map(Number) || null }));
  if (searches.size > 200) searches.clear();
  searches.set(q, out);
  return out;
}

function routes(app, { requireUser }) {
  const wrap = fn => async (req, res) => {
    try { await fn(req, res); } catch (e) { res.set('Cache-Control', 'no-store').status(e.status || 500).json({ erro: e.message || 'Erro no mapa.' }); } // erro não fica no cache
  };
  app.get('/api/mapa/tile/:fonte/:z/:x/:y', requireUser(), wrap(async (req, res) => {
    const [z, x, y] = [req.params.z, req.params.x, req.params.y].map(v => Number(String(v).replace(/\.\w+$/, '')));
    const t = await tile(req.params.fonte, z, x, y);
    res.set('Cache-Control', 'private, max-age=604800').type(t.type).send(t.buf);
  }));
  app.get('/api/mapa/busca', requireUser(), wrap(async (req, res) => res.json(await search(req.query.q))));
  app.post('/api/mapa/imagem', requireUser(), express.raw({ type: ['image/jpeg', 'image/png'], limit: '40mb' }), wrap(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) { const e = new Error('Imagem vazia.'); e.status = 400; throw e; }
    const ext = req.get('content-type') === 'image/png' ? 'png' : 'jpg';
    const id = `${crypto.randomUUID()}.${ext}`;
    fs.mkdirSync(imgDir(), { recursive: true });
    fs.writeFileSync(path.join(imgDir(), id), req.body);
    res.json({ id });
  }));
  app.get('/api/mapa/imagem/:id', requireUser(), wrap(async (req, res) => {
    const id = path.basename(String(req.params.id));
    if (!/^[\w-]+\.(jpg|png)$/.test(id)) { const e = new Error('Imagem inválida.'); e.status = 400; throw e; }
    const f = path.join(imgDir(), id);
    if (!fs.existsSync(f)) { const e = new Error('Imagem não encontrada.'); e.status = 404; throw e; }
    res.set('Cache-Control', 'private, max-age=31536000, immutable').sendFile(f, { dotfiles: 'allow' }); // a pasta .servidor começa com ponto
  }));
}

module.exports = { routes, SOURCES };
