# Hardware verification checklist

Everything built/claimed in software that needs **Tony + a tagger** to confirm (Claude can't run BLE/IR
here). Grouped by what a single session unlocks. Check off as verified; move failures to FOLLOWUPS with
the observed behaviour. **This is the to-do list for your next hardware session(s).**

Legend: ⬜ unverified · ✅ verified · ⚠ verified-with-caveat · ❌ failed (→ FOLLOWUPS)

## ⭐ TOMORROW (2026-08-25) — armory/correlation loop (all 4 taggers on)
The newest, least-verified work. Do these first while the taggers are out.
- ⬜ **MAC auto-binding** — power on all 4, run `armory`; the uniquely-named guns should bind:
  `RocTheLegend ↔ …FE30` and `Tactix2 ↔ …E20D` flip to `MAP=ok` with an address. (Last night bound
  nothing, but the taggers were powering off mid-scan — the new `# BLE correlate: N seen, M bound` line
  now distinguishes "no guns seen" from a logic bug. Watch for it.)
- ⬜ **Rename → re-enroll → map-update loop** — cable the gun renamed **Alpha** (was `Tactix-9498`,
  `DF:F5:DA:08:94:98`); run `armory`. Its USB `gun_name` should update `Tactix → Alpha` (and, per the
  new fix, drop `name_confirmed` so correlate re-checks), then bind `Alpha ↔ …9498`. Proves the loop.
- ⬜ **Rename the rest** — `rename <addr> Bravo` / `Charlie` / `Delta` on the remaining stock guns,
  power-cycle each, re-run `armory` to reconfirm → all 4 uniquely mapped. (Renaming an *unbound* gun now
  warns it won't update the map until USB-enrolled — enroll after.)
- ⬜ **Armory Setup end-to-end** (`field-process.md` §Armory Setup) — for each tagger: isolate (only this one on),
  `enroll <StickerID>`, confirm the USB **headset PIN** matches the headset sticker, power-cycle, `armory` → row flips
  to `MAP=ok` with the bound MAC. Do the whole fleet; the map (`~/.brx-mcp/armory.json`) should hold one confirmed row
  per tagger. Also sanity-check the **physical sticker** practice (headset code printed on the gun) at the bench.
- ⬜ **Muster end-to-end** (`field-process.md` §Muster) — roster from the armory map, `play <mode> <addr…>` with the
  config-all-then-spawn barrier → all guns live ~together (B10); teams/loadouts land; for an objective mode, run
  **Station Arming** before kickoff. Confirms the two processes work as one flow.
- ⬜ **`$VOLTS` token 4** — sample at high vs low charge to decode the 4th number (token 3 = charge %, confirmed).
- ⬜ **Fleet battery reliability** — weak-signal taggers missed `$VOLTS`; decide persistent-connection vs RSSI-dependent.
- ⬜ **Headset-OFF heuristic** — power a headset off, connect: confirm "reachable but drops with zero frames".

## Session A — M0 live run (2 taggers, ~20 min) — highest priority
The whole M0 engine is tested in software but never driven on real guns.
- ⬜ **`play tdm <A> <B>`** — config-all-then-spawn barrier works; both guns go live ~together (B10).
- ⬜ **Kill scoring** — shoot B with A → `$HIR`/`$HP,0` → the driver credits A's team, scoreboard ticks.
- ⬜ **Host respawn** — a downed gun comes back after `respawn_s`; ramp (15→30→45→90) if enabled.
- ⬜ **Frag/time limit** ends the game with the right winner.
- ⬜ **FFA** (`play ffa <A> <B> <C>`) — unique `$TID` per gun; the *specific* killer is credited.
- ⬜ **Attribution fuse** — a non-fatal hit long before a later (unrelated) death does NOT steal a kill.

## Session B — health variants (2 taggers, ~15 min)
`$LIFE` writes are confirmed (exp-log #33); the *modes* on top aren't yet run live.
- ⬜ **Syphon** (`play ffa … syphon=1`) — killer's armor climbs on a kill (watch `$HP` on next hit).
- ⬜ **Regen** (`… regen=1`) — after `regen_delay_s` with no damage, armor refills to full; re-arms on new damage; **no spurious heal on respawn** (the fix we made).
- ⚠ **Shields** — `shield=` / any shield-pool effect: **P16** — shields read 0 despite `$PSET` shield=99. Confirm whether shields can be activated at all; until then use **armor**, not shield.

## Session C — environment / config knobs (1 tagger, ~10 min)
- ⬜ **Night mode / LEDs off** — `leds=0` sends a **guessed** `$GLED` (P17). Does it actually turn the LEDs off? Try effect=StopIR vs all-zeros vs brightness=0.
- ⬜ **Outdoor mode** — `outdoor=1` (`$GSET` token 2) changes IR range/behaviour as expected.
- ⬜ **Kid mode** — `kid_mode=1` → more health, friendly fire off (verify FF actually off).
- ⬜ **Volume** — the 1–5 ≈ 60/70/80/90/100 estimate; confirm `volume=80` is a comfortable level-3.
- ⬜ **HP/armor start values** — `hp=`/`armor=` land correctly (watch the `$LCD`/`$HP` spawn echo).
- ⬜ **Unverified weapons** — `primary=charge` / `primary=ar` actually fire (marked provisional; the `ar`/`charge` `$WEAP` tails are §6 doc examples we've never fired). Confirm ammo (charge mag=20).

## Session C½ — fleet diagnostics (BLE, verified 2026-08-24)
- ✅ **Firmware read** — `diagnose`/`fleet` return `v4.32` / `devhost.03` (after the `$STOP`→`$PHONE`→`$VERSION` handshake fix).
- ✅ **Battery read** — live `$VOLTS` (pack/cell V + charge %); token3 = state-of-charge (tracked 43→44% charging). ~30 s cadence.
- ✅ **Resilient connect** — connect+`start_notify` now retried as a unit (held 35 s, caught VOLTS).
- ⬜ **`$VOLTS` token4** — the 4th token (76) meaning still TBC; grab samples at high vs low charge to disambiguate.
- ⬜ **Headset presence heuristic** — confirm the "silently drops with no frames = no headset" rule by testing with the headset OFF (does `diagnose` come back reachable-but-empty / drop?).
- ⬜ **Multi-tagger fleet** — run `fleet` with 2+ taggers on; confirm serial diagnose + the dashboard line per tagger.
- ✅ **USB `QUERY` device record** (`usb-query`, verified 2026-08-24) — Serial/Head PIN (= headset sticker), headset version + head voltage, PlayerID, nRF flags, PCB, etc. Teensy VID 16C0 (COM5).
- ⬜ **Armory inventory** — cable each tagger, `usb-query`, and record which headset (sticker/serial) pairs to which gun. Build the tagger↔headset map for match-day gear tracking.
- ⬜ **`SETUP` (writes)** — the factory-provisioning side (set tagger id / re-pair headset → P2). NOT built; verify carefully on a throwaway tagger before trusting it.

## Session D — native multikills + nRF (2 taggers, ~15 min) — high upside (D4/D1)
- ⬜ **Native multikill under our config** — does the gun still say "double kill" on two back-to-back enemy kills in a `play tdm` game? (If yes → free announcer sounds.)
- ⬜ **Shooter-side kill event** — watch the *killer's* BLE stream on a kill; is there any event beyond the victim's `$HIR`/`$HP,0`? (Cleaner attribution if so.)
- ⬜ **nRF radio** (D1) — probe `QUERY` `NRFhost`/`NRFslave`; is it the kill-confirmation channel / usable for field range?

## Session E — the IR bench (when the ESP32 arrives ~Aug 26) — B13
`hardware/esp32-ir-bridge/` + `hardware/ir-prototype-plan.md`.
- ⬜ **Capture** — flash `ir_capture.ino`; fire a gun at the VS1838B; frames decode (`ir-capture`); the RX LED blinks.
- ⬜ **Bit-layout (B13)** — sweep every weapon / team / grenade mode; diff the 25-bit words → map type/team/mode/damage bits.
- ⬜ **Emit** — flash `ir_emit.ino`; tune timings to captured frames; a stock gun registers a `$HIR`; the TX LED lights.
- ⬜ **`$SIR` sweep** — catalog every IR type → effect + sound (the Utility Box API).
- ⬜ **IR RANGE measurement** — full walk-back protocol + data tables in **`hardware/range-experiment.md`**;
  quantify each station with **`python -m brx_mcp ir-range <port> 12 10`** (reports detect% + decode%).
  Confirm the grenade respawn beacon's **~18–20 ft** figure and how much **outdoor mode / weapon / angle**
  change it; then characterize OUR emitter (bare LED vs driven+lens). Sets the objective-node coverage spec.

## Session E½ — sound catalog by-ear (1 tagger, ~10 min)
`mcp/brx_mcp/sounds.py` — CONFIRMED cues are grounded; the objective callouts are PROVISIONAL.
- ⬜ **Objective callouts** — `$PLAY` through the `V100–V144` range (the app's CTF/Slayer/KotH voice
  lines) and note which id says what. Pin `OBJECTIVE_TAKEN` (grab), `OBJECTIVE_SCORED` (capture),
  `POINT_CAPTURED` (hill/point) to the right clips (currently V100/V108/V109, best-guess-in-range).
- ⬜ **Game-over cue** — confirm `VA33` (game over + music) is the one we want on match end (vs `VA85` quiet).

## Session F — grenade / objectives (grenade + tagger)
- ⬜ **Grenade beacon relay** — `diag-game`'s `gren.beacon`: a Hill/Respawn grenade's `$HIR,0,15,0,<team>,<mode>` surfaces on a bare-connected gun (confirmed once; make it repeatable for the state display).
- ⬜ **Domination / KotH** — station CAPTURE events → the engine scores point-time; owner LED = truth.
- ⬜ **CTF** — GRAB/CAP/DROP events (team is the explicit station token) → captures; a CAP only scores if that
  team is carrying (per-team `held`); DROP returns the flag. (Needs G9 flag team-assign resolved on the grenade.)
- ⬜ **CS/objective events** — the CS engine + Domination/KotH/CTF need a station/grenade to emit plant/capture/hold. Wire the objective device to feed the engines (needs the Utility Box or the grenade's IR decoded).
- ⬜ **Extraction live** — `play extraction <A> <B> <C>` runs the flagship engine on the driver (FFA teams,
  host respawn, loud channel alarm). Needs the station to feed `ZONE`/`LEAVE`/`LOOT`/`PICKUP`; the combat
  half (kill drops loot, killer gains kill-loot) runs off the gun stream today.
- ⬜ **Grenade G9/G10** — CTF flag team-assign (turned red not team colour); `$GREN` thrown-blast on a paired grenade.
- ⬜ **Station-Arming persistence (respawn)** — the before-vs-after-`$SPAWN` timing is **reconciled** (Jay's video,
  2026-08-25): both paths arm — pre-game passive arming AND a **post-start grenade-button press** (which forces a
  gun into respawn-station mode mid-match). Remaining to confirm on hardware (`reference/grenade.md` §Respawn Station;
  `field-process.md` §Muster→Station Arming): (a) a gun armed by the **post-start button** press **stays**
  station-respawn for the rest of the match; (b) does the grenade's **passive beacon alone (no button)** also arm a
  tagger, or is the button press required? A never-armed tagger should just self-respawn. Record → grenade.md/B12.

## Session G — phones (Android phone + tagger, ~30 min) — G4, gates M2
- ⬜ **Android BLE hold** — `webapp/ble-test.html` (Chrome) vs nRF Connect: does Android Chrome hold a BRX NUS link? (Gates the whole phone/PWA branch; also decides web-vs-hybrid.)

## Cross-machine
- ⬜ **MacBook holds a BRX link** — the play host is the Mac; confirm bleak/CoreBluetooth holds (prior Mac sessions worked — a re-confirm, not an unknown).

## Design / UX review (Tony — no hardware, just eyes)
- ⬜ **Mission Control console** — the operator-console artifact (`webapp/mission-control.html`, published at
  https://claude.ai/code/artifact/f44bf1ee-ded5-49e8-963b-aa8c51bcf40a). Review the direction: dark-first
  tactical palette (laser-orange accent, team blue/gold), Rajdhani/IBM Plex type, 3-column ops layout +
  sticky deploy bar, live `play` command generation, Demo-game animation. **Does the design direction land?**
  Keep / redirect / redesign. (It's a prototype — scoreboard is demo-animated, not yet wired to real guns.)

---

### Already verified (for reference — don't re-run)
- ✅ Health-write `$LIFE`/`$BUMP` additive-clamped; no native armor regen (exp-log #33).
- ✅ Grenade mode map + `$HIR,0,15,0,<team>,<mode>` beacon decode; `$GREN` can't set objective modes (G8);
  grenade USB-C power-only (G7). (exp-log #35–40.)
- ✅ `$TID` 1=blue, 2=yellow; two-gun damage requires distinct teams; no-power-cycle `$STOP`/`$CLEAR` reset.
- ✅ Remote game start (`$SPAWN`/`$PB*`); config/spawn/live; trigger fires (mag decrements in `$ALCD`).
