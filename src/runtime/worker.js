'use strict';

/**
 * Worker-thread entry point. Mirrors Postman's AgentWorker.js: request
 * execution, user scripts and socket sessions run off the Electron main
 * thread, and the main process only routes messages between this worker and
 * renderer windows.
 *
 * Messages in:  { action, ... }            (fire-and-forget)
 *               { action, reqId, ... }     (expects { reqId, result | error })
 * Messages out: { id, event, data }        (execution / socket events)
 *               { event: 'cookies:changed', data }  (serialized jar to persist)
 */
const { parentPort } = require('worker_threads');
const engine = require('./execute');
const websocket = require('./websocket');

const post = (msg) => parentPort.postMessage(msg);

const emitRunEvent = (msg) => {
  post(msg);
  if (msg.event === 'request' || msg.event === 'done') {
    post({ event: 'cookies:changed', data: engine.serializeCookies() });
  }
};

const requests = {
  'cookies:list': () => engine.listCookies(),
  'cookies:delete': (msg) => engine.deleteCookie(msg.cookie).then(() => {
    post({ event: 'cookies:changed', data: engine.serializeCookies() });
    return true;
  }),
  'cookies:clear': () => {
    engine.clearCookies();
    post({ event: 'cookies:changed', data: engine.serializeCookies() });
    return true;
  }
};

parentPort.on('message', (msg) => {
  if (!msg || typeof msg.action !== 'string') return;

  if (msg.reqId !== undefined && requests[msg.action]) {
    Promise.resolve()
      .then(() => requests[msg.action](msg))
      .then((result) => post({ reqId: msg.reqId, result }))
      .catch((err) => post({ reqId: msg.reqId, error: err.message || String(err) }));
    return;
  }

  switch (msg.action) {
    case 'execute':
      try {
        engine.execute(msg.job, emitRunEvent);
      } catch (err) {
        const error = { name: err.name, message: err.message };
        post({ id: msg.job && msg.job.id, event: 'exception', data: { cursor: null, error } });
        post({ id: msg.job && msg.job.id, event: 'done', data: { error } });
      }
      break;
    case 'abort':
      engine.abort(msg.id);
      break;
    case 'cookies:load':
      engine.loadCookies(msg.data);
      break;
    case 'ws:connect':
      websocket.connect(msg, post);
      break;
    case 'ws:send':
      websocket.sendMessage(msg, post);
      break;
    case 'ws:close':
      websocket.close(msg);
      break;
    default:
      break;
  }
});

post({ event: 'ready' });
