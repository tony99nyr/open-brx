# Raw extracted assets — policy (exception closed 2026-09-07)

Repo policy for this teardown: **document facts in our own words; never commit raw APK assets.**

From 2026-08-24 to 2026-09-07 this directory held five raw config JSONs from Battle Company's
Callsign app, committed verbatim as a **deliberate, temporary exception** while the repo was still
private and under active construction. That exception is now closed — the repo is MIT-licensed and
heading for public release, so the raw files are gone:

| Raw file (removed) | What replaced it |
|---|---|
| `LayoutOrientations.json` | nothing — no code or doc referenced it; deleted outright |
| `weapon-categories-config.json` | facts already restated in `config-facts.md` |
| `streak-rewards-config.json` | facts already restated in `config-facts.md` |
| `Sounds.json` | `mcp/brx_mcp/data/sound_ids.json` (id → duration, our own shape) |
| `game-medals-config.json` | `mcp/brx_mcp/data/medals.json` (key/name/description/window_s, our own shape) |

The last two were load-bearing (read by tests that ground every sound id and voice-pack duration
the server ships against the app's own bank), so they were **restated, not just deleted**: the
derived JSON files above carry only the factual values we actually use (ids, durations, names,
award-window seconds), each file's header records what it was derived from, when, and by which
script.

**If a maintainer needs to regenerate the derived files** (a newer Callsign build, say): pull a
fresh raw config per `apk-harvest.md` "Reproduce" into a **local, gitignored** path —
`protocol/callsign-extract/.raw-assets/` (see `.gitignore`) — then run
`mcp/tools/derive_callsign_data.py` against it. That script documents the exact shape of both
outputs. **Never commit a raw asset file to this repo again**, under this directory or anywhere
else — the small-utility exception that used to live here is over.

The raw APK and decompiled tree were never committed either — only these five small config JSONs,
now gone too.
