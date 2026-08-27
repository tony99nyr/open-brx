# Field process — Armory Setup & Muster

The two recommended Open BRX operator processes, from "a box of identical taggers" to "a game running."
Names are the **current naming** (Tony, 2026-08-25). Both lean on the existing `brx-mcp` CLI; steps are
marked **[BUILT]** (tooling exists + verified where noted) or **[HW-CONFIRM]** (procedure believed correct
but needs a hardware session — tracked in `verification-checklist.md`).

- **Armory Setup** — the **one-time, per-tagger** enrollment that builds a permanent
  gun ↔ headset ↔ BLE-MAC map (plus a physical label). Do it once per tagger (re-run only if you
  re-pair a headset or rename a gun).
- **Muster** — the **per-game** pre-game arming: config all guns together, assign teams/loadouts, and
  (for objective modes) **Station Arming** — deliver the station IR to each tagger before kickoff.

Why two processes: stock BRX taggers are **identical and unlabeled** — you cannot tell which gun is paired
to which headset, and the BLE advert of a stock gun is just `Tactix-<MACtail>` (two stock guns collide).
Armory Setup makes each tagger **self-identifying** (unique `$NAME` + a physical sticker + a digital map)
so that Muster and Mission Control can address, assign, and score them reliably.

---

## Armory Setup (one-time, per tagger)

**Goal:** every tagger has (a) a known **headset PIN** (its paired headset's sticker id), (b) a unique
persistent **gun `$NAME`** so its BLE advert self-identifies, (c) a **physical label** on the gun, and
(d) a row in the permanent map `~/.brx-mcp/armory.json` that Mission Control reads.

**The isolation trick (why this is reliable for identical guns):** power on **exactly ONE** tagger at a
time. With a single BRX visible on BLE, the one advert you see *is* the gun you just read over USB — so the
serial↔MAC bind is certain, no name-matching needed. This is what makes enrollment work for
indistinguishable stock guns. (Ref: exp-log 2026-08-24 armory correlation; `_enroll` in
`mcp/brx_mcp/__main__.py`.)

### Steps (per tagger)

1. **Isolate.** Power **on only this tagger**; power all others **off**. Cable this tagger to the server
   machine (USB "Programing Port", Teensy VID 16C0). **[BUILT]**
2. **Enroll.** Run **`python -m brx_mcp enroll <GunName>`**. This one command: **[BUILT]**
   - reads the device record over USB — including the **Serial / Head PIN** (= the paired headset's
     unique-ID sticker; USB-only, BLE can't read it) — and saves a raw backup to
     `~/.brx-mcp/device-backups/<serial>.txt` (**out of repo — holds the headset PIN**);
   - scans BLE; with exactly one tagger powered, that advert **is** this gun → binds
     **serial ↔ BLE MAC** with certainty (isolation);
   - if you passed `<GunName>`, renames the gun over BLE via `$NAME` (see step 3) and records the bind.
   - Output: a new/updated row in the armory map.
   - *(`enroll` refuses gracefully if it sees ≠1 tagger on BLE — it tells you to power off the others and
     re-run; the USB identity is already saved.)*
3. **Name the gun its sticker ID.** The gun's persistent **`$NAME`** should be the **hardware sticker /
   headset code** (not a player's vanity name) so the boot-time BLE advert comes back as
   `<StickerID>-<MACtail>` and the gun **self-identifies on every scan**. `enroll <GunName>` sets this;
   or set/replace it later with **`python -m brx_mcp rename <address> <name>`**. **[BUILT]** — `$NAME`
   **persists over BLE**, confirmed 2026-08-24 (advert refreshes on next power-cycle; re-scan to verify).
   - **Naming convention (Tony, current):** gun `$NAME` = the **hardware/headset sticker ID**. A player's
     **vanity gamertag is a separate Mission Control DISPLAY layer** — do **not** conflate the two. The
     scoreboard can label a player by any gamertag while the underlying gun keeps its stable sticker
     `$NAME` for identity/inventory. (Note: today's `play <addr>@<Gamertag>` path pushes the gamertag via
     `$NAME` too; under this convention the durable armory name is the sticker id, and a per-match gamertag
     is a display overlay MC applies — reconcile in the Mission Control identity layer.)
4. **Physically label the tagger.** Print the **headset's 5-char code (Serial / Head PIN)** on a small
   **sticker/label printer** and stick it on the **tagger** itself. Now the physical gun↔headset pairing
   is visible at a glance — you can grab a gun and its correct headset without guessing. This is a
   **recommended Open BRX practice** (Tony's) and complements the digital map (same headset PIN ↔ gun ↔
   MAC). **[recommended practice — no tooling]**
5. **Power-cycle & confirm.** Power-cycle the gun (so the advert refreshes to `<name>-<MACtail>`), then run
   **`python -m brx_mcp armory`** to reconfirm — the row should flip to `MAP=ok` with the BLE address bound.
   Repeat 1–5 for the next tagger. **[BUILT]** (BLE binding of renamed guns end-to-end is
   **[HW-CONFIRM]** — see verification-checklist "armory/correlation loop".)

**Output of Armory Setup:** a permanent **gun ↔ headset ↔ MAC** table in `~/.brx-mcp/armory.json`
(printable via `armory`), a self-identifying BLE advert per gun, and a physical sticker on each tagger.
Mission Control reads this map for roster/readiness. Real PINs live only in `~/.brx-mcp/armory.json` +
the out-of-repo backups — **never commit them**.

> **Not part of Armory Setup:** re-pairing a headset is the USB **`SETUP`** (write) path, deliberately
> **not built** yet (factory-provisioning writes, gated behind explicit confirm — FOLLOWUPS B7). The
> tagger's **player_num** is **not** a SETUP write — it's assigned **over BLE at kit-out** (`$PSET`
> token 1, 0–63; P2 closed — §7p/§7q), so Muster numbers the fleet with no cable. Armory Setup itself is
> read-and-name only, so it's safe to run on every gun.

---

## Muster (per game, pre-game arming)

**Goal:** all guns configured to the *same* game and started ~together, teams/loadouts assigned, and — for
objective modes — every tagger armed to its station **before** kickoff.

### Steps

0. **👁 EYEBALL THE HEADSETS FIRST — 5 seconds, saves a whole game.** A headset **slow-blinks RAINBOW
   when it is disconnected / not paired**, and a gun with a dark or unpaired headset **silently refuses
   to join** (§7m / B18b) — the real cause of every "only 2 of 3 armed". **Any rainbow = that player will
   stand there dead all round.** Fix it before you arm anything. A settled headset shows its tagger's
   **team colour**; it flashes **green on death**. All three are native and work under our game heads
   too. (Tony, 2026-08-27.)

1. **Roster from the armory.** Pick the guns for this match by their armory identity (sticker id / gun
   name), confirm readiness (battery, headset linked, firmware) via `fleet` / `diagnose`. **[BUILT]** for
   the diagnostics; the readiness dashboard UI is a Mission Control surface (B3, design prototype).
2. **Assign teams / loadouts / mode.** Choose the mode and per-gun team/weapon. **[BUILT]** via
   `python -m brx_mcp play <mode> <addr…> [k=v…]` (optionally `<addr>@<Gamertag>` for a display name).
3. **Config-all-then-spawn barrier.** Config **all** guns fully **first**, *then* send `$SPAWN` to all
   back-to-back so they go live ~together (sequential config-then-spawn starts guns ~10 s apart). This
   barrier is validated (`g2_regen.py`) and is the intended engine behavior. **[BUILT / HW-CONFIRM live]**
   — approach validated, live multi-gun run is a verification item (B10; Session A).
4. **Station Arming** *(objective modes only — respawn stations, and by extension any station-armed
   behavior).* Before kickoff, **deliver the station IR to each tagger** so it switches from auto-behavior
   to station-behavior for the game:
   - Set the grenade/station to its mode (e.g. Respawn = yellow) on-device (grenade is button-locked;
     `reference/grenade.md`), claim it for a team by shooting it if the mode requires an owner.
   - **Arm each tagger** by exposing it to the station's IR (respawn: the grenade button pressed near each
     player at base, and/or facing the station front + trigger). A tagger that is **not** armed will
     **self-respawn normally** — so arm *every* participating tagger.
   - **Two arming paths — either works (Jay's video, 2026-08-25 — Extreme Laser Tag And More! /
     @extremelasertag3602):**
     - **Pre-game (here in Muster):** expose each tagger to the station IR **before** kickoff → it respawns
       at the station instead of automatically for the game. The natural config step.
     - **Mid-game (per gun):** even if the game **started before** the grenade was set to a respawn station,
       **pressing the grenade button** beams the station IR to each gun in range and **forces respawn-station
       mode mid-match**. This is the **reliable per-gun force / re-arm** — usable to arm stragglers or to
       arm the whole field just after `$SPAWN`.
   - **[HW-CONFIRM]** (narrowed — the button-after-start path is reported working by Jay): confirm on
     hardware that (a) a gun armed by the post-start button **stays** station-respawn for the rest of the
     match, and (b) whether the **passive beacon alone (no button)** also arms. See
     `reference/grenade.md` §Respawn Station and `verification-checklist.md`.
   - **Respawn-authority caveat (B12):** if a mode uses grenade respawn stations, the host engine must
     **not** also drive `$SPAWN` respawns for those players (two competing authorities). Pick one respawn
     authority per mode. (`FOLLOWUPS.md` B12.)
5. **Kickoff.** Start the game. For objective modes, verify at least one BLE-connected tagger is in station
   range if you want the live state display (Hill/Respawn beacon relay, B8).

**Output of Muster:** all guns live ~together, on the same game, teams/loadouts set, and (objective modes)
every tagger armed to its station.

---

## Where the tooling lives

| Step | Command | State |
|---|---|---|
| Read a cabled tagger's device record (headset PIN, voltages, PCB…) | `python -m brx_mcp usb-query [port]` | **[BUILT]**, verified 2026-08-24 |
| Isolation-enroll a tagger (USB identity + BLE bind + optional rename) | `python -m brx_mcp enroll [GunName]` | **[BUILT]**; end-to-end bind **[HW-CONFIRM]** |
| Rename a gun's persistent `$NAME` over BLE | `python -m brx_mcp rename <address> <name>` | **[BUILT]** ($NAME persists, confirmed) |
| Print / reconfirm the armory map | `python -m brx_mcp armory` | **[BUILT]**; correlate loop **[HW-CONFIRM]** |
| Config + start a game (config-all-then-spawn) | `python -m brx_mcp play <mode> <addr…> [k=v…]` | **[BUILT]**; live run **[HW-CONFIRM]** |
| Physical sticker label (headset code on the gun) | *(label printer — no tooling)* | recommended practice |
| Station Arming (deliver station IR to each tagger) | *(on-device grenade + per-tagger IR; pre-game or grenade-button mid-game)* | reported working (Jay); **[HW-CONFIRM]** persistence |

## See also
- `reference/grenade.md` — grenade modes, on-grenade programming, Respawn Station mechanics + the timing reconciliation.
- `docs/spec/mission-control.md` — the operator console (roster, readiness, gamertag display layer).
- `FOLLOWUPS.md` — B10 (config-all-then-spawn barrier), B12 (host-vs-grenade respawn), B7/P2 (USB SETUP writes), B8 (grenade state display).
- `verification-checklist.md` — the hardware items that confirm Armory Setup, Muster, and Station-Arming timing.
