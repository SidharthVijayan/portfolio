/**
 * Insights over a parsed LinkedIn export: who left, real friends vs silent,
 * top engagers, and a reconnect list.
 */
import { inferYou, isYou, normalizeName, normalizeProfileUrl, personKey, samePerson } from "./parse-export.js";

export const SIX_MONTHS_MS = 182 * 24 * 60 * 60 * 1000;
export const BUCKETS = ["close", "oneSided", "goneQuiet", "casual", "neverTalked"];

export function isRecent(date, now, windowMs = SIX_MONTHS_MS) {
  if (!date) return false;
  const t = date instanceof Date ? date.getTime() : +date;
  if (!Number.isFinite(t)) return false;
  return now.getTime() - t < windowMs;
}

function indexPeople(list) {
  const byKey = new Map();
  for (const p of list || []) {
    const key = personKey(p);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, p);
  }
  return byKey;
}

/**
 * Compare two connection lists. Prefer profile URL, fall back to name.
 */
export function compareConnections(oldList, newList) {
  const olds = oldList || [];
  const news = newList || [];
  const usedNew = new Set();

  function findMatch(person, pool, used) {
    const url = normalizeProfileUrl(person.url);
    if (url) {
      const hit = pool.find((c, i) => !used.has(i) && normalizeProfileUrl(c.url) === url);
      if (hit) return { person: hit, index: pool.indexOf(hit) };
    }
    const name = normalizeName(person.name);
    if (!name) return null;
    const hit = pool.find((c, i) => !used.has(i) && !normalizeProfileUrl(c.url) && normalizeName(c.name) === name);
    // If the new/old record has a URL and this one doesn't, still allow a name match
    // when no URL match was possible.
    if (hit) return { person: hit, index: pool.indexOf(hit) };
    if (url) {
      const byName = pool.find((c, i) => !used.has(i) && !normalizeProfileUrl(c.url) && normalizeName(c.name) === name);
      if (byName) return { person: byName, index: pool.indexOf(byName) };
    } else {
      const byName = pool.find((c, i) => !used.has(i) && normalizeName(c.name) === name);
      if (byName) return { person: byName, index: pool.indexOf(byName) };
    }
    return null;
  }

  const removed = [];
  const stayed = [];
  for (const person of olds) {
    const match = findMatch(person, news, usedNew);
    if (match) {
      usedNew.add(match.index);
      stayed.push({ previous: person, current: match.person });
    } else {
      removed.push(person);
    }
  }
  const added = news.filter((_, i) => !usedNew.has(i));
  return { removed, added, stayed, compared: true };
}

function ensurePerson(map, info, you) {
  if (!info) return null;
  if (you && samePerson(info, you)) return null;
  const key = personKey(info);
  if (!key) return null;
  if (!map.has(key)) {
    map.set(key, {
      key,
      name: info.name || "",
      url: normalizeProfileUrl(info.url) || "",
      company: info.company || "",
      position: info.position || "",
      email: info.email || "",
      connectedOn: info.connectedOn || "",
      connectedOnDate: info.connectedOnDate || null,
      inConnections: false,
      youSent: 0,
      theySent: 0,
      youStarted: 0,
      theyStarted: 0,
      yourTurns: 0,
      repliedTurns: 0,
      replyRate: null,
      lastContact: null,
      firstContact: null,
      invitationsIn: 0,
      invitationsOut: 0,
      groupMessages: 0,
      directMessages: 0,
      bucket: "neverTalked",
    });
  }
  const row = map.get(key);
  if (info.name && !row.name) row.name = info.name;
  if (info.url && !row.url) row.url = normalizeProfileUrl(info.url);
  if (info.company && !row.company) row.company = info.company;
  if (info.position && !row.position) row.position = info.position;
  if (info.email && !row.email) row.email = info.email;
  if (info.connectedOn && !row.connectedOn) {
    row.connectedOn = info.connectedOn;
    row.connectedOnDate = info.connectedOnDate || null;
  }
  return row;
}

function touchDate(row, date) {
  if (!date || Number.isNaN(date.getTime())) return;
  if (!row.firstContact || date < row.firstContact) row.firstContact = date;
  if (!row.lastContact || date > row.lastContact) row.lastContact = date;
}

function otherParticipants(msg, you) {
  const people = [];
  const seen = new Set();
  function add(name, url) {
    const info = { name: name || "", url: url || "" };
    if (!info.name && !info.url) return;
    if (you && samePerson(info, you)) return;
    const key = personKey(info);
    if (!key || seen.has(key)) return;
    seen.add(key);
    people.push(info);
  }
  add(msg.from, msg.senderUrl);
  const names = msg.to || [];
  const urls = msg.recipientUrls || [];
  const n = Math.max(names.length, urls.length);
  for (let i = 0; i < n; i += 1) add(names[i] || "", urls[i] || "");
  return people;
}

function conversationParticipants(thread, you) {
  const map = new Map();
  for (const msg of thread) {
    for (const p of otherParticipants(msg, you)) {
      const key = personKey(p);
      if (key && !map.has(key)) map.set(key, p);
    }
  }
  return [...map.values()];
}

function fromYou(msg, you) {
  if (!you) return false;
  return samePerson({ name: msg.from, url: msg.senderUrl }, you);
}

/**
 * Turn-based reply rate: a "you turn" is a run of consecutive messages
 * you sent in a 1:1 thread. It counts as replied if they messaged after it.
 */
export function turnReplyStats(thread, you) {
  const ordered = [...thread].sort((a, b) => {
    const ta = a.date ? a.date.getTime() : 0;
    const tb = b.date ? b.date.getTime() : 0;
    return ta - tb;
  });
  let yourTurns = 0;
  let repliedTurns = 0;
  let pendingYou = false;
  for (const msg of ordered) {
    const mine = fromYou(msg, you);
    if (mine) {
      if (!pendingYou) {
        yourTurns += 1;
        pendingYou = true;
      }
    } else if (pendingYou) {
      repliedTurns += 1;
      pendingYou = false;
    }
  }
  return {
    yourTurns,
    repliedTurns,
    replyRate: yourTurns ? repliedTurns / yourTurns : null,
    startedByYou: ordered.length ? fromYou(ordered[0], you) : false,
  };
}

export function classifyPerson(stats, now) {
  const youSent = stats.youSent || 0;
  const theySent = stats.theySent || 0;
  const total = youSent + theySent;
  const recent = isRecent(stats.lastContact, now);
  const replyRate = stats.replyRate;
  const oneSidedShape =
    youSent >= 2 &&
    (theySent === 0 ||
      theySent / youSent < 0.25 ||
      (replyRate != null && replyRate < 0.3));

  if (total === 0) return "neverTalked";
  if (!recent) {
    // Past contact, gone quiet — including historically one-sided threads.
    return "goneQuiet";
  }
  if (oneSidedShape) return "oneSided";
  const substantialTwoWay = youSent >= 1 && theySent >= 1 && (theySent >= 2 || youSent + theySent >= 4);
  if (substantialTwoWay) return "close";
  // Recent, thin, not clearly one-sided (a short hello, or they wrote once).
  return "casual";
}

export function analyzeRelationships({ connections, messages, invitations, you, now }) {
  const map = new Map();
  for (const c of connections || []) {
    const row = ensurePerson(map, c, you);
    if (row) row.inConnections = true;
  }

  const threads = new Map();
  for (const msg of messages || []) {
    const cid = msg.conversationId || "loose:" + (msg.dateRaw || "") + ":" + (msg.from || "");
    if (!threads.has(cid)) threads.set(cid, []);
    threads.get(cid).push(msg);
  }

  for (const thread of threads.values()) {
    const others = conversationParticipants(thread, you);
    const isGroup = others.length > 1;
    for (const msg of thread) {
      const mine = fromYou(msg, you);
      for (const other of isGroup ? otherParticipants(msg, you) : others) {
        const row = ensurePerson(map, other, you);
        if (!row) continue;
        if (isGroup) row.groupMessages += 1;
        else row.directMessages += 1;
        if (mine) row.youSent += 1;
        else if (samePerson({ name: msg.from, url: msg.senderUrl }, other)) row.theySent += 1;
        touchDate(row, msg.date);
      }
    }
    if (!isGroup && others.length === 1) {
      const row = ensurePerson(map, others[0], you);
      if (row) {
        const turns = turnReplyStats(thread, you);
        row.yourTurns += turns.yourTurns;
        row.repliedTurns += turns.repliedTurns;
        if (turns.startedByYou) row.youStarted += 1;
        else if (thread.length) row.theyStarted += 1;
      }
    }
  }

  for (const row of map.values()) {
    row.replyRate = row.yourTurns ? row.repliedTurns / row.yourTurns : null;
  }

  for (const inv of invitations || []) {
    const outgoing = inv.direction === "OUTGOING";
    const incoming = inv.direction === "INCOMING";
    const other = outgoing
      ? { name: inv.to, url: inv.inviteeUrl }
      : incoming
        ? { name: inv.from, url: inv.inviterUrl }
        : null;
    if (!other) continue;
    if (you && samePerson(other, you)) continue;
    const row = ensurePerson(map, other, you);
    if (!row) continue;
    if (outgoing) row.invitationsOut += 1;
    if (incoming) row.invitationsIn += 1;
    touchDate(row, inv.sentAt);
  }

  const people = [...map.values()].map((row) => {
    const bucket = classifyPerson(row, now);
    return { ...row, bucket };
  });

  people.sort((a, b) => {
    const ta = a.lastContact ? a.lastContact.getTime() : 0;
    const tb = b.lastContact ? b.lastContact.getTime() : 0;
    return tb - ta || (b.theySent + b.youSent) - (a.theySent + a.youSent) || a.name.localeCompare(b.name);
  });

  const buckets = { close: [], oneSided: [], goneQuiet: [], casual: [], neverTalked: [] };
  for (const p of people) buckets[p.bucket].push(p);
  return { people, buckets, conversationCount: threads.size };
}

export function topEngagers(people, { reactionsMeta, commentsMeta, reactionsCount, commentsCount } = {}) {
  const ranked = [...(people || [])]
    .filter((p) => p.theySent + p.youSent + p.invitationsIn + p.invitationsOut > 0)
    .map((p) => {
      const messageScore = p.theySent * 3 + p.youSent + p.theyStarted * 2;
      const inviteScore = p.invitationsIn * 2 + p.invitationsOut;
      return {
        ...p,
        score: messageScore + inviteScore,
        messageScore,
        inviteScore,
      };
    })
    .sort((a, b) => b.score - a.score || b.theySent - a.theySent || a.name.localeCompare(b.name));

  const reactionsHavePeople = !!(reactionsMeta && reactionsMeta.hasPerPerson);
  const commentsHavePeople = !!(commentsMeta && commentsMeta.hasPerPerson);
  const notes = [];
  if (!reactionsHavePeople) {
    notes.push(
      "Reactions.csv in the official export lists reactions you left, not who reacted to your posts. This ranking therefore cannot include post reactions from other people."
    );
  }
  if (!commentsHavePeople) {
    notes.push(
      "Comments.csv lists comments you wrote. It does not include comments other people left on your posts."
    );
  }
  return {
    ranked,
    reactionsHavePeople,
    commentsHavePeople,
    reactionsCount: reactionsCount || 0,
    commentsCount: commentsCount || 0,
    notes,
  };
}

/**
 * Strong past contacts who have gone quiet: two-way history, or a
 * substantial message volume, with no contact in 6+ months.
 */
export function reconnectList(people, now) {
  return (people || [])
    .filter((p) => {
      if (p.bucket !== "goneQuiet") return false;
      const twoWay = p.youSent >= 1 && p.theySent >= 1;
      const substantial = p.youSent + p.theySent >= 4 || p.theySent >= 2;
      return twoWay || substantial;
    })
    .sort((a, b) => {
      const strength = (p) => p.theySent * 3 + p.youSent + (p.theyStarted || 0) * 2;
      return strength(b) - strength(a) || (a.lastContact?.getTime() || 0) - (b.lastContact?.getTime() || 0);
    })
    .map((p) => ({
      ...p,
      reason: p.youSent >= 1 && p.theySent >= 1
        ? "You used to write to each other, then it went quiet."
        : "There was a real thread here, then it stopped.",
    }));
}

export function reconnectCsv(list) {
  const header = [
    "Name",
    "Company",
    "Position",
    "Profile URL",
    "Last contact",
    "Messages from you",
    "Messages from them",
    "Conversations they started",
    "Conversations you started",
    "Why they're on this list",
  ];
  const lines = [header.map(csvCell).join(",")];
  for (const p of list || []) {
    const url = p.url ? "https://" + p.url.replace(/^https?:\/\//, "") : "";
    const last = p.lastContact ? p.lastContact.toISOString().slice(0, 10) : "";
    lines.push(
      [
        p.name,
        p.company,
        p.position,
        url,
        last,
        p.youSent,
        p.theySent,
        p.theyStarted,
        p.youStarted,
        p.reason || "",
      ].map(csvCell).join(",")
    );
  }
  return lines.join("\n") + "\n";
}

function csvCell(value) {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function buildInsights(current, previous, { now = new Date(), you: youOverride, isSample = false } = {}) {
  const you = youOverride && (youOverride.name || youOverride.url)
    ? { name: youOverride.name || "", url: normalizeProfileUrl(youOverride.url || ""), key: personKey(youOverride) }
    : inferYou(current);

  const rel = analyzeRelationships({
    connections: current.connections || [],
    messages: current.messages || [],
    invitations: current.invitations || [],
    you,
    now,
  });

  let whoLeft = { compared: false, removed: [], added: [], stayed: [], reason: "Load an older export to see who left and who joined." };
  if (previous && (previous.connections || []).length) {
    whoLeft = { ...compareConnections(previous.connections, current.connections || []), compared: true, reason: "" };
  } else if (previous && previous.filesFound && previous.filesFound.length) {
    whoLeft.reason = "The older file did not include a Connections.csv, so a comparison was not possible.";
  }

  const engagers = topEngagers(rel.people, {
    reactionsMeta: current.reactionsMeta,
    commentsMeta: current.commentsMeta,
    reactionsCount: (current.reactions || []).length,
    commentsCount: (current.comments || []).length,
  });
  const reconnect = reconnectList(rel.people, now);

  const files = (current.filesFound || []).map((f) => f.name || f.path);
  return {
    you,
    isSample: !!isSample,
    now,
    filesFound: files,
    warnings: current.warnings || [],
    summary: {
      connections: (current.connections || []).length,
      messages: (current.messages || []).length,
      conversations: rel.conversationCount,
      invitations: (current.invitations || []).length,
      close: rel.buckets.close.length,
      oneSided: rel.buckets.oneSided.length,
      goneQuiet: rel.buckets.goneQuiet.length,
      casual: rel.buckets.casual.length,
      neverTalked: rel.buckets.neverTalked.length,
      removed: whoLeft.removed.length,
      added: whoLeft.added.length,
      reconnect: reconnect.length,
    },
    whoLeft,
    people: rel.people,
    buckets: rel.buckets,
    engagers,
    reconnect,
    limitations: [
      "Who viewed your profile is not in LinkedIn's data export. LinkedIn only shows that on its own site.",
      "Post impressions, and who saw your posts most, are also not in the export.",
      "“Who left” is a comparison of two official connection lists. It cannot see who unfollowed you while staying connected, and a missing row may mean they removed you, you removed them, or the account closed.",
    ],
  };
}

export { inferYou, isYou, personKey, samePerson };
