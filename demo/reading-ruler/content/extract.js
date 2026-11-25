// Reading Ruler: read-only page probe, injected by the popup (after lib/core.js) once per click.
// Returns the computed line height and font size of the page's visible text blocks (paragraphs, list items,
// quotes, table cells, captions) with how much text each holds, so the popup can size the ruler to the text,
// plus whether the ruler is already on in this tab (and with which settings). Changes nothing on the page.
(() => {
  const SEL = 'p, li, dd, dt, blockquote, td, th, figcaption, pre';
  const MAX = 600;
  const samples = [];
  const els = document.querySelectorAll(SEL);
  for (let i = 0; i < els.length && samples.length < MAX; i++) {
    const el = els[i];
    if (!el.getClientRects().length) continue; // not rendered (display:none or detached)
    const chars = (el.textContent || '').replace(/\s+/g, ' ').trim().length;
    if (chars < 20) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden') continue;
    samples.push({ lineHeight: cs.lineHeight, fontSize: cs.fontSize, chars });
  }
  return {
    url: location.href,
    title: document.title,
    vh: window.innerHeight,
    samples,
    on: self.__rrApi ? self.__rrApi.state() : null,
  };
})();
