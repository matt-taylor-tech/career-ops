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

test("same-day events keep a stable order: scan, report, status, assessment, follow-up, then file order", () => {
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
  assert.deepEqual(KIND_ORDER, ["scan", "report", "status", "assessment", "followup"]);
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
