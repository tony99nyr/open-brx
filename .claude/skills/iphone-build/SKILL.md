---
name: iphone-build
description: Build the Open BRX phone app from main on the MacBook and install it on a paired iPhone (a development install, not TestFlight). Use whenever a session runs on the MacBook and Tony says "build the app for the iPhone", "put the latest build on the iPhone", "iOS build", "ios:push", or a bench needs the iPhone X on the current main.
---

# iPhone build (MacBook)

The agent runs the commands. Tony handles the phone and anything that asks for a password or a tap.
The human reference is `app/README.md` → *Getting a build onto an iPhone* and *Running on a real
iPhone*. This skill is the short agent path through them. Do not duplicate those sections here; fix
them there.

## Before you start

- This works only on macOS with full Xcode. Check with `xcode-select -p`: the path must end in
  `Xcode.app/Contents/Developer`. If it names CommandLineTools, stop and ask Tony to run
  `! sudo xcode-select -s /Applications/Xcode.app/Contents/Developer` (sudo is his, not yours).
- Read `docs/mac-dev-runbook.md` §1 if this Mac has never built the app.
- Do not execute `setup-mac.sh`, `start.sh` or any other setup script unless Tony asks. A reviewer
  once ran one and overwrote `~/.zshrc`.
- Build from a clean main. `ios:push` bakes the **working tree** and marks it `-dirty`.

## Steps

1. Get main:
   `git status --porcelain` (must be empty, or stop and ask), then `git switch main && git pull --ff-only`.
2. Install the app's pinned deps. `app/` is **npm**, never pnpm:
   `cd app && npm ci`
3. Regenerate the iOS platform with our settings (`app/ios/` is generated; never hand-edit it):
   `npm run ios:setup`
4. Ask Tony to confirm the phone is awake, unlocked, on the same Wi-Fi as the Mac, with
   Developer Mode on. Then list the targets without building:
   `npm run ios:push -- --list`
   If the iPhone is missing, the script names the reason. The first pairing needs a cable and
   Xcode ▸ Window ▸ Devices and Simulators: ask Tony to do it.
5. Build, install and launch (filter by the device name or UDID when more than one shows):
   `npm run ios:push -- <name-or-udid>`
   Record the short SHA the script prints.
6. Ask Tony to open the ⓘ panel on the phone and read the first LINK row back. It must show
   `<version>+<sha>` for the SHA from step 5, without `-dirty`.

## When it fails

Walk `app/README.md` → *Running on a real iPhone* in order. The ones Tony must do himself:

- **Keychain password prompt:** his Mac login password, then **Always Allow**.
- **"Developer Mode disabled":** on the phone, Settings ▸ Privacy & Security ▸ Developer Mode, then a restart.
- **Untrusted developer on first launch:** on the phone, Settings ▸ General ▸ VPN & Device Management ▸ Trust.
- **No development team:** Xcode ▸ Settings ▸ Accounts, then the App target's Signing & Capabilities.

A free Apple ID install stops launching after 7 days. Re-run step 5 to refresh it.

## Done means

The app launches on the iPhone, the ⓘ panel shows the main SHA without `-dirty`, and you tell
Tony the SHA and the iOS version the phone reports. A bench iPhone check (Bluetooth to a gun, a
match, the DEVELOPER debug toggle) belongs to the bench plan, not to this skill.
