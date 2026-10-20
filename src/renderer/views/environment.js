/**
 * Environment / globals editor tab. Edits are applied directly to the store.
 */
(function (root) {
  'use strict';

  root.Views = root.Views || {};
  const UI = root.UI;
  const { h, clear, icon, iconButton } = UI;

  function environmentView(tab) {
    const App = root.App;
    const el = h('div', { class: 'view' });
    let sidebarTimer = null;
    const refreshSidebarSoon = () => { clearTimeout(sidebarTimer); sidebarTimer = setTimeout(() => App.renderSidebar(), 600); };

    function render() {
      clear(el);
      const isGlobals = tab.envId === 'globals';
      const env = isGlobals ? { id: 'globals', name: 'Globals', values: App.state.globals.values } : App.findEnvironment(tab.envId);
      if (!env) { el.appendChild(UI.emptyState('environments', 'Environment not found', 'It may have been deleted.')); return; }
      const isActive = !isGlobals && App.state.settings.activeEnvironmentId === env.id;

      const header = h('div', { class: 'view-header' });
      if (isGlobals) header.appendChild(h('span', { class: 'title-input', style: { display: 'inline-flex', alignItems: 'center', gap: '8px' } }, icon('globe', 16), 'Globals'));
      else {
        const name = h('input', { class: 'title-input', value: env.name, 'aria-label': 'Environment name', spellcheck: false });
        name.addEventListener('input', () => { env.name = name.value; App.save(); App.notify({ tabbar: true }); refreshSidebarSoon(); });
        header.appendChild(name);
      }
      UI.append(header,
        h('span', { class: 'spacer' }),
        isGlobals ? null : h('button', { class: `btn btn-small ${isActive ? 'btn-secondary' : 'btn-primary'}`, type: 'button', onclick: () => App.setActiveEnvironment(isActive ? null : env.id) }, isActive ? 'Active' : 'Set as active'),
        iconButton('download', 'Export', () => App.exportEnvironment(env, isGlobals ? 'globals' : 'environment')),
        isGlobals ? null : iconButton('trash', 'Delete environment', () => App.deleteEnvironment(env)));

      const body = h('div', { class: 'doc-view' },
        h('div', { class: 'doc-note' }, isGlobals
          ? 'Global variables are available in every request and are overridden by collection and environment variables with the same name.'
          : 'Environment variables are available when this environment is active. Reference them with {{name}} and mark sensitive values as secret to mask them.'),
        UI.kvEditor({
          rows: env.values,
          types: true,
          keyPlaceholder: 'Variable',
          valuePlaceholder: 'Value',
          onChange: () => { App.save(); refreshSidebarSoon(); }
        }),
        h('div', { class: 'doc-note', style: { marginTop: '14px' } }, 'Changes are saved automatically. Scripts can update these values with pm.environment.set() and pm.globals.set().'));
      el.append(header, body);
    }

    render();
    return { el, update: render };
  }

  root.Views.environment = environmentView;
})(window);
