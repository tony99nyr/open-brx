# Callsign APK teardown — findings

Static analysis of the official **Callsign** app (`com.lasertagpro.callsign`), pulled from
Tony's Android phone 2026-08-23. **We mine knowledge (id lists, config schemas, architecture),
never ship Battle Company's assets.** The APK itself is NOT committed.

## What the app is

- **Unity / IL2CPP** game (C# compiled to native ARM in `libil2cpp.so`, ~67 MB; symbols/strings
  in `global-metadata.dat`, ~11 MB). An Android build exists but has never worked for Tony —
  consistent with its "iOS-only" reputation; we only need it as a static artifact.
- Config data ships as JSON in `assets/Configs/` (extracted, mined for facts, never committed —
  see `RAW_ASSETS_NOTE.md`) plus data baked into the IL2CPP metadata and/or fetched from the
  server.

## Wins

- **`sound-bank.md` — the complete 2166-id sound inventory** (with durations), from
  `Sounds.json`. This is the deliverable the architecture doc §5 asked for, and it kills the
  microphone-sweep dead end (experiment-log #7): any id not in the list is invalid, so no
  fallback-sound ambiguity. IDs are the app's own names — the protocol uses them directly. The
  raw `Sounds.json` id → duration map is restated as `mcp/brx_mcp/data/sound_ids.json`
  (`RAW_ASSETS_NOTE.md`).
- **`config-facts.md`** — restated (not copied) facts from the app's config JSONs: weapon
  category ids 0–12, the post-game medal set and the stats it implies, and killstreak
  rewards. Per repo policy (`RAW_ASSETS_NOTE.md`) the raw assets are never committed; the full
  medal set is restated as `mcp/brx_mcp/data/medals.json`.

## Architecture confirmations (from metadata strings)

- **The phone-to-phone lobby is AWS SQS/SNS.** Many `SendMessageAsync`/`GetQueueUrlAsync`/
  `ListSubscriptionsByTopicAsync` strings — the ~1-minute lobby delay noted in the field
  tests is a cloud round-trip, not BLE. (The whole multiplayer coordination layer is
  Amazon-hosted; a self-hosted platform replaces this with the local LAN (WebSocket, `docs/spec/contracts.md` §5).)
- **The app drives respawn** — `AUTO RESPAWN IN {0}` string present. Corroborates the
  experiment-log finding that respawn/clock live in the app, not the gun.
- **The app can play offline** — `"Are you sure play offline game without connected players?"`
- **Version gate strings** — `"Application is outdated. Please update. Compatible version
  starts from {0}"` confirms the soft upper-bound version check.

## Recovered later (this section is superseded)

The `$GSET`/`$PSET`/`$WEAP` command **field maps were recovered** in a follow-up pass — the
metadata's index tables are obfuscated, but the identifier strings are plaintext **in declaration
order**, which is the token map. See **`protocol-classes.md`** (GSET hardware-confirmed, WEAP token
positions cross-validated against two live frames) and experiment-log #24–30. Il2CppDumper/
Il2CppInspector still fail on the obfuscated metadata (v39 + encrypted tables), and a full
method-body decompile (Ghidra) is only needed to pin the last ~6 always-empty `$WEAP` tokens —
low priority, since declaration order is already validated against live frames.

- **Weapon/character stat tables** — still NOT in the JSON assets; likely in metadata field-default
  data or server-fetched. The manual's stock stats (`docs/reference/brx-manual-notes.md`) remain the
  anchor set.

## Reproduce

```
adb connect <phone>            # wireless debugging (USB data was dead on Tony's cable)
adb shell pm path com.lasertagpro.callsign
adb pull <base.apk path>
unzip -o base.apk 'assets/Configs/*' -d extracted
# native logic: unzip split_config.arm64_v8a.apk 'lib/*/libil2cpp.so'; metadata in base
```
