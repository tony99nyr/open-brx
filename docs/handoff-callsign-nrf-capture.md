# Handoff — Callsign BLE capture: is native nRF feedback enabled over BLE?

> ## ✅ DONE — 2026-08-25, MacBook. **Do not re-run this capture.**
> **Answer: neither branch you planned for.** There is **no BLE frame that enables nRF peering** —
> Callsign's arm is byte-identical to ours. But Route 2 isn't forced either, because **the app has no
> nRF radio and never used one**: it scores on the phone and drives the feedback over plain BLE with
> **`$SFLASH,*`** (the green-sight kill-confirm, one per kill) and **`$PLAY,,4,6,<id>,,,,*`** (the
> announcer slot). Step 0 confirmed: **the sight went green, 3/3 kills.**
>
> Full results → **[`handoff-callsign-nrf-capture-RESULTS.md`](handoff-callsign-nrf-capture-RESULTS.md)** ·
> protocol → **`brx-protocol.md` §7o** · trace → `protocol/captures/raw/2026-08-25-two-gun-3-kills-sflash.btsnoop`.
>
> The steps below are kept for method (they're a good capture recipe), not as pending work.

**For:** the Claude Code session on Tony's MacBook (with the iPhone running iOS Callsign).
**Author:** the WSL session, 2026-08-25, right after the "feedback fork" bench session.
**Read first:** `docs/experiment-log.md` → the entry **"LANDMARK: the feedback fork resolved"**
(2026-08-25). This doc assumes that context; the condensed version is below.

---

## The question this capture answers

BRX taggers have **two radios**: BLE (Nordic UART — the phone link) and an **nRF24L01 mesh**
(`NRFhost 1`/`NRFslave 1` in the USB `QUERY` dump; the same radio LaserTagMods' NRFL-Bases use for
gun-to-gun coordination). Tonight we proved, on hardware:

- In a **native gun-menu game**, kills **green the sight** + play **"double kill"** / killstreaks —
  and a **passive BLE tap on the shooter captured ZERO frames**. → that whole feedback layer rides
  the **nRF24 mesh and never touches BLE.**
- In **our BLE-config'd game** (`arm_test.py` / `GameConfig.setup_frames`), the sight **stays RED**
  on a kill and no announcer fires. → our BLE config does **not** engage the guns' nRF peering.
- BLE **can** play audio on command (`$PLAY,VA20…` works), but **cannot** green the sight
  (`$GLED` variants did nothing — matches §7i).

**The hypothesis:** the official **Callsign app only has BLE** (a phone has no nRF24 radio), yet its
games presumably show green-sight/double-kill. If so, Callsign is **not driving that feedback itself** —
it must send **some BLE config that flips the guns into a networked game where they nRF-peer
autonomously.** We just haven't found that frame — our raw `$SPAWN` arm skips it.

**Supporting clue:** the `$GREN` command already carries a BLE-set **`channel`** field — proof that
**nRF channel/addressing is assignable over BLE.** The missing enabler is plausibly a **shared nRF game
channel / network-id / session** (and/or the `$PB*` playbook-start path instead of raw `$SPAWN`, or a
`$GSET gameMods` flag).

**If we find that frame, our BLE game lights up native green-sight + announcer for free** (and MC keeps
scoring on top). If Callsign's multi-gun start is byte-identical to ours, native nRF peering is **not**
BLE-reachable and the path is the Route-2 nRF24 hardware tap (Companion). **This capture decides it.**

---

## Step 0 — the decisive pre-check (do this FIRST, before analysing bytes)

Before trusting any byte diff, confirm the premise on hardware:

1. Headsets **ON** on both guns. **A gun with its headset off silently refuses to join a game** (§7m,
   confirmed tonight — it was the cause of every "only 2 of 3 in-game"). Verify both headsets are linked.
2. In **Callsign**, set up and start a **real 2-gun networked/multiplayer game** (teams/weapons, whatever
   the app's multi-gun flow is).
3. Get a kill and **watch the shooter's red-dot sight.**
   - **Sight goes GREEN in the app game** → premise holds; the capture contains the enabler. Proceed.
   - **Sight stays RED in the app game too** → Callsign does **not** produce native feedback either; the
     green-sight is native-menu-only. The whole hypothesis changes — **stop and report this**, it's the
     most important finding and redirects the project (feedback would then be nRF-hardware-only, no BLE
     route exists).

---

## Step 1 — capture the BLE traffic (iOS, no extra hardware)

**Primary method — macOS PacketLogger (captures the iPhone's own BLE HCI):**

1. On the Mac, install **Additional Tools for Xcode** (developer.apple.com/download/all → "Additional
   Tools for Xcode <ver>"). It contains **PacketLogger**.
2. On the iPhone, install Apple's **Bluetooth logging profile** (developer.apple.com/bug-reporting/
   profiles-and-logs/ → *Bluetooth*). Install → **reboot the iPhone** (the profile enables verbose HCI).
3. Plug iPhone → Mac via USB, **Trust** the Mac.
4. PacketLogger → **File ▸ New iOS Trace** (or the "capture from iOS device" option) → select the iPhone
   → **Record**. This live-captures the phone's Bluetooth HCI.
   - *If your PacketLogger has no live-iOS option:* reproduce the game, then on the iPhone trigger a
     **sysdiagnose** (hold **Vol-Up + Vol-Down + Side** ~1.5 s; wait ~5 min), grab it from
     Settings ▸ Privacy & Security ▸ Analytics & Improvements ▸ Analytics Data ▸ `sysdiagnose_…`, AirDrop
     to Mac, unpack, open the `.pklg` (in `bluetooth/`) in PacketLogger.
5. **Record while doing Step 0's game** (connect → set up → start → a kill → end). Save the trace.

**Fallback method — over-the-air (needs the nRF52840 dongle if that's what arrived):** flash the
**nRF Sniffer for Bluetooth LE** firmware, capture in **Wireshark**, follow the iPhone↔gun connection.
Same decode target below. (An nRF24L01 module can **not** do this — wrong radio for BLE sniffing.)

---

## Step 2 — decode: pull the UART writes

BRX BLE = **Nordic UART Service**:
- Service `6E400001-B5A3-F393-E0A9-E50E24DCCA9E`
- **RX / write** (phone → gun) `6E400002-…` ← **this is what we want**
- TX / notify (gun → phone) `6E400003-…`

In PacketLogger/Wireshark, filter **ATT Write Command/Request to the `…0002` handle**. The value bytes
are **ASCII** — decode each to a `$…,*` frame. Produce a **chronological list** of every write, from
connect through game-start.

**Landmark to locate the connect point:** the iOS Callsign connect ritual is
`$STOP,*` → `$PLAYX,0,*` → `$VOL,69,0,*` → `$PLAY,VA20,3,6,,,,,*` (brx-protocol.md §7 / §7d). The game
setup + start frames come **after** that.

---

## Step 3 — diff against our baseline

Our arm (authoritative source: `mcp/brx_mcp/gameconfig.py` `setup_frames()` + `spawn_frames()`, driven
by `mcp/arm_test.py`). For a TDM game it sends, in order:

```
# setup (once):
$VOL,69,0,*
$CLEAR,*
$START,*
$GSET,<ff>,<outdoor>,1,0,1,0,<crit>,1,*
$PSET,…,<hp>,<armor>,<shield>,50,,H44,JAD,V33,V3I,V3C,V3G,V3E,V37,…,*
$WEAP,0,…            $WEAP,1,…            $WEAP,4,…(melee)
<$SIR table frames>  <$BMAP frames>       [<$GLED off, if leds disabled>]
$PLAYX,0,*
$PLAY,VA81,4,6,,,,,*     # game-start sound
# per gun:
$TID,<team>,*
# spawn:
$SPAWN,,*
$AMMO,0,<mag>,<res>,1,*
$AMMO,1,<mag>,<res>,1,*
$BMAP,0,0,,,,,*
```

**Flag anything Callsign sends that we don't.** Highest-value suspects:
- Any frame with a **`channel` / network / group / game-id / session** value (the nRF-peer enabler).
- **`$PB*` playbook frames** (`$PBGAME/$PBWEAP/$PBPERK/$PBLIVES/$PBTIME`, `$INIT`, `$PBSTART`) — Callsign
  may start via the playbook path, not raw `$SPAWN`. (community-notes §7j has the v4.30 `$PB*` values.)
- Unknown `$` commands, or **extra tokens** on `$GSET`/`$PSET`/`$SPAWN`/`$START` vs ours.
- **A value shared across BOTH guns** (same channel/game-id written to gun A *and* gun B) — that's the
  smoking gun for a shared nRF group. (If the app is one-phone-per-gun, capture whichever gun you can;
  even one gun's config reveals the enabler. If you can capture both phones/guns, compare shared values.)

---

## Step 4 — verdict + deliverables

Write up (and **append to `docs/experiment-log.md`**, update `docs/FOLLOWUPS.md` **B18/B18b**):

1. **Step-0 result:** does the Callsign app game green the sight / play "double kill"? (yes/no — critical)
2. **Decoded chronological UART-write list** for the app's connect→setup→start.
3. **Diff vs the baseline above** — the novel frames, called out.
4. **Verdict:**
   - *Novel channel/session/nRF frame found* → **Route 1 is live.** Bring the frame + values back; we add
     it to `GameConfig` and bench-test whether our BLE arm now greens the sight. (Cheap win — no hardware.)
   - *Byte-identical to ours* → native nRF peering is **not** BLE-triggered → commit to **Route 2**
     (nRF24L01 mesh tap on the Companion; needs the nRF24 hardware). Note this in FOLLOWUPS B18.
5. Any **new `$` commands** → add to `protocol/brx-protocol.md` command table (credit LaserTagMods for
   protocol lineage where relevant).

---

## Safety / environment (read before touching guns)

- **Panic sequence:** `$CLEAR,*` then `$SP,99,*`.
- **Known-safe command list** is enforced in `mcp/brx_mcp/protocol.py`; unknown commands need explicit
  confirm. We are **capturing**, not sending, so this is low-risk — but if you replay a captured frame to
  test, treat unknown frames as unconfirmed.
- **Never modify stock BRX firmware.** All control is over BLE serial (+ IR/nRF observation).
- **Keep headset PINs out of the repo** — `QUERY`/`SETUP` dumps contain the paired headset's serial/PIN;
  those live only in `~/.brx-mcp/device-backups/` (git-ignored), never committed. This project is
  open-source (MIT).
- **Volume 69** for real games (30 is inaudible for weapon/game audio; it's only the diagnostic default).
- **Headsets ON** or guns won't join (§7m).
- **Cross-platform:** macOS gives BLE **UUIDs**, not MAC addresses — never assume address formats in any
  code you touch (`mcp/` uses bleak; it's already UUID-safe).

## Pointers
- `docs/experiment-log.md` — "LANDMARK: the feedback fork resolved" (full context).
- `protocol/brx-protocol.md` — §7m (headset join-gate), §7e (remote start / `$SPAWN`), §7i (`$GLED` not
  RGB), §7j (`$PB*` playbook), the command tables.
- `protocol/callsign-extract/` — command/field maps (GSET/PSET/WEAP/GREN), sound bank, medals config
  (Double-Kill window = **4 s**).
- `docs/FOLLOWUPS.md` — **B18** (MC scorekeeper audio engine), **B18b** (headset gate), **P1/P3/P8/R1**
  (other Callsign captures), **B10** (synced multi-gun arm, HW-proven).
- Bench tools left in `mcp/`: `arm_test.py` (synced 3-gun arm), `passive_listen.py` (silent BLE tap),
  `play_probe.py` (drive audio/LED over BLE). Throwaway instruments — fine to reuse or delete.
