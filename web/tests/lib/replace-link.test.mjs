import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  applyInboxReplace,
  applyReportReplace,
  replaceInboxLink,
  replaceReportLink,
} from "../../src/lib/replace-link.mjs";

const OLD = "https://builtin.com/job/systems-administrator/11484905";
const NEW = "https://boards.greenhouse.io/huge/jobs/123";
const PIPE = [
  "# Pipeline",
  "",
  `- [ ] ${OLD} | Huge | Systems Administrator | Remote · United States | posted: 2026-10-02`,
  "- [ ] https://builtin.com/job/other/1 | Other | Role",
  "",
].join("\n");

test("inbox: swaps only the job-URL cell, other cells byte-identical", () => {
  const r = applyInboxReplace(PIPE, OLD, NEW);
  assert.equal(r.ok, true);
  assert.equal(r.changed, 1);
  assert.ok(r.text.includes(`- [ ] ${NEW} | Huge | Systems Administrator | Remote · United States | posted: 2026-10-02`));
  assert.ok(r.text.includes("- [ ] https://builtin.com/job/other/1 | Other | Role"));
  assert.ok(!r.text.includes(OLD));
});

test("inbox: preserves CRLF and the trailing newline", () => {
  const crlf = PIPE.replace(/\n/g, "\r\n");
  const r = applyInboxReplace(crlf, OLD, NEW);
  assert.equal(r.ok, true);
  assert.ok(r.text.endsWith("\r\n"));
  assert.ok(!/[^\r]\n/.test(r.text));
});

test("inbox: refuses invalid, identical, duplicate and unmatched URLs", () => {
  assert.deepEqual(applyInboxReplace(PIPE, OLD, "javascript:alert(1)"), { ok: false, error: "invalid-url" });
  assert.deepEqual(applyInboxReplace(PIPE, OLD, "file:///etc/passwd"), { ok: false, error: "invalid-url" });
  assert.deepEqual(applyInboxReplace(PIPE, OLD, `${NEW}\n- [ ] x`), { ok: false, error: "invalid-url" });
  assert.deepEqual(applyInboxReplace(PIPE, OLD, OLD), { ok: false, error: "same-url" });
  assert.deepEqual(applyInboxReplace(PIPE, OLD, "https://builtin.com/job/other/1"), { ok: false, error: "duplicate" });
  assert.deepEqual(applyInboxReplace(PIPE, "https://nope.example/1", NEW), { ok: false, error: "unmatched" });
});

test("inbox: a URL appearing only in a later cell is not a match", () => {
  const md = `- [ ] https://a.example/1 | Co | Role | note ${OLD}\n`;
  assert.deepEqual(applyInboxReplace(md, OLD, NEW), { ok: false, error: "unmatched" });
});

const REPORT = [
  "# Evaluation: Co — Role",
  "",
  "**Date:** 2026-10-05",
  `**URL:** ${OLD}`,
  "**Score:** 4.1/5",
  "",
  "body mentions **URL:** in prose? no, only header lines start with it",
  "",
].join("\n");

test("report: replaces the URL header and keeps the old value below it", () => {
  const r = applyReportReplace(REPORT, NEW, "2026-10-05");
  assert.equal(r.ok, true);
  assert.equal(r.previous, OLD);
  const lines = r.text.split("\n");
  const i = lines.indexOf(`**URL:** ${NEW}`);
  assert.ok(i > 0);
  assert.equal(lines[i + 1], `**Previous URL:** ${OLD} (replaced 2026-10-05)`);
  assert.equal(lines[i + 2], "**Score:** 4.1/5");
});

test("report: refuses invalid/same URL and a missing header", () => {
  assert.deepEqual(applyReportReplace(REPORT, "ftp://x/y", "2026-10-05"), { ok: false, error: "invalid-url" });
  assert.deepEqual(applyReportReplace(REPORT, OLD, "2026-10-05"), { ok: false, error: "same-url" });
  assert.deepEqual(applyReportReplace("# no header\n", NEW, "2026-10-05"), { ok: false, error: "no-url-header" });
});

test("file writers: write atomically and leave no temp files", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "replace-link-"));
  const pipe = path.join(dir, "pipeline.md");
  const rep = path.join(dir, "134-co-2026-10-05.md");
  fs.writeFileSync(pipe, PIPE);
  fs.writeFileSync(rep, REPORT);

  const a = await replaceInboxLink(pipe, OLD, NEW);
  assert.equal(a.ok, true);
  assert.ok(fs.readFileSync(pipe, "utf8").includes(NEW));

  const b = replaceReportLink(rep, NEW, "2026-10-05");
  assert.equal(b.ok, true);
  assert.ok(fs.readFileSync(rep, "utf8").includes(`**URL:** ${NEW}`));

  assert.deepEqual(fs.readdirSync(dir).sort(), ["134-co-2026-10-05.md", "pipeline.md"]);
  assert.deepEqual(await replaceInboxLink(path.join(dir, "missing.md"), OLD, NEW), { ok: false, error: "not-found" });
  fs.rmSync(dir, { recursive: true, force: true });
});
