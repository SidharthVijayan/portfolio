// Pure logic: no chrome.* and no DOM. Loads in the popup (<script>) and in Node tests (require).
// Turns the text blocks read by content/extract.js plus the reader settings into a plain "spec" tree
// ({ tag, style, attrs, text, children }) that popup.js's showReader() builds inside a closed shadow root.
// Fonts are system font stacks only: nothing is bundled or downloaded.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Core = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const WPM = 238;
  const FONTS = [
    { id: 'verdana', label: 'Verdana', stack: 'Verdana, "DejaVu Sans", Tahoma, Geneva, sans-serif' },
    { id: 'arial', label: 'Arial', stack: 'Arial, Helvetica, "Liberation Sans", "Nimbus Sans", sans-serif' },
    { id: 'comic', label: 'Comic Sans', stack: '"Comic Sans MS", "Comic Neue", "Chalkboard SE", "Comic Relief", sans-serif' },
    { id: 'atkinson', label: 'Atkinson Hyperlegible (if installed)', stack: '"Atkinson Hyperlegible", "Atkinson Hyperlegible Next", Verdana, "DejaVu Sans", sans-serif' },
    { id: 'opendyslexic', label: 'OpenDyslexic (if installed)', stack: 'OpenDyslexic, "OpenDyslexic 3", OpenDyslexic3, Verdana, "DejaVu Sans", sans-serif' },
    { id: 'system', label: 'System sans-serif', stack: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
  ];
  const SIZES = [16, 18, 20, 22, 24, 28, 32];
  const SPACINGS = [
    { id: 'normal', label: 'Normal', letter: 0, word: 0 },
    { id: 'wide', label: 'Wide', letter: 0.12, word: 0.16 },
    { id: 'wider', label: 'Extra wide', letter: 0.18, word: 0.32 },
  ];
  const LINE_HEIGHTS = [
    { id: '1.5', label: '1.5', value: 1.5 },
    { id: '1.8', label: '1.8', value: 1.8 },
    { id: '2.1', label: '2.1', value: 2.1 },
  ];
  const WIDTHS = [
    { id: 'narrow', label: 'Narrow (50 characters)', ch: 50 },
    { id: 'medium', label: 'Medium (65 characters)', ch: 65 },
    { id: 'wide', label: 'Wide (80 characters)', ch: 80 },
  ];
  const THEMES = [
    { id: 'cream', label: 'Cream', bg: '#fbf5e6', fg: '#262626', accent: '#7c2d12' },
    { id: 'peach', label: 'Peach', bg: '#fdebdc', fg: '#2b2118', accent: '#7c2d12' },
    { id: 'mint', label: 'Mint', bg: '#e8f5ec', fg: '#1d2b22', accent: '#14532d' },
    { id: 'blue', label: 'Soft blue', bg: '#e6eef8', fg: '#1b2430', accent: '#1e3a8a' },
    { id: 'grey', label: 'Light grey', bg: '#eeeeec', fg: '#252525', accent: '#374151' },
    { id: 'dark', label: 'Dark', bg: '#1f2023', fg: '#e8e4da', accent: '#fcd34d' },
  ];
  const DEFAULTS = { font: 'verdana', size: 20, spacing: 'wide', lineHeight: '1.8', width: 'medium', theme: 'cream' };
  const byId = (list, id) => list.find(x => x.id === String(id));
  const clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

  /** Fills in defaults and drops unknown values, so the popup can pass whatever the controls hold. */
  function normalize(s) {
    s = s || {};
    const size = Number(s.size);
    return {
      font: byId(FONTS, s.font) ? String(s.font) : DEFAULTS.font,
      size: SIZES.includes(size) ? size : DEFAULTS.size,
      spacing: byId(SPACINGS, s.spacing) ? String(s.spacing) : DEFAULTS.spacing,
      lineHeight: byId(LINE_HEIGHTS, s.lineHeight) ? String(s.lineHeight) : DEFAULTS.lineHeight,
      width: byId(WIDTHS, s.width) ? String(s.width) : DEFAULTS.width,
      theme: byId(THEMES, s.theme) ? String(s.theme) : DEFAULTS.theme,
    };
  }

  /** WCAG relative-luminance contrast ratio between two #rrggbb colours. */
  function contrast(a, b) {
    const lum = hex => {
      const [r, g, bl] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map(c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
      return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    };
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
  }

  function words(text) { return String(text || '').match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu) || []; }

  /** Text styles shared by every block: the font, spacing and the "no italics, no justification" rules. */
  function textStyle(s, t) {
    const sp = byId(SPACINGS, s.spacing);
    return {
      'font-family': byId(FONTS, s.font).stack, 'font-style': 'normal', 'font-weight': '400', color: t.fg,
      'letter-spacing': `${sp.letter}em`, 'word-spacing': `${sp.word}em`, 'line-height': String(byId(LINE_HEIGHTS, s.lineHeight).value),
      'text-align': 'left', 'text-decoration': 'none', 'text-transform': 'none', hyphens: 'manual', 'text-indent': '0',
      'overflow-wrap': 'break-word', 'white-space': 'normal', display: 'block', padding: '0', border: '0', background: 'transparent',
    };
  }

  /**
   * Builds the reader view. extracted = { url, title, source, blocks: [{ type: 'h'|'p'|'li'|'quote', level?, list?, listId?, text }] }.
   * Returns { settings, theme, stats, empty, tree } where tree is the spec for the whole overlay.
   */
  function layout(extracted, settings) {
    const s = normalize(settings);
    const t = byId(THEMES, s.theme), w = byId(WIDTHS, s.width);
    const blocks = ((extracted && extracted.blocks) || []).map(b => ({ ...b, text: clean(b.text) })).filter(b => b.text);
    const wordCount = blocks.reduce((n, b) => n + words(b.text).length, 0);
    const stats = { words: wordCount, blocks: blocks.length, minutes: Math.max(1, Math.round(wordCount / WPM)) };
    const base = textStyle(s, t);
    const px = n => `${Math.round(n * 10) / 10}px`;
    const para = { ...base, 'font-size': px(s.size), margin: `0 0 ${px(s.size * 2)} 0` };
    const children = [];
    let list = null;
    for (const b of blocks) {
      if (b.type === 'li') {
        if (!list || list.listId !== b.listId) {
          list = { listId: b.listId, node: { tag: b.list === 'ol' ? 'ol' : 'ul', style: { ...base, 'font-size': px(s.size), margin: `0 0 ${px(s.size * 2)} 0`, padding: '0 0 0 1.6em', 'list-style': b.list === 'ol' ? 'decimal outside' : 'disc outside' }, children: [] } };
          children.push(list.node);
        }
        list.node.children.push({ tag: 'li', style: { ...base, display: 'list-item', 'font-size': px(s.size), margin: `0 0 ${px(s.size * 0.8)} 0` }, text: b.text });
        continue;
      }
      list = null;
      if (b.type === 'h') {
        const level = Math.min(6, Math.max(1, Number(b.level) || 2));
        const scale = level === 1 ? 1.6 : level === 2 ? 1.35 : 1.15;
        // Headings keep the body text's spacing in px, so large headings don't spread out further.
        const sp = byId(SPACINGS, s.spacing);
        children.push({ tag: `h${level}`, style: { ...base, 'letter-spacing': px(s.size * sp.letter), 'word-spacing': px(s.size * sp.word), 'font-size': px(s.size * scale), 'font-weight': '700', 'line-height': '1.35', color: t.accent, margin: `${px(s.size * 1.2)} 0 ${px(s.size * 0.8)} 0` }, text: b.text });
      } else if (b.type === 'quote') {
        children.push({ tag: 'blockquote', style: { ...para, padding: `0 0 0 ${px(s.size)}`, 'border-left': `4px solid ${t.accent}` }, text: b.text });
      } else {
        children.push({ tag: 'p', style: para, text: b.text });
      }
    }
    if (!children.length) children.push({ tag: 'p', style: para, text: 'No readable text found on this page. Select some text and open the reader again.' });
    let host = '';
    try { host = new URL(extracted.url).hostname; } catch { host = ''; }
    const ui = { 'font-family': 'system-ui, -apple-system, "Segoe UI", Arial, sans-serif', 'font-size': '15px', 'line-height': '1.4', 'letter-spacing': '0', 'word-spacing': '0', color: t.fg };
    const tree = {
      tag: 'div',
      attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Dyslexia-Friendly Reader view', tabindex: '-1', 'data-role': 'scroller' },
      style: { position: 'fixed', inset: '0', overflow: 'auto', 'overscroll-behavior': 'contain', background: t.bg, color: t.fg, margin: '0', padding: '0', outline: 'none', 'box-sizing': 'border-box', display: 'block' },
      children: [
        { tag: 'div', style: { ...ui, display: 'flex', 'align-items': 'center', gap: '12px', position: 'sticky', top: '0', background: t.bg, padding: '10px 20px', 'border-bottom': `1px solid ${t.accent}`, margin: '0' }, children: [
          { tag: 'span', style: { ...ui, flex: '1', 'white-space': 'nowrap', overflow: 'hidden', 'text-overflow': 'ellipsis' }, text: `Reader view${host ? ` · ${host}` : ''} · ${stats.words} words · about ${stats.minutes} min read${extracted && extracted.source === 'selection' ? ' · your selection' : ''}` },
          { tag: 'button', attrs: { type: 'button', 'data-role': 'close' }, style: { ...ui, cursor: 'pointer', background: t.accent, color: t.bg, border: '0', 'border-radius': '6px', padding: '8px 14px', 'font-weight': '600' }, text: 'Close reader (Esc)' },
        ] },
        { tag: 'main', attrs: { lang: (extracted && extracted.lang) || 'en' }, style: { display: 'block', 'max-width': `${w.ch}ch`, margin: '0 auto', padding: `${px(s.size * 1.5)} 24px ${px(s.size * 4)}`, 'box-sizing': 'content-box', 'font-family': base['font-family'], 'font-size': px(s.size), background: 'transparent' }, children },
      ],
    };
    return { settings: s, theme: t, stats, empty: !blocks.length, tree };
  }

  /** Plain-language summary of the current settings (shown in the popup). */
  function describe(settings) {
    const s = normalize(settings);
    return `${byId(FONTS, s.font).label}, ${s.size}px, ${byId(SPACINGS, s.spacing).label.toLowerCase()} spacing, line height ${s.lineHeight}, ${byId(WIDTHS, s.width).ch} characters per line, ${byId(THEMES, s.theme).label.toLowerCase()} colours`;
  }

  return { FONTS, SIZES, SPACINGS, LINE_HEIGHTS, WIDTHS, THEMES, DEFAULTS, WPM, normalize, contrast, words, layout, describe };
});
