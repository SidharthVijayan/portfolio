// Third-Party Script Spotter core: pure functions, no DOM, no chrome.* (unit-tested in Node).
// Takes what content/extract.js returned, works out which scripts/iframes come from another site, groups them by
// site, matches them against a built-in list of well-known services, and writes a text report or CSV.
'use strict';
(function (root) {
  // Two-part public suffixes where the registrable site is the last THREE labels (e.g. shop.co.uk).
  const MULTI_SUFFIX = new Set(('co.uk org.uk ac.uk gov.uk me.uk net.uk ltd.uk plc.uk com.au net.au org.au edu.au gov.au ' +
    'co.nz org.nz net.nz co.in net.in org.in gen.in firm.in ind.in ac.in gov.in co.jp ne.jp or.jp ac.jp com.br net.br org.br ' +
    'com.mx org.mx co.za org.za com.sg edu.sg com.my com.cn net.cn org.cn com.hk com.tw co.kr or.kr com.tr com.ar com.co ' +
    'co.id or.id com.ph com.pk com.ng co.ke com.eg com.sa ae.org co.il com.vn com.ua').split(' '));

  // [host suffix, company, category]. A host matches when it equals the suffix or ends with "." + suffix.
  const KNOWN = [
    ['doubleclick.net', 'Google', 'Advertising'], ['googlesyndication.com', 'Google', 'Advertising'],
    ['googleadservices.com', 'Google', 'Advertising'], ['adservice.google.com', 'Google', 'Advertising'],
    ['amazon-adsystem.com', 'Amazon', 'Advertising'], ['adnxs.com', 'Microsoft (Xandr)', 'Advertising'],
    ['bat.bing.com', 'Microsoft', 'Advertising'], ['criteo.com', 'Criteo', 'Advertising'], ['criteo.net', 'Criteo', 'Advertising'],
    ['taboola.com', 'Taboola', 'Advertising'], ['outbrain.com', 'Outbrain', 'Advertising'],
    ['connect.facebook.net', 'Meta', 'Advertising'], ['ads-twitter.com', 'X', 'Advertising'],
    ['snap.licdn.com', 'LinkedIn', 'Advertising'], ['px.ads.linkedin.com', 'LinkedIn', 'Advertising'],
    ['analytics.tiktok.com', 'TikTok', 'Advertising'], ['ct.pinterest.com', 'Pinterest', 'Advertising'],
    ['s.pinimg.com', 'Pinterest', 'Advertising'], ['pubmatic.com', 'PubMatic', 'Advertising'],
    ['rubiconproject.com', 'Magnite', 'Advertising'], ['quantserve.com', 'Quantcast', 'Advertising'],
    ['google-analytics.com', 'Google', 'Analytics'], ['analytics.google.com', 'Google', 'Analytics'],
    ['segment.com', 'Segment', 'Analytics'], ['segment.io', 'Segment', 'Analytics'], ['mixpanel.com', 'Mixpanel', 'Analytics'],
    ['mxpnl.com', 'Mixpanel', 'Analytics'], ['amplitude.com', 'Amplitude', 'Analytics'], ['heapanalytics.com', 'Heap', 'Analytics'],
    ['plausible.io', 'Plausible', 'Analytics'], ['matomo.cloud', 'Matomo', 'Analytics'],
    ['scorecardresearch.com', 'Comscore', 'Analytics'], ['chartbeat.com', 'Chartbeat', 'Analytics'],
    ['parsely.com', 'Parse.ly', 'Analytics'], ['hs-scripts.com', 'HubSpot', 'Analytics'], ['hs-analytics.net', 'HubSpot', 'Analytics'],
    ['googletagmanager.com', 'Google', 'Tag manager'], ['tiqcdn.com', 'Tealium', 'Tag manager'],
    ['adobedtm.com', 'Adobe', 'Tag manager'],
    ['hotjar.com', 'Hotjar', 'Session recording'], ['clarity.ms', 'Microsoft Clarity', 'Session recording'],
    ['fullstory.com', 'FullStory', 'Session recording'], ['mouseflow.com', 'Mouseflow', 'Session recording'],
    ['luckyorange.com', 'Lucky Orange', 'Session recording'], ['logrocket.com', 'LogRocket', 'Session recording'],
    ['platform.twitter.com', 'X', 'Social'], ['platform.linkedin.com', 'LinkedIn', 'Social'],
    ['assets.pinterest.com', 'Pinterest', 'Social'], ['addthis.com', 'AddThis', 'Social'], ['sharethis.com', 'ShareThis', 'Social'],
    ['intercom.io', 'Intercom', 'Chat & support'], ['intercomcdn.com', 'Intercom', 'Chat & support'],
    ['zdassets.com', 'Zendesk', 'Chat & support'], ['driftt.com', 'Drift', 'Chat & support'], ['tawk.to', 'tawk.to', 'Chat & support'],
    ['crisp.chat', 'Crisp', 'Chat & support'],
    ['js.stripe.com', 'Stripe', 'Payments'], ['paypal.com', 'PayPal', 'Payments'], ['paypalobjects.com', 'PayPal', 'Payments'],
    ['checkout.razorpay.com', 'Razorpay', 'Payments'], ['pay.google.com', 'Google', 'Payments'],
    ['youtube.com', 'Google (YouTube)', 'Video'], ['youtube-nocookie.com', 'Google (YouTube)', 'Video'], ['ytimg.com', 'Google (YouTube)', 'Video'],
    ['vimeo.com', 'Vimeo', 'Video'], ['vimeocdn.com', 'Vimeo', 'Video'], ['wistia.com', 'Wistia', 'Video'],
    ['maps.googleapis.com', 'Google', 'Maps'], ['api.mapbox.com', 'Mapbox', 'Maps'],
    ['fonts.googleapis.com', 'Google', 'Fonts & libraries'], ['ajax.googleapis.com', 'Google', 'Fonts & libraries'],
    ['gstatic.com', 'Google', 'Fonts & libraries'], ['cdnjs.cloudflare.com', 'Cloudflare', 'Fonts & libraries'],
    ['cdn.jsdelivr.net', 'jsDelivr', 'Fonts & libraries'], ['unpkg.com', 'unpkg', 'Fonts & libraries'],
    ['code.jquery.com', 'jQuery', 'Fonts & libraries'], ['fontawesome.com', 'Font Awesome', 'Fonts & libraries'],
    ['use.typekit.net', 'Adobe Fonts', 'Fonts & libraries'],
    ['cookielaw.org', 'OneTrust', 'Consent'], ['cookiebot.com', 'Cookiebot', 'Consent'], ['usercentrics.eu', 'Usercentrics', 'Consent'],
    ['challenges.cloudflare.com', 'Cloudflare Turnstile', 'Security'], ['hcaptcha.com', 'hCaptcha', 'Security'],
    ['nr-data.net', 'New Relic', 'Monitoring'], ['js-agent.newrelic.com', 'New Relic', 'Monitoring'],
    ['sentry-cdn.com', 'Sentry', 'Monitoring'], ['datadoghq-browser-agent.com', 'Datadog', 'Monitoring'],
  ].sort((a, b) => b[0].length - a[0].length);
  const TRACKING = new Set(['Advertising', 'Analytics', 'Tag manager', 'Session recording', 'Social']);
  const GROUPS = {
    tracker: 'Known trackers', service: 'Other known services', unknown: 'Not recognised', first: "This site's own scripts",
  };
  const FORMATS = { report: { label: 'Text report', ext: 'txt', mime: 'text/plain' }, csv: { label: 'CSV (one row per script/iframe)', ext: 'csv', mime: 'text/csv' } };

  function hostOf(url) { try { return new URL(url).hostname.toLowerCase().replace(/\.$/, ''); } catch (e) { return ''; } }
  function siteOf(host) {
    host = String(host || '').toLowerCase().replace(/\.$/, '');
    if (!host || /^[\d.]+$/.test(host) || host.includes(':') || !host.includes('.')) return host.replace(/^\[|\]$/g, '');
    const l = host.split('.');
    const n = l.length >= 3 && MULTI_SUFFIX.has(l.slice(-2).join('.')) ? 3 : 2;
    return l.slice(-n).join('.');
  }
  function lookup(host) {
    for (const [d, company, category] of KNOWN) if (host === d || host.endsWith('.' + d)) return { company, category, tracking: TRACKING.has(category) };
    return null;
  }

  function analyze(raw) {
    raw = raw || {};
    const page = String(raw.url || '');
    const pageHost = hostOf(page), pageSite = siteOf(pageHost);
    const seen = new Set(), items = [];
    const all = Array.isArray(raw.items) ? raw.items : [];
    for (const it of all.filter(i => i.source === 'page')) { items.push(Object.assign({}, it)); seen.add(it.kind + ' ' + it.url); }
    let removed = 0;
    for (const it of all.filter(i => i.source === 'loaded')) {
      const k = it.kind + ' ' + it.url; if (seen.has(k)) continue; seen.add(k); removed++;
      items.push(Object.assign({}, it));
    }
    const sites = new Map();
    for (const it of items) {
      it.host = hostOf(it.url); it.site = siteOf(it.host);
      it.party = pageSite && it.site === pageSite ? 'first' : 'third';
      it.known = it.party === 'third' ? lookup(it.host) : null;
      let s = sites.get(it.site);
      if (!s) { s = { site: it.site, party: it.party, hosts: [], items: [], scripts: 0, iframes: 0, hidden: 0, removed: 0, known: null }; sites.set(it.site, s); }
      if (!s.hosts.includes(it.host)) s.hosts.push(it.host);
      s.items.push(it);
      if (it.kind === 'script') s.scripts++; else s.iframes++;
      if (it.hidden) s.hidden++;
      if (it.source === 'loaded') s.removed++;
      if (it.known && (!s.known || (it.known.tracking && !s.known.tracking))) s.known = it.known;
    }
    for (const s of sites.values()) s.group = s.party === 'first' ? 'first' : s.known ? (s.known.tracking ? 'tracker' : 'service') : 'unknown';
    const order = { tracker: 0, service: 1, unknown: 2, first: 3 };
    const list = [...sites.values()].sort((a, b) => order[a.group] - order[b.group] || (b.items.length - a.items.length) || a.site.localeCompare(b.site));
    const third = list.filter(s => s.party === 'third');
    const thirdItems = items.filter(i => i.party === 'third');
    const counts = {
      sites: third.length, trackers: third.filter(s => s.group === 'tracker').length,
      services: third.filter(s => s.group === 'service').length, unknown: third.filter(s => s.group === 'unknown').length,
      scripts: thirdItems.filter(i => i.kind === 'script').length, iframes: thirdItems.filter(i => i.kind === 'iframe').length,
      firstScripts: items.filter(i => i.party === 'first' && i.kind === 'script').length, inline: raw.inline | 0,
      hiddenFrames: thirdItems.filter(i => i.hidden).length, removed: thirdItems.filter(i => i.source === 'loaded').length,
    };
    return { page, title: String(raw.title || ''), pageHost, pageSite, sites: list, items, counts,
      blankFrames: raw.blankFrames | 0, truncated: !!raw.truncated, total: raw.total | 0 };
  }

  function visibleSites(a, includeFirst) { return a.sites.filter(s => includeFirst || s.party === 'third'); }
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));
  function kindText(s) {
    const p = [];
    if (s.scripts) p.push(plural(s.scripts, 'script')); if (s.iframes) p.push(plural(s.iframes, 'iframe'));
    return p.join(', ');
  }
  function summary(a) {
    const c = a.counts;
    if (!c.sites) return 'No third-party scripts or iframes found on this page' + (c.firstScripts ? ' (' + plural(c.firstScripts, 'script') + ' from this site).' : '.');
    return plural(c.sites, 'third-party domain') + ' loading ' + [c.scripts && plural(c.scripts, 'script'), c.iframes && plural(c.iframes, 'iframe')].filter(Boolean).join(' and ') +
      '. ' + plural(c.trackers, 'known tracker') + '.';
  }
  function notes(a) {
    const out = [], c = a.counts;
    if (c.hiddenFrames) out.push({ level: 'warn', msg: plural(c.hiddenFrames, 'third-party iframe is', 'third-party iframes are') + ' hidden or 1×1 pixel, a common pattern for tracking frames.' });
    if (c.removed) out.push({ level: 'muted', msg: plural(c.removed, 'item was', 'items were') + ' loaded by the page but no longer in it (often added and then removed by another script).' });
    if (c.inline) out.push({ level: 'muted', msg: plural(c.inline, 'inline script') + ' in the page (code inside the page itself; not listed by domain).' });
    if (a.truncated) out.push({ level: 'warn', msg: 'Very large page: only the first 5,000 scripts and iframes are listed.' });
    return out;
  }
  function loading(it) {
    if (it.source === 'loaded') return 'loaded, no longer in page';
    const f = [it.module && 'module', it.async && 'async', it.defer && 'defer'].filter(Boolean);
    return it.kind === 'iframe' ? (it.hidden ? 'hidden iframe' : 'iframe') : (f.join(' ') || 'blocking');
  }
  function report(a, opts, now) {
    opts = opts || {};
    const d = now instanceof Date ? now : new Date();
    const lines = ['Third-party scripts on ' + (a.pageHost || 'this page') + ' (' + d.toISOString().slice(0, 10) + ')', 'Page: ' + a.page, summary(a), ''];
    for (const g of Object.keys(GROUPS)) {
      const ss = visibleSites(a, opts.includeFirst).filter(s => s.group === g);
      if (!ss.length) continue;
      lines.push(GROUPS[g] + ' (' + ss.length + ')');
      for (const s of ss) {
        lines.push('- ' + s.site + (s.known ? ' (' + s.known.company + ', ' + s.known.category + ')' : '') + ': ' + kindText(s) + (s.hidden ? ', ' + s.hidden + ' hidden' : ''));
        for (const it of s.items) lines.push('    ' + it.url + (loading(it) === 'blocking' || loading(it) === 'iframe' ? '' : ' [' + loading(it) + ']'));
      }
      lines.push('');
    }
    for (const n of notes(a)) lines.push('Note: ' + n.msg);
    lines.push('Matched against a built-in list of ' + KNOWN.length + ' well-known service domains. Not recognised does not mean safe or unsafe.');
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }
  function cell(v) {
    let s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // keep spreadsheets from running a cell as a formula
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function csv(a, opts) {
    opts = opts || {};
    const rows = [['Domain', 'Group', 'Company', 'Category', 'Type', 'Address', 'Host', 'Loading']];
    for (const s of visibleSites(a, opts.includeFirst)) for (const it of s.items)
      rows.push([s.site, GROUPS[s.group], s.known ? s.known.company : '', s.known ? s.known.category : '', it.kind, it.url, it.host, loading(it)]);
    return rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
  }
  function format(a, fmt, opts, now) { return fmt === 'csv' ? csv(a, opts) : report(a, opts, now); }
  function fileName(page, fmt, now) {
    const d = now instanceof Date ? now : new Date();
    const host = (hostOf(page) || 'page').replace(/[^a-z0-9.-]/gi, '_');
    return 'third-party-' + host + '-' + d.toISOString().slice(0, 10) + '.' + FORMATS[fmt].ext;
  }

  const api = { MULTI_SUFFIX, KNOWN, TRACKING, GROUPS, FORMATS, hostOf, siteOf, lookup, analyze, visibleSites, summary, notes, loading, report, csv, cell, format, fileName, kindText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SpotCore = api;
})(typeof self !== 'undefined' ? self : globalThis);
