# Handoff — BRX Open Battle System

**Updated:** 2026-08-23, end of the MacBook session. Read `CLAUDE.md` first, then this,
then `docs/experiment-log.md` (shared lab notebook — **append after every session**).
Protocol ground truth: `protocol/brx-protocol.md`.

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

### The new critical path: the nRF radio

`QUERY` reports **`NRFhost 1`** and **`NRFslave 1`**, and LaserTagMods ship `NRFL-Bases`
and `LoRa-Controlled-Taggers` — **they hit this same wall and solved it with a different
radio.** If these guns already carry a long-range radio, BLE was never the right transport
for field play and this reframes the problem instead of working around it.

**This is Windows-friendly work** — reading their sources and probing hardware, no iOS
captures needed. Good fit for the machine development is moving back to.

Other options if nRF does not pan out (full list in §7n): a device per player (what the
official system does), a cheap ESP32 relay per player, or on-gun menu configuration with no
central scoring (fine casually, does not scale to 20 taggers).

## Followups and unknown fields

Full prioritised list lives at the end of `docs/experiment-log.md`. Summary of unknowns:

| Item | Why it matters |
|---|---|
| `$GSET` 8 tokens | still undecoded, but **respawn and game time are NOT among them** (§7n) — lower value than it looked |
| `$WEAP` 44 tokens | custom weapons; manual's stock stats (§7h) are anchors, M-4 damage 24 already matches |
| Per-player identity | `$HIR` names the shooter's **team**, not player (§7k). FFA scoring needs per-player. `QUERY` shows a device-level `PlayerID` we have never set |
| Results read-back | see above — may not exist |
| `$TID,0,*` | candidate neutral LED for FFA (team drives colour, §7i) |
| `$HIR` `45,0,0` / `70,0,0` | recur across matches; the numbers equal starting HP/armor |
| `$HIR` protocol per weapon | two frames came as `$HIR,0,...` not `4` |
| `$SFLASH,*` | app sends it periodically, no args, never near a hit |
| `$GLED` tokens | colour is team-derived, so what do these do? |
| Headset lockout | manual: headset lost mid-game locks the gun. **Never controlled for** |
| Sound inventory | see below |

## The APK — highest-leverage work available on Windows

**See `docs/apk-investigation.md`.** Decompiling the Callsign Android APK is filed
elsewhere as a sound-inventory route, which undersells it: **the app builds the protocol
frames, so its code contains the meaning of every token in `$GSET`, `$PSET` and `$WEAP`** —
the field maps we have been reverse-engineering two captures at a time. It also holds the
sound id list, the full command vocabulary, and the end-of-game logic.

Needs **no hardware and no iOS captures**, so it unblocks work that is otherwise stuck
behind the MacBook. That Callsign never worked on Android is irrelevant — we are reading
its code, not running it.

Rules: document facts, never copy code; do not commit the APK or any decompiled tree.
Same standard already applied to LaserTagMods' unlicensed sources.

## Sound inventory — do NOT use a microphone

A mic-based sweep was built and **failed its negative control**: nonsense id `ZZ99`
produced audio, so the tagger appears to play a fallback for unknown ids and
"audio detected" never proved "id exists". There is also **no SD card** on the BRX (§7h).

Better routes, in order:
1. **Decompile the Callsign Android APK.** It must contain every sound id it sends, very
   likely with names. Highest value, needs no hardware. Would probably also reveal the
   end-of-game sequence and whether a results query exists.
2. **`$PSET`'s trailing audio tokens** (`H44,JAD,V33,…,A10`) look like a positional voice
   pack — the "GET SOME" respawn line came from there, not from any `$PLAY` we sent.
   Change one token, hear which line changes.

Confirmed by ear so far: `VA20` = "connection established", `VA81` = 3-2-1 countdown.

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
- **Firmware cannot be backed up** — HalfKay is write-only, no SD card. Rollback depends
  entirely on Battle Company. **The email asking what `devhost.03` is was never sent.**
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
