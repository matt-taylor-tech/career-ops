import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot, rootScript, findReportFile } from "@/lib/career-ops";
import { localISODate } from "@/lib/followups";
import { replaceInboxLink, replaceReportLink } from "@/lib/replace-link.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Replace a posting link with the employer's own URL. Plain text edit, no LLM:
//   { target: "inbox",  url, newUrl }    → data/pipeline.md row
//   { target: "report", report, newUrl } → reports/{n}-*.md **URL:** header

const ERROR_HTTP: Record<string, number> = {
  "invalid-url": 400,
  "same-url": 400,
  "duplicate": 409,
  "unmatched": 404,
  "not-found": 404,
  "no-url-header": 422,
  "busy": 409,
};

const ERROR_MSG: Record<string, string> = {
  "invalid-url": "The new link must be a full http(s) URL.",
  "same-url": "That is already the link.",
  "duplicate": "That link is already in the inbox.",
  "unmatched": "No inbox row has that link anymore. Refresh and try again.",
  "not-found": "File not found.",
  "no-url-header": "This report has no **URL:** line to replace.",
  "busy": "The pipeline is being written right now (CLI or another tab). Try again.",
};

function fail(code: string) {
  return NextResponse.json(
    { error: ERROR_MSG[code] ?? "replace failed", code },
    { status: ERROR_HTTP[code] ?? 400 },
  );
}

export async function POST(req: Request) {
  let body: { target?: unknown; url?: unknown; report?: unknown; newUrl?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const newUrl = typeof body.newUrl === "string" ? body.newUrl : "";
  const root = careerOpsRoot();

  try {
    if (body.target === "inbox") {
      const url = typeof body.url === "string" ? body.url : "";
      // The lock module is engine code: under the Custom Data Directory layout it
      // lives in the checkout, never beside data/pipeline.md.
      const lockModule = rootScript("pipeline-lock");
      const result = await replaceInboxLink(path.join(root, "data", "pipeline.md"), url, newUrl, {
        lockModule: fs.existsSync(lockModule) ? lockModule : undefined,
      });
      return result.ok ? NextResponse.json({ ok: true, changed: result.changed }) : fail(result.error);
    }

    if (body.target === "report") {
      const n = typeof body.report === "string" ? body.report : "";
      if (!/^\d{1,4}$/.test(n)) return NextResponse.json({ error: "report must be a report number" }, { status: 400 });
      const file = findReportFile(n);
      if (!file) return fail("not-found");
      const result = replaceReportLink(file, newUrl, localISODate());
      if ("previous" in result) return NextResponse.json({ ok: true, previous: result.previous });
      return fail("error" in result ? result.error : "write failed");
    }
  } catch {
    return NextResponse.json({ error: "write failed" }, { status: 500 });
  }

  return NextResponse.json({ error: "target must be 'inbox' or 'report'" }, { status: 400 });
}
