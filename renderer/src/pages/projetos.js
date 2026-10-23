// Lista de projetos: meus (sou o dono) e compartilhados comigo; criar, renomear, duplicar, compartilhar, excluir.
import { $, h, api, dialog, toast, fmtDate, header } from './common.js';

let all = [];

async function load() {
  all = (await api('GET', '/api/projetos')).projetos;
  render();
}

function card(p) {
  const open = () => { location.href = `/app.html?projeto=${p.id}`; };
  const actions = [];
  if (p.papel === 'dono') {
    actions.push(h('button', { class: 'mini', title: 'Renomear', onclick: e => { e.stopPropagation(); rename(p); } }, 'Renomear'));
    actions.push(h('button', { class: 'mini', title: 'Convidar pessoas', onclick: e => { e.stopPropagation(); share(p); } }, 'Compartilhar'));
  }
  actions.push(h('button', { class: 'mini', title: 'Duplicar (você vira dono da cópia)', onclick: async e => { e.stopPropagation(); await api('POST', `/api/projetos/${p.id}/duplicar`); toast('Projeto duplicado.'); load(); } }, 'Duplicar'));
  if (p.papel === 'dono') actions.push(h('button', { class: 'mini danger', onclick: e => { e.stopPropagation(); remove(p); } }, 'Excluir'));
  else actions.push(h('button', { class: 'mini', onclick: async e => { e.stopPropagation(); await leave(p); } }, 'Sair'));
  return h('article', { class: 'card', onclick: open, title: 'Abrir' },
    h('div', { class: 'thumb' }, p.miniatura ? h('img', { src: p.miniatura, alt: '' }) : h('span', { class: 'thumb-empty' }, '⬡')),
    h('div', { class: 'card-body' },
      h('div', { class: 'card-title' }, p.nome, h('span', { class: `tag role-${p.papel}` }, p.papel)),
      p.descricao ? h('div', { class: 'small muted clamp' }, p.descricao) : null,
      h('div', { class: 'small muted' }, `${p.elementos ?? 0} elemento(s) · ${fmtDate(p.atualizadoEm)}${p.dono && p.papel !== 'dono' ? ` · dono: ${p.dono.nome}` : ''}`),
      h('div', { class: 'card-actions' }, actions)));
}

function render() {
  const q = $('#filtro').value.trim().toLowerCase();
  const show = all.filter(p => !q || p.nome.toLowerCase().includes(q) || (p.descricao || '').toLowerCase().includes(q));
  const mine = show.filter(p => p.papel === 'dono'), shared = show.filter(p => p.papel !== 'dono');
  $('#meus').replaceChildren(...(mine.length ? mine.map(card) : [h('p', { class: 'muted' }, q ? 'Nada encontrado.' : 'Nenhum projeto ainda. Crie o primeiro em "+ Novo projeto".')]));
  $('#compartilhados').replaceChildren(...(shared.length ? shared.map(card) : [h('p', { class: 'muted' }, 'Ninguém compartilhou um projeto com você ainda.')]));
}

async function create() {
  const v = await dialog('Novo projeto', [{ key: 'nome', label: 'Nome', value: 'Novo projeto' }, { key: 'descricao', label: 'Descrição', type: 'textarea' }], { ok: 'Criar e abrir', text: 'O projeto começa só com o Nível 0; os outros níveis você cria depois.' });
  if (!v) return;
  const { projeto } = await api('POST', '/api/projetos', v);
  location.href = `/app.html?projeto=${projeto.id}`;
}

async function rename(p) {
  const v = await dialog('Projeto', [{ key: 'nome', label: 'Nome', value: p.nome }, { key: 'descricao', label: 'Descrição', type: 'textarea', value: p.descricao }], { ok: 'Salvar' });
  if (!v) return;
  await api('PATCH', `/api/projetos/${p.id}`, v);
  load();
}

async function remove(p) {
  const v = await dialog(`Excluir "${p.nome}"?`, [{ key: 'confirma', label: 'Digite o nome do projeto para confirmar', value: '' }], { ok: 'Excluir', danger: true, text: 'Todos os elementos são apagados, também para quem participa. Não dá para desfazer.' });
  if (!v) return;
  if (v.confirma.trim() !== p.nome) return toast('O nome não confere; nada foi excluído.', true);
  await api('DELETE', `/api/projetos/${p.id}`);
  toast('Projeto excluído.');
  load();
}

async function leave(p) {
  const { usuario } = await api('GET', '/api/auth/eu');
  const v = await dialog(`Sair de "${p.nome}"?`, [], { ok: 'Sair do projeto', danger: true, text: 'O projeto some da sua lista; o dono pode convidar você de novo.' });
  if (!v) return;
  await api('DELETE', `/api/projetos/${p.id}/membros/${usuario.id}`);
  load();
}

async function share(p) {
  const v = await dialog(`Compartilhar "${p.nome}"`, [
    { key: 'email', label: 'E-mail de quem já tem conta', type: 'email' },
    { key: 'papel', label: 'Acesso', value: 'editor', options: [{ value: 'editor', label: 'Editor — modela junto' }, { value: 'leitor', label: 'Leitor — só vê' }] },
  ], { ok: 'Convidar' });
  if (!v) return;
  try { await api('POST', `/api/projetos/${p.id}/membros`, v); toast('Convidado.'); }
  catch (e) { toast(e.message, true); }
}

$('#novo').addEventListener('click', create);
$('#filtro').addEventListener('input', render);
header().then(load).catch(e => toast(e.message, true));
