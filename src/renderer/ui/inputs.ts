/**
 * Variable-aware input: highlights {{vars}} (green = defined, red = missing)
 * and autocompletes names after "{{".
 */
import type { VariableInfo, VariableMap } from '../../shared/types';
import { substitute } from '../model';
import { escapeHtml, h } from './dom';

const MAX_SUGGESTIONS = 12;
const VARIABLE_TOKEN = /\{\{([^{}]*)\}\}/g;
const OPEN_VARIABLE = /\{\{([^{}\s]*)$/;

export type GetVars = () => VariableMap | null | undefined;
export type VarField = HTMLInputElement | HTMLTextAreaElement;

export interface VarInput extends HTMLDivElement {
  input: VarField;
  repaint(): void;
  setValue(v: unknown): void;
  setMasked(masked: boolean): void;
}

export interface VarInputOptions {
  value?: unknown;
  placeholder?: string;
  onInput?: (value: string) => void;
  getVars?: GetVars;
  className?: string;
  type?: string;
  onKeyDown?: (e: KeyboardEvent) => void;
  multiline?: boolean;
}

export function highlightVars(text: string, vars: VariableMap | null | undefined): string {
  return escapeHtml(text).replace(VARIABLE_TOKEN, (m, name: string) => {
    const known = !!vars && vars.has(name);
    return `<span class="var ${known ? 'var-ok' : 'var-missing'}">${m}</span>`;
  }) + ' ';
}

// Suggestion popup ----------------------------------------------------------
let suggestEl: HTMLElement | null = null;

function closeSuggest(): void {
  if (suggestEl) { suggestEl.remove(); suggestEl = null; }
}

function suggestionItem([key, info]: [string, VariableInfo], index: number, onPick: (i: number) => void): HTMLElement {
  return h('div', { class: `suggest-item${index === 0 ? ' active' : ''}`, onmousedown: (e: Event) => { e.preventDefault(); onPick(index); } },
    h('span', { class: 'suggest-key' }, key),
    h('span', { class: 'suggest-val' }, info.secret ? '••••••' : info.value),
    h('span', { class: 'suggest-src' }, info.source));
}

function placeSuggest(input: VarField): void {
  if (!suggestEl) return;
  const r = input.getBoundingClientRect();
  suggestEl.style.left = `${r.left}px`;
  suggestEl.style.top = `${r.bottom + 2}px`;
  suggestEl.style.minWidth = `${Math.min(Math.max(r.width, 260), 480)}px`;
}

interface Suggester { show(): void; onKeyDown(e: KeyboardEvent): boolean }

/** Owns the autocomplete state for one input. */
function createSuggester(input: VarField, getVars: GetVars | undefined, apply: () => void): Suggester {
  let active = 0;
  let matches: Array<[string, VariableInfo]> = [];

  const pick = (index: number): void => {
    const [name] = matches[index];
    const pos = input.selectionStart || 0;
    const before = input.value.slice(0, pos).replace(OPEN_VARIABLE, `{{${name}}}`);
    const after = input.value.slice(pos).replace(/^[^{}\s]*\}\}/, '');
    input.value = before + after;
    input.setSelectionRange(before.length, before.length);
    closeSuggest();
    apply();
  };

  const show = (): void => {
    const vars = getVars ? getVars() : null;
    const m = input.value.slice(0, input.selectionStart || 0).match(OPEN_VARIABLE);
    if (!vars || !m) return closeSuggest();
    const q = m[1].toLowerCase();
    matches = [...vars.entries()].filter(([k]) => k.toLowerCase().includes(q)).slice(0, MAX_SUGGESTIONS);
    closeSuggest();
    if (!matches.length) return;
    active = 0;
    suggestEl = h('div', { class: 'suggest' }, matches.map((entry, i) => suggestionItem(entry, i, pick)));
    (document.getElementById('overlay-root') as HTMLElement).appendChild(suggestEl);
    placeSuggest(input);
  };

  const move = (direction: number): void => {
    if (!suggestEl) return;
    const items = suggestEl.querySelectorAll('.suggest-item');
    items[active].classList.remove('active');
    active = (active + direction + items.length) % items.length;
    items[active].classList.add('active');
  };

  /** Returns true when the key was consumed by the popup. */
  const onKeyDown = (e: KeyboardEvent): boolean => {
    if (!suggestEl) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); move(e.key === 'ArrowDown' ? 1 : -1); return true; }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(active); return true; }
    if (e.key === 'Escape') { closeSuggest(); return true; }
    return false;
  };

  return { show, onKeyDown };
}

// Input -------------------------------------------------------------------------
function createField(multiline: boolean | undefined, placeholder: string | undefined, type: string | undefined): VarField {
  return multiline
    ? h('textarea', { class: 'var-field', placeholder: placeholder || '', spellcheck: false, rows: 3 })
    : h('input', { class: 'var-field', placeholder: placeholder || '', spellcheck: false, type: type || 'text' });
}

export function varInput({ value, placeholder, onInput, getVars, className, type, onKeyDown, multiline }: VarInputOptions): VarInput {
  const wrap = h('div', { class: `var-input ${className || ''}${multiline ? ' multiline' : ''}` }) as VarInput;
  const backdrop = h('div', { class: 'var-backdrop', 'aria-hidden': 'true' });
  const input = createField(multiline, placeholder, type);
  input.value = value == null ? '' : String(value);
  wrap.append(backdrop, input);

  const paint = (): void => {
    const vars = getVars ? getVars() : null;
    const masked = input.type === 'password';
    wrap.classList.toggle('masked', masked);
    backdrop.innerHTML = masked ? '' : highlightVars(input.value, vars);
    backdrop.scrollLeft = input.scrollLeft;
    backdrop.scrollTop = input.scrollTop;
    if (vars && /\{\{/.test(input.value)) input.title = substitute(input.value, vars);
    else input.removeAttribute('title');
  };
  const emit = (): void => { paint(); if (onInput) onInput(input.value); };
  const suggester = createSuggester(input, getVars, emit);

  input.addEventListener('input', () => { emit(); suggester.show(); });
  input.addEventListener('scroll', () => { backdrop.scrollLeft = input.scrollLeft; backdrop.scrollTop = input.scrollTop; });
  input.addEventListener('blur', () => setTimeout(closeSuggest, 100));
  input.addEventListener('keydown', (e) => { const key = e as KeyboardEvent; if (!suggester.onKeyDown(key) && onKeyDown) onKeyDown(key); });
  requestAnimationFrame(paint);

  wrap.input = input;
  wrap.repaint = paint;
  wrap.setValue = (v) => { input.value = v == null ? '' : String(v); paint(); };
  wrap.setMasked = (masked) => { if (!multiline) { (input as HTMLInputElement).type = masked ? 'password' : 'text'; paint(); } };
  return wrap;
}

/** Repaint every variable input under `root` (after variable scopes changed). */
export function repaintVarInputs(root: ParentNode): void {
  root.querySelectorAll<VarInput>('.var-input').forEach((w) => { if (w.repaint) w.repaint(); });
}
