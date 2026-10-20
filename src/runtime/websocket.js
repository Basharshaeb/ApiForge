'use strict';

/**
 * Raw WebSocket client sessions, the ApiForge counterpart of Postman's
 * "websocket-request" agent provider. Each connection is addressed by a
 * caller-chosen id and reports `ws:*` events through `emit`.
 */
const WebSocket = require('ws');

const sockets = new Map();

function headerObject(headers) {
  const out = {};
  (headers || []).forEach((h) => {
    if (h && h.key && !h.disabled) out[h.key] = h.value;
  });
  return out;
}

function connect({ id, url, headers, protocols, strictSSL = true }, emit) {
  close({ id });
  const send = (event, data) => emit({ id, event, data });
  let socket;
  try {
    const list = (protocols || '').split(',').map((p) => p.trim()).filter(Boolean);
    socket = new WebSocket(url, list, { headers: headerObject(headers), rejectUnauthorized: strictSSL });
  } catch (err) {
    send('ws:error', { message: err.message });
    send('ws:close', { code: 1006, reason: err.message });
    return;
  }
  sockets.set(id, socket);
  send('ws:connecting', { url });

  socket.on('upgrade', (res) => {
    send('ws:handshake', {
      statusCode: res.statusCode,
      headers: Object.entries(res.headers).map(([key, value]) => ({ key, value: String(value) }))
    });
  });
  socket.on('open', () => send('ws:open', { url, protocol: socket.protocol }));
  socket.on('message', (data, isBinary) => {
    const buf = Buffer.isBuffer(data) ? data : Buffer.concat([].concat(data));
    send('ws:message', {
      direction: 'in',
      binary: !!isBinary,
      data: isBinary ? buf.toString('base64') : buf.toString('utf8'),
      size: buf.length,
      ts: Date.now()
    });
  });
  socket.on('error', (err) => send('ws:error', { message: err.message }));
  socket.on('close', (code, reason) => {
    if (sockets.get(id) === socket) sockets.delete(id);
    send('ws:close', { code, reason: reason ? reason.toString() : '' });
  });
}

function sendMessage({ id, data }, emit) {
  const socket = sockets.get(id);
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    emit({ id, event: 'ws:error', data: { message: 'Not connected' } });
    return;
  }
  socket.send(String(data), (err) => {
    if (err) return emit({ id, event: 'ws:error', data: { message: err.message } });
    emit({ id, event: 'ws:message', data: { direction: 'out', binary: false, data: String(data), size: Buffer.byteLength(String(data)), ts: Date.now() } });
  });
}

function close({ id, code = 1000, reason = '' }) {
  const socket = sockets.get(id);
  if (!socket) return;
  sockets.delete(id);
  try {
    if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
    else socket.close(code, reason);
  } catch (_) {
    socket.terminate();
  }
}

module.exports = { connect, sendMessage, close };
