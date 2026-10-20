/**
 * Environment / globals editor tab. Edits are applied directly to the store.
 */
import type { Environment, EnvironmentTab } from '../../shared/types';
import { append, clear, emptyState, h, icon, iconButton, kvEditor } from '../ui';
import * as App from '../app';
import type { View } from './types';

const SIDEBAR_REFRESH_MS = 600;
const NOTES = {
  globals: 'Global variables are available in every request and are overridden by collection and environment variables with the same name.',
  environment: 'Environment variables are available when this environment is active. Reference them with {{name}} and mark sensitive values as secret to mask them.'
};

interface Target { env: Environment; isGlobals: boolean }

function resolveTarget(tab: EnvironmentTab): Target | null {
  if (tab.envId === 'globals') return { env: { id: 'globals', name: 'Globals', values: App.app.state.globals.values }, isGlobals: true };
  const env = App.findEnvironment(tab.envId);
  return env ? { env, isGlobals: false } : null;
}

function titleControl({ env, isGlobals }: Target, refreshSidebar: () => void): HTMLElement {
  if (isGlobals) return h('span', { class: 'title-input', style: { display: 'inline-flex', alignItems: 'center', gap: '8px' } }, icon('globe', 16), 'Globals');
  const name = h('input', { class: 'title-input', value: env.name, 'aria-label': 'Environment name', spellcheck: false });
  name.addEventListener('input', () => { env.name = name.value; App.save(); App.notify({ tabbar: true }); refreshSidebar(); });
  return name;
}

function header(target: Target, refreshSidebar: () => void): HTMLElement {
  const { env, isGlobals } = target;
  const isActive = !isGlobals && App.app.state.settings.activeEnvironmentId === env.id;
  return append(h('div', { class: 'view-header' }),
    titleControl(target, refreshSidebar),
    h('span', { class: 'spacer' }),
    isGlobals ? null : h('button', { class: `btn btn-small ${isActive ? 'btn-secondary' : 'btn-primary'}`, type: 'button', onclick: () => App.setActiveEnvironment(isActive ? null : env.id) }, isActive ? 'Active' : 'Set as active'),
    iconButton('download', 'Export', () => { void App.exportEnvironment(env, isGlobals ? 'globals' : 'environment'); }),
    isGlobals ? null : iconButton('trash', 'Delete environment', () => { void App.deleteEnvironment(env); }));
}

export function environmentView(tab: EnvironmentTab): View {
  const el = h('div', { class: 'view' });
  let sidebarTimer: ReturnType<typeof setTimeout> | null = null;
  const refreshSidebar = (): void => { if (sidebarTimer) clearTimeout(sidebarTimer); sidebarTimer = setTimeout(() => App.renderSidebar(), SIDEBAR_REFRESH_MS); };

  function render(): void {
    clear(el);
    const target = resolveTarget(tab);
    if (!target) { el.appendChild(emptyState('environments', 'Environment not found', 'It may have been deleted.')); return; }
    const table = kvEditor({ rows: target.env.values, types: true, keyPlaceholder: 'Variable', valuePlaceholder: 'Value', onChange: () => { App.save(); refreshSidebar(); } });
    el.append(header(target, refreshSidebar), h('div', { class: 'doc-view' },
      h('div', { class: 'doc-note' }, target.isGlobals ? NOTES.globals : NOTES.environment),
      table,
      h('div', { class: 'doc-note', style: { marginTop: '14px' } }, 'Changes are saved automatically. Scripts can update these values with pm.environment.set() and pm.globals.set().')));
  }

  render();
  return { el, update: render };
}
