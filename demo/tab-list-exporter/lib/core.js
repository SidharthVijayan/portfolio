// Tab List Exporter: pure formatting logic (no chrome.* calls here, so it is unit-testable in Node).
(function (root) {
  'use strict';

  const FORMATS = {
    markdown: { label: 'Markdown links', ext: 'md', mime: 'text/markdown' },
    csv: { label: 'CSV (spreadsheet)', ext: 'csv', mime: 'text/csv' },
    text: { label: 'Plain text (title + address)', ext: 'txt', mime: 'text/plain' },
    urls: { label: 'Addresses only', ext: 'txt', mime: 'text/plain' },
  };
  const SCOPES = {
    window: 'Tabs in this window',
    selected: 'Selected (highlighted) tabs',
    all: 'Tabs in all windows',
  };
  const DEFAULTS = { format: 'markdown', scope: 'window', skipInternal: true, dedupe: true };

  // chrome.tabs.query filter for each scope.
  function queryFor(scope) {
    if (scope === 'all') return {};
    if (scope === 'selected') return { currentWindow: true, highlighted: true };
    return { currentWindow: true };
  }

  // Browser-internal pages that are not useful to share.
  const INTERNAL = /^(chrome|chrome-extension|chrome-untrusted|edge|brave|opera|vivaldi|about|devtools|view-source|chrome-search):/i;
  function isInternal(url) { return !url || INTERNAL.test(url); }

  function clean(s) { return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim(); }

  // tabs: [{ title, url, windowId, index, incognito }]; opts: { skipInternal, dedupe, incognito }
  function prepare(tabs, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    const seen = new Set();
    const out = [];
    let skippedInternal = 0, skippedDupes = 0, skippedPrivate = 0;
    // Number windows in the order the browser lists them, and keep each window's tab order.
    const winNo = new Map();
    for (const t of tabs || []) if (!!t.incognito === !!o.incognito && !winNo.has(t.windowId)) winNo.set(t.windowId, winNo.size + 1);
    const sorted = (tabs || []).slice().sort((a, b) => ((winNo.get(a.windowId) || 0) - (winNo.get(b.windowId) || 0)) || ((a.index || 0) - (b.index || 0)));
    for (const t of sorted) {
      if (!!t.incognito !== !!o.incognito) { skippedPrivate++; continue; }
      const url = clean(t.url);
      if (o.skipInternal && isInternal(url)) { skippedInternal++; continue; }
      if (o.dedupe) { if (seen.has(url)) { skippedDupes++; continue; } seen.add(url); }
      out.push({ title: clean(t.title) || url, url, windowId: t.windowId, windowNumber: winNo.get(t.windowId) });
    }
    return { tabs: out, skippedInternal, skippedDupes, skippedPrivate };
  }

  function mdTitle(s) { return s.replace(/([\\`*_[\]<>])/g, '\\$1'); }
  function mdUrl(u) { return u.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/</g, '%3C').replace(/>/g, '%3E'); }
  // RFC 4180 quoting, plus a leading apostrophe on cells that a spreadsheet would treat as a formula.
  function csvCell(s) {
    let v = String(s);
    if (/^[=+\-@\t\r]/.test(v)) v = "'" + v;
    return /[",\r\n]/.test(v) || v !== v.trim() ? '"' + v.replace(/"/g, '""') + '"' : v;
  }

  function format(list, fmt, multiWindow) {
    const nl = '\n';
    if (fmt === 'csv') {
      const head = multiWindow ? ['window', 'title', 'url'] : ['title', 'url'];
      const rows = list.map(t => (multiWindow ? [t.windowNumber, t.title, t.url] : [t.title, t.url]).map(csvCell).join(','));
      return [head.join(','), ...rows].join('\r\n') + '\r\n';
    }
    if (fmt === 'urls') return list.map(t => t.url).join(nl) + (list.length ? nl : '');
    const line = fmt === 'text' ? t => t.title + nl + t.url : t => '- [' + mdTitle(t.title) + '](' + mdUrl(t.url) + ')';
    const sep = fmt === 'text' ? nl + nl : nl;
    if (!multiWindow) return list.map(line).join(sep) + (list.length ? nl : '');
    const groups = [];
    for (const t of list) {
      let g = groups[groups.length - 1];
      if (!g || g.n !== t.windowNumber) groups.push(g = { n: t.windowNumber, items: [] });
      g.items.push(t);
    }
    return groups.map(g => (fmt === 'text' ? 'Window ' + g.n : '## Window ' + g.n) + nl + nl + g.items.map(line).join(sep)).join(nl + nl) + nl;
  }

  function fileName(fmt, date) {
    const d = date || new Date();
    const p = n => String(n).padStart(2, '0');
    return 'tabs-' + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '.' + FORMATS[fmt].ext;
  }

  function summary(prep, scope) {
    const n = prep.tabs.length;
    const parts = [n + (n === 1 ? ' tab' : ' tabs') + ' ready'];
    if (prep.skippedDupes) parts.push(prep.skippedDupes + ' duplicate' + (prep.skippedDupes === 1 ? '' : 's') + ' left out');
    if (prep.skippedInternal) parts.push(prep.skippedInternal + ' browser page' + (prep.skippedInternal === 1 ? '' : 's') + ' left out');
    if (prep.skippedPrivate) parts.push(prep.skippedPrivate + ' tab' + (prep.skippedPrivate === 1 ? '' : 's') + ' from other window types left out');
    return parts.join(', ') + '.';
  }

  const api = { FORMATS, SCOPES, DEFAULTS, queryFor, isInternal, prepare, format, fileName, summary, csvCell, mdTitle, mdUrl };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TabListCore = api;
})(typeof self !== 'undefined' ? self : this);
