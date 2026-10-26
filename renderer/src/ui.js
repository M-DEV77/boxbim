// Pequenos utilitários de interface: toasts, menus suspensos, modais, formulários e Markdown.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function toast(msg, type = 'info', ms = 4500) {
  const el = h('div', { class: `toast ${type}` }, msg);
  $('#toasts').append(el);
  setTimeout(() => el.remove(), type === 'error' ? ms * 2 : ms);
}

// ---------------------------------------------------------------- menu suspenso

let openMenu = null;
export function closeMenu() {
  openMenu?.el.remove();
  openMenu?.anchor.classList.remove('open');
  openMenu = null;
}
document.addEventListener('pointerdown', e => { if (openMenu && !openMenu.el.contains(e.target) && e.target !== openMenu.anchor) closeMenu(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });

/** items: [{ label, hint, icon (svg), action }] ou '-' para separador */
export function dropdown(anchor, items) {
  if (openMenu?.anchor === anchor) return closeMenu();
  closeMenu();
  const el = h('div', { class: 'dropdown' }, items.map(it => it === '-' ? h('hr') :
    h('button', { disabled: it.disabled, onclick: () => { closeMenu(); it.action(); } },
      it.icon ? h('span', { class: 'dd-ico', html: it.icon }) : null, it.label, it.hint ? h('span', { class: 'hint' }, it.hint) : null)));
  const r = anchor.getBoundingClientRect();
  el.style.left = `${Math.min(r.left, innerWidth - 300)}px`;
  el.style.top = `${r.bottom + 4}px`;
  $('#menu-root').append(el);
  anchor.classList.add('open');
  openMenu = { el, anchor };
}

// ---------------------------------------------------------------- modal

export function modal({ title, body, actions = [], small = false, onClose }) {
  const back = h('div', { class: 'modal-back' });
  const close = () => { back.remove(); onClose?.(); };
  const box = h('div', { class: `modal${small ? ' small' : ''}` },
    h('header', {}, title, h('button', { class: 'ghost', onclick: close }, '✕')),
    h('div', { class: 'body' }, body),
    actions.length ? h('footer', {}, actions.map(a => h('button', { class: a.class || '', onclick: async () => { if ((await a.action?.()) !== false) close(); } }, a.label))) : null);
  back.append(box);
  back.addEventListener('pointerdown', e => { if (e.target === back) close(); });
  $('#modal-root').append(back);
  return { close, el: box };
}

export function confirmDialog(text, { ok = 'Confirmar', danger = false } = {}) {
  return new Promise(resolve => {
    let done = false;
    modal({
      title: 'Confirmar', small: true, body: h('div', {}, text),
      actions: [{ label: 'Cancelar', action: () => { done = true; resolve(false); } },
        { label: ok, class: danger ? 'danger' : 'primary', action: () => { done = true; resolve(true); } }],
      onClose: () => { if (!done) resolve(false); },
    });
  });
}

/**
 * Formulário simples. fields: [{ key, label, type: 'number'|'text'|'checkbox'|'select'|'textarea', value, options }]
 * Retorna Promise com os valores ou null se cancelado.
 */
export function formDialog(title, fields, { ok = 'OK' } = {}) {
  return new Promise(resolve => {
    const inputs = {};
    const body = h('div', { class: 'form' }, fields.map(f => {
      let input;
      if (f.type === 'select') input = h('select', {}, f.options.map(o => h('option', { value: o.value ?? o, selected: (o.value ?? o) === f.value }, o.label ?? o)));
      else if (f.type === 'textarea') input = h('textarea', {}, f.value ?? '');
      else if (f.type === 'checkbox') input = h('input', { type: 'checkbox', checked: !!f.value });
      else input = h('input', { type: f.type || 'text', value: f.value ?? '', step: f.step || 'any' });
      inputs[f.key] = input;
      return f.type === 'checkbox' ? h('label', { class: 'inline' }, input, f.label) : h('label', {}, f.label, input);
    }));
    let done = false;
    modal({
      title, small: true, body,
      actions: [{ label: 'Cancelar', action: () => { done = true; resolve(null); } },
        { label: ok, class: 'primary', action: () => {
          const out = {};
          for (const f of fields) {
            const el = inputs[f.key];
            out[f.key] = f.type === 'checkbox' ? el.checked : f.type === 'number' ? Number(el.value) : el.value;
          }
          done = true; resolve(out);
        } }],
      onClose: () => { if (!done) resolve(null); },
    });
    setTimeout(() => body.querySelector('input,select,textarea')?.focus(), 30);
  });
}

// ---------------------------------------------------------------- Markdown (subconjunto)

export function markdown(src) {
  const blocks = [];
  let s = String(src || '').replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    blocks.push(`<pre><code class="lang-${esc(lang)}">${esc(code.replace(/\n$/, ''))}</code></pre>`);
    return `\u0000${blocks.length - 1}\u0000`;
  });
  s = esc(s);
  const inline = t => t
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank">$1</a>');
  const out = [];
  let list = null, table = null;
  const flush = () => {
    if (list) { out.push(`<${list.tag}>${list.items.map(i => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`); list = null; }
    if (table) {
      const rows = table.filter(r => !/^\s*\|?\s*:?-{2,}/.test(r)).map(r => r.replace(/^\s*\||\|\s*$/g, '').split('|').map(c => inline(c.trim())));
      out.push(`<table>${rows.map((r, i) => `<tr>${r.map(c => i ? `<td>${c}</td>` : `<th>${c}</th>`).join('')}</tr>`).join('')}</table>`);
      table = null;
    }
  };
  for (const line of s.split('\n')) {
    let m;
    if ((m = /^\u0000(\d+)\u0000$/.exec(line.trim()))) { flush(); out.push(blocks[+m[1]]); continue; }
    if (/^\s*\|.*\|\s*$/.test(line)) { if (list) flush(); (table ||= []).push(line); continue; }
    if ((m = /^(#{1,4})\s+(.*)$/.exec(line))) { flush(); out.push(`<h${Math.min(3, m[1].length)}>${inline(m[2])}</h${Math.min(3, m[1].length)}>`); continue; }
    if ((m = /^\s*[-*]\s+(.*)$/.exec(line))) { if (table || list?.tag === 'ol') flush(); (list ||= { tag: 'ul', items: [] }).items.push(m[1]); continue; }
    if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) { if (table || list?.tag === 'ul') flush(); (list ||= { tag: 'ol', items: [] }).items.push(m[1]); continue; }
    flush();
    if (line.trim()) out.push(`<p>${inline(line).replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[+i])}</p>`);
  }
  flush();
  return out.join('');
}
