/**
 * Collections tree section of the sidebar.
 */
import type { CollectionJson, ExampleJson, FolderJson, ItemJson, NodeJson, Tab } from '../../../shared/types';
import { countRequests, findNode, isFolder, rawFromUrlObject, walk } from '../../model';
import { h, icon, iconButton, methodBadge } from '../../ui';
import * as App from '../../app';
import { makeDraggable, makeDropTarget } from './dnd';
import { collectionMenu, exampleMenu, requestMenu } from './menus';

const INDENT_BASE = 8;
const INDENT_STEP = 14;
const indentStyle = (depth: number, extra = 0): Record<string, string> => ({ paddingLeft: `${INDENT_BASE + depth * INDENT_STEP + extra}px` });

interface TreeCtx { container: HTMLElement; collection: CollectionJson; visible: Set<string> | null; active: Tab | null }

// Filtering ------------------------------------------------------------------
function nodeMatches(node: NodeJson, filter: string): boolean {
  if ((node.name || '').toLowerCase().includes(filter)) return true;
  if (isFolder(node) || !node.request) return false;
  const url = rawFromUrlObject(typeof node.request === 'string' ? node.request : node.request.url);
  return url.toLowerCase().includes(filter);
}

/** Node ids to show under a filter: matches plus their ancestors. */
function visibleIds(collection: CollectionJson, filter: string): Set<string> {
  const ids = new Set<string>();
  walk(collection.item, (node, ancestors) => {
    if (!nodeMatches(node, filter)) return;
    ids.add(node.id);
    ancestors.forEach((a) => ids.add(a.id));
  });
  return ids;
}

function toggleExpand(id: string): void {
  if (App.app.expanded.has(id)) App.app.expanded.delete(id);
  else App.app.expanded.add(id);
  App.save();
  App.renderSidebar();
}

// Rows --------------------------------------------------------------------------
const chevron = (open: boolean, empty = false): HTMLElement => h('span', { class: `chevron${open ? ' open' : ''}${empty ? ' empty' : ''}` }, icon('chevron', 12));
const isSelectedCollection = (active: Tab | null, cid: string, nodeId: string | null): boolean =>
  !!active && active.type === 'collection' && active.collectionId === cid && (active.nodeId || null) === nodeId;
const point = (e: MouseEvent): { x: number; y: number } => ({ x: e.clientX, y: e.clientY });

function collectionRow(c: CollectionJson, expanded: boolean, active: Tab | null): HTMLElement {
  const cid = c.info._postman_id;
  const row = h('div', {
    class: `tree-row collection${isSelectedCollection(active, cid, null) ? ' selected' : ''}`,
    dataset: { collection: cid },
    onclick: () => toggleExpand(cid),
    oncontextmenu: (e: MouseEvent) => { e.preventDefault(); collectionMenu(c, null, point(e)); }
  },
  chevron(expanded),
  icon('collections', 14),
  h('span', { class: 'tree-name', title: c.info.name }, c.info.name),
  h('span', { class: 'row-actions' },
    iconButton('play', 'Run collection', (e) => { e.stopPropagation(); App.openRunner(cid); }),
    iconButton('plus', 'Add request', (e) => { e.stopPropagation(); App.addRequest(cid, null); }),
    iconButton('more', 'More actions', (e) => { e.stopPropagation(); collectionMenu(c, null, e.currentTarget as Element); })));
  makeDropTarget(row, { collectionId: cid, parentId: null, beforeId: null });
  return row;
}

function folderRow(collection: CollectionJson, node: FolderJson, depth: number, expanded: boolean, active: Tab | null): HTMLElement {
  const cid = collection.info._postman_id;
  const row = h('div', {
    class: `tree-row folder${isSelectedCollection(active, cid, node.id) ? ' selected' : ''}`,
    style: indentStyle(depth),
    draggable: true,
    dataset: { node: node.id },
    onclick: () => toggleExpand(node.id),
    oncontextmenu: (e: MouseEvent) => { e.preventDefault(); collectionMenu(collection, node, point(e)); }
  },
  chevron(expanded),
  h('span', { class: 'tree-icon' }, icon(expanded ? 'folder-open' : 'folder', 14)),
  h('span', { class: 'tree-name', title: node.name }, node.name),
  h('span', { class: 'tree-count' }, countRequests(node.item) || ''),
  h('span', { class: 'row-actions' },
    iconButton('plus', 'Add request', (e) => { e.stopPropagation(); App.addRequest(cid, node.id); }),
    iconButton('more', 'More actions', (e) => { e.stopPropagation(); collectionMenu(collection, node, e.currentTarget as Element); })));
  makeDraggable(row, cid, node.id);
  makeDropTarget(row, { collectionId: cid, parentId: node.id, beforeId: null });
  return row;
}

function parentIdOf(collection: CollectionJson, nodeId: string): string | null {
  const hit = findNode(collection, nodeId);
  const parent = hit && hit.ancestors[hit.ancestors.length - 1];
  return parent ? parent.id : null;
}

function requestRow(collection: CollectionJson, node: ItemJson, depth: number, expanded: boolean, active: Tab | null): HTMLElement {
  const cid = collection.info._postman_id;
  const method = node.request ? (typeof node.request === 'string' ? 'GET' : node.request.method) : 'GET';
  const hasExamples = (node.response || []).length > 0;
  const selected = !!active && ((active.type === 'request' && active.itemId === node.id) || (active.type === 'example' && active.itemId === node.id && !expanded));
  const row = h('div', {
    class: `tree-row request${selected ? ' selected' : ''}`,
    style: indentStyle(depth),
    draggable: true,
    dataset: { node: node.id },
    onclick: () => { App.openRequest(cid, node.id); },
    oncontextmenu: (e: MouseEvent) => { e.preventDefault(); requestMenu(collection, node, point(e)); }
  },
  h('span', { class: `chevron${expanded ? ' open' : ''}${hasExamples ? '' : ' empty'}`, onclick: (e: Event) => { if (hasExamples) { e.stopPropagation(); toggleExpand(node.id); } } }, icon('chevron', 12)),
  methodBadge(method, true),
  h('span', { class: 'tree-name', title: node.name }, node.name),
  h('span', { class: 'row-actions' }, iconButton('more', 'More actions', (e) => { e.stopPropagation(); requestMenu(collection, node, e.currentTarget as Element); })));
  makeDraggable(row, cid, node.id);
  makeDropTarget(row, { collectionId: cid, parentId: parentIdOf(collection, node.id), beforeId: node.id }, true);
  return row;
}

function exampleRow(cid: string, node: ItemJson, example: ExampleJson, depth: number, active: Tab | null): HTMLElement {
  const selected = !!active && active.type === 'example' && active.exampleId === example.id;
  return h('div', {
    class: `tree-row example${selected ? ' selected' : ''}`,
    style: indentStyle(depth + 1, 18),
    onclick: () => { App.openExample(cid, node.id, example.id); },
    oncontextmenu: (e: MouseEvent) => { e.preventDefault(); exampleMenu(cid, node.id, example, point(e)); }
  },
  h('span', { class: 'tree-icon' }, icon('example', 13)),
  h('span', { class: 'tree-name', title: example.name }, example.name),
  h('span', { class: 'row-actions' }, iconButton('more', 'More actions', (e) => { e.stopPropagation(); exampleMenu(cid, node.id, example, e.currentTarget as Element); })));
}

function renderChildren(tree: TreeCtx, nodes: NodeJson[], depth: number): void {
  const { container, collection, visible, active } = tree;
  const cid = collection.info._postman_id;
  nodes.forEach((node) => {
    if (visible && !visible.has(node.id)) return;
    if (isFolder(node)) {
      const expanded = visible ? true : App.app.expanded.has(node.id);
      container.appendChild(folderRow(collection, node, depth, expanded, active));
      if (expanded) renderChildren(tree, node.item, depth + 1);
      return;
    }
    const examples = node.response || [];
    const expanded = examples.length > 0 && App.app.expanded.has(node.id);
    container.appendChild(requestRow(collection, node, depth, expanded, active));
    if (expanded) examples.forEach((ex) => container.appendChild(exampleRow(cid, node, ex, depth, active)));
  });
}

function emptyCollectionHint(cid: string): HTMLElement {
  return h('div', { class: 'tree-empty', style: { padding: '8px 12px 8px 40px', textAlign: 'left' } }, 'This collection is empty. ',
    h('button', { class: 'link-btn', type: 'button', onclick: () => App.addRequest(cid, null) }, 'Add a request'));
}

function renderCollection(body: HTMLElement, c: CollectionJson, filter: string, active: Tab | null): void {
  const cid = c.info._postman_id;
  const visible = filter ? visibleIds(c, filter) : null;
  if (visible && !visible.size && !c.info.name.toLowerCase().includes(filter)) return;
  const expanded = filter ? true : App.app.expanded.has(cid);
  body.appendChild(collectionRow(c, expanded, active));
  if (!expanded) return;
  const children = h('div', { class: 'tree-children' });
  renderChildren({ container: children, collection: c, visible, active }, c.item, 1);
  if (!c.item.length) children.appendChild(emptyCollectionHint(cid));
  body.appendChild(children);
}

export function renderCollectionsSection(body: HTMLElement, filter: string): void {
  if (!App.app.state.collections.length) {
    body.appendChild(h('div', { class: 'sidebar-empty' }, 'Collections group related requests so you can organize and run them together.',
      h('br'), h('button', { class: 'btn btn-primary btn-small', type: 'button', onclick: () => { void App.createCollection(); } }, 'Create Collection')));
    return;
  }
  const active = App.activeTab();
  App.app.state.collections.forEach((c) => renderCollection(body, c, filter, active));
}
