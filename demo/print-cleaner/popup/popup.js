// Print Cleaner popup. Opening the popup (a click on the toolbar button) grants activeTab; the popup then
// injects the read-only content/extract.js into that tab once, sorts the page's parts with PrintCore and lists
// the groups that can be removed. "Clean page" injects content/apply.js, which hides the ticked groups (and
// shows a small bar on the page with Print, Remove more, Undo and Restore page). "Print…" cleans first if
// needed, then opens the browser's print dialog for the tab. "Restore page" takes everything away again.
// Nothing is saved.
'use strict';
(function () {
  const Core = (typeof PrintCore !== 'undefined') ? PrintCore : self.PrintCore;
  const $ = id => document.getElementById(id);
  let res = null, sel = {}, tabId = null, applied = false, dirty = true;

  // These run in the page's isolated world (serialized by chrome.scripting), so they must be self-contained.
  function setPlan(p) { self.__pcPlan = p; return true; }
  function restorePage() { return self.__pcApi ? self.__pcApi.restore() : false; }
  function printPage() { setTimeout(() => print(), 60); return true; }

  function setStatus(text, cls) { $('status').textContent = text; $('status').className = cls || 'muted'; }
  function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  const pageError = () => setStatus('The page changed or was closed. Open the popup again.', 'warn');

  function buttons() {
    $('cleanBtn').textContent = applied ? 'Update page' : 'Clean page';
    $('cleanBtn').disabled = !res || !res.count || (applied && !dirty);
    $('printBtn').disabled = !res;
    $('restoreBtn').disabled = !applied;
  }
  function render() {
    const list = $('list');
    while (list.firstChild) list.removeChild(list.firstChild);
    for (const g of res.groups) {
      const row = el('label', 'grp');
      const box = el('input'); box.type = 'checkbox'; box.checked = !!sel[g.key]; box.dataset.key = g.key;
      box.addEventListener('change', () => { sel[g.key] = box.checked; dirty = true; buttons(); });
      row.appendChild(box);
      const body = el('div', 'body');
      body.appendChild(el('span', 'n', String(g.items.length)));
      body.appendChild(el('div', 'name', g.label));
      body.appendChild(el('div', 'ex', g.hint + (g.examples.length ? ' · e.g. ' + g.examples.map(x => '“' + x + '”').join(', ') : '')));
      row.appendChild(body);
      list.appendChild(row);
    }
    if (!res.groups.length) list.appendChild(el('p', 'muted', 'Nothing on this page needs removing. You can still print it, with link addresses if you like.'));
  }

  async function clean() {
    const plan = Core.plan(res, sel, $('links').checked);
    await chrome.scripting.executeScript({ target: { tabId }, func: setPlan, args: [plan] });
    const out = await chrome.scripting.executeScript({ target: { tabId }, files: ['content/apply.js'] });
    const r = out && out[0] && out[0].result;
    applied = true; dirty = false;
    const n = r ? r.hidden : plan.hide.length;
    setStatus(`Removed ${n} ${n === 1 ? 'part' : 'parts'}. The page now shows what will print. Use "Remove more" on the page to click away anything else.`, 'good');
    buttons();
    return r;
  }
  async function onClean() { try { await clean(); } catch (e) { pageError(); } }
  async function onPrint() {
    try {
      if (!applied || dirty) await clean();
      await chrome.scripting.executeScript({ target: { tabId }, func: printPage });
      window.close();
    } catch (e) { pageError(); }
  }
  async function onRestore() {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, func: restorePage });
      applied = false; dirty = true;
      setStatus('Restored the page as it was.', 'good');
      buttons();
    } catch (e) { pageError(); }
  }

  async function init() {
    $('cleanBtn').addEventListener('click', onClean);
    $('printBtn').addEventListener('click', onPrint);
    $('restoreBtn').addEventListener('click', onRestore);
    $('links').addEventListener('change', () => { dirty = true; buttons(); });
    let page;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      tabId = tab.id;
      const out = await chrome.scripting.executeScript({ target: { tabId }, files: ['content/extract.js'] });
      page = out && out[0] && out[0].result;
      if (!page) throw new Error('no result');
    } catch (e) {
      setStatus('This page can\'t be cleaned. Browser pages (chrome://, the Chrome Web Store, PDF viewer) are off-limits to extensions.', 'bad');
      return;
    }
    res = Core.analyze(page);
    sel = Core.initialSelection(res);
    applied = !!res.applied; dirty = !applied;
    $('links').checked = !!(res.applied && res.applied.links);
    setStatus(Core.summary(res), Core.statusClass(res));
    render();
    buttons();
  }
  self.__printReady = init();
})();
