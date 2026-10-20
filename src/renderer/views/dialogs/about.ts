/**
 * About dialog: version info, author link and keyboard shortcuts.
 */
import type { AppInfo } from '../../../shared/bridge';
import { h, modal } from '../../ui';
import { openExternal } from '../../app/shell';
import { GITHUB_URL } from '../../app/state';

const SHORTCUTS: Array<[string, string]> = [
  ['Ctrl+Enter', 'Send request'], ['Ctrl+S', 'Save request'], ['Ctrl+T', 'New request'], ['Ctrl+W', 'Close tab'], ['Ctrl+Tab', 'Next tab'],
  ['Ctrl+O', 'Import'], ['Ctrl+Alt+C', 'Toggle console'], ['Ctrl+\\', 'Toggle sidebar'], ['Ctrl+,', 'Settings']
];

function externalLink(text: string, url: string): HTMLElement {
  return h('a', { href: '#', onclick: (e: Event) => { e.preventDefault(); openExternal(url); } }, text);
}

function infoList(info: AppInfo): HTMLElement {
  const entries: Array<[string, string]> = [['Version', info.version], ['Electron', info.electron], ['Node', info.node], ['Chromium', info.chrome], ['Data file', info.dataFile]];
  return h('dl', { class: 'about-grid' }, entries.flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)]));
}

function shortcutTable(): HTMLElement {
  return h('table', { class: 'data-table' }, h('tbody', null, SHORTCUTS.map(([keys, label]) =>
    h('tr', null, h('td', { style: { width: '130px' } }, h('span', { class: 'kbd' }, keys)), h('td', { style: { fontFamily: 'var(--font)' } }, label)))));
}

export async function aboutDialog(): Promise<void> {
  const info = await window.apiforge.app.info();
  modal({
    title: 'About ApiForge',
    body: h('div', null,
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' } },
        h('img', { src: '../../../assets/icon-64.png', width: 48, height: 48, alt: '' }),
        h('div', null, h('b', { style: { fontSize: '15px' } }, 'ApiForge'), h('div', { class: 'muted' }, `Version ${info.version}`))),
      h('p', { class: 'modal-message' }, 'A local API client built on postman-runtime: requests, scripts, collections, environments, runner, cookies and WebSockets, all stored on this machine.'),
      h('p', { class: 'modal-message' }, 'Created by ', externalLink('Basharshaeb', GITHUB_URL), ' — ', externalLink(GITHUB_URL, GITHUB_URL)),
      infoList(info),
      h('h3', { style: { fontSize: '13px', margin: '16px 0 6px' } }, 'Keyboard shortcuts'),
      shortcutTable()),
    actions: [{ label: 'Close', primary: true }]
  });
}
