
'use strict';
// Demo chrome.* shim: runs the real popup/extract code against the sample iframe. No network, no tabs access.
(function () {
  const TAB_ID = 1;
  const parentWin = window.parent;
  const listeners = { storage: [] };

  function sampleFrame() {
    try { return parentWin.document.getElementById('sampleFrame'); } catch (e) { return null; }
  }
  function sampleWin() {
    const f = sampleFrame();
    if (!f) throw new Error('Sample page is not ready');
    return f.contentWindow;
  }

  function filterTabs(query) {
    const q = query || {};
    if (q.active) {
      const win = sampleWin();
      return [{
        id: TAB_ID,
        url: win.location.href,
        title: win.document.title || 'Sample',
        active: true,
        windowId: 1,
        incognito: false,
        highlighted: true
      }];
    }
    const all = parentWin.__demoTabs || [];
    return all.filter(t => {
      if (q.currentWindow && t.windowId !== 1) return false;
      if (q.highlighted && !t.highlighted) return false;
      return true;
    });
  }

  function restoreDemoAttrs(doc) {
    const changed = [];
    doc.querySelectorAll('[data-demo-href]').forEach(el => {
      changed.push([el, 'href', el.getAttribute('href')]);
      el.setAttribute('href', el.getAttribute('data-demo-href'));
    });
    doc.querySelectorAll('[data-demo-src]').forEach(el => {
      changed.push([el, 'src', el.getAttribute('src')]);
      el.setAttribute('src', el.getAttribute('data-demo-src'));
    });
    doc.querySelectorAll('[data-demo-srcset]').forEach(el => {
      changed.push([el, 'srcset', el.getAttribute('srcset')]);
      el.setAttribute('srcset', el.getAttribute('data-demo-srcset'));
    });
    doc.querySelectorAll('[data-demo-style]').forEach(el => {
      changed.push([el, 'style', el.getAttribute('style')]);
      el.setAttribute('style', el.getAttribute('data-demo-style'));
    });
    doc.querySelectorAll('[data-demo-poster]').forEach(el => {
      changed.push([el, 'poster', el.getAttribute('poster')]);
      el.setAttribute('poster', el.getAttribute('data-demo-poster'));
    });
    doc.querySelectorAll('[data-demo-data]').forEach(el => {
      changed.push([el, 'data', el.getAttribute('data')]);
      el.setAttribute('data', el.getAttribute('data-demo-data'));
    });
    return function undo() {
      for (const [el, attr, val] of changed) {
        if (val == null) el.removeAttribute(attr);
        else el.setAttribute(attr, val);
      }
    };
  }

  function applyDemoUrl(result) {
    if (!result || typeof result !== 'object') return result;
    let demoUrl = '';
    try {
      const meta = sampleWin().document.querySelector('meta[name="demo-page-url"]');
      if (meta) demoUrl = meta.getAttribute('content') || '';
    } catch (e) {}
    if (!demoUrl) return result;
    try {
      const u = new URL(demoUrl);
      if (result.url) result.url = demoUrl;
      if (result.protocol) result.protocol = u.protocol;
    } catch (e) {}
    return result;
  }

  function fakeLocation(href) {
    const u = new URL(href, 'https://example.com/');
    return {
      href: u.href, protocol: u.protocol, host: u.host, hostname: u.hostname,
      pathname: u.pathname, search: u.search, hash: u.hash, origin: u.origin,
      port: u.port, ancestorOrigins: { length: 0 },
      toString: function () { return u.href; }
    };
  }

  function extractContext(win) {
    const live = win.document;
    const needsClone = !!live.querySelector('[data-demo-src],[data-demo-href],[data-demo-srcset],[data-demo-style],[data-demo-poster],[data-demo-data],meta[name="demo-page-url"]');
    if (!needsClone) return { document: live, location: win.location };
    const parsed = new win.DOMParser().parseFromString(live.documentElement.outerHTML, 'text/html');
    restoreDemoAttrs(parsed);
    let href = win.location.href;
    const meta = parsed.querySelector('meta[name="demo-page-url"]');
    if (meta && meta.getAttribute('content')) href = meta.getAttribute('content');
    return { document: parsed, location: fakeLocation(href) };
  }

  function runExtractSource(win, src) {
    const ctx = extractContext(win);
    const runner = new win.Function('document', 'location', 'src', 'return eval(src);');
    return applyDemoUrl(runner(ctx.document, ctx.location, src));
  }

  async function runFiles(files) {
    const win = sampleWin();
    const root = new URL('../', location.href); // demo/<slug>/
    const results = [];
    for (const file of files) {
      const url = new URL(file, root);
      const src = await fetch(url).then(r => {
        if (!r.ok) throw new Error('Could not load ' + file);
        return r.text();
      });
      results.push({ result: runExtractSource(win, src) });
    }
    return results;
  }

  function runFunc(func, args) {
    const win = sampleWin();
    const code = '(' + func.toString() + ').apply(null, ' + JSON.stringify(args || []) + ')';
    return [{ result: win.eval(code) }];
  }

  function analyzeLlm(doc) {
    const text = (doc.body && doc.body.innerText) || '';
    const words = text.split(/\s+/).filter(Boolean);
    const sentences = text.split(/[.!?]+/).filter(Boolean);
    const wordCount = words.length;
    const avgSentence = sentences.length ? wordCount / sentences.length : 0;
    const unique = new Set(words);
    const redundancy = wordCount ? 1 - unique.size / wordCount : 0;
    const h2 = doc.querySelectorAll('h2').length;
    const lists = doc.querySelectorAll('ul, ol').length;
    const hasFAQ = /faq/i.test(text);
    const hasCTA = /buy|contact|sign up/i.test(text);
    let markdown = 100 - (h2 === 0 ? 25 : 0) - (lists === 0 ? 15 : 0);
    let extract = 100 - (!hasFAQ ? 20 : 0);
    let token = 100 - (avgSentence > 25 ? 20 : 0) - (redundancy > 0.3 ? 25 : 0);
    let conversion = 100 - (!hasCTA ? 30 : 0);
    const finalScore = Math.round(markdown * 0.3 + extract * 0.3 + token * 0.25 + conversion * 0.15);
    return {
      llm_readiness_score: finalScore,
      scores: { markdown, extractability: extract, token_efficiency: token, conversion },
      stats: { wordCount, avgSentence, redundancy },
      top_issues: [
        h2 === 0 && 'Missing headings',
        !hasFAQ && 'No FAQ',
        avgSentence > 25 && 'Long sentences'
      ].filter(Boolean),
      quick_fixes: ['Add H2 sections', 'Add FAQ', 'Break paragraphs']
    };
  }

  // --- minimal storage / pomodoro backend ---
  const memory = { state: null, settings: null };
  function storageGet(keys) {
    const out = {};
    const list = Array.isArray(keys) ? keys : (keys && typeof keys === 'object' ? Object.keys(keys) : [keys]);
    for (const k of list) if (k) out[k] = memory[k];
    return Promise.resolve(out);
  }
  function storageSet(obj) {
    Object.assign(memory, obj);
    const changes = {};
    for (const k of Object.keys(obj || {})) changes[k] = { newValue: obj[k] };
    listeners.storage.forEach(fn => fn(changes, 'local'));
    return Promise.resolve();
  }

  let alarmTimers = { end: null, tick: null };
  function clearAlarms() {
    if (alarmTimers.end) { clearTimeout(alarmTimers.end); alarmTimers.end = null; }
    if (alarmTimers.tick) { clearInterval(alarmTimers.tick); alarmTimers.tick = null; }
  }
  function scheduleFromState(st) {
    clearAlarms();
    if (!st || st.status !== 'running') return;
    const delay = Math.max(0, (st.endAt || 0) - Date.now());
    alarmTimers.end = setTimeout(() => pomodoroHandle({ cmd: 'check' }), delay + 20);
    alarmTimers.tick = setInterval(() => pomodoroHandle({ cmd: 'check' }), 30000);
  }

  function C() { return window.PomodoroCore || (parentWin && parentWin.PomodoroCore); }

  async function pomodoroHandle(msg) {
    const Core = C();
    if (!Core) return { error: 'Timer core not loaded' };
    const now = Date.now();
    const loaded = { st: Object.assign(Core.initialState(), memory.state || {}), set: Core.sanitize(memory.settings) };
    async function commit(st, set, t) {
      await storageSet({ state: st });
      scheduleFromState(st);
      const b = Core.badge(st, set, t);
      if (parentWin.__demoSetBadge) parentWin.__demoSetBadge(b.text, b.color);
      return { state: st, settings: set, now: t };
    }
    if (msg.cmd === 'check') {
      const { st, set } = loaded;
      if (st.status !== 'running' || st.endAt > now + 1000) {
        const b = Core.badge(st, set, now);
        if (parentWin.__demoSetBadge) parentWin.__demoSetBadge(b.text, b.color);
        return { state: st, settings: set, now };
      }
      const r = Core.complete(st, set, now, { auto: true });
      const out = await commit(r.state, set, now);
      if (set.notify && r.notice && parentWin.__demoShowToast) parentWin.__demoShowToast(r.notice.title, r.notice.message);
      return out;
    }
    const { st, set } = loaded;
    switch (msg.cmd) {
      case 'get': {
        const b = Core.badge(st, set, now);
        if (parentWin.__demoSetBadge) parentWin.__demoSetBadge(b.text, b.color);
        return { state: st, settings: set, now };
      }
      case 'start': return commit(Core.start(st, set, now, st.status === 'idle' ? 'focus' : st.phase), set, now);
      case 'pause': return commit(Core.pause(st, now), set, now);
      case 'resume': return commit(Core.resume(st, now), set, now);
      case 'skip': return commit(Core.skip(st, set, now), set, now);
      case 'reset': return commit(Core.reset(st, now), set, now);
      case 'settings': {
        const next = Core.sanitize(Object.assign({}, set, msg.settings));
        await storageSet({ settings: next });
        let s2 = st;
        if (st.status === 'ready') s2 = Object.assign({}, st, { durationMs: Core.minutesFor(st.phase, next) * Core.MIN, remainingMs: Core.minutesFor(st.phase, next) * Core.MIN });
        return commit(s2, next, now);
      }
      default: return { error: 'unknown command' };
    }
  }

  let pomodoroQueue = Promise.resolve();
  const serial = fn => (pomodoroQueue = pomodoroQueue.then(fn, fn));

  window.chrome = {
    runtime: {
      id: 'innershift-demo',
      sendMessage: function (msg) {
        return serial(() => pomodoroHandle(msg));
      },
      lastError: null
    },
    tabs: {
      query: function (q, cb) {
        const p = Promise.resolve().then(() => {
          if (parentWin.__demoTabsReady) return parentWin.__demoTabsReady.then(() => filterTabs(q));
          return filterTabs(q);
        });
        if (typeof cb === 'function') p.then(cb);
        return p;
      },
      sendMessage: function (tabId, msg, cb) {
        let result;
        try {
          if (msg && msg.action === 'analyze') result = analyzeLlm(sampleWin().document);
        } catch (e) {
          result = { error: String(e && e.message || e) };
        }
        if (typeof cb === 'function') setTimeout(() => cb(result), 0);
        return Promise.resolve(result);
      }
    },
    scripting: {
      executeScript: async function (opts) {
        if (opts && opts.files) return runFiles(opts.files);
        if (opts && opts.func) return runFunc(opts.func, opts.args);
        return [];
      }
    },
    windows: {
      getCurrent: async function () { return { id: 1, incognito: false }; }
    },
    storage: {
      local: {
        get: storageGet,
        set: storageSet
      },
      onChanged: {
        addListener: function (fn) { listeners.storage.push(fn); }
      }
    },
    downloads: {
      download: function (opts) {
        const a = document.createElement('a');
        a.href = opts.url;
        a.download = opts.filename || 'download';
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    },
    notifications: {
      create: function (id, opts) {
        if (parentWin.__demoShowToast) parentWin.__demoShowToast(opts && opts.title, opts && opts.message);
        return Promise.resolve(id);
      },
      clear: function () { return Promise.resolve(); }
    },
    action: {
      setBadgeText: async function () {},
      setBadgeBackgroundColor: async function () {},
      setBadgeTextColor: async function () {},
      setTitle: async function () {}
    },
    alarms: {
      clear: async function () { return true; },
      create: async function () {}
    }
  };
})();
