/**
 * Small RFC4180-ish CSV parser. Handles quoted fields, escaped quotes,
 * embedded newlines, UTF-8 BOM, and \r\n or \r line endings.
 */
export function stripBom(text) {
  const s = String(text ?? "");
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

export function normalizeHeader(name) {
  return stripBom(String(name ?? ""))
    .trim()
    .toLowerCase()
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ");
}

export function parseCsv(text) {
  const input = stripBom(text);
  const rows = [];
  let row = [];
  let field = "";
  let i = 0;
  let inQuotes = false;
  const len = input.length;

  while (i < len) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      i += 1;
      continue;
    }
    if (ch === "\r") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      i += 1;
      if (input[i] === "\n") i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (inQuotes || field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  // Drop a trailing empty row produced by a final newline.
  if (rows.length && rows[rows.length - 1].every((c) => c === "")) {
    rows.pop();
  }
  return rows;
}

/**
 * Find the first row that looks like a header (all of `required` appear
 * as normalized cells) and return objects for the rows after it.
 */
export function recordsFromCsv(text, requiredHeaders) {
  const rows = parseCsv(text);
  const required = (requiredHeaders || []).map(normalizeHeader);
  let headerIndex = -1;
  let headers = [];
  for (let r = 0; r < rows.length; r += 1) {
    const normalized = rows[r].map(normalizeHeader);
    if (required.every((h) => normalized.includes(h))) {
      headerIndex = r;
      headers = normalized;
      break;
    }
  }
  if (headerIndex === -1) {
    return { headers: [], records: [], headerIndex: -1, rawRows: rows };
  }
  const records = [];
  for (let r = headerIndex + 1; r < rows.length; r += 1) {
    const raw = rows[r];
    if (raw.every((c) => String(c).trim() === "")) continue;
    const rec = Object.create(null);
    rec.__cells = raw;
    for (let c = 0; c < headers.length; c += 1) {
      const key = headers[c];
      if (!key) continue;
      rec[key] = raw[c] == null ? "" : String(raw[c]).trim();
    }
    records.push(rec);
  }
  return { headers, records, headerIndex, rawRows: rows };
}

export function field(rec, ...aliases) {
  if (!rec) return "";
  for (const alias of aliases) {
    const key = normalizeHeader(alias);
    if (rec[key] != null && rec[key] !== "") return rec[key];
  }
  return "";
}
