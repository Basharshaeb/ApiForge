/**
 * Import dialog: paste text or pick files; shows what was detected.
 */
import type { OpenedTextFile } from '../../../shared/bridge';
import { countRequests, importText } from '../../model';
import { clear, h, icon, iconButton, modal, toast } from '../../ui';
import { importFromText } from '../../app/environments';

const FILE_FILTERS = [{ name: 'JSON / YAML / text', extensions: ['json', 'txt', 'yaml', 'yml', '*'] }];

function describe(text: string): string {
  const result = importText(text);
  switch (result.kind) {
    case 'collection': return `Postman Collection "${result.value.info.name}" (${countRequests(result.value.item)} requests)`;
    case 'environment': return `Environment "${result.value.name}" (${result.value.values.length} variables)`;
    case 'globals': return `Globals (${result.value.length} variables)`;
    case 'request': return `cURL request: ${result.value.method} ${result.value.url}`;
    default: return 'Unknown';
  }
}

function safeDescribe(text: string): { ok: boolean; text: string } {
  try { return { ok: true, text: describe(text) }; } catch (err) { return { ok: false, text: (err as Error).message }; }
}

function fileRow(file: OpenedTextFile, onRemove: () => void): HTMLElement {
  const status = safeDescribe(file.content);
  return h('div', { class: 'import-file' }, icon('file', 13), h('span', null, file.name), h('span', { class: `status ${status.ok ? '' : 'status-err'}` }, status.ok ? status.text : `Error: ${status.text}`), iconButton('x', 'Remove', onRemove));
}

async function importAll(files: OpenedTextFile[], text: string): Promise<void> {
  const messages: string[] = [];
  const attempt = async (content: string, label?: string): Promise<void> => {
    try { messages.push(await importFromText(content)); } catch (err) { messages.push(label ? `${label}: ${(err as Error).message}` : (err as Error).message); }
  };
  for (const f of files) await attempt(f.content, f.name);
  if (text) await attempt(text);
  messages.forEach((m) => toast(m, /error|could not|unsupported|unrecognized/i.test(m) ? 'error' : 'success'));
}

export function importDialog(): void {
  let files: OpenedTextFile[] = [];
  const area = h('textarea', { class: 'import-area', placeholder: 'Paste a Postman collection or environment (JSON), an OpenAPI 3 / Swagger 2 document (JSON or YAML) or a cURL command…', spellcheck: false });
  const detect = h('div', { class: 'import-detect' });
  const filesEl = h('div', { class: 'import-files' });
  const renderFiles = (): void => { clear(filesEl); files.forEach((f) => filesEl.appendChild(fileRow(f, () => { files = files.filter((x) => x !== f); renderFiles(); }))); };
  const pick = async (): Promise<void> => { files = files.concat(await window.apiforge.files.openText({ title: 'Import', multi: true, filters: FILE_FILTERS })); renderFiles(); };
  area.addEventListener('input', () => {
    const text = area.value.trim();
    const status = text ? safeDescribe(text) : null;
    detect.className = `import-detect${status ? (status.ok ? ' ok' : ' err') : ''}`;
    detect.textContent = status ? (status.ok ? `Detected: ${status.text}` : status.text) : '';
  });
  modal({
    title: 'Import',
    width: 640,
    body: h('div', null,
      h('div', { class: 'inline-fields', style: { marginBottom: '10px' } }, h('button', { class: 'btn btn-secondary btn-small', type: 'button', onclick: () => { void pick(); } }, icon('upload', 13), 'Select Files'), h('span', { class: 'muted' }, 'or paste below')),
      filesEl, area, detect),
    actions: [
      { label: 'Cancel' },
      { label: 'Import', primary: true, onClick: () => {
        const text = area.value.trim();
        if (!text && !files.length) { toast('Nothing to import', 'warning'); return false; }
        void importAll(files, text);
        return true;
      } }
    ]
  });
}
