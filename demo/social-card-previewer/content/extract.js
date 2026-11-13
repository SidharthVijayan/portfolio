// Injected on click via chrome.scripting.executeScript({ files: ['content/extract.js'] }).
// READ-ONLY: collects Open Graph (og:*) and X/Twitter (twitter:*) meta tags, <title>, meta description
// and the canonical link. Raw values are returned (not resolved) so the popup can spot relative URLs.
// Never modifies the page. The last expression's value is returned to the popup.
(() => {
  const inHead = el => !!el.closest('head');
  const metas = [...document.querySelectorAll('meta[property], meta[name]')]
    .map(m => ({ key: String(m.getAttribute('property') || m.getAttribute('name') || '').trim().toLowerCase(), value: m.getAttribute('content') || '', inHead: inHead(m) }))
    .filter(m => /^(og|twitter):/.test(m.key));
  const desc = document.querySelector('meta[name="description" i]');
  const canon = document.querySelector('link[rel~="canonical" i]');
  const t = document.querySelector('title');
  return {
    url: location.href,
    title: t ? t.textContent : '',
    description: desc ? desc.getAttribute('content') || '' : '',
    canonical: canon ? canon.getAttribute('href') || '' : '',
    metas,
  };
})();
