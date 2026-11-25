// Keyboard Focus Order Visualizer popup. Opening the popup (a click on the toolbar button) grants activeTab;
// the popup then injects the read-only content/extract.js into that tab once, works out the Tab order with
// FocusCore, lists the stops, and draws the numbers layer (content/overlay.js) on the page. "Hide numbers"
// removes the layer; "Show" scrolls one element into view. "Copy report" uses the click on the button (no
// clipboardWrite permission); "Download CSV" saves a file through a normal download link (no downloads
// permission). Nothing is saved.
'use strict';
(function () {
  const Core = (typeof FocusCore !== 'undefined') ? FocusCore : self.FocusCore;
  const $ = id => document.getElementById(id);
  let res = null, group = 'all', tabId = null, layer = false;

  // These run in the page's isolated world (serialized by chrome.scripting), so they must be self-contained.
  function setPlan(p) { self.__ifoPlan = p; return true; }
  function clearLayer() { if (typeof self.__ifoClear === 'function') self.__ifoClear(); return true; }
  function showOne(i) { return typeof self.__ifoShow === 'function' ? self.__ifoShow(i) : false; }

  function setStatus(text, cls) { $('status').textContent = text; $('status').className = cls || 'muted'; }
  function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

  function render() {
    const list = $('list');
    while (list.firstChild) list.removeChild(list.firstChild);
    $('groupNote').textContent = Core.GROUPS[group].note;
    for (const it of Core.filter(res, group)) {
      const li = el('li', it.sev);
      li.appendChild(el('span', 'num', it.n == null ? '✕' : String(it.n)));
      const body = el('div', 'body');
      const what = el('div', 'what');
      what.appendChild(el('b', null, Core.kindLabel(it)));
      what.appendChild(document.createTextNode(it.name ? '"' + it.name + '"' : '(no name)'));
      if (it.ti !== null) what.appendChild(document.createTextNode(` · tabindex=${it.ti}`));
      body.appendChild(what);
      if (it.issues.length) {
        const tags = el('div', 'tags');
        for (const i of it.issues) tags.appendChild(el('span', 'tag ' + i.sev, i.label));
        body.appendChild(tags);
        for (const i of it.issues) body.appendChild(el('div', 'detail', i.detail));
      }
      if (it.note) body.appendChild(el('div', 'detail', it.note));
      body.appendChild(el('div', 'meta', it.path));
      li.appendChild(body);
      const show = el('button', 'show', 'Show');
      show.type = 'button';
      show.title = 'Scroll the page to this element';
      show.addEventListener('click', () => showOnPage(it));
      li.appendChild(show);
      list.appendChild(li);
    }
    for (const b of document.querySelectorAll('#filters .chip')) b.setAttribute('aria-pressed', String(b.dataset.group === group));
  }

  function setLayer(on) {
    layer = on;
    $('layerBtn').textContent = on ? 'Hide numbers' : 'Show numbers';
    $('layerBtn').setAttribute('aria-pressed', String(on));
  }
  async function draw() {
    await chrome.scripting.executeScript({ target: { tabId }, func: setPlan, args: [Core.plan(res)] });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content/overlay.js'] });
    setLayer(true);
  }
  async function toggleLayer() {
    try {
      if (layer) { await chrome.scripting.executeScript({ target: { tabId }, func: clearLayer }); setLayer(false); }
      else await draw();
    } catch (e) {
      setStatus('The page changed or was closed. Open the popup again.', 'warn');
    }
  }
  async function showOnPage(it) {
    try {
      if (!layer) await draw();
      await chrome.scripting.executeScript({ target: { tabId }, func: showOne, args: [it.i] });
    } catch (e) {
      setStatus('The page changed or was closed. Open the popup again.', 'warn');
    }
  }

  function show(r) {
    res = r;
    $('nAll').textContent = String(res.counts.stops);
    $('nCheck').textContent = String(res.counts.check);
    $('nSkipped').textContent = String(res.counts.skipped);
    $('copyBtn').disabled = $('csvBtn').disabled = !(res.stops.length || res.skipped.length);
    setStatus(Core.summary(res), Core.statusClass(res));
    render();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(Core.report(res));
      setStatus('Copied the report (' + res.counts.stops + ' Tab stops). Paste it anywhere.', 'good');
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
    $('layerBtn').addEventListener('click', toggleLayer);
    for (const b of document.querySelectorAll('#filters .chip')) b.addEventListener('click', () => { group = b.dataset.group; if (res) render(); });
    let page;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      tabId = tab.id;
      const out = await chrome.scripting.executeScript({ target: { tabId }, files: ['content/extract.js'] });
      page = out && out[0] && out[0].result;
      if (!page) throw new Error('no result');
    } catch (e) {
      setStatus('This page can\'t be read. Browser pages (chrome://, the Chrome Web Store, PDF viewer) are off-limits to extensions.', 'bad');
      return;
    }
    show(Core.analyze(page));
    if (res.stops.length || res.skipped.length) {
      try { await draw(); $('layerBtn').disabled = false; } catch (e) { setLayer(false); }
    }
  }
  self.__focusReady = init();
})();
