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
fixed and it *still* failed the control. No SD card exists to read instead (§7h).

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
