// Print Cleaner core: pure functions, no DOM, no chrome.* (unit-tested in Node).
// analyze(page) takes the description from content/extract.js, finds the main article (if there is one) and
// sorts the parts that usually don't belong on paper into groups. plan() turns the ticked groups into the
// list of elements content/apply.js hides.
'use strict';
(function (root) {
  const GROUPS = [
    { key: 'popups', label: 'Pop-ups and sticky bars', hint: 'Cookie notices, chat buttons, sticky headers and anything pinned to the screen', def: true },
    { key: 'ads', label: 'Ads and sponsored boxes', hint: 'Ad slots, ad frames and sponsored-content widgets', def: true },
    { key: 'nav', label: 'Menus and navigation', hint: 'Menus, breadcrumbs, pagination and skip links', def: true },
    { key: 'header', label: 'Site header', hint: 'Logo bar and masthead above the article', def: true },
    { key: 'sidebar', label: 'Sidebars', hint: 'Side columns and widgets', def: true },
    { key: 'footer', label: 'Site footer', hint: 'The footer at the bottom of the site', def: true },
    { key: 'other', label: 'Other parts outside the article', hint: 'Anything else that is not part of the article', def: true },
    { key: 'social', label: 'Share and follow buttons', hint: 'Share bars and social links', def: true },
    { key: 'related', label: 'Related and recommended stories', hint: '"Read next", "Most read" and recommendation boxes', def: true },
    { key: 'comments', label: 'Comments', hint: 'Comment sections and reply forms', def: true },
    { key: 'newsletter', label: 'Sign-up and subscribe boxes', hint: 'Newsletter and subscription forms', def: true },
    { key: 'media', label: 'Videos and embeds', hint: 'Videos, audio players and embedded frames (they print as empty boxes)', def: true },
    { key: 'images', label: 'Images and figures', hint: 'Photos, figures and their captions inside the article (off by default, to save ink)', def: false },
  ];
  const set = a => new Set(a);
  const T = {
    ads: set(['ad', 'ads', 'advert', 'adverts', 'advertisement', 'advertisements', 'advertising', 'adsbygoogle', 'adslot', 'adunit', 'adbox',
      'adcontainer', 'adwrapper', 'adzone', 'adbanner', 'sponsor', 'sponsored', 'sponsors', 'dfp', 'outbrain', 'taboola']),
    popups: set(['cookie', 'cookies', 'consent', 'gdpr', 'cookiebanner', 'cookienotice', 'modal', 'popup', 'popover', 'lightbox', 'interstitial']),
    comments: set(['comment', 'comments', 'commentlist', 'disqus', 'disqusthread', 'respond', 'discussion']),
    related: set(['related', 'relatedposts', 'relatedarticles', 'relatedstories', 'recommended', 'recommendations', 'readnext', 'morestories',
      'alsoread', 'trending', 'mostread', 'mostpopular', 'youmightlike']),
    social: set(['share', 'shares', 'sharing', 'sharebar', 'sharebuttons', 'social', 'socialshare', 'sociallinks', 'followus']),
    newsletter: set(['newsletter', 'subscribe', 'subscription', 'signup', 'optin', 'mailinglist']),
    nav: set(['nav', 'navbar', 'navigation', 'menu', 'mainmenu', 'breadcrumb', 'breadcrumbs', 'pagination', 'pager', 'skiplink']),
    toc: set(['toc', 'tableofcontents', 'contents', 'jumplinks']),
    header: set(['masthead', 'siteheader', 'header', 'topbar', 'globalheader']),
    footer: set(['footer', 'sitefooter', 'colophon', 'globalfooter']),
    sidebar: set(['sidebar', 'rail', 'widget', 'widgets', 'widgetarea']),
  };
  const AD_HOSTS = /(^|\.)(doubleclick\.net|googlesyndication\.com|googleadservices\.com|adservice\.google\.[a-z.]+|amazon-adsystem\.com|criteo\.(com|net)|adnxs\.com|pubmatic\.com|rubiconproject\.com|taboola\.com|outbrain\.com|media\.net)$/;
  const MEDIA = set(['video', 'audio', 'iframe', 'frame', 'embed', 'object']);
  const IMAGES = set(['img', 'picture', 'figure', 'canvas']);
  const LANDMARK = set(['article', 'main', 'section', 'aside']);

  function tokens(it) {
    const raw = (it.id + ' ' + it.cls).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const s = new Set(raw);
    for (let k = 0; k + 1 < raw.length; k++) s.add(raw[k] + raw[k + 1]);
    return s;
  }
  const has = (tk, group) => { for (const t of tk) if (T[group].has(t)) return true; return false; };

  function analyze(page) {
    const items = (page && page.items) || [];
    const n = items.length;
    const kids = items.map(() => []), roots = [];
    for (const it of items) (it.p >= 0 ? kids[it.p] : roots).push(it.i);
    const tk = items.map(tokens);
    const end = items.map((_, i) => i), pt = new Array(n).fill(0), score = new Array(n).fill(0);
    // Parts that are clearly not the article (comments, related, sidebars...) don't count towards finding it.
    const clutter = new Array(n).fill(false);
    for (const it of items) {
      const own = has(tk[it.i], 'comments') || has(tk[it.i], 'related') || has(tk[it.i], 'sidebar') || has(tk[it.i], 'footer') ||
        has(tk[it.i], 'ads') || it.tag === 'aside' || it.tag === 'footer' || it.tag === 'nav' || it.role === 'complementary' || it.role === 'contentinfo';
      clutter[it.i] = own || (it.p >= 0 && clutter[it.p]);
    }
    for (let i = n - 1; i >= 0; i--) {
      const it = items[i];
      if (it.tag === 'p' && !clutter[i]) {
        const len = Math.max(0, (it.c || 0) - (it.l || 0));
        pt[i] += len;
        if (len >= 25 && it.p >= 0) { score[it.p] += len; const g = items[it.p].p; if (g >= 0) score[g] += len / 2; }
      }
      if (it.p >= 0) { pt[it.p] += pt[i]; end[it.p] = Math.max(end[it.p], end[i]); }
    }
    const P = roots.reduce((a, r) => a + pt[r], 0);
    const inside = (x, a) => a < x && x <= end[a];
    const parentOf = i => items[i].p;

    // 1. The article: the container with the most paragraph text, widened to its <article> (or articleBody),
    //    plus its title when the <h1> sits outside that container.
    let main = null, title = null;
    if (P >= 150) {
      let best = -1;
      for (let i = 0; i < n; i++) if (score[i] > (best < 0 ? 0 : score[best])) best = i;
      if (best >= 0) {
        let m = best;
        for (let a = best; a >= 0; a = parentOf(a)) if (items[a].tag === 'article' || items[a].body) { m = a; break; }
        // A list of teasers (three or more <article> cards inside it) is not one article.
        const cards = items.filter(it => it.tag === 'article' && inside(it.i, m) && pt[it.i] > 0).length;
        if (pt[m] >= 0.35 * P && cards < 3) main = m;
      }
    }
    if (main !== null) {
      // Keep the article's title: the <h1> inside it, or the last <h1> before it that isn't in a site header or menu.
      const h1s = items.filter(it => it.tag === 'h1' && it.c > 0);
      if (!h1s.some(h => inside(h.i, main))) {
        const cand = h1s.filter(h => h.i < main).filter(h => {
          for (let a = h.p; a >= 0; a = parentOf(a)) if (items[a].tag === 'header' || items[a].tag === 'nav' || items[a].role === 'banner' || items[a].role === 'navigation') return false;
          return true;
        }).pop();
        if (cand) {
          // Keep the title with its small wrapper (byline, date) when that wrapper holds nothing else.
          const par = cand.p;
          title = par >= 0 && !inside(main, par) && par !== main && (items[par].c || 0) <= cand.c * 3 + 200 && pt[par] <= 300 &&
            !['body', 'main', 'article'].includes(items[par].tag) && kids[par].length <= 6 ? par : cand.i;
        }
      }
    }
    const keep = new Set([main, title].filter(x => x !== null));
    const prot = new Set();
    for (const k of keep) for (let a = k; a >= 0; a = parentOf(a)) prot.add(a);
    const depth = i => { let d = 0; for (let a = parentOf(i); a >= 0; a = parentOf(a)) d++; return d; };
    const landmarkAbove = i => { for (let a = parentOf(i); a >= 0; a = parentOf(a)) if (LANDMARK.has(items[a].tag) || items[a].role === 'main') return true; return false; };

    // 2. Sort the rest into groups. zone: 'in' (inside the article), 'out' (around it), 'page' (no article found).
    function match(i, zone) {
      const it = items[i], t = tk[i], role = it.role, tag = it.tag;
      const big = zone === 'in' ? (pt[i] >= 200 && pt[i] >= 0.5 * pt[main]) : zone === 'page' ? (pt[i] >= 400 && pt[i] >= 0.4 * P) : false;
      const lbl = (it.lbl || '').trim();
      if (!big) {
        if (it.ad || has(t, 'ads') || /^(advertisement|advert|ads?|sponsored)$/i.test(lbl) || (it.host && AD_HOSTS.test(it.host))) return 'ads';
        const headerish = zone === 'out' && (tag === 'header' || role === 'banner');
        if (!headerish && (it.pos || it.modal || role === 'dialog' || role === 'alertdialog' || has(t, 'popups'))) return 'popups';
        if (has(t, 'comments')) return 'comments';
        if (has(t, 'related')) return 'related';
        if (has(t, 'social') || /^share\b/i.test(lbl)) return 'social';
        if (has(t, 'newsletter')) return 'newsletter';
        const navish = tag === 'nav' || role === 'navigation' || role === 'menubar' || role === 'menu' || has(t, 'nav');
        if (navish && !(zone === 'in' && has(t, 'toc'))) return 'nav';
        if (zone === 'out' || (zone === 'page' && depth(i) <= 3 && !landmarkAbove(i))) {
          if (tag === 'header' || role === 'banner' || has(t, 'header')) return 'header';
          if (tag === 'footer' || role === 'contentinfo' || has(t, 'footer')) return 'footer';
          if (tag === 'aside' || role === 'complementary' || has(t, 'sidebar')) return 'sidebar';
        }
      }
      if (MEDIA.has(tag)) return 'media';
      if (zone !== 'out' && IMAGES.has(tag)) return 'images';
      return null;
    }
    const found = Object.fromEntries(GROUPS.map(g => [g.key, []]));
    const add = (i, g) => found[g].push(i);
    function visit(i, zone) {
      if (keep.has(i)) { for (const c of kids[i]) visit(c, 'in'); return; }
      if (prot.has(i)) { for (const c of kids[i]) visit(c, 'out'); return; }
      const g = match(i, zone);
      if (g) return add(i, g);
      if (zone === 'out') return add(i, 'other');
      for (const c of kids[i]) visit(c, zone);
    }
    for (const r of roots) visit(r, main === null ? 'page' : 'out');

    const label = i => {
      const it = items[i];
      const s = (it.lbl || it.ttl || it.s || '').trim();
      if (s) return s.length > 48 ? s.slice(0, 47).trimEnd() + '…' : s;
      return '<' + it.tag + (it.id ? '#' + it.id : it.cls ? '.' + it.cls.trim().split(/\s+/)[0] : '') + '>';
    };
    const groups = GROUPS.filter(g => found[g.key].length).map(g => ({ key: g.key, label: g.label, hint: g.hint, def: g.def,
      items: found[g.key].sort((a, b) => a - b), examples: found[g.key].slice(0, 3).map(label) }));
    let mainTitle = '';
    if (main !== null) {
      const h = items.find(it => it.tag === 'h1' && it.c > 0 && (it.i === title || (title !== null && inside(it.i, title)) || inside(it.i, main) || it.i === main));
      mainTitle = (h ? h.s : '') || String(page.title || '').trim();
    }
    // Words that will print: the article (and its title) minus the parts found inside it.
    let words = main === null ? 0 : [...keep].reduce((a, k) => a + (items[k].w || 0), 0);
    if (main !== null) for (const g of GROUPS) for (const i of found[g.key]) if ([...keep].some(k => inside(i, k))) words -= items[i].w || 0;
    const total = groups.reduce((a, g) => a + g.items.length, 0);
    const ready = groups.filter(g => g.def).reduce((a, g) => a + g.items.length, 0);
    return { url: page.url || '', title: page.title || '', count: n, truncated: !!page.truncated, main, keep: [...keep], mainTitle, words,
      groups, total, ready, applied: page.applied || null };
  }

  // Which groups start ticked: the defaults, or (on a page already cleaned) what is removed right now.
  function initialSelection(res) {
    const sel = {};
    const auto = new Set(res.applied ? res.applied.auto : []);
    for (const g of res.groups) sel[g.key] = res.applied ? g.items.some(i => auto.has(i)) : g.def;
    return sel;
  }
  function plan(res, sel, links) {
    const hide = [];
    for (const g of res.groups) if (sel[g.key]) hide.push(...g.items);
    return { hide: hide.sort((a, b) => a - b), links: !!links };
  }
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
  function summary(res) {
    if (!res.count) return 'This page has nothing to clean.';
    const lead = res.main !== null
      ? `Found the article${res.mainTitle ? ' “' + res.mainTitle + '”' : ''} (${res.words.toLocaleString('en-US')} words).`
      : 'No single article found on this page.';
    const more = res.truncated ? ' Very long page: only the first 20,000 elements were read.' : '';
    if (!res.total) return lead + ' Nothing to remove: this page is already print-friendly.' + more;
    if (!res.ready && !res.applied) return lead + ' Nothing to remove apart from images, which you can tick below.' + more;
    if (res.applied) {
      const n = res.applied.auto.length + res.applied.pick.length;
      return lead + ' Cleaned: ' + plural(n, 'part', 'parts') + ' removed' + (res.applied.pick.length ? ` (${res.applied.pick.length} by hand)` : '') + '. Change the boxes and press Update, or Print.' + more;
    }
    return lead + ' ' + plural(res.ready, 'part', 'parts') + (res.main !== null ? ' around it' : ' that usually don\'t belong on paper') + ' can be removed before printing.' + more;
  }
  const statusClass = res => res.main === null && res.total ? 'warn' : 'good';
  const api = { GROUPS, analyze, initialSelection, plan, summary, statusClass, tokens };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PrintCore = api;
})(typeof self !== 'undefined' ? self : this);
