/**
 * Test hook used by test/smoke.ts: runs a scenario script inside the renderer
 * once it has loaded, reports console output and the result on stdout, takes
 * an optional screenshot, then exits.
 */
import { app, type BrowserWindow, type WebContents } from 'electron';
import * as fsp from 'fs/promises';

const out = (msg: unknown): void => { process.stdout.write(`SMOKE ${JSON.stringify(msg)}\n`); };

function forwardDiagnostics(contents: WebContents): void {
  contents.on('console-message', (_e, level, message, line, source) => out({ console: { level, message, line, source } }));
  contents.on('preload-error', (_e, preloadPath, error) => out({ preloadError: `${preloadPath}: ${error.message}` }));
  contents.on('render-process-gone', (_e, details) => { out({ renderGone: details }); app.exit(2); });
}

async function runScenario(win: BrowserWindow, scriptPath: string): Promise<unknown> {
  const script = await fsp.readFile(scriptPath, 'utf8');
  return win.webContents.executeJavaScript(`(async () => { ${script} })()`, true);
}

async function screenshot(win: BrowserWindow, file: string): Promise<void> {
  const image = await win.capturePage();
  await fsp.writeFile(file, image.toPNG());
}

export function attachSmoke(win: BrowserWindow, { scriptPath, screenshotPath, shutdown }: { scriptPath: string; screenshotPath?: string; shutdown: () => void }): void {
  forwardDiagnostics(win.webContents);
  win.webContents.once('did-finish-load', async () => {
    let code = 0;
    try {
      out({ result: await runScenario(win, scriptPath) });
      if (screenshotPath) await screenshot(win, screenshotPath);
    } catch (err) {
      out({ error: (err as Error).message });
      code = 1;
    }
    shutdown();
    app.exit(code);
  });
}
