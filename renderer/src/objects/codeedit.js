// Edição automática do script de um Objeto a partir da prévia: mover/girar uma peça soma o deslocamento
// nas opções { x, y, z, rotX, rotY, rotZ } da chamada g.<função>(…) que a criou.
//
//   g.box(1, 1, 1, { x: 0.5 })         → { x: 0.75 }                (número: novo número)
//   g.box(1, 1, 1, { x: L / 2 })       → { x: L / 2 + 0.25 }        (expressão: soma; repete → acumula)
//   g.object('Barra', {}, { x, y })    → { x: x + 0.25, y }         (forma curta)
//   g.box(1, 1, 1)                     → g.box(1, 1, 1, { x: 0.25 }) (sem opções: cria)

// posição (0-based) do argumento de opções em cada função da API
const OPTS_INDEX = { box: 3, cylinder: 2, sphere: 1, extrude: 2, revolve: 1, object: 2 };
const KEY_ORDER = ['x', 'y', 'z', 'rotX', 'rotY', 'rotZ'];

const fmt = v => {
  const r = Math.round(v * 10000) / 10000;
  return Object.is(r, -0) ? '0' : String(r);
};

/** Varre texto JS a partir de "start" pulando strings e comentários; devolve o índice do fechamento correspondente. */
function scanArgs(src, openIdx) {
  // openIdx aponta para "(" ou "{"; devolve { end, parts: [{ start, end }] } separados por vírgulas de nível 0
  const close = { '(': ')', '{': '}', '[': ']' };
  const stack = [src[openIdx]];
  const parts = [];
  let partStart = openIdx + 1;
  for (let i = openIdx + 1; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2); if (i < 0) return null; i++; continue; }
    if (close[c]) { stack.push(c); continue; }
    if (c === ')' || c === '}' || c === ']') {
      const top = stack.pop();
      if (close[top] !== c) return null;
      if (!stack.length) { parts.push({ start: partStart, end: i }); return { end: i, parts }; }
      continue;
    }
    if (c === ',' && stack.length === 1) { parts.push({ start: partStart, end: i }); partStart = i + 1; }
  }
  return null;
}

/**
 * Aplica deslocamentos na chamada da linha "line" (1-based). changes = { x, y, z, rotX, rotY, rotZ } (somas).
 * Devolve { script, fn } ou lança Error com uma explicação.
 */
export function applyDelta(script, line, changes) {
  const lines = script.split('\n');
  if (!line || line < 1 || line > lines.length) throw new Error('Linha da peça desconhecida.');
  const lineStart = lines.slice(0, line - 1).reduce((s, l) => s + l.length + 1, 0);
  const re = /\bg\.(box|cylinder|sphere|extrude|revolve|object)\s*\(/g;
  re.lastIndex = lineStart;
  const m = re.exec(script);
  if (!m || m.index > lineStart + lines[line - 1].length) throw new Error(`A linha ${line} não tem uma chamada g.box/g.cylinder/g.object… para ajustar.`);
  const fn = m[1];
  const openIdx = m.index + m[0].length - 1;
  const call = scanArgs(script, openIdx);
  if (!call) throw new Error(`Não consegui ler a chamada da linha ${line}.`);
  const args = call.parts.filter(p => script.slice(p.start, p.end).trim() !== '' || call.parts.length > 1);
  const idx = OPTS_INDEX[fn];
  const deltas = KEY_ORDER.filter(k => changes[k] && Math.abs(changes[k]) > 1e-9);
  if (!deltas.length) return { script, fn };

  // sem argumento de opções: cria (completando argumentos intermediários vazios de g.object)
  if (args.length <= idx) {
    const missing = [];
    for (let i = args.length; i < idx; i++) missing.push('{}');
    const obj = `{ ${deltas.map(k => `${k}: ${fmt(changes[k])}`).join(', ')} }`;
    const insertAt = call.end;
    const before = script.slice(0, insertAt).replace(/\s*$/, '');
    const sep = args.length && script.slice(args[args.length - 1].start, args[args.length - 1].end).trim() ? ', ' : '';
    return { script: before + sep + [...missing, obj].join(', ') + script.slice(insertAt), fn };
  }

  const optArg = args[idx];
  const raw = script.slice(optArg.start, optArg.end);
  const braceRel = raw.indexOf('{');
  if (braceRel < 0 || raw.slice(0, braceRel).trim()) {
    throw new Error(`As opções da linha ${line} não são um objeto { … } literal (são "${raw.trim()}"): ajuste o código à mão.`);
  }
  const braceIdx = optArg.start + braceRel;
  const obj = scanArgs(script, braceIdx);
  if (!obj) throw new Error(`Não consegui ler as opções da linha ${line}.`);

  let out = script;
  const edits = []; // [start, end, texto] aplicados de trás para a frente
  const props = obj.parts.filter(p => script.slice(p.start, p.end).trim());
  const remaining = new Set(deltas);
  for (const p of props) {
    const text = script.slice(p.start, p.end);
    const km = /^(\s*)([A-Za-z_$][\w$]*)\s*(:\s*)?([\s\S]*?)(\s*)$/.exec(text);
    if (!km || !remaining.has(km[2])) continue;
    const key = km[2];
    remaining.delete(key);
    const expr = km[3] ? km[4] : key; // forma curta { x }
    edits.push([p.start, p.end, `${km[1]}${key}: ${sumExpr(expr, changes[key])}${km[5]}`]);
  }
  if (remaining.size) {
    const add = [...remaining].map(k => `${k}: ${fmt(changes[k])}`).join(', ');
    const inner = script.slice(braceIdx + 1, obj.end);
    edits.push([braceIdx + 1, braceIdx + 1, inner.trim() ? ` ${add},` : ` ${add} `]);
  }
  for (const [s, e, t] of edits.sort((a, b) => b[0] - a[0])) out = out.slice(0, s) + t + out.slice(e);
  return { script: out, fn };
}

/** expr + d, simplificando números e somas finais já existentes. */
function sumExpr(expr, d) {
  const e = expr.trim();
  if (/^-?\d+(\.\d+)?$/.test(e)) return fmt(Number(e) + d);
  // "… + 0.25" ou "… - 0.1" no fim: acumula no mesmo número
  const tail = /^([\s\S]*?\S)\s*([+-])\s*(\d+(?:\.\d+)?)$/.exec(e);
  if (tail && !/[?:]/.test(tail[1])) {
    const v = (tail[2] === '-' ? -1 : 1) * Number(tail[3]) + d;
    if (Math.abs(v) < 1e-9) return tail[1];
    return `${tail[1]} ${v < 0 ? '-' : '+'} ${fmt(Math.abs(v))}`;
  }
  const base = /[?:,]/.test(e) ? `(${e})` : e;
  return `${base} ${d < 0 ? '-' : '+'} ${fmt(Math.abs(d))}`;
}
