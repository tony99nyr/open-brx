# Sound architecture — who plays what, and how we control it

How audio works on the BRX, so modes and the Utility Box know where each sound comes from and what we
can change. Two orthogonal cuts: **who triggers a sound** (the gun autonomously vs. the host) and
**how configurable it is** (forced / re-skinnable / fully ours). Grounded in the hardware sessions
(experiment-log #33–40) and the `$SIR`/`$PSET`/`$PLAY` protocol.

## Cut 1 — who triggers the sound

### A. Automatic, gun-played (mapped once at game start)
The gun plays these itself the instant a hardware event happens — you configure them in the loadout,
then the firmware handles them with no host involvement:
- **`$SIR,<type>,<subtype>,<soundID>,<function>,…`** — the sound (and effect) for an incoming IR of a
  given type: hit tone, respawn chime, add-armor, etc. (`protocol/brx-protocol.md` §5.)
- **`$PSET` voice-pack** — per-event sounds baked into the player profile: `deathAlarm`, `longPain`,
  `painRelief`, `hitHp`, `hitArmor`, `hitShield`, `hitCrit`, …
- **`$WEAP`** — the weapon's own fire / reload / empty sounds, from the ammo state.

**Key lever:** the gun's reaction is a **lookup we own** — the IR *type* is the key, our `$SIR` table
is the mapping. So a Utility Box that emits a given IR type triggers whatever sound our `$SIR` maps it
to (any of the 2166 bank ids) — we don't clone anyone's IR to get a sound (see `hardware/brx-station-spec.md`).

### B. Host-triggered announcements (`$PLAY` on a rule)
Sounds the gun can't decide on its own because they depend on **game state the host computes** — the
host fires `$PLAY,<soundID>,…` at the moment its rules say so:
- Objective callouts: "flag taken", "control point captured", "extraction inbound", "bomb planted".
- Timers: "3 minutes left", "overtime", game-over.
- Custom announcers not baked into the firmware.

In our engines these are the `Callout` / `PlaySound` actions the driver turns into `$PLAY`
(`mcp/brx_mcp/modes/`). The engine decides *when*; the driver plays it.

## Cut 2 — how much we can change each sound

| Tier | Examples | Control |
|---|---|---|
| **Forced (native, unstoppable)** | **power-on boot sound** (plays before we connect — why the tagger is loud at startup) | ❌ can't suppress or trigger |
| **Native reflexes, re-skinnable** | "phone connected" on BLE attach; disabled/"can't do that" chirp; reload/empty; low-battery | ⚠ can't stop them firing, but can **swap the clip** via the USB `AUDIO`-folder sound swap (`reference/brx-extended-user-guide.md`) — e.g. B11 "Open BRX connected" |
| **Config-driven, then automatic** | hit / pain / death / armor / shield / weapon sounds | ✅ ids ours via `$SIR`/`$PSET`/`$WEAP`, or file-swap |
| **Host-triggered, fully ours** | objective callouts, timers, custom announcers | ✅ any of the 2166 ids on any rule, via `$PLAY` |

**Only one truly stuck sound: the boot chime.** Everything meaningful is either re-skinnable or ours.

## Native multikills — the firmware does its own killstreak audio (D4)

> **✅ RESOLVED 2026-08-25 (exp-log "feedback fork resolved" / FOLLOWUPS B18).** The native
> killstreak/green-sight feedback rides the guns' **nRF24 peer mesh and is INVISIBLE to BLE** — and it
> does **NOT** fire under our BLE-config'd game (the shooter's sight stays RED, no "double kill"). So it
> is **not** "free" for us. **`$PLAY` audio DOES work over BLE**, so Mission Control rebuilds the
> announcer/killstreak/medal audio itself as scorekeeper (watch `$HP,0`, attribute team-granular, 4 s
> double-kill window, `$PLAY` back to the shooter). The green-sight VISUAL is nRF-only, not BLE-drivable.

Hardware fact (Tony): a BRX gun **natively says "double kill"** when you tag two different enemies
back-to-back in a **native (gun-menu) game** — and other streaks. So **multikill/streak/first-blood
callouts are firmware-native**, computed on the gun over nRF. Implications:
- The gun tracks **ephemeral local kill state** for audio (doesn't contradict §7n — that's no
  host-*readable* score, not no local state).
- The shooter's kill confirmation rides the **nRF24 mesh** (proven: a passive BLE tap during a native
  game captured zero frames). BLE gives only the victim's `$HP,0` (team-granular attribution).
- **We do NOT get these free** under a BLE-config game — MC drives them via `$PLAY` (B18). Native-mode
  feedback would need the nRF tap (D1) to observe. Whether native nRF peering can be *enabled* over BLE
  is the open Callsign-capture probe (`docs/handoff-callsign-nrf-capture.md`).

## What this means for building

- **Loadout sounds:** set once in `GameConfig`/`$SIR`/`$PSET`/`$WEAP` — the gun handles hit/death/reload
  autonomously.
- **Mode announcers:** emit `Callout`/`PlaySound` from the engine → the driver `$PLAY`s them. A shared
  announcer rule module (multikill-extras, objective callouts, timers) can serve every mode — but note
  the base multikills are already native.
- **Grenade/Utility-Box sounds:** the gun/headset plays them from *its* bank on the box's IR — reskin via
  the tagger sound swap or drive any bank id through `$SIR` (`reference/grenade.md`, `brx-station-spec.md`).
- **Sound-id catalog:** `mcp/brx_mcp/sounds.py` — semantic names → verified bank ids, with a
  confidence per cue (CONFIRMED from captures/`$SIR`/DK map; PROVISIONAL = right documented range,
  exact clip TBD by ear). Every id is asserted to exist in the real 2166-id bank (`test_sounds.py`),
  so no cue plays the invalid-id fallback. Engines emit `snd.GAME_OVER` / `snd.POINT_CAPTURED` etc.
  instead of raw literals; the driver plays `snd.GAME_OVER` on every game end. **Open by-ear task:**
  pin the exact CTF/KotH objective callouts in the `V100–V144` range (verification-checklist).
