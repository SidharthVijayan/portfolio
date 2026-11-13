// Injected on click via chrome.scripting.executeScript({ files: ['content/extract.js'] }).
// READ-ONLY: collects the raw date evidence a page carries and returns it to the popup:
//   - <meta> tags whose name/property/itemprop/http-equiv mentions a date, time, publish,
//     modify, update, create, issue or revise (key + content)
//   - JSON-LD blocks (<script type="application/ld+json">) as raw text, parsed later in core.js
//   - microdata elements (not <meta>) with itemprop datePublished/dateModified/dateCreated/uploadDate
//   - <time> elements: datetime attribute, visible text, pubdate, itemprop, whether shown
//   - short visible text lines that mention "published", "posted", "updated", "modified",
//     "reviewed", "created" or "written" next to a number (hidden elements and scripts skipped)
//   - the page address (its path may hold /2025/03/04/)
// Makes no requests and never modifies the page.
(() => {
  const MAX_META = 200, MAX_LD = 30, MAX_LD_CHARS = 300000, MAX_TIMES = 300, MAX_LINES = 60, MAX_LINE = 240;
  const KEY_RE = /date|time|publi|modif|updat|creat|issued|revis|lastmod/i;
  const LABEL_RE = /\b(published|publish|posted|updated|update|modified|reviewed|created|written|issued|revised|edited)\b/i;
  const SKIP = new Set(['script', 'style', 'template', 'noscript', 'svg', 'head']);
  const BLOCK = new Set(['p', 'div', 'li', 'ul', 'ol', 'dl', 'dt', 'dd', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'section', 'article', 'header', 'footer', 'aside', 'nav', 'main', 'figure', 'figcaption', 'address', 'table', 'tr', 'td', 'th', 'br', 'hr']);
  const tagOf = el => String(el.tagName || '').toLowerCase();
  const oneLine = s => String(s == null ? '' : s).replace(/[\s\u00a0\u200b]+/g, ' ').trim();
  const attr = (el, k) => { const v = el.getAttribute(k); return v == null ? '' : String(v); };
  const isHidden = el => {
    if (el.hasAttribute && el.hasAttribute('hidden')) return true;
    let s = null; try { s = getComputedStyle(el); } catch (e) { s = null; }
    return !!s && (s.display === 'none' || s.visibility === 'hidden');
  };
  const shown = el => !!(el.getClientRects && el.getClientRects().length);

  const out = { url: location.href, title: oneLine(document.title), meta: [], ld: [], micro: [], times: [], lines: [], truncated: false };

  for (const m of document.querySelectorAll('meta')) {
    const key = oneLine(attr(m, 'property') || attr(m, 'name') || attr(m, 'itemprop') || attr(m, 'http-equiv')).toLowerCase();
    const content = oneLine(attr(m, 'content'));
    if (!key || !content || !KEY_RE.test(key)) continue;
    if (out.meta.length >= MAX_META) { out.truncated = true; break; }
    out.meta.push({ key, content: content.slice(0, 200) });
  }

  for (const s of document.querySelectorAll('script')) {
    if (!/^\s*application\/ld\+json\s*$/i.test(attr(s, 'type'))) continue;
    if (out.ld.length >= MAX_LD) { out.truncated = true; break; }
    out.ld.push(String(s.textContent || '').slice(0, MAX_LD_CHARS));
  }

  for (const el of document.querySelectorAll('*')) {
    const t = tagOf(el);
    if (t === 'meta') continue;
    const prop = attr(el, 'itemprop').trim();
    if (!/^(datePublished|dateModified|dateCreated|uploadDate)$/i.test(prop)) continue;
    const value = oneLine(attr(el, 'datetime') || attr(el, 'content') || el.textContent).slice(0, 200);
    if (value) out.micro.push({ prop, value, tag: t });
    if (out.micro.length >= MAX_META) break;
  }

  for (const el of document.querySelectorAll('time')) {
    if (out.times.length >= MAX_TIMES) { out.truncated = true; break; }
    let inArticle = false, inComment = false;
    for (let p = el.parentElement; p; p = p.parentElement) {
      const pt = tagOf(p), cls = (attr(p, 'class') + ' ' + attr(p, 'id')).toLowerCase();
      if (pt === 'article' || pt === 'main' || pt === 'header') inArticle = true;
      if (/comment|reply|sidebar|related|footer/.test(cls) || pt === 'aside' || pt === 'footer') inComment = true;
    }
    out.times.push({
      dt: oneLine(attr(el, 'datetime')).slice(0, 80), text: oneLine(el.textContent).slice(0, 120),
      pubdate: el.hasAttribute('pubdate'), itemprop: oneLine(attr(el, 'itemprop')), cls: oneLine(attr(el, 'class')).slice(0, 80),
      shown: shown(el), inArticle, aside: inComment,
    });
  }

  // Visible text, block by block, to find "Published on ..." / "Last updated: ..." lines.
  const parts = [];
  const walk = node => {
    for (const c of node.childNodes || []) {
      if (c.nodeType === 3) { parts.push(c.nodeValue); continue; }
      if (c.nodeType !== 1) continue;
      const t = tagOf(c);
      if (SKIP.has(t) || isHidden(c)) continue;
      const block = BLOCK.has(t);
      if (block) parts.push('\n');
      walk(c);
      if (block) parts.push('\n');
    }
  };
  if (document.body) walk(document.body);
  for (const raw of parts.join('').split('\n')) {
    const line = oneLine(raw);
    if (!line || !LABEL_RE.test(line) || !/\d/.test(line)) continue;
    if (out.lines.length >= MAX_LINES) { out.truncated = true; break; }
    out.lines.push(line.slice(0, MAX_LINE));
  }
  return out;
})();
