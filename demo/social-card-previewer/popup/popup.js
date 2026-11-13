// Popup wiring: active tab -> inject read-only extract.js -> Core.analyze -> load preview image -> re-analyze with its real size.
// Page data is always rendered with textContent, never as HTML.
'use strict';
const $ = id => document.getElementById(id);
let lastReport = null;

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
function imgBox(src, cls) {
  const box = el('div', cls);
  if (src) {
    const i = el('img');
    i.alt = '';
    i.referrerPolicy = 'no-referrer';
    i.src = src;
    i.addEventListener('error', () => { box.replaceChildren(el('span', 'noimg', 'Image failed to load')); });
    box.append(i);
  } else box.append(el('span', 'noimg', 'No image'));
  return box;
}

function render(r) {
  const s = r.summary;
  const cardLabel = { summary_large_image: 'large', summary: 'summary', app: 'app', player: 'player' }[s.card] || s.card;
  $('summary').replaceChildren(
    stat(s.tags, 'tags'), stat(cardLabel, 'X card', r.tw.card ? '' : 'warn'),
    stat(s.errors, 'errors', s.errors ? 'bad' : 'good'), stat(s.warnings, 'warnings', s.warnings ? 'warn' : 'good'));
  $('summary').hidden = false;

  const m = Core.previewModel(r);
  const out = $('results');
  out.replaceChildren();

  const p1 = el('div', 'card');
  p1.append(el('h2', null, 'Large link preview'), el('div', 'muted small', 'Approximate Facebook / LinkedIn style'));
  const big = el('div', 'pv-large');
  const bt = el('div', 'pv-text');
  bt.append(el('div', 'pv-domain', m.large.domain), el('div', 'pv-title', m.large.title));
  if (m.large.description) bt.append(el('div', 'pv-desc', m.large.description));
  big.append(imgBox(m.large.image, 'pv-img'), bt);
  p1.append(big);
  out.append(p1);

  const p2 = el('div', 'card');
  p2.append(el('h2', null, `X card (${r.card})`), el('div', 'muted small', 'Approximate'));
  const x = el('div', m.x.layout === 'large' ? 'pv-x large' : 'pv-x small');
  const xt = el('div', 'pv-text');
  if (m.x.layout === 'large') xt.append(el('div', 'pv-domain', `From ${m.x.domain}`), el('div', 'pv-title', m.x.title));
  else { xt.append(el('div', 'pv-domain', m.x.domain), el('div', 'pv-title', m.x.title)); if (m.x.description) xt.append(el('div', 'pv-desc', m.x.description)); }
  x.append(imgBox(m.x.image, 'pv-img'), xt);
  p2.append(x);
  if (r.actual) p2.append(el('div', 'muted small', `Image: ${r.actual.width}×${r.actual.height}px`));
  out.append(p2);

  const iss = el('div', 'card');
  iss.append(el('h2', null, r.issues.length ? `Issues (${r.issues.length})` : 'No issues found'));
  if (!r.issues.length) iss.append(el('div', 'good', 'Open Graph and X card tags look complete.'));
  r.issues.forEach(i => {
    const row = el('div', 'issue');
    row.append(el('div', i.level === 'error' ? 'bad' : i.level === 'warn' ? 'warn' : 'info', i.msg), el('div', 'fix', i.fix));
    iss.append(row);
  });
  out.append(iss);

  const tg = el('div', 'card');
  tg.append(el('h2', null, `Tags found (${r.tags.length})`));
  if (!r.tags.length) tg.append(el('div', 'muted', 'No og: or twitter: meta tags on this page.'));
  else {
    const t = el('table');
    r.tags.forEach(x => { const tr = el('tr'); tr.append(el('td', 'code', x.key), el('td', 'url', x.value || '(empty)')); t.append(tr); });
    tg.append(t);
  }
  out.append(tg);

  out.hidden = false;
  $('toolbar').hidden = false;
}

// Loads the image the way a viewer would, to learn its real pixel size. Resolves null on failure.
function measure(src) {
  return new Promise(resolve => {
    if (!src) return resolve(undefined);
    const i = new Image();
    i.referrerPolicy = 'no-referrer';
    const done = v => { clearTimeout(t); resolve(v); };
    const t = setTimeout(() => done(undefined), 8000);
    i.onload = () => done({ width: i.naturalWidth, height: i.naturalHeight });
    i.onerror = () => done(null);
    i.src = src;
  });
}

$('runBtn').addEventListener('click', async () => {
  const status = $('status');
  status.className = 'muted';
  status.textContent = 'Reading tags…';
  let raw;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const [injection] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/extract.js'] });
    raw = injection.result;
  } catch (e) {
    status.className = 'bad';
    status.textContent = 'This page can\'t be checked. Browser pages (chrome://, the Chrome Web Store, PDF viewer) are off-limits to extensions.';
    return;
  }
  lastReport = Core.analyze(raw);
  render(lastReport);
  status.textContent = `Found ${lastReport.summary.tags} social tag(s).`;
  if (lastReport.image) {
    status.textContent += ' Measuring image…';
    const size = await measure(lastReport.image);
    lastReport = Core.analyze(raw, size === null ? { imageError: true } : { image: size || null });
    render(lastReport);
    status.textContent = `Found ${lastReport.summary.tags} social tag(s).${size === undefined ? ' Image size could not be measured in time.' : ''}`;
  }
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
