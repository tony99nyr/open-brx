# M-ARMORY — USB armory setup + BLE fleet scan / readiness

- **Status:** Draft (Wave 1 module). Binds to `contracts.md` §1 (ArmoryRecord). Do not restate the
  backbone — this is the *how* for spec README §3 phases 0–1 and §4's M-ARMORY row.
- **Owns:** the permanent gun↔headset↔MAC↔name map (bench, over USB) + the muster/readiness BLE
  scan that gates every game. **Reuses `mcp/brx_mcp`** — this module is a thin design layer over code
  that already exists and is partly hardware-verified.
- **Exposes to M-MC:** `list()`, `enroll()`, `rename()`, `readiness()`, `bind_player()`.
- **Depends on:** M-CONTRACTS only. No LAN, no nodes — the bench and the muster table run standalone.
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
2. **Muster / readiness** — per game, over **BLE**: scan the fleet, confirm each gun is powered,
   headset-linked, charged, and self-identifying. → a `readiness()` snapshot MC renders red/green.

The artifact is `~/.brx-mcp/armory.json` (§5). MC never re-derives identity; it reads this map.

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
5. **Power-cycle & reconfirm.** `python -m brx_mcp armory` re-scans; `correlate()` matches the refreshed
   advert basename to the record and flips `name_confirmed → true` (`MAP=ok`).

> **Read-and-name only.** Armory Setup never writes PlayerID or re-pairs a headset (the USB `SETUP`
> write path — gated behind explicit confirm, deliberately not built; FOLLOWUPS B7/P2). So it is safe
> to run on every gun.

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
  `armory`/`readiness()` once, and every record rebinds its local address from its advert name. No
  re-enrollment. This is why `$NAME` **must** be the sticker id — it is the only cross-host key.

### 2.2 The Callsign-wipes-`$NAME` gotcha

Opening the official **Callsign app** against an enrolled gun **resets its `$NAME` back to `"Tactix2"`**
on connect. A wiped gun reverts to advertising `Tactix2-<MACtail>` and silently drops out of the map —
`correlate()` can no longer match it by name, and two wiped guns are again indistinguishable.

M-ARMORY **detects and guards** this rather than preventing it (we never touch the app):

- **Detect on every scan.** Any advert whose basename is `Tactix2` (or bare `Tactix`) against a record
  that expects a sticker name is flagged **`reverted`** in `readiness()`. A gun that "vanished" from the
  map plus a stray `Tactix2` on the same fleet is the signature.
- **`name_confirmed` is the tripwire.** `add_to_inventory` already clears `name_confirmed` when a USB
  re-query reports a different `gun_name`; readiness surfaces `name_confirmed=false` as **amber, not
  green** — the gun works but its identity is unproven this session.
- **Re-scan reconfirm is the fix.** For a reverted gun, re-run `rename` (BLE, no re-cabling needed if
  still bound) or a full `enroll`, power-cycle, and let `correlate()` flip it back to `ok`.
- **Operator rule (docs):** never open Callsign on an enrolled fleet; if a teammate does, muster will
  show amber/reverted guns and name exactly which ones to re-stamp.

---

## 3. Muster / readiness (per game, over BLE)

Readiness answers one question for MC: **is every gun in this roster green enough to start?** Nothing
starts until green. It is a **BLE-only** sweep (no USB, no headset PIN needed at the field).

### 3.1 What each gun reports

| Signal | Source | Reuse |
|---|---|---|
| **Connection** | reachable / RSSI / self-identifying advert | `scan()` + `run_diagnose` `reachable` |
| **Firmware** | `$VERSION` after the `$STOP→$PHONE→$VERSION` ritual | `run_diagnose` `firmware` |
| **Battery %** | `$VOLTS` charge token (`charge_pct`, `level_pct`, `pack_v`, `cell_v`) | `run_diagnose` `battery` |
| **Headset linked** | inferred: a gun that answers `$VERSION`/`$VOLTS` had a live headset at link | see §3.3 |
| **Identity** | advert basename == expected sticker; `name_confirmed`; not `Tactix2` | `correlate` / §2.2 |
| **Companion batt/fw** | *(future, P2)* reported over the LAN by the node, not BLE | M-NET `hello`/`status` |

### 3.2 The battery-reliability problem — serial scan is not enough

**Experiment-log finding (2026-08-24 / -25):** a one-shot serial sweep (connect → `$PHONE` → wait for
`$VOLTS` → disconnect) reads battery on **only the strongest-RSSI gun**. `$VOLTS` streams on a **~30 s
cadence and only after `$PHONE`**, while the firmware drops the client at a random **~6.6 s**. On a 4-gun
fleet only **1/4** returned battery; the near gun got it, the −73…−84 dBm guns disconnected before their
first `$VOLTS`. This is not RSSI-pure but strongly RSSI-correlated.

`run_fleet_status` today is exactly that serial sweep — **fine for a near single gun, unreliable as a
muster board.** The design requirement:

- **Persistent-connection fleet reader.** Subscribe to *all* rostered taggers at once and **hold the
  links open**, harvesting `$VOLTS` as it streams every ~30 s and retrying `$VERSION` per gun, until every
  record has a fresh battery or a timeout. This replaces the connect-read-drop pattern for muster.
  (Build item; `run_fleet_status`'s serial path stays as the quick single-gun probe.)
- **Battery is a gauge, not a gate by default.** Because a missed `$VOLTS` means "didn't sample in time,"
  not "flat," readiness shows battery as **last-known + staleness age** (mirror the scoreboard's
  stale-not-gone rule, contracts §5). A gun with no battery reading is **amber**, never auto-red.
- **The reliable battery truth is USB.** `parse_query` gives exact `gun_volts` + `head_volts` at the
  bench; the field BLE % is the rough live gauge. Muster trusts the bench number when recent.

### 3.3 Headset-connected gate

A gun with an unlinked/dead headset cannot score. There is **no direct BLE "headset present" frame**, so:

- **Inferred at the field:** a gun that completes the ritual and returns `$VERSION`/`$VOLTS` had a live
  headset at connect (returning data ⇒ headset present). Losing telemetry mid-hold is a soft signal.
- **Authoritative at the bench:** `parse_query` sets `headset_linked` from a present Serial/Head PIN + a
  real `Headset Version`, and reads `head_volts` (headset battery — **USB-only**). Readiness carries the
  last bench `headset_linked` + `head_volts` alongside the live inference.
- **Gate:** headset-not-linked (bench-known) is **red**. A field-only ambiguity is **amber** with the
  advice to cable-check.

### 3.4 The readiness snapshot

`readiness(roster?)` returns one row per rostered gun that MC renders as a red/green board:

```jsonc
ReadinessRow {
  gun_id, sticker, tail,
  present:        boolean,          // seen on this scan
  identity:       "ok" | "unconfirmed" | "reverted",  // name_confirmed / Tactix2 wipe (§2.2)
  headset:        "linked" | "unknown" | "unlinked",  // §3.3
  battery_pct:    number | null,    // $VOLTS charge; null = not sampled (amber, not red)
  battery_age_ms: number | null,    // staleness of the reading
  fw:             string | null,
  rssi:           number | null,
  companion:      { batt_pct?, fw? } | null,  // future, via node/LAN
  status:         "green" | "amber" | "red",  // rollup
  blockers:       string[]          // human-readable reasons it is not green
}
ReadinessSnapshot { t, roster_size, greens, board: ReadinessRow[], go: boolean }
```

- **`status` rollup:** `red` = missing, unlinked-at-bench, reverted identity, or a hard-low battery when
  the operator opts battery into the gate; `amber` = works but unproven (no battery sample, field-only
  headset ambiguity, `name_confirmed=false`); `green` = present, identity ok, headset linked, battery
  fresh-enough. `go = (no reds)`; amber does not block but is shown.
- MC polls `readiness()` on a cadence during muster and re-renders; it is **idempotent and side-effect
  free** (a read sweep — it never arms or configures a gun).

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
by OS, `name_confirmed`→`identity`). The extra bench fields ride along as diagnostics; they are not part
of the frozen contract, so adding/removing them is non-breaking.

### 4.3 Storage, import/export

- **Location:** `~/.brx-mcp/armory.json` on the machine running the server (`storage.BASE_DIR`). Raw
  QUERY backups (with the PIN) in `~/.brx-mcp/device-backups/`. **Both hold headset PINs — never
  committed** (memory: sticker labels stay out of the repo; use `Tactix-XXXX` in examples/tests).
- **Export/import:** `armory.json` is portable JSON. Export = copy it (optionally redact PINs to a
  `gun_id` hash for sharing a roster without leaking headset codes). Import onto a new host = drop it in,
  then run `readiness()` once to rebind local addresses by advert name (§2.1). This is the MacBook
  match-day path: enroll on the Windows bench, carry the JSON, rebind on the Mac.

---

## 5. Interface to M-MC

M-ARMORY is a library MC composes. All calls are host-local (USB/BLE), never over the LAN.

```jsonc
list()                       -> ArmoryRecord[]            // the whole map (contract shape)
enroll(sticker)              -> ArmoryRecord              // isolation enroll one cabled gun (USB+BLE)
rename(gun_id|address, name) -> ArmoryRecord              // rewrite $NAME over BLE; marks name pending
readiness(roster?)           -> ReadinessSnapshot         // BLE muster sweep; red/green board (§3.4)
bind_player(gun_id, player_id) -> void                    // associate a gun with a session Player
```

- **`list`** — reads `load_inventory()` through the §4.2 adapter. Pure read.
- **`enroll`** — wraps `_enroll`: USB identity → isolation bind → `$NAME` → `bind_address`. Requires a
  cabled gun and exactly one on BLE; returns a structured error otherwise (never throws to MC).
- **`rename`** — wraps `_rename`: BLE `$NAME`, `mark_rename` clears `name_confirmed`; MC shows the gun
  amber until a power-cycle + `readiness()` reconfirms.
- **`readiness`** — the persistent-fleet sweep (§3.2). Side-effect free; safe to poll.
- **`bind_player`** — the gun↔player link is **session state, not durable armory state** (the same gun
  serves any player next game; ADR-0001 stateless gear). Stored on the `Player.gun_id` (contracts §2),
  not written back into `armory.json`. M-ARMORY only validates the `gun_id` exists and is green.

**Gun `$NAME` vs. vanity gamertag (do not conflate — memory):** the durable `$NAME` is the **sticker
id** (hardware identity, self-IDs over BLE). A player's vanity gamertag is a **Mission Control display
layer** (`Player.display`), not a `$NAME` write for muster. The legacy `play <addr>@<Gamertag>` path that
pushes the gamertag via `$NAME` is a play-time overlay MC reconciles in its identity layer, and it will
**trip the reverted-name detector** if used on a rostered gun — MC should prefer the display layer.

---

## 6. Edge cases

- **Duplicate sticker.** Illegal (contracts §1): two guns → one name can't be told apart on scan.
  `correlate()` already refuses to bind a name held by >1 record, and `_rename` warns before renaming
  into a collision. `enroll`/`rename` reject a duplicate sticker up front; `readiness` flags any live
  name-collision as **red** on both rows.
- **Unenrolled gun in a game.** A gun with no record (or advertising bare `Tactix2`) appears in the scan
  but not the roster. `readiness` lists it under `unmapped[]` with its tail so the host can enroll it or
  exclude it; it can never go green (no identity). It does not block *other* guns' greens.
- **Gun that won't advertise** (asleep / held in a menu / low battery). Not present on scan → `present:
  false`, `status: red`, blocker "not seen — power-cycle / wake." Because battery-low also suppresses the
  advert, red-here means *physically check the gun*, distinct from amber battery-unknown on a gun that
  *did* answer.
- **Gen1 (Bluetooth Classic).** Gen1 taggers **cannot be BLE-scanned** — they pair in the OS, not via
  Nordic-UART. `scan()` never sees them. Fallback: `ArmoryRecord.gen = "gen1"`; readiness marks Gen1 rows
  **`manual`** (neither auto-green nor auto-red) and shows a checklist the host confirms by hand
  (powered, paired, headset on). Enrollment still captures their USB identity over the Teensy console the
  same way; only the BLE muster path differs.
- **Marginal-link battery miss.** Covered by §3.2 — amber + last-known age, not red. The persistent
  reader is the mitigation; a still-missing gun after the hold window stays amber.
- **CoreBluetooth UUID churn.** A Mac that forgets a device re-issues a new UUID; §2.1 rebind-by-name
  handles it on the next sweep, so a UUID change is never treated as a new gun.

---

## 7. Mapping to existing `mcp/` code — reuse vs. build

**Reuse as-is (bench, largely hardware-verified):**
- `usbconsole.py`: `find_tagger_port`, `UsbConsole.query`/`parse_query`, `save_backup`,
  `add_to_inventory`, `load_inventory`, `bind_address`, `mark_rename`, `advert_basename`, `correlate`.
- `__main__.py` CLI flows: `_enroll`, `_rename`, `_usb_query`, `_armory`.
- `ble.ConnectionManager`: `scan`, `diagnose`, `identify`.
- `diagnostics.py`: `run_diagnose` (the `$STOP→$PHONE→$VERSION→$VOLTS` ritual + battery parse) —
  transport-agnostic and unit-tested against the fake.

**Build (this module's new work):**
- **Persistent-connection fleet reader** (§3.2) — the one real gap: hold N links, harvest streaming
  `$VOLTS`, retry `$VERSION`, until fresh-or-timeout. `run_fleet_status`'s serial sweep is refactored into
  "quick single probe" vs. "muster hold" behind one interface.
- **`readiness()`** — assemble `ReadinessSnapshot` from the fleet reader + inventory + §2.2 revert
  detection + §3.3 headset inference + rollup logic.
- **Contract adapter** (§4.2) — project the internal inventory record onto `ArmoryRecord`/`ReadinessRow`.
- **Reverted-`$NAME` detector** (§2.2) — flag `Tactix2` adverts against expectant records.
- **Gen1 manual path** (§6) — a record shape + readiness branch; no new BLE code.
- **Export/import redaction** (§4.3) — optional PIN-hashing for shareable rosters.

---

## 8. Task breakdown

1. **Contract adapter** — internal inventory ⇄ `ArmoryRecord`; `list()`. (No hardware.)
2. **`readiness()` v1** — over today's serial `run_fleet_status`; rollup + `ReadinessRow`. Ship the MC
   board against this first (known-unreliable battery, but the shape is right).
3. **Persistent-connection fleet reader** — replace the serial sweep for muster; the §3.2 fix. **[needs
   a multi-gun hardware session]**
4. **Revert/`Tactix2` detector + reconfirm flow** — wire into `readiness` and `rename`.
5. **Headset-linked gate** — bench-authoritative + field-inferred merge (§3.3).
6. **`bind_player` + gamertag/display reconciliation** — keep `$NAME`=sticker; player display is MC-layer.
7. **Export/import + optional PIN redaction** (§4.3); MacBook rebind-by-name dry run.
8. **Gen1 manual readiness path** (§6).

## 9. Open questions

- **[DECIDE] Battery in the gate?** Recommendation: battery is **amber-only** by default (a miss ≠ flat);
  let the host opt a hard-low threshold into red per event. Confirm the `$VOLTS` `charge_pct` (token3) vs.
  `level_pct` (token4, cell-voltage SoC) — which is the trustworthy % for the board?
- **[DECIDE] Persistent-reader hold time.** How long to hold links waiting for the 30 s `$VOLTS` before
  declaring a gun amber — one cycle (~35 s) or two? Longer = more greens, slower muster.
- **[HW-CONFIRM] Callsign revert** — verify the exact wiped advert string (`Tactix2` vs `Tactix`) and that
  a single power-cycle + `rename` fully restores identity. (`verification-checklist.md`.)
- **[DECIDE] gun_id key.** Contract uses headset PIN as `gun_id`; a re-paired headset changes the PIN.
  Accept re-enroll on re-pair (current), or add a stable synthetic id? Recommendation: keep the PIN;
  re-pair is already a re-enroll trigger in Armory Setup.
- **Companion readiness (future, P2)** — batt/fw arrive over the LAN via M-NET `hello`/`status`, not BLE;
  `readiness` merges them once nodes report. Placeholder `companion` field is in the row shape now.
