'use strict';
(function () {
  const sample = document.getElementById('sampleFrame');
  const popup = document.getElementById('popupFrame');
  const mode = document.body.dataset.mode || 'page';
  let popupLoaded = false;

  function loadPopup() {
    popupLoaded = false;
    popup.onload = () => { popupLoaded = true; maybeAutorun(); };
    if (mode === 'editor') popup.src = 'editor/editor.html#demo';
    else popup.src = 'popup/popup.html';
  }

  function maybeAutorun() {
    if (!popupLoaded) return;
    const doc = popup.contentDocument;
    if (!doc) return;
    const btn = doc.getElementById('runBtn') || doc.getElementById('analyzeBtn');
    if (btn) {
      // Give the shim a tick to see the sample document, then run.
      setTimeout(() => btn.click(), 150);
    }
  }

  window.__demoSampleWindow = () => sample.contentWindow;
  window.__demoMode = mode;

  window.__demoShowToast = function (title, message) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.hidden = false;
    t.textContent = (title ? title + ' — ' : '') + (message || '');
    clearTimeout(window.__toastTimer);
    window.__toastTimer = setTimeout(() => { t.hidden = true; }, 5000);
  };

  window.__demoSetBadge = function (text, color) {
    const b = document.getElementById('demoBadge');
    if (!b) return;
    if (text !== undefined) b.textContent = text || '';
    if (color) b.style.background = color;
  };

  // Sample tab list for Tab List Exporter
  window.__demoTabsReady = fetch('tabs.json').then(r => r.ok ? r.json() : []).catch(() => []).then(tabs => {
    window.__demoTabs = (tabs || []).map((t, i) => Object.assign({
      id: i + 1,
      active: i === 0,
      incognito: !!t.incognito,
      highlighted: !!t.highlighted,
      windowId: t.windowId || 1,
      index: t.index || 0,
      title: t.title || '',
      url: t.url || ''
    }, t));
    return window.__demoTabs;
  });

  function seedSessionFromSample() {
    if (document.body.dataset.session !== 'sample') return;
    try {
      const doc = sample.contentDocument;
      if (!doc) return;
      const parts = [...doc.querySelectorAll('main p:not(.meta), #p1, #p2, #p3')]
        .map(p => (p.innerText || '').trim())
        .filter(Boolean);
      // de-dupe while keeping order
      const seen = new Set();
      const unique = [];
      for (const t of parts) {
        if (seen.has(t)) continue;
        seen.add(t);
        unique.push(t);
      }
      const text = unique.join('\n\n');
      if (text) {
        window.__demoSessionLast = { text, at: Date.now(), source: 'selection' };
        const words = text.trim().split(/\s+/).filter(Boolean).length;
        if (window.__demoSetBadge) window.__demoSetBadge(String(words), '#4f46e5');
      }
    } catch (e) {}
  }

  function applyFocus() {
    const sel = document.body.dataset.focus;
    if (!sel) return;
    try {
      const doc = sample.contentDocument;
      if (!doc) return;
      const el = doc.querySelector(sel);
      if (!el) return;
      el.focus();
      if (typeof el.select === 'function') el.select();
    } catch (e) {}
  }

  async function prepareCapture() {
    if (window.__demoCaptureEntry && window.__demoCaptureEntry.ok) return window.__demoCaptureEntry;
    try {
      const resp = await fetch('sample-capture.png');
      if (!resp.ok) return null;
      const blob = await resp.blob();
      const dataUrl = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = reject;
        fr.readAsDataURL(blob);
      });
      let title = 'Sample page';
      let url = 'https://checkout.demo.example/cart';
      try {
        title = sample.contentDocument.title || title;
        const meta = sample.contentDocument.querySelector('meta[name="demo-page-url"]');
        if (meta && meta.getAttribute('content')) url = meta.getAttribute('content');
      } catch (e) {}
      window.__demoCaptureEntry = { ok: true, dataUrl, url, title, at: Date.now() };
      return window.__demoCaptureEntry;
    } catch (e) {
      return null;
    }
  }

  window.__demoCapture = async function () {
    const entry = await prepareCapture();
    if (!entry || !entry.dataUrl) throw new Error('Sample capture is not available');
    return entry.dataUrl;
  };

  window.__demoOpenUrl = function (url) {
    if (!url) return;
    let src = url;
    const idx = url.lastIndexOf('/editor/');
    if (idx >= 0) src = url.slice(idx + 1); // editor/editor.html#id
    popup.src = src;
  };

  async function afterSampleLoad() {
    seedSessionFromSample();
    applyFocus();
    if (mode === 'editor') await prepareCapture();
    if (!popup.src || popup.src === 'about:blank' || popup.src.endsWith('about:blank')) loadPopup();
    else maybeAutorun();
  }

  sample.addEventListener('load', () => { afterSampleLoad(); });

  document.getElementById('useSample').addEventListener('click', () => {
    sample.removeAttribute('srcdoc');
    sample.src = 'sample.html';
    sample.addEventListener('load', () => { afterSampleLoad().then(loadPopup); }, { once: true });
  });

  const pasteBtn = document.getElementById('usePaste');
  const pasteBox = document.getElementById('pasteBox');
  if (pasteBtn) pasteBtn.addEventListener('click', () => {
    pasteBox.hidden = !pasteBox.hidden;
  });
  const apply = document.getElementById('applyPaste');
  if (apply) apply.addEventListener('click', () => {
    const html = document.getElementById('pasteHtml').value || '';
    const csp = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\' \'unsafe-eval\'; style-src \'unsafe-inline\' \'self\'; img-src \'self\' data:; font-src \'self\' data:; connect-src \'none\'; frame-src \'none\'; object-src \'none\';">';
    const wrapped = /<html/i.test(html) ? html : '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>' + html + '</body></html>';
    const withCsp = /Content-Security-Policy/.test(wrapped) ? wrapped : wrapped.replace(/<head[^>]*>/i, m => m + csp);
    sample.srcdoc = withCsp;
    sample.addEventListener('load', () => { afterSampleLoad().then(loadPopup); }, { once: true });
  });

  document.getElementById('runAgain').addEventListener('click', () => {
    if (mode === 'editor') {
      prepareCapture().then(loadPopup);
      return;
    }
    const doc = popup.contentDocument;
    const btn = doc && (doc.getElementById('runBtn') || doc.getElementById('analyzeBtn'));
    if (btn) btn.click();
    else loadPopup();
  });

  const countBtn = document.getElementById('countSelection');
  if (countBtn) countBtn.addEventListener('click', () => {
    let text = '';
    try {
      const win = sample.contentWindow;
      text = (win.getSelection && String(win.getSelection())) || '';
    } catch (e) {}
    if (!text.trim()) {
      if (window.__demoShowToast) window.__demoShowToast('', 'Select some text on the sample page first.');
      return;
    }
    window.__demoSessionLast = { text, at: Date.now(), source: 'selection' };
    loadPopup();
  });

  // If the sample was cached and already complete
  if (sample.contentDocument && sample.contentDocument.readyState === 'complete' && sample.src) {
    afterSampleLoad();
  }
})();
