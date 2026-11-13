
'use strict';
(function () {
  const sample = document.getElementById('sampleFrame');
  const popup = document.getElementById('popupFrame');
  const mode = document.body.dataset.mode || 'page';
  let popupLoaded = false;

  function loadPopup() {
    popupLoaded = false;
    popup.onload = () => { popupLoaded = true; maybeAutorun(); };
    popup.src = 'popup/popup.html';
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
    b.textContent = text || '';
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

  sample.addEventListener('load', () => {
    if (!popup.src || popup.src === 'about:blank' || popup.src.endsWith('about:blank')) loadPopup();
    else maybeAutorun();
  });

  document.getElementById('useSample').addEventListener('click', () => {
    sample.removeAttribute('srcdoc');
    sample.src = 'sample.html';
    sample.addEventListener('load', () => loadPopup(), { once: true });
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
    sample.addEventListener('load', () => loadPopup(), { once: true });
  });

  document.getElementById('runAgain').addEventListener('click', () => {
    const doc = popup.contentDocument;
    const btn = doc && (doc.getElementById('runBtn') || doc.getElementById('analyzeBtn'));
    if (btn) btn.click();
    else loadPopup();
  });

  // If the sample was cached and already complete
  if (sample.contentDocument && sample.contentDocument.readyState === 'complete' && sample.src) {
    loadPopup();
  }
})();
