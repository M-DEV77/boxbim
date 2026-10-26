// EXIBIÇÃO E NAVEGAÇÃO (o que aparece na tela, só para quem está vendo):
//   chips na vista ........ Níveis, Eixos de trabalho e marcadores de Elevação (ligar/desligar)
//   👁 na barra inferior .. "Revelar ocultos": os ocultos aparecem com contorno magenta; clicar num deles o mostra
//   H / Shift+H ........... ocultar a seleção / mostrar tudo
//   cursor ................ o nome do elemento sob o mouse aparece na barra de status
//   ? na vista ............ ajuda do mouse (esquerdo gira, direito seleciona, Alt+direito gira, meio arrasta…)
// E o gerenciador de ELEVAÇÕES (nome, direção, linha, profundidade, visível), gravado no projeto. Nas plantas, os
// marcadores das elevações se ARRASTAM (botão esquerdo) para mudar a linha da elevação; clique duplo abre a vista.
import { h, modal, toast } from './ui.js';
import { normalizeElevations, defaultElevations } from './views.js';
import { fromUnit, toUnit, unitLabel, fmtLen } from './units.js';

const fmtM = m => fmtLen(m, { suffix: true });

const store = (k, v) => { try { localStorage.setItem(k, v); } catch { /* sem armazenamento */ } };
const load = k => { try { return localStorage.getItem(k); } catch { return null; } };

const DIRS = { S: ['Sul (olhando para o norte)', [0, -1]], N: ['Norte (olhando para o sul)', [0, 1]], L: ['Leste (olhando para o oeste)', [1, 0]], O: ['Oeste (olhando para o leste)', [-1, 0]] };
const dirKey = d => Object.entries(DIRS).find(([, [, v]]) => Math.abs(v[0] - d[0]) < 1e-3 && Math.abs(v[1] - d[1]) < 1e-3)?.[0] || 'angulo';
const angleOf = d => Math.round(Math.atan2(d[1], d[0]) * 180 / Math.PI);

export class Display {
  constructor(app) {
    this.app = app;
    const v = app.viewer;
    // eixos de trabalho ocultos na tela (lembrado neste navegador)
    if (load('boxbim.eixosOcultos') === '1') v.hiddenCats.add('eixos');
    this.buildChips();
    this.buildEye();
    this.buildHelp();
    v.addEventListener('visibility', () => this.sync());
    v.addEventListener('change', () => this.sync());
    v.addEventListener('revealed', e => app.status(`"${e.detail.userData.bim?.name || 'Elemento'}" voltou a aparecer.`));
    v.addEventListener('hover', () => {
      const o = v.hovered, b = o?.userData?.bim;
      if (b) app.status(`${b.name || b.type}${b.typeName ? ` · ${b.typeName}` : ''} — clique (esquerdo ou direito) para selecionar${v.isHidden(o) ? ' · oculto: clique para mostrar' : ''}`);
    });
    app.views.addEventListener('display', () => this.sync());
    app.views.addEventListener('activate', () => this.sync());
    this.bindMarkerDrag();
    // clique duplo num marcador de elevação (nas plantas) abre a elevação
    v.renderer.domElement.addEventListener('dblclick', e => {
      const id = app.views.elevationAt(e.clientX, e.clientY);
      if (id) app.views.openView(`elev:${id}`);
    });
    document.addEventListener('keydown', e => {
      if (e.target.closest?.('input, textarea, select, [contenteditable]') || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'h' || e.key === 'H') {
        if (e.shiftKey) { this.showAll(); e.preventDefault(); return; }
        const sel = [...v.selected];
        if (!sel.length) return;
        v.setHidden(sel, true);
        app.status(`${sel.length} elemento(s) oculto(s) — 👁 na barra de baixo revela; Shift+H mostra tudo.`);
        e.preventDefault();
      }
    });
    this.sync();
  }

  // ------------------------------------------------------------ arrastar marcadores de elevação (plantas)

  bindMarkerDrag() {
    const app = this.app, v = app.viewer, canvas = v.renderer.domElement;
    let drag = null;
    const hit = e => app.views.active.kind === 'plan' && !v.tool ? app.views.elevationAt(e.clientX, e.clientY) : null;
    // captura: antes do OrbitControls (para não arrastar a vista junto)
    canvas.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const id = hit(e);
      if (!id) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      const el = app.views.elevations({ all: true }).find(x => x.id === id);
      const line = app.views.elevationLine(el);
      const marker = v.annotations.children.find(o => o.userData.elevId === id && o.isMesh);
      drag = { el, z: marker?.position.z ?? 0, start: { x: e.clientX, y: e.clientY }, o0: line.o.clone(), moved: false };
      canvas.setPointerCapture(e.pointerId);
    }, { capture: true });
    canvas.addEventListener('pointermove', e => {
      if (!drag) { if (!e.buttons) canvas.style.cursor = hit(e) ? 'move' : (v.hovered ? 'pointer' : ''); return; }
      if (!drag.moved && Math.hypot(e.clientX - drag.start.x, e.clientY - drag.start.y) < 4) return;
      drag.moved = true;
      const p = this.groundPoint(e.clientX, e.clientY, drag.z);
      if (!p) return;
      const g = app.guides?.step ? Math.min(0.05, app.guides.step) : 0.05; // encaixe de 5 cm
      drag.el.origem = [Math.round(p.x / g) * g, Math.round(p.y / g) * g].map(n => +n.toFixed(3));
      v.setAnnotations(app.views._elevMarkers(drag.z));
      app.status(`Elevação "${drag.el.nome}": linha em X ${fmtM(drag.el.origem[0])} · Y ${fmtM(drag.el.origem[1])} — solte para gravar.`);
    }, { capture: true });
    canvas.addEventListener('pointerup', e => {
      if (!drag) return;
      const d = drag;
      drag = null;
      e.stopImmediatePropagation();
      if (!d.moved) return;
      const list = app.views.elevations({ all: true }).map(x => (x.id === d.el.id ? d.el : x));
      app.views.setElevations(list);
      app.project?.send({ t: 'projeto', dados: { elevacoes: app.views.elevations({ all: true }) } });
      app.status(`Elevação "${d.el.nome}" movida — clique duplo no marcador abre a vista.`);
    }, { capture: true });
  }

  /** Ponto do plano horizontal z sob o cursor. */
  groundPoint(x, y, z) {
    const v = this.app.viewer, r = v.renderer.domElement.getBoundingClientRect();
    v.raycaster.setFromCamera({ x: ((x - r.left) / r.width) * 2 - 1, y: -((y - r.top) / r.height) * 2 + 1 }, v.camera);
    const ray = v.raycaster.ray, dz = ray.direction.z;
    if (Math.abs(dz) < 1e-9) return null;
    const t = (z - ray.origin.z) / dz;
    return ray.origin.clone().addScaledVector(ray.direction, t);
  }

  // ------------------------------------------------------------ chips na vista

  buildChips() {
    const app = this.app;
    const chip = (key, label, title, toggle) => {
      const b = h('button', { class: 'view-chip', 'data-key': key, title, onclick: () => { toggle(); this.sync(); } }, h('span', { class: 'dot' }), label);
      return b;
    };
    this.chips = h('div', { class: 'view-chips' },
      chip('niveis', 'Níveis', 'Linhas e rótulos dos níveis no 3D e nas elevações', () => { app.views.levels3d = !app.views.levels3d; }),
      chip('eixos', 'Eixos de trabalho', 'Planos de desenho (eixos de trabalho) na tela', () => {
        const hide = !app.viewer.hiddenCats.has('eixos');
        app.viewer.setCategoryHidden('eixos', hide);
        store('boxbim.eixosOcultos', hide ? '1' : '0');
      }),
      chip('elev', 'Elevações', 'Marcadores das elevações nas plantas (clique duplo no marcador abre a elevação)', () => { app.views.elevMarkers = !app.views.elevMarkers; }),
      h('button', { class: 'view-chip ghost', title: 'Elevações: criar, nomear, profundidade, visíveis ou não', onclick: () => this.elevationsDialog() }, '⌂ Elevações…'));
    document.querySelector('.center').append(this.chips);
  }

  // ------------------------------------------------------------ 👁 revelar ocultos (barra inferior)

  buildEye() {
    const v = this.app.viewer;
    this.eye = h('button', { id: 'reveal-btn', class: 'toggle eye-btn', title: 'Revelar ocultos: mostra em magenta o que está oculto; clique num deles para mostrá-lo de volta', onclick: () => this.toggleReveal() },
      h('span', { class: 'eye-ico', html: '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3.2"/></svg>' }),
      h('span', { class: 'eye-count' }));
    const right = document.querySelector('.status-right');
    right.prepend(this.eye);
    this.revealBar = h('div', { class: 'reveal-bar', hidden: true },
      h('strong', {}, '👁 Revelar ocultos'),
      h('span', { class: 'muted' }, 'Os ocultos estão em magenta — clique num para mostrá-lo.'),
      h('button', { onclick: () => this.showAll() }, 'Mostrar todos'),
      h('button', { class: 'primary', onclick: () => this.toggleReveal(false) }, 'Concluir'));
    document.querySelector('.center').append(this.revealBar);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && v.revealHidden) this.toggleReveal(false); });
  }

  toggleReveal(on = !this.app.viewer.revealHidden) {
    this.app.viewer.setReveal(on);
    this.sync();
  }

  showAll() {
    const v = this.app.viewer;
    const hidden = v.elements().filter(e => e.userData.userHidden);
    v.setHidden(hidden, false);
    if (v.hiddenCats.has('eixos')) { v.setCategoryHidden('eixos', false); store('boxbim.eixosOcultos', '0'); }
    this.app.status(hidden.length ? `${hidden.length} elemento(s) voltaram a aparecer.` : 'Nada oculto por você (camadas ocultas continuam nos Ambientes).');
    this.sync();
  }

  // ------------------------------------------------------------ ajuda do mouse

  buildHelp() {
    const tips = [
      ['Botão esquerdo (arrastar)', 'girar a vista 3D · nas plantas, arrastar'],
      ['Clique (esquerdo ou direito)', 'selecionar · Ctrl/Shift soma à seleção'],
      ['Botão direito (arrastar)', 'janela de seleção: → só o que está dentro · ← o que tocar'],
      ['Alt + botão direito', 'girar a vista (nas plantas, arrastar)'],
      ['Botão do meio', 'arrastar a vista'],
      ['Roda', 'aproximar e afastar'],
      ['F', 'enquadrar tudo'],
      ['H · Shift+H', 'ocultar a seleção · mostrar tudo'],
      ['Esc', 'sair da ferramenta / limpar a seleção'],
    ];
    const pop = h('div', { class: 'nav-help-pop', hidden: true },
      h('strong', {}, 'Navegação'),
      h('table', {}, tips.map(([k, d]) => h('tr', {}, h('td', {}, h('kbd', {}, k)), h('td', {}, d)))));
    const btn = h('button', { class: 'nav-help-btn', title: 'Como usar o mouse e os atalhos', onclick: () => { pop.hidden = !pop.hidden; } }, '?');
    document.addEventListener('pointerdown', e => { if (!pop.hidden && !pop.contains(e.target) && e.target !== btn) pop.hidden = true; });
    document.querySelector('.center').append(h('div', { class: 'nav-help' }, pop, btn));
    // primeira vez: mostra a ajuda sozinha (uma vez por navegador)
    if (!load('boxbim.ajudaNavegacao')) { pop.hidden = false; store('boxbim.ajudaNavegacao', '1'); setTimeout(() => { pop.hidden = true; }, 9000); }
  }

  // ------------------------------------------------------------ estado dos botões

  sync() {
    const app = this.app, v = app.viewer, kind = app.views.active.kind;
    const set = (key, on, show = true) => {
      const b = this.chips.querySelector(`[data-key="${key}"]`);
      b.classList.toggle('on', on);
      b.hidden = !show;
    };
    set('niveis', app.views.levels3d, kind === '3d' || kind === 'elevation');
    set('eixos', !v.hiddenCats.has('eixos'), app.workPlanes?.list().length > 0);
    set('elev', app.views.elevMarkers, kind === 'plan');
    const n = v.hiddenCount();
    this.eye.classList.toggle('on', v.revealHidden);
    this.eye.querySelector('.eye-count').textContent = n ? String(n) : '';
    this.eye.title = `Revelar ocultos (${n} oculto${n === 1 ? '' : 's'}): mostra em magenta o que está oculto; clique num deles para mostrá-lo`;
    this.revealBar.hidden = !v.revealHidden;
  }

  // ------------------------------------------------------------ elevações

  elevationsDialog() {
    const app = this.app;
    let list = structuredClone(app.views.elevations({ all: true }));
    const body = h('div', { class: 'elev-dlg' });
    const num = (val, onchange, attrs = {}) => h('input', { type: 'number', step: 0.1, value: val ?? '', placeholder: '—', ...attrs, onchange: e => onchange(e.target.value === '' ? null : fromUnit(Number(e.target.value))) });
    const render = () => {
      body.innerHTML = '';
      body.append(h('div', { class: 'muted small', style: 'margin-bottom:8px' },
        `Linha da elevação em X, Y (${unitLabel()}): sem linha, a elevação fica na borda do modelo e enxerga tudo. Profundidade: até onde enxerga a partir da linha; Largura: quanto enxerga para os lados, centrada no ponto da linha (vazios = tudo). Visível: aparece no navegador, nos menus e com o marcador nas plantas.`));
      const head = h('div', { class: 'elev-row head' }, 'Nome', 'Olhando de', 'Linha X', 'Linha Y', 'Profund.', 'Largura', 'Visível', '');
      body.append(head);
      list.forEach((e, i) => {
        const dk = dirKey(e.dir);
        const ang = h('input', { type: 'number', step: 1, value: angleOf(e.dir), title: 'Ângulo da direção de onde se olha (graus, 0 = leste, 90 = norte)', hidden: dk !== 'angulo',
          onchange: ev => { const a = Number(ev.target.value) * Math.PI / 180; e.dir = [Math.cos(a), Math.sin(a)]; } });
        const dsel = h('select', { onchange: ev => { if (ev.target.value === 'angulo') { ang.hidden = false; } else { e.dir = DIRS[ev.target.value][1].slice(); ang.hidden = true; } } },
          Object.entries(DIRS).map(([k, [label]]) => h('option', { value: k, selected: k === dk }, label)),
          h('option', { value: 'angulo', selected: dk === 'angulo' }, 'Ângulo…'));
        body.append(h('div', { class: 'elev-row' },
          h('input', { value: e.nome, oninput: ev => { e.nome = ev.target.value; } }),
          h('span', { class: 'elev-dir' }, dsel, ang),
          num(e.origem ? toUnit(e.origem[0]) : null, val => { e.origem = val === null ? null : [val, e.origem?.[1] ?? 0]; }),
          num(e.origem ? toUnit(e.origem[1]) : null, val => { e.origem = val === null ? null : [e.origem?.[0] ?? 0, val]; }),
          num(e.profundidade ? toUnit(e.profundidade) : null, val => { e.profundidade = val; }, { min: 0, title: 'Até onde enxerga a partir da linha (vazio = tudo)' }),
          num(e.largura ? toUnit(e.largura) : null, val => { e.largura = val; }, { min: 0, title: 'Largura vista, centrada na linha (vazio = toda a extensão)' }),
          h('input', { type: 'checkbox', checked: e.visivel, onchange: ev => { e.visivel = ev.target.checked; } }),
          h('span', { class: 'elev-act' },
            h('button', { class: 'mini', title: 'Salvar e abrir esta elevação', onclick: async () => { await save(); app.views.openView(`elev:${list[i].id}`); dlg.close(); } }, 'Abrir'),
            h('button', { class: 'mini danger', title: 'Apagar', disabled: list.length <= 1, onclick: () => { list.splice(i, 1); render(); } }, '✕'))));
      });
      body.append(h('div', { style: 'display:flex;gap:6px;margin-top:8px' },
        h('button', { class: 'mini', onclick: () => {
          const b = app.viewer.modelBox(), r2 = x => Math.round(x * 100) / 100;
          const c = b.isEmpty() ? [0, 0] : [r2((b.min.x + b.max.x) / 2), r2((b.min.y + b.max.y) / 2)];
          list.push({ id: `e${Date.now().toString(36)}`, nome: `Elevação ${list.length + 1}`, dir: [0, -1], origem: c, profundidade: 5, largura: 10, visivel: true });
          render();
        } }, '+ Nova elevação (corte pelo centro)'),
        h('button', { class: 'mini', onclick: () => { list = defaultElevations(); render(); } }, 'Voltar às quatro de fábrica')));
    };
    const save = async () => {
      const norm = normalizeElevations(list);
      app.views.setElevations(norm);
      app.project?.send({ t: 'projeto', dados: { elevacoes: norm } });
      list = structuredClone(norm);
      app.renderBrowser?.();
      toast('Elevações salvas no projeto.');
    };
    render();
    const dlg = modal({ title: 'Elevações', body, actions: [{ label: 'Cancelar' }, { label: 'Salvar', class: 'primary', action: save }] });
    dlg.el.classList.add('wide');
    return dlg;
  }
}

