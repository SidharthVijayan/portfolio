// Publish Date Finder popup. Opening the popup (a click on the toolbar button) grants activeTab;
// the popup then injects the read-only content/extract.js into that tab once, works out the
// published and last-updated dates with PublishDateCore and shows them with every piece of
// evidence and any warnings. Copy uses the click on the button (no clipboardWrite permission).
// Nothing is saved.
'use strict';
(function () {
  const Core = (typeof PublishDateCore !== 'undefined') ? PublishDateCore : self.PublishDateCore;
  const $ = id => document.getElementById(id);
  let analysis = null;

  function setStatus(text, cls) { $('status').textContent = text; $('status').className = cls || 'muted'; }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

  function card(prefix, p) {
    $(prefix + 'Value').textContent = p ? Core.show(p.date) : 'Not found';
    $(prefix + 'Sub').textContent = p ? analysis.ageOf(p.date) + ' · ' + Core.whereLine(p) : '';
    $(prefix + 'Card').className = 'card' + (p ? ' found' : ' missing');
  }

  function render() {
    card('pub', analysis.published || analysis.unlabelled);
    $('pubLabel').textContent = !analysis.published && analysis.unlabelled ? 'Date (unlabelled)' : 'Published';
    card('mod', analysis.modified);
    const notes = $('notes'); clear(notes);
    for (const n of analysis.notes) notes.appendChild(el('li', n.level, n.msg));
    const ul = $('evidence'); clear(ul);
    $('evidenceTitle').textContent = 'Evidence (' + analysis.evidence.length + ')';
    for (const c of analysis.evidence) {
      const li = el('li', c.side ? 'side' : '');
      li.appendChild(el('span', 'kind ' + c.kind, Core.KIND_LABEL[c.kind]));
      li.appendChild(el('span', 'when', Core.showShort(c.date)));
      li.appendChild(el('span', 'src', c.label + (c.side ? ' (not used)' : '')));
      ul.appendChild(li);
    }
    $('copyBtn').disabled = false;
    $('copyDateBtn').disabled = !analysis.published;
  }

  async function copy(text, what) {
    try {
      await navigator.clipboard.writeText(text);
      setStatus('Copied ' + what + '.', 'good');
    } catch (e) {
      setStatus('Copy was blocked by the browser. Try again.', 'warn');
    }
  }

  async function init() {
    $('copyBtn').addEventListener('click', () => copy(Core.report(analysis), 'the report'));
    $('copyDateBtn').addEventListener('click', () => copy(analysis.published.date.day, 'the published date (' + analysis.published.date.day + ')'));
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
    analysis = Core.analyze(raw, Date.now());
    render();
    setStatus(Core.summary(analysis), analysis.published || analysis.modified ? 'good' : 'warn');
  }
  self.__dateReady = init();
})();
