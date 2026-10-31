import fs from "node:fs";
import { ExplorerView } from "@/components/explore/explorer-view";
import { seedExploreFilters } from "@/lib/core/portals";
import { readInbox, readApplications, careerOpsRoot } from "@/lib/career-ops";
import { readDismissed } from "@/lib/dismissed.mjs";
import { exploreSnapshot } from "@/lib/explore-snapshot.mjs";
import { DEFAULT_FILTERS } from "@/lib/explore";

// Read live data at request time so a bare checkout (or `next build` with no
// CAREER_OPS_ROOT) never fails — discovery seeds are best-effort.
export const dynamic = "force-dynamic";

export default function ExplorePage() {
  let seed: { filters: typeof DEFAULT_FILTERS; seededFrom: string[] } = { filters: DEFAULT_FILTERS, seededFrom: [] };
  try {
    seed = seedExploreFilters();
  } catch {
    /* bare checkout → defaults */
  }
  let rootExists = false;
  try {
    rootExists = fs.existsSync(careerOpsRoot());
  } catch {
    /* ignore */
  }
  const applications = readApplications();
  const inbox = readInbox(applications);
  const snap = exploreSnapshot(inbox, applications);
  // Postings skipped in the inbox (`- [x]` in pipeline.md) or hidden from Today /
  // Explore are a "not interested" decision: keep them out of Explore results.
  const skippedUrls = [...inbox.filter((j) => j.done).map((j) => j.url), ...readDismissed(careerOpsRoot())];
  return (
    <ExplorerView seed={seed} inboxUrls={snap.inboxUrls} evaluated={snap.evaluated} skippedUrls={skippedUrls} rootExists={rootExists} />
  );
}
