'use strict';

/**
 * Owns the runtime worker and routes its events to the renderer that started
 * each run or socket (Postman's main process does the same between the
 * "agent2" IPC channel and AgentWorker.js). Restarts the worker if it dies and
 * fails any work that was in flight.
 */
const { Worker } = require('worker_threads');

class RuntimeHost {
  constructor(workerPath, { onCookiesChanged, initialCookies } = {}) {
    this.workerPath = workerPath;
    this.onCookiesChanged = onCookiesChanged || (() => {});
    this.cookies = initialCookies || null;
    this.owners = new Map(); // run / socket id -> webContents
    this.watched = new WeakSet();
    this.pending = new Map(); // reqId -> { resolve, reject }
    this.nextReqId = 1;
    this.closing = false;
    this._spawn();
  }

  _spawn() {
    const worker = new Worker(this.workerPath);
    this.worker = worker;
    if (this.cookies) worker.postMessage({ action: 'cookies:load', data: this.cookies });

    worker.on('message', (msg) => this._onMessage(msg));
    worker.on('error', (err) => console.error('Runtime worker error', err));
    worker.on('exit', (code) => {
      if (this.worker !== worker) return;
      this._failInFlight(`Runtime worker exited (code ${code})`);
      if (!this.closing) setTimeout(() => this._spawn(), 250);
    });
  }

  _onMessage(msg) {
    if (!msg) return;
    if (msg.reqId !== undefined) {
      const p = this.pending.get(msg.reqId);
      if (!p) return;
      this.pending.delete(msg.reqId);
      if (msg.error) p.reject(new Error(msg.error));
      else p.resolve(msg.result);
      return;
    }
    if (msg.event === 'cookies:changed') {
      this.cookies = msg.data;
      this.onCookiesChanged(msg.data);
      return;
    }
    if (!msg.id) return;
    const wc = this.owners.get(msg.id);
    if (wc && !wc.isDestroyed()) wc.send('runtime:event', msg);
    if (msg.event === 'done' || msg.event === 'ws:close') this.owners.delete(msg.id);
  }

  _failInFlight(message) {
    for (const [id, wc] of this.owners) {
      if (wc.isDestroyed()) continue;
      wc.send('runtime:event', { id, event: 'exception', data: { cursor: null, error: { name: 'RuntimeError', message } } });
      wc.send('runtime:event', { id, event: 'done', data: { error: { name: 'RuntimeError', message } } });
      wc.send('runtime:event', { id, event: 'ws:close', data: { code: 1006, reason: message } });
    }
    this.owners.clear();
    for (const p of this.pending.values()) p.reject(new Error(message));
    this.pending.clear();
  }

  _own(id, webContents) {
    this.owners.set(id, webContents);
    if (this.watched.has(webContents)) return;
    this.watched.add(webContents);
    // Drop routing (and stop the work) when the window goes away.
    webContents.once('destroyed', () => {
      for (const [ownedId, wc] of this.owners) {
        if (wc !== webContents) continue;
        this.owners.delete(ownedId);
        this.worker.postMessage({ action: 'abort', id: ownedId });
        this.worker.postMessage({ action: 'ws:close', id: ownedId });
      }
    });
  }

  execute(webContents, job) {
    if (!job || typeof job.id !== 'string') throw new Error('job.id is required');
    this._own(job.id, webContents);
    this.worker.postMessage({ action: 'execute', job });
  }

  abort(id) {
    this.worker.postMessage({ action: 'abort', id });
  }

  wsConnect(webContents, options) {
    if (!options || typeof options.id !== 'string') throw new Error('id is required');
    this._own(options.id, webContents);
    this.worker.postMessage({ action: 'ws:connect', ...options });
  }

  wsSend(id, data) {
    this.worker.postMessage({ action: 'ws:send', id, data });
  }

  wsClose(id) {
    this.worker.postMessage({ action: 'ws:close', id });
  }

  request(action, payload = {}) {
    const reqId = this.nextReqId++;
    return new Promise((resolve, reject) => {
      this.pending.set(reqId, { resolve, reject });
      this.worker.postMessage({ ...payload, action, reqId });
    });
  }

  close() {
    this.closing = true;
    return this.worker.terminate();
  }
}

module.exports = { RuntimeHost };
