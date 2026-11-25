// Invisible Character Finder: pure logic, no chrome.* and no DOM. Loads in the popup (<script>), in the page's
// isolated world (injected file, for cleaning a field and highlighting) and in Node tests (require).
// analyze(text) finds zero-width and other invisible characters, direction controls, hidden "tag" characters
// (and the message they spell), control characters, special spaces and look-alike letters, and says which ones
// are usually fine (an emoji joiner, a joiner in Malayalam or Persian, a no-break space). clean(text, choices)
// removes or replaces the chosen kinds and always keeps the ones that are usually fine.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.InvisCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const KINDS = [
    { key: 'invisible', label: 'Zero-width and invisible characters', clean: 'Remove zero-width and invisible characters', on: true,
      hint: 'Take no space on screen but are still part of the text: they break search, word counts, links and passwords, and can tag copied text.' },
    { key: 'tag', label: 'Hidden tag characters', clean: 'Remove hidden tag characters', on: true,
      hint: 'Invisible copies of letters from the Unicode “tags” block. They can carry a whole hidden message, for example instructions aimed at AI tools.' },
    { key: 'direction', label: 'Direction controls', clean: 'Remove direction controls', on: true,
      hint: 'Change the order in which text is shown, so what you see is not what is stored (used in “Trojan Source” tricks and fake file names).' },
    { key: 'control', label: 'Control and broken characters', clean: 'Remove control characters', on: true,
      hint: 'Leftovers from other programs or broken encoding; most apps don\'t show them.' },
    { key: 'lookalike', label: 'Look-alike letters', clean: 'Replace look-alike letters with plain letters', on: true,
      hint: 'Letters from another alphabet or a styled maths block that look like plain letters, so the word no longer matches searches, spell-check or a real address.' },
    { key: 'space', label: 'Special spaces', clean: 'Turn fake spaces into normal spaces', on: true,
      hint: 'Look like ordinary spaces but are different characters (no-break, thin, wide); they can stop searches and find-and-replace from matching.' },
  ];
  const KIND = Object.fromEntries(KINDS.map(k => [k.key, k]));

  // code point -> [short code, name, kind]
  const TABLE = new Map();
  const add = (cp, code, name, kind) => TABLE.set(cp, { code, name, kind });
  add(0x200B, 'ZWSP', 'Zero-width space', 'invisible');
  add(0x200C, 'ZWNJ', 'Zero-width non-joiner', 'invisible');
  add(0x200D, 'ZWJ', 'Zero-width joiner', 'invisible');
  add(0x2060, 'WJ', 'Word joiner', 'invisible');
  add(0xFEFF, 'BOM', 'Zero-width no-break space (byte order mark)', 'invisible');
  add(0x00AD, 'SHY', 'Soft hyphen', 'invisible');
  add(0x034F, 'CGJ', 'Combining grapheme joiner', 'invisible');
  add(0x180E, 'MVS', 'Mongolian vowel separator', 'invisible');
  add(0x115F, 'HCF', 'Hangul choseong filler', 'invisible');
  add(0x1160, 'HJF', 'Hangul jungseong filler', 'invisible');
  add(0x3164, 'HF', 'Hangul filler (looks blank)', 'invisible');
  add(0xFFA0, 'HWHF', 'Half-width Hangul filler (looks blank)', 'invisible');
  add(0x17B4, 'KIV', 'Khmer inherent vowel (invisible)', 'invisible');
  add(0x17B5, 'KIV', 'Khmer inherent vowel (invisible)', 'invisible');
  add(0x2061, 'FA', 'Invisible function application', 'invisible');
  add(0x2062, 'IT', 'Invisible times', 'invisible');
  add(0x2063, 'IS', 'Invisible separator', 'invisible');
  add(0x2064, 'IP', 'Invisible plus', 'invisible');
  for (let c = 0x206A; c <= 0x206F; c++) add(c, 'DFC', 'Deprecated invisible format character', 'invisible');
  for (let c = 0x1D173; c <= 0x1D17A; c++) add(c, 'MFC', 'Invisible musical formatting character', 'invisible');
  add(0x200E, 'LRM', 'Left-to-right mark', 'direction');
  add(0x200F, 'RLM', 'Right-to-left mark', 'direction');
  add(0x061C, 'ALM', 'Arabic letter mark', 'direction');
  add(0x202A, 'LRE', 'Left-to-right embedding', 'direction');
  add(0x202B, 'RLE', 'Right-to-left embedding', 'direction');
  add(0x202C, 'PDF', 'Pop directional formatting', 'direction');
  add(0x202D, 'LRO', 'Left-to-right override', 'direction');
  add(0x202E, 'RLO', 'Right-to-left override (reverses text)', 'direction');
  add(0x2066, 'LRI', 'Left-to-right isolate', 'direction');
  add(0x2067, 'RLI', 'Right-to-left isolate', 'direction');
  add(0x2068, 'FSI', 'First strong isolate', 'direction');
  add(0x2069, 'PDI', 'Pop directional isolate', 'direction');
  add(0x00A0, 'NBSP', 'No-break space', 'space');
  add(0x202F, 'NNBSP', 'Narrow no-break space', 'space');
  add(0x2007, 'FSP', 'Figure space', 'space');
  add(0x2000, 'NQSP', 'En quad', 'space');
  add(0x2001, 'MQSP', 'Em quad', 'space');
  add(0x2002, 'ENSP', 'En space', 'space');
  add(0x2003, 'EMSP', 'Em space', 'space');
  add(0x2004, '3/MSP', 'Three-per-em space', 'space');
  add(0x2005, '4/MSP', 'Four-per-em space', 'space');
  add(0x2006, '6/MSP', 'Six-per-em space', 'space');
  add(0x2008, 'PSP', 'Punctuation space', 'space');
  add(0x2009, 'THSP', 'Thin space', 'space');
  add(0x200A, 'HSP', 'Hair space', 'space');
  add(0x205F, 'MMSP', 'Medium mathematical space', 'space');
  add(0x3000, 'IDSP', 'Ideographic (full-width) space', 'space');
  add(0x1680, 'OGSP', 'Ogham space mark', 'space');
  add(0x2800, 'BRBL', 'Braille blank (looks like a space)', 'space');
  add(0x2028, 'LSEP', 'Line separator', 'control');
  add(0x2029, 'PSEP', 'Paragraph separator', 'control');
  add(0xFFFC, 'OBJ', 'Object replacement character', 'control');
  add(0xFFFD, 'REPL', 'Replacement character (text was garbled when converted)', 'control');
  for (let c = 0xFFF9; c <= 0xFFFB; c++) add(c, 'IAC', 'Interlinear annotation character', 'control');
  const C0 = ['NUL', 'SOH', 'STX', 'ETX', 'EOT', 'ENQ', 'ACK', 'BEL', 'BS', 'TAB', 'LF', 'VT', 'FF', 'CR', 'SO', 'SI', 'DLE', 'DC1', 'DC2', 'DC3', 'DC4', 'NAK', 'SYN', 'ETB', 'CAN', 'EM', 'SUB', 'ESC', 'FS', 'GS', 'RS', 'US'];
  for (let c = 0; c < 32; c++) if (c !== 9 && c !== 10 && c !== 13) add(c, C0[c], 'Control character ' + C0[c], 'control');
  add(0x7F, 'DEL', 'Control character DEL', 'control');
  for (let c = 0x80; c <= 0x9F; c++) add(c, 'C1', 'Control character (C1)', 'control');

  // Look-alike letters from other alphabets -> the Latin letter they imitate.
  const LOOK = {
    // Cyrillic
    'а': 'a', 'в': 'B', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x', 'і': 'i', 'ј': 'j', 'ѕ': 's', 'һ': 'h', 'ԁ': 'd', 'ԛ': 'q', 'ԝ': 'w', 'ӏ': 'l', 'ү': 'y', 'ѵ': 'v', 'ɡ': 'g',
    'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M', 'Н': 'H', 'О': 'O', 'Р': 'P', 'С': 'C', 'Т': 'T', 'Х': 'X', 'І': 'I', 'Ј': 'J', 'Ѕ': 'S', 'Ү': 'Y', 'Ԛ': 'Q', 'Ԝ': 'W', 'Ӏ': 'I', 'Ь': 'b',
    // Greek
    'ο': 'o', 'α': 'a', 'ν': 'v', 'ι': 'i', 'κ': 'k', 'ρ': 'p', 'υ': 'u', 'ϲ': 'c', 'ϳ': 'j',
    'Α': 'A', 'Β': 'B', 'Ε': 'E', 'Ζ': 'Z', 'Η': 'H', 'Ι': 'I', 'Κ': 'K', 'Μ': 'M', 'Ν': 'N', 'Ο': 'O', 'Ρ': 'P', 'Τ': 'T', 'Υ': 'Y', 'Χ': 'X',
    // Armenian
    'օ': 'o', 'ս': 'u', 'հ': 'h', 'ո': 'n', 'ց': 'g', 'զ': 'q',
  };
  const SCRIPT_OF = ch => /\p{Script=Cyrillic}/u.test(ch) ? 'Cyrillic' : /\p{Script=Greek}/u.test(ch) ? 'Greek' : /\p{Script=Armenian}/u.test(ch) ? 'Armenian' : 'Latin';

  const RE = {
    latin: /\p{Script=Latin}/u,
    letter: /[\p{L}\p{M}]/u,
    rtl: /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}]/u,
    cjk: /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u,
    joining: /[\p{Script=Arabic}\p{Script=Syriac}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Gurmukhi}\p{Script=Gujarati}\p{Script=Oriya}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Kannada}\p{Script=Malayalam}\p{Script=Sinhala}\p{Script=Myanmar}\p{Script=Khmer}\p{Script=Mongolian}\p{Script=Nko}\p{Script=Thaana}]/u,
    pict: /[\p{Extended_Pictographic}\p{Emoji_Modifier}\u20E3\uFE0F]/u,
    vsBase: /[\p{Extended_Pictographic}\p{Emoji}\p{S}\p{Script=Han}]/u,
  };
  const hex = cp => 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');
  const isTag = cp => cp >= 0xE0000 && cp <= 0xE007F;
  const vsIndex = cp => cp >= 0xFE00 && cp <= 0xFE0F ? cp - 0xFE00 : cp >= 0xE0100 && cp <= 0xE01EF ? cp - 0xE0100 + 16 : -1;

  // Split into code points with UTF-16 offsets.
  function points(text) {
    const out = [];
    for (let i = 0; i < text.length;) { const cp = text.codePointAt(i); const n = cp > 0xFFFF ? 2 : 1; out.push({ i, n, cp, ch: text.slice(i, i + n) }); i += n; }
    return out;
  }

  function context(text) {
    const s = String(text || '');
    let latin = 0, letters = 0;
    for (const ch of s) if (/\p{L}/u.test(ch)) { letters++; if (RE.latin.test(ch)) latin++; }
    return { rtl: RE.rtl.test(s), cjk: RE.cjk.test(s), mostlyLatin: letters > 0 && latin / letters > 0.5 };
  }

  // Words (runs of letters/marks plus the invisible characters that may sit inside them).
  function wordAt(pts, k) {
    const inWord = p => RE.letter.test(p.ch) || (TABLE.get(p.cp) && TABLE.get(p.cp).kind === 'invisible');
    let a = k, b = k;
    while (a > 0 && inWord(pts[a - 1])) a--;
    while (b < pts.length - 1 && inWord(pts[b + 1])) b++;
    return pts.slice(a, b + 1);
  }

  /**
   * @param {string} text
   * @param {{context?: string}} [opt] context: the whole text when analysing one piece of it (one text node)
   */
  function analyze(text, opt) {
    text = String(text || '');
    const ctx = context(opt && opt.context != null ? opt.context : text);
    const pts = points(text);
    const findings = [];
    const messages = [];
    const push = (p, info, fine, why, extra) => findings.push(Object.assign({ i: p.i, n: p.n, cp: p.cp, hex: hex(p.cp), code: info.code, name: info.name, kind: info.kind, fine: !!fine, why: why || '' }, extra || {}));

    for (let k = 0; k < pts.length; k++) {
      const p = pts[k], prev = pts[k - 1], next = pts[k + 1];
      // Tag characters: fine inside an emoji subdivision flag (black flag + tags + cancel tag), hidden text otherwise.
      if (isTag(p.cp)) {
        let e = k; while (e < pts.length && isTag(pts[e].cp)) e++;
        const run = pts.slice(k, e);
        const flag = prev && prev.cp === 0x1F3F4 && run[run.length - 1].cp === 0xE007F;
        let msg = '';
        for (const r of run) {
          const name = r.cp === 0xE007F ? 'Cancel tag' : r.cp === 0xE0001 ? 'Language tag' : r.cp >= 0xE0020 && r.cp <= 0xE007E ? `Tag “${String.fromCharCode(r.cp - 0xE0000)}”` : 'Unassigned tag character';
          if (r.cp >= 0xE0020 && r.cp <= 0xE007E) msg += String.fromCharCode(r.cp - 0xE0000);
          push(r, { code: 'TAG', name, kind: 'tag' }, flag, flag ? 'Part of a flag emoji (like 🏴 Scotland or Wales).' : '');
        }
        if (!flag && msg.trim()) messages.push({ via: 'tag characters', at: p.i, text: msg });
        k = e - 1;
        continue;
      }
      // Variation selectors: one after an emoji, symbol or Chinese character is normal; a run of them can smuggle bytes.
      const vs = vsIndex(p.cp);
      if (vs >= 0) {
        let e = k; while (e < pts.length && vsIndex(pts[e].cp) >= 0) e++;
        const run = pts.slice(k, e);
        const okBase = prev && RE.vsBase.test(prev.ch) && !/[\p{L}]/u.test(prev.ch.replace(/\p{Script=Han}/u, ''));
        const single = run.length === 1;
        if (run.length >= 4) {
          const bytes = run.map(r => vsIndex(r.cp));
          let decoded = '';
          try { decoded = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes)); } catch (er) { decoded = ''; }
          if (decoded && /^[\x20-\x7E\u00A0-\uFFFF\s]+$/.test(decoded) && /[\p{L}\p{N}]/u.test(decoded)) messages.push({ via: 'variation selectors', at: p.i, text: decoded });
        }
        for (const r of run) {
          const n = vsIndex(r.cp) + 1;
          push(r, { code: 'VS' + n, name: 'Variation selector ' + n, kind: 'invisible' }, single && okBase,
            single && okBase ? (r.cp === 0xFE0F ? 'Asks for the emoji style of the symbol before it.' : 'Picks a style of the symbol before it.') : run.length > 1 ? 'A run of variation selectors can hide data.' : 'Has no visible job after this character.');
        }
        k = e - 1;
        continue;
      }
      const info = TABLE.get(p.cp);
      if (info) {
        let fine = false, why = '';
        if (p.cp === 0x200D) {
          if (prev && next && RE.pict.test(prev.ch) && RE.pict.test(next.ch)) { fine = true; why = 'Joins emoji into one (like a family or a profession).'; }
          else if (prev && RE.joining.test(prev.ch) && (!next || RE.joining.test(next.ch) || !RE.letter.test(next.ch))) { fine = true; why = 'Shapes letters in scripts like Malayalam, Hindi or Arabic.'; }
        } else if (p.cp === 0x200C) {
          if (prev && next && RE.joining.test(prev.ch) && RE.joining.test(next.ch)) { fine = true; why = 'Keeps letters apart in scripts like Persian, Hindi or Malayalam.'; }
        } else if (p.cp === 0x200E || p.cp === 0x200F || p.cp === 0x061C) {
          if (ctx.rtl) { fine = true; why = 'Common in text that mixes right-to-left and left-to-right writing.'; }
        } else if (p.cp === 0xFEFF && p.i === 0 && !(opt && opt.context != null)) {
          why = 'A byte order mark at the start, left over from a file.';
        } else if (info.kind === 'space') {
          if (p.cp === 0x3000) { fine = ctx.cjk; why = fine ? 'Normal in Chinese, Japanese and Korean text.' : ''; }
          else if (p.cp === 0x1680 || p.cp === 0x2800) { fine = false; }
          else { fine = true; why = p.cp === 0x00A0 || p.cp === 0x202F ? 'Often used on purpose, to keep “10 km” or “Mr. Rao” on one line.' : 'Used in typesetting.'; }
        }
        push(p, info, fine, why);
        continue;
      }
      // Look-alike letters: another alphabet's letter inside a Latin word, or a whole word of look-alikes in Latin text.
      if (LOOK[p.ch]) {
        const word = wordAt(pts, k).map(q => q.ch);
        const hasLatin = word.some(c => RE.latin.test(c));
        const allLook = word.filter(c => RE.letter.test(c)).every(c => LOOK[c]);
        if (hasLatin || (allLook && ctx.mostlyLatin)) {
          push(p, { code: hex(p.cp), name: `${SCRIPT_OF(p.ch)} “${p.ch}” that looks like “${LOOK[p.ch]}”`, kind: 'lookalike' }, false,
            hasLatin ? 'Mixed into a word of plain letters.' : 'A whole word of look-alike letters in English text.', { latin: LOOK[p.ch] });
        }
        continue;
      }
      // Styled letters (maths bold/italic, full-width, circled) and ligatures that normalize to plain letters.
      if (p.cp > 0x7F && /[\p{L}\p{N}]/u.test(p.ch)) {
        const plain = p.ch.normalize('NFKC');
        if (plain !== p.ch && /^[A-Za-z0-9]{1,3}$/.test(plain)) {
          const full = p.cp >= 0xFF00 && p.cp <= 0xFFEF;
          const lig = p.cp >= 0xFB00 && p.cp <= 0xFB06;
          const fine = full && ctx.cjk;
          push(p, { code: hex(p.cp), name: full ? `Full-width “${p.ch}” (plain “${plain}”)` : lig ? `Ligature “${p.ch}” (plain “${plain}”)` : `Styled “${p.ch}” (plain “${plain}”)`, kind: 'lookalike' }, fine,
            fine ? 'Normal in Chinese, Japanese and Korean text.' : lig ? 'Often left behind when copying from a PDF; search and spell-check miss the word.' : 'Fancy-font letters from the maths or full-width blocks; screen readers and search read them differently.', { latin: plain });
        }
      }
    }

    // Group by kind, then by character.
    const groups = [];
    for (const k of KINDS) {
      const fs = findings.filter(f => f.kind === k.key);
      if (!fs.length) continue;
      const byChar = new Map();
      for (const f of fs) {
        const key = f.kind === 'tag' ? 'TAG' + (f.fine ? '-flag' : '') : f.hex + (f.fine ? '-fine:' + f.why : '');
        if (!byChar.has(key)) byChar.set(key, { hex: f.kind === 'tag' ? 'U+E00xx' : f.hex, code: f.code, name: f.kind === 'tag' ? (f.fine ? 'Tag characters in a flag emoji' : 'Tag characters (hidden letters)') : f.name, fine: f.fine, why: f.why, count: 0, first: f.i, latin: f.latin });
        byChar.get(key).count++;
      }
      groups.push({ key: k.key, label: k.label, hint: k.hint, count: fs.length, problems: fs.filter(f => !f.fine).length, items: [...byChar.values()] });
    }
    const problems = findings.filter(f => !f.fine).length;
    return { length: text.length, chars: pts.length, findings, groups, problems, fine: findings.length - problems, messages };
  }

  function defaultChoices(res) {
    const c = {};
    for (const k of KINDS) c[k.key] = k.on;
    return c;
  }

  /** Remove or replace the chosen kinds; characters that are usually fine are always kept. */
  function clean(text, choices, opt) {
    text = String(text || '');
    choices = choices || defaultChoices();
    const res = analyze(text, opt);
    let out = '', last = 0, removed = 0, replaced = 0;
    for (const f of res.findings) {
      if (f.fine || !choices[f.kind]) continue;
      out += text.slice(last, f.i);
      if (f.kind === 'lookalike') { out += f.latin; replaced++; }
      else if (f.kind === 'space') { out += ' '; replaced++; }
      else if (f.kind === 'control' && (f.cp === 0x2028 || f.cp === 0x2029)) { out += '\n'; replaced++; }
      else removed++;
      last = f.i + f.n;
    }
    out += text.slice(last);
    return { text: out, removed, replaced, changed: removed + replaced };
  }

  /** Segments for showing the text with every finding made visible. */
  function markup(text, res, max) {
    text = String(text || '');
    max = max || 4000;
    const segs = [];
    let last = 0;
    for (const f of res.findings) {
      if (f.i >= max) break;
      if (f.i > last) segs.push({ t: 'text', s: text.slice(last, f.i) });
      const prev = segs[segs.length - 1];
      // A run of the same invisible character (or of tag characters) becomes one mark with a count.
      if (f.i === last && prev && prev.t === 'mark' && !prev.visible && f.kind !== 'lookalike' && prev.fine === f.fine && (prev.base === f.code || (f.kind === 'tag' && prev.kind === 'tag'))) {
        prev.n++; prev.code = `${prev.base} ×${prev.n}`;
        prev.title = f.kind === 'tag' ? `${prev.n} hidden tag characters (U+E00xx)` : `${prev.n} × ${f.hex} ${f.name}`;
      } else {
        segs.push({ t: 'mark', kind: f.kind, fine: f.fine, base: f.code, n: 1, code: f.kind === 'lookalike' ? text.slice(f.i, f.i + f.n) : f.code, title: `${f.hex} ${f.name}${f.why ? '. ' + f.why : ''}`, visible: f.kind === 'lookalike' });
      }
      last = f.i + f.n;
    }
    if (last < Math.min(text.length, max)) segs.push({ t: 'text', s: text.slice(last, max) });
    return { segs, cut: text.length > max };
  }

  /** Spans to highlight on the page: the word around a zero-width character, the character itself otherwise. */
  function highlightSpans(text, res) {
    const spans = [];
    const isSpace = c => /[\s]/.test(c) && !TABLE.has(c.codePointAt(0));
    for (const f of res.findings) {
      if (f.fine) continue;
      let a = f.i, b = f.i + f.n;
      if (f.kind !== 'space' && f.kind !== 'lookalike') {
        while (a > 0 && f.i - a < 40 && !isSpace(text[a - 1])) a--;
        while (b < text.length && b - f.i < 40 && !isSpace(text[b])) b++;
      }
      const last = spans[spans.length - 1];
      if (last && a <= last.b && last.kind === (f.kind === 'lookalike' ? 'lookalike' : 'hidden')) { last.b = Math.max(last.b, b); continue; }
      spans.push({ a, b, kind: f.kind === 'lookalike' ? 'lookalike' : 'hidden' });
    }
    return spans;
  }

  const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;

  function summary(res, source) {
    const where = { selection: 'the selected text', field: 'this field', pasted: 'the pasted text' }[source] || 'the text';
    if (!res.length) return `Nothing to check in ${where}.`;
    if (!res.findings.length) return `No invisible, special or look-alike characters in ${where} (${plural(res.chars, 'character')}).`;
    let s = res.problems ? `Found ${plural(res.problems, 'hidden or look-alike character')} in ${where}` : `Nothing suspicious in ${where}`;
    if (res.fine) s += `${res.problems ? ', plus' : ':'} ${plural(res.fine, 'special character')} that ${res.fine === 1 ? 'is' : 'are'} usually fine`;
    s += '.';
    if (res.messages.length) s += ` It hides a message: “${res.messages[0].text.slice(0, 60)}${res.messages[0].text.length > 60 ? '…' : ''}”.`;
    return s;
  }
  const statusClass = res => res.messages.length ? 'bad' : res.problems ? 'warn' : 'good';

  return { KINDS, KIND, analyze, clean, defaultChoices, markup, highlightSpans, summary, statusClass, context, hex };
});
