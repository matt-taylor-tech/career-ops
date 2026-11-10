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

/** Same-day order: discovered, evaluated, moved through the tracker, tested, followed up. */
export const KIND_ORDER = ["scan", "report", "status", "assessment", "followup"];

export const KIND_LABELS = {
  scan: "Scan",
  report: "Report",
  status: "Status",
  assessment: "Assessment",
  followup: "Follow-up",
};

const SOURCE_NAMES = {
  status: "status log (data/status-log.tsv)",
  followups: "follow-up log (data/follow-ups.md)",
  assessments: "assessment log (data/assessments.tsv)",
  reports: "reports folder (reports/)",
  scan: "scan history (data/scan-history.tsv)",
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The calendar day an event happened on, or null when the cell is not one. */
export function eventDay(raw) {
  const s = String(raw ?? "").trim();
  const day = s.slice(0, 10);
  return ISO_DAY.test(day) ? day : null;
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
 * @param {Array|{error:string}|null} [input.reports]     report file names for the row
 * @param {string|{error:string}|null} [input.firstSeen]  YYYY-MM-DD
 * @returns {{events: Array<{kind:string,date:string,day:string|null,title:string,detail:string,meta:string}>, warnings: string[], empty: boolean}}
 */
export function buildApplicationTimeline(input) {
  const appNum = Number.parseInt(String(input?.appNum ?? ""), 10);
  const warnings = [];
  const sources = {
    status: input?.statusLog,
    followups: input?.followups,
    assessments: input?.assessments,
    reports: input?.reports,
    scan: input?.firstSeen,
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
    ...followupEvents(sources.followups, appNum),
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
