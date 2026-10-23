// Edição das linhas de nível em todas as vistas.
//   Elevações e Vista 3D: arrastar a linha (ou o rótulo) muda a cota — os elementos do nível vão junto, como no
//   Revit (Shift: só a linha; Ctrl: passo de 10 cm). Clique duplo abre o nível (nome, cota, apagar).
//   Qualquer vista (inclusive plantas): botão "Níveis" do rodapé abre a tabela de níveis.
import * as THREE from 'three';
import { h, modal, toast, confirmDialog } from './ui.js';
import { fmtElev, cutOf } from './levels.js';
import { toUnit, fromUnit, unitLabel, unitStep } from './units.js';

const round = (v, step) => +(Math.round(v / step) * step).toFixed(4);

export class LevelEditor {
  constructor(app) {
    this.app = app;
    this.viewer = app.viewer;
    this.levels = app.levels;
    this.ray = new THREE.Raycaster();
    this.drag = null;
    const el = this.viewer.renderer.domElement;
    // fase de captura: chega antes da órbita e da seleção do viewer, que ficam de fora quando a linha é pega
    el.addEventListener('pointerdown', e => this.down(e), { capture: true });
    el.addEventListener('pointermove', e => this.move(e), { capture: true });
    el.addEventListener('pointerup', e => this.up(e), { capture: true });
    el.addEventListener('dblclick', e => {
      const hit = this.enabled() && this.pick(e);
      if (!hit) return;
      e.stopImmediatePropagation();
      this.edit(this.levels.get(hit.id));
    }, { capture: true });
  }

  /** Só com as linhas na tela e sem outra ferramenta (desenho, render) usando o mouse. */
  enabled() {
    const v = this.viewer;
    return !v.tool && !v.renderOverride && v.annotations.children.some(o => o.userData.levelId);
  }

  /** Tamanho de um pixel no mundo, perto do ponto que a câmera olha. */
  worldPerPx() {
    const cam = this.viewer.camera, hPx = this.viewer.container.clientHeight || 1;
    if (cam.isOrthographicCamera) return (cam.top - cam.bottom) / cam.zoom / hPx;
    const d = cam.position.distanceTo(this.viewer.controls.target);
    return 2 * d * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) / hPx;
  }

  setRay(e) {
    const r = this.viewer.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
    this.ray.setFromCamera(ndc, this.viewer.camera);
  }

  /** Linha, cabeça ou rótulo de nível sob o mouse: { id, point } ou null. */
  pick(e) {
    this.setRay(e);
    this.ray.params.Line.threshold = this.worldPerPx() * 6;
    const objs = this.viewer.annotations.children.filter(o => o.userData.levelId);
    // rótulos e cabeças têm prioridade sobre as linhas (que passam umas perto das outras no 3D)
    const hits = this.ray.intersectObjects(objs, false).sort((a, b) => (a.object.isLine ? 1 : 0) - (b.object.isLine ? 1 : 0));
    const hit = hits[0];
    return hit ? { id: hit.object.userData.levelId, point: hit.point } : null;
  }

  down(e) {
    if (e.button !== 0 || this.drag || !this.enabled()) return;
    const hit = this.pick(e);
    if (!hit) return;
    const lvl = this.levels.get(hit.id);
    if (!lvl) return;
    e.stopImmediatePropagation();
    if (lvl.fixo) { this.app.status(`${lvl.name} está fixado (🔒): clique duas vezes para destravar.`); return; }
    e.preventDefault();
    this.viewer.renderer.domElement.setPointerCapture(e.pointerId);
    // plano vertical de frente para a câmera, passando pelo ponto pego: o mouse sobe e desce a cota
    const n = this.viewer.camera.getWorldDirection(new THREE.Vector3()).setZ(0);
    if (n.lengthSq() < 1e-4) n.set(0, 1, 0); // olhando de cima: não há como arrastar na vertical
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n.normalize(), hit.point);
    const objs = this.viewer.annotations.children.filter(o => o.userData.levelId === lvl.id);
    this.drag = { lvl, plane, z0: hit.point.z, dz: 0, objs, base: objs.map(o => o.position.z) };
  }

  move(e) {
    const el = this.viewer.renderer.domElement;
    if (!this.drag) {
      // cursor de "subir/descer" em cima das linhas de nível
      if (e.buttons || !this.enabled()) { if (this._hover) { el.style.cursor = ''; this._hover = false; } return; }
      const over = !!this.pick(e);
      if (over !== !!this._hover) { el.style.cursor = over ? 'ns-resize' : ''; this._hover = over; }
      return;
    }
    e.stopImmediatePropagation();
    this.setRay(e);
    const p = this.ray.ray.intersectPlane(this.drag.plane, new THREE.Vector3());
    if (!p) return;
    const d = this.drag;
    d.dz = round(p.z - d.z0, e.ctrlKey ? 0.1 : 0.01);
    d.objs.forEach((o, i) => { o.position.z = d.base[i] + d.dz; });
    const to = round(d.lvl.elevation + d.dz, 0.0001);
    this.app.status(`${d.lvl.name}: ${fmtElev(d.lvl.elevation)} → ${fmtElev(to)} (Δ ${fmtElev(d.dz)} ${unitLabel()})${e.shiftKey ? ' · só a linha' : ' · elementos do nível vão junto (Shift: só a linha)'}`);
  }

  up(e) {
    const d = this.drag;
    if (!d) return;
    e.stopImmediatePropagation();
    this.drag = null;
    try { this.viewer.renderer.domElement.releasePointerCapture(e.pointerId); } catch { /* já solto */ }
    if (!d.dz) { d.objs.forEach((o, i) => { o.position.z = d.base[i]; }); return; }
    this.apply(d.lvl, { elevation: round(d.lvl.elevation + d.dz, 0.0001) }, { moveElements: !e.shiftKey });
  }

  /** Elementos que estão no nível (pela propriedade Nivel ou pela base). */
  elementsOf(lvl) { return this.viewer.elements().filter(o => this.levels.ofElement(o) === lvl); }

  /** Muda nome e/ou cota de um nível; com moveElements, os elementos dele sobem/descem a mesma diferença. */
  apply(lvl, { name, elevation, fixo }, { moveElements = true } = {}) {
    const unlocked = fixo === undefined ? !lvl.fixo : !fixo || !lvl.fixo; // destravar e mudar a cota no mesmo salvar vale
    const dz = elevation === undefined ? 0 : elevation - lvl.elevation;
    const hosted = moveElements && unlocked && Math.abs(dz) > 1e-9 ? this.elementsOf(lvl) : [];
    try {
      if (fixo === false && lvl.fixo) this.levels.update(lvl.id, { fixo: false });
      this.levels.update(lvl.id, { name, elevation });
      if (fixo) this.levels.update(lvl.id, { fixo: true });
    } catch (err) { toast(err.message, 'error'); this.app.views.refresh(); return false; }
    if (hosted.length) {
      for (const o of hosted) { o.position.z += dz; o.updateMatrix(); }
      this.app.transformTool.afterTransform(hosted);
    }
    this.app.status(`${lvl.name}: cota ${fmtElev(lvl.elevation)}${hosted.length ? ` · ${hosted.length} elemento(s) movido(s) junto` : ''}.`);
    return true;
  }

  /** Diálogo de um nível: nome, cota, mover os elementos junto, apagar. */
  edit(lvl) {
    if (!lvl) return;
    const name = h('input', { value: lvl.name });
    const elev = h('input', { type: 'number', step: unitStep(), value: toUnit(lvl.elevation) });
    const count = this.elementsOf(lvl).length;
    const moveEl = h('input', { type: 'checkbox', checked: true });
    const c = cutOf(lvl);
    const cutIn = h('input', { type: 'number', step: 'any', value: toUnit(c.cutHeight), title: 'Altura do plano de corte das plantas, a partir da cota do nível' });
    const depthIn = h('input', { type: 'number', step: 'any', value: toUnit(c.viewDepth), title: 'Até onde a planta enxerga para baixo (negativo = abaixo do nível)' });
    const fixo = h('input', { type: 'checkbox', checked: !!lvl.fixo, onchange: () => { elev.disabled = fixo.checked && !!lvl.fixo; } });
    elev.disabled = !!lvl.fixo;
    const body = h('div', { class: 'form' },
      h('label', {}, 'Nome', name),
      h('label', {}, `Cota (${unitLabel()})`, elev),
      h('label', { class: 'inline' }, fixo, '🔒 Fixar o nível (a cota não muda, nem arrastando a linha)'),
      h('h4', {}, 'Configuração do corte (plantas do nível)'),
      h('label', {}, `Plano de corte (${unitLabel()}, acima do nível)`, cutIn),
      h('label', {}, `Profundidade da vista (${unitLabel()}, negativo = abaixo)`, depthIn),
      h('label', { class: 'inline' }, moveEl, `Mover junto os ${count} elemento(s) do nível ao mudar a cota`),
      h('p', { class: 'small muted' }, 'Dica: nas elevações e na Vista 3D dá para arrastar a linha do nível (Shift: só a linha).'));
    modal({
      title: `Nível: ${lvl.name}`, small: true, body,
      actions: [
        { label: 'Apagar', class: 'danger', action: () => { this.app.deleteLevel(lvl); } },
        { label: 'Cancelar' },
        { label: 'Salvar', class: 'primary', action: () => {
          const z = fromUnit(elev.value);
          if (!name.value.trim() || !Number.isFinite(z)) { toast('Informe nome e cota.', 'error'); return false; }
          this.levels.update(lvl.id, { corte: { cutHeight: fromUnit(cutIn.value), viewDepth: fromUnit(depthIn.value) } });
          return this.apply(lvl, { name: name.value.trim(), elevation: z, fixo: fixo.checked }, { moveElements: moveEl.checked });
        } },
      ],
    });
    setTimeout(() => elev.select(), 30);
  }

  /** Tabela com todos os níveis — editar nome e cota, criar, apagar, abrir a planta. Funciona em qualquer vista. */
  openTable() {
    if (this._table) return;
    const moveEl = h('input', { type: 'checkbox', checked: true });
    const show3d = h('input', { type: 'checkbox', checked: this.app.views.levels3d, onchange: () => { this.app.views.levels3d = show3d.checked; } });
    const rows = h('tbody');
    const render = () => {
      rows.replaceChildren(...[...this.levels.list].reverse().map(l => {
        const name = h('input', { value: l.name, onchange: () => { if (name.value.trim()) this.apply(l, { name: name.value.trim() }); else render(); } });
        const elev = h('input', { type: 'number', step: unitStep(), value: toUnit(l.elevation), disabled: !!l.fixo, style: 'width:90px', onchange: () => {
          const z = fromUnit(elev.value);
          if (elev.value === '' || !Number.isFinite(z)) return render();
          this.apply(l, { elevation: z }, { moveElements: moveEl.checked });
        } });
        const c = cutOf(l);
        const cutIn = h('input', { type: 'number', step: 'any', value: toUnit(c.cutHeight), style: 'width:70px', title: 'Plano de corte (acima do nível)',
          onchange: () => this.levels.update(l.id, { corte: { cutHeight: fromUnit(cutIn.value) } }) });
        const depIn = h('input', { type: 'number', step: 'any', value: toUnit(c.viewDepth), style: 'width:70px', title: 'Profundidade da vista (negativo = abaixo do nível)',
          onchange: () => this.levels.update(l.id, { corte: { viewDepth: fromUnit(depIn.value) } }) });
        return h('tr', {},
          h('td', {}, name), h('td', {}, elev), h('td', {}, cutIn), h('td', {}, depIn), h('td', { class: 'muted small' }, String(this.elementsOf(l).length)),
          h('td', {},
            h('button', { class: `mini${l.fixo ? ' on' : ''}`, title: l.fixo ? 'Fixado: clique para destravar a cota' : 'Fixar o nível (a cota não muda)', onclick: () => this.apply(l, { fixo: !l.fixo }) }, l.fixo ? '🔒' : '🔓'),
            h('button', { class: 'mini', title: 'Abrir a planta de piso', onclick: () => this.app.views.openView(`plan:${l.id}`) }, 'Planta'),
            h('button', { class: 'mini danger', title: 'Apagar o nível', onclick: () => this.app.deleteLevel(l) }, '✕')));
      }));
    };
    const onChange = () => render();
    this.levels.addEventListener('change', onChange);
    render();
    const add = () => {
      const top = this.levels.list.at(-1);
      try { this.levels.add({ name: this.levels.nextName(), elevation: +((top?.elevation ?? 0) + 3).toFixed(2) }); } catch (err) { toast(err.message, 'error'); }
    };
    const body = h('div', { class: 'levels-table' },
      h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Nome'), h('th', {}, `Cota (${unitLabel()})`), h('th', { title: 'Plano de corte das plantas, acima do nível' }, 'Corte'), h('th', { title: 'Profundidade da vista (negativo = abaixo do nível)' }, 'Profund.'), h('th', {}, 'Elementos'), h('th'))), rows),
      h('button', { class: 'mini', onclick: add }, '+ Novo nível'),
      h('label', { class: 'inline' }, moveEl, 'Ao mudar a cota, mover junto os elementos do nível'),
      h('label', { class: 'inline' }, show3d, 'Mostrar as linhas de nível na Vista 3D'),
      h('p', { class: 'small muted' }, 'Nas elevações e na Vista 3D: arraste a linha para mudar a cota (Shift: só a linha; Ctrl: passo de 10 cm) e clique duas vezes para editar.'));
    this._table = modal({
      title: 'Níveis', body, actions: [{ label: 'Fechar', class: 'primary' }],
      onClose: () => { this.levels.removeEventListener('change', onChange); this._table = null; },
    });
  }
}
