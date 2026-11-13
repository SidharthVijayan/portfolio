// Toolbar Pomodoro popup. Shows the live clock for the current session and sends commands
// (start, pause, resume, skip, reset, settings) to the background service worker, which owns the
// timer, the badge and the alarms. Re-reads the state whenever it changes in chrome.storage.
'use strict';
(function () {
  const C = (typeof PomodoroCore !== 'undefined') ? PomodoroCore : self.PomodoroCore;
  const $ = id => document.getElementById(id);
  const NUMS = ['focusMin', 'breakMin', 'longMin', 'longEvery'];
  const BOOLS = ['longBreaks', 'autoStart', 'notify'];
  let view = null, checking = false, timer = null;

  function send(cmd, extra) {
    return chrome.runtime.sendMessage(Object.assign({ cmd }, extra || {})).then(r => {
      if (!r || r.error) throw new Error(r && r.error || 'No answer from the timer');
      view = r; $('status').textContent = ''; render(); return r;
    }).catch(e => { $('status').textContent = 'Something went wrong: ' + e.message; $('status').className = 'bad'; });
  }

  function primary(st) {
    if (st.status === 'running') return ['Pause', 'pause'];
    if (st.status === 'paused') return ['Resume', 'resume'];
    if (st.status === 'ready') return ['Start ' + C.LABEL[st.phase].toLowerCase(), 'start'];
    return ['Start focus', 'start'];
  }

  function renderClock() {
    if (!view) return;
    const { state: st, settings: set } = view;
    const ms = C.remaining(st, set, Date.now());
    $('clock').textContent = C.clock(ms);
    if (st.status === 'running' && ms <= 0 && !checking) { checking = true; send('check').finally(() => { checking = false; }); }
  }

  function render() {
    const { state: st, settings: set } = view;
    const now = Date.now();
    $('timer').className = st.status === 'paused' ? 'paused' : st.status === 'ready' ? 'ready' : st.phase;
    $('phaseLabel').textContent = (st.status === 'ready' ? 'Next: ' : '') + C.LABEL[st.phase];
    $('stateLine').textContent = st.status === 'running' ? 'Running · badge shows minutes left' : st.status === 'paused' ? 'Paused' : st.status === 'ready' ? 'Waiting for you to start' : 'Ready';
    const dots = $('dots');
    while (dots.firstChild) dots.removeChild(dots.firstChild);
    for (const on of C.dots(st, set)) { const d = document.createElement('span'); if (on) d.className = 'on'; dots.appendChild(d); }
    $('sessionLine').textContent = C.sessionLine(st, set);
    const [label, cmd] = primary(st);
    $('primaryBtn').textContent = label; $('primaryBtn').dataset.cmd = cmd; $('primaryBtn').disabled = false;
    $('skipBtn').disabled = st.status === 'idle';
    $('skipBtn').textContent = st.phase === 'focus' ? 'Skip to break' : 'Skip to focus';
    $('resetBtn').disabled = st.status === 'idle' && st.round === 0;
    $('today').textContent = C.todayLine(st, now);
    for (const k of NUMS) if (document.activeElement !== $(k)) $(k).value = String(set[k]);
    for (const k of BOOLS) $(k).checked = !!set[k];
    $('longMin').disabled = $('longEvery').disabled = !set.longBreaks;
    renderClock();
  }

  function saveSettings() {
    const s = {};
    for (const k of NUMS) s[k] = $(k).value;
    for (const k of BOOLS) s[k] = $(k).checked;
    return send('settings', { settings: s });
  }

  $('primaryBtn').addEventListener('click', () => send($('primaryBtn').dataset.cmd || 'start'));
  $('skipBtn').addEventListener('click', () => send('skip'));
  $('resetBtn').addEventListener('click', () => send('reset'));
  for (const k of NUMS) $(k).addEventListener('change', saveSettings);
  for (const k of BOOLS) $(k).addEventListener('change', saveSettings);
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.state) send('get'); });

  self.popupReady = send('get').then(() => { timer = setInterval(renderClock, 1000); });
})();
