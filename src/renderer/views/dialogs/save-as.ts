/**
 * "Save Request" dialog: pick a name and a collection / folder.
 * Resolves true once saved, false when cancelled.
 */
import type { Draft, RequestTab } from '../../../shared/types';
import { isFolder, walk } from '../../model';
import { clear, h, icon, modal, toast } from '../../ui';
import { createCollection, saveRequestInto } from '../../app/collections';
import { app } from '../../app/state';

interface Selection { collectionId: string; folderId: string | null }
interface SaveState { selection: Selection | null }

function defaultName(draft: Draft): string {
  if (draft.name && draft.name !== 'Untitled Request') return draft.name;
  return draft.url.replace(/^[a-z]+:\/\//i, '').split('?')[0] || 'Untitled Request';
}

function initialSelection(tab: RequestTab): Selection | null {
  if (tab.collectionId) return { collectionId: tab.collectionId, folderId: null };
  const first = app.state.collections[0];
  return first ? { collectionId: first.info._postman_id, folderId: null } : null;
}

const isSelected = (sel: Selection | null, collectionId: string, folderId: string | null): boolean =>
  !!sel && sel.collectionId === collectionId && sel.folderId === folderId;

function treeRows(state: SaveState, rerender: () => void): HTMLElement[] {
  const rows: HTMLElement[] = [];
  app.state.collections.forEach((c) => {
    const cid = c.info._postman_id;
    rows.push(h('div', { class: `tree-row collection${isSelected(state.selection, cid, null) ? ' selected' : ''}`, onclick: () => { state.selection = { collectionId: cid, folderId: null }; rerender(); } },
      h('span', { class: 'chevron empty' }), icon('collections', 14), h('span', { class: 'tree-name' }, c.info.name)));
    walk(c.item, (node, ancestors) => {
      if (!isFolder(node)) return;
      rows.push(h('div', { class: `tree-row folder${isSelected(state.selection, cid, node.id) ? ' selected' : ''}`, style: { paddingLeft: `${8 + (ancestors.length + 1) * 14}px` }, onclick: () => { state.selection = { collectionId: cid, folderId: node.id }; rerender(); } },
        h('span', { class: 'chevron empty' }), h('span', { class: 'tree-icon' }, icon('folder', 14)), h('span', { class: 'tree-name' }, node.name)));
    });
  });
  return rows;
}

function renderTree(tree: HTMLElement, state: SaveState): void {
  clear(tree);
  if (!app.state.collections.length) {
    tree.appendChild(h('div', { class: 'tree-empty' }, 'No collections yet. Create one to save this request.'));
    return;
  }
  tree.append(...treeRows(state, () => renderTree(tree, state)));
}

export function saveAs(tab: RequestTab): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean): void => { if (!settled) { settled = true; resolve(value); } };
    const state: SaveState = { selection: initialSelection(tab) };
    const name = h('input', { class: 'input', value: defaultName(tab.draft) });
    const tree = h('div', { class: 'save-tree' });
    const addCollection = async (): Promise<void> => {
      const c = await createCollection();
      if (c) { state.selection = { collectionId: c.info._postman_id, folderId: null }; renderTree(tree, state); }
    };
    renderTree(tree, state);
    modal({
      title: 'Save Request',
      width: 520,
      body: h('div', null,
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Request name'), name),
        h('div', { class: 'field' },
          h('div', { style: { display: 'flex', alignItems: 'center', marginBottom: '6px' } }, h('span', { class: 'field-label' }, 'Save to'), h('span', { class: 'spacer' }), h('button', { class: 'link-btn', type: 'button', onclick: () => { void addCollection(); } }, '+ New Collection')),
          tree)),
      actions: [
        { label: 'Cancel' },
        { label: 'Save', primary: true, onClick: () => {
          if (!name.value.trim()) { name.focus(); return false; }
          if (!state.selection) { toast('Choose a collection', 'warning'); return false; }
          finish(saveRequestInto(tab, state.selection.collectionId, state.selection.folderId, name.value.trim()));
          return true;
        } }
      ],
      onClose: () => finish(false)
    });
  });
}
