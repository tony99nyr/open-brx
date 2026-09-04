#!/usr/bin/env bash
# Add + configure the Android platform. Safe to re-run.
#
# `android/` is git-ignored (generated, like `ios/`), so anything hand-edited in
# there is lost the next time the platform is regenerated. Every Android setting
# we depend on therefore lives HERE, in a committed script, not in the generated
# Gradle project.
#
#   npm run android:setup   # add the platform if missing, then apply our config
#
# Requires JDK 21 + the Android SDK (Capacitor 8).
#
# --- What this patches, and why ---------------------------------------------
# The BLE plugin's manifest declares a plain BLUETOOTH_SCAN + ACCESS_FINE_LOCATION.
# On Android 12+ that makes every BLE scan "location-deriving", so it returns
# ZERO results whenever the system Location toggle is off — even though we never
# use location. iOS has no such rule, which is why the app scanned fine there and
# came up empty on Android. We flag the scan `neverForLocation` (so no location is
# needed on Android 12+) and cap the legacy location perms at API 30 (they are
# only required to scan on Android 11 and below). Paired with
# `BleClient.initialize({ androidNeverForLocation: true })` in src/app.js.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -d android ]; then
  echo "==> adding Android platform"
  npx cap add android
else
  echo "==> Android platform present; syncing web assets + plugins"
  npx cap sync android
fi

MANIFEST="android/app/src/main/AndroidManifest.xml"
echo "==> patching $MANIFEST (BLE-without-location)"

python3 - "$MANIFEST" <<'PY'
import re, sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()

# 1) ensure the tools: namespace on the <manifest> root (needed for tools:node)
if "xmlns:tools=" not in s:
    s = s.replace(
        '<manifest xmlns:android="http://schemas.android.com/apk/res/android">',
        '<manifest xmlns:android="http://schemas.android.com/apk/res/android"\n'
        '    xmlns:tools="http://schemas.android.com/tools">',
        1,
    )

# 2) inject our permission overrides once (idempotent via the marker comment)
MARKER = "<!-- Open BRX: BLE without location -->"
# Applied ONE PERMISSION AT A TIME, not as an all-or-nothing block. The old form was gated on MARKER
# being absent, so once a machine had an `android/` every permission added to this script afterwards
# silently never landed there: the 2026-08-30 published apk shipped without ACCESS_NETWORK_STATE,
# ACCESS_WIFI_STATE, CHANGE_NETWORK_STATE, FOREGROUND_SERVICE(_CONNECTED_DEVICE) and
# POST_NOTIFICATIONS, the very gates §8b calls not optional. Per-entry insertion heals such a tree.
ENTRIES = [
    # (a substring that proves this entry is already applied, the xml to insert)
    ('usesPermissionFlags="neverForLocation"',
     '    <uses-permission android:name="android.permission.BLUETOOTH_SCAN"\n'
     '        android:usesPermissionFlags="neverForLocation" tools:node="replace" />\n'),
    ('ACCESS_FINE_LOCATION"\n        android:maxSdkVersion="30"',
     '    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION"\n'
     '        android:maxSdkVersion="30" tools:node="replace" />\n'),
    ('ACCESS_COARSE_LOCATION"\n        android:maxSdkVersion="30"',
     '    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION"\n'
     '        android:maxSdkVersion="30" tools:node="replace" />\n'),
    # --- field LAN gates (net.md §8b): ws:// to a private IP + bind to the game Wi-Fi ---
    ('android.permission.ACCESS_NETWORK_STATE',
     '    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />\n'),
    ('android.permission.ACCESS_WIFI_STATE',
     '    <uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />\n'),
    ('android.permission.CHANGE_NETWORK_STATE',
     '    <uses-permission android:name="android.permission.CHANGE_NETWORK_STATE" />\n'),
    # TODO node.md §3.11: the keep-alive foreground service (foregroundServiceType="connectedDevice")
    # is not built yet; keep-awake covers screen-on only
    ('android.permission.FOREGROUND_SERVICE"',
     '    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />\n'),
    ('android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE',
     '    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE" />\n'),
    ('android.permission.POST_NOTIFICATIONS',
     '    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />\n'),
    # camera look-through (@capacitor-community/camera-preview) and the in-app MC QR scanner
    ('android.permission.CAMERA',
     '    <uses-permission android:name="android.permission.CAMERA" />\n'),
]

# 2b) allow cleartext ws:// to the private LAN (API 28+ blocks it by default). Capacitor's
#     `allowMixedContent` is about mixed HTTPS pages, NOT this. Set it on <application>.
if 'android:usesCleartextTraffic' not in s:
    s = re.sub(r'(<application\b)', r'\1 android:usesCleartextTraffic="true"', s, count=1)

# 2c) landscape-only, rail-mounted: force it on the main activity.
if 'android:screenOrientation' not in s:
    s = re.sub(r'(<activity\b)', r'\1 android:screenOrientation="landscape"', s, count=1)
if MARKER not in s:
    s = s.replace("</manifest>", f"\n    {MARKER}\n</manifest>", 1)
added = []
for probe, xml in ENTRIES:
    if probe in s:
        continue
    s = s.replace("</manifest>", xml + "</manifest>", 1)
    added.append(re.search(r'android\.permission\.([A-Z_]+)', xml).group(1))
print("   added: " + (", ".join(added) if added else "nothing (already complete)"))

open(p, "w", encoding="utf-8").write(s)
print("   ok")
PY

# --- fullscreen HUD: no status bar over the top-right corner ---------------------------------
# On device the clock / battery / signal strip covered the HUD's ⓘ button (Tony, 2026-09-04). A
# rail-mounted game HUD is fullscreen. Capacitor's generated theme is regenerated with the platform,
# so the flag lives here, not in the project. The web layer also insets by the safe area.
STYLES="android/app/src/main/res/values/styles.xml"
if [ -f "$STYLES" ] && ! grep -q 'android:windowFullscreen' "$STYLES"; then
  echo "==> styles.xml: AppTheme.NoActionBar gets android:windowFullscreen"
  python3 - "$STYLES" <<'FULLSCREEN'
import sys, re
p = sys.argv[1]; s = open(p, encoding="utf-8").read()
m = re.search(r'(<style name="AppTheme\.NoActionBar"[^>]*>)', s)
if m:
    s = s[:m.end()] + '\n        <item name="android:windowFullscreen">true</item>' + s[m.end():]
    open(p, "w", encoding="utf-8").write(s); print("   ok")
else:
    print("   AppTheme.NoActionBar not found - add android:windowFullscreen by hand")
FULLSCREEN
fi

# --- app version: keep the APK in step with app/package.json ---------------------------------
# `npx cap add android` writes versionName "1.0" / versionCode 1. That is Capacitor's placeholder,
# not our version, and it is what a downloader sees in Settings > Apps. Stamp the real one, and
# derive a monotonic versionCode from it (0.1.0 -> 100) so a later build upgrades over an older one.
echo "==> stamping app version from package.json"
python3 - android/app/build.gradle package.json <<'VERSTAMP'
import json, re, sys
gradle, pkg = sys.argv[1], sys.argv[2]
ver = json.load(open(pkg, encoding="utf-8"))["version"]
major, minor, patch = (int(x) for x in (ver.split(".") + ["0", "0"])[:3])
code = major * 10000 + minor * 100 + patch
s = open(gradle, encoding="utf-8").read()
s = re.sub(r"versionCode\s+\d+", f"versionCode {code}", s, count=1)
s = re.sub(r'versionName\s+"[^"]*"', f'versionName "{ver}"', s, count=1)
open(gradle, "w", encoding="utf-8").write(s)
print(f"   versionName {ver} / versionCode {code}")
VERSTAMP

echo "==> resulting BLE/location permissions:"
grep -A1 -E "BLUETOOTH_SCAN|ACCESS_(FINE|COARSE)_LOCATION" "$MANIFEST" || true
echo "==> done. Build a distributable APK with: npm run android:apk"
