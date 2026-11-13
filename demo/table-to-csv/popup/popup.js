// Table to CSV popup. Opening the popup (a click on the toolbar button) grants activeTab; the popup
// then injects the read-only content/extract.js into that tab once, lists the page's tables with
// TableCsvCore, previews the chosen one and exports it as CSV or TSV with the chosen options.
// Copy uses the click on the Copy button (no clipboardWrite permission); Download uses an
// <a download> link to a local blob (no downloads permission). Options are not saved.
'use strict';
(function () {
  const Core = (typeof TableCsvCore !== 'undefined') ? TableCsvCore : self.TableCsvCore;
  const $ = id => document.getElementById(id);
  const OPTS = ['repeatMerged', 'combineHeaders', 'includeHidden', 'bom'];
  const PREVIEW_ROWS = 8, PREVIEW_COLS = 8;
  let analysis = null, current = null, built = null, output = '';

  function setStatus(text, cls) { $('status').textContent = text; $('status').className = cls || 'muted'; }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function options() {
    const o = { format: $('format').value };
    for (const k of OPTS) o[k] = !!$(k).checked;
    return o;
  }

  function renderPreview() {
    const box = $('preview'); clear(box);
    if (!built || !built.rows.length) return;
    const table = el('table');
    const cols = Math.min(built.cols, PREVIEW_COLS);
    built.rows.slice(0, PREVIEW_ROWS).forEach((r, y) => {
      const tr = el('tr');
      for (let x = 0; x < cols; x++) {
        const v = r[x] || '';
        const c = el(y < built.headerRows ? 'th' : 'td', '', v.length > 40 ? v.slice(0, 39) + '…' : v);
        c.title = v;
        tr.appendChild(c);
      }
      if (built.cols > cols) tr.appendChild(el('td', 'more', y ? '' : '+' + (built.cols - cols) + ' more columns'));
      table.appendChild(tr);
    });
    if (built.rows.length > PREVIEW_ROWS) {
      const tr = el('tr'); const td = el('td', 'more', '… ' + (built.rows.length - PREVIEW_ROWS).toLocaleString('en-US') + ' more rows');
      td.setAttribute('colspan', String(cols + (built.cols > cols ? 1 : 0))); tr.appendChild(td); table.appendChild(tr);
    }
    box.appendChild(table);
  }

  function renderNotes() {
    const ul = $('notes'); clear(ul);
    for (const n of Core.notes(analysis, current, built, options())) ul.appendChild(el('li', n.level, n.msg));
  }

  function refresh() {
    if (!analysis) return;
    current = analysis.tables.find(t => String(t.n) === $('table').value) || null;
    const o = options();
    built = current ? Core.build(current.raw, o) : null;
    output = built ? Core.format(built, o.format) : '';
    $('shape').textContent = built ? Core.shape(built) : '';
    renderPreview();
    renderNotes();
    $('copyBtn').disabled = $('downloadBtn').disabled = !output;
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(output);
      const tsv = $('format').value === 'tsv';
      setStatus('Copied ' + built.rows.length.toLocaleString('en-US') + ' rows as ' + (tsv ? 'TSV (paste into any spreadsheet).' : 'CSV.'), 'good');
    } catch (e) {
      setStatus('Copy was blocked by the browser. Use Download file instead.', 'warn');
    }
  }

  function download() {
    const o = options(), info = Core.FORMATS[o.format];
    const body = (o.format === 'csv' && o.bom ? '\uFEFF' : '') + output;
    const blob = new Blob([body], { type: info.mime + ';charset=utf-8' });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href; a.download = Core.fileName(analysis.page, current, o.format, new Date());
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10000);
    setStatus('Saved ' + a.download + ' to your downloads.', 'good');
  }

  async function init() {
    for (const [k, v] of Object.entries(Core.FORMATS)) { const o = el('option', '', v.label); o.value = k; $('format').appendChild(o); }
    $('format').value = Core.DEFAULTS.format;
    for (const k of OPTS) { $(k).checked = !!Core.DEFAULTS[k]; $(k).addEventListener('change', refresh); }
    $('format').addEventListener('change', refresh);
    $('table').addEventListener('change', refresh);
    $('copyBtn').addEventListener('click', copy);
    $('downloadBtn').addEventListener('click', download);
    let raw;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const res = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/extract.js'] });
      raw = res && res[0] && res[0].result;
      if (!raw) throw new Error('no result');
    } catch (e) {
      setStatus('This page can\'t be read. Browser pages (chrome://, the Chrome Web Store, PDF viewer) are off-limits to extensions.', 'bad');
      return;
    }
    analysis = Core.analyze(raw);
    for (const t of analysis.tables) { const o = el('option', '', Core.tableLine(t)); o.value = String(t.n); $('table').appendChild(o); }
    if (analysis.tables.length) {
      const first = analysis.tables.find(t => !t.hidden && t.rows) || analysis.tables[0];
      $('table').value = String(first.n);
      $('table').disabled = false;
    }
    refresh();
    setStatus(Core.summary(analysis), analysis.tables.length ? 'good' : 'warn');
  }
  self.__tableReady = init();
})();
