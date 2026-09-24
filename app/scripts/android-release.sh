#!/usr/bin/env bash
# Build a SIGNED Android release apk (B21). This is a build step only: it never publishes or
# uploads anything, and never touches GitHub Releases. It does copy the APK into webapp/download and
# write the download sidecar (build.json) through scripts/apk-sidecar.mjs, the writer android-apk.sh
# uses. Commit the version bump FIRST, build, then commit build.json on top: the sidecar names the
# commit it was built from, and a dirty tree marks it dirty. APK_OUT_DIR sends a dry run elsewhere.
#
#   npm run android:release
#
# What it does: bundle the web app, re-apply every Android setting we depend on
# (android-setup.sh — this is also where the release signingConfig gets patched into the
# generated build.gradle), then run Gradle assembleRelease. With no signing material present
# (BRX_KEYSTORE* env vars or a keystore.properties file), Gradle refuses the build with a clear
# message: see the "Open BRX: release signing" block android-setup.sh writes into build.gradle.
# This script does not create, read the contents of, or otherwise handle key material itself;
# Gradle reads it directly from the env/properties file.
#
# Requires JDK 21 and the Android SDK, same as android-apk.sh (whose JDK-finding logic this
# repeats rather than sharing, to keep the two build paths independent).
set -euo pipefail
cd "$(dirname "$0")/.."

# --- JDK 21 ------------------------------------------------------------------------------------
jdk_major() { [ -x "$1/bin/javac" ] && "$1/bin/javac" -version 2>&1 | sed -n 's/^javac \([0-9]*\).*/\1/p'; }
if [ -z "${JAVA_HOME:-}" ] || [ "$(jdk_major "$JAVA_HOME")" != "21" ]; then
  found=""
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

# --- one version per release build ----------------------------------------------------------------
# versionCode is derived from package.json's semver (android-setup.sh), so a release cut at a version
# that already shipped would carry the SAME versionCode and a phone would refuse it as an upgrade.
# Refuse here instead: bump package.json's version first. The check only reads the remote tags.
VERSION="$(node -p "require('./package.json').version")"
rc=0; git ls-remote --exit-code --tags origin "refs/tags/app-v${VERSION}" >/dev/null 2>&1 || rc=$?
if [ "$rc" -eq 0 ]; then
  echo "error: app-v${VERSION} is already released. Bump \"version\" in app/package.json, then build again." >&2
  exit 1
elif [ "$rc" -ne 2 ]; then   # 2 = no such tag; anything else = the check itself failed
  echo "warning: could not reach origin to check app-v${VERSION}; make sure this version has not shipped." >&2
fi

# --- build ---------------------------------------------------------------------------------------
./scripts/android-setup.sh          # add/sync the platform + our patches, incl. the signingConfig
npm run build                       # src/app.js -> www/app.js
npx cap copy android                # push the fresh bundle into the platform
(cd android && ./gradlew assembleRelease)

APK="android/app/build/outputs/apk/release/app-release.apk"
[ -f "$APK" ] || { echo "error: $APK missing after a successful build" >&2; exit 1; }
VERSION="$(node -p "require('./package.json').version")"

# --- the download sidecar, the same writer android:apk uses -----------------------------------------
# `git` is the commit this APK was built from; the release's asset URL is written up front, so the bump
# commit carries a sidecar the site and test_published_build.py accept. Publishing stays separate.
REPO="$(cd .. && pwd)"
GIT_SHA="$(git -C "$REPO" rev-parse --short HEAD 2>/dev/null || echo unknown)"
DIRTY="$(git -C "$REPO" status --porcelain -- app ':(exclude)app/*.md' ':(exclude)app/release-notes' 2>/dev/null || true)"
if [ -n "$DIRTY" ]; then
  echo "WARNING: app sources are not committed; the stamp and the sidecar say dirty. Publish only a clean build." >&2
fi
SLUG="$(git -C "$REPO" remote get-url origin 2>/dev/null | sed -E 's#^(git@github.com:|https://github.com/)##; s#\.git$##')"
[ -n "$SLUG" ] || SLUG="tony99nyr/open-brx"
OUT="${APK_OUT_DIR:-$REPO/webapp/download}"   # override for a dry run that must not touch the site
TAG="app-v${VERSION}"
NAME="$(node scripts/apk-sidecar.mjs write --apk "$APK" --out "$OUT" --version "$VERSION" --variant release \
  --git "$GIT_SHA" --dirty "$([ -n "$DIRTY" ] && echo 1 || echo 0)" --gradle "$REPO/app/android/variables.gradle" \
  --slug "$SLUG" --release "$TAG")"
[ -n "$NAME" ] || { echo "error: apk-sidecar.mjs wrote no file name" >&2; exit 1; }

echo
echo "==> $OUT/$NAME (and android/app/build/outputs/apk/release/app-release.apk)"
echo "    version $VERSION, signed, local only. Nothing has been published."
echo "    The sidecar $OUT/build.json names $TAG. Commit it on top of the committed bump, then push and"
echo "    publish $TAG with that exact file at once. Publishing is a separate, deliberate step."
