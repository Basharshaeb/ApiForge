/**
 * Context menus for sidebar rows. `anchor` is an element or a { x, y } point.
 */
import type { CollectionJson, Environment, ExampleJson, FolderJson, HistoryEntry, ItemJson } from '../../../shared/types';
import { clone, draftFromItem, substitute } from '../../model';
import * as Codegen from '../../codegen';
import { copyText, menu, type MenuEntry } from '../../ui';
import * as App from '../../app';

export type Anchor = Element | { x: number; y: number };

function show(anchor: Anchor, items: MenuEntry[]): void {
  const isPoint = 'x' in anchor;
  menu(isPoint ? null : anchor, items, isPoint ? { point: anchor } : { alignRight: true });
}

export function collectionMenu(collection: CollectionJson, folder: FolderJson | null, anchor: Anchor): void {
  const cid = collection.info._postman_id;
  const folderId = folder ? folder.id : null;
  show(anchor, [
    { label: 'Add Request', icon: 'plus', onClick: () => App.addRequest(cid, folderId) },
    { label: 'Add Folder', icon: 'folder', onClick: () => { void App.addFolder(cid, folderId); } },
    'separator',
    { label: folder ? 'Edit Folder' : 'Edit Collection', icon: 'settings', onClick: () => { App.openCollectionEditor(cid, folderId); } },
    { label: 'Rename', onClick: () => { void (folder ? App.renameNode(cid, folder.id) : App.renameCollection(collection)); } },
    { label: folder ? 'Run Folder' : 'Run Collection', icon: 'runner', onClick: () => { App.openRunner(cid, folderId || ''); } },
    { label: 'Duplicate', icon: 'copy', onClick: () => (folder ? App.duplicateNode(cid, folder.id) : App.duplicateCollection(collection)) },
    folder ? null : { label: 'Export', icon: 'download', onClick: () => { void App.exportCollection(collection); } },
    'separator',
    { label: 'Delete', icon: 'trash', danger: true, onClick: () => { void (folder ? App.deleteNode(cid, folder.id) : App.deleteCollection(collection)); } }
  ]);
}

export function requestMenu(collection: CollectionJson, node: ItemJson, anchor: Anchor): void {
  const cid = collection.info._postman_id;
  const copyCurl = (): void => { void copyText(Codegen.generate('curl', draftFromItem(node), (s) => substitute(s, App.vars(cid)))); };
  show(anchor, [
    { label: 'Open', onClick: () => { App.openRequest(cid, node.id); } },
    { label: 'Rename', onClick: () => { void App.renameNode(cid, node.id); } },
    { label: 'Duplicate', icon: 'copy', onClick: () => App.duplicateNode(cid, node.id) },
    { label: 'Copy as cURL', icon: 'code', onClick: copyCurl },
    'separator',
    { label: 'Delete', icon: 'trash', danger: true, onClick: () => { void App.deleteNode(cid, node.id); } }
  ]);
}

export function exampleMenu(cid: string, itemId: string, example: ExampleJson, anchor: Anchor): void {
  show(anchor, [
    { label: 'Open', onClick: () => { App.openExample(cid, itemId, example.id); } },
    { label: 'Rename', onClick: () => { void App.renameExample(cid, itemId, example.id); } },
    'separator',
    { label: 'Delete', icon: 'trash', danger: true, onClick: () => { void App.deleteExample(cid, itemId, example.id); } }
  ]);
}

export function globalsMenu(anchor: Anchor): void {
  show(anchor, [
    { label: 'Open', onClick: () => { App.openEnvironment('globals'); } },
    { label: 'Export', icon: 'download', onClick: () => { void App.exportEnvironment({ id: 'globals', name: 'globals', values: App.app.state.globals.values }, 'globals'); } }
  ]);
}

export function environmentMenu(env: Environment, anchor: Anchor): void {
  const isActive = env.id === App.app.state.settings.activeEnvironmentId;
  show(anchor, [
    { label: isActive ? 'Deactivate' : 'Set as Active', icon: 'check', onClick: () => App.setActiveEnvironment(isActive ? null : env.id) },
    { label: 'Open', onClick: () => { App.openEnvironment(env.id); } },
    { label: 'Rename', onClick: () => { void App.renameEnvironment(env); } },
    { label: 'Duplicate', icon: 'copy', onClick: () => App.duplicateEnvironment(env) },
    { label: 'Export', icon: 'download', onClick: () => { void App.exportEnvironment(env); } },
    'separator',
    { label: 'Delete', icon: 'trash', danger: true, onClick: () => { void App.deleteEnvironment(env); } }
  ]);
}

export function historyMenu(entry: HistoryEntry, anchor: Anchor, open: (entry: HistoryEntry) => void): void {
  show(anchor, [
    { label: 'Open', onClick: () => open(entry) },
    { label: 'Open as new request', onClick: () => { App.newRequest(clone(entry.draft)); } },
    'separator',
    { label: 'Delete', icon: 'trash', danger: true, onClick: () => { App.app.state.history = App.app.state.history.filter((e) => e !== entry); App.save(); App.renderSidebar(); } }
  ]);
}
