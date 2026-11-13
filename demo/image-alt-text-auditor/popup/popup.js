// Popup wiring: active tab -> inject read-only extract.js -> Core.analyze -> render list.
// "Show on page" injects jumpToImage() to scroll to one image and draw a temporary outline box over it.
// Page data is always rendered with textContent, never as HTML.
'use strict';
const $ = id => document.getElementById(id);
let lastReport = null, tabId = null, kind = 'issues';

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

// Runs in the page (via chrome.scripting.executeScript). Finds image #index, scrolls it into view and
// overlays a temporary outline box that removes itself after 2.5s. The image itself is not modified.
function jumpToImage(index, src) {
  const elx = document.querySelectorAll('img, input[type="image" i]')[index];
  if (!elx) return { ok: false, reason: 'gone' };
  const cur = elx.currentSrc || elx.src || elx.getAttribute('src') || elx.getAttribute('data-src') || '';
  if (src && cur && cur !== src && elx.getAttribute('src') !== src) return { ok: false, reason: 'changed' };
  const r0 = elx.getBoundingClientRect();
  if (!(r0.width > 0 && r0.height > 0)) return { ok: false, reason: 'hidden' };
  elx.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
  const r = elx.getBoundingClientRect();
  document.querySelectorAll('[data-alt-auditor-box]').forEach(b => b.remove());
  const box = document.createElement('div');
  box.setAttribute('data-alt-auditor-box', '');
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

async function jump(im, btn) {
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: jumpToImage, args: [im.i, im.src] });
    const r = res && res.result;
    if (r && r.ok) { btn.textContent = 'Shown ✓'; }
    else btn.textContent = r && r.reason === 'hidden' ? 'Not visible' : 'Page changed, re-run';
  } catch { btn.textContent = 'Can\'t reach page'; }
  setTimeout(() => { btn.textContent = 'Show on page'; }, 1800);
}

function badge(im) {
  const map = { missing: ['No alt', 'bad'], empty: ['Empty alt', 'note'], decorative: ['Decorative', 'note'], filename: ['File name', 'warn'], generic: ['Placeholder', 'warn'], duplicate: ['Duplicate', 'warn'], ok: ['OK', 'good'] };
  const [t, c] = map[im.status] || ['', ''];
  return el('span', `badge ${c}`, t);
}

function renderList() {
  const out = $('results');
  out.replaceChildren();
  const list = Core.filter(lastReport, kind);
  if (!list.length) {
    out.append(el('div', 'card good', kind === 'issues' ? (lastReport.images.length ? 'No alt text problems found.' : 'No images found on this page.') : 'Nothing in this list.'));
  }
  for (const im of list) {
    const row = el('div', 'card img-row');
    const head = el('div', 'row-head');
    head.append(el('span', 'idx', `#${im.i + 1}`), el('span', 'file', im.file || '(no src)'), badge(im));
    if (im.dup) head.append(el('span', 'badge warn', `×${im.dup}`));
    row.append(head);
    row.append(el('div', im.alt == null ? 'alt bad' : 'alt', Core.altLabel(im)));
    const meta = [];
    if (im.tag === 'input') meta.push('image button');
    if (im.hiddenBy) meta.push(`hidden by ${im.hiddenBy}`);
    if (im.link) meta.push(`inside a ${im.link.kind}`);
    if (im.width && im.height) meta.push(`${im.width}×${im.height}px`);
    if (!im.visible) meta.push('not visible');
    if (im.lazy) meta.push('lazy, not loaded yet');
    if (meta.length) row.append(el('div', 'muted small', meta.join(' · ')));
    for (const x of im.issues) {
      const d = el('div', 'issue');
      d.append(el('div', x.level === 'error' ? 'bad' : x.level === 'warn' ? 'warn' : 'info', x.msg), el('div', 'fix', x.fix));
      row.append(d);
    }
    const b = el('button', 'jump', 'Show on page');
    b.type = 'button';
    if (!im.visible) { b.disabled = true; b.textContent = 'Not visible'; }
    b.addEventListener('click', () => jump(im, b));
    row.append(b);
    out.append(row);
  }
  out.hidden = false;
}

function render(r) {
  const s = r.summary;
  $('summary').replaceChildren(
    stat(s.total, 'images'), stat(s.needsAttention, 'need attention', s.needsAttention ? 'warn' : 'good'),
    stat(s.missing, 'missing alt', s.missing ? 'bad' : 'good'), stat(s.empty + s.decorative, 'empty / decorative'),
    stat(s.filename + s.generic, 'file name / placeholder', s.filename + s.generic ? 'warn' : 'good'), stat(s.duplicate, 'duplicate alt', s.duplicate ? 'warn' : 'good'));
  $('summary').hidden = false;
  const counts = { issues: Core.filter(r, 'issues').length, all: r.images.length, decorative: Core.filter(r, 'decorative').length };
  for (const b of $('tabs').querySelectorAll('button')) {
    const label = { issues: 'Issues', all: 'All', decorative: 'Decorative' }[b.dataset.kind];
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
  status.textContent = 'Reading images…';
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
  kind = 'issues';
  render(lastReport);
  const s = lastReport.summary;
  status.textContent = `Found ${s.total} image(s). ${s.errors} error(s), ${s.warnings} warning(s).`;
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
