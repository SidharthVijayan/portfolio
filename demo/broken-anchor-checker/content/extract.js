// Injected on click via chrome.scripting.executeScript({ files: ['content/extract.js'] }).
// READ-ONLY: walks the page once in document order and returns
//   - every link (<a href>, image-map <area href>) with its address as written and as resolved, its text and a CSS path;
//   - every id on the page (how many elements share it, the first one's tag and path), and every <a name>;
//   - for the ids/names that links point to: whether the first such element is displayed, or sits in a closed
//     <details> / hidden="until-found" block (which the browser opens when you jump to it).
// It never changes the page, scrolls nothing and sends nothing. The last expression's value goes back to the popup.
(() => {
  const MAX_ELEMENTS = 50000, MAX_LINKS = 10000, MAX_TEXT = 120;
  const clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const tagOf = e => String(e.tagName || '').toLowerCase();
  const pathOf = el => {
    const parts = [];
    for (let e = el; e && e.parentElement; e = e.parentElement) {
      const tag = tagOf(e);
      const same = [...e.parentElement.children].filter(x => tagOf(x) === tag);
      parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(e) + 1})` : tag);
    }
    return parts.join(' > ');
  };
  const base = String(document.baseURI || location.href);
  const ids = new Map(), names = new Map(), links = [];
  let count = 0, truncated = false, totalLinks = 0;

  const linkText = el => {
    let t = tagOf(el) === 'area' ? clean(el.getAttribute('alt')) : clean(el.textContent);
    if (!t && el.querySelector) { const img = el.querySelector('img[alt]'); if (img) t = clean(img.getAttribute('alt')); }
    if (!t) t = clean(el.getAttribute('aria-label')) || clean(el.getAttribute('title'));
    return t.length > MAX_TEXT ? t.slice(0, MAX_TEXT - 1) + '…' : t;
  };

  const root = document.documentElement;
  const stack = root ? [root] : [];
  while (stack.length) {
    const el = stack.pop();
    if (++count > MAX_ELEMENTS) { truncated = true; break; }
    const tag = tagOf(el);
    const id = el.getAttribute('id');
    if (id) { const t = ids.get(id); if (t) t.count++; else ids.set(id, { el, count: 1 }); }
    if (tag === 'a' && el.hasAttribute('name')) {
      const n = el.getAttribute('name');
      if (n) { const t = names.get(n); if (t) t.count++; else names.set(n, { el, count: 1 }); }
    }
    if ((tag === 'a' || tag === 'area') && el.hasAttribute('href')) {
      totalLinks++;
      if (links.length < MAX_LINKS) {
        const raw = String(el.getAttribute('href')).trim();
        let href = '';
        try { href = String(new URL(raw, base)); } catch (e) { href = ''; }
        links.push({ raw: raw.slice(0, 2000), href: href.slice(0, 2000), text: linkText(el), path: pathOf(el) });
      }
    }
    const kids = el.children;
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
  }

  // Which ids/names do links point to? Only those targets get the (layout-reading) display check.
  const wanted = new Set();
  for (const l of links) {
    const i = l.href.indexOf('#'); if (i < 0) continue;
    let f = l.href.slice(i + 1); const d = f.indexOf(':~:'); if (d >= 0) f = f.slice(0, d);
    wanted.add(f); try { wanted.add(decodeURIComponent(f)); } catch (e) { /* not valid percent-encoding */ }
  }
  const opensOnJump = el => {
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      if (String(e.getAttribute('hidden')).toLowerCase() === 'until-found') return true;
      const p = e.parentElement;
      if (p && tagOf(p) === 'details' && !p.hasAttribute('open') && tagOf(e) !== 'summary') return true;
    }
    return false;
  };
  const describe = (key, t) => {
    const out = { key, count: t.count, tag: tagOf(t.el) };
    if (wanted.has(key)) {
      out.path = pathOf(t.el);
      out.opens = opensOnJump(t.el);
      let shown = true;
      try { shown = t.el.getClientRects().length > 0; } catch (e) { shown = true; }
      out.hidden = !shown && !out.opens;
    }
    return out;
  };

  return {
    url: String(location.href), base, title: clean(document.title || ''),
    links, totalLinks, truncated, elements: Math.min(count, MAX_ELEMENTS),
    ids: [...ids].map(([k, t]) => describe(k, t)),
    names: [...names].map(([k, t]) => describe(k, t)),
  };
})();
