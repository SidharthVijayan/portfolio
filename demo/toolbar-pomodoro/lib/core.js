// Toolbar Pomodoro core: pure timer logic shared by the background service worker, the popup
// and the Node tests. No chrome.* calls here. All times are epoch milliseconds passed in by the caller.
'use strict';
(function (root) {
  const MIN = 60000;
  const DEFAULTS = Object.freeze({ focusMin: 25, breakMin: 5, longMin: 15, longEvery: 4, longBreaks: true, autoStart: true, notify: true });
  const LIMITS = { focusMin: [1, 180], breakMin: [1, 60], longMin: [1, 90], longEvery: [2, 12] };
  const LABEL = { focus: 'Focus', break: 'Short break', long: 'Long break' };
  const COLOR = { focus: '#dc2626', break: '#16a34a', long: '#0d9488', paused: '#6b7280', ready: '#2563eb' };

  function sanitize(input) {
    const s = Object.assign({}, DEFAULTS);
    const src = input && typeof input === 'object' ? input : {};
    for (const k of Object.keys(LIMITS)) {
      const n = Math.round(Number(src[k]));
      if (src[k] !== undefined && src[k] !== '' && Number.isFinite(n)) s[k] = Math.min(LIMITS[k][1], Math.max(LIMITS[k][0], n));
    }
    for (const k of ['longBreaks', 'autoStart', 'notify']) if (typeof src[k] === 'boolean') s[k] = src[k];
    return s;
  }

  function dayKey(now) {
    const d = new Date(now);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function initialState() {
    return { phase: 'focus', status: 'idle', endAt: null, remainingMs: null, durationMs: null, round: 0, today: { date: '', sessions: 0, minutes: 0 } };
  }
  function copy(st) { const c = Object.assign(initialState(), st || {}); c.today = Object.assign({ date: '', sessions: 0, minutes: 0 }, c.today); return c; }
  function rollToday(st, now) { const c = copy(st); const k = dayKey(now); if (c.today.date !== k) c.today = { date: k, sessions: 0, minutes: 0 }; return c; }

  function minutesFor(phase, set) { return phase === 'long' ? set.longMin : phase === 'break' ? set.breakMin : set.focusMin; }

  function start(st, set, now, phase) {
    const c = rollToday(st, now);
    c.phase = phase || c.phase || 'focus';
    c.status = 'running';
    c.durationMs = minutesFor(c.phase, set) * MIN;
    c.endAt = now + c.durationMs;
    c.remainingMs = null;
    return c;
  }
  function pause(st, now) {
    const c = copy(st);
    if (c.status !== 'running') return c;
    c.remainingMs = Math.max(0, c.endAt - now); c.endAt = null; c.status = 'paused';
    return c;
  }
  function resume(st, now) {
    const c = copy(st);
    if (c.status !== 'paused') return c;
    c.endAt = now + c.remainingMs; c.remainingMs = null; c.status = 'running';
    return c;
  }
  function reset(st, now) {
    const c = rollToday(st, now);
    const fresh = initialState(); fresh.today = c.today;
    return fresh;
  }

  // Which phase comes after the current one. countFocus: the current focus session counts towards the long break.
  function nextPhase(phase, round, set, countFocus) {
    if (phase === 'focus') {
      const r = countFocus ? round + 1 : round;
      return { phase: set.longBreaks && countFocus && r >= set.longEvery ? 'long' : 'break', round: r };
    }
    return { phase: 'focus', round: phase === 'long' ? 0 : round };
  }

  function notice(done, next, set, autoStarted) {
    const mins = minutesFor(next, set);
    if (done === 'focus') {
      const what = next === 'long' ? `${mins}-minute long break` : `${mins}-minute break`;
      return { title: 'Focus session done', message: autoStarted ? `Your ${what} has started.` : `Time for a ${what}. Open Toolbar Pomodoro to start it.` };
    }
    return { title: done === 'long' ? 'Long break over' : 'Break over', message: autoStarted ? `Your next ${mins}-minute focus session has started.` : 'Open Toolbar Pomodoro to start your next focus session.' };
  }

  // The running session reached its end. opts.auto=false (e.g. it ended while Chrome was closed) never auto-starts.
  function complete(st, set, now, opts) {
    const auto = !opts || opts.auto !== false;
    let c = rollToday(st, now);
    if (c.status !== 'running') return { state: c, notice: null, done: null };
    const done = c.phase;
    if (done === 'focus') { c.today.sessions += 1; c.today.minutes += Math.round((c.durationMs || 0) / MIN); }
    const n = nextPhase(done, c.round, set, true);
    c.round = n.round;
    const autoStarted = auto && set.autoStart;
    if (autoStarted) c = start(c, set, now, n.phase);
    else { c.phase = n.phase; c.status = 'ready'; c.endAt = null; c.durationMs = minutesFor(n.phase, set) * MIN; c.remainingMs = c.durationMs; }
    return { state: c, notice: notice(done, n.phase, set, autoStarted), done };
  }

  // Jump straight to the next phase and start it. A skipped focus session is not counted.
  function skip(st, set, now) {
    const c = copy(st);
    if (c.status === 'idle') return c;
    const n = nextPhase(c.phase, c.round, set, false);
    c.round = n.round;
    return start(c, set, now, n.phase);
  }

  function remaining(st, set, now) {
    if (st.status === 'running') return Math.max(0, st.endAt - now);
    if (st.status === 'paused' || st.status === 'ready') return st.remainingMs || 0;
    return minutesFor(st.phase || 'focus', set) * MIN;
  }

  function clock(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function badgeMinutes(ms) { return String(Math.max(0, Math.ceil(ms / MIN))); }

  function badge(st, set, now) {
    if (st.status === 'idle') return { text: '', color: COLOR.paused };
    if (st.status === 'ready') return { text: 'GO', color: COLOR.ready };
    const text = badgeMinutes(remaining(st, set, now));
    return { text, color: st.status === 'paused' ? COLOR.paused : COLOR[st.phase] };
  }

  function sessionLine(st, set) {
    if (!set.longBreaks) return '';
    const n = st.phase === 'focus' ? Math.min(st.round + 1, set.longEvery) : st.round;
    if (st.phase === 'long') return 'Long break earned after ' + set.longEvery + ' focus sessions';
    return st.phase === 'focus' ? `Focus session ${n} of ${set.longEvery} before a long break` : `${n} of ${set.longEvery} focus sessions done before a long break`;
  }

  function tooltip(st, set, now) {
    const label = LABEL[st.phase] || 'Focus';
    const left = Math.max(0, Math.ceil(remaining(st, set, now) / MIN));
    if (st.status === 'idle') return 'Toolbar Pomodoro: ready, ' + set.focusMin + '-minute focus';
    if (st.status === 'ready') return `Toolbar Pomodoro: ${label.toLowerCase()} is next, click to start it`;
    if (st.status === 'paused') return `Toolbar Pomodoro: ${label} paused, ${left} min left`;
    return `Toolbar Pomodoro: ${label}, about ${left} min left`;
  }

  function todayLine(st, now) {
    const t = st.today && st.today.date === dayKey(now) ? st.today : { sessions: 0, minutes: 0 };
    return `Today: ${t.sessions} focus session${t.sessions === 1 ? '' : 's'} (${t.minutes} min)`;
  }

  function dots(st, set) {
    if (!set.longBreaks) return [];
    const done = st.phase === 'long' ? set.longEvery : Math.min(st.round, set.longEvery);
    return Array.from({ length: set.longEvery }, (_, i) => i < done);
  }

  const api = { MIN, DEFAULTS, LIMITS, LABEL, COLOR, sanitize, dayKey, initialState, rollToday, minutesFor, start, pause, resume, reset, nextPhase, complete, skip, remaining, clock, badge, badgeMinutes, sessionLine, tooltip, todayLine, dots, notice };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PomodoroCore = api;
})(typeof self !== 'undefined' ? self : this);
