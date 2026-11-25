// Reading Ruler: pure logic, no chrome.* and no DOM. Loads in the popup (<script>), in the page (injected by the
// popup before content/ruler.js) and in Node tests (require).
//   - settings: tint colour, how much to dim the rest of the page, ruler height in text lines, follow the mouse,
//     arrow keys move the ruler
//   - lineHeight(): the page's usual line height from samples of its text blocks, so "2 lines" fits the text
//   - geometry: where the ruler sits for a mouse position (snapped so whole text lines sit inside it), and where
//     an arrow key moves it (with the page scrolling when the ruler reaches the top or bottom edge)
//   - keyAction(): which key presses the ruler takes (never while typing in a field, never with modifier keys)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RulerCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TINTS = {
    yellow: { label: 'Yellow', rgb: [255, 224, 102] },
    blue: { label: 'Blue', rgb: [124, 196, 255] },
    green: { label: 'Green', rgb: [140, 233, 154] },
    pink: { label: 'Pink', rgb: [255, 168, 213] },
    peach: { label: 'Peach', rgb: [255, 201, 160] },
    none: { label: 'No tint', rgb: null },
  };
  const DIMS = {
    off: { label: 'Off', alpha: 0 },
    light: { label: 'Light', alpha: 0.25 },
    medium: { label: 'Medium', alpha: 0.45 },
    strong: { label: 'Strong', alpha: 0.65 },
  };
  const LINES = [1, 2, 3, 4];
  const DEFAULTS = Object.freeze({ tint: 'yellow', dim: 'medium', lines: 2, mouse: true, keys: true });
  const TINT_ALPHA = 0.32;
  const PAD = 6; // px above and below the text lines inside the ruler
  const DEFAULT_LINE = 24, MIN_LINE = 14, MAX_LINE = 72;

  function normalize(s) {
    s = s || {};
    const lines = Number(s.lines);
    return {
      tint: Object.prototype.hasOwnProperty.call(TINTS, s.tint) ? s.tint : DEFAULTS.tint,
      dim: Object.prototype.hasOwnProperty.call(DIMS, s.dim) ? s.dim : DEFAULTS.dim,
      lines: LINES.includes(lines) ? lines : DEFAULTS.lines,
      mouse: s.mouse === undefined ? DEFAULTS.mouse : !!s.mouse,
      keys: s.keys === undefined ? DEFAULTS.keys : !!s.keys,
    };
  }

  // One computed line height in px: "28px" -> 28; "normal" -> about 1.2 x font size; a bare number -> x font size.
  function px(lineHeight, fontSize) {
    const fs = parseFloat(fontSize) || 16;
    const v = String(lineHeight || 'normal').trim();
    if (v === 'normal' || v === '') return fs * 1.2;
    if (/px$/.test(v)) return parseFloat(v);
    if (/%$/.test(v)) return fs * parseFloat(v) / 100;
    if (/^[\d.]+$/.test(v)) return fs * parseFloat(v);
    return fs * 1.2;
  }

  // samples: [{ lineHeight, fontSize, chars }] from the page's paragraphs, list items, quotes and cells.
  // The line height carrying the most text wins (rounded to whole px); clamped to 14-72 px; 24 px if no text.
  function lineHeight(samples) {
    const weight = new Map();
    for (const s of samples || []) {
      const chars = Math.max(0, Number(s.chars) || 0);
      if (!chars) continue;
      const h = Math.round(px(s.lineHeight, s.fontSize));
      if (!(h > 0)) continue;
      weight.set(h, (weight.get(h) || 0) + chars);
    }
    let best = 0, bestW = -1;
    for (const [h, w] of weight) if (w > bestW || (w === bestW && h > best)) { best = h; bestW = w; }
    if (!best) return DEFAULT_LINE;
    return Math.min(MAX_LINE, Math.max(MIN_LINE, best));
  }

  // Ruler height for `lines` text lines, never more than half the window.
  function barHeight(lineH, lines, vh) {
    const h = Math.round(lineH * lines + PAD * 2);
    return Math.max(8, Math.min(h, Math.floor((vh || 800) / 2)));
  }
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  // Ruler centred on the mouse, kept inside the window.
  function place(y, h, vh) { return clamp(Math.round(y - h / 2), 0, Math.max(0, vh - h)); }
  // Where the ruler starts before the mouse moves or a key is pressed: about a third of the way down.
  function start(h, vh) { return place(Math.round(vh / 3), h, vh); }

  // Snapping to text: `centre` is the middle of the text line under the mouse (or at the ruler's reading line).
  // The ruler then holds whole lines: with 1 line just that line, with 2 that line and the next, with 3 the
  // lines before and after it, with 4 one before and two after. The reading line is line `k` inside the ruler.
  const readIndex = lines => Math.floor((lines - 1) / 2);
  function snapTop(centre, lineH, lines) { return Math.round(centre - lineH / 2 - readIndex(lines) * lineH - PAD); }
  // The point to probe for the reading line when the ruler's top is at `top`.
  function readY(top, lineH, lines) { return Math.round(top + PAD + readIndex(lines) * lineH + lineH / 2); }
  // A text line only counts for snapping when its line height is close to the page's (not a heading or a caption).
  function sameLine(lh, lineH) { return lh > 0 && Math.abs(lh - lineH) <= 3; }

  // Arrow key: move by the ruler's own text lines. At the bottom (or top) edge the ruler stays and the page
  // scrolls by the rest, so you can read a long page with the ↓ key alone.
  function step(top, h, dir, vh, lineH, lines) {
    const by = Math.round(lineH * lines) * (dir < 0 ? -1 : 1);
    let next = top + by, scroll = 0;
    const max = Math.max(0, vh - h);
    if (next > max) { scroll = next - max; next = max; }
    if (next < 0) { scroll = next; next = 0; }
    return { top: next, scroll };
  }

  // ev: { key, altKey, ctrlKey, metaKey, shiftKey, typing } -> 'down' | 'up' | 'off' | null
  function keyAction(ev, s) {
    if (!ev || ev.typing) return null;
    if (ev.altKey || ev.ctrlKey || ev.metaKey) return null;
    if (ev.key === 'Escape' && !ev.shiftKey) return 'off';
    if (!s || !s.keys || ev.shiftKey) return null;
    if (ev.key === 'ArrowDown') return 'down';
    if (ev.key === 'ArrowUp') return 'up';
    return null;
  }
  // Is the key going into something the user is typing in? (Then the ruler leaves it alone.)
  function isTyping(t) {
    if (!t) return false;
    const tag = String(t.tag || '').toLowerCase();
    if (tag === 'textarea' || tag === 'select') return true;
    if (tag === 'input') return !/^(button|submit|reset|checkbox|radio|range|color|file|image|hidden)$/i.test(t.type || 'text');
    return !!t.editable || /^(listbox|menu|menubar|combobox|slider|spinbutton|textbox|grid|tree|tablist)$/.test(t.role || '');
  }

  const rgba = (rgb, a) => `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a})`;
  // Colours the page script paints with.
  function look(s) {
    s = normalize(s);
    const t = TINTS[s.tint].rgb;
    return {
      band: t ? rgba(t, TINT_ALPHA) : 'transparent',
      edge: t ? rgba(t.map(c => Math.round(c * 0.75)), 0.95) : 'rgba(55, 65, 81, 0.9)',
      dim: DIMS[s.dim].alpha ? `rgba(15, 23, 42, ${DIMS[s.dim].alpha})` : 'transparent',
    };
  }

  function describe(s) {
    s = normalize(s);
    const t = s.tint === 'none' ? 'clear' : TINTS[s.tint].label.toLowerCase();
    const d = s.dim === 'off' ? 'page not dimmed' : `${DIMS[s.dim].label.toLowerCase()} dimming`;
    return `${s.lines} ${s.lines === 1 ? 'line' : 'lines'} tall, ${t}, ${d}`;
  }
  function moves(s) {
    s = normalize(s);
    if (s.mouse && s.keys) return 'Move the mouse or press ↑ ↓ to move it.';
    if (s.mouse) return 'Move the mouse to move it.';
    if (s.keys) return 'Press ↑ ↓ to move it.';
    return 'It stays where it is (mouse and keys are both off).';
  }
  // page: { lineH, on: settings|null }
  function summary(page) {
    const lh = `Text lines on this page are about ${page.lineH} px.`;
    if (page.on) return `Ruler is on: ${describe(page.on)}. ${moves(page.on)} Esc turns it off.`;
    return `${lh} Pick a look, then turn the ruler on.`;
  }

  return { TINTS, DIMS, LINES, DEFAULTS, PAD, normalize, px, lineHeight, barHeight, place, start, readIndex, snapTop, readY, sameLine, step, keyAction, isTyping, look, describe, moves, summary };
});
