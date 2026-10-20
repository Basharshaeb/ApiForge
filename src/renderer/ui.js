/**
 * Small DOM component kit for the ApiForge renderer: element builder, icons,
 * key/value tables, variable-aware inputs, code views, editors, modals,
 * menus, toasts and splitters. No framework; every component owns its DOM.
 */
(function (root) {
  'use strict';

  const M = root.ApiForgeModel;

  // ---------------------------------------------------------------------------
  // Element builder
  // ---------------------------------------------------------------------------
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === undefined || v === null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'html') el.innerHTML = v;
        else if (k in el && typeof v !== 'string') el[k] = v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    appendChildren(el, children);
    return el;
  }

  function appendChildren(el, children) {
    for (const child of children.flat(Infinity)) {
      if (child === null || child === undefined || child === false) continue;
      el.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
    }
  }

  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
    return el;
  }

  /** Like Element.append but skips null/undefined/false (native append would insert the text "null"). */
  function append(el, ...children) {
    appendChildren(el, children);
    return el;
  }

  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------------------------------------------------------------------------
  // Icons (24x24 stroke icons)
  // ---------------------------------------------------------------------------
  const ICON_PATHS = {
    collections: '<path d="M3 7h18M3 12h18M3 17h18"/><rect x="2" y="4" width="20" height="16" rx="2"/>',
    environments: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 3"/>',
    folder: '<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    'folder-open': '<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H7l-4 9z"/><path d="M3 18l3-8h16l-3 8z"/>',
    chevron: '<path d="M9 6l6 6-6 6"/>',
    'chevron-down': '<path d="M6 9l6 6 6-6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    'eye-off': '<path d="M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c6 0 10 6 10 6a17 17 0 0 1-3.2 3.9M6.6 6.6C3.9 8.4 2 12 2 12s4 7 10 7a9.6 9.6 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    play: '<path d="M7 4l13 8-13 8z"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="1"/>',
    save: '<path d="M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 3v5h8V3M7 21v-7h10v7"/>',
    code: '<path d="M8 6l-6 6 6 6M16 6l6 6-6 6"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
    upload: '<path d="M12 21V9M7 14l5-5 5 5M4 3h16"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    cookie: '<path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5z"/><circle cx="8.5" cy="12.5" r="1"/><circle cx="12" cy="17" r="1"/><circle cx="16" cy="13" r="1"/>',
    terminal: '<path d="M4 17l6-5-6-5M12 19h8"/>',
    check: '<path d="M5 12l5 5L20 7"/>',
    runner: '<path d="M5 3l14 9-14 9z"/><path d="M19 3v18"/>',
    file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
    plug: '<path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4"/>',
    wrap: '<path d="M3 6h18M3 12h15a3 3 0 0 1 0 6h-4M3 18h7"/><path d="M16 16l-2 2 2 2"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    example: '<path d="M4 4h16v16H4z"/><path d="M8 9h8M8 13h8M8 17h5"/>',
    send: '<path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    import: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v5h1"/>',
    github: '<path fill="currentColor" stroke="none" d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>'
  };

  function icon(name, size) {
    const span = document.createElement('span');
    span.className = `icon icon-${name}`;
    const s = size || 16;
    span.innerHTML = `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ''}</svg>`;
    return span;
  }

  function iconButton(name, title, onClick, extraClass) {
    return h('button', { class: `icon-btn ${extraClass || ''}`, title, 'aria-label': title, type: 'button', onclick: onClick }, icon(name));
  }

  function methodBadge(method, small) {
    const m = String(method || 'GET').toUpperCase();
    const short = { DELETE: 'DEL', OPTIONS: 'OPT', PATCH: 'PATCH' }[m] || m;
    return h('span', { class: `method method-${m.toLowerCase()}${small ? ' small' : ''}` }, small ? short : m);
  }

  // ---------------------------------------------------------------------------
  // Overlays: toast, menu, modal
  // ---------------------------------------------------------------------------
  function overlayRoot() {
    return document.getElementById('overlay-root');
  }

  function toast(message, kind) {
    const el = h('div', { class: `toast toast-${kind || 'info'}`, role: 'status' }, message);
    let host = document.querySelector('.toast-host');
    if (!host) { host = h('div', { class: 'toast-host' }); overlayRoot().appendChild(host); }
    host.appendChild(el);
    setTimeout(() => el.classList.add('leaving'), 3200);
    setTimeout(() => el.remove(), 3600);
  }

  let openMenuEl = null;
  function closeMenu() {
    if (openMenuEl) { openMenuEl.remove(); openMenuEl = null; }
  }

  /** items: [{ label, icon, onClick, danger, disabled, shortcut } | 'separator'] */
  function menu(anchor, items, opts) {
    closeMenu();
    const options = opts || {};
    const el = h('div', { class: 'menu', role: 'menu' });
    items.filter(Boolean).forEach((item) => {
      if (item === 'separator') { el.appendChild(h('div', { class: 'menu-sep' })); return; }
      el.appendChild(h('button', {
        class: `menu-item${item.danger ? ' danger' : ''}`,
        role: 'menuitem',
        type: 'button',
        disabled: !!item.disabled,
        onclick: (e) => { e.stopPropagation(); closeMenu(); item.onClick && item.onClick(); }
      }, item.icon ? icon(item.icon, 14) : h('span', { class: 'icon' }), h('span', { class: 'menu-label' }, item.label), item.shortcut ? h('span', { class: 'menu-shortcut' }, item.shortcut) : null));
    });
    overlayRoot().appendChild(el);
    const rect = options.point ? { left: options.point.x, right: options.point.x, bottom: options.point.y, top: options.point.y } : anchor.getBoundingClientRect();
    const mw = el.offsetWidth;
    const mh = el.offsetHeight;
    let left = options.alignRight ? rect.right - mw : rect.left;
    let top = rect.bottom + 4;
    if (left + mw > window.innerWidth - 8) left = window.innerWidth - mw - 8;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, rect.top - mh - 4);
    el.style.left = `${Math.max(8, left)}px`;
    el.style.top = `${top}px`;
    openMenuEl = el;
    const first = el.querySelector('.menu-item:not([disabled])');
    if (first) first.focus();
    return el;
  }

  document.addEventListener('mousedown', (e) => { if (openMenuEl && !openMenuEl.contains(e.target)) closeMenu(); });
  document.addEventListener('keydown', (e) => {
    if (!openMenuEl) return;
    if (e.key === 'Escape') { closeMenu(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const items = [...openMenuEl.querySelectorAll('.menu-item:not([disabled])')];
      const i = items.indexOf(document.activeElement);
      const next = items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
      if (next) next.focus();
      e.preventDefault();
    }
  });
  window.addEventListener('blur', closeMenu);
  window.addEventListener('resize', closeMenu);

  /** Generic modal. Returns { el, close }. */
  function modal({ title, body, actions, width, onClose }) {
    const backdrop = h('div', { class: 'modal-backdrop' });
    const close = (result) => {
      backdrop.remove();
      document.removeEventListener('keydown', onKey, true);
      if (onClose) onClose(result);
    };
    const footer = h('div', { class: 'modal-footer' }, (actions || []).map((a) => h('button', {
      class: `btn ${a.primary ? 'btn-primary' : a.danger ? 'btn-danger' : 'btn-secondary'}`,
      type: 'button',
      onclick: () => { if (a.onClick) { if (a.onClick() !== false) close(a.value); } else close(a.value); }
    }, a.label)));
    const dialog = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, style: width ? { width: `${width}px` } : null },
      h('div', { class: 'modal-header' }, h('h2', null, title), iconButton('x', 'Close', () => close(undefined))),
      h('div', { class: 'modal-body' }, body),
      actions && actions.length ? footer : null);
    backdrop.appendChild(dialog);
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(undefined); });
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(undefined); }
      if (e.key === 'Enter' && !e.shiftKey && e.target.tagName === 'INPUT') {
        const primary = footer.querySelector('.btn-primary');
        if (primary) { e.preventDefault(); primary.click(); }
      }
    };
    document.addEventListener('keydown', onKey, true);
    overlayRoot().appendChild(backdrop);
    const focusable = dialog.querySelector('input, textarea, select');
    if (focusable) setTimeout(() => { focusable.focus(); if (focusable.select) focusable.select(); }, 0);
    return { el: dialog, close };
  }

  function prompt({ title, label, value, placeholder, okLabel }) {
    return new Promise((resolve) => {
      const input = h('input', { class: 'input', value: value || '', placeholder: placeholder || '' });
      modal({
        title,
        body: h('label', { class: 'field' }, h('span', { class: 'field-label' }, label || 'Name'), input),
        actions: [
          { label: 'Cancel', value: null },
          { label: okLabel || 'Save', primary: true, onClick: () => { if (!input.value.trim()) { input.focus(); return false; } resolve(input.value.trim()); return true; } }
        ],
        onClose: (v) => { if (v === null || v === undefined) resolve(null); }
      });
    });
  }

  function confirm({ title, message, okLabel, danger }) {
    return new Promise((resolve) => {
      let answered = false;
      modal({
        title,
        body: h('p', { class: 'modal-message' }, message),
        actions: [
          { label: 'Cancel', value: false },
          { label: okLabel || 'OK', primary: !danger, danger: !!danger, onClick: () => { answered = true; resolve(true); } }
        ],
        onClose: () => { if (!answered) resolve(false); }
      });
    });
  }

  /** Three-way choice used when closing a dirty tab. Resolves 'save' | 'discard' | null. */
  function choice({ title, message, options }) {
    return new Promise((resolve) => {
      let done = false;
      modal({
        title,
        body: h('p', { class: 'modal-message' }, message),
        actions: options.map((o) => ({ label: o.label, primary: o.primary, danger: o.danger, onClick: () => { done = true; resolve(o.value); } })),
        onClose: () => { if (!done) resolve(null); }
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Splitter
  // ---------------------------------------------------------------------------
  function splitter(handle, { axis, onStart, onMove, onEnd }) {
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const start = axis === 'x' ? e.clientX : e.clientY;
      const ctx = onStart ? onStart() : null;
      document.body.classList.add(axis === 'x' ? 'resizing-x' : 'resizing-y');
      const move = (ev) => onMove((axis === 'x' ? ev.clientX : ev.clientY) - start, ctx);
      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        document.body.classList.remove('resizing-x', 'resizing-y');
        if (onEnd) onEnd();
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
  }

  // ---------------------------------------------------------------------------
  // Variable-aware input: highlights {{vars}} (green = defined, red = missing)
  // and autocompletes names after "{{".
  // ---------------------------------------------------------------------------
  function highlightVars(text, vars) {
    return escapeHtml(text).replace(/\{\{([^{}]*)\}\}/g, (m, name) => {
      const known = vars && vars.has(name);
      return `<span class="var ${known ? 'var-ok' : 'var-missing'}">${m}</span>`;
    }) + ' ';
  }

  let suggestEl = null;
  function closeSuggest() { if (suggestEl) { suggestEl.remove(); suggestEl = null; } }

  function varInput({ value, placeholder, onInput, getVars, className, type, onKeyDown, multiline }) {
    const wrap = h('div', { class: `var-input ${className || ''}${multiline ? ' multiline' : ''}` });
    const backdrop = h('div', { class: 'var-backdrop', 'aria-hidden': 'true' });
    const input = multiline
      ? h('textarea', { class: 'var-field', placeholder: placeholder || '', spellcheck: false, rows: 3 })
      : h('input', { class: 'var-field', placeholder: placeholder || '', spellcheck: false, type: type || 'text' });
    input.value = value == null ? '' : String(value);
    wrap.append(backdrop, input);

    const paint = () => {
      const vars = getVars ? getVars() : null;
      if (input.type === 'password') { backdrop.innerHTML = ''; wrap.classList.add('masked'); return; }
      wrap.classList.remove('masked');
      backdrop.innerHTML = highlightVars(input.value, vars);
      backdrop.scrollLeft = input.scrollLeft;
      backdrop.scrollTop = input.scrollTop;
      if (vars && /\{\{/.test(input.value)) input.title = M.substitute(input.value, vars);
      else input.removeAttribute('title');
    };

    let active = 0;
    let matches = [];
    const showSuggest = () => {
      const vars = getVars ? getVars() : null;
      const before = input.value.slice(0, input.selectionStart);
      const m = before.match(/\{\{([^{}\s]*)$/);
      if (!vars || !m) { closeSuggest(); return; }
      const q = m[1].toLowerCase();
      matches = [...vars.entries()].filter(([k]) => k.toLowerCase().includes(q)).slice(0, 12);
      if (!matches.length) { closeSuggest(); return; }
      closeSuggest();
      active = 0;
      suggestEl = h('div', { class: 'suggest' }, matches.map(([k, v], i) => h('div', {
        class: `suggest-item${i === 0 ? ' active' : ''}`,
        onmousedown: (e) => { e.preventDefault(); pick(i); }
      }, h('span', { class: 'suggest-key' }, k), h('span', { class: 'suggest-val' }, v.secret ? '••••••' : v.value), h('span', { class: 'suggest-src' }, v.source))));
      overlayRoot().appendChild(suggestEl);
      const r = input.getBoundingClientRect();
      suggestEl.style.left = `${r.left}px`;
      suggestEl.style.top = `${r.bottom + 2}px`;
      suggestEl.style.minWidth = `${Math.min(Math.max(r.width, 260), 480)}px`;
    };
    const pick = (i) => {
      const [name] = matches[i];
      const pos = input.selectionStart;
      const before = input.value.slice(0, pos).replace(/\{\{([^{}\s]*)$/, `{{${name}}}`);
      const after = input.value.slice(pos).replace(/^[^{}\s]*\}\}/, '');
      input.value = before + after;
      input.setSelectionRange(before.length, before.length);
      closeSuggest();
      paint();
      if (onInput) onInput(input.value);
    };

    input.addEventListener('input', () => { paint(); showSuggest(); if (onInput) onInput(input.value); });
    input.addEventListener('scroll', () => { backdrop.scrollLeft = input.scrollLeft; backdrop.scrollTop = input.scrollTop; });
    input.addEventListener('blur', () => setTimeout(closeSuggest, 100));
    input.addEventListener('keydown', (e) => {
      if (suggestEl) {
        const items = suggestEl.querySelectorAll('.suggest-item');
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          items[active].classList.remove('active');
          active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
          items[active].classList.add('active');
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(active); return; }
        if (e.key === 'Escape') { closeSuggest(); return; }
      }
      if (onKeyDown) onKeyDown(e);
    });
    requestAnimationFrame(paint);

    wrap.input = input;
    wrap.repaint = paint;
    wrap.setValue = (v) => { input.value = v == null ? '' : String(v); paint(); };
    wrap.setMasked = (masked) => { if (!multiline) { input.type = masked ? 'password' : 'text'; paint(); } };
    return wrap;
  }

  // ---------------------------------------------------------------------------
  // Key/value table (params, headers, form bodies, variables)
  // ---------------------------------------------------------------------------
  /**
   * opts: {
   *   rows (mutated in place), onChange, getVars,
   *   keyPlaceholder, valuePlaceholder,
   *   description: bool, fixedKeys: bool (path variables), files: bool (form-data),
   *   types: bool (environment secret/default), bulk: bool, pickFile: async () => path
   * }
   */
  function kvEditor(opts) {
    const rows = opts.rows;
    const el = h('div', { class: 'kv' });
    let bulkMode = false;
    const changed = () => opts.onChange && opts.onChange(rows);

    const render = () => {
      clear(el);
      const toolbar = h('div', { class: 'kv-toolbar' });
      if (opts.title) toolbar.appendChild(h('span', { class: 'kv-title' }, opts.title));
      toolbar.appendChild(h('span', { class: 'spacer' }));
      if (opts.bulk !== false && !opts.fixedKeys) {
        toolbar.appendChild(h('button', { class: 'link-btn', type: 'button', onclick: () => { bulkMode = !bulkMode; render(); } }, bulkMode ? 'Key-Value Edit' : 'Bulk Edit'));
      }
      el.appendChild(toolbar);
      if (bulkMode) return renderBulk();

      const table = h('div', { class: `kv-table${opts.description ? ' with-desc' : ''}${opts.types || opts.files ? ' with-type' : ''}${opts.fixedKeys ? ' fixed' : ''}` });
      table.appendChild(h('div', { class: 'kv-row kv-head' },
        h('div', { class: 'kv-cell kv-check' }),
        h('div', { class: 'kv-cell' }, opts.keyLabel || 'Key'),
        opts.types || opts.files ? h('div', { class: 'kv-cell kv-type-cell' }, 'Type') : null,
        h('div', { class: 'kv-cell' }, opts.valueLabel || 'Value'),
        opts.description ? h('div', { class: 'kv-cell' }, 'Description') : null,
        h('div', { class: 'kv-cell kv-actions' })));
      rows.forEach((r, i) => table.appendChild(renderRow(r, i)));
      if (!opts.fixedKeys) table.appendChild(renderGhostRow(table));
      el.appendChild(table);
      if (opts.fixedKeys && !rows.length && opts.emptyText) el.appendChild(h('div', { class: 'kv-empty' }, opts.emptyText));
    };

    const renderRow = (r, i) => {
      const line = h('div', { class: `kv-row${r.enabled === false ? ' disabled' : ''}` });
      const check = h('input', { type: 'checkbox', checked: r.enabled !== false, disabled: !!opts.fixedKeys, 'aria-label': 'Enabled', onchange: () => { r.enabled = check.checked; line.classList.toggle('disabled', !check.checked); changed(); } });
      const key = opts.fixedKeys
        ? h('div', { class: 'kv-static' }, r.key)
        : varInput({ value: r.key, placeholder: opts.keyPlaceholder || 'Key', getVars: opts.getVars, onInput: (v) => { r.key = v; changed(); } });
      let valueCell;
      if (opts.files && r.type === 'file') {
        const name = r.src ? String(r.src).split(/[\\/]/).pop() : '';
        valueCell = h('div', { class: 'kv-file' },
          h('button', { class: 'btn btn-small btn-secondary', type: 'button', onclick: async () => { const p = await opts.pickFile(); if (p) { r.src = p; changed(); render(); } } }, name ? 'Change' : 'Select file'),
          h('span', { class: 'kv-file-name', title: r.src || '' }, name || 'No file selected'));
      } else {
        const v = varInput({ value: r.value == null ? '' : r.value, placeholder: opts.valuePlaceholder || 'Value', getVars: opts.getVars, onInput: (val) => { r.value = val; changed(); } });
        if (opts.types && r.type === 'secret') {
          v.setMasked(true);
          valueCell = h('div', { class: 'kv-secret' }, v, iconButton('eye', 'Show value', (e) => {
            const masked = v.input.type === 'password';
            v.setMasked(!masked);
            e.currentTarget.replaceChildren(icon(masked ? 'eye-off' : 'eye'));
          }));
        } else valueCell = v;
      }
      let typeCell = null;
      if (opts.types) {
        typeCell = h('select', { class: 'select kv-type', 'aria-label': 'Type', onchange: (e) => { r.type = e.target.value; changed(); render(); } },
          h('option', { value: 'default', selected: r.type !== 'secret' }, 'default'), h('option', { value: 'secret', selected: r.type === 'secret' }, 'secret'));
      } else if (opts.files) {
        typeCell = h('select', { class: 'select kv-type', 'aria-label': 'Type', onchange: (e) => { r.type = e.target.value; if (r.type === 'text') r.src = ''; changed(); render(); } },
          h('option', { value: 'text', selected: r.type !== 'file' }, 'Text'), h('option', { value: 'file', selected: r.type === 'file' }, 'File'));
      }
      const desc = opts.description ? varInput({ value: r.description || '', placeholder: 'Description', onInput: (v) => { r.description = v; changed(); } }) : null;
      append(line,
        h('div', { class: 'kv-cell kv-check' }, check),
        h('div', { class: 'kv-cell' }, key),
        typeCell ? h('div', { class: 'kv-cell kv-type-cell' }, typeCell) : null,
        h('div', { class: 'kv-cell' }, valueCell),
        desc ? h('div', { class: 'kv-cell' }, desc) : null,
        h('div', { class: 'kv-cell kv-actions' }, opts.fixedKeys ? null : iconButton('trash', 'Delete row', () => { rows.splice(i, 1); changed(); render(); }))
      );
      return line;
    };

    const renderGhostRow = (table) => {
      const ghost = h('div', { class: 'kv-row ghost' });
      const promote = (field, val) => {
        const r = M.row('', '', true, opts.files ? { type: 'text', src: '' } : opts.types ? { type: 'default' } : {});
        r[field] = val;
        rows.push(r);
        changed();
        const real = renderRow(r, rows.length - 1);
        table.insertBefore(real, ghost);
        const inputs = real.querySelectorAll('.var-field');
        const target = field === 'key' ? inputs[0] : inputs[1];
        if (target) { target.focus(); target.setSelectionRange(val.length, val.length); }
        ghost.querySelectorAll('.var-field').forEach((f) => { f.value = ''; });
        ghost.querySelectorAll('.var-input').forEach((w) => w.repaint && w.repaint());
      };
      const key = varInput({ placeholder: opts.keyPlaceholder || 'Key', getVars: opts.getVars, onInput: (v) => promote('key', v) });
      const value = varInput({ placeholder: opts.valuePlaceholder || 'Value', getVars: opts.getVars, onInput: (v) => promote('value', v) });
      append(ghost,
        h('div', { class: 'kv-cell kv-check' }),
        h('div', { class: 'kv-cell' }, key),
        opts.types || opts.files ? h('div', { class: 'kv-cell kv-type-cell' }) : null,
        h('div', { class: 'kv-cell' }, value),
        opts.description ? h('div', { class: 'kv-cell' }) : null,
        h('div', { class: 'kv-cell kv-actions' })
      );
      return ghost;
    };

    const renderBulk = () => {
      const text = rows.filter((r) => !M.isBlankRow(r) && r.type !== 'file')
        .map((r) => `${r.enabled === false ? '//' : ''}${r.key}:${r.value == null ? '' : r.value}`).join('\n');
      const area = h('textarea', { class: 'bulk-edit mono', spellcheck: false, placeholder: 'Rows are separated by new lines\nKeys and values are separated by :\nPrepend // to any row you want to add but keep disabled' });
      area.value = text;
      area.addEventListener('input', () => {
        const fileRows = rows.filter((r) => r.type === 'file');
        const parsed = M.parseHeaderString(area.value).map((r) => (opts.files ? { ...r, type: 'text', src: '' } : opts.types ? { ...r, type: 'default' } : r));
        rows.splice(0, rows.length, ...parsed, ...fileRows);
        changed();
      });
      el.appendChild(area);
    };

    render();
    el.refresh = render;
    return el;
  }

  // ---------------------------------------------------------------------------
  // Code view: formatting + highlighting with line numbers
  // ---------------------------------------------------------------------------
  /** Pretty-print JSON without parsing numbers (keeps big integers exact). */
  function formatJson(text) {
    let out = '';
    let indent = 0;
    let inString = false;
    const pad = () => '\n' + '  '.repeat(indent);
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inString) {
        out += c;
        if (c === '\\') { out += text[++i] || ''; continue; }
        if (c === '"') inString = false;
        continue;
      }
      if (c === '"') { inString = true; out += c; continue; }
      if (/\s/.test(c)) continue;
      if (c === '{' || c === '[') {
        const close = c === '{' ? '}' : ']';
        let j = i + 1;
        while (j < text.length && /\s/.test(text[j])) j++;
        if (text[j] === close) { out += c + close; i = j; continue; }
        indent++;
        out += c + pad();
      } else if (c === '}' || c === ']') {
        indent = Math.max(0, indent - 1);
        out += pad() + c;
      } else if (c === ',') out += c + pad();
      else if (c === ':') out += ': ';
      else out += c;
    }
    return out;
  }

  function isJson(text) {
    try { JSON.parse(text); return true; } catch (_) { return false; }
  }

  function formatXml(text) {
    const tokens = String(text).replace(/>\s+</g, '><').split(/(<[^>]+>)/).filter((t) => t.trim() !== '');
    let indent = 0;
    const lines = [];
    tokens.forEach((t) => {
      if (/^<\//.test(t)) { indent = Math.max(0, indent - 1); lines.push('  '.repeat(indent) + t); }
      else if (/^<[^!?][^>]*[^/]>$/.test(t) && !/^<(area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)\b/i.test(t)) {
        lines.push('  '.repeat(indent) + t);
        indent++;
      } else if (/^</.test(t)) lines.push('  '.repeat(indent) + t);
      else {
        const last = lines.length - 1;
        if (last >= 0 && /^\s*<[^/!?][^>]*>$/.test(lines[last]) && t.length < 120) { lines[last] += t; indent = Math.max(0, indent); }
        else lines.push('  '.repeat(indent) + t.trim());
      }
    });
    // collapse "<a>text" + "</a>" onto one line
    const merged = [];
    lines.forEach((l) => {
      const prev = merged[merged.length - 1];
      if (prev && /^\s*<\//.test(l) && /^\s*<[^/!?][^>]*>[^<]+$/.test(prev)) { merged[merged.length - 1] = prev + l.trim(); }
      else merged.push(l);
    });
    let depth = 0;
    return merged.map((l) => {
      const t = l.trim();
      if (/^<\//.test(t)) depth = Math.max(0, depth - 1);
      const line = '  '.repeat(depth) + t;
      if (/^<[^!?/][^>]*[^/]>$/.test(t) && !/^<(area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)\b/i.test(t)) depth++;
      return line;
    }).join('\n');
  }

  function highlight(text, language) {
    const src = escapeHtml(text);
    if (language === 'json') {
      return src.replace(/(&quot;(?:\\.|(?!&quot;).)*&quot;)(\s*:)?|\b(true|false|null)\b|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)/g, (m, str, colon, lit, num) => {
        if (str) return colon ? `<span class="tok-key">${str}</span>${colon}` : `<span class="tok-str">${str}</span>`;
        if (lit) return `<span class="tok-lit">${lit}</span>`;
        if (num) return `<span class="tok-num">${num}</span>`;
        return m;
      });
    }
    if (language === 'xml' || language === 'html') {
      return src
        .replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span class="tok-comment">$1</span>')
        .replace(/(&lt;\/?)([\w:.-]+)([^&]*?)(\/?&gt;)/g, (m, open, tag, attrs, close) => `${open}<span class="tok-tag">${tag}</span>${attrs.replace(/([\w:.-]+)(=)(&quot;[^&]*?&quot;|&#39;[^&]*?&#39;)/g, '<span class="tok-attr">$1</span>$2<span class="tok-str">$3</span>')}${close}`);
    }
    if (language === 'javascript') {
      return src
        .replace(/(\/\/[^\n]*)/g, '<span class="tok-comment">$1</span>')
        .replace(/\b(const|let|var|function|return|if|else|for|while|new|true|false|null|undefined|await|async)\b/g, '<span class="tok-lit">$1</span>');
    }
    return src;
  }

  const HIGHLIGHT_LIMIT = 600 * 1024;

  function codeView(text, { language, wrap, lineNumbers }) {
    const body = String(text == null ? '' : text);
    const html = body.length > HIGHLIGHT_LIMIT ? escapeHtml(body) : highlight(body, language);
    const lines = html.split('\n');
    const pre = h('pre', { class: `code${wrap ? ' wrap' : ''}${lineNumbers === false ? ' no-ln' : ''}` });
    pre.innerHTML = lines.map((l) => `<span class="line">${l || ' '}</span>`).join('');
    return pre;
  }

  function prettyText(text, language) {
    if (language === 'json' && isJson(text)) return formatJson(text);
    if ((language === 'xml' || language === 'html') && text.length < 2 * 1024 * 1024) {
      try { return formatXml(text); } catch (_) { return text; }
    }
    return text;
  }

  // ---------------------------------------------------------------------------
  // Script / text editor with line numbers, tab indentation and auto-indent
  // ---------------------------------------------------------------------------
  function codeEditor({ value, onInput, placeholder, minHeight, language }) {
    const wrap = h('div', { class: 'editor' });
    const gutter = h('div', { class: 'editor-gutter', 'aria-hidden': 'true' });
    const area = h('textarea', { class: 'editor-area mono', spellcheck: false, placeholder: placeholder || '', wrap: 'off', 'data-language': language || 'text' });
    area.value = value || '';
    if (minHeight) wrap.style.minHeight = `${minHeight}px`;
    const paintGutter = () => {
      const n = area.value.split('\n').length;
      if (gutter.childElementCount !== n) gutter.textContent = Array.from({ length: n }, (_, i) => i + 1).join('\n');
      gutter.scrollTop = area.scrollTop;
    };
    area.addEventListener('scroll', () => { gutter.scrollTop = area.scrollTop; });
    area.addEventListener('input', () => { paintGutter(); if (onInput) onInput(area.value); });
    area.addEventListener('keydown', (e) => {
      const { selectionStart: s, selectionEnd: en, value: v } = area;
      if (e.key === 'Tab') {
        e.preventDefault();
        if (s !== en && v.slice(s, en).includes('\n')) {
          const lineStart = v.lastIndexOf('\n', s - 1) + 1;
          const block = v.slice(lineStart, en);
          const next = e.shiftKey ? block.replace(/^ {1,2}/gm, '') : block.replace(/^/gm, '  ');
          area.setRangeText(next, lineStart, en, 'select');
        } else if (!e.shiftKey) area.setRangeText('  ', s, en, 'end');
        area.dispatchEvent(new Event('input'));
      } else if (e.key === 'Enter') {
        const lineStart = v.lastIndexOf('\n', s - 1) + 1;
        const indent = (v.slice(lineStart, s).match(/^\s*/) || [''])[0];
        const extra = /[{[(]\s*$/.test(v.slice(lineStart, s)) ? '  ' : '';
        e.preventDefault();
        area.setRangeText(`\n${indent}${extra}`, s, en, 'end');
        area.dispatchEvent(new Event('input'));
      } else if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault();
        const lineStart = v.lastIndexOf('\n', s - 1) + 1;
        const lineEnd = v.indexOf('\n', en) === -1 ? v.length : v.indexOf('\n', en);
        const block = v.slice(lineStart, lineEnd);
        const allCommented = block.split('\n').every((l) => /^\s*\/\//.test(l) || !l.trim());
        const next = allCommented ? block.replace(/^(\s*)\/\/ ?/gm, '$1') : block.replace(/^/gm, '// ');
        area.setRangeText(next, lineStart, lineEnd, 'select');
        area.dispatchEvent(new Event('input'));
      }
    });
    wrap.append(gutter, area);
    requestAnimationFrame(paintGutter);
    wrap.area = area;
    wrap.insert = (text) => {
      const s = area.selectionStart;
      const prefix = s > 0 && area.value[s - 1] !== '\n' ? '\n' : '';
      area.setRangeText(prefix + text + '\n', s, area.selectionEnd, 'end');
      area.focus();
      area.dispatchEvent(new Event('input'));
    };
    wrap.setValue = (v) => { area.value = v || ''; paintGutter(); };
    return wrap;
  }

  // ---------------------------------------------------------------------------
  // Segmented tabs ("Params | Authorization | Headers ...")
  // ---------------------------------------------------------------------------
  function tabStrip(items, activeId, onSelect, className) {
    const el = h('div', { class: `subtabs ${className || ''}`, role: 'tablist' });
    items.forEach((it) => {
      el.appendChild(h('button', {
        class: `subtab${it.id === activeId ? ' active' : ''}`,
        role: 'tab',
        type: 'button',
        'aria-selected': String(it.id === activeId),
        onclick: () => onSelect(it.id)
      }, it.label, it.badge !== undefined && it.badge !== null && it.badge !== '' ? h('span', { class: `badge${it.badgeClass ? ` ${it.badgeClass}` : ''}` }, it.badge) : null, it.dot ? h('span', { class: 'dot' }) : null));
    });
    return el;
  }

  function radioGroup(name, options, value, onChange) {
    return h('div', { class: 'radio-group', role: 'radiogroup' }, options.map(([v, label]) => h('label', { class: `radio${v === value ? ' checked' : ''}` },
      h('input', { type: 'radio', name, value: v, checked: v === value, onchange: () => onChange(v) }), label)));
  }

  function selectEl(options, value, onChange, attrs) {
    const s = h('select', { class: 'select', ...(attrs || {}), onchange: (e) => onChange(e.target.value) },
      options.map(([v, label]) => h('option', { value: v, selected: v === value }, label)));
    return s;
  }

  function toggle(label, checked, onChange) {
    const input = h('input', { type: 'checkbox', checked: !!checked, onchange: (e) => onChange(e.target.checked) });
    return h('label', { class: 'toggle' }, input, h('span', { class: 'toggle-track' }, h('span', { class: 'toggle-thumb' })), h('span', null, label));
  }

  function emptyState(iconName, title, text, action) {
    return h('div', { class: 'empty-state' }, icon(iconName, 40), h('div', { class: 'empty-title' }, title), text ? h('div', { class: 'empty-text' }, text) : null, action || null);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied to clipboard', 'success');
    } catch (_) {
      toast('Could not copy to clipboard', 'error');
    }
  }

  root.UI = {
    h, clear, append, escapeHtml, icon, iconButton, methodBadge, toast, menu, closeMenu, modal, prompt, confirm, choice,
    splitter, varInput, kvEditor, codeView, prettyText, formatJson, formatXml, highlight, isJson, codeEditor,
    tabStrip, radioGroup, selectEl, toggle, emptyState, copyText
  };
})(window);
