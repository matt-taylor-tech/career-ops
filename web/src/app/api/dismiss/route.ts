import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot, rootScript } from "@/lib/career-ops";
import { localISODate } from "@/lib/followups";
import { dismissPosting } from "@/lib/dismissed.mjs";
import { setInboxSkip } from "@/lib/inbox-skip.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Hide a posting from Today / Explore ("not interested"). Records it in
// data/dismissed-postings.tsv and, when the posting is also an inbox row,
// marks that pipeline.md row skipped so the inbox agrees.
export async function POST(req: Request) {
  let body: { url?: unknown; company?: unknown; title?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const url = typeof body.url === "string" ? body.url : "";
  const root = careerOpsRoot();
  try {
    const result = dismissPosting(
      root,
      { url, company: typeof body.company === "string" ? body.company : "", title: typeof body.title === "string" ? body.title : "" },
      localISODate(),
    );
    if (!result.ok) return NextResponse.json({ error: "url must be an http(s) posting URL", code: result.error }, { status: 400 });

    let inbox = "not-in-inbox";
    // The lock module is engine code: under the Custom Data Directory layout it
    // lives in the checkout, never beside data/pipeline.md.
    const lockModule = rootScript("pipeline-lock");
    const skip = await setInboxSkip(path.join(root, "data", "pipeline.md"), url, true, {
      lockModule: fs.existsSync(lockModule) ? lockModule : undefined,
    });
    if (skip.ok) inbox = "skipped";
    else if (skip.error === "busy") inbox = "busy";
    return NextResponse.json({ ok: true, added: result.added, inbox });
  } catch {
    return NextResponse.json({ error: "write failed" }, { status: 500 });
  }
}
