# ApiForge

<img src="assets/icon-128.png" width="96" align="right" alt="ApiForge icon">

**Author:** [Basharshaeb](https://github.com/Basharshaeb)

ApiForge is a free, local-first API client for Windows, macOS and Linux. It
works like the Postman desktop app: send HTTP requests, write pre-request and
test scripts, organise requests into collections, switch environments, run
whole collections, manage cookies and talk to WebSocket servers. Everything is
stored on your own machine in one JSON file. No account, no cloud.

## Requirements

- **Node.js 20 or newer** (Node 22 LTS recommended). Download it from
  <https://nodejs.org> and install with the default options. `npm` comes with
  it.
- **Git** (only if you want to clone instead of downloading the ZIP):
  <https://git-scm.com/downloads>
- About 600 MB of free disk space (Electron and its dependencies).

Check that both tools are available by opening a terminal (Command Prompt,
PowerShell or Terminal) and running:

```bash
node --version
```

```bash
npm --version
```

## Download

Pick one of the two options.

**Option A: download the ZIP (no Git needed)**

1. Open <https://github.com/Basharshaeb/ApiForge>.
2. Click the green **Code** button, then **Download ZIP**.
3. Extract the ZIP. You get a folder named `ApiForge-main`. Rename it to
   `ApiForge` if you like.

**Option B: clone with Git**

```bash
git clone https://github.com/Basharshaeb/ApiForge.git
```

## Install

Open a terminal inside the downloaded folder and install the dependencies.
This downloads Electron and the Postman runtime (takes a minute or two the
first time).

```bash
cd ApiForge
```

```bash
npm install
```

## Run

```bash
npm start
```

The first start compiles the TypeScript sources and bundles the UI, then the
ApiForge window opens. Use the same command every time you want to launch the
app.

### Platform notes

- **Windows:** if PowerShell refuses to run `npm` ("running scripts is
  disabled on this system"), run `npm.cmd install` and `npm.cmd start`
  instead, or use Command Prompt.
- **macOS:** the first launch may ask for permission to accept incoming
  network connections. Allow it so the WebSocket and local test features work.
- **Linux:** make sure the usual Electron runtime libraries are present
  (`libgtk-3`, `libnss3`, `libasound2`). Most desktop distributions already
  have them.

## Update

**ZIP users:** download a new ZIP, extract it over the old folder (or into a
new one) and run `npm install` again. Your data is not inside the app folder,
so nothing is lost.

**Git users:**

```bash
git pull
```

```bash
npm install
```

## Where your data is stored

All collections, environments, history, cookies and settings live in one file,
`apiforge-data.json`, inside your user profile:

| Platform | Location |
|---|---|
| Windows | `%APPDATA%\ApiForge\apiforge-data.json` |
| macOS | `~/Library/Application Support/ApiForge/apiforge-data.json` |
| Linux | `~/.config/ApiForge/apiforge-data.json` |

The exact path is shown in **Settings** and in **Help > About**. To keep the
data somewhere else (for example a synced folder), set the environment
variable `APIFORGE_DATA_DIR` to that directory before starting the app. Back
up by copying that one file.

## Uninstall

Delete the ApiForge folder. If you also want to remove your saved data, delete
the data file listed above.

## Features

- Requests: all methods, query params with path variables, headers, bodies
  (raw with language highlighting and beautify, form-data with files,
  urlencoded, binary, GraphQL), per-request settings
- Authorization: inherit / none / Basic / Bearer / API key / JWT / Digest /
  OAuth 1.0 / OAuth 2.0 (client-credentials and password token fetch) / Hawk /
  AWS v4 / NTLM / EdgeGrid / ASAP
- Scripts: pre-request and post-response with the full `pm.*` sandbox,
  snippets, `pm.test` results, `console.*` capture, `pm.visualizer`
- Variables: globals, collection and environment scopes with `{{var}}`
  highlighting, autocomplete, quick look, and script updates written back
- Collections: folders, drag and drop, duplicate, rename, examples (saved
  responses), collection/folder auth, scripts and variables, export
- Import: Postman collections (v1, v2.x), environments, globals, OpenAPI 3 /
  Swagger 2 (JSON or YAML), cURL (also by pasting into the URL bar)
- Runner: entire collection or a folder, iterations, delay, CSV/JSON data
  files, stop-on-error, persisted variables, live results, export
- Response viewer: pretty/raw/preview, syntax highlighting, wrap, copy, save
  to file, headers, cookies, test results, timings, visualizer
- WebSocket requests with headers, subprotocols and a message log
- Cookie jar persisted across sessions with a manager; history; console with
  network entries; code generation (cURL, HTTP, fetch, axios, Python, Go,
  PowerShell); light and dark themes; settings for SSL verification,
  redirects, timeouts, proxy, CA bundle and client certificates
- Tabs with unsaved-change tracking, restored on relaunch

Keyboard shortcuts: `Ctrl+Enter` send, `Ctrl+S` save, `Ctrl+T` new request,
`Ctrl+W` close tab, `Ctrl+Tab` next tab, `Ctrl+O` import, `Ctrl+Alt+C`
console, `Ctrl+\` sidebar, `Ctrl+,` settings (use `Cmd` on macOS).

## For developers

Written in strict TypeScript. The Electron main process, preload, runtime
worker, data model and tests are compiled with `tsc` into `dist/`; the
renderer UI is bundled from `src/renderer/boot.ts` into one classic script
with esbuild so the strict Content Security Policy keeps working.

```bash
npm run build    # tsc + esbuild -> dist/
npm run check    # whole-project type check
npm test         # unit + integration tests (runtime engine, model, importers, codegen)
npm run smoke    # boots the real app against a local server, drives the UI, saves a screenshot
npm run lint     # ESLint + typescript-eslint with complexity / size limits
npm run icon     # re-render assets/icon.svg into PNG / ICO / ICNS
```

Project layout:

```
src/shared/     types shared by every process (Collection v2.1 JSON, drafts, tabs, worker protocol, preload bridge)
src/main/       Electron main process: window, menu, IPC, JSON store, worker host
src/runtime/    worker thread hosting postman-runtime, cookie jar and WebSocket sessions
src/renderer/   sandboxed UI: data model, component kit, app core, views, dialogs
scripts/        build (esbuild bundle) and icon rendering
test/           runtime tests, model tests and the Electron smoke test
```

The layout mirrors the Postman desktop app (main process plus a runtime
worker, observed by inspecting Postman's `app.asar`), with Postman's
remote-loaded UI replaced by a local, sandboxed renderer. The renderer runs
with `contextIsolation`, `sandbox: true`, no Node integration and a strict
CSP; it only talks to the main process through the small `window.apiforge`
bridge, and every IPC handler verifies the sender frame. Response previews and
visualizer output render inside an opaque-origin sandboxed iframe.

## License

MIT
