// Injected on click via chrome.scripting.executeScript({ files: ['content/extract.js'] }).
// READ-ONLY: collects canonical and hreflang <link> elements, <html lang> and meta robots. Never modifies the page.
// Raw attribute values are returned (not resolved), so the popup can tell relative from absolute URLs.
// The last expression's value is returned to the popup.
(() => {
  const inHead = el => !!el.closest('head');
  const links = [...document.querySelectorAll('link[rel]')];
  const rel = (el, v) => el.getAttribute('rel').toLowerCase().split(/\s+/).includes(v);
  return {
    url: location.href,
    lang: document.documentElement.getAttribute('lang') || '',
    canonicals: links.filter(l => rel(l, 'canonical')).map(l => ({ href: l.getAttribute('href') || '', inHead: inHead(l) })),
    alternates: links.filter(l => rel(l, 'alternate') && l.hasAttribute('hreflang'))
      .map(l => ({ hreflang: l.getAttribute('hreflang') || '', href: l.getAttribute('href') || '', inHead: inHead(l) })),
    robots: [...document.querySelectorAll('meta[name="robots" i], meta[name="googlebot" i]')].map(m => m.getAttribute('content') || ''),
  };
})();
