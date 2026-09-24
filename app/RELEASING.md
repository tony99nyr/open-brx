# Releasing the app

The steps for cutting a release-signed APK. The current cut is 0.4.7; its notes are `release-notes/app-v0.4.7.md`,
written to be pasted as the GitHub release body.

## App 0.4.7 cut checklist

Tony gives the go; nothing below publishes until then. For the next cut, change every version below.

## Before the go

1. Wait for the last feature for this cut to land on `main`.
2. For a dry run, set `APK_OUT_DIR` (`APK_OUT_DIR=/tmp/apk-dry npm run android:release`): the build writes
   the APK and `build.json` there instead of `webapp/download/`, which the site reads. A dry run from an
   uncommitted tree stamps `0.4.7+<sha>-dirty`, so the APK you publish must come from step 5.
3. Check the signature. Print the fingerprint only; never the keystore, its password or its properties file:
   `apksigner verify --print-certs app/android/app/build/outputs/apk/release/app-release.apk`
   - Release key: `16d3f5ab…0697e4`. The debug key is `691cb028…b76a7f`. The release APK must show the first.
   - `aapt2 dump badging` must show `versionName='0.4.7'`, `versionCode='407'`.

## On the go (Tony)

4. On a tree rebased onto `origin/main`, commit the version bump, `RELEASING.md` and the release notes.
5. Run `cd app && npm run android:release`. It builds the signed APK, copies it to `webapp/download/` as
   `brx-companion-0.4.7-android-release.apk` and writes `webapp/download/build.json` for it (`variant`
   "release", its bytes and sha256, the commit it built from, the `app-v0.4.7` asset URL). It publishes
   nothing. Repeat step 3 on this APK; the stamp must read `0.4.7+<sha>` with no `-dirty`, and the
   sidecar must say `"dirty": false`.
6. Install it on one bench Pixel, following the tester steps below, and bind it to a Mission Control from `main`.
7. Commit `webapp/download/build.json` on top, then push, then **publish at once**: the release `app-v0.4.7`
   with `webapp/download/brx-companion-0.4.7-android-release.apk` and `release-notes/app-v0.4.7.md` as its
   body. Until the release exists, the download page's link 404s.

## Every tester coming from 0.4.5 or earlier, once

Builds before 0.4.6 were signed with a test key, and Android refuses an update across different keys.
From 0.4.6 on, a new release installs over the old one.

1. **Uninstall** "BRX Combat HUD" (long-press the icon, then Uninstall). Uninstalling clears the app's saved
   settings, so the player rejoins the game Wi-Fi's Mission Control once, which is the normal join.
2. Install `app-v0.4.7` from the releases page. Allow "install unknown apps" for the browser if Android asks.
3. Open it once and grant Bluetooth and Nearby devices when asked.

## If install fails

- **"App not installed" or "conflicts with an existing package"**: the old build is still there, perhaps
  under a work profile or a second user. Uninstall it there too, then install again.
- **"Package appears to be invalid"**: the download is incomplete. Download it again.
- **Blocked by Play Protect**: tap "More details", then "Install anyway". This is a sideloaded build.
- **Still failing**: collect `adb logcat | grep -i PackageManager` from a bench laptop and send it to Tony.
  Do not ask the player to change anything else on the phone.
