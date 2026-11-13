// Font Finder core: pure functions, no DOM, no chrome.* (unit-tested in Node).
// Takes what content/extract.js returned (one row per visible text element with its computed
// font-family stack, weight, size and style), groups by the primary (first) family name, and
// writes a plain-text report or formula-safe CSV.
'use strict';
(function (root) {
  const FORMATS = {
    report: { label: 'Text report', ext: 'txt', mime: 'text/plain' },
    csv: { label: 'CSV (one row per size/weight)', ext: 'csv', mime: 'text/csv' },
  };
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));

  // Split a CSS font-family value into families; strip surrounding quotes; keep order.
  function splitStack(ff) {
    const out = [];
    let cur = '', q = null;
    for (let i = 0; i < String(ff || '').length; i++) {
      const ch = ff[i];
      if (q) { if (ch === q) q = null; else cur += ch; continue; }
      if (ch === '"' || ch === "'") { q = ch; continue; }
      if (ch === ',') { const t = cur.trim(); if (t) out.push(t); cur = ''; continue; }
      cur += ch;
    }
    const t = cur.trim(); if (t) out.push(t);
    return out;
  }
  function primaryOf(ff) {
    const stack = splitStack(ff);
    return stack[0] || '(unknown)';
  }
  // Normalize weight to a numeric string Chrome would report (bold→700, normal→400).
  function normWeight(w) {
    w = String(w == null ? '' : w).trim().toLowerCase();
    if (w === 'bold' || w === 'bolder') return '700';
    if (w === 'normal' || w === 'lighter' || w === '') return '400';
    const n = parseInt(w, 10);
    return Number.isFinite(n) ? String(n) : '400';
  }
  // Round pixel sizes to 1 decimal so 15.999→16 and near-identical sizes group together.
  function normSize(px) {
    const n = parseFloat(px);
    if (!Number.isFinite(n) || n <= 0) return '0';
    const rounded = Math.round(n * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  }
  function normStyle(s) {
    s = String(s == null ? '' : s).trim().toLowerCase();
    return s === 'italic' || s === 'oblique' ? 'italic' : 'normal';
  }
  function formatStack(ff) {
    return splitStack(ff).join(', ') || '(unknown)';
  }
  function hostOf(url) {
    try { return new URL(url).hostname.toLowerCase().replace(/\.$/, ''); } catch (e) { return ''; }
  }

  function analyze(raw) {
    raw = raw || {};
    const page = String(raw.url || '');
    const protocol = String(raw.protocol || (page.match(/^[a-z-]+:/i) || [''])[0]).toLowerCase();
    const mode = protocol === 'http:' || protocol === 'https:' ? 'web' : 'other';
    const famMap = new Map(); // key = primary lowercased
    let elements = 0;
    for (const it of Array.isArray(raw.items) ? raw.items : []) {
      elements++;
      const stack = formatStack(it.family);
      const primary = primaryOf(it.family);
      const key = primary.toLowerCase();
      let fam = famMap.get(key);
      if (!fam) {
        fam = { primary, stack, count: 0, tags: new Map(), combos: new Map(), samples: [] };
        famMap.set(key, fam);
      }
      fam.count++;
      // Prefer a longer stack when the same primary is seen with fallbacks.
      if (splitStack(it.family).length > splitStack(fam.stack).length) fam.stack = stack;
      const tag = String(it.tag || 'el').toLowerCase();
      fam.tags.set(tag, (fam.tags.get(tag) || 0) + 1);
      const weight = normWeight(it.weight);
      const size = normSize(it.size);
      const style = normStyle(it.style);
      const ck = weight + '|' + size + '|' + style;
      let combo = fam.combos.get(ck);
      if (!combo) {
        combo = { weight, size, style, count: 0, tags: new Map() };
        fam.combos.set(ck, combo);
      }
      combo.count++;
      combo.tags.set(tag, (combo.tags.get(tag) || 0) + 1);
      if (fam.samples.length < 3) {
        const sample = String(it.sample || '').trim();
        if (sample && !fam.samples.includes(sample)) fam.samples.push(sample);
      }
    }
    const topTags = (map, n) => [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, n).map(([t, c]) => t + (c > 1 ? '×' + c : ''));
    const families = [...famMap.values()].map(f => ({
      primary: f.primary,
      stack: f.stack,
      count: f.count,
      tags: topTags(f.tags, 5),
      samples: f.samples.slice(),
      combos: [...f.combos.values()].map(c => ({
        weight: c.weight, size: c.size, style: c.style, count: c.count, tags: topTags(c.tags, 4),
      })).sort((a, b) => b.count - a.count || parseFloat(b.size) - parseFloat(a.size) || a.weight.localeCompare(b.weight)),
    })).sort((a, b) => b.count - a.count || a.primary.localeCompare(b.primary));

    const comboTotal = families.reduce((n, f) => n + f.combos.length, 0);
    return {
      page, title: String(raw.title || ''), host: hostOf(page), mode,
      families, elements, familyCount: families.length, comboTotal,
      scanned: raw.scanned | 0, truncated: !!raw.truncated, total: raw.total | 0,
    };
  }

  function summary(a) {
    if (a.mode === 'other') return 'Font Finder works on web pages. This page is not one, so there is nothing to list.';
    if (!a.elements) return 'No visible text elements with a font were found on this page.';
    return plural(a.familyCount, 'font family', 'font families') + ', ' +
      plural(a.comboTotal, 'size/weight combo', 'size/weight combos') + ' across ' +
      plural(a.elements, 'text element') + ' on this page.';
  }
  function level(a) {
    if (a.mode === 'other') return 'muted';
    if (!a.elements) return 'muted';
    return 'good';
  }
  function notes(a) {
    const out = [];
    if (a.mode === 'web' && a.elements) {
      out.push({ level: 'muted', msg: 'Grouped by the primary (first) family in each computed font-family stack; fallbacks are kept in the stack shown for each family.' });
      out.push({ level: 'muted', msg: 'Checked ' + plural(a.scanned || a.elements, 'element') + ' with visible text.' });
    }
    if (a.truncated) out.push({ level: 'warn', msg: 'Very large page: only the first 8,000 of ' + (a.total || 0).toLocaleString('en-US') + ' text elements are listed.' });
    return out;
  }
  function comboLabel(c) {
    return c.size + 'px / weight ' + c.weight + (c.style === 'italic' ? ' / italic' : '');
  }

  function report(a, now) {
    const d = (now instanceof Date ? now : new Date()).toISOString().slice(0, 10);
    const lines = ['Font list for ' + (a.host || 'this page') + ' (' + d + ')', 'Page: ' + a.page, summary(a), ''];
    for (const f of a.families) {
      lines.push(f.primary + ' (' + plural(f.count, 'element') + ')');
      lines.push('  Stack: ' + f.stack);
      if (f.tags.length) lines.push('  Tags: ' + f.tags.join(', '));
      for (const c of f.combos) {
        lines.push('  - ' + comboLabel(c) + ': ' + plural(c.count, 'element') +
          (c.tags.length ? ' (' + c.tags.join(', ') + ')' : ''));
      }
      lines.push('');
    }
    for (const n of notes(a)) lines.push('Note: ' + n.msg);
    lines.push('Only visible text written in the page is checked. Fonts loaded only for empty or hidden elements are not listed.');
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }
  function cell(v) {
    let s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function csv(a) {
    const rows = [['Family', 'Stack', 'Weight', 'Size (px)', 'Style', 'Elements', 'Tags']];
    for (const f of a.families) for (const c of f.combos) {
      rows.push([f.primary, f.stack, c.weight, c.size, c.style, c.count, c.tags.join('; ')]);
    }
    return rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
  }
  function format(a, fmt, now) { return fmt === 'csv' ? csv(a) : report(a, now); }
  function fileName(page, fmt, now) {
    const d = now instanceof Date ? now : new Date();
    const host = (hostOf(page) || 'page').replace(/[^a-z0-9.-]/gi, '_');
    return 'fonts-' + host + '-' + d.toISOString().slice(0, 10) + '.' + FORMATS[fmt].ext;
  }

  const api = {
    FORMATS, splitStack, primaryOf, normWeight, normSize, normStyle, formatStack, hostOf,
    analyze, summary, level, notes, comboLabel, report, csv, cell, format, fileName,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.FontCore = api;
})(typeof self !== 'undefined' ? self : globalThis);
