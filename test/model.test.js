'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const M = require('../src/renderer/model');
const Codegen = require('../src/renderer/codegen');
const engine = require('../src/runtime/execute');

test('URL edits project into params and path variables, keeping disabled params', () => {
  const draft = M.emptyDraft({ url: 'https://api.test/users/:id/posts/:postId?page=2&q' });
  M.syncFromUrl(draft);
  assert.deepStrictEqual(draft.params.map((p) => [p.key, p.value, p.enabled]), [['page', '2', true], ['q', null, true]]);
  assert.deepStrictEqual(draft.pathVars.map((v) => v.key), ['id', 'postId']);

  draft.params[0].enabled = false;
  M.syncUrlFromParams(draft);
  assert.strictEqual(draft.url, 'https://api.test/users/:id/posts/:postId?q');

  draft.url = 'https://api.test/users/:id?limit=5';
  M.syncFromUrl(draft);
  assert.deepStrictEqual(draft.params.map((p) => [p.key, p.enabled]), [['limit', true], ['page', false]]);
  assert.deepStrictEqual(draft.pathVars.map((v) => v.key), ['id']);
});

test('ports and {{vars}} are not mistaken for path variables', () => {
  assert.deepStrictEqual(M.pathVariableNames('http://localhost:3000/a/:b'), ['b']);
  assert.deepStrictEqual(M.pathVariableNames('{{baseUrl}}/x'), []);
});

test('draft -> v2.1 item -> draft round trip preserves every editor field', () => {
  const draft = M.emptyDraft({
    name: 'Create user',
    method: 'POST',
    url: '{{baseUrl}}/users/:org?verbose=true',
    headers: [M.row('X-Trace', '1'), M.row('X-Off', 'no', false)],
    auth: { type: 'bearer', params: { token: '{{token}}' } },
    scripts: { prerequest: 'console.log(1)', test: 'pm.test("ok", () => {})\n// second line' },
    description: 'Creates a user'
  });
  M.syncFromUrl(draft);
  draft.params.push(M.row('debug', '1', false));
  draft.pathVars[0].value = 'acme';
  draft.body = { ...draft.body, mode: 'raw', raw: '{"a":1}', language: 'json' };

  const item = M.itemFromDraft(draft);
  assert.strictEqual(item.request.url.raw, '{{baseUrl}}/users/:org?verbose=true');
  assert.deepStrictEqual(item.request.url.query, [{ key: 'verbose', value: 'true' }, { key: 'debug', value: '1', disabled: true }]);
  assert.deepStrictEqual(item.request.url.variable, [{ key: 'org', value: 'acme' }]);
  assert.deepStrictEqual(item.request.auth, { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}', type: 'string' }] });
  assert.deepStrictEqual(item.request.body.options, { raw: { language: 'json' } });

  const back = M.draftFromItem(item);
  for (const key of ['name', 'method', 'url', 'headers', 'auth', 'scripts', 'description']) {
    assert.deepStrictEqual(back[key], draft[key], key);
  }
  assert.deepStrictEqual(back.params, draft.params);
  assert.deepStrictEqual(back.pathVars, [{ key: 'org', value: 'acme', description: '' }]);
  assert.strictEqual(back.body.raw, '{"a":1}');
});

test('cURL import covers headers, auth, JSON and urlencoded bodies', () => {
  const json = M.parseCurl(`curl -X POST 'https://api.test/items?x=1' \\
    -H 'Content-Type: application/json' -H "Authorization: Bearer abc" \\
    --data-raw '{"name":"it''s"}'`);
  assert.strictEqual(json.method, 'POST');
  assert.strictEqual(json.url, 'https://api.test/items?x=1');
  assert.deepStrictEqual(json.params.map((p) => p.key), ['x']);
  assert.deepStrictEqual(json.headers.map((h) => h.key), ['Content-Type', 'Authorization']);
  assert.strictEqual(json.body.mode, 'raw');
  assert.strictEqual(json.body.language, 'json');
  assert.strictEqual(json.body.raw, '{"name":"its"}');

  const form = M.parseCurl('curl https://api.test/login -u alice:s3cret -d user=a -d pass=b');
  assert.strictEqual(form.method, 'POST');
  assert.deepStrictEqual(form.auth, { type: 'basic', params: { username: 'alice', password: 's3cret' } });
  assert.strictEqual(form.body.mode, 'urlencoded');
  assert.deepStrictEqual(form.body.urlencoded.map((r) => [r.key, r.value]), [['user', 'a'], ['pass', 'b']]);

  const multipart = M.parseCurl('curl --form file=@/tmp/a.png --form note=hi https://api.test/upload');
  assert.strictEqual(multipart.body.mode, 'formdata');
  assert.deepStrictEqual(multipart.body.formdata.map((r) => [r.key, r.type, r.src || r.value]), [['file', 'file', '/tmp/a.png'], ['note', 'text', 'hi']]);

  assert.strictEqual(M.parseCurl('wget https://x'), null);
});

test('importText detects collections, environments, globals, OpenAPI and v1', () => {
  const v21 = M.importText(JSON.stringify({ info: { name: 'C', schema: M.SCHEMA_V21 }, item: [{ name: 'r', request: { url: 'https://x' } }] }));
  assert.strictEqual(v21.kind, 'collection');
  assert.ok(v21.value.info._postman_id);
  assert.ok(v21.value.item[0].id);

  const env = M.importText(JSON.stringify({ name: 'Dev', values: [{ key: 'a', value: '1', enabled: true }, { key: 's', value: 'x', type: 'secret', enabled: false }], _postman_variable_scope: 'environment' }));
  assert.strictEqual(env.kind, 'environment');
  assert.deepStrictEqual(env.value.values.map((v) => [v.key, v.enabled, v.type]), [['a', true, 'default'], ['s', false, 'secret']]);

  assert.strictEqual(M.importText(JSON.stringify({ name: 'g', values: [], _postman_variable_scope: 'globals' })).kind, 'globals');

  const oas = M.importText(JSON.stringify({
    openapi: '3.0.0',
    info: { title: 'Pets' },
    servers: [{ url: 'https://pets.test/v1/' }],
    paths: {
      '/pets/{petId}': {
        get: { tags: ['pets'], summary: 'Get pet', parameters: [{ name: 'petId', in: 'path', required: true }, { name: 'full', in: 'query' }] },
        post: { tags: ['pets'], summary: 'Update pet', requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } } } }
      }
    },
    components: { schemas: { Pet: { type: 'object', properties: { name: { type: 'string', example: 'Rex' }, age: { type: 'integer' } } } } }
  }));
  assert.strictEqual(oas.value.variable[0].value, 'https://pets.test/v1');
  const folder = oas.value.item[0];
  assert.strictEqual(folder.name, 'pets');
  assert.strictEqual(folder.item[0].request.url.raw, '{{baseUrl}}/pets/:petId');
  assert.deepStrictEqual(folder.item[0].request.url.query, [{ key: 'full', value: '', disabled: true }]);
  assert.deepStrictEqual(JSON.parse(folder.item[1].request.body.raw), { name: 'Rex', age: 0 });

  const v1 = M.importText(JSON.stringify({ name: 'Old', order: ['1'], folders: [], requests: [{ id: '1', name: 'Ping', url: 'https://x/ping', method: 'GET', headers: 'Accept: text/plain\n' }] }));
  assert.strictEqual(v1.value.item[0].name, 'Ping');
  assert.deepStrictEqual(v1.value.item[0].request.header, [{ key: 'Accept', value: 'text/plain' }]);

  assert.throws(() => M.importText('not json'), /Unsupported format/);

  const yaml = M.importText('openapi: 3.0.0\ninfo:\n  title: Yaml API\npaths:\n  /ping:\n    get:\n      summary: Ping\n');
  assert.strictEqual(yaml.value.info.name, 'Yaml API');
  assert.strictEqual(yaml.value.item[0].request.url.raw, '{{baseUrl}}/ping');
});

test('tree operations: insert, move (not into own descendant), duplicate, remove', () => {
  const c = M.newCollection('C');
  const folder = M.insertNode(c, null, M.newFolder('F'));
  const sub = M.insertNode(c, folder.id, M.newFolder('Sub'));
  const req = M.insertNode(c, null, M.newRequestItem('R'));
  assert.strictEqual(M.countRequests(c.item), 1);
  assert.ok(M.moveNode(c, req.id, sub.id));
  assert.deepStrictEqual(M.findNode(c, req.id).ancestors.map((a) => a.name), ['F', 'Sub']);
  assert.strictEqual(M.moveNode(c, folder.id, sub.id), false);
  const copy = M.duplicateNode(folder);
  assert.notStrictEqual(copy.item[0].id, sub.id);
  assert.strictEqual(copy.name, 'F Copy');
  M.removeNode(c, sub.id);
  assert.strictEqual(M.countRequests(c.item), 0);
});

test('mergeScopeIntoRows applies set/unset from scripts and keeps disabled rows', () => {
  const rows = [M.row('a', '1'), M.row('b', '2'), M.row('off', 'x', false)];
  const merged = M.mergeScopeIntoRows(rows, { values: [{ key: 'a', value: 10 }, { key: 'c', value: { z: 1 } }] });
  assert.deepStrictEqual(merged.map((r) => [r.key, r.value, r.enabled]), [['a', '10', true], ['off', 'x', false], ['c', '{"z":1}', true]]);
});

test('CSV data files parse quoted fields', () => {
  assert.deepStrictEqual(M.parseCsv('name,note\r\n"Smith, J","said ""hi"""\nDoe,\n'), [
    { name: 'Smith, J', note: 'said "hi"' },
    { name: 'Doe', note: '' }
  ]);
});

test('variable resolution follows scope precedence and nesting', () => {
  const vars = M.resolveVariables([
    { source: 'Globals', values: [{ key: 'host', value: 'global.test' }, { key: 'v', value: '1' }] },
    { source: 'Environment', values: [{ key: 'host', value: 'env.test' }, { key: 'url', value: 'https://{{host}}' }] }
  ]);
  assert.strictEqual(M.substitute('{{url}}/v{{v}}/{{missing}}', vars), 'https://env.test/v1/{{missing}}');
});

test('code generators emit auth and body', () => {
  const draft = M.emptyDraft({
    method: 'POST',
    url: 'https://api.test/users/:id',
    pathVars: [{ key: 'id', value: '7' }],
    auth: { type: 'basic', params: { username: 'u', password: 'p' } },
    body: { ...M.emptyDraft().body, mode: 'raw', raw: '{"a":1}', language: 'json' }
  });
  const curl = Codegen.generate('curl', draft);
  assert.match(curl, /curl --location --request POST 'https:\/\/api\.test\/users\/7'/);
  assert.match(curl, /--header 'Authorization: Basic dTpw'/);
  assert.match(curl, /--header 'Content-Type: application\/json'/);
  assert.match(curl, /--data-raw '\{"a":1\}'/);
  for (const lang of Codegen.LANGUAGES) assert.ok(Codegen.generate(lang.id, draft).length > 20, lang.id);
});

test('saved request runs with folder auth inheritance and path variables', async () => {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ url: req.url, auth: req.headers.authorization || null }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const c = M.newCollection('C');
    c.variable = [{ key: 'baseUrl', value: base }];
    const folder = M.insertNode(c, null, M.newFolder('Secured'));
    folder.auth = { type: 'bearer', bearer: [{ key: 'token', value: 'folder-token' }] };
    const draft = M.syncFromUrl(M.emptyDraft({ url: '{{baseUrl}}/users/:id?x=1' }));
    draft.pathVars[0].value = '99';
    const saved = M.insertNode(c, folder.id, M.itemFromDraft(draft));

    const runCollection = M.buildRunCollection(c, saved.id, M.itemFromDraft(draft, saved));
    const events = await new Promise((resolve) => {
      const seen = [];
      engine.execute({ id: 'm1', collection: runCollection }, (msg) => {
        seen.push(msg);
        if (msg.event === 'done') resolve(seen);
      });
    });
    const response = JSON.parse(events.find((e) => e.event === 'request').data.response.body);
    assert.deepStrictEqual(response, { url: '/users/99?x=1', auth: 'Bearer folder-token' });
  } finally {
    server.close();
  }
});
