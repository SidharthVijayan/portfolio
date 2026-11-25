// Injected after content/extract.js, only when the user opens the popup (or presses "Show numbers").
// Draws the numbers layer: one numbered badge and outline per Tab stop, a thin line from each stop to the
// next, and an ✕ on controls Tab never reaches. Everything lives in one element appended to <html> with
// its own shadow root, which ignores the mouse (pointer-events: none) and never takes focus, so the page
// works as before. Badges of elements scrolled out of view are hidden until they scroll back. The page's own content, attributes and styles are not touched. When the page scrolls
// or resizes the badges follow; when focus moves (the user pressing Tab) the badge of the focused element
// is highlighted. Esc, "Hide numbers" in the popup, or reloading the page removes the layer completely.
// Reads only self.__ifoEls (set by extract.js) and self.__ifoPlan (set by the popup) in the extension's
// isolated world. Sends nothing. Returns how many badges were drawn.
(() => {
  if (typeof self.__ifoClear === 'function') self.__ifoClear();
  const els = self.__ifoEls || [], plan = (self.__ifoPlan || []).slice(0, 1500);
  const HOST = 'data-innershift-focus-order';
  const COLOR = { ok: '#4f46e5', check: '#d97706', problem: '#dc2626' };
  const host = document.createElement('div');
  host.setAttribute(HOST, '');
  host.style.cssText = 'all:initial;position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none;';
  const shadow = host.attachShadow({ mode: 'open' });
  const css = document.createElement('style');
  css.textContent = `
    :host{all:initial}
    .box{position:fixed;border:2px solid;border-radius:3px;box-sizing:border-box;opacity:.75}
    .b{position:fixed;min-width:22px;height:22px;padding:0 5px;border-radius:11px;box-sizing:border-box;color:#fff;
       font:700 12px/18px system-ui,-apple-system,"Segoe UI",Arial,sans-serif;text-align:center;border:2px solid #fff;
       box-shadow:0 1px 4px rgba(0,0,0,.45);white-space:nowrap}
    .b.active{transform:scale(1.45);box-shadow:0 0 0 4px rgba(250,204,21,.9),0 2px 6px rgba(0,0,0,.5);z-index:2}
    .box.active{opacity:1;border-width:3px}
    svg{position:fixed;left:0;top:0;overflow:visible}`;
  shadow.appendChild(css);
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('fill', 'none'); path.setAttribute('stroke', '#4f46e5'); path.setAttribute('stroke-width', '2');
  path.setAttribute('stroke-opacity', '.55'); path.setAttribute('stroke-dasharray', '6 4');
  svg.appendChild(path);
  shadow.appendChild(svg);
  const marks = [];
  for (const p of plan) {
    const el = els[p.i]; if (!el) continue;
    const box = document.createElement('div'); box.className = 'box'; box.style.borderColor = COLOR[p.sev] || COLOR.ok;
    const b = document.createElement('div'); b.className = 'b'; b.style.background = COLOR[p.sev] || COLOR.ok;
    b.textContent = p.n == null ? '✕' : String(p.n);
    b.dataset.n = p.n == null ? 'x' : String(p.n);
    shadow.appendChild(box); shadow.appendChild(b);
    marks.push({ p, el, box, b });
  }
  const W = () => document.documentElement.clientWidth || innerWidth, H = () => document.documentElement.clientHeight || innerHeight;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  let raf = 0;
  function layout() {
    raf = 0;
    const w = W(), h = H();
    svg.setAttribute('width', String(w)); svg.setAttribute('height', String(h));
    const segs = [];
    let gap = true;
    for (const m of marks) {
      const r = m.el.getBoundingClientRect();
      m.box.style.left = r.left + 'px'; m.box.style.top = r.top + 'px'; m.box.style.width = r.width + 'px'; m.box.style.height = r.height + 'px';
      m.box.style.display = r.width < 1 || r.height < 1 ? 'none' : '';
      // Scrolled out of view (above or below): no badge. Off to the side (like a skip link): pinned to the edge.
      const out = r.bottom < 0 || r.top > h;
      m.b.style.display = out ? 'none' : '';
      const x = clamp(r.left - 11, 0, w - 24), y = clamp(r.top - 11, 0, h - 22);
      m.b.style.left = x + 'px'; m.b.style.top = y + 'px';
      if (m.p.n == null) continue;
      // The line joins consecutive numbered stops; it breaks where a stop is out of view.
      if (out) { gap = true; continue; }
      segs.push((gap ? 'M' : 'L') + (x + 11).toFixed(1) + ' ' + (y + 11).toFixed(1));
      gap = false;
    }
    path.setAttribute('d', segs.join(' '));
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(layout); };
  function onFocus() {
    const a = document.activeElement;
    for (const m of marks) { const on = m.el === a; m.b.classList.toggle('active', on); m.box.classList.toggle('active', on); }
  }
  function onKey(e) { if (e.key === 'Escape' && !e.defaultPrevented) clear(); }
  function clear() {
    removeEventListener('scroll', schedule, true); removeEventListener('resize', schedule);
    document.removeEventListener('focusin', onFocus, true); document.removeEventListener('keydown', onKey, true);
    if (raf) cancelAnimationFrame(raf);
    host.remove();
    self.__ifoClear = null; self.__ifoShow = null;
  }
  self.__ifoClear = clear;
  // "Show" in the popup: bring one element into view and highlight its badge. Does not focus it.
  self.__ifoShow = i => {
    const m = marks.find(x => x.p.i === i); if (!m) return false;
    m.el.scrollIntoView({ block: 'center', inline: 'nearest' });
    for (const x of marks) { x.b.classList.toggle('active', x === m); x.box.classList.toggle('active', x === m); }
    layout();
    return true;
  };
  addEventListener('scroll', schedule, true); addEventListener('resize', schedule);
  document.addEventListener('focusin', onFocus, true); document.addEventListener('keydown', onKey, true);
  document.documentElement.appendChild(host);
  layout(); onFocus();
  return marks.length;
})();
