// Copy as Markdown: read-only page reader, injected once per click (activeTab + scripting).
// If the user has selected something, it walks only the selected part of the page; otherwise it
// walks the page's main article (<article>, then <main> / [role=main], then <body> without
// navigation, sidebars and footers). Hidden elements, scripts, styles, form fields and embedded frames
// are skipped. It returns a small plain tree (tag, a few attributes, children, text) for the
// popup to turn into Markdown. It never changes the page and sends nothing anywhere.
(() => {
  'use strict';
  const MAX_NODES = 20000;
  const SKIP = new Set(['script', 'style', 'noscript', 'template', 'svg', 'canvas', 'iframe', 'frame', 'object', 'embed',
    'video', 'audio', 'map', 'button', 'select', 'textarea', 'head', 'meta', 'link', 'title', 'dialog']);
  const CHROME_PARTS = new Set(['nav', 'aside', 'footer']);
  const CHROME_ROLES = /^(navigation|complementary|contentinfo|banner|search)$/;
  const KEEP = { a: ['href'], img: ['src', 'alt', 'data-src'], pre: ['class'], code: ['class'], ol: ['start'], th: ['colspan'], td: ['colspan'], input: ['type'] };
  const WRAP = new Set(['a', 'strong', 'b', 'em', 'i', 'code', 'del', 's', 'strike', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote']);
  let count = 0, truncated = false;

  const tagOf = el => String(el.tagName || '').toLowerCase();
  function hidden(el) {
    if (el.hasAttribute && (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true')) return true;
    const cs = getComputedStyle(el);
    return !cs || cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse';
  }

  const sel = typeof getSelection === 'function' ? getSelection() : null;
  let range = null;
  if (sel && sel.rangeCount && !sel.isCollapsed && String(sel).trim()) range = sel.getRangeAt(0);

  let root, source;
  if (range) {
    root = range.commonAncestorContainer;
    if (root.nodeType === 3) root = root.parentElement || root.parentNode;
    source = 'selection';
  } else {
    root = document.querySelector('article');
    source = 'article';
    if (!root) { root = document.querySelector('main') || document.querySelector('[role="main"]'); source = 'main'; }
    if (!root) { root = document.body; source = 'body'; }
  }

  // A label around a text box, menu or text area is form chrome, not content (task-list checkboxes are kept).
  function isFieldLabel(el) {
    for (const ch of el.children) {
      const t = tagOf(ch);
      if (t === 'select' || t === 'textarea' || (t === 'input' && String(ch.getAttribute('type') || 'text').toLowerCase() !== 'checkbox')) return true;
      if (isFieldLabel(ch)) return true;
    }
    return false;
  }

  function attrsOf(el, tag) {
    const out = {};
    for (const k of KEEP[tag] || []) { const v = el.getAttribute(k); if (v != null && v !== '') out[k] = v; }
    if (tag === 'input') { if (out.type !== 'checkbox') return null; out.checked = !!el.checked || el.hasAttribute('checked'); }
    if (tag === 'li' && el.parentElement && tagOf(el.parentElement) === 'ol') {
      const v = el.getAttribute('value');
      if (v != null && /^-?\d+$/.test(v)) out.value = v;
      else {
        let n = parseInt(el.parentElement.getAttribute('start'), 10); if (!Number.isFinite(n)) n = 1;
        for (const sib of el.parentElement.children) { if (sib === el) break; if (tagOf(sib) === 'li') n++; }
        out.value = String(n);
      }
    }
    return out;
  }

  function walk(node, isRoot) {
    if (truncated) return null;
    if (++count > MAX_NODES) { truncated = true; return null; }
    if (node.nodeType === 3) {
      let s = node.nodeValue || '';
      if (range) {
        if (node === range.endContainer) s = s.slice(0, range.endOffset);
        if (node === range.startContainer) s = s.slice(range.startOffset);
      }
      return s ? s : null;
    }
    if (node.nodeType !== 1) return null;
    const tag = tagOf(node);
    if (SKIP.has(tag)) return null;
    if (range && !isRoot && !range.intersectsNode(node)) return null;
    if (hidden(node)) return null;
    if (tag === 'label' && isFieldLabel(node)) return null;
    if (!range && !isRoot && (CHROME_PARTS.has(tag) || CHROME_ROLES.test(node.getAttribute('role') || ''))) return null;
    const a = attrsOf(node, tag);
    if (a === null) return null;
    const c = [];
    if (tag !== 'img' && tag !== 'input') {
      for (const ch of node.childNodes) {
        if (range && ch.nodeType === 3 && !range.intersectsNode(ch)) continue;
        const r = walk(ch, false); if (r != null) c.push(r);
      }
    }
    if (tag === 'img' && !a.src && !a['data-src']) return null;
    return { t: tag, a, c };
  }

  let tree = root ? walk(root, true) : null;
  if (tree && range) {
    for (let p = root.parentElement; p && tagOf(p) !== 'body'; p = p.parentElement) {
      const tag = tagOf(p);
      if (WRAP.has(tag)) tree = { t: tag, a: attrsOf(p, tag) || {}, c: [tree] };
      else if ((tag === 'ul' || tag === 'ol') && tree.t === 'li') tree = { t: tag, a: attrsOf(p, tag) || {}, c: [tree] };
    }
  }
  return {
    url: String(location.href),
    title: String(document.title || ''),
    source,
    rootTag: root ? tagOf(root) : '',
    tree,
    truncated,
  };
})();
