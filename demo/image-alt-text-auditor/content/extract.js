// Injected on click via chrome.scripting.executeScript({ files: ['content/extract.js'] }).
// READ-ONLY: lists every <img> and <input type="image"> in the page (including <picture> images) with its alt
// attribute, ARIA hiding/naming, rendered size and link context. Raw values are returned so the popup can judge them.
// Never modifies the page. The last expression's value is returned to the popup.
(() => {
  const SELECTOR = 'img, input[type="image" i]';
  const text = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const byIds = ids => text(String(ids || '').split(/\s+/).filter(Boolean)
    .map(id => { const n = document.getElementById(id); return n ? n.textContent : ''; }).join(' '));
  const els = [...document.querySelectorAll(SELECTOR)];
  const images = els.map((el, i) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const link = el.closest('a[href], button');
    let linkInfo = null;
    if (link) {
      const others = [...link.querySelectorAll(SELECTOR)].filter(x => x !== el);
      linkInfo = {
        kind: link.tagName.toLowerCase() === 'button' ? 'button' : 'link',
        text: text(link.getAttribute('aria-label') || byIds(link.getAttribute('aria-labelledby')) || link.textContent || link.getAttribute('title')),
        otherImageAlt: others.some(x => text(x.getAttribute('alt'))),
      };
    }
    return {
      i,
      tag: el.tagName.toLowerCase(),
      src: el.currentSrc || el.src || '',
      srcAttr: el.getAttribute('src'),
      dataSrc: el.getAttribute('data-src') || el.getAttribute('data-lazy-src') || el.getAttribute('data-original'),
      hasAlt: el.hasAttribute('alt'),
      alt: el.getAttribute('alt'),
      role: text(el.getAttribute('role')).toLowerCase(),
      ariaHidden: !!el.closest('[aria-hidden="true"]'),
      ariaLabel: text(el.getAttribute('aria-label')),
      ariaLabelledby: byIds(el.getAttribute('aria-labelledby')),
      title: text(el.getAttribute('title')),
      width: Math.round(r.width), height: Math.round(r.height),
      naturalWidth: el.naturalWidth || 0, naturalHeight: el.naturalHeight || 0,
      visible: r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none',
      link: linkInfo,
    };
  });
  return { url: location.href, images };
})();
