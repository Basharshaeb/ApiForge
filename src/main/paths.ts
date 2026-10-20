import * as path from 'path';

// Compiled layout: dist/src/main/paths.js -> project root is three levels up.
const SRC_DIR = path.join(__dirname, '..');
const PROJECT_ROOT = path.join(SRC_DIR, '..', '..');
const RENDERER_DIR = path.join(SRC_DIR, 'renderer');

export const PATHS = Object.freeze({
  RENDERER_DIR,
  RENDERER_ENTRY: path.join(RENDERER_DIR, 'index.html'),
  PRELOAD: path.join(__dirname, 'preload.js'),
  WORKER_ENTRY: path.join(SRC_DIR, 'runtime', 'worker.js'),
  APP_ICON: path.join(PROJECT_ROOT, 'assets', 'icon.png'),
  DATA_FILE_NAME: 'apiforge-data.json',
  GITHUB_URL: 'https://github.com/Basharshaeb',
  MAX_IMPORT_BYTES: 50 * 1024 * 1024
});
