/**
 * Settings dialog: general, proxy and certificates.
 */
import type { AppInfo } from '../../../shared/bridge';
import type { ClientCertificate, ProxySettings, Settings, Theme } from '../../../shared/types';
import { clear, h, icon, iconButton, modal, selectEl, tabStrip, toast, toggle } from '../../ui';
import { save } from '../../app/persistence';
import { applyTheme } from '../../app/shell';
import { app } from '../../app/state';
import { notify } from '../../app/tabs';

const row = (title: string, desc: string | null, control: HTMLElement | null): HTMLElement =>
  h('div', { class: 'setting-row' }, h('div', { class: 'setting-text' }, h('div', { class: 'setting-title' }, title), desc ? h('div', { class: 'setting-desc' }, desc) : null), control);
const fileName = (p: string): string => String(p).split(/[\\/]/).pop() || '';
const pickPath = async (title: string): Promise<string | null> => (await window.apiforge.files.pickPath({ title }))[0] || null;
const numberInput = (attrs: Record<string, unknown>, onInput: (v: number) => void): HTMLInputElement =>
  h('input', { class: 'input', type: 'number', ...attrs, oninput: (e: Event) => onInput(Number((e.target as HTMLInputElement).value)) });

function generalSection(s: Settings, info: AppInfo): HTMLElement {
  return h('div', { class: 'settings-list' },
    row('Theme', 'Light or dark interface.', selectEl([['dark', 'Dark'], ['light', 'Light']], s.theme === 'light' ? 'light' : 'dark', (v) => { s.theme = v as Theme; }, { style: { width: '140px' } })),
    row('SSL certificate verification', 'Verify server certificates. Turn off to call servers with self-signed certificates.', toggle('', s.strictSSL !== false, (v) => { s.strictSSL = v; })),
    row('Automatically follow redirects', 'Follow 3xx redirects and return the final response.', toggle('', s.followRedirects !== false, (v) => { s.followRedirects = v; })),
    row('Request timeout (ms)', '0 means wait forever.', numberInput({ min: 0, value: s.requestTimeout || 0 }, (v) => { s.requestTimeout = Math.max(0, v || 0); })),
    row('History limit', 'Number of sent requests to keep in History.', numberInput({ min: 10, max: 5000, value: s.historyLimit || 200 }, (v) => { s.historyLimit = Math.max(10, v || 200); })),
    row('Data file', 'All collections, environments and history are stored here.', null),
    h('div', { class: 'mono muted', style: { userSelect: 'text', wordBreak: 'break-all' } }, info.dataFile));
}

function proxySection(s: Settings): HTMLElement {
  const proxy: ProxySettings = { enabled: false, host: '', port: '', username: '', password: '', bypass: '', ...(s.proxy || {}) };
  s.proxy = proxy;
  const field = (key: keyof ProxySettings, label: string, type = 'text'): HTMLElement =>
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), h('input', { class: 'input', type, value: proxy[key] || '', oninput: (e: Event) => { (proxy as unknown as Record<string, unknown>)[key] = (e.target as HTMLInputElement).value; } }));
  return h('div', { class: 'settings-list' },
    row('Use custom proxy', 'Route all requests through an HTTP proxy (CONNECT tunnelling for HTTPS).', toggle('', proxy.enabled, (v) => { proxy.enabled = v; })),
    h('div', { class: 'field-row' }, field('host', 'Proxy host'), h('label', { class: 'field', style: { maxWidth: '120px' } }, h('span', { class: 'field-label' }, 'Port'), numberInput({ min: 1, max: 65535, value: proxy.port || '' }, (v) => { proxy.port = v; }))),
    h('div', { class: 'field-row' }, field('username', 'Username'), field('password', 'Password', 'password')),
    field('bypass', 'Bypass list (comma separated hosts)'),
    row('Ignore proxy environment variables', 'Do not pick up HTTP_PROXY / HTTPS_PROXY / NO_PROXY from the system.', toggle('', !!s.ignoreProxyEnv, (v) => { s.ignoreProxyEnv = v; })));
}

function caRow(s: Settings, rerender: () => void): HTMLElement {
  const choose = async (): Promise<void> => { const p = await pickPath('Select PEM file'); if (p) { s.caCertPath = p; rerender(); } };
  return row('CA certificates (PEM)', 'Extra root certificates trusted in addition to the system bundle.', h('div', { class: 'inline-fields' },
    h('button', { class: 'btn btn-small btn-secondary', type: 'button', onclick: () => { void choose(); } }, 'Select File'),
    s.caCertPath ? h('span', { class: 'muted mono', title: s.caCertPath }, fileName(s.caCertPath)) : h('span', { class: 'faint' }, 'None'),
    s.caCertPath ? iconButton('x', 'Remove', () => { s.caCertPath = ''; rerender(); }) : null));
}

type PathKey = 'certPath' | 'keyPath' | 'pfxPath';

function pathPicker(cert: ClientCertificate, key: PathKey, label: string, rerender: () => void): HTMLElement {
  const choose = async (): Promise<void> => { const p = await pickPath(`Select ${label} file`); if (p) { cert[key] = p; rerender(); } };
  return h('div', { class: 'inline-fields', style: { marginBottom: '6px' } },
    h('span', { class: 'field-label', style: { width: '70px' } }, label),
    h('button', { class: 'btn btn-small btn-secondary', type: 'button', onclick: () => { void choose(); } }, 'Select'),
    cert[key] ? h('span', { class: 'muted mono', title: cert[key] }, fileName(cert[key])) : h('span', { class: 'faint' }, 'None'),
    cert[key] ? iconButton('x', 'Clear', () => { cert[key] = ''; rerender(); }) : null);
}

function certificateCard(cert: ClientCertificate, onRemove: () => void, rerender: () => void): HTMLElement {
  return h('div', { class: 'cookie-domain', style: { border: '1px solid var(--border)', borderRadius: '4px', padding: '10px' } },
    h('div', { class: 'field-row' },
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Host (e.g. api.example.com)'), h('input', { class: 'input', value: cert.host || '', oninput: (e: Event) => { cert.host = (e.target as HTMLInputElement).value; } })),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Passphrase'), h('input', { class: 'input', type: 'password', value: cert.passphrase || '', oninput: (e: Event) => { cert.passphrase = (e.target as HTMLInputElement).value; } })),
      iconButton('trash', 'Remove certificate', onRemove)),
    pathPicker(cert, 'certPath', 'CRT file', rerender), pathPicker(cert, 'keyPath', 'KEY file', rerender), pathPicker(cert, 'pfxPath', 'PFX file', rerender));
}

function certificatesSection(s: Settings, certs: ClientCertificate[]): HTMLElement {
  const caHost = h('div');
  const list = h('div');
  const renderCa = (): void => { clear(caHost); caHost.appendChild(caRow(s, renderCa)); };
  const renderCerts = (): void => {
    clear(list);
    certs.forEach((cert, i) => list.appendChild(certificateCard(cert, () => { certs.splice(i, 1); renderCerts(); }, renderCerts)));
    list.appendChild(h('button', { class: 'btn btn-small btn-secondary', type: 'button', onclick: () => { certs.push({ host: '', certPath: '', keyPath: '', pfxPath: '', passphrase: '' }); renderCerts(); } }, icon('plus', 12), 'Add client certificate'));
  };
  renderCa();
  renderCerts();
  return h('div', { class: 'settings-list' }, caHost, h('div', null, h('div', { class: 'setting-title' }, 'Client certificates'), h('div', { class: 'setting-desc', style: { marginBottom: '8px' } }, 'Sent when the request host matches. Use CRT + KEY or a PFX bundle.'), list));
}

export async function settingsDialog(): Promise<void> {
  const s: Settings = { ...app.state.settings };
  const certs = (Array.isArray(s.certificates) ? s.certificates : []).map((c) => ({ ...c }));
  const info = await window.apiforge.app.info();
  const sections: Record<string, HTMLElement> = { general: generalSection(s, info), proxy: proxySection(s), certificates: certificatesSection(s, certs) };
  const host = h('div', null, sections.general);
  const tabs = tabStrip([{ id: 'general', label: 'General' }, { id: 'proxy', label: 'Proxy' }, { id: 'certificates', label: 'Certificates' }], 'general', (id) => { clear(host); host.appendChild(sections[id]); });
  modal({
    title: 'Settings',
    width: 640,
    body: h('div', null, h('div', { style: { marginBottom: '12px' } }, tabs), host),
    actions: [
      { label: 'Cancel' },
      { label: 'Save', primary: true, onClick: () => {
        s.certificates = certs.filter((c) => c.host && (c.certPath || c.pfxPath));
        Object.assign(app.state.settings, s);
        applyTheme(s.theme);
        save();
        notify({ tabs: 'all' });
        toast('Settings saved', 'success');
        return true;
      } }
    ]
  });
}
