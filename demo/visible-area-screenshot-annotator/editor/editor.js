// Editor page: asks the service worker for this tab's capture (once), shows it on a canvas and lets the
// user draw boxes, arrows, highlights, text labels and black redaction blocks, then save or copy a PNG.
// Everything stays in this page's memory. No storage, no network.
'use strict';
self.__annotatorReady = (async function () {
  const C = self.AnnotatorCore;
  const $ = id => document.getElementById(id);
  const els = {};
  for (const id of ['pageInfo', 'status', 'message', 'stage', 'canvas', 'textInput', 'undoBtn', 'redoBtn', 'clearBtn', 'optStamp', 'copyBtn', 'saveBtn', 'widthThin', 'widthThick']) els[id] = $(id);
  const toolBtns = Object.fromEntries(C.TOOLS.map(t => [t, $('tool' + C.TOOL_NAMES[t])]));
  const colourBtns = C.COLOURS.map((_, i) => $('col' + i));

  let saves = 0;
  const st = { tool: 'box', colour: C.COLOURS[0], width: 'thin', stamp: false, drag: null, text: null, history: C.createHistory() };
  const setStatus = (msg, cls) => { els.status.textContent = msg; els.status.className = cls || ''; };
  const allControls = () => [...Object.values(toolBtns), ...colourBtns, els.widthThin, els.widthThick, els.optStamp, els.copyBtn, els.saveBtn];

  // 1. Get the capture from the service worker (it hands it over once, then forgets it).
  const id = (location.hash || '').slice(1);
  let entry = null;
  try { entry = id ? await chrome.runtime.sendMessage({ type: 'getCapture', id }) : null; } catch (e) { entry = null; }
  if (!entry || !entry.ok) {
    els.pageInfo.textContent = entry && entry.url ? entry.url : 'No capture';
    els.message.textContent = C.captureMessage(entry);
    els.message.hidden = false;
    els.stage.hidden = true;
    for (const b of allControls()) b.disabled = true;
    document.title = 'Screenshot Annotator: nothing to show';
    return { ok: false };
  }

  // 2. Load the PNG.
  const img = new Image();
  await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = entry.dataUrl; });
  entry.dataUrl = null; // the decoded image is all we need
  const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height, k = C.scaleFor(W);
  const at = new Date(entry.at || Date.now());
  const host = C.hostOf(entry.url);
  els.pageInfo.textContent = C.pageLabel(entry, at, W, H);
  els.pageInfo.title = entry.url || '';
  document.title = `Screenshot: ${host || entry.title || 'page'}`;
  const ctx = els.canvas.getContext('2d');

  function render(preview) {
    const totalH = H + (st.stamp ? C.stampHeight(W) : 0);
    if (els.canvas.width !== W) els.canvas.width = W;
    if (els.canvas.height !== totalH) els.canvas.height = totalH;
    els.canvas.style.width = Math.round(W / (self.devicePixelRatio || 1)) + 'px';
    ctx.clearRect(0, 0, W, totalH);
    ctx.drawImage(img, 0, 0, W, H);
    C.drawShapes(ctx, preview ? st.history.shapes.concat([preview]) : st.history.shapes, k);
    if (st.stamp) C.drawStamp(ctx, entry.url, at, W, H);
  }
  function refreshButtons() {
    els.undoBtn.disabled = !st.history.canUndo;
    els.redoBtn.disabled = !st.history.canRedo;
    els.clearBtn.disabled = st.history.shapes.length === 0;
  }
  const count = () => { const n = st.history.shapes.length; return `${n} annotation${n === 1 ? '' : 's'}`; };

  function setTool(t) {
    commitText();
    st.tool = t;
    for (const [name, b] of Object.entries(toolBtns)) b.setAttribute('aria-pressed', String(name === t));
    els.canvas.className = t === 'text' ? 'text' : '';
    const tips = { box: 'Drag to draw a box.', arrow: 'Drag from where the arrow starts to what it points at.', highlight: 'Drag over the part to highlight.', text: 'Click where the text should start, type, then press Enter.', redact: 'Drag over anything private. It becomes a solid black block in the saved image.' };
    setStatus(tips[t]);
  }
  function setColour(i) {
    st.colour = C.COLOURS[i];
    colourBtns.forEach((b, j) => b.setAttribute('aria-pressed', String(j === i)));
  }
  function setWidth(w) {
    st.width = w;
    els.widthThin.setAttribute('aria-pressed', String(w === 'thin'));
    els.widthThick.setAttribute('aria-pressed', String(w === 'thick'));
  }

  const pointAt = e => C.clampPoint(C.toImage(e.clientX, e.clientY, els.canvas.getBoundingClientRect(), els.canvas.width, els.canvas.height), W, H);

  // 3. Drawing.
  els.canvas.addEventListener('pointerdown', e => {
    if (e.button !== undefined && e.button !== 0) return;
    if (st.tool === 'text') { openText(e); return; }
    commitText();
    st.drag = { from: pointAt(e) };
    if (els.canvas.setPointerCapture && e.pointerId !== undefined) { try { els.canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ } }
  });
  els.canvas.addEventListener('pointermove', e => {
    if (!st.drag) return;
    render(C.makeShape(st.tool, st.drag.from, pointAt(e), st, W, H));
  });
  const endDrag = e => {
    if (!st.drag) return;
    const shape = C.makeShape(st.tool, st.drag.from, pointAt(e), st, W, H);
    st.drag = null;
    if (st.history.add(shape)) setStatus(`${C.TOOL_NAMES[shape.tool]} added (${count()}). Ctrl+Z undoes it.`, 'good');
    render(); refreshButtons();
  };
  els.canvas.addEventListener('pointerup', endDrag);
  els.canvas.addEventListener('pointercancel', () => { st.drag = null; render(); });

  // Text labels: an input appears where the user clicked; Enter adds it, Escape cancels.
  function openText(e) {
    commitText();
    const p = pointAt(e), r = els.canvas.getBoundingClientRect();
    st.text = { at: p };
    els.textInput.value = '';
    els.textInput.style.left = Math.round(p.x * r.width / els.canvas.width) + 'px';
    els.textInput.style.top = Math.round(p.y * r.height / els.canvas.height) + 'px';
    els.textInput.style.color = st.colour === '#ffffff' ? '#111827' : st.colour;
    els.textInput.hidden = false;
    setTimeout(() => els.textInput.focus(), 0);
    if (e.preventDefault) e.preventDefault();
  }
  function commitText() {
    if (!st.text) return;
    const shape = C.makeText(st.text.at, els.textInput.value, st, W, H);
    st.text = null; els.textInput.hidden = true; els.textInput.value = '';
    if (st.history.add(shape)) setStatus(`Text added (${count()}). Ctrl+Z undoes it.`, 'good');
    render(); refreshButtons();
  }
  function cancelText() { st.text = null; els.textInput.hidden = true; els.textInput.value = ''; }
  els.textInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commitText(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancelText(); }
    if (e.stopPropagation) e.stopPropagation();
  });
  els.textInput.addEventListener('blur', () => commitText());

  // 4. Toolbar.
  for (const t of C.TOOLS) toolBtns[t].addEventListener('click', () => setTool(t));
  colourBtns.forEach((b, i) => b.addEventListener('click', () => setColour(i)));
  els.widthThin.addEventListener('click', () => setWidth('thin'));
  els.widthThick.addEventListener('click', () => setWidth('thick'));
  const undo = () => { commitText(); if (st.history.undo()) setStatus(`Undone (${count()}).`); render(); refreshButtons(); };
  const redo = () => { if (st.history.redo()) setStatus(`Redone (${count()}).`); render(); refreshButtons(); };
  els.undoBtn.addEventListener('click', undo);
  els.redoBtn.addEventListener('click', redo);
  els.clearBtn.addEventListener('click', () => { commitText(); if (st.history.clear()) setStatus('All annotations removed. Undo brings them back.'); render(); refreshButtons(); });
  els.optStamp.addEventListener('change', () => {
    st.stamp = !!els.optStamp.checked; render();
    setStatus(st.stamp ? 'The page address and capture time will be added in a strip under the image.' : 'Address strip removed.');
  });

  const pngBlob = () => new Promise((resolve, reject) => els.canvas.toBlob(b => (b ? resolve(b) : reject(new Error('could not make the PNG'))), 'image/png'));
  async function save() {
    commitText(); render();
    try {
      const blob = await pngBlob();
      const name = C.fileName(entry.url, at, ++saves);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 30000);
      setStatus(`Saved ${name} (${W}×${els.canvas.height} px). Chrome puts it wherever your downloads go.`, 'good');
    } catch (e) { setStatus('Could not save the image: ' + e.message, 'bad'); }
  }
  async function copy() {
    commitText(); render();
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob() })]);
      setStatus(`Copied the image (${W}×${els.canvas.height} px). Paste it into a chat, document or ticket.`, 'good');
    } catch (e) { setStatus('Chrome did not allow copying the image here (' + e.message + '). Use Save PNG instead.', 'bad'); }
  }
  els.saveBtn.addEventListener('click', save);
  els.copyBtn.addEventListener('click', copy);

  document.addEventListener('keydown', e => {
    if (e.target === els.textInput) return;
    const mod = e.ctrlKey || e.metaKey, key = (e.key || '').toLowerCase();
    if (mod && key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
    else if (mod && key === 's') { e.preventDefault(); save(); }
    else if (mod && key === 'c' && !(self.getSelection && String(self.getSelection()))) { e.preventDefault(); copy(); }
    else if (!mod && !e.altKey) {
      const t = { b: 'box', a: 'arrow', h: 'highlight', t: 'text', r: 'redact' }[key];
      if (t) { e.preventDefault(); setTool(t); }
    }
  });

  for (const b of allControls()) b.disabled = false;
  render(); refreshButtons();
  setStatus('Captured. Drag on the image to draw a box, or pick another tool.');
  return { ok: true, W, H };
})();
