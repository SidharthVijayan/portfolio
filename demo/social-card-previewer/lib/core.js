// Social Card Previewer core: pure functions, no DOM, no network. Shared by the popup and Node tests.
// Rules follow the Open Graph protocol (ogp.me), Meta's sharing guidance and X's Cards markup docs.
// This is a helper, not an official validator: each platform's real rendering and cache can differ.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Core = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CARD_TYPES = ['summary', 'summary_large_image', 'app', 'player'];
  // Keys that may legitimately repeat (arrays in the Open Graph protocol).
  const MULTI = /^og:(image|video|audio|locale:alternate)(:|$)|^twitter:(image|player)(:|$)/;
  const LIMITS = { title: 70, description: 200 };
  const REC = { w: 1200, h: 630 }, MIN_OG = 200, SMALL_OG = { w: 600, h: 315 }, MIN_LARGE = { w: 300, h: 157 }, MIN_SUMMARY = 144;

  const clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  function parseUrl(s, base) { try { return new URL(s, base); } catch { return null; } }
  function truncate(s, n) { s = clean(s); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; }
  function norm(u) {
    const x = parseUrl(u);
    if (!x) return String(u || '');
    return `${x.protocol}//${x.host.toLowerCase()}${x.pathname}${x.search}`;
  }

  // Checks an image (or og:url) value. Returns { url, problems: [{code, level, msg, fix}] }.
  function checkUrl(raw, pageUrl, label) {
    const v = clean(raw), problems = [];
    if (!v) return { url: '', problems };
    const abs = /^https?:\/\//i.test(v);
    const u = parseUrl(v, pageUrl);
    if (!u || !/^https?:$/.test(u.protocol)) {
      problems.push({ code: 'url-invalid', level: 'error', msg: `${label} is not a valid web address: "${truncate(v, 60)}".`, fix: `Use a full https:// URL for ${label}.` });
      return { url: '', problems };
    }
    if (!abs) problems.push({ code: 'url-relative', level: 'error', msg: `${label} is a relative URL ("${truncate(v, 50)}"). Social platforms need a full URL and may show no image.`, fix: `Use the absolute URL: ${u.href}` });
    const page = parseUrl(pageUrl);
    if (u.protocol === 'http:' && page && page.protocol === 'https:') problems.push({ code: 'url-http', level: 'warn', msg: `${label} uses http:// on an https page.`, fix: `Serve it over https: ${u.href.replace(/^http:/, 'https:')}` });
    return { url: u.href, problems };
  }

  // Image size rules. w/h are pixels; source is 'declared' (og:image:width/height) or 'actual' (loaded image).
  function imageSizeIssues(w, h, card, source) {
    const out = [], what = source === 'actual' ? 'The image is' : 'The declared image size is';
    if (!(w > 0 && h > 0)) return out;
    const size = `${w}×${h}px`;
    if (w < MIN_OG || h < MIN_OG) out.push({ code: 'image-too-small', level: 'error', msg: `${what} ${size}, below the 200×200px minimum. Facebook and others may ignore it.`, fix: 'Use an image of at least 1200×630px.' });
    else if (w < SMALL_OG.w || h < SMALL_OG.h) out.push({ code: 'image-small', level: 'warn', msg: `${what} ${size}. Below 600×315px it is usually shown as a small thumbnail, not a large card.`, fix: 'Use 1200×630px for a full-width card.' });
    else if (w < REC.w) out.push({ code: 'image-below-recommended', level: 'info', msg: `${what} ${size}. 1200×630px is recommended for sharp cards on high-resolution screens.`, fix: 'Export the image at 1200×630px.' });
    if (card === 'summary_large_image' && (w < MIN_LARGE.w || h < MIN_LARGE.h)) out.push({ code: 'image-x-large-min', level: 'error', msg: `${what} ${size}, below X's 300×157px minimum for a large image card.`, fix: 'Use at least 300×157px (1200×630px recommended), or set twitter:card to "summary".' });
    if (card === 'summary' && (w < MIN_SUMMARY || h < MIN_SUMMARY)) out.push({ code: 'image-x-summary-min', level: 'error', msg: `${what} ${size}, below X's 144×144px minimum for a summary card.`, fix: 'Use a square image of at least 144×144px.' });
    const ratio = w / h;
    if (w >= MIN_OG && h >= MIN_OG && card !== 'summary' && (ratio < 1.6 || ratio > 2.2)) out.push({ code: 'image-aspect', level: 'info', msg: `The image ratio is ${ratio.toFixed(2)}:1. Large cards use about 1.91:1, so it will be cropped.`, fix: 'Use a 1.91:1 image such as 1200×630px, and keep key content centred.' });
    return out;
  }

  // raw: { url, title, description, canonical, metas: [{key, value, inHead}] }
  // opts: { image: { width, height } | null, imageError: boolean } from loading the preview image in the popup.
  function analyze(raw, opts = {}) {
    const pageUrl = raw.url || '';
    const metas = (raw.metas || []).map(m => ({ key: clean(m.key).toLowerCase(), value: clean(m.value), inHead: m.inHead !== false }));
    const by = {};
    metas.forEach(m => (by[m.key] = by[m.key] || []).push(m));
    const get = k => { const l = by[k]; if (!l) return ''; const f = l.find(m => m.value); return f ? f.value : ''; };
    const has = k => !!by[k];
    const issues = [];
    const add = (level, code, msg, fix) => issues.push({ level, code, msg, fix });
    const pageTitle = clean(raw.title), pageDesc = clean(raw.description);

    const og = {
      title: get('og:title'), description: get('og:description'), type: get('og:type'), siteName: get('og:site_name'),
      imageRaw: get('og:image') || get('og:image:url') || get('og:image:secure_url'), imageAlt: get('og:image:alt'),
      width: parseInt(get('og:image:width'), 10) || 0, height: parseInt(get('og:image:height'), 10) || 0, urlRaw: get('og:url'),
    };
    const tw = { card: get('twitter:card').toLowerCase(), title: get('twitter:title'), description: get('twitter:description'),
      imageRaw: get('twitter:image') || get('twitter:image:src'), imageAlt: get('twitter:image:alt'), site: get('twitter:site') };

    // Empty values and duplicates.
    metas.filter(m => !m.value).forEach(m => add('warn', 'empty-value', `${m.key} is present but empty.`, `Fill in ${m.key} or remove the tag.`));
    Object.entries(by).forEach(([k, l]) => {
      if (MULTI.test(k)) return;
      const vals = [...new Set(l.map(m => m.value).filter(Boolean))];
      if (vals.length > 1) add('warn', 'duplicate-conflict', `${k} appears ${l.length} times with different values. Platforms usually take the first ("${truncate(vals[0], 40)}").`, `Keep a single ${k} tag.`);
    });
    const inBody = [...new Set(metas.filter(m => !m.inHead).map(m => m.key))];
    if (inBody.length) add('warn', 'in-body', `${inBody.length} social tag(s) are in the <body> (${inBody.slice(0, 3).join(', ')}${inBody.length > 3 ? '…' : ''}). Some crawlers only read the <head>.`, 'Move all og: and twitter: meta tags into the <head>.');

    // Open Graph required/recommended tags.
    if (!og.title) {
      if (pageTitle) add('warn', 'og-title-missing', `og:title is missing. Platforms will fall back to the <title>: "${truncate(pageTitle, 50)}".`, 'Add <meta property="og:title" content="…"> with a share-friendly title.');
      else add('error', 'og-title-missing', 'og:title is missing and the page has no <title>, so shares will have no headline.', 'Add <meta property="og:title" content="…">.');
    }
    if (!og.description) add('warn', 'og-description-missing', pageDesc ? 'og:description is missing. Platforms may use the meta description instead.' : 'og:description is missing and there is no meta description, so shares will have no summary text.', 'Add <meta property="og:description" content="…"> (one or two sentences).');
    if (!og.imageRaw && !tw.imageRaw) add('error', 'og-image-missing', 'No og:image or twitter:image. Shares will show no picture, or one the platform guesses.', 'Add <meta property="og:image" content="https://…/card.png"> (1200×630px).');
    else if (!og.imageRaw) add('warn', 'og-image-missing', 'og:image is missing (only twitter:image is set), so Facebook, LinkedIn and others get no image.', 'Add <meta property="og:image"> with the same full URL.');
    if (!og.type) add('warn', 'og-type-missing', 'og:type is missing. Most platforms then assume "website".', 'Add <meta property="og:type" content="website"> (or "article" for posts).');
    if (!og.urlRaw) add('warn', 'og-url-missing', 'og:url is missing, so likes and shares may be split across URL variants.', `Add <meta property="og:url" content="${raw.canonical ? (parseUrl(raw.canonical, pageUrl) || {}).href || pageUrl : pageUrl}">.`);

    const ogUrl = checkUrl(og.urlRaw, pageUrl, 'og:url');
    ogUrl.problems.forEach(p => add(p.level, p.code, p.msg, p.fix));
    const canonical = raw.canonical ? (parseUrl(raw.canonical, pageUrl) || {}).href || '' : '';
    if (ogUrl.url && canonical && norm(ogUrl.url) !== norm(canonical)) add('warn', 'og-url-canonical', `og:url (${truncate(ogUrl.url, 60)}) differs from the canonical URL (${truncate(canonical, 60)}).`, 'Set og:url to the canonical URL so share counts stay together.');

    const ogImg = checkUrl(og.imageRaw, pageUrl, 'og:image');
    ogImg.problems.forEach(p => add(p.level, p.code, p.msg, p.fix));
    const twImg = tw.imageRaw && tw.imageRaw !== og.imageRaw ? checkUrl(tw.imageRaw, pageUrl, 'twitter:image') : { url: tw.imageRaw ? ogImg.url : '', problems: [] };
    twImg.problems.forEach(p => add(p.level, p.code, p.msg, p.fix));

    // X / Twitter card.
    let card = tw.card;
    if (!tw.card) {
      card = 'summary';
      add('warn', 'twitter-card-missing', 'twitter:card is missing. X may show only a small summary card, or none.', 'Add <meta name="twitter:card" content="summary_large_image">.');
    } else if (!CARD_TYPES.includes(tw.card)) {
      add('error', 'twitter-card-invalid', `twitter:card "${tw.card}" is not a valid card type (summary, summary_large_image, app, player).`, 'Use content="summary_large_image" for a big image card.');
      card = 'summary';
    }

    const image = ogImg.url || twImg.url;
    const xImage = twImg.url || ogImg.url;
    if (card === 'summary_large_image' && !xImage) add('error', 'twitter-large-no-image', 'twitter:card is summary_large_image but there is no image to show.', 'Add og:image or twitter:image.');
    if (image && !og.imageAlt && !tw.imageAlt) add('info', 'image-alt-missing', 'No og:image:alt or twitter:image:alt, so screen-reader users get no image description.', 'Add <meta property="og:image:alt" content="…">.');

    // Image size: declared, then actual (if the popup loaded it).
    const declared = og.width && og.height ? { width: og.width, height: og.height } : null;
    const actual = opts.image && opts.image.width ? opts.image : null;
    if (image && !declared && ogImg.url) add('info', 'image-dims-missing', 'og:image:width and og:image:height are not set. Facebook may not show the image on the first share.', 'Add og:image:width and og:image:height.');
    if (actual) {
      imageSizeIssues(actual.width, actual.height, card, 'actual').forEach(p => add(p.level, p.code, p.msg, p.fix));
      if (declared && (declared.width !== actual.width || declared.height !== actual.height)) add('warn', 'image-size-mismatch', `og:image:width/height say ${declared.width}×${declared.height}px but the image is ${actual.width}×${actual.height}px.`, 'Update the declared size to match the real image.');
    } else if (declared) imageSizeIssues(declared.width, declared.height, card, 'declared').forEach(p => add(p.level, p.code, p.msg, p.fix));
    if (image && opts.imageError) add('error', 'image-load-failed', 'The image could not be loaded from your browser. Platforms will likely fail to fetch it too.', 'Check that the image URL works and is publicly reachable.');

    // Length hints.
    const effTitle = og.title || pageTitle, effDesc = og.description || pageDesc;
    if (effTitle.length > LIMITS.title) add('info', 'title-long', `The share title is ${effTitle.length} characters; long titles are often cut off after about 70.`, 'Keep og:title under about 70 characters.');
    if (effDesc.length > LIMITS.description) add('info', 'description-long', `The share description is ${effDesc.length} characters; most cards show only the first one or two lines.`, 'Keep og:description under about 200 characters.');

    const order = { error: 0, warn: 1, info: 2 };
    issues.sort((a, b) => order[a.level] - order[b.level]);
    const host = (parseUrl(ogUrl.url || pageUrl) || {}).hostname || '';
    const r = {
      url: pageUrl, canonical, og, tw, card, image, xImage, declared, actual,
      effective: {
        og: { title: effTitle, description: effDesc, image, host, siteName: og.siteName, titleSource: og.title ? 'og:title' : pageTitle ? '<title>' : '' },
        x: { card, title: tw.title || effTitle, description: tw.description || effDesc, image: xImage, host,
          titleSource: tw.title ? 'twitter:title' : og.title ? 'og:title' : pageTitle ? '<title>' : '' },
      },
      tags: metas.map(m => ({ key: m.key, value: m.value })),
      issues,
    };
    r.summary = { errors: issues.filter(i => i.level === 'error').length, warnings: issues.filter(i => i.level === 'warn').length, tags: metas.length, card };
    return r;
  }

  // What the popup draws for each preview card (approximate; platforms differ and change their layouts).
  function previewModel(r) {
    const e = r.effective;
    return {
      large: { image: e.og.image, domain: e.og.host.toUpperCase(), title: truncate(e.og.title, 88) || '(no title)', description: truncate(e.og.description, 110) },
      x: { layout: e.x.card === 'summary_large_image' ? 'large' : 'small', image: e.x.image, domain: e.x.host, title: truncate(e.x.title, 70) || '(no title)', description: e.x.card === 'summary_large_image' ? '' : truncate(e.x.description, 90) },
    };
  }

  function toText(r) {
    const L = ['Social Card Previewer report', `Page: ${r.url}`];
    const e = r.effective;
    L.push(`Share title: ${e.og.title || '(none)'}${e.og.titleSource && e.og.titleSource !== 'og:title' ? ` [from ${e.og.titleSource}]` : ''}`);
    L.push(`Share description: ${e.og.description || '(none)'}`);
    L.push(`Image: ${r.image || '(none)'}${r.actual ? ` (${r.actual.width}×${r.actual.height}px)` : ''}`);
    L.push(`X card: ${r.card}${r.tw.card ? '' : ' (twitter:card missing)'}`);
    L.push(`Social tags found: ${r.summary.tags}`);
    r.tags.forEach(t => L.push(`  ${t.key}\t${t.value || '(empty)'}`));
    L.push(`Errors: ${r.summary.errors}, warnings: ${r.summary.warnings}`);
    if (r.issues.length) {
      L.push('', 'Issues:');
      r.issues.forEach(i => { L.push(`- [${i.level.toUpperCase()}] ${i.msg}`); L.push(`  Fix: ${i.fix}`); });
    }
    L.push('', 'Note: previews are approximate. Each platform caches and renders cards in its own way.');
    return L.join('\n');
  }

  return { analyze, previewModel, imageSizeIssues, checkUrl, toText, truncate, norm };
});
