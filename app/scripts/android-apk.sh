#!/usr/bin/env bash
# Build the distributable Android APK and drop it into webapp/download/ for the public site.
#
#   npm run android:apk
#
# What it does: bundle the web app, re-apply every Android setting we depend on
# (scripts/android-setup.sh — `android/` is generated and git-ignored, so those patches must be
# re-applied on every machine), build a DEBUG apk, and copy it to
# `webapp/download/brx-companion-<version>-android-debug.apk`, replacing any older apk there.
#
# Why debug and not release: there is no release keystore in this project yet. A debug apk
# sideloads fine, but it is signed with the throwaway Android debug key, so the first
# release-signed build will NOT upgrade over it (players will have to uninstall first).
#
# Requires JDK 21 (Capacitor 8) and the Android SDK. If JAVA_HOME is unset or points at an
# older JDK, this script looks for a 21 in ~/.jdks and /usr/lib/jvm.
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="$(cd .. && pwd)"

# --- JDK 21 ------------------------------------------------------------------------------------
jdk_major() { [ -x "$1/bin/javac" ] && "$1/bin/javac" -version 2>&1 | sed -n 's/^javac \([0-9]*\).*/\1/p'; }
if [ -z "${JAVA_HOME:-}" ] || [ "$(jdk_major "$JAVA_HOME")" != "21" ]; then
  found=""
  for c in "$HOME"/.jdks/*21* /usr/lib/jvm/*21* /usr/lib/jvm/java-21-*; do
    [ -d "$c" ] || continue
    if [ "$(jdk_major "$c")" = "21" ]; then found="$c"; break; fi
  done
  if [ -z "$found" ]; then
    echo "error: JDK 21 not found (Capacitor 8 needs it; javac in PATH is $(javac -version 2>&1))." >&2
    echo "       Install one (apt install openjdk-21-jdk, or Android Studio's JBR) or set JAVA_HOME." >&2
    exit 1
  fi
  export JAVA_HOME="$found"
fi
echo "==> JDK: $JAVA_HOME ($("$JAVA_HOME/bin/javac" -version 2>&1))"

# --- build -------------------------------------------------------------------------------------
./scripts/android-setup.sh          # bundles nothing; adds/syncs the platform + our patches
npm run build                       # src/app.js -> www/app.js
npx cap copy android                # push the fresh bundle into the platform
(cd android && ./gradlew assembleDebug)

# --- publish into the site --------------------------------------------------------------------
APK="android/app/build/outputs/apk/debug/app-debug.apk"
[ -f "$APK" ] || { echo "error: $APK missing after a successful build" >&2; exit 1; }
VERSION="$(node -p "require('./package.json').version")"
OUT="$REPO/webapp/download"
NAME="brx-companion-${VERSION}-android-debug.apk"
mkdir -p "$OUT"
# exactly one apk lives there: the site build refuses to guess between two
find "$OUT" -maxdepth 1 -name '*.apk' ! -name "$NAME" -print -delete
cp "$APK" "$OUT/$NAME"

# A sidecar for the site: the build date cannot be read back off the apk (a checkout rewrites the
# mtime, the zip entries are normalised), and the site refuses the sidecar if it stops matching.
node -e '
const fs = require("fs"), crypto = require("crypto");
const [file, dir] = [process.argv[1], process.argv[2]];
const buf = fs.readFileSync(dir + "/" + file);
fs.writeFileSync(dir + "/build.json", JSON.stringify({
  file, version: process.argv[3], variant: "debug",
  built: new Date().toISOString(), bytes: buf.length,
  sha256: crypto.createHash("sha256").update(buf).digest("hex"),
}, null, 1) + "\n");
' "$NAME" "$OUT" "$VERSION"

echo
echo "==> $OUT/$NAME"
echo "    $(du -h "$OUT/$NAME" | cut -f1)  sha256 $(sha256sum "$OUT/$NAME" | cut -c1-16)…"
echo "    Next: (cd site && npm run build && npm test), then commit webapp/ and push (a push to main deploys)."
