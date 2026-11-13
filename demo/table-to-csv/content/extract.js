// Injected on click via chrome.scripting.executeScript({ files: ['content/extract.js'] }).
// READ-ONLY: lists every <table> on the page with its caption, aria-label and the nearest heading
// before it, whether it is shown, nested inside another table or marked as a layout table
// (role="presentation"/"none"), and its rows in table order (thead first, tfoot last). Each row
// says which row group it is in and whether it is hidden; each cell gives its text (line breaks
// from <br> and blocks kept as \n, image alt text included, hidden elements, scripts and nested
// tables left out), whether it is a <th>, and its colspan/rowspan. Makes no requests and never
// modifies the page.
(() => {
  const MAX_TABLES = 200, MAX_ROWS = 10000;
  const SKIP = new Set(['script', 'style', 'template', 'noscript']);
  const BLOCK = new Set(['table', 'tr', 'td', 'th', 'caption', 'p', 'div', 'li', 'ul', 'ol', 'dl', 'dt', 'dd', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'section', 'article', 'header', 'footer', 'figure', 'figcaption', 'address', 'hr']);
  const tagOf = el => String(el.tagName || '').toLowerCase();
  const cs = el => { try { return getComputedStyle(el); } catch (e) { return null; } };
  const isHidden = el => {
    if (el.hasAttribute && el.hasAttribute('hidden')) return true;
    const s = cs(el);
    return !!s && (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse');
  };
  const oneLine = s => String(s == null ? '' : s).replace(/[\s\u00a0]+/g, ' ').trim();
  let nestedCells = 0;

  function textOf(node, out) {
    for (const c of node.childNodes || []) {
      if (c.nodeType === 3) { out.push(c.nodeValue); continue; }
      if (c.nodeType !== 1) continue;
      const t = tagOf(c);
      if (t === 'table' && !isLayout(c)) { nestedCells++; continue; } // listed as its own table
      if (SKIP.has(t)) continue;
      if (t === 'br') { out.push('\n'); continue; }
      if (isHidden(c)) continue;
      if (t === 'img') { const alt = oneLine(c.getAttribute('alt')); if (alt) out.push(' ' + alt + ' '); continue; }
      const block = BLOCK.has(t);
      if (block) out.push('\n');
      textOf(c, out);
      if (block) out.push('\n');
    }
    return out;
  }
  const spanOf = (el, k, max, zeroOk) => {
    const v = String(el.getAttribute(k) == null ? '' : el.getAttribute(k)).trim();
    if (!/^\d+/.test(v)) return 1;
    const n = parseInt(v, 10);
    if (n === 0) return zeroOk ? 0 : 1;
    return Math.min(n, max);
  };
  const kids = el => Array.from(el.children || []);
  const isLayout = el => /^(presentation|none)$/.test(String(el.getAttribute('role') || '').trim().toLowerCase());

  const out = { url: location.href, title: oneLine(document.title), tables: [], total: 0, truncated: false };
  const all = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6, table'));
  const index = new Map();
  let heading = '', headingFresh = false;
  for (const el of all) {
    const t = tagOf(el);
    let inTable = null; // nearest data table around it (layout tables don't count)
    for (let p = el.parentElement; p; p = p.parentElement) if (tagOf(p) === 'table' && !isLayout(p)) { inTable = p; break; }
    if (t !== 'table') { if (!inTable) { heading = oneLine(el.textContent); headingFresh = true; } continue; }
    out.total++;
    if (out.tables.length >= MAX_TABLES) { out.truncated = true; continue; }
    const caption = kids(el).find(k => tagOf(k) === 'caption');
    const info = {
      n: out.tables.length + 1, id: el.getAttribute('id') || '',
      caption: caption ? oneLine(textOf(caption, []).join(' ')) : '',
      aria: oneLine(el.getAttribute('aria-label')),
      heading: headingFresh && !inTable ? heading : '',
      hidden: !(el.getClientRects && el.getClientRects().length), layout: isLayout(el),
      nestedIn: inTable && index.has(inTable) ? index.get(inTable) : 0,
      rows: [], totalRows: 0, rowsTruncated: false, nestedCells: 0,
    };
    out.tables.push(info);
    if (info.layout) continue; // page layout, not data: rows not read
    if (!inTable) headingFresh = false;
    index.set(el, info.n);
    // Row groups in table order: thead first, tbody / bare rows in order, tfoot last.
    const groups = { head: [], body: [], foot: [] };
    let g = 0, headDone = false, footDone = false, bare = null;
    for (const k of kids(el)) {
      const kt = tagOf(k);
      if (kt === 'tr') { if (!bare) { bare = { id: ++g, sec: 'tbody', el: null, rows: [] }; groups.body.push(bare); } bare.rows.push(k); continue; }
      bare = null;
      if (kt === 'thead' && !headDone) { headDone = true; groups.head.push({ id: ++g, sec: 'thead', el: k, rows: kids(k).filter(r => tagOf(r) === 'tr') }); }
      else if (kt === 'tfoot' && !footDone) { footDone = true; groups.foot.push({ id: ++g, sec: 'tfoot', el: k, rows: kids(k).filter(r => tagOf(r) === 'tr') }); }
      else if (kt === 'thead' || kt === 'tbody' || kt === 'tfoot') groups.body.push({ id: ++g, sec: 'tbody', el: k, rows: kids(k).filter(r => tagOf(r) === 'tr') });
    }
    nestedCells = 0;
    for (const grp of [...groups.head, ...groups.body, ...groups.foot]) {
      const groupHidden = !!grp.el && isHidden(grp.el);
      for (const tr of grp.rows) {
        info.totalRows++;
        if (info.rows.length >= MAX_ROWS) { info.rowsTruncated = true; continue; }
        const cells = kids(tr).filter(c => { const ct = tagOf(c); return ct === 'td' || ct === 'th'; }).map(c => ({
          t: textOf(c, []).join(''), h: tagOf(c) === 'th', cs: spanOf(c, 'colspan', 1000, false), rs: spanOf(c, 'rowspan', 65534, true),
        }));
        info.rows.push({ g: grp.id, sec: grp.sec, hidden: groupHidden || isHidden(tr), cells });
      }
    }
    info.nestedCells = nestedCells;
  }
  return out;
})();
