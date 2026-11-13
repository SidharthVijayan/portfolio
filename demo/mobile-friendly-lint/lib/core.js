// Mobile-Friendly Lint core: pure functions, no DOM, no chrome.* (unit-tested in Node).
// Takes what content/extract.js returned and produces findings in three checks:
//   viewport  - missing / duplicate / fixed-width / scaled / zoom-blocking <meta name="viewport">
//   overflow  - the page scrolls sideways, and which outermost elements run past the right edge
//   tap       - tap targets (links, buttons, form controls) smaller than 48 x 48 CSS px
// Writes a plain-text report or a formula-safe CSV. Does not audit SEO headings, content,
// AI-readiness, labels/ARIA, colours or fonts (other CodeForge tools do those).
'use strict';
(function (root) {
  const MIN = 48, HARD_MIN = 24;
  const FORMATS = {
    report: { label: 'Text report', ext: 'txt', mime: 'text/plain' },
    csv: { label: 'CSV (one row per finding)', ext: 'csv', mime: 'text/csv' },
  };
  const CHECKS = { viewport: 'Viewport', overflow: 'Horizontal overflow', tap: 'Tap targets' };
  const SEVERITY = { bad: 'Problem', warn: 'Warning' };
  const VIEWPORT_FIX = 'Use <meta name="viewport" content="width=device-width, initial-scale=1"> in <head>.';
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));
  const px = n => Math.round(n * 10) / 10;

  function hostOf(url) {
    try { return new URL(url).hostname.toLowerCase().replace(/\.$/, ''); } catch (e) { return ''; }
  }

  // "width=device-width, initial-scale=1" -> { width: 'device-width', 'initial-scale': '1' }
  function parseViewport(content) {
    const out = {};
    for (const part of String(content == null ? '' : content).split(/[,;]/)) {
      const i = part.indexOf('=');
      const k = (i < 0 ? part : part.slice(0, i)).trim().toLowerCase();
      if (!k) continue;
      out[k] = i < 0 ? '' : part.slice(i + 1).trim().toLowerCase();
    }
    return out;
  }

  function viewportFindings(list) {
    list = Array.isArray(list) ? list : [];
    const f = [];
    const add = (level, detail, fix) => f.push({ check: 'viewport', level, element: 'meta[name=viewport]', label: '', size: '', detail, fix });
    if (!list.length) {
      add('bad', 'No viewport meta tag. Phones lay the page out about 980px wide and shrink it, so text is tiny.', VIEWPORT_FIX);
      return f;
    }
    if (list.length > 1) add('warn', list.length + ' viewport tags found. The last one is checked below.', 'Keep a single viewport tag.');
    const content = list[list.length - 1];
    const v = parseViewport(content);
    if (!String(content).trim() || !Object.keys(v).length) {
      add('bad', 'The viewport tag is empty.', VIEWPORT_FIX);
      return f;
    }
    if (!('width' in v)) add('warn', 'No width=device-width in "' + content + '".', VIEWPORT_FIX);
    else if (/^\d+(\.\d+)?(px)?$/.test(v.width)) add('bad', 'Fixed width=' + parseFloat(v.width) + ' in "' + content + '". Phones will shrink a ' + parseFloat(v.width) + 'px layout to fit.', VIEWPORT_FIX);
    else if (v.width !== 'device-width') add('bad', 'Unrecognised width="' + v.width + '".', VIEWPORT_FIX);
    if ('initial-scale' in v) {
      const s = parseFloat(v['initial-scale']);
      if (!(s === 1)) add('warn', 'initial-scale=' + v['initial-scale'] + ' (not 1), so the page opens zoomed.', 'Set initial-scale=1.');
    }
    if (v['user-scalable'] === 'no' || v['user-scalable'] === '0') add('warn', 'user-scalable=' + v['user-scalable'] + ' stops people pinch-zooming (needed to enlarge text to 200%).', 'Remove user-scalable=no.');
    if ('maximum-scale' in v) {
      const m = parseFloat(v['maximum-scale']);
      if (m < 2) add('warn', 'maximum-scale=' + v['maximum-scale'] + ' caps zoom below 200%.', 'Remove maximum-scale, or set it to 5.');
    }
    return f;
  }

  function overflowFindings(raw) {
    const vw = raw.viewportWidth | 0;
    const sw = raw.scrollWidth | 0;
    const extra = vw ? Math.max(0, sw - vw) : 0;
    const scrolls = extra > 1;
    const items = Array.isArray(raw.overflow) ? raw.overflow : [];
    const f = [];
    if (scrolls) {
      f.push({ check: 'overflow', level: 'bad', element: 'page', label: '', size: sw + 'px wide',
        detail: 'The page scrolls sideways: content is ' + extra + 'px wider than the ' + vw + 'px viewport.',
        fix: 'Find the wide elements below and let them shrink (max-width:100%, flexible widths).' });
    } else if (items.length && raw.rootClips) {
      f.push({ check: 'overflow', level: 'warn', element: 'page', label: '', size: '',
        detail: 'overflow-x on <html> or <body> hides sideways overflow, so content past the right edge is cut off.',
        fix: 'Fix the wide elements below instead of hiding the overflow.' });
    }
    for (const o of items) {
      const past = Math.max(0, (o.right | 0) - vw);
      f.push({ check: 'overflow', level: scrolls ? 'bad' : 'warn', element: String(o.desc || o.tag || 'element'), label: String(o.label || ''),
        size: (o.width | 0) + 'px wide',
        detail: 'Runs ' + past + 'px past the right edge (ends at ' + (o.right | 0) + 'px; viewport ' + vw + 'px).',
        fix: o.tag === 'table' || o.tag === 'pre' ? 'Wrap it in a container with overflow-x:auto.' :
          o.tag === 'img' || o.tag === 'video' || o.tag === 'iframe' ? 'Add max-width:100%; height:auto.' :
          'Avoid fixed widths; use max-width:100% or a flexible width.' });
    }
    return { findings: f, extra, scrolls };
  }

  function tapFindings(raw) {
    const t = Array.isArray(raw.targets) ? raw.targets : [];
    const f = [];
    let ok = 0, inlineSmall = 0;
    for (const x of t) {
      const w = +x.width || 0, h = +x.height || 0;
      const small = w < MIN || h < MIN;
      if (!small) { ok++; continue; }
      if (x.inline) { inlineSmall++; continue; }
      const tiny = w < HARD_MIN || h < HARD_MIN;
      f.push({ check: 'tap', level: tiny ? 'bad' : 'warn', element: String(x.desc || x.tag || 'element'), label: String(x.label || ''),
        size: px(w) + '×' + px(h) + 'px', w, h,
        detail: (tiny ? 'Under 24px (below the WCAG 2.2 AA minimum unless it has enough spacing). ' : 'Smaller than 48×48px. ') + px(w) + '×' + px(h) + 'px.',
        fix: 'Make the tappable area at least 48×48px (padding, min-width/min-height).' });
    }
    f.sort((a, b) => (a.level === b.level ? 0 : a.level === 'bad' ? -1 : 1) || Math.min(a.w, a.h) - Math.min(b.w, b.h));
    return { findings: f, total: t.length, ok, inlineSmall };
  }

  function analyze(raw) {
    raw = raw || {};
    const page = String(raw.url || '');
    const protocol = String(raw.protocol || (page.match(/^[a-z-]+:/i) || [''])[0]).toLowerCase();
    const mode = protocol === 'http:' || protocol === 'https:' ? 'web' : 'other';
    const vp = mode === 'web' ? viewportFindings(raw.viewports) : [];
    const ov = mode === 'web' ? overflowFindings(raw) : { findings: [], extra: 0, scrolls: false };
    const tp = mode === 'web' ? tapFindings(raw) : { findings: [], total: 0, ok: 0, inlineSmall: 0 };
    const findings = [...vp, ...ov.findings, ...tp.findings];
    return {
      page, title: String(raw.title || ''), host: hostOf(page), mode,
      viewports: Array.isArray(raw.viewports) ? raw.viewports.slice() : [],
      viewportWidth: raw.viewportWidth | 0, scrollWidth: raw.scrollWidth | 0, overflowPx: ov.extra, scrolls: ov.scrolls,
      findings,
      counts: {
        viewport: vp.length,
        overflow: ov.findings.filter(x => x.element !== 'page').length,
        tap: tp.findings.length,
        bad: findings.filter(x => x.level === 'bad').length,
        warn: findings.filter(x => x.level === 'warn').length,
      },
      targets: tp.total, targetsOk: tp.ok, inlineSmall: tp.inlineSmall,
      scanned: raw.scanned | 0, total: raw.total | 0, truncated: !!raw.truncated,
    };
  }

  function summary(a) {
    if (a.mode === 'other') return 'Mobile-Friendly Lint works on web pages. This page is not one, so there is nothing to check.';
    const n = a.findings.length;
    if (!n) return 'No mobile-friendly problems found: viewport set, no sideways scrolling at ' + a.viewportWidth + 'px, and ' +
      (a.targets ? 'all ' + plural(a.targets, 'tap target') + ' are 48px or larger' : 'no tap targets to check') + '.';
    const parts = [];
    for (const k of ['viewport', 'overflow', 'tap']) {
      const c = a.findings.filter(x => x.check === k).length;
      if (c) parts.push(plural(c, k === 'tap' ? 'tap-target finding' : k + ' finding'));
    }
    return plural(n, 'finding') + ' (' + a.counts.bad + ' ' + (a.counts.bad === 1 ? 'problem' : 'problems') + ', ' + plural(a.counts.warn, 'warning') + '): ' +
      parts.join(', ') + '. Checked at ' + a.viewportWidth + 'px wide.';
  }
  function level(a) {
    if (a.mode === 'other') return 'muted';
    if (a.counts.bad) return 'bad';
    if (a.counts.warn) return 'warn';
    return 'good';
  }
  function notes(a) {
    const out = [];
    if (a.mode !== 'web') return out;
    const fixedVp = a.viewports.length && /^\d/.test(parseViewport(a.viewports[a.viewports.length - 1]).width || '');
    if (a.viewportWidth > 600) out.push({ level: 'warn', msg: 'Overflow was measured at ' + a.viewportWidth + 'px wide, wider than a phone' +
      (fixedVp ? ' (the fixed-width viewport tag also makes phones lay the page out this wide)' : '') +
      '. To test a phone width, open Chrome DevTools device toolbar (Ctrl+Shift+M), pick a phone, then click the extension again.' });
    else out.push({ level: 'muted', msg: 'Overflow was measured at the tab\'s current width: ' + a.viewportWidth + 'px.' });
    if (a.viewports.length) out.push({ level: 'muted', msg: 'Viewport tag: "' + a.viewports[a.viewports.length - 1] + '".' });
    out.push({ level: 'muted', msg: 'Checked ' + plural(a.scanned, 'visible element') + ' and ' + plural(a.targets, 'tap target') + ' (' + a.targetsOk + ' at 48px or larger).' });
    if (a.inlineSmall) out.push({ level: 'muted', msg: plural(a.inlineSmall, 'link') + ' inside sentences ' + (a.inlineSmall === 1 ? 'is' : 'are') + ' smaller than 48px but not flagged (inline text links are exempt from target-size rules).' });
    if (a.truncated) out.push({ level: 'warn', msg: 'Very large page: only the first 8,000 visible elements were checked (of ' + (a.total || 0).toLocaleString('en-US') + ').' });
    return out;
  }

  function report(a, now) {
    const d = (now instanceof Date ? now : new Date()).toISOString().slice(0, 10);
    const lines = ['Mobile-friendly lint for ' + (a.host || 'this page') + ' (' + d + ')', 'Page: ' + a.page, summary(a), ''];
    for (const k of Object.keys(CHECKS)) {
      const list = a.findings.filter(x => x.check === k);
      lines.push(CHECKS[k] + ': ' + (list.length ? plural(list.length, 'finding') : 'OK'));
      for (const x of list) {
        lines.push('- [' + SEVERITY[x.level] + '] ' + x.element + (x.label ? ' "' + x.label + '"' : '') + (x.size ? ' (' + x.size + ')' : ''));
        lines.push('  ' + x.detail);
        lines.push('  Fix: ' + x.fix);
      }
      lines.push('');
    }
    for (const n of notes(a)) lines.push('Note: ' + n.msg);
    lines.push('Checks the page as rendered when you click. It does not look inside iframes or shadow DOM, does not check text size, spacing between targets or page speed, and does not change the page.');
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }
  function cell(v) {
    let s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function csv(a) {
    const rows = [['Check', 'Severity', 'Element', 'Label', 'Size', 'Detail', 'Fix']];
    for (const x of a.findings) rows.push([CHECKS[x.check], SEVERITY[x.level], x.element, x.label, x.size, x.detail, x.fix]);
    return rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
  }
  function format(a, fmt, now) { return fmt === 'csv' ? csv(a) : report(a, now); }
  function fileName(page, fmt, now) {
    const d = now instanceof Date ? now : new Date();
    const host = (hostOf(page) || 'page').replace(/[^a-z0-9.-]/gi, '_');
    return 'mobile-lint-' + host + '-' + d.toISOString().slice(0, 10) + '.' + FORMATS[fmt].ext;
  }

  const api = {
    MIN, HARD_MIN, FORMATS, CHECKS, SEVERITY, hostOf, parseViewport, viewportFindings, overflowFindings, tapFindings,
    analyze, summary, level, notes, report, csv, cell, format, fileName,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.MobileLintCore = api;
})(typeof self !== 'undefined' ? self : globalThis);
