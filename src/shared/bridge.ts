/**
 * The preload bridge (window.apiforge): the renderer's only privileged API.
 * Implemented in src/main/preload.ts, handled in src/main/ipc.ts.
 */
import type { RendererState, SerializedCookie, Theme } from './types';
import type { Job, RunEvent, WsConnectOptions } from './runtime-protocol';

export interface OpenedTextFile { name: string; path: string; content: string }
export interface FileFilter { name: string; extensions: string[] }
export interface AppInfo { version: string; electron: string; node: string; chrome: string; platform: string; dataFile: string }
export type Unsubscribe = () => void;

export interface ApiForgeBridge {
  platform: string;
  store: {
    load(): Promise<RendererState>;
    save(patch: RendererState): Promise<boolean>;
  };
  runtime: {
    execute(job: Job): Promise<boolean>;
    abort(id: string): Promise<boolean>;
    onEvent(callback: (msg: RunEvent) => void): Unsubscribe;
  };
  ws: {
    connect(options: WsConnectOptions): Promise<boolean>;
    send(id: string, data: string): Promise<boolean>;
    close(id: string): Promise<boolean>;
  };
  cookies: {
    list(): Promise<SerializedCookie[]>;
    remove(cookie: { domain: string; path: string; name: string }): Promise<boolean>;
    clear(): Promise<boolean>;
  };
  files: {
    openText(options?: { title?: string; filters?: FileFilter[]; multi?: boolean }): Promise<OpenedTextFile[]>;
    pickPath(options?: { title?: string; multi?: boolean }): Promise<string[]>;
    saveText(options: { defaultName?: string; content: string; filters?: FileFilter[]; base64?: boolean }): Promise<string | null>;
  };
  app: {
    info(): Promise<AppInfo>;
    setTheme(theme: Theme): Promise<boolean>;
    openExternal(url: string): Promise<boolean>;
    onMenuCommand(callback: (command: string) => void): Unsubscribe;
  };
}

declare global {
  interface Window { apiforge: ApiForgeBridge }
}
