/**
 * Request editor + response viewer (the "requester" tab), plus the read-only
 * example tab that reuses the response viewer.
 */
(function (root) {
  'use strict';

  root.Views = root.Views || {};
  const M = root.ApiForgeModel;
  const UI = root.UI;
  const Codegen = root.ApiForgeCodegen;
  const { h, clear, icon, iconButton, methodBadge, toast } = UI;

  const REQUEST_TABS = [
    { id: 'params', label: 'Params' }, { id: 'auth', label: 'Authorization' }, { id: 'headers', label: 'Headers' },
    { id: 'body', label: 'Body' }, { id: 'scripts', label: 'Scripts' }, { id: 'settings', label: 'Settings' }
  ];

  const SNIPPETS = [
    ['Get an environment variable', 'pm.environment.get("variable_key");'],
    ['Set an environment variable', 'pm.environment.set("variable_key", "variable_value");'],
    ['Clear an environment variable', 'pm.environment.unset("variable_key");'],
    ['Get a global variable', 'pm.globals.get("variable_key");'],
    ['Set a global variable', 'pm.globals.set("variable_key", "variable_value");'],
    ['Get a collection variable', 'pm.collectionVariables.get("variable_key");'],
    ['Get a variable', 'pm.variables.get("variable_key");'],
    ['Send a request', 'pm.sendRequest("https://postman-echo.com/get", function (err, response) {\n    console.log(response.json());\n});'],
    ['Status code: Code is 200', 'pm.test("Status code is 200", function () {\n    pm.response.to.have.status(200);\n});'],
    ['Response body: Contains string', 'pm.test("Body matches string", function () {\n    pm.expect(pm.response.text()).to.include("string_you_want_to_search");\n});'],
    ['Response body: JSON value check', 'pm.test("Your test name", function () {\n    var jsonData = pm.response.json();\n    pm.expect(jsonData.value).to.eql(100);\n});'],
    ['Response body: Is equal to a string', 'pm.test("Body is correct", function () {\n    pm.response.to.have.body("response_body_string");\n});'],
    ['Response headers: Content-Type check', 'pm.test("Content-Type is present", function () {\n    pm.response.to.have.header("Content-Type");\n});'],
    ['Response time is less than 200ms', 'pm.test("Response time is less than 200ms", function () {\n    pm.expect(pm.response.responseTime).to.be.below(200);\n});'],
    ['Status code: Successful POST request', 'pm.test("Successful POST request", function () {\n    pm.expect(pm.response.code).to.be.oneOf([201, 202]);\n});'],
    ['Status code: Code name has string', 'pm.test("Status code name has string", function () {\n    pm.response.to.have.status("Created");\n});'],
    ['Use a JSON schema', 'var schema = {\n    "items": { "type": "boolean" }\n};\npm.test("Schema is valid", function () {\n    pm.response.to.have.jsonSchema(schema);\n});'],
    ['Set next request (runner)', 'pm.execution.setNextRequest("request_name");'],
    ['Visualize response', 'var template = `<table>{{#each response}}<tr><td>{{this.name}}</td></tr>{{/each}}</table>`;\npm.visualizer.set(template, { response: pm.response.json() });']
  ];

  const AUTO_HEADERS = [
    ['User-Agent', 'PostmanRuntime/7.x'], ['Accept', '*/*'], ['Accept-Encoding', 'gzip, deflate, br'], ['Connection', 'keep-alive'], ['Postman-Token', '<calculated when request is sent>']
  ];

  const statusClass = (code) => (code ? `status-${Math.floor(code / 100)}xx` : 'status-err');

  // ---------------------------------------------------------------------------
  // Response viewer (shared by request + example tabs)
  // ---------------------------------------------------------------------------
  /**
   * state: { response, error, running, tests, scriptErrors, cookies, visualizer, respTab, bodyView, bodyLang, wrap }
   * opts: { onSaveExample, onCancel, onTabChange }
   */
  function responseViewer(getState, opts) {
    const el = h('div', { class: 'pane pane-response' });
    const options = opts || {};

    function render() {
      clear(el);
      const s = getState();
      if (s.running) {
        el.append(h('div', { class: 'loading-bar' }), h('div', { class: 'response-empty' }, h('div', null, 'Sending request…'),
          options.onCancel ? h('button', { class: 'btn btn-secondary btn-small', type: 'button', onclick: options.onCancel }, 'Cancel') : null));
        return;
      }
      if (!s.response && !s.error) {
        el.appendChild(h('div', { class: 'response-empty' }, icon('send', 28), h('div', null, 'Enter the URL and click Send to get a response'), h('div', { class: 'faint' }, h('kbd', null, 'Ctrl'), ' + ', h('kbd', null, 'Enter'))));
        return;
      }
      const r = s.response;
      const tabs = [
        { id: 'body', label: 'Body' },
        { id: 'cookies', label: 'Cookies', badge: (s.cookies || []).length || null },
        { id: 'headers', label: 'Headers', badge: r ? r.headers.length : null },
        { id: 'tests', label: 'Test Results', badge: testBadge(s), badgeClass: testBadgeClass(s) }
      ];
      if (s.visualizer && (s.visualizer.processedTemplate || s.visualizer.error)) tabs.push({ id: 'visualize', label: 'Visualize' });
      const head = h('div', { class: 'response-head' },
        UI.tabStrip(tabs, s.respTab || 'body', (id) => { s.respTab = id; if (options.onTabChange) options.onTabChange(id); render(); }),
        r ? h('div', { class: 'response-meta' },
          h('span', { class: `status-pill ${statusClass(r.code)}` }, `${r.code} ${r.status || ''}`),
          h('span', null, M.formatMs(r.responseTime)),
          h('span', { title: `Body: ${M.formatBytes(r.size.body)} · Headers: ${M.formatBytes(r.size.header)}` }, M.formatBytes(r.size.total)),
          options.onSaveExample ? iconButton('save', 'Save response as example', options.onSaveExample) : null,
          iconButton('download', 'Save response to file', () => downloadResponse(r)),
          iconButton('more', 'More', (e) => UI.menu(e.currentTarget, [
            { label: 'Copy body', icon: 'copy', onClick: () => UI.copyText(bodyText(r)) },
            { label: 'Copy headers', icon: 'copy', onClick: () => UI.copyText(r.headers.map((x) => `${x.key}: ${x.value}`).join('\n')) },
            r.timings ? { label: 'Show timings', icon: 'history', onClick: () => timingsDialog(r) } : null
          ], { alignRight: true }))) : null);
      el.appendChild(head);
      const tab = s.respTab || 'body';
      if (tab === 'body') renderBody(s);
      else if (tab === 'cookies') renderCookies(s);
      else if (tab === 'headers') renderHeaders(s);
      else if (tab === 'tests') renderTests(s);
      else if (tab === 'visualize') renderVisualize(s);
    }

    function testBadge(s) {
      const total = (s.tests || []).length;
      if (!total) return (s.scriptErrors || []).length || null;
      const failed = s.tests.filter((t) => !t.passed && !t.skipped).length;
      return failed ? `${failed}/${total}` : `${total}/${total}`;
    }
    function testBadgeClass(s) {
      if ((s.scriptErrors || []).length) return 'fail';
      if (!(s.tests || []).length) return '';
      return s.tests.some((t) => !t.passed && !t.skipped) ? 'fail' : 'ok';
    }

    function bodyText(r) {
      if (!r) return '';
      return r.body != null ? r.body : (r.bodyBase64 ? '<binary data>' : '');
    }

    function renderBody(s) {
      const r = s.response;
      if (s.error && !r) {
        el.appendChild(h('div', { class: 'response-error' }, h('b', null, 'Could not send request'), s.error.message,
          s.error.code ? h('span', { class: 'mono' }, `Code: ${s.error.code}`) : null));
        return;
      }
      if (s.error && r) el.appendChild(h('div', { class: 'response-error' }, h('b', null, 'Error'), s.error.message));
      if (!r) return;
      s.bodyView = s.bodyView || 'pretty';
      if (!s.bodyLang) s.bodyLang = M.languageFromContentType(r.contentType, r.body);
      const isBinary = r.bodyBase64 != null && r.body == null;
      const toolbar = h('div', { class: 'pane-toolbar sub' },
        UI.tabStrip([{ id: 'pretty', label: 'Pretty' }, { id: 'raw', label: 'Raw' }, { id: 'preview', label: 'Preview' }], s.bodyView, (id) => { s.bodyView = id; render(); }, 'pill'),
        s.bodyView === 'pretty' ? UI.selectEl([['json', 'JSON'], ['xml', 'XML'], ['html', 'HTML'], ['javascript', 'JavaScript'], ['text', 'Text']], s.bodyLang, (v) => { s.bodyLang = v; render(); }, { style: { width: '110px', height: '24px' } }) : null,
        h('span', { class: 'spacer' }),
        r.truncated ? h('span', { class: 'muted' }, 'Body truncated to 10 MB') : null,
        iconButton('wrap', 'Toggle line wrap', () => { s.wrap = !s.wrap; render(); }, s.wrap ? 'active' : ''),
        iconButton('copy', 'Copy body', () => UI.copyText(bodyText(r))));
      el.appendChild(toolbar);
      const wrap = h('div', { class: 'code-wrap' });
      if (s.bodyView === 'preview') {
        renderPreview(wrap, r);
      } else if (isBinary) {
        wrap.appendChild(h('div', { class: 'empty-state' }, h('div', { class: 'empty-title' }, 'Binary response'), h('div', { class: 'empty-text' }, `${r.contentType || 'application/octet-stream'} · ${M.formatBytes(r.size.body)}. Use Preview for images or save the response to a file.`)));
      } else if (s.bodyView === 'pretty') {
        wrap.appendChild(UI.codeView(UI.prettyText(r.body || '', s.bodyLang), { language: s.bodyLang, wrap: s.wrap }));
      } else {
        wrap.appendChild(UI.codeView(r.body || '', { language: 'text', wrap: s.wrap, lineNumbers: false }));
      }
      el.appendChild(wrap);
    }

    function renderPreview(wrap, r) {
      const ct = String(r.contentType || '').toLowerCase();
      if (r.bodyBase64 != null && /^image\//.test(ct)) {
        wrap.appendChild(h('div', { class: 'preview-image' }, h('img', { src: `data:${ct.split(';')[0]};base64,${r.bodyBase64}`, alt: 'Response image' })));
        return;
      }
      if (/html|xml|svg/.test(ct) || /^\s*<!doctype html|^\s*<html/i.test(r.body || '')) {
        wrap.appendChild(sandboxFrame(r.body || '', false));
        return;
      }
      if (/json/.test(ct) || UI.isJson(r.body || '')) {
        wrap.appendChild(UI.codeView(UI.prettyText(r.body || '', 'json'), { language: 'json', wrap: true }));
        return;
      }
      wrap.appendChild(h('div', { class: 'empty-state' }, h('div', { class: 'empty-title' }, 'No preview available'), h('div', { class: 'empty-text' }, `Preview is available for HTML, XML, JSON and image responses (this one is ${r.contentType || 'untyped'}).`)));
    }

    function renderCookies(s) {
      const cookies = s.cookies || [];
      const body = h('div', { class: 'pane-body no-pad' });
      if (!cookies.length) body.appendChild(h('div', { class: 'empty-state' }, h('div', { class: 'empty-title' }, 'No cookies'), h('div', { class: 'empty-text' }, 'The response did not set any cookies, and none were sent for this domain.')));
      else body.appendChild(h('table', { class: 'cookies-table' },
        h('thead', null, h('tr', null, ['Name', 'Value', 'Domain', 'Path', 'Expires', 'HttpOnly', 'Secure'].map((x) => h('th', null, x)))),
        h('tbody', null, cookies.map((c) => h('tr', null, h('td', null, c.name), h('td', null, c.value), h('td', null, c.domain), h('td', null, c.path), h('td', null, c.expires || 'Session'), h('td', null, c.httpOnly ? 'true' : 'false'), h('td', null, c.secure ? 'true' : 'false'))))));
      el.appendChild(body);
    }

    function renderHeaders(s) {
      const r = s.response;
      const body = h('div', { class: 'pane-body no-pad' });
      if (!r) { el.appendChild(body); return; }
      body.appendChild(h('table', { class: 'headers-table' },
        h('thead', null, h('tr', null, h('th', null, 'Key'), h('th', null, 'Value'))),
        h('tbody', null, r.headers.map((x) => h('tr', null, h('td', null, x.key), h('td', null, x.value))))));
      el.appendChild(body);
    }

    function renderTests(s) {
      const tests = s.tests || [];
      const errors = s.scriptErrors || [];
      const body = h('div', { class: 'pane-body no-pad', style: { overflow: 'auto' } });
      if (!tests.length && !errors.length) {
        body.appendChild(h('div', { class: 'empty-state' }, h('div', { class: 'empty-title' }, 'No tests found'), h('div', { class: 'empty-text' }, 'Write pm.test() assertions in the Scripts tab to validate responses automatically.')));
      } else {
        const passed = tests.filter((t) => t.passed).length;
        const failed = tests.filter((t) => !t.passed && !t.skipped).length;
        body.appendChild(h('div', { class: 'summary-strip' }, h('span', null, 'All ', h('b', null, tests.length)), h('span', { class: 'status-2xx' }, 'Passed ', h('b', null, passed)), h('span', { class: 'status-4xx' }, 'Failed ', h('b', null, failed)), h('span', null, 'Skipped ', h('b', null, tests.filter((t) => t.skipped).length))));
        const list = h('div', { class: 'test-list' });
        errors.forEach((e) => list.appendChild(h('div', { class: 'test-row fail' }, h('span', { class: 'test-tag' }, 'ERROR'), h('div', { class: 'test-name' }, `${e.target === 'test' ? 'Post-response' : 'Pre-request'} script`, h('div', { class: 'test-error' }, e.message)))));
        tests.forEach((t) => list.appendChild(h('div', { class: `test-row ${t.skipped ? 'skip' : t.passed ? 'pass' : 'fail'}` },
          h('span', { class: 'test-tag' }, t.skipped ? 'SKIP' : t.passed ? 'PASS' : 'FAIL'),
          h('div', { class: 'test-name' }, t.name, t.error ? h('div', { class: 'test-error' }, t.error.message) : null))));
        body.appendChild(list);
      }
      el.appendChild(body);
    }

    function renderVisualize(s) {
      const v = s.visualizer;
      if (v.error) { el.appendChild(h('div', { class: 'response-error' }, h('b', null, 'Visualizer error'), v.error.message)); return; }
      const wrap = h('div', { class: 'code-wrap' });
      wrap.appendChild(sandboxFrame(v.processedTemplate || '', true));
      el.appendChild(wrap);
    }

    el.render = render;
    return el;
  }

  function sandboxFrame(html, allowScripts) {
    const frame = h('iframe', { class: 'preview-frame', sandbox: allowScripts ? 'allow-scripts' : '', src: '../frame.html', title: allowScripts ? 'Visualizer' : 'Preview' });
    frame.addEventListener('load', () => { try { frame.contentWindow.postMessage({ html }, '*'); } catch (_) { /* frame gone */ } });
    return frame;
  }

  async function downloadResponse(r) {
    const ext = ({ json: 'json', html: 'html', xml: 'xml', javascript: 'js', text: 'txt' })[M.languageFromContentType(r.contentType, r.body)] || 'bin';
    const binary = r.bodyBase64 != null && r.body == null;
    const file = await root.apiforge.files.saveText({ defaultName: `response.${binary ? (String(r.contentType).split('/')[1] || 'bin').split(';')[0] : ext}`, content: binary ? r.bodyBase64 : (r.body || ''), base64: binary });
    if (file) toast(`Saved to ${file}`, 'success');
  }

  function timingsDialog(r) {
    const t = r.timings || {};
    const rows = [['DNS lookup', t.dns], ['TCP handshake', t.tcp], ['TLS handshake', t.secureHandshake], ['First byte', t.firstByte], ['Download', t.download], ['Total', t.total]];
    UI.modal({ title: 'Response timings', body: h('table', { class: 'data-table' }, h('tbody', null, rows.map(([k, v]) => h('tr', null, h('td', null, k), h('td', null, v == null ? '—' : M.formatMs(v)))))), actions: [{ label: 'Close', primary: true }] });
  }

  // ---------------------------------------------------------------------------
  // Request view
  // ---------------------------------------------------------------------------
  function requestView(tab) {
    const App = root.App;
    const el = h('div', { class: 'view request-view' });
    const draft = tab.draft;
    const getVars = () => App.vars(tab.collectionId);
    let urlInput;
    let subtabsEl;
    let requestPane;
    let requestBody;
    let header;
    let saveBtn;
    const respState = tab; // response state lives on the tab so it survives view rebuilds
    const responseEl = responseViewer(() => respState, {
      onSaveExample: () => App.saveAsExample(tab),
      onCancel: () => App.abort(tab.running),
      onTabChange: () => App.save()
    });

    const dirty = () => App.markDirty(tab);

    // Header ----------------------------------------------------------------
    function renderHeader() {
      clear(header);
      const crumbs = [];
      if (tab.collectionId) {
        const c = App.findCollection(tab.collectionId);
        const hit = c && tab.itemId ? M.findNode(c, tab.itemId) : null;
        if (c) crumbs.push(c.info.name);
        if (hit) hit.ancestors.forEach((a) => crumbs.push(a.name));
      }
      const name = h('input', { class: 'title-input', value: draft.name, 'aria-label': 'Request name', spellcheck: false });
      name.addEventListener('input', () => { draft.name = name.value; dirty(); });
      name.addEventListener('keydown', (e) => { if (e.key === 'Enter') name.blur(); });
      const sizer = () => { name.style.width = `${Math.min(420, Math.max(100, name.value.length * 8 + 24))}px`; };
      name.addEventListener('input', sizer);
      sizer();
      UI.append(header,
        crumbs.length ? h('div', { class: 'breadcrumb' }, crumbs.flatMap((c, i) => [i ? h('span', { class: 'sep' }, '/') : null, h('span', { class: 'crumb' }, c)]), h('span', { class: 'sep' }, '/')) : null,
        name,
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn btn-small btn-secondary', type: 'button', title: 'Generate code snippet', onclick: () => App.showCode(draft, tab.collectionId) }, icon('code', 14), 'Code'),
        (saveBtn = h('button', { class: `btn btn-small ${App.isDirty(tab) ? 'btn-primary' : 'btn-secondary'}`, type: 'button', title: 'Save (Ctrl+S)', onclick: () => App.saveRequestTab(tab) }, icon('save', 14), 'Save')),
        iconButton('more', 'More', (e) => UI.menu(e.currentTarget, [
          { label: 'Save As…', icon: 'save', onClick: () => root.Views.dialogs.saveAs(tab) },
          { label: 'Duplicate Tab', icon: 'copy', onClick: () => App.newRequest(M.clone(draft), { collectionId: tab.collectionId }) },
          { label: 'Copy as cURL', icon: 'code', onClick: () => UI.copyText(Codegen.generate('curl', draft, (s) => M.substitute(s, getVars()))) },
          'separator',
          tab.collectionId ? { label: 'Run Collection', icon: 'runner', onClick: () => App.openRunner(tab.collectionId) } : null
        ], { alignRight: true })));
    }

    // URL bar ----------------------------------------------------------------
    function buildUrlBar() {
      const methodSel = h('select', { class: `select method-select m-${draft.method.toLowerCase()}`, 'aria-label': 'Method' }, M.METHODS.map((m) => h('option', { value: m, selected: m === draft.method }, m)));
      methodSel.addEventListener('change', () => {
        draft.method = methodSel.value;
        methodSel.className = `select method-select m-${draft.method.toLowerCase()}`;
        dirty();
        refreshSubtabs();
      });
      urlInput = UI.varInput({
        value: draft.url,
        placeholder: 'Enter URL or paste text',
        className: 'lg boxed',
        getVars,
        onInput: (v) => {
          if (/^\s*curl\s/i.test(v)) {
            const parsed = M.parseCurl(v);
            if (parsed) {
              Object.assign(draft, { method: parsed.method, url: parsed.url, params: parsed.params, pathVars: parsed.pathVars, headers: parsed.headers, body: parsed.body, auth: parsed.auth });
              methodSel.value = draft.method;
              methodSel.className = `select method-select m-${draft.method.toLowerCase()}`;
              urlInput.setValue(draft.url);
              dirty();
              renderRequestBody();
              refreshSubtabs();
              toast('Imported cURL command', 'success');
              return;
            }
          }
          draft.url = v;
          M.syncFromUrl(draft);
          dirty();
          if (tab.subtab === 'params') renderRequestBody();
          refreshSubtabs();
        },
        onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault(); App.sendRequest(tab); } }
      });
      const sendBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => App.sendRequest(tab) }, 'Send');
      const sendMenu = h('button', { class: 'btn btn-primary', type: 'button', title: 'More send options', onclick: (e) => UI.menu(e.currentTarget, [
        { label: 'Send', icon: 'send', shortcut: 'Ctrl+Enter', onClick: () => App.sendRequest(tab) },
        { label: 'Send and Download', icon: 'download', onClick: () => sendAndDownload() }
      ], { alignRight: true }) }, icon('chevron-down', 14));
      el.sendBtn = sendBtn;
      return h('div', { class: 'url-bar' }, methodSel, urlInput, h('span', { class: 'btn-group' }, sendBtn, sendMenu));
    }

    async function sendAndDownload() {
      App.sendRequest(tab);
      const wait = () => new Promise((resolve) => { const t = setInterval(() => { if (!tab.running) { clearInterval(t); resolve(); } }, 100); });
      await wait();
      if (tab.response) downloadResponse(tab.response);
    }

    // Request pane -----------------------------------------------------------
    function subtabItems() {
      const count = (rows) => rows.filter((r) => r.enabled !== false && !M.isBlankRow(r)).length;
      return REQUEST_TABS.map((t) => {
        const item = { ...t };
        if (t.id === 'params') item.badge = count(draft.params) + draft.pathVars.length || null;
        if (t.id === 'headers') item.badge = count(draft.headers) || null;
        if (t.id === 'body') item.dot = draft.body.mode !== 'none';
        if (t.id === 'scripts') item.dot = !!(draft.scripts.prerequest.trim() || draft.scripts.test.trim());
        if (t.id === 'auth') item.dot = draft.auth.type !== 'inherit' && draft.auth.type !== 'noauth';
        if (t.id === 'settings') item.dot = Object.values(draft.settings || {}).some((v) => v !== undefined && v !== '');
        return item;
      });
    }

    function refreshSubtabs() {
      const next = UI.tabStrip(subtabItems(), tab.subtab, (id) => { tab.subtab = id; refreshSubtabs(); renderRequestBody(); App.save(); });
      subtabsEl.replaceWith(next);
      subtabsEl = next;
    }

    function renderRequestBody() {
      clear(requestBody);
      requestBody.className = 'pane-body';
      switch (tab.subtab) {
        case 'params': renderParams(); break;
        case 'auth': renderAuth(); break;
        case 'headers': renderHeaders(); break;
        case 'body': renderBodyEditor(); break;
        case 'scripts': renderScripts(); break;
        case 'settings': renderSettings(); break;
        default: break;
      }
    }

    function renderParams() {
      requestBody.appendChild(UI.kvEditor({
        title: 'Query Params', rows: draft.params, getVars, description: true,
        onChange: () => { M.syncUrlFromParams(draft); urlInput.setValue(draft.url); dirty(); refreshSubtabs(); }
      }));
      if (draft.pathVars.length) {
        requestBody.appendChild(UI.kvEditor({ title: 'Path Variables', rows: draft.pathVars, getVars, description: true, fixedKeys: true, bulk: false, onChange: () => { dirty(); } }));
      }
    }

    function renderHeaders() {
      requestBody.appendChild(UI.kvEditor({ title: 'Headers', rows: draft.headers, getVars, description: true, onChange: () => { dirty(); refreshSubtabs(); } }));
      const auto = computedHeaders();
      requestBody.appendChild(h('details', { class: 'auto-headers' }, h('summary', null, `${auto.length} auto-generated headers (sent with the request)`),
        h('div', { class: 'kv-table' }, h('div', { class: 'kv-row kv-head' }, h('div', { class: 'kv-cell kv-check' }), h('div', { class: 'kv-cell' }, 'Key'), h('div', { class: 'kv-cell' }, 'Value'), h('div', { class: 'kv-cell kv-actions' })),
          auto.map(([k, v]) => h('div', { class: 'kv-row' }, h('div', { class: 'kv-cell kv-check' }), h('div', { class: 'kv-cell kv-static' }, k), h('div', { class: 'kv-cell kv-static muted' }, v), h('div', { class: 'kv-cell kv-actions' }))))));
    }

    function computedHeaders() {
      const user = new Set(draft.headers.filter((r) => r.enabled !== false && r.key).map((r) => r.key.toLowerCase()));
      const out = [];
      const normalized = Codegen.normalize(draft);
      normalized.headers.forEach((x) => { if (!draft.headers.some((r) => r.key.toLowerCase() === x.key.toLowerCase() && r.enabled !== false)) out.push([x.key, x.value]); });
      if (normalized.body && normalized.body.mode === 'formdata') out.push(['Content-Type', 'multipart/form-data; boundary=<calculated when request is sent>']);
      if (normalized.body) out.push(['Content-Length', '<calculated when request is sent>']);
      const host = (draft.url.match(/^(?:[a-z]+:\/\/)?([^/?#]+)/i) || [])[1];
      if (host) out.push(['Host', host]);
      AUTO_HEADERS.forEach(([k, v]) => { if (!user.has(k.toLowerCase())) out.push([k, v]); });
      return out;
    }

    // Authorization ---------------------------------------------------------
    function inheritedAuth() {
      if (!tab.collectionId) return null;
      const c = App.findCollection(tab.collectionId);
      if (!c) return null;
      const hit = tab.itemId ? M.findNode(c, tab.itemId) : null;
      const chain = (hit ? hit.ancestors : []).slice().reverse();
      for (const folder of chain) if (folder.auth && folder.auth.type) return { from: folder.name, auth: folder.auth };
      if (c.auth && c.auth.type) return { from: c.info.name, auth: c.auth };
      return null;
    }

    function renderAuth() {
      const form = h('div', { class: 'auth-form' });
      const typeSel = UI.selectEl(M.AUTH_TYPES.map((a) => [a.type, a.label]), draft.auth.type, (v) => {
        draft.auth = { type: v, params: { ...M.defaultAuthParams(v), ...(draft.auth.type === v ? draft.auth.params : {}) } };
        dirty();
        refreshSubtabs();
        renderRequestBody();
      }, { style: { width: '260px' } });
      form.appendChild(h('div', { class: 'auth-layout' },
        h('div', null, h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Auth Type'), typeSel),
          h('div', { class: 'field-help' }, 'The authorization header will be automatically generated when you send the request. Values can reference variables, e.g. {{token}}.')),
        authFields()));
      requestBody.appendChild(form);
    }

    function authFields() {
      const type = draft.auth.type;
      const params = draft.auth.params;
      if (type === 'inherit') {
        const inh = inheritedAuth();
        const label = inh ? (M.AUTH_BY_TYPE[inh.auth.type] || { label: inh.auth.type }).label : 'No Auth';
        return h('div', { class: 'auth-inherit' }, icon('info', 16), h('div', null, `This request is using ${label}`, inh ? ` from ${inh.from}.` : ' (nothing to inherit from).', h('br'), 'Choose a different type above to override it.'));
      }
      if (type === 'noauth') return h('div', { class: 'auth-inherit' }, icon('info', 16), h('div', null, 'This request does not use any authorization.'));
      const schema = M.AUTH_BY_TYPE[type];
      if (!schema) return h('div', null);
      const container = h('div');
      const main = h('div');
      const advanced = h('div');
      const tokenSection = h('div');
      const fieldEl = (f) => {
        if (f.when && Object.entries(f.when).some(([k, v]) => (params[k] === undefined ? (M.defaultAuthParams(type)[k]) : params[k]) !== v)) return null;
        const value = params[f.key] === undefined ? (f.default === undefined ? '' : f.default) : params[f.key];
        let input;
        if (f.input === 'select') input = UI.selectEl(f.options, String(value), (v) => { params[f.key] = v; dirty(); renderRequestBody(); });
        else if (f.input === 'bool') return h('div', { class: 'field' }, UI.toggle(f.label, !!value, (v) => { params[f.key] = v; dirty(); }));
        else if (f.input === 'textarea') input = UI.varInput({ value, getVars, multiline: true, className: 'boxed', onInput: (v) => { params[f.key] = v; dirty(); } });
        else {
          input = UI.varInput({ value, getVars, className: 'boxed', onInput: (v) => { params[f.key] = v; dirty(); } });
          if (f.input === 'secret') {
            input.setMasked(true);
            const eye = iconButton('eye', 'Show', (e) => { const masked = input.input.type === 'password'; input.setMasked(!masked); e.currentTarget.replaceChildren(icon(masked ? 'eye-off' : 'eye')); });
            input = h('div', { class: 'kv-secret' }, input, eye);
          }
        }
        return h('label', { class: 'field' }, h('span', { class: 'field-label' }, f.label), input);
      };
      schema.fields.forEach((f) => {
        const node = fieldEl(f);
        if (!node) return;
        if (f.section === 'token') tokenSection.appendChild(node);
        else if (f.advanced) advanced.appendChild(node);
        else main.appendChild(node);
      });
      container.appendChild(main);
      if (type === 'oauth2') {
        container.appendChild(h('h3', { style: { fontSize: '13px', margin: '14px 0 8px' } }, 'Configure New Token'));
        container.appendChild(tokenSection);
        container.appendChild(h('button', { class: 'btn btn-secondary', type: 'button', onclick: fetchOAuthToken }, 'Get New Access Token'));
      }
      if (advanced.childElementCount) container.appendChild(h('details', { class: 'advanced' }, h('summary', null, 'Advanced'), advanced));
      return container;
    }

    async function fetchOAuthToken() {
      const p = { ...M.defaultAuthParams('oauth2'), ...draft.auth.params };
      const sub = (s) => M.substitute(String(s || ''), getVars());
      if (!p.accessTokenUrl) { toast('Enter an Access Token URL first', 'warning'); return; }
      const grant = p.grant_type === 'password_credentials' ? 'password' : 'client_credentials';
      const body = [['grant_type', grant]];
      if (grant === 'password') body.push(['username', sub(p.username)], ['password', sub(p.password)]);
      if (p.scope) body.push(['scope', sub(p.scope)]);
      const headers = [{ key: 'Accept', value: 'application/json' }];
      if (p.client_authentication === 'body') body.push(['client_id', sub(p.clientId)], ['client_secret', sub(p.clientSecret)]);
      else headers.push({ key: 'Authorization', value: `Basic ${btoa(unescape(encodeURIComponent(`${sub(p.clientId)}:${sub(p.clientSecret)}`)))}` });
      toast('Requesting token…');
      const { request } = await App.runAdhoc({
        info: { name: 'OAuth2 token', schema: M.SCHEMA_V21 },
        item: [{ name: 'token', request: { method: 'POST', url: sub(p.accessTokenUrl), header: headers, body: { mode: 'urlencoded', urlencoded: body.map(([key, value]) => ({ key, value })) } } }]
      });
      if (!request || !request.response) { toast(`Token request failed: ${request && request.error ? request.error.message : 'no response'}`, 'error'); return; }
      let json = null;
      try { json = JSON.parse(request.response.body); } catch (_) { /* not json */ }
      if (!json || !json.access_token) { toast(`Token endpoint returned ${request.response.code} without an access_token`, 'error'); return; }
      draft.auth.params.accessToken = json.access_token;
      dirty();
      renderRequestBody();
      toast('Access token received', 'success');
    }

    // Body -------------------------------------------------------------------
    function renderBodyEditor() {
      const body = draft.body;
      const modeRow = h('div', { class: 'body-mode-row' },
        UI.radioGroup('body-mode', [['none', 'none'], ['formdata', 'form-data'], ['urlencoded', 'x-www-form-urlencoded'], ['raw', 'raw'], ['file', 'binary'], ['graphql', 'GraphQL']], body.mode, (v) => { body.mode = v; dirty(); refreshSubtabs(); renderRequestBody(); }));
      requestBody.appendChild(modeRow);
      requestBody.classList.add('column');
      if (body.mode === 'raw') {
        modeRow.append(UI.selectEl(M.RAW_LANGUAGES, body.language, (v) => { body.language = v; dirty(); renderRequestBody(); }),
          h('button', { class: 'btn btn-small btn-secondary', type: 'button', onclick: () => {
            const pretty = UI.prettyText(body.raw, body.language);
            if (pretty !== body.raw) { body.raw = pretty; editor.setValue(pretty); dirty(); }
          } }, 'Beautify'));
        const editor = UI.codeEditor({ value: body.raw, language: body.language, placeholder: body.language === 'json' ? '{\n  "key": "value"\n}' : '', onInput: (v) => { body.raw = v; dirty(); } });
        requestBody.appendChild(h('div', { class: 'editor-wrap' }, editor));
      } else if (body.mode === 'formdata') {
        requestBody.appendChild(UI.kvEditor({ rows: body.formdata, getVars, description: true, files: true, pickFile: App.pickFile, onChange: () => dirty() }));
      } else if (body.mode === 'urlencoded') {
        requestBody.appendChild(UI.kvEditor({ rows: body.urlencoded, getVars, description: true, onChange: () => dirty() }));
      } else if (body.mode === 'file') {
        const name = body.file ? body.file.split(/[\\/]/).pop() : '';
        requestBody.appendChild(h('div', { class: 'file-picker' },
          h('button', { class: 'btn btn-secondary btn-small', type: 'button', onclick: async () => { const p = await App.pickFile(); if (p) { body.file = p; dirty(); renderRequestBody(); } } }, 'Select File'),
          h('span', { title: body.file }, name || 'No file selected'),
          body.file ? iconButton('x', 'Clear', () => { body.file = ''; dirty(); renderRequestBody(); }) : null));
      } else if (body.mode === 'graphql') {
        const q = UI.codeEditor({ value: body.graphql.query, language: 'graphql', placeholder: 'query {\n  field\n}', onInput: (v) => { body.graphql.query = v; dirty(); } });
        const v = UI.codeEditor({ value: body.graphql.variables, language: 'json', placeholder: '{ "id": 1 }', onInput: (val) => { body.graphql.variables = val; dirty(); } });
        requestBody.appendChild(h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', flex: 1, minHeight: 0 } },
          h('div', { class: 'editor-wrap' }, h('div', { class: 'kv-title', style: { marginBottom: '6px' } }, 'Query'), q),
          h('div', { class: 'editor-wrap' }, h('div', { class: 'kv-title', style: { marginBottom: '6px' } }, 'GraphQL Variables'), v)));
      } else {
        requestBody.appendChild(h('div', { class: 'muted', style: { padding: '20px 0', textAlign: 'center' } }, 'This request does not have a body'));
      }
    }

    // Scripts ----------------------------------------------------------------
    function renderScripts() {
      tab.scriptTab = tab.scriptTab || 'prerequest';
      requestBody.className = 'pane-body no-pad column';
      const editor = UI.codeEditor({ value: draft.scripts[tab.scriptTab], language: 'javascript', placeholder: tab.scriptTab === 'prerequest' ? '// Runs before the request is sent' : '// Runs after the response is received\npm.test("Status code is 200", () => pm.response.to.have.status(200));', onInput: (v) => { draft.scripts[tab.scriptTab] = v; dirty(); refreshSubtabs(); } });
      editor.style.border = 'none';
      editor.style.borderRadius = '0';
      const pills = UI.tabStrip([{ id: 'prerequest', label: 'Pre-request' }, { id: 'test', label: 'Post-response' }], tab.scriptTab, (id) => { tab.scriptTab = id; renderRequestBody(); }, 'pill');
      requestBody.appendChild(h('div', { class: 'pane-toolbar sub' }, pills, h('span', { class: 'spacer' }), h('span', { class: 'faint' }, 'Ctrl+/ toggles comments')));
      requestBody.appendChild(h('div', { class: 'scripts-layout' },
        h('div', { class: 'scripts-main' }, editor),
        h('div', { class: 'snippets' }, h('div', { class: 'snippets-title' }, 'Snippets'), SNIPPETS.map(([label, code]) => h('button', { class: 'snippet', type: 'button', onclick: () => editor.insert(code) }, label)))));
    }

    // Settings ---------------------------------------------------------------
    function renderSettings() {
      const s = draft.settings;
      const list = h('div', { class: 'settings-list' });
      const desc = h('textarea', { class: 'textarea', placeholder: 'Describe this request (shown in exports and documentation)…' });
      desc.value = draft.description || '';
      desc.addEventListener('input', () => { draft.description = desc.value; dirty(); });
      list.appendChild(h('div', null, h('div', { class: 'setting-title', style: { marginBottom: '6px' } }, 'Description'), desc));
      const tri = (key, title, desc) => {
        const sel = UI.selectEl([['', 'Use app default'], ['true', 'On'], ['false', 'Off']], s[key] === undefined ? '' : String(s[key]), (v) => { if (v === '') delete s[key]; else s[key] = v === 'true'; dirty(); refreshSubtabs(); }, { style: { width: '160px' } });
        return h('div', { class: 'setting-row' }, h('div', { class: 'setting-text' }, h('div', { class: 'setting-title' }, title), h('div', { class: 'setting-desc' }, desc)), sel);
      };
      list.append(
        tri('followRedirects', 'Automatically follow redirects', 'Follow HTTP 3xx responses as redirects.'),
        tri('followOriginalHttpMethod', 'Follow original HTTP Method', 'Redirect with the original HTTP method instead of the default behavior of redirecting with GET.'),
        tri('strictSSL', 'Enable SSL certificate verification', 'Verify SSL certificates when sending a request. Off accepts self-signed certificates.'),
        tri('disableUrlEncoding', 'Disable URL encoding', 'Send the URL exactly as typed without encoding reserved characters.'),
        tri('disableCookies', 'Disable cookie jar', 'Do not send or store cookies for this request.'),
        h('div', { class: 'setting-row' }, h('div', { class: 'setting-text' }, h('div', { class: 'setting-title' }, 'Maximum number of redirects'), h('div', { class: 'setting-desc' }, 'Leave empty to use the runtime default (10).')),
          h('input', { class: 'input', type: 'number', min: 0, value: s.maxRedirects === undefined ? '' : s.maxRedirects, oninput: (e) => { const v = e.target.value; if (v === '') delete s.maxRedirects; else s.maxRedirects = Number(v); dirty(); refreshSubtabs(); } })));
      requestBody.appendChild(list);
    }

    // Layout -----------------------------------------------------------------
    function build() {
      clear(el);
      header = h('div', { class: 'view-header' });
      renderHeader();
      subtabsEl = UI.tabStrip(subtabItems(), tab.subtab, (id) => { tab.subtab = id; refreshSubtabs(); renderRequestBody(); App.save(); });
      requestBody = h('div', { class: 'pane-body' });
      requestPane = h('div', { class: 'pane pane-request', style: { height: `${tab.reqPaneHeight || 300}px` } }, subtabsEl, requestBody);
      const splitter = h('div', { class: 'splitter-y' });
      UI.splitter(splitter, {
        axis: 'y',
        onStart: () => requestPane.offsetHeight,
        onMove: (dy, start) => { tab.reqPaneHeight = Math.max(120, Math.min(el.offsetHeight - 160, start + dy)); requestPane.style.height = `${tab.reqPaneHeight}px`; },
        onEnd: () => App.save()
      });
      el.append(header, buildUrlBar(), requestPane, splitter, responseEl);
      renderRequestBody();
      responseEl.render();
    }

    build();

    return {
      el,
      markDirty() {
        if (!saveBtn) return;
        const dirty = App.isDirty(tab);
        saveBtn.classList.toggle('btn-primary', dirty);
        saveBtn.classList.toggle('btn-secondary', !dirty);
      },
      update() {
        renderHeader();
        responseEl.render();
        el.querySelectorAll('.var-input').forEach((w) => w.repaint && w.repaint());
        if (el.sendBtn) {
          el.sendBtn.textContent = tab.running ? 'Cancel' : 'Send';
          el.sendBtn.classList.toggle('btn-danger', !!tab.running);
          el.sendBtn.classList.toggle('btn-primary', !tab.running);
        }
        if (urlInput && urlInput.input.value !== draft.url) urlInput.setValue(draft.url);
      },
      focus() {
        if (!draft.url && urlInput) urlInput.input.focus();
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Example view (saved response)
  // ---------------------------------------------------------------------------
  function exampleView(tab) {
    const App = root.App;
    const el = h('div', { class: 'view' });
    const state = { respTab: 'body' };

    function render() {
      clear(el);
      const c = App.findCollection(tab.collectionId);
      const hit = c && M.findNode(c, tab.itemId);
      const ex = hit && (hit.node.response || []).find((r) => r.id === tab.exampleId);
      if (!ex) { el.appendChild(UI.emptyState('example', 'Example not found', 'This example was deleted.')); return; }
      const draft = M.draftFromItem({ name: ex.name, request: ex.originalRequest || hit.node.request });
      const headers = (ex.header || []).map((x) => ({ key: x.key, value: String(x.value) }));
      state.response = { code: ex.code, status: ex.status, responseTime: null, contentType: (headers.find((x) => /^content-type$/i.test(x.key)) || {}).value || '', headers, size: { body: new TextEncoder().encode(ex.body || '').length, header: 0, total: new TextEncoder().encode(ex.body || '').length }, body: ex.body || '', bodyBase64: null, truncated: false };
      state.cookies = (ex.cookie || []).map((ck) => ({ name: ck.name, value: ck.value, domain: ck.domain, path: ck.path, expires: ck.expires, httpOnly: ck.httpOnly, secure: ck.secure }));
      state.bodyLang = ex._postman_previewlanguage || M.languageFromContentType(state.response.contentType, ex.body);
      const name = h('input', { class: 'title-input', value: ex.name, 'aria-label': 'Example name' });
      name.addEventListener('change', () => { ex.name = name.value || ex.name; App.save(); App.notify({ sidebar: true, tabbar: true }); });
      el.append(
        h('div', { class: 'example-banner' }, icon('example', 14), h('span', null, 'Example of '), h('b', null, hit.node.name), h('span', { class: 'spacer' }), h('button', { class: 'btn btn-small btn-secondary', type: 'button', onclick: () => App.openRequest(tab.collectionId, tab.itemId) }, 'Open request')),
        h('div', { class: 'view-header' }, name, h('span', { class: 'spacer' }), h('button', { class: 'btn btn-small btn-secondary', type: 'button', onclick: () => App.newRequest(draft, { collectionId: tab.collectionId }) }, 'Try request')),
        h('div', { class: 'url-bar' }, methodBadge(draft.method), h('div', { class: 'var-input lg boxed', style: { flex: 1 } }, h('div', { class: 'var-backdrop', style: { color: 'var(--text)' } }, draft.url))),
        h('div', { class: 'pane pane-request', style: { height: '160px' } }, h('div', { class: 'pane-body' },
          h('div', { class: 'kv-title' }, 'Request headers'),
          draft.headers.length ? h('table', { class: 'headers-table' }, h('tbody', null, draft.headers.map((x) => h('tr', null, h('td', null, x.key), h('td', null, x.value))))) : h('div', { class: 'kv-empty' }, 'No headers'),
          draft.body.mode !== 'none' ? h('div', null, h('div', { class: 'kv-title', style: { marginTop: '10px' } }, `Body (${draft.body.mode})`), UI.codeView(draft.body.mode === 'raw' ? draft.body.raw : JSON.stringify(draft.body[draft.body.mode] || draft.body.file || draft.body.graphql, null, 2), { language: draft.body.mode === 'raw' ? draft.body.language : 'json', wrap: true, lineNumbers: false })) : null)));
      const viewer = responseViewer(() => state, {});
      el.appendChild(viewer);
      viewer.render();
    }
    render();
    return { el, update: render };
  }

  root.Views.request = requestView;
  root.Views.example = exampleView;
  root.Views.responseViewer = responseViewer;
})(window);
