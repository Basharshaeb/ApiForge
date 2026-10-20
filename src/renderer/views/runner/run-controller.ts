/**
 * Runner controller: builds the job, accumulates results from runtime events,
 * stops runs and exports results. No DOM.
 */
import type { CollectionJson, NodeJson, RunItemResult, RunnerConfig, RunnerTab, RunResult } from '../../../shared/types';
import type { RunEvent, RunEventMap, RunEventName } from '../../../shared/runtime-protocol';
import { clone, countRequests, ensureIds, findNode, uid } from '../../model';
import { toast } from '../../ui';
import * as App from '../../app';

type Handlers = { [K in RunEventName]?: (data: RunEventMap[K]) => void };

function scopeItems(collection: CollectionJson, config: RunnerConfig): NodeJson[] {
  if (!config.folderId) return collection.item;
  const hit = findNode(collection, config.folderId);
  return hit && 'item' in hit.node && Array.isArray(hit.node.item) ? hit.node.item : collection.item;
}

function methodOf(collection: CollectionJson, itemRef: { id: string } | null): string {
  const hit = itemRef && findNode(collection, itemRef.id);
  const request = hit && !Array.isArray(hit.node.item) ? hit.node.request : null;
  return request ? (typeof request === 'string' ? 'GET' : request.method || 'GET') : 'GET';
}

const newResult = (total: number, iterations: number): RunResult =>
  ({ startedAt: Date.now(), finishedAt: null, items: [], byRef: {}, total, iterations, aborted: false, error: null, errors: [] });

function resultEventHandler(tab: RunnerTab, collection: CollectionJson, config: RunnerConfig, onChange: () => void): (msg: RunEvent) => void {
  const r = tab.result as RunResult;
  const itemFor = (data: { cursor: { ref: string } | null }): RunItemResult | undefined => (data.cursor ? r.byRef[data.cursor.ref] : undefined);
  const on: Handlers = {
    beforeItem(data) {
      if (!data.cursor) return;
      const item: RunItemResult = { ref: data.cursor.ref, iteration: data.cursor.iteration, name: data.item ? data.item.name : '', id: data.item ? data.item.id : null, method: methodOf(collection, data.item), status: 'running', assertions: [], errors: [], response: null, error: null, startedAt: Date.now() };
      r.items.push(item);
      r.byRef[item.ref] = item;
    },
    request(data) {
      const item = itemFor(data);
      if (!item) return;
      item.response = data.response ? { code: data.response.code, status: data.response.status, time: data.response.responseTime, size: data.response.size.total } : null;
      item.error = data.error;
      item.url = data.request ? data.request.url : '';
      if (data.request) item.method = data.request.method;
    },
    assertion(data) { const item = itemFor(data); if (item) item.assertions.push(...data.assertions); },
    script(data) {
      const item = itemFor(data);
      if (item) data.errors.forEach((e) => item.errors.push(`${data.target === 'test' ? 'Post-response' : 'Pre-request'}: ${e.message}`));
    },
    item(data) { const item = itemFor(data); if (item) { item.status = 'done'; if (data.error && !item.error) item.error = data.error; } },
    console: (data) => App.log({ type: data.level as 'log', ts: Date.now(), messages: data.messages, tabId: tab.id }),
    exception(data) {
      const message = data.error ? data.error.message : 'Unknown error';
      r.errors.push(message);
      App.log({ type: 'error', ts: Date.now(), messages: [`Runner: ${message}`], tabId: tab.id });
    },
    done(data) {
      tab.running = null;
      Object.assign(r, { finishedAt: Date.now(), aborted: !!data.aborted, error: data.error });
      r.items.forEach((it) => { if (it.status === 'running') it.status = 'cancelled'; });
      if (config.persist && !data.aborted) App.mergeScopes(data);
      App.save();
    }
  };
  return (msg) => {
    App.dispatchEvent(on, msg);
    onChange();
  };
}

export function start(tab: RunnerTab, config: RunnerConfig, onChange: () => void): void {
  const source = App.findCollection(tab.collectionId);
  if (!source) return;
  if (!countRequests(scopeItems(source, config))) { toast('Nothing to run: add requests first', 'warning'); return; }
  const collection = ensureIds(clone(source));
  const id = uid();
  const iterations = config.data ? config.data.length : Math.max(1, Number(config.iterations) || 1);
  tab.running = id;
  tab.result = newResult(countRequests(scopeItems(source, config)) * iterations, iterations);
  void App.execute({
    id,
    collection,
    environment: App.scopeOf(App.activeEnvironment()),
    globals: App.globalsScope(),
    options: {
      ...App.requestOptions(),
      iterationCount: iterations,
      delay: Number(config.delay) || 0,
      data: config.data || undefined,
      stopOnError: !!config.stopOnError,
      entrypoint: config.folderId ? { execute: config.folderId } : undefined
    }
  }, resultEventHandler(tab, collection, config, onChange));
  onChange();
}

export function stop(tab: RunnerTab): void {
  if (tab.running) App.abort(tab.running);
}

function exportData(tab: RunnerTab): Record<string, unknown> {
  const r = tab.result as RunResult;
  const c = App.findCollection(tab.collectionId);
  return {
    collection: c ? c.info.name : '',
    startedAt: new Date(r.startedAt).toISOString(),
    finishedAt: r.finishedAt ? new Date(r.finishedAt).toISOString() : null,
    iterations: r.iterations,
    aborted: r.aborted,
    results: r.items.map((it) => ({
      iteration: it.iteration + 1, name: it.name, method: it.method, url: it.url, status: it.status, response: it.response,
      error: it.error ? it.error.message : null,
      assertions: it.assertions.map((a) => ({ name: a.name, passed: a.passed, skipped: a.skipped, error: a.error ? a.error.message : null })),
      scriptErrors: it.errors
    }))
  };
}

export async function exportResults(tab: RunnerTab): Promise<void> {
  if (!tab.result) return;
  const file = await window.apiforge.files.saveText({ defaultName: `run-results-${Date.now()}.json`, content: JSON.stringify(exportData(tab), null, 2), filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (file) toast(`Exported to ${file}`, 'success');
}

export interface RunSummary { done: number; passed: number; failed: number; errored: number; progress: number; avgTime: number | null; duration: number; status: string; healthy: boolean }

/** Summary numbers shown above the results list. */
export function summarize(tab: RunnerTab): RunSummary {
  const r = tab.result as RunResult;
  const done = r.items.filter((i) => i.status !== 'running').length;
  const passed = r.items.reduce((n, i) => n + i.assertions.filter((a) => a.passed).length, 0);
  const failed = r.items.reduce((n, i) => n + i.assertions.filter((a) => !a.passed && !a.skipped).length, 0);
  const errored = r.items.filter((i) => i.error || i.errors.length).length;
  const times = r.items.filter((i) => i.response && i.response.time != null).map((i) => i.response?.time as number);
  return {
    done, passed, failed, errored,
    progress: r.total ? Math.min(100, (done / r.total) * 100) : 0,
    avgTime: times.length ? times.reduce((a, b) => a + b, 0) / times.length : null,
    duration: (r.finishedAt || Date.now()) - r.startedAt,
    status: tab.running ? 'Running' : r.aborted ? 'Stopped' : r.error ? 'Error' : 'Finished',
    healthy: !tab.running && !(r.aborted || r.error || failed || errored)
  };
}
