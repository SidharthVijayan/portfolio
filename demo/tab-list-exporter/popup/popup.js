// Tab List Exporter popup. Reads tab titles/addresses with chrome.tabs.query only while the popup is open.
'use strict';
(function () {
  const Core = (typeof TabListCore !== 'undefined') ? TabListCore : self.TabListCore;
  const $ = id => document.getElementById(id);
  const el = { scope: $('scope'), format: $('format'), dedupe: $('dedupe'), skipInternal: $('skipInternal'),
    status: $('status'), preview: $('preview'), copy: $('copyBtn'), download: $('downloadBtn') };
  let output = '';
  let count = 0;
  let incognito = false;

  function fill(select, map, value) {
    for (const [k, label] of Object.entries(map)) {
      const o = document.createElement('option');
      o.value = k; o.textContent = typeof label === 'string' ? label : label.label;
      select.appendChild(o);
    }
    select.value = value;
  }

  function setStatus(text, cls) { el.status.textContent = text; el.status.className = cls || 'muted'; }

  async function refresh() {
    const scope = el.scope.value, fmt = el.format.value;
    let tabs;
    try {
      tabs = await chrome.tabs.query(Core.queryFor(scope));
    } catch (e) {
      output = ''; el.preview.value = ''; el.copy.disabled = el.download.disabled = true;
      return setStatus('Could not read your tabs: ' + e.message, 'bad');
    }
    const rows = tabs.map(t => ({ title: t.title, url: t.url || t.pendingUrl, windowId: t.windowId, index: t.index, incognito: t.incognito }));
    const prep = Core.prepare(rows, { skipInternal: el.skipInternal.checked, dedupe: el.dedupe.checked, incognito });
    const multi = scope === 'all' && new Set(prep.tabs.map(t => t.windowId)).size > 1;
    count = prep.tabs.length;
    output = prep.tabs.length ? Core.format(prep.tabs, fmt, multi) : '';
    el.preview.value = output;
    el.copy.disabled = el.download.disabled = !output;
    setStatus(prep.tabs.length ? Core.summary(prep, scope) : 'No tabs to export with these settings. ' + Core.summary(prep, scope), prep.tabs.length ? 'muted' : 'warn');
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(output);
      setStatus('Copied ' + count + (count === 1 ? ' tab' : ' tabs') + ' to the clipboard.', 'good');
    } catch (e) {
      el.preview.focus(); el.preview.select();
      setStatus('Copy was blocked by the browser. The text is selected: press Ctrl+C (Cmd+C on Mac).', 'warn');
    }
  }

  function download() {
    const fmt = el.format.value, info = Core.FORMATS[fmt];
    const blob = new Blob([output], { type: info.mime + ';charset=utf-8' });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href; a.download = Core.fileName(fmt);
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10000);
    setStatus('Saved ' + a.download + ' to your downloads.', 'good');
  }

  async function init() {
    fill(el.scope, Core.SCOPES, Core.DEFAULTS.scope);
    fill(el.format, Core.FORMATS, Core.DEFAULTS.format);
    try { incognito = !!(await chrome.windows.getCurrent()).incognito; } catch (e) { incognito = false; }
    for (const k of ['scope', 'format', 'dedupe', 'skipInternal']) el[k].addEventListener('change', refresh);
    el.copy.addEventListener('click', copy);
    el.download.addEventListener('click', download);
    await refresh();
  }
  self.__tabListReady = init();
})();
