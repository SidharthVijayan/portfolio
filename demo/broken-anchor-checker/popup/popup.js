// Broken Anchor Checker popup. Opening the popup (a click on the toolbar button) grants activeTab; the
// popup then injects the read-only content/extract.js into that tab once, checks every same-page #link
// with AnchorCore and lists each target with the links that use it. "Copy report" uses the click on the
// button (no clipboardWrite permission); "Download CSV" saves a file through a normal download link (no
// downloads permission). Nothing is saved.
'use strict';
(function () {
  const Core = (typeof AnchorCore !== 'undefined') ? AnchorCore : self.AnchorCore;
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
      const head = el('div', 'tags');
      head.appendChild(el('span', 'tag ' + it.group, it.label));
      head.appendChild(el('span', 'frag', Core.shownFrag(it)));
      li.appendChild(head);
      if (it.suggestion) li.appendChild(el('div', 'fix', it.suggestion.text));
      if (it.detail) li.appendChild(el('div', 'detail', it.detail));
      const n = it.links.length;
      const texts = it.links.slice(0, 4).map(l => '"' + (l.text || '(no text)') + '"').join(', ') + (n > 4 ? ` +${n - 4} more` : '');
      li.appendChild(el('div', 'text', `${n} link${n === 1 ? '' : 's'}: ${texts}`));
      const meta = ['Link: ' + it.links[0].path];
      if (it.target) meta.push('Target: ' + it.target);
      li.appendChild(el('div', 'meta', meta.join(' · ')));
      list.appendChild(li);
    }
    for (const b of document.querySelectorAll('#filters .chip')) b.setAttribute('aria-pressed', String(b.dataset.group === group));
  }

  function show(r) {
    res = r;
    $('nAll').textContent = String(res.items.length);
    $('nBroken').textContent = String(res.byGroup.broken);
    $('nCheck').textContent = String(res.byGroup.check);
    $('nOk').textContent = String(res.byGroup.ok);
    $('nSkip').textContent = String(res.byGroup.skip);
    $('copyBtn').disabled = $('csvBtn').disabled = !res.items.length;
    setStatus(Core.summary(res), res.byGroup.broken ? 'bad' : res.byGroup.check ? 'warn' : 'good');
    render();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(Core.report(res));
      setStatus('Copied the report (' + res.items.length + ' targets). Paste it anywhere.', 'good');
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
  self.__anchorReady = init();
})();
