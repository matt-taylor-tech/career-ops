#!/usr/bin/env bash
# Removes the launchd agent installed by install-scan-schedule.sh.
set -euo pipefail

LABEL="com.career-ops.recurring-scan"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$PLIST"
echo "Removed $LABEL. Saved scans now run only with Run now."
