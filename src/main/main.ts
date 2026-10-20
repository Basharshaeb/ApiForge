/**
 * Electron entry point: wires the store, the runtime worker host, the window,
 * the menu and IPC together, and handles app lifecycle.
 */
import { app, BrowserWindow, nativeTheme } from 'electron';
import * as path from 'path';
import { Store } from './store';
import { RuntimeHost } from './runtime-host';
import { createMainWindow } from './window';
import { installMenu } from './menu';
import { registerIpc } from './ipc';
import { PATHS } from './paths';

// Test hooks: isolate data and drive the UI from a script (see test/smoke.ts).
if (process.env.APIFORGE_DATA_DIR) app.setPath('userData', process.env.APIFORGE_DATA_DIR);
const SMOKE_SCRIPT = process.env.APIFORGE_SMOKE;

let store: Store | undefined;
let host: RuntimeHost | undefined;
let mainWindow: BrowserWindow | undefined;
let shuttingDown = false;

function sendToRenderer(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    if (store) store.flushSync();
  } catch (err) {
    console.error('Failed to save data on quit', err);
  }
  if (host) void host.close();
}

function attachSmokeIfRequested(win: BrowserWindow): void {
  if (!SMOKE_SCRIPT) return;
  // Lazy: only test runs pay for this module.
  const { attachSmoke } = require('./smoke') as typeof import('./smoke'); // eslint-disable-line @typescript-eslint/no-require-imports
  attachSmoke(win, { scriptPath: SMOKE_SCRIPT, screenshotPath: process.env.APIFORGE_SMOKE_SHOT, shutdown });
}

function openWindow(activeStore: Store): void {
  mainWindow = createMainWindow({ theme: activeStore.data.settings.theme, beforeLoad: attachSmokeIfRequested });
}

async function boot(): Promise<void> {
  const activeStore = new Store(path.join(app.getPath('userData'), PATHS.DATA_FILE_NAME));
  store = activeStore;
  await activeStore.load();
  nativeTheme.themeSource = activeStore.data.settings.theme === 'light' ? 'light' : 'dark';

  host = new RuntimeHost(PATHS.WORKER_ENTRY, {
    initialCookies: activeStore.data.cookieJar,
    onCookiesChanged: (jar) => activeStore.setCookieJar(jar)
  });

  registerIpc({ store: activeStore, host, getWindow: () => mainWindow });
  installMenu((command) => sendToRenderer('menu:command', command));
  openWindow(activeStore);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) openWindow(activeStore);
  });
}

void app.whenReady().then(boot);
app.on('before-quit', shutdown);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
