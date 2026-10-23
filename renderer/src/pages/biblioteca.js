// Biblioteca geral de Objetos: miniaturas, ícones e preços.
import '../web/api.js';
import { $, h, dialog, toast, fmtMoney, header } from './common.js';
import { ObjectLibrary } from '../objects/objects.js';
import { TypeLibrary } from '../types.js';
import { fillThumbnails, objectThumbnail } from '../objects/thumbs.js';
import { editObjectMeta, iconView, CATEGORY_LABELS } from '../objects/meta-ui.js';

const B = window.boxbim;
let lib;

async function load() {
  await lib.load();
  const cats = [...new Set(lib.items.map(o => o.category).filter(Boolean))].sort();
  const sel = $('#categoria');
  const cur = sel.value;
  sel.replaceChildren(h('option', { value: '' }, 'Todas as categorias'), ...cats.map(c => h('option', { value: c, selected: c === cur }, CATEGORY_LABELS[c] || c)));
  render();
}

function card(o) {
  return h('article', { class: 'card obj' },
    h('div', { class: 'thumb' }, o.miniatura ? h('img', { src: o.miniatura, alt: '' }) : iconView(o.icone, 'thumb-empty')),
    h('div', { class: 'card-body' },
      h('div', { class: 'card-title' }, iconView(o.icone, 'obj-icon'), o.name, o.sistema ? h('span', { class: 'tag' }, 'sistema') : null),
      h('div', { class: 'small muted' }, CATEGORY_LABELS[o.category] || o.category || ''),
      h('div', { class: 'price' }, o.preco !== null && o.preco !== undefined ? `${fmtMoney(o.preco, o.moeda)} / ${o.unidade}` : h('span', { class: 'muted small' }, 'sem preço')),
      o.description ? h('div', { class: 'small muted clamp' }, o.description) : null,
      h('div', { class: 'card-actions' },
        h('button', { class: 'mini', onclick: async () => { if (await editObjectMeta(o, { geral: true })) load(); } }, 'Preço e ícone'),
        h('button', { class: 'mini', onclick: async () => {
          try { const url = await objectThumbnail(lib, o); await B.objects.meta(o.id, { miniatura: url }, { geral: true }); load(); }
          catch (e) { toast(e.message, true); }
        } }, 'Refazer miniatura'))));
}

function render() {
  const q = $('#filtro').value.trim().toLowerCase();
  const cat = $('#categoria').value;
  const show = lib.items.filter(o => !o.broken && (!cat || o.category === cat) && (!q || o.name.toLowerCase().includes(q) || (o.description || '').toLowerCase().includes(q)));
  $('#lista').replaceChildren(...(show.length ? show.map(card) : [h('p', { class: 'muted' }, 'Nenhum objeto.')]));
}

async function main() {
  await header();
  const types = new TypeLibrary();
  await types.load();
  lib = new ObjectLibrary(types);
  await load();
  $('#filtro').addEventListener('input', render);
  $('#categoria').addEventListener('change', render);
  $('#miniaturas').addEventListener('click', async () => {
    const b = $('#miniaturas');
    b.disabled = true;
    const n = await fillThumbnails(lib, { onProgress: (i, t) => { b.textContent = `Gerando ${i}/${t}…`; } });
    b.disabled = false; b.textContent = 'Gerar miniaturas';
    toast(`${n} miniatura(s) gerada(s).`);
    load();
  });
  // primeira visita: desenha as que faltam
  if (lib.items.some(o => !o.miniatura && !o.broken)) $('#miniaturas').click();
}

main().catch(e => toast(e.message, true));
