// Injected on click via chrome.scripting.executeScript({ files: ['content/extract.js'] }).
// READ-ONLY: collects raw JSON-LD script bodies and counts Microdata/RDFa items. Never modifies the page.
// The last expression's value is returned to the popup.
(() => ({
  url: location.href,
  jsonld: [...document.querySelectorAll('script[type="application/ld+json" i]')].map(s => s.textContent || ''),
  microdata: document.querySelectorAll('[itemscope]:not([itemprop])').length,
  rdfa: document.querySelectorAll('[typeof]').length,
}))();
