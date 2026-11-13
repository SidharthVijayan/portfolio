// Injected on click via chrome.scripting.executeScript({ files: ['content/extract.js'] }).
// READ-ONLY: lists every rendered form field and button with the raw facts needed to work out its accessible name
// (aria-labelledby targets, aria-label, <label> text, title, placeholder, button text/value/alt), plus every ARIA
// ID reference on the page and every <label for>. Also returns a CSS path so "Show on page" can find each control.
// Never modifies the page. The last expression's value is returned to the popup.
(() => {
  const MAX = 1000;
  const clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const attr = (el, k) => { const v = el.getAttribute(k); return v == null ? null : clean(v); };
  const FIELD_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'listbox', 'checkbox', 'radio', 'switch', 'slider', 'spinbutton']);
  const BUTTON_TYPES = new Set(['button', 'submit', 'reset', 'image']);
  const LABELABLE = new Set(['input', 'select', 'textarea', 'button', 'meter', 'output', 'progress']);
  const REF_ATTRS = ['aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns', 'aria-activedescendant', 'aria-errormessage', 'aria-details'];
  const ids = new Map();
  for (const e of document.querySelectorAll('[id]')) { const id = e.getAttribute('id'); ids.set(id, (ids.get(id) || []).concat([e])); }
  // Text an element contributes to a name: text nodes and img alt, skipping aria-hidden subtrees and form-control contents.
  const textOf = node => {
    let out = '';
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { out += ' ' + n.nodeValue; continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName.toLowerCase();
      if (['script', 'style', 'template', 'select', 'textarea', 'input'].includes(tag)) continue;
      if (n.getAttribute('aria-hidden') === 'true') continue;
      if (tag === 'img') { out += ' ' + (n.getAttribute('alt') || ''); continue; }
      const al = attr(n, 'aria-label');
      out += ' ' + (al && tag === 'svg' ? al : textOf(n));
    }
    return clean(out);
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
  const resolve = list => clean(list).split(' ').filter(Boolean).map(id => {
    const hits = ids.get(id) || [];
    return { id, found: hits.length > 0, dup: hits.length > 1, text: hits.length ? textOf(hits[0]) : '' };
  });
  const controls = [];
  let truncated = false;
  for (const el of document.body ? document.body.querySelectorAll('input, select, textarea, button, [role]') : []) {
    const tag = el.tagName.toLowerCase();
    const role = attr(el, 'role');
    const type = tag === 'input' ? (attr(el, 'type') || 'text').toLowerCase() : tag === 'button' ? (attr(el, 'type') || 'submit').toLowerCase() : null;
    if (tag === 'input' && type === 'hidden') continue;
    let kind;
    if (tag === 'button' || (tag === 'input' && BUTTON_TYPES.has(type)) || role === 'button') kind = 'button';
    else if (['input', 'select', 'textarea'].includes(tag) || FIELD_ROLES.has(role)) kind = 'field';
    else continue;
    if (!rendered(el)) continue;
    if (controls.length >= MAX) { truncated = true; break; }
    const id = attr(el, 'id');
    const labels = [];
    const wrap = el.parentElement && el.parentElement.closest('label');
    if (wrap && !wrap.getAttribute('for')) labels.push(textOf(wrap));
    if (id) for (const l of document.querySelectorAll('label[for]')) if (l.getAttribute('for') === id && l !== wrap) labels.push(textOf(l));
    const tabindex = el.getAttribute('tabindex');
    const nativeFocus = ['input', 'select', 'textarea', 'button'].includes(tag);
    controls.push({
      i: controls.length, kind, tag, type, role, id, path: pathOf(el),
      inputName: attr(el, 'name'),
      ariaLabel: attr(el, 'aria-label'),
      labelledby: el.getAttribute('aria-labelledby') == null ? null : resolve(el.getAttribute('aria-labelledby')),
      labels,
      title: attr(el, 'title'),
      placeholder: attr(el, 'placeholder'),
      value: tag === 'input' && kind === 'button' ? attr(el, 'value') : null,
      alt: tag === 'input' && type === 'image' ? attr(el, 'alt') : null,
      content: kind === 'button' && tag !== 'input' ? textOf(el) : '',
      disabled: el.getAttribute('disabled') != null,
      focusable: (nativeFocus || tabindex != null) && tabindex !== '-1' && el.getAttribute('disabled') == null,
      ariaHidden: !!el.closest('[aria-hidden="true"]'),
    });
  }
  const refs = [];
  for (const el of document.querySelectorAll(REF_ATTRS.map(a => `[${a}]`).join(', '))) {
    for (const a of REF_ATTRS) {
      const v = el.getAttribute(a);
      if (v == null) continue;
      refs.push({ tag: el.tagName.toLowerCase(), path: pathOf(el), attr: a, targets: resolve(v) });
    }
  }
  const labelFors = [];
  for (const l of document.querySelectorAll('label[for]')) {
    const f = l.getAttribute('for');
    const hits = ids.get(f) || [];
    labelFors.push({ path: pathOf(l), for: f, text: textOf(l), found: hits.length > 0, labelable: hits.length > 0 && LABELABLE.has(hits[0].tagName.toLowerCase()) });
  }
  return { url: location.href, controls, refs, labelFors, truncated };
})();
