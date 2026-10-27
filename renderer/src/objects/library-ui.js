// Janela da biblioteca de Objetos e ferramenta de inserção com o mouse.
import * as THREE from 'three';
import { h, modal, toast, confirmDialog } from '../ui.js';
import { blankObject, isHostable } from './objects.js';
import { openObjectEditor } from './editor.js';
import { fmtElev } from '../levels.js';
import { fmtLen } from '../units.js';
import { editObjectMeta, iconView, CATEGORY_LABELS } from './meta-ui.js';
import { fillThumbnails } from './thumbs.js';

const B = window.boxbim;

// objeto de sistema → categoria de tipos com camadas
const TYPE_CAT = { parede: 'wall', laje: 'slab', pilar: 'column', viga: 'beam' };

/** Moeda formatada (R$ 1.234,56). */
export const money = (v, moeda = 'BRL') => (v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: moeda || 'BRL' }));

/**
 * Biblioteca de Objetos do projeto: miniatura, ícone, preço; busca e categoria. Os objetos do projeto são cópias
 * da biblioteca geral (editar aqui não muda outros projetos); "Publicar" leva a versão do projeto para a geral.
 */
export function openLibrary(app) {
  const grid = h('div', { class: 'lib-grid' });
  const search = h('input', { placeholder: 'Buscar objeto…', oninput: () => render() });
  const catSel = h('select', { onchange: () => render() });
  const cats = () => [...new Set(app.objects.items.map(o => o.category).filter(Boolean))].sort();
  const fillCats = () => {
    const cur = catSel.value;
    catSel.replaceChildren(h('option', { value: '' }, 'Todas as categorias'), ...cats().map(c => h('option', { value: c, selected: c === cur }, CATEGORY_LABELS[c] || c)));
  };
  const card = o => h('div', { class: 'lib-card' },
    h('div', { class: 'lib-thumb' }, o.miniatura ? h('img', { src: o.miniatura, alt: '' }) : iconView(o.icone, 'thumb-empty') || h('span', { class: 'thumb-empty' }, '▣')),
    h('div', { class: 'title' }, iconView(o.icone, 'obj-icon'), o.name,
      o.sistema ? h('span', { class: 'tag', title: 'Objeto de sistema (ferramenta própria)' }, 'sistema') : null,
      h('span', { class: `tag ${o.escopo === 'projeto' ? 'scope-proj' : ''}`, title: o.escopo === 'projeto' ? 'Cópia deste projeto' : 'Biblioteca geral' }, o.escopo === 'projeto' ? 'projeto' : 'geral')),
    h('div', { class: 'small muted' }, `${CATEGORY_LABELS[o.category] || o.category || '—'} · ${o.parameters.length} parâmetro(s)${o.broken ? ' · ⚠ inválido' : ''}`),
    h('div', { class: 'price' }, o.preco !== null && o.preco !== undefined ? `${money(o.preco, o.moeda)} / ${o.unidade || 'un'}` : h('span', { class: 'muted small' }, 'sem preço')),
    h('div', { class: 'actions' },
      h('button', { class: 'primary', disabled: !!o.broken, onclick: () => { dlg.close(); app.placeObject(o); } }, 'Inserir'),
      h('button', { disabled: !!o.broken, onclick: () => { dlg.close(); openObjectEditor(app, o); } }, 'Editar'),
      h('button', { onclick: async () => { if (await editObjectMeta(o)) { await app.objects.load(); render(); app.toolbars?.refresh(); } } }, 'Preço e ícone'),
      TYPE_CAT[o.sistema] ? h('button', { title: 'Tipos com camadas e materiais deste objeto', onclick: () => { dlg.close(); app.openTypes(TYPE_CAT[o.sistema]); } }, 'Tipos e camadas') : null,
      o.escopo === 'projeto' ? h('button', { title: 'Leva a versão deste projeto para a biblioteca geral', onclick: async () => {
        if (!(await confirmDialog(`Publicar "${o.name}" na biblioteca geral? Projetos que ainda não usam o objeto passam a receber esta versão.`, { ok: 'Publicar' }))) return;
        await B.objects.publish(o); toast('Publicado na biblioteca geral.');
      } }, 'Publicar') : null,
      h('button', { disabled: !!o.broken, onclick: async () => {
        const copy = { ...structuredClone(o), id: undefined, name: `${o.name} (cópia)`, sistema: undefined, miniatura: null };
        await app.objects.save(copy); render();
      } }, 'Duplicar'),
      h('button', { disabled: !!o.broken, onclick: async () => {
        const file = await B.dialog.save({ defaultPath: `${o.id}.bbo`, filters: [{ name: 'Objeto BoxBim', extensions: ['bbo'] }] });
        if (file) await app.objects.exportFile(o.id, file);
      } }, 'Exportar'),
      h('button', { class: 'danger', title: o.escopo === 'projeto' ? 'Tira a cópia do projeto (volta a valer a versão geral)' : 'Apaga da biblioteca geral', onclick: async () => {
        const msg = o.escopo === 'projeto'
          ? `Tirar a cópia de "${o.name}" deste projeto? Volta a valer a versão da biblioteca geral.`
          : `Apagar "${o.name}" da biblioteca geral? As instâncias já colocadas continuam no projeto.`;
        if (!(await confirmDialog(msg, { danger: true, ok: o.escopo === 'projeto' ? 'Tirar' : 'Apagar' }))) return;
        try { await app.objects.remove(o.id); render(); } catch (e) { toast(e.message, 'error'); }
      } }, o.escopo === 'projeto' ? 'Tirar do projeto' : 'Apagar')));
  const render = () => {
    fillCats();
    const q = search.value.trim().toLowerCase(), cat = catSel.value;
    const list = app.objects.items.filter(o => (!cat || o.category === cat) && (!q || o.name.toLowerCase().includes(q) || (o.description || '').toLowerCase().includes(q)));
    grid.replaceChildren(...(list.length ? list.map(card) : [h('div', { class: 'muted' }, 'Nenhum objeto. Crie um ou importe um arquivo .bbo.')]));
  };
  const dlg = modal({
    title: 'Biblioteca de Objetos',
    body: h('div', {},
      h('div', { class: 'lib-head' }, search, catSel, h('a', { href: '/biblioteca.html', target: '_blank', class: 'small' }, 'Biblioteca geral ↗')),
      h('div', { class: 'small muted', style: 'margin:6px 0 8px' }, 'Famílias paramétricas em JavaScript. O projeto guarda uma cópia de cada objeto que usa: preço, ícone e edições valem só aqui; "Publicar" leva para a biblioteca geral.'),
      grid),
    actions: [
      { label: 'Importar .bbo…', action: async () => { await importObjects(app); render(); return false; } },
      { label: 'Novo objeto', action: () => { openObjectEditor(app, blankObject()); } },
      { label: 'Fechar', class: 'primary' },
    ],
  });
  dlg.el.classList.add('wide');
  render();
  // miniaturas que faltam: desenhadas aqui mesmo, em segundo plano
  if (app.objects.items.some(o => !o.miniatura && !o.broken)) {
    fillThumbnails(app.objects, { onProgress: () => render() }).catch(() => {});
  }
}

export async function importObjects(app) {
  const files = await B.dialog.open({ multi: true, filters: [{ name: 'Objeto BoxBim', extensions: ['bbo'] }] });
  const names = [];
  for (const f of files) {
    try { names.push((await app.objects.importFile(f)).name); }
    catch (e) { toast(`${f.split(/[\\/]/).pop()}: ${e.message}`, 'error'); }
  }
  if (names.length) toast(`Importado(s): ${names.join(', ')}`);
  return names;
}

/**
 * Inserção com o mouse: a prévia segue o cursor no plano do nível; clique coloca; R ou Espaço gira 90°;
 * Esc sai. Vários cliques colocam várias instâncias.
 * Portas e janelas (objetos com vão) só são colocadas em paredes: a prévia gruda no eixo da parede sob o
 * cursor, vira para o lado do cursor e abre o vão ao colocar; R/Espaço invertem o lado.
 */
export class PlaceTool {
  constructor(app) { this.app = app; this.active = false; }

  async start(def, values = {}) {
    if (this.active) this.stop();
    if (this.app.wallTool.active) this.app.wallTool.stop();
    const v = this.app.views.active;
    if (v.kind === 'elevation') { toast('Para inserir objetos, abra uma planta ou a vista 3D.', 'error'); return; }
    this.def = def;
    this.values = values;
    this.level = this.app.views.activeLevel() || this.app.levels.list[0];
    this.rotation = 0;
    this.hostMode = isHostable(def);
    this.flipExtra = false;
    this._host = null;
    try { this.proto = await this.app.objects.createInstance(def, { values }); }
    catch (e) { toast(e.message, 'error'); return; }
    this.preview = this.proto.clone();
    this.preview.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.55; o.material.depthWrite = false; } });
    this.preview.visible = false;
    this.app.viewer.scene.add(this.preview);
    this.active = true;
    this.app.viewer.tool = this;
    const el = this.app.viewer.renderer.domElement;
    const c = this.app.viewer.controls;
    this._saved = { controls: c, buttons: { ...c.mouseButtons } };
    c.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: null };
    this._h = {
      move: e => this._move(e),
      down: e => { if (e.button === 0) this._place(e); else if (e.button === 2) this.stop(); },
      ctx: e => e.preventDefault(),
      key: e => {
        if (e.target.matches?.('input, select, textarea')) return;
        if (e.key === 'Escape') { e.preventDefault(); this.stop(); }
        if (e.key === 'r' || e.key === 'R' || e.key === ' ') {
          e.preventDefault();
          if (this.hostMode) this.flipExtra = !this.flipExtra; else this.rotation = (this.rotation + 90) % 360;
          this._move(this._last);
        }
      },
    };
    el.addEventListener('pointermove', this._h.move);
    el.addEventListener('pointerdown', this._h.down);
    el.addEventListener('contextmenu', this._h.ctx);
    document.addEventListener('keydown', this._h.key, true);
    el.style.cursor = 'crosshair';
    this.app.status(this.hostMode
      ? `Inserir "${def.name}": aponte para uma parede de ${this.level.name} e clique · R/Espaço inverte o lado · Esc sai.`
      : `Inserir "${def.name}" em ${this.level.name} (${fmtElev(this.level.elevation)}): clique para colocar · R/Espaço gira 90° · Esc sai.`);
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    const el = this.app.viewer.renderer.domElement;
    el.removeEventListener('pointermove', this._h.move);
    el.removeEventListener('pointerdown', this._h.down);
    el.removeEventListener('contextmenu', this._h.ctx);
    document.removeEventListener('keydown', this._h.key, true);
    el.style.cursor = '';
    this._saved.controls.mouseButtons = this._saved.buttons;
    this.app.viewer.scene.remove(this.preview);
    this.app.viewer.tool = null;
    this.app.status('Pronto.');
  }

  _point(e) {
    if (!e) return null;
    const el = this.app.viewer.renderer.domElement;
    const r = el.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.app.viewer.camera);
    const hit = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), -this.level.elevation), new THREE.Vector3());
    return hit ? [Math.round(hit.x * 100) / 100, Math.round(hit.y * 100) / 100] : null;
  }

  _move(e) {
    this._last = e;
    const p = this._point(e);
    if (!p) { this.preview.visible = false; return; }
    this.preview.visible = true;
    if (this.hostMode) {
      const hosting = this.app.hosting;
      const hit = hosting.findWall(p, this.level);
      const pose = hit && hosting.pose(hit.wall, hit.t, (hit.side < 0) !== this.flipExtra, this.proto.userData.bim.opening);
      this._host = pose ? { wall: hit.wall, offset: pose.offset, flip: (hit.side < 0) !== this.flipExtra } : null;
      if (pose) {
        this.preview.position.set(...pose.position);
        this.preview.rotation.z = pose.rotation * Math.PI / 180;
        this.app.status(`Na parede "${hit.wall.name}", centro do vão a ${fmtLen(pose.offset, { suffix: true })} do início · clique para colocar · R inverte o lado.`);
        return;
      }
      this.app.status(hit ? `O vão não cabe na parede "${hit.wall.name}".` : `Aponte para uma parede de ${this.level.name}.`);
    }
    this.preview.position.set(p[0], p[1], this.level.elevation);
    this.preview.rotation.z = this.rotation * Math.PI / 180;
  }

  async _place(e) {
    const p = this._point(e);
    if (!p) return;
    if (this.hostMode) {
      if (!this._host) { this.app.status(`"${this.def.name}" precisa de uma parede: aponte para uma parede e clique.`); return; }
      const { wall, offset, flip } = this._host;
      const inst = await this.app.placeHosted(this.def, this.values, wall, { offset, flip });
      this.app.status(`"${inst.name}" colocado na parede "${wall.name}". Clique para colocar outro · Esc sai.`);
      return;
    }
    const inst = await this.app.objects.createInstance(this.def, { values: this.values, position: [p[0], p[1], this.level.elevation], rotation: this.rotation, level: this.level });
    this.app.viewer.add(inst);
    this.app.refreshTree();
    this.app.status(`"${this.def.name}" colocado em (${p[0].toFixed(2)}; ${p[1].toFixed(2)}). Clique para colocar outro · Esc sai.`);
  }
}
