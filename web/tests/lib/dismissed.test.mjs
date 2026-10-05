import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DISMISSED_FILE, dismissPosting, parseDismissed, readDismissed } from "../../src/lib/dismissed.mjs";

const URL = "https://job-boards.greenhouse.io/humaninterest/jobs/8234533";

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dismissed-"));
}

test("dismiss writes a header once and is idempotent", () => {
  const root = tmpRoot();
  assert.deepEqual(dismissPosting(root, { url: URL, company: "Human Interest", title: "AE" }, "2026-10-05"), { ok: true, added: true });
  assert.deepEqual(dismissPosting(root, { url: URL, company: "Human Interest", title: "AE" }, "2026-10-05"), { ok: true, added: false });
  const text = fs.readFileSync(path.join(root, DISMISSED_FILE), "utf8");
  assert.equal(text, `url\tdate\tcompany\ttitle\n${URL}\t2026-10-05\tHuman Interest\tAE\n`);
  assert.deepEqual([...readDismissed(root)], [URL]);
  fs.rmSync(root, { recursive: true, force: true });
});

test("free-text cells cannot forge extra rows or columns", () => {
  const root = tmpRoot();
  dismissPosting(root, { url: URL, company: "Evil\tCo", title: "AE\nhttps://other.example/x\tzz" }, "2026-10-05");
  const lines = fs.readFileSync(path.join(root, DISMISSED_FILE), "utf8").trim().split("\n");
  assert.equal(lines.length, 2);
  assert.equal(lines[1].split("\t").length, 4);
  assert.deepEqual([...readDismissed(root)], [URL]);
  fs.rmSync(root, { recursive: true, force: true });
});

test("invalid URLs are refused; header and junk lines are ignored when reading", () => {
  const root = tmpRoot();
  assert.deepEqual(dismissPosting(root, { url: "javascript:alert(1)" }, "2026-10-05"), { ok: false, error: "invalid-url" });
  assert.equal(fs.existsSync(path.join(root, DISMISSED_FILE)), false);
  assert.deepEqual([...parseDismissed("url\tdate\n../../etc/passwd\nnot a url\n" + URL + "\t2026-10-05\n")], [URL]);
  assert.equal(readDismissed(path.join(root, "missing")).size, 0);
  fs.rmSync(root, { recursive: true, force: true });
});
