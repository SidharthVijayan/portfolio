// Selection Word Counter core: pure counting logic shared by the background service worker, the popup
// and the Node tests. No chrome.* calls here. Counts only; no readability or grade scores.
'use strict';
(function (root) {
  const DEFAULTS = Object.freeze({ readWpm: 238, speakWpm: 130 });
  const LIMITS = { readWpm: [50, 1000], speakWpm: [50, 400] };
  const MAX_CHARS = 2000000; // safety cap for pasted text; selections are far smaller

  // CJK ideographs and kana are written without spaces: each character counts as one word,
  // the convention used by common word processors.
  const CJK = '\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}';
  const W = `(?:(?![${CJK}])[\\p{L}\\p{M}\\p{N}])`;
  const WORD_RE = new RegExp(`[${CJK}]|${W}+(?:['\u2019.\\-\u2010\u2011_]${W}+)*`, 'gu');
  const LINEBREAK_RE = /\r\n|[\n\r\u2028\u2029\v\f\u0085]/g;
  const ABBREV = new Set(['mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'e.g', 'i.e', 'no', 'fig', 'approx', 'inc', 'ltd', 'co', 'mt', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec']);

  function sanitize(input) {
    const s = Object.assign({}, DEFAULTS);
    const src = input && typeof input === 'object' ? input : {};
    for (const k of Object.keys(LIMITS)) {
      const n = Math.round(Number(src[k]));
      if (src[k] !== undefined && src[k] !== null && src[k] !== '' && Number.isFinite(n)) s[k] = Math.min(LIMITS[k][1], Math.max(LIMITS[k][0], n));
    }
    return s;
  }

  function graphemes(text) {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      let n = 0;
      for (const _ of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) n++; // eslint-disable-line no-unused-vars
      return n;
    }
    return Array.from(text).length;
  }

  function words(text) { return text.match(WORD_RE) || []; }

  // Sentences: text ending in . ! ? … (or 。！？) followed by a space or the end of a line. It is not a
  // sentence end when the next word starts in lower case, or when a full stop follows a common
  // abbreviation (Mr., Dr., e.g.) or a single initial. Each line is counted on its own, so a heading or
  // list item without an end mark counts as one sentence.
  const END_RE = /[.!?\u2026]+["'\u201d\u2019)\]]*(?=\s|$)|[\u3002\uff01\uff1f]+[\u300d\u300f\u201d\u2019\uff09]*/gu;
  function sentences(text) {
    let count = 0;
    for (const line of text.split(LINEBREAK_RE)) {
      if (!words(line).length) continue;
      let start = 0, m;
      END_RE.lastIndex = 0;
      while ((m = END_RE.exec(line))) {
        const end = END_RE.lastIndex;
        const before = line.slice(start, m.index);
        const after = line.slice(end).replace(/^\s+/, '');
        if (!after) break; // the rest of the line is this sentence
        const lastWord = (before.match(/([\p{L}.]+)$/u) || [])[1] || '';
        const lw = lastWord.toLowerCase().replace(/\.$/, '');
        const isDot = m[0][0] === '.' && !/^\.\./.test(m[0]);
        const abbrev = isDot && (ABBREV.has(lw) || /^\p{Lu}$/u.test(lastWord) || /^(\p{L}\.)+\p{L}$/u.test(lastWord));
        const nextLower = /^["'\u201c\u2018(\[]*\p{Ll}/u.test(after);
        if (abbrev || nextLower) continue;
        if (words(line.slice(start, end)).length) count++;
        start = end;
      }
      if (words(line.slice(start)).length) count++;
    }
    return count;
  }

  function paragraphs(text) {
    return text.split(LINEBREAK_RE).filter(p => words(p).length > 0).length;
  }

  function count(rawText, settings) {
    const set = sanitize(settings);
    let text = typeof rawText === 'string' ? rawText : '';
    const truncated = text.length > MAX_CHARS;
    if (truncated) text = text.slice(0, MAX_CHARS);
    const w = words(text).length;
    const noBreaks = text.replace(LINEBREAK_RE, '');
    const chars = graphemes(noBreaks);
    const charsNoSpaces = graphemes(noBreaks.replace(/\s+/gu, ''));
    return {
      words: w,
      chars,
      charsNoSpaces,
      sentences: sentences(text),
      paragraphs: paragraphs(text),
      lineBreaks: (text.match(LINEBREAK_RE) || []).length,
      readSeconds: w ? Math.max(1, Math.round(w / set.readWpm * 60)) : 0,
      speakSeconds: w ? Math.max(1, Math.round(w / set.speakWpm * 60)) : 0,
      readWpm: set.readWpm,
      speakWpm: set.speakWpm,
      truncated,
    };
  }

  // "45 sec", "3 min 20 sec", "12 min", "1 hr 5 min"
  function duration(sec) {
    sec = Math.max(0, Math.round(Number(sec) || 0));
    if (sec === 0) return '0 sec';
    if (sec < 60) return `${sec} sec`;
    if (sec < 600) { const m = Math.floor(sec / 60), s = sec % 60; return s ? `${m} min ${s} sec` : `${m} min`; }
    const totalMin = Math.round(sec / 60);
    if (totalMin < 60) return `${totalMin} min`;
    const h = Math.floor(totalMin / 60), m = totalMin % 60;
    return m ? `${h} hr ${m} min` : `${h} hr`;
  }

  function fmt(n) { return Number(n).toLocaleString('en-US'); }

  // Toolbar badge: at most 4 characters.
  function badgeText(n) {
    if (!n) return '0';
    if (n < 1000) return String(n);
    if (n < 10000) { const k = Math.floor(n / 100) / 10; return (k % 1 ? k.toFixed(1) : String(k)) + 'k'; }
    if (n < 1000000) return Math.floor(n / 1000) + 'k';
    return Math.floor(n / 1000000) + 'M';
  }

  function summary(r) {
    return [
      `Words: ${fmt(r.words)}`,
      `Characters (with spaces): ${fmt(r.chars)}`,
      `Characters (no spaces): ${fmt(r.charsNoSpaces)}`,
      `Sentences: ${fmt(r.sentences)}`,
      `Paragraphs: ${fmt(r.paragraphs)}`,
      `Reading time: ${duration(r.readSeconds)} (at ${r.readWpm} words/min)`,
      `Speaking time: ${duration(r.speakSeconds)} (at ${r.speakWpm} words/min)`,
    ].join('\n');
  }

  function tooltip(r) {
    return `Selection Word Counter: ${fmt(r.words)} word${r.words === 1 ? '' : 's'}, ${fmt(r.chars)} characters, about ${duration(r.readSeconds)} to read`;
  }

  const api = { DEFAULTS, LIMITS, MAX_CHARS, sanitize, words, sentences, paragraphs, graphemes, count, duration, fmt, badgeText, summary, tooltip };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.WordCountCore = api;
})(typeof self !== 'undefined' ? self : this);
