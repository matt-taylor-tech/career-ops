#!/usr/bin/env bash
# macOS counterpart of install-scan-schedule.ps1: registers a per-user launchd
# agent that runs the scheduled-jobs queue worker (default every 60 minutes). The worker
# only calls the zero-token scanner, so no Claude login is needed. Runs while
# the user is logged in; launchd catches up after sleep.
set -euo pipefail

if [[ "$(uname)" != "Darwin" ]]; then
  echo "This installer is for macOS. On Windows use install-scan-schedule.ps1." >&2
  exit 1
fi

LABEL="com.career-ops.recurring-scan"
# How often launchd wakes the queue worker to check for due scans (each check is
# a quick local read; a scan only runs when a saved job is due). Override with
# --every-minutes N. The interval bounds how late a due scan can start.
EVERY_MINUTES=60
if [[ "${1:-}" == "--every-minutes" && -n "${2:-}" ]]; then EVERY_MINUTES="$2"; fi
[[ "$EVERY_MINUTES" =~ ^[0-9]+$ && "$EVERY_MINUTES" -ge 5 ]] || { echo "--every-minutes must be a whole number >= 5" >&2; exit 1; }
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
RUNNER="$SCRIPT_DIR/scheduled-jobs-runner.mjs"
NODE="$(command -v node || true)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/career-ops-scan.log"

[[ -f "$RUNNER" ]] || { echo "Scheduled job runner not found: $RUNNER" >&2; exit 1; }
[[ -n "$NODE" ]] || { echo "node not found on PATH" >&2; exit 1; }

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$RUNNER</string>
  </array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$(dirname "$NODE"):/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StartInterval</key><integer>$((EVERY_MINUTES * 60))</integer>
  <key>RunAtLoad</key><false/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF

DOMAIN="gui/$(id -u)"
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$PLIST"
launchctl enable "$DOMAIN/$LABEL"
echo "Installed $LABEL: checks for due scans every $EVERY_MINUTES minutes while you are logged in. Log: $LOG"
