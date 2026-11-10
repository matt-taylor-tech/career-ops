// One application's history, merged from the files the core already keeps.
//
// Pure .mjs so the detail page can import it and `node --test` can cover it
// (web/AGENTS.md). Nothing here reads a file: the server side hands in what it
// read, and this module only decides what the timeline says.
//
// Sources, and the rule each one follows:
//
//   status       data/status-log.tsv rows (the transition ledger, #5555)
//   followup     data/follow-ups.md rows, parsed by the core's parseFollowups
//   assessment   data/assessments.tsv rows, parsed by the core's parseAssessments
//   report       reports/{num}-*.md files for the row (initial and re-evaluations)
//   scan         the date the posting was first seen in data/scan-history.tsv
//   interview    data/active-interviews.md rounds, parsed by the core's
//                parseActiveInterviews and paired with a tracker row by the
//                core's matchInterviewRow (`#N in tracker`, then Company+Role).
//                The server hands in each row with the `matchedNum` that
//                matcher chose; a row it could not pair has none and is left
//                out of every application's timeline rather than guessed.
//   document     data/pdf-index.tsv rows (generate-pdf.mjs's manifest, parsed by
//                parsePdfManifestRows), matched by REPORT number like reports
//                and assessments.
//   email        data/reply-candidates.json (reply-watch's intake), paired with
//                a tracker row by the core's matchCandidates (reply-matcher.mjs).
//                Same contract as interviews: the server hands in `matchedNum`,
//                set only for a single, non-low-confidence match.
//   marker       the tracker row's current status when the status log does not
//                end there — a change made by hand that the ledger never saw.
//
// Each source arrives as one of three shapes, and the difference matters:
//
//   null / undefined    the file is not there. Normal (a user who never logged a
//                       follow-up has no follow-ups.md), so it is omitted silently.
//   { error: string }   the file is there but could not be read. Surfaced as a
//                       warning next to the events the other sources produced —
//                       never as an empty timeline, which would claim "nothing
//                       happened" when the truth is "we could not tell".
//   an array            the parsed rows (possibly empty).

/** Same-day order: discovered, evaluated, documents built, moved through the
 *  tracker, tested, interviewed, emailed, followed up (a thank-you comes after
 *  the call it thanks for). The unlogged-status marker always comes last. */
export const KIND_ORDER = ["scan", "report", "document", "status", "assessment", "interview", "email", "followup", "marker"];

export const KIND_LABELS = {
  scan: "Scan",
  report: "Report",
  document: "Document",
  status: "Status",
  assessment: "Assessment",
  interview: "Interview",
  email: "Email",
  followup: "Follow-up",
  marker: "Current",
};

const SOURCE_NAMES = {
  status: "status log (data/status-log.tsv)",
  followups: "follow-up log (data/follow-ups.md)",
  assessments: "assessment log (data/assessments.tsv)",
  interviews: "interview log (data/active-interviews.md)",
  reports: "reports folder (reports/)",
  scan: "scan history (data/scan-history.tsv)",
  documents: "PDF manifest (data/pdf-index.tsv)",
  emails: "reply candidates (data/reply-candidates.json)",
};

const DOCUMENT_TITLES = { cv: "Resume generated", cover: "Cover letter generated" };
const SNIPPET_MAX = 220;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Sender address → tracker number, from data/contacts.tsv rows the candidate
 * linked to an application (contacts.mjs parseContacts: {email, tracker}).
 * An address linked to two different rows is dropped: the link must be
 * unambiguous to be worth more than the matcher's tie.
 * @param {Array<{email?: string|null, tracker?: string|null}>} contacts
 * @returns {Map<string, number>}
 */
export function contactLinkIndex(contacts) {
  const seen = new Map();
  for (const c of contacts || []) {
    const email = String(c?.email ?? "").trim().toLowerCase();
    const num = Number.parseInt(String(c?.tracker ?? ""), 10);
    if (!email || !Number.isInteger(num) || num <= 0) continue;
    const prev = seen.get(email);
    seen.set(email, prev === undefined || prev === num ? num : null);
  }
  const index = new Map();
  for (const [email, num] of seen) if (num !== null) index.set(email, num);
  return index;
}

// Words too generic to identify a company on their own.
const GENERIC_COMPANY_WORDS = new Set([
  "group", "groups", "company", "corp", "corporation", "incorporated", "limited", "holdings",
  "services", "solutions", "systems", "technologies", "technology", "software", "health",
  "healthcare", "care", "primary", "partners", "global", "international", "consulting",
]);

/**
 * True when the email text names the company: any distinctive word (4+ letters,
 * not a generic suffix) of the company name appears as a whole word.
 * @param {string} company
 * @param {string} text
 */
export function companyMentioned(company, text) {
  const words = String(company ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !GENERIC_COMPANY_WORDS.has(w));
  if (!words.length) return false;
  const haystack = ` ${String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  return words.some((w) => haystack.includes(` ${w} `));
}

/**
 * Which application an email belongs to. The core matcher's pairing wins; a
 * saved contact's tracker link only settles an email the matcher left
 * unpaired (a tie between two rows of the same company, say), only when that
 * row exists, and only when the email names that row's company. A recruiter
 * linked to one application often writes about another (a new client), and
 * that email must not land on the linked row.
 * @param {{matchedNum: number|null, senderEmail: string|null, text?: string, contactIndex: Map<string, number>, knownRows: Map<number, string>}} args
 *   `text` is the email's subject, snippet and sender; `knownRows` maps tracker number → company.
 * @returns {number|null}
 */
export function resolveEmailApplication({ matchedNum, senderEmail, text = "", contactIndex, knownRows }) {
  if (matchedNum !== null && matchedNum !== undefined) return matchedNum;
  const linked = senderEmail ? contactIndex?.get(String(senderEmail).toLowerCase()) : undefined;
  if (linked === undefined || !knownRows?.has(linked)) return null;
  return companyMentioned(knownRows.get(linked), text) ? linked : null;
}

/** The calendar day an event happened on, or null when the cell is not one. */
export function eventDay(raw) {
  const s = String(raw ?? "").trim();
  const day = s.slice(0, 10);
  return ISO_DAY.test(day) ? day : null;
}

// active-interviews.md column lookup, case-insensitive like the core's
// findColumn: the header is candidate-edited markdown.
function cell(row, name) {
  const key = Object.keys(row || {}).find((k) => k.trim().toLowerCase() === name);
  return key ? present(row[key]) : "";
}

function isError(source) {
  return Boolean(source) && !Array.isArray(source) && typeof source === "object" && "error" in source;
}

function rows(source) {
  return Array.isArray(source) ? source : [];
}

const clean = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const present = (v) => {
  const s = clean(v);
  return s && s !== "-" && s !== "—" ? s : "";
};

function statusEvents(log, appNum) {
  const out = [];
  for (const r of rows(log)) {
    if (Number(r.num) !== appNum) continue;
    const from = present(r.from);
    const to = present(r.to);
    const note = present(r.note);
    if (!to && !note) continue;
    // A line that changes nothing (set-status with the same state) only exists
    // to carry its note; without one it says nothing and is dropped.
    const unchanged = from && to && from.toLowerCase() === to.toLowerCase();
    if (unchanged && !note) continue;
    out.push({
      kind: "status",
      date: r.date,
      title: unchanged ? `Note (${to})` : from ? `${from} → ${to}` : to,
      detail: note,
      meta: present(r.source),
    });
  }
  return out;
}

function followupEvents(entries, appNum) {
  return rows(entries)
    .filter((e) => Number(e.appNum) === appNum)
    .map((e) => {
      const channel = present(e.channel);
      const contact = present(e.contact);
      return {
        kind: "followup",
        date: e.date,
        title: [channel || "Follow-up", contact].filter(Boolean).join(" · "),
        detail: present(e.notes),
        meta: "",
      };
    });
}

function assessmentEvents(entries, numbers) {
  return rows(entries)
    .filter((a) => numbers.has(Number.parseInt(String(a.reportNum ?? ""), 10)))
    .map((a) => {
      const parts = [];
      if (a.score != null) parts.push(`score ${a.score}%`);
      if (a.threshold != null) parts.push(`threshold ${a.threshold}%`);
      if (a.deadline) parts.push(`due ${a.deadline}`);
      if (a.submittedAt) parts.push(`submitted ${a.submittedAt}`);
      if (a.staleNote) parts.push(a.staleNote);
      return {
        kind: "assessment",
        date: a.date,
        title: [present(a.platform), present(a.subject)].filter(Boolean).join(" · ") || "Assessment",
        detail: parts.join("; "),
        meta: a.kind === "take-home" ? "take-home" : "",
      };
    });
}

/** reports/{num}-{slug}-{YYYY-MM-DD}.md → its date, oldest first. The first is
 *  the evaluation; any later file for the same number is a re-evaluation. */
function reportEvents(files) {
  const dated = rows(files)
    .map((file) => ({ file: String(file), date: String(file).match(/(\d{4}-\d{2}-\d{2})\.md$/i)?.[1] ?? "" }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return dated.map((r, i) => ({
    kind: "report",
    date: r.date,
    title: i === 0 ? "Evaluated" : "Re-evaluated",
    detail: "",
    meta: r.file,
  }));
}

/** Rounds the core's matcher paired with this row. The Date/Time cell keeps
 *  its time ("2026-11-04 10:00 ET"); a cell with no YYYY-MM-DD at its start
 *  sorts as undated rather than being guessed. */
function interviewEvents(entries, appNum) {
  return rows(entries)
    .filter((e) => Number(e?.matchedNum) === appNum)
    .map((e) => {
      const row = e.row ?? {};
      const when = cell(row, "date/time");
      const time = eventDay(when) ? when.slice(10).trim() : when;
      const interviewer = cell(row, "interviewer");
      const notes = cell(row, "notes").replace(/#\s*\d+\s+in\s+tracker\s*[;,]?\s*/i, "").trim();
      return {
        kind: "interview",
        date: when,
        title: [cell(row, "round") || "Interview", interviewer].filter(Boolean).join(" · "),
        detail: notes,
        meta: [time, cell(row, "status")].filter(Boolean).join(" · "),
      };
    });
}

/** pdf-index.tsv rows for this report. The manifest keeps one row per report
 *  and kind, so a regeneration replaces its row; same-day duplicates that do
 *  slip through collapse in the de-duplication below (meta is not in the key). */
function documentEvents(rows_, numbers) {
  return rows(rows_)
    .filter((r) => numbers.has(Number.parseInt(String(r?.reportId ?? ""), 10)))
    .map((r) => ({
      kind: "document",
      date: r.date,
      title: DOCUMENT_TITLES[r.kind] ?? "Document generated",
      detail: "",
      meta: String(r.pdf ?? "").split(/[\\/]/).pop() ?? "",
    }));
}

/** Emails the core's reply matcher paired with this row. Direction comes from
 *  the candidate's own addresses (profile.yml), when there are any. */
function emailEvents(entries, appNum, selfAddresses) {
  const self = new Set(rows(selfAddresses).map((a) => clean(a).toLowerCase()).filter(Boolean));
  return rows(entries)
    .filter((e) => Number(e?.matchedNum) === appNum)
    .map((e) => {
      const c = e.candidate ?? {};
      const from = present(c.from);
      const address = (from.match(/[^\s<>]+@[^\s<>]+/)?.[0] ?? "").toLowerCase();
      const direction = self.size && address ? (self.has(address) ? "sent" : "received") : "";
      let snippet = present(c.body_snippet);
      if (snippet.length > SNIPPET_MAX) snippet = `${snippet.slice(0, SNIPPET_MAX - 1).trimEnd()}…`;
      return {
        kind: "email",
        date: c.date,
        title: present(c.subject) || "(no subject)",
        detail: snippet,
        meta: [direction, from].filter(Boolean).join(" · "),
      };
    });
}

/** The tracker's current status, when the status log never reached it. A row
 *  with no ledger lines starts at Evaluated (its report is the evaluation), so
 *  that state is not a gap. Undated: the ledger is the only thing that dates a
 *  status change, and it has none for this one. */
function markerEvents(currentStatus, log, appNum) {
  const current = present(currentStatus);
  if (!current) return [];
  const mine = rows(log).filter((r) => Number(r.num) === appNum && present(r.to));
  const last = mine.length ? present(mine[mine.length - 1].to) : "Evaluated";
  if (last.toLowerCase() === current.toLowerCase()) return [];
  return [{
    kind: "marker",
    date: "",
    title: `Current status: ${current}`,
    detail: "This change is not in the status log (data/status-log.tsv), so when it happened is not recorded.",
    meta: "",
  }];
}

function scanEvents(firstSeen) {
  const day = Array.isArray(firstSeen) ? firstSeen[0] : firstSeen;
  return day && !isError(day) ? [{ kind: "scan", date: day, title: "First seen in a scan", detail: "", meta: "" }] : [];
}

/**
 * @param {object} input
 * @param {number|string} input.appNum          tracker # of the row
 * @param {number|string|null} [input.reportNum] report number when it differs from the row's
 * @param {Array|{error:string}|null} [input.statusLog]   web parseStatusLog() rows
 * @param {Array|{error:string}|null} [input.followups]   core parseFollowups() entries
 * @param {Array|{error:string}|null} [input.assessments] core parseAssessments().rows
 * @param {Array<{row:object,matchedNum:number|null}>|{error:string}|null} [input.interviews]
 *   active-interviews.md rows with the tracker # the core matcher paired them to
 * @param {Array|{error:string}|null} [input.reports]     report file names for the row
 * @param {string|{error:string}|null} [input.firstSeen]  YYYY-MM-DD
 * @param {Array|{error:string}|null} [input.documents]   parsePdfManifestRows() rows
 * @param {Array<{candidate:object,matchedNum:number|null}>|{error:string}|null} [input.emails]
 *   reply-candidates.json entries with the tracker # the core reply matcher paired them to
 * @param {string[]} [input.selfAddresses]  the candidate's own email addresses (lower-case)
 * @param {string|null} [input.currentStatus]  the tracker row's Status cell
 * @returns {{events: Array<{kind:string,date:string,day:string|null,title:string,detail:string,meta:string}>, warnings: string[], empty: boolean}}
 */
export function buildApplicationTimeline(input) {
  const appNum = Number.parseInt(String(input?.appNum ?? ""), 10);
  const warnings = [];
  const sources = {
    status: input?.statusLog,
    followups: input?.followups,
    assessments: input?.assessments,
    interviews: input?.interviews,
    reports: input?.reports,
    scan: input?.firstSeen,
    documents: input?.documents,
    emails: input?.emails,
  };
  for (const [key, value] of Object.entries(sources)) {
    if (isError(value)) warnings.push(`Could not read the ${SOURCE_NAMES[key]}: ${value.error}`);
  }
  if (!Number.isInteger(appNum)) return { events: [], warnings, empty: true };

  // assessments.tsv keys a row by its REPORT number. That usually equals the
  // row number; when it doesn't, the row number names another row's report,
  // so it is only the fallback for a row with no report number.
  const reportNum = Number.parseInt(String(input?.reportNum ?? ""), 10);
  const numbers = new Set([Number.isInteger(reportNum) ? reportNum : appNum]);

  const collected = [
    ...scanEvents(sources.scan),
    ...reportEvents(sources.reports),
    ...statusEvents(sources.status, appNum),
    ...assessmentEvents(sources.assessments, numbers),
    ...documentEvents(sources.documents, numbers),
    ...interviewEvents(sources.interviews, appNum),
    ...emailEvents(sources.emails, appNum, input?.selfAddresses),
    ...followupEvents(sources.followups, appNum),
    // A status log that could not be read says nothing about where it ends.
    ...(isError(sources.status) ? [] : markerEvents(input?.currentStatus, sources.status, appNum)),
  ];

  // The same fact written twice (a duplicated ledger line, a follow-up logged
  // twice) is one event.
  const seen = new Set();
  const unique = [];
  for (const e of collected) {
    const key = [e.kind, eventDay(e.date) ?? e.date, e.title, e.detail].join("\u0000");
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ ...e, day: eventDay(e.date) });
  }

  // Dated events oldest first; on one day, by KIND_ORDER, then file order
  // (Array.prototype.sort is stable). Undated events keep their place at the
  // end rather than being guessed into the timeline.
  const indexed = unique.map((e, i) => ({ e, i }));
  indexed.sort((a, b) => {
    const da = a.e.day, db = b.e.day;
    if (da && db && da !== db) return da < db ? -1 : 1;
    if (da && !db) return -1;
    if (!da && db) return 1;
    const ka = KIND_ORDER.indexOf(a.e.kind), kb = KIND_ORDER.indexOf(b.e.kind);
    return ka - kb || a.i - b.i;
  });
  const events = indexed.map((x) => x.e);
  return { events, warnings, empty: events.length === 0 };
}
