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
  session_id, phase, t,                      // server time (Unix ms)
  lan: { mode: "router"|"hotspot"|"unknown", ssid?: string, ip: string, port: number, ws_url: string, qr: string /* same as ws_url */ },
  nodes: NodeView[],                          // every node that ever said hello this session
  readiness: ReadinessSnapshot,
  config: GameConfig,                         // current draft (validated on PUT); A10: carries loadout_policy {preset, hud_select, primary: SlotRule, secondary: SlotRule}
  config_errors: string[], config_warnings: string[],   // warnings: e.g. frag_limit without full coverage (A6.1); A10: "N LOADOUTS RESET BY <ruleset>" after a policy change overwrote picks (cleared on the next PUT)
  players: Player[], teams: Team[],
  kit: { kitted: number, total: number, trying: { [player_id]: weapon_id }, browsing: { [player_id]: t_ms } },   // A10 browsing = HUD has its loadout browser open ("PICKING…"), 60 s expiry
  loadout_pool: { primary: string[], secondary_weapons: string[], secondary_perks: string[] },   // A10: allowed ids per slot under config.loadout_policy (server-computed; render, don't re-derive)
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
| `GET /api/modes` | → `ModeInfo[]` `{mode, name, abbr, desc, brief, teams_text, win_text, respawn_text, defaults: GameConfig}` | any |
| `GET /api/weapons` | → `WeaponView[]` `{weapon_id, name, cls, clip, mags, reserve, reload_s, dmg, rpm, rng, verified, tags: string[], role, htk, ttk_ms, caution?}` (dmg/rpm/rng 0–100; A10 `tags`/`role` = policy vocabulary, `htk` = hits to kill — show it instead of the flat `rng`; `caution` = known live problem, show on tile + hero) | any |
| `GET /api/perks` | → `PerkView[]` `{perk_id, name, desc, tags, mechanism: "passive"\|"slot_frame", effects, verified, hidden}` — visible rows only (A10, `docs/spec/loadout.md` §1.2) | any |
| `GET /api/presets` | → `SavedGame[]` `{preset_id, name, desc, builtin, created_t, updated_t, config}` — the builtin "Silenced Sniper" (`builtin:silenced_sniper`) is always first (A10 §8, `docs/spec/loadout.md`) | any |
| `POST /api/presets` | `{name, desc?, config?, replace?}` → `SavedGame` (default `config` = the current draft; `config_id` stripped). `409` on a case-insensitive name clash unless `replace: true` (keeps the id); `403` for a builtin name; `400` bad name/config | any |
| `PUT /api/presets/{id}` | `{name?, desc?, config?}` → `SavedGame`; `403` builtin, `404`, `409` clash | any |
| `DELETE /api/presets/{id}` | → `{ok}`; `403` builtin, `404` | any |
| `POST /api/presets/{id}/apply` | `{}` → `{ok, errors, config}` — exactly `PUT /api/config` with the preset's config (fresh `config_id`, `apply_policy`, the "N LOADOUTS RESET BY …" warning) | muster/build/kit |
| `PUT /api/config` | `GameConfig` (partial ok) → `{ok, errors: string[], config}`. A10: `loadout_policy` is a partial merge — `{preset: "no_heavies"}` rewrites the rules, a rule edit (`{secondary: {choice: "off"}}`) flips `preset` to `custom`; every player's loadout is auto-fixed to the new ruleset (`assign` re-sent) | muster/build/kit |
| `POST /api/players` | `{display, team_id?, gun_id?, voice?}` → `Player` (server assigns `player_num`) | ≤ lobby |
| `PATCH /api/players/{id}` | any of `{display, team_id, voice, loadout, player_num, gun_id}` → `Player`; re-sends `assign` (and re-compiles/re-pushes `config` if already pushed). A10 `loadout` = `{weapons: [{weapon_id}] \| [{primary}, {secondary}], perk?: perk_id\|null, overrides?}` — a perk and a secondary weapon never both; a pick outside the policy pool is `400 {error: <human reason>}` (e.g. "Heavies are off for this game") | ≤ lobby |
| `DELETE /api/players/{id}` | → `{ok}` | ≤ lobby |
| `POST /api/players/{id}/tryout` | `{weapon_id}` → `{ok}` (pushes `tutorial`); `DELETE` same path ends it | kit |
| `DELETE /api/nodes/{node_id}` | → `{ok}`; operator kick: closes the node's socket (4000), unbinds its player, clears its ready/ack, rotates its key and marks it stale so the next hello for that gun (the real phone) re-hydrates. Use when a stranger squatted a live gun name before its owner's phone connected. 404 for an unknown node | any |
| `POST /api/players/{id}/ready` | `{ready}` host override → `Player` | lobby |
| `POST /api/lobby/push` | `{}` → `{ok, acks}`; compiles every bundle, pushes `config`; refuses if readiness has reds | lobby |
| `POST /api/start` | `{runway_s?}` → `{match_id, go_live_t, seq}` | lobby (all acked) |
| `POST /api/start/reschedule` | `{runway_s}` → same | armed |
| `POST /api/start/abort` | `{}` → `{ok, reached: string[], unreachable: string[]}` | armed |
| `POST /api/control` | `{cmd: "end"|"recall"|"panic"}` → `{ok}`; `panic` requires `{confirm: true}` | armed/live |
| `GET /api/recap` | → `RecapView` | live/recap |
| `GET /api/recap.csv` | → text/csv (full stats table + medals) | recap |
| `POST /api/phase` | `{phase: "muster"|"build"|"kit"|"lobby"}` → `State`; host navigation between the setup phases (`armed`/`live`/`recap` are driven by start/end and are rejected here, 400) | ≤ lobby |
| `POST /api/session/new` | `{keep_roster?: boolean}` → `State` (back to muster) | recap |

Errors: `4xx` with `{error: string}`. All times Unix ms. IDs opaque strings.
Static UI: `GET /` serves `webapp/mc/dist` when present (dev: Vite proxies `/api` and `/ui-ws` to the server).
