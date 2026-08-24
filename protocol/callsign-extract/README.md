# Callsign APK teardown — findings

Static analysis of the official **Callsign** app (`com.lasertagpro.callsign`), pulled from
Tony's Android phone 2026-08-23. **We mine knowledge (id lists, config schemas, architecture),
never ship Battle Company's assets.** The APK itself is NOT committed.

## What the app is

- **Unity / IL2CPP** game (C# compiled to native ARM in `libil2cpp.so`, ~67 MB; symbols/strings
  in `global-metadata.dat`, ~11 MB). An Android build exists but has never worked for Tony —
  consistent with its "iOS-only" reputation; we only need it as a static artifact.
- Config data ships as JSON in `assets/Configs/` (extracted here) plus data baked into the
  IL2CPP metadata and/or fetched from the server.

## Wins

- **`sound-bank.md` — the complete 2166-id sound inventory** (with durations), from
  `Sounds.json`. This is the deliverable the architecture doc §5 asked for, and it kills the
  microphone-sweep dead end (experiment-log #7): any id not in the list is invalid, so no
  fallback-sound ambiguity. IDs are the app's own names — the protocol uses them directly.
- **`config-facts.md`** — restated (not copied) facts from the app's config JSONs: weapon
  category ids 0–12, the post-game medal set and the stats it implies, and killstreak
  rewards. Per repo policy (`docs/apk-investigation.md`) we do not commit the raw assets.

## Architecture confirmations (from metadata strings)

- **The phone-to-phone lobby is AWS SQS/SNS.** Many `SendMessageAsync`/`GetQueueUrlAsync`/
  `ListSubscriptionsByTopicAsync` strings — the ~1-minute lobby delay noted in the field
  tests is a cloud round-trip, not BLE. (The whole multiplayer coordination layer is
  Amazon-hosted; a self-hosted platform replaces this with the local MQTT bus.)
- **The app drives respawn** — `AUTO RESPAWN IN {0}` string present. Corroborates the
  experiment-log finding that respawn/clock live in the app, not the gun.
- **The app can play offline** — `"Are you sure play offline game without connected players?"`
- **Version gate strings** — `"Application is outdated. Please update. Compatible version
  starts from {0}"` confirms the soft upper-bound version check.

## Not recovered here (needs deeper work)

- **`$GSET`/`$PSET`/`$WEAP` command builders.** Assembled at runtime in IL2CPP native code —
  no grep-able format template. Recovering them needs **Il2CppDumper** (reconstruct the C#
  structure from `libil2cpp.so` + `global-metadata.dat`) then Ghidra on the builder methods.
  This is the highest-value next teardown step — it would give the token maps directly,
  without differential BLE captures. Tracked as a followup.
- **Weapon/character stat tables** — not in the JSON assets; likely in metadata or
  server-fetched. The manual's stock stats (docs/reference/brx-manual-notes.md) remain the
  anchor set meanwhile.

## Reproduce

```
adb connect <phone>            # wireless debugging (USB data was dead on Tony's cable)
adb shell pm path com.lasertagpro.callsign
adb pull <base.apk path>
unzip -o base.apk 'assets/Configs/*' -d extracted
# native logic: unzip split_config.arm64_v8a.apk 'lib/*/libil2cpp.so'; metadata in base
```
