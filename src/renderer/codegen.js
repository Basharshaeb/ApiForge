/**
 * Code snippet generators (Postman's "Code" pane). Each generator receives a
 * normalized request: { method, url, headers: [{key, value}], body } where
 * body is { mode: 'raw' | 'urlencoded' | 'formdata' | 'file' | 'graphql', ... }.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./model'));
  else root.ApiForgeCodegen = factory(root.ApiForgeModel);
})(typeof self !== 'undefined' ? self : this, function (M) {
  'use strict';

  const enabled = (rows) => (rows || []).filter((r) => r.enabled !== false && !M.isBlankRow(r));
  const b64 = (s) => (typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(s))) : Buffer.from(s, 'utf8').toString('base64'));

  /** Draft -> normalized request with simple auth types applied as headers/query. */
  function normalize(draft, resolve) {
    const sub = resolve || ((s) => s);
    const headers = enabled(draft.headers).map((h) => ({ key: sub(h.key), value: sub(String(h.value == null ? '' : h.value)) }));
    let url = sub(draft.url);
    (draft.pathVars || []).forEach((v) => { if (v.value) url = url.replace(new RegExp(`/:${v.key}(?=/|\\?|#|$)`), `/${sub(v.value)}`); });
    const auth = draft.auth || {};
    const p = auth.params || {};
    const addQuery = (k, v) => { url += (url.includes('?') ? '&' : '?') + `${encodeURIComponent(k)}=${encodeURIComponent(v)}`; };
    if (auth.type === 'basic') headers.push({ key: 'Authorization', value: `Basic ${b64(`${sub(p.username || '')}:${sub(p.password || '')}`)}` });
    else if (auth.type === 'bearer') headers.push({ key: 'Authorization', value: `Bearer ${sub(p.token || '')}` });
    else if (auth.type === 'oauth2' && p.accessToken) {
      if (p.addTokenTo === 'queryParams') addQuery('access_token', sub(p.accessToken));
      else headers.push({ key: 'Authorization', value: `${p.headerPrefix == null ? 'Bearer' : p.headerPrefix} ${sub(p.accessToken)}`.trim() });
    } else if (auth.type === 'apikey' && p.key) {
      if (p.in === 'query') addQuery(sub(p.key), sub(p.value || ''));
      else headers.push({ key: sub(p.key), value: sub(p.value || '') });
    }

    const body = draft.body || { mode: 'none' };
    let out = null;
    const hasHeader = (name) => headers.some((h) => h.key.toLowerCase() === name.toLowerCase());
    if (body.mode === 'raw' && body.raw) {
      out = { mode: 'raw', raw: sub(body.raw) };
      if (!hasHeader('Content-Type') && M.RAW_CONTENT_TYPES[body.language] && body.language !== 'text') {
        headers.push({ key: 'Content-Type', value: M.RAW_CONTENT_TYPES[body.language] });
      }
    } else if (body.mode === 'urlencoded' && enabled(body.urlencoded).length) {
      out = { mode: 'urlencoded', fields: enabled(body.urlencoded).map((r) => ({ key: sub(r.key), value: sub(String(r.value || '')) })) };
      if (!hasHeader('Content-Type')) headers.push({ key: 'Content-Type', value: 'application/x-www-form-urlencoded' });
    } else if (body.mode === 'formdata' && enabled(body.formdata).length) {
      out = { mode: 'formdata', fields: enabled(body.formdata).map((r) => ({ key: sub(r.key), value: sub(String(r.value || '')), type: r.type, src: r.src })) };
    } else if (body.mode === 'file' && body.file) {
      out = { mode: 'file', src: body.file };
    } else if (body.mode === 'graphql' && body.graphql && body.graphql.query) {
      let variables = {};
      try { variables = body.graphql.variables ? JSON.parse(sub(body.graphql.variables)) : {}; } catch (_) { variables = {}; }
      out = { mode: 'raw', raw: JSON.stringify({ query: sub(body.graphql.query), variables }) };
      if (!hasHeader('Content-Type')) headers.push({ key: 'Content-Type', value: 'application/json' });
    }
    return { method: draft.method || 'GET', url, headers, body: out };
  }

  const sq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  const dq = (s) => JSON.stringify(String(s));
  const urlencode = (fields) => fields.map((f) => `${encodeURIComponent(f.key)}=${encodeURIComponent(f.value)}`).join('&');

  function curl(req) {
    const lines = [`curl --location --request ${req.method} ${sq(req.url)}`];
    req.headers.forEach((h) => lines.push(`--header ${sq(`${h.key}: ${h.value}`)}`));
    const b = req.body;
    if (b && b.mode === 'raw') lines.push(`--data-raw ${sq(b.raw)}`);
    if (b && b.mode === 'urlencoded') b.fields.forEach((f) => lines.push(`--data-urlencode ${sq(`${f.key}=${f.value}`)}`));
    if (b && b.mode === 'formdata') b.fields.forEach((f) => lines.push(`--form ${sq(f.type === 'file' ? `${f.key}=@"${f.src}"` : `${f.key}=${f.value}`)}`));
    if (b && b.mode === 'file') lines.push(`--data-binary ${sq(`@${b.src}`)}`);
    return lines.join(' \\\n');
  }

  function http(req) {
    let path = req.url;
    let host = '';
    const m = req.url.match(/^[a-z]+:\/\/([^/?#]+)(.*)$/i);
    if (m) { host = m[1]; path = m[2] || '/'; }
    const lines = [`${req.method} ${path} HTTP/1.1`];
    if (host) lines.push(`Host: ${host}`);
    req.headers.forEach((h) => lines.push(`${h.key}: ${h.value}`));
    const b = req.body;
    let body = '';
    if (b && b.mode === 'raw') body = b.raw;
    if (b && b.mode === 'urlencoded') body = urlencode(b.fields);
    if (b && b.mode === 'formdata') {
      lines.push('Content-Type: multipart/form-data; boundary=----ApiForgeBoundary');
      body = b.fields.map((f) => `------ApiForgeBoundary\r\nContent-Disposition: form-data; name="${f.key}"${f.type === 'file' ? `; filename="${String(f.src).split(/[\\/]/).pop()}"\r\nContent-Type: <Content-Type header here>\r\n\r\n(data)` : `\r\n\r\n${f.value}`}`).join('\r\n') + '\r\n------ApiForgeBoundary--';
    }
    if (b && b.mode === 'file') body = '"<file contents here>"';
    if (body) lines.push(`Content-Length: ${new TextEncoder().encode(body).length}`);
    return lines.join('\n') + '\n\n' + body;
  }

  function fetchJs(req) {
    const out = [];
    out.push('const myHeaders = new Headers();');
    req.headers.forEach((h) => out.push(`myHeaders.append(${dq(h.key)}, ${dq(h.value)});`));
    const b = req.body;
    let bodyVar = null;
    if (b && b.mode === 'raw') { out.push('', `const raw = ${dq(b.raw)};`); bodyVar = 'raw'; }
    if (b && b.mode === 'urlencoded') {
      out.push('', 'const urlencoded = new URLSearchParams();');
      b.fields.forEach((f) => out.push(`urlencoded.append(${dq(f.key)}, ${dq(f.value)});`));
      bodyVar = 'urlencoded';
    }
    if (b && b.mode === 'formdata') {
      out.push('', 'const formdata = new FormData();');
      b.fields.forEach((f) => out.push(f.type === 'file' ? `formdata.append(${dq(f.key)}, fileInput.files[0], ${dq(String(f.src).split(/[\\/]/).pop())});` : `formdata.append(${dq(f.key)}, ${dq(f.value)});`));
      bodyVar = 'formdata';
    }
    if (b && b.mode === 'file') { out.push('', 'const file = "<file contents here>";'); bodyVar = 'file'; }
    out.push('', 'const requestOptions = {', `  method: ${dq(req.method)},`, '  headers: myHeaders,');
    if (bodyVar) out.push(`  body: ${bodyVar},`);
    out.push('  redirect: "follow"', '};', '');
    out.push(`fetch(${dq(req.url)}, requestOptions)`, '  .then((response) => response.text())', '  .then((result) => console.log(result))', '  .catch((error) => console.error(error));');
    return out.join('\n');
  }

  function axios(req) {
    const out = ["const axios = require('axios');"];
    const b = req.body;
    if (b && b.mode === 'raw') out.push(`const data = ${dq(b.raw)};`);
    if (b && b.mode === 'urlencoded') {
      out.push("const qs = require('qs');", `const data = qs.stringify({`, ...b.fields.map((f) => `  ${dq(f.key)}: ${dq(f.value)},`), '});');
    }
    if (b && b.mode === 'formdata') {
      out.push("const FormData = require('form-data');", "const fs = require('fs');", 'const data = new FormData();');
      b.fields.forEach((f) => out.push(f.type === 'file' ? `data.append(${dq(f.key)}, fs.createReadStream(${dq(f.src)}));` : `data.append(${dq(f.key)}, ${dq(f.value)});`));
    }
    if (b && b.mode === 'file') out.push("const fs = require('fs');", `const data = fs.readFileSync(${dq(b.src)});`);
    out.push('', 'const config = {', `  method: ${dq(req.method.toLowerCase())},`, '  maxBodyLength: Infinity,', `  url: ${dq(req.url)},`);
    const headerLines = req.headers.map((h) => `    ${dq(h.key)}: ${dq(h.value)},`);
    if (b && b.mode === 'formdata') headerLines.push('    ...data.getHeaders()');
    if (headerLines.length) out.push('  headers: {', ...headerLines, '  },');
    if (b) out.push('  data: data');
    out.push('};', '', 'axios.request(config)', '  .then((response) => {', '    console.log(JSON.stringify(response.data));', '  })', '  .catch((error) => {', '    console.log(error);', '  });');
    return out.join('\n');
  }

  function python(req) {
    const out = ['import requests', ''];
    out.push(`url = ${dq(req.url)}`, '');
    const b = req.body;
    let payload = 'payload = {}';
    let files = null;
    if (b && b.mode === 'raw') payload = `payload = ${dq(b.raw)}`;
    if (b && b.mode === 'urlencoded') payload = `payload = ${dq(urlencode(b.fields))}`;
    if (b && b.mode === 'formdata') {
      const text = b.fields.filter((f) => f.type !== 'file');
      const file = b.fields.filter((f) => f.type === 'file');
      payload = `payload = {${text.map((f) => `${dq(f.key)}: ${dq(f.value)}`).join(', ')}}`;
      if (file.length) files = `files = [\n${file.map((f) => `  (${dq(f.key)}, (${dq(String(f.src).split(/[\\/]/).pop())}, open(${dq(f.src)}, 'rb')))`).join(',\n')}\n]`;
    }
    if (b && b.mode === 'file') payload = `payload = open(${dq(b.src)}, 'rb').read()`;
    out.push(payload);
    if (files) out.push(files);
    out.push('headers = {', ...req.headers.map((h) => `  ${dq(h.key)}: ${dq(h.value)},`), '}', '');
    out.push(`response = requests.request(${dq(req.method)}, url, headers=headers, data=payload${files ? ', files=files' : ''})`, '', 'print(response.text)');
    return out.join('\n');
  }

  function go(req) {
    const b = req.body;
    let bodyExpr = 'nil';
    const pre = [];
    const imports = ['"fmt"', '"net/http"', '"io"'];
    if (b && (b.mode === 'raw' || b.mode === 'urlencoded')) {
      imports.push('"strings"');
      pre.push(`  payload := strings.NewReader(${JSON.stringify(b.mode === 'raw' ? b.raw : urlencode(b.fields))})`);
      bodyExpr = 'payload';
    }
    const out = ['package main', '', 'import (', ...imports.map((i) => `  ${i}`), ')', '', 'func main() {', '', `  url := ${dq(req.url)}`, `  method := ${dq(req.method)}`, ''];
    out.push(...pre);
    out.push('  client := &http.Client{}', `  req, err := http.NewRequest(method, url, ${bodyExpr})`, '', '  if err != nil {', '    fmt.Println(err)', '    return', '  }');
    req.headers.forEach((h) => out.push(`  req.Header.Add(${dq(h.key)}, ${dq(h.value)})`));
    out.push('', '  res, err := client.Do(req)', '  if err != nil {', '    fmt.Println(err)', '    return', '  }', '  defer res.Body.Close()', '', '  body, err := io.ReadAll(res.Body)', '  if err != nil {', '    fmt.Println(err)', '    return', '  }', '  fmt.Println(string(body))', '}');
    return out.join('\n');
  }

  function powershell(req) {
    const out = ['$headers = New-Object "System.Collections.Generic.Dictionary[[String],[String]]"'];
    req.headers.forEach((h) => out.push(`$headers.Add(${sq(h.key)}, ${sq(h.value)})`));
    const b = req.body;
    let bodyArg = '';
    if (b && (b.mode === 'raw' || b.mode === 'urlencoded')) {
      out.push('', `$body = ${sq(b.mode === 'raw' ? b.raw : urlencode(b.fields))}`);
      bodyArg = ' -Body $body';
    }
    out.push('', `$response = Invoke-RestMethod ${sq(req.url)} -Method '${req.method}' -Headers $headers${bodyArg}`, '$response | ConvertTo-Json');
    return out.join('\n');
  }

  const LANGUAGES = [
    { id: 'curl', label: 'cURL', fn: curl, lang: 'shell' },
    { id: 'http', label: 'HTTP', fn: http, lang: 'http' },
    { id: 'fetch', label: 'JavaScript - Fetch', fn: fetchJs, lang: 'javascript' },
    { id: 'axios', label: 'NodeJs - Axios', fn: axios, lang: 'javascript' },
    { id: 'python', label: 'Python - Requests', fn: python, lang: 'python' },
    { id: 'go', label: 'Go - Native', fn: go, lang: 'go' },
    { id: 'powershell', label: 'PowerShell - RestMethod', fn: powershell, lang: 'powershell' }
  ];

  function generate(languageId, draft, resolve) {
    const lang = LANGUAGES.find((l) => l.id === languageId) || LANGUAGES[0];
    return lang.fn(normalize(draft, resolve));
  }

  return { LANGUAGES, normalize, generate };
});
