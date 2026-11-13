// Contrast Checker core: pure functions, no DOM, no network. Shared by the popup and Node tests.
// Implements WCAG 2.2 SC 1.4.3 Contrast (Minimum, level AA) and SC 1.4.6 Contrast (Enhanced, level AAA):
// relative luminance, contrast ratio, the "large text" rule (>= 24px, or >= 18.66px and bold), and the
// exemption for disabled (inactive) controls. Ratios are compared unrounded, as WCAG requires.
// This is a helper, not a full accessibility audit: text over images or gradients can't be measured from CSS alone.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Core = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const AA = { normal: 4.5, large: 3 };
  const AAA = { normal: 7, large: 4.5 };
  const WHITE = { r: 255, g: 255, b: 255, a: 1 };
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // Parses computed CSS colours: rgb()/rgba() (comma or space syntax, % alpha), #rgb/#rgba/#rrggbb/#rrggbbaa, transparent.
  function parseColor(s) {
    if (s == null) return null;
    s = String(s).trim().toLowerCase();
    if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
    let m = s.match(/^#([0-9a-f]{3,8})$/);
    if (m) {
      let h = m[1];
      if (h.length === 3 || h.length === 4) h = h.split('').map(c => c + c).join('');
      if (h.length !== 6 && h.length !== 8) return null;
      const n = i => parseInt(h.slice(i, i + 2), 16);
      return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? Math.round(n(6) / 255 * 1000) / 1000 : 1 };
    }
    m = s.match(/^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/);
    if (!m) return null;
    const ch = v => v.endsWith('%') ? parseFloat(v) * 2.55 : parseFloat(v);
    const al = v => v == null ? 1 : v.endsWith('%') ? parseFloat(v) / 100 : parseFloat(v);
    return { r: clamp(ch(m[1]), 0, 255), g: clamp(ch(m[2]), 0, 255), b: clamp(ch(m[3]), 0, 255), a: clamp(al(m[4]), 0, 1) };
  }

  // Alpha-composites colour `top` over colour `bottom` (source-over).
  function blend(top, bottom) {
    const a = top.a + bottom.a * (1 - top.a);
    if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
    const c = k => (top[k] * top.a + bottom[k] * bottom.a * (1 - top.a)) / a;
    return { r: c('r'), g: c('g'), b: c('b'), a };
  }

  function luminance(c) {
    const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  }
  function ratio(fg, bg) {
    const a = luminance(fg), b = luminance(bg);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }
  const fmt = r => `${(Math.floor(r * 100) / 100).toFixed(2)}:1`; // floor so a displayed value never overstates a pass
  const hex = c => '#' + [c.r, c.g, c.b].map(v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');

  const weightNum = w => w === 'bold' || w === 'bolder' ? 700 : w === 'normal' || w === 'lighter' || w == null || w === '' ? 400 : (parseInt(w, 10) || 400);
  // WCAG large text: at least 18pt (24px), or 14pt (18.66px) and bold.
  const isLarge = (px, weight) => px >= 24 || (px >= 18.66 && weightNum(weight) >= 700);

  // Nearest text colour that meets `target` on `bg`, by darkening or lightening the original colour in small steps.
  function suggest(fg, bg, target) {
    const opts = [];
    for (const toward of [0, 255]) {
      for (let t = 0.01; t <= 1.0001; t += 0.01) {
        const c = { r: Math.round(fg.r + (toward - fg.r) * t), g: Math.round(fg.g + (toward - fg.g) * t), b: Math.round(fg.b + (toward - fg.b) * t), a: 1 };
        if (ratio(c, bg) >= target) { opts.push({ t, color: hex(c), ratio: ratio(c, bg), direction: toward ? 'lighter' : 'darker' }); break; }
      }
    }
    opts.sort((x, y) => x.t - y.t);
    return opts[0] || null;
  }

  const shorten = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

  // raw = { url, items: [{ i, tag, path, text, color, opacity, fontSize, fontWeight, layers: [{ color, image }], disabled }] }
  // layers run from the element itself outward to the root; extraction stops at the first opaque background.
  function analyze(raw) {
    const items = (raw.items || []).map(src => {
      const it = { ...src, issues: [] };
      let bg = WHITE; // the browser canvas is white by default
      const layers = (src.layers || []).slice();
      for (let k = layers.length - 1; k >= 0; k--) {
        const c = parseColor(layers[k].color) || { r: 0, g: 0, b: 0, a: 0 };
        bg = blend(c, bg);
      }
      // An image on the element itself or between it and the nearest opaque colour sits on top of that colour.
      const image = layers.some((l, k) => l.image && !layers.slice(0, k).some(x => (parseColor(x.color) || { a: 0 }).a >= 1));
      const fgRaw = parseColor(src.color);
      it.bg = hex(bg);
      it.large = isLarge(src.fontSize || 16, src.fontWeight);
      it.need = { aa: it.large ? AA.large : AA.normal, aaa: it.large ? AAA.large : AAA.normal };
      if (!fgRaw) { it.status = 'unsure'; it.ratio = null; it.fg = ''; it.issues.push(issue('color-unknown', 'info', `The text colour "${shorten(String(src.color), 30)}" uses a colour format this checker can't measure.`, 'Check this text manually.')); return it; }
      const op = src.opacity == null ? 1 : clamp(src.opacity, 0, 1);
      const fg = blend({ ...fgRaw, a: fgRaw.a * op }, bg);
      it.fg = hex(fg);
      it.ratio = ratio(fg, bg);
      it.ratioText = fmt(it.ratio);
      it.aa = it.ratio >= it.need.aa;
      it.aaa = it.ratio >= it.need.aaa;
      const size = `${Math.round((src.fontSize || 16) * 10) / 10}px${weightNum(src.fontWeight) >= 700 ? ' bold' : ''}`;
      it.sizeText = `${size}, ${it.large ? 'large' : 'normal'} text`;
      if (fgRaw.a < 1 || op < 1) it.issues.push(issue('translucent', 'info', `The text is partly transparent (${op < 1 ? `opacity ${Math.round(op * 100) / 100}` : `alpha ${Math.round(fgRaw.a * 100) / 100}`}); the ratio uses the blended colour ${it.fg}.`, 'Prefer a solid text colour so contrast does not depend on what is behind it.'));
      if (src.disabled) { it.status = 'exempt'; it.issues.push(issue('disabled', 'info', `Disabled control: WCAG does not require contrast for inactive components (ratio ${it.ratioText}).`, 'No change needed, but make sure it still reads as disabled.')); return it; }
      if (image) {
        it.status = 'unsure';
        it.issues.push(issue('bg-image', 'info', `This text sits on a background image or gradient. Against the background colour (${it.bg}) it measures ${it.ratioText}, but the image may make it better or worse.`, 'Check it by eye or with a colour picker, or add a solid or semi-opaque backing colour behind the text.'));
        return it;
      }
      if (!it.aa) {
        it.status = 'fail';
        const s = suggest(fg, bg, it.need.aa);
        it.suggestion = s;
        it.issues.push(issue('fail-aa', 'error', `Contrast ${it.ratioText} is below the AA minimum of ${it.need.aa}:1 for ${it.large ? 'large' : 'normal'} text.`,
          s ? `Use text colour ${s.color} (${fmt(s.ratio)}) on ${it.bg}, or change the background.` : `Change the background colour; no text colour reaches ${it.need.aa}:1 on ${it.bg}.`));
      } else if (!it.aaa) {
        it.status = 'aaa';
        const s = suggest(fg, bg, it.need.aaa);
        it.suggestion = s;
        it.issues.push(issue('fail-aaa', 'warn', `Contrast ${it.ratioText} passes AA but is below the AAA level of ${it.need.aaa}:1 for ${it.large ? 'large' : 'normal'} text.`,
          s ? `For AAA, use text colour ${s.color} (${fmt(s.ratio)}) on ${it.bg}.` : `For AAA, change the background colour; no text colour reaches ${it.need.aaa}:1 on ${it.bg}.`));
      } else it.status = 'pass';
      return it;
    });

    // Group identical colour/size combinations so the summary counts each distinct problem once.
    const combos = new Set(items.filter(it => it.status === 'fail').map(it => `${it.fg}|${it.bg}|${it.large}`));
    const count = st => items.filter(it => it.status === st).length;
    const summary = {
      total: items.length, fail: count('fail'), aaa: count('aaa'), pass: count('pass'), unsure: count('unsure'), exempt: count('exempt'),
      failCombos: combos.size,
      lowest: items.filter(it => it.ratio != null && it.status !== 'exempt').reduce((m, it) => Math.min(m, it.ratio), Infinity),
      truncated: !!raw.truncated,
    };
    if (summary.lowest === Infinity) summary.lowest = null;
    return { url: raw.url || '', items, summary };
  }

  function issue(code, level, msg, fix) { return { code, level, msg, fix }; }

  // Filters for the popup tabs. Worst contrast first within each list.
  function filter(report, kind) {
    const pick = { fails: ['fail'], aaa: ['aaa'], unsure: ['unsure'], all: null }[kind];
    const list = report.items.filter(it => !pick || pick.includes(it.status));
    return list.slice().sort((a, b) => (a.ratio == null ? 99 : a.ratio) - (b.ratio == null ? 99 : b.ratio) || a.i - b.i);
  }

  function toText(report) {
    const s = report.summary;
    const out = ['Contrast Checker report (WCAG 2.2 SC 1.4.3 AA / 1.4.6 AAA)', `Page: ${report.url}`,
      `Text elements: ${s.total} | fail AA: ${s.fail} (${s.failCombos} colour combination(s)) | pass AA, fail AAA: ${s.aaa} | pass AAA: ${s.pass} | can't measure (background image): ${s.unsure} | disabled, exempt: ${s.exempt}`,
      `Lowest ratio: ${s.lowest == null ? 'n/a' : fmt(s.lowest)}`, ''];
    for (const it of filter(report, 'all')) {
      const st = { fail: 'FAIL AA', aaa: 'PASS AA, FAIL AAA', pass: 'PASS AAA', unsure: 'CHECK MANUALLY', exempt: 'EXEMPT (disabled)' }[it.status];
      out.push(`#${it.i + 1} <${it.tag}> "${shorten(it.text, 60)}"`);
      out.push(`  ${st} | ${it.ratioText || 'ratio n/a'} | text ${it.fg || '?'} on ${it.bg} | ${it.sizeText || ''} | needs ${it.need.aa}:1 (AA), ${it.need.aaa}:1 (AAA)`);
      for (const x of it.issues) out.push(`- [${x.level.toUpperCase()}] ${x.msg}`, `  Fix: ${x.fix}`);
    }
    out.push('', 'Not checked: text inside images, canvas or SVG, placeholder text, ::before/::after content, hover/focus states, and text added after the scan.');
    if (s.truncated) out.push('Only the first 1500 text elements were checked.');
    return out.join('\n');
  }

  return { analyze, filter, toText, parseColor, blend, luminance, ratio, fmt, hex, isLarge, suggest, AA, AAA };
});
