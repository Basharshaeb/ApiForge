/**
 * Cookie manager dialog.
 */
import type { SerializedCookie } from '../../../shared/types';
import { clear, confirm, emptyState, h, icon, iconButton, modal, type ModalHandle } from '../../ui';

function groupByDomain(cookies: SerializedCookie[]): Array<[string, SerializedCookie[]]> {
  const groups = new Map<string, SerializedCookie[]>();
  cookies.forEach((c) => {
    const domain = c.domain || '(no domain)';
    const list = groups.get(domain) || [];
    list.push(c);
    groups.set(domain, list);
  });
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function cookieMeta(c: SerializedCookie): string {
  const expires = c.expires ? new Date(c.expires).toLocaleString() : 'session';
  return `${c.path || '/'} · ${expires}${c.httpOnly ? ' · HttpOnly' : ''}${c.secure ? ' · Secure' : ''}`;
}

function cookieRow(c: SerializedCookie, reload: () => void): HTMLElement {
  const remove = async (): Promise<void> => { await window.apiforge.cookies.remove({ domain: c.domain || '', path: c.path || '/', name: c.name }); reload(); };
  return h('div', { class: 'cookie-row' }, h('span', { class: 'name' }, c.name), h('span', { class: 'value', title: c.value }, c.value), h('span', { class: 'meta' }, cookieMeta(c)), iconButton('trash', 'Delete cookie', () => { void remove(); }));
}

function domainGroup([domain, list]: [string, SerializedCookie[]], reload: () => void): HTMLElement {
  return h('div', { class: 'cookie-domain' }, h('div', { class: 'cookie-domain-head' }, icon('globe', 13), domain, h('span', { class: 'tree-count' }, list.length)), list.map((c) => cookieRow(c, reload)));
}

async function clearAll(reload: () => void): Promise<void> {
  if (await confirm({ title: 'Clear Cookies', message: 'Remove all stored cookies?', okLabel: 'Clear', danger: true })) {
    await window.apiforge.cookies.clear();
    reload();
  }
}

export function cookiesDialog(): ModalHandle {
  const body = h('div');
  async function load(): Promise<void> {
    clear(body);
    let cookies: SerializedCookie[];
    try { cookies = await window.apiforge.cookies.list(); } catch (err) { body.appendChild(h('div', { class: 'response-error' }, (err as Error).message)); return; }
    if (!cookies.length) { body.appendChild(emptyState('cookie', 'No cookies', 'Cookies set by responses are stored here and sent with matching requests.')); return; }
    const reload = (): void => { void load(); };
    body.appendChild(h('div', { style: { display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' } }, h('button', { class: 'btn btn-small btn-danger', type: 'button', onclick: () => { void clearAll(reload); } }, 'Clear all')));
    groupByDomain(cookies).forEach((group) => body.appendChild(domainGroup(group, reload)));
  }
  void load();
  return modal({ title: 'Manage Cookies', width: 680, body, actions: [{ label: 'Close', primary: true }] });
}
