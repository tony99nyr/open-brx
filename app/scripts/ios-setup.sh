#!/usr/bin/env bash
# Add + configure the iOS platform. Safe to re-run.
#
# `ios/` is git-ignored (generated, like `android/`), so anything hand-edited in
# there is lost the next time the platform is regenerated. Every iOS setting we
# depend on therefore lives HERE, in a committed script, not in the Xcode project.
#
#   npm run ios:setup      # add the platform if missing, then apply our config
#
# Requires macOS. Capacitor 8 uses Swift Package Manager, so CocoaPods is NOT
# needed. Building/running the app additionally needs full Xcode (Command Line
# Tools alone are not enough).
set -euo pipefail
cd "$(dirname "$0")/.."

PLIST="ios/App/App/Info.plist"
PB=/usr/libexec/PlistBuddy

if [ ! -d ios ]; then
  echo "==> adding iOS platform"
  npx cap add ios
else
  echo "==> iOS platform present; syncing web assets + plugins"
  npx cap sync ios
fi

set_str() {  # key, value — add or overwrite, idempotent
  $PB -c "Set :$1 $2" "$PLIST" 2>/dev/null || $PB -c "Add :$1 string $2" "$PLIST"
}

echo "==> patching $PLIST"

# --- Bluetooth usage strings -------------------------------------------------
# iOS TERMINATES an app that touches CoreBluetooth without these. The BLE plugin
# is the entire point of this app, so a scaffold without them is broken on first
# scan — and the crash gives no hint why.
BT_MSG="Open BRX connects to your BRX tagger over Bluetooth to set up games and track hits."
set_str NSBluetoothAlwaysUsageDescription "$BT_MSG"
set_str NSBluetoothPeripheralUsageDescription "$BT_MSG"   # iOS 12 and earlier

# --- Field LAN gates (net.md §8b) --------------------------------------------
# The phone talks ws:// to Mission Control on a private IP over a Wi-Fi with NO
# INTERNET. Without these three the socket silently never opens.
#  (a) ATS does NOT exempt ws:// to an IP literal → allow local networking.
#  (b) iOS 14+ Local Network privacy → the usage string + the Bonjour service, or
#      the app is blocked from the LAN and from browsing mDNS with no prompt.
LN_MSG="Open BRX finds and talks to the Mission Control host on your local game Wi-Fi."
set_str NSLocalNetworkUsageDescription "$LN_MSG"
$PB -c "Add :NSAppTransportSecurity dict" "$PLIST" 2>/dev/null || true
$PB -c "Set :NSAppTransportSecurity:NSAllowsLocalNetworking true" "$PLIST" 2>/dev/null \
  || $PB -c "Add :NSAppTransportSecurity:NSAllowsLocalNetworking bool true" "$PLIST"
$PB -c "Delete :NSBonjourServices" "$PLIST" 2>/dev/null || true
$PB -c "Add :NSBonjourServices array" "$PLIST"
$PB -c "Add :NSBonjourServices:0 string _openbrx._tcp" "$PLIST"

# --- Background BLE so the link survives a screen lock (node.md §3.11) --------
# NOTE: this keeps CoreBluetooth delivering while backgrounded, but the WebView's
# JS still freezes — the engine reconciles on resume. Foreground+mounted is the plan.
$PB -c "Delete :UIBackgroundModes" "$PLIST" 2>/dev/null || true
$PB -c "Add :UIBackgroundModes array" "$PLIST"
$PB -c "Add :UIBackgroundModes:0 string bluetooth-central" "$PLIST"

# --- Landscape, rail-mounted -------------------------------------------------
$PB -c "Delete :UISupportedInterfaceOrientations" "$PLIST" 2>/dev/null || true
$PB -c "Add :UISupportedInterfaceOrientations array" "$PLIST"
$PB -c "Add :UISupportedInterfaceOrientations:0 string UIInterfaceOrientationLandscapeRight" "$PLIST"
$PB -c "Add :UISupportedInterfaceOrientations:1 string UIInterfaceOrientationLandscapeLeft" "$PLIST"

echo "==> Info.plist keys now set:"
for k in NSBluetoothAlwaysUsageDescription NSLocalNetworkUsageDescription \
         NSAppTransportSecurity:NSAllowsLocalNetworking NSBonjourServices:0 UIBackgroundModes:0; do
  printf '   %s = ' "$k"; $PB -c "Print :$k" "$PLIST"
done
echo "==> done. Open with: npx cap open ios   (needs full Xcode)"
