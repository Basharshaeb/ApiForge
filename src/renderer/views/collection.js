/**
 * Collection / folder editor: overview, authorization, scripts, variables.
 */
(function (root) {
  'use strict';

  root.Views = root.Views || {};
  const M = root.ApiForgeModel;
  const UI = root.UI;
  const { h, clear, icon, iconButton } = UI;

  /** Compact auth editor shared by collections and folders. */
  function authEditor({ auth, getVars, onChange, allowInherit }) {
    const wrap = h('div', { class: 'auth-form' });
    const types = M.AUTH_TYPES.filter((a) => allowInherit || a.type !== 'inherit');
    function render() {
      clear(wrap);
      const sel = UI.selectEl(types.map((a) => [a.type, a.label]), auth.type, (v) => {
        auth.type = v;
        auth.params = { ...M.defaultAuthParams(v) };
        onChange();
        render();
      }, { style: { width: '260px' } });
      const fields = h('div');
      const schema = M.AUTH_BY_TYPE[auth.type];
      if (auth.type === 'inherit') fields.appendChild(h('div', { class: 'auth-inherit' }, icon('info', 16), 'Requests in this folder inherit the collection authorization unless they override it.'));
      else if (auth.type === 'noauth') fields.appendChild(h('div', { class: 'auth-inherit' }, icon('info', 16), 'Requests inheriting from here will not use authorization.'));
      else if (schema) {
        const advanced = h('div');
        schema.fields.forEach((f) => {
          if (f.when && Object.entries(f.when).some(([k, v]) => (auth.params[k] === undefined ? M.defaultAuthParams(auth.type)[k] : auth.params[k]) !== v)) return;
          const value = auth.params[f.key] === undefined ? (f.default === undefined ? '' : f.default) : auth.params[f.key];
          let input;
          if (f.input === 'select') input = UI.selectEl(f.options, String(value), (v) => { auth.params[f.key] = v; onChange(); render(); });
          else if (f.input === 'bool') { (f.advanced ? advanced : fields).appendChild(h('div', { class: 'field' }, UI.toggle(f.label, !!value, (v) => { auth.params[f.key] = v; onChange(); }))); return; }
          else if (f.input === 'textarea') input = UI.varInput({ value, getVars, multiline: true, className: 'boxed', onInput: (v) => { auth.params[f.key] = v; onChange(); } });
          else {
            input = UI.varInput({ value, getVars, className: 'boxed', onInput: (v) => { auth.params[f.key] = v; onChange(); } });
            if (f.input === 'secret') input.setMasked(true);
          }
          (f.advanced ? advanced : fields).appendChild(h('label', { class: 'field' }, h('span', { class: 'field-label' }, f.label), input));
        });
        if (advanced.childElementCount) fields.appendChild(h('details', { class: 'advanced' }, h('summary', null, 'Advanced'), advanced));
      }
      wrap.appendChild(h('div', { class: 'auth-layout' }, h('div', null, h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Auth Type'), sel)), fields));
    }
    render();
    return wrap;
  }

  function collectionView(tab) {
    const App = root.App;
    const el = h('div', { class: 'view' });
    let sidebarTimer = null;
    const refreshSidebarSoon = () => { clearTimeout(sidebarTimer); sidebarTimer = setTimeout(() => App.renderSidebar(), 600); };

    function render() {
      clear(el);
      const c = App.findCollection(tab.collectionId);
      if (!c) { el.appendChild(UI.emptyState('collections', 'Collection not found', 'It may have been deleted.')); return; }
      const hit = tab.nodeId ? M.findNode(c, tab.nodeId) : null;
      if (tab.nodeId && !hit) { el.appendChild(UI.emptyState('folder', 'Folder not found', 'It may have been deleted.')); return; }
      const node = hit ? hit.node : null;
      const target = node || c;
      const getVars = () => App.vars(tab.collectionId);
      const save = () => { App.save(); };

      const name = h('input', { class: 'title-input', value: node ? node.name : c.info.name, spellcheck: false, 'aria-label': 'Name' });
      name.addEventListener('input', () => { if (node) node.name = name.value; else c.info.name = name.value; save(); App.notify({ tabbar: true }); refreshSidebarSoon(); });
      const crumbs = node ? [c.info.name, ...hit.ancestors.map((a) => a.name)] : [];
      const header = h('div', { class: 'view-header' },
        icon(node ? 'folder' : 'collections', 16),
        crumbs.length ? h('div', { class: 'breadcrumb' }, crumbs.flatMap((x, i) => [i ? h('span', { class: 'sep' }, '/') : null, h('span', { class: 'crumb' }, x)]), h('span', { class: 'sep' }, '/')) : null,
        name,
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn btn-small btn-secondary', type: 'button', onclick: () => App.openRunner(tab.collectionId, node ? node.id : '') }, icon('runner', 14), 'Run'),
        h('button', { class: 'btn btn-small btn-secondary', type: 'button', onclick: () => App.addRequest(tab.collectionId, node ? node.id : null) }, icon('plus', 14), 'Add request'),
        iconButton('more', 'More', (e) => UI.menu(e.currentTarget, [
          { label: 'Add Folder', icon: 'folder', onClick: () => App.addFolder(tab.collectionId, node ? node.id : null) },
          node ? null : { label: 'Export', icon: 'download', onClick: () => App.exportCollection(c) },
          'separator',
          { label: 'Delete', icon: 'trash', danger: true, onClick: () => (node ? App.deleteNode(tab.collectionId, node.id) : App.deleteCollection(c)) }
        ], { alignRight: true })));

      const tabs = [{ id: 'overview', label: 'Overview' }, { id: 'auth', label: 'Authorization' }, { id: 'scripts', label: 'Scripts' }];
      if (!node) tabs.push({ id: 'variables', label: 'Variables', badge: (c.variable || []).filter((v) => v.key).length || null });
      const body = h('div', { class: 'doc-view' });
      const subtabs = UI.tabStrip(tabs, tab.subtab, (id) => { tab.subtab = id; save(); render(); });
      el.append(header, subtabs, body);

      if (tab.subtab === 'overview') {
        const desc = h('textarea', { class: 'textarea', placeholder: 'Describe what this ' + (node ? 'folder' : 'collection') + ' is for…' });
        desc.value = node ? (node.description || '') : (c.info.description || '');
        desc.addEventListener('input', () => { if (node) node.description = desc.value; else c.info.description = desc.value; save(); });
        body.append(h('h3', null, 'Description'), desc,
          h('h3', null, 'Contents'),
          h('div', { class: 'doc-note' }, `${M.countRequests(target.item)} requests · ${countFolders(target.item)} folders`));
      } else if (tab.subtab === 'auth') {
        const auth = M.authFromV2(target.auth);
        if (!node && auth.type === 'inherit') auth.type = 'noauth';
        body.append(h('div', { class: 'doc-note' }, node ? 'Requests in this folder use this authorization unless they set their own.' : 'Requests in this collection use this authorization unless a folder or the request overrides it.'),
          authEditor({ auth, getVars, allowInherit: !!node, onChange: () => { const v2 = M.authToV2(auth); if (v2) target.auth = v2; else delete target.auth; save(); } }));
      } else if (tab.subtab === 'scripts') {
        tab.scriptTab = tab.scriptTab || 'prerequest';
        const scripts = M.scriptsFromEvents(target.event);
        const editor = UI.codeEditor({ value: scripts[tab.scriptTab], language: 'javascript', minHeight: 260, placeholder: tab.scriptTab === 'prerequest' ? '// Runs before every request in this ' + (node ? 'folder' : 'collection') : '// Runs after every response in this ' + (node ? 'folder' : 'collection'), onInput: (v) => { scripts[tab.scriptTab] = v; target.event = M.eventsFromScripts(scripts, target.event); if (!target.event.length) delete target.event; save(); } });
        body.append(h('div', { class: 'pane-toolbar sub', style: { padding: 0, background: 'transparent', border: 'none' } }, UI.tabStrip([{ id: 'prerequest', label: 'Pre-request' }, { id: 'test', label: 'Post-response' }], tab.scriptTab, (id) => { tab.scriptTab = id; render(); }, 'pill')),
          h('div', { class: 'doc-note' }, 'These scripts run for every request inside, before the request\'s own scripts.'),
          h('div', { style: { height: '320px', display: 'flex' } }, editor));
      } else if (tab.subtab === 'variables') {
        const rows = (c.variable || []).map((v) => M.row(v.key || '', v.value == null ? '' : String(v.value), !v.disabled, { type: v.type === 'secret' ? 'secret' : 'default' }));
        body.append(h('div', { class: 'doc-note' }, 'Collection variables are available to every request in this collection and override globals. Environment variables with the same name take precedence.'),
          UI.kvEditor({ rows, types: true, keyPlaceholder: 'Variable', valuePlaceholder: 'Value', onChange: () => {
            c.variable = rows.filter((r) => r.key).map((r) => ({ key: r.key, value: r.value, type: r.type === 'secret' ? 'secret' : 'string', ...(r.enabled === false ? { disabled: true } : {}) }));
            save();
          } }));
      }
    }

    function countFolders(nodes) {
      let n = 0;
      M.walk(nodes, (x) => { if (M.isFolder(x)) n++; });
      return n;
    }

    render();
    return { el, update: render };
  }

  root.Views.collection = collectionView;
  root.Views.authEditor = authEditor;
})(window);
