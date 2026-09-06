# M-ARMORY — USB armory setup + scan-only BLE presence/identity

- **Status:** Draft (Wave 1 module), updated to contracts **A6**. Binds to `contracts.md` §1 (ArmoryRecord).
  Do not restate the backbone — this is the *how* for spec README §3 phase 0 and the armory half of phase 1.
- **Owns:** the permanent gun↔headset↔MAC↔name map (bench, over USB) + a **scan-only** BLE
  presence/identity sweep of whatever guns are advertising. **Reuses `mcp/brx_mcp`** — this module is a thin
  design layer over code that already exists and is partly hardware-verified.
- **Does NOT own (A4.9):** the readiness **rollup**. A gun's single BLE central belongs to its **node**; the
  node reports link/battery/fw/headset-echo/phone state in `status.preflight` + `ack_config.gun_echo`, and
  **M-MC** assembles the red/amber/green board from that plus this module's `scan()`. The old
  persistent-connection fleet reader is gone (§3.2).
- **Exposes to M-MC:** `list()`, `enroll()`, `rename()`, `scan()`, `bind_player()`.
- **Depends on:** M-CONTRACTS only. No LAN, no nodes — the bench runs standalone.
- **Not armory state:** `Player.player_num` (the 1–63 id in `$PSET` token 1 — 0 reserved, contracts §2/A5.1) is **per match**
  and assigned by MC at kit-out. Armory Setup still **never writes the USB `PlayerID`** — it is unnecessary
  now that identity is set over BLE at arm time (protocol §7p/§7q).
- Protocol discovery credit: **LaserTagMods** (JEDGE/JBOX; USB `QUERY`/`SETUP` command set) and
  **Jay Burden** (IR/station behaviour). Panic anywhere near a live gun: `$CLEAR,*` then `$SP,99,*`.

Ground-truth procedures this formalises live in `docs/field-process.md` (Armory Setup + Muster). This
spec is their data model, failure handling, and MC-facing interface.

---

## 1. Two jobs, one map

Stock BRX taggers are **identical and unlabeled**: you cannot tell which gun is paired to which
headset, and a stock gun adverts only as `Tactix-<MACtail>` (two stock guns collide). M-ARMORY does
two things and produces one durable artifact:

1. **Armory Setup** — one-time, per gun, over the **USB Teensy console**: read the headset PIN, bind
   the BLE address, write `$NAME` = the sticker id, mark it labeled. → one `ArmoryRecord`.
2. **Scan** — per game, over **BLE, advertisements only**: which guns are powered and advertising, which
   sticker each one is, its RSSI, and whether its name has reverted. → `ScanRow[]` that M-MC merges with
   node reports into the readiness board.

The artifact is `~/.brx-mcp/armory.json` (§4). MC never re-derives identity; it reads this map.

---

## 2. Armory Setup (one-time, per gun, over USB)

**The isolation trick** (why it is reliable for indistinguishable guns): power on **exactly ONE**
tagger. With a single BRX visible on BLE, the one advert you see *is* the gun you just read over USB —
the serial↔MAC bind is certain, no name-matching. This is what `enroll` enforces (`_enroll`,
`mcp/brx_mcp/__main__.py`; it refuses if it sees ≠1 tagger on BLE and tells you to power the others off).

Per gun, `python -m brx_mcp enroll <StickerId>` performs, in order:

1. **Read USB identity.** `UsbConsole.query()` → `parse_query()` (`usbconsole.py`) dumps the device
   record over the Teensy CDC port (VID `16C0`). The key field is **Serial Number / Head PIN** — the
   paired headset's sticker code, **USB-only** (BLE cannot read it). Also captured: headset version +
   voltage, gun voltage, PlayerID, PCB rev, laser power, `bt_central_v`. A raw backup is written to
   `~/.brx-mcp/device-backups/<serial>.txt` (`save_backup` — **holds the PIN, never committed**).
2. **Isolate + bind BLE.** `ConnectionManager().scan(8)` filters to Nordic-UART devices; with exactly
   one powered, `bind_address(serial, address, name)` records the serial↔MAC bind **with certainty**.
3. **Write `$NAME` = sticker id.** `_rename()` sends the app ritual (`$STOP → $PLAYX,0 → $NAME,<id>`).
   `$NAME` **persists over BLE** (confirmed 2026-08-24); the advert refreshes to `<StickerId>-<MACtail>`
   on the next power-cycle, so the gun **self-identifies on every future scan**.
4. **Mark labeled.** Print the headset's 5-char code on a label printer, stick it on the gun, and set
   `labeled: true`. Physical + digital identity now agree.
5. **Power-cycle & reconfirm.** `python -m brx_mcp armory` (= `scan()`) re-scans; `correlate()` matches the refreshed
   advert basename to the record and flips `name_confirmed → true` (`MAP=ok`).

> **Read-and-name only.** Armory Setup never writes PlayerID or re-pairs a headset (the USB `SETUP`
> write path — deliberately not built; FOLLOWUPS B7). It is no longer *needed* either: the per-match
> player id goes over BLE in `$PSET` (protocol §7p/§7q, P2 resolved). So it is safe to run on every gun.

### 2.1 The MAC-is-not-portable problem — correlate by advert name, never a cached address

`ble.address` is **not stable across hosts/OS**: Windows/BlueZ give a 17-char MAC, macOS/CoreBluetooth
gives a **per-device UUID** that differs on every Mac. A `ble_address` cached on the Windows bench is
**meaningless on the match-day MacBook**. Therefore:

- **Identity is the advert name, not the address.** `advert_basename("<StickerId>-A1B2")` strips the
  trailing `-<hex4>` tail → `<StickerId>`, which is stable everywhere. `correlate()` (re-)binds the
  address field to whatever this host currently sees, keyed by that name.
- **`ArmoryRecord.ble` carries both** `address?` (MAC) and `uuid?` (CoreBluetooth) plus the 4-char
  `tail`; whichever the current OS produces is (re)written on each scan, and the other is left as-is.
- **First muster on a new machine self-heals:** copy `armory.json` over (§5 export/import), run
  `armory`/`scan()` once, and every record rebinds its local address from its advert name. No
  re-enrollment. This is why `$NAME` **must** be the sticker id — it is the only cross-host key.

### 2.2 The Callsign-wipes-`$NAME` gotcha

Opening the official **Callsign app** against an enrolled gun **resets its `$NAME` back to `"Tactix2"`**
on connect. A wiped gun reverts to advertising `Tactix2-<MACtail>` and silently drops out of the map —
`correlate()` can no longer match it by name, and two wiped guns are again indistinguishable.

M-ARMORY **detects and guards** this rather than preventing it (we never touch the app):

- **Detect on every scan.** Any advert whose basename is `Tactix2` (or bare `Tactix`) against a record
  that expects a sticker name is flagged **`reverted`** in `scan()`. A gun that "vanished" from the
  map plus a stray `Tactix2` on the same fleet is the signature.
- **`name_confirmed` is the tripwire.** `add_to_inventory` already clears `name_confirmed` when a USB
  re-query reports a different `gun_name`; readiness surfaces `name_confirmed=false` as **amber, not
  green** — the gun works but its identity is unproven this session.
- **Re-scan reconfirm is the fix.** For a reverted gun, re-run `rename` (BLE, no re-cabling needed if
  still bound) or a full `enroll`, power-cycle, and let `correlate()` flip it back to `ok`.
- **Operator rule (docs):** never open Callsign on an enrolled fleet; if a teammate does, muster will
  show amber/reverted guns and name exactly which ones to re-stamp.

---

## 3. Muster — scan-only presence + identity (per game, over BLE adverts)

Readiness answers one question for MC: **is every gun in this roster green enough to start?** M-ARMORY
contributes the part only a scan can see; **the node contributes the rest** (A4.9).

### 3.1 Who reports what

| Signal | Source | Owner |
|---|---|---|
| **Present / advertising, RSSI** | BLE advert seen in `scan()` | M-ARMORY |
| **Identity** | advert basename == expected sticker; `name_confirmed`; not a `Tactix2` revert (§2.2) | M-ARMORY (`correlate`) |
| **Unclaimed** | advertising but no node has `bind`-ed it (MC cross-references) | M-ARMORY + M-MC |
| **Gun link, firmware, `$VOLTS` battery** | the node holding the gun (`hello.gun`, `status`) | M-NODE via M-NET |
| **Headset linked** | the gun's `$LCD` echo on config/spawn — `ack_config.gun_echo` (§3.3) | M-NODE via M-NET |
| **Phone battery / Wi-Fi / MC reachable / sync / foreground** | `status.preflight` | M-NODE via M-NET |
| **Companion batt/fw** | *(future)* `hello`/`status` | M-NODE via M-NET |

`scan()` is **advert-only**: it never connects, so it never competes with a phone for the gun's single
BLE central and never arms or configures anything. It is idempotent and safe to poll every few seconds.

### 3.2 Why there is no fleet reader (historical note)

The earlier design held **persistent BLE connections to every rostered gun** from the MacBook to harvest
`$VOLTS`/`$VERSION`. Two lab findings killed it: the serial one-shot sweep read battery on **1/4** guns
(exp-log 2026-08-24/25 — the ~6.6 s bleak drop vs the 30 s `$VOLTS` cadence), and holding N links from one
Mac runs into the ~7-central ceiling *and* **contends with the players' phones**, which each need to be the
gun's central. Since every gun has a node in the target architecture, the node already sees `$VOLTS` for
free (it streams under game config too — exp-log D4 note). The reliable bench truth remains USB
`parse_query` (`gun_volts`, `head_volts`); the node's `$VOLTS` is the live gauge; **battery is amber, not
red, when unsampled** (contracts A1).

### 3.3 Headset-connected gate

A gun with an unlinked/dead headset silently refuses to join a game (protocol §7m; B18b). Detectors:

- **Field / proven:** the **`$LCD,45,70,…` echo on `$SPAWN`** — a headset-less gun is **100% silent** at spawn
  (exp-log 2026-08-25, B18b). This is the only field detector proven on hardware.
- **Field / used, UNVERIFIED:** the echo to the lobby **head write** (`$LCD,0,0,0,0,0,0` — it proves the gun
  answered, not its state), reported as `ack_config.gun_echo`. MC treats an **empty** echo after the push as red
  (contracts A5.4). Whether an unspawned head echoes *with the headset off* has not been tested — if it does,
  the gate must move to the T-0 spawn echo. Bench item (§9).
- **Pre-push readiness is amber, never red, on headset** (A5.4) — red before the push would block the very
  push that produces the proof.
- **Bench / authoritative:** `parse_query` sets `headset_linked` from a present Serial/Head PIN + a real
  `Headset Version`, and reads `head_volts` (headset battery — **USB-only**). Carried on the record.
- **UNVERIFIED — do not rely on:** "answers `$VERSION`/`$VOLTS` ⇒ headset present." §7m shows a
  headset-less gun answered `$PING` fine; whether the `$STOP→$PHONE→$VERSION` ritual is headset-gated is an
  open bench question (§9). Until answered, the node's pre-lobby `preflight.headset_ok` is **amber** at best.
- **Gate:** headset-not-linked at bench, or an empty `gun_echo` after the config push, is **red**; everything
  earlier is amber.

### 3.4 What M-ARMORY hands to the board

```jsonc
ScanRow {
  tail:      string,                 // last 4 of the advertised address/name
  name:      string,                 // raw advertised name, e.g. "Tactix-3D4F" / "<Sticker>-3D4F"
  basename:  string,                 // advert_basename(name) — the sticker if enrolled
  gun_id:    string | null,          // armory match, if any
  rssi:      number,
  identity:  "ok" | "unconfirmed" | "reverted" | "unknown",  // §2.2 / not in armory
  t:         number                  // when seen
}
```

`ReadinessRow` / `ReadinessSnapshot` (red/amber/green per gun, `unclaimed`, `go`) are **defined in contracts §4**
and **assembled by M-MC** (mission-control.md §4) from `ScanRow[]` + each node's latest `status` +
`ack_config.gun_echo` + the armory record. M-ARMORY does not compute the rollup because it never sees the
node-side signals. Firmware and `$VOLTS` at muster come from the **node's pre-config probe set** (`$PHONE`,
`$STOP→$PHONE→$VERSION`, contracts §3) — `diagnose` stays a bench CLI for a single cabled/near gun.

---

## 4. Data model

### 4.1 ArmoryRecord (contracts §1) — the frozen shape MC binds to

`gun_id` (primary key, = headset PIN today), `sticker` (written as `$NAME`), `headset_pin`,
`ble{address?, uuid?, tail}`, `gen` (`gen2_3`|`gen1`), `fw`, `labeled`, `notes?`. Duplicate `sticker`
is illegal (§6). See `contracts.md` — do not fork the shape; gaps go through an amendment.

### 4.2 On-disk today vs. the contract

`armory.json` (via `usbconsole.py`) is keyed by `serial_head_pin` and stores the richer bench record:
`gun_name`, `ble_address`, `name_confirmed`, `headset_version`, `headset_linked`, `player_id`,
`field_id`, `pcb`, `bt_central_v`, `gun_volts`, `head_volts`, `grenade_pin`, `laser` (`INVENTORY_FIELDS`).
M-ARMORY exposes a **thin adapter** that projects this internal record onto the contract `ArmoryRecord`
MC consumes (`serial_head_pin→gun_id`/`headset_pin`, `gun_name→sticker`, `ble_address→ble.address|uuid`
by OS, `name_confirmed`→`ScanRow.identity`). The extra bench fields ride along as diagnostics; they are not part
of the frozen contract, so adding/removing them is non-breaking.

### 4.3 Storage, import/export

- **Location:** `~/.brx-mcp/armory.json` on the machine running the server (`storage.BASE_DIR`). Raw
  QUERY backups (with the PIN) in `~/.brx-mcp/device-backups/`. **Both hold headset PINs — never
  committed** (memory: sticker labels stay out of the repo; use `Tactix-XXXX` in examples/tests).
- **Export/import:** `armory.json` is portable JSON. Export = copy it (optionally redact PINs to a
  `gun_id` hash for sharing a roster without leaking headset codes). Import onto a new host = drop it in,
  then run `scan()` once to rebind local addresses by advert name (§2.1). This is the MacBook
  match-day path: enroll on the Windows bench, carry the JSON, rebind on the Mac.

---

## 5. Interface to M-MC

M-ARMORY is a library MC composes. All calls are host-local (USB/BLE adverts), never over the LAN.

```jsonc
list()                       -> ArmoryRecord[]            // the whole map (contract shape)
enroll(sticker)              -> ArmoryRecord              // isolation enroll one cabled gun (USB+BLE)
rename(gun_id|address, name) -> ArmoryRecord              // rewrite $NAME over BLE; marks name pending
scan(duration_s?)            -> ScanRow[]                 // advert-only sweep; presence + identity + RSSI (§3.4)
bind_player(gun_id, player_id) -> void                    // validate: gun exists in armory, identity ok
```

- **`list`** — reads `load_inventory()` through the §4.2 adapter. Pure read.
- **`enroll`** — wraps `_enroll`: USB identity → isolation bind → `$NAME` → `bind_address`. Requires a
  cabled gun and exactly one on BLE; returns a structured error otherwise (never throws to MC).
- **`rename`** — wraps `_rename`: BLE `$NAME`, `mark_rename` clears `name_confirmed`; MC shows the gun
  amber until a power-cycle + `scan()` reconfirms.
- **`scan`** — `ConnectionManager.scan()` + `correlate()` + the §2.2 revert detector; **no connections**.
  Side-effect free; safe to poll. `readiness()` is **removed** from this module: the rollup needs node
  reports M-ARMORY never sees, so keeping a half-informed `readiness()` here would produce a board that
  disagrees with MC's — one owner (M-MC), one rollup.
- **`bind_player`** — the gun↔player link is **session state, not durable armory state** (the same gun
  serves any player next game; ADR-0001 stateless gear). Stored on the `Player.gun_id` (contracts §2),
  not written back into `armory.json`. M-ARMORY only validates the `gun_id` exists with identity ok; the
  "is its node green" check is MC's.

**Gun `$NAME` vs. vanity gamertag vs. player number (do not conflate):** the durable `$NAME` is the
**sticker id** (hardware identity, self-IDs over BLE). A player's vanity gamertag is a **Mission Control
display layer** (`Player.display`), never a `$NAME` write. The **`player_num`** is the per-match 1–63 id (0 reserved) in
`$PSET` (contracts §2) — assigned by MC at kit-out, not stored here. The legacy `play <addr>@<Gamertag>`
path that pushes the gamertag via `$NAME` will **trip the reverted-name detector** on a rostered gun — MC
must use the display layer.

---

## 6. Edge cases

- **Duplicate sticker.** Illegal (contracts §1): two guns → one name can't be told apart on scan.
  `correlate()` already refuses to bind a name held by >1 record, and `_rename` warns before renaming
  into a collision. `enroll`/`rename` reject a duplicate sticker up front; `scan()` reports both rows as
  `identity:"reverted"`-class conflicts and MC shows **red** on both.
- **Unenrolled gun in a game.** A gun with no record (or advertising bare `Tactix2`) appears in the scan
  but not the roster. `scan()` returns it with `gun_id:null`, `identity:"unknown"`; MC lists it as **unclaimed/unenrolled**
  so the host can enroll it or exclude it; it can never go green (no identity). It does not block *other*
  guns' greens.
- **Gun that won't advertise** (asleep / held in a menu / low battery). Absent from `scan()` **and** no node
  has bound it → MC shows **red** (`ReadinessRow.present=false`, blocker "not seen — power-cycle / wake").
  Because battery-low also suppresses the advert, red-here means *physically check the gun*, distinct from
  amber battery-unknown on a gun whose node *is* linked.
- **Gen1 (Bluetooth Classic).** Gen1 taggers **cannot be BLE-scanned** — they pair in the OS, not via
  Nordic-UART. `scan()` never sees them. Fallback: `ArmoryRecord.gen = "gen1"`; MC marks Gen1 rows
  **`manual`** (neither auto-green nor auto-red) and shows a checklist the host confirms by hand
  (powered, paired, headset on). Enrollment still captures their USB identity over the Teensy console the
  same way; only the BLE muster path differs.
- **Battery not yet sampled.** The node may not have seen a `$VOLTS` yet (30 s cadence) — amber + last-known
  age, never red (§3.2, contracts A1).
- **CoreBluetooth UUID churn.** A Mac that forgets a device re-issues a new UUID; §2.1 rebind-by-name
  handles it on the next `scan()`, so a UUID change is never treated as a new gun.

---

## 7. Mapping to existing `mcp/` code — reuse vs. build

**Reuse as-is (bench, largely hardware-verified):**
- `usbconsole.py`: `find_tagger_port`, `UsbConsole.query`/`parse_query`, `save_backup`,
  `add_to_inventory`, `load_inventory`, `bind_address`, `mark_rename`, `advert_basename`, `correlate`.
- `__main__.py` CLI flows: `_enroll`, `_rename`, `_usb_query`, `_armory`.
- `ble.ConnectionManager.scan` (advert sweep). `diagnose`/`run_fleet_status` stay as **bench CLI probes**
  for a single near gun — not part of the M-MC path.

**Build (this module's new work):**
- **`scan()` + `ScanRow`** — advert sweep → correlate → revert detect → rows (§3.4). Small.
- **Fake-BLE scan stub** — a hardware-free fake advert list (N guns, RSSI spread, a `reverted` gun, a
  not-present gun, an unenrolled `Tactix2`) so `scan()` and M-MC's board build and unit-test off-bench.
- **Contract adapter** (§4.2) — project the internal inventory record onto `ArmoryRecord`/`ScanRow`.
- **Reverted-`$NAME` detector** (§2.2) — flag `Tactix2` adverts against expectant records.
- **Gen1 manual path** (§6) — a record shape + a `manual` identity so MC can show a hand-checklist.
- **Export/import redaction** (§4.3) — optional PIN-hashing for shareable rosters.

*(Dropped in A4: the persistent-connection fleet reader and its hold-time tuning — §3.2.)*

---

## 8. Task breakdown

1. **Contract adapter** — internal inventory ⇄ `ArmoryRecord`; `list()`. (No hardware.)
2. **`scan()` v1** — advert sweep + `correlate` + `ScanRow`; ship the MC board's unclaimed-gun list and
   identity column against this first.
3. **Fake-BLE scan stub** — the N-advert fake (§7) scripting the failure modes. Unblocks M-MC's board
   off-bench. (No hardware.)
4. **Revert/`Tactix2` detector + reconfirm flow** — wire into `scan()` and `rename`.
5. **Headset gate inputs** — surface bench `headset_linked`/`head_volts` on the record for MC's merge with
   the node's `gun_echo` (§3.3).
6. **`bind_player` validation + display/`$NAME`/`player_num` separation** (§5).
7. **Export/import + optional PIN redaction** (§4.3); MacBook rebind-by-name dry run.
8. **Gen1 manual path** (§6).

## 9. Open questions

- **[DECIDE] Battery in the gate?** Recommendation: battery is **amber-only** by default (a miss ≠ flat);
  let the host opt a hard-low threshold into red per event. Confirm the `$VOLTS` `charge_pct` (token3) vs.
  `level_pct` (token4, cell-voltage SoC) — which is the trustworthy % for the board? (Now read by the node,
  but the decode is shared.)
- **[HW-CONFIRM] `$VERSION` without a headset — does it answer?** Decides whether a node can prove the
  headset *before* the lobby config push (green at muster) or only via an echo (§3.3).
- **[HW-CONFIRM] Does an unspawned head echo `$LCD,0,0,0,0,0,0` with the headset off?** If yes, the lobby
  `gun_echo` is not a headset proof and the gate moves to the T-0 `$SPAWN` echo (§3.3).
- **[HW-CONFIRM] Callsign revert** — verify the exact wiped advert string (`Tactix2` vs `Tactix`) and that
  a single power-cycle + `rename` fully restores identity. (`archive/verification-checklist.md`.)
- **[DECIDE] gun_id key.** Contract uses headset PIN as `gun_id`; a re-paired headset changes the PIN.
  Accept re-enroll on re-pair (current), or add a stable synthetic id? Recommendation: keep the PIN;
  re-pair is already a re-enroll trigger in Armory Setup.
- **Companion readiness (future)** — batt/fw arrive over the LAN via M-NET `hello`/`status`, same path as
  the phone's preflight; nothing to add here.
