# Followups — consolidated & prioritised

Single source of truth for open work. Supersedes the scattered A–G lists in
`experiment-log.md` (kept there for history). Updated 2026-08-24. Status: ✅ done · 🔴 blocking /
high value · 🟡 useful · ⬜ open · ❎ closed as answered.

## Build (hardware/software the platform needs)

| # | Item | Status | Notes |
|---|---|---|---|
| B1 | **BRX Companion accessory** (ESP32-S3 rider: offline engine + powerups + audio + WiFi) | 🔴 spec'd, not built | `hardware/brx-companion-spec.md`. Prototype Tier-0 "Brain" first; validate powerup command sequences ($LIFE/$WEAP re-push/$AMMO) on hardware. Community-proven mount pattern (power-bank + ESP32 on phone bracket, no gun mod). **⚠️ Hardware gotchas from FB (`community-notes.md`):** BRX serial needs a **~5 ms delay per char**, **3.0–3.4 V logic (~3.06 V sweet spot; 5 V corrupts)**, a **diode on ESP32 pin 17 → board RX**; keep tagger-drawn current **<300 mA** (BC-confirmed OK). Design to survive **"SCREAMERS"** (BLE drops / random buzz-fail after ~1 hr, and BC firmware won't re-pair below a battery threshold) — expect reboots, keep batteries topped, don't assume a session-long BLE link. |
| B2 | **Phone app** to replace Callsign | 🟡 spec'd | `docs/phone-app-spec.md`. Web-Bluetooth PWA on Android; the per-player game engine + HUD. |
| B3 | **Mission Control** (scan → assign games/teams/weapons → live scoreboard) | 🟡 spec'd | `docs/mission-control-spec.md`. The operator console. |
| B4 | **BRX Utility Box** (open, MC-programmable objective node) | ⬜ spec'd | `hardware/brx-station-spec.md` — one ESP32+IR box → Hill/Assault/CTF/Respawn/Domination/**Extraction**/**Bomb**/perk emitter, driven live by Mission Control. The open answer to the sealed grenade (G7/G8). **Gating build task → B13** (capture the IR bit-layout). Sounds are `$SIR`-mapped (ours to assign), not cloned from the grenade. QR codes stay the ~$0 alt for simple pickups. |
| B13 | **Capture the BRX IR bit-layout** (for the Utility Box emit side) | 🔴 gates B4 emit | We have optical (980 nm/38 kHz) + encoding (25-bit, 1000/500 µs marks — `lasertagmods.md`) + payload *meaning* (type/team/mode). Gap = exact bit-packing of each objective/effect tag. Get it from **JBOX/LaserTagMods source** or a **~$2 TSOP38 + logic-analyzer bench capture** of real gun/grenade shots. RX-only prototyping can start before this; emit is blocked on it. |
| B5 | Fix `server.py` for **mcp 2.0** | 🟡 open | `mcp` 2.0 moved `mcp.server.fastmcp`; MCP-server mode broken, CLI unaffected. Pin `mcp<2` or port the decorators. |
| B9 | **Definitive BRX manual website** (high-polish public site) | 🟡 strategic | Aggregate everything on tagger + headset into *the* authoritative, beautifully-designed public reference (searchable sound bank, pairing/repairs/mods/protocol). Community magnet + SEO funnel to the platform/hardware. Prototype the design + sound-bank explorer as an Artifact first. Restate-with-credit, link official PDFs. See `VISION.md`. |
| B8 | **Grenade STATE app** (phone/web, $0) | 🟡 reframed (exp-log #35/#36) | **Config-over-BLE is DEAD** — objective modes are button-set + locked on the grenade (G8 negative); the app can't replace the on-grenade setup. **Real value = a live STATE DISPLAY:** read the grenade's beacons over BLE (`$HIR` token2=15) → show **Hill** possession + **Respawn** availability live (those two beacon; Assault/CTF/Frag don't). Pair with a printed setup cheat-sheet for the manual button config. Optional: thrown-blast config via `$GREN` if paired (G10). |
| B7 | **Serial-console backend** (pyserial) for `brx-mcp` | 🟡 | Open the tagger's USB COM port to run `QUERY` (read the device record incl. `PlayerID`) and `SETUP` (set tagger ID / re-pair). Feeds Mission Control diagnostics (§1 USB dump) **and** P2 (set per-player identity at bench prep). It's a serial terminal, not SSH. |
| B10 | **Synchronized multi-gun start** | 🟢 approach validated | G-2 (exp-log #33): sequential per-gun config = starts **~10 s apart**. **Fix validated in `g2_regen.py`:** config ALL guns fully first, THEN send `$SPAWN` to all back-to-back → they start ~together. Bake this **config-all-then-spawn barrier** into the engine/driver (M0.2, `tier0-plan.md`); retire per-gun config-then-spawn. |
| B12 | **Host-respawn vs grenade-respawn conflict** | 🟡 NEW | The grenade respawn-station disables a gun's self-respawn and provides its own (grenade button → team in-area, or headset-front + trigger); our engine does host-driven `$SPAWN` respawn. **Two competing authorities** — a mode using grenade respawn stations must NOT also host-respawn those players (or must reconcile). Decide per-mode which owns respawn; document in the engine. (exp-log #37) |
| B11 | **Custom connect/disconnect voice** ("Open BRX connected/disconnected") | 🟡 NEW | Branding polish: **back up + replace** the tagger's "phone connected" / "phone disconnected" audio with "Open BRX connected" / "Open BRX disconnected" via the USB `AUDIO`-folder sound swap (`<ID>.LTP`, `reference/brx-extended-user-guide.md`). First find the sound IDs (probe `$PLAY,<id>` around the connect voice, or diff the bank), archive originals, drop in the new clips. Nice first sound-swap demo. |

## Hardware / 3D printing (no public BRX print library exists — `hardware/print-files.md`)

Major repos (Printables/Thingiverse/STLFinder/Cults) have **zero** BRX-specific models; community
files are shared privately. Our MIT `hardware/` can become the canonical open library. Concrete asks:

| # | Item | Status | Notes |
|---|---|---|---|
| H1 | **Reload-handle → push-button mod** STL | 🟡 highest demand | Clean-room design; **version-tag it** (older vs newer BRX handles differ — a known wrong-print trap). Community pays ~$35–50 for a 5-pack. Tutorial: youtube JUP5ixjEZHw. |
| H2 | **D-pad replacement buttons** STL | 🟡 requested, unpublished | Button plastic cracks from wear; nobody has published one — good first contribution. |
| H3 | **BRX Companion mount + ported audio enclosure** | ⬜ with B1 | Clips to rail/phone bracket, no gun mod; ported box for the speaker (`brx-companion-spec.md`). |
| H4 | **Objective-station / effect-node enclosures** | ⬜ with B4 | Houses TSSP38 IR receiver + LED ring. |
| H5 | Decorative **skins / covers** | ⬜ nice-to-have | Community interest (e.g. sniper body); currently only private SwapTX work. |
| H6 | **Custom on-tagger sound packs** (data port) | 🟡 confirmed possible | Sounds swap over the micro-USB port — hold SELECT while powering on to expose storage (`community-notes.md`). Build a tool/guide + curate an MIT arena sound pack. Keep originals. |

## Research / capture

| # | Item | Status | Notes |
|---|---|---|---|
| R1 | **Callsign HTTPS API capture** (MITM proxy) | 🟡 gun-off | =P8. Proxy + cert on the phone → `/api/v1/callsign/settings`, `voice-profiles`, `arenas/games` give weapon stats, the `$PSET` voice-pack, game defs. Highest data yield; no gun. |
| R2 | **Re-scrape the FB group WITH comments expanded** | 🟡 | The 2026-08-24 crawl expanded post "See more" but NOT "View more comments" — comment threads (where much Q&A lives, e.g. the sound-swap process) were missed. Re-run clicking "view/more comments" + reply expanders. |

**Blocker for all:** needs **caliper measurements** from Tony (reload-handle socket, D-pad button,
rail dimensions) before CAD. Publish as version-tagged STL + source (OpenSCAD/STEP), MIT.

## Protocol — still unknown (worth a capture or probe)

| # | Item | Status | Method |
|---|---|---|---|
| P1 | `$WEAP` ~6 secondary-fire token positions (7–13) | 🟡 | **Confirmed not static** (server-fetched, `apk-harvest.md`). Field names/order known; pin wire positions via a one-field Callsign BLE capture, or the server API response. |
| P2 | Per-player identity (not just team) | 🟡 lead found | `$HIR` gives shooter **team** only; FFA scoring needs a player id. The **`QUERY` record has a `PlayerID` field (reads 0 — never set)**, and the **`SETUP` serial-console command (PuTTY over USB) is how you set the tagger ID** (community/Jay Burden: "run serial comms and change tagger ID"). Next: walk the `SETUP` prompts to set `PlayerID`, verify via `QUERY`, then check `$HIR`/`$DD` carry it. See `brx-protocol.md` §7c (QUERY/SETUP). |
| P3 | `$PSET` voice-pack token→sound mapping | ⬜ | **Server-side** — it's the Callsign `voice-profiles` endpoint (`apk-harvest.md`). Get it from the API capture, or change one voice profile and diff the `$PSET`. |
| P8 | **Callsign server API capture** (gun-off) | 🟡 NEW | MITM the app's HTTPS (`/api/v1/callsign/settings`, `voice-profiles`, `arenas/games`) → yields weapon stats, voice-pack presets, game defs directly. Needs proxy + cert on the phone, not the gun. Distinct from BLE snooping. Answers P1/P3 + weapon stats at once. |
| P4 | `$AS` / `$UP` semantics | ⬜ | `$AS` token 8 = applicator (99=all, 0=local) per LaserTagMods; `$UP,*` bare gets no reply |
| P5 | `$HIR` `45,0,0` / `70,0,0` variants; per-weapon IR protocol | ⬜ | fire each slot deliberately, watch token 1; numbers equal starting HP/armor |
| P6 | Results read-back after a game | ❎ | Gun keeps **no score** (§7n). There is nothing to read; the host/phone is the only score-keeper. **Do not probe `$SP`** (half the panic sequence). |
| P7 | `$SFLASH,*` | ⬜ | app sends periodically, no args — try in isolation |
| P9 | **Max native team count** (`$TID` range) | ⬜ | Confirmed 2 (TDM) + 3 (Supremacy). Test how many distinct `$TID` values the gun honours for friendly-fire resolution — decides whether small teams (duos) work *natively* vs. via the FFA+MC-logical-teams workaround. Quick BLE test: set two guns to `$TID,4`/`$TID,5`+, check same-team = no damage, cross-team = damage. |
| P10 | **IR damage value in the hit payload** | 🟡 NEW | Jay reports each BRX IR hit carries a **~7–8-bit damage value (≤256)** and explosive/grenade tag types score higher per hit (`reference/jay-ecosystem.md`). Confirm on capture — enables **damage-weighted scoring** and heavy-weapon balance. Watch the `$HIR`/`$SIR` payload per weapon slot. |
| P11 | Health-write semantics | ✅ RESOLVED | exp-log #33: **`$LIFE` and `$BUMP` are both ADDITIVE grants, clamped at max** (send the delta to add; neither is an absolute-set). **NO native regen** — armor held at 18 through 30 s idle. ⇒ shields/overshield/medic/Syphon are buildable via **host-driven** writes (heal on event; Halo-shields = host timer refill). Writes **don't self-emit `$HP`** — value shows on next hit/HUD refresh. |
| P16 | **Do shields activate?** | 🔴 NEW | The `$HP` **shield** field stayed **0** all through G-2 despite `$PSET` shield=70/99. Shields may need explicit **activation** (APK `ActivateShield` ability / a `$SIR` or mode setting), not just a pool value — so armor+HP are the working health pools today. Find how to turn shields on (needed for overshield / energy-shield modes). |
| P12 | **`$PB*` playbook enum tables + re-test on v4.32** | 🟡 NEW | FB captured the full `$PB*` remote-start sequence on **v4.30** with enum values (`$PBGAME 0=FFA`, `$PBWEAP 0=M4 AUTO`, `$PBPERK 2=Body Armor`, `$PBLIVES 2=5`, `$PBTIME 5=Inf`; `$INIT` blocks start) — `brx-protocol.md` §7j. Map the **full enum tables** for each `$PB*` and confirm the sequence on our **v4.32** (behaviour is version-sensitive). |
| P13 | **`$GLED` colour = single index (0–8)?** | 🟡 NEW | FB colour map (0 red…8 orange) fits **token-2-as-index** for 5/6 of our §7i probe. Re-probe `$GLED,<0-8>,0,0,1,2000,2000,*` mid-game, one field at a time → settle the LED-colour decode (needed for neutral-white FFA + team colours). |
| P17 | **How to turn the LEDs OFF (night mode)** | 🟡 NEW | `GameConfig(leds=False)` (night mode = outdoor + LEDs off) emits a **best-effort, UNCONFIRMED** `$GLED,0,4,0,0,0,,*` (effect=4=StopIR). Verify the actual LEDs-off frame: try `$GLED` effect=StopIR vs all-zeros vs a brightness/duration=0 mid-game; LED colour is team-derived (§7i/P13), so "off" is likely an effect or brightness field. Until confirmed, night mode's LED-off is not guaranteed. (`gameconfig.py _led_frames`) |
| P14 | **Audio SD card removable?** | 🟡 NEW | FB: audio is on a **(removable) SD card** ("pop" at boot = speaker OK; corrupt SD = no sound) — tensions our "SD hot-glued, not removed" note. Inspect on hardware: is the card accessible/swappable, and does swapping it change sound independent of the USB `AUDIO`-folder path? (`community-notes.md`) |
| P15 | **`$PLAY` alarm + phone-as-station BLE limits** | 🟡 NEW | For phone-as-extraction-site (`phone-app-spec.md`): confirm which `$PLAY` sound ids make a good field-wide **extraction alarm** (grenade/explosion bank), and measure the **max simultaneous BLE connections** an Android target phone holds (decides how many guns one phone can make scream — ~3–7 expected). Below that count → mesh-event + per-node alarm. |

## Grenade (mostly RESOLVED on hardware, exp-log #33–40 — see `reference/grenade.md`)

| # | Item | Status | Notes |
|---|---|---|---|
| G1 | Grenade objective modes | ✅ RESOLVED (exp-log #33–40) | **5 button-set modes** — red=Frag, green=Assault, blue=Hill(KotH), yellow=Respawn, white=CTF. Set on-grenade only (`$GREN` can't — G8). Beacon decode: `$HIR,0,15,0,<team>,<mode>` (token5: Hill=8, Respawn=6); only Hill/Respawn beacon. Full detail in `reference/grenade.md`. Open sub-items: G9 (CTF team-assign), G10 (thrown-blast). |
| G6 | What objective state does the gun expose over BLE? | 🟢 mostly answered (exp-log #35) | **Grenade IR surfaces as `$HIR` with token2==15**, but only if the gun's `$SIR` table doesn't eat it (bare/`minfire` config). **Mode-dependent:** **Hill** (`$HIR,0,15,0,2,8`) and **Respawn** (`,2,6`) **beacon their state ~every 2.5–5 s** → readable live; **Assault/CTF/Frag do NOT beacon** (state on the grenade LED only). Remaining: decode the beacon's owner/charge fields over a full capture; confirm the dead-gun-can't-fire gate through a death→respawn cycle. |
| G8 | Active `$GREN` — drive objective modes | ❎ NEGATIVE (exp-log #36) | Swept `$GREN` operationMode 0–7 × iRType {0,15} → **no effect**. **Objective modes (Respawn/Hill/Assault/CTF/Frag) are button-set and LOCKED on the grenade** (set in the boot/setup window only — anti-tamper). `$GREN` is **not** the objective-mode config path. Remaining `$GREN` question → G10. |
| G10 | **`$GREN` for a *paired thrown* grenade's blast type** | 🔴 NEW | `$GREN`'s `GrenadeType` = FlashBang/Gas/Confusion/Molotov = *blast effects* → `$GREN` likely configures a **thrown** grenade (needs the install-accessory pairing), not station modes. Test: pair a thrown grenade, send `$GREN` GrenadeType variants, observe blast. Also test the APK hypothesis that `$GREN` needs the grenade "tapped/loaded" to the gun first. |
| G9 | **CTF flag team assignment** (Tony's hypothesis) | 🔴 NEW | Shooting a CTF (white) grenade w/ a team-1 gun turned it **red**, not team colour (exp-log #35) — CTF likely needs the flag **assigned to a team/home base first** (you grab the *enemy* flag). Likely knob = `$GREN` **`channel`** field (channel/MaxCount decoded from APK → per-team/objective addressing). Test alongside G8. **Also: pull Jay's CTF videos** (`SWAPTX capture the flag JBOX` CxGkNrxUKIQ, `10 gen1 CTF + respawns w/ QR` -_zSFsG79tI) — not yet transcribed; they'd explain the CTF mechanic (JBOX/QR, likely transfers to the grenade). |
| G2 | Grenade pairing procedure | ✅ known | **Hold RIGHT while powering on the gun → "install accessory" → power on grenade (30 s window) → pull trigger aimed at it → it chirps/flashes.** Pair all accessories in one session, tap SELECT to finish (`brx-extended-user-guide.md`). |
| G3 | Capture the app configuring a grenade | 🟡 | PacketLogger while Callsign sets a grenade → exact `$GREN` |
| G4 | Grenade firmware `.bin` flashing | ⬜ uncertain | Community says grenade firmware is `.bin`-updatable, **but G7 found the USB-C is power-only (no disk/DFU) and there's NO PROGRAM pin** — so the assumed "hold pin → USB disk" method does NOT apply. If `.bin` flashing is real it uses an unknown method. Unresolved (`community-notes.md` tension note). |
| G5 | Grenade STATE-display UI | 🟡 (=B8) | NOT a config UI (config is button-locked, G8). Build a live objective screen reading Hill/Respawn beacons (`$HIR,0,15,0,<team>,<mode>`) via a BLE tagger relay. Folded into **B8**. |
| G7 | Grenade USB-C data interface | ❎ RESOLVED negative (exp-log #40) | USB-C is **power/charge only** — no console/drive/DFU in any state (off/on/purple button-hold), no PROGRAM pin. Verified on a known-good data path (a Pixel enumerated on it). So there's **no non-IR channel** to the grenade; state-read = the IR-beacon relay. Grenade audio is reskinned on the gun/headset/Companion, not on the grenade. |

## Field-range / transport (followup D — the way to scale)

| # | Item | Status | Notes |
|---|---|---|---|
| D1 | **Probe the nRF radio** | 🔴 | `QUERY` reports `NRFhost 1`/`NRFslave 1`; LaserTagMods ship NRFL-Bases on nRF24L01. **The BRX may already carry a long-range radio** — if so the range problem has a native answer. Highest-upside unknown. **NEW lead (D4):** the gun natively announces **multikills** ("double kill" on 2 back-to-back enemy kills) — so the *shooter's* gun receives kill confirmations, plausibly over nRF (guns meshing). If so, nRF is already carrying game events. Probe together. |
| D4 | **Native multikill / kill-confirmation mechanism** | 🔴 NEW | Hardware fact (Tony): a BRX gun says **"double kill"** when you tag two different enemies back-to-back in TDM — so the firmware tracks **local ephemeral kill state** and the **shooter's** gun *knows it got a kill* (it must receive a hit/kill confirmation — likely nRF, maybe a return IR ack). Reconciles with §7n (no host-readable *score*, but local kill tracking exists). **Investigate:** (1) does our **BLE-configured** TDM still fire multikill/streak/first-blood callouts (free announcer sounds)? (2) is there a **shooter-side kill event on the BLE stream** (watch the *shooter's* gun on a kill — cleaner attribution than victim `$HP,0`)? (3) mechanism — nRF (→ D1, guns already mesh) vs IR-ack? A 2-gun capture watching the killer's stream is the test. |
| D2 | Transport layer pluggable | 🟡 | design for BLE now, LoRa (RYLR896) / ESPNOW later (`lasertagmods.md`). The Companion's WiFi/MQTT covers most fields. **Radio baseline decided from Jay's measured tests** (`jay-ecosystem.md` §5): **ESP-NOW + external antenna (~581 ft)** for arena chatter; **LoRa in *standard/fast* mode (~1,373 ft, zero loss)** — NOT max-range (~1-in-7 loss) — for the field backbone; LoRa too slow for live score sync → time-sequence control + local scoring. |
| D3 | **Reproduce JEDGE 45-gun host** | 🟡 NEW | Jay ran **45 BRX rifles on one LoRa channel, no server** (`jay-ecosystem.md`). Validates our scale target. Confirm the broadcast-to-all-on-channel model and how per-gun addressing/scoring is time-sequenced. |

**Range problem itself is ❎ answered:** BLE can't support out-of-range play because the gun holds
no state (§7n). The fix is a device *on* each player (the Companion / a phone) — not a better
courtside radio. That reframes D1 as "is there a bonus native radio" rather than "how do we reach
the field."

## Done (for reference)

- ✅ Remote game start (`$SPAWN,,*` + `$AMMO` + `$BMAP`), two-tagger arena, `$HIR` team attribution
- ✅ `$GSET` map (hardware-confirmed), `$WEAP` token positions, `$PSET`/all command field maps
- ✅ Complete 2166-id sound bank (retired the mic-sweep dead end)
- ✅ Game modes, QR-station system, weapon-spawn types, grenade modes (APK harvest)
- ✅ Headset re-pair procedure recovered (`community-notes.md`) — the fix for the lockout that blocks firing
- ✅ Link stability (retry 5×; connecting is 1-in-3 flaky, holding is fine)

## Polish-loop Low items (deferred 2026-08-24, not blocking)

Surfaced by the 3-lens review, kept as Low (cleanup, not correctness):
- **Code nits:** `gsetdiff.py` rstrip strips all trailing commas (hides a last-field change);
  `btsnoop.py` assumes non-fragmented ACL (fine for MTU-23 NUS); `command_name` strips a run of `$`;
  `send` vs `send_batch` reply-seq filter differ (both correct); `_fieldstart` prints "HOST
  DISCONNECTED" just before the `finally` disconnects (cosmetic).
- **Doc/spec nits:** `field-architecture.md` "ESP32 has no HUD" is superseded by the Companion T2
  HUD tier; `$VIB` is a toggle so "custom hit effects" via VIB overstates; `getDevices()` reconnect
  isn't "silent auto-rejoin"; M-4 damage cited as "token 6" (1-indexed) vs "tok 5" (0-indexed) —
  standardise on 0-indexed; Companion BOM total ($25 vs $28) and pilot BLE cap (~7 / 7–10 / ≤8)
  wander within a doc; session dates stamped 2026-08-24 vs the environment's 2026-08-23;
  `mac-capture-plan.md` names modes ("Battle Lines/Faction Wars") not in the harvested list.

## Snooping — do we need more?

The APK teardown gave us the command **structure** (field names, order, enums) but the deeper dive
(UnityPy, 2026-08-24) proved the game **data** (weapon stats, voice-profiles, secondary-fire values)
is **server-fetched, not bundled**. So two capture routes remain, both gun-off-friendly:
- **P8 — Callsign HTTPS API capture** (MITM proxy) — the highest-yield: `settings`/`voice-profiles`/
  `arenas/games` endpoints hand over weapon/voice/game data in one shot. Answers P1, P3, weapon stats.
- **Targeted one-setting BLE captures** — P1 ($WEAP secondary), P3 (voice profile), G3 (grenade);
  a full end-of-game capture settles P4/P7. These need the gun.

No broad "watch the app over BLE" sweep is needed; the remaining data is either in the server API or
in a couple of one-setting diffs.
