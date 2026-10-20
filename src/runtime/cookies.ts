/**
 * The worker's single cookie jar: persisted as tough-cookie's serialized form
 * and shared by every run.
 */
import { CookieJar } from '@postman/tough-cookie';
import type { SerializedCookie } from '../shared/types';
import { serializeCookie } from './serialize';

let jar = new CookieJar();

export const current = (): CookieJar => jar;

export function clear(): void {
  jar = new CookieJar();
}

export function load(serialized: unknown): void {
  try {
    jar = serialized ? CookieJar.deserializeSync(serialized) : new CookieJar();
  } catch {
    jar = new CookieJar();
  }
}

export const serialize = (): unknown => jar.serializeSync();

export function list(): Promise<SerializedCookie[]> {
  return new Promise((resolve, reject) => {
    jar.store.getAllCookies((err, cookies) => (err
      ? reject(err)
      : resolve((cookies || []).map((c) => serializeCookie({ ...c, name: c.key, domain: c.domain || undefined, path: c.path || undefined })))));
  });
}

export function remove({ domain, path, name }: { domain: string; path: string; name: string }): Promise<boolean> {
  return new Promise((resolve, reject) => {
    jar.store.removeCookie(domain, path, name, (err) => (err ? reject(err) : resolve(true)));
  });
}
