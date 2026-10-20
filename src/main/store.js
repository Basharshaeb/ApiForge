'use strict';

/**
 * Single-file JSON persistence for workspace data. Postman keeps this state in
 * IndexedDB / NeDB inside per-user Electron partitions; a local client only
 * needs one atomic, debounced JSON document in userData.
 */
const fs = require('fs');
const fsp = require('fs/promises');

const RENDERER_KEYS = ['collections', 'environments', 'globals', 'history', 'settings', 'ui'];

function defaults() {
  return {
    version: 1,
    collections: [],
    environments: [],
    globals: { values: [] },
    history: [],
    settings: {
      activeEnvironmentId: null,
      strictSSL: true,
      followRedirects: true,
      requestTimeout: 0,
      theme: 'dark',
      historyLimit: 200
    },
    ui: { tabs: [], activeTabId: null, sidebar: 'collections' },
    cookieJar: null
  };
}

class Store {
  constructor(file) {
    this.file = file;
    this.data = defaults();
    this._timer = null;
    this._writing = Promise.resolve();
  }

  async load() {
    try {
      const parsed = JSON.parse(await fsp.readFile(this.file, 'utf8'));
      const base = defaults();
      this.data = { ...base, ...parsed, settings: { ...base.settings, ...(parsed.settings || {}) } };
    } catch (err) {
      if (err.code !== 'ENOENT') {
        // Keep the unreadable file for recovery instead of overwriting it.
        await fsp.rename(this.file, `${this.file}.corrupt-${Date.now()}`).catch(() => {});
      }
      this.data = defaults();
    }
    return this.data;
  }

  /** Renderer-facing data (the cookie jar stays in the main process). */
  snapshot() {
    const out = {};
    RENDERER_KEYS.forEach((k) => { out[k] = this.data[k]; });
    return out;
  }

  updateFromRenderer(patch) {
    if (!patch || typeof patch !== 'object') return;
    RENDERER_KEYS.forEach((k) => {
      if (Object.prototype.hasOwnProperty.call(patch, k)) this.data[k] = patch[k];
    });
    this._schedule();
  }

  setCookieJar(serialized) {
    this.data.cookieJar = serialized;
    this._schedule();
  }

  _schedule() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => { this._timer = null; this.flush(); }, 400);
  }

  flush() {
    const json = JSON.stringify(this.data);
    const tmp = `${this.file}.tmp`;
    this._writing = this._writing
      .then(() => fsp.writeFile(tmp, json))
      .then(() => fsp.rename(tmp, this.file))
      .catch((err) => console.error('Store flush failed', err));
    return this._writing;
  }

  flushSync() {
    clearTimeout(this._timer);
    this._timer = null;
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }

  get pending() {
    return this._timer !== null;
  }
}

module.exports = { Store };
