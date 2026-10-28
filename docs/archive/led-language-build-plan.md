# LED language build plan (S10), archived

This is section 7 of `docs/led-language.md`, as planned 2026-09-06. The build half of S10 closed on 2026-10-03 (see `followups-closed.md`: A16 shipped in app 0.1.8 and passed state by state on a gun 2026-09-09). The open rest is in `docs/post-mvp.md`. This page is history. Do not cite it as a source of fact.

## 7. Build plan (S10), by subagent (as planned 2026-09-06; FOLLOWUPS S10 holds what is still open)

Contract first, then four parallel lanes with disjoint files, sonnet for the mechanical lanes:

1. **Contract** (main session): A16 text in `contracts.md` §3 + FrameBundle, `presentation.lights` shape, bundle
   tables (§5), `HEADSET_TIDS`, `$LED` shape decision after bench L2.
2. **MC lane** (`presentation.py`, `compile.py`, `poolgauge.py`, `state.py` validation, `test_presentation.py`,
   `test_poolgauge.py`): lights block + overlay + collapse map; identity team table; readout tables; role
   states; down block; delete `is_night_mode`; docstring sweep.
3. **Engine lane** (`engine.js`, `engine.test.mjs`): readout with hold/coalesce/reload glance; died ends dark;
   down pulse quiet gaps + eliminated cadence; respawn flash at +1.0 s; role re-assert after hits; `_lightGen`;
   delay floor. HUD copy goes to the brx-hud session.
4. **Console lane** (`AdvancedPresentation.tsx`, `types.ts`, `client.ts`, mock): lights block editor + preset
   preview sentence + muster lights check (`ui-build-verify`).
5. **Docs lane** (haiku/sonnet): protocol rows (`$LED` shape, `$HLED` blank), manual "reading the headset" table,
   gotchas line, `poolgauge.py` header, FOLLOWUPS/HANDOFF.
Gate: the bench ladder (§6 of the flash-control sheet) before lane 3's down-signal timing is final; everything
else can build now.
