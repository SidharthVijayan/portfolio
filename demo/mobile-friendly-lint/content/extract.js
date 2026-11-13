// Injected on click via chrome.scripting.executeScript({ files: ['content/extract.js'] }).
// READ-ONLY: returns (1) every <meta name="viewport"> content string, (2) the layout viewport
// width and the page's scroll width, (3) the outermost visible elements whose right edge runs
// past the viewport (ignoring ones inside a scrolling/clipping container and fixed elements),
// and (4) the rendered size of every visible tap target (links, buttons, form controls,
// summary, ARIA widget roles). Makes no requests and never modifies the page.
(() => {
  const MAX = 8000, MAX_TARGETS = 2000, MAX_OVERFLOW = 200;
  const clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const ROLES = new Set(['button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'option']);
  const CLIPS = new Set(['hidden', 'auto', 'scroll', 'clip', 'overlay']);
  const doc = document.documentElement;
  const body = document.body;
  const vw = (doc && doc.clientWidth) || window.innerWidth || 0;
  const out = {
    url: location.href, protocol: location.protocol, title: clean(document.title || ''),
    viewports: [], viewportWidth: vw, innerWidth: window.innerWidth || vw,
    scrollWidth: Math.max(doc ? doc.scrollWidth : 0, body ? body.scrollWidth : 0),
    rootClips: false, overflow: [], targets: [], scanned: 0, total: 0, truncated: false,
  };
  for (const m of document.querySelectorAll('meta')) {
    if (String(m.getAttribute('name') || '').trim().toLowerCase() === 'viewport') out.viewports.push(String(m.getAttribute('content') || ''));
  }
  if (!body) return out;
  const cs = el => { try { return getComputedStyle(el); } catch (e) { return null; } };
  for (const e of [doc, body]) { const s = e && cs(e); if (s && /^(hidden|clip)$/i.test(String(s.overflowX || ''))) out.rootClips = true; }

  const isTarget = el => {
    const t = String(el.tagName || '').toUpperCase();
    if (t === 'A') return el.hasAttribute('href');
    if (t === 'BUTTON' || t === 'SELECT' || t === 'TEXTAREA' || t === 'SUMMARY') return true;
    if (t === 'INPUT') return String(el.getAttribute('type') || '').toLowerCase() !== 'hidden';
    return ROLES.has(String(el.getAttribute('role') || '').trim().toLowerCase());
  };
  const describe = el => {
    let d = String(el.tagName || '').toLowerCase();
    const id = el.getAttribute('id'); if (id) d += '#' + id;
    const cls = clean(el.getAttribute('class')).split(' ').filter(Boolean).slice(0, 2);
    if (cls.length) d += '.' + cls.join('.');
    return d;
  };
  const labelOf = el => clean(el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') ||
    el.getAttribute('value') || el.getAttribute('placeholder') || el.getAttribute('alt') || el.getAttribute('name') || '').slice(0, 60);
  const ownText = el => clean([...el.childNodes].filter(n => n.nodeType === 3).map(n => n.nodeValue).join(' '));
  const offenders = new Set();

  for (const el of body.querySelectorAll('*')) {
    out.total++;
    if (out.scanned >= MAX) { out.truncated = true; continue; }
    const s = cs(el);
    if (!s || s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse') continue;
    if (!(parseFloat(s.opacity === '' || s.opacity == null ? 1 : s.opacity) > 0)) continue;
    let r; try { r = el.getBoundingClientRect(); } catch (e) { continue; }
    if (!r || !(r.width > 0 && r.height > 0)) continue;
    out.scanned++;

    // Horizontal overflow: outermost element past the right edge, not inside a clipping/scrolling box.
    if (r.right > vw + 1 && s.position !== 'fixed' && out.overflow.length < MAX_OVERFLOW) {
      let skip = false;
      for (let p = el.parentElement; p && p !== body && p !== doc; p = p.parentElement) {
        if (offenders.has(p)) { skip = true; break; }
        const ps = cs(p);
        if (ps && (CLIPS.has(String(ps.overflowX || '').toLowerCase()) || ps.position === 'fixed')) { skip = true; break; }
      }
      if (!skip) {
        offenders.add(el);
        out.overflow.push({ tag: String(el.tagName).toLowerCase(), desc: describe(el), label: ownText(el).slice(0, 40), left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) });
      }
    }

    // Tap targets.
    if (isTarget(el) && out.targets.length < MAX_TARGETS) {
      let nested = false;
      for (let p = el.parentElement; p && p !== body; p = p.parentElement) if (isTarget(p)) { nested = true; break; }
      if (nested) continue;
      let w = r.width, h = r.height, label = labelOf(el);
      const type = String(el.getAttribute('type') || '').toLowerCase();
      if (String(el.tagName).toUpperCase() === 'INPUT' && (type === 'checkbox' || type === 'radio')) {
        for (const lab of el.labels ? [...el.labels] : []) {
          let lr; try { lr = lab.getBoundingClientRect(); } catch (e) { continue; }
          if (lr && lr.width * lr.height > w * h) { w = lr.width; h = lr.height; label = labelOf(lab) || label; }
        }
      }
      const parent = el.parentElement;
      const inline = String(el.tagName).toUpperCase() === 'A' && s.display === 'inline' && !!parent && ownText(parent).length > 0;
      out.targets.push({ tag: String(el.tagName).toLowerCase(), desc: describe(el), label, width: Math.round(w * 10) / 10, height: Math.round(h * 10) / 10, inline });
    }
  }
  return out;
})();
