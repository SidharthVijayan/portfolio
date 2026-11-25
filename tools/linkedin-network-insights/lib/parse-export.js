/**
 * Parsers for official LinkedIn data-archive CSVs (Connections, messages,
 * Invitations, Reactions, Comments, Profile, Member Follows).
 * Column names match archives observed through 2026.
 */
import { recordsFromCsv, field, normalizeHeader, stripBom } from "./csv.js";

const MONTHS = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8,
  sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10,
  dec: 11, december: 11,
};

export function normalizeProfileUrl(url) {
  if (!url) return "";
  let u = String(url).trim();
  if (!u) return "";
  u = u.replace(/\\/g, "/");
  u = u.split("#")[0].split("?")[0];
  u = u.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  u = u.replace(/\/+$/, "").toLowerCase();
  const m = u.match(/(?:^|\.)linkedin\.com\/in\/([^/]+)/i);
  if (m) return "linkedin.com/in/" + decodeURIComponent(m[1]).replace(/\/+$/, "").toLowerCase();
  const bare = u.match(/^in\/([^/]+)$/i);
  if (bare) return "linkedin.com/in/" + bare[1].toLowerCase();
  return u;
}

export function normalizeName(name) {
  return String(name ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function displayName(first, last, fallback) {
  const full = [first, last].map((p) => String(p || "").trim()).filter(Boolean).join(" ");
  return full || String(fallback || "").trim();
}

export function personKey({ url, name }) {
  const u = normalizeProfileUrl(url);
  if (u) return "url:" + u;
  const n = normalizeName(name);
  if (n) return "name:" + n;
  return "";
}

export function parseDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const utcish = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?(?:\s*(UTC|Z|GMT))?$/i
  );
  if (utcish) {
    const [_, y, mo, d, h = "0", mi = "0", s = "0"] = utcish;
    return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
  }

  const named = raw.match(
    /^(\d{1,2})[ \-]([A-Za-z]+)[ \-](\d{2,4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i
  );
  if (named && MONTHS[named[2].toLowerCase()] != null) {
    let year = +named[3];
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    let hour = named[4] != null ? +named[4] : 0;
    const mer = (named[7] || "").toUpperCase();
    if (mer === "PM" && hour < 12) hour += 12;
    if (mer === "AM" && hour === 12) hour = 0;
    return new Date(year, MONTHS[named[2].toLowerCase()], +named[1], hour, named[5] ? +named[5] : 0, named[6] ? +named[6] : 0);
  }

  const longMonth = raw.match(
    /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i
  );
  if (longMonth && MONTHS[longMonth[1].toLowerCase()] != null) {
    let hour = longMonth[4] != null ? +longMonth[4] : 0;
    const mer = (longMonth[7] || "").toUpperCase();
    if (mer === "PM" && hour < 12) hour += 12;
    if (mer === "AM" && hour === 12) hour = 0;
    return new Date(+longMonth[3], MONTHS[longMonth[1].toLowerCase()], +longMonth[2], hour, longMonth[5] ? +longMonth[5] : 0, longMonth[6] ? +longMonth[6] : 0);
  }

  // US-style dates used in Invitations.csv: 9/16/26, 12:19 PM
  const us = raw.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i
  );
  if (us) {
    let year = +us[3];
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    let hour = us[4] != null ? +us[4] : 0;
    const mer = (us[7] || "").toUpperCase();
    if (mer === "PM" && hour < 12) hour += 12;
    if (mer === "AM" && hour === 12) hour = 0;
    return new Date(year, +us[1] - 1, +us[2], hour, us[5] ? +us[5] : 0, us[6] ? +us[6] : 0);
  }

  const t = Date.parse(raw);
  if (!Number.isNaN(t)) return new Date(t);
  return null;
}

function splitList(value) {
  if (!value) return [];
  return String(value)
    .split(/\s*[;|]\s*|\s*,\s*(?=https?:|\s*$|[A-Za-z0-9.-]+\s*$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Split a LinkedIn TO / recipient field. Names are comma-separated, but a
 * name itself can theoretically contain a comma. Prefer URL counts when
 * both are present; otherwise split on commas that look like separators.
 */
export function splitPeopleList(value) {
  if (!value) return [];
  const raw = String(value).trim();
  if (!raw) return [];
  if (raw.includes(";")) return raw.split(/\s*;\s*/).map((s) => s.trim()).filter(Boolean);
  // URLs never have spaces in the path we care about; split on comma.
  if (/linkedin\.com\/in\//i.test(raw) || /^https?:/i.test(raw)) {
    return raw.split(/\s*,\s*/).map((s) => s.trim()).filter(Boolean);
  }
  return raw.split(/\s*,\s*/).map((s) => s.trim()).filter(Boolean);
}

export function parseConnections(text) {
  const { records, headerIndex } = recordsFromCsv(text, ["First Name", "Last Name"]);
  // Header must also reasonably look like Connections, not messages.
  const people = [];
  for (const rec of records) {
    const first = field(rec, "First Name");
    const last = field(rec, "Last Name");
    const url = field(rec, "URL", "Profile URL", "Public Profile URL");
    const name = displayName(first, last);
    if (!name && !url) continue;
    people.push({
      firstName: first,
      lastName: last,
      name: name || url,
      url: normalizeProfileUrl(url),
      urlRaw: url,
      email: field(rec, "Email Address", "Email"),
      company: field(rec, "Company"),
      position: field(rec, "Position", "Title"),
      connectedOn: field(rec, "Connected On", "Connected On Date"),
      connectedOnDate: parseDate(field(rec, "Connected On", "Connected On Date")),
    });
  }
  return { type: "connections", people, skippedPreamble: headerIndex > 0, headerIndex };
}

export function parseMessages(text) {
  const { records } = recordsFromCsv(text, ["FROM", "DATE"]);
  const messages = [];
  for (const rec of records) {
    const from = field(rec, "FROM", "From");
    const toRaw = field(rec, "TO", "To");
    const senderUrl = field(rec, "SENDER PROFILE URL", "Sender Profile URL", "Sender URL");
    const recipientUrlsRaw = field(rec, "RECIPIENT PROFILE URLS", "Recipient Profile URLs", "Recipient Profile URL");
    const dateRaw = field(rec, "DATE", "Date");
    const draft = field(rec, "IS MESSAGE DRAFT", "Is Message Draft").toLowerCase();
    if (draft === "yes" || draft === "true" || draft === "1") continue;
    messages.push({
      conversationId: field(rec, "CONVERSATION ID", "Conversation ID", "ConversationId"),
      conversationTitle: field(rec, "CONVERSATION TITLE", "Conversation Title"),
      from,
      senderUrl: normalizeProfileUrl(senderUrl),
      to: splitPeopleList(toRaw),
      toRaw,
      recipientUrls: splitPeopleList(recipientUrlsRaw).map(normalizeProfileUrl).filter(Boolean),
      dateRaw,
      date: parseDate(dateRaw),
      subject: field(rec, "SUBJECT", "Subject"),
      content: field(rec, "CONTENT", "Content", "Message"),
      folder: field(rec, "FOLDER", "Folder"),
      attachments: field(rec, "ATTACHMENTS", "Attachments"),
    });
  }
  return { type: "messages", messages };
}

export function parseInvitations(text) {
  const { records } = recordsFromCsv(text, ["From", "To"]);
  const invitations = [];
  for (const rec of records) {
    const from = field(rec, "From");
    const to = field(rec, "To");
    if (!from && !to) continue;
    const direction = field(rec, "Direction").toUpperCase();
    invitations.push({
      from,
      to,
      sentAtRaw: field(rec, "Sent At", "Sent At Date", "Date"),
      sentAt: parseDate(field(rec, "Sent At", "Sent At Date", "Date")),
      message: field(rec, "Message"),
      direction,
      inviterUrl: normalizeProfileUrl(field(rec, "inviterProfileUrl", "Inviter Profile URL", "Inviter URL")),
      inviteeUrl: normalizeProfileUrl(field(rec, "inviteeProfileUrl", "Invitee Profile URL", "Invitee URL")),
    });
  }
  return { type: "invitations", invitations };
}

export function parseReactions(text) {
  const { records, headers } = recordsFromCsv(text, ["Date"]);
  // Official Reactions.csv is Date, Type, Link — your own reactions.
  const personCols = headers.filter((h) =>
    /name|from|author|actor|member|profile url|actor url/.test(h) && !/link/.test(h)
  );
  const reactions = records.map((rec) => ({
    dateRaw: field(rec, "Date"),
    date: parseDate(field(rec, "Date")),
    type: field(rec, "Type", "Reaction Type", "Reaction"),
    link: field(rec, "Link", "URL", "ShareLink"),
  }));
  return {
    type: "reactions",
    reactions,
    hasPerPerson: personCols.length > 0,
    columns: headers,
  };
}

export function parseComments(text) {
  const { records, headers } = recordsFromCsv(text, ["Date"]);
  const personCols = headers.filter((h) =>
    /name|from|author|actor|member|profile url/.test(h) && !/link/.test(h)
  );
  const comments = records.map((rec) => ({
    dateRaw: field(rec, "Date"),
    date: parseDate(field(rec, "Date")),
    link: field(rec, "Link", "URL"),
    message: field(rec, "Message", "Comment", "Content", "Text"),
  }));
  return {
    type: "comments",
    comments,
    hasPerPerson: personCols.length > 0,
    columns: headers,
  };
}

export function parseProfile(text) {
  const { records, headers } = recordsFromCsv(text, []);
  // Profile.csv varies. Try a first-name header; otherwise treat first row values.
  let first = "", last = "", url = "", email = "";
  if (records.length) {
    const rec = records[0];
    first = field(rec, "First Name", "FirstName", "First");
    last = field(rec, "Last Name", "LastName", "Last");
    url = field(rec, "URL", "Profile URL", "Public Profile URL", "Vanity Name");
    email = field(rec, "Email", "Email Address");
  }
  // Some archives use a two-column "key,value" layout or a single wide row.
  if (!first && !last) {
    const rows = recordsFromCsv(text, headers.length ? headers : []).rawRows;
    // Try scanning all cells for a LinkedIn profile URL and a name-like pair.
    // Also try recordsFromCsv without required headers — already did first row.
  }
  const name = displayName(first, last);
  return { type: "profile", name, firstName: first, lastName: last, url: normalizeProfileUrl(url), email, raw: records[0] || null };
}

const FILE_RULES = [
  { type: "connections", test: /(^|\/)connections\.csv$/i },
  { type: "messages", test: /(^|\/)messages\.csv$/i },
  { type: "invitations", test: /(^|\/)invitations\.csv$/i },
  { type: "reactions", test: /(^|\/)reactions\.csv$/i },
  { type: "comments", test: /(^|\/)comments\.csv$/i },
  { type: "profile", test: /(^|\/)profile\.csv$/i },
  { type: "follows", test: /(^|\/)member[_ ]?follows\.csv$/i },
];

export function classifyFilename(path) {
  const norm = String(path || "").replace(/\\/g, "/");
  for (const rule of FILE_RULES) {
    if (rule.test.test(norm)) return rule.type;
  }
  return "other";
}

export function classifyByHeader(text) {
  const sample = stripBom(text).slice(0, 8000);
  const lower = sample.toLowerCase();
  if (/conversation id/.test(lower) && /\bfrom\b/.test(lower) && /\bcontent\b/.test(lower)) return "messages";
  if (/first name/.test(lower) && /last name/.test(lower) && /connected on/.test(lower)) return "connections";
  if (/\bdirection\b/.test(lower) && /inviterprofileurl|inviteeprofileurl/.test(lower)) return "invitations";
  if (/\btype\b/.test(lower) && /\blink\b/.test(lower) && /\bdate\b/.test(lower) && !/message/.test(lower)) return "reactions";
  if (/\bdate\b/.test(lower) && /\blink\b/.test(lower) && /\bmessage\b/.test(lower)) return "comments";
  return "other";
}

/**
 * @param {Record<string, string>} fileMap path -> file text
 */
export function parseExport(fileMap) {
  const files = [];
  const parsed = {
    connections: [],
    messages: [],
    invitations: [],
    reactions: [],
    comments: [],
    profile: null,
    follows: [],
    unknown: [],
    filesFound: [],
    warnings: [],
  };

  const entries = Object.entries(fileMap || {});
  for (const [path, text] of entries) {
    if (text == null) continue;
    let type = classifyFilename(path);
    if (type === "other" && /\.csv$/i.test(path)) type = classifyByHeader(text);
    if (type === "other") continue;
    files.push({ path, type });
    parsed.filesFound.push({ path, type, name: path.split(/[\\/]/).pop() });
    try {
      if (type === "connections") {
        const r = parseConnections(text);
        parsed.connections = r.people;
        if (r.skippedPreamble) parsed.warnings.push("Skipped the Notes: preamble in Connections.csv.");
      } else if (type === "messages") {
        parsed.messages = parseMessages(text).messages;
      } else if (type === "invitations") {
        parsed.invitations = parseInvitations(text).invitations;
      } else if (type === "reactions") {
        const r = parseReactions(text);
        parsed.reactions = r.reactions;
        parsed.reactionsMeta = { hasPerPerson: r.hasPerPerson, columns: r.columns };
      } else if (type === "comments") {
        const r = parseComments(text);
        parsed.comments = r.comments;
        parsed.commentsMeta = { hasPerPerson: r.hasPerPerson, columns: r.columns };
      } else if (type === "profile") {
        parsed.profile = parseProfile(text);
      }
    } catch (err) {
      parsed.warnings.push("Could not parse " + path + ": " + (err && err.message ? err.message : err));
    }
  }

  return parsed;
}

function bump(map, key, info) {
  if (!key) return;
  if (!map.has(key)) map.set(key, { key, conversations: 0, asFrom: 0, asTo: 0, name: "", url: "", ...info });
  const row = map.get(key);
  if (info.name && !row.name) row.name = info.name;
  if (info.url && !row.url) row.url = info.url;
  return row;
}

/**
 * Infer the archive owner. Prefer Profile.csv, then the From name on
 * OUTGOING invitations, then the participant who appears in the most
 * distinct conversations.
 */
export function inferYou(parsed) {
  const candidates = new Map();

  if (parsed.profile && (parsed.profile.name || parsed.profile.url)) {
    const key = personKey(parsed.profile) || "profile";
    const row = bump(candidates, key, { name: parsed.profile.name, url: parsed.profile.url, source: "profile" });
    if (row) row.score = (row.score || 0) + 100000;
  }

  for (const inv of parsed.invitations || []) {
    if (inv.direction === "OUTGOING") {
      const key = personKey({ url: inv.inviterUrl, name: inv.from });
      const row = bump(candidates, key, { name: inv.from, url: inv.inviterUrl, source: "invitations" });
      if (row) row.score = (row.score || 0) + 50;
    } else if (inv.direction === "INCOMING") {
      const key = personKey({ url: inv.inviteeUrl, name: inv.to });
      const row = bump(candidates, key, { name: inv.to, url: inv.inviteeUrl, source: "invitations" });
      if (row) row.score = (row.score || 0) + 50;
    }
  }

  const convos = new Map();
  for (const msg of parsed.messages || []) {
    const cid = msg.conversationId || "unknown:" + (msg.dateRaw || "") + ":" + (msg.from || "");
    if (!convos.has(cid)) convos.set(cid, new Map());
    const people = convos.get(cid);
    const fromKey = personKey({ url: msg.senderUrl, name: msg.from });
    if (fromKey) {
      if (!people.has(fromKey)) people.set(fromKey, { name: msg.from, url: msg.senderUrl });
    }
    const toNames = msg.to || [];
    const toUrls = msg.recipientUrls || [];
    const n = Math.max(toNames.length, toUrls.length);
    for (let i = 0; i < n; i += 1) {
      const name = toNames[i] || "";
      const url = toUrls[i] || "";
      const key = personKey({ url, name });
      if (key && !people.has(key)) people.set(key, { name, url });
    }
  }

  for (const people of convos.values()) {
    for (const [key, info] of people) {
      const row = bump(candidates, key, info);
      if (row) {
        row.conversations = (row.conversations || 0) + 1;
        row.score = (row.score || 0) + 1;
      }
    }
  }

  const list = [...candidates.values()].sort((a, b) => (b.score || 0) - (a.score || 0) || (b.conversations || 0) - (a.conversations || 0));
  const best = list[0] || { name: "", url: "", score: 0 };
  return {
    name: best.name || "",
    url: best.url || "",
    key: best.key || "",
    confidence: best.score >= 100000 ? "high" : best.score >= 10 ? "medium" : list.length ? "low" : "none",
    candidates: list.slice(0, 8).map((c) => ({
      name: c.name,
      url: c.url,
      key: c.key,
      conversations: c.conversations || 0,
      score: c.score || 0,
    })),
  };
}

export function samePerson(a, b) {
  if (!a || !b) return false;
  const ua = normalizeProfileUrl(a.url);
  const ub = normalizeProfileUrl(b.url);
  if (ua && ub) return ua === ub;
  const na = normalizeName(a.name);
  const nb = normalizeName(b.name);
  if (na && nb) return na === nb;
  return false;
}

export function isYou(person, you) {
  return samePerson(person, you);
}
