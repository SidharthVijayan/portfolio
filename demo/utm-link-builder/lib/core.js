// UTM Link Builder: pure URL logic, no DOM and no chrome.* calls, so it is unit-tested in Node.
// It works on the raw address string so every query parameter that is not a UTM tag, and the
// #fragment, is kept exactly as it was (same order, same encoding). UTM values are tidied
// (trimmed, optional lowercase, spaces turned into - or _ or kept) and percent-encoded.
'use strict';
(function (root) {
  const FIELDS = ['source', 'medium', 'campaign', 'term', 'content', 'id'];
  const KEYS = FIELDS.map(f => 'utm_' + f);
  const LABELS = { source: 'Source', medium: 'Medium', campaign: 'Campaign', term: 'Term', content: 'Content', id: 'Campaign ID' };
  const SPACES = { '-': '-', '_': '_', keep: ' ' };
  const MAX_PRESETS = 50, MAX_RECENT = 10, MAX_NAME = 40, MAX_VALUE = 200, LONG_URL = 2000;
  const DEFAULT_OPTIONS = { lowercase: true, spaces: '-', existing: 'replace' };

  function decodeKey(k) {
    try { return decodeURIComponent(k.replace(/\+/g, ' ')); } catch (e) { return k; }
  }

  // Trim, collapse runs of whitespace, then apply the space and case options.
  function tidy(value, options) {
    const o = Object.assign({}, DEFAULT_OPTIONS, options);
    let v = String(value == null ? '' : value).replace(/[\s\u00a0]+/g, ' ').trim();
    if (o.lowercase) v = v.toLowerCase();
    const sep = SPACES[o.spaces] !== undefined ? SPACES[o.spaces] : '-';
    v = v.replace(/ /g, sep);
    if (sep !== ' ') v = v.replace(new RegExp('\\' + sep + '{2,}', 'g'), sep);
    return v;
  }

  // Splits an address into parts without re-encoding anything.
  function split(url) {
    const s = String(url || '');
    const h = s.indexOf('#');
    const beforeHash = h < 0 ? s : s.slice(0, h);
    const hash = h < 0 ? '' : s.slice(h);
    const q = beforeHash.indexOf('?');
    const base = q < 0 ? beforeHash : beforeHash.slice(0, q);
    const query = q < 0 ? '' : beforeHash.slice(q + 1);
    const params = query ? query.split('&').filter(p => p !== '') : [];
    return { base, params, hash };
  }

  function check(url) {
    let u;
    try { u = new URL(String(url || '')); } catch (e) { return { ok: false, reason: 'none' }; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: 'scheme', scheme: u.protocol.replace(':', '') };
    return { ok: true };
  }

  // Returns the UTM tags already on an address, as { utm_source: 'x', ... } (decoded, first one wins).
  function existingUtm(url) {
    const out = {};
    for (const p of split(url).params) {
      const i = p.indexOf('=');
      const k = decodeKey(i < 0 ? p : p.slice(0, i)).toLowerCase();
      if (KEYS.includes(k) && !(k in out)) out[k] = decodeKey(i < 0 ? '' : p.slice(i + 1));
    }
    return out;
  }

  // values: { source, medium, campaign, term, content, id }
  // options.existing: 'replace' (drop the old UTM tags, add yours) or 'keep' (old tags win; only missing ones are added)
  function build(url, values, options) {
    const o = Object.assign({}, DEFAULT_OPTIONS, options);
    const c = check(url);
    if (!c.ok) return { ok: false, error: c.reason, url: '' };
    const v = {};
    for (const f of FIELDS) v[f] = tidy(values && values[f], o).slice(0, MAX_VALUE);
    if (!v.source) return { ok: false, error: 'source', url: '' };
    const { base, params, hash } = split(url);
    const old = existingUtm(url);
    const kept = [], dropped = [], added = [];
    const out = [];
    const seen = new Set();
    for (const p of params) {
      const i = p.indexOf('=');
      const k = decodeKey(i < 0 ? p : p.slice(0, i)).toLowerCase();
      if (!KEYS.includes(k)) { out.push(p); continue; }
      if (o.existing === 'keep') {
        if (seen.has(k)) continue; // duplicate tag: keep the first only
        seen.add(k); out.push(p); kept.push(k);
      } else if (!dropped.includes(k)) dropped.push(k);
    }
    for (const f of FIELDS) {
      const k = 'utm_' + f;
      if (!v[f]) continue;
      if (o.existing === 'keep' && seen.has(k)) continue;
      out.push(k + '=' + encodeURIComponent(v[f]));
      added.push(k);
    }
    const result = base + (out.length ? '?' + out.join('&') : '') + hash;
    const warnings = [];
    if (!v.medium) warnings.push('medium');
    if (!v.campaign) warnings.push('campaign');
    if (!o.lowercase && FIELDS.some(f => /[A-Z]/.test(v[f]))) warnings.push('case');
    if (result.length > LONG_URL) warnings.push('long');
    const replaced = dropped.filter(k => added.includes(k)), removed = dropped.filter(k => !added.includes(k));
    return { ok: true, url: result, values: v, added, replaced, removed, kept, old, warnings };
  }

  function message(r) {
    if (!r.ok) {
      if (r.error === 'source') return 'Add a source (for example newsletter or linkedin) to build the link.';
      return 'UTM tags only work on web addresses (http or https).';
    }
    const bits = [];
    bits.push('Added ' + r.added.length + ' tag' + (r.added.length === 1 ? '' : 's') + '.');
    if (r.replaced.length) bits.push('Replaced the old ' + r.replaced.join(', ') + '.');
    if (r.removed.length) bits.push('Removed the old ' + r.removed.join(', ') + '.');
    if (r.kept.length) bits.push('Kept the existing ' + r.kept.join(', ') + '.');
    const w = [];
    if (r.warnings.includes('medium')) w.push('no medium');
    if (r.warnings.includes('campaign')) w.push('no campaign');
    if (w.length) bits.push('Tip: ' + w.join(' and ') + ' set; most reports group by source, medium and campaign.');
    if (r.warnings.includes('case')) bits.push('Capital letters are kept; analytics tools treat Email and email as different sources.');
    if (r.warnings.includes('long')) bits.push('This link is over 2,000 characters; some tools may cut it.');
    return bits.join(' ');
  }

  function blankValues() { const v = {}; for (const f of FIELDS) v[f] = ''; return v; }

  function cleanPresets(list) {
    if (!Array.isArray(list)) return [];
    const out = [], names = new Set();
    for (const p of list) {
      if (!p || typeof p !== 'object') continue;
      const name = String(p.name || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
      if (!name || names.has(name.toLowerCase())) continue;
      const values = blankValues();
      for (const f of FIELDS) values[f] = String((p.values && p.values[f]) || '').slice(0, MAX_VALUE);
      names.add(name.toLowerCase()); out.push({ name, values });
      if (out.length >= MAX_PRESETS) break;
    }
    return out;
  }

  // Adds or overwrites (same name, any case) a preset. Returns { presets, updated, error }.
  function savePreset(list, name, values) {
    const presets = cleanPresets(list);
    const n = String(name || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
    if (!n) return { presets, error: 'name' };
    const v = blankValues();
    for (const f of FIELDS) v[f] = String((values && values[f]) || '').trim().slice(0, MAX_VALUE);
    if (!v.source) return { presets, error: 'source' };
    const i = presets.findIndex(p => p.name.toLowerCase() === n.toLowerCase());
    if (i >= 0) { presets[i] = { name: presets[i].name, values: v }; return { presets, updated: true }; }
    if (presets.length >= MAX_PRESETS) return { presets, error: 'full' };
    presets.push({ name: n, values: v });
    presets.sort((a, b) => a.name.localeCompare(b.name));
    return { presets, updated: false };
  }

  function deletePreset(list, name) {
    return cleanPresets(list).filter(p => p.name.toLowerCase() !== String(name || '').toLowerCase());
  }

  function addRecent(list, url, now) {
    const arr = (Array.isArray(list) ? list : []).filter(r => r && typeof r.url === 'string' && r.url !== url);
    arr.unshift({ url, at: now });
    return arr.slice(0, MAX_RECENT);
  }

  function cleanOptions(o) {
    const out = Object.assign({}, DEFAULT_OPTIONS);
    if (o && typeof o.lowercase === 'boolean') out.lowercase = o.lowercase;
    if (o && SPACES[o.spaces] !== undefined) out.spaces = o.spaces;
    if (o && (o.existing === 'replace' || o.existing === 'keep')) out.existing = o.existing;
    return out;
  }

  const api = { FIELDS, KEYS, LABELS, DEFAULT_OPTIONS, MAX_PRESETS, MAX_RECENT, tidy, split, check, existingUtm, build, message,
    blankValues, cleanPresets, savePreset, deletePreset, addRecent, cleanOptions };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.UtmCore = api;
})(typeof self !== 'undefined' ? self : this);
