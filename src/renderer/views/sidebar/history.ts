/**
 * History section of the sidebar.
 */
import type { HistoryEntry } from '../../../shared/types';
import { clone, findNode } from '../../model';
import { h, iconButton, methodBadge } from '../../ui';
import * as App from '../../app';
import { historyMenu } from './menus';

const DAY_MS = 86400000;
const startOfDay = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

function dayLabel(ts: number): string {
  const date = new Date(ts);
  const today = new Date();
  const daysAgo = Math.round((startOfDay(today) - startOfDay(date)) / DAY_MS);
  if (daysAgo === 0) return 'Today';
  if (daysAgo === 1) return 'Yesterday';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

const statusClass = (code: number | null): string => (code ? `status-${Math.floor(code / 100)}xx` : 'status-err');
const timeLabel = (ts: number): string => new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/** Re-open the saved request when it still exists, otherwise a copy of the sent draft. */
function openEntry(entry: HistoryEntry): void {
  const c = entry.collectionId ? App.findCollection(entry.collectionId) : null;
  if (c && entry.itemId && findNode(c, entry.itemId)) { App.openRequest(entry.collectionId as string, entry.itemId); return; }
  App.newRequest(clone(entry.draft));
}

function historyRow(entry: HistoryEntry): HTMLElement {
  return h('div', {
    class: 'history-row',
    title: `${entry.method} ${entry.url}\n${timeLabel(entry.ts)}${entry.error ? `\n${entry.error}` : ''}`,
    onclick: () => openEntry(entry),
    oncontextmenu: (e: MouseEvent) => { e.preventDefault(); historyMenu(entry, { x: e.clientX, y: e.clientY }, openEntry); }
  },
  methodBadge(entry.method, true),
  h('span', { class: 'history-url' }, entry.name || entry.url),
  h('span', { class: `history-status ${statusClass(entry.status)}` }, entry.status || (entry.error ? 'ERR' : '')),
  h('span', { class: 'row-actions' }, iconButton('more', 'More actions', (e) => { e.stopPropagation(); historyMenu(entry, e.currentTarget as Element, openEntry); })));
}

const matches = (entry: HistoryEntry, filter: string): boolean => !filter || entry.url.toLowerCase().includes(filter) || (entry.name || '').toLowerCase().includes(filter);

export function renderHistorySection(body: HTMLElement, filter: string): void {
  const entries = App.app.state.history.filter((e) => matches(e, filter));
  if (!entries.length) { body.appendChild(h('div', { class: 'sidebar-empty' }, filter ? 'No history entries match your filter.' : 'Requests you send will show up here.')); return; }
  let lastDay: string | null = null;
  entries.forEach((entry) => {
    const day = dayLabel(entry.ts);
    if (day !== lastDay) { body.appendChild(h('div', { class: 'history-group' }, day)); lastDay = day; }
    body.appendChild(historyRow(entry));
  });
}
