// Reading Ruler: the on-page ruler. Injected by the popup (after lib/core.js) only when the user presses
// "Turn on ruler" or changes a setting while it is on. Draws a tinted band across the window with the rest of the
// window dimmed above and below it, inside one element added at the end of the page (closed shadow root, fixed
// position, pointer-events: none, so every click still reaches the page; hidden when printing). The band follows
// the mouse up and down, lining itself up with the text lines under it, and/or moves a few text lines per ↑ / ↓ key press (the page scrolls when it reaches the
// top or bottom edge); keys typed into text boxes and editors are never taken. Esc, "Turn off ruler" or a reload
// removes the element and every listener, leaving the page exactly as it was.
(() => {
  const Core = self.RulerCore;
  const want = Core.normalize(self.__rrWant);
  if (self.__rrApi) { self.__rrApi.update(want); return self.__rrApi.state(); }

  let s = want, lineH = self.__rrLine || 24, vh = window.innerHeight || 800;
  let h = Core.barHeight(lineH, s.lines, vh), top = Core.start(h, vh), hintTimer = 0;

  const host = document.createElement('div');
  host.style.cssText = 'all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; contain: strict;';
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = [
    ':host { all: initial; }',
    '.wrap, .wrap * { pointer-events: none; box-sizing: border-box; }',
    '.dim, .band { position: absolute; left: 0; right: 0; margin: 0; }',
    '.above { top: 0; }',
    '.band { border-top: 2px solid; border-bottom: 2px solid; }',
    '.hint { position: absolute; left: 50%; bottom: 24px; transform: translateX(-50%); background: #0f172a; color: #f8fafc;',
    '  font: 13px/1.4 system-ui, -apple-system, "Segoe UI", Arial, sans-serif; padding: 8px 14px; border-radius: 8px;',
    '  box-shadow: 0 4px 16px rgba(0,0,0,.25); opacity: .96; transition: opacity .4s; white-space: nowrap; }',
    '.hint.gone { opacity: 0; }',
    '@media print { :host, .wrap { display: none !important; } }',
  ].join('\n');
  const wrap = document.createElement('div'); wrap.className = 'wrap';
  const above = document.createElement('div'); above.className = 'dim above';
  const band = document.createElement('div'); band.className = 'band';
  const below = document.createElement('div'); below.className = 'dim below';
  const hint = document.createElement('div'); hint.className = 'hint';
  wrap.append(above, band, below, hint);
  root.append(style, wrap);

  function paint() {
    const c = Core.look(s);
    above.style.height = top + 'px';
    above.style.background = c.dim;
    band.style.top = top + 'px';
    band.style.height = h + 'px';
    band.style.background = c.band;
    band.style.borderColor = c.edge;
    below.style.top = (top + h) + 'px';
    below.style.bottom = '0px';
    below.style.background = c.dim;
  }
  function showHint() {
    hint.textContent = 'Reading Ruler: ' + Core.moves(s) + ' Esc turns it off.';
    hint.className = 'hint';
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => { hint.className = 'hint gone'; }, 4000);
  }

  // Middle of the text line at (x, y), from the caret position Chrome finds there, if that line is body text of the
  // page's usual line height. null over pictures, empty space, headings or captions.
  function lineAt(x, y) {
    if (typeof document.caretRangeFromPoint !== 'function') return null;
    const r = document.caretRangeFromPoint(x, y);
    const n = r && r.startContainer;
    if (!n || n.nodeType !== 3 || !n.data || !n.parentElement) return null;
    const cs = getComputedStyle(n.parentElement);
    if (!Core.sameLine(Core.px(cs.lineHeight, cs.fontSize), lineH)) return null;
    for (const o of [r.startOffset, r.startOffset - 1]) {
      if (o < 0 || o >= n.data.length) continue;
      const g = document.createRange();
      g.setStart(n, o); g.setEnd(n, o + 1);
      const b = g.getBoundingClientRect();
      if (!b || !b.height) continue;
      const c = b.top + b.height / 2;
      if (Math.abs(c - y) <= lineH / 2 + 1) return c;
    }
    return null;
  }
  let lastX = null;
  function onMouse(e) {
    if (!s.mouse) return;
    lastX = e.clientX;
    const c = lineAt(e.clientX, e.clientY);
    top = Core.place(c == null ? e.clientY : Core.snapTop(c, lineH, s.lines) + h / 2, h, vh);
    paint();
  }
  function target(e) {
    let t = (e.composedPath && e.composedPath()[0]) || e.target || document.activeElement;
    if (!t || t.nodeType !== 1) t = document.activeElement;
    if (!t || t.nodeType !== 1) return null;
    return { tag: t.tagName, type: t.getAttribute && t.getAttribute('type'), editable: !!t.isContentEditable, role: t.getAttribute && t.getAttribute('role') };
  }
  function onKey(e) {
    const a = Core.keyAction({ key: e.key, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, typing: Core.isTyping(target(e)) }, s);
    if (!a) return;
    if (a === 'off') { api.remove(); return; }
    e.preventDefault();
    const dir = a === 'down' ? 1 : -1;
    const r = Core.step(top, h, dir, vh, lineH, s.lines);
    // Line the ruler up with the text it lands on (never back past where it was).
    const c = r.scroll ? null : lineAt(lastX == null ? Math.round(window.innerWidth / 2) : lastX, Core.readY(r.top, lineH, s.lines));
    const snapped = c == null ? r.top : Core.place(Core.snapTop(c, lineH, s.lines) + h / 2, h, vh);
    top = (snapped - top) * dir > 0 ? snapped : r.top;
    paint();
    if (r.scroll) window.scrollBy(0, r.scroll);
  }
  function onResize() {
    vh = window.innerHeight || vh;
    h = Core.barHeight(lineH, s.lines, vh);
    top = Core.place(top + h / 2, h, vh);
    paint();
  }

  const api = {
    update(next) {
      const mid = top + h / 2;
      s = Core.normalize(next);
      lineH = self.__rrLine || lineH;
      h = Core.barHeight(lineH, s.lines, vh);
      top = Core.place(mid, h, vh);
      paint();
      showHint();
    },
    state() { return Object.assign({}, s); },
    remove() {
      window.removeEventListener('mousemove', onMouse, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onResize, true);
      clearTimeout(hintTimer);
      host.remove();
      delete self.__rrApi;
      return true;
    },
  };
  window.addEventListener('mousemove', onMouse, true);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', onResize, true);
  paint();
  showHint();
  document.documentElement.appendChild(host);
  self.__rrApi = api;
  return api.state();
})();
