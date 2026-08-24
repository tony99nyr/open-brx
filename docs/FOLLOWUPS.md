# Followups — consolidated & prioritised

Single source of truth for open work. Supersedes the scattered A–G lists in
`experiment-log.md` (kept there for history). Updated 2026-08-24. Status: ✅ done · 🔴 blocking /
high value · 🟡 useful · ⬜ open · ❎ closed as answered.

## Build (hardware/software the platform needs)

| # | Item | Status | Notes |
|---|---|---|---|
| B1 | **BRX Companion accessory** (ESP32-S3 rider: offline engine + powerups + audio + WiFi) | 🔴 spec'd, not built | `hardware/brx-companion-spec.md`. Prototype Tier-0 "Brain" first; validate powerup command sequences ($LIFE/$WEAP re-push/$AMMO) on hardware. Community-proven mount pattern (power-bank + ESP32 on phone bracket, no gun mod). |
| B2 | **Phone app** to replace Callsign | 🟡 spec'd | `docs/phone-app-spec.md`. Web-Bluetooth PWA on Android; the per-player game engine + HUD. |
| B3 | **Mission Control** (scan → assign games/teams/weapons → live scoreboard) | 🟡 spec'd | `docs/mission-control-spec.md`. The operator console. |
| B4 | **Objective stations** (respawn / capture / pickup) | ⬜ designed | Two options: printed **QR codes** (Callsign's way, `apk-harvest.md`) and **IR boxes** (JBOX's way — emit the 25-bit/38 kHz BRX IR, `lasertagmods.md`). |
| B5 | Fix `server.py` for **mcp 2.0** | 🟡 open | `mcp` 2.0 moved `mcp.server.fastmcp`; MCP-server mode broken, CLI unaffected. Pin `mcp<2` or port the decorators. |
| B9 | **Definitive BRX manual website** (high-polish public site) | 🟡 strategic | Aggregate everything on tagger + headset into *the* authoritative, beautifully-designed public reference (searchable sound bank, pairing/repairs/mods/protocol). Community magnet + SEO funnel to the platform/hardware. Prototype the design + sound-bank explorer as an Artifact first. Restate-with-credit, link official PDFs. See `VISION.md`. |
| B8 | **Grenade config + state app** (phone/web, $0) | 🔴 high value | The grenade natively does **Assault / CTF / KotH** but is "super hard to configure." Build a clean UI that (a) sends `$GREN` over BLE to set the mode (replaces the on-gun menu) and (b) shows live objective state read from the gun's BLE stream. Unlocks 3 objective modes with **zero hardware**. Depends on F/G (exact `$GREN` per mode + what state the gun exposes). |
| B7 | **Serial-console backend** (pyserial) for `brx-mcp` | 🟡 | Open the tagger's USB COM port to run `QUERY` (read the device record incl. `PlayerID`) and `SETUP` (set tagger ID / re-pair). Feeds Mission Control diagnostics (§1 USB dump) **and** P2 (set per-player identity at bench prep). It's a serial terminal, not SSH. |

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

## Grenade (followup F — HIGH INTEREST, never touched on hardware)

| # | Item | Status | Notes |
|---|---|---|---|
| G1 | Map `$GREN` per objective mode | 🔴 | **On-grenade operation now documented** (`reference/grenade.md`, from the 2019 videos): modes = Respawn Station / King of the Hill / Checkpoint-Domination / Assault, programmed by holding the top button ~10 s (IR beacon → locks in). Remaining: map each mode to the **`$GREN`-over-BLE** frame (+ `GrenadeType` FlashBang/Gas/Confusion/Molotov) so the app (B8) replaces the finicky button-hold. Best via a PacketLogger capture of the app setting each mode. |
| G6 | What objective state does the gun expose over BLE? | 🔴 | For the state display (B8): during a grenade CTF/KotH/Assault game, what `$`-messages does the gun emit (flag held, point owner, timer)? Capture a grenade game and watch the BLE stream. |
| G2 | Grenade pairing procedure | ✅ known | **Hold RIGHT while powering on the gun → "install accessory" → power on grenade (30 s window) → pull trigger aimed at it → it chirps/flashes.** Pair all accessories in one session, tap SELECT to finish (`brx-extended-user-guide.md`). |
| G3 | Capture the app configuring a grenade | 🟡 | PacketLogger while Callsign sets a grenade → exact `$GREN` |
| G4 | Grenade firmware `.bin` flashing | ✅ known | Same as headset: **hold the PROGRAM button (pin) while powering on → USB disk mode → replace the root firmware file** (`brx-extended-user-guide.md`). Grenade enables CTF/KotH/Assault — "scary music" = CTF flag music (`community-notes.md`). |
| G5 | Build a clean grenade-config UI | 🟡 | in Mission Control / MCP — the "better way to configure it" the buggy on-gun menu lacks |

## Field-range / transport (followup D — the way to scale)

| # | Item | Status | Notes |
|---|---|---|---|
| D1 | **Probe the nRF radio** | 🔴 | `QUERY` reports `NRFhost 1`/`NRFslave 1`; LaserTagMods ship NRFL-Bases on nRF24L01. **The BRX may already carry a long-range radio** — if so the range problem has a native answer. Highest-upside unknown. |
| D2 | Transport layer pluggable | 🟡 | design for BLE now, LoRa (RYLR896) / ESPNOW later (`lasertagmods.md`). The Companion's WiFi/MQTT covers most fields. |

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
