// Hidden Text Detector: read-only page reader, injected once per click (activeTab + scripting).
// Walks the page's elements and, for every element that holds text, records how that text could be
// hidden from a visitor: display:none or the hidden attribute (recorded once, at the outermost hidden
// element, with all the text inside it), visibility:hidden, opacity near 0, a tiny font, positioned
// off-screen, a large negative text-indent, clipped to a 0/1px box, or inside a closed <details>.
// It also returns the text colour and the background colours behind it so the popup can spot text
// that is the same colour as its background. It never changes the page and sends nothing anywhere.
(() => {
  'use strict';
  const MAX_NODES = 20000, MAX_RECORDS = 1500, TEXT_MAX = 2000;
  const LIMITS = { tinyFontPx: 3, opacity: 0.05, indentPx: -999, farRightPx: 3000, clipPx: 1 };
  const SKIP = new Set(['script', 'style', 'noscript', 'template', 'svg', 'canvas', 'iframe', 'frame', 'object', 'embed',
    'video', 'audio', 'head', 'meta', 'link', 'title', 'select', 'option', 'optgroup', 'datalist', 'textarea', 'input', 'img', 'picture', 'source', 'br', 'wbr', 'hr']);
  const tagOf = el => String(el.tagName || '').toLowerCase();
  const num = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
  const clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const round = n => Math.round(n);
  const vw = num(typeof innerWidth !== 'undefined' ? innerWidth : 0, 0) || 1280;
  const sx = num(typeof scrollX !== 'undefined' ? scrollX : 0, 0), sy = num(typeof scrollY !== 'undefined' ? scrollY : 0, 0);
  let count = 0, truncated = false;
  const records = [];

  const pathOf = el => {
    const parts = [];
    for (let e = el; e && e.parentElement; e = e.parentElement) {
      const tag = tagOf(e);
      const same = [...e.parentElement.children].filter(x => tagOf(x) === tag);
      parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(e) + 1})` : tag);
    }
    return parts.join(' > ');
  };
  const ownText = el => clean([...el.childNodes].filter(n => n.nodeType === 3).map(n => n.nodeValue).join(' '));
  const absHref = a => { const h = a.getAttribute('href'); try { return String(new URL(h, String(location.href))); } catch (e) { return String(h); } };
  const linkOf = el => { for (let e = el; e && e.nodeType === 1; e = e.parentElement) if (tagOf(e) === 'a' && e.hasAttribute('href')) return e; return null; };

  // All text inside a hidden element (skipping scripts, styles, form fields), plus the links in it.
  function collect(el, out) {
    for (const n of el.childNodes) {
      if (out.text.length > TEXT_MAX) return;
      if (n.nodeType === 3) out.text += ' ' + n.nodeValue;
      else if (n.nodeType === 1 && !SKIP.has(tagOf(n))) {
        if (tagOf(n) === 'a' && n.hasAttribute('href')) out.links.push(absHref(n));
        collect(n, out);
      }
    }
    return out;
  }

  // Text colour and the backgrounds behind it, from the element outwards until an opaque one.
  const opaque = c => {
    c = String(c || '').trim().toLowerCase();
    const h = /^#([0-9a-f]{3,8})$/.exec(c);
    if (h) return h[1].length === 3 || h[1].length === 6 || (h[1].length === 4 && h[1].endsWith('f')) || (h[1].length === 8 && h[1].endsWith('ff'));
    const m = /^rgba?\(([^)]*)\)$/.exec(c);
    if (!m) return false;
    const p = m[1].split(/[\s,/]+/).filter(Boolean);
    return p.length < 4 || (p[3].endsWith('%') ? parseFloat(p[3]) >= 100 : parseFloat(p[3]) >= 1);
  };
  function layersOf(el, cs) {
    const layers = [];
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const s = e === el ? cs : getComputedStyle(e);
      layers.push({ color: String(s.backgroundColor || ''), image: !!s.backgroundImage && s.backgroundImage !== 'none' });
      if (opaque(s.backgroundColor)) break;
    }
    return layers;
  }

  function push(el, rec) {
    if (records.length >= MAX_RECORDS) { truncated = true; return; }
    const link = linkOf(el);
    records.push(Object.assign({ path: pathOf(el), tag: tagOf(el), link: link ? absHref(link) : null }, rec));
  }

  function walk(el, ctx) {
    if (truncated) return;
    if (++count > MAX_NODES) { truncated = true; return; }
    const tag = tagOf(el);
    if (SKIP.has(tag)) return;
    const cs = getComputedStyle(el);

    // Not rendered at all: one record for the outermost hidden element, with all the text inside.
    if (el.hasAttribute('hidden') || cs.display === 'none') {
      const got = collect(el, { text: '', links: [] });
      const text = clean(got.text);
      if (text) push(el, { kind: 'block', text, links: got.links, hide: [{ code: el.hasAttribute('hidden') ? 'hidden-attr' : 'display-none', root: pathOf(el), detail: '' }] });
      return;
    }

    let path0 = null;
    const P = () => path0 || (path0 = pathOf(el)); // built only when needed (long pages)
    const r = el.getBoundingClientRect();
    const w = num(r.width, 0), h = num(r.height, 0);
    const own = ownText(el);
    const op = ctx.op * num(cs.opacity, 1);
    const next = Object.assign({}, ctx, { op });

    // Clipped to a 0/1px box (overflow hidden) or by a zero clip / clip-path.
    if (!ctx.clip) {
      const overflow = [cs.overflow, cs.overflowX, cs.overflowY].join(' ');
      const clipZero = /rect\(\s*0(px)?[\s,]+0(px)?[\s,]+0(px)?[\s,]+0(px)?\s*\)/.test(String(cs.clip || '')) || /inset\(\s*(50|100)%/.test(String(cs.clipPath || ''));
      if ((/hidden|clip/.test(overflow) && (w <= LIMITS.clipPx || h <= LIMITS.clipPx)) || clipZero) {
        const positioned = cs.position === 'absolute' || cs.position === 'fixed';
        next.clip = { root: P(), srOnly: positioned && w <= LIMITS.clipPx && h <= LIMITS.clipPx, detail: `${round(w)}×${round(h)} px box${clipZero ? ', clipped' : ', overflow hidden'}` };
      }
    }
    // Inside a closed <details> (everything but its summary).
    if (tag === 'details' && !el.hasAttribute('open') && !ctx.details) next.detailsRoot = P();
    // visibility is inherited but a child can switch it back on.
    next.visRoot = (cs.visibility === 'hidden' || cs.visibility === 'collapse') ? (ctx.visRoot || P()) : null;
    next.opRoot = op <= LIMITS.opacity ? (ctx.opRoot || P()) : null;
    const fontPx = num(cs.fontSize, 16);
    next.fontRoot = fontPx < LIMITS.tinyFontPx ? (ctx.fontRoot || P()) : null;
    const fixed = cs.position === 'fixed';
    const x = num(r.left, 0) + (fixed ? 0 : sx), y = num(r.top, 0) + (fixed ? 0 : sy);
    const off = (w > 0 || h > 0) && ((x < 0 && x + w <= 0) || (y < 0 && y + h <= 0) || x >= vw + LIMITS.farRightPx);
    next.offRoot = off ? (ctx.offRoot || P()) : null;

    if (own) {
      const hide = [];
      if (ctx.details) hide.push({ code: 'collapsed', root: ctx.details, detail: 'inside a closed <details>' });
      if (next.clip) hide.push({ code: next.clip.srOnly ? 'sr-only' : 'clipped', root: next.clip.root, detail: next.clip.detail });
      if (next.visRoot) hide.push({ code: 'visibility', root: next.visRoot, detail: cs.visibility === 'collapse' ? 'visibility: collapse' : '' });
      if (next.opRoot) hide.push({ code: 'opacity', root: next.opRoot, detail: 'opacity ' + (Math.round(op * 100) / 100) });
      if (next.offRoot) hide.push({ code: 'offscreen', root: next.offRoot, detail: `at x ${round(x)} px, y ${round(y)} px, ${round(w)}×${round(h)} px box` });
      const indent = num(cs.textIndent, 0);
      if (indent <= LIMITS.indentPx || (indent < 0 && w > 0 && -indent >= w)) hide.push({ code: 'indent', root: P(), detail: 'text-indent: ' + round(indent) + 'px' });
      if (next.fontRoot) hide.push({ code: 'tiny-font', root: next.fontRoot, detail: 'font-size: ' + (Math.round(fontPx * 10) / 10) + 'px' });
      push(el, {
        kind: 'text', text: own.slice(0, TEXT_MAX), links: [], hide,
        color: String(cs.color || ''), fill: String(cs.webkitTextFillColor || ''), clipText: /text/.test(String(cs.webkitBackgroundClip || cs.backgroundClip || '')),
        shadow: !!cs.textShadow && cs.textShadow !== 'none', layers: layersOf(el, cs),
      });
    }
    for (const ch of el.children) {
      const c = Object.assign({}, next);
      if (next.detailsRoot && tag === 'details') c.details = tagOf(ch) === 'summary' ? ctx.details : next.detailsRoot;
      delete c.detailsRoot;
      walk(ch, c);
    }
  }

  if (document.body) walk(document.body, { op: 1, clip: null, details: null, visRoot: null, opRoot: null, fontRoot: null, offRoot: null });
  return { url: String(location.href), title: String(document.title || ''), records, truncated, limits: LIMITS };
})();
