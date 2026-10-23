// Janela "Tipos e camadas": tipos de parede, piso/laje, pilar e viga com camadas de material, e a biblioteca
// de materiais. Ao salvar, as instâncias no modelo são atualizadas (como a edição de tipos no Revit).
import { h, modal, toast, confirmDialog } from './ui.js';
import { CATEGORIES, FUNCTIONS } from './types.js';
import { refreshTypedElements } from './modeling.js';

export function openTypesEditor(app, startCat = 'wall') {
  const lib = app.types;
  // edita uma cópia; só grava ao salvar
  const work = { materials: structuredClone(lib.materials), types: structuredClone(lib.types), active: { ...lib.active } };
  let cat = startCat;
  let sel = work.types[cat].find(t => t.id === work.active[cat]) || work.types[cat][0];

  const left = h('div', {});
  const right = h('div', {});
  const matsBox = h('div', {});

  const total = t => t.layers.reduce((s, l) => s + (Number(l.thickness) || 0), 0);
  const isCore = (c, i) => (c === 'column' || c === 'beam') && i === 0;

  function renderLeft() {
    left.innerHTML = '';
    left.append(h('div', { class: 'cats' }, Object.entries(CATEGORIES).map(([k, c]) =>
      h('button', { class: k === cat ? 'active' : '', onclick: () => { cat = k; sel = work.types[k].find(t => t.id === work.active[k]) || work.types[k][0]; renderAll(); } }, c.label))));
    left.append(h('div', { class: 'list' }, work.types[cat].map(t => h('div', {
      class: `item${t === sel ? ' active' : ''}`, onclick: () => { sel = t; renderAll(); },
    }, h('div', {}, h('div', { class: 'title' }, t.name), h('div', { class: 'desc' }, `${(total(t) * 100).toFixed(1).replace('.', ',')} cm · ${t.layers.length} camada(s)`)),
    t.id === work.active[cat] ? h('span', { class: 'badge' }, 'padrão') : null))));
    left.append(h('div', { style: 'display:flex;gap:4px;margin-top:8px;flex-wrap:wrap' },
      h('button', { class: 'mini', onclick: () => {
        const t = { name: `Novo tipo ${work.types[cat].length + 1}`, layers: structuredClone(sel?.layers || [{ name: 'Camada', material: 'Genérico', thickness: 0.1, function: 'estrutura' }]) };
        t.id = `${cat}-${Date.now().toString(36)}`;
        work.types[cat].push(t); sel = t; renderAll();
      } }, '+ Novo'),
      h('button', { class: 'mini', onclick: () => {
        const t = { ...structuredClone(sel), id: `${cat}-${Date.now().toString(36)}`, name: `${sel.name} (cópia)` };
        work.types[cat].push(t); sel = t; renderAll();
      } }, 'Duplicar'),
      h('button', { class: 'mini', onclick: () => { work.active[cat] = sel.id; renderAll(); } }, 'Tornar padrão'),
      h('button', { class: 'mini danger', onclick: async () => {
        if (work.types[cat].length <= 1) return toast('Cada categoria precisa de pelo menos um tipo.', 'error');
        if (!(await confirmDialog(`Apagar o tipo "${sel.name}"? Elementos com ele ficam com as camadas atuais.`, { danger: true, ok: 'Apagar' }))) return;
        work.types[cat] = work.types[cat].filter(t => t !== sel);
        if (work.active[cat] === sel.id) work.active[cat] = work.types[cat][0].id;
        sel = work.types[cat][0]; renderAll();
      } }, 'Apagar')));
  }

  function diagram(t) {
    const vertical = cat === 'slab';
    const T = total(t) || 1;
    return h('div', { class: `layer-diagram${vertical ? ' vertical' : ''}` }, t.layers.map((l, i) => {
      const color = work.materials[l.material]?.color || '#cccccc';
      const share = isCore(cat, i) ? 0.5 : (Number(l.thickness) || 0) / T * (cat === 'column' || cat === 'beam' ? 0.5 : 1);
      return h('div', { title: `${l.name} — ${l.material} — ${(l.thickness * 100).toFixed(1)} cm`, style: `background:${color};${vertical ? 'height' : 'width'}:${Math.max(share * 100, 2)}%;${vertical ? 'min-height:12px' : ''}` },
        share > 0.12 ? l.name : '');
    }));
  }

  function renderRight() {
    right.innerHTML = '';
    if (!sel) return;
    const name = h('input', { value: sel.name, oninput: e => { sel.name = e.target.value; renderLeft(); } });
    const rows = sel.layers.map((l, i) => {
      const mat = h('select', { onchange: e => { l.material = e.target.value; renderRight(); } },
        Object.keys(work.materials).map(m => h('option', { value: m, selected: m === l.material }, m)));
      const thick = h('input', { type: 'number', step: '0.1', min: 0, value: +(l.thickness * 100).toFixed(2), disabled: isCore(cat, i), title: isCore(cat, i) ? 'O núcleo usa as dimensões da instância' : 'Espessura em centímetros',
        onchange: e => { l.thickness = Math.max(0, Number(e.target.value) || 0) / 100; renderAll(); } });
      const fn = h('select', { onchange: e => { l.function = e.target.value; } }, FUNCTIONS.map(f => h('option', { value: f, selected: f === l.function }, f)));
      const move = d => () => { const j = i + d; if (j < 0 || j >= sel.layers.length) return; [sel.layers[i], sel.layers[j]] = [sel.layers[j], sel.layers[i]]; renderAll(); };
      return h('div', { class: 'layer-row' },
        h('input', { value: l.name, oninput: e => { l.name = e.target.value; } }), mat, thick, fn,
        h('button', { title: 'Subir', onclick: move(-1) }, '↑'), h('button', { title: 'Descer', onclick: move(1) }, '↓'),
        h('button', { class: 'danger', title: 'Remover', onclick: () => { if (sel.layers.length > 1) { sel.layers.splice(i, 1); renderAll(); } } }, '✕'));
    });
    right.append(
      h('div', { class: 'form' }, h('label', {}, 'Nome do tipo', name)),
      h('div', { class: 'section-title' }, `Camadas (${CATEGORIES[cat].order})`, h('span', { class: 'spacer' }),
        h('span', { class: 'muted small' }, `total ${(total(sel) * 100).toFixed(1).replace('.', ',')} cm`)),
      h('div', { class: 'layer-row head' }, 'camada', 'material', 'cm', 'função', '', '', ''),
      ...rows,
      h('button', { class: 'mini', style: 'margin-top:4px', onclick: () => { sel.layers.push({ name: 'Nova camada', material: 'Genérico', thickness: 0.02, function: 'acabamento' }); renderAll(); } }, '+ Camada'),
      h('div', { class: 'section-title' }, 'Seção'), diagram(sel),
      h('div', { class: 'section-title' }, 'Materiais'), matsBox);
    renderMaterials();
  }

  function renderMaterials() {
    matsBox.innerHTML = '';
    for (const [name, m] of Object.entries(work.materials)) {
      matsBox.append(h('div', { class: 'mat-row' },
        h('span', {}, name),
        h('input', { type: 'color', value: m.color, oninput: e => { m.color = e.target.value; renderLeft(); } }),
        h('input', { type: 'number', min: 0.05, max: 1, step: 0.05, value: m.opacity ?? 1, title: 'Opacidade', onchange: e => { m.opacity = Math.min(1, Math.max(0.05, Number(e.target.value) || 1)); } }),
        h('button', { class: 'mini danger', title: 'Apagar material', onclick: () => {
          const used = Object.values(work.types).flat().some(t => t.layers.some(l => l.material === name));
          if (used) return toast(`"${name}" está em uso em algum tipo.`, 'error');
          delete work.materials[name]; renderMaterials();
        } }, '✕')));
    }
    const newName = h('input', { placeholder: 'Novo material' });
    const newColor = h('input', { type: 'color', value: '#bbbbbb' });
    matsBox.append(h('div', { class: 'mat-row' }, newName, newColor, h('span'), h('button', { class: 'mini', onclick: () => {
      const n = newName.value.trim();
      if (!n || work.materials[n]) return toast('Informe um nome de material novo.', 'error');
      work.materials[n] = { color: newColor.value };
      renderAll();
    } }, '+')));
  }

  function renderAll() { renderLeft(); renderRight(); }

  const dlg = modal({
    title: 'Tipos e camadas',
    body: h('div', { class: 'types-ui' }, left, right),
    actions: [
      { label: 'Cancelar' },
      { label: 'Salvar', class: 'primary', action: async () => {
        for (const list of Object.values(work.types)) for (const t of list) if (!t.name.trim()) { toast('Há tipo sem nome.', 'error'); return false; }
        lib.materials = work.materials;
        lib.types = work.types;
        lib.active = work.active;
        lib._mats.clear();
        await lib.save();
        const n = refreshTypedElements(app.viewer);
        // paredes com vãos: portas/janelas hospedadas acompanham a nova espessura
        for (const w of app.hosting.walls()) if (w.userData.bim.wall.openings?.length) await app.hosting.refreshHostedOf(w);
        app.viewer.changed();
        app.refreshTree();
        app.renderProps();
        toast(`Tipos salvos${n ? ` · ${n} elemento(s) atualizado(s) no projeto` : ''}.`);
      } },
    ],
  });
  dlg.el.classList.add('wide');
  renderAll();
}
