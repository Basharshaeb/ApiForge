'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, Menu, nativeTheme } = require('electron');
const path = require('path');
const fsp = require('fs/promises');
const { fileURLToPath } = require('url');
const { Store } = require('./store');
const { RuntimeHost } = require('./runtime-host');

const RENDERER_DIR = path.join(__dirname, '..', 'renderer');
const RENDERER_ENTRY = path.join(RENDERER_DIR, 'index.html');
const WORKER_ENTRY = path.join(__dirname, '..', 'runtime', 'worker.js');
const ASSETS_DIR = path.join(__dirname, '..', '..', 'assets');
const GITHUB_URL = 'https://github.com/Basharshaeb';
const MAX_IMPORT_BYTES = 50 * 1024 * 1024;

let store;
let host;
let mainWindow;
let quitting = false;

// Test hooks: isolate data and drive the UI from a script (see test/smoke.js).
if (process.env.APIFORGE_DATA_DIR) app.setPath('userData', process.env.APIFORGE_DATA_DIR);
const SMOKE = !!process.env.APIFORGE_SMOKE;

/**
 * Only the bundled renderer may call privileged IPC. Postman's shell loads a
 * remote UI with nodeIntegration on; ApiForge keeps the renderer sandboxed and
 * checks the sender frame on every call instead.
 */
function isTrustedSender(event) {
  try {
    const filePath = path.normalize(fileURLToPath(event.senderFrame.url));
    return filePath.startsWith(path.normalize(RENDERER_DIR) + path.sep);
  } catch (_) {
    return false;
  }
}

function handle(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrustedSender(event)) throw new Error(`Blocked IPC "${channel}" from untrusted sender`);
    return fn(event, ...args);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'ApiForge',
    icon: path.join(ASSETS_DIR, 'icon.png'),
    backgroundColor: store.data.settings.theme === 'light' ? '#ffffff' : '#1e1e1e',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  if (SMOKE) attachSmoke(mainWindow);
  mainWindow.loadFile(RENDERER_ENTRY);
}

function attachSmoke(win) {
  const out = (msg) => process.stdout.write(`SMOKE ${JSON.stringify(msg)}\n`);
  win.webContents.on('console-message', (_e, level, message, line, source) => out({ console: { level, message, line, source } }));
  win.webContents.on('preload-error', (_e, preloadPath, error) => out({ preloadError: `${preloadPath}: ${error.message}` }));
  win.webContents.on('render-process-gone', (_e, details) => { out({ renderGone: details }); app.exit(2); });
  win.webContents.once('did-finish-load', async () => {
    let code = 0;
    try {
      const script = await fsp.readFile(process.env.APIFORGE_SMOKE, 'utf8');
      const result = await win.webContents.executeJavaScript(`(async () => { ${script} })()`, true);
      out({ result });
      if (process.env.APIFORGE_SMOKE_SHOT) {
        const image = await win.capturePage();
        await fsp.writeFile(process.env.APIFORGE_SMOKE_SHOT, image.toPNG());
      }
    } catch (err) {
      out({ error: err.message });
      code = 1;
    }
    shutdown();
    app.exit(code);
  });
}

function shutdown() {
  if (quitting) return;
  quitting = true;
  try {
    if (store) store.flushSync();
  } catch (err) {
    console.error('Failed to save data on quit', err);
  }
  if (host) host.close();
}

function buildMenu() {
  const send = (command) => () => mainWindow && mainWindow.webContents.send('menu:command', command);
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'New Request', accelerator: 'CmdOrCtrl+T', click: send('new-request') },
        { label: 'New Collection', click: send('new-collection') },
        { label: 'New Environment', click: send('new-environment') },
        { label: 'New WebSocket Request', click: send('new-websocket') },
        { type: 'separator' },
        { label: 'Import…', accelerator: 'CmdOrCtrl+O', click: send('import') },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: send('save') },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: send('close-tab') },
        { type: 'separator' },
        { label: 'Settings', accelerator: 'CmdOrCtrl+,', click: send('settings') },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Console', accelerator: 'CmdOrCtrl+Alt+C', click: send('toggle-console') },
        { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+\\', click: send('toggle-sidebar') },
        { label: 'Collection Runner', click: send('runner') },
        { label: 'Manage Cookies', click: send('cookies') },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'GitHub: Basharshaeb', click: () => shell.openExternal(GITHUB_URL) },
        { label: 'About ApiForge', click: send('about') }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function readImportFile(filePath) {
  const stat = await fsp.stat(filePath);
  if (stat.size > MAX_IMPORT_BYTES) throw new Error(`${path.basename(filePath)} is larger than 50 MB`);
  return { name: path.basename(filePath), path: filePath, content: await fsp.readFile(filePath, 'utf8') };
}

function registerIpc() {
  handle('store:load', () => store.snapshot());
  handle('store:save', (_e, patch) => { store.updateFromRenderer(patch); return true; });

  handle('runtime:execute', (e, job) => { host.execute(e.sender, job); return true; });
  handle('runtime:abort', (_e, id) => { host.abort(id); return true; });
  handle('ws:connect', (e, options) => { host.wsConnect(e.sender, options); return true; });
  handle('ws:send', (_e, id, data) => { host.wsSend(id, data); return true; });
  handle('ws:close', (_e, id) => { host.wsClose(id); return true; });

  handle('cookies:list', () => host.request('cookies:list'));
  handle('cookies:delete', (_e, cookie) => host.request('cookies:delete', { cookie }));
  handle('cookies:clear', () => host.request('cookies:clear'));

  handle('file:openText', async (_e, { title, filters, multi } = {}) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: title || 'Open',
      properties: multi ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: filters || [{ name: 'All files', extensions: ['*'] }]
    });
    if (result.canceled) return [];
    return Promise.all(result.filePaths.map(readImportFile));
  });

  handle('file:pickPath', async (_e, { title, multi } = {}) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: title || 'Select file',
      properties: multi ? ['openFile', 'multiSelections'] : ['openFile']
    });
    return result.canceled ? [] : result.filePaths;
  });

  handle('file:saveText', async (_e, { defaultName, content, filters, base64 } = {}) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultName || 'export.json',
      filters: filters || [{ name: 'All files', extensions: ['*'] }]
    });
    if (result.canceled || !result.filePath) return null;
    await fsp.writeFile(result.filePath, base64 ? Buffer.from(content, 'base64') : String(content));
    return result.filePath;
  });

  handle('app:info', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
    platform: process.platform,
    dataFile: store.file
  }));

  handle('app:setTheme', (_e, theme) => {
    nativeTheme.themeSource = theme === 'light' ? 'light' : 'dark';
    return true;
  });

  handle('shell:openExternal', (_e, url) => {
    if (/^https?:\/\//i.test(String(url))) shell.openExternal(String(url));
    return true;
  });
}

app.whenReady().then(async () => {
  store = new Store(path.join(app.getPath('userData'), 'apiforge-data.json'));
  await store.load();
  nativeTheme.themeSource = store.data.settings.theme === 'light' ? 'light' : 'dark';

  host = new RuntimeHost(WORKER_ENTRY, {
    initialCookies: store.data.cookieJar,
    onCookiesChanged: (jar) => store.setCookieJar(jar)
  });

  registerIpc();
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', shutdown);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
