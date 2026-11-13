// Injected on click via chrome.scripting.executeScript({ files: ['content/extract.js'] }).
// READ-ONLY: returns the address (scheme, host and path only; query strings and #fragments are dropped) of every
// <script src> and <iframe>/<frame src> in the page, plus scripts and frames the browser's own resource list says the
// page loaded (which catches ones another script added and then removed). It also counts inline scripts without reading
// their code. It reads no page text, no forms and no other tabs, makes no requests and never modifies the page.
(() => {
  const MAX_ITEMS = 5000;
  const base = document.baseURI || location.href;
  const clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const addr = s => {
    try { const u = new URL(String(s).trim(), base); return (u.protocol === 'http:' || u.protocol === 'https:') ? u.origin + u.pathname : ''; }
    catch (e) { return ''; }
  };
  const items = [];
  let inline = 0, blankFrames = 0, total = 0;
  const add = it => { total++; if (items.length < MAX_ITEMS) items.push(it); };
  for (const el of document.querySelectorAll('script')) {
    const raw = el.getAttribute('src');
    if (raw == null || !String(raw).trim()) { inline++; continue; }
    const url = addr(raw);
    if (!url) continue;
    add({ kind: 'script', url, source: 'page', async: el.hasAttribute('async'), defer: el.hasAttribute('defer'),
      module: clean(el.getAttribute('type')).toLowerCase() === 'module', hidden: false });
  }
  for (const el of document.querySelectorAll('iframe, frame')) {
    const raw = el.getAttribute('src');
    const url = raw == null ? '' : addr(raw);
    if (!url) { blankFrames++; continue; }
    let hidden = false;
    try { const r = el.getClientRects(); hidden = r.length === 0 || (r[0].width <= 2 && r[0].height <= 2); } catch (e) { hidden = false; }
    add({ kind: 'iframe', url, source: 'page', async: false, defer: false, module: false, hidden });
  }
  let entries = [];
  try { entries = performance.getEntriesByType('resource') || []; } catch (e) { entries = []; }
  for (const e of entries) {
    if (e.initiatorType !== 'script' && e.initiatorType !== 'iframe') continue;
    const url = addr(e.name);
    if (url) add({ kind: e.initiatorType, url, source: 'loaded', async: false, defer: false, module: false, hidden: false });
  }
  return { url: location.href, title: clean(document.title || ''), items, inline, blankFrames, total, truncated: total > items.length };
})();
