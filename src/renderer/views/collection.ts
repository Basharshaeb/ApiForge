/**
 * Collection / folder editor: overview, authorization, scripts, variables.
 */
import type { AuthDraft, CollectionJson, CollectionSubtab, CollectionTab, FolderJson, NodeHitAncestors, Row, VariableMap } from './collection-types';
import * as M from '../model';
import { append, clear, codeEditor, emptyState, h, icon, iconButton, kvEditor, menu, selectEl, tabStrip, toggle, varInput } from '../ui';
import * as App from '../app';
import type { View } from './types';

const SIDEBAR_REFRESH_MS = 600;

// Auth editor (no inherit-from-request logic, no OAuth fetch) ----------------
export interface AuthEditorOptions { auth: AuthDraft; getVars: () => VariableMap; onChange: () => void; allowInherit: boolean }

function authField(field: M.AuthField, auth: AuthDraft, options: AuthEditorOptions, rerender: () => void): HTMLElement {
  const value = auth.params[field.key] === undefined ? (field.default === undefined ? '' : field.default) : auth.params[field.key];
  const set = (v: unknown): void => { auth.params[field.key] = v; options.onChange(); };
  if (field.input === 'bool') return h('div', { class: 'field' }, toggle(field.label, !!value, set));
  let input: HTMLElement;
  if (field.input === 'select') input = selectEl(field.options || [], String(value), (v) => { set(v); rerender(); });
  else if (field.input === 'textarea') input = varInput({ value, getVars: options.getVars, multiline: true, className: 'boxed', onInput: set });
  else {
    const control = varInput({ value, getVars: options.getVars, className: 'boxed', onInput: set });
    if (field.input === 'secret') control.setMasked(true);
    input = control;
  }
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, field.label), input);
}

function visibleFields(auth: AuthDraft): M.AuthField[] {
  const schema = M.AUTH_BY_TYPE[auth.type];
  const defaults = M.defaultAuthParams(auth.type);
  return schema.fields.filter((f) => !f.when || Object.entries(f.when).every(([k, v]) => (auth.params[k] === undefined ? defaults[k] : auth.params[k]) === v));
}

function authFields(options: AuthEditorOptions, rerender: () => void): HTMLElement {
  const { auth } = options;
  if (auth.type === 'inherit') return h('div', { class: 'auth-inherit' }, icon('info', 16), 'Requests in this folder inherit the collection authorization unless they override it.');
  if (auth.type === 'noauth') return h('div', { class: 'auth-inherit' }, icon('info', 16), 'Requests inheriting from here will not use authorization.');
  if (!M.AUTH_BY_TYPE[auth.type]) return h('div');
  const main = h('div');
  const advanced = h('div');
  visibleFields(auth).forEach((f) => (f.advanced ? advanced : main).appendChild(authField(f, auth, options, rerender)));
  if (advanced.childElementCount) main.appendChild(h('details', { class: 'advanced' }, h('summary', null, 'Advanced'), advanced));
  return main;
}

/** Compact auth editor shared by collections and folders. */
export function authEditor(options: AuthEditorOptions): HTMLElement {
  const { auth } = options;
  const wrap = h('div', { class: 'auth-form' });
  const types = M.AUTH_TYPES.filter((a) => options.allowInherit || a.type !== 'inherit');
  function render(): void {
    clear(wrap);
    const select = selectEl(types.map((a) => [a.type, a.label] as const), auth.type, (v) => { auth.type = v; auth.params = { ...M.defaultAuthParams(v) }; options.onChange(); render(); }, { style: { width: '260px' } });
    wrap.appendChild(h('div', { class: 'auth-layout' },
      h('div', null, h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Auth Type'), select)),
      authFields(options, render)));
  }
  render();
  return wrap;
}

// Sections --------------------------------------------------------------------
interface Ctx {
  tab: CollectionTab;
  c: CollectionJson;
  node: FolderJson | null;
  ancestors: NodeHitAncestors;
  target: CollectionJson | FolderJson;
  getVars(): VariableMap;
  save(): void;
  refreshSidebar(): void;
  render(): void;
}

function countFolders(nodes: M.TreeLike['item']): number {
  let n = 0;
  M.walk(nodes, (x) => { if (M.isFolder(x)) n++; });
  return n;
}

const descriptionOf = (ctx: Ctx): string => (ctx.node ? M.textOf(ctx.node.description) : M.textOf(ctx.c.info.description));

function overviewSection(ctx: Ctx): HTMLElement[] {
  const desc = h('textarea', { class: 'textarea', placeholder: `Describe what this ${ctx.node ? 'folder' : 'collection'} is for…` });
  desc.value = descriptionOf(ctx);
  desc.addEventListener('input', () => { if (ctx.node) ctx.node.description = desc.value; else ctx.c.info.description = desc.value; ctx.save(); });
  return [h('h3', null, 'Description'), desc, h('h3', null, 'Contents'), h('div', { class: 'doc-note' }, `${M.countRequests(ctx.target.item)} requests · ${countFolders(ctx.target.item)} folders`)];
}

function authSection(ctx: Ctx): HTMLElement[] {
  const { node, target } = ctx;
  const auth = M.authFromV2(target.auth);
  if (!node && auth.type === 'inherit') auth.type = 'noauth';
  const note = node ? 'Requests in this folder use this authorization unless they set their own.' : 'Requests in this collection use this authorization unless a folder or the request overrides it.';
  const onChange = (): void => { const v2 = M.authToV2(auth); if (v2) target.auth = v2; else delete target.auth; ctx.save(); };
  return [h('div', { class: 'doc-note' }, note), authEditor({ auth, getVars: ctx.getVars, allowInherit: !!node, onChange })];
}

function scriptsSection(ctx: Ctx): HTMLElement[] {
  const { tab, node, target } = ctx;
  const current = tab.scriptTab || 'prerequest';
  tab.scriptTab = current;
  const scripts = M.scriptsFromEvents(target.event);
  const scope = node ? 'folder' : 'collection';
  const placeholder = current === 'prerequest' ? `// Runs before every request in this ${scope}` : `// Runs after every response in this ${scope}`;
  const editor = codeEditor({ value: scripts[current], language: 'javascript', minHeight: 260, placeholder, onInput: (v) => {
    scripts[current] = v;
    const events = M.eventsFromScripts(scripts, target.event);
    if (events.length) target.event = events; else delete target.event;
    ctx.save();
  } });
  const pills = tabStrip([{ id: 'prerequest', label: 'Pre-request' }, { id: 'test', label: 'Post-response' }], current, (id) => { tab.scriptTab = id as 'prerequest' | 'test'; ctx.render(); }, 'pill');
  return [
    h('div', { class: 'pane-toolbar sub', style: { padding: 0, background: 'transparent', border: 'none' } }, pills),
    h('div', { class: 'doc-note' }, "These scripts run for every request inside, before the request's own scripts."),
    h('div', { style: { height: '320px', display: 'flex' } }, editor)
  ];
}

function variablesSection(ctx: Ctx): HTMLElement[] {
  const { c } = ctx;
  const rows: Row[] = (c.variable || []).map((v) => M.row(v.key || '', v.value == null ? '' : String(v.value), !v.disabled, { type: v.type === 'secret' ? 'secret' : 'default' }));
  const onChange = (): void => {
    c.variable = rows.filter((r) => r.key).map((r) => ({ key: r.key, value: r.value, type: r.type === 'secret' ? 'secret' : 'string', ...(r.enabled === false ? { disabled: true } : {}) }));
    ctx.save();
  };
  return [
    h('div', { class: 'doc-note' }, 'Collection variables are available to every request in this collection and override globals. Environment variables with the same name take precedence.'),
    kvEditor({ rows, types: true, keyPlaceholder: 'Variable', valuePlaceholder: 'Value', onChange })
  ];
}

const SECTIONS: Record<CollectionSubtab, (ctx: Ctx) => HTMLElement[]> = { overview: overviewSection, auth: authSection, scripts: scriptsSection, variables: variablesSection };

// Header ------------------------------------------------------------------------
function headerEl(ctx: Ctx): HTMLElement {
  const { tab, c, node, ancestors } = ctx;
  const name = h('input', { class: 'title-input', value: node ? node.name : c.info.name, spellcheck: false, 'aria-label': 'Name' });
  name.addEventListener('input', () => { if (node) node.name = name.value; else c.info.name = name.value; ctx.save(); App.notify({ tabbar: true }); ctx.refreshSidebar(); });
  const crumbs = node ? [c.info.name, ...ancestors.map((a) => a.name)] : [];
  const nodeId = node ? node.id : null;
  return append(h('div', { class: 'view-header' }),
    icon(node ? 'folder' : 'collections', 16),
    crumbs.length ? h('div', { class: 'breadcrumb' }, crumbs.flatMap((x, i) => [i ? h('span', { class: 'sep' }, '/') : null, h('span', { class: 'crumb' }, x)]), h('span', { class: 'sep' }, '/')) : null,
    name,
    h('span', { class: 'spacer' }),
    h('button', { class: 'btn btn-small btn-secondary', type: 'button', onclick: () => { App.openRunner(tab.collectionId, nodeId || ''); } }, icon('runner', 14), 'Run'),
    h('button', { class: 'btn btn-small btn-secondary', type: 'button', onclick: () => App.addRequest(tab.collectionId, nodeId) }, icon('plus', 14), 'Add request'),
    iconButton('more', 'More', (e) => menu(e.currentTarget as Element, [
      { label: 'Add Folder', icon: 'folder', onClick: () => { void App.addFolder(tab.collectionId, nodeId); } },
      node ? null : { label: 'Export', icon: 'download', onClick: () => { void App.exportCollection(c); } },
      'separator',
      { label: 'Delete', icon: 'trash', danger: true, onClick: () => { void (node ? App.deleteNode(tab.collectionId, node.id) : App.deleteCollection(c)); } }
    ], { alignRight: true })));
}

function resolveContext(tab: CollectionTab, extras: Pick<Ctx, 'refreshSidebar' | 'render'>): Ctx | HTMLElement {
  const c = App.findCollection(tab.collectionId);
  if (!c) return emptyState('collections', 'Collection not found', 'It may have been deleted.');
  const hit = tab.nodeId ? M.findNode(c, tab.nodeId) : null;
  if (tab.nodeId && (!hit || !M.isFolder(hit.node))) return emptyState('folder', 'Folder not found', 'It may have been deleted.');
  const node = hit && M.isFolder(hit.node) ? hit.node : null;
  return { tab, c, node, ancestors: hit ? hit.ancestors : [], target: node || c, getVars: () => App.vars(tab.collectionId), save: () => App.save(), ...extras };
}

export function collectionView(tab: CollectionTab): View {
  const el = h('div', { class: 'view' });
  let sidebarTimer: ReturnType<typeof setTimeout> | null = null;
  const refreshSidebar = (): void => { if (sidebarTimer) clearTimeout(sidebarTimer); sidebarTimer = setTimeout(() => App.renderSidebar(), SIDEBAR_REFRESH_MS); };

  function render(): void {
    clear(el);
    const ctx = resolveContext(tab, { refreshSidebar, render });
    if (ctx instanceof HTMLElement) { el.appendChild(ctx); return; }
    const tabs = [{ id: 'overview', label: 'Overview' }, { id: 'auth', label: 'Authorization' }, { id: 'scripts', label: 'Scripts' }];
    if (!ctx.node) tabs.push({ id: 'variables', label: 'Variables', badge: (ctx.c.variable || []).filter((v) => v.key).length || null } as { id: string; label: string });
    const section = SECTIONS[tab.subtab] || SECTIONS.overview;
    el.append(headerEl(ctx), tabStrip(tabs, tab.subtab, (id) => { tab.subtab = id as CollectionSubtab; App.save(); render(); }), h('div', { class: 'doc-view' }, ...section(ctx)));
  }

  render();
  return { el, update: render };
}
