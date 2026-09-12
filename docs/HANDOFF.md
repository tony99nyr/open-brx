# Handoff — Open BRX

**State as of 2026-09-12 (afternoon: the BACKHAUL FIELD TEST — three matches through a real tunnel, Pixel 10 on cellular — and the fix lanes it spawned).** One screen. Open work: `FOLLOWUPS.md`; evidence: `experiment-log/`; old banners: `git log -p -- docs/HANDOFF.md`.

## ⭐ Backhaul field test (2026-09-12, midday) — it works, and it told us exactly what is missing

MC ran inside WSL with `--tunnel` (real cloudflared, first ever), so every phone had to come in through the tunnel:
Pixel 10 on cellular with Wi-Fi OFF, Pixel 4 on home Wi-Fi. Three FFA matches. **Proven:** join over cellular ·
strangers refused `4004` · coverage FULL 2/2 derived · every kill scored and **KILL CONFIRMED on the shooter's HUD**
(B30's gate) · END from MC, result to both HUDs · background log sync pulled both logs unasked · store-and-forward across
a REAL data loss flushed exactly once and re-sent the result · tunnel down/back → stale-not-gone, rejoin rebound by gun.
Full entry: `experiment-log/2026-09.md` "BACKHAUL FIELD TEST". Session store: `~/.brx-mcp/mc/session-43db6f6b.sqlite`.

**Needed one fix before anything worked (F136, closed):** MC bound the node socket to the LAN IP only, so cloudflared's
loopback origin got 502. **The five that matter, all filed and in flight on branch `field-2026-09-12`:**
- 🔴 **F153** reconnect after a data blip took ~3 min (the LAN dial has no giveup; Android's 2 min connect timeout);
  a fresh QR scan waited behind the same hung dial. Tony: "impatient players won't wait".
- 🔴 **F156** no way back to SCAN QR once the HUD holds an address → a tunnel restart stranded both phones until
  their app data was cleared. "Clear storage shouldn't be a normal workflow."
- 🔴 **F140** the tunnel hostname is announced UP before some resolvers can see it (home router: ~250 s NXDOMAIN).
- 🔴 **F142** two --demo players were restored into the real session, invisible on the board ("big bug").
- 🔴 **F146** the one-magazine guard blocked the push twice (pistols-only fallback; a sidearm vs Body Armor pool).
Plus F135-F157 + F161, K7-K8, S37-S41, D5 (FOLLOWUPS). Fix lanes: app transport (opus) · HUD (sonnet) · MC server (opus) ·
MC UI (sonnet), then a polish loop and a PR. **APK 0.2.0 has NO backhaul code** (cut from a pre-merge commit): the
phones ran a tree build; cut 0.2.1 from the merged branch before any field day.

## What is true today

- ⭐⭐ **KING OF THE HILL IS BUILT, END TO END, THROUGH THE GUN OVER BLE**, and MC arms a phone point.
  `proto=15 team=<owner> mag=8` every 5.0 s, neutral = team 2, `mag=50` new owner, `mag=53` only when
  NEUTRAL. Ship `$SIR,15,0,,28`. `hillbeacon.py` · `DominationEngine` · `control.js` (phone point) ·
  MC's `koth`. Spec: `spec/utility.md` §5b–§5d.
- ⭐⭐ **SIMULATED RECOIL IS REAL (F46).** `$WEAP` t21/t22 = accuracy ceiling/floor, `$ALCD` tok2 = live
  accuracy; below the ceiling a shot emits IR magnitude 0 — a real miss the player feels natively.
  Stock 100/100 = OFF. Ship via S17 after F68.
- **The stack runs whole matches on real hardware.** MC compiles a per-player `FrameBundle`; each
  phone drives its own gun over BLE and reports over the LAN. MC is setup/start/recap only, never
  BLE-connected during play. Verified FFA/TDM/1v1 (2026-08-30, 09-01, 09-11).
- **Game-test milestones 1+2 are IN (2026-09-12):** spawn protection (A23), match results replayed
  from stored facts on a late flush (A24), background log sync (A25), try-out collapse (A26), guarded
  CONTINUE (A27), semver build reporting (A29), kit-locks-at-start (A30), verify-at-MC line (A31),
  link-proves-headset (A32). Sheet: `game-test-2026-09-11.md`; log: `experiment-log/2026-09.md`.
  🟡 bench-gated: F121 (fn 28 spawn protection), F113 (death blanks the strip), F123 (reload bar), F126
  (iPhone). **APK 0.2.0 was cut from `47a71bd`** (`0dee568`, the sidecar points at release app-v0.2.0); not yet verified on a real phone.
  **Round 2 closed (88b4d20):** the per-node pick debounce (a slot switch lost the first pick) and the foreground reconcile (a
  free magazine on screen-off/on) are fixed; F129 residuals landed; **F133** filed (kit-lock latch vs a re-pushed game).
  **APK 0.2.0 published** (`app-v0.2.0`, `APP_MINOR = 2`); the Android in the field is still on 0.1.8 until installed.
- **A28 BACKHAUL (PR #3) is merged AND field-proven (above).** The node prefers backhaul when offered; coverage is
  derived; the secret gate held against strangers on a real tunnel. Operator steps: `docs/platform/run.md`
  "Reaching phones over the internet" (never turn the tunnel off mid-session; wait for UP).
- **Contract DRY (`86a8c3a` + `be1ce39`):** one machine source for the wire — `mcp/tools/gen_contract.py` renders
  `contract.gen.ts`/`contract.gen.js` from `types.py` + `envelope.py`; `test_contract_generated.py` fails on drift.
  Regenerate after touching either file; never hand-edit the generated files. Still hand-written: ~29 UI view types
  (F42.9), `strict` (F42.11), JSDoc+checkJs (F42.12); pyright gates `mcp/` in CI (F42.10 closed, `stage.py` excluded: F42.14). Lesson: diff what `git commit --only` is about
  to commit when another session has the file open.
- **Doc-rot review (2026-09-12):** repo-wide read-only pass, ~55 P1 findings, applied in nine
  `--only` commits: one generator for both UI catalogs, new hygiene guards (dead links, closed ids
  cited as open, amendment citations resolve to real code), 39 closed-experiment scripts deleted.
- **Presentation profile (A11)** is built: presets, per-event sound + gun-LED burst + headset colour.
  **Voices (A15–A15.3):** 24 personas, varied per event, ours for spawn/pain, native for the scream.
  **Loadout:** three slots (A14), sidearms (A12), Quick Switch via `$WEAP` tok15 (F4/F22).
  **LEDs (A16–A16.5):** team-colour dim rest + transient pool readout, night overlay, down pulse.
  **Utility station (A13):** MC arms a spare phone as a BLE-beacon respawn station from MUSTER ITEMS.
- **Hit audio (A17):** metal for armour, an energy note for shield, health deliberately silent (an
  empty slot falls through to the neighbouring pool, not to nothing). `low_health` fires below 15 HP.
- **The public site has two doors, one source:** `docs/platform/*.md` → `/`, `/docs/*`, `/download`;
  `docs/manual/*.md` → `/manual/*`. Plain markdown, no dates/versions/status words allowed in it. Gate:
  `cd site && npm test`.
- **Environment:** WSL2 has no Bluetooth; anything touching a gun runs under
  `/mnt/c/Users/Tony/.brx-mcp/venv/Scripts/python.exe`. `~/.brx-mcp/armory.json` never in git (headset
  PINs); use `Tactix-XXXX` in docs, never sticker ids. Remote is `tony99nyr/open-brx`.

## Next actions

1. **Land the field-fix PR from `field-2026-09-12`** (F153 F156 F140 F142 F146 F144 F155 F154 F150 F146 F141 …), then
   **cut APK 0.2.1** from merged main — 0.2.0 cannot use the backhaul — and install it on both Pixels.
2. **Re-run the two field scenarios that failed** with the new build: data off/on on the Pixel 10 (rejoin in seconds,
   not minutes) and a tunnel restart (rescan from the HUD without clearing storage).
3. **Bench-gated from the field:** F148 (hit during the redeploy screen) and F152 (headset blinking green after
   redeploy) — the frame order at respawn; still open from before: F121/F113/F123/F126.
4. **Decisions for Tony:** D5 pistol balance (Deagle 3-hit, Extended Mags on a pistol primary), K7 shields (needs a grant
   mechanism first), K8 a volume knob at MC; the manual `--public-url` / named-tunnel path is untested.
5. Contract follow-ups F42.9, F42.11, F42.12, F42.14 (pyright now gates `mcp/` in CI; `stage.py` excluded), none blocking.

**Bench sheet:** [`bench-critical-2026-09-11.md`](bench-critical-2026-09-11.md). Queue:
[`bench-queue-2026-09-09.md`](bench-queue-2026-09-09.md). Register: FOLLOWUPS §9. Pre-flight: `gotchas.md`.

## Machine roles

**Windows PC (WSL2 + Windows Python)** = primary development. **MacBook** = field / match day, and the
only capture rig (Callsign is effectively iOS-only). Code must run on both: macOS gives BLE UUIDs,
Windows/BlueZ gives MACs.

## Where things live

| what | where |
|---|---|
| Open work, all of it, by id | `FOLLOWUPS.md` (incl. "Needs Tony at the bench") |
| Evidence, append after every session | `experiment-log/` (by month) |
| Field lore by symptom, bench pre-flight | `gotchas.md` |
| Issues at a live session · Mac-only capture jobs | `field-issues.md` · `capture-runbook.md` |
| Start MC with no hardware / running a match / armory + muster / Mac setup / one-gun bench page | `../mcp/brx_mcp/mc/README.md` → *Start it* · `field-runbook-mc.md` · `field-process.md` · `mac-dev-runbook.md` · `gun-stage.md` |
| Spec of record / protocol truth / confirmed BRX facts | `spec/contracts.md` · `../protocol/brx-protocol.md` · `manual/` |
| Node↔MC wire contract, machine copy | `mcp/brx_mcp/mc/types.py` + `envelope.py`, generated into `contract.gen.ts`/`contract.gen.js` by `mcp/tools/gen_contract.py` |
| History: closed bench sheets, superseded spec modules, design exports | `archive/` |
