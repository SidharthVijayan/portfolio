// Injected on click via chrome.scripting.executeScript({ files: ['content/extract.js'] }).
// READ-ONLY: returns the page's address and protocol, every http:// address used by a script, stylesheet, iframe,
// frame, object, embed, image (src/srcset), picture source, video, audio, video poster, image button or CSS url()
// written in the page (<style> elements and style="" attributes), and every form with its action address, method,
// field count and whether it has a password field. Query strings and #fragments are dropped. It reads no text,
// no values typed into forms and no other tabs, makes no requests and never modifies the page.
(() => {
  const MAX_ITEMS = 5000;
  const base = document.baseURI || location.href;
  const clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const resolve = s => { try { return new URL(String(s).trim(), base); } catch (e) { return null; } };
  const addr = u => u.origin + u.pathname;
  const tagOf = el => String(el.tagName || '').toLowerCase();
  const describe = el => {
    let d = tagOf(el);
    const id = clean(el.getAttribute('id')); if (id) d += '#' + id.slice(0, 40);
    const cls = clean(el.getAttribute('class')).split(' ')[0]; if (cls) d += '.' + cls.slice(0, 30);
    if (d === 'source' && el.parentElement) d += ' in ' + tagOf(el.parentElement);
    if (d === 'link') d += ' rel=stylesheet';
    return d;
  };
  const items = [];
  let total = 0, checked = 0;
  const add = (kind, raw, el) => {
    if (raw == null || !String(raw).trim()) return;
    const u = resolve(raw); if (!u) return;
    checked++;
    if (u.protocol !== 'http:') return;
    total++;
    if (items.length < MAX_ITEMS) items.push({ kind, url: addr(u), el: describe(el) });
  };
  const srcset = (kind, v, el) => { for (const part of String(v || '').split(/,(?=\s*\S)/)) add(kind, part.trim().split(/\s+/)[0], el); };
  const has = (el, a) => el.getAttribute(a) != null;

  for (const el of document.querySelectorAll('script')) add('script', el.getAttribute('src'), el);
  for (const el of document.querySelectorAll('link')) {
    const rel = ' ' + clean(el.getAttribute('rel')).toLowerCase() + ' ';
    if (rel.includes(' stylesheet ')) add('stylesheet', el.getAttribute('href'), el);
  }
  for (const el of document.querySelectorAll('iframe')) add('iframe', el.getAttribute('src'), el);
  for (const el of document.querySelectorAll('frame')) add('frame', el.getAttribute('src'), el);
  for (const el of document.querySelectorAll('object')) add('object', el.getAttribute('data'), el);
  for (const el of document.querySelectorAll('embed')) add('embed', el.getAttribute('src'), el);
  for (const el of document.querySelectorAll('img')) { add('img', el.getAttribute('src'), el); if (has(el, 'srcset')) srcset('srcset', el.getAttribute('srcset'), el); }
  for (const el of document.querySelectorAll('source')) {
    const p = el.parentElement ? tagOf(el.parentElement) : '';
    if (p === 'picture') srcset('picture', el.getAttribute('srcset'), el);
    else if (p === 'video' || p === 'audio') add(p, el.getAttribute('src'), el);
  }
  for (const el of document.querySelectorAll('video')) { add('video', el.getAttribute('src'), el); add('poster', el.getAttribute('poster'), el); }
  for (const el of document.querySelectorAll('audio')) add('audio', el.getAttribute('src'), el);
  for (const el of document.querySelectorAll('input')) if (clean(el.getAttribute('type')).toLowerCase() === 'image') add('input-image', el.getAttribute('src'), el);

  // CSS written in the page: @import first (blocked), then url() (fonts blocked, images upgraded; guessed from file type).
  const css = (text, el) => {
    text = String(text || '').replace(/\/\*[\s\S]*?\*\//g, '');
    text = text.replace(/@import\s+(?:url\(\s*)?["']?([^"')\s;]+)["']?\s*\)?/gi, (m, u) => { add('css-import', u, el); return ''; });
    for (const m of text.matchAll(/url\(\s*["']?([^"')]+?)["']?\s*\)/gi)) {
      if (/^data:/i.test(m[1])) continue;
      add(/\.(woff2?|ttf|otf|eot)$/i.test(m[1].split(/[?#]/)[0]) ? 'css-font' : 'css-image', m[1], el);
    }
  };
  for (const el of document.querySelectorAll('style')) css(el.textContent, el);
  for (const el of document.querySelectorAll('[style]')) css(el.getAttribute('style'), el);

  const forms = [];
  for (const f of document.querySelectorAll('form')) {
    const raw = f.getAttribute('action');
    const u = resolve(raw == null || !String(raw).trim() ? location.href : raw);
    const fields = [...f.querySelectorAll('input, select, textarea')].filter(i => !/^(hidden|submit|button|reset|image)$/i.test(clean(i.getAttribute('type'))));
    const password = fields.some(i => clean(i.getAttribute('type')).toLowerCase() === 'password');
    const method = clean(f.getAttribute('method')).toLowerCase() === 'post' ? 'POST' : 'GET';
    if (forms.length < MAX_ITEMS) forms.push({ el: describe(f), url: u ? addr(u) : '', protocol: u ? u.protocol : '', method, fields: fields.length, password });
    for (const b of f.querySelectorAll('button, input')) {
      const fa = b.getAttribute('formaction');
      if (fa == null || !String(fa).trim()) continue;
      const bu = resolve(fa);
      if (bu && forms.length < MAX_ITEMS) forms.push({ el: describe(b) + ' in ' + describe(f), url: addr(bu), protocol: bu.protocol, method, fields: fields.length, password, button: true });
    }
  }

  let uir = false;
  for (const m of document.querySelectorAll('meta')) {
    if (clean(m.getAttribute('http-equiv')).toLowerCase() === 'content-security-policy' && /(^|[;\s])upgrade-insecure-requests([;\s]|$)/i.test(clean(m.getAttribute('content')))) uir = true;
  }
  const frames = document.querySelectorAll('iframe, frame').length;
  return { url: location.href, protocol: location.protocol, title: clean(document.title || ''), items, forms, uir, frames, checked, total, truncated: total > items.length };
})();
