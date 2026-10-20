/**
 * Raw WebSocket client sessions, the ApiForge counterpart of Postman's
 * "websocket-request" agent provider. Each connection is addressed by a
 * caller-chosen id and reports `ws:*` events through `emit`.
 */
import WebSocket from 'ws';
import type { IncomingMessage } from 'http';
import type { SerializedHeader } from '../shared/types';
import type { RunEvent, RunEventMap, RunEventName, WsConnectOptions } from '../shared/runtime-protocol';

type Emit = (msg: RunEvent) => void;
type Send = <K extends RunEventName>(event: K, data: RunEventMap[K]) => void;

const sockets = new Map<string, WebSocket>();

function headerObject(headers: SerializedHeader[] | undefined): Record<string, string> {
  return (headers || []).reduce<Record<string, string>>((out, h) => {
    if (h && h.key && !h.disabled) out[h.key] = h.value;
    return out;
  }, {});
}

const protocolList = (protocols: string | undefined): string[] => String(protocols || '').split(',').map((p) => p.trim()).filter(Boolean);

function messagePayload(data: WebSocket.RawData, isBinary: boolean, direction: 'in' | 'out'): RunEventMap['ws:message'] {
  const buf = Buffer.isBuffer(data) ? data : Buffer.concat(([] as Buffer[]).concat(data as Buffer | Buffer[]));
  return { direction, binary: !!isBinary, data: isBinary ? buf.toString('base64') : buf.toString('utf8'), size: buf.length, ts: Date.now() };
}

function attachListeners(id: string, socket: WebSocket, send: Send): void {
  socket.on('upgrade', (res: IncomingMessage) => send('ws:handshake', {
    statusCode: res.statusCode,
    headers: Object.entries(res.headers).map(([key, value]) => ({ key, value: String(value) }))
  }));
  socket.on('open', () => send('ws:open', { url: socket.url, protocol: socket.protocol }));
  socket.on('message', (data, isBinary) => send('ws:message', messagePayload(data, isBinary, 'in')));
  socket.on('error', (err) => send('ws:error', { message: err.message }));
  socket.on('close', (code, reason) => {
    if (sockets.get(id) === socket) sockets.delete(id);
    send('ws:close', { code, reason: reason ? reason.toString() : '' });
  });
}

export function connect({ id, url, headers, protocols, strictSSL = true }: WsConnectOptions, emit: Emit): void {
  close({ id });
  const send: Send = (event, data) => emit({ id, event, data } as RunEvent);
  let socket: WebSocket;
  try {
    socket = new WebSocket(url, protocolList(protocols), { headers: headerObject(headers), rejectUnauthorized: strictSSL });
  } catch (err) {
    send('ws:error', { message: (err as Error).message });
    send('ws:close', { code: 1006, reason: (err as Error).message });
    return;
  }
  sockets.set(id, socket);
  send('ws:connecting', { url });
  attachListeners(id, socket, send);
}

export function sendMessage({ id, data }: { id: string; data: string }, emit: Emit): void {
  const socket = sockets.get(id);
  const send: Send = (event, payload) => emit({ id, event, data: payload } as RunEvent);
  if (!socket || socket.readyState !== WebSocket.OPEN) return send('ws:error', { message: 'Not connected' });
  const text = String(data);
  socket.send(text, (err) => {
    if (err) return send('ws:error', { message: err.message });
    send('ws:message', messagePayload(Buffer.from(text, 'utf8'), false, 'out'));
  });
}

export function close({ id, code = 1000, reason = '' }: { id: string; code?: number; reason?: string }): void {
  const socket = sockets.get(id);
  if (!socket) return;
  sockets.delete(id);
  try {
    if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
    else socket.close(code, reason);
  } catch {
    socket.terminate();
  }
}
