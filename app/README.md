# BRX Combat HUD — the per-player node app

One codebase → **Android + iOS**, one phone driving **one** BRX tagger over native BLE
([Capacitor](https://capacitorjs.com/) + [`@capacitor-community/bluetooth-le`](https://github.com/capacitor-community/bluetooth-le))
and reporting to **Mission Control** over the field Wi‑Fi. This is the *node* from
[`docs/spec/node.md`](../docs/spec/node.md) (contracts A6): the game engine, the **Phone HUD v2**
(landscape, rail-mounted), and the M‑NET wire.

**Why native, not a web app:** iOS has no Web Bluetooth, and Android Chrome needs `chrome://flags`
that never stick. See [`../docs/adr/0001-companion-rider-architecture.md`](../docs/adr/0001-companion-rider-architecture.md).

## Shape

```
src/engine.js        DOM/BLE-free state machine (node.md §3): lifecycle, frames→facts, §3.10 resync
src/brxlink.js       the seed's hardware-proven BLE plumbing behind a thin interface
src/transport/       the M-NET client (Transport) — owned by a separate lane; see its README
src/hud/hud.js       the Phone HUD v2 renderer (a pure function of engine state)
src/app.js           composition: engine + brxlink + transport + hud + Capacitor plugins
src/demo.js          ?demo — a scripted fake gun + fake MC for desktop-browser development
www/index.html       the holo-theme CSS + #frame stage (design brief: docs/spec/design/phone-hud.md; the 2026-08-25 export is archived at docs/archive/design/hud-export/)
```

## Run it

```bash
npm ci && npm run build                 # bundle src/app.js -> www/app.js (esbuild)
# desktop browser, no hardware, no server: open www/index.html?demo (scripted match)
python3 -m http.server -d www 8080      # then http://localhost:8080/?demo
```

Against a **real Mission Control** (see `mcp/brx_mcp/mc`): run `python -m brx_mcp.mc --demo`, note the
`ws://<ip>:8766/ws` it prints, connect a gun in the app, then type/scan that address on the CONNECTED
screen. The MC screen also shows a QR of the same URL. The Python reference node is
`mcp/brx_mcp/mc/mock_node.py`; a real `FrameBundle` to develop against is
`mcp/brx_mcp/mc/golden_bundle.json`.

## Tests

```bash
node --test test/engine.test.mjs        # engine (node.md §3, A6)
node --test test/transport.test.mjs     # the wire (needs ../.venv for the integration test)
node --test test/beacon.test.mjs        # the utility-item advert codec + presence
npm run ui:screens                      # screen truth: what a person sees, per state (tools/README.md)
```

**Reviewing or changing a screen?** Start `npm run ui:stage`, jump to the state, and add a `screens.mjs` step
that fails before the fix (see `docs/hud-review-2026-09-03.md` for how the last review was run).

(Run the two files separately — each integration test spins up a server, so a single
`node --test test/` can clash on resources.)

## Field-LAN gates (net.md §8b)

`scripts/ios-setup.sh` / `scripts/android-setup.sh` apply the settings the LAN path needs and that a
regenerated platform would wipe: iOS Local-Network + Bonjour + ATS local networking + `bluetooth-central`
background mode + landscape; Android cleartext + Wi‑Fi/network-state + foreground-service + landscape.
The BLE-without-location fix is there too. **These are not optional** — without them `ws://` to a
private IP silently never opens, or a BLE scan returns nothing.

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
npm run android:apk     # build the APK the public site hands out (-> webapp/download/)
npm run sync            # build + sync every platform already added

npm run ui:stage        # the STAGE harness: the real HUD + the utility screen in a phone frame, every state,
                        #   an event panel (fire / hit / death / respawn / reload / switch / kill / alerts…) → http://localhost:4190/
npm run ui:screens      # the screen-truth suite (tools/screens.mjs): every reviewed screen state at two widths
npm run ui:moments      # the transient-moment suite; npm run ui:e2e = the full browser suite against a real MC
```

### Publishing the Android build

`npm run android:apk` is the build half of the release (the site rebuild below is the other half,
and is not optional): it finds a JDK 21, re-applies `android-setup.sh`
(the platform is generated, so those patches are not in git), builds a **debug** APK, and copies it
to `../webapp/download/brx-companion-<version>-android-debug.apk`, deleting any older APK there. That
copy is **git-ignored**: it exists so the site build can read the real bytes on the machine that cut it.
Exactly one APK lives in that folder: the site build refuses to guess between two. It then
**publishes the APK as a GitHub Release asset** (tag `app-v<version>`) and writes that asset's URL
into `build.json`. Set `APK_PUBLISH=0` to skip the release; a missing or unauthenticated `gh` only
warns, so a build always completes offline.

**What lands in the APK is your working tree, not the last commit** — `npm run build` bundles `src/`
as it is right now. So before cutting a build meant for the site: commit or stash `app/src`, and bump
`package.json` if the version should change. The script prints a WARNING listing every uncommitted
`app/` file it just baked in, and records `git` (short SHA) + `dirty` in `build.json` so a published
APK is traceable to a tree. Heed the warning; it is the difference between publishing a
reviewed build and publishing whatever another session had half-written.

Just want an APK to install locally, without touching the site? Send it somewhere else:

```bash
APK_OUT_DIR=/tmp/brx-apk npm run android:apk    # same build, webapp/download/ untouched
```

Then rebuild + test the site and commit, because **a push to `main` deploys `webapp/`**:

```bash
cd ../site && npm run build && npm test      # /download renders the new version off the sidecar
git add webapp/download/build.json app && git commit -m "cut <version>" && git push
```

Name the paths. A bare `git add -A` here will sweep up whatever another session has in flight (this
repo often has two running), and `webapp/download/` is the one place where that publishes a binary.

**Where a build belongs: the Release, not git.** A committed APK cost ~5 MB of git history per
release that nothing short of a rewrite gets back; a purge on 2026-09-07 reclaimed ~80 MB of
accumulated binaries, most of it old APK builds. Since then the APK is **git-ignored** and every cut
is published to the `app-v<version>` GitHub Release, which the download page links.

One consequence while the repo is **private**: a release asset is not downloadable by an anonymous
visitor, so the public page's download button only works for someone with repo access. That is a
deliberate trade (the maintainer is the only consumer today) and it resolves itself the moment the
repo goes public, with no edit: the URL does not change, it just starts working for everyone.

**How the site and this script meet** (three rules, all enforced by the site build):

- `webapp/download/build.json` is a **committed artifact**, not generated. `site/build.mjs` neither
  writes nor sweeps it (`PROTECTED`), so it survives a site rebuild. The **APK beside it is not
  committed** (`.gitignore`); the page links the Release asset instead, so Cloudflare has nothing to
  upload but the sidecar.
- **Exactly one `.apk`** in that folder. Two, and the site build fails ("keep exactly one") rather
  than guessing which one the page should link.
- `build.json` beside it records the **build date** plus `git`/`dirty` provenance (the date is
  unrecoverable from the APK: a checkout rewrites the mtime and the zip entries are normalised to
  1981). `built` describes the *bytes*, so a rebuild that produces an identical APK keeps the
  original date. The generator trusts the sidecar only while its `file` + `sha256` still match the
  APK, and fails the build if they drift. This script writes it; never hand-edit it.

The page itself is `docs/platform/download.md` (`/download`, since the 2026-09-11 site refactor). Its
```data download``` fence renders the Android card (version, size, SHA-256, build date, APK link)
straight off the sidecar, so a new cut needs no page edit; the root landing's "Get it" card reads the
same file. `webapp/download/build.json` is still the sidecar the release
tooling writes and `mcp/tests/test_published_build.py` still checks (git provenance, branch, sidecar
freshness); it just is not rendered into a name/size/date/sha256 table on the site anymore.

The build is debug-signed. It sideloads fine, but a future release-signed build will **not**
upgrade over it, and anyone who installed the debug build has to uninstall first. It is also
`android:debuggable="true"`, so anything attached over USB debugging can read the app's data, and it
is signed with `~/.android/debug.keystore` — a key unique to whichever machine built it, so two
people building the same commit get different bytes and different checksums. When we want real
updates in place (and none of the above), add a keystore and switch this script to `assembleRelease`
(FOLLOWUPS B21). `*.jks`, `*.keystore` and `keystore.properties` are git-ignored already.

**Version:** `android-setup.sh` stamps `versionName` from `package.json` and derives `versionCode`
from it (`0.1.0` -> `100`). Bump `package.json` before cutting a build, or every build claims to be
the same version. Capacitor's own placeholder is `1.0` / `1`, which is why this is stamped.

**Requirements:** JDK 21 (Capacitor 8 refuses 17 with *"invalid source release: 21"*) and the
Android SDK. `minSdk` is **24 (Android 7.0)**; `targetSdk` is 36 (both live in the generated
`android/variables.gradle`, so check them there after a Capacitor bump rather than trusting this
line). Gradle finds the SDK through `android/local.properties`, which is generated and git-ignored:
on a fresh clone export `ANDROID_HOME=~/Android/Sdk` (or wherever yours is) before the first build,
or gradle stops with *"SDK location not found"*.

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
- **Never let a Capacitor plugin proxy be a promise's resolution value.** Plugin objects are proxies with
  a fake `then`, so `await somethingThatResolvesWith(Plugin)` calls `proxy.then()` and never settles. One
  such line hung the whole boot on device and web (keep-awake, app-state listener, auto-scan, camera and
  demo mode all silently dead) on 2026-08-26. Box the plugin (`{v: Plugin}`) instead. The `?demo` page
  reaching phase `connected` is the regression canary.
