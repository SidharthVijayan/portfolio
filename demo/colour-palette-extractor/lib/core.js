// Colour Palette Extractor core: pure functions, no DOM, no chrome.* (unit-tested in Node).
// Takes what content/extract.js returned (one observation per visible colour use: text,
// resolved background, or border), groups by normalised #RRGGBB, and writes a plain-text
// report or formula-safe CSV. Distinct from Contrast Checker (#7): no WCAG ratios; distinct
// from Font Finder (#16): no fonts.
'use strict';
(function (root) {
  const FORMATS = {
    report: { label: 'Text report', ext: 'txt', mime: 'text/plain' },
    csv: { label: 'CSV (one row per colour)', ext: 'csv', mime: 'text/csv' },
  };
  const WHITE = { r: 255, g: 255, b: 255, a: 1 };
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // Parses computed CSS colours: rgb()/rgba() (comma or space), #rgb/#rgba/#rrggbb/#rrggbbaa,
  // hsl()/hsla(), named transparent. Returns {r,g,b,a} in 0–255 / 0–1, or null.
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
    if (m) {
      const ch = v => v.endsWith('%') ? parseFloat(v) * 2.55 : parseFloat(v);
      const al = v => v == null ? 1 : v.endsWith('%') ? parseFloat(v) / 100 : parseFloat(v);
      return { r: clamp(ch(m[1]), 0, 255), g: clamp(ch(m[2]), 0, 255), b: clamp(ch(m[3]), 0, 255), a: clamp(al(m[4]), 0, 1) };
    }
    m = s.match(/^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/);
    if (m) {
      const h = ((parseFloat(m[1]) % 360) + 360) % 360;
      const sat = clamp(parseFloat(m[2]), 0, 100) / 100;
      const lit = clamp(parseFloat(m[3]), 0, 100) / 100;
      const al = m[4] == null ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
      const c = (1 - Math.abs(2 * lit - 1)) * sat;
      const x = c * (1 - Math.abs((h / 60) % 2 - 1));
      const o = lit - c / 2;
      let r = 0, g = 0, b = 0;
      if (h < 60) { r = c; g = x; }
      else if (h < 120) { r = x; g = c; }
      else if (h < 180) { g = c; b = x; }
      else if (h < 240) { g = x; b = c; }
      else if (h < 300) { r = x; b = c; }
      else { r = c; b = x; }
      return { r: clamp((r + o) * 255, 0, 255), g: clamp((g + o) * 255, 0, 255), b: clamp((b + o) * 255, 0, 255), a: clamp(al, 0, 1) };
    }
    return null;
  }

  // Alpha-composites colour `top` over colour `bottom` (source-over).
  function blend(top, bottom) {
    const a = top.a + bottom.a * (1 - top.a);
    if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
    const c = k => (top[k] * top.a + bottom[k] * bottom.a * (1 - top.a)) / a;
    return { r: c('r'), g: c('g'), b: c('b'), a };
  }

  // Composite over white (or note fully transparent) so every swatch is an opaque #RRGGBB.
  function flatten(c) {
    if (!c) return null;
    if (c.a >= 0.999) return { r: c.r, g: c.g, b: c.b, a: 1, transparent: false };
    if (c.a <= 0.001) return { r: 255, g: 255, b: 255, a: 0, transparent: true };
    const f = blend(c, WHITE);
    return { r: f.r, g: f.g, b: f.b, a: 1, transparent: false, wasSemi: true, originalAlpha: c.a };
  }

  function toHex(c) {
    if (!c) return '';
    return '#' + [c.r, c.g, c.b].map(v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
  }
  function toRgb(c) {
    if (!c) return '';
    return 'rgb(' + [c.r, c.g, c.b].map(v => Math.round(clamp(v, 0, 255))).join(', ') + ')';
  }
  function hostOf(url) {
    try { return new URL(url).hostname.toLowerCase().replace(/\.$/, ''); } catch (e) { return ''; }
  }

  function analyze(raw) {
    raw = raw || {};
    const page = String(raw.url || '');
    const protocol = String(raw.protocol || (page.match(/^[a-z-]+:/i) || [''])[0]).toLowerCase();
    const mode = protocol === 'http:' || protocol === 'https:' ? 'web' : 'other';
    const map = new Map(); // hex -> swatch
    let observations = 0;
    for (const it of Array.isArray(raw.items) ? raw.items : []) {
      const parsed = parseColor(it.color);
      if (!parsed) continue;
      const flat = flatten(parsed);
      if (!flat || flat.transparent) continue; // skip fully transparent
      const hex = toHex(flat);
      observations++;
      let s = map.get(hex);
      if (!s) {
        s = {
          hex, rgb: toRgb(flat),
          count: 0,
          roles: { text: 0, background: 0, border: 0 },
          tags: new Map(),
          wasSemi: !!flat.wasSemi,
        };
        map.set(hex, s);
      }
      s.count++;
      const role = String(it.role || 'text').toLowerCase();
      if (role === 'background' || role === 'border' || role === 'text') s.roles[role]++;
      else s.roles.text++;
      const tag = String(it.tag || 'el').toLowerCase();
      s.tags.set(tag, (s.tags.get(tag) || 0) + 1);
      if (flat.wasSemi) s.wasSemi = true;
    }
    const topTags = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, n).map(([t, c]) => t + (c > 1 ? '×' + c : ''));
    const swatches = [...map.values()].map(s => ({
      hex: s.hex,
      rgb: s.rgb,
      count: s.count,
      text: s.roles.text,
      background: s.roles.background,
      border: s.roles.border,
      tags: topTags(s.tags, 5),
      wasSemi: s.wasSemi,
    })).sort((a, b) => b.count - a.count || a.hex.localeCompare(b.hex));

    return {
      page, title: String(raw.title || ''), host: hostOf(page), mode,
      swatches, observations, colourCount: swatches.length,
      scanned: raw.scanned | 0, truncated: !!raw.truncated, total: raw.total | 0,
    };
  }

  function summary(a) {
    if (a.mode === 'other') return 'Colour Palette Extractor works on web pages. This page is not one, so there is nothing to list.';
    if (!a.observations) return 'No visible colours were found on this page.';
    return plural(a.colourCount, 'colour', 'colours') + ' across ' +
      plural(a.observations, 'colour use', 'colour uses') + ' on this page.';
  }
  function level(a) {
    if (a.mode === 'other') return 'muted';
    if (!a.observations) return 'muted';
    return 'good';
  }
  function notes(a) {
    const out = [];
    if (a.mode === 'web' && a.observations) {
      out.push({ level: 'muted', msg: 'Colours are normalised to opaque #RRGGBB (semi-transparent colours are composited over white). Grouped by hex; roles show text vs background vs border uses.' });
      out.push({ level: 'muted', msg: 'Checked ' + plural(a.scanned || a.observations, 'visible element') + '.' });
    }
    if (a.swatches.some(s => s.wasSemi)) {
      out.push({ level: 'muted', msg: 'At least one colour had alpha < 1 and was composited over white for the swatch.' });
    }
    if (a.truncated) out.push({ level: 'warn', msg: 'Very large page: only the first 8,000 of ' + (a.total || 0).toLocaleString('en-US') + ' visible elements are listed.' });
    return out;
  }
  function roleLabel(s) {
    const parts = [];
    if (s.text) parts.push(plural(s.text, 'text'));
    if (s.background) parts.push(plural(s.background, 'background'));
    if (s.border) parts.push(plural(s.border, 'border'));
    return parts.join(', ') || plural(s.count, 'use');
  }

  function report(a, now) {
    const d = (now instanceof Date ? now : new Date()).toISOString().slice(0, 10);
    const lines = ['Colour palette for ' + (a.host || 'this page') + ' (' + d + ')', 'Page: ' + a.page, summary(a), ''];
    for (const s of a.swatches) {
      lines.push(s.hex + '  ' + s.rgb + '  (' + plural(s.count, 'use') + ')');
      lines.push('  Roles: ' + roleLabel(s));
      if (s.tags.length) lines.push('  Tags: ' + s.tags.join(', '));
      lines.push('');
    }
    for (const n of notes(a)) lines.push('Note: ' + n.msg);
    lines.push('Only visible elements are checked. Gradients, images and colours inside iframes or shadow DOM are not listed. This extracts a palette; it does not compute contrast ratios or fonts.');
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }
  function cell(v) {
    let s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function csv(a) {
    const rows = [['Hex', 'RGB', 'Uses', 'Text', 'Background', 'Border', 'Tags']];
    for (const s of a.swatches) {
      rows.push([s.hex, s.rgb, s.count, s.text, s.background, s.border, s.tags.join('; ')]);
    }
    return rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
  }
  function format(a, fmt, now) { return fmt === 'csv' ? csv(a) : report(a, now); }
  function fileName(page, fmt, now) {
    const d = now instanceof Date ? now : new Date();
    const host = (hostOf(page) || 'page').replace(/[^a-z0-9.-]/gi, '_');
    return 'colours-' + host + '-' + d.toISOString().slice(0, 10) + '.' + FORMATS[fmt].ext;
  }

  const api = {
    FORMATS, WHITE, parseColor, blend, flatten, toHex, toRgb, hostOf,
    analyze, summary, level, notes, roleLabel, report, csv, cell, format, fileName,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ColourCore = api;
})(typeof self !== 'undefined' ? self : globalThis);
