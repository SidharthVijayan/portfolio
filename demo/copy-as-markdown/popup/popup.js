// Copy as Markdown popup. Opening the popup (a click on the toolbar button) grants activeTab;
// the popup then injects the read-only content/extract.js into that tab once, turns what it
// returns into Markdown with CopyMarkdownCore and shows it in an editable box. "Copy Markdown"
// uses the click on the button (no clipboardWrite permission); "Download .md" saves a file
// through a normal download link (no downloads permission). Options are not saved.
'use strict';
(function () {
  const Core = (typeof CopyMarkdownCore !== 'undefined') ? CopyMarkdownCore : self.CopyMarkdownCore;
  const $ = id => document.getElementById(id);
  let page = null, result = null;

  function setStatus(text, cls) { $('status').textContent = text; $('status').className = cls || 'muted'; }

  function convert() {
    result = Core.toMarkdown(page, { source: $('optSource').checked, images: $('optImages').checked });
    $('output').value = result.markdown;
    $('output').readOnly = result.empty;
    $('copyBtn').disabled = $('downloadBtn').disabled = result.empty;
    setStatus(Core.summary(page, result), result.empty ? 'warn' : 'good');
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText($('output').value);
      setStatus('Copied the Markdown (' + $('output').value.length + ' characters). Paste it anywhere.', 'good');
    } catch (e) {
      setStatus('Copy was blocked by the browser. Try again.', 'warn');
    }
  }

  function download() {
    const name = Core.fileName(page.title);
    const url = URL.createObjectURL(new Blob([$('output').value], { type: 'text/markdown;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    setStatus('Saved ' + name + ' to your downloads.', 'good');
  }

  async function init() {
    $('copyBtn').addEventListener('click', copy);
    $('downloadBtn').addEventListener('click', download);
    $('optSource').addEventListener('change', () => page && convert());
    $('optImages').addEventListener('change', () => page && convert());
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const res = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/extract.js'] });
      page = res && res[0] && res[0].result;
      if (!page) throw new Error('no result');
    } catch (e) {
      setStatus('This page can\'t be read. Browser pages (chrome://, the Chrome Web Store, PDF viewer) are off-limits to extensions.', 'bad');
      return;
    }
    convert();
  }
  self.__mdReady = init();
})();
