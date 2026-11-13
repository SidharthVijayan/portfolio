// Injected on click via chrome.scripting.executeScript({ files: ['content/extract.js'] }).
// READ-ONLY: returns the text to measure. If the user has selected at least 3 words, that selection is used.
// Otherwise it picks the main content (the largest <article>, else <main> / role="main", else <body>) and lists its
// rendered prose blocks (paragraphs, list items, quotes, captions, table cells), skipping headings, navigation,
// headers, footers, sidebars, forms and aria-hidden content. Also returns a CSS path per block for "Show on page".
// Never modifies the page. The last expression's value is returned to the popup.
(() => {
  const MAX_CHARS = 200000;
  const BLOCK = 'p, li, blockquote, dd, figcaption, td, th';
  const SKIP = 'nav, header, footer, aside, form, [role="navigation"], [role="banner"], [role="contentinfo"], [role="complementary"], [role="search"], [aria-hidden="true"]';
  const clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const textOf = node => {
    let out = '';
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { out += n.nodeValue; continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName.toLowerCase();
      if (['script', 'style', 'template', 'noscript', 'svg', 'select', 'textarea', 'button'].includes(tag)) continue;
      if (n.getAttribute('aria-hidden') === 'true') continue;
      out += (tag === 'br' ? ' ' : '') + textOf(n) + (['div', 'p', 'li'].includes(tag) ? ' ' : '');
    }
    return out;
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
  const rendered = el => el.getClientRects().length > 0;

  const sel = typeof getSelection === 'function' ? getSelection() : null;
  const selText = sel ? String(sel) : '';
  if ((selText.match(/[\p{L}\p{N}]+/gu) || []).length >= 3) {
    let node = sel.anchorNode || null;
    if (node && node.nodeType !== 1) node = node.parentElement || null;
    const blocks = selText.split(/\n\s*\n|\r?\n/).map(clean).filter(Boolean).map(text => ({ tag: 'selection', path: node ? pathOf(node) : null, text }));
    const truncated = selText.length > MAX_CHARS;
    return { url: location.href, title: document.title || '', source: 'selection', blocks: truncated ? blocks.slice(0, 1).map(b => ({ ...b, text: b.text.slice(0, MAX_CHARS) })) : blocks, truncated };
  }

  let root = null, source = 'body';
  let best = 0;
  for (const a of document.querySelectorAll('article')) {
    if (!rendered(a) || a.closest(SKIP)) continue;
    const len = clean(textOf(a)).length;
    if (len > best) { best = len; root = a; }
  }
  if (root) source = 'article';
  else {
    root = document.querySelectorAll('main')[0] || document.querySelectorAll('[role="main"]')[0] || null;
    if (root) source = 'main';
    else root = document.body;
  }
  const blocks = [];
  let chars = 0, truncated = false;
  for (const el of root ? root.querySelectorAll(BLOCK) : []) {
    if (el.closest(SKIP)) continue;
    const parent = el.parentElement && el.parentElement.closest(BLOCK);
    if (parent && isInside(parent, root)) continue; // the outer block already includes this text
    if (!rendered(el)) continue;
    const text = clean(textOf(el));
    if (!text) continue;
    if (chars + text.length > MAX_CHARS) { truncated = true; break; }
    chars += text.length;
    blocks.push({ tag: el.tagName.toLowerCase(), path: pathOf(el), text });
  }
  function isInside(el, top) { for (let e = el; e; e = e.parentElement) if (e === top) return true; return false; }
  return { url: location.href, title: document.title || '', source, blocks, truncated };
})();
