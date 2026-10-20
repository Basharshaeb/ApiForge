import { test, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as http from 'node:http';
import * as path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { AddressInfo } from 'node:net';
import type { Job, RunEvent } from '../src/shared/runtime-protocol';

let server: http.Server;
let base: string;
let worker: Worker;

before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const url = new URL(req.url || '/', 'http://localhost');
      if (url.pathname === '/slow') {
        const t = setTimeout(() => res.end('late'), 5000);
        req.on('close', () => clearTimeout(t));
        return;
      }
      if (url.pathname === '/set-cookie') {
        res.setHeader('Set-Cookie', 'session=abc123; Path=/');
        res.end('ok');
        return;
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ method: req.method, query: Object.fromEntries(url.searchParams), headers: req.headers, body }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  worker = new Worker(path.join(__dirname, '..', 'src', 'runtime', 'worker.js'));
  await new Promise((r) => worker.once('message', r)); // ready
});

after(async () => {
  await worker.terminate();
  server.close();
});

function run(job: Job, onEvent?: (msg: RunEvent) => void): Promise<RunEvent[]> {
  return new Promise((resolve) => {
    const events: RunEvent[] = [];
    const listener = (msg: RunEvent): void => {
      if (msg.id !== job.id) return;
      events.push(msg);
      if (onEvent) onEvent(msg);
      if (msg.event === 'done') {
        worker.off('message', listener);
        resolve(events);
      }
    };
    worker.on('message', listener);
    worker.postMessage({ action: 'execute', job });
  });
}

const find = <K extends RunEvent['event']>(events: RunEvent[], event: K) => events.filter((e): e is Extract<RunEvent, { event: K }> => e.event === event);
const collectionOf = (...items: object[]): Job['collection'] => ({ info: { _postman_id: 't', name: 'test', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, item: items as Job['collection']['item'] });

test('resolves variables, runs tests, captures console and environment updates', async () => {
  const events = await run({
    id: 'r1',
    collection: collectionOf({
      id: 'i1',
      name: 'echo',
      request: { method: 'GET', url: '{{base}}/echo?x=42' },
      event: [{ listen: 'test', script: { exec: [
        'pm.test("status is 200", () => pm.response.to.have.status(200));',
        'pm.test("deliberate failure", () => pm.expect(1).to.equal(2));',
        'console.log("got", pm.response.json().query);',
        'pm.environment.set("token", pm.response.json().query.x);'
      ] } }]
    }),
    environment: { values: [{ key: 'base', value: base }] }
  });

  const request = find(events, 'request')[0].data;
  assert.strictEqual(request.response?.code, 200);
  assert.strictEqual(request.request?.url, `${base}/echo?x=42`);
  assert.deepStrictEqual(JSON.parse(request.response?.body || '').query, { x: '42' });

  const assertions = find(events, 'assertion').flatMap((e) => e.data.assertions);
  assert.deepStrictEqual(assertions.map((a) => [a.name, a.passed]), [['status is 200', true], ['deliberate failure', false]]);

  const log = find(events, 'console')[0].data;
  assert.strictEqual(log.level, 'log');
  assert.deepStrictEqual(log.messages, ['got', JSON.stringify({ x: '42' }, null, 2)]);

  const done = find(events, 'done')[0].data;
  const token = done.environment?.values.find((v) => v.key === 'token');
  assert.strictEqual(token && token.value, '42');
});

test('raw JSON body is sent with application/json content type', async () => {
  const events = await run({
    id: 'r2',
    collection: collectionOf({ id: 'i2', name: 'post', request: { method: 'POST', url: `${base}/echo`, body: { mode: 'raw', raw: '{"a":1}', options: { raw: { language: 'json' } } } } })
  });
  const echoed = JSON.parse(find(events, 'request')[0].data.response?.body || '');
  assert.strictEqual(echoed.method, 'POST');
  assert.strictEqual(echoed.headers['content-type'], 'application/json');
  assert.strictEqual(echoed.body, '{"a":1}');
});

test('connection errors surface on the request event', async () => {
  const events = await run({ id: 'r3', collection: collectionOf({ id: 'i3', name: 'refused', request: { method: 'GET', url: 'http://127.0.0.1:1/nothing' } }) });
  const request = find(events, 'request')[0].data;
  assert.strictEqual(request.response, null);
  assert.strictEqual(request.error?.code, 'ECONNREFUSED');
  assert.ok(events.some((e) => e.event === 'done'));
});

test('cookies set by one response are sent on the next request', async () => {
  const events = await run({
    id: 'r4',
    collection: collectionOf(
      { id: 'i4a', name: 'set', request: { method: 'GET', url: `${base}/set-cookie` } },
      { id: 'i4b', name: 'echo', request: { method: 'GET', url: `${base}/echo` } }
    )
  });
  const requests = find(events, 'request');
  assert.ok(requests[0].data.cookies.some((c) => c.name === 'session' && c.value === 'abc123'));
  assert.strictEqual(JSON.parse(requests[1].data.response?.body || '').headers.cookie, 'session=abc123');
});

test('abort stops an in-flight run', async () => {
  const startedAt = Date.now();
  const events = await run({ id: 'r5', collection: collectionOf({ id: 'i5', name: 'slow', request: { method: 'GET', url: `${base}/slow` } }) }, (msg) => {
    if (msg.event === 'beforeItem') setTimeout(() => worker.postMessage({ action: 'abort', id: 'r5' }), 100);
  });
  assert.ok(Date.now() - startedAt < 4000, 'run should end well before the 5s server delay');
  assert.strictEqual(events[events.length - 1].event, 'done');
});
