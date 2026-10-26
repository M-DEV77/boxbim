// EDITOR DE MATERIAIS: a biblioteca de materiais com pré-visualização 3D (esfera e cubo, luz de estúdio) e os
// mapas procedurais do padrão escolhido — cor, relevo, normal, AO, deslocamento, rugosidade/brilho, metal,
// especular, opacidade e emissão —, cada um ligado/desligado e com a sua intensidade. Edita uma cópia; ao salvar,
// grava na biblioteca de tipos (o Render e o path tracing atualizam na hora).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { h, modal, toast } from './ui.js';
import { PATTERNS, MAPS, materialProps, createMaterial, applyMaterial, boxUv, mapThumbnail } from './materials.js';

export function openMaterialEditor(app, startName) {
  const lib = app.types;
  const work = structuredClone(lib.materials);
  let name = work[startName] ? startName : Object.keys(work)[0];

  // ------------------------------------------------------------ pré-visualização
  const W = 300, H = 300;
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(W, H);
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.shadowMap.enabled = true;
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = env;
  scene.background = new THREE.Color(0x2a2d33);
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(2, 3, 4);
  sun.castShadow = true;
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(32, W / H, 0.1, 50);
  camera.up.set(0, 0, 1);
  const preview = createMaterial(name, work[name]);
  const group = new THREE.Group();
  const sphereG = new THREE.SphereGeometry(0.55, 96, 64).rotateX(Math.PI / 2);
  const boxG = new THREE.BoxGeometry(0.9, 0.9, 0.9);
  boxUv(sphereG); boxUv(boxG);
  const sphere = new THREE.Mesh(sphereG, preview), cube = new THREE.Mesh(boxG, preview);
  sphere.position.set(-0.6, 0, 0.55); cube.position.set(0.65, 0.1, 0.45); cube.rotation.z = 0.5;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshStandardMaterial({ color: 0x55585e, roughness: 0.9 }));
  sphere.castShadow = cube.castShadow = true; floor.receiveShadow = true;
  group.add(sphere, cube, floor);
  scene.add(group);
  let yaw = -0.5, pitch = 0.42, dist = 3.6;
  const draw = () => {
    camera.position.set(Math.sin(yaw) * Math.cos(pitch) * dist, -Math.cos(yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist + 0.4);
    camera.lookAt(0, 0, 0.45);
    renderer.render(scene, camera);
  };
  const cv = renderer.domElement;
  cv.className = 'me-canvas';
  cv.title = 'Arraste para girar; roda do mouse para aproximar';
  cv.addEventListener('pointerdown', e => {
    cv.setPointerCapture(e.pointerId);
    let x = e.clientX, y = e.clientY;
    const move = ev => { yaw += (ev.clientX - x) * 0.01; pitch = Math.min(1.4, Math.max(0.05, pitch + (ev.clientY - y) * 0.01)); x = ev.clientX; y = ev.clientY; draw(); };
    const up = () => { cv.removeEventListener('pointermove', move); cv.removeEventListener('pointerup', up); };
    cv.addEventListener('pointermove', move); cv.addEventListener('pointerup', up);
  });
  cv.addEventListener('wheel', e => { e.preventDefault(); dist = Math.min(8, Math.max(1.6, dist * (e.deltaY > 0 ? 1.1 : 0.9))); draw(); }, { passive: false });

  // ------------------------------------------------------------ painéis
  const listBox = h('div', { class: 'me-list' });
  const mapsBox = h('div', { class: 'me-maps' });
  const ctrlBox = h('div', { class: 'me-controls' });
  const scaleNote = h('div', { class: 'muted', style: 'font-size:11px' });

  const cur = () => work[name];
  const props = () => materialProps(name, cur());
  const set = (k, v, { rebuild = false } = {}) => {
    const d = cur();
    if (k === 'color') d.color = v; else d.render = { ...(d.render || {}), [k]: v };
    applyMaterial(preview, name, d);
    draw();
    if (rebuild) renderControls();
    if (k === 'textura') renderMaps();
  };

  function renderList() {
    listBox.innerHTML = '';
    for (const [n, d] of Object.entries(work)) {
      const p = materialProps(n, d);
      listBox.append(h('div', { class: `me-item${n === name ? ' active' : ''}`, onclick: () => select(n) },
        h('span', { class: 'swatch', style: `background:${d.color || '#ccc'}` }), h('span', {}, n),
        p.textura !== 'nenhuma' ? h('span', { class: 'muted' }, PATTERNS[p.textura] || '') : null));
    }
    const nn = h('input', { placeholder: 'Novo material' });
    listBox.append(h('div', { class: 'me-new' }, nn, h('button', { class: 'mini', onclick: () => {
      const n = nn.value.trim();
      if (!n || work[n]) return toast('Informe um nome de material novo.', 'error');
      work[n] = { color: '#bbbbbb', render: { ...(work[name]?.render || {}) } };
      select(n);
    } }, '+')));
  }

  function renderMaps() {
    const p = props();
    mapsBox.innerHTML = '';
    if (p.textura === 'nenhuma') { mapsBox.append(h('div', { class: 'muted' }, 'Escolha um padrão procedural para gerar os mapas.')); return; }
    for (const [k, label] of Object.entries(MAPS)) {
      mapsBox.append(h('figure', { class: 'me-map', title: label }, mapThumbnail(p.textura, k), h('figcaption', {}, label)));
    }
  }

  function renderControls() {
    const p = props(), d = cur();
    ctrlBox.innerHTML = '';
    const out = v => h('span', { class: 'me-val' }, String(v));
    const slider = (k, label, min, max, step, { title, fmt = v => v, onSet } = {}) => {
      const o = out(fmt(p[k]));
      const inp = h('input', { type: 'range', min, max, step, value: p[k], title: title || label,
        oninput: e => { const v = Number(e.target.value); o.textContent = fmt(v); set(k, v); onSet?.(v); } });
      return h('label', { class: 'me-row' }, h('span', {}, label), inp, o);
    };
    const check = (k, label, title) => h('label', { class: 'me-check', title },
      h('input', { type: 'checkbox', checked: !!p[k], onchange: e => set(k, e.target.checked) }), label);
    const color = (k, label, value) => h('label', { class: 'me-row' }, h('span', {}, label),
      h('input', { type: 'color', value, oninput: e => set(k, e.target.value) }), h('span'));
    const section = (title, ...rows) => h('fieldset', { class: 'me-sec' }, h('legend', {}, title), ...rows);

    // rugosidade e brilho (glossiness) são o mesmo valor visto dos dois lados
    let glossIn, roughIn, glossOut, roughOut;
    const rough = (() => {
      roughOut = out(p.rugosidade);
      roughIn = h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: p.rugosidade, oninput: e => {
        const v = Number(e.target.value); roughOut.textContent = v; glossIn.value = 1 - v; glossOut.textContent = (1 - v).toFixed(2); set('rugosidade', v);
      } });
      return h('label', { class: 'me-row' }, h('span', {}, 'Rugosidade'), roughIn, roughOut);
    })();
    const gloss = (() => {
      glossOut = out((1 - p.rugosidade).toFixed(2));
      glossIn = h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: 1 - p.rugosidade, title: 'Brilho (glossiness) = 1 − rugosidade', oninput: e => {
        const v = 1 - Number(e.target.value); glossOut.textContent = e.target.value; roughIn.value = v; roughOut.textContent = v.toFixed(2); set('rugosidade', Number(v.toFixed(2)));
      } });
      return h('label', { class: 'me-row' }, h('span', {}, 'Brilho'), glossIn, glossOut);
    })();

    ctrlBox.append(
      section('Base',
        color('color', 'Cor', d.color || '#cccccc'),
        h('label', { class: 'me-row' }, h('span', {}, 'Padrão'), h('select', { onchange: e => set('textura', e.target.value) },
          Object.entries(PATTERNS).map(([k, l]) => h('option', { value: k, selected: k === p.textura }, l))), h('span')),
        h('label', { class: 'me-row', title: 'Quantos metros o padrão cobre antes de repetir' }, h('span', {}, 'Escala (m)'),
          h('input', { type: 'number', min: 0.05, step: 0.05, value: p.escala, onchange: e => set('escala', Math.max(0.05, Number(e.target.value) || 1)) }), h('span'))),
      section('Superfície',
        rough, gloss, check('mapaRugosidade', 'Mapa de rugosidade/brilho', 'Juntas e poros mais foscos, faces mais lisas'),
        slider('metal', 'Metal', 0, 1, 0.01), check('mapaMetal', 'Mapa de metal', 'Só as partes metálicas do padrão (ex.: chapa perfurada)'),
        slider('especular', 'Especular', 0, 1, 0.01, { title: 'Intensidade do reflexo especular (materiais não metálicos)' }),
        color('corEspecular', 'Cor especular', p.corEspecular), check('mapaEspecular', 'Mapa especular', 'Juntas refletem menos que as faces')),
      section('Relevo',
        slider('normal', 'Normal', 0, 3, 0.05, { title: 'Mapa normal: relevo das peças e juntas (0 = desligado)' }),
        slider('relevo', 'Bump', 0, 3, 0.05, { title: 'Relevo fino (poros, veios, escovado) — 0 = desligado' }),
        slider('deslocamento', 'Deslocamento (cm)', 0, 5, 0.1, { title: 'Profundidade das juntas pelo mapa de altura (paralaxe; tempo real) — 0 = desligado' }),
        slider('ao', 'Oclusão (AO)', 0, 2, 0.05, { title: 'Escurece juntas e cavidades do padrão — 0 = desligado' })),
      section('Transparência',
        slider('opacidade', 'Opacidade', 0.05, 1, 0.01, { title: 'Opacidade do material inteiro' }),
        check('mapaOpacidade', 'Mapa de opacidade (recorte)', 'Furos e vãos do padrão ficam vazados (chapa perfurada, ripado)'),
        slider('transmissao', 'Vidro (transmissão)', 0, 1, 0.01)),
      section('Emissão',
        color('emissao', 'Cor da emissão', p.emissao),
        slider('intensidadeEmissao', 'Intensidade', 0, 20, 0.1),
        check('mapaEmissao', 'Mapa de emissão', 'Só as faces do padrão emitem luz (juntas apagadas)')));
    const ttl = h('div', { class: 'me-title' }, h('strong', {}, name),
      h('button', { class: 'mini', title: 'Volta aos valores de fábrica deste material', onclick: () => { delete cur().render; applyMaterial(preview, name, cur()); draw(); renderControls(); renderMaps(); } }, 'Restaurar padrão'));
    ctrlBox.prepend(ttl);
    scaleNote.textContent = `Esfera de 1,1 m e cubo de 0,9 m · o padrão repete a cada ${String(p.escala).replace('.', ',')} m`;
  }

  function select(n) {
    name = n;
    preview.name = n;
    applyMaterial(preview, n, work[n]);
    renderList(); renderMaps(); renderControls(); draw();
  }

  const dlg = modal({
    title: 'Editor de materiais',
    body: h('div', { class: 'mat-editor' }, listBox, h('div', { class: 'me-center' }, cv, scaleNote, mapsBox), ctrlBox),
    actions: [
      { label: 'Cancelar' },
      { label: 'Salvar', class: 'primary', action: async () => {
        lib.materials = work;
        lib._mats.clear();
        await lib.save(); // o Render escuta 'change' e atualiza os materiais no lugar
        app.viewer.changed();
        app.renderProps();
        toast('Materiais salvos.');
      } },
    ],
    onClose: () => { preview.dispose(); env.dispose(); pmrem.dispose(); sphereG.dispose(); boxG.dispose(); renderer.dispose(); renderer.forceContextLoss(); },
  });
  dlg.el.classList.add('wide');
  select(name);
  return dlg;
}
