// PONTE COM O UNREAL ENGINE 5 (render com DLSS).
// O BoxBim roda em WebGL e não alcança o DLSS (SDK nativo da NVIDIA, DirectX 12/Vulkan); o Unreal alcança, pelo
// plugin "NVIDIA DLSS" (Fab / developer.nvidia.com). Aqui o BoxBim:
//   1. acha o Unreal instalado (LauncherInstalled.dat do Epic Launcher) — ou usa o caminho das Configurações;
//   2. cria/atualiza um projeto em <dados>/Unreal/<nome>/ com Lumen, ray tracing em hardware, DX12 e o plugin DLSS
//      marcado como opcional (liga sozinho quando estiver instalado);
//   3. grava o modelo (.glb com materiais PBR, câmera e sol) em Import/ e abre o editor;
//   4. o script Content/Python/init_unreal.py importa a cena (Interchange), monta céu/atmosfera/nuvens e salva o nível.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const store = require('./store');

/** Instalações do Unreal 5 registradas pelo Epic Launcher, da mais nova para a mais velha. */
function findEngines() {
  const dat = path.join(process.env.ProgramData || 'C:\\ProgramData', 'Epic', 'UnrealEngineLauncher', 'LauncherInstalled.dat');
  const out = [];
  try {
    for (const it of JSON.parse(fs.readFileSync(dat, 'utf8')).InstallationList || []) {
      const m = /^UE_(\d+)\.(\d+)$/.exec(it.AppName || '');
      if (!m) continue;
      const exe = path.join(it.InstallLocation, 'Engine', 'Binaries', 'Win64', 'UnrealEditor.exe');
      if (fs.existsSync(exe)) out.push({ version: `${m[1]}.${m[2]}`, root: it.InstallLocation, exe, major: +m[1], minor: +m[2] });
    }
  } catch { /* sem Epic Launcher */ }
  const custom = store.loadSettings().tools?.unrealPath;
  if (custom && fs.existsSync(custom)) {
    const root = path.resolve(custom, '..', '..', '..', '..');
    const v = /UE_(\d+)\.(\d+)/.exec(root);
    out.unshift({ version: v ? `${v[1]}.${v[2]}` : '5', root, exe: custom, major: v ? +v[1] : 5, minor: v ? +v[2] : 0 });
  }
  return out.filter(e => e.major >= 5).sort((a, b) => b.major - a.major || b.minor - a.minor);
}

/** Plugin DLSS instalado no motor (Marketplace/Fab ou cópia manual)? */
function dlssPluginIn(engineRoot) {
  const dirs = [path.join(engineRoot, 'Engine', 'Plugins', 'Marketplace'), path.join(engineRoot, 'Engine', 'Plugins', 'Runtime')];
  for (const d of dirs) {
    try { for (const f of fs.readdirSync(d)) if (/dlss/i.test(f)) return path.join(d, f); } catch { /* ausente */ }
  }
  return null;
}

const editors = new Map(); // projeto → pid do editor aberto pelo BoxBim

const safeName = s => String(s || 'BoxBim').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '') || 'BoxBim';

function uproject(engine) {
  return {
    FileVersion: 3,
    EngineAssociation: engine.version,
    Category: '',
    Description: 'Projeto de visualização gerado pelo BoxBim',
    Plugins: [
      { Name: 'PythonScriptPlugin', Enabled: true },
      { Name: 'EditorScriptingUtilities', Enabled: true },
      { Name: 'Interchange', Enabled: true },      // importação glTF (cena com câmera e luzes)
      { Name: 'InterchangeEditor', Enabled: true },
      { Name: 'InterchangeAssets', Enabled: true },
      // DLSS (Super Resolution, Ray Reconstruction, Frame Generation; DLSS 5 quando a NVIDIA publicar o plugin):
      // opcional — sem o plugin instalado o projeto abre normalmente com TSR
      { Name: 'DLSS', Enabled: true, Optional: true },
      { Name: 'StreamlineCore', Enabled: true, Optional: true },
      { Name: 'StreamlineDLSSG', Enabled: true, Optional: true },
      { Name: 'StreamlineReflex', Enabled: true, Optional: true },
    ],
    TargetPlatforms: ['Windows'],
  };
}

const ENGINE_INI = `[/Script/EngineSettings.GameMapsSettings]
EditorStartupMap=/Game/BoxBim/BoxBim.BoxBim
GameDefaultMap=/Game/BoxBim/BoxBim.BoxBim

[/Script/WindowsTargetPlatform.WindowsTargetSettings]
DefaultGraphicsRHI=DefaultGraphicsRHI_DX12

[/Script/Engine.RendererSettings]
r.DynamicGlobalIlluminationMethod=1
r.ReflectionMethod=1
r.Lumen.HardwareRayTracing=True
r.RayTracing=True
r.SkinCache.CompileShaders=True
r.Shadow.Virtual.Enable=1
r.GenerateMeshDistanceFields=True
r.DefaultFeature.AutoExposure=False
r.AntiAliasingMethod=4
r.DefaultFeature.MotionBlur=False
r.AllowStaticLighting=False

[SystemSettings]
; DLSS (só vale com o plugin NVIDIA DLSS instalado; sem ele o TSR continua)
r.NGX.Enable=1
r.NGX.DLSS.Enable=1
r.NGX.DLSS.DenoiserMode=1
`;

/**
 * Cria/atualiza o projeto e abre o editor.
 * glb: bytes do modelo; meta: { name, settings (sol/céu/exposição), samples }
 */
function openInUnreal(glb, meta = {}) {
  const engines = findEngines();
  if (!engines.length) throw new Error('Unreal Engine 5 não encontrado. Instale pelo Epic Games Launcher ou indique o UnrealEditor.exe em Configurações › Ferramentas.');
  const engine = engines[0];
  const name = safeName(meta.name);
  const dir = path.join(store.loadSettings().dataDir, 'Unreal', name);
  const file = path.join(dir, `${name}.uproject`);
  fs.mkdirSync(path.join(dir, 'Config'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'Content', 'Python'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'Import'), { recursive: true });
  // .uproject: os plugins do BoxBim sempre na versão atual; os que o usuário acrescentou ficam
  const ours = uproject(engine);
  let proj = ours;
  if (fs.existsSync(file)) {
    try {
      const cur = JSON.parse(fs.readFileSync(file, 'utf8'));
      const managed = new Set([...ours.Plugins.map(p => p.Name), 'GLTFImporter']);
      proj = { ...cur, Plugins: [...ours.Plugins, ...(cur.Plugins || []).filter(p => !managed.has(p.Name))] };
    } catch { /* .uproject inválido: recria */ }
  }
  fs.writeFileSync(file, JSON.stringify(proj, null, 2));
  const ini = path.join(dir, 'Config', 'DefaultEngine.ini');
  if (!fs.existsSync(ini)) fs.writeFileSync(ini, ENGINE_INI);
  // o script de importação é sempre o desta versão do BoxBim
  fs.copyFileSync(path.join(__dirname, 'unreal', 'init_unreal.py'), path.join(dir, 'Content', 'Python', 'init_unreal.py'));
  fs.writeFileSync(path.join(dir, 'Import', 'modelo.glb'), Buffer.from(glb));
  const dlss = dlssPluginIn(engine.root);
  fs.writeFileSync(path.join(dir, 'Import', 'boxbim.json'), JSON.stringify({ ...meta, dlss: !!dlss, engine: engine.version, exported: new Date().toISOString() }, null, 2));
  // editor deste projeto já aberto: ele mesmo percebe o modelo novo em Import/ e reimporta
  const running = editors.get(file);
  let alive = false;
  try { alive = !!running && process.kill(running, 0); } catch { alive = false; }
  if (!alive) {
    const child = spawn(engine.exe, [file], { detached: true, stdio: 'ignore', windowsHide: false });
    child.unref();
    editors.set(file, child.pid);
  }
  return { project: file, engine: engine.version, dlssPlugin: dlss, reused: alive };
}

module.exports = { findEngines, dlssPluginIn, openInUnreal };
