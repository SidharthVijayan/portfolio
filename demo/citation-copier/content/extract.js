// Injected on click via chrome.scripting.executeScript({ files: ['content/extract.js'] }).
// READ-ONLY: returns the page's citation metadata exactly as written, for src/lib/core.js to normalise:
// every <meta> name/property/itemprop with its content (citation_*, Dublin Core, Open Graph, article:*, author, date…),
// the text of each <script type="application/ld+json">, the canonical link, <title>, the first <h1> and <html lang>.
// It reads no body text, forms or other tabs and never modifies the page. The last expression's value is returned to the popup.
(() => {
  const MAX_META = 600, MAX_JSONLD = 20, MAX_JSONLD_CHARS = 200000;
  const clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const metas = [];
  for (const m of document.querySelectorAll('meta')) {
    if (metas.length >= MAX_META) break;
    const key = clean(m.getAttribute('name') || m.getAttribute('property') || m.getAttribute('itemprop') || '').toLowerCase();
    const content = clean(m.getAttribute('content'));
    if (key && content) metas.push([key, content.slice(0, 2000)]);
  }
  const jsonld = [];
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    if (jsonld.length >= MAX_JSONLD) break;
    const t = String(s.textContent || '');
    if (t.trim() && t.length <= MAX_JSONLD_CHARS) jsonld.push(t);
  }
  let canonical = '';
  for (const l of document.querySelectorAll('link[rel]')) {
    if (String(l.getAttribute('rel')).toLowerCase().split(/\s+/).includes('canonical') && l.getAttribute('href')) {
      try { canonical = new URL(l.getAttribute('href'), location.href).href; } catch (e) { canonical = ''; }
      break;
    }
  }
  const h1 = document.querySelector('h1');
  const root = document.documentElement;
  return {
    url: location.href,
    title: clean(document.title || ''),
    h1: h1 ? clean(h1.textContent).slice(0, 500) : '',
    lang: (root && root.getAttribute && root.getAttribute('lang')) || '',
    canonical,
    metas,
    jsonld,
  };
})();
