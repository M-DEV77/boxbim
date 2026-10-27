// PISO: editar depois de feito (clique duplo no piso ou Propriedades › Editar piso e contorno…), como a parede.
// Diálogo com nome, tipo, cota do topo e as LINHAS do piso num editor 2D em planta:
//   arrastar um ponto ............ move (grade de 1 cm; Shift trava 0°/90° em relação ao ponto anterior)
//   clique duplo num lado ......... acrescenta um ponto ali
//   botão direito / Delete ....... tira o ponto (cada contorno fica com pelo menos 3)
//   clique num lado ............... seleciona o lado: digite o comprimento (a ponta final anda na direção do lado)
//   ＋ Furo / Apagar furo ......... furos (shafts, aberturas) dentro do contorno
// As alturas dos pontos (Pontos do piso) acompanham os pontos do contorno; os pontos internos de forma aparecem.
import { h, modal, toast } from './ui.js';
import { fmtLen, fromUnit, toUnit, unitLabel } from './units.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
const r4 = v => +(+v).toFixed(4);
const snap = v => Math.round(v * 100) / 100;
const polyArea = pts => Math.abs(pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);

export function editFloor(app, el) {
  const b = el.userData.bim, s = b.slab;
  // contornos: 0 = externo, 1… = furos; as alturas andam junto com os pontos do externo
  let rings = [s.points.map(p => [...p]), ...(s.holes || []).map(hl => hl.map(p => [...p]))];
  let alt = s.points.map((_, i) => s.alturas?.[i] || 0);
  const forma = (s.forma || []).map(p => [...p]);
  const types = app.types.list('slab');
  const name = h('input', { value: b.name || '' });
  const typeSel = h('select', {}, h('option', { value: '', selected: !b.typeId }, 'Genérico (sem tipo)'),
    types.map(t => h('option', { value: t.id, selected: t.id === b.typeId }, `${t.name} (${fmtLen(app.types.thickness(t), { suffix: true })})`)));
  const topIn = h('input', { type: 'number', step: 'any', value: toUnit(s.elevation), title: 'Cota do topo do piso (absoluta)' });
  const terrIn = h('input', { type: 'checkbox', checked: !!s.terreno });
  const info = h('div', { class: 'small muted' });
  const selBox = h('div', { class: 'form grid2 fe-sel' });

  // ---- editor SVG em planta (X para a direita, Y para cima)
  const W = 560, H = 360, pad = 34;
  const box = h('div', { class: 'wall-profile' });
  const sv = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%' });
  box.append(sv);
  let sel = null;   // { r, i } ponto selecionado
  let edge = null;  // { r, i } lado selecionado (do ponto i ao i+1)
  const view = () => {
    const all = rings.flat().concat(forma);
    const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const k = Math.min((W - 2 * pad) / (x1 - x0 || 1), (H - 2 * pad) / (y1 - y0 || 1));
    const ox = (W - (x1 - x0) * k) / 2, oy = (H - (y1 - y0) * k) / 2;
    return { k, X: x => ox + (x - x0) * k, Y: y => H - oy - (y - y0) * k, U: px => (px - ox) / k + x0, V: py => (H - oy - py) / k + y0 };
  };
  let frozen = null; // escala fixa durante o arraste (senão o desenho "foge" do mouse)
  const cur = () => frozen || view();

  const draw = () => {
    sv.replaceChildren();
    const v = cur();
    rings.forEach((ring, r) => {
      sv.append(svg('polygon', { points: ring.map(p => `${v.X(p[0])},${v.Y(p[1])}`).join(' '), class: r ? 'fe-hole' : 'wp-outline' }));
      ring.forEach((a, i) => {
        const q = ring[(i + 1) % ring.length];
        const on = edge && edge.r === r && edge.i === i;
        const ln = svg('line', { x1: v.X(a[0]), y1: v.Y(a[1]), x2: v.X(q[0]), y2: v.Y(q[1]), class: `fe-edge${on ? ' on' : ''}` });
        ln.addEventListener('click', e => { e.stopPropagation(); edge = { r, i }; sel = null; draw(); });
        ln.addEventListener('dblclick', e => { e.stopPropagation(); insertOn(r, i, toLocal(e)); });
        sv.append(ln);
        // medida do lado
        const L = Math.hypot(q[0] - a[0], q[1] - a[1]);
        if (L * v.k > 36) {
          const t = svg('text', { x: (v.X(a[0]) + v.X(q[0])) / 2, y: (v.Y(a[1]) + v.Y(q[1])) / 2 - 4, class: `fe-len${on ? ' on' : ''}` });
          t.textContent = fmtLen(L);
          t.addEventListener('click', e => { e.stopPropagation(); edge = { r, i }; sel = null; draw(); });
          sv.append(t);
        }
      });
    });
    for (const p of forma) sv.append(svg('rect', { x: v.X(p[0]) - 4, y: v.Y(p[1]) - 4, width: 8, height: 8, class: 'fe-forma', transform: `rotate(45 ${v.X(p[0])} ${v.Y(p[1])})` }));
    rings.forEach((ring, r) => ring.forEach((p, i) => {
      const c = svg('circle', { cx: v.X(p[0]), cy: v.Y(p[1]), r: 6, class: `wp-pt${sel && sel.r === r && sel.i === i ? ' on' : ''}${r ? ' fe-hole-pt' : ''}` });
      c.addEventListener('pointerdown', e => startDrag(e, r, i));
      c.addEventListener('click', e => e.stopPropagation());
      c.addEventListener('contextmenu', e => { e.preventDefault(); removePt(r, i); });
      sv.append(c);
    }));
    const holes = rings.slice(1).reduce((t, hl) => t + polyArea(hl), 0);
    info.textContent = `${rings[0].length} pontos${rings.length > 1 ? ` · ${rings.length - 1} furo(s)` : ''} · área ${(polyArea(rings[0]) - holes).toFixed(2).replace('.', ',')} m² · arraste os pontos; clique duplo num lado acrescenta; botão direito (ou Delete) tira; clique num lado para o comprimento`;
    renderSel();
  };

  /** Campos do ponto ou do lado selecionado. */
  const renderSel = () => {
    const u = unitLabel();
    if (sel) {
      const p = rings[sel.r][sel.i];
      const set = (k, val) => { const x = fromUnit(val); if (Number.isFinite(x)) { rings[sel.r][sel.i][k] = r4(x); draw(); } };
      selBox.replaceChildren(
        h('label', {}, `Ponto ${sel.i + 1}${sel.r ? ` do furo ${sel.r}` : ''} · X (${u})`, h('input', { type: 'number', step: 'any', value: toUnit(p[0]), onchange: e => set(0, e.target.value) })),
        h('label', {}, `Y (${u})`, h('input', { type: 'number', step: 'any', value: toUnit(p[1]), onchange: e => set(1, e.target.value) })));
    } else if (edge) {
      const ring = rings[edge.r], a = ring[edge.i], q = ring[(edge.i + 1) % ring.length];
      const L = Math.hypot(q[0] - a[0], q[1] - a[1]);
      selBox.replaceChildren(
        h('label', {}, `Lado ${edge.i + 1}${edge.r ? ` do furo ${edge.r}` : ''} · comprimento (${u})`, h('input', { type: 'number', step: 'any', min: '0', value: toUnit(r4(L)), onchange: e => {
          const nl = fromUnit(e.target.value);
          if (!(nl > 0.005) || L < 1e-9) return;
          // a ponta final anda na direção do lado (o resto do contorno fica)
          ring[(edge.i + 1) % ring.length] = [r4(a[0] + (q[0] - a[0]) / L * nl), r4(a[1] + (q[1] - a[1]) / L * nl)];
          draw();
        } })),
        h('label', {}, 'Ângulo', h('input', { type: 'text', disabled: true, value: `${(Math.atan2(q[1] - a[1], q[0] - a[0]) * 180 / Math.PI).toFixed(1).replace('.', ',')}°` })));
    } else selBox.replaceChildren(h('div', { class: 'small muted' }, 'Selecione um ponto (X, Y) ou um lado (comprimento).'));
  };

  const toLocal = e => {
    const r = sv.getBoundingClientRect(), v = cur();
    const x = (e.clientX - r.left) * W / r.width, y = (e.clientY - r.top) * H / r.height;
    return [snap(v.U(x)), snap(v.V(y))];
  };
  const startDrag = (e, ri, i) => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    sel = { r: ri, i }; edge = null;
    frozen = view();
    const rect = sv.getBoundingClientRect();
    const ring = rings[ri];
    const move = ev => {
      const x = (ev.clientX - rect.left) * W / rect.width, y = (ev.clientY - rect.top) * H / rect.height;
      let p = [snap(frozen.U(x)), snap(frozen.V(y))];
      if (ev.shiftKey) { const q = ring[(i - 1 + ring.length) % ring.length]; p = Math.abs(p[0] - q[0]) > Math.abs(p[1] - q[1]) ? [p[0], q[1]] : [q[0], p[1]]; }
      ring[i] = p;
      draw();
    };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); frozen = null; draw(); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
    draw();
  };
  const insertOn = (r, i, p) => {
    const ring = rings[r];
    ring.splice(i + 1, 0, p);
    if (r === 0) alt.splice(i + 1, 0, r4(((alt[i] || 0) + (alt[(i + 1) % (ring.length - 1)] || 0)) / 2));
    sel = { r, i: i + 1 }; edge = null;
    draw();
  };
  const removePt = (r, i) => {
    if (rings[r].length <= 3) { toast(r ? 'Um furo precisa de pelo menos 3 pontos (use Apagar furo).' : 'O contorno do piso precisa de pelo menos 3 pontos.', 'error'); return; }
    rings[r].splice(i, 1);
    if (r === 0) alt.splice(i, 1);
    sel = null;
    draw();
  };
  // clique duplo no fundo: acrescenta no lado mais perto
  sv.addEventListener('dblclick', e => {
    const p = toLocal(e);
    let best = null, bd = Infinity;
    rings.forEach((ring, r) => ring.forEach((a, i) => {
      const q = ring[(i + 1) % ring.length];
      const dx = q[0] - a[0], dy = q[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
      const d = Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1]);
      if (d < bd) { bd = d; best = { r, i }; }
    }));
    if (best) insertOn(best.r, best.i, p);
  });
  sv.addEventListener('click', () => { sel = null; edge = null; draw(); });
  const keyDel = e => { if ((e.key === 'Delete' || e.key === 'Backspace') && sel && !e.target.matches?.('input, select')) { e.preventDefault(); removePt(sel.r, sel.i); } };
  document.addEventListener('keydown', keyDel, true);

  const bbox = () => {
    const xs = rings[0].map(p => p[0]), ys = rings[0].map(p => p[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  };
  const tools = h('div', { class: 'row-buttons' },
    h('button', { onclick: () => {
      const [x0, y0, x1, y1] = bbox();
      rings[0] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]; alt = [0, 0, 0, 0]; sel = edge = null; draw();
    }, title: 'Volta ao retângulo que envolve o contorno' }, 'Retângulo'),
    h('button', { onclick: () => {
      const [x0, y0, x1, y1] = bbox(), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, d = Math.max(0.2, Math.min(x1 - x0, y1 - y0) / 6);
      rings.push([[cx - d, cy - d], [cx + d, cy - d], [cx + d, cy + d], [cx - d, cy + d]].map(p => p.map(r4)));
      sel = null; edge = null; draw();
    }, title: 'Furo quadrado no meio do piso (arraste os pontos dele depois)' }, '＋ Furo'),
    h('button', { onclick: () => {
      const r = sel?.r || edge?.r || rings.length - 1;
      if (r < 1) { toast('Este piso não tem furo (ou selecione um ponto do furo).', 'error'); return; }
      rings.splice(r, 1); sel = edge = null; draw();
    }, title: 'Tira o furo selecionado (ou o último)' }, 'Apagar furo'));

  draw();
  modal({
    title: `Editar piso — ${b.name || ''}`,
    body: h('div', { class: 'wall-edit' },
      h('div', { class: 'form grid2' },
        h('label', {}, 'Nome', name),
        h('label', {}, 'Tipo (camadas)', typeSel),
        h('label', {}, `Topo (${unitLabel()}, cota absoluta)`, topIn),
        h('label', { class: 'inline', title: 'Só a superfície se desloca com os pontos (o fundo fica plano) e os outros pisos cortam o terreno' }, terrIn, 'Terreno')),
      h('h4', {}, 'Linhas do piso (planta)'), tools, box, selBox, info),
    actions: [
      { label: 'Cancelar' },
      { label: 'Aplicar', class: 'primary', action: async () => {
        const top = fromUnit(topIn.value);
        if (polyArea(rings[0]) < 1e-4) { toast('O contorno do piso ficou sem área.', 'error'); return false; }
        // o elemento pode ter sido refeito pela sincronização enquanto o diálogo estava aberto: grava no atual
        const t = app.floorPoints.live(el), b = t.userData.bim, s = b.slab;
        b.name = t.name = name.value.trim() || b.name;
        if (typeSel.value !== (b.typeId || '')) {
          if (typeSel.value) Object.assign(b, app.types.spec('slab', typeSel.value));
          else Object.assign(b, { layers: null, typeId: null, typeName: null });
        }
        s.elevation = Number.isFinite(top) ? r4(top) : s.elevation;
        s.points = rings[0].map(p => [r4(p[0]), r4(p[1])]);
        if (rings.length > 1) s.holes = rings.slice(1).map(hl => hl.map(p => [r4(p[0]), r4(p[1])])); else delete s.holes;
        if (alt.some(x => x)) s.alturas = alt.map(r4); else delete s.alturas;
        if (terrIn.checked) s.terreno = true; else delete s.terreno;
        if (b.props) {
          b.props.Cota = s.elevation;
          const lvl = app.levels.ofElement(t);
          if (lvl) b.props.Deslocamento = r4(s.elevation - lvl.elevation);
        }
        await app.floorPoints.commit(t);
        app.status('Piso atualizado.');
      } },
    ],
    onClose: () => document.removeEventListener('keydown', keyDel, true),
  });
}
