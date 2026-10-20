/**
 * Bottom console: script logs and network activity.
 */
(function (root) {
  'use strict';

  root.Views = root.Views || {};
  const M = root.ApiForgeModel;
  const UI = root.UI;
  const { h, clear, icon, iconButton } = UI;

  const KIND_ICON = { log: '›', info: 'i', warn: '!', error: '✕', network: '⇄' };

  function create() {
    const App = root.App;
    const el = h('div', { class: 'console' });
    let filter = 'all';
    let search = '';
    let listEl;
    let scheduled = false;

    const time = (ts) => new Date(ts).toLocaleTimeString(undefined, { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const statusClass = (code) => (code ? `status-${Math.floor(code / 100)}xx` : 'status-err');

    function matches(e) {
      if (filter !== 'all' && e.type !== filter && !(filter === 'warn' && e.type === 'warning')) return false;
      if (!search) return true;
      const text = e.type === 'network' ? `${e.method} ${e.url} ${e.status || ''}` : (e.messages || []).join(' ');
      return text.toLowerCase().includes(search);
    }

    function headerBlock(title, headers) {
      if (!headers || !headers.length) return null;
      return h('details', null, h('summary', null, `${title} (${headers.length})`), h('pre', null, headers.map((x) => `${x.key}: ${x.value}`).join('\n')));
    }

    function bodyBlock(title, body) {
      if (!body) return null;
      return h('details', null, h('summary', null, `${title} (${M.formatBytes(new TextEncoder().encode(body).length)})`), h('pre', null, body.length > 20000 ? `${body.slice(0, 20000)}\n… (truncated)` : body));
    }

    function renderEntry(e) {
      if (e.type === 'network') {
        const entry = h('div', { class: 'console-entry network expandable' });
        const line = h('div', { class: 'console-line', onclick: () => { e.expanded = !e.expanded; render(); } },
          h('span', { class: 'console-ts' }, time(e.ts)),
          h('span', { class: 'console-kind' }, KIND_ICON.network),
          h('div', { class: 'console-msg' },
            h('b', null, e.method),
            h('span', { class: 'console-url', title: e.url }, e.url),
            e.pending ? h('span', { class: 'faint' }, 'pending…') : e.error ? h('span', { class: 'status-err' }, e.error.message || 'error') : e.status != null ? h('span', { class: statusClass(e.status) }, `${e.status} ${e.statusText || ''}`) : h('span', { class: 'faint' }, e.statusText || ''),
            e.time != null ? h('span', { class: 'faint' }, M.formatMs(e.time)) : null,
            e.size != null ? h('span', { class: 'faint' }, M.formatBytes(e.size)) : null));
        entry.appendChild(line);
        if (e.expanded) {
          entry.appendChild(h('div', { class: 'console-detail' },
            e.request ? h('div', { class: 'faint', style: { marginBottom: '4px' } }, `${e.request.method} ${e.request.url}`) : null,
            e.request ? headerBlock('Request Headers', e.request.headers) : null,
            e.request ? bodyBlock('Request Body', e.request.body) : null,
            e.response ? headerBlock('Response Headers', e.response.headers) : null,
            e.response ? bodyBlock('Response Body', e.response.body) : null,
            e.error ? h('pre', { class: 'status-err' }, `${e.error.name || 'Error'}: ${e.error.message}${e.error.code ? ` (${e.error.code})` : ''}`) : null));
        }
        return entry;
      }
      const type = e.type === 'warning' ? 'warn' : e.type;
      return h('div', { class: `console-entry ${type}` }, h('div', { class: 'console-line' },
        h('span', { class: 'console-ts' }, time(e.ts)),
        h('span', { class: 'console-kind' }, KIND_ICON[type] || '›'),
        h('div', { class: 'console-msg' }, (e.messages || []).join(' '))));
    }

    function render() {
      const atBottom = !listEl.childElementCount || listEl.scrollTop + listEl.clientHeight >= listEl.scrollHeight - 12;
      clear(listEl);
      const entries = App.consoleEntries.filter(matches);
      if (!entries.length) listEl.appendChild(h('div', { class: 'console-empty' }, App.consoleEntries.length ? 'No entries match the current filter' : 'Network requests and console.log() output from scripts will appear here'));
      else entries.forEach((e) => listEl.appendChild(renderEntry(e)));
      if (atBottom) listEl.scrollTop = listEl.scrollHeight;
    }

    const searchInput = h('input', { class: 'input', placeholder: 'Search', 'aria-label': 'Search console' });
    searchInput.addEventListener('input', () => { search = searchInput.value.trim().toLowerCase(); render(); });
    listEl = h('div', { class: 'console-list' });
    el.append(
      h('div', { class: 'console-toolbar' },
        h('b', null, 'Console'),
        UI.selectEl([['all', 'All logs'], ['log', 'Log'], ['info', 'Info'], ['warn', 'Warning'], ['error', 'Error'], ['network', 'Network']], filter, (v) => { filter = v; render(); }),
        h('div', { class: 'search-box' }, icon('search', 13), searchInput),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn btn-small btn-ghost', type: 'button', onclick: () => App.clearConsole() }, icon('trash', 13), 'Clear'),
        iconButton('x', 'Close console', () => App.toggleConsole(false))),
      listEl);

    return {
      el,
      update() {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => { scheduled = false; render(); });
      }
    };
  }

  root.Views.console = { create };
})(window);
