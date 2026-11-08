#!/bin/bash
# Sets up one-click updates for DocInsight in Google Chrome on this Mac (optional). Run it once in Terminal, either
#   curl -fsSL https://raw.githubusercontent.com/mi3law/docinsight/main/updater/setup-mac.sh | bash
# or from a DocInsight folder:  bash updater/setup-mac.sh
# Add --remove to undo it (with the curl line: ... | bash -s -- --remove). Run it again after moving the folder or
# loading another copy.
#
# It finds every DocInsight folder loaded in Chrome (Load unpacked) in any Chrome profile, copies the helper
# (host-mac.sh) to ~/Library/Application Support/DocInsight, and registers it with Chrome as a native messaging host
# that only those copies of DocInsight may start. Nothing runs in the background: Chrome starts the helper when you
# press "Update now" in DocInsight, and it stops when the update is done.
set -eu

NAME=com.mi3law.docinsight.updater
RAW=https://raw.githubusercontent.com/mi3law/docinsight/main
APP_DIR="$HOME/Library/Application Support/DocInsight"
CHROME="$HOME/Library/Application Support/Google/Chrome"
HOSTS="$CHROME/NativeMessagingHosts"

if [ "${1:-}" = --remove ]; then
  rm -f "$HOSTS/$NAME.json"
  rm -rf "$APP_DIR"
  echo "One-click updates for DocInsight are removed. DocInsight itself is unchanged."
  exit 0
fi

is_docinsight() { grep -qs '"name": *"DocInsight"' "$1/manifest.json"; }
# Chrome's id for an unpacked extension comes from its folder's path: the first 32 hex digits of the path's SHA-256,
# written with the letters a to p.
ext_id() { printf '%s' "$1" | shasum -a 256 | cut -c1-32 | tr '0-9a-f' 'a-p'; }

# The folders: every DocInsight path in the profiles' settings whose id Chrome also lists there (so it is loaded),
# plus the folder this script sits in.
found=$(mktemp)
trap 'rm -f "$found"' EXIT
for prefs in "$CHROME"/*/"Secure Preferences" "$CHROME"/*/Preferences; do
  [ -f "$prefs" ] || continue
  { grep -o '"path":"/[^"]*"' "$prefs" || true; } | sed 's/^"path":"//; s/"$//' | sort -u | while IFS= read -r p; do
    if is_docinsight "$p" && grep -q "\"$(ext_id "$p")\"" "$prefs"; then printf '%s\n' "$p"; fi
  done
done >> "$found"
here=
case $0 in *setup-mac.sh) here=$(cd "$(dirname "$0")/.." && pwd -P) ;; esac
if [ -n "$here" ] && is_docinsight "$here"; then printf '%s\n' "$here" >> "$found"; fi
sort -u -o "$found" "$found"

if [ ! -s "$found" ]; then
  echo "No DocInsight found in Chrome on this Mac."
  echo "Load the DocInsight folder in chrome://extensions first (Developer mode, Load unpacked), then run this again."
  exit 1
fi

mkdir -p "$APP_DIR" "$HOSTS"
host="$APP_DIR/updater-host.sh"
if [ -n "$here" ] && [ -f "$here/updater/host-mac.sh" ]; then
  cp "$here/updater/host-mac.sh" "$host"
else
  curl -fsSL "$RAW/updater/host-mac.sh" -o "$host"
fi
chmod 755 "$host"
xattr -d com.apple.quarantine "$host" 2>/dev/null || true

: > "$APP_DIR/folders"
origins=
echo "One-click updates are set up for DocInsight in:"
while IFS= read -r p; do
  id=$(ext_id "$p")
  printf '%s\t%s\n' "$id" "$p" >> "$APP_DIR/folders"
  origins="$origins${origins:+, }\"chrome-extension://$id/\""
  echo "  $p"
done < "$found"

cat > "$HOSTS/$NAME.json" <<EOF
{
  "name": "$NAME",
  "description": "DocInsight update helper",
  "path": "$host",
  "type": "stdio",
  "allowed_origins": [$origins]
}
EOF

echo
echo "In DocInsight, \"Update available\" now offers \"Update now\". The first time, macOS may ask whether Google Chrome"
echo "may use the folder DocInsight is in: allow it."
