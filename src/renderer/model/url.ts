/**
 * URL helpers. The raw URL text is the source of truth (as in the Postman
 * UI); the query string and `:path` variables are projected into tables.
 */
import type { Draft, Row, UrlJson } from '../../shared/types';
import { isBlankRow, row } from './util';

const PATH_VARIABLE = /\/:([A-Za-z_][\w.-]*)/g;
const URL_PARTS = /^(?:([a-z][a-z0-9+.-]*):\/\/)?([^/?#]*)([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/i;

export interface SplitUrl { base: string; query: string | null; hash: string }

export function splitUrl(raw: string | null | undefined): SplitUrl {
  const s = String(raw || '');
  const hashAt = s.indexOf('#');
  const beforeHash = hashAt >= 0 ? s.slice(0, hashAt) : s;
  const qAt = beforeHash.indexOf('?');
  return {
    base: qAt >= 0 ? beforeHash.slice(0, qAt) : beforeHash,
    query: qAt >= 0 ? beforeHash.slice(qAt + 1) : null,
    hash: hashAt >= 0 ? s.slice(hashAt) : ''
  };
}

export function parseQuery(query: string | null | undefined): Row[] {
  if (query == null || query === '') return [];
  return query.split('&').filter((part) => part !== '').map((part) => {
    const eq = part.indexOf('=');
    return eq >= 0 ? row(part.slice(0, eq), part.slice(eq + 1)) : row(part, null);
  });
}

export function buildQuery(params: Row[] | undefined): string {
  return (params || [])
    .filter((p) => p.enabled !== false && !isBlankRow(p))
    .map((p) => (p.value === null || p.value === undefined ? p.key : `${p.key}=${p.value}`))
    .join('&');
}

export function pathVariableNames(base: string): string[] {
  const names: string[] = [];
  PATH_VARIABLE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PATH_VARIABLE.exec(base))) if (!names.includes(m[1])) names.push(m[1]);
  return names;
}

type UrlDraft = Pick<Draft, 'url' | 'params' | 'pathVars'>;

/** URL text changed: re-derive query params (keeping disabled ones) and path variables. */
export function syncFromUrl<T extends UrlDraft>(draft: T): T {
  const { base, query } = splitUrl(draft.url);
  const disabled = (draft.params || []).filter((p) => p.enabled === false);
  draft.params = parseQuery(query).concat(disabled);
  const previous = Object.fromEntries((draft.pathVars || []).map((v) => [v.key, v]));
  draft.pathVars = pathVariableNames(base).map((key) => previous[key] || { key, value: '', description: '' });
  return draft;
}

/** Params table changed: rebuild the query part of the URL. */
export function syncUrlFromParams<T extends UrlDraft>(draft: T): T {
  const { base, hash } = splitUrl(draft.url);
  const q = buildQuery(draft.params);
  draft.url = base + (q ? `?${q}` : '') + hash;
  return draft;
}

function splitHostPort(hostPort: string): { host: string; port?: string } {
  const portMatch = hostPort.match(/:(\d+|\{\{[^}]+\}\})$/);
  if (!portMatch) return { host: hostPort };
  return { host: hostPort.slice(0, -portMatch[0].length), port: portMatch[1] };
}

/** Raw URL -> v2.1 url object parts (protocol, host, port, path, hash). */
export function urlParts(raw: string | null | undefined): UrlJson {
  const m = String(raw || '').match(URL_PARTS) || [];
  const out: UrlJson = { raw: String(raw || '') };
  if (m[1]) out.protocol = m[1];
  const { host, port } = splitHostPort(m[2] || '');
  if (port) out.port = port;
  if (host) out.host = /^\{\{.*\}\}$/.test(host) ? [host] : host.split('.');
  if (m[3]) out.path = m[3].split('/').slice(1);
  if (m[5]) out.hash = m[5];
  return out;
}

export function rawFromUrlObject(url: string | UrlJson | null | undefined): string {
  if (!url) return '';
  if (typeof url === 'string') return url;
  if (url.raw) return url.raw;
  let s = '';
  if (url.protocol) s += `${url.protocol}://`;
  if (url.host) s += Array.isArray(url.host) ? url.host.join('.') : url.host;
  if (url.port) s += `:${url.port}`;
  if (url.path) s += `/${Array.isArray(url.path) ? url.path.map((p) => (typeof p === 'object' ? p.value : p)).join('/') : url.path}`;
  const q = (url.query || []).filter((p) => !p.disabled).map((p) => (p.value == null ? p.key : `${p.key}=${p.value}`)).join('&');
  if (q) s += `?${q}`;
  if (url.hash) s += `#${url.hash}`;
  return s;
}
