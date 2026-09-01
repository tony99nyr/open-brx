# Field issue register

**Every issue reported from a live session, and what happened to it.** Nothing here is closed on a
guess: an item is DONE only when the fix is in and tested, and OPEN items say what evidence would
settle them. Newest session first.

**Add to this file the moment an issue is reported**, before diagnosing — that is the point of it.
Cross-references: `docs/FOLLOWUPS.md` (all open work), `docs/experiment-log.md` (the lab notebook).

Legend — ✅ fixed & tested · 🔧 fixed, needs a field check (see **[verify-together.md](verify-together.md)**) · 🔍 open, evidence named · 💭 open, design

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

## Session 1 — 2026-08-30, two iPhones, FFA
All ✅. See `experiment-log.md` 2026-08-30 for the full write-up.

Volume ≈ on-gun L2 · weapon meters all near-empty · the AR nerfed 100→190 ms · ALT weapon switch out
of sync until the trigger · no switch feedback · weapon name unreadable · countdown reset to 02:00 on
tab switch · a red row blocked the game with no override · recap read FINAL before the data was in ·
no way to view a previous match · no way to browse weapons without kitting someone · could not assign
a gun at all on a machine with an empty armory.

**Still open from Session 1:** the empty-mag prompt (F2 in FOLLOWUPS — gun and engine both proven
correct, so it is the phone's transport/render layer) and the weapon-swap duration, never measured.
