/**
 * Single-file JSON persistence for workspace data. Postman keeps this state in
 * IndexedDB / NeDB inside per-user Electron partitions; a local client only
 * needs one atomic, debounced JSON document in userData.
 */
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import type { RendererState, StoredState } from '../shared/types';

const FLUSH_DEBOUNCE_MS = 400;
const RENDERER_KEYS = ['collections', 'environments', 'globals', 'history', 'settings', 'ui'] as const;

export function defaultState(): StoredState {
  return {
    version: 1,
    collections: [],
    environments: [],
    globals: { values: [] },
    history: [],
    settings: {
      activeEnvironmentId: null,
      strictSSL: true,
      followRedirects: true,
      requestTimeout: 0,
      theme: 'dark',
      historyLimit: 200
    },
    ui: { tabs: [], activeTabId: null, sidebar: 'collections' },
    cookieJar: null
  };
}

export class Store {
  readonly file: string;
  data: StoredState = defaultState();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(file: string) {
    this.file = file;
  }

  async load(): Promise<StoredState> {
    try {
      const parsed = JSON.parse(await fsp.readFile(this.file, 'utf8')) as Partial<StoredState>;
      const base = defaultState();
      this.data = { ...base, ...parsed, settings: { ...base.settings, ...(parsed.settings || {}) } };
    } catch (err) {
      // Keep an unreadable file for recovery instead of overwriting it.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') await fsp.rename(this.file, `${this.file}.corrupt-${Date.now()}`).catch(() => undefined);
      this.data = defaultState();
    }
    return this.data;
  }

  /** Renderer-facing data (the cookie jar stays in the main process). */
  snapshot(): RendererState {
    const out = {} as RendererState;
    RENDERER_KEYS.forEach((k) => { (out as unknown as Record<string, unknown>)[k] = this.data[k]; });
    return out;
  }

  updateFromRenderer(patch: Partial<RendererState> | null | undefined): void {
    if (!patch || typeof patch !== 'object') return;
    RENDERER_KEYS.forEach((k) => {
      if (Object.prototype.hasOwnProperty.call(patch, k)) (this.data as unknown as Record<string, unknown>)[k] = patch[k];
    });
    this.schedule();
  }

  setCookieJar(serialized: unknown): void {
    this.data.cookieJar = serialized;
    this.schedule();
  }

  get pending(): boolean {
    return this.timer !== null;
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, FLUSH_DEBOUNCE_MS);
  }

  flush(): Promise<void> {
    const json = JSON.stringify(this.data);
    const tmp = `${this.file}.tmp`;
    this.writing = this.writing
      .then(() => fsp.writeFile(tmp, json))
      .then(() => fsp.rename(tmp, this.file))
      .catch((err) => console.error('Store flush failed', err));
    return this.writing;
  }

  flushSync(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }
}
