/**
 * Environment quick look: the variables currently in scope.
 */
import type { Row } from '../../../shared/types';
import { displayValue } from '../../model';
import { h, modal } from '../../ui';
import { createEnvironment } from '../../app/environments';
import { activeEnvironment } from '../../app/lookups';
import { app } from '../../app/state';
import { openEnvironment } from '../../app/tabs';

function variableTable(values: Row[]): HTMLElement {
  const rows = values.filter((v) => v.key);
  if (!rows.length) return h('div', { class: 'kv-empty' }, 'No variables');
  return h('table', { class: 'lookup-table' },
    h('thead', null, h('tr', null, h('th', null, 'Variable'), h('th', null, 'Value'), h('th', null, ''))),
    h('tbody', null, rows.map((v) => h('tr', { style: v.enabled === false ? { opacity: 0.5 } : null },
      h('td', null, v.key), h('td', null, v.type === 'secret' ? '••••••••' : displayValue(v.value)), h('td', null, v.enabled === false ? 'disabled' : '')))));
}

function scopeBlock(title: string, values: Row[], onEdit: () => void): HTMLElement {
  return h('div', { class: 'scope-table-wrap' },
    h('div', { style: { display: 'flex', alignItems: 'center', marginBottom: '4px' } }, h('b', null, title), h('span', { class: 'spacer' }), h('button', { class: 'link-btn', type: 'button', onclick: onEdit }, 'Edit')),
    variableTable(values));
}

export function envQuickLook(): void {
  const env = activeEnvironment();
  const editEnvironment = (): void => {
    dialog.close();
    if (env) openEnvironment(env.id);
    else void createEnvironment();
  };
  const dialog = modal({
    title: 'Variables in scope',
    width: 620,
    body: h('div', null,
      scopeBlock(env ? `Environment: ${env.name}` : 'No active environment', env ? env.values : [], editEnvironment),
      h('div', { style: { height: '14px' } }),
      scopeBlock('Globals', app.state.globals.values, () => { dialog.close(); openEnvironment('globals'); })),
    actions: [{ label: 'Close', primary: true }]
  });
}
