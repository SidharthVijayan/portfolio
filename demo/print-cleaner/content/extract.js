// Print Cleaner: read-only page reader, injected into the active tab once per click (activeTab + scripting).
// It walks the page once in tree order (at most 20,000 elements) and describes each element: tag, id, class,
// role, aria-label, whether it is fixed or sticky, the amount of text and link text inside it, a word count
// and a short text snippet. It keeps references to those elements in the extension's isolated world
// (self.__pcEls) so content/apply.js can hide the chosen ones later. It changes nothing on the page.
// Elements the page already hides (display:none) are left out, because they don't print anyway; elements
// hidden by Print Cleaner itself (data-print-cleaner-hide) are still described, so reopening the popup on a
// cleaned page gives the same result, plus what is currently removed.
(() => {
  'use strict';
  const MAX = 20000;
  const SKIP = new Set(['script', 'style', 'noscript', 'template', 'link', 'meta', 'base', 'title', 'head', 'br', 'wbr',
    'source', 'track', 'param', 'option', 'optgroup', 'datalist']);
  const LEAF = new Set(['svg', 'math', 'iframe', 'frame', 'video', 'audio', 'canvas', 'object', 'embed', 'select', 'textarea', 'img', 'picture']);
  const HIDE = 'data-print-cleaner-hide', UI = 'data-print-cleaner-ui';
  const AD_ATTRS = ['data-ad-slot', 'data-ad-client', 'data-ad-unit', 'data-ad', 'data-google-query-id'];
  const items = [], els = [], index = new Map();
  let truncated = false;
  const hostOf = src => { try { return src ? new URL(src, document.baseURI).hostname.toLowerCase() : ''; } catch (e) { return ''; } };

  function walk(node, pi, ours) {
    let c = 0, l = 0, w = 0, s = '';
    for (const ch of node.childNodes) {
      if (ch.nodeType === 3) {
        const t = ch.nodeValue.replace(/\s+/g, ' ').trim();
        if (t) { c += t.length; w += t.split(' ').length; if (s.length < 80) s += ' ' + t; }
        continue;
      }
      if (ch.nodeType !== 1) continue;
      const tag = String(ch.tagName).toLowerCase();
      if (SKIP.has(tag) || ch.hasAttribute(UI)) continue;
      if (items.length >= MAX) { truncated = true; break; }
      const mine = ours || ch.hasAttribute(HIDE);
      const cs = getComputedStyle(ch);
      if (cs.display === 'none' && !mine) continue; // already hidden by the page: it doesn't print
      const i = items.length;
      const it = { i, p: pi, tag, id: String(ch.getAttribute('id') || '').slice(0, 100), cls: String(ch.getAttribute('class') || '').slice(0, 200),
        role: String(ch.getAttribute('role') || '').toLowerCase(), lbl: String(ch.getAttribute('aria-label') || '').slice(0, 80) };
      if (cs.position === 'fixed' || cs.position === 'sticky') it.pos = cs.position;
      if (ch.getAttribute('aria-modal') === 'true') it.modal = true;
      if (/\barticleBody\b/.test(ch.getAttribute('itemprop') || '')) it.body = true;
      if (AD_ATTRS.some(a => ch.hasAttribute(a))) it.ad = true;
      if (tag === 'iframe' || tag === 'frame' || tag === 'embed') it.host = hostOf(ch.getAttribute('src'));
      if (tag === 'object') it.host = hostOf(ch.getAttribute('data'));
      if (ch.hasAttribute('title') && (tag === 'iframe' || tag === 'frame' || tag === 'embed' || tag === 'object' || tag === 'video')) it.ttl = String(ch.getAttribute('title')).slice(0, 80);
      if (mine) it.off = true;
      items.push(it); els.push(ch); index.set(ch, i);
      const r = LEAF.has(tag) ? { c: 0, l: 0, w: 0, s: tag === 'img' ? String(ch.getAttribute('alt') || '') : '' } : walk(ch, i, mine);
      it.c = r.c; it.w = r.w; it.l = tag === 'a' ? r.c : r.l;
      it.s = r.s.replace(/\s+/g, ' ').trim().slice(0, 80);
      c += r.c; l += it.l; w += r.w;
      if (s.length < 80 && r.s) s += ' ' + r.s;
    }
    return { c, l, w, s };
  }
  if (document.body) walk(document.body, -1, false);
  self.__pcEls = els;
  let applied = null;
  const st = self.__pcState;
  if (st && st.hidden) {
    applied = { auto: [], pick: [], links: !!st.links };
    for (const [el, how] of st.hidden) if (index.has(el)) applied[how === 'pick' ? 'pick' : 'auto'].push(index.get(el));
    applied.auto.sort((a, b) => a - b); applied.pick.sort((a, b) => a - b);
  }
  return { url: String(location.href), title: String(document.title || ''), items, truncated, applied };
})();
