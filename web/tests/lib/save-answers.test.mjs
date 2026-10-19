// Tests for saveApplicationAnswers(): apply answers are kept in the job folder.
// Run:  node --test tests/lib/save-answers.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { saveApplicationAnswers, ANSWERS_MARKER, ANSWERS_FILE, ANSWERS_FALLBACK_FILE } from "../../src/lib/apply/save-answers.mjs";

function jobFolder() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "save-answers-"));
  const dir = path.join(root, "output", "Acme - IT Manager");
  fs.mkdirSync(dir, { recursive: true });
  return { root, dir, cvPath: path.join(dir, "cv_matt_taylor.pdf") };
}
const fields = [
  { id: "co0", label: "First Name", required: true },
  { id: "co1", label: "Why  Acme?" },
  { id: "co2", label: "" },
];

test("pre-fill answers land in the job folder, with flags and blanks shown", () => {
  const { root, dir, cvPath } = jobFolder();
  const r = saveApplicationAnswers({ root, cvPath, title: "Acme - IT Manager", url: "https://x/1", stage: "prefill", date: "2026-10-18", fields,
    answers: { co0: { value: "Matt", needs_confirmation: false }, co1: { value: "Mission.", needs_confirmation: true } } });
  assert.equal(r.path, path.join("output", "Acme - IT Manager", ANSWERS_FILE));
  const md = fs.readFileSync(path.join(dir, ANSWERS_FILE), "utf8");
  assert.ok(md.startsWith(ANSWERS_MARKER));
  assert.match(md, /## 1\. First Name\n\n\(required\)\n\nMatt/);
  assert.match(md, /## 2\. Why Acme\?\n\n\(needs your confirmation\)\n\nMission\./);
  assert.match(md, /## 3\. co2\n\n_\(blank\)_/);
  assert.match(md, /AI pre-fill draft from 2026-10-18/);
});

test("fill rewrites the flow's own file with the reviewed answers", () => {
  const { root, dir, cvPath } = jobFolder();
  saveApplicationAnswers({ root, cvPath, stage: "prefill", fields, answers: { co0: { value: "Mat" } } });
  saveApplicationAnswers({ root, cvPath, stage: "filled", date: "2026-10-19", fields, answers: { co0: "Matt" } });
  const md = fs.readFileSync(path.join(dir, ANSWERS_FILE), "utf8");
  assert.match(md, /Filled into the form on 2026-10-19/);
  assert.match(md, /\n\nMatt\n/);
});

test("a hand-written answers file is never overwritten", () => {
  const { root, dir, cvPath } = jobFolder();
  fs.writeFileSync(path.join(dir, ANSWERS_FILE), "# My own answers\n");
  const r = saveApplicationAnswers({ root, cvPath, stage: "prefill", fields, answers: { co0: "Matt" } });
  assert.equal(path.basename(r.path), ANSWERS_FALLBACK_FILE);
  assert.equal(fs.readFileSync(path.join(dir, ANSWERS_FILE), "utf8"), "# My own answers\n");
});

test("skips with a reason when there is no job folder", () => {
  const { root } = jobFolder();
  assert.ok("skipped" in saveApplicationAnswers({ root, cvPath: null, stage: "prefill", fields, answers: {} }));
  assert.ok("skipped" in saveApplicationAnswers({ root, cvPath: path.join(root, "output", "cv-flat.pdf"), stage: "prefill", fields, answers: {} }));
});
