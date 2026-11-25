// Invisible Character Finder: page reader, injected into the active tab once per click (activeTab + scripting),
// right after lib/core.js and content/page.js. It reads ONE thing: the text field you are typing in (a text box,
// text area or rich-text editor that has the focus), or else the text you have selected on the page. Password
// fields are never read. It keeps a reference to that field or selection in the extension's isolated world
// (self.__icf) so the popup can later clean the field or highlight the selection. It changes nothing on the page.
(() => {
  'use strict';
  const MAX = 200000;
  const TEXT_TYPES = new Set(['', 'text', 'search', 'email', 'url', 'tel']);
  // The focused element, looking inside open shadow roots.
  let ae = document.activeElement;
  while (ae && ae.shadowRoot && ae.shadowRoot.activeElement) ae = ae.shadowRoot.activeElement;
  const labelOf = el => {
    let s = el.getAttribute('aria-label') || '';
    if (!s && el.id) { try { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l) s = l.textContent; } catch (e) { /* ignore */ } }
    if (!s && el.closest) { const l = el.closest('label'); if (l) s = l.textContent; }
    if (!s) s = el.getAttribute('placeholder') || el.getAttribute('name') || el.getAttribute('title') || '';
    return String(s).replace(/\s+/g, ' ').trim().slice(0, 60);
  };
  let out = { url: String(location.href), title: String(document.title || ''), source: 'none', text: '', label: '', truncated: false };
  self.__icf = null;
  const tag = ae && ae.tagName ? String(ae.tagName).toLowerCase() : '';
  const type = tag === 'input' ? String(ae.getAttribute('type') || '').toLowerCase() : '';
  if (tag === 'input' && type === 'password') {
    out.source = 'password';
  } else if ((tag === 'textarea' || (tag === 'input' && TEXT_TYPES.has(type))) && !ae.disabled) {
    const v = String(ae.value || '');
    out = Object.assign(out, { source: 'field', fieldType: tag === 'textarea' ? 'text area' : 'text box', label: labelOf(ae), text: v.slice(0, MAX), truncated: v.length > MAX, readOnly: !!ae.readOnly });
    self.__icf = { kind: 'field', el: ae };
  } else if (ae && ae.isContentEditable) {
    let host = ae;
    while (host.parentElement && host.parentElement.isContentEditable) host = host.parentElement;
    const v = String(host.innerText != null ? host.innerText : host.textContent || '');
    out = Object.assign(out, { source: 'field', fieldType: 'editor', label: labelOf(host), text: v.slice(0, MAX), truncated: v.length > MAX, readOnly: false });
    self.__icf = { kind: 'editor', el: host };
  } else {
    const sel = window.getSelection && window.getSelection();
    const s = sel && !sel.isCollapsed && sel.rangeCount ? String(sel.toString()) : '';
    if (s) {
      out = Object.assign(out, { source: 'selection', text: s.slice(0, MAX), truncated: s.length > MAX });
      self.__icf = { kind: 'selection', range: sel.getRangeAt(0).cloneRange() };
    }
  }
  out.highlighted = !!(self.__icfApi && self.__icfApi.isHighlighted());
  return out;
})();
