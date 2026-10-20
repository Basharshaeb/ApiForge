import { Menu, shell, type MenuItemConstructorOptions } from 'electron';
import { PATHS } from './paths';

type SendCommand = (command: string) => void;
type Click = (command: string) => () => void;

/**
 * Application menu. Every app-specific item forwards a command name to the
 * renderer, which owns the behaviour (see renderer/app/commands.ts).
 */
function fileMenu(send: Click): MenuItemConstructorOptions {
  return {
    label: 'File',
    submenu: [
      { label: 'New Request', accelerator: 'CmdOrCtrl+T', click: send('new-request') },
      { label: 'New Collection', click: send('new-collection') },
      { label: 'New Environment', click: send('new-environment') },
      { label: 'New WebSocket Request', click: send('new-websocket') },
      { type: 'separator' },
      { label: 'Import…', accelerator: 'CmdOrCtrl+O', click: send('import') },
      { label: 'Save', accelerator: 'CmdOrCtrl+S', click: send('save') },
      { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: send('close-tab') },
      { type: 'separator' },
      { label: 'Settings', accelerator: 'CmdOrCtrl+,', click: send('settings') },
      { type: 'separator' },
      { role: 'quit' }
    ]
  };
}

function viewMenu(send: Click): MenuItemConstructorOptions {
  return {
    label: 'View',
    submenu: [
      { label: 'Toggle Console', accelerator: 'CmdOrCtrl+Alt+C', click: send('toggle-console') },
      { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+\\', click: send('toggle-sidebar') },
      { label: 'Collection Runner', click: send('runner') },
      { label: 'Manage Cookies', click: send('cookies') },
      { type: 'separator' },
      { role: 'reload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { role: 'togglefullscreen' }
    ]
  };
}

function helpMenu(send: Click): MenuItemConstructorOptions {
  return {
    role: 'help',
    submenu: [
      { label: 'GitHub: Basharshaeb', click: () => { void shell.openExternal(PATHS.GITHUB_URL); } },
      { label: 'About ApiForge', click: send('about') }
    ]
  };
}

export function installMenu(sendCommand: SendCommand): void {
  const send: Click = (command) => () => sendCommand(command);
  const template: MenuItemConstructorOptions[] = [fileMenu(send), { role: 'editMenu' }, viewMenu(send), { role: 'windowMenu' }, helpMenu(send)];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
