// Invisible Character Finder popup. Opening the popup (a click on the toolbar button) grants activeTab; the popup
// then injects lib/core.js, content/page.js and the read-only content/extract.js into that tab once, which return
// the focused text field's text or the selected text. InvisCore finds the hidden characters; the popup shows the
// text with each one made visible, lists them by kind and offers: Copy cleaned text (the clipboard, on a button
// press), Clean this field (+ Undo) for a focused field, and Show on page for a selection. "Check other text"
// checks pasted text without touching any page. Nothing is saved.
'use strict';
(function () {
  const Core = (typeof InvisCore !== 'undefined') ? InvisCore : self.InvisCore;
  const $ = id => document.getElementById(id);
  let tabId = null, page = null, text = '', source = 'none', res = null, choices = Core.defaultChoices(), canUndo = false, lit = false;

  // These run in the page's isolated world (serialized by chrome.scripting), so they must be self-contained.
  function apiClean(c) { return self.__icfApi ? self.__icfApi.cleanField(c) : { ok: false, why: 'gone' }; }
  function apiUndo() { return self.__icfApi ? self.__icfApi.undo() : { ok: false }; }
  function apiShow() { return self.__icfApi ? self.__icfApi.highlight() : { ok: false, why: 'gone' }; }
  function apiClear() { return self.__icfApi ? self.__icfApi.clearHighlight() : { ok: false }; }

  const el = (tag, cls, t) => { const n = document.createElement(tag); if (cls) n.className = cls; if (t != null) n.textContent = t; return n; };
  const clear = n => { while (n.firstChild) n.removeChild(n.firstChild); };
  const setStatus = (t, cls) => { $('status').textContent = t; $('status').className = cls || 'muted'; };
  const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;
  const run = async (func, args) => { const out = await chrome.scripting.executeScript({ target: { tabId }, func, args: args || [] }); return out && out[0] && out[0].result; };
  const pageError = () => setStatus('The page changed or was closed. Open the popup again.', 'warn');

  function sourceLine() {
    const n = plural(text.length, 'character');
    const cut = page && page.truncated && source !== 'pasted' ? ', first 200,000 characters' : '';
    if (source === 'selection') return `Checked: the selected text (${n}${cut}).`;
    if (source === 'field') return `Checked: the ${page.fieldType}${page.label ? ' “' + page.label + '”' : ''} you are typing in (whole field, ${n}${cut})${page.readOnly ? ', read-only' : ''}.`;
    if (source === 'pasted') return `Checked: the text pasted below (${n}).`;
    return '';
  }
  const pending = () => res ? Core.clean(text, choices).changed : 0;

  function buttons() {
    const n = pending();
    $('copyBtn').disabled = !text;
    $('copyBtn').textContent = n ? 'Copy cleaned text' : 'Copy text';
    const field = source === 'field' && page && !page.readOnly;
    $('cleanBtn').hidden = !(field && res && res.problems) && !canUndo;
    $('cleanBtn').disabled = !n;
    $('undoBtn').hidden = !canUndo;
    $('showBtn').hidden = !(source === 'selection' && res && res.problems);
    $('showBtn').textContent = lit ? 'Clear highlights' : 'Show on page';
  }

  function render() {
    res = Core.analyze(text);
    setStatus(Core.summary(res, source), Core.statusClass(res));
    $('source').textContent = sourceLine();
    const msgs = $('messages'); clear(msgs);
    for (const m of res.messages) {
      const d = el('div', 'msg'); d.appendChild(el('b', null, `Hidden message (${m.via}): `)); d.appendChild(document.createTextNode('“' + m.text + '”'));
      msgs.appendChild(d);
    }
    const view = $('view'); clear(view);
    view.hidden = !res.findings.length;
    if (res.findings.length) {
      const mk = Core.markup(text, res, 4000);
      for (const s of mk.segs) {
        if (s.t === 'text') { view.appendChild(document.createTextNode(s.s)); continue; }
        const m = el('span', s.visible ? 'lk' : 'm' + (s.kind === 'space' ? ' space' : '') + (s.fine ? ' fine' : ''), s.code);
        m.title = s.title;
        view.appendChild(m);
      }
      if (mk.cut) view.appendChild(el('span', 'cut', ' … (the list below covers the whole text)'));
    }
    const found = $('found'); clear(found);
    for (const g of res.groups) {
      const box = el('div', 'grp');
      box.dataset.kind = g.key;
      box.appendChild(el('span', 'n', String(g.count)));
      box.appendChild(el('div', 'name', g.label));
      box.appendChild(el('div', 'hint', g.hint));
      for (const it of g.items) {
        const row = el('div', 'row' + (it.fine ? ' fine' : ''));
        row.appendChild(el('span', 'code', it.code));
        const what = el('span', 'what');
        what.appendChild(el('span', null, it.name + (it.hex && it.code !== it.hex ? ` (${it.hex})` : '')));
        if (it.fine) what.appendChild(el('span', 'tagfine', 'usually fine'));
        if (it.why) { what.appendChild(document.createTextNode(' ')); what.appendChild(el('span', 'why', it.why)); }
        row.appendChild(what);
        row.appendChild(el('span', 'cnt', '×' + it.count));
        box.appendChild(row);
      }
      found.appendChild(box);
    }
    const opts = $('optList'); clear(opts);
    const kinds = res.groups.filter(g => g.problems).map(g => g.key);
    $('opts').hidden = !kinds.length;
    for (const k of kinds) {
      const lab = el('label', 'opt');
      const box = el('input'); box.type = 'checkbox'; box.checked = !!choices[k]; box.dataset.kind = k;
      box.addEventListener('change', () => { choices[k] = box.checked; buttons(); });
      lab.appendChild(box); lab.appendChild(document.createTextNode(Core.KIND[k].clean));
      opts.appendChild(lab);
    }
    buttons();
  }

  async function copyText(s) {
    try { await navigator.clipboard.writeText(s); return true; } catch (e) {
      const ta = el('textarea'); ta.value = s; document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch (er) { ok = false; }
      document.body.removeChild(ta); return ok;
    }
  }
  async function onCopy() {
    const r = Core.clean(text, choices);
    const ok = await copyText(r.text);
    if (!ok) return setStatus('Couldn\'t reach the clipboard. Try again.', 'warn');
    setStatus(r.changed ? `Copied the cleaned text: ${changes(r)}.` : 'Copied the text (nothing needed cleaning).', 'good');
  }
  const changes = r => [r.removed ? `removed ${plural(r.removed, 'character')}` : '', r.replaced ? `replaced ${plural(r.replaced, 'character')}` : ''].filter(Boolean).join(', ');

  async function onClean() {
    try {
      const r = await run(apiClean, [choices]);
      if (!r || !r.ok) return setStatus(r && r.why === 'readonly' ? 'This field is read-only, so it can\'t be cleaned. Copy the cleaned text instead.' : 'The field is gone (the page changed). Open the popup again.', 'warn');
      if (!r.changed) return setStatus('Nothing in the field needed cleaning.', 'good');
      text = r.text; canUndo = true;
      render();
      setStatus(`Cleaned the field: ${changes(r)}. Undo puts it back.`, 'good');
    } catch (e) { pageError(); }
  }
  async function onUndo() {
    try {
      const r = await run(apiUndo);
      if (!r || !r.ok) return pageError();
      text = page.text; canUndo = false;
      render();
      setStatus('Put the field back as it was.', 'good');
    } catch (e) { pageError(); }
  }
  async function onShow() {
    try {
      if (lit) { await run(apiClear); lit = false; buttons(); return setStatus('Cleared the highlights on the page.', 'good'); }
      const r = await run(apiShow);
      if (!r || !r.ok) return setStatus(r && r.why === 'unsupported' ? 'This version of Chrome can\'t highlight text on the page.' : 'The selection is gone (the page changed). Select the text again and reopen the popup.', 'warn');
      lit = r.count > 0; buttons();
      setStatus(r.count ? `Marked ${plural(r.count, 'place')} on the page: ${[r.words ? `${plural(r.words, 'word')} hiding characters in pink` : '', r.letters ? `${plural(r.letters, 'look-alike letter')} in orange` : ''].filter(Boolean).join(', ')}.` : 'Nothing to mark on the page.', 'good');
    } catch (e) { pageError(); }
  }
  function onPaste() {
    const v = $('paste').value;
    if (!v) { if (page && (page.source === 'selection' || page.source === 'field')) { text = page.text; source = page.source; render(); } return; }
    text = v; source = 'pasted'; canUndo = false;
    render();
  }

  async function init() {
    $('copyBtn').addEventListener('click', onCopy);
    $('cleanBtn').addEventListener('click', onClean);
    $('undoBtn').addEventListener('click', onUndo);
    $('showBtn').addEventListener('click', onShow);
    $('paste').addEventListener('input', onPaste);
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      tabId = tab.id;
      const out = await chrome.scripting.executeScript({ target: { tabId }, files: ['lib/core.js', 'content/page.js', 'content/extract.js'] });
      page = out && out[0] && out[0].result;
      if (!page) throw new Error('no result');
    } catch (e) {
      page = null;
      setStatus('Chrome doesn\'t let extensions read this page (chrome:// pages, the Chrome Web Store, the PDF viewer). Paste text below to check it.', 'bad');
      $('pasteBox').open = true;
      buttons();
      return;
    }
    lit = !!page.highlighted;
    if (page.source === 'password') {
      setStatus('That\'s a password field, which is never read. Paste text below to check it instead.', 'warn');
      $('pasteBox').open = true; buttons(); return;
    }
    if (page.source === 'none') {
      setStatus('Select some text on the page, or click into a text box, then click the button again. Or paste text below.', 'muted');
      $('pasteBox').open = true; buttons(); return;
    }
    text = page.text; source = page.source;
    render();
  }
  self.__icfReady = init();
})();
