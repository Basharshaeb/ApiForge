/**
 * Editor "draft" <-> Collection v2.1 request item.
 */
import type {
  BodyDraft, BodyJson, Draft, EventJson, FormDataJson, ItemJson, KeyValueJson, ProtocolProfileBehavior, RequestJson, Row, ScriptsDraft, ScriptTarget, UrlJson
} from '../../shared/types';
import { PROTOCOL_SETTINGS } from './constants';
import { authFromV2, authToV2 } from './auth';
import { buildQuery, parseQuery, pathVariableNames, rawFromUrlObject, splitUrl, syncFromUrl, urlParts } from './url';
import { clone, execOf, isBlankRow, row, textOf, uid } from './util';

export function emptyDraft(overrides: Partial<Draft> = {}): Draft {
  return {
    name: 'Untitled Request',
    method: 'GET',
    url: '',
    params: [],
    pathVars: [],
    headers: [],
    body: { mode: 'none', raw: '', language: 'json', urlencoded: [], formdata: [], file: '', graphql: { query: '', variables: '' } },
    auth: { type: 'inherit', params: {} },
    scripts: { prerequest: '', test: '' },
    description: '',
    settings: {},
    ...overrides
  };
}

/** "Key: value" lines; a leading `//` keeps the row but disables it. */
export function parseHeaderString(text: string | null | undefined): Row[] {
  return String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const disabled = line.startsWith('//');
    const clean = disabled ? line.slice(2).trim() : line;
    const colon = clean.indexOf(':');
    return row(colon >= 0 ? clean.slice(0, colon).trim() : clean, colon >= 0 ? clean.slice(colon + 1).trim() : '', !disabled);
  });
}

export function guessLanguage(raw: string | null | undefined, headers: Row[] | undefined): string {
  const ct = ((headers || []).find((h) => /^content-type$/i.test(h.key)) || {}).value || '';
  if (/json/i.test(ct)) return 'json';
  if (/xml/i.test(ct)) return 'xml';
  if (/html/i.test(ct)) return 'html';
  if (/javascript/i.test(ct)) return 'javascript';
  const t = String(raw || '').trim();
  if (/^[{[]/.test(t)) { try { JSON.parse(t); return 'json'; } catch { /* not json */ } }
  if (/^</.test(t)) return /<html/i.test(t) ? 'html' : 'xml';
  return 'text';
}

// v2.1 -> draft ----------------------------------------------------------
const rowsFromV2 = (rows: KeyValueJson[] | undefined): Row[] =>
  (rows || []).map((r) => row(r.key || '', r.value == null ? '' : r.value, !r.disabled, r.description ? { description: textOf(r.description) } : {}));

function applyUrl(draft: Draft, url: string | UrlJson | undefined): void {
  const raw = rawFromUrlObject(url);
  const queryObjects = url && typeof url === 'object' && Array.isArray(url.query) && url.query.length ? url.query : null;
  if (queryObjects) {
    const { base, hash } = splitUrl(raw);
    draft.params = queryObjects.map((q) => row(q.key || '', q.value === undefined ? null : q.value, !q.disabled, q.description ? { description: textOf(q.description) } : {}));
    const q = buildQuery(draft.params);
    draft.url = base + (q ? `?${q}` : '') + hash;
  } else {
    draft.url = raw;
    draft.params = parseQuery(splitUrl(raw).query);
  }
  const variables = typeof url === 'object' && url && url.variable ? url.variable : [];
  const values = Object.fromEntries(variables.map((v) => [v.key, v]));
  draft.pathVars = pathVariableNames(splitUrl(draft.url).base).map((key) => ({
    key,
    value: values[key] ? String(values[key].value == null ? '' : values[key].value) : '',
    description: values[key] ? textOf(values[key].description) : ''
  }));
}

function formDataRows(list: FormDataJson[] | undefined): Row[] {
  return (list || []).map((f) => row(f.key || '', f.type === 'file' ? '' : (f.value == null ? '' : f.value), !f.disabled, {
    type: f.type === 'file' ? 'file' : 'text',
    src: f.type === 'file' ? (Array.isArray(f.src) ? f.src[0] : f.src) || '' : '',
    description: textOf(f.description)
  }));
}

function graphqlVariables(variables: unknown): string {
  if (variables == null) return '';
  return typeof variables === 'string' ? variables : JSON.stringify(variables, null, 2);
}

/** v2.1 body mode -> fields of the draft body. */
const BODY_READERS: Record<string, (body: BodyJson, headers: Row[]) => Partial<BodyDraft>> = {
  raw(body, headers) {
    const raw = typeof body.raw === 'string' ? body.raw : JSON.stringify(body.raw, null, 2);
    return { raw, language: (body.options && body.options.raw && body.options.raw.language) || guessLanguage(raw, headers) };
  },
  urlencoded: (body) => ({ urlencoded: rowsFromV2(body.urlencoded) }),
  formdata: (body) => ({ formdata: formDataRows(body.formdata) }),
  file: (body) => ({ file: (body.file && body.file.src) || '' }),
  graphql: (body) => ({ graphql: { query: (body.graphql && body.graphql.query) || '', variables: graphqlVariables(body.graphql && body.graphql.variables) } })
};

function applyBody(draft: Draft, body: BodyJson | undefined): void {
  if (!body || body.disabled || !body.mode) return;
  const read = BODY_READERS[body.mode];
  if (!read) return;
  Object.assign(draft.body, { mode: body.mode as BodyDraft['mode'] }, read(body, draft.headers));
}

function applySettings(draft: Draft, item: Partial<ItemJson> | undefined): void {
  const behavior: ProtocolProfileBehavior = (item && item.protocolProfileBehavior) || {};
  PROTOCOL_SETTINGS.forEach((k) => {
    if (behavior[k] !== undefined) (draft.settings as Record<string, unknown>)[k] = behavior[k];
  });
}

export function scriptsFromEvents(events: EventJson[] | undefined): ScriptsDraft {
  const scripts: ScriptsDraft = { prerequest: '', test: '' };
  (events || []).forEach((ev) => {
    if (ev && (ev.listen === 'prerequest' || ev.listen === 'test') && !ev.disabled) scripts[ev.listen] = execOf(ev.script);
  });
  return scripts;
}

function requestOf(item: Partial<ItemJson> | undefined): RequestJson {
  if (!item) return {};
  if (typeof item.request === 'string') return { url: item.request, method: 'GET' };
  return item.request || {};
}

export function draftFromItem(item: Partial<ItemJson> | undefined): Draft {
  const draft = emptyDraft({ name: (item && item.name) || 'Untitled Request' });
  const request = requestOf(item);
  draft.method = String(request.method || 'GET').toUpperCase();
  draft.description = textOf(request.description);
  draft.headers = typeof request.header === 'string' ? parseHeaderString(request.header) : rowsFromV2(request.header);
  applyUrl(draft, request.url);
  applyBody(draft, request.body);
  draft.auth = authFromV2(request.auth);
  applySettings(draft, item);
  draft.scripts = scriptsFromEvents(item && item.event);
  return draft;
}

// draft -> v2.1 ----------------------------------------------------------
const rowsToV2 = (rows: Row[] | undefined): KeyValueJson[] => (rows || []).filter((r) => !isBlankRow(r)).map((r) => {
  const out: KeyValueJson = { key: r.key, value: r.value == null ? '' : r.value };
  if (r.enabled === false) out.disabled = true;
  if (r.description) out.description = r.description;
  return out;
});

function scriptEvent(listen: ScriptTarget, source: string, existing: EventJson | undefined): EventJson {
  return {
    listen,
    script: {
      ...(existing && existing.script && existing.script.id ? { id: existing.script.id } : {}),
      type: 'text/javascript',
      exec: String(source).split('\n')
    }
  };
}

export function eventsFromScripts(scripts: ScriptsDraft | undefined, existingEvents: EventJson[] | undefined): EventJson[] {
  const existing = existingEvents || [];
  const out = existing.filter((e) => e.listen !== 'prerequest' && e.listen !== 'test');
  (['prerequest', 'test'] as const).forEach((listen) => {
    const src = scripts && scripts[listen];
    if (src && src.trim()) out.push(scriptEvent(listen, src, existing.find((e) => e.listen === listen)));
  });
  return out;
}

function urlObjectFromDraft(draft: Draft): UrlJson {
  const { base, hash } = splitUrl(draft.url);
  const q = buildQuery(draft.params);
  const url = urlParts(base + (q ? `?${q}` : '') + hash);
  const query = rowsToV2(draft.params).map((p, i) => (draft.params.filter((r) => !isBlankRow(r))[i].value === null ? { ...p, value: null } : p));
  if (query.length) url.query = query;
  if ((draft.pathVars || []).length) {
    url.variable = draft.pathVars.map((v) => ({ key: v.key, value: v.value || '', ...(v.description ? { description: v.description } : {}) }));
  }
  return url;
}

function formDataToV2(rows: Row[] | undefined): FormDataJson[] {
  return (rows || []).filter((r) => !isBlankRow(r)).map((r) => {
    const out: FormDataJson = r.type === 'file' ? { key: r.key, type: 'file', src: r.src || '' } : { key: r.key, value: r.value == null ? '' : r.value, type: 'text' };
    if (r.enabled === false) out.disabled = true;
    if (r.description) out.description = r.description;
    return out;
  });
}

function bodyFromDraft(body: BodyDraft | undefined): BodyJson | undefined {
  if (!body) return undefined;
  switch (body.mode) {
    case 'raw': return { mode: 'raw', raw: body.raw || '', options: { raw: { language: body.language || 'text' } } };
    case 'urlencoded': return { mode: 'urlencoded', urlencoded: rowsToV2(body.urlencoded) };
    case 'formdata': return { mode: 'formdata', formdata: formDataToV2(body.formdata) };
    case 'file': return { mode: 'file', file: { src: body.file || '' } };
    case 'graphql': return { mode: 'graphql', graphql: { query: (body.graphql && body.graphql.query) || '', variables: (body.graphql && body.graphql.variables) || '' } };
    default: return undefined;
  }
}

function behaviorFromDraft(settings: ProtocolProfileBehavior | undefined): ProtocolProfileBehavior {
  const behavior: Record<string, unknown> = {};
  PROTOCOL_SETTINGS.forEach((k) => {
    const v = settings && settings[k];
    if (v !== undefined && (v as unknown) !== '') behavior[k] = v;
  });
  return behavior as ProtocolProfileBehavior;
}

/** A draft built programmatically may carry its query only in the URL text. */
function withSyncedParams(draft: Draft): Draft {
  if ((draft.params || []).length || !splitUrl(draft.url).query) return draft;
  return syncFromUrl({ ...draft, params: [], pathVars: clone(draft.pathVars || []) });
}

/** Serialize a draft to a v2.1 request item, preserving unrelated fields of `base`. */
export function itemFromDraft(input: Draft, base?: ItemJson | null): ItemJson {
  const draft = withSyncedParams(input);
  const item: ItemJson = { ...(clone(base) || {}), id: (base && base.id) || uid(), name: draft.name || 'Untitled Request' };
  const request: RequestJson = { method: draft.method || 'GET', header: rowsToV2(draft.headers), url: urlObjectFromDraft(draft) };
  const body = bodyFromDraft(draft.body);
  if (body) request.body = body;
  const auth = authToV2(draft.auth);
  if (auth) request.auth = auth;
  if (draft.description) request.description = draft.description;
  item.request = request;
  const events = eventsFromScripts(draft.scripts, item.event);
  if (events.length) item.event = events; else delete item.event;
  const behavior = behaviorFromDraft(draft.settings);
  if (Object.keys(behavior).length) item.protocolProfileBehavior = behavior; else delete item.protocolProfileBehavior;
  if (!Array.isArray(item.response)) item.response = [];
  return item;
}
