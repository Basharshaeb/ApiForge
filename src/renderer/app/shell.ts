/**
 * Shell layout: top bar, rail, sidebar, tab bar, tab content, console panel
 * and status bar. Also the theme and dialog entry points.
 */
import type { Draft, SidebarSection, Tab, Theme } from '../../shared/types';
import { clone } from '../model';
import { clear, h, icon, iconButton, menu, methodBadge, splitter } from '../ui';
import type { View } from '../views/types';
import { createView } from '../views';
import { renderSidebarView } from '../views/sidebar';
import { createConsoleView } from '../views/console';
import { aboutDialog, codeDialog, cookiesDialog, envQuickLook, importDialog, settingsDialog } from '../views/dialogs';
import { createCollection } from './collections';
import { setActiveEnvironment } from './environments';
import { vars } from './lookups';
import { save } from './persistence';
import { app, GITHUB_URL, type ShellElements } from './state';
import { activateTab, activeTab, closeAllTabs, closeOtherTabs, closeTab, isDirty, newRequest, openWebSocket, tabTitle } from './tabs';
import { toggleConsole } from './runtime';

const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 600;
const CONSOLE_MIN = 120;
const RAIL_SECTIONS: Array<[SidebarSection, string]> = [['collections', 'Collections'], ['environments', 'Environments'], ['history', 'History']];

// Theme & dialogs ---------------------------------------------------------
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark';
  void window.apiforge.app.setTheme(theme);
}

export function setTheme(theme: Theme): void {
  app.state.settings.theme = theme;
  applyTheme(theme);
  save();
  renderStatusbar();
}

export const showImport = (): void => importDialog();
export const showSettings = (): void => { void settingsDialog(); };
export const showCookies = (): void => { cookiesDialog(); };
export const showCode = (draft: Draft, collectionId: string | null): void => codeDialog(draft, vars(collectionId));
export const showEnvQuickLook = (): void => envQuickLook();
export const openExternal = (url: string): void => { void window.apiforge.app.openExternal(url); };
export const pickFile = async (): Promise<string | null> => (await window.apiforge.files.pickPath({ title: 'Select file' }))[0] || null;

// Top bar ---------------------------------------------------------------------
function buildTopbar(els: ShellElements): HTMLElement {
  els.envSelect = h('select', { class: 'select env-select', 'aria-label': 'Active environment', onchange: (e: Event) => setActiveEnvironment((e.target as HTMLSelectElement).value || null) });
  return h('div', { class: 'topbar' },
    h('div', { class: 'brand' }, h('img', { class: 'brand-img', src: '../../../assets/icon-64.png', alt: '' }), 'ApiForge'),
    h('button', { class: 'btn btn-small btn-ghost', type: 'button', onclick: () => newRequest() }, icon('plus', 14), 'New'),
    h('button', { class: 'btn btn-small btn-ghost', type: 'button', onclick: showImport }, icon('import', 14), 'Import'),
    h('span', { class: 'spacer' }),
    els.envSelect,
    iconButton('eye', 'Environment quick look', showEnvQuickLook),
    iconButton('cookie', 'Cookies', showCookies),
    iconButton('settings', 'Settings', showSettings));
}

export function renderEnvSelect(): void {
  const sel = app.els.envSelect;
  clear(sel);
  sel.appendChild(h('option', { value: '' }, 'No Environment'));
  app.state.environments.forEach((env) => sel.appendChild(h('option', { value: env.id, selected: env.id === app.state.settings.activeEnvironmentId }, env.name)));
  sel.value = app.state.settings.activeEnvironmentId || '';
}

// Rail & sidebar ------------------------------------------------------------
function renderRail(): void {
  clear(app.els.rail);
  RAIL_SECTIONS.forEach(([id, label]) => {
    const active = app.sidebar.section === id && !app.sidebar.collapsed;
    app.els.rail.appendChild(h('button', { class: `rail-btn${active ? ' active' : ''}`, type: 'button', title: label, onclick: () => selectSidebar(id) }, icon(id, 18), label));
  });
}

function applySidebarVisibility(): void {
  app.els.sidebar.classList.toggle('collapsed', app.sidebar.collapsed);
  app.els.sidebarSplitter.classList.toggle('hidden', app.sidebar.collapsed);
  renderRail();
  save();
}

export function selectSidebar(section: SidebarSection): void {
  if (app.sidebar.section === section && !app.sidebar.collapsed) app.sidebar.collapsed = true;
  else Object.assign(app.sidebar, { section, collapsed: false });
  applySidebarVisibility();
  renderSidebar();
}

export function toggleSidebar(): void {
  app.sidebar.collapsed = !app.sidebar.collapsed;
  applySidebarVisibility();
}

export const renderSidebar = (): void => renderSidebarView(app.els.sidebar);

function installSidebarSplitter(els: ShellElements): void {
  splitter<number>(els.sidebarSplitter, {
    axis: 'x',
    onStart: () => app.sidebar.width,
    onMove: (dx, start) => { app.sidebar.width = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, start + dx)); els.sidebar.style.width = `${app.sidebar.width}px`; },
    onEnd: () => save()
  });
}

// Tab bar -----------------------------------------------------------------------
function tabIcon(tab: Tab): HTMLElement {
  switch (tab.type) {
    case 'request': return methodBadge(tab.draft.method, true);
    case 'example': return icon('example', 14);
    case 'websocket': return h('span', { class: 'method method-ws small' }, 'WS');
    case 'environment': return icon(tab.envId === 'globals' ? 'globe' : 'environments', 14);
    case 'collection': return icon(tab.nodeId ? 'folder' : 'collections', 14);
    case 'runner': return icon('runner', 14);
    default: return h('span');
  }
}

function tabContextMenu(tab: Tab, e: MouseEvent): void {
  e.preventDefault();
  menu(null, [
    { label: 'Close', shortcut: 'Ctrl+W', onClick: () => { void closeTab(tab.id); } },
    { label: 'Close Others', onClick: () => { void closeOtherTabs(tab.id); } },
    { label: 'Close All', onClick: () => { void closeAllTabs(); } },
    'separator',
    tab.type === 'request' ? { label: 'Duplicate Tab', onClick: () => { newRequest(clone(tab.draft), { collectionId: tab.collectionId }); } } : null
  ], { point: { x: e.clientX, y: e.clientY } });
}

function buildTabEl(tab: Tab): HTMLElement {
  const title = tabTitle(tab);
  return h('div', {
    class: `tab${tab.id === app.activeTabId ? ' active' : ''}${isDirty(tab) ? ' dirty' : ''}`,
    dataset: { id: tab.id },
    title,
    onclick: () => activateTab(tab.id),
    onauxclick: (e: MouseEvent) => { if (e.button === 1) { e.preventDefault(); void closeTab(tab.id); } },
    oncontextmenu: (e: MouseEvent) => tabContextMenu(tab, e)
  },
  tabIcon(tab),
  h('span', { class: 'tab-title' }, title),
  h('button', { class: 'tab-close', type: 'button', title: 'Close tab', onclick: (e: Event) => { e.stopPropagation(); void closeTab(tab.id); } }, icon('x', 12)));
}

export function renderTabbarItem(tab: Tab): void {
  const existing = app.els.tabbar.querySelector(`.tab[data-id="${tab.id}"]`);
  if (existing) existing.replaceWith(buildTabEl(tab));
  else renderTabbar();
}

function tabbarActions(): HTMLElement {
  return h('div', { class: 'tabbar-actions' },
    iconButton('plus', 'New request (Ctrl+T)', () => newRequest()),
    iconButton('more', 'More', (e) => menu(e.currentTarget as Element, [
      { label: 'New HTTP Request', icon: 'send', onClick: () => { newRequest(); } },
      { label: 'New WebSocket Request', icon: 'plug', onClick: () => { openWebSocket(); } },
      'separator',
      { label: 'Close All Tabs', onClick: () => { void closeAllTabs(); } }
    ], { alignRight: true })));
}

export function renderTabbar(): void {
  const bar = app.els.tabbar;
  clear(bar);
  const scroll = h('div', { class: 'tabbar-scroll' }, app.tabs.map(buildTabEl));
  bar.append(scroll, tabbarActions());
  const active = scroll.querySelector('.tab.active');
  if (active) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

// Tab content --------------------------------------------------------------------
function viewFor(tab: Tab): View {
  let view = app.views.get(tab.id);
  if (!view) {
    view = createView(tab);
    app.views.set(tab.id, view);
  }
  return view;
}

function welcome(): HTMLElement {
  const card = (ic: string, title: string, text: string, onClick: () => void): HTMLElement =>
    h('button', { class: 'welcome-btn', type: 'button', onclick: onClick }, icon(ic, 20), h('b', null, title), h('span', null, text));
  return h('div', { class: 'welcome' }, h('div', { class: 'welcome-card' },
    card('send', 'HTTP Request', 'Create a basic HTTP request', () => { newRequest(); }),
    card('plug', 'WebSocket', 'Connect to a WebSocket server', () => { openWebSocket(); }),
    card('collections', 'Collection', 'Group related requests', () => { void createCollection(); }),
    card('import', 'Import', 'Postman, OpenAPI or cURL', showImport)));
}

export function mountActive(): void {
  const host = app.els.tabContent;
  clear(host);
  const tab = activeTab();
  if (!tab) { host.appendChild(welcome()); return; }
  const view = viewFor(tab);
  host.appendChild(view.el);
  if (view.stale !== false) { view.update(); view.stale = false; }
  if (view.focus) view.focus();
}

// Console & status bar ---------------------------------------------------------
export function renderConsole(): void {
  const host = app.els.consoleHost;
  clear(host);
  if (!app.consoleOpen) return;
  if (!app.consoleView) app.consoleView = createConsoleView();
  const consoleView = app.consoleView;
  const handle = h('div', { class: 'splitter-y' });
  splitter<number>(handle, {
    axis: 'y',
    onStart: () => app.consoleHeight,
    onMove: (dy, start) => { app.consoleHeight = Math.max(CONSOLE_MIN, Math.min(window.innerHeight - 200, start - dy)); consoleView.el.style.height = `${app.consoleHeight}px`; },
    onEnd: () => save()
  });
  consoleView.el.style.height = `${app.consoleHeight}px`;
  host.append(handle, consoleView.el);
  consoleView.update();
}

function consoleBadge(): HTMLElement | null {
  if (!app.consoleEntries.length) return null;
  const errors = app.consoleEntries.filter((e) => e.type === 'error').length;
  return h('span', { class: `badge${errors ? ' fail' : ''}` }, errors || app.consoleEntries.length);
}

export function renderStatusbar(): void {
  const bar = app.els.statusbar;
  if (!bar) return;
  clear(bar);
  const light = app.state.settings.theme === 'light';
  bar.append(
    h('button', { class: `statusbar-btn${app.consoleOpen ? ' active' : ''}`, type: 'button', onclick: () => toggleConsole() }, icon('terminal', 13), 'Console', consoleBadge()),
    h('button', { class: 'statusbar-btn', type: 'button', onclick: showCookies }, icon('cookie', 13), 'Cookies'),
    h('span', { class: 'spacer' }),
    h('button', { class: 'statusbar-btn', type: 'button', title: 'Toggle theme', onclick: () => setTheme(light ? 'dark' : 'light') }, icon(light ? 'moon' : 'sun', 13)),
    h('button', { class: 'statusbar-btn', type: 'button', title: GITHUB_URL, onclick: () => openExternal(GITHUB_URL) }, icon('github', 13), 'GitHub'),
    h('button', { class: 'statusbar-btn', type: 'button', onclick: () => { void aboutDialog(); } }, icon('info', 13), 'About'));
}

// Assembly ------------------------------------------------------------------------
export function buildShell(): void {
  const els = app.els;
  const appEl = clear(document.getElementById('app') as HTMLElement);
  els.topbar = buildTopbar(els);
  els.rail = h('div', { class: 'rail' });
  els.sidebar = h('div', { class: 'sidebar', style: { width: `${app.sidebar.width}px` } });
  els.sidebarSplitter = h('div', { class: 'splitter-x' });
  els.tabbar = h('div', { class: 'tabbar' });
  els.tabContent = h('div', { class: 'tab-content' });
  els.consoleHost = h('div', { style: { display: 'contents' } });
  els.content = h('div', { class: 'content' }, els.tabbar, els.tabContent, els.consoleHost);
  els.main = h('div', { class: 'main' }, els.rail, els.sidebar, els.sidebarSplitter, els.content);
  els.statusbar = h('div', { class: 'statusbar' });
  appEl.append(els.topbar, els.main, els.statusbar);
  installSidebarSplitter(els);
  applySidebarVisibility();
  renderSidebar();
  renderEnvSelect();
  renderConsole();
  renderStatusbar();
}
