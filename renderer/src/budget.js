// ORÇAMENTO: quantidade × preço dos Objetos do projeto.
// A quantidade de cada instância vem da unidade do preço:
//   un, kg, cj, h ... contagem
//   m .............. comprimento (paredes e vigas pelo eixo; outros: maior dimensão)
//   m² ............. área (laje: contorno; parede: comprimento × altura; outros: área em planta)
//   m³ ............. volume (pelos dados de modelagem; outros: caixa envolvente)
import * as THREE from 'three';
import { h, modal } from './ui.js';
import { money } from './objects/library-ui.js';

const len2 = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const polyArea = pts => Math.abs(pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;

/** Quantidade de uma instância na unidade dada. */
export function quantityOf(el, unidade = 'un') {
  const b = el.userData.bim;
  const box = new THREE.Box3().setFromObject(el);
  const size = box.isEmpty() ? new THREE.Vector3() : box.getSize(new THREE.Vector3());
  if (unidade === 'm') {
    if (b.wall) return len2(b.wall.start, b.wall.end);
    if (b.beam) return len2(b.beam.start, b.beam.end);
    if (b.column) return b.column.height;
    return Math.max(size.x, size.y, size.z);
  }
  if (unidade === 'm²') {
    if (b.slab) return polyArea(b.slab.points);
    if (b.wall) return len2(b.wall.start, b.wall.end) * b.wall.height;
    if (b.box) return b.box.size[0] * b.box.size[1];
    return size.x * size.y;
  }
  if (unidade === 'm³') {
    if (b.slab) return polyArea(b.slab.points) * (b.slab.thickness || 0);
    if (b.wall) return len2(b.wall.start, b.wall.end) * b.wall.height * (b.wall.thickness || 0);
    if (b.column) return (b.column.round ? Math.PI * (b.column.width / 2) ** 2 : b.column.width * b.column.depth) * b.column.height;
    if (b.beam) return len2(b.beam.start, b.beam.end) * b.beam.width * b.beam.height;
    if (b.box) return b.box.size[0] * b.box.size[1] * b.box.size[2];
    return size.x * size.y * size.z;
  }
  return 1;
}

const fmtQ = (q, u) => `${(Math.round(q * 100) / 100).toLocaleString('pt-BR')} ${u}`;

/** Linhas do orçamento agrupadas por objeto. */
export function budgetRows(app) {
  const rows = new Map();
  for (const el of app.viewer.elements()) {
    const b = el.userData.bim;
    const def = b.objectId && (app.objects.get(b.objectId) || app.objects.get(b.objectName));
    if (!def) continue;
    const u = def.unidade || 'un';
    const r = rows.get(def.id) || { def, unidade: u, qtd: 0, n: 0 };
    r.qtd += quantityOf(el, u);
    r.n++;
    rows.set(def.id, r);
  }
  return [...rows.values()].map(r => ({ ...r, total: r.def.preco !== null && r.def.preco !== undefined ? r.qtd * Number(r.def.preco) : null }))
    .sort((a, b) => (b.total ?? -1) - (a.total ?? -1));
}

export function openBudget(app) {
  const rows = budgetRows(app);
  const moeda = rows.find(r => r.def.moeda)?.def.moeda || 'BRL';
  const total = rows.reduce((s, r) => s + (r.total || 0), 0);
  const semPreco = rows.filter(r => r.total === null);
  const csv = () => {
    const lines = [['Objeto', 'Categoria', 'Instâncias', 'Quantidade', 'Unidade', 'Preço unitário', 'Total'].join(';')];
    for (const r of rows) lines.push([r.def.name, r.def.category || '', r.n, String(Math.round(r.qtd * 100) / 100).replace('.', ','), r.unidade, r.def.preco ?? '', r.total === null ? '' : String(Math.round(r.total * 100) / 100).replace('.', ',')].join(';'));
    lines.push(['Total', '', '', '', '', '', String(Math.round(total * 100) / 100).replace('.', ',')].join(';'));
    window.boxbim.download(`orcamento-${(app.project?.info?.nome || 'projeto').replace(/[^\w-]+/g, '_')}.csv`, '﻿' + lines.join('\r\n'));
  };
  modal({
    title: `Orçamento — ${app.project?.info?.nome || 'projeto'}`,
    body: h('div', {},
      rows.length ? h('table', { class: 'budget' },
        h('tr', {}, h('th', {}, 'Objeto'), h('th', {}, 'Inst.'), h('th', {}, 'Quantidade'), h('th', {}, 'Preço unit.'), h('th', {}, 'Total')),
        rows.map(r => h('tr', { class: r.total === null ? 'muted' : '' },
          h('td', {}, r.def.name), h('td', { class: 'num' }, r.n), h('td', { class: 'num' }, fmtQ(r.qtd, r.unidade)),
          h('td', { class: 'num' }, r.def.preco !== null && r.def.preco !== undefined ? `${money(r.def.preco, r.def.moeda)}/${r.unidade}` : '—'),
          h('td', { class: 'num' }, r.total === null ? '—' : money(r.total, r.def.moeda)))),
        h('tr', { class: 'total' }, h('td', { colspan: 4 }, 'Total'), h('td', { class: 'num' }, money(total, moeda))))
        : h('div', { class: 'muted' }, 'Nenhum objeto no projeto ainda.'),
      semPreco.length ? h('div', { class: 'small muted', style: 'margin-top:8px' }, `Sem preço: ${semPreco.map(r => r.def.name).join(', ')} — defina em Biblioteca › Preço e ícone.`) : null),
    actions: [{ label: 'Baixar CSV', action: () => { csv(); return false; } }, { label: 'Fechar', class: 'primary' }],
  });
}
