/**
 * Drag & drop for the collections tree.
 */
import { moveNode, type MoveDestination } from '../../app/collections';
import { app } from '../../app/state';

const clearHighlights = (): void => document.querySelectorAll('.drop-target, .drop-before').forEach((el) => el.classList.remove('drop-target', 'drop-before'));

export function makeDraggable(row: HTMLElement, collectionId: string, nodeId: string): void {
  row.addEventListener('dragstart', (e) => {
    app.drag = { collectionId, nodeId };
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', nodeId);
    }
    row.classList.add('dragging');
  });
  row.addEventListener('dragend', () => {
    app.drag = null;
    row.classList.remove('dragging');
    clearHighlights();
  });
}

/** `before` drops insert above the row instead of inside it. */
export function makeDropTarget(row: HTMLElement, dest: MoveDestination, before = false): void {
  const cls = before ? 'drop-before' : 'drop-target';
  row.addEventListener('dragover', (e) => {
    if (!app.drag || app.drag.nodeId === dest.beforeId || app.drag.nodeId === dest.parentId) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    row.classList.add(cls);
  });
  row.addEventListener('dragleave', () => row.classList.remove(cls));
  row.addEventListener('drop', (e) => {
    e.preventDefault();
    row.classList.remove(cls);
    if (!app.drag) return;
    moveNode(app.drag, dest);
    app.drag = null;
  });
}
