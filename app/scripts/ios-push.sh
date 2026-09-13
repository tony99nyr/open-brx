#!/usr/bin/env bash
# Build the working tree and push it to every paired iPhone, over the air.
#
#   npm run ios:push                 # every paired device
#   npm run ios:push -- --list       # show what it would target; build nothing
#   npm run ios:push -- 001979       # only devices whose name/udid contains this
#   npm run ios:push -- --no-launch  # install, but leave the app closed
#
# This is the DEVELOPMENT install path, not TestFlight: it signs with whatever team
# the Xcode project carries (DEVELOPMENT_TEAM in the pbxproj) and installs straight
# to a device over the local network. On a FREE Apple ID the result stops launching
# after 7 days — re-run this to refresh it. TestFlight/App Store distribution is a
# separate script; this one never uploads anything.
#
# Requires macOS + full Xcode. The phone must be: on the same Wi-Fi as this Mac,
# awake, paired, with Developer Mode on and this Mac's developer certificate trusted.
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="$(cd .. && pwd)"

LAUNCH=1
LIST_ONLY=0
FILTER=""
for a in "$@"; do
  case "$a" in
    --no-launch) LAUNCH=0 ;;
    --list)      LIST_ONLY=1 ;;
    -h|--help)   sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*)          echo "error: unknown flag $a (see --help)" >&2; exit 2 ;;
    *)           FILTER="$a" ;;
  esac
done

# --- preflight ---------------------------------------------------------------------------------
[ "$(uname -s)" = "Darwin" ] || { echo "error: iOS builds need macOS." >&2; exit 1; }

# The classic trap, and it cost this project time already: installing the Command Line Tools
# re-points the selector, so Xcode.app still builds in the GUI while every `xcodebuild` in a
# shell fails. Say the fix rather than letting xcodebuild print its riddle.
DEVDIR="$(xcode-select -p 2>/dev/null || true)"
case "$DEVDIR" in
  *Xcode.app*) : ;;
  *) echo "error: xcode-select points at '${DEVDIR:-nothing}', not Xcode." >&2
     echo "       Fix with: sudo xcode-select -s /Applications/Xcode.app/Contents/Developer" >&2
     exit 1 ;;
esac
command -v xcrun >/dev/null || { echo "error: xcrun not found." >&2; exit 1; }

# --- who are we shipping to? --------------------------------------------------------------------
# `devicectl list devices` is the only supported discovery path in Xcode 15+. Parse its JSON, not
# its table: the table's State column is not machine-readable and its widths move between releases.
# NOTE: tunnelState is routinely "disconnected" for a perfectly reachable phone — the tunnel is
# brought up on demand. Filtering on it would hide every idle device, so filter on pairingState.
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
xcrun devicectl list devices --json-output "$TMP/devices.json" >/dev/null 2>&1 \
  || { echo "error: 'devicectl list devices' failed; is Xcode fully installed?" >&2; exit 1; }

DEVICES="$(python3 - "$TMP/devices.json" "$FILTER" <<'PY'
import json, sys
path, filt = sys.argv[1], sys.argv[2].lower()
rows = []
for d in json.load(open(path)).get("result", {}).get("devices", []):
    hw, dp, cp = (d.get(k) or {} for k in ("hardwareProperties", "deviceProperties", "connectionProperties"))
    udid, name = hw.get("udid"), dp.get("name") or "(unnamed)"
    if not udid or hw.get("platform") != "iOS":
        continue
    if cp.get("pairingState") != "paired":
        continue
    if filt and filt not in name.lower() and filt not in udid.lower():
        continue
    rows.append("\t".join([udid, d.get("identifier", ""), name,
                           hw.get("marketingName") or hw.get("productType") or "?",
                           dp.get("osVersionNumber") or "?",
                           dp.get("developerModeStatus") or "unknown"]))
print("\n".join(rows))
PY
)"

if [ -z "$DEVICES" ]; then
  echo "error: no paired iPhone found${FILTER:+ matching '$FILTER'}." >&2
  echo "       Check, in this order:" >&2
  echo "         1. the phone is awake and on the SAME Wi-Fi as this Mac" >&2
  echo "         2. Developer Mode is on   (Settings > Privacy & Security > Developer Mode)" >&2
  echo "         3. it has been paired once over USB, with Trust tapped on the phone" >&2
  exit 1
fi

printf '%s\n' "$DEVICES" > "$TMP/targets"
echo "==> targets:"
while IFS=$'\t' read -r udid ident name model osver devmode; do
  printf '    %-22s %-12s iOS %-9s devmode=%s\n' "$name" "$model" "$osver" "$devmode"
  printf '      %s\n' "$udid"
done < "$TMP/targets"
[ "$LIST_ONLY" = "1" ] && exit 0

# Developer Mode off is a hard stop with a uniquely unhelpful xcodebuild error ("Timed out waiting
# for all destinations"), so catch it here and name the toggle.
if printf '%s\n' "$DEVICES" | grep -qv 'enabled$'; then
  echo >&2
  echo "error: Developer Mode is not enabled on every target above." >&2
  echo "       On the phone: Settings > Privacy & Security > Developer Mode > on, then restart." >&2
  echo "       (The toggle only appears after a Mac has attempted a development install.)" >&2
  exit 1
fi

# --- build -------------------------------------------------------------------------------------
npm run build                # src/*.js -> www/*.js
./scripts/ios-setup.sh       # sync the platform + re-apply every Info.plist setting we depend on

# What lands on the phone is the WORKING TREE, not the last commit, exactly as for android:apk.
# Print the commit so a phone can be traced back to a tree, and shout about uncommitted edits.
GIT_SHA="$(git -C "$REPO" rev-parse --short HEAD 2>/dev/null || echo unknown)"
DIRTY="$(git -C "$REPO" status --porcelain -- app ':(exclude)app/*.md' 2>/dev/null || true)"
VERSION="$(node -p "require('./package.json').version")"

DD="ios/.push-dd"   # inside the git-ignored ios/; kept between runs so builds stay incremental
FAILED=""
while IFS=$'\t' read -r udid ident name model osver devmode; do
  echo
  echo "==> building for $name ($model)"
  # Per-device destination on purpose: this is what registers a NEW device with the team
  # provisioning profile. -allowProvisioningUpdates lets it re-issue the profile unattended.
  if ! xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
         -destination "platform=iOS,id=$udid" -derivedDataPath "$DD" \
         -allowProvisioningUpdates -quiet build; then
    echo "error: build failed for $name" >&2; FAILED="yes"; continue
  fi

  APP="$DD/Build/Products/Debug-iphoneos/App.app"
  [ -d "$APP" ] || { echo "error: $APP missing after a successful build" >&2; FAILED="yes"; continue; }

  echo "==> installing to $name"
  if ! xcrun devicectl device install app --device "$ident" "$APP"; then
    echo "error: install failed for $name" >&2; FAILED="yes"; continue
  fi

  [ "$LAUNCH" = "1" ] || continue
  echo "==> launching on $name"
  if ! xcrun devicectl device process launch --device "$ident" com.openbrx.companion 2>"$TMP/launch.err"; then
    cat "$TMP/launch.err" >&2
    # The one launch failure with a fix the operator must perform by hand, so spell it out.
    if grep -q "explicitly trusted" "$TMP/launch.err"; then
      echo >&2
      echo "note: the app IS installed; this phone has not trusted the developer certificate." >&2
      echo "      Settings > General > VPN & Device Management > Developer App > Trust." >&2
    fi
    FAILED="yes"
  fi
done < "$TMP/targets"

echo
echo "==> pushed v$VERSION from $GIT_SHA"
if [ -n "$DIRTY" ]; then
  echo "WARNING: these app files are not committed; the phones are running your working tree:" >&2
  echo "$DIRTY" | sed 's/^/         /' >&2
fi
echo "    A free-team build stops launching after 7 days. Re-run this to refresh it."
if [ -n "$FAILED" ]; then
  echo "error: at least one device above did not get the build." >&2
  exit 1
fi
