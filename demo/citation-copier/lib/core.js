// Citation Copier core: pure logic, no chrome.* and no DOM. Loads in the popup (<script>) and in Node tests (require).
// normalize(raw) turns what content/extract.js read from the page (meta tags, JSON-LD, canonical, <title>, <h1>) into one
// metadata record, remembering where each field came from. cite(meta, style) formats it as APA 7, MLA 9 or Chicago
// (notes-bibliography, bibliography entry) as text segments (some italic), plus plain text and HTML for the clipboard.
// Missing data is never invented: no author -> the title leads; no date -> "n.d." / the access date.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CitationCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STYLES = { apa: 'APA 7th edition', mla: 'MLA 9th edition', chicago: 'Chicago (bibliography entry)' };
  const DEFAULTS = { style: 'apa', accessDate: false };
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const MLA_MONTHS = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'];
  const TRACKING = /^(utm_[a-z_]+|fbclid|gclid|gclsrc|dclid|msclkid|yclid|mc_cid|mc_eid|_ga|_gl|igshid|ref_src|spm)$/i;
  const PARTICLES = new Set(['van', 'von', 'de', 'der', 'den', 'del', 'della', 'di', 'da', 'du', 'la', 'le', 'dos', 'das', 'ter', 'ten', 'bin', 'al']);
  const ORG_WORDS = /\b(team|staff|editors?|editorial|newsroom|desk|inc|ltd|llc|plc|gmbh|co|company|corporation|corp|bakery|university|college|school|institute|institution|association|society|foundation|council|committee|agency|department|ministry|office|government|organi[sz]ation|group|press|news|journal|magazine|times|post|lab|labs|library|museum|centre|center|trust|network|board|bureau|service|services|club|union|partners)\b/i;
  const ARTICLE_TYPES = { scholarlyarticle: 6, medicalscholarlyarticle: 6, newsarticle: 5, article: 5, blogposting: 5, techarticle: 5, report: 5, analysisnewsarticle: 5, opinionnewsarticle: 5, reportagenewsarticle: 5, reviewnewsarticle: 5, backgroundnewsarticle: 5, socialmediaposting: 4, posting: 4, recipe: 3, howto: 3, creativework: 3, webpage: 2, itempage: 2, aboutpage: 2, faqpage: 2, collectionpage: 2, qapage: 2, profilepage: 2 };

  const clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const isUrl = s => /^(https?:)?\/\/|^www\./i.test(s);
  const pad = n => String(n).padStart(2, '0');

  // ---------- dates ----------
  function monthIndex(word) {
    let w = String(word).toLowerCase().replace(/\.$/, '');
    if (w === 'sept') w = 'sep';
    if (w.length < 3) return -1;
    return MONTHS.findIndex(m => m.toLowerCase().startsWith(w));
  }
  function valid(y, m, d) {
    if (!(y >= 1000 && y <= 2999)) return null;
    if (m == null) return { y };
    if (!(m >= 1 && m <= 12)) return null;
    if (d == null) return { y, m };
    const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return d >= 1 && d <= dim ? { y, m, d } : null;
  }
  // Reads the calendar date as written (no time-zone shift): 2026-10-20T23:30:00-05:00 is 20 October.
  function parseDate(s) {
    s = clean(s);
    if (!s) return null;
    let m = s.match(/^(\d{4})(?:[-/.](\d{1,2})(?:[-/.](\d{1,2}))?)?(?:[T\s].*)?$/);
    if (m) return valid(+m[1], m[2] ? +m[2] : null, m[3] ? +m[3] : null);
    m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m) return valid(+m[1], +m[2], +m[3]);
    m = s.match(/^(?:[A-Za-z]+,?\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\.?,?\s+(\d{4})\b/);
    if (m && monthIndex(m[2]) >= 0) return valid(+m[3], monthIndex(m[2]) + 1, +m[1]);
    m = s.match(/^(?:[A-Za-z]+,?\s+)?([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/);
    if (m && monthIndex(m[1]) >= 0) return valid(+m[3], monthIndex(m[1]) + 1, +m[2]);
    m = s.match(/^([A-Za-z]+)\.?,?\s+(\d{4})$/);
    if (m && monthIndex(m[1]) >= 0) return valid(+m[2], monthIndex(m[1]) + 1, null);
    return null;
  }
  const dateToField = d => !d ? '' : d.y + (d.m ? '-' + pad(d.m) : '') + (d.d ? '-' + pad(d.d) : '');
  const today = (now = new Date()) => ({ y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() });
  const apaDate = d => !d ? 'n.d.' : [d.y, d.m && (MONTHS[d.m - 1] + (d.d ? ' ' + d.d : ''))].filter(Boolean).join(', ');
  const longDate = d => d.m ? `${MONTHS[d.m - 1]} ${d.d ? d.d + ', ' : ''}${d.y}` : String(d.y);
  const mlaDate = d => [d.d, d.m && MLA_MONTHS[d.m - 1], d.y].filter(Boolean).join(' ');

  // ---------- names ----------
  // "Jane Doe", "Doe, Jane", "Ludwig van Beethoven" -> { given, family }; organisations and one-word names -> { literal }.
  function parseName(input, opts = {}) {
    let s = clean(input).replace(/^by\s+/i, '').replace(/^=\s*/, m => { opts = { ...opts, literal: true }; return ''; });
    if (!s || s.length > 150 || isUrl(s) || /^@\w/.test(s) || /^[\d\W]+$/.test(s)) return null;
    if (opts.literal || opts.org) return { literal: s };
    if (/,/.test(s)) {
      const [family, ...rest] = s.split(',').map(clean);
      const given = rest.filter(Boolean).join(' ');
      if (family && given && !ORG_WORDS.test(s)) return { given, family };
    }
    if (ORG_WORDS.test(s)) return { literal: s };
    const words = s.split(' ');
    if (words.length === 1) return { literal: s };
    let i = words.length - 1;
    while (i > 1 && PARTICLES.has(words[i - 1].toLowerCase())) i--;
    return { given: words.slice(0, i).join(' '), family: words.slice(i).join(' ') };
  }
  // Splits one author string that may hold several names: "A; B", "A and B", "A & B", "Jane Doe, John Roe".
  function splitAuthors(s) {
    s = clean(s);
    if (!s || isUrl(s)) return [];
    const parts = s.split(/\s*(?:;|\||\s+and\s+|\s+&\s+)\s*/i).map(clean).filter(Boolean);
    const out = [];
    for (const p of parts) {
      const commas = p.split(',').map(clean).filter(Boolean);
      if (commas.length > 1 && commas.every(c => c.split(' ').length > 1) && !ORG_WORDS.test(p)) out.push(...commas);
      else out.push(p);
    }
    return out;
  }
  const initials = given => clean(given).split(' ').filter(Boolean).map(w =>
    /^[A-Z]\.?$/i.test(w) ? w[0].toUpperCase() + '.' : w.split('-').map(x => x ? x[0].toUpperCase() + '.' : '').join('-')).join(' ');
  const sameName = (a, b) => !!a && !!b && clean(a).toLowerCase() === clean(b).toLowerCase();
  const fullName = a => a.literal || `${a.given} ${a.family}`;
  const invName = a => a.literal || `${a.family}, ${a.given}`;
  function dedupeAuthors(list) {
    const seen = new Set(), out = [];
    for (const a of list) { if (!a) continue; const k = fullName(a).toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(a); } }
    return out;
  }

  // ---------- URLs, DOI ----------
  function cleanUrl(u) {
    let url;
    try { url = new URL(u); } catch (e) { return clean(u); }
    url.hash = '';
    for (const k of [...url.searchParams.keys()]) if (TRACKING.test(k)) url.searchParams.delete(k);
    return url.href.replace(/\?$/, '');
  }
  function normDoi(s) {
    const m = clean(s).match(/10\.\d{4,9}\/[^\s"<>]+/);
    return m ? m[0].replace(/[.,;]+$/, '') : '';
  }
  const doiUrl = doi => 'https://doi.org/' + doi;
  function host(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }

  // ---------- JSON-LD ----------
  function readJsonLd(blocks) {
    const nodes = [];
    let invalid = 0;
    const add = x => {
      if (Array.isArray(x)) return x.forEach(add);
      if (!x || typeof x !== 'object') return;
      nodes.push(x);
      if (x['@graph']) add(x['@graph']);
    };
    for (const b of blocks || []) {
      try { add(JSON.parse(String(b).replace(/^\s*<!--|-->\s*$/g, ''))); } catch (e) { invalid++; }
    }
    const byId = new Map(nodes.filter(n => n['@id']).map(n => [n['@id'], n]));
    const deref = x => (x && typeof x === 'object' && x['@id'] && byId.has(x['@id']) && Object.keys(x).length === 1) ? byId.get(x['@id']) : x;
    const types = n => [].concat(n['@type'] || []).map(t => String(t).replace(/^.*[/#:]/, '').toLowerCase());
    let best = null, score = 0;
    for (const n of nodes) {
      const s = Math.max(0, ...types(n).map(t => ARTICLE_TYPES[t] || 0));
      if (s > score) { score = s; best = n; }
    }
    const site = nodes.find(n => types(n).includes('website'));
    const nameOf = x => { x = deref(x); if (Array.isArray(x)) x = deref(x[0]); return x && typeof x === 'object' ? clean(x.name || '') : clean(x || ''); };
    const out = { invalid };
    if (site) out.siteName = nameOf(site);
    if (!best) return out;
    out.type = types(best)[0];
    out.title = clean(best.headline || best.name || '');
    out.date = clean(best.datePublished || best.dateCreated || '');
    out.url = clean(typeof best.url === 'string' ? best.url : '');
    const pub = nameOf(best.publisher);
    if (pub) out.publisher = pub;
    const part = deref(best.isPartOf);
    if (part && typeof part === 'object') {
      const pt = types(part);
      if (pt.some(t => /periodical|publicationvolume|publicationissue/.test(t))) out.journal = nameOf(part);
      else if (!out.siteName && pt.includes('website')) out.siteName = nameOf(part);
    }
    const ids = [].concat(best.identifier || [], best.sameAs || [], best.doi || []).map(x => typeof x === 'object' ? (x.value || x['@id'] || '') : x);
    out.doi = ids.map(normDoi).find(Boolean) || '';
    out.authors = [];
    for (let a of [].concat(best.author || best.creator || [])) {
      a = deref(a);
      if (typeof a === 'string') { out.authors.push(...splitAuthors(a).map(x => parseName(x))); continue; }
      if (!a || typeof a !== 'object') continue;
      const isOrg = types(a).some(t => /organization|corporation|newsmediaorganization|educationalorganization|governmentorganization/.test(t));
      if (!isOrg && a.familyName && a.givenName) out.authors.push({ given: clean(a.givenName), family: clean(a.familyName) });
      else if (a.name) out.authors.push(parseName(Array.isArray(a.name) ? a.name[0] : a.name, { org: isOrg }));
    }
    out.authors = dedupeAuthors(out.authors);
    return out;
  }

  // ---------- normalise ----------
  function stripSiteFromTitle(title, siteNames) {
    const parts = title.split(/\s+[|\-–—·:]{1,2}\s+/);
    if (parts.length < 2) return title;
    const last = parts[parts.length - 1].toLowerCase(), first = parts[0].toLowerCase();
    const match = x => siteNames.some(s => s && (s.toLowerCase() === x || s.toLowerCase().includes(x) || x.includes(s.toLowerCase())));
    if (match(last)) return title.slice(0, title.length - parts[parts.length - 1].length).replace(/\s+[|\-–—·:]{1,2}\s*$/, '');
    if (match(first)) return title.slice(parts[0].length).replace(/^\s*[|\-–—·:]{1,2}\s+/, '');
    return title;
  }

  function normalize(raw, opts = {}) {
    raw = raw || {};
    const mm = new Map();
    for (const [k, v] of raw.metas || []) { const key = String(k).toLowerCase(); if (!mm.has(key)) mm.set(key, []); mm.get(key).push(clean(v)); }
    const pick = keys => { for (const k of keys) { const v = (mm.get(k) || []).find(Boolean); if (v) return { value: v, from: k }; } return null; };
    const ld = readJsonLd(raw.jsonld);
    const src = {};
    const take = (field, cands) => { for (const c of cands) if (c && c.value) { src[field] = c.from; return c.value; } return ''; };
    const L = (value, what) => ({ value, from: 'JSON-LD ' + what });

    // URL
    const httpish = u => /^https?:\/\//i.test(u || '');
    const url = cleanUrl(take('url', [
      httpish(raw.canonical) && { value: raw.canonical, from: 'canonical link' },
      httpish((pick(['og:url']) || {}).value) && pick(['og:url']),
      { value: raw.url || '', from: 'page address' },
    ]));
    const hostname = host(url);

    const journal = take('journal', [pick(['citation_journal_title', 'prism.publicationname', 'citation_conference_title']), L(ld.journal, 'isPartOf')]);
    const siteName = take('site', [
      pick(['og:site_name']), L(ld.siteName, 'WebSite'), L(ld.publisher, 'publisher'),
      pick(['dc.publisher', 'dcterms.publisher', 'citation_publisher', 'application-name', 'apple-mobile-web-app-title']),
      { value: hostname, from: 'web address' },
    ]);
    const siteNames = [siteName, ld.siteName, ld.publisher, (pick(['og:site_name']) || {}).value, hostname].filter(Boolean);

    const rawTitle = clean(raw.title);
    const title = take('title', [
      pick(['citation_title', 'dc.title', 'dcterms.title']), L(ld.title, 'headline'), pick(['og:title', 'twitter:title']),
      rawTitle && { value: stripSiteFromTitle(rawTitle, siteNames), from: 'page title' },
      raw.h1 && { value: clean(raw.h1), from: 'first heading' },
    ]);

    // Authors
    let authors = [];
    const multi = keys => { for (const k of keys) { const vs = (mm.get(k) || []).filter(Boolean); if (vs.length) return { vs, from: k }; } return null; };
    const cit = multi(['citation_author']) || (pick(['citation_authors']) && { vs: [pick(['citation_authors']).value], from: 'citation_authors' });
    const dc = multi(['dc.creator', 'dcterms.creator', 'dc.contributor']);
    const generic = multi(['author', 'article:author', 'parsely-author', 'sailthru.author', 'byl']);
    if (cit) { authors = cit.vs.flatMap(v => cit.from === 'citation_authors' ? splitAuthors(v) : [v]).map(v => parseName(v)); src.authors = cit.from; }
    else if (ld.authors && ld.authors.length) { authors = ld.authors; src.authors = 'JSON-LD author'; }
    else if (dc) { authors = dc.vs.map(v => parseName(v)); src.authors = dc.from; }
    else if (generic) { authors = generic.vs.flatMap(splitAuthors).map(v => parseName(v)); src.authors = generic.from; }
    authors = dedupeAuthors(authors);
    if (!authors.length) delete src.authors;

    // Date
    const dateCands = [
      pick(['citation_publication_date', 'citation_date', 'citation_online_date', 'citation_cover_date', 'prism.publicationdate']),
      L(ld.date, 'datePublished'),
      pick(['dcterms.issued', 'dc.date.issued', 'dcterms.date', 'dc.date', 'dcterms.created', 'dc.date.created']),
      pick(['article:published_time', 'og:published_time', 'date', 'pubdate', 'publishdate', 'publish_date', 'publication_date', 'parsely-pub-date', 'sailthru.date', 'dc.date.published']),
    ];
    let date = null;
    for (const c of dateCands) { if (c && c.value) { const d = parseDate(c.value); if (d) { date = d; src.date = c.from; break; } } }

    const doi = normDoi(take('doi', [pick(['citation_doi', 'prism.doi', 'dc.identifier', 'dcterms.identifier', 'bepress_citation_doi']), L(ld.doi, 'identifier')]));
    if (!doi) delete src.doi;
    const first = (pick(['citation_firstpage', 'prism.startingpage']) || {}).value || '';
    const last = (pick(['citation_lastpage', 'prism.endingpage']) || {}).value || '';
    const meta = {
      kind: journal ? 'journal' : 'web',
      title, authors, date, siteName, journal, url, doi,
      volume: (pick(['citation_volume', 'prism.volume']) || {}).value || '',
      issue: (pick(['citation_issue', 'prism.number', 'prism.issueidentifier']) || {}).value || '',
      pages: first && last && first !== last ? `${first}–${last}` : first,
      accessed: opts.accessed || today(opts.now),
      sources: src,
      invalidJsonLd: ld.invalid,
    };
    return meta;
  }

  // ---------- editing ----------
  function toFields(meta) {
    return {
      authors: meta.authors.map(a => a.literal ? '=' + a.literal : fullName(a)).join('\n'),
      title: meta.title, site: meta.kind === 'journal' ? meta.journal : meta.siteName,
      date: dateToField(meta.date), url: meta.doi ? doiUrl(meta.doi) : meta.url,
    };
  }
  // Returns a copy of meta with the user's edits applied (fields left unchanged keep their original source).
  function applyFields(meta, f) {
    const orig = toFields(meta), next = { ...meta, sources: { ...meta.sources } };
    const edited = k => f[k] != null && clean(f[k]) !== clean(orig[k]);
    if (edited('authors')) { next.authors = dedupeAuthors(String(f.authors).split(/\r?\n/).map(x => parseName(x))); next.sources.authors = 'you'; }
    if (edited('title')) { next.title = clean(f.title); next.sources.title = 'you'; }
    if (edited('site')) { next[meta.kind === 'journal' ? 'journal' : 'siteName'] = clean(f.site); next.sources[meta.kind === 'journal' ? 'journal' : 'site'] = 'you'; }
    if (edited('date')) { next.date = parseDate(f.date); next.sources.date = 'you'; next.dateUnreadable = !!clean(f.date) && !next.date; }
    if (edited('url')) {
      const d = normDoi(f.url);
      if (d && /doi/i.test(f.url)) { next.doi = d; } else { next.doi = ''; next.url = clean(f.url); }
      next.sources.url = 'you';
    }
    if (!next.authors.length) delete next.sources.authors;
    return next;
  }

  // ---------- notes shown under the citation ----------
  function notes(meta) {
    const out = [], s = meta.sources || {};
    if (!meta.title) out.push({ level: 'bad', msg: 'No title found. Type one in "Edit details".' });
    else if (s.title === 'page title' || s.title === 'first heading') out.push({ level: 'warn', msg: `Title taken from the ${s.title}: check it doesn't include extra words.` });
    if (!meta.authors.length) out.push({ level: 'warn', msg: 'No author found, so the citation starts with the title. Add one in "Edit details" if the page names a person or organisation.' });
    if (meta.dateUnreadable) out.push({ level: 'bad', msg: 'Date not recognised. Use a form like 2026-10-20, 2026-10 or 2026.' });
    else if (!meta.date) out.push({ level: 'warn', msg: 'No publication date found: APA uses (n.d.) with a retrieval date; MLA and Chicago add the date you accessed it.' });
    if (meta.kind === 'web' && s.site === 'web address') out.push({ level: 'warn', msg: 'No site name found, so the domain is used. Edit it if the site has a proper name.' });
    if (meta.invalidJsonLd) out.push({ level: 'muted', msg: `${meta.invalidJsonLd} structured-data block${meta.invalidJsonLd > 1 ? 's' : ''} couldn't be read (invalid JSON) and ${meta.invalidJsonLd > 1 ? 'were' : 'was'} skipped.` });
    out.push({ level: 'muted', msg: 'Titles are kept exactly as the page writes them. APA uses sentence case, MLA and Chicago title case: adjust capitals if needed.' });
    return out;
  }
  const FIELD_LABEL = { authors: 'author', title: 'title', date: 'date', site: 'site', journal: 'journal', doi: 'DOI', url: 'address' };
  function sourceSummary(meta) {
    const s = meta.sources || {};
    return Object.keys(FIELD_LABEL).filter(k => s[k]).map(k => `${FIELD_LABEL[k]}: ${s[k]}`).join(' · ');
  }

  // ---------- formatting ----------
  const end = (s, p = '.') => /[.?!]$/.test(s) ? s : s + p;
  const quoted = t => { t = t.replace(/"([^"]*)"/g, '‘$1’').replace(/[“”]([^“”]*)[“”]/g, '‘$1’'); return `“${end(t)}”`; };
  function apaAuthors(list) {
    const one = a => a.literal || `${a.family}, ${initials(a.given)}`;
    const n = list.map(one);
    if (n.length === 1) return n[0];
    if (n.length === 2) return `${n[0]}, & ${n[1]}`;
    if (n.length <= 20) return `${n.slice(0, -1).join(', ')}, & ${n[n.length - 1]}`;
    return `${n.slice(0, 19).join(', ')}, . . . ${n[n.length - 1]}`;
  }
  function mlaAuthors(list) {
    if (list.length === 1) return invName(list[0]);
    if (list.length === 2) return `${invName(list[0])}, and ${fullName(list[1])}`;
    return `${invName(list[0])}, et al`;
  }
  function chicagoAuthors(list) {
    if (list.length > 10) return `${[invName(list[0]), ...list.slice(1, 7).map(fullName)].join(', ')}, et al`;
    if (list.length === 1) return invName(list[0]);
    if (list.length === 2) return `${invName(list[0])}, and ${fullName(list[1])}`;
    return `${[invName(list[0]), ...list.slice(1, -1).map(fullName)].join(', ')}, and ${fullName(list[list.length - 1])}`;
  }
  const link = meta => meta.doi ? doiUrl(meta.doi) : meta.url;

  // Returns [{ text, italic? }] segments.
  function segments(meta, style, opt = {}) {
    const S = [], t = (text, italic) => { if (text) S.push(italic ? { text, italic: true } : { text }); };
    const A = meta.authors || [], title = clean(meta.title) || 'Untitled page', d = meta.date, acc = meta.accessed;
    const journal = meta.kind === 'journal' && meta.journal;
    const site = clean(meta.siteName);
    const siteIsAuthor = A.length === 1 && sameName(A[0].literal, site);
    if (style === 'apa') {
      const date = `(${journal ? (d ? d.y : 'n.d.') : apaDate(d)}).`;
      if (A.length) t(`${end(apaAuthors(A))} ${date} `);
      if (journal) {
        t(A.length ? `${end(title)} ` : `${end(title)} ${date} `);
        t(meta.journal, true);
        if (meta.volume) { t(', '); t(meta.volume, true); }
        if (meta.issue) t(`(${meta.issue})`);
        if (meta.pages) t(`, ${meta.pages}`);
        t('. ');
      } else {
        if (A.length) { t(title, true); t(/[.?!]$/.test(title) ? ' ' : '. '); }
        else { t(title, true); t(`${/[.?!]$/.test(title) ? '' : '.'} ${date} `); }
        if (site && !siteIsAuthor) t(`${end(site)} `);
      }
      if (!d || opt.accessDate) t(`Retrieved ${longDate(acc)}, from ${link(meta)}`);
      else t(link(meta));
    } else if (style === 'mla') {
      // MLA 9: an organisation that is both author and site is given once, as the site (the entry starts with the title).
      if (A.length && !(siteIsAuthor && !journal)) t(`${end(mlaAuthors(A))} `);
      t(`${quoted(title)} `);
      const plainUrl = meta.doi ? doiUrl(meta.doi) : meta.url.replace(/^https?:\/\//i, '');
      if (journal) {
        t(meta.journal, true);
        const bits = [meta.volume && `vol. ${meta.volume}`, meta.issue && `no. ${meta.issue}`, d && mlaDate(d), meta.pages && `${/[–-]/.test(meta.pages) ? 'pp.' : 'p.'} ${meta.pages}`, plainUrl].filter(Boolean);
        t(`, ${bits.join(', ')}.`);
      } else {
        if (site) { t(site, true); t(', '); }
        t(`${d ? mlaDate(d) + ', ' : ''}${end(plainUrl)}`);
      }
      if (!d || opt.accessDate) t(` Accessed ${mlaDate(acc)}.`);
    } else if (style === 'chicago') {
      if (A.length) t(`${end(chicagoAuthors(A))} `);
      t(`${quoted(title)} `);
      if (journal) {
        t(meta.journal, true);
        t(`${meta.volume ? ' ' + meta.volume : ''}${meta.issue ? ', no. ' + meta.issue : ''}${d ? ` (${d.m ? MONTHS[d.m - 1] + ' ' : ''}${d.y})` : ''}${meta.pages ? ': ' + meta.pages : ''}. `);
      } else {
        if (site && !siteIsAuthor) t(`${end(site)} `);
        if (d) t(`${longDate(d)}. `);
      }
      if (!d || opt.accessDate) t(`Accessed ${longDate(acc)}. `);
      t(end(link(meta)));
    } else throw new Error('unknown style ' + style);
    return S;
  }
  const escapeHtml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function cite(meta, style, opt) {
    const seg = segments(meta, style, opt);
    return {
      segments: seg,
      text: seg.map(s => s.text).join('').trim(),
      html: seg.map(s => s.italic ? `<i>${escapeHtml(s.text)}</i>` : escapeHtml(s.text)).join('').trim(),
    };
  }
  function normalizeOptions(o) {
    o = o || {};
    return { style: Object.prototype.hasOwnProperty.call(STYLES, o.style) ? o.style : DEFAULTS.style, accessDate: o.accessDate === true };
  }

  return { STYLES, DEFAULTS, parseDate, parseName, splitAuthors, initials, cleanUrl, normDoi, readJsonLd, stripSiteFromTitle,
    normalize, toFields, applyFields, notes, sourceSummary, cite, segments, normalizeOptions, dateToField, today };
});
