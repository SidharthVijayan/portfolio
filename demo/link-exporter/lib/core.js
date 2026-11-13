// Link Exporter core: pure logic, no chrome.* and no DOM. Loads in the popup (<script>) and in Node tests (require).
// analyze(raw) turns what content/extract.js read from the page into one row per link with its type (internal, external,
// same-page, email, phone, script, other), rel flags (nofollow, sponsored, ugc) and anchor text. prepare() applies the
// popup's filter / duplicate / hidden options, and format() writes CSV, TSV (for pasting into a spreadsheet) or a plain
// list of addresses. Spreadsheet formula characters at the start of a cell are neutralised in CSV and TSV.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LinkCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TYPES = { internal: 'Internal', external: 'External', 'same-page': 'Same page (#)', email: 'Email (mailto:)', phone: 'Phone (tel:)', script: 'Script (javascript:)', other: 'Other', invalid: 'Invalid address' };
  const FILTERS = {
    all: 'All links', internal: 'Internal only', external: 'External only',
    flagged: 'nofollow, sponsored or ugc only', other: 'Same page, email, phone and other',
  };
  const FORMATS = {
    csv: { label: 'CSV (spreadsheet file)', ext: 'csv', mime: 'text/csv' },
    tsv: { label: 'Tab-separated (paste into Sheets or Excel)', ext: 'tsv', mime: 'text/tab-separated-values' },
    urls: { label: 'Addresses only, one per line', ext: 'txt', mime: 'text/plain' },
  };
  const DEFAULTS = { filter: 'all', format: 'csv', dedupe: false, skipHidden: false };
  const COLUMNS = ['#', 'URL', 'Anchor text', 'Text source', 'Type', 'rel', 'nofollow', 'sponsored', 'ugc', 'Target', 'Hidden'];

  const hostOf = u => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch (e) { return ''; } };
  const noHash = u => String(u).split('#')[0];

  function classify(href, pageUrl) {
    if (!href) return 'invalid';
    let u;
    try { u = new URL(href); } catch (e) { return 'invalid'; }
    const p = u.protocol;
    if (p === 'mailto:') return 'email';
    if (p === 'tel:') return 'phone';
    if (p === 'javascript:') return 'script';
    if (p !== 'http:' && p !== 'https:') return 'other';
    if (pageUrl && u.hash && noHash(href) === noHash(pageUrl)) return 'same-page';
    const ph = hostOf(pageUrl);
    return ph && u.hostname.toLowerCase().replace(/^www\./, '') === ph ? 'internal' : 'external';
  }

  function relFlags(rel) {
    const t = String(rel || '').toLowerCase().split(/\s+/).filter(Boolean);
    return { nofollow: t.includes('nofollow'), sponsored: t.includes('sponsored'), ugc: t.includes('ugc') };
  }

  function analyze(raw) {
    raw = raw || {};
    const pageUrl = raw.url || '';
    const links = (raw.links || []).map((l, i) => {
      const type = classify(l.href, pageUrl);
      return Object.assign({ n: i + 1, url: l.href || l.raw || '', raw: l.raw || '', text: l.text || '', textFrom: l.textFrom || '',
        type, rel: l.rel || '', target: l.target || '', hidden: !!l.hidden, tag: l.tag || 'a' }, relFlags(l.rel));
    });
    const c = { total: links.length, internal: 0, external: 0, flagged: 0, other: 0, hidden: 0, noText: 0 };
    for (const l of links) {
      if (l.type === 'internal') c.internal++; else if (l.type === 'external') c.external++; else c.other++;
      if (l.nofollow || l.sponsored || l.ugc) c.flagged++;
      if (l.hidden) c.hidden++;
      if (!l.text) c.noText++;
    }
    c.unique = new Set(links.map(l => l.url)).size;
    return { page: pageUrl, title: raw.title || '', links, counts: c, truncated: !!raw.truncated, found: raw.total || links.length };
  }

  function matches(l, filter) {
    switch (filter) {
      case 'internal': return l.type === 'internal';
      case 'external': return l.type === 'external';
      case 'flagged': return l.nofollow || l.sponsored || l.ugc;
      case 'other': return l.type !== 'internal' && l.type !== 'external';
      default: return true;
    }
  }

  function prepare(analysis, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    let rows = analysis.links.filter(l => matches(l, o.filter) && !(o.skipHidden && l.hidden));
    const before = rows.length;
    if (o.dedupe) {
      const byUrl = new Map();
      for (const l of rows) {
        const k = l.url;
        if (!byUrl.has(k)) byUrl.set(k, Object.assign({}, l, { count: 1, texts: l.text ? [l.text] : [] }));
        else {
          const d = byUrl.get(k); d.count++;
          if (l.text && !d.texts.includes(l.text)) d.texts.push(l.text);
          d.nofollow = d.nofollow || l.nofollow; d.sponsored = d.sponsored || l.sponsored; d.ugc = d.ugc || l.ugc;
          if (l.rel && !d.rel.split(' ').includes(l.rel)) d.rel = d.rel ? d.rel + ' | ' + l.rel : l.rel;
          d.hidden = d.hidden && l.hidden;
        }
      }
      rows = [...byUrl.values()].map(d => Object.assign(d, { text: d.texts.join(' | ') }));
    }
    return { rows, dedupe: !!o.dedupe, removed: before - rows.length, filter: o.filter, skipHidden: !!o.skipHidden };
  }

  // A cell that starts with = + - @ (or tab / carriage return) could run as a formula in a spreadsheet: prefix an apostrophe.
  const guard = s => (/^[=+\-@\t\r]/.test(s) ? "'" + s : s);
  function csvCell(v) {
    const s = guard(String(v == null ? '' : v));
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  const tsvCell = v => guard(String(v == null ? '' : v).replace(/[\t\r\n]+/g, ' '));
  const yn = b => (b ? 'yes' : 'no');
  function rowValues(r, i) {
    return [i + 1, r.url, r.text, r.textFrom || 'none', TYPES[r.type] || r.type, r.rel, yn(r.nofollow), yn(r.sponsored), yn(r.ugc), r.target, yn(r.hidden)];
  }

  function format(prepared, fmt) {
    const rows = prepared.rows;
    if (fmt === 'urls') return rows.map(r => r.url).join('\n');
    const head = prepared.dedupe ? COLUMNS.concat('Times on page') : COLUMNS;
    const body = rows.map((r, i) => (prepared.dedupe ? rowValues(r, i).concat(r.count) : rowValues(r, i)));
    if (fmt === 'tsv') return [head, ...body].map(r => r.map(tsvCell).join('\t')).join('\n');
    return [head, ...body].map(r => r.map(csvCell).join(',')).join('\r\n');
  }

  const pad = n => String(n).padStart(2, '0');
  function fileName(pageUrl, fmt, date) {
    const d = date || new Date();
    const host = (hostOf(pageUrl) || 'page').replace(/[^a-z0-9.-]/g, '-');
    return 'links-' + host + '-' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '.' + (FORMATS[fmt] || FORMATS.csv).ext;
  }

  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : (/s$/.test(w) ? 'es' : 's'));
  function summary(analysis, prepared) {
    const c = analysis.counts;
    if (!c.total) return 'No links found on this page.';
    let s = 'Found ' + plural(c.total, 'link') + ' (' + c.unique + ' unique addresses).';
    if (prepared) {
      const n = prepared.rows.length;
      s += ' Exporting ' + plural(n, prepared.dedupe ? 'address' : 'link');
      s += prepared.filter && prepared.filter !== 'all' ? ' (' + FILTERS[prepared.filter].toLowerCase() + ').' : '.';
    }
    return s;
  }

  function notes(analysis) {
    const out = [], c = analysis.counts;
    if (analysis.truncated) out.push({ level: 'warn', msg: 'This page has ' + analysis.found + ' links; only the first ' + c.total + ' are exported.' });
    if (c.noText) out.push({ level: 'warn', msg: plural(c.noText, 'link') + ' had no anchor text, image alt, aria-label or title (Text source: none).' });
    if (c.hidden) out.push({ level: 'muted', msg: plural(c.hidden, 'link') + ' are in the page but not currently shown (Hidden: yes), for example in a closed menu.' });
    const bad = analysis.links.filter(l => l.type === 'invalid').length;
    if (bad) out.push({ level: 'warn', msg: plural(bad, 'link') + ' had an address the browser could not read (Type: Invalid address).' });
    return out;
  }

  return { TYPES, FILTERS, FORMATS, DEFAULTS, COLUMNS, classify, relFlags, analyze, prepare, format, csvCell, tsvCell, fileName, summary, notes, hostOf };
});
