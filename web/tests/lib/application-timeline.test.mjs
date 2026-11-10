// The application timeline merges files the core already keeps. What it must
// never do is turn "this file could not be read" into "nothing happened": a
// missing source is omitted silently, a broken one is named in a warning, and
// the events the other sources produced still show.

import test from "node:test";
import assert from "node:assert/strict";
import { buildApplicationTimeline, eventDay, KIND_ORDER } from "../../src/lib/application-timeline.mjs";

const log = [
  { num: 7, date: "2026-10-28", from: "Evaluated", to: "Applied", source: "web", note: "" },
  { num: 7, date: "2026-10-28", from: "Applied", to: "Interview", source: "set-status", note: "Screen booked" },
  { num: 8, date: "2026-10-29", from: "Evaluated", to: "SKIP", source: "web", note: "" },
  { num: 7, date: "2026-11-09", from: "Interview", to: "Rejected", source: "set-status", note: "" },
];

test("events are oldest first and filtered to the row", () => {
  const t = buildApplicationTimeline({ appNum: 7, statusLog: log });
  assert.deepEqual(t.events.map((e) => [e.day, e.title]), [
    ["2026-10-28", "Evaluated → Applied"],
    ["2026-10-28", "Applied → Interview"],
    ["2026-11-09", "Interview → Rejected"],
  ]);
  assert.equal(t.empty, false);
  assert.deepEqual(t.warnings, []);
});

test("same-day events keep a stable order: scan, report, status, assessment, interview, follow-up, then file order", () => {
  const t = buildApplicationTimeline({
    appNum: 7,
    followups: [{ appNum: 7, date: "2026-10-28", channel: "Email", contact: "Ana", notes: "Thanks" }],
    statusLog: log,
    assessments: [{ reportNum: "7", date: "2026-10-28", platform: "TestGorilla", subject: "Skills", score: 80, threshold: null }],
    reports: ["007-acme-2026-10-28.md"],
    firstSeen: "2026-10-28",
  });
  const kinds = t.events.filter((e) => e.day === "2026-10-28").map((e) => e.kind);
  assert.deepEqual(kinds, ["scan", "report", "status", "status", "assessment", "followup"]);
  assert.deepEqual(KIND_ORDER, ["scan", "report", "document", "status", "assessment", "interview", "email", "followup", "marker"]);
  const statuses = t.events.filter((e) => e.kind === "status" && e.day === "2026-10-28").map((e) => e.title);
  assert.deepEqual(statuses, ["Evaluated → Applied", "Applied → Interview"]);
});

test("an exact duplicate is one event", () => {
  const dup = { num: 7, date: "2026-10-28", from: "Evaluated", to: "Applied", source: "web", note: "" };
  const t = buildApplicationTimeline({ appNum: 7, statusLog: [dup, { ...dup }] });
  assert.equal(t.events.length, 1);
});

test("a no-op status line is kept only when it carries a note", () => {
  const t = buildApplicationTimeline({
    appNum: 7,
    statusLog: [
      { num: 7, date: "2026-11-10", from: "Interview", to: "Interview", source: "set-status", note: "" },
      { num: 7, date: "2026-11-10", from: "Interview", to: "Interview", source: "set-status", note: "Recruiter says wait" },
    ],
  });
  assert.deepEqual(t.events.map((e) => [e.title, e.detail]), [["Note (Interview)", "Recruiter says wait"]]);
});

test("a missing source is omitted silently", () => {
  const t = buildApplicationTimeline({ appNum: 7, statusLog: log, followups: null, assessments: undefined, reports: null });
  assert.deepEqual(t.warnings, []);
  assert.equal(t.events.length, 3);
});

test("a malformed source is a visible warning, not an empty timeline", () => {
  const t = buildApplicationTimeline({ appNum: 7, statusLog: log, followups: { error: "EACCES: permission denied" } });
  assert.equal(t.events.length, 3, "the readable sources still show");
  assert.equal(t.warnings.length, 1);
  assert.match(t.warnings[0], /follow-up log/);
  assert.match(t.warnings[0], /EACCES/);
});

test("a row with nothing recorded is an explicit empty state", () => {
  const t = buildApplicationTimeline({ appNum: 99, statusLog: log, followups: [], reports: [] });
  assert.equal(t.empty, true);
  assert.deepEqual(t.events, []);
});

test("reports: the first is the evaluation, later ones are re-evaluations", () => {
  const t = buildApplicationTimeline({ appNum: 192, reports: ["192-netomi-2026-11-09.md", "192-netomi-2026-10-27.md"] });
  assert.deepEqual(t.events.map((e) => [e.day, e.title, e.meta]), [
    ["2026-10-27", "Evaluated", "192-netomi-2026-10-27.md"],
    ["2026-11-09", "Re-evaluated", "192-netomi-2026-11-09.md"],
  ]);
});

test("assessments match the report number; the row number is only the fallback", () => {
  const rowsFor = [
    { reportNum: "139", date: "2026-10-01", platform: "Criteria", subject: "CCAT", score: null, threshold: null },
    // Report 138 belongs to a different row: row 138's own report is 139.
    { reportNum: "138", date: "2026-10-01", platform: "Other", subject: "Another row's test", score: null, threshold: null },
  ];
  const t = buildApplicationTimeline({ appNum: 138, reportNum: 139, assessments: rowsFor });
  assert.deepEqual(t.events.map((e) => e.title), ["Criteria · CCAT"]);
  const noReport = buildApplicationTimeline({ appNum: 138, assessments: rowsFor });
  assert.deepEqual(noReport.events.map((e) => e.title), ["Other · Another row's test"]);
});

test("follow-ups show channel and contact, and only the row's own", () => {
  const t = buildApplicationTimeline({
    appNum: 195,
    followups: [
      { appNum: 195, date: "2026-11-10", channel: "LinkedIn message (inbound)", contact: "Amy", notes: "Hang tight" },
      { appNum: 93, date: "2026-10-06", channel: "phone", contact: "Anna", notes: "" },
    ],
  });
  assert.deepEqual(t.events.map((e) => [e.title, e.detail]), [["LinkedIn message (inbound) · Amy", "Hang tight"]]);
});

test("an undated event keeps its place at the end instead of being guessed into the timeline", () => {
  const t = buildApplicationTimeline({
    appNum: 7,
    statusLog: [
      { num: 7, date: "", from: "Evaluated", to: "Applied", source: "web", note: "" },
      { num: 7, date: "2026-10-28", from: "Applied", to: "Interview", source: "web", note: "" },
    ],
  });
  assert.deepEqual(t.events.map((e) => e.day), ["2026-10-28", null]);
});

test("eventDay accepts a timestamp and rejects garbage", () => {
  assert.equal(eventDay("2026-11-10T09:00:00Z"), "2026-11-10");
  assert.equal(eventDay("Nov 10"), null);
  assert.equal(eventDay(undefined), null);
});

// Interview rounds come from data/active-interviews.md. The server pairs each
// row with a tracker # through the core's matchInterviewRow; this module only
// filters by that number and shapes the event.
const round = (cells, matchedNum) => ({
  row: { Company: "Hopscotch", Role: "Sys Admin", Round: "Screen", "Date/Time": "", Interviewer: "", Status: "Completed", Notes: "", ...cells },
  matchedNum,
});

test("interview rounds: only the rows the core matcher paired with this application", () => {
  const t = buildApplicationTimeline({
    appNum: 195,
    interviews: [
      round({ "Date/Time": "2026-10-28 13:00 ET", Interviewer: "Christian", Notes: "#195 in tracker; Zoom" }, 195),
      round({ "Date/Time": "2026-11-04 10:00 ET", Round: "Technical interview", Interviewer: "Christian, Nikhil", Notes: "#195 in tracker" }, 195),
      round({ "Date/Time": "2026-11-09 09:00 ET", Interviewer: "Rick", Notes: "#200 in tracker" }, 200),
      round({ "Date/Time": "2026-11-05", Interviewer: "Unpaired" }, null),
    ],
  });
  assert.deepEqual(t.events.map((e) => [e.day, e.title, e.meta, e.detail]), [
    ["2026-10-28", "Screen · Christian", "13:00 ET · Completed", "Zoom"],
    ["2026-11-04", "Technical interview · Christian, Nikhil", "10:00 ET · Completed", ""],
  ]);
});

test("interview rounds: same day, after the status change and before the follow-up", () => {
  const t = buildApplicationTimeline({
    appNum: 7,
    statusLog: [{ num: 7, date: "2026-10-28", from: "Applied", to: "Interview", source: "web", note: "" }],
    followups: [{ appNum: 7, date: "2026-10-28", channel: "Email", contact: "Ana", notes: "Thank you" }],
    interviews: [round({ "Date/Time": "2026-10-28 13:00 ET", Notes: "#7 in tracker" }, 7)],
  });
  assert.deepEqual(t.events.map((e) => e.kind), ["status", "interview", "followup"]);
});

test("interview rounds: a missing log is omitted, an unreadable one is a warning", () => {
  const missing = buildApplicationTimeline({ appNum: 7, statusLog: log, interviews: null });
  assert.deepEqual(missing.warnings, []);
  assert.equal(missing.events.length, 3);
  const broken = buildApplicationTimeline({ appNum: 7, statusLog: log, interviews: { error: "EISDIR: illegal operation on a directory" } });
  assert.equal(broken.events.length, 3, "the readable sources still show");
  assert.equal(broken.warnings.length, 1);
  assert.match(broken.warnings[0], /interview log/);
});

test("interview rounds: a Date/Time cell without a leading date is kept, undated, at the end", () => {
  const t = buildApplicationTimeline({
    appNum: 7,
    interviews: [round({ "Date/Time": "not scheduled yet", Status: "Pending" }, 7), round({ "Date/Time": "2026-10-28" }, 7)],
  });
  assert.deepEqual(t.events.map((e) => [e.day, e.meta]), [["2026-10-28", "Completed"], [null, "not scheduled yet · Pending"]]);
});

// ── Documents (pdf-index.tsv), emails (reply-candidates.json), unlogged status ──

const manifest = [
  { reportId: "9", pdf: "output/Acme - IT/cv_x.pdf", date: "2026-10-06", kind: "cv" },
  { reportId: "9", pdf: "output/Acme - IT/coverletter_x.pdf", date: "2026-10-06", kind: "cover" },
  { reportId: "7", pdf: "output/Other/cv_x.pdf", date: "2026-10-06", kind: "cv" },
];

test("documents match the REPORT number, are labelled by kind and show the file name", () => {
  const t = buildApplicationTimeline({ appNum: 7, reportNum: 9, documents: manifest });
  assert.deepEqual(t.events.map((e) => [e.kind, e.title, e.meta]), [
    ["document", "Resume generated", "cv_x.pdf"],
    ["document", "Cover letter generated", "coverletter_x.pdf"],
  ]);
});

test("a same-day regeneration of the same kind is one event", () => {
  const t = buildApplicationTimeline({ appNum: 9, documents: [manifest[0], { ...manifest[0], pdf: "output/Acme - IT/v2/cv_x.pdf" }] });
  assert.equal(t.events.length, 1);
});

const mail = (over = {}) => ({ message_id: "m1", from: "Recruiter <ana@acme.com>", subject: "Next steps", body_snippet: "Hi", date: "2026-10-28", ...over });

test("only emails the reply matcher paired to this row appear, with direction from the candidate's own addresses", () => {
  const t = buildApplicationTimeline({
    appNum: 7,
    selfAddresses: ["me@example.com"],
    emails: [
      { candidate: mail(), matchedNum: 7 },
      { candidate: mail({ message_id: "m2", from: "me@example.com", subject: "Re: Next steps" }), matchedNum: 7 },
      { candidate: mail({ message_id: "m3", subject: "Unpaired" }), matchedNum: null },
      { candidate: mail({ message_id: "m4", subject: "Other row" }), matchedNum: 8 },
    ],
  });
  assert.deepEqual(t.events.map((e) => [e.title, e.meta]), [
    ["Next steps", "received · Recruiter <ana@acme.com>"],
    ["Re: Next steps", "sent · me@example.com"],
  ]);
});

test("without the candidate's addresses, emails carry no direction; long snippets are trimmed", () => {
  const t = buildApplicationTimeline({ appNum: 7, emails: [{ candidate: mail({ body_snippet: "x".repeat(500) }), matchedNum: 7 }] });
  assert.equal(t.events[0].meta, "Recruiter <ana@acme.com>");
  assert.ok(t.events[0].detail.length <= 220 && t.events[0].detail.endsWith("…"));
});

test("an unreadable reply-candidates or PDF manifest is a warning beside the other events", () => {
  const t = buildApplicationTimeline({ appNum: 7, statusLog: log, emails: { error: "Unexpected token" }, documents: { error: "EACCES" } });
  assert.equal(t.warnings.length, 2);
  assert.ok(t.warnings.some((w) => w.includes("data/reply-candidates.json")));
  assert.ok(t.warnings.some((w) => w.includes("data/pdf-index.tsv")));
  assert.equal(t.empty, false);
});

test("a current status the ledger never reached adds a final undated marker", () => {
  const t = buildApplicationTimeline({ appNum: 7, statusLog: log.slice(0, 1), currentStatus: "Interview" });
  const last = t.events.at(-1);
  assert.equal(last.kind, "marker");
  assert.equal(last.day, null);
  assert.equal(last.title, "Current status: Interview");
});

test("no marker when the ledger ends at the current status, for a never-moved Evaluated row, or when the log is unreadable", () => {
  assert.ok(!buildApplicationTimeline({ appNum: 7, statusLog: log, currentStatus: "rejected" }).events.some((e) => e.kind === "marker"));
  assert.ok(!buildApplicationTimeline({ appNum: 9, statusLog: log, currentStatus: "Evaluated" }).events.some((e) => e.kind === "marker"));
  assert.ok(!buildApplicationTimeline({ appNum: 7, statusLog: { error: "EACCES" }, currentStatus: "Interview" }).events.some((e) => e.kind === "marker"));
  // A row with no ledger lines that has moved past Evaluated is a gap.
  assert.ok(buildApplicationTimeline({ appNum: 9, statusLog: log, currentStatus: "Applied" }).events.some((e) => e.kind === "marker"));
});

test("same-day order places documents after reports and emails before follow-ups", () => {
  const t = buildApplicationTimeline({
    appNum: 9,
    reports: ["009-acme-2026-10-06.md"],
    documents: manifest,
    followups: [{ appNum: 9, date: "2026-10-06", channel: "Email", contact: "Ana", notes: "" }],
    emails: [{ candidate: mail({ date: "2026-10-06" }), matchedNum: 9 }],
  });
  assert.deepEqual(t.events.map((e) => e.kind), ["report", "document", "document", "email", "followup"]);
});
