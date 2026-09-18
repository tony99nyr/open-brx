# Transport hardening: what a node may write to a gun, how fast, and how it knows the gun is still there

- **Status:** design, 2026-09-18. Two parts are built (§4 the deny list, §3 the pacing constants). The rest is
  a design that waits on the measurements in Phase A of `docs/bench-screamers-2026-09-19.md` ("bench A8" below means its step A8;
  the levers sheet §14 maps its old step numbers to these).
  Binds to `node.md` §7 (the BLE plumbing), `contracts.md` §8 (the frame contract) and `protocol/brx-protocol.md`
  §1 to §2 (the serial parser).
- **Owner interface:** the node (`app/src/brxlink.js`, `app/src/engine.js`), the bench stage (`mcp/brx_mcp/stage/`),
  the instrument (`mcp/brx_mcp/ble.py`, `protocol.py`) and the compiler's guards (`mcp/brx_mcp/mc/compile.py`).
- **Sources.** The gun-side facts come from the V4_30 and V4_31 firmware disassembly and from LaserTagMods' (Jay's)
  ESP32 sources, both shared on 2026-09-18. They are read, not measured. Every measure below that depends on one of
  them says so, and names the bench step that turns the reading into a number. Credit: LaserTagMods.

## 1. What the gun does with our bytes

These are the facts the design is built on. Evidence level: **V4_30/V4_31 disassembly, not yet bench-verified on
v4.32** unless marked `[bench]`.

1. **One byte per main-loop pass.** The serial parser runs once per pass of the main loop and consumes one byte
   from the UART behind the radio. The UART receive buffer is 1 KB (the v4.25 changelog says so too). A burst that
   arrives faster than the loop drains it fills the buffer, and the bytes past 1 KB are lost.
2. **The parser has no length limit and no timeout.** A frame is up to 60 tokens; token 61 wraps to token 1 and the
   gun prints "overflow". A token without commas grows without limit. A frame that never ends waits for ever.
3. **A lost `*` corrupts the NEXT frame.** A new `$` resets only token 0 and the index. Tokens 1 to 59 keep their
   old text until a handler finishes and clears them. So when the `*` of frame A is lost, frame B's `$` starts a
   new frame whose tokens 1..n are frame A's tokens with frame B's text appended. Both frames are wrong, and
   nothing tells the sender.
4. **Six audio waits block the loop.** Six places wait for an audio channel to finish with `delay(10)` and no
   timeout, and none of them reads the serial port while it waits. `$DPLAY` is one and can be sent over BLE.
   The other five sit in the standalone game paths (the mode announcement, game-over audio, two channel-4
   waits). A looping clip, or a "playing" flag that never clears, on a channel one of these waits on leaves the
   gun playing its last audio buffer with the serial port unread: that is a screamer, and no BLE command can
   reach it.
5. **No hardware watchdog.** Standard Teensy startup disables it, and the gun's own Bluetooth watchdog (`$RADSK`
   every 3 s to the headset, checked every 6 s; V4_31 shortened its reset pulse to 500 ms) runs inside the serial
   routine, so a blocked loop never recovers.
6. **`$START` arms IR reception, `$STOP` disarms it.** A gun that is not started drops every IR word ("not start").
   Relevant to spawn protection (F121), not to transport; listed because a read-back of the started state is
   part of §6.
7. `[bench]` **A split frame reassembles.** Parser state persists across serial reads, so a frame split over 20-byte
   BLE packets works. This is how every arm since 2026-08 has gone in.
8. `[bench]` **Notifications can arrive merged.** `$ALCD,…$BUT,0,1,*` in one notification. The node's reassembler
   splits on `$` as well as `*` (`brxlink.Reassembler`).

The 2018 Battle Company app behaves like a sender that knew some of this: it requests a 512-byte MTU, writes
20-byte batches one frame at a time waiting for each confirmation, sleeps 15 ms before every send, sends `$PING`
every 2 s and a bare `$LIFE,*` after 5 s of gun silence. Jay's ESP32 writes each 20-byte chunk with response and
no other pacing, sends `$RADSK,*` every 4 s as a fake headset, and recovers a dead link only by reconnecting.

## 2. The per-gun write budget

Measured on the compiled bundles (`ble-load-measurement-2026-09-18`, `mcp/tests` fixtures):

| Burst | Frames | Bytes | 20-byte packets | Frames over one packet |
|---|---|---|---|---|
| Arm (head + spawn), FFA or TDM | 43 | 1012 | 75 | 23 |
| Arm, KOTH with a perk | 45 | 1056 | 79 | 25 |
| Revive (the F11 repair path, every life) | 13 | 279 | 20 | 12 |
| End | 6 | 65 | 6 | 0 |
| Panic | 2 | 16 | 2 | 0 |

The three longest frames are `$WEAP,0` (101 B, 6 packets), `$WEAP,4` (88 B, 5) and `$PSET` (73 B, 4). Of the 23
multi-packet frames in an arm, 18 to 20 are `$SIR` rows, and 13 to 14 of those are 21 or 22 bytes long: a full
packet plus a runt packet of 1 or 2 bytes. Every one of them is a pregame fn-28 registrar row from
`sir_spawn_protected()`.

The phone paces at 8 ms per chunk (multi-packet frames only) and 18 ms per frame, so an arm takes about 1.2 s of
sleeps plus radio time. The instrument paces at 20 ms per chunk and 100 ms per frame (about 6 s per arm; a bench
tool, not the live path).

**Budget rule (design).** Off the arm bursts, a node writes at most one frame per event it witnesses (a hit, a
reload, a pool change coalesced at 300 ms, a headset repaint at most every 5 s). With the S42 live-accuracy writer
removed (`cut-live-accuracy`), the busiest minute of play is a revive (279 B) plus a few dozen frames under 20 B.
Nothing on the node may write on a timer during play. **A periodic keepalive, if §7 adds one, is the one exception,
and it is one 7-byte frame.**

## 3. Pacing: arm in blocks, with a pause

**Built, off by default.** `brxlink.WRITE_PACING = {chunkGapMs: 8, frameGapMs: 18, blockFrames: 0, blockPauseMs: 0}`.
With `blockFrames` > 0 the link sleeps `blockPauseMs` after every `blockFrames` frames of one write, never after
the last frame. The values ship as the field has run since 2026-08. Turning the block pause on is a one-line
change in `WRITE_PACING`, so a bench session can try a value without touching the write loop.

**Why a pause at all (design, needs bench A8 and A7).** §1.1 says the gun drains one byte per loop pass.
The loop pass time is not known; if it is near 1 ms, an arm burst of 1012 bytes at the phone's pacing arrives in
about 1.2 s and the gun drains it in about 1 s, so the buffer never nears 1 KB. If the pass is slower under audio
or IR load, the buffer fills and §1.3 happens. Bench A8 (200 arms at the phone's pacing, count the frames that did not apply) and
A7 (short frames with and without a 300 ms pause every 10) give the number. Until then the pacing stays
where it is: a slower arm costs real seconds at the line, and the evidence for it is a reading of code.

**Frames that barely overflow 20 bytes (design, needs bench A8).** The 13 or 14 runt packets per arm are the
frames most exposed to a lost trailing packet (§1.3: the lost byte is the `*`). Two ways to remove them:

- Trim the trailing empty tokens of the fn-28 registrar rows (`$SIR,0,0,,28,0,0,1,,*` is 21 B; without the last
  empty token it is 20 B). The firmware reads `$SIR` tokens positionally, and an absent token reads as empty, so
  this should be safe. **It is not measured.** A `$SIR` row is the arming of hit reception (F11), so this is not
  changed on a reading: bench A8 first, with the trimmed row on one gun and the full row on the other.
- Request a larger ATT MTU. The gun's radio negotiated 23 on every bench so far (`protocol` §1), and the 2018 app
  asked for 512 and still wrote 20-byte batches. Not a lever we control.

Tokens are never dropped from a `$WEAP` frame: the firmware reads 43 positionally, and trailing tokens carry
`t41`/`t42` (ranges).

## 4. The deny list: frames a node must never send

**Built.** `protocol.DENIED_COMMANDS` (one reason per name) is the single source. It reaches the phone as
`NODE_DENIED_COMMANDS` in the generated contract (`mcp/tools/gen_contract.py` -> `app/src/transport/contract.gen.js`),
and it is enforced in three places:

1. `engine._write` (the one choke point every gun write passes through) drops a denied frame, writes the rest of
   the burst, logs `REFUSED n frame(s)` and counts it in `engine.refused`. The stage's `write` mirrors it.
2. `compile.assert_no_denied_frames(bundle)` refuses to compile a bundle that carries one, so an operator sees
   it at push time rather than the phone dropping it silently mid-match.
3. The instrument (`server.send`, `send_batch`) refuses it, and `confirm=true` does not override. The one
   exception is the hang-prone class (`protocol.HANG_PRONE_COMMANDS`, today `$DPLAY` alone): `send` lets it
   through with `confirm=true` AND `allow_hang=true`, so bench A1 can make a screamer on demand; `send_batch`
   and the node never send it.

What is on it, and why: `$DPLAY` (§1.4, the only blocking wait reachable over BLE); factory and provisioning
writes (`$FACTORY`, `$DTYPE`, `$DEV`, `$SITE`, `$TSTRNAME`); pairing and radio (`$PAIR`, `$PIN`, `$CLEARDEVICE`,
`$INQ`, `$GPAIR`, `$GPAIRX`, and every `$!`, `$^`, `$&` frame, which are the gun's own radio-module control
frames); DFU (`$CDFU`, `$HEADDFU`, `$DDFU`); the IR word-format switch (`$IRT`); factory and hardware tests
(`$FTST`, `$BURN`, `$DUTY`, `$SOL`, `$MUZ`); the zombie headset family; `$VIBTOGGLE` (persistence unknown);
`$ASKSN` (prints the headset PIN); `$RESET`; and the USB console's `SETUP` word. The list is by NAME; it is not a
claim that every other command is safe, only that these are known to be unsafe.

Not on it, on purpose: the `$PB*` and `$AS` native-hosting family. They start the gun's own game paths, which hold
four of the six blocking waits, but they are on the known list (bench tools use them) and no compiled bundle
carries them. If bench A1-A3 show a `$PB*` start can hang a gun, they move.

## 5. Write with response for multi-packet frames (design, needs bench A8)

Every write today is `writeWithoutResponse` (`brxlink.js`, `ble.py`): no packet is acknowledged at the link layer,
and a lost packet is invisible. Jay's ESP32 writes every chunk WITH response, and so did the 2018 app; neither
reports a screamer from that path. The option: write the chunks of a multi-packet frame with response and leave
single-packet frames as they are. A response write costs one connection interval per packet (about 30 to 50 ms on
the intervals seen), so a 6-packet `$WEAP` goes from about 48 ms to about 250 ms, and an arm from about 1.2 s to
about 2.5 s. Worth it only if A8 shows frames going missing at the current pacing. If it does, the change is
one line in `brxlink.write` (and `ble._write`), and it applies to head and spawn only; a revive is on the critical
path of a waiting player.

## 6. Read-back after arming: what `$QUERY` can prove (design, needs bench-firmware-levers claim 19, §18)

Today MC proves a push by the gun's `$ALCD` echo (slot 0 magazine and reserve) and the status heartbeat's
HP/armour against the pushed `$WEAP,0` and `$PSET` (`state._echo_state`, `frames.head_spawn_ammo`, `head_pool`).
It never re-checks `$SIR`, `$BMAP`, the team, or the secondary and melee rows, and `not_echoed` is the ordinary
v4.32 answer.

The V4_30 `$QUERY` reply carries, in order, the player id, the TEAM, the three pool maxima, one `$PSET` sound id
(token 11), the gyro flag, then a per-weapon-slot loop (not decoded). So one `$QUERY` after the head write can
prove `$PSET` t1, the team byte (F206: this is the one number that would have caught the bug at the lobby, on
every gun) and the pool maxima. It cannot prove the `$SIR` table: nothing reads it back, which is why F11's repair
path resends it on every life.

Design: after the head is written and echoed, the node sends `$QUERY,*`, parses tokens 1 to 5, and reports them in
`ack_config` beside `gun_echo`. MC compares the team against the pushed `$TID` and refuses `start` on a mismatch
the same way it refuses an ammo mismatch today. Cost: one 8-byte frame per arm and one reply. Needs the
`$QUERY` token map confirmed on v4.32 first (bench-firmware-levers claim 19, §18); the reply captured on 2026-08 was
`$QUERY,0,0,0,0,0,,1,0,,0,…` on an unconfigured gun, which fits the map but proves only the shape.

## 7. The lock-up detector on the node (design; F208, F163)

A screamer (§1.4) answers nothing: no `$PONG`, no `$ALCD` on a trigger pull, no `$VOLTS`. The BLE link may stay
up, because the radio module is a separate chip that keeps the connection while the MCU spins. So "connected"
tells the node nothing, and today nothing on the node distinguishes a healthy idle gun from a locked one: F208's
gun sat byte-identical for 105 s with the HUD holding the player alive.

Design, three parts, none built yet:

1. **A silence clock.** The engine already stamps the last frame from the gun (`B4`, `noteStale`). While LIVE and
   alive, after `GUN_SILENT_MS` (design value 8 s: a firing gun streams `$ALCD` on every round, an idle one sends
   `$VOLTS` about every 30 s in app mode, so 8 s of silence is normal and 30 s is not; the value needs the idle
   `$VOLTS` cadence confirmed) the node sends one `$PING,*`.
2. **The verdict.** `$PONG` within 1 s: the gun is alive and idle, restart the clock. No `$PONG` after two pings
   3 s apart while the link reads connected: the gun is locked. The node raises a `gun_locked` moment, the HUD
   shows a full-screen takeover ("YOUR GUN HAS STOPPED. HOLD POWER 3 s, THEN POWER ON. Your phone will re-arm
   it."), and the node reports `status.gun_locked = true` so the MC board shows it too. This is the missing half
   of F208: the pool-staleness watchdog it asks for is this clock, and the "way back" is the power-cycle plus the
   existing reconnect and head re-write (`node.md` §3.10).
3. **After the power-cycle.** The link drops (the radio resets with the MCU), the forever-reconnect loop relinks,
   and a LIVE relink reconciles (S7.1): head re-write, disarmed window, re-arm at the real pools. That path exists.
   What is new is that a reconcile after a `gun_locked` verdict must NOT keep the stale pools: a power-cycled gun
   is at full HP with no config, so the node marks the player down and revives them on the normal respawn timer.

`LINK_WATCHDOG_ENABLED` ships false (F163: the B4 watchdog fires on an 8 s silence that a healthy idle gun also
shows). The lock-up detector replaces that reading with a question the gun can answer: silence plus no `$PONG`.
A `$PING` costs 7 bytes and the gun answers it in about 59 ms. This is the one timer-driven write §2 allows.

Open: whether a screamer's radio really keeps the link up (bench A1 answers it: if the link drops instead, the
detector is simply the existing drop path plus a "power-cycle" hint when the reconnect fails three times).

## 8. Bench steps that settle this design

| Measure | Status | Settled by |
|---|---|---|
| §3 block pause on, a value | design | bench A8, A7; levers sheet §19 (the gap sweep) |
| §3 trim the runt `$SIR` rows | design | bench A8 (one gun trimmed, one full) |
| §4 deny list | built | none needed; A1-A3 may ADD `$PB*` |
| §5 write with response on multi-packet frames | design | bench A8 |
| §6 `$QUERY` read-back of id, team, pools | design | bench-firmware-levers claim 19 (§18) |
| §7 lock-up detector | design | bench A13, A1 (does the link stay up?), plus the idle `$VOLTS` cadence |
| §2 the budget rule | design | bench A13 (20 minutes at the old S42 rate: how long to a lock-up?) |

FOLLOWUPS rows: F255 (pacing + runt rows), F256 (write with response), F257 (`$QUERY` read-back), F258 (lock-up
detector), F259 (the `$PB*` question). F208 and F163 point here.
