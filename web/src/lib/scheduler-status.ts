import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { careerOpsRoot } from "@/lib/career-ops";
import { resolveCodeRoot } from "@/lib/core/code-root.mjs";
import { readLockStatus } from "./scheduled-jobs-store.mjs";
import { scheduledRunnerResourcePath, scheduledStorePath } from "./scheduled-runner-path.mjs";

const execFileAsync = promisify(execFile);
const TASK_NAME = "career-ops recurring scan";

export type SchedulerStatus = {
  platform: NodeJS.Platform;
  available: boolean;
  running: boolean;
  task: {
    exists: boolean;
    enabled: boolean;
    status: string | null;
    nextRun: string | null;
    lastRun: string | null;
  };
};

// macOS: the launchd agent from web/scripts/install-scan-schedule.sh. launchd
// keeps no next/last-run times, so the last run is the agent log's mtime (the
// runner writes to it every interval) and the next is that plus the interval.
const LAUNCHD_LABEL = "com.career-ops.recurring-scan";
// Fallback only; the real interval is read from the installed plist.
const LAUNCHD_DEFAULT_INTERVAL_MS = 60 * 60 * 1_000;

function launchdIntervalMs(): number {
  try {
    const plist = fs.readFileSync(path.join(process.env.HOME ?? "", "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`), "utf8");
    const secs = Number(plist.match(/<key>StartInterval<\/key>\s*<integer>(\d+)<\/integer>/)?.[1]);
    return Number.isFinite(secs) && secs > 0 ? secs * 1_000 : LAUNCHD_DEFAULT_INTERVAL_MS;
  } catch {
    return LAUNCHD_DEFAULT_INTERVAL_MS;
  }
}

async function readLaunchdTask(): Promise<SchedulerStatus["task"]> {
  const none = { exists: false, enabled: false, status: null, nextRun: null, lastRun: null };
  const uid = process.getuid?.();
  if (uid === undefined) return none;
  const domain = `gui/${uid}`;
  try {
    await execFileAsync("launchctl", ["print", `${domain}/${LAUNCHD_LABEL}`], { timeout: 5_000, maxBuffer: 256 * 1024 });
  } catch {
    return none;
  }
  let enabled = true;
  try {
    const { stdout } = await execFileAsync("launchctl", ["print-disabled", domain], { timeout: 5_000, maxBuffer: 256 * 1024 });
    if (new RegExp(`"${LAUNCHD_LABEL.replace(/\./g, "\\.")}"\\s*=>\\s*(true|disabled)`).test(stdout)) enabled = false;
  } catch {
    /* unknown: keep enabled */
  }
  let lastRun: string | null = null;
  let nextRun: string | null = null;
  try {
    const mtime = fs.statSync(path.join(process.env.HOME ?? "", "Library", "Logs", "career-ops-scan.log")).mtime;
    lastRun = mtime.toISOString();
    if (enabled) nextRun = new Date(mtime.getTime() + launchdIntervalMs()).toISOString();
  } catch {
    /* no run logged yet */
  }
  return { exists: true, enabled, status: enabled ? "Loaded" : "Disabled", nextRun, lastRun };
}

async function readTask(): Promise<SchedulerStatus["task"]> {
  if (process.platform === "darwin") return readLaunchdTask();
  if (process.platform !== "win32") {
    return { exists: false, enabled: false, status: null, nextRun: null, lastRun: null };
  }

  const script = [
    `$task = Get-ScheduledTask -TaskName '${TASK_NAME}' -ErrorAction SilentlyContinue`,
    "if (-not $task) { Write-Output '{\"exists\":false}'; exit 0 }",
    `$info = Get-ScheduledTaskInfo -TaskName '${TASK_NAME}'`,
    "$result = [PSCustomObject]@{",
    "  exists = $true",
    "  enabled = ($task.State -ne 'Disabled')",
    "  status = [string]$task.State",
    "  nextRun = if ($info.NextRunTime -gt [DateTime]::MinValue) { $info.NextRunTime.ToString('o') } else { $null }",
    "  lastRun = if ($info.LastRunTime -gt [DateTime]::MinValue) { $info.LastRunTime.ToString('o') } else { $null }",
    "}",
    "$result | ConvertTo-Json -Compress",
  ].join("; ");

  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true, timeout: 5_000, maxBuffer: 128 * 1024 },
    );
    const parsed = JSON.parse(stdout.trim()) as Partial<SchedulerStatus["task"]>;
    return {
      exists: parsed.exists === true,
      enabled: parsed.enabled === true,
      status: typeof parsed.status === "string" ? parsed.status : null,
      nextRun: typeof parsed.nextRun === "string" ? parsed.nextRun : null,
      lastRun: typeof parsed.lastRun === "string" ? parsed.lastRun : null,
    };
  } catch {
    return { exists: false, enabled: false, status: null, nextRun: null, lastRun: null };
  }
}

export async function schedulerStatus(): Promise<SchedulerStatus> {
  const root = careerOpsRoot();
  const runner = path.join(resolveCodeRoot(process.cwd(), process.env), "web", "scripts", "scheduled-jobs-runner.mjs");
  const runnerLock = scheduledRunnerResourcePath(scheduledStorePath(root));
  const lock = readLockStatus(runnerLock, { staleMs: 25 * 60 * 1_000 * 3 + 60_000 });
  return {
    platform: process.platform,
    available: fs.existsSync(runner),
    running: lock.active && !lock.stale,
    task: await readTask(),
  };
}
