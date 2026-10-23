// Empacota o renderer com esbuild e copia o WASM do web-ifc.
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'renderer', 'dist');
fs.mkdirSync(dist, { recursive: true });
for (const f of ['web-ifc.wasm', 'web-ifc-mt.wasm']) {
  fs.copyFileSync(path.join(root, 'node_modules', 'web-ifc', f), path.join(dist, f));
}

const watch = process.argv.includes('--watch');
const opts = {
  entryPoints: [path.join(root, 'renderer', 'src', 'web', 'main.js')],
  bundle: true,
  outfile: path.join(dist, 'app.js'),
  format: 'iife',
  platform: 'browser',
  target: 'chrome130',
  sourcemap: true,
  logLevel: 'info',
  external: ['fs', 'path', 'crypto', 'worker_threads', 'perf_hooks', 'os', 'url', 'module'],
};
// executor isolado dos scripts de Objetos (Web Worker separado)
const workerOpts = { ...opts, entryPoints: [path.join(root, 'renderer', 'src', 'objects', 'worker.js')], outfile: path.join(dist, 'object-worker.js'), external: [] };
// páginas fora do editor (login, projetos, biblioteca)
const page = name => ({ ...opts, entryPoints: [path.join(root, 'renderer', 'src', 'pages', `${name}.js`)], outfile: path.join(dist, `${name}.js`) });
const run = o => (watch ? esbuild.context(o).then(c => c.watch()) : esbuild.build(o));
Promise.all([run(opts), run(workerOpts), run(page('login')), run(page('projetos')), run(page('biblioteca'))]).catch(() => process.exit(1));
