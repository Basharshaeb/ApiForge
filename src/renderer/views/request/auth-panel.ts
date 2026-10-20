/**
 * Authorization panel for request tabs, including the OAuth 2.0 token fetch.
 */
import type { AuthJson, CollectionJson, RequestTab } from '../../../shared/types';
import { AUTH_BY_TYPE, AUTH_TYPES, defaultAuthParams, findNode, SCHEMA_V21, substitute, type AuthField } from '../../model';
import { h, icon, iconButton, selectEl, toast, toggle, varInput, type VarInput } from '../../ui';
import { findCollection } from '../../app/lookups';
import { runAdhoc } from '../../app/runtime';
import type { Panel, RequestCtx } from './context';

interface Inherited { from: string; auth: AuthJson }

/** Nearest folder/collection auth that an inheriting request would use. */
function inheritedAuth(tab: RequestTab): Inherited | null {
  const c: CollectionJson | null = tab.collectionId ? findCollection(tab.collectionId) : null;
  if (!c) return null;
  const hit = tab.itemId ? findNode(c, tab.itemId) : null;
  const folder = (hit ? hit.ancestors : []).slice().reverse().find((f) => f.auth && f.auth.type);
  if (folder && folder.auth) return { from: folder.name, auth: folder.auth };
  return c.auth && c.auth.type ? { from: c.info.name, auth: c.auth } : null;
}

function inheritNotice(tab: RequestTab): HTMLElement {
  const inh = inheritedAuth(tab);
  const label = inh ? (AUTH_BY_TYPE[inh.auth.type] || { label: inh.auth.type }).label : 'No Auth';
  return h('div', { class: 'auth-inherit' }, icon('info', 16), h('div', null, `This request is using ${label}`, inh ? ` from ${inh.from}.` : ' (nothing to inherit from).', h('br'), 'Choose a different type above to override it.'));
}

/** `when: { field: value }` hides a field unless another field has that value. */
function fieldVisible(field: AuthField, type: string, params: Record<string, unknown>): boolean {
  if (!field.when) return true;
  const defaults = defaultAuthParams(type);
  return Object.entries(field.when).every(([k, v]) => (params[k] === undefined ? defaults[k] : params[k]) === v);
}

function secretInput(input: VarInput): HTMLElement {
  input.setMasked(true);
  const eye = iconButton('eye', 'Show', (e) => {
    const masked = input.input.type === 'password';
    input.setMasked(!masked);
    (e.currentTarget as HTMLElement).replaceChildren(icon(masked ? 'eye-off' : 'eye'));
  });
  return h('div', { class: 'kv-secret' }, input, eye);
}

function fieldControl(field: AuthField, params: Record<string, unknown>, ctx: RequestCtx): HTMLElement {
  const value = params[field.key] === undefined ? (field.default === undefined ? '' : field.default) : params[field.key];
  const set = (v: unknown): void => { params[field.key] = v; ctx.dirty(); };
  switch (field.input) {
    case 'select': return selectEl(field.options || [], String(value), (v) => { set(v); ctx.renderRequestBody(); });
    case 'bool': return toggle(field.label, !!value, set);
    case 'textarea': return varInput({ value, getVars: ctx.getVars, multiline: true, className: 'boxed', onInput: set });
    case 'secret': return secretInput(varInput({ value, getVars: ctx.getVars, className: 'boxed', onInput: set }));
    default: return varInput({ value, getVars: ctx.getVars, className: 'boxed', onInput: set });
  }
}

function fieldEl(field: AuthField, params: Record<string, unknown>, ctx: RequestCtx): HTMLElement {
  const control = fieldControl(field, params, ctx);
  if (field.input === 'bool') return h('div', { class: 'field' }, control);
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, field.label), control);
}

function typedFields(ctx: RequestCtx): HTMLElement {
  const { type, params } = ctx.draft.auth;
  const schema = AUTH_BY_TYPE[type];
  const groups = { main: h('div'), advanced: h('div'), token: h('div') };
  schema.fields.filter((f) => fieldVisible(f, type, params)).forEach((f) => {
    const group = f.section === 'token' ? groups.token : f.advanced ? groups.advanced : groups.main;
    group.appendChild(fieldEl(f, params, ctx));
  });
  const container = h('div', null, groups.main);
  if (type === 'oauth2') {
    container.append(h('h3', { style: { fontSize: '13px', margin: '14px 0 8px' } }, 'Configure New Token'), groups.token,
      h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => { void fetchOAuthToken(ctx); } }, 'Get New Access Token'));
  }
  if (groups.advanced.childElementCount) container.appendChild(h('details', { class: 'advanced' }, h('summary', null, 'Advanced'), groups.advanced));
  return container;
}

function authFields(ctx: RequestCtx): HTMLElement {
  const { type } = ctx.draft.auth;
  if (type === 'inherit') return inheritNotice(ctx.tab);
  if (type === 'noauth') return h('div', { class: 'auth-inherit' }, icon('info', 16), h('div', null, 'This request does not use any authorization.'));
  return AUTH_BY_TYPE[type] ? typedFields(ctx) : h('div');
}

// OAuth 2.0 ------------------------------------------------------------------
type Sub = (s: unknown) => string;

function tokenRequest(p: Record<string, unknown>, sub: Sub): CollectionJson {
  const grant = p.grant_type === 'password_credentials' ? 'password' : 'client_credentials';
  const body: Array<[string, string]> = [['grant_type', grant]];
  if (grant === 'password') body.push(['username', sub(p.username)], ['password', sub(p.password)]);
  if (p.scope) body.push(['scope', sub(p.scope)]);
  const headers = [{ key: 'Accept', value: 'application/json' }];
  if (p.client_authentication === 'body') body.push(['client_id', sub(p.clientId)], ['client_secret', sub(p.clientSecret)]);
  else headers.push({ key: 'Authorization', value: `Basic ${btoa(unescape(encodeURIComponent(`${sub(p.clientId)}:${sub(p.clientSecret)}`)))}` });
  return {
    info: { _postman_id: 'oauth2-token', name: 'OAuth2 token', schema: SCHEMA_V21 },
    item: [{ id: 'token', name: 'token', request: { method: 'POST', url: sub(p.accessTokenUrl), header: headers, body: { mode: 'urlencoded', urlencoded: body.map(([key, value]) => ({ key, value })) } } }]
  };
}

function parseToken(request: Awaited<ReturnType<typeof runAdhoc>>['request']): string {
  if (!request || !request.response) throw new Error(`Token request failed: ${request && request.error ? request.error.message : 'no response'}`);
  let json: { access_token?: string } | null = null;
  try { json = JSON.parse(request.response.body || '') as { access_token?: string }; } catch { /* not json */ }
  if (!json || !json.access_token) throw new Error(`Token endpoint returned ${request.response.code} without an access_token`);
  return json.access_token;
}

async function fetchOAuthToken(ctx: RequestCtx): Promise<void> {
  const p = { ...defaultAuthParams('oauth2'), ...ctx.draft.auth.params };
  if (!p.accessTokenUrl) return toast('Enter an Access Token URL first', 'warning');
  const sub: Sub = (s) => substitute(String(s || ''), ctx.getVars());
  toast('Requesting token…');
  try {
    const { request } = await runAdhoc(tokenRequest(p, sub));
    ctx.draft.auth.params.accessToken = parseToken(request);
    ctx.dirty();
    ctx.renderRequestBody();
    toast('Access token received', 'success');
  } catch (err) {
    toast((err as Error).message, 'error');
  }
}

// Panel ----------------------------------------------------------------------
export const auth: Panel = (ctx) => {
  const { draft } = ctx;
  const typeSelect = selectEl(AUTH_TYPES.map((a) => [a.type, a.label] as const), draft.auth.type, (v) => {
    draft.auth = { type: v, params: { ...defaultAuthParams(v), ...(draft.auth.type === v ? draft.auth.params : {}) } };
    ctx.dirty();
    ctx.refreshSubtabs();
    ctx.renderRequestBody();
  }, { style: { width: '260px' } });
  ctx.body.appendChild(h('div', { class: 'auth-form' }, h('div', { class: 'auth-layout' },
    h('div', null, h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Auth Type'), typeSelect),
      h('div', { class: 'field-help' }, 'The authorization header will be automatically generated when you send the request. Values can reference variables, e.g. {{token}}.')),
    authFields(ctx))));
};
