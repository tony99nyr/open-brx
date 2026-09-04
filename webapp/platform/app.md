# Get the app
_The Android test build of the phone HUD: one phone, one gun, over Bluetooth._
Last verified: 2026-08-27

## This is a test build, not a release.
The BRX Combat HUD is still being built, and what is below is a **debug build**. It sideloads and runs, but it is signed with Android's throwaway debug key, so a future release-signed build will not install over it (uninstall first). It is also **debuggable**, which is what `debug` means to Android: anything attached over USB debugging can inspect it and read its data. Fine on your own phone at the bench; a reason not to hand this build to a stranger. It never touches the tagger's firmware: everything it does goes over the documented Bluetooth serial protocol, and a power-cycle restores any gun.
Source: app/README.md, CLAUDE.md §Hard rules

## BRX Combat HUD for Android
One phone drives one BRX tagger over native Bluetooth LE, runs the match loop (spawn, ammo, lives, respawn clock) and reports to Mission Control over the field Wi-Fi. On the phone it installs as **BRX Companion**.
Download: https://open-brx.iamrossi.workers.dev/download/brx-companion-0.1.2-android-debug.apk (5.3 MB, version 0.1.2, built 2026-09-04, sha256 d924fc583d4e234a995db78e1e1407d6e86d470a165002b56ad63d9fc304575e)

Source: app/README.md, docs/spec/node.md §3

## What is already proven on real guns.
On 2026-08-25 this app, built from this codebase, passed every core gate on a bench tagger over native Bluetooth: connect, stream trigger and ammo frames, speak (`$VOL` + `$PLAY`), green the sight (`$SFLASH`), push a full config and arm a game (the gun counted 3-2-1 and went live), and hold a link for 5+ minutes with no drops. Later that night a phone talked to Mission Control and an MC-pushed kit-out fired the real gun. What is *not* finished is the game and HUD layer around that. ✅ (BLE path) / 🚧 (app)
Source: docs/experiment-log.md 2026-08-25 "NATIVE app validated on hardware", docs/adr/0001-companion-rider-architecture.md

## Install it
1. **Get the APK onto the phone.** Tap the download button above on the phone itself, or download on a computer and copy the file across. Any transfer works.
2. **Open the file and allow the install.** Android asks whether the app doing the opening (your browser or file manager) may install apps. Allow it, then confirm. This is the normal prompt for any app that does not come from the Play Store, and you can switch the permission back off afterwards.
3. **Expect one scary-looking prompt.** Play Protect warns about any app it has not seen before and offers to send it for scanning. Choosing "install anyway" is the normal path for a sideload. 🚧
4. **Launch it and grant "Nearby devices".** That is the Bluetooth permission. On **Android 12 and newer** that is all you need: the scan is flagged `neverForLocation`, so it finds guns with the system Location toggle off. On **Android 7 to 11** the system has no such flag, so the app asks for Location as well **and the Location toggle has to be on**, or the gun list stays empty. We do not use your location either way. ✅
5. **Pick your gun.** Turn the tagger **and its headset** on: a gun whose headset is off or unpaired is silent over Bluetooth and never appears, which looks exactly like a broken app. A headset that is slow-blinking rainbow has not paired yet. Then the tagger appears in the list by name. ✅ Connecting proves the link: the app can speak through the gun and flash its sight.
6. **Optional, and needed for a scored match: point it at Mission Control.** Start MC on the laptop (`python -m brx_mcp.mc`), then scan the QR it shows or type the `ws://<ip>:8766/ws` address on the app's CONNECTED screen. 🚧
Source: app/README.md, app/scripts/android-setup.sh, mcp/brx_mcp/mc/API.md

## What it needs
- **Android**: 7.0 (API 24) or newer. There is no Play Store listing; this is a sideload.
- **A tagger**: BRX gen 2/3 (Bluetooth LE). Gen 1 uses Bluetooth Classic serial and is not supported.
- **Permissions**: Nearby devices (Bluetooth) to reach the gun. Camera, for the Mission Control QR scan and the optional CAM look-through in the HUD. **Location** is needed only on Android 7 to 11 (see the install steps); on 12 and newer the scan is flagged `neverForLocation` and works with Location off. Either way the app never reads your position.
- **Wi-Fi**: only to reach Mission Control, and only if you are running a hosted match. The field LAN is a laptop and a travel router with no internet behind it.
- **What it does on that Wi-Fi**: to find Mission Control it listens for its mDNS advert, and if that is blocked (many routers filter multicast) it probes the usual home ranges (`192.168.0/1/86.x`, `10.0.0.x`, `172.20.10.x`) on port 8765 until something answers as MC. That scan stops the moment it binds, and it is the only thing the app sends anywhere. Nothing leaves the LAN: no cloud, no account, no telemetry. 🚧
- **Screen**: landscape, mounted on the rail. The app locks the orientation itself.
📐 (the Android floor is the build's `minSdk`, not a tested device matrix) / ✅ (the permissions are read from the shipped manifest)
Source: app/README.md, app/scripts/android-setup.sh, docs/adr/0002-laptop-mission-control-host.md

## Field rule the bench taught us.
Locking the phone, pulling down the notification shade or switching apps suspends the web view and drops the Mission Control socket (it reconnects within about 10 seconds once the app is in front again). Keep the phone mounted, awake, in the foreground and on Do Not Disturb. The app's keep-awake stops auto-lock only, it cannot stop you.
Source: docs/experiment-log.md 2026-08-25 (night) §3.11

## On an iPhone?
There is no download. iOS is first-class in the code (the same codebase ran on an iPhone X against real taggers), but Apple has no sideload-a-file path: you build it yourself with Xcode and a free Apple ID, which gives a 7-day on-device build. `app/README.md` has the steps. ✅ (it runs) / 🚧 (no distribution)
Source: app/README.md §Prerequisites, docs/adr/0003-native-app-over-web-bluetooth.md

## Prefer to build it yourself?
`git clone`, then `npm ci && npm run android:apk` in `app/` builds the same app from the same source (JDK 21 and the Android SDK required). It will **not** be byte-identical to the file above: Android signs a debug build with a keystore unique to the machine that built it, so your checksum will differ. The SHA-256 on this page is there to tell you the download arrived intact, not to prove where it came from. The whole project is MIT.
Source: app/README.md, app/scripts/android-apk.sh
