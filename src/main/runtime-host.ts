/**
 * Owns the runtime worker and routes its events to the renderer that started
 * each run or socket (Postman's main process does the same between the
 * "agent2" IPC channel and AgentWorker.js). Restarts the worker if it dies and
 * fails any work that was in flight.
 */
import { Worker } from 'worker_threads';
import type { WebContents } from 'electron';
import type { Job, RunEvent, WorkerCommand, WorkerMessage, WsConnectOptions } from '../shared/runtime-protocol';

const RESPAWN_DELAY_MS = 250;
const TERMINAL_EVENTS = new Set<string>(['done', 'ws:close']);

interface Pending { resolve: (value: unknown) => void; reject: (err: Error) => void }
interface HostOptions { onCookiesChanged?: (jar: unknown) => void; initialCookies?: unknown }

export class RuntimeHost {
  private readonly workerPath: string;
  private readonly onCookiesChanged: (jar: unknown) => void;
  private cookies: unknown;
  private readonly owners = new Map<string, WebContents>(); // run / socket id -> webContents
  private readonly watched = new WeakSet<WebContents>();
  private readonly pending = new Map<number, Pending>();
  private nextReqId = 1;
  private closing = false;
  private worker!: Worker;

  constructor(workerPath: string, { onCookiesChanged, initialCookies }: HostOptions = {}) {
    this.workerPath = workerPath;
    this.onCookiesChanged = onCookiesChanged || (() => undefined);
    this.cookies = initialCookies || null;
    this.spawn();
  }

  // Worker lifecycle --------------------------------------------------------
  private spawn(): void {
    const worker = new Worker(this.workerPath);
    this.worker = worker;
    if (this.cookies) this.send({ action: 'cookies:load', data: this.cookies });
    worker.on('message', (msg: WorkerMessage) => this.onMessage(msg));
    worker.on('error', (err) => console.error('Runtime worker error', err));
    worker.on('exit', (code) => this.onExit(worker, code));
  }

  private onExit(worker: Worker, code: number): void {
    if (this.worker !== worker) return;
    this.failInFlight(`Runtime worker exited (code ${code})`);
    if (!this.closing) setTimeout(() => this.spawn(), RESPAWN_DELAY_MS);
  }

  private failInFlight(message: string): void {
    const error = { name: 'RuntimeError', message };
    for (const [id, wc] of this.owners) {
      if (wc.isDestroyed()) continue;
      wc.send('runtime:event', { id, event: 'exception', data: { cursor: null, error } });
      wc.send('runtime:event', { id, event: 'done', data: { error } });
      wc.send('runtime:event', { id, event: 'ws:close', data: { code: 1006, reason: message } });
    }
    this.owners.clear();
    for (const p of this.pending.values()) p.reject(new Error(message));
    this.pending.clear();
  }

  private send(command: WorkerCommand): void {
    this.worker.postMessage(command);
  }

  // Inbound messages --------------------------------------------------------
  private onMessage(msg: WorkerMessage): void {
    if (!msg) return;
    if ('reqId' in msg) return this.settleRequest(msg);
    if (msg.event === 'cookies:changed') return this.storeCookies(msg.data);
    if (msg.event !== 'ready') this.routeEvent(msg);
  }

  private settleRequest(msg: { reqId: number; result?: unknown; error?: string }): void {
    const pending = this.pending.get(msg.reqId);
    if (!pending) return;
    this.pending.delete(msg.reqId);
    if (msg.error) pending.reject(new Error(msg.error));
    else pending.resolve(msg.result);
  }

  private storeCookies(serialized: unknown): void {
    this.cookies = serialized;
    this.onCookiesChanged(serialized);
  }

  private routeEvent(msg: RunEvent): void {
    const wc = this.owners.get(msg.id);
    if (wc && !wc.isDestroyed()) wc.send('runtime:event', msg);
    if (TERMINAL_EVENTS.has(msg.event)) this.owners.delete(msg.id);
  }

  // Ownership ---------------------------------------------------------------
  private own(id: string, webContents: WebContents): void {
    this.owners.set(id, webContents);
    if (this.watched.has(webContents)) return;
    this.watched.add(webContents);
    webContents.once('destroyed', () => this.releaseOwner(webContents));
  }

  /** Stop routing (and the work) once the owning window is gone. */
  private releaseOwner(webContents: WebContents): void {
    for (const [id, wc] of this.owners) {
      if (wc !== webContents) continue;
      this.owners.delete(id);
      this.send({ action: 'abort', id });
      this.send({ action: 'ws:close', id });
    }
  }

  // Public API --------------------------------------------------------------
  execute(webContents: WebContents, job: Job): void {
    if (!job || typeof job.id !== 'string') throw new Error('job.id is required');
    this.own(job.id, webContents);
    this.send({ action: 'execute', job });
  }

  abort(id: string): void {
    this.send({ action: 'abort', id });
  }

  wsConnect(webContents: WebContents, options: WsConnectOptions): void {
    if (!options || typeof options.id !== 'string') throw new Error('id is required');
    this.own(options.id, webContents);
    this.send({ action: 'ws:connect', ...options });
  }

  wsSend(id: string, data: string): void {
    this.send({ action: 'ws:send', id, data });
  }

  wsClose(id: string): void {
    this.send({ action: 'ws:close', id });
  }

  request<T>(action: 'cookies:list' | 'cookies:clear' | 'cookies:delete', payload: Record<string, unknown> = {}): Promise<T> {
    const reqId = this.nextReqId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(reqId, { resolve: resolve as (v: unknown) => void, reject });
      this.worker.postMessage({ ...payload, action, reqId });
    });
  }

  close(): Promise<number> {
    this.closing = true;
    return this.worker.terminate();
  }
}
