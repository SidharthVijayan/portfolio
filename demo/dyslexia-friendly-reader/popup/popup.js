// Popup wiring: active tab -> inject read-only extract.js -> Core.layout(text, settings) -> inject showReader() to draw
// the reader view as an overlay inside a closed shadow root. The page's own elements are never modified; closing removes
// the overlay. Settings live only in the popup and in the open overlay (no storage); they reset once the reader closes.
// Page text is always rendered with textContent, never as HTML.
'use strict';
const $ = id => document.getElementById(id);
const FIELDS = ['font', 'size', 'spacing', 'lineHeight', 'width', 'theme'];
const SOURCE_LABEL = { selection: 'your selection', article: 'the article', main: 'the main content', body: 'the page' };
let tabId = null, lastExtract = null, open = false;

// Runs in the page (via chrome.scripting.executeScript). Builds the overlay from the spec tree with inline !important
// styles inside a closed shadow root, so page CSS can't leak in. Re-running it replaces the overlay and keeps the
// reading position. Esc or the Close button removes it and returns focus to where it was.
function showReader(tree, settings, extracted) {
  const KEY = '__dyslexiaFriendlyReader';
  const prev = globalThis[KEY];
  let frac = 0, returnFocus = document.activeElement;
  if (prev) {
    const sc = prev.scroller, max = sc.scrollHeight - sc.clientHeight;
    frac = max > 0 ? sc.scrollTop / max : 0;
    returnFocus = prev.returnFocus;
    prev.close(false);
  }
  const host = document.createElement('div');
  host.setAttribute('data-dyslexia-friendly-reader', '');
  const hostStyle = { all: 'initial', position: 'fixed', inset: '0', 'z-index': '2147483647', display: 'block' };
  for (const [k, v] of Object.entries(hostStyle)) host.style.setProperty(k, v, 'important');
  const shadow = host.attachShadow({ mode: 'closed' });
  let scroller = null, closeBtn = null;
  const build = n => {
    const e = document.createElement(n.tag);
    for (const [k, v] of Object.entries(n.attrs || {})) e.setAttribute(k, v);
    for (const [k, v] of Object.entries(n.style || {})) e.style.setProperty(k, v, 'important');
    if (n.text != null) e.textContent = n.text;
    for (const c of n.children || []) e.appendChild(build(c));
    const role = n.attrs && n.attrs['data-role'];
    if (role === 'scroller') scroller = e;
    if (role === 'close') closeBtn = e;
    return e;
  };
  shadow.appendChild(build(tree));
  const onKey = ev => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(true); } };
  const state = { host, scroller, returnFocus, settings, extracted, close };
  function close(restore) {
    window.removeEventListener('keydown', onKey, true);
    host.remove();
    if (globalThis[KEY] === state) delete globalThis[KEY];
    if (restore && returnFocus && typeof returnFocus.focus === 'function') { try { returnFocus.focus({ preventScroll: true }); } catch (e) { /* element gone */ } }
  }
  globalThis[KEY] = state;
  closeBtn.addEventListener('click', () => close(true));
  window.addEventListener('keydown', onKey, true);
  document.documentElement.appendChild(host);
  scroller.focus({ preventScroll: true });
  const max = scroller.scrollHeight - scroller.clientHeight;
  if (frac > 0 && max > 0) scroller.scrollTop = Math.round(frac * max);
  return { ok: true };
}

// Runs in the page: removes the reader overlay if it is open.
function closeReader() {
  const s = globalThis.__dyslexiaFriendlyReader;
  if (!s) return { wasOpen: false };
  s.close(true);
  return { wasOpen: true };
}

// Runs in the page: tells a newly opened popup whether the reader is open, with its settings and text.
function readerState() {
  const s = globalThis.__dyslexiaFriendlyReader;
  return s ? { open: true, settings: s.settings, extracted: s.extracted } : { open: false };
}

function el(tag, text, value) { const e = document.createElement(tag); e.textContent = text; if (value != null) e.value = value; return e; }
function fillControls() {
  for (const f of Core.FONTS) $('font').append(el('option', f.label, f.id));
  for (const n of Core.SIZES) $('size').append(el('option', `${n} px`, String(n)));
  for (const s of Core.SPACINGS) $('spacing').append(el('option', s.label, s.id));
  for (const l of Core.LINE_HEIGHTS) $('lineHeight').append(el('option', l.label, l.id));
  for (const w of Core.WIDTHS) $('width').append(el('option', w.label, w.id));
  for (const t of Core.THEMES) $('theme').append(el('option', t.label, t.id));
}
function setControls(s) { const n = Core.normalize(s); for (const f of FIELDS) $(f).value = String(n[f]); }
function readControls() { return Core.normalize(Object.fromEntries(FIELDS.map(f => [f, $(f).value]))); }
function setOpen(v) {
  open = v;
  $('closeBtn').disabled = !v;
  $('runBtn').textContent = v ? 'Re-read the page' : 'Open reader view';
}

async function draw() {
  const view = Core.layout(lastExtract, readControls());
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: showReader, args: [view.tree, view.settings, lastExtract] });
  if (!res || !res.result || !res.result.ok) throw new Error('reader not shown');
  return view;
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab.id;
}

$('runBtn').addEventListener('click', async () => {
  const status = $('status');
  status.className = 'muted';
  status.textContent = 'Reading the page text…';
  try {
    await activeTab();
    const [injection] = await chrome.scripting.executeScript({ target: { tabId }, files: ['content/extract.js'] });
    const data = injection.result;
    if (!data || !data.blocks || !data.blocks.length) {
      status.className = 'warn';
      status.textContent = 'No readable paragraphs found here. Select some text on the page and try again.';
      return;
    }
    lastExtract = data;
    const view = await draw();
    setOpen(true);
    status.className = 'muted';
    status.textContent = `Showing ${SOURCE_LABEL[data.source] || 'the page'}: ${view.stats.words} words, about ${view.stats.minutes} min. Changes below apply instantly.${data.truncated ? ' Very long page: only the first part is shown.' : ''}`;
  } catch (e) {
    status.className = 'bad';
    status.textContent = 'This page can\'t be opened in the reader. Browser pages (chrome://, the Chrome Web Store, PDF viewer) are off-limits to extensions.';
  }
});

async function onSettingsChange() {
  if (!open || !lastExtract) return;
  try { await draw(); } catch (e) { setOpen(false); $('status').className = 'warn'; $('status').textContent = 'The reader is no longer open on this page. Click "Open reader view" again.'; }
}
for (const f of FIELDS) $(f).addEventListener('change', onSettingsChange);
$('resetBtn').addEventListener('click', () => { setControls(Core.DEFAULTS); onSettingsChange(); });
$('closeBtn').addEventListener('click', async () => {
  try { await chrome.scripting.executeScript({ target: { tabId }, func: closeReader }); } catch (e) { /* tab gone */ }
  setOpen(false);
  $('status').className = 'muted';
  $('status').textContent = 'Reader closed. The page is back as it was.';
});

fillControls();
setControls(Core.DEFAULTS);
(async () => {
  try {
    await activeTab();
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: readerState });
    const st = res && res.result;
    if (st && st.open) {
      lastExtract = st.extracted;
      setControls(st.settings);
      setOpen(true);
      $('status').textContent = 'The reader view is open on this page. Changes below apply instantly.';
    }
  } catch (e) { /* page not scriptable: the Open button explains when clicked */ }
})();
