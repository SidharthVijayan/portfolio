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

function render(report) {
  const s = report.summary;
  $('summary').replaceChildren(
    stat(s.blocks, 'blocks'), stat(s.entities, 'entities'),
    stat(s.errors, 'errors', s.errors ? 'bad' : 'good'), stat(s.warnings, 'warnings', s.warnings ? 'warn' : 'good'));
  $('summary').hidden = false;

  const out = $('results');
  out.replaceChildren();
  const types = Object.entries(s.typeCounts).map(([t, n]) => `${t} ×${n}`).join(', ');
  if (types) out.append(el('p', 'types', `Types: ${types}`));
  if (s.microdataItems || s.rdfaItems) out.append(el('p', 'types', `Also found (not checked): ${s.microdataItems} Microdata, ${s.rdfaItems} RDFa item(s).`));

  if (!s.blocks) {
    out.append(el('div', 'card', 'No JSON-LD structured data found on this page.'));
  }
  report.parseErrors.forEach(p => {
    const c = el('div', 'card');
    c.append(el('b', 'bad', `Block ${p.block}: could not parse`), el('div', 'fix', p.error));
    out.append(c);
  });

  const issuesOnly = $('issuesOnly').checked;
  report.entities.filter(e => !issuesOnly || e.issues.length).forEach(e => {
    const errs = e.issues.filter(i => i.level === 'error').length;
    const warns = e.issues.length - errs;
    const d = el('details', 'card');
    if (errs) d.open = true;
    const sum = el('summary');
    sum.append(el('span', null, `${e.nested ? '↳ ' : ''}${e.types.join(', ')}${e.reference ? ' (reference)' : ''}${e.label ? ' · ' + e.label : ''}`));
    sum.append(el('span', `badge ${errs ? 'bad' : warns ? 'warn' : 'good'}`, errs ? `${errs} error${errs > 1 ? 's' : ''}` : warns ? `${warns} warning${warns > 1 ? 's' : ''}` : 'OK'));
    const body = el('div', 'body');
    body.append(el('div', 'path', `Block ${e.block} · ${e.path}`));
    if (!e.issues.length) body.append(el('div', 'good', 'No issues found for the checked properties.'));
    e.issues.forEach(i => {
      const row = el('div', 'issue');
      row.append(el('div', i.level === 'error' ? 'bad' : 'warn', i.msg), el('div', 'fix', i.fix));
      body.append(row);
    });
    d.append(sum, body);
    out.append(d);
  });
  out.hidden = false;
  $('toolbar').hidden = !(s.blocks);
}

$('runBtn').addEventListener('click', async () => {
  const status = $('status');
  status.className = 'muted';
  status.textContent = 'Inspecting…';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const [injection] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/extract.js'] });
    lastReport = Core.analyze(injection.result);
    status.textContent = lastReport.summary.blocks
      ? `Found ${lastReport.summary.blocks} JSON-LD block(s).`
      : 'Done.';
    render(lastReport);
  } catch (e) {
    status.className = 'bad';
    status.textContent = 'This page can\'t be inspected. Browser pages (chrome://, the Chrome Web Store, PDF viewer) are off-limits to extensions.';
  }
});

$('issuesOnly').addEventListener('change', () => { if (lastReport) render(lastReport); });

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
