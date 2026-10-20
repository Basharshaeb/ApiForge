/**
 * Converts postman-runtime / postman-collection objects into plain,
 * structured-clone-safe data for the renderer.
 */
import * as sdk from 'postman-collection';
import type {
  Assertion, Scope, SerializedCookie, SerializedError, SerializedHeader, SerializedRequest, SerializedResponse, VisualizerResult
} from '../shared/types';
import type { Cursor, ItemRef } from '../shared/runtime-protocol';

const MAX_BODY_BYTES = 10 * 1024 * 1024;
const BINARY_CONTENT_TYPE = /^(image|audio|video|font)\/|application\/(octet-stream|pdf|zip|gzip|x-tar|wasm|x-7z-compressed)/i;

type AnyError = { name?: string; message?: string; code?: string } | Error | null | undefined;

export function serializeError(err: AnyError): SerializedError | null {
  if (!err) return null;
  const e = err as { name?: string; message?: string; code?: string };
  return { name: e.name || 'Error', message: e.message || String(err), code: e.code || null };
}

export function serializeCursor(cursor: Partial<Cursor> | null | undefined): Cursor | null {
  if (!cursor) return null;
  const { position = 0, iteration = 0, length = 0, cycles = 0, ref = '' } = cursor;
  return { position, iteration, length, cycles, ref };
}

export function itemRef(item: { id: string; name: string } | null | undefined): ItemRef | null {
  return item ? { id: item.id, name: item.name } : null;
}

function headerList(headers: sdk.HeaderList | undefined): SerializedHeader[] {
  if (!headers || typeof headers.all !== 'function') return [];
  return headers.all().map((h) => ({ key: h.key, value: String(h.value), disabled: !!h.disabled }));
}

function toBuffer(stream: unknown): Buffer {
  if (!stream) return Buffer.alloc(0);
  if (Buffer.isBuffer(stream)) return stream;
  const json = stream as { type?: string; data?: number[] };
  if (json.type === 'Buffer' && Array.isArray(json.data)) return Buffer.from(json.data);
  return Buffer.from(stream as Uint8Array);
}

function responseTimings(response: sdk.Response): SerializedResponse['timings'] {
  try {
    const timings = (response as unknown as { timings?: unknown }).timings;
    return timings ? (sdk.Response as unknown as { timingPhases(t: unknown): SerializedResponse['timings'] }).timingPhases(timings) : null;
  } catch {
    return null;
  }
}

function responseBody(response: sdk.Response, contentType: string): Pick<SerializedResponse, 'body' | 'bodyBase64' | 'truncated'> {
  const stream = toBuffer((response as unknown as { stream?: unknown }).stream);
  const truncated = stream.length > MAX_BODY_BYTES;
  const bytes = truncated ? stream.subarray(0, MAX_BODY_BYTES) : stream;
  const binary = BINARY_CONTENT_TYPE.test(contentType);
  return { body: binary ? null : bytes.toString('utf8'), bodyBase64: binary ? bytes.toString('base64') : null, truncated };
}

export function serializeResponse(response: sdk.Response | null | undefined): SerializedResponse | null {
  if (!response) return null;
  const contentType = response.headers.get('Content-Type') || '';
  // @types/postman-collection declares size() as a number; the SDK returns { body, header, total }.
  const size = response.size() as unknown as { body: number; header: number; total: number };
  return {
    code: response.code,
    status: response.status,
    responseTime: response.responseTime,
    contentType,
    headers: headerList(response.headers),
    size: { body: size.body, header: size.header, total: size.total },
    ...responseBody(response, contentType),
    timings: responseTimings(response)
  };
}

function requestBodyText(request: sdk.Request): string {
  try {
    return request.body && !request.body.isEmpty() ? request.body.toString() : '';
  } catch {
    return ''; // file / stream bodies do not stringify
  }
}

export function serializeRequest(request: sdk.Request | null | undefined): SerializedRequest | null {
  if (!request) return null;
  return { method: request.method, url: request.url.toString(), headers: headerList(request.headers), body: requestBodyText(request) };
}

interface CookieLike { name: string; value: string; domain?: string; path?: string; expires?: unknown; httpOnly?: boolean; secure?: boolean; toJSON?(): unknown }

export function serializeCookie(cookie: CookieLike): SerializedCookie {
  const c = (typeof cookie.toJSON === 'function' ? cookie.toJSON() : cookie) as CookieLike;
  return {
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    expires: c.expires ? String(c.expires) : null,
    httpOnly: !!c.httpOnly,
    secure: !!c.secure
  };
}

export function serializeAssertion(assertion: { name: string; passed?: boolean; skipped?: boolean; error?: AnyError }): Assertion {
  return { name: assertion.name, passed: !!assertion.passed, skipped: !!assertion.skipped, error: serializeError(assertion.error) };
}

export function serializeVisualizer(visualizer: { error?: AnyError; processedTemplate?: unknown; data?: unknown } | null | undefined): VisualizerResult | null {
  if (!visualizer) return null;
  return {
    error: serializeError(visualizer.error),
    processedTemplate: typeof visualizer.processedTemplate === 'string' ? visualizer.processedTemplate : null,
    data: plainData(visualizer.data)
  };
}

export interface ScriptResult { error?: AnyError; result?: { environment?: sdk.VariableScope; globals?: sdk.VariableScope } }

export function scriptErrors(results: ScriptResult[] | undefined): SerializedError[] {
  return (results || []).filter((r) => r && r.error).map((r) => serializeError(r.error) as SerializedError);
}

function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, v: unknown) => {
    if (typeof v === 'bigint') return v.toString();
    if (typeof v === 'object' && v !== null) {
      if (seen.has(v)) return '[Circular]';
      seen.add(v);
    }
    return v;
  }, 2);
}

export function formatLogArg(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (arg === undefined) return 'undefined';
  if (typeof arg === 'function') return '[Function]';
  try {
    return safeStringify(arg);
  } catch {
    return String(arg);
  }
}

export function plainData(value: unknown): unknown {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

export function scopeJSON(scope: sdk.VariableScope | Scope | null | undefined): Scope | null {
  if (!scope) return null;
  const json = (typeof (scope as sdk.VariableScope).toJSON === 'function' ? (scope as sdk.VariableScope).toJSON() : scope) as { values?: Array<{ key: string; value: unknown; type?: string; disabled?: boolean }> };
  return { values: (json.values || []).map((v) => ({ key: v.key, value: v.value, type: v.type, disabled: !!v.disabled })) };
}
