// PISO DO MAPA: escolhe uma área num mapa aberto e cria o piso dela no projeto, com três opções:
//   localização .. grava latitude, longitude e altitude do ponto de origem do projeto (dados.geo — orientations.js);
//                  as próximas áreas ficam no lugar certo em relação a ela (leste = +X, norte = +Y)
//   elevação ..... o piso vira TERRENO com uma grade de pontos de altura (AWS Terrain Tiles, Terrarium), em relação
//                  à altitude da origem
//   textura ...... a imagem do mapa (satélite Sentinel-2, OpenStreetMap ou topográfico) recortada na área, guardada
//                  no servidor (/api/mapa/imagem) e desenhada por cima do terreno (MapSkins)
// Dados do piso: slab.mapa = { imagem, fonte, x0, y0, x1, y1 } (retângulo da imagem nas coordenadas do piso).
import * as THREE from 'three';
import { h, modal, toast, busy } from '../ui.js';
import { createOnLevel } from '../modeling.js';
import { fmtLen } from '../units.js';
import { MapView, MAP_SOURCES, toMerc, fromMerc, mercMeters, loadTile } from './map-view.js';

const round6 = v => +v.toFixed(6);
const ELEV_MAX_Z = 15;

/** Diálogo do piso do mapa. */
export function openMapFloor(app) {
  const geo = app.orientations?.geo;
  const map = new MapView({ lat: geo?.lat ?? -15.78, lon: geo?.lon ?? -47.93, zoom: geo ? 17 : 4, fonte: 'satelite', onChange: () => info() });
  if (geo) map.marker = [geo.lat, geo.lon];
  const q = h('input', { type: 'search', placeholder: 'Endereço, cidade ou "lat, lon"…', style: 'flex:1',
    onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); find(); } } });
  const results = h('div', { class: 'map-results' });
  const areaBtn = h('button', { type: 'button', onclick: () => setArea(!map.areaMode), title: 'Arraste no mapa para desenhar o retângulo da área' }, '▭ Desenhar área');
  const setArea = on => { map.areaMode = on; areaBtn.classList.toggle('on', on); map.draw(); };
  const sizeInfo = h('div', { class: 'small muted' });
  const src = h('select', { onchange: () => map.setSource(src.value) }, Object.entries(MAP_SOURCES).map(([k, s]) => h('option', { value: k, selected: k === map.fonte }, s.nome)));
  const chk = (label, title, on = true) => { const i = h('input', { type: 'checkbox', checked: on }); return [i, h('label', { class: 'inline', title }, i, label)]; };
  const [cLoc, lLoc] = chk('Trazer a localização', 'Grava latitude, longitude e altitude da origem no projeto (e o norte verdadeiro)', !geo);
  const [cElev, lElev] = chk('Trazer a elevação (terreno)', 'O piso vira terreno com pontos de altura tirados do modelo de elevação aberto (AWS Terrain Tiles)');
  const [cTex, lTex] = chk('Trazer a textura', 'A imagem do mapa recortada na área, por cima do terreno');
  const grid = h('input', { type: 'number', min: 4, max: 45, step: 1, value: 25, style: 'width:60px', title: 'Pontos de altura em cada lado da área (o terreno fica com lado × lado pontos)' });
  const texSrc = h('select', {}, Object.entries(MAP_SOURCES).map(([k, s]) => h('option', { value: k, selected: k === 'satelite' }, s.nome)));
  const level = h('select', {}, app.levels.list.map(l => h('option', { value: l.id, selected: l.id === app.views.activeLevel()?.id }, l.name)));

  function info() {
    const a = map.area;
    if (!a) { sizeInfo.textContent = 'Nenhuma área: clique em "Desenhar área" e arraste no mapa.'; return; }
    const [lat] = fromMerc((a[0] + a[2]) / 2, (a[1] + a[3]) / 2), k = mercMeters(lat);
    sizeInfo.textContent = `Área: ${fmtLen((a[2] - a[0]) * k, { suffix: true })} × ${fmtLen((a[3] - a[1]) * k, { suffix: true })}`;
  }
  async function find() {
    const text = q.value.trim();
    if (!text) return;
    const ll = text.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (ll) { map.setCenter(+ll[1], +ll[2], 17); map.marker = [+ll[1], +ll[2]]; return; }
    results.replaceChildren(h('div', { class: 'muted small' }, 'Buscando…'));
    try {
      const r = await fetch(`/api/mapa/busca?q=${encodeURIComponent(text)}`).then(x => x.json());
      if (r.erro) throw new Error(r.erro);
      results.replaceChildren(...(r.length ? r.map(p => h('button', { type: 'button', class: 'map-result', onclick: () => {
        if (p.caixa) map.fitBox(p.caixa); else map.setCenter(p.lat, p.lon, 17);
        map.marker = [p.lat, p.lon]; results.replaceChildren(); map.draw();
      } }, p.nome)) : [h('div', { class: 'muted small' }, 'Nada encontrado.')]));
    } catch (err) { results.replaceChildren(h('div', { class: 'small', style: 'color:#ff6b6b' }, err.message)); }
  }

  const body = h('div', { class: 'map-floor' },
    h('div', { class: 'row-buttons' }, q, h('button', { type: 'button', onclick: find }, 'Buscar')), results,
    map.el,
    h('div', { class: 'row-buttons' }, areaBtn, h('label', {}, 'Mapa ', src), sizeInfo),
    h('div', { class: 'map-options' },
      lLoc, h('div', { class: 'small muted' }, geo ? `O projeto já tem localização (${geo.lat.toFixed(6)}, ${geo.lon.toFixed(6)}): a área entra no lugar certo em relação a ela.` : 'A origem (0, 0) do projeto fica no centro da área.'),
      h('div', {}, lElev, ' · pontos por lado ', grid),
      h('div', {}, lTex, ' ', texSrc),
      h('label', {}, 'Nível do piso ', level)));
  info();
  const dlg = modal({
    title: 'Piso do mapa (geolocalização)', body,
    onClose: () => map.dispose(),
    actions: [
      { label: 'Cancelar' },
      { label: 'Criar piso', class: 'primary', action: async () => {
        if (!map.area) { toast('Desenhe a área no mapa primeiro.', 'error'); return false; }
        const opts = { area: map.area, location: cLoc.checked, elevation: cElev.checked, texture: cTex.checked, grid: Math.max(4, Math.min(45, Math.round(+grid.value) || 25)), texSource: texSrc.value, level: level.value };
        busy(true, 'Trazendo o terreno do mapa…');
        try { await createMapFloor(app, opts); } catch (err) { toast(err.message, 'error'); return false; } finally { busy(false); }
        return true;
      } },
    ],
  });
  dlg.el.classList.add('modal-wide');
  requestAnimationFrame(() => map.draw());
}

// ---------------------------------------------------------------- elevação (Terrarium)

/** Amostrador de elevação (m) em Mercator, com os ladrilhos que cobrem a caixa (zoom z). */
async function elevationSampler(box, z) {
  const n = 2 ** z;
  const tx0 = Math.floor(box[0] * n), tx1 = Math.floor(box[2] * n), ty0 = Math.floor(box[1] * n), ty1 = Math.floor(box[3] * n);
  if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) > 100) throw new Error('Área grande demais para a elevação nesse detalhe.');
  const data = new Map();
  const cv = new OffscreenCanvas(256, 256), ctx = cv.getContext('2d', { willReadFrequently: true });
  // um ladrilho por vez: não sobrecarrega o serviço
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    const bmp = await loadTile('elevacao', z, tx, ty);
    ctx.clearRect(0, 0, 256, 256); ctx.drawImage(bmp, 0, 0);
    const px = ctx.getImageData(0, 0, 256, 256).data, hts = new Float32Array(256 * 256);
    for (let i = 0; i < hts.length; i++) hts[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
    data.set(`${tx},${ty}`, hts);
  }
  const at = (gx, gy) => {
    const tx = Math.floor(gx / 256), ty = Math.floor(gy / 256), d = data.get(`${tx},${ty}`);
    if (!d) return 0;
    return d[(gy - ty * 256) * 256 + (gx - tx * 256)];
  };
  // bilinear nos pixels (centro do pixel)
  return (mx, my) => {
    const gx = mx * n * 256 - 0.5, gy = my * n * 256 - 0.5;
    const x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0;
    const cl = (v, a, b) => Math.max(a, Math.min(b, v));
    const X = v => cl(v, tx0 * 256, tx1 * 256 + 255), Y = v => cl(v, ty0 * 256, ty1 * 256 + 255);
    const a = at(X(x0), Y(y0)), b = at(X(x0 + 1), Y(y0)), c = at(X(x0), Y(y0 + 1)), d = at(X(x0 + 1), Y(y0 + 1));
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  };
}

// ---------------------------------------------------------------- textura (ladrilhos recortados na área)

async function textureImage(box, fonte) {
  const max = MAP_SOURCES[fonte]?.max ?? 17;
  // detalhe: até ~2048 px no lado maior e até 64 ladrilhos
  let z = Math.min(max, Math.max(1, Math.ceil(Math.log2(2048 / ((Math.max(box[2] - box[0], box[3] - box[1])) * 256)))));
  const count = zz => { const n = 2 ** zz; return (Math.floor(box[2] * n) - Math.floor(box[0] * n) + 1) * (Math.floor(box[3] * n) - Math.floor(box[1] * n) + 1); };
  while (z > 1 && count(z) > 64) z--;
  const n = 2 ** z, S = 256 * n;
  const px0 = box[0] * S, py0 = box[1] * S, W = Math.max(2, Math.round((box[2] - box[0]) * S)), H = Math.max(2, Math.round((box[3] - box[1]) * S));
  const cv = new OffscreenCanvas(W, H), ctx = cv.getContext('2d');
  for (let ty = Math.floor(box[1] * n); ty <= Math.floor(box[3] * n); ty++) for (let tx = Math.floor(box[0] * n); tx <= Math.floor(box[2] * n); tx++) {
    const bmp = await loadTile(fonte, z, tx, ty);
    ctx.drawImage(bmp, tx * 256 - px0, ty * 256 - py0);
  }
  return cv.convertToBlob({ type: 'image/jpeg', quality: 0.88 });
}

// ---------------------------------------------------------------- criação

export async function createMapFloor(app, { area, location, elevation, texture, grid, texSource, level }) {
  const orient = app.orientations;
  const c = [(area[0] + area[2]) / 2, (area[1] + area[3]) / 2];
  // origem: a localização do projeto (se já existe) ou o centro da área
  let g = orient?.geo ? { ...orient.geo } : null;
  const origin = g ? toMerc(g.lat, g.lon) : c;
  const [lat0, lon0] = g ? [g.lat, g.lon] : fromMerc(...c);
  const K = mercMeters(lat0);
  const local = (mx, my) => [round6((mx - origin[0]) * K), round6(-(my - origin[1]) * K)];
  const [x0, y1] = local(area[0], area[1]), [x1, y0] = local(area[2], area[3]);
  const wM = x1 - x0, hM = y1 - y0;
  if (wM < 1 || hM < 1) throw new Error('A área é pequena demais.');
  if (wM > 20000 || hM > 20000) throw new Error('A área é grande demais (até 20 km de lado).');

  // contorno (retângulo com pontos em cada lado) e pontos internos — a grade das alturas
  const N = elevation ? grid : 2;
  const gx = i => x0 + wM * i / (N - 1), gy = j => y0 + hM * j / (N - 1);
  const ring = [];
  for (let i = 0; i < N - 1; i++) ring.push([gx(i), gy(0)]);
  for (let j = 0; j < N - 1; j++) ring.push([gx(N - 1), gy(j)]);
  for (let i = N - 1; i > 0; i--) ring.push([gx(i), gy(N - 1)]);
  for (let j = N - 1; j > 0; j--) ring.push([gx(0), gy(j)]);
  const inner = [];
  for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) inner.push([gx(i), gy(j)]);

  let alturas = null, forma = null, alt0 = g?.alt ?? null;
  if (elevation) {
    // detalhe da elevação: pixel do ladrilho ≤ metade do espaçamento da grade
    const spacing = Math.min(wM, hM) / (N - 1);
    const zE = Math.max(1, Math.min(ELEV_MAX_Z, Math.ceil(Math.log2(K / (256 * spacing / 2)))));
    const toM = (x, y) => [origin[0] + x / K, origin[1] - y / K];
    const box = [Math.min(area[0], origin[0]), Math.min(area[1], origin[1]), Math.max(area[2], origin[0]), Math.max(area[3], origin[1])];
    const elev = await elevationSampler(box, zE);
    if (alt0 === null) alt0 = Math.round(elev(...origin) * 100) / 100;
    alturas = ring.map(([x, y]) => round6(elev(...toM(x, y)) - alt0));
    forma = inner.map(([x, y]) => [x, y, round6(elev(...toM(x, y)) - alt0)]);
  }

  // localização do projeto
  if (location && !orient?.geo) {
    g = { lat: round6(lat0), lon: round6(lon0), alt: alt0 ?? 0, norte: 0 };
    orient?.setGeo(g);
  }

  const lvl = app.levels.get(level) || app.views.activeLevel() || app.levels.list[0];
  const el = createOnLevel('slab', { level: lvl.id, points: ring, elevation: 0 }, app.levels);
  const s = el.userData.bim.slab;
  if (elevation) { s.terreno = true; s.alturas = alturas; s.forma = forma; }
  if (texture) {
    const blob = await textureImage(area, texSource);
    const r = await fetch('/api/mapa/imagem', { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob }).then(x => x.json());
    if (!r.id) throw new Error(r.erro || 'Não foi possível guardar a imagem do mapa.');
    s.mapa = { imagem: r.id, fonte: texSource, x0, y0, x1, y1 };
  }
  el.userData.bim.name = el.name = elevation ? 'Terreno (mapa)' : 'Piso (mapa)';
  el.userData.bim.props = { ...(el.userData.bim.props || {}), Origem: `Mapa · ${MAP_SOURCES[texSource]?.nome || ''}`.trim(), Latitude: fromMerc(...c)[0].toFixed(6), Longitude: fromMerc(...c)[1].toFixed(6) };
  app.viewer.add(el, { fit: true });
  app.viewer.select([el]);
  app.status(`${el.name}: ${fmtLen(wM, { suffix: true })} × ${fmtLen(hM, { suffix: true })}${elevation ? `, ${N * N} pontos de altura (altitude da origem ${alt0} m)` : ''}${texture ? ', com textura' : ''}.`);
  return el;
}

// ---------------------------------------------------------------- textura por cima do terreno

const textures = new Map();
function mapTexture(id) {
  if (!textures.has(id)) {
    const t = new THREE.TextureLoader().load(`/api/mapa/imagem/${encodeURIComponent(id)}`);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    textures.set(id, new THREE.MeshLambertMaterial({ map: t, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  }
  return textures.get(id);
}

/**
 * Pele com a imagem do mapa: os triângulos de cima da camada mais alta do piso, 4 mm acima, com UV no retângulo da
 * imagem. Refeita sozinha quando a malha muda (pontos, cortes, taludes) — confere a cada quadro só os pisos com mapa.
 */
export class MapSkins {
  constructor(app) {
    this.app = app;
    this.list = [];
    const refresh = () => { this.list = app.viewer.elements().filter(o => o.userData.bim?.slab?.mapa); };
    app.viewer.addEventListener('change', refresh);
    app.viewer.frameHooks.push(() => { for (const el of this.list) this.check(el); });
  }

  check(el) {
    const m = el.userData.bim.slab.mapa;
    let top = null;
    el.traverse(o => {
      if (!o.isMesh || o.userData.isEdge || o.userData.mapSkin || o.userData.rodape || o.userData.taludeSkin || !o.geometry) return;
      o.geometry.boundingBox || o.geometry.computeBoundingBox();
      if (!top || o.geometry.boundingBox.max.z > top.geometry.boundingBox.max.z) top = o;
    });
    const old = el.children.find(c => c.userData.mapSkin);
    const key = top ? `${top.geometry.uuid}|${m.imagem}|${m.x0},${m.y0},${m.x1},${m.y1}` : '';
    if (old?.userData.key === key) return;
    if (old) { el.remove(old); old.geometry.dispose(); }
    if (!top) return;
    el.updateMatrixWorld(true);
    const M = el.matrixWorld.clone().invert().multiply(top.matrixWorld);
    const pos = top.geometry.index ? top.geometry.toNonIndexed().attributes.position : top.geometry.attributes.position;
    const P = [], UV = [];
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
    const W = m.x1 - m.x0 || 1, H = m.y1 - m.y0 || 1;
    for (let i = 0; i + 2 < pos.count; i += 3) {
      a.fromBufferAttribute(pos, i).applyMatrix4(M); b.fromBufferAttribute(pos, i + 1).applyMatrix4(M); c.fromBufferAttribute(pos, i + 2).applyMatrix4(M);
      n.subVectors(c, b).cross(a.clone().sub(b)).normalize();
      if (n.z < 0.25) continue; // só o que olha para cima
      for (const v of [a, b, c]) { P.push(v.x, v.y, v.z + 0.004); UV.push((v.x - m.x0) / W, (v.y - m.y0) / H); }
    }
    if (!P.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
    g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere();
    const skin = new THREE.Mesh(g, mapTexture(m.imagem));
    skin.name = 'Textura do mapa';
    Object.assign(skin.userData, { mapSkin: true, keepMaterial: true, key });
    skin.raycast = () => {}; // o clique pega o terreno de baixo
    el.add(skin);
    this.app.viewer._bucketsDirty = true;
  }
}
