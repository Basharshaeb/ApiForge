# ApiForge

<img src="assets/icon-128.png" width="96" align="right" alt="ApiForge icon">

**Author:** [Basharshaeb](https://github.com/Basharshaeb)

A local-first API client built the way the Postman desktop app is built: an
Electron shell that owns windows, persistence and OS integration, and a
separate runtime worker that executes requests and user scripts with
[`postman-runtime`](https://github.com/postmanlabs/postman-runtime).

```bash
npm install
npm start        # build, then launch the app
npm run build    # tsc (main, worker, model, tests) + esbuild (renderer bundle) -> dist/
npm run check    # whole-project type check (no emit)
npm test         # unit + integration tests (runtime engine, data model, importers, codegen)
npm run smoke    # boots the real app against a local server, drives the UI, saves a screenshot
npm run lint     # ESLint + typescript-eslint: recommended rules + complexity / size limits
```

Written in TypeScript (strict). `tsconfig.build.json` emits CommonJS to `dist/`
for everything that runs under Node (main process, preload, worker, the data
model and the tests); `scripts/build.ts` bundles the renderer UI from
`src/renderer/boot.ts` into a single classic script with esbuild so the strict
CSP keeps working without a module loader.

## Architecture

The layout mirrors what Postman 12.x ships (observed by inspecting its
`app.asar`): the main process spawns a worker (`AgentWorker.js` in Postman) that
hosts `postman-runtime`, `postman-collection` and a cookie jar, and routes
events back to renderer windows over IPC. ApiForge keeps that split but swaps
Postman's remote-loaded UI for a local, sandboxed renderer.

```
src/
  shared/                    contracts shared by every process
    types.ts                 Collection v2.1 JSON, editor draft, tabs, settings, persisted state
    runtime-protocol.ts      worker <-> main messages and the typed run event stream
    bridge.ts                the window.apiforge preload API (and its global declaration)
  main/                      Electron main process
    main.ts                  boot + lifecycle only
    paths.ts                 file locations and constants
    window.ts                BrowserWindow with hardened webPreferences
    menu.ts                  application menu -> renderer commands
    ipc.ts                   sender-validated ipcMain handlers
    smoke.ts                 test hook used by test/smoke.ts
    preload.ts               contextBridge API (window.apiforge) — the renderer's only privileged surface
    store.ts                 single JSON document in userData (debounced, atomic writes)
    runtime-host.ts          owns the worker thread, routes run / socket events to the window that started them
  runtime/                   worker thread (like Postman's AgentWorker.js)
    worker.ts                message dispatch
    execute.ts               postman-runtime Runner lifecycle -> stream of {id, event, data}
    run-options.ts           job options -> Runner options (timeouts, proxy, certificates, entrypoint)
    serialize.ts             runtime objects -> plain data for the renderer
    cookies.ts               the shared, persisted cookie jar
    websocket.ts             raw WebSocket sessions (ws)
    vendor.d.ts              minimal typings for postman-runtime and @postman/tough-cookie
  renderer/                  sandboxed UI, ES modules bundled by esbuild into dist/src/renderer/app.js
    boot.ts                  entry point: load state, build the shell, wire bridge events
    index.html               strict CSP; loads the single bundle
    model/                   pure data model (also compiled to CommonJS for the tests)
      util, constants, auth, url, draft, tree, scopes, format, importers
    codegen.ts               cURL / HTTP / fetch / axios / Python / Go / PowerShell snippets
    ui/                      DOM component kit
      dom, icons, overlays, inputs, kv-editor, code, controls
    app/                     application core
      state, lookups, persistence, tabs, runtime, collections, environments, shell, commands
    views/                   one folder or file per screen; index.ts maps a tab to its view
      sidebar/  request/  runner/  dialogs/  websocket.ts  environment.ts  collection.ts  console.ts
    frame.html               sandboxed host for HTML previews and visualizer templates
scripts/
  build.ts                   esbuild bundle + static copy (run by npm run build after tsc)
  build-icon.ts              renders assets/icon.svg into PNG / ICO / ICNS
test/
  execute.test.ts            runtime engine against a local HTTP server (variables, scripts, cookies, abort, errors)
  model.test.ts              model round-trips, importers, tree ops, codegen, end-to-end folder auth + path variables
  smoke.ts                   Electron end-to-end: creates data, sends, saves, runs the runner, opens dialogs, screenshots
```

Module conventions: strict TypeScript, ES module imports everywhere, one
concern per file, functions short and single-purpose. `npm run check` type
checks the whole project and `npm run lint` enforces style (ESLint +
typescript-eslint recommended, plus complexity, nesting, parameter and
function-length limits).

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
