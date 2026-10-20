/**
 * Minimal declarations for untyped Postman packages. Only the members this
 * project touches are described; everything else stays `any` on purpose.
 */
declare module 'postman-runtime' {
  import type { Collection } from 'postman-collection';

  export interface RunCallbacks { [name: string]: (...args: never[]) => void }
  export interface Run {
    start(callbacks: RunCallbacks): void;
    abort(): void;
  }
  export class Runner {
    run(collection: Collection, options: Record<string, unknown>, callback: (err: Error | null, run: Run) => void): void;
  }
}

declare module '@postman/tough-cookie' {
  export interface StoredCookie {
    key: string;
    value: string;
    domain?: string | null;
    path?: string | null;
    expires?: Date | string | null;
    httpOnly?: boolean;
    secure?: boolean;
    toJSON(): Record<string, unknown>;
  }
  export interface CookieStore {
    getAllCookies(cb: (err: Error | null, cookies?: StoredCookie[]) => void): void;
    removeCookie(domain: string, path: string, key: string, cb: (err: Error | null) => void): void;
  }
  export class CookieJar {
    store: CookieStore;
    serializeSync(): unknown;
    static deserializeSync(serialized: unknown): CookieJar;
  }
}
