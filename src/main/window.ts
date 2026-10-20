import { BrowserWindow, shell, type WebContents } from 'electron';
import type { Theme } from '../shared/types';
import { PATHS } from './paths';

const THEME_BACKGROUND: Record<Theme, string> = { light: '#ffffff', dark: '#1e1e1e' };

/** Only http(s) links may leave the app, and only in the system browser. */
function denyNavigation(contents: WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event) => event.preventDefault());
}

export function createMainWindow({ theme, beforeLoad }: { theme: Theme; beforeLoad?: (win: BrowserWindow) => void }): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'ApiForge',
    icon: PATHS.APP_ICON,
    backgroundColor: THEME_BACKGROUND[theme] || THEME_BACKGROUND.dark,
    show: false,
    webPreferences: {
      preload: PATHS.PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });
  win.once('ready-to-show', () => win.show());
  denyNavigation(win.webContents);
  if (beforeLoad) beforeLoad(win);
  void win.loadFile(PATHS.RENDERER_ENTRY);
  return win;
}
