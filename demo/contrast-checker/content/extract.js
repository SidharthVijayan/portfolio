// Injected on click via chrome.scripting.executeScript({ files: ['content/extract.js'] }).
// READ-ONLY: finds every visible element that directly contains text and returns its computed text colour,
// opacity, font size/weight and the background colours (and whether a background image is present) from the
// element outward until an opaque background is reached. Also returns a CSS path so "Show on page" can find it.
// Never modifies the page. The last expression's value is returned to the popup.
(() => {
  const MAX = 1500;
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'CANVAS', 'OPTION', 'HEAD', 'TITLE']);
  const clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const opaque = c => {
    c = String(c || '').trim().toLowerCase();
    const h = /^#([0-9a-f]{3,8})$/.exec(c);
    if (h) return h[1].length === 3 || h[1].length === 6 || (h[1].length === 4 && h[1].endsWith('f')) || (h[1].length === 8 && h[1].endsWith('ff'));
    const m = /^rgba?\(([^)]*)\)$/.exec(c);
    if (!m) return false;
    const p = m[1].split(/[\s,/]+/).filter(Boolean);
    return p.length < 4 || (p[3].endsWith('%') ? parseFloat(p[3]) >= 100 : parseFloat(p[3]) >= 1);
  };
  const pathOf = el => {
    const parts = [];
    for (let e = el; e && e.parentElement; e = e.parentElement) {
      const tag = e.tagName.toLowerCase();
      const same = [...e.parentElement.children].filter(x => x.tagName === e.tagName);
      parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(e) + 1})` : tag);
    }
    return parts.join(' > ');
  };
  const items = [];
  let truncated = false;
  for (const el of document.body ? document.body.querySelectorAll('*') : []) {
    if (SKIP.has(el.tagName.toUpperCase())) continue;
    const text = clean([...el.childNodes].filter(n => n.nodeType === 3).map(n => n.nodeValue).join(' '));
    if (!text) continue;
    if (el.closest('svg, canvas, noscript, template, select')) continue;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') continue;
    if (!(r.width > 1 && r.height > 1)) continue; // hidden or screen-reader-only (1px clip) text
    if (items.length >= MAX) { truncated = true; break; }
    let opacity = 1;
    const layers = [];
    let bgDone = false;
    for (let e = el; e; e = e.parentElement) {
      const s = e === el ? cs : getComputedStyle(e);
      opacity *= parseFloat(s.opacity == null || s.opacity === '' ? 1 : s.opacity);
      if (!bgDone) {
        const image = !!s.backgroundImage && s.backgroundImage !== 'none';
        layers.push({ color: s.backgroundColor, image });
        if (opaque(s.backgroundColor)) bgDone = true;
      }
    }
    if (opacity <= 0) continue;
    items.push({
      i: items.length,
      tag: el.tagName.toLowerCase(),
      path: pathOf(el),
      text: text.slice(0, 120),
      color: cs.color,
      opacity: Math.round(opacity * 1000) / 1000,
      fontSize: parseFloat(cs.fontSize) || 16,
      fontWeight: String(cs.fontWeight || '400'),
      layers,
      disabled: !!el.closest('[disabled], [aria-disabled="true"]'),
    });
  }
  return { url: location.href, items, truncated };
})();
