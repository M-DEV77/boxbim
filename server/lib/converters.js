// Conversões externas: ponte do Revit (HTTP local), Blender (FBX) e ODA File Converter (DWG).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const store = require('./store');

const tmpDir = () => {
  const d = path.join(os.tmpdir(), 'BoxBim');
  fs.mkdirSync(d, { recursive: true });
  return d;
};

// ---------------------------------------------------------------- Revit

async function revit(route, body, timeoutMs) {
  const port = store.loadSettings().revit.port || 48884;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs || (route === '/status' ? 4000 : 30 * 60 * 1000));
  try {
    const res = await fetch(`http://127.0.0.1:${port}${route}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const json = await res.json().catch(() => ({ ok: false, error: `Resposta inválida (HTTP ${res.status})` }));
    if (!res.ok || json.ok === false) throw new Error(json.error || `HTTP ${res.status}`);
    return json;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(route === '/status'
      ? 'O Revit não respondeu. Ele está aberto, com o add-in BoxBim Bridge carregado e sem caixa de diálogo aberta?'
      : 'Tempo esgotado esperando o Revit.');
    if (e.cause?.code === 'ECONNREFUSED') throw new Error(`Ponte do Revit não encontrada na porta ${port}. Abra o Revit 2025 com o add-in BoxBim Bridge instalado.`);
    throw e;
  } finally { clearTimeout(t); }
}

// ---------------------------------------------------------------- processos

function run(exe, args, timeoutMs = 10 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    execFile(exe, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${path.basename(exe)} falhou: ${(stderr || err.message).toString().slice(-800)}`));
      else resolve(stdout.toString());
    });
  });
}

// ---------------------------------------------------------------- Blender (FBX)

const BLENDER_SCRIPT = `
import bpy, sys
argv = sys.argv[sys.argv.index('--') + 1:]
src, dst = argv[0], argv[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
low = src.lower()
if low.endswith(('.glb', '.gltf')):
    bpy.ops.import_scene.gltf(filepath=src)
elif low.endswith('.fbx'):
    bpy.ops.import_scene.fbx(filepath=src)
elif low.endswith('.obj'):
    bpy.ops.wm.obj_import(filepath=src)
else:
    raise SystemExit('Formato de entrada não suportado: ' + src)
dl = dst.lower()
if dl.endswith('.fbx'):
    bpy.ops.export_scene.fbx(filepath=dst, path_mode='COPY', embed_textures=True, apply_unit_scale=True)
elif dl.endswith('.glb'):
    bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB')
else:
    raise SystemExit('Formato de saída não suportado: ' + dst)
print('BOXBIM_OK', dst)
`;

async function blenderConvert(src, dst) {
  const exe = store.loadSettings().tools.blenderPath;
  if (!exe || !fs.existsSync(exe)) throw new Error('Blender não encontrado. Indique o blender.exe em Configurações › Ferramentas.');
  const script = path.join(tmpDir(), 'boxbim_convert.py');
  fs.writeFileSync(script, BLENDER_SCRIPT);
  const out = await run(exe, ['-b', '--factory-startup', '--python', script, '--', src, dst]);
  if (!fs.existsSync(dst)) throw new Error('O Blender não gerou o arquivo.\n' + out.slice(-800));
  return dst;
}

// ---------------------------------------------------------------- ODA File Converter (DWG <-> DXF)

async function odaConvert(src, outFormat /* 'DXF' | 'DWG' */, outDir, version = 'ACAD2018') {
  const exe = store.loadSettings().tools.odaPath;
  if (!exe || !fs.existsSync(exe)) {
    throw new Error('DWG requer o ODA File Converter (gratuito, opendesign.com). Instale-o e indique o caminho em Configurações › Ferramentas — ou use a ponte do Revit.');
  }
  // O ODA converte pastas inteiras; isolamos o arquivo numa pasta temporária.
  const inDir = fs.mkdtempSync(path.join(tmpDir(), 'oda-in-'));
  const target = outDir || fs.mkdtempSync(path.join(tmpDir(), 'oda-out-'));
  const base = path.basename(src);
  fs.copyFileSync(src, path.join(inDir, base));
  await run(exe, [inDir, target, version, outFormat, '0', '1', base]);
  const out = path.join(target, base.replace(/\.[^.]+$/, '.' + outFormat.toLowerCase()));
  if (!fs.existsSync(out)) throw new Error('O ODA File Converter não gerou ' + path.basename(out));
  return out;
}

module.exports = { revit, blenderConvert, odaConvert, tmpDir };
