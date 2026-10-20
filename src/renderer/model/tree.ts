/**
 * Collections and tree operations over v2.1 `item` arrays.
 */
import type { CollectionJson, Draft, FolderJson, ItemJson, NodeJson } from '../../shared/types';
import { SCHEMA_V21 } from './constants';
import { emptyDraft, itemFromDraft } from './draft';
import { clone, uid } from './util';

export interface NodeHit { node: NodeJson; ancestors: FolderJson[]; container: NodeJson[]; index: number }
export type TreeLike = { item: NodeJson[] };
type Visitor = (node: NodeJson, ancestors: FolderJson[]) => boolean | void;

export const isFolder = (node: NodeJson | null | undefined): node is FolderJson => !!node && Array.isArray(node.item);

export function newCollection(name?: string): CollectionJson {
  return {
    info: { _postman_id: uid(), name: name || 'New Collection', schema: SCHEMA_V21, description: '' },
    item: [],
    variable: [],
    event: []
  };
}

export const newFolder = (name?: string): FolderJson => ({ id: uid(), name: name || 'New Folder', item: [], description: '' });

export const newRequestItem = (name?: string, draftOverrides: Partial<Draft> = {}): ItemJson =>
  itemFromDraft(emptyDraft({ name: name || 'New Request', ...draftOverrides }));

/** Depth-first visit; `fn(node, ancestors)` returning false stops the walk. */
export function walk(nodes: NodeJson[] | undefined, fn: Visitor, ancestors: FolderJson[] = []): boolean {
  for (const node of nodes || []) {
    if (fn(node, ancestors) === false) return false;
    if (isFolder(node) && walk(node.item, fn, ancestors.concat(node)) === false) return false;
  }
  return true;
}

export function ensureIds(collection: CollectionJson): CollectionJson {
  collection.info = collection.info || ({} as CollectionJson['info']);
  collection.info._postman_id = collection.info._postman_id || uid();
  collection.info.schema = SCHEMA_V21;
  collection.item = collection.item || [];
  walk(collection.item, (node) => { if (!node.id) node.id = uid(); });
  return collection;
}

/** Locate a node by id: { node, ancestors, container, index } or null. */
export function findNode(collection: TreeLike, id: string | null | undefined): NodeHit | null {
  let found: NodeHit | null = null;
  if (!id) return null;
  walk(collection.item, (node, ancestors) => {
    if (node.id !== id) return true;
    const parent = ancestors[ancestors.length - 1];
    const container = parent ? parent.item : collection.item;
    found = { node, ancestors, container, index: container.indexOf(node) };
    return false;
  });
  return found;
}

export function removeNode(collection: TreeLike, id: string): NodeJson | null {
  const hit = findNode(collection, id);
  if (!hit) return null;
  hit.container.splice(hit.index, 1);
  return hit.node;
}

function containerFor(collection: TreeLike, parentId: string | null): NodeJson[] {
  if (!parentId) return collection.item;
  const hit = findNode(collection, parentId);
  if (!hit || !isFolder(hit.node)) throw new Error('Target folder not found');
  return hit.node.item;
}

export function insertNode<T extends NodeJson>(collection: TreeLike, parentId: string | null, node: T, index?: number): T {
  const container = containerFor(collection, parentId);
  if (index === undefined || index < 0 || index > container.length) container.push(node);
  else container.splice(index, 0, node);
  return node;
}

const isDescendant = (folder: FolderJson, id: string): boolean => !!findNode({ item: folder.item || [] }, id);

/** Move a node under a folder (or to the collection root when parentId is null). */
export function moveNode(collection: TreeLike, id: string, parentId: string | null, index?: number): boolean {
  if (id === parentId) return false;
  const hit = findNode(collection, id);
  if (!hit) return false;
  if (parentId && isFolder(hit.node) && isDescendant(hit.node, parentId)) return false;
  hit.container.splice(hit.index, 1);
  insertNode(collection, parentId, hit.node, index);
  return true;
}

export function duplicateNode<T extends NodeJson>(node: T): T {
  const copy = clone(node);
  copy.id = uid();
  copy.name = `${node.name} Copy`;
  walk(copy.item || [], (n) => { n.id = uid(); });
  if (!isFolder(copy)) (copy.response || []).forEach((r) => { r.id = uid(); });
  return copy;
}

export function countRequests(nodes: NodeJson[] | undefined): number {
  let n = 0;
  walk(nodes, (node) => { if (!isFolder(node)) n++; });
  return n;
}

/**
 * Wrap one request in a collection that keeps its ancestor chain, so
 * collection- and folder-level auth, scripts and variables apply exactly as
 * they do in Postman.
 */
export function buildRunCollection(collection: CollectionJson | null, itemId: string | null, item: ItemJson): CollectionJson {
  const info = { _postman_id: uid(), name: 'ApiForge Run', schema: SCHEMA_V21 };
  if (!collection) return { info, item: [item] };
  const hit = itemId ? findNode(collection, itemId) : null;
  const nested = (hit ? hit.ancestors : []).slice().reverse().reduce<NodeJson>((inner, folder) => {
    const { item: _children, ...rest } = folder;
    return { ...clone(rest), item: [inner] } as FolderJson;
  }, item);
  return {
    info: { ...clone(collection.info), schema: SCHEMA_V21 },
    variable: clone(collection.variable || []),
    auth: clone(collection.auth),
    event: clone(collection.event || []),
    item: [nested]
  };
}
