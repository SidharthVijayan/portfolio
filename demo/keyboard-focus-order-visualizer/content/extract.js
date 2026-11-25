// Injected on click via chrome.scripting.executeScript({ files: ['content/extract.js'] }).
// READ-ONLY: walks the page once in document order (at most 50,000 elements) and describes every element
// that could take keyboard focus or looks like a control: links, buttons, form fields, summaries, frames,
// editable areas, media with controls, anything with a tabindex, a widget role or an onclick attribute, and
// scroll boxes (Chrome lets Tab reach a scroll box that has nothing focusable inside). For each one it reads
// the attributes that decide the Tab order (tabindex, disabled, inert, radio name), whether it is rendered,
// where it is and whether it can be seen, and a short name. It keeps references to those elements in the
// extension's own isolated world (self.__ifoEls) so the numbers layer can find them; it never changes,
// focuses or scrolls the page and sends nothing. The last expression's value goes back to the popup.
(() => {
  const MAX_ELEMENTS = 50000, MAX_ITEMS = 5000, MAX_TEXT = 80;
  const clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const cut = s => (s.length > MAX_TEXT ? s.slice(0, MAX_TEXT - 1) + '…' : s);
  const tagOf = e => String(e.tagName || '').toLowerCase();
  const attr = (e, k) => (e.hasAttribute(k) ? String(e.getAttribute(k)) : null);
  const pathOf = el => {
    const parts = [];
    for (let e = el; e && e.parentElement; e = e.parentElement) {
      const tag = tagOf(e);
      const same = [...e.parentElement.children].filter(x => tagOf(x) === tag);
      parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(e) + 1})` : tag);
    }
    return parts.join(' > ');
  };
  const ROLES = new Set(['button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
    'option', 'slider', 'spinbutton', 'combobox', 'textbox', 'searchbox', 'treeitem', 'gridcell']);
  const FIELDS = new Set(['button', 'input', 'select', 'textarea']);

  // What makes an element focusable without a tabindex (HTML "focusable area" defaults as Chrome applies them).
  const nativeKind = el => {
    const tag = tagOf(el);
    if ((tag === 'a') && el.hasAttribute('href')) return 'link';
    if (tag === 'button') return 'button';
    if (tag === 'input') {
      const t = clean(attr(el, 'type')).toLowerCase();
      if (t === 'hidden') return '';
      if (t === 'checkbox') return 'checkbox';
      if (t === 'radio') return 'radio';
      if (['button', 'submit', 'reset', 'image'].includes(t)) return 'button';
      if (t === 'range') return 'slider';
      if (t === 'color' || t === 'file') return t === 'file' ? 'file picker' : 'colour picker';
      return 'text field';
    }
    if (tag === 'select') return 'dropdown';
    if (tag === 'textarea') return 'text area';
    if (tag === 'iframe') return 'frame';
    if (tag === 'summary') { const p = el.parentElement; if (p && tagOf(p) === 'details' && [...p.children].find(c => tagOf(c) === 'summary') === el) return 'summary'; return ''; }
    if ((tag === 'audio' || tag === 'video') && el.hasAttribute('controls')) return 'media';
    const ce = attr(el, 'contenteditable');
    if (ce !== null && clean(ce).toLowerCase() !== 'false') return 'editable';
    return '';
  };

  const labelsFor = new Map(); // id -> label text
  const idText = new Map();    // id -> text (for aria-labelledby)
  const all = [];
  const root = document.documentElement;
  let count = 0, truncated = false;
  const stack = root ? [root] : [];
  while (stack.length) {
    const el = stack.pop();
    if (++count > MAX_ELEMENTS) { truncated = true; break; }
    all.push(el);
    const tag = tagOf(el);
    const id = attr(el, 'id');
    if (id && !idText.has(id)) idText.set(id, el);
    if (tag === 'label' && el.hasAttribute('for')) { const f = attr(el, 'for'); if (!labelsFor.has(f)) labelsFor.set(f, el); }
    const kids = el.children;
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
  }

  const style = el => { try { return getComputedStyle(el); } catch (e) { return null; } };
  const nameOf = (el, kind) => {
    const al = clean(attr(el, 'aria-label'));
    if (al) return al;
    const lb = clean(attr(el, 'aria-labelledby'));
    if (lb) { const t = lb.split(' ').map(i => idText.get(i)).filter(Boolean).map(e => clean(e.textContent)).join(' '); if (t) return t; }
    const tag = tagOf(el);
    if (FIELDS.has(tag) && tag !== 'button') {
      const t = clean(attr(el, 'type')).toLowerCase();
      if (tag === 'input' && ['button', 'submit', 'reset'].includes(t)) return clean(attr(el, 'value')) || (t === 'submit' ? 'Submit' : t === 'reset' ? 'Reset' : '');
      if (tag === 'input' && t === 'image') return clean(attr(el, 'alt'));
      const id = attr(el, 'id');
      if (id && labelsFor.has(id)) return clean(labelsFor.get(id).textContent);
      for (let p = el.parentElement; p; p = p.parentElement) if (tagOf(p) === 'label') return clean(p.textContent);
      return clean(attr(el, 'placeholder')) || clean(attr(el, 'title')) || clean(attr(el, 'name'));
    }
    if (tag === 'iframe') return clean(attr(el, 'title'));
    let t = clean(el.textContent);
    if (!t && el.querySelector) { const img = el.querySelector('img[alt]'); if (img) t = clean(img.getAttribute('alt')); }
    return t || clean(attr(el, 'title'));
  };

  const sx = Number(window.scrollX) || 0, sy = Number(window.scrollY) || 0;
  const docW = Math.max(Number(root && root.scrollWidth) || 0, Number(window.innerWidth) || 0);
  const docH = Math.max(Number(root && root.scrollHeight) || 0, Number(window.innerHeight) || 0);
  const items = [], els = [];
  const scrollerOf = new Map(); // element -> item index of a scroll box
  const formIds = new Map();
  let candidates = 0;
  for (let index = 0; index < all.length; index++) {
    const el = all[index];
    const tag = tagOf(el);
    if (tag === 'html' || tag === 'body' || tag === 'head') continue;
    const kind = nativeKind(el);
    const tabindex = attr(el, 'tabindex');
    const role = clean(attr(el, 'role')).toLowerCase().split(' ')[0];
    const onclick = el.hasAttribute('onclick');
    let scroller = false;
    if (!kind && tabindex === null) {
      const sh = Number(el.scrollHeight) || 0, ch = Number(el.clientHeight) || 0, sw = Number(el.scrollWidth) || 0, cw = Number(el.clientWidth) || 0;
      if (sh > ch || sw > cw) {
        const s = style(el);
        const ox = s ? String(s.overflowX) : '', oy = s ? String(s.overflowY) : '';
        scroller = (sh > ch && /^(auto|scroll)$/.test(oy)) || (sw > cw && /^(auto|scroll)$/.test(ox));
      }
      if (!scroller && !ROLES.has(role) && !onclick) continue;
    }
    candidates++;
    if (items.length >= MAX_ITEMS) { truncated = true; continue; }
    const s = style(el);
    let rendered = true;
    try { rendered = el.getClientRects().length > 0; } catch (e) { rendered = true; }
    let r = { left: 0, top: 0, width: 0, height: 0 };
    try { r = el.getBoundingClientRect(); } catch (e) { /* keep zero box */ }
    let inert = false, ariaHidden = false, fieldsetDisabled = false, activeDesc = false, faded = false, collapsed = false, inScroller = [];
    let form = attr(el, 'form') || '';
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      if (e.hasAttribute('inert')) inert = true;
      // Content of a closed <details> (except its summary) or of hidden="until-found" can't take focus.
      const p = e.parentElement;
      if (p && tagOf(p) === 'details' && !p.hasAttribute('open') && [...p.children].find(c => tagOf(c) === 'summary') !== e) collapsed = true;
      if (clean(attr(e, 'hidden')).toLowerCase() === 'until-found') collapsed = true;
      if (clean(attr(e, 'aria-hidden')).toLowerCase() === 'true') ariaHidden = true;
      const es = e === el ? s : style(e);
      if (es && String(es.opacity) === '0') faded = true;
      if (e !== el) {
        const et = tagOf(e);
        if (et === 'fieldset' && e.hasAttribute('disabled')) {
          const legend = [...e.children].find(c => tagOf(c) === 'legend');
          let inLegend = false;
          for (let x = el; x && x !== e; x = x.parentElement) if (x === legend) inLegend = true;
          if (!inLegend) fieldsetDisabled = true;
        }
        if (e.hasAttribute('aria-activedescendant')) activeDesc = true;
        if (scrollerOf.has(e)) inScroller.push(scrollerOf.get(e));
        if (!form && et === 'form') { if (!formIds.has(e)) formIds.set(e, 'form' + formIds.size); form = formIds.get(e); }
      }
    }
    const clip = s ? clean(s.clip) : '', clipPath = s ? clean(s.clipPath) : '';
    const clipped = /^rect\(0(px)?,? 0(px)?,? 0(px)?,? 0(px)?\)$/.test(clip) || /^inset\(50%\)$/.test(clipPath);
    const x = (Number(r.left) || 0) + sx, y = (Number(r.top) || 0) + sy, w = Number(r.width) || 0, h = Number(r.height) || 0;
    const item = {
      i: items.length, order: index, tag, kind, role, onclick, tabindex: tabindex === null ? null : tabindex.slice(0, 20),
      type: tag === 'input' ? clean(attr(el, 'type')).toLowerCase() : '',
      href: tag === 'a' ? clean(attr(el, 'href')).slice(0, 300) : '',
      disabled: FIELDS.has(tag) || tag === 'fieldset' || tag === 'optgroup' || tag === 'option' ? (el.hasAttribute('disabled') || fieldsetDisabled) : false,
      inert, ariaHidden, activeDesc, scroller,
      rendered: rendered && !collapsed, visibility: s ? String(s.visibility) : 'visible',
      faded, clipped,
      box: { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) },
      offscreen: rendered && (x + w <= 0 || y + h <= 0 || x >= docW || y >= docH),
      name: cut(nameOf(el, kind)), path: pathOf(el), inScroller,
    };
    if (item.type === 'radio') {
      item.radioName = attr(el, 'name') || '';
      item.form = form;
      item.checked = typeof el.checked === 'boolean' ? el.checked : el.hasAttribute('checked');
    }
    if (scroller) scrollerOf.set(el, item.i);
    items.push(item); els.push(el);
  }
  try { Object.defineProperty(self, '__ifoEls', { value: els, configurable: true, writable: true }); } catch (e) { self.__ifoEls = els; }
  return {
    url: String(location.href), title: clean(document.title || ''), items, candidates, truncated,
    elements: Math.min(count, MAX_ELEMENTS), viewport: { w: Number(window.innerWidth) || 0, h: Number(window.innerHeight) || 0 },
  };
})();
