// Print Cleaner: hides the chosen parts of the page, injected into the active tab when the user presses Clean
// page or Print in the popup (activeTab + scripting). Hiding is done by adding one attribute
// (data-print-cleaner-hide) to each chosen element, plus one <style> element that hides elements with that
// attribute. Nothing is deleted: Restore page (or a reload) takes the attributes, the style and the small
// on-page bar away again. The bar (in its own shadow root, never printed) offers Print, Remove more (click
// parts of the page to hide them, with Undo), and Restore page. "Write link addresses" adds the full address
// of each web link as an attribute that the print style shows after the link, on paper only.
(() => {
  'use strict';
  const HIDE = 'data-print-cleaner-hide', UI = 'data-print-cleaner-ui', HREF = 'data-print-cleaner-href';
  const CSS = `[${HIDE}]{display:none !important}
@media print{[${UI}]{display:none !important}a[${HREF}]::after{content:" (" attr(${HREF}) ")";font-size:90%;word-break:break-all}}`;
  const BAR_CSS = `:host{all:initial}
.panel{box-sizing:border-box;width:304px;font:13px/1.35 system-ui,-apple-system,"Segoe UI",Arial,sans-serif;background:#0f172a;color:#e2e8f0;border-radius:10px;padding:10px 12px;box-shadow:0 6px 24px rgba(0,0,0,.35)}
.top{display:flex;align-items:center;justify-content:space-between;font-weight:700;color:#5eead4;margin-bottom:4px}
.msg{margin:0 0 8px;color:#e2e8f0}
.row{display:flex;flex-wrap:wrap;gap:6px}
button{font:inherit;font-size:12px;border:0;border-radius:6px;cursor:pointer;padding:6px 9px;background:#1e293b;color:#e2e8f0}
button.primary{background:#0d9488;color:#fff;font-weight:600}
button.on{background:#b91c1c;color:#fff}
button:disabled{opacity:.45;cursor:default}
button:focus-visible{outline:2px solid #5eead4;outline-offset:2px}
.x{background:transparent;color:#94a3b8;padding:0 4px;font-size:16px;line-height:1}
.box{position:fixed;display:none;pointer-events:none;border:2px solid #ef4444;background:rgba(239,68,68,.14);border-radius:2px;box-sizing:border-box}`;

  if (!self.__pcApi) {
    const mk = (doc, tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
    let st = null;
    function ensure() {
      if (st) return st;
      st = { hidden: new Map(), history: [], links: false, linkEls: [], picking: false, hover: null, stack: [] };
      self.__pcState = st;
      const style = document.createElement('style');
      style.setAttribute(UI, '');
      style.textContent = CSS;
      (document.head || document.documentElement).appendChild(style);
      st.style = style;
      const host = document.createElement('div');
      host.setAttribute(UI, '');
      host.style.cssText = 'all:initial;display:block;position:fixed;top:12px;right:12px;z-index:2147483647';
      const root = host.attachShadow({ mode: 'open' });
      const css = document.createElement('style'); css.textContent = BAR_CSS; root.appendChild(css);
      const panel = mk(document, 'div', 'panel');
      panel.setAttribute('role', 'region'); panel.setAttribute('aria-label', 'Print Cleaner');
      const top = mk(document, 'div', 'top');
      top.appendChild(mk(document, 'span', null, 'Print Cleaner'));
      const x = mk(document, 'button', 'x', '×'); x.type = 'button'; x.title = 'Hide this bar (the page stays cleaned)'; x.setAttribute('aria-label', x.title);
      top.appendChild(x);
      const msg = mk(document, 'p', 'msg'); msg.setAttribute('role', 'status');
      const row = mk(document, 'div', 'row');
      const b = {};
      for (const [k, text, cls] of [['print', 'Print', 'primary'], ['pick', 'Remove more'], ['undo', 'Undo'], ['restore', 'Restore page']]) {
        b[k] = mk(document, 'button', cls || null, text); b[k].type = 'button'; b[k].dataset.act = k; row.appendChild(b[k]);
      }
      panel.appendChild(top); panel.appendChild(msg); panel.appendChild(row); root.appendChild(panel);
      const box = mk(document, 'div', 'box'); root.appendChild(box);
      document.documentElement.appendChild(host);
      Object.assign(st, { host, msg, b, box });
      b.print.addEventListener('click', () => { stopPick(); window.print(); });
      b.pick.addEventListener('click', () => (st.picking ? stopPick() : startPick()));
      b.undo.addEventListener('click', undo);
      b.restore.addEventListener('click', restore);
      x.addEventListener('click', () => { stopPick(); host.style.display = 'none'; });
      return st;
    }
    function update() {
      if (!st) return;
      const n = st.hidden.size;
      st.msg.textContent = st.picking
        ? 'Click any part of the page to remove it. Press ↑ to pick the larger part around it, Esc when done.'
        : `${n} ${n === 1 ? 'part' : 'parts'} removed. This is what will print.`;
      st.b.pick.textContent = st.picking ? 'Done' : 'Remove more';
      st.b.pick.className = st.picking ? 'on' : '';
      st.b.undo.disabled = !st.history.length;
    }
    function hide(list, how) {
      const done = [];
      for (const el of list) {
        if (!el || !el.isConnected || st.hidden.has(el)) continue;
        el.setAttribute(HIDE, '');
        st.hidden.set(el, how); done.push(el);
      }
      if (done.length) st.history.push({ how, els: done });
      return done.length;
    }
    function unhide(el) { el.removeAttribute(HIDE); st.hidden.delete(el); }
    function undo() {
      const h = st && st.history.pop();
      if (h) for (const el of h.els) if (st.hidden.get(el) === h.how) unhide(el);
      if (st && st.hover && !st.hover.isConnected) st.hover = null;
      update();
    }
    function setLinks(on) {
      for (const a of st.linkEls) a.removeAttribute(HREF);
      st.linkEls = [];
      st.links = !!on;
      if (!on) return;
      for (const a of document.querySelectorAll('a[href]')) {
        if (st.linkEls.length >= 5000) break;
        const raw = (a.getAttribute('href') || '').trim(), abs = String(a.href || '');
        if (!/^https?:/i.test(abs) || raw.startsWith('#')) continue;
        const text = (a.textContent || '').replace(/\s+/g, '').replace(/\/$/, '');
        if (text && abs.replace(/\/$/, '').replace(/^https?:\/\//i, '').toLowerCase() === text.replace(/^https?:\/\//i, '').toLowerCase()) continue;
        a.setAttribute(HREF, abs); st.linkEls.push(a);
      }
    }
    // Remove more: hover outlines the part under the mouse, a click hides it; the page doesn't get the click.
    const fromEvent = e => {
      const path = e.composedPath ? e.composedPath() : [];
      if (path.includes(st.host)) return null;
      const t = e.target;
      if (!t || t.nodeType !== 1 || t === document.documentElement || t === document.body) return null;
      return t;
    };
    function draw(t) {
      st.hover = t;
      if (!t) { st.box.style.display = 'none'; return; }
      const r = t.getBoundingClientRect();
      st.box.style.cssText = `display:block;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
    }
    const on = {
      mousemove(e) { const t = fromEvent(e); if (t !== st.hover && !st.stack.includes(t)) { st.stack = []; draw(t); } },
      mousedown(e) { if (fromEvent(e)) { e.preventDefault(); e.stopPropagation(); } },
      pointerdown(e) { if (fromEvent(e)) { e.preventDefault(); e.stopPropagation(); } },
      mouseup(e) { if (fromEvent(e)) { e.preventDefault(); e.stopPropagation(); } },
      click(e) {
        const t = fromEvent(e); if (!t) return;
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        const target = st.hover && st.hover.contains(t) ? st.hover : t;
        hide([target], 'pick'); st.stack = []; draw(null); update();
      },
      keydown(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); stopPick(); }
        else if (e.key === 'ArrowUp' && st.hover) {
          const p = st.hover.parentElement;
          if (p && p !== document.body && p !== document.documentElement) { e.preventDefault(); st.stack.push(st.hover); draw(p); }
        } else if (e.key === 'ArrowDown' && st.stack.length) { e.preventDefault(); draw(st.stack.pop()); }
      },
    };
    function startPick() {
      if (st.picking) return;
      st.picking = true;
      for (const [k, f] of Object.entries(on)) window.addEventListener(k, f, true);
      update();
    }
    function stopPick() {
      if (!st || !st.picking) return;
      st.picking = false;
      for (const [k, f] of Object.entries(on)) window.removeEventListener(k, f, true);
      st.stack = []; draw(null); update();
    }
    function apply(plan) {
      ensure();
      st.host.style.display = 'block';
      for (const [el, how] of [...st.hidden]) if (how === 'auto') unhide(el);
      st.history = st.history.filter(h => h.how !== 'auto');
      const els = self.__pcEls || [];
      hide((plan.hide || []).map(i => els[i]), 'auto');
      setLinks(plan.links);
      update();
      return { hidden: st.hidden.size, links: st.linkEls.length };
    }
    function restore() {
      if (!st) return false;
      stopPick();
      for (const el of [...st.hidden.keys()]) unhide(el);
      setLinks(false);
      st.style.remove(); st.host.remove();
      st = null; delete self.__pcState;
      return true;
    }
    self.__pcApi = { apply, restore, undo, startPick, stopPick, state: () => st };
  }
  return self.__pcApi.apply(self.__pcPlan || { hide: [], links: false });
})();
