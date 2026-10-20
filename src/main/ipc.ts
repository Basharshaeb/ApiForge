import { app, ipcMain, dialog, shell, nativeTheme, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import * as path from 'path';
import * as fsp from 'fs/promises';
import { fileURLToPath } from 'url';
import type { Store } from './store';
import type { RuntimeHost } from './runtime-host';
import type { Job, WsConnectOptions } from '../shared/runtime-protocol';
import type { RendererState, SerializedCookie, Theme } from '../shared/types';
import type { AppInfo, FileFilter, OpenedTextFile } from '../shared/bridge';
import { PATHS } from './paths';

const DEFAULT_FILTER: FileFilter[] = [{ name: 'All files', extensions: ['*'] }];
const HTTP_URL = /^https?:\/\//i;

type Handler = (event: IpcMainInvokeEvent, ...args: any[]) => unknown; // eslint-disable-line @typescript-eslint/no-explicit-any -- IPC payloads are validated per handler

/**
 * Only the bundled renderer may call privileged IPC. Postman's shell loads a
 * remote UI with nodeIntegration on; ApiForge keeps the renderer sandboxed and
 * checks the sender frame on every call instead.
 */
export function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  try {
    const filePath = path.normalize(fileURLToPath(event.senderFrame?.url || ''));
    return filePath.startsWith(path.normalize(PATHS.RENDERER_DIR) + path.sep);
  } catch {
    return false;
  }
}

function handle(channel: string, fn: Handler): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrustedSender(event)) throw new Error(`Blocked IPC "${channel}" from untrusted sender`);
    return fn(event, ...args);
  });
}

async function readImportFile(filePath: string): Promise<OpenedTextFile> {
  const stat = await fsp.stat(filePath);
  if (stat.size > PATHS.MAX_IMPORT_BYTES) throw new Error(`${path.basename(filePath)} is larger than 50 MB`);
  return { name: path.basename(filePath), path: filePath, content: await fsp.readFile(filePath, 'utf8') };
}

const openProperties = (multi?: boolean): Array<'openFile' | 'multiSelections'> => (multi ? ['openFile', 'multiSelections'] : ['openFile']);

function registerStoreHandlers(store: Store): void {
  handle('store:load', () => store.snapshot());
  handle('store:save', (_e, patch: RendererState) => { store.updateFromRenderer(patch); return true; });
}

function registerRuntimeHandlers(host: RuntimeHost): void {
  handle('runtime:execute', (e, job: Job) => { host.execute(e.sender, job); return true; });
  handle('runtime:abort', (_e, id: string) => { host.abort(id); return true; });
  handle('ws:connect', (e, options: WsConnectOptions) => { host.wsConnect(e.sender, options); return true; });
  handle('ws:send', (_e, id: string, data: string) => { host.wsSend(id, data); return true; });
  handle('ws:close', (_e, id: string) => { host.wsClose(id); return true; });
  handle('cookies:list', () => host.request<SerializedCookie[]>('cookies:list'));
  handle('cookies:delete', (_e, cookie: { domain: string; path: string; name: string }) => host.request<boolean>('cookies:delete', { cookie }));
  handle('cookies:clear', () => host.request<boolean>('cookies:clear'));
}

type GetWindow = () => BrowserWindow | undefined;

function registerFileHandlers(getWindow: GetWindow): void {
  const owner = (): BrowserWindow | undefined => getWindow();
  handle('file:openText', async (_e, { title, filters, multi }: { title?: string; filters?: FileFilter[]; multi?: boolean } = {}) => {
    const win = owner();
    const options = { title: title || 'Open', properties: openProperties(multi), filters: filters || DEFAULT_FILTER };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    return result.canceled ? [] : Promise.all(result.filePaths.map(readImportFile));
  });
  handle('file:pickPath', async (_e, { title, multi }: { title?: string; multi?: boolean } = {}) => {
    const win = owner();
    const options = { title: title || 'Select file', properties: openProperties(multi) };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    return result.canceled ? [] : result.filePaths;
  });
  handle('file:saveText', async (_e, { defaultName, content, filters, base64 }: { defaultName?: string; content: string; filters?: FileFilter[]; base64?: boolean }) => {
    const win = owner();
    const options = { defaultPath: defaultName || 'export.json', filters: filters || DEFAULT_FILTER };
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return null;
    await fsp.writeFile(result.filePath, base64 ? Buffer.from(content, 'base64') : String(content));
    return result.filePath;
  });
}

function registerAppHandlers(store: Store): void {
  handle('app:info', (): AppInfo => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
    platform: process.platform,
    dataFile: store.file
  }));
  handle('app:setTheme', (_e, theme: Theme) => { nativeTheme.themeSource = theme === 'light' ? 'light' : 'dark'; return true; });
  handle('shell:openExternal', (_e, url: string) => { if (HTTP_URL.test(String(url))) void shell.openExternal(String(url)); return true; });
}

export function registerIpc({ store, host, getWindow }: { store: Store; host: RuntimeHost; getWindow: GetWindow }): void {
  registerStoreHandlers(store);
  registerRuntimeHandlers(host);
  registerFileHandlers(getWindow);
  registerAppHandlers(store);
}
