// Hidden Text Detector core: pure functions, no DOM, no network. Shared by the popup and Node tests.
// Takes what content/extract.js read from the page, adds the colour checks (text the same colour as
// its background, or fully transparent text), groups text hidden the same way under the same element
// into one block, sorts blocks into three groups, and writes the summary, the text report and the CSV.
// It finds hidden text; it does not judge contrast for readability (that is a different tool).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HiddenTextCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SAME_COLOUR_RATIO = 1.2; // at or below this the text is (almost) the same colour as the background
  const WHITE = { r: 255, g: 255, b: 255, a: 1 };
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  const CODES = {
    'offscreen': { group: 'cloak', label: 'Off-screen' },
    'tiny-font': { group: 'cloak', label: 'Tiny font' },
    'same-colour': { group: 'cloak', label: 'Same colour as background' },
    'transparent': { group: 'cloak', label: 'Transparent text' },
    'indent': { group: 'cloak', label: 'Pushed out by text-indent' },
    'opacity': { group: 'cloak', label: 'Faded out' },
    'display-none': { group: 'css', label: 'display: none' },
    'hidden-attr': { group: 'css', label: 'hidden attribute' },
    'visibility': { group: 'css', label: 'visibility: hidden' },
    'clipped': { group: 'css', label: 'Clipped to zero size' },
    'sr-only': { group: 'fine', label: 'Screen-reader only' },
    'collapsed': { group: 'fine', label: 'Collapsed section' },
  };
  // Which way of hiding decides the block a piece of text belongs to, strongest first.
  const PRIORITY = ['display-none', 'hidden-attr', 'collapsed', 'sr-only', 'clipped', 'visibility', 'opacity', 'offscreen', 'indent', 'tiny-font', 'transparent', 'same-colour'];
  const GROUPS = {
    cloak: { label: 'Cloaking-style', note: 'Text a visitor can\'t see but a crawler can read. Check these first.' },
    css: { label: 'Hidden by CSS', note: 'Often menus, tabs, pop-ups or accordions. Check that the text is meant to be hidden.' },
    fine: { label: 'Usually fine', note: 'Labels for screen readers and closed sections a visitor can open.' },
  };
  const GROUP_ORDER = ['cloak', 'css', 'fine'];

  function parseColor(s) {
    if (s == null) return null;
    s = String(s).trim().toLowerCase();
    if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
    let m = s.match(/^#([0-9a-f]{3,8})$/);
    if (m) {
      let h = m[1];
      if (h.length === 3 || h.length === 4) h = h.split('').map(c => c + c).join('');
      if (h.length !== 6 && h.length !== 8) return null;
      const n = i => parseInt(h.slice(i, i + 2), 16);
      return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? Math.round(n(6) / 255 * 1000) / 1000 : 1 };
    }
    m = s.match(/^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/);
    if (!m) return null;
    const ch = v => v.endsWith('%') ? parseFloat(v) * 2.55 : parseFloat(v);
    const al = v => v == null ? 1 : v.endsWith('%') ? parseFloat(v) / 100 : parseFloat(v);
    return { r: clamp(ch(m[1]), 0, 255), g: clamp(ch(m[2]), 0, 255), b: clamp(ch(m[3]), 0, 255), a: clamp(al(m[4]), 0, 1) };
  }
  function blend(top, bottom) {
    const a = top.a + bottom.a * (1 - top.a);
    if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
    const c = k => (top[k] * top.a + bottom[k] * bottom.a * (1 - top.a)) / a;
    return { r: c('r'), g: c('g'), b: c('b'), a };
  }
  function luminance(c) {
    const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  }
  function ratio(a, b) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  const hex = c => '#' + [c.r, c.g, c.b].map(v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');

  // Colour reasons for one text record, or [] when the text can be seen (or it can't be told from CSS).
  function colourReasons(rec) {
    if (!rec || rec.kind !== 'text' || rec.clipText || rec.shadow) return [];
    let fg = parseColor(rec.fill) || parseColor(rec.color);
    if (!fg) return [];
    if (fg.a === 0) return [{ code: 'transparent', root: rec.path, detail: 'text colour is fully transparent' }];
    const layers = rec.layers || [];
    if (layers.some(l => l.image)) return []; // text over an image or gradient: can't tell from CSS alone
    let bg = null;
    for (let i = layers.length - 1; i >= 0; i--) {
      const c = parseColor(layers[i].color); if (!c || c.a === 0) continue;
      bg = bg ? blend(c, bg) : (c.a >= 1 ? c : blend(c, WHITE));
    }
    bg = bg || WHITE;
    if (bg.a < 1) bg = blend(bg, WHITE);
    const shown = fg.a < 1 ? blend(fg, bg) : fg;
    const r = ratio(shown, bg);
    if (r <= SAME_COLOUR_RATIO) return [{ code: 'same-colour', root: rec.path, detail: `${hex(shown)} text on ${hex(bg)}` }];
    return [];
  }

  const words = s => (String(s || '').match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu) || []).length;

  function analyze(page) {
    const recs = (page && page.records) || [];
    const blocks = new Map();
    for (const rec of recs) {
      const reasons = [...(rec.hide || []), ...colourReasons(rec)].filter(r => CODES[r.code]);
      if (!reasons.length) continue;
      reasons.sort((a, b) => PRIORITY.indexOf(a.code) - PRIORITY.indexOf(b.code));
      const lead = reasons[0];
      const key = lead.code + '|' + lead.root;
      let b = blocks.get(key);
      if (!b) { b = { code: lead.code, root: lead.root, parts: [], reasons: [], links: [] }; blocks.set(key, b); }
      b.parts.push(String(rec.text || ''));
      for (const r of reasons) if (!b.reasons.some(x => x.code === r.code)) b.reasons.push({ code: r.code, label: CODES[r.code].label, detail: r.detail || '' });
      for (const l of [...(rec.links || []), ...(rec.link ? [rec.link] : [])]) if (!b.links.includes(l)) b.links.push(l);
    }
    const items = [...blocks.values()].map((b, i) => {
      const text = b.parts.join(' ').replace(/\s+/g, ' ').trim();
      b.reasons.sort((x, y) => PRIORITY.indexOf(x.code) - PRIORITY.indexOf(y.code));
      const groups = b.reasons.map(r => CODES[r.code].group);
      const group = GROUP_ORDER.find(g => groups.includes(g)); // the strongest signal decides the group
      return { id: i + 1, group, path: b.root, text, words: words(text), links: b.links, reasons: b.reasons };
    }).filter(it => it.words > 0);
    items.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) || a.id - b.id);
    items.forEach((it, i) => { it.id = i + 1; });
    const byGroup = { cloak: 0, css: 0, fine: 0 }, byCode = {};
    for (const it of items) { byGroup[it.group]++; for (const r of it.reasons) byCode[r.code] = (byCode[r.code] || 0) + 1; }
    return {
      url: page ? page.url : '', title: page ? page.title : '', items, byGroup, byCode,
      totals: { blocks: items.length, words: items.reduce((s, i) => s + i.words, 0), links: items.reduce((s, i) => s + i.links.length, 0) },
      truncated: !!(page && page.truncated),
    };
  }

  const plural = (n, one, many) => `${n.toLocaleString('en-US')} ${n === 1 ? one : (many || one + 's')}`;
  function summary(res) {
    const t = res.totals;
    let s;
    if (!t.blocks) s = 'No hidden text found on this page.';
    else {
      s = `Found ${plural(t.blocks, 'hidden text block')} (${plural(t.words, 'word')}, ${plural(t.links, 'link')}).`;
      if (!res.byGroup.cloak) s += ' None uses a cloaking-style trick.';
      else s += ` ${res.byGroup.cloak} cloaking-style.`;
    }
    if (res.truncated) s += ' Very long page, so only the first part was read.';
    return s;
  }
  function filter(res, group) { return group && group !== 'all' ? res.items.filter(i => i.group === group) : res.items.slice(); }
  const snippet = (s, n = 300) => s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;

  function report(res) {
    const lines = ['Hidden Text Detector report', `Page: ${res.url}`, summary(res), ''];
    for (const g of GROUP_ORDER) {
      const list = res.items.filter(i => i.group === g);
      if (!list.length) continue;
      lines.push(`${GROUPS[g].label} (${list.length})`);
      for (const it of list) {
        lines.push(`${it.id}. ${it.reasons.map(r => r.label + (r.detail ? ` (${r.detail})` : '')).join('; ')}`);
        lines.push(`   Element: ${it.path}`);
        lines.push(`   Text (${plural(it.words, 'word')}): ${snippet(it.text, 500)}`);
        if (it.links.length) lines.push(`   Links: ${it.links.join(' ')}`);
      }
      lines.push('');
    }
    return lines.join('\n').trimEnd() + '\n';
  }

  // CSV cells are quoted; cells that a spreadsheet would run as a formula get a leading apostrophe.
  const cell = v => { let s = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
  function toCsv(res) {
    const rows = [['Group', 'How it is hidden', 'Details', 'Words', 'Links', 'Link addresses', 'Element', 'Text']];
    for (const it of res.items) rows.push([GROUPS[it.group].label, it.reasons.map(r => r.label).join('; '), it.reasons.map(r => r.detail).filter(Boolean).join('; '), it.words, it.links.length, it.links.join(' '), it.path, it.text]);
    return '\ufeff' + rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
  }
  function fileName(url) {
    let host = 'page';
    try { host = new URL(url).hostname.replace(/^www\./, '') || 'page'; } catch (e) { /* keep default */ }
    return `hidden-text-${host.replace(/[^a-z0-9.-]+/gi, '-')}.csv`;
  }

  return { CODES, GROUPS, GROUP_ORDER, SAME_COLOUR_RATIO, parseColor, ratio, colourReasons, analyze, summary, filter, snippet, report, toCsv, fileName, words };
});
