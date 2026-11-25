// Popup (also used as a small window when Chrome can't open the popup): shows the counts for the text
// handed over by the right-click menu, lets the user edit or paste text, copy the counts, and set the
// reading and speaking speeds. Uses textContent only.
'use strict';
const C = self.WordCountCore;
const $ = id => document.getElementById(id);
let settings = C.sanitize({});
let source = null; // 'selection' | 'edited' | null
let at = null;
let current = C.count('', settings);

if (typeof location !== 'undefined' && /[?&]window=1/.test(location.search || '')) document.body.className = 'window';

function timeOf(ms) {
  const d = new Date(ms);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function render() {
  const text = $('text').value;
  const r = current = C.count(text, settings);
  $('words').textContent = C.fmt(r.words);
  $('wordsLabel').textContent = r.words === 1 ? 'word' : 'words';
  $('chars').textContent = C.fmt(r.chars);
  $('charsNoSpaces').textContent = C.fmt(r.charsNoSpaces);
  $('sentences').textContent = C.fmt(r.sentences);
  $('paragraphs').textContent = C.fmt(r.paragraphs);
  $('readTime').textContent = C.duration(r.readSeconds);
  $('speakTime').textContent = C.duration(r.speakSeconds);
  if (source === 'selection') $('source').textContent = `Counting the text you selected${at ? ' at ' + timeOf(at) : ''}.`;
  else if (source === 'edited' && text) $('source').textContent = 'Counting the text in the box below.';
  else $('source').textContent = 'Select text on a page, right-click it and choose "Count words in selection". Or paste text below.';
  const notes = [];
  if (source === 'selection' && r.words > 0 && r.lineBreaks === 0) notes.push('Right-clicked text arrives as one line, so paragraphs show as 1. Paste text below to count them.');
  if (r.truncated) notes.push(`Only the first ${C.fmt(C.MAX_CHARS)} characters are counted.`);
  $('note').textContent = notes.join(' ');
  $('copyBtn').disabled = !text;
  $('clearBtn').disabled = !text;
}

function show(last) {
  if (last && typeof last.text === 'string') { $('text').value = last.text; source = last.source || 'selection'; at = last.at || null; }
  else { $('text').value = ''; source = null; at = null; }
  render();
}

$('text').addEventListener('input', () => {
  source = 'edited'; at = Date.now();
  render();
  const text = $('text').value;
  if (text) chrome.storage.session.set({ last: { text, at, source } });
  else chrome.storage.session.remove('last');
});

$('copyBtn').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(C.summary(current)); $('status').textContent = 'Counts copied to the clipboard.'; }
  catch (e) { $('status').textContent = 'Could not copy. Select the numbers and copy them by hand.'; }
});

$('clearBtn').addEventListener('click', async () => {
  await chrome.storage.session.remove('last');
  show(null);
  $('status').textContent = '';
});

for (const k of ['readWpm', 'speakWpm']) {
  $(k).addEventListener('change', async () => {
    settings = C.sanitize(Object.assign({}, settings, { [k]: $(k).value }));
    $(k).value = String(settings[k]);
    await chrome.storage.local.set({ settings });
    render();
  });
}

// A new right-click while the popup or window is open replaces the text.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.last && changes.last.newValue && changes.last.newValue.source === 'selection' && changes.last.newValue.text !== $('text').value) show(changes.last.newValue);
});

self.popupReady = (async () => {
  const [{ settings: s }, { last }] = await Promise.all([chrome.storage.local.get('settings'), chrome.storage.session.get('last')]);
  settings = C.sanitize(s);
  $('readWpm').value = String(settings.readWpm);
  $('speakWpm').value = String(settings.speakWpm);
  show(last);
})();
