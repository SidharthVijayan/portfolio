// Citation Copier popup. Opening the popup (a click on the toolbar button) grants activeTab; the popup then injects the
// read-only content/extract.js into that tab once, builds the citation with CitationCore and shows it. Copy uses the
// click on the Copy button (no clipboardWrite permission): formatted (italics) + plain text, falling back to plain text,
// then to selecting the citation for Ctrl+C. Edits and options live only in the popup and are not saved.
'use strict';
(function () {
  const Core = (typeof CitationCore !== 'undefined') ? CitationCore : self.CitationCore;
  const $ = id => document.getElementById(id);
  const F = { authors: 'fAuthors', title: 'fTitle', site: 'fSite', date: 'fDate', url: 'fUrl' };
  let base = null, meta = null, current = null;

  function setStatus(text, cls) { $('status').textContent = text; $('status').className = cls || 'muted'; }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function render() {
    if (!meta) return;
    const opts = Core.normalizeOptions({ style: $('style').value, accessDate: $('accessDate').checked });
    current = Core.cite(meta, opts.style, opts);
    const box = $('citation');
    clear(box);
    for (const s of current.segments) {
      if (s.italic) { const i = document.createElement('i'); i.textContent = s.text; box.appendChild(i); }
      else box.appendChild(document.createTextNode(s.text));
    }
    const list = $('notes');
    clear(list);
    for (const n of Core.notes(meta)) { const li = document.createElement('li'); li.className = n.level; li.textContent = n.msg; list.appendChild(li); }
    const src = Core.sourceSummary(meta);
    $('sources').textContent = src ? 'Found: ' + src : '';
    $('copyBtn').disabled = !current.text;
  }

  function fillFields(m) {
    const f = Core.toFields(m);
    for (const [k, id] of Object.entries(F)) $(id).value = f[k];
    $('fSiteLabel').textContent = m.kind === 'journal' ? 'Journal' : 'Website';
  }
  function onEdit() {
    if (!base) return;
    const f = {};
    for (const [k, id] of Object.entries(F)) f[k] = $(id).value;
    meta = Core.applyFields(base, f);
    render();
  }

  async function copy() {
    if (!current || !current.text) return;
    try {
      if (typeof ClipboardItem === 'undefined' || !navigator.clipboard.write) throw new Error('no rich clipboard');
      await navigator.clipboard.write([new ClipboardItem({
        'text/plain': new Blob([current.text], { type: 'text/plain' }),
        'text/html': new Blob([current.html], { type: 'text/html' }),
      })]);
      return setStatus(`Copied the ${Core.STYLES[$('style').value]} citation. Italics are kept when you paste into a document.`, 'good');
    } catch (e) { /* fall back to plain text */ }
    try {
      await navigator.clipboard.writeText(current.text);
      setStatus(`Copied the ${Core.STYLES[$('style').value]} citation as plain text.`, 'good');
    } catch (e) {
      const box = $('citation'), range = document.createRange();
      range.selectNodeContents(box);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
      box.focus();
      setStatus('Copy was blocked by the browser. The citation is selected: press Ctrl+C (Cmd+C on Mac).', 'warn');
    }
  }

  async function init() {
    for (const [k, label] of Object.entries(Core.STYLES)) { const o = document.createElement('option'); o.value = k; o.textContent = label; $('style').appendChild(o); }
    $('style').value = Core.DEFAULTS.style;
    $('accessDate').checked = Core.DEFAULTS.accessDate;
    $('style').addEventListener('change', render);
    $('accessDate').addEventListener('change', render);
    for (const id of Object.values(F)) $(id).addEventListener('input', onEdit);
    $('resetBtn').addEventListener('click', () => { if (!base) return; meta = base; fillFields(base); render(); setStatus('Your edits were undone.'); });
    $('copyBtn').addEventListener('click', copy);
    let data;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const [injection] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/extract.js'] });
      data = injection && injection.result;
      if (!data || !data.url) throw new Error('nothing returned');
    } catch (e) {
      for (const id of ['copyBtn', 'style', 'accessDate', ...Object.values(F), 'resetBtn']) $(id).disabled = true;
      return setStatus('This page can\'t be read. Browser pages (chrome://, the Chrome Web Store, PDF viewer) are off-limits to extensions.', 'bad');
    }
    base = meta = Core.normalize(data);
    fillFields(base);
    render();
    setStatus(meta.kind === 'journal' ? 'Journal article found. Pick a style and copy.' : 'Pick a style and copy. Check the notes below.');
  }
  self.__citationReady = init();
})();
