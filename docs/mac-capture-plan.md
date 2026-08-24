# MacBook capture plan — experiments only this machine can run

**Why this doc exists:** the MacBook is becoming the field machine and the Windows PC the
primary dev box, but **capture work can only happen here.** Callsign is **iOS-only** (it
has never worked on Android), iOS Bluetooth tracing needs **PacketLogger**, and
PacketLogger is **macOS-only**. Every "watch what the real app does" experiment is
therefore gated on this laptop.

**Status note (2026-08-23):** Experiments 1 and 2 are **done** — both returned definitive
negatives that closed the project's biggest open questions (see §7n). The current critical
path is now **the nRF radio**, which needs no captures and can be worked on Windows. What
remains here is genuinely useful but no longer blocking: `$WEAP`, per-player identity, the
`$PSET` audio tokens, and the other game modes.

Batch these. An hour with the Mac, the iPhone and two taggers unblocks months of work on
the Windows side.

## Standing setup (already done on this machine)

- **PacketLogger** at `/Applications/PacketLogger.app` (from Additional Tools for Xcode).
- **iPhone X** has Apple's Bluetooth logging profile installed and has been rebooted.
- The Mac has **no USB-A**, so the iPhone connects through a hub. It enumerates fine there.

### PRECONDITION: the headset must be paired

**With no headset, Callsign silently connects and drops the tagger, and you cannot
create a game at all** — game creation is gated on the app's top-right icon being
green and reading "connected" (§7m). This cost a large part of an evening,
presenting as random app flakiness. Verify with `QUERY` over USB (`Headset Version`,
`Head:` voltage) rather than guessing. Pairing can take up to 3 minutes.

### The capture loop

1. Plug the iPhone in. **File → New iOS Trace**, pick the phone.
2. **Confirm lines are scrolling before you touch Callsign.** ← non-negotiable
3. Do the thing in Callsign.
4. Stop the trace. **File → Export → btsnoop**, save with a descriptive name.
5. `python -m brx_mcp.btsnoop <file>` → decoded `>>` / `<<` transcript.

### Two traps that each cost us a capture

- **Export acts on the frontmost window.** With several traces open it is very easy to
  re-export an old one. Check the file size / md5 differs from the previous export.
- **A trace that is not actually recording produces a silently useless file.** If nothing
  scrolls, the logging profile did not take (usually a missed reboot).

### Diffing two captures

```bash
python -m brx_mcp.btsnoop capA.log > /tmp/a.txt
python -m brx_mcp.btsnoop capB.log > /tmp/b.txt
diff /tmp/a.txt /tmp/b.txt          # note: `cat` is aliased to `bat` in this shell
```
Compare the `$GSET` / `$WEAP` / `$PSET` lines specifically — timestamps will always differ.

---

## ~~Experiment 1 — decode `$GSET`~~ ✅ DONE 2026-08-23 — **definitive negative**

> **Do not re-run.** Three captures (respawn 15 / 30 / 5) produced byte-identical
> `$GSET` *and* `$PSET`; a 1-minute clock produced the same `$GSET` as a default one.
> **Respawn and game time are not sent to the tagger at all** — the app keeps the
> clock and drives respawn itself (§7n). The original reasoning is kept below for
> context, but the answer is no.


**Why:** the field test proved taggers keep playing with no host connected, but nothing
respawned and no round ended because we never configured an on-gun respawn time or game
duration. The manual says both are on-gun settings, so they live in
`$GSET,1,0,1,0,1,0,50,1,*` — eight tokens, **none understood**. Decoding this makes
out-of-range autonomous play work, and almost certainly gives players a respawn countdown
for free (the gun would own the timer).

**Method — change exactly one setting per capture:**

| # | Callsign setup | Capture as | Learns |
|---|---|---|---|
| 1a | Team Arena, respawn **15 s**, everything else default | `gset-respawn15` | baseline |
| 1b | identical but respawn **30 s** | `gset-respawn30` | **respawn token** |
| 1c | identical but respawn **60 s** | `gset-respawn60` | confirms + shows encoding (raw seconds? index?) |
| 1d | back to respawn 15, game time **5 min** | `gset-time5` | baseline for time |
| 1e | identical but game time **10 min** | `gset-time10` | **game-time token** |
| 1f | identical but lives **3** | `gset-lives3` | **lives token** |
| 1g | identical but lives **5** | `gset-lives5` | confirms |

You only need the game to *start* — no need to play it out. Config lands in the first ~30 s.

**Success:** we can send a `$GSET` that makes a tagger respawn and end its own round.
Then `arena`'s host-driven respawn should be **deleted**, not kept.

## ~~Experiment 2 — end-of-game and results read-back~~ ✅ DONE 2026-08-23 — **answered**

> **Do not re-run.** `cap5`'s 1-minute clock expired inside the trace, capturing a
> full game ending: the app sends `$VOL` → `$HLED` → `$STOP` → `$CLEAR` → `$PLAY,VS6`
> and **never queries the gun for anything**. The tagger keeps no score, so there is
> nothing to read back (§7n).


**Why:** after a field game, reconnecting produced **zero frames** — the tagger volunteers
nothing, and `$UP,*` got no reply. It may keep no score at all (§7g: the phone is the game
engine). If so, one-laptop scoring is impossible over BLE and the design must change.

**Method:** capture a **complete** Callsign game from start through the end-of-round
summary screen. Let the clock expire naturally rather than quitting.

**Look for:** what the app sends when the round ends, and critically **whether it ever asks
the gun for anything** — a query whose reply contains score/kill data. If the app only
tallies events it observed live, that confirms the gun keeps no score, and the answer is a
relay, per-player devices, or the **nRF radio** (`QUERY` reports `NRFhost 1`/`NRFslave 1`).

**Do not probe `$SP` on hardware to shortcut this.** It is documented as the end-of-game
report, but `$SP,99,*` is half the panic sequence — it may destroy the very results it
reports. Learn it from a capture first.

## Experiment 3 — per-player identity

**Why:** `$HIR` names the shooter's **team**, not the player (§7k). Free-for-all scoring
needs per-player identity. `QUERY` shows a device-level `PlayerID` we have never set.

**Method:** capture a **3-player** game if possible (or 2 players with explicitly different
player names/slots in the app). Diff against the 2-player captures for a field that tracks
player rather than team.

## Experiment 4 — decode `$WEAP` (44 tokens)

**Why:** custom weapons. The manual (§7h) gives stock stats as anchors — M-4 damage 24
already matches token 6 of the known-good string.

**Method:** one capture per stock weapon, changing only the weapon selection:
M-4 → SMG-X3 → MG-7 → SR-100 → TAC-87. Diff the `$WEAP` lines against the manual's
damage / rate-of-fire / accuracy / magazine table.

## Experiment 5 — `$PSET` audio tokens (sound mapping done right)

**Why:** the microphone sweep is a **dead end** (its negative control failed — a nonsense
id still produced audio). But `$PSET`'s trailing `H44,JAD,V33,…,A10` list looks like a
positional voice pack: the "GET SOME" respawn line came from there, not from any `$PLAY`
we sent.

**Method:** capture the same game with the app's **voice** setting changed. Diff the
`$PSET` tail. That maps *meaning*, not merely existence.

Confirmed by ear so far: `VA20` = "connection established", `VA81` = 3-2-1 countdown.
(The bulk sound inventory is better attacked by decompiling the **Callsign Android APK** —
no hardware needed, and it can be done on Windows.)

## Experiment 6 — other game modes

**Why:** every capture so far is Team Arena. Battle Royale, Battle Lines, Faction Wars and
Infection may use `$GSET` bits, `$SIR` tables or commands we have never seen — `$KOTH` is
sitting undocumented in §7d.

**Method:** one short capture per mode, config only.

---

## Hardware-only experiments (no capture needed — can be done anywhere with a tagger)

- **`$TID,0,*`** — team drives LED colour (§7i: team 1 blue, team 2 yellow). Does a null
  team give a neutral colour? Free-for-all has no teams, so this is the semantically
  correct way to set an FFA LED. **One-line test.**
- **Headset lockout** — the manual says a headset lost mid-game locks the gun until it
  reconnects, but a gun with no headset at boot fires fine. **Never controlled for in any
  experiment.** Run one match headset-paired, one headset-off-from-boot. This is a
  match-day reliability hazard and a likely explanation for future "gun won't fire" states.
- **`$HIR` protocol per weapon** — two frames arrived as `$HIR,0,...` rather than `4`. Fire
  each slot deliberately and watch token 1.
- **`$SFLASH,*`** — the app sends it periodically, no arguments, never near a hit. Send it
  in isolation and watch the gun.
- **`$HIR` `45,0,0` / `70,0,0` variants** — recur across matches; those numbers are exactly
  the configured starting HP and armor. Correlate against what the operator was doing.
