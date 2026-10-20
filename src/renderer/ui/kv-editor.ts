/**
 * Key/value table used for params, headers, form bodies and variables.
 */
import type { Row } from '../../shared/types';
import { isBlankRow, parseHeaderString, row as newRowOf } from '../model';
import { append, clear, h } from './dom';
import { icon, iconButton } from './icons';
import { varInput, type GetVars } from './inputs';

export interface KvEditorOptions {
  rows: Row[];
  onChange?: (rows: Row[]) => void;
  getVars?: GetVars;
  title?: string;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  keyLabel?: string;
  valueLabel?: string;
  emptyText?: string;
  description?: boolean;
  /** Path variables: keys cannot be edited or added. */
  fixedKeys?: boolean;
  /** form-data: rows may be files. */
  files?: boolean;
  /** Environments: rows have a default / secret type. */
  types?: boolean;
  bulk?: boolean;
  pickFile?: () => Promise<string | null>;
}

export interface KvEditor extends HTMLDivElement { refresh(): void }

interface Ctx { rows: Row[]; bulkMode: boolean; changed(): void; render(): void }

function tableClass(opts: KvEditorOptions): string {
  const classes = ['kv-table'];
  if (opts.description) classes.push('with-desc');
  if (opts.types || opts.files) classes.push('with-type');
  if (opts.fixedKeys) classes.push('fixed');
  return classes.join(' ');
}

const hasTypeColumn = (opts: KvEditorOptions): boolean => !!(opts.types || opts.files);

function newRow(opts: KvEditorOptions): Row {
  if (opts.files) return newRowOf('', '', true, { type: 'text', src: '' });
  if (opts.types) return newRowOf('', '', true, { type: 'default' });
  return newRowOf();
}

function headRow(opts: KvEditorOptions): HTMLElement {
  return h('div', { class: 'kv-row kv-head' },
    h('div', { class: 'kv-cell kv-check' }),
    h('div', { class: 'kv-cell' }, opts.keyLabel || 'Key'),
    hasTypeColumn(opts) ? h('div', { class: 'kv-cell kv-type-cell' }, 'Type') : null,
    h('div', { class: 'kv-cell' }, opts.valueLabel || 'Value'),
    opts.description ? h('div', { class: 'kv-cell' }, 'Description') : null,
    h('div', { class: 'kv-cell kv-actions' }));
}

function fileCell(row: Row, opts: KvEditorOptions, ctx: Ctx): HTMLElement {
  const name = row.src ? String(row.src).split(/[\\/]/).pop() : '';
  const choose = async (): Promise<void> => {
    const p = opts.pickFile ? await opts.pickFile() : null;
    if (p) { row.src = p; ctx.changed(); ctx.render(); }
  };
  return h('div', { class: 'kv-file' },
    h('button', { class: 'btn btn-small btn-secondary', type: 'button', onclick: choose }, name ? 'Change' : 'Select file'),
    h('span', { class: 'kv-file-name', title: row.src || '' }, name || 'No file selected'));
}

function secretToggle(input: ReturnType<typeof varInput>): HTMLButtonElement {
  return iconButton('eye', 'Show value', (e) => {
    const masked = input.input.type === 'password';
    input.setMasked(!masked);
    (e.currentTarget as HTMLElement).replaceChildren(icon(masked ? 'eye-off' : 'eye'));
  });
}

function valueCell(row: Row, opts: KvEditorOptions, ctx: Ctx): HTMLElement {
  if (opts.files && row.type === 'file') return fileCell(row, opts, ctx);
  const input = varInput({ value: row.value == null ? '' : row.value, placeholder: opts.valuePlaceholder || 'Value', getVars: opts.getVars, onInput: (v) => { row.value = v; ctx.changed(); } });
  if (!(opts.types && row.type === 'secret')) return input;
  input.setMasked(true);
  return h('div', { class: 'kv-secret' }, input, secretToggle(input));
}

function typeCell(row: Row, opts: KvEditorOptions, ctx: Ctx): HTMLElement | null {
  if (opts.types) {
    return h('select', { class: 'select kv-type', 'aria-label': 'Type', onchange: (e: Event) => { row.type = (e.target as HTMLSelectElement).value; ctx.changed(); ctx.render(); } },
      h('option', { value: 'default', selected: row.type !== 'secret' }, 'default'),
      h('option', { value: 'secret', selected: row.type === 'secret' }, 'secret'));
  }
  if (opts.files) {
    return h('select', { class: 'select kv-type', 'aria-label': 'Type', onchange: (e: Event) => { row.type = (e.target as HTMLSelectElement).value; if (row.type === 'text') row.src = ''; ctx.changed(); ctx.render(); } },
      h('option', { value: 'text', selected: row.type !== 'file' }, 'Text'),
      h('option', { value: 'file', selected: row.type === 'file' }, 'File'));
  }
  return null;
}

function keyCell(row: Row, opts: KvEditorOptions, ctx: Ctx): HTMLElement {
  if (opts.fixedKeys) return h('div', { class: 'kv-static' }, row.key);
  return varInput({ value: row.key, placeholder: opts.keyPlaceholder || 'Key', getVars: opts.getVars, onInput: (v) => { row.key = v; ctx.changed(); } });
}

function dataRow(row: Row, index: number, opts: KvEditorOptions, ctx: Ctx): HTMLElement {
  const line = h('div', { class: `kv-row${row.enabled === false ? ' disabled' : ''}` });
  const check = h('input', { type: 'checkbox', checked: row.enabled !== false, disabled: !!opts.fixedKeys, 'aria-label': 'Enabled',
    onchange: () => { row.enabled = check.checked; line.classList.toggle('disabled', !check.checked); ctx.changed(); } });
  const type = typeCell(row, opts, ctx);
  const desc = opts.description ? varInput({ value: row.description || '', placeholder: 'Description', onInput: (v) => { row.description = v; ctx.changed(); } }) : null;
  const remove = opts.fixedKeys ? null : iconButton('trash', 'Delete row', () => { ctx.rows.splice(index, 1); ctx.changed(); ctx.render(); });
  return append(line,
    h('div', { class: 'kv-cell kv-check' }, check),
    h('div', { class: 'kv-cell' }, keyCell(row, opts, ctx)),
    type ? h('div', { class: 'kv-cell kv-type-cell' }, type) : null,
    h('div', { class: 'kv-cell' }, valueCell(row, opts, ctx)),
    desc ? h('div', { class: 'kv-cell' }, desc) : null,
    h('div', { class: 'kv-cell kv-actions' }, remove));
}

/** Typing into the empty trailing row turns it into a real row and focuses the same field there. */
function ghostRow(table: HTMLElement, opts: KvEditorOptions, ctx: Ctx): HTMLElement {
  const ghost = h('div', { class: 'kv-row ghost' });
  const promote = (field: 'key' | 'value', value: string): void => {
    const row = newRow(opts);
    row[field] = value;
    ctx.rows.push(row);
    ctx.changed();
    const real = dataRow(row, ctx.rows.length - 1, opts, ctx);
    table.insertBefore(real, ghost);
    const inputs = real.querySelectorAll<HTMLInputElement>('.var-field');
    const target = field === 'key' ? inputs[0] : inputs[1];
    if (target) { target.focus(); target.setSelectionRange(value.length, value.length); }
    ghost.querySelectorAll<HTMLInputElement>('.var-field').forEach((f) => { f.value = ''; });
    ghost.querySelectorAll<ReturnType<typeof varInput>>('.var-input').forEach((w) => { if (w.repaint) w.repaint(); });
  };
  return append(ghost,
    h('div', { class: 'kv-cell kv-check' }),
    h('div', { class: 'kv-cell' }, varInput({ placeholder: opts.keyPlaceholder || 'Key', getVars: opts.getVars, onInput: (v) => promote('key', v) })),
    hasTypeColumn(opts) ? h('div', { class: 'kv-cell kv-type-cell' }) : null,
    h('div', { class: 'kv-cell' }, varInput({ placeholder: opts.valuePlaceholder || 'Value', getVars: opts.getVars, onInput: (v) => promote('value', v) })),
    opts.description ? h('div', { class: 'kv-cell' }) : null,
    h('div', { class: 'kv-cell kv-actions' }));
}

function bulkText(rows: Row[]): string {
  return rows.filter((r) => !isBlankRow(r) && r.type !== 'file')
    .map((r) => `${r.enabled === false ? '//' : ''}${r.key}:${r.value == null ? '' : r.value}`).join('\n');
}

function bulkEditor(opts: KvEditorOptions, ctx: Ctx): HTMLTextAreaElement {
  const area = h('textarea', { class: 'bulk-edit mono', spellcheck: false, placeholder: 'Rows are separated by new lines\nKeys and values are separated by :\nPrepend // to any row you want to add but keep disabled' });
  area.value = bulkText(ctx.rows);
  area.addEventListener('input', () => {
    const fileRows = ctx.rows.filter((r) => r.type === 'file');
    const parsed = parseHeaderString(area.value).map((r) => (opts.files ? { ...r, type: 'text', src: '' } : opts.types ? { ...r, type: 'default' } : r));
    ctx.rows.splice(0, ctx.rows.length, ...parsed, ...fileRows);
    ctx.changed();
  });
  return area;
}

function toolbar(opts: KvEditorOptions, ctx: Ctx): HTMLElement {
  const canBulk = opts.bulk !== false && !opts.fixedKeys;
  return h('div', { class: 'kv-toolbar' },
    opts.title ? h('span', { class: 'kv-title' }, opts.title) : null,
    h('span', { class: 'spacer' }),
    canBulk ? h('button', { class: 'link-btn', type: 'button', onclick: () => { ctx.bulkMode = !ctx.bulkMode; ctx.render(); } }, ctx.bulkMode ? 'Key-Value Edit' : 'Bulk Edit') : null);
}

export function kvEditor(opts: KvEditorOptions): KvEditor {
  const el = h('div', { class: 'kv' }) as KvEditor;
  const ctx: Ctx = { rows: opts.rows, bulkMode: false, changed: () => { if (opts.onChange) opts.onChange(opts.rows); }, render: () => undefined };

  ctx.render = (): void => {
    clear(el);
    el.appendChild(toolbar(opts, ctx));
    if (ctx.bulkMode) { el.appendChild(bulkEditor(opts, ctx)); return; }
    const table = h('div', { class: tableClass(opts) }, headRow(opts), ctx.rows.map((row, i) => dataRow(row, i, opts, ctx)));
    if (!opts.fixedKeys) table.appendChild(ghostRow(table, opts, ctx));
    el.appendChild(table);
    if (opts.fixedKeys && !ctx.rows.length && opts.emptyText) el.appendChild(h('div', { class: 'kv-empty' }, opts.emptyText));
  };

  ctx.render();
  el.refresh = ctx.render;
  return el;
}
