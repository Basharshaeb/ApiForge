/**
 * Modal dialogs: import, settings, cookies, code snippets, save-as,
 * environment quick look, about.
 */
(function (root) {
  'use strict';

  root.Views = root.Views || {};
  const M = root.ApiForgeModel;
  const UI = root.UI;
  const Codegen = root.ApiForgeCodegen;
  const { h, clear, icon, iconButton, toast } = UI;
  const api = root.apiforge;

  // ---------------------------------------------------------------------------
  // Import
  // ---------------------------------------------------------------------------
  function describe(text) {
    const result = M.importText(text);
    switch (result.kind) {
      case 'collection': return `Postman Collection "${result.value.info.name}" (${M.countRequests(result.value.item)} requests)`;
      case 'environment': return `Environment "${result.value.name}" (${result.value.values.length} variables)`;
      case 'globals': return `Globals (${result.value.length} variables)`;
      case 'request': return `cURL request: ${result.value.method} ${result.value.url}`;
      default: return 'Unknown';
    }
  }

  function importDialog() {
    const App = root.App;
    const area = h('textarea', { class: 'import-area', placeholder: 'Paste a Postman collection or environment (JSON), an OpenAPI 3 / Swagger 2 document (JSON) or a cURL command…', spellcheck: false });
    const detect = h('div', { class: 'import-detect' });
    const filesEl = h('div', { class: 'import-files' });
    let files = [];
    area.addEventListener('input', () => {
      const text = area.value.trim();
      detect.className = 'import-detect';
      if (!text) { detect.textContent = ''; return; }
      try { detect.textContent = `Detected: ${describe(text)}`; detect.classList.add('ok'); } catch (err) { detect.textContent = err.message; detect.classList.add('err'); }
    });
    const renderFiles = () => {
      clear(filesEl);
      files.forEach((f) => {
        let status;
        try { status = describe(f.content); } catch (err) { status = `Error: ${err.message}`; }
        filesEl.appendChild(h('div', { class: 'import-file' }, icon('file', 13), h('span', null, f.name), h('span', { class: `status ${status.startsWith('Error') ? 'status-err' : ''}` }, status), iconButton('x', 'Remove', () => { files = files.filter((x) => x !== f); renderFiles(); })));
      });
    };
    const body = h('div', null,
      h('div', { class: 'inline-fields', style: { marginBottom: '10px' } },
        h('button', { class: 'btn btn-secondary btn-small', type: 'button', onclick: async () => {
          const picked = await api.files.openText({ title: 'Import', multi: true, filters: [{ name: 'JSON / YAML / text', extensions: ['json', 'txt', 'yaml', 'yml', '*'] }] });
          files = files.concat(picked);
          renderFiles();
        } }, icon('upload', 13), 'Select Files'),
        h('span', { class: 'muted' }, 'or paste below')),
      filesEl, area, detect);
    UI.modal({
      title: 'Import',
      width: 640,
      body,
      actions: [
        { label: 'Cancel' },
        { label: 'Import', primary: true, onClick: () => {
          const text = area.value.trim();
          if (!text && !files.length) { toast('Nothing to import', 'warning'); return false; }
          (async () => {
            const messages = [];
            for (const f of files) {
              try { messages.push(await App.importFromText(f.content)); } catch (err) { messages.push(`${f.name}: ${err.message}`); }
            }
            if (text) {
              try { messages.push(await App.importFromText(text)); } catch (err) { messages.push(err.message); }
            }
            messages.forEach((m) => toast(m, /error|could not|unsupported|unrecognized/i.test(m) ? 'error' : 'success'));
          })();
          return true;
        } }
      ]
    });
  }

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------
  async function settingsDialog() {
    const App = root.App;
    const s = { ...App.state.settings };
    const info = await api.app.info();
    const row = (title, desc, control) => h('div', { class: 'setting-row' }, h('div', { class: 'setting-text' }, h('div', { class: 'setting-title' }, title), desc ? h('div', { class: 'setting-desc' }, desc) : null), control);
    const body = h('div', { class: 'settings-list' },
      row('Theme', 'Light or dark interface.', UI.selectEl([['dark', 'Dark'], ['light', 'Light']], s.theme === 'light' ? 'light' : 'dark', (v) => { s.theme = v; }, { style: { width: '140px' } })),
      row('SSL certificate verification', 'Verify server certificates. Turn off to call servers with self-signed certificates.', UI.toggle('', s.strictSSL !== false, (v) => { s.strictSSL = v; })),
      row('Automatically follow redirects', 'Follow 3xx redirects and return the final response.', UI.toggle('', s.followRedirects !== false, (v) => { s.followRedirects = v; })),
      row('Request timeout (ms)', '0 means wait forever.', h('input', { class: 'input', type: 'number', min: 0, value: s.requestTimeout || 0, oninput: (e) => { s.requestTimeout = Math.max(0, Number(e.target.value) || 0); } })),
      row('History limit', 'Number of sent requests to keep in History.', h('input', { class: 'input', type: 'number', min: 10, max: 5000, value: s.historyLimit || 200, oninput: (e) => { s.historyLimit = Math.max(10, Number(e.target.value) || 200); } })),
      row('Data file', 'All collections, environments and history are stored here.', null),
      h('div', { class: 'mono muted', style: { userSelect: 'text', wordBreak: 'break-all' } }, info.dataFile));

    // Proxy ------------------------------------------------------------------
    const proxy = { enabled: false, host: '', port: '', username: '', password: '', bypass: '', ...(s.proxy || {}) };
    s.proxy = proxy;
    const proxyField = (key, label, type) => h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), h('input', { class: 'input', type: type || 'text', value: proxy[key] || '', oninput: (e) => { proxy[key] = e.target.value; } }));
    const proxyBody = h('div', { class: 'settings-list' },
      row('Use custom proxy', 'Route all requests through an HTTP proxy (CONNECT tunnelling for HTTPS).', UI.toggle('', proxy.enabled, (v) => { proxy.enabled = v; })),
      h('div', { class: 'field-row' }, proxyField('host', 'Proxy host'), h('label', { class: 'field', style: { maxWidth: '120px' } }, h('span', { class: 'field-label' }, 'Port'), h('input', { class: 'input', type: 'number', min: 1, max: 65535, value: proxy.port || '', oninput: (e) => { proxy.port = e.target.value; } }))),
      h('div', { class: 'field-row' }, proxyField('username', 'Username'), proxyField('password', 'Password', 'password')),
      proxyField('bypass', 'Bypass list (comma separated hosts)'),
      row('Ignore proxy environment variables', 'Do not pick up HTTP_PROXY / HTTPS_PROXY / NO_PROXY from the system.', UI.toggle('', !!s.ignoreProxyEnv, (v) => { s.ignoreProxyEnv = v; })));

    // Certificates -----------------------------------------------------------
    const certs = Array.isArray(s.certificates) ? s.certificates.map((c) => ({ ...c })) : [];
    s.certificates = certs;
    const caRow = h('div');
    const renderCa = () => {
      clear(caRow);
      caRow.appendChild(row('CA certificates (PEM)', 'Extra root certificates trusted in addition to the system bundle.', h('div', { class: 'inline-fields' },
        h('button', { class: 'btn btn-small btn-secondary', type: 'button', onclick: async () => { const p = (await api.files.pickPath({ title: 'Select PEM file' }))[0]; if (p) { s.caCertPath = p; renderCa(); } } }, 'Select File'),
        s.caCertPath ? h('span', { class: 'muted mono', title: s.caCertPath }, s.caCertPath.split(/[\\/]/).pop()) : h('span', { class: 'faint' }, 'None'),
        s.caCertPath ? iconButton('x', 'Remove', () => { s.caCertPath = ''; renderCa(); }) : null)));
    };
    renderCa();
    const certList = h('div');
    const pathPicker = (cert, key, label) => h('div', { class: 'inline-fields', style: { marginBottom: '6px' } },
      h('span', { class: 'field-label', style: { width: '70px' } }, label),
      h('button', { class: 'btn btn-small btn-secondary', type: 'button', onclick: async () => { const p = (await api.files.pickPath({ title: `Select ${label} file` }))[0]; if (p) { cert[key] = p; renderCerts(); } } }, 'Select'),
      cert[key] ? h('span', { class: 'muted mono', title: cert[key] }, cert[key].split(/[\\/]/).pop()) : h('span', { class: 'faint' }, 'None'),
      cert[key] ? iconButton('x', 'Clear', () => { cert[key] = ''; renderCerts(); }) : null);
    const renderCerts = () => {
      clear(certList);
      certs.forEach((cert, i) => certList.appendChild(h('div', { class: 'cookie-domain', style: { border: '1px solid var(--border)', borderRadius: '4px', padding: '10px' } },
        h('div', { class: 'field-row' }, h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Host (e.g. api.example.com)'), h('input', { class: 'input', value: cert.host || '', oninput: (e) => { cert.host = e.target.value; } })),
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Passphrase'), h('input', { class: 'input', type: 'password', value: cert.passphrase || '', oninput: (e) => { cert.passphrase = e.target.value; } })),
          iconButton('trash', 'Remove certificate', () => { certs.splice(i, 1); renderCerts(); })),
        pathPicker(cert, 'certPath', 'CRT file'), pathPicker(cert, 'keyPath', 'KEY file'), pathPicker(cert, 'pfxPath', 'PFX file'))));
      certList.appendChild(h('button', { class: 'btn btn-small btn-secondary', type: 'button', onclick: () => { certs.push({ host: '', certPath: '', keyPath: '', pfxPath: '', passphrase: '' }); renderCerts(); } }, icon('plus', 12), 'Add client certificate'));
    };
    renderCerts();
    const certBody = h('div', { class: 'settings-list' }, caRow, h('div', null, h('div', { class: 'setting-title' }, 'Client certificates'), h('div', { class: 'setting-desc', style: { marginBottom: '8px' } }, 'Sent when the request host matches. Use CRT + KEY or a PFX bundle.'), certList));

    let section = 'general';
    const sections = { general: body, proxy: proxyBody, certificates: certBody };
    const host = h('div');
    const tabs = UI.tabStrip([{ id: 'general', label: 'General' }, { id: 'proxy', label: 'Proxy' }, { id: 'certificates', label: 'Certificates' }], section, (id) => { section = id; clear(host); host.appendChild(sections[id]); }, '');
    host.appendChild(sections[section]);
    UI.modal({
      title: 'Settings',
      width: 640,
      body: h('div', null, h('div', { style: { marginBottom: '12px' } }, tabs), host),
      actions: [
        { label: 'Cancel' },
        { label: 'Save', primary: true, onClick: () => {
          s.certificates = certs.filter((c) => c.host && (c.certPath || c.pfxPath));
          Object.assign(App.state.settings, s);
          App.applyTheme(s.theme);
          App.save();
          App.notify({ tabs: 'all' });
          toast('Settings saved', 'success');
          return true;
        } }
      ]
    });
  }

  // ---------------------------------------------------------------------------
  // Cookies
  // ---------------------------------------------------------------------------
  async function cookiesDialog() {
    const body = h('div');
    const dialog = UI.modal({ title: 'Manage Cookies', width: 680, body, actions: [{ label: 'Close', primary: true }] });
    async function load() {
      clear(body);
      let cookies = [];
      try { cookies = await api.cookies.list(); } catch (err) { body.appendChild(h('div', { class: 'response-error' }, err.message)); return; }
      if (!cookies.length) { body.appendChild(h('div', { class: 'empty-state' }, icon('cookie', 32), h('div', { class: 'empty-title' }, 'No cookies'), h('div', { class: 'empty-text' }, 'Cookies set by responses are stored here and sent with matching requests.'))); return; }
      const groups = new Map();
      cookies.forEach((c) => { const d = c.domain || '(no domain)'; if (!groups.has(d)) groups.set(d, []); groups.get(d).push(c); });
      body.appendChild(h('div', { style: { display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' } }, h('button', { class: 'btn btn-small btn-danger', type: 'button', onclick: async () => {
        if (await UI.confirm({ title: 'Clear Cookies', message: 'Remove all stored cookies?', okLabel: 'Clear', danger: true })) { await api.cookies.clear(); load(); }
      } }, 'Clear all')));
      [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).forEach(([domain, list]) => {
        body.appendChild(h('div', { class: 'cookie-domain' },
          h('div', { class: 'cookie-domain-head' }, icon('globe', 13), domain, h('span', { class: 'tree-count' }, list.length)),
          list.map((c) => h('div', { class: 'cookie-row' },
            h('span', { class: 'name' }, c.name),
            h('span', { class: 'value', title: c.value }, c.value),
            h('span', { class: 'meta' }, `${c.path || '/'} · ${c.expires ? new Date(c.expires).toLocaleString() : 'session'}${c.httpOnly ? ' · HttpOnly' : ''}${c.secure ? ' · Secure' : ''}`),
            iconButton('trash', 'Delete cookie', async () => { await api.cookies.remove({ domain: c.domain, path: c.path, name: c.name }); load(); })))));
      });
    }
    load();
    return dialog;
  }

  // ---------------------------------------------------------------------------
  // Code snippet
  // ---------------------------------------------------------------------------
  function codeDialog(draft, vars) {
    const App = root.App;
    let language = App.state.settings.codegenLanguage || 'curl';
    let resolve = true;
    const codeWrap = h('div', { class: 'code-wrap' });
    const render = () => {
      clear(codeWrap);
      const lang = Codegen.LANGUAGES.find((l) => l.id === language) || Codegen.LANGUAGES[0];
      codeWrap.appendChild(UI.codeView(Codegen.generate(language, draft, resolve ? (s) => M.substitute(s, vars) : null), { language: lang.lang === 'javascript' ? 'javascript' : 'text', wrap: true }));
    };
    const body = h('div', { class: 'code-modal' },
      h('div', { class: 'inline-fields' },
        UI.selectEl(Codegen.LANGUAGES.map((l) => [l.id, l.label]), language, (v) => { language = v; App.state.settings.codegenLanguage = v; App.save(); render(); }),
        h('label', { class: 'checkbox' }, h('input', { type: 'checkbox', checked: true, onchange: (e) => { resolve = e.target.checked; render(); } }), 'Resolve variables'),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn btn-small btn-secondary', type: 'button', onclick: () => UI.copyText(codeWrap.textContent) }, icon('copy', 13), 'Copy')),
      codeWrap);
    render();
    UI.modal({ title: 'Code snippet', width: 720, body, actions: [{ label: 'Close', primary: true }] });
  }

  // ---------------------------------------------------------------------------
  // Save as (pick a collection / folder)
  // ---------------------------------------------------------------------------
  function saveAs(tab) {
    const App = root.App;
    return new Promise((resolve) => {
      let resolved = false;
      const finish = (v) => { if (!resolved) { resolved = true; resolve(v); } };
      const defaultName = tab.draft.name && tab.draft.name !== 'Untitled Request' ? tab.draft.name : (tab.draft.url.replace(/^[a-z]+:\/\//i, '').split('?')[0] || 'Untitled Request');
      const name = h('input', { class: 'input', value: defaultName });
      let selection = tab.collectionId ? { collectionId: tab.collectionId, folderId: null } : (App.state.collections[0] ? { collectionId: App.state.collections[0].info._postman_id, folderId: null } : null);
      const tree = h('div', { class: 'save-tree' });
      const renderTree = () => {
        clear(tree);
        if (!App.state.collections.length) { tree.appendChild(h('div', { class: 'tree-empty' }, 'No collections yet. Create one to save this request.')); return; }
        App.state.collections.forEach((c) => {
          const cid = c.info._postman_id;
          const sel = selection && selection.collectionId === cid && !selection.folderId;
          tree.appendChild(h('div', { class: `tree-row collection${sel ? ' selected' : ''}`, onclick: () => { selection = { collectionId: cid, folderId: null }; renderTree(); } }, h('span', { class: 'chevron empty' }), icon('collections', 14), h('span', { class: 'tree-name' }, c.info.name)));
          M.walk(c.item, (node, ancestors) => {
            if (!M.isFolder(node)) return;
            const fsel = selection && selection.collectionId === cid && selection.folderId === node.id;
            tree.appendChild(h('div', { class: `tree-row folder${fsel ? ' selected' : ''}`, style: { paddingLeft: `${8 + (ancestors.length + 1) * 14}px` }, onclick: () => { selection = { collectionId: cid, folderId: node.id }; renderTree(); } }, h('span', { class: 'chevron empty' }), h('span', { class: 'tree-icon' }, icon('folder', 14)), h('span', { class: 'tree-name' }, node.name)));
          });
        });
      };
      renderTree();
      const body = h('div', null,
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Request name'), name),
        h('div', { class: 'field' }, h('div', { style: { display: 'flex', alignItems: 'center', marginBottom: '6px' } }, h('span', { class: 'field-label' }, 'Save to'), h('span', { class: 'spacer' }),
          h('button', { class: 'link-btn', type: 'button', onclick: async () => { const c = await App.createCollection(); if (c) { selection = { collectionId: c.info._postman_id, folderId: null }; renderTree(); } } }, '+ New Collection')), tree));
      UI.modal({
        title: 'Save Request',
        width: 520,
        body,
        actions: [
          { label: 'Cancel' },
          { label: 'Save', primary: true, onClick: () => {
            if (!name.value.trim()) { name.focus(); return false; }
            if (!selection) { toast('Choose a collection', 'warning'); return false; }
            finish(App.saveRequestInto(tab, selection.collectionId, selection.folderId, name.value.trim()));
            return true;
          } }
        ],
        onClose: () => finish(false)
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Environment quick look
  // ---------------------------------------------------------------------------
  function envQuickLook() {
    const App = root.App;
    const env = App.activeEnvironment();
    const table = (title, values, onEdit) => h('div', { class: 'scope-table-wrap' },
      h('div', { style: { display: 'flex', alignItems: 'center', marginBottom: '4px' } }, h('b', null, title), h('span', { class: 'spacer' }), h('button', { class: 'link-btn', type: 'button', onclick: onEdit }, 'Edit')),
      values.filter((v) => v.key).length
        ? h('table', { class: 'lookup-table' }, h('thead', null, h('tr', null, h('th', null, 'Variable'), h('th', null, 'Value'), h('th', null, ''))),
          h('tbody', null, values.filter((v) => v.key).map((v) => h('tr', { style: v.enabled === false ? { opacity: 0.5 } : null }, h('td', null, v.key), h('td', null, v.type === 'secret' ? '••••••••' : M.displayValue(v.value)), h('td', null, v.enabled === false ? 'disabled' : '')))))
        : h('div', { class: 'kv-empty' }, 'No variables'));
    const dialog = UI.modal({
      title: 'Variables in scope',
      width: 620,
      body: h('div', null,
        table(env ? `Environment: ${env.name}` : 'No active environment', env ? env.values : [], () => { dialog.close(); if (env) App.openEnvironment(env.id); else App.createEnvironment(); }),
        h('div', { style: { height: '14px' } }),
        table('Globals', App.state.globals.values, () => { dialog.close(); App.openEnvironment('globals'); })),
      actions: [{ label: 'Close', primary: true }]
    });
  }

  // ---------------------------------------------------------------------------
  // About
  // ---------------------------------------------------------------------------
  async function aboutDialog() {
    const info = await api.app.info();
    const shortcuts = [['Ctrl+Enter', 'Send request'], ['Ctrl+S', 'Save request'], ['Ctrl+T', 'New request'], ['Ctrl+W', 'Close tab'], ['Ctrl+Tab', 'Next tab'], ['Ctrl+O', 'Import'], ['Ctrl+Alt+C', 'Toggle console'], ['Ctrl+\\', 'Toggle sidebar'], ['Ctrl+,', 'Settings']];
    UI.modal({
      title: 'About ApiForge',
      body: h('div', null,
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' } }, h('img', { src: '../../assets/icon-64.png', width: 48, height: 48, alt: '' }), h('div', null, h('b', { style: { fontSize: '15px' } }, 'ApiForge'), h('div', { class: 'muted' }, `Version ${info.version}`))),
        h('p', { class: 'modal-message' }, 'A local API client built on postman-runtime: requests, scripts, collections, environments, runner, cookies and WebSockets, all stored on this machine.'),
        h('p', { class: 'modal-message' }, 'Created by ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); root.App.openExternal(root.App.GITHUB_URL); } }, 'Basharshaeb'), ' — ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); root.App.openExternal(root.App.GITHUB_URL); } }, root.App.GITHUB_URL)),
        h('dl', { class: 'about-grid' }, h('dt', null, 'Version'), h('dd', null, info.version), h('dt', null, 'Electron'), h('dd', null, info.electron), h('dt', null, 'Node'), h('dd', null, info.node), h('dt', null, 'Chromium'), h('dd', null, info.chrome), h('dt', null, 'Data file'), h('dd', null, info.dataFile)),
        h('h3', { style: { fontSize: '13px', margin: '16px 0 6px' } }, 'Keyboard shortcuts'),
        h('table', { class: 'data-table' }, h('tbody', null, shortcuts.map(([k, v]) => h('tr', null, h('td', { style: { width: '130px' } }, h('span', { class: 'kbd' }, k)), h('td', { style: { fontFamily: 'var(--font)' } }, v)))))),
      actions: [{ label: 'Close', primary: true }]
    });
  }

  root.Views.dialogs = { importDialog, settingsDialog, cookiesDialog, codeDialog, saveAs, envQuickLook, aboutDialog };
})(window);
