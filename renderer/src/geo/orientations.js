// ORIENTAÇÕES DO PROJETO E NORTE DE CADA VISTA.
//   dados.geo ............... { lat, lon, alt } da origem (0, 0) do projeto (o Piso do mapa grava; editável aqui)
//   dados.norte ............. ângulo do NORTE VERDADEIRO (graus, sentido horário a partir do norte do projeto = +Y)
//   dados.orientacoes ....... outras orientações do projeto [{ id, nome, angulo }] — quantas forem precisas (um bloco
//                             girado, um eixo do terreno, a divisa…), no mesmo sentido do norte verdadeiro
//   dados.orientacaoVistas .. { idDaVista: idDaOrientação } — cada vista escolhe a sua. Nas plantas a vista gira para
//                             aquele "norte" ficar para cima; em todas as vistas a rosa dos ventos (no canto) mostra
//                             o norte verdadeiro e a orientação da vista.
import * as THREE from 'three';
import { h, modal, dropdown, toast } from '../ui.js';

const BUILTIN = [{ id: 'projeto', nome: 'Norte do projeto' }, { id: 'verdadeiro', nome: 'Norte verdadeiro' }];
const SVGNS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, ...kids) => { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); e.append(...kids); return e; };
/** Direção (modelo, XY) do norte de uma orientação de ângulo a (graus, horário a partir de +Y). */
export const northDir = a => { const r = a * Math.PI / 180; return [Math.sin(r), Math.cos(r)]; };

export class Orientations extends EventTarget {
  constructor(app) {
    super();
    this.app = app;
    this.geo = null;
    this.norte = 0;
    this.extras = [];
    this.perView = {};
    this.buildCompass();
    // depois de montar cada vista, gira as plantas para a orientação escolhida nela
    const views = app.views, apply = views._apply.bind(views);
    views._apply = (v, o) => { apply(v, o); this.applyCamera(v); };
    app.viewer.frameHooks.push(() => this.updateCompass());
  }

  /** Dados do projeto (parciais, como chegam da sincronização). */
  load(d = {}) {
    if ('geo' in d) this.geo = d.geo && Number.isFinite(+d.geo.lat) && Number.isFinite(+d.geo.lon) ? { lat: +d.geo.lat, lon: +d.geo.lon, alt: +d.geo.alt || 0 } : null;
    if ('norte' in d) this.norte = Number(d.norte) || 0;
    if (Array.isArray(d.orientacoes)) this.extras = d.orientacoes.filter(o => o?.id).map(o => ({ id: String(o.id), nome: String(o.nome || 'Orientação'), angulo: Number(o.angulo) || 0 }));
    if (d.orientacaoVistas && typeof d.orientacaoVistas === 'object') this.perView = { ...d.orientacaoVistas };
    const v = this.app.views.active;
    if (v) this.applyCamera(v);
  }

  save(patch) { this.app.project?.send({ t: 'projeto', dados: patch }); this.dispatchEvent(new Event('change')); }

  setGeo(g) { this.geo = g ? { lat: g.lat, lon: g.lon, alt: g.alt || 0 } : null; if (g && Number.isFinite(g.norte)) this.norte = g.norte; this.save({ geo: this.geo, norte: this.norte }); }

  all() {
    return [{ ...BUILTIN[0], angulo: 0 }, { ...BUILTIN[1], angulo: this.norte }, ...this.extras];
  }

  get(id) { return this.all().find(o => o.id === id) || this.all()[0]; }

  forView(v) { return this.get(this.perView[v?.id] || 'projeto'); }

  setForView(v, id) {
    if (!v) return;
    if (id === 'projeto') delete this.perView[v.id]; else this.perView[v.id] = id;
    this.save({ orientacaoVistas: this.perView });
    this.applyCamera(v);
  }

  /** Planta/forro: a câmera gira (em volta da vertical) para o norte da orientação ficar para cima na tela. */
  applyCamera(v) {
    if (!v || (v.kind !== 'plan' && v.kind !== 'ceiling')) return;
    const viewer = this.app.viewer, cam = viewer.orthoCam, ctl = viewer.orthoControls;
    if (viewer.camera !== cam) return;
    const [nx, ny] = northDir(this.forView(v).angulo);
    const t = ctl.target, d = Math.max(1, Math.abs(cam.position.z - t.z) || 1000);
    const z = v.kind === 'ceiling' ? -1 : 1;
    // olhando quase na vertical, puxada um tiquinho para o "sul" da orientação: o "norte" fica para cima
    cam.position.set(t.x - nx * d * 1e-4, t.y - ny * d * 1e-4, t.z + z * d);
    cam.lookAt(t);
    ctl.update();
  }

  // ------------------------------------------------------------ rosa dos ventos (canto da vista)

  buildCompass() {
    this.arrowTrue = svg('g', {}, svg('path', { d: 'M0 -17 L5 3 L0 0 L-5 3 Z', fill: '#ff4d4d' }), svg('text', { x: 0, y: -19, 'text-anchor': 'middle', 'font-size': 9, 'font-weight': 700, fill: '#ff8080' }, 'N'));
    this.arrowView = svg('path', { d: 'M0 -14 L3.5 2 L0 0 L-3.5 2 Z', fill: '#9fb3c8', opacity: 0.9 });
    const s = svg('svg', { viewBox: '-24 -24 48 48', width: 44, height: 44 },
      svg('circle', { r: 21, fill: 'rgba(15,19,23,.6)', stroke: '#3a4552', 'stroke-width': 1 }), this.arrowView, this.arrowTrue);
    this.label = h('span', { class: 'compass-label' });
    this.compass = h('button', { class: 'north-compass', title: 'Norte desta vista: escolha a orientação (norte verdadeiro, do projeto ou outra)', onclick: e => this.menu(e.currentTarget) }, s, this.label);
    document.querySelector('.center').append(this.compass);
  }

  menu(anchor) {
    const v = this.app.views.active, cur = this.forView(v);
    dropdown(anchor, [
      ...this.all().map(o => ({ label: `${o.id === cur.id ? '✔ ' : ''}${o.nome}`, hint: `${o.angulo.toFixed(1)}°`, action: () => this.setForView(v, o.id) })),
      '-', { label: 'Orientações do projeto…', hint: 'norte verdadeiro, localização e outras', action: () => this.dialog() },
    ]);
  }

  /** Ângulo na tela (graus, horário a partir do "para cima") de uma direção do modelo. */
  screenAngle([dx, dy]) {
    const viewer = this.app.viewer, cam = viewer.camera, t = viewer.controls.target;
    const a = t.clone().project(cam), b = t.clone().add(new THREE.Vector3(dx, dy, 0)).project(cam);
    return Math.atan2(b.x - a.x, (b.y - a.y) * (viewer.aspect ? 1 / viewer.aspect : 1)) * 180 / Math.PI;
  }

  updateCompass() {
    const v = this.app.views.active;
    if (!v || this.app.viewer.renderOverride) { this.compass.hidden = true; return; }
    this.compass.hidden = false;
    const cur = this.forView(v);
    const at = this.screenAngle(northDir(this.norte)), av = this.screenAngle(northDir(cur.angulo));
    this.arrowTrue.setAttribute('transform', `rotate(${at.toFixed(1)})`);
    this.arrowView.setAttribute('transform', `rotate(${av.toFixed(1)})`);
    this.arrowView.style.display = cur.id === 'verdadeiro' ? 'none' : '';
    if (this.label.textContent !== cur.nome) this.label.textContent = cur.nome;
  }

  // ------------------------------------------------------------ diálogo

  dialog() {
    const g = this.geo ? { ...this.geo } : { lat: '', lon: '', alt: '' };
    const extras = this.extras.map(o => ({ ...o }));
    let norte = this.norte;
    const rows = h('tbody');
    const num = (val, on, attrs = {}) => h('input', { type: 'number', step: 'any', value: val, style: 'width:100%', ...attrs, onchange: e => on(e.target.value) });
    const draw = () => rows.replaceChildren(
      h('tr', {}, h('td', {}, 'Norte do projeto'), h('td', { class: 'muted small' }, '0° (eixo +Y)'), h('td')),
      h('tr', {}, h('td', {}, h('strong', {}, 'Norte verdadeiro')), h('td', {}, num(norte, x => { norte = Number(x) || 0; }, { title: 'Graus, no sentido horário, a partir do norte do projeto' })), h('td')),
      ...extras.map((o, i) => h('tr', {},
        h('td', {}, h('input', { value: o.nome, style: 'width:100%', onchange: e => { o.nome = e.target.value.trim() || 'Orientação'; } })),
        h('td', {}, num(o.angulo, x => { o.angulo = Number(x) || 0; })),
        h('td', {}, h('button', { class: 'icon-btn', title: 'Apagar a orientação', onclick: () => { extras.splice(i, 1); draw(); } }, '×')))));
    draw();
    const lat = num(g.lat, x => { g.lat = x; }, { placeholder: 'ex.: -23.550520' }), lon = num(g.lon, x => { g.lon = x; }, { placeholder: 'ex.: -46.633308' }), alt = num(g.alt, x => { g.alt = x; });
    modal({
      title: 'Orientações do projeto',
      body: h('div', { class: 'orient-dialog' },
        h('table', { class: 'slope-table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Orientação'), h('th', {}, 'Ângulo (° horário)'), h('th'))), rows),
        h('div', { class: 'row-buttons' }, h('button', { onclick: () => { extras.push({ id: `o${Date.now().toString(36)}`, nome: `Orientação ${extras.length + 1}`, angulo: 0 }); draw(); } }, '＋ Nova orientação')),
        h('h4', {}, 'Localização da origem (0, 0)'),
        h('table', { class: 'slope-table' },
          h('tr', {}, h('td', {}, 'Latitude (°)'), h('td', {}, lat)),
          h('tr', {}, h('td', {}, 'Longitude (°)'), h('td', {}, lon)),
          h('tr', {}, h('td', {}, 'Altitude (m)'), h('td', {}, alt))),
        h('div', { class: 'small muted' }, 'Cada vista escolhe a sua orientação na rosa dos ventos do canto da vista. Nas plantas, a vista gira para aquele norte ficar para cima.')),
      actions: [
        { label: 'Cancelar' },
        { label: 'Salvar', class: 'primary', action: () => {
          const hasGeo = String(g.lat).trim() !== '' && String(g.lon).trim() !== '';
          if (hasGeo && (!Number.isFinite(+g.lat) || !Number.isFinite(+g.lon) || Math.abs(+g.lat) > 90 || Math.abs(+g.lon) > 180)) { toast('Latitude/longitude inválidas.', 'error'); return false; }
          this.norte = norte;
          this.extras = extras;
          this.geo = hasGeo ? { lat: +g.lat, lon: +g.lon, alt: +g.alt || 0 } : null;
          for (const [vid, oid] of Object.entries(this.perView)) if (!this.all().some(o => o.id === oid)) delete this.perView[vid];
          this.save({ norte: this.norte, orientacoes: this.extras, geo: this.geo, orientacaoVistas: this.perView });
          this.applyCamera(this.app.views.active);
          return true;
        } },
      ],
    });
  }
}
