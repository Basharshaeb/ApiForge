'use strict';

/**
 * End-to-end smoke test: boots the real Electron app against a throwaway data
 * directory, drives the renderer through window.App and checks the DOM.
 * Run with `npm run smoke`.
 */
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const electron = require('electron');
const root = path.join(__dirname, '..');

const scenario = (base) => `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms = 10000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timeout waiting'); await wait(50); } };
  const out = {};
  await until(() => window.App && App.state);
  out.shell = { topbar: !!document.querySelector('.topbar'), rail: document.querySelectorAll('.rail-btn').length, sidebar: !!document.querySelector('.sidebar-body') };

  // Collection + environment setup through the public App API.
  const c = await App.createCollection('Smoke');
  const env = ApiForgeModel.newEnvironment('Smoke Env');
  env.values.push(ApiForgeModel.row('base', ${JSON.stringify(base)}));
  App.state.environments.push(env);
  App.setActiveEnvironment(env.id);

  // Request tab: send, assert response rendered.
  const tab = App.newRequest({ url: '{{base}}/echo?x=1', method: 'POST', body: { ...ApiForgeModel.emptyDraft().body, mode: 'raw', raw: '{"a":1}', language: 'json' },
    scripts: { prerequest: '', test: 'pm.test("ok", () => pm.response.to.have.status(200)); pm.environment.set("fromScript", "yes"); console.log("hello from script");' } });
  App.sendRequest(tab);
  await until(() => !tab.running && (tab.response || tab.error));
  out.response = { code: tab.response && tab.response.code, error: tab.error && tab.error.message, tests: tab.tests.map((t) => [t.name, t.passed]) };
  out.echoed = tab.response ? JSON.parse(tab.response.body) : null;
  out.dom = { status: (document.querySelector('.status-pill') || {}).textContent, lines: document.querySelectorAll('pre.code .line').length, tabTitle: (document.querySelector('.tab.active .tab-title') || {}).textContent };
  out.envUpdated = env.values.some((v) => v.key === 'fromScript' && v.value === 'yes');
  out.consoleEntries = App.consoleEntries.map((e) => e.type);

  // Save into the collection, verify the tree shows it.
  App.saveRequestInto(tab, c.info._postman_id, null, 'Echo request');
  out.saved = { itemId: !!tab.itemId, dirty: App.isDirty(tab), treeRows: document.querySelectorAll('.tree-row.request').length };

  // Runner over the collection.
  const runner = App.openRunner(c.info._postman_id);
  await wait(100);
  document.querySelector('.runner-config .btn-primary').click();
  await until(() => runner.result && !runner.running, 15000);
  out.runner = { items: runner.result.items.length, passed: runner.result.items[0].assertions.filter((a) => a.passed).length, code: runner.result.items[0].response && runner.result.items[0].response.code };

  // WebSocket tab (connect fails fast against the http server, which is fine: exercise the plumbing).
  const ws = App.openWebSocket('${base.replace('http', 'ws')}/ws');
  document.querySelector('.url-bar .btn-primary').click();
  await until(() => ws.status === 'disconnected' && ws.messages.length > 0, 10000);
  out.ws = ws.messages.map((m) => m.kind);

  // Environment tab, collection editor, dialogs.
  App.openEnvironment(env.id);
  await wait(50);
  out.envTab = document.querySelectorAll('.kv-row:not(.kv-head):not(.ghost)').length;
  App.openCollectionEditor(c.info._postman_id, null);
  await wait(50);
  out.collectionTab = !!document.querySelector('.doc-view');
  App.showCode(tab.draft, c.info._postman_id);
  await wait(50);
  out.codeDialog = (document.querySelector('.code-modal pre') || {}).textContent.slice(0, 60);
  document.querySelector('.modal-footer .btn-primary').click();
  App.showImport();
  await wait(50);
  out.importDialog = !!document.querySelector('.import-area');
  document.querySelector('.modal-footer .btn-secondary').click();
  ${FINAL[view] || FINAL.request}
  await wait(200);
  await App.persist();
  return out;
`;

// Final UI state before the screenshot is taken (selected with `node test/smoke.js <view>`).
const FINAL = {
  request: 'App.activateTab(tab.id); App.toggleConsole(false);',
  console: 'App.activateTab(tab.id); App.toggleConsole(true);',
  runner: 'App.activateTab(runner.id); runner.result.items[0].expanded = true; App.updateTab(runner.id);',
  light: 'App.setTheme("light"); App.activateTab(tab.id); tab.subtab = "auth"; tab.draft.auth = { type: "oauth2", params: ApiForgeModel.defaultAuthParams("oauth2") }; App.updateTab(tab.id); App.views.get(tab.id).el.querySelector(".subtab:nth-child(2)").click();',
  ws: 'App.activateTab(ws.id);',
  about: 'App.activateTab(tab.id); await Views.dialogs.aboutDialog(); await wait(300);',
  environment: 'App.openEnvironment(env.id); App.selectSidebar("environments");',
  body: 'App.activateTab(tab.id); tab.subtab = "body"; App.views.get(tab.id).el.querySelectorAll(".subtab")[3].click(); tab.respTab = "tests"; App.updateTab(tab.id);'
};
const view = process.argv[2] || 'request';

async function main() {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ method: req.method, url: req.url, body }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apiforge-smoke-'));
  const scriptFile = path.join(dataDir, 'scenario.js');
  fs.writeFileSync(scriptFile, scenario(base));

  const shot = path.join(__dirname, `smoke-screenshot-${view}.png`);
  const child = spawn(electron, [root, '--no-sandbox'], {
    env: { ...process.env, APIFORGE_DATA_DIR: dataDir, APIFORGE_SMOKE: scriptFile, APIFORGE_SMOKE_SHOT: shot, ELECTRON_ENABLE_LOGGING: '' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  const timer = setTimeout(() => { child.kill(); }, 60000);
  const code = await new Promise((r) => child.on('exit', r));
  clearTimeout(timer);
  server.close();

  const events = stdout.split('\n').filter((l) => l.startsWith('SMOKE ')).map((l) => JSON.parse(l.slice(6)));
  const consoleErrors = events.filter((e) => e.console && e.console.level >= 2);
  const result = events.find((e) => e.result);
  const failure = events.find((e) => e.error || e.preloadError || e.renderGone);

  console.log(JSON.stringify({ exitCode: code, consoleErrors, failure, result: result && result.result }, null, 2));
  const dataFile = path.join(dataDir, 'apiforge-data.json');
  console.log('data file written:', fs.existsSync(dataFile), fs.existsSync(dataFile) ? `${fs.statSync(dataFile).size} bytes` : '');
  console.log('screenshot:', fs.existsSync(shot) ? shot : 'none');
  fs.rmSync(dataDir, { recursive: true, force: true });
  if (code !== 0 || failure || consoleErrors.length || !result) {
    if (!result) console.log(stderr.split('\n').filter((l) => !/gpu|dxgi|d3d|vulkan|skia|angle/i.test(l)).slice(-20).join('\n'));
    process.exit(1);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
