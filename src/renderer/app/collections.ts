/**
 * Collection, folder, request and example operations, plus saving request
 * tabs into collections.
 */
import type { CollectionJson, ExampleJson, FolderJson, ItemJson, NodeJson, RequestTab, Tab } from '../../shared/types';
import * as M from '../model';
import { confirm, prompt, toast } from '../ui';
import { saveAs } from '../views/dialogs/save-as';
import { findCollection, stable } from './lookups';
import { save } from './persistence';
import { app, type DragSource } from './state';
import { closeTabsWhere, notify, openRequest, type NotifyOptions } from './tabs';

const safeFileName = (name: string): string => name.replace(/[\\/:*?"<>|]+/g, '_');

function expandPath(collectionId: string, nodeId?: string | null): void {
  app.expanded.add(collectionId);
  if (!nodeId) return;
  const c = findCollection(collectionId);
  const hit = c && M.findNode(c, nodeId);
  (hit ? hit.ancestors : []).forEach((a) => app.expanded.add(a.id));
  app.expanded.add(nodeId);
}

interface Hit extends M.NodeHit { c: CollectionJson }

function nodeHit(collectionId: string | null, nodeId: string | null): Hit | null {
  const c = findCollection(collectionId);
  const hit = c && M.findNode(c, nodeId);
  return c && hit ? { c, ...hit } : null;
}

function changed(options: NotifyOptions = { sidebar: true }): void {
  save();
  notify(options);
}

// Collections ------------------------------------------------------------
export async function createCollection(name?: string): Promise<CollectionJson | null> {
  const n = name || await prompt({ title: 'New Collection', label: 'Name', value: 'New Collection', okLabel: 'Create' });
  if (!n) return null;
  const c = M.newCollection(n);
  app.state.collections.push(c);
  app.expanded.add(c.info._postman_id);
  changed();
  return c;
}

export async function renameCollection(c: CollectionJson): Promise<void> {
  const name = await prompt({ title: 'Rename Collection', label: 'Name', value: c.info.name });
  if (!name) return;
  c.info.name = name;
  changed({ sidebar: true, tabs: 'all' });
}

export async function deleteCollection(c: CollectionJson): Promise<void> {
  const ok = await confirm({ title: 'Delete Collection', message: `Delete "${c.info.name}" and all its requests? This cannot be undone.`, okLabel: 'Delete', danger: true });
  if (!ok) return;
  const id = c.info._postman_id;
  app.state.collections = app.state.collections.filter((x) => x !== c);
  closeTabsWhere((t) => (t.type === 'request' && !!t.itemId && t.collectionId === id) || ((t.type === 'collection' || t.type === 'runner' || t.type === 'example') && t.collectionId === id));
  app.tabs.forEach((t) => { if (t.type === 'request' && t.collectionId === id) { t.collectionId = null; t.itemId = null; } });
  changed({ sidebar: true, tabs: 'all' });
}

export function duplicateCollection(c: CollectionJson): void {
  const copy = M.clone(c);
  copy.info._postman_id = M.uid();
  copy.info.name = `${c.info.name} Copy`;
  M.walk(copy.item, (n) => { n.id = M.uid(); if (!M.isFolder(n)) (n.response || []).forEach((r) => { r.id = M.uid(); }); });
  app.state.collections.splice(app.state.collections.indexOf(c) + 1, 0, copy);
  changed();
}

export async function exportCollection(c: CollectionJson): Promise<void> {
  const data = M.clone(c);
  data.info.schema = M.SCHEMA_V21;
  const file = await window.apiforge.files.saveText({ defaultName: `${safeFileName(c.info.name)}.postman_collection.json`, content: JSON.stringify(data, null, 2), filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (file) toast(`Exported to ${file}`, 'success');
}

// Nodes -------------------------------------------------------------------
export function addRequest(collectionId: string, parentId: string | null): void {
  const c = findCollection(collectionId);
  if (!c) return;
  const item = M.newRequestItem('New Request');
  M.insertNode(c, parentId || null, item);
  expandPath(collectionId, parentId);
  changed();
  openRequest(collectionId, item.id);
}

export async function addFolder(collectionId: string, parentId: string | null): Promise<void> {
  const c = findCollection(collectionId);
  if (!c) return;
  const name = await prompt({ title: 'New Folder', label: 'Name', value: 'New Folder', okLabel: 'Create' });
  if (!name) return;
  const folder = M.newFolder(name);
  M.insertNode(c, parentId || null, folder);
  expandPath(collectionId, parentId);
  app.expanded.add(folder.id);
  changed();
}

/** Keep open request tabs in sync with a renamed item. */
function renameOpenTabs(nodeId: string, name: string): void {
  app.tabs.forEach((t) => {
    if (t.type !== 'request' || t.itemId !== nodeId) return;
    t.draft.name = name;
    t.saved = stable({ ...(JSON.parse(t.saved || '{}') as object), name });
  });
}

export async function renameNode(collectionId: string, nodeId: string): Promise<void> {
  const hit = nodeHit(collectionId, nodeId);
  if (!hit) return;
  const name = await prompt({ title: M.isFolder(hit.node) ? 'Rename Folder' : 'Rename Request', label: 'Name', value: hit.node.name });
  if (!name) return;
  hit.node.name = name;
  renameOpenTabs(nodeId, name);
  changed({ sidebar: true, tabs: 'all' });
}

export async function deleteNode(collectionId: string, nodeId: string): Promise<void> {
  const hit = nodeHit(collectionId, nodeId);
  if (!hit) return;
  const folder = M.isFolder(hit.node);
  const ok = await confirm({ title: folder ? 'Delete Folder' : 'Delete Request', message: `Delete "${hit.node.name}"${folder ? ' and everything inside it' : ''}?`, okLabel: 'Delete', danger: true });
  if (!ok) return;
  const ids = new Set([nodeId]);
  M.walk(hit.node.item || [], (n) => { ids.add(n.id); });
  M.removeNode(hit.c, nodeId);
  closeTabsWhere((t) => ((t.type === 'request' || t.type === 'example') && ids.has(t.itemId || '')) || (t.type === 'collection' && ids.has(t.nodeId || '')));
  changed();
}

export function duplicateNode(collectionId: string, nodeId: string): void {
  const hit = nodeHit(collectionId, nodeId);
  if (!hit) return;
  hit.container.splice(hit.index + 1, 0, M.duplicateNode(hit.node));
  changed();
}

export interface MoveDestination { collectionId: string; parentId: string | null; beforeId: string | null }

/** Tabs bound to a moved subtree follow it to the destination collection. */
function retargetTabs(src: DragSource, dest: MoveDestination, node: NodeJson): void {
  if (src.collectionId === dest.collectionId) return;
  const subtree = { item: M.isFolder(node) ? node.item : [] };
  const boundTo = (t: Tab): string | null => (t.type === 'request' || t.type === 'example' ? t.itemId : t.type === 'collection' ? t.nodeId : null);
  app.tabs
    .filter((t): t is Tab & { collectionId: string | null } => 'collectionId' in t && t.collectionId === src.collectionId)
    .filter((t) => boundTo(t) === src.nodeId || !!M.findNode(subtree, boundTo(t)))
    .forEach((t) => { t.collectionId = dest.collectionId; });
}

export function moveNode(src: DragSource, dest: MoveDestination): boolean {
  const from = findCollection(src.collectionId);
  const to = findCollection(dest.collectionId);
  const hit = from && M.findNode(from, src.nodeId);
  if (!hit || !to || !from) return false;
  if (src.nodeId === dest.parentId || src.nodeId === dest.beforeId) return false;
  if (M.isFolder(hit.node) && dest.parentId && M.findNode({ item: hit.node.item }, dest.parentId)) return false;
  M.removeNode(from, src.nodeId);
  const target = dest.beforeId ? M.findNode(to, dest.beforeId) : null;
  M.insertNode(to, dest.parentId || null, hit.node, target ? target.index : undefined);
  expandPath(dest.collectionId, dest.parentId);
  retargetTabs(src, dest, hit.node);
  changed({ sidebar: true, tabs: 'all' });
  return true;
}

// Examples ----------------------------------------------------------------
function findExample(collectionId: string, itemId: string, exampleId: string): { hit: Hit; item: ItemJson; example: ExampleJson } | null {
  const hit = nodeHit(collectionId, itemId);
  if (!hit || M.isFolder(hit.node)) return null;
  const item = hit.node;
  const example = (item.response || []).find((r) => r.id === exampleId);
  return example ? { hit, item, example } : null;
}

export async function deleteExample(collectionId: string, itemId: string, exampleId: string): Promise<void> {
  const found = findExample(collectionId, itemId, exampleId);
  if (!found) return;
  const ok = await confirm({ title: 'Delete Example', message: `Delete example "${found.example.name}"?`, okLabel: 'Delete', danger: true });
  if (!ok) return;
  found.item.response = (found.item.response || []).filter((r) => r.id !== exampleId);
  closeTabsWhere((t) => t.type === 'example' && t.exampleId === exampleId);
  changed();
}

export async function renameExample(collectionId: string, itemId: string, exampleId: string): Promise<void> {
  const found = findExample(collectionId, itemId, exampleId);
  if (!found) return;
  const name = await prompt({ title: 'Rename Example', label: 'Name', value: found.example.name });
  if (!name) return;
  found.example.name = name;
  changed({ sidebar: true, tabs: 'all' });
}

function exampleFromResponse(tab: RequestTab, name: string): ExampleJson {
  const r = tab.response as NonNullable<RequestTab['response']>;
  return {
    id: M.uid(),
    name,
    originalRequest: M.itemFromDraft(tab.draft).request as ExampleJson['originalRequest'],
    status: r.status,
    code: r.code,
    _postman_previewlanguage: M.languageFromContentType(r.contentType, r.body),
    header: r.headers.map((x) => ({ key: x.key, value: x.value })),
    cookie: [],
    body: r.body == null ? '' : r.body
  };
}

export async function saveAsExample(tab: RequestTab): Promise<void> {
  if (!tab.response) return toast('Send the request first to save its response', 'warning');
  if (!tab.itemId && !(await saveRequestTab(tab))) return;
  const hit = nodeHit(tab.collectionId, tab.itemId);
  if (!hit || M.isFolder(hit.node)) return;
  const name = await prompt({ title: 'Save Response as Example', label: 'Example name', value: tab.draft.name || 'Example' });
  if (!name) return;
  hit.node.response = hit.node.response || [];
  hit.node.response.push(exampleFromResponse(tab, name));
  app.expanded.add(tab.itemId as string);
  changed();
  toast('Example saved', 'success');
}

// Saving requests -----------------------------------------------------------
function saveExisting(tab: RequestTab): boolean {
  const hit = nodeHit(tab.collectionId, tab.itemId);
  if (!hit || M.isFolder(hit.node)) return false;
  hit.container[hit.index] = M.itemFromDraft(tab.draft, hit.node);
  tab.saved = stable(tab.draft);
  changed({ sidebar: true, tabs: [tab.id] });
  toast('Request saved', 'success');
  return true;
}

export async function saveRequestTab(tab: Tab): Promise<boolean> {
  if (tab.type !== 'request') return false;
  if (tab.collectionId && tab.itemId && saveExisting(tab)) return true;
  return saveAs(tab);
}

/** Called by the save-as dialog once the user picked a destination. */
export function saveRequestInto(tab: RequestTab, collectionId: string, folderId: string | null, name: string): boolean {
  const c = findCollection(collectionId);
  if (!c) return false;
  tab.draft.name = name;
  const item = M.itemFromDraft(tab.draft);
  M.insertNode(c, folderId || null, item);
  Object.assign(tab, { collectionId, itemId: item.id, saved: stable(tab.draft) });
  expandPath(collectionId, folderId);
  changed({ sidebar: true, tabs: [tab.id] });
  toast('Request saved', 'success');
  return true;
}

export type { FolderJson };
