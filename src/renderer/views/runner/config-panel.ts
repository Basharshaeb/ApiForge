/**
 * Runner configuration panel (left column).
 */
import type { CollectionJson, RunnerConfig, RunnerTab } from '../../../shared/types';
import { isFolder, parseDataFile, walk } from '../../model';
import { clear, h, icon, iconButton, selectEl, toast, toggle } from '../../ui';
import * as App from '../../app';

export interface ConfigPanelProps { tab: RunnerTab; config: RunnerConfig; onStart(): void; onStop(): void; rerender(): void }

function folderOptions(collection: CollectionJson): Array<readonly [string, string]> {
  const out: Array<readonly [string, string]> = [['', 'Entire collection']];
  walk(collection.item, (node, ancestors) => { if (isFolder(node)) out.push([node.id, [...ancestors.map((a) => a.name), node.name].join(' / ')]); });
  return out;
}

async function pickData(config: RunnerConfig, rerender: () => void): Promise<void> {
  const files = await window.apiforge.files.openText({ title: 'Select data file', filters: [{ name: 'Data files', extensions: ['csv', 'json'] }] });
  if (!files.length) return;
  try {
    const data = parseDataFile(files[0].name, files[0].content);
    Object.assign(config, { data, dataName: files[0].name, iterations: data.length || 1 });
    App.save();
    rerender();
  } catch (err) {
    toast(`Could not read data file: ${(err as Error).message}`, 'error');
  }
}

function dataFileField(config: RunnerConfig, running: boolean, rerender: () => void): HTMLElement {
  const clearData = (): void => { Object.assign(config, { data: null, dataName: '' }); App.save(); rerender(); };
  return h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Data file (CSV or JSON)'),
    h('div', { class: 'inline-fields' },
      h('button', { class: 'btn btn-small btn-secondary', type: 'button', disabled: running, onclick: () => { void pickData(config, rerender); } }, 'Select File'),
      config.data ? h('span', { class: 'muted' }, `${config.dataName} · ${config.data.length} rows`) : h('span', { class: 'faint' }, 'None'),
      config.data ? iconButton('x', 'Remove data file', clearData) : null),
    config.data ? h('div', { class: 'field-help' }, `Iterations follow the data file (${config.data.length}). Columns: ${Object.keys(config.data[0] || {}).join(', ')}`) : null);
}

function numberField(label: string, value: number, disabled: boolean, onInput: (v: string) => void): HTMLElement {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), h('input', { class: 'input', type: 'number', min: 0, value, disabled, oninput: (e: Event) => onInput((e.target as HTMLInputElement).value) }));
}

export function renderConfigPanel(el: HTMLElement, { tab, config, onStart, onStop, rerender }: ConfigPanelProps): void {
  clear(el);
  const c = App.findCollection(tab.collectionId);
  if (!c) { el.appendChild(h('div', { class: 'muted' }, 'Collection not found')); return; }
  const running = !!tab.running;
  const env = App.activeEnvironment();
  const persist = <T>(fn: (v: T) => void) => (v: T): void => { fn(v); App.save(); };
  el.append(
    h('h3', null, icon('runner', 16), ' ', c.info.name),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Run'), selectEl(folderOptions(c), config.folderId, persist((v: string) => { config.folderId = v; }), { disabled: running })),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Environment'), h('div', { class: 'muted' }, env ? env.name : 'No environment (change it in the top bar)')),
    h('div', { class: 'field-row' },
      numberField('Iterations', config.iterations, running || !!config.data, persist((v: string) => { config.iterations = Math.max(1, Number(v) || 1); })),
      numberField('Delay (ms)', config.delay, running, persist((v: string) => { config.delay = Math.max(0, Number(v) || 0); }))),
    dataFileField(config, running, rerender),
    h('div', { class: 'field' }, toggle('Stop run on error', config.stopOnError, persist((v: boolean) => { config.stopOnError = v; }))),
    h('div', { class: 'field' }, toggle('Persist variable changes', config.persist, persist((v: boolean) => { config.persist = v; }))),
    h('div', { class: 'field-help', style: { marginBottom: '12px' } }, 'When on, values set by scripts (pm.environment.set, pm.globals.set) are kept after the run.'),
    running
      ? h('button', { class: 'btn btn-danger', type: 'button', onclick: onStop }, icon('stop', 14), 'Stop Run')
      : h('button', { class: 'btn btn-primary', type: 'button', onclick: onStart }, icon('play', 14), tab.result ? 'Run Again' : `Run ${c.info.name}`));
}
