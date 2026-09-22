# mcp/tools

This folder holds generators, shared helpers, and bench instruments used to develop and test the
BRX tagger protocol and Mission Control. Most tools that talk to a real gun over Bluetooth run on
Windows Python via WSL interop, because WSL2 has no Bluetooth here; each tool's own docstring says
whether it is Windows-side or WSL-side. Where a tool shells out to `adb`, it reads the `BRX_ADB`
environment variable first and falls back to `adb` (or `adb.exe` on the Windows-side tools) on
PATH, so no personal machine path is hardcoded.

## Generators (tests gate these)

| Tool | Purpose |
|---|---|
| `gen_contract.py` | Generates `contract.gen.ts` / `.js` / `.d.ts` from `mcp/brx_mcp/mc/types.py` + `envelope.py`. Regenerate after you edit the source, or a test fails (`mcp/tests/test_contract_generated.py`). |
| `gen_ui_catalog.py` | Regenerates the weapon and perk catalogue blocks in `webapp/mc/src/mock/data.ts` and `app/src/demo-catalog.js` from the server's own catalogues. Regenerate after you edit the source, or a test fails (`mcp/tests/test_ui_catalog_generated.py`). |

## Shared helper (not a runnable tool)

| Tool | Purpose |
|---|---|
| `bench_common.py` | Shared bench frames (AR/PSET/SIR/GSET) and the connect/disconnect ritual, imported by other bench tools. It has no `main` and is never run on its own. |

## Live-bench instruments (talk to real hardware)

| Tool | Purpose |
|---|---|
| `ally_remeasure.py` | Re-measures ally `$SIR` functions from a depleted victim pool, so a heal/grant does not clamp and get mis-binned as a status function. Windows-side (Bluetooth). |
| `armgen.py` | Prints one complete arm sequence with `$WEAP` token overrides and `$SIR` edits, verified complete. Sends nothing; runs under the WSL venv. |
| `beacon_scan.py` | Watches Open BRX station/player BLE adverts and their RSSI, standing in for a player phone. Windows-side (BLE scan only). One-off bench experiment, kept for reference. |
| `derive_callsign_data.py` | Restates raw Callsign APK config assets (sound durations, medal text) as our own derived JSON. Reads a local, gitignored input path only. |
| `ff_ab.py` | Controlled A/B test of whether `$GSET` friendly-fire token gates IR registration. Windows-side (Bluetooth). |
| `firemode_probe.py` | Pushes one weapon with raw token overrides and leaves the gun live, for probing a single `$WEAP` token. |
| `grenade_bench.py` | Full grenade IR bench: RF presence, beacon decode while connected, Respawn-mode revive paths, Hill impersonation, and replay-word printing. |
| `hittest.py` | One clean two-gun hit test: arms shooter and victim, fires a timed window, reports shots fired vs hits registered. |
| `led_flashcam.py` | Measures LED flash brightness objectively via phone camera + the gun stage, alongside a native-flash reference. WSL-side, uses the WSL-paired `adb` and the Windows-hosted stage. |
| `ledcam.py` | Bench camera rig: captures/diffs/probes tagger and headset LED colour and flash timing over wireless `adb`, so LED behaviour is measured, not eyeballed. WSL-side. |
| `loopback.py` | Rig calibration: checks that the emitter board's IR reaches the receiver board bit-exact, before trusting any other IR result. |
| `mc_driver_bench.py` | End-to-end bench test of the real Mission Control `GameDriver` arming path, including the F11 `$CLEAR`/`$SIR` recovery. |
| `native_capture.py` | Captures a native gun's IR words (abilities, alt-fires, grenades), working around the F12 frame-splitting bug in the receiver firmware. |
| `quick_victim.py` | Minimal victim arming config, kept small so a flaky BLE link can finish the push. One-off bench experiment, kept for reference. |
| `range_step.py` | Runs one rung of a distance ladder, reporting witnessed hit rate at that range, to separate emitter margin from tagger fault. |
| `raw_weapon.py` | Pushes one raw `$WEAP` frame with full tutorial arming scaffolding. One-off bench experiment, kept for reference. |
| `sendframes.py` | Sends one or more raw frames to a tagger and prints each reply. |
| `victim_count.py` | Arms a victim properly and counts `$HIR` registrations over a timed window. One-off bench experiment, kept for reference. |
| `weapon_range.py` | Cycles every catalogue weapon onto one bench gun for a fixed dwell each, for a full-arsenal firing pass. |
| `webview_eval.py` | Runs a JavaScript expression inside the BRX app's WebView over `adb` port-forward, for driving/inspecting the live app engine. Windows-side (adb port-forward needs Windows localhost). |

## Offline analysis and conversion (no gun, no BLE)

| Tool | Purpose |
|---|---|
| `fw_commands.py` | Lists bounded `$` command names from one caller-supplied private firmware image. Prints names only; never copies or searches for images. |
| `fw_audio_compare.py` | Streams a caller-supplied private audio-update ZIP and an off-repo bank, then prints sorted same/changed/new IDs, counts, the public archive hash and one aggregate bank-manifest hash. Never extracts audio or prints private paths or per-file hashes. |
| `ltp_convert.py` | Converts any audio file into a `.LTP` on-gun sound (headerless raw PCM, s16le, mono, 44.1 kHz). |
| `soundbank_analyze.py` | Turns a folder of BRX sound files into a machine-readable catalogue: transcripts, acoustic descriptors, spectrograms. |
| `soundbank_classify.py` | Assigns each on-gun sound a category and plain-English description, from `soundbank_analyze.py`'s output. |
| `balance_sim.py` | Monte Carlo balance sim for every catalogue weapon: a 1v1 duel matrix, a team table against an anchor weapon, and a parameter sweep (`--preset toxin` is the Toxin Rifle study). Reads every number from `WeaponCatalog`; an importable library with a `main()`. See `docs/weapon-design.md` §7.5c. |
| `soundbank_leadin.py` | Measures lead-in silence, attack time, and trailing silence in bank clips, to separate clip padding from firmware audio latency. |
