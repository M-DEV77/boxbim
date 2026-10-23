// Gera os Objetos de fábrica (defaults/objetos/*.bbo). Uso: node scripts/make-default-objects.js
const fs = require('fs');
const path = require('path');

const out = path.join(__dirname, '..', 'defaults', 'objetos');
fs.mkdirSync(out, { recursive: true });

const P = (name, label, type, def, extra = {}) => ({ name, label, type, default: def, ...extra });
const objects = [
  {
    id: 'mesa-retangular', name: 'Mesa retangular', category: 'IfcFurniture',
    description: 'Mesa com tampo e quatro pernas, com recuo configurável.',
    parameters: [
      P('largura', 'Largura', 'comprimento', 1.6, { min: 0.6, max: 4, group: 'Dimensões' }),
      P('profundidade', 'Profundidade', 'comprimento', 0.9, { min: 0.4, max: 2, group: 'Dimensões' }),
      P('altura', 'Altura', 'comprimento', 0.75, { min: 0.4, max: 1.2, group: 'Dimensões' }),
      P('tampo', 'Espessura do tampo', 'comprimento', 0.03, { min: 0.015, max: 0.1, group: 'Construção' }),
      P('perna', 'Seção da perna', 'comprimento', 0.05, { min: 0.03, max: 0.15, group: 'Construção' }),
      P('recuo', 'Recuo das pernas', 'comprimento', 0.05, { min: 0, max: 0.3, group: 'Construção' }),
      P('matTampo', 'Material do tampo', 'material', 'Madeira', { group: 'Materiais' }),
      P('matPerna', 'Material das pernas', 'material', 'Aço', { group: 'Materiais' }),
    ],
    script: `// Mesa: tampo apoiado em quatro pernas
const t = p.tampo, hp = p.altura - t;
g.box(p.largura, p.profundidade, t, { z: hp, material: p.matTampo, name: 'Tampo' });
const dx = p.largura / 2 - p.recuo - p.perna / 2;
const dy = p.profundidade / 2 - p.recuo - p.perna / 2;
for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
  g.box(p.perna, p.perna, hp, { x: sx * dx, y: sy * dy, material: p.matPerna, name: 'Perna' });
}
`,
  },
  {
    id: 'cadeira', name: 'Cadeira', category: 'IfcFurniture',
    description: 'Cadeira com assento, pernas traseiras prolongadas e encosto em ripas.',
    parameters: [
      P('largura', 'Largura', 'comprimento', 0.45, { min: 0.35, max: 0.7, group: 'Dimensões' }),
      P('profundidade', 'Profundidade', 'comprimento', 0.48, { min: 0.35, max: 0.7, group: 'Dimensões' }),
      P('alturaAssento', 'Altura do assento', 'comprimento', 0.45, { min: 0.3, max: 0.8, group: 'Dimensões' }),
      P('alturaEncosto', 'Altura total', 'comprimento', 0.9, { min: 0.6, max: 1.3, group: 'Dimensões' }),
      P('espessura', 'Espessura', 'comprimento', 0.03, { min: 0.015, max: 0.06, group: 'Construção' }),
      P('perna', 'Seção da perna', 'comprimento', 0.035, { min: 0.02, max: 0.06, group: 'Construção' }),
      P('ripas', 'Ripas do encosto', 'inteiro', 3, { min: 1, max: 6, group: 'Construção' }),
      P('material', 'Material', 'material', 'Madeira', { group: 'Materiais' }),
    ],
    script: `// Cadeira: o encosto fica no lado +Y
const e = p.espessura, s = p.perna, hs = p.alturaAssento - e;
g.box(p.largura, p.profundidade, e, { z: hs, material: p.material, name: 'Assento' });
const dx = p.largura / 2 - s / 2, dy = p.profundidade / 2 - s / 2;
for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
  // as pernas de trás sobem até o topo do encosto
  g.box(s, s, sy > 0 ? p.alturaEncosto : hs, { x: sx * dx, y: sy * dy, material: p.material, name: 'Perna' });
}
const hEnc = p.alturaEncosto - p.alturaAssento;
for (let i = 0; i < p.ripas; i++) {
  const z = p.alturaAssento + hEnc * (0.35 + 0.55 * i / Math.max(1, p.ripas - 1)) - 0.03;
  g.box(p.largura - 2 * s, e, 0.06, { y: dy, z, material: p.material, name: 'Ripa do encosto' });
}
`,
  },
  {
    id: 'porta-simples', name: 'Porta simples', category: 'IfcDoor', revision: 2,
    description: 'Porta de giro com marco, folha e ângulo de abertura. Hospedada em parede: abre o vão e o marco acompanha a espessura da parede.',
    parameters: [
      P('largura', 'Largura do vão', 'comprimento', 0.8, { min: 0.6, max: 1.2, group: 'Dimensões' }),
      P('altura', 'Altura do vão', 'comprimento', 2.1, { min: 1.9, max: 2.6, group: 'Dimensões' }),
      P('espessuraParede', 'Espessura do marco (parede)', 'comprimento', 0.15, { min: 0.07, max: 0.4, group: 'Dimensões' }),
      P('marco', 'Largura do marco', 'comprimento', 0.05, { min: 0.03, max: 0.12, group: 'Construção' }),
      P('folha', 'Espessura da folha', 'comprimento', 0.035, { min: 0.025, max: 0.06, group: 'Construção' }),
      P('abertura', 'Ângulo de abertura', 'angulo', 0, { min: 0, max: 90, group: 'Construção' }),
      P('macaneta', 'Maçaneta', 'booleano', true, { group: 'Construção' }),
      P('matFolha', 'Material da folha', 'material', 'Madeira', { group: 'Materiais' }),
      P('matMarco', 'Material do marco', 'material', 'Madeira', { group: 'Materiais' }),
    ],
    script: `// Porta: marco (batentes + travessa) e folha girando na dobradiça esquerda
const L = p.largura, H = p.altura, m = p.marco, w = p.espessuraParede;
g.box(m, w, H + m, { x: -(L / 2 + m / 2), material: p.matMarco, name: 'Batente' });
g.box(m, w, H + m, { x: L / 2 + m / 2, material: p.matMarco, name: 'Batente' });
g.box(L, w, m, { z: H, material: p.matMarco, name: 'Travessa' });
g.opening(L + 2 * m, H + m);   // vão aberto na parede hospedeira (vão luz + marco)
g.at({ x: -L / 2, y: -w / 2 + p.folha / 2 + 0.01, rotZ: p.abertura }, () => {
  g.box(L, p.folha, H - 0.01, { x: L / 2, material: p.matFolha, name: 'Folha' });
  if (p.macaneta) {
    for (const lado of [-1, 1]) g.sphere(0.025, { x: L - 0.07, y: lado * (p.folha / 2 + 0.03), z: 1.0, color: '#c8c8c8', name: 'Maçaneta' });
  }
});
g.log('Vão luz:', L.toFixed(2), 'x', H.toFixed(2), 'm');
`,
  },
  {
    id: 'janela-correr', name: 'Janela de correr', category: 'IfcWindow', revision: 2,
    description: 'Janela de correr com caixilho, 2 a 4 folhas em trilhos alternados e peitoril. Hospedada em parede: abre o vão a partir do peitoril.',
    parameters: [
      P('largura', 'Largura', 'comprimento', 1.2, { min: 0.4, max: 4, group: 'Dimensões' }),
      P('altura', 'Altura', 'comprimento', 1.0, { min: 0.3, max: 2.5, group: 'Dimensões' }),
      P('peitoril', 'Peitoril', 'comprimento', 1.1, { min: 0, max: 2, group: 'Dimensões' }),
      P('folhas', 'Folhas', 'inteiro', 2, { min: 2, max: 4, group: 'Construção' }),
      P('profundidade', 'Profundidade do caixilho', 'comprimento', 0.08, { min: 0.04, max: 0.2, group: 'Construção' }),
      P('perfil', 'Largura do perfil', 'comprimento', 0.04, { min: 0.02, max: 0.1, group: 'Construção' }),
      P('matCaixilho', 'Caixilho', 'material', 'Aço', { group: 'Materiais' }),
      P('matVidro', 'Vidro', 'material', 'Vidro', { group: 'Materiais' }),
    ],
    script: `// Janela de correr: moldura + folhas alternando entre dois trilhos
const L = p.largura, H = p.altura, z0 = p.peitoril, d = p.profundidade, f = p.perfil;
g.box(L, d, f, { z: z0, material: p.matCaixilho, name: 'Caixilho inferior' });
g.box(L, d, f, { z: z0 + H - f, material: p.matCaixilho, name: 'Caixilho superior' });
g.box(f, d, H, { x: -L / 2 + f / 2, z: z0, material: p.matCaixilho, name: 'Caixilho lateral' });
g.box(f, d, H, { x: L / 2 - f / 2, z: z0, material: p.matCaixilho, name: 'Caixilho lateral' });
g.opening(L, H, { sill: z0 });  // vão aberto na parede hospedeira, a partir do peitoril
const n = p.folhas, vao = L - 2 * f, lf = vao / n + f / 2, hh = H - 2 * f;
for (let i = 0; i < n; i++) {
  const x = -L / 2 + f + vao * (i + 0.5) / n;
  const y = (i % 2 ? 1 : -1) * d / 4;
  g.box(lf - f, 0.008, hh - f, { x, y, z: z0 + f + f / 2, material: p.matVidro, name: 'Vidro' });
  g.box(f / 2, d / 2.5, hh, { x: x - lf / 2 + f / 4, y, z: z0 + f, material: p.matCaixilho, name: 'Perfil da folha' });
  g.box(f / 2, d / 2.5, hh, { x: x + lf / 2 - f / 4, y, z: z0 + f, material: p.matCaixilho, name: 'Perfil da folha' });
}
g.log('Área de ventilação ≈', (vao * hh * (n - 1) / n).toFixed(2), 'm²');
`,
  },
  {
    id: 'estante', name: 'Estante', category: 'IfcFurniture',
    description: 'Estante com laterais, prateleiras distribuídas igualmente e fundo opcional.',
    parameters: [
      P('largura', 'Largura', 'comprimento', 0.9, { min: 0.3, max: 3, group: 'Dimensões' }),
      P('altura', 'Altura', 'comprimento', 1.8, { min: 0.4, max: 3, group: 'Dimensões' }),
      P('profundidade', 'Profundidade', 'comprimento', 0.35, { min: 0.2, max: 0.8, group: 'Dimensões' }),
      P('espessura', 'Espessura das chapas', 'comprimento', 0.018, { min: 0.012, max: 0.05, group: 'Construção' }),
      P('prateleiras', 'Prateleiras internas', 'inteiro', 4, { min: 0, max: 10, group: 'Construção' }),
      P('fundo', 'Com fundo', 'booleano', true, { group: 'Construção' }),
      P('material', 'Material', 'material', 'Madeira', { group: 'Materiais' }),
    ],
    script: `// Estante: base, tampo e prateleiras igualmente espaçadas entre duas laterais
const e = p.espessura, L = p.largura, H = p.altura, D = p.profundidade;
g.box(e, D, H, { x: -L / 2 + e / 2, material: p.material, name: 'Lateral' });
g.box(e, D, H, { x: L / 2 - e / 2, material: p.material, name: 'Lateral' });
const n = p.prateleiras + 1;
for (let i = 0; i <= n; i++) {
  g.box(L - 2 * e, D, e, { z: (H - e) * i / n, material: p.material, name: i === 0 ? 'Base' : i === n ? 'Tampo' : 'Prateleira' });
}
if (p.fundo) g.box(L, 0.006, H, { y: D / 2 - 0.003, material: p.material, name: 'Fundo' });
g.log('Vão livre entre prateleiras:', ((H - e) / n - e).toFixed(3), 'm');
`,
  },
  {
    id: 'escada-reta', name: 'Escada reta', category: 'IfcStair',
    description: 'Escada reta maciça: calcula o número de degraus pela altura a vencer e o espelho máximo, e confere a fórmula de Blondel. Sobe no sentido +Y.',
    parameters: [
      P('largura', 'Largura', 'comprimento', 1.2, { min: 0.6, max: 3, group: 'Dimensões' }),
      P('alturaTotal', 'Altura a vencer', 'comprimento', 3.0, { min: 0.3, max: 6, group: 'Dimensões' }),
      P('espelhoMax', 'Espelho máximo', 'comprimento', 0.18, { min: 0.15, max: 0.19, group: 'Degraus' }),
      P('piso', 'Piso (pisada)', 'comprimento', 0.28, { min: 0.25, max: 0.32, group: 'Degraus' }),
      P('laje', 'Espessura da laje', 'comprimento', 0.12, { min: 0.08, max: 0.25, group: 'Construção' }),
      P('material', 'Material', 'material', 'Concreto', { group: 'Materiais' }),
    ],
    script: `// Escada reta: perfil dos degraus no plano YZ, extrudado na largura (eixo X)
const n = Math.ceil(p.alturaTotal / p.espelhoMax);
const e = p.alturaTotal / n, s = p.piso, H = p.alturaTotal, Lh = n * s;
const pts = [[0, 0]];
for (let i = 0; i < n; i++) pts.push([i * s, (i + 1) * e], [(i + 1) * s, (i + 1) * e]);
pts.push([Lh, H - p.laje], [Lh * p.laje / H, 0]);   // fundo inclinado paralelo à linha dos degraus
g.extrude(pts, p.largura, { plane: 'yz', x: -p.largura / 2, material: p.material, name: 'Escada' });
const blondel = 2 * e + s;
g.log(n, 'degraus · espelho', e.toFixed(3), 'm · piso', s.toFixed(2), 'm · projeção', Lh.toFixed(2), 'm');
g.log('Blondel 2e + p =', blondel.toFixed(3), 'm', blondel >= 0.63 && blondel <= 0.64 ? '(ok)' : '(fora de 0,63–0,64)');
`,
  },
];

// ---- armadura e pilar de concreto armado (objetos aninhados com parâmetros compartilhados)
objects.push(
  {
    id: 'barra-de-aco', name: 'Barra de aço', category: 'IfcReinforcingBar',
    description: 'Vergalhão reto vertical (sobe em Z a partir da origem). Usado dentro do Pilar de concreto armado.',
    parameters: [
      P('diametro', 'Diâmetro (bitola)', 'comprimento', 0.0125, { min: 0.005, max: 0.04, group: 'Barra' }),
      P('comprimento', 'Comprimento', 'comprimento', 3, { min: 0.1, max: 12, group: 'Barra' }),
      P('aco', 'Aço', 'material', 'Aço', { group: 'Materiais' }),
    ],
    script: `// Barra de aço (vergalhão): cilindro vertical a partir da origem
g.cylinder(p.diametro / 2, p.comprimento, { material: p.aco, segments: 12, name: 'Barra Ø' + (p.diametro * 1000).toFixed(1) + ' mm' });
`,
  },
  {
    id: 'estribo', name: 'Estribo', category: 'IfcReinforcingBar',
    description: 'Estribo retangular horizontal centrado na origem (largura em X, profundidade em Y).',
    parameters: [
      P('largura', 'Largura (eixo das barras)', 'comprimento', 0.19, { min: 0.05, max: 2, group: 'Estribo' }),
      P('profundidade', 'Profundidade (eixo das barras)', 'comprimento', 0.34, { min: 0.05, max: 2, group: 'Estribo' }),
      P('diametro', 'Diâmetro (bitola)', 'comprimento', 0.005, { min: 0.004, max: 0.02, group: 'Estribo' }),
      P('aco', 'Aço', 'material', 'Aço', { group: 'Materiais' }),
    ],
    script: `// Estribo: quatro trechos de barra formando um retângulo no plano XY
const r = p.diametro / 2, L = p.largura, P = p.profundidade;
for (const sy of [-1, 1]) g.cylinder(r, L, { x: -L / 2, y: sy * P / 2, rotY: 90, material: p.aco, segments: 8, name: 'Estribo' });
for (const sx of [-1, 1]) g.cylinder(r, P, { x: sx * L / 2, y: -P / 2, rotX: -90, material: p.aco, segments: 8, name: 'Estribo' });
`,
  },
  {
    id: 'pilar-concreto-armado', name: 'Pilar de concreto armado', category: 'IfcColumn',
    description: 'Pilar com barras longitudinais e estribos como objetos aninhados. O diâmetro das barras e o aço são compartilhados com a Barra de aço.',
    parameters: [
      P('largura', 'Largura', 'comprimento', 0.25, { min: 0.14, max: 1.5, group: 'Seção' }),
      P('profundidade', 'Profundidade', 'comprimento', 0.4, { min: 0.14, max: 2, group: 'Seção' }),
      P('altura', 'Altura', 'comprimento', 3, { min: 0.5, max: 12, group: 'Seção' }),
      P('cobrimento', 'Cobrimento', 'comprimento', 0.03, { min: 0.015, max: 0.08, group: 'Armadura' }),
      P('diametro', 'Diâmetro das barras (compartilhado)', 'comprimento', 0.0125, { min: 0.008, max: 0.04, group: 'Armadura' }),
      P('barrasX', 'Barras na largura', 'inteiro', 2, { min: 2, max: 8, group: 'Armadura' }),
      P('barrasY', 'Barras na profundidade', 'inteiro', 3, { min: 2, max: 10, group: 'Armadura' }),
      P('diametroEstribo', 'Diâmetro do estribo', 'comprimento', 0.005, { min: 0.004, max: 0.016, group: 'Armadura' }),
      P('espacamento', 'Espaçamento dos estribos', 'comprimento', 0.15, { min: 0.05, max: 0.3, group: 'Armadura' }),
      P('verArmadura', 'Concreto translúcido (ver armadura)', 'booleano', true, { group: 'Exibição' }),
      P('concreto', 'Concreto', 'material', 'Concreto', { group: 'Materiais' }),
      P('aco', 'Aço (compartilhado)', 'material', 'Aço', { group: 'Materiais' }),
    ],
    script: `// Pilar de concreto armado: concreto + barras (objeto "Barra de aço") + estribos (objeto "Estribo").
// "diametro" e "aco" têm o mesmo nome na Barra de aço: são compartilhados e passam sozinhos.
const L = p.largura, P = p.profundidade, H = p.altura, c = p.cobrimento;
g.box(L, P, H, { material: p.concreto, opacity: p.verArmadura ? 0.3 : 1, name: 'Concreto' });

// barras longitudinais no contorno, afastadas pelo cobrimento + estribo
const e = c + p.diametroEstribo + p.diametro / 2;
const xs = Array.from({ length: p.barrasX }, (_, i) => -L / 2 + e + i * (L - 2 * e) / (p.barrasX - 1));
const ys = Array.from({ length: p.barrasY }, (_, j) => -P / 2 + e + j * (P - 2 * e) / (p.barrasY - 1));
let barras = 0;
xs.forEach((x, i) => ys.forEach((y, j) => {
  if (i > 0 && i < xs.length - 1 && j > 0 && j < ys.length - 1) return; // só o contorno
  g.object('Barra de aço', { comprimento: H - 2 * c }, { x, y, z: c });
  barras++;
}));

// estribos ao longo da altura (aqui o diâmetro é informado: vale o do estribo, não o compartilhado)
const n = Math.floor((H - 2 * c) / p.espacamento) + 1;
for (let k = 0; k < n; k++) {
  g.object('Estribo', {
    largura: L - 2 * c - p.diametroEstribo, profundidade: P - 2 * c - p.diametroEstribo, diametro: p.diametroEstribo,
  }, { z: c + k * p.espacamento });
}

const area = barras * Math.PI * (p.diametro / 2) ** 2;
g.log(barras, 'barras Ø', (p.diametro * 1000).toFixed(1), 'mm ·', n, 'estribos · taxa de armadura', (100 * area / (L * P)).toFixed(2), '%');
`,
  },
);

for (const o of objects) {
  const data = { format: 'boxbim-objeto', version: 1, revision: 1, author: 'BoxBim', created: '2026-10-21', ...o };
  fs.writeFileSync(path.join(out, `${o.id}.bbo`), JSON.stringify(data, null, 2));
}
console.log(`${objects.length} objetos gerados em ${out}`);
