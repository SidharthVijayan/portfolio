// Broken Anchor Checker core: pure functions, no DOM, no network. Shared by the popup and Node tests.
// Takes what content/extract.js read from the page and checks every same-page #fragment link the way a
// browser looks for its target (HTML "find a potential indicated element"): an element with that id or
// an <a name>, first as written, then percent-decoded; an empty fragment or "top" means the top of the
// page; a text fragment (#:~:text=) is not an id. Links are grouped by target, sorted into Broken / Check /
// Works / Not checked, and written out as a summary, a text report and a CSV.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AnchorCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CODES = {
    'missing': { group: 'broken', label: 'No such target' },
    'duplicate': { group: 'check', label: 'Duplicate id' },
    'hidden-target': { group: 'check', label: 'Target not displayed' },
    'base-elsewhere': { group: 'check', label: 'Goes to another page' },
    'ok': { group: 'ok', label: 'Works' },
    'name': { group: 'ok', label: 'Works (a name)' },
    'opens': { group: 'ok', label: 'Works (opens section)' },
    'top': { group: 'ok', label: 'Top of page' },
    'other-page': { group: 'skip', label: 'Other page' },
    'text-fragment': { group: 'skip', label: 'Text fragment' },
    'route': { group: 'skip', label: 'App route' },
  };
  const GROUPS = {
    broken: { label: 'Broken', note: 'Nothing on the page has this id or name, so the link goes nowhere. Fix the link or add the id.' },
    check: { label: 'Check', note: 'The link reaches something, but maybe not what you meant.' },
    ok: { label: 'Works', note: 'These links find their target on this page.' },
    skip: { label: 'Not checked', note: 'Links to other pages, text fragments and app routes. Nothing is loaded to check them.' },
  };
  const GROUP_ORDER = ['broken', 'check', 'ok', 'skip'];

  const noHash = u => { const i = u.indexOf('#'); return i < 0 ? u : u.slice(0, i); };
  const decode = s => { try { return decodeURIComponent(s); } catch (e) { return null; } };

  // Edit distance with an early exit once it is clearly too far.
  function distance(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i]; let best = i;
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (cur[j] < best) best = cur[j];
      }
      if (best > max) return max + 1;
      prev = cur;
    }
    return prev[b.length];
  }
  const squash = s => s.toLowerCase().replace(/[^a-z0-9\u00c0-\uffff]+/g, '');

  // The closest existing id or name for a fragment that matched nothing.
  function suggest(frag, keys) {
    if (!frag) return null;
    const lower = frag.toLowerCase();
    const caseHit = keys.find(k => k.toLowerCase() === lower);
    if (caseHit) return { key: caseHit, why: 'case', text: `Only the capitals differ: the page has #${caseHit} (ids are case-sensitive).` };
    const sq = squash(frag);
    const sqHit = sq && keys.find(k => squash(k) === sq);
    if (sqHit) return { key: sqHit, why: 'spelling', text: `Did you mean #${sqHit}?` };
    if (frag.length > 100) return null;
    const max = Math.max(2, Math.floor(frag.length / 4));
    let best = null, bestD = max + 1;
    for (const k of keys) {
      if (k.length > 100) continue;
      const d = distance(lower, k.toLowerCase(), Math.min(max, bestD));
      if (d < bestD) { best = k; bestD = d; }
    }
    return best ? { key: best, why: 'spelling', text: `Did you mean #${best}?` } : null;
  }

  // Decide what one link does. Returns null for links that are not #links at all.
  function classify(link, page, idMap, nameMap) {
    const href = link.href || '';
    const hashAt = href.indexOf('#');
    if (!/^(https?|file):/i.test(href)) return null;
    const pageUrl = noHash(page.url || '');
    const same = noHash(href) === pageUrl;
    if (!same) {
      if (hashAt < 0 || hashAt === href.length - 1) {
        if (/^#/.test(link.raw)) return { code: 'base-elsewhere', frag: link.raw.slice(1), detail: `The page's <base href> makes this link open ${href}` };
        return null; // a normal link to another page
      }
      if (/^#/.test(link.raw)) return { code: 'base-elsewhere', frag: link.raw.slice(1), detail: `The page's <base href> makes this link open ${href} instead of jumping on this page` };
      return { code: 'other-page', frag: decode(href.slice(hashAt + 1)) ?? href.slice(hashAt + 1), detail: 'Points to an id on another page; that page is not loaded or checked' };
    }
    if (hashAt < 0) return null; // the page linking to itself without a fragment
    let frag = href.slice(hashAt + 1), directive = false;
    const d = frag.indexOf(':~:');
    if (d >= 0) { directive = true; frag = frag.slice(0, d); }
    if (!frag) return directive ? { code: 'text-fragment', frag: href.slice(hashAt + 1), detail: 'Highlights matching text; it does not point to an id' } : { code: 'top', frag: '', detail: 'An empty # goes to the top of the page' };
    const decoded = decode(frag);
    const lookup = key => (key != null && (idMap.get(key) || nameMap.get(key))) || null;
    const target = lookup(frag) || (decoded !== frag ? lookup(decoded) : null);
    const shown = decoded ?? frag;
    if (!target) {
      if (shown.toLowerCase() === 'top') return { code: 'top', frag: shown, detail: 'No element is called "top", so browsers go to the top of the page' };
      if (/^[!/]/.test(shown)) return { code: 'route', frag: shown, detail: 'Looks like an app route (#/… or #!…) that the page\'s own script handles' };
      return { code: 'missing', frag: shown, detail: `No element has id="${shown}" and no <a name="${shown}">` };
    }
    const viaName = idMap.get(target.key) !== target;
    const where = `<${target.tag}> ${target.path || ''}`.trim();
    if (target.count > 1) return { code: 'duplicate', frag: shown, target: where, detail: `${target.count} elements use ${viaName ? 'name' : 'id'}="${target.key}"; the link jumps to the first one` };
    if (target.hidden) return { code: 'hidden-target', frag: shown, target: where, detail: 'The target exists but is not displayed (display:none or hidden), so the jump shows nothing' };
    if (target.opens) return { code: 'opens', frag: shown, target: where, detail: 'Inside a closed section that the browser opens when the link is used' };
    if (viaName) return { code: 'name', frag: shown, target: where, detail: `Matches <a name="${target.key}"> (an older way to mark a target)` };
    return { code: 'ok', frag: shown, target: where, detail: '' };
  }

  function analyze(page) {
    const idMap = new Map(), nameMap = new Map();
    for (const t of (page && page.ids) || []) idMap.set(t.key, t);
    for (const t of (page && page.names) || []) if (!idMap.has(t.key)) nameMap.set(t.key, t);
    // An <a name> whose value is also an id is looked up through the id.
    const keys = [...idMap.keys(), ...nameMap.keys()];
    const byKey = new Map(), items = [];
    for (const link of (page && page.links) || []) {
      const c = classify(link, page, idMap, nameMap);
      if (!c) continue;
      const key = c.code === 'other-page' ? 'o|' + link.href : c.code + '|' + c.frag;
      let it = byKey.get(key);
      if (!it) {
        it = { code: c.code, group: CODES[c.code].group, label: CODES[c.code].label, fragment: c.frag, href: c.code === 'other-page' || c.code === 'base-elsewhere' ? link.href : '', target: c.target || '', detail: c.detail, links: [] };
        if (c.code === 'missing') it.suggestion = suggest(c.frag, keys);
        byKey.set(key, it); items.push(it);
      }
      it.links.push({ text: link.text, raw: link.raw, path: link.path });
    }
    items.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
    items.forEach((it, i) => { it.id = i + 1; });
    const byGroup = Object.fromEntries(GROUP_ORDER.map(g => [g, items.filter(i => i.group === g).length]));
    const linksIn = g => items.filter(i => i.group === g).reduce((s, i) => s + i.links.length, 0);
    const linkCount = Object.fromEntries(GROUP_ORDER.map(g => [g, linksIn(g)]));
    const checked = linkCount.broken + linkCount.check + linkCount.ok;
    return {
      url: page ? page.url : '', title: page ? page.title : '', items, byGroup, linkCount,
      totals: { checked, targets: byGroup.broken + byGroup.check + byGroup.ok, ids: idMap.size, links: page ? page.totalLinks || 0 : 0 },
      truncated: !!(page && page.truncated),
    };
  }

  const plural = (n, one, many) => `${n.toLocaleString('en-US')} ${n === 1 ? one : (many || one + 's')}`;
  function summary(res) {
    const t = res.totals, lc = res.linkCount;
    let s;
    if (!t.checked) s = 'No same-page #links on this page.';
    else {
      s = `Checked ${plural(t.checked, 'same-page link')} to ${plural(t.targets, 'target')}: `;
      const bits = [];
      if (lc.broken) bits.push(`${lc.broken} broken`);
      if (lc.check) bits.push(`${lc.check} to check`);
      s += bits.length ? bits.join(', ') + '.' : 'all work.';
    }
    if (lc.skip) s += ` ${plural(lc.skip, 'link')} not checked.`;
    if (res.truncated) s += ' Very long page, so only the first part was read.';
    return s;
  }
  function filter(res, group) { return group && group !== 'all' ? res.items.filter(i => i.group === group) : res.items.slice(); }
  const shownFrag = it => it.code === 'other-page' ? it.href : '#' + it.fragment;

  function report(res) {
    const lines = ['Broken Anchor Checker report', `Page: ${res.url}`, summary(res), ''];
    for (const g of GROUP_ORDER) {
      const list = res.items.filter(i => i.group === g);
      if (!list.length) continue;
      lines.push(`${GROUPS[g].label} (${plural(list.length, 'target')}, ${plural(list.reduce((s, i) => s + i.links.length, 0), 'link')})`);
      for (const it of list) {
        lines.push(`${it.id}. ${shownFrag(it)}: ${it.label}.${it.detail ? ' ' + it.detail + '.' : ''}`);
        if (it.suggestion) lines.push(`   Fix: ${it.suggestion.text}`);
        if (it.target) lines.push(`   Target: ${it.target}`);
        for (const l of it.links) lines.push(`   Link: "${l.text || '(no text)'}" at ${l.path}`);
      }
      lines.push('');
    }
    return lines.join('\n').trimEnd() + '\n';
  }

  // CSV cells are quoted; cells that a spreadsheet would run as a formula get a leading apostrophe.
  const cell = v => { let s = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
  function toCsv(res) {
    const rows = [['Status', 'Result', 'Fragment', 'Link text', 'Link href', 'Link element', 'Target element', 'Details', 'Suggestion']];
    for (const it of res.items) for (const l of it.links) rows.push([GROUPS[it.group].label, it.label, shownFrag(it), l.text, l.raw, l.path, it.target, it.detail, it.suggestion ? it.suggestion.text : '']);
    return '\ufeff' + rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
  }
  function fileName(url) {
    let host = 'page';
    try { host = new URL(url).hostname.replace(/^www\./, '') || 'page'; } catch (e) { /* keep default */ }
    return `anchors-${host.replace(/[^a-z0-9.-]+/gi, '-')}.csv`;
  }

  return { CODES, GROUPS, GROUP_ORDER, distance, suggest, classify, analyze, summary, filter, report, toCsv, fileName, shownFrag };
});
