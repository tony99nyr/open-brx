# Handoff — Open BRX

**Updated:** 2026-08-23, end of the MacBook session. Read `CLAUDE.md` first, then this,
then `docs/experiment-log.md` (shared lab notebook — **append after every session**).
Protocol ground truth: `protocol/brx-protocol.md`.

> **⚡ LATEST (2026-08-25) — read the newest `experiment-log.md` entries before hardware work.**
> (1) **The feedback fork is resolved, then resolved AGAIN in our favour.** A BLE-only Mission Control
> gets the **full native feel including the green sight** — the Callsign capture (`cap8`) showed the
> app has no nRF radio either: it scores on the phone and sends **`$SFLASH,*`** (the green-sight
> kill-confirm) plus **`$PLAY,,4,6,<id>,,,,*`** (the announcer slot) over plain BLE. **The earlier
> "green-sight is nRF-only" call is WRONG — it probed `$GLED`, the wrong command.** See
> **`protocol/brx-protocol.md` §7o**. There is **no
> hidden enabler frame** — Callsign's arm is byte-identical to ours — and none is needed.
> (2) **Headset-present is a hard pre-game join-gate** (**B18b**) — a dark headset silently blocks a
> gun (the real cause of "only 2 of 3 armed"). (3) **Direct-BLE 3-gun synced arm is HW-proven**
> (**B10**) — the old "pilot-only" call is dead. (4) **The BRX IR shot protocol is decoded**
> (`protocol/brx-ir-protocol.md`) — per-player id is in the IR.
>
> **UPDATE 2026-08-25 (later): P2 is CLOSED — `$PSET` token 1 sets the player id, `$HIR` token 3 reads it (§7p/§7q). No stock-feel gap remains over pure BLE; the IR/nRF bench is for stations, not attribution.**
> ~~**Per-player attribution (P2) is now the ONLY stock-feel gap over pure BLE**~~ (`$HIR` names the
> shooter's *team*, not the player). Re-scope the IR/nRF bench around that alone — not around
> feedback, which BLE now covers. Bench plan: `docs/bench-plan-hardware.md`.

## Machine roles (NEW — this changed today)

| Machine | Role | Notes |
|---|---|---|
| **Windows PC (WSL2 + Windows Python)** | **primary development** | Code, protocol work, Android-side captures. |
| **MacBook** | **field / match day — AND the only capture rig** | Goes to the field with the taggers. Keep `mcp/` working here. |

**Only the MacBook can capture the official app.** Callsign works on **iOS only** (it has
never worked on Android), iOS Bluetooth traces need **PacketLogger**, and PacketLogger is
**macOS-only**. So every "capture what the real app does" task — including the `$GSET`
capture work — **must happen on the Mac**. Windows cannot do
it. Plan accordingly: batch up capture work for when the Mac is available.

PacketLogger is already installed at `/Applications/PacketLogger.app` and the iPhone X
already has Apple's Bluetooth logging profile. Flow: plug the iPhone in via USB (it needs
a hub — the Mac has no USB-A), **File → New iOS Trace**, confirm lines are scrolling
*before* playing, then **File → Export → btsnoop**. Decode with
`python -m brx_mcp.btsnoop <file>`. Two traps that cost us a capture each: export acts on
the **frontmost** window (easy to re-export an old trace), and a trace that is not actually
recording produces a silently useless file.

`CLAUDE.md`'s cross-platform rule matters more than ever: **code must run on both.**
macOS gives BLE **UUIDs**, Windows/BlueZ give **MACs** — never pattern-match address
format. (A bug exactly like that shipped today and was caught only by asking "will this
run on Windows?" — `_split_addrs()` in `__main__.py` now handles both.)

## Where the project stands

**Remote game start is solved and implemented.** Our own software configures taggers,
takes them live, runs a timed match, tracks hits and deaths, and drives respawns. Verified
on hardware across several matches, including two taggers driven simultaneously from one
laptop with a synchronised start.

**Current state (2026-08-25):** the platform is now a Mission Control host on a local Wi-Fi LAN
(WebSocket, not MQTT) that compiles a per-player `FrameBundle` (`mcp/brx_mcp/mc/compile.py`), plus a
native Capacitor phone node (Web Bluetooth is dead — `adr/0003`). Software is **built + tested (438
tests incl. 12 e2e)**; the **MC↔phone field path is UNVERIFIED on hardware.** The authoritative spec
set is **`docs/spec/`** (roadmap + `mission-control.md`) and the ADRs (`docs/adr/`); the open hardware
proofs are in **`docs/verification-checklist.md`**.

Working CLI:

```
scan [s] · identify <addr> · listen <addr> [s] [pair] · probe <addr> [s]
startgame  <addr> [seconds] [respawn_s] [volume]
deathmatch <addr> [minutes] [respawn_s] [volume] [weapon]
arena      <addr...> [minutes] [respawn_s] [volume] [weapon]
fieldstart <addr...> [volume] [weapon]      # configure + spawn, then disconnect
fieldresults <addr...> [listen_s]           # reconnect afterwards
```

Weapons: `primary` / `secondary` / `melee` (verified on hardware) · `ar` / `charge`
(from the §6 doc, **never fired — unverified**).

## ANSWERED (2026-08-23 night): BLE cannot support out-of-range play

**Read this before planning anything else. It closes what were the top two open questions
and it invalidates part of what is built.**

A field test proved taggers **keep playing with no host connected** — but nothing respawned
and the round never ended. The plan was to decode `$GSET` and configure those on the gun.
**That plan is dead:**

- **Respawn and game time are not in the protocol stream at all.** Three captures with
  respawn 15 / 30 / 5 produced **byte-identical** `$GSET` *and* `$PSET` (§7n). A 1-minute
  clock produced the same `$GSET` as a default one. Callsign keeps the clock and drives
  respawn itself — the manual lists both as *on-gun menu* settings, and the app simply
  never uses that path. **No capture will ever reveal a command for it. Stop looking.**
- **The gun keeps no score.** A complete game ending was captured: the app sends
  `$VOL` → `$HLED` → `$STOP` → `$CLEAR` → `$PLAY,VS6` and **never queries the tagger for
  anything**. That explains `$UP,*`'s silence (§7l) and why reconnecting after a field game
  produced zero frames. The phone tallies `$HIR`/`$HP` live and is the only place a score
  has ever existed.

**So this is a design property, not a missing command.** Anything needing respawn, a clock,
or scoring requires a host in BLE range **for the whole match**. That is why the official
system gives every player their own phone.

### What this means for the code

`arena`'s host-driven respawn works only in range. It is a correct demonstration of the
protocol and a **wrong design for field play** — do not build further game logic on it
without deciding the transport question first.

### Attribution + feedback are BLE-native (the old nRF "critical path" is retired)

The framing that once lived here — *"the nRF radio is the new critical path"* — is **dead.**
Per-player attribution is BLE-native (`$PSET` token 1 sets player_num, `$HIR` token 3 reports the
shooter — §7p/§7q), and native kill feedback (green sight + announcer) is host-driven over plain BLE
(§7o). Neither needs nRF, IR, or USB `SETUP`. The IR/nRF bench is now only about **objective
stations**, not attribution or feedback.

Out-of-range field play is still solved the way the official system does it — a device **on each
player** (the Companion, or the native phone node reporting to Mission Control over the LAN) — not a
better courtside radio. The nRF probe (D1) survives only as a "is there a bonus native radio for the
station/broadcast tier" question, not the linchpin it was framed as here.

## Followups and unknown fields

Open work is tracked in **[`docs/FOLLOWUPS.md`](FOLLOWUPS.md)** (the single source; refer to items by
id — P2, F, D1…). Summary below is a snapshot only:

| Item | Status |
|---|---|
| `$GSET` 8 tokens | ✅ **mapped + hardware-confirmed** (friendlyFire…gameMods). No respawn/time/lives token — those are host-side |
| `$WEAP` 44 tokens | ✅ **mapped + validated** vs two live frames (`protocol-classes.md`); ~6 empty positions want a one-field capture |
| `$GLED` tokens | ✅ colour is team-derived (`$TID`); `$GLED` = mid/effect/optionA/optionB with a LedEffect enum |
| Sound inventory | ✅ **2166-id bank** (`sound-bank.md`) |
| Smart Grenade | ✅ config = `$GREN` to gun (FlashBang/Gas/Confusion/Molotov). ⬜ hardware test pending (followup F) |
| Per-player identity | ✅ **SOLVED 2026-08-25** — `$PSET` token 1 = player id (0–63), `$HIR` token 3 = shooter id on every hit (§7p/§7q). Over BLE, per game, no cable. |
| Results read-back | ⬜ likely doesn't exist — gun keeps no score (§7n) |
| `$HIR` `45,0,0`/`70,0,0` variants | ⬜ recur; equal starting HP/armor |
| `$SFLASH,*` | ✅ shooter's green-sight kill-confirm flash, 1 per kill scored — host-driven over BLE (§7o / P7) |
| `$AS` / `$UP` semantics | ⬜ open |
| Headset lockout | ⬜ manual says headset lost mid-game locks the gun; **never controlled for** |

## The APK — ✅ DONE (2026-08-24, Windows)

The Callsign APK teardown is **complete**. Results live in `protocol/callsign-extract/`:
- `protocol-classes.md` — the full command vocabulary (~20 commands we never knew), per-command
  **field maps**, `$GSET` fully mapped + hardware-confirmed, the `$WEAP` **token positions**
  (cross-validated vs two live frames), and all the enums (DamageType, PowerType, ReloadType,
  LedEffect…).
- `sound-bank.md` — the complete **2166-id sound bank** (kills the mic-sweep dead end).
- `apk-harvest.md` — game modes, win conditions, the **QR-code station system** (= LaserTagMods'
  JBOX, done with paper: respawn/pickup/capture/supply-drop), **weapon-spawn types**, and the
  **grenade** (`$GREN` → gun; GrenadeMode = FlashBang/Gas/Confusion/Molotov).

Method note: the app is **Unity/IL2CPP** (not Java — `jadx` doesn't reach the game logic). The
metadata is obfuscated (v39 + encrypted index tables) so Il2CppDumper/Inspector fail, but the
identifier strings are plaintext in declaration order — field maps read straight out of them.
Deeper work (method bodies, exact serialization, server-fetched weapon stats) would need Ghidra;
low priority since field order is validated against live frames. Policy honoured: facts only,
raw config JSON kept for build use under a deferred-licensing note (`RAW_ASSETS_NOTE.md`), APK
binary + decompiled tree NOT committed.

## Sound inventory — ✅ DONE (do NOT use a microphone)

The complete 2166-id bank is in `protocol/callsign-extract/sound-bank.md` (from the APK). A
mic-based sweep was tried first and **failed its negative control** (nonsense id `ZZ99` produced
audio — the tagger plays a fallback for unknown ids) — so the APK was the only reliable route for the
*inventory*, and it worked. (Note: on-tagger sounds **are** swappable via the USB `AUDIO` folder —
`reference/brx-extended-user-guide.md`; the "no SD" claim was about *firmware* backup, not sound
storage.) Confirmed by ear: `VA20` =
"connection established", `VA81` = 3-2-1 countdown. Still open: the `$PSET` positional voice-pack
token→line mapping (change one token, hear which line changes) — now targeted since we know the
field names.

## Environment

**MacBook (field):** `.venv` built with `/opt/homebrew/bin/python3.13` (system python3 is
3.9 — too old), `pip install -e ./mcp`. `cat` is aliased to `bat` — use `sed -n`/python in
scripts. Extras used by scratch tooling only: `pyserial`, `numpy`, `sox`.

**Both:** `pip` resolves `mcp` to **2.0.0**, which moved `mcp.server.fastmcp` →
`mcp.server.mcpserver`, breaking `server.py` (MCP-server mode). The CLI is unaffected.
Check what the Windows venv has — if it is still `mcp` 1.x and works there, pin
`mcp>=1.2,<2` rather than porting the ~15 decorators.

## Hardware facts

- Two taggers, both fw **`v4.32` / `devhost.03`**, `devHost 1` — **developer images**, not
  retail. Callsign warns "supported version is until v2.01e" (an *upper* bound) but the
  warning is **soft**: games run fine.
- **MCU is a Teensy.** Micro-USB is the manual's "Programing Port" and enumerates as
  `USB Serial` / `Teensyduino`. Console commands are **`QUERY`** (read-only, dumps
  versions/serial/voltages/flags) and **`SETUP`** (factory provisioning — asks for the
  headset SN; entering and power-cycling out changed nothing). Everything else → `ERROR`.
- **Firmware cannot be backed up** — HalfKay is write-only (this is about *firmware*, not the sound
  storage, which IS writable over USB). Rollback depends entirely on Battle Company. **The email
  asking what `devhost.03` is was never sent.**
- Settings backup: `~/.brx-mcp/device-backups/` (on the Mac).

## BLE: connecting is flaky, holding is not

**Do not re-derive today's wrong conclusion.** Hours went into "the link dies after 6 s"
and even "v4.32's BLE stack is broken" — both **retracted**. Reality: establishment
succeeds roughly 1 attempt in 3 (the official app behaves the same); a session that comes
up cleanly runs 75 s+. `ble.py` now retries 5×, and that was the entire fix.

The Windows machine is where the original wrong theory came from. With retry in place it
may simply work there now.

## Before ANY app-driven session: check the headset

**With no headset paired, Callsign silently connects and immediately disconnects the
tagger** (§7m). No error, no voice line. This masqueraded as "the app is flaky" for a long
stretch and is the single most likely cause of a wasted capture session. Confirm the
headset is on and linked — `QUERY` over USB reports `Headset Version` and `Head:` voltage.
**You cannot create a game in Callsign unless its top-right icon is green and reads
"connected"** — that icon is both the gate and the source of truth; the tagger's voice
lines are not. This is the entire explanation for the "app is flaky then suddenly works"
pattern: nothing was intermittent, the headset was simply linked sometimes and not others.

## Working agreements with Tony

- Hands-on and fast. One clear physical instruction at a time; say exactly what to report.
  Power-cycle between experiments.
- **His observations are primary evidence.** Three confident conclusions were overturned
  today by what he noticed physically, not by any log: "the tagger never said phone
  disconnected", "it works maybe 1 in 3 times", and "alt fire doesn't switch weapons".
  When his report contradicts your reading of the data, assume your inference is wrong first.
- **Weigh cost against value before proposing long investigations.** He will follow a plan
  without second-guessing it, so a badly-prioritised one burns his evening. He stopped a
  multi-hour sound sweep with "what are we solving for here again?" — and was right.
- Distinguish signals: the tagger saying "phone connected" (a central attached) is **not**
  the same as the app saying "connection established" (its ritual succeeded — the real
  health check).
- Volume: `CLAUDE.md` says 30, but **30 is measurably inaudible** for weapon audio; the app
  uses 69. Commands take volume as an argument; the default stays 30 per the rule.
- Never modify tagger firmware. Credit LaserTagMods (JEDGE/JBOX) publicly.
- **LaserTagMods' repos carry no license** (all rights reserved). Their findings are
  restated independently in our docs — **do not copy their code** into this MIT project.
  Worth asking them to add a license; it would unlock a lot.
