/**
 * Keyboard shortcuts and application-menu commands.
 */
import type { RequestTab } from '../../shared/types';
import { toast } from '../ui';
import { aboutDialog } from '../views/dialogs';
import { createCollection, saveRequestTab } from './collections';
import { createEnvironment } from './environments';
import { findCollection } from './lookups';
import { sendRequest, toggleConsole } from './runtime';
import { openExternal, showCookies, showImport, showSettings, toggleSidebar } from './shell';
import { app, GITHUB_URL } from './state';
import { activateTab, activeTab, closeTab, newRequest, openRunner, openWebSocket } from './tabs';

function cycleTab(direction: number): void {
  if (app.tabs.length < 2) return;
  const i = app.tabs.findIndex((t) => t.id === app.activeTabId);
  activateTab(app.tabs[(i + direction + app.tabs.length) % app.tabs.length].id);
}

function runCollectionForActiveTab(): void {
  const tab = activeTab();
  const fromTab = tab && 'collectionId' in tab && tab.collectionId ? findCollection(tab.collectionId) : null;
  const c = fromTab || app.state.collections[0];
  if (c) openRunner(c.info._postman_id);
  else toast('Create a collection first', 'warning');
}

const whenRequest = (fn: (tab: RequestTab) => void) => (): void => {
  const tab = activeTab();
  if (tab && tab.type === 'request') fn(tab);
};

const COMMANDS: Record<string, () => void> = {
  'new-request': () => { newRequest(); },
  'new-collection': () => { void createCollection(); },
  'new-environment': () => { void createEnvironment(); },
  'new-websocket': () => { openWebSocket(); },
  import: () => showImport(),
  save: whenRequest((tab) => { void saveRequestTab(tab); }),
  send: whenRequest((tab) => sendRequest(tab)),
  'close-tab': () => { const tab = activeTab(); if (tab) void closeTab(tab.id); },
  settings: () => showSettings(),
  'toggle-console': () => toggleConsole(),
  'toggle-sidebar': () => toggleSidebar(),
  runner: runCollectionForActiveTab,
  cookies: () => showCookies(),
  about: () => { void aboutDialog(); },
  github: () => openExternal(GITHUB_URL),
  'next-tab': () => cycleTab(1),
  'prev-tab': () => cycleTab(-1)
};

interface Shortcut { key: string; command: string; alt?: boolean; shift?: boolean }

/** Ctrl/Cmd + key -> command. Entries with `alt` or `shift` require that modifier too. */
const SHORTCUTS: Shortcut[] = [
  { key: 'enter', command: 'send' },
  { key: 's', command: 'save' },
  { key: 't', command: 'new-request' },
  { key: 'w', command: 'close-tab' },
  { key: 'c', alt: true, command: 'toggle-console' },
  { key: '\\', command: 'toggle-sidebar' },
  { key: ',', command: 'settings' },
  { key: 'o', command: 'import' },
  { key: 'tab', shift: true, command: 'prev-tab' },
  { key: 'tab', command: 'next-tab' }
];

function matchShortcut(e: KeyboardEvent): Shortcut | undefined {
  const key = e.key.toLowerCase();
  return SHORTCUTS.find((s) => s.key === key && !!s.alt === e.altKey && (s.shift ? e.shiftKey : key !== 'tab' || !e.shiftKey));
}

export function runCommand(name: string): void {
  const command = COMMANDS[name];
  if (command) command();
}

export function onKeyDown(e: KeyboardEvent): void {
  if (!(e.ctrlKey || e.metaKey)) return;
  const shortcut = matchShortcut(e);
  if (!shortcut) return;
  e.preventDefault();
  runCommand(shortcut.command);
}
