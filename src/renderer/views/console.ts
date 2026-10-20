/**
 * Bottom console: script logs and network activity.
 */
import type { ConsoleEntry, LogConsoleEntry, NetworkConsoleEntry, SerializedHeader } from '../../shared/types';
import { formatBytes, formatMs } from '../model';
import { clear, h, icon, iconButton, selectEl } from '../ui';
import * as App from '../app';
import type { ConsoleView } from './types';

const KIND_ICON: Record<string, string> = { log: '›', info: 'i', warn: '!', error: '✕', network: '⇄' };
const BODY_PREVIEW_CHARS = 20000;
const FILTERS = [['all', 'All logs'], ['log', 'Log'], ['info', 'Info'], ['warn', 'Warning'], ['error', 'Error'], ['network', 'Network']] as const;

const timeLabel = (ts: number): string => new Date(ts).toLocaleTimeString(undefined, { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
const statusClass = (code: number | null | undefined): string => (code ? `status-${Math.floor(code / 100)}xx` : 'status-err');
const normalizeType = (type: string): string => (type === 'warning' ? 'warn' : type);

const entryText = (e: ConsoleEntry): string => (e.type === 'network' ? `${e.method} ${e.url} ${e.status || ''}` : (e.messages || []).join(' '));

function matches(e: ConsoleEntry, filter: string, search: string): boolean {
  if (filter !== 'all' && normalizeType(e.type) !== filter) return false;
  return !search || entryText(e).toLowerCase().includes(search);
}

// Network entries --------------------------------------------------------------
function headerBlock(title: string, headers: SerializedHeader[] | undefined): HTMLElement | null {
  if (!headers || !headers.length) return null;
  return h('details', null, h('summary', null, `${title} (${headers.length})`), h('pre', null, headers.map((x) => `${x.key}: ${x.value}`).join('\n')));
}

function bodyBlock(title: string, body: string | null | undefined): HTMLElement | null {
  if (!body) return null;
  const preview = body.length > BODY_PREVIEW_CHARS ? `${body.slice(0, BODY_PREVIEW_CHARS)}\n… (truncated)` : body;
  return h('details', null, h('summary', null, `${title} (${formatBytes(new TextEncoder().encode(body).length)})`), h('pre', null, preview));
}

function networkOutcome(e: NetworkConsoleEntry): HTMLElement {
  if (e.pending) return h('span', { class: 'faint' }, 'pending…');
  if (e.error) return h('span', { class: 'status-err' }, e.error.message || 'error');
  if (e.status != null) return h('span', { class: statusClass(e.status) }, `${e.status} ${e.statusText || ''}`);
  return h('span', { class: 'faint' }, e.statusText || '');
}

function networkDetail(e: NetworkConsoleEntry): HTMLElement {
  return h('div', { class: 'console-detail' },
    e.request ? h('div', { class: 'faint', style: { marginBottom: '4px' } }, `${e.request.method} ${e.request.url}`) : null,
    e.request ? headerBlock('Request Headers', e.request.headers) : null,
    e.request ? bodyBlock('Request Body', e.request.body) : null,
    e.response ? headerBlock('Response Headers', e.response.headers) : null,
    e.response ? bodyBlock('Response Body', e.response.body) : null,
    e.error ? h('pre', { class: 'status-err' }, `${e.error.name || 'Error'}: ${e.error.message}${e.error.code ? ` (${e.error.code})` : ''}`) : null);
}

function networkEntry(e: NetworkConsoleEntry, rerender: () => void): HTMLElement {
  const line = h('div', { class: 'console-line', onclick: () => { e.expanded = !e.expanded; rerender(); } },
    h('span', { class: 'console-ts' }, timeLabel(e.ts)),
    h('span', { class: 'console-kind' }, KIND_ICON.network),
    h('div', { class: 'console-msg' },
      h('b', null, e.method),
      h('span', { class: 'console-url', title: e.url }, e.url),
      networkOutcome(e),
      e.time != null ? h('span', { class: 'faint' }, formatMs(e.time)) : null,
      e.size != null ? h('span', { class: 'faint' }, formatBytes(e.size)) : null));
  return h('div', { class: 'console-entry network expandable' }, line, e.expanded ? networkDetail(e) : null);
}

function logEntry(e: LogConsoleEntry): HTMLElement {
  const type = normalizeType(e.type);
  return h('div', { class: `console-entry ${type}` }, h('div', { class: 'console-line' },
    h('span', { class: 'console-ts' }, timeLabel(e.ts)),
    h('span', { class: 'console-kind' }, KIND_ICON[type] || '›'),
    h('div', { class: 'console-msg' }, (e.messages || []).join(' '))));
}

// Panel ----------------------------------------------------------------------------
export function createConsoleView(): ConsoleView {
  const state = { filter: 'all', search: '' };
  const listEl = h('div', { class: 'console-list' });
  let scheduled = false;

  function render(): void {
    const atBottom = !listEl.childElementCount || listEl.scrollTop + listEl.clientHeight >= listEl.scrollHeight - 12;
    clear(listEl);
    const entries = App.app.consoleEntries.filter((e) => matches(e, state.filter, state.search));
    if (!entries.length) listEl.appendChild(h('div', { class: 'console-empty' }, App.app.consoleEntries.length ? 'No entries match the current filter' : 'Network requests and console.log() output from scripts will appear here'));
    else entries.forEach((e) => listEl.appendChild(e.type === 'network' ? networkEntry(e, render) : logEntry(e)));
    if (atBottom) listEl.scrollTop = listEl.scrollHeight;
  }

  const search = h('input', { class: 'input', placeholder: 'Search', 'aria-label': 'Search console' });
  search.addEventListener('input', () => { state.search = search.value.trim().toLowerCase(); render(); });
  const el = h('div', { class: 'console' },
    h('div', { class: 'console-toolbar' },
      h('b', null, 'Console'),
      selectEl(FILTERS, state.filter, (v) => { state.filter = v; render(); }),
      h('div', { class: 'search-box' }, icon('search', 13), search),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn btn-small btn-ghost', type: 'button', onclick: () => App.clearConsole() }, icon('trash', 13), 'Clear'),
      iconButton('x', 'Close console', () => App.toggleConsole(false))),
    listEl);

  return {
    el,
    update() {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => { scheduled = false; render(); });
    }
  };
}
