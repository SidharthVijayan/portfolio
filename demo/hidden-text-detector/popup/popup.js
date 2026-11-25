// Hidden Text Detector popup. Opening the popup (a click on the toolbar button) grants activeTab;
// the popup then injects the read-only content/extract.js into that tab once, groups what it finds
// with HiddenTextCore and lists each block of hidden text with how it is hidden. "Copy report" uses
// the click on the button (no clipboardWrite permission); "Download CSV" saves a file through a
// normal download link (no downloads permission). Nothing is saved.
'use strict';
(function () {
  const Core = (typeof HiddenTextCore !== 'undefined') ? HiddenTextCore : self.HiddenTextCore;
  const $ = id => document.getElementById(id);
  let res = null, group = 'all';

  function setStatus(text, cls) { $('status').textContent = text; $('status').className = cls || 'muted'; }
  function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

  function render() {
    const list = $('list');
    while (list.firstChild) list.removeChild(list.firstChild);
    const items = Core.filter(res, group);
    $('groupNote').textContent = group === 'all' ? '' : Core.GROUPS[group].note;
    for (const it of items) {
      const li = el('li', it.group);
      const tags = el('div', 'tags');
      for (const r of it.reasons) {
        const t = el('span', 'tag ' + Core.CODES[r.code].group, r.label);
        if (r.detail) t.title = r.detail;
        tags.appendChild(t);
      }
      li.appendChild(tags);
      li.appendChild(el('div', 'text', Core.snippet(it.text)));
      const meta = [`${it.words} word${it.words === 1 ? '' : 's'}`];
      if (it.links.length) meta.push(`${it.links.length} link${it.links.length === 1 ? '' : 's'}`);
      meta.push(...it.reasons.map(r => r.detail).filter(Boolean), it.path);
      li.appendChild(el('div', 'meta', meta.join(' · ')));
      if (it.links.length) li.appendChild(el('div', 'links', it.links.slice(0, 5).join(' ') + (it.links.length > 5 ? ` +${it.links.length - 5} more` : '')));
      list.appendChild(li);
    }
    for (const b of document.querySelectorAll('#filters .chip')) b.setAttribute('aria-pressed', String(b.dataset.group === group));
  }

  function show(r) {
    res = r;
    $('nAll').textContent = String(res.totals.blocks);
    $('nCloak').textContent = String(res.byGroup.cloak);
    $('nCss').textContent = String(res.byGroup.css);
    $('nFine').textContent = String(res.byGroup.fine);
    $('copyBtn').disabled = $('csvBtn').disabled = !res.totals.blocks;
    setStatus(Core.summary(res), res.byGroup.cloak ? 'bad' : res.byGroup.css ? 'warn' : 'good');
    render();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(Core.report(res));
      setStatus('Copied the report (' + res.totals.blocks + ' blocks). Paste it anywhere.', 'good');
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
    $('copyBtn').addEventListener('click', copy);
    $('csvBtn').addEventListener('click', download);
    for (const b of document.querySelectorAll('#filters .chip')) b.addEventListener('click', () => { group = b.dataset.group; if (res) render(); });
    let page;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const out = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/extract.js'] });
      page = out && out[0] && out[0].result;
      if (!page) throw new Error('no result');
    } catch (e) {
      setStatus('This page can\'t be read. Browser pages (chrome://, the Chrome Web Store, PDF viewer) are off-limits to extensions.', 'bad');
      return;
    }
    show(Core.analyze(page));
  }
  self.__htReady = init();
})();
