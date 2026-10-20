/**
 * Messages exchanged between the renderer, the main process and the runtime
 * worker.
 */
import type {
  Assertion, ClientCertificate, CollectionJson, ProxySettings, Scope, SerializedCookie, SerializedError,
  SerializedHeader, SerializedRequest, SerializedResponse, VisualizerResult, ScriptTarget
} from './types';

export interface JobOptions {
  iterationCount?: number;
  data?: Record<string, unknown>[];
  delay?: number;
  requestTimeout?: number;
  scriptTimeout?: number;
  stopOnError?: boolean;
  entrypoint?: { execute: string };
  strictSSL?: boolean;
  followRedirects?: boolean;
  proxy?: ProxySettings | null;
  ignoreProxyEnv?: boolean;
  certificates?: ClientCertificate[];
  caCertPath?: string;
}

export interface Job {
  id: string;
  collection: CollectionJson;
  environment?: Scope;
  globals?: Scope;
  options?: JobOptions;
}

export interface Cursor { position: number; iteration: number; length: number; cycles: number; ref: string }
export interface ItemRef { id: string; name: string }

export interface RunEventMap {
  start: { cursor: Cursor | null; error: SerializedError | null };
  beforeItem: { cursor: Cursor | null; item: ItemRef | null };
  item: { cursor: Cursor | null; item: ItemRef | null; error: SerializedError | null; visualizer: VisualizerResult | null };
  script: { target: ScriptTarget; cursor: Cursor | null; item: ItemRef | null; errors: SerializedError[] };
  request: {
    cursor: Cursor | null;
    item: ItemRef | null;
    error: SerializedError | null;
    request: SerializedRequest | null;
    response: SerializedResponse | null;
    cookies: SerializedCookie[];
  };
  assertion: { cursor: Cursor | null; assertions: Assertion[] };
  console: { cursor: Cursor | null; level: string; messages: string[] };
  exception: { cursor: Cursor | null; error: SerializedError | null };
  done: { error: SerializedError | null; aborted?: boolean; environment?: Scope | null; globals?: Scope | null };
  'ws:connecting': { url: string };
  'ws:handshake': { statusCode: number | undefined; headers: SerializedHeader[] };
  'ws:open': { url: string; protocol: string };
  'ws:message': { direction: 'in' | 'out'; binary: boolean; data: string; size: number; ts: number };
  'ws:error': { message: string };
  'ws:close': { code: number; reason: string };
}

export type RunEventName = keyof RunEventMap;
export type RunEvent = { [K in RunEventName]: { id: string; event: K; data: RunEventMap[K] } }[RunEventName];
export type RunEventHandler = (msg: RunEvent) => void;

export interface WsConnectOptions { id: string; url: string; headers: SerializedHeader[]; protocols: string; strictSSL?: boolean }

/** Renderer -> main -> worker commands. */
export type WorkerCommand =
  | { action: 'execute'; job: Job }
  | { action: 'abort'; id: string }
  | { action: 'cookies:load'; data: unknown }
  | ({ action: 'ws:connect' } & WsConnectOptions)
  | { action: 'ws:send'; id: string; data: string }
  | { action: 'ws:close'; id: string; code?: number; reason?: string }
  | { action: 'cookies:list'; reqId: number }
  | { action: 'cookies:delete'; reqId: number; cookie: { domain: string; path: string; name: string } }
  | { action: 'cookies:clear'; reqId: number };

/** Worker -> main messages. */
export type WorkerMessage =
  | RunEvent
  | { event: 'ready' }
  | { event: 'cookies:changed'; data: unknown }
  | { reqId: number; result?: unknown; error?: string };
