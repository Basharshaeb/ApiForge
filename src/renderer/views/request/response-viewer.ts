/**
 * Response viewer shared by request and example tabs: body (pretty / raw /
 * preview), cookies, headers, test results and the visualizer.
 */
import type { Assertion, ResponseViewState, ScriptError, SerializedError, SerializedResponse } from '../../../shared/types';
import { formatBytes, formatMs, languageFromContentType } from '../../model';
import { clear, codeView, copyText, emptyState, h, icon, iconButton, isJson, menu, modal, prettyText, selectEl, tabStrip, toast, type TabItem } from '../../ui';

export interface ViewerOptions { onSaveExample?: () => void; onCancel?: () => void; onTabChange?: (id: string) => void }
export interface ResponseViewer extends HTMLDivElement { render(): void }

const statusClass = (code: number | null | undefined): string => (code ? `status-${Math.floor(code / 100)}xx` : 'status-err');
const bodyText = (r: SerializedResponse): string => (r.body != null ? r.body : (r.bodyBase64 ? '<binary data>' : ''));
const isBinary = (r: SerializedResponse): boolean => r.bodyBase64 != null && r.body == null;

// Helpers ------------------------------------------------------------------
/** Loads frame.html in an opaque-origin sandbox and posts the HTML to render. */
export function sandboxFrame(html: string, allowScripts: boolean): HTMLIFrameElement {
  const frame = h('iframe', { class: 'preview-frame', sandbox: allowScripts ? 'allow-scripts' : '', src: 'frame.html', title: allowScripts ? 'Visualizer' : 'Preview' });
  frame.addEventListener('load', () => { try { frame.contentWindow?.postMessage({ html }, '*'); } catch { /* frame gone */ } });
  return frame;
}

const EXTENSIONS: Record<string, string> = { json: 'json', html: 'html', xml: 'xml', javascript: 'js', text: 'txt' };

export async function downloadResponse(r: SerializedResponse): Promise<void> {
  const binary = isBinary(r);
  const ext = binary ? (String(r.contentType).split('/')[1] || 'bin').split(';')[0] : (EXTENSIONS[languageFromContentType(r.contentType, r.body)] || 'bin');
  const file = await window.apiforge.files.saveText({ defaultName: `response.${ext}`, content: binary ? (r.bodyBase64 as string) : (r.body || ''), base64: binary });
  if (file) toast(`Saved to ${file}`, 'success');
}

function timingsDialog(r: SerializedResponse): void {
  const t = r.timings || {};
  const rows: Array<[string, number | undefined]> = [['DNS lookup', t.dns], ['TCP handshake', t.tcp], ['TLS handshake', t.secureHandshake], ['First byte', t.firstByte], ['Download', t.download], ['Total', t.total]];
  modal({ title: 'Response timings', body: h('table', { class: 'data-table' }, h('tbody', null, rows.map(([k, v]) => h('tr', null, h('td', null, k), h('td', null, v == null ? '—' : formatMs(v)))))), actions: [{ label: 'Close', primary: true }] });
}

function testBadge(s: ResponseViewState): string | number | null {
  const total = (s.tests || []).length;
  if (!total) return (s.scriptErrors || []).length || null;
  const failed = s.tests.filter((t) => !t.passed && !t.skipped).length;
  return failed ? `${failed}/${total}` : `${total}/${total}`;
}

function testBadgeClass(s: ResponseViewState): string {
  if ((s.scriptErrors || []).length) return 'fail';
  if (!(s.tests || []).length) return '';
  return s.tests.some((t) => !t.passed && !t.skipped) ? 'fail' : 'ok';
}

// Sections -------------------------------------------------------------------
function metaBar(r: SerializedResponse, options: ViewerOptions): HTMLElement {
  return h('div', { class: 'response-meta' },
    h('span', { class: `status-pill ${statusClass(r.code)}` }, `${r.code} ${r.status || ''}`),
    h('span', null, formatMs(r.responseTime)),
    h('span', { title: `Body: ${formatBytes(r.size.body)} · Headers: ${formatBytes(r.size.header)}` }, formatBytes(r.size.total)),
    options.onSaveExample ? iconButton('save', 'Save response as example', options.onSaveExample) : null,
    iconButton('download', 'Save response to file', () => { void downloadResponse(r); }),
    iconButton('more', 'More', (e) => menu(e.currentTarget as Element, [
      { label: 'Copy body', icon: 'copy', onClick: () => { void copyText(bodyText(r)); } },
      { label: 'Copy headers', icon: 'copy', onClick: () => { void copyText(r.headers.map((x) => `${x.key}: ${x.value}`).join('\n')); } },
      r.timings ? { label: 'Show timings', icon: 'history', onClick: () => timingsDialog(r) } : null
    ], { alignRight: true })));
}

function responseTabs(s: ResponseViewState): TabItem[] {
  const r = s.response;
  const tabs: TabItem[] = [
    { id: 'body', label: 'Body' },
    { id: 'cookies', label: 'Cookies', badge: (s.cookies || []).length || null },
    { id: 'headers', label: 'Headers', badge: r ? r.headers.length : null },
    { id: 'tests', label: 'Test Results', badge: testBadge(s), badgeClass: testBadgeClass(s) }
  ];
  if (s.visualizer && (s.visualizer.processedTemplate || s.visualizer.error)) tabs.push({ id: 'visualize', label: 'Visualize' });
  return tabs;
}

function errorBlock(error: SerializedError, title: string): HTMLElement {
  return h('div', { class: 'response-error' }, h('b', null, title), error.message, error.code ? h('span', { class: 'mono' }, `Code: ${error.code}`) : null);
}

function renderPreview(r: SerializedResponse): HTMLElement {
  const ct = String(r.contentType || '').toLowerCase();
  if (r.bodyBase64 != null && /^image\//.test(ct)) return h('div', { class: 'preview-image' }, h('img', { src: `data:${ct.split(';')[0]};base64,${r.bodyBase64}`, alt: 'Response image' }));
  if (/html|xml|svg/.test(ct) || /^\s*<!doctype html|^\s*<html/i.test(r.body || '')) return sandboxFrame(r.body || '', false);
  if (/json/.test(ct) || isJson(r.body || '')) return codeView(prettyText(r.body || '', 'json'), { language: 'json', wrap: true });
  return emptyState('eye', 'No preview available', `Preview is available for HTML, XML, JSON and image responses (this one is ${r.contentType || 'untyped'}).`);
}

function bodyContent(s: ResponseViewState, r: SerializedResponse): HTMLElement {
  if (s.bodyView === 'preview') return renderPreview(r);
  if (isBinary(r)) return emptyState('file', 'Binary response', `${r.contentType || 'application/octet-stream'} · ${formatBytes(r.size.body)}. Use Preview for images or save the response to a file.`);
  if (s.bodyView === 'pretty') return codeView(prettyText(r.body || '', s.bodyLang), { language: s.bodyLang, wrap: s.wrap });
  return codeView(r.body || '', { language: 'text', wrap: s.wrap, lineNumbers: false });
}

function bodyToolbar(s: ResponseViewState, r: SerializedResponse, rerender: () => void): HTMLElement {
  const views = tabStrip([{ id: 'pretty', label: 'Pretty' }, { id: 'raw', label: 'Raw' }, { id: 'preview', label: 'Preview' }], s.bodyView || 'pretty', (id) => { s.bodyView = id as ResponseViewState['bodyView']; rerender(); }, 'pill');
  const langs = [['json', 'JSON'], ['xml', 'XML'], ['html', 'HTML'], ['javascript', 'JavaScript'], ['text', 'Text']] as const;
  return h('div', { class: 'pane-toolbar sub' },
    views,
    s.bodyView === 'pretty' ? selectEl(langs, s.bodyLang || 'text', (v) => { s.bodyLang = v; rerender(); }, { style: { width: '110px', height: '24px' } }) : null,
    h('span', { class: 'spacer' }),
    r.truncated ? h('span', { class: 'muted' }, 'Body truncated to 10 MB') : null,
    iconButton('wrap', 'Toggle line wrap', () => { s.wrap = !s.wrap; rerender(); }, s.wrap ? 'active' : ''),
    iconButton('copy', 'Copy body', () => { void copyText(bodyText(r)); }));
}

type Section = (el: HTMLElement, s: ResponseViewState, rerender: () => void) => void;

const renderBody: Section = (el, s, rerender) => {
  const r = s.response;
  if (!r) { if (s.error) el.appendChild(errorBlock(s.error, 'Could not send request')); return; }
  if (s.error) el.appendChild(errorBlock(s.error, 'Error'));
  s.bodyView = s.bodyView || 'pretty';
  if (!s.bodyLang) s.bodyLang = languageFromContentType(r.contentType, r.body);
  el.appendChild(bodyToolbar(s, r, rerender));
  el.appendChild(h('div', { class: 'code-wrap' }, bodyContent(s, r)));
};

const renderCookies: Section = (el, s) => {
  const cookies = s.cookies || [];
  if (!cookies.length) { el.appendChild(h('div', { class: 'pane-body no-pad' }, emptyState('cookie', 'No cookies', 'The response did not set any cookies, and none were sent for this domain.'))); return; }
  const columns = ['Name', 'Value', 'Domain', 'Path', 'Expires', 'HttpOnly', 'Secure'];
  const cells = (c: (typeof cookies)[number]): string[] => [c.name, c.value, c.domain || '', c.path || '', c.expires || 'Session', String(!!c.httpOnly), String(!!c.secure)];
  el.appendChild(h('div', { class: 'pane-body no-pad' }, h('table', { class: 'cookies-table' },
    h('thead', null, h('tr', null, columns.map((x) => h('th', null, x)))),
    h('tbody', null, cookies.map((c) => h('tr', null, cells(c).map((v) => h('td', null, v))))))));
};

const renderHeaders: Section = (el, s) => {
  const r = s.response;
  const body = h('div', { class: 'pane-body no-pad' });
  if (r) body.appendChild(h('table', { class: 'headers-table' },
    h('thead', null, h('tr', null, h('th', null, 'Key'), h('th', null, 'Value'))),
    h('tbody', null, r.headers.map((x) => h('tr', null, h('td', null, x.key), h('td', null, x.value))))));
  el.appendChild(body);
};

function testRow(t: Assertion): HTMLElement {
  const kind = t.skipped ? 'skip' : t.passed ? 'pass' : 'fail';
  return h('div', { class: `test-row ${kind}` }, h('span', { class: 'test-tag' }, kind.toUpperCase()), h('div', { class: 'test-name' }, t.name, t.error ? h('div', { class: 'test-error' }, t.error.message) : null));
}

function scriptErrorRow(e: ScriptError): HTMLElement {
  return h('div', { class: 'test-row fail' }, h('span', { class: 'test-tag' }, 'ERROR'), h('div', { class: 'test-name' }, `${e.target === 'test' ? 'Post-response' : 'Pre-request'} script`, h('div', { class: 'test-error' }, e.message)));
}

const renderTests: Section = (el, s) => {
  const tests = s.tests || [];
  const errors = s.scriptErrors || [];
  const body = h('div', { class: 'pane-body no-pad', style: { overflow: 'auto' } });
  if (!tests.length && !errors.length) {
    body.appendChild(emptyState('check', 'No tests found', 'Write pm.test() assertions in the Scripts tab to validate responses automatically.'));
  } else {
    const passed = tests.filter((t) => t.passed).length;
    const failed = tests.filter((t) => !t.passed && !t.skipped).length;
    body.append(
      h('div', { class: 'summary-strip' }, h('span', null, 'All ', h('b', null, tests.length)), h('span', { class: 'status-2xx' }, 'Passed ', h('b', null, passed)), h('span', { class: 'status-4xx' }, 'Failed ', h('b', null, failed)), h('span', null, 'Skipped ', h('b', null, tests.filter((t) => t.skipped).length))),
      h('div', { class: 'test-list' }, errors.map(scriptErrorRow), tests.map(testRow)));
  }
  el.appendChild(body);
};

const renderVisualize: Section = (el, s) => {
  const v = s.visualizer;
  if (!v) return;
  if (v.error) { el.appendChild(errorBlock(v.error, 'Visualizer error')); return; }
  el.appendChild(h('div', { class: 'code-wrap' }, sandboxFrame(v.processedTemplate || '', true)));
};

const SECTIONS: Record<string, Section> = { body: renderBody, cookies: renderCookies, headers: renderHeaders, tests: renderTests, visualize: renderVisualize };

// Viewer ------------------------------------------------------------------------
export function responseViewer(getState: () => ResponseViewState, options: ViewerOptions = {}): ResponseViewer {
  const el = h('div', { class: 'pane pane-response' }) as ResponseViewer;

  function render(): void {
    clear(el);
    const s = getState();
    if (s.running) {
      el.append(h('div', { class: 'loading-bar' }), h('div', { class: 'response-empty' }, h('div', null, 'Sending request…'),
        options.onCancel ? h('button', { class: 'btn btn-secondary btn-small', type: 'button', onclick: options.onCancel }, 'Cancel') : null));
      return;
    }
    if (!s.response && !s.error) {
      el.appendChild(h('div', { class: 'response-empty' }, icon('send', 28), h('div', null, 'Enter the URL and click Send to get a response'), h('div', { class: 'faint' }, h('kbd', null, 'Ctrl'), ' + ', h('kbd', null, 'Enter'))));
      return;
    }
    const strip = tabStrip(responseTabs(s), s.respTab || 'body', (id) => { s.respTab = id as ResponseViewState['respTab']; if (options.onTabChange) options.onTabChange(id); render(); });
    el.appendChild(h('div', { class: 'response-head' }, strip, s.response ? metaBar(s.response, options) : null));
    (SECTIONS[s.respTab || 'body'] || renderBody)(el, s, render);
  }

  el.render = render;
  return el;
}
