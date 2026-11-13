// Mixed Content & Insecure Form Finder popup. Opening the popup (a click on the toolbar button) grants activeTab; the
// popup then injects the read-only content/extract.js into that tab once, sorts the results with MixedCore and shows
// them. Copy uses the click on the Copy button (no clipboardWrite permission); Download uses an <a download> link to a
// local blob (no downloads permission). The export format lives only in the popup and is not saved.
'use strict';
(function () {
  const Core = (typeof MixedCore !== 'undefined') ? MixedCore : self.MixedCore;
  const $ = id => document.getElementById(id);
  let analysis = null, output = '';

  function setStatus(text, cls) { $('status').textContent = text; $('status').className = cls || 'muted'; }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

  function renderCounts() {
    const ul = $('counts'); clear(ul);
    const c = analysis.counts;
    const cells = analysis.mode === 'http'
      ? [[c.pageForms, 'forms sent unencrypted'], [c.passwordForms, 'with a password field']]
      : analysis.mode !== 'https' ? []
      : analysis.uir ? [[c.forms, 'insecure forms'], [c.policy, "upgraded by the page's policy"], [c.checked, 'addresses checked']]
      : [[c.forms, 'insecure forms'], [c.blocked, 'blocked by Chrome'], [c.upgraded, 'auto-upgraded'], [c.checked, 'addresses checked']];
    ul.className = 'n' + cells.length;
    for (const [n, label] of cells) {
      const li = el('li'); li.appendChild(el('b', '', String(n))); li.appendChild(el('span', '', label)); ul.appendChild(li);
    }
    const notes = $('notes'); clear(notes);
    for (const n of Core.notes(analysis)) notes.appendChild(el('li', n.level, n.msg));
  }

  function renderGroups() {
    const box = $('groups'); clear(box);
    for (const g of Object.keys(Core.GROUPS)) {
      const rs = analysis.rows.filter(r => r.group === g);
      if (!rs.length) continue;
      const sec = el('section', 'group ' + g);
      sec.appendChild(el('h2', '', Core.GROUPS[g] + ' (' + rs.length + ')'));
      for (const r of rs) {
        const d = el('details', 'site');
        const sum = el('summary');
        sum.appendChild(el('span', 'dom', r.url));
        sum.appendChild(el('span', 'meta', Core.label(r) + (r.kind === 'form' || r.kind === 'formaction' ? ' · ' + Core.formText(r) : '') + (r.count > 1 ? ' · used ' + r.count + ' times' : '')));
        d.appendChild(sum);
        const ul = el('ul', 'urls');
        ul.appendChild(el('li', '', 'In: ' + r.els.join(', ') + (r.count > r.els.length ? ' and ' + (r.count - r.els.length) + ' more' : '')));
        ul.appendChild(el('li', 'act', Core.ACTION[r.action]));
        ul.appendChild(el('li', 'fix', 'Fix: ' + (r.group === 'page' ? 'serve the page and form over https' : 'use ' + Core.httpsVersion(r.url))));
        d.appendChild(ul); sec.appendChild(d);
      }
      box.appendChild(sec);
    }
  }

  function refresh() {
    if (!analysis) return;
    output = analysis.rows.length ? Core.format(analysis, $('format').value, new Date()) : '';
    $('copyBtn').disabled = $('downloadBtn').disabled = !output;
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
    $('format').addEventListener('change', refresh);
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
    renderGroups();
    refresh();
    setStatus(Core.summary(analysis), Core.level(analysis));
  }
  self.__mixedReady = init();
})();
