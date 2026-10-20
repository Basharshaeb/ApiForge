/**
 * End-to-end smoke test: boots the real Electron app (from dist/) against a
 * throwaway data directory, drives the renderer through the `ApiForge` debug
 * surface and checks the DOM. Run with `npm run smoke [view]`.
 */
import { spawn } from 'node:child_process';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';

const electron = require('electron') as unknown as string; // eslint-disable-line @typescript-eslint/no-require-imports -- the package's main export is the binary path
const ROOT = path.join(__dirname, '..', '..');

// Final UI state before the screenshot is taken (selected with `node dist/test/smoke.js <view>`).
const FINAL: Record<string, string> = {
  request: 'A.activateTab(tab.id); A.toggleConsole(false);',
  console: 'A.activateTab(tab.id); A.toggleConsole(true);',
  runner: 'A.activateTab(runner.id); runner.result.items[0].expanded = true; A.updateTab(runner.id);',
  light: 'A.setTheme("light"); A.activateTab(tab.id); tab.subtab = "auth"; tab.draft.auth = { type: "oauth2", params: Model.defaultAuthParams("oauth2") }; A.updateTab(tab.id); A.app.views.get(tab.id).el.querySelector(".subtab:nth-child(2)").click();',
  ws: 'A.activateTab(ws.id);',
  environment: 'A.openEnvironment(env.id); A.selectSidebar("environments");',
  body: 'A.activateTab(tab.id); tab.subtab = "body"; A.app.views.get(tab.id).el.querySelectorAll(".subtab")[3].click(); tab.respTab = "tests"; A.updateTab(tab.id);',
  about: 'A.activateTab(tab.id); await A.Views.dialogs.aboutDialog(); await wait(300);'
};
const view = process.argv[2] || 'request';

const scenario = (base: string): string => `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms = 10000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timeout waiting'); await wait(50); } };
  const out = {};
  await until(() => window.ApiForge && window.ApiForge.app.state);
  const A = window.ApiForge; const Model = A.Model;
  out.shell = { topbar: !!document.querySelector('.topbar'), rail: document.querySelectorAll('.rail-btn').length, sidebar: !!document.querySelector('.sidebar-body') };

  const c = await A.createCollection('Smoke');
  const env = Model.newEnvironment('Smoke Env');
  env.values.push(Model.row('base', ${JSON.stringify(base)}));
  A.app.state.environments.push(env);
  A.setActiveEnvironment(env.id);

  const tab = A.newRequest({ url: '{{base}}/echo?x=1', method: 'POST', body: { ...Model.emptyDraft().body, mode: 'raw', raw: '{"a":1}', language: 'json' },
    scripts: { prerequest: '', test: 'pm.test("ok", () => pm.response.to.have.status(200)); pm.environment.set("fromScript", "yes"); console.log("hello from script");' } });
  A.sendRequest(tab);
  await until(() => !tab.running && (tab.response || tab.error));
  out.response = { code: tab.response && tab.response.code, error: tab.error && tab.error.message, tests: tab.tests.map((t) => [t.name, t.passed]) };
  out.echoed = tab.response ? JSON.parse(tab.response.body) : null;
  out.dom = { status: (document.querySelector('.status-pill') || {}).textContent, lines: document.querySelectorAll('pre.code .line').length, tabTitle: (document.querySelector('.tab.active .tab-title') || {}).textContent };
  out.envUpdated = env.values.some((v) => v.key === 'fromScript' && v.value === 'yes');
  out.consoleEntries = A.app.consoleEntries.map((e) => e.type);

  A.saveRequestInto(tab, c.info._postman_id, null, 'Echo request');
  out.saved = { itemId: !!tab.itemId, dirty: A.isDirty(tab), treeRows: document.querySelectorAll('.tree-row.request').length };

  const runner = A.openRunner(c.info._postman_id);
  await wait(100);
  document.querySelector('.runner-config .btn-primary').click();
  await until(() => runner.result && !runner.running, 15000);
  out.runner = { items: runner.result.items.length, passed: runner.result.items[0].assertions.filter((a) => a.passed).length, code: runner.result.items[0].response && runner.result.items[0].response.code };

  const ws = A.openWebSocket('${base.replace('http', 'ws')}/ws');
  document.querySelector('.url-bar .btn-primary').click();
  await until(() => ws.status === 'disconnected' && ws.messages.length > 0, 10000);
  out.ws = ws.messages.map((m) => m.kind);

  A.openEnvironment(env.id);
  await wait(50);
  out.envTab = document.querySelectorAll('.kv-row:not(.kv-head):not(.ghost)').length;
  A.openCollectionEditor(c.info._postman_id, null);
  await wait(50);
  out.collectionTab = !!document.querySelector('.doc-view');
  A.showCode(tab.draft, c.info._postman_id);
  await wait(50);
  out.codeDialog = (document.querySelector('.code-modal pre') || {}).textContent.slice(0, 60);
  document.querySelector('.modal-footer .btn-primary').click();
  A.showImport();
  await wait(50);
  out.importDialog = !!document.querySelector('.import-area');
  document.querySelector('.modal-footer .btn-secondary').click();
  ${FINAL[view] || FINAL.request}
  await wait(200);
  await A.persist();
  return out;
`;

interface SmokeEvent { console?: { level: number }; result?: unknown; error?: string; preloadError?: string; renderGone?: unknown }

async function startEchoServer(): Promise<{ server: http.Server; base: string }> {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ method: req.method, url: req.url, body }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

function runElectron(dataDir: string, scriptFile: string, shot: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(electron, [ROOT, '--no-sandbox'], {
      env: { ...process.env, APIFORGE_DATA_DIR: dataDir, APIFORGE_SMOKE: scriptFile, APIFORGE_SMOKE_SHOT: shot, ELECTRON_ENABLE_LOGGING: '' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => child.kill(), 60000);
    child.on('exit', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

async function main(): Promise<void> {
  const { server, base } = await startEchoServer();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apiforge-smoke-'));
  const scriptFile = path.join(dataDir, 'scenario.js');
  fs.writeFileSync(scriptFile, scenario(base));
  const shot = path.join(ROOT, 'test', `smoke-screenshot-${view}.png`);

  const { code, stdout, stderr } = await runElectron(dataDir, scriptFile, shot);
  server.close();

  const events: SmokeEvent[] = stdout.split('\n').filter((l) => l.startsWith('SMOKE ')).map((l) => JSON.parse(l.slice(6)) as SmokeEvent);
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
