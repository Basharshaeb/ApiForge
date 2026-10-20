/**
 * Collection runner tab: configuration on the left, live results on the right.
 */
import type { RunnerConfig, RunnerTab } from '../../../shared/types';
import { h } from '../../ui';
import type { View } from '../types';
import { renderConfigPanel } from './config-panel';
import { renderResultsPanel } from './results-panel';
import { exportResults, start, stop } from './run-controller';

const DEFAULT_CONFIG: RunnerConfig = { folderId: '', iterations: 1, delay: 0, data: null, dataName: '', stopOnError: false, persist: true };

export function runnerView(tab: RunnerTab): View {
  const config: RunnerConfig = { ...DEFAULT_CONFIG, ...tab.config };
  tab.config = config;
  const configEl = h('div', { class: 'runner-config' });
  const resultsEl = h('div', { class: 'runner-results' });
  const el = h('div', { class: 'view' }, h('div', { class: 'runner-layout' }, configEl, resultsEl));

  const renderResults = (): void => renderResultsPanel(resultsEl, { tab, onStop: () => stop(tab), onExport: () => { void exportResults(tab); }, rerender: renderResults });
  const renderConfig = (): void => renderConfigPanel(configEl, { tab, config, onStart: begin, onStop: () => stop(tab), rerender: renderConfig });
  const renderAll = (): void => { renderConfig(); renderResults(); };
  function begin(): void {
    start(tab, config, renderResults);
    renderConfig();
  }

  renderAll();
  return { el, update: renderAll };
}
