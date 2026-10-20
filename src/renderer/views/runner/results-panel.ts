/**
 * Runner results panel (right column): summary, progress and per-request rows.
 */
import type { Assertion, RunItemResult, RunnerTab, RunResult } from '../../../shared/types';
import { formatMs } from '../../model';
import { append, clear, emptyState, h, icon, methodBadge } from '../../ui';
import { summarize, type RunSummary } from './run-controller';

export interface ResultsPanelProps { tab: RunnerTab; onStop(): void; onExport(): void; rerender(): void }

const statusClass = (code: number | null | undefined): string => (code ? `status-${Math.floor(code / 100)}xx` : 'status-err');
const stat = (label: string, value: string | number, cls = ''): HTMLElement => h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, label), h('span', { class: `stat-value ${cls}` }, value));

function summaryBar(tab: RunnerTab, s: RunSummary, { onStop, onExport }: ResultsPanelProps): HTMLElement {
  const r = tab.result as RunResult;
  return h('div', { class: 'run-summary' },
    stat('Status', s.status, tab.running ? '' : s.healthy ? 'ok' : 'fail'),
    stat('Requests', `${s.done} / ${r.total}`),
    stat('Iterations', r.iterations),
    stat('Passed', s.passed, 'ok'),
    stat('Failed', s.failed, s.failed ? 'fail' : ''),
    stat('Errors', s.errored, s.errored ? 'fail' : ''),
    stat('Avg. time', s.avgTime == null ? '—' : formatMs(s.avgTime)),
    stat('Duration', formatMs(s.duration)),
    h('span', { class: 'spacer' }),
    tab.running
      ? h('button', { class: 'btn btn-small btn-danger', type: 'button', onclick: onStop }, 'Stop')
      : h('button', { class: 'btn btn-small btn-secondary', type: 'button', onclick: onExport }, icon('download', 13), 'Export Results'));
}

function assertionRow(a: Assertion): HTMLElement {
  const kind = a.skipped ? 'skip' : a.passed ? 'pass' : 'fail';
  return h('div', { class: `test-row ${kind}` }, h('span', { class: 'test-tag' }, kind.toUpperCase()), h('div', { class: 'test-name' }, a.name, a.error ? h('div', { class: 'test-error' }, a.error.message) : null));
}

function itemDetails(it: RunItemResult): HTMLElement {
  const body = h('div', { class: 'run-item-body' });
  if (it.error) body.appendChild(h('div', { class: 'test-row fail' }, h('span', { class: 'test-tag' }, 'ERROR'), h('div', { class: 'test-name' }, it.error.message)));
  it.errors.forEach((e) => body.appendChild(h('div', { class: 'test-row fail' }, h('span', { class: 'test-tag' }, 'SCRIPT'), h('div', { class: 'test-name' }, e))));
  it.assertions.forEach((a) => body.appendChild(assertionRow(a)));
  if (!it.error && !it.errors.length && !it.assertions.length) body.appendChild(h('div', { class: 'muted' }, 'No tests in this request'));
  return body;
}

function itemStatus(it: RunItemResult): HTMLElement | null {
  if (it.status === 'running') return h('span', { class: 'run-stat' }, 'Running…');
  if (it.status === 'cancelled') return h('span', { class: 'run-stat' }, 'Cancelled');
  if (it.response) return h('span', { class: `run-stat ${statusClass(it.response.code)}` }, `${it.response.code} ${it.response.status || ''}`);
  return it.error ? h('span', { class: 'run-stat fail' }, 'ERROR') : null;
}

function itemRow(it: RunItemResult, rerender: () => void): HTMLElement {
  const failed = it.assertions.filter((a) => !a.passed && !a.skipped).length;
  const passed = it.assertions.filter((a) => a.passed).length;
  const head = h('div', { class: 'run-item-head', onclick: () => { it.expanded = !it.expanded; rerender(); } },
    h('span', { class: 'chevron', style: { display: 'inline-flex', transition: 'transform .1s', transform: it.expanded ? 'rotate(90deg)' : '' } }, icon('chevron', 12)),
    methodBadge(it.method, true),
    h('span', { class: 'run-item-name', title: it.url || '' }, it.name),
    itemStatus(it),
    it.response ? h('span', { class: 'run-stat' }, formatMs(it.response.time)) : null,
    it.assertions.length ? h('span', { class: `run-stat ${failed ? 'fail' : 'ok'}` }, `${passed}/${it.assertions.length} passed`) : null);
  return h('div', { class: 'run-item' }, head, it.expanded ? itemDetails(it) : null);
}

function resultList(r: RunResult, rerender: () => void): HTMLElement {
  const list = h('div', { class: 'run-list' });
  let lastIteration = -1;
  r.items.forEach((it) => {
    if (r.iterations > 1 && it.iteration !== lastIteration) {
      list.appendChild(h('div', { class: 'iteration-head' }, `Iteration ${it.iteration + 1}`));
      lastIteration = it.iteration;
    }
    list.appendChild(itemRow(it, rerender));
  });
  return list;
}

export function renderResultsPanel(el: HTMLElement, props: ResultsPanelProps): void {
  clear(el);
  const { tab, rerender } = props;
  const r = tab.result;
  if (!r) { el.appendChild(emptyState('runner', 'Run a collection', "Choose the options on the left and click Run. Each request's status and test results appear here as the run progresses.")); return; }
  const s = summarize(tab);
  append(el,
    h('div', { class: 'progress' }, h('div', { class: 'progress-bar', style: { width: `${s.progress}%` } })),
    summaryBar(tab, s, props),
    r.error ? h('div', { class: 'response-error' }, h('b', null, 'Run error'), r.error.message) : null,
    r.errors.map((e) => h('div', { class: 'response-error' }, e)),
    resultList(r, rerender));
}
