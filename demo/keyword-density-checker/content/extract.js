// Keyword Density Checker: read-only page reader, injected on click via
// chrome.scripting.executeScript({ files: ['content/extract.js'] }).
// If the user has selected at least 20 words, that selection is used. Otherwise it picks the main content (the
// largest <article>, else <main> / role="main", else <body>) and lists its rendered headings and prose blocks
// (paragraphs, list items, quotes, captions, table cells), skipping navigation, site header and footer, sidebars,
// forms, scripts and hidden text. Also returns the page title and its H1 headings so the popup can say whether a
// keyword appears there. Never modifies the page. The last expression's value is returned to the popup.
(() => {
  const MAX_CHARS = 200000;
  const MIN_SELECTED_WORDS = 20;
  const BLOCK = 'h1, h2, h3, h4, h5, h6, p, li, blockquote, dd, dt, figcaption, td, th';
  const SKIP = 'nav, header, footer, aside, form, [role="navigation"], [role="banner"], [role="contentinfo"], [role="complementary"], [role="search"], [aria-hidden="true"]';
  const clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const textOf = node => {
    let out = '';
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { out += n.nodeValue; continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName.toLowerCase();
      if (['script', 'style', 'template', 'noscript', 'svg', 'select', 'textarea', 'button', 'iframe'].includes(tag)) continue;
      if (n.getAttribute('aria-hidden') === 'true' || n.getAttribute('hidden') != null) continue;
      if (!n.getClientRects().length && !(typeof getComputedStyle === 'function' && getComputedStyle(n).display === 'contents')) continue;
      const blockish = ['div', 'p', 'li', 'br', 'tr', 'td', 'th', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'section', 'ul', 'ol'].includes(tag);
      out += (blockish ? ' \n ' : '') + textOf(n) + (blockish ? ' \n ' : '');
    }
    return out;
  };
  const rendered = el => el.getClientRects().length > 0;
  const isInside = (el, top) => { for (let e = el; e; e = e.parentElement) if (e === top) return true; return false; };
  // Inside the chosen area: menus, sidebars, forms and hidden parts are always left out; a <header> is kept when it
  // belongs to the article (its title and standfirst) but left out when the area is the whole page (site header).
  const ALWAYS = 'nav, aside, form, [role="navigation"], [role="complementary"], [role="search"], [aria-hidden="true"]';
  const skipped = (el, top) => {
    for (let e = el; e && e !== top; e = e.parentElement) {
      if (e.matches(ALWAYS)) return true;
      if (e.matches('footer, [role="contentinfo"], [role="banner"]')) return true;
      if (e.matches('header') && top === document.body) return true;
    }
    return false;
  };
  const h1 = [];
  for (const el of document.querySelectorAll('h1')) {
    if (!rendered(el)) continue;
    const t = clean(textOf(el));
    if (t) h1.push(t.slice(0, 300));
  }
  const base = { url: location.href, title: clean(document.title).slice(0, 300), h1: h1.slice(0, 10) };

  const sel = typeof getSelection === 'function' ? getSelection() : null;
  const selText = sel ? String(sel) : '';
  if ((selText.match(/[\p{L}\p{N}]+/gu) || []).length >= MIN_SELECTED_WORDS) {
    const truncated = selText.length > MAX_CHARS;
    const blocks = selText.slice(0, MAX_CHARS).split(/\r?\n/).map(clean).filter(Boolean).map(text => ({ tag: 'selection', text }));
    return Object.assign(base, { source: 'selection', blocks, truncated });
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
    if (root && rendered(root)) source = 'main';
    else root = document.body;
  }
  const blocks = [];
  let chars = 0, truncated = false;
  const add = (tag, text) => {
    if (!text) return true;
    if (chars + text.length > MAX_CHARS) { truncated = true; return false; }
    chars += text.length;
    blocks.push({ tag, text });
    return true;
  };
  for (const el of root ? root.querySelectorAll(BLOCK) : []) {
    if (skipped(el, root)) continue;
    const parent = el.parentElement && el.parentElement.closest(BLOCK);
    if (parent && isInside(parent, root)) continue; // the outer block already includes this text
    if (!rendered(el)) continue;
    if (!add(el.tagName.toLowerCase(), clean(textOf(el)))) break;
  }
  // Pages that keep their text in plain <div>s: fall back to the main area's rendered text, line by line.
  if (!blocks.length && root) {
    for (const line of textOf(root).split('\n')) if (!add('text', clean(line))) break;
  }
  return Object.assign(base, { source, blocks, truncated });
})();
