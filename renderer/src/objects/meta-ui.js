// Preço e ícone dos Objetos (editor e página da biblioteca).
//   preço por unidade (un, m, m², m³, kg, conjunto) e moeda;
//   ícone: emoji/texto curto, imagem (PNG/JPG/SVG, reduzida para 96 px) — usado na biblioteca e nas ferramentas.
// Ícones SVG de outros usuários são mostrados como <img> (o navegador não executa scripts de SVG em <img>).

export const UNITS = ['un', 'm', 'm²', 'm³', 'kg', 'cj', 'h'];
export const CATEGORY_LABELS = {
  IfcAnnotation: 'Desenho 2D',
  IfcFurniture: 'Mobiliário', IfcDoor: 'Portas', IfcWindow: 'Janelas', IfcStair: 'Escadas', IfcRailing: 'Guarda-corpos',
  IfcColumn: 'Pilares', IfcBeam: 'Vigas', IfcSlab: 'Lajes e pisos', IfcWall: 'Paredes', IfcRoof: 'Coberturas',
  IfcCovering: 'Revestimentos', IfcMember: 'Peças estruturais', IfcPlate: 'Chapas', IfcFlowTerminal: 'Terminais',
  IfcSanitaryTerminal: 'Louças e metais', IfcLightFixture: 'Iluminação', IfcBuildingElementProxy: 'Genéricos',
};

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined) e.append(c instanceof Node ? c : String(c));
  return e;
}

/** URL de imagem para um ícone (dataURL ou SVG em texto), ou null se for emoji/texto. */
export function iconURL(icone) {
  if (!icone) return null;
  const s = String(icone).trim();
  if (s.startsWith('data:image/')) return s;
  if (s.startsWith('<svg')) return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(s)))}`;
  return null;
}

/** Elemento que mostra o ícone (imagem ou emoji); vazio se não houver. */
export function iconView(icone, cls = 'obj-icon') {
  const url = iconURL(icone);
  if (url) return el('img', { class: cls, src: url, alt: '' });
  if (icone) return el('span', { class: cls }, String(icone).slice(0, 4));
  return cls === 'thumb-empty' ? el('span', { class: cls }, '▣') : null;
}

/** Reduz uma imagem enviada para um ícone quadrado de 96 px (PNG). */
function imageToIcon(file) {
  return new Promise((resolve, reject) => {
    if (file.type === 'image/svg+xml') { file.text().then(resolve, reject); return; }
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = 96;
      const k = Math.min(96 / img.width, 96 / img.height);
      const w = img.width * k, hh = img.height * k;
      c.getContext('2d').drawImage(img, (96 - w) / 2, (96 - hh) / 2, w, hh);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Imagem inválida.'));
    img.src = URL.createObjectURL(file);
  });
}

/**
 * Diálogo de preço e ícone. geral: grava na biblioteca geral (senão, na cópia do projeto aberto).
 * Resolve true se salvou.
 */
export function editObjectMeta(o, { geral = false } = {}) {
  return new Promise(resolve => {
    let icone = o.icone || '';
    const preco = el('input', { type: 'number', step: '0.01', min: '0', value: o.preco ?? '', placeholder: '0,00' });
    const unidade = el('select', {}, UNITS.map(u => el('option', { value: u, selected: u === (o.unidade || 'un') }, u)));
    const moeda = el('select', {}, ['BRL', 'USD', 'EUR'].map(m => el('option', { value: m, selected: m === (o.moeda || 'BRL') }, m)));
    const preview = el('div', { class: 'icon-preview' });
    const showIcon = () => { preview.replaceChildren(iconView(icone, 'obj-icon big') || el('span', { class: 'muted' }, 'sem ícone')); };
    showIcon();
    const emoji = el('input', { placeholder: 'emoji ou texto (ex.: 🚪)', maxlength: '4', value: iconURL(icone) ? '' : icone, oninput: e => { icone = e.target.value; showIcon(); } });
    const file = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/svg+xml,image/webp', onchange: async e => {
      const f = e.target.files[0];
      if (!f) return;
      try { icone = await imageToIcon(f); emoji.value = ''; showIcon(); } catch (err) { alert(err.message); }
    } });
    const close = ok => { back.remove(); resolve(ok); };
    const save = async () => {
      try {
        await window.boxbim.objects.meta(o.id, { preco: preco.value === '' ? null : Number(preco.value), unidade: unidade.value, moeda: moeda.value, icone: icone || null }, { geral });
        o.preco = preco.value === '' ? null : Number(preco.value); o.unidade = unidade.value; o.moeda = moeda.value; o.icone = icone || null;
        close(true);
      } catch (err) { errBox.textContent = err.message; }
    };
    const errBox = el('div', { class: 'error-text' });
    const box = el('div', { class: 'dlg meta-dlg' },
      el('h3', {}, `${o.name} — preço e ícone`),
      el('p', { class: 'small muted' }, geral ? 'Biblioteca geral (vale para projetos que ainda não usaram o objeto).' : 'Só neste projeto (a cópia do objeto no projeto).'),
      el('div', { class: 'grid3' }, el('label', {}, 'Preço', preco), el('label', {}, 'Unidade', unidade), el('label', {}, 'Moeda', moeda)),
      el('label', {}, 'Ícone', el('div', { class: 'icon-row' }, preview, emoji, file,
        el('button', { type: 'button', class: 'mini', onclick: () => { icone = ''; emoji.value = ''; file.value = ''; showIcon(); } }, 'Tirar'))),
      errBox,
      el('div', { class: 'dlg-actions' }, el('button', { type: 'button', class: 'ghost', onclick: () => close(false) }, 'Cancelar'), el('button', { type: 'button', class: 'primary', onclick: save }, 'Salvar')));
    const back = el('div', { class: 'dlg-back', onclick: e => { if (e.target === back) close(false); } }, box);
    document.body.append(back);
  });
}
