import { test } from 'node:test';
import * as assert from 'node:assert';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as M from '../src/renderer/model';
import * as Codegen from '../src/renderer/codegen';
import { execute } from '../src/runtime/execute';
import type { RunEvent } from '../src/shared/runtime-protocol';
import type { CollectionJson, FolderJson, ItemJson } from '../src/shared/types';

const request = (events: RunEvent[]) => events.find((e): e is Extract<RunEvent, { event: 'request' }> => e.event === 'request');

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
  const req = item.request as Exclude<ItemJson['request'], string | undefined>;
  const url = req.url as Exclude<typeof req.url, string | undefined>;
  assert.strictEqual(url.raw, '{{baseUrl}}/users/:org?verbose=true');
  assert.deepStrictEqual(url.query, [{ key: 'verbose', value: 'true' }, { key: 'debug', value: '1', disabled: true }]);
  assert.deepStrictEqual(url.variable, [{ key: 'org', value: 'acme' }]);
  assert.deepStrictEqual(req.auth, { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}', type: 'string' }] });
  assert.deepStrictEqual(req.body?.options, { raw: { language: 'json' } });

  const back = M.draftFromItem(item);
  for (const key of ['name', 'method', 'url', 'headers', 'auth', 'scripts', 'description'] as const) {
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
  assert.ok(json);
  assert.strictEqual(json.method, 'POST');
  assert.strictEqual(json.url, 'https://api.test/items?x=1');
  assert.deepStrictEqual(json.params.map((p) => p.key), ['x']);
  assert.deepStrictEqual(json.headers.map((h) => h.key), ['Content-Type', 'Authorization']);
  assert.strictEqual(json.body.mode, 'raw');
  assert.strictEqual(json.body.language, 'json');
  assert.strictEqual(json.body.raw, '{"name":"its"}');

  const form = M.parseCurl('curl https://api.test/login -u alice:s3cret -d user=a -d pass=b');
  assert.ok(form);
  assert.strictEqual(form.method, 'POST');
  assert.deepStrictEqual(form.auth, { type: 'basic', params: { username: 'alice', password: 's3cret' } });
  assert.strictEqual(form.body.mode, 'urlencoded');
  assert.deepStrictEqual(form.body.urlencoded.map((r) => [r.key, r.value]), [['user', 'a'], ['pass', 'b']]);

  const multipart = M.parseCurl('curl --form file=@/tmp/a.png --form note=hi https://api.test/upload');
  assert.ok(multipart);
  assert.strictEqual(multipart.body.mode, 'formdata');
  assert.deepStrictEqual(multipart.body.formdata.map((r) => [r.key, r.type, r.src || r.value]), [['file', 'file', '/tmp/a.png'], ['note', 'text', 'hi']]);

  assert.strictEqual(M.parseCurl('wget https://x'), null);
});

test('importText detects collections, environments, globals, OpenAPI and v1', () => {
  const v21 = M.importText(JSON.stringify({ info: { name: 'C', schema: M.SCHEMA_V21 }, item: [{ name: 'r', request: { url: 'https://x' } }] }));
  assert.strictEqual(v21.kind, 'collection');
  if (v21.kind !== 'collection') throw new Error('unreachable');
  assert.ok(v21.value.info._postman_id);
  assert.ok(v21.value.item[0].id);

  const env = M.importText(JSON.stringify({ name: 'Dev', values: [{ key: 'a', value: '1', enabled: true }, { key: 's', value: 'x', type: 'secret', enabled: false }], _postman_variable_scope: 'environment' }));
  assert.strictEqual(env.kind, 'environment');
  if (env.kind !== 'environment') throw new Error('unreachable');
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
  if (oas.kind !== 'collection') throw new Error('unreachable');
  assert.strictEqual(oas.value.variable?.[0].value, 'https://pets.test/v1');
  const folder = oas.value.item[0] as FolderJson;
  assert.strictEqual(folder.name, 'pets');
  const get = folder.item[0] as ItemJson;
  const getRequest = get.request as Exclude<ItemJson['request'], string | undefined>;
  const getUrl = getRequest.url as Exclude<typeof getRequest.url, string | undefined>;
  assert.strictEqual(getUrl.raw, '{{baseUrl}}/pets/:petId');
  assert.deepStrictEqual(getUrl.query, [{ key: 'full', value: '', disabled: true }]);
  const post = folder.item[1] as ItemJson;
  assert.deepStrictEqual(JSON.parse(String((post.request as { body?: { raw?: unknown } }).body?.raw)), { name: 'Rex', age: 0 });

  const v1 = M.importText(JSON.stringify({ name: 'Old', order: ['1'], folders: [], requests: [{ id: '1', name: 'Ping', url: 'https://x/ping', method: 'GET', headers: 'Accept: text/plain\n' }] }));
  if (v1.kind !== 'collection') throw new Error('unreachable');
  const ping = v1.value.item[0] as ItemJson;
  assert.strictEqual(ping.name, 'Ping');
  assert.deepStrictEqual((ping.request as { header?: unknown }).header, [{ key: 'Accept', value: 'text/plain' }]);

  assert.throws(() => M.importText('not json'), /Unsupported format/);

  const yaml = M.importText('openapi: 3.0.0\ninfo:\n  title: Yaml API\npaths:\n  /ping:\n    get:\n      summary: Ping\n');
  if (yaml.kind !== 'collection') throw new Error('unreachable');
  assert.strictEqual(yaml.value.info.name, 'Yaml API');
  const yamlUrl = ((yaml.value.item[0] as ItemJson).request as { url: { raw: string } }).url;
  assert.strictEqual(yamlUrl.raw, '{{baseUrl}}/ping');
});

test('tree operations: insert, move (not into own descendant), duplicate, remove', () => {
  const c = M.newCollection('C');
  const folder = M.insertNode(c, null, M.newFolder('F'));
  const sub = M.insertNode(c, folder.id, M.newFolder('Sub'));
  const req = M.insertNode(c, null, M.newRequestItem('R'));
  assert.strictEqual(M.countRequests(c.item), 1);
  assert.ok(M.moveNode(c, req.id, sub.id));
  assert.deepStrictEqual(M.findNode(c, req.id)?.ancestors.map((a) => a.name), ['F', 'Sub']);
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
    { source: 'Globals', values: [{ key: 'host', value: 'global.test', enabled: true }, { key: 'v', value: '1', enabled: true }] },
    { source: 'Environment', values: [{ key: 'host', value: 'env.test', enabled: true }, { key: 'url', value: 'https://{{host}}', enabled: true }] }
  ]);
  assert.strictEqual(M.substitute('{{url}}/v{{v}}/{{missing}}', vars), 'https://env.test/v1/{{missing}}');
});

test('code generators emit auth and body', () => {
  const draft = M.emptyDraft({
    method: 'POST',
    url: 'https://api.test/users/:id',
    pathVars: [{ key: 'id', value: '7', description: '' }],
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
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const c: CollectionJson = M.newCollection('C');
    c.variable = [{ key: 'baseUrl', value: base }];
    const folder = M.insertNode(c, null, M.newFolder('Secured'));
    folder.auth = { type: 'bearer', bearer: [{ key: 'token', value: 'folder-token' }] };
    const draft = M.syncFromUrl(M.emptyDraft({ url: '{{baseUrl}}/users/:id?x=1' }));
    draft.pathVars[0].value = '99';
    const saved = M.insertNode(c, folder.id, M.itemFromDraft(draft));

    const runCollection = M.buildRunCollection(c, saved.id, M.itemFromDraft(draft, saved));
    const events = await new Promise<RunEvent[]>((resolve) => {
      const seen: RunEvent[] = [];
      execute({ id: 'm1', collection: runCollection }, (msg) => {
        seen.push(msg);
        if (msg.event === 'done') resolve(seen);
      });
    });
    const response = JSON.parse(request(events)?.data.response?.body || '');
    assert.deepStrictEqual(response, { url: '/users/99?x=1', auth: 'Bearer folder-token' });
  } finally {
    server.close();
  }
});
