// Image Weight & CLS Auditor core: pure functions, no DOM, no chrome.* (unit-tested in Node).
// Takes what content/extract.js returned and produces findings in three checks:
//   dims  - images with no width/height (or CSS height / aspect-ratio), so the page jumps as they
//           load (Cumulative Layout Shift), and width/height attributes that don't match the file
//   size  - files much larger than the size they are shown at, and heavy files (over 200 KB)
//   lazy  - images below the first screen that load straight away, and images in the first
//           screen held back by loading="lazy"
// Writes a plain-text report or a formula-safe CSV. Does not check alt text (Image Alt Text
// Auditor does that), SEO headings, AI-readiness or anything other than <img> elements.
'use strict';
(function (root) {
  const OVERSIZE = 1.5, OVERSIZE_BAD = 4, MIN_WASTE = 40000;
  const HEAVY = 200 * 1024, HEAVY_BAD = 1024 * 1024;
  const RATIO_TOLERANCE = 0.05, SMALL_AREA = 10000; // under ~100×100 px shown: too small to matter for lazy loading
  const FORMATS = {
    report: { label: 'Text report', ext: 'txt', mime: 'text/plain' },
    csv: { label: 'CSV (one row per finding)', ext: 'csv', mime: 'text/csv' },
  };
  const CHECKS = { dims: 'Layout shift (width/height)', size: 'Oversized and heavy files', lazy: 'Lazy loading' };
  const SEVERITY = { bad: 'Problem', warn: 'Warning' };
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));
  const r1 = n => Math.round(n * 10) / 10;
  const num = n => Math.round(n).toLocaleString('en-US');
  const kb = b => b < 1024 ? '<1 KB' : b >= 1024 * 1024 ? (Math.round(b / 1024 / 1024 * 10) / 10) + ' MB' : Math.round(b / 1024) + ' KB';
  const posInt = v => { const n = parseFloat(String(v == null ? '' : v).trim()); return /^\s*\d+(\.\d+)?\s*(px)?\s*$/i.test(String(v == null ? '' : v)) && n > 0 ? n : 0; };

  function hostOf(url) {
    try { return new URL(url).hostname.toLowerCase().replace(/\.$/, ''); } catch (e) { return ''; }
  }
  const sizeText = x => (x.jsLazy ? 'not loaded yet (lazy-loader)' : x.nw ? 'file ' + x.nw + '×' + x.nh : 'not loaded') + ', shown ' + r1(x.rw) + '×' + r1(x.rh) + (x.bytes ? ', ' + kb(x.bytes) : '');
  const base = (x, check, level, detail, fix) => ({ check, level, element: String(x.desc || 'img'), label: String(x.file || ''), size: sizeText(x), detail, fix });

  // Layout shift: does the browser know the image's shape before the file arrives?
  function dimsFinding(x) {
    if (x.position === 'absolute' || x.position === 'fixed') return null; // out of flow: cannot push content
    const aw = posInt(x.widthAttr), ah = posInt(x.heightAttr);
    if (aw && ah) {
      if (!(x.nw > 0 && x.nh > 0) || x.svg || x.objectFit === 'cover' || x.objectFit === 'contain' || x.cssHeight) return null;
      const want = x.nw / x.nh, have = aw / ah;
      if (Math.abs(have - want) / want <= RATIO_TOLERANCE) return null;
      const fixH = Math.max(1, Math.round(aw * x.nh / x.nw));
      return base(x, 'dims', 'warn', 'width="' + aw + '" height="' + ah + '" do not match the file\'s shape (' + x.nw + '×' + x.nh + '), so the space kept for it is wrong and it can jump or look stretched.',
        'Use width="' + aw + '" height="' + fixH + '" (same shape as the file).');
    }
    if (x.cssRatio || x.cssHeight) return null; // CSS reserves the space
    const shape = x.nw > 0 && x.nh > 0 && !x.jsLazy ? 'width="' + x.nw + '" height="' + x.nh + '"' : 'width and height attributes with the image\'s shape';
    const which = aw || ah ? 'Only ' + (aw ? 'width' : 'height') + ' is set, so the browser can\'t work out the height before the file loads' :
      'No width/height attributes and no CSS height or aspect-ratio, so the browser keeps no space for it';
    return base(x, 'dims', 'bad', which + ' and the content below jumps when it arrives (layout shift, CLS).',
      'Add ' + shape + ' to the <img> and keep height:auto in CSS (or set aspect-ratio in CSS).');
  }

  // Oversized: natural size vs the size it is shown at (times device pixel ratio); heavy: file size.
  function sizeFinding(x, dpr) {
    const details = [], fixes = [];
    let level = '';
    const raise = l => { if (l === 'bad' || !level) level = l; };
    if (x.nw > 1 && x.nh > 1 && x.rw > 0 && x.rh > 0 && !x.svg && !x.jsLazy) {
      const needW = x.rw * dpr, needH = x.rh * dpr;
      const factor = Math.min(x.nw / needW, x.nh / needH);
      const waste = x.nw * x.nh - (x.nw * x.nh) / (factor * factor);
      if (factor >= OVERSIZE && waste >= MIN_WASTE) {
        raise(factor >= OVERSIZE_BAD ? 'bad' : 'warn');
        details.push('File is ' + x.nw + '×' + x.nh + ' but shown at ' + r1(x.rw) + '×' + r1(x.rh) + (dpr !== 1 ? ' (×' + r1(dpr) + ' pixel ratio = ' + Math.ceil(needW) + '×' + Math.ceil(needH) + ' needed)' : '') +
          ': ' + r1(factor) + '× bigger than needed, about ' + Math.round((1 - 1 / (factor * factor)) * 100) + '% of its pixels are thrown away.');
        fixes.push(x.srcset ? 'Check srcset/sizes so the browser can pick a candidate about ' + Math.ceil(needW) + 'px wide.' :
          'Serve a version about ' + Math.ceil(needW) + 'px wide (add srcset/sizes for other screens).');
      }
    }
    if (x.bytes >= HEAVY) {
      raise(x.bytes >= HEAVY_BAD ? 'bad' : 'warn');
      details.push('Heavy file: ' + kb(x.bytes) + (x.bytes >= HEAVY_BAD ? ' (over 1 MB).' : ' (over 200 KB).'));
      fixes.push('Compress it (WebP or AVIF, quality about 75–80).');
    }
    if (!level) return null;
    return Object.assign(base(x, 'size', level, details.join(' '), fixes.join(' ')), { factor: x.nw && x.rw ? Math.min(x.nw / (x.rw * dpr), x.nh / (x.rh * dpr)) : 0 });
  }

  // Lazy loading: compare position with the first screen (viewport height at the top of the page).
  function lazyFinding(x, vh) {
    if (x.position === 'fixed' || !vh) return null;
    if (x.rw * x.rh < SMALL_AREA && x.loading !== 'lazy') return null; // icons and logos: not worth lazy-loading
    const below = x.top >= vh;
    if (below && x.loading !== 'lazy' && !x.jsLazy) {
      return base(x, 'lazy', 'warn', 'Below the first screen (starts at ' + num(x.top) + 'px; the screen is ' + num(vh) + 'px tall) but loads straight away, competing with what people see first.',
        'Add loading="lazy" to the <img>.');
    }
    if (!below && x.loading === 'lazy') {
      return base(x, 'lazy', 'warn', 'In the first screen (starts at ' + num(x.top) + 'px) but loading="lazy" holds it back, which can delay the largest paint (LCP).',
        'Remove loading="lazy" here; add fetchpriority="high" to the main image.');
    }
    return null;
  }

  function analyze(raw) {
    raw = raw || {};
    const page = String(raw.url || '');
    const protocol = String(raw.protocol || (page.match(/^[a-z-]+:/i) || [''])[0]).toLowerCase();
    const mode = protocol === 'http:' || protocol === 'https:' ? 'web' : 'other';
    const imgs = mode === 'web' && Array.isArray(raw.images) ? raw.images : [];
    const dpr = +raw.dpr > 0 ? +raw.dpr : 1;
    const vh = raw.viewportHeight | 0;
    const dims = [], size = [], lazy = [];
    let outOfFlow = 0, notLoaded = 0, withBytes = 0, jsLazy = 0;
    for (const x of imgs) {
      if (x.position === 'absolute' || x.position === 'fixed') outOfFlow++;
      if (!(x.nw > 1) || x.jsLazy) notLoaded++;
      if (x.bytes > 0) withBytes++;
      if (x.jsLazy) jsLazy++;
      const d = dimsFinding(x); if (d) dims.push(d);
      const s = sizeFinding(x, dpr); if (s) size.push(s);
      const l = lazyFinding(x, vh); if (l) lazy.push(l);
    }
    const sev = (a, b) => (a.level === b.level ? 0 : a.level === 'bad' ? -1 : 1);
    dims.sort(sev); size.sort((a, b) => sev(a, b) || b.factor - a.factor); lazy.sort(sev);
    size.forEach(f => { delete f.factor; });
    const findings = [...dims, ...size, ...lazy];
    return {
      page, title: String(raw.title || ''), host: hostOf(page), mode, findings,
      viewportWidth: raw.viewportWidth | 0, viewportHeight: vh, dpr,
      counts: { dims: dims.length, size: size.length, lazy: lazy.length,
        bad: findings.filter(x => x.level === 'bad').length, warn: findings.filter(x => x.level === 'warn').length },
      images: imgs.length, total: raw.total | 0, hidden: raw.hidden | 0, pixels: raw.pixels | 0,
      outOfFlow, notLoaded, withBytes, jsLazy, sheetsBlocked: raw.sheetsBlocked | 0, truncated: !!raw.truncated,
    };
  }

  function summary(a) {
    if (a.mode === 'other') return 'Image Weight & CLS Auditor works on web pages. This page is not one, so there is nothing to check.';
    if (!a.images) return 'No visible images to check on this page.';
    const n = a.findings.length;
    if (!n) return 'No image problems found: all ' + plural(a.images, 'image') + ' keep their space, none is much bigger than shown, and lazy loading is set right.';
    const parts = [];
    if (a.counts.dims) parts.push(plural(a.counts.dims, 'layout-shift finding'));
    if (a.counts.size) parts.push(plural(a.counts.size, 'size finding'));
    if (a.counts.lazy) parts.push(plural(a.counts.lazy, 'lazy-loading finding'));
    return plural(n, 'finding') + ' (' + a.counts.bad + ' ' + (a.counts.bad === 1 ? 'problem' : 'problems') + ', ' + plural(a.counts.warn, 'warning') + '): ' +
      parts.join(', ') + '. Checked ' + plural(a.images, 'image') + '.';
  }
  function level(a) {
    if (a.mode === 'other' || !a.images) return 'muted';
    if (a.counts.bad) return 'bad';
    if (a.counts.warn) return 'warn';
    return 'good';
  }
  function notes(a) {
    const out = [];
    if (a.mode !== 'web') return out;
    out.push({ level: 'muted', msg: 'Checked ' + plural(a.images, 'visible image') + ' at ' + a.viewportWidth + '×' + a.viewportHeight + 'px, device pixel ratio ' + r1(a.dpr) + '.' });
    const skipped = [];
    if (a.hidden) skipped.push(plural(a.hidden, 'hidden image'));
    if (a.pixels) skipped.push(plural(a.pixels, 'tracking pixel') + ' (1×1)');
    if (skipped.length) out.push({ level: 'muted', msg: skipped.join(' and ') + ' skipped.' });
    if (a.outOfFlow) out.push({ level: 'muted', msg: plural(a.outOfFlow, 'image') + ' positioned absolute or fixed ' + (a.outOfFlow === 1 ? 'does' : 'do') + ' not push content, so ' + (a.outOfFlow === 1 ? 'it was' : 'they were') + ' not checked for width/height.' });
    if (a.jsLazy) out.push({ level: 'muted', msg: plural(a.jsLazy, 'image') + ' ' + (a.jsLazy === 1 ? 'uses' : 'use') + ' a JavaScript lazy-loader (data-src or a "lazy" class), so ' + (a.jsLazy === 1 ? 'its' : 'their') + ' real file size wasn\'t checked.' });
    const unloaded = a.notLoaded - a.jsLazy;
    if (unloaded > 0) out.push({ level: 'warn', msg: plural(unloaded, 'image') + ' had not loaded yet, so ' + (unloaded === 1 ? 'its' : 'their') + ' file size couldn\'t be checked. Scroll to the bottom of the page and click again.' });
    if (a.images) out.push({ level: 'muted', msg: 'File size known for ' + a.withBytes + ' of ' + plural(a.images, 'image') + ' (Chrome hides the size of images from other sites unless they allow it, and of some cached ones).' });
    if (a.sheetsBlocked) out.push({ level: 'muted', msg: plural(a.sheetsBlocked, 'stylesheet') + ' from other sites couldn\'t be read, so CSS heights set there weren\'t seen; check width/height findings against your CSS.' });
    if (a.truncated) out.push({ level: 'warn', msg: 'Very large page: only the first 3,000 images were checked (of ' + (a.total || 0).toLocaleString('en-US') + ').' });
    return out;
  }

  function report(a, now) {
    const d = (now instanceof Date ? now : new Date()).toISOString().slice(0, 10);
    const lines = ['Image weight & CLS audit for ' + (a.host || 'this page') + ' (' + d + ')', 'Page: ' + a.page, summary(a), ''];
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
    lines.push('Checks <img> elements as rendered when you click. It does not check CSS background images, iframes or shadow DOM, does not measure real layout shift or speed, and does not change the page.');
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }
  function cell(v) {
    let s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function csv(a) {
    const rows = [['Check', 'Severity', 'Element', 'File', 'Size', 'Detail', 'Fix']];
    for (const x of a.findings) rows.push([CHECKS[x.check], SEVERITY[x.level], x.element, x.label, x.size, x.detail, x.fix]);
    return rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
  }
  function format(a, fmt, now) { return fmt === 'csv' ? csv(a) : report(a, now); }
  function fileName(page, fmt, now) {
    const d = now instanceof Date ? now : new Date();
    const host = (hostOf(page) || 'page').replace(/[^a-z0-9.-]/gi, '_');
    return 'image-audit-' + host + '-' + d.toISOString().slice(0, 10) + '.' + FORMATS[fmt].ext;
  }

  const api = {
    OVERSIZE, OVERSIZE_BAD, MIN_WASTE, HEAVY, HEAVY_BAD, SMALL_AREA, FORMATS, CHECKS, SEVERITY, hostOf, kb,
    dimsFinding, sizeFinding, lazyFinding, analyze, summary, level, notes, report, csv, cell, format, fileName,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ImageAuditCore = api;
})(typeof self !== 'undefined' ? self : globalThis);
