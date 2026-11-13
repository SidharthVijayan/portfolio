// Injected on click via chrome.scripting.executeScript({ files: ['content/extract.js'] }).
// READ-ONLY: walks visible elements that directly contain text and returns each one's computed
// font-family, font-weight, font-size and font-style (via getComputedStyle), plus a short tag and
// a small text sample. Skips script/style/media/form-control chrome, hidden or zero-size nodes,
// and elements whose only text lives in descendants. Makes no requests and never modifies the page.
(() => {
  const MAX = 8000;
  const SKIP = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'CANVAS', 'HEAD', 'TITLE', 'META', 'LINK',
    'BR', 'HR', 'IMG', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'IFRAME', 'OBJECT', 'EMBED',
    'VIDEO', 'AUDIO', 'SOURCE', 'TRACK', 'MAP', 'AREA', 'PICTURE', 'PARAM', 'COL', 'COLGROUP',
  ]);
  const clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const items = [];
  let scanned = 0, total = 0, truncated = false;
  const root = document.body || document.documentElement;
  if (!root) return { url: location.href, protocol: location.protocol, title: clean(document.title || ''), items, scanned: 0, total: 0, truncated: false };

  for (const el of root.querySelectorAll('*')) {
    if (SKIP.has(el.tagName)) continue;
    if (el.closest('svg, canvas, noscript, template, script, style, select, textarea')) continue;
    const text = clean([...el.childNodes].filter(n => n.nodeType === 3).map(n => n.nodeValue).join(' '));
    if (!text) continue;
    scanned++;
    let cs;
    try { cs = getComputedStyle(el); } catch (e) { continue; }
    if (!cs || cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') continue;
    const opacity = parseFloat(cs.opacity == null || cs.opacity === '' ? 1 : cs.opacity);
    if (!(opacity > 0)) continue;
    let r;
    try { r = el.getBoundingClientRect(); } catch (e) { continue; }
    if (!(r && r.width > 1 && r.height > 1)) continue;
    total++;
    if (items.length >= MAX) { truncated = true; continue; }
    items.push({
      family: String(cs.fontFamily || ''),
      weight: String(cs.fontWeight || '400'),
      size: parseFloat(cs.fontSize) || 0,
      style: String(cs.fontStyle || 'normal'),
      tag: String(el.tagName || '').toLowerCase(),
      sample: text.slice(0, 48),
    });
  }
  return {
    url: location.href,
    protocol: location.protocol,
    title: clean(document.title || ''),
    items,
    scanned,
    total,
    truncated: truncated || total > items.length,
  };
})();
