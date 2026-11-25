// Reading Ruler popup. Opening the popup (a click on the toolbar button) grants activeTab; the popup then injects
// lib/core.js and the read-only content/extract.js into that tab once, to size the ruler to the page's text lines
// and to see whether the ruler is already on. "Turn on ruler" injects content/ruler.js, which draws the ruler;
// while it is on, changing a setting updates it straight away. "Turn off ruler" removes it. Nothing is saved.
'use strict';
(function () {
  const Core = (typeof RulerCore !== 'undefined') ? RulerCore : self.RulerCore;
  const $ = id => document.getElementById(id);
  let tabId = null, lineH = 24, on = false, s = Core.normalize(Core.DEFAULTS), ready = false;

  // These run in the page's isolated world (serialized by chrome.scripting), so they must be self-contained.
  function setWant(want, line) { self.__rrWant = want; self.__rrLine = line; return true; }
  function removeRuler() { return self.__rrApi ? self.__rrApi.remove() : false; }

  function setStatus(text, cls) { $('status').textContent = text; $('status').className = cls || 'muted'; }
  const pageError = () => setStatus('The page changed or was closed. Open the popup again.', 'warn');

  function radio(group, name, value, text, cls, style) {
    const lab = document.createElement('label');
    const inp = document.createElement('input');
    inp.type = 'radio'; inp.name = name; inp.value = String(value);
    inp.addEventListener('change', () => { if (inp.checked) change(name, value); });
    const sp = document.createElement('span');
    sp.textContent = text;
    if (cls) sp.className = cls;
    if (style) sp.style.background = style;
    lab.title = text;
    lab.append(inp, sp);
    group.appendChild(lab);
    return inp;
  }
  function build() {
    for (const [k, t] of Object.entries(Core.TINTS)) radio($('tints'), 'tint', k, t.label, t.rgb ? '' : 'none', t.rgb ? `rgb(${t.rgb.join(',')})` : '');
    for (const [k, d] of Object.entries(Core.DIMS)) radio($('dims'), 'dim', k, d.label);
    for (const n of Core.LINES) radio($('lines'), 'lines', n, String(n));
    $('mouse').addEventListener('change', () => change('mouse', $('mouse').checked));
    $('keys').addEventListener('change', () => change('keys', $('keys').checked));
    $('toggleBtn').addEventListener('click', toggle);
  }
  function show() {
    for (const inp of document.querySelectorAll('input[type=radio]')) inp.checked = String(s[inp.name]) === inp.value;
    $('mouse').checked = s.mouse; $('keys').checked = s.keys;
    $('toggleBtn').textContent = on ? 'Turn off ruler' : 'Turn on ruler';
    $('toggleBtn').className = on ? 'primary on' : 'primary';
    $('toggleBtn').disabled = !ready;
  }
  function status() { setStatus(Core.summary({ lineH, on: on ? s : null }), on ? 'good' : 'muted'); }

  async function draw() {
    await chrome.scripting.executeScript({ target: { tabId }, func: setWant, args: [s, lineH] });
    const out = await chrome.scripting.executeScript({ target: { tabId }, files: ['lib/core.js', 'content/ruler.js'] });
    const r = out && out[out.length - 1] && out[out.length - 1].result;
    if (r) s = Core.normalize(r);
    on = true;
  }
  async function change(name, value) {
    s = Core.normalize(Object.assign({}, s, { [name]: name === 'lines' ? Number(value) : value }));
    show();
    if (!on) return;
    try { await draw(); status(); } catch (e) { pageError(); }
  }
  async function toggle() {
    try {
      if (on) {
        await chrome.scripting.executeScript({ target: { tabId }, func: removeRuler });
        on = false;
        show();
        setStatus('Ruler turned off. The page is back as it was.', 'muted');
      } else {
        await draw();
        show();
        status();
      }
    } catch (e) { pageError(); }
  }

  async function init() {
    build();
    show();
    let page;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      tabId = tab.id;
      const out = await chrome.scripting.executeScript({ target: { tabId }, files: ['lib/core.js', 'content/extract.js'] });
      page = out && out[out.length - 1] && out[out.length - 1].result;
      if (!page) throw new Error('no result');
    } catch (e) {
      setStatus('Chrome doesn\'t let extensions onto this page (chrome:// pages, the Chrome Web Store, the PDF viewer). Open a normal web page and try again.', 'bad');
      for (const f of document.querySelectorAll('fieldset, .opt input')) f.disabled = true;
      return;
    }
    lineH = Core.lineHeight(page.samples);
    if (page.on) { on = true; s = Core.normalize(page.on); }
    ready = true;
    show();
    status();
  }
  self.__rulerReady = init();
})();
