# ApiForge

<img src="assets/icon-128.png" width="96" align="right" alt="ApiForge icon">

**Author:** [Basharshaeb](https://github.com/Basharshaeb)

A local-first API client built the way the Postman desktop app is built: an
Electron shell that owns windows, persistence and OS integration, and a
separate runtime worker that executes requests and user scripts with
[`postman-runtime`](https://github.com/postmanlabs/postman-runtime).

```bash
npm install
npm start        # launch the app
npm test         # unit + integration tests (runtime engine, data model, importers, codegen)
npm run smoke    # boots the real app against a local server, drives the UI, saves a screenshot
```

## Architecture

The layout mirrors what Postman 12.x ships (observed by inspecting its
`app.asar`): the main process spawns a worker (`AgentWorker.js` in Postman) that
hosts `postman-runtime`, `postman-collection` and a cookie jar, and routes
events back to renderer windows over IPC. ApiForge keeps that split but swaps
Postman's remote-loaded UI for a local, sandboxed renderer.

```
src/
  main/
    main.js          Electron entry: window, menu, validated IPC handlers, dialogs
    preload.js       contextBridge API (window.apiforge) — the renderer's only privileged surface
    store.js         single JSON document in userData (debounced, atomic writes)
    runtime-host.js  owns the worker thread, routes run / socket events to the window that started them
  runtime/
    worker.js        worker_threads entry (like Postman's AgentWorker.js)
    execute.js       postman-runtime Runner wrapper: collection -> stream of {id, event, data}
    websocket.js     raw WebSocket sessions (ws)
  renderer/
    index.html       strict CSP; no Node access (contextIsolation + sandbox)
    model.js         Collection v2.1 <-> editor draft, tree ops, importers (Postman v1/v2.1, OpenAPI/Swagger JSON+YAML, cURL)
    codegen.js       cURL / HTTP / fetch / axios / Python / Go / PowerShell snippets
    ui.js            DOM component kit: variable-aware inputs, key/value tables, code views, editors, modals, menus
    app.js           state, tabs, persistence, send pipeline, shell layout, shortcuts
    views/           sidebar, request + response, websocket, environment, collection, runner, console, dialogs
    frame.html       sandboxed host for HTML previews and visualizer templates
test/
  execute.test.js    runtime engine against a local HTTP server (variables, scripts, cookies, abort, errors)
  model.test.js      model round-trips, importers, tree ops, codegen, end-to-end folder auth + path variables
  smoke.js           Electron end-to-end: creates data, sends, saves, runs the runner, opens dialogs, screenshots
```

Request execution: the editor draft is serialized to a Collection v2.1 item,
wrapped in a collection that preserves its folder chain (so collection/folder
auth, scripts and variables apply exactly as in Postman), and sent to the
worker. Every runtime callback (`request`, `assertion`, `console`, script
results, `done`) is streamed back and rendered live.

## Features

- Requests: methods, params with path variables, headers (with auto-generated
  header preview), bodies (raw with language + beautify, form-data with files,
  urlencoded, binary, GraphQL), per-request settings (`protocolProfileBehavior`)
- Authorization: inherit / none / Basic / Bearer / API key / JWT / Digest /
  OAuth 1.0 / OAuth 2.0 (with client-credentials & password token fetch) /
  Hawk / AWS v4 / NTLM / EdgeGrid / ASAP
- Scripts: pre-request and post-response with the full `pm.*` sandbox,
  snippets, `pm.test` results, `console.*` capture, `pm.visualizer`
- Variables: globals, collection, environment scopes with `{{var}}`
  highlighting, autocomplete, quick look, and script updates written back
- Collections: folders, drag & drop, duplicate, rename, examples (saved
  responses), collection/folder auth, scripts and variables, export
- Import: Postman collections (v1, v2.x), environments, globals, OpenAPI 3 /
  Swagger 2 (JSON or YAML), cURL (also by pasting into the URL bar)
- Runner: entire collection or a folder, iterations, delay, CSV/JSON data
  files, stop-on-error, persisted variables, live results, export
- Response viewer: pretty/raw/preview, syntax highlighting, wrap, copy, save
  to file, headers, cookies, test results, timings, visualizer
- WebSocket requests with headers, subprotocols and a message log
- Cookie jar persisted across sessions with a manager; history; console with
  network entries; code generation; light/dark themes; settings for SSL
  verification, redirects, timeouts, proxy, CA bundle and client certificates
- Tabs with unsaved-change tracking, restored on relaunch; keyboard shortcuts
  (`Ctrl+Enter` send, `Ctrl+S` save, `Ctrl+T` new, `Ctrl+W` close, `Ctrl+O`
  import, `Ctrl+Alt+C` console, `Ctrl+\` sidebar, `Ctrl+,` settings)

## Icon

`assets/icon.svg` is the source. `npm run icon` renders it with Electron's own
Chromium into PNGs (16–1024 px), a multi-size `icon.ico` (Windows) and
`icon.icns` (macOS); the window icon and the in-app brand mark use these files.

## Data

Everything lives in one file, `apiforge-data.json`, under Electron's `userData`
directory (shown in Settings and About). Set `APIFORGE_DATA_DIR` to use a
different directory.

## Security notes

The renderer runs with `contextIsolation`, `sandbox: true`, no Node
integration and a strict CSP; it only talks to the main process through the
small `window.apiforge` bridge, and every IPC handler verifies the sender frame
is the bundled UI. Response previews and visualizer output render inside an
opaque-origin sandboxed iframe (`frame.html`).
