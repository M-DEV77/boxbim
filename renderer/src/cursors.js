// PONTEIROS DAS FERRAMENTAS: cada ferramenta tem o seu (regra do projeto — CLAUDE.md › Interface). O ponto exato do
// clique é o centro de uma mira fina (com folga no meio, para ver o que está embaixo); o ícone da ferramenta fica ao
// lado, embaixo à direita. Desenho branco com contorno escuro: aparece em fundo claro e escuro.
//   toolCursor('aparar') → valor para style.cursor (cai em "crosshair" se o navegador não aceitar o SVG).

const ICONS = {
  // edição de linhas
  aparar: '<circle cx="21" cy="26" r="2.6"/><circle cx="27" cy="26" r="2.6"/><path d="M22.6 24 L28.5 16 M25.4 24 L19.5 16"/>',
  estender: '<path d="M17 22 H26 M23 19 L26 22 L23 25"/><path d="M29 16 V28"/>',
  canto: '<path d="M18 28 V22 A5 5 0 0 1 23 17 H29"/>',
  offset: '<path d="M17 27 L28 16"/><path d="M20.5 29.5 L31 19" stroke-dasharray="2 1.6"/>',
  // desenho
  linha: '<path d="M18 28 L29 17"/><circle cx="18" cy="28" r="1.4"/><circle cx="29" cy="17" r="1.4"/>',
  retangulo: '<rect x="18" y="18" width="11" height="9"/>',
  circulo: '<circle cx="23.5" cy="22.5" r="5.5"/><circle cx="23.5" cy="22.5" r=".8"/>',
  arestas: '<path d="M18 21 L23 18 L29 21 L29 27 L23 30 L18 27 Z M23 18 V24 M18 21 L23 24 L29 21"/>',
  eixo: '<path d="M18 28 L21 17 H30 L27 28 Z"/>',
  cota: '<path d="M17 18 V27 M30 18 V27 M17 22.5 H30 M17 22.5 L20 20.5 M17 22.5 L20 24.5 M30 22.5 L27 20.5 M30 22.5 L27 24.5"/>',
  // modelagem
  parede: '<rect x="17" y="19" width="13" height="7"/><path d="M19 26 L24 19 M23 26 L28 19"/>',
  piso: '<path d="M17 23 L23.5 19.5 L30 23 L23.5 26.5 Z"/><path d="M17 23 V25 L23.5 28.5 L30 25 V23"/>',
  telhado: '<path d="M16.5 25 L23.5 18 L30.5 25"/><path d="M19 23 V29 H28 V23"/>',
  inserir: '<path d="M18 20 L23.5 17 L29 20 V26 L23.5 29 L18 26 Z"/><path d="M23.5 21 V26 M21 23.5 H26"/>',
  copiar: '<rect x="17" y="20" width="8" height="8"/><rect x="21" y="16" width="8" height="8"/>',
  espelhar: '<path d="M23.5 15.5 V30" stroke-dasharray="2 1.5"/><path d="M21.5 18 L16.5 23 L21.5 28 Z M25.5 18 L30.5 23 L25.5 28 Z"/>',
  // piso
  arrimo: '<path d="M18 29 V19 H22 V29"/><path d="M22 23 L30 23 M22 26 L30 26" stroke-dasharray="1.6 1.4"/>',
  guia: '<path d="M16 29 L30 15" stroke-dasharray="2.4 1.8"/><path d="M22 29 A6 6 0 0 0 20.2 24.8"/>',
  puxar: '<path d="M21 16 V30"/><path d="M24 23 H31 M28.5 20.5 L31 23 L28.5 25.5"/>',
  ponto: '<path d="M23.5 17 L28.5 22 L23.5 27 L18.5 22 Z"/><path d="M23.5 20 V24 M21.5 22 H25.5"/>',
  hospedeiro: '<circle cx="23.5" cy="23" r="5"/><circle cx="23.5" cy="23" r="1.8"/>',
  'copiar-contorno': '<path d="M17 22 L22 18 H30 V26 L25 29 H17 Z"/><path d="M20 23 h6 v3"/>',
  'copiar-linhas': '<path d="M17 27 L26 18 M21 29 L30 20"/><path d="M27 26 h4 m-2 -2 v4"/>',
};
// modos do desenho 2D do editor de Objetos e outros apelidos
const ALIAS = { arco: 'circulo', polilinha: 'linha', 'linhas-solido': 'arestas' };

const cache = new Map();

/**
 * Valor CSS do ponteiro da ferramenta (mira com o ícone da ferramenta). state 'ok': o ponteiro está sobre algo que a
 * ferramenta pode usar (ícone verde e anel na mira) — dá a noção de acerto antes do clique.
 */
export function toolCursor(name, state = '') {
  const base = ALIAS[name] || name, key = state ? `${base}:${state}` : base;
  if (cache.has(key)) return cache.get(key);
  const ok = state === 'ok';
  const icon = ICONS[base] || '';
  // mira: 4 traços em volta do ponto (12, 12), com folga de 3 px no meio
  const cross = 'M12 1.5 V8.5 M12 15.5 V22.5 M1.5 12 H8.5 M15.5 12 H22.5';
  const g = d => `<path d="${d}"/>`;
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none" stroke-linecap="round" stroke-linejoin="round">'
    + `<g stroke="#10141a" stroke-width="3.4" opacity=".9">${g(cross)}${icon}</g>`
    + `<g stroke="#ffffff" stroke-width="1.4">${g(cross)}</g>`
    + `<g stroke="${ok ? '#39ff6a' : '#ff5fe2'}" stroke-width="1.5">${icon}</g>`
    + (ok ? '<circle cx="12" cy="12" r="4.5" stroke="#39ff6a" stroke-width="1.4"/>' : '')
    + `<circle cx="12" cy="12" r="1" fill="${ok ? '#39ff6a' : '#ff5fe2'}" stroke="none"/>`
    + '</svg>';
  const value = `url("data:image/svg+xml,${encodeURIComponent(svg)}") 12 12, crosshair`;
  cache.set(key, value);
  return value;
}
