/**
 * The renderer's only bridge to privileged code. Every method maps to one
 * validated ipcMain handler in ipc.ts. Runs sandboxed: only `electron` may be
 * required here.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { ApiForgeBridge } from '../shared/bridge';

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args) as Promise<T>;

function subscribe<T>(channel: string) {
  return (callback: (payload: T) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, payload: T): void => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  };
}

const bridge: ApiForgeBridge = {
  platform: process.platform,
  store: {
    load: () => invoke('store:load'),
    save: (patch) => invoke('store:save', patch)
  },
  runtime: {
    execute: (job) => invoke('runtime:execute', job),
    abort: (id) => invoke('runtime:abort', id),
    onEvent: subscribe('runtime:event')
  },
  ws: {
    connect: (options) => invoke('ws:connect', options),
    send: (id, data) => invoke('ws:send', id, data),
    close: (id) => invoke('ws:close', id)
  },
  cookies: {
    list: () => invoke('cookies:list'),
    remove: (cookie) => invoke('cookies:delete', cookie),
    clear: () => invoke('cookies:clear')
  },
  files: {
    openText: (options) => invoke('file:openText', options),
    pickPath: (options) => invoke('file:pickPath', options),
    saveText: (options) => invoke('file:saveText', options)
  },
  app: {
    info: () => invoke('app:info'),
    setTheme: (theme) => invoke('app:setTheme', theme),
    openExternal: (url) => invoke('shell:openExternal', url),
    onMenuCommand: subscribe('menu:command')
  }
};

contextBridge.exposeInMainWorld('apiforge', bridge);
