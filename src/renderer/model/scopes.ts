/**
 * Environments, globals and `{{variable}}` resolution.
 */
import type { Environment, EnvironmentExport, Row, Scope, ScopeInput, VariableMap } from '../../shared/types';
import { displayValue, row, uid } from './util';

const VARIABLE = /\{\{([^{}]+)\}\}/g;
const MAX_NESTING = 5;

export const newEnvironment = (name?: string): Environment => ({ id: uid(), name: name || 'New Environment', values: [] });

/** Editor rows -> postman-collection VariableScope JSON. */
export function scopeFromRows(values: Row[] | undefined): Scope {
  return {
    values: (values || []).filter((v) => v && String(v.key || '').trim()).map((v) => ({
      key: v.key,
      value: v.value == null ? '' : v.value,
      type: v.type === 'secret' ? 'secret' : 'any',
      disabled: v.enabled === false
    }))
  };
}

/** Merge a scope returned by a run (after pm.environment.set/unset) back into editable rows. */
export function mergeScopeIntoRows(rows: Row[], scope: Scope | null | undefined): Row[] {
  if (!scope || !Array.isArray(scope.values)) return rows;
  const returned = new Map(scope.values.filter((v) => !v.disabled).map((v) => [v.key, v]));
  const out: Row[] = [];
  (rows || []).forEach((r) => {
    if (!r.key) return;
    const value = returned.get(r.key);
    if (value) {
      out.push({ ...r, value: displayValue(value.value) });
      returned.delete(r.key);
    } else if (r.enabled === false) {
      out.push(r); // disabled rows were never visible to scripts
    }
  });
  returned.forEach((v) => out.push(row(v.key, displayValue(v.value), true, { type: v.type === 'secret' ? 'secret' : 'default' })));
  return out;
}

/** Effective variable map (later scopes win): name -> { value, source, secret }. */
export function resolveVariables(scopes: ScopeInput[]): VariableMap {
  const map: VariableMap = new Map();
  (scopes || []).forEach(({ source, values }) => {
    (values || []).forEach((v) => {
      if (v && v.key && v.enabled !== false && !v.disabled) map.set(v.key, { value: displayValue(v.value), source, secret: v.type === 'secret' });
    });
  });
  return map;
}

export function substitute(text: string, vars: VariableMap, depth = 0): string {
  if (typeof text !== 'string' || depth > MAX_NESTING) return text;
  const out = text.replace(VARIABLE, (m, name: string) => (vars.has(name) ? (vars.get(name) as { value: string }).value : m));
  return out !== text && VARIABLE.test(out) ? substitute(out, vars, depth + 1) : out;
}

interface EnvironmentFile { name?: string; values?: Array<{ key: string; value?: unknown; type?: string; enabled?: boolean }> }

export function environmentFromImport(json: EnvironmentFile): Environment {
  const env = newEnvironment(json.name || 'Imported Environment');
  env.values = (json.values || []).map((v) => row(v.key, displayValue(v.value), v.enabled !== false, { type: v.type === 'secret' ? 'secret' : 'default' }));
  return env;
}

export function exportEnvironment(env: Environment, scope?: string): EnvironmentExport {
  return {
    id: env.id,
    name: env.name,
    values: (env.values || []).filter((v) => v.key).map((v) => ({ key: v.key, value: v.value, type: v.type === 'secret' ? 'secret' : 'default', enabled: v.enabled !== false })),
    _postman_variable_scope: scope || 'environment',
    _postman_exported_using: 'ApiForge'
  };
}
