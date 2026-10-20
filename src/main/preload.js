'use strict';

/**
 * The renderer's only bridge to privileged code. Every method maps to one
 * validated ipcMain handler in main.js.
 */
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

function subscribe(channel) {
  return (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  };
}

contextBridge.exposeInMainWorld('apiforge', {
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
});
