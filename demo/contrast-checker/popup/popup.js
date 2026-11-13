// Popup wiring: active tab -> inject read-only extract.js -> Core.analyze -> render list.
// "Show on page" injects jumpToText() to scroll to one element and draw a temporary outline box over it.
// Page data is always rendered with textContent, never as HTML. Swatch colours are Core.hex() values.
'use strict';
const $ = id => document.getElementById(id);
let lastReport = null, tabId = null, kind = 'fails';

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

// Runs in the page (via chrome.scripting.executeScript). Finds the element by its CSS path, checks its text
// still matches, scrolls it into view and overlays a temporary outline box that removes itself after 2.5s.
// The element itself is not modified.
function jumpToText(path, text) {
  let elx = null;
  try { elx = document.querySelector(path); } catch (e) { elx = null; }
  if (!elx) return { ok: false, reason: 'gone' };
  const own = [...elx.childNodes].filter(n => n.nodeType === 3).map(n => n.nodeValue).join(' ').replace(/\s+/g, ' ').trim();
  if (text && own.slice(0, 120) !== text) return { ok: false, reason: 'changed' };
  const r0 = elx.getBoundingClientRect();
  if (!(r0.width > 0 && r0.height > 0)) return { ok: false, reason: 'hidden' };
  elx.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
  const r = elx.getBoundingClientRect();
  document.querySelectorAll('[data-contrast-checker-box]').forEach(b => b.remove());
  const box = document.createElement('div');
  box.setAttribute('data-contrast-checker-box', '');
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
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: jumpToText, args: [it.path, it.text] });
    const r = res && res.result;
    if (r && r.ok) btn.textContent = 'Shown ✓';
    else btn.textContent = r && r.reason === 'hidden' ? 'Not visible' : 'Page changed, re-run';
  } catch { btn.textContent = 'Can\'t reach page'; }
  setTimeout(() => { btn.textContent = 'Show on page'; }, 1800);
}

function badge(it) {
  const map = { fail: ['Fails AA', 'bad'], aaa: ['AA only', 'warn'], pass: ['AAA', 'good'], unsure: ['Check by eye', 'note'], exempt: ['Disabled', 'note'] };
  const [t, c] = map[it.status] || ['', ''];
  return el('span', `badge ${c}`, t);
}

function swatch(fg, bg) {
  const s = el('span', 'swatch', 'Aa');
  if (bg) s.style.backgroundColor = bg;
  if (fg) s.style.color = fg;
  return s;
}

function renderList() {
  const out = $('results');
  out.replaceChildren();
  const list = Core.filter(lastReport, kind);
  if (!list.length) {
    const empty = { fails: lastReport.items.length ? 'No text fails WCAG AA contrast.' : 'No visible text found on this page.', aaa: 'Nothing passes AA but misses AAA.', unsure: 'No text over background images.', all: 'No visible text found on this page.' }[kind];
    out.append(el('div', 'card good', empty));
  }
  for (const it of list.slice(0, 200)) {
    const row = el('div', 'card txt-row');
    const head = el('div', 'row-head');
    head.append(swatch(it.fg, it.bg), el('span', 'ratio', it.ratioText || 'n/a'), badge(it));
    row.append(head);
    row.append(el('div', 'sample', `“${it.text.length > 90 ? it.text.slice(0, 89) + '…' : it.text}”`));
    row.append(el('div', 'muted small', `<${it.tag}> · text ${it.fg || '?'} on ${it.bg} · ${it.sizeText || ''} · needs ${it.need.aa}:1 AA, ${it.need.aaa}:1 AAA`));
    for (const x of it.issues) {
      const d = el('div', 'issue');
      d.append(el('div', x.level === 'error' ? 'bad' : x.level === 'warn' ? 'warn' : 'info', x.msg), el('div', 'fix', x.fix));
      row.append(d);
    }
    if (it.suggestion) {
      const sg = el('div', 'suggest');
      sg.append(swatch(it.suggestion.color, it.bg), el('span', null, `Try ${it.suggestion.color} (${Core.fmt(it.suggestion.ratio)})`));
      row.append(sg);
    }
    const b = el('button', 'jump', 'Show on page');
    b.type = 'button';
    b.addEventListener('click', () => jump(it, b));
    row.append(b);
    out.append(row);
  }
  if (list.length > 200) out.append(el('div', 'muted small', `Showing the 200 lowest of ${list.length}. "Copy report" includes all of them.`));
  out.hidden = false;
}

function render(r) {
  const s = r.summary;
  $('summary').replaceChildren(
    stat(s.total, 'text elements'), stat(s.fail, 'fail AA', s.fail ? 'bad' : 'good'), stat(s.aaa, 'pass AA, fail AAA', s.aaa ? 'warn' : 'good'),
    stat(s.pass, 'pass AAA', 'good'), stat(s.unsure, 'check by eye'), stat(s.lowest == null ? 'n/a' : Core.fmt(s.lowest), 'lowest ratio', s.fail ? 'bad' : 'good'));
  $('summary').hidden = false;
  const counts = { fails: s.fail, aaa: s.aaa, unsure: s.unsure, all: s.total };
  for (const b of $('tabs').querySelectorAll('button')) {
    const label = { fails: 'Fails AA', aaa: 'AAA only', unsure: 'Check', all: 'All' }[b.dataset.kind];
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
  status.textContent = 'Measuring text contrast…';
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
  kind = 'fails';
  render(lastReport);
  const s = lastReport.summary;
  status.textContent = `Checked ${s.total} text element(s). ${s.fail} fail AA (${s.failCombos} colour combination(s)), ${s.aaa} pass AA but not AAA.${s.truncated ? ' Stopped at 1500 elements.' : ''}`;
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
