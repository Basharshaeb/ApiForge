/**
 * Authorization: editor shape `{ type, params }` <-> Collection v2.1 `auth`.
 */
import type { AuthDraft, AuthJson, AuthParamJson } from '../../shared/types';
import { AUTH_BY_TYPE } from './constants';

export function defaultAuthParams(type: string): Record<string, unknown> {
  const schema = AUTH_BY_TYPE[type];
  const out: Record<string, unknown> = {};
  if (schema) schema.fields.forEach((f) => { if (f.default !== undefined) out[f.key] = f.default; });
  return out;
}

function paramsFromV2(source: unknown): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  if (Array.isArray(source)) (source as AuthParamJson[]).forEach((p) => { if (p && p.key) params[p.key] = p.value; });
  else if (source && typeof source === 'object') Object.assign(params, source); // v2.0 shape
  return params;
}

export function authFromV2(auth: AuthJson | undefined): AuthDraft {
  if (!auth || !auth.type) return { type: 'inherit', params: {} };
  return { type: AUTH_BY_TYPE[auth.type] ? auth.type : 'noauth', params: paramsFromV2(auth[auth.type]) };
}

function orderedKeys(type: string, params: Record<string, unknown>): string[] {
  const schema = AUTH_BY_TYPE[type];
  const keys = schema ? schema.fields.map((f) => f.key) : [];
  Object.keys(params).forEach((k) => { if (!keys.includes(k)) keys.push(k); });
  return keys;
}

export function authToV2(auth: AuthDraft | undefined): AuthJson | undefined {
  if (!auth || auth.type === 'inherit') return undefined;
  if (auth.type === 'noauth') return { type: 'noauth' };
  const params = { ...defaultAuthParams(auth.type), ...(auth.params || {}) };
  const entries: AuthParamJson[] = orderedKeys(auth.type, params)
    .filter((k) => params[k] !== undefined)
    .map((k) => ({ key: k, value: params[k], type: typeof params[k] === 'boolean' ? 'boolean' : 'string' }));
  return { type: auth.type, [auth.type]: entries };
}
