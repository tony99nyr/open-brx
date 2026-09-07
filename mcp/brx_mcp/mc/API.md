# Mission Control — HTTP + UI-WebSocket API (server ⇄ web UI)

Binding contract between `api.py` (Python/starlette) and `webapp/mc` (React). JSON everywhere.
Node↔MC wire is separate (`docs/spec/contracts.md` §5, `net.py`). Shapes named below are the
`types.py` TypedDicts unless defined here.

## Phases (UI stepper ↔ server `phase`)
`muster | build | kit | lobby | armed | live | recap` — `armed` is the A6 sub-screen of LOBBY.
Server owns the phase; UI navigates freely for viewing but actions are validated per phase.

## Operator auth (A8.1)
The server mints a per-launch **operator token** and prints it as `http://<ip>:8765/#tok=<token>` (also in the
join QR). `_AuthMiddleware` enforces it: every **non-GET `/api/*`** request needs `Authorization: Bearer <token>`
or `?tok=<token>`, and **`/ui-ws` needs `?tok=`**. `GET`/`HEAD`/`OPTIONS` stay open so a spectator board can
watch `/api/state` and `/api/recap`. A missing/wrong token is `401 {"error":"unauthorized"}` (HTTP) or an
accept-then-close **4401** on the WebSocket. `State.lan.auth_required` tells the UI whether a token is in force;
the UI keeps the token from the URL fragment in `sessionStorage` and never puts it in a path. `--no-auth`
disables the gate (bench only — any device on the LAN can then `panic`/`end`/edit the roster).

## Realtime feed — `GET /ui-ws` (WebSocket)
Server sends `{ "kind": "snapshot", "state": <State> }` on connect and on every state change
(coalesced, ≤4/s), plus `{ "kind": "feed", "entry": <FeedEntry> }` for live events.
```jsonc
State {
  active_preset_id?: string | null,             // A10 §8: the saved game that was APPLIED (null once the config is edited) — GAMES marks it PLAYING
  session_id, phase, t,                      // server time (Unix ms)
  mc_confidence: { confident: boolean, missing: string[], stale: string[], unflushed: string[] },   // A11.5: player_ids; gates the MC-driven global-state events
  lan: { mode: "router"|"hotspot"|"unknown", ssid?: string, ip: string, port: number, ws_url: string, qr: string /* same as ws_url */ },
  nodes: NodeView[],                          // every node that ever said hello this session
  readiness: ReadinessSnapshot,
  config: GameConfig,                         // current draft (validated on PUT); A10: carries loadout_policy {preset, hud_select, primary: SlotRule, secondary: SlotRule, perk: SlotRule}; A12: a weapon slot's kinds ∈ ("weapon"|"sidearm")[] — "sidearm" admits only the pistols; A14: `perk` is its own rule (kinds always ["perk"], choice may be "off") (loadout.md §3)
  config_errors: string[], config_warnings: string[],   // warnings: e.g. frag_limit without full coverage (A6.1); A10: "N LOADOUTS RESET BY <ruleset>" after a policy change overwrote picks (cleared on the next PUT)
  players: Player[], teams: Team[],
  kit: { kitted: number, total: number, trying: { [player_id]: weapon_id }, browsing: { [player_id]: t_ms } },   // A10 browsing = HUD has its loadout browser open ("PICKING…"), 60 s expiry
  loadout_pool: { primary: string[], secondary_weapons: string[], perks: string[] },   // A10/A14: allowed ids per slot under config.loadout_policy (server-computed; render, don't re-derive)
  lobby: { ready: number, total: number, pushed: boolean, acks: { [player_id]: { ok: boolean, gun_echo?: string, err?: string } } },
  start?: { match_id, go_live_t, seq, countdown_s, per_node: { [player_id]: { arm_state, t_minus_ms?, synced, last_seen_ms } } },
  live?: LiveView,
  recap?: RecapView
}
NodeView { node_id, node_type, gun_name?, gun_tail?, player_id?, arm_state, last_seen_ms, synced, preflight?, battery?, fw?, hp?, armor?, ammo?, alive? }
LiveView { match_id, go_live_t, time_limit_s, ends_t, score: { [team_id]: number }, rows: LiveRow[] }
LiveRow  = ScoreRow + { status: "alive"|"down"|"stale", respawn_in_s?: number, sync_age_ms: number }
RecapView { winner: Winner, score: { [team_id]: number }, rows: ScoreRow[],
            honors: { award: string, player_id: string, stat: string }[], provisional: boolean, missing: string[],
            post_end_facts: number }   // A6.1: facts after end_t, recorded but not scored
Winner   { team_id?: string|null, player_id?: string, undecided?: string /* win_by not decided by kills: host/objective decides */, tie?: string[] /* tied team_ids */ }
FeedEntry { t_match_s: number, text: string, tag?: "DOUBLE KILL"|"TRIPLE KILL"|"STREAK ×N"|"FIRST BLOOD"|"TEAM KILL"|"SYNC POINT", kind: "kill"|"sync"|"info" }
```

## REST
| method path | body → response | phase |
|---|---|---|
| `GET /api/state` | → `State` (same as the WS snapshot) | any |
| `POST /api/armory/scan` | `{duration_s?}` → `ScanRow[]` | muster |
| `GET /api/armory` | → `ArmoryRecord[]` | any |
| `GET /api/presentation` | → `{summary: {preset, announcer, gun_flash, headset_team, sight_flash, hud_events, mc_events, mc_confidence, custom_events, headset: {pregame, start_flash, in_play, hit, death: "native"\|colour, respawn_flash, carrier}, gun: {in_play: "native"\|"team"\|"dark"\|"health"}}, events: PresentationRow[], mc_confidence: {confident, missing, stale, unflushed}, presets: string[]}` — A11/A11.5: TONIGHT'S applied game's presentation profile, resolved. `PresentationRow` = `{event, source: "hud"\|"mc"\|"both", desc, sound: id\|null, words, gun_led: 0-8\|null, headset: 0-8\|null, flash: "green"\|null, text, enabled}`. Read-only; the UI's ADVANCED view. **Absent on an older server (404): the UI shows the "server predates this UI" banner and nothing else breaks.** | any |
| `GET /api/modes` | → `ModeInfo[]` `{mode, name, abbr, desc, brief, teams_text, win_text, respawn_text, defaults: GameConfig}` | any |
| `POST /api/loadout/pool` | `{loadout_policy, mode?}` (partial policy ok) → `{policy, pool: LoadoutPool}` — preview a DRAFT ruleset's allowed ids for the game designer; nothing applied | any |
| `GET /api/weapons` | → `WeaponView[]` `{weapon_id, name, cls, clip, mags, reserve, reload_s, reload_ms, dmg, rpm, rng, dmg_per_hit, pool, ammo_total, bars, verified, tags: string[], role, htk, ttk_ms, caution?}`. **Draw meters from `bars` `{power, rof, ammo, ttk}` (0–100, ranked across the arsenal, any may be `null`), never from raw `dmg`** — `dmg` is the *share of the 115 pool one hit removes* (7–11 for most guns), so a raw 0–100 bar reads near-empty for everything (field 2026-08-30). `bars.ttk` is inverted (faster kill = longer bar) and is `null` for a one-shot weapon, which has no time-to-kill. **There is no range bar**: `rng` is identical on all 18 guns. `reload_s` is **null** when the weapon has no reload time — render `—`, never `0.0` and never a bare unit. `dmg_per_hit` is the real per-hit damage and does NOT move with the pool. **`pool` is the HOST'S health config (`config.health.max_hp + max_armor`), not a constant** — `htk` and `ttk_ms` are quoted against it and both move when the host changes health (`docs/weapon-design.md` §2.5: the AR needs 13 hits at 45/70 and 23 at 100/100), so a UI showing either must show `pool` beside it. `ttk_ms` is `null` when it cannot be derived. `caution` = known live problem, show on tile + hero | any |
| `GET /api/voices` | → `{default: string, voices: VoiceOption[]}` from `compile.voice_options()` — the selectable `$PSET` voice personas (the full pack, not just male/female); `PATCH /api/players/{id}` validates `voice` against these ids. Only HEAVY is confirmed by ear (`gameconfig.VOICE_PACKS`) | any |
| `GET /api/range/verdicts` | → `{ [weapon_id]: {verdict: "pass"\|"issue", note, t} }` — the latest bench verdict per weapon, read from the tail of `~/.brx-mcp/range-verdicts.jsonl`; `{}` when the log is absent. Feeds the KIT arsenal's field-range badges | any |
| `POST /api/range/verdict` | `{weapon_id, verdict: "pass"\|"issue", note?}` → `{ok}`; appends one JSONL record (`note` capped at 400 chars). `400` without both fields; a read-only disk is `{ok:false, error}`, never a 500 | any |
| `GET /api/perks` | → `PerkView[]` `{perk_id, name, desc, tags, mechanism: "passive"\|"slot_frame", effects, verified, hidden}` — visible rows only (A10, `docs/spec/loadout.md` §1.2) | any |
| `GET /api/presets` | → `SavedGame[]` `{preset_id, name, desc, builtin, created_t, updated_t, config}` — the builtin "Silenced Sniper" (`builtin:silenced_sniper`) is always first (A10 §8, `docs/spec/loadout.md`) | any |
| `POST /api/presets` | `{name, desc?, config?, replace?}` → `SavedGame` (default `config` = the current draft; `config_id` stripped). `409` on a case-insensitive name clash unless `replace: true` (keeps the id); `403` for a builtin name; `400` bad name/config | any |
| `PUT /api/presets/{id}` | `{name?, desc?, config?}` → `SavedGame`; `403` builtin, `404`, `409` clash | any |
| `DELETE /api/presets/{id}` | → `{ok}`; `403` builtin, `404` | any |
| `POST /api/presets/{id}/apply` | `{}` → `{ok, errors, config}` — exactly `PUT /api/config` with the preset's config (fresh `config_id`, `apply_policy`, the "N LOADOUTS RESET BY …" warning) | muster/build/kit |
| `PUT /api/config` | `GameConfig` (partial ok) → `{ok, errors: string[], config}`. A10: `loadout_policy` is a partial merge — `{preset: "no_heavies"}` rewrites the rules, a rule edit (`{secondary: {choice: "off"}}`) flips `preset` to `custom`; every player's loadout is auto-fixed to the new ruleset (`assign` re-sent). A11: `presentation` is the same shape of partial merge — `{preset: "silenced"}` replaces the profile, an event/switch/headset edit flips `preset` to `custom`; `sound` ids must be on the gun (`sounds.on_gun_ids()`), colours 0-8 or palette names, `headset.death` "native" or a colour — anything else is a 400 `errors[]` | muster/build/kit |
| `POST /api/players` | `{display, team_id?, gun_id?, voice?, voice_slots?}` → `Player` (server assigns `player_num`). A15 `voice_slots` = `{role: sound_id}` picks for the `$PSET` voice fields (`death_scream, respawn_cry, melee_grunt, short_pain, long_pain, pain_relief`) + `kill`; every id must be on the gun, `400` otherwise. The pickable lines per voice come from the gun stage (`voices.lines()`); `GET /api/voices` rows carry `speaker` + `lines` | ≤ lobby |
| `PATCH /api/players/{id}` | any of `{display, team_id, voice, voice_slots, loadout, player_num, gun_id}` → `Player` (A15 `voice_slots`: `{}`/`null` clears the picks; a change re-compiles and fires the A9.1 voice preview like a voice change); re-sends `assign` (and re-compiles/re-pushes `config` if already pushed). A10/A14 `loadout` = `{weapons: [{weapon_id}] \| [{primary}, {secondary}], perk?: perk_id\|null, overrides?}` — the perk rides beside a secondary weapon, except an ALT-button perk (easy_reload), which is `400 "Easy Reload takes the ALT button, so it can't ride with a second weapon"`; a pick outside the policy pool is `400 {error: <human reason>}` (e.g. "Heavies are off for this game") | ≤ lobby |
| `DELETE /api/players/{id}` | → `{ok}` | ≤ lobby |
| `POST /api/players/{id}/tryout` | `{weapon_id}` → `{ok}` (pushes `tutorial`); `DELETE` same path ends it | kit |
| `DELETE /api/nodes/{node_id}` | → `{ok}`; operator kick: closes the node's socket (4000), unbinds its player, clears its ready/ack, rotates its key and marks it stale so the next hello for that gun (the real phone) re-hydrates. Use when a stranger squatted a live gun name before its owner's phone connected. 404 for an unknown node | any |
| `POST /api/players/{id}/ready` | `{ready}` host override → `Player` | lobby |
| `POST /api/lobby/push` | `{force?: bool}` → `{ok, acks}`; compiles every bundle, pushes `config`. A15.1: each push ROLLS every `$PSET` voice field the player did not pick in `voice_slots` (death scream, short pain, respawn cry) from the character's pool -- the draw is in `frames.voice.rolled`, the pools in `frames.voice.pools`; `frames.cue_pools[event]` lists every frame a `voice:<role>` event may play and the node picks one at random per event (`frames.cues[event]` = the first). A15.2: the `$PSET` respawn-cry field is EMPTY and the node says the spawn line itself -- `frames.cues.spawn` / one of `frames.cue_pools.spawn` (ids in `frames.voice.spawn`) written right after the spawn and revive frames. A15.3: `frames.pset_pool` = one `$PSET` per death-scream take, the node writes one at random before every `$SPAWN` (the scream stays the firmware's, re-rolled per life); the three `$PSET` pain fields are EMPTY and the node plays `frames.cues.pain_short` / `pain_long` / `pain_melee` (pools in `frames.cue_pools`) on each `$HIR` by damage (`frames.voice.pain_long_min`) or the melee word. Refuses if readiness has reds — the error names each red and its blocker — unless `force`. **An empty roster is refused even with `force`.** `POST /api/start` takes the same `force`: a forced push does not clear a red (it usually adds `GUN DID NOT ANSWER CONFIG`), so an override that stopped at push left ARM unreachable | lobby |
| `POST /api/start` | `{runway_s?}` → `{match_id, go_live_t, seq}` | lobby (all acked) |
| `POST /api/start/reschedule` | `{runway_s}` → same | armed |
| `POST /api/start/abort` | `{}` → `{ok, reached: string[], unreachable: string[]}` | armed |
| `POST /api/control` | `{cmd: "end"|"recall"|"panic"}` → `{ok}`; `panic` requires `{confirm: true}` | armed/live |
| `GET /api/recap` | → `RecapView`, plus `{settling: bool, awaiting: player_id[], since_end_ms}` — bound nodes not heard from since the whistle. **Advisory only: it gates nothing.** `provisional` cannot cover this, because a player is marked flushed on their first event | live/recap |
| `GET /api/matches` | → `[{match_id, mode, go_live_t, ended_t, recap}]`, newest first; finished matches in this session (the RECAP history picker). Read-only, no token. Empty list on any store error | any |
| `GET /api/recap.csv` | → text/csv (full stats table + medals) — the **LIVE** scorer only | recap |
| `GET /api/matches/{id}.csv` | → text/csv for one **finished** match from the session store, same columns and same writer as `/api/recap.csv` (`scoring.rows_csv`, so the two cannot drift). `404` unknown id; a match that scored nobody is a header-only file, not a 404. Read-only, no token | any |
| `POST /api/phase` | `{phase: "muster"|"build"|"kit"|"lobby"}` → `State`; host navigation between the setup phases (`armed`/`live`/`recap` are driven by start/end and are rejected here, 400) | ≤ lobby |
| `POST /api/session/new` | `{keep_roster?: boolean}` → `State` (back to muster) | recap |

Errors: `4xx` with `{error: string}`. All times Unix ms. IDs opaque strings.

## Behaviour the server owns (the operator flow; absorbed from the retired `docs/spec/mission-control.md`, 2026-09-06)

- **MC is not BLE-connected to guns during play.** BLE only at the bench (armory enroll, `scan()` presence);
  mid-match MC talks to nodes over the LAN. Cross-player truth is MC-derived from node facts and exact
  (`death.shooter_num` → roster → killer); the live board is a coverage-zone view with staleness, never real-time.
- **Readiness** (`State.readiness`, contracts §4): node-reported from `status.preflight`; the laptop's `scan()` only
  lists unclaimed guns. Red (blocks the push) = no node, identity reverted/unknown, never synced, wrong SSID / MC
  unreachable; amber (shown, not gating) = headset unknown, battery unsampled, low phone battery, screen off, fw
  unknown. After the push an empty `ack_config.gun_echo` is red and blocks `start`. Fields are aged/decayed, never
  shown stale as current.
- **Kit → lobby:** `POST /api/players` assigns `player_num` in roster order (1–63); any player change re-sends `assign`
  (re-compiles + re-pushes `config` once pushed); a phone `loadout_request` goes through the same policy
  (`policy.py`); `tryout` pushes `tutorial`, is ended by the player's `ready`, a policy reset or END TRY-OUT, and
  refuses once the lobby is pushed. Kit → lobby auto-advances only when every rostered player is ready.
- **Push and start are separate:** `POST /api/lobby/push` compiles every bundle and refuses on reds (names them)
  unless `force`; `POST /api/start` mints `match_id`, stamps a monotonic `seq`, `go_live_t = now + runway_s`
  (default `DEFAULT_RUNWAY_S` 120; presets 60/120/180). A same-schedule re-push keeps `seq` + `match_id`; a
  reschedule mints both anew; abort reaches only nodes in range (`reached`/`unreachable`).
- **Scoring** (`scoring.py`, contracts §4): exact kills/assists, roster-based friendly (never in FFA), accuracy from
  victims' hits over own `shots_total` ("—" on a stale status), `t_recv` re-basing for unsynced nodes, `match_id`
  parking, end freeze (`post_end_facts`), fresh-only `feedback`/`alert` (`FEEDBACK_MAX_AGE_MS`), the A11.4
  global-state alerts gated by `mc_confidence`. `win_by` other than `kills`/`survival` is `undecided` (no objective
  scorer yet: `docs/utility-roadmap.md` §8).
- **Recap** is provisional until every rostered node has flushed (`provisional`, `missing`, `settling`); late
  `event_batch`es and parked events reconcile in; honors need ≥ 3 scored players; `session/new` returns to muster
  with KITTED nodes (a rematch is a new push).
- **Persistence:** session state under `~/.brx-mcp/` (`store.py`, SQLite: every inbound envelope with `t`, `t_recv`,
  `match_id`, parked flag; `presets.json`; `range-verdicts.jsonl`), so a restart re-hydrates and `GET /api/matches`
  survives a crash.
Static UI: `GET /` serves `webapp/mc/dist` when present (dev: Vite proxies `/api` and `/ui-ws` to the server).
