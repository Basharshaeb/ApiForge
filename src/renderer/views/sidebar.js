/**
 * Sidebar: collections tree (with drag & drop), environments and history.
 */
(function (root) {
  'use strict';

  root.Views = root.Views || {};
  const M = root.ApiForgeModel;
  const UI = root.UI;
  const { h, clear, icon, iconButton, methodBadge } = UI;

  const SECTION_TITLES = { collections: 'Collections', environments: 'Environments', history: 'History' };

  function render(sidebarEl) {
    const App = root.App;
    const section = App.sidebar.section;
    let body = sidebarEl.querySelector('.sidebar-body');
    if (sidebarEl.dataset.section !== section || !body) {
      clear(sidebarEl);
      sidebarEl.dataset.section = section;
      const search = h('input', { class: 'input', placeholder: `Filter ${SECTION_TITLES[section].toLowerCase()}`, value: App.sidebar.filter || '', 'aria-label': 'Filter' });
      search.addEventListener('input', () => { App.sidebar.filter = search.value; renderBody(sidebarEl.querySelector('.sidebar-body')); });
      sidebarEl.append(
        h('div', { class: 'sidebar-header' }, h('span', { class: 'sidebar-title' }, SECTION_TITLES[section]), ...headerActions(section)),
        h('div', { class: 'sidebar-search' }, h('div', { class: 'search-box' }, icon('search', 13), search)),
        (body = h('div', { class: 'sidebar-body' })));
    }
    renderBody(body);
  }

  function headerActions(section) {
    const App = root.App;
    if (section === 'collections') {
      return [
        iconButton('plus', 'New collection', () => App.createCollection()),
        iconButton('import', 'Import', App.showImport)
      ];
    }
    if (section === 'environments') return [iconButton('plus', 'New environment', () => App.createEnvironment()), iconButton('import', 'Import', App.showImport)];
    return [iconButton('trash', 'Clear history', async () => {
      if (!App.state.history.length) return;
      if (await UI.confirm({ title: 'Clear History', message: 'Remove all history entries?', okLabel: 'Clear', danger: true })) {
        App.state.history = [];
        App.save();
        App.renderSidebar();
      }
    })];
  }

  function renderBody(body) {
    const App = root.App;
    clear(body);
    const filter = (App.sidebar.filter || '').trim().toLowerCase();
    switch (App.sidebar.section) {
      case 'collections': renderCollections(body, filter); break;
      case 'environments': renderEnvironments(body, filter); break;
      case 'history': renderHistory(body, filter); break;
      default: break;
    }
  }

  // ---------------------------------------------------------------------------
  // Collections
  // ---------------------------------------------------------------------------
  function nodeMatches(node, filter) {
    if (!filter) return true;
    if ((node.name || '').toLowerCase().includes(filter)) return true;
    if (!M.isFolder(node) && node.request) {
      const url = M.rawFromUrlObject(typeof node.request === 'string' ? node.request : node.request.url);
      return url.toLowerCase().includes(filter);
    }
    return false;
  }

  /** Set of node ids visible under a filter (matches plus their ancestors). */
  function visibleIds(collection, filter) {
    const ids = new Set();
    M.walk(collection.item, (node, ancestors) => {
      if (nodeMatches(node, filter)) {
        ids.add(node.id);
        ancestors.forEach((a) => ids.add(a.id));
      }
    });
    return ids;
  }

  function renderCollections(body, filter) {
    const App = root.App;
    const collections = App.state.collections;
    if (!collections.length) {
      body.appendChild(h('div', { class: 'sidebar-empty' }, 'Collections group related requests so you can organize and run them together.',
        h('br'), h('button', { class: 'btn btn-primary btn-small', type: 'button', onclick: () => App.createCollection() }, 'Create Collection')));
      return;
    }
    const active = App.activeTab();
    collections.forEach((c) => {
      const cid = c.info._postman_id;
      const visible = filter ? visibleIds(c, filter) : null;
      if (filter && !visible.size && !c.info.name.toLowerCase().includes(filter)) return;
      const expanded = filter ? true : App.expanded.has(cid);
      const row = h('div', {
        class: `tree-row collection${active && active.type === 'collection' && active.collectionId === cid && !active.nodeId ? ' selected' : ''}`,
        dataset: { collection: cid },
        onclick: () => toggleExpand(cid),
        oncontextmenu: (e) => { e.preventDefault(); collectionMenu(c, null, { x: e.clientX, y: e.clientY }); }
      },
      h('span', { class: `chevron${expanded ? ' open' : ''}` }, icon('chevron', 12)),
      icon('collections', 14),
      h('span', { class: 'tree-name', title: c.info.name }, c.info.name),
      h('span', { class: 'row-actions' },
        iconButton('play', 'Run collection', (e) => { e.stopPropagation(); App.openRunner(cid); }),
        iconButton('plus', 'Add request', (e) => { e.stopPropagation(); App.addRequest(cid, null); }),
        iconButton('more', 'More actions', (e) => { e.stopPropagation(); collectionMenu(c, e.currentTarget); })));
      makeDropTarget(row, { collectionId: cid, parentId: null, beforeId: null });
      body.appendChild(row);
      if (expanded) {
        const children = h('div', { class: 'tree-children' });
        renderChildren(children, c, c.item, 1, visible, active);
        if (!c.item.length) children.appendChild(h('div', { class: 'tree-empty', style: { padding: '8px 12px 8px 40px', textAlign: 'left' } }, 'This collection is empty. ', h('button', { class: 'link-btn', type: 'button', onclick: () => App.addRequest(cid, null) }, 'Add a request')));
        body.appendChild(children);
      }
    });
  }

  function toggleExpand(id) {
    const App = root.App;
    if (App.expanded.has(id)) App.expanded.delete(id);
    else App.expanded.add(id);
    App.save();
    App.renderSidebar();
  }

  function renderChildren(container, collection, nodes, depth, visible, active) {
    const App = root.App;
    const cid = collection.info._postman_id;
    nodes.forEach((node) => {
      if (visible && !visible.has(node.id)) return;
      const indent = { paddingLeft: `${8 + depth * 14}px` };
      if (M.isFolder(node)) {
        const expanded = visible ? true : App.expanded.has(node.id);
        const row = h('div', {
          class: `tree-row folder${active && active.type === 'collection' && active.nodeId === node.id ? ' selected' : ''}`,
          style: indent,
          draggable: true,
          dataset: { node: node.id },
          onclick: () => toggleExpand(node.id),
          oncontextmenu: (e) => { e.preventDefault(); collectionMenu(collection, node, { x: e.clientX, y: e.clientY }); }
        },
        h('span', { class: `chevron${expanded ? ' open' : ''}` }, icon('chevron', 12)),
        h('span', { class: 'tree-icon' }, icon(expanded ? 'folder-open' : 'folder', 14)),
        h('span', { class: 'tree-name', title: node.name }, node.name),
        h('span', { class: 'tree-count' }, M.countRequests(node.item) || ''),
        h('span', { class: 'row-actions' },
          iconButton('plus', 'Add request', (e) => { e.stopPropagation(); App.addRequest(cid, node.id); }),
          iconButton('more', 'More actions', (e) => { e.stopPropagation(); collectionMenu(collection, node, e.currentTarget); })));
        makeDraggable(row, cid, node.id);
        makeDropTarget(row, { collectionId: cid, parentId: node.id, beforeId: null });
        container.appendChild(row);
        if (expanded) renderChildren(container, collection, node.item, depth + 1, visible, active);
        return;
      }

      const method = node.request ? (typeof node.request === 'string' ? 'GET' : node.request.method) : 'GET';
      const examples = node.response || [];
      const hasExamples = examples.length > 0;
      const expanded = hasExamples && App.expanded.has(node.id);
      const selected = active && ((active.type === 'request' && active.itemId === node.id) || (active.type === 'example' && active.itemId === node.id && !expanded));
      const row = h('div', {
        class: `tree-row request${selected ? ' selected' : ''}`,
        style: indent,
        draggable: true,
        dataset: { node: node.id },
        onclick: () => App.openRequest(cid, node.id),
        oncontextmenu: (e) => { e.preventDefault(); requestMenu(collection, node, { x: e.clientX, y: e.clientY }); }
      },
      h('span', { class: `chevron${expanded ? ' open' : ''}${hasExamples ? '' : ' empty'}`, onclick: (e) => { if (hasExamples) { e.stopPropagation(); toggleExpand(node.id); } } }, icon('chevron', 12)),
      methodBadge(method, true),
      h('span', { class: 'tree-name', title: node.name }, node.name),
      h('span', { class: 'row-actions' }, iconButton('more', 'More actions', (e) => { e.stopPropagation(); requestMenu(collection, node, e.currentTarget); })));
      makeDraggable(row, cid, node.id);
      makeDropTarget(row, { collectionId: cid, parentId: parentIdOf(collection, node.id), beforeId: node.id }, true);
      container.appendChild(row);
      if (expanded) {
        examples.forEach((ex) => {
          const exSelected = active && active.type === 'example' && active.exampleId === ex.id;
          container.appendChild(h('div', {
            class: `tree-row example${exSelected ? ' selected' : ''}`,
            style: { paddingLeft: `${8 + (depth + 1) * 14 + 18}px` },
            onclick: () => App.openExample(cid, node.id, ex.id),
            oncontextmenu: (e) => { e.preventDefault(); exampleMenu(cid, node.id, ex, { x: e.clientX, y: e.clientY }); }
          },
          h('span', { class: 'tree-icon' }, icon('example', 13)),
          h('span', { class: 'tree-name', title: ex.name }, ex.name),
          h('span', { class: 'row-actions' }, iconButton('more', 'More actions', (e) => { e.stopPropagation(); exampleMenu(cid, node.id, ex, e.currentTarget); }))));
        });
      }
    });
  }

  function parentIdOf(collection, nodeId) {
    const hit = M.findNode(collection, nodeId);
    const parent = hit && hit.ancestors[hit.ancestors.length - 1];
    return parent ? parent.id : null;
  }

  // Drag & drop ---------------------------------------------------------------
  function makeDraggable(row, collectionId, nodeId) {
    const App = root.App;
    row.addEventListener('dragstart', (e) => {
      App.drag = { collectionId, nodeId };
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', nodeId);
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => {
      App.drag = null;
      row.classList.remove('dragging');
      document.querySelectorAll('.drop-target, .drop-before').forEach((el) => el.classList.remove('drop-target', 'drop-before'));
    });
  }

  function makeDropTarget(row, dest, before) {
    const App = root.App;
    row.addEventListener('dragover', (e) => {
      if (!App.drag || App.drag.nodeId === dest.beforeId || App.drag.nodeId === dest.parentId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      row.classList.add(before ? 'drop-before' : 'drop-target');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-target', 'drop-before'));
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      row.classList.remove('drop-target', 'drop-before');
      if (!App.drag) return;
      App.moveNode(App.drag, dest);
      App.drag = null;
    });
  }

  // Menus ---------------------------------------------------------------------
  function collectionMenu(collection, folder, anchor) {
    const App = root.App;
    const cid = collection.info._postman_id;
    const target = folder || collection;
    const point = anchor && anchor.x !== undefined ? { point: anchor } : undefined;
    UI.menu(point ? null : anchor, [
      { label: 'Add Request', icon: 'plus', onClick: () => App.addRequest(cid, folder ? folder.id : null) },
      { label: 'Add Folder', icon: 'folder', onClick: () => App.addFolder(cid, folder ? folder.id : null) },
      'separator',
      { label: folder ? 'Edit Folder' : 'Edit Collection', icon: 'settings', onClick: () => App.openCollectionEditor(cid, folder ? folder.id : null) },
      { label: 'Rename', onClick: () => (folder ? App.renameNode(cid, folder.id) : App.renameCollection(collection)) },
      { label: folder ? 'Run Folder' : 'Run Collection', icon: 'runner', onClick: () => App.openRunner(cid, folder ? folder.id : '') },
      { label: 'Duplicate', icon: 'copy', onClick: () => (folder ? App.duplicateNode(cid, folder.id) : App.duplicateCollection(collection)) },
      folder ? null : { label: 'Export', icon: 'download', onClick: () => App.exportCollection(collection) },
      'separator',
      { label: 'Delete', icon: 'trash', danger: true, onClick: () => (folder ? App.deleteNode(cid, folder.id) : App.deleteCollection(collection)) }
    ].filter(Boolean), { ...(point || {}), alignRight: !point });
    void target;
  }

  function requestMenu(collection, node, anchor) {
    const App = root.App;
    const cid = collection.info._postman_id;
    const point = anchor && anchor.x !== undefined ? { point: anchor } : undefined;
    UI.menu(point ? null : anchor, [
      { label: 'Open', onClick: () => App.openRequest(cid, node.id) },
      { label: 'Rename', onClick: () => App.renameNode(cid, node.id) },
      { label: 'Duplicate', icon: 'copy', onClick: () => App.duplicateNode(cid, node.id) },
      { label: 'Copy as cURL', icon: 'code', onClick: () => UI.copyText(root.ApiForgeCodegen.generate('curl', M.draftFromItem(node), (s) => M.substitute(s, App.vars(cid)))) },
      'separator',
      { label: 'Delete', icon: 'trash', danger: true, onClick: () => App.deleteNode(cid, node.id) }
    ], { ...(point || {}), alignRight: !point });
  }

  function exampleMenu(cid, itemId, ex, anchor) {
    const App = root.App;
    const point = anchor && anchor.x !== undefined ? { point: anchor } : undefined;
    UI.menu(point ? null : anchor, [
      { label: 'Open', onClick: () => App.openExample(cid, itemId, ex.id) },
      { label: 'Rename', onClick: () => App.renameExample(cid, itemId, ex.id) },
      'separator',
      { label: 'Delete', icon: 'trash', danger: true, onClick: () => App.deleteExample(cid, itemId, ex.id) }
    ], { ...(point || {}), alignRight: !point });
  }

  // ---------------------------------------------------------------------------
  // Environments
  // ---------------------------------------------------------------------------
  function renderEnvironments(body, filter) {
    const App = root.App;
    const active = App.activeTab();
    const activeId = App.state.settings.activeEnvironmentId;

    body.appendChild(h('div', { class: 'section-label' }, 'Globals'));
    body.appendChild(h('div', { class: `env-row${active && active.type === 'environment' && active.envId === 'globals' ? ' selected' : ''}`, onclick: () => App.openEnvironment('globals') },
      h('span', { class: 'env-check' }, icon('globe', 14)),
      h('span', { class: 'env-name' }, 'Globals'),
      h('span', { class: 'tree-count' }, App.state.globals.values.filter((v) => v.key).length || ''),
      h('span', { class: 'row-actions' }, iconButton('more', 'More actions', (e) => { e.stopPropagation(); UI.menu(e.currentTarget, [
        { label: 'Open', onClick: () => App.openEnvironment('globals') },
        { label: 'Export', icon: 'download', onClick: () => App.exportEnvironment({ id: 'globals', name: 'globals', values: App.state.globals.values }, 'globals') }
      ], { alignRight: true }); }))));

    body.appendChild(h('div', { class: 'section-label' }, 'Environments'));
    const envs = App.state.environments.filter((e) => !filter || e.name.toLowerCase().includes(filter));
    if (!envs.length) {
      body.appendChild(h('div', { class: 'sidebar-empty' }, filter ? 'No environments match your filter.' : 'Environments hold variables (like a base URL or token) that change between setups.',
        filter ? null : h('br'), filter ? null : h('button', { class: 'btn btn-primary btn-small', type: 'button', onclick: () => App.createEnvironment() }, 'Create Environment')));
      return;
    }
    envs.forEach((env) => {
      const isActive = env.id === activeId;
      body.appendChild(h('div', {
        class: `env-row${isActive ? ' active-env' : ''}${active && active.type === 'environment' && active.envId === env.id ? ' selected' : ''}`,
        onclick: () => App.openEnvironment(env.id),
        oncontextmenu: (e) => { e.preventDefault(); envMenu(env, { x: e.clientX, y: e.clientY }); }
      },
      h('button', { class: 'env-check', type: 'button', title: isActive ? 'Active environment' : 'Set as active', onclick: (e) => { e.stopPropagation(); App.setActiveEnvironment(isActive ? null : env.id); } }, isActive ? icon('check', 14) : h('span', { class: 'icon' })),
      h('span', { class: 'env-name', title: env.name }, env.name),
      h('span', { class: 'tree-count' }, env.values.filter((v) => v.key).length || ''),
      h('span', { class: 'row-actions' }, iconButton('more', 'More actions', (e) => { e.stopPropagation(); envMenu(env, e.currentTarget); }))));
    });
  }

  function envMenu(env, anchor) {
    const App = root.App;
    const point = anchor && anchor.x !== undefined ? { point: anchor } : undefined;
    const isActive = env.id === App.state.settings.activeEnvironmentId;
    UI.menu(point ? null : anchor, [
      { label: isActive ? 'Deactivate' : 'Set as Active', icon: 'check', onClick: () => App.setActiveEnvironment(isActive ? null : env.id) },
      { label: 'Open', onClick: () => App.openEnvironment(env.id) },
      { label: 'Rename', onClick: () => App.renameEnvironment(env) },
      { label: 'Duplicate', icon: 'copy', onClick: () => App.duplicateEnvironment(env) },
      { label: 'Export', icon: 'download', onClick: () => App.exportEnvironment(env) },
      'separator',
      { label: 'Delete', icon: 'trash', danger: true, onClick: () => App.deleteEnvironment(env) }
    ], { ...(point || {}), alignRight: !point });
  }

  // ---------------------------------------------------------------------------
  // History
  // ---------------------------------------------------------------------------
  function dayLabel(ts) {
    const d = new Date(ts);
    const today = new Date();
    const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((startOf(today) - startOf(d)) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
  }

  function statusClass(code) {
    if (!code) return 'status-err';
    return `status-${Math.floor(code / 100)}xx`;
  }

  function renderHistory(body, filter) {
    const App = root.App;
    const entries = App.state.history.filter((e) => !filter || e.url.toLowerCase().includes(filter) || (e.name || '').toLowerCase().includes(filter));
    if (!entries.length) {
      body.appendChild(h('div', { class: 'sidebar-empty' }, filter ? 'No history entries match your filter.' : 'Requests you send will show up here.'));
      return;
    }
    let lastDay = null;
    entries.forEach((entry) => {
      const day = dayLabel(entry.ts);
      if (day !== lastDay) { body.appendChild(h('div', { class: 'history-group' }, day)); lastDay = day; }
      const time = new Date(entry.ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      body.appendChild(h('div', {
        class: 'history-row',
        title: `${entry.method} ${entry.url}\n${time}${entry.error ? `\n${entry.error}` : ''}`,
        onclick: () => openHistoryEntry(entry),
        oncontextmenu: (e) => { e.preventDefault(); historyMenu(entry, { x: e.clientX, y: e.clientY }); }
      },
      methodBadge(entry.method, true),
      h('span', { class: 'history-url' }, entry.name || entry.url),
      h('span', { class: `history-status ${statusClass(entry.status)}` }, entry.status || (entry.error ? 'ERR' : '')),
      h('span', { class: 'row-actions' }, iconButton('more', 'More actions', (e) => { e.stopPropagation(); historyMenu(entry, e.currentTarget); }))));
    });
  }

  function openHistoryEntry(entry) {
    const App = root.App;
    if (entry.collectionId && entry.itemId && App.findCollection(entry.collectionId) && M.findNode(App.findCollection(entry.collectionId), entry.itemId)) {
      App.openRequest(entry.collectionId, entry.itemId);
      return;
    }
    App.newRequest(M.clone(entry.draft));
  }

  function historyMenu(entry, anchor) {
    const App = root.App;
    const point = anchor && anchor.x !== undefined ? { point: anchor } : undefined;
    UI.menu(point ? null : anchor, [
      { label: 'Open', onClick: () => openHistoryEntry(entry) },
      { label: 'Open as new request', onClick: () => App.newRequest(M.clone(entry.draft)) },
      'separator',
      { label: 'Delete', icon: 'trash', danger: true, onClick: () => { App.state.history = App.state.history.filter((e) => e !== entry); App.save(); App.renderSidebar(); } }
    ], { ...(point || {}), alignRight: !point });
  }

  root.Views.sidebar = { render };
})(window);
