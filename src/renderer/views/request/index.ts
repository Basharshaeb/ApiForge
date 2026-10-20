/**
 * Request tab: header, URL bar, editor panels and the response viewer.
 */
import type { RequestSubtab, RequestTab } from '../../../shared/types';
import { clone, findNode, isBlankRow, METHODS, parseCurl, substitute, syncFromUrl } from '../../model';
import * as Codegen from '../../codegen';
import { append, clear, copyText, h, icon, iconButton, menu, repaintVarInputs, splitter, tabStrip, toast, varInput, type TabItem } from '../../ui';
import { findCollection, vars } from '../../app/lookups';
import { save } from '../../app/persistence';
import { abort, sendRequest } from '../../app/runtime';
import { saveAsExample, saveRequestTab } from '../../app/collections';
import { showCode } from '../../app/shell';
import { isDirty, markDirty, newRequest, openRunner } from '../../app/tabs';
import type { View } from '../types';
import { saveAs } from '../dialogs/save-as';
import type { Panel, RequestCtx } from './context';
import { auth } from './auth-panel';
import { body, headers, params, scripts, settings } from './panels';
import { downloadResponse, responseViewer } from './response-viewer';

const PANELS: Record<RequestSubtab, Panel> = { params, auth, headers, body, scripts, settings };
const REQUEST_TABS: Array<{ id: RequestSubtab; label: string }> = [
  { id: 'params', label: 'Params' }, { id: 'auth', label: 'Authorization' }, { id: 'headers', label: 'Headers' },
  { id: 'body', label: 'Body' }, { id: 'scripts', label: 'Scripts' }, { id: 'settings', label: 'Settings' }
];
const DEFAULT_PANE_HEIGHT = 300;
const MIN_PANE_HEIGHT = 120;

// Header --------------------------------------------------------------------
function breadcrumb(tab: RequestTab): HTMLElement | null {
  if (!tab.collectionId) return null;
  const c = findCollection(tab.collectionId);
  if (!c) return null;
  const hit = tab.itemId ? findNode(c, tab.itemId) : null;
  const crumbs = [c.info.name, ...(hit ? hit.ancestors.map((a) => a.name) : [])];
  return h('div', { class: 'breadcrumb' }, crumbs.flatMap((name, i) => [i ? h('span', { class: 'sep' }, '/') : null, h('span', { class: 'crumb' }, name)]), h('span', { class: 'sep' }, '/'));
}

function nameInput(ctx: RequestCtx): HTMLInputElement {
  const { draft } = ctx;
  const input = h('input', { class: 'title-input', value: draft.name, 'aria-label': 'Request name', spellcheck: false });
  const size = (): void => { input.style.width = `${Math.min(420, Math.max(100, input.value.length * 8 + 24))}px`; };
  input.addEventListener('input', () => { draft.name = input.value; ctx.dirty(); size(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  size();
  return input;
}

function headerMenu(ctx: RequestCtx): (e: MouseEvent) => void {
  const { tab, draft } = ctx;
  return (e) => menu(e.currentTarget as Element, [
    { label: 'Save As…', icon: 'save', onClick: () => { void saveAs(tab); } },
    { label: 'Duplicate Tab', icon: 'copy', onClick: () => { newRequest(clone(draft), { collectionId: tab.collectionId }); } },
    { label: 'Copy as cURL', icon: 'code', onClick: () => { void copyText(Codegen.generate('curl', draft, (s) => substitute(s, ctx.getVars()))); } },
    'separator',
    tab.collectionId ? { label: 'Run Collection', icon: 'runner', onClick: () => { openRunner(tab.collectionId as string); } } : null
  ], { alignRight: true });
}

function renderHeader(ctx: RequestCtx): void {
  const { tab, draft, header } = ctx;
  clear(header);
  ctx.saveBtn = h('button', { class: `btn btn-small ${isDirty(tab) ? 'btn-primary' : 'btn-secondary'}`, type: 'button', title: 'Save (Ctrl+S)', onclick: () => { void saveRequestTab(tab); } }, icon('save', 14), 'Save');
  append(header,
    breadcrumb(tab),
    nameInput(ctx),
    h('span', { class: 'spacer' }),
    h('button', { class: 'btn btn-small btn-secondary', type: 'button', title: 'Generate code snippet', onclick: () => showCode(draft, tab.collectionId) }, icon('code', 14), 'Code'),
    ctx.saveBtn,
    iconButton('more', 'More', headerMenu(ctx)));
}

// URL bar -------------------------------------------------------------------
const methodClass = (method: string): string => `select method-select m-${method.toLowerCase()}`;

/** Pasting a curl command into the URL bar imports it into the draft. */
function importCurl(ctx: RequestCtx, text: string): boolean {
  const parsed = parseCurl(text);
  if (!parsed) return false;
  const { draft } = ctx;
  Object.assign(draft, { method: parsed.method, url: parsed.url, params: parsed.params, pathVars: parsed.pathVars, headers: parsed.headers, body: parsed.body, auth: parsed.auth });
  ctx.methodSelect.value = draft.method;
  ctx.methodSelect.className = methodClass(draft.method);
  ctx.urlInput.setValue(draft.url);
  ctx.dirty();
  ctx.renderRequestBody();
  ctx.refreshSubtabs();
  toast('Imported cURL command', 'success');
  return true;
}

function onUrlInput(ctx: RequestCtx, value: string): void {
  if (/^\s*curl\s/i.test(value) && importCurl(ctx, value)) return;
  ctx.draft.url = value;
  syncFromUrl(ctx.draft);
  ctx.dirty();
  if (ctx.tab.subtab === 'params') ctx.renderRequestBody();
  ctx.refreshSubtabs();
}

async function sendAndDownload(tab: RequestTab): Promise<void> {
  sendRequest(tab);
  await new Promise<void>((resolve) => { const timer = setInterval(() => { if (!tab.running) { clearInterval(timer); resolve(); } }, 100); });
  if (tab.response) await downloadResponse(tab.response);
}

function buildUrlBar(ctx: RequestCtx): HTMLElement {
  const { tab, draft } = ctx;
  ctx.methodSelect = h('select', { class: methodClass(draft.method), 'aria-label': 'Method' }, METHODS.map((m) => h('option', { value: m, selected: m === draft.method }, m)));
  ctx.methodSelect.addEventListener('change', () => {
    draft.method = ctx.methodSelect.value;
    ctx.methodSelect.className = methodClass(draft.method);
    ctx.dirty();
    ctx.refreshSubtabs();
  });
  ctx.urlInput = varInput({
    value: draft.url, placeholder: 'Enter URL or paste text', className: 'lg boxed', getVars: ctx.getVars,
    onInput: (v) => onUrlInput(ctx, v),
    onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault(); sendRequest(tab); } }
  });
  ctx.sendBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => sendRequest(tab) }, 'Send');
  const sendMenu = h('button', { class: 'btn btn-primary', type: 'button', title: 'More send options', onclick: (e: MouseEvent) => menu(e.currentTarget as Element, [
    { label: 'Send', icon: 'send', shortcut: 'Ctrl+Enter', onClick: () => sendRequest(tab) },
    { label: 'Send and Download', icon: 'download', onClick: () => { void sendAndDownload(tab); } }
  ], { alignRight: true }) }, icon('chevron-down', 14));
  return h('div', { class: 'url-bar' }, ctx.methodSelect, ctx.urlInput, h('span', { class: 'btn-group' }, ctx.sendBtn, sendMenu));
}

function updateSendButton(ctx: RequestCtx): void {
  const running = !!ctx.tab.running;
  ctx.sendBtn.textContent = running ? 'Cancel' : 'Send';
  ctx.sendBtn.classList.toggle('btn-danger', running);
  ctx.sendBtn.classList.toggle('btn-primary', !running);
}

// Request pane ----------------------------------------------------------------
function subtabItems(ctx: RequestCtx): TabItem[] {
  const { draft } = ctx;
  const count = (rows: typeof draft.params): number => rows.filter((r) => r.enabled !== false && !isBlankRow(r)).length;
  const extras: Record<RequestSubtab, Partial<TabItem>> = {
    params: { badge: count(draft.params) + draft.pathVars.length || null },
    headers: { badge: count(draft.headers) || null },
    body: { dot: draft.body.mode !== 'none' },
    scripts: { dot: !!(draft.scripts.prerequest.trim() || draft.scripts.test.trim()) },
    auth: { dot: draft.auth.type !== 'inherit' && draft.auth.type !== 'noauth' },
    settings: { dot: Object.values(draft.settings || {}).some((v) => v !== undefined && (v as unknown) !== '') }
  };
  return REQUEST_TABS.map((t) => ({ ...t, ...extras[t.id] }));
}

function buildSubtabs(ctx: RequestCtx): HTMLElement {
  return tabStrip(subtabItems(ctx), ctx.tab.subtab, (id) => { ctx.tab.subtab = id as RequestSubtab; ctx.refreshSubtabs(); ctx.renderRequestBody(); save(); });
}

function buildRequestPane(ctx: RequestCtx): HTMLElement[] {
  ctx.subtabsEl = buildSubtabs(ctx);
  ctx.body = h('div', { class: 'pane-body' });
  const pane = h('div', { class: 'pane pane-request', style: { height: `${ctx.tab.reqPaneHeight || DEFAULT_PANE_HEIGHT}px` } }, ctx.subtabsEl, ctx.body);
  const handle = h('div', { class: 'splitter-y' });
  splitter<number>(handle, {
    axis: 'y',
    onStart: () => pane.offsetHeight,
    onMove: (dy, start) => { ctx.tab.reqPaneHeight = Math.max(MIN_PANE_HEIGHT, Math.min(ctx.el.offsetHeight - 160, start + dy)); pane.style.height = `${ctx.tab.reqPaneHeight}px`; },
    onEnd: () => save()
  });
  return [pane, handle];
}

// View ------------------------------------------------------------------------
export function requestView(tab: RequestTab): View {
  // The header/body elements are filled in by buildHeader/buildPanes below, before any panel runs.
  const ctx = {
    tab, draft: tab.draft, el: h('div', { class: 'view request-view' }), header: h('div', { class: 'view-header' }),
    getVars: () => vars(tab.collectionId), dirty: () => markDirty(tab)
  } as unknown as RequestCtx;
  ctx.refreshSubtabs = () => { const next = buildSubtabs(ctx); ctx.subtabsEl.replaceWith(next); ctx.subtabsEl = next; };
  ctx.renderRequestBody = () => {
    clear(ctx.body);
    ctx.body.className = 'pane-body';
    PANELS[tab.subtab](ctx);
  };
  const response = responseViewer(() => tab, {
    onSaveExample: () => { void saveAsExample(tab); },
    onCancel: () => { if (tab.running) abort(tab.running); },
    onTabChange: () => save()
  });

  renderHeader(ctx);
  ctx.el.append(ctx.header, buildUrlBar(ctx), ...buildRequestPane(ctx), response);
  ctx.renderRequestBody();
  response.render();

  return {
    el: ctx.el,
    markDirty() {
      const dirty = isDirty(tab);
      ctx.saveBtn.classList.toggle('btn-primary', dirty);
      ctx.saveBtn.classList.toggle('btn-secondary', !dirty);
    },
    update() {
      renderHeader(ctx);
      response.render();
      repaintVarInputs(ctx.el);
      updateSendButton(ctx);
      if (ctx.urlInput.input.value !== ctx.draft.url) ctx.urlInput.setValue(ctx.draft.url);
    },
    focus() {
      if (!ctx.draft.url) ctx.urlInput.input.focus();
    }
  };
}
