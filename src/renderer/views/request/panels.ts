/**
 * Request editor panels: params, headers, body, scripts, settings.
 */
import type { BodyMode, Draft, ProtocolProfileBehavior } from '../../../shared/types';
import { RAW_LANGUAGES, syncUrlFromParams } from '../../model';
import * as Codegen from '../../codegen';
import { codeEditor, h, iconButton, kvEditor, prettyText, radioGroup, selectEl, tabStrip } from '../../ui';
import { pickFile } from '../../app/shell';
import type { Panel, RequestCtx } from './context';

const SNIPPETS: Array<[string, string]> = [
  ['Get an environment variable', 'pm.environment.get("variable_key");'],
  ['Set an environment variable', 'pm.environment.set("variable_key", "variable_value");'],
  ['Clear an environment variable', 'pm.environment.unset("variable_key");'],
  ['Get a global variable', 'pm.globals.get("variable_key");'],
  ['Set a global variable', 'pm.globals.set("variable_key", "variable_value");'],
  ['Get a collection variable', 'pm.collectionVariables.get("variable_key");'],
  ['Get a variable', 'pm.variables.get("variable_key");'],
  ['Send a request', 'pm.sendRequest("https://postman-echo.com/get", function (err, response) {\n    console.log(response.json());\n});'],
  ['Status code: Code is 200', 'pm.test("Status code is 200", function () {\n    pm.response.to.have.status(200);\n});'],
  ['Response body: Contains string', 'pm.test("Body matches string", function () {\n    pm.expect(pm.response.text()).to.include("string_you_want_to_search");\n});'],
  ['Response body: JSON value check', 'pm.test("Your test name", function () {\n    var jsonData = pm.response.json();\n    pm.expect(jsonData.value).to.eql(100);\n});'],
  ['Response body: Is equal to a string', 'pm.test("Body is correct", function () {\n    pm.response.to.have.body("response_body_string");\n});'],
  ['Response headers: Content-Type check', 'pm.test("Content-Type is present", function () {\n    pm.response.to.have.header("Content-Type");\n});'],
  ['Response time is less than 200ms', 'pm.test("Response time is less than 200ms", function () {\n    pm.expect(pm.response.responseTime).to.be.below(200);\n});'],
  ['Status code: Successful POST request', 'pm.test("Successful POST request", function () {\n    pm.expect(pm.response.code).to.be.oneOf([201, 202]);\n});'],
  ['Status code: Code name has string', 'pm.test("Status code name has string", function () {\n    pm.response.to.have.status("Created");\n});'],
  ['Use a JSON schema', 'var schema = {\n    "items": { "type": "boolean" }\n};\npm.test("Schema is valid", function () {\n    pm.response.to.have.jsonSchema(schema);\n});'],
  ['Set next request (runner)', 'pm.execution.setNextRequest("request_name");'],
  ['Visualize response', 'var template = `<table>{{#each response}}<tr><td>{{this.name}}</td></tr>{{/each}}</table>`;\npm.visualizer.set(template, { response: pm.response.json() });']
];

const AUTO_HEADERS: Array<[string, string]> = [
  ['User-Agent', 'PostmanRuntime/7.x'], ['Accept', '*/*'], ['Accept-Encoding', 'gzip, deflate, br'], ['Connection', 'keep-alive'], ['Postman-Token', '<calculated when request is sent>']
];

const BODY_MODES: Array<readonly [BodyMode, string]> = [['none', 'none'], ['formdata', 'form-data'], ['urlencoded', 'x-www-form-urlencoded'], ['raw', 'raw'], ['file', 'binary'], ['graphql', 'GraphQL']];

// Params ----------------------------------------------------------------------
export const params: Panel = (ctx) => {
  const { draft } = ctx;
  ctx.body.appendChild(kvEditor({
    title: 'Query Params', rows: draft.params, getVars: ctx.getVars, description: true,
    onChange: () => { syncUrlFromParams(draft); ctx.urlInput.setValue(draft.url); ctx.dirty(); ctx.refreshSubtabs(); }
  }));
  if (draft.pathVars.length) {
    const rows = draft.pathVars as unknown as Draft['params']; // same editable shape (key/value/description)
    ctx.body.appendChild(kvEditor({ title: 'Path Variables', rows, getVars: ctx.getVars, description: true, fixedKeys: true, bulk: false, onChange: ctx.dirty }));
  }
};

// Headers ---------------------------------------------------------------------
function computedHeaders(draft: Draft): Array<[string, string]> {
  const userKeys = new Set(draft.headers.filter((r) => r.enabled !== false && r.key).map((r) => r.key.toLowerCase()));
  const normalized = Codegen.normalize(draft);
  const out: Array<[string, string]> = normalized.headers.filter((x) => !userKeys.has(x.key.toLowerCase())).map((x) => [x.key, x.value]);
  if (normalized.body && normalized.body.mode === 'formdata') out.push(['Content-Type', 'multipart/form-data; boundary=<calculated when request is sent>']);
  if (normalized.body) out.push(['Content-Length', '<calculated when request is sent>']);
  const host = (draft.url.match(/^(?:[a-z]+:\/\/)?([^/?#]+)/i) || [])[1];
  if (host) out.push(['Host', host]);
  AUTO_HEADERS.forEach(([k, v]) => { if (!userKeys.has(k.toLowerCase())) out.push([k, v]); });
  return out;
}

function autoHeadersTable(rows: Array<[string, string]>): HTMLElement {
  const cell = (cls: string, text?: string): HTMLElement => h('div', { class: `kv-cell ${cls}` }, text);
  return h('div', { class: 'kv-table' },
    h('div', { class: 'kv-row kv-head' }, cell('kv-check'), cell('', 'Key'), cell('', 'Value'), cell('kv-actions')),
    rows.map(([k, v]) => h('div', { class: 'kv-row' }, cell('kv-check'), cell('kv-static', k), cell('kv-static muted', v), cell('kv-actions'))));
}

export const headers: Panel = (ctx) => {
  const { draft } = ctx;
  ctx.body.appendChild(kvEditor({ title: 'Headers', rows: draft.headers, getVars: ctx.getVars, description: true, onChange: () => { ctx.dirty(); ctx.refreshSubtabs(); } }));
  const auto = computedHeaders(draft);
  ctx.body.appendChild(h('details', { class: 'auto-headers' }, h('summary', null, `${auto.length} auto-generated headers (sent with the request)`), autoHeadersTable(auto)));
};

// Body ------------------------------------------------------------------------
function rawBodyEditor(ctx: RequestCtx, modeRow: HTMLElement): HTMLElement {
  const { body } = ctx.draft;
  const editor = codeEditor({ value: body.raw, language: body.language, placeholder: body.language === 'json' ? '{\n  "key": "value"\n}' : '', onInput: (v) => { body.raw = v; ctx.dirty(); } });
  const beautify = (): void => {
    const pretty = prettyText(body.raw, body.language);
    if (pretty !== body.raw) { body.raw = pretty; editor.setValue(pretty); ctx.dirty(); }
  };
  modeRow.append(
    selectEl(RAW_LANGUAGES, body.language, (v) => { body.language = v; ctx.dirty(); ctx.renderRequestBody(); }),
    h('button', { class: 'btn btn-small btn-secondary', type: 'button', onclick: beautify }, 'Beautify'));
  return h('div', { class: 'editor-wrap' }, editor);
}

function filePicker(ctx: RequestCtx): HTMLElement {
  const { body } = ctx.draft;
  const name = body.file ? body.file.split(/[\\/]/).pop() : '';
  const choose = async (): Promise<void> => { const p = await pickFile(); if (p) { body.file = p; ctx.dirty(); ctx.renderRequestBody(); } };
  return h('div', { class: 'file-picker' },
    h('button', { class: 'btn btn-secondary btn-small', type: 'button', onclick: choose }, 'Select File'),
    h('span', { title: body.file }, name || 'No file selected'),
    body.file ? iconButton('x', 'Clear', () => { body.file = ''; ctx.dirty(); ctx.renderRequestBody(); }) : null);
}

function graphqlEditors(ctx: RequestCtx): HTMLElement {
  const { graphql } = ctx.draft.body;
  const query = codeEditor({ value: graphql.query, language: 'graphql', placeholder: 'query {\n  field\n}', onInput: (v) => { graphql.query = v; ctx.dirty(); } });
  const variables = codeEditor({ value: graphql.variables, language: 'json', placeholder: '{ "id": 1 }', onInput: (v) => { graphql.variables = v; ctx.dirty(); } });
  const column = (title: string, editor: HTMLElement): HTMLElement => h('div', { class: 'editor-wrap' }, h('div', { class: 'kv-title', style: { marginBottom: '6px' } }, title), editor);
  return h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', flex: 1, minHeight: 0 } }, column('Query', query), column('GraphQL Variables', variables));
}

function bodyEditorFor(ctx: RequestCtx, modeRow: HTMLElement): HTMLElement {
  const { body } = ctx.draft;
  switch (body.mode) {
    case 'raw': return rawBodyEditor(ctx, modeRow);
    case 'formdata': return kvEditor({ rows: body.formdata, getVars: ctx.getVars, description: true, files: true, pickFile, onChange: ctx.dirty });
    case 'urlencoded': return kvEditor({ rows: body.urlencoded, getVars: ctx.getVars, description: true, onChange: ctx.dirty });
    case 'file': return filePicker(ctx);
    case 'graphql': return graphqlEditors(ctx);
    default: return h('div', { class: 'muted', style: { padding: '20px 0', textAlign: 'center' } }, 'This request does not have a body');
  }
}

export const body: Panel = (ctx) => {
  const draftBody = ctx.draft.body;
  const modeRow = h('div', { class: 'body-mode-row' }, radioGroup('body-mode', BODY_MODES, draftBody.mode, (v) => { draftBody.mode = v as BodyMode; ctx.dirty(); ctx.refreshSubtabs(); ctx.renderRequestBody(); }));
  ctx.body.classList.add('column');
  ctx.body.append(modeRow, bodyEditorFor(ctx, modeRow));
};

// Scripts ---------------------------------------------------------------------
export const scripts: Panel = (ctx) => {
  const { tab, draft } = ctx;
  const target = tab.scriptTab || 'prerequest';
  tab.scriptTab = target;
  const placeholder = target === 'prerequest' ? '// Runs before the request is sent' : '// Runs after the response is received\npm.test("Status code is 200", () => pm.response.to.have.status(200));';
  const editor = codeEditor({ value: draft.scripts[target], language: 'javascript', placeholder, onInput: (v) => { draft.scripts[target] = v; ctx.dirty(); ctx.refreshSubtabs(); } });
  Object.assign(editor.style, { border: 'none', borderRadius: '0' });
  const pills = tabStrip([{ id: 'prerequest', label: 'Pre-request' }, { id: 'test', label: 'Post-response' }], target, (id) => { tab.scriptTab = id as 'prerequest' | 'test'; ctx.renderRequestBody(); }, 'pill');
  ctx.body.className = 'pane-body no-pad column';
  ctx.body.append(
    h('div', { class: 'pane-toolbar sub' }, pills, h('span', { class: 'spacer' }), h('span', { class: 'faint' }, 'Ctrl+/ toggles comments')),
    h('div', { class: 'scripts-layout' },
      h('div', { class: 'scripts-main' }, editor),
      h('div', { class: 'snippets' }, h('div', { class: 'snippets-title' }, 'Snippets'), SNIPPETS.map(([label, code]) => h('button', { class: 'snippet', type: 'button', onclick: () => editor.insert(code) }, label)))));
};

// Settings --------------------------------------------------------------------
type BoolSetting = Exclude<keyof ProtocolProfileBehavior, 'maxRedirects'>;

const TRI_STATE_SETTINGS: Array<[BoolSetting, string, string]> = [
  ['followRedirects', 'Automatically follow redirects', 'Follow HTTP 3xx responses as redirects.'],
  ['followOriginalHttpMethod', 'Follow original HTTP Method', 'Redirect with the original HTTP method instead of the default behavior of redirecting with GET.'],
  ['strictSSL', 'Enable SSL certificate verification', 'Verify SSL certificates when sending a request. Off accepts self-signed certificates.'],
  ['disableUrlEncoding', 'Disable URL encoding', 'Send the URL exactly as typed without encoding reserved characters.'],
  ['disableCookies', 'Disable cookie jar', 'Do not send or store cookies for this request.']
];

const settingRow = (title: string, desc: string, control: HTMLElement): HTMLElement =>
  h('div', { class: 'setting-row' }, h('div', { class: 'setting-text' }, h('div', { class: 'setting-title' }, title), h('div', { class: 'setting-desc' }, desc)), control);

function triStateSelect(ctx: RequestCtx, key: BoolSetting): HTMLElement {
  const s = ctx.draft.settings;
  const current = s[key] === undefined ? '' : String(s[key]);
  return selectEl([['', 'Use app default'], ['true', 'On'], ['false', 'Off']], current, (v) => {
    if (v === '') delete s[key]; else s[key] = v === 'true';
    ctx.dirty();
    ctx.refreshSubtabs();
  }, { style: { width: '160px' } });
}

export const settings: Panel = (ctx) => {
  const { draft } = ctx;
  const s = draft.settings;
  const desc = h('textarea', { class: 'textarea', placeholder: 'Describe this request (shown in exports and documentation)…' });
  desc.value = draft.description || '';
  desc.addEventListener('input', () => { draft.description = desc.value; ctx.dirty(); });
  const maxRedirects = h('input', { class: 'input', type: 'number', min: 0, value: s.maxRedirects === undefined ? '' : s.maxRedirects, oninput: (e: Event) => {
    const value = (e.target as HTMLInputElement).value;
    if (value === '') delete s.maxRedirects; else s.maxRedirects = Number(value);
    ctx.dirty();
    ctx.refreshSubtabs();
  } });
  ctx.body.appendChild(h('div', { class: 'settings-list' },
    h('div', null, h('div', { class: 'setting-title', style: { marginBottom: '6px' } }, 'Description'), desc),
    TRI_STATE_SETTINGS.map(([key, title, text]) => settingRow(title, text, triStateSelect(ctx, key))),
    settingRow('Maximum number of redirects', 'Leave empty to use the runtime default (10).', maxRedirects)));
};
