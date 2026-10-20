/**
 * Request execution engine. Wraps postman-runtime the same way Postman's
 * AgentWorker "runtime" provider does: build an sdk.Collection, hand it to a
 * long-lived Runner, and stream every lifecycle callback back to the caller as
 * a plain `{ id, event, data }` message.
 */
import * as runtime from 'postman-runtime';
import * as sdk from 'postman-collection';
import type { NodeJson, Scope, UrlJson } from '../shared/types';
import type { Job, RunEvent, RunEventMap, RunEventName } from '../shared/runtime-protocol';
import * as cookies from './cookies';
import { buildRunOptions } from './run-options';
import * as S from './serialize';

const runner = new runtime.Runner();
const runs = new Map<string, { run: runtime.Run; finish: (err: Error | null, aborted?: boolean) => void }>();

type Emit = (msg: RunEvent) => void;
type Send = <K extends RunEventName>(event: K, data: RunEventMap[K]) => void;

/**
 * The editor treats `url.raw` as the source of truth (like the Postman UI),
 * but sdk.Url ignores `raw` when given an object. Re-derive the parts from
 * `raw` and keep path-variable values so `:id` segments resolve.
 */
function normalizeUrls(items: NodeJson[] | undefined): void {
  (items || []).forEach((node) => {
    if (Array.isArray(node.item)) return normalizeUrls(node.item);
    const request = typeof node.request === 'object' ? node.request : null;
    const url = request && request.url;
    if (!url || typeof url !== 'object' || typeof url.raw !== 'string') return;
    const parsed = sdk.Url.parse(url.raw) as UrlJson;
    if (Array.isArray(url.variable)) parsed.variable = url.variable;
    request.url = parsed;
  });
}

interface ScopeTracker { capture(results: S.ScriptResult[] | undefined): void; snapshot(): { environment: Scope | null; globals: Scope | null } }

/** Tracks the latest environment/globals snapshot reported by script results. */
function createScopeTracker(job: Job): ScopeTracker {
  const latest = { environment: S.scopeJSON(job.environment || { values: [] }), globals: S.scopeJSON(job.globals || { values: [] }) };
  return {
    capture(results) {
      (results || []).forEach((r) => {
        const result = r && r.result;
        if (!result) return;
        if (result.environment) latest.environment = S.scopeJSON(result.environment);
        if (result.globals) latest.globals = S.scopeJSON(result.globals);
      });
    },
    snapshot: () => ({ environment: latest.environment, globals: latest.globals })
  };
}

function scriptEvent(target: 'prerequest' | 'test', scopes: ScopeTracker, send: Send) {
  return (_err: unknown, cursor: unknown, results: S.ScriptResult[], item: { id: string; name: string }) => {
    scopes.capture(results);
    send('script', { target, cursor: S.serializeCursor(cursor as Partial<Cursor>), item: S.itemRef(item), errors: S.scriptErrors(results) });
  };
}

type Cursor = import('../shared/runtime-protocol').Cursor;
type ItemLike = { id: string; name: string };

function createRunCallbacks({ send, finish, scopes }: { send: Send; finish: (err: Error | null, aborted?: boolean) => void; scopes: ScopeTracker }): runtime.RunCallbacks {
  const cursorOf = (c: unknown) => S.serializeCursor(c as Partial<Cursor>);
  return {
    start: (err: Error | null, cursor: unknown) => send('start', { cursor: cursorOf(cursor), error: S.serializeError(err) }),
    beforeItem: (_err: unknown, cursor: unknown, item: ItemLike) => send('beforeItem', { cursor: cursorOf(cursor), item: S.itemRef(item) }),
    item: (err: Error | null, cursor: unknown, item: ItemLike, visualizer: unknown) => send('item', {
      cursor: cursorOf(cursor), item: S.itemRef(item), error: S.serializeError(err), visualizer: S.serializeVisualizer(visualizer as Parameters<typeof S.serializeVisualizer>[0])
    }),
    prerequest: scriptEvent('prerequest', scopes, send),
    test: scriptEvent('test', scopes, send),
    // eslint-disable-next-line max-params -- signature dictated by postman-runtime
    request: (err: Error | null, cursor: unknown, response: sdk.Response, request: sdk.Request, item: ItemLike, cookieList: Parameters<typeof S.serializeCookie>[0][]) => send('request', {
      cursor: cursorOf(cursor),
      item: S.itemRef(item),
      error: S.serializeError(err),
      request: S.serializeRequest(request),
      response: S.serializeResponse(response),
      cookies: (cookieList || []).map(S.serializeCookie)
    }),
    assertion: (cursor: unknown, assertions: Parameters<typeof S.serializeAssertion>[0][]) => send('assertion', { cursor: cursorOf(cursor), assertions: (assertions || []).map(S.serializeAssertion) }),
    console: (cursor: unknown, level: string, ...messages: unknown[]) => send('console', { cursor: cursorOf(cursor), level, messages: messages.map(S.formatLogArg) }),
    exception: (cursor: unknown, err: Error) => send('exception', { cursor: cursorOf(cursor), error: S.serializeError(err) }),
    abort: () => finish(null, true),
    done: (err: Error | null) => finish(err)
  };
}

/** Execute a collection (or a single request wrapped in a collection). */
export function execute(job: Job, emit: Emit): void {
  const { id } = job;
  let finished = false;
  const send: Send = (event, data) => { if (!finished) emit({ id, event, data } as RunEvent); };
  const scopes = createScopeTracker(job);

  const finish = (err: Error | null, aborted = false): void => {
    if (finished) return;
    runs.delete(id);
    send('done', { error: S.serializeError(err), aborted, ...scopes.snapshot() });
    finished = true;
  };
  const fail = (err: Error): void => {
    send('exception', { cursor: null, error: S.serializeError(err) });
    finish(err);
  };

  let collection: sdk.Collection;
  try {
    normalizeUrls(job.collection && job.collection.item);
    collection = new sdk.Collection(job.collection as unknown as sdk.CollectionDefinition);
  } catch (err) {
    return fail(err as Error);
  }

  runner.run(collection, buildRunOptions(job, cookies.current()), (err, run) => {
    if (err) return fail(err);
    runs.set(id, { run, finish });
    run.start(createRunCallbacks({ send, finish, scopes }));
  });
}

/**
 * Abort a run. The runtime only processes the abort after the in-flight
 * request settles, so the caller is told the run is done right away.
 */
export function abort(id: string): boolean {
  const entry = runs.get(id);
  if (!entry) return false;
  entry.run.abort();
  entry.finish(null, true);
  return true;
}
