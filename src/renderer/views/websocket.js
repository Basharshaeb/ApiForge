/**
 * WebSocket request tab: connect, exchange messages, inspect the log.
 */
(function (root) {
  'use strict';

  root.Views = root.Views || {};
  const M = root.ApiForgeModel;
  const UI = root.UI;
  const { h, clear, icon, iconButton, toast } = UI;
  const api = root.apiforge;

  function websocketView(tab) {
    const App = root.App;
    const el = h('div', { class: 'view' });
    const getVars = () => App.vars(null);
    let urlInput;
    let listEl;
    let statusEl;
    let connectBtn;
    let composerBody;
    tab.filter = tab.filter || 'all';
    tab.compose = tab.compose || '';
    tab.format = tab.format || 'text';

    const time = (ts) => new Date(ts).toLocaleTimeString(undefined, { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const push = (msg) => {
      tab.messages.push({ ts: Date.now(), ...msg });
      if (tab.messages.length > 2000) tab.messages.splice(0, tab.messages.length - 2000);
      renderList();
    };

    function connect() {
      if (tab.status !== 'disconnected') { if (tab.connId) api.ws.close(tab.connId); return; }
      const url = M.substitute(tab.url.trim(), getVars());
      if (!url) { toast('Enter a WebSocket URL', 'warning'); return; }
      const id = M.uid();
      tab.connId = id;
      tab.status = 'connecting';
      const headers = tab.headers.filter((r) => r.enabled !== false && !M.isBlankRow(r)).map((r) => ({ key: M.substitute(r.key, getVars()), value: M.substitute(String(r.value || ''), getVars()) }));
      App.registerHandler(id, (msg) => {
        const { event, data } = msg;
        switch (event) {
          case 'ws:connecting': push({ kind: 'sys', text: `Connecting to ${data.url}` }); break;
          case 'ws:handshake': push({ kind: 'sys', text: `Handshake ${data.statusCode}`, detail: data.headers.map((x) => `${x.key}: ${x.value}`).join('\n') }); break;
          case 'ws:open': tab.status = 'connected'; push({ kind: 'sys', text: `Connected to ${data.url}${data.protocol ? ` (${data.protocol})` : ''}` }); break;
          case 'ws:message': push({ kind: data.direction, text: data.binary ? `<binary ${data.size} bytes>` : data.data, size: data.size }); break;
          case 'ws:error': push({ kind: 'err', text: data.message }); App.log({ type: 'error', ts: Date.now(), messages: [`WebSocket: ${data.message}`], tabId: tab.id }); break;
          case 'ws:close':
            tab.status = 'disconnected';
            tab.connId = null;
            push({ kind: 'sys', text: `Disconnected${data.code ? ` (${data.code}${data.reason ? `: ${data.reason}` : ''})` : ''}` });
            break;
          default: break;
        }
        renderStatus();
      });
      const protocols = M.substitute(tab.protocols || '', getVars());
      api.ws.connect({ id, url: /^wss?:\/\//i.test(url) ? url : `ws://${url}`, headers, protocols, strictSSL: App.state.settings.strictSSL !== false });
      App.log({ type: 'network', ts: Date.now(), method: 'WS', url, pending: false, status: null, statusText: 'connect', tabId: tab.id });
      renderStatus();
    }

    function send() {
      if (tab.status !== 'connected') { toast('Connect first', 'warning'); return; }
      let text = tab.compose;
      if (!text.trim()) return;
      if (tab.format === 'json') {
        try { text = JSON.stringify(JSON.parse(text)); } catch (err) { toast(`Invalid JSON: ${err.message}`, 'error'); return; }
      }
      api.ws.send(tab.connId, M.substitute(text, getVars()));
    }

    function renderStatus() {
      clear(statusEl);
      statusEl.className = `ws-status ${tab.status}`;
      statusEl.append(h('span', { class: 'dot' }), tab.status === 'connected' ? 'Connected' : tab.status === 'connecting' ? 'Connecting…' : 'Disconnected');
      connectBtn.textContent = tab.status === 'disconnected' ? 'Connect' : 'Disconnect';
      connectBtn.classList.toggle('btn-primary', tab.status === 'disconnected');
      connectBtn.classList.toggle('btn-danger', tab.status !== 'disconnected');
      const sendBtn = el.querySelector('.ws-send');
      if (sendBtn) sendBtn.disabled = tab.status !== 'connected';
    }

    function renderList() {
      if (!listEl) return;
      const atBottom = listEl.scrollTop + listEl.clientHeight >= listEl.scrollHeight - 8;
      clear(listEl);
      const items = tab.messages.filter((m) => tab.filter === 'all' || (tab.filter === 'in' && m.kind === 'in') || (tab.filter === 'out' && m.kind === 'out'));
      if (!items.length) {
        listEl.appendChild(h('div', { class: 'console-empty' }, tab.messages.length ? 'No messages match the filter' : 'Connect to a WebSocket server to start exchanging messages'));
        return;
      }
      items.forEach((m) => {
        const row = h('div', { class: `ws-msg ${m.kind}${m.expanded ? '' : ' collapsed'}`, onclick: () => { m.expanded = !m.expanded; renderList(); } },
          h('span', { class: 'ws-dir', title: m.kind === 'in' ? 'Received' : m.kind === 'out' ? 'Sent' : '' }, m.kind === 'in' ? '↓' : m.kind === 'out' ? '↑' : m.kind === 'err' ? '!' : '•'),
          h('span', { class: 'ws-text' }, m.expanded && m.kind !== 'sys' ? UI.prettyText(m.text, UI.isJson(m.text) ? 'json' : 'text') : m.text, m.expanded && m.detail ? h('div', { class: 'faint', style: { marginTop: '4px', whiteSpace: 'pre-wrap' } }, m.detail) : null),
          h('span', { class: 'ws-time' }, time(m.ts)));
        listEl.appendChild(row);
      });
      if (atBottom) listEl.scrollTop = listEl.scrollHeight;
    }

    function renderComposer() {
      clear(composerBody);
      if (tab.subtab === 'headers') {
        composerBody.appendChild(h('div', { class: 'pane-body' }, h('div', { class: 'doc-note' }, 'Headers are sent with the connection handshake.'),
          UI.kvEditor({ rows: tab.headers, getVars, onChange: () => App.save() })));
      } else if (tab.subtab === 'settings') {
        const protocols = h('input', { class: 'input', value: tab.protocols, placeholder: 'e.g. graphql-ws, chat', oninput: (e) => { tab.protocols = e.target.value; App.save(); } });
        composerBody.appendChild(h('div', { class: 'pane-body' }, h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Subprotocols (comma separated)'), protocols),
          h('div', { class: 'doc-note' }, 'SSL verification and proxy behaviour follow the app settings.')));
      } else {
        const area = h('textarea', { class: 'editor-area mono', style: { flex: 1, border: 'none', background: 'var(--bg-input)' }, placeholder: tab.format === 'json' ? '{ "type": "ping" }' : 'Message', spellcheck: false });
        area.value = tab.compose;
        area.addEventListener('input', () => { tab.compose = area.value; });
        area.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); send(); } });
        composerBody.append(
          h('div', { class: 'pane-toolbar sub' }, UI.selectEl([['text', 'Text'], ['json', 'JSON']], tab.format, (v) => { tab.format = v; renderComposer(); }, { style: { width: '100px', height: '24px' } }),
            tab.format === 'json' ? h('button', { class: 'btn btn-small btn-secondary', type: 'button', onclick: () => { if (UI.isJson(area.value)) { area.value = UI.formatJson(area.value); tab.compose = area.value; } } }, 'Beautify') : null,
            h('span', { class: 'spacer' }),
            h('button', { class: 'btn btn-small btn-primary ws-send', type: 'button', disabled: tab.status !== 'connected', title: 'Send (Ctrl+Enter)', onclick: send }, icon('send', 12), 'Send')),
          area);
      }
    }

    function build() {
      clear(el);
      urlInput = UI.varInput({ value: tab.url, placeholder: 'wss://example.com/socket', className: 'lg boxed', getVars, onInput: (v) => { tab.url = v; App.save(); App.notify({ tabbar: true }); }, onKeyDown: (e) => { if (e.key === 'Enter') connect(); } });
      connectBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: connect }, 'Connect');
      statusEl = h('span', { class: 'ws-status' });
      listEl = h('div', { class: 'ws-list' });
      composerBody = h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } });
      const subtabs = UI.tabStrip([{ id: 'message', label: 'Message' }, { id: 'headers', label: 'Headers', badge: tab.headers.filter((r) => r.enabled !== false && !M.isBlankRow(r)).length || null }, { id: 'settings', label: 'Settings' }], tab.subtab, (id) => { tab.subtab = id; App.save(); build(); });
      el.append(
        h('div', { class: 'view-header' }, h('span', { class: 'method method-ws' }, 'WEBSOCKET'), h('span', { class: 'spacer' }), statusEl),
        h('div', { class: 'url-bar' }, urlInput, connectBtn),
        h('div', { class: 'ws-layout' },
          h('div', { class: 'ws-messages' },
            h('div', { class: 'pane-toolbar sub' }, UI.tabStrip([{ id: 'all', label: 'All' }, { id: 'out', label: 'Sent' }, { id: 'in', label: 'Received' }], tab.filter, (id) => { tab.filter = id; build(); }, 'pill'),
              h('span', { class: 'spacer' }), iconButton('trash', 'Clear messages', () => { tab.messages = []; renderList(); })),
            listEl),
          h('div', { class: 'ws-composer' }, subtabs, composerBody)));
      renderComposer();
      renderList();
      renderStatus();
    }

    build();
    return {
      el,
      update() { renderStatus(); renderList(); el.querySelectorAll('.var-input').forEach((w) => w.repaint && w.repaint()); },
      focus() { if (!tab.url) urlInput.input.focus(); }
    };
  }

  root.Views.websocket = websocketView;
})(window);
