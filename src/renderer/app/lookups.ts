/**
 * Shared lookups over the app state.
 */
import type { CollectionJson, Environment, Row, Scope, VariableMap } from '../../shared/types';
import type { JobOptions } from '../../shared/runtime-protocol';
import { resolveVariables, scopeFromRows } from '../model';
import { app } from './state';

/** JSON with sorted keys, so structurally equal drafts compare equal. */
export function stable(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => (v && typeof v === 'object' && !Array.isArray(v)
    ? Object.keys(v as object).sort().reduce<Record<string, unknown>>((o, key) => { o[key] = (v as Record<string, unknown>)[key]; return o; }, {})
    : v));
}

export const findCollection = (id: string | null | undefined): CollectionJson | null => app.state.collections.find((c) => c.info._postman_id === id) || null;
export const findEnvironment = (id: string | null | undefined): Environment | null => app.state.environments.find((e) => e.id === id) || null;
export const activeEnvironment = (): Environment | null => findEnvironment(app.state.settings.activeEnvironmentId);

function collectionScope(collectionId: string | null | undefined): { source: string; values: Row[] } | null {
  const c = collectionId ? findCollection(collectionId) : null;
  if (!c) return null;
  return { source: 'Collection', values: (c.variable || []).map((v) => ({ key: v.key, value: v.value == null ? '' : String(v.value), enabled: !v.disabled })) };
}

/** Variables visible to a request: globals < collection < active environment. */
export function vars(collectionId: string | null | undefined): VariableMap {
  const env = activeEnvironment();
  const scopes = [
    { source: 'Globals', values: app.state.globals.values },
    collectionScope(collectionId),
    env ? { source: env.name, values: env.values } : null
  ].filter((s): s is { source: string; values: Row[] } => !!s);
  return resolveVariables(scopes);
}

/** Runtime options derived from app settings (sent with every job). */
export function requestOptions(): JobOptions {
  const s = app.state.settings;
  return {
    strictSSL: s.strictSSL !== false,
    followRedirects: s.followRedirects !== false,
    requestTimeout: Number(s.requestTimeout) || 0,
    proxy: s.proxy || null,
    ignoreProxyEnv: !!s.ignoreProxyEnv,
    certificates: Array.isArray(s.certificates) ? s.certificates : [],
    caCertPath: s.caCertPath || ''
  };
}

export const scopeOf = (env: Environment | null): Scope => (env ? scopeFromRows(env.values) : { values: [] });
export const globalsScope = (): Scope => scopeFromRows(app.state.globals.values);
