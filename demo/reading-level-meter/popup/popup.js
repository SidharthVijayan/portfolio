// Popup wiring: active tab -> inject read-only extract.js -> Core.analyze -> render scores, long sentences and hard words.
// "Show on page" injects jumpToBlock() to scroll to one paragraph and draw a temporary outline box over it.
// Page text is always rendered with textContent, never as HTML. The target picker is not saved (no storage).
'use strict';
const $ = id => document.getElementById(id);
let lastReport = null, tabId = null, kind = 'long', target = 'general';

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

// Runs in the page (via chrome.scripting.executeScript). Finds the block by its CSS path, scrolls it into view
// and overlays a temporary outline box that removes itself after 2.5s. The page's own elements are not modified.
function jumpToBlock(path, tag) {
  let elx = null;
  try { elx = document.querySelector(path); } catch (e) { elx = null; }
  if (!elx) return { ok: false, reason: 'gone' };
  if (tag && tag !== 'selection' && elx.tagName.toLowerCase() !== tag) return { ok: false, reason: 'changed' };
  const r0 = elx.getBoundingClientRect();
  if (!(r0.width > 0 && r0.height > 0)) return { ok: false, reason: 'hidden' };
  elx.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
  const r = elx.getBoundingClientRect();
  document.querySelectorAll('[data-reading-level-meter-box]').forEach(b => b.remove());
  const box = document.createElement('div');
  box.setAttribute('data-reading-level-meter-box', '');
  box.setAttribute('aria-hidden', 'true');
  Object.assign(box.style, {
    position: 'absolute', left: `${r.left + scrollX - 6}px`, top: `${r.top + scrollY - 6}px`,
    width: `${r.width + 12}px`, height: `${r.height + 12}px`, border: '4px solid #f59e0b', borderRadius: '6px',
    boxShadow: '0 0 0 4px rgba(15,23,42,.55)', pointerEvents: 'none', zIndex: '2147483647', boxSizing: 'border-box',
  });
  document.documentElement.appendChild(box);
  setTimeout(() => box.remove(), 2500);
  return { ok: true };
}

async function jump(s, btn) {
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: jumpToBlock, args: [s.path, s.tag] });
    const r = res && res.result;
    if (r && r.ok) btn.textContent = 'Shown ✓';
    else btn.textContent = r && r.reason === 'hidden' ? 'Not visible' : 'Page changed, re-run';
  } catch { btn.textContent = 'Can\'t reach page'; }
  setTimeout(() => { btn.textContent = 'Show on page'; }, 1800);
}

function renderLong(out) {
  const list = lastReport.longSentences;
  if (!list.length) out.append(el('div', 'card good', `No sentences over ${Core.LONG} words.`));
  for (const s of list.slice(0, 100)) {
    const row = el('div', 'card sent-row');
    const head = el('div', 'row-head');
    head.append(el('b', s.level === 'very-long' ? 'bad' : 'warn', `${s.words} words`), el('span', `badge ${s.level === 'very-long' ? 'bad' : 'warn'}`, s.level === 'very-long' ? 'Very long' : 'Long'));
    row.append(head, el('div', 'sent', s.text.length > 400 ? s.text.slice(0, 399) + '…' : s.text), el('div', 'fix', s.fix));
    if (s.path) {
      const b = el('button', 'jump', 'Show on page');
      b.type = 'button';
      b.addEventListener('click', () => jump(s, b));
      row.append(b);
    }
    out.append(row);
  }
  if (list.length > 100) out.append(el('div', 'muted small', `Showing the 100 longest of ${list.length}. "Copy report" includes all of them.`));
}

function renderWords(out) {
  const list = lastReport.hardWords;
  if (!list.length) { out.append(el('div', 'card good', 'No words of 4 or more syllables.')); return; }
  const card = el('div', 'card');
  card.append(el('div', 'muted', 'Words with 4 or more syllables. A shorter, everyday word often reads easier.'));
  const wrap = el('div', 'words');
  for (const h of list) wrap.append(el('span', 'chip', `${h.word} · ${h.syllables} syl${h.count > 1 ? ` · ×${h.count}` : ''}`));
  card.append(wrap);
  card.querySelector('.muted').style.marginBottom = '6px';
  out.append(card);
}

function renderScores(out) {
  const sc = lastReport.scores, s = lastReport.stats;
  const t = el('table', 'scores');
  const rows = [
    ['Flesch Reading Ease (0 to 100, higher is easier)', `${sc.fre} · ${sc.band}`], ['Flesch-Kincaid grade', sc.fk], ['Gunning Fog', sc.fog],
    ['SMOG', sc.smog], ['Coleman-Liau', sc.cli], ['Automated Readability Index', sc.ari], ['Average grade', sc.grade],
    ['Words per sentence', s.wordsPerSentence], ['Syllables per word', s.syllablesPerWord], ['Words with 3+ syllables', `${s.complexPct}%`],
  ];
  for (const [k, v] of rows) { const tr = el('tr'); tr.append(el('td', null, k), el('td', null, String(v))); t.append(tr); }
  const card = el('div', 'card'); card.append(t); out.append(card);
}

function renderTab() {
  const out = $('results');
  out.replaceChildren();
  ({ long: renderLong, words: renderWords, scores: renderScores })[kind](out);
  for (const n of lastReport.notes) out.append(el('div', 'muted small', n));
  out.hidden = false;
}

function renderVerdict() {
  const c = Core.compare(lastReport.scores.grade, target);
  const v = $('verdict');
  v.replaceChildren(el('div', c.status, c.msg));
  v.hidden = false;
}

function render(r) {
  const s = r.stats, sc = r.scores;
  $('summary').replaceChildren(
    stat(sc.grade, 'grade level', sc.grade <= 8 ? 'good' : sc.grade <= 12 ? 'warn' : 'bad'), stat(sc.fre, `reading ease · ${sc.band}`),
    stat(`${s.readingMinutes} min`, 'reading time'), stat(s.words, 'words'), stat(s.sentences, 'sentences'),
    stat(s.long + s.veryLong, 'long sentences', s.long + s.veryLong ? 'warn' : 'good'));
  $('summary').hidden = false;
  $('targetRow').hidden = false;
  renderVerdict();
  const counts = { long: r.longSentences.length, words: r.hardWords.length };
  for (const b of $('tabs').querySelectorAll('button')) {
    const label = { long: 'Long sentences', words: 'Hard words', scores: 'Scores' }[b.dataset.kind];
    b.textContent = b.dataset.kind in counts ? `${label} (${counts[b.dataset.kind]})` : label;
    b.setAttribute('aria-selected', String(b.dataset.kind === kind));
  }
  $('tabs').hidden = false;
  renderTab();
  $('toolbar').hidden = false;
}

for (const t of Core.TARGETS) { const o = el('option', null, t.label); o.value = t.id; $('target').append(o); }
$('target').value = target;
$('target').addEventListener('change', () => { target = $('target').value; if (lastReport && lastReport.scores) renderVerdict(); });
for (const b of document.querySelectorAll('#tabs button')) {
  b.addEventListener('click', () => { kind = b.dataset.kind; if (lastReport && lastReport.scores) render(lastReport); });
}

$('runBtn').addEventListener('click', async () => {
  const status = $('status');
  status.className = 'muted';
  status.textContent = 'Reading the page text…';
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
  if (!lastReport.scores) {
    for (const id of ['summary', 'targetRow', 'verdict', 'tabs', 'results', 'toolbar']) $(id).hidden = true;
    status.className = 'warn';
    status.textContent = 'No readable paragraphs found here. Select some text on the page and try again.';
    return;
  }
  kind = lastReport.longSentences.length ? 'long' : 'scores';
  render(lastReport);
  const s = lastReport.stats;
  status.className = 'muted';
  status.textContent = `Measured ${Core.SOURCE_LABEL[lastReport.source]}: ${s.words} words in ${s.sentences} sentences.${lastReport.source === 'selection' ? ' Clear the selection to measure the whole page.' : ' Select text first to measure just that part.'}`;
});

$('copyBtn').addEventListener('click', async () => {
  if (!lastReport) return;
  try {
    await navigator.clipboard.writeText(Core.toText(lastReport, target));
    $('copyBtn').textContent = 'Copied ✓';
  } catch {
    $('copyBtn').textContent = 'Copy failed';
  }
  setTimeout(() => { $('copyBtn').textContent = 'Copy report'; }, 1500);
});
