// Popup wiring: active tab -> inject read-only extract.js -> Core.analyze -> render list.
// "Show on page" injects jumpToControl() to scroll to one element and draw a temporary outline box over it.
// Page data is always rendered with textContent, never as HTML.
'use strict';
const $ = id => document.getElementById(id);
let lastReport = null, tabId = null, kind = 'errors';

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function stat(value, label, cls) {
  const d = el('div', 'stat');
  d.append(el('b', cls, String(value)), el('span', null, label));
  return d;
}

// Runs in the page (via chrome.scripting.executeScript). Finds the element by its CSS path, scrolls it into view
// and overlays a temporary outline box that removes itself after 2.5s. The element itself is not modified.
function jumpToControl(path, tag) {
  let elx = null;
  try { elx = document.querySelector(path); } catch (e) { elx = null; }
  if (!elx) return { ok: false, reason: 'gone' };
  if (tag && elx.tagName.toLowerCase() !== tag) return { ok: false, reason: 'changed' };
  const r0 = elx.getBoundingClientRect();
  if (!(r0.width > 0 && r0.height > 0)) return { ok: false, reason: 'hidden' };
  elx.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
  const r = elx.getBoundingClientRect();
  document.querySelectorAll('[data-form-aria-auditor-box]').forEach(b => b.remove());
  const box = document.createElement('div');
  box.setAttribute('data-form-aria-auditor-box', '');
  box.setAttribute('aria-hidden', 'true');
  Object.assign(box.style, {
    position: 'absolute', left: `${r.left + scrollX - 4}px`, top: `${r.top + scrollY - 4}px`,
    width: `${r.width + 8}px`, height: `${r.height + 8}px`, border: '4px solid #f59e0b', borderRadius: '4px',
    boxShadow: '0 0 0 4px rgba(15,23,42,.55)', pointerEvents: 'none', zIndex: '2147483647', boxSizing: 'border-box',
  });
  document.documentElement.appendChild(box);
  setTimeout(() => box.remove(), 2500);
  return { ok: true };
}

async function jump(it, btn) {
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: jumpToControl, args: [it.path, it.tag] });
    const r = res && res.result;
    if (r && r.ok) btn.textContent = 'Shown ✓';
    else btn.textContent = r && r.reason === 'hidden' ? 'Not visible' : 'Page changed, re-run';
  } catch { btn.textContent = 'Can\'t reach page'; }
  setTimeout(() => { btn.textContent = 'Show on page'; }, 1800);
}

function badge(it) {
  const map = { error: ['Error', 'bad'], warn: ['Warning', 'warn'], ok: ['OK', 'good'] };
  const [t, c] = map[it.status];
  return el('span', `badge ${c}`, t);
}

function renderList() {
  const out = $('results');
  out.replaceChildren();
  const list = Core.filter(lastReport, kind);
  if (!list.length) {
    const empty = { errors: lastReport.items.length ? 'No errors: every field and button has a name and every ID reference resolves.' : 'No form fields or buttons found on this page.', warnings: 'No warnings.', all: 'No form fields or buttons found on this page.' }[kind];
    out.append(el('div', 'card good', empty));
  }
  for (const it of list.slice(0, 200)) {
    const row = el('div', 'card ctl-row');
    const head = el('div', 'row-head');
    head.append(el('code', 'desc', it.desc), badge(it));
    row.append(head);
    if (it.kind === 'field' || it.kind === 'button') {
      row.append(el('div', it.name ? 'name' : 'name bad', it.name ? `Name: “${it.name.length > 80 ? it.name.slice(0, 79) + '…' : it.name}” (from ${it.source})` : 'Name: none'));
    }
    for (const x of it.issues) {
      const d = el('div', 'issue');
      d.append(el('div', x.level === 'error' ? 'bad' : 'warn', x.msg), el('div', 'fix', x.fix));
      row.append(d);
    }
    const b = el('button', 'jump', 'Show on page');
    b.type = 'button';
    b.addEventListener('click', () => jump(it, b));
    row.append(b);
    out.append(row);
  }
  if (list.length > 200) out.append(el('div', 'muted small', `Showing the first 200 of ${list.length}. "Copy report" includes all of them.`));
  out.hidden = false;
}

function render(r) {
  const s = r.summary;
  $('summary').replaceChildren(
    stat(s.fields, 'form fields'), stat(s.buttons, 'buttons'), stat(s.unnamed, 'with no name', s.unnamed ? 'bad' : 'good'),
    stat(s.errors, 'errors', s.errors ? 'bad' : 'good'), stat(s.warnings, 'warnings', s.warnings ? 'warn' : 'good'),
    stat(`${s.brokenRefs}/${s.refsChecked}`, 'ID refs broken', s.brokenRefs ? 'bad' : 'good'));
  $('summary').hidden = false;
  const counts = { errors: s.errors, warnings: s.warnings, all: r.items.length };
  for (const b of $('tabs').querySelectorAll('button')) {
    const label = { errors: 'Errors', warnings: 'Warnings', all: 'All' }[b.dataset.kind];
    b.textContent = `${label} (${counts[b.dataset.kind]})`;
    b.setAttribute('aria-selected', String(b.dataset.kind === kind));
  }
  $('tabs').hidden = false;
  renderList();
  $('toolbar').hidden = false;
}

for (const b of document.querySelectorAll('#tabs button')) {
  b.addEventListener('click', () => { kind = b.dataset.kind; if (lastReport) render(lastReport); });
}

$('runBtn').addEventListener('click', async () => {
  const status = $('status');
  status.className = 'muted';
  status.textContent = 'Checking form labels and ARIA references…';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab.id;
    const [injection] = await chrome.scripting.executeScript({ target: { tabId }, files: ['content/extract.js'] });
    lastReport = Core.analyze(injection.result);
  } catch (e) {
    status.className = 'bad';
    status.textContent = 'This page can\'t be checked. Browser pages (chrome://, the Chrome Web Store, PDF viewer) are off-limits to extensions.';
    return;
  }
  kind = lastReport.summary.errors ? 'errors' : 'all';
  render(lastReport);
  const s = lastReport.summary;
  status.textContent = `Checked ${s.fields} field(s) and ${s.buttons} button(s). ${s.errors} error(s), ${s.warnings} warning(s), ${s.brokenRefs} broken ID reference(s).${s.truncated ? ' Stopped at 1000 controls.' : ''}`;
});

$('copyBtn').addEventListener('click', async () => {
  if (!lastReport) return;
  try {
    await navigator.clipboard.writeText(Core.toText(lastReport));
    $('copyBtn').textContent = 'Copied ✓';
  } catch {
    $('copyBtn').textContent = 'Copy failed';
  }
  setTimeout(() => { $('copyBtn').textContent = 'Copy report'; }, 1500);
});
