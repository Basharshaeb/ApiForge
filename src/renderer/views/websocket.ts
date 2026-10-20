/**
 * WebSocket request tab: connect, exchange messages, inspect the log.
 */
import type { WebSocketTab, WsMessage, WsMessageKind } from '../../shared/types';
import type { RunEvent, RunEventMap, RunEventName } from '../../shared/runtime-protocol';
import { isBlankRow, substitute, uid } from '../model';
import { clear, formatJson, h, icon, iconButton, isJson, kvEditor, prettyText, repaintVarInputs, selectEl, tabStrip, toast, varInput, type VarInput } from '../ui';
import * as App from '../app';
import type { View } from './types';

const MAX_MESSAGES = 2000;
const DIRECTION_GLYPH: Record<WsMessageKind, string> = { in: '↓', out: '↑', err: '!', sys: '•' };
const timeLabel = (ts: number): string => new Date(ts).toLocaleTimeString(undefined, { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

type Push = (msg: Omit<WsMessage, 'ts'>) => void;
type WsHandlers = { [K in RunEventName]?: (data: RunEventMap[K]) => void };

function initTabState(tab: WebSocketTab): void {
  tab.filter = tab.filter || 'all';
  tab.compose = tab.compose || '';
  tab.format = tab.format || 'text';
}

// Connection ----------------------------------------------------------------
function socketEventHandler(tab: WebSocketTab, push: Push, onStatus: () => void): (msg: RunEvent) => void {
  const on: WsHandlers = {
    'ws:connecting': (d) => push({ kind: 'sys', text: `Connecting to ${d.url}` }),
    'ws:handshake': (d) => push({ kind: 'sys', text: `Handshake ${d.statusCode}`, detail: d.headers.map((x) => `${x.key}: ${x.value}`).join('\n') }),
    'ws:open': (d) => { tab.status = 'connected'; push({ kind: 'sys', text: `Connected to ${d.url}${d.protocol ? ` (${d.protocol})` : ''}` }); },
    'ws:message': (d) => push({ kind: d.direction, text: d.binary ? `<binary ${d.size} bytes>` : d.data, size: d.size }),
    'ws:error': (d) => { push({ kind: 'err', text: d.message }); App.log({ type: 'error', ts: Date.now(), messages: [`WebSocket: ${d.message}`], tabId: tab.id }); },
    'ws:close': (d) => {
      tab.status = 'disconnected';
      tab.connId = null;
      push({ kind: 'sys', text: `Disconnected${d.code ? ` (${d.code}${d.reason ? `: ${d.reason}` : ''})` : ''}` });
    }
  };
  return (msg) => {
    App.dispatchEvent(on, msg);
    onStatus();
  };
}

function connectionHeaders(tab: WebSocketTab): Array<{ key: string; value: string }> {
  const scope = App.vars(null);
  return tab.headers
    .filter((r) => r.enabled !== false && !isBlankRow(r))
    .map((r) => ({ key: substitute(r.key, scope), value: substitute(String(r.value || ''), scope) }));
}

function connect(tab: WebSocketTab, push: Push, onStatus: () => void): void {
  if (tab.status !== 'disconnected') { if (tab.connId) void window.apiforge.ws.close(tab.connId); return; }
  const scope = App.vars(null);
  const url = substitute(tab.url.trim(), scope);
  if (!url) { toast('Enter a WebSocket URL', 'warning'); return; }
  const id = uid();
  Object.assign(tab, { connId: id, status: 'connecting' });
  App.registerHandler(id, socketEventHandler(tab, push, onStatus));
  void window.apiforge.ws.connect({ id, url: /^wss?:\/\//i.test(url) ? url : `ws://${url}`, headers: connectionHeaders(tab), protocols: substitute(tab.protocols || '', scope), strictSSL: App.app.state.settings.strictSSL !== false });
  App.log({ type: 'network', ts: Date.now(), method: 'WS', url, pending: false, status: null, statusText: 'connect', tabId: tab.id });
  onStatus();
}

function sendComposed(tab: WebSocketTab): void {
  if (tab.status !== 'connected') { toast('Connect first', 'warning'); return; }
  let text = tab.compose || '';
  if (!text.trim()) return;
  if (tab.format === 'json') {
    try { text = JSON.stringify(JSON.parse(text)); } catch (err) { toast(`Invalid JSON: ${(err as Error).message}`, 'error'); return; }
  }
  if (tab.connId) void window.apiforge.ws.send(tab.connId, substitute(text, App.vars(null)));
}

// Rendering -------------------------------------------------------------------
function messageRow(m: WsMessage, rerender: () => void): HTMLElement {
  const expandedText = m.expanded && m.kind !== 'sys' ? prettyText(m.text, isJson(m.text) ? 'json' : 'text') : m.text;
  return h('div', { class: `ws-msg ${m.kind}${m.expanded ? '' : ' collapsed'}`, onclick: () => { m.expanded = !m.expanded; rerender(); } },
    h('span', { class: 'ws-dir', title: m.kind === 'in' ? 'Received' : m.kind === 'out' ? 'Sent' : '' }, DIRECTION_GLYPH[m.kind] || '•'),
    h('span', { class: 'ws-text' }, expandedText, m.expanded && m.detail ? h('div', { class: 'faint', style: { marginTop: '4px', whiteSpace: 'pre-wrap' } }, m.detail) : null),
    h('span', { class: 'ws-time' }, timeLabel(m.ts)));
}

const visibleMessages = (tab: WebSocketTab): WsMessage[] => tab.messages.filter((m) => tab.filter === 'all' || m.kind === tab.filter);

interface Parts { urlInput: VarInput; connectBtn: HTMLButtonElement; status: HTMLElement; list: HTMLElement; composer: HTMLElement; renderComposer(): void }

function messageComposer(tab: WebSocketTab, parts: Parts): HTMLElement[] {
  const area = h('textarea', { class: 'editor-area mono', style: { flex: 1, border: 'none', background: 'var(--bg-input)' }, placeholder: tab.format === 'json' ? '{ "type": "ping" }' : 'Message', spellcheck: false });
  area.value = tab.compose || '';
  area.addEventListener('input', () => { tab.compose = area.value; });
  area.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); sendComposed(tab); } });
  const beautify = (): void => { if (isJson(area.value)) { area.value = formatJson(area.value); tab.compose = area.value; } };
  return [
    h('div', { class: 'pane-toolbar sub' },
      selectEl([['text', 'Text'], ['json', 'JSON']], tab.format || 'text', (v) => { tab.format = v as 'text' | 'json'; parts.renderComposer(); }, { style: { width: '100px', height: '24px' } }),
      tab.format === 'json' ? h('button', { class: 'btn btn-small btn-secondary', type: 'button', onclick: beautify }, 'Beautify') : null,
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn btn-small btn-primary ws-send', type: 'button', disabled: tab.status !== 'connected', title: 'Send (Ctrl+Enter)', onclick: () => sendComposed(tab) }, icon('send', 12), 'Send')),
    area
  ];
}

function composerContent(tab: WebSocketTab, parts: Parts): HTMLElement[] {
  if (tab.subtab === 'headers') {
    return [h('div', { class: 'pane-body' }, h('div', { class: 'doc-note' }, 'Headers are sent with the connection handshake.'), kvEditor({ rows: tab.headers, getVars: () => App.vars(null), onChange: () => App.save() }))];
  }
  if (tab.subtab === 'settings') {
    const protocols = h('input', { class: 'input', value: tab.protocols, placeholder: 'e.g. graphql-ws, chat', oninput: (e: Event) => { tab.protocols = (e.target as HTMLInputElement).value; App.save(); } });
    return [h('div', { class: 'pane-body' }, h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Subprotocols (comma separated)'), protocols), h('div', { class: 'doc-note' }, 'SSL verification and proxy behaviour follow the app settings.'))];
  }
  return messageComposer(tab, parts);
}

export function websocketView(tab: WebSocketTab): View {
  initTabState(tab);
  const el = h('div', { class: 'view' });
  const parts = {} as Parts;

  const renderList = (): void => {
    const list = parts.list;
    const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 8;
    clear(list);
    const items = visibleMessages(tab);
    if (!items.length) list.appendChild(h('div', { class: 'console-empty' }, tab.messages.length ? 'No messages match the filter' : 'Connect to a WebSocket server to start exchanging messages'));
    else items.forEach((m) => list.appendChild(messageRow(m, renderList)));
    if (atBottom) list.scrollTop = list.scrollHeight;
  };
  const push: Push = (msg) => {
    tab.messages.push({ ts: Date.now(), ...msg });
    if (tab.messages.length > MAX_MESSAGES) tab.messages.splice(0, tab.messages.length - MAX_MESSAGES);
    renderList();
  };
  const renderStatus = (): void => {
    clear(parts.status);
    parts.status.className = `ws-status ${tab.status}`;
    parts.status.append(h('span', { class: 'dot' }), tab.status === 'connected' ? 'Connected' : tab.status === 'connecting' ? 'Connecting…' : 'Disconnected');
    const disconnected = tab.status === 'disconnected';
    parts.connectBtn.textContent = disconnected ? 'Connect' : 'Disconnect';
    parts.connectBtn.classList.toggle('btn-primary', disconnected);
    parts.connectBtn.classList.toggle('btn-danger', !disconnected);
    const sendBtn = el.querySelector<HTMLButtonElement>('.ws-send');
    if (sendBtn) sendBtn.disabled = tab.status !== 'connected';
  };
  parts.renderComposer = () => { clear(parts.composer); parts.composer.append(...composerContent(tab, parts)); };
  const doConnect = (): void => connect(tab, push, renderStatus);

  function build(): void {
    clear(el);
    parts.urlInput = varInput({ value: tab.url, placeholder: 'wss://example.com/socket', className: 'lg boxed', getVars: () => App.vars(null), onInput: (v) => { tab.url = v; App.save(); App.notify({ tabbar: true }); }, onKeyDown: (e) => { if (e.key === 'Enter') doConnect(); } });
    parts.connectBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: doConnect }, 'Connect');
    parts.status = h('span', { class: 'ws-status' });
    parts.list = h('div', { class: 'ws-list' });
    parts.composer = h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } });
    const headerCount = tab.headers.filter((r) => r.enabled !== false && !isBlankRow(r)).length || null;
    const subtabs = tabStrip([{ id: 'message', label: 'Message' }, { id: 'headers', label: 'Headers', badge: headerCount }, { id: 'settings', label: 'Settings' }], tab.subtab, (id) => { tab.subtab = id as WebSocketTab['subtab']; App.save(); build(); });
    const filters = tabStrip([{ id: 'all', label: 'All' }, { id: 'out', label: 'Sent' }, { id: 'in', label: 'Received' }], tab.filter || 'all', (id) => { tab.filter = id as WebSocketTab['filter']; build(); }, 'pill');
    el.append(
      h('div', { class: 'view-header' }, h('span', { class: 'method method-ws' }, 'WEBSOCKET'), h('span', { class: 'spacer' }), parts.status),
      h('div', { class: 'url-bar' }, parts.urlInput, parts.connectBtn),
      h('div', { class: 'ws-layout' },
        h('div', { class: 'ws-messages' }, h('div', { class: 'pane-toolbar sub' }, filters, h('span', { class: 'spacer' }), iconButton('trash', 'Clear messages', () => { tab.messages = []; renderList(); })), parts.list),
        h('div', { class: 'ws-composer' }, subtabs, parts.composer)));
    parts.renderComposer();
    renderList();
    renderStatus();
  }

  build();
  return {
    el,
    update() { renderStatus(); renderList(); repaintVarInputs(el); },
    focus() { if (!tab.url) parts.urlInput.input.focus(); }
  };
}
