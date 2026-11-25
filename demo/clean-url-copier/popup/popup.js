// Clean URL Copier popup. Opening the popup (a click on the toolbar button) grants activeTab, which
// lets the popup see the address and title of the tab you are on (tab.url, tab.title) without the
// "tabs" permission or any host access. Nothing is injected into the page and nothing is stored.
// CleanCore marks tracking parameters; each row can be ticked (removed) or unticked (kept).
// The copy buttons use the click on the button (no clipboardWrite permission).
'use strict';
(function () {
  const Core = (typeof CleanCore !== 'undefined') ? CleanCore : self.CleanCore;
  const $ = id => document.getElementById(id);
  let pageUrl = '', pageTitle = '', overrides = {}, removeAll = false, removeHash, current = null;

  function setStatus(text, cls) { $('status').textContent = text; $('status').className = cls || 'muted'; }

  function row(p, on) {
    const li = document.createElement('li'), box = document.createElement('input'), label = document.createElement('label');
    const kv = document.createElement('span'), why = document.createElement('span');
    li.className = on ? 'on' : '';
    box.type = 'checkbox'; box.id = 'p-' + p.index; box.checked = on;
    box.title = (on ? 'Removed. Untick to keep ' : 'Kept. Tick to remove ') + p.name;
    box.addEventListener('change', () => { overrides[p.index] = box.checked; render(); });
    label.htmlFor = box.id;
    kv.className = 'kv'; kv.textContent = p.raw; kv.title = p.raw;
    why.className = 'why' + (p.tracking ? ' track' : '');
    why.textContent = p.tracking ? 'Tracking: ' + p.why : (on ? 'Removed by you' : 'Kept (not a known tracking tag)');
    label.appendChild(kv); label.appendChild(why);
    li.appendChild(box); li.appendChild(label);
    return li;
  }

  function render() {
    current = null;
    $('copyBtn').disabled = true; $('mdBtn').disabled = true;
    if (!pageUrl) return;
    const r = Core.clean(pageUrl, { remove: overrides, removeAll, removeHash });
    current = r.url;
    $('output').value = r.url;
    $('copyBtn').disabled = false; $('mdBtn').disabled = false;
    $('page').className = 'muted' + (r.changed ? '' : ' plain');
    const removedIdx = new Set(r.removed.map(p => p.index));
    const list = $('paramList');
    list.textContent = '';
    for (const p of r.params) list.appendChild(row(p, removedIdx.has(p.index)));
    if (!r.params.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'This address has no parameters.'; list.appendChild(li); }
    $('paramCount').textContent = String(r.params.length);
    $('removeAllBtn').disabled = !r.params.length || r.kept.length === 0;
    $('resetBtn').disabled = !Object.keys(overrides).length && !removeAll && removeHash === undefined;
    $('optHash').disabled = !r.hash;
    $('optHash').checked = r.hashRemoved;
    $('hashText').textContent = r.hash ? r.hash + (r.hashTracking ? ' (tracking)' : '') : '(none)';
    setStatus(Core.message(r), r.changed ? 'good' : 'muted');
  }

  async function copyText(text, done) {
    try {
      await navigator.clipboard.writeText(text);
      setStatus(done, 'good');
    } catch (e) {
      setStatus('Copy was blocked by the browser. Try again.', 'warn');
    }
  }

  function copy() {
    if (current) copyText(current, 'Copied the clean link (' + current.length + ' characters). Paste it anywhere.');
  }
  function copyMarkdown() {
    if (current) copyText(Core.markdown(pageTitle, current), 'Copied as a Markdown link with the page title.');
  }

  async function init() {
    $('copyBtn').addEventListener('click', copy);
    $('mdBtn').addEventListener('click', copyMarkdown);
    $('removeAllBtn').addEventListener('click', () => { removeAll = true; overrides = {}; render(); });
    $('resetBtn').addEventListener('click', () => { removeAll = false; overrides = {}; removeHash = undefined; render(); });
    $('optHash').addEventListener('change', () => { removeHash = $('optHash').checked; render(); });
    let tab = null;
    try { [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); } catch (e) { tab = null; }
    const url = tab && tab.url;
    if (!url) {
      $('page').textContent = 'No address available for this tab.';
      return setStatus('This tab\'s address can\'t be read. Chrome keeps its own pages (chrome://, the Web Store) and blank tabs off-limits to extensions. Open a web page and click the button again.', 'bad');
    }
    $('page').textContent = url; $('page').title = url;
    const c = Core.check(url);
    if (!c.ok) {
      $('page').className = 'muted plain';
      return setStatus(Core.message({ ok: false, scheme: c.scheme }), 'bad');
    }
    pageUrl = url;
    pageTitle = tab.title || '';
    render();
  }
  self.__cleanReady = init();
})();
