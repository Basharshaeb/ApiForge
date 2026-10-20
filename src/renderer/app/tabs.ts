/**
 * Tab management: opening, activating, closing and change tracking.
 */
import type { CollectionTab, Draft, EnvironmentTab, ExampleTab, RequestTab, RunnerTab, Tab, WebSocketTab } from '../../shared/types';
import { draftFromItem, findNode, isBlankRow, isFolder, uid } from '../model';
import { choice } from '../ui';
import { findCollection, findEnvironment, stable } from './lookups';
import { normalizeDraft, requestTabState, save } from './persistence';
import { saveRequestTab } from './collections';
import { abort } from './runtime';
import { mountActive, renderEnvSelect, renderSidebar, renderTabbar, renderTabbarItem } from './shell';
import { app } from './state';

/** `Omit` applied to each member of the union (plain `Omit<Tab, 'id'>` would collapse it to the common keys). */
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
type TabDesc = DistributiveOmit<Tab, 'id'>;

/** Tabs with a key are singletons (one tab per saved request, environment, ...). */
function tabKey(t: Tab | TabDesc): string | null {
  switch (t.type) {
    case 'request': return t.itemId ? `request:${t.collectionId}:${t.itemId}` : null;
    case 'example': return `example:${t.exampleId}`;
    case 'environment': return `environment:${t.envId}`;
    case 'collection': return `collection:${t.collectionId}:${t.nodeId || ''}`;
    case 'runner': return `runner:${t.collectionId}`;
    default: return null;
  }
}

export const activeTab = (): Tab | null => app.tabs.find((t) => t.id === app.activeTabId) || null;

function insertAfterActive(tab: Tab): void {
  const index = app.tabs.findIndex((t) => t.id === app.activeTabId);
  app.tabs.splice(index >= 0 ? index + 1 : app.tabs.length, 0, tab);
}

export function openTab<T extends Tab>(desc: Omit<T, 'id'> & { id?: string }): T {
  const key = tabKey(desc as unknown as Tab);
  let tab = key ? app.tabs.find((t) => tabKey(t) === key) : undefined;
  if (!tab) {
    tab = { ...desc, id: desc.id || uid() } as unknown as T;
    insertAfterActive(tab);
  }
  activateTab(tab.id);
  return tab as T;
}

export function newRequest(draft?: Partial<Draft>, extra: Partial<RequestTab> = {}): RequestTab {
  return openTab<RequestTab>(requestTabState({ collectionId: null, itemId: null, draft: normalizeDraft(draft), saved: null, ...extra }));
}

export function openRequest(collectionId: string, itemId: string): Tab | null {
  const c = findCollection(collectionId);
  const hit = c && findNode(c, itemId);
  if (!hit || isFolder(hit.node)) return null;
  const existing = app.tabs.find((t) => t.type === 'request' && t.collectionId === collectionId && t.itemId === itemId);
  if (existing) return activateTab(existing.id);
  const draft = draftFromItem(hit.node);
  return openTab<RequestTab>(requestTabState({ collectionId, itemId, draft, saved: stable(draft) }));
}

export const openExample = (collectionId: string, itemId: string, exampleId: string): ExampleTab => openTab<ExampleTab>({ type: 'example', collectionId, itemId, exampleId });
export const openEnvironment = (envId: string): EnvironmentTab => openTab<EnvironmentTab>({ type: 'environment', envId });
export const openCollectionEditor = (collectionId: string, nodeId?: string | null): CollectionTab => openTab<CollectionTab>({ type: 'collection', collectionId, nodeId: nodeId || null, subtab: 'overview' });
export const openWebSocket = (url = ''): WebSocketTab => openTab<WebSocketTab>({ type: 'websocket', url, headers: [], protocols: '', subtab: 'message', messages: [], status: 'disconnected', connId: null });

export function openRunner(collectionId: string, folderId?: string): RunnerTab {
  const tab = openTab<RunnerTab>({ type: 'runner', collectionId, config: {}, result: null, running: null });
  if (folderId !== undefined) {
    tab.config.folderId = folderId;
    updateTab(tab.id);
  }
  return tab;
}

export function activateTab(id: string): Tab | null {
  const tab = app.tabs.find((t) => t.id === id);
  if (!tab) return null;
  app.activeTabId = id;
  mountActive();
  renderTabbar();
  save();
  return tab;
}

// Titles & dirty state --------------------------------------------------
function draftHasContent(d: Draft): boolean {
  return !!(d.url.trim() || d.headers.some((r) => !isBlankRow(r)) || d.body.mode !== 'none'
    || d.scripts.prerequest.trim() || d.scripts.test.trim() || d.auth.type !== 'inherit');
}

export function isDirty(tab: Tab | null | undefined): boolean {
  if (!tab || tab.type !== 'request') return false;
  return tab.itemId ? stable(tab.draft) !== tab.saved : draftHasContent(tab.draft);
}

function requestTitle(tab: RequestTab): string {
  if (tab.itemId) return tab.draft.name || 'Untitled Request';
  if (tab.draft.name && tab.draft.name !== 'Untitled Request') return tab.draft.name;
  return tab.draft.url.trim() || 'Untitled Request';
}

function exampleTitle(tab: ExampleTab): string {
  const c = findCollection(tab.collectionId);
  const hit = c && findNode(c, tab.itemId);
  const example = hit && !isFolder(hit.node) ? (hit.node.response || []).find((r) => r.id === tab.exampleId) : null;
  return example ? example.name : 'Example';
}

function collectionTitle(tab: CollectionTab): string {
  const c = findCollection(tab.collectionId);
  if (!c) return 'Collection';
  if (!tab.nodeId) return c.info.name;
  const hit = findNode(c, tab.nodeId);
  return hit ? hit.node.name : 'Folder';
}

export function tabTitle(tab: Tab): string {
  switch (tab.type) {
    case 'request': return requestTitle(tab);
    case 'example': return exampleTitle(tab);
    case 'websocket': return tab.url.trim() || 'New WebSocket Request';
    case 'environment': return tab.envId === 'globals' ? 'Globals' : (findEnvironment(tab.envId) || { name: 'Environment' }).name;
    case 'collection': return collectionTitle(tab);
    case 'runner': { const c = findCollection(tab.collectionId); return `Run ${c ? c.info.name : ''}`.trim(); }
    default: return 'Tab';
  }
}

// Closing -----------------------------------------------------------------
async function confirmDiscard(tab: RequestTab): Promise<boolean> {
  activateTab(tab.id);
  const answer = await choice<'discard' | 'save'>({
    title: 'Unsaved changes',
    message: `"${tabTitle(tab)}" has unsaved changes. Save before closing?`,
    options: [{ label: 'Cancel', value: null as unknown as 'discard' }, { label: "Don't save", value: 'discard', danger: true }, { label: 'Save', value: 'save', primary: true }]
  });
  if (!answer) return false;
  return answer !== 'save' || saveRequestTab(tab);
}

function stopTabWork(tab: Tab): void {
  if (tab.type === 'request' && tab.running) abort(tab.running);
  if (tab.type === 'websocket' && tab.connId) void window.apiforge.ws.close(tab.connId);
  if (tab.type === 'runner' && tab.running) abort(tab.running);
}

function removeTab(tab: Tab): void {
  const index = app.tabs.indexOf(tab);
  app.tabs.splice(index, 1);
  const view = app.views.get(tab.id);
  if (view) {
    if (view.destroy) view.destroy();
    app.views.delete(tab.id);
  }
  if (app.activeTabId === tab.id) {
    const next = app.tabs[index] || app.tabs[index - 1];
    app.activeTabId = next ? next.id : null;
  }
}

export async function closeTab(id: string, force = false): Promise<boolean> {
  const tab = app.tabs.find((t) => t.id === id);
  if (!tab) return false;
  if (!force && tab.type === 'request' && isDirty(tab) && !(await confirmDiscard(tab))) return false;
  stopTabWork(tab);
  removeTab(tab);
  mountActive();
  renderTabbar();
  save();
  return true;
}

export async function closeOtherTabs(keepId: string): Promise<void> {
  for (const t of [...app.tabs]) if (t.id !== keepId && !(await closeTab(t.id))) return;
}

export async function closeAllTabs(): Promise<void> {
  for (const t of [...app.tabs]) if (!(await closeTab(t.id))) return;
}

/** Close tabs whose backing item/collection/environment disappeared. */
export function closeTabsWhere(predicate: (tab: Tab) => boolean): void {
  app.tabs.filter(predicate).forEach((t) => { void closeTab(t.id, true); });
}

// Updates -----------------------------------------------------------------
export function updateTab(id: string): void {
  const view = app.views.get(id);
  if (!view) return;
  if (id === app.activeTabId) view.update();
  else view.stale = true;
}

export function markDirty(tab: Tab): void {
  renderTabbarItem(tab);
  const view = app.views.get(tab.id);
  if (view && view.markDirty) view.markDirty();
  save();
}

export interface NotifyOptions { sidebar?: boolean; tabs?: string[] | 'all'; tabbar?: boolean }

/** Re-render after data changes. */
export function notify({ sidebar, tabs, tabbar }: NotifyOptions = {}): void {
  if (sidebar) renderSidebar();
  if (sidebar || tabbar || tabs) { renderTabbar(); renderEnvSelect(); }
  const ids = tabs === 'all' ? app.tabs.map((t) => t.id) : (tabs || []);
  ids.forEach(updateTab);
}
