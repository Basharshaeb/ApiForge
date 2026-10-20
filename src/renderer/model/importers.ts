/**
 * Importers: cURL commands, Postman v1 collections, OpenAPI/Swagger documents,
 * environment files and runner data files.
 */
import yaml from 'js-yaml';
import type { CollectionJson, Draft, ImportResult, ItemJson, Row, V1Collection, V1Request } from '../../shared/types';
import { draftFromItem, emptyDraft, guessLanguage, itemFromDraft, parseHeaderString } from './draft';
import { environmentFromImport } from './scopes';
import { ensureIds, newCollection, newFolder } from './tree';
import { parseQuery, splitUrl, syncFromUrl, syncUrlFromParams } from './url';
import { clone, row } from './util';

// ---------------------------------------------------------------------------
// cURL
// ---------------------------------------------------------------------------
/** POSIX-ish shell word splitting with quotes, escapes and line continuations. */
// eslint-disable-next-line complexity -- character-level state machine; splitting it would obscure the grammar
export function shellSplit(input: string): string[] {
  const text = String(input).replace(/\\\r?\n/g, ' ').replace(/\^\r?\n/g, ' ');
  const tokens: string[] = [];
  let cur = '';
  let quote: string | null = null;
  let has = false;
  const flush = (): void => { if (has || cur) tokens.push(cur); cur = ''; has = false; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) { quote = null; continue; }
      if (c === '\\' && quote === '"' && i + 1 < text.length && '"\\$`'.includes(text[i + 1])) { cur += text[++i]; continue; }
      cur += c;
    } else if (c === '$' && text[i + 1] === "'") { quote = "'"; i++; has = true; }
    else if (c === "'" || c === '"') { quote = c; has = true; }
    else if (c === '\\' && i + 1 < text.length) { cur += text[++i]; has = true; }
    else if (/\s/.test(c)) flush();
    else cur += c;
  }
  flush();
  return tokens;
}

interface CurlState { draft: Draft; data: string[]; form: Row[]; method: string | null; url: string | null; forceGet: boolean; dataUrlencode: boolean }
type CurlHandler = (state: CurlState, value: string | undefined, flag: string) => void;

const CURL_VALUE_FLAGS = new Set(['-X', '--request', '-H', '--header', '-d', '--data', '--data-raw', '--data-binary', '--data-ascii',
  '--data-urlencode', '-F', '--form', '--form-string', '-u', '--user', '-A', '--user-agent', '-b', '--cookie', '-e', '--referer', '--url',
  '-o', '--output', '-m', '--max-time', '--connect-timeout', '-x', '--proxy', '-w', '--write-out', '--cert', '--key', '--cacert', '-T', '--upload-file']);

const addHeader = (name: string): CurlHandler => (s, v) => { s.draft.headers.push(row(name, String(v))); };
const pushData: CurlHandler = (s, v) => { s.data.push(String(v)); };

const CURL_HANDLERS: Record<string, CurlHandler> = {
  '-X': (s, v) => { s.method = String(v).toUpperCase(); },
  '-H': (s, v) => {
    const h = String(v);
    const colon = h.indexOf(':');
    if (colon > 0) s.draft.headers.push(row(h.slice(0, colon).trim(), h.slice(colon + 1).trim()));
  },
  '-d': pushData, '--data': pushData, '--data-raw': pushData, '--data-binary': pushData, '--data-ascii': pushData,
  '--data-urlencode': (s, v) => { pushData(s, v, '--data-urlencode'); s.dataUrlencode = true; },
  '-F': (s, v, flag) => {
    const f = String(v);
    const eq = f.indexOf('=');
    const key = eq >= 0 ? f.slice(0, eq) : f;
    const val = eq >= 0 ? f.slice(eq + 1) : '';
    const isFile = flag !== '--form-string' && val.startsWith('@');
    s.form.push(isFile ? row(key, '', true, { type: 'file', src: val.slice(1).split(';')[0] }) : row(key, val, true, { type: 'text', src: '' }));
  },
  '-u': (s, v) => {
    const u = String(v);
    const colon = u.indexOf(':');
    s.draft.auth = { type: 'basic', params: { username: colon >= 0 ? u.slice(0, colon) : u, password: colon >= 0 ? u.slice(colon + 1) : '' } };
  },
  '-A': addHeader('User-Agent'), '-b': addHeader('Cookie'), '-e': addHeader('Referer'),
  '--url': (s, v) => { s.url = String(v); },
  '-G': (s) => { s.forceGet = true; },
  '-I': (s) => { s.method = 'HEAD'; }
};
const CURL_ALIASES: Record<string, string> = { '--request': '-X', '--header': '-H', '--form': '-F', '--form-string': '-F', '--user': '-u', '--user-agent': '-A', '--cookie': '-b', '--referer': '-e', '--get': '-G', '--head': '-I' };

/** Normalize `--flag=value` and `-Xvalue` forms into [flag, value]. */
function splitCurlToken(token: string): [string, string | undefined] {
  const eq = token.match(/^(--[a-z-]+)=(.*)$/s);
  if (eq && CURL_VALUE_FLAGS.has(eq[1])) return [eq[1], eq[2]];
  const attached = token.match(/^(-[XHdFuAbe])(.+)$/s);
  if (attached) return [attached[1], attached[2]];
  return [token, undefined];
}

function parseCurlTokens(tokens: string[], state: CurlState): void {
  for (let i = 1; i < tokens.length; i++) {
    const [flag, attachedValue] = splitCurlToken(tokens[i]);
    const handler = CURL_HANDLERS[CURL_ALIASES[flag] || flag];
    const needsValue = CURL_VALUE_FLAGS.has(flag);
    const value = needsValue ? (attachedValue !== undefined ? attachedValue : tokens[++i]) : undefined;
    if (handler) handler(state, value, flag);
    else if (!needsValue && !flag.startsWith('-') && state.url === null) state.url = flag;
  }
}

function applyCurlBody(state: CurlState): void {
  const { draft, data, form, forceGet, dataUrlencode } = state;
  const contentType = ((draft.headers.find((h) => /^content-type$/i.test(h.key)) || {}).value || '').toLowerCase();
  if (form.length) {
    draft.body.mode = 'formdata';
    draft.body.formdata = form;
    return;
  }
  if (!data.length || forceGet) return;
  const joined = data.join('&');
  const looksUrlencoded = contentType.includes('application/x-www-form-urlencoded') || (!contentType && (dataUrlencode || /^[^=&\s{[<]+=[^&]*(&[^=&\s]+=[^&]*)*$/.test(joined)));
  if (looksUrlencoded) {
    draft.body.mode = 'urlencoded';
    draft.body.urlencoded = parseQuery(joined).map((r) => ({ ...r, value: r.value == null ? '' : r.value }));
  } else {
    draft.body.mode = 'raw';
    draft.body.raw = joined;
    draft.body.language = guessLanguage(joined, draft.headers);
  }
}

/** Parse a cURL command into a draft (null if it is not a curl command). */
export function parseCurl(command: string): Draft | null {
  const tokens = shellSplit(String(command || '').trim());
  if (!tokens.length || !/^curl(\.exe)?$/i.test(tokens[0])) return null;
  const state: CurlState = { draft: emptyDraft({ name: 'Imported from cURL', auth: { type: 'noauth', params: {} } }), data: [], form: [], method: null, url: null, forceGet: false, dataUrlencode: false };
  parseCurlTokens(tokens, state);
  const { draft } = state;
  draft.url = state.url || '';
  if (state.forceGet && state.data.length) {
    const { base, query, hash } = splitUrl(draft.url);
    draft.url = base + '?' + [query, state.data.join('&')].filter(Boolean).join('&') + hash;
  }
  syncFromUrl(draft);
  applyCurlBody(state);
  const hasBody = (state.data.length && !state.forceGet) || state.form.length;
  draft.method = state.method || (hasBody ? 'POST' : 'GET');
  return draft;
}

// ---------------------------------------------------------------------------
// Postman v1
// ---------------------------------------------------------------------------
function v1RequestToItem(r: V1Request): ItemJson {
  const draft = emptyDraft({ name: r.name || r.url, method: (r.method || 'GET').toUpperCase(), url: r.url || '', description: r.description || '' });
  syncFromUrl(draft);
  draft.headers = parseHeaderString(r.headers);
  if (r.dataMode === 'raw' || r.rawModeData) {
    draft.body.mode = 'raw';
    draft.body.raw = r.rawModeData || '';
    draft.body.language = guessLanguage(draft.body.raw, draft.headers);
  } else if ((r.dataMode === 'urlencoded' || r.dataMode === 'params') && Array.isArray(r.data)) {
    const target = r.dataMode === 'urlencoded' ? 'urlencoded' : 'formdata';
    draft.body.mode = target;
    draft.body[target] = r.data.map((d) => row(d.key, d.type === 'file' ? '' : (d.value ?? ''), d.enabled !== false, { type: d.type === 'file' ? 'file' : 'text', src: d.type === 'file' ? d.value : '' }));
  }
  if (r.preRequestScript) draft.scripts.prerequest = r.preRequestScript;
  if (r.tests) draft.scripts.test = r.tests;
  return itemFromDraft(draft);
}

export function convertV1(v1: V1Collection): CollectionJson {
  const collection = newCollection(v1.name);
  collection.info.description = v1.description || '';
  const byId = new Map((v1.requests || []).map((r) => [r.id, r]));
  const used = new Set<string>();
  const take = (id: string): ItemJson => { used.add(id); return v1RequestToItem(byId.get(id) as V1Request); };
  (v1.folders || []).forEach((f) => {
    const folder = newFolder(f.name);
    folder.description = f.description || '';
    (f.order || []).filter((id) => byId.has(id)).forEach((id) => folder.item.push(take(id)));
    collection.item.push(folder);
  });
  (v1.order || []).filter((id) => byId.has(id) && !used.has(id)).forEach((id) => collection.item.push(take(id)));
  (v1.requests || []).filter((r) => !used.has(r.id)).forEach((r) => collection.item.push(take(r.id)));
  return collection;
}

// ---------------------------------------------------------------------------
// OpenAPI 3.x / Swagger 2.0
// ---------------------------------------------------------------------------
interface Schema { $ref?: string; type?: string; example?: unknown; default?: unknown; enum?: unknown[]; allOf?: Schema[]; oneOf?: Schema[]; anyOf?: Schema[]; properties?: Record<string, Schema>; items?: Schema; format?: string }
interface Parameter { $ref?: string; name: string; in: string; required?: boolean; description?: string; example?: unknown; schema?: Schema }
interface MediaType { example?: unknown; schema?: Schema }
interface RequestBody { $ref?: string; content?: Record<string, MediaType> }
interface Operation { tags?: string[]; summary?: string; operationId?: string; description?: string; parameters?: Parameter[]; requestBody?: RequestBody }
type PathItem = Record<string, Operation | Parameter[] | undefined> & { parameters?: Parameter[] };
interface OpenApiSpec {
  openapi?: string;
  swagger?: string;
  info?: { title?: string; description?: string };
  servers?: Array<{ url?: string }>;
  host?: string;
  schemes?: string[];
  basePath?: string;
  paths?: Record<string, PathItem>;
}
type Resolver = <T extends { $ref?: string }>(obj: T | undefined) => T;
type ExampleBuilder = (schema: Schema | undefined, depth?: number) => unknown;

const OPENAPI_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];
const MAX_EXAMPLE_DEPTH = 6;

function openApiBaseUrl(spec: OpenApiSpec): string {
  if (spec.servers && spec.servers[0]) return (spec.servers[0].url || '').replace(/\/$/, '');
  if (spec.host) return `${(spec.schemes && spec.schemes[0]) || 'https'}://${spec.host}${spec.basePath || ''}`.replace(/\/$/, '');
  return '';
}

function createRefResolver(spec: OpenApiSpec): Resolver {
  const decode = (k: string): string => k.replace(/~1/g, '/').replace(/~0/g, '~');
  return <T extends { $ref?: string }>(obj: T | undefined): T => {
    let cur: unknown = obj;
    for (let guard = 0; cur && (cur as { $ref?: string }).$ref && guard < 10; guard++) {
      const ref = (cur as { $ref: string }).$ref.replace(/^#\//, '').split('/');
      cur = ref.reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[decode(k)] : undefined), spec);
    }
    return (cur || {}) as T;
  };
}

/** Example values per JSON-schema type; `example` recurses for containers. */
const TYPE_EXAMPLES: Record<string, (s: Schema, example: ExampleBuilder, depth: number) => unknown> = {
  object: (s, example, depth) => Object.fromEntries(Object.entries(s.properties || {}).map(([k, v]) => [k, example(v, depth + 1)])),
  array: (s, example, depth) => [example(s.items || {}, depth + 1)],
  integer: () => 0,
  number: () => 0,
  boolean: () => true,
  string: (s) => (s.format === 'date-time' ? new Date(0).toISOString() : 'string')
};

/** Literal examples take precedence over generated ones: example > default > first enum. */
function literalExample(s: Schema): unknown {
  if (s.example !== undefined) return s.example;
  if (s.default !== undefined) return s.default;
  return s.enum ? s.enum[0] : undefined;
}

function createExampleBuilder(resolveRef: Resolver): ExampleBuilder {
  const example: ExampleBuilder = (schema, depth = 0) => {
    const s = resolveRef(schema);
    if (depth > MAX_EXAMPLE_DEPTH) return null;
    const literal = literalExample(s);
    if (literal !== undefined) return literal;
    if (s.allOf) return Object.assign({}, ...s.allOf.map((x) => example(x, depth + 1) || {}));
    const alternatives = s.oneOf || s.anyOf;
    if (alternatives) return example(alternatives[0], depth + 1);
    const type = s.type || (s.properties ? 'object' : '');
    return TYPE_EXAMPLES[type] ? TYPE_EXAMPLES[type](s, example, depth) : null;
  };
  return example;
}

function applyOpenApiBody(draft: Draft, op: Operation, params: Parameter[], resolveRef: Resolver, example: ExampleBuilder): void {
  const content = op.requestBody && resolveRef(op.requestBody).content;
  const bodyParam = params.find((x) => x.in === 'body');
  if (content && content['application/json']) {
    const media = content['application/json'];
    draft.body.mode = 'raw';
    draft.body.language = 'json';
    draft.body.raw = JSON.stringify(media.example !== undefined ? media.example : example(media.schema || {}), null, 2);
    draft.headers.push(row('Content-Type', 'application/json'));
  } else if (content && content['application/x-www-form-urlencoded']) {
    draft.body.mode = 'urlencoded';
    const props = resolveRef(content['application/x-www-form-urlencoded'].schema || {}).properties || {};
    draft.body.urlencoded = Object.keys(props).map((k) => row(k, ''));
  } else if (bodyParam) {
    draft.body.mode = 'raw';
    draft.body.language = 'json';
    draft.body.raw = JSON.stringify(example(bodyParam.schema || {}), null, 2);
  }
}

interface OpenApiHelpers { resolveRef: Resolver; example: ExampleBuilder }

function openApiOperationItem(pathKey: string, method: string, op: Operation, sharedParams: Parameter[], helpers: OpenApiHelpers): ItemJson {
  const { resolveRef, example } = helpers;
  const params = sharedParams.concat(op.parameters || []).map((p) => resolveRef(p));
  const draft = emptyDraft({
    name: op.summary || op.operationId || `${method.toUpperCase()} ${pathKey}`,
    method: method.toUpperCase(),
    description: op.description || '',
    url: '{{baseUrl}}' + pathKey.replace(/\{([^}]+)\}/g, ':$1')
  });
  draft.headers = params.filter((x) => x.in === 'header').map((x) => row(x.name, '', true, { description: x.description || '' }));
  syncFromUrl(draft);
  draft.params = params.filter((x) => x.in === 'query').map((x) => row(x.name, x.example !== undefined ? String(x.example) : '', !!x.required, { description: x.description || '' }));
  syncUrlFromParams(draft);
  params.filter((x) => x.in === 'path').forEach((x) => {
    const v = draft.pathVars.find((pv) => pv.key === x.name);
    if (v) v.description = x.description || '';
  });
  applyOpenApiBody(draft, op, params, resolveRef, example);
  return itemFromDraft(draft);
}

export function convertOpenApi(spec: OpenApiSpec): CollectionJson {
  const collection = newCollection((spec.info && spec.info.title) || 'Imported API');
  collection.info.description = (spec.info && spec.info.description) || '';
  collection.variable = [{ key: 'baseUrl', value: openApiBaseUrl(spec), type: 'string' }];
  const resolveRef = createRefResolver(spec);
  const helpers: OpenApiHelpers = { resolveRef, example: createExampleBuilder(resolveRef) };
  const folders = new Map<string, ReturnType<typeof newFolder>>();
  const folderFor = (tag: string) => {
    let folder = folders.get(tag);
    if (!folder) {
      folder = newFolder(tag);
      folders.set(tag, folder);
      collection.item.push(folder);
    }
    return folder;
  };
  Object.entries(spec.paths || {}).forEach(([pathKey, pathItem]) => {
    const shared = (pathItem && pathItem.parameters) || [];
    OPENAPI_METHODS.filter((m) => pathItem && pathItem[m]).forEach((m) => {
      const op = pathItem[m] as Operation;
      const item = openApiOperationItem(pathKey, m, op, shared, helpers);
      const tag = op.tags && op.tags[0];
      (tag ? folderFor(tag).item : collection.item).push(item);
    });
  });
  return collection;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------
type JsonObject = Record<string, unknown>;

function parseDocument(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    try {
      return yaml.load(text);
    } catch (err) {
      throw new Error(`Unsupported format: not valid JSON or YAML (${(err as Error).message.split('\n')[0]})`);
    }
  }
}

/** Document detectors in priority order: [matches(json), convert(json)]. */
const DOCUMENT_KINDS: Array<[(j: JsonObject) => boolean, (j: JsonObject) => ImportResult]> = [
  [(j) => !!j.info && Array.isArray(j.item), (j) => ({ kind: 'collection', value: ensureIds(clone(j as unknown as CollectionJson)) })],
  [(j) => Array.isArray(j.requests) && !!(j.order || j.folders || j.name), (j) => ({ kind: 'collection', value: ensureIds(convertV1(j as V1Collection)) })],
  [(j) => !!(j.openapi || j.swagger), (j) => ({ kind: 'collection', value: ensureIds(convertOpenApi(j as OpenApiSpec)) })],
  [(j) => Array.isArray(j.values) && j._postman_variable_scope === 'globals', (j) => ({ kind: 'globals', value: environmentFromImport(j).values })],
  [(j) => Array.isArray(j.values), (j) => ({ kind: 'environment', value: environmentFromImport(j) })]
];

function importCurlText(text: string): ImportResult {
  const draft = parseCurl(text);
  if (!draft) throw new Error('Could not parse cURL command');
  return { kind: 'request', value: draft };
}

/** Detect and convert anything the import dialog accepts. */
export function importText(text: string): ImportResult {
  const trimmed = String(text || '').trim();
  if (!trimmed) throw new Error('Nothing to import');
  if (/^curl(\.exe)?\s/i.test(trimmed)) return importCurlText(trimmed);
  const parsed = parseDocument(trimmed);
  if (!parsed || typeof parsed !== 'object') throw new Error('Unsupported format: expected Postman/OpenAPI JSON or YAML, or a cURL command');
  const wrapper = parsed as { collection?: JsonObject };
  const json = (wrapper.collection && wrapper.collection.info ? wrapper.collection : parsed) as JsonObject; // Postman API export wrapper
  const match = DOCUMENT_KINDS.find(([matches]) => matches(json));
  if (!match) throw new Error('Unrecognized JSON: not a Postman collection, environment or OpenAPI document');
  return match[1](json);
}

// ---------------------------------------------------------------------------
// Runner data files
// ---------------------------------------------------------------------------
const BOM = 0xfeff;
const stripBom = (text: string): string => (text.charCodeAt(0) === BOM ? text.slice(1) : text);

/** RFC 4180-ish CSV parser. */
// eslint-disable-next-line complexity -- character-level state machine; splitting it would obscure the grammar
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let cur = [''];
  let quoted = false;
  const s = stripBom(String(text || ''));
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { cur[cur.length - 1] += '"'; i++; }
      else if (c === '"') quoted = false;
      else cur[cur.length - 1] += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') cur.push('');
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      rows.push(cur);
      cur = [''];
    } else cur[cur.length - 1] += c;
  }
  if (cur.length > 1 || cur[0] !== '') rows.push(cur);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).filter((r) => r.some((v) => v !== '')).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] === undefined ? '' : r[i]])));
}

export function parseDataFile(name: string, content: string): Record<string, unknown>[] {
  if (/\.json$/i.test(name) || /^\s*[[{]/.test(content)) {
    const data: unknown = JSON.parse(content);
    if (!Array.isArray(data)) throw new Error('JSON data file must contain an array of objects');
    return data as Record<string, unknown>[];
  }
  return parseCsv(content);
}

export { draftFromItem };
