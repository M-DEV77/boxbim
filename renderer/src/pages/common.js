// Utilidades das páginas fora do editor (projetos, biblioteca).
export const $ = s => document.querySelector(s);

export function h(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) if (c !== null && c !== undefined && c !== false) e.append(c instanceof Node ? c : String(c));
  return e;
}

export async function api(method, url, body) {
  const r = await fetch(url, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401) { location.href = `/login.html?volta=${encodeURIComponent(location.pathname)}`; throw new Error('Sessão expirada.'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.erro || `Erro ${r.status}`);
  return j;
}

/** Diálogo simples com campos; resolve com os valores ou null. */
export function dialog(title, fields, { ok = 'OK', danger = false, text = '' } = {}) {
  return new Promise(resolve => {
    const inputs = {};
    const close = v => { back.remove(); resolve(v); };
    const form = h('form', { class: 'dlg', onsubmit: e => { e.preventDefault(); close(Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value]))); } },
      h('h3', {}, title),
      text ? h('p', { class: 'muted' }, text) : null,
      fields.map(f => {
        const input = f.options
          ? h('select', { name: f.key }, f.options.map(o => h('option', { value: o.value, selected: o.value === f.value }, o.label)))
          : h(f.type === 'textarea' ? 'textarea' : 'input', { name: f.key, type: f.type || 'text', value: f.value ?? '', placeholder: f.placeholder || '' });
        if (f.type === 'textarea') input.value = f.value || '';
        inputs[f.key] = input;
        return h('label', {}, f.label, input);
      }),
      h('div', { class: 'dlg-actions' },
        h('button', { type: 'button', class: 'ghost', onclick: () => close(null) }, 'Cancelar'),
        h('button', { type: 'submit', class: danger ? 'danger' : 'primary' }, ok)));
    const back = h('div', { class: 'dlg-back', onclick: e => { if (e.target === back) close(null); } }, form);
    document.body.append(back);
    form.querySelector('input,select,textarea')?.focus();
  });
}

export function toast(msg, error = false) {
  const t = h('div', { class: `toast${error ? ' error' : ''}` }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 3500);
}

export const fmtDate = d => new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
export const fmtMoney = (v, moeda = 'BRL') => (v === null || v === undefined ? '' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: moeda || 'BRL' }));

export async function header() {
  const { usuario } = await api('GET', '/api/auth/eu');
  const u = $('#user');
  if (u) u.textContent = `${usuario.nome}${usuario.admin ? ' · administrador' : ''}`;
  $('#sair')?.addEventListener('click', async () => { await api('POST', '/api/auth/sair'); location.href = '/login.html'; });
  return usuario;
}
