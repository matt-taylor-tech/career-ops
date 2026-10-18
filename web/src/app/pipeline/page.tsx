import { Suspense } from "react";
import { pipelineSummary } from "@/lib/career-ops";
import { pendingInbox } from "@/lib/inbox-pending.mjs";
import { PipelineView } from "@/components/pipeline-view";
import { pipelineTab } from "@/lib/pipeline-navigation.mjs";
import { workLocationFilter } from "@/lib/work-location.mjs";

export const dynamic = "force-dynamic"; // always read fresh local files

// Tracker tabs show the inbox only as a count, so they get the count and not
// the postings. The inbox is most of the page payload on a large pipeline.
export default async function PipelinePage({ searchParams }: { searchParams: Promise<{ tab?: string | string[]; where?: string | string[] }> }) {
  const { tab, where } = await searchParams;
  const onInbox = pipelineTab(tab) === "INBOX";
  const { inbox, applications } = pipelineSummary();
  const pending = pendingInbox(inbox);
  const loc = workLocationFilter(Array.isArray(where) ? where[0] : where);
  const inboxCount = loc === "all" ? pending.length : pending.filter((j) => j.workLocation === loc).length;
  return (
    <Suspense>
      <PipelineView applications={applications} inbox={onInbox ? pending : null} inboxCount={inboxCount} />
    </Suspense>
  );
}
