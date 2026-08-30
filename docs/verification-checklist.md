# Hardware verification checklist

> **Human-blocked items now live in [`bench-tomorrow.md`](bench-tomorrow.md)** — that's the list to
> work from on bench day; this file remains the durable per-session checklist.

Everything built/claimed in software that needs **Tony + a tagger** to confirm (Claude can't run BLE/IR
here). Grouped by what a single session unlocks. Check off as verified; move failures to FOLLOWUPS with
the observed behaviour. **This is the to-do list for your next hardware session(s).**

Legend: ⬜ unverified · ✅ verified · ⚠ verified-with-caveat · ❌ failed (→ FOLLOWUPS)

## ⭐ NEXT — post-A4 spec bench items (2026-08-25, `docs/spec/`)
Each one unblocks a spec decision marked [OPEN — bench] in `docs/spec/README.md` §6. Order = value.
1. ⚠ **Hold-across-disperse** (M-START §3): write the config head (`$START`+config, NO `$SPAWN`, no `VA81`),
   leave the gun unspawned **5+ minutes** (walk away, come back), then `$SPAWN,,*` + `$AMMO`. Does it go live with
   config intact (`$LCD,45,70,…` echo, correct ammo)? If not, the T-10 s head re-write becomes the default.
   → **2026-08-25: 2-min hold → `$SPAWN` went live with config intact; 5-min run interrupted — re-run (§7r).**
2. ✅ **BLE resync probe** (M-NODE §3.10): while LIVE, drop the link (walk out of range / toggle BT), kill the
   gun during the gap, reconnect. What does the gun emit on reconnect? Does `$PHONE` (or anything
   side-effect-free) re-elicit `$LCD`/`$HP` without spawning? Also: does a gun keep its config across a BLE
   reconnect vs a power-cycle (E1 assumption)?
   → **2026-08-25: dead gun volunteers nothing on reconnect; `$PHONE` reads nothing; `$BUT`-only when dead, `$BUT`+`$ALCD` alive; `$SPAWN` on the fresh link revived with config intact → config survives a BLE drop; a POWER-CYCLE wipes it — `$SPAWN` then echoes `$LCD,0,0,0,0,0,0`, the re-push tell (§7r).**
3. ❎ **`$VERSION` with the headset OFF** — does the gun answer? (§7m: `$PING` does.) Decides whether there is a
   side-effect-free headset detector or only the `$LCD`-echo-on-config path (`ack_config.gun_echo`).
   → **2026-08-25: moot — a headset-less gun cannot hold a BLE link at all (`$DISCONNECT`, then silent drops); with the headset ON, `$VERSION` token 2 = `hds.59` = headset fw (§7r).**
4. ⬜ **20-minute two-node soak** (Pixel + iPhone, one gun each): screen-lock one phone at T+5, background the
   other at T+10, walk both out of Wi-Fi range. Check: BLE held? engine resumed on unlock (respawn/expiry
   reconcile)? outbox flushed on return? timed end fired locally on both?
5. ✅ **Tutorial safety** (M-MODES §4): a configured-but-unspawned gun (head written, no `$SPAWN`) — does it take
   damage / register `$HIR` when a try-out gun shoots it? Decides whether kit-out try-outs are safe in a crowd.
   → **2026-08-25: configured-but-unspawned gun ignores IR completely — try-outs are safe (§7r).**
6. ✅ **`$PSET` token 2** — vary it (0/1/7) with everything else fixed; any change in `$HIR`, LED, sounds?
   → **2026-08-25: tok2 ∈ {0,1,7} → identical `$HIR`/damage/LEDs — inert, keep 0 (§7r).**
7. ✅ **`$HIR` token 1** — read `4` while armor absorbed, `0` for HP-taking hits, `2` on the kill (§7q). Confirm
   the pattern and whether it tracks weapon `$SIR` type vs applied effect.
   → **2026-08-25: pattern RETRACTED — token 1 = sensor (1 headset, 4/0 gun body); no kill marker; token 5 = damage (§7r).**
8. ⬜ **Phone auto-rejoin** (M-NET §8): on each phone, walk out of the router's range for 3 min, walk back — does
   it rejoin the no-internet SSID by itself? With mobile data on vs off? Record per OS.
9. ⬜ **`$VOLTS` % token** — controlled discharge sweep, both tokens (still open; HUD battery reads tok3 today).
10. ✅ **Head echo with the headset OFF** (A5.4): write a config head (no `$SPAWN`) to a gun whose headset is off —
    does it answer `$LCD,0,0,0,0,0,0` anyway? Decides whether the lobby push can prove the headset or only `$SPAWN` can.
   → **2026-08-25: headset OFF → the head write echoes NOTHING and the link dies; link + `$ALCD` echo is the headset proof (§7r).**
11. ✅ **`$START` in the head audible?** — at the lobby head write, does the gun play anything? (M-START §3 T-10 re-write.)
   → **2026-08-25: head write is SILENT; the voice + cock belong to `$SPAWN` (§7r).**
12. ✅ **Mid-match `$TID` write** (infection `team_flip`): change a live gun's `$TID`; does friendly-fire resolution
    follow immediately (same-team hits now inert / enemy hits now damage)?
   → **2026-08-25: live `$TID` flips hit resolution immediately both ways; LED colour only repaints at respawn (§7r).**
13. ⬜ **iOS locked-phone BLE**: lock the iPhone node mid-match, take 3 hits, unlock — did the queued `$HIR`/`$HP`
    notifications reach the JS engine on resume, or were they lost? (node.md §3.11.)
14. ✅ **`game_over` cue** — pin by ear (`VSF`+`JAY` per §7o end sequence) and add to `sounds.py`.
   → **2026-08-25: `VA33` (with `4,6`) = "game over"; `VSF`+`JAY` = victory sting + "victory" (winner's cue); empty-token `$PLAY` is silent (§7r). `compile.py` updated.**
## ⭐ EFFICIENT BENCH PLAN (post sim-hardening, 2026-08-25)
All game LOGIC for every mode is now exhaustively verified in software (156 sim scenarios + the SimGame
harness) — so the bench only needs to confirm what the sim CAN'T model. Do these in order; each is fast:
1. ⚠ **Combat modes on real guns** - **TDM PASSED 2026-08-30** on 3 taggers: team LED colours split 2v1 correctly, hit sound, death sound, headset dark in play then blinking green on death, host-driven respawn, team scoring correct, and friendly fire confirmed gun-enforced with a REAL gun (previously only proven with our synthetic emitter). ⚠ **One defect, root-caused: the engine attributes kills by shooter TEAM, so per-player credit collapses whenever a team holds 2+ guns (0 kills at 2v1; correct 5/5 at 1v1). The driver already assigns unique player ids and protocol.py already parses `$HIR` token 3 - the engine just never switched over. See Q17.** ffa/infection/lms still ⬜.
   ~~1. ⬜ Combat modes on real guns~~ (tdm/ffa/infection/lms, 2–3 taggers): `play <mode> …` — confirm the
   on-gun reality the sim can't see: LED team colours, hit/death/respawn SOUNDS, health behaves, and the
   scoreboard matches. Logic is sim-proven, so this is a hardware-behaviour check, not a logic check.
2. ✅ **Live-path resilience - PASSED 2026-08-30 on real hardware.** Started with one tagger OFF: host reported `playing with 2/3 taggers` after ~110 s (five connect attempts on the absent gun) and played on. Power-cycled a live tagger mid-match: it dropped, the host retried, and it **rejoined and resumed scoring and respawning**. ⚠ One defect: the FIRST reconnect prints success falsely and recovery actually takes a second attempt ~7 failed sends later - see Q18. ⬜ Still untested: whether a gun absent at START can join a running match (R0BAT never did).
   ~~2. ⬜ Live-path resilience~~ (the point of the resilience work): start a game with **one tagger off**
   → confirm connect-grace plays with the rest (`playing with N/M taggers`); **power-cycle a tagger
   mid-game** → confirm it reconnects and rejoins (`reconnected …`); confirm a game never hangs.
3. ✅ **Teardown - PASSED 2026-08-30 (second confirmation)**. Both guns died seconds before the end and were revived, not stuck. The spawn voice was audibly cut mid-word ("ge..."), which is `$PLAYX,0` firing right after `$SPAWN` exactly as designed; blinking stopped and both pulsed their last-game team colour. ~~3. ⬜ Teardown~~ — after a game, the loser isn't stuck (revived, headset dark, pulses last team). (✅ once.)
4. ⬜ **Config knobs on-gun** (Session C): night mode LEDs-off (P17), outdoor, kid_mode FF-off, volume, weapons.
5. ✅ **Native kill feedback** (D4) — RESOLVED 2026-08-25: **fully BLE-drivable** — the host sends `$SFLASH` (green flash) + token-4 `$PLAY` (announcer) per kill, exactly as Callsign does (§7o / B18). ✅ **Per-player attribution (P2) also RESOLVED** the same day (§7p/§7q).
6. ⬜ **Health variants** (Session B): syphon/regen `$LIFE` behaviour on real guns.
7. ⬜ **Objective modes** — need a station (grenade/Utility Box) to emit the IR events; gated on the IR bench
   (Session E/F). Engines + station-event handling are sim-proven; only the IR source is missing.

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
- ❎ **Fleet battery reliability** — superseded by spec A4.9: battery/fw/headset are **node-reported** (each phone holds its own gun); MC's BLE is scan-only presence. No persistent fleet reader.
- ⬜ **Headset-OFF heuristic** — power a headset off, connect: confirm "reachable but drops with zero frames".

## Session A — M0 live run — ✅ VERIFIED 2026-08-25 (Tactix-FE30 vs Tactix-9498, TDM, frag_limit=3)
The whole M0 engine ran end-to-end on real guns — **team2 won 3–1**; full narration in experiment-log.
- ✅ **`play tdm <A> <B>`** — config-all-then-spawn barrier worked; both guns went live together (B10).
- ✅ **Kill scoring** — real `$HIR`/`$HP,0` from the guns → the driver credited the right team, scoreboard ticked.
- ✅ **Host respawn** — downed guns came back after `respawn_s` (both respawned live).
- ✅ **Frag limit** ended the game with the correct winner (team2 to 3).
- ✅ **BLE held the whole match** — Tier-0 direct BLE sustained a 2-gun game with no mid-game drop.
- ⬜ **Time limit / respawn ramp** — not exercised this run (frag limit ended it); confirm separately.
- ⬜ **FFA** (`play ffa <A> <B> <C>`) — one `$TID`, FF on, **distinct `$PSET` player ids**; the *specific* killer is credited from `$HIR` tok3 (P2 ✅ — this is now wiring, not discovery).
- ⬜ **Attribution fuse** — a non-fatal hit long before a later (unrelated) death does NOT steal a kill.

## Session B — health variants (2 taggers, ~15 min)
`$LIFE` writes are confirmed (exp-log #33); the *modes* on top aren't yet run live.
- ⬜ **Syphon** (`play ffa … syphon=1`) — killer's armor climbs on a kill (watch `$HP` on next hit).
- ⬜ **Regen** (`… regen=1`) — after `regen_delay_s` with no damage, armor refills to full; re-arms on new damage; **no spurious heal on respawn** (the fix we made).
- ⚠ **Shields** — `shield=` / any shield-pool effect: **P16** — shields read 0 despite `$PSET` shield=99. ~~Confirm whether shields can be activated at all~~ ✅ **P16 CLOSED 2026-08-26 — yes, via an IR `$SIR` function-11 event, never a BLE pool value** (drain order shields→armor→HP); until then use **armor**, not shield.

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
- ❎ **`SETUP` (writes)** — no longer needed for P2 (player id is `$PSET` token 1 over BLE, §7p). Only relevant for headset re-pair; NOT built.

## Session D — native kill feedback + nRF — ✅ RESOLVED 2026-08-25 (D4); D1 re-scoped
- ✅ **Native feedback over BLE** — the **host drives the identical feedback over plain BLE**: `cap8`
  caught the app sending **`$SFLASH,*`** (green-sight flash) + **`$PLAY,,4,6,V3A,,,,*`** (kill line) per
  kill (§7o). MC does the same via `KillAnnouncer` (B18) — **the visual is ours too**; the old "nRF-only"
  call was a wrong-command (`$GLED`) probe. (In a phoneless native game the gun self-fires it over nRF.)
- ✅ **Shooter-side kill event** — **none** on BLE beyond the victim's `$HIR`/`$HP,0` (team-granular) —
  which is *why the host must decide the kill* and send the feedback (D4 stands, not contradicted).
- ❎ **nRF radio** (D1) — re-scoped twice: not needed for feedback (§7o) **nor for attribution** (§7q —
  `$HIR` tok3 carries the shooter's player id once `$PSET` sets it). Remaining value: a *bonus* long-range
  channel only; deprioritised.

## Session E — the IR bench (when the ESP32 arrives ~Aug 26) — B13
`hardware/esp32-ir-bridge/` + `hardware/ir-prototype-plan.md`.
- ✅ **Capture** — DONE 2026-08-26 (exp-log "B13 CLOSED"): timings measured (sync ~1990/992/500), Sony-remote negative control passed.
- ✅ **Bit-layout (B13)** — DONE: field offsets pinned by pushing known $WEAP frames (dmg 22/9/115, B=10); Z = computed parity (odd→01, even→10).
- ✅ **Emit** — DONE: 4/4 exact synthesize→transmit→decode round trip, and a STOCK GUN accepts fully synthetic shots (exp-log "LANDMARK").
- ✅ **`$SIR` sweep** — DONE overnight: the complete two-sided function map (damage/AP/×1.25/×2/heal/armor/shield/dual-polarity/status), 16×4 matrix (exp-log "COMPLETE two-sided").
- ⬜ 🧍 **needs a human + space** — **IR RANGE measurement** — full walk-back protocol + data tables in **`hardware/range-experiment.md`**;
  quantify each station with **`python -m brx_mcp ir-range <port> 12 10`** (reports detect% + decode%).
  Confirm the grenade respawn beacon's **~18–20 ft** figure and how much **outdoor mode / weapon / angle**
  change it; then characterize OUR emitter (bare LED vs driven+lens). Sets the objective-node coverage spec.

## Session E½ — sound catalog by-ear (1 tagger, ~10 min)
`mcp/brx_mcp/sounds.py` — CONFIRMED cues are grounded; the objective callouts are PROVISIONAL.
- ⬜ 🧍 **needs a human ear** — **Objective callouts** — `$PLAY` through the `V100–V144` range (the app's CTF/Slayer/KotH voice
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
- ✅ `$TID` 1=blue, 2=yellow; two-gun damage requires distinct teams *(NOTE 2026-08-26 overnight, CORRECTED: `$GSET` t1 IS firmware-enforced FF — with t1=0 same-team damage is blocked on the gun; distinct teams required unless FF on)*; no-power-cycle `$STOP`/`$CLEAR` reset.
- ✅ Remote game start (`$SPAWN`/`$PB*`); config/spawn/live; trigger fires (mag decrements in `$ALCD`).
