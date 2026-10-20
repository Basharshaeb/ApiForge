/**
 * Runtime plumbing: routing worker events to handlers, the send pipeline for
 * request tabs, scope merging, history and the console log.
 */
import type { CollectionJson, ConsoleEntry, NetworkConsoleEntry, RequestTab, SerializedResponse } from '../../shared/types';
import type { Job, JobOptions, RunEvent, RunEventHandler, RunEventMap, RunEventName } from '../../shared/runtime-protocol';
import { buildRunCollection, clone, findNode, itemFromDraft, mergeScopeIntoRows, substitute, uid } from '../model';
import { toast } from '../ui';
import { activeEnvironment, findCollection, globalsScope, requestOptions, scopeOf, stable, vars } from './lookups';
import { save } from './persistence';
import { renderConsole, renderSidebar, renderStatusbar } from './shell';
import { app } from './state';
import { updateTab } from './tabs';

const MAX_CONSOLE_ENTRIES = 1000;
const CONSOLE_BODY_PREVIEW = 50000;
const TERMINAL_EVENTS = new Set<string>(['done', 'ws:close']);

type EventHandlers = { [K in RunEventName]?: (data: RunEventMap[K]) => void };

/** Dispatch a run event to a per-event handler map. */
export function dispatchEvent(handlers: EventHandlers, msg: RunEvent): void {
  const handler = handlers[msg.event] as ((data: unknown) => void) | undefined;
  if (handler) handler(msg.data);
}

// Event routing -----------------------------------------------------------
export const registerHandler = (id: string, fn: RunEventHandler): void => { app.handlers.set(id, fn); };
export const unregisterHandler = (id: string): void => { app.handlers.delete(id); };

export function execute(job: Job, handler: RunEventHandler): Promise<void> {
  app.handlers.set(job.id, handler);
  return window.apiforge.runtime.execute(job).then(() => undefined).catch((err: Error) => {
    const error = { name: 'Error', message: err.message };
    handler({ id: job.id, event: 'exception', data: { cursor: null, error } });
    handler({ id: job.id, event: 'done', data: { error } });
    app.handlers.delete(job.id);
  });
}

export const abort = (id: string): void => { void window.apiforge.runtime.abort(id); };

export function onRuntimeEvent(msg: RunEvent): void {
  const fn = app.handlers.get(msg.id);
  if (fn) fn(msg);
  if (TERMINAL_EVENTS.has(msg.event)) app.handlers.delete(msg.id);
}

export interface AdhocResult { request: RunEventMap['request'] | null; done: RunEventMap['done'] }

/** Run a throwaway collection and resolve with the first request result. */
export function runAdhoc(collection: CollectionJson, options: Partial<JobOptions> = {}): Promise<AdhocResult> {
  return new Promise((resolve) => {
    let request: RunEventMap['request'] | null = null;
    void execute({ id: uid(), collection, environment: scopeOf(activeEnvironment()), globals: globalsScope(), options: { ...requestOptions(), ...options } }, (msg) => {
      if (msg.event === 'request') request = msg.data;
      if (msg.event === 'done') resolve({ request, done: msg.data });
    });
  });
}

// Send pipeline -----------------------------------------------------------
function buildSendJob(tab: RequestTab, id: string): Job {
  const collection = tab.collectionId ? findCollection(tab.collectionId) : null;
  const savedHit = collection && tab.itemId ? findNode(collection, tab.itemId) : null;
  const base = savedHit && !('item' in savedHit.node && Array.isArray(savedHit.node.item)) ? savedHit.node : null;
  const item = itemFromDraft(tab.draft, base as Parameters<typeof itemFromDraft>[1]);
  return { id, collection: buildRunCollection(collection, tab.itemId, item), environment: scopeOf(activeEnvironment()), globals: globalsScope(), options: requestOptions() };
}

function resetTabForSend(tab: RequestTab, id: string): void {
  Object.assign(tab, { running: id, response: null, error: null, tests: [], scriptErrors: [], cookies: [], requestSent: null, visualizer: null });
}

function consolePreview(response: SerializedResponse | null): SerializedResponse | null {
  if (!response) return null;
  return { ...response, body: response.body == null ? null : response.body.slice(0, CONSOLE_BODY_PREVIEW), bodyBase64: null };
}

function recordResponse(tab: RequestTab, entry: NetworkConsoleEntry, data: RunEventMap['request'], started: number): void {
  tab.response = data.response;
  tab.error = data.error;
  tab.requestSent = data.request;
  tab.cookies = data.cookies || [];
  Object.assign(entry, {
    pending: false,
    status: data.response ? data.response.code : null,
    statusText: data.response ? data.response.status : null,
    time: data.response ? data.response.responseTime : Date.now() - started,
    size: data.response ? data.response.size.total : null,
    error: data.error,
    request: data.request,
    response: consolePreview(data.response)
  });
  if (data.request) entry.url = data.request.url;
  refreshConsole();
}

function recordScriptErrors(tab: RequestTab, data: RunEventMap['script']): void {
  const phase = data.target === 'test' ? 'Post-response' : 'Pre-request';
  data.errors.forEach((e) => {
    tab.scriptErrors.push({ target: data.target, ...e });
    log({ type: 'error', ts: Date.now(), messages: [`${phase} script error: ${e.message}`], tabId: tab.id });
  });
}

function finishSend(tab: RequestTab, entry: NetworkConsoleEntry, data: RunEventMap['done'], started: number): void {
  tab.running = null;
  if (data.error && !tab.error) tab.error = data.error;
  if (data.aborted && !tab.response && !tab.error) tab.error = { name: 'Aborted', message: 'Request was cancelled' };
  if (entry.pending) { entry.pending = false; entry.error = tab.error; entry.time = Date.now() - started; }
  mergeScopes(data);
  addHistory(tab, started);
  refreshConsole();
  save();
}

function createSendHandler(tab: RequestTab, entry: NetworkConsoleEntry, started: number): RunEventHandler {
  const on: EventHandlers = {
    request: (data) => recordResponse(tab, entry, data, started),
    assertion: (data) => { tab.tests.push(...data.assertions); },
    script: (data) => recordScriptErrors(tab, data),
    console: (data) => log({ type: data.level as ConsoleEntry['type'] & string, ts: Date.now(), messages: data.messages, tabId: tab.id } as ConsoleEntry),
    exception: (data) => {
      if (!tab.error) tab.error = data.error;
      log({ type: 'error', ts: Date.now(), messages: [data.error ? data.error.message : 'Unknown error'], tabId: tab.id });
    },
    item: (data) => { tab.visualizer = data.visualizer; },
    done: (data) => finishSend(tab, entry, data, started)
  };
  return (msg) => {
    dispatchEvent(on, msg);
    updateTab(tab.id);
  };
}

export function sendRequest(tab: RequestTab): void {
  if (tab.running) return abort(tab.running);
  if (!tab.draft.url.trim()) return toast('Enter a request URL', 'warning');
  const id = uid();
  const started = Date.now();
  resetTabForSend(tab, id);
  updateTab(tab.id);
  const entry: NetworkConsoleEntry = { id, type: 'network', ts: started, method: tab.draft.method, url: substitute(tab.draft.url, vars(tab.collectionId)), pending: true, tabId: tab.id };
  log(entry);
  void execute(buildSendJob(tab, id), createSendHandler(tab, entry, started));
}

// Scopes & history --------------------------------------------------------
/** Write pm.environment / pm.globals changes from a run back into the stores. */
export function mergeScopes(data: RunEventMap['done'] | null | undefined): void {
  if (!data) return;
  const env = activeEnvironment();
  const envBefore = env ? stable(env.values) : null;
  const globalsBefore = stable(app.state.globals.values);
  if (env && data.environment) env.values = mergeScopeIntoRows(env.values, data.environment);
  if (data.globals) app.state.globals.values = mergeScopeIntoRows(app.state.globals.values, data.globals);
  const envChanged = !!env && stable(env.values) !== envBefore;
  const globalsChanged = stable(app.state.globals.values) !== globalsBefore;
  if (!envChanged && !globalsChanged) return;
  save();
  app.tabs
    .filter((t) => t.type === 'environment' && ((envChanged && env && t.envId === env.id) || (globalsChanged && t.envId === 'globals')))
    .forEach((t) => updateTab(t.id));
}

export function addHistory(tab: RequestTab, started: number): void {
  const limit = Number(app.state.settings.historyLimit) || 200;
  app.state.history.unshift({
    id: uid(),
    ts: started,
    method: tab.draft.method,
    url: tab.draft.url,
    name: tab.itemId ? tab.draft.name : '',
    status: tab.response ? tab.response.code : null,
    time: tab.response ? tab.response.responseTime : null,
    error: tab.error ? tab.error.message : null,
    draft: clone(tab.draft),
    collectionId: tab.collectionId,
    itemId: tab.itemId
  });
  if (app.state.history.length > limit) app.state.history.length = limit;
  if (app.sidebar.section === 'history') renderSidebar();
}

// Console -----------------------------------------------------------------
export function log(entry: ConsoleEntry): void {
  app.consoleEntries.push(entry);
  if (app.consoleEntries.length > MAX_CONSOLE_ENTRIES) app.consoleEntries.splice(0, app.consoleEntries.length - MAX_CONSOLE_ENTRIES);
  refreshConsole();
}

export function clearConsole(): void {
  app.consoleEntries.length = 0;
  refreshConsole();
}

export function refreshConsole(): void {
  if (app.consoleView && app.consoleOpen) app.consoleView.update();
  renderStatusbar();
}

export function toggleConsole(open?: boolean): void {
  app.consoleOpen = open === undefined ? !app.consoleOpen : !!open;
  renderConsole();
  renderStatusbar();
}
