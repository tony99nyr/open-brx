#!/usr/bin/env bash
# Build a SIGNED Android release apk (B21). This is a build step only: it never publishes or
# uploads anything, and it never touches webapp/download or GitHub Releases (that is
# android-apk.sh's debug path, kept separate on purpose).
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

echo
echo "==> android/app/build/outputs/apk/release/app-release.apk"
echo "    version $VERSION, signed, local only. Nothing has been published."
echo "    Hand it to Tony to sideload or distribute; publishing is a separate, deliberate step."
