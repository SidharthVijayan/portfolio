// Visible Area Screenshot Annotator: pure logic (no DOM, no chrome.*), shared by the editor and the tests.
// Shapes are stored in image pixels (the captured PNG's own size), so the saved PNG is full resolution.
(function (root) {
  'use strict';

  const TOOLS = ['box', 'arrow', 'highlight', 'text', 'redact'];
  const TOOL_NAMES = { box: 'Box', arrow: 'Arrow', highlight: 'Highlight', text: 'Text', redact: 'Redact' };
  const COLOURS = ['#e11d48', '#f59e0b', '#2563eb', '#16a34a', '#111827', '#ffffff'];
  const WIDTHS = { thin: 3, thick: 6 };
  const MIN_DRAG = 4;          // image px; shorter drags are treated as a click and ignored
  const MAX_TEXT = 200;        // characters per text label
  const STAMP_H = 36;          // footer height (image px, before scale)

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const clampPoint = (p, w, h) => ({ x: clamp(Math.round(p.x), 0, w), y: clamp(Math.round(p.y), 0, h) });

  // Size factor so lines and text look the same on 1x and 2x (HiDPI) captures.
  function scaleFor(imgW) { return Math.max(1, Math.round((imgW / 1280) * 4) / 4); }

  // Screen (CSS px inside the displayed canvas) -> image px.
  function toImage(clientX, clientY, rect, imgW, imgH) {
    const x = (clientX - rect.left) * (imgW / rect.width);
    const y = (clientY - rect.top) * (imgH / rect.height);
    return clampPoint({ x, y }, imgW, imgH);
  }

  // Build a shape from a drag (start -> end). Returns null for a click / too-small drag.
  function makeShape(tool, a, b, style, imgW, imgH) {
    if (!TOOLS.includes(tool) || tool === 'text') return null;
    a = clampPoint(a, imgW, imgH); b = clampPoint(b, imgW, imgH);
    const dx = b.x - a.x, dy = b.y - a.y;
    if (Math.hypot(dx, dy) < MIN_DRAG) return null;
    const colour = COLOURS.includes(style.colour) ? style.colour : COLOURS[0];
    const width = WIDTHS[style.width] || WIDTHS.thin;
    if (tool === 'arrow') return { tool, x1: a.x, y1: a.y, x2: b.x, y2: b.y, colour, width };
    const r = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(dx), h: Math.abs(dy) };
    if (r.w < 1 || r.h < 1) return null; // a flat line is not a box
    if (tool === 'redact') return { tool, ...r }; // always solid black, colour ignored
    return { tool, ...r, colour, width };
  }

  function makeText(at, text, style, imgW, imgH) {
    const t = String(text || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, MAX_TEXT);
    if (!t) return null;
    const p = clampPoint(at, imgW, imgH);
    const colour = COLOURS.includes(style.colour) ? style.colour : COLOURS[0];
    return { tool: 'text', x: p.x, y: p.y, text: t, colour, size: style.width === 'thick' ? 28 : 20 };
  }

  // Arrow head: two points behind the tip, at +/- 28 degrees.
  function arrowHead(x1, y1, x2, y2, lineWidth) {
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const len = Math.min(Math.max(12, lineWidth * 4.5), Math.hypot(x2 - x1, y2 - y1) * 0.6 || 12);
    const spread = (28 * Math.PI) / 180;
    return [
      { x: x2 - len * Math.cos(ang - spread), y: y2 - len * Math.sin(ang - spread) },
      { x: x2 - len * Math.cos(ang + spread), y: y2 - len * Math.sin(ang + spread) },
    ];
  }

  function hexToRgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

  // Draw shapes on a CanvasRenderingContext2D-like object. k = scaleFor(image width).
  function drawShapes(ctx, shapes, k) {
    for (const s of shapes) {
      ctx.save();
      if (s.tool === 'box') {
        ctx.strokeStyle = s.colour; ctx.lineWidth = s.width * k; ctx.lineJoin = 'round';
        ctx.strokeRect(s.x, s.y, s.w, s.h);
      } else if (s.tool === 'highlight') {
        ctx.fillStyle = hexToRgba(s.colour, 0.35);
        ctx.fillRect(s.x, s.y, s.w, s.h);
      } else if (s.tool === 'redact') {
        ctx.globalAlpha = 1; ctx.fillStyle = '#000000';
        ctx.fillRect(s.x, s.y, s.w, s.h);
      } else if (s.tool === 'arrow') {
        const lw = s.width * k;
        ctx.strokeStyle = s.colour; ctx.fillStyle = s.colour; ctx.lineWidth = lw; ctx.lineCap = 'round';
        const [p, q] = arrowHead(s.x1, s.y1, s.x2, s.y2, lw);
        // shaft stops at the base of the head so the tip stays sharp
        const bx = (p.x + q.x) / 2, by = (p.y + q.y) / 2;
        ctx.beginPath(); ctx.moveTo(s.x1, s.y1); ctx.lineTo(bx, by); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(s.x2, s.y2); ctx.lineTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.closePath(); ctx.fill();
      } else if (s.tool === 'text') {
        const size = Math.round(s.size * k);
        ctx.font = `600 ${size}px system-ui, -apple-system, "Segoe UI", Arial, sans-serif`;
        ctx.textBaseline = 'top';
        ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(3, Math.round(size / 5));
        ctx.strokeStyle = s.colour === '#ffffff' ? '#111827' : '#ffffff';
        ctx.strokeText(s.text, s.x, s.y);
        ctx.fillStyle = s.colour;
        ctx.fillText(s.text, s.x, s.y);
      }
      ctx.restore();
    }
  }

  // Undo / redo history of the shape list. Clear is a normal step, so it can be undone.
  function createHistory() {
    let present = [], past = [], future = [];
    return {
      get shapes() { return present.slice(); },
      get canUndo() { return past.length > 0; },
      get canRedo() { return future.length > 0; },
      add(shape) { if (!shape) return false; past.push(present); present = present.concat([shape]); future = []; return true; },
      clear() { if (!present.length) return false; past.push(present); present = []; future = []; return true; },
      undo() { if (!past.length) return false; future.push(present); present = past.pop(); return true; },
      redo() { if (!future.length) return false; past.push(present); present = future.pop(); return true; },
    };
  }

  const pad = n => String(n).padStart(2, '0');
  function stamp(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; }

  function hostOf(url) {
    try { const u = new URL(url); return u.hostname || ''; } catch (e) { return ''; }
  }

  // screenshot-<host>-YYYY-MM-DD-HHMMSS.png (capture time, local); later saves of the same capture get -2, -3…
  function fileName(url, d, n) {
    const host = hostOf(url).toLowerCase().replace(/^www\./, '').replace(/[^a-z0-9.-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 60) || 'page';
    return `screenshot-${host}-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}${n > 1 ? '-' + n : ''}.png`;
  }

  // Footer text "address · captured YYYY-MM-DD HH:MM", shortened with … to fit maxWidth.
  function stampText(url, d, measure, maxWidth) {
    let addr = String(url || '');
    const tail = `${addr ? ' · ' : ''}captured ${stamp(d)}`;
    if (measure(addr + tail) <= maxWidth) return addr + tail;
    let lo = 0, hi = addr.length;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (measure(addr.slice(0, mid) + '…' + tail) <= maxWidth) lo = mid; else hi = mid - 1; }
    return addr.slice(0, lo) + '…' + tail;
  }

  function stampHeight(imgW) { return Math.round(STAMP_H * scaleFor(imgW)); }

  function drawStamp(ctx, url, d, imgW, imgH) {
    const k = scaleFor(imgW), h = stampHeight(imgW), size = Math.round(14 * k), padX = Math.round(12 * k);
    ctx.save();
    ctx.fillStyle = '#111827'; ctx.fillRect(0, imgH, imgW, h);
    ctx.font = `${size}px ui-monospace, Menlo, Consolas, monospace`;
    ctx.textBaseline = 'middle'; ctx.fillStyle = '#e5e7eb';
    const text = stampText(url, d, s => ctx.measureText(s).width, imgW - padX * 2);
    ctx.fillText(text, padX, imgH + h / 2);
    ctx.restore();
    return text;
  }

  // Message for a capture that failed or can't be found.
  function captureMessage(entry) {
    if (!entry) return 'This capture is no longer available. Captures are kept only in memory, briefly, until this tab picks them up. Go back to the page and click the toolbar button again.';
    if (entry.ok) return '';
    const url = String(entry.url || ''), err = String(entry.error || '');
    if (/^file:/i.test(url) || /file:\/\//i.test(err))
      return 'Local files can only be captured if you turn on "Allow access to file URLs" for this extension on the chrome://extensions page.';
    if (/MAX_CAPTURE|quota|per second/i.test(err)) return 'Chrome allows only a couple of captures per second. Wait a moment and click the toolbar button again.';
    if (/cannot access|permission|cannot be scripted|not allowed/i.test(err))
      return 'Chrome did not let the extension capture this tab. This happens on blank tabs and some browser pages. Open the page you want to capture and click the toolbar button again.';
    return 'This tab could not be captured' + (err ? ` (${err})` : '') + '. Go back to the page and click the toolbar button again.';
  }

  // Header line for the editor. Chrome does not give the address of some browser pages; then "This tab".
  function pageLabel(entry, at, w, h) {
    const host = hostOf(entry.url);
    const name = entry.title || host || entry.url || 'This tab';
    const parts = [name];
    if (host && host !== name) parts.push(host);
    parts.push(`captured ${stamp(at)}`, `${w}×${h} px`);
    return parts.join(' · ');
  }

  const api = { TOOLS, TOOL_NAMES, COLOURS, WIDTHS, MIN_DRAG, MAX_TEXT, clampPoint, scaleFor, toImage, makeShape, makeText, arrowHead, hexToRgba, drawShapes, createHistory, fileName, hostOf, stamp, stampText, stampHeight, drawStamp, captureMessage, pageLabel };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AnnotatorCore = api;
})(typeof self !== 'undefined' ? self : globalThis);
