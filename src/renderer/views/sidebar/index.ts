/**
 * Sidebar frame: header, filter box and the active section body.
 */
import type { SidebarSection } from '../../../shared/types';
import { clear, confirm, h, icon, iconButton } from '../../ui';
import * as App from '../../app';
import { renderCollectionsSection } from './collections';
import { renderEnvironmentsSection } from './environments';
import { renderHistorySection } from './history';

const TITLES: Record<SidebarSection, string> = { collections: 'Collections', environments: 'Environments', history: 'History' };
const SECTIONS: Record<SidebarSection, (body: HTMLElement, filter: string) => void> = {
  collections: renderCollectionsSection,
  environments: renderEnvironmentsSection,
  history: renderHistorySection
};

async function clearHistory(): Promise<void> {
  if (!App.app.state.history.length) return;
  if (!(await confirm({ title: 'Clear History', message: 'Remove all history entries?', okLabel: 'Clear', danger: true }))) return;
  App.app.state.history = [];
  App.save();
  App.renderSidebar();
}

function headerActions(section: SidebarSection): HTMLElement[] {
  switch (section) {
    case 'collections': return [iconButton('plus', 'New collection', () => { void App.createCollection(); }), iconButton('import', 'Import', App.showImport)];
    case 'environments': return [iconButton('plus', 'New environment', () => { void App.createEnvironment(); }), iconButton('import', 'Import', App.showImport)];
    default: return [iconButton('trash', 'Clear history', () => { void clearHistory(); })];
  }
}

function renderBody(body: HTMLElement): void {
  clear(body);
  SECTIONS[App.app.sidebar.section](body, (App.app.sidebar.filter || '').trim().toLowerCase());
}

/** Builds the header + search once per section; later renders only refresh the body (keeps the filter focused). */
function buildFrame(sidebarEl: HTMLElement, section: SidebarSection): HTMLElement {
  clear(sidebarEl);
  sidebarEl.dataset.section = section;
  const search = h('input', { class: 'input', placeholder: `Filter ${TITLES[section].toLowerCase()}`, value: App.app.sidebar.filter || '', 'aria-label': 'Filter' });
  const body = h('div', { class: 'sidebar-body' });
  search.addEventListener('input', () => { App.app.sidebar.filter = search.value; renderBody(body); });
  sidebarEl.append(
    h('div', { class: 'sidebar-header' }, h('span', { class: 'sidebar-title' }, TITLES[section]), ...headerActions(section)),
    h('div', { class: 'sidebar-search' }, h('div', { class: 'search-box' }, icon('search', 13), search)),
    body);
  return body;
}

export function renderSidebarView(sidebarEl: HTMLElement): void {
  const section = App.app.sidebar.section;
  let body = sidebarEl.querySelector<HTMLElement>('.sidebar-body');
  if (sidebarEl.dataset.section !== section || !body) body = buildFrame(sidebarEl, section);
  renderBody(body);
}
