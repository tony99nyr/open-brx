# Experiment log

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
`QUERY` dumps: versions, `Serial Number/Head PIN: R0BQT` (matches the headset sticker),
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
| `$SFLASH,*` | sent periodically by the app, no args, never near a hit | try it in isolation and watch the gun |
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
