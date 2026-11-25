// Keyword Density Checker: pure logic (no chrome.*, no DOM). Loads in the popup (<script>) and in Node tests (require).
// Input: what content/extract.js returns (the page's main text as blocks, plus its title and H1 headings).
// Output: word / two-word / three-word phrase counts with density (times used ÷ total words × 100), a focus-keyword
// check, a copyable table and a CSV. Everything runs locally; nothing is stored or sent.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KDCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Common English words that carry no topic on their own ("Hide common words").
  const STOP_WORDS = new Set((
    'a about above after again against all almost also although always am among an and another any anyone anything are ' +
    'around as at away back be became because become been before being below between both but by can cannot could did ' +
    'do does doing done down during each either else enough etc even ever every few for from further get gets getting ' +
    'give given go goes going gone got had has have having he her here hers herself him himself his how however i if in ' +
    'into is isn it its itself just least less let like made make makes many may me might mine more most much must my ' +
    'myself near need neither never no nor not now of off often on once one only onto or other others our ours ' +
    'ourselves out over own per perhaps put quite rather really same say says see seen shall she should since so some ' +
    'something sometimes still such than that the their theirs them themselves then there these they thing things ' +
    'this those though through thus till to too toward towards under until up upon us use used using very via was we ' +
    'well were what whatever when where whether which while who whom whose why will with within without would yet you ' +
    'your yours yourself yourselves aren can\'t couldn didn doesn don don\'t hadn hasn haven isn\'t ll re ve shouldn wasn ' +
    'weren won won\'t wouldn i\'m i\'ve i\'d i\'ll you\'re you\'ve you\'d you\'ll he\'s she\'s it\'s we\'re we\'ve they\'re ' +
    'they\'ve that\'s there\'s what\'s let\'s doesn\'t didn\'t isn wasn\'t aren\'t weren\'t haven\'t hasn\'t hadn\'t ' +
    'wouldn\'t shouldn\'t couldn\'t'
  ).split(/\s+/).filter(Boolean));

  const WORD = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;
  const isNumber = w => /^[\p{N}]+(?:[-'][\p{N}]+)*$/u.test(w);
  const norm = w => w.toLowerCase().replace(/’/g, '\'').replace(/'s$/, '');

  // Text -> runs of words. A run ends wherever anything other than spaces sits between two words
  // (full stops, commas, brackets, dashes, quotes…), so phrases never cross a sentence or a list break.
  function runs(text) {
    const out = [];
    let cur = [], last = 0;
    for (const m of String(text || '').matchAll(WORD)) {
      const gap = text.slice(last, m.index);
      if (cur.length && /[^\s]/.test(gap)) { out.push(cur); cur = []; }
      cur.push(norm(m[0]));
      last = m.index + m[0].length;
    }
    if (cur.length) out.push(cur);
    return out;
  }
  const words = text => runs(text).flat();

  // Singular/plural pairs that both occur: pools -> pool, stories -> story, boxes -> box, matches -> match.
  function pluralMap(counts) {
    const map = new Map();
    for (const w of counts.keys()) {
      if (w.length < 4 || !/s$/.test(w) || /(ss|us|is|'s)$/.test(w) || isNumber(w)) continue;
      const cands = [];
      if (/ies$/.test(w)) cands.push(w.slice(0, -3) + 'y');
      if (/(s|x|z|ch|sh)es$/.test(w)) cands.push(w.slice(0, -2));
      cands.push(w.slice(0, -1));
      const s = cands.find(c => c.length >= 2 && counts.has(c));
      if (s) map.set(w, s);
    }
    return map;
  }

  const DEFAULTS = { stop: true, plurals: true };
  const round2 = n => Math.round(n * 100) / 100;

  // A term (one or more words) appears in a piece of text as whole words (plurals folded the same way).
  function containsTerm(text, termWords, fold) {
    for (const r of runs(text)) {
      const ws = r.map(fold);
      for (let i = 0; i + termWords.length <= ws.length; i++) if (termWords.every((t, j) => ws[i + j] === t)) return true;
    }
    return false;
  }

  function analyze(page, options) {
    const opts = Object.assign({}, DEFAULTS, options || {});
    const blocks = (page && page.blocks) || [];
    const blockRuns = blocks.map(b => runs(b.text));
    const all = blockRuns.flat(2);
    const total = all.length;
    const raw = new Map();
    for (const w of all) raw.set(w, (raw.get(w) || 0) + 1);
    const plural = opts.plurals ? pluralMap(raw) : new Map();
    const fold = w => plural.get(w) || w;
    const stopCount = all.filter(w => STOP_WORDS.has(w)).length;
    const skip = w => w.length < 2 || isNumber(w) || (opts.stop && STOP_WORDS.has(w));
    const title = (page && page.title) || '';
    const h1s = ((page && page.h1) || []).join(' \n. ');

    // Single words
    const one = new Map();
    for (const w of all) {
      if (skip(w)) continue;
      const k = fold(w);
      const e = one.get(k) || { term: k, n: 1, count: 0, forms: new Map() };
      e.count++; e.forms.set(w, (e.forms.get(w) || 0) + 1);
      one.set(k, e);
    }
    // Two- and three-word phrases, inside runs only
    const grams = { 2: new Map(), 3: new Map() };
    for (const r of blockRuns.flat()) {
      for (const n of [2, 3]) {
        for (let i = 0; i + n <= r.length; i++) {
          const ws = r.slice(i, i + n);
          const first = ws[0], lastW = ws[n - 1];
          if (ws.some(w => isNumber(w) && (w === first || w === lastW))) continue;
          if (opts.stop && (STOP_WORDS.has(first) || STOP_WORDS.has(lastW) || ws.every(w => STOP_WORDS.has(w)))) continue;
          if (ws.some(w => w.length < 2 && !/^[\p{N}]$/u.test(w) && w !== 'a')) continue;
          const key = ws.map(fold).join(' ');
          const e = grams[n].get(key) || { term: key, n, count: 0, forms: new Map() };
          e.count++; const f = ws.join(' '); e.forms.set(f, (e.forms.get(f) || 0) + 1);
          grams[n].set(key, e);
        }
      }
    }
    const finish = (map, min) => [...map.values()].filter(e => e.count >= min).map(e => {
      const termWords = e.term.split(' ');
      const forms = [...e.forms.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(f => f[0]);
      return {
        term: e.term, n: e.n, count: e.count,
        density: total ? round2(e.count / total * 100) : 0,
        label: forms.length > 1 ? forms.slice().sort((a, b) => a.length - b.length || (a < b ? -1 : 1)).join(' / ') : forms[0],
        inTitle: containsTerm(title, termWords, fold),
        inH1: containsTerm(h1s, termWords, fold),
      };
    }).sort((a, b) => b.count - a.count || (a.term < b.term ? -1 : a.term > b.term ? 1 : 0));

    const notes = [];
    if (page && page.truncated) notes.push('Very long page: only the first 200,000 characters were counted.');
    if (total && total < 100) notes.push(`Only ${total} words: with so little text, a single use changes the density a lot.`);
    return {
      url: (page && page.url) || '', title, source: (page && page.source) || 'body',
      totalWords: total, uniqueWords: raw.size,
      stopShare: total ? Math.round(stopCount / total * 100) : 0,
      words: finish(one, 1), bigrams: finish(grams[2], 2), trigrams: finish(grams[3], 2),
      options: opts, notes, _fold: fold, _blocks: blocks, _h1: h1s,
    };
  }

  // Focus keyword: how often a word or phrase the user typed appears, where it appears, and a plain guide.
  function focus(res, phrase) {
    const termWords = words(phrase);
    if (!termWords.length) return null;
    const fold = res._fold || (w => w);
    const t = termWords.map(fold);
    let count = 0, firstAt = -1, pos = 0, headings = 0;
    for (const b of res._blocks || []) {
      let inBlock = false;
      for (const r of runs(b.text)) {
        const ws = r.map(fold);
        for (let i = 0; i + t.length <= ws.length; i++) {
          if (t.every((x, j) => ws[i + j] === x)) { count++; inBlock = true; if (firstAt < 0) firstAt = pos + i; i += t.length - 1; }
        }
        pos += ws.length;
      }
      if (inBlock && /^h[2-6]$/.test(b.tag)) headings++;
    }
    const density = res.totalWords ? round2(count / res.totalWords * 100) : 0;
    let level, verdict;
    if (!count) { level = 'bad'; verdict = 'Not used in the main text.'; }
    else if (density < 0.5) { level = 'warn'; verdict = 'Used lightly. Fine if the topic is clear; add it where it reads naturally.'; }
    else if (density <= 2.5) { level = 'good'; verdict = 'In a usual range for a page about this topic.'; }
    else if (density <= 4) { level = 'warn'; verdict = 'On the high side. Read the text aloud and swap some uses for related words.'; }
    else { level = 'bad'; verdict = 'Very high. This can read as keyword stuffing; rewrite some uses.'; }
    return {
      phrase: termWords.join(' '), count, density, level, verdict,
      inTitle: containsTerm(res.title, t, fold), inH1: containsTerm(res._h1 || '', t, fold),
      inFirst100: firstAt >= 0 && firstAt < 100, inHeadings: headings,
      note: 'A rough guide only: Google publishes no ideal keyword density. Write for readers first.',
    };
  }

  const LISTS = { 1: 'words', 2: 'bigrams', 3: 'trigrams' };
  const yn = b => (b ? 'yes' : 'no');
  const cell = v => { let s = String(v); if (/^[=+\-@\t\r]/.test(s)) s = '\'' + s; return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

  // Tab-separated table of one list (pastes into Google Sheets / Excel as columns).
  function toTable(res, n) {
    const rows = res[LISTS[n]] || [];
    return ['Phrase\tCount\tDensity %\tIn title\tIn H1', ...rows.map(r => [r.label.replace(/\t/g, ' '), r.count, r.density.toFixed(2), yn(r.inTitle), yn(r.inH1)].join('\t'))].join('\n');
  }
  // CSV of all three lists, plus a header block with the page and totals.
  function toCsv(res) {
    const lines = [
      ['Page', res.url].map(cell).join(','),
      ['Total words', res.totalWords].map(cell).join(','),
      ['Common words hidden', yn(res.options.stop)].map(cell).join(','),
      '',
      'Words in phrase,Phrase,Count,Density %,In title,In H1',
    ];
    for (const n of [1, 2, 3]) for (const r of res[LISTS[n]]) lines.push([n, r.label, r.count, r.density.toFixed(2), yn(r.inTitle), yn(r.inH1)].map(cell).join(','));
    return '\uFEFF' + lines.join('\r\n') + '\r\n';
  }
  function fileName(url) {
    let host = 'page';
    try { host = new URL(url).hostname.replace(/^www\./, '') || 'page'; } catch (e) { /* keep default */ }
    return `keyword-density-${host.replace(/[^a-z0-9.-]/gi, '-')}.csv`;
  }
  const SOURCES = { article: 'the main article', main: 'the main content area', body: 'the page text', selection: 'your selection' };
  function summary(res) {
    if (!res.totalWords) return 'No readable text found on this page.';
    return `Counted ${res.totalWords.toLocaleString('en-US')} words in ${SOURCES[res.source] || 'the page text'} (${res.uniqueWords.toLocaleString('en-US')} different).`;
  }

  return { STOP_WORDS, DEFAULTS, runs, words, pluralMap, analyze, focus, toTable, toCsv, fileName, summary };
});
