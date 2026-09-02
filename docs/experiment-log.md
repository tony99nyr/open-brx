# Experiment log

> ⚠️ **ORDERING — read this before skimming.** This file is **NOT strictly chronological.** New
> entries are inserted **above the day's earlier ones**, so within a date the newest is FIRST, and
> some recent days sit **mid-file** with older material below them. **Skimming the tail gives you
> retracted conclusions.** To find current state, do not read this file end to end — read
> `docs/HANDOFF.md` (entry point) and `docs/bench-tomorrow.md` (the queue). Use this log for
> *evidence* behind a specific claim, found by grep, not for orientation.

Chronological record of hardware experiments: what was sent, what happened, what it
means. **Append to this file after every experiment session** — it is the shared lab
notebook that keeps agents (and Tony) from re-running dead ends. Conventions: each
entry = date, machine, tagger state, experiment, wire evidence, human observation,
conclusion.

---

## 2026-08-23 — Windows PC (WSL dev / Windows Python + bleak) — first contact day

Tagger: Tactix-3D4F, `FE:AD:FD:10:3D:4F` (Windows MAC), Gen2/3, fw v4.32.
Renamed to **Tactix2-3D4F** mid-day by the official app (`$NAME,Tactix2,*`).

### 1. Scan + identify ✅
BLE scan showed the tagger advertising the Nordic UART service (name `Tactix-3D4F`).
`$PING,*` → `$PONG,*` in 59 ms. Generation question settled: Gen2/3, direct BLE.

### 2. Read-only listen, no handshake → silence ✅ (finding)
90 s connected, Tony pressing buttons/trigger: **zero messages**. Idle taggers send
nothing unsolicited. (Later disproven for *connected* state — see #4: after any
connect the tap opens. The silent run predated the tagger being in app-locked state.)

### 3. Handshake probe: `$CONNECT` / `$INIT` / `$PHONE` ✅ (finding)
`$CONNECT,*` and `$INIT,*`: no visible response. `$PHONE,*`: replied `$BUT,3,0,*`,
tagger said "phone connected", and the event tap opened — live `$BUT` streaming for
every control, `$VOLTS` telemetry every ~30 s. Full button map verified:
trigger=0 alt=1 reload=2 select=3 left=4 right=5; state 1=press 0=release.
On-gun controls became "disabled chirp" — app mode locks them.

### 4. Remote game config attempts ("startgame") ⚠️ unsolved
Sequence grew across four runs: `$PHONE → $CLEAR → $START → $GSET → $PSET(500/250/150)
→ $WEAP(slot0 AR) → $SIR×5 → $AS → $PBTEAM,1 → $PBWEAP,0 → $BMAP,0,0 + $BMAP,1,97
→ $SPAWN → $START → $GLED → $PLAY`.
- Long frames (>20 B) initially failed: WinRT write error — tagger keeps 23-byte MTU.
  **Fix: chunk writes at MTU-3** (now in `ble.py _write`). After chunking, `$WEAP`
  accepted.
- Wire evidence config lands: `$WEAP` echoes `$ALCD,32,100,0,9999999,0,*` (mag 32,
  reserve). `$SPAWN` echoes `$LCD,500,250,0,0,32,32768,*` — the `$PSET` HP/armor
  visible. `$START,*` echoes `$LCD,0,0,0,0,0,0,*`.
- `$PBWEAP,0,*`/`$SPAWN` produced a **reload sound** ("usually means start of game" —
  Tony) but the gun never went live: trigger/buttons = disabled chirp, no `$HP`, no
  firing. LEDs alternated red at one point (suspected dead/waiting state before
  `$PSET` was added; not re-observed after).
- **Not yet tried (top hypotheses, from the manual):** physical reload-handle pull
  after config push (that's how on-gun games start); controlling for headset state
  (headset-disconnect mid-game locks the gun; no-headset-at-boot shoots fine).

### 5. Official app HCI snoop capture ✅ (partial)
Android "Bluetooth HCI snoop log" + `adb bugreport` → parsed with
`python -m brx_mcp.btsnoop`. The app never held its connection long enough to start a
game (its own flakiness), but the capture yielded: connect ritual `$STOP → $PLAYX,0 →
$VOL,100,0 → $PLAY,VA20,3,9` (no `$PHONE`!), `$NAME,Tactix2,*`, `$VERSION,*` →
`$VERSION,v4.32,?,4,,devhost.03,*`, tagger-sent `$DISCONNECT,*`. Sound IDs:
VA20 = "connection established", U16 also connect-related.
**A capture of a working app game session remains the highest-value missing artifact.**

### 6. Link stability collapse ❌ unresolved on this PC
Morning: 75–90 s sessions rock solid. Afternoon (after app episode + phone on USB):
every connection died ~2.3 s in, regardless of traffic (zero-write listens died too).
Exhausted without fix: phone unplugged, Windows BT toggle, **two** BT driver restarts
(Qualcomm FastConnect 7800), bond removal (`pnputil`), tagger power-cycles, WiFi
confirmed off (Ethernet-only PC). `client.pair()` extended survival to 5–9 s
(reproducibly better — suggests security/bonding involvement; the app had bonded the
tagger). Verdict deferred to the **MacBook cross-check** (see HANDOFF.md). If Mac is
stable → blame this PC's radio; if Mac also drops → tagger state (app bond?), USB
factory restore is last resort.

### Protocol messages discovered today
`$VOLTS` (battery telemetry), `$LCD`/`$ALCD` (display echoes: HP/armor/mag/reserve),
`$VERSION` (query+reply), `$DISCONNECT`, `$STOP`, `$PLAYX`, `$VOL`, `$NAME`,
`$BUT` press/release semantics, `$PLAY` volume/priority args. All in
`protocol/brx-protocol.md` §3/§4/§7a.

### Operational lessons
- Power-cycle the tagger between experiments (Tony's rule — connections leave state).
- One BLE central at a time; force-close the phone app during our sessions.
- `$VOL,100` is painfully loud indoors — use `$VOL,30,0,*`.
- "Phone connected" voice = any central attaching (count them to count reconnects).
- Android stdout buffering: run experiment CLIs with `python -u`.
- Bugreports take 5–10 min; the btsnoop log rides inside; keep phone still while
  pulling.

---

## 2026-08-23 (evening) — MacBook (CoreBluetooth / bleak 3.0.2) — game start SOLVED

Taggers: **Tactix2-3D4F** and **Tactix2-E20D**, both fw `v4.32` / `devhost.03`.
macOS gives per-machine UUIDs, not MACs — the old `FE:AD:FD:10:3D:4F` is meaningless here.

### 1. macOS BLE cross-check → wrong conclusion, later retracted ❌
`listen` runs died ~6.6 s, reproducibly, on two taggers. Combined with the official app
reconnecting every ~8 s in a capture, we concluded v4.32's BLE stack was broken and wrote
it into the protocol doc. **This was wrong** (see #5). Cost: several hours.
Tony's observation "the tagger never said *phone disconnected*" was the first real clue —
the tagger latches connected state and only notices via supervision timeout.

### 2. USB console found — `QUERY` / `SETUP` ✅
Micro-USB enumerates as `USB Serial` / **Teensyduino** → the MCU is a **Teensy**, and the
port is the manual's "Programing Port". Commands (from LaserTagMods' notes) are `QUERY`
and `SETUP`; everything else answers `ERROR`.
`QUERY` dumps: versions, `Serial Number/Head PIN: <redacted>` (matches the headset sticker),
voltages, `NRFhost 1` / `NRFslave 1` / **`devHost 1`**, `BT central V: devhost.03`,
`Tested by: JB`, `PCB-5`. Saved to `~/.brx-mcp/device-backups/`.
`SETUP` is factory provisioning (prompts for headset SN, bilingual EN/中文). Entering it
and power-cycling out changed **nothing** — verified by field-by-field diff.
**Firmware cannot be backed up**: HalfKay is write-only and there is no SD card (§7h).

### 3. Callsign version gate is SOFT ✅ (finding)
App warns *"current firmware v4.32, supported version is until v2.01e"* — an **upper**
bound; the guns are ahead of the app's range, not behind. Games still run regardless.

### 4. PacketLogger captures → remote game start SOLVED ✅✅
`btsnoop.py` decoded 0 frames from Apple's exports until fixed (datalink 1001 carries no
HCI type byte; the type is in the record flags). After the fix: cap3 = 369 frames of a
live game, cap4 = 372 frames of two-tagger combat.
Missing pieces were **`$AMMO` after spawn**, **all seven `$BMAP` + `$BMAP,0,0` again
after spawn**, and **`$SPAWN,,*`** (empty token). Details in protocol §7e/§7f.

### 5. Our own code ran a live game ✅✅
`startgame` against E20D: config → spawn → `$LCD,45,70,0,0,36,216,*` (identical to the
app's echo) → Tony pulled the trigger and **it fired**, `$ALCD` counting 36→18.
**The link held the full 73.8 s run.** That retires #1: establishment is intermittent
(~1 in 3, per Tony — the app behaves the same), holding is fine. `ble.py` now retries 5×.

### 6. Weapon audio silent at `$VOL,30` ✅ (finding)
Sound ids resolve fine; 30 is simply inaudible. Measured with a mic harness: at 100 the
sounds hit 6.8–37× noise floor, at 30 nothing rises above room noise. App uses 69.
`startgame` now takes volume as a CLI arg (default still 30 per CLAUDE.md).

### 7. Sound-bank sweep by microphone ❌ DEAD END — do not repeat
Built a recorder + RMS event detector to enumerate sound ids unattended. **The negative
control failed**: nonsense id `ZZ99` produced audio at 150× noise floor, so the tagger
appears to play a fallback sound for unknown ids. "Audio detected" never proved "id
exists", making every negative result meaningless. Two earlier detector bugs (noise floor
sampled over the first sound; recording started before the BLE connect finished) were
fixed and it *still* failed the control. (At the time we believed there was no readable SD; later
corrected — sounds ARE on USB-accessible storage, but the *inventory* came from the APK anyway.)

### Still open
- `$HIR` shooter attribution — every hit read `1,1` with two default player IDs.
- `$GSET` / `$WEAP` field maps — differential capture, one setting changed at a time.
  The manual's stock weapon stats (§7h) are the anchors.
- The phone-to-phone lobby (~1 min to appear) is not BLE; looks like a cloud round-trip.
- `server.py` is broken against the `mcp` 2.0 API (`fastmcp` moved).
- **Headset lockout (§7h) has never been controlled for** in any of our experiments.

---

## 2026-08-23 (late) — MacBook — two taggers, one host

Taggers: **Tactix2-E20D** (p0) and **Tactix2-3D4F** (p1), driven simultaneously from one
laptop via the new `arena` command. Two 3-minute free-for-all matches, ~93 hits total.

### 8. `$HIR` shooter attribution SOLVED ✅ (was §7f's open question)
Configs identical except `$TID,1,*` vs `$TID,2,*`. Every hit frame named the *other*
team: team-1's tagger received `$HIR,4,0,0,2,...`, team-2's received `$HIR,4,0,0,1,...`.
**Token 4 = shooter's team id.** No counterexample in ~93 hits across two matches.
This was unanswerable in §7f only because both players sat on default ids.
Tokens 2 and 3 stayed `0,0` — the §4 player-id guess is not supported.

### 9. LED colour is team-derived, not `$GLED` ✅ (resolved §7i)
Same two configs, differing only in `$TID`, **no `$GLED` sent at all** — and the guns lit
different colours: **team 1 blue, team 2 yellow**. That is why walking `$GLED`'s supposed
`<r>,<g>,<b>` tokens produced nonsense earlier the same evening; those tokens do not
control colour. Untested: `$TID,0,*` for a neutral/no-team colour.

### 10. Simultaneous start ✅ (bug found and fixed)
First arena run configured taggers serially, so each counted down as its own config block
finished — players went live ~5 s apart, one shooting while the other was still counting.
Fixed: configure all taggers concurrently (`asyncio.gather`), pull `$PLAY,VA81` out of the
per-tagger config, fire the countdown in unison, spawn 2.8 s later when it ends.
Verified in sync on two taggers.

### 11. Match results
Run 2: p0 34 hits / 2 deaths, p1 17 hits / 3 deaths, **5 of 5 respawns fired**.
Independent per-player state held throughout. Two frames arrived as `$HIR,0,...` rather
than `4` — different weapons appear to emit different IR protocols (§5 maps `0` to
standard weapons). Only two samples; which slot produced them is unknown.
The `45,0,0` and `70,0,0` `$HIR` variants recurred, still unexplained — `45` and `70` are
exactly the configured starting HP and armor, and the tail differs (`0,0` not `0,3`).

### 12. ARCHITECTURAL PROBLEM FOUND — BLE range ⚠️
Everything above assumes the host stays in BLE range for the whole match. **It will not.**
Players run around a field; the laptop sits still. The official system does not have this
problem because **every player carries their own phone** — the BLE link is always ~1 m away.
One-laptop-many-taggers is a different topology and needs a different design.
Consequences, all unresolved — see the followups section at the end of this file.

---

# Followups — open research, prioritised

> **HISTORICAL — superseded by [`docs/FOLLOWUPS.md`](FOLLOWUPS.md)**, the single source for open
> work. This A–G list is kept as a notebook snapshot; do not treat its statuses as current.

## A. The range problem — **ANSWERED 2026-08-23, see entries 17-19 and protocol §7n**

> **Closed as answered, not solved.** Respawn and game time are not in the protocol
> stream, and the gun keeps no score. BLE cannot support out-of-range play; it is a
> design property. The reasoning below is kept for context. **The live thread is now
> the nRF radio** (D).


Our `arena` command drives everything from the host: it detects `$HP,0,` and sends
`$SPAWN,,*` itself. **That only works while the laptop is in BLE range.** On a real field
players leave range within seconds, and a downed player would simply never respawn.

The official system sidesteps this — **each player carries their own phone**, so the BLE
link is always about a metre away and the phone can be the game engine. One-laptop-many-
taggers is a fundamentally different topology.

What has to be true for it to work:

1. **The tagger must respawn itself.** The manual (§7h) lists respawn as an *on-gun*
   setting (off / 15 / 30 / 60 / ramp45 / ramp90 s), so the firmware can already do this —
   we just have not found the command. **Almost certainly a `$GSET` token.** Highest
   priority: decode it, then stop driving respawn from the host.
2. **Game time and lives likewise** — same `$GSET` frame, same experiment.
3. **The tagger must accumulate results while disconnected.** Unknown whether it does.
   `$SP` is documented as an end-of-game report and `$UP` as a status report; neither has
   been probed. If the gun keeps score, players return to the laptop and we read it. If it
   does not, one-laptop scoring is impossible for out-of-range play and the design must
   change (a relay/repeater, per-player phones, or the nRF radio — see D).
4. **Reconnect-and-read flow.** Scan → connect → pull results → display. Needs 1–3 first.

**Do not build more host-driven game logic until A1 and A3 are answered.** The current
respawn loop is a demo of the protocol, not a design for a real match.

## B. Death/respawn UX

Players need to know how long they are waiting. If A1 lands, the gun owns the timer and
most likely announces it (the official app shows a HUD countdown because the phone is on
the player). Check what the gun does on its own before building anything host-side —
we may get the countdown for free.

## C. Values and states still unknown

| Item | Why it matters | Method |
|---|---|---|
| `$GSET` token map | respawn, game time, lives, mode — see A | differential capture: change ONE app setting, re-capture, diff |
| `$WEAP` 44 tokens | custom weapons | same; the manual's stock stats (§7h) are anchors — M-4 damage 24 already matches |
| Per-player identity | `$HIR` gives shooter *team*, not player (§7k). FFA scoring needs per-player | `QUERY` reports a device-level `PlayerID` we have never changed — find the command that sets it |
| `$TID,0,*` | neutral LED for FFA (§7i) | one-line test |
| `$HIR` `45,0,0` / `70,0,0` | recur across matches, unexplained; the numbers equal starting HP/armor | correlate against what the operator was doing |
| `$HIR` IR protocol per weapon | two frames came as `$HIR,0,...` not `4` | fire each slot deliberately, watch token 1 |
| `$SFLASH,*` | **RESOLVED §7o:** shooter's green-sight kill-confirm flash, 1/kill (old "periodic" note was a victim-side capture) | — |
| `$SP` / `$UP` | central to A3. **`$UP,*` probed — no reply (§7l)**; LaserTagMods' arg form looks like a write. `$SP` must NOT be probed on hardware ($SP,99 is half the panic sequence) | learn both from a full end-of-game capture instead |
| Headset lockout | manual says a headset lost mid-game locks the gun (§7h). **Never controlled for in any experiment** | run one match headset-paired, one headset-off-from-boot |

## D. The nRF radio — **NOW THE CRITICAL PATH** (A is closed; this is the way out)

`QUERY` reports `NRFhost 1` and `NRFslave 1`, and LaserTagMods build LoRa/nRF base
stations (`NRFL-Bases`, `LoRa-Controlled-Taggers`). **The taggers may already have a
long-range radio that is not Bluetooth.** If so, the range problem may have a native
solution and BLE is simply the wrong transport for field play. Unprobed, and potentially
more important than anything in C.

## E. Sound inventory

Wanted: the complete sound bank, so audio can be designed rather than guessed.
**The microphone sweep is a dead end** (see entry 7 — the negative control failed).
Better routes, in order:

1. **Decompile the Callsign Android APK.** The app has to know every sound id it sends, so
   the list is in there — very likely with names. This is the highest-value route by far
   and needs no hardware.
2. **`$PSET`'s audio-set tokens.** The trailing `H44,JAD,V33,V3I,…,A10` list appears to be
   a positional voice pack (the "GET SOME" respawn line came from it, not from any `$PLAY`
   we sent). Change one token, hear which line changes — maps meaning, not just existence.
3. **Battle Company's updater sound package**, if it ships sounds as files.

---

## 2026-08-23 (late) — field test: do taggers play with no host? ✅ YES

`fieldstart` configured and spawned two taggers, then **disconnected the laptop**;
operator took them out of range and played; `fieldresults` reconnected afterwards.

### 13. The game survives host disconnection ✅ (key architectural result)
The guns kept working with no laptop present — firing, hits, damage all continued.
**The tagger runs the game itself.** The one-laptop topology is therefore viable, and
followup A is not a capability problem, it is a *configuration* problem.

### 14. What did NOT happen, and why
- **No respawn.** Expected: we never configured an on-gun respawn time. `arena` faked it
  from the host, which is exactly the thing that cannot work out of range.
- **The round never ended.** Same cause: no game duration was configured.
- **No results on reconnect.** 12 s of listening after reconnect produced **zero frames** —
  no `$LCD`, no `$ALCD`, no summary. `$PING` → `$PONG` worked, so the link was fine.
  **The tagger volunteers no game state.** Reading scores back needs a query command we
  have not identified. `$UP` was the candidate — **since probed, and `$UP,*` gets no reply
  at all** (§7l). LaserTagMods send it with arguments (`$UP,100,<n>,0,*` + `$UR,*`), which
  looks like a write rather than a query. Read-back remains unsolved. **Do not probe `$SP`** — it is documented as the end-of-game report, but
  `$SP,99,*` is half the panic sequence, so it may destroy the very results it reports.

### 15. Consequence: `$GSET` is now the critical path
The manual (§7h) lists respawn (off/15/30/60/ramp45/ramp90) and game time
(off/5/10/15/20/30 min) as on-gun settings, so those values must live in the config we
already send. `$GSET,1,0,1,0,1,0,50,1,*` has eight tokens and **we understand none of them**.

Decoding it makes autonomous play work. Method, now well-defined:
create a game in Callsign with respawn 15 → PacketLogger capture; change **only** respawn
to 30 → capture; diff the `$GSET` frames; the token that moved is respawn. Repeat per
setting. Two captures each for: respawn time, game time, lives, mode.

---

## 2026-08-23 (night) — Experiment 1: decode `$GSET` → **definitive negative**

Ran the capture plan's Experiment 1 on the MacBook with PacketLogger + iOS Callsign.

### 16. The headset gates the entire app ✅ (explains hours of "flakiness")
**With no headset paired, Callsign connects to the tagger and immediately disconnects it —
silently.** And **you cannot create a game at all unless the app's top-right icon is green
and reads "connected".**

This is the whole explanation for the "app is flaky, then suddenly works" pattern that
plagued the evening. Nothing was intermittent: when the headset happened to be linked the
app went green and everything worked; when it wasn't, game creation was simply unavailable.
Neither operator nor agent was tracking headset state as a variable.

Diagnostic while chasing it: a capture during the failures (`disconnects.log`) shows the
app completing its ritual, receiving **zero frames back**, and hanging up ~1.2 s later —
while the same tagger answered our own client's `$PING` with `$PONG` in **120 ms**. The gun
was never the problem. **Check the headset before any app-driven session** (§7m).

### 17. Respawn time is NOT in the protocol stream ❌ (three captures)
`cap5` respawn 15 s · `cap6` respawn 30 s · `cap7` respawn 5 s, Team Arena.

```
all three: $GSET,1,0,1,0,1,0,50,1,*     byte-identical
$PSET:     identical
only frame unique to any capture: a $VOLTS battery reading (drifts on its own)
```

Game time likewise: `cap5` ran a 1-minute clock and still produced the same `$GSET` as the
default-clock captures. **The app keeps the clock and drives respawn itself.** The manual
lists both as on-gun menu settings, so the firmware can do it — Callsign just never uses
that path, so no capture will ever reveal a command for it. **Stop looking.**

(`cap6`'s secondary weapon changed unintentionally, contaminating the cap5/cap6 pair.
`cap7` was taken to re-test with a third value; the conclusion does not rest on that pair.)

### 18. The app never asks the gun for results ❌ (Experiment 2, answered early)
`cap5`'s 1-minute clock expired inside the trace, capturing a complete game ending:

```
[38.202s] >> $SPAWN,,*                 game starts
[44.882s] << $VOLTS,...                LAST frame the tagger ever sends
[60.795s] >> $VOL,69,0 / $HLED,,6 / $STOP / $CLEAR / $PLAY,VS6
```

No query, no score request. **The gun keeps no score, so there is nothing to read** — which
explains `$UP,*`'s silence (§7l) and the empty reconnect after the field test. The phone
tallies `$HIR`/`$HP` events live and is the only place the score has ever existed.

### 19. Consequence: BLE cannot support out-of-range play
This is a **design property, not a missing command**. A tagger with no host in range will
not respawn anyone, will not end the round, and will not remember what happened — exactly
what the field test showed. Followup A is therefore **closed as answered**, not solved.

Remaining options are in protocol §7n. The most promising is **the nRF radio** (`QUERY`
reports `NRFhost 1` / `NRFslave 1`, and LaserTagMods ship `NRFL-Bases` and
`LoRa-Controlled-Taggers` — they hit this same wall and solved it with a different radio).

---

## 2026-08-24 — Windows PC — Callsign APK teardown (static analysis, no hardware)

Pulled the official Callsign app from Tony's Android phone (USB data lines were dead —
paired over **wireless adb** instead: `adb pair <ip:port> <code>` then mdns auto-connect).
Package `com.lasertagpro.callsign`, a **Unity/IL2CPP** app. Full writeup:
`protocol/callsign-extract/README.md`.

### 20. Complete sound bank recovered ✅✅ (kills the mic-sweep dead end, entry 7)
`assets/Configs/Sounds.json` holds a **2166-entry id→duration map** — the authoritative list
of valid `$PLAY` ids. Since any id not in the list is invalid, the fallback-sound ambiguity
that killed the microphone sweep no longer matters. Published as
`protocol/callsign-extract/sound-bank.md` (the architecture doc §5 deliverable). This is the
route entry 7/followup-E predicted ("decompile the APK") — done, no hardware, no guessing.

### 21. Config schemas extracted ✅
weapon-categories (ids 0–12: Rifle/SMG/Sniper/Shotgun/Heavy/Energy/Support/Power/Exotic/
Launcher/Stun + Ability/Melee), game-medals, streak-rewards — saved under callsign-extract/.

### 22. Architecture confirmations ✅ (from metadata strings)
- **Phone-to-phone lobby = AWS SQS/SNS** (many SendMessageAsync/GetQueueUrl strings). The
  ~1-min lobby delay in the field tests is a cloud round-trip, not BLE. A self-hosted
  platform replaces this whole layer with the local MQTT bus.
- `AUTO RESPAWN IN {0}` string → app drives respawn (corroborates entries 15/17).
- App can play offline; version gate is a soft upper bound (matches entry 3).

### 23. Command builders NOT recovered — deeper teardown needed
`$GSET`/`$PSET`/`$WEAP` are built at runtime in IL2CPP native code (no grep-able template).
Next step for the token maps: **Il2CppDumper** on `libil2cpp.so` + `global-metadata.dat`,
then Ghidra on the builder methods. Highest-value teardown follow-up — would yield the field
maps directly, bypassing differential BLE captures. The APK is on this PC but NOT committed
(Battle Company's binary); reproduce via the README.

---

## 2026-08-24 — Windows PC — IL2CPP metadata mining → command field maps

Deeper teardown of `global-metadata.dat`. The metadata is obfuscated (version bumped to **39**;
index tables encrypted — Il2CppDumper fails with "duplicate key 0x09090909" even after patching
the version to 29/31/27/24). **But the identifier string blob is plaintext and stored per-type
in declaration order**, so field maps read straight out of it. Full writeup:
`protocol/callsign-extract/protocol-classes.md`.

### 24. Every command is a C# class; fields = token map ✅✅✅
Namespace `LaserTag.CallSign.Hardware.Guns.Domain.Messages.*`. Recovered the complete command
vocabulary (30 requests + 5 headset + notifications — ~20 commands we never knew: FSET, GREN,
HFIRE, IRTX, LIFE, MELEE, STUN, VIB, ZOOM, BHIT, BUMP, ASSIST, DLC family, headset BLINK/CHASE/
HLED/HLOOP/LED) and per-command field lists.

### 25. GSET fully mapped and CONFIRMED ✅
`friendlyFire,outdoorMode,gunLaserRegion,autoAmbientLight,gyroscope,secondaryBluetoothWeapons,
criticalShotModifier,gameMods` — validated numerically against `$GSET,0,0,1,0,1,0,50,1,*`
(criticalShotModifier=50%). **No respawn/time/lives field** — confirms from source that those
are app-side (settles #17 definitively).

### 26. WEAP / PSET / all command field maps recovered (source-derived) ✅
WEAP: ~40 named fields (primaryDamage, rateOfFire, maxClip, reloadType, per-fire sound names,
IR damage/power types…) — the 44-token map that was the top priority, without capture diffing.
PSET: maxHP/maxShields + a positional voice pack (confirms the Mac's §7e hypothesis). Enums
recovered: DamageType(~15), PowerType/IRSource(~12), ReloadType(6), LedEffect(5), WeaponCategory.

### 27. Moddability answered ✅ (for the build)
- **New guns: yes** — a weapon is a `$WEAP` param set into 1 of 6 slots; bounded by the
  DamageType/PowerType/ReloadType enums + numeric ranges + the 2166 sound bank.
- **New game types: yes, ~unbounded** — the gun holds no game state; modes are host-side rules
  over {hits, teams via $TID, health, spawn, ≤14 IR recognitions}.
- **New sounds on the tagger: ~~no~~ → RETRACTED 2026-08-24: YES.** (Original claim: bank baked in,
  no SD, playback-only over BLE.) Corrected — on-tagger sound files **are** swappable over the USB
  data port (hold SELECT at boot → mass-storage `AUDIO` folder of `.LTP` files). No `$`-command
  uploads audio (that part holds), but the USB path does. See `reference/brx-extended-user-guide.md`
  + `callsign-extract/protocol-classes.md`. Off-gun DFPlayer/effect-node audio is still the route for
  *dynamic/unlimited* audio.

### 28. Backend mapped ✅ (context)
REST API `ltp-prod-v4.us-east-1.elasticbeanstalk.com`; multiplayer lobby = AWS SQS/SNS (the
~1-min lobby delay is a cloud round-trip). A self-hosted platform replaces this whole layer.

Tooling installed on this PC: .NET 8/7 runtime (~/.dotnet), Il2CppDumper (net7) — both under
scratch, not committed. APK still not committed; only derived docs + the config JSONs.

### 29. WEAP exact token positions — cross-validated ✅
Il2CppInspector (2021.1) is Windows-only + too old for this metadata + same obfuscation wall,
so instead aligned the metadata field list against the TWO known-good frames (AR slot 0 vs
Charge Rifle slot 1) by token diff. Validated anchors: primaryDamage=tok5 (24/150, matches
manual M-4=24), maxClip=tok16 (32/100), primaryFire_SoundName=tok27 (R01/E03), and decisively
chargeUp/Down_SoundName=tok28/29 (EMPTY on the non-charging AR, C15/C17 on the Charge Rifle).
Full token table in protocol-classes.md. ~6 always-empty positions (secondary-fire / extra-
headset) need a one-field capture to finalize — now trivial since we know the field names.
Bonus enums recovered: LedColorType (White/Pink/Orange), BlinkLoopType (Once/ThreeTimes/
Infinite), ButtonCode (Trigger/AltFire/Analog), and premium GOTDLC modes Generals/Commanders/
Swarm.

### 30. APK harvest: game modes, QR stations, weapon spawns, grenade ✅
Comprehensive gameplay-domain sweep of the metadata → `protocol/callsign-extract/apk-harvest.md`.
- **Game modes** (full list incl. premium): FFA, TDM, Supremacy, Survival, Infection, CTF,
  Domination, Assault, Territory, LastManStanding, BattleRoyale, Swarm, Generals, Commanders.
  "Edge" game = the phone's OFFLINE local engine — the exact role our Companion accessory plays.
- **Win conditions**: Score/Death/Slayer/CaptureTheFlag/SquadLeader — all host-side.
- **"Boxes" = QR codes**: RespawnByQrCode, PickUpQrCodeWeapon, ControlPointGenerator,
  SpawnSupplyDrops. Battle Company's answer to LaserTagMods' JBOX is printed QR codes.
- **Weapon spawns**: WeaponPickUpType enum (AutoRifle/BurstRifle/SniperRifle/Shotgun/SmgSaw/
  Sticky/RailGun/RocketLauncher/EnergyRifle/WarHammer/StrikeRifle) via QR pickup — mechanically a
  `$WEAP` push into a slot.
- **Grenade**: mode IS pushable — `$GREN` to the gun (which programs the grenade), GrenadeMode =
  FlashBang/Gas/Confusion/Molotov. No separate grenade BLE/QR path.
- Bonus enums: GunWeaponType (FullAutoFire/Bow/ChargeAndAutoRelease/ChargeAndRelease),
  gunLaserRegion (USA/International = IR legal power).

---

# Followups — added 2026-08-24

## F. Smart Grenade — never touched; build a better config path ⚠️ HIGH INTEREST
The grenade enables objective modes (the user runs CTF, KotH, Assault with it) but its on-gun
config is **hard and buggy**. We have NOT connected to or configured a grenade yet. What the APK
tells us (see `callsign-extract/apk-harvest.md`):
- Grenade mode/type is set by **`$GREN` sent to the GUN**, which programs the grenade — NOT a
  separate BLE device, NOT a QR code. Fields: iRType,crit,modifier,indoorMode,operationMode,
  channel,GrenadeType,MaxCount. GrenadeMode = FlashBang/Gas/Confusion/Molotov.
- **The win:** a clean scriptable `$GREN` frame (via MCP / the Companion) replaces the buggy menu.
- **Hardware tests needed:** (1) does `$GREN`→gun take effect immediately, or only while a grenade
  is "loaded"/tapped to the gun's IR? (2) map each field's effect (channel, MaxCount, the mode
  selector). (3) BLE-scan with a grenade powered on — is it visible at all? (protocol §7 still
  lists this as unknown). (4) capture the official app configuring a grenade (PacketLogger) to see
  the exact `$GREN` it sends.
- **No public grenade manual found** — only the product page + a YouTube "Grenade Basics" demo
  (arm by pulling clip + button, underhand throw, ~3 s after impact, 30 ft radius). If a manual
  surfaces, add it to `docs/reference/`.
- **Goal:** a proper grenade-config UI in the webapp + an MCP `configure_grenade` helper, so
  objective modes (CTF/KotH/Assault) become reliable.

## G. Accessory hardware — BRX Companion spec written
`hardware/brx-companion-spec.md` — the per-tagger ESP32-S3 module (offline game engine + powerups
+ custom audio + Wi-Fi sync). Next: prototype Tier-0 "Brain" and validate the powerup command
sequences ($LIFE/$WEAP re-push/$AMMO) on hardware.

### 31. Community + LaserTagMods research; system specs written ✅
Mined LaserTagMods' 13 GitHub repos and the BRX Elite Owners FB group (~196 members) for BRX
know-how. Results: `docs/reference/lasertagmods.md` (JEDGE/JBOX facts — protocol $DD/$AS, 25-bit
38kHz IR encoding, station behaviours, radios, firmware lineup) and `docs/reference/community-notes.md`
(gun-won't-fire diagnostics, **Gen-3 headset re-pair procedure** — the fix for the lockout that
blocks firing, battery polarity warning, scoring gap, game-mode/ammo-restock ideas, grenade/CTF).
Both corroborate our findings (headset blocks firing; MTU-20 chunking; the nRF radio is likely
LaserTagMods' nRF24 base link). Wrote three system specs: `mission-control-spec.md` (operator
console + deathmatch gap analysis), `phone-app-spec.md` (Callsign replacement), and refreshed
`hardware/brx-companion-spec.md`. Consolidated all open work into `docs/FOLLOWUPS.md`; added
`docs/README.md` index. No new hardware run this session — desk research + docs.

### 32. Deeper APK teardown (UnityPy) → game data is server-side, not bundled ✅
Gun-off static analysis. Installed UnityPy, parsed the base APK's 27,391 Unity objects. Result:
the APK is UI + IL2CPP engine + the sound *inventory* (Sounds.json); it does NOT bundle the
weapon/character stat tables or the `$PSET` voice-pack presets. Scanned all 8,003 MonoBehaviours
for sound-id clusters and weapon names → 0 config objects (data isn't in local ScriptableObjects;
IL2CPP strips typetrees, but a raw-byte sound-id scan would have found clusters if present — none).
Metadata/native URL scan confirms the data is **fetched from the Callsign server**:
`ltp-prod-v4.us-east-1.elasticbeanstalk.com` `/api/v1/callsign/{settings,voice-profiles,arenas/games}`
+ S3 `ltp-prd-v4`. `voice-profiles` = the `$PSET` voice-pack (P3). So the three deep-dive goals
(secondary-fire tokens P1, PSET voice map P3, stock weapon stats) are **data, not structure** —
unreachable by static teardown. New route added: **P8 = MITM the Callsign HTTPS API** (gun-off) to
grab weapon/voice/game data directly. Structure (field names/order/enums) was already fully
recovered; this closes the static-teardown thread.

### 33. G-2 health-write live test — RESOLVED ✅ (health-write CONFIRMED via two-gun damage→restore)
Bench test on the **Windows tower** (office; the fixed dev/test rig), tagger **Tactix-3D4F**
(`FE:AD:FD:10:3D:4F`, v4.32), volume **45** per Tony's request (warn before 100). Goal: confirm the
`$LIFE` (grant) / `$BUMP` (adjust) health-write commands actually change health mid-life — the gate
for the shields/overshield/medic/Syphon mode family (followups G-2/P11, `docs/tier0-plan.md`).
- **Confirmed:** config + spawn take the gun **live** — pulling the trigger decremented the mag in the
  `$ALCD` HUD echo (`$ALCD,<mag>,100,0,<reserve>,0`: `35→34→33…`, reserve `108` = our `$AMMO` load).
  Tagger reported "phone connected" + went **red** (red team). So the whole config/spawn/live path
  works on the tower over BLE. `$ALCD` = the **ammo** HUD; `$LCD` (health HUD) was **never** emitted.
- **Not confirmed:** `$BUMP,20,25,25`, `$LIFE,10,10,10`, `$BUMP,-20,-30,-30`, `$LIFE,20,30,30`,
  `$BUMP,10,10,10` — **every one produced zero rx response** (no `$HP`, no `$LCD`). Adds to a
  full-health player clamp (expected → no event), but **negative `$BUMP` did not reduce health either**,
  so we couldn't create a damaged state to heal from. Health-write remains **unproven on v4.32**.
- **Observation (open):** trigger fires **haptic vibration but no fire sound** at vol 45 — separate
  issue, likely a `$WEAP` sound-token or audio-path thing; doesn't block G-2 (health read is over BLE).
- **Next — round 3 (definitive):** need a **real damaged baseline** — Tony **shoots the tagger / tags
  the headset** to take actual damage (emits `$HP`/`$LCD`, also proves the read path), *then* send
  `$LIFE` and watch for a heal. If it heals → G-2 passes; if not, health-grant isn't available on v4.32
  and Syphon/shields fall back to other mechanics. **Power-cycle the tagger before round 3** (Tony's
  hygiene note — avoids a stuck state after repeated config/spawn/END cycles).
- Scripts: `scratchpad/g2_health_probe.py`, `g2v2.py`. Session paused (Tony in a meeting, ~30 min).

**RESOLUTION (same session, two-gun test — `g2_twogun.py`):**
- **Health-write CONFIRMED.** Second tagger **Tactix2-E20D** (`D8:AE:5F:60:E2:0D`) as shooter. Distinct
  teams via **`$TID,1`=blue (victim), `$TID,2`=yellow (shooter)** made hits register (same-team fire had
  done nothing). Victim took damage: `$HIR,...,2,...` (shooter team **2**) → `$HP,45,52,0` → `45,34,0` →
  `45,16,0` (**armor absorbing: 70→52→34→16**, HP steady 45). Then `$LIFE,25,25,25` + `$BUMP,45,70,70`
  → next hits reported `$HP,45,**70**,16` — **armor restored 16→70 and shield 0→16** (a positive shield
  only a write can create). So `$LIFE`/`$BUMP` **do take effect on a live tagger** → unlocks the
  health/regen mode family (shields/overshield/medic/Syphon).
- **Key mechanic:** health writes **don't self-emit `$HP`** — the new value only appears on the *next
  hit / HUD refresh*. (That's why the earlier full-health / no-damage probes saw nothing.)
- **`$HP` = `<HP>,<armor>,<shield>`** confirmed; `$LCD` = health HUD (`45,70,...` at spawn); `$ALCD`
  token2 (`100`) is a constant, token3 = weapon slot (not health). `$TID` colours: 1=blue, 2=yellow.
- **No power cycle needed** ✅ — the reset preamble (`$STOP`/`$CLEAR`/`$PLAYX` + config's `$CLEAR`/
  `$START`) cleanly reset between runs. Answers Tony's "proper clear" question — drop the power-cycle step.
- **New issue found:** sequential per-gun config makes starts **unsynced (~10 s apart)** — see FOLLOWUPS
  B10.

**SEMANTICS + REGEN nailed (`g2_semantics.py`, `g2_regen.py`):**
- **Both `$LIFE` and `$BUMP` are ADDITIVE grants, clamped at max.** `$LIFE,0,30,20` on a damaged victim:
  armor 43→70 (43+30 clamp), **shield 0→20** (clean additive proof); HP +0 unchanged. `$BUMP,30,40,50`:
  armor 43→70 (43+40 clamp). So to heal, send `$LIFE`/`$BUMP` with the **delta to add**; neither is an
  absolute-set. (Earlier "$BUMP looks like a set" was wrong — it was additive-with-clamp.)
- **NO native regen — ruled out.** Beefed the victim (`$PSET` HP99/armor99) and damaged armor 99→18,
  then **idled 18 s + 12 s with zero firing**: armor stayed **18** (next burst read 18→9→0). Armor does
  **not** self-recover. ⇒ **Halo-style regenerating shields must be HOST-DRIVEN** (node watches `$HP`,
  refills after a no-damage timer), not a free native mechanic. This corrects an earlier hopeful lead.
- **Shield pool inactive:** the `$HP` shield field stayed **0** all test despite `$PSET` shield=70/99 —
  shields likely need explicit **activation** (APK `ActivateShield` ability), not just a pool value. New
  followup (P16).
- **`$HP` overflow confirmed:** armor absorbs first (HP steady), then when armor=0, hits cut HP
  (`99,0,0`→`90,0,0`→…), matching §7f.
- **B10 sync fix validated:** configuring both guns fully, THEN spawning both back-to-back, starts them
  ~together (vs the ~10 s sequential gap) — adopt this config-all-then-spawn barrier in the engine.
- **Volume:** on-gun 1–5 ≈ `$VOL` **60/70/80/90/100** (Tony's field estimate); defaults ~75 in / ~85 out.

### 34. G-1 grenade over BLE — first contact, INCONCLUSIVE ⚠️
First-ever grenade hardware run. Method: put sensor gun **Tactix-3D4F** in a live game and watch its
BLE stream (`grenade_watch.py`) across three phases while Tony operated the grenade near the headset:
(1) program-beacon (hold top button ~10 s), (2) shoot the grenade with the gun, (3) press the grenade
button near the gun.
- **Result: no grenade-specific BLE events.** The gun emitted only `$BUT` (Tony's own trigger/button
  presses — `$BUT,0`=trigger, `$BUT,2`=SELECT) and `$ALCD` (ammo HUD). **No `$HIR`, no `$HP`, no
  `$GREN` echo, nothing new** in any phase — including when the grenade button was pressed (a detonate
  should hit the headset → `$HIR`/`$HP` if paired/in-range; none seen).
- **Two explanations, not yet separable:** (a) the gun genuinely doesn't surface grenade IR over BLE
  (a real G6 "no"), or (b) **the grenade never interacted** — likely **unpaired** to this gun (manual:
  accessories must be IR-paired: hold RIGHT while powering the gun → "install accessory" → shoot the
  grenade), and the program-beacon needs the **headset** to catch it (aim/range). Shooting *outward* at
  the grenade wouldn't hit our own headset.
- USB-C left unplugged (that's G7, separate). Scripts: `scratchpad/grenade_watch.py`.

**FOLLOW-UPS (same session — `grenade_isolate.py`; two corrections from Tony):**
- **Correction 1:** you do **NOT** "install accessory" for the grenade in its objective modes — that
  pairing is only for a *thrown* grenade tied to your headset. As Respawn/KotH/Checkpoint/Assault it's a
  **station** any gun interacts with by IR, no pairing. (Fix `reference/grenade.md` accordingly.)
- **Correction 2:** the grenade announces its mode **through the tagger speaker only when the gun is in
  SETUP mode**, not mid-game — so the earlier live-game program-beacon phase was the wrong state.
- **✅ Gun→grenade IR CONFIRMED:** shooting the grenade (blue/team-1 gun) made it **flash WHITE**. So the
  grenade is alive and receives gun IR. **But white = neutral/unclaimed** — a blue gun should have
  claimed it **blue** if capturing; the white flash reads as a **hit-acknowledge, not a capture.**
- **❓ Grenade→gun: still no BLE frames.** Hands-off isolation watch (button/ammo noise filtered): grenade
  beaconing at the headset produced **0** non-noise frames; shooting it produced only trigger noise, no
  return hit. Two unresolved explanations: (a) it wasn't capturing → not emitting, or (b) it emits and
  our host **`$SIR` table swallows it silently** (gun only emits `$HIR`/`$HP` on health change).
- **Assessment:** G-1/G6 need a **dedicated methodical session**, not more ad-hoc probing. Concrete plan
  for next time: (i) get a **known capture** first — figure out why blue-gun→white-not-blue (weapon IR
  team encoding? mode? capture condition), watching the grenade LED as ground truth; (ii) once it
  captures, re-watch BLE for an emitted beacon; (iii) **behavioral test** — set Respawn mode, beacon the
  gun to make it a respawn-client, and check if its self-respawn is disabled (proves grenade→gun IR
  reprograms the gun *without* needing a BLE frame). Scripts: `grenade_listen.py`, `grenade_isolate.py`.

### 35. G-1 grenade over BLE — CRACKED ✅ (full mode map + $HIR beacon decode)
Long, productive grenade session. **The unlock: stop configuring a host game.** Our custom `$SIR` table
was *swallowing* the grenade IR silently (confound (b) from #34). With a **bare BLE connect** (no
`$SIR`), the grenade's IR **surfaces as `$HIR` notifications**. Tool: `scratchpad/gprobe.py <gun>
<label> <secs> [bare|game|minfire]` (minfire = weapon loaded, `$SIR` stripped so the trigger fires AND
grenade IR still passes).

**Grenade setup procedure (Tony, hardware) — now in `reference/grenade.md`:** off→on (green ready) →
hold top button ~4 s (loud long beep = setup) → beeps fast + cycles colour → release to lock (LED goes
**white** to confirm) → mode persists across power-cycle → **boot flashes the current mode's colour ~1 s**.
**A 2nd tagger in setup mode announces each mode's name** as you cycle.

**Colour → mode map (5 modes; our video list of 4 was wrong):**
| Mode | Colour | Function | Beacons over BLE? | `$HIR` signature |
|---|---|---|---|---|
| 1 | red | **Frag** (blast grenade) | ❌ (thrown/triggered blast) | — |
| 2 | green | **Assault** | ❌ — **captures silently**: shot by team-1(blue) gun → grenade LED turns **blue**, but no beacon | — |
| 3 | blue | **Hill** (KotH) | ✅ ~every 5 s | `$HIR,0,15,0,2,8,0,0` |
| 4 | yellow | **Respawn** | ✅ ~every 2.5 s | `$HIR,0,15,0,2,6,0,0` |
| 5 | white | **CTF** | ❌ passive | — |

**`$HIR` decode — grenade vs gun:** `$HIR,0,<srcType>,0,<d>,<e>,<f>,<g>`. **Token 2 (`srcType`) = 15 for
a GRENADE**, `0` for a gun shot (a gun hit was `$HIR,0,0,0,2,9,0,3`). So a node can **filter grenade IR
by token 2 == 15**. For beacons, **token 5 (`e`) encodes the mode**: Hill=8, Respawn=6 (both token4=2).
(Transient cycling/setup beacons showed d=0 e=54–58 rolling and d=1 e=6 — programming/heartbeat states,
not decoded further.)

**G6 answer (mode-dependent!):** **Hill and Respawn broadcast their state over BLE** (a phone/node can
read possession/availability live); **Assault, CTF, Frag do NOT beacon** — Assault capture lives only on
the grenade LED, invisible to the gun stream. So "read grenade objective state over BLE" works for
KotH/Respawn, not for Assault/CTF.

**Capture mechanic confirmed:** shooting an **Assault** grenade with a team-1 (blue) gun turns its LED
**blue** = captured by that team. (Needs a real weapon firing — bare-connect trigger is disabled; use
`minfire`.)

**Integration takeaways:** (1) the engine reads grenade events as `$HIR` with token2==15 — but only if
the gun's `$SIR` config doesn't eat them; craft `$SIR` to pass protocol-15 through, or run a
grenade-aware listen. (2) For non-beaconing modes (Assault/CTF), objective state must be inferred from
*our own gun's* capture shots, not from the grenade. (3) `$GREN` active-send (drive the grenade from
software) still untested — next session.

**CTF (white) shot → turned RED** (not blue/team-1 like Assault did) — CTF uses different colour logic
(red may = flag grabbed/contested, not team colour); still no BLE beacon. Decode later. `$GREN`
active-drive filed as **G8**.

**Frag (red) detonation: no BLE frame** on button-press near the headset — consistent with Frag needing
the **thrown-grenade pairing** ("install accessory" → shoot grenade → headset-armed detonate). This is
the one mode where pairing matters (objective modes don't). Untested until we pair; filed under G-followups.

### 36. G8 — active `$GREN` drive: NEGATIVE ✅ (objective modes are NOT BLE-configurable)
Tested driving the grenade from software. Sent `$GREN,<iRType>,0,0,1,<operationMode>,0,0,1,*` sweeping
**operationMode 0–7** with **iRType 0 and 15**, gun in `minfire` config aimed at the grenade, watching
for any beacon (a Hill/Respawn program would start beaconing). **Every send produced nothing** — no
beacon, no LED/mode change (LED is white-when-locked regardless, so beacon is the only detector).
**Conclusion: `$GREN` does not reprogram the grenade's objective modes over BLE.** Two supporting
reasons: (1) **objective modes are set on-grenade only, in the boot/setup window** — likely deliberate
**anti-tampering** (Tony's hypothesis); a settled grenade ignores programming. (2) **`$GREN`'s
`GrenadeType` enum = FlashBang/Gas/Confusion/Molotov = blast *effects***, i.e. `$GREN` configures a
**paired *thrown* grenade's blast type**, not the Respawn/Hill/Assault/CTF station modes.
**Implication for B8 (grenade app):** it **cannot** replace the finicky on-grenade objective-mode setup —
those are hardware-locked to the button/boot flow. The app's real value is instead **(a) a live STATE
DISPLAY** reading the Hill/Respawn beacons over BLE (`$HIR` token2=15), and **(b) possibly thrown-blast
config via `$GREN`** — but only with a *paired* grenade (untested; needs the install-accessory pairing).
Also untested: whether `$GREN` needs the grenade "tapped/loaded" to the gun first (APK hypothesis).
Scripts: `scratchpad/gsend.py`, `gsweep.py`.

### 37. Grenade beacon OWNERSHIP decoded ✅ (token4 = owning team)
Claimed a Respawn (yellow) grenade for team-1 (blue) by shooting it and compared beacons before/after
(`gclaim.py`, `gprobe.py`). **Token 4 = owning team:** neutral/team-2 Respawn beaconed
`$HIR,0,15,0,**2**,6`; the instant the blue (team-1) gun claimed it (chime + LED→blue), the beacon
flipped to `$HIR,0,15,0,**1**,6`. Same team encoding as a gun hit's shooter-team field (1=blue, 2=team2).
**Full grenade beacon decode:** `$HIR,0,15,0,<owningTeam>,<mode>,0,0` — token2=15 (grenade), token4=team,
token5=mode (Respawn=6, Hill=8). Behaviour: setting Respawn → nearby setup-mode tagger says "respawn
point enabled" + echoing ping; claiming shot → "chime" + LED turns team colour.
**This fully specs the B8 state-display:** a node reads `$HIR,0,15,0,<team>,<mode>` to show who owns each
Hill/Respawn objective live. (Beacon capture is aim-sensitive — the grenade's emitter must face the
headset dome closely; a couple of runs saw nothing purely from positioning.)

**Respawn/KotH mechanics (Tony, hardware-confirmed):** KotH also **starts white/neutral until shot**
(same as Respawn). Respawn: once a gun knows a respawn station is configured, its **auto/self-respawn is
disabled**; respawn via (1) the grenade **button** (respawns the team in-area) or (2) **face the station
with the headset front + pull trigger** (signals the grenade to emit a respawn). **Engine implication
(new followup B12):** the grenade's respawn-station and our **host-driven `$SPAWN` respawn are competing
authorities** — an engine using grenade respawn stations must NOT also host-respawn those players (or
must reconcile), else double/conflicting respawns. Pick one respawn authority per mode.

### 38. KotH charge decode — BLOCKED by a fire-vs-read catch-22 (key finding)
Tried to decode the KotH charge/progress field (shoot the Hill, watch a beacon counter climb). **Blocked**
by a config conflict now clearly identified: **all clean grenade-beacon captures were in BARE mode; every
`minfire`/in-game run showed zero grenade frames.** Inference: **a spawned gun drops incoming IR that has
no `$SIR` table entry** (silently), while a **bare/idle gun reports any IR as raw `$HIR`.** So firing
(needs a spawned weapon) and reading the grenade beacon (needs bare) can't happen in the same config.
Shooting the neutral Hill in minfire made it **flash white** (charge hit-ack) but it didn't capture to
blue (aim — few shots landed on the grenade; the emitter must face the headset dome).
**Fix for next time:** craft a **`$SIR` entry mapping grenade IR (protocol type 15) to "report, no
effect"** so the gun fires AND surfaces grenade beacons in one config — then charge decode + live capture
become straightforward. Also: a fixed mount aligning the grenade emitter to the headset removes the
aim variance. Filed as refinement of B8/G6.

### 39. Grenade communication mechanism + Hill holder-perk (hardware-confirmed)
Tony started a **manual game on E20D**, shot the grenade Hill → "hill captured" + a **ticking possession
timer**, and **gained a higher rate of fire** while holding it. Meanwhile 3D4F (BLE-connected, bare, idle)
read the **same** captured-Hill beacon: `$HIR,0,15,0,**0**,8` (token4=0 = E20D's game team; was 2 neutral,
1 when a team-1 gun claimed a point earlier — token4 = owner, confirmed a 3rd time). Beacon ~every 5 s;
no charge field visible (token6/7 stayed 0), so the "ticking" is E20D's **local** hold-timer, not in the
beacon.
**Mechanism (the cornerstone):** the grenade is an **IR broadcaster** — one omnidirectional beacon,
received by *every* headset in range. Guns in a game react (audio/timer); a BLE-connected tagger **relays
it over BLE** (the state-display works by putting one connected tagger in grenade range). No pairing/
addressing for objective modes. The grenade **also pushes perks over IR** — holding the Hill grants a
**rate-of-fire boost** to the holder's gun. So: broadcasts state AND modifies the holder's gun, all via IR.

### 40. G7 — grenade USB-C: no data interface (charge/mode only so far)
Plugged the grenade into USB-C (Windows tower). **No USB device enumerated** in either normal or a
button-hold entry — verified by a plugged/unplugged PnP diff (0 delta) and a scan for COM ports /
removable drives / DFU/unknown devices (none; COM3=touchscreen `CT21INCH`, COM4=WSL virtual, both
pre-existing). **Button-hold + USB put the grenade into a NEW purple-LED mode** (not one of the 5 game
colours) — likely a firmware-update/bootloader or special state — but it exposes **no Windows-visible USB
data interface**. Open: **confirm the cable is a DATA cable** (test with a phone in file-transfer) — if
data-capable and still nothing, the grenade USB-C is **power-only / needs a proprietary tool**. So the
reliable non-IR channel Tony hoped for is **not available via plain USB** on current evidence; IR-beacon-
relay (a BLE tagger in range) remains the state-read path. Script: `scratchpad/gren_serial.py`.

**Refinement:** the purple LED was **transient** — holding the button just entered the **normal setup
cycle** (purple ≈ a "USB power detected" flash, then it rolled into the mode colours; Tony released on
**yellow = Respawn** and it locked). So USB did **not** unlock a special mode; button-hold = normal setup
regardless of USB. **G7 = clean negative: USB-C is power/charge only, no data interface.** State-read
stays the IR-beacon relay.

**⚠️ CORRECTION — G7 is INCONCLUSIVE, not negative.** Tony: the USB-C cable/port used is **the same one
that did USB debugging on his Pixel 10 and then LATER STOPPED WORKING for debugging** — i.e. its **data
lines are flaky/degraded** (power still works → the grenade's purple flash). So the grenade enumerating
no data device may be the **bad cable**, not a power-only port. **Retest G7 with a known-good USB-C DATA
cable** before concluding anything. The grenade may yet expose a serial console / drive / DFU — this is
still open, and would be the reliable non-IR channel if it exists.

**⚠️ G7 fully INVALIDATED — dead data path.** Control test: plugged Tony's **phone** (USB debugging on)
into the same tower USB-C port + a **new C-to-C cable** → **it did not enumerate either** (device count
unchanged, no Pixel/MTP/ADB device). So the **tower USB-C port (or cable) carries no data** — every
grenade USB test ran through a dead path and tells us **nothing** about the grenade. **G7 is untested, not
negative.** Retest plan: establish a **known-good USB data path first** — use a **USB-A port that already
works** (C-to-A cable) or a confirmed data-capable USB-C port, **verify with the phone (must enumerate)**,
THEN test the grenade (normal plug, and OFF→hold-button→plug for a possible bootloader/disk mode).

### G7 RESOLVED — grenade USB-C is power/charge only (VALID test) ❎
Redone with a **confirmed-good data path**: Tony's **Pixel 10 Pro enumerated** on the same port+cable
(WPD "Pixel 10 Pro" + "ADB Interface", VID_18D1) → the path does data. With the grenade on that path,
**nothing enumerated in ANY state**: powered off, powered on (normal), or the **purple button-hold mode**
(purple is a transient boot/setup flash → rolls to yellow=normal setup; NOT a DFU). No COM port, no
removable drive, no unknown/DFU device. **Conclusion (now valid): the grenade's USB-C is power/charging
only — no serial console, no mass storage, no USB DFU.** No pinhole/PROGRAM pin exists either. So there is
**no non-IR data channel** to the grenade; the **IR-beacon relay** (a BLE-connected tagger in range,
reading `$HIR,0,15,0,<team>,<mode>`) is the only way to read grenade state. Closes G7.

**Airtight confirm:** rapid-polled USB (~12 samples over ~36 s, covering the full ~5 s purple window and
repeats) — device count held at 33 the entire time, zero new/anomaly devices. Grenade USB-C exposes no
data in ANY state. G7 definitively closed: **power/charge only.**

### Note (Tony, 2026-08): native multikill callouts → local kill tracking + shooter-side kill knowledge
Correction to the "gun keeps no game state" framing: a BRX gun **natively announces "double kill"** when
you tag two different enemies back-to-back in TDM. So the firmware tracks **local ephemeral kill state**
(recent-kill count/timing) for its own audio, AND the **shooter's** gun *knows it scored a kill* — which
means it receives a hit/kill confirmation from somewhere (likely the **nRF radio**, `NRFhost`/`NRFslave`;
possibly a return IR ack). This does NOT contradict §7n (no host-*readable* persistent score) — it's
ephemeral local state, not a queryable score. Implications + tests filed as **FOLLOWUPS D4** (and ties to
D1 nRF): (a) do our BLE-configured games get multikill/streak callouts free? (b) is there a shooter-side
kill event over BLE (cleaner attribution than victim `$HP,0`)? (c) nRF vs IR-ack mechanism. Also means
some "announcer" sounds (multikill/streak/first-blood) are **native**, not host-`$PLAY` — we add custom
ones on top, but the base multikills come from the firmware.

### 2026-08-24 — LIVE diagnostics confirmed (firmware + battery) on Tactix-3D4F ✅
First live run of the `diagnose`/`fleet` BLE health sweep against a real tagger (FE:AD:FD:10:3D:4F,
"Tactix-3D4F") via the Windows venv. Confirmed what Mission Control can read per tagger, no cable:

- **Firmware:** `$VERSION` → `v4.32`, host image `devhost.03`, `is_devhost=true`. **Cold `$VERSION`
  gets NO reply** — the gun answers only after the ritual preamble. Fix: `diagnose()` now sends
  `$STOP,*` → `$PHONE,*` → (`$VERSION,*`) and releases with `$STOP,*` on exit ($PHONE locks the on-gun
  menu). With the handshake, firmware read is reliable.
- **Battery:** caught a live `$VOLTS,7521,3955,43,76,*` → **7.52 V pack, 3.96 V cell, token3=43, token4=76**;
  a second sample `7533,3951,44,…` = 7.53 V / **44%**. **token3 rose 43→44% as the charger was plugged in
  → token3 IS the state-of-charge %.** token4 (76) unchanged — a separate metric (health/level?), still
  TBC. `$VOLTS` **streams only after `$PHONE`** and on a **~30 s cadence** (samples landed at ~29 s), so a
  cold one-shot battery read needs a ~34 s listen (`diagnose` default bumped 10→34); over a *held* MC
  connection it updates live every 30 s for free.
- **Ping:** `$PING`→`$PONG` **never answered** on this firmware — `pong_latency_ms` stays null. Don't rely
  on `$PING` for liveness; use the VOLTS/notification stream as the heartbeat.
- **Headset detection:** no dedicated BLE query, but §7 shows **no-headset = tagger accepts the connection
  then silently drops it with zero frames; headset-linked = holds and streams.** So **a stable link that
  returns data ⇒ headset present** (getting `v4.32` + `$VOLTS` back = headset was linked). USB `QUERY` is
  explicit (`Headset Version`, `Head: <V>`) and is the only path to **headset battery**.
- **BLE hold bug (§7e) — client fix:** the ~6.6 s client-side drop struck during `start_notify` (probe
  crashed twice with WinError before any data). `connect()` now wraps connect+pair+`start_notify` as ONE
  retryable unit (was: only `client.connect()` retried) → the resilient connect held a 35 s session and
  caught the 29 s `$VOLTS`. Low battery made the link markedly flakier (first sweeps returned nulls until
  charging + the retry fix).

**Net:** Mission Control CAN show, per tagger over BLE: **firmware/host-image, battery pack/cell voltage +
charge %, connection health**. Headset presence is inferable (link-hold); headset battery + serial/PIN are
USB-only. Data contract for the fleet dashboard is confirmed real.

### 2026-08-24 — `$QUERY` over BLE ≠ the USB device record; headset PIN is USB-only
Tony asked whether we can read **which headset a tagger is paired to** over BLE (the Serial/Head PIN that
matches the headset's unique-ID sticker). Findings:
- The **paired-headset identity lives in the USB `QUERY` device record** — `Serial Number/Head PIN: <…>`
  ("matches the sticker on the paired headset"), plus `Headset Version: hds.59`, `Head: <V>`. That's the
  **USB serial console (B7), cable-only** — not yet built as a backend.
- **`$QUERY,*` DOES reply over BLE**, but it's a *different* command: it returns a `$`-framed status
  array `$QUERY,0,0,0,0,0,,1,0,,0,,0,,0,,…,*` (all-zero here, no game running) + a `$LCD,…`. **No serial,
  no headset PIN, no version.** Shape (a leading fixed group then ~11 `value,,` pairs) looks like a
  per-slot/player state table — worth decoding under a live game, but it is NOT the device record.
- Bare/CR variants (`QUERY\r`, `QUERY\n`, `$QUERY\r`) got **no reply** over BLE — the USB console's
  CR-terminated `QUERY` is a distinct interface from the BLE NUS `$…,*` protocol.
- **Note on names:** the **BLE advertised name** is `Tactix-3D4F` (derived from the MAC tail `3D:4F`),
  while the USB record's **`Gun Name` is `Tactix2`** (the settable name our `$NAME`/gamertag writes). Two
  different fields.

**Takeaway for Mission Control:** matching taggers↔headsets↔stickers (armory inventory) needs the **USB
serial-console backend (B7)**; BLE alone gives headset *presence* (link-hold) but not the paired headset's
identity. The BLE `$QUERY` status array is a separate decode target (possible live player/score state).

### 2026-08-24 — B7 USB serial console BUILT: QUERY device record read live ✅
`brx_mcp/usbconsole.py` + CLI `usb-query [port]`. The tagger's USB "Programming Port" enumerates as a
**Teensy USB CDC (VID 16C0)** — on the tower it was **COM5** (VID `16C0:0483`), distinct from the ESP32
(303a) and a CH340 (1a86). Sent `QUERY\r`, read until quiet, parsed the full device record:

- **Serial Number/Head PIN = the paired headset's sticker id** (read live; value kept in the local backup
  only, NOT the repo). **This is the answer to "which headset is it paired to"** — USB-only; BLE can't.
  **CONFIRMED (Tony, 2026-08-24): the PIN read over USB physically matches the unique-ID sticker on the
  paired headset.** So `usb-query` is a reliable tagger↔headset identity source for the armory inventory.
- `headset_linked=true`, **Headset Version `hds.59`, Head 4.0 V** (headset battery), Gun 7.28 V, PlayerID 0,
  FieldID 1, NRFhost/NRFslave/devHost = 1, **Grenade Pin 7052**, Laser `UNTESTED`, PCB-5, BTchip 4,
  BT central `devhost.03`, Tested by `JB`.
- **Real-format quirks** (vs the documented sample): `Gun Name` is **NUL-padded** ("Tactix\0\0…"), lines end
  **`\r\r\n`**, `Laser` can be a word (`UNTESTED`) not mW, `Grenade Pin` is a real non-zero value. Parser
  strips control/NUL chars, captures `laser` as string + `laser_mw` only when numeric. `parse_query` is pure
  + unit-tested (6 cases); `save_backup` writes `~/.brx-mcp/device-backups/<serial>.txt` (out of repo).

**Unlocks:** an **armory inventory** — cable each tagger, `usb-query`, map tagger↔headset-sticker↔serial for
match-day gear tracking (Mission Control bench-prep tier). **Not built:** `SETUP` (writes tagger id / re-pairs
the headset → feeds P2 per-player identity) — deliberately deferred; it's factory provisioning, gate on confirm.

### 2026-08-24 — 4-tagger BLE fleet: battery reliability tracks RSSI (persistent-connection fleet needed)
Swept 4 powered taggers over BLE: **RocTheLegend-FE30** (D9:50:2F:98:FE:30, custom-named), **Tactix-9498**,
**Tactix2-E20D** (D8:AE:5F:60:E2:0D), **Tactix-3D4F** (FE:AD:FD:10:3D:4F). All 4 discovered + reachable.
**But only the strongest-signal one returned a battery** (RocTheLegend, rssi −62 → 68%); the three at
−73…−77 dropped before their `$VOLTS` arrived (E20D read 48% on an earlier closer pass).

**Root cause / design finding:** the serial one-shot `diagnose` (connect → wait ≤34 s for the 30 s-cadence
`$VOLTS` → disconnect) is **unreliable on marginal links** — the ~6.6 s client drop (§7e) often kills the
session before the first VOLTS on weaker-signal taggers. Firmware also missed on all 4 this pass (VERSION
reply lost). **Fix for a robust fleet dashboard: hold PERSISTENT connections** (ConnectionManager keeps all
taggers subscribed; collect VOLTS as they stream every 30 s + retry VERSION) instead of serial
connect-diagnose-disconnect. Filed as a followup. **The reliable armory data is USB `usb-query`** (exact
gun+head voltage, headset PIN) — cable each tagger; BLE battery % is a rough live gauge, best for near guns.

### 2026-08-24 — armory USB↔BLE correlation via gun name; cp1252 console fix
Cabled tagger 3 → `armory`: **Gun Name `RocTheLegend`, headset PIN `<redacted>`** (hds.59, head 3.91 V, gun
7.80 V, PCB-5, PID 0, linked). Its BLE advert was **`RocTheLegend-FE30`** — so **the BLE name =
`<GunName>-<MAC tail>`**, and a *custom* gun name lets us **correlate a USB identity record to its BLE
address** (stock "Tactix" names collide; custom/`$NAME` gamertags don't). Ties the gamertag feature to the
armory: name each gun uniquely → the two diagnostic tiers link up.
Serials are sequential across the fleet (values redacted — real PINs live only in `~/.brx-mcp/armory.json`, never the repo).
**Bug fixed:** the armory table used `✓`/`·`; the Windows console is cp1252 and threw `UnicodeEncodeError`
mid-row (which bubbled up as a usage dump). Table is now ASCII (`yes`/`no`).

### 2026-08-24 — CONFIRMED: `$NAME` persists over BLE (cable-free rename)
Open question resolved. Sent `$STOP,* → $PLAYX,0,* → $NAME,Alpha,*` over BLE to a stock gun
(DF:F5:DA:08:94:98, was `Tactix-9498`). The advert did NOT change live; **after a power-cycle it came
back as `Alpha-9498`.** So:
- **`$NAME` writes the PERSISTENT gun name over BLE** — no USB/`SETUP` needed to rename a gun.
- **The BLE advertised name is `<GunName>-<MACtail>` and only refreshes on boot** (set from the stored
  name at power-on). To verify a rename, power-cycle then re-scan.
- New CLI `rename <address> <name>` (mirrors the app ritual, no `$PHONE` so the on-gun menu isn't locked).

**Impact:** the gamertag/`$NAME` feature genuinely renames guns for good. Mission Control can give each gun
a **unique** name over BLE at bench prep → the two stock "Tactix" guns become distinguishable AND
correlate across the USB-armory and BLE tiers by name. `SETUP` (USB) is still needed only for the
headset-pairing PIN + PlayerID (P2), NOT for the display name.

### 2026-08-25 — Grenade video tidbits (Jay) + process naming: Armory Setup & Muster
No hardware this pass — Tony relaying facts from **Jay's grenade video** (Extreme Laser Tag And More! /
@extremelasertag3602) and naming two operator processes. Credit Jay for the grenade/respawn framing.

**Grenade tidbits (Jay):**
- **Respawn-station arming is a PRE-GAME configuration.** The grenade is button-set to Respawn mode and its
  **respawn-station IR must be delivered to each tagger BEFORE the game starts**. Once a tagger has received
  it, that tagger **knows during the game to respawn at the station instead of automatically** (self-respawn
  disabled). ⚠️ **Reconcile:** exp-log #37 (Tony, hardware) framed the same arming as **signal each gun just
  AFTER `$SPAWN`** (guns inert until live; two-horn start buys ~5 s). **Likely the same arming action** —
  pre-game arming is the natural config step; the "after start" wording reflects that a timed match can't arm
  until guns are live. **Did NOT silently overwrite** grenade.md's note — both accounts are now presented
  there with the likely resolution, and a hardware item (verification-checklist) will pin the exact
  before-vs-after-`$SPAWN` timing and whether the per-player button-press is separate from the passive beacon.
  **UPDATE (same session — Jay, RECONCILED):** the timing question is resolved — there are **two arming
  paths**. If you **START the game BEFORE** setting the grenade to a respawn station, **pressing the grenade
  button** beams the station IR to each gun in range and **forces respawn-station mode mid-match** (not
  auto-spawn). So exp-log #37's "signal each gun after start" = the **grenade-button arming**, and it works
  post-`$SPAWN`; Jay's earlier "arm pre-game" = passive/config arming. **Both valid**, and the button press
  is the reliable per-gun (re-)arm at any time. Open HW items narrowed to: (a) a button-armed gun **stays**
  station-respawn all match; (b) does the passive beacon alone (no button) arm? Docs updated: grenade.md,
  field-process.md, verification-checklist.md, FOLLOWUPS B12.
- **Physical labeling.** Stock BRX taggers ship **unlabeled** and are easy to mix up (can't tell which gun
  pairs to which headset). **Recommended Open BRX practice (Tony):** use a **sticker/label printer** to print
  the **headset's 5-char code (Serial / Head PIN)** onto the **tagger** — the physical gun↔headset pairing
  then reads at a glance, complementing the digital armory map (same headset PIN ↔ gun ↔ MAC).

**Process naming (Tony, current):** documented two recommended processes in the new **`docs/field-process.md`**:
- **Armory Setup** — one-time, per-tagger enrollment: isolate (one gun on), `enroll` (USB headset-PIN read +
  isolation-bind of its BLE MAC), `rename`/`$NAME` the gun to its **sticker id** (BLE advert self-identifies),
  physically label it with the headset code. Output: the permanent gun↔headset↔MAC map (`~/.brx-mcp/armory.json`)
  Mission Control reads. Gun `$NAME` = hardware sticker id; a player's vanity **gamertag is a separate MC display
  layer** (do not conflate).
- **Muster** — per-game pre-game arming: config-all-then-spawn barrier (B10), assign teams/loadouts, and — for
  objective modes — **Station Arming** (deliver station IR to each tagger before kickoff, per the tidbit above).

**Docs touched:** `reference/grenade.md` (§Respawn Station reconciliation + Muster pointer), new
`field-process.md`, `verification-checklist.md` (Station-Arming timing + Armory/Muster end-to-end),
`FOLLOWUPS.md` B12, `README.md` index. No code changes.

### 2026-08-25 — $VOLTS token4 is variable (cell-voltage SoC); fleet battery unreliable
Surfaced `$VOLTS` token4 (`level_pct`) in `diagnose`. Data points:
- cell **3.955 V → t3=43, t4=76**
- cell **3.675 V → t3=42, t4=29** (Tactix-9498, this session)
**token4 is NOT constant** (earlier "fixed 76" guess was wrong) — it swings strongly with **cell voltage**
(76 @ 3.96 V → 29 @ 3.68 V), a plausible Li state-of-charge curve; **token3 stayed flat (43→42)** across the
same swing (and earlier rose 43→44 while charging). **Leaning:** t4 = a finer cell-voltage state-of-charge,
t3 = a coarser/pack-level metric. Not conclusive — needs a **controlled single-gun charge/discharge sweep**
watching both tokens to decide which is the "real" charge %.
**Fleet battery reliability = poor (confirmed):** a 4-gun `fleet` caught battery on only **1/4** (Tactix-E20D not
found; Tactix-FE30 −63 & gun 4 −84 connected but missed `$VOLTS`). The random ~6.6 s client drop vs the 30 s VOLTS
cadence makes the serial one-shot sweep unreliable → a **persistent-connection fleet** (hold links, collect
VOLTS as they stream) is the fix for a live dashboard. Not RSSI-pure (Tactix-9498 −70 got it; Tactix-FE30 −63 didn't).

### 2026-08-25 — 🎯 FIRST LIVE M0 GAME (Session A) — the engine works on real guns ✅
Ran `play tdm D9:50:2F:98:FE:30 DF:F5:DA:08:94:98 game_time_s=120 respawn_s=10 frag_limit=3 volume=69`
(Tactix-FE30 team1 vs Tactix-9498 team2). **Full game, end to end, on real hardware:**
```
game live: {...}                       # config-all-then-spawn barrier → both live together (B10)
🎯 team1: 1   ↻ respawn Tactix-9498           # Tactix-FE30 tagged Tactix-9498; host-respawn brought it back
🎯 team2: 1,2,3   ↻ respawn Tactix-FE30 ×3    # Tactix-9498 tagged Tactix-FE30 3×, each respawned
🏆 GAME OVER — team2  scores={1:1, 2:3} # frag_limit=3 → correct winner
```
Final scoreboard: Tactix-FE30 1 kill/3 deaths, Tactix-9498 3 kills/1 death. **Validated: config barrier, real
`$HIR`/`$HP,0` kill scoring + team credit, host respawn, frag-limit end + winner — AND the BLE link held
the entire match (Tier-0 direct BLE sustained a 2-gun game, no mid-game drop).**

**Resilience bug fixed (Tony: "our scripts need to be more resilient than that"):** the FIRST attempt
crashed mid-score — the 🎯 emoji in the scoreboard hit the Windows console's cp1252 codec
(`UnicodeEncodeError`, which is a `ValueError` → main swallowed it into a usage dump). Root-caused the
whole class: `main()` now `reconfigure(encoding="utf-8", errors="replace", line_buffering=True)` on
stdout/stderr — no glyph can ever crash a command again, and live output streams in real time; the driver
announcer also flushes. (This is the 3rd time this cp1252-glyph class bit us — now killed at the source.)
Not exercised yet: time-limit end, respawn ramp.

### 2026-08-25 — teardown bug: dead gun left stuck; fixed the game-over sequence (live, on Tactix-FE30)
After the first live game, the loser (Tactix-FE30, dead at frag-limit) was left **stuck showing the death-glow** —
the old `END_SEQUENCE` (`$HLED,,6` + `$STOP` + `$CLEAR` + `$PLAY,VS6`) never REVIVES a gun that's dead at
game end. Dialed in the fix live against Tactix-FE30 (Tony observing each step):
- **`$SPAWN,,*` revives** the dead gun (`$LCD,45,70` — HP/armor restored) → clears the death-glow. But it
  re-spawns into a live state: pulls the **team colour** on the tagger + plays the **spawn voice ("GET SOME"**,
  the Heavy `V3I` line).
- **`$PLAYX,0,*`** immediately after silences that spawn voice (confirmed: no voice).
- **`$STOP,*` + `$CLEAR,*`** settle the game state; **`$HLOOP,0,0` + `$HLED,0,0,0,0,0,0`** blank the headset
  (confirmed: headset dark).
- The tagger keeps **pulsing its team colour** — Tony's call: that's a nice "you were on team X last game"
  end-of-match indicator, so teardown deliberately does NOT reset `$TID`.

**New datum — `$TID` LED colours:** `1`=blue, `2`=yellow, **`0`=RED** (not off; there is no "$TID off" — the
gun always shows some team colour; true LEDs-off needs the unconfirmed `$GLED`/P17 path).

New `END_SEQUENCE` = `$SPAWN,,* → $PLAYX,0,* → $STOP,* → $CLEAR,* → $HLOOP,0,0,* → $HLED,0,0,0,0,0,0,*`.
Exposed as a manual **`reset <address>`** CLI (same sequence). Open: whether `$LIFE` alone revives a dead
gun (would avoid the SPAWN→GET-SOME→silence dance) — untested (needs a dead gun on the bench).

### 2026-08-25 — sim-hardening: 7-agent team, ~156 scenarios across all 9 modes; 1 real bug found+fixed
Built `SimGame` (brx_mcp/sim.py) — a deterministic harness driving the real GameDriver + FakeTaggers for
ANY mode (gun hits + station objective events + timers), then ran a **7-agent team** to write exhaustive
scenario suites (`tests/test_sim_*.py`), each asserting CORRECT behavior so a failure = a real bug:
deathmatch(24), survival/lms(20), cs(19), domination(22), ctf(20), extraction(20), config→frames(31).
**Suite 151 → 307 green.**
- **REAL BUG found + fixed:** `DominationEngine.on_event` used a raw `int()` for the CAPTURE team,
  bypassing the `_team()` zero/garbage guard `CtfEngine` uses → `$CAPTURE,A,0` fabricated + scored a
  phantom "team0". Fixed (route through `_team()`); regression test added. Same class as the CTF phantom
  fixed earlier — the sim caught the one that was missed.
- **Confirmed correct end-to-end (through the driver, not just the engine):** every config→frame mapping
  ($GSET/$PSET/$WEAP/$VOL/$AMMO/$TID), setup config-all-then-spawn ordering (B10), class+kid presets,
  respawn ramp/lives, attribution fuse, syphon/regen numerics, kid_mode FF-off, CS round rules incl. the
  late-plant guard, CTF possession + malformed-token guards, extraction drop policies + respawn-clock guard
  + dead-killer anti-double-credit, teardown revive.
**Payoff for bench time:** game *logic* for all modes is now exhaustively verified in software, so a
hardware session confirms only what the sim CAN'T model (BLE reliability/timing, physical LED/headset/
audio state, real IR) — not logic. That's the efficient-bench goal.

### 2026-08-25 — live-path resilience + diagnostics hardened (with adversarial review)
Beyond the mode-logic sim battery, hardened the run_live control path and diagnostics against the BLE
reality we hit on the bench, all testable via the FakeTagger/FakeConnectionManager:
- **run_live resilience:** connect-grace (play with the taggers that connect; error if none), wall-clock
  safety (a stalled clock-less game force-stops instead of hanging), and mid-game reconnection (a dropped
  gun rejoins). A 2-agent adversarial review then found **3 real-BLE HIGH bugs the fake couldn't show**
  (all fixed): (1) an in-loop reconnect could freeze the whole game ~20 s on a real `BleakClient` timeout
  → time-boxed to 3 s; (2) a flapping link reconnected forever → rate-limited (8 s) + total cap (6/gun);
  (3) `resetup` respawned a gun regardless of engine state → now only `$SPAWN`s if the engine considers
  the player alive (else the engine's own Respawn brings it back), avoiding a gun-alive/engine-dead desync.
- **diagnostics:** the `$STOP→$PHONE→$VERSION→$VOLTS` handshake (fixed live 8-24) + `fleet_status` extracted
  to a bleak-free, transport-agnostic `diagnostics.py` and unit-tested against the fake (firmware+battery
  read, battery-needs-`$PHONE`, cold-`$VERSION`-silent, unreachable-reported, fleet dashboard assembly).
- **FakeTagger** gained: drop / fail_connect / is_connected / heals-on-reconnect / $PHONE-gated $VERSION /
  duplicate-alias guard — so the reconnection, connect-grace, and diagnostics flows are all CI-covered.

**Suite 151 → 317 green this session.** Every game-logic and live-path control-flow path is now verified
without hardware; the bench confirms only BLE reliability/timing and physical LED/audio/IR (see the
EFFICIENT BENCH PLAN in verification-checklist.md).

### 2026-08-25 — D4 probe (bench, Tactix-FE30 vs Tactix-9498): NO shooter-side kill event on BLE
Armed 2 guns for TDM and logged EVERY rx frame from both while shooting (throwaway `probe_kills.py`).
Over ~122 s the ONLY rx frame types on ANY stream were: `$BUT` (trigger), `$ALCD` (ammo), `$HIR` (hit,
victim-side), `$HP` (health, victim-side incl. `$HP,0,0,0` on death), `$VOLTS` (battery). **At the kill,
the SHOOTER's stream showed only `$BUT`/`$ALCD` — no `$DD`, no kill/streak/multikill frame, nothing.**
Conclusions (D4):
- **No shooter-side kill event over BLE.** A kill is host-visible ONLY from the victim (`$HP,0` + the
  victim's last `$HIR` giving the shooter's TEAM, not the specific gun). So **per-player kill attribution
  over BLE is impossible** (team-granularity only) — confirms every attribution design choice (unique teams
  for FFA/juggernaut; true per-player needs P2).
- The gun's native "double kill" knowledge therefore rides a **non-BLE channel** (the nRF mesh / IR-ack) —
  it never surfaces on BLE. → **Offline/relay scoring can't ride BLE alone; you'd tap the nRF radio (D1),
  most likely via a Companion listening to the mesh.** That's the concrete next architectural probe.
- Note: the gun streamed `$VOLTS` while game-armed (no `$PHONE` sent) — telemetry opens under game config too.
STILL OPEN (needs 3 guns + listening): does the "double kill" AUDIO fire under OUR config (free announcer
sounds, D4 #1). And the nRF tap itself (can a Companion read the mesh?).

### 2026-08-25 — direct-BLE 3-gun sync arm is UNRELIABLE (repeatable): only 2 of 3 enter the game
> **⚠️ SUPERSEDED / WRONG — see the "headset gate" entry below (same day).** The 3rd gun's
> **headset was off**, which silently blocks a tagger from joining a game (§7m). With all three
> headsets on, the exact same synced-arm code (`arm_test.py`) armed all 3 **first-try, zero
> retries**. Direct-BLE 3-gun synced arm **works**. The diagnosis below (marginal BLE link / config
> burst) was a misread of a headset lockout. Kept for the record.

Tried the 3-gun multikill test (shooter + 2 targets) three times. Every time all 3 **connect** ("phone
connected") but **only 2 actually enter the game** (get the 3-2-1 countdown + "get some" spawn + LEDs) — a
marginal 3rd link drops during the ~25-frame config burst, so that gun stays half-configured and never
spawns. Guarding the sends + a config-all-then-spawn-all barrier (B10) + a re-config-if-silent retry got
all 3 to *echo* frames, but Tony confirms **still only 2 in-game**. **This is a real finding, not a fluke:**
reliably arming/syncing 3+ guns over **direct BLE** doesn't work (the ~6.6 s client drop, §7e, hits the
config burst) — strong evidence that real multi-gun games need the per-player **Companion (B1)** driving
config locally, not a central host fanning out over one flaky radio. Also note the community gotcha (BRX
serial wants ~5 ms/char) — our fast burst may overrun a marginal link. **Multikill-AUDIO test (D4 #1)
deferred** — it needs 3 reliably-armed guns, which direct BLE can't deliver today. The pivotal D4 finding
(no shooter-side kill event on BLE) stands from the 2-gun probe.

### 2026-08-25 — LANDMARK: the feedback fork resolved — MC rebuilds native AUDIO over BLE
> **⚠ PARTIALLY SUPERSEDED — see the later "SOLVED: native kill feedback IS BLE-drivable (`$SFLASH`)"
> entry below.** This entry's finding #3/#4 ("green-sight is nRF-only, not BLE-drivable; audio
> compensates") is **wrong**: it probed `$GLED` (the wrong, team-derived command). The Callsign capture
> (§7o) proved the **visual is BLE-drivable too** via `$SFLASH`. The rest of this entry (headset gate,
> HW-proven 3-gun arm, MC-as-scorekeeper) stands. Kept for the record.

Big session, 3 guns (Tactix-FE30/FE30 shooter, Tactix-9498/9498, Tactix-E20D/E20D). Multiple prior conclusions
overturned. Order of discovery:

**1. Headset gate (overturns "3-gun BLE arm unreliable").** E20D failed to join twice — root cause
was its **headset was OFF**, not BLE/config. §7m ("no headset → connects then silently drops, no game")
confirmed live. Once its headset was on, `arm_test.py` (connect-all → config-each → hold-all-live →
synced `$SPAWN` burst) armed **all 3 first-try, zero reconnect retries**, repeatably (4×).
→ **Direct-BLE 3-gun synced arm WORKS.** The earlier "unreliable/pilot-only" entry is wrong (banner added).
→ **REQUIREMENT: MC must detect headset-present as a pre-game gate.** A dark headset = a player who
  stands there dead all round, and it silently blocks join. Detectors: (a) cabled muster — `QUERY` →
  `Headset Version:` present & not `?`; (b) field/BLE — send spawn, require the `$LCD,45,70,…` echo
  within ~500 ms; silence = not ready. Behavioral detector proven live (headset-less gun = 100% silent).

**2. Damage model + clocks.** ~10 tags to kill: armor absorbs first (`$HP,45,61→52→…` armor ~9/hit)
then HP bleeds to `$HP,0,0,0` + `$LCD,0,0,0,0,36,108`. Double-kill window = **4 s** (`game-medals-config.json`
Key 14). Each gun stamps events in its **own boot-local clock** (9498 vs E20D baselines differed ~5 s) —
**MC must host-stamp arrival, never trust gun `t_ms`.**

**3. THE FORK — native feedback is nRF, BLE-invisible.** Under our BLE-config game: clean kills, both
victims → `$HP,0`, but the shooter's sight stayed **RED** and no "double kill" (re-tested with Tony's
eyes locked on the sight — confirmed red on kill under our config). Then a **native offline FFA** (gun
menu, no phone) with a PASSIVE BLE tap on FE30 (`passive_listen.py`, zero game-altering sends): green
sight each kill, "all clear", "double kill" all fired — and the BLE tap captured **ZERO frames the entire
game**. → Native kill-confirm / green-sight / killstreak is **100% nRF peer-to-peer, invisible to a BLE
central**. Our BLE `$GSET/$PSET/$TID/$SPAWN` config does **not** engage that nRF peer layer (sight stays
red); the gun-menu native game does. `$DD,<killer>,<killerTeam>,<victim>,<nonce>` is a **JEDGE host-side
convention, NOT a stock-tagger BLE command** (brx-protocol.md:90).

**4. THE RESOLUTION — MC reconstructs the AUDIO layer over pure BLE.** `play_probe.py` → FE30:
`$PLAY,VA20,4,6,,,,,*` ("connection established") then `$PLAY,VAA,4,6,,,,,*` (a kill voice line) —
**both played on command over pure BLE** (Tony: "yes va20, then kill"). So **MC as BLE scorekeeper can
drive the full announcer/killstreak/medal audio**: watch every gun's `$HP,0`, attribute (team-granular
over BLE; per-player needs P2/nRF), check the 4 s window, `$PLAY` the right line to the shooter. The
green-SIGHT visual flash is **NOT BLE-drivable** — three `$GLED` effect variants produced no flash
(Tony: "didn't notice the led or the sight flash"), consistent with §7i (GLED colour is team-derived
from `$TID`). Audio compensates for the lost visual.

**Net verdict:** "direct-BLE = pilot-tier only" is **DEAD**. A BLE-only Mission Control delivers
**authoritative scoring + native-feeling AUDIO feedback** for real multi-gun games. Sole stock-feel
sacrifices over pure BLE: the green-sight visual flash (nRF-internal) and true per-player kill
attribution (team-granular without P2/nRF). The nRF tap (D1/Companion) is the upgrade for per-player
attribution + observing native-mode games — **no longer required for a good game.** OPEN: can the native
nRF-peer mode (which gives green-sight + native audio for free) be triggered over BLE, or is it an
nRF-radio handshake never exposed on BLE? Bench tools in `mcp/`: `arm_test.py`, `passive_listen.py`,
`play_probe.py` (throwaway; arm + scorekeeper-audio logic should migrate into the driver).

### 2026-08-25 — NRFL-Bases source pull: BRX IR protocol DECODED; gun-nRF still separate
Pulled LaserTagMods `NRFL-Bases` to try to get the BRX gun's native nRF mesh params (for the nRF tap,
FOLLOWUPS B18). **Result: the bases don't tap the gun's nRF at all — they receive the gun's IR** and use
nRF24 only *base-to-base*. So this source does **not** reveal the gun's `NRFhost/NRFslave` kill-confirm
mesh params (still unknown). **But it handed us two bigger wins:**
- **BRX IR shot protocol decoded** (`Nodes/node1.ino`) → wrote `protocol/brx-ir-protocol.md`: ~25-bit
  word after a **2 ms sync**, pulse-width bits (**~1000µs=1 / ~500µs=0**, split 750µs), fields
  **B4 bullet · P6 player-id · T2 team · D8 damage · C1 crit · U2 · Z parity** (valid if `Z1≠Z0 && Z2<250`).
  **This largely answers B13** — verify on our VS1838B (arriving 2026-08-26) before emitting.
- **Per-player attribution (P2) is solvable over IR, no nRF needed:** every shot carries a **6-bit player
  id**. An IR receiver (VS1838B + ESP32-S3) decodes WHO fired. Prereq unchanged: guns need **distinct ids
  set via `SETUP`** (QUERY PlayerID reads 0), else `P` is identical for all.
- Reference nRF24 design for **our own** mesh (Companion/bases): CE/CSN=9/10, **1Mbps**, ackPayload,
  5-byte addrs `0xB3B4B5B6E0..F5`, channel 76 (RF24 default). Useful for B1/B4, not for tapping the gun.

**Hardware ordered (arriving 2026-08-26):** ELEGOO 235-pc kit + CHANZON 940nm IR (emitters + VS1838B) +
2× ESP32-S3-DevKitC-1 = the **IR bench** (B13 verify, B4, range). **nRF24 kit chosen** (Aideepen 3×
PA/LNA + 3× AMS1117 adapters, overnight). Full BOM + power + wiring in `hardware/bench-shopping-list.md`;
IR wiring diagram `hardware/ir-breadboard.svg` (RX GPIO4, TX GPIO5, status LED GPIO6).

### 2026-08-25 — SOLVED: native kill feedback IS BLE-drivable (`$SFLASH`) — overturns the fork
MacBook session answering `docs/handoff-callsign-nrf-capture.md`. Capture `cap8` (PacketLogger,
iOS Callsign, 2 taggers, 3 kills, **shooter-side**). Full write-up: **`brx-protocol.md` §7o**,
report for the WSL session: `docs/handoff-callsign-nrf-capture-RESULTS.md`.

**Step 0 (the pre-check): the sight went GREEN**, 3/3 kills, in the app game — and both taggers
said *"red team takes the lead"*. Premise confirmed.

**The hypothesis was wrong, and the result is better.** There is **no BLE frame that flips the guns
into nRF peering** — Callsign's arm is **byte-identical to ours** (no channel/session/`$PB*`/`$NRF*`
anywhere; only `$VOL,69` vs 75 and a different `$WEAP,1` secondary). Callsign has no nRF radio
either. **It scores on the phone and sends the feedback over plain BLE:**

```
[215.031s] << $BUT,0,1,*           last shot
[215.423s] >> $SFLASH,*            <- the green-sight kill-confirm flash
[215.622s] >> $PLAY,,4,6,V3A,,,,*  <- "kill" (V3A is documented as 'kill' in our own sound-bank)
[216.423s] >> $PLAY,,4,6,VB17,,,,* <- score line; fired ONLY on kill 1, when the lead changed
```

3 kills → 3 `$SFLASH`, each ~0.4 s after a trigger burst. Game end = `$PLAY,VSF,4,6,JAY,,,,*`.

**Two commands corrected.** (a) **`$SFLASH,*` is the kill-confirm flash**, not a periodic keep-alive
— P7 resolved. (b) **`$PLAY` has a second sound slot at token 4**, the announcer channel.

**Why we missed it for two days:** the old note said `$SFLASH` appears "never near a hit" — from a
**victim-side** capture. **A kill you SCORE is invisible in your own gun's stream** (`$HIR`/`$HP` =
damage *taken*; the shooter emits only `$BUT`/`$ALCD`). Correlate host→gun feedback against **`$BUT`
bursts**, not `$HIR`. The same `$SFLASH → V3A → VB17` burst is in the **2026-08-23** two-tagger
capture at 295 s/325 s — we had the bytes all along. This also *confirms* D4 rather than
contradicting it: there is no shooter-side kill event, which is precisely why the **host** must
decide the kill.

**Why the bench `$GLED` probes failed:** right observation, wrong command — `$GLED` is team-derived
(§7i); `$SFLASH` drives the flash.

**Net:** "the green-sight visual is nRF-internal, audio compensates" is **retired** — a BLE-only
Mission Control delivers the full native feel, visual included. MC is better placed than Callsign
here: Callsign is one-phone-per-player and sees only its own gun, while MC connects to every gun
and sees the victim's `$HP,0,0,0`/`$HIR` directly. **Per-player attribution (P2) is now the sole
stock-feel gap over pure BLE** — worth re-scoping the nRF/IR work around that alone.

**Tooling:** `callsigndiff.py` (decode + diff a capture against `GameConfig.setup_frames()` in one
command). **`btsnoop.py` now keys streams on the ACL connection handle** — it keyed on
`(direction, ATT handle)`, identical across identical taggers, so a real two-gun capture would have
merged both streams and reassembled into garbage *silently*; pinned by `test_btsnoop_multigun.py`.
All 8 raw traces committed to `protocol/captures/raw/` with an index (scanned clean of headset PINs).

**RESOLVED same session:** only one BLE connection is in `cap8`, yet both taggers announced. The
**captured iPhone HOSTED the game**; a second phone **joined through Callsign** (§7g lobby) with its
own tagger. Game state syncs **phone-to-phone over the network**; each phone drives only its own gun
over BLE. **No gun-to-gun sharing exists** — no nRF score channel to chase. Two things follow:
`cap8` is the **host's** traffic, i.e. exactly the role MC plays (the kill burst is the authority
acting, not a client echoing); and **MC collapses the topology** — one machine drives the whole
fleet, so the phone-to-phone sync layer Callsign needs disappears.

### 2026-08-25 — NATIVE app validated on hardware; Web Bluetooth dead; $SFLASH from OUR stack CONFIRMED
Pivot in one evening. **Web Bluetooth is out:** the hosted `ble-test.html` (Cloudflare HTTPS,
`open-brx.iamrossi.workers.dev/ble-test`) hit **"Web Bluetooth API globally disabled"** on the test
Android (won't clear without chrome flags) — and iOS has none. Non-starter for a product (recorded:
`phone-app-spec.md` §RESULT, ADR-0001 B2 row).
**Built the native replacement, same evening:** a **Capacitor** app (`app/`, one codebase → Android +
iOS) using `@capacitor-community/bluetooth-le` (native Android BLE / iOS CoreBluetooth), reusing the
ble-test UI/gates. Built the APK in WSL (JDK 21 + Android SDK 35), hosted it
(`webapp/brx-companion.apk`), and **pushed it to the phone via Windows adb over USB** (WSL can't see
USB; installed Windows platform-tools via winget, `adb -s … install` → Success).
**Bench result — every core gate PASSED over native BLE, no flags:**
- **G1 connect** ✓ — native `requestDevice` connected where Web BT was globally disabled.
- **G3 speak** ✓ — `$VOL` + `$PLAY,VA20` played on command.
- **G4 `$SFLASH` → sight GREEN** ✓ — **this meets the ADR-0001 owed confirmation** ("$SFLASH from our
  own stack greens the sight on hardware"). The green-sight visual is fully ours to drive over BLE.
- **G5 Arm TDM** ✓ — the native app pushed the **full config + spawn** sequence (incl. the chunked
  >20-byte `$WEAP`/`$PSET` frames, 20-byte writes) and the gun **counted down 3-2-1 and went live**.
**Net:** the native phone/Companion path is hardware-proven end-to-end — connect, drive feedback
(speak + green flash), and configure+arm a game, all over native BLE. The same `app/` codebase produces
the iOS build (`npx cap add ios`).
**FULL SWEEP — all 6 gates PASSED:** G2 (trigger → `$BUT`/`$ALCD` frames stream) ✓ and **G6 stability ✓
— 5+ minutes continuous uptime, no drops** (native BLE held solid, notably better than the ~6.6 s
client-drop over the raw stack). Complete hardware validation of the native-BLE per-player node.
**Wire proof (bench log, gun Tactix-9498):** arm burst → gun echoed **`$LCD,45,70,0,0,36,216`**
(spawned live: HP45/armor70/ammo 36+216, matching config); trigger pulls streamed `$BUT,0,1`/`$BUT,0,0`
and **`$ALCD` ammo counted 36→0** as it fired (re-armed and repeated); `$SFLASH`, `$PLAY,VA20` speak,
and panic (`$CLEAR`/`$SP,99`) all sent fine; `$VOLTS` telemetry every ~60 s; no drops. A fully
functioning live weapon driven end-to-end by our native app. (Minor: one notify showed two frames
merged — `$ALCD,…$BUT,0,1,*` — a rare reassembly boundary quirk, non-blocking. Note: 9498 battery ~25%.)

### 2026-08-25 — iOS platform added to the Capacitor app (MacBook)
`npx cap add ios` run on the MacBook (iOS scaffolding is macOS-only, so this machine owns it).
Platform added cleanly. **Capacitor 8 uses Swift Package Manager, so CocoaPods is NOT required** —
the plugin (`@capacitor-community/bluetooth-le@8.3.0`) is wired via `Package.swift`.

**Toolchain note:** this Mac had **no node at all** (`~/.nvm` empty, `pnpm` installed but broken
without it) — installed via `brew install node` (v26.7.0). `@capacitor/ios` was not a dependency;
added at `^8.5.0` to match `@capacitor/android`.

**Two gaps found and fixed — both would have shipped a broken app:**
1. **No Bluetooth usage strings in `Info.plist`.** iOS **terminates** an app that touches
   CoreBluetooth without `NSBluetoothAlwaysUsageDescription`, with no useful diagnostic. Since
   `ios/` is git-ignored (generated, like `android/`), a hand-edit there is lost on regeneration —
   so the keys are applied by a committed, idempotent script: **`app/scripts/ios-setup.sh`**
   (`npm run ios:setup`). Anything iOS-side we depend on belongs in that script, not in Xcode.
2. **`www/app.js` did not exist**, yet `www/index.html` loads it — the bundle is git-ignored and the
   esbuild command was never recorded, so it lived only in the previous session's shell. The app
   would have booted to a dead page on *both* platforms. Reconstructed and recorded as npm scripts:
   `build` / `sync` / `ios:setup` / `ios:open` / `android:setup`.

**BLOCKED on hardware:** building or running the iOS app needs **full Xcode** — this Mac has only
Command Line Tools (`/Library/Developer/CommandLineTools`, no `/Applications/Xcode.app`). Xcode is a
~15 GB App Store install, plus a signing identity (a free Apple ID gives 7-day on-device builds).
Everything up to "open it in Xcode" is done and reproducible.

### 2026-08-25 — CONFIRMED: two independent phone nodes run a 2-player game (ADR-0002 proven)

Ran the single-gun **Companion/HUD node** on two phones at once — **Pixel → gun 4** and
**iPhone/mac build → Tactix-E20D** — each phone driving **only its own gun** over BLE (no one-phone-two-gun
bench rig). Result: **it worked.** Damage registered, **ammo + life totals tracked live**, death
fired, and **local respawn** re-armed — independently on each phone. This is the ADR-0002
autonomous-node model validated on hardware: a node owns one gun and runs its full loop with no
server in the loop.

**Also confirmed (by absence): the green-sight kill flash did NOT fire — as designed.** In the
single-gun node each phone sees only its own gun, and the gun is **host-blind about its own kills**
(ADR-0001) — it emits no shooter-side "you scored" event over BLE. So the node has nothing to trigger
`$SFLASH` on; kills read `— MC`. The flash returns only when **Mission Control** tells the shooter's
node it scored (the `feedback` message, `docs/spec/contracts.md` §5). This is the exact
capability boundary the new end-to-end spec is built around — observed empirically, not just inferred.

**Spec kicked off:** `docs/spec/` — `README.md` (architecture, the armory→recap experience spine,
module map, parallel-workstream plan) + `contracts.md` (shared data models, node↔MC protocol, event
model, clock sync). Three design calls locked: field LAN = travel router (macOS AP is weak), dispersed
start = **time-synced local countdown played through the gun speaker**, attribution = team-level on
phones / player-level needs Companion IR decode (P2).

### 2026-08-25 — P2 set-path SOLVED: `$PSET` token 1 is the player id (cap10 + cap11)
Operator hypothesis, operator-run, two captures. Callsign **Start Offline Game**, single device.

- **cap10** — app player id set to **69**. Whole arm identical to every prior capture except one
  token: `$PSET,`**`63`**`,0,45,70,70,50,…` (it is `0` everywhere else). 63 = the **6-bit maximum**,
  and the IR shot payload's player field is exactly 6 bits (0–63, `brx-ir-protocol.md`, from
  NRFL-Bases — an independent source). Filed as a lead, not a fact: one point, on a boundary value.
- **Then the app prefilled `64`** on reopening — so it clamps to a max of 64 and is **1-based**.
  That predicted a **0-based wire**: app 7 should send **6**.
- **cap11** — id set to 7 → **`$PSET,6,…`**. Prediction confirmed.

**`$PSET` token 1 = player id, 0-based, 0–63; the app shows 1–64.** Subtract one from anything shown
to an operator.

**What it closes:** per-player identity was the last stock-feel gap over pure BLE, and both assumed
fixes were awkward — a USB `SETUP` cable into every gun at Armory Setup, or an IR receiver. **Neither
is needed to ASSIGN an id.** MC numbers the fleet over BLE at arm time, per game, in a frame it
already sends.

**What it doesn't close — and a conclusion worth re-examining:** reading *who fired*. `$HIR` was
decoded as carrying the shooter's **team** (§7k). But `protocol.py` has always parsed `$HIR` as
`tok3 = shooter player id, tok4 = team`, and **every capture behind the team-only reading was taken
with all guns at the default id** — a player-id field would have been indistinguishable from a
constant. **Next experiment (cheap, no new hardware):** set two guns to distinct ids, trade shots,
watch `$HIR` tok3. If it tracks the shooter, per-player attribution is BLE-native and the VS1838B
bench becomes an optimisation rather than a prerequisite.

Both traces archived (`protocol/captures/raw/`) with decoded transcripts.

### 2026-08-25 — 🎯 P2 CLOSED over BLE: `$HIR` token 3 IS the shooter's player id (read-path)
Two guns (`Tactix-E20D`, `Tactix-3D4F`) driven from the Windows `brx-mcp` MCP server (WSL session):
standard §7e TDM arm at vol 69, config-all-then-spawn-all, identical except **`$PSET,6,…`+`$TID,1`** on
E20D and **`$PSET,19,…`+`$TID,2`** on 3D4F. Both spawned (`$LCD,45,70,0,0,36,216`). Tony traded shots.

- 3D4F → E20D: **26 × `$HIR,4,0,19,2,9,0,3,*`** (two full kills, armor 70→0 then HP 45→0).
- E20D → 3D4F: **6 × `$HIR,4,0,6,1,9,0,3,*`**.
- **Token 3 = the shooter's `$PSET` player id, token 4 = the shooter's `$TID`, on every hit, both
  directions.** Combined with cap10/cap11 (`$PSET` token 1 sets it), **per-player attribution is fully
  BLE-native** — no `SETUP` cable, no IR receiver. Written up as `brx-protocol.md` §7q; §7k banner +
  §4 row updated; FOLLOWUPS P2 ✅.
- Why it was missed: every prior capture had all guns at id 0, so tok3 never varied.
- Extras: a **dead gun can't fire** (`$BUT` without `$ALCD` at HP 0 — settles the CS plant gate);
  `$HIR` token 1 read `4` while armor absorbed, `0` for HP-taking hits and `2` on the killing hit
  (effect class, unexplained); token 2 still `0`; E20D hit the ~6.6 s bleak drop once right after
  connect, then held ~3.5 min.
- **Spec impact (docs/spec/, not yet amended):** `shooter_id` is present on the phone path from `$HIR`
  tok3; `Player` needs a `player_num` (wire 0–63 / display 1–64); `$PSET` is per-player, not per-game
  (`setup_frames()` must take the id); FFA = one team + FF on + distinct ids; `feedback{kill}` has a
  real target; "approx" attribution can be deleted. Amendment A3 to `contracts.md` is the next step.

## 2026-08-25 (late) — first bench of the MC-compiled FrameBundle on two guns (checklist NEXT items)

Rig: Windows bench (`brx` MCP), two taggers GUN-A (player 6 / team 1) and GUN-B (player 19 / team 2), MC's
golden head written verbatim, `$VOL,60`. Ten of the 14 NEXT items closed; full protocol write-up in
`protocol/brx-protocol.md` §7r. Headlines: `$HIR` token 1 = sensor (headshot detect), `$HP` = hp/armor/shield,
headset-off kills the BLE link (`$DISCONNECT`) — so link+echo IS the headset check, head write is silent,
unspawned guns ignore IR, `$PSET` tok2 inert, live `$TID` flips hit resolution instantly (LED lags to respawn),
resync signatures verified exactly as §3.10 (dead = `$BUT` only; `$PHONE` reads nothing back), config survives a
BLE drop, `$PLAY` needs `4,6` to be audible, `VA33` = "game over", `VSF`+`JAY` = victory. Mishaps: both
headsets were switched off mid-session → both guns `$DISCONNECT`ed at the same instant and refused to hold a
link until power-cycled; the 5-min hold got cut at ~2 min (re-run). Also: MC ran on the Windows Python for the
first time (deps installed; banner prints `ws://…:0/ws` before the net server binds — cosmetic), and the phone
node APK was built (JDK 21 at `~/jdk21`) and installed on the Pixel (`com.openbrx.companion`) but NOT yet run
against a gun — phone-path items 4/8/13 remain. Code impact: `compile.py` cues (`game_over` → VA33, new
`victory`, `tick`/`klaxon` given `4,6`).

## 2026-08-25 (night) — first phone→MC→gun path on real hardware

MC on the Windows Python (`--no-auth`), the BRX Companion APK on the Pixel, one gun (GUN-A). Proved end to end:
the phone said hello, MC bound it to the roster player, and a **kit-out try-out pushed from MC fired the real
gun**. Fixes found on hardware this session (all committed):
- **Try-out couldn't fire** — `compile.tutorial_frames` deliberately dropped `$START`/`$TID`/`$SIR`; without
  `$START` the gun spawns but the trigger only *reloads*. Added `$START` + a `$TID` (identity stays `$PSET,0`
  so a stray hit is uncredited) + one `$SIR` row → fires. (LED still flashes in try-out — FOLLOWUPS.)
- **BLE picker** — Android's `requestLEScan` service-filter missed a tagger whose UUID rides in the scan
  response (GUN-A never listed); switched to name-filtering. List re-sorted on every advert (rows jumped under
  the finger) and re-render reset scroll → stable first-seen order + scroll preserved + auto-scan on launch.
- **MC late-roster adopt** — the phone said hello as `Tactix-XXXX` (Callsign had reset `$NAME`) *before* the
  host added the player with the real gun_id; `_adopt_node_for_gun` now matches a live node by armory tail.
- **§3.11 confirmed the hard way**: locking the phone, pulling the notification shade, or backgrounding the app
  all suspend the webview JS and drop the MC socket; it reconnects within ~10 s once foreground again. The app's
  keep-awake stops *auto*-lock only. Field rule stands: phone mounted, foreground, DND, don't lock.
Not yet done: items 4/8/13 (soak/auto-rejoin/iOS-locked), the 5-min hold re-run, LED clean-up, headset-proof at
push (board still amber "HEADSET UNPROVEN UNTIL CONFIG PUSH" — the push itself was next when we stopped).

## 2026-08-26 (overnight) — no-hardware fix batch for the bench punch-list (commit 23a5930)

Playwright over the app's `?demo` reproduced the phone symptoms and found the umbrella root cause: the boot
awaited Capacitor plugin PROXIES as thenables → `proxy.then()` → the await never settled → keep-awake,
app-state listener, auto-scan, cam and demo were all dead from one line. Fixed (imports box the plugin), plus:
GAME OVER result screen → OK → MATCH COMPLETE with localStorage match history; edge-triggered runway cues
(the stacked "10,9,8,10…" heard on the gun) with runway_30/20 silenced until distinct lines are pinned;
RELOAD/pips warn only when live+alive+low; CAMERA permission + webview debugging; info-button/top-right/MC-LINKED
readability. Peer session fixed the MC banner port and wired the `victory` cue to winning nodes at recap
(+e2e). 464/464 python, 33+8 app tests, APK reinstalled on the Pixel (it dropped off adb after — on-device
keep-awake/cam verification is first thing next bench). Screenshots in the session scratchpad.

## 2026-08-26 (bench) — `$WEAP` token probes: fire-interval PROVEN, compiler rate bug fixed, fire-mode still open

Live-probed the built `$WEAP` frames on a real tagger (`firemode_probe.py`), one token at a time on a
sniper build, plus a Charge Rifle control test. The bench tool numbers tokens **raw 1-indexed**
(slot = idx1); the field map and compiler are 0-indexed (slot = tok0), so **raw idx = tok + 1**
(tok = 0-indexed below).

**PROVEN — `tok14` (raw idx15) is the fire interval (ms).** A sniper with `tok14=1250` fired exactly
one shot per second. This overturns the `protocol-classes.md` field-order guess (`tok14`=chargeUp,
`tok15`=rateOfFire): the real rate is `tok14`.

**Compiler bug found + fixed (c606417).** `compile.py` had been writing `fire_ms` into `tok15` — the
field that reads a constant `850` in every captured frame (function still unknown; we now never write
it). Because the value never landed, every built weapon ran at the AR sample's `tok14=100` → **10
shots/s full-auto regardless of config**. Now maps fire→`tok14` (charge parked), so configured
cadences finally reach the gun.

**Fire-mode eliminations (sniper).** `tok1=2` → still full-auto (not fire-mode). `tok19` → probe did
nothing → consistent with `reloadType` (Magazine=0/Shells=2, enum-matched, unverified), a reload
mechanism, not a mode selector. `tok3` (damageType `8`) alone → no charge effect. The `GunWeaponType`
enum has no semi/burst member, so **per-pull semi-auto may not exist in this firmware** — held-trigger
full-auto is all we can build.

**`tok23` (raw idx24) ≈ 275** on the sniper probe → `burstWeaponTime`-suspect, unverified.

**Charge feel is in the frame, not yet localized.** A byte-identical Charge Rifle gives a weak splat
on a tap vs a charged blast on a hold → the behaviour is carried by `$WEAP` tokens. Eliminated as sole
carriers: `tok3` (damageType) and `tok14` (rate). **Progress:** the paired fields that both read `14`
on the CR (`tok20`+`tok24`, raw idx21+idx25) together produced a **delayed-shot charge feel** on the
sniper → the charge mechanism lives in that pair. Isolating it: `tok20=14` alone is on the gun now,
awaiting Tony's verdict; the CR tail block `tok35`–`tok38` (`C19,C04,20,150`) is the fallback if the
pair doesn't reproduce from a single token.

Net: fire RATE is now controllable and proven; fire-MODE (semi/burst) is likely absent from the
firmware; the CR charge mechanism is still an open token hunt. Weapon verdicts (`burst_rifle`,
`sniper_rifle`, `shotgun`, `smg`) stay logged as "issue" pending the rate-fix retest.

> **→ SUPERSEDED below: t20 = fire mode, PROVEN by one-field flip (same day).**

## 2026-08-26 (bench, cont.) — charge-feel: combinational, engages-but-never-completes; walk-back is the better method

Continued the `tok20`+`tok24` charge lead (both read `14` on the CR). **Single-token isolation** on the
sniper found no single carrier:
- **`tok20` alone (idx21)** — a **two-stage trigger**: a slow pull fires **silently**, a quick pull
  fires with sound. Behaviour-affecting, but not the charge feel.
- **`tok24` alone (idx25)** — no change.
- **CR tail block `tok35`–`tok38` (`C19,C04,20,150`) alone** — no change, confirmed twice.

**Combined probe** (sniper + rate `tok14=1250` + `tok20=14` + `tok24=14` + the CR tail block, sniper
identity kept) — the **charge machinery ENGAGES but never completes**: holding starts an audible
spin-up loop (`C19` doing its job) that "doesn't really build," release does nothing, a quick tap is a
dead click. The first transplanted sound made "a sniper sound AND a charge sound" (Tony) — the
machinery is real. So charge is **(a) combinational** (no single token carries it), **(b) gates the
trigger as expected**, and **(c) missing at least one element we didn't transplant**. Remaining
candidates: `damageType 8` + subtype pairing; the `E03`/`C15`/`C17` sound-trio positions; or the tail
numerics `20`/`150` needing to agree with the charge/fire timers. Gun restored to a clean sniper (true
1.5 s cadence).

**Method note for the next bench session — walk BACK from working, don't build up.** Tonight built the
charge *up* from a sniper by transplanting CR tokens and never reached a completing charge. Strictly
better: start from the **byte-identical Charge Rifle** (a WORKING charge state) and remove ITS tokens
one at a time toward the sniper — the first removal that kills the charge names the missing element,
with no need to guess the full combination. (Alternative: capture a Callsign semi/burst weapon frame
and diff it.) Hunt paused here.

> **→ SUPERSEDED below: the charge feel is t20 variants 2/3/14 — walk-back never needed (t20 entry, same day).**

## 2026-08-26 (bench, handoff experiment 3) — $SFLASH validated from OUR stack

Bare `$SFLASH,*` sent to an idle, unspawned gun (no game state, `mcp/tools/sendframes.py`):
**the sight goes GREEN and stays green for several seconds** — it latches; three sends ~0.5 s apart
read as one continuous green. No wire reply. So the frame decode (§7o) is correct, no game state or
companion frame is required, and the engine's `KillConfirm → $SFLASH,*` path is validated end-to-end
(B18 visual half REAL). Single-send duration not yet isolated (needs one send + a stopwatch).

## 2026-08-26 (bench, handoff experiment 2) — `$HIR` t5 = raw magnitude (== applied on fn-1 rows); armor model pinned; new tok2/tok7 decodes

Two real guns, victim rebuilt to a full 45/70 before each single shot (`mcp/tools/damage_bench.py`).
Resolves the `t5`=damage question (was "unresolved" in `weapons.md` / `protocol-classes.md`) and P10.

**`$HIR` token 5 == the applied damage on all 4 weapons tested** (refined later — see the "tok5 = RAW magnitude" entry below: tok5 is the raw magnitude, which equals applied only on `$SIR` fn-1 rows, as all 4 of these are):
- AR (`t5`=9) → armor 70→61 (−9). Frame: `$HIR,4,0,5,1,9,0,0`.
- Shotgun `T01` (45) → armor 70→25 (−45). `$HIR,4,0,5,1,45,0,0`.
- Sniper (80) → armor 70 absorbed + HP 45→35 (spill). `$HIR,4,0,5,1,80,0,1` (+ a gun-sensor variant `$HIR,0,…`).
- Rocket (115) → instant kill. `$HIR,4,10,5,1,115,0,0`.

So `t5` **is** the `$WEAP` damage field, and the AR really deals **9** — the manual's "M-4 = 24" was
stale (the 2026-08-25 §7r "24 here" was just that day's 24-damage config). A kill-shot anomaly: the
shotgun's killing blow reported `$HIR,4,0,5,1,70,0,0` — `70` = the victim's *entire remaining pool*,
i.e. an overkill / pool-clamped report on the fatal hit, not `t5`. (Footnote, not a `t5` counterexample.)

**Armor model pinned:** armor absorbs **1:1 first**, overflow **spills into HP**, **no per-hit cap** —
the sniper's 80 split exactly 70 armor / 10 HP. The old "~9/hit absorption" reading was just the AR's
damage being 9, not an absorption limit.

**NEW decode — `$HIR` token 2 = the shooter's IR protocol:** `10` on the rocket hit (proto 10), `0`
on standard weapons. Every prior "always 0" reading was standard-protocol-only traffic (resolves the
P2 "tok2 always 0" note). **Token 7 = subtype echo:** the sniper's hit carried `…,1` = its subtype 1.

**Operational learnings (→ §7r):** `$BMAP,0,0,,,,,*` is **required** or the trigger is dead; a **dead
gun does not revive on `$SPAWN` alone** — a full cold start (`$CLEAR`→`$START`→…→`$SPAWN`) is needed;
and a victim registers **non-standard IR only if its `$SIR` table has the matching protocol/subtype
rows** — a single-row `$SIR,0,0` ignores the sniper's subtype-1 hit (the full 10-row captured `$SIR`
table is in `damage_bench.py`).

Handoff experiment 2 **PASSED**. (Experiment 4 — `$TID` team range — runs next; its entry goes below.)

## 2026-08-26 (bench) — $HIR sensor-id sweep: INCONCLUSIVE at point-blank

Question (Tony): does the headset distinguish front vs back hits? Five aimed phases
(mcp/tools/sensor_bench.py: front/back/left/right/gun, victim rebuilt per phase). Results: only ids
**0** and **4** ever observed in $HIR tok1 (never 1, the old "headset" guess). Left/right headset
shots read 0; gun-body shots read 4 — roughly INVERTING the morning's damage-bench pattern (headset
aim → mostly 4). At bench distance the IR floods every receiver and the first to catch it reports, so
aim point does not map cleanly to the id. **Facts:** tok1 carries a real per-hit sensor id with (at
least) two groups {0, 4}; front-vs-back is NOT resolvable without isolation (cover all sensors but
one). Front/back damage bonuses cannot be built on tok1 yet. Also §7m re-confirmed twice: a gun with
an unsettled headset accepts a connection and instantly drops it ("Not connected" mid-config).

## 2026-08-26 (bench) — $HIR sensor map RESOLVED by shielded isolation

Follow-on to the inconclusive point-blank sweep above: one exposed sensor per phase (everything else
hand-shielded), one AR shot each. Unambiguous, repeated hits per phase:

| $HIR tok1 | sensor |
|---|---|
| **0** | headset FRONT dome |
| **1** | headset BACK dome |
| **4** | gun body sensor |

So the earlier flood-run "headset" hits reading 4 were catching the GUN sensor. The old "1=headset,
4/0=gun" §7r guess is corrected: 1 IS a headset sensor — the BACK one. **Front-vs-back is
distinguishable on every hit** → directional mechanics (backstab bonus, flank feedback, HUD hit
direction) are buildable over pure BLE. Tool: mcp/tools/sensor_bench.py (isolation phase list).

## 2026-08-26 (bench) — $STUN direct command: NO-OP

Bare `$STUN,*` plus `,1` / `,5` / `,1,5` sent to a gun holding a live AR (spawned, trigger working):
no sound, no LED change, trigger unaffected, no wire reply. So $STUN is not a host-side disable in
these shapes. Working theory: stun is an IR-delivered effect — the extract types weapon category 10
as "Stun" and $PLAY carries a `stun` field — i.e. the victim's $SIR row interprets a stun-type hit
(like tear gas 11). Next probe: fire an IR frame with a stun damage-type at a victim whose $SIR has
a matching row, or capture Callsign using a stun accessory.

## 2026-08-26 (bench, handoff experiment 4) — `$TID` masked to 2 bits: FOUR usable native teams (0–3), effective = `$TID & 3`

Six phases, one AR shot each (`mcp/tools/tid_bench.py`); `$HIR` tok4 = the shooter's **effective** team.

| shooter `$TID` | & 3 | victim `$TID` | result |
|---|---|---|---|
| 4 | 0 | 5 (→1) | HIT, tok4=**0** |
| 4 | 0 | 4 (→0) | HIT — **same team damaged** (wrinkle a), tok4=0 |
| 30 | 2 | 31 (→3) | no registration — later attributed to a bench-script re-setup race (see below) |
| 62 | 2 | 63 (→3) | no registration + "dead trigger" — same race (shooter caught mid-`$CLEAR`); NOT a team-2 limit |
| 63 | 3 | 63 (→3) | HIT — **same team damaged** (wrinkle a), tok4=**3** |
| 100 | 0 | 101 (→1) | HIT, tok4=**0** |

**`$TID` is masked to 2 bits — effective team = `$TID & 3`, values 0–3.** The tok4 reads confirm it
(4→0, 63→3, 100→0), so >4 IDs collapse onto four slots.

**All four masked teams (0–3) are usable — team 2 included.** The decisive re-run: with the victim
properly re-armed (spawned, team 1, full `$SIR` table), gun 4 on `$TID,2` mag-dumping produced **5 clean
registrations, all `$HIR,4,0,0,2,24,0,0`** — a team-2 shooter landing cross-team hits normally. (Nice
incidental cross-check: tok3=0 and tok5=24 are exactly right for the try-out AR armed there — an
identity-0 `$PSET` and the catalog 24-damage frame — reconfirming tok3 = shooter id / tok5 = damage.)
So the **native team count is FOUR (0, 1, 2, 3)**; larger squad counts still need MC logical teams.

*History (why the table shows two blanks):* mid-bench, the two team-2 phases (shooter `$TID` 30 and 62)
read as silent, briefly suggesting a "no-fire" then a "fires-but-rarely-registers" team-2 anomaly. The
re-armed re-run refuted both — best explained as a **bench-script re-setup race**: `tid_bench` re-set both
guns between phases, so a shooter caught mid-`$CLEAR`/unspawned shows a dead trigger and zero hits,
exactly what was seen. Not a team-2 property. (Registration-rate-vs-rounds wasn't clean enough to quote a
number, so none is stated.)

The 2-bit mask stands on the tok4 evidence (4→0, 63→3, 100→0). The last remaining question — friendly
fire — is also resolved below (wrinkle a): `$GSET` token 1 IS `friendlyFire`, **gun-enforced**.

**Sub-open (a) — friendly fire — RESOLVED: `$GSET` token 1 IS `friendlyFire`, and it IS gun-enforced.**
The exp-4 gun-fired probe (both guns "team 1", FF=1) saw same-team damage land — which is **correct** and
matches the FF=1 case below; the only error was the inferred *extension* to FF=0 ("lands under 0 AND 1"),
never cleanly tested (that probe's victim had an **unverified `$TID,1` write** on a degrading gun and may
have kept team 2). brx-ir settled it on the **four-cell IR emitter** — team bits set **directly in the IR
word**, no gun-config dependence — replicated **2×, alternating, fresh wound per leg, trailing known-good
control**:

| `$GSET` t1 | dmg same-team | dmg enemy | heal from ally | heal from enemy |
|---|---|---|---|---|
| **0** (FF off) | **blocked** | works | works | **blocked** |
| **1** (FF on) | works | works | works | works |

So `friendlyFire` behaves **exactly as the teardown labelled it**: FF=0 gates out same-team damage AND
enemy heals (the friend/foe filter); FF=1 opens the gate. **Nothing measured was retracted — one inference
sentence was.** This also **un-supersedes** the 2026-08-25 "same-team → zero `$HIR` both ways" observation:
it was right all along. MC friendly-fire is a policy/scoring layer **over** this firmware-enforced base.
All four handoff experiments closed.

Handoff experiment 4 **PASSED** — all four BLE-only experiments (§`handoff-ble-experiments-no-ir.md`) closed.

## 2026-08-26 (bench) — t20 = FIRE MODE, PROVEN by one-field flip

brx-opus2's 19-frame correlation (t20: 0=full-auto 5/5, 7=single-shot 7/7, 9=burst 2/2, charge
variants 2/3/14, melee 13) put to the trigger:

1. Captured sniper frame verbatim (t20=7): **one shot per pull, holding does nothing** — native bolt feel.
2. SAME frame, only t20 7→0: **full-auto** through the mag.
3. Captured Burst Rifle (t20=9, t23=275): **exactly 3 rounds per pull.**

t20 IS the fire-mode selector; t23 is the burst cycle. U0 closed — no Callsign semi capture needed.
This retro-explains the whole day: the template stamped the AR's t20=0 on every weapon ("sniper
full-autos", "burst doesn't burst", C1/C2), and the earlier idx21(=t20)=14 probe put the CHARGE
RIFLE'S MODE on a sniper (the "slow pull fires silent" two-stage trigger = charge-and-release).
The re-based catalog (f85b725) ships each weapon's own t20/t23 verbatim.

## 2026-08-26 (bench) — charge modes + overheat CONFIRMED; the fire-behavior matrix is complete

- **t20=2 (Rail Gun)**: hold → charges → **fires on its own**, no release needed; tap fires a weak shot.
- **t20=3 (Laser Cannon)**: tap plays a sound cue but does NOT discharge; hold → charges → fires on its own.
- **t20=14 (Charge Rifle)**: **fires on tap AND on release** — quick tap = weak shot, hold-charge then
  release = the potent blast.
- **Overheat (t24)**: live-watched on the wire — heat climbs ~8/shot (t24=14) through $ALCD's last
  token (0–100+ gauge), gun overheats "if you shoot too fast too much", cools on idle (101→41 observed).
  **The HUD can render a real heat bar from $ALCD with zero new protocol.**

With t20 ∈ {0 auto, 7 single, 9 burst(+t23), 2/3/14 charge variants, 13 melee} and t24 heat all
trigger-confirmed, the fire-behavior matrix is fully mapped.

## 2026-08-26 (bench) — rebalanced arsenal field pass, 18/18 weapons

Full range on the re-based catalog (f85b725): **fire modes all correct in the field** — bursts burst
(Burst + Force), snipers bolt, charges charge, power tier one-shots from 2-round mags, SMG sound
FIXED (G03 — C3 closed as predicted). TTK pacing reads right by ear. Findings (all in
~/.brx-mcp/weapon-verdicts.jsonl):
- **D21 "disable chirp"** in the sniper/AMR (+shared bolt) reload chains — stock Callsign sound,
  reproduced twice; swap for a clean cock (sound-override task dispatched).
- **Energy Launcher fire sound J15 is a MUSIC sting** (J family) — stock; swap to O-family ordnance.
- **Overheat only ever triggers on the Charge Rifle** — SMG (t24=5) and Energy Rifle (t24=6) never
  overheated under sustained fire. CR is the ONLY frame carrying tail extras C19,C04,20,150 →
  working theory: the overheat mechanism requires the tail block, not just t24. Bench followup:
  transplant the block onto energy_rifle and re-test.

## 2026-08-26 (bench) — OVERHEAT MECHANISM SOLVED: t37/t38 enable it

Transplant probe: the SMG (t24=5, heat sound D11, never overheated) with the Charge Rifle's
**t37=20 / t38=150** added — the heat gauge came ALIVE on the wire (28→52 through a mag dump,
~2/shot) and the trigger gated at the top ("behaves like end of clip"). Confirms the range-pass
theory: **t24 (heat/shot) + t35 (sound) are inert without t37/t38** — those two fields enable and
parameterize the overheat system. At these params the 72-round mag empties before hard lockout, so
they're TUNING knobs: any weapon can now be given an overheat as a balance lever (raise t24 or
tighten t38 for a real lockout). U-item closed; exact semantics of 20 vs 150 (threshold? cooldown?)
still to map — two more transplant probes with varied values.

## 2026-08-26 (bench) — U6 parked: QT entered the documented "screamer" state

After ~a full day powered, Tactix-E20D stopped holding BLE: two connect-then-drop-mid-config failures,
then connect attempts that hang entirely while the gun ADVERTISES normally (-70 dBm) — battery
confirmed fine, power cycles only briefly helping. Matches the community-documented **"SCREAMERS"
behavior (BLE drops / random fail after ~1 hr sessions; B1 hardware notes)** — first time we've
reproduced it. Operational rule for match days: rotate/power-rest guns, don't leave the fleet
powered all day. U6 (damage-type reactions), U9, U5, U2 remain queued in FOLLOWUPS — all need two
healthy guns; methods written.

## 2026-08-26 (bench) — U6 CLOSED: damage types = victim-side presentation + wire metadata

Clean single-timeline hit tests (mcp/tools/hittest.py, Tactix-FE30 shooting gun 4), same 9-dmg AR with
t3 = 0 / 6 / 10:

- **Damage applied is ALWAYS t5** (9 exactly, every phase — even type 10 whose $SIR row carries
  `100,2,60`: those params do NOT override damage).
- **tok2 echoes the type faithfully** (0/6/10 observed) — software always knows what hit.
- **A MAPPED type changes the victim's hit presentation**: type 10 played a distinct (subtle,
  non-explosion) hit SFX before the standard pain voice; unmapped type 6 sounded identical to baseline.
- Also re-verified: front-dome sensor id, per-shooter id/team attribution, 2-shot mag accounting.
- **A/B VERIFIED, wire-confirmed in-window** (re-run: 3 shots, all $HIR tok2=10): type-10 hits play a
  DISTINCT victim sound described as explosion-flavored — consistent with the $SIR,10 row's X13
  assignment. **The SIR table's per-type sound mapping is honored** — custom per-type victim audio is
  a fully working mechanism (the heal/EMP audio path).

**Special-weapons recipe, fully proven**: custom IR type + victim $SIR row (chosen sound; damage
via t5, incl. 0 for heals) + Companion/MC logic keyed on the tok2 echo with full attribution.
Earlier zero-hit confusion this evening = my overlapping test windows, not hardware (logged for honesty).

## 2026-08-26 (bench) — U9 answered: a bare $WEAP re-push RESETS ammo to the frame's values

mcp/tools/u9_pickup.py on a live gun: AR armed ($AMMO 32/192), then the Burst frame re-pushed with
NO $AMMO — the gun's next $ALCD read **36/108, the new frame's baked-in clip/reserve**, discarding
prior ammo state. Design rule: **every weapon pickup/powerup must re-send $AMMO** with the intended
counts, or the player silently receives the frame's full load. (Depletion-carryover nuance untested
— no shots were fired between phases this run — but the overwrite is demonstrated.)

## 2026-08-26 (bench, late) — U2 attempt CONTAMINATED by rig degradation; stays OPEN

t41 inverted-range test (can't walk to a 300ft floor -> shrink t41 instead): one SOLID positive —
**t41=100 sniper killed from max indoor distance** while the rig was healthy. Then t41=5 read zero
hits (suggestive!) — but before it could be controlled, registrations died entirely: t41=100 at
POINT-BLANK, fresh-armed victim, counted window = **0 hits**. A frame that was killing an hour
earlier. Verdict: rig degradation (gun 4 ~12h powered — the night's SECOND screamer-family failure;
emitter or receiver side unresolved), so the t41=5 zeros are unattributable. **U2 stays OPEN.**
Method for a fresh fleet (worth 10 minutes): same-spot A/B, t41 100 vs 5, counted windows both sides.
Fleet ops rule reinforced: POWER-REST GUNS — a day-long bench session degrades them below usability.

## 2026-08-26 (bench) — 🎯 B13 CLOSED: the BRX IR word is bench-verified, and the parity rule is cracked

First IR capture rig ever run on this project: ESP32-S3-N16R8 + VS1838B on GPIO4, three wires, no
breadboard-mounted MCU. Session 0 (toolchain) and Session 1 (capture) of `bench-plan-hardware.md`
both PASS. Host side driven straight from `python -m brx_mcp ir-capture COM7 <secs>` — **no new
tooling was needed**, the CLI + `irbridge.py` decoder were already built and waiting.

**Rig validation before any tagger was involved:** a Sony TV remote decoded cleanly as SIRC 12-bit
(2390 µs header, 1200/600 µs marks, `101010010000`). That proved wiring, ISR edge capture, the
750 µs bit split and the frame validator all work on real IR — a free negative control.

**Measured BRX timings (Tactix-FE30 @ ~1 m):** sync **1988–1991 µs**, one-marks **990–994 µs**,
zero-marks and spaces **489–512 µs**. The source-derived `~2 ms / 1000 / 500` is exactly right.

**Field layout CONFIRMED by pushing known `$WEAP` frames over BLE and watching which bits move** —
the strongest form of one-field validation, because the ground truth is independent of the receiver:

| pushed | captured word | decode |
|---|---|---|
| (unconfigured) | `0000000000010001011000010` | dmg=**22** |
| AR, `t5=9` | `0000000000010000100100001` | dmg=**9** |
| Rocket, `t3=10 t5=115` | `1010000000010111001100010` | dmg=**115**, B=**10** |

Between baseline and AR **only bits 12–19 changed**. `player=0` and `team=1` independently match
Tactix-FE30's armory record (`player_id: 0`, `field_id: 1`).

**Two corrections to the LaserTagMods-derived table:**
1. **The 4-bit "B" field is the IR protocol / damage type**, not a bullet type — it carries the same
   number as `$WEAP` **t3** and the `$HIR` **tok2** echo (rocket → 10). ⚠ **It is only 4 bits**, so the
   custom-type space for special weapons (heal/EMP) is **0–15 with 0/8/10/11/13/15 already taken** —
   about ten free slots and no way to widen it. This is a real constraint on the special-weapons design.
2. **`Z` is a computed parity over bits 0–22**, not just a differing pair:
   **odd count of 1s → `Z=01`, even → `Z=10`.** 4/4 frames obey it. node1's cheap `Z1 != Z0` test never
   fails on a real frame, which is why the weaker rule looked sufficient from source.
   → `irbridge.payload_parity()` added; `encode_word()` now computes parity by default;
   `decode_word()` reports `parity_matches`. 19/19 irbridge tests green.
   ⚠️ **CORRECTED later the same session:** this entry said a fixed `"01"` "would have emitted invalid
   frames". **It would not have.** The gun enforces only **`Z0 != Z1`** — a deliberately-wrong-but-
   differing Z registered **8/8**, while `Z=00` and `Z=11` registered **0/8**. Computing the parity is
   fidelity to what genuine BRX frames carry, not an acceptance requirement. Measurement below.

**U7 (damage ceiling) CLOSED as a side effect:** the damage field is 8 bits, read 115 directly off the
wire. Max 255, so a 2× powerup is expressible on anything up to 127.

**Rig gotcha worth remembering:** `ir_capture.ino`'s per-frame `RAW` print takes ~15 ms at 115200, and
any shot landing in that window is captured truncated — the symptom is frames that are *prefixes* of
the real word (16/17/20/21/24 bits). Fire 1–2 s apart, or cut the print, before counted-window work
(this will matter for the t41 range A/B).

**Also corrected:** FOLLOWUPS still listed **B5** (mcp 2.0 server port) as open — it was fixed in
`2c963b1` and verifies clean on the Windows venv against `mcp` 2.0.0. Marked done.

**Next:** Session 2 — wire the emitter (2N2222 + 940 nm LED on GPIO5) and find out whether a stock gun
accepts a word we synthesize. That is the Utility Box (B4) unlock, and the parity rule above is what
makes a synthesized word legitimate.

## 2026-08-26 (bench) — 🎯 IR EMIT WORKS: full synthesize→transmit→decode round trip, 4/4 exact

Session 2 (first half) of `bench-plan-hardware.md`. Board B (CH343 `5C4C136487`, COM8) running
`ir_emit.ino` with 2N2222A + 940 nm LED on GPIO5; board A (CH343 `5C93045958`, COM7) running
`ir_capture.ino` with the VS1838B on GPIO4. Emitter timings first re-tuned from the source defaults
to **our measured values** (sync 1990, one 992, zero/space 500).

**Result — 4/4 complete frames decoded EXACT:**
```
tx: 1010000000010111001100010
rx: 1010000000010111001100010   player=0 team=1 dmg=115 B=10 parity_matches=True
```
Our transmitter emits a word a decoder reads back bit-for-bit, with correct sync, correct mark/space
timing and correct computed parity. **The emit half of B4 (Utility Box) is proven at the signal level.**

**Diagnostic chain worth remembering (three false alarms, none of them the circuit):**
1. **Phone camera saw nothing — MEANINGLESS at our drive level.** From 3V3 through 100 Ω with a 50%
   38 kHz carrier the LED averages **~5 mA**; a TV remote runs 100–500 mA peak. Both phone cameras
   showed nothing while the circuit was working perfectly. **Do not use a phone camera to judge a
   low-current IR emitter.**
2. **Two boards, one data cable.** A charge-only USB-C cable made a board vanish from the bus
   entirely (not even the native-USB device). Symptom: `Get-CimInstance` shows one CH343 when two
   are plugged in. Also added a **standalone AUTO-TX mode** to `ir_emit.ino` (`AUTO <bits>`/`AUTO OFF`,
   or a compile-time `autoBits`) so a board can emit with no host attached — which a deployed Utility
   Box needs anyway, and which unblocks a one-cable bench.
3. **VS1838B AGC saturates at point-blank.** At a few inches the receiver dropped out mid-burst and
   the sketch reported each piece as a separate frame (fragments that were *prefixes* of the real
   word). **Aiming the LED away from the receiver fixed it instantly — 0/8 complete → 4/4 exact.**
   Counter-intuitive but firm: for loopback work, attenuate. The gun at 1 m never showed this.

**Measured back from our own emitter:** sync 2020–2070 µs, one-marks 1013–1040, zero/space 460–535 —
i.e. the receiver reads **~30 µs longer than programmed** (carrier gating + demod latency). Still well
inside the 750 µs decision threshold, and within ~4% of a real gun's received signature (990/500), so
no re-tune is warranted before the gun-acceptance test.

**Next:** point the emitter at Tactix-FE30's headset and watch for a `$HIR` over BLE. That is the actual
Session 2 pass/fail — does a *stock gun* accept a word we made up.

## 2026-08-26 (bench) — 🏆 LANDMARK: a stock BRX tagger accepted a FULLY SYNTHETIC shot from our hardware

Session 2 of `bench-plan-hardware.md` — **PASS**. The emitter (board B, 2N2222A + 940 nm LED on GPIO5)
was aimed at Tactix-FE30 from ~40 cm and told to transmit a word that **no BRX device has ever emitted**:

```
signature word  0000101010100010000100010   →  player=42  team=2  damage=33  protocol=0
```

Chosen to be unforgeable as a coincidence: every gun on the bench has player id **0** (so 42 can only be
ours), team 2 makes it an enemy of Tactix-FE30's team 1 (no friendly-fire ambiguity), and **no weapon in our
catalog does 33 damage**.

**Tactix-FE30's own BLE stream, verbatim:**
```
rx $HIR,4,0,42,2,33,0,0,*      rx $HP,45,37,0,*
rx $HIR,4,0,42,2,33,0,0,*      rx $HP,45,4,0,*
rx $HIR,4,0,42,2,33,0,0,*      rx $HP,16,0,0,*
rx $HIR,4,0,42,2,33,0,0,*      rx $HP,0,0,0,*
rx $LCD,0,0,0,0,0,0,*
```
tok3=**42**, tok4=**2**, tok5=**33** — our invented attribution and damage, echoed back by a stock
tagger. (Tony, mid-test, unprompted: *"you killed me!!!"* — the first confirmation arrived physically,
before the log did.)

**The armor model reproduced exactly** (P10): armor 70→37→4 absorbing 1:1, then overflow into HP
45→16→0. Four hits × 33 = 132 vs a 115 pool. Death on the fourth.

**What this unlocks — this is the B4 (Utility Box) gating result.** We can now emit *any* BRX tag from
$20 of parts: respawn stations, capture points, hills, supply drops, perk emitters, the medic heal-gun
and EMP. Everything the sealed grenade refused to give us (G7 no data port, G8 objective modes locked)
is now ours to build, with **full per-player attribution** — the emitted word carries a player id, so a
station knows exactly who tagged it.

**Note:** `$HIR` tok1 = **4 (gun body)**, not 0 (front dome), even though the LED was aimed at the
headset. At 40 cm the beam is wide enough to wash over both; the gun-body sensor won. Worth controlling
for when the Utility Box's aiming geometry matters.

**Harness bugs to avoid repeating (mine, both cost a run):** `ConnectionManager` has **no `drain()`** —
a `hasattr` guard silently returned an empty list and reported a false negative on a run that had
actually killed the player. And **`get_events()` returns a dict** (`alias`/`events`/`last_seq`/
`truncated`), not a list — iterating it yields key names. Use `get_events(alias, since_seq)['events']`.

## 2026-08-26 (bench) — 🏆 THE SPECIAL-WEAPONS TIER IS REAL: medic, armor and SHIELDS all proven over IR

Fully automated closed loop (emit IR from our ESP32 + read the victim's BLE stream), no human in the
lab. Victim Tactix-FE30, `$TID,1`, full 12-row `$SIR` table from `brx-protocol.md` §5.

### The IR word is now 100% decoded — the last unknown field is the `$SIR` SUBTYPE
```
U=0 → $HIR,4,0,42,2,1,0,0    U=1 → $HIR,...,0,1    U=3 → $HIR,...,0,3    U=2 → (ignored)
```
The **U bits (21–22) are the `$SIR` subtype**, echoing to **`$HIR` tok7**. Clean control: rows were
pushed for subtypes 0/1/3 and **only 2 — the one without a row — failed.** Together with B, the
emitter addresses the exact `<protocol, subtype>` composite key a `$SIR` row is indexed on:
**16 × 4 = 64 addressable effect slots, all writable by us over BLE.**

### `$SIR` functions, driven from our own emitter — ALL CONFIRMED
| protocol | fn | effect | measured |
|---|---|---|---|
| 0 / 6 / 8 / 10 / 13 | 1 | damage | lands on every protocol **once its row exists**; tok2 echoes the protocol |
| **1** | **10** | **respawn + add HP** | HP **15 → 35 → 45**, +20/shot = the **damage field is the amount**, clamps at max, **deals no damage** |
| **3** | **13** | **add armor** | armor **0 → 30 → 60 → 70**, +30/shot, and **overflow spills into SHIELDS** (`$HP,15,70,20`) |
| **2**/sub 1 | **11** | **add shields** | shield **0 → 50 → 70**, and a follow-up hit drains **shield first** (`$HP,45,70,69`) |

**`D8` is not "damage" — it is the MAGNITUDE.** The `$SIR` function decides what the magnitude is
applied to: damage, HP, armor or shields.

### 🔴→✅ P16 CLOSED — shields DO activate
The shield pool that stayed 0 through all of G-2 despite `$PSET` shield=70/99 fills instantly from an
**IR function-11 event**. Shields are **not** a BLE-writable pool value; they are granted by an IR
effect. Damage order confirmed on the wire: **shields → armor → HP**.

### NEW FIRMWARE BEHAVIOUR: friendly functions are TEAM-GATED
`$SIR` fn 10/11/13 register **only from a same-team source**. Heal fired as team 1 at a team-1 victim:
3/3 hits. The identical word as team 0/2/3: **0 hits, silently dropped.**
This is an **asymmetry we did not know existed** — bench exp 4 proved *damage* is NOT friendly-fire
gated in firmware (same-team damage lands under `$GSET` tok1 = 0 and 1). So the gate is **per-function,
not global**: damage ignores teams, support effects require a match. **A medic gun enforces
"allies only" in hardware, with zero host logic.**

It also explains three earlier false negatives in this session: every failed heal/armor/shield attempt
was fired as **team 2 at a team-1 victim**. One cause, three wasted trials, and the emitter was never
at fault. (Two other false negatives were my own harness: filtering `$HIR` on `,42,` while sweeping the
player id, and an incomplete 6-row `$SIR` table.)

### The `$SIR` sound field works too
Tony, listening at the bench during the armor run: *"i heard it say something and then armor, armor"* —
that is `$SIR,3,0,**VA16**,13`'s sound id playing on the victim. Custom per-effect audio is live.

### What is now buildable
Medic/heal gun · armor-repair station · shield charger · overshield modes · and every objective
station (respawn/hill/capture/supply) — from an ESP32, a 2N2222A and a 940 nm LED, with full
per-player attribution and hardware-enforced friend/foe rules. **No Companion logic required for the
effect itself** — the tagger applies it natively.

## 2026-08-26 (bench, overnight/unattended) — `$SIR` FUNCTION MAP enumerated; IR cannot revive the dead

Fully autonomous (emitter + BLE, operator away, `$VOL,3`). Victim Tactix-FE30 on mains power
(`$VOLTS,8520,4125,100,100`). Method: for each function, push `$SIR,5,0,,<fn>,0,0,1,,*`, respawn,
wound to a fixed **HP 15 / armor 0 / shield 0** baseline, then fire **2 IR shots on protocol 5 with
magnitude 20** and read the resulting `$HP`.

### ❌ A1 — IR CANNOT REVIVE A DEAD PLAYER (important negative for the Utility Box)
Killed the victim (`$HP,0,0,0`), then fired protocol-1 / function-10 ("respawn + add HP") at it:
**0 registrations, no HP change, and a follow-up damage probe also got nothing.** A dead gun ignores
**all** incoming IR.

⇒ A respawn station does **not** work by shooting a corpse back to life. This lines up with **B12**:
the station's role is to **arm a living tagger** into station-respawn mode *before* it dies (passive
beacon or the grenade-button press), after which the gun's own respawn path handles the revive. Design
the Utility Box's respawn node accordingly — it is an **arming** emitter, not a healing one.

### `$SIR` function map (fn → effect on the pools), magnitude 20
> **⚠ READ THE NEXT ENTRY FIRST — this table is only HALF the map.** Every shot here was fired
> **same-team with FF off**, which (as the friend/foe matrix later proved) *silently blocks the entire
> damage family*. So the "no registration" rows below are mostly damage functions that were never
> allowed to land, not inert values. The complete two-sided map is in the follow-up entry.

| fn | effect | evidence (HP,armor,shield) |
|---|---|---|
| 9, 12, 16, 19 | **add HP, overflow → ARMOR** | `15→35`, then `45,10` |
| **10**, 17 | **add HP, clamp (no overflow)** | `15→35`, then `45,0,0` |
| 14, 21 | **add HP, overflow → SHIELD** | `15→35`, then `45,0,10` |
| **13**, 15, 20, 22 | **add ARMOR** | `15,20,0` → `15,40,0` |
| **11** | **add SHIELD** | `15,0,20` → `15,0,40` |
| 18 | **add shield, but COSTS 4 HP** | `11,0,20` → `11,0,40` — a *conversion*? worth a closer look |
| **23, 31, 32, 34** | **register but change NO pool** | `$HIR` fires, `$HP` unchanged at `15,0,0` |
| 0–8, 24–27, 29, 30, 33, 35–44 | no registration | — |
| 28 (tear gas per §5), 45 | no registration on protocol 5 | may be protocol-bound |

**So there are three distinct "add HP" flavours** differing only in where the overflow goes (nowhere /
armor / shield) — that is a real design lever: a medic that tops up armor vs one that grants overshield.

**fn 23/31/32/34 are the stun/EMP candidates.** They produce a `$HIR` (so the event is accepted) but
touch no pool and emit no other BLE frame. A stun would look exactly like this from the host side —
the effect would be on the gun's ability to fire, which **cannot be tested without a trigger pull**.
⇒ **Next bench with a human: set `$SIR,5,0,<sound>,23|31|32|34` and try to fire the victim's trigger
while the effect is active.** That is the remaining unknown for the EMP weapon (recall `$STUN` over
BLE is a proven no-op, and the APK lists a weapon category 10 "Stun").

## 2026-08-26 (bench, unattended) — 448-word brute force: a DEAD gun accepts NO IR

Tony's correction ("IR CAN respawn — the grenade does it") sent me back to test this properly instead
of concluding from one probe. Killed the victim, then emitted **448 distinct IR words** without
reviving it:
- **Pass 1 — protocol 15 exhaustively:** subtype 0–3 × team 0–3 × magnitude 0–15 (256 words), i.e.
  every possible grenade-beacon shape including our decoded Respawn (mag 6) and Hill (mag 8) modes.
- **Pass 2 — every protocol 0–15 × team 0–3 × magnitude {6, 8, 45}** (192 words).
- `$SIR` rows pre-pushed for protocol 15 subtypes 0–3 (fn 10) and protocol 1; also tried with a bare
  table and with **no `$SIR` table at all**.

**Result: zero `$HIR`, zero `$HP`.** (⚠ my script's own verdict line printed "SOMETHING REVIVED IT" —
that was a **false positive in my detector**: the five "responses" were all `$VOLTS`, the gun's periodic
30 s battery telemetry. Do not trust a bare "any frame arrived" test on this stream.) The trailing
control passed — respawn via `$SPAWN` then two clean damage registrations — so the rig was healthy.

**Reconciled with Tony's hardware fact, not against it.** Both are true if the grenade's respawn
station **arms a living tagger** rather than reviving a corpse — which is exactly what **B12** already
records (two arming paths: passive pre-game beacon exposure, or the post-start grenade-button press,
after which the gun's *own* respawn path performs the revive). So: **an IR station cannot resurrect the
dead; it re-routes how a living player will respawn.** The Utility Box respawn node is an *arming*
emitter. Still to settle at the bench with the grenade present: capture what it actually beacons and
replay it (see the ⭐ grenade item in FOLLOWUPS).

### New leads from Tony, same night
- **KotH gives a RATE-OF-FIRE BOOST to whoever holds the hill — "that must be IR".** Agreed, and it
  fits the data: a fire-rate buff changes **no health pool**, which is precisely the signature of my
  **friendly-side no-pool functions (31, 32, 34)**. Those had no explanation until now. A buff
  delivered by the hill beacon to the holder is the obvious candidate. **Not verifiable without a
  trigger pull** — needs a human at the bench.
- **Supremacy robots explode on death, emitting IR from the HEADSET.** ⇒ headset emission is a
  `$WEAP` **powerType** setting (`PowerType/IRSource` enum has `HeadSetOnly`, `GunAndHead`,
  `DoubleGunAndHead`) plus the `extraHeadsetDamage` / `extraHeadsetRange*` / `headsetDirection` /
  `headsetRepeat` fields. A death-nova / suicide-bomber weapon is buildable from existing tokens.

## 2026-08-26 (bench, unattended) — the COMPLETE two-sided `$SIR` function map + crit multiplier + FF enforcement

The companion entry to the half-map above. Every result below was taken with the IR emitter against
live Tactix-FE30, `$VOL,3`, mains power, and **a trailing known-good control** — added after an earlier run
produced sixteen clean-looking negatives that turned out to be a configuration artifact.

### Why the first sweep was half a map
The earlier sweep fired **same-team with FF off**, which silently blocks the entire damage family. Re-run
as an **enemy**, the missing half appeared. Two sweeps, opposite polarity, same baseline method.

### `$SIR` function classes (magnitude 20, protocol 5, baseline HP45/armor70/shield0)
| class | function ids | measured behaviour |
|---|---|---|
| standard damage | 1, 4, 5, 7, 29, 30, 33, 38 | armor 70→50→30 (−20/hit) |
| **ARMOR-PIERCING** | **2, 6** (+17, 21 enemy-side) | **HP 45→25→5 with armor untouched at 70** |
| **×1.25 damage** | **36** | magnitude 20 lands as **25** (armor 70→45→25) |
| **×2 damage** | **37** | magnitude 20 lands as **40** (armor 70→30→10) |
| add HP, overflow→ARMOR | 9, 12, 16, 19 | 15→35, then 45 + armor 10 |
| add HP, clamp | 10, 17 | 15→35→45, no overflow |
| add HP, overflow→SHIELD | 14, 21 | 15→35, then 45 + shield 10 |
| add ARMOR | 13, 15, 20, 22 | 0→20→40 (overflow spills to shields) |
| add SHIELD | 11 | 0→20→40 |
| add SHIELD | 18 | shield 0→20→40 — ⚠️ an earlier note here said it "costs 4 HP"; that was a contaminated baseline. Re-measured clean: **HP and armor untouched.** |
| **status — registers, NO pool change** | enemy 3, 8, 23, 24, 25, 26, 27, 28, 35 · friendly 31, 32, 34 | `$HIR` fires, pools unchanged, no other BLE frame |

### DUAL-POLARITY confirmed (same row heals allies, damages enemies)
Same function, same baseline, only the shooter's team changed — control passed:
```
fn=1   friendly 0 hits          | enemy HP 40->20           damage-only
fn=10  friendly heals           | enemy 0 hits              heal-only
fn=16  friendly HP 25->45       | enemy HP 40->20           DUAL
fn=17  friendly heals           | enemy HP 25->5 (AP)       DUAL + armor-piercing
fn=20  friendly armor 35->55    | enemy armor ->0           DUAL
fn=36/37 friendly 0 hits        | enemy damage              damage-only
```

### CRIT = x1.5 damage (replicated, alternating)
Per-hit armor deltas at magnitude 20: `crit=0 -> [20,20,20]` and `crit=1 -> [30,30,...]`, twice each.
Crit also echoes on **`$HIR` tok6**. It reads 0 on every stock weapon — never dead, just never set.

### `$GSET` token 1 = friendlyFire, and it IS firmware-enforced
Replicated 2x with alternating values, fresh wound per leg, control passed:

| `$GSET` t1 | dmg same-team | dmg enemy | heal from ally | heal from enemy |
|---|---|---|---|---|
| **0** (FF off) | **blocked** (0, 1) | 3, 3 | 3, 4 | **blocked** (0, 0) |
| **1** (FF on) | 4, 3 | 3, 3 | 3, 5 | 5, 3 (4/4 in a separate tiebreak) |

**Reconciling with exp-4** (which recorded "FF is not IR/firmware-enforced"): that bench ran at **FF=1**
and saw same-team damage land — **which is exactly this table's t1=1 row.** The two results agree; only
the *generalisation to t1=0* was unsupported. No contradiction in the evidence, just in the conclusion.

### Clean negatives
- **All 16 protocols accept damage** with a fn-1 row — there is no protocol whitelist.
- **`$SIR` params p5-p8 do NOT scale damage** — `0,0,1,-` / `0,50,1,-` / `0,100,2,60` / `0,200,2,60` /
  `50,100,2,60` all landed exactly 20. Whatever `90,1,40` and `100,2,60` do, it isn't a multiplier.
- **`$AS` / `$UP` are silent** on v4.32 across seven shapes — neither is a query (P4).

### CONSEQUENCE FOR THE SHIPPED GAME (raised by brx-opus2, verified in the next entry)
`gameconfig._SIR_TABLE` — pushed by `Compiler.compile()` into **every** game head — contains
`$SIR,0,1,,36` (x1.25), `$SIR,0,3,,37` (x2) and `$SIR,9,3,,24` (**status, no pool change**). Weapons are
keyed to those rows by their `t3,t4`: Force Rifle + Sniper Rifle are `0,1`; Burst Rifle, Bolt Rifle and
AMR are `0,3`; **Energy Launcher is `9,3`**.

## 2026-08-26 (bench, late) — MELEE captured off the wire from NATIVE mode; our BLE config can't melee

Tony swung a melee at the VS1838B. **It did not work under our BLE-pushed config** — he had to reboot
the gun into a **native on-gun game** to get a melee at all. Four swings, one clean 25-bit capture:

```
1101000111010101101000110
protocol=13   player=7   team=1   magnitude=90   crit=0   subtype=1   parity ok
```

**Three findings:**

1. **Protocol 13 = `MeleeDamage`** — a **seventh** hardware anchor for the DamageType enum, and the
   first captured from a *genuine Battle Company emission* rather than inferred from a `$SIR` row or
   produced by our own emitter. The B-field-is-DamageType mapping is now beyond reasonable doubt.
2. **Subtype 1 = Rifle Bash.** The shipped `_SIR_TABLE` has `$SIR,13,0,H50` (Energy Blade),
   **`$SIR,13,1,H57` (Rifle Bash)**, `$SIR,13,3,H49` (War Hammer). So the U-bits/subtype field is
   confirmed on **real hardware emissions**, not just our synthesized words.
3. **Melee magnitude = 90** — most of a 115 pool in one swing. Note it does **not** one-shot on its own,
   so Tony's "halo assassinate" (one-hit kill on a BACK head sensor) must come from somewhere else:
   either a back-sensor bonus, or the back dome routing to a different `$SIR` cell. `$HIR` tok1
   distinguishes the domes (0 front / 1 back / 4 gun) — **one back-dome swing would settle it.**

### 🔴 GAP: our compiled game head does not enable melee
> ⚠️ **SUPERSEDED the same night.** Two independent reviews of the Callsign captures found our melee
> surface is **byte-identical** to the app's — `$WEAP,4` character-for-character, all three `$SIR,13,*`
> rows, `$GSET` with `gyroscope=1`, and all seven `$BMAP` rows including **`$BMAP,8,4`** (gyro → melee).
> So the candidate causes below are **refuted**: it is a runtime/state/trial issue, not a frame.
> `$WEAP` t7–t11 are empty in *every* captured frame *and* ours, so P1's "dormant" call stands.
> See FOLLOWUPS **K4** for the one-swing bench test.
Stock native games have it; ours don't. Candidate causes, in order:
- **`$WEAP` secondary-fire block (t7–t11)** — `secondaryDamageType` would carry **13**. This is the
  same mechanism as Tony's **K2** ask (secondary weapon / perk on ALT), so the two are one problem.
- **`$BMAP`** — `gameconfig._BMAP` may not map a melee action; note the firmware has a "disabled"
  trigger chirp when `$BMAP` is absent, so button mapping is load-bearing.
- **`$WEAP` t20 = 13** is the *fire mode* for a dedicated melee weapon, which is NOT what we want here —
  native mode gives bash **alongside** a rifle, i.e. a secondary action.

⇒ **Making melee work is probably the same fix as making ALT-fire perks work.** High value: it is a
stock feature we currently lose, and it is the direct route to K2.

### Headset emission — cannot be forced over BLE
`$IRTX` (5 shapes), `$HFIRE` (5), `$MELEE` (4) and `$BHIT` (2) produced **zero IR**, with a
receiver control passing immediately before and after the run (RAW=1, RAW=3). `$MELEE,255,*` does
return **`$BUT,4,0,*`** (a button notification), so it is not wholly inert — it just does not fire the
emitter. **Melee remains the only known way to make a tagger emit from the headset**, and it needs the
physical action plus a native game.

## 2026-08-26 (bench, unattended) — tok5 is the RAW magnitude · AP bypasses EVERY pool · heals clamp · the EMP survives an $AMMO re-push

Clean `$PSET` baseline (45 HP / 70 armor / 70 shield), consecutive-frame pool deltas so the numbers are
baseline-independent, trailing known-good control passed.

### 🔴 `$HIR` tok5 = the RAW magnitude, NOT the applied damage (corrects §7r / P10)
| row | magnitude sent | `$HIR` tok5 | actual pool delta |
|---|---|---|---|
| `<0,0>` fn 1 | 20 | **20** | −20 |
| `<0,1>` fn 36 | 20 | **20** | **−25** |
| `<0,3>` fn 37 | 20 | **20** | **−40** |

tok5 simply echoes the IR word's magnitude field. **Crit multiplies on top** (2026-08-26 night, 3/3 per
cell at magnitude 20): fn 1 crit=1 → 30 (×1.5), fn 37 crit=0 → 40 (×2), **fn 37 crit=1 → 60 (×3)**. So the
full rule, in one place:

> **applied damage = magnitude × `$SIR`-function multiplier × (1.5 if the crit bit is set)** — fn 1 = ×1,
> fn 36 = ×1.25, fn 37 = ×2. `$HIR` tok5 carries only the **magnitude**.

The earlier "tok5 = applied damage, EXACT" finding was correct for everything it tested — **all four of
those weapons key to fn-1 rows** (mult 1, crit 0), where raw and applied are the same number. ⇒ **Never
use tok5 for damage-weighted scoring.** Derive from the `$HP` delta. (Our node path already does, so
nothing shipped is wrong — but the protocol doc was.)

### 🔴 ARMOR-PIERCING bypasses SHIELDS as well as armor
```
shields granted -> $HP,45,70,70
then AP (fn 2)  -> $HP,25,70,70 -> $HP,5,70,70
```
HP fell 45→25→5 with **armor unchanged at 70 and shield unchanged at 70**. AP ignores *every* protective
pool, not just armor — so an AP weapon's effective target pool is the bare HP value (45 by default),
regardless of how much armor or shield the victim is carrying. That is a far stronger weapon axis than
"ignores armor" implied.

### Heals CLAMP — no overheal
Magnitude **200** into each grant function: HP fn 10 → 45 (max), armor fn 13 → 70 with the overflow
filling shields to **70** (their max), shield fn 11 → 70. Nothing exceeds a pool ceiling, so a big
magnitude is a *fill*, not a stack.

### The fn-23 disable SURVIVES an `$AMMO` re-push
After the EMP, `$ALCD` reads `0,0,0,0,0`. Pushing `$AMMO,0,32,192,1,*` **does not clear it** — `$ALCD`
still reports all zeros afterwards. So recovery is not a simple ammo write; the disable is a deeper
state (candidates for the next bench: `$WEAP` re-push, `$SPAWN`, or a physical reload). **This makes the
stun stickier than assumed** — worth knowing before designing an EMP with a short intended duration.

### No status function is a damage-over-time
Each of enemy-side 3, 8, 23, 24–28, 35 and friendly-side 31, 32, 34 fired once, then 18 s of stream
watched: **no HP ticks without further shots.** If poison / cryo / incendiary exist as `$SIR` functions,
they do not drain the health pools over time.

### `$BHIT` is echoed, not applied
Four shapes sent; each came back on the event stream but produced **no `$HP` change**. (Caveat: the
echo may be our own TX frame in the buffer — the useful fact is that no damage was applied.)

## 2026-08-26 (bench, unattended) — EMP fully specified · crit MULTIPLIES with the damage multiplier

Clean baseline (`$PSET` 45/70/70 + a real AR `$WEAP` + `$AMMO,0,32,192`), so `$ALCD` has meaningful
content. Trailing known-good control passed.

### ✅ THE EMP IS NOW FULLY SPECIFIED
**⚠️ Correcting an earlier reading in this log:** the disable frame is **`$ALCD,32,0,0,192,0`**, *not*
`0,0,0,0,0`. The all-zeros version only appeared because that earlier victim had no weapon/ammo
configured. With a real loadout:

- **Ammo is PRESERVED** (mag 32, reserve 192 both intact).
- **Only `$ALCD` token 2 changes: 100 → 0.** brx-opus's source read has t2 always 100 in normal
  operation, so t2 is a *ready/enabled* flag. **fn 23 clears the ready flag — it does not strip ammo.**

**Recovery matrix — what actually clears it:**
| attempted recovery | `$ALCD` after | cleared? |
|---|---|---|
| `$AMMO` re-push | `32,0,0,192,0` | ❌ |
| `$WEAP` re-push | `32,0,0,192,0` | ❌ |
| `$WEAP` + `$AMMO` | `32,0,0,192,0` | ❌ |
| **`$SPAWN`** | **`32,100,0,384,0`** | ✅ |
| `$SPAWN` + `$AMMO` | `32,100,…` | ✅ |
| `$BMAP` re-push | (silent) | ❌ |
| full `$CLEAR`/`$START`/re-arm | `32,100,…` | ✅ |

⇒ **`$SPAWN` is the antidote.** So an EMP's duration **is** ours to control: the victim stays disabled
until MC or the Companion sends `$SPAWN`. That is a clean, fully host-timed stun — and it needs no new
protocol work. (Note `$SPAWN` also restores health, so a "stun only" needs the pools re-set after, or a
different recovery to be found.)

### ✅ CRIT MULTIPLIES WITH THE `$SIR` MULTIPLIER (3/3 per cell, magnitude 20)
```
fn 1  <0,0>  crit=0 -> [20] [20] [20]      1x
fn 1  <0,0>  crit=1 -> [30] [30] [30]      x1.5
fn 37 <0,3>  crit=0 -> [40] [40] [40]      x2
fn 37 <0,3>  crit=1 -> [60] [60] [60]      x3   ( = x2 * x1.5 )
```
They **compose multiplicatively**. A magnitude-20 word can land as 60 damage — over half a default
pool — from the crit bit and a table row alone, with no change to `$WEAP` t5. Worth remembering when
balancing: the shipped `t5` is a floor, not the damage.

### fn 18 is a plain add-SHIELD (correction)
3 reps: shield 0→20→40 with **HP 45 and armor 70 untouched**. The earlier "costs 4 HP" note came from a
baseline that had already shifted; there is no HP cost.

## 2026-08-26 (bench, unattended) — EMP is a ~6–8 s FIRMWARE-TIMED stun · `$GREN` emits a SECOND IR protocol

### ✅ EMP FULLY SPECIFIED — it self-clears on a firmware timer
`$ALCD` only streams on ammo events, so an idle watch proves nothing (my first 75 s null was
**inconclusive, not negative**). Using an `$AMMO` re-push as a *read probe* — proven earlier to force an
`$ALCD` without clearing the disable — token 2 (100 = ready, 0 = disabled) reads:

```
before EMP  100        right after  0        t=+20/40/60/90s  100
```
Narrowed, 3/3 reps identical:
```
rep0  2.5s:DISABLED  5.3s:DISABLED  8.0s:READY
rep1  2.5s:DISABLED  5.3s:DISABLED  8.1s:READY
rep2  2.5s:DISABLED  5.3s:DISABLED  8.0s:READY
```
⇒ **the disable lasts ~6–8 s and ends by itself.** This confirms brx-opus's prediction from the FSET
sound envelope (**EmpStart → EmpLoop → EmpEnd** = a begin/loop/**end** timed effect). `$SPAWN` still
clears it early, so we have both a native duration and an override.

**Full EMP recipe:** `$SIR,7,<sub>,<sound>,23` on the victim + emit protocol 7 → target's weapon goes
not-ready for ~6–8 s, ammo preserved, health untouched, self-recovering. Category 10 "Stun" is
buildable today. (Still unconfirmed by a human: that the trigger genuinely does nothing during the
window — `$ALCD` t2 is a strong proxy but a trigger pull is the real test. → bench list.)

### 🆕 `$GREN` EMITS IR — a SECOND, UNDOCUMENTED BRX IR PROTOCOL
This **overturns my own earlier conclusion in this log** that IR emission can't be forced over BLE.
That held for `$IRTX` / `$HFIRE` / `$MELEE` (all zero IR, receiver controls passing) — but **`$GREN`
emitted on 8/8 probes**, against a **20 s idle baseline of exactly 0 ambient frames**.

It is **not** the 25-bit shot word:
```
0000001010000010000000000000        28 bits
00000010100000100000000000000001    32 bits
```
Same physical layer (~2029 µs sync, ~500/1000 µs marks) but a **longer frame with invalid shot-parity**.
Our 25-bit field map produces nonsense on it.

**What it is (brx-opus, from source):** the **gun→grenade accessory-CONFIG channel**. `$GREN` configures
a paired *thrown* grenade's blast type (`GrenadeType` = FlashBang/Gas/Confusion/Molotov), pairing is
done by aiming the gun and pulling the trigger, and the grenade hardware carries an IR **receiver**
alongside its emitters. So BRX has **three IR things**: (a) the 25-bit shot word, (b) the grenade state
beacon — which rides *inside* the shot format as protocol 15, and (c) **this**, which nothing public
decodes.

**Scope honestly (brx-opus's caution, and it's right):** this does **not** let a gun "shoot" an
arbitrary damage or station word. It emits the accessory format, so its value is gun→accessory
signalling — useful if the Utility Box learns to speak it, not a replacement for our own emitter.

**Open:** does the emitted word track `$GREN`'s arguments? Frames appeared for every arg shape (2–4
each) but **all were split by the capture sketch's RAW-print latency**, so no full word was recovered.
⇒ **Needs a sketch tweak (raise `IDLE_GAP_US`, or drop the per-frame RAW print) to capture a
30+ bit word intact.** If it is arg-drivable, the gun becomes a programmable accessory emitter.

## 2026-08-26 (bench, unattended) — the SHIPPED `_SIR_TABLE` measured weapon-by-weapon

Recorded late: `docs/weapon-design.md` §6.2 cited this run before it was written up here. The numbers
below are the primary evidence for the multiplier/Energy-Launcher findings.

**Method:** push the real `gameconfig._SIR_TABLE` **verbatim** to the victim, then fire **one** IR word
per case carrying that weapon's actual `<t3, t4, t5>`. Three trials per row, **`hits == 1` verified on
every trial** — without that check a ×2 multiplier is indistinguishable from two registered hits, which
is exactly what fooled the first pass (Bolt/AMR looked broken, Burst looked fine; same cause).

```
row (weapon key)              magnitude   trials (hits : per-hit damage)
fn 1   synthetic baseline     20          1:[20]  1:[20]  1:[20]
fn 36  synthetic              20          1:[25]  1:[25]  1:[25]     = x1.25
fn 37  synthetic              20          1:[40]  1:[40]  1:[40]     = x2
SHIPPED <0,0> -> fn 1         20          1:[20]  1:[20]  1:[20]     the other 12 weapons
SHIPPED <0,1> -> fn 36        20          1:[25]  1:[25]  1:[25]     Force Rifle, Sniper Rifle
SHIPPED <0,3> -> fn 37        20          1:[40]  1:[40]  1:[40]     Burst, Bolt, AMR
SHIPPED <9,3> -> fn 24        20          1:[0]   1:[0]   1:[0]      *** ENERGY LAUNCHER: ZERO ***
SHIPPED <8,0> -> fn 38        20          1:[20]  ...                Charge Rifle: normal 1x
SHIPPED <6,0> -> fn 1         20          1:[20]  ...                Rail Gun: normal 1x
SHIPPED <13,3>                20          1:[20]  ...                melee: normal 1x
```
Trailing known-good control passed.

⇒ **The multipliers behave identically through the shipped rows as through a synthetic one**, and the
**Energy Launcher cannot damage anyone** in any game we currently ship — its `<9,3>` key lands on
`$SIR,9,3,,24`, a status function that moves no pool.

**Scope note (honest):** the fn-38 / fn-1 / no-pool *classifications* come from the protocol-5 function
sweeps in the earlier entry; what this run adds is that the **shipped keys route to those functions and
produce the same numbers**. The `<9,3>` zero and the two multiplier ratios are measured here directly.


## 2026-08-26 (bench) — is the IR parity ENFORCED? (the measurement behind the correction)

Recorded late: this run is cited by `protocol/brx-ir-protocol.md` and by `irbridge.payload_parity()`'s
docstring, but was never written into the primary evidence record. Emitting at Tactix-FE30, **8 shots per
variant**, everything else held constant:

| Z bits sent | registered |
|---|---|
| rule-correct (`01` for this word) | **8 / 8** |
| deliberately wrong but differing (`10`) | **8 / 8** |
| `00` | **0 / 8** |
| `11` | **0 / 8** |

⇒ **the gun's acceptance test is exactly `Z0 != Z1`** — either differing pair lands, equal pairs are
rejected outright. The odd/even parity rule derived earlier is still a true description of what
*genuine* BRX frames carry (4/4 captured words obey it, and `decode_word().parity_matches` is a useful
tell for distinguishing our traffic from a real gun's), but it is **not** an acceptance gate.

This corrects the B13 entry above, which asserted that a fixed `"01"` parity "would have emitted
invalid frames".

## 2026-08-26 — free IR-protocol slots: the "~10 free" figure is wrong

Three different counts were circulating. The accurate one: the 4-bit protocol field holds **0–15**, and
BRX ships `$SIR` rows on **0, 1, 2, 3, 6, 8, 9, 10, 11, 13** plus **15** for the grenade beacon — so the
genuinely unused values are **4, 5, 7, 12 and 14**. Earlier notes in this log saying "~10 free custom
slots, a real design constraint" are **superseded twice over**: the count was wrong, and scarcity is not
the constraint anyway — the protocol field pairs with the 2-bit subtype to form the `$SIR` key
(**16 × 4 = 64 cells**), and we push the table, so occupied protocols are re-definable per game.

## 2026-08-27 (bench, Tony firing) — ❌ RETRACTED: `$SIR` fn 23 is NOT a weapon disable

**The EMP finding from 2026-08-26 is wrong.** It was promoted to CONFIRMED on `$ALCD` token 2 alone —
a proxy — and flagged at the time as needing a trigger pull. The trigger pull says otherwise.

**Method:** Tactix-E20D armed with `$SIR,7,0,,23`, volume 69. 8 EMP words over ~6 s while Tony held the
trigger. No `$AMMO` probing this time (the earlier read-probe reset the magazine every 2 s and may
itself have cleared the effect). Trailing control: 2 plain protocol-0 damage shots.

```
$ALCD,31,100 -> 31,0 -> 30,0 -> 29,0 -> 28,0 -> 27,5      <- mag 31,30,29,28,27 while t2 = 0
$HIR x9      $HIR,4,7,42,2,20,0,0     (tok2 = 7: the EMP words landed)
$HP          45,70,0 unchanged throughout
control      2x $HIR, $HP 45,50 -> 45,30   (rig reaching the victim fine)
```

**The magazine decrements while token 2 reads 0.** The gun was counting Tony's shots *during* the
supposed disable. Tony, independently: *"yeah i could fire fine"*, *"i got hit like normal"*.

⇒ **fn 23 does not disable the weapon.** It registers a hit (protocol echoes on `$HIR` tok2), moves no
health pool, and briefly drives `$ALCD` token 2 down.

**And token 2 is not a binary ready flag.** Sampled across both runs it reads **100 → 0 → 5 → 9 → 31 →
100**: a *meter* that dips and refills over ~5–8 s. The earlier "always 100, so 0 means unloaded"
reading came from only ever sampling the extremes. What it actually measures is **unknown** — it does
not gate firing. Candidates: a HUD/display element, a hit-feedback indicator, some recharge unrelated
to the trigger.

### What this invalidates
- **U11 is REOPENED** — "which status function is the stun/EMP?" is unanswered. fn 23 is eliminated.
- **The "EMP recipe"** (`$SIR,7,<sub>,<sound>,23`) does **not** produce a stun. Category 10 "Stun"
  is **not** buildable this way.
- The `$SPAWN`-clears-it and ~6–8 s self-clear findings describe **token 2's meter**, not a disable.

### What survives
`$SIR` fn 23 still registers a hit with no pool change, so it remains a usable **"tag without damage"**
primitive — objective touches, tagging a checkpoint, marking a player. That is genuinely useful; it is
just not a stun.

### The lesson, recorded because it will recur
A host-visible field that *correlates* with a state is not evidence of that state. `$ALCD` t2 hitting 0
looked exactly like a disable and had a plausible mechanism (`brx-opus`'s "live gun, nothing loaded"
read from the source) — and the source read was itself reasonable. **The proxy was never tested against
the behaviour it was standing in for.** Everything downstream — the recovery matrix, the ~6–8 s timing,
the `$SPAWN` antidote — was carefully measured and all of it described the wrong thing.

## 2026-08-27 (bench, Tony firing) — ✅ WHAT fn 23 ACTUALLY IS: audio suppression · `$ALCD` t2 = the gun's VOLUME

Follow-up to the retraction above. Two clean runs with Tony on the trigger settle it.

### The gun keeps shooting — measured on the receiver
Muzzle at the VS1838B, 15-second windows, **baseline verified non-zero before proceeding** (an earlier
attempt was void: the baseline read 0 because the operator was reading instructions during the window,
and my own emitter was polluting the receiver — both fixed here, and the script now aborts on a dead
baseline rather than producing an interpretable-looking result):

```
baseline 14  |  during EMP 21  |  recovered 14        (IR frames from Tony's gun)
```
**No suppression of the shot.** Every trigger pull emitted IR normally. Combined with the magazine
decrementing (previous entry), the weapon is **fully functional** during fn 23.

### What it does instead: it SILENCES the gun
Tony, unprompted, is the whole finding here: *"no sound on trigger pull. definitely went quiet and then
got a bit louder and then returned to normal."*

That tracks `$ALCD` **token 2** exactly, sampled across the runs: **0 → 5 → 9 → 31 → 100**.

⇒ **`$ALCD` token 2 is the gun's AUDIO LEVEL**, not a ready flag. ⚠️ **Confidence note:** this is the *best explanation* of one ear report plus one meter moving together — **not two independent instruments**. It is not on the same footing as the IR frame counts (14/21/14), which are directly measured. A second instrument (e.g. a mic, or `$VOL` sweeps vs t2) would settle it. It is normally 100. fn 23 drives it to
**0** and it recovers over **~6–8 s**. The old "always 100, so 0 = live gun with nothing loaded" reading
came from only ever sampling the extremes and never asking what the middle meant.

### So fn 23 is a real, native, emittable mechanic — just not a stun
| property | value |
|---|---|
| registers a hit | ✅ `$HIR` with the protocol echoed on tok2 |
| health pools | ❌ unchanged (45/70/0 throughout) |
| trigger | ✅ works |
| IR output | ✅ normal |
| **gun audio** | **silenced, recovering over ~6–8 s** |

**A sensory-disruption weapon.** The victim can still fight but loses their gun's audio feedback — no
fire sound, no reload chain, no overheat cue. In a game that leans on those cues that is a genuine
effect, and it is **native firmware behaviour we can emit today**.

### Corrections this forces
- **U11 stays REOPENED** — no `$SIR` function has been shown to stun. Category 10 "Stun" is still unbuilt.
- The **~6–8 s timer** and **`$SPAWN` clears it** findings are correct but describe **the audio meter**.
- **`$AMMO` "does not clear it"** likewise — it never cleared audio, and my read-probe was resetting the
  magazine each sample, which is why the mag column looked incoherent.
- **Rename it everywhere**: not "the EMP", but **fn 23 = audio suppression / silence**.

### Method note
Three void runs preceded this one — a dead baseline, an emitter polluting its own receiver, and a
`$AMMO` read-probe that mutated the thing it measured. **A control that is merely *present* is not a
control; it has to be checked before the result is read.** The script now aborts on `baseline < 3`.

## 2026-08-27 (bench) — the `$SIR` function carries its own VICTIM AUDIO · and 24–27 DO damage

**Method that finally worked: Tony holds the gun and does NOT fire.** Three earlier attempts were void
because firing at a bench receiver a few feet away **reflects your own IR back onto your own headset** —
which drained his armor, killed him mid-window, and left the gun dead so he couldn't fire in the next
one. *(New bench hazard, worth remembering: never have the operator fire toward the capture rig.)*
Listen-only removes it entirely: every `$HIR` in this run is ours, and the pools move only if the
effect moves them.

`$SIR,7,0,,<fn>` — **note the sound column is EMPTY**, so every sound below is the function's **own
built-in audio**, not one we assigned.

| fn | what Tony heard | pools (2 words emitted) |
|---|---|---|
| **3** | **"like an electrical hit"** | unchanged |
| **8** | silent hit | unchanged |
| **23** | silent hit | unchanged · **silences the gun** (see previous entry) |
| **24** | **"sounds like a shotgun hit"** | **armor 70 → 30 — DAMAGE** |
| **25** | **"hissing growing sound"** | **DAMAGE** |
| **26** | same hiss as 25 | **DAMAGE** |
| **27** | **"normal AR hit"** | **DAMAGE** |
| **28** | **"different sounding hit + hissing"** | unchanged |
| **35** | normal hit | unchanged |

### Finding 1 — the function selects a SOUND, not just a pool operation
With an empty `$SIR` sound column the victim still plays a **distinct, function-specific** cue:
electrical (3), shotgun (24), a growing hiss (25/26), a hiss with a different impact (28). So a `$SIR`
row picks an **effect family** — audio included — and the sound column is an *override*, not the source.
That makes several of these usable as pure **cue** effects.

**28 hissing is a tidy corroboration:** the shipped table's tear-gas row is `$SIR,11,0,VA2,28`. Gas that
hisses is exactly right, and it was predicted before Tony heard it.

### Finding 2 — ⚠️ WITHDRAWN, DID NOT REPRODUCE (same day)
> A controlled A/B run an hour later — **every function on protocol 5 AND protocol 7, with a passing
> control at both ends (40 damage each)** — read **0 damage for all nine functions on both protocols**,
> including 24–27. **The damage below does not reproduce.**
>
> The tell is the hit count: the run below logged **4 landed from 2 emitted words** for exactly those
> four functions, while the A/B logs a clean **2 landed** for all nine. Something extra was reaching the
> victim, and 70→30 is exactly 2 × 20 — our own magnitude. **Cause unidentified.** The operator was
> holding a live, armed gun and not firing; a stray trigger touch or a reflection is possible but
> unproven.
>
> ⇒ **Treat 24–27 as NO-POOL until a controlled run says otherwise**, and treat the protocol-dependence
> claim below as unsupported. The A/B found **no protocol dependence at all**: same result on 5 and 7 for
> all nine functions.
>
> Original text, superseded:

~~Finding 2 — 24, 25, 26, 27 DEAL DAMAGE, contradicting the earlier sweep~~
Last night's enemy-side sweep recorded 24–28 as *"registers a `$HIR`, moves no pool"*. Here they take
armor **70 → 30** (40 from 2 words at magnitude 20 = **1× damage**).

**The difference between the runs is the PROTOCOL**: the earlier sweep used `$SIR,5,0,,<fn>`, this one
uses `$SIR,7,0,,<fn>`. Same function id, different protocol, **different behaviour** — which should not
happen if the protocol is only a lookup key. **No explanation offered; recorded as a contradiction.**
Both runs had passing controls, so this is not a rig artifact.
⇒ **The function map is protocol-dependent in some way we do not understand.** Any design leaning on a
function's behaviour must pin the protocol it was measured on. Re-run the full sweep on ≥2 protocols
before trusting the classification.

### Still unbuilt
No function has produced a **stun**. `landed=4` on the damaging rows against 2 emitted words also wants
explaining (double-registration?) — not chased today.

## 2026-08-27 (bench) — protocol A/B: NO protocol dependence, and the fn 24–27 damage does not reproduce

Wire-only, silent (`$VOL,3`), operator not involved. Nine functions × protocol 5 and 7, **control at
both ends**.

```
control proto0/fn1   landed=2  damage=40   OK
fn 24/25/26/27/3/28/23/8/35   proto5: landed=2 dmg=0   |   proto7: landed=2 dmg=0   same
control proto0/fn1   landed=2  damage=40   OK
```

**Two results:**
1. **No protocol dependence.** Every function behaves identically on 5 and 7. The earlier
   "same function, different protocol, different behaviour" contradiction is **resolved as
   non-existent** — one of the two runs was simply wrong.
2. **The fn 24–27 damage does not reproduce.** 0 damage on both protocols, controls passing either
   side. Withdrawn above.

**What survives from the listen-only run:** the **sound map** (electrical 3 · shotgun 24 · growing hiss
25/26 · normal AR 27 · gas hiss 28), which was an ear observation and is untouched by this. And fn 23's
audio suppression, which was measured separately and twice.

**Standing lesson, now twice in one session:** a single well-controlled-looking run is not a result.
Both the EMP disable and this damage finding survived one careful run each and died on the second.
The only claims that have held all session are the ones measured 3× with alternating conditions.

## 2026-08-27 (bench, native Supremacy) — 🏆 K3 CAPTURED: the death explosion, and it is protocol 10 @ 125

**The Sentinel's death-nova, off the wire, clean 25-bit words, no stitching:**
```
t=29.2s  1010000001010111110100010   proto=10  player=1  team=1  MAG=125  crit=0
t=29.4s  1010000001010111110110001   proto=10  player=1  team=1  MAG=125  crit=1
```
Two frames 0.2 s apart, one with the crit bit set. Tony, independently: *"def drops a grenade, it hurt
me."*

### What it tells us
- **Protocol 10 = `StandardLethalExplosive`** — the same type the Rocket Launcher uses. The death
  emission is an **explosive-class IR word**, which is exactly what "drops a grenade" should look like.
  An **8th independent hardware anchor** for the DamageType enum.
- **Magnitude 125 — higher than the Rocket Launcher's 115.** The hardest-hitting single word we have
  measured from any source.
- **It carries the DYING player's own id and team** (player 1 = the Sentinel). So the explosion is
  attributed to the corpse: **a dead player can still get kills.** That is a real scoring consequence —
  MC's scorer must expect `$HIR` naming a player who is already dead.
- The crit bit is set on the second frame, so the nova can crit.

⇒ **K3 is closed as a captured, replayable word.** A death-nova is now `emit(proto=10, player=<victim>,
team=<their team>, magnitude=125)` from any emitter we build — the Utility Box, or a Companion.

### Method — what finally made it work
Four earlier attempts failed and **none of them failed for a protocol reason**:
1. operator firing at the bench receiver → his own IR reflected back, killing him mid-window;
2. our own emitter saturating our own receiver;
3. frame **splitting** — `ir_capture.ino`'s per-frame `RAW` print takes ~15–20 ms at 115200, long enough
   for the next frame to start mid-print;
4. host-side **stitching** of those fragments introduced one-bit misalignments (the giveaway: the same
   word decoding as `player=28/MAG=44` and `player=14/MAG=22` — exactly 2×).

**Fix (committed): `IDLE_GAP_US` 8000 → 30000, and the RAW dump is now toggleable with `r`.** With RAW
off the frames arrive whole and decode first time. **Turn RAW off for any capture that matters** — it is
a debugging aid, not a capture mode. The `player=14` sightings in the stitched runs were misalignment
artifacts and are withdrawn.

### Also captured this session (native Supremacy, Sentinel)
The **charge full-auto** emits **two words per shot** — `proto=0` *and* `proto=8`, same player/team/
magnitude 15. Protocol 8 = `Shrapnel`, and `$SIR,8,0,,38` is the Charge Rifle row: **a 7th enum anchor**,
and evidence that a native weapon can emit **more than one protocol per trigger pull**.

**Still not captured:** the Sentinel EMP ability word — its frames arrived during the splitting era and
never decoded. Worth a retry now that RAW can be turned off.

## 2026-08-27 (bench, observed) — LED LIFE MODE decoded by eye: the gun LEDs are a two-colour pool gauge

Tony, watching a native Supremacy Sentinel while shooting it — this answers the "what are we even
reproducing?" half of the LED cluster (bench item 4.3), which no wire capture could have given us:

> *"his leds on the gun when hit went purple. the 3 leds represented the amount of shields/armor it had.
> as i hit it the purple got less and less, once it went down then it went to blue and it probably
> represented health. it would also slowly deplete in the same way until hp was 0 and it triggered the
> death grenade and death sound. headset flashes green when dead"*

> ⚠️ **INTERPRETATION CORRECTED same day, by Tony:** *"purple/blue was probably bc of the team sentinel
> is on. his supremecy color is blue."* Nexus is the **blue** faction, and `$GLED` colour is already
> known to be **team-derived** (§7i). So **blue is almost certainly his FACTION colour, not "the health
> pool's colour"** — and my "purple = shields, blue = health" reading below conflates the two.
>
> **What is observed (stands):** three LEDs act as a **segmented gauge**; the segments deplete as the
> protective pools drain; the colour **changes** at the point the protective pools are exhausted; a
> second depletion then runs to zero, triggering the death nova.
> **What is inferred (now doubtful):** that the *colours themselves* encode which pool. More likely the
> **segment count** encodes the pools while the **colour** encodes team/faction — with purple plausibly
> a "protected" modifier over the faction colour rather than a pool identity.
> ⇒ **Test:** watch the same sequence on a **red or green** faction character. If the second colour
> tracks the faction rather than always being blue, the colour is team-derived and the gauge is
> segment-count only.

### The native behaviour (as observed)
| element | meaning |
|---|---|
| **3 gun LEDs** | a **segmented gauge**, not a status light |
| **purple** | shown while the **shield/armor** pools have charge — segments extinguish as they drain |
| **blue** | shown after they are exhausted, draining the same way — **but see the correction above: blue is likely the faction colour (Nexus), not a health-pool colour** |
| pool empty | **death grenade** (proto 10 @ 125, captured above) + death sound |
| **headset flashes GREEN** | the **death** indication |

### Why this matters
- **It is a two-stage gauge over the pool order we measured on the wire.** Independently, from `$HP`:
  drain order is **shields → armor → HP**. The LEDs show exactly that sequence — purple (protective
  pools) first, then blue (health). Two completely different instruments, same model.
- **It names the colours to hunt in P13.** The `$GLED` colour index (0–8) must contain a **purple** and a
  **blue**; we now know two of the values are in use and what they mean.
- **It tells us what to build.** LED life mode = drive `$GLED` colour + lit-segment count from the pool
  state, switching colour when the protective pools empty. Our compiled head currently slow-blinks the
  team colour and shows nothing about health — a stock feature we lose in every game we run.
- **Green-on-death from the headset** is a separate cue from `$SFLASH` (the *shooter's* green-sight
  kill-confirm, §7o). Same colour, different actor: the victim's headset marks its own death. Worth
  keeping distinct in the feedback engine (B18).

### Still open in the LED cluster
**P13** (is colour a single 0–8 index?) and **P17** (how to turn the LEDs OFF) are unchanged — both need
a lit gun and a `$GLED` sweep. But 4.3's premise is now answered: **we know what the target behaviour
is.** Only the token that drives it is missing.

## 2026-08-27 (unattended) — `$GREN` word does NOT track its arguments · and why "capture the native EMP" is only half an answer

### `$GREN` accessory emission — negative
Splitting fix in place (RAW off), **baseline 0 ambient frames**, host-driven so no operator involved.
Swept `iRType / crit / modifier / operationMode / channel / GrenadeType / MaxCount` one field at a time:

```
bare            bits=23   00000000000000000000000
bare rpt        bits=32   00000000000000000000000000000010
modifier=99     bits=29   00000000000000000000000100000
operationMode=7 bits=24   000000000000000000000000
channel=5       bits=26   00000000000000000000000000
iRType / crit / GrenadeType      no frame at all
```
**Mostly zeros, variable apparent length, and no correspondence to the arguments.** Repeats of the
*same* command give different lengths (23 / 32 / 19), so either the frame length genuinely varies or it
still fragments for a reason `IDLE_GAP_US=30000` does not fix.

⇒ **`$GREN` is not usable as a programmable emitter** on this evidence. It emits *something*, but we
cannot drive its content. Downgrade the earlier "if the bits track the args, the gun becomes a
programmable accessory emitter" hope — **they do not track.**

### ⚠ REFRAME: capturing the native EMP word will not, by itself, give us a stun
A realisation from the day's own results, recorded because it changes the plan:

**The effect of an IR hit is decided by the VICTIM's `$SIR` row, not by the shooter's word.** We proved
this repeatedly — the same protocol delivers damage, a heal, an armor grant or audio suppression purely
according to the receiving gun's table.

So capturing the Sentinel's EMP tells us **which protocol** the ability uses (evidence so far points at
**protocol 8**, magnitude 15 — though the confirming A/B was void). It does **not** tell us what
function a native Supremacy victim has bound to that protocol, and **we cannot read a native game's
`$SIR` table** — the gun never reports it.

**What this means for the stun hunt:**
- The protocol number is necessary but **not sufficient**.
- The effect must still come from a `$SIR` **function**, and our sweep of the whole function space found
  exactly one non-damage, non-grant behaviour: **fn 23, audio suppression**.
- ⇒ Either the native "EMP" *is* substantially audio/sensory disruption (consistent with the victim
  keeping the ability to fire), **or** the stun lives in a function our sweep could not detect because it
  produces no pool change and no BLE frame — a class our instruments are blind to.
- **The honest position: we may not be able to find a stun by sweeping**, because a stun that only
  affects the victim's trigger is invisible to both the `$HP` stream and the `$ALCD` meter. It needs a
  human pulling a trigger during each candidate — 9 candidates × a trigger test.

**Next-session correction:** capturing the native EMP is still worth 10 minutes (it pins the protocol,
and a non-8 answer would be informative), but it should be followed by **trigger-testing the remaining
status functions**, which is the only method that can actually detect a stun.

## 2026-08-27 (Tony, observed) — the HEADSET LED is autonomous, and rainbow = disconnected

Tony, unprompted: *"the headset does always flash green on death. it slowly blinks rainbow when its
disconnected. it goes team color to match tagger. those are native behaviors that work even in our game
modes."*

⚠️ **REFINED by Tony minutes later — my first table was wrong about green and about when team colour
shows.** His words: *"im not sure full behavior. it will go red/blue to match color until you start the
game and then it will go dark during the game. it blinks green on hit and flashes/stays green on kill."*

| headset LED | when | confidence |
|---|---|---|
| **slow rainbow blink** | **DISCONNECTED / not paired** | good — repeatable, and the useful one |
| **team colour (red/blue)** | **PRE-GAME ONLY** — it goes **DARK once the game starts** | good |
| **dark** | during play | good |
| **blinks green** | **on a HIT** | Tony flags his own uncertainty |
| **flashes / stays green** | **on a KILL** | Tony flags his own uncertainty |
| ~~green flash = death~~ | — | **withdrawn** — my misreading of his first description |

### Why this matters more than it looks
1. **It is a free visual gate for B18b.** A dark/unpaired headset **silently blocks a gun from joining a
   game** — the real cause of every "only 2 of 3 armed" incident. Until now the only detection was
   noticing a gun never entered. **Rainbow blink is a pre-game tell visible across a room**, and it costs
   nothing to use. **Add it to the muster checklist in `field-process.md`: no rainbow before you start.**
2. **These are native and survive OUR game heads** — we get them free, and must not fight them. Nothing
   in our config needs to reproduce green-on-death or team colour.
3. **The headset syncs team colour from the tagger**, so a gun↔headset channel carries team state. That
   is a link we have never characterised and do not drive.
4. ⚠️ **My "green-on-death is distinct from `$SFLASH`" claim is WITHDRAWN.** Green now looks like the
   **hit/kill feedback family** — blink on hit, hold on kill — which is *exactly* `$SFLASH` territory
   (§7o: the shooter's green-sight kill-confirm, one per kill scored). So rather than "opposite actors",
   green is plausibly **one coherent feedback system** the headset participates in. **Open question:
   whose hit and whose kill** — the wearer's, or the wearer's target's? That single answer decides
   whether B18 needs to drive anything here at all, or whether the hardware already does it.
5. **Team colour is pre-game only.** A game head that expects the headset lit during play is wrong;
   dark-during-play is native.

⇒ Headset LEDs are **not** something we need to build. The open LED work (P13/P17/life-mode) is about
the **gun's** LEDs only.

> ### ⛔ CORRECTED 2026-08-30 — "we get them free" is WRONG. Green is HOST-DRIVEN.
> The first full 2-player match on our own stack (see the 2026-08-30 entry) produced **no green at
> all** — not on a hit, not on a death — across **126 landed hits and 12 kills**. Both headsets were
> healthy the whole match (`preflight.headset_ok == true` in all 328 live status envelopes, MC session
> `session-e615e251.sqlite`), so this is not the dark/unpaired failure.
> **If the green were autonomous it would have fired regardless of host — it did not.** Callsign must
> send something on hit/kill that we never send: the only `$HLED` we emit all game is the
> `$HLED,0,0,0,0,0,0` that BLANKS the headset in `END_SEQUENCE`.
> Point 2 above ("these are native and survive OUR game heads — we get them free, and must not fight
> them. Nothing in our config needs to reproduce green-on-death") is **withdrawn**. Point 4's open
> question — *whose* hit and *whose* kill — is still open, but is now a question about a frame we have
> to **send**, not one the hardware answers by itself.
> Rainbow-on-disconnect and pre-game team colour are **untouched** by this: both were observed with no
> host driving them, and the muster gate that rests on rainbow still stands.
> ➡ Next: capture a Callsign game on the Mac and diff the in-play frames against ours — the hit/kill
> feedback frame will be in that delta. Tracked in `FOLLOWUPS.md`.

## 2026-08-27 (unattended) — 🆕 `$QUERY,*` IS A CONFIG READ-BACK over BLE (and P12 is a negative)

Working alone with one gun on BLE, no IR, no operator.

### `$QUERY,*` returns the gun's CONFIGURED state — field map validated one field at a time
```
A  pid40 hp45 ar70 sh70 V3I dmg9 R01   $QUERY,40,1,45,70,70,V3I,1,9,R01,0,,0,,0,,…
B  pid -> 7                            $QUERY,7 ,0,45,70,70,V3I,1,9,R01,…
C  hp33 ar11 sh22                      $QUERY,7 ,0,33,11,22,V3I,1,9,R01,…
D  voice -> V7M                        $QUERY,7 ,0,33,11,22,V7M,1,9,R01,…
E  dmg77 sound S16                     $QUERY,7 ,0,33,11,22,V7M,1,77,S16,…
F  $TID -> 3                           $QUERY,7 ,3,33,11,22,V7M,1,77,S16,…
```
| token | meaning | proved by |
|---|---:|---|
| 1 | **player id** (`$PSET` t1) | 40 → 7 |
| 2 | **team** (`$TID`) | 1 → 0 → 3 |
| 3 | **HP** | 45 → 33 |
| 4 | **armor** | 70 → 11 |
| 5 | **shield** | 70 → 22 |
| 6 | **voice token** | V3I → V7M |
| 7 | constant `1` | — |
| 8 | **weapon damage** (`$WEAP` t5) | 9 → 77 |
| 9 | **fire sound** (`$WEAP` t27) | R01 → S16 |
| 10+ | repeating `0,,` pairs | *(inference)* the other weapon slots' damage/sound, empty here |

**`$QUERY` = CONFIGURED · `$LCD` = CURRENT.** In the same breath the gun returned
`$LCD,45,70,0,0,12,30` (live pools, still the pre-change values because it had not respawned) against
`$QUERY,…,33,11,22` (the newly configured ones). Two different questions, two different commands.

**⚠ Replies arrive SECONDS LATE.** This is why a first attempt looked like `$WEAP,*` was the read-back —
a late `$QUERY` reply landed inside the `$WEAP,*` window. **Query repeatedly until the answer stops
changing**; do not read the first frame that arrives.

### Why this matters
1. **MC can VERIFY a pushed head** instead of assuming it landed. We push ~20 frames blind today, and
   have been bitten by a power-cycled gun silently losing its config.
2. **We can read a NATIVE game's configuration** — put a gun in native Supremacy and `$QUERY,*` should
   report that character's HP/armor/shield and weapon damage. That is a chunk of what the P8 HTTPS
   capture was for, with no proxy, no cert and no Mac. **(Untested — needs a native game.)**
3. **It qualifies P6.** "The gun keeps no score / is never queried" is still true **for score** — that
   finding came from a full game capture where the app never asked. **Configuration is a different
   question and the gun answers it.**

### P12 — `$PB*` playbook family: SILENT on v4.32 (negative)
All twelve shapes — `$PBGAME/$PBWEAP/$PBTEAM/$PBPERK/$PBLIVES/$PBTIME`, bare and with values — plus
`$INIT`: **no reply, no observable state change.** The FB-captured v4.30 remote-start sequence does not
respond on our firmware, so those enum tables cannot be mapped this way here.

### Also silent (for the record)
`$GSET,*` `$PSET,*` `$SIR,*` `$TID,*` `$LCD,*` `$HP,*` — bare reads of the config commands do **not**
work. `$VERSION,*` does (`$VERSION,v4.32,hds.59,4,,devhost.03`). So the read surface is
**`$QUERY` + `$VERSION` only.**

## 2026-08-27 (unattended) — ✅ `$GSET` token 7 = the CRIT MODIFIER, in percent — exact formula

Method: armor **200** so a strong crit cannot clip on the pool ceiling, magnitude 20, **single shot per
trial with `hits==1` verified**, **3 reps per cell**, re-armed between every shot.

```
t7      crit=0 per-hit      crit=1 per-hit
0       [20,20,20]          [20,20,20]        +0%    crits disabled
10      [20,20,20]          [22,22,22]        +10%
25      [20,20,20]          [25,25,25]        +25%
50      [20,20,20]          [30,30,30]        +50%   <- the shipped value
75      [20,20,20]          [35,35,35]        +75%
100     [20,20,20]          [40,40,40]        +100%  crits double
150     [20,20,20]          [50,50,50]        +150%  x2.5
```

> ### `crit damage = magnitude × (1 + t7/100)`

Exact at every level. Non-crit damage is **unaffected** throughout (always 20), so t7 touches **only**
the crit path.

**This refines the ×1.5 finding from 2026-08-26.** That was correct, but only because the shipped
`_SIR_TABLE`/`$GSET` uses **t7 = 50**. **Crit is a tunable per-game knob**, not a fixed 1.5:
- **`t7=0` disables crits entirely** — useful for a "no random spikes" competitive mode
- **`t7=100`** makes a crit exactly double
- values above 100 are honoured (150 → ×2.5), so a high-variance mode is expressible

Combined with the earlier multiplier finding, the full applied-damage formula is:

> **applied = magnitude × (`$SIR` function multiplier) × (1 + `$GSET` t7/100 if the crit bit is set)**

### The rest of `$GSET` — tokens 2–6 and 8 showed nothing
A first sweep flipped each of tokens 2–8 to 0/1/99 and measured enemy damage, same-team damage and crit
damage. **Only token 7 produced a monotonic, reproducible effect.** The apparent deviations on t3=99 and
t5=0 were **hit-count artifacts** (3 registrations where 2 were fired) and did not survive; t2/t4/t6/t8
changed nothing measurable on any of the three axes. ⇒ **tokens 2, 3, 4, 5, 6, 8 remain UNKNOWN** — they
do not affect damage, friendly fire or crit, so whatever they do is outside what an IR damage probe can
see (candidates: gyro/melee enablement, LED/idle behaviour, respawn or lives handling on the on-gun
menu path).

### 2026-08-27 — K1(b) narrowed: `$WEAP` t19 = 5 (AutoReload) does NOT reload on an empty magazine

Tony asked for **auto-reload for kids who can't work the reload lever**. Two mechanisms exist; one
already ships (`alt_reload` remaps `$BMAP,1,97` so the orange ALT button reloads). The second — the
APK's `ReloadType.AutoReload`, ordinal **5**, at `$WEAP` **t19** — was filed as bench-only ("fire dry").
**Part of it is testable unattended**: if the gun reloads *itself*, the refill must appear on `$ALCD`
with nobody touching the trigger.

| config | magazine pushed | `$ALCD` mags seen | result |
|---|---|---|---|
| t19 = 0 (stock) — control | 0 | [0] | no self-reload |
| **t19 = 5 AutoReload** | 0 | [0] | **no self-reload** |
| t19 = 0 (stock) — control | 1 | [1] | no self-reload |
| **t19 = 5 AutoReload** | 1 | [1] | **no self-reload** |

**Result: AutoReload does not trigger on an empty or near-empty magazine state.**

**This does NOT close K1(b).** It rules out one of the two plausible semantics. AutoReload may still be
**fire-triggered** — reloading when the trigger is pulled on an empty chamber — which needs a real
trigger and therefore an operator. What it does is halve the bench test: the operator no longer has to
check whether the gun reloads on its own while idle, only whether it reloads **when pulled dry**.

**Token indexing note** (this is where the trap was): the documented `$WEAP` token numbers are indexed
on the **frame tail**, i.e. doc `t1` is the field *after* the slot — so doc **t19 is the 20th token**
of the frame. Verified against `gameconfig.py`'s `WEAPON_TAILS`: doc `t19` reads **0** on the AR,
matching "Shotgun 2 = Shells, Melee 10, everything else 0". Counting from `$WEAP` directly lands on
`1400` and would have written the wrong field.

**Standing recommendation unchanged:** `alt_reload` already ships, is proven, and is a per-tagger
toggle — it remains the answer for kid-mode today. t19=5 would be *fully automatic* rather than a
button, which is a different feature, and Tony should pick by feel rather than by which we can build.


### 2026-08-29 — RIG DOWN: screamer reproduced at ~3 days powered (ally re-measure blocked)

Attempted the **ceiling re-measure** (ally functions 9, 10, 11, 15, 31, 32, 34 applied to **depleted**
pools, with fn 10 and fn 11 as known-grant positive controls). It did not run: BLE dropped mid-arm with
`BleakError: Not connected`, and the retry now fails during **service discovery**
(`asyncio.CancelledError` inside `get_characteristics_async`).

**This is the documented "screamer"**: the gun still **advertises** (`rssi -75`, was -70) but cannot
complete a connection. `docs/gotchas.md` records the cause as a tagger left powered too long, and the
fix as a **power rest**. This victim has been powered continuously since **2026-08-26**, roughly three
days, which is the longest we have run one.

**Two observations worth keeping:**
- **A headset is now advertising on its own** (`BC-HEADSET-F2E7`), which it was not earlier in the
  session. Per `gotchas.md` a gun whose headset has dropped silently refuses to join a game, so this
  may be the same fault seen from the other end rather than a second one.
- **RSSI degraded** from -70 to -75 across the session without anything moving.

**Blocked until a power cycle, which needs an operator.** The ally re-measure is otherwise a pure
keyboard test and should be the first thing run when the rig is back, because it decides whether ally
9, 15, 31, 32 and 34 are status functions at all or just grants that were clamped. **fn 10 is already
known to be a grant, so it is the positive control: if the re-measure does not show fn 10 healing, the
method is wrong, not the functions.**


### 2026-09-02 — ⚠️ RETRACTION: the gun LEDs DO hold a colour in a live game. F1 is buildable.

**This reverses the conclusion I published two hours earlier in "WHAT WE CAN ACTUALLY SHIP".** That
entry said a spawned gun ALTERNATES between our colour and the team colour, that re-asserting does not
win, and therefore that a sustained gun display is not available and F1's three-segment gauge is not
buildable. **All of that is wrong.**

## What actually happens, measured at 60 fps instead of ~1 Hz

| we set | mean luminance | ripple | which hue dominates each frame |
|---|---|---|---|
| nothing (native only) | 65 | 22 | — |
| **WHITE** | 317 | 40 | **B 100%** |
| **RED** | 227 | 32 | **R 100%** |
| **GREEN** | 224 | 61 | **G 100%** |

**Our colour is the dominant hue in 100% of frames.** The native animation modulates its BRIGHTNESS by
10-25% and does not replace the hue at all.

## Why I got it wrong, and it is the same mistake twice in one day

The earlier test sampled with `screencap` at roughly 1 Hz and classified each still. Against a signal
that is our colour with a brightness ripple on top, that aliases: some stills land in a trough, the
classifier calls them "blue", and the sequence reads as alternation. **It was under-sampling, not
alternation.** This is the same failure that wrecked the first effect sweep earlier the same day
(a still frame samples one arbitrary phase of a time-varying signal), and I did not carry the lesson
across from one to the other.

The rule this needs to leave behind: **anything on a SPAWNED gun is a time-varying signal, because the
gun is always animating. Never characterise it with stills.**

## Brightness: full only

| setting | mean | our hue dominance |
|---|---|---|
| full (`t4=0`) | 219-389 | **100%** |
| dim (`t4=5`) | 65-67 | **lost** — native shows through at 76% |

So brightness IS controllable in game (a 5.8x range, 389 -> 67) but the dim state is not usable for
encoding anything: our colour stops dominating. **Use full brightness and encode with COLOUR.**

## The corrected capability map

| want | verdict |
|---|---|
| **3-segment pool gauge on the gun** | ✅ **BUILDABLE** — per-LED colour, holds at full brightness |
| sustained gun colour (flag held, powerup) | ✅ works |
| white flash on hit / pickup / kill | ✅ works |
| sustained headset colour | ✅ works (re-send after `$SPAWN`) |
| brightness as an encoding | ❌ dim loses the hue |

**F1 is buildable after all**, as a per-LED colour gauge at full brightness. The native pulse remains
underneath as a brightness ripple, which reads as the gun "breathing" in whatever colour we set,
rather than as interference.

Caveats that stand: `$SPAWN` wipes what we set, so paint after spawning; and the headset's native hit
flash returns it to DARK, so a held headset colour must be re-asserted on `$HIR`.

### 2026-09-02 — the last three LED unknowns, closed

All against BLACK (exposure down until only the LEDs are visible), absolute luminance, no reference
frame, three trials per value reported individually rather than averaged.

## 1. `$GLED` tokens 6 and 7 are INERT

Baseline `$GLED,3,3,3,0,10` with both empty reads lum 53-62. Every variant lands in the same band:

| variant | lum |
|---|---|
| both empty (baseline) | 53.2 / 62.5 / 60.3 |
| t6 = 0, 1, 50, 255 | 57.5 - 69.1 across all |
| t7 = 0, 1, 50, 255 | 57.4 - 70.6 across all |
| t6 = 1 **and** t7 = 1 | 65.6 / 63.5 / 71.1 |

Colour never changed (green throughout). **Nothing in tokens 6 or 7 does anything we can see**, over
their full 0-255 range, alone or together. `$GLED` is therefore a **five-token** command in practice.

## 2. The two brightness controls do NOT compose — token 4 dominates

|  | t5 = 1 | t5 = 2 | t5 = 10 |
|---|---|---|---|
| **t4 = 0** | 47.5 | 50.1 | **64.6** |
| **t4 = 5** | 20.9 | 20.2 | 15.4 |

`t4 = 5` pins the output to ~15-21 **regardless of token 5**, about 40% of the t4=0 level (consistent
with the ~1/3 measured earlier by a different method). Token 5 still varies the output at t4=0, so it
is not dead — but once t4=5 is set, token 5 stops mattering.

⚠️ **Honest discrepancy, not resolved.** The earlier token-5 measurement (a different exposure, delta
against a reference) put the step between **1 and 2** (172/181/184 vs 267/254/247, 3x alternating, no
overlap). This run puts 1 and 2 together and the step between **2 and 10**. Both were internally
consistent. So the *shape* of token 5's curve is NOT reliably established; what survives both runs is
only **0 = off, higher = brighter**. Recording that rather than picking the run I like better.

## 3. `$HLED` token 5 is an ENABLE, not a brightness

Solid mode (t2=0) to isolate it from blink behaviour:

| t5 | 0 | 1 | 2 | 5 | 10 | 50 | 100 | 255 |
|---|---|---|---|---|---|---|---|---|
| lum | 58* | 64-70 | 68-75 | 64-73 | 72-75 | 66-75 | 73-76 | 73-76 |

*t5=0 reads 58 with an unstable hue — that is the headset OFF, with the box picking up ambient.

**Every non-zero value lands in the same overlapping 64-76 band.** So token 5 gates the frame on and
off and does not set a level, which matches the earlier by-eye result that 10 and 100 were
indistinguishable. The one place it visibly mattered was the *trailing* flashes of a blink at 255, so
if it shapes anything it is the animation envelope, not steady brightness.

## Where `$GLED` and `$HLED` now stand

```
$GLED,<led1>,<led2>,<led3>,<apply-gate>,<brightness>,,*     tokens 6,7 inert
$HLED,<colour>,<effect>,<on_ms>,<off_ms>,<enable>,<count>,*
```

Everything in both commands is now measured except the exact shape of `$GLED` token 5's curve.

### 2026-09-02 — ⭐ WHAT WE CAN ACTUALLY SHIP: the gun LEDs cannot hold a colour in a game, the headset can

Everything else measured today was on an **unspawned** gun, because a spawned one runs its own
animation on the same LEDs. That is fine for decoding a command and useless for deciding whether a
feature is possible. This tests the thing a mode actually needs: does our paint SURVIVE, mid-match?
Sampled repeatedly rather than once, because the failure mode is "works for a moment and is then
repainted", which a single reading cannot tell from success.

## The gun's three LEDs: transient only

| state | result |
|---|---|
| UNSPAWNED, we set green | **HELD**, stable over 9.3 s |
| SPAWNED, our green | **wiped** — the gun shows its own team blue |
| SPAWNED, we set red | **alternates** blue <-> red |
| SPAWNED, we set white | **alternates** blue <-> white |
| SPAWNED, red re-sent before every sample (~1 Hz) | **still alternates** |

**Re-asserting does not win.** So a sustained display on the gun (a pool gauge, a flag-holder colour)
would flicker against the team colour. This is the same wall F1 hit, now quantified.

## The headset: a colour HOLDS

| state | result |
|---|---|
| UNSPAWNED, headset set | HELD |
| SPAWNED | disturbed — flickering/fading as the spawn runs |
| **SPAWNED, colour re-sent once after the spawn** | **HELD, stable over 8.4 s** |
| SPAWNED, `t2=2` blink running | blinking, as programmed |

The headset is natively **dark** during play, so nothing competes for it. **Re-send once after
`$SPAWN` and it stays.**

## The capability map this gives us

| want | surface | verdict |
|---|---|---|
| sustained state (flag held, powerup active, low health) | **headset** | ✅ one colour, re-send after spawn |
| flash on hit, pickup, kill | either | ✅ transient, alternation irrelevant |
| 3-segment pool gauge | gun LEDs | ⚠️ flickers against the native animation |
| sustained colour on the gun | gun LEDs | ❌ alternates; re-asserting loses |

**⚠ The caveat that will bite in a match, not on a bench.** The native hit flash returns the headset
to **DARK, not to the previous colour** (measured earlier today). So a held headset colour dies on
that player's FIRST HIT. The host must re-assert it on `$HIR`. That is one BLE write per hit and it
is cheap, but it has to be designed in: without it the feature works perfectly in testing and
silently degrades the moment someone is shot.

**Decode note:** the headset renders palette index 4 as blue-ish where the gun renders it purple, as
its own palette sweep showed. The two devices share indices 0-7 but not their exact rendering.

### 2026-09-02 — ⭐ `$HLED` has TWO blinks, and the timing tokens are confirmed to the millisecond

## The instrument fault that hid this, and the fix

The first `$HLED` effect sweep found **nothing** — every value read static. That was wrong, and the
reason is worth keeping: `screenrecord` takes **1-2 s to start**, and Callsign's count of 5 flashes at
300 ms on/off is over in ~3 s. The recorder was still spinning up while the effect played out. The
positive control had worked only because a spawned gun's native pulse is **continuous**.

**Fix: drive the effect with count = 200 so it outlives the recorder's start-up.** The signal has to
still be running when the instrument starts looking.

## t2 = 2 is a full-brightness repeating BLINK, and tokens 3/4 are on/off milliseconds

| on, off | predicted period | measured |
|---|---|---|
| 150, 150 | 0.30 s | **0.30 s** (3.39 Hz) |
| 300, 300 | 0.60 s | **0.59 s** (1.69 Hz) |
| 500, 500 | 1.00 s | **0.98 s** (1.02 Hz) |

Duty ~50% in every case, exactly as programmed. Period = `(t3 + t4)` ms and duty = `t3/(t3+t4)`.
This is a **joint confirmation**: it pins t2=2 as the blink effect AND independently confirms tokens
3 and 4 are on/off milliseconds, which had only been shown by eye ("300,300 is visibly slower than
90,90").

## There are TWO blinks, and they differ in brightness

At identical timing (`300,300`, count 200):

| effect | measurement |
|---|---|
| **t2 = 2** | BLINK, swing **231** on mean 208 |
| **t2 = 4** | STATIC lit, sd 17.8 |

t2=4 is Callsign's alert effect, and this is the camera confirming what Tony saw by eye: **it flashes
BRIGHT ONCE and then dim.** A recorder that starts late misses the single bright flash and sees only
the low-amplitude tail, which is why it reads static.

**Product consequence:** `t2 = 2` is a native full-brightness repeating flash at any rate we choose.
Tony asked earlier whether the LEDs could be flashed bright throughout; the answer we gave then was to
drive solid/blank from the host at 2 BLE writes per flash. **That is no longer necessary** — one frame
does it, on the gun, at an exact period.

Noise floor for reference: static states measure swing 21-83; the validated positive control measures
~494. The 231 here is unambiguous.

### 2026-09-02 — `$HLED` does NOT address the headset modules individually

The headset has **four LEDs** (operator-confirmed; three are in the camera's view, the fourth faces
away). `$GLED` puts a separate palette index in each of tokens 1-3, one per gun LED, so the obvious
question was whether `$HLED` does the same. The token map derived from Callsign's captures says no,
but Callsign never had a reason to light them separately, and absence from a capture is not evidence
of absence.

**Answer: no. Token 1 is a single GLOBAL colour.** Every pattern put the same colour on all three
visible modules:

| frame | HS_L | HS_C | HS_R |
|---|---|---|---|
| `$HLED,0,0,,,10,,*` (control) | 1.00/0.04/0.24 | 1.00/0.11/0.31 | 1.00/0.02/0.19 |
| `$HLED,3,0,,,10,,*` (control) | 0.08/1.00/0.42 | 0.12/1.00/0.49 | 0.05/1.00/0.33 |
| `$HLED,0,3,1,,10,,*` | 1.00/0.92/0.92 | 0.90/0.98/1.00 | 1.00/0.73/0.88 |
| `$HLED,0,3,1,6,10,,*` | 1.00/0.73/0.95 | 0.90/0.71/1.00 | 1.00/0.57/0.95 |
| `$HLED,2,4,5,7,10,,*` | 1.00/0.68/0.75 | 1.00/0.72/0.83 | 1.00/0.60/0.80 |

The two controls behave exactly as expected (all red, then all green), so the rig was reading
correctly. The three multi-token frames put an identical mixed/whitish colour on all three modules
rather than three different colours: **tokens 2+ are not per-LED colour.** They do change the output
globally, which is consistent with the effect/timing roles already measured.

**Consequence for the product:** a per-module headset display (direction-of-fire, a segmented pool
gauge on the head) is NOT available over `$HLED`. The headset is one lamp with one colour. The gun's
three LEDs remain the only per-segment display we can drive.

### 2026-09-02 (later still) — `$GLED` token 4 is an APPLY GATE, not an effect enum

Measured against a BLACK background (camera exposure dropped until only the LEDs are visible), gun
armed but not spawned, three trials per value, with the setup state VERIFIED before each trial.

## The test that finally separated the cases

From a DARK start, "does nothing" and "turns off" are indistinguishable, which is why four earlier
sweeps could only ever split token 4 into two groups and then disagreed about which group was which.
The discriminator is to start from a KNOWN LIT colour and send a DIFFERENT one:

  goes RED    -> the frame APPLIED its colour tokens
  stays GREEN -> NO-OP: colour tokens ignored, previous state kept
  goes DARK   -> the frame turned the LEDs OFF

| t4 | outcome (3 trials, verified green pre-state) |
|---|---|
| 0, 6, 7, 8, 9, 10 | **APPLY** the colour tokens, full brightness |
| **5** | **APPLY at ~1/3 BRIGHTNESS** (see below) |
| 1, 2, 3, 4 | **NO-OP** — colour tokens ignored, previous state kept |

**t4 = 5 is a DIM apply, and that is why stills disagreed about it.** It first read
"inconsistent" (RED, RED, DARK) because a dim LED sits right on the classifier's dark threshold.
Video ruled out animation (swing 24-26, against ~494 for the validated positive control) but showed
a mean of ~56 where t4=0 gives ~200. Alternating the two directly, same colour, same trial:

| trial | t4=0 (LED1/LED3) | t4=5 (LED1/LED3) | ratio |
|---|---|---|---|
| 1 | 61.9 / 120.5 | 18.0 / 49.7 | 0.29 / 0.41 |
| 2 | 64.5 / 122.6 | 19.6 / 54.5 | 0.30 / 0.44 |
| 3 | 64.0 / 121.8 | 21.1 / 54.0 | 0.33 / 0.44 |

Both LEDs, three trials, no overlap: **t4=5 is the same colour at roughly a third of the brightness.**
So token 4 carries brightness information as well as the apply gate, and `$GLED` has TWO independent
brightness controls — token 5 (off / dim / full, measured earlier) and this.

## What this reframes

**There may be no dedicated "off" value at all.** `$GLED,,,,5,,,*` blanks because its colour tokens
are **EMPTY** and it applies them, not because 5 means off. The same explains the earlier A/B in which
`$GLED,,,,6,,,*` and `$GLED,,,,7,,,*` also blanked a lit gun while `$GLED,,,,3,,,*` did not: 6 and 7
apply (empty -> dark), and 3 is a NO-OP so the red it was showing simply stayed.

Every contradictory reading of this token today is explained by one thing: **a NO-OP leaves the
previous row's colour lit.** A sweep that does not blank between rows therefore reports "everything
is lit", and a sweep that does blank reports "nothing is lit" — from the same hardware.

**The shipped frame was always right, and still is.** `gameconfig._led_frames` sends Callsign's
`$GLED,,,,5,,,*` and it does blank the gun. Only our EXPLANATION of why was wrong.

## Token 4 is CLOSED

All eleven values resolved, three trials each, verified pre-state: 0/6/7/8/9/10 apply at full
brightness, 5 applies dim, 1-4 are no-ops. **No value animates** — trustworthy because the positive
control (a spawned gun's native pulse) gives swing ~494 against 24-70 for every static state here.

## Token 5 is a THREE-STATE brightness (same session)

`0 = off · 1 = dim (~70%) · >=2 = full`. It **saturates by 2** — 2 through 255 are indistinguishable.
Measured 3x alternating, no overlap between the two populations:

| trial | t5 = 1 | t5 = 2 |
|---|---|---|
| 1 | 172 | 267 |
| 2 | 181 | 254 |
| 3 | 184 | 247 |

So the token map to state is `$GLED,<led1>,<led2>,<led3>,<apply-gate>,<brightness>,,*`.

Left for a future session: **why two brightness controls?** Token 5 gives off/dim/full and token 4=5
gives a dim apply. ✅ **ANSWERED later the same session** (see "the last three LED unknowns, closed"):
they do **not** compose — `t4=5` pins the output to ~15-21 regardless of token 5. That entry also
downgrades token 5's curve: two internally-consistent runs disagree about where its step is, so only
**0 = off, higher = brighter** survives both.

## Method note worth keeping

The run before this one produced four VOID rows (`pre=DARK`) and still printed verdicts for them.
Verifying the setup state before measuring, and retrying it, is not optional on this rig: the gun
does not always accept a frame, and a trial that starts from the wrong state measures nothing while
looking exactly like a result.

### 2026-09-02 (later) — ⭐ THE FULL LED PALETTE, MEASURED: indices 7 and 8 finally read off a gun

Camera rig at **2x zoom** (the change that made it work), gun **armed but NOT spawned**, every reading
referenced against a verified-blank frame with a CONTROL patch as the ambient canary.

## `$GLED` tokens 1-3 — the palette is 0-8, and 7/8 are now measured

Normalised channel signatures, and **all three gun LEDs agreed on every row** (the internal
consistency check that says the measurement is real, not an artefact):

| idx | signature R/G/B | colour |
|---|---|---|
| 0 | 1.00 / 0.16 / 0.26 | **red** |
| 1 | 0.19 / 0.59 / 1.00 | **blue** |
| 2 | 0.88 / 1.00 / 0.59 | **yellow** |
| 3 | 0.18 / 1.00 / 0.54 | **green** |
| 4 | 0.59 / 0.49 / 1.00 | **purple** |
| 5 | 0.23 / 1.00 / 0.85 | **teal** (cleanly apart from green: B 0.85 vs 0.54) |
| 6 | 0.73 / 0.79 / 1.00 | **white** (most balanced; still blue-cast by AWB) |
| **7** | **1.00 / 0.30 / 0.66** | **PINK/magenta** — R max, B high, G low |
| **8** | **1.00 / 0.38 / 0.30** | **ORANGE** — R max, G above B (vs 0, where G ~ B) |
| 9, 10 | dark | out of range |

*(Signatures re-measured after Tony lowered the camera exposure, which materially improved channel
separation: red went G 0.46 -> 0.16, and teal/green separated from 0.83/0.73 to 0.85/0.54. It did NOT
fix the blue cast on white, because that is white balance, not saturation.)*

**Indices 7 and 8 had never been read off a gun** (`manual/06-developer.md` research backlog). They
are exactly what the community lead claimed: **7 pink, 8 orange**. That backlog item is closed, and
the palette is **nine colours, 0-8**, with 9+ dark.

## `$GLED` token 4 — only 5 does anything

> ⚠️ **SUPERSEDED the same day** — see *"`$GLED` token 4 is an APPLY GATE, not an effect enum"* above.
> This sweep ran from a DARK start, which cannot separate "applies a colour" from "does nothing", and
> its t4=5 row read dark only because **t4=5 is a DIM apply** sitting on the still classifier's dark
> threshold. What actually holds: token 4 is an **apply gate** (0/6/7/8/9/10 apply at full brightness,
> 5 applies at ~1/3, 1/2/3/4 are no-ops), and `$GLED,,,,5,,,*` blanks because its colour tokens are
> **empty**, not because 5 means "off". The rows below are kept for provenance.

Colour held at green, token 4 swept 0-10: **every value renders solid green except t4 = 5, which is
dark.** 0, 1, 2, 3, 4, 6, 7, 8, 9, 10 are all indistinguishable.

⚠️ **This contradicts our own docs.** `brx-protocol.md` and `manual/06-developer.md` say **"token 4 = 3
blanks all three"**. It does not: `$GLED,3,3,3,3,10` is lit green. Confirmed twice by different
methods -- an A/B from a lit state earlier the same day showed red staying red through
`$GLED,,,,3,,,*` ([91,29,36] -> [94,35,50]) while t4=5 dropped to ambient.
**The shipped night-mode frame is Callsign's `$GLED,,,,5,,,*`, so the product was never affected --
only the documented value is wrong.**

## `$HLED` token 1 — same palette, one divergence at 8

All three visible headset modules agreed: 0 red, 1 blue, 2 yellow, 3 green, 4 purple, 5 teal,
6 white, 7 pink, **8 reads as plain RED on the headset** ([1.00,0.08,0.08]) where the gun renders it
orange. 9 and 10 dark. So the two devices share the palette for 0-7 and differ at 8.

## What the rig can and cannot do (recorded so nobody over-trusts it)

**Reliable:** presence/absence, timing, counts, and *relative* comparison within a frame. The pulse
was measured at **1.77 s (0.56 Hz)**, two cycles agreeing to 0.01 s.

**NOT reliable: absolute hue naming.** The phone's auto white balance compensates against a warm
room, so a white LED measures blue-violet ([62,77,118]). The palette table above survives that only
because every index has a *distinct* signature and they were compared against each other in identical
conditions -- not because the camera names colours correctly.

**Single frames CANNOT characterise the effect enum.** The `$HLED` token-2 sweep produced
phase-dependent nonsense: one screencap of a blinking LED catches whichever phase it lands in, so
t2=2 read "dark" and 4-10 read assorted hues. Worse, a bright headset flash **illuminates the gun**,
so the gun ROIs lit up while the gun was blanked. **The effect enum needs video** (`ledcam.py pulse`),
which is exactly what that subcommand exists for. Tony's by-ear/by-eye reading from earlier the same
day (0 solid, 1/2 pulse, 3 solid, 4 blink, 5-8 dark) stands; the single-frame sweep does not overturn
it and must not be read as if it did.

## Rig traps found today, all now handled in the tools

- **2x zoom was the unlock.** At 1x the LEDs were too small and oblique to separate.
- **A blank that does not blank poisons everything.** Two entire palette sweeps were garbage before
  this was found -- one called a known-blue index "dark".
- **Per-row re-blanking is worse than one good reference.** The reference kept capturing the previous
  row's colour. One verified-blank reference + a CONTROL canary is the stable design.
- **The phone sleeps, locks and rotates**, silently invalidating every pixel ROI. `screen_off_timeout`
  is now maxed, a background poker runs every 3 minutes, and the harness hard-aborts on a portrait
  frame rather than carrying on.
- **The control patch must be where NEITHER device can throw light** -- carpet near the gun is lit by
  the gun and reports our own experiment as ambient drift. Worse, one control ROI sat in the phone's
  black LETTERBOX, outside the camera preview entirely: it read "dark" forever and gave false
  reassurance on every row it appeared in.
- **The camera re-meters EVERY frame** -- both auto-exposure and auto-white-balance. Lighting the LEDs
  makes it stop down, so static surfaces darken (a wall [42,44,48] -> [8,9,15], carpet
  [88,76,81] -> [48,55,56]). So `lit - dark_reference` compares two different cameras. Google Camera
  offers no AE/AF lock.
- **Per-frame renormalisation against a static grey patch is the right fix and is IMPLEMENTED, but it
  is OFF.** It needs a neutral patch NO LED can reach, and this scene has none: with the patch on
  carpet, an all-blue row turned the patch blue, and dividing by it reported blue as GREEN. Enabling
  it without a spill-free patch is worse than leaving it off. Add a `GREY` roi only when there is a
  genuinely shadowed neutral surface in frame.

### 2026-09-02 — ⭐ `$HLED` DECODED, the headset state model, and F1 answered NO (Tony + rig + phone camera)

Bench: gun **R0BQT**, ESP32 board B (COM8) emitting, later a Pixel on wireless adb watching the LEDs.

## 1. `$HLED` is fully decoded

`$HLED,<colour>,<effect>,<on_ms>,<off_ms>,<t5>,<count>,*`

| token | meaning | evidence |
|---|---|---|
| 1 | **colour**, same palette as `$GLED` | swept by eye: 1 blue, 2 yellow, 3 green, 4 dark purple, 7 brighter purple |
| 2 | **effect** | 0 solid · 1,2 pulse/breathe · 3 solid · 4 blink · **5,6,7,8 dark** |
| 3 / 4 | **on / off milliseconds** | `300,300` visibly slower than `90,90` |
| 5 | **enable / envelope only** | 0 = dark; **10 and 100 are indistinguishable**; 255 changed the trailing flashes to a decay ramp |
| 6 | **flash count** | 3 → 3 flashes, 5 → 5, 15 → ~15. Three points |

**The first flash is always bright and the remainder dim** — firmware, not ours. No effect value gives
all-bright blinking. To flash bright throughout, drive it from the host: alternate
`$HLED,<c>,0,,,10,,*` and `$HLED,,6,,,,,*` (proven at 6 flashes, "max bright").

⚠️ **This kills the open question in `compile.py`** ("we do NOT know token 5 is brightness… the likeliest
alternative is a REPEAT COUNT, in which case 100 would turn a 1.8 s alert into ~18 s"). **Token 5 is
neither.** At 100 the alert did **not** lengthen. The duration knob is **token 6**. The fear was
reasonable and the caution was right; the answer is simply different.

**`$HLED` drives the HEADSET only** — the gun never followed it. Clean split from `$GLED`.

**Token 1 is a real colour index, measured not inferred.** It was previously guarded to values 0/1
(`_HLED_SEEN_COLOURS`) because no capture linked it to a team. **2 → yellow and 3 → green**, values in
no capture at all and exactly our tids. The guard can come off.

**Placement/pairing worries are moot:** a bare `$HLED` on an idle gun lights the headset. No `$GLED`
pairing needed, no lobby placement needed.

## 2. The native headset state model (all in-play states are AUTONOMOUS)

| state | headset | driven by |
|---|---|---|
| pre-game team assign | team colour | **host** (`$HLED`) |
| normal play | dark | — |
| on hit | **one green flash → back to dark** | firmware |
| out / dead | **sustained bright green blink** | firmware |
| respawn | stops, dark | firmware |
| disconnected from gun | rainbow | firmware |

**F10 resolves, and `docs/manual/`'s ✅ is EARNED.** The per-hit green flash fires with **no host frame
at all** — proven by blanking the headset (`$HLED,,6`) and shooting it: one green flash from dark, back
to dark. My first reading, from a *lit* headset, was that the flash needed the lit state; **that was
wrong**, and Tony's native-play knowledge corrected it: in native games the headset is dark in play and
only lights pre-game, on hit, when out, and rainbow when disconnected.

So our dark headsets were never a missing hit flash. **The only thing we were missing is the pre-game
team assignment.**

⚠️ **Consequence for the shipped head:** the flash returns to **dark**, not to the previous colour. We
send `$HLED` *after* `$START`, so a headset holds team colour into play and then goes dark on that
player's first hit — drifting out of sync player by player. Callsign sends it in the **lobby**, before
`$CLEAR`/`$START`, which avoids this entirely. Worth moving.

## 3. F1 — the native health gauge does NOT appear in our compiled games

Armed and spawned from our own frames on `$TID,1`: three gun LEDs pulsing blue. Damaged to
**armour 0, HP 15/45** — still **three** LEDs pulsing, no change at any point.

**The 2026-08-30 conclusion does not transfer.** "The pulse IS the health gauge" was observed in a
**native FFA** and is true there; in *our* games the same pulse is only team colour. F1 is therefore a
**config hunt** (`$GSET`/`$PSET` diff against a native game), not a deletion and not an LED driver.

Measured, so "slow pulse" is no longer an impression: **period 1.77 s (0.56 Hz)**, two consecutive
cycles agreeing to 0.01 s, smooth breathing ramp.

Other LED states seen: **armed-but-not-spawned = LEDs OFF** (bench item 4.4); death = still the slow
pulse (no distinct death flash on the GUN); grants and status functions = no LED change.

## 4. Bench item 1.5a — ally functions, with the ceiling artifact removed

| fn | result |
|---|---|
| **11** | **shield +100** — positive control passes, and confirms P16 (shield is IR-only) |
| **9** | hp +20 **and** armour +70 (a full restore) |
| **15** | armour +70 only |
| **31, 32, 34** | land, move **no pool even with headroom** → genuine status functions |

So 31/32/34 are **not** clamped grants. The stun shortlist survives.

⚠️ **The first run of `ally_remeasure.py` was VOID and its own positive control caught it** — every row
read `0/0/0`. My script depleted with 6×30 = 180 damage assuming the `$PSET` shield 150 absorbs first.
**It does not** (P16), so the real pool is 115 and the deplete simply killed the victim; a dead gun
takes no IR. Fixed to 3×30 = 90, plus a guard that voids a row rather than reporting a verdict off a
dead gun, plus a spawn-verify loop (the `$SPAWN` between rows was not restoring pools, so runs
inherited the previous row's damage).

## 5. Free results from the same rig

- **Bench 0.3 (does the struck sensor change the applied function?)** — the rig produced **both**
  `$HIR` tok1 = **0** (headset dome) and **4** (gun body) from the identical word, and **both applied
  exactly 20**. Evidence the sensor does not change the applied function, at least for fn 1. Earlier
  runs only ever managed tok1 = 4.
- **Armour spill confirmed at face value:** a 20 into armour 10 left armour 0 and took HP 45 → 35.

## 6. Method: the camera rig (`mcp/tools/ledcam.py`, `ledsweep.py`)

The recurring failure of every LED session is that a **machine sends** and a **human watches**, and the
two are not synchronised — that is what cost 2026-08-30. A phone on wireless adb, camera app open,
aimed at the gun and headset, makes the LED state **measurable**: colours become RGB, "slow pulse"
becomes 1.77 s, "fast flash" becomes a count. `ledsweep.py` drives BLE **and** reads the camera in one
process, so a reading cannot be attributed to the wrong frame and exhaustive sweeps are cheap.

Traps found while building it, all handled in the tools:
- **The LED cores blow out to white** under the phone's auto-exposure; the hue lives in the **halo**.
- **Adjacent gun LEDs bleed** into each other.
- **The office Hue lamp cycles a rainbow**, so ambient colour drifts and a single reference goes stale
  → every reading is `(frame − its own blanked reference)` captured ~1 s apart, plus a **CONTROL ROI**
  on bare carpet as a drift canary.
- **The phone sleeps and rotates**, invalidating pixel ROIs (`screen_off_timeout` + `svc power stayon`).
- Windows adb is **not paired** (the key is WSL's), so the Windows BLE process borrows WSL's adb and
  writes the PNG to a file rather than piping binary through `wsl.exe`.

Per-LED calibration is proven: `$GLED,0,3,1` read back as **red, green, blue** on the three individual
LED ROIs, and `$HLED,0` read back **red** on the headset ROI.

### 2026-08-31 — MEASURING THE DOCS: three cold-read handoff tests, 5 → 7 → 8/10

**No hardware. The instrument was a fresh agent with no context**, given only "you are taking over this
project cold, continue the bench work", told to start at `CLAUDE.md` and report where it got lost. Run
three times with the fixes in between. Its confusion is the measurement.

**The single failure mode, found in all three rounds, never a wrong fact:** a *right* fact that only
landed in one or two files. `$GLED` was solved on the bench on 08-30 and written into the protocol doc
and the manual — while the **spec of record** still published the disproven `mid,effect,optionA,optionB`
field map, `unknowns.md` still listed it open, two bench plans still queued the closed test, and
`gameconfig.py` still **shipped** a frame built on the retracted "index 0 = off" reading. Index 0 is
**red**, so night mode had been sending red LEDs while believing it meant "off".

**Round 3 found the same shape in code, in a different question.** `mc/compile.py` still had **fn 3** in
`_SIR_NO_POOL` and missing from `_SIR_PLAIN_DAMAGE`, two days after fn 3 was re-measured as ordinary
damage (the floor artifact below — it only looked inert because the sweep ran at shield 0). A weapon
keyed to fn 3 therefore got a compile-time warning saying **"the weapon DEALS NO DAMAGE"**. Nobody would
have caught that at the bench; they would have believed it and changed the weapon. The same file also
stated the **then-disputed** fn 36/37 multipliers as fact in three places, one of them calling them
"both bench-proven 2026-08-26". *(Footnote 2026-09-02: the multipliers turned out to be real — fn 36 =
floor(magnitude x 1.25), fn 37 = magnitude x 2 — so those three places were right by luck. The defect
stands as a defect: the file asserted as settled something the repo was actively disputing.)*

**What the three rounds actually cost to fix:** nothing was re-measured. Every fix was propagation.

**Method notes worth keeping**

- **The tests disagreed with my own confidence, and they were right both times.** After round 1 I
  believed the docs were in good shape; after round 2 I believed the sweep was complete. Round 3 found
  a shipping bug.
- **Ask the cold agent to *walk* an item, not review it.** Round 2's most useful output was "I cannot
  run 1.5a" — the script that runs it existed only on the Windows box, one of **~107** one-shot probes
  there against **12** in `mcp/tools/`. That is now `mcp/tools/ally_remeasure.py`.
- **A wrong command survives a review but not a walk.** My own round-2 verb table invented
  `python -m brx_mcp reset <addr>`. There is no such verb. It was written from memory of what the CLI
  *should* have and never run.
- **Tell it not to read the log end to end.** All three rounds followed the header's "grep for evidence,
  never orient from it" and all three reported it worked.

**The durable output** is not the fixes: it is the rule in `gotchas.md` ("close a question in EVERY file
in the same commit, or it is not closed") and the greppable eight-place checklist in `docs/README.md`.
A stale answer is worse than an open question — an open question warns you, a stale answer recruits you.

### 2026-08-30 — ⭐ THE PULSE **IS** THE HEALTH GAUGE (native FFA, Tony observing)

**Tony, in a NATIVE FFA game:** *"two guns went blue. i shoot the other, the pulsing blue led represents
the health. now only the 3rd led is pulsing blue."*

**This inverts the whole F1 design.** The pulsing team-colour LEDs that I spent the afternoon trying to
**suppress** are the gun's **native health bar**: three LEDs pulsing at full health, dropping to one as
health falls. The "alternation" that was "washing out" my gauge was a working gauge underneath, and my
`$GLED` override was **destroying** it, not building one.

**What this means**

- The gun **already** renders a 3-segment health gauge in the team colour, natively, with no host
  involvement. That is exactly what F1 asked for.
- My `$GLED` per-LED control is still real and still useful (night mode, hit flash, per-player colour,
  FFA white) — but it is the wrong tool for *health*, because the gun does health itself.
- Everything I read as noise on a spawned gun was signal. **A spawned gun pulses because it is
  displaying pools.** That is why it only ever appeared when spawned, and why it never "settled".

**⭐ AND THE FULL F1 BEHAVIOUR ALREADY EXISTS NATIVELY.** Tony, on Supremacy: *"in supremacy, the
maurader health bar worked differently. it showed armor and then health and it would switch back to team
after being delt damage."*

That is **exactly the F1 spec** — pool status on damage, armour then health, auto-revert to team colour
— **implemented in stock firmware, with no host involvement.** Two consequences:

- **It is CLASS-DEPENDENT.** The Marauder behaves *differently from other classes*, so this is not one
  fixed gun behaviour: something in the class config selects it. **That field is what F1 actually
  needs**, not a `$GLED` loop.
- **The gun handles the revert timeout itself**, which is strictly better than driving it from the host:
  no BLE write per hit, no flicker, and no cost at 10 players. My `$GLED` approach would have been worse
  than what the hardware already does.

**Open, and decisive for F1:**

1. **Does the gauge refill** on heal/respawn (1 → 2 → 3)?
2. **Does it appear in OUR host-driven games**, or only in native ones? If `play tdm` shows it, F1 is
   already delivered and the override should be deleted. If it does not, the question becomes *what
   native does at setup that we do not* — likely a `$PSET`/`$GSET` field we leave unset.
3. Does it track **health only**, or armour/shield too? In FFA Tony read it as health; on the Supremacy
   Marauder it showed **armour then health**, so the answer is likely class-configured rather than fixed.
4. **Which field selects it?** The Marauder differs from other classes, so compare a Supremacy class
   config against ours. Look first at `$PSET` (the class/character block) and `$GSET`. This is the single
   highest-value question for F1 — it turns the feature from "write an LED driver" into "set one field".
5. **Does a native game touch BLE at all?** A native game runs on-gun, so the gauge may be entirely
   autonomous. If so there is nothing to capture and the answer must come from config diffing.

**Method note for me:** I had the answer in front of me twice — the earlier session's "3 gun LEDs are a
segmented gauge, purple draining with the pools" note, and every "pulsing" report today. I treated a
documented native behaviour as interference because I was committed to driving the LEDs myself.


### 2026-08-30 — ✅ `$GLED` SOLVED: three independently addressable LEDs, direct palette indices

Re-ran under a **synchronous** protocol after Tony identified the defect in my method (*"i type what i
see, but bc you are thinking my response doesn't get interpretted right away"*). One frame sent, wait
for his call, then the next. No timers.

**Every earlier contradiction vanished immediately.**

| frame sent | LEDs |
|---|---|
| `$GLED,1,0,0,0,10` | **blue** / red / red |
| `$GLED,0,1,0,0,10` | red / **blue** / red |
| `$GLED,0,0,1,0,10` | red / red / **blue** |
| `$GLED,3,2,1,0,10` | **green / yellow / blue** — *predicted in advance, confirmed* |

## `$GLED,<led1>,<led2>,<led3>,<t4>,<brightness>,,*`

**Tokens 1-3 are the three gun body LEDs, each a direct palette index:**

**0 red · 1 blue · 2 yellow · 3 green · 4 purple · 5 teal/cyan · 6 white** (7-8 exist, unnamed)

> ⚠️ **CORRECTED 2026-09-02** (see the entries "THE FULL LED PALETTE, MEASURED" and "`$GLED` token 4 is
> an APPLY GATE" above): the palette is **nine colours, 0-8** — **7 = pink, 8 = orange**, measured on a
> gun — and **token 4 is an apply gate, not an effect enum and not an off switch**. The rest of this
> entry stands.

- ~~**`<t4>` = 3 blanks all three**~~ ❌ **WRONG, retracted 2026-09-02.** Token 4 gates whether the
  frame's colour tokens are applied: **0/6/7/8/9/10 apply at full brightness, 5 applies at ~1/3
  brightness, 1/2/3/4 are no-ops** that leave the previous colour lit (which is all `t4=3` was doing).
  The night-mode frame (P17) is the app's own `$GLED,,,,5,,,*`, and it blanks because **its colour
  tokens are empty and t4=5 applies them** — 5 is not an "off value", and there may be no off value.
- **`<brightness>`** is token 5: **0 off · 1 dim (~70%) · >=2 full** (saturates at 2).
- ⚠️ **`$SPAWN` is what makes the colours alternate.** A spawned gun runs its own **team-colour pulse**
  and `$GLED` is composited over it, so a gauge flickers between your colour and the team colour and is
  unreadable. **Arm WITHOUT `$SPAWN` (and without `$TID`) and the colours hold SOLID** — verified:
  `$GLED,3,2,1,0,10` after only `$CLEAR`/`$START`/`$VOL` gave a steady green / yellow / blue.
- **Open, and it matters for shipping:** a gun in a real match *is* spawned. Whether the team pulse
  continues during live play, or only in the pre-game/lobby state, is **untested**. The manual says the
  *headset* shows team colour pre-game only and goes dark during play; if the gun behaves the same, an
  in-game gauge will be solid. **Test before building a gauge into a mode.**

**A 3-segment health/armour gauge is now buildable:** `3,3,3` full → `3,3,0` → `3,0,0` → `0,0,0` empty,
in whatever colour suits the pool.

#### Why this took all day, and it was not the hardware

Every failed prediction and both contradictory token-3 tables came from **timed sweeps racing an
asynchronous human observer**. I logged observations against the wrong frames, then explained the mess
with two successive wrong theories — "LED 2 is not addressable" (it always was), then "the LEDs animate
so single glances are useless" (they don't, and glances are fine). **Tony diagnosed the real cause.**

The APK's field names (`mid, effect, optionA, optionB`) do **not** describe this command. That teardown
recovers identifiers in declaration order with no types, and it also asserts colour is team-derived,
which is false. **Where the APK and the bench disagree, the bench wins.**


### 2026-08-30 — ⚠️ RETRACTION + PLAN: most of the day's `$GLED` conclusions do not hold

A three-agent review (captures / APK / adversarial) went through the two `$GLED` entries below. **Most
of what they concluded is not supported.** Corrections first, then the plan that follows from them.

#### What is RETRACTED

| claim | status |
|---|---|
| "index 0 = off", night mode is `$GLED,0` | ❌ **WRONG. 0 = RED.** An earlier capture already recorded `$GLED,0,0,0,0,10,,*` as **red** (§7i table), and the community map reads 0 red · 1 blue · 2 yellow · 3 green · 4 purple · 5 cyan · 6 white. The "all dark" came from the **trailing tokens**, not the index. **Night mode must not ship on `$GLED,0`.** |
| token 3 has a per-value LED pattern | ❌ **The two tables below contradict each other on every row** (t3=1 → red in one, blue in the other, etc). The entry itself notes the LEDs were **animating**, so each reading is a caught phase. There is no repeatable per-value map. |
| token 4 is a 0/1 enable | ❌ **Enumerated, not boolean.** The Callsign app sends **`$GLED,,,,5,,,*`** on death — every field empty except token 4 = **5**. We only ever tried 0 and 1. |
| "LED 2 is not addressable" | ❌ **Unsupported.** It rests on ONE frame shape (t1=3, t2=0, t4=1, t5=2000, only t3 varied). **LED 2 showed red = palette index 0 = the default** — nothing in those frames ever addressed it. |
| token 1 = blue at n=1 | ⚠️ **Uncontrolled** — the gun was on `$TID,1`, which is already blue, so "blue" is indistinguishable from "no override". The community map supports it; our test does not. |
| the gun "flashes and reverts by itself" | ⚠️ **Inferred, not observed.** No TX log was checked, steps were ~10 s apart, and LED colour is known to be repainted at `$SPAWN`. |
| token 5 = brightness | ⚠️ **Plausible but uncontrolled** — the effect value during that sweep was not recorded. If effect was 1 (Glow), "dim to bright" could be a modulation *period*, not amplitude. |

#### What SURVIVES

- **Token 1 is a colour index and it OVERRIDES the team colour.** A gun held on `$TID,1` showed yellow,
  green, purple, teal and white on command. The old "colour is team-derived only" claim is genuinely
  disproven, and our indices 2-6 match the community map independently.
- **Token 2 is the effect** — a clean A/B at n=1, effect 0 vs 1, with modulation matching `LedEffect.Glow`.

#### ✅ TOKEN 4 SWEEP RESULT (2026-08-30, run on `$TID,2` = yellow so blue cannot be confused with no-override)

| token 4 | all three LEDs |
|---|---|
| 0 | static green · red · red |
| 1 | static green · red · red |
| 2 | static green · red · red |
| **3** | **ALL OFF / DARK** |

**`$GLED,<c>,0,0,3,10,,*` turns every LED off. That is the real night-mode frame (P17)** — and it is on
the axis the earlier "index 0 = off" claim got wrong. **LED 2 and 3 read RED while the team was YELLOW**,
which confirms red is the palette **default** (index 0), not the team colour showing through.

| 4, 5, 9 | *not reported* |
| 6 | static green · red · red (Tony: "maybe the green led is brighter? not sure" — recorded as **uncertain**, not a finding) |
| 7, 8 | static green · red · red |
| **app's `$GLED,,,,5,,,*`** | **ALL OFF / DARK** |

**Verdict: token 4 did NOT unlock the middle LED.** Two useful results, but not the one we were after:

1. ~~**`$GLED,<c>,0,0,3,10,,*` blanks every LED**~~ ❌ **RETRACTED 2026-09-02** — `t4=3` is a **no-op**:
   it ignores the frame's colour tokens and leaves whatever was already lit, which in that dark-start
   run looked like blanking. The night-mode frame is the app's `$GLED,,,,5,,,*` (item 2), which is what
   we ship.
2. **The app's `$GLED,,,,5,,,*` also blanks.** Note its **colour field is EMPTY**, so "no colour" may be
   what blanks it rather than token 4 = 5 specifically. Two candidate blanking mechanisms; not yet
   separated. ✅ **This guess was RIGHT — confirmed 2026-09-02.** Token 4 is an apply gate; t4=5 applies
   the colour tokens, and applying an **empty** colour is what turns the LEDs off.
3. **Red is confirmed as the palette DEFAULT**, not the team colour — the team was **yellow** throughout
   and no LED ever showed yellow.

**A/B CONFIRMED:** token 4 = 0 vs 7 alternated back-to-back, three rounds, 14 s each — Tony: *"no difference"*. So token 4 is **inert except for the off value**; the other values are not doing anything subtle we missed on a single pass. ⚠️ **Corrected 2026-09-02: token 4 is an APPLY GATE, and there is no "off value".** 0 and 7 look identical because **both apply** the colour tokens at full brightness — that A/B could not have separated them. With the colour tokens left EMPTY, 5, 6 and 7 all blank for the same reason: they apply an empty colour. The values that really are inert are **1, 2, 3 and 4**, which are no-ops.

**LED 2 never moved across all ten values** — but see the effect sweep below: **it was never token 4.
It was the EFFECT field.**

#### ✅ THE MIDDLE LED IS ADDRESSABLE — it is the EFFECT field (2026-08-30)

Swept `$GLED,3,<effect>,0,0,10,,*` on `$TID,2` (yellow team, green colour):

| effect | LED 1 | LED 2 | LED 3 |
|---|---|---|---|
| 0 Solid | green | red | red |
| 1 Glow | green | red | red |
| **2 ChaseBack** | green | **BLUE** | red |
| **3 ChaseForward** | green | **YELLOW** | red |

**The middle LED moves under the Chase effects and nothing else.** Every earlier "LED 2 is stuck red"
cell held **effect = 0**, so the conclusion that it was unaddressable was an artifact of never varying
the one field whose name (ChaseBack / ChaseForward) literally describes walking the strip. The
adversarial review predicted exactly this.

#### ✅ ALL THREE LEDs SET TO ONE COLOUR — `$GLED,3,4,4,0,10,,*` → **green / green / green**

The decisive cell. **Every LED lit the same colour on command**, which proves all three are writable
from a single frame and that LED 2 was never a hardware limitation.

**But the per-LED index mapping is NOT solved**, and four prediction attempts failed:

| frame | predicted | actual |
|---|---|---|
| `$GLED,1,3,5` | blue / yellow / green | **white / yellow / pink** |
| `$GLED,6,2,7` | white / blue / teal | **purple / pink / yellow** |
| `$GLED,4,7,2` | purple / white / blue | **green / purple / purple** |
| `$GLED,3,4,4` | green / green / green | **green / green / green** ✅ |

One hit in four. The single-value cells were self-consistent (t2 = 1..6 walked the palette exactly), but
**mixed-value frames do not decompose into three independent palette lookups**. Combined with the
repeated "alternating with the team colour" reports, the likeliest explanation is that a mixed frame
produces an **animated** state and a single glance samples one phase — the same trap that made the two
token-3 tables contradict each other.

⚠️ **THE ANIMATION EXPLANATION IS PROBABLY WRONG — it was a SYNCHRONISATION bug in my method.**
Tony: *"i type what i see, but bc you are thinking my response doesn't get interpretted right away."*

The sweeps advanced on a **timer** while his reports arrived **asynchronously**. So an observation I
logged against frame N may well describe frame N-1. **Every mismatch above is explainable as a one-step
misalignment**, with no animation required — and that also explains the two contradictory token-3
tables, which I had blamed on "caught phases".

**This invalidates my "eyeball sampling cannot work" conclusion too.** The eye is a fine instrument
here; the timer was the defect. I built a timed sweep and then read asynchronous replies as if they
were synchronous.

**Method rule for every future operator-in-the-loop sweep: NEVER advance on a timer.** Send one frame,
**wait for the operator's call**, then send the next. Slower per cell, but each datum is actually bound
to the frame that produced it. Re-run the mixed-value cases this way before concluding anything about
the per-LED mapping.

⚠️ **Both Chase cells were ALTERNATING with the team colour**, so this is an **animation cycling through
the palette**, not a static per-LED assignment. A health/armour gauge needs each segment **pinned**, so
the remaining question is whether a static per-segment write exists, or whether the gauge is itself
built from a chase-like effect. Next on the ranked plan: **effects 2/3/4**
(ChaseBack / ChaseForward / StopIR) — the two Chase effects are segment-walkers and are the strongest
remaining candidate for per-LED addressing.

#### The plan for the MIDDLE LED

The best lead is the app's own death frame, `$GLED,,,,5,,,*`, and the fact that **the one time the
middle LED moved** (`$GLED,1,<eff>,1,0,10`) had **token 4 = 0**, while every cell where it stayed red
had **token 4 = 1**. Token 4 is the axis that was never swept.

Ranked, cheapest first. Hold everything else fixed, run on **`$TID,2`** (yellow) so "blue" can never be
confused with "no override", and record **all three LEDs** each time:

1. **Sweep token 4 across 0-9.** The app uses 5. This is the single most likely unlock.
2. **Sweep effect 2, 3, 4** (ChaseBack / ChaseForward / StopIR). The two Chase effects are literally
   segment-walkers — if anything addresses LEDs in sequence, it is these.
3. **Test token 1 as the APK's `mid`** — i.e. a *segment id*, not a colour. That reading has never been
   tried, and the APK names the field `mid`, not `colour`.
4. **Replay the app's exact frames**: `$GLED,,,,5,,,*`, and the richest LED frame we hold,
   `$HLED,7,4,90,90,10,15,*` (seven populated positions, two 90s), adapted to `$GLED`.
5. **Sequenced writes** — three frames, one per segment, in case a frame only ever paints one LED.
6. **Drain the pools first.** The manual says the three LEDs are a **health bar**; every test so far ran
   on a freshly spawned gun at full pools, so "LED 2 red" may be the gauge reporting full, not a default.

**Do not add more token-3 values.** That axis is exhausted and its readings are phase noise.

**Method rule for the re-run:** the LEDs animate, so a single glance is not a measurement. Hold each cell
long enough to see whether it is static or cycling, and record *"static X"* or *"cycling X/Y"* rather
than one colour.


### 2026-08-30 — `$GLED` field map: colour, effect, brightness, and a SELF-ANIMATING flash

Follow-up to the P13 palette sweep, with Tony calling the LEDs. Gun held on `$TID,1` (blue) so anything
not blue is `$GLED` overriding.

**`$GLED,<colour>,<effect>,<t3>,<t4>,<brightness>,...`**

| token | meaning | evidence |
|---|---|---|
| **1** | **colour index** | 0 off · 1 blue · 2 yellow · 3 green · 4 purple · 5 teal · 6 white · 7-8 two more |
| **2** | **effect** (`LedEffect`) | effect 1 = Glow, visible brightness modulation |
| **3** | **flash / pattern selector** — see below | 0 = no override; 1,2,3 each flash a different 3-LED pattern |
| **4** | appears to gate whether the colour **persists** | with t4=1 the colour held; with t4=0 the gun stayed team-blue |
| **5** | **brightness** | swept 10 / 100 / 1000 / 4000, visibly dimmer to brighter |

#### The important one: token 3 makes the gun FLASH BY ITSELF

With token 3 non-zero the gun **pulses its team colour, flashes the `$GLED` pattern, then reverts on its
own** — no second frame from the host. Observed:

| token 3 | LEDs during the flash |
|---|---|
| 0 | *(no flash — stays team blue)* |
| 1 | green · red · red |
| 2 | green · red · blue |
| 3 | green · *(red)* · green (LEDs **1 and 3** green) |

**This is the hit indicator.** The host already sees `$HIR` the instant a player is hit, so a damage
flash is **one BLE write** — `$GLED,<colour>,0,<pattern>,...` — and the gun animates and restores
itself. No flash-then-restore round trip, which matters at 10 players.

#### What is now buildable

- **Night mode (P17):** `$GLED,0,...` blanks all three. *(Still unchecked: whether a later game event
  repaints them.)*
- **Native FFA white (Q19):** colour 6.
- **Per-player identity beyond 4 teams:** 8+ colours, per gun, independent of `$TID`'s 2-bit ceiling.
- **Hit flash:** token 3 non-zero, self-animating.

#### Per-LED addressing — swept, and the answer is PARTIAL

Held colour 3 (green), effect 0, token4 = 1, brightness 2000; stepped token 3 over 0-7. Tony called all
three LEDs each time:

| token 3 | LED 1 | LED 2 | LED 3 |
|---|---|---|---|
| 0 | green | **red** | red |
| 1 | green | **red** | blue |
| 2 | green | **red** | green |
| 3 | green | **red** | blue |
| 4 | green | **red** | teal |
| 5 | green | **red** | pink/white |
| 6, 7 | *not reported* | | |

**LED 1 takes token 1's colour. LED 3 varies with token 3. LED 2 stayed RED in every single cell.**
Brightness was also visibly cycling on several steps, so token 3 selects an animated state, not a
static pattern - the LED 3 colour recorded is whatever phase it was caught in.

**Verdict: two of the three LEDs are addressable this way, not all three.** LED 2 is not reachable with
`$GLED,<colour>,0,<t3>,1,<brightness>`.

**So a health/armour GAUGE is NOT yet buildable** - it needs the middle segment. What would unblock it:
sweep **token 4** (only 0 and 1 tried; 0 disabled the override entirely) and the **6th/7th** token
positions, and try `effect` values 2-4 (ChaseBack / ChaseForward / StopIR) which may address segments
differently. Also worth capturing what a **native Supremacy game** sends while its own 3-LED gauge
drains - that is the gauge working, and the frames are on the wire.

#### Also not resolved

**The exact per-LED addressing for a full gauge.** token 3 clearly selects *a pattern across the three LEDs*, but 1/2/3
do not map cleanly to a bitmask (2 changed the 3rd LED to blue; 3 lit the 1st and 3rd green). A
**health/armour gauge** needs to know exactly which LED a value targets, so that wants one more sweep:
hold colour and brightness fixed, step token 3 across a wider range (0-7), and record all three LEDs
each time. Do not build a gauge on the table above.


### 2026-08-30 — P13 ANSWERED: `$GLED` token 1 IS a colour index, and it overrides the team colour

**Tony at the bench, calling colours.** This corrects a documented claim, answers P13, gives P17 its
frame, and unblocks Q19.

**Method.** Gun on `$TID,1` (blue) and spawned, so anything **not** blue is `$GLED` overriding the team
colour. Swept `$GLED,<n>,0,0,1,2000,2000,*` for n = 0..8, ~10 s each, Tony reporting colour and which
of the three gun LEDs changed.

| `$GLED,n,0,0,1,2000,2000` | LED 1 | LEDs 2-3 |
|---|---|---|
| **0** | **off / dark** (all three dark) | dark |
| 1 | **blue** | red |
| 2 | **yellow** | red |
| 3 | **green** | red |
| 4 | **purple** | red |
| 5 | **teal** | red |
| 6 | **white** | red |
| 7, 8 | **two further distinct colours** (Tony: "the first led continued to change to several other colors too") — not individually named | red |

**So the palette is at least NINE entries (0 = off, 1-8 = eight distinct colours).** Whether it extends past 8 is untested and worth one more sweep — see below.

**Token 5 = BRIGHTNESS** (bench 2026-08-30): sweeping token 5 over 10 / 100 / 1000 / 4000 with colour 6
(white) visibly changed the LED's brightness. So a `$GLED` frame carries **colour, effect and brightness**
independently.

**Token 2 = effect, confirmed separately.** Repeating n=1 with effect 0 then 1: effect 1 produced
**visible brightness modulation**, matching `LedEffect.Glow` from the APK enum
(Solid / Glow / ChaseBack / ChaseForward / StopIR).

#### What this corrects

`protocol/brx-protocol.md` says of `$GLED`: *"LED **colour** is team-derived from `$TID`, not
`$GLED`."* **That is wrong.** The gun sat on `$TID,1` throughout and its first LED took six different
colours on command. Colour comes from a shared palette that `$GLED` can address **directly**; `$TID`
merely selects from the same table. (The narrower original claim — that `$GLED` is not raw `<r>,<g>,<b>`
— still stands: it is an *index*, not RGB.)

#### What it unblocks

- **P17 / night mode.** `$GLED,0,...` blanks all three LEDs. That is the frame night mode needed.
  ⚠️ **Still to check: does it STAY dark**, or does the next game event repaint them? `GameConfig(leds=False)`
  should not ship until that is confirmed.
- **Q19 / native FFA white.** White is **n=6**. We can match the stock look deliberately instead of
  shipping three team colours as a side effect of attribution.
- **The 4-team colour ceiling.** `$TID` is masked to 2 bits, so team colour caps at four. `$GLED` offers
  **at least six colours plus off, per gun**, independent of team. With Q17 fixed (attribution no longer
  needs unique teams), a 10-player FFA can put everyone on one team and still give each a distinct gun
  colour.

#### Not yet resolved, and deliberately not guessed

**Which LED is addressed depends on tokens we have not isolated.** In this sweep only the **first** LED
changed and 2-3 stayed red. But minutes earlier, `$GLED,1,<eff>,1,0,10,,*` turned the **middle** LED
**green** — same token 1, different LED *and* different colour. So token 1 is not *only* a colour index;
the trailing tokens select the target and possibly modify the colour.

**Next, two cheap sweeps:**

1. **How big is the palette?** We stopped at 8 only because the FB map claims 0-8. Sweep n = 9..24
   and find where it wraps or goes dark. **This directly decides the 10-tagger question**: if there
   are 16 colours, a 10-player FFA can give every player a distinct gun colour.
2. **One token at a time**, holding the others fixed, to separate "which LED" from "what colour".
   Do not build on the palette above beyond LED 1 until that is done.


### 2026-08-29 — FLOOR ARTIFACT CLOSED: fn 3 is DAMAGE, not a status function

Acting on the correction from the review loop rather than leaving it as a caveat. The `$SIR` function
map ran with the victim's shield at **0**, so a function draining *shield only* had nothing to take and
read as "moves no pool" — indistinguishable from a status effect. Fix: **grant a shield first**, then
fire the candidate.

**Method.** Victim `$PSET` shield cap 150. Row `<1,0>` = fn 11 (shield grant, friendly); three
friendly grants of 50 bring the shield to **150**. Then two enemy shots of magnitude 20 with the
candidate function in row `<0,0>`. Re-armed from `$CLEAR` every cell.

**fn 1 carried as the positive control** — plain damage, which must drain the shield first per the
known drain order. It did (150 -> 110), so the method can see a shield drain and every "no change"
below is real.

| fn | pools after grant | after candidate | result |
|---|---|---|---|
| **1** (control) | 45/70/150 | 45/70/**110** | drains shield ✅ control fired |
| **3** | 45/70/150 | 45/70/**110** | **DRAINS SHIELD — this is DAMAGE** |
| 8 | 45/70/150 | 45/70/150 | no pool moved |
| 24 | 45/70/150 | 45/70/150 | no pool moved |
| 25 | 45/70/150 | 45/70/150 | no pool moved |
| 26 | 45/70/150 | 45/70/150 | no pool moved |
| 27 | 45/70/150 | 45/70/150 | no pool moved |
| 28 | 45/70/150 | 45/70/150 | no pool moved |
| 35 | 45/70/150 | 45/70/150 | no pool moved |

**Result: fn 3 was mis-binned.** It drains exactly what fn 1 drains, 40 from a 2 x 20 volley, and only
looked inert because the earlier run gave it no shield to take. **It belongs in the damage class, not
the status class.** The predicted artifact was real and it caught a specific wrong row.

**The other seven are now much stronger candidates**, not merely un-refuted: they have survived the
ceiling test (damage into full HP/armour is visible, and they showed none) *and* the floor test (a
shield drain with 150 shield available is visible, and they showed none). **The stun shortlist is
therefore 8, 24, 25, 26, 27, 28, 35** — enemy polarity, register a `$HIR`, and move **no pool of any
kind**. That is a genuinely narrower claim than the one it replaces.

**Still true, and still needs an operator:** none of these seven touches BLE beyond the hit pair
(fn 23 is the only status function with a wire signature). Whatever they do is audio, LEDs, or a
felt effect. The wire has now given up everything it can about them.


### 2026-08-27 — the rig is pinned to the GUN-BODY sensor (20/20) — a scope fact, not a null result

Tested whether the unattended rig can land a **headset-dome** hit, which would have made the sensor
hypothesis answerable without an operator. **It cannot.**

20 shots of fn 1, magnitude 20, full re-arm between every shot, emitter at its fixed bench position
(~40 cm, per the rig notes):

| sensor | shots | per-hit delta |
|---|---|---|
| **4 — gun body** | **20/20** | 20 every time |
| 0 / 1 — headset domes | **0** | — |

**What this is worth.** It is not "we learned nothing". It converts an *unknown* condition into a
**known and uniform** one: **every pool number in the `$SIR` function map was measured at the gun-body
sensor.** That is a scoping statement that can go into the map now — the same shape as the protocol
qualifier, but this one cannot be cleared by re-running a cheap matrix. It also makes the follow-up
cheap: re-measure **two rows** with the emitter aimed at a dome and you know whether the sensor matters
at all, instead of re-running 50 cells.

**⚠️ Caveat on what `$HIR` tok1 means at close range** (raised by brx-opus2, and it cuts both ways):
the spec already warns that **point-blank floods mis-attribute**. At this range tok1 may indicate which
sensor **reported first**, not which was physically struck. So:
- a uniform tok1=4 here does **not** prove the domes were never illuminated, and
- had the buckets come back mixed, that would **not** have cleanly demonstrated sensor variation either.

**Therefore: record the firing distance alongside `$HIR` tok1 in every future pool measurement.** Range
is the same class of unstated condition that protocol and sensor both turned out to be — this is the
third time tonight an unrecorded condition has surfaced after the fact.

**Method rule now standing (agreed with brx-opus2): record `$HIR` tok1 — and the range — beside every
pool measurement.** It is the difference between a dataset that can answer a question retrospectively
and one that has to be re-run. `c9c4a3f` cannot settle the sensor question precisely because it
recorded no tok1.


### 2026-08-27 — PROTOCOL x FUNCTION MATRIX: the classes DO travel; my scope caveat was over-cautious

**My protocol-0 caveat was the right instinct and the wrong conclusion.** Measured, it dissolves.

fn {1, 3, 8, 23, 24, 25, 26, 27, 28, 35} x protocols {0, 5, 7, 9, 10}, armour 200 (no clipping),
shield 0, magnitude 20 x2 (= 40 if it damages), enemy team, row `<proto,0>`, re-armed from `$CLEAR`
every cell.

| fn | proto 0 | proto 5 | proto 7 | proto 9 | proto 10 |
|---|---|---|---|---|---|
| **1** (control) | 40 dmg | 40 dmg | 40 dmg | 40 dmg | 40 dmg |
| 3 | hit/0 | hit/0 | hit/0 | hit/0 | hit/0 |
| 8 | hit/0 | hit/0 | hit/0 | hit/0 | hit/0 |
| 23 | hit/0 | hit/0 | hit/0 | hit/0 | hit/0 |
| **24** | hit/0 | hit/0 | **hit/0** | hit/0 | hit/0 |
| 25 | hit/0 | hit/0 | hit/0 | hit/0 | hit/0 |
| 26 | hit/0 | hit/0 | hit/0 | hit/0 | hit/0 |
| 27 | hit/0 | hit/0 | hit/0 | hit/0 | hit/0 |
| 28 | hit/0 | hit/0 | hit/0 | hit/0 | hit/0 |
| 35 | hit/0 | hit/0 | hit/0 | hit/0 | hit/0 |

**All 50 cells complete. Not one varies by protocol.** The fn 1 control damages identically on all five (and confirms the
emitter delivers a faithful magnitude everywhere); every status-class function is pool-neutral on all
five.

**Conclusions**

1. **The behaviour classes travel — for the functions actually tested.** ⚠️ **Partly retracted the same
   day:** this originally said the map "can be stated without a protocol qualifier after all" and that
   the scope banner was over-cautious. That was itself over-scoped. The matrix covered **10 of 41
   functions, enemy team only, subtype 0 only** — no grant/friendly function was in it. Protocol
   independence is well-supported for damage and enemy-status functions and is an **extrapolation** for
   the grant half. See the scope block on the function-map entry.
2. **The earlier "dissolved — identical on protocols 5 and 7" retraction is CORRECT**, and now extends
   to 0, 5, 7, 9 and 10. It was not half-right; it was right.
3. **`c9c4a3f`'s "fn 24 damages on protocol 7 (armour 70 -> 30)" does NOT reproduce.** fn 24 is
   pool-neutral on protocol 7 here, 5 protocols x controlled cells.

**⚠️ This is the SECOND non-reproduction from the same measurement context** — the fn 36/37 x2
multiplier was the first. Two results from operator-present runs failing to reproduce on the unattended
rig is a **pattern**, not two independent flukes, and it deserves a cause rather than a winner.

**Do not read this as "those measurements were wrong."** Both were carefully taken and internally
consistent. The systematic difference between the two contexts is the open question, and the candidate
list is short:

- **Operator present vs absent.** Both non-reproducing results come from runs with Tony **holding the
  gun**; both re-tests are unattended. A held gun differs physically — orientation, IR incidence angle,
  body proximity, which sensor is struck.
- **Gun uptime / state.** The unattended victim has been powered for many hours across these runs;
  rig degradation is documented here. The trailing control on the big sweep passed, which argues
  against gross degradation but not against a subtler state difference.
- **A different physical gun**, if the earlier runs used one — cheapest to rule in or out and would
  explain both at once. **Cannot be tested from here:** a scan shows only the one victim powered.
- **Which SENSOR is struck.** **Every one of my 18 recorded hits landed on `$HIR` token 1 = 4, the GUN
  BODY** — not once on a headset dome. A gun held by a person is struck at a different angle, and the
  log does contain plenty of `$HIR,0` (headset front) hits from other sessions, so both paths are real.
  **This is a candidate, NOT a confirmed cause** — the 2026-08-27 entries record only `$HIR,4`, the
  same as mine, so the record does not actually show the non-reproducing runs used a different sensor.
  Its value is that it converts a vague "operator present" into a **precise one-variable test**: aim the
  same word at the **headset dome** versus the **gun body** and compare. If the sensor changes the
  applied function, both anomalies are explained by one mechanism and it is a five-minute check.

**This is now one question, not two** — *what gun-side condition was present in the operator-present
runs and absent unattended?* — and the same question U10 asks about the multiplier. Two symptoms with
one cause is a tidier answer than two oddities, and it is the thing to test next **with Tony present**,
because operator presence is itself the leading suspect and cannot be reproduced without him.


### 2026-08-27 — INSTRUMENT FAILURE: the `$QUERY` state-diff detector is invalid as built

**Discarded, not interpreted.** Recorded so the same detector is not rebuilt the same way.

**Idea.** The frame-capture sweep watched for *emitted* frames. `$QUERY,*` instead *polls* configured
state — including per-slot weapon damage/sound pairs — so a status effect that disabled a weapon would
show up in a readback while emitting nothing. Genuinely a different instrument, worth trying.

**It failed its own control.** fn 1 (plain damage) alters no configuration, yet the detector reported
`CHANGED`. Every reported "change" was a raw **length** difference — 15 -> 29, 15 -> 33, 33 -> 29,
29 -> 15 tokens — with no meaningful field diff. **`$QUERY` replies are variable-length across reads
for identical state**, because long replies span multiple BLE notification chunks and the capture
window does not always catch all of them.

So the "changes" were chunking artefacts. Any cell in that run — positive or negative — is
uninterpretable, including the cells that read `NO CHANGE`, since a truncated reply can match by
accident.

**How to build it properly, if it is worth revisiting:**
1. Compare **parsed fields**, never raw strings.
2. Require **two identical consecutive reads** before accepting a `$QUERY` as a valid sample.
3. Widen the reply window and reassemble by chunk rather than by timeout.

**General lesson (already in `gotchas.md` in spirit):** an instrument that has never been shown to
produce a *true negative on a known-null input* is not yet an instrument. The frame-capture sweep
earlier the same night carried both a positive and a negative control and passed both — which is the
only reason its negatives are usable and this run's are not.


### 2026-08-27 — VALIDATED NEGATIVE: fn 23 is the ONLY status function with any BLE signature

**This closes the stun hunt as a keyboard-only problem.** It cannot be cracked without an operator, and
that is now an evidence-backed statement rather than an excuse.

**Why this run existed.** The big function sweep watched only `$HP` and `$HIR`. But fn 23's audio
suppression was originally caught as **`$ALCD` token 2 -> 0** — an entirely different frame. So the
status-class functions might have had signatures the sweep was structurally blind to. This run captured
**every frame type** for 9 s after a single shot, excluding only the `$VOLTS` battery heartbeat.

**fn 23 was carried as a POSITIVE CONTROL** — the one function already proven to be a status effect. If
the method could not see its known signature, the method was blind and every "(none)" would be
meaningless.

| fn | shooter | non-`$HP`/`$HIR` frames in 9 s |
|---|---|---|
| **23** | **enemy** | **`$ALCD,32,0,0,192,0`** — audio level 0, the known signature ✅ **control fired** |
| 23 | friendly | (none) |
| 3, 8, 24, 25, 26, 27, 28, 35 | enemy | **(none)** |
| 9, 10, 15, 31, 32, 34 | friendly | **(none)** |
| 1 (plain damage) | enemy | (none) — negative control |

**Result: of every function in the status class, only fn 23 touches BLE at all.** Because the positive
control fired, these are **true negatives, not a blind instrument**.

> **Scope: measured on protocol 0.** "Clean" means *no BLE-visible frame beyond the hit pair* — it is
> not a claim of inertness. The protocol matrix has since shown these functions are pool-neutral on
> protocols 0, 5, 7, 9 and 10 alike, so the wire-silence finding is not protocol-specific either.

**Two things follow.**

1. **The stun, if it exists, is invisible to BLE.** Whatever fn 3 / 8 / 24-28 / 35 do, they do it
   entirely victim-side — audio, LEDs, or a firing lockout — with no telemetry whatsoever. No amount of
   keyboard work will find it. It needs a person holding the gun reporting what they **hear, see, or
   cannot do**. This is why bench item 0.x is blocked on an operator and cannot be worked around.
2. **fn 23's suppression looks enemy-only — one cell, no friendly-side control.** It lands from both
   teams (per the function map) but produced the `$ALCD` signature only from an enemy source in a
   **single** friendly trial that read `(none)`. There was no positive control proving a friendly-sourced
   fn 23 *could* have shown a signature, so treat this as indicative, not established — consistent with a debuff, and a useful detail
   for anyone building it into a mode.

**Corollary for Mission Control:** status effects are **not observable in telemetry**. A HUD cannot show
"you are stunned" or "your audio is suppressed" from gun frames alone — except for fn 23, which is
detectable as `$ALCD` t2 = 0. Same family of constraint as Q13 (friendly fire invisible on the wire).


### 2026-08-27 — ⚠️ UNRESOLVED: the fn 36 / 37 damage multipliers did not reproduce

**Kept deliberately, unconfirmed.** This is the most important open thread from the session and it is
recorded in full — including four hypotheses that were tested and *refuted* — so nobody re-derives it
from scratch or quietly trusts the older number.

#### The two conflicting datasets, same bench, same emitter, hours apart

| | fn 1 (control) | fn 36 | fn 37 |
|---|---|---|---|
| **earlier** (`crack3.py` R2), row `<0,3>`, mag 20, armour 70 | 20 | — | **40 = x2**, 3/3 · and **60** with crit, exactly x1.5 on 40 |
| **later** (`multsub.py` / `multrepro.py`), mag 20, armour 200 | **20 ✓** | **20 = x1.0** | **20 = x1.0** |

The earlier result is not obviously noise: it was **3/3 at crit=0 and 3/3 at crit=1**, and the crit
values stacked correctly on a base of 40 (`$GSET` t7=50 -> 60). The later result is not noise either:
**24 cells**, single verified hit per trial, with the fn 1 control reading a correct 20 in every one.

#### Hypotheses tested and REFUTED

1. **"The multiplier belongs to the (proto, subtype) cell, not the function."**
   Swept fn 1 / 36 / 37 x subtype {0,1,2,3}. **Every** fn 36 and fn 37 cell read 20. Refuted.
2. **"It needs the full 12-row `$SIR` table, not a single row."**
   Ran both arrangements. Both read 20; fn 1 control correct in both. Refuted.
   *(And on re-reading `crack3.py`, its arming was `[STD, $SIR,0,3,,37]` — two rows, i.e. effectively
   the full-table arrangement that also reads 20 now.)*
3. **"Our emitter encoded a magnitude of 40, which would look exactly like x2."** — **REFUTED, and
   decisively.** The two encoders are **byte-identical** and `crack3.py` passed `damage=20` by keyword;
   mag 20 verified in software as `...00010100...`, 25 bits. **The killer argument is structural:** the
   emitter is *function-agnostic* — it sends bits, and the function is chosen by the victim's `$SIR`
   row — so an encoding fault would corrupt the magnitude identically whatever function applied. In the
   run that produced the x2, **fn 1 read 20 and fn 37 read 40 in the same session, same emitter, same
   `damage=20`**. Had the emitter sent 40, fn 1 would have read 40. Confirmed again by the protocol
   matrix: **fn 1 = exactly x1.0 on protocols 0, 5, 7, 9, 10.**

   **This inverts the conclusion.** The doubling happened *inside the gun*, so the earlier 3/3 becomes
   **more** credible, and the open question is now *what gun-side condition enables the multiplier* —
   not whether our rig lied. It also means every pool delta measured through this emitter (AP, add-HP,
   the Energy Launcher's 0/3) is **not** in doubt: magnitudes are delivered faithfully.
4. **"Different arithmetic between the runs."** Both compute an armour delta; the differing baselines
   (70 vs 200) cancel out. Refuted.

#### What was NOT ruled out

- **Gun state / uptime.** The victim had been powered for many hours by the later runs. Rig degradation
  is a documented failure mode here, though the trailing control on the big sweep passed cleanly.
- **A genuine error in the earlier measurement** that its internal consistency masked.

#### How to settle it — take our emitter out of the loop

**Capture a real BRX weapon known to use fn 36/37 firing at a victim, and compare `$HIR` token 5 (the
raw magnitude) against the applied `$HP` delta.** If stock hardware shows delta = 2 x token 5, the
multiplier is real and our emitter path is at fault; if delta = token 5, the x1.25/x2 claim is wrong.
That reads the answer off the gun with nothing of ours in the signal path. **Needs an operator.**

`protocol/brx-protocol.md` §5 now carries a **DISPUTED** banner on both rows. **Do not use x1.25 / x2
for weapon tuning until this is resolved** — every shipped weapon mapped to fn 36 or 37 may be dealing
base damage.

> ✅ **SUPERSEDED 2026-09-02 (see the entry at the end of this file).** The multipliers are REAL:
> **fn 36 = floor(magnitude x 1.25), fn 37 = magnitude x 2**, over 16 trials, 4 magnitudes and 8 `$SIR`
> row-tail shapes with an fn 1 control in every trial. The "do not use x1.25 / x2" instruction above is
> **withdrawn**. This 24-cell x1.0 matrix is **outvoted, not explained** — we still do not know why it
> read x1.0.

### 2026-08-27 — NEGATIVE (rig): IR loopback capture failed — geometry, not encoding

Attempted to verify the transmitted word over the air (emitter -> receiver -> decode), which would have
tested hypothesis 3 on hardware rather than in software. **No captures on any of 5 words.** The emitter
is aimed at the victim's headset, not at the receiver; the two boards cannot see each other in the
current arrangement. Not a decoding failure — nothing arrived at all.

**Needs an operator to re-aim the emitter at the VS1838B** (and attenuate — it saturates point-blank).
Software encoding was verified instead, and is correct.


### 2026-08-27 — THE FULL `$SIR` FUNCTION MAP (0-40) x SHOOTER TEAM, control-validated

41 functions x 2 teams, autonomous, `$VOL,3`, victim Tactix-FE30 `$TID,1`, hp45/armour70/shield-cap70,
magnitude 20, 2 shots per cell, re-armed from `$CLEAR` every cell, `$HIR` counted separately from `$HP`.

> ### ⚠️ THREE SCOPE CONDITIONS ON THIS MAP — read before citing any row
>
> **1. CEILING ARTIFACT — the friendly/grant half of the "status" class is NOT trustworthy.** Every cell
> re-armed from `$CLEAR`, so the victim sat at **full HP 45 / armour 70**. An *add-HP* or *add-armour*
> grant into full pools is **clamped, and reads as "moves no pool"** — indistinguishable from a genuine
> status effect. Only the shield (starting 0, cap 70) had headroom, which is exactly why every "grants"
> row is signed `shield 0 -> 40`. **Proof this bit us:** the map lists **fn 10** as status, but fn 10 is
> independently bench-confirmed as **"respawn + add HP (15→35→45)"** (`brx-protocol.md` §5). It is a
> grant, mis-binned by the ceiling. **So friendly 9, 10, 15, 31, 32, 34 must be re-measured from
> DEPLETED pools** (spawn, take damage, then apply) before any of them is called a status function.
> **The same artifact applies at the FLOOR, mirrored — so the enemy half is not fully clean either.**
> The victim's shield started at **0**. Any enemy-side function that drains *shield only* has nothing to
> take and also reads "moves no pool". So the enemy shortlist (3, 8, 24-28, 35) is clean of the *heal*
> confound but **not** of a shield-drain confound: what it really shows is "does not reduce HP or
> armour". Re-measure those cells **with a shield granted first** to close it.
>
> **And the "grants" rows are under-determined for the same reason.** With HP and armour full, a grant is
> visible *only* as shield overflow — so `shield 0 -> 40` cannot say which pool fn 11/12/14/18/19/20/21
> actually targets. **fn 13 proves the confound**: it is a known *add-armour* function and was seen as
> shield. Only the earlier depleted-pool run (`brx-protocol.md` §5: fn 10 `15→35→45`, fn 11 `0→50→70`,
> fn 13 `0→30→60→70`) distinguishes them.
>
> **2. GUN-BODY SENSOR, ~40 cm.** All 20/20 hits landed on `$HIR` tok1 = 4. Whether a headset-dome hit
> applies the same pool deltas is **untested** — this rig cannot produce one.
>
> **3. Protocol independence is measured on 10 of 41 functions.** The matrix covered
> fn {1, 3, 8, 23, 24, 25, 26, 27, 28, 35}, **enemy team only, subtype 0 only** — no grant/friendly
> function was in it. "The classes do not vary by protocol" is well-supported for damage and
> enemy-status functions and is an **extrapolation** for the grant half.
>
**Trailing control passed.** The fn 1 and fn 11 cells were re-measured *after* all 41 cells and
reproduced their opening rows exactly (`HIR=2 $HP,45,30,0` and `HIR=2 $HP,45,70,40`). The rig did not
degrade across the run, so the whole table is trustworthy. *(Design note: the first draft armed a
control row but never fired it — a control you do not fire is not a control. Fixed by running it as a
separate pass.)*

#### The four behavioural classes

| class | functions | signature |
|---|---|---|
| **plain damage** | 1, 4, 5, 7, 16, 19, 20, 22, 29, 30, 33, 36, 37, 38 | enemy-only, armour 70 -> 30 (40 dealt) |
| **armour-piercing** | 2, 6, 17, 21 | enemy-only, HP 45 -> 5, **armour untouched** |
| **grants** | 11, 12, 13, 14, 18, 19, 20, 21 | friendly (or dual), shield 0 -> 40 |
| **status — lands, moves nothing** | **3, 8** (enemy) · **23** (dual) · **24, 25, 26, 27, 28, 35** (enemy) · ⚠️ *friendly 9, 10, 15, 31, 32, 34 — see the ceiling caveat above* | `$HIR` fires, every pool unchanged |
| **inert** | 0, 39, 40 | no `$HIR` from either team — the range ends at 38 |

#### Why the status class is the stun shortlist

**fn 23 — the one function already proven to be a status effect (audio suppression) — sits in this
class.** That is the detector validating itself: a known status effect presents exactly as "registers
a hit, moves no counter". So the other members are strong candidates, and they can only be separated
by a human, because the remaining difference is what the player *hears, sees or cannot do*.

**Priority for the bench, enemy-polarity (a debuff should come from an enemy):**
**3, 8, 24, 25, 26, 27, 28, 35.**

#### Two further observations

- **fn 24-27 double-report:** 4 `$HIR` from 2 shots, consistently, where every other function gave
  exactly 2 — and fn 23 and fn 28 either side gave 2. It is function-dependent, not geometry drift.
- **fn 24 resolves an old contradiction.** It was once reported as dealing damage, then failed to
  reproduce, and was retracted. Both are now explained: it *lands* (so it looked real) but *moves no
  pool* (so damage never reproduced). The retraction was correct; this says what it actually is.
  Consequence: the **Energy Launcher**, mapped to `<9,3>` -> fn 24 in every shipped game, genuinely
  does nothing to any pool.

#### ⚠ CONFLICT to resolve, not yet a correction

`brx-protocol.md` records **fn 36 = x1.25** and **fn 37 = x2**, bench-measured. In this sweep both
behaved as **x1.0** (40 dealt from 2 x 20). The difference is the cell: the original measurement drove
row `<0,3>` with word subtype 3; this sweep drove `<0,0>` with subtype 0. That suggests the multiplier
may belong to the **(protocol, subtype) cell rather than the function number** — which would change the
damage model. **Deliberately not edited into the spec** until a dedicated fn x subtype matrix settles
it; a single conflicting observation is a reason to test, not to rewrite.

> ✅ **RESOLVED 2026-09-02 (entry at the end of this file).** The multipliers are real and belong to the
> **function**, not the (protocol, subtype) cell: fn 36 = floor(magnitude x 1.25), fn 37 = magnitude x 2,
> reproduced across 4 magnitudes and 8 row-tail shapes with an fn 1 control in every trial. Why this
> sweep read x1.0 is still unexplained.


### 2026-08-27 — NEGATIVE: `$PSET` t2 and t6 are invisible to the damage instrument

Swept `$PSET` token 2 over {0,1,2,5,10,50,100} and token 6 over {0,1,25,50,100,200}, two enemy hits
of 20 per cell, re-armed each time. **Every cell identical**: `$HIR`=2, `$HP,45,30,0`, and a
byte-identical `$HIR,4,0,42,2,20,0,0`. Victim `$PSET` t1 (player id) over {0,7,40,63} likewise
changed nothing observable — expected, since t1 is the *victim's* id and `$HIR` tok3 carries the
*shooter's*.

**This is a bounded negative, not a discovery.** It says the IR-damage probe is blind to whatever t2
and t6 control, and rules out damage, pools, crit, gating and `$HIR` content. `$QUERY,*` does not echo
them either (its second field is the **team**, not `$PSET` t2). The remaining instruments are **audio
and LEDs**, both of which need an operator present. Moved to the operator-required list rather than
left as an open unknown — hammering the same blind instrument harder would not have helped.

### 2026-08-27 — METHOD CORRECTION: earlier function sweeps fired from the wrong team

Team gating (above) invalidates the *method* of several earlier sweeps, so their negatives cannot be
trusted:

- the fn 24-27 "deals damage" result that **failed to reproduce** under A/B,
- the stun/EMP hunt across functions 3 / 8 / 23-28 / 35,
- tonight's first shield run.

All of them fired from **team 2 (enemy)**. Support-polarity functions are **discarded with no `$HIR`**
from an enemy source, so a support function would present exactly as "no effect" — indistinguishable
from a function that does nothing. **Those negatives are void, not confirmed.**

Re-running the full function range 0-40 against **both** a friendly (team 1) and an enemy (team 2)
source, with a known-good damage row kept at `<3,0>` as an in-run control. The cells to watch are
those that **register `$HIR` but move no pool** — a function that lands and changes no counter is what
a stun/status effect would look like on the wire.


### 2026-08-27 — team gating measured for DAMAGE (closes an open correction); `$PSET` t5 = shield cap

Autonomous (emitter + BLE, operator away, `$VOL,3`), victim Tactix-FE30 on `$TID,1`, mains. Every cell
re-armed from `$CLEAR`, and **`$HIR` counted separately from `$HP`** — that separation is what made the
mechanism visible.

**Read this against `protocol/brx-protocol.md` §5, which already establishes** that support functions
are team-gated, that drain order is shields -> armour -> HP, and that fn 11 adds shields. Those are
**reproduced here, not discovered** — an independent second measurement on a different rig. What
follows is flagged as either REPRODUCED or NEW.

#### The full four-team x function matrix (NEW for damage)

`brx-protocol.md` §5 carries an explicit correction saying the generalisation of team-gating to
**damage** at `$GSET` t1=0 was *unsupported*. This run measures it directly and closes that gap.

| function | team 0 | **team 1 (= victim's own)** | team 2 | team 3 |
|---|---|---|---|---|
| fn 1 plain damage | lands | **`$HIR`=0, nothing** | lands | lands |
| fn 2 armour-pierce | lands | **`$HIR`=0, nothing** | lands | lands |
| fn 11 shield grant | `$HIR`=0 | lands | `$HIR`=0 | `$HIR`=0 |
| fn 9 grant-family | `$HIR`=0 | lands | `$HIR`=0 | `$HIR`=0 |

- **NEW — damage is team-gated at t1=0**, symmetrically with support: damage only from an enemy team,
  support only from your own. The open correction in `brx-protocol.md` §5 can now be resolved.
- **NEW — the rejection emits no `$HIR` whatsoever.** A blocked shot is not "received and not applied";
  it never reaches the wire.
- REPRODUCED — support functions land only from a same-team source.

> **Consequence for Mission Control:** a friendly-fire or mis-aimed support shot **cannot be logged,
> scored or displayed** — nothing reaches BLE. Any feature wanting to show "you shot your teammate"
> is not implementable from gun telemetry while t1=0.

This also retro-explains a dead end earlier the same night: a shield sweep that appeared to prove
"`$PSET` shield is inert" was firing from team 2. The function was fine; the *team* was wrong. That run
carried no in-run control, which is precisely why it was uninterpretable — it was discarded, not
published.

#### `$GSET` t1 = friendly fire — REPRODUCED, independently

Single-variable sweep of all 8 tokens against a friendly (team 1) damage shot, baseline
`$GSET,0,0,1,0,1,0,50,1`: **only t1=1** let it land (`$HIR`=2, armour 70 -> 30); all seven others left
`$HIR`=0. Trailing enemy-damage control still landed. This matches the APK metadata label and the
2026-08-26 bench result — a third independent confirmation, and it pins the *mechanism*: t1 works by
admitting the frame at all, not by scoring it differently.

#### `$PSET` t5 is a shield CAPACITY (NEW)

§5 records fn 11 adding shields (0->50->70) but does not identify what bounds it. It is `$PSET` t5, and
**the spawn shield is always 0** — t5 is a ceiling to be filled, never a starting pool.

| `$PSET` t5 | offered 500 (10 x 50) | reached |
|---|---|---|
| 70 | 500 | **70** (saturates) |
| 150 | 500 | **150** (saturates) |
| 255 | 500 | **255** |
| 300 | 500 | **300** |
| 600 | 500 | **500** — climbed 250/300/350/400/450/500, never plateaued |

The t5=600 row is the control that proves the cap is real rather than an artifact of how much was
offered: when the ceiling exceeds the offer you get exactly the offer, with no plateau. **Shield is
therefore also wider than 8 bits**, completing A10b-prime across all three pools.

#### Two smaller confirmations

- **fn 2 is true armour-piercing** (NEW as a direct measurement): two 20-damage hits took HP 45 -> 5
  with armour untouched at 70. It bypasses shield and armour rather than consuming them.
- **Drain order** REPRODUCED: shield 150, four 30-damage hits -> `150/120/90/60/30`, HP and armour
  untouched.
- **Multi-sensor double-count (NEW):** one cell logged **3 `$HIR` for 2 shots** and applied damage 3x.
  A single shot seen by two sensors counts twice — the mechanism behind the operator being killed by
  his own reflected IR at the bench.

#### Follow-on

Q12 gets **more** serious: the shield is a real, damage-absorbing pool with a configurable ceiling, and
our own code discards it (`protocol.py` parses only tok(1); `app/src/engine.js` drops the third token).
We are throwing away a mechanic the hardware fully implements.


### 2026-08-27 — A10b-prime CLOSED: `$PSET` pools are NOT 8-bit (armor + HP verified live to 1000)

The loadout policy layer caps pools at 255 on the assumption that the wire field is a byte. **It is not.**
Autonomous run (emitter + BLE, operator away, `$VOL,3`), victim Tactix-FE30 on mains.

**Method.** Push `$PSET` with the pool under test, read it back with `$QUERY,*` (proves the gun *stored*
it), then land IR damage and read `$HP` (proves the gun *uses* it). Readback alone is not evidence — a
device can echo a value it later truncates.

**Armor** — one 20-damage hit per row:

| pushed | `$QUERY` echo | `$HP` armor after hit |
|---|---|---|
| 254 | 254 | 234 |
| 255 | 255 | 235 |
| **256** | **256** | **236** |
| 512 | 512 | 492 |
| 1000 | 1000 | 980 |

**HP** — armor 0 so damage lands on HP, 250 per shot:

| pushed | successive `$HP` |
|---|---|
| 255 | 5 |
| **256** | **6** |
| 300 | 50 |
| 600 | 350 → 100 → 0 |
| 1000 | 750 → 500 → 250 → 0 |

**Result: no wrap at the 8-bit boundary, no rollover, and damage clamps at zero rather than
underflowing.** 256 behaves as 256, not as 0. Both pools are at least 16-bit and decrement exactly.

**So the 255 cap is a policy choice, not a device constraint.** That is a fine thing to keep — huge pools
make for bad games — but it must not be documented as a hardware limit, and nothing should *silently*
clamp a configured value to 255 as though the wire required it.

**Shield is NOT settled and is deliberately excluded** from the above. A first run came back all-zeros but
carried no in-run control, so it could not distinguish "shields behave differently" from "no IR landed" —
it was discarded rather than written up. See the following entry.


## 2026-08-30 (Tony + Claude, MacBook) — 🏆 THE FIRST FULL MATCH ON OUR OWN STACK, and 11 findings

**The MC↔phone↔gun path is HARDWARE-VERIFIED.** Two phones, two taggers, one MacBook hosting: a
300-second FFA ran start to finish. **12 kills, 126 landed hits, 12 deaths and 12 respawns, live streaks, a winner.**
That closes the headline `[UNVERIFIED]` in `field-runbook-mc.md` — the field path is real, not just
green in the test suite. Evidence: `~/.brx-mcp/mc/session-e615e251.sqlite` (2095 envelopes) and the
tee'd `~/mc-20260830-1930.log`.

Everything below came out of that one match. Nine were fixed the same night; two need more evidence.

### Setup: a fresh Mac cannot reach the KIT screen (FIXED)
`~/.brx-mcp/armory.json` is built by cabling a tagger over USB and is git-ignored (it holds headset
PINs), so a machine that has never done that has an **empty armory**. KIT's gun `<select>` was
registry-only, so it offered nothing but "— NO GUN —" and no player could be kitted at all. Muster's
device-first claim already falls back to the connected node's **gun tail** (`state.py
_find_player_for_gun`, second pass); KIT now does the same and tags such guns `· UNREGISTERED`.
*Both symptoms had one cause*: a node binds to a player **by gun**, so with no gun assigned neither
phone bound, so neither got an `assign`, so both HUDs sat on "waiting" — with `kit_open` already true.

### Volume was two notches too quiet (FIXED)
`$VOL,69` — the value iOS Callsign sends, and our house default — is **on-gun level 2**
(`$VOL` L1=60 … L5=100). Tony asked for L4. Volume now follows the venue that was already in the
config: **90 outdoors, 80 indoors**, try-outs 69. `compile.play_volume()`.

### The weapon meters were measuring the wrong thing (FIXED)
`stats.dmg` is documented in `weapons.json` `_note` as *"share of a 115 pool one hit removes"* — 7 to
11 for most guns. Rendered as a 0–100 bar it can never fill past a tenth, so **every weapon read weak
and no two looked different**. And `rng` is **identical (75) on all 18 guns** — range is not
differentiated on the wire, so that meter always measured nothing. Bars are now ranked **across the
arsenal** (`views.weapon_views`) and the real numbers ship beside them: damage/hit, hits-to-kill,
TTK, reload, mag/reserve. The range bar is gone.

### The Assault Rifle: yes, we nerfed it, and it was the wrong nerf (FIXED)
Tony: *"the classic assault rifle doesn't feel like the native m4 at all. it feels slow"* — and
*"did we purposely make that less good?"* **Yes.** Exactly one token differed from the captured
Callsign frame: `t14` fire interval, native **100 → 190 ms**.
Measured across the whole arsenal, 190 was simply the first cycle at which the AR stopped strictly
dominating — at native 100 ms with its 384 reserve it **strictly dominates 10 of the 17 picker
weapons**. But the dominance was never rate alone; it was rate **plus the deepest pool in the game**.
Paying for speed out of the *reserve* instead: **cycle 140 ms, reserve 192** → zero dominance, still
inside the 1.5–3.5 s TTK band, and **36 % more rate of fire**. Shipping the true 100 ms remains a
one-token change for anyone who wants stock feel over a balanced arsenal.

### The HUD never learned about the ALT button (FIXED)
`engine.js` only ever learned the live weapon slot from `$ALCD`, which the gun sends **on a shot** —
so after an ALT swap the HUD kept showing the old weapon *"until you press trigger"*. `$BUT,1` was
being parsed and thrown away (it was only read during resync). ALT now raises a big centre-screen
**SWITCHING — HOLD FIRE** banner, and the swap is timed: `engine.lastSwitchMs` records the real
duration the first time an `$ALCD` confirms one. **We have never measured how long a swap takes** —
the 2500 ms ceiling is a guess with an optimistic flip behind it, and wants a real number.
Also fixed: `snapshot.weaponId` always reported `weapons[0]`, ignoring the live slot.

### Smaller fixes from the same match
- **The countdown reset to 02:00 on every tab switch.** `Lobby.tsx` and `Armed.tsx` each held it in
  `useState(120)`, and React re-runs an initialiser on **remount** — which is what a tab switch is.
  Now shared + persisted (`webapp/mc/src/runway.ts`).
- **A red readiness row hard-blocked the push with no way past it**, which stranded a live session
  when one phone dropped its BLE link. `start()` has had a `force` since A6; `push_config()` did not.
  It does now, behind a deliberate HOST OVERRIDE click — and the lobby prints the actual blocker
  (`GUN LINK LOST`) instead of just `E20D RED ON THE BOARD`, which read as "MC is stuck".
- **The recap read FINAL before the data was in**, then the totals moved. A node reporting
  `pending == 0` has flushed what it *knows*; if it has not checked in since the whistle it may not
  yet know its last seconds. After `end_t`, freshness is now measured **from `end_t`**.
- **No way to see a previous match.** Every finished match was already being written to the session
  store; nothing ever read it back. `Store.matches()` + `GET /api/matches` + a history picker on RECAP.
- **The weapon name on the HUD was 11 px and muted.** It is primary information; it is now sized like
  it, with a PRIMARY/SECONDARY chip, and kept (dimmed) in night mode instead of hidden.

### ⚠ Two that need evidence, not more theorising
1. **The headsets never flashed green** — on a hit or on a death. This **contradicts the 2026-08-27
   entry**, which recorded green-on-hit/kill as autonomous and concluded "we get them free". Corrected
   in place above: it is host-driven and Callsign sends something we do not. Needs a Callsign capture
   on the Mac and a frame diff.
2. **Emptying a mag on full auto showed no reload prompt and no empty-clip state.** The data path is
   fine — ammo tracks and decrements across all 328 status samples — but **ammo never once read 0** in
   the whole match. Two-second status sampling cannot tell us whether the gun stops emitting `$ALCD`
   during sustained auto fire or whether this is a render-gate problem. **It needs the phone's raw BLE
   frame ring**: hit "Share log" on both phones before closing the app and it lands in the same SQLite.

### Method note
The MC session SQLite carried this whole debrief. `envelopes` (984 rows) gave the per-2-second ammo,
HP and preflight time series for both phones, which is what settled "did hits register" (yes),
"were the headsets healthy" (yes, all match) and "did ammo ever hit zero" (no). **Start MC tee'd and
copy the SQLite off after every session** — `field-runbook-mc.md §0a`. The one gap was the phone-side
frame ring, which nobody hit "Share log" for; that is the difference between fixing bug 2 and
speculating about it.

## 2026-09-01 (Claude, MacBook) — 🆕 THE HEADSET FEEDBACK IS DECODED, from captures we already had

**No new capture session was needed.** M1 in `handoff-post-first-match.md` asked for a fresh Callsign
game on two phones. It was already on disk — twice. The `$SFLASH` capture and
`2026-08-23-two-tagger-combat.btsnoop` between them cover both sides of a fight, and they answer it.

### What Callsign actually sends to the headset

| when | frame | which player |
|---|---|---|
| pre-game, with `$GLED` | `$HLED,<team>,0,,,10,,*` | **every** gun, every captured game |
| armour 0 → HP dropping | `$PLAY,VA8B,3,6,,,,,*` then `$HLED,7,4,90,90,10,15,*` | the **victim** |
| end of game | `$HLED,,6,,,,,*` | every gun |

**We sent none of the first two.** Our only `$HLED` all game is the blanking frame at the end. That is
why our headsets were dark for a whole match while Callsign's are not.

### ⛔ There is NO per-hit and NO per-kill headset frame

- **Shooter side, on a kill** (`2026-08-25-two-gun-3-kills-sflash`, 3 kills): every kill is
  `$SFLASH,*` + `$PLAY,,4,6,V3A,,,,*` and **nothing else**. Our kill path is already byte-identical.
- **Victim side** (`2026-08-23-two-tagger-combat`): **23 `$HIR` hits, 2 `$HLED` alerts.** The alert is
  not per hit. Both fired once per life, ~0.9 s after armour reached 0 and HP began dropping — 2
  deaths, 2 alerts, both at `$HP,34,0,0` (@340.5 s and @361.5 s), each paired with `VA8B`.

⇒ **The "blinks green on hit" in the 2026-08-27 entry is almost certainly this low-health alert**, which
Tony flagged his own uncertainty about at the time. It is a *state* alert, not a hit flash.
⇒ The 2026-08-30 correction ("green is host-driven") **stands and is now specific**: the frames exist,
we have them, and they are these.
⇒ **Still open:** whether a per-hit blink happens autonomously *once the headset has been lit* by the
pre-game `$HLED`. Our headsets never got that frame, so we have never seen the lit state at all. That is
now an eyeball test, not a capture.

### Shipped
- `compile.py` head now ends `… $HLED,<tid>,0,,,10,,* → $TID,<tid>,*`. `$HLED` token 1 is a colour index. ⛔ **The claim that it shares `$GLED`'s palette and that "the tid
  IS the colour" is RETRACTED** (review 2026-09-01): across all 23 captures token 1 is only ever 0, 1, 7
  or empty, and **no capture contains a `$TID` at all**, so nothing observed links the two. We now emit
  it only for the values Callsign has been seen to send.
- `cues.hurt` + `cues.hurt_led`, fired by the node once per life on the armour-0 → HP-damage
  transition (`engine._onHp`). Byte-identical to the capture.
- Both are **UNCONFIRMED on hardware.** Next match: look at the headsets pre-game (team colour?) and
  when someone's armour breaks (alert?). That is the whole test.

### Method note, again
This is the third time an unread capture answered a question we were about to spend a hardware session
on — `$SFLASH` sat unread for two days, `$ALCD` heat telemetry for days, and now this. **Before planning
a capture, grep the ones in `protocol/captures/raw/` for the command you expect to find.** It cost ten
minutes here and would have cost an evening with two phones and a hub.

## 2026-09-01 (Claude, MacBook) — M2 narrowed to one layer, again without touching hardware

Same move as the headset decode an hour earlier: **grep the captures before booking a bench session.**

**The gun is not the problem.** `2026-08-26-weapons-smg-plus-amr.btsnoop` (and the energy-rifle
capture) show the gun sending **one `$ALCD` per shot all the way to zero** — `9,8,7…1,0` at ~350 ms —
and then a *dry* trigger producing `$BUT,0,1/0` with **no `$ALCD`**. `$ALCD,0` exists and is sent. The
2026-08-30 observation that "ammo never once read 0" was an artifact of **2-second status sampling**,
not of the gun going quiet.

**The engine is not the problem either.** Replaying that exact cadence through the real `Engine`
produces `ammo 0`, `mag 32`, `alive true`, and the low-mag condition **armed** — the two values
`hud.js` uses for the RELOAD prompt and the solid/red empty state. Now a permanent test.

⇒ The remaining suspect is the **phone's transport/render layer**: ~7 BLE frames/second reaching a
WebView on an iPhone X while it paints. Either the notifications did not arrive, or they did and the
paint did not happen. **The "Share log" BLE frame ring separates those two outright** — that instrument
is still needed, but for a much sharper question than "which of three layers".

---

---

## 2026-09-01 (Claude, WSL) — the Windows lane of the post-match handoff, and the six-day-old ledger

No hardware. Everything here is code, docs and tests — `handoff-post-first-match.md` W1–W5, which was
written *because* the 2026-08-30 match found sixteen defects and **not one of them was found by a
test**. So the theme is the same one all the way through: make the machine check what a person had to.

**Suites: mcp 542 → 578 · MC console 0 → 66 (new) · app: the 54 engine tests and 9 transport tests
were already there but had no runner, so `npm test` is new and 4 of the 67 are (`mcurl`).**

`python3 run_tests.py` is green under system python too — and now *says* what it skipped rather than
counting it as passed: 578 with the extras, 535 + 43 skipped without. The old bare-`return` guards
made the two totals byte-identical, so "green under system python" was quietly meaningless for every
route test (review 2026-09-01).

### 1. Weapon numbers are now derived, not typed

The two worst defects of the field session were **numbers that disagreed with other numbers in the
same repo**: the AR shipped `rof: 53` against a derived 54, and `weapon-design.md` §2.2's DPS and
sustained-DPS columns went stale when the AR was retuned. Both are hand-maintained ledgers of what
the wire says, and nothing compared them to the wire.

`compile.WeaponCatalog` grew the derivation chain — `fire_ms`, `cycle_ms`, `rate_of_fire`,
`damage_bar`, `time_to_kill` — all computed from `resolve()`, the literal `$WEAP` frame MC pushes.
`test_weapon_derivations.py` then checks three ledgers against it: `weapons.json`'s five stat fields,
§2.2's whole balance table, and §2.5's hits-to-kill-at-four-health-configs table. Reintroducing both
historical defects fails the suite with the exact message you would want.

Two things the derivation had to learn, neither of which was written down anywhere:

- **A burst weapon's sustained cycle is `(2*t14 + t23)/3`.** t14 alone is the intra-burst spacing; the
  gun then waits t23. That is what §2.2 was calling "cycle 75 +275", and it is what the published
  `ttk_ms` was built from. 141.67 ms for the Burst Rifle, not 75.
- **A charge weapon pays for its FIRST shot.** For fire modes t20 ∈ {2 charge-auto, 3 charge-held,
  14 charge+heat} the TTK is `htk` cycles, not `htk-1`. That is the whole reason the Rail Gun
  publishes 1.20 s and the Laser Cannon 1.50 s while the Rocket Launcher — equally a one-shot kill —
  publishes 0.00. Five weapons' `ttk_ms` disagreed with a naive `(htk-1) * fire_ms` and all five are
  explained by these two rules; none of them was wrong.

At the default 115 pool every derived value reproduces the shipped one exactly, all 19 weapons.

### 2. Hits-to-kill follows the host, not a constant

`views.POOL = 115` was hardcoded, so ARSENAL and KIT quoted `HITS TO KILL 13 · TTK 1.68S` for the AR
whatever health the host had set — at a 100/100 game the real answer is 23 hits. `weapon_view(w, pool)`
now takes it, `Session.health_pool(player)` supplies it from `config.health` with per-player
`loadout.overrides` winning (exactly as `_gset` and `validate()` read them), and both screens name the
pool they are quoting.

The one stat that could **not** follow is `dmg`, because its definition *is* "share of a 115 pool".
The pool-independent number is `dmg_per_hit`, and `dmg_hit`/`cycle_ms`/`charged` on the catalog row
are what the view re-derives from.

A judgement call worth recording: the demo/fake catalog's `damage` is an old decorative 0–100 bar on
no scale at all (the AR reads 55). Reading it back as "share of 115" would give the AR a 63-damage
magnitude and a 2-hit kill — a *confident wrong number on the screen*. A row with no derivation chain
now scales its published `htk` by the pool ratio instead, which is honest arithmetic on a coarse
input. Same instinct as the retraction rule: prefer the coarse true answer to the precise false one.

### 3. The MC console has a test suite, and it found two live bugs

`webapp/mc` had `build` and `lint` and no `test`. It has 50 now (vitest + jsdom + the real React
renderer, ~1.4 s, no browser): every screen mounted three ways — a full session, an empty one, and
`state: null` — plus the specific 2026-08-30 regressions pinned where they broke.

On the **first run** it found two defects that were live in `main`:

1. **`CommandBar` still crashed on `PH[si][1]`.** The `PH[-1][1]` bug had been fixed on 2026-08-31 for
   the *view* label (that was the black ARSENAL page) — the *phase* label on the very next line was
   untouched, so any phase not in the six-entry table takes the whole console down, not just the tab.
2. **`Kit` called `useState`/`useEffect` below its `if (!state) return null`.** The render that first
   receives a snapshot then runs two more hooks than the one before it, which React throws on. It was
   latent only because `App`'s `Screen()` happens to gate on the same condition. **oxlint had been
   reporting it as an *error*, not a warning, the whole time** — the lint output was being read past.

That last one is the finding, not the fix: a lint error nobody reads is not a check.

### 4. The 2026-08-26 deferred-lows ledger, worked

Un-owned for six days. Now a table with an outcome per line in `FOLLOWUPS.md`: **15 rows, 14 fixed
and 1 deliberately kept** (CORS `*` — the phone app is a `capacitor://` origin and needs it; written
down as a decision rather than left as an accident). 11 of the 14 name a test; the rest are copy or
wiring changes with no sensible unit to pin. The three that turned out to matter most:

- **An `ammo_mult` perk could ship a gun one round short of what the HUD said.** `resolve()` floored
  odd reserves onto the `t17 == 2*t40` invariant; `spawn_ammo()` — which is what tells the phone how
  much ammo the player has — did not. The rounding moved into `_mods`, so both go through one place.
- **A restored session could arm two guns with the same `$PSET` player id.** `player_num` is the
  wire's player id, so a duplicate means every hit either gun takes is scored to whoever MC looks up
  first. `restore_snapshot` took the file's numbers verbatim and only re-derived them at the next
  config change. It repairs to unique 1..63 now, first claimant keeping its number.
- **`RECONNECT MC` did nothing at all after a discovery-only join.** It dialled `settings.mcUrl`,
  which a discovery-only connect deliberately never writes, so it returned on line 1. In the field
  that reads as "the button is broken", and it is the button you press when the link drops.

Also: the seven-file bench-frame copy-paste is hoisted into `mcp/tools/bench_common.py`, with a test
that fails if a frame is pasted back. Not tidiness — a run that re-tunes the arming config in one tool
and not the others measures two different games and reports one number. `ally_remeasure.py` keeps its
190 ms AR and shield-150 `$PSET` deliberately (the shield is its headroom, and a shield grant showing
up there is real evidence rather than the value we wrote); it is exempted by name and the test
requires the file to still say why.

### What did NOT move

**M1–M4 are untouched and still Mac-only.** The headset green flash, whether `$ALCD` stops under
sustained auto, how long a swap really takes, and the AR's identity all need a gun to answer. Nothing
in this session should be read as progress on any of them.

### Polish loop — what three reviewers found in the above

Worth recording in full, because the pattern is the point: **the review found more defects in the
fixes than the fixes had found in the code**, and three of them were tests that passed against
broken code — the exact failure this whole lane exists to prevent, committed while writing the
prevention.

Verified and fixed (each has a test that reproduces the defect):

1. **`damage_bench.py` died on import.** `NameError: name 'AR' is not defined` — I changed it to use
   the hoisted constant *after* running the import check that would have caught it. The tool would
   have failed at the bench, in the dark, with two taggers in hand.
2. **The test written for exactly that failure did not catch it.** It checked that the imports
   *resolve*, which is not the same as checking the file *runs*: the name was read at module scope
   above the import line. There is now a second test that walks each tool's AST in source order.
3. **W2 missed its own goal on the one perk that moves the pool.** `health_pool()` ignored
   `body_armor`'s `max_armor_add: 50`, which `_to_gc()` does write. A player holding it is armed at a
   165 pool while KIT quoted the AR at 13 hits / 1.68 s; the truth is 19 / 2.52 s. The whole claim of
   W2 was "the number on screen is the truth for THAT player". `health_pool()` is now pinned against
   the `$PSET` the compiler actually emits, so the two arithmetics cannot drift again.
4. **I re-introduced the refetch storm while fixing it.** Keying the armory fetch on
   `readiness.t` — which is `now_ms()` on every snapshot, pushed at up to 4/s — refetches ~4 times a
   second. That is the same bug the RECAP history picker had, documented two paragraphs above in the
   same diff. Both screens now key on a fingerprint of *which guns MC knows about*.
5. **The `state: null` test asserted nothing** and re-rendered a `<div/>` instead of the screen, so
   React never compared the two hook lists — the rules-of-hooks class was uncovered for 9 of the 10
   screens. Injecting a hook below `Live.tsx`'s early return left the suite green.
6. **Nothing imported `client.ts`,** so the suite had zero contract-drift cover for the route it was
   written to pin: rewriting `matchCsvUrl` to return `/api/recap.csv` — re-introducing the W1 bug
   against a real server — kept it green. There is now a test that parses the route table straight
   out of `api.py` and checks every URL the client builds against it.
7. **A latent `Designer` bug fell out of fixing (5):** `cfg` is a lazy `useState` initialiser, so
   mounting before the first snapshot captured `null` and the screen stayed blank forever. Same
   family as the KIT bug — state captured at mount and never reconciled.

Smaller, same spirit: the archived RECAP showed the *current* draft's mode, a live DATA SYNC board
and a "bring them into range to finalize" call to action over a match that ended hours ago; the
disabled PRIMARY button was 2.1:1 contrast while carrying the label the operator most needs to read;
the APK QR guarded on `lan.ip` being truthy when it falls back to `127.0.0.1`, so the real failure
still printed a QR for loopback; `RECONNECT MC` was still a silent no-op with no target at all; and
the even-reserve rounding was applied on the wrong axis (the code path rather than the invariant),
which cost a round on the legacy template path that has no `tok40` mirror to protect.

**The lesson to carry:** a test written in the same sitting as the fix tends to encode the author's
belief about the bug rather than the bug. Every test here now has a recorded mutation that makes it
fail — that step, not the test, is what makes it worth anything.

**Round 2 of the loop** (a third reviewer, on tests and docs, verified by mutating an isolated copy
of the repo 30+ times) found four more, all of the same family — *the check did not check*:

- **The §2.5 test silently skipped the Assault Rifle.** The row is labelled
  `Assault / Burst / Energy Rifle`; the parser split on `/` and dropped names that did not resolve,
  so it validated the Energy Rifle alone. My "every row must resolve" guard passed because *one*
  name matched. The weapon that W2, API.md and contracts.md are all about was never checked against
  the table W2 exists to honour. The row now carries full names and an unresolvable name is an error.
- **§2.5 had no completeness check** — deleting a whole row left the suite green. Adding one
  immediately found **two weapons missing from the table**: the Charge Rifle and the Stinger. Their
  rows are now in the doc, computed from the wire.
- **"13 of 14 fixed with tests" was false twice.** The ledger has 15 rows, and only 7 named a test.
  It now reads 14 fixed / 1 kept, 11 with a test, and the three without say why. Two of the missing
  tests were worth writing and now exist (NEW MATCH in-flight, the routable-IP guard); one claim
  with no test behind it — "a full disk is now a 503" — now has one.
- **"green under system python" was quietly meaningless.** The extras-dependent tests bowed out with
  a bare `return`, which the runner scored as a PASS, so the totals were byte-identical with and
  without starlette. Every route test in this diff executed nothing there. `run_tests.py` counts
  skips now: **578 with the extras, 535 + 43 skipped without.** CLAUDE.md's promise that they "skip
  cleanly" is true for the first time.

Plus two retraction-sweep misses on a fact W2 changed — `docs/spec/loadout.md`, the paragraph that
*defines* `WeaponView.htk`, still said "hits to drop a 115 pool"; and `app/src/hud/hud.js`, a **live
path**, printed HITS TO KILL with no pool beside it, so the phone showed a number whose meaning
silently changed between games while the two MC screens labelled it correctly.

**What the loop is actually worth, measured:** three reviewers found 9 defects in the fixes and 4 in
the fixes to the fixes, of which **six were tests that passed against broken code**. Every one was
written in the same sitting as the code it covered. The habit to keep is not "write a test" — it is
**break the code and watch the test fail**, every time, before believing it.

### Round 3 — the reviewers found the fixes to the fixes wanting too

Two more rounds ran against the round-1 fixes. The pattern held: **my fixes were wrong more often
than the code they fixed.**

- **The `allowAssist` fix did not close the hole it claimed.** The guard reads
  `(allowAssist || !settings.mcUrl)`, and a discovery-joined phone *never* writes `settings.mcUrl` —
  that is what `remember=false` means. So exactly the phones the fix was for could still be re-bound
  to a second MC on any momentary drop. Worse, clearing the flag on bind made it *one-way*: its only
  opener was a one-shot 15 s boot timer, so after the first bind discovery could never rescue a
  phone again — the case where MC restarts on a new IP mid-match. Both fixed; assist now re-opens
  after any 15 s spell unbound.
- **The archived-CSV download was written to be cancelled.** It revoked the object URL synchronously
  after clicking a *detached* anchor — Safari and Firefox routinely drop that, and the match-day
  host is a MacBook. The anchor is attached and the URL revoked late now. The broad `try` around it
  was also reporting a code bug to the operator as "MC UNREACHABLE"; the catch is narrowed to the
  fetch.
- **`validate()` was a THIRD pool arithmetic.** After unifying `health_pool()` with `_to_gc()`, the
  `mag >= htk` gate still had its own — missing the perk and the 255 cap, and grading the *catalog*
  magazine rather than the one an `ammo_mult` perk actually grants. All three agree now, pinned by a
  test that reads the pool straight off `$PSET`.
- **The bench no-paste rule exempted a whole FILE.** `ally_remeasure.py` deliberately varies its AR
  and `$PSET` — but the exemption covered every frame, so its `$GSET` drifted unguarded. Exemptions
  are per-frame now, and narrowing it immediately caught a `$GSET` literal in that file.
- **`_repair_player_nums` could delete players.** Its free-number generator started at
  `player_num_base`, so a high base made the RESTORE path drop real players while 1..base-1 sat
  free. The live add path may refuse; a restore may not.
- **`resume_mdns()` had no caller**, so the abort latch was still one-way and a restarted NetServer
  would never advertise again — the guard was half applied.

Two reviewer claims did **not** survive checking, and are worth recording because taking them on
trust would have made things worse: `URL.createObjectURL` is *not* missing under vitest+jsdom here
(Node provides it, `blob:nodedata:…`), so a stub would have been dead code testing itself; and the
`raw.split("\n", 1)[-1]` partial-line drop genuinely *cannot* be isolated by a test, because the
`except ValueError` guard already covers every realistic torn line — it is documented as deliberate
redundancy rather than given fake coverage.

**Final tally across three rounds: 5 reviewers, 19 defects in the fixes, 7 of them tests that passed
against broken code.** Every test in this diff now has a recorded mutation that makes it fail.

---

## 2026-09-02 (bench, Tony firing) — ✅ BENCH 0.1 CLOSED: the fn 36 / 37 `$SIR` multipliers are REAL

**Result: fn 36 = floor(magnitude x 1.25) · fn 37 = magnitude x 2.**

**Design.** 16 trials across **4 magnitudes** and **8 different `$SIR` row-tail shapes**. Every trial
carried an **fn 1 control on subtype 0** that had to read *exactly* the magnitude, or the trial was
voided. That is the control this question needed: the 2026-08-27 dispute existed precisely because two
runs disagreed with no per-trial control tying them together.

| magnitude | control fn 1 | fn 36 | fn 37 |
|---|---|---|---|
| 20 | 20 | **25** | **40** |
| 40 | 40 | **50** | **80** |
| 9 | 9 | **11** | **18** |
| 7 | 7 | **8** | **14** |

**The multiplier TRUNCATES, it does not round.** Magnitude 7 is the trial that settles it: 7 x 1.25 =
8.75 landed as **8**. Every prior discussion of these multipliers assumed exact arithmetic; hits-to-kill
for fn 36 weapons must be computed on the floor.

**NEGATIVE: the row's trailing tokens do not gate the multiplier.** Tails `0,0,1,,` / `,,,,` /
`0,0,0,,` / `0,0,2,,` / `0,1,1,,` / none / `0,0,1,60` **all** produced x1.25 and x2. That kills the
leading remaining hypothesis for why the 2026-08-27 matrix read x1.0.

**SCOPE.** Measured through **our** `$SIR` table. The victim's row is what picks the function, so this
is a statement about the configuration we ship, which is also the one whose numbers we would publish.
Whether stock BRX pushes the same table in every native game is a separate, still-open question.

#### Honest close: what is still unexplained

The **2026-08-27 "controlled matrix"** read **x1.0 in all 24 multiplier cells with a valid fn 1
control**. We still do not know why. It is **outvoted, not explained** — two independent runs
(2026-08-26 and this one) agree against it, and this one carries a per-trial control and varies both
magnitude and row shape, so the weight is decisive. But no systematic difference between the runs has
been found, and the earlier session-quality hypotheses (held gun vs bench gun, sensor struck) are now
unsupported for the multipliers specifically. Recorded, not buried.

Retracted by this entry: the "do not use x1.25 / x2 for weapon tuning" instruction from the 2026-08-27
dispute, and the reading of the x2 result as one of "two results from the same context that failed to
reproduce". What still stands from those entries: the **emitter exoneration** (it is function-agnostic,
so an encoding fault cannot masquerade as a multiplier), and the single remaining non-reproduction,
**fn 24 dealing damage on protocol 7**.

Propagated the same day into `protocol/brx-protocol.md` §5 + §7r, `docs/weapon-design.md` §0/§5 U10/§6.2,
`docs/manual/06-developer.md` + `03-gameplay.md` + `07-platform.md`, `docs/unknowns.md` Q14,
`docs/gotchas.md`, `docs/HANDOFF.md`, `docs/FOLLOWUPS.md` Q14 + P10, `docs/bench-tomorrow.md` 0.1,
`docs/bench-hour-2026-09-01.md`, `docs/spec/contracts.md` + `loadout.md`, and `mcp/brx_mcp/mc/compile.py`.
**`hits_to_kill()` still computes on raw t5 and therefore over-estimates htk for the five fn 36/37
weapons** — the behaviour was left alone deliberately; the docstring and the `validate()` warning now
say so.

### 2026-09-02 (evening) — 🔴 THE IR RECEIVER FRAGMENTS FRAMES: our emitter is clean, board A is not

Ran the loopback rig check the handoff asked for, before touching a tagger. It did not go where I
expected, twice.

**Emitter -> receiver, known 25-bit word, 20 shots:** 4 decoded whole, 16 failed. But every single
one of the 20 delivered **exactly 52 edges** — a complete word — split across 1-4 bursts, and the
first fragment always decoded a correct PREFIX of what we sent. Nothing is lost in the air. The
board chops the frame up and then fails each piece.

**Control that settled it:** Tony fired a REAL BRX GUN at the same board. It fragments identically —
44 bursts, 3 decoded whole, fragments pairing to 52 (18+34, 43+9, 24+28, 6+46, 15+37). Real guns hit
real taggers, so this cannot be a property of the transmission. **The receiver is the broken part;
our emitter is clean at 20/20 full frames.**

⚠️ **Retracted mid-session: "the emitter is stalling mid-frame."** I reasoned that serial printing can
only *merge* frames and never split one, so a split had to mean genuine IR silence, so the emitter
had to be stalling — and I went further and said this probably explained the whole F11 afternoon. The
logic is fine and the conclusion was wrong. The real-gun control killed it in ten minutes. **Cost of
not having run that control first: an entire afternoon of tagger hypotheses.** It is the cheapest
control on this bench and it was available the whole time.

**Suspected cause, NOT established:** VS1838B AGC blanking. The part is built for short bursts and
desensitises under sustained carrier, which fits Tony's observation that the boards stopped working
when they were too close. One anecdote, no measurement. Written up as **F12** with a cheapest-first
plan (move the receiver back and re-run before changing any code).

**Consequence for the grenade:** F12 blocks it. `IDLE_GAP_US` was raised 8 ms -> 30 ms on 2026-08-27
*specifically because the `$GREN` accessory word was splitting*, and it is still splitting. Long
words are this bug's worst case, so anything captured from the grenade on this board today would be
fragments recorded as facts.

**What we salvaged, and it is the useful half.** The edge COUNT survives the fragmentation perfectly.
So the receiver is unusable as a decoder but excellent as a **witness**: "did a full frame's worth of
light arrive at the victims' position?" Both controls run before trusting it —

| control | result |
|---|---|
| firing (must all say yes) | **6/6** |
| quiet (must all say no) | **0/6 false alarms** |

That is the instrument today's F11 work never had. With it, "both victims silent" finally splits into
"the emitter did not fire" and "both taggers are deaf" — two things that were confused for each other
all afternoon. `f11_ab.py` now grades every shot with it and marks unwitnessed shots **VOID** rather
than counting them as misses, because a shot that was never fired at anyone is not a miss.

**Two tool bugs found and fixed on the way, both of which fake a negative result:**
- `loopback.py` probed the receiver with `PING`. The capture firmware does not implement it — only
  the emitter does. A perfectly good board reported as dead.
- `irbridge.parse_frames()` drops any `DECODE` line not preceded by a `RAW` line, and the firmware's
  `r` toggle turns `RAW` off and *persists until power-cycle*. With RAW off, a perfectly received
  shot decodes and is then silently thrown away. Bench tools now read the `DECODE` line directly.

Also: non-ASCII in bench-tool output aborts the run on this cp1252 Windows console, and both new
tools ran their `main()` at import. Fixed; entrypoints are guarded now.

### 2026-09-02 (night) — ⭐ `$HIR` IS HONEST. BLE IS BLIND IN A NATIVE GAME. THE WITNESS IS NOT A SENSOR.

Three findings, each of which invalidates a class of measurement we had been making all day.

## 1. ⭐ `$HIR` does NOT reach BLE unless OUR game state is applied

A gun running its own **native FFA** registered hits, flashed its headset and took damage while
sending **nothing at all** over Bluetooth. `native_watch.py` reported `0/11` and Tony, watching the
hardware, reported *"it seemed to get hit every time"*.

**So BLE silence has never meant "not hit".** Every "deaf tagger" conclusion drawn from an absent
`$HIR` on a gun that was not in our game measured our own blindness. That includes phases A and B of
`deaf_catch.py`, which print zeros and present them as evidence — the tool is wrong and says so now.

## 2. ⭐ Inside our game, `$HIR` is EXACTLY honest — three channels, three matching counts

10 witnessed shots, geometry unchanged, gun armed and spawned by us:

| channel | count |
|---|---|
| operator counting headset flashes | **4** |
| `$HIR` frames over BLE | **4** |
| `$HP` pool drop (70 -> 66) | **4** |

Independent detectors, exact agreement. **There is no under-reporting**: the gun applies precisely
the hits it reports. The Mission Control scoring worry this test was built to check is dead — MC can
trust `$HIR` inside a game it started.

## 3. ⚠️ THE WITNESS PROVES PHOTONS AT A POSITION, NOT A HIT ON A SENSOR

The same run: **10/10 witnessed, 4/10 registered.** Six shots the receiver heard clearly never reached
the tagger's dome at usable strength. The witness board is a bare VS1838B aimed squarely at the
emitter and is far more sensitive than a headset dome — so "the witness heard it" and "the tagger was
hit" are **different claims**, and this evening they were used interchangeably, by me, repeatedly.

The witness is still the right instrument for what it actually proves (the emitter fired, photons
reached that position) and it correctly voids un-fired shots. It just cannot certify a hit.

## What this does to F11

Most of it dissolves. The "deaf tagger" was, in varying proportion: BLE blindness on a natively-
running gun (finding 1), and a marginal synthetic emitter whose shots the witness hears but the
tagger's dome does not (finding 3). Neither is a fault in the tagger.

**What is NOT explained:** `f11_ab` measured **16/16** earlier in the same session at the same
distance with the same geometry, and this run measured **4/10**. Tony confirms the headset has been
3 ft directly facing the emitter all day and was not moved. A 100% run and a 40% run under
identical conditions is still unaccounted for, and no hypothesis is offered here.

**Next control:** fire a REAL BRX gun at the same headset from the same 3 ft and count `$HIR`. Same
target, same geometry, same detector, only the emitter changes. 10/10 says our ESP32 emitter is
simply weak (see R2/Q15 on IR power) and closes this; ~4/10 says the tagger really does drop shots
at 3 ft and something real remains.

### 2026-09-02 (late) — F11: SEVEN hypotheses eliminated by controlled test. The fault is real and still unexplained.

The night's work on the intermittent no-registration fault. **Nothing here explains it.** What this
entry is worth is the elimination list: every item below was tested, not argued, and none of them
should be re-run tomorrow.

## Eliminated, with the test that did it

| hypothesis | how it died |
|---|---|
| our emitter stalls mid-frame | a REAL BRX gun fragments identically at the receiver (44 bursts, 3 whole) |
| `$GLED` frames deafen it | 12 suspects sent to a verified-working gun, one at a time: **78/78 registered** |
| deaf in its native game | operator saw it hit every time; BLE simply cannot see a native game |
| headset orientation / geometry | unmoved all day, 3 ft directly facing, across every run |
| the `$SIR` table size | interleaved A/B, full 10-row vs 1-row: **24/24 both arms** |
| `$STOP` triggers it | its own volley read 6/6, and every recovery rung after it read 6/6 |
| losing the BLE link triggers it | 3 rounds: 18/18 connected, and BOTH headsets flashed on every disconnected shot |
| a weak emitter (marginal margin) | a NATIVE gun beside it registered the SAME shots 24/24 |

Also eliminated earlier the same day: arming order, spawn state, team gating, death/respawn, battery
charge, tagger uptime, receiver adaptation, and `$GSET outdoorMode`.

## What the fault actually looks like, now that it has been seen with instruments

It is **BIMODAL, not marginal**. Working is 16/16, 24/24, 78/78. Broken is **0/22 with no headset
flash at all**. There is no smooth degradation between them, which is why every "signal strength"
story fails.

⚠️ **The strongest constraint, from Tony, and it kills the tidiest explanations:** yesterday's phone
HUD game failed to register hits **point blank with the phone connected**. So the fault occurs with a
live BLE link, at zero range, in a normal game. Any hypothesis that requires a disconnect, distance,
or an exotic frame is already refuted by that.

## Method note — the actual lesson of the night

Six explanations were stated confidently and killed by a control, usually within minutes: emitter
stall, `$GLED`, native deafness, geometry, `$SIR`, `$STOP`. Every one came from a SINGLE run on an
intermittent fault. Tony's question — *"why do you keep getting these conclusions wrong??"* — has a
precise answer: **n=1 is worth nothing here**, and each n=1 was being reported as a cause rather than
as a lead. The rule this earns, on top of the same-burst rule from earlier today:

> **On an intermittent fault, nothing is a cause until it has been reproduced on demand.**

## The one thing left to try

A **soak**: repeat volleys for a long time with pools topped up, logging the rate per volley with
timestamps, and catch the transition happening. Both deaf episodes tonight followed long runs
(`deaf_catch` after a full session, the deaf state after `deaf_bisect`'s 78 shots). That is a
suggestion of accumulation, not evidence of it -- but it is the only untested shape left, and it is
the one thing a machine can do unattended.

### 2026-09-02 (end) — death/respawn TESTED (not assumed) — and the deaf state can no longer be reproduced at all

## Death -> respawn does not do it

25 cycles: verify with witnessed shots -> kill outright (mag 200) -> respawn with MC's real
`RESPAWN_SEQUENCE` (`$HLOOP,0,0,*`, `$SPAWN,,*`) -> verify again. 7 minutes.

**198/200 shots registered.** It registered before every kill and after every respawn, every cycle.
Two cycles read 3/4; none read 0.

This matters because "death/respawn" was written off earlier the same day **without ever being
tested** — every experiment used magnitude 1 *specifically so nothing would die*, which designed the
suspected condition out of the entire session and then recorded it as eliminated. It is now tested.
(`mcp/tools/death_soak.py`.)

## Battery is ruled out by evidence already in hand

The gun volunteered `$VOLTS,8429,4164,100,100` **during** the 0/22 deaf run — gun 8.43 V, headset
4.16 V, both at 100%, while it was deaf. No new test needed.

## The fault cannot currently be reproduced by anything we can do

Healthy across everything since: 78/78 (bisect), 24/24 (`$SIR` A/B, with a native gun beside it also
24/24), 18/18 (link toggle, plus a flash on every disconnected shot), 198/200 (death soak). Every
deliberate attempt to induce it has failed.

**So the honest position is: the fault is real, it has been seen with instruments (0/22 with no
headset flash, alongside a native gun taking the same shots), and NOTHING we know how to do brings it
back.** It is not a config state, not a frame we send, not the link, not the battery, not death, not
distance, not geometry, not the emitter.

## Where it clustered, which is the only lead left

Tony: *"it kept dieing when we would line up to do the led f1."* The episodes clustered around the F1
gauge-hunt work — which damages toward ~30% and overshoots into kills — and around long runs. But the
death soak just failed to reproduce it in 25 clean cycles, so "death" alone is not the ingredient.
Something about that fuller context is, or the trigger is rarer than a 7-minute soak.

**Next session should NOT re-run any of the fifteen eliminated hypotheses** (this entry plus the two
above it). The remaining approach is a long unattended soak under conditions closer to the F1 work —
repeated arm / damage / kill / respawn / re-config cycles over tens of minutes — with the run halting
and preserving the state the moment registration collapses.

### 2026-09-02 (night, last) — ⭐ REPRODUCED ON DEMAND: respawning within ~2 s of death WEDGES THE HEADSET

The first thing all night that fails when we ask it to. Tony's hypothesis, Tony's mechanism.

## The measurement

Kill the gun outright (mag 200), wait `gap`, send MC's real `RESPAWN_SEQUENCE`
(`$HLOOP,0,0,*`, `$SPAWN,,*`), then look at the headset. Identical script every trial; only `gap`
changed. Operator reports the headset; the gun is read over BLE.

| gap after death | headset | gun (`$LCD`) |
|---|---|---|
| 1.0 s | 🔴 **stuck in the out-blink** | 45/70 — alive |
| 2.0 s | 🔴 **stuck in the out-blink** | 45/70 — alive |
| 2.5 s | ✅ dark (correct) | 45/70 |
| 3.0 s | ✅ dark (correct) | 45/70 |
| 6.0 s | ✅ dark (correct) | 45/70 |

**Monotonic, both directions, five trials. The threshold is between 2.0 s and 2.5 s.** In the wedged
state the gun reports full pools and registers hits normally (8/8 measured, `$HP` decrementing) —
only the headset's presentation is wrong. So it is a DISPLAY desync, not a loss of function.

## The mechanism — Tony's, and it generalises

> *"the ir signal on the tagger needs to bt connect to headset to give it command, headset has to
> receive, process, and execute command. I think any commands that have to be executed by tagger, but
> ALSO executed by headset need a safe processing gap."*

The headset is a SECOND DEVICE behind a relay. `$SPAWN` has to reach the gun, be relayed, then be
received, processed and executed by the headset — and if it arrives while the death sequence is still
running there, it is lost. The gun's own state updates regardless, which is exactly why the two ends
disagree.

**This is not specific to respawn.** It applies to anything with a headset-side effect: `$SPAWN`,
`$HLOOP`, `$HLED`, and plausibly hit processing.

## ⚠️ Severity — CORRECTED, and lower than first stated

Mid-session this was called a live-match bug that would "wedge headsets routinely". **That was wrong.**
`GameConfig.respawn_s` defaults to **15 s**, six times the threshold, so a default MC match never
respawns fast enough to trigger it. What triggered it here was BENCH tooling respawning instantly —
`death_soak.py` used a 1.4 s gap, which is why 25 cycles left the headset wedged.

What survives as real work:
- **A floor on `respawn_s`.** Anything below ~3 s is unsafe, and nothing currently stops an operator
  setting it there.
- **Frame pacing for headset-side commands is UNVERIFIED at our current spacing.** `arming_frames`
  sends at **0.12 s** and MC compiles FrameBundles as bursts. Frames are not DROPPED at that rate —
  measured separately tonight, echoes 20/20 at every spacing from 20 ms to 500 ms — but an echo
  proves RECEIPT BY THE GUN, not execution by the headset. That distinction is the whole finding
  here, and the arming burst has never been checked against it.

## Method note

Five trials, alternating outcome, one question to the operator per trial. Earlier in the session the
same question was asked with eight frames sent back-to-back and no chance to answer between them,
which destroyed the answer — Tony: *"well you didnt follow the protocol and let me type did you?!"*.
One change per run, then stop and ask. That is what made this measurable.

### 2026-09-02 (night, last) — MC's REAL zero-gap arming burst: TESTED, and it is fine

Every bench tool this session armed with `bench_common.arming_frames` at **0.12 s** between frames.
MC's driver has **no sleep anywhere** — `setup_frames()` then `spawn_frames()` go out back-to-back as
fast as BLE accepts them, and `resetup()` does the same mid-match after a reconnect. So all fifteen
F11 hypotheses had been tested against a GENTLER setup than the one we ship, and the shipped one had
never been on the bench.

`mc_burst.py` arms with the REAL frames from `GameConfig` (not a bench copy — the point is to test
what ships), interleaved A/B, 2 s equal settle for both arms before any shot:

| arm | rate | sensor |
|---|---|---|
| **ZERO GAP** (exactly MC's driver, 32 frames back-to-back) | **24/24 — 100%** | dome0 |
| **SPACED** (same 32 frames, 0.30 s apart) | **24/24 — 100%** | dome0 |

**No difference.** The zero-gap burst is not the trigger, and `$AMMO`/`$AMMO`/`$BMAP` landing
immediately behind `$SPAWN` does not harm hit registration.

This is a NEGATIVE result worth having on two counts: it removes a live suspect, and it is the first
hardware validation of **MC's actual arming path** rather than the bench's slower imitation.

⚠️ What it does NOT clear: it only measured **hit registration**. The respawn finding above was a
**display** desync, and this run did not check headset LED state across the two arms. A burst could
still land headset presentation wrong while hits keep working — that is exactly what the wedged
out-blink was.
