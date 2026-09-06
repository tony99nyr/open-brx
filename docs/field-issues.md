# Field issue register

**Every issue reported from a live session, and what happened to it.** Nothing here is closed on a
guess: an item is DONE only when the fix is in and tested, and OPEN items say what evidence would
settle them. Newest session first.

**Add to this file the moment an issue is reported**, before diagnosing — that is the point of it.
Cross-references: `docs/FOLLOWUPS.md` (all open work), `docs/experiment-log.md` (the lab notebook).

Legend — ✅ fixed & tested · 🔧 fixed, needs a field check (see **Check next match** at the end of this file) · 🔍 open, evidence named · 💭 open, design

---

## Session 2 — 2026-09-01, two Android HUDs, TDM, outdoors
Evidence: `~/.brx-mcp/mc/session-8bbf96ab.sqlite` (both phones' BLE frame rings were shared).

| # | Reported | Status | Where it stands |
|---|---|---|---|
| F2-1 | Headset domes never registered a hit | 🔍 | **Split by match, which is the honest cut.** `$HIR` tok1 0–3 are ALL headset (four sensors); I had counted only 0 and 1. The match Tony reported: **13 headset / 62 gun = 17%** — and **sensor 1 (the back dome) recorded ZERO hits in it**. The later deliberate nozzle test: **95 headset / 0 gun**. A blended "108/170 = 64%" figure I quoted earlier mixes the two and should not be reused. 17% is above Callsign's native 3/23 ≈ 13%, so the headset was not dead — but a back dome silent for a whole match and then responsible for 69 hits is unexplained. ⛔ Refuted: `outdoorMode` (domes returned with the venue still outdoor), daylight (native outdoor play works), gun uptime (cycled before every game). See V1. |
| F2-2 | `hit_taken` could not show which sensor fired | ✅ | Sensor forwarded to MC. Found a **pre-existing bug doing it**: `ir_proto` read `$HIR` token 1, which is the *sensor* — every hit fact ever recorded carried that mix-up. Both fixed, test added. |
| F2-3 | Gun powered on did not auto-reconnect; HUD blinked GUN DISCONNECTED, MC blocked; needed the debug menu | 🔧 | Reconnect was unbounded only in `armed`/`live`; elsewhere it stopped after 6 tries (~25 s) — about how long a switched-off gun takes to burn them. Now retries **forever** in every phase (backoff caps at 10 s, ~6 attempts/min), and the GUN LINK LOST pill is now a **tap-to-reconnect button** instead of a status. |
| F2-4 | SHARE LOG dumped text to copy-paste | ✅ | On success it now reports bytes + frame count and returns. The share sheet is the fallback for when MC cannot take it, and says so. |
| F2-5 | Dying produced no green flash (native does) | 🔧 | **Instrumented** (V2): the HUD now logs when the cue fires, so absence becomes decidable. The alert shipped in 0.1.1 and **no flash was seen** — whether our code fired it is exactly what the 60-frame ring cannot say. ⛔ A brightness raise to 100 was reverted: we do not know `$HLED` token 5 is brightness, and changing it in the same commit as the instrumentation would have destroyed the control. The only `$HLED` in either ring is our END_SEQUENCE blanker — but rings hold 60 frames and both end at teardown, so **absence is not proof**. Needs a log line when the cue fires. |
| F2-6 | Headsets showed team colour on DEATH, not pre-game | 🔍 | Consistent with the Windows lane's correction: our `$HLED` sits mid-head, where Callsign sends it as a LOBBY frame paired with `$GLED`. Try matching position and pairing. |
| F2-7 | A game whose rules fix the weapon/perk did not apply them | 🔍 | No evidence captured. Needs a repro with the config id noted. |
| F2-8 | END MATCH EARLY on MC did not reach either HUD | 🔧 | **Likely found:** the HUD ignores `control{end}` unless phase is live/armed/lobby — and both nodes reported **`kitted`**, where it is a no-op. MC also discarded `broadcast()`'s reach count, so it reported success either way. Now MC shows `END REACHED n OF m` (red at 0) and the HUD logs the ignore. Verify: V6. |
| F2-9 | Perks menu on the phone is small and hard to find | 🔧 | The WEAPONS \| PERKS \| NONE controls were 34 px filter chips and are the only route to perks; now 46 px and styled as the primary control they are. Verify: V7. |
| F2-10 | "A phone HUD would not reconnect/sync on Wi-Fi" | ✅ | **Not a transport bug.** Its own log: `wsState: bound`, `synced: true`, `mc_reachable: true`, `pending: 0` — and it delivered its log over that link. What was down was `bleUp:false`, the *gun*. The HUD presented a dead gun as a sync failure; that misdirection is the real defect and is what F2-3 now fixes. |
| F2-11 | Only MALE/FEMALE selectable | ✅ | 15 personas. `$PSET`'s trailing tokens are a positional voice pack that was hardcoded to HEAVY for every player. |
| F2-12 | KIT should list online taggers, not a gun dropdown | 💭 | Built, then **reverted**: it inverts the setup order (roster→gun→phone becomes phone→claim) and took the e2e from 75/75 to 29/75. Right model, but it needs the e2e's setup phase rewritten. Pairs with phone-side gamertag entry — do them together. |
| F2-13 | Players should enter their own gamertag on the HUD | 💭 | Scales better than everyone queueing at the operator. Blocks/pairs with F2-12. |
| F2-14 | ARSENAL page rendered black | ✅ | `PH[-1][1]` — a non-phase view hit the phase-indexed label. |
| F2-15 | Tabs did not survive a refresh | ✅ | The view lives in the URL hash. |
| F2-16 | Disconnected guns looked like critical errors | ✅ | New `waiting` status: blocks the start exactly like `red`, presented as inactive. |
| F2-17 | Armory did not show the guns we already know about | ✅ | Not a code gap — `~/.brx-mcp/armory.json` is git-ignored (it holds headset PINs) and this Mac had none. Copied; all four now show, unregistered ones under KNOWN GUNS — NOT SEEN. |

| F2-18 | "FIRST BLOOD should only be for the first kill of the match" | ✅ | **The scorer was right; the console feed was wrong.** `first_blood` is a single match-level field and tests fire it exactly once. The browser feed was append-only and **never cleared between matches**, so a second match's events piled onto the first's — two FIRST BLOODs and non-monotonic clocks (`t_match_s` is relative to each match's own start). The feed now resets when the match id changes. |
| F2-19 | Bottom of the LOBBY is small, uppercase, badly organised | ✅ | Underneath the layout was a **content bug**: `blockers` carried the advisories too, so `GUN LINK LOST — BLOCKS START, STALE LINK — DOES NOT BLOCK, SCREEN OFF — DOES NOT BLOCK YET` printed as one run-on blocker string — twice. Split into `blockers` and `ambers` server-side. The rail is rebuilt: one sentence-case status line, faults as a per-gun list, the countdown as a real picker instead of eight wrapping chips, and the override in its own tray rather than a second copy of the same sentence. |

| F2-20 | Powered-off taggers show as BLOCKED with a wall of red alarms | ✅ | A switched-off tagger produced up to **six red bars** — GUN LINK LOST, CLOCK NOT SYNCED, WRONG WI-FI, STALE LINK, PHONE BATTERY LOW, SCREEN OFF. Every one is a **consequence** of the node being gone. A node unheard-from for >10 min now says it **once** (`OFFLINE — LAST SEEN 18h13m`) and carries the non-fault `waiting` status: still gates the start, no longer painted as broken. Also fixed the durations — `1093m32s` and `STALE LINK (65612s)` are now `18h13m`, in the board text and in `fmtAge`. |

| F2-21 | Header is intimidating; PANIC should be a menu; want a debug page | ✅ | The permanent telemetry strip (NET / PHASE / UPLINK / JOIN / SESSION, 11px uppercase mono across every screen) moved to a new **Debug** page — session, network, a per-node table, and the full game config in effect. The header is now logo · six phase tabs · game state · **☰** (Arsenal, Debug, Panic). PANIC is no longer a permanent red button in the corner. Errors and the operator-token prompt stay in the header, because neither can wait for a menu. |
| F2-22 | Armory card: title wrapped, tag clipped, four meaningless rows | ✅ | The sticker usually already ends in the tail (`the control tagger`), so printing `-3D4F` again wrapped the title and pushed the status tag off the card. A tagger with no phone showed GUN/HEADSET/BATTERY as `—` plus an empty meter; it now shows LINK and LAST SEEN only. Each message is `STATEMENT — INSTRUCTION` and is rendered as two lines, the instruction in sentence case. |
| F2-23 | "What do these blue bars represent?" | ✅ | A `SegBar` rendered *after* each `Progress` number, so with two side by side the bar sat between `2/2 KITTED` and `0/2 READY` and read as belonging to either. The fraction already says it exactly, so the bar is gone. |
| F2-24 | KIT lists players with no phone or tagger as KITTED | ✅ | A restored roster outlives the gear. The loadout exists, the hardware does not, and calling that KITTED is a lie — those rows now read **NO PHONE**, and the KITTED count only counts players we can actually reach. (The full device-first restructure is still F2-12.) |
| F2-25 | Status line under CONTINUE was shouted and redundant | ✅ | Removed; the button carries its own state (`CONTINUE ▸` / `2 GUNS BLOCKED`) with the reason in its tooltip. Careful: it disables on **reds only** — amber never blocked continuing, and a first cut that required all-green would have stalled a board with a firmware advisory. |

| F2-26 | Voice picker showed a bare `·` after most names | ✅ | It marked "not confirmed by ear" — real information in a place that could not carry it: a `·` inside a native `<select>` has no legend and no tooltip. Asking what it meant *was* the failure. Gone; the Debug page says `15 personas · 1 confirmed by ear, the rest inferred`. |
| F2-27 | Designer: too much colour, too much caps, labels misaligned | ✅ | The class was printed on all 36 weapon tiles in its own saturated colour, on both halves of the screen, duplicating the five chips above — which were themselves solid colour fills. Tiles now show just the name (class stays in the tooltip). Chips carry colour on a 3px edge. The RULES row used `space-between` inside auto-fit cells of differing widths, so no control lined up with any other; now a fixed two-column grid with hints on their own line. Explainer paragraphs are sentence case. |
| F2-28 | LIVE and RECAP should be one view | ✅ | A match is either running or finished, never both, and the two screens shared their whole scoreboard. One **MATCH** tab now; it lands on the result if there is one, otherwise the live board. The views stay separate internally, so the phase-follow into `recap` is unchanged. |

## Session 1 — 2026-08-30, two iPhones, FFA
All ✅. See `experiment-log.md` 2026-08-30 for the full write-up.

Volume ≈ on-gun L2 · weapon meters all near-empty · the AR nerfed 100→190 ms · ALT weapon switch out
of sync until the trigger · no switch feedback · weapon name unreadable · countdown reset to 02:00 on
tab switch · a red row blocked the game with no override · recap read FINAL before the data was in ·
no way to view a previous match · no way to browse weapons without kitting someone · could not assign
a gun at all on a machine with an empty armory.

**Still open from Session 1:** the empty-mag prompt (F2 in FOLLOWUPS — gun and engine both proven
correct, so it is the phone's transport/render layer) and the weapon-swap duration, never measured.


## Check next match (folded in from `verify-together.md`, 2026-09-06)

Each item says **what to do**, **what would prove it**, and **what would disprove it**, ordered so an
early result does not depend on a later one. Ten minutes with two guns covers the lot. Everything here
is a fix that is shipped but unconfirmed on hardware, or a report that could not be reproduced. Before
you start, note **how long the guns have been powered** and whether a headset was re-seated: those are
the variables we keep failing to write down. The 🔧 rows above map to these: F2-3 → V5, F2-5 → V2,
F2-6 → V3, F2-8 → V6, F2-9 → V7, and Session 1's empty-mag prompt → V8. V3's "needs a new APK" was
met by 0.1.4 on 2026-09-04; 0.1.7 is the one the next match needs.

### V1 · Why did point-blank on the headset fail, when the headset was catching most hits? 🔴
**Shipped:** nothing — this is a diagnosis. The protocol doc has been corrected (below).

**It may well be an anomaly.** n=1, and the aggregate does not support a broken headset. Do not spend
a session hunting it. The point of this entry is that **the next occurrence is now cheap to capture**,
so play normally and look only if it happens again.

**The headset has FOUR sensors** (operator-confirmed 2026-09-01): `$HIR` tok1 **0, 1, 2 and 3 are all
headset**, `4` is the gun body. The doc previously listed only 0 = front, 1 = back, 4 = gun — so 2 and
3 read as unknown and every count that used "0 or 1" undercounted the headset by half.

Re-counted with all four and **split by match** (a blended figure mixes two very different things):

| match | headset | gun | headset share |
|---|---|---|---|
| the one reported as broken | **13** | 62 | **17%** |
| the later deliberate nozzle test | 95 | 0 | 100% |

17% is above Callsign's own native rate (3 of 23 ≈ 13%), so the headset was not dead. But one thing
is genuinely odd and is what V1 tests: **sensor 1 — the back dome — recorded ZERO hits in the reported
match**, and 69 in the test match.

**Do:** nozzle on each of the four sensor positions, 5 shots each; then the same from ~1 m. Watch MC's
live rows — `sensor` is reported now, so you can see WHICH of the four caught each shot.
**Proves it was aim/position:** the sensors that fail point-blank are the two we have never mapped
(2 and 3), or specific spots on the shell.
**Proves a real fault:** a sensor that reported hits earlier in the session stops reporting entirely —
then **change nothing**, Share log from that phone at once, and note gun uptime.
**Bonus:** this also maps 2 and 3 to physical positions, which nobody has done.

**If it recurs, three things now record it without you doing anything:** `hit_taken` carries the
sensor (so the live board shows a dome going quiet as it happens), the full game config and the
compiled head are stored per match, and the recap no longer drifts from the facts. The only manual
step left is **Share log before closing the app**.
**Worth knowing:** point-blank IR floods and `gotchas.md` warns it gets mis-attributed across sensors,
so 30–50 cm may be the more honest test.

### V2 · Does the low-health alert fire, and is it bright enough? 🟠
**Shipped:** `$PLAY,VA8B` + `$HLED,7,4,90,90,10,15` once per life, byte-identical to Callsign.
Our trigger fires on the first HP-only frame; **Callsign's two observed alerts both came at `$HP,34,0,0`**,
two hits later, so an HP threshold fits its behaviour as well as "armour 0" does. n=2.
**Do:** take a player's armour to 0 and keep hitting them.
**Proves working:** their headset lights, and the HUD log shows `low-health alert: armour 0, hp NN`.
**Proves broken:** log line present but no light → the frame itself is wrong. No log line at all → our
trigger never fired, and that is ours to fix.
**On making it brighter — now MEASURED impossible (bench 2026-09-03): `$HLED` token 5 is 1 = dim, 2/10/255 identical and maximum. Callsign's 10 is already full.** The paragraph below predates that measurement and is kept for the reasoning.
**On making it brighter — probably impossible, and worth knowing before anyone tries.** The Windows
lane measured `$GLED` token 5 by luminance on 2026-09-02: it is a brightness with exactly **two levels
above off** (1 ≈ 70%, anything ≥2 is full and identical up to 255), and **Callsign's 10 is already in
the saturated region**. If `$HLED` matches, we are already at maximum and no value will help — a dim
alert would be a hardware limit. That is still an inference across two different commands, but it is
far cheaper to check than to sweep: confirm the alert fires, then look at whether it is bright enough
at 10. Only if it is genuinely dim is a sweep worth running.
**Why:** it did not fire last session and we could not tell whether it had even been attempted.

### V3 · Does the headset show the team colour pre-game AND for the whole life? 🟠
**Mechanism found on the bench 2026-09-03:** `$SPAWN` CLEARS the headset, and so does every registered
hit (native flash, then dark; our colour never returns). That is why it showed "on death, not
pre-game": the lobby frame was wiped the moment the game started. **Shipped:** the same
`$HLED,<tid>,0,,,10` now ends the `spawn` and `revive` bundles and the phone re-sends it
(`cues.team_led`) after every damaging hit except the low-health one. Needs a **new APK**.
**Proves working (new):** both headsets in their team colour after KIT, again right after the whistle,
and STILL in it after taking hits. **Proves broken:** dark after the first hit → the phone-side
repaint is not landing; dark after the whistle → the tail frame is being dropped behind `$SPAWN`.
Original item:

**Shipped:** `$HLED,<tid>,0,,,10` at the end of the game head.
**Do:** look at both headsets after KIT and before the countdown, in a **TDM** game so the two teams
send different values.
**Proves working:** two different colours, matching the teams.
**Partly:** colour appears but only at death (what happened last time) → our frame is in the wrong
place. Callsign sends it in the **lobby**, paired with a `$GLED` ~200 ms earlier; we send it mid-head.
**Why:** no capture has ever sent a tid above 1 to a headset, so yellow's `$HLED,2` is new ground.

### V4 · Do the personas sound different? 🟠
**Shipped:** 15 voice packs; `$PSET`'s six voice slots now follow the player.
**Do:** set one player to **HEAVY** (the control — the pack we always shipped, decoded by ear) and the
other to **MEDIC** or **RAIDER**. Get each killed.
**Proves working:** audibly different death screams and kill lines.
**Proves broken:** silence on a non-Heavy persona → that family's ids are wrong despite being real
bank entries, and the layout inference in `VOICE_PACKS` fails. A *wrong but real* sound is expected
and fine; silence is not.

### V5 · Does a gun powered on mid-setup reconnect by itself? 🟠
**Shipped:** reconnect now retries forever in every phase (it used to stop after ~25 s), and the
GUN LINK LOST pill is a tap-to-reconnect button.
**Do:** with a phone kitted, switch its gun **off**, wait a full minute, switch it back on. Do not
touch the phone.
**Proves working:** it relinks on its own within ~10 s and the MC row clears.
**Proves broken:** still down after a minute → tap the pill; if that works, the retry loop is dying.

### V6 · Does END MATCH EARLY reach the HUDs? 🟠
**Shipped:** MC now reports `END REACHED n OF m NODE(S)` — red when 0 — and the HUD logs
`control end ignored — phase is X` instead of dropping it silently.
**Do:** mid-match, press END MATCH EARLY.
**Proves working:** reach count equals your node count and both HUDs show the result screen.
**Diagnostic:** reach 0 → it never left MC. Reach 2 but no HUD change → check each HUD's log for the
`ignored` line; **the phones were in `kitted` last time, where end is a no-op.**

### V7 · Do the perk controls read now? 🟢
**Shipped:** the WEAPONS | PERKS | NONE controls went from 34 px chips to 46 px, and they are the
only route to perks.
**Do:** on the phone, open the loadout browser, go to the **secondary** slot.
**Proves working:** you can find and hit PERKS without being told where it is.

### V8 · Does the empty-mag prompt appear? 🟠
**Shipped:** nothing — gun and engine are both proven correct, so this is the phone's render path.
**Do:** empty a magazine on full auto and watch the HUD.
**Proves working:** RELOAD appears and the counter reads 00.
**Proves broken:** then **Share log immediately** — the frame ring will show whether the `$ALCD,0`
even arrived. Do not close the app first.

---

### Not on this list, and why
**A game whose rules fix the weapon/perk did not apply them** (F2-7). I have no repro and no evidence
— the config id was not captured. Next time it happens, note the **game name and config id** from the
GAMES screen before changing anything, and I can replay the exact push.
