/**
 * Renderer build: bundles src/renderer/boot.ts into one classic script with
 * esbuild and copies the static files next to it. Run after `tsc -p
 * tsconfig.build.json` (see package.json "build").
 */
import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src', 'renderer');
const OUT = path.join(ROOT, 'dist', 'src', 'renderer');
const STATIC_FILES = ['index.html', 'styles.css', 'frame.html'];

async function bundleRenderer(): Promise<void> {
  await esbuild.build({
    entryPoints: [path.join(SRC, 'boot.ts')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['chrome130'],
    outfile: path.join(OUT, 'app.js'),
    sourcemap: true,
    logLevel: 'warning'
  });
}

function copyStatic(): void {
  fs.mkdirSync(OUT, { recursive: true });
  STATIC_FILES.forEach((name) => fs.copyFileSync(path.join(SRC, name), path.join(OUT, name)));
}

bundleRenderer()
  .then(copyStatic)
  .then(() => console.log('renderer bundled -> dist/src/renderer/app.js'))
  .catch((err) => { console.error(err); process.exit(1); });
