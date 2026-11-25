import { parseExport, inferYou, normalizeProfileUrl, personKey } from "./lib/parse-export.js";
import { buildInsights, reconnectCsv } from "./lib/classify.js";
import { sampleExports } from "./lib/sample.js";

const $ = (id) => document.getElementById(id);
const yearEl = $("year");
if (yearEl) yearEl.textContent = String(new Date().getFullYear());

const state = {
  current: null,
  previous: null,
  youOverride: null,
  isSample: false,
  tab: "friends",
  query: "",
};

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function profileHref(url) {
  if (!url) return "";
  const u = normalizeProfileUrl(url) || String(url).trim();
  if (!u) return "";
  return u.startsWith("http") ? u : "https://" + u.replace(/^\/+/, "");
}

function fmtDate(d) {
  if (!d) return "—";
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function ago(d, now = new Date()) {
  if (!d) return "";
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return "";
  const days = Math.max(0, Math.round((now.getTime() - date.getTime()) / 86400000));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return days + " days ago";
  const months = Math.round(days / 30);
  if (months < 24) return months + " month" + (months === 1 ? "" : "s") + " ago";
  const years = Math.round(days / 365);
  return years + " year" + (years === 1 ? "" : "s") + " ago";
}

function pct(value) {
  if (value == null || Number.isNaN(value)) return "—";
  return Math.round(value * 100) + "%";
}

function fileLabel(files) {
  if (!files || !files.length) return "";
  if (files.length === 1) return files[0].name;
  return files.length + " files: " + [...files].map((f) => f.name).join(", ");
}

async function readAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Could not read " + file.name));
    reader.readAsText(file);
  });
}

async function readAsBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("Could not read " + file.name));
    reader.readAsArrayBuffer(file);
  });
}

async function unzipToMap(buffer) {
  if (typeof JSZip === "undefined") throw new Error("The zip reader failed to load. Try dropping the CSV files instead.");
  const zip = await JSZip.loadAsync(buffer);
  const map = {};
  const jobs = [];
  zip.forEach((path, entry) => {
    if (entry.dir) return;
    if (!/\.(csv|txt)$/i.test(path)) return;
    jobs.push(entry.async("string").then((text) => { map[path] = text; }));
  });
  await Promise.all(jobs);
  return map;
}

async function filesToMap(fileList) {
  const map = {};
  const files = [...(fileList || [])];
  if (!files.length) return map;
  for (const file of files) {
    const name = file.name || "file";
    if (/\.zip$/i.test(name) || file.type === "application/zip" || file.type === "application/x-zip-compressed") {
      const inner = await unzipToMap(await readAsBuffer(file));
      Object.assign(map, inner);
    } else if (/\.(csv|txt)$/i.test(name) || file.type === "text/csv") {
      map[name] = await readAsText(file);
    } else {
      // Try zip first, then text, so a zip without a .zip name still works.
      try {
        const inner = await unzipToMap(await readAsBuffer(file));
        if (Object.keys(inner).length) Object.assign(map, inner);
        else map[name] = await readAsText(file);
      } catch {
        map[name] = await readAsText(file);
      }
    }
  }
  return map;
}

function showError(message) {
  const el = $("error");
  if (!message) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.textContent = message;
}

function setStatus(which, text, hasFile) {
  const status = $(which === "previous" ? "status-previous" : "status-current");
  const zone = $(which === "previous" ? "drop-previous" : "drop-current");
  if (status) status.textContent = text || "";
  if (zone) zone.classList.toggle("has-file", !!hasFile);
}

async function loadFiles(which, fileList) {
  showError("");
  try {
    const map = await filesToMap(fileList);
    if (!Object.keys(map).length) {
      throw new Error("No CSV files were found. Drop the LinkedIn zip, or Connections.csv and messages.csv.");
    }
    const parsed = parseExport(map);
    const useful = (parsed.connections && parsed.connections.length) || (parsed.messages && parsed.messages.length) || (parsed.invitations && parsed.invitations.length);
    if (!useful) {
      throw new Error("That file did not look like a LinkedIn data export. You need Connections.csv or messages.csv from the official archive.");
    }
    if (which === "previous") {
      state.previous = parsed;
      setStatus("previous", "Older export loaded — " + (parsed.filesFound || []).map((f) => f.name).join(", "), true);
    } else {
      state.current = parsed;
      state.isSample = false;
      state.youOverride = null;
      setStatus("current", "Loaded " + (parsed.filesFound || []).map((f) => f.name).join(", "), true);
    }
    render();
  } catch (err) {
    showError(err && err.message ? err.message : String(err));
  }
}

function loadSample() {
  showError("");
  const { current, previous, you } = sampleExports();
  state.current = current;
  state.previous = previous;
  state.youOverride = you;
  state.isSample = true;
  setStatus("current", "Example data loaded (fictional)", true);
  setStatus("previous", "Example older export loaded (fictional)", true);
  const older = document.querySelector(".older-wrap");
  if (older) older.open = true;
  render();
  $("results")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function insightsNow() {
  if (!state.current) return null;
  return buildInsights(state.current, state.previous, {
    you: state.youOverride,
    isSample: state.isSample,
    now: new Date(),
  });
}

const TAB_LABELS = {
  friends: "Real friends",
  left: "Who left",
  engagers: "Top engagers",
  reconnect: "Reconnect",
};

const BUCKET_LABELS = {
  close: "Close",
  oneSided: "Ignoring you",
  goneQuiet: "Gone quiet",
  casual: "Casual",
  neverTalked: "Never talked",
};

const BUCKET_HELP = {
  close: "Two-way, recent conversations — people who actually write back.",
  oneSided: "You have been writing. They rarely reply.",
  goneQuiet: "You were in touch, then it stopped for six months or more.",
  casual: "A short or recent exchange that is not yet a real back-and-forth.",
  neverTalked: "In your connections (or invites) with no messages in this export.",
};

function personMatches(p, query) {
  if (!query) return true;
  const hay = [p.name, p.company, p.position, p.url, p.email].join(" ").toLowerCase();
  return hay.includes(query);
}

function nameHtml(p) {
  const href = profileHref(p.url);
  const name = esc(p.name || "Unknown");
  return href
    ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${name}</a>`
    : name;
}

function personCard(p, extra = "") {
  const role = [p.position, p.company].filter(Boolean).join(" · ");
  const last = p.lastContact ? `${fmtDate(p.lastContact)} (${ago(p.lastContact)})` : "No messages";
  const reply = p.replyRate == null ? "—" : pct(p.replyRate);
  const msg = p.youSent + p.theySent > 0
    ? `You ${p.youSent} · Them ${p.theySent} · They started ${p.theyStarted} · You started ${p.youStarted} · Reply rate ${reply}`
    : (p.invitationsIn || p.invitationsOut)
      ? `Invites: ${p.invitationsIn} in, ${p.invitationsOut} out`
      : "No messages in this export";
  const pill = p.bucket ? `<span class="pill ${esc(p.bucket)}">${esc(BUCKET_LABELS[p.bucket] || p.bucket)}</span>` : extra;
  return `<li class="person">
    <div class="person-head">
      <p class="person-name">${nameHtml(p)}</p>
      ${pill}
    </div>
    ${role ? `<p class="person-meta">${esc(role)}${p.connectedOn ? " · Connected " + esc(p.connectedOn) : ""}</p>` : ""}
    <p class="person-stats">${esc(msg)}</p>
    <p class="person-meta">Last contact: ${esc(last)}</p>
    ${p.reason ? `<p class="person-meta">${esc(p.reason)}</p>` : ""}
  </li>`;
}

function simpleCard(p, pill) {
  const role = [p.position, p.company].filter(Boolean).join(" · ");
  return `<li class="person">
    <div class="person-head">
      <p class="person-name">${nameHtml(p)}</p>
      ${pill}
    </div>
    ${role ? `<p class="person-meta">${esc(role)}${p.connectedOn ? " · Connected " + esc(p.connectedOn) : ""}</p>` : ""}
  </li>`;
}

function renderFriends(insights) {
  const q = state.query.trim().toLowerCase();
  const order = ["close", "oneSided", "goneQuiet", "casual", "neverTalked"];
  return order.map((key) => {
    const list = (insights.buckets[key] || []).filter((p) => personMatches(p, q));
    return `<section>
      <h3 class="subhead">${esc(BUCKET_LABELS[key])} <span class="files-found">(${list.length})</span></h3>
      <p class="note">${esc(BUCKET_HELP[key])}</p>
      ${list.length ? `<ul class="people">${list.map((p) => personCard(p)).join("")}</ul>` : `<p class="empty">No one in this list${q ? " matches your search" : ""}.</p>`}
    </section>`;
  }).join("");
}

function renderLeft(insights) {
  if (!insights.whoLeft.compared) {
    return `<p class="note">${esc(insights.whoLeft.reason)}</p>
      <p class="note">Open “Optional: add an older export” above, and drop a previous zip or Connections.csv. People are matched by profile URL, or by name when a URL is missing.</p>`;
  }
  const q = state.query.trim().toLowerCase();
  const removed = insights.whoLeft.removed.filter((p) => personMatches(p, q));
  const added = insights.whoLeft.added.filter((p) => personMatches(p, q));
  return `<p class="note">Compared with your older Connections.csv. A missing row usually means they removed you, you removed them, or the account closed. This cannot show who unfollowed your posts while staying connected.</p>
    <div class="split">
      <section>
        <h3 class="subhead">No longer in your connections (${removed.length})</h3>
        ${removed.length ? `<ul class="people">${removed.map((p) => simpleCard(p, '<span class="pill removed">Left</span>')).join("")}</ul>` : `<p class="empty">No one left between these two exports.</p>`}
      </section>
      <section>
        <h3 class="subhead">Newly added (${added.length})</h3>
        ${added.length ? `<ul class="people">${added.map((p) => simpleCard(p, '<span class="pill added">New</span>')).join("")}</ul>` : `<p class="empty">No new connections in the later export.</p>`}
      </section>
    </div>`;
}

function renderEngagers(insights) {
  const q = state.query.trim().toLowerCase();
  const list = insights.engagers.ranked.filter((p) => personMatches(p, q));
  const notes = (insights.engagers.notes || []).map((n) => `<li>${esc(n)}</li>`).join("");
  const extra = insights.engagers.reactionsCount
    ? `<p class="note">Your export includes ${insights.engagers.reactionsCount} of your own reactions and ${insights.engagers.commentsCount} of your own comments. Those are your actions, not other people’s.</p>`
    : "";
  return `${extra}
    <ul class="note" style="padding-left:18px">${notes}</ul>
    ${list.length ? `<ul class="people">${list.map((p, i) => `<li class="person">
      <div class="person-head">
        <p class="person-name"><span class="rank">${i + 1}.</span> ${nameHtml(p)}</p>
        <span class="pill ${esc(p.bucket)}">${esc(BUCKET_LABELS[p.bucket] || "")}</span>
      </div>
      <p class="person-stats">Them ${p.theySent} · You ${p.youSent} · Invites in ${p.invitationsIn} · Invites out ${p.invitationsOut}</p>
    </li>`).join("")}</ul>` : `<p class="empty">No message or invitation activity to rank.</p>`}`;
}

function renderReconnect(insights) {
  const q = state.query.trim().toLowerCase();
  const list = insights.reconnect.filter((p) => personMatches(p, q));
  return `<p class="note">Strong past contacts you have not spoken to in six months or more. This is a nudge to say hello, not a score.</p>
    <div class="toolbar">
      <button type="button" class="btn btn-download" id="btn-csv"${insights.reconnect.length ? "" : " disabled"}>Download reconnect list (CSV)</button>
    </div>
    ${list.length ? `<ul class="people">${list.map((p) => personCard(p)).join("")}</ul>` : `<p class="empty">No strong quiet contacts in this export${q ? " match your search" : ""}.</p>`}`;
}

function render() {
  const results = $("results");
  const banner = $("sample-banner");
  const insights = insightsNow();
  banner.hidden = !state.isSample;
  if (!insights) {
    results.hidden = true;
    results.innerHTML = "";
    return;
  }
  results.hidden = false;

  const inferred = inferYou(state.current);
  const you = insights.you;
  const options = [];
  const seen = new Set();
  for (const c of inferred.candidates || []) {
    const key = c.key || personKey(c);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const selected = personKey(you) === key ? " selected" : "";
    options.push(`<option value="${esc(key)}"${selected}>${esc(c.name || c.url || "Unknown")}</option>`);
  }
  if (you && !seen.has(personKey(you))) {
    options.unshift(`<option value="${esc(personKey(you))}" selected>${esc(you.name || you.url)}</option>`);
  }

  const s = insights.summary;
  const tab = state.tab;
  let body = "";
  if (tab === "friends") body = renderFriends(insights);
  else if (tab === "left") body = renderLeft(insights);
  else if (tab === "engagers") body = renderEngagers(insights);
  else body = renderReconnect(insights);

  results.innerHTML = `<div class="results-inner">
    <div class="you-bar">
      <span>Treating you as
        <select id="you-select" aria-label="Person who owns this export">${options.join("")}</select>
      </span>
      <span class="files-found">Files used: ${esc((insights.filesFound || []).join(", ") || "—")}</span>
    </div>
    <div class="stats">
      <div class="stat"><span class="n">${s.connections}</span><span class="l">Connections</span></div>
      <div class="stat"><span class="n">${s.messages}</span><span class="l">Messages</span></div>
      <div class="stat close"><span class="n">${s.close}</span><span class="l">Close</span></div>
      <div class="stat oneSided"><span class="n">${s.oneSided}</span><span class="l">Ignoring you</span></div>
      <div class="stat goneQuiet"><span class="n">${s.goneQuiet}</span><span class="l">Gone quiet</span></div>
      <div class="stat removed"><span class="n">${s.removed}</span><span class="l">Left since last export</span></div>
      <div class="stat"><span class="n">${s.reconnect}</span><span class="l">Worth a hello</span></div>
      <div class="stat"><span class="n">${s.neverTalked}</span><span class="l">Never talked</span></div>
    </div>
    <div class="tabs" role="tablist">
      ${Object.entries(TAB_LABELS).map(([id, label]) =>
        `<button type="button" class="tab" role="tab" data-tab="${id}" aria-selected="${tab === id ? "true" : "false"}">${esc(label)}</button>`
      ).join("")}
    </div>
    <div class="toolbar">
      <input class="search" id="search" type="search" placeholder="Search names, companies…" value="${esc(state.query)}" aria-label="Search people">
    </div>
    <div id="tab-body">${body}</div>
    <aside class="limitations">
      <h3>What this export cannot show</h3>
      <ul>${insights.limitations.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>
    </aside>
  </div>`;

  $("you-select")?.addEventListener("change", (ev) => {
    const key = ev.target.value;
    const cand = (inferred.candidates || []).find((c) => (c.key || personKey(c)) === key);
    state.youOverride = cand ? { name: cand.name, url: cand.url } : you;
    state.isSample = false;
    render();
  });
  $("search")?.addEventListener("input", (ev) => {
    state.query = ev.target.value;
    const bodyEl = $("tab-body");
    const next = insightsNow();
    if (!bodyEl || !next) return;
    if (state.tab === "friends") bodyEl.innerHTML = renderFriends(next);
    else if (state.tab === "left") bodyEl.innerHTML = renderLeft(next);
    else if (state.tab === "engagers") bodyEl.innerHTML = renderEngagers(next);
    else bodyEl.innerHTML = renderReconnect(next);
    bindCsv(next);
  });
  results.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.tab = btn.getAttribute("data-tab");
      render();
    });
  });
  bindCsv(insights);
}

function bindCsv(insights) {
  const btn = $("btn-csv");
  if (!btn || !insights) return;
  btn.addEventListener("click", () => {
    const csv = reconnectCsv(insights.reconnect);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "linkedin-reconnect-list.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}

function wireDropzone(zoneId, inputId, which) {
  const zone = $(zoneId);
  const input = $(inputId);
  if (!zone || !input) return;

  const hijack = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  ["dragenter", "dragover"].forEach((name) => {
    zone.addEventListener(name, (event) => {
      hijack(event);
      zone.classList.add("dragover");
    });
  });
  ["dragleave", "drop"].forEach((name) => {
    zone.addEventListener(name, (event) => {
      hijack(event);
      if (name === "dragleave") zone.classList.remove("dragover");
    });
  });
  zone.addEventListener("drop", (event) => {
    zone.classList.remove("dragover");
    const files = event.dataTransfer && event.dataTransfer.files;
    if (files && files.length) loadFiles(which, files);
  });
  input.addEventListener("change", () => {
    if (input.files && input.files.length) loadFiles(which, input.files);
  });
  zone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      input.click();
    }
  });
}

// Stop the browser from navigating to a dropped zip outside the zone.
["dragover", "drop"].forEach((name) => {
  document.addEventListener(name, (event) => {
    event.preventDefault();
  });
});

wireDropzone("drop-current", "file-current", "current");
wireDropzone("drop-previous", "file-previous", "previous");
$("btn-demo")?.addEventListener("click", loadSample);

if (location.hash === "#demo" || /[?&]demo=1\b/.test(location.search)) {
  loadSample();
}
