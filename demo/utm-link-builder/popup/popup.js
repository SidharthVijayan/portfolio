// UTM Link Builder popup. Opening the popup (a click on the toolbar button) grants activeTab, which
// lets the popup see the address of the tab you are on (tab.url) without the "tabs" permission or
// any host access. Nothing is injected into the page. The tagged link is built with UtmCore as you
// type. "Copy link" uses the click on the button (no clipboardWrite permission). Presets, options
// the last preset used and the last 10 copied links are kept in chrome.storage.local, on this device only.
'use strict';
(function () {
  const Core = (typeof UtmCore !== 'undefined') ? UtmCore : self.UtmCore;
  const $ = id => document.getElementById(id);
  let pageUrl = '', presets = [], recent = [], options = Core.cleanOptions({}), current = null, lastPreset = '';

  function setStatus(text, cls) { $('status').textContent = text; $('status').className = cls || 'muted'; }
  const values = () => { const v = {}; for (const f of Core.FIELDS) v[f] = $('f-' + f).value; return v; };
  const save = obj => chrome.storage.local.set(obj).catch(() => {});

  function render() {
    current = null;
    $('copyBtn').disabled = true;
    if (!pageUrl) return;
    const r = Core.build(pageUrl, values(), options);
    if (!r.ok) { $('output').value = ''; setStatus(Core.message(r), r.error === 'source' ? 'muted' : 'bad'); return; }
    current = r.url;
    $('output').value = r.url;
    $('copyBtn').disabled = false;
    setStatus(Core.message(r), r.warnings.some(w => w !== 'medium' && w !== 'campaign') ? 'warn' : 'good');
  }

  function renderPresets(selected) {
    const sel = $('presetSelect');
    while (sel.children.length > 1) sel.removeChild(sel.children[sel.children.length - 1]);
    for (const p of presets) {
      const o = document.createElement('option');
      o.value = p.name; o.textContent = p.name;
      sel.appendChild(o);
    }
    sel.value = selected && presets.some(p => p.name === selected) ? selected : '';
    $('deletePresetBtn').disabled = !sel.value;
  }

  function renderRecent() {
    const list = $('recentList');
    list.textContent = '';
    for (const r of recent) {
      const li = document.createElement('li'), b = document.createElement('button');
      b.type = 'button'; b.textContent = r.url; b.title = 'Copy ' + r.url;
      b.addEventListener('click', () => copyText(r.url, 'Copied a recent link.'));
      li.appendChild(b); list.appendChild(li);
    }
    $('recentCount').textContent = String(recent.length);
    $('clearRecentBtn').disabled = !recent.length;
  }

  async function copyText(text, done) {
    try {
      await navigator.clipboard.writeText(text);
      setStatus(done, 'good');
      return true;
    } catch (e) {
      setStatus('Copy was blocked by the browser. Try again.', 'warn');
      return false;
    }
  }

  async function copy() {
    if (!current) return;
    const url = current;
    if (await copyText(url, 'Copied the tagged link (' + url.length + ' characters). Paste it anywhere.')) {
      recent = Core.addRecent(recent, url, Date.now());
      renderRecent();
      await save({ recent });
    }
  }

  function applyPreset() {
    const p = presets.find(x => x.name === $('presetSelect').value);
    $('deletePresetBtn').disabled = !p;
    if (!p) return;
    for (const f of Core.FIELDS) $('f-' + f).value = p.values[f] || '';
    $('presetName').value = p.name;
    render();
    if (lastPreset !== p.name) { lastPreset = p.name; save({ lastPreset }); }
  }

  async function savePreset() {
    const r = Core.savePreset(presets, $('presetName').value, values());
    if (r.error === 'name') return setStatus('Type a name for the preset first.', 'warn');
    if (r.error === 'source') return setStatus('A preset needs at least a source.', 'warn');
    if (r.error === 'full') return setStatus('You have ' + Core.MAX_PRESETS + ' presets, the most it keeps. Delete one first.', 'warn');
    presets = r.presets;
    const name = $('presetName').value.replace(/\s+/g, ' ').trim().slice(0, 40);
    const match = presets.find(p => p.name.toLowerCase() === name.toLowerCase());
    renderPresets(match && match.name);
    if (match) lastPreset = match.name;
    await save({ presets, lastPreset });
    setStatus((r.updated ? 'Updated preset "' : 'Saved preset "') + (match ? match.name : name) + '".', 'good');
  }

  async function deletePreset() {
    const name = $('presetSelect').value;
    if (!name) return;
    presets = Core.deletePreset(presets, name);
    renderPresets('');
    await save({ presets });
    setStatus('Deleted preset "' + name + '".', 'muted');
  }

  async function clearRecent() {
    recent = [];
    renderRecent();
    await save({ recent });
    setStatus('Cleared recent links.', 'muted');
  }

  async function changeOptions() {
    options = Core.cleanOptions({ lowercase: $('optLower').checked, spaces: $('optSpaces').value, existing: $('optExisting').value });
    render();
    await save({ options });
  }

  async function init() {
    for (const f of Core.FIELDS) $('f-' + f).addEventListener('input', render);
    $('optLower').addEventListener('change', changeOptions);
    $('optSpaces').addEventListener('change', changeOptions);
    $('optExisting').addEventListener('change', changeOptions);
    $('presetSelect').addEventListener('change', applyPreset);
    $('copyBtn').addEventListener('click', copy);
    $('savePresetBtn').addEventListener('click', savePreset);
    $('deletePresetBtn').addEventListener('click', deletePreset);
    $('clearRecentBtn').addEventListener('click', clearRecent);
    try {
      const stored = await chrome.storage.local.get(['presets', 'options', 'recent', 'lastPreset']);
      presets = Core.cleanPresets(stored.presets);
      options = Core.cleanOptions(stored.options);
      lastPreset = typeof stored.lastPreset === 'string' ? stored.lastPreset : '';
      recent = Array.isArray(stored.recent) ? stored.recent.filter(r => r && typeof r.url === 'string').slice(0, Core.MAX_RECENT) : [];
    } catch (e) { /* start empty */ }
    $('optLower').checked = options.lowercase;
    $('optSpaces').value = options.spaces;
    $('optExisting').value = options.existing;
    renderPresets('');
    renderRecent();
    let tab = null;
    try { [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); } catch (e) { tab = null; }
    const url = tab && tab.url;
    if (!url) {
      $('page').textContent = 'No address available for this tab.';
      return setStatus('This tab\'s address can\'t be read. Chrome keeps its own pages (chrome://, the Web Store) and blank tabs off-limits to extensions. Open a web page and click the button again.', 'bad');
    }
    $('page').textContent = url; $('page').title = url;
    const c = Core.check(url);
    if (!c.ok) {
      return setStatus('This is a ' + (c.scheme ? c.scheme + ':' : 'browser') + ' page. UTM tags only work on web addresses (http or https).', 'bad');
    }
    pageUrl = url;
    const old = Core.existingUtm(url);
    if (presets.some(p => p.name === lastPreset)) { $('presetSelect').value = lastPreset; applyPreset(); return; }
    render();
    if (!presets.length && !$('f-source').value) setStatus('Fill in a source (and ideally medium and campaign), then save it as a preset to reuse.' + (Object.keys(old).length ? ' This page already has UTM tags.' : ''), 'muted');
    else if (Object.keys(old).length && !current) setStatus('This page already has ' + Object.keys(old).join(', ') + '. Choose a preset or fill in a source.', 'muted');
  }
  self.__utmReady = init();
})();
