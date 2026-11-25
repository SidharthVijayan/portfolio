// Keyword Density Checker popup. Opening the popup (a click on the toolbar button) grants activeTab; the popup then
// injects the read-only content/extract.js into that tab once, to read the page's main text (or the selection),
// title and H1 headings. All counting happens here with lib/core.js. "Copy table" uses the clipboard on that button
// press (no clipboardWrite permission); "Download CSV" saves a file through a normal download link (no downloads
// permission). Nothing is saved and nothing is sent anywhere.
'use strict';
(function () {
  const Core = (typeof KDCore !== 'undefined') ? KDCore : self.KDCore;
  const $ = id => document.getElementById(id);
  const PAGE_SIZE = 20, MAX_ROWS = 200;
  const LISTS = { 1: 'words', 2: 'bigrams', 3: 'trigrams' };
  let page = null, res = null, n = 1, shown = PAGE_SIZE;

  function setStatus(text, cls) { $('status').textContent = text; $('status').className = cls || 'muted'; }
  const fmt = x => x.toLocaleString('en-US');
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  function analyze() {
    res = Core.analyze(page, { stop: $('stop').checked, plurals: $('plurals').checked });
    $('stats').hidden = false;
    $('nWords').textContent = fmt(res.totalWords);
    $('nUnique').textContent = fmt(res.uniqueWords);
    $('nStop').textContent = res.stopShare + '%';
    for (const k of [1, 2, 3]) $('c' + k).textContent = String(res[LISTS[k]].length);
    setStatus(Core.summary(res), res.totalWords ? 'muted' : 'warn');
    $('notes').textContent = res.notes.join(' ');
    $('copyBtn').disabled = $('csvBtn').disabled = !res.totalWords;
    $('focus').disabled = $('focusBtn').disabled = !res.totalWords;
    render();
    if ($('focus').value.trim()) check();
  }

  function render() {
    for (const b of document.querySelectorAll('#tabs button')) { const on = b.dataset.n === String(n); b.className = on ? 'on' : ''; b.setAttribute('aria-selected', String(on)); }
    const rows = res[LISTS[n]];
    const tbody = $('rows');
    tbody.textContent = '';
    const top = rows.length ? rows[0].density : 0;
    for (const r of rows.slice(0, Math.min(shown, MAX_ROWS))) {
      const tr = el('tr');
      const term = el('td', 'term', r.label);
      if (r.inTitle) { const t = el('span', 'tag t', 'T'); t.title = 'In the page title'; term.appendChild(t); }
      if (r.inH1) { const h = el('span', 'tag h', 'H1'); h.title = 'In a main (H1) heading'; term.appendChild(h); }
      const dens = el('td', 'num');
      const bar = el('span', 'bar'); bar.style.width = Math.max(2, Math.round(40 * r.density / (top || 1))) + 'px';
      dens.append(bar, document.createTextNode(r.density.toFixed(2) + '%'));
      tr.append(term, el('td', 'num', String(r.count)), dens);
      tbody.appendChild(tr);
    }
    $('table').hidden = !rows.length;
    $('empty').hidden = !!rows.length;
    $('empty').textContent = !res.totalWords ? '' : n === 1 ? 'No words to list.' : `No ${n}-word phrase is used more than once.`;
    const more = Math.min(rows.length, MAX_ROWS) - shown;
    $('moreBtn').hidden = more <= 0;
    $('moreBtn').textContent = `Show ${Math.min(more, PAGE_SIZE)} more`;
  }

  function check() {
    const f = Core.focus(res, $('focus').value);
    const out = $('focusOut');
    out.textContent = '';
    if (!f) { out.hidden = true; return; }
    out.hidden = false;
    out.className = 'card ' + f.level;
    out.append(el('div', 'big', `“${f.phrase}”: ${f.count} ${f.count === 1 ? 'time' : 'times'} · ${f.density.toFixed(2)}%`), el('p', f.level, f.verdict));
    const ul = el('ul');
    const item = (ok, text) => ul.appendChild(el('li', ok ? 'y' : 'n', text));
    item(f.inTitle, 'Page title');
    item(f.inH1, 'H1 heading');
    item(f.inFirst100, 'First 100 words');
    item(f.inHeadings > 0, f.inHeadings > 0 ? `${f.inHeadings} subheading${f.inHeadings === 1 ? '' : 's'}` : 'Subheadings');
    out.append(ul, el('p', 'muted', f.note));
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(Core.toTable(res, n));
      setStatus(`Copied the ${n === 1 ? 'words' : n + '-word phrases'} table (${res[LISTS[n]].length} rows). Paste it into a spreadsheet.`, 'good');
    } catch (e) {
      setStatus('Copy was blocked by the browser. Try again.', 'warn');
    }
  }
  function download() {
    const name = Core.fileName(res.url);
    const url = URL.createObjectURL(new Blob([Core.toCsv(res)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    setStatus('Saved ' + name + ' to your downloads.', 'good');
  }

  async function init() {
    for (const b of document.querySelectorAll('#tabs button')) b.addEventListener('click', () => { n = Number(b.dataset.n); shown = PAGE_SIZE; if (res) render(); });
    $('moreBtn').addEventListener('click', () => { shown += PAGE_SIZE; render(); });
    $('stop').addEventListener('change', () => { if (page) analyze(); });
    $('plurals').addEventListener('change', () => { if (page) analyze(); });
    $('focusForm').addEventListener('submit', e => { e.preventDefault(); if (res) check(); });
    $('copyBtn').addEventListener('click', copy);
    $('csvBtn').addEventListener('click', download);
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const out = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/extract.js'] });
      page = out && out[0] && out[0].result;
      if (!page) throw new Error('no result');
    } catch (e) {
      setStatus('Chrome doesn\'t let extensions read this page (chrome:// pages, the Chrome Web Store, the PDF viewer). Open a normal web page and try again.', 'bad');
      $('table').hidden = true;
      for (const x of document.querySelectorAll('.opt input')) x.disabled = true;
      return;
    }
    analyze();
  }
  self.__kdReady = init();
})();
