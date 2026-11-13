// Link Exporter popup. Opening the popup (a click on the toolbar button) grants activeTab; the popup then injects the
// read-only content/extract.js into that tab once, builds the link table with LinkCore and shows a preview. Copy uses
// the click on the Copy button (no clipboardWrite permission); Download uses an <a download> link to a local blob (no
// downloads permission). Options live only in the popup and are not saved.
'use strict';
(function () {
  const Core = (typeof LinkCore !== 'undefined') ? LinkCore : self.LinkCore;
  const $ = id => document.getElementById(id);
  let analysis = null, prepared = null, output = '';

  function setStatus(text, cls) { $('status').textContent = text; $('status').className = cls || 'muted'; }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function fill(select, map, value) {
    for (const [k, v] of Object.entries(map)) {
      const o = document.createElement('option'); o.value = k; o.textContent = typeof v === 'string' ? v : v.label; select.appendChild(o);
    }
    select.value = value;
  }
  function options() {
    return { filter: $('filter').value, format: $('format').value, dedupe: !!$('dedupe').checked, skipHidden: !!$('skipHidden').checked };
  }

  function renderCounts() {
    const ul = $('counts'); clear(ul);
    const c = analysis.counts;
    if (c.total) for (const [n, label] of [[c.total, 'links'], [c.internal, 'internal'], [c.external, 'external'], [c.flagged, 'nofollow etc.']]) {
      const li = document.createElement('li'); const b = document.createElement('b'); const s = document.createElement('span');
      b.textContent = String(n); s.textContent = label; li.appendChild(b); li.appendChild(s); ul.appendChild(li);
    }
    const notes = $('notes'); clear(notes);
    for (const n of Core.notes(analysis)) { const li = document.createElement('li'); li.className = n.level; li.textContent = n.msg; notes.appendChild(li); }
  }

  function refresh() {
    if (!analysis) return;
    const o = options();
    prepared = Core.prepare(analysis, o);
    output = prepared.rows.length ? Core.format(prepared, o.format) : '';
    $('preview').value = output;
    $('copyBtn').disabled = $('downloadBtn').disabled = !output;
    if (!analysis.counts.total) setStatus(Core.summary(analysis), 'warn');
    else if (!prepared.rows.length) setStatus('No links match these settings. ' + Core.summary(analysis), 'warn');
    else setStatus(Core.summary(analysis, prepared), 'muted');
  }

  async function copy() {
    const n = prepared.rows.length;
    try {
      await navigator.clipboard.writeText(output);
      setStatus('Copied ' + n + (n === 1 ? ' row' : ' rows') + ' to the clipboard.', 'good');
    } catch (e) {
      $('preview').focus(); $('preview').select();
      setStatus('Copy was blocked by the browser. The text is selected: press Ctrl+C (Cmd+C on Mac).', 'warn');
    }
  }

  function download() {
    const fmt = $('format').value, info = Core.FORMATS[fmt];
    // A byte-order mark lets Excel open the CSV/TSV as UTF-8 (accented anchor text stays readable).
    const body = (fmt === 'urls' ? '' : '\uFEFF') + output;
    const blob = new Blob([body], { type: info.mime + ';charset=utf-8' });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href; a.download = Core.fileName(analysis.page, fmt);
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10000);
    setStatus('Saved ' + a.download + ' to your downloads.', 'good');
  }

  async function init() {
    fill($('filter'), Core.FILTERS, Core.DEFAULTS.filter);
    fill($('format'), Core.FORMATS, Core.DEFAULTS.format);
    for (const id of ['filter', 'format', 'dedupe', 'skipHidden']) $(id).addEventListener('change', refresh);
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
    renderCounts();
    refresh();
  }
  self.__linkReady = init();
})();
