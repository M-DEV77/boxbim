// ESTILO DAS LINHAS do desenho 2D: tipo (contínua, tracejada…), espessura (penas em mm, como no CAD) e cor.
//   linha.estilo = { tipo, espessura, cor }  — ausente = padrão (contínua, 0,25 mm, verde)
// A linha "de dados" (fina, contínua) continua no elemento para o clique, a seleção e o DXF; quando o estilo pede
// traços ou espessura, ela fica transparente e um traçado de exibição (LineSegments / LineSegments2) desenha por cima.
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { h } from '../ui.js';

export const DEFAULT_STYLE = { tipo: 'continua', espessura: 0.25, cor: '#2fd18a' };

/** Padrões de traço em metros [traço, espaço, traço, espaço…] (vazio = contínua). */
export const LINE_TYPES = {
  continua: { label: 'Contínua', padrao: [] },
  tracejada: { label: 'Tracejada', padrao: [0.3, 0.15] },
  pontilhada: { label: 'Pontilhada', padrao: [0.02, 0.08] },
  'traco-ponto': { label: 'Traço e ponto (eixo)', padrao: [0.6, 0.1, 0.02, 0.1] },
  'traco-dois-pontos': { label: 'Traço e dois pontos', padrao: [0.6, 0.1, 0.02, 0.1, 0.02, 0.1] },
  'tracejada-longa': { label: 'Tracejada longa', padrao: [0.9, 0.25] },
};
/** Penas (mm), como as espessuras de linha da ABNT/CAD. */
export const PENS = [0.13, 0.18, 0.25, 0.35, 0.5, 0.7, 1.0, 1.4, 2.0];

export const styleOf = l => ({ ...DEFAULT_STYLE, ...(l?.estilo || {}) });
const pxOf = mm => Math.max(1, mm * 4); // 0,25 mm = 1 px na tela

/** Corta a polilinha (pontos 3D) nos traços do padrão; devolve pares [início, fim] para LineSegments. */
function dashSegments(pts, padrao) {
  const out = [];
  if (!padrao.length) { for (let i = 1; i < pts.length; i++) out.push(pts[i - 1], pts[i]); return out; }
  const total = padrao.reduce((s, v) => s + v, 0);
  let k = 0, left = padrao[0], on = true;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], L = a.distanceTo(b);
    let t = 0;
    while (t < L - 1e-9) {
      const step = Math.min(left, L - t);
      if (on) out.push(a.clone().lerp(b, t / L), a.clone().lerp(b, (t + step) / L));
      t += step; left -= step;
      if (left <= 1e-9) { k = (k + 1) % padrao.length; left = padrao[k]; on = k % 2 === 0; }
    }
    if (out.length > 200000 || total <= 0) break; // linha enorme com traço minúsculo: para por segurança
  }
  return out;
}

const _size = new THREE.Vector2();

/**
 * Objetos de exibição para os pontos 3D da linha com o estilo dado.
 * Devolve { base: material da linha de dados, display: objeto extra ou null }.
 */
export function styledLine(pts, estilo) {
  const s = { ...DEFAULT_STYLE, ...(estilo || {}) };
  const padrao = LINE_TYPES[s.tipo]?.padrao || [];
  const px = pxOf(Number(s.espessura) || DEFAULT_STYLE.espessura);
  const thick = px > 1.2;
  const color = new THREE.Color(s.cor || DEFAULT_STYLE.cor);
  if (!padrao.length && !thick) return { base: new THREE.LineBasicMaterial({ color }), display: null };
  const segs = dashSegments(pts, padrao);
  let display;
  if (thick) {
    const geo = new LineSegmentsGeometry().setPositions(segs.flatMap(v => [v.x, v.y, v.z]));
    const mat = new LineMaterial({ color, linewidth: px });
    display = new LineSegments2(geo, mat);
    // a espessura é em pixels: a resolução acompanha o tamanho do canvas
    display.onBeforeRender = renderer => { renderer.getSize(_size); display.material.resolution.set(_size.x, _size.y); };
  } else {
    display = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(segs), new THREE.LineBasicMaterial({ color }));
  }
  Object.assign(display.userData, { isEdge: true, wide: true }); // fora de contornos, cortes e exportações
  display.raycast = () => {};
  // a linha de dados fica invisível (mas clicável e exportável)
  return { base: new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false }), display };
}

/** Controles de estilo (tipo, espessura, cor); onChange(patch). */
export function styleControls(estilo, onChange, { compact = false } = {}) {
  const s = { ...DEFAULT_STYLE, ...(estilo || {}) };
  const tipo = h('select', { title: 'Tipo de linha', onchange: e => onChange({ tipo: e.target.value }) },
    Object.entries(LINE_TYPES).map(([k, t]) => h('option', { value: k, selected: k === s.tipo }, t.label)));
  const pens = PENS.includes(Number(s.espessura)) ? PENS : [...PENS, Number(s.espessura)].sort((a, b) => a - b);
  const esp = h('select', { title: 'Espessura (pena, mm)', onchange: e => onChange({ espessura: Number(e.target.value) }) },
    pens.map(p => h('option', { value: p, selected: p === Number(s.espessura) }, `${String(p).replace('.', ',')} mm`)));
  const cor = h('input', { type: 'color', value: s.cor, title: 'Cor da linha', style: 'width:34px;padding:0 2px', onchange: e => onChange({ cor: e.target.value }) });
  if (compact) return [tipo, esp, cor];
  return [h('label', {}, 'Tipo', tipo), h('label', {}, 'Espessura', esp), h('label', {}, 'Cor', cor)];
}
