// Popup wiring: active tab -> inject read-only extract.js -> Core.analyze -> render with textContent only.
'use strict';
const $ = id => document.getElementById(id);
let lastReport = null;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text; // page data is never inserted as HTML
  return e;
}
function stat(value, label, cls) {
  const d = el('div', 'stat');
  d.append(el('b', cls, String(value)), el('span', null, label));
  return d;
}
const CANON = { conflict: ['Conflict', 'bad'], self: ['Self', 'good'], other: ['Other', 'warn'], missing: ['None', 'warn'], 'body-only': ['Ignored', 'bad'] };

function render(r) {
  const s = r.summary;
  const [cText, cCls] = CANON[s.canonical];
  $('summary').replaceChildren(
    stat(cText, 'canonical', cCls), stat(s.hreflangCount, 'hreflang'),
    stat(s.errors, 'errors', s.errors ? 'bad' : 'good'), stat(s.warnings, 'warnings', s.warnings ? 'warn' : 'good'));
  $('summary').hidden = false;

  const out = $('results');
  out.replaceChildren();

  const canon = el('div', 'card');
  const head = el('div', 'row');
  head.append(el('h2', null, 'Canonical'), el('span', `badge ${cCls}`, { conflict: 'conflicting', self: 'self-referencing', other: 'points elsewhere', missing: 'missing', 'body-only': 'in <body>' }[s.canonical]));
  canon.append(head, el('div', 'url', r.canonical.url || r.canonical.raw || 'No rel="canonical" link found.'));
  out.append(canon);

  const iss = el('div', 'card');
  iss.append(el('h2', null, r.issues.length ? `Issues (${r.issues.length})` : 'No issues found'));
  if (!r.issues.length) iss.append(el('div', 'good', 'Canonical and hreflang tags look consistent on this page.'));
  r.issues.forEach(i => {
    const row = el('div', 'issue');
    row.append(el('div', i.level === 'error' ? 'bad' : i.level === 'warn' ? 'warn' : 'info', i.msg), el('div', 'fix', i.fix));
    iss.append(row);
  });
  out.append(iss);
  const hl = el('div', 'card');
  const hh = el('div', 'row');
  hh.append(el('h2', null, `Hreflang (${s.hreflangCount})`), el('span', 'muted', r.selfHreflang ? `this page = ${r.selfHreflang}` : ''));
  hl.append(hh);
  if (!r.alternates.length) hl.append(el('div', 'muted', 'No hreflang alternate links on this page.'));
  else {
    const t = el('table');
    r.alternates.forEach(a => {
      const tr = el('tr', a.flags.includes('this page') ? 'self' : null);
      const c = el('td', `code ${a.valid ? '' : 'bad'}`, a.hreflang || '(empty)');
      const u = el('td');
      u.append(el('div', 'url', a.url || a.raw || '(empty)'));
      const f = a.flags.filter(x => x !== 'this page');
      if (f.length) u.append(el('div', 'flags', f.join(' · ')));
      tr.append(c, u);
      t.append(tr);
    });
    hl.append(t);
  }
  out.append(hl);

  out.hidden = false;
  $('toolbar').hidden = false;
  $('csvBtn').hidden = !r.alternates.length;
}

$('runBtn').addEventListener('click', async () => {
  const status = $('status');
  status.className = 'muted';
  status.textContent = 'Checking…';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const [injection] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/extract.js'] });
    lastReport = Core.analyze(injection.result);
    status.textContent = `Checked ${lastReport.summary.canonical === 'missing' ? 'no' : 'the'} canonical and ${lastReport.summary.hreflangCount} hreflang link(s).`;
    render(lastReport);
  } catch (e) {
    status.className = 'bad';
    status.textContent = 'This page can\'t be checked. Browser pages (chrome://, the Chrome Web Store, PDF viewer) are off-limits to extensions.';
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

// CSV export via a Blob link (no "downloads" permission needed).
$('csvBtn').addEventListener('click', () => {
  if (!lastReport) return;
  const blob = new Blob([Core.toCsv(lastReport)], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  let host = 'page';
  try { host = new URL(lastReport.url).hostname || 'page'; } catch {}
  a.download = `hreflang-${host}.csv`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
