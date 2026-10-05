import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { reportPostingUrls, reportScore, buildReportUrlIndex, isDecidedStatus } from "../../src/lib/report-urls.mjs";

const AGG = "https://builtin.com/job/infrastructure-cloud-systems-engineer/11408117";
const EMP = "https://careers.gocourser.com/apply/BxEmwGJ9Y9/Infrastructure-Cloud-Systems-Engineer";

const REPORT = [
  "# Evaluation: Courser — Infrastructure & Cloud Systems Engineer",
  "",
  `**URL:** ${EMP}`,
  "**Previous URL:** https://old.example/job/1 (replaced 2026-10-05)",
  "**Score:** 4.1/5",
  "",
  `Source listing: Built In (${AGG}), posted as "Palmetto Technology Group, Inc."`,
  "",
  "## A) Role",
  "Body text linking https://unrelated.example/x must not count.",
].join("\n");

test("claims URL, Previous URL and Source listing header URLs only", () => {
  const urls = reportPostingUrls(REPORT);
  assert.deepEqual([...urls].sort(), [AGG, EMP, "https://old.example/job/1"].sort());
});

test("bold Source listing form is recognised; trailing punctuation stripped", () => {
  const urls = reportPostingUrls(`**Source listing:** ${AGG}.`);
  assert.deepEqual([...urls], [AGG]);
});

test("block-quoted '> Source:' form is recognised", () => {
  const urls = reportPostingUrls(`> Source: found on Built In (${AGG}, an aggregator). Confirmed at the employer.`);
  assert.deepEqual([...urls], [AGG]);
});

test("non-http and junk are ignored", () => {
  assert.equal(reportPostingUrls("**URL:** javascript:alert(1)").size, 0);
  assert.equal(reportPostingUrls(null).size, 0);
});

test("reportScore reads the header score", () => {
  assert.equal(reportScore(REPORT), 4.1);
  assert.equal(reportScore("**Score:** N/A"), null);
});

test("index maps every claimed URL; newer report wins; sentinels skipped", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "report-urls-"));
  fs.writeFileSync(path.join(dir, "105-old-2026-10-01.md"), `**URL:** ${AGG}\n**Score:** 3.0/5\n`);
  fs.writeFileSync(path.join(dir, "134-courser-2026-10-05.md"), REPORT);
  fs.writeFileSync(path.join(dir, "135-RESERVED.md"), `**URL:** ${AGG}\n**Score:** 1.0/5\n`);
  const idx = buildReportUrlIndex(dir);
  assert.deepEqual(idx.get(AGG), { n: "134", score: 4.1 });
  assert.deepEqual(idx.get(EMP), { n: "134", score: 4.1 });
  assert.equal(buildReportUrlIndex(path.join(dir, "missing")).size, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("isDecidedStatus: everything past Evaluated is decided; unknown is not", () => {
  for (const st of ["SKIP", "Discarded", "Rejected", "Applied", "Responded", "Interview", "Offer", "Hired", "**SKIP**"]) assert.equal(isDecidedStatus(st), true, st);
  for (const st of ["Evaluated", "", undefined, "something new"]) assert.equal(isDecidedStatus(st), false, String(st));
});
