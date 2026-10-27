// HACHURA DOS MATERIAIS — só nas vistas de desenho (preenchimento do corte das plantas e forros).
// Cada material da biblioteca pode ter materials[nome].hachura = { padrao, escala (mm de papel entre linhas), angulo (°),
// cor (linha), fundo (cor do preenchimento) }; sem nada gravado, vale o padrão de fábrica pelo nome do material.
// O desenho é calculado no shader da tampa do corte em coordenadas do MODELO: acompanha a peça ao mover a vista e
// respeita a escala da vista (escala mm × escala/1000 = metros entre linhas).

export const HATCHES = {
  nenhuma: 'Nenhuma (só a cor do corte)', solido: 'Sólido', diagonal: 'Diagonal', cruzada: 'Cruzada',
  concreto: 'Concreto', alvenaria: 'Alvenaria', areia: 'Areia / reboco', isolamento: 'Isolamento',
  madeira: 'Madeira', metal: 'Metal', vidro: 'Vidro', terra: 'Terra',
};
const CODE = Object.fromEntries(Object.keys(HATCHES).map((k, i) => [k, i]));

const BASE = { padrao: 'diagonal', escala: 2.5, angulo: 45, cor: '#2b2b2b', fundo: '#ffffff' };
const DEFAULTS = {
  'Concreto': { padrao: 'concreto', escala: 3 },
  'Contrapiso': { padrao: 'areia', escala: 1.6 },
  'Bloco cerâmico': { padrao: 'alvenaria', escala: 2.2 },
  'Bloco de concreto': { padrao: 'cruzada', escala: 2.5 },
  'Reboco': { padrao: 'areia', escala: 1.2 },
  'Gesso acartonado': { padrao: 'areia', escala: 0.9 },
  'Lã mineral': { padrao: 'isolamento', escala: 3 },
  'Isolamento térmico': { padrao: 'isolamento', escala: 3 },
  'Piso cerâmico': { padrao: 'solido', cor: '#6b6b6b' },
  'Porcelanato': { padrao: 'solido', cor: '#6b6b6b' },
  'Madeira': { padrao: 'madeira', escala: 2, angulo: 0 },
  'Aço': { padrao: 'metal', escala: 1.5 },
  'Vidro': { padrao: 'vidro', escala: 2, angulo: 45, cor: '#4a7fa8' },
  'Impermeabilização': { padrao: 'solido', cor: '#222222' },
  'Telha cerâmica': { padrao: 'diagonal', escala: 1.4 },
  'Terreno': { padrao: 'terra', escala: 3, cor: '#5a4a32' },
  'Fibrocimento': { padrao: 'diagonal', escala: 1.2, angulo: 135 },
  'Genérico': { padrao: 'diagonal', escala: 3 },
};

/** Hachura de um material da biblioteca (base + padrão do nome + o que estiver gravado). */
export function hatchOf(name, def = {}) {
  return { ...BASE, ...(DEFAULTS[name] || {}), ...(def?.hachura || {}) };
}

export const hatchCode = spec => CODE[spec?.padrao] ?? CODE.diagonal;

// ---------------------------------------------------------------- shader da tampa do corte

export const HATCH_VERT = `
varying vec2 vXY;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vXY = w.xy;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

export const HATCH_FRAG = `
uniform vec3 uBg;
uniform vec3 uLine;
uniform int uPattern;
uniform float uSpacing;  // metros entre linhas
uniform float uAngle;    // radianos
uniform float uLinePx;   // espessura da linha em px
varying vec2 vXY;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// 1 sobre uma família de linhas (coordenada t; inteiros = linhas), antisserrilhada
float lines(float t) {
  float d = abs(fract(t + 0.5) - 0.5);
  float w = fwidth(t) * uLinePx * 0.5;
  return 1.0 - smoothstep(w, w + fwidth(t), d);
}
float dots(vec2 q, float density, float r) {
  vec2 c = floor(q);
  float m = 0.0;
  for (int i = 0; i < 2; i++) {
    vec2 o = vec2(hash(c + float(i) * 7.1), hash(c + 3.3 + float(i) * 5.7));
    float on = step(1.0 - density, hash(c + 11.0 + float(i)));
    float d = length(q - c - o);
    float w = fwidth(q.x) * max(uLinePx, 1.0);
    m = max(m, on * (1.0 - smoothstep(r * w, r * w + fwidth(q.x), d)));
  }
  return m;
}
void main() {
  vec2 p = vXY / max(uSpacing, 1e-5);
  float c = cos(uAngle), s = sin(uAngle);
  vec2 q = vec2(c * p.x + s * p.y, -s * p.x + c * p.y);
  float m = 0.0;
  if (uPattern == 1) m = 1.0;                                                    // sólido
  else if (uPattern == 2) m = lines(q.y);                                         // diagonal
  else if (uPattern == 3) m = max(lines(q.y), lines(q.x));                        // cruzada
  else if (uPattern == 4) m = max(lines(q.y * 0.5), dots(p * 1.6, 0.55, 1.4));    // concreto: diagonais espaçadas + agregado
  else if (uPattern == 5) m = max(lines(q.y), lines(q.y + 0.18));                 // alvenaria: pares de diagonais
  else if (uPattern == 6) m = dots(p * 2.2, 0.6, 1.0);                            // areia / reboco
  else if (uPattern == 7) m = lines(q.y + 0.35 * abs(fract(q.x * 0.5) - 0.5) * 4.0 - 0.35); // isolamento: zigue-zague
  else if (uPattern == 8) m = lines(q.y + 0.18 * sin(q.x * 1.3) + 0.08 * sin(q.x * 3.7)); // madeira: veios
  else if (uPattern == 9) m = max(lines(q.y), lines(q.y + 0.12));                 // metal: linhas duplas finas
  else if (uPattern == 10) m = lines(q.y * 0.6) * step(0.55, fract(q.x * 0.35)); // vidro: traços
  else if (uPattern == 11) m = max(lines(q.y), dots(p * 1.4, 0.35, 1.2));         // terra
  gl_FragColor = vec4(mix(uBg, uLine, clamp(m, 0.0, 1.0)), 1.0);
}`;

// ---------------------------------------------------------------- prévia (canvas) para o editor de materiais

/** Desenha a hachura num canvas (aproximação em JS do shader), para o editor. */
export function hatchPreview(spec, size = 120) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = spec.fundo;
  ctx.fillRect(0, 0, size, size);
  const step = Math.max(4, spec.escala * 3.2); // px entre linhas na prévia
  const code = spec.padrao;
  if (code === 'nenhuma') return cv;
  ctx.strokeStyle = ctx.fillStyle = spec.cor;
  ctx.lineWidth = 1;
  if (code === 'solido') { ctx.fillRect(0, 0, size, size); return cv; }
  const rnd = (i => () => { i = (i * 16807) % 2147483647; return i / 2147483647; })(42);
  const dots = (n, r) => { for (let i = 0; i < n; i++) { ctx.beginPath(); ctx.arc(rnd() * size, rnd() * size, r, 0, Math.PI * 2); ctx.fill(); } };
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.rotate(-(spec.angulo || 0) * Math.PI / 180);
  const R = size;
  const family = (gap, offs = [0], wave = null) => {
    for (let y = -R; y <= R; y += gap) for (const o of offs) {
      ctx.beginPath();
      for (let x = -R; x <= R; x += 2) { const yy = y + o * gap + (wave ? wave(x / gap) * gap : 0); x === -R ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy); }
      ctx.stroke();
    }
  };
  switch (code) {
    case 'diagonal': family(step); break;
    case 'cruzada': family(step); ctx.rotate(Math.PI / 2); family(step); break;
    case 'concreto': family(step * 2); ctx.restore(); dots(size * 0.35, 1.1); return cv;
    case 'alvenaria': family(step, [0, 0.18]); break;
    case 'areia': ctx.restore(); dots(size * 0.9, 0.7); return cv;
    case 'isolamento': family(step, [0], t => 0.35 * (Math.abs((t * 0.5) % 1 - 0.5) * 4 - 1)); break;
    case 'madeira': family(step, [0], t => 0.18 * Math.sin(t * 1.3) + 0.08 * Math.sin(t * 3.7)); break;
    case 'metal': family(step, [0, 0.12]); break;
    case 'vidro': ctx.setLineDash([step * 1.2, step * 1.6]); family(step * 1.6); break;
    case 'terra': family(step); ctx.restore(); dots(size * 0.25, 1); return cv;
    default: family(step);
  }
  ctx.restore();
  return cv;
}
