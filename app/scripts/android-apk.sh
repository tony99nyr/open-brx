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
# macOS ships `shasum`, not `sha256sum` (the match-day machine is a MacBook)
sha256_of() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d" " -f1; else shasum -a 256 "$1" | cut -d" " -f1; fi; }
if [ -z "${JAVA_HOME:-}" ] || [ "$(jdk_major "$JAVA_HOME")" != "21" ]; then
  found=""
  # macOS keeps JDKs where java_home knows about them; Linux in ~/.jdks or /usr/lib/jvm
  if [ -x /usr/libexec/java_home ]; then
    mac="$(/usr/libexec/java_home -v 21 2>/dev/null || true)"
    [ -n "$mac" ] && [ "$(jdk_major "$mac")" = "21" ] && found="$mac"
  fi
  for c in "$HOME"/.jdks/*21* /usr/lib/jvm/*21* /usr/lib/jvm/java-21-*; do
    [ -n "$found" ] && break
    [ -d "$c" ] || continue
    if [ "$(jdk_major "$c")" = "21" ]; then found="$c"; break; fi
  done
  if [ -z "$found" ]; then
    echo "error: JDK 21 not found (Capacitor 8 needs it; javac in PATH is $(javac -version 2>&1))." >&2
    echo "       Install one (apt install openjdk-21-jdk / brew install openjdk@21, or Android" >&2
    echo "       Studio's bundled JBR) or point JAVA_HOME at it." >&2
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
# What goes in the apk is the WORKING TREE, not the last commit: npm run build bundles src/ as it is
# right now. Publishing someone's half-finished edit is silent and unrecoverable-looking, so say it.
GIT_SHA="$(git -C "$REPO" rev-parse --short HEAD 2>/dev/null || echo unknown)"
# `|| true`: without it, `set -e` kills the run here (exit 128, no output) on a tarball checkout or
# a machine without git — after the whole gradle build, one line before the apk would be copied.
# Pathspec is all of app/ except docs: android-setup.sh writes the manifest that ships in the apk.
DIRTY="$(git -C "$REPO" status --porcelain -- app ':(exclude)app/*.md' 2>/dev/null || true)"
if [ -n "$DIRTY" ]; then
  echo
  echo "WARNING: app sources are not committed; this apk bakes in the working tree:" >&2
  echo "$DIRTY" | sed 's/^/         /' >&2
  echo "         Commit (or stash) before publishing, or the site serves an unreviewed build." >&2
  echo
fi
OUT="${APK_OUT_DIR:-$REPO/webapp/download}"   # override for a trial build that must not touch the site
NAME="brx-companion-${VERSION}-android-debug.apk"
mkdir -p "$OUT"
cp "$APK" "$OUT/$NAME"
# exactly one apk lives there: the site build refuses to guess between two. Prune AFTER the copy so a
# failure never leaves the folder empty, and case-insensitively so a stray .APK cannot survive to
# hard-fail the site build.
# -samefile, not -name: on a case-insensitive filesystem (macOS) a pre-existing "…-debug.APK" keeps
# its own directory entry when cp writes through it, and a name-based prune would delete the inode we
# just wrote. Compare identity instead.
find "$OUT" -maxdepth 1 -iname '*.apk' ! -samefile "$OUT/$NAME" -print -delete

# A sidecar for the site: the build date cannot be read back off the apk (a checkout rewrites the
# mtime, the zip entries are normalised), and the site refuses the sidecar if it stops matching.
node -e '
const fs = require("fs"), crypto = require("crypto");
const [file, dir] = [process.argv[1], process.argv[2]];
const buf = fs.readFileSync(dir + "/" + file);
const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
// "built" describes the BYTES, not this run: a rebuild that produces an identical apk (gradle was
// up to date) keeps the original date rather than aging the download page forward for nothing.
let built = new Date().toISOString();
try {
  const prev = JSON.parse(fs.readFileSync(dir + "/build.json", "utf8"));
  if (prev.sha256 === sha256 && prev.built) built = prev.built;
} catch {}
fs.writeFileSync(dir + "/build.json", JSON.stringify({
  file, version: process.argv[3], variant: "debug", built, bytes: buf.length, sha256,
  git: process.argv[4], dirty: process.argv[5] === "1",
}, null, 1) + "\n");
' "$NAME" "$OUT" "$VERSION" "$GIT_SHA" "$([ -n "$DIRTY" ] && echo 1 || echo 0)"

echo
echo "==> $OUT/$NAME"
echo "    $(du -h "$OUT/$NAME" | cut -f1)  sha256 $(sha256_of "$OUT/$NAME" | cut -c1-16)…"
echo "    Next: (cd site && npm run build && npm test), then commit webapp/ and push (a push to main deploys)."
