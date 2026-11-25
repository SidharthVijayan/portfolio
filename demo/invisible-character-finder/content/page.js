// Invisible Character Finder: page actions, injected with lib/core.js when the popup opens. Defines
// self.__icfApi in the extension's isolated world; nothing runs until the popup calls it after a button press.
//   cleanField(choices): cleans the focused field remembered by content/extract.js (text box, text area or
//     rich-text editor) and tells the page it changed (an input event), keeping the old text for undo().
//   undo(): puts the field back exactly as it was before the last clean.
//   highlight(): marks, on the page, the words in the selected text that hide invisible characters and the
//     look-alike letters, with the browser's CSS Custom Highlight API (the page's HTML is not changed), and
//     scrolls the first one into view.  clearHighlight() removes the marks.
(() => {
  'use strict';
  if (self.__icfApi) return;
  const Core = self.InvisCore;
  const NAME = { hidden: 'invisible-character-finder', lookalike: 'invisible-character-finder-lookalike' };
  let sheet = null, highlighted = false;

  function textNodesIn(root) {
    const out = [];
    const walk = n => { if (n.nodeType === 3) out.push(n); else for (const c of n.childNodes) walk(c); };
    walk(root);
    return out;
  }
  function setValue(el, v) {
    const proto = Object.getPrototypeOf(el);
    const d = Object.getOwnPropertyDescriptor(proto, 'value');
    if (d && d.set) d.set.call(el, v); else el.value = v; // native setter, so frameworks notice the change
  }
  function fire(el) {
    let ev;
    try { ev = new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText' }); } catch (e) { ev = new Event('input', { bubbles: true }); }
    el.dispatchEvent(ev);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function cleanField(choices) {
    const st = self.__icf;
    if (!st || (st.kind !== 'field' && st.kind !== 'editor') || !st.el.isConnected) return { ok: false, why: 'gone' };
    if (st.kind === 'field') {
      if (st.el.readOnly || st.el.disabled) return { ok: false, why: 'readonly' };
      const old = String(st.el.value || '');
      const r = Core.clean(old, choices);
      if (!r.changed) return { ok: true, changed: 0, removed: 0, replaced: 0 };
      st.undo = { value: old };
      setValue(st.el, r.text);
      fire(st.el);
      return { ok: true, changed: r.changed, removed: r.removed, replaced: r.replaced, text: r.text };
    }
    const nodes = textNodesIn(st.el);
    const whole = nodes.map(n => n.nodeValue).join('');
    const undo = [];
    let removed = 0, replaced = 0;
    for (const n of nodes) {
      const r = Core.clean(n.nodeValue, choices, { context: whole });
      if (!r.changed) continue;
      undo.push([n, n.nodeValue]);
      n.nodeValue = r.text;
      removed += r.removed; replaced += r.replaced;
    }
    if (!undo.length) return { ok: true, changed: 0, removed: 0, replaced: 0 };
    st.undo = { nodes: undo };
    fire(st.el);
    return { ok: true, changed: removed + replaced, removed, replaced, text: String(st.el.innerText != null ? st.el.innerText : st.el.textContent) };
  }

  function undo() {
    const st = self.__icf;
    if (!st || !st.undo) return { ok: false };
    if (st.undo.value != null) { setValue(st.el, st.undo.value); fire(st.el); }
    else { for (const [n, v] of st.undo.nodes) n.nodeValue = v; fire(st.el); }
    st.undo = null;
    return { ok: true };
  }

  function clearHighlight() {
    if (typeof CSS !== 'undefined' && CSS.highlights) { CSS.highlights.delete(NAME.hidden); CSS.highlights.delete(NAME.lookalike); }
    if (sheet) { document.adoptedStyleSheets = document.adoptedStyleSheets.filter(s => s !== sheet); sheet = null; }
    const was = highlighted; highlighted = false;
    return { ok: true, was };
  }

  function highlight() {
    const st = self.__icf;
    if (!st || st.kind !== 'selection') return { ok: false, why: 'nosel' };
    if (typeof CSS === 'undefined' || !CSS.highlights || typeof Highlight === 'undefined') return { ok: false, why: 'unsupported' };
    clearHighlight();
    const range = st.range;
    const rootNode = range.commonAncestorContainer;
    const nodes = rootNode.nodeType === 3 ? [rootNode] : textNodesIn(rootNode).filter(n => range.intersectsNode(n));
    const parts = nodes.map(n => ({ n, a: n === range.startContainer ? range.startOffset : 0, b: n === range.endContainer ? range.endOffset : n.nodeValue.length }));
    const whole = parts.map(p => p.n.nodeValue.slice(p.a, p.b)).join('');
    const sets = { hidden: [], lookalike: [] };
    for (const p of parts) {
      const t = p.n.nodeValue.slice(p.a, p.b);
      if (!t) continue;
      const spans = Core.highlightSpans(t, Core.analyze(t, { context: whole }));
      for (const s of spans) {
        const r = document.createRange();
        r.setStart(p.n, p.a + s.a); r.setEnd(p.n, p.a + s.b);
        sets[s.kind].push(r);
      }
    }
    const n = sets.hidden.length + sets.lookalike.length;
    if (!n) return { ok: true, count: 0 };
    sheet = new CSSStyleSheet();
    sheet.replaceSync(`::highlight(${NAME.hidden}){background-color:#ff3ea5;color:#fff;text-decoration:underline wavy #7a0040}` +
      `::highlight(${NAME.lookalike}){background-color:#ffb020;color:#111;text-decoration:underline wavy #7a3d00}`);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    if (sets.hidden.length) CSS.highlights.set(NAME.hidden, new Highlight(...sets.hidden));
    if (sets.lookalike.length) CSS.highlights.set(NAME.lookalike, new Highlight(...sets.lookalike));
    highlighted = true;
    const first = [...sets.hidden, ...sets.lookalike].sort((x, y) => x.compareBoundaryPoints(Range.START_TO_START, y))[0];
    const rect = first.getBoundingClientRect();
    if (rect.top < 0 || rect.bottom > innerHeight) window.scrollBy({ top: rect.top - innerHeight / 3 });
    return { ok: true, count: n, words: sets.hidden.length, letters: sets.lookalike.length };
  }

  self.__icfApi = { cleanField, undo, highlight, clearHighlight, isHighlighted: () => highlighted };
})();
