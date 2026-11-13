// Pure logic: no chrome.* and no DOM. Loads in the popup (<script>) and in Node tests (require).
// Turns the text blocks read by content/extract.js into readability scores, long-sentence warnings and hard words.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Core = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LONG = 25, VERY_LONG = 35, WPM = 238;
  const ABBR = new Set(['mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'e.g', 'i.e', 'inc', 'ltd', 'co', 'no', 'fig', 'approx', 'dept', 'est', 'u.s', 'u.k', 'a.m', 'p.m', 'mt', 'ave', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec']);
  const TARGETS = [
    { id: 'easy', grade: 5, label: 'Easy read (grade 5)' },
    { id: 'general', grade: 8, label: 'General public (grade 8)' },
    { id: 'news', grade: 10, label: 'News and blogs (grade 10)' },
    { id: 'professional', grade: 12, label: 'Professional (grade 12)' },
    { id: 'academic', grade: 16, label: 'Academic (grade 16)' },
  ];
  const round1 = x => Math.round(x * 10) / 10;
  const clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

  /** Words are runs of letters/digits, with inner apostrophes and hyphens kept (don't, well-known). */
  function words(text) {
    return String(text || '').match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu) || [];
  }

  /** Heuristic English syllable count (the same family of rules most readability tools use). */
  function syllables(word) {
    let w = String(word || '').toLowerCase().replace(/’/g, "'").replace(/[^a-z]/g, '');
    if (!w) return 0;
    if (w.length <= 3) return 1;
    if (!/(?:[sxzcg]|ch|sh)es$/.test(w)) w = w.replace(/(?:[^laeiouy]es|[^laeiouy]e)$/, m => m[0]);
    w = w.replace(/([^aeiouytd])ed$/, '$1').replace(/^y/, '');
    const groups = w.match(/[aeiouy]+/g);
    let n = groups ? groups.length : 0;
    if (/[^aeiou]ia/.test(w) || /[^aeiou]io(?!u)/.test(w) && !/[tsc]ion/.test(w)) n++;
    if (/[^aeiou]ea$/.test(w)) n++;
    return Math.max(1, n);
  }

  /** Splits a block of text into sentences. Abbreviations, initials and decimals don't end a sentence; the block end does. */
  function sentences(text) {
    const t = clean(text);
    if (!t) return [];
    const out = [];
    const re = /([.!?]+|…)(["'”’)\]]*)\s+(?=["'“‘(\[]?[\p{Lu}\p{N}])/gu;
    let start = 0, m;
    while ((m = re.exec(t))) {
      const endPunct = m.index + m[1].length;
      if (m[1] === '.') {
        const last = (t.slice(start, m.index).match(/(\S+)$/) || ['', ''])[1].toLowerCase().replace(/^["'“‘(\[]+/, '');
        if (ABBR.has(last) || /^\p{L}$/u.test(last)) continue;
      }
      out.push(t.slice(start, endPunct + m[2].length).trim());
      start = m.index + m[0].length;
    }
    const rest = t.slice(start).trim();
    if (rest) out.push(rest);
    return out.filter(s => words(s).length > 0);
  }

  function band(fre) {
    if (fre >= 90) return 'Very easy';
    if (fre >= 80) return 'Easy';
    if (fre >= 70) return 'Fairly easy';
    if (fre >= 60) return 'Plain English';
    if (fre >= 50) return 'Fairly difficult';
    if (fre >= 30) return 'Difficult';
    return 'Very difficult';
  }
  function gradeLabel(g) {
    if (g <= 5) return 'Very easy to read';
    if (g <= 8) return 'Plain English';
    if (g <= 12) return 'Fairly difficult (high school)';
    if (g <= 16) return 'Difficult (college)';
    return 'Very difficult (graduate)';
  }

  /** Scores for raw counts. Formulas: Flesch Reading Ease, Flesch-Kincaid, Gunning Fog, SMOG, Coleman-Liau, ARI. */
  function scores(c) {
    if (!c.words || !c.sentences) return null;
    const wps = c.words / c.sentences, spw = c.syllables / c.words;
    const fre = 206.835 - 1.015 * wps - 84.6 * spw;
    const fk = 0.39 * wps + 11.8 * spw - 15.59;
    const fog = 0.4 * (wps + 100 * c.complex / c.words);
    const smog = 1.043 * Math.sqrt(c.complex * 30 / c.sentences) + 3.1291;
    const cli = 0.0588 * (c.letters / c.words * 100) - 0.296 * (c.sentences / c.words * 100) - 15.8;
    const ari = 4.71 * (c.chars / c.words) + 0.5 * wps - 21.43;
    const grade = Math.max(0, (fk + fog + smog + cli + ari) / 5);
    return {
      fre: round1(Math.min(100, Math.max(0, fre))), fk: round1(Math.max(0, fk)), fog: round1(Math.max(0, fog)), smog: round1(Math.max(0, smog)),
      cli: round1(Math.max(0, cli)), ari: round1(Math.max(0, ari)), grade: round1(grade),
      band: band(fre), gradeLabel: gradeLabel(grade),
    };
  }

  /** Compares the average grade with a reading-level target. */
  function compare(grade, targetId) {
    const t = TARGETS.find(x => x.id === targetId) || TARGETS[1];
    const diff = round1(grade - t.grade);
    if (diff <= 0) return { target: t, status: 'good', msg: `On target for ${t.label}.` };
    if (diff <= 2) return { target: t, status: 'warn', msg: `${diff} grade(s) above ${t.label}. Shorten the longest sentences first.` };
    return { target: t, status: 'bad', msg: `${diff} grades above ${t.label}. Split long sentences and swap hard words for plain ones.` };
  }

  function analyze(data) {
    const blocks = (data && data.blocks) || [];
    const list = [];
    const c = { words: 0, sentences: 0, syllables: 0, complex: 0, letters: 0, chars: 0 };
    const hard = new Map();
    blocks.forEach((b, bi) => {
      for (const s of sentences(b.text)) {
        const ws = words(s);
        let syl = 0;
        for (const w of ws) {
          const n = syllables(w);
          syl += n;
          c.letters += (w.match(/\p{L}/gu) || []).length;
          c.chars += (w.match(/[\p{L}\p{N}]/gu) || []).length;
          if (n >= 3 && !/-/.test(w)) c.complex++;
          if (n >= 4 && /^\p{Ll}/u.test(w)) {
            const k = w.toLowerCase();
            const h = hard.get(k) || { word: k, syllables: n, count: 0 };
            h.count++;
            hard.set(k, h);
          }
        }
        c.words += ws.length; c.syllables += syl; c.sentences++;
        const level = ws.length > VERY_LONG ? 'very-long' : ws.length > LONG ? 'long' : null;
        list.push({ i: list.length, text: s, words: ws.length, syllables: syl, block: bi, path: b.path || null, tag: b.tag || null, level });
      }
    });
    const sc = scores(c);
    const longOnes = list.filter(s => s.level).sort((a, b) => b.words - a.words);
    for (const s of longOnes) {
      s.fix = s.level === 'very-long'
        ? `${s.words} words. Split this into two or three sentences; most readers lose track after about 25 words.`
        : `${s.words} words. Try splitting it or cutting extra words; aim for 15 to 20 words.`;
    }
    const notes = [];
    if (c.words && c.words < 100) notes.push('Under 100 words: scores are rough. Select or measure a longer passage for a steadier result.');
    if (c.sentences && c.sentences < 30) notes.push('SMOG is designed for 30 or more sentences, so treat it as approximate here.');
    if (data && data.truncated) notes.push('Very long page: only the first 200,000 characters were measured.');
    const hardWords = [...hard.values()].sort((a, b) => b.syllables - a.syllables || b.count - a.count || a.word.localeCompare(b.word)).slice(0, 15);
    return {
      url: (data && data.url) || '', source: (data && data.source) || 'body', blocks: blocks.length,
      stats: {
        words: c.words, sentences: c.sentences, syllables: c.syllables, complex: c.complex, letters: c.letters, chars: c.chars,
        wordsPerSentence: c.sentences ? round1(c.words / c.sentences) : 0,
        syllablesPerWord: c.words ? Math.round(c.syllables / c.words * 100) / 100 : 0,
        complexPct: c.words ? round1(100 * c.complex / c.words) : 0,
        readingMinutes: c.words ? Math.max(1, Math.round(c.words / WPM)) : 0,
        long: longOnes.filter(s => s.level === 'long').length, veryLong: longOnes.filter(s => s.level === 'very-long').length,
      },
      scores: sc, sentences: list, longSentences: longOnes, hardWords, notes,
    };
  }

  const SOURCE_LABEL = { selection: 'your selected text', article: 'the main article', main: 'the main content area', body: 'the page body (no <main> or <article> found)' };

  function toText(r, targetId) {
    const s = r.stats, sc = r.scores;
    const lines = [`Reading Level Meter report`, `Page: ${r.url}`, `Measured: ${SOURCE_LABEL[r.source] || r.source}`, ''];
    if (!sc) { lines.push('No readable text found.'); return lines.join('\n'); }
    const cmp = compare(sc.grade, targetId);
    lines.push(`Average grade level: ${sc.grade} (${sc.gradeLabel})`, `Target: ${cmp.msg}`,
      `Flesch Reading Ease: ${sc.fre} (${sc.band})`, `Flesch-Kincaid grade: ${sc.fk}`, `Gunning Fog: ${sc.fog}`, `SMOG: ${sc.smog}`,
      `Coleman-Liau: ${sc.cli}`, `Automated Readability Index: ${sc.ari}`, '',
      `Words: ${s.words} | Sentences: ${s.sentences} | Words per sentence: ${s.wordsPerSentence} | Syllables per word: ${s.syllablesPerWord}`,
      `Words with 3+ syllables: ${s.complexPct}% | Reading time: about ${s.readingMinutes} min`, '');
    lines.push(`Long sentences (over ${LONG} words): ${r.longSentences.length}`);
    for (const x of r.longSentences) lines.push(`- [${x.level === 'very-long' ? 'VERY LONG' : 'LONG'}] ${x.text}`, `  Fix: ${x.fix}`);
    lines.push('', `Hard words (4+ syllables): ${r.hardWords.length ? r.hardWords.map(h => `${h.word}${h.count > 1 ? ` x${h.count}` : ''}`).join(', ') : 'none'}`);
    for (const n of r.notes) lines.push(`Note: ${n}`);
    lines.push('', 'Scores use standard formulas with estimated syllable counts, for English text. Headings, navigation, headers, footers, sidebars and forms are not measured.');
    return lines.join('\n');
  }

  return { words, syllables, sentences, scores, compare, analyze, toText, TARGETS, LONG, VERY_LONG, SOURCE_LABEL };
});
