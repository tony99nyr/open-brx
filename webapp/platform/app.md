# Get the app
_The Android test build of the phone HUD: one phone, one gun, over Bluetooth._
Last verified: 2026-08-27

## This is a test build, not a release.
The BRX Combat HUD is still being built, and what is below is a **debug build**. It sideloads and runs, but it is signed with Android's throwaway debug key, so a future release-signed build will not install over it (uninstall first). It never touches the tagger's firmware: everything it does goes over the documented Bluetooth serial protocol, and a power-cycle restores any gun.
Source: app/README.md, CLAUDE.md §Hard rules

## BRX Combat HUD for Android
One phone drives one BRX tagger over native Bluetooth LE, runs the match loop (spawn, ammo, lives, respawn clock) and reports to Mission Control over the field Wi-Fi. On the phone it installs as **BRX Companion**.
Download: https://open-brx.iamrossi.workers.dev/download/brx-companion-0.1.0-android-debug.apk (5.3 MB, version 0.1.0, built 2026-08-30, sha256 720eba2694550b0ac04582414e5dc3dbc1feabb87f44ef81310b8f5e7c2f3f74)


## What is already proven on real guns.
On 2026-08-25 this app, built from this codebase, passed every core gate on a bench tagger over native Bluetooth: connect, stream trigger and ammo frames, speak (`$VOL` + `$PLAY`), green the sight (`$SFLASH`), push a full config and arm a game (the gun counted 3-2-1 and went live), and hold a link for 5+ minutes with no drops. Later that night a phone talked to Mission Control and an MC-pushed kit-out fired the real gun. What is *not* finished is the game and HUD layer around that. ✅ (BLE path) / 🚧 (app)
Source: docs/experiment-log.md 2026-08-25 "NATIVE app validated on hardware", docs/adr/0001-companion-rider-architecture.md

## Install it
- **Get the APK onto the phone.** Tap the download button above on the phone itself, or download on a computer and copy the file across. Any transfer works.
- **Open the file and allow the install.** Android asks whether the app doing the opening (your browser or file manager) may install apps. Allow it, then confirm. This is the normal prompt for any app that does not come from the Play Store, and you can switch the permission back off afterwards.
- **Launch it and grant "Nearby devices".** That is the Bluetooth permission. Location is *not* required: the scan is flagged `neverForLocation`, so it works with the system Location toggle off. ✅
- **Pick your gun.** Turn the tagger on and it appears in the list by name. Connecting proves the link: the app can speak through the gun and flash its sight.
- **Optional, and needed for a scored match: point it at Mission Control.** Start MC on the laptop (`python -m brx_mcp.mc`), then scan the QR it shows or type the `ws://<ip>:8766/ws` address on the app's CONNECTED screen. 🚧
Source: app/README.md, app/scripts/android-setup.sh, mcp/brx_mcp/mc/API.md

## What it needs
- **Android**: 7.0 (API 24) or newer. There is no Play Store listing; this is a sideload.
- **A tagger**: BRX gen 2/3 (Bluetooth LE). Gen 1 uses Bluetooth Classic serial and is not supported.
- **Permissions**: Nearby devices (Bluetooth) to reach the gun. Camera only if you scan the Mission Control QR code. No Location, and no internet.
- **Wi-Fi**: only to reach Mission Control, and only if you are running a hosted match. The field LAN is a laptop and a travel router with no internet behind it.
- **Screen**: landscape, mounted on the rail. The app locks the orientation itself.
Source: app/README.md, app/scripts/android-setup.sh, docs/adr/0002-laptop-mission-control-host.md

## Field rule the bench taught us.
Locking the phone, pulling down the notification shade or switching apps suspends the web view and drops the Mission Control socket (it reconnects within about 10 seconds once the app is in front again). Keep the phone mounted, awake, in the foreground and on Do Not Disturb. The app's keep-awake stops auto-lock only, it cannot stop you.
Source: docs/experiment-log.md 2026-08-25 (night) §3.11

## On an iPhone?
There is no download. iOS is first-class in the code (the same codebase ran on an iPhone X against real taggers), but Apple has no sideload-a-file path: you build it yourself with Xcode and a free Apple ID, which gives a 7-day on-device build. `app/README.md` has the steps. ✅ (it runs) / 🚧 (no distribution)
Source: app/README.md §Prerequisites, docs/adr/0003-native-app-over-web-bluetooth.md

## Prefer to build it yourself?
`git clone`, then `npm ci && npm run android:apk` in `app/` produces exactly this file (JDK 21 and the Android SDK required). The whole project is MIT.
Source: app/README.md, app/scripts/android-apk.sh
