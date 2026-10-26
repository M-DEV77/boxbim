"""Gera renderer/src/icons-tabler.js com só os ícones da Tabler usados pelo BoxBim (traços internos do SVG).

Uso (fora do repositório, sem instalar nada):
    npm pack @tabler/icons@3.49.0
    tar -xzf tabler-icons-3.49.0.tgz -C <pasta>
    python scripts/gen-tabler-icons.py <pasta>/package
"""
import re, os, sys

PKG = sys.argv[1] if len(sys.argv) > 1 else 'package'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'renderer', 'src', 'icons-tabler.js')
VERSION = '3.49.0'

# chave do BoxBim → (ícone Tabler, partes em azul da marca (.b), partes em verde (.g))
MAP = {
    'open': ('folder-open', [0], []),
    'shot': ('camera', [0], [1]),
    'library': ('books', [0, 1], [4]),
    'layers': ('stack-2', [0], [1, 2]),
    'object': ('box', [0], [1, 2, 3]),
    'newObj': ('cube-plus', [0], [4, 5]),
    'budget': ('receipt', [0], []),
    'select': ('pointer', [0], []),
    'trim': ('scissors', [], [0, 1]),
    'move': ('arrows-move', [], [0, 2, 4, 6]),
    'rotate': ('rotate-clockwise-2', [], [0]),
    'undo': ('arrow-back-up', [], [0]),
    'redo': ('arrow-forward-up', [], [0]),
    'copy': ('copy', [0], [1]),
    'mirror': ('flip-vertical', [1, 2], [0]),
    'views': ('device-desktop', [0], [1]),
    'view3d': ('cube', [0], [1, 2, 3]),
    'fit': ('arrows-maximize', [], [0, 2, 4, 6]),
    'look': ('palette', [0], [1, 2, 3]),
    'render': ('sun', [0], [1]),
    'material': ('sphere', [1], [0]),
    'texture': ('texture', [], [2, 4, 6]),
    'rvtIn': ('transfer-in', [], [1, 2]),
    'rvtOut': ('transfer-out', [], [1, 2]),
    'sync': ('plug-connected', [], [4, 5]),
    'ai': ('sparkles', [], [0]),
    'chat': ('message-chatbot', [0], [1, 2, 3]),
    'agent': ('robot', [0], [7, 8]),
    'memory': ('notes', [0], [1, 2, 3]),
    'settings': ('settings', [0], [1]),
    'eye': ('eye', [1], [0]),
}

ELEM = re.compile(r'<(path|circle|rect|line|polyline|polygon|ellipse)([^>]*?)\s*/>')

def inner(name, blue, green):
    s = open(os.path.join(PKG, 'icons', 'outline', f'{name}.svg'), encoding='utf-8').read()
    els = [(t, a.strip()) for t, a in ELEM.findall(s) if 'stroke="none"' not in a]
    out = []
    for i, (t, a) in enumerate(els):
        cls = ' class="b"' if i in blue else ' class="g"' if i in green else ''
        out.append(f'<{t}{cls} {a}/>')
    return ''.join(out)

lines = [
    '// ÍCONES DA TABLER (https://tabler.io/icons, @tabler/icons ' + VERSION + ') — GERADO por scripts/gen-tabler-icons.py; não editar à mão.',
    '// Só os traços dos ícones usados pelo BoxBim; as classes .b (azul da marca) e .g (verde) marcam as partes coloridas.',
    '//',
    '// MIT License — Copyright (c) 2020-2026 Paweł Kuna',
    '// Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated',
    '// documentation files (the "Software"), to deal in the Software without restriction, including without limitation the',
    '// rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit',
    '// persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice',
    '// and this permission notice shall be included in all copies or substantial portions of the Software.',
    '// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE',
    '// WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR',
    '// COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR',
    '// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.',
    '',
    'export const TABLER = {',
]
for key, (name, b, g) in MAP.items():
    lines.append(f"  {key}: '{inner(name, b, g)}', // {name}")
lines.append('};')
lines.append('')
open(OUT, 'w', encoding='utf-8', newline='\n').write('\n'.join(lines))
print(f'{len(MAP)} icones gravados em', OUT)
