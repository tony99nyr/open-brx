# BRX Companion — native phone app

One codebase → **Android + iOS**, talking to a BRX tagger over **native BLE**
([Capacitor](https://capacitorjs.com/) + [`@capacitor-community/bluetooth-le`](https://github.com/capacitor-community/bluetooth-le)).

**Why native and not a web app:** Web Bluetooth is a dead end for this. iOS has no Web Bluetooth at
all, and on the Android we tested Chrome reported *"Web Bluetooth globally disabled"* and needed
`chrome://flags` wrangling that never stuck — unusable for players. The browser build
(`../webapp/ble-test.html`) is kept as a **dev/test harness only**. See
[`../docs/adr/0001-companion-rider-architecture.md`](../docs/adr/0001-companion-rider-architecture.md).

## Prerequisites

**Everyone:** [Node.js](https://nodejs.org/) 20+ (`brew install node`, or nvm). That's all you need
to build the web bundle.

**To build for iOS** — macOS only:
- **Full Xcode** from the App Store. Command Line Tools alone are *not* enough — `xcodebuild`
  will refuse with *"requires Xcode, but active developer directory is a command line tools
  instance"*. Xcode is a ~15 GB install.
- An Apple ID for signing. A **free** one works and gives 7-day on-device builds, which is fine for
  testing; only App Store distribution needs the paid developer account.
- **CocoaPods is NOT required.** Capacitor 8 wires plugins through Swift Package Manager
  (`ios/App/CapApp-SPM/Package.swift`). Older Capacitor guides telling you to `pod install` do not
  apply here.

**To build for Android:**
- **JDK 21** (Capacitor 8 requires it) and the Android SDK — easiest via
  [Android Studio](https://developer.android.com/studio).

## Commands

```bash
npm ci                  # install exactly what the lockfile pins
npm run build           # bundle src/app.js -> www/app.js  (esbuild)

npm run ios:setup       # build, add the iOS platform if missing, apply our iOS config
npm run ios:open        # open the project in Xcode  (needs full Xcode)

npm run android:setup   # build, add the Android platform if missing, sync
npm run sync            # build + sync every platform already added
```

### Running on a real iPhone

Xcode's own error messages don't explain most of these, so in order:

1. **Xcode ▸ Settings ▸ Accounts** → **+** → add your Apple ID.
2. Select the **App** *target* (under TARGETS — the blue project row above it has no signing
   editor), **Signing & Capabilities** → tick **Automatically manage signing** → pick your team.
   *"Signing for App requires a development team"* persists until you explicitly choose it.
3. If the **bundle identifier** is rejected as unavailable, change `appId` in
   `capacitor.config.json` and re-run `npm run ios:setup` — free accounts need a globally unique
   id, and editing it in Xcode alone is wiped when the platform regenerates.
4. **macOS asks for a keychain password** during signing. It wants your **Mac login password**
   (not your Apple ID) — `codesign` is reading the private key Xcode just created. Choose
   **Always Allow** or it re-prompts on every build.
5. **iOS 16+ needs Developer Mode**, or the install fails with *"Developer Mode disabled"*. On the
   phone: **Settings ▸ Privacy & Security ▸ Developer Mode** → on → restart → confirm after reboot.
   The item only appears once an install has been attempted.
6. **First launch fails as an untrusted developer.** On the phone:
   **Settings ▸ General ▸ VPN & Device Management** → your Apple ID → **Trust**. Then Run again.

With a free Apple ID the build **expires after 7 days** and must be re-run from Xcode.

## What's generated vs. committed

Committed: `src/`, `www/index.html`, `scripts/`, `package.json`, `package-lock.json`,
`capacitor.config.json`.

**Generated and git-ignored:** `node_modules/`, `android/`, `ios/`, and **`www/app.js`**. All of it
is rebuilt by the commands above — never hand-edit anything in `ios/` or `android/` expecting it to
last, because regenerating the platform wipes it.

That last point is why **`scripts/ios-setup.sh` exists**: iOS settings we depend on have to live in
a committed script rather than in the Xcode project. Right now it applies the **Bluetooth usage
strings** (`NSBluetoothAlwaysUsageDescription`). Those are not optional — **iOS terminates an app
that touches CoreBluetooth without them**, and the crash gives no hint why. Anything else iOS-side
we come to depend on belongs in that script too.

## Notes

- `npm ci` prints a warning that **esbuild's install script was skipped** (npm 11+ blocks install
  scripts by default). It is harmless — the platform package ships the binary and the build works.
  Verified from a clean `npm ci`.
- **iOS deployment target is 15.0**, so an iPhone X (which tops out at iOS 16.7) is supported.
- The app's arm sequence in `src/app.js` mirrors `mcp/brx_mcp/gameconfig.py`. If you change the
  protocol frames, change both — the Python side is the reference implementation and has the tests.
