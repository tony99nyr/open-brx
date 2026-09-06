# Headset, link and what survives
_Which state lives where, and what a BLE drop, a headset switch-off, or a power-cycle each wipe. Read this page before you write code that reconnects to a gun._
Last verified: 2026-09-06

## State survival matrix
| State | BLE drop / reconnect | Headset switched off | Power-cycle | Conf |
|---|---|---|---|---|
| Game config (`$GSET`/`$PSET`/`$WEAP`/`$SIR`/`$BMAP`) | (unknown). Re-send the full head after a reconnect | Gun sends `$DISCONNECT,*` and drops the link; config: (unknown) | **Wiped**. `$SPAWN` then echoes `$LCD,0,0,0,0,0,0` + `$ALCD,0,0,0,0,0` | ✅ |
| Alive/dead + pools | Survives (a dead gun stays dead) | n/a | Reset | ✅ |
| Ammo | Survives | n/a | Wiped | ✅ |
| `$TID` team / LED colour | Survives; colour is painted at `$SPAWN` | n/a | Reset | ✅ |
| `$NAME` | Persists | Persists | **Persists** (only the official app rewrites it) | ✅ |
| Player id (`$PSET` t1) | Survives with config | n/a | Wiped (the USB `PlayerID` is separate and persistent) | ✅ |
| Score, clock, respawn timer | **Never on the gun** | n/a | n/a | ✅ |
| `$SIR` fn-23 state (`$ALCD` token 2 at 0) | Persists until `$SPAWN` | n/a | Cleared | ✅ |
Source: protocol/session-findings-2026-08.md §7r (E1), §7n; docs/experiment-log.md (2026-08-24 $NAME; EMP recovery matrix)

_[diagram DEV-09: The matrix above as a grid graphic.]_

## Headset off = no BLE.
Switching a linked headset off makes the gun send `$DISCONNECT,*` and drop. A headset-less gun "connects", answers a quick `$PING`, then dies within seconds and echoes **nothing** to a config head. A power-cycled gun needs its headset re-linked before BLE holds. **A held link plus `$ALCD` echoes *is* the headset check**. There is no dedicated probe. The official app silently drops a headset-less gun within ~1.2 s.
Source: protocol/session-findings-2026-08.md §7m, §7r

## Headset behaviours (native and autonomous: they work under any host's game head)
| Headset LED | When | Conf |
|---|---|---|
| Slow **rainbow** blink | Disconnected / not paired. The pre-game tell for "this gun will not join" | ✅ (operator, repeatable) |
| Team colour (red/blue…) | **Pre-game only**; goes dark once the game starts | ✅ (operator) |
| Dark | During play (normal) | ✅ (operator) |
Source: docs/experiment-log.md (2026-08-27 headset LED)

## Other headset facts
| Fact | Source | Conf |
|---|---|---|
| The headset syncs team colour from the tagger | bench observation | ✅ |
| `$VERSION` token 2 = headset firmware (`hds.59`); USB `QUERY` shows headset version and battery | captures / USB | ✅ |
| Headset disconnecting **mid-game** locks the gun until it reconnects (anti-cheat); a gun booted with **no** headset shoots normally in local play | Battle Company manual V7 | 👥 |
| Headset pairing can take up to 3 minutes with many BT devices nearby | manual V7 | 👥 |
| Headset sensor ids: `$HIR` tok1 0 = front dome, 1 = back dome (4 = gun body) | shield-isolated bench | ✅ |
| Gun↔headset pairing PIN = the headset's serial, set via USB `SETUP` | LaserTagMods note + USB | ✅ 👥 |
| Headset LED commands `$HLED`/`$BLINK`/`$CHASE`/`$HLOOP`/`$LED` exist; only `$HLED,,6` and `$HLOOP,0,0` have been seen in use | APK + captures | 🔍 ✅ |
Source: protocol/session-findings-2026-08.md §7h, §7m, §7r, tok1 section; docs/experiment-log.md (2026-08-27)

## Screamers.
A tagger left powered all day can stop holding BLE. It still advertises, but the connection drops or hangs. The community calls this the "screamer" state. Power-rest guns between sessions; keep them charged (firmware won't re-pair below a battery threshold).
Source: docs/gotchas.md; docs/experiment-log.md (2026-08-26 screamer)
