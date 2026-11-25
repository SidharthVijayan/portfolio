// Keyboard Focus Order Visualizer core: pure functions, no DOM, no network. Shared by the popup and Node tests.
// Takes what content/extract.js read from the page and works out the order in which the Tab key visits the
// page's elements, the way the HTML "sequential focus navigation order" and Chrome do it: positive tabindex
// values first (lowest first, ties in page order), then tabindex="0" and natively focusable elements in page
// order; disabled, inert, unrendered and visibility:hidden elements are skipped; a radio group is one stop
// (the checked radio, or the first one); tabindex="-1" takes an element out of the order; a scroll box with
// nothing focusable inside is a stop of its own. Each stop is then checked for things that confuse keyboard
// users, and controls that Tab never reaches are listed. Output: stops, a summary, a text report and a CSV.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FocusCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const JUMP_UP = 200; // px a stop must sit above the previous visible stop to count as "jumps back up"
  const CODES = {
    'positive': { sev: 'check', label: 'Jumps the queue' },
    'aria-hidden': { sev: 'problem', label: 'Hidden from screen readers' },
    'invisible': { sev: 'check', label: 'Not visible' },
    'jump-up': { sev: 'check', label: 'Jumps back up' },
    'frame': { sev: 'ok', label: 'Frame' },
    'scroller': { sev: 'ok', label: 'Scroll box' },
    'no-tabindex': { sev: 'problem', label: 'Tab never reaches it' },
    'minus-one': { sev: 'check', label: 'Taken out of Tab order' },
  };
  const GROUPS = {
    all: { label: 'Tab order', note: '' },
    check: { label: 'Check', note: 'Tab stops that may confuse keyboard users. Each one says why.' },
    skipped: { label: 'Not reached', note: 'These look like controls, but pressing Tab never lands on them.' },
  };
  const KIND = {
    'link': 'link', 'button': 'button', 'checkbox': 'checkbox', 'radio': 'radio group', 'slider': 'slider', 'file picker': 'file picker',
    'colour picker': 'colour picker', 'text field': 'text field', 'dropdown': 'dropdown', 'text area': 'text area', 'frame': 'frame',
    'summary': 'expandable section', 'media': 'media controls', 'editable': 'editable area',
  };
  const FIELDS = new Set(['button', 'input', 'select', 'textarea']);

  // HTML "rules for parsing integers": optional whitespace, optional sign, digits; anything after the digits is ignored.
  function parseTabindex(raw) {
    if (raw == null) return null;
    const m = String(raw).match(/^[\t\n\f\r ]*([-+]?)(\d+)/);
    if (!m) return null;
    const n = parseInt(m[2], 10);
    if (!Number.isFinite(n)) return null;
    return m[1] === '-' ? -n : n;
  }

  function kindLabel(it) {
    if (it.kind === 'radio' && !it.radioName) return 'radio button';
    if (it.kind) return KIND[it.kind] || it.kind;
    if (it.scroller && it.tabindex == null) return 'scroll box';
    if (it.role) return `${it.tag} role=${it.role}`;
    if (it.tabindex != null) return `${it.tag} with tabindex`;
    if (it.onclick) return `${it.tag} with onclick`;
    return it.tag;
  }
  const visible = it => !(it.offscreen || it.box.w < 1 || it.box.h < 1 || it.faded || it.clipped);

  function analyze(page) {
    const items = (page && page.items || []).map(it => Object.assign({}, it, { ti: parseTabindex(it.tabindex) }));
    for (const it of items) {
      const shown = it.rendered && it.visibility === 'visible' && !it.inert;
      const disabled = FIELDS.has(it.tag) && it.disabled;
      it.focusable = shown && !disabled && !!(it.kind || it.ti !== null || it.scroller);
      it.tabbable = it.focusable && (it.ti === null ? !!(it.kind || it.scroller) : it.ti >= 0);
    }
    // A scroll box without its own tabindex is a stop only when nothing inside it can take focus.
    for (const it of items) {
      if (!it.tabbable || it.kind || it.ti !== null || !it.scroller) continue;
      if (items.some(o => o !== it && o.focusable && o.inScroller.includes(it.i))) it.tabbable = false;
    }
    // A named radio group is one stop: the checked radio, or the first one in page order.
    const groups = new Map();
    for (const it of items) {
      if (!it.tabbable || it.type !== 'radio' || !it.radioName) continue;
      const key = (it.form || '') + '\u0000' + it.radioName;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(it);
    }
    for (const g of groups.values()) {
      const keep = g.find(r => r.checked) || g[0];
      for (const r of g) if (r !== keep) { r.tabbable = false; r.inGroup = true; }
      keep.groupSize = g.length;
    }
    const tabbable = items.filter(it => it.tabbable);
    const positive = tabbable.filter(it => it.ti > 0).sort((a, b) => a.ti - b.ti || a.order - b.order);
    const rest = tabbable.filter(it => !(it.ti > 0)).sort((a, b) => a.order - b.order);
    const stops = [...positive, ...rest].map((it, k) => Object.assign(it, { n: k + 1 }));
    let prev = null;
    for (const it of stops) {
      const issues = [];
      if (it.ti > 0) issues.push(issue('positive', `tabindex="${it.ti}" moves it ahead of the page's normal order, so Tab visits it before everything with tabindex 0.`));
      if (it.ariaHidden) issues.push(issue('aria-hidden', 'Tab lands on it, but aria-hidden="true" tells screen readers to ignore it, so they announce nothing.'));
      if (!visible(it)) issues.push(issue('invisible', it.tag === 'a' && /^#/.test(it.href) && it.n <= 3
        ? 'Not visible until focused? Likely a skip link, which is fine if it appears when Tab reaches it.'
        : 'Tab reaches it, but it is off-screen, transparent, clipped or has no size right now. Fine if it appears on focus; otherwise keyboard users lose track.'));
      else {
        if (prev && it.box.y < prev.box.y - JUMP_UP) issues.push(issue('jump-up', `Goes back up the page from stop ${prev.n}. The Tab order doesn't follow the reading order here.`));
        prev = it;
      }
      if (it.kind === 'frame') issues.push(issue('frame', 'Tab continues through the framed page\'s own stops before moving on. They are not numbered here.'));
      if (it.scroller && !it.kind && it.ti === null) issues.push(issue('scroller', 'Chrome lets Tab reach this scroll box (it has nothing focusable inside) so the arrow keys can scroll it.'));
      if (it.groupSize > 1) it.note = `${it.groupSize} radios, one stop: arrow keys move inside the group.`;
      it.issues = issues;
      it.sev = severity(issues);
    }
    const skipped = [];
    for (const it of items) {
      if (it.tabbable || it.inGroup || !it.rendered || it.visibility !== 'visible' || it.inert || it.ariaHidden || !visible(it)) continue;
      if (FIELDS.has(it.tag) && it.disabled) continue;
      if (!it.kind && it.ti === null && (it.role || it.onclick) && !it.activeDesc && !it.scroller) {
        skipped.push(Object.assign(it, { issues: [issue('no-tabindex', `${it.role ? `role="${it.role}"` : 'An onclick handler'} makes it look like a control, but it has no tabindex, so keyboard users can't reach it. Use a real <button> or <a href>, or add tabindex="0" and key handling.`)] }));
      } else if (it.kind && it.ti !== null && it.ti < 0) {
        skipped.push(Object.assign(it, { issues: [issue('minus-one', `tabindex="${it.tabindex}" takes this ${kindLabel(it)} out of the Tab order. Fine inside a widget the arrow keys move through (tabs, menus); otherwise keyboard users can't reach it.`)] }));
      }
    }
    for (const it of skipped) it.sev = severity(it.issues);
    const count = (list, s) => list.filter(i => i.sev === s).length;
    return {
      url: page ? page.url : '', title: page ? page.title : '', truncated: !!(page && page.truncated),
      stops, skipped,
      counts: { stops: stops.length, check: stops.filter(s => s.sev !== 'ok').length, problem: count(stops, 'problem') + count(skipped, 'problem'), skipped: skipped.length },
    };
  }
  function issue(code, detail) { return { code, label: CODES[code].label, sev: CODES[code].sev, detail }; }
  function severity(issues) { return issues.some(i => i.sev === 'problem') ? 'problem' : issues.some(i => i.sev === 'check') ? 'check' : 'ok'; }

  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;
  function summary(res) {
    const c = res.counts;
    const long = res.truncated ? ' Very long page: only the first part was read.' : '';
    if (!c.stops && !c.skipped) return 'No Tab stops on this page: nothing here takes keyboard focus.' + long;
    const flagged = res.stops.filter(s => s.sev !== 'ok');
    const parts = [];
    const p = count => flagged.filter(s => s.sev === count).length;
    if (p('problem')) parts.push(plural(p('problem'), 'problem'));
    if (p('check')) parts.push(`${p('check')} to check`);
    let s = plural(c.stops, 'Tab stop') + (parts.length ? ': ' + parts.join(', ') + '.' : ', in a sensible order. Nothing to check.');
    if (c.skipped) s += ` ${plural(c.skipped, 'control')} Tab never reaches.`;
    return s + long;
  }
  function statusClass(res) { return res.counts.problem ? 'bad' : (res.counts.check || res.counts.skipped) ? 'warn' : 'good'; }
  function filter(res, group) {
    if (group === 'check') return res.stops.filter(s => s.sev !== 'ok');
    if (group === 'skipped') return res.skipped;
    return res.stops;
  }
  const quoted = it => (it.name ? `"${it.name}"` : '(no name)');
  function report(res) {
    const lines = ['Keyboard Focus Order Visualizer report', `Page: ${res.title || '(untitled)'}`, `Address: ${res.url}`, summary(res), '', 'Tab order:'];
    if (!res.stops.length) lines.push('  (none)');
    for (const s of res.stops) {
      lines.push(`${String(s.n).padStart(3)}. ${kindLabel(s)} ${quoted(s)}${s.ti !== null ? ` [tabindex=${s.ti}]` : ''}`);
      for (const i of s.issues) if (i.sev !== 'ok') lines.push(`     ${i.sev === 'problem' ? 'Problem' : 'Check'}: ${i.label}. ${i.detail}`);
      lines.push(`     ${s.path}`);
    }
    if (res.skipped.length) {
      lines.push('', 'Not reached by Tab:');
      for (const s of res.skipped) {
        lines.push(`  -  ${kindLabel(s)} ${quoted(s)}`);
        for (const i of s.issues) lines.push(`     ${i.sev === 'problem' ? 'Problem' : 'Check'}: ${i.label}. ${i.detail}`);
        lines.push(`     ${s.path}`);
      }
    }
    return lines.join('\n') + '\n';
  }
  const cell = v => {
    let s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+$/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const RESULT = { ok: 'OK', check: 'Check', problem: 'Problem' };
  function toCsv(res) {
    const rows = [['Tab order', 'Element', 'Name', 'tabindex', 'Result', 'Issues', 'CSS path']];
    for (const s of res.stops) rows.push([s.n, kindLabel(s), s.name, s.ti === null ? '' : s.ti, RESULT[s.sev], s.issues.map(i => i.label).join('; '), s.path]);
    for (const s of res.skipped) rows.push(['not reached', kindLabel(s), s.name, s.ti === null ? '' : s.ti, RESULT[s.sev], s.issues.map(i => i.label).join('; '), s.path]);
    return '\ufeff' + rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
  }
  function fileName(url) {
    let host = 'page';
    try { host = new URL(url).hostname.replace(/^www\./, '') || 'page'; } catch (e) { /* keep default */ }
    return `focus-order-${host.replace(/[^a-z0-9.-]+/gi, '-')}.csv`;
  }
  // What the numbers layer draws: each stop's element index, number and colour; "not reached" controls get an ✕.
  function plan(res) {
    return res.stops.map(s => ({ i: s.i, n: s.n, sev: s.sev })).concat(res.skipped.filter(s => s.sev === 'problem').map(s => ({ i: s.i, n: null, sev: 'problem' })));
  }

  return { CODES, GROUPS, JUMP_UP, parseTabindex, kindLabel, analyze, summary, statusClass, filter, report, toCsv, fileName, plan };
});
