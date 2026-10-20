/**
 * Mutable application runtime state (one instance per window).
 */
import type { ConsoleEntry, RendererState, SidebarSection, Tab } from '../../shared/types';
import type { RunEventHandler } from '../../shared/runtime-protocol';
import type { ConsoleView, View } from '../views/types';

export interface SidebarState { section: SidebarSection; width: number; collapsed: boolean; filter: string }
export interface DragSource { collectionId: string; nodeId: string }

export interface ShellElements {
  envSelect: HTMLSelectElement;
  topbar: HTMLElement;
  rail: HTMLElement;
  sidebar: HTMLElement;
  sidebarSplitter: HTMLElement;
  tabbar: HTMLElement;
  tabContent: HTMLElement;
  consoleHost: HTMLElement;
  content: HTMLElement;
  main: HTMLElement;
  statusbar: HTMLElement;
}

export interface AppRuntime {
  state: RendererState;
  tabs: Tab[];
  activeTabId: string | null;
  views: Map<string, View>;
  handlers: Map<string, RunEventHandler>;
  consoleEntries: ConsoleEntry[];
  consoleOpen: boolean;
  consoleHeight: number;
  consoleView: ConsoleView | null;
  expanded: Set<string>;
  sidebar: SidebarState;
  els: ShellElements;
  drag: DragSource | null;
}

export const GITHUB_URL = 'https://github.com/Basharshaeb';

export function emptyState(): RendererState {
  return {
    collections: [],
    environments: [],
    globals: { values: [] },
    history: [],
    settings: { activeEnvironmentId: null, strictSSL: true, followRedirects: true, requestTimeout: 0, theme: 'dark', historyLimit: 200 },
    ui: {}
  };
}

export const app: AppRuntime = {
  state: emptyState(),
  tabs: [],
  activeTabId: null,
  views: new Map(),
  handlers: new Map(),
  consoleEntries: [],
  consoleOpen: false,
  consoleHeight: 260,
  consoleView: null,
  expanded: new Set(),
  sidebar: { section: 'collections', width: 300, collapsed: false, filter: '' },
  els: {} as ShellElements,
  drag: null
};
