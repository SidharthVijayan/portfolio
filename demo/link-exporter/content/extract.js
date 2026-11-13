// Injected on click via chrome.scripting.executeScript({ files: ['content/extract.js'] }).
// READ-ONLY: returns every link on the page (<a href> and image-map <area href>) in document order with what
// src/lib/core.js needs to export it: the href as written and as resolved, its anchor text (or image alt / aria-label /
// title when there is no text), rel, target, and whether it is currently rendered. It reads no other body text, no forms
// and no other tabs, and never modifies the page. The last expression's value is returned to the popup.
(() => {
  const MAX_LINKS = 10000, MAX_TEXT = 300;
  const clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const attr = (el, k) => { const v = el.getAttribute(k); return v == null ? '' : clean(v); };
  const base = document.baseURI || location.href;
  const nodes = document.querySelectorAll('a[href], area[href]');
  const links = [];
  for (const el of nodes) {
    if (links.length >= MAX_LINKS) break;
    const tag = String(el.tagName || 'a').toLowerCase();
    const raw = el.getAttribute('href') == null ? '' : String(el.getAttribute('href')).trim();
    let href = '';
    try { href = new URL(raw, base).href; } catch (e) { href = ''; }
    let text = '', textFrom = '';
    if (tag === 'area') { text = attr(el, 'alt'); textFrom = text ? 'alt' : ''; }
    else {
      text = clean(el.textContent);
      if (text) textFrom = 'text';
      else {
        const img = el.querySelector && el.querySelector('img[alt]');
        const alt = img ? attr(img, 'alt') : '';
        if (alt) { text = alt; textFrom = 'image alt'; }
      }
    }
    if (!text && attr(el, 'aria-label')) { text = attr(el, 'aria-label'); textFrom = 'aria-label'; }
    if (!text && attr(el, 'title')) { text = attr(el, 'title'); textFrom = 'title'; }
    let hidden = false;
    if (tag === 'a') { try { hidden = el.getClientRects().length === 0; } catch (e) { hidden = false; } }
    links.push({ tag, raw: raw.slice(0, 2000), href: href.slice(0, 2000), text: text.slice(0, MAX_TEXT), textFrom,
      rel: attr(el, 'rel').toLowerCase(), target: attr(el, 'target'), hidden });
  }
  return { url: location.href, title: clean(document.title || ''), links, total: nodes.length, truncated: nodes.length > links.length };
})();
