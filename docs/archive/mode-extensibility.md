# Mode extensibility: can outsiders build their own game modes? (review, 2026-09-04)

A critical review of the game-config + mode-registration path, from the angle of **opening the project up**:
when a contributor wants to implement their own mode idea, how far do they get with JSON, and what does a
genuinely new ruleset cost? A parallel section at the end covers the same question for **custom sound packs /
announcers** (Halo, UT, …). Companion to [`mode-readiness.md`](mode-readiness.md) and
[`m0-game-engine.md`](m0-game-engine.md). Names code as `file:line` so it can be re-checked.

## Verdict

Two answers, depending on what "their own idea" is:

- **Re-parameterize or re-skin a *shipped* mode** (a faster TDM, low-HP snipers, custom sounds/LEDs,
  different loadout rules): **well supported by JSON today.**
- **A genuinely new *ruleset*** (a new win condition or objective interaction): **not easy.** It requires
  Python across ~4 core files, and the JSON wire schema **cannot carry a new mode's parameters at all**. A
  contributor can't do it in JSON alone, and the (clean) code seam is not a documented plug-in point.

## What's strong — keep it

- **The engine seam is well-designed.** `GameEngine(ABC)` (`modes/base.py:181`) is four methods —
  `add_player`, `on_event`, `tick`, `snapshot` — and modes emit a **semantic Action vocabulary**
  (`Respawn`, `Heal`, `PlaySound`, `KillConfirm`, `Callout`, `Score`, `Eliminate`, `GameOver`, `SetTeam`,
  `SendFrame`; `base.py:30-121`). A mode author never writes a raw BRX frame — they express intent and the
  driver translates. This is the hard part done right; a new mode is one focused class.
- **The JSON already parameterizes a lot for shipped modes** (`mc/types.py:GameConfig`): health caps,
  respawn type + delay, scoring (`frag_limit`/`win_by`), teams, loadout policy, and a rich `presentation`
  block (per-event sounds + LED bursts, preset or fully custom). Reskins and rule-tweaks of existing modes
  are easy and data-driven. Loadout/perks/presentation are genuinely expressive over the wire.

## The gaps (critical, priority order)

### G1 — The JSON wire schema is mode-agnostic; it has no slot for mode-specific parameters
`mc/types.py:GameConfig` carries `mode, health, respawn, scoring, teams, loadout_policy, presentation` and
nothing else. There is **no field for** `detonation_s`, `control_points`, `channel_s`, `drop_policy`,
`rounds_to_win`, respawn `ramp`, or `lives`. Those exist **only** in the separate CLI dataclass
(`gameconfig.py`). So on the match-day (Mission Control) path you cannot configure an objective mode at all,
let alone a new one. **Highest-leverage fix:** add a `mode_params: dict` (or `rules: dict`) opaque bag to
the wire schema, validated by the engine itself.

### G2 — Two divergent config schemas, no single source of truth
`gameconfig.py` (a rich flat dataclass, CLI/sim path) vs `mc/types.py:GameConfig` (a lean TypedDict, the
wire). They have **already drifted** — the dataclass has a dozen fields the wire lacks (all the mode-specific
knobs, `respawn_ramp`, `respawns`, `syphon*`, `regen*`, `crit_modifier`, `alt_reload`…). A contributor has to
reconcile both. **Fix:** unify to one schema (generate/derive one from the other) and publish a machine-
readable **JSON Schema** contributors can validate against.

### G3 — Registration is hardcoded in ~4 places, no registry
Adding a mode means editing: the `build_engine` dispatch (`modes/driver.py:90`), the `MODES` catalog
(`mc/state.py:32` — MC rejects any mode not in it with `ValueError`), the presentation `MODE_PRESET`
(`mc/presentation.py:282`), and `mc/scoring.py` for the win condition. Miss one and the mode half-works —
**this is exactly why Counter-Strike runs in the CLI but is invisible to Mission Control and has no round
scorer** (see mode-readiness.md §2). **Fix:** one registry call — `register_mode(name, engine_cls, meta,
preset, scorer)` — so a mode lights up in the dispatch, the MC catalog, presentation, and scoring at once.

### G4 — Scoring is a closed enum
`mc/scoring.py` handles `win_by` of `kills`/`survival`; anything else returns `{"undecided": …}`
(`scoring.py:428-430`). A new win condition has nowhere to compute its winner on the MC side. **Fix:** let a
mode **supply its own scorer** that derives the winner/board from its `snapshot()`.

### G5 — No contributor doc, no published schema
Nothing tells an outsider the four ABC methods, the Action vocabulary, the register call, or the JSON fields.
**Fix:** a "How to add a game mode" guide with a minimal worked example (a ~40-line engine + one register
call + one JSON block).

## The plan to open it up

The boundary to advertise is a good, common one: **JSON re-parameterizes and re-skins existing modes; a new
ruleset is a small Python plugin.** The Action/ABC seam already makes that plugin small. Four changes turn
"edit 4 core files + 2 config classes" into "drop one plugin file + one JSON block":

| # | Change | Unblocks | Rough size |
|---|---|---|---|
| **E1** | Add `mode_params: dict` to the wire `GameConfig`; the engine validates its own params | JSON-carried custom params today, even for CS/extraction | small |
| **E2** | One `register_mode(...)` registry replacing the 4 hardcoded dispatch/catalog/preset/scorer points | a mode lights up everywhere from one call | medium |
| **E3** | Unify the two config schemas to one source of truth + publish a JSON Schema | contributors validate; no drift | medium |
| **E4** | "How to add a game mode" contributor doc with a minimal worked example | the on-ramp | small |

Do them in order: **E1 unblocks the most immediately** (objective modes become configurable over the wire at
all), E2 removes the multi-place-registration foot-gun, E3 makes it safe for outsiders, E4 is the on-ramp.
Tracked in [`FOLLOWUPS.md`](../FOLLOWUPS.md) as **E1-E4**.

## What a contributor experience looks like after E1-E4

1. Write `my_mode.py`: subclass `GameEngine`, implement the four methods, emit `Action`s. (~40 lines for a
   simple mode.)
2. `register_mode("my_mode", MyEngine, meta=..., preset=..., scorer=...)` — one call.
3. Ship a JSON config: `{"mode": "my_mode", "mode_params": {…}, "health": …, "presentation": …}`, validated
   against the published schema.

No edits to core dispatch, catalog, presentation, or scoring — the registry and the `mode_params` bag absorb
all of it.

## Sound packs (custom announcers — e.g. Halo / UT): a parallel extensibility axis

Same shape as the mode story: the **reference** layer is decent, the **delivery** and **pack** layers are
missing. Two hard facts set the boundary:

- **The gun plays only its on-gun bank, by id** (`$PLAY,<id>`; `sound-architecture.md`). There is **no
  audio-over-BLE** in the protocol — nothing streams raw audio to the gun. To play a custom sound *on the gun
  speaker*, the clip must be USB-loaded into the `AUDIO` folder as `<ID>.LTP` (raw PCM s16le/44.1k), and
  because the bank is a fixed set of ~2477 ids you **overwrite** an existing id — there is no "add a new id"
  (archive the originals; followup B11, `reference/brx-extended-user-guide.md`: *"up to an hour per 250 MB"*).
- **The phone has its own speaker**, and the app is ours — so it could play arbitrary bundled/hosted audio on
  an event, independent of the gun. But today the companion app plays **no game audio** (only the camera
  preview), and there is no config field for it.

**Does the config allow it?** Partly. The A11 presentation profile maps `event → sound id` in JSON
(`presentation.EVENTS`), so once clips sit at known ids you can point events at them per mode — the reference
layer works. What's missing: a **pack** abstraction (a named, selectable set of mappings; the closest is the
unbuilt **B14** voice-pack selection, which only swaps the gun's built-in characters and needs the per-
character id map, P3), the **phone-speaker path**, and any **import/convert tooling**.

**Legal:** Halo/UT announcer audio is copyrighted — fine on your own guns, but the project can only ship the
*slot* for user-supplied packs, never the packs themselves.

The workstream is tracked in [`FOLLOWUPS.md`](../FOLLOWUPS.md) as **E5-E7**: a phone-side audio channel (E5, the
clean path — no gun storage, no per-gun load), a sound-pack config abstraction (E6, supersets B14), and a
`.LTP` import/gun-load tool (E7, lowest priority since the manual USB path exists). Bottom line: **on the gun
speaker, sounds must live on gun storage; the phone speaker is the unbuilt-but-clean path for custom packs.**
