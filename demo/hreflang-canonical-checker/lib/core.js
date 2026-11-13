// Hreflang & Canonical Checker: pure analysis logic.
// No chrome.* and no DOM: loaded by the popup via <script> and by Node tests via require().
//
// Rules follow Google Search Central guidance on rel="canonical" and hreflang
// (fully-qualified URLs, ISO 639-1 language + optional ISO 15924 script + ISO 3166-1 alpha-2 region,
// x-default, self-reference, tags only in <head>). This is an on-page helper, not an official validator.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Core = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ISO 639-1 languages, ISO 3166-1 alpha-2 regions, ISO 15924 scripts (from Debian iso-codes).
  const LANGS = new Set('aa ab ae af ak am an ar as av ay az ba be bg bh bi bm bn bo br bs ca ce ch co cr cs cu cv cy da de dv dz ee el en eo es et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht hu hy hz ia id ie ig ii ik io is it iu ja jv ka kg ki kj kk kl km kn ko kr ks ku kv kw ky la lb lg li ln lo lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ny oc oj om or os pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk sl sm sn so sq sr ss st su sv sw ta te tg th ti tk tl tn to tr ts tt tw ty ug uk ur uz ve vi vo wa wo xh yi yo za zh zu'.split(' '));
  const REGIONS = new Set('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' '));
  const SCRIPTS = new Set('Adlm Afak Aghb Ahom Arab Aran Armi Armn Avst Bali Bamu Bass Batk Beng Bhks Blis Bopo Brah Brai Bugi Buhd Cakm Cans Cari Cham Cher Cirt Copt Cprt Cyrl Cyrs Deva Dsrt Dupl Egyd Egyh Egyp Elba Ethi Geok Geor Glag Goth Gran Grek Gujr Guru Hanb Hang Hani Hano Hans Hant Hatr Hebr Hira Hluw Hmng Hrkt Hung Inds Ital Jamo Java Jpan Jurc Kali Kana Khar Khmr Khoj Kitl Kits Knda Kore Kpel Kthi Lana Laoo Latf Latg Latn Leke Lepc Limb Lina Linb Lisu Loma Lyci Lydi Mahj Mand Mani Marc Maya Mend Merc Mero Mlym Modi Mong Moon Mroo Mtei Mult Mymr Narb Nbat Newa Nkgb Nkoo Nshu Ogam Olck Orkh Orya Osge Osma Palm Pauc Perm Phag Phli Phlp Phlv Phnx Piqd Plrd Prti Qaaa Qabx Rjng Roro Runr Samr Sara Sarb Saur Sgnw Shaw Shrd Sidd Sind Sinh Sora Sund Sylo Syrc Syre Syrj Syrn Tagb Takr Tale Talu Taml Tang Tavt Telu Teng Tfng Tglg Thaa Thai Tibt Tirh Ugar Vaii Visp Wara Wole Xpeo Xsux Yiii Zinh Zmth Zsye Zsym Zxxx Zyyy Zzzz'.split(' '));
  // Common mistakes -> what was probably meant.
  const REGION_HINTS = { UK: 'GB', EN: null, EU: null, LA: null };
  const LANG_HINTS = { iw: 'he', in: 'id', ji: 'yi', jp: 'ja', cn: 'zh', gr: 'el', dk: 'da', se: 'sv', cz: 'cs', kr: 'ko', ua: 'uk', br: 'pt' };

  // ---- helpers -----------------------------------------------------------
  function parseUrl(s, base) {
    try { return new URL(s, base); } catch { return null; }
  }
  function isAbsolute(raw) { return /^https?:\/\//i.test(String(raw || '').trim()); }
  // Comparable form: protocol + lowercase host (default port dropped) + path + query. Fragment ignored.
  function norm(u) {
    if (!u) return '';
    const x = u instanceof URL ? u : parseUrl(u);
    if (!x) return String(u);
    return `${x.protocol}//${x.host.toLowerCase()}${x.pathname}${x.search}`;
  }
  function sameUrl(a, b) { return !!a && !!b && norm(a) === norm(b); }
  // Explain how two URLs differ, for "almost the same" cases.
  function diffHint(a, b) {
    const x = parseUrl(a), y = parseUrl(b);
    if (!x || !y) return '';
    if (x.protocol !== y.protocol && x.host === y.host && x.pathname === y.pathname && x.search === y.search) return 'only the protocol differs (http vs https)';
    if (x.host.replace(/^www\./, '') === y.host.replace(/^www\./, '') && x.host !== y.host && x.pathname === y.pathname) return 'only "www." differs';
    if (x.host === y.host && x.search === y.search && x.pathname.replace(/\/$/, '') === y.pathname.replace(/\/$/, '') && x.pathname !== y.pathname) return 'only the trailing slash differs';
    if (x.host === y.host && x.pathname === y.pathname && x.search !== y.search) return 'only the query string differs';
    if (x.host === y.host && x.pathname.toLowerCase() === y.pathname.toLowerCase() && x.pathname !== y.pathname) return 'only letter case in the path differs';
    return '';
  }

  /**
   * Validate one hreflang value.
   * @returns {{ok:boolean, level?:'error'|'warn', msg?:string, fix?:string, lang?:string, region?:string, key:string}}
   */
  function checkCode(raw) {
    const v = String(raw == null ? '' : raw).trim();
    const key = v.toLowerCase();
    if (!v) return { ok: false, level: 'error', key, msg: 'Empty hreflang value.', fix: 'Use a language code such as "en", "en-GB" or "x-default".' };
    if (key === 'x-default') return { ok: true, key, lang: 'x-default' };
    if (v.includes('_')) {
      const s = v.replace(/_/g, '-');
      return { ok: false, level: 'error', key, msg: `"${v}" uses an underscore.`, fix: `Use a hyphen: "${s}".` };
    }
    const parts = v.split('-');
    const lang = parts[0].toLowerCase();
    let script = null, region = null;
    const rest = parts.slice(1);
    if (rest.length && /^[a-z]{4}$/i.test(rest[0])) script = rest.shift();
    if (rest.length) region = rest.shift();
    if (rest.length) return { ok: false, level: 'error', key, msg: `"${v}" has too many parts.`, fix: 'Use language[-Script][-REGION], for example "en-US" or "zh-Hant-TW".' };
    if (!LANGS.has(lang)) {
      if (REGIONS.has(lang.toUpperCase()) && !region) {
        const hint = LANG_HINTS[lang];
        return { ok: false, level: 'error', key, msg: `"${v}" looks like a country code used on its own; hreflang must start with a language.`, fix: hint ? `Did you mean "${hint}" (or "${hint}-${lang.toUpperCase()}")?` : `Add a language, for example "en-${lang.toUpperCase()}".` };
      }
      const hint = LANG_HINTS[lang];
      return { ok: false, level: 'error', key, msg: `"${lang}" is not an ISO 639-1 language code.`, fix: hint ? `Did you mean "${hint}"?` : 'Use a two-letter ISO 639-1 language code such as "en", "de" or "ja".' };
    }
    if (script) {
      const sc = script[0].toUpperCase() + script.slice(1).toLowerCase();
      if (!SCRIPTS.has(sc)) return { ok: false, level: 'error', key, msg: `"${script}" is not an ISO 15924 script code.`, fix: 'Use a script such as "Hans", "Hant", "Latn" or "Cyrl", or drop it.' };
    }
    if (region) {
      const R = region.toUpperCase();
      if (/^\d{3}$/.test(region)) return { ok: false, level: 'warn', key, msg: `"${v}" uses a numeric region (${region}).`, fix: 'Google asks for ISO 3166-1 alpha-2 country codes; list each country (e.g. "es-MX", "es-AR") or use the language alone ("es").' };
      if (!REGIONS.has(R)) {
        const hint = REGION_HINTS[R];
        return { ok: false, level: 'error', key, msg: `"${region}" is not an ISO 3166-1 alpha-2 country code.`, fix: hint ? `Did you mean "${lang}-${hint}"?` : 'Use a two-letter country code such as "US", "GB" or "IN", or use the language alone.' };
      }
      return { ok: true, key, lang, region: R };
    }
    return { ok: true, key, lang };
  }

  function robotsNoindex(list) {
    return (list || []).some(c => /(^|[\s,])(noindex|none)([\s,]|$)/i.test(String(c)));
  }

  /**
   * @param {{url:string, lang?:string, canonicals?:Array<{href:string,inHead?:boolean}>,
   *          alternates?:Array<{hreflang:string,href:string,inHead?:boolean}>, robots?:string[]}} data
   */
  function analyze(data) {
    const pageUrl = data.url || '';
    const issues = [];
    const add = (level, area, code, msg, fix) => issues.push({ level, area, code, msg, fix });

    // ---- canonical ------------------------------------------------------
    const canonicals = (data.canonicals || []).map(c => {
      const raw = String(c.href == null ? '' : c.href).trim();
      const u = raw ? parseUrl(raw, pageUrl) : null;
      return { raw, url: u && /^https?:$/.test(u.protocol) ? u.href : '', inHead: c.inHead !== false };
    });
    const headCanon = canonicals.filter(c => c.inHead);
    let canonical = null, canonicalStatus = 'missing';

    canonicals.filter(c => !c.inHead).forEach(c =>
      add('error', 'canonical', 'canonical-in-body', `rel="canonical" found in <body>: ${c.raw || '(empty)'}`, 'Google ignores canonical links outside <head>. Move it into <head> (check for markup that closes <head> early).'));

    if (!canonicals.length) {
      add('warn', 'canonical', 'canonical-missing', 'No rel="canonical" link on this page.', 'Add <link rel="canonical" href="…"> with the absolute URL you want indexed (it can point to the page itself). A canonical sent in the HTTP Link header is not visible to this check.');
    } else if (headCanon.length) {
      const distinct = [...new Set(headCanon.map(c => norm(c.url || c.raw)))];
      if (headCanon.length > 1) {
        if (distinct.length > 1) add('error', 'canonical', 'canonical-conflict', `${headCanon.length} canonical links point to different URLs: ${headCanon.map(c => c.raw).join(' | ')}`, 'Google may ignore all of them. Keep exactly one canonical link.');
        else add('warn', 'canonical', 'canonical-duplicate', `${headCanon.length} identical canonical links.`, 'Remove the duplicates; one canonical link is enough (often a theme and an SEO plugin both add one).');
      }
      const c = headCanon[0];
      canonical = c.url || null;
      if (!c.raw) add('error', 'canonical', 'canonical-empty', 'The canonical link has an empty href.', 'Set href to the absolute URL you want indexed.');
      else if (!c.url) add('error', 'canonical', 'canonical-invalid', `Canonical "${c.raw}" is not a valid http(s) URL.`, 'Use an absolute https:// URL.');
      else if (!isAbsolute(c.raw)) add('warn', 'canonical', 'canonical-relative', `Canonical is relative: "${c.raw}" (resolves to ${c.url}).`, 'Google supports relative canonicals but recommends absolute URLs, which avoid mistakes on staging, http/https and www variants.');
      if (canonical) {
        const page = parseUrl(pageUrl);
        if (page && page.protocol === 'https:' && canonical.startsWith('http:')) add('warn', 'canonical', 'canonical-http', `Canonical uses http:// on an https page: ${canonical}`, 'Point the canonical at the https URL.');
        if (parseUrl(canonical).hash) add('warn', 'canonical', 'canonical-fragment', `Canonical contains a #fragment: ${canonical}`, 'Fragments are ignored by search engines; remove it.');
        if (distinct.length > 1) canonicalStatus = 'conflict';
        else if (sameUrl(canonical, pageUrl)) canonicalStatus = 'self';
        else {
          canonicalStatus = 'other';
          const hint = diffHint(canonical, pageUrl);
          add(hint ? 'warn' : 'info', 'canonical', 'canonical-other', `Canonical points to a different URL: ${canonical}` + (hint ? ` (${hint}).` : '.'),
            hint ? 'Make sure this is intended. Near-identical canonicals usually mean an http/https, www, slash or parameter mismatch.' : 'This page asks search engines to index the other URL instead. Fine for duplicates or parameter URLs; a mistake if this page should rank.');
        }
      }
      if (robotsNoindex(data.robots) && canonical && canonicalStatus === 'other') {
        add('warn', 'canonical', 'noindex-canonical', 'Page is noindex and also canonicalised to another URL.', 'These are mixed signals. Use one: a canonical for duplicates, or noindex for pages that should not be indexed.');
      }
    } else {
      canonicalStatus = 'body-only';
    }

    // ---- hreflang -------------------------------------------------------
    const alternates = (data.alternates || []).map(a => {
      const raw = String(a.href == null ? '' : a.href).trim();
      const u = raw ? parseUrl(raw, pageUrl) : null;
      const code = checkCode(a.hreflang);
      return { hreflang: String(a.hreflang == null ? '' : a.hreflang).trim(), key: code.key, code, raw, url: u && /^https?:$/.test(u.protocol) ? u.href : '', inHead: a.inHead !== false, flags: [] };
    });

    alternates.forEach(a => {
      const label = a.hreflang || '(empty)';
      if (!a.inHead) { a.flags.push('in body'); add('error', 'hreflang', 'hreflang-in-body', `hreflang="${label}" link is in <body>.`, 'Google only reads hreflang links in <head>. Move it into <head>.'); }
      if (!a.code.ok) { a.flags.push('bad code'); add(a.code.level, 'hreflang', 'hreflang-code', `hreflang="${label}": ${a.code.msg}`, a.code.fix); }
      if (!a.raw) { a.flags.push('empty URL'); add('error', 'hreflang', 'hreflang-empty-url', `hreflang="${label}" has an empty href.`, 'Set href to the fully-qualified URL of that language version.'); }
      else if (!a.url) { a.flags.push('invalid URL'); add('error', 'hreflang', 'hreflang-invalid-url', `hreflang="${label}" href "${a.raw}" is not a valid http(s) URL.`, 'Use an absolute https:// URL.'); }
      else if (!isAbsolute(a.raw)) { a.flags.push('relative URL'); add('error', 'hreflang', 'hreflang-relative', `hreflang="${label}" uses a relative URL: "${a.raw}".`, `Google requires fully-qualified URLs. Use ${a.url}`); }
    });

    const valid = alternates.filter(a => a.url);
    let selfRef = null;
    if (alternates.length) {
      // duplicates (case-insensitive code)
      const byKey = new Map();
      valid.forEach(a => { if (a.key) byKey.set(a.key, [...(byKey.get(a.key) || []), a]); });
      for (const [key, list] of byKey) {
        if (list.length < 2) continue;
        const urls = [...new Set(list.map(a => norm(a.url)))];
        if (key === 'x-default') {
          if (urls.length > 1) { list.forEach(a => a.flags.push('duplicate')); add('error', 'hreflang', 'xdefault-multiple', `${list.length} x-default links point to different URLs.`, 'Keep exactly one x-default.'); }
          else add('warn', 'hreflang', 'hreflang-duplicate', `x-default is listed ${list.length} times with the same URL.`, 'Remove the repeated link.');
        } else if (urls.length > 1) {
          list.forEach(a => a.flags.push('duplicate'));
          add('error', 'hreflang', 'hreflang-conflict', `hreflang="${list[0].hreflang}" points to ${urls.length} different URLs: ${list.map(a => a.url).join(' | ')}`, 'Each language/region code must map to one URL. Remove or fix the extra entries.');
        } else add('warn', 'hreflang', 'hreflang-duplicate', `hreflang="${list[0].hreflang}" is listed ${list.length} times with the same URL.`, 'Remove the repeated link.');
      }
      // x-default
      if (!byKey.has('x-default')) add('warn', 'hreflang', 'xdefault-missing', 'No hreflang="x-default".', 'Optional but recommended: add an x-default for users whose language or region is not listed (often the language picker or main version).');
      // self-reference: hreflang set should contain this page (or its canonical)
      const target = canonicalStatus === 'self' || !canonical ? pageUrl : canonical;
      selfRef = valid.find(a => a.key !== 'x-default' && sameUrl(a.url, pageUrl)) || valid.find(a => a.key !== 'x-default' && canonical && sameUrl(a.url, canonical)) || null;
      if (selfRef) selfRef.flags.push('this page');
      if (!selfRef) {
        const near = valid.find(a => diffHint(a.url, target));
        add('error', 'hreflang', 'self-missing', 'No hreflang entry points to this page.' + (near ? ` Closest: ${near.url} (${diffHint(near.url, target)}).` : ''),
          'Each language version must list itself as well as every other version. Add a self-referencing hreflang link with this page\'s canonical URL.');
      }
      // hreflang on a page canonicalised elsewhere
      if (canonicalStatus === 'other') {
        add('warn', 'hreflang', 'hreflang-noncanonical', 'This page has hreflang links but its canonical points to another URL.', 'Google uses hreflang only between canonical pages. Put hreflang on the canonical URL, or make this page self-canonical.');
      }
      // hreflang URLs that differ from canonical only by trivial variants
      if (canonical && selfRef && !sameUrl(selfRef.url, canonical)) {
        add('warn', 'hreflang', 'self-vs-canonical', `Self hreflang URL ${selfRef.url} differs from the canonical ${canonical}.`, 'Use the canonical URL in hreflang links so the two signals agree.');
      }
      // html lang vs self hreflang language
      const htmlLang = String(data.lang || '').trim();
      if (selfRef && selfRef.code.ok && htmlLang) {
        const hl = htmlLang.toLowerCase().split(/[-_]/)[0];
        if (hl && hl !== selfRef.code.lang) add('warn', 'hreflang', 'html-lang-mismatch', `<html lang="${htmlLang}"> but this page's own hreflang is "${selfRef.hreflang}".`, 'Check which one is wrong; the page language and its self hreflang should match.');
      }
    }

    const order = { error: 0, warn: 1, info: 2 };
    issues.sort((a, b) => order[a.level] - order[b.level]);
    return {
      url: pageUrl,
      canonical: { status: canonicalStatus, url: canonical, raw: headCanon[0] ? headCanon[0].raw : (canonicals[0] ? canonicals[0].raw : ''), count: canonicals.length },
      alternates: alternates.map(a => ({ hreflang: a.hreflang, raw: a.raw, url: a.url, valid: a.code.ok, flags: a.flags })),
      selfHreflang: selfRef ? selfRef.hreflang : null,
      issues,
      summary: {
        canonical: canonicalStatus,
        hreflangCount: alternates.length,
        languages: [...new Set(alternates.filter(a => a.code.ok).map(a => a.key))].length,
        errors: issues.filter(i => i.level === 'error').length,
        warnings: issues.filter(i => i.level === 'warn').length,
      },
    };
  }

  const STATUS_TEXT = { conflict: 'conflicting canonicals', self: 'self-referencing', other: 'points to another URL', missing: 'missing', 'body-only': 'only in <body> (ignored)' };

  function toText(r) {
    const L = [];
    L.push('Hreflang & Canonical Checker report');
    L.push(`Page: ${r.url}`);
    L.push(`Canonical: ${r.canonical.url || r.canonical.raw || '(none)'} [${STATUS_TEXT[r.canonical.status]}]`);
    L.push(`Hreflang links: ${r.summary.hreflangCount}${r.selfHreflang ? ` (this page = ${r.selfHreflang})` : ''}`);
    r.alternates.forEach(a => L.push(`  ${a.hreflang || '(empty)'}\t${a.url || a.raw || '(empty)'}${a.flags.length ? '\t[' + a.flags.join(', ') + ']' : ''}`));
    L.push(`Errors: ${r.summary.errors}, warnings: ${r.summary.warnings}`);
    if (r.issues.length) {
      L.push('', 'Issues:');
      r.issues.forEach(i => { L.push(`- [${i.level.toUpperCase()}] ${i.msg}`); L.push(`  Fix: ${i.fix}`); });
    }
    L.push('', 'Note: on-page check only. Return links on the other language versions, HTTP Link headers and XML sitemaps are not checked.');
    return L.join('\n');
  }

  function toCsv(r) {
    const q = s => `"${String(s == null ? '' : s).replace(/"/g, '""')}"`;
    const rows = [['hreflang', 'url', 'valid_code', 'flags']];
    r.alternates.forEach(a => rows.push([a.hreflang, a.url || a.raw, a.valid ? 'yes' : 'no', a.flags.join('; ')]));
    return rows.map(row => row.map(q).join(',')).join('\r\n') + '\r\n';
  }

  return { analyze, checkCode, toText, toCsv, norm, sameUrl, diffHint };
});
