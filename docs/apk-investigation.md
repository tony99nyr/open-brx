# Callsign APK investigation — the highest-leverage desk work available

**Status:** proposed, not started (2026-08-23). **Windows-friendly** — no hardware, no
taggers, no iOS captures. Can be done entirely offline.

## Why this is bigger than "get the sound list"

It has been filed under *sound inventory* in the other docs, which undersells it badly.

**The app builds the protocol frames.** It takes a user's menu choices — game mode, respawn
time, score limit, weapon — and constructs `$GSET,...`, `$PSET,...`, `$WEAP,...`. So its
code contains **the meaning of every token in those frames.** That is the field-map work we
have been reverse-engineering two captures at a time, sitting in a decompiled source tree.

Captures only ever show us *one* configuration. The app's source shows the *whole space*.

### What it could plausibly answer, in one pass

| Question | Currently |
|---|---|
| `$GSET`'s 8 tokens | **completely unknown** — three captures produced identical frames |
| `$WEAP`'s 44 tokens | unknown; the manual's stock stats are our only anchors |
| `$PSET`'s trailing audio tokens | suspected positional voice pack, unverified |
| The complete sound-id list | unknown; the microphone sweep failed its negative control |
| Every `$` command the app knows | we have ~35, LaserTagMods reference ~8 more, there may be others |
| Where respawn/game time actually live | §7n proved they are **not** sent to the gun — the app keeps them. Its code shows how |
| Whether any results-query exists | §7n found none in a capture; source would be definitive |
| The version-gate logic | why "supported until v2.01e", and whether it is bypassable |
| Game-mode definitions | Battle Royale, Battle Lines, Faction Wars, Infection — never captured |

Several of those are otherwise **blocked on the MacBook** (captures need iOS + PacketLogger).
This route needs neither.

## The catch that makes it counterintuitive

**Callsign has never worked on Android with these taggers.** That does not matter here — we
are reading the app's *code*, not running it. The Android build still contains the same
protocol logic as the iOS one. A broken app is a perfectly good specification.

## How to do it

1. **Obtain the APK.** From a device that has it installed (`adb shell pm path
   com.lasertagpro.callsign` then `adb pull`), which is the cleanest provenance.
2. **Decompile.**
   - `jadx` / `jadx-gui` → readable Java from the DEX. Start here.
   - `apktool d` → resources, assets, and any bundled sound files or id tables.
3. **Search for the protocol.** Grep the decompiled tree for `"$GSET"`, `"$WEAP"`, `"$PSET"`,
   `"$SPAWN"`, `"$AMMO"`, `$` format strings, and the sound ids we know (`VA20`, `VA81`,
   `R18`, `H29`). The frame builders are wherever those literals are concatenated.
4. **Check `assets/` and `res/raw/`** for a sound manifest — the id list may simply be a
   file rather than something to infer.

## Rules for what we do with it

Same standard already applied to LaserTagMods' unlicensed sources (see `protocol/`
credits): **document facts, never copy code.**

- Protocol facts — token meanings, id lists, command vocabulary — are **not copyrightable**
  and belong in `protocol/brx-protocol.md`, restated in our own words.
- **Do not** copy decompiled source, resources, or assets into this repo. It is Battle
  Company's code, and this project is going public under MIT.
- **Do not** commit the APK or any decompiled tree. Work in a scratch directory.
- Reverse engineering for **interoperability** is the purpose here; keep it to that.

## Suggested order of attack

1. `$GSET` token map — unblocks the game-settings work that captures cannot reach.
2. Sound id list — kills the sound-inventory problem outright.
3. `$WEAP` token map — unlocks custom weapons.
4. End-of-game / results logic — settles §7n's remaining ambiguity definitively.
5. Command vocabulary diff against `protocol/brx-protocol.md` §3/§4 and §7d.

Log findings to `docs/experiment-log.md` like any other experiment, and fold confirmed
protocol facts into `protocol/brx-protocol.md` with a note that they came from the APK
rather than from the wire — **source-derived facts should be marked as unverified on
hardware until a capture or a live test confirms them.**
