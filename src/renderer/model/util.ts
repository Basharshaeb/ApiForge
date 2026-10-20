/**
 * Small value helpers shared by the model modules.
 */
import type { Description, Row, ScriptJson } from '../../shared/types';

export function uid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export const clone = <T>(value: T): T => (value === undefined ? value : JSON.parse(JSON.stringify(value)) as T);

/** Editor table row: { key, value, enabled, ...extra }. */
export const row = (key = '', value: string | null = '', enabled = true, extra: Partial<Row> = {}): Row => ({ key, value, enabled, ...extra });

export const isBlankRow = (r: Row | null | undefined): boolean =>
  !r || (!String(r.key || '').trim() && !String(r.value == null ? '' : r.value).trim() && !r.src);

/** v2.1 descriptions can be strings or { content, type }. */
export const textOf = (d: Description | null | undefined): string => (d == null ? '' : typeof d === 'string' ? d : d.content || '');

/** Script source from a v2.1 `script` (exec may be a string or an array of lines). */
export function execOf(script: ScriptJson | undefined): string {
  if (!script) return '';
  return Array.isArray(script.exec) ? script.exec.join('\n') : String(script.exec || '');
}

export const displayValue = (v: unknown): string => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
