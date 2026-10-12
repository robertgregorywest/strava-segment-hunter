#!/usr/bin/env bash
# Installs (or removes) a per-user launchd agent that runs `npm run sync:backfill`
# once a day at 01:10 local time — after Strava's daily read quota resets at
# midnight UTC in both GMT and BST. launchd, not cron: if the laptop is asleep
# at 01:10, launchd runs the missed job on wake instead of skipping the day.
# Each run stops by itself once the daily quota is spent, and progress is
# committed as it goes, so a run cut short by sleep or shutdown loses nothing.
#
# Usage:
#   ./scripts/schedule-sync.sh             # install (or reinstall after a Node upgrade)
#   ./scripts/schedule-sync.sh uninstall   # remove
#   tail -f logs/sync.log                  # watch runs
set -euo pipefail
cd "$(dirname "$0")/.."

label="com.strava-segment-hunter.sync"
plist="$HOME/Library/LaunchAgents/${label}.plist"
domain="gui/$(id -u)"

launchctl bootout "$domain/$label" 2>/dev/null || true
rm -f "$plist"

if [[ "${1:-}" == "uninstall" ]]; then
  echo "Removed $label."
  exit 0
fi

repo="$(pwd)"
# The resolved binary, not a version-manager shim: launchd runs with a bare PATH.
node_bin="$(dirname "$(node -p 'require("fs").realpathSync(process.execPath)')")"
mkdir -p logs "$(dirname "$plist")"

cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>WorkingDirectory</key><string>${repo}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${node_bin}/npm</string>
    <string>run</string>
    <string>--silent</string>
    <string>sync:backfill</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${node_bin}:/usr/bin:/bin</string>
  </dict>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>1</integer>
    <key>Minute</key><integer>10</integer>
  </dict>
  <key>StandardOutPath</key><string>${repo}/logs/sync.log</string>
  <key>StandardErrorPath</key><string>${repo}/logs/sync.log</string>
</dict>
</plist>
EOF

launchctl bootstrap "$domain" "$plist"
echo "Installed $label: daily at 01:10, logging to logs/sync.log."
echo "Run it now with: launchctl kickstart $domain/$label"
