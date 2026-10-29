// MAPA LEVE (sem bibliotecas): ladrilhos 256 px de fontes abertas, pelo servidor do BoxBim (/api/mapa/tile/…).
//   arrastar ............ anda no mapa          roda do mouse / duplo clique ... aproxima e afasta
//   modo "área" ......... arrastar desenha o retângulo da área (Esc sai do modo)
// Coordenadas: Web Mercator normalizado (x, y de 0 a 1; y cresce para o SUL), zoom contínuo.
import { h } from '../ui.js';
import { toolCursor } from '../cursors.js';

export const MAP_SOURCES = {
  osm: { nome: 'Mapa (OpenStreetMap)', max: 19, credito: '© colaboradores do OpenStreetMap (ODbL)' },
  satelite: { nome: 'Satélite (Sentinel-2 2016)', max: 15, credito: 'Sentinel-2 cloudless 2016 by EOX IT Services GmbH (CC BY 4.0) — dados modificados do Copernicus Sentinel 2016' },
  topo: { nome: 'Topográfico (OpenTopoMap)', max: 17, credito: '© OpenStreetMap · SRTM · estilo © OpenTopoMap (CC BY-SA)' },
};

/** Latitude/longitude → Mercator normalizado. */
export const toMerc = (lat, lon) => {
  const s = Math.sin(lat * Math.PI / 180);
  return [(lon + 180) / 360, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)];
};
/** Mercator normalizado → [lat, lon]. */
export const fromMerc = (x, y) => [Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI, x * 360 - 180];
/** Metros por unidade de Mercator normalizado, no chão, na latitude lat (a escala do Mercator é 1/cos). */
export const mercMeters = lat => 40075016.686 * Math.cos(lat * Math.PI / 180);

export const tileUrl = (fonte, z, x, y) => `/api/mapa/tile/${fonte}/${z}/${x}/${y}`;

export class MapView {
  constructor({ lat = -15.78, lon = -47.93, zoom = 4, fonte = 'osm', onChange } = {}) {
    this.fonte = fonte;
    this.zoom = zoom;
    [this.cx, this.cy] = toMerc(lat, lon);
    this.area = null;        // [x0, y0, x1, y1] (Mercator)
    this.areaMode = false;
    this.onChange = onChange;
    this.tiles = new Map();  // url → Image
    this.canvas = h('canvas', { class: 'map-canvas' });
    this.credit = h('div', { class: 'map-credit' });
    this.el = h('div', { class: 'map-view' }, this.canvas, this.credit,
      h('div', { class: 'map-zoom' },
        h('button', { type: 'button', title: 'Aproximar', onclick: () => this.zoomAt(1) }, '+'),
        h('button', { type: 'button', title: 'Afastar', onclick: () => this.zoomAt(-1) }, '−')));
    this.ctx = this.canvas.getContext('2d');
    this.bind();
    this.ro = new ResizeObserver(() => this.draw());
    this.ro.observe(this.el);
  }

  dispose() { this.ro.disconnect(); }

  get size() { return [this.canvas.clientWidth || 600, this.canvas.clientHeight || 380]; }
  /** Pixels do mundo (zoom atual) por unidade de Mercator. */
  get scale() { return 256 * 2 ** this.zoom; }

  toScreen(x, y) { const [w, hh] = this.size; return [(x - this.cx) * this.scale + w / 2, (y - this.cy) * this.scale + hh / 2]; }
  toMercPx(px, py) { const [w, hh] = this.size; return [this.cx + (px - w / 2) / this.scale, this.cy + (py - hh / 2) / this.scale]; }

  setCenter(lat, lon, zoom = this.zoom) { [this.cx, this.cy] = toMerc(lat, lon); this.zoom = Math.max(1, Math.min(19, zoom)); this.draw(); }

  /** Enquadra uma caixa [sul, norte, oeste, leste] (graus). */
  fitBox([s, n, w, e]) {
    const [x0, y1] = toMerc(s, w), [x1, y0] = toMerc(n, e);
    this.cx = (x0 + x1) / 2; this.cy = (y0 + y1) / 2;
    const [W, H] = this.size;
    this.zoom = Math.max(1, Math.min(18, Math.log2(Math.min(W / ((x1 - x0) * 256 || 1e-9), H / ((y1 - y0) * 256 || 1e-9))) - 0.2));
    this.draw();
  }

  setSource(f) { this.fonte = f; this.draw(); }

  zoomAt(dz, px, py) {
    const [w, hh] = this.size;
    px ??= w / 2; py ??= hh / 2;
    const [mx, my] = this.toMercPx(px, py);
    this.zoom = Math.max(1, Math.min(MAP_SOURCES[this.fonte]?.max ?? 19, this.zoom + dz));
    // o ponto sob o mouse fica no lugar
    this.cx = mx - (px - w / 2) / this.scale; this.cy = my - (py - hh / 2) / this.scale;
    this.draw();
  }

  bind() {
    const c = this.canvas;
    let drag = null;
    c.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      c.setPointerCapture(e.pointerId);
      const r = c.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
      drag = this.areaMode ? { area: true, a: this.toMercPx(px, py) } : { px, py, cx: this.cx, cy: this.cy };
    });
    c.addEventListener('pointermove', e => {
      if (!drag) return;
      const r = c.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
      if (drag.area) {
        const b = this.toMercPx(px, py);
        this.area = [Math.min(drag.a[0], b[0]), Math.min(drag.a[1], b[1]), Math.max(drag.a[0], b[0]), Math.max(drag.a[1], b[1])];
        this.onChange?.();
      } else {
        this.cx = drag.cx - (px - drag.px) / this.scale; this.cy = drag.cy - (py - drag.py) / this.scale;
      }
      this.draw();
    });
    c.addEventListener('pointerup', () => { if (drag?.area) this.onChange?.('area'); drag = null; });
    c.addEventListener('wheel', e => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      this.zoomAt(e.deltaY < 0 ? 0.5 : -0.5, e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    c.addEventListener('dblclick', e => { const r = c.getBoundingClientRect(); this.zoomAt(1, e.clientX - r.left, e.clientY - r.top); });
  }

  tile(z, x, y) {
    const url = tileUrl(this.fonte, z, x, y);
    let img = this.tiles.get(url);
    if (!img) {
      img = new Image();
      img.onload = () => this.draw();
      img.src = url;
      this.tiles.set(url, img);
      if (this.tiles.size > 600) this.tiles.delete(this.tiles.keys().next().value);
    }
    return img.complete && img.naturalWidth ? img : null;
  }

  draw() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this.paint(); });
  }

  paint() {
    const [w, hh] = this.size, dpr = devicePixelRatio || 1;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(hh * dpr)) { this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(hh * dpr); }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#20262e'; ctx.fillRect(0, 0, w, hh);
    const max = MAP_SOURCES[this.fonte]?.max ?? 19;
    const z = Math.max(0, Math.min(max, Math.round(this.zoom))), n = 2 ** z, ts = this.scale / n; // tamanho do ladrilho na tela
    const [mx0, my0] = this.toMercPx(0, 0), [mx1, my1] = this.toMercPx(w, hh);
    for (let ty = Math.max(0, Math.floor(my0 * n)); ty <= Math.min(n - 1, Math.floor(my1 * n)); ty++) {
      for (let tx = Math.floor(mx0 * n); tx <= Math.floor(mx1 * n); tx++) {
        const wx = ((tx % n) + n) % n;
        const img = this.tile(z, wx, ty);
        const [sx, sy] = this.toScreen(tx / n, ty / n);
        if (img) ctx.drawImage(img, sx, sy, ts + 0.5, ts + 0.5);
      }
    }
    if (this.area) {
      const [ax, ay] = this.toScreen(this.area[0], this.area[1]), [bx, by] = this.toScreen(this.area[2], this.area[3]);
      ctx.fillStyle = 'rgba(47,155,255,.18)'; ctx.fillRect(ax, ay, bx - ax, by - ay);
      ctx.strokeStyle = '#2f9bff'; ctx.lineWidth = 2; ctx.strokeRect(ax, ay, bx - ax, by - ay);
    }
    if (this.marker) {
      const [px, py] = this.toScreen(...toMerc(...this.marker));
      ctx.fillStyle = '#ff4d4d'; ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
    }
    this.credit.textContent = MAP_SOURCES[this.fonte]?.credito || '';
    this.canvas.style.cursor = this.areaMode ? toolCursor('retangulo') : 'grab';
  }
}

/** Carrega um ladrilho como bitmap (para compor a textura e ler a elevação). */
export async function loadTile(fonte, z, x, y) {
  const r = await fetch(tileUrl(fonte, z, x, y));
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).erro || `Ladrilho ${z}/${x}/${y}: ${r.status}`);
  return createImageBitmap(await r.blob());
}
