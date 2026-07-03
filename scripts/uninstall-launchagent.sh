#!/usr/bin/env bash
# Remove the nightly DEVLOG → Notion LaunchAgent.

set -euo pipefail

LABEL="com.gesturecanvas.devlog-sync"
PLIST_DEST="$HOME/Library/LaunchAgents/${LABEL}.plist"
DOMAIN="gui/$(id -u)"

launchctl bootout "${DOMAIN}/${LABEL}" 2>/dev/null || true
rm -f "$PLIST_DEST"

echo "Removed ${LABEL}"
