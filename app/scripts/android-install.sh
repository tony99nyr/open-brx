#!/usr/bin/env bash
# Build the HUD apk from the working tree and put it on a phone over adb (wireless or USB), then
# launch it. This is the bench loop: edit app/src, run this, the phone is current.
#
#   npm run android:install                              # one phone attached: build + install + launch
#   ADB_DEVICE=192.168.0.149:38939 npm run android:install   # pick a phone when several are attached
#   ADB_CONNECT=192.168.0.149:38939 npm run android:install  # `adb connect` first (wireless debugging)
#   ADB_CONNECT=192.168.0.149 npm run android:install        # the same, with the port found by mDNS (F544)
#   APK=/path/to/some.apk npm run android:install        # skip the build, install that file
#
# The build is `android-apk.sh` with APK_OUT_DIR pointed away from webapp/download/, so the site's
# sidecar and the GitHub Release are never touched: a bench build is not a published build.
#
# Wireless debugging, once per machine + phone:
#   phone: Settings > Developer options > Wireless debugging > "Pair device with pairing code"
#   here:  adb pair <ip>:<PAIRING port> <6-digit code>
# then per session, with the phone's Wireless debugging screen open:
#   adb connect <ip>:<CONNECT port>     # the port on the main Wireless debugging screen, NOT the pairing one
# The connect port changes on every Wi-Fi reconnect (F544). Give ADB_CONNECT the phone's IP alone, or an
# old ip:port that no longer answers, and this script reads the current port from `adb mdns services`.
# Inside WSL2 mDNS does not cross the NAT, so it asks Windows' adb.exe for the port instead (it only
# reads the advert; the connect is still this adb's). Without either, read the port off the phone's
# Wireless debugging screen. The phone's settings are never touched. IPv4 addresses only.
#
# Debug apks are signed with THIS machine's ~/.android/debug.keystore. A phone that holds a build
# from another machine refuses the upgrade (INSTALL_FAILED_UPDATE_INCOMPATIBLE). Either copy that
# keystore here (docs/mac-dev-runbook.md) or uninstall on the phone first; this script never
# uninstalls for you, because that wipes the app's data.
set -euo pipefail
cd "$(dirname "$0")/.."
PKG="com.openbrx.companion"

# --- adb ----------------------------------------------------------------------------------------
if [ -z "${ADB:-}" ]; then
  for c in "${ANDROID_HOME:-}/platform-tools/adb" "${ANDROID_SDK_ROOT:-}/platform-tools/adb" \
           "$HOME/Android/Sdk/platform-tools/adb" "$HOME/Library/Android/sdk/platform-tools/adb"; do
    [ -x "$c" ] && { ADB="$c"; break; }
  done
  [ -n "${ADB:-}" ] || ADB="$(command -v adb || true)"
fi
[ -n "$ADB" ] && [ -x "$ADB" ] || { echo "error: adb not found (set ADB=/path/to/adb, or brew install android-platform-tools)" >&2; exit 1; }

# F544: the phone's current wireless-debugging connect port for an IP, from an mDNS advert, or nothing.
mdns_port() {
  local ip="$1" a out
  for a in "$ADB" "${ADB_EXE:-}" "$(command -v adb.exe 2>/dev/null || true)"; do
    [ -n "$a" ] && [ -x "$a" ] || continue
    "$a" start-server >/dev/null 2>&1 || true   # a server that starts on the lookup itself has an empty cache
    out="$("$a" mdns services 2>/dev/null | tr -d '\r' |
           awk -v ip="$ip" '$2 ~ /_adb-tls-connect/ { split($3, hp, ":"); if (hp[1] == ip) { print hp[2]; exit } }')"
    [ -n "$out" ] && { echo "$out"; return 0; }
  done
  return 1
}

if [ -n "${ADB_CONNECT:-}" ]; then
  ip="${ADB_CONNECT%%:*}"
  said=""
  [ "$ip" = "$ADB_CONNECT" ] || { said="$("$ADB" connect "$ADB_CONNECT" 2>&1 || true)"; echo "==> $said"; }
  case "$said" in
    *"connected to"*) ;;   # also "already connected to"; adb may print its daemon start first
    *)
    port="$(mdns_port "$ip" || true)"
    [ -n "$port" ] || { echo "error: no wireless-debugging advert for $ip. Open Wireless debugging on the phone, or read the" >&2
                        echo "       port off that screen: ADB_CONNECT=$ip:<port>" >&2; exit 1; }
    echo "==> $ip: connect port $port (mDNS)"
    ADB_CONNECT="$ip:$port"
    said="$("$ADB" connect "$ADB_CONNECT" 2>&1 || true)"; echo "==> $said"
    case "$said" in *"connected to"*) ;; *) echo "error: adb could not connect to $ADB_CONNECT" >&2; exit 1 ;; esac ;;
  esac
  [ -n "${ADB_DEVICE:-}" ] || ADB_DEVICE="$ADB_CONNECT"
fi

# --- pick the phone ----------------------------------------------------------------------------
if [ -z "${ADB_DEVICE:-}" ]; then
  mapfile -t DEVS < <("$ADB" devices | awk 'NR>1 && $2=="device"{print $1}')
  case "${#DEVS[@]}" in
    0) echo "error: no phone attached. Pair + connect first (see the header of this script), then" >&2
       echo "       ADB_CONNECT=<ip>:<port> npm run android:install" >&2
       "$ADB" devices >&2; exit 1 ;;
    1) ADB_DEVICE="${DEVS[0]}" ;;
    *) echo "error: several phones attached; pick one with ADB_DEVICE=<serial>:" >&2
       "$ADB" devices -l >&2; exit 1 ;;
  esac
fi
MODEL="$("$ADB" -s "$ADB_DEVICE" shell getprop ro.product.model 2>/dev/null | tr -d '\r' || echo '?')"
BEFORE="$("$ADB" -s "$ADB_DEVICE" shell dumpsys package "$PKG" 2>/dev/null | sed -n 's/.*versionName=\([^ ]*\).*/\1/p' | head -1 | tr -d '\r')"
echo "==> phone: $ADB_DEVICE ($MODEL), installed HUD: ${BEFORE:-none}"

# --- build (or take the apk given) --------------------------------------------------------------
if [ -z "${APK:-}" ]; then
  OUT="${APK_OUT_DIR:-${TMPDIR:-/tmp}/brx-apk}"
  APK_OUT_DIR="$OUT" APK_PUBLISH=0 ./scripts/android-apk.sh
  APK="$(ls -t "$OUT"/*.apk | head -1)"
fi
[ -f "$APK" ] || { echo "error: no apk at $APK" >&2; exit 1; }

# --- install + launch ---------------------------------------------------------------------------
echo "==> installing $(basename "$APK") on $ADB_DEVICE"
if ! "$ADB" -s "$ADB_DEVICE" install -r "$APK"; then
  echo >&2
  echo "install failed. If it said INSTALL_FAILED_UPDATE_INCOMPATIBLE the phone's build was signed by" >&2
  echo "another machine's debug key: copy that machine's ~/.android/debug.keystore here, or" >&2
  echo "  $ADB -s $ADB_DEVICE uninstall $PKG    # loses the app's data" >&2
  exit 1
fi
AFTER="$("$ADB" -s "$ADB_DEVICE" shell dumpsys package "$PKG" | sed -n 's/.*versionName=\([^ ]*\).*/\1/p' | head -1 | tr -d '\r')"
ACT="$("$ADB" -s "$ADB_DEVICE" shell cmd package resolve-activity --brief "$PKG" 2>/dev/null | tail -1 | tr -d '\r')"
[ -n "$ACT" ] || ACT="$PKG/.MainActivity"
"$ADB" -s "$ADB_DEVICE" shell am force-stop "$PKG"
"$ADB" -s "$ADB_DEVICE" shell am start -n "$ACT" >/dev/null
echo "==> $MODEL now runs HUD $AFTER (was ${BEFORE:-none}); launched $ACT"
