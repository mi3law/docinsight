#!/bin/bash
# DocInsight's update helper for Google Chrome on a Mac: a Chrome native messaging host, installed by setup-mac.sh.
# Chrome starts it when DocInsight asks (chrome.runtime.sendNativeMessage), passing the calling extension's origin as
# the first argument; it reads one message, answers it, and exits.
#   {"cmd":"ping"}    ->  {"ok":true,"version":"<the folder's version>"}
#   {"cmd":"update"}  ->  updates the folder, then {"ok":true,"version":"<new version>","method":"git"|"zip"}
#   failures          ->  {"ok":false,"error":"<code>","detail":"<message>"}
# It only touches the folder that setup-mac.sh registered for the calling copy of DocInsight. A folder that is a git
# clone is updated with `git pull --ff-only`; any other folder gets GitHub's ZIP of the main branch copied over it.
set -u
export LC_ALL=C PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

APP_DIR="${DOCINSIGHT_UPDATER_HOME:-$HOME/Library/Application Support/DocInsight}"
ZIP_URL="${DOCINSIGHT_ZIP_URL:-https://github.com/mi3law/docinsight/archive/refs/heads/main.zip}"

# A JSON string: newlines and tabs as spaces, other control characters dropped, quotes and backslashes escaped.
json_str() {
  local s
  s=$(printf '%s' "$1" | tr '\n\t' '  ' | tr -d '\000-\037' | cut -c1-600)
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  printf '"%s"' "$s"
}

# One framed message: its length in 4 bytes (native byte order, little-endian on every Mac), then the JSON.
send() {
  local n=${#1}
  printf "$(printf '\\x%02x\\x%02x\\x%02x\\x%02x' $((n & 255)) $((n >> 8 & 255)) $((n >> 16 & 255)) $((n >> 24 & 255)))"
  printf '%s' "$1"
}

fail() {
  send "{\"ok\":false,\"error\":$(json_str "$1"),\"detail\":$(json_str "${2:-}")}"
  exit 0
}

is_docinsight() { grep -qs '"name": *"DocInsight"' "$1/manifest.json"; }
version_of() { sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$1/manifest.json" | head -1; }

# The message: dd reads exactly the bytes asked for (head could read ahead and lose them).
len=$(dd bs=1 count=4 2>/dev/null | od -An -tu4 | tr -d ' \n')
case $len in '' | *[!0-9]*) fail bad-message 'No message' ;; esac
[ "$len" -gt 0 ] && [ "$len" -lt 65536 ] || fail bad-message "Length $len"
msg=$(dd bs=1 count="$len" 2>/dev/null)

caller=${1:-}
id=${caller#chrome-extension://}
id=${id%%/*}
folder=
[ -f "$APP_DIR/folders" ] && folder=$(awk -F'\t' -v id="$id" '$1 == id { print $2; exit }' "$APP_DIR/folders")
[ -n "$id" ] && [ -n "$folder" ] || fail not-set-up "No folder registered for $id"
is_docinsight "$folder" || fail no-folder "$folder"

case $msg in
  *'"ping"'*) send "{\"ok\":true,\"version\":$(json_str "$(version_of "$folder")")}"; exit 0 ;;
  *'"update"'*) ;;
  *) fail bad-message "$msg" ;;
esac

if [ -d "$folder/.git" ]; then
  out=$(git -C "$folder" pull --ff-only 2>&1) || fail git-failed "$out"
  method=git
else
  tmp=$(mktemp -d) || fail copy-failed 'No temporary folder'
  trap 'rm -rf "$tmp"' EXIT
  curl -fsSL --max-time 180 -o "$tmp/docinsight.zip" "$ZIP_URL" 2>"$tmp/err" || fail download-failed "$(cat "$tmp/err")"
  mkdir "$tmp/x"
  ditto -x -k "$tmp/docinsight.zip" "$tmp/x" 2>"$tmp/err" || fail unzip-failed "$(cat "$tmp/err")"
  # GitHub wraps the files in one folder (docinsight-main).
  manifest=$(find "$tmp/x" -maxdepth 2 -name manifest.json | head -1)
  [ -n "$manifest" ] || fail bad-download 'No manifest.json'
  src=$(dirname "$manifest")
  is_docinsight "$src" || fail bad-download 'Not DocInsight'
  # --checksum: compare contents. rsync's usual check (same size and time) would keep an old file that matches both.
  out=$(rsync -a --delete --checksum "$src/" "$folder/" 2>&1) || fail copy-failed "$out"
  method=zip
fi

send "{\"ok\":true,\"version\":$(json_str "$(version_of "$folder")"),\"method\":\"$method\"}"
