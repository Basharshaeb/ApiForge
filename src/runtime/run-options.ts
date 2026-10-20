/**
 * Translates a job's plain `options` into the option object postman-runtime's
 * Runner expects (timeouts, proxy, certificates, entrypoint, requester).
 */
import * as fs from 'fs';
import * as sdk from 'postman-collection';
import type { CookieJar } from '@postman/tough-cookie';
import type { ClientCertificate, ProxySettings } from '../shared/types';
import type { Job, JobOptions } from '../shared/runtime-protocol';

const DEFAULT_PROXY_PORT = 8080;

export function buildTimeouts(options: JobOptions): { request?: number; script?: number } {
  const timeout: { request?: number; script?: number } = {};
  if (options.requestTimeout && options.requestTimeout > 0) timeout.request = options.requestTimeout;
  if (options.scriptTimeout && options.scriptTimeout > 0) timeout.script = options.scriptTimeout;
  return timeout;
}

const splitList = (text: unknown): string[] => String(text || '').split(',').map((s) => s.trim()).filter(Boolean);

export function buildProxies(proxy: ProxySettings | null | undefined): sdk.ProxyConfigList | undefined {
  if (!proxy || !proxy.enabled || !proxy.host) return undefined;
  return new sdk.ProxyConfigList({} as sdk.Collection, [{
    match: 'http+https://*/*',
    host: proxy.host,
    port: Number(proxy.port) || DEFAULT_PROXY_PORT,
    tunnel: true,
    authenticate: !!proxy.username,
    username: proxy.username || '',
    password: proxy.password || '',
    bypass: splitList(proxy.bypass)
  }] as unknown as sdk.ProxyConfig[]); // the typings want instances; the SDK accepts definitions
}

function certificateEntry(cert: ClientCertificate): sdk.CertificateDefinition {
  return {
    name: cert.host,
    matches: [`https://${cert.host}/*`],
    key: cert.keyPath ? { src: cert.keyPath } : undefined,
    cert: cert.certPath ? { src: cert.certPath } : undefined,
    pfx: cert.pfxPath ? { src: cert.pfxPath } : undefined,
    passphrase: cert.passphrase || undefined
  } as sdk.CertificateDefinition;
}

export function buildCertificates(list: ClientCertificate[] | undefined): sdk.CertificateList | undefined {
  const usable = (list || []).filter((c) => c && c.host && (c.certPath || c.pfxPath));
  return usable.length ? new sdk.CertificateList({} as sdk.Collection, usable.map(certificateEntry)) : undefined;
}

export function buildEntrypoint(entrypoint: JobOptions['entrypoint']): { execute: string; lookupStrategy: string } | undefined {
  if (!entrypoint || !entrypoint.execute) return undefined;
  return { execute: entrypoint.execute, lookupStrategy: 'idOrName' };
}

function buildRequesterOptions(options: JobOptions, cookieJar: CookieJar): Record<string, unknown> {
  return {
    cookieJar,
    strictSSL: options.strictSSL !== false,
    followRedirects: options.followRedirects !== false,
    timings: true,
    extendedRootCA: options.caCertPath || undefined
  };
}

export function buildRunOptions(job: Job, cookieJar: CookieJar): Record<string, unknown> {
  const options = job.options || {};
  return {
    environment: new sdk.VariableScope(job.environment || { values: [] }),
    globals: new sdk.VariableScope(job.globals || { values: [] }),
    iterationCount: options.iterationCount && options.iterationCount > 0 ? options.iterationCount : 1,
    data: Array.isArray(options.data) ? options.data : undefined,
    delay: { item: options.delay && options.delay > 0 ? options.delay : 0 },
    timeout: buildTimeouts(options),
    stopOnError: !!options.stopOnError,
    entrypoint: buildEntrypoint(options.entrypoint),
    fileResolver: fs,
    proxies: buildProxies(options.proxy),
    certificates: buildCertificates(options.certificates),
    ignoreProxyEnvironmentVariables: !!options.ignoreProxyEnv,
    requester: buildRequesterOptions(options, cookieJar)
  };
}
