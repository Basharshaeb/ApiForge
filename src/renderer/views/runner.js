/**
 * Collection runner: configure a run, watch it progress, inspect results.
 */
(function (root) {
  'use strict';

  root.Views = root.Views || {};
  const M = root.ApiForgeModel;
  const UI = root.UI;
  const { h, clear, icon, iconButton, methodBadge, toast } = UI;

  const statusClass = (code) => (code ? `status-${Math.floor(code / 100)}xx` : 'status-err');

  function runnerView(tab) {
    const App = root.App;
    const el = h('div', { class: 'view' });
    const config = Object.assign({ folderId: '', iterations: 1, delay: 0, data: null, dataName: '', stopOnError: false, persist: true }, tab.config);
    tab.config = config;
    let resultsEl;

    function folders(c) {
      const out = [];
      M.walk(c.item, (node, ancestors) => { if (M.isFolder(node)) out.push({ id: node.id, label: [...ancestors.map((a) => a.name), node.name].join(' / ') }); });
      return out;
    }

    function scopeItems(c) {
      if (!config.folderId) return c.item;
      const hit = M.findNode(c, config.folderId);
      return hit ? hit.node.item : c.item;
    }

    async function pickData() {
      const files = await root.apiforge.files.openText({ title: 'Select data file', filters: [{ name: 'Data files', extensions: ['csv', 'json'] }] });
      if (!files.length) return;
      try {
        const data = M.parseDataFile(files[0].name, files[0].content);
        config.data = data;
        config.dataName = files[0].name;
        config.iterations = data.length || 1;
        App.save();
        renderConfig();
      } catch (err) {
        toast(`Could not read data file: ${err.message}`, 'error');
      }
    }

    function start() {
      const c = App.findCollection(tab.collectionId);
      if (!c) return;
      if (!M.countRequests(scopeItems(c))) { toast('Nothing to run: add requests first', 'warning'); return; }
      const collection = M.ensureIds(M.clone(c));
      const id = M.uid();
      const env = App.activeEnvironment();
      const iterations = config.data ? config.data.length : Math.max(1, Number(config.iterations) || 1);
      tab.running = id;
      tab.result = { startedAt: Date.now(), finishedAt: null, items: [], byRef: {}, total: M.countRequests(scopeItems(c)) * iterations, iterations, aborted: false, error: null, errors: [] };
      const r = tab.result;
      App.execute({
        id,
        collection,
        environment: env ? M.scopeFromRows(env.values) : { values: [] },
        globals: M.scopeFromRows(App.state.globals.values),
        options: {
          ...App.requestOptions(),
          iterationCount: iterations,
          delay: Number(config.delay) || 0,
          data: config.data || undefined,
          stopOnError: !!config.stopOnError,
          entrypoint: config.folderId ? { execute: config.folderId } : undefined
        }
      }, (msg) => {
        const { event, data } = msg;
        const ref = data && data.cursor ? data.cursor.ref : null;
        switch (event) {
          case 'beforeItem': {
            const item = { ref, iteration: data.cursor.iteration, name: data.item ? data.item.name : '', id: data.item ? data.item.id : null, method: methodOf(collection, data.item), status: 'running', assertions: [], errors: [], response: null, error: null, startedAt: Date.now() };
            r.items.push(item);
            r.byRef[ref] = item;
            break;
          }
          case 'request': {
            const item = r.byRef[ref];
            if (!item) break;
            item.response = data.response ? { code: data.response.code, status: data.response.status, time: data.response.responseTime, size: data.response.size.total } : null;
            item.error = data.error;
            item.url = data.request ? data.request.url : '';
            if (data.request) item.method = data.request.method;
            break;
          }
          case 'assertion': { const item = r.byRef[ref]; if (item) item.assertions.push(...data.assertions); break; }
          case 'script': { const item = r.byRef[ref]; if (item) data.errors.forEach((e) => item.errors.push(`${data.target === 'test' ? 'Post-response' : 'Pre-request'}: ${e.message}`)); break; }
          case 'item': { const item = r.byRef[ref]; if (item) { item.status = 'done'; if (data.error && !item.error) item.error = data.error; } break; }
          case 'console': App.log({ type: data.level, ts: Date.now(), messages: data.messages, tabId: tab.id }); break;
          case 'exception': r.errors.push(data.error ? data.error.message : 'Unknown error'); App.log({ type: 'error', ts: Date.now(), messages: [`Runner: ${data.error ? data.error.message : 'Unknown error'}`], tabId: tab.id }); break;
          case 'done':
            tab.running = null;
            r.finishedAt = Date.now();
            r.aborted = !!data.aborted;
            r.error = data.error;
            r.items.forEach((it) => { if (it.status === 'running') it.status = 'cancelled'; });
            if (config.persist && !data.aborted) App.mergeScopes(data);
            App.save();
            break;
          default: break;
        }
        renderResults();
      });
      renderConfig();
      renderResults();
    }

    function methodOf(collection, itemRef) {
      if (!itemRef) return 'GET';
      const hit = M.findNode(collection, itemRef.id);
      return hit && hit.node.request ? (typeof hit.node.request === 'string' ? 'GET' : hit.node.request.method) : 'GET';
    }

    function stop() {
      if (tab.running) App.abort(tab.running);
    }

    async function exportResults() {
      const r = tab.result;
      if (!r) return;
      const c = App.findCollection(tab.collectionId);
      const data = {
        collection: c ? c.info.name : '', startedAt: new Date(r.startedAt).toISOString(), finishedAt: r.finishedAt ? new Date(r.finishedAt).toISOString() : null,
        iterations: r.iterations, aborted: r.aborted,
        results: r.items.map((it) => ({ iteration: it.iteration + 1, name: it.name, method: it.method, url: it.url, status: it.status, response: it.response, error: it.error ? it.error.message : null, assertions: it.assertions.map((a) => ({ name: a.name, passed: a.passed, skipped: a.skipped, error: a.error ? a.error.message : null })), scriptErrors: it.errors }))
      };
      const file = await root.apiforge.files.saveText({ defaultName: `run-results-${Date.now()}.json`, content: JSON.stringify(data, null, 2), filters: [{ name: 'JSON', extensions: ['json'] }] });
      if (file) toast(`Exported to ${file}`, 'success');
    }

    // Config panel --------------------------------------------------------------
    let configEl;
    function renderConfig() {
      clear(configEl);
      const c = App.findCollection(tab.collectionId);
      if (!c) { configEl.appendChild(h('div', { class: 'muted' }, 'Collection not found')); return; }
      const running = !!tab.running;
      const env = App.activeEnvironment();
      configEl.append(
        h('h3', null, icon('runner', 16), ' ', c.info.name),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Run'), UI.selectEl([['', 'Entire collection'], ...folders(c).map((f) => [f.id, f.label])], config.folderId, (v) => { config.folderId = v; App.save(); }, { disabled: running })),
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Environment'), h('div', { class: 'muted' }, env ? env.name : 'No environment (change it in the top bar)')),
        h('div', { class: 'field-row' },
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Iterations'), h('input', { class: 'input', type: 'number', min: 1, max: 10000, value: config.iterations, disabled: running || !!config.data, oninput: (e) => { config.iterations = Math.max(1, Number(e.target.value) || 1); App.save(); } })),
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Delay (ms)'), h('input', { class: 'input', type: 'number', min: 0, value: config.delay, disabled: running, oninput: (e) => { config.delay = Math.max(0, Number(e.target.value) || 0); App.save(); } }))),
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Data file (CSV or JSON)'),
          h('div', { class: 'inline-fields' },
            h('button', { class: 'btn btn-small btn-secondary', type: 'button', disabled: running, onclick: pickData }, 'Select File'),
            config.data ? h('span', { class: 'muted' }, `${config.dataName} · ${config.data.length} rows`) : h('span', { class: 'faint' }, 'None'),
            config.data ? iconButton('x', 'Remove data file', () => { config.data = null; config.dataName = ''; App.save(); renderConfig(); }) : null),
          config.data ? h('div', { class: 'field-help' }, `Iterations follow the data file (${config.data.length}). Columns: ${Object.keys(config.data[0] || {}).join(', ')}`) : null),
        h('div', { class: 'field' }, UI.toggle('Stop run on error', config.stopOnError, (v) => { config.stopOnError = v; App.save(); })),
        h('div', { class: 'field' }, UI.toggle('Persist variable changes', config.persist, (v) => { config.persist = v; App.save(); })),
        h('div', { class: 'field-help', style: { marginBottom: '12px' } }, 'When on, values set by scripts (pm.environment.set, pm.globals.set) are kept after the run.'),
        running
          ? h('button', { class: 'btn btn-danger', type: 'button', onclick: stop }, icon('stop', 14), 'Stop Run')
          : h('button', { class: 'btn btn-primary', type: 'button', onclick: start }, icon('play', 14), tab.result ? 'Run Again' : `Run ${c.info.name}`));
    }

    // Results ----------------------------------------------------------------
    function renderResults() {
      clear(resultsEl);
      const r = tab.result;
      if (!r) { resultsEl.appendChild(UI.emptyState('runner', 'Run a collection', 'Choose the options on the left and click Run. Each request\'s status and test results appear here as the run progresses.')); return; }
      const done = r.items.filter((i) => i.status !== 'running').length;
      const passed = r.items.reduce((n, i) => n + i.assertions.filter((a) => a.passed).length, 0);
      const failed = r.items.reduce((n, i) => n + i.assertions.filter((a) => !a.passed && !a.skipped).length, 0);
      const errored = r.items.filter((i) => i.error || i.errors.length).length;
      const times = r.items.filter((i) => i.response && i.response.time != null).map((i) => i.response.time);
      const duration = (r.finishedAt || Date.now()) - r.startedAt;
      const stat = (label, value, cls) => h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, label), h('span', { class: `stat-value ${cls || ''}` }, value));
      resultsEl.append(
        h('div', { class: 'progress' }, h('div', { class: 'progress-bar', style: { width: `${r.total ? Math.min(100, (done / r.total) * 100) : 0}%` } })),
        h('div', { class: 'run-summary' },
          stat('Status', tab.running ? 'Running' : r.aborted ? 'Stopped' : r.error ? 'Error' : 'Finished', tab.running ? '' : (r.aborted || r.error || failed || errored) ? 'fail' : 'ok'),
          stat('Requests', `${done} / ${r.total}`),
          stat('Iterations', r.iterations),
          stat('Passed', passed, 'ok'),
          stat('Failed', failed, failed ? 'fail' : ''),
          stat('Errors', errored, errored ? 'fail' : ''),
          stat('Avg. time', times.length ? M.formatMs(times.reduce((a, b) => a + b, 0) / times.length) : '—'),
          stat('Duration', M.formatMs(duration)),
          h('span', { class: 'spacer' }),
          tab.running ? h('button', { class: 'btn btn-small btn-danger', type: 'button', onclick: stop }, 'Stop') : h('button', { class: 'btn btn-small btn-secondary', type: 'button', onclick: exportResults }, icon('download', 13), 'Export Results')));
      if (r.error) resultsEl.appendChild(h('div', { class: 'response-error' }, h('b', null, 'Run error'), r.error.message));
      r.errors.forEach((e) => resultsEl.appendChild(h('div', { class: 'response-error' }, e)));
      const list = h('div', { class: 'run-list' });
      let lastIteration = -1;
      r.items.forEach((it) => {
        if (r.iterations > 1 && it.iteration !== lastIteration) { list.appendChild(h('div', { class: 'iteration-head' }, `Iteration ${it.iteration + 1}`)); lastIteration = it.iteration; }
        const failedHere = it.assertions.filter((a) => !a.passed && !a.skipped).length;
        const passedHere = it.assertions.filter((a) => a.passed).length;
        const head = h('div', { class: 'run-item-head', onclick: () => { it.expanded = !it.expanded; renderResults(); } },
          h('span', { class: `chevron${it.expanded ? ' open' : ''}`, style: { display: 'inline-flex', transition: 'transform .1s', transform: it.expanded ? 'rotate(90deg)' : '' } }, icon('chevron', 12)),
          methodBadge(it.method, true),
          h('span', { class: 'run-item-name', title: it.url || '' }, it.name),
          it.status === 'running' ? h('span', { class: 'run-stat' }, 'Running…') : it.status === 'cancelled' ? h('span', { class: 'run-stat' }, 'Cancelled') : null,
          it.response ? h('span', { class: `run-stat ${statusClass(it.response.code)}` }, `${it.response.code} ${it.response.status || ''}`) : it.error ? h('span', { class: 'run-stat fail' }, 'ERROR') : null,
          it.response ? h('span', { class: 'run-stat' }, M.formatMs(it.response.time)) : null,
          it.assertions.length ? h('span', { class: `run-stat ${failedHere ? 'fail' : 'ok'}` }, `${passedHere}/${it.assertions.length} passed`) : null);
        const item = h('div', { class: 'run-item' }, head);
        if (it.expanded) {
          const body = h('div', { class: 'run-item-body' });
          if (it.error) body.appendChild(h('div', { class: 'test-row fail' }, h('span', { class: 'test-tag' }, 'ERROR'), h('div', { class: 'test-name' }, it.error.message)));
          it.errors.forEach((e) => body.appendChild(h('div', { class: 'test-row fail' }, h('span', { class: 'test-tag' }, 'SCRIPT'), h('div', { class: 'test-name' }, e))));
          it.assertions.forEach((a) => body.appendChild(h('div', { class: `test-row ${a.skipped ? 'skip' : a.passed ? 'pass' : 'fail'}` }, h('span', { class: 'test-tag' }, a.skipped ? 'SKIP' : a.passed ? 'PASS' : 'FAIL'), h('div', { class: 'test-name' }, a.name, a.error ? h('div', { class: 'test-error' }, a.error.message) : null))));
          if (!it.error && !it.errors.length && !it.assertions.length) body.appendChild(h('div', { class: 'muted' }, 'No tests in this request'));
          item.appendChild(body);
        }
        list.appendChild(item);
      });
      resultsEl.appendChild(list);
    }

    configEl = h('div', { class: 'runner-config' });
    resultsEl = h('div', { class: 'runner-results' });
    el.appendChild(h('div', { class: 'runner-layout' }, configEl, resultsEl));
    renderConfig();
    renderResults();

    return { el, update() { renderConfig(); renderResults(); } };
  }

  root.Views.runner = runnerView;
})(window);
