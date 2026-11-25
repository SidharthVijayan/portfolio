// Clean URL Copier: pure URL logic, no DOM and no chrome.* calls, so it is unit-tested in Node.
// It works on the raw address string: parameters that are kept stay exactly as they were (same
// order, same encoding, same case), only the removed ones disappear. A parameter is marked as
// tracking when its name (decoded, any case, a stray "amp;" prefix ignored) is on the built-in list
// below, either everywhere or on the named sites only. The user can override any row in the popup.
'use strict';
(function (root) {
  // name -> what it is. Removed on every site.
  const GLOBAL = {
    fbclid: 'Facebook/Meta click ID', gclid: 'Google Ads click ID', gclsrc: 'Google Ads click source',
    dclid: 'Google display click ID', gbraid: 'Google Ads click ID (app)', wbraid: 'Google Ads click ID (web-to-app)',
    gad_source: 'Google Ads source tag', gad_campaignid: 'Google Ads campaign tag', srsltid: 'Google Merchant click ID',
    _gl: 'Google Analytics linker', _ga: 'Google Analytics linker', msclkid: 'Microsoft Ads click ID',
    twclid: 'X/Twitter Ads click ID', ttclid: 'TikTok Ads click ID', li_fat_id: 'LinkedIn Ads click ID',
    igshid: 'Instagram share ID', igsh: 'Instagram share ID', epik: 'Pinterest click ID', sccid: 'Snapchat click ID',
    rdt_cid: 'Reddit Ads click ID', yclid: 'Yandex click ID', ysclid: 'Yandex click ID',
    mc_cid: 'Mailchimp campaign ID', mc_eid: 'Mailchimp subscriber ID', _hsenc: 'HubSpot email tracking',
    _hsmi: 'HubSpot email tracking', __hssc: 'HubSpot tracking', __hstc: 'HubSpot tracking', __hsfp: 'HubSpot tracking',
    hsctatracking: 'HubSpot CTA tracking', mkt_tok: 'Marketo email tracking', ml_subscriber: 'MailerLite subscriber ID',
    ml_subscriber_hash: 'MailerLite subscriber ID', vero_id: 'Vero email tracking', vero_conv: 'Vero email tracking',
    oly_anon_id: 'Omeda tracking', oly_enc_id: 'Omeda tracking', _openstat: 'Openstat tracking', wickedid: 'Wicked Reports click ID',
    irclickid: 'Impact affiliate click ID', s_cid: 'Adobe campaign ID', ref_src: 'X/Twitter referral tag',
    _bta_tid: 'Bronto email tracking', _bta_c: 'Bronto email tracking', pk_campaign: 'Matomo campaign tag',
    pk_kwd: 'Matomo campaign tag', pk_keyword: 'Matomo campaign tag', pk_source: 'Matomo campaign tag',
    pk_medium: 'Matomo campaign tag', pk_content: 'Matomo campaign tag', pk_cid: 'Matomo campaign tag', xtor: 'AT Internet campaign tag',
  };
  // name prefix -> what it is. Removed on every site.
  const PREFIX = [['utm_', 'campaign tag (UTM)'], ['mtm_', 'Matomo campaign tag'], ['hsa_', 'HubSpot Ads tag']];
  // Site-specific: only on these sites, because elsewhere the same names can mean something real.
  const SITES = [
    { name: 'YouTube', host: /(^|\.)(youtube\.com|youtu\.be)$/, keys: { si: 'YouTube share ID', pp: 'YouTube search tracking' }, values: { feature: /^share/i } },
    { name: 'Spotify', host: /(^|\.)spotify\.com$/, keys: { si: 'Spotify share ID' } },
    { name: 'X/Twitter', host: /(^|\.)(x\.com|twitter\.com)$/, keys: { s: 'X/Twitter share source', t: 'X/Twitter share ID', ref_url: 'X/Twitter referral tag' } },
    { name: 'LinkedIn', host: /(^|\.)linkedin\.com$/, keys: { trk: 'LinkedIn tracking', trkemail: 'LinkedIn email tracking', trackingid: 'LinkedIn tracking', lipi: 'LinkedIn tracking', midtoken: 'LinkedIn email tracking', midsig: 'LinkedIn email tracking' } },
    { name: 'Facebook', host: /(^|\.)facebook\.com$/, keys: { __tn__: 'Facebook tracking', mibextid: 'Facebook share ID' }, prefixes: ['__cft__'] },
    { name: 'TikTok', host: /(^|\.)tiktok\.com$/, keys: { is_from_webapp: 'TikTok share tracking', sender_device: 'TikTok share tracking', is_copy_url: 'TikTok share tracking', _r: 'TikTok share tracking', _t: 'TikTok share tracking', share_app_id: 'TikTok share tracking' } },
    { name: 'Reddit', host: /(^|\.)reddit\.com$/, keys: { share_id: 'Reddit share ID', ref_source: 'Reddit referral tag' } },
    { name: 'Amazon', host: /(^|\.)amazon(\.[a-z]{2,3}){1,2}$/, keys: { ref_: 'Amazon referral tag', _encoding: 'Amazon tracking', 'content-id': 'Amazon tracking', qid: 'Amazon search tracking', sr: 'Amazon search tracking', sprefix: 'Amazon search tracking', crid: 'Amazon search tracking', dib: 'Amazon search tracking', dib_tag: 'Amazon search tracking' }, prefixes: ['pd_rd_', 'pf_rd_'] },
    { name: 'Google Search', host: /(^|\.)google(\.[a-z]{2,3}){1,2}$/, path: /^\/search\b/, keys: { ved: 'Google Search tracking', ei: 'Google Search tracking', sxsrf: 'Google Search tracking', sca_esv: 'Google Search tracking', sca_upv: 'Google Search tracking', gs_lp: 'Google Search tracking', gs_lcrp: 'Google Search tracking', oq: 'Google Search tracking', uact: 'Google Search tracking', sclient: 'Google Search tracking', iflsig: 'Google Search tracking', rlz: 'Google Search tracking', sourceid: 'Google Search tracking' } },
    { name: 'Bing', host: /(^|\.)bing\.com$/, keys: { cvid: 'Bing search tracking', form: 'Bing search tracking', pq: 'Bing search tracking' } },
  ];
  const LONG_URL = 2000;

  function decodeKey(k) {
    let d;
    try { d = decodeURIComponent(k.replace(/\+/g, ' ')); } catch (e) { d = k; }
    return d.trim().toLowerCase().replace(/^(amp;)+/, '');
  }
  function decodeValue(v) {
    try { return decodeURIComponent(v.replace(/\+/g, ' ')); } catch (e) { return v; }
  }

  // Splits an address into parts without re-encoding anything.
  function split(url) {
    const s = String(url);
    const h = s.indexOf('#');
    const beforeHash = h < 0 ? s : s.slice(0, h);
    const hash = h < 0 ? '' : s.slice(h); // includes '#'
    const q = beforeHash.indexOf('?');
    return { base: q < 0 ? beforeHash : beforeHash.slice(0, q), query: q < 0 ? null : beforeHash.slice(q + 1), hash };
  }

  function check(url) {
    const m = /^([a-z][a-z0-9+.-]*):/i.exec(String(url || '').trim());
    if (!m) return { ok: false, scheme: '' };
    const scheme = m[1].toLowerCase();
    if (scheme !== 'http' && scheme !== 'https') return { ok: false, scheme };
    try { const u = new URL(url); return { ok: true, scheme, host: u.hostname.toLowerCase(), path: u.pathname }; }
    catch (e) { return { ok: false, scheme }; }
  }

  // Why a parameter counts as tracking on this site, or '' if it doesn't.
  function reason(rawKey, rawValue, host, path) {
    const k = decodeKey(rawKey);
    if (!k) return '';
    if (Object.prototype.hasOwnProperty.call(GLOBAL, k)) return GLOBAL[k];
    for (const [p, why] of PREFIX) if (k.startsWith(p) && k.length > p.length) return why;
    for (const site of SITES) {
      if (!site.host.test(host || '') || (site.path && !site.path.test(path || ''))) continue;
      if (site.keys && Object.prototype.hasOwnProperty.call(site.keys, k)) return site.keys[k];
      if (site.prefixes && site.prefixes.some(p => k.startsWith(p))) return site.name + ' tracking';
      if (site.values && site.values[k] && site.values[k].test(decodeValue(rawValue || ''))) return site.name + ' share tag';
    }
    return '';
  }

  // Lists every parameter of the address (and a key=value #part) with its tracking reason.
  function analyse(url) {
    const c = check(url);
    if (!c.ok) return { ok: false, scheme: c.scheme, params: [], hash: '' };
    const { base, query, hash } = split(url);
    const params = [];
    if (query !== null) {
      query.split('&').forEach((raw, i) => {
        if (!raw) return;
        const eq = raw.indexOf('=');
        const key = eq < 0 ? raw : raw.slice(0, eq), value = eq < 0 ? '' : raw.slice(eq + 1);
        const why = reason(key, value, c.host, c.path);
        params.push({ index: i, raw, key, name: decodeKey(key), value: decodeValue(value), hasValue: eq >= 0, tracking: !!why, why });
      });
    }
    // A #part that is only tracking tags (for example #xtor=RSS-8 or #utm_source=x&utm_medium=y).
    let hashTracking = false, hashWhy = '', textFragment = false;
    if (hash.length > 1) {
      const body = hash.slice(1);
      textFragment = /:~:/.test(body);
      const pairs = body.split('&').filter(Boolean);
      if (!textFragment && pairs.length && pairs.every(p => /^[^=]+=/.test(p))) {
        const whys = pairs.map(p => reason(p.slice(0, p.indexOf('=')), p.slice(p.indexOf('=') + 1), c.host, c.path));
        if (whys.every(Boolean)) { hashTracking = true; hashWhy = [...new Set(whys)].join(', '); }
      }
    }
    return { ok: true, scheme: c.scheme, host: c.host, base, query, hash, params, hashTracking, hashWhy, textFragment };
  }

  // Builds the cleaned address. choices: { remove: {index: bool} overrides, removeAll, removeHash (true/false/undefined = auto) }
  function clean(url, choices) {
    const ch = choices || {};
    const a = analyse(url);
    if (!a.ok) return { ok: false, error: 'scheme', scheme: a.scheme, url: '' };
    const overrides = ch.remove || {};
    const removed = [], kept = [];
    for (const p of a.params) {
      const def = ch.removeAll ? true : p.tracking;
      const rm = Object.prototype.hasOwnProperty.call(overrides, p.index) ? !!overrides[p.index] : def;
      (rm ? removed : kept).push(p);
    }
    const dropHash = a.hash.length > 0 && (ch.removeHash === true || (ch.removeHash === undefined && a.hashTracking));
    let out;
    if (!removed.length) out = a.base + (a.query !== null ? '?' + a.query : '');
    else out = a.base + (kept.length ? '?' + kept.map(p => p.raw).join('&') : '');
    if (!dropHash) out += a.hash;
    else if (!removed.length && a.query === null) out = a.base;
    const original = String(url);
    return {
      ok: true, url: out, original, changed: out !== original, saved: original.length - out.length,
      removed, kept, hashRemoved: dropHash, hashTracking: a.hashTracking, hashWhy: a.hashWhy, textFragment: a.textFragment,
      hash: a.hash, params: a.params, removeAll: !!ch.removeAll,
    };
  }

  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function uniq(list) { return [...new Set(list)]; }

  function message(r) {
    if (!r.ok) return 'This is a ' + (r.scheme ? r.scheme + ':' : 'browser') + ' page. Only web addresses (http or https) can be cleaned.';
    const parts = [];
    const tracking = r.removed.filter(p => p.tracking), other = r.removed.filter(p => !p.tracking);
    if (!r.removed.length && !r.hashRemoved) parts.push(r.params.some(p => p.tracking) ? 'Nothing removed.' : 'Already clean: no tracking parameters found.');
    if (tracking.length) parts.push('Removed ' + plural(tracking.length, 'tracking parameter', 'tracking parameters') + ': ' + uniq(tracking.map(p => p.name)).join(', ') + '.');
    if (other.length) parts.push('Also removed ' + plural(other.length, 'other parameter', 'other parameters') + ' you chose: ' + uniq(other.map(p => p.name)).join(', ') + '.');
    if (r.hashRemoved) parts.push(r.hashTracking ? 'Removed the tracking #part (' + r.hashWhy + ').' : 'Removed the #part.');
    if (r.saved > 0) parts.push(plural(r.saved, 'character', 'characters') + ' shorter.');
    const keptOther = r.kept.filter(p => !p.tracking);
    if (keptOther.length && !r.removeAll) parts.push('Kept ' + uniq(keptOther.map(p => p.name)).join(', ') + ' (tick a row below to remove it too).');
    if (r.textFragment && !r.hashRemoved) parts.push('Tip: the #:~:text= part highlights text on the page; tick "Remove #part" to drop it.');
    if (r.url.length > LONG_URL) parts.push('Note: the link is still over 2,000 characters.');
    return parts.join(' ');
  }

  // [title](url) with Markdown-safe title.
  function markdown(title, url) {
    const t = String(title || '').replace(/[\s\u00a0]+/g, ' ').trim() || url;
    return '[' + t.replace(/([\\[\]])/g, '\\$1') + '](' + String(url).replace(/[()\s]/g, c => ({ '(': '%28', ')': '%29' })[c] || encodeURIComponent(c)) + ')';
  }

  const api = { GLOBAL, PREFIX, SITES, decodeKey, split, check, reason, analyse, clean, message, markdown };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CleanCore = api;
})(typeof self !== 'undefined' ? self : this);
