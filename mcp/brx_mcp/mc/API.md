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
  stations: StationView[], game_no: number,   // A13.5: the ITEMS panel (see GET /api/stations); game_no = the advert `game` byte stations are armed with THIS match (bumps on the first push after a match started)
  readiness: ReadinessSnapshot,               // A25/A29: each ReadinessRow also carries `app_ver`, `platform` and `log` (same shape as
                                               // NodeView.log). A29 adds one RED blocker — `APP <x.y.z> INCOMPATIBLE WITH MC (NEEDS <tier>) —
                                               // UPDATE THE APP` — and three ambers: `APP OLDER THAN THE FIELD (<mine> < <newest>)`,
                                               // `APP OLDER THAN THE RELEASE (<mine> < <release>)` and `APP VERSION UNKNOWN (<raw>)`.
                                               // An UNPARSABLE version is amber, NEVER red (A1: amber never blocks — the app shipped a
                                               // hard-coded `hud-0.2` for months). An incompatible build says the ONE thing and is left out
                                               // of `newest`, so one rogue phone cannot amber the whole board. Render the strings verbatim.
                                               // A32: `headset: "proven"|"unknown"|"absent"` is joined by `headset_proof: "echo"|"link"|null`
                                               // (additive) — HOW it was proven. `"echo"` = the gun answered the config push; `"link"` = the
                                               // node's `status.preflight.gun_linked` has been TRUE CONTINUOUSLY for `HEADSET_LINK_PROOF_MS`
                                               // (10 s), which a gun with no headset cannot manage (it drops the link in ~6 s); `null` = not
                                               // proven. A link that drops sends the row back to `unknown` and the clock restarts. While a
                                               // link is counting up the row carries the amber `HEADSET · CONFIRMING (LINK <n> s)`, which
                                               // clears itself at 10 s — the UI renders it through the normal amber path and does NO timing of
                                               // its own. `absent` is unchanged: the head echoed nothing, and `GUN DID NOT ANSWER CONFIG —
                                               // HEADSET OFF? BLOCKS START` stays a red blocker that outranks any link evidence
  options: { log_sync: "auto" | "manual" },    // A25 (GET/PUT /api/options). "auto" = MC asks every player node for its log at
                                               // recap, on each offer, and on the reconnect of a node whose last-match log never
                                               // arrived; "manual" = only the operator's LOGS button ever asks.
                                               // At most ONE automatic ask per node is outstanding: a node that
                                               // reconnects and then offers would otherwise be asked twice in the
                                               // same breath and upload the same log twice. A fresh `hello` (the
                                               // socket we asked is gone) and the first `log_data` chunk clear it;
                                               // the LOGS button is never deduped
  versions: {                                  // A29: the muster version header — `PHONES · 3 × 0.1.9 · 1 × 0.1.8`.
                                               // Counts only nodes still IN THE FIELD: one MC has not heard from in
                                               // OFFLINE_AFTER_MS is gone, and never sets `newest`
    field: { [app_ver: string]: number },      //   PLAYER nodes counted by the version string each reported, VERBATIM (an
                                               //   unparsable one included — the operator needs to see `hud-0.2` said out loud).
                                               //   Stations are not in the match and are not counted (their build is StationView.app_ver)
    newest: string | null,                     //   highest PARSABLE, COMPATIBLE player version in the field ("0.1.9")
    release: string | null,                    //   `webapp/download/build.json`'s version, read once at startup; null = no sidecar
    mc_major: string                           //   the tier MC is compatible with: "0.1" while the app is on 0.x, "2" from 1.0.0 on
  },
  config: GameConfig,                         // current draft (validated on PUT); A18: `mode_params` (complete, or absent for a mode with none); A19: `vip_player_id?`; A20: `stun?: {duration_s?}` (absent = no EMP row); A10: carries loadout_policy {preset, hud_select, primary: SlotRule, secondary: SlotRule, perk: SlotRule}; A12: a weapon slot's kinds ∈ ("weapon"|"sidearm")[] — "sidearm" admits only the pistols; A14: `perk` is its own rule (kinds always ["perk"], choice may be "off") (loadout.md §3)
  config_errors: string[], config_warnings: string[],   // warnings: e.g. frag_limit without full coverage (A6.1); A10: "N LOADOUTS RESET BY <ruleset>" after a policy change overwrote picks (cleared on the next PUT); a warning starting `SETUP: ` is a PHYSICAL step the operator must do on the field before the push (F70: power-cycle the grenade so the hill starts neutral; an `ir_station` source says instead that we have never had one on the bench) — the GAMES rail renders those verbatim, and so do the LOBBY and ARMED headers, where the operator is standing when the step is actionable
  players: Player[], teams: Team[],
  kit: { kitted: number, total: number, trying: { [player_id]: weapon_id }, browsing: { [player_id]: t_ms } },   // A10 browsing = HUD has its loadout browser open ("PICKING…"), 60 s expiry
  loadout_pool: { primary: string[], secondary_weapons: string[], perks: string[] },   // A10/A14: allowed ids per slot under config.loadout_policy (server-computed; render, don't re-derive)
  lobby: { ready: number, total: number, pushed: boolean, acks: { [player_id]: { ok: boolean, gun_echo?: string, err?: string } } },
  start?: { match_id, go_live_t, seq, countdown_s, per_node: { [player_id]: { arm_state, t_minus_ms?, synced, last_seen_ms } } },
  live?: LiveView,
  recap?: RecapView,
  notices: { mc_verify?: string }             // A31 (2026-09-12): standing HOST lines the compiler wrote once, so MC
                                              // and the phones cannot disagree. `mc_verify` is present ONLY when this
                                              // game's end state is MC's call (a frag cap, an objective `win_by`, a
                                              // survival mode) AND `config.coverage != "full"` AND at least one
                                              // rostered phone has no backhaul (A28) — and it NAMES those phones:
                                              // `WIN IS CONFIRMED AT MC · 3 PHONES OFF-GRID (OP0, OP1, OP2) · TELL
                                              // PLAYERS TO RETURN AFTER THE WHISTLE`. Render it verbatim on LOBBY and
                                              // ARMED. `{}` (no keys) = nothing to say. The PLAYER's half of the same
                                              // decision rides `assign.game.mc_verify` (contracts §3), one line, no
                                              // names. ⚠ `backhaul` is not reported by any node yet: until A28 lands
                                              // every phone counts as off-grid, so the notice appears on every
                                              // MC-decided game at a venue that has not been marked full coverage.
}
NodeView { node_id, node_type, gun_name?, gun_tail?, player_id?, arm_state, last_seen_ms, synced, preflight?, battery?, fw?, hp?, armor?, ammo?, alive?,
           // --- additive 2026-09-12 (A25/A29); an older UI ignores them, an older server omits them ---
           app_ver?: string,        // A29: the phone's REAL build, `"<package version>+<git sha>[-dirty]"` (e.g. "0.1.9+cfe2a8e").
                                    //      From the hello AND every status, so a phone updated mid-session is seen. Compare with
                                    //      `State.versions`; the readiness row carries the same string plus the verdict
           platform?: "android" | "ios" | "web",
           log?: {                  // A25: what this node's log sync is doing, as the NODE reports it. MC asking does not make it
                                    // `offered` — the phone answers when it is safe, and the board shows the phone's truth
             state: "none" | "offered" | "pulling" | "held" | "complete",
             reason?: string,       //   `held`: why the phone is not answering yet ("live", "armed", "3 facts pending", "offline");
                                    //   `offered`: the reason the node put on its offer
             lines?: number, bytes?: number,   // from the offer; `bytes` becomes the running total once chunks arrive
             last_t: number         //   server time (Unix ms) of the last change
           } }
       // `complete` = a whole `last`-terminated stream landed. It STAYS complete when the phone idles back to `none`, until the
       // next ask — otherwise the one state the operator was waiting for is erased two seconds after it appears.
LiveView { match_id, go_live_t, time_limit_s, ends_t, score: { [team_id]: number }, rows: LiveRow[] }
LiveRow  = ScoreRow + { status: "alive"|"down"|"stale", respawn_in_s?: number, sync_age_ms: number }
ScoreRow { player_id, display, team_id: string|null, kills, deaths, assists, shots, shots_total, hits,
           accuracy: number|null, kd, streak,
           medals: string[],        // F116 (2026-09-11): the `honors()` awards (MVP · MOST KILLS · … —
                                    // still 3+ scored players by design) FOLLOWED BY the per-kill Halo
                                    // medals this player actually won (FIRST BLOOD · DOUBLE KILL ×2 ·
                                    // TRIPLE KILL · KILLTACULAR · KILLING SPREE · UNSTOPPABLE, repeats
                                    // collapsed to ×N). They were computed at every kill and DISCARDED,
                                    // so a 1v1 — where honors are empty by design — showed nothing at
                                    // all. Render the strings verbatim, in order; the leading ones are
                                    // the whole-match verdicts.
           // --- additive 2026-09-11 (F116/F119); an older UI ignores them, an older server omits them ---
           best_streak: number,     // F116: the LONGEST streak this match. SHOW THIS ONE. `streak` is the
                                    // CURRENT streak and is 0 for whoever died last, which is how a 9-kill
                                    // row read "streak 0" — it stays only so an older UI keeps working
           multi_best: number,      // biggest multi-kill (2 double · 3 triple · 4+ killtacular; 0 = none)
           first_blood: boolean,    // this player drew first blood
           acc_provisional: boolean,// F119: `accuracy` is NOT settled — render it as settling, not as fact
           // --- additive 2026-09-12 (A24/M2). UNOFFICIAL: what this player picked up AFTER the whistle
           //     (A6.1 post-end facts). They feed nothing — not kills, not streaks, not medals, not the
           //     winner — and are the last two columns of the CSV export for the same reason. 0/0 when
           //     nothing landed late, so presence never has to be tested for.
           after_end_kills: number, after_end_deaths: number
         }
RecapView { winner: Winner, score: { [team_id]: number }, rows: ScoreRow[],
            honors: { award: string, player_id: string, stat: string }[], provisional: boolean, missing: string[],
            post_end_facts: number,    // A6.1: facts after end_t, recorded but not scored
            after_end?: { facts: number, by_player: { [player_id]: { kills: number, deaths: number } } },
                                       // A24/M2 (2026-09-12): the same facts, BROKEN DOWN. Absent when nothing
                                       // landed after the whistle. Show it as "after the whistle" — it is real
                                       // (a player kept playing, or a phone flushed minutes late) and it counts
                                       // for nothing. `winner` may itself carry `tie: player_id[]|team_id[]` when
                                       // two sides reached the frag cap within CLOCK_TIE_MS (1 s, contracts §7):
                                       // MC cannot order two kills inside the clock band and does not pretend to
            possession?: { by_team: { [team_id]: number /* SECONDS held */ }, neutral_s: number, sites: number,
                           reports: number /* nodes that reported */, observed_s: number /* best single observer */,
                           of_s: number|null /* the match length it is measured against */ },
            stations?: { node_id: string, kind: StationKind, id: number, team: number, heard: boolean,
                         revives?: number|null /* respawn only; null = the station was never heard from */,
                         hold_ms?: Record<string, number>|null, owner?: number|null /* control only, from report.control */ }[] }
            // possession is ABSENT unless some node reported it (objective modes only) — see `possession` below
            // stations is ABSENT unless some station is ASSIGNED (roadmap A6) — one row per assigned station,
            // straight from `Session.stations_view()`'s own `report` at the moment the match ended (or NOW,
            // on a still-live recap poll); a station never heard from still gets a row, with `heard: false`
            // and its kind-specific fields null — `heard` is set for every kind (extraction/powerup/bomb
            // included), since only respawn/control have a count of their own to fall back on
Winner   { team_id?: string|null, player_id?: string, undecided?: string /* win_by not decided by kills: host/objective decides */, tie?: string[] /* tied team_ids */ }
FeedEntry { t_match_s: number, text: string, tag?: "DOUBLE KILL"|"TRIPLE KILL"|"STREAK ×N"|"FIRST BLOOD"|"TEAM KILL"|"SYNC POINT"|"ALERT"|"WITHHELD"|"ROLE", kind: "kill"|"sync"|"info"|"alert" }
// F118 (2026-09-11): an `alert` entry's `text` is the OPERATOR's copy — third person, mode-aware, ids
// resolved to display names ("ROCCO takes the lead" in FFA, "RED takes the lead" in a team game). The
// PLAYER's second-person line ("YOUR TEAM TAKES THE LEAD") is unchanged and still rides on the node's
// `alert` body, so the phone lane picks up nothing. Render `text` verbatim; never re-word it.
```

## REST
| method path | body → response | phase |
|---|---|---|
| `GET /api/state` | → `State` (same as the WS snapshot) | any |
| `POST /api/armory/scan` | `{duration_s?}` → `ScanRow[]` | muster |
| `GET /api/armory` | → `ArmoryRecord[]` | any |
| `GET /api/presentation` | → `{summary: {preset, announcer, voice: "on"\|"hits_only"\|"off", gun_flash, headset_team, sight_flash, hud_events, mc_events, mc_confidence, custom_events, headset: {pregame, start_flash, in_play, hit, death: "native"\|colour, respawn_flash, carrier}, gun: {in_play: "native"\|"team"\|"dark"\|"health"}}, events: PresentationRow[], mc_confidence: {confident, missing, stale, unflushed}, presets: string[]}` — A11/A11.5: TONIGHT'S applied game's presentation profile, resolved. **A22** `voice` (default `"on"`) gates the player's OWN pain + spawn lines, independent of `announcer` (MC/announcer feedback); `"hits_only"` drops the spawn line only, `"off"` drops both; the `silenced` preset sets it `off`. `PresentationRow` = `{event, source: "hud"\|"mc"\|"both", desc, sound: id\|null, words, gun_led: 0-8\|null, headset: 0-8\|null, flash: "green"\|null, slot: "queue"\|"interrupt"\|null, text, enabled}`. `slot` (bench-confirmed 2026-09-11): an explicit `$PLAY` slot override, token 4 (queue, waits behind whatever is playing) or token 1 (interrupt, cuts it) -- `null` keeps the default pattern (V-family ids queue, others interrupt); a `voice:<role>` sound always queues regardless. Read-only; the UI's ADVANCED view. **Absent on an older server (404): the UI shows the "server predates this UI" banner and nothing else breaks.** | any |
| `GET /api/modes` | → `ModeInfo[]` `{mode, name, abbr, desc, brief, teams_text, win_text, respawn_text, defaults: GameConfig, params: ModeParamSpec[]}`. **A18:** `params` = the mode's own tunables as its ENGINE declares them (`{name, type: int\|float\|bool\|str, default, desc, min?, max?, choices?}`; `[]` for tdm/ffa/infection) — render controls from it, never from a list in the UI; `defaults.mode_params` carries the values. `koth` (King of the Hill) defaults to BLUE + GREEN — tids 1 and 3, never 2, which is what a NEUTRAL hill broadcasts, and a koth/domination config may not even CONTAIN a tid-2 team (F82, refused at PUT) — and `win_by: "objective"`, decided by the `possession` fact below (`win_text` says "· HOST CALL" while no node sends one) | any |
| `POST /api/loadout/pool` | `{loadout_policy, mode?}` (partial policy ok) → `{policy, pool: LoadoutPool}` — preview a DRAFT ruleset's allowed ids for the game designer; nothing applied | any |
| `GET /api/weapons` | → `WeaponView[]` `{weapon_id, name, cls, clip, mags, reserve, reload_s, reload_ms, dmg, rpm, rng, dmg_per_hit, pool, ammo_total, bars, verified, tags: string[], role, htk, ttk_ms, caution?}`. **Draw meters from `bars` `{power, rof, ammo, ttk}` (0–100, ranked across the arsenal, any may be `null`), never from raw `dmg`** — `dmg` is the *share of the 115 pool one hit removes* (7–11 for most guns), so a raw 0–100 bar reads near-empty for everything (field 2026-08-30). `bars.ttk` is inverted (faster kill = longer bar) and is `null` for a one-shot weapon, which has no time-to-kill. **There is no range bar**: `rng` is identical on all 18 guns. `reload_s` is **null** when the weapon has no reload time — render `—`, never `0.0` and never a bare unit. `dmg_per_hit` is the real per-hit damage and does NOT move with the pool. **`pool` is the HOST'S health config (`config.health.max_hp + max_armor`), not a constant** — `htk` and `ttk_ms` are quoted against it and both move when the host changes health (`docs/weapon-design.md` §2.5: the AR needs 13 hits at 45/70 and 23 at 100/100), so a UI showing either must show `pool` beside it. `ttk_ms` is `null` when it cannot be derived. `caution` = known live problem, show on tile + hero | any |
| `GET /api/voices` | → `{default: string, voices: VoiceOption[]}` from `compile.voice_options()` — the selectable `$PSET` voice personas (the full pack, not just male/female); `PATCH /api/players/{id}` validates `voice` against these ids. Only HEAVY is confirmed by ear (`gameconfig.VOICE_PACKS`) | any |
| `GET /api/range/verdicts` | → `{ [weapon_id]: {verdict: "pass"\|"issue", note, t} }` — the latest bench verdict per weapon, read from the tail of `~/.brx-mcp/weapon-verdicts.jsonl`; `{}` when the log is absent. Feeds the KIT arsenal's field-range badges | any |
| `POST /api/range/verdict` | `{weapon_id, verdict: "pass"\|"issue", note?}` → `{ok}`; appends one JSONL record (`note` capped at 400 chars). `400` without both fields; a read-only disk is `{ok:false, error}`, never a 500 | any |
| `GET /api/perks` | → `PerkView[]` `{perk_id, name, desc, tags, mechanism: "passive"\|"slot_frame", effects, verified, hidden}` — visible rows only (A10, `docs/spec/loadout.md` §1.2) | any |
| `GET /api/presets` | → `SavedGame[]` `{preset_id, name, desc, builtin, created_t, updated_t, config}` — the builtin "Silenced Sniper" (`builtin:silenced_sniper`) is always first (A10 §8, `docs/spec/loadout.md`) | any |
| `POST /api/presets` | `{name, desc?, config?, replace?}` → `SavedGame` (default `config` = the current draft; `config_id` stripped). `409` on a case-insensitive name clash unless `replace: true` (keeps the id); `403` for a builtin name; `400` bad name/config | any |
| `PUT /api/presets/{id}` | `{name?, desc?, config?}` → `SavedGame`; `403` builtin, `404`, `409` clash | any |
| `DELETE /api/presets/{id}` | → `{ok}`; `403` builtin, `404` | any |
| `POST /api/presets/{id}/apply` | `{}` → `{ok, errors, config}` — exactly `PUT /api/config` with the preset's config (fresh `config_id`, `apply_policy`, the "N LOADOUTS RESET BY …" warning) | muster/build/kit |
| `POST /api/lobby/push` (station side) | in addition to compiling: bumps `game_no` if a match has STARTED on the current number, pushes `config.stations = [{id, kind}]` (the ids MC armed, contracts A13.1 — derived on the wire, never written into the operator's config) to every player node, and re-arms every assigned station with the new number. `config_warnings` gains `SETUP: NO CONTROL-POINT PHONE IS ASSIGNED …` for a `phone` objective with no `control` station and `SETUP: NO RESPAWN STATION IS ASSIGNED …` for `respawn.type == "scanner"` with no `respawn` station (advisory: a station may be armed by hand on the phone) | build/kit |
| `PUT /api/config` | `GameConfig` (partial ok) → `{ok, errors: string[], config}`. **A18** `mode_params` is a partial merge onto the current values, stored complete; an unknown key or an out-of-range value is a `400` naming the mode's real parameters (a mode with none refuses any key). **A19** `vip_player_id` (a player_id or null): shape-checked here, roster-checked by `validate()` (`config_errors` names a VIP who is not playing); stripped from every saved game. **A20** `stun` (F15): `{duration_s?}` enables the host-driven EMP (the `<8,0>` cell becomes a fn-24 status row, so a charge rifle on the roster stops dealing damage and becomes the stunner); `null` clears it; a non-object is a `400`; `duration_s` outside 1..60 and a game with nothing that can stun land in `config_errors` / `config_warnings` from `validate()`, not a 400. A10: `loadout_policy` is a partial merge — `{preset: "no_heavies"}` rewrites the rules, a rule edit (`{secondary: {choice: "off"}}`) flips `preset` to `custom`; every player's loadout is auto-fixed to the new ruleset (`assign` re-sent). A11: `presentation` is the same shape of partial merge — `{preset: "silenced"}` replaces the profile, an event/switch/headset edit flips `preset` to `custom`; `sound` ids must be on the gun (`sounds.on_gun_ids()`), colours 0-8 or palette names, `headset.death` "native" or a colour, **A22** `voice` one of `"on"\|"hits_only"\|"off"` — anything else is a 400 `errors[]`. F70: `station_source` says what is on the field emitting the objective and is a CLOSED vocabulary — `"grenade"` (a BRX Smart Grenade in hill mode; the proto-15 beacon, bench-proven), `"ir_station"` (a station / Utility Box speaking `$CAPTURE`; unproven on our bench) or `"phone"` (a spare phone in the utility role as a BLE control point, capture by presence, `spec/utility.md` §5d; added 2026-09-11, F103); `null` clears it and anything else is a 400. `koth`/`domination`/`ctf`/`cs`/`bomb` are REFUSED without one (the error names the valid values), and a grenade or phone source adds its own `SETUP: ` checklist warning (a phone point is reset by ARMING, never power-cycled) | muster/build/kit |
| `POST /api/players` | `{display, team_id?, gun_id?, voice?, voice_slots?}` → `Player` (server assigns `player_num`). A15 `voice_slots` = `{role: sound_id}` picks for the `$PSET` voice fields (`death_scream, respawn_cry, melee_grunt, short_pain, long_pain, pain_relief`) + `kill`; every id must be on the gun, `400` otherwise. The pickable lines per voice come from the gun stage (`voices.lines()`); `GET /api/voices` rows carry `speaker` + `lines`. A `gun_id` whose node is ALREADY connected is adopted on the spot; mid-match that node hot joins (`config` + the running `start`) unless it is already playing this config (it acked one, or reports itself `armed`/`live`), in which case it is simply bound and left alone — no `config`, because that head would un-spawn a gun in play (A30) | ≤ lobby |
| `PATCH /api/players/{id}` | any of `{display, team_id, voice, voice_slots, loadout, player_num, gun_id}` → `Player` (A15 `voice_slots`: `{}`/`null` clears the picks; a change re-compiles and fires the A9.1 voice preview like a voice change); re-sends `assign` (and re-compiles/re-pushes `config` if already pushed). A10/A14 `loadout` = `{weapons: [{weapon_id}] \| [{primary}, {secondary}], perk?: perk_id\|null, overrides?: {max_hp?: 1..999, max_armor?: 0..999}}` — the perk rides beside a secondary weapon, except an ALT-button perk (easy_reload), which is `400 "Easy Reload takes the ALT button, so it can't ride with a second weapon"`; a pick outside the policy pool is `400 {error: <human reason>}` (e.g. "Heavies are off for this game"). **A30 — THE KIT LOCKS AT START (2026-09-12):** in `armed`/`live`, `loadout`, `voice`, `voice_slots`, `player_num` and `gun_id` are refused `409 {error: "the match is LIVE: a player's kit is locked until it ends …"}` (a CONFLICT, not a bad request: the edit is fine, the moment is not — `state.ConflictError`) — every one of them would be COMPILED to the gun, and a `config` to a gun in play writes the A23/F121 DISARMED head with nothing to re-spawn it (`engine.js resumeSchedule()` returns early in `live`), so that player would register every hit, move no pool and be unable to fire for the rest of the match. `display`, `team_id` and `ready` are still accepted mid-match: they ride in `assign` (roster/display) and never reach the gun — a mid-match re-team still moves the scorer. The lock is per PLAYER, not per phase: a node that has NOT taken this match's config (no ack for it, not reporting armed/live) still receives `config` + the same `start` and HOT JOINS (contracts §5 `start`, node.md M-START E5) | ≤ lobby (kit fields); display/team/ready any |
| `DELETE /api/players/{id}` | → `{ok}` | ≤ lobby |
| `POST /api/players/{id}/tryout` | `{weapon_id}` → `{ok}` (pushes `tutorial`); `DELETE` same path ends it | kit |
| `GET /api/stations` | → `{stations: StationView[], game}` — A13.5 (F104, 2026-09-11): every utility phone that said hello this session (`node_type:"utility"`, never bound to a player, never pruned while assigned), each with the operator's `assigned` `{kind, team, id, threshold, at}` (or null), what it was last `armed` with (`{game, at, kind, team, id}`), `arm_pending` (assignment changed while it was out of Wi-Fi: "bring it back to re-arm"), its own heartbeat as `report` (`kind, team, station_id, threshold, live, revives, armed, battery`, and for a control point `control: {owner, progress, contested, hold_ms, capture_log, …}` — the self-authoritative recap, utility.md §5c), `app_ver` + `platform` (from the phone's hello, kept fresh by its heartbeat too — roadmap A3/A29), `online`, `last_seen_ms` (age) and `attention: string[]` (ARMED FOR AN OLDER GAME · PHONE SAYS NOT ARMED · PHONE ADVERTISES ID x, ASSIGNED y · BATTERY LOW). The same list rides on every snapshot as `stations`, with the current game byte as `game_no` | any |
| `PUT /api/stations/{node_id}` | `{kind, team, id, threshold?}` → `StationView`. `kind` ∈ respawn · powerup · extraction · bomb · control; `team` = a `team_id`, a `$TID` 0-3, or `"any"` (255 — required for `control`, which starts NEUTRAL and is taken by presence); `id` 1..65535, unique on the field; `threshold` dBm −100..−30 (default −74 ≈ 10 ft at high TX). Pushes `station_config` `{kind, team, id, threshold, game, valid_ids}` to that phone at once and re-arms every other assigned station (the allow-list they echo changed); an offline phone is flagged and armed on its next hello. 400 in the operator's voice, including (polish 2026-09-11): a `team` that is not ANY and not a `$TID` some team in this game is on (such a station serves nobody), and any PUT while the match is `armed` or `live` (players already hold `config.stations`; re-pushing it would re-arm every live gun — RECALL or END first). A PUT in `recap` is accepted and arms against the finished match's game byte; the next lobby push re-arms every station with the new one | any but armed/live |
| `DELETE /api/stations/{node_id}` | → `{ok}`; drops the assignment (the survivors' `valid_ids` shrink, and players in LOBBY are re-pushed the shorter `config.stations`). 404 for an unknown station; 400 while `armed`/`live`, as for PUT. `DELETE /api/nodes/{node_id}` on an ASSIGNED station does the same shrink | any but armed/live |
| `POST /api/stations/arm` | → `{ok, armed, pending: node_id[]}`; re-arm every assigned station now (the LOBBY push does this automatically) | any |
| `GET /api/options` | → `{log_sync: "auto"|"manual"}` — A25 session options. Also on every snapshot as `State.options` | any |
| `PUT /api/options` | `{log_sync}` (partial: only the keys you send are set) → the full options object. An unknown key or an out-of-table value is 400 and nothing is changed — an option the operator set and MC silently ignored is worse than a refusal | any |
| `POST /api/nodes/{node_id}/pull_log` | → `{ok: boolean, node_id, log: NodeView["log"]}` — A25, the operator's **LOGS** button. Pushes `pull_log {reason:"manual"}` to that node. **Never gated by `log_sync`**: "manual" means the button is the only asker, not that the button stops working. `ok:false` (still 200) when the node is a utility phone (F106(d): a station never binds a match) or past the ~1 MB per-node budget (which is per MATCH — it resets at the next start, or a session of four games would silently stop asking); 404 for an unknown node. The NODE decides when to answer (never while ARMED/LIVE or with unacked facts) — watch `NodeView.log` | any |
| `DELETE /api/nodes/{node_id}` | → `{ok}`; operator kick: closes the node's socket (4000), unbinds its player, clears its ready/ack, rotates its key and marks it stale so the next hello for that gun (the real phone) re-hydrates. Use when a stranger squatted a live gun name before its owner's phone connected. 404 for an unknown node | any |
| `POST /api/players/{id}/ready` | `{ready}` host override → `Player` | lobby |
| `POST /api/lobby/push` | `{force?: bool}` → `{ok, acks}`; compiles every bundle, pushes `config`. A15.1: each push ROLLS every `$PSET` voice field the player did not pick in `voice_slots` (death scream, short pain, respawn cry) from the character's pool -- the draw is in `frames.voice.rolled`, the pools in `frames.voice.pools`; `frames.cue_pools[event]` lists every frame a `voice:<role>` event may play and the node picks one at random per event (`frames.cues[event]` = the first). A15.2: the `$PSET` respawn-cry field is EMPTY and the node says the spawn line itself -- `frames.cues.spawn` / one of `frames.cue_pools.spawn` (ids in `frames.voice.spawn`) written right after the spawn and revive frames. A15.3: `frames.pset_pool` = one `$PSET` per death-scream take, the node writes one at random before every `$SPAWN` (the scream stays the firmware's, re-rolled per life); the three `$PSET` pain fields are EMPTY and the node plays `frames.cues.pain_short` / `pain_long` / `pain_melee` (pools in `frames.cue_pools`) on each `$HIR` by damage (`frames.voice.pain_long_min`) or the melee word. Refuses if readiness has reds — the error names each red and its blocker — unless `force`. **A23 (F121) SPAWN PROTECTION:** `frames.head` carries the `$SIR` table with every function replaced by fn 28 — the same cells, registering a `$HIR` with no sound, no headset flash, no vibration and no pool movement — and the REAL table rides `frames.spawn` and `frames.revive`, ahead of their `$SPAWN`. A gun therefore cannot be hurt between the lobby push and its own go-live, and a node needs no change to get this (the rows are inside frame lists it already writes verbatim). With `hit_audio_class` on, `frames.revive` ships no rows and the node's `frames.sir_pool` take is the revive carrier instead — exactly one of the two, or the take's rolled sounds are clobbered. **An empty roster is refused even with `force`.** **Refused with `400` in `armed` and `live`, and `force` does NOT open that door** (`_refuse_push_in_play`): the node writes `frames.head` on every `config` and clears `spawned`, and since A23/F121 that head is the DISARMED fn-28 `$SIR` table — so a push to a gun in play leaves a player who registers every hit and loses no health until their next life. RECALL or END first. `force` overrides a readiness judgement, never this. `POST /api/start` takes the same `force`: a forced push does not clear a red (it usually adds `GUN DID NOT ANSWER CONFIG`), so an override that stopped at push left ARM unreachable | lobby |
| `POST /api/start` | `{runway_s?}` → `{match_id, go_live_t, seq}` | lobby (all acked) |
| `POST /api/start/reschedule` | `{runway_s}` → same | armed |
| `POST /api/start/abort` | `{}` → `{ok, reached: string[], unreachable: string[]}` | armed |
| `POST /api/control` | `{cmd: "end"\|"recall"\|"panic"}` → `{ok, ended, reached, pushed, nodes, phase, error?}`; `panic` requires `{confirm: true}`. **F125 (2026-09-11): `reached` counts nodes whose match ACTUALLY ENDED, never a push alone** — it was counted before the branch that ends anything, so an END that ended nothing still returned `{ok: true, reached: 2, nodes: 2}` while the node ran on to its own time limit. `ended` says whether this control actually stopped the match (always true for `recall`/`panic`, which stop a live game → KITTED per A5.9); `pushed` is how many nodes took the `control` frame (it can exceed `reached` only in the no-scorer case); `phase` is where MC is now. An `end` with **no scorer** is `{ok: false, ended: false, reached: 0, error}`: the nodes are still told to stop, MC changes no phase, and the `error` names RECALL as the way back to KIT. A **second `end` in `recap`** is the same shape (`{ok: false, ended: false, reached: 0, error}`): the press is still forwarded to the nodes, but the recap stands and is NOT re-written and the victory cue is NOT pushed again. `recall` and `panic` are unaffected in every phase. Render `reached`/`nodes` as the count and show `error` when present | armed/live |
| `GET /api/recap` | → `RecapView`, plus `{settling: bool, awaiting: player_id[], since_end_ms}` — bound nodes not heard from since the whistle. **Advisory only: it gates nothing.** `provisional` cannot cover this, because a player is marked flushed on their first event | live/recap |
| `GET /api/matches` | → `[{match_id, mode, go_live_t, ended_t, recap}]`, newest first; finished matches in this session (the RECAP history picker). Read-only, no token. Empty list on any store error | any |
| `GET /api/recap.csv` | → text/csv (full stats table + medals) — the **LIVE** scorer only. Columns: `operator,team,kills,deaths,assists,kd,accuracy,streak,best_streak,shots,hits,medals` (`best_streak` added 2026-09-11, F116; an archived recap stored before that exports `0` for it) | recap |
| `GET /api/matches/{id}.csv` | → text/csv for one **finished** match from the session store, same columns and same writer as `/api/recap.csv` (`scoring.rows_csv`, so the two cannot drift). `404` unknown id; a match that scored nobody is a header-only file, not a 404. Read-only, no token | any |
| `POST /api/phase` | `{phase: "muster"|"build"|"kit"|"lobby", force?: boolean}` → `State`; host navigation between the setup phases (`armed`/`live`/`recap` are driven by start/end and are rejected here, 400). **The SOURCE phase is guarded too: any move while the session is `armed` or `live` is 409** — `{phase:"kit"}` from LIVE used to succeed and left `tick()` with no phase to end, so the match ran on with no whistle coming. End it with `control{end}` first; `force` does not apply. **A27 (F127): CONTINUE out of `kit` is guarded.** `kit` → `lobby` while any rostered player has not pressed READY is **409** `{error, not_ready: string[] /* displays */, greens /* how many ARE ready */, roster_size}` and the phase does not move; `force: true` does it anyway (the UI's second tap, which names who is not ready — `CONTINUE · greens / roster_size READY`). Everything the player carries is compiled at the lobby push, so advancing early takes a half-made kit into the match; the NODE says the same thing in its own words (`moment {kind:"kit_locked_by_host"}`, loadout.md §4.4). Those two are the only guards: between the setup phases nothing else is refused | ≤ lobby |
| `POST /api/session/new` | `{keep_roster?: boolean}` → `State` (back to muster) | recap |

Errors: `4xx` with `{error: string}`. All times Unix ms. IDs opaque strings.

## Behaviour the server owns (the operator flow; absorbed from the retired `docs/spec/mission-control.md`, 2026-09-06)

- **MC is not BLE-connected to guns during play.** BLE only at the bench (armory enroll, `scan()` presence);
  mid-match MC talks to nodes over the LAN. Cross-player truth is MC-derived from node facts and exact
  (`death.shooter_num` → roster → killer); the live board is a coverage-zone view with staleness, never real-time.
- **Readiness** (`State.readiness`, contracts §4): node-reported from `status.preflight`; the laptop's `scan()` only
  lists unclaimed guns. Red (blocks the push) = no node, identity reverted/unknown, never synced, wrong SSID / MC
  unreachable; amber (shown, not gating) = the headset still confirming (A32), battery unsampled, low phone battery,
  screen off, fw unknown. After the push an empty `ack_config.gun_echo` is red and blocks `start`. Fields are aged/decayed, never
  shown stale as current.
- **Kit → lobby:** `POST /api/players` assigns `player_num` in roster order (1–63); any player change re-sends `assign`
  (re-compiles + re-pushes `config` once pushed); a phone `loadout_request` goes through the same policy
  (`policy.py`) and is answered `loadout_ack {ok: false, reason: "THE MATCH HAS STARTED — YOUR KIT IS LOCKED UNTIL
  THE NEXT ONE", loadout}` in `armed`/`live`, with nothing stored and no `config` sent (same rule as the PATCH row
  above); `tryout` pushes `tutorial`, is ended by the player's `ready`, a policy reset or END TRY-OUT, and
  refuses once the lobby is pushed. Kit → lobby auto-advances only when every rostered player is ready.
- **Push and start are separate:** `POST /api/lobby/push` compiles every bundle and refuses on reds (names them)
  unless `force`; `POST /api/start` mints `match_id`, stamps a monotonic `seq`, `go_live_t = now + runway_s`
  (default `DEFAULT_RUNWAY_S` 120; presets 60/120/180). A same-schedule re-push keeps `seq` + `match_id`; a
  reschedule mints both anew; abort reaches only nodes in range (`reached`/`unreachable`).
- **Scoring** (`scoring.py`, contracts §4): exact kills/assists, roster-based friendly (never in FFA), accuracy from
  victims' hits over own `shots_total` ("—" on a stale status; `acc_provisional` marks a number that has not
  settled — F119: hits arrive per EVENT and `shots` only on the ~2 s status heartbeat, so a row under 10 shots,
  or one whose `shots` sample predates its last landed hit, can spike and even exceed 100 %), `t_recv` re-basing for unsynced nodes, `match_id`
  parking, end freeze (`post_end_facts`), fresh-only `feedback`/`alert` (`FEEDBACK_MAX_AGE_MS`), the A11.4
  global-state alerts gated by `mc_confidence`.
- **Objective scoring — the `possession` fact (F70, node → MC).** An objective mode (`koth`/`domination`) is won on
  POSSESSION, and MC is not on the field, so the nodes report it. One event type, deliberately shaped so it cannot be
  double-counted:
  `{type: "possession", match_id, t, node_id, player_id, site?: "A", hold_ms: { "<team tid>": ms }, observed_ms?: ms, source?: "beacon"|"station"}`
  - **`hold_ms` is CUMULATIVE for the whole match, not a delta**, keyed by TEAM TID as a string (JSON has no integer
    keys). Resend it as it grows — every report is idempotent.
  - **MC merges by MAX per (site, team), NEVER by sum.** Four teammates standing on one hill all see the same
    ownership; summing would score it four times. Max also makes a duplicated batch or a reconnecting node harmless.
  - **tid 2 on a hill is NEUTRAL, not a team** (bench 2026-09-10): its time lands in `possession.neutral_s` and is
    credited to nobody.
  - **`observed_ms`** is how long this node could hear the point at all. It is what makes the number an honest LOWER
    BOUND: a grenade's ownership travels only over IR and only a gun in range hears it (F92), so a point nobody
    watched reads 0 rather than a guess. `possession.observed_s` reports the best single observer.
  - **It is exempt from the A6.1 end freeze, and clamped instead.** The report that matters is the one sent AT the
    whistle; a tally is a fact about the whole match, not a moment, so it is accepted late and capped at
    `time_limit_s`. A late one rewrites the stored recap like any other late fact (`_restore_recap`).
  - **`winner`** is the top team by `possession.by_team` when any is > 0 (a level pair is `tie`); with no possession
    reported at all, `win_by` other than `kills` stays `undecided` — host-decided, never inferred from kills.
    ⚠ Nothing on `app/src` sends this fact yet, which is why the koth card reads "POSSESSION TIME · HOST CALL".
- **The frag limit ENDS the match (F124, 2026-09-11).** `scoring.Scorer` watches the cap after every
  scored death and the Session ends on it down the same path `POST /api/control {cmd:"end"}` takes
  (`set_end` + `_finish`), so `game_over`/`victory` pushes, the recap and the stored match are identical
  to a manual END. FFA compares PER-PLAYER kills, a team mode compares the TEAM score, and a `win_by`
  other than `kills` is never ended this way (an objective match is settled by possession, a survival
  one by the last player standing). `next_kill_wins` still fires once at cap−1; the end fires once at
  the cap. `compile.py`'s warning stands — on a venue MC cannot fully see this is an **in-coverage early
  end**, which is why `control{end}` is pushed to every node (the HUD shows `frag_limit` and the gun
  never reads it, so that push is what stops the field). The feed carries one line:
  `FRAG LIMIT N REACHED — MATCH OVER · END REACHED x OF y NODE(S)`.
- **The match RESULT reaches every node (A24, 2026-09-11).** At `_finish()` MC pushes `result` to every
  BOUND player node — losers included — with `outcome` ("win"/"lose"/"draw"/"undecided") computed PER
  RECIPIENT from `winner`, plus `mode`, `win_by`, `team_scores` (`[]` in FFA: `rows` is the leaderboard),
  EVERY player's `rows`, the recipient's own `my`, `honors` (`{medal, player_id, display, stat}` —
  `display` is the PLAYER's name, so the phone needs no roster), `possession?`, `after_end?` and
  `provisional`. It is re-sent whenever the recap moves (de-duplicated on the body minus `t`) and the
  current one rides `welcome.node.result` while the phase is `recap`, so a phone that comes back into
  coverage after the whistle still learns how it ended. The node NEVER infers win or lose: a `victory`
  cue that did not arrive means "you lost" and "you were out of coverage" identically (game test
  2026-09-11 D3). `score` pushes now carry `rows` (every player) in every mode for the same reason.
  **The re-pushed `result` is the ONLY correction there is.** A `victory` sting or a `game_over` the gun
  has already played cannot be recalled, so a player whose recap is re-scored hears the old cue and then
  reads the new verdict on the phone; the feed's `THE WINNER CHANGED` line is the operator's cue to say
  it out loud. MC never re-fires audio to "undo" a result.
  **The result speaks to the roster AS PLAYED (round-2 review, 2026-09-12).** Both the recipient's team
  (so `outcome` is for the side they actually wore) and the set of recipients come from the roster frozen
  at the whistle, not the live one the operator is editing for the next match: a player re-teamed in the
  debrief is still told the outcome of the side they played on, and a player ADDED during the debrief is
  sent no `result` at all and gets none in `welcome.node.result` — they were not in the match, so their
  HUD shows the neutral "no result for you" state rather than a win they did not earn. They are not
  registered into the finished scorer either, so the archived recap keeps exactly the rows that played.
- **The recap is a REPLAY of the stored facts (A24/M2, 2026-09-12).** A frag-cap match ends at the
  TIMESTAMP of the winning kill, not when MC learned of it — so a phone that flushes minutes late can
  reveal that somebody ELSE reached the cap EARLIER. When a death lands after the whistle within
  `end_t + CLOCK_TIE_MS`, MC re-derives the whole recap as a pure function of (the stored envelopes for
  this `match_id`, the end rule): find the cap on a clean pass, freeze a second pass at it, re-park what
  now falls after the end, check for a dead heat, re-take the recap, re-push `result`. The end moves
  only for a frag cap, and only EARLIER — a host END and a time limit are moments the whole field lived
  through (A6.1), and a re-derived cap that falls LATER than the whistle (a late friendly-fire death in
  the tie band subtracts a kill) is refused outright, because moving the end forward would promote
  post-whistle facts into the official tally after the field was already told `control{end}` —
  and the feed says so: `END MOVED BACK N.Ns …` / `THE WINNER CHANGED on re-scored facts`. `shots` (a
  status sample, not an event) and the `flushed` marks are carried over, not replayed.
- **Recap** is provisional until every rostered node has flushed (`provisional`, `missing`, `settling`); late
  `event_batch`es and parked events reconcile in; honors need ≥ 3 scored players (F116: the per-kill medals
  in `ScoreRow.medals` do not, which is what gives a 1v1 a medals column); the roster the replay scores
  against is FROZEN at the whistle, so a re-team made in the debrief never moves a finished match onto
  teams nobody wore; `session/new` returns to muster
  with KITTED nodes (a rematch is a new push).
- **Persistence:** session state under `~/.brx-mcp/` (`store.py`, SQLite: every inbound envelope with `t`, `t_recv`,
  `match_id`, parked flag; `presets.json`; `weapon-verdicts.jsonl`), so a restart re-hydrates and `GET /api/matches`
  survives a crash.
Static UI: `GET /` serves `webapp/mc/dist` when present (dev: Vite proxies `/api` and `/ui-ws` to the server).
