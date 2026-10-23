// UNIDADE DE COMPRIMENTO do projeto (m, cm ou mm): só a exibição e a digitação mudam — os dados continuam em metros.
// Fica nos dados do projeto (dados.unidade, sincroniza com quem está no projeto) e no rodapé (seletor m/cm/mm).
export const UNITS = {
  m: { f: 1, dec: 2, label: 'm', step: '0.01' },
  cm: { f: 100, dec: 1, label: 'cm', step: '0.1' },
  mm: { f: 1000, dec: 0, label: 'mm', step: '1' },
};

export const units = new EventTarget();
let unit = 'm';

export const getUnit = () => unit;
export const unitLabel = () => UNITS[unit].label;
export const unitStep = () => UNITS[unit].step;

export function setUnit(u) {
  if (!UNITS[u] || u === unit) return;
  unit = u;
  units.dispatchEvent(new Event('change'));
}

/** Metros → número na unidade (arredondado para a precisão dela, sem perder o que foi digitado). */
export const toUnit = m => +(Number(m) * UNITS[unit].f).toFixed(Math.max(UNITS[unit].dec, 3));
/** Número na unidade → metros. */
export const fromUnit = v => Number(v) / UNITS[unit].f;

/** "3,25" (m) · "325,0" (cm) · "3250" (mm); com suffix: "3,25 m". */
export function fmtLen(m, { suffix = false, dec } = {}) {
  const u = UNITS[unit];
  const s = (Number(m) * u.f).toFixed(dec ?? u.dec).replace('.', ',');
  return suffix ? `${s} ${u.label}` : s;
}

/** Nomes de propriedades que são comprimentos (o painel mostra na unidade do projeto). */
export const LENGTH_PROPS = new Set(['Comprimento', 'Altura', 'Espessura', 'Largura', 'Profundidade', 'Base', 'Raio', 'Cota', 'Topo', 'Caminho']);
