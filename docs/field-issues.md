# Field issue register

**Every issue reported from a live session, and what happened to it.** Nothing here is closed on a
guess: an item is DONE only when the fix is in and tested, and OPEN items say what evidence would
settle them. Newest session first.

**Add to this file the moment an issue is reported**, before diagnosing — that is the point of it.
Cross-references: `docs/FOLLOWUPS.md` (all open work), `docs/experiment-log.md` (the lab notebook).

Legend — ✅ fixed & tested · 🔧 fixed, needs a field check · 🔍 open, evidence named · 💭 open, design

---

## Session 2 — 2026-09-01, two Android HUDs, TDM, outdoors
Evidence: `~/.brx-mcp/mc/session-8bbf96ab.sqlite` (both phones' BLE frame rings were shared).

| # | Reported | Status | Where it stands |
|---|---|---|---|
| F2-1 | Headset domes never registered a hit; nozzle held on the dome, both directions, both headsets | 🔍 | **Intermittent — the domes came back on their own.** That match: 10/10 `$HIR` on sensor `4` (gun body), zero on the domes. Later the same day they worked, verified indoors **and** outdoors in direct sun, **with the venue still set to OUTDOOR**. ⛔ **`outdoorMode` is NOT the cause** — I proposed it (the only `$GSET` token where we differ from all 19 captures) and the test refuted it: we were still sending `outdoorMode=1` and the domes worked. Daylight is out too — native outdoor play has always worked. What DID change in between: the guns were **power-cycled** (F2-3) and the session was re-made; `gotchas.md` already warns that day-long-powered taggers misbehave. **Next time it happens:** note gun uptime and whether the headset was re-seated *before* changing anything else. `hit_taken` now carries the sensor (F2-2), so the board shows it live. |
| F2-2 | `hit_taken` could not show which sensor fired | ✅ | Sensor forwarded to MC. Found a **pre-existing bug doing it**: `ir_proto` read `$HIR` token 1, which is the *sensor* — every hit fact ever recorded carried that mix-up. Both fixed, test added. |
| F2-3 | Gun powered on did not auto-reconnect; HUD blinked GUN DISCONNECTED, MC blocked; needed the debug menu | 🔧 | Reconnect was unbounded only in `armed`/`live`; elsewhere it stopped after 6 tries (~25 s) — about how long a switched-off gun takes to burn them. Now retries **forever** in every phase (backoff caps at 10 s, ~6 attempts/min), and the GUN LINK LOST pill is now a **tap-to-reconnect button** instead of a status. |
| F2-4 | SHARE LOG dumped text to copy-paste | ✅ | On success it now reports bytes + frame count and returns. The share sheet is the fallback for when MC cannot take it, and says so. |
| F2-5 | Dying produced no green flash (native does) | 🔍 | The alert shipped in 0.1.1 and did not fire. The only `$HLED` in either ring is our END_SEQUENCE blanker — but rings hold 60 frames and both end at teardown, so **absence is not proof**. Needs a log line when the cue fires. |
| F2-6 | Headsets showed team colour on DEATH, not pre-game | 🔍 | Consistent with the Windows lane's correction: our `$HLED` sits mid-head, where Callsign sends it as a LOBBY frame paired with `$GLED`. Try matching position and pairing. |
| F2-7 | A game whose rules fix the weapon/perk did not apply them | 🔍 | No evidence captured. Needs a repro with the config id noted. |
| F2-8 | END MATCH EARLY on MC did not reach either HUD | 🔍 | `control{end}` fan-out. Both nodes were `wsState: bound` at the time, so not a transport drop. |
| F2-9 | Perks menu on the phone is small and hard to find | 💭 | UX. |
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
