// Image Weight & CLS Auditor popup. Opening the popup (a click on the toolbar button) grants
// activeTab; the popup then injects the read-only content/extract.js into that tab once, turns the
// result into findings with ImageAuditCore and lists them by check (layout shift, oversized and
// heavy files, lazy loading). Copy uses the click on the Copy button (no clipboardWrite
// permission); Download uses an <a download> link to a local blob (no downloads permission).
// The format is not saved.
'use strict';
(function () {
  const Core = (typeof ImageAuditCore !== 'undefined') ? ImageAuditCore : self.ImageAuditCore;
  const $ = id => document.getElementById(id);
  let analysis = null, output = '';

  function setStatus(text, cls) { $('status').textContent = text; $('status').className = cls || 'muted'; }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

  function renderCounts() {
    const ul = $('counts'); clear(ul);
    if (analysis.mode !== 'web') { ul.className = ''; return; }
    const cells = [
      [analysis.counts.dims, 'images without a size'],
      [analysis.counts.size, 'images too big'],
      [analysis.counts.lazy, 'lazy-loading issues'],
    ];
    ul.className = 'n' + cells.length;
    for (const [n, label] of cells) {
      const li = el('li'); li.appendChild(el('b', n ? 'warn' : 'good', String(n))); li.appendChild(el('span', '', label)); ul.appendChild(li);
    }
    const notes = $('notes'); clear(notes);
    for (const n of Core.notes(analysis)) notes.appendChild(el('li', n.level, n.msg));
  }

  function renderGroups() {
    const box = $('groups'); clear(box);
    if (analysis.mode !== 'web' || !analysis.images) return;
    for (const [key, title] of Object.entries(Core.CHECKS)) {
      const list = analysis.findings.filter(x => x.check === key);
      const sec = el('section', 'group');
      sec.appendChild(el('h2', '', title + (list.length ? ' (' + list.length + ')' : '')));
      if (!list.length) {
        sec.appendChild(el('div', 'okline', key === 'dims' ? 'Every image keeps its space while it loads.' :
          key === 'size' ? 'No image is much bigger than it is shown, and none is over 200 KB.' :
          'Lazy loading is set right for every image.'));
      }
      for (const x of list) {
        const row = el('div', 'finding ' + x.level);
        const head = el('div', 'el');
        head.appendChild(el('span', 'tag', Core.SEVERITY[x.level]));
        head.appendChild(el('span', '', x.element));
        if (x.label || x.size) head.appendChild(el('small', '', (x.label ? ' "' + x.label + '"' : '') + (x.size ? ' · ' + x.size : '')));
        row.appendChild(head);
        row.appendChild(el('div', 'detail', x.detail));
        row.appendChild(el('div', 'fix', 'Fix: ' + x.fix));
        sec.appendChild(row);
      }
      box.appendChild(sec);
    }
  }

  function refresh() {
    if (!analysis) return;
    output = analysis.mode === 'web' && analysis.images ? Core.format(analysis, $('format').value, new Date()) : '';
    $('copyBtn').disabled = $('downloadBtn').disabled = !output;
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(output);
      setStatus('Copied the ' + ($('format').value === 'csv' ? 'CSV' : 'report') + ' to the clipboard.', 'good');
    } catch (e) {
      setStatus('Copy was blocked by the browser. Use Download file instead.', 'warn');
    }
  }

  function download() {
    const fmt = $('format').value, info = Core.FORMATS[fmt];
    const body = (fmt === 'csv' ? '\uFEFF' : '') + output;
    const blob = new Blob([body], { type: info.mime + ';charset=utf-8' });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href; a.download = Core.fileName(analysis.page, fmt, new Date());
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10000);
    setStatus('Saved ' + a.download + ' to your downloads.', 'good');
  }

  async function init() {
    for (const [k, v] of Object.entries(Core.FORMATS)) { const o = el('option', '', v.label); o.value = k; $('format').appendChild(o); }
    $('format').value = 'report';
    $('format').addEventListener('change', refresh);
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
    renderGroups();
    refresh();
    setStatus(Core.summary(analysis), Core.level(analysis));
  }
  self.__auditReady = init();
})();
