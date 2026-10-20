'use strict';

/**
 * Request execution engine. Wraps postman-runtime the same way Postman's
 * AgentWorker "runtime" provider does: build an sdk.Collection, hand it to a
 * long-lived Runner, and stream every lifecycle callback back to the caller as
 * a plain, structured-clone-safe `{ id, event, data }` message.
 */
const fs = require('fs');
const runtime = require('postman-runtime');
const sdk = require('postman-collection');
const { CookieJar } = require('@postman/tough-cookie');

const MAX_BODY_BYTES = 10 * 1024 * 1024;
const BINARY_CONTENT_TYPE = /^(image|audio|video|font)\/|application\/(octet-stream|pdf|zip|gzip|x-tar|wasm|x-7z-compressed)/i;

const runner = new runtime.Runner();
const runs = new Map();
let cookieJar = new CookieJar();

function serializeError(err) {
  if (!err) return null;
  return {
    name: err.name || 'Error',
    message: err.message || String(err),
    code: err.code || null
  };
}

function serializeCursor(cursor) {
  if (!cursor) return null;
  return {
    position: cursor.position,
    iteration: cursor.iteration,
    length: cursor.length,
    cycles: cursor.cycles,
    ref: cursor.ref
  };
}

function itemRef(item) {
  return item ? { id: item.id, name: item.name } : null;
}

function headerList(headers) {
  if (!headers || typeof headers.all !== 'function') return [];
  return headers.all().map((h) => ({ key: h.key, value: String(h.value), disabled: !!h.disabled }));
}

function toBuffer(stream) {
  if (!stream) return Buffer.alloc(0);
  if (Buffer.isBuffer(stream)) return stream;
  if (stream.type === 'Buffer' && Array.isArray(stream.data)) return Buffer.from(stream.data);
  return Buffer.from(stream);
}

function serializeResponse(response) {
  if (!response) return null;
  const contentType = response.headers.get('Content-Type') || '';
  const stream = toBuffer(response.stream);
  const binary = BINARY_CONTENT_TYPE.test(contentType);
  const truncated = stream.length > MAX_BODY_BYTES;
  const body = truncated ? stream.subarray(0, MAX_BODY_BYTES) : stream;
  const size = response.size();
  let timings = null;
  try {
    timings = response.timings ? sdk.Response.timingPhases(response.timings) : null;
  } catch (_) { /* timings are optional */ }

  return {
    code: response.code,
    status: response.status,
    responseTime: response.responseTime,
    contentType,
    headers: headerList(response.headers),
    size: { body: size.body, header: size.header, total: size.total },
    body: binary ? null : body.toString('utf8'),
    bodyBase64: binary ? body.toString('base64') : null,
    truncated,
    timings
  };
}

function serializeRequest(request) {
  if (!request) return null;
  let body = '';
  try {
    body = request.body && !request.body.isEmpty() ? request.body.toString() : '';
  } catch (_) { /* some body modes (file, formdata streams) do not stringify */ }
  return {
    method: request.method,
    url: request.url.toString(),
    headers: headerList(request.headers),
    body
  };
}

function serializeCookie(cookie) {
  const c = cookie && typeof cookie.toJSON === 'function' ? cookie.toJSON() : cookie;
  return {
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    expires: c.expires ? String(c.expires) : null,
    httpOnly: !!c.httpOnly,
    secure: !!c.secure
  };
}

function formatLogArg(arg) {
  if (typeof arg === 'string') return arg;
  if (arg === undefined) return 'undefined';
  if (typeof arg === 'function') return '[Function]';
  const seen = new WeakSet();
  try {
    return JSON.stringify(arg, (k, v) => {
      if (typeof v === 'object' && v !== null) {
        if (seen.has(v)) return '[Circular]';
        seen.add(v);
      }
      return typeof v === 'bigint' ? v.toString() : v;
    }, 2);
  } catch (_) {
    return String(arg);
  }
}

function plainData(value) {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return null;
  }
}

function scopeJSON(scope) {
  if (!scope) return null;
  const json = typeof scope.toJSON === 'function' ? scope.toJSON() : scope;
  return { values: (json.values || []).map((v) => ({ key: v.key, value: v.value, type: v.type, disabled: !!v.disabled })) };
}

/**
 * The editor treats `url.raw` as the source of truth (like the Postman UI),
 * but sdk.Url ignores `raw` when given an object. Re-derive the parts from
 * `raw` and keep path-variable values so `:id` segments resolve.
 */
function normalizeUrls(items) {
  (items || []).forEach((node) => {
    if (Array.isArray(node.item)) return normalizeUrls(node.item);
    const request = node.request;
    if (!request || !request.url || typeof request.url !== 'object' || typeof request.url.raw !== 'string') return;
    const parsed = sdk.Url.parse(request.url.raw);
    if (Array.isArray(request.url.variable)) parsed.variable = request.url.variable;
    request.url = parsed;
  });
}

/**
 * Execute a collection (or a single request wrapped in a collection).
 *
 * @param {Object} job
 * @param {String} job.id - caller-chosen execution id, echoed on every event
 * @param {Object} job.collection - Postman Collection v2.1 JSON
 * @param {Object} [job.environment] - VariableScope JSON ({ values: [...] })
 * @param {Object} [job.globals] - VariableScope JSON
 * @param {Object} [job.options] - { iterationCount, delay, requestTimeout, strictSSL, followRedirects, stopOnError }
 * @param {Function} emit - receives `{ id, event, data }`
 */
function execute(job, emit) {
  const { id, collection, environment, globals, options = {} } = job;
  let finished = false;
  // Once a run is finished (or aborted) late runtime callbacks are dropped.
  const send = (event, data) => { if (!finished) emit({ id, event, data }); };

  // Script results carry the updated scopes; keep the latest snapshot of each.
  const latest = { environment: scopeJSON(environment || { values: [] }), globals: scopeJSON(globals || { values: [] }) };
  const captureScopes = (results) => {
    (results || []).forEach((r) => {
      if (r && r.result && r.result.environment) latest.environment = scopeJSON(r.result.environment);
      if (r && r.result && r.result.globals) latest.globals = scopeJSON(r.result.globals);
    });
  };

  const timeout = {};
  if (options.requestTimeout > 0) timeout.request = options.requestTimeout;
  if (options.scriptTimeout > 0) timeout.script = options.scriptTimeout;

  const network = {};
  const proxy = options.proxy;
  if (proxy && proxy.enabled && proxy.host) {
    network.proxies = new sdk.ProxyConfigList({}, [{
      match: 'http+https://*/*',
      host: proxy.host,
      port: Number(proxy.port) || 8080,
      tunnel: true,
      authenticate: !!proxy.username,
      username: proxy.username || '',
      password: proxy.password || '',
      bypass: String(proxy.bypass || '').split(',').map((s) => s.trim()).filter(Boolean)
    }]);
  }
  const certs = (options.certificates || []).filter((c) => c && c.host && (c.certPath || c.pfxPath));
  if (certs.length) {
    network.certificates = new sdk.CertificateList({}, certs.map((c) => ({
      name: c.host,
      matches: [`https://${c.host}/*`],
      key: c.keyPath ? { src: c.keyPath } : undefined,
      cert: c.certPath ? { src: c.certPath } : undefined,
      pfx: c.pfxPath ? { src: c.pfxPath } : undefined,
      passphrase: c.passphrase || undefined
    })));
  }

  const finish = (err, aborted = false) => {
    if (finished) return;
    runs.delete(id);
    send('done', { error: serializeError(err), aborted, environment: latest.environment, globals: latest.globals });
    finished = true;
  };

  let sdkCollection;
  try {
    normalizeUrls(collection && collection.item);
    sdkCollection = new sdk.Collection(collection);
  } catch (err) {
    send('exception', { cursor: null, error: serializeError(err) });
    return finish(err);
  }

  runner.run(sdkCollection, {
    environment: new sdk.VariableScope(environment || {}),
    globals: new sdk.VariableScope(globals || {}),
    iterationCount: options.iterationCount > 0 ? options.iterationCount : 1,
    data: Array.isArray(options.data) ? options.data : undefined,
    delay: { item: options.delay > 0 ? options.delay : 0 },
    timeout,
    stopOnError: !!options.stopOnError,
    entrypoint: options.entrypoint && options.entrypoint.execute
      ? { execute: options.entrypoint.execute, lookupStrategy: 'idOrName' }
      : undefined,
    // Reads files referenced by form-data / binary bodies and certificates.
    fileResolver: fs,
    ...network,
    ignoreProxyEnvironmentVariables: !!options.ignoreProxyEnv,
    requester: {
      cookieJar,
      strictSSL: options.strictSSL !== false,
      followRedirects: options.followRedirects !== false,
      timings: true,
      extendedRootCA: options.caCertPath || undefined
    }
  }, (err, run) => {
    if (err) {
      send('exception', { cursor: null, error: serializeError(err) });
      return finish(err);
    }
    runs.set(id, { run, finish });

    run.start({
      start: (err, cursor) => send('start', { cursor: serializeCursor(cursor), error: serializeError(err) }),
      beforeItem: (err, cursor, item) => send('beforeItem', { cursor: serializeCursor(cursor), item: itemRef(item) }),
      item: (err, cursor, item, visualizer) => send('item', {
        cursor: serializeCursor(cursor),
        item: itemRef(item),
        error: serializeError(err),
        visualizer: visualizer ? {
          error: serializeError(visualizer.error),
          processedTemplate: typeof visualizer.processedTemplate === 'string' ? visualizer.processedTemplate : null,
          data: plainData(visualizer.data)
        } : null
      }),
      prerequest: (err, cursor, results, item) => {
        captureScopes(results);
        const errors = (results || []).filter((r) => r && r.error).map((r) => serializeError(r.error));
        send('script', { target: 'prerequest', cursor: serializeCursor(cursor), item: itemRef(item), errors });
      },
      test: (err, cursor, results, item) => {
        captureScopes(results);
        const errors = (results || []).filter((r) => r && r.error).map((r) => serializeError(r.error));
        send('script', { target: 'test', cursor: serializeCursor(cursor), item: itemRef(item), errors });
      },
      request: (err, cursor, response, request, item, cookies) => send('request', {
        cursor: serializeCursor(cursor),
        item: itemRef(item),
        error: serializeError(err),
        request: serializeRequest(request),
        response: serializeResponse(response),
        cookies: (cookies || []).map(serializeCookie)
      }),
      assertion: (cursor, assertions) => send('assertion', {
        cursor: serializeCursor(cursor),
        assertions: (assertions || []).map((a) => ({
          name: a.name,
          passed: !!a.passed,
          skipped: !!a.skipped,
          error: serializeError(a.error)
        }))
      }),
      console: (cursor, level, ...messages) => send('console', {
        cursor: serializeCursor(cursor),
        level,
        messages: messages.map(formatLogArg)
      }),
      exception: (cursor, err) => send('exception', { cursor: serializeCursor(cursor), error: serializeError(err) }),
      abort: () => finish(null, true),
      done: (err) => finish(err)
    });
  });
}

/**
 * Abort a run. The runtime only processes the abort after the in-flight
 * request settles, so the caller is told the run is done right away.
 */
function abort(id) {
  const entry = runs.get(id);
  if (!entry) return false;
  entry.run.abort();
  entry.finish(null, true);
  return true;
}

function clearCookies() {
  cookieJar = new CookieJar();
}

function loadCookies(serialized) {
  try {
    cookieJar = serialized ? CookieJar.deserializeSync(serialized) : new CookieJar();
  } catch (_) {
    cookieJar = new CookieJar();
  }
}

function serializeCookies() {
  return cookieJar.serializeSync();
}

function listCookies() {
  return new Promise((resolve, reject) => {
    cookieJar.store.getAllCookies((err, cookies) => (err ? reject(err) : resolve((cookies || []).map(serializeCookie))));
  });
}

function deleteCookie({ domain, path: cookiePath, name }) {
  return new Promise((resolve, reject) => {
    cookieJar.store.removeCookie(domain, cookiePath, name, (err) => (err ? reject(err) : resolve(true)));
  });
}

module.exports = { execute, abort, clearCookies, loadCookies, serializeCookies, listCookies, deleteCookie };
