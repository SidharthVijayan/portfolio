// Table to CSV core: pure functions, no DOM, no chrome.* (unit-tested in Node).
// Takes what content/extract.js returned (every <table> with its rows and cells) and:
//   analyze() - lists the tables with a name (caption, aria-label, nearest heading or header
//               cells), their size and flags; layout tables (role="presentation"/"none") skipped
//   build()   - turns one table into a clean grid: colspan/rowspan expanded (value repeated or
//               kept in the first cell only), ragged rows padded, whitespace tidied, hidden rows
//               and empty rows left out, header rows found (thead, or leading rows of <th>), and
//               multi-row headers optionally combined into one ("2025 / Q1")
//   format()  - writes CSV (RFC 4180, CRLF) or TSV, neutralising spreadsheet formulas while
//               leaving plain numbers such as -4.50 or +12% alone
// Does not look at links (Link Exporter does that), SEO, headings structure or AI-readiness.
'use strict';
(function (root) {
  const MAX_COLS = 500, MAX_TABLES = 200, MAX_ROWS = 10000;
  const FORMATS = {
    csv: { label: 'CSV (comma-separated)', ext: 'csv', mime: 'text/csv' },
    tsv: { label: 'TSV (tab-separated, pastes into sheets)', ext: 'tsv', mime: 'text/tab-separated-values' },
  };
  const DEFAULTS = { format: 'csv', repeatMerged: true, includeHidden: false, combineHeaders: false, bom: true };
  const plural = (n, one, many) => n.toLocaleString('en-US') + ' ' + (n === 1 ? one : (many || one + 's'));

  function hostOf(url) {
    try { return new URL(url).hostname.toLowerCase().replace(/\.$/, ''); } catch (e) { return ''; }
  }
  // Tidy one cell: non-breaking and zero-width spaces, runs of spaces and line breaks -> one space.
  function clean(s) {
    return String(s == null ? '' : s).replace(/[\u200b-\u200d\u2060\ufeff]/g, '').replace(/\u00a0/g, ' ')
      .split(/\r?\n|\r/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' ');
  }
  const short = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

  // Expand colspan/rowspan into a full grid (HTML table model). rowspan="0" and long rowspans stop
  // at the end of their row group (thead / tbody / tfoot).
  function grid(t) {
    const rows = t.rows || [];
    const g = rows.map(() => []);
    const end = rows.map(() => rows.length);
    for (let y = rows.length - 1; y >= 0; y--) end[y] = (y + 1 < rows.length && rows[y + 1].g === rows[y].g) ? end[y + 1] : y + 1;
    let merged = 0;
    rows.forEach((row, y) => {
      let x = 0;
      for (const c of row.cells || []) {
        while (g[y][x]) x++;
        if (x >= MAX_COLS) break;
        const cs = Math.max(1, Math.min(c.cs || 1, MAX_COLS - x));
        const rs = c.rs === 0 ? end[y] - y : Math.max(1, Math.min(c.rs || 1, end[y] - y));
        if (cs > 1 || rs > 1) merged++;
        const text = clean(c.t);
        for (let dy = 0; dy < rs; dy++) {
          for (let dx = 0; dx < cs; dx++) {
            if (!g[y + dy][x + dx]) g[y + dy][x + dx] = { text, h: !!c.h, origin: !dy && !dx };
          }
        }
        x += cs;
      }
    });
    const cols = g.reduce((m, r) => Math.max(m, r.length), 0);
    return { g, cols, merged };
  }

  function build(t, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    const { g, cols, merged } = grid(t);
    const all = g.map((r, y) => ({
      cells: Array.from({ length: cols }, (_, x) => r[x] || { text: '', h: false, origin: true, pad: true }),
      hidden: !!t.rows[y].hidden, sec: t.rows[y].sec,
    }));
    const shown = o.includeHidden ? all : all.filter(r => !r.hidden);
    const kept = shown.filter(r => r.cells.some(c => c.text));
    // Header rows: the <thead>, or (with no <thead>) the leading rows made only of <th> cells.
    let headerRows = 0;
    const hasThead = kept.some(r => r.sec === 'thead');
    if (hasThead) { while (headerRows < kept.length && kept[headerRows].sec === 'thead') headerRows++; }
    else {
      const allTh = r => r.cells.some(c => c.h && !c.pad) && r.cells.every(c => c.pad || c.h || !c.text);
      while (headerRows < kept.length && allTh(kept[headerRows])) headerRows++;
      if (headerRows === kept.length) headerRows = 0; // every row is <th>: no separate header
    }
    const value = c => (o.repeatMerged || c.origin ? c.text : '');
    let rows = kept.map(r => r.cells.map(value));
    let combined = false;
    if (o.combineHeaders && headerRows > 1) {
      const head = Array.from({ length: cols }, (_, x) => {
        const parts = [];
        for (let y = 0; y < headerRows; y++) { const v = kept[y].cells[x].text; if (v && parts[parts.length - 1] !== v) parts.push(v); }
        return parts.join(' / ');
      });
      rows = [head, ...rows.slice(headerRows)];
      headerRows = 1; combined = true;
    }
    return { rows, cols, headerRows, merged, combined, hiddenLeftOut: all.length - shown.length, emptyDropped: shown.length - kept.length, hiddenRows: all.filter(r => r.hidden).length };
  }

  function nameOf(t, b) {
    if (t.caption) return { label: t.caption, from: 'caption' };
    if (t.aria) return { label: t.aria, from: 'aria-label' };
    if (t.heading) return { label: t.heading, from: 'heading' };
    if (b && b.headerRows) {
      const h = b.rows[0].filter((v, i, a) => v && a.indexOf(v) === i).slice(0, 3).join(', ');
      if (h) return { label: h, from: 'header' };
    }
    return { label: 'Table ' + t.n, from: 'number' };
  }

  function analyze(raw) {
    const r = raw || {};
    const tables = [];
    const num = new Map(); // tables are numbered in page order, layout tables not counted
    let layout = 0;
    for (const t of r.tables || []) {
      if (t.layout) { layout++; continue; }
      num.set(t.n, num.size + 1);
      const n = num.get(t.n);
      const b = build(t);
      const nm = nameOf(Object.assign({}, t, { n }), b);
      tables.push({ n, label: short(nm.label, 80), labelFrom: nm.from, rows: b.rows.length, cols: b.cols, headerRows: b.headerRows,
        merged: b.merged, hidden: !!t.hidden, nestedIn: num.get(t.nestedIn) || 0, nestedCells: t.nestedCells || 0, hiddenRows: b.hiddenRows,
        rowsTruncated: !!t.rowsTruncated, totalRows: t.totalRows || 0, raw: t });
    }
    return { page: r.url || '', host: hostOf(r.url), title: r.title || '', tables, layout, total: r.total || 0, truncated: !!r.truncated };
  }

  function tableLine(t) {
    let s = t.n + '. ' + t.label + ' (' + plural(t.rows, 'row') + ' × ' + plural(t.cols, 'column') + ')';
    if (t.hidden) s += ' · not shown';
    if (t.nestedIn) s += ' · inside table ' + t.nestedIn;
    return s;
  }
  function summary(a) {
    if (!a.tables.length) return 'No tables found on this page' + (a.layout ? ' (only ' + plural(a.layout, 'layout table') + ', skipped).' : '.');
    return 'Found ' + plural(a.tables.length, 'table') + ' on this page.';
  }
  function shape(b) {
    if (!b.rows.length) return 'This table has no text to export.';
    return 'Exporting ' + plural(b.rows.length, 'row') + ' × ' + plural(b.cols, 'column') + (b.headerRows ? ' (' + plural(b.headerRows, 'header row') + ').' : ' (no header row found).');
  }

  function notes(a, t, b, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    const out = [];
    if (t && b) {
      if (t.hidden) out.push({ level: 'muted', msg: 'This table is not shown on the page right now (for example in a closed tab or menu).' });
      if (b.hiddenLeftOut) out.push({ level: 'muted', msg: plural(b.hiddenLeftOut, 'hidden row') + ' left out. Tick "Include hidden rows" to keep ' + (b.hiddenLeftOut === 1 ? 'it' : 'them') + '.' });
      else if (o.includeHidden && b.hiddenRows) out.push({ level: 'muted', msg: plural(b.hiddenRows, 'hidden row') + ' included.' });
      if (b.emptyDropped) out.push({ level: 'muted', msg: plural(b.emptyDropped, 'empty row') + ' left out.' });
      if (b.merged) out.push({ level: 'muted', msg: plural(b.merged, 'merged cell') + ' (colspan/rowspan) expanded; ' + (o.repeatMerged ? 'the value is repeated in every cell it covers.' : 'the value is kept in the first cell only.') });
      if (b.headerRows > 1 && !b.combined) out.push({ level: 'muted', msg: 'This table has ' + b.headerRows + ' header rows. Tick "Combine header rows" to merge them into one.' });
      if (b.combined) out.push({ level: 'muted', msg: 'Header rows combined into one (for example "2025 / Q1").' });
      if (t.nestedCells) out.push({ level: 'warn', msg: plural(t.nestedCells, 'table') + ' inside cells of this table ' + (t.nestedCells === 1 ? 'is' : 'are') + ' left out of it; choose ' + (t.nestedCells === 1 ? 'it' : 'them') + ' separately in the list.' });
      if (t.rowsTruncated) out.push({ level: 'warn', msg: 'Very long table: only the first ' + MAX_ROWS.toLocaleString('en-US') + ' rows were read (of ' + t.totalRows.toLocaleString('en-US') + ').' });
      if (b.cols >= MAX_COLS) out.push({ level: 'warn', msg: 'Very wide table: only the first ' + MAX_COLS + ' columns were kept.' });
    }
    if (a.layout && a.tables.length) out.push({ level: 'muted', msg: plural(a.layout, 'layout table') + ' (role="presentation") skipped.' });
    if (a.truncated) out.push({ level: 'warn', msg: 'Only the first ' + MAX_TABLES + ' tables were read (of ' + a.total.toLocaleString('en-US') + ').' });
    return out;
  }

  // A cell starting with = + - @ (or tab / CR) could run as a formula in a spreadsheet: prefix an
  // apostrophe. Plain numbers (-4.50, +12%, -1,200) and a lone "-" (no value) are left alone.
  const NUMBER = /^[+-]?(\d[\d,]*(\.\d+)?|\.\d+)%?$/;
  const guard = s => (/^[=+\-@\t\r]/.test(s) && !NUMBER.test(s) && s !== '-' ? "'" + s : s);
  function csvCell(v) {
    const s = guard(String(v == null ? '' : v));
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  const tsvCell = v => guard(String(v == null ? '' : v).replace(/[\t\r\n]+/g, ' '));
  function format(b, fmt) {
    const rows = b.rows || [];
    if (!rows.length) return '';
    if (fmt === 'tsv') return rows.map(r => r.map(tsvCell).join('\t')).join('\n') + '\n';
    return rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }

  const pad = n => String(n).padStart(2, '0');
  function slug(s) {
    return String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  }
  function fileName(page, t, fmt, now) {
    const d = now instanceof Date ? now : new Date();
    const host = (hostOf(page) || 'page').replace(/[^a-z0-9.-]/g, '-');
    const name = slug(t && t.label) || 'table-' + ((t && t.n) || 1);
    return 'table-' + host + '-' + name + '-' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '.' + (FORMATS[fmt] || FORMATS.csv).ext;
  }

  const api = { MAX_COLS, MAX_TABLES, MAX_ROWS, FORMATS, DEFAULTS, hostOf, clean, grid, build, nameOf, analyze, tableLine, summary, shape, notes, csvCell, tsvCell, format, slug, fileName };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TableCsvCore = api;
})(typeof self !== 'undefined' ? self : globalThis);
