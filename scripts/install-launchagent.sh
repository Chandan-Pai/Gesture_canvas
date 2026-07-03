#!/usr/bin/env bash
# Install a macOS LaunchAgent to sync DEVLOG.md → Notion every night.
# Usage: bash scripts/install-launchagent.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.gesturecanvas.devlog-sync"
PLIST_DEST="$HOME/Library/LaunchAgents/${LABEL}.plist"
NODE_BIN="$(command -v node || true)"
SYNC_HOUR="${SYNC_HOUR:-23}"

if [[ -z "$NODE_BIN" ]]; then
  echo "error: node not found in PATH. Install Node.js first."
  exit 1
fi

if [[ ! -f "$ROOT/.env" ]]; then
  echo "error: $ROOT/.env not found."
  echo "  cp .env.example .env"
  echo "  Fill NOTION_TOKEN and NOTION_PAGE_ID, then re-run this script."
  exit 1
fi

mkdir -p "$ROOT/logs"

cat > "$PLIST_DEST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>${ROOT}/scripts/sync-devlog-to-notion.mjs</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${ROOT}</string>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>${SYNC_HOUR}</integer>
    <key>Minute</key>
    <integer>0</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>${ROOT}/logs/devlog-sync.log</string>
  <key>StandardErrorPath</key>
  <string>${ROOT}/logs/devlog-sync.err.log</string>
</dict>
</plist>
EOF

UID_NUM="$(id -u)"
DOMAIN="gui/${UID_NUM}"

# Reload if already installed
launchctl bootout "${DOMAIN}/${LABEL}" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$PLIST_DEST"
launchctl enable "${DOMAIN}/${LABEL}" 2>/dev/null || true

echo ""
echo "  Nightly DEVLOG → Notion sync installed"
echo "  ─────────────────────────────────────"
echo "  Schedule:  every day at ${SYNC_HOUR}:00 (local time)"
echo "  Plist:      ${PLIST_DEST}"
echo "  Logs:       ${ROOT}/logs/devlog-sync.log"
echo ""
echo "  Test now:   npm run sync:devlog"
echo "  Uninstall:  bash scripts/uninstall-launchagent.sh"
echo ""
