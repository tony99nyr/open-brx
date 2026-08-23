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
