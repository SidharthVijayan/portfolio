// Third-Party Script Spotter popup. Opening the popup (a click on the toolbar button) grants activeTab; the popup then
// injects the read-only content/extract.js into that tab once, groups the results with SpotCore and shows them.
// Copy uses the click on the Copy button (no clipboardWrite permission); Download uses an <a download> link to a local
// blob (no downloads permission). Options live only in the popup and are not saved.
'use strict';
(function () {
  const Core = (typeof SpotCore !== 'undefined') ? SpotCore : self.SpotCore;
  const $ = id => document.getElementById(id);
  let analysis = null, output = '';

  function setStatus(text, cls) { $('status').textContent = text; $('status').className = cls || 'muted'; }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  const opts = () => ({ includeFirst: !!$('includeFirst').checked });

  function renderCounts() {
    const ul = $('counts'); clear(ul);
    const c = analysis.counts;
    for (const [n, label] of [[c.sites, 'third-party domains'], [c.trackers, 'known trackers'], [c.scripts, 'scripts'], [c.iframes, 'iframes']]) {
      const li = el('li'); li.appendChild(el('b', '', String(n))); li.appendChild(el('span', '', label)); ul.appendChild(li);
    }
    const notes = $('notes'); clear(notes);
    for (const n of Core.notes(analysis)) notes.appendChild(el('li', n.level, n.msg));
  }

  function renderGroups() {
    const box = $('groups'); clear(box);
    const sites = Core.visibleSites(analysis, opts().includeFirst);
    for (const g of Object.keys(Core.GROUPS)) {
      const ss = sites.filter(s => s.group === g);
      if (!ss.length) continue;
      const sec = el('section', 'group ' + g);
      sec.appendChild(el('h2', '', Core.GROUPS[g] + ' (' + ss.length + ')'));
      for (const s of ss) {
        const d = el('details', 'site');
        const sum = el('summary');
        sum.appendChild(el('span', 'dom', s.site));
        sum.appendChild(el('span', 'meta', (s.known ? s.known.company + ' · ' + s.known.category + ' · ' : '') + Core.kindText(s) + (s.hidden ? ' · ' + s.hidden + ' hidden' : '')));
        d.appendChild(sum);
        const ul = el('ul', 'urls');
        for (const it of s.items) {
          const li = el('li', '', it.url); const l = Core.loading(it);
          if (l !== 'blocking' && l !== 'iframe') li.appendChild(el('em', '', ' ' + l));
          ul.appendChild(li);
        }
        d.appendChild(ul); sec.appendChild(d);
      }
      box.appendChild(sec);
    }
  }

  function refresh() {
    if (!analysis) return;
    renderGroups();
    const any = Core.visibleSites(analysis, opts().includeFirst).length > 0;
    output = any ? Core.format(analysis, $('format').value, opts(), new Date()) : '';
    $('copyBtn').disabled = $('downloadBtn').disabled = !output;
    setStatus(Core.summary(analysis), analysis.counts.trackers ? 'warn' : (analysis.counts.sites ? 'muted' : 'good'));
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(output);
      setStatus('Copied the ' + ($('format').value === 'csv' ? 'CSV' : 'report') + ' to the clipboard.', 'good');
    } catch (e) {
      setStatus('Copy was blocked by the browser. Use Download file instead.', 'warn');
    }
  }

  function download() {
    const fmt = $('format').value, info = Core.FORMATS[fmt];
    const body = (fmt === 'csv' ? '\uFEFF' : '') + output; // BOM so Excel opens the CSV as UTF-8
    const blob = new Blob([body], { type: info.mime + ';charset=utf-8' });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href; a.download = Core.fileName(analysis.page, fmt, new Date());
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10000);
    setStatus('Saved ' + a.download + ' to your downloads.', 'good');
  }

  async function init() {
    for (const [k, v] of Object.entries(Core.FORMATS)) { const o = el('option', '', v.label); o.value = k; $('format').appendChild(o); }
    $('format').value = 'report';
    for (const id of ['includeFirst', 'format']) $(id).addEventListener('change', refresh);
    $('copyBtn').addEventListener('click', copy);
    $('downloadBtn').addEventListener('click', download);
    let raw;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const res = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/extract.js'] });
      raw = res && res[0] && res[0].result;
      if (!raw) throw new Error('no result');
    } catch (e) {
      setStatus('This page can\'t be read. Browser pages (chrome://, the Chrome Web Store, PDF viewer) are off-limits to extensions.', 'bad');
      return;
    }
    analysis = Core.analyze(raw);
    renderCounts();
    refresh();
  }
  self.__spotReady = init();
})();
