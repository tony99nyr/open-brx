# Events — what the gun tells you
_Hits, health, HUD echoes, buttons and telemetry — and the proof that the gun keeps no game state_
Last verified: 2026-08-27

## `$HIR,<sensor>,<irProto>,<shooterId>,<shooterTeam>,<magnitude>,<crit>,<subtype>,*`
(render as labelled token boxes)
| tok | Field | Values | Notes | Conf |
|---|---|---|---|---|
| 1 | sensor that caught the IR | 0 headset **front** dome · 1 headset **back** dome · 4 gun body | Isolated with every other sensor covered. Trust for directional logic **only at field distance** — point-blank floods every receiver and the first to decode reports. | ✅ |
| 2 | shooter's IR protocol | 0 standard · 10 rocket · 13 melee … | = the shooter's `$WEAP` t3 / IR word B field. | ✅ |
| 3 | **shooter player id** | 0–63 | = the shooter's `$PSET` token 1. 32/32 hits both directions on two guns with distinct ids. | ✅ |
| 4 | **shooter team** | 0–3 | = the shooter's effective `$TID & 3`. | ✅ |
| 5 | raw magnitude | e.g. 9, 45, 80, 115 | The IR word's D field (= shooter's t5). **Not the applied damage** where a multiplier row or crit is in play — derive damage from the `$HP` delta. On a killing blow it can report the victim's remaining pool instead (overkill clamp). | ✅ |
| 6 | crit flag | 0/1 | Echoes the IR word's C bit. 0 on every stock weapon. | ✅ |
| 7 | subtype | 0–3 | Echoes the IR word's U field (sniper = 1). | ✅ |
Source: protocol/brx-protocol.md §4, §7k, §7q, §7r, §7r addendum, tok1 sensor-map section; protocol/brx-ir-protocol.md

## Not every `$HIR` is damage.
Pickups, heals and status effects arrive on the same message type — the protocol/subtype tells you which row fired.
Source: protocol/brx-protocol.md §7k

## The other events
| Message | Decode | Conf |
|---|---|---|
| `$HP,<hp>,<armor>,<shield>,*` | Pools after the hit; same millisecond as its `$HIR`. `$HP,0,0,0` = death. Example run at 9/hit: armor 70→61→…→0, then HP 45→43→34→…→0. Writes (`$LIFE`/`$BUMP`) do not self-emit `$HP`. | ✅ |
| `$LCD,<hp>,<armor>,<t3>,<t4>,<mag>,<reserve>,*` | Health/armor HUD echo on `$START`/`$SPAWN`/death. Tokens 3–4: — (unknown). | ✅ |
| `$ALCD,<mag>,<t2>,<slot>,<reserve>,<heat>,*` | Ammo/weapon HUD (token 2: — (unknown)): one frame per round fired *and* per round reloaded; slot changes on alt-fire cycle (0↔1); melee (slot 4) appears as an isolated frame. Heat is a raw level that exceeds 100. | ✅ |
| `$BUT,<id>,<state>,*` | 0 trigger · 1 alt-fire · 2 reload handle · 3 select · 4 left · 5 right; 1 press / 0 release. In phone mode pre-game the trigger reports but does not fire. | ✅ |
| `$VOLTS,<pack_mV>,<cell_mV>,<n3>,<n4>,*` | Battery every ~30 s in app mode. **Only reliably returned at good RSSI** — weak-signal guns in a fleet sweep returned none. | ✅ |
| `$DISCONNECT,*` | The gun is hanging up (headset switched off, or the app closing). | ✅ |
Source: protocol/brx-protocol.md §4, §7f, §7j, §7q, §7r; docs/experiment-log.md (2026-08-24 fleet sweep); docs/gotchas.md

## The gun keeps no game state — proven three ways.
(1) Three captures at respawn 5/15/30 s: byte-identical config, nothing on the wire encodes respawn or clock. (2) The complete end-of-game tail is `$VOL → $HLED → $STOP → $CLEAR → $PLAY` — **the app never asks the gun for a score**. (3) Reconnecting after out-of-range play yields zero frames, and bare `$UP,*` gets no reply. The phone tallies `$HIR`/`$HP` live; it is the only place the score ever existed. Anything needing respawn, a clock or scoring needs a host in range for the whole match.
Source: protocol/brx-protocol.md §7l, §7n

_[diagram DEV-08: Kill attribution + feedback sequence: victim gun → `$HIR,…,<id>,<team>,…` + `$HP,0,0,0` → host credits `<id>` → host sends shooter gun `$SFLASH,*` then `$PLAY,,4,6,V3A,,,,*` (~0.4 s) and, on a lead change, `$PLAY,,4,6,VB17,,,,*`.]_

## Per-player attribution and native kill feedback over BLE — the recipe
1. At arm time give every gun a distinct `$PSET` token 1 (0–63) and a `$TID`.
2. On the victim, store `<shooterId, shooterTeam>` from each `$HIR`; when `$HP,0,0,0` arrives, the stored shooter gets the kill.
3. Send the **shooter's** gun `$SFLASH,*` (green-sight kill confirm) and `$PLAY,,4,6,V3A,,,,*` ("kill" on the announcer slot). The official app does exactly this, three kills → three pairs.
4. Score lines (`VB17` "takes the lead") go to every gun's announcer slot from its own host. Nothing propagates gun-to-gun; there is no nRF score channel to discover.
5. Game end: `$PLAY,VSF,4,6,JAY,,,,*` on the winner's guns (victory sting + "victory").
Source: protocol/brx-protocol.md §4 (kill attribution pattern), §7o, §7p, §7q, §7r

- **Why did earlier captures show shooter id 0,0?** Every gun sat on the default id. The field was always there; `$PSET` token 1 is what makes it vary.
- **Why is `$SFLASH` in the victim's capture "never near a hit"?** Because a kill you *score* is invisible in your own `$HIR`/`$HP` stream — correlate it with `$BUT` trigger bursts.
- **Can a dead gun fire?** No: `$BUT,0,1/0` with no `$ALCD` decrement.
Source: protocol/brx-protocol.md §7q · protocol/brx-protocol.md §7o · protocol/brx-protocol.md §7q
