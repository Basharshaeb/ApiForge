/**
 * Code snippet generators (Postman's "Code" pane). A draft is first normalized
 * into { method, url, headers, body } with simple auth types applied, then
 * each language renders that shape.
 */
import type { AuthDraft, BodyDraft, Draft } from '../shared/types';
import * as M from './model';

export interface Field { key: string; value: string }
export interface FormField extends Field { type?: string; src?: string }
export type NormalizedBody =
  | { mode: 'raw'; raw: string; contentType?: string | null }
  | { mode: 'urlencoded'; fields: Field[]; contentType: string }
  | { mode: 'formdata'; fields: FormField[]; contentType?: undefined }
  | { mode: 'file'; src: string; contentType?: undefined };
export interface NormalizedRequest { method: string; url: string; headers: Field[]; body: NormalizedBody | null }
export type Resolver = (text: string) => string;

const enabled = (rows: Draft['headers'] | undefined) => (rows || []).filter((r) => r.enabled !== false && !M.isBlankRow(r));
const b64 = (s: string): string => (typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(s))) : Buffer.from(s, 'utf8').toString('base64'));
const fileName = (p: string | undefined): string => String(p).split(/[\\/]/).pop() || '';
const sq = (s: unknown): string => `'${String(s).replace(/'/g, `'\\''`)}'`;
const dq = (s: unknown): string => JSON.stringify(String(s));
const urlencode = (fields: Field[]): string => fields.map((f) => `${encodeURIComponent(f.key)}=${encodeURIComponent(f.value)}`).join('&');
const str = (v: unknown): string => (v == null ? '' : String(v));

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------
function resolvedUrl(draft: Draft, sub: Resolver): string {
  let url = sub(draft.url);
  (draft.pathVars || []).forEach((v) => {
    if (v.value) url = url.replace(new RegExp(`/:${v.key}(?=/|\\?|#|$)`), `/${sub(v.value)}`);
  });
  return url;
}

interface AuthTarget { addHeader(key: string, value: string): void; addQuery(key: string, value: string): void }
type AuthApplier = (req: AuthTarget, params: Record<string, unknown>, sub: Resolver) => void;

/** Auth types that can be expressed statically as a header or query parameter. */
const AUTH_APPLIERS: Record<string, AuthApplier> = {
  basic: (req, p, sub) => req.addHeader('Authorization', `Basic ${b64(`${sub(str(p.username))}:${sub(str(p.password))}`)}`),
  bearer: (req, p, sub) => req.addHeader('Authorization', `Bearer ${sub(str(p.token))}`),
  oauth2(req, p, sub) {
    if (!p.accessToken) return;
    if (p.addTokenTo === 'queryParams') req.addQuery('access_token', sub(str(p.accessToken)));
    else req.addHeader('Authorization', `${p.headerPrefix == null ? 'Bearer' : str(p.headerPrefix)} ${sub(str(p.accessToken))}`.trim());
  },
  apikey(req, p, sub) {
    if (!p.key) return;
    if (p.in === 'query') req.addQuery(sub(str(p.key)), sub(str(p.value)));
    else req.addHeader(sub(str(p.key)), sub(str(p.value)));
  }
};

function applyAuth(req: NormalizedRequest, auth: AuthDraft | undefined, sub: Resolver): void {
  const apply = auth && AUTH_APPLIERS[auth.type];
  if (!apply) return;
  apply({
    addHeader: (key, value) => { req.headers.push({ key, value }); },
    addQuery: (k, v) => { req.url += (req.url.includes('?') ? '&' : '?') + `${encodeURIComponent(k)}=${encodeURIComponent(v)}`; }
  }, auth.params || {}, sub);
}

const BODY_NORMALIZERS: Record<string, (body: BodyDraft, sub: Resolver) => NormalizedBody | null> = {
  raw: (body, sub) => (body.raw ? { mode: 'raw', raw: sub(body.raw), contentType: body.language !== 'text' ? M.RAW_CONTENT_TYPES[body.language] : null } : null),
  urlencoded(body, sub) {
    const fields = enabled(body.urlencoded);
    return fields.length ? { mode: 'urlencoded', fields: fields.map((r) => ({ key: sub(r.key), value: sub(str(r.value)) })), contentType: 'application/x-www-form-urlencoded' } : null;
  },
  formdata(body, sub) {
    const fields = enabled(body.formdata);
    return fields.length ? { mode: 'formdata', fields: fields.map((r) => ({ key: sub(r.key), value: sub(str(r.value)), type: r.type, src: r.src })) } : null;
  },
  file: (body) => (body.file ? { mode: 'file', src: body.file } : null),
  graphql(body, sub) {
    if (!body.graphql || !body.graphql.query) return null;
    let variables: unknown = {};
    try { variables = body.graphql.variables ? JSON.parse(sub(body.graphql.variables)) : {}; } catch { variables = {}; }
    return { mode: 'raw', raw: JSON.stringify({ query: sub(body.graphql.query), variables }), contentType: 'application/json' };
  }
};

function normalizeBody(body: BodyDraft | undefined, sub: Resolver): NormalizedBody | null {
  const normalize = body && BODY_NORMALIZERS[body.mode];
  return normalize ? normalize(body as BodyDraft, sub) : null;
}

/** Draft -> normalized request with simple auth types applied as headers/query. */
export function normalize(draft: Draft, resolve?: Resolver | null): NormalizedRequest {
  const sub: Resolver = resolve || ((s) => s);
  const req: NormalizedRequest = {
    method: draft.method || 'GET',
    url: resolvedUrl(draft, sub),
    headers: enabled(draft.headers).map((h) => ({ key: sub(h.key), value: sub(str(h.value)) })),
    body: normalizeBody(draft.body, sub)
  };
  applyAuth(req, draft.auth, sub);
  const hasContentType = req.headers.some((h) => h.key.toLowerCase() === 'content-type');
  if (req.body && req.body.contentType && !hasContentType) req.headers.push({ key: 'Content-Type', value: req.body.contentType });
  return req;
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------
type Generator = (req: NormalizedRequest) => string;

const curl: Generator = (req) => {
  const lines = [`curl --location --request ${req.method} ${sq(req.url)}`];
  req.headers.forEach((h) => lines.push(`--header ${sq(`${h.key}: ${h.value}`)}`));
  const b = req.body;
  if (b && b.mode === 'raw') lines.push(`--data-raw ${sq(b.raw)}`);
  if (b && b.mode === 'urlencoded') b.fields.forEach((f) => lines.push(`--data-urlencode ${sq(`${f.key}=${f.value}`)}`));
  if (b && b.mode === 'formdata') b.fields.forEach((f) => lines.push(`--form ${sq(f.type === 'file' ? `${f.key}=@"${f.src}"` : `${f.key}=${f.value}`)}`));
  if (b && b.mode === 'file') lines.push(`--data-binary ${sq(`@${b.src}`)}`);
  return lines.join(' \\\n');
};

function multipartBody(fields: FormField[]): { contentType: string; body: string } {
  const boundary = '----ApiForgeBoundary';
  const parts = fields.map((f) => (f.type === 'file'
    ? `--${boundary}\r\nContent-Disposition: form-data; name="${f.key}"; filename="${fileName(f.src)}"\r\nContent-Type: <Content-Type header here>\r\n\r\n(data)`
    : `--${boundary}\r\nContent-Disposition: form-data; name="${f.key}"\r\n\r\n${f.value}`));
  return { contentType: `multipart/form-data; boundary=${boundary}`, body: `${parts.join('\r\n')}\r\n--${boundary}--` };
}

const http: Generator = (req) => {
  const m = req.url.match(/^[a-z]+:\/\/([^/?#]+)(.*)$/i);
  const host = m ? m[1] : '';
  const lines = [`${req.method} ${m ? m[2] || '/' : req.url} HTTP/1.1`];
  if (host) lines.push(`Host: ${host}`);
  req.headers.forEach((h) => lines.push(`${h.key}: ${h.value}`));
  const b = req.body;
  let body = '';
  if (b && b.mode === 'raw') body = b.raw;
  if (b && b.mode === 'urlencoded') body = urlencode(b.fields);
  if (b && b.mode === 'formdata') {
    const multipart = multipartBody(b.fields);
    lines.push(`Content-Type: ${multipart.contentType}`);
    body = multipart.body;
  }
  if (b && b.mode === 'file') body = '"<file contents here>"';
  if (body) lines.push(`Content-Length: ${new TextEncoder().encode(body).length}`);
  return `${lines.join('\n')}\n\n${body}`;
};

function fetchBodySetup(b: NormalizedBody | null, out: string[]): string | null {
  if (!b) return null;
  if (b.mode === 'raw') { out.push('', `const raw = ${dq(b.raw)};`); return 'raw'; }
  if (b.mode === 'urlencoded') {
    out.push('', 'const urlencoded = new URLSearchParams();');
    b.fields.forEach((f) => out.push(`urlencoded.append(${dq(f.key)}, ${dq(f.value)});`));
    return 'urlencoded';
  }
  if (b.mode === 'formdata') {
    out.push('', 'const formdata = new FormData();');
    b.fields.forEach((f) => out.push(f.type === 'file' ? `formdata.append(${dq(f.key)}, fileInput.files[0], ${dq(fileName(f.src))});` : `formdata.append(${dq(f.key)}, ${dq(f.value)});`));
    return 'formdata';
  }
  out.push('', 'const file = "<file contents here>";');
  return 'file';
}

const fetchJs: Generator = (req) => {
  const out = ['const myHeaders = new Headers();'];
  req.headers.forEach((h) => out.push(`myHeaders.append(${dq(h.key)}, ${dq(h.value)});`));
  const bodyVar = fetchBodySetup(req.body, out);
  out.push('', 'const requestOptions = {', `  method: ${dq(req.method)},`, '  headers: myHeaders,');
  if (bodyVar) out.push(`  body: ${bodyVar},`);
  out.push('  redirect: "follow"', '};', '');
  out.push(`fetch(${dq(req.url)}, requestOptions)`, '  .then((response) => response.text())', '  .then((result) => console.log(result))', '  .catch((error) => console.error(error));');
  return out.join('\n');
};

function axiosData(b: NormalizedBody | null, out: string[]): void {
  if (!b) return;
  if (b.mode === 'raw') out.push(`const data = ${dq(b.raw)};`);
  if (b.mode === 'urlencoded') out.push("const qs = require('qs');", 'const data = qs.stringify({', ...b.fields.map((f) => `  ${dq(f.key)}: ${dq(f.value)},`), '});');
  if (b.mode === 'formdata') {
    out.push("const FormData = require('form-data');", "const fs = require('fs');", 'const data = new FormData();');
    b.fields.forEach((f) => out.push(f.type === 'file' ? `data.append(${dq(f.key)}, fs.createReadStream(${dq(f.src)}));` : `data.append(${dq(f.key)}, ${dq(f.value)});`));
  }
  if (b.mode === 'file') out.push("const fs = require('fs');", `const data = fs.readFileSync(${dq(b.src)});`);
}

const axios: Generator = (req) => {
  const out = ["const axios = require('axios');"];
  const b = req.body;
  axiosData(b, out);
  out.push('', 'const config = {', `  method: ${dq(req.method.toLowerCase())},`, '  maxBodyLength: Infinity,', `  url: ${dq(req.url)},`);
  const headerLines = req.headers.map((h) => `    ${dq(h.key)}: ${dq(h.value)},`);
  if (b && b.mode === 'formdata') headerLines.push('    ...data.getHeaders()');
  if (headerLines.length) out.push('  headers: {', ...headerLines, '  },');
  if (b) out.push('  data: data');
  out.push('};', '', 'axios.request(config)', '  .then((response) => {', '    console.log(JSON.stringify(response.data));', '  })', '  .catch((error) => {', '    console.log(error);', '  });');
  return out.join('\n');
};

function pythonPayload(b: NormalizedBody | null): { payload: string; files: string | null } {
  if (!b) return { payload: 'payload = {}', files: null };
  if (b.mode === 'raw') return { payload: `payload = ${dq(b.raw)}`, files: null };
  if (b.mode === 'urlencoded') return { payload: `payload = ${dq(urlencode(b.fields))}`, files: null };
  if (b.mode === 'file') return { payload: `payload = open(${dq(b.src)}, 'rb').read()`, files: null };
  const text = b.fields.filter((f) => f.type !== 'file');
  const file = b.fields.filter((f) => f.type === 'file');
  return {
    payload: `payload = {${text.map((f) => `${dq(f.key)}: ${dq(f.value)}`).join(', ')}}`,
    files: file.length ? `files = [\n${file.map((f) => `  (${dq(f.key)}, (${dq(fileName(f.src))}, open(${dq(f.src)}, 'rb')))`).join(',\n')}\n]` : null
  };
}

const python: Generator = (req) => {
  const { payload, files } = pythonPayload(req.body);
  const out = ['import requests', '', `url = ${dq(req.url)}`, '', payload];
  if (files) out.push(files);
  out.push('headers = {', ...req.headers.map((h) => `  ${dq(h.key)}: ${dq(h.value)},`), '}', '');
  out.push(`response = requests.request(${dq(req.method)}, url, headers=headers, data=payload${files ? ', files=files' : ''})`, '', 'print(response.text)');
  return out.join('\n');
};

const textBody = (b: NormalizedBody | null): string | null => (b && b.mode === 'raw' ? b.raw : b && b.mode === 'urlencoded' ? urlencode(b.fields) : null);

const go: Generator = (req) => {
  const text = textBody(req.body);
  const imports = ['"fmt"', '"net/http"', '"io"'].concat(text !== null ? ['"strings"'] : []);
  const out = ['package main', '', 'import (', ...imports.map((i) => `  ${i}`), ')', '', 'func main() {', '', `  url := ${dq(req.url)}`, `  method := ${dq(req.method)}`, ''];
  if (text !== null) out.push(`  payload := strings.NewReader(${JSON.stringify(text)})`);
  out.push('  client := &http.Client{}', `  req, err := http.NewRequest(method, url, ${text !== null ? 'payload' : 'nil'})`, '', '  if err != nil {', '    fmt.Println(err)', '    return', '  }');
  req.headers.forEach((h) => out.push(`  req.Header.Add(${dq(h.key)}, ${dq(h.value)})`));
  out.push('', '  res, err := client.Do(req)', '  if err != nil {', '    fmt.Println(err)', '    return', '  }', '  defer res.Body.Close()', '',
    '  body, err := io.ReadAll(res.Body)', '  if err != nil {', '    fmt.Println(err)', '    return', '  }', '  fmt.Println(string(body))', '}');
  return out.join('\n');
};

const powershell: Generator = (req) => {
  const out = ['$headers = New-Object "System.Collections.Generic.Dictionary[[String],[String]]"'];
  req.headers.forEach((h) => out.push(`$headers.Add(${sq(h.key)}, ${sq(h.value)})`));
  const text = textBody(req.body);
  if (text !== null) out.push('', `$body = ${sq(text)}`);
  out.push('', `$response = Invoke-RestMethod ${sq(req.url)} -Method '${req.method}' -Headers $headers${text !== null ? ' -Body $body' : ''}`, '$response | ConvertTo-Json');
  return out.join('\n');
};

export interface Language { id: string; label: string; fn: Generator; lang: string }

export const LANGUAGES: Language[] = [
  { id: 'curl', label: 'cURL', fn: curl, lang: 'shell' },
  { id: 'http', label: 'HTTP', fn: http, lang: 'http' },
  { id: 'fetch', label: 'JavaScript - Fetch', fn: fetchJs, lang: 'javascript' },
  { id: 'axios', label: 'NodeJs - Axios', fn: axios, lang: 'javascript' },
  { id: 'python', label: 'Python - Requests', fn: python, lang: 'python' },
  { id: 'go', label: 'Go - Native', fn: go, lang: 'go' },
  { id: 'powershell', label: 'PowerShell - RestMethod', fn: powershell, lang: 'powershell' }
];

export function generate(languageId: string, draft: Draft, resolve?: Resolver | null): string {
  const lang = LANGUAGES.find((l) => l.id === languageId) || LANGUAGES[0];
  return lang.fn(normalize(draft, resolve));
}
