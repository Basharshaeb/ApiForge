/**
 * Code display and editing: formatters, syntax highlighting, read-only code
 * views with line numbers and a lightweight textarea-based editor.
 */
import { escapeHtml, h } from './dom';

const HIGHLIGHT_LIMIT = 600 * 1024;
const XML_FORMAT_LIMIT = 2 * 1024 * 1024;
const VOID_TAGS = /^<(area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)\b/i;

// Formatting -----------------------------------------------------------------
export function isJson(text: string): boolean {
  try { JSON.parse(text); return true; } catch { return false; }
}

/** Pretty-print JSON without parsing numbers (keeps big integers exact). */
// eslint-disable-next-line complexity -- character-level state machine; splitting it would obscure the grammar
export function formatJson(text: string): string {
  let out = '';
  let indent = 0;
  let inString = false;
  const pad = (): string => '\n' + '  '.repeat(indent);
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === '\\') out += text[++i] || '';
      else if (c === '"') inString = false;
    } else if (c === '"') { inString = true; out += c; }
    else if (/\s/.test(c)) continue;
    else if (c === '{' || c === '[') {
      const close = c === '{' ? '}' : ']';
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] === close) { out += c + close; i = j; continue; }
      indent++;
      out += c + pad();
    } else if (c === '}' || c === ']') { indent = Math.max(0, indent - 1); out += pad() + c; }
    else if (c === ',') out += c + pad();
    else if (c === ':') out += ': ';
    else out += c;
  }
  return out;
}

const isClosingTag = (t: string): boolean => /^<\//.test(t);
const isOpeningTag = (t: string): boolean => /^<[^!?/][^>]*[^/]>$/.test(t) && !VOID_TAGS.test(t);

export function formatXml(text: string): string {
  const tokens = String(text).replace(/>\s+</g, '><').split(/(<[^>]+>)/).filter((t) => t.trim() !== '');
  const lines: string[] = [];
  let depth = 0;
  tokens.forEach((t) => {
    const token = t.trim();
    const prev = lines[lines.length - 1];
    if (isClosingTag(token)) {
      depth = Math.max(0, depth - 1);
      if (prev && /^\s*<[^/!?][^>]*>[^<]*$/.test(prev)) { lines[lines.length - 1] = prev + token; return; } // <a>text</a> on one line
      lines.push('  '.repeat(depth) + token);
      return;
    }
    if (!token.startsWith('<')) {
      if (prev && /^\s*<[^/!?][^>]*>$/.test(prev) && token.length < 120) { lines[lines.length - 1] = prev + token; return; }
      lines.push('  '.repeat(depth) + token);
      return;
    }
    lines.push('  '.repeat(depth) + token);
    if (isOpeningTag(token)) depth++;
  });
  return lines.join('\n');
}

export function prettyText(text: string, language: string | undefined): string {
  if (language === 'json' && isJson(text)) return formatJson(text);
  if ((language === 'xml' || language === 'html') && text.length < XML_FORMAT_LIMIT) {
    try { return formatXml(text); } catch { return text; }
  }
  return text;
}

// Highlighting ---------------------------------------------------------------
function highlightJson(src: string): string {
  return src.replace(/(&quot;(?:\\.|(?!&quot;).)*&quot;)(\s*:)?|\b(true|false|null)\b|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)/g, (m, str: string, colon: string, lit: string, num: string) => {
    if (str) return colon ? `<span class="tok-key">${str}</span>${colon}` : `<span class="tok-str">${str}</span>`;
    if (lit) return `<span class="tok-lit">${lit}</span>`;
    if (num) return `<span class="tok-num">${num}</span>`;
    return m;
  });
}

function highlightMarkup(src: string): string {
  return src
    .replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span class="tok-comment">$1</span>')
    .replace(/(&lt;\/?)([\w:.-]+)([^&]*?)(\/?&gt;)/g, (_m, open: string, tag: string, attrs: string, close: string) => {
      const attributes = attrs.replace(/([\w:.-]+)(=)(&quot;[^&]*?&quot;|&#39;[^&]*?&#39;)/g, '<span class="tok-attr">$1</span>$2<span class="tok-str">$3</span>');
      return `${open}<span class="tok-tag">${tag}</span>${attributes}${close}`;
    });
}

function highlightJavaScript(src: string): string {
  return src
    .replace(/(\/\/[^\n]*)/g, '<span class="tok-comment">$1</span>')
    .replace(/\b(const|let|var|function|return|if|else|for|while|new|true|false|null|undefined|await|async)\b/g, '<span class="tok-lit">$1</span>');
}

const HIGHLIGHTERS: Record<string, (src: string) => string> = { json: highlightJson, xml: highlightMarkup, html: highlightMarkup, javascript: highlightJavaScript };

export function highlight(text: string, language: string | undefined): string {
  const src = escapeHtml(text);
  const fn = language ? HIGHLIGHTERS[language] : undefined;
  return fn ? fn(src) : src;
}

export interface CodeViewOptions { language?: string; wrap?: boolean; lineNumbers?: boolean }

export function codeView(text: string | null | undefined, { language, wrap, lineNumbers }: CodeViewOptions): HTMLPreElement {
  const body = String(text == null ? '' : text);
  const html = body.length > HIGHLIGHT_LIMIT ? escapeHtml(body) : highlight(body, language);
  const pre = h('pre', { class: `code${wrap ? ' wrap' : ''}${lineNumbers === false ? ' no-ln' : ''}` });
  pre.innerHTML = html.split('\n').map((l) => `<span class="line">${l || ' '}</span>`).join('');
  return pre;
}

// Editor -----------------------------------------------------------------------
const lineStartOf = (value: string, pos: number): number => value.lastIndexOf('\n', pos - 1) + 1;

function indentSelection(area: HTMLTextAreaElement, outdent: boolean): void {
  const { selectionStart: s, selectionEnd: e, value } = area;
  if (s !== e && value.slice(s, e).includes('\n')) {
    const start = lineStartOf(value, s);
    const block = value.slice(start, e);
    area.setRangeText(outdent ? block.replace(/^ {1,2}/gm, '') : block.replace(/^/gm, '  '), start, e, 'select');
  } else if (!outdent) {
    area.setRangeText('  ', s, e, 'end');
  }
}

function insertNewlineWithIndent(area: HTMLTextAreaElement): void {
  const { selectionStart: s, selectionEnd: e, value } = area;
  const line = value.slice(lineStartOf(value, s), s);
  const indent = (line.match(/^\s*/) || [''])[0];
  const extra = /[{[(]\s*$/.test(line) ? '  ' : '';
  area.setRangeText(`\n${indent}${extra}`, s, e, 'end');
}

function toggleLineComment(area: HTMLTextAreaElement): void {
  const { selectionStart: s, selectionEnd: e, value } = area;
  const start = lineStartOf(value, s);
  const end = value.indexOf('\n', e) === -1 ? value.length : value.indexOf('\n', e);
  const block = value.slice(start, end);
  const allCommented = block.split('\n').every((l) => /^\s*\/\//.test(l) || !l.trim());
  area.setRangeText(allCommented ? block.replace(/^(\s*)\/\/ ?/gm, '$1') : block.replace(/^/gm, '// '), start, end, 'select');
}

function editorKeyHandler(area: HTMLTextAreaElement): (e: KeyboardEvent) => void {
  return (e) => {
    if (e.key === 'Tab') indentSelection(area, e.shiftKey);
    else if (e.key === 'Enter') insertNewlineWithIndent(area);
    else if ((e.ctrlKey || e.metaKey) && e.key === '/') toggleLineComment(area);
    else return;
    e.preventDefault();
    area.dispatchEvent(new Event('input'));
  };
}

export interface CodeEditor extends HTMLDivElement { area: HTMLTextAreaElement; insert(text: string): void; setValue(v: string): void }
export interface CodeEditorOptions { value?: string; onInput?: (value: string) => void; placeholder?: string; minHeight?: number; language?: string }

/** Textarea editor with a line-number gutter, tab indentation, auto-indent and Ctrl+/ comments. */
export function codeEditor({ value, onInput, placeholder, minHeight, language }: CodeEditorOptions): CodeEditor {
  const wrap = h('div', { class: 'editor', style: minHeight ? { minHeight: `${minHeight}px` } : null }) as CodeEditor;
  const gutter = h('div', { class: 'editor-gutter', 'aria-hidden': 'true' });
  const area = h('textarea', { class: 'editor-area mono', spellcheck: false, placeholder: placeholder || '', wrap: 'off', 'data-language': language || 'text' });
  area.value = value || '';
  const paintGutter = (): void => {
    const n = area.value.split('\n').length;
    if (gutter.childElementCount !== n) gutter.textContent = Array.from({ length: n }, (_, i) => i + 1).join('\n');
    gutter.scrollTop = area.scrollTop;
  };
  area.addEventListener('scroll', () => { gutter.scrollTop = area.scrollTop; });
  area.addEventListener('input', () => { paintGutter(); if (onInput) onInput(area.value); });
  area.addEventListener('keydown', editorKeyHandler(area));
  wrap.append(gutter, area);
  requestAnimationFrame(paintGutter);

  wrap.area = area;
  wrap.insert = (text) => {
    const s = area.selectionStart;
    const prefix = s > 0 && area.value[s - 1] !== '\n' ? '\n' : '';
    area.setRangeText(`${prefix}${text}\n`, s, area.selectionEnd, 'end');
    area.focus();
    area.dispatchEvent(new Event('input'));
  };
  wrap.setValue = (v) => { area.value = v || ''; paintGutter(); };
  return wrap;
}
