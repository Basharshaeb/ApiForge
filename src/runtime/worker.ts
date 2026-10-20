/**
 * Worker-thread entry point. Mirrors Postman's AgentWorker.js: request
 * execution, user scripts and socket sessions run off the Electron main
 * thread, and the main process only routes messages between this worker and
 * renderer windows.
 */
import { parentPort } from 'worker_threads';
import type { Job, RunEvent, WorkerCommand, WorkerMessage } from '../shared/runtime-protocol';
import * as engine from './execute';
import * as cookies from './cookies';
import * as websocket from './websocket';

const port = parentPort;
if (!port) throw new Error('worker.ts must run inside a worker thread');

const post = (msg: WorkerMessage): void => port.postMessage(msg);
const postCookies = (): void => post({ event: 'cookies:changed', data: cookies.serialize() });

const COOKIE_SYNC_EVENTS = new Set<string>(['request', 'done']);

function emitRunEvent(msg: RunEvent): void {
  post(msg);
  if (COOKIE_SYNC_EVENTS.has(msg.event)) postCookies();
}

function runJob(job: Job): void {
  try {
    engine.execute(job, emitRunEvent);
  } catch (err) {
    const error = { name: (err as Error).name, message: (err as Error).message };
    const id = job && job.id;
    post({ id, event: 'exception', data: { cursor: null, error } });
    post({ id, event: 'done', data: { error } });
  }
}

type RequestCommand = Extract<WorkerCommand, { reqId: number }>;
type FireAndForget = Exclude<WorkerCommand, { reqId: number }>;

/** Request/response style actions: resolve to a value sent back with the reqId. */
const requests: { [K in RequestCommand['action']]: (msg: Extract<RequestCommand, { action: K }>) => Promise<unknown> | unknown } = {
  'cookies:list': () => cookies.list(),
  'cookies:delete': (msg) => cookies.remove(msg.cookie).then(() => { postCookies(); return true; }),
  'cookies:clear': () => { cookies.clear(); postCookies(); return true; }
};

/** Fire-and-forget actions. */
const commands: { [K in FireAndForget['action']]: (msg: Extract<FireAndForget, { action: K }>) => void } = {
  execute: (msg) => runJob(msg.job),
  abort: (msg) => { engine.abort(msg.id); },
  'cookies:load': (msg) => cookies.load(msg.data),
  'ws:connect': (msg) => websocket.connect(msg, post),
  'ws:send': (msg) => websocket.sendMessage(msg, post),
  'ws:close': (msg) => websocket.close(msg)
};

function handleRequest(msg: RequestCommand): void {
  const handler = requests[msg.action] as (m: RequestCommand) => Promise<unknown> | unknown;
  Promise.resolve()
    .then(() => handler(msg))
    .then((result) => post({ reqId: msg.reqId, result }))
    .catch((err: Error) => post({ reqId: msg.reqId, error: err.message || String(err) }));
}

port.on('message', (msg: WorkerCommand) => {
  if (!msg || typeof msg.action !== 'string') return;
  if ('reqId' in msg) return handleRequest(msg);
  const command = commands[msg.action] as (m: FireAndForget) => void;
  if (command) command(msg);
});

post({ event: 'ready' });
