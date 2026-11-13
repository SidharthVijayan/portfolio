// Mixed Content & Insecure Form Finder core: pure functions, no DOM, no chrome.* (unit-tested in Node).
// Takes what content/extract.js returned, works out which http:// addresses are mixed content on an https page
// (and what Chrome does with each), which forms send to http, and writes a text report or CSV.
'use strict';
(function (root) {
  // kind -> [label, what Chrome does]. "blocked" kinds are content Chrome refuses to load over http on an https page
  // (including srcset / <picture> image candidates, which the Mixed Content spec makes blockable); "upgraded" kinds
  // (plain image src, audio, video) Chrome tries over https instead and drops if that fails.
  const KINDS = {
    script: ['Script', 'blocked'], stylesheet: ['Stylesheet', 'blocked'], iframe: ['Iframe', 'blocked'], frame: ['Frame', 'blocked'],
    object: ['Object', 'blocked'], embed: ['Embed', 'blocked'], 'css-import': ['CSS @import', 'blocked'], 'css-font': ['CSS font', 'blocked'],
    srcset: ['Image (srcset)', 'blocked'], picture: ['Picture source', 'blocked'], img: ['Image', 'upgraded'],
    video: ['Video', 'upgraded'], audio: ['Audio', 'upgraded'], poster: ['Video poster', 'upgraded'],
    'input-image': ['Image button', 'upgraded'], 'css-image': ['CSS image', 'upgraded'],
  };
  const GROUPS = {
    form: 'Forms that send to http', blocked: 'Blocked by Chrome', upgraded: 'Auto-upgraded to https',
    policy: "Upgraded by the page's policy", page: 'Forms on this http page',
  };
  const ACTION = {
    form: 'Chrome warns before sending; the data would travel unencrypted',
    blocked: 'Chrome blocks it, so it does not load',
    upgraded: 'Chrome loads it over https instead; it breaks if that address has no https',
    policy: "The page's upgrade-insecure-requests policy makes the browser ask for it over https; it breaks if that address has no https",
    formPolicy: "The page's upgrade-insecure-requests policy may upgrade it, but change the address to https to be sure",
    page: "Not encrypted: the whole page is http",
  };
  const FORMATS = { report: { label: 'Text report', ext: 'txt', mime: 'text/plain' }, csv: { label: 'CSV (one row per address)', ext: 'csv', mime: 'text/csv' } };

  function hostOf(url) { try { return new URL(url).hostname.toLowerCase().replace(/\.$/, ''); } catch (e) { return ''; } }
  // Browsers treat these as secure even over http, so they are not mixed content.
  function trustworthyHost(host) {
    host = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
    return host === 'localhost' || host.endsWith('.localhost') || /^127(\.\d{1,3}){3}$/.test(host) || host === '::1';
  }
  function httpsVersion(url) { return String(url || '').replace(/^http:/i, 'https:'); }
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));

  function analyze(raw) {
    raw = raw || {};
    const page = String(raw.url || '');
    const protocol = String(raw.protocol || (page.match(/^[a-z-]+:/i) || [''])[0]).toLowerCase();
    const mode = protocol === 'https:' ? 'https' : protocol === 'http:' ? (trustworthyHost(hostOf(page)) ? 'local' : 'http') : 'other';
    const uir = !!raw.uir;
    const rows = new Map();
    let skippedLocal = 0;
    const put = (group, kind, url, el, extra) => {
      const k = group + ' ' + kind + ' ' + url;
      let r = rows.get(k);
      if (!r) { r = Object.assign({ group, kind, url, els: [], count: 0 }, extra || {}); rows.set(k, r); }
      r.count++;
      if (r.els.length < 3 && !r.els.includes(el)) r.els.push(el);
    };
    if (mode === 'https') {
      for (const it of Array.isArray(raw.items) ? raw.items : []) {
        if (!KINDS[it.kind]) continue;
        if (trustworthyHost(hostOf(it.url))) { skippedLocal++; continue; }
        put(uir ? 'policy' : KINDS[it.kind][1], it.kind, it.url, it.el);
      }
    }
    for (const f of Array.isArray(raw.forms) ? raw.forms : []) {
      const info = { method: f.method, fields: f.fields | 0, password: !!f.password, button: !!f.button };
      if (mode === 'https' && f.protocol === 'http:') {
        if (trustworthyHost(hostOf(f.url))) { skippedLocal++; continue; }
        put('form', f.button ? 'formaction' : 'form', f.url, f.el, info);
      } else if (mode === 'http' && !f.button && (f.fields | 0) > 0) put('page', 'form', f.url, f.el, info);
    }
    const order = { form: 0, page: 0, blocked: 1, upgraded: 2, policy: 3 };
    const list = [...rows.values()].sort((a, b) => order[a.group] - order[b.group] || ((b.password ? 1 : 0) - (a.password ? 1 : 0)) || a.url.localeCompare(b.url));
    for (const r of list) r.action = uir && r.group === 'form' ? 'formPolicy' : r.group;
    const n = g => list.filter(r => r.group === g).length;
    const counts = { forms: n('form'), blocked: n('blocked'), upgraded: n('upgraded'), policy: n('policy'), pageForms: n('page'),
      passwordForms: list.filter(r => (r.group === 'form' || r.group === 'page') && r.password).length,
      formsChecked: (raw.forms || []).filter(f => !f.button).length, checked: raw.checked | 0, skippedLocal };
    counts.total = counts.forms + counts.blocked + counts.upgraded + counts.policy + counts.pageForms;
    return { page, title: String(raw.title || ''), host: hostOf(page), mode, uir, rows: list, counts,
      frames: raw.frames | 0, truncated: !!raw.truncated, total: raw.total | 0 };
  }

  function label(r) { return r.kind === 'form' ? 'Form action' : r.kind === 'formaction' ? 'Button formaction' : KINDS[r.kind][0]; }
  function formText(r) {
    return r.method + ', ' + plural(r.fields, 'field') + (r.password ? ', includes a password' : '');
  }
  function summary(a) {
    const c = a.counts;
    if (a.mode === 'other') return 'Mixed content only applies to https web pages. This page is not one, so there is nothing to check.';
    if (a.mode === 'local') return 'This is a local development address (localhost), which browsers treat as secure, so there is no mixed content to report.';
    if (a.mode === 'http') {
      return 'This page itself loads over http, so nothing on it is encrypted.' +
        (c.pageForms ? ' ' + plural(c.pageForms, 'form') + ' would send data unencrypted' + (c.passwordForms ? ' (' + c.passwordForms + ' with a password field)' : '') + '.' : '');
    }
    if (!c.total) return 'No mixed content or insecure forms found on this https page.';
    const parts = [];
    if (c.forms) parts.push(plural(c.forms, 'form') + ' sending to http');
    if (c.blocked) parts.push(plural(c.blocked, 'blocked address', 'blocked addresses'));
    if (c.upgraded) parts.push(plural(c.upgraded, 'auto-upgraded address', 'auto-upgraded addresses'));
    if (c.policy) parts.push(plural(c.policy, 'http address', 'http addresses') + ' upgraded by the page\'s policy');
    return parts.join(', ').replace(/, ([^,]*)$/, ' and $1') + ' on this https page.';
  }
  function level(a) {
    if (a.mode === 'http') return 'bad';
    if (a.mode !== 'https') return 'muted';
    if (!a.counts.total) return 'good';
    if (a.uir) return 'warn';
    return a.counts.forms || a.counts.blocked ? 'bad' : 'warn';
  }
  function notes(a) {
    const out = [], c = a.counts;
    if (a.mode === 'https') out.push({ level: 'muted', msg: 'Checked ' + plural(c.checked, 'resource address', 'resource addresses') + ' and ' + plural(c.formsChecked, 'form') + ' written in the page.' });
    if (a.mode === 'https' && a.uir && c.total) out.push({ level: 'good', msg: "The page sets upgrade-insecure-requests (in a meta tag), so the browser asks for its http addresses over https. They still break if the server has no https, so it's worth fixing them." });
    if (a.mode === 'http') out.push({ level: 'warn', msg: 'Fix: serve the page over https. Mixed content checks apply once it is on https; click again then.' });
    if (c.skippedLocal) out.push({ level: 'muted', msg: plural(c.skippedLocal, 'localhost address', 'localhost addresses') + ' left out: browsers treat localhost as secure.' });
    if (a.frames && a.mode === 'https') out.push({ level: 'muted', msg: 'The page has ' + plural(a.frames, 'iframe') + "; what loads inside isn't checked." });
    if (a.truncated) out.push({ level: 'warn', msg: 'Very large page: only the first 5,000 of ' + a.total.toLocaleString('en-US') + ' http addresses are listed.' });
    return out;
  }

  function report(a, now) {
    const d = (now instanceof Date ? now : new Date()).toISOString().slice(0, 10);
    const lines = ['Mixed content check for ' + (a.host || 'this page') + ' (' + d + ')', 'Page: ' + a.page, summary(a), ''];
    for (const g of Object.keys(GROUPS)) {
      const rs = a.rows.filter(r => r.group === g);
      if (!rs.length) continue;
      lines.push(GROUPS[g] + ' (' + rs.length + ')');
      for (const r of rs) {
        const where = r.els.join(', ') + (r.count > r.els.length ? ' and ' + (r.count - r.els.length) + ' more' : '');
        lines.push('- ' + label(r) + ': ' + r.url + (r.count > 1 ? ' (used ' + r.count + ' times)' : ''));
        lines.push('    In: ' + where + (r.kind === 'form' || r.kind === 'formaction' ? ' (' + formText(r) + ')' : ''));
        lines.push('    ' + ACTION[r.action] + '. Fix: ' + (r.group === 'page' ? 'serve the page and form over https' : 'use ' + httpsVersion(r.url)));
      }
      lines.push('');
    }
    for (const n of notes(a)) lines.push('Note: ' + n.msg);
    lines.push('Only addresses written in the page are checked. Check that each https address works before switching.');
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }
  function cell(v) {
    let s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // keep spreadsheets from running a cell as a formula
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function csv(a) {
    const rows = [['Group', 'Type', 'Address', 'Times used', 'Found in', 'Form details', 'What Chrome does', 'Suggested fix']];
    for (const r of a.rows) rows.push([GROUPS[r.group], label(r), r.url, r.count, r.els.join('; '),
      r.kind === 'form' || r.kind === 'formaction' ? formText(r) : '', ACTION[r.action], r.group === 'page' ? 'Serve the page and form over https' : httpsVersion(r.url)]);
    return rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
  }
  function format(a, fmt, now) { return fmt === 'csv' ? csv(a) : report(a, now); }
  function fileName(page, fmt, now) {
    const d = now instanceof Date ? now : new Date();
    const host = (hostOf(page) || 'page').replace(/[^a-z0-9.-]/gi, '_');
    return 'mixed-content-' + host + '-' + d.toISOString().slice(0, 10) + '.' + FORMATS[fmt].ext;
  }

  const api = { KINDS, GROUPS, ACTION, FORMATS, hostOf, trustworthyHost, httpsVersion, analyze, label, formText, summary, level, notes, report, csv, cell, format, fileName };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.MixedCore = api;
})(typeof self !== 'undefined' ? self : globalThis);
