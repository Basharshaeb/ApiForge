/**
 * Display formatting shared by the UI.
 */
const KB = 1024;
const MB = KB * KB;

export function formatBytes(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return '—';
  if (n < KB) return `${n} B`;
  if (n < MB) return `${(n / KB).toFixed(2)} KB`;
  return `${(n / MB).toFixed(2)} MB`;
}

export function formatMs(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return '—';
  return n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(2)} s`;
}

export function languageFromContentType(contentType: string | null | undefined, body: string | null | undefined): string {
  const c = String(contentType || '').toLowerCase();
  if (c.includes('json')) return 'json';
  if (c.includes('html')) return 'html';
  if (c.includes('xml')) return 'xml';
  if (c.includes('javascript')) return 'javascript';
  if (c.includes('css')) return 'css';
  const t = String(body || '').trim();
  if (/^[{[]/.test(t)) { try { JSON.parse(t); return 'json'; } catch { /* not json */ } }
  if (/^<!doctype html|^<html/i.test(t)) return 'html';
  if (/^<\?xml|^<[a-z]/i.test(t)) return 'xml';
  return 'text';
}
