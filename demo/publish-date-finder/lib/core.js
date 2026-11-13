// Publish Date Finder core: pure functions, no DOM, no chrome.* (unit-tested in Node).
// Takes the raw evidence content/extract.js returned and:
//   parseDate()  - reads ISO 8601, YYYY/MM/DD, "March 4, 2025", "4 March 2025", RFC 2822 style
//                  ("Tue, 04 Mar 2025 10:00:00 GMT") and unambiguous day/month/year; keeps the
//                  time and time zone exactly as written; ambiguous dates like 03/04/2025 are skipped
//   candidates() - turns meta tags, JSON-LD (incl. @graph and nested items), microdata, <time>
//                  elements, "Published/Updated ..." text lines and /YYYY/MM/DD/ in the address
//                  into dated evidence, each marked published / updated / created / unlabelled
//   analyze()    - picks the best published and last-updated date (the day most sources agree on,
//                  weighted by how reliable the source is) and flags conflicts, updated-before-
//                  published, future dates and address-only dates
//   report()     - plain-text report for the clipboard
// Does not score SEO, headings or AI-readiness (the live extensions do that) and builds no citation.
'use strict';
(function (root) {
  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const MON = MONTHS.map(m => m.slice(0, 3));
  const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const KIND_LABEL = { published: 'Published', modified: 'Updated', created: 'Created', unknown: 'Date (unlabelled)' };
  const SOURCE_LABEL = { jsonld: 'JSON-LD', meta: 'Meta tag', microdata: 'Microdata', time: '<time> tag', text: 'Page text', url: 'Address' };
  const pad = n => String(n).padStart(2, '0');
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));
  const monthIndex = s => { const k = String(s).toLowerCase().replace(/\.$/, ''); const i = MON.indexOf(k.slice(0, 3)); return i >= 0 && (k.length === 3 || MONTHS[i].startsWith(k) || k === 'sept') ? i + 1 : 0; };
  const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

  function make(y, m, d, hh, mm, ss, tz) {
    y = +y; m = +m; d = +d;
    if (!(y >= 1990 && y <= 2100) || !(m >= 1 && m <= 12) || !(d >= 1 && d <= daysIn(y, m))) return null;
    const r = { y, m, d, day: `${y}-${pad(m)}-${pad(d)}`, time: null, tz: null };
    if (hh != null && hh !== '') {
      hh = +hh; mm = +(mm || 0); ss = +(ss || 0);
      if (hh > 23 || mm > 59 || ss > 60) return null;
      r.time = `${pad(hh)}:${pad(mm)}` + (ss ? ':' + pad(Math.floor(ss)) : '');
    }
    if (tz) {
      const t = String(tz).toUpperCase();
      if (t === 'Z' || t === 'GMT' || t === 'UTC') r.tz = 'UTC';
      else { const z = t.match(/^([+-])(\d\d):?(\d\d)$/); if (z) r.tz = (z[2] === '00' && z[3] === '00') ? 'UTC' : `UTC${z[1]}${z[2]}:${z[3]}`; }
    }
    return r;
  }

  // Returns { y, m, d, day:'YYYY-MM-DD', time:'HH:MM'|null, tz:'UTC'|'UTC+05:30'|null } or null.
  function parseDate(input) {
    const s = String(input == null ? '' : input).replace(/[\u00a0\s]+/g, ' ').trim();
    if (!s) return null;
    const T = '(?:[T ,]+(?:at )?(\\d{1,2}):(\\d{2})(?::(\\d{2})(?:\\.\\d+)?)?\\s*(Z|GMT|UTC|[+-]\\d{2}:?\\d{2})?)?';
    let m = s.match(new RegExp('(?:^|[^\\d])(\\d{4})-(\\d{1,2})-(\\d{1,2})' + T + '(?![\\d])', 'i'));
    if (m) return make(m[1], m[2], m[3], m[4], m[5], m[6], m[7]);
    m = s.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
    if (m) return make(m[1], m[2], m[3], m[4], m[5], m[6], m[7]);
    m = s.match(new RegExp('(?:^|[^\\d])(\\d{4})[/.](\\d{1,2})[/.](\\d{1,2})' + T + '(?![\\d])', 'i'));
    if (m) return make(m[1], m[2], m[3], m[4], m[5], m[6], m[7]);
    const MN = '([A-Za-z]{3,9}\\.?)';
    m = s.match(new RegExp('\\b' + MN + ' (\\d{1,2})(?:st|nd|rd|th)?,? (\\d{4})' + T, 'i'));
    if (m && monthIndex(m[1])) return make(m[3], monthIndex(m[1]), m[2], m[4], m[5], m[6], m[7]);
    m = s.match(new RegExp('\\b(\\d{1,2})(?:st|nd|rd|th)?(?: of)? ' + MN + ',? (\\d{4})' + T, 'i'));
    if (m && monthIndex(m[2])) return make(m[3], monthIndex(m[2]), m[1], m[4], m[5], m[6], m[7]);
    m = s.match(/(?:^|[^\d])(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?![\d])/);
    if (m) {
      const a = +m[1], b = +m[2];
      if (a > 12 && b <= 12) return make(m[3], b, a);
      if (b > 12 && a <= 12) return make(m[3], a, b);
      if (a === b) return make(m[3], a, b);
      return null; // 03/04/2025 could be 3 April or March 4: not guessed
    }
    return null;
  }

  function kindOfKey(key) {
    const k = String(key).toLowerCase();
    if (/modif|updat|revis|lastmod|last-mod/.test(k)) return 'modified';
    if (/creat/.test(k)) return 'created';
    if (/publi|pub[-_.]?date|pubdate|issued|^date$|^dc\.date$|^dcterms\.date$|citation_.*date|sailthru\.date|uploaddate|original|release/.test(k)) return 'published';
    return 'unknown';
  }
  const kindOfProp = p => ({ datepublished: 'published', datemodified: 'modified', datecreated: 'created', uploaddate: 'published' })[String(p).toLowerCase()] || 'unknown';
  const SIDE_TYPES = /^(Comment|Review|Answer|Rating|AggregateRating|ImageObject|Person|Organization|Offer|Event|Question|ListItem|BreadcrumbList)$/i;

  function jsonLdCandidates(text, out, errors) {
    const clean = String(text || '').replace(/^\s*(<!--|\/\/<!\[CDATA\[|<!\[CDATA\[)/, '').replace(/(-->|\/\/\]\]>|\]\]>)\s*$/, '').trim();
    if (!clean) return;
    let data;
    try { data = JSON.parse(clean); } catch (e) { errors.push('JSON-LD block could not be read (invalid JSON)'); return; }
    const seen = new Set();
    const walk = (node, depth, parentType) => {
      if (!node || typeof node !== 'object' || depth > 12 || seen.has(node)) return;
      seen.add(node);
      if (Array.isArray(node)) { for (const x of node) walk(x, depth + 1, parentType); return; }
      const rawType = node['@type'];
      const type = (Array.isArray(rawType) ? rawType[0] : rawType) || parentType || 'Thing';
      for (const [k, v] of Object.entries(node)) {
        if (/^(datePublished|dateModified|dateCreated|uploadDate)$/.test(k) && (typeof v === 'string' || typeof v === 'number')) {
          const side = SIDE_TYPES.test(String(type));
          out.push({ kind: kindOfProp(k), source: 'jsonld', label: `JSON-LD ${type} ${k}`, raw: String(v), weight: side ? 1 : 5, side });
        } else if (v && typeof v === 'object') walk(v, depth + 1, k === '@graph' ? undefined : type);
      }
    };
    walk(data, 0);
  }

  // Raw evidence -> [{ kind, source, label, raw, weight, date }] (only entries with a readable date).
  function candidates(raw) {
    const list = [], errors = [];
    raw = raw || {};
    for (const m of raw.meta || []) {
      if (/^(og:video:duration|video:duration|music:duration|og:ttl|refresh|revisit-after|timezone|time-zone|og:time)$/.test(m.key)) continue;
      const known = /^(article:|og:|dc|dcterms|citation_|parsely|sailthru|datepublished|datemodified|datecreated|uploaddate|last-modified|date$|pubdate)/.test(m.key);
      list.push({ kind: kindOfKey(m.key), source: 'meta', label: `meta ${m.key}`, raw: m.content, weight: known ? 4 : 3 });
    }
    for (const t of raw.ld || []) jsonLdCandidates(t, list, errors);
    for (const m of raw.micro || []) list.push({ kind: kindOfProp(m.prop), source: 'microdata', label: `microdata ${m.prop} on <${m.tag}>`, raw: m.value, weight: 4 });
    for (const t of raw.times || []) {
      if (t.aside) { list.push({ kind: 'unknown', source: 'time', label: '<time> in a comment, sidebar or footer', raw: t.dt || t.text, weight: 0, side: true }); continue; }
      const hint = `${t.itemprop} ${t.cls}`.toLowerCase();
      let kind = t.itemprop ? kindOfProp(t.itemprop) : 'unknown';
      if (kind === 'unknown') kind = /modif|updat/.test(hint) ? 'modified' : (t.pubdate || /publi|posted|entry-date|post-date|byline|pubdate/.test(hint)) ? 'published' : 'unknown';
      const strong = t.pubdate || !!t.itemprop || kind !== 'unknown';
      list.push({ kind, source: 'time', label: '<time' + (t.pubdate ? ' pubdate' : '') + (t.itemprop ? ` itemprop="${t.itemprop}"` : '') + (t.cls ? ` class="${t.cls}"` : '') + '>' + (t.shown ? '' : ' (not shown)'), raw: t.dt || t.text, weight: strong ? 3 : (t.inArticle ? 2 : 1) });
    }
    for (const line of raw.lines || []) {
      // A line can carry both: "Published 3 March 2025 · Updated 9 April 2025".
      const re = /\b(first published|published|publish|posted|last updated|updated|last modified|modified|reviewed|created|written|issued|revised|edited)\b[^A-Za-z0-9]*(?:on|at|:)?\s*/gi;
      const hits = [...line.matchAll(re)];
      hits.forEach((h, i) => {
        const seg = line.slice(h.index + h[0].length, i + 1 < hits.length ? hits[i + 1].index : undefined);
        const w = h[1].toLowerCase();
        const kind = /updat|modif|revis|edited|reviewed/.test(w) ? 'modified' : /creat|written/.test(w) ? 'created' : 'published';
        list.push({ kind, source: 'text', label: `page text "${line.length > 80 ? line.slice(0, 79) + '…' : line}"`, raw: seg.slice(0, 60), weight: 3 });
      });
    }
    try {
      const u = new URL(raw.url);
      const m = u.pathname.match(/\/((?:19|20)\d\d)[/-](0?[1-9]|1[0-2])[/-](0?[1-9]|[12]\d|3[01])(?=\/|-|$|\.)/);
      if (m) list.push({ kind: 'published', source: 'url', label: `address ${m[0]}`, raw: `${m[1]}-${pad(m[2])}-${pad(m[3])}`, weight: 1 });
    } catch (e) { /* no address */ }
    const dated = [];
    for (const c of list) { const date = parseDate(c.raw); if (date) dated.push(Object.assign(c, { date })); }
    const ambiguous = list.filter(c => !c.date && /(?:^|[^\d])\d{1,2}[/.-]\d{1,2}[/.-]\d{4}(?!\d)/.test(c.raw)).length;
    return { list: dated, errors, unreadable: ambiguous };
  }

  const dayNum = d => Date.UTC(d.y, d.m - 1, d.d) / 86400000;
  function pick(cands) {
    const use = cands.filter(c => !c.side && c.weight > 0);
    if (!use.length) return null;
    const byDay = new Map();
    for (const c of use) { const g = byDay.get(c.date.day) || { day: c.date.day, score: 0, items: [] }; g.score += c.weight; g.items.push(c); byDay.set(c.date.day, g); }
    const groups = [...byDay.values()].sort((a, b) => b.score - a.score || Math.max(...b.items.map(i => i.weight)) - Math.max(...a.items.map(i => i.weight)) || (a.day < b.day ? -1 : 1));
    const g = groups[0];
    const best = g.items.slice().sort((a, b) => (b.date.tz ? 2 : b.date.time ? 1 : 0) - (a.date.tz ? 2 : a.date.time ? 1 : 0) || b.weight - a.weight)[0];
    return { date: best.date, best, items: g.items, sources: [...new Set(g.items.slice().sort((a, b) => b.weight - a.weight).map(i => i.source))], others: groups.slice(1) };
  }

  function age(date, now) {
    const n = new Date(now);
    const today = Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) / 86400000;
    const diff = today - dayNum(date);
    if (diff < 0) return diff === -1 ? 'tomorrow' : `in ${plural(-diff, 'day')}`;
    if (diff === 0) return 'today';
    if (diff === 1) return 'yesterday';
    if (diff < 31) return `${plural(diff, 'day')} ago`;
    let months = (n.getFullYear() - date.y) * 12 + (n.getMonth() + 1 - date.m) - (n.getDate() < date.d ? 1 : 0);
    if (months < 1) months = 1;
    if (months < 12) return `${plural(months, 'month')} ago`;
    const y = Math.floor(months / 12), mo = months % 12;
    return `${plural(y, 'year')}${mo ? ', ' + plural(mo, 'month') : ''} ago`;
  }

  const show = d => `${d.d} ${MONTHS[d.m - 1][0].toUpperCase()}${MONTHS[d.m - 1].slice(1)} ${d.y}` + (d.time ? `, ${d.time}` + (d.tz ? ` ${d.tz}` : ' (no time zone given)') : '');
  const showShort = d => `${d.d} ${SHORT[d.m - 1]} ${d.y}` + (d.time ? ` ${d.time}` + (d.tz ? ` ${d.tz}` : '') : '');

  function analyze(raw, now) {
    now = now == null ? Date.now() : now;
    const { list, errors, unreadable } = candidates(raw);
    const pub = pick(list.filter(c => c.kind === 'published')) || pick(list.filter(c => c.kind === 'created'));
    const mod = pick(list.filter(c => c.kind === 'modified'));
    const unknown = !pub ? pick(list.filter(c => c.kind === 'unknown')) : null;
    const notes = [];
    const n = new Date(now), todayNum = Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) / 86400000;
    const strongPub = list.filter(c => c.kind === 'published' && c.weight >= 3 && !c.side);
    const pubDays = [...new Set(strongPub.map(c => c.date.day))].sort();
    if (pubDays.length > 1 && dayNum(parseDate(pubDays[pubDays.length - 1])) - dayNum(parseDate(pubDays[0])) > 1) {
      const desc = pubDays.map(d => { const srcs = [...new Set(strongPub.filter(c => c.date.day === d).map(c => SOURCE_LABEL[c.source]))]; return `${showShort(parseDate(d))} (${srcs.join(', ')})`; });
      notes.push({ level: 'warn', code: 'conflict', msg: `Sources disagree on the published date: ${desc.join(' vs ')}.` });
    }
    if (pub && mod && dayNum(mod.date) < dayNum(pub.date)) notes.push({ level: 'warn', code: 'order', msg: `The updated date (${showShort(mod.date)}) is earlier than the published date (${showShort(pub.date)}).` });
    const future = list.filter(c => !c.side && dayNum(c.date) > todayNum + 1);
    if (future.length) notes.push({ level: 'warn', code: 'future', msg: `${plural(future.length, 'date')} in the future: ${[...new Set(future.map(c => showShort(c.date)))].join(', ')} (${[...new Set(future.map(c => SOURCE_LABEL[c.source]))].join(', ')}).` });
    if (pub && pub.sources.length === 1 && pub.sources[0] === 'url') notes.push({ level: 'info', code: 'urlonly', msg: 'Only the page address suggests a date; the page itself does not state one.' });
    if (pub && mod && mod.date.day === pub.date.day) notes.push({ level: 'info', code: 'same', msg: 'Updated on the same day it was published.' });
    if (!pub && !mod && unknown) notes.push({ level: 'info', code: 'unlabelled', msg: 'Dates were found, but none says whether it is the published or updated date.' });
    if ([pub, mod].some(x => x && x.date.time && !x.date.tz)) notes.push({ level: 'info', code: 'notz', msg: 'A time is given without a time zone, so it is shown as written.' });
    if (list.some(c => c.side)) notes.push({ level: 'info', code: 'side', msg: 'Dates on comments, reviews, images or sidebars are listed but not used for the page date.' });
    if (unreadable) notes.push({ level: 'info', code: 'unreadable', msg: `${plural(unreadable, 'date')} ${unreadable === 1 ? 'was' : 'were'} skipped because day and month can't be told apart (03/04/2026 could be 3 April or March 4).` });
    for (const e of [...new Set(errors)]) notes.push({ level: 'info', code: 'ldError', msg: e + '.' });
    if (!list.length) notes.push({ level: 'warn', code: 'none', msg: 'No publish or update date found in the page\'s tags, structured data, visible text or address.' });
    if (raw && raw.truncated) notes.push({ level: 'info', code: 'truncated', msg: 'This page has a very large number of tags; only the first ones were read.' });
    return {
      url: (raw && raw.url) || '', title: (raw && raw.title) || '', published: pub, modified: mod, unlabelled: unknown,
      evidence: list.slice().sort((a, b) => (b.side ? -1 : 0) - (a.side ? -1 : 0) || b.weight - a.weight),
      notes, unreadable, ageOf: d => age(d, now), now,
    };
  }

  function summary(a) {
    if (!a.evidence.length) return 'No dates found on this page.';
    const parts = [];
    if (a.published) parts.push(`Published ${showShort(a.published.date)}`);
    if (a.modified) parts.push(`updated ${showShort(a.modified.date)}`);
    if (!parts.length) return `${plural(a.evidence.length, 'date')} found, none labelled published or updated.`;
    return parts.join(', ') + ` (${plural(a.evidence.length, 'piece')} of evidence).`;
  }
  const evidenceLine = c => `${KIND_LABEL[c.kind]} · ${c.date.day}${c.date.time ? ' ' + c.date.time + (c.date.tz ? ' ' + c.date.tz : '') : ''} · ${c.label}${c.side ? ' (not used)' : ''}`;
  const whereLine = p => `from ${p.sources.map(s => SOURCE_LABEL[s]).join(', ')}`;

  function report(a) {
    const L = [`Publish dates for: ${a.title || '(untitled page)'}`, a.url, ''];
    const line = (label, p) => L.push(`${label}: ${p ? `${show(p.date)} · ${age(p.date, a.now)} · ${whereLine(p)}` : 'not found'}`);
    line('Published', a.published);
    line('Last updated', a.modified);
    if (a.unlabelled) L.push(`Unlabelled date: ${show(a.unlabelled.date)} · ${whereLine(a.unlabelled)}`);
    const n = new Date(a.now);
    L.push(`Checked: ${n.getDate()} ${SHORT[n.getMonth()]} ${n.getFullYear()} with Publish Date Finder`, '');
    L.push(`Evidence (${a.evidence.length}):`);
    for (const c of a.evidence) L.push('- ' + evidenceLine(c));
    if (a.notes.length) { L.push('', 'Notes:'); for (const x of a.notes) L.push('- ' + x.msg); }
    return L.join('\n');
  }

  const api = { MONTHS, KIND_LABEL, SOURCE_LABEL, parseDate, kindOfKey, candidates, pick, age, show, showShort, analyze, summary, evidenceLine, whereLine, report };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PublishDateCore = api;
})(typeof self !== 'undefined' ? self : globalThis);
