/**
 * Saving app state through the bridge and restoring tabs on launch.
 */
import type { Draft, RequestTab, StoredTab, Tab, TabType, UiState } from '../../shared/types';
import { emptyDraft, findNode, syncFromUrl } from '../model';
import { findCollection, findEnvironment } from './lookups';
import { app } from './state';

const SAVE_DEBOUNCE_MS = 300;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function uiState(): UiState {
  return {
    tabs: app.tabs.map(serializeTab).filter((t): t is StoredTab => !!t),
    activeTabId: app.activeTabId,
    sidebar: app.sidebar.section,
    sidebarWidth: app.sidebar.width,
    sidebarCollapsed: app.sidebar.collapsed,
    expanded: [...app.expanded],
    consoleHeight: app.consoleHeight
  };
}

export function persist(): Promise<boolean> {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  const s = app.state;
  s.ui = uiState();
  return window.apiforge.store.save({ collections: s.collections, environments: s.environments, globals: s.globals, history: s.history, settings: s.settings, ui: s.ui });
}

export function save(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { void persist(); }, SAVE_DEBOUNCE_MS);
}

// Tab (de)serialization -------------------------------------------------
const TAB_FIELDS: Record<TabType, string[]> = {
  request: ['collectionId', 'itemId', 'draft', 'saved', 'subtab', 'respTab', 'reqPaneHeight'],
  example: ['collectionId', 'itemId', 'exampleId'],
  websocket: ['url', 'headers', 'protocols', 'subtab'],
  environment: ['envId'],
  collection: ['collectionId', 'nodeId', 'subtab'],
  runner: ['collectionId', 'config']
};

export function serializeTab(tab: Tab): StoredTab | null {
  const fields = TAB_FIELDS[tab.type];
  if (!fields) return null;
  const out: StoredTab = { id: tab.id, type: tab.type };
  const source = tab as unknown as Record<string, unknown>;
  fields.forEach((k) => { out[k] = source[k]; });
  return out;
}

/** Fill in any field a stored or programmatic draft may be missing. */
export function normalizeDraft(d: Partial<Draft> | undefined): Draft {
  const empty = emptyDraft();
  const draft: Draft = { ...empty, ...(d || {}) };
  draft.body = { ...empty.body, ...(draft.body || {}) };
  draft.body.graphql = { ...empty.body.graphql, ...(draft.body.graphql || {}) };
  draft.scripts = { ...empty.scripts, ...(draft.scripts || {}) };
  draft.auth = draft.auth && draft.auth.type ? { type: draft.auth.type, params: draft.auth.params || {} } : { type: 'inherit', params: {} };
  draft.settings = draft.settings || {};
  if (!Array.isArray(draft.params)) draft.params = [];
  if (!Array.isArray(draft.pathVars)) draft.pathVars = [];
  if (!Array.isArray(draft.headers)) draft.headers = [];
  if (!draft.params.length && draft.url) syncFromUrl(draft);
  return draft;
}

type RequestTabSeed = Pick<RequestTab, 'collectionId' | 'itemId' | 'draft' | 'saved'> & Partial<RequestTab>;

/** Transient fields every request tab starts with. */
export function requestTabState(seed: RequestTabSeed): RequestTab {
  return {
    id: seed.id || '',
    type: 'request',
    subtab: 'params',
    respTab: 'body',
    ...seed,
    response: null,
    error: null,
    tests: [],
    scriptErrors: [],
    cookies: [],
    requestSent: null,
    visualizer: null,
    running: null
  };
}

type Reviver = (t: StoredTab) => Tab | null;

const REVIVERS: Record<TabType, Reviver> = {
  request(t) {
    const stored = t as unknown as Partial<RequestTab> & StoredTab;
    let collectionId = stored.collectionId || null;
    let itemId = stored.itemId || null;
    const c = collectionId ? findCollection(collectionId) : null;
    if (!c) { collectionId = null; itemId = null; }
    else if (!itemId || !findNode(c, itemId)) itemId = null;
    return requestTabState({ ...stored, collectionId, itemId, draft: normalizeDraft(stored.draft), saved: itemId ? stored.saved || null : null });
  },
  example(t) {
    const stored = t as unknown as { collectionId: string; itemId: string; exampleId: string } & StoredTab;
    const c = findCollection(stored.collectionId);
    const hit = c && findNode(c, stored.itemId);
    const exists = hit && !('item' in hit.node && Array.isArray(hit.node.item)) && ((hit.node as { response?: Array<{ id: string }> }).response || []).some((r) => r.id === stored.exampleId);
    return exists ? { id: t.id, type: 'example', collectionId: stored.collectionId, itemId: stored.itemId, exampleId: stored.exampleId } : null;
  },
  websocket(t) {
    const stored = t as unknown as { url?: string; headers?: unknown; protocols?: string; subtab?: string } & StoredTab;
    return {
      id: t.id, type: 'websocket', url: stored.url || '', headers: Array.isArray(stored.headers) ? stored.headers : [], protocols: stored.protocols || '',
      subtab: (stored.subtab as 'message' | 'headers' | 'settings') || 'message', messages: [], status: 'disconnected', connId: null
    };
  },
  environment(t) {
    const envId = String((t as { envId?: string }).envId || '');
    return envId === 'globals' || findEnvironment(envId) ? { id: t.id, type: 'environment', envId } : null;
  },
  collection(t) {
    const stored = t as unknown as { collectionId: string; nodeId?: string | null; subtab?: string } & StoredTab;
    const c = findCollection(stored.collectionId);
    if (!c || (stored.nodeId && !findNode(c, stored.nodeId))) return null;
    return { id: t.id, type: 'collection', collectionId: stored.collectionId, nodeId: stored.nodeId || null, subtab: (stored.subtab as 'overview') || 'overview' };
  },
  runner(t) {
    const stored = t as unknown as { collectionId: string; config?: Record<string, unknown> } & StoredTab;
    return findCollection(stored.collectionId) ? { id: t.id, type: 'runner', collectionId: stored.collectionId, config: stored.config || {}, result: null, running: null } : null;
  }
};

export function reviveTab(t: StoredTab | null | undefined): Tab | null {
  if (!t || !t.id || !REVIVERS[t.type]) return null;
  return REVIVERS[t.type](t);
}
