// Conversão dos valores de parâmetros de Objetos (sem dependências: usada pelo app e pelo Worker isolado).

/** Converte os valores informados para os tipos declarados, aplicando padrão, mínimo e máximo. */
export function coerceParams(def, values = {}) {
  const out = {};
  for (const p of def.parameters || []) {
    let v = values[p.name] ?? p.default;
    switch (p.type) {
      case 'comprimento': case 'numero': case 'angulo': case 'inteiro': {
        v = Number(String(v ?? '').replace(',', '.'));
        if (!Number.isFinite(v)) v = Number(p.default) || 0;
        if (p.type === 'inteiro') v = Math.round(v);
        if (p.min !== undefined && p.min !== '' && p.min !== null) v = Math.max(Number(p.min), v);
        if (p.max !== undefined && p.max !== '' && p.max !== null) v = Math.min(Number(p.max), v);
        break;
      }
      case 'booleano': v = v === true || v === 'true' || v === 1 || v === '1'; break;
      case 'opcao': {
        const opts = optionList(p);
        v = opts.includes(String(v)) ? String(v) : (opts.includes(String(p.default)) ? String(p.default) : opts[0] ?? '');
        break;
      }
      default: v = v === undefined || v === null ? '' : String(v);
    }
    out[p.name] = v;
  }
  return out;
}

export const optionList = p => (Array.isArray(p.options) ? p.options : String(p.options || '').split(/[;,]/)).map(s => String(s).trim()).filter(Boolean);
