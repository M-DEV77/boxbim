// EDITOR DE TEXTURAS: cria e edita as texturas procedurais próprias do projeto (materials.js › camadas de
// geradores). À esquerda a lista e os modelos; no meio a amostra colorida e os mapas gerados; à direita a pilha
// de camadas. Edita uma cópia (a amostra já usa a cópia); ao salvar, grava na biblioteca de tipos do projeto.
import { h, modal, toast } from './ui.js';
import {
  GENERATORS, LAYER_PARAMS, CHANNELS, BLEND, TEXTURE_TEMPLATES, normalizeTexture, setCustomTextures, mapThumbnail,
} from './materials.js';

const PREVIEW_MAPS = { cor: 'Cor', deslocamento: 'Altura', normal: 'Normal', ao: 'Oclusão', rugosidade: 'Rugosidade', metal: 'Metal', opacidade: 'Opacidade', relevo: 'Detalhe' };

const newId = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function openTextureEditor(app, startId, { onSaved } = {}) {
  const lib = app.types;
  const work = structuredClone(lib.textures || {});
  let id = work[startId] ? startId : Object.keys(work)[0] || null;
  let tint = '#b8693a', useIn = '';

  const listBox = h('div', { class: 'me-list' });
  const previewBox = h('div', { class: 'te-preview' });
  const mapsBox = h('div', { class: 'me-maps' });
  const layersBox = h('div', { class: 'me-controls' });

  // a amostra usa as texturas em edição (o registro volta ao original se cancelar)
  let timer;
  const refresh = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { setCustomTextures({ ...lib.textures, ...work }); renderPreview(); }, 200);
  };

  function renderList() {
    listBox.innerHTML = '';
    for (const [tid, t] of Object.entries(work)) {
      listBox.append(h('div', { class: `me-item${tid === id ? ' active' : ''}`, onclick: () => { id = tid; renderAll(); } },
        h('span', {}, '★'), h('span', {}, t.nome), h('span', { class: 'muted' }, `${t.camadas.length} cam.`)));
    }
    if (!Object.keys(work).length) listBox.append(h('div', { class: 'muted', style: 'font-size:12px;margin:6px 0' }, 'Nenhuma textura própria ainda.'));
    const tpl = h('select', {}, Object.entries(TEXTURE_TEMPLATES).map(([k, t]) => h('option', { value: k }, k === 'vazia' ? 'Em branco' : t.nome)));
    listBox.append(
      h('div', { class: 'muted', style: 'font-size:11px;margin-top:10px' }, 'Nova a partir de:'),
      h('div', { class: 'me-new' }, tpl, h('button', { class: 'mini', onclick: () => {
        const nid = newId();
        work[nid] = normalizeTexture(structuredClone(TEXTURE_TEMPLATES[tpl.value]));
        id = nid; renderAll(); refresh();
      } }, '+')),
      id ? h('div', { class: 'me-new' },
        h('button', { class: 'mini', onclick: () => { const nid = newId(); work[nid] = { ...structuredClone(work[id]), nome: `${work[id].nome} (cópia)` }; id = nid; renderAll(); refresh(); } }, 'Duplicar'),
        h('button', { class: 'mini danger', onclick: () => {
          const users = Object.entries(lib.materials).filter(([, m]) => m.render?.textura === `tx:${id}`).map(([n]) => n);
          if (users.length) return toast(`Em uso nos materiais: ${users.join(', ')}.`, 'error');
          delete work[id]; id = Object.keys(work)[0] || null; renderAll(); refresh();
        } }, 'Apagar')) : null);
  }

  function renderPreview() {
    previewBox.innerHTML = '';
    mapsBox.innerHTML = '';
    if (!id) return;
    const kind = `tx:${id}`;
    // amostra: o mapa de cor (tom) multiplicado pela cor de teste, 2 × 2 repetições, com o relevo do normal
    const cor = mapThumbnail(kind, 'cor', 128), nrm = mapThumbnail(kind, 'normal', 128), ao = mapThumbnail(kind, 'ao', 128), op = mapThumbnail(kind, 'opacidade', 128);
    const S = 256, cv = h('canvas', { width: S, height: S, class: 'te-swatch', title: 'Amostra: 2 × 2 repetições com a cor de teste, luz de cima à esquerda' });
    const ctx = cv.getContext('2d'), out = ctx.createImageData(S, S);
    const px = c => c.getContext('2d').getImageData(0, 0, 128, 128).data;
    const C = px(cor), N = px(nrm), A = px(ao), O = px(op);
    const t = [1, 3, 5].map(i => parseInt(tint.slice(i, i + 2), 16) / 255);
    const L = [-0.5, 0.5, 0.7], Ll = Math.hypot(...L);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = ((y % 128) * 128 + (x % 128)) * 4, o = (y * S + x) * 4;
      const nx = N[i] / 127.5 - 1, ny = N[i + 1] / 127.5 - 1, nz = N[i + 2] / 127.5 - 1;
      const lam = Math.max(0, (nx * L[0] + ny * L[1] + nz * L[2]) / Ll) * 0.75 + 0.3;
      const a = A[i] / 255, g = (C[i] / 255) * lam * a;
      const hole = O[i] < 128;
      out.data[o] = hole ? 30 : 255 * Math.min(1, t[0] * g * 1.3);
      out.data[o + 1] = hole ? 32 : 255 * Math.min(1, t[1] * g * 1.3);
      out.data[o + 2] = hole ? 36 : 255 * Math.min(1, t[2] * g * 1.3);
      out.data[o + 3] = 255;
    }
    ctx.putImageData(out, 0, 0);
    previewBox.append(cv, h('label', { class: 'me-row', style: 'grid-template-columns:110px 1fr' }, h('span', {}, 'Cor de teste'),
      h('input', { type: 'color', value: tint, oninput: e => { tint = e.target.value; renderPreview(); } })));
    for (const [k, label] of Object.entries(PREVIEW_MAPS)) mapsBox.append(h('figure', { class: 'me-map', title: label }, mapThumbnail(kind, k), h('figcaption', {}, label)));
  }

  function renderLayers() {
    layersBox.innerHTML = '';
    if (!id) { layersBox.append(h('div', { class: 'muted' }, 'Crie uma textura a partir de um modelo à esquerda.')); return; }
    const t = work[id];
    // edita no lugar (os controles guardam a camada); ao refazer a tela, completa os parâmetros do gerador
    const changed = (rebuild = false) => {
      if (rebuild) Object.assign(t, normalizeTexture(t), { nome: t.nome });
      refresh();
      if (rebuild) renderLayers();
      renderList();
    };
    layersBox.append(
      h('div', { class: 'me-title' }, h('input', { value: t.nome, style: 'flex:1', title: 'Nome da textura', oninput: e => { t.nome = e.target.value; changed(); } })),
      h('label', { class: 'me-row', title: 'Ao salvar, este material passa a usar a textura' }, h('span', {}, 'Usar no material'),
        h('select', { onchange: e => { useIn = e.target.value; } }, h('option', { value: '' }, '—'),
          Object.keys(lib.materials).map(n => h('option', { value: n, selected: n === useIn }, n))), h('span')),
      h('div', { class: 'muted', style: 'font-size:11px;margin:4px 0 8px' },
        'As camadas valem de cima para baixo sobre: tom 1, altura 1, rugosidade 1, metal 0, opacidade 1. Cada camada gera um valor de 0 a 1, remapeado de "De" a "Até", e escreve nos canais marcados.'));
    t.camadas.forEach((c, i) => {
      const move = d => { const j = i + d; if (j < 0 || j >= t.camadas.length) return; [t.camadas[i], t.camadas[j]] = [t.camadas[j], t.camadas[i]]; changed(true); };
      const g = GENERATORS[c.gerador];
      const rows = g.params.map(p => {
        const d = LAYER_PARAMS[p];
        if (d.options) {
          return h('label', { class: 'me-row' }, h('span', {}, d.label), h('select', { onchange: e => { c[p] = e.target.value; changed(); } },
            Object.entries(d.options).map(([k, l]) => h('option', { value: k, selected: k === c[p] }, l))), h('span'));
        }
        const val = h('input', { type: 'number', min: d.min, max: d.max, step: d.step, value: c[p], class: 'te-num' });
        const rng = h('input', { type: 'range', min: d.min, max: d.max, step: d.step, value: c[p] });
        rng.addEventListener('input', () => { val.value = rng.value; c[p] = Number(rng.value); changed(); });
        val.addEventListener('change', () => { rng.value = val.value; c[p] = Number(val.value); changed(); });
        return h('label', { class: 'me-row' }, h('span', {}, d.label), rng, val);
      });
      const chans = h('div', { class: 'te-chans' }, Object.entries(CHANNELS).map(([k, l]) => h('label', {},
        h('input', { type: 'checkbox', checked: c.canais.includes(k), onchange: e => { c.canais = e.target.checked ? [...c.canais, k] : c.canais.filter(x => x !== k); changed(); } }), l)));
      const numIn = (k, label) => h('label', { class: 'te-mini' }, label, h('input', { type: 'number', step: 0.05, value: c[k], class: 'te-num', onchange: e => { c[k] = Number(e.target.value); changed(); } }));
      const forca = h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: c.forca, oninput: e => { c.forca = Number(e.target.value); changed(); } });
      layersBox.append(h('fieldset', { class: 'me-sec' },
        h('legend', {}, `${i + 1}`),
        h('div', { class: 'te-head' },
          h('input', { value: c.nome || '', placeholder: g.label, title: 'Nome da camada', oninput: e => { c.nome = e.target.value; changed(); } }),
          h('button', { class: 'mini', title: 'Subir', onclick: () => move(-1) }, '↑'),
          h('button', { class: 'mini', title: 'Descer', onclick: () => move(1) }, '↓'),
          h('button', { class: 'mini', title: 'Duplicar camada', onclick: () => { t.camadas.splice(i + 1, 0, structuredClone(c)); changed(true); } }, '⧉'),
          h('button', { class: 'mini danger', title: 'Apagar camada', onclick: () => { t.camadas.splice(i, 1); changed(true); } }, '✕')),
        h('label', { class: 'me-row' }, h('span', {}, 'Gerador'), h('select', { onchange: e => { c.gerador = e.target.value; changed(true); } },
          Object.entries(GENERATORS).map(([k, v]) => h('option', { value: k, selected: k === c.gerador }, v.label))), h('span')),
        ...rows,
        chans,
        h('div', { class: 'te-blend' },
          h('label', { class: 'te-mini' }, 'Modo', h('select', { onchange: e => { c.modo = e.target.value; changed(); } },
            Object.entries(BLEND).map(([k, l]) => h('option', { value: k, selected: k === c.modo }, l)))),
          numIn('de', 'De'), numIn('ate', 'Até'),
          h('label', { class: 'te-mini' }, h('input', { type: 'checkbox', checked: c.inverter, onchange: e => { c.inverter = e.target.checked; changed(); } }), 'Inverter')),
        h('label', { class: 'me-row' }, h('span', {}, 'Força'), forca, h('span'))));
    });
    layersBox.append(h('button', { class: 'mini', onclick: () => { t.camadas.push({ gerador: 'ruido', canais: ['tom'], de: 0.9, ate: 1 }); changed(true); } }, '+ Camada'));
  }

  function renderAll() { renderList(); renderLayers(); renderPreview(); }

  let saved = false;
  const dlg = modal({
    title: 'Editor de texturas procedurais',
    body: h('div', { class: 'mat-editor te-editor' }, listBox, h('div', { class: 'me-center' }, previewBox, mapsBox), layersBox),
    actions: [
      { label: 'Cancelar' },
      { label: 'Salvar', class: 'primary', action: async () => {
        for (const [tid, t] of Object.entries(work)) work[tid] = normalizeTexture(t);
        lib.textures = work;
        if (useIn && id && lib.materials[useIn]) lib.materials[useIn].render = { ...(lib.materials[useIn].render || {}), textura: `tx:${id}` };
        saved = true;
        await lib.save(); // registra as texturas e avisa o Render/Textura (que refazem os materiais)
        app.renderProps();
        toast(useIn ? `Texturas salvas; "${useIn}" usa "${work[id].nome}".` : 'Texturas salvas.');
        onSaved?.(id);
      } },
    ],
    onClose: () => { clearTimeout(timer); if (!saved) setCustomTextures(lib.textures); },
  });
  dlg.el.classList.add('wide');
  setCustomTextures({ ...lib.textures, ...work });
  renderAll();
  return dlg;
}
