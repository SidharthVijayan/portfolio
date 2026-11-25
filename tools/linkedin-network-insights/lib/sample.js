/**
 * Fictional example archive so visitors can try the tool without a
 * LinkedIn export. Names, companies and messages are made up.
 */
import { parseExport } from "./parse-export.js";

const YOU = {
  first: "Meera",
  last: "Iyer",
  name: "Meera Iyer",
  url: "https://www.linkedin.com/in/meera-iyer-example",
};

function iso(daysAgo, hour = 10, minute = 0) {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  const pad = (n) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear() +
    "-" + pad(d.getUTCMonth() + 1) +
    "-" + pad(d.getUTCDate()) +
    " " + pad(d.getUTCHours()) +
    ":" + pad(d.getUTCMinutes()) +
    ":00 UTC"
  );
}

function connectedOn(daysAgo) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const pad = (n) => String(n).padStart(2, "0");
  return pad(d.getDate()) + " " + months[d.getMonth()] + " " + d.getFullYear();
}

function csvEscape(s) {
  const t = s == null ? "" : String(s);
  if (/[",\n\r]/.test(t)) return '"' + t.replace(/"/g, '""') + '"';
  return t;
}

function csv(headers, rows) {
  const lines = [headers.join(",")];
  for (const row of rows) lines.push(row.map(csvEscape).join(","));
  return lines.join("\n") + "\n";
}

const PEOPLE = {
  rohan: { first: "Rohan", last: "Desai", url: "https://www.linkedin.com/in/rohan-desai-example", company: "PixelForge", position: "Staff Engineer", connected: 2400 },
  ananya: { first: "Ananya", last: "Kapoor", url: "https://www.linkedin.com/in/ananya-kapoor-example", company: "Northwind Studio", position: "Head of Design", connected: 800 },
  james: { first: "James", last: "Okonkwo", url: "https://www.linkedin.com/in/james-okonkwo-example", company: "Thames Analytics", position: "Product Manager", connected: 1100 },
  nora: { first: "Nora", last: "Lindgren", url: "https://www.linkedin.com/in/nora-lindgren-example", company: "Fjall Mail", position: "Customer Lead", connected: 400 },
  vikram: { first: "Vikram", last: "Shah", url: "https://www.linkedin.com/in/vikram-shah-example", company: "Redwood Capital", position: "Vice President", connected: 200 },
  lauren: { first: "Lauren", last: "Chen", url: "https://www.linkedin.com/in/lauren-chen-example", company: "Harbor Labs", position: "Recruiter", connected: 90 },
  suresh: { first: "Suresh", last: "Nair", url: "https://www.linkedin.com/in/suresh-nair-example", company: "Independent", position: "Mentor", connected: 3200 },
  fatima: { first: "Fatima", last: "Rahman", url: "https://www.linkedin.com/in/fatima-rahman-example", company: "Crescent Retail", position: "Engineering Manager", connected: 1900 },
  daniel: { first: "Daniel", last: "Park", url: "https://www.linkedin.com/in/daniel-park-example", company: "Seoul Systems", position: "Founder", connected: 2100 },
  arjun: { first: "Arjun", last: "Menon", url: "https://www.linkedin.com/in/arjun-menon-example", company: "Palmside Co", position: "Operations", connected: 20 },
  sofia: { first: "Sofia", last: "Alvarez", url: "https://www.linkedin.com/in/sofia-alvarez-example", company: "Andes Health", position: "Researcher", connected: 15 },
  leila: { first: "Leila", last: "Hassan", url: "https://www.linkedin.com/in/leila-hassan-example", company: "Cairo Mesh", position: "Analyst", connected: 600 },
  deepak: { first: "Deepak", last: "Kulkarni", url: "https://www.linkedin.com/in/deepak-kulkarni-example", company: "Deccan Rails", position: "Finance Controller", connected: 1500 },
  priya: { first: "Priya", last: "Banerjee", url: "https://www.linkedin.com/in/priya-banerjee-example", company: "Hooghly Media", position: "Editor", connected: 730 },
  kiran: { first: "Kiran", last: "Malhotra", url: "https://www.linkedin.com/in/kiran-malhotra-example", company: "Lotus Payments", position: "SRE", connected: 500 },
  priyanka: { first: "Priyanka", last: "Bose", url: "https://www.linkedin.com/in/priyanka-bose-example", company: "Bay Watch Legal", position: "Associate", connected: 650 },
};

function connRow(p) {
  return [p.first, p.last, p.url, "", p.company, p.position, connectedOn(p.connected)];
}

function connectionsCsv(keys) {
  const preamble =
    "Notes:\n" +
    '"When exporting your connection data, you may notice that some of the email addresses are missing. You will only see email addresses for connections who have allowed their connections to see or download their email address using this setting https://www.linkedin.com/psettings/privacy/email. You can learn more here https://www.linkedin.com/help/linkedin/answer/261"\n' +
    "\n";
  const body = csv(
    ["First Name", "Last Name", "URL", "Email Address", "Company", "Position", "Connected On"],
    keys.map((k) => connRow(PEOPLE[k]))
  );
  return preamble + body;
}

function msg(id, from, fromUrl, to, toUrl, daysAgo, content, hour, title = "") {
  return [
    id,
    title,
    from,
    fromUrl,
    to,
    toUrl,
    iso(daysAgo, hour, (daysAgo * 7) % 50),
    "",
    content,
    "INBOX",
    "",
    "No",
  ];
}

function messagesCsv() {
  const Y = YOU.name, Yu = YOU.url;
  const R = PEOPLE.rohan, A = PEOPLE.ananya, J = PEOPLE.james;
  const V = PEOPLE.vikram, L = PEOPLE.lauren;
  const S = PEOPLE.suresh, F = PEOPLE.fatima, D = PEOPLE.daniel;
  const N = PEOPLE.nora;
  const rows = [];

  // Close: Rohan — frequent, two-way, recent
  rows.push(msg("c-rohan", Y, Yu, R.first + " " + R.last, R.url, 2, "Rohan, did the offer letter land? I am still grinning.", 9));
  rows.push(msg("c-rohan", R.first + " " + R.last, R.url, Y, Yu, 2, "It did. I told Amma before I told anyone else. Thank you for the intro.", 11));
  rows.push(msg("c-rohan", Y, Yu, R.first + " " + R.last, R.url, 1, "That is the best message I have read all week. Celebrate properly.", 8));
  rows.push(msg("c-rohan", R.first + " " + R.last, R.url, Y, Yu, 1, "Dinner in Dombivli the next time I am down. My treat.", 19));

  // Close: Ananya — mentorship, recent
  rows.push(msg("c-ananya", A.first + " " + A.last, A.url, Y, Yu, 18, "Meera, can I send you the portfolio draft tonight?", 14));
  rows.push(msg("c-ananya", Y, Yu, A.first + " " + A.last, A.url, 18, "Please do. I have an hour after the stand-up.", 16));
  rows.push(msg("c-ananya", A.first + " " + A.last, A.url, Y, Yu, 10, "Revised the case study as you suggested. It reads much cleaner.", 9));
  rows.push(msg("c-ananya", Y, Yu, A.first + " " + A.last, A.url, 9, "This is hire-ready. Proud of you.", 10));
  rows.push(msg("c-ananya", A.first + " " + A.last, A.url, Y, Yu, 4, "I got the interview. I will not forget this.", 8));

  // Close: James — diaspora colleague in London
  rows.push(msg("c-james", Y, Yu, J.first + " " + J.last, J.url, 40, "Safe flight back? Hope the lag is kinder this time.", 7));
  rows.push(msg("c-james", J.first + " " + J.last, J.url, Y, Yu, 39, "Landed. Already missing the filter coffee. Remittance went through, by the way.", 21));
  rows.push(msg("c-james", Y, Yu, J.first + " " + J.last, J.url, 12, "Good. Tell your folks I said hello this Sunday.", 8));
  rows.push(msg("c-james", J.first + " " + J.last, J.url, Y, Yu, 11, "I will. They still talk about that Diwali call.", 18));

  // Casual: Nora — recent, light, two-way but thin
  rows.push(msg("c-nora", N.first + " " + N.last, N.url, Y, Yu, 8, "Lovely bumping into you at the meetup.", 17));
  rows.push(msg("c-nora", Y, Yu, N.first + " " + N.last, N.url, 7, "You too — send me the slide deck if you have it.", 9));

  // One-sided: Vikram — you chase a referral, silence
  rows.push(msg("c-vikram", Y, Yu, V.first + " " + V.last, V.url, 60, "Hi Vikram, I hope you are well. I wanted to ask if you might vouch for my application.", 11));
  rows.push(msg("c-vikram", Y, Yu, V.first + " " + V.last, V.url, 45, "Just floating this again in case the first note was buried.", 10));
  rows.push(msg("c-vikram", Y, Yu, V.first + " " + V.last, V.url, 21, "I will close the loop from my side. Wishing you a good quarter.", 9));

  // One-sided: Lauren — recruiter, you replied, they went quiet after first ping? 
  // Actually "you message, they rarely reply" — you follow up, they don't reply.
  rows.push(msg("c-lauren", L.first + " " + L.last, L.url, Y, Yu, 30, "Would you be open to a quick chat about a role we opened?", 15));
  rows.push(msg("c-lauren", Y, Yu, L.first + " " + L.last, L.url, 29, "Happy to talk. Thursday evening IST works.", 19));
  rows.push(msg("c-lauren", Y, Yu, L.first + " " + L.last, L.url, 22, "Checking in — still interested if the role is open.", 8));
  rows.push(msg("c-lauren", Y, Yu, L.first + " " + L.last, L.url, 14, "I will assume the timing slipped. No worries either way.", 8));

  // Gone quiet: Suresh — mentor, rich history, 14 months ago (~420 days)
  rows.push(msg("c-suresh", S.first + " " + S.last, S.url, Y, Yu, 520, "Your writing is getting sharper. Keep going.", 7));
  rows.push(msg("c-suresh", Y, Yu, S.first + " " + S.last, S.url, 519, "That means a lot coming from you, Uncle.", 20));
  rows.push(msg("c-suresh", S.first + " " + S.last, S.url, Y, Yu, 430, "When you are next in Kochi, come home. We will talk about the next step.", 18));
  rows.push(msg("c-suresh", Y, Yu, S.first + " " + S.last, S.url, 429, "I will. I have been thinking about it every week.", 8));

  // Gone quiet: Fatima — ex-colleague, ~11 months
  rows.push(msg("c-fatima", F.first + " " + F.last, F.url, Y, Yu, 400, "The launch held. I still cannot believe we shipped on that timeline.", 13));
  rows.push(msg("c-fatima", Y, Yu, F.first + " " + F.last, F.url, 399, "Because you kept the room calm. I learned more that quarter than in two years.", 16));
  rows.push(msg("c-fatima", F.first + " " + F.last, F.url, Y, Yu, 350, "If you ever want a reference, you do not even have to ask.", 11));
  rows.push(msg("c-fatima", Y, Yu, F.first + " " + F.last, F.url, 349, "I will hold you to that. Miss the team already.", 12));

  // Gone quiet: Daniel — conference friend, ~2 years
  rows.push(msg("c-daniel", Y, Yu, D.first + " " + D.last, D.url, 800, "Daniel, that hallway conversation stayed with me. Thank you.", 18));
  rows.push(msg("c-daniel", D.first + " " + D.last, D.url, Y, Yu, 799, "Likewise. Let us actually start the thing we sketched.", 19));
  rows.push(msg("c-daniel", Y, Yu, D.first + " " + D.last, D.url, 740, "I still have the notes. When the dust settles, I will ping you.", 9));
  rows.push(msg("c-daniel", D.first + " " + D.last, D.url, Y, Yu, 739, "I will be here.", 22));

  return csv(
    ["CONVERSATION ID", "CONVERSATION TITLE", "FROM", "SENDER PROFILE URL", "TO", "RECIPIENT PROFILE URLS", "DATE", "SUBJECT", "CONTENT", "FOLDER", "ATTACHMENTS", "IS MESSAGE DRAFT"],
    rows
  );
}

function invitationsCsv() {
  return csv(
    ["From", "To", "Sent At", "Message", "Direction", "inviterProfileUrl", "inviteeProfileUrl"],
    [
      [
        YOU.name,
        PEOPLE.arjun.first + " " + PEOPLE.arjun.last,
        "", // filled below with a date-like string
        "Great talking at the alumni meet.",
        "OUTGOING",
        YOU.url,
        PEOPLE.arjun.url,
      ],
      [
        PEOPLE.sofia.first + " " + PEOPLE.sofia.last,
        YOU.name,
        "",
        "Loved your note on career breaks. Would be glad to connect.",
        "INCOMING",
        PEOPLE.sofia.url,
        YOU.url,
      ],
      [
        YOU.name,
        PEOPLE.lauren.first + " " + PEOPLE.lauren.last,
        "",
        "",
        "OUTGOING",
        YOU.url,
        PEOPLE.lauren.url,
      ],
    ].map((row, i) => {
      const days = [18, 16, 90][i];
      const d = new Date();
      d.setDate(d.getDate() - days);
      const sent = (d.getMonth() + 1) + "/" + d.getDate() + "/" + String(d.getFullYear()).slice(2) + ", 12:19 PM";
      row[2] = sent;
      return row;
    })
  );
}

function reactionsCsv() {
  return csv(
    ["Date", "Type", "Link"],
    [
      [iso(3), "LIKE", "https://www.linkedin.com/feed/update/urn:li:activity:111"],
      [iso(12), "PRAISE", "https://www.linkedin.com/feed/update/urn:li:activity:222"],
      [iso(20), "EMPATHY", "https://www.linkedin.com/feed/update/urn:li:activity:333"],
    ]
  );
}

function commentsCsv() {
  return csv(
    ["Date", "Link", "Message"],
    [
      [iso(5), "https://www.linkedin.com/feed/update/urn:li:activity:444", "This is such a clear way to put it."],
    ]
  );
}

function profileCsv() {
  return csv(
    ["First Name", "Last Name", "URL", "Email Address"],
    [[YOU.first, YOU.last, YOU.url, ""]]
  );
}

const CURRENT_KEYS = ["rohan", "ananya", "james", "nora", "vikram", "lauren", "suresh", "fatima", "daniel", "arjun", "sofia", "leila", "deepak", "priya"];
const PREVIOUS_KEYS = ["rohan", "ananya", "james", "nora", "vikram", "lauren", "suresh", "fatima", "daniel", "leila", "deepak", "priya", "kiran", "priyanka"];

export function sampleFileMap() {
  return {
    "Connections.csv": connectionsCsv(CURRENT_KEYS),
    "messages.csv": messagesCsv(),
    "Invitations.csv": invitationsCsv(),
    "Reactions.csv": reactionsCsv(),
    "Comments.csv": commentsCsv(),
    "Profile.csv": profileCsv(),
  };
}

export function samplePreviousFileMap() {
  return {
    "Connections.csv": connectionsCsv(PREVIOUS_KEYS),
  };
}

export function sampleExports() {
  return {
    current: parseExport(sampleFileMap()),
    previous: parseExport(samplePreviousFileMap()),
    you: { name: YOU.name, url: YOU.url },
  };
}

export { YOU as SAMPLE_YOU, PEOPLE as SAMPLE_PEOPLE };
