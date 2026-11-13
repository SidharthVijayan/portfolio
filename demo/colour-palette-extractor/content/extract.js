// Injected on click via chrome.scripting.executeScript({ files: ['content/extract.js'] }).
// READ-ONLY: walks visible elements and returns each one's computed text colour, resolved
// background colour (walking ancestors through transparent backgrounds) and border colour
// when a border is present. Skips script/style/media chrome, hidden or zero-size nodes.
// Makes no requests and never modifies the page. Distinct from Contrast Checker (no ratios)
// and Font Finder (no fonts).
(() => {
  const MAX = 8000;
  const SKIP = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'CANVAS', 'HEAD', 'TITLE', 'META', 'LINK',
    'BR', 'HR', 'IMG', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'IFRAME', 'OBJECT', 'EMBED',
    'VIDEO', 'AUDIO', 'SOURCE', 'TRACK', 'MAP', 'AREA', 'PICTURE', 'PARAM', 'COL', 'COLGROUP',
  ]);
  const clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const isTransparent = c => {
    c = String(c || '').trim().toLowerCase();
    if (!c || c === 'transparent') return true;
    const h = /^#([0-9a-f]{3,8})$/.exec(c);
    if (h) {
      const hex = h[1];
      if (hex.length === 4) return hex[3] === '0';
      if (hex.length === 8) return hex.slice(6) === '00';
      return false;
    }
    const m = /^rgba?\(([^)]*)\)$/.exec(c);
    if (!m) return false;
    const p = m[1].split(/[\s,/]+/).filter(Boolean);
    if (p.length < 4) return false;
    return p[3].endsWith('%') ? parseFloat(p[3]) <= 0 : parseFloat(p[3]) <= 0;
  };
  const borderWidth = cs => {
    const sides = [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth];
    return sides.some(w => (parseFloat(w) || 0) > 0);
  };
  const items = [];
  let scanned = 0, total = 0, truncated = false;
  const root = document.body || document.documentElement;
  if (!root) return { url: location.href, protocol: location.protocol, title: clean(document.title || ''), items, scanned: 0, total: 0, truncated: false };

  const push = (color, role, tag) => {
    if (!color || isTransparent(color)) return;
    if (items.length >= MAX) { truncated = true; return; }
    items.push({ color: String(color), role, tag });
  };

  for (const el of root.querySelectorAll('*')) {
    if (SKIP.has(el.tagName)) continue;
    if (el.closest('svg, canvas, noscript, template, script, style, select, textarea')) continue;
    let cs;
    try { cs = getComputedStyle(el); } catch (e) { continue; }
    if (!cs || cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') continue;
    const opacity = parseFloat(cs.opacity == null || cs.opacity === '' ? 1 : cs.opacity);
    if (!(opacity > 0)) continue;
    let r;
    try { r = el.getBoundingClientRect(); } catch (e) { continue; }
    if (!(r && r.width > 1 && r.height > 1)) continue;
    scanned++;
    total++;
    if (items.length >= MAX) { truncated = true; continue; }

    const tag = String(el.tagName || '').toLowerCase();
    const hasText = clean([...el.childNodes].filter(n => n.nodeType === 3).map(n => n.nodeValue).join(' '));

    // Text colour only when the element directly contains visible text.
    if (hasText) push(cs.color, 'text', tag);

    // Background: walk ancestors until an opaque (non-transparent) background is found.
    let bg = null;
    for (let e = el; e; e = e.parentElement) {
      let s;
      try { s = e === el ? cs : getComputedStyle(e); } catch (err) { break; }
      const bc = s.backgroundColor;
      if (!isTransparent(bc)) { bg = bc; break; }
    }
    // Canvas default is white when nothing opaque is found.
    push(bg || 'rgb(255, 255, 255)', 'background', tag);

    // Border colour when any side has a width.
    if (borderWidth(cs)) {
      const bc = cs.borderTopColor || cs.borderColor || cs.borderRightColor;
      push(bc, 'border', tag);
    }
  }
  return {
    url: location.href,
    protocol: location.protocol,
    title: clean(document.title || ''),
    items,
    scanned,
    total,
    truncated: truncated || false,
  };
})();
