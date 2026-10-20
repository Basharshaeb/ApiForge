/**
 * Renderer entry point: load state, restore UI, build the shell and wire
 * bridge events. Also exposes a debug surface (window.ApiForge) that the
 * smoke test drives.
 */
import type { SidebarSection, Tab, UiState } from '../shared/types';
import * as App from './app';
import { app } from './app/state';
import * as Model from './model';
import * as UI from './ui';
import * as dialogs from './views/dialogs';

const SECTIONS: SidebarSection[] = ['collections', 'environments', 'history'];

type DebugSurface = typeof App & { app: typeof app; Model: typeof Model; UI: typeof UI; Views: { dialogs: typeof dialogs } };

declare global {
  interface Window { ApiForge: DebugSurface }
}

function restoreUiState(ui: Partial<UiState>): void {
  app.sidebar.section = ui.sidebar && SECTIONS.includes(ui.sidebar) ? ui.sidebar : 'collections';
  app.sidebar.width = ui.sidebarWidth || 300;
  app.sidebar.collapsed = !!ui.sidebarCollapsed;
  app.expanded = new Set(ui.expanded || []);
  app.consoleHeight = ui.consoleHeight || 260;
  app.tabs = (ui.tabs || []).map(App.reviveTab).filter((t): t is Tab => t !== null);
  const activeStillOpen = app.tabs.some((t) => t.id === ui.activeTabId);
  app.activeTabId = activeStillOpen ? ui.activeTabId ?? null : (app.tabs[0] ? app.tabs[0].id : null);
}

function wireEvents(): void {
  window.apiforge.runtime.onEvent(App.onRuntimeEvent);
  window.apiforge.app.onMenuCommand(App.runCommand);
  document.addEventListener('keydown', App.onKeyDown);
  window.addEventListener('beforeunload', () => { void App.persist(); });
}

async function init(): Promise<void> {
  app.state = await window.apiforge.store.load();
  restoreUiState(app.state.ui || {});
  if (!App.findEnvironment(app.state.settings.activeEnvironmentId)) app.state.settings.activeEnvironmentId = null;
  App.applyTheme(app.state.settings.theme);
  App.buildShell();
  wireEvents();
  App.renderTabbar();
  App.mountActive();
}

window.ApiForge = { ...App, app, Model, UI, Views: { dialogs } };

init().catch((err: Error) => {
  console.error(err);
  document.body.appendChild(UI.h('pre', { style: { padding: '20px', color: 'red' } }, `ApiForge failed to start: ${err.stack || err.message}`));
});
