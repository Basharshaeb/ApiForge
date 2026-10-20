/**
 * ApiForge renderer core: application state, tabs, persistence, the request
 * send pipeline and the shell layout (top bar, rail, sidebar, tab bar,
 * console). Views live in ./views and talk to this object through window.App.
 */
(function (root) {
  'use strict';

  const M = root.ApiForgeModel;
  const UI = root.UI;
  const Views = root.Views;
  const { h, clear, icon, iconButton, methodBadge, toast } = UI;
  const api = root.apiforge;
  const GITHUB_URL = 'https://github.com/Basharshaeb';

  const App = {
    state: null,
    tabs: [],
    activeTabId: null,
    views: new Map(),
    handlers: new Map(),
    consoleEntries: [],
    consoleOpen: false,
    consoleHeight: 260,
    consoleView: null,
    expanded: new Set(),
    sidebar: { section: 'collections', width: 300, collapsed: false, filter: '' },
    els: {},
    drag: null
  };
  root.App = App;
  App.GITHUB_URL = GITHUB_URL;

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  function stable(value) {
    return JSON.stringify(value, (k, v) => (v && typeof v === 'object' && !Array.isArray(v)) ? Object.keys(v).sort().reduce((o, key) => { o[key] = v[key]; return o; }, {}) : v);
  }
  App.stable = stable;

  App.findCollection = (id) => App.state.collections.find((c) => c.info._postman_id === id) || null;
  App.findEnvironment = (id) => App.state.environments.find((e) => e.id === id) || null;
  App.activeEnvironment = () => App.findEnvironment(App.state.settings.activeEnvironmentId);

  App.vars = (collectionId) => {
    const scopes = [{ source: 'Globals', values: App.state.globals.values }];
    const c = collectionId ? App.findCollection(collectionId) : null;
    if (c) scopes.push({ source: 'Collection', values: (c.variable || []).map((v) => ({ key: v.key, value: v.value, enabled: !v.disabled })) });
    const env = App.activeEnvironment();
    if (env) scopes.push({ source: env.name, values: env.values });
    return M.resolveVariables(scopes);
  };

  App.requestOptions = () => {
    const s = App.state.settings;
    return {
      strictSSL: s.strictSSL !== false,
      followRedirects: s.followRedirects !== false,
      requestTimeout: Number(s.requestTimeout) || 0,
      proxy: s.proxy || null,
      ignoreProxyEnv: !!s.ignoreProxyEnv,
      certificates: Array.isArray(s.certificates) ? s.certificates : [],
      caCertPath: s.caCertPath || ''
    };
  };

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------
  let saveTimer = null;
  App.save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(App.persist, 300); };
  App.persist = () => {
    clearTimeout(saveTimer);
    saveTimer = null;
    const s = App.state;
    s.ui = {
      tabs: App.tabs.map(serializeTab).filter(Boolean),
      activeTabId: App.activeTabId,
      sidebar: App.sidebar.section,
      sidebarWidth: App.sidebar.width,
      sidebarCollapsed: App.sidebar.collapsed,
      expanded: [...App.expanded],
      consoleHeight: App.consoleHeight
    };
    return api.store.save({ collections: s.collections, environments: s.environments, globals: s.globals, history: s.history, settings: s.settings, ui: s.ui });
  };

  function serializeTab(t) {
    const base = { id: t.id, type: t.type };
    switch (t.type) {
      case 'request': return { ...base, collectionId: t.collectionId, itemId: t.itemId, draft: t.draft, saved: t.saved, subtab: t.subtab, respTab: t.respTab, reqPaneHeight: t.reqPaneHeight };
      case 'example': return { ...base, collectionId: t.collectionId, itemId: t.itemId, exampleId: t.exampleId };
      case 'websocket': return { ...base, url: t.url, headers: t.headers, protocols: t.protocols, subtab: t.subtab };
      case 'environment': return { ...base, envId: t.envId };
      case 'collection': return { ...base, collectionId: t.collectionId, nodeId: t.nodeId, subtab: t.subtab };
      case 'runner': return { ...base, collectionId: t.collectionId, config: t.config };
      default: return null;
    }
  }

  function normalizeDraft(d) {
    const empty = M.emptyDraft();
    const draft = { ...empty, ...(d || {}) };
    draft.body = { ...empty.body, ...(draft.body || {}) };
    draft.body.graphql = { query: '', variables: '', ...(draft.body.graphql || {}) };
    draft.scripts = { prerequest: '', test: '', ...(draft.scripts || {}) };
    draft.auth = draft.auth && draft.auth.type ? { type: draft.auth.type, params: draft.auth.params || {} } : { type: 'inherit', params: {} };
    draft.settings = draft.settings || {};
    ['params', 'pathVars', 'headers'].forEach((k) => { if (!Array.isArray(draft[k])) draft[k] = []; });
    if (!draft.params.length && draft.url) M.syncFromUrl(draft);
    return draft;
  }

  function requestTabState(extra) {
    return { response: null, error: null, tests: [], scriptErrors: [], cookies: [], requestSent: null, visualizer: null, running: null, subtab: 'params', respTab: 'body', ...extra };
  }

  function reviveTab(t) {
    if (!t || !t.id || !t.type) return null;
    switch (t.type) {
      case 'request': {
        let { collectionId, itemId } = t;
        const c = collectionId ? App.findCollection(collectionId) : null;
        if (!c) { collectionId = null; itemId = null; }
        else if (!itemId || !M.findNode(c, itemId)) itemId = null;
        return requestTabState({ ...t, collectionId, itemId, draft: normalizeDraft(t.draft), saved: itemId ? t.saved : null });
      }
      case 'example': {
        const c = App.findCollection(t.collectionId);
        const hit = c && M.findNode(c, t.itemId);
        if (!hit || !(hit.node.response || []).some((r) => r.id === t.exampleId)) return null;
        return { ...t };
      }
      case 'websocket':
        return { ...t, url: t.url || '', headers: Array.isArray(t.headers) ? t.headers : [], protocols: t.protocols || '', subtab: t.subtab || 'message', messages: [], status: 'disconnected', connId: null };
      case 'environment':
        return t.envId === 'globals' || App.findEnvironment(t.envId) ? { ...t } : null;
      case 'collection': {
        const c = App.findCollection(t.collectionId);
        if (!c) return null;
        if (t.nodeId && !M.findNode(c, t.nodeId)) return null;
        return { ...t, subtab: t.subtab || 'overview' };
      }
      case 'runner':
        return App.findCollection(t.collectionId) ? { ...t, config: t.config || {}, result: null, running: null } : null;
      default:
        return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Tabs
  // ---------------------------------------------------------------------------
  function tabKey(t) {
    switch (t.type) {
      case 'request': return t.itemId ? `request:${t.collectionId}:${t.itemId}` : null;
      case 'example': return `example:${t.exampleId}`;
      case 'environment': return `environment:${t.envId}`;
      case 'collection': return `collection:${t.collectionId}:${t.nodeId || ''}`;
      case 'runner': return `runner:${t.collectionId}`;
      default: return null;
    }
  }

  App.activeTab = () => App.tabs.find((t) => t.id === App.activeTabId) || null;

  App.openTab = (desc) => {
    const key = tabKey(desc);
    let tab = key ? App.tabs.find((t) => tabKey(t) === key) : null;
    if (!tab) {
      tab = { id: M.uid(), ...desc };
      const activeIndex = App.tabs.findIndex((t) => t.id === App.activeTabId);
      App.tabs.splice(activeIndex >= 0 ? activeIndex + 1 : App.tabs.length, 0, tab);
    }
    App.activateTab(tab.id);
    return tab;
  };

  App.newRequest = (draft, extra) => App.openTab(requestTabState({ type: 'request', collectionId: null, itemId: null, draft: normalizeDraft(draft), saved: null, ...(extra || {}) }));

  App.openRequest = (collectionId, itemId) => {
    const c = App.findCollection(collectionId);
    const hit = c && M.findNode(c, itemId);
    if (!hit || M.isFolder(hit.node)) return null;
    const existing = App.tabs.find((t) => t.type === 'request' && t.collectionId === collectionId && t.itemId === itemId);
    if (existing) return App.activateTab(existing.id);
    const draft = M.draftFromItem(hit.node);
    return App.openTab(requestTabState({ type: 'request', collectionId, itemId, draft, saved: stable(draft) }));
  };

  App.openExample = (collectionId, itemId, exampleId) => App.openTab({ type: 'example', collectionId, itemId, exampleId });
  App.openEnvironment = (envId) => App.openTab({ type: 'environment', envId });
  App.openCollectionEditor = (collectionId, nodeId) => App.openTab({ type: 'collection', collectionId, nodeId: nodeId || null, subtab: 'overview' });
  App.openRunner = (collectionId, folderId) => {
    const tab = App.openTab({ type: 'runner', collectionId, config: {}, result: null, running: null });
    if (folderId !== undefined) { tab.config.folderId = folderId; App.updateTab(tab.id); }
    return tab;
  };
  App.openWebSocket = (url) => App.openTab({ type: 'websocket', url: url || '', headers: [], protocols: '', subtab: 'message', messages: [], status: 'disconnected', connId: null });

  App.activateTab = (id) => {
    const tab = App.tabs.find((t) => t.id === id);
    if (!tab) return null;
    App.activeTabId = id;
    mountActive();
    renderTabbar();
    App.save();
    return tab;
  };

  function draftHasContent(d) {
    return !!(d.url.trim() || d.headers.some((r) => !M.isBlankRow(r)) || d.body.mode !== 'none' || d.scripts.prerequest.trim() || d.scripts.test.trim() || d.auth.type !== 'inherit');
  }

  App.isDirty = (tab) => {
    if (!tab || tab.type !== 'request') return false;
    return tab.itemId ? stable(tab.draft) !== tab.saved : draftHasContent(tab.draft);
  };

  App.tabTitle = (tab) => {
    switch (tab.type) {
      case 'request': {
        if (tab.itemId) return tab.draft.name || 'Untitled Request';
        if (tab.draft.name && tab.draft.name !== 'Untitled Request') return tab.draft.name;
        return tab.draft.url.trim() || 'Untitled Request';
      }
      case 'example': {
        const c = App.findCollection(tab.collectionId);
        const hit = c && M.findNode(c, tab.itemId);
        const ex = hit && (hit.node.response || []).find((r) => r.id === tab.exampleId);
        return ex ? ex.name : 'Example';
      }
      case 'websocket': return tab.url.trim() || 'New WebSocket Request';
      case 'environment': return tab.envId === 'globals' ? 'Globals' : ((App.findEnvironment(tab.envId) || {}).name || 'Environment');
      case 'collection': {
        const c = App.findCollection(tab.collectionId);
        if (!c) return 'Collection';
        if (!tab.nodeId) return c.info.name;
        const hit = M.findNode(c, tab.nodeId);
        return hit ? hit.node.name : 'Folder';
      }
      case 'runner': {
        const c = App.findCollection(tab.collectionId);
        return `Run ${c ? c.info.name : ''}`.trim();
      }
      default: return 'Tab';
    }
  };

  App.closeTab = async (id, force) => {
    const tab = App.tabs.find((t) => t.id === id);
    if (!tab) return false;
    if (!force && App.isDirty(tab)) {
      App.activateTab(id);
      const answer = await UI.choice({
        title: 'Unsaved changes',
        message: `"${App.tabTitle(tab)}" has unsaved changes. Save before closing?`,
        options: [{ label: 'Cancel', value: null }, { label: "Don't save", value: 'discard', danger: true }, { label: 'Save', value: 'save', primary: true }]
      });
      if (!answer) return false;
      if (answer === 'save' && !(await App.saveRequestTab(tab))) return false;
    }
    if (tab.type === 'request' && tab.running) App.abort(tab.running);
    if (tab.type === 'websocket' && tab.connId) api.ws.close(tab.connId);
    if (tab.type === 'runner' && tab.running) App.abort(tab.running);
    const index = App.tabs.indexOf(tab);
    App.tabs.splice(index, 1);
    const view = App.views.get(id);
    if (view) { if (view.destroy) view.destroy(); App.views.delete(id); }
    if (App.activeTabId === id) {
      const next = App.tabs[index] || App.tabs[index - 1];
      App.activeTabId = next ? next.id : null;
    }
    mountActive();
    renderTabbar();
    App.save();
    return true;
  };

  App.closeOtherTabs = async (keepId) => {
    for (const t of [...App.tabs]) if (t.id !== keepId && !(await App.closeTab(t.id))) return;
  };
  App.closeAllTabs = async () => {
    for (const t of [...App.tabs]) if (!(await App.closeTab(t.id))) return;
  };

  App.updateTab = (id) => {
    const view = App.views.get(id);
    if (!view) return;
    if (id === App.activeTabId) view.update();
    else view.stale = true;
  };

  App.markDirty = (tab) => {
    renderTabbarItem(tab);
    const view = App.views.get(tab.id);
    if (view && view.markDirty) view.markDirty();
    App.save();
  };

  App.notify = ({ sidebar, tabs, tabbar } = {}) => {
    if (sidebar) renderSidebar();
    if (sidebar || tabbar || tabs) { renderTabbar(); renderEnvSelect(); }
    const ids = tabs === 'all' ? App.tabs.map((t) => t.id) : (tabs || []);
    ids.forEach((id) => App.updateTab(id));
  };

  /** Close tabs whose backing item/collection/environment disappeared. */
  function closeTabsWhere(pred) {
    App.tabs.filter(pred).forEach((t) => App.closeTab(t.id, true));
  }

  // ---------------------------------------------------------------------------
  // Runtime plumbing
  // ---------------------------------------------------------------------------
  App.registerHandler = (id, fn) => App.handlers.set(id, fn);
  App.unregisterHandler = (id) => App.handlers.delete(id);

  App.execute = (job, handler) => {
    App.handlers.set(job.id, handler);
    return api.runtime.execute(job).catch((err) => {
      handler({ id: job.id, event: 'exception', data: { cursor: null, error: { name: 'Error', message: err.message } } });
      handler({ id: job.id, event: 'done', data: { error: { name: 'Error', message: err.message } } });
      App.handlers.delete(job.id);
    });
  };
  App.abort = (id) => api.runtime.abort(id);

  function onRuntimeEvent(msg) {
    const fn = App.handlers.get(msg.id);
    if (fn) fn(msg);
    if (msg.event === 'done' || msg.event === 'ws:close') App.handlers.delete(msg.id);
  }

  /** Run a throwaway collection and resolve with the first request result. */
  App.runAdhoc = (collection, options) => new Promise((resolve) => {
    const id = M.uid();
    const env = App.activeEnvironment();
    let request = null;
    App.execute({
      id,
      collection,
      environment: env ? M.scopeFromRows(env.values) : { values: [] },
      globals: M.scopeFromRows(App.state.globals.values),
      options: { ...App.requestOptions(), ...(options || {}) }
    }, (msg) => {
      if (msg.event === 'request') request = msg.data;
      if (msg.event === 'done') resolve({ request, done: msg.data });
    });
  });

  // ---------------------------------------------------------------------------
  // Send pipeline
  // ---------------------------------------------------------------------------
  App.sendRequest = (tab) => {
    if (tab.running) { App.abort(tab.running); return; }
    const draft = tab.draft;
    if (!draft.url.trim()) { toast('Enter a request URL', 'warning'); return; }
    const collection = tab.collectionId ? App.findCollection(tab.collectionId) : null;
    const savedHit = collection && tab.itemId ? M.findNode(collection, tab.itemId) : null;
    const item = M.itemFromDraft(draft, savedHit ? savedHit.node : null);
    const runCollection = M.buildRunCollection(collection, tab.itemId, item);
    const env = App.activeEnvironment();
    const id = M.uid();
    const started = Date.now();
    const vars = App.vars(tab.collectionId);

    Object.assign(tab, { running: id, response: null, error: null, tests: [], scriptErrors: [], cookies: [], requestSent: null, visualizer: null });
    App.updateTab(tab.id);

    const entry = { id, type: 'network', ts: started, method: draft.method, url: M.substitute(draft.url, vars), pending: true, tabId: tab.id };
    App.log(entry);

    App.execute({
      id,
      collection: runCollection,
      environment: env ? M.scopeFromRows(env.values) : { values: [] },
      globals: M.scopeFromRows(App.state.globals.values),
      options: App.requestOptions()
    }, (msg) => {
      const { event, data } = msg;
      switch (event) {
        case 'request':
          tab.response = data.response;
          tab.error = data.error;
          tab.requestSent = data.request;
          tab.cookies = data.cookies || [];
          Object.assign(entry, {
            pending: false,
            status: data.response ? data.response.code : null,
            statusText: data.response ? data.response.status : null,
            time: data.response ? data.response.responseTime : Date.now() - started,
            size: data.response ? data.response.size.total : null,
            error: data.error,
            request: data.request,
            response: data.response ? { ...data.response, body: data.response.body == null ? null : data.response.body.slice(0, 50000), bodyBase64: null } : null
          });
          if (data.request) entry.url = data.request.url;
          App.refreshConsole();
          break;
        case 'assertion':
          tab.tests.push(...data.assertions);
          break;
        case 'script':
          data.errors.forEach((e) => {
            tab.scriptErrors.push({ target: data.target, ...e });
            App.log({ type: 'error', ts: Date.now(), messages: [`${data.target === 'test' ? 'Post-response' : 'Pre-request'} script error: ${e.message}`], tabId: tab.id });
          });
          break;
        case 'console':
          App.log({ type: data.level, ts: Date.now(), messages: data.messages, tabId: tab.id });
          break;
        case 'exception':
          if (!tab.error) tab.error = data.error;
          App.log({ type: 'error', ts: Date.now(), messages: [data.error ? data.error.message : 'Unknown error'], tabId: tab.id });
          break;
        case 'item':
          tab.visualizer = data.visualizer;
          break;
        case 'done':
          tab.running = null;
          if (data.error && !tab.error) tab.error = data.error;
          if (data.aborted && !tab.response && !tab.error) tab.error = { name: 'Aborted', message: 'Request was cancelled' };
          if (entry.pending) { entry.pending = false; entry.error = tab.error; entry.time = Date.now() - started; }
          App.mergeScopes(data);
          App.addHistory(tab, started);
          App.refreshConsole();
          App.save();
          break;
        default:
          break;
      }
      App.updateTab(tab.id);
    });
  };

  App.mergeScopes = (data) => {
    if (!data) return;
    const env = App.activeEnvironment();
    const before = env ? stable(env.values) : null;
    const gBefore = stable(App.state.globals.values);
    if (env && data.environment) env.values = M.mergeScopeIntoRows(env.values, data.environment);
    if (data.globals) App.state.globals.values = M.mergeScopeIntoRows(App.state.globals.values, data.globals);
    const envChanged = env && stable(env.values) !== before;
    const globalsChanged = stable(App.state.globals.values) !== gBefore;
    if (envChanged || globalsChanged) {
      App.save();
      App.tabs.filter((t) => t.type === 'environment' && ((envChanged && t.envId === env.id) || (globalsChanged && t.envId === 'globals'))).forEach((t) => App.updateTab(t.id));
    }
  };

  App.addHistory = (tab, started) => {
    const limit = Number(App.state.settings.historyLimit) || 200;
    App.state.history.unshift({
      id: M.uid(),
      ts: started,
      method: tab.draft.method,
      url: tab.draft.url,
      name: tab.itemId ? tab.draft.name : '',
      status: tab.response ? tab.response.code : null,
      time: tab.response ? tab.response.responseTime : null,
      error: tab.error ? tab.error.message : null,
      draft: M.clone(tab.draft),
      collectionId: tab.collectionId,
      itemId: tab.itemId
    });
    if (App.state.history.length > limit) App.state.history.length = limit;
    if (App.sidebar.section === 'history') renderSidebar();
  };

  // ---------------------------------------------------------------------------
  // Console
  // ---------------------------------------------------------------------------
  App.log = (entry) => {
    App.consoleEntries.push(entry);
    if (App.consoleEntries.length > 1000) App.consoleEntries.splice(0, App.consoleEntries.length - 1000);
    App.refreshConsole();
  };
  App.clearConsole = () => { App.consoleEntries.length = 0; App.refreshConsole(); };
  App.refreshConsole = () => {
    if (App.consoleView && App.consoleOpen) App.consoleView.update();
    renderStatusbar();
  };
  App.toggleConsole = (open) => {
    App.consoleOpen = open === undefined ? !App.consoleOpen : !!open;
    renderConsole();
    renderStatusbar();
  };

  // ---------------------------------------------------------------------------
  // Collections
  // ---------------------------------------------------------------------------
  App.createCollection = async (name) => {
    const n = name || await UI.prompt({ title: 'New Collection', label: 'Name', value: 'New Collection', okLabel: 'Create' });
    if (!n) return null;
    const c = M.newCollection(n);
    App.state.collections.push(c);
    App.expanded.add(c.info._postman_id);
    App.save();
    App.notify({ sidebar: true });
    return c;
  };

  App.renameCollection = async (c) => {
    const n = await UI.prompt({ title: 'Rename Collection', label: 'Name', value: c.info.name });
    if (!n) return;
    c.info.name = n;
    App.save();
    App.notify({ sidebar: true, tabs: 'all' });
  };

  App.deleteCollection = async (c) => {
    const ok = await UI.confirm({ title: 'Delete Collection', message: `Delete "${c.info.name}" and all its requests? This cannot be undone.`, okLabel: 'Delete', danger: true });
    if (!ok) return;
    const id = c.info._postman_id;
    App.state.collections = App.state.collections.filter((x) => x !== c);
    closeTabsWhere((t) => (t.type === 'request' && t.itemId && t.collectionId === id) || ((t.type === 'collection' || t.type === 'runner' || t.type === 'example') && t.collectionId === id));
    App.tabs.filter((t) => t.type === 'request' && t.collectionId === id).forEach((t) => { t.collectionId = null; t.itemId = null; });
    App.save();
    App.notify({ sidebar: true, tabs: 'all' });
  };

  App.duplicateCollection = (c) => {
    const copy = M.clone(c);
    copy.info._postman_id = M.uid();
    copy.info.name = `${c.info.name} Copy`;
    M.walk(copy.item, (n) => { n.id = M.uid(); (n.response || []).forEach((r) => { r.id = M.uid(); }); });
    App.state.collections.splice(App.state.collections.indexOf(c) + 1, 0, copy);
    App.save();
    App.notify({ sidebar: true });
  };

  App.exportCollection = async (c) => {
    const data = M.clone(c);
    data.info.schema = M.SCHEMA_V21;
    const file = await api.files.saveText({ defaultName: `${c.info.name.replace(/[\\/:*?"<>|]+/g, '_')}.postman_collection.json`, content: JSON.stringify(data, null, 2), filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (file) toast(`Exported to ${file}`, 'success');
  };

  App.addRequest = async (collectionId, parentId) => {
    const c = App.findCollection(collectionId);
    if (!c) return;
    const item = M.newRequestItem('New Request');
    M.insertNode(c, parentId || null, item);
    App.expanded.add(collectionId);
    if (parentId) App.expanded.add(parentId);
    App.save();
    App.notify({ sidebar: true });
    App.openRequest(collectionId, item.id);
  };

  App.addFolder = async (collectionId, parentId) => {
    const c = App.findCollection(collectionId);
    if (!c) return;
    const name = await UI.prompt({ title: 'New Folder', label: 'Name', value: 'New Folder', okLabel: 'Create' });
    if (!name) return;
    const folder = M.newFolder(name);
    M.insertNode(c, parentId || null, folder);
    App.expanded.add(collectionId);
    if (parentId) App.expanded.add(parentId);
    App.expanded.add(folder.id);
    App.save();
    App.notify({ sidebar: true });
  };

  App.renameNode = async (collectionId, nodeId) => {
    const c = App.findCollection(collectionId);
    const hit = c && M.findNode(c, nodeId);
    if (!hit) return;
    const name = await UI.prompt({ title: M.isFolder(hit.node) ? 'Rename Folder' : 'Rename Request', label: 'Name', value: hit.node.name });
    if (!name) return;
    hit.node.name = name;
    App.tabs.filter((t) => t.type === 'request' && t.itemId === nodeId).forEach((t) => {
      t.draft.name = name;
      t.saved = stable({ ...JSON.parse(t.saved || '{}'), name });
    });
    App.save();
    App.notify({ sidebar: true, tabs: 'all' });
  };

  App.deleteNode = async (collectionId, nodeId) => {
    const c = App.findCollection(collectionId);
    const hit = c && M.findNode(c, nodeId);
    if (!hit) return;
    const folder = M.isFolder(hit.node);
    const ok = await UI.confirm({ title: folder ? 'Delete Folder' : 'Delete Request', message: `Delete "${hit.node.name}"${folder ? ' and everything inside it' : ''}?`, okLabel: 'Delete', danger: true });
    if (!ok) return;
    const ids = new Set([nodeId]);
    M.walk(hit.node.item || [], (n) => ids.add(n.id));
    M.removeNode(c, nodeId);
    closeTabsWhere((t) => (t.type === 'request' && ids.has(t.itemId)) || (t.type === 'example' && ids.has(t.itemId)) || (t.type === 'collection' && ids.has(t.nodeId)));
    App.save();
    App.notify({ sidebar: true });
  };

  App.duplicateNode = (collectionId, nodeId) => {
    const c = App.findCollection(collectionId);
    const hit = c && M.findNode(c, nodeId);
    if (!hit) return;
    hit.container.splice(hit.index + 1, 0, M.duplicateNode(hit.node));
    App.save();
    App.notify({ sidebar: true });
  };

  App.moveNode = (src, dest) => {
    const from = App.findCollection(src.collectionId);
    const to = App.findCollection(dest.collectionId);
    const hit = from && M.findNode(from, src.nodeId);
    if (!hit || !to) return false;
    if (src.nodeId === dest.parentId || src.nodeId === dest.beforeId) return false;
    if (M.isFolder(hit.node) && dest.parentId && M.findNode({ item: hit.node.item }, dest.parentId)) return false;
    M.removeNode(from, src.nodeId);
    let index;
    if (dest.beforeId) {
      const target = M.findNode(to, dest.beforeId);
      index = target ? target.index : undefined;
    }
    M.insertNode(to, dest.parentId || null, hit.node, index);
    if (dest.parentId) App.expanded.add(dest.parentId);
    App.expanded.add(dest.collectionId);
    if (src.collectionId !== dest.collectionId) {
      App.tabs.filter((t) => (t.type === 'request' || t.type === 'example' || t.type === 'collection') && t.collectionId === src.collectionId && (t.itemId === src.nodeId || t.nodeId === src.nodeId || M.findNode({ item: hit.node.item || [] }, t.itemId || t.nodeId)))
        .forEach((t) => { t.collectionId = dest.collectionId; });
    }
    App.save();
    App.notify({ sidebar: true, tabs: 'all' });
    return true;
  };

  App.deleteExample = async (collectionId, itemId, exampleId) => {
    const c = App.findCollection(collectionId);
    const hit = c && M.findNode(c, itemId);
    if (!hit) return;
    const ex = (hit.node.response || []).find((r) => r.id === exampleId);
    if (!ex) return;
    const ok = await UI.confirm({ title: 'Delete Example', message: `Delete example "${ex.name}"?`, okLabel: 'Delete', danger: true });
    if (!ok) return;
    hit.node.response = hit.node.response.filter((r) => r.id !== exampleId);
    closeTabsWhere((t) => t.type === 'example' && t.exampleId === exampleId);
    App.save();
    App.notify({ sidebar: true });
  };

  App.renameExample = async (collectionId, itemId, exampleId) => {
    const c = App.findCollection(collectionId);
    const hit = c && M.findNode(c, itemId);
    const ex = hit && (hit.node.response || []).find((r) => r.id === exampleId);
    if (!ex) return;
    const name = await UI.prompt({ title: 'Rename Example', label: 'Name', value: ex.name });
    if (!name) return;
    ex.name = name;
    App.save();
    App.notify({ sidebar: true, tabs: 'all' });
  };

  // ---------------------------------------------------------------------------
  // Saving requests
  // ---------------------------------------------------------------------------
  App.saveRequestTab = async (tab) => {
    if (tab.type !== 'request') return false;
    if (tab.collectionId && tab.itemId) {
      const c = App.findCollection(tab.collectionId);
      const hit = c && M.findNode(c, tab.itemId);
      if (hit) {
        hit.container[hit.index] = M.itemFromDraft(tab.draft, hit.node);
        tab.saved = stable(tab.draft);
        App.save();
        App.notify({ sidebar: true, tabs: [tab.id] });
        toast('Request saved', 'success');
        return true;
      }
    }
    return Views.dialogs.saveAs(tab);
  };

  /** Called by the save-as dialog once the user picked a destination. */
  App.saveRequestInto = (tab, collectionId, folderId, name) => {
    const c = App.findCollection(collectionId);
    if (!c) return false;
    tab.draft.name = name;
    const item = M.itemFromDraft(tab.draft);
    M.insertNode(c, folderId || null, item);
    tab.collectionId = collectionId;
    tab.itemId = item.id;
    tab.saved = stable(tab.draft);
    App.expanded.add(collectionId);
    if (folderId) {
      const hit = M.findNode(c, folderId);
      (hit ? hit.ancestors : []).forEach((a) => App.expanded.add(a.id));
      App.expanded.add(folderId);
    }
    App.save();
    App.notify({ sidebar: true, tabs: [tab.id] });
    toast('Request saved', 'success');
    return true;
  };

  App.saveAsExample = async (tab) => {
    if (!tab.response) { toast('Send the request first to save its response', 'warning'); return; }
    if (!tab.itemId && !(await App.saveRequestTab(tab))) return;
    const c = App.findCollection(tab.collectionId);
    const hit = c && M.findNode(c, tab.itemId);
    if (!hit) return;
    const name = await UI.prompt({ title: 'Save Response as Example', label: 'Example name', value: tab.draft.name || 'Example' });
    if (!name) return;
    const r = tab.response;
    const example = {
      id: M.uid(),
      name,
      originalRequest: M.itemFromDraft(tab.draft).request,
      status: r.status,
      code: r.code,
      _postman_previewlanguage: M.languageFromContentType(r.contentType, r.body),
      header: r.headers.map((x) => ({ key: x.key, value: x.value })),
      cookie: [],
      body: r.body == null ? '' : r.body
    };
    hit.node.response = hit.node.response || [];
    hit.node.response.push(example);
    App.expanded.add(tab.itemId);
    App.save();
    App.notify({ sidebar: true });
    toast('Example saved', 'success');
  };

  // ---------------------------------------------------------------------------
  // Environments
  // ---------------------------------------------------------------------------
  App.createEnvironment = async () => {
    const name = await UI.prompt({ title: 'New Environment', label: 'Name', value: 'New Environment', okLabel: 'Create' });
    if (!name) return null;
    const env = M.newEnvironment(name);
    App.state.environments.push(env);
    App.save();
    App.notify({ sidebar: true });
    App.openEnvironment(env.id);
    return env;
  };

  App.setActiveEnvironment = (id) => {
    App.state.settings.activeEnvironmentId = id || null;
    App.save();
    App.notify({ sidebar: true, tabs: 'all' });
  };

  App.renameEnvironment = async (env) => {
    const name = await UI.prompt({ title: 'Rename Environment', label: 'Name', value: env.name });
    if (!name) return;
    env.name = name;
    App.save();
    App.notify({ sidebar: true, tabs: 'all' });
  };

  App.duplicateEnvironment = (env) => {
    const copy = M.clone(env);
    copy.id = M.uid();
    copy.name = `${env.name} Copy`;
    App.state.environments.splice(App.state.environments.indexOf(env) + 1, 0, copy);
    App.save();
    App.notify({ sidebar: true });
  };

  App.deleteEnvironment = async (env) => {
    const ok = await UI.confirm({ title: 'Delete Environment', message: `Delete environment "${env.name}"?`, okLabel: 'Delete', danger: true });
    if (!ok) return;
    App.state.environments = App.state.environments.filter((e) => e !== env);
    if (App.state.settings.activeEnvironmentId === env.id) App.state.settings.activeEnvironmentId = null;
    closeTabsWhere((t) => t.type === 'environment' && t.envId === env.id);
    App.save();
    App.notify({ sidebar: true, tabs: 'all' });
  };

  App.exportEnvironment = async (env, scope) => {
    const data = M.exportEnvironment(env, scope);
    const file = await api.files.saveText({ defaultName: `${env.name.replace(/[\\/:*?"<>|]+/g, '_')}.postman_${scope || 'environment'}.json`, content: JSON.stringify(data, null, 2), filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (file) toast(`Exported to ${file}`, 'success');
  };

  // ---------------------------------------------------------------------------
  // Import
  // ---------------------------------------------------------------------------
  App.importFromText = async (text) => {
    const result = M.importText(text);
    switch (result.kind) {
      case 'collection': {
        const c = result.value;
        if (App.findCollection(c.info._postman_id)) c.info._postman_id = M.uid();
        App.state.collections.push(c);
        App.expanded.add(c.info._postman_id);
        App.save();
        App.notify({ sidebar: true });
        return `Imported collection "${c.info.name}" (${M.countRequests(c.item)} requests)`;
      }
      case 'environment':
        App.state.environments.push(result.value);
        App.save();
        App.notify({ sidebar: true });
        return `Imported environment "${result.value.name}"`;
      case 'globals': {
        const ok = await UI.confirm({ title: 'Replace Globals', message: 'This file contains global variables. Replace your current globals with it?', okLabel: 'Replace' });
        if (!ok) return 'Skipped globals';
        App.state.globals.values = result.value;
        App.save();
        App.notify({ sidebar: true, tabs: 'all' });
        return 'Imported globals';
      }
      case 'request':
        App.newRequest(result.value);
        return 'Opened request from cURL';
      default:
        return 'Nothing imported';
    }
  };

  // ---------------------------------------------------------------------------
  // Settings / theme / dialogs
  // ---------------------------------------------------------------------------
  App.applyTheme = (theme) => {
    document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark';
    api.app.setTheme(theme);
  };
  App.setTheme = (theme) => {
    App.state.settings.theme = theme;
    App.applyTheme(theme);
    App.save();
    renderStatusbar();
  };
  App.showImport = () => Views.dialogs.importDialog();
  App.showSettings = () => Views.dialogs.settingsDialog();
  App.showCookies = () => Views.dialogs.cookiesDialog();
  App.showCode = (draft, collectionId) => Views.dialogs.codeDialog(draft, App.vars(collectionId));
  App.showEnvQuickLook = () => Views.dialogs.envQuickLook();
  App.openExternal = (url) => api.app.openExternal(url);
  App.pickFile = async () => { const paths = await api.files.pickPath({ title: 'Select file' }); return paths[0] || null; };

  // ---------------------------------------------------------------------------
  // Shell
  // ---------------------------------------------------------------------------
  function buildShell() {
    const appEl = document.getElementById('app');
    clear(appEl);
    const els = App.els;

    els.envSelect = h('select', { class: 'select env-select', 'aria-label': 'Active environment', onchange: (e) => App.setActiveEnvironment(e.target.value || null) });
    els.topbar = h('div', { class: 'topbar' },
      h('div', { class: 'brand' }, h('img', { class: 'brand-img', src: '../../assets/icon-64.png', alt: '' }), 'ApiForge'),
      h('button', { class: 'btn btn-small btn-ghost', type: 'button', onclick: () => App.newRequest() }, icon('plus', 14), 'New'),
      h('button', { class: 'btn btn-small btn-ghost', type: 'button', onclick: App.showImport }, icon('import', 14), 'Import'),
      h('span', { class: 'spacer' }),
      els.envSelect,
      iconButton('eye', 'Environment quick look', App.showEnvQuickLook),
      iconButton('cookie', 'Cookies', App.showCookies),
      iconButton('settings', 'Settings', App.showSettings));

    els.rail = h('div', { class: 'rail' });
    els.sidebar = h('div', { class: 'sidebar', style: { width: `${App.sidebar.width}px` } });
    els.sidebarSplitter = h('div', { class: 'splitter-x' });
    els.tabbar = h('div', { class: 'tabbar' });
    els.tabContent = h('div', { class: 'tab-content' });
    els.consoleHost = h('div', { style: { display: 'contents' } });
    els.content = h('div', { class: 'content' }, els.tabbar, els.tabContent, els.consoleHost);
    els.main = h('div', { class: 'main' }, els.rail, els.sidebar, els.sidebarSplitter, els.content);
    els.statusbar = h('div', { class: 'statusbar' });
    appEl.append(els.topbar, els.main, els.statusbar);

    UI.splitter(els.sidebarSplitter, {
      axis: 'x',
      onStart: () => App.sidebar.width,
      onMove: (dx, start) => { App.sidebar.width = Math.max(200, Math.min(600, start + dx)); els.sidebar.style.width = `${App.sidebar.width}px`; },
      onEnd: () => App.save()
    });

    renderRail();
    renderSidebar();
    renderEnvSelect();
    renderConsole();
    renderStatusbar();
  }

  function renderRail() {
    const sections = [['collections', 'Collections', 'collections'], ['environments', 'Environments', 'environments'], ['history', 'History', 'history']];
    clear(App.els.rail);
    sections.forEach(([id, label, ic]) => {
      App.els.rail.appendChild(h('button', {
        class: `rail-btn${App.sidebar.section === id && !App.sidebar.collapsed ? ' active' : ''}`,
        type: 'button',
        title: label,
        onclick: () => App.selectSidebar(id)
      }, icon(ic, 18), label));
    });
  }

  App.selectSidebar = (section) => {
    if (App.sidebar.section === section && !App.sidebar.collapsed) App.sidebar.collapsed = true;
    else { App.sidebar.section = section; App.sidebar.collapsed = false; }
    App.els.sidebar.classList.toggle('collapsed', App.sidebar.collapsed);
    App.els.sidebarSplitter.classList.toggle('hidden', App.sidebar.collapsed);
    renderRail();
    renderSidebar();
    App.save();
  };

  App.toggleSidebar = () => {
    App.sidebar.collapsed = !App.sidebar.collapsed;
    App.els.sidebar.classList.toggle('collapsed', App.sidebar.collapsed);
    App.els.sidebarSplitter.classList.toggle('hidden', App.sidebar.collapsed);
    renderRail();
    App.save();
  };

  function renderSidebar() {
    Views.sidebar.render(App.els.sidebar);
  }
  App.renderSidebar = renderSidebar;

  function renderEnvSelect() {
    const sel = App.els.envSelect;
    clear(sel);
    sel.appendChild(h('option', { value: '' }, 'No Environment'));
    App.state.environments.forEach((env) => sel.appendChild(h('option', { value: env.id, selected: env.id === App.state.settings.activeEnvironmentId }, env.name)));
    sel.value = App.state.settings.activeEnvironmentId || '';
  }

  function tabIcon(tab) {
    switch (tab.type) {
      case 'request': return methodBadge(tab.draft.method, true);
      case 'example': return icon('example', 14);
      case 'websocket': return h('span', { class: 'method method-ws small' }, 'WS');
      case 'environment': return icon(tab.envId === 'globals' ? 'globe' : 'environments', 14);
      case 'collection': return icon(tab.nodeId ? 'folder' : 'collections', 14);
      case 'runner': return icon('runner', 14);
      default: return null;
    }
  }

  function renderTabbarItem(tab) {
    const existing = App.els.tabbar.querySelector(`.tab[data-id="${tab.id}"]`);
    if (!existing) return renderTabbar();
    const next = buildTabEl(tab);
    existing.replaceWith(next);
  }

  function buildTabEl(tab) {
    const dirty = App.isDirty(tab);
    const el = h('div', {
      class: `tab${tab.id === App.activeTabId ? ' active' : ''}${dirty ? ' dirty' : ''}`,
      dataset: { id: tab.id },
      title: App.tabTitle(tab),
      onclick: () => App.activateTab(tab.id),
      onauxclick: (e) => { if (e.button === 1) { e.preventDefault(); App.closeTab(tab.id); } },
      oncontextmenu: (e) => {
        e.preventDefault();
        UI.menu(null, [
          { label: 'Close', shortcut: 'Ctrl+W', onClick: () => App.closeTab(tab.id) },
          { label: 'Close Others', onClick: () => App.closeOtherTabs(tab.id) },
          { label: 'Close All', onClick: () => App.closeAllTabs() },
          'separator',
          tab.type === 'request' ? { label: 'Duplicate Tab', onClick: () => App.newRequest(M.clone(tab.draft), { collectionId: tab.collectionId }) } : null
        ], { point: { x: e.clientX, y: e.clientY } });
      }
    },
    tabIcon(tab),
    h('span', { class: 'tab-title' }, App.tabTitle(tab)),
    h('button', { class: 'tab-close', type: 'button', title: 'Close tab', onclick: (e) => { e.stopPropagation(); App.closeTab(tab.id); } }, icon('x', 12)));
    return el;
  }

  function renderTabbar() {
    const bar = App.els.tabbar;
    clear(bar);
    const scroll = h('div', { class: 'tabbar-scroll' });
    App.tabs.forEach((tab) => scroll.appendChild(buildTabEl(tab)));
    bar.append(scroll, h('div', { class: 'tabbar-actions' },
      iconButton('plus', 'New request (Ctrl+T)', () => App.newRequest()),
      iconButton('more', 'More', (e) => UI.menu(e.currentTarget, [
        { label: 'New HTTP Request', icon: 'send', onClick: () => App.newRequest() },
        { label: 'New WebSocket Request', icon: 'plug', onClick: () => App.openWebSocket() },
        'separator',
        { label: 'Close All Tabs', onClick: () => App.closeAllTabs() }
      ], { alignRight: true }))));
    const active = scroll.querySelector('.tab.active');
    if (active) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function mountActive() {
    const host = App.els.tabContent;
    clear(host);
    const tab = App.activeTab();
    if (!tab) { host.appendChild(welcome()); return; }
    let view = App.views.get(tab.id);
    if (!view) {
      const factory = Views[tab.type];
      view = factory(tab);
      App.views.set(tab.id, view);
    }
    host.appendChild(view.el);
    if (view.stale !== false) { view.update(); view.stale = false; }
    if (view.focus) view.focus();
  }

  function welcome() {
    const card = (ic, title, text, onClick) => h('button', { class: 'welcome-btn', type: 'button', onclick: onClick }, icon(ic, 20), h('b', null, title), h('span', null, text));
    return h('div', { class: 'welcome' }, h('div', { class: 'welcome-card' },
      card('send', 'HTTP Request', 'Create a basic HTTP request', () => App.newRequest()),
      card('plug', 'WebSocket', 'Connect to a WebSocket server', () => App.openWebSocket()),
      card('collections', 'Collection', 'Group related requests', () => App.createCollection()),
      card('import', 'Import', 'Postman, OpenAPI or cURL', App.showImport)));
  }

  function renderConsole() {
    const host = App.els.consoleHost;
    clear(host);
    if (!App.consoleOpen) return;
    if (!App.consoleView) App.consoleView = Views.console.create();
    const splitter = h('div', { class: 'splitter-y' });
    UI.splitter(splitter, {
      axis: 'y',
      onStart: () => App.consoleHeight,
      onMove: (dy, start) => { App.consoleHeight = Math.max(120, Math.min(window.innerHeight - 200, start - dy)); App.consoleView.el.style.height = `${App.consoleHeight}px`; },
      onEnd: () => App.save()
    });
    App.consoleView.el.style.height = `${App.consoleHeight}px`;
    host.append(splitter, App.consoleView.el);
    App.consoleView.update();
  }

  function renderStatusbar() {
    const bar = App.els.statusbar;
    clear(bar);
    const errors = App.consoleEntries.filter((e) => e.type === 'error').length;
    bar.append(
      h('button', { class: `statusbar-btn${App.consoleOpen ? ' active' : ''}`, type: 'button', onclick: () => App.toggleConsole() }, icon('terminal', 13), 'Console',
        App.consoleEntries.length ? h('span', { class: `badge${errors ? ' fail' : ''}` }, errors || App.consoleEntries.length) : null),
      h('button', { class: 'statusbar-btn', type: 'button', onclick: App.showCookies }, icon('cookie', 13), 'Cookies'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'statusbar-btn', type: 'button', title: 'Toggle theme', onclick: () => App.setTheme(App.state.settings.theme === 'light' ? 'dark' : 'light') }, icon(App.state.settings.theme === 'light' ? 'moon' : 'sun', 13)),
      h('button', { class: 'statusbar-btn', type: 'button', title: GITHUB_URL, onclick: () => App.openExternal(GITHUB_URL) }, icon('github', 13), 'GitHub'),
      h('button', { class: 'statusbar-btn', type: 'button', onclick: () => Views.dialogs.aboutDialog() }, icon('info', 13), 'About'));
  }

  // ---------------------------------------------------------------------------
  // Keyboard & menu commands
  // ---------------------------------------------------------------------------
  function onKeyDown(e) {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const tab = App.activeTab();
    const key = e.key.toLowerCase();
    if (key === 'enter' && tab && tab.type === 'request') { e.preventDefault(); App.sendRequest(tab); }
    else if (key === 's' && tab && tab.type === 'request') { e.preventDefault(); App.saveRequestTab(tab); }
    else if (key === 't') { e.preventDefault(); App.newRequest(); }
    else if (key === 'w' && !e.shiftKey) { e.preventDefault(); if (tab) App.closeTab(tab.id); }
    else if (key === 'c' && e.altKey) { e.preventDefault(); App.toggleConsole(); }
    else if (key === '\\') { e.preventDefault(); App.toggleSidebar(); }
    else if (key === ',') { e.preventDefault(); App.showSettings(); }
    else if (key === 'o') { e.preventDefault(); App.showImport(); }
    else if (key === 'tab' && App.tabs.length > 1) {
      e.preventDefault();
      const i = App.tabs.findIndex((t) => t.id === App.activeTabId);
      const next = App.tabs[(i + (e.shiftKey ? -1 : 1) + App.tabs.length) % App.tabs.length];
      App.activateTab(next.id);
    }
  }

  function onMenuCommand(command) {
    const tab = App.activeTab();
    switch (command) {
      case 'new-request': return App.newRequest();
      case 'new-collection': return App.createCollection();
      case 'new-environment': return App.createEnvironment();
      case 'new-websocket': return App.openWebSocket();
      case 'import': return App.showImport();
      case 'save': return tab && tab.type === 'request' && App.saveRequestTab(tab);
      case 'close-tab': return tab && App.closeTab(tab.id);
      case 'settings': return App.showSettings();
      case 'toggle-console': return App.toggleConsole();
      case 'toggle-sidebar': return App.toggleSidebar();
      case 'runner': {
        const c = (tab && tab.collectionId && App.findCollection(tab.collectionId)) || App.state.collections[0];
        if (c) App.openRunner(c.info._postman_id);
        else toast('Create a collection first', 'warning');
        return undefined;
      }
      case 'cookies': return App.showCookies();
      case 'about': return Views.dialogs.aboutDialog();
      case 'github': return App.openExternal(GITHUB_URL);
      default: return undefined;
    }
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  async function init() {
    App.state = await api.store.load();
    const ui = App.state.ui || {};
    App.sidebar.section = ['collections', 'environments', 'history'].includes(ui.sidebar) ? ui.sidebar : 'collections';
    App.sidebar.width = ui.sidebarWidth || 300;
    App.sidebar.collapsed = !!ui.sidebarCollapsed;
    App.expanded = new Set(ui.expanded || []);
    App.consoleHeight = ui.consoleHeight || 260;
    App.tabs = (ui.tabs || []).map(reviveTab).filter(Boolean);
    App.activeTabId = App.tabs.some((t) => t.id === ui.activeTabId) ? ui.activeTabId : (App.tabs[0] ? App.tabs[0].id : null);
    if (!App.findEnvironment(App.state.settings.activeEnvironmentId)) App.state.settings.activeEnvironmentId = null;

    App.applyTheme(App.state.settings.theme);
    buildShell();
    App.els.sidebar.classList.toggle('collapsed', App.sidebar.collapsed);
    App.els.sidebarSplitter.classList.toggle('hidden', App.sidebar.collapsed);
    api.runtime.onEvent(onRuntimeEvent);
    api.app.onMenuCommand(onMenuCommand);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('beforeunload', () => { App.persist(); });

    renderTabbar();
    mountActive();
  }

  init().catch((err) => {
    console.error(err);
    document.body.appendChild(h('pre', { style: { padding: '20px', color: 'red' } }, `ApiForge failed to start: ${err.stack || err.message}`));
  });
})(window);
