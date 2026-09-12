# Handoff — Open BRX

**State as of 2026-09-12 (evening: contract DRY landed, the A28 backhaul PR merged, APK 0.2.0 cut).** One screen. Open work: `FOLLOWUPS.md`; evidence: `experiment-log/`; old banners: `git log -p -- docs/HANDOFF.md`.

## ⭐ Contract DRY landed (2026-09-12, `86a8c3a` + `be1ce39`): one machine source for the node↔MC wire

The wire tables (kinds, required fields, event types, size caps, timing constants) and 18 shared
TypedDict shapes lived three times — `envelope.py`, `envelope.js`, `types.ts` — and a mechanical diff
found them already apart: `possession` was a persisted event in Python, missing from the phone's
whitelist; `result` needed six fields on the MC side and one (`match_id`) on the node side, a silent
asymmetry until now, explicit as `ACCEPT_MIN` (the A24 rule: a result must reach the engine even short
a field). `mcp/tools/gen_contract.py` renders `webapp/mc/src/api/contract.gen.ts` and
`app/src/transport/contract.gen.js` from `mcp/brx_mcp/mc/types.py` + `envelope.py`;
`mcp/tests/test_contract_generated.py` (no skip path) fails CI on drift, under bare system
python. `envelope.js` re-exports the generated tables under the names it already exported (no importer
changed); `types.ts` re-exports the generated shapes and declares none itself. `_REQUIRED`/
`_EVENT_REQUIRED` are now public `REQUIRED`/`EVENT_REQUIRED`. `webapp/mc` runs `npm run typecheck`
(`tsc -b`) in CI before `vitest`, which type-checked nothing before this.

**Regenerate after touching `types.py` or `envelope.py`:** `python3 mcp/tools/gen_contract.py` from
the repo root. **Never hand-edit `contract.gen.ts` / `contract.gen.js`.**

**Still hand-written, not generated:** the ~29 UI-only view types (`State`, `LiveView`, `RecapView`,
`NodeView`, `StationView`, `WeaponView`, …) — `api.py` builds them untyped, no Python shape exists yet
to generate from (FOLLOWUPS F42.9); `webapp/mc/src/mock/policy.ts DEFAULT_POLICY` (mirrors `policy.py`'s
default — logic, not a shape); `beacon.js KIND`/`utility.js KIND_LABEL` (mirror `STATION_KINDS`, pinned
by a node test, not generated); `webapp/mc`'s `tsconfig` is not `strict` yet (F42.11); `envelope.js`/
`transport.js` have no JSDoc + `checkJs` reading a `.d.ts` yet (F42.12); pyright for `mcp/` is unstarted
(first manual run 2026-09-12: 249 errors, 81% of defs already annotated — F42.10).

**Concurrency lesson:** a `git commit --only <file>` from another session, while this lane had
`types.py` open, swept 139 unrelated lines into `be1ce39` alongside the intended app-version bump —
correct content, just co-authored by an accident of timing. Diff what `--only` is about to commit, not
just the path list, whenever more than one session has the same file open.

**This session regenerated the site shots** (`cd site && npm run shots`, because `app/src` and
`webapp/mc/src` changed) but did not run the site gate (`cd site && npm test`): nothing under
`docs/platform/` or `docs/manual/` changed.

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
- **A28 BACKHAUL (PR #3, same day):** a phone with a data plan reaches MC off the field Wi-Fi via a
  cloudflared quick tunnel, no per-phone setup; the node prefers backhaul when offered; coverage is
  derived. Merged as `6925d32` (22 conflicted files resolved by hand; the wire gained `join`); the
  full suites ran green on the merged tree except `test_site_shots`, which regenerates with the shots.
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

1. **Install APK 0.2.0 on a real Android phone** and run one match against the merged MC (the wire
   gained `result` and `join`; `types.APP_MINOR` moved with it in `be1ce39`).
2. **Contract follow-ups, in order of payoff:** view TypedDicts in Python so the ~29 hand-written
   `types.ts` view shapes can be generated (F42.9), pyright as a `mcp/` gate (F42.10), `strict: true`
   for `webapp/mc` (F42.11), JSDoc + `checkJs` on `app/src/transport` (F42.12).
3. **Bench-gated residuals:** F121 (spawn protection during the countdown), F113 (death-blank LED),
   F123 (reload bar vs. `$ALCD`), F126 (iPhone WKWebView font); keyboard-only: F129 (M2 UI polish),
   F130 (unsynced-node late flush), the generated-contract follow-ups (F42.9–F42.12, all `build`, none
   blocking).

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
