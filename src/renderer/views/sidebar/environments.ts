/**
 * Environments section of the sidebar (globals + environment list).
 */
import type { Environment, Row, Tab } from '../../../shared/types';
import { h, icon, iconButton } from '../../ui';
import * as App from '../../app';
import { environmentMenu, globalsMenu } from './menus';

const isOpen = (active: Tab | null, envId: string): boolean => !!active && active.type === 'environment' && active.envId === envId;
const variableCount = (values: Row[]): number | string => values.filter((v) => v.key).length || '';

function globalsRow(active: Tab | null): HTMLElement {
  return h('div', { class: `env-row${isOpen(active, 'globals') ? ' selected' : ''}`, onclick: () => { App.openEnvironment('globals'); } },
    h('span', { class: 'env-check' }, icon('globe', 14)),
    h('span', { class: 'env-name' }, 'Globals'),
    h('span', { class: 'tree-count' }, variableCount(App.app.state.globals.values)),
    h('span', { class: 'row-actions' }, iconButton('more', 'More actions', (e) => { e.stopPropagation(); globalsMenu(e.currentTarget as Element); })));
}

function environmentRow(env: Environment, active: Tab | null): HTMLElement {
  const isActive = env.id === App.app.state.settings.activeEnvironmentId;
  return h('div', {
    class: `env-row${isActive ? ' active-env' : ''}${isOpen(active, env.id) ? ' selected' : ''}`,
    onclick: () => { App.openEnvironment(env.id); },
    oncontextmenu: (e: MouseEvent) => { e.preventDefault(); environmentMenu(env, { x: e.clientX, y: e.clientY }); }
  },
  h('button', { class: 'env-check', type: 'button', title: isActive ? 'Active environment' : 'Set as active', onclick: (e: Event) => { e.stopPropagation(); App.setActiveEnvironment(isActive ? null : env.id); } },
    isActive ? icon('check', 14) : h('span', { class: 'icon' })),
  h('span', { class: 'env-name', title: env.name }, env.name),
  h('span', { class: 'tree-count' }, variableCount(env.values)),
  h('span', { class: 'row-actions' }, iconButton('more', 'More actions', (e) => { e.stopPropagation(); environmentMenu(env, e.currentTarget as Element); })));
}

function emptyMessage(filter: string): HTMLElement {
  if (filter) return h('div', { class: 'sidebar-empty' }, 'No environments match your filter.');
  return h('div', { class: 'sidebar-empty' }, 'Environments hold variables (like a base URL or token) that change between setups.',
    h('br'), h('button', { class: 'btn btn-primary btn-small', type: 'button', onclick: () => { void App.createEnvironment(); } }, 'Create Environment'));
}

export function renderEnvironmentsSection(body: HTMLElement, filter: string): void {
  const active = App.activeTab();
  body.append(h('div', { class: 'section-label' }, 'Globals'), globalsRow(active), h('div', { class: 'section-label' }, 'Environments'));
  const envs = App.app.state.environments.filter((e) => !filter || e.name.toLowerCase().includes(filter));
  if (!envs.length) { body.appendChild(emptyMessage(filter)); return; }
  envs.forEach((env) => body.appendChild(environmentRow(env, active)));
}
