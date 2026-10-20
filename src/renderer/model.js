/**
 * ApiForge data model: pure functions that convert between Postman
 * Collection v2.1 JSON (the storage / interchange format) and the editor's
 * request "draft", plus tree operations and importers.
 *
 * Loaded as a classic script in the renderer (window.ApiForgeModel) and as a
 * CommonJS module in tests.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(() => { try { return require('js-yaml'); } catch (_) { return null; } });
  } else root.ApiForgeModel = factory(() => root.jsyaml || null);
})(typeof self !== 'undefined' ? self : this, function (loadYaml) {
  'use strict';

  const SCHEMA_V21 = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json';
  const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
  const RAW_LANGUAGES = [
    ['text', 'Text'], ['json', 'JSON'], ['javascript', 'JavaScript'], ['html', 'HTML'], ['xml', 'XML']
  ];
  const RAW_CONTENT_TYPES = {
    text: 'text/plain', json: 'application/json', javascript: 'application/javascript', html: 'text/html', xml: 'application/xml'
  };

  function uid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
  const row = (key = '', value = '', enabled = true, extra = {}) => ({ key, value, enabled, ...extra });
  const isBlankRow = (r) => !r || (!String(r.key || '').trim() && !String(r.value == null ? '' : r.value).trim() && !r.src);
  const textOf = (d) => (d == null ? '' : typeof d === 'string' ? d : d.content || '');
  const execOf = (script) => {
    if (!script) return '';
    const exec = script.exec;
    return Array.isArray(exec) ? exec.join('\n') : String(exec || '');
  };

  // ---------------------------------------------------------------------------
  // Auth: one schema drives the editor and the v2.1 serialization for every
  // auth type postman-runtime implements.
  // ---------------------------------------------------------------------------
  const opt = (...pairs) => pairs.map((p) => (Array.isArray(p) ? p : [p, p]));
  const AUTH_TYPES = [
    { type: 'inherit', label: 'Inherit auth from parent', fields: [] },
    { type: 'noauth', label: 'No Auth', fields: [] },
    { type: 'basic', label: 'Basic Auth', fields: [
      { key: 'username', label: 'Username' },
      { key: 'password', label: 'Password', input: 'secret' }
    ] },
    { type: 'bearer', label: 'Bearer Token', fields: [
      { key: 'token', label: 'Token', input: 'secret' }
    ] },
    { type: 'apikey', label: 'API Key', fields: [
      { key: 'key', label: 'Key' },
      { key: 'value', label: 'Value', input: 'secret' },
      { key: 'in', label: 'Add to', input: 'select', options: opt(['header', 'Header'], ['query', 'Query Params']), default: 'header' }
    ] },
    { type: 'jwt', label: 'JWT Bearer', fields: [
      { key: 'addTokenTo', label: 'Add JWT token to', input: 'select', options: opt(['header', 'Request Header'], ['queryParam', 'Query Param']), default: 'header' },
      { key: 'algorithm', label: 'Algorithm', input: 'select', options: opt('HS256', 'HS384', 'HS512', 'RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512'), default: 'HS256' },
      { key: 'secret', label: 'Secret / private key', input: 'textarea' },
      { key: 'isSecretBase64Encoded', label: 'Secret Base64 encoded', input: 'bool', default: false },
      { key: 'payload', label: 'Payload (JSON)', input: 'textarea', default: '{}' },
      { key: 'headerPrefix', label: 'Request header prefix', default: 'Bearer' },
      { key: 'queryParamKey', label: 'Query param name', default: 'token' },
      { key: 'header', label: 'JWT headers (JSON)', input: 'textarea', default: '{}' }
    ] },
    { type: 'digest', label: 'Digest Auth', fields: [
      { key: 'username', label: 'Username' },
      { key: 'password', label: 'Password', input: 'secret' },
      { key: 'realm', label: 'Realm', advanced: true },
      { key: 'nonce', label: 'Nonce', advanced: true },
      { key: 'algorithm', label: 'Algorithm', input: 'select', options: opt('MD5', 'MD5-sess', 'SHA-256', 'SHA-256-sess', 'SHA-512-256', 'SHA-512-256-sess'), default: 'MD5', advanced: true },
      { key: 'qop', label: 'qop', advanced: true },
      { key: 'nonceCount', label: 'Nonce count', advanced: true },
      { key: 'clientNonce', label: 'Client nonce', advanced: true },
      { key: 'opaque', label: 'Opaque', advanced: true }
    ] },
    { type: 'oauth1', label: 'OAuth 1.0', fields: [
      { key: 'signatureMethod', label: 'Signature method', input: 'select', options: opt('HMAC-SHA1', 'HMAC-SHA256', 'HMAC-SHA512', 'RSA-SHA1', 'RSA-SHA256', 'RSA-SHA512', 'PLAINTEXT'), default: 'HMAC-SHA1' },
      { key: 'consumerKey', label: 'Consumer key' },
      { key: 'consumerSecret', label: 'Consumer secret', input: 'secret' },
      { key: 'token', label: 'Access token' },
      { key: 'tokenSecret', label: 'Token secret', input: 'secret' },
      { key: 'addParamsToHeader', label: 'Add params to header', input: 'bool', default: true },
      { key: 'addEmptyParamsToSign', label: 'Add empty params to signature', input: 'bool', default: false },
      { key: 'callback', label: 'Callback URL', advanced: true },
      { key: 'verifier', label: 'Verifier', advanced: true },
      { key: 'timestamp', label: 'Timestamp', advanced: true },
      { key: 'nonce', label: 'Nonce', advanced: true },
      { key: 'version', label: 'Version', default: '1.0', advanced: true },
      { key: 'realm', label: 'Realm', advanced: true }
    ] },
    { type: 'oauth2', label: 'OAuth 2.0', fields: [
      { key: 'accessToken', label: 'Access token', input: 'secret' },
      { key: 'addTokenTo', label: 'Add auth data to', input: 'select', options: opt(['header', 'Request Headers'], ['queryParams', 'Request URL']), default: 'header' },
      { key: 'headerPrefix', label: 'Header prefix', default: 'Bearer' },
      { key: 'grant_type', label: 'Grant type', input: 'select', options: opt(['client_credentials', 'Client Credentials'], ['password_credentials', 'Password Credentials']), default: 'client_credentials', section: 'token' },
      { key: 'accessTokenUrl', label: 'Access token URL', section: 'token' },
      { key: 'clientId', label: 'Client ID', section: 'token' },
      { key: 'clientSecret', label: 'Client secret', input: 'secret', section: 'token' },
      { key: 'username', label: 'Username', section: 'token', when: { grant_type: 'password_credentials' } },
      { key: 'password', label: 'Password', input: 'secret', section: 'token', when: { grant_type: 'password_credentials' } },
      { key: 'scope', label: 'Scope', section: 'token' },
      { key: 'client_authentication', label: 'Client authentication', input: 'select', options: opt(['header', 'Send as Basic Auth header'], ['body', 'Send client credentials in body']), default: 'header', section: 'token' }
    ] },
    { type: 'hawk', label: 'Hawk Authentication', fields: [
      { key: 'authId', label: 'Hawk Auth ID' },
      { key: 'authKey', label: 'Hawk Auth Key', input: 'secret' },
      { key: 'algorithm', label: 'Algorithm', input: 'select', options: opt('sha256', 'sha1'), default: 'sha256' },
      { key: 'user', label: 'User', advanced: true },
      { key: 'nonce', label: 'Nonce', advanced: true },
      { key: 'extraData', label: 'ext', advanced: true },
      { key: 'app', label: 'app', advanced: true },
      { key: 'delegation', label: 'dlg', advanced: true },
      { key: 'timestamp', label: 'Timestamp', advanced: true },
      { key: 'includePayloadHash', label: 'Include payload hash', input: 'bool', default: false, advanced: true }
    ] },
    { type: 'awsv4', label: 'AWS Signature', fields: [
      { key: 'accessKey', label: 'Access key' },
      { key: 'secretKey', label: 'Secret key', input: 'secret' },
      { key: 'region', label: 'AWS region', default: 'us-east-1' },
      { key: 'service', label: 'Service name' },
      { key: 'sessionToken', label: 'Session token', input: 'secret', advanced: true },
      { key: 'addAuthDataToQuery', label: 'Add auth data to query', input: 'bool', default: false, advanced: true }
    ] },
    { type: 'ntlm', label: 'NTLM Authentication', fields: [
      { key: 'username', label: 'Username' },
      { key: 'password', label: 'Password', input: 'secret' },
      { key: 'domain', label: 'Domain', advanced: true },
      { key: 'workstation', label: 'Workstation', advanced: true }
    ] },
    { type: 'edgegrid', label: 'Akamai EdgeGrid', fields: [
      { key: 'accessToken', label: 'Access token' },
      { key: 'clientToken', label: 'Client token' },
      { key: 'clientSecret', label: 'Client secret', input: 'secret' },
      { key: 'baseURL', label: 'Base URL', advanced: true },
      { key: 'nonce', label: 'Nonce', advanced: true },
      { key: 'timestamp', label: 'Timestamp', advanced: true },
      { key: 'headersToSign', label: 'Headers to sign', advanced: true }
    ] },
    { type: 'asap', label: 'ASAP (Atlassian)', fields: [
      { key: 'alg', label: 'Algorithm', input: 'select', options: opt('RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512'), default: 'RS256' },
      { key: 'iss', label: 'Issuer' },
      { key: 'aud', label: 'Audience' },
      { key: 'kid', label: 'Key ID' },
      { key: 'privateKey', label: 'Private key', input: 'textarea' },
      { key: 'sub', label: 'Subject', advanced: true },
      { key: 'exp', label: 'Expiry (seconds)', advanced: true },
      { key: 'claims', label: 'Additional claims (JSON)', input: 'textarea', advanced: true }
    ] }
  ];
  const AUTH_BY_TYPE = Object.fromEntries(AUTH_TYPES.map((a) => [a.type, a]));

  function authFromV2(auth) {
    if (!auth || !auth.type) return { type: 'inherit', params: {} };
    const params = {};
    const source = auth[auth.type];
    if (Array.isArray(source)) source.forEach((p) => { if (p && p.key) params[p.key] = p.value; });
    else if (source && typeof source === 'object') Object.assign(params, source); // v2.0 shape
    return { type: AUTH_BY_TYPE[auth.type] ? auth.type : 'noauth', params };
  }

  function authToV2(auth) {
    if (!auth || auth.type === 'inherit') return undefined;
    if (auth.type === 'noauth') return { type: 'noauth' };
    const schema = AUTH_BY_TYPE[auth.type];
    const params = { ...defaultAuthParams(auth.type), ...(auth.params || {}) };
    const keys = schema ? schema.fields.map((f) => f.key) : Object.keys(params);
    Object.keys(params).forEach((k) => { if (!keys.includes(k)) keys.push(k); });
    return {
      type: auth.type,
      [auth.type]: keys.filter((k) => params[k] !== undefined).map((k) => ({
        key: k,
        value: params[k],
        type: typeof params[k] === 'boolean' ? 'boolean' : 'string'
      }))
    };
  }

  function defaultAuthParams(type) {
    const schema = AUTH_BY_TYPE[type];
    const out = {};
    if (schema) schema.fields.forEach((f) => { if (f.default !== undefined) out[f.key] = f.default; });
    return out;
  }

  // ---------------------------------------------------------------------------
  // URL helpers. Raw URLs are the source of truth (as in the Postman UI); the
  // query string and path variables are projected into editable tables.
  // ---------------------------------------------------------------------------
  function splitUrl(raw) {
    const s = String(raw || '');
    const hashAt = s.indexOf('#');
    const beforeHash = hashAt >= 0 ? s.slice(0, hashAt) : s;
    const hash = hashAt >= 0 ? s.slice(hashAt) : '';
    const qAt = beforeHash.indexOf('?');
    return {
      base: qAt >= 0 ? beforeHash.slice(0, qAt) : beforeHash,
      query: qAt >= 0 ? beforeHash.slice(qAt + 1) : null,
      hash
    };
  }

  function parseQuery(query) {
    if (query == null || query === '') return [];
    return query.split('&').filter((part) => part !== '').map((part) => {
      const eq = part.indexOf('=');
      return eq >= 0 ? row(part.slice(0, eq), part.slice(eq + 1)) : row(part, null);
    });
  }

  function buildQuery(params) {
    return (params || [])
      .filter((p) => p.enabled !== false && !isBlankRow(p))
      .map((p) => (p.value === null || p.value === undefined ? p.key : `${p.key}=${p.value}`))
      .join('&');
  }

  function pathVariableNames(base) {
    const names = [];
    const re = /\/:([A-Za-z_][\w.-]*)/g;
    let m;
    while ((m = re.exec(base))) if (!names.includes(m[1])) names.push(m[1]);
    return names;
  }

  /** URL text changed: re-derive query params (keeping disabled ones) and path variables. */
  function syncFromUrl(draft) {
    const { base, query } = splitUrl(draft.url);
    const disabled = (draft.params || []).filter((p) => p.enabled === false);
    draft.params = parseQuery(query).concat(disabled);
    const prev = Object.fromEntries((draft.pathVars || []).map((v) => [v.key, v]));
    draft.pathVars = pathVariableNames(base).map((key) => prev[key] || { key, value: '', description: '' });
    return draft;
  }

  /** Params table changed: rebuild the query part of the URL. */
  function syncUrlFromParams(draft) {
    const { base, hash } = splitUrl(draft.url);
    const q = buildQuery(draft.params);
    draft.url = base + (q ? `?${q}` : '') + hash;
    return draft;
  }

  function urlParts(raw) {
    const m = String(raw || '').match(/^(?:([a-z][a-z0-9+.-]*):\/\/)?([^/?#]*)([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/i) || [];
    const out = { raw: String(raw || '') };
    if (m[1]) out.protocol = m[1];
    let hostPort = m[2] || '';
    const portMatch = hostPort.match(/:(\d+|\{\{[^}]+\}\})$/);
    if (portMatch) {
      out.port = portMatch[1];
      hostPort = hostPort.slice(0, -portMatch[0].length);
    }
    if (hostPort) out.host = /^\{\{.*\}\}$/.test(hostPort) ? [hostPort] : hostPort.split('.');
    if (m[3]) out.path = m[3].split('/').slice(1);
    if (m[5]) out.hash = m[5];
    return out;
  }

  function rawFromUrlObject(url) {
    if (!url) return '';
    if (typeof url === 'string') return url;
    if (url.raw) return url.raw;
    let s = '';
    if (url.protocol) s += `${url.protocol}://`;
    if (url.host) s += Array.isArray(url.host) ? url.host.join('.') : url.host;
    if (url.port) s += `:${url.port}`;
    if (url.path) s += `/${Array.isArray(url.path) ? url.path.map((p) => (typeof p === 'object' ? p.value : p)).join('/') : url.path}`;
    const q = (url.query || []).filter((p) => !p.disabled).map((p) => (p.value == null ? p.key : `${p.key}=${p.value}`)).join('&');
    if (q) s += `?${q}`;
    if (url.hash) s += `#${url.hash}`;
    return s;
  }

  // ---------------------------------------------------------------------------
  // Draft <-> v2.1 item
  // ---------------------------------------------------------------------------
  function emptyDraft(overrides) {
    return {
      name: 'Untitled Request',
      method: 'GET',
      url: '',
      params: [],
      pathVars: [],
      headers: [],
      body: { mode: 'none', raw: '', language: 'json', urlencoded: [], formdata: [], file: '', graphql: { query: '', variables: '' } },
      auth: { type: 'inherit', params: {} },
      scripts: { prerequest: '', test: '' },
      description: '',
      // Per-request overrides, stored as v2.1 `protocolProfileBehavior`.
      settings: {},
      ...(overrides || {})
    };
  }

  const PROTOCOL_SETTINGS = ['followRedirects', 'followOriginalHttpMethod', 'strictSSL', 'disableCookies', 'disableUrlEncoding', 'maxRedirects'];

  function parseHeaderString(text) {
    return String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
      const disabled = line.startsWith('//');
      const clean = disabled ? line.slice(2).trim() : line;
      const colon = clean.indexOf(':');
      return row(colon >= 0 ? clean.slice(0, colon).trim() : clean, colon >= 0 ? clean.slice(colon + 1).trim() : '', !disabled);
    });
  }

  const v2RowsToDraft = (rows) => (rows || []).map((r) => row(r.key || '', r.value == null ? '' : r.value, !r.disabled, r.description ? { description: textOf(r.description) } : {}));

  function draftFromItem(item) {
    const draft = emptyDraft({ name: (item && item.name) || 'Untitled Request' });
    const request = !item ? {} : typeof item.request === 'string' ? { url: item.request, method: 'GET' } : (item.request || {});
    draft.method = String(request.method || 'GET').toUpperCase();
    draft.description = textOf(request.description);

    const url = request.url;
    const raw = rawFromUrlObject(url);
    if (url && typeof url === 'object' && Array.isArray(url.query) && url.query.length) {
      const { base, hash } = splitUrl(raw);
      draft.params = url.query.map((q) => row(q.key || '', q.value === undefined ? null : q.value, !q.disabled, q.description ? { description: textOf(q.description) } : {}));
      const q = buildQuery(draft.params);
      draft.url = base + (q ? `?${q}` : '') + hash;
    } else {
      draft.url = raw;
      draft.params = parseQuery(splitUrl(raw).query);
    }
    const varValues = Object.fromEntries(((url && url.variable) || []).map((v) => [v.key, v]));
    draft.pathVars = pathVariableNames(splitUrl(draft.url).base).map((key) => ({
      key,
      value: varValues[key] ? String(varValues[key].value == null ? '' : varValues[key].value) : '',
      description: varValues[key] ? textOf(varValues[key].description) : ''
    }));

    draft.headers = typeof request.header === 'string' ? parseHeaderString(request.header) : v2RowsToDraft(request.header);

    const body = request.body;
    if (body && body.mode && !body.disabled) {
      draft.body.mode = body.mode;
      if (body.mode === 'raw') {
        draft.body.raw = typeof body.raw === 'string' ? body.raw : JSON.stringify(body.raw, null, 2);
        draft.body.language = (body.options && body.options.raw && body.options.raw.language) || guessLanguage(draft.body.raw, draft.headers);
      } else if (body.mode === 'urlencoded') {
        draft.body.urlencoded = v2RowsToDraft(body.urlencoded);
      } else if (body.mode === 'formdata') {
        draft.body.formdata = (body.formdata || []).map((f) => row(f.key || '', f.type === 'file' ? '' : (f.value == null ? '' : f.value), !f.disabled, {
          type: f.type === 'file' ? 'file' : 'text',
          src: f.type === 'file' ? (Array.isArray(f.src) ? f.src[0] : f.src) || '' : '',
          description: textOf(f.description)
        }));
      } else if (body.mode === 'file') {
        draft.body.file = (body.file && body.file.src) || '';
      } else if (body.mode === 'graphql') {
        draft.body.graphql = {
          query: (body.graphql && body.graphql.query) || '',
          variables: body.graphql && body.graphql.variables != null
            ? (typeof body.graphql.variables === 'string' ? body.graphql.variables : JSON.stringify(body.graphql.variables, null, 2))
            : ''
        };
      } else {
        draft.body.mode = 'none';
      }
    }

    draft.auth = authFromV2(request.auth);
    const behavior = (item && item.protocolProfileBehavior) || {};
    PROTOCOL_SETTINGS.forEach((k) => { if (behavior[k] !== undefined) draft.settings[k] = behavior[k]; });
    (item && item.event || []).forEach((ev) => {
      if (ev && (ev.listen === 'prerequest' || ev.listen === 'test') && !ev.disabled) draft.scripts[ev.listen] = execOf(ev.script);
    });
    return draft;
  }

  function guessLanguage(raw, headers) {
    const ct = ((headers || []).find((h) => /^content-type$/i.test(h.key)) || {}).value || '';
    if (/json/i.test(ct)) return 'json';
    if (/xml/i.test(ct)) return 'xml';
    if (/html/i.test(ct)) return 'html';
    if (/javascript/i.test(ct)) return 'javascript';
    const t = String(raw || '').trim();
    if (/^[{[]/.test(t)) { try { JSON.parse(t); return 'json'; } catch (_) { /* not json */ } }
    if (/^</.test(t)) return /<html/i.test(t) ? 'html' : 'xml';
    return 'text';
  }

  const draftRowsToV2 = (rows) => (rows || []).filter((r) => !isBlankRow(r)).map((r) => {
    const out = { key: r.key, value: r.value == null ? '' : r.value };
    if (r.enabled === false) out.disabled = true;
    if (r.description) out.description = r.description;
    return out;
  });

  function scriptEvent(listen, source, existing) {
    return {
      listen,
      script: {
        ...(existing && existing.script ? { id: existing.script.id } : {}),
        type: 'text/javascript',
        exec: String(source).split('\n')
      }
    };
  }

  function eventsFromScripts(scripts, existingEvents) {
    const existing = existingEvents || [];
    const keep = existing.filter((e) => e.listen !== 'prerequest' && e.listen !== 'test');
    const out = [...keep];
    ['prerequest', 'test'].forEach((listen) => {
      const src = scripts && scripts[listen];
      if (src && src.trim()) out.push(scriptEvent(listen, src, existing.find((e) => e.listen === listen)));
    });
    return out;
  }

  function scriptsFromEvents(events) {
    const scripts = { prerequest: '', test: '' };
    (events || []).forEach((ev) => {
      if (ev && (ev.listen === 'prerequest' || ev.listen === 'test')) scripts[ev.listen] = execOf(ev.script);
    });
    return scripts;
  }

  function urlObjectFromDraft(draft) {
    const { base, hash } = splitUrl(draft.url);
    const q = buildQuery(draft.params);
    const raw = base + (q ? `?${q}` : '') + hash;
    const url = urlParts(raw);
    const query = draftRowsToV2((draft.params || []).map((p) => ({ ...p, value: p.value === null ? null : p.value })));
    if (query.length) url.query = query.map((p) => (p.value === null ? { ...p, value: null } : p));
    if ((draft.pathVars || []).length) {
      url.variable = draft.pathVars.map((v) => ({ key: v.key, value: v.value || '', ...(v.description ? { description: v.description } : {}) }));
    }
    return url;
  }

  function bodyFromDraft(body) {
    if (!body || body.mode === 'none') return undefined;
    switch (body.mode) {
      case 'raw':
        return { mode: 'raw', raw: body.raw || '', options: { raw: { language: body.language || 'text' } } };
      case 'urlencoded':
        return { mode: 'urlencoded', urlencoded: draftRowsToV2(body.urlencoded) };
      case 'formdata':
        return {
          mode: 'formdata',
          formdata: (body.formdata || []).filter((r) => !isBlankRow(r)).map((r) => {
            const out = r.type === 'file' ? { key: r.key, type: 'file', src: r.src || '' } : { key: r.key, value: r.value == null ? '' : r.value, type: 'text' };
            if (r.enabled === false) out.disabled = true;
            if (r.description) out.description = r.description;
            return out;
          })
        };
      case 'file':
        return { mode: 'file', file: { src: body.file || '' } };
      case 'graphql':
        return { mode: 'graphql', graphql: { query: (body.graphql && body.graphql.query) || '', variables: (body.graphql && body.graphql.variables) || '' } };
      default:
        return undefined;
    }
  }

  /** Serialize a draft to a v2.1 request item, preserving unrelated fields of `base`. */
  function itemFromDraft(draft, base) {
    // A draft built programmatically may carry its query only in the URL text.
    if (!(draft.params || []).length && splitUrl(draft.url).query) draft = syncFromUrl({ ...draft, params: [], pathVars: clone(draft.pathVars || []) });
    const item = { ...(clone(base) || {}) };
    item.id = item.id || uid();
    item.name = draft.name || 'Untitled Request';
    const request = {
      method: draft.method || 'GET',
      header: draftRowsToV2(draft.headers),
      url: urlObjectFromDraft(draft)
    };
    const body = bodyFromDraft(draft.body);
    if (body) request.body = body;
    const auth = authToV2(draft.auth);
    if (auth) request.auth = auth;
    if (draft.description) request.description = draft.description;
    item.request = request;
    item.event = eventsFromScripts(draft.scripts, item.event);
    if (!item.event.length) delete item.event;
    const behavior = {};
    PROTOCOL_SETTINGS.forEach((k) => { if (draft.settings && draft.settings[k] !== undefined && draft.settings[k] !== '') behavior[k] = draft.settings[k]; });
    if (Object.keys(behavior).length) item.protocolProfileBehavior = behavior;
    else delete item.protocolProfileBehavior;
    if (!Array.isArray(item.response)) item.response = [];
    return item;
  }

  // ---------------------------------------------------------------------------
  // Collections and tree operations
  // ---------------------------------------------------------------------------
  const isFolder = (node) => !!node && Array.isArray(node.item);

  function newCollection(name) {
    return {
      info: { _postman_id: uid(), name: name || 'New Collection', schema: SCHEMA_V21, description: '' },
      item: [],
      variable: [],
      event: []
    };
  }

  function newFolder(name) {
    return { id: uid(), name: name || 'New Folder', item: [], description: '' };
  }

  function newRequestItem(name, draftOverrides) {
    return itemFromDraft(emptyDraft({ name: name || 'New Request', ...(draftOverrides || {}) }));
  }

  function walk(nodes, fn, ancestors) {
    const chain = ancestors || [];
    for (const node of nodes || []) {
      if (fn(node, chain) === false) return false;
      if (isFolder(node) && walk(node.item, fn, chain.concat(node)) === false) return false;
    }
    return true;
  }

  function ensureIds(collection) {
    collection.info = collection.info || {};
    collection.info._postman_id = collection.info._postman_id || uid();
    collection.info.schema = SCHEMA_V21;
    collection.item = collection.item || [];
    walk(collection.item, (node) => { if (!node.id) node.id = uid(); });
    return collection;
  }

  /** Locate a node by id: { node, ancestors, container, index }. */
  function findNode(collection, id) {
    let found = null;
    walk(collection.item, (node, ancestors) => {
      if (node.id === id) {
        const parent = ancestors[ancestors.length - 1];
        const container = parent ? parent.item : collection.item;
        found = { node, ancestors, container, index: container.indexOf(node) };
        return false;
      }
      return true;
    });
    return found;
  }

  function removeNode(collection, id) {
    const hit = findNode(collection, id);
    if (!hit) return null;
    hit.container.splice(hit.index, 1);
    return hit.node;
  }

  function insertNode(collection, parentId, node, index) {
    let container = collection.item;
    if (parentId) {
      const hit = findNode(collection, parentId);
      if (!hit || !isFolder(hit.node)) throw new Error('Target folder not found');
      container = hit.node.item;
    }
    if (index === undefined || index < 0 || index > container.length) container.push(node);
    else container.splice(index, 0, node);
    return node;
  }

  /** Move a node under a folder (or to the collection root when parentId is null). */
  function moveNode(collection, id, parentId, index) {
    if (id === parentId) return false;
    const hit = findNode(collection, id);
    if (!hit) return false;
    if (parentId && isFolder(hit.node) && findNode({ item: hit.node.item }, parentId)) return false; // into own descendant
    hit.container.splice(hit.index, 1);
    insertNode(collection, parentId, hit.node, index);
    return true;
  }

  function duplicateNode(node) {
    const copy = clone(node);
    copy.id = uid();
    copy.name = `${node.name} Copy`;
    walk(copy.item || [], (n) => { n.id = uid(); });
    (copy.response || []).forEach((r) => { r.id = uid(); });
    return copy;
  }

  function countRequests(nodes) {
    let n = 0;
    walk(nodes, (node) => { if (!isFolder(node)) n++; });
    return n;
  }

  /**
   * Wrap one request in a collection that keeps its ancestor chain, so
   * collection- and folder-level auth, scripts and variables apply exactly as
   * they do in Postman.
   */
  function buildRunCollection(collection, itemId, item) {
    const info = { name: 'ApiForge Run', schema: SCHEMA_V21 };
    if (!collection) return { info, item: [item] };
    const hit = itemId ? findNode(collection, itemId) : null;
    let nested = item;
    (hit ? hit.ancestors : []).slice().reverse().forEach((folder) => {
      const { item: _children, ...rest } = folder;
      nested = { ...clone(rest), item: [nested] };
    });
    return {
      info: { ...clone(collection.info), schema: SCHEMA_V21 },
      variable: clone(collection.variable || []),
      auth: clone(collection.auth),
      event: clone(collection.event || []),
      item: [nested]
    };
  }

  // ---------------------------------------------------------------------------
  // Environments / variable scopes
  // ---------------------------------------------------------------------------
  function newEnvironment(name) {
    return { id: uid(), name: name || 'New Environment', values: [] };
  }

  function scopeFromRows(values) {
    return {
      values: (values || []).filter((v) => v && String(v.key || '').trim()).map((v) => ({
        key: v.key,
        value: v.value == null ? '' : v.value,
        type: v.type === 'secret' ? 'secret' : 'any',
        disabled: v.enabled === false
      }))
    };
  }

  const displayValue = (v) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));

  /** Merge a scope returned by a run (after pm.environment.set/unset) back into editable rows. */
  function mergeScopeIntoRows(rows, scope) {
    if (!scope || !Array.isArray(scope.values)) return rows;
    const returned = new Map(scope.values.filter((v) => !v.disabled).map((v) => [v.key, v]));
    const out = [];
    (rows || []).forEach((r) => {
      if (!r.key) return;
      if (returned.has(r.key)) {
        out.push({ ...r, value: displayValue(returned.get(r.key).value) });
        returned.delete(r.key);
      } else if (r.enabled === false) {
        out.push(r); // disabled rows were never visible to scripts
      }
    });
    returned.forEach((v) => out.push(row(v.key, displayValue(v.value), true, { type: v.type === 'secret' ? 'secret' : 'default' })));
    return out;
  }

  /** Effective variable map (later scopes win), used for {{var}} highlighting. */
  function resolveVariables(scopes) {
    const map = new Map();
    (scopes || []).forEach(({ source, values }) => {
      (values || []).forEach((v) => {
        if (v && v.key && v.enabled !== false && !v.disabled) map.set(v.key, { value: displayValue(v.value), source, secret: v.type === 'secret' });
      });
    });
    return map;
  }

  function substitute(text, vars, depth) {
    if (typeof text !== 'string') return text;
    if ((depth || 0) > 5) return text;
    const out = text.replace(/\{\{([^{}]+)\}\}/g, (m, name) => (vars.has(name) ? vars.get(name).value : m));
    return out !== text && /\{\{[^{}]+\}\}/.test(out) ? substitute(out, vars, (depth || 0) + 1) : out;
  }

  // ---------------------------------------------------------------------------
  // Importers
  // ---------------------------------------------------------------------------
  function shellSplit(input) {
    const text = String(input).replace(/\\\r?\n/g, ' ').replace(/\^\r?\n/g, ' ');
    const tokens = [];
    let cur = '';
    let quote = null;
    let has = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quote) {
        if (c === quote) { quote = null; continue; }
        if (c === '\\' && quote === '"' && i + 1 < text.length && '"\\$`'.includes(text[i + 1])) { cur += text[++i]; continue; }
        cur += c;
        continue;
      }
      if (c === '$' && text[i + 1] === "'") { quote = "'"; i++; has = true; continue; }
      if (c === "'" || c === '"') { quote = c; has = true; continue; }
      if (c === '\\' && i + 1 < text.length) { cur += text[++i]; has = true; continue; }
      if (/\s/.test(c)) {
        if (has || cur) tokens.push(cur);
        cur = '';
        has = false;
        continue;
      }
      cur += c;
    }
    if (has || cur) tokens.push(cur);
    return tokens;
  }

  /** Parse a cURL command into a draft (null if it is not a curl command). */
  function parseCurl(command) {
    const tokens = shellSplit(String(command || '').trim());
    if (!tokens.length || !/^curl(\.exe)?$/i.test(tokens[0])) return null;
    const draft = emptyDraft({ name: 'Imported from cURL', auth: { type: 'noauth', params: {} } });
    const data = [];
    const form = [];
    let method = null;
    let url = null;
    let forceGet = false;
    let dataUrlencode = false;

    const valueFlags = new Set(['-X', '--request', '-H', '--header', '-d', '--data', '--data-raw', '--data-binary', '--data-ascii',
      '--data-urlencode', '-F', '--form', '--form-string', '-u', '--user', '-A', '--user-agent', '-b', '--cookie', '-e', '--referer', '--url',
      '-o', '--output', '-m', '--max-time', '--connect-timeout', '-x', '--proxy', '-w', '--write-out', '--cert', '--key', '--cacert', '-T', '--upload-file']);

    for (let i = 1; i < tokens.length; i++) {
      let t = tokens[i];
      let value;
      const eqMatch = t.match(/^(--[a-z-]+)=(.*)$/s);
      if (eqMatch && valueFlags.has(eqMatch[1])) { t = eqMatch[1]; value = eqMatch[2]; }
      const attached = t.match(/^(-[XHdFuAbe])(.+)$/s);
      if (attached) { t = attached[1]; value = attached[2]; }
      const take = () => (value !== undefined ? value : tokens[++i]);

      switch (t) {
        case '-X': case '--request': method = String(take()).toUpperCase(); break;
        case '-H': case '--header': {
          const h = String(take());
          const colon = h.indexOf(':');
          if (colon > 0) draft.headers.push(row(h.slice(0, colon).trim(), h.slice(colon + 1).trim()));
          break;
        }
        case '-d': case '--data': case '--data-raw': case '--data-binary': case '--data-ascii': data.push(String(take())); break;
        case '--data-urlencode': data.push(String(take())); dataUrlencode = true; break;
        case '-F': case '--form': case '--form-string': {
          const f = String(take());
          const eq = f.indexOf('=');
          const key = eq >= 0 ? f.slice(0, eq) : f;
          const val = eq >= 0 ? f.slice(eq + 1) : '';
          if (t !== '--form-string' && val.startsWith('@')) form.push(row(key, '', true, { type: 'file', src: val.slice(1).split(';')[0] }));
          else form.push(row(key, val, true, { type: 'text', src: '' }));
          break;
        }
        case '-u': case '--user': {
          const u = String(take());
          const colon = u.indexOf(':');
          draft.auth = { type: 'basic', params: { username: colon >= 0 ? u.slice(0, colon) : u, password: colon >= 0 ? u.slice(colon + 1) : '' } };
          break;
        }
        case '-A': case '--user-agent': draft.headers.push(row('User-Agent', String(take()))); break;
        case '-b': case '--cookie': draft.headers.push(row('Cookie', String(take()))); break;
        case '-e': case '--referer': draft.headers.push(row('Referer', String(take()))); break;
        case '--url': url = String(take()); break;
        case '-G': case '--get': forceGet = true; break;
        case '-I': case '--head': method = 'HEAD'; break;
        default:
          if (valueFlags.has(t)) take();
          else if (!t.startsWith('-') && url === null) url = t;
      }
    }

    draft.url = url || '';
    if (forceGet && data.length) {
      const { base, query, hash } = splitUrl(draft.url);
      draft.url = base + '?' + [query, data.join('&')].filter(Boolean).join('&') + hash;
    }
    syncFromUrl(draft);

    const contentType = ((draft.headers.find((h) => /^content-type$/i.test(h.key)) || {}).value || '').toLowerCase();
    if (form.length) {
      draft.body.mode = 'formdata';
      draft.body.formdata = form;
    } else if (data.length && !forceGet) {
      const joined = data.join('&');
      if (contentType.includes('application/x-www-form-urlencoded') || (!contentType && (dataUrlencode || /^[^=&\s{[<]+=[^&]*(&[^=&\s]+=[^&]*)*$/.test(joined)))) {
        draft.body.mode = 'urlencoded';
        draft.body.urlencoded = parseQuery(joined).map((r) => ({ ...r, value: r.value == null ? '' : r.value }));
      } else {
        draft.body.mode = 'raw';
        draft.body.raw = joined;
        draft.body.language = guessLanguage(joined, draft.headers);
      }
    }
    draft.method = method || (data.length && !forceGet ? 'POST' : form.length ? 'POST' : 'GET');
    return draft;
  }

  /** Postman Collection v1 (legacy) -> v2.1. */
  function convertV1(v1) {
    const collection = newCollection(v1.name);
    collection.info.description = v1.description || '';
    const byId = new Map((v1.requests || []).map((r) => [r.id, r]));
    const used = new Set();
    const toItem = (r) => {
      used.add(r.id);
      const draft = emptyDraft({ name: r.name || r.url, method: (r.method || 'GET').toUpperCase(), url: r.url || '', description: r.description || '' });
      syncFromUrl(draft);
      draft.headers = parseHeaderString(r.headers);
      if (r.dataMode === 'raw' || r.rawModeData) {
        draft.body.mode = 'raw';
        draft.body.raw = r.rawModeData || '';
        draft.body.language = guessLanguage(draft.body.raw, draft.headers);
      } else if ((r.dataMode === 'urlencoded' || r.dataMode === 'params') && Array.isArray(r.data)) {
        const target = r.dataMode === 'urlencoded' ? 'urlencoded' : 'formdata';
        draft.body.mode = target;
        draft.body[target] = r.data.map((d) => row(d.key, d.type === 'file' ? '' : d.value, d.enabled !== false, { type: d.type === 'file' ? 'file' : 'text', src: d.type === 'file' ? d.value : '' }));
      }
      if (r.preRequestScript) draft.scripts.prerequest = r.preRequestScript;
      if (r.tests) draft.scripts.test = r.tests;
      return itemFromDraft(draft);
    };
    (v1.folders || []).forEach((f) => {
      const folder = newFolder(f.name);
      folder.description = f.description || '';
      (f.order || []).forEach((id) => { if (byId.has(id)) folder.item.push(toItem(byId.get(id))); });
      collection.item.push(folder);
    });
    (v1.order || []).forEach((id) => { if (byId.has(id) && !used.has(id)) collection.item.push(toItem(byId.get(id))); });
    (v1.requests || []).forEach((r) => { if (!used.has(r.id)) collection.item.push(toItem(r)); });
    return collection;
  }

  /** OpenAPI 3.x / Swagger 2.0 (JSON) -> collection grouped by tag. */
  function convertOpenApi(spec) {
    const collection = newCollection((spec.info && spec.info.title) || 'Imported API');
    collection.info.description = (spec.info && spec.info.description) || '';
    let baseUrl = '';
    if (spec.servers && spec.servers[0]) baseUrl = spec.servers[0].url || '';
    else if (spec.host) baseUrl = `${(spec.schemes && spec.schemes[0]) || 'https'}://${spec.host}${spec.basePath || ''}`;
    collection.variable.push({ key: 'baseUrl', value: baseUrl.replace(/\/$/, ''), type: 'string' });

    const folders = new Map();
    const resolveRef = (obj) => {
      let cur = obj;
      for (let guard = 0; cur && cur.$ref && guard < 10; guard++) {
        cur = cur.$ref.replace(/^#\//, '').split('/').reduce((o, k) => (o ? o[k.replace(/~1/g, '/').replace(/~0/g, '~')] : undefined), spec);
      }
      return cur || {};
    };
    const example = (schema, depth) => {
      const s = resolveRef(schema);
      if ((depth || 0) > 6) return null;
      if (s.example !== undefined) return s.example;
      if (s.default !== undefined) return s.default;
      if (s.enum) return s.enum[0];
      if (s.allOf) return Object.assign({}, ...s.allOf.map((x) => example(x, (depth || 0) + 1) || {}));
      if (s.oneOf || s.anyOf) return example((s.oneOf || s.anyOf)[0], (depth || 0) + 1);
      switch (s.type) {
        case 'object': return Object.fromEntries(Object.entries(s.properties || {}).map(([k, v]) => [k, example(v, (depth || 0) + 1)]));
        case 'array': return [example(s.items || {}, (depth || 0) + 1)];
        case 'integer': case 'number': return 0;
        case 'boolean': return true;
        case 'string': return s.format === 'date-time' ? new Date(0).toISOString() : 'string';
        default: return s.properties ? example({ ...s, type: 'object' }, depth) : null;
      }
    };

    Object.entries(spec.paths || {}).forEach(([p, pathItem]) => {
      const shared = (pathItem && pathItem.parameters) || [];
      ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].forEach((m) => {
        const op = pathItem && pathItem[m];
        if (!op) return;
        const params = shared.concat(op.parameters || []).map(resolveRef);
        const draft = emptyDraft({
          name: op.summary || op.operationId || `${m.toUpperCase()} ${p}`,
          method: m.toUpperCase(),
          description: op.description || '',
          url: '{{baseUrl}}' + p.replace(/\{([^}]+)\}/g, ':$1')
        });
        const query = params.filter((x) => x.in === 'query').map((x) => row(x.name, x.example !== undefined ? String(x.example) : '', !!x.required, { description: x.description || '' }));
        draft.headers = params.filter((x) => x.in === 'header').map((x) => row(x.name, '', true, { description: x.description || '' }));
        syncFromUrl(draft);
        draft.params = query;
        syncUrlFromParams(draft);
        params.filter((x) => x.in === 'path').forEach((x) => {
          const v = draft.pathVars.find((pv) => pv.key === x.name);
          if (v) v.description = x.description || '';
        });
        const content = op.requestBody && resolveRef(op.requestBody).content;
        const bodyParam = params.find((x) => x.in === 'body');
        if (content && content['application/json']) {
          draft.body.mode = 'raw';
          draft.body.language = 'json';
          const media = content['application/json'];
          draft.body.raw = JSON.stringify(media.example !== undefined ? media.example : example(media.schema || {}), null, 2);
          draft.headers.push(row('Content-Type', 'application/json'));
        } else if (content && content['application/x-www-form-urlencoded']) {
          draft.body.mode = 'urlencoded';
          const props = resolveRef(content['application/x-www-form-urlencoded'].schema || {}).properties || {};
          draft.body.urlencoded = Object.keys(props).map((k) => row(k, ''));
        } else if (bodyParam) {
          draft.body.mode = 'raw';
          draft.body.language = 'json';
          draft.body.raw = JSON.stringify(example(bodyParam.schema || {}), null, 2);
        }
        const tag = (op.tags && op.tags[0]) || null;
        const item = itemFromDraft(draft);
        if (!tag) { collection.item.push(item); return; }
        if (!folders.has(tag)) {
          const folder = newFolder(tag);
          folders.set(tag, folder);
          collection.item.push(folder);
        }
        folders.get(tag).item.push(item);
      });
    });
    return collection;
  }

  function environmentFromImport(json) {
    const env = newEnvironment(json.name || 'Imported Environment');
    env.values = (json.values || []).map((v) => row(v.key, displayValue(v.value), v.enabled !== false, { type: v.type === 'secret' ? 'secret' : 'default' }));
    return env;
  }

  /**
   * Detect and convert anything the import dialog accepts.
   * Returns { kind: 'collection' | 'environment' | 'globals' | 'request', value }.
   */
  function importText(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) throw new Error('Nothing to import');
    if (/^curl(\.exe)?\s/i.test(trimmed)) {
      const draft = parseCurl(trimmed);
      if (!draft) throw new Error('Could not parse cURL command');
      return { kind: 'request', value: draft };
    }
    let json;
    try {
      json = JSON.parse(trimmed);
    } catch (_) {
      const yaml = loadYaml();
      if (yaml) {
        try { json = yaml.load(trimmed); } catch (err) { throw new Error(`Unsupported format: not valid JSON or YAML (${err.message.split('\n')[0]})`); }
      }
      if (!json || typeof json !== 'object') throw new Error('Unsupported format: expected Postman/OpenAPI JSON or YAML, or a cURL command');
    }
    if (json.collection && json.collection.info) json = json.collection; // Postman API export wrapper
    if (json.info && Array.isArray(json.item)) return { kind: 'collection', value: ensureIds(clone(json)) };
    if (Array.isArray(json.requests) && (json.order || json.folders || json.name)) return { kind: 'collection', value: ensureIds(convertV1(json)) };
    if (json.openapi || json.swagger) return { kind: 'collection', value: ensureIds(convertOpenApi(json)) };
    if (Array.isArray(json.values)) {
      return json._postman_variable_scope === 'globals'
        ? { kind: 'globals', value: environmentFromImport(json).values }
        : { kind: 'environment', value: environmentFromImport(json) };
    }
    throw new Error('Unrecognized JSON: not a Postman collection, environment or OpenAPI document');
  }

  function exportEnvironment(env, scope) {
    return {
      id: env.id,
      name: env.name,
      values: (env.values || []).filter((v) => v.key).map((v) => ({ key: v.key, value: v.value, type: v.type === 'secret' ? 'secret' : 'default', enabled: v.enabled !== false })),
      _postman_variable_scope: scope || 'environment',
      _postman_exported_using: 'ApiForge'
    };
  }

  /** RFC 4180-ish CSV parser for runner data files. */
  function parseCsv(text) {
    const rows = [];
    let cur = [''];
    let quoted = false;
    const s = String(text || '').replace(/^﻿/, '');
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (quoted) {
        if (c === '"' && s[i + 1] === '"') { cur[cur.length - 1] += '"'; i++; }
        else if (c === '"') quoted = false;
        else cur[cur.length - 1] += c;
      } else if (c === '"') quoted = true;
      else if (c === ',') cur.push('');
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && s[i + 1] === '\n') i++;
        rows.push(cur);
        cur = [''];
      } else cur[cur.length - 1] += c;
    }
    if (cur.length > 1 || cur[0] !== '') rows.push(cur);
    if (!rows.length) return [];
    const header = rows[0].map((h) => h.trim());
    return rows.slice(1).filter((r) => r.some((v) => v !== '')).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] === undefined ? '' : r[i]])));
  }

  function parseDataFile(name, content) {
    if (/\.json$/i.test(name) || /^\s*[[{]/.test(content)) {
      const data = JSON.parse(content);
      if (!Array.isArray(data)) throw new Error('JSON data file must contain an array of objects');
      return data;
    }
    return parseCsv(content);
  }

  // ---------------------------------------------------------------------------
  // Formatting helpers shared by the UI
  // ---------------------------------------------------------------------------
  function formatBytes(n) {
    if (n == null || isNaN(n)) return '—';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(2)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
  }

  function formatMs(n) {
    if (n == null || isNaN(n)) return '—';
    return n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(2)} s`;
  }

  function languageFromContentType(ct, body) {
    const c = String(ct || '').toLowerCase();
    if (c.includes('json')) return 'json';
    if (c.includes('html')) return 'html';
    if (c.includes('xml')) return 'xml';
    if (c.includes('javascript')) return 'javascript';
    if (c.includes('css')) return 'css';
    const t = String(body || '').trim();
    if (/^[{[]/.test(t)) { try { JSON.parse(t); return 'json'; } catch (_) { /* not json */ } }
    if (/^<!doctype html|^<html/i.test(t)) return 'html';
    if (/^<\?xml|^<[a-z]/i.test(t)) return 'xml';
    return 'text';
  }

  return {
    SCHEMA_V21, METHODS, RAW_LANGUAGES, RAW_CONTENT_TYPES, AUTH_TYPES, AUTH_BY_TYPE,
    uid, clone, row, isBlankRow,
    authFromV2, authToV2, defaultAuthParams,
    splitUrl, parseQuery, buildQuery, pathVariableNames, syncFromUrl, syncUrlFromParams, urlParts, rawFromUrlObject,
    emptyDraft, draftFromItem, itemFromDraft, guessLanguage, parseHeaderString, eventsFromScripts, scriptsFromEvents,
    isFolder, newCollection, newFolder, newRequestItem, walk, ensureIds, findNode, removeNode, insertNode, moveNode,
    duplicateNode, countRequests, buildRunCollection,
    newEnvironment, scopeFromRows, mergeScopeIntoRows, resolveVariables, substitute, displayValue,
    shellSplit, parseCurl, convertV1, convertOpenApi, environmentFromImport, importText, exportEnvironment,
    parseCsv, parseDataFile, formatBytes, formatMs, languageFromContentType
  };
});
