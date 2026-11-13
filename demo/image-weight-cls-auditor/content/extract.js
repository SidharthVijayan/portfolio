// Injected on click via chrome.scripting.executeScript({ files: ['content/extract.js'] }).
// READ-ONLY: for every <img> on the page returns its width/height attributes, whether CSS gives it
// a height or aspect-ratio (inline style, or rules in stylesheets the page itself can read), its
// rendered size and position, the file's own (natural) size, loading/srcset attributes, signs of a
// JavaScript lazy-loader, and the file size the browser recorded (Resource Timing), plus the
// viewport size and device pixel ratio. Makes no requests and never modifies the page.
(() => {
  const MAX = 3000;
  const clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const doc = document.documentElement;
  const vw = (doc && doc.clientWidth) || window.innerWidth || 0;
  const vh = window.innerHeight || (doc && doc.clientHeight) || 0;
  const sy = window.scrollY || window.pageYOffset || 0;
  const out = {
    url: location.href, protocol: location.protocol, title: clean(document.title || ''),
    viewportWidth: vw, viewportHeight: vh, dpr: window.devicePixelRatio || 1,
    images: [], total: 0, hidden: 0, pixels: 0, sheetsBlocked: 0, truncated: false,
  };
  const cs = el => { try { return getComputedStyle(el); } catch (e) { return null; } };
  const prop = (style, k) => { try { return clean(style.getPropertyValue ? style.getPropertyValue(k) : style[k]).toLowerCase(); } catch (e) { return ''; } };
  const setsHeight = h => !!h && h !== 'auto' && h !== 'initial' && h !== 'unset' && h !== 'inherit' && h !== 'revert';
  const setsRatio = a => !!a && a !== 'auto' && a !== 'initial' && a !== 'unset' && a !== 'inherit' && a !== 'revert';

  // CSS rules that give a height or an aspect-ratio (same-origin / readable stylesheets only).
  const sized = [];
  const collect = (rules, depth) => {
    for (const r of rules || []) {
      try {
        if (r.selectorText && r.style) {
          const h = prop(r.style, 'height'), ar = prop(r.style, 'aspect-ratio');
          if (setsHeight(h) || setsRatio(ar)) sized.push({ sel: r.selectorText, h: setsHeight(h), ar: setsRatio(ar) });
        }
        if (r.cssRules && depth < 4) {
          const media = r.media && r.media.mediaText;
          if (!media || !window.matchMedia || window.matchMedia(media).matches) collect(r.cssRules, depth + 1);
        }
      } catch (e) { /* skip unreadable rule */ }
    }
  };
  for (const sheet of document.styleSheets || []) {
    let rules;
    try { rules = sheet.cssRules; } catch (e) { out.sheetsBlocked++; continue; }
    collect(rules, 0);
  }

  // File sizes the browser recorded for this page (0 when another site doesn't allow it).
  const sizes = new Map();
  try {
    for (const e of performance.getEntriesByType('resource')) {
      const b = e.encodedBodySize || 0;
      if (b && !sizes.has(e.name)) sizes.set(e.name, b);
    }
  } catch (e) { /* no resource timing */ }

  const describe = el => {
    let d = 'img';
    const id = el.getAttribute('id'); if (id) d += '#' + id;
    const cls = clean(el.getAttribute('class')).split(' ').filter(Boolean).slice(0, 2);
    if (cls.length) d += '.' + cls.join('.');
    return d;
  };
  const fileOf = src => {
    if (!src) return '(no src)';
    if (/^data:/i.test(src)) return /^data:image\/svg/i.test(src) ? 'inline SVG (data:)' : 'inline image (data:)';
    try {
      const u = new URL(src, location.href);
      const last = u.pathname.split('/').filter(Boolean).pop() || u.hostname;
      try { return decodeURIComponent(last).slice(0, 80); } catch (e) { return last.slice(0, 80); }
    } catch (e) { return String(src).slice(0, 80); }
  };
  const inlineDecl = (el, k) => {
    const m = String(el.getAttribute('style') || '').toLowerCase().match(new RegExp('(?:^|;)\\s*' + k + '\\s*:\\s*([^;]+)'));
    return m ? clean(m[1]) : '';
  };

  for (const img of document.querySelectorAll('img')) {
    out.total++;
    if (out.images.length >= MAX) { out.truncated = true; continue; }
    const s = cs(img);
    let rects = []; try { rects = img.getClientRects(); } catch (e) { rects = []; }
    if (!s || s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse' || !rects.length) { out.hidden++; continue; }
    let r; try { r = img.getBoundingClientRect(); } catch (e) { continue; }
    const src = String(img.currentSrc || img.src || img.getAttribute('src') || '');
    const nw = img.naturalWidth | 0, nh = img.naturalHeight | 0;
    const jsLazy = ['data-src', 'data-srcset', 'data-lazy-src', 'data-original'].some(a => img.hasAttribute(a)) ||
      /(^|\s)lazy(load|loaded|loading)?(\s|$)/i.test(String(img.getAttribute('class') || ''));
    if (!jsLazy && ((nw === 1 && nh === 1) || (r.width <= 1 && r.height <= 1 && img.complete && nw <= 1))) { out.pixels++; continue; }
    let cssHeight = setsHeight(inlineDecl(img, 'height')), cssRatio = setsRatio(inlineDecl(img, 'aspect-ratio'));
    for (const x of sized) {
      if ((cssHeight || !x.h) && (cssRatio || !x.ar)) continue;
      try { if (img.matches(x.sel)) { cssHeight = cssHeight || x.h; cssRatio = cssRatio || x.ar; } } catch (e) { /* bad selector */ }
    }
    let bytes = 0;
    try { bytes = sizes.get(new URL(src, location.href).href) || 0; } catch (e) { bytes = 0; }
    out.images.push({
      desc: describe(img), file: jsLazy && (img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('data-original')) ?
        fileOf(img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('data-original')) + ' (data-src)' : fileOf(src), src: src.startsWith('data:') ? src.slice(0, 40) : src.split(/[?#]/)[0].slice(0, 300),
      widthAttr: img.getAttribute('width'), heightAttr: img.getAttribute('height'),
      cssHeight, cssRatio, position: String(s.position || 'static'), objectFit: String(s.objectFit || 'fill'),
      rw: Math.round(r.width * 10) / 10, rh: Math.round(r.height * 10) / 10, top: Math.round(r.top + sy),
      nw, nh, complete: !!img.complete, loading: String(img.getAttribute('loading') || '').trim().toLowerCase(),
      jsLazy, srcset: img.hasAttribute('srcset') || !!(img.parentElement && String(img.parentElement.tagName).toUpperCase() === 'PICTURE'),
      svg: /\.svg$/i.test(src.split(/[?#]/)[0]) || /^data:image\/svg/i.test(src), bytes,
    });
  }
  return out;
})();
