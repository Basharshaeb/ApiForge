/**
 * Example tab: a saved response shown read-only with its original request.
 */
import type { Draft, ExampleJson, ExampleTab, ItemJson, ResponseViewState } from '../../../shared/types';
import { draftFromItem, findNode, isFolder, languageFromContentType } from '../../model';
import { clear, codeView, emptyState, h, icon, methodBadge } from '../../ui';
import { findCollection } from '../../app/lookups';
import { save } from '../../app/persistence';
import { newRequest, notify, openRequest } from '../../app/tabs';
import type { View } from '../types';
import { responseViewer } from './response-viewer';

function findExample(tab: ExampleTab): { item: ItemJson; example: ExampleJson } | null {
  const c = findCollection(tab.collectionId);
  const hit = c && findNode(c, tab.itemId);
  if (!hit || isFolder(hit.node)) return null;
  const example = (hit.node.response || []).find((r) => r.id === tab.exampleId);
  return example ? { item: hit.node, example } : null;
}

const byteLength = (text: string | undefined): number => new TextEncoder().encode(text || '').length;

/** Build the response-viewer state from a stored example. */
function responseState(example: ExampleJson): ResponseViewState {
  const headers = (example.header || []).map((x) => ({ key: x.key, value: String(x.value) }));
  const contentType = (headers.find((x) => /^content-type$/i.test(x.key)) || { value: '' }).value;
  const size = byteLength(example.body);
  return {
    respTab: 'body',
    response: { code: example.code || 0, status: example.status || '', responseTime: null, contentType, headers, size: { body: size, header: 0, total: size }, body: example.body || '', bodyBase64: null, truncated: false },
    error: null,
    tests: [],
    scriptErrors: [],
    cookies: (example.cookie || []).map((c) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path, expires: c.expires, httpOnly: c.httpOnly, secure: c.secure })),
    visualizer: null,
    bodyLang: example._postman_previewlanguage || languageFromContentType(contentType, example.body)
  };
}

function requestSummary(draft: Draft): HTMLElement {
  const bodyOf = draft.body as unknown as Record<string, unknown>;
  const bodyValue = draft.body.mode === 'raw' ? draft.body.raw : JSON.stringify(bodyOf[draft.body.mode] || draft.body.file || draft.body.graphql, null, 2);
  return h('div', { class: 'pane pane-request', style: { height: '160px' } }, h('div', { class: 'pane-body' },
    h('div', { class: 'kv-title' }, 'Request headers'),
    draft.headers.length
      ? h('table', { class: 'headers-table' }, h('tbody', null, draft.headers.map((x) => h('tr', null, h('td', null, x.key), h('td', null, x.value)))))
      : h('div', { class: 'kv-empty' }, 'No headers'),
    draft.body.mode !== 'none' ? h('div', null, h('div', { class: 'kv-title', style: { marginTop: '10px' } }, `Body (${draft.body.mode})`),
      codeView(bodyValue, { language: draft.body.mode === 'raw' ? draft.body.language : 'json', wrap: true, lineNumbers: false })) : null));
}

export function exampleView(tab: ExampleTab): View {
  const el = h('div', { class: 'view' });

  function render(): void {
    clear(el);
    const found = findExample(tab);
    if (!found) { el.appendChild(emptyState('example', 'Example not found', 'This example was deleted.')); return; }
    const { item, example } = found;
    const draft = draftFromItem({ name: example.name, request: example.originalRequest || item.request });
    const name = h('input', { class: 'title-input', value: example.name, 'aria-label': 'Example name' });
    name.addEventListener('change', () => { example.name = name.value || example.name; save(); notify({ sidebar: true, tabbar: true }); });
    const state = responseState(example);
    const viewer = responseViewer(() => state, {});
    el.append(
      h('div', { class: 'example-banner' }, icon('example', 14), h('span', null, 'Example of '), h('b', null, item.name), h('span', { class: 'spacer' }),
        h('button', { class: 'btn btn-small btn-secondary', type: 'button', onclick: () => openRequest(tab.collectionId, tab.itemId) }, 'Open request')),
      h('div', { class: 'view-header' }, name, h('span', { class: 'spacer' }),
        h('button', { class: 'btn btn-small btn-secondary', type: 'button', onclick: () => { newRequest(draft, { collectionId: tab.collectionId }); } }, 'Try request')),
      h('div', { class: 'url-bar' }, methodBadge(draft.method), h('div', { class: 'var-input lg boxed', style: { flex: 1 } }, h('div', { class: 'var-backdrop', style: { color: 'var(--text)' } }, draft.url))),
      requestSummary(draft),
      viewer);
    viewer.render();
  }

  render();
  return { el, update: render };
}
