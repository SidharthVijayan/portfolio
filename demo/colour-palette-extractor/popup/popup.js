// Colour Palette Extractor popup. Opening the popup (a click on the toolbar button) grants
// activeTab; the popup then injects the read-only content/extract.js into that tab once, groups
// the colours with ColourCore and shows hex swatches. Copy uses the click on the Copy button
// (no clipboardWrite permission); Download uses an <a download> link to a local blob (no
// downloads permission). Per-swatch Copy puts that hex on the clipboard. Format is not saved.
'use strict';
(function () {
  const Core = (typeof ColourCore !== 'undefined') ? ColourCore : self.ColourCore;
  const $ = id => document.getElementById(id);
  let analysis = null, output = '';

  function setStatus(text, cls) { $('status').textContent = text; $('status').className = cls || 'muted'; }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

  function renderCounts() {
    const ul = $('counts'); clear(ul);
    if (analysis.mode !== 'web') { ul.className = ''; return; }
    const cells = [
      [analysis.colourCount, 'colours'],
      [analysis.observations, 'colour uses'],
    ];
    ul.className = 'n' + cells.length;
    for (const [n, label] of cells) {
      const li = el('li'); li.appendChild(el('b', '', String(n))); li.appendChild(el('span', '', label)); ul.appendChild(li);
    }
    const notes = $('notes'); clear(notes);
    for (const n of Core.notes(analysis)) notes.appendChild(el('li', n.level, n.msg));
  }

  function renderGroups() {
    const box = $('groups'); clear(box);
    if (!analysis.swatches.length) return;
    const sec = el('section', 'group');
    sec.appendChild(el('h2', '', 'Swatches (' + analysis.colourCount + ')'));
    for (const s of analysis.swatches) {
      const row = el('div', 'swatch');
      const chip = el('div', 'chip');
      chip.style.background = s.hex;
      chip.title = s.hex;
      row.appendChild(chip);
      const info = el('div', 'info');
      info.appendChild(el('div', 'hex', s.hex));
      info.appendChild(el('div', 'rgb', s.rgb));
      info.appendChild(el('div', 'meta', Core.roleLabel(s) +
        (s.tags.length ? ' · ' + s.tags.join(', ') : '')));
      row.appendChild(info);
      const btn = el('button', 'swatch-copy', 'Copy');
      btn.type = 'button';
      btn.setAttribute('data-hex', s.hex);
      btn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(s.hex);
          setStatus('Copied ' + s.hex + ' to the clipboard.', 'good');
        } catch (e) {
          setStatus('Copy was blocked by the browser. Use Download file instead.', 'warn');
        }
      });
      row.appendChild(btn);
      sec.appendChild(row);
    }
    box.appendChild(sec);
  }

  function refresh() {
    if (!analysis) return;
    output = analysis.observations ? Core.format(analysis, $('format').value, new Date()) : '';
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
  self.__colourReady = init();
})();
