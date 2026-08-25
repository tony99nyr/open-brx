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

# --- Bluetooth usage strings -------------------------------------------------
# iOS TERMINATES an app that touches CoreBluetooth without these. The BLE plugin
# is the entire point of this app, so a scaffold without them is broken on first
# scan — and the crash gives no hint why.
BT_MSG="Open BRX connects to your BRX tagger over Bluetooth to set up games and track hits."

set_str() {  # key, value — add or overwrite, idempotent
  $PB -c "Set :$1 $2" "$PLIST" 2>/dev/null || $PB -c "Add :$1 string $2" "$PLIST"
}

echo "==> patching $PLIST"
set_str NSBluetoothAlwaysUsageDescription "$BT_MSG"
set_str NSBluetoothPeripheralUsageDescription "$BT_MSG"   # iOS 12 and earlier

echo "==> Info.plist Bluetooth keys:"
$PB -c "Print :NSBluetoothAlwaysUsageDescription" "$PLIST"
$PB -c "Print :NSBluetoothPeripheralUsageDescription" "$PLIST"
echo "==> done. Open with: npx cap open ios   (needs full Xcode)"
