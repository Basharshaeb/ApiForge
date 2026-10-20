/**
 * Code snippet dialog.
 */
import type { Draft, VariableMap } from '../../../shared/types';
import { substitute } from '../../model';
import * as Codegen from '../../codegen';
import { clear, codeView, copyText, h, icon, modal, selectEl } from '../../ui';
import { save } from '../../app/persistence';
import { app } from '../../app/state';

export function codeDialog(draft: Draft, vars: VariableMap): void {
  const state = { language: app.state.settings.codegenLanguage || 'curl', resolve: true };
  const codeWrap = h('div', { class: 'code-wrap' });
  const render = (): void => {
    clear(codeWrap);
    const lang = Codegen.LANGUAGES.find((l) => l.id === state.language) || Codegen.LANGUAGES[0];
    const resolver = state.resolve ? (s: string): string => substitute(s, vars) : null;
    codeWrap.appendChild(codeView(Codegen.generate(state.language, draft, resolver), { language: lang.lang === 'javascript' ? 'javascript' : 'text', wrap: true }));
  };
  const languageSelect = selectEl(Codegen.LANGUAGES.map((l) => [l.id, l.label] as const), state.language, (v) => { state.language = v; app.state.settings.codegenLanguage = v; save(); render(); });
  render();
  modal({
    title: 'Code snippet',
    width: 720,
    body: h('div', { class: 'code-modal' },
      h('div', { class: 'inline-fields' },
        languageSelect,
        h('label', { class: 'checkbox' }, h('input', { type: 'checkbox', checked: true, onchange: (e: Event) => { state.resolve = (e.target as HTMLInputElement).checked; render(); } }), 'Resolve variables'),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn btn-small btn-secondary', type: 'button', onclick: () => { void copyText(codeWrap.textContent || ''); } }, icon('copy', 13), 'Copy')),
      codeWrap),
    actions: [{ label: 'Close', primary: true }]
  });
}
