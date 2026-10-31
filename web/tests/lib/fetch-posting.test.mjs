import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { fetchPostingText, MAX_POSTING_CHARS } from "../../src/lib/fetch-posting.mjs";

const run = (stdout, err = null) => {
  const calls = [];
  const execFileFn = (file, args, opts, cb) => {
    calls.push({ file, args, opts });
    cb(err, stdout, "");
  };
  return { execFileFn, calls };
};

test("fetchPostingText runs fetch-jd.mjs from the checkout with the data root as cwd", async () => {
  const { execFileFn, calls } = run("  Senior IT Engineer\n\nDo things.\n");
  const text = await fetchPostingText({ execFileFn, execPath: "node", coreRoot: "/code", cwd: "/data", url: "https://jobs.ashbyhq.com/a/1" });
  assert.equal(text, "Senior IT Engineer\n\nDo things.");
  assert.deepEqual(calls[0].args, [join("/code", "fetch-jd.mjs"), "https://jobs.ashbyhq.com/a/1"]);
  assert.equal(calls[0].opts.cwd, "/data");
});

test("fetchPostingText resolves null on failure, empty output, or a non-URL input", async () => {
  assert.equal(await fetchPostingText({ ...run("", new Error("exit 1")), execPath: "node", coreRoot: "/c", cwd: "/d", url: "https://x.example/1" }), null);
  assert.equal(await fetchPostingText({ ...run("   \n"), execPath: "node", coreRoot: "/c", cwd: "/d", url: "https://x.example/1" }), null);
  const { execFileFn, calls } = run("text");
  assert.equal(await fetchPostingText({ execFileFn, execPath: "node", coreRoot: "/c", cwd: "/d", url: "Acme, Staff Engineer" }), null);
  assert.equal(calls.length, 0);
});

test("fetchPostingText caps very long output", async () => {
  const text = await fetchPostingText({ ...run("x".repeat(MAX_POSTING_CHARS + 50)), execPath: "node", coreRoot: "/c", cwd: "/d", url: "https://x.example/1" });
  assert.equal(text.length, MAX_POSTING_CHARS);
});
