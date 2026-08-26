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
- cell **3.675 V → t3=42, t4=29** (R0BP1, this session)
**token4 is NOT constant** (earlier "fixed 76" guess was wrong) — it swings strongly with **cell voltage**
(76 @ 3.96 V → 29 @ 3.68 V), a plausible Li state-of-charge curve; **token3 stayed flat (43→42)** across the
same swing (and earlier rose 43→44 while charging). **Leaning:** t4 = a finer cell-voltage state-of-charge,
t3 = a coarser/pack-level metric. Not conclusive — needs a **controlled single-gun charge/discharge sweep**
watching both tokens to decide which is the "real" charge %.
**Fleet battery reliability = poor (confirmed):** a 4-gun `fleet` caught battery on only **1/4** (R0BQT not
found; R0BAS −63 & R0BAT −84 connected but missed `$VOLTS`). The random ~6.6 s client drop vs the 30 s VOLTS
cadence makes the serial one-shot sweep unreliable → a **persistent-connection fleet** (hold links, collect
VOLTS as they stream) is the fix for a live dashboard. Not RSSI-pure (R0BP1 −70 got it; R0BAS −63 didn't).

### 2026-08-25 — 🎯 FIRST LIVE M0 GAME (Session A) — the engine works on real guns ✅
Ran `play tdm D9:50:2F:98:FE:30 DF:F5:DA:08:94:98 game_time_s=120 respawn_s=10 frag_limit=3 volume=69`
(R0BAS team1 vs R0BP1 team2). **Full game, end to end, on real hardware:**
```
game live: {...}                       # config-all-then-spawn barrier → both live together (B10)
🎯 team1: 1   ↻ respawn R0BP1           # R0BAS tagged R0BP1; host-respawn brought it back
🎯 team2: 1,2,3   ↻ respawn R0BAS ×3    # R0BP1 tagged R0BAS 3×, each respawned
🏆 GAME OVER — team2  scores={1:1, 2:3} # frag_limit=3 → correct winner
```
Final scoreboard: R0BAS 1 kill/3 deaths, R0BP1 3 kills/1 death. **Validated: config barrier, real
`$HIR`/`$HP,0` kill scoring + team credit, host respawn, frag-limit end + winner — AND the BLE link held
the entire match (Tier-0 direct BLE sustained a 2-gun game, no mid-game drop).**

**Resilience bug fixed (Tony: "our scripts need to be more resilient than that"):** the FIRST attempt
crashed mid-score — the 🎯 emoji in the scoreboard hit the Windows console's cp1252 codec
(`UnicodeEncodeError`, which is a `ValueError` → main swallowed it into a usage dump). Root-caused the
whole class: `main()` now `reconfigure(encoding="utf-8", errors="replace", line_buffering=True)` on
stdout/stderr — no glyph can ever crash a command again, and live output streams in real time; the driver
announcer also flushes. (This is the 3rd time this cp1252-glyph class bit us — now killed at the source.)
Not exercised yet: time-limit end, respawn ramp.

### 2026-08-25 — teardown bug: dead gun left stuck; fixed the game-over sequence (live, on R0BAS)
After the first live game, the loser (R0BAS, dead at frag-limit) was left **stuck showing the death-glow** —
the old `END_SEQUENCE` (`$HLED,,6` + `$STOP` + `$CLEAR` + `$PLAY,VS6`) never REVIVES a gun that's dead at
game end. Dialed in the fix live against R0BAS (Tony observing each step):
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

### 2026-08-25 — D4 probe (bench, R0BAS vs R0BP1): NO shooter-side kill event on BLE
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

Big session, 3 guns (R0BAS/FE30 shooter, R0BP1/9498, R0BQT/E20D). Multiple prior conclusions
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

Ran the single-gun **Companion/HUD node** on two phones at once — **Pixel → R0BAT** and
**iPhone/mac build → R0BQT** — each phone driving **only its own gun** over BLE (no one-phone-two-gun
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

## 2026-08-26 (bench, handoff experiment 3) — $SFLASH validated from OUR stack

Bare `$SFLASH,*` sent to an idle, unspawned gun (no game state, `mcp/tools/sendframes.py`):
**the sight goes GREEN and stays green for several seconds** — it latches; three sends ~0.5 s apart
read as one continuous green. No wire reply. So the frame decode (§7o) is correct, no game state or
companion frame is required, and the engine's `KillConfirm → $SFLASH,*` path is validated end-to-end
(B18 visual half REAL). Single-send duration not yet isolated (needs one send + a stopwatch).

## 2026-08-26 (bench, handoff experiment 2) — `$HIR` t5 = applied damage (EXACT); armor model pinned; new tok2/tok7 decodes

Two real guns, victim rebuilt to a full 45/70 before each single shot (`mcp/tools/damage_bench.py`).
Resolves the `t5`=damage question (was "unresolved" in `weapons.md` / `protocol-classes.md`) and P10.

**`$HIR` token 5 = the applied damage, EXACT — 4 of 4 across the range:**
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
properly re-armed (spawned, team 1, full `$SIR` table), R0BAT on `$TID,2` mag-dumping produced **5 clean
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
fire — is also resolved below (wrinkle a): it is **not** IR-enforced.

**Sub-open (a) — friendly fire — RESOLVED: FF is NOT IR/firmware-enforced.** Same-team damage landed
under BOTH `$GSET` token-1 values: FF=0 (the 4v4 / 63v63 phases above) and a follow-up **FF=1** probe
(both guns team 1, `$GSET` token1=1, several shots → **7 registrations**, `$HIR,4,0,5,1,9,0,0`). So
same-team hits **always** damage on the wire; the native game's "FF off" must be **app-side bookkeeping**,
not a gun behaviour — exactly how our MC scorer already works (it tracks `friendly_kills` separately). ⇒
`$GSET` token 1's on-gun function reverts to **UNKNOWN**: the teardown's `friendlyFire` label names the
*app setting*, not a gun-enforced behaviour (see the GSET map caveat). All four handoff experiments closed.

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

After ~a full day powered, R0BQT stopped holding BLE: two connect-then-drop-mid-config failures,
then connect attempts that hang entirely while the gun ADVERTISES normally (-70 dBm) — battery
confirmed fine, power cycles only briefly helping. Matches the community-documented **"SCREAMERS"
behavior (BLE drops / random fail after ~1 hr sessions; B1 hardware notes)** — first time we've
reproduced it. Operational rule for match days: rotate/power-rest guns, don't leave the fleet
powered all day. U6 (damage-type reactions), U9, U5, U2 remain queued in FOLLOWUPS — all need two
healthy guns; methods written.

## 2026-08-26 (bench) — U6 CLOSED: damage types = victim-side presentation + wire metadata

Clean single-timeline hit tests (mcp/tools/hittest.py, R0BAS shooting R0BAT), same 9-dmg AR with
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
earlier. Verdict: rig degradation (R0BAT ~12h powered — the night's SECOND screamer-family failure;
emitter or receiver side unresolved), so the t41=5 zeros are unattributable. **U2 stays OPEN.**
Method for a fresh fleet (worth 10 minutes): same-spot A/B, t41 100 vs 5, counted windows both sides.
Fleet ops rule reinforced: POWER-REST GUNS — a day-long bench session degrades them below usability.
