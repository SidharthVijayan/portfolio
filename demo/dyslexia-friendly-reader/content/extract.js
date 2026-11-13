// Injected on click via chrome.scripting.executeScript({ files: ['content/extract.js'] }).
// READ-ONLY: returns the text to show in the reader view. If the user has selected at least 3 words, that selection is used.
// Otherwise it picks the main content (the largest <article>, else <main> / role="main", else <body>) and lists its
// rendered headings, paragraphs, list items (with ordered/unordered kept), quotes and captions in page order, skipping
// navigation, page headers (an article's own <header> is kept), footers, sidebars, forms, tables, hidden and aria-hidden content. Images and media are not read.
// Never modifies the page. The last expression's value is returned to the popup.
(() => {
  const MAX_CHARS = 300000;
  const BLOCK = 'h1, h2, h3, h4, h5, h6, p, li, blockquote, dt, dd, figcaption';
  const SKIP = 'nav, header, footer, aside, form, table, [role="navigation"], [role="banner"], [role="contentinfo"], [role="complementary"], [role="search"], [aria-hidden="true"]';
  const clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const textOf = node => {
    let out = '';
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { out += n.nodeValue; continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName.toLowerCase();
      if (['script', 'style', 'template', 'noscript', 'svg', 'select', 'textarea', 'button', 'img', 'video', 'audio', 'iframe', 'canvas'].includes(tag)) continue;
      if (n.getAttribute('aria-hidden') === 'true') continue;
      out += (tag === 'br' ? ' ' : '') + textOf(n) + (['div', 'p', 'li'].includes(tag) ? ' ' : '');
    }
    return out;
  };
  const rendered = el => el.getClientRects().length > 0;
  const lang = (document.documentElement && document.documentElement.getAttribute && document.documentElement.getAttribute('lang')) || '';
  const base = { url: location.href, title: clean(document.title || ''), lang };

  const sel = typeof getSelection === 'function' ? getSelection() : null;
  const selText = sel ? String(sel) : '';
  if ((selText.match(/[\p{L}\p{N}]+/gu) || []).length >= 3) {
    const truncated = selText.length > MAX_CHARS;
    const blocks = selText.slice(0, MAX_CHARS).split(/\n\s*\n|\r?\n/).map(clean).filter(Boolean).map(text => ({ type: 'p', text }));
    return { ...base, source: 'selection', blocks, truncated };
  }

  let root = null, source = 'body', best = 0;
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
  function isInside(el, top) { for (let e = el; e; e = e.parentElement) if (e === top) return true; return false; }
  const lists = new Map();
  const blocks = [];
  let chars = 0, truncated = false;
  for (const el of root ? root.querySelectorAll(BLOCK) : []) {
    if (el.closest('[aria-hidden="true"]')) continue;
    const anc = el.closest(SKIP);
    // Page chrome inside the chosen root is skipped, except an article's own <header> (its title and standfirst).
    if (anc && anc !== root && isInside(anc, root) && !(root !== document.body && anc.tagName.toLowerCase() === 'header' && !anc.getAttribute('role'))) continue;
    const parent = el.parentElement && el.parentElement.closest(BLOCK);
    if (parent && isInside(parent, root)) continue; // the outer block already includes this text
    if (!rendered(el)) continue;
    const text = clean(textOf(el));
    if (!text) continue;
    if (chars + text.length > MAX_CHARS) { truncated = true; break; }
    chars += text.length;
    const tag = el.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) blocks.push({ type: 'h', level: Number(tag[1]), text });
    else if (tag === 'li') {
      const listEl = el.parentElement;
      const kind = listEl && listEl.tagName.toLowerCase() === 'ol' ? 'ol' : 'ul';
      if (!lists.has(listEl)) lists.set(listEl, lists.size + 1);
      blocks.push({ type: 'li', list: kind, listId: lists.get(listEl), text });
    } else if (tag === 'blockquote') blocks.push({ type: 'quote', text });
    else blocks.push({ type: 'p', text });
  }
  return { ...base, source, blocks, truncated };
})();
