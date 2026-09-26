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
watch `/api/state` and `/api/recap` — **except the paths in `_AuthMiddleware._TOKEN_GETS`** (today
`GET /api/diag/matches`) and the prefixes in `_TOKEN_GET_PREFIXES` (today `GET /api/report/<file>`, which takes the `Bearer` header only, never `?tok=`), which are read-only but are not spectator data: "read-only" answers whether a request
can change the game, not whether a stranger on the field LAN may have the thing. A missing/wrong token is `401 {"error":"unauthorized"}` (HTTP) or an
accept-then-close **4401** on the WebSocket. `State.lan.auth_required` tells the UI whether a token is in force;
the UI keeps the token from the URL fragment in `sessionStorage` and never puts it in a path. `--no-auth`
disables the gate (bench only — any device on the LAN can then `panic`/`end`/edit the roster).

## Realtime feed — `GET /ui-ws` (WebSocket)
Server sends `{ "kind": "snapshot", "state": <State> }` on connect and on every state change
(coalesced, ≤4/s), plus `{ "kind": "feed", "entry": <FeedEntry> }` for live events.
```jsonc
State {
  active_preset_id?: string | null,             // A10 §8: the saved game that was APPLIED (null once the config is edited) — GAMES marks it PLAYING
  bench_volume?: number,                        // `--bench-volume N` (bench 2026-09-16): every $VOL MC compiles plays at N. ABSENT on a normal run
  restored_from?: { at: number, players: number },   // F142 (field 2026-09-12): this roster came back off disk.
                                               // ABSENT when nothing was restored, so presence is the rule for showing
                                               // "restored from <date>" on the board beside a NEW SESSION, CLEAR ROSTER
                                               // control (`POST /api/session/new` with keep_roster false, which clears this).
                                               // A snapshot is restored only into a run of the SAME kind — a `--demo`
                                               // session is never restored into a real launch, or the other way round:
                                               // two demo players sat on a real field roster all night and the only
                                               // hint was one banner line in a terminal.
                                               // Restore brings back ONLY the durable work: roster, config, teams,
                                               // stations, game numbers. Phase, LOAD (`game.loaded`), the lobby push,
                                               // acks and the start are deliveries the OLD process made, so a restarted
                                               // MC boots in `muster` with none of them and a re-hello gets no config,
                                               // frames or start (bench 2026-09-16; `tests/test_mc_persist.py`).
                                               // ONE exception (bench 2026-09-17): a match that was ARMED/LIVE when
                                               // the old process stopped RESUMES (`resume_match`): the scorer is
                                               // rebuilt from the stored facts, and a re-hello gets the SAME start
                                               // (same match and seq, a no-op on a phone in play), never a config.
                                               // Past its end time it is restored finished (recap written, A34/A42
                                               // end the phones still live). `tests/test_mc_resume.py`
  session_id, phase, t,                      // server time (Unix ms)
  mc_confidence: { confident: boolean, missing: string[], stale: string[], unflushed: string[] },   // A11.5: player_ids; gates the MC-driven global-state events
  lan: { mode: "router"|"hotspot"|"lan", ssid: string|null, ip: string, port: number, ws_url: string,
         // F143 (field 2026-09-12): `"unknown"` is GONE. It was hard-coded at launch and the REACH panel
         // printed it as a display word — "UNKNOWN · 192.168.28.167:8765". MC now detects the SSID per
         // platform (best effort, 2 s cap, never fatal); when nothing answers the mode is `"lan"` and
         // `ssid` is null, which renders as "LAN · <ip>:<port>". `router`/`hotspot` are reserved for a
         // detector that can tell them apart. NEVER render a mode value that is not a real word.
         qr: string,   // A28.2: `ws://<ip>:<ws-port>/ws?s=<join_secret>[&pub=<url-encoded public ws_url>]` -- NOT the same as ws_url any more
         warning?: string | null,   // T3-A (field 2026-09-12): MC advertised a WSL2 NAT address in the QR/mDNS
                                     // and no phone could reach it -- the operator was told over chat to find
                                     // the Windows LAN address by hand and forward it with a netsh portproxy
                                     // that points at a WSL IP changing on every restart. Set only when
                                     // netinfo.is_wsl() DETECTS a Microsoft kernel (/proc/version) AND nothing
                                     // (`--advertise <ip>`) has told MC the advertised address is already
                                     // correct. The reachability claim itself is an INFERENCE, not a
                                     // measurement -- MC has no phone here to ask, and cannot tell WSL2's
                                     // default NAT networking mode (always wrong) from mirrored mode (the one
                                     // case this warning is wrong) from inside the VM -- so render it verbatim,
                                     // never strengthen the wording. null/absent on every non-WSL host (macOS,
                                     // plain Linux never set this -- pinned by test_mc_netinfo.py/test_mc_advertise.py).
         join_secret: string,   // A28.2: 8 url-safe chars, per session, persisted; enforced only on hellos that arrive through the tunnel
         public: { ws_url: string|null, status: "off"|"starting"|"up"|"error", provider: "cloudflared"|"manual"|null, available: boolean, was_up?: boolean, error?: string,
                   detail?: string } },  // A28.1; `detail` is F140 (field 2026-09-12): the sub-state under
         // `starting` — `"resolving <host>"` while MC waits for the tunnel hostname to answer at
         // Cloudflare's own resolver, and a warning line under `up` when it never did inside 60 s.
         // `status` does NOT reach `"up"` (and `qr` carries no `&pub=`, and no `join` is pushed) until
         // the name resolves: cloudflared printing the URL is not the moment the world can reach it, and
         // a phone that dialled a second too early had the miss negative-cached for ~250 s.
  coverage: { level: "full"|"zones", on_backhaul: number, on_cellular: number, bound: number },
                                              // A28.4: on_backhaul = bound player nodes connected with reach == "backhaul".
                                              // F309 (2026-09-23): on_cellular = those that also report status.transport ==
                                              // "cellular" (and are not stale), an independent path. level is "full" iff every bound node is
                                              // on_cellular. reach alone names only the URL a phone joined through (F256)
  nodes: NodeView[],                          // every node that ever said hello this session
  stations: StationView[], game_byte: number,   // A13.5: the ITEMS panel (see GET /api/stations); game_byte = the advert `game` byte (1..255) stations are armed with THIS match (bumps on the first push after a match started)
  game_no: number,   // X10: the old name for game_byte, the same wrapped byte; kept for an older console
  readiness: ReadinessSnapshot,               // Each ReadinessRow also carries `reach` and `last_reach` (same values as NodeView),
                                               // and `pool_stale: "silent"|"no_fire"|"write_lost"|"pool_wrong"|null`, `pool_stale_ms: number|null` (F208/A46; null = not stale or not reported).
                                               // F272: optional `gun_locked: true` is a current positive lock-up verdict. Missing/false
                                               // means no claim (including an older app); never render it from an offline/stale row.
                                               // The node omits it while actively re-arming, then restates it if retries are exhausted.
                                               // F144 (field 2026-09-12): `reach == "backhaul"` is GREEN — a phone MC is
                                               // talking to right now is ready. Render the path as a TAG on the card, never
                                               // as a CHECK; the amber "NOT ON THE FIELD WI-FI — ON BACKHAUL" is gone, and
                                               // amber/red are only for a node MC cannot reach at all.
                                               // F155: for a node whose `last_reach` was `"backhaul"` the blocker reads
                                               // "NOT REACHED FOR <AGE>" (with ", TUNNEL DOWN: TURN THE TUNNEL ON IN REACH"
                                               // appended while `lan.public.status` is `"error"`), NEVER "WRONG WI-FI OR MC
                                               // UNREACHABLE": the phone was on the right network and the tunnel went away.
                                               // F221 (2026-09-25): every blocker and amber reads `WHAT IS WRONG: WHAT TO DO`,
                                               // upper case, one colon, and never says BLOCKS START / DOES NOT BLOCK: the list
                                               // a line is in is the gate, and the console picks its colour from the line's head
                                               // (webapp/mc/src/alerts/server.ts). PHONE BATTERY LOW is raised under 30 %.
                                               // A25/A29: each row also carries `app_ver`, `platform` and `log` (same shape as
                                               // NodeView.log). A29 adds one RED blocker, `APP <x.y.z> INCOMPATIBLE WITH MC (NEEDS <tier>):
                                               // UPDATE THE APP`, and three ambers: `APP OLDER THAN THE FIELD (<mine> < <newest>): UPDATE THE
                                               // APP`, `APP OLDER THAN THE RELEASE (<mine> < <release>): UPDATE THE APP` and `APP VERSION
                                               // UNKNOWN (<raw>): UPDATE THE APP`.
                                               // An UNPARSABLE version is amber, NEVER red (A1: amber never blocks — the app shipped a
                                               // hard-coded `hud-0.2` for months). An incompatible build says the ONE thing and is left out
                                               // of `newest`, so one rogue phone cannot amber the whole board. Render the strings verbatim.
                                               // A32: `headset: "proven"|"unknown"|"absent"` is joined by `headset_proof: "echo"|"link"|null`
                                               // (additive) — HOW it was proven. `"echo"` = the gun answered the config push; `"link"` = the
                                               // node's `status.preflight.gun_linked` has been TRUE CONTINUOUSLY for `HEADSET_LINK_PROOF_MS`
                                               // (10 s), which a gun with no headset cannot manage (it drops the link in ~6 s); `null` = not
                                               // Bench 2026-09-17: `gun_flapping: boolean` — true while the gun keeps dropping and re-taking
                                               // the link within seconds, again and again (a headset that is off does this). The card shows
                                               // one steady amber HEADSET OFF line instead of GUN LINK LOST cycling with HEADSET CONFIRMING —
                                               // but only while `headset` is unproven; a gun that already answered the config push and then
                                               // goes dark still reads the blocker `GUN LINK LOST: CHECK THE GUN IS ON AND RECONNECT IT`.
                                               // A37: `echo: "proven"|"mismatch"|"not_echoed"|null` is the WEAPON check's own answer,
                                               // beside (not instead of) the red `GUN ECHO ≠ CONFIG` blocker a `mismatch` also produces.
                                               // THREE states because the field has three: protocol.md records the `$WEAP` echo as never
                                               // seen from our v4.32 units and `$ALCD` as streaming on ammo events only, so the ordinary
                                               // answer to a head write is `$START`'s `$LCD` and nothing more — which the two-state
                                               // reading rendered as GREEN for a check that never ran. Render `not_echoed` NEUTRAL (grey),
                                               // never amber and never as a proof; the console's copy for it is the fixed sentence
                                               // `GUN DID NOT ECHO ITS WEAPON — UNPROVEN ON THIS FIRMWARE`. `null` = no check to report
                                               // (nothing pushed, no ack yet, an ack for another head, or a head with no readable `$WEAP,0`).
                                               // `?mock&faults=1` demos all five config-proof states (webapp/mc/README.md).
                                               // proven. A link that drops sends the row back to `unknown` and the clock restarts. While a
                                               // link is counting up the row carries the amber `HEADSET CONFIRMING (LINK <n> S)`, which
                                               // clears itself at 10 s — the UI renders it through the normal amber path and does NO timing of
                                               // its own. `absent` is unchanged: the head echoed nothing, and `GUN DID NOT ANSWER CONFIG:
                                               // CHECK THE HEADSET IS ON, THEN RE-PUSH` stays a blocker that outranks any link evidence
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
  config_errors: string[], config_warnings: string[],   // warnings: e.g. frag_limit without full coverage (A6.1); A10: "N LOADOUTS RESET BY <ruleset>" after a policy change overwrote picks (cleared on the next PUT); a warning starting `SETUP: ` is a PHYSICAL step the operator must do on the field before the push (F70: power-cycle the grenade so the hill starts neutral; an `ir_station` source says instead that we have never had one on the bench) — the GAMES rail renders those verbatim, and so do the LOBBY and ARMED headers, where the operator is standing when the step is actionable. **F401 (2026-09-25):** `"<KIND> <ID> HAS NOT SYNCED THE LAST MATCH: BRING IT INTO WI-FI BEFORE YOU LOAD, OR ITS RESULT IS LOST"` for any station of the LAST FINISHED match MC has not heard from since that match's whistle (`Session._station_sync_warnings`, beside `_station_warnings()`) — advisory, never blocks LOAD or START, clears the moment the station is heard again. **F146 (field 2026-09-12)**: the weapon-design §2.1 one-magazine rule is a WARNING, not an error — `PRIMARY <WEAPON> CANNOT KILL ON ONE MAGAZINE: mag N < H hits at D dmg vs a P pool`. It grades the PRIMARY slot only (a sidearm is a backup and is exempt) against the BASE pool and the weapon's own magazine (no perks), because grading the perk-armed pool meant one player's Body Armor banned every sidearm in the game, as a hard error, at a real match. What IS an error now is a ruleset with no legal primary at all: `LOADOUT RULES: THE PRIMARY FILTER EXCLUDES EVERY WEAPON …`, which used to degrade silently to "N LOADOUTS RESET BY <ruleset>" and then fail on a pistol the operator never chose
  players: Player[], teams: Team[],
  kit: { kitted: number, total: number, trying: { [player_id]: weapon_id }, browsing: { [player_id]: t_ms } },   // A10 browsing = HUD has its loadout browser open ("PICKING…"), 60 s expiry
  loadout_pool: { primary: string[], secondary_weapons: string[], perks: string[] },   // A10/A14: allowed ids per slot under config.loadout_policy (server-computed; render, don't re-derive)
                                               // S37 (field 2026-09-12): with `secondary_weapons` empty, a perk that only
                                               // does something with a SECOND weapon (`effects.switch_mult` — Quick Switch,
                                               // the $WEAP tok15 swap delay) is NOT in `perks`. Render the pool and the
                                               // control disappears by itself; a phone that picks it anyway is answered
                                               // `loadout_ack {ok:false, reason:"Quick Switch switches between two weapons,
                                               // and there is no second weapon this game"}`
  lobby: { ready: number, updating?: number, total: number, pushed: boolean, all_acked: boolean,
           acks: { [player_id]: { ok: boolean, gun_echo?: string, err?: string, config_id?: string } } },
                                              // F178 (2026-09-23): `ready` is the players' intent. `updating` is the part of
                                              // it whose gun has not answered the pushed head: a bound READY player with no ack
                                              // yet, or an ok ack naming an older config_id. 0 before the push; a refused ack,
                                              // or an ok ack with no echo, is a red, not counted. The console shows "6/7 READY · 1 UPDATING"; absent = 0.
                                              // A36 (2026-09-13): `config_id` is WHICH config that gun answered for.
                                              // An ack naming a previous one is NOT an ack for the game about to
                                              // start -- `all_acked` reads false, the row carries the blocker
                                              // `ACKED AN OLDER CONFIG (<id>): RE-PUSH`, and `POST /api/start`
                                              // refuses even with `force`. A re-push mints a FRESH `config_id` (F6),
                                              // so an ack in flight across one is stale and says so.
                                              // (An echo MISMATCH also refuses START, but `force` DOES open that
                                              // one: the rule behind it is unbenched on v4.32 -- F2.)
                                              // Anything counting "acked" must ask the
                                              // same question (it is `all_acked`), or the console reads 4/4 green
                                              // beside a START the server will not run.
  start?: { match_id, go_live_t, seq, countdown_s, per_node: { [player_id]: { arm_state, t_minus_ms?, synced, last_seen_ms } } },
  live?: LiveView,
  recap?: RecapView,
  end_delivery?: {                            // A42 (2026-09-13): DID THE END REACH EVERY HUD? Present from the moment a
    match_id: string,                         // match ends until the next is scheduled; absent otherwise and on an older
    total: number,                            // server. `total` = the bound player HUDs the end was expected to reach
    confirmed: number,                        // (a benched player has no node; a station is not in the match; an UNBOUND
    retrying: boolean,                        // node is still PUSHED the end but has no roster row to name).
    unconfirmed: [ { player_id, display, node_id, tries: number, since_ms: number,
                     reached: boolean, retrying: boolean } ]
  },                                          // The ack is DERIVED from the ~2 s status heartbeat — `arm_state` plus
                                              // `match_id` — so no new envelope kind exists and a phone running an OLDER
                                              // build confirms exactly as well as a new one: `_endLocal` moves it to
                                              // `kitted` and KEEPS `match_id`, so a HUD that took the end reads `kitted`
                                              // for that match and one that missed it reads `live`. MC re-pushes
                                              // `control{end, match_id}` to the unconfirmed on a backoff (`state.py`
                                              // END_RETRY_MS: 2 s, 5 s, 10 s, 20 s, 40 s, 60 s, then it stops and A34's
                                              // reconcile is the long tail). ⚠ It NEVER gates: `_finish()` has written
                                              // the recap and moved MC to `recap` before the first retry is due, because
                                              // a player who walks out of range at the whistle must not be able to hang
                                              // it. Render it as a DELIVERY fact (LIVE notice + STATUS cell, RECAP line),
                                              // never as, or beside, a judgement about how that player played
  orphan_match?: { match_id, phones: number, players: string[], arm_state: "armed"|"live", can_resume: boolean },
                                              // Bench 2026-09-17: ABSENT unless at least one BOUND phone heard in the last
                                              // STALE_AFTER_MS reports armed/live in a match this MC did not schedule,
                                              // resume or adopt, and never retired. The match most phones report wins.
                                              // The MATCH tab shows it with RESUME MATCH (only when `can_resume`) and END
                                              // THEIR MATCH. Nothing happens until one is pressed
  notices: { mc_verify?: string }             // A31 (2026-09-12): standing HOST lines the compiler wrote once, so MC
                                              // and the phones cannot disagree. `mc_verify` is present ONLY when this
                                              // game's end state is MC's call (a frag cap, an objective `win_by`, a
                                              // survival mode) AND `config.coverage != "full"` AND at least one
                                              // rostered phone has no backhaul (A28) — and it NAMES those phones:
                                              // `WIN IS CONFIRMED AT MC, 3 PHONES OFF-GRID (OP0, OP1, OP2): TELL
                                              // PLAYERS TO RETURN AFTER THE WHISTLE`. Render it verbatim on LOBBY and
                                              // ARMED. `{}` (no keys) = nothing to say. The PLAYER's half of the same
                                              // decision rides `assign.game.mc_verify` (contracts §3), one line, no
                                              // names. F309: a phone is off-grid unless it joined through the tunnel AND
                                              // reports `transport: "cellular"` (`state.py _independent_path`, the
                                              // same test as `coverage`); an older app is always off-grid.
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
NodeView { node_id, node_type, gun_name?, gun_tail?, player_id?, arm_state, last_seen_ms, synced, preflight?, battery?, fw?, hp?, armor?, ammo?, alive?, reach?: "lan"|"backhaul" /* A28.3: stamped by MC from the socket's arrival path (loopback / Cf-Connecting-Ip / public peer = backhaul), never from the phone's claim; cleared on disconnect */,
           last_reach?: "lan"|"backhaul" /* F155 (field 2026-09-12): the path this node was last HEARD over. `reach` goes away with the socket; this outlives it, and it is what makes an unreachable row's reason honest */,
           pool_stale?: "silent"|"no_fire"|"write_lost"|"pool_wrong", pool_stale_ms?: number /* F208/A46: the node's current `status.pool_stale` claim (no gun frame for 185 s / three trigger presses with no shot / this life's spawn or revive write lost, pl4 / the gun's pools are not the armed ones after two repairs, F341) and ms since the gun last reported a pool. Absent = not stale, or an older app; each heartbeat restates it */,
           gun_locked?: true /* F272: current positive lock-up verdict; absence, false or junk clears it */,
           transport?: "wifi"|"cellular"|"none"|"unknown" /* F309: the phone's own last `status.transport` claim; absent = never reported */ }
LiveView { match_id, go_live_t, time_limit_s, ends_t, score: { [team_id]: number }, rows: LiveRow[],
            phones_ended?: true /* A47: an ADOPTED match every claiming phone has ended; the console asks for END */,
            possession?: RecapView.possession /* visual QA H2 2026-09-23: the same merged tally, live; absent until a node reports one */ }
LiveRow  = ScoreRow + { status: "alive"|"down"|"stale", respawn_in_s: number|null,
            sync_age_ms: number /* NEVER_SEEN_MS (10^9) = MC has not heard this node since it started: a sentinel, not an age */, pool_stale?: "silent"|"no_fire"|"write_lost"|"pool_wrong", pool_stale_ms?: number /* F208/A46, as NodeView */,
            gun_locked?: true /* F272, as NodeView; suppress when this row is stale */,
            possibly_protected?: true /* F289: ONLY on a "stale" row. The newest evidence from that phone (a `status.protected`,
                                         or a respawn / team_change fact with `protect_ms` and no status after it) says it had not
                                         ended spawn protection, so the gun may take no damage. Cleared by any later status without
                                         `protected`, and at START. The console reads POSSIBLY PROTECTED · HITS MAY NOT COUNT */,
            operator?: OperatorStatus /* A47: the last operator action for this player in THIS match */ }
OperatorStatus { cmd: "resync"|"respawn"|"relink", state: "sent"|"done"|"refused"|"no_answer" /* pl4: no answer 15 s after the send; relink "done" = started */, why: string|null, sent_t: number, result_t: number|null }
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
                                    // F150 (field 2026-09-12): the per-kill medals are no longer gated on
                                    // the VICTIM node's clock being synced. That gate is A5.7's, it is
                                    // decided on the node that reported the death, and every medal on
                                    // that kill belongs to somebody else — one unsynced phone wiped the
                                    // medal column of whoever killed them (11-5, no medals). Only the
                                    // MULTI-KILL tier, which really is a time window, stays suppressed;
                                    // first blood and the streak medals are a count and an ordering
           // --- additive 2026-09-11 (F116/F119); an older UI ignores them, an older server omits them ---
           best_streak: number,     // F116: the LONGEST streak this match. SHOW THIS ONE. `streak` is the
                                    // CURRENT streak and is 0 for whoever died last, which is how a 9-kill
                                    // row read "streak 0" — it stays only so an older UI keeps working
           multi_best: number,      // longest multi-kill chain (2 double · 3 triple · 4 killtacular · 5 killtrocity · 6 killamanjaro · 7 killtastrophe · 8+ killionaire, types.MEDALS; 0 = none)
           first_blood: boolean,    // this player drew first blood
           acc_provisional: boolean,// F119: `accuracy` is NOT settled — render it as settling, not as fact
           // --- additive 2026-09-12 (A24/M2). UNOFFICIAL: what this player picked up AFTER the whistle
           //     (A6.1 post-end facts). They feed nothing — not kills, not streaks, not medals, not the
           //     winner — and are the last two columns of the CSV export for the same reason. 0/0 when
           //     nothing landed late, so presence never has to be tested for.
           after_end_kills: number, after_end_deaths: number
         }
RecapView { winner: Winner, score: { [team_id]: number }, rows: ScoreRow[],
            honors: { award: string, player_id: string, stat: string, key?: string }[], provisional: boolean, missing: string[], played_s?: number,
                                       // A63: `key` = the `types.AWARDS` row (contract.gen `AWARDS`: key, label, rule, tie);
                                       // `award` stays its label. A tie is SHARED: one row per tied player, so key React
                                       // lists by (key, player_id). A recap stored before A63 has no `key`.
            post_end_facts: number,    // A6.1: facts after end_t, recorded but not scored
            after_end?: { facts: number, by_player: { [player_id]: { kills: number, deaths: number } } },
                                       // A24/M2 (2026-09-12): the same facts, BROKEN DOWN. Absent when nothing
                                       // landed after the whistle. Show it as "after the whistle" — it is real
                                       // (a player kept playing, or a phone flushed minutes late) and it counts
                                       // for nothing. `winner` may itself carry `tie: player_id[]|team_id[]` when
                                       // two sides reached the frag cap within CLOCK_TIE_MS (1 s, contracts §7):
                                       // MC cannot order two kills inside the clock band and does not pretend to.
                                       // F154 (field 2026-09-12): an FFA whose TOP ROWS ARE EQUAL is a tie too —
                                       // `{player_id: null, tie: [...]}`, so each of them is told `outcome: "draw"`.
                                       // `rows[0]` is a sort artefact and used to be published as the winner, which
                                       // is how a phone was shown LOSE on a 1-1 board
            possession?: { by_team: { [team_id]: number /* SECONDS held */ }, neutral_s: number, sites: number,
                           reports: number /* nodes that reported */, observed_s: number /* best single observer */,
                           of_s: number|null /* the match length it is measured against */ },
            stations?: RecapStationRow[] }
RecapStationRow { node_id: string, kind: StationKind, id: number, team: number, heard: boolean,
                         revives?: number|null /* respawn only; null = the station was never heard from */,
                         hold_ms?: Record<string, number>|null, owner?: number|null /* control only, from report.control */,
                         synced?: boolean /* F401, absent until the match has ended */ }
            // possession is ABSENT unless some node reported it (objective modes only) — see `possession` below
            // stations is ABSENT unless some station is ASSIGNED (roadmap A6) — one row per assigned station,
            // straight from `Session.stations_view()`'s own `report` at the moment the match ended (or NOW,
            // on a still-live recap poll); a station never heard from still gets a row, with `heard: false`
            // and its kind-specific fields null — `heard` is set for every kind (extraction/powerup/bomb
            // included), since only respawn/control have a count of their own to fall back on
            // F401: `synced` is ABSENT while the match has not ended, else true once MC has heard this
            // station's NODE (last_seen_ms) at or after the whistle — a HELD station (a StickS3) can end
            // a timed match on its own clock while out of Wi-Fi range, and its result is not known until
            // it is heard again. Computed LIVE, not frozen: a station heard again after a roll forward,
            // even under a new assignment, still flips its OWN match's row true. `config_warnings` (LOAD)
            // carries the same fact as a line, for any station of the last finished match still unsynced.
Winner   { team_id?: string|null, player_id?: string, undecided?: string /* win_by not decided by kills: host/objective decides */, tie?: string[] /* tied team_ids */ }
FeedEntry { t_match_s: number, text: string, tag?: "DOUBLE KILL"|"TRIPLE KILL"|"STREAK ×N"|"FIRST BLOOD"|"TEAM KILL"|"SYNC POINT"|"ALERT"|"WITHHELD"|"ROLE"|"OPERATOR"|"RECONCILED"|"RESUMED"|"NOTE"|"AFTER WHISTLE"|"TEAM CREDIT"|"STATION"|"CONFIG"|"END"|"POWERUP"|"RESCORED"|<a kill's medals, upper-case, joined by " + ", e.g. "FIRST BLOOD + DOUBLE KILL">, kind: "kill"|"sync"|"info"|"alert" }
// F118 (2026-09-11): an `alert` entry's `text` is the OPERATOR's copy — third person, mode-aware, ids
// resolved to display names ("ROCCO takes the lead" in FFA, "RED takes the lead" in a team game). The
// PLAYER's second-person line ("YOUR TEAM TAKES THE LEAD") is unchanged and still rides on the node's
// `alert` body, so the phone lane picks up nothing. Render `text` verbatim; never re-word it.
```

## REST

WeaponView dual-emitter note: `dual_emitter: true` marks a trigger that can produce separate gun and headset words. `dmg_per_hit` and `htk` are then conditional per-pull totals when both words land; the UI labels these values with `*` and explains the condition.
| method path | body → response | phase |
|---|---|---|
| `GET /api/state` | → `State` (same as the WS snapshot) | any |
| `GET /openbrx.apk` | → the staged phone APK as a file download, `application/vnd.android.package-archive`. It serves the first of `~/.brx-mcp/openbrx-node-debug.apk` and `<ui dist>/openbrx.apk`, so a webapp rebuild cannot wipe the path. **404 `{error:"no apk staged"}` when neither file is there.** Not under `/api`, and not token-gated: a player's phone must be able to fetch it before it has anything. The ARMORY screen builds the link (`webapp/mc/src/screens/Armory.tsx`) only when `lan.ip` is a routable LAN address | any |
| `POST /api/armory/scan` | `{duration_s?}` → `ScanRow[]` | muster |
| `GET /api/armory` | → `ArmoryRecord[]` | any |
| `GET /api/presentation` | → `{summary: {preset, announcer, voice: "on"\|"hits_only"\|"off", gun_flash, headset_team, sight_flash, hud_events, mc_events, mc_confidence, custom_events, headset: {pregame, start_flash, in_play, hit, death: "native"\|colour, respawn_flash, carrier}, gun: {in_play: "native"\|"team"\|"dark"\|"health"}}, events: PresentationRow[], mc_confidence: {confident, missing, stale, unflushed}, presets: string[]}` — A11/A11.5: TONIGHT'S applied game's presentation profile, resolved. **A22** `voice` (default `"on"`) gates the player's OWN pain + spawn lines, independent of `announcer` (MC/announcer feedback); `"hits_only"` drops the spawn line only, `"off"` drops both; the `silenced` preset sets it `off`. `PresentationRow` = `{event, source: "hud"\|"mc"\|"both", desc, sound: id\|null, words, gun_led: 0-8\|null, headset: 0-8\|null, flash: "green"\|null, slot: "queue"\|"interrupt"\|null, text, enabled}`. `slot` (bench-confirmed 2026-09-11): an explicit `$PLAY` slot override, token 4 (queue, waits behind whatever is playing) or token 1 (interrupt, cuts it) -- `null` keeps the default pattern (V-family ids queue, others interrupt); a `voice:<role>` sound always queues regardless. Read-only; the UI's ADVANCED view. **Absent on an older server (404): the UI shows the "server predates this UI" banner and nothing else breaks.** | any |
| `GET /api/modes` | → `ModeInfo[]` `{mode, name, abbr, desc, brief, teams_text, win_text, respawn_text, mvp: bool, defaults: GameConfig, params: ModeParamSpec[]}`. **A18:** `params` = the mode's own tunables as its ENGINE declares them (`{name, type: int\|float\|bool\|str, default, desc, min?, max?, choices?}`; `[]` for tdm/ffa/infection) — render controls from it, never from a list in the UI; `defaults.mode_params` carries the values. **`mvp`** (2026-09-25 MVP scope cut): `true` for tdm/ffa/koth, `false` for infection/lms/extraction — the flag a host's own STOCK MODES / BASE MODE / kind-of-game picker filters on, so an `mvp: false` row still resolves (name, brief, defaults) for an OLD saved game or a config PUT naming it, it is just not offered as a fresh pick. `koth` (King of the Hill) defaults to BLUE + GREEN — tids 1 and 3, never 2, which is what a NEUTRAL hill broadcasts, and a koth/domination config may not even CONTAIN a tid-2 team (F82, refused at PUT) — and `win_by: "objective"`, decided by the `possession` fact below (`win_text` says "· HOST CALL" while no node sends one) | any |
| `POST /api/loadout/pool` | `{loadout_policy, mode?}` (partial policy ok) → `{policy, pool: LoadoutPool}` — preview a DRAFT ruleset's allowed ids for the game designer; nothing applied | any |
| `GET /api/weapons` | → `WeaponView[]` `{weapon_id, name, cls, weapon_class, clip, mags, reserve, reload_s, reload_ms, dmg, rpm, rng, dmg_per_hit, pool, ammo_total, bars, verified, tags: string[], role, htk, ttk_ms, caution?, pickup_only?}`. **Draw meters from `bars` `{power, rof, ammo, ttk}` (0–100, ranked across the arsenal, any may be `null`), never from raw `dmg`** — `dmg` is the *share of the 115 pool one hit removes* (7–11 for most guns), so a raw 0–100 bar reads near-empty for everything (field 2026-08-30). `bars.ttk` is inverted (faster kill = longer bar) and is `null` for a one-shot weapon, which has no time-to-kill. **There is no range bar**: `rng` is identical on all 18 guns. `reload_s` is **null** when the weapon has no reload time — render `—`, never `0.0` and never a bare unit. `dmg_per_hit` is the real per-hit damage and does NOT move with the pool. **`pool` is the HOST'S health config (`config.health.max_hp + max_armor`), not a constant** — `htk` and `ttk_ms` are quoted against it and both move when the host changes health (`docs/weapon-design.md` §2.5: the AR needs 13 hits at 45/70 and 23 at 100/100), so a UI showing either must show `pool` beside it. `ttk_ms` is `null` when it cannot be derived. `caution` = known live problem, show on tile + hero. **`weapon_class`** (2026-09-17, arsenal review): `"ballistic" \| "energy" \| "melee"` — ballistic weapons reload, energy weapons overheat or charge; not the same as `cls` (the raw protocol class byte). Named `weapon_class` on the wire because `class` is a Python keyword (`weapons.json`'s source field is still `class`). **`pickup_only?`** (2026-09-17): true for a weapon that is catalogue-visible but never in a starting-loadout pool (`rocket_launcher`, `rail_gun`, and the hidden heavies) — the pickup/station mechanism itself is future work (`docs/spec/loadout.md`) | any |
| `GET /api/voices` | → `VoiceList {default: string, voices: VoiceOption[]}` from `compile.voice_options()`; `VoiceOption {id, name, family, speaker?, lines?, kill_line, verified}` — the selectable `$PSET` voice personas (the full pack, not just male/female); `PATCH /api/players/{id}` validates `voice` against these ids. Only HEAVY is confirmed by ear (`gameconfig.VOICE_PACKS`) | any |
| `GET /api/range/verdicts` | → `{ [weapon_id]: {verdict: "pass"\|"issue", note, t} }` — the latest bench verdict per weapon, read from the tail of `~/.brx-mcp/weapon-verdicts.jsonl`; `{}` when the log is absent. Feeds the KIT arsenal's field-range badges | any |
| `POST /api/range/verdict` | `{weapon_id, verdict: "pass"\|"issue", note?}` → `{ok}`; appends one JSONL record (`note` capped at 400 chars). `400` without both fields; a read-only disk is `{ok:false, error}`, never a 500 | any |
| `GET /api/perks` | → `PerkView[]` `{perk_id, name, desc, tags, mechanism: "passive"\|"slot_frame", effects, gain, cost, verified, hidden}` — visible rows only (A10, `docs/spec/loadout.md` §1.2). S50 (2026-09-19): `gain`/`cost` are `string[]` player-facing lines (`perks.py` `gain_cost_lines`), the ONE place either UI reads a perk's trade from — render them, do not re-derive from `effects` | any |
| `GET /api/presets` | → `SavedGame[]` `{preset_id, name, desc, builtin, created_t, updated_t, config}` — the builtin "Silenced Sniper" (`builtin:silenced_sniper`) is always first (A10 §8, `docs/spec/loadout.md`) | any |
| `POST /api/presets` | `{name, desc?, config?, replace?}` → `SavedGame` (default `config` = the current draft; `config_id` stripped). `409` on a case-insensitive name clash unless `replace: true` (keeps the id); `403` for a builtin name; `400` bad name/config | any |
| `PUT /api/presets/{id}` | `{name?, desc?, config?}` → `SavedGame`; `403` builtin, `404`, `409` clash | any |
| `DELETE /api/presets/{id}` | → `{ok}`; `403` builtin, `404` | any |
| `POST /api/presets/{id}/apply` | `{}` → `{ok, errors, config}` — exactly `PUT /api/config` with the preset's config (fresh `config_id`, `apply_policy`, the "N LOADOUTS RESET BY …" warning) | muster/build/kit |
| `POST /api/lobby/push` (station side) | in addition to compiling: bumps `game_no` if a match has STARTED on the current number, pushes `config.stations = [{id, kind}]` (the ids MC armed, contracts A13.1 — derived on the wire, never written into the operator's config) to every player node, and re-arms every assigned station with the new number. `config_warnings` gains `SETUP: NO CONTROL STATION IS ASSIGNED …` for a `phone` objective with no `control` station, `SETUP: A CONTROL STATION IS ASSIGNED BUT THIS GAME'S OBJECTIVE IS THE GRENADE|AN IR STATION …` for a `control` station under a `grenade`/`ir_station` objective (every phone drops its advert; MC never switches the source) and `SETUP: NO RESPAWN STATION IS ASSIGNED …` for `respawn.type == "scanner"` with no `respawn` station (advisory: a station may be armed by hand on the phone) | build/kit |
| `PUT /api/config` | `GameConfig` (partial ok) → `{ok, errors: string[], config}`. **A50 (2026-09-19)** `health` is `{max_hp: 1..255, max_armor: 0..255, max_shield: 0..255, preset?}` — `{preset: "shields"}` alone REWRITES the whole pool from `compile.HEALTH_PRESETS` (standard 45/70/0, shields 45/0/105, hardcore 45/0/0), same rule as `loadout_policy`'s own preset rewrite; `preset` outside those four names (plus `"custom"`) is a `400`. `preset` is otherwise IGNORED on the way in, EXCEPT an explicit `"custom"`, which is KEPT literally rather than re-derived (`presets.py`'s Silenced Sniper relies on this: its numbers happen to coincide with the Hardcore preset, and it means to read back `"custom"`, not `"hardcore"`) — every other value is RE-DERIVED from the three numbers on the way out (never trusted as a client claim), so a hand-edited number also reads back `"custom"` when it matches no preset. A `health` patch with no `max_shield` key at all (a saved game from before this field existed) loads as `"custom"`: its shield intent was never expressed, so it is never guessed at. **A18** `mode_params` is a partial merge onto the current values, stored complete; an unknown key or an out-of-range value is a `400` naming the mode's real parameters (a mode with none refuses any key). **A19** `vip_player_id` (a player_id or null): shape-checked here, roster-checked by `validate()` (`config_errors` names a VIP who is not playing); stripped from every saved game. **A20** `stun` (F15): `{duration_s?}` enables the host-driven EMP (the `<8,0>` cell becomes a fn-23 row — P18/F253: fn 24 was tried first and shipped a phantom hit every 5.07 s; fn 23 drops the victim's live accuracy to 0 and recovers on its own, with no pool moved — so a charge rifle on the roster stops dealing damage and becomes the stunner); `null` clears it; a non-object is a `400`; `duration_s` outside 1..60 and a game with nothing that can stun land in `config_errors` / `config_warnings` from `validate()`, not a 400. **2026-09-19** respawn profiles (`compile.respawn_settings`): `respawn.protect_s` (`0\|1\|2`, default `0`) and `respawn.weapon_delay_ms` (`500\|1000\|3000`, default `500`) apply to a TIMED respawn (`type` `"auto"`): the trigger holds for `weapon_delay_ms` after the spawn, and with protection on, no sooner than 500 ms after protection ends; `respawn.station_protect_s` (`0\|2\|3`, default `2`) applies to a STATION respawn (`type` `"scanner"`), where the trigger is live at once and a shield shows on the headset instead. **F325 (2026-09-24)** `respawn.gate` (`"trigger"\|"presence"`, scanner only, contracts §3 A13.1) is kept: absent = the node's default `trigger`, `null` clears it, anything else is a `400`. Each is a closed set of options — absent keeps the default, anything else is a `400` naming the legal values. **K8 (2026-09-24)** `volume` (an integer `60..100`, `types.GAME_VOLUME_MIN/MAX`, or `null`): the match head's `$VOL` for this game. Absent or `null` = the venue volume (80 indoors, 90 outdoors), exactly as before K8; `null` removes the key; anything else is a `400` naming the range. A saved game keeps it. `--bench-volume` still wins over it, and a try-out keeps 69. A10: `loadout_policy` is a partial merge — `{preset: "no_heavies"}` rewrites the rules, a rule edit (`{secondary: {choice: "off"}}`) flips `preset` to `custom`; every player's loadout is auto-fixed to the new ruleset (`assign` re-sent). A11: `presentation` is the same shape of partial merge — `{preset: "silenced"}` replaces the profile, an event/switch/headset edit flips `preset` to `custom`; `sound` ids must be on the gun (`sounds.on_gun_ids()`), colours 0-8 or palette names, `headset.death` "native" or a colour, **A22** `voice` one of `"on"\|"hits_only"\|"off"` — anything else is a 400 `errors[]`. F70: `station_source` says what is on the field emitting the objective and is a CLOSED vocabulary — `"grenade"` (a BRX Smart Grenade in hill mode; the proto-15 beacon, bench-proven), `"ir_station"` (a station / Utility Box speaking `$CAPTURE`; unproven on our bench) or `"phone"` (a spare phone in the utility role as a BLE control point, capture by presence, `spec/utility.md` §5d; added 2026-09-11, F103); `null` clears it and anything else is a 400. `koth`/`domination`/`ctf`/`cs`/`bomb` are REFUSED without one (the error names the valid values), and a grenade or phone source adds its own `SETUP: ` checklist warning (a phone point is reset by ARMING, never power-cycled). **A36 (2026-09-13):** a `teams` list with a duplicate `team_id` or a duplicate `tid` is a **400 naming the duplicate** -- two teams sharing a `$TID` are ONE side on the field however they are named (no hit can register between them: the shape `readiness.roster_faults` exists to catch), and two sharing a `team_id` make every player on either resolve to the FIRST, so half the roster is silently re-teamed on the console while the gun is armed from the other. | muster/build/kit/**lobby** (B3: the inline GameEditPanel edits the LOADED game on KIT and LOBBY and the lobby is RE-PUSHED, never left silently stale; this column read muster/build/kit while `set_config` had always accepted lobby, and `?mock` was tightened to the stale doc for a day) · **recap** (A43, 2026-09-16: ANY patch first rolls the finished session forward, roster and game kept; the old rule took a MODE pick only) |
| `POST /api/players` | `{display, team_id?, gun_id?, voice?, voice_slots?}` → `Player` (server assigns `player_num`). **F366:** `display` is trimmed and upper-cased, then refused `400` when longer than `MAX_TAG_LEN` (16), never cut; the console warns past `SOFT_TAG_LEN` (12) that the phone HUD may shorten it. A15 `voice_slots` = `{role: sound_id}` picks for the `$PSET` voice fields (`death_scream, respawn_cry, melee_grunt, short_pain, long_pain, pain_relief`) + `kill`; every id must be on the gun, `400` otherwise. The pickable lines per voice come from the gun stage (`voices.lines()`); `GET /api/voices` rows carry `speaker` + `lines`. A `gun_id` whose node is ALREADY connected is adopted on the spot; mid-match that node hot joins (`config` + the running `start`) unless it is already playing this config (it acked one, or reports itself `armed`/`live`), in which case it is simply bound and left alone — no `config`, because that head would un-spawn a gun in play (A30). **Never moves the phase** (2026-09-17: a claim used to auto-advance `muster`/`build` straight to `kit`, so a first gamertag on ARMORY jumped the console out from under the operator); the operator's own way to KIT is `POST /api/phase {phase:"kit"}` | ≤ lobby |
| `PATCH /api/players/{id}` | any of `{display, team_id, voice, voice_slots, loadout, player_num, gun_id}` → `Player` (F366: a `display` over 16 is refused `400`, as on POST; a stored longer tag from an older MC keeps working until renamed; A15 `voice_slots`: `{}`/`null` clears the picks; a change re-compiles and fires the A9.1 voice preview like a voice change); re-sends `assign` (and re-compiles/re-pushes `config` if already pushed). A10/A14 `loadout` = `{weapons: [{weapon_id}] \| [{primary}, {secondary}], perk?: perk_id\|null, overrides?: {max_hp?: 1..999, max_armor?: 0..999, easy_reload?: boolean}}` — the perk rides beside a secondary weapon; a pick outside the policy pool is `400 {error: <human reason>}` (e.g. "Heavies are off for this game"). S50: `easy_reload` is a per-player accessibility switch (ALT button = RELOAD), not a perk, so setting it beside a second weapon is `400 "Easy Reload takes the ALT button, so it can't ride with a second weapon"`. **A30 — THE KIT LOCKS AT START (2026-09-12):** in `armed`/`live`, `loadout`, `voice`, `voice_slots`, `player_num` and `gun_id` are refused `409 {error: "the match is LIVE: a player's kit is locked until it ends …"}` (a CONFLICT, not a bad request: the edit is fine, the moment is not — `state.ConflictError`) — every one of them would be COMPILED to the gun, and a `config` to a gun in play writes the A23/F121 DISARMED head with nothing to re-spawn it (`engine.js resumeSchedule()` returns early in `live`), so that player would register every hit, move no pool and be unable to fire for the rest of the match. `display` and `ready` are still accepted mid-match: they ride in `assign` (roster/display) and never reach the gun. A mid-match `team_id` change is refused `409` (`state.py`, B1), so KIT locks its team controls in ARMED and LIVE. The lock is per PLAYER, not per phase: a node that has NOT taken this match's config (no ack for it, not reporting armed/live) still receives `config` + the same `start` and HOT JOINS (contracts §5 `start`, node.md M-START E5) | ≤ lobby (kit fields); display/ready any |
| `DELETE /api/players/{id}` | → `{ok}` | ≤ lobby |
| `POST /api/players/{id}/standby` | → `Player` (parked). **STANDBY (2026-09-12, phone push added A38 2026-09-13):** the player leaves the roster but is not forgotten — the record (callsign, team, gun, loadout, voice, `player_num`) parks under the snapshot's `standby: Player[]` with `node_id: null`, `ready: false`. Their phone is unbound (readiness board, kit/lobby counts and the next push no longer wait on them) and, if it was still connected, gets one `assign{..., standby: true}` so its HUD drops to a SITTING OUT screen with no frames written, instead of keeping whatever it last held. **A40:** the bench fact is also on every later `assign` and on `welcome.node` (`standby: true|false`, never absent), so a phone that reconnects learns it from the welcome — without that, a player benched while their phone was away stayed locally benched after PLAY. A phone that reconnects while still parked is recognised by its gun and answered `standby: true` with no config, frames or start; and the `start` is ADDRESSED to the playing nodes, never broadcast to a benched one. 404 for an unknown id; 400 once the match is `armed`/`live` | ≤ lobby |
| `DELETE /api/players/{id}/standby` | → `Player` (reinstated). PLAY: back on the roster with the same `player_num` when it is still free (else the next free one), the same team when it still exists (else auto-balanced like a new player), the loadout re-fitted to the current policy, `ready: false`; a connected phone holding that gun is re-bound on the spot and gets a fresh `assign` (+ `config` if the lobby is already pushed). 404 for an id not on standby; 400 for `roster full`, for a gun that is **now assigned to someone else** (named), and once the match is `armed`/`live`. `DELETE /api/players/{id}` on a standby id drops the parked record. A parked player's gun is TAKEN: `POST /api/players` / `PATCH gun_id` naming it is `400 "gun X is on standby with NAME - PLAY puts them back"` (review 2026-09-12: the ARMORY claim form could create the collision PLAY then refused). The console hides STAND DOWN and PLAY in `armed`/`live` (the server refuses both) | ≤ lobby |
| `POST /api/players/{id}/tryout` | `{weapon_id}` → `{ok}` (pushes `tutorial`); `DELETE` same path ends it | kit |
| `GET /api/stations` | → `{stations: StationView[], game}` — A13.5 (F104, 2026-09-11): every utility phone that said hello this session (`node_type:"utility"`, never bound to a player, never pruned while assigned), each with the operator's `assigned` `{kind, team, id, threshold, at}` (or null), what it was last `armed` with (`{game, at, kind, team, id}`), `arm_pending` (assignment changed while it was out of Wi-Fi: "bring it back to re-arm"), its own heartbeat as `report` (`kind, team, station_id, threshold, live, revives, armed, battery`, and for a control point `control: {owner, progress, contested, hold_ms, capture_log, …}` — the self-authoritative recap, utility.md §5c), `app_ver` + `platform` (from the phone's hello, kept fresh by its heartbeat too — roadmap A3/A29), `online`, `last_seen_ms` (age) and `attention: string[]` (F221: each reads `WHAT IS WRONG: WHAT TO DO`: `NOT RE-ARMED, OUT OF WI-FI RANGE: BRING IT BACK TO RE-ARM` · `ARMED FOR AN OLDER GAME: RE-ARM IT FROM ITEMS ON ARMORY` · `PHONE SAYS NOT ARMED: …` · `PHONE ADVERTISES ID x, ASSIGNED y: …` · `BATTERY LOW: CHARGE OR SWAP IT BEFORE THE WHISTLE` (under 30 %) · A58: `STATION #N RESTARTED [k TIMES]: CHECK THE STATION` · `STATION #N OFFLINE: CHECK IT IS ON AND IN RANGE` · `STATION #N LOCK EXPIRES MID-MATCH: TAKE IT BACK THROUGH MUSTER`. A67: `RANGE\|STRENGTH EDITED ON STATION <from> → <to> [(LOCKED)]`, a NEUTRAL info line (no action), shown until the START after its match). A58: `report` also carries `uptime_s`, `boot_count` and `assoc` (muster|held) when the station sends them; `lock_until_ms` (MC clock) while the last lock sent is running, and `restarts` (reboots inside this game's lock window). A56: while a match is `armed`/`live` with `--powerups`, a station with an item also carries `item_available` (the item is there), `next_spawn_at_ms` (MC-clock ms of the next spawn instant, always) and `taken_by` (the `player_num` that took this spawn's item, cleared at the next spawn); all are absent otherwise. The schedule runs on MC's own tick from `go_live_t`: first at `first_at_s`, then every `spawn_every_s`; an untaken item stays and never stacks; a player's `pickup` fact (stored, never scored) empties it until the next spawn time. MC pushes `station_update {id, available, next_spawn_in_ms}` at arm time, at every spawn time, when the item is taken or reset, and on the station's reconnect; `next_spawn_in_ms` is ALWAYS the time remaining to the next spawn instant, even while the item is there, so the station counts down and spawns on its own. The station reports `station_action {id, action: "reset"|"taken", player_num?, t}` (live only, no seq): `reset` makes the item available now without moving the fixed spawn times (feed: `OPERATOR RESET · STATION #<id>`); `taken` records the winner the station picked. A `taken` and the player's `pickup` fact are deduped by station and spawn: the first marks the item taken and writes `<display> TOOK <ITEM> · STATION #<id>`, the second is a no-op; a fact older than the item's spawn or reset is ignored. The same list rides on every snapshot as `stations`, with the current game byte as `game_byte` (and as `game_no`, its old name) | any |
| `PUT /api/stations/{node_id}` | `{kind, team, id?, threshold?, tx_power?}` → `StationView`. A66 (F364): omit `id` and MC assigns it (the id this node_id already holds or was handed this session, else the lowest free one; shared by phones and Sticks, kept across a station restart, a relink and an MC restart). The console never sends one; an explicit `id` from an older client is still validated. `kind` ∈ respawn · powerup · extraction · bomb · control; `team` = a `team_id`, a `$TID` 0-3, or `"any"` (255 — required for `control`, which starts NEUTRAL and is taken by presence); an explicit `id` 1..65535, unique on the field; `threshold` dBm −100..−30, or 0 (the default) for the station's own platform default, which it advertises (F345: a respawn station is about 3 m, a phone −70, a StickS3 −57). A phone app older than 0.4.12, or of unknown version, clamped 0 to −30, so MC sends it the explicit value instead (−70 respawn, −74 other kinds; `state.py _wire_threshold`). Pushes `station_config` `{kind, team, id, threshold, game, valid_ids}` to that phone at once and re-arms every other assigned station (the allow-list they echo changed); an offline phone is flagged and armed on its next hello. 400 in the operator's voice, including (polish 2026-09-11): a `team` that is not ANY and not a `$TID` some team in this game is on (such a station serves nobody), and any PUT while the match is `armed` or `live` (players already hold `config.stations`; re-pushing it would re-arm every live gun — RECALL or END first). A PUT in `recap` is accepted and arms against the finished match's game byte; the next lobby push re-arms every station with the new one **A67 (F365):** `tx_power` ∈ `ultra_low` · `low` · `medium` · `high` (absent = keep MC's; a stronger advert is heard farther, so it moves the range too). A value that differs from the assignment is the operator's edit (source `mc`, set now) and goes out with `threshold_age_ms`/`tx_power_age_ms`; an on-station edit that is newer is adopted from the station's heartbeat instead. A PUT that changes ONLY threshold and/or `tx_power` of an assigned station re-arms that station alone and is allowed in every phase, ARMED and LIVE included. `StationView.range` = the applied values, their source and `*_edit_age_ms` (source station only); `StationView.range_edits` = the on-station edits heard (seq, field, from, to, locked, age_ms). After a Stick reboot its edit age is LARGE, so MC's value wins. | any but armed/live (a range-only change: any) |
| `DELETE /api/stations/{node_id}` | → `{ok}`; drops the assignment (the survivors' `valid_ids` shrink, and players in LOBBY are re-pushed the shorter `config.stations`). 404 for an unknown station; 400 while `armed`/`live`, as for PUT. `DELETE /api/nodes/{node_id}` on an ASSIGNED station does the same shrink | any but armed/live |
| `GET /api/powerups` | → `PowerupsView {enabled, presets: [{preset, item}]}` — A56 (S58, docs/spec/powerups.md). `enabled` is MC's `--powerups` flag (default OFF until bench steps 3.4, 3.5 and 4.11 pass and Tony decides; the console hides the item picker when false). `presets` are `rockets` (rocket_launcher), `rail_gun` and `overshield`, each `item` a full `StationItem` expanded from `powerups.py`'s named constants: a weapon item's `charges` is that weapon's compiled magazine; heavies spawn every 120 s, first at 120 s; the Overshield grants `amount` 75, every 60 s, first at 60 s. The rules the phone enforces on its own are constants, not item fields: `LOST_AT_DEATH`, `WEAPON_PICKUP_SWAPS` (a second weapon pickup replaces the first; an overshield stacks alongside), `OVERSHIELD_DECAY_PER_S` 0, `OVERSHIELD_REGEN` false | any |
| `PUT /api/stations/{node_id}` with `item_preset` | A56: `{kind: "powerup", team, id?, threshold?, item_preset}` stores the EXPANDED `item` on the assignment (`StationView.assigned.item`) and sends it in `station_config` (`item`) and in every player's `config.stations[]` entry. 400 when the flag is off (names `--powerups`), when `kind` is not `powerup`, for an unknown preset, for a raw `item` (send `item_preset`), for a third different weapon item, and (as for any PUT) while `armed`/`live`. A PUT without `item_preset` clears the item. With the flag on, `config.powerups = [{weapon_id, slot}]` names each distinct pickup weapon (by station id: slot 2, then 3), which every gun is compiled with, EMPTY and out of the ALT cycle (powerups.md). A change that moves those slots after the lobby push is a fresh head for the whole roster (new `config_id`), not only a config re-push. Flag off: a stored item (from a restored session) is inert: no slot, no `item`, no schedule | any but armed/live |
| `POST /api/stations/{node_id}/reset` | → `{ok}`; A56: the console's operator reset of a powerup item, the same effect as the station's own `station_action reset`. 404 for an unknown station; 400 when `--powerups` is off, outside `armed`/`live`, or for a station with no item in this match | armed/live |
| `POST /api/stations/unlock` | → `{ok, armed, pending: node_id[]}`; A58: `lock_s: 0` to every assigned station now (a muster station out of Wi-Fi hears it on its next hello). The next LOAD push or START locks them again; the unlock survives an MC restart (F337) | any |
| `POST /api/stations/arm` | → `{ok, armed, pending: node_id[]}`; re-arm every assigned station now (the LOBBY push does this automatically) | any |
| `POST /api/stations/{node_id}/release` | → `{ok}`; A41/F184: the cure for a phone stuck in utility mode. Pushes `control{cmd:"release_utility"}` to that ONE utility node; `utility.js` takes it the way its own BACK TO HUD button does (`brx.role` → `'hud'`, reload). `ok` is whether a socket took the push, not whether the phone reloaded. A failed send changes nothing; an accepted send clears assignment/armed state, re-arms surviving stations, and re-pushes the smaller HUD allow-list only in LOBBY (never a live gun), but retains the ITEMS row pending proof. The first HUD hello carries the distinct old `brxu` id plus its takeover key; after NetServer validates and consumes it, the old card disappears. A mid-match departure retains its last station report for recap. An older HUD cannot send the proof, so its harmless unassigned card remains until stale pruning, node eviction, or an update followed by a fresh utility→HUD round trip. **Not phase-gated**: releases in `armed`/`live` too. 404 for a node that never said hello as a utility phone | any |
| `GET /api/options` | → `{log_sync: "auto"|"manual"}` — A25 session options. Also on every snapshot as `State.options` | any |
| `PUT /api/options` | `{log_sync}` (partial: only the keys you send are set) → the full options object. An unknown key or an out-of-table value is 400 and nothing is changed — an option the operator set and MC silently ignored is worse than a refusal | any |
| `POST /api/nodes/{node_id}/pull_log` | → `{ok: boolean, node_id, log: NodeView["log"]}` — A25, the operator's **LOGS** button. Pushes `pull_log {reason:"manual"}` to that node. **Never gated by `log_sync`**: "manual" means the button is the only asker, not that the button stops working. `ok:false` (still 200) when the node is a utility phone (F106(d): a station never binds a match) or past the ~1 MB per-node budget (which is per MATCH — it resets at the next start, or a session of four games would silently stop asking); 404 for an unknown node. The NODE decides when to answer (never while ARMED/LIVE or with unacked facts) — watch `NodeView.log` | any |
| `POST /api/tunnel` | `{on: boolean}` → `lan.public` (A28.1). `on:true` spawns `cloudflared tunnel --url http://127.0.0.1:<ws-port> --no-autoupdate` as a child of MC, answers at once with `status:"starting"`, and the snapshot flips to `up` with `ws_url` when the `trycloudflare.com` line is read (20 s cap → `error`); `on:false` kills it (`off`). Any status change re-renders `lan.qr`; a change of the usable public URL (new hostname, or gone) pushes MC→node `join {pub, secret}` to every connected node. `409 {error}` when `available:false` (binary not on PATH; the error names the install line) or when `provider:"manual"` (`--public-url` is not MC's to stop). Idempotent: `on:true` while `up`/`starting` is a no-op 200 | any |
| `DELETE /api/nodes/{node_id}` | → `{ok}`; operator kick: closes the node's socket (4000), unbinds its player, clears its ready/ack, rotates its key and marks it stale so the next hello for that gun (the real phone) re-hydrates. Use when a stranger squatted a live gun name before its owner's phone connected. 404 for an unknown node | any |
| `POST /api/players/{id}/ready` | `{ready}` host override → `Player` | lobby |
| `POST /api/lobby/ready_all` | `{}` → `{ok, readied: player_id[]}` — bench 2026-09-17: the roster-wide sibling of the route above, for the operator's MARK ALL READY control. Marks every rostered, non-standby player ready with the same `set_ready(..., host_override=True)` cure, one call instead of one HOST OVERRIDE tap per player; each newly-readied player gets a fresh `assign` (no config leg) so the phone's own READY state follows, the same wire field `PATCH .../ready` already documents. Never touches `self.acks` or re-compiles — arming still checks the gun config proofs exactly as before. `400` outside `lobby` | lobby |
| `POST /api/games/load` | `{}` → `{ok, config_id, sent, total}` — **LOAD (2026-09-13): announce the GAME to the phones, and write no gun.** Pushes `assign` (the same body a hello or a roster change sends: `game_brief()` — mode, teams, win, respawn, health, venue, night, the loadout rules — plus the kit-open policy) to every BOUND player node. It compiles nothing, sends no `frames`, and **leaves `lobby_pushed` FALSE**, so every guarantee hanging off the push is untouched and unsatisfied by it: `POST /api/start` still answers `push config first`. It is `assign` and NOT `config` because `envelope.REQUIRED["config"]` makes `frames` mandatory — a frameless `config` is dropped by the node's own validator, so "a config with no frames" is not expressible on this wire. Why it exists: Tony, 2026-09-13, *"weapons have to go with the arm"* — the config push compiles a weapon head per player, and before anybody has kitted that head carries policy DEFAULTS, so pushing at LOAD wrote default loadouts to every gun and re-pushed on every kit pick. `sent` is **DELIVERY** (a socket accepted the frame), never receipt and never a gun fact — a phone reports no `config_id` until a FRAMES push has given it one. A config edit while loaded RE-ANNOUNCES (`set_config`); `_finish()` and `new_session()` clear it (RECALL deliberately does not). Snapshot: `game {loaded, config_id?, sent, total}` — `config_id` is the **ANNOUNCED** game (`state.py game_cfg`), NOT the current draft and NOT the head the guns hold. A re-push mints a fresh head id while announcing nothing new (F6), so keying this to the head would blank the whole phone column on every re-team. The key is **ABSENT** when nothing has been announced — the contract is `config_id?: string`, so "no announcement" is the absence, never a null. `400` in `armed`/`live` | ≤ lobby |
| `POST /api/lobby/push` | `{force?: bool}` → `{ok, acks, repushed, config_id}`; compiles every bundle, pushes `config`. **R2-1: `repushed: true` when the lobby was ALREADY pushed** — the call is then a RE-PUSH and runs the same body a roster/config edit does (`_repush_lobby_config`): NO new game number, every ack dropped and re-collected, and the ack, echo and pool judgements made against the old head cleared. The console labels its button from it. **F6: a re-push MINTS A FRESH `config_id`** (returned as `config_id`), exactly as an edit does. Keeping the id made the re-push unprovable — an ack already on the wire when `acks` was cleared landed afterwards carrying the same id and was recorded as current, so the board read ACKED for a head that gun never took. **F3: a `waiting` row (a phone that has not arrived) refuses the FIRST push only** — a re-push compiles for the whole roster and `_hydrate` hands the bundle over on that phone's hello, so it is delivered; every other red still refuses both.  A15.1: each push ROLLS every `$PSET` voice field the player did not pick in `voice_slots` (death scream, short pain, respawn cry) from the character's pool -- the draw is in `frames.voice.rolled`, the pools in `frames.voice.pools`; `frames.cue_pools[event]` lists every frame a `voice:<role>` event may play and the node picks one at random per event (`frames.cues[event]` = the first). A15.2: the `$PSET` respawn-cry field is EMPTY and the node says the spawn line itself -- `frames.cues.spawn` / one of `frames.cue_pools.spawn` (ids in `frames.voice.spawn`) written right after the spawn and revive frames. A15.3: `frames.pset_pool` = one `$PSET` per death-scream take, the node writes one at random before every `$SPAWN` (the scream stays the firmware's, re-rolled per life); the three `$PSET` pain fields are EMPTY and the node plays `frames.cues.pain_short` / `pain_long` / `pain_melee` (pools in `frames.cue_pools`) on each `$HIR` by damage (`frames.voice.pain_long_min`) or the melee word. Refuses if readiness blocks the push — **the error names what blocks: the phones that have not arrived AND the reds, never an empty list** (R2-10) — unless `force`. **A23 (F121) SPAWN PROTECTION:** `frames.head` carries the `$SIR` table with every function replaced by fn 28 — the same cells, registering a `$HIR` with no sound, no headset flash, no vibration and no pool movement — and since the **F121 rebuild** (bench 2026-09-18) `frames.spawn`, `frames.revive` and every `team_flip` list write `$SPAWN,,*`, then `$TMP,,,,,,,,-100,,,,*` (t8: hits register with 0 damage), then `$TID`, and carry no `$SIR` row: the table survives `$SPAWN` and death. The node writes `frames.spawn_protect_off` (`$TMP,,,,,,,,0,,,,*`) once the gun can fire (its first `$ALCD` decrement after the `$AMMO` echo) or 2100 ms after the write, whichever comes first. `frames.sir_pool` is the only carrier of the REAL table: one take rides in front of the off frame when the gun's table may not be the live one (after a head) or class sounds are on. A gun therefore cannot be hurt between the lobby push and the moment it can shoot back. An older app never writes the off frame, so the app compatibility tier moved with it (0.4). **An empty roster is refused even with `force`.** **Refused with `400` in `armed` and `live`, and `force` does NOT open that door** (`_refuse_push_in_play`): the node writes `frames.head` on every `config` and clears `spawned`, and since A23/F121 that head is the DISARMED fn-28 `$SIR` table — so a push to a gun in play leaves a player who registers every hit and loses no health until their next life. RECALL or END first. `force` overrides a readiness judgement, never this. `POST /api/start` takes the same `force`: a forced push does not clear a red (it usually adds `GUN DID NOT ANSWER CONFIG`), so an override that stopped at push left ARM unreachable | lobby |
| `POST /api/start` | `{runway_s?}` → `{match_id, go_live_t, seq}`. **THE ARM VALIDATION (2026-09-13):** beside the one-team refusal, the stale ack (force-proof) and the echo mismatch (forceable), `start()` now refuses a rostered player whose gun **has not taken this config at all** — `all_acked()` asks its question only of players WITH A NODE BOUND, so a player whose phone never arrived was skipped ENTIRELY and the whistle blew on a vacuously-true predicate. ABSENCE and STALENESS are different failures with different fixes, so the refusal names them apart: *"N gun(s) have not acked this config"* (bound and silent → RE-PUSH) versus *"N player(s) have no phone bound"* (nobody there → bind it, or STAND DOWN). FORCEABLE, because a late phone genuinely HOT JOINS on its bind — what must not happen is starting without being told, so it names every player it is about. LOAD is what makes this reachable in a new way: a phone can now hold the game while its gun has no head | lobby (all acked) |
| `POST /api/start/reschedule` | `{runway_s}` → same | armed |
| `POST /api/start/abort` | `{}` → `{ok, reached: string[], unreachable: string[]}` | armed |
| `POST /api/control` | `{cmd: "end"\|"recall"\|"panic"}` → `{ok, ended, reached, pushed, nodes, phase, error?}`; `panic` requires `{confirm: true}`. **F125 (2026-09-11): `reached` counts nodes whose match ACTUALLY ENDED, never a push alone** — it was counted before the branch that ends anything, so an END that ended nothing still returned `{ok: true, reached: 2, nodes: 2}` while the node ran on to its own time limit. `ended` says whether this control actually stopped the match (always true for `recall`/`panic`, which stop a live game → KITTED per A5.9); `pushed` is how many nodes took the `control` frame (it can exceed `reached` only in the no-scorer case); `phase` is where MC is now. An `end` with **no scorer** is `{ok: false, ended: false, reached: 0, error}`: the nodes are still told to stop, MC changes no phase, and the `error` names RECALL as the way back to KIT. A **second `end` in `recap`** is the same shape (`{ok: false, ended: false, reached: 0, error}`): the press is still forwarded to the nodes, but the recap stands and is NOT re-written and the victory cue is NOT pushed again. `recall` and `panic` are unaffected in every phase. Render `reached`/`nodes` as the count and show `error` when present. **A34 (2026-09-12):** the operator no longer has to press RECALL for a phone that came back still LIVE in a match MC already retired -- MC ends it from that phone's own `status` heartbeat (`control{end, match_id}` + that match's `result` + the current `start` if one is scheduled) and posts a `RECONCILED` alert to the feed, once per `STALE_LIVE_RETELL_MS` per phone and match | armed/live |
| `POST /api/players/{pid}/operator` | `{cmd: "resync"\|"respawn"\|"relink", match_id}` → `OperatorActionResult {ok, cmd, player_id, match_id, pushed}`. A47 (bench 2026-09-17): the LIVE board's operator menu. Pushes `control{cmd, player_id, match_id}` to that player's bound phone only (contracts §5 `control` for what the phone does) and writes `SENT RESYNC TO <NAME>` (tag `OPERATOR`) to the feed. The phone answers with the persisted event `operator_result{cmd, ok, why?}`; MC never scores it, and writes `RESYNC DONE: <NAME>` / `RESPAWNED <NAME> (OPERATOR)` / `RELINK DONE: <NAME>`, or `RESYNC REFUSED BY <NAME>: <WHY>`, and sets `LiveRow.operator`. **F287:** a resync result is intentionally delayed while the phone sends `$LIFE,0,0,0,*` and waits up to 1500 ms for its `$HP`; `ok:true` means a positive-health reply released the re-arm burst, while dead/no-answer/state-change replies are `ok:false` and write no burst. **409** outside `armed`/`live`, for `resync`/`respawn` outside `live` (the phone refuses them before T-0), for a `match_id` that is not the current match (a stale board), for a phone that is unbound or has not heartbeated within `STALE_AFTER_MS`, for `respawn` of a down player when `config.respawn.type` is `none`, for the same `cmd` to the same player within 2 s, and for a push no socket took. **400** for an unknown `cmd` or player. Never a config or head push. `pushed` means a socket took it: no ack kind exists for `control`, so the phone's log is the receipt | armed/live |
| `GET /api/recap` | → `RecapView` includes `played_s`, seconds from go-live to the match end, plus `{settling: bool, awaiting: player_id[], since_end_ms}` — bound nodes not heard from since the whistle. **Advisory only: it gates nothing.** `provisional` cannot cover this, because a player is marked flushed on their first event | live/recap |
| `GET /api/matches` | → `[{match_id, mode, go_live_t, ended_t, recap}]`, newest first; finished matches in this session (the RECAP history picker). Read-only, no token. Empty list on any store error | any |
| `GET /api/diag/matches` | `?match=<id>?` → `DiagReport[]` (oldest first; `mcp/brx_mcp/mc/diag.py`, README → *Post-match diagnostic*) — go_live/ended/duration, mode/config_id/environment/cfg health, shots/hits/hit%/deaths, per-node `{player_id, player_ids, attributions, shots, arm_state_counts, alive_counts, gun_linked_counts, max_shots, max_hp, max_armor, first_live_pool, cfg_health, pushed_pool, hp_mismatch_vs_cfg, armor_mismatch_vs_cfg, hp_mismatch_vs_pushed, armor_mismatch_vs_pushed, ack_config_id, ack_matches_config}`, `shooter_team_values`. **F175:** `player_id` is null when the node named multiple players (or any heartbeat named none); `player_ids` preserves the explicit ids in arrival order, and each `attributions` row carries the status-derived fields for exactly one explicit player or the null/unknown bucket. Its `shots` is the reset-aware share of the node's cumulative counter; the node and match `shots` are the corresponding totals. T1-B: the same report the CLI (`python -m brx_mcp.mc.diag <session.sqlite>`) prints for any session file, including ones this server never held. `[]` on any store error. **A37/F-5:** read-only but **operator-token gated** (`_AuthMiddleware._TOKEN_GETS`) — it serves the session's raw telemetry and a full-session sqlite scan builds it, so it is not spectator data and runs in a worker thread, never on the event loop. LIVE always answers 409. **F174:** during ARMED, a narrow `?match=<previous-id>` read is allowed; omitting `match`, naming the current match, or lacking a current match id answers 409 | not live; armed only for a named previous match |
| `POST /api/report` | → `{file, download, issue_url, summary, removed, too_large}`. Builds a scrubbed bug-report zip for THIS session (`mcp/brx_mcp/mc/report.py`, README → *Reporting a bug*): `session.sqlite`, `mc.log`, `manifest.json`, `diag.json`, `environment.json`, `README.txt`, with player names, sticker ids, PINs, BLE addresses, IPs, the tunnel host, the home folder, the user name and every token replaced. The server adds its roster, armory, operator token and join secret to the known values. It reads a COPY of the store through the sqlite backup API in a worker thread, so it never shares or blocks the live connection. If a raw value survives the scrub, `500 {error}` and nothing is written. `download` is `/api/report/<file>`; `issue_url` opens the GitHub bug form with the environment filled in; `too_large` is true over GitHub's 25 MB attachment limit. `409` when this MC has no store. Operator-token gated (a POST) | any |
| `GET /api/report/{file}` | → the zip (`application/zip`, `Content-Disposition: attachment`). Serves only a file name this server built with `POST /api/report`; anything else, including a traversal attempt, is `404`. **Operator-token gated** (`_TOKEN_GET_PREFIXES`), by the `Authorization: Bearer` header ONLY (`_HEADER_ONLY_PREFIXES`; `?tok=` is refused here, so the token never lands in a URL). The UI fetches `download` with the header and saves the response as a blob | any |
| `GET /api/recap.csv` | → text/csv (full stats table + medals) — the **LIVE** scorer only. Columns: `operator,team,kills,deaths,assists,kd,accuracy,streak,best_streak,shots,hits,medals` (`best_streak` added 2026-09-11, F116; an archived recap stored before that exports `0` for it) | recap |
| `GET /api/matches/{id}.csv` | → text/csv for one **finished** match from the session store, same columns and same writer as `/api/recap.csv` (`scoring.rows_csv`, so the two cannot drift). `404` unknown id; a match that scored nobody is a header-only file, not a 404. Read-only, no token | any |
| `POST /api/phase` | `{phase: "muster"|"build"|"kit"|"lobby", force?: boolean}` → `State`; host navigation between the setup phases (`armed`/`live`/`recap` are driven by start/end and are rejected here, 400). **The SOURCE phase is guarded too: any move while the session is `armed` or `live` is 409** — `{phase:"kit"}` from LIVE used to succeed and left `tick()` with no phase to end, so the match ran on with no whistle coming. End it with `control{end}` first; `force` does not apply. **A27 (F127): CONTINUE out of `kit` is guarded.** `kit` → `lobby` while any rostered player has not pressed READY is **409** `{error, not_ready: string[] /* displays */, greens /* how many ARE ready */, roster_size}` and the phase does not move; `force: true` does it anyway (the UI's second tap, which names who is not ready — `CONTINUE · greens / roster_size READY`). Everything the player carries is compiled at the lobby push, so advancing early takes a half-made kit into the match; the NODE says the same thing in its own words (`moment {kind:"kit_locked_by_host"}`, loadout.md §4.4). Those two are the only guards: between the setup phases nothing else is refused | ≤ lobby |
| `POST /api/session/new` | `{keep_roster?: boolean}` → `State` (back to muster). **A43:** from `recap` with `keep_roster` (NEW SESSION) the finished match keeps its late facts and its A42 end watch; `keep_roster: false` (NEW SESSION, CLEAR ROSTER) drops both | recap |
| `POST /api/match/orphan/resume` | `{match_id}` → `State` — **bench 2026-09-17, RESUME MATCH.** Adopts the match `orphan_match` names: MC goes ARMED/LIVE on it with the current config, the go-live time from the phones' countdown, else the earliest stored fact, else now, and scores the stored facts plus everything after. X2: MC also takes the advert `game` byte most of those phones report (`game_byte` on their heartbeat), so a later station re-arm keeps their byte; with no reported byte (an older phone) the game number stays as it was. Pushes nothing (no config, frames or `start`). `409` when no phone reports it any more, or MC is armed/live/recap | muster, build, kit, lobby |
| `POST /api/match/orphan/end` | `{match_id}` → `State` — **bench 2026-09-17, END THEIR MATCH.** `control{end, match_id}` to the bound phones reporting that match only, and the match joins the A34 ledger so a phone that missed it is told again on its next heartbeat. `409` when no phone reports it any more | any |
| `POST /api/match/next` | `{}` → `State` — **A43 (2026-09-16), RECAP's NEXT MATCH.** Rolls the finished session forward (roster kept, config kept: same mode and settings) and then LOADs that game, so the State comes back in `build` with `game.loaded: true`. Outside `recap` it is a LOAD. `409` in `armed`/`live` | recap |

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
- **A36/F271 — four checks that the guns are running the config MC pushed.** Field night
  2026-09-12: guns ran a PREVIOUS push in nearly every match and nothing on screen said so. Each of
  these is compared against the head MC actually pushed that player, so there is no second
  arithmetic to drift, and each is SILENT when it has no evidence (an older app, a stub compiler)
  rather than red:
  - `ACKED AN OLDER CONFIG (<id>): RE-PUSH` (a blocker, AMBER on the console). The ack named a previous `config_id`. It also
    makes `lobby.all_acked` false and `POST /api/start` refuse — **`force` does NOT open this one**:
    `force` overrides a readiness judgement the operator can see and accept, and this is the gun
    saying which game it is running. RE-PUSH, or move the player to STANDBY.
  - `GUN ECHO ≠ CONFIG (WEAPON m/r ECHOED, m/r EXPECTED, MAG/RESERVE): RE-PUSH` (red). The slot-0 `$ALCD` the gun answered
    the head with does not carry the magazine the head's `$WEAP,0` wrote. Only ever asked of a
    CURRENT ack (A37): an ack that answered a previous head carries a previous head's magazine, and
    saying so twice describes one cause twice. No claim when the echo is not an `$ALCD` (`$START`
    answers `$LCD,0,0,0,0,0,0,*`, which proves only that the gun answered). **R2-5: `POST /api/start`
    refuses this one too, but `force` opens it** (`_refuse_echo_mismatch`) — a mismatch leaves the ack
    CURRENT, so `all_acked` was true and the whistle blew on a gun that had just named another
    loadout. `not_echoed` never refuses: it is the ordinary v4.32 answer, and an absent proof is not
    a fault.
  - `GUN CONFIG ≠ PUSHED HEAD (<FIELD> … READ BACK, … PUSHED): RE-PUSH` (red, F271). The optional
    `$QUERY` read-back's player id, team or HP/armour/shield maximum differs from the effective
    `$PSET`/`$TID` in the head MC actually sent. `POST /api/start` refuses this direct gun fact even
    with `force`. A node that omits `gun_config`, or a gun that does not return a well-formed body,
    makes no claim and remains compatible.
  - `GUN POOL ≠ CONFIG (REPORTS h/a, THIS CONFIG GRANTS h/a, HP/ARMOR, LIKELY AN OLDER HEAD): RE-PUSH
    BEFORE THE NEXT GAME` (red) + a `CONFIG` feed alert. The first `status` at least
    `POOL_CHECK_SETTLE_MS` (2 s) into a life reported MORE **hp** than the `$PSET` MC pushed.
    **Excess only (A37):** a pool at or below the compiled one is damage — the engine emits
    `hit_taken` only for a hit it could attribute, while the pool moves on every `$LCD`/`$HP`, so
    "equal unless a hit says otherwise" flagged guns running the right head and could not be cleared
    mid-match. **Gun-sourced only (A37/R2-3):** judged only on a heartbeat whose `pool_src` is
    `"gun"`. `engine.js` fills hp/armor from `config.health` at spawn and the gun's own numbers
    arrive on the first `$LCD`/`$HP`, while `$PSET` bakes `loadout.overrides.max_hp/max_armor` and
    the body_armor perk — so a player overridden DOWN reported the model's bigger number until the
    gun spoke. A model-sourced frame makes no claim and the life stays open for a gun-sourced one; an
    app that omits the field makes no claim either. Judged once per life; cleared by the next push
    (which this row does not block — see the PUSH gate below). The tail says BEFORE THE NEXT GAME
    (R2-7) because this row can only be read in play, where a push is refused.
  - `GUN ARMOR ABOVE CONFIG (REPORTS h/a, THIS CONFIG GRANTS h/a, HP/ARMOR): RE-PUSH BEFORE THE NEXT
    GAME` (**amber**, R2-6). Armour above the compiled ceiling is a MECHANISM, not proof:
    `compile._SIR_GRANT` (fn 9-22) and the node's `armour_up` add armour mid-life, and the replayed
    field store shows a body-armor node's first life going 70 → 120 at +2.0 s as the baked perk
    arrives. Whether the gun CLAMPS such a grant at the `$PSET` ceiling is unbenched.
  - `GUN POOL BELOW CONFIG (REPORTS h/a, THIS CONFIG GRANTS h/a, HP/ARMOR): RE-PUSH BEFORE THE NEXT
    GAME` (**amber**, R2-4). Excess-only is blind to the SMALLER stale head, and that is a real shape
    (match 1 grants 45/0, match 2 grants 100/70, and a gun on match 1's head reports 45 ≤ 100
    forever). Raised only on the first gun-sourced settled frame of the FIRST life of a match with no
    `hit_taken` that life; a later life or any hit has an ordinary explanation and makes no claim.
    Both ambers gate nothing (A1) and clear on a frame that reports exactly the compiled pool.
  - `HOLDING OLDER CONFIG (<id>)` (an amber, NEUTRAL status on the console). `status.config_id` — the head the
    phone says it is holding right now — is not the current one and the node has not re-acked. Amber,
    not red: the ack is the authority and this is a ~2 s sample that can be one beat behind a push.
- **RECAP → NEXT MATCH is a deterministic reset (A36).** The roll (`POST /api/match/next`, `POST /api/session/new`,
  or since A43 any config edit, LOAD, push or phase move in `recap`) clears the acks, the
  bundles, the pinned hit-audio plan, the pool bookkeeping and every node's held `config_id`,
  and leaves `lobby.pushed` false — so `POST /api/start` answers *"push
  config first"* until a FULL fresh head has gone to every gun. There is no incremental path back in:
  the per-player `config` leg of a roster edit is gated on the same `lobby_pushed` flag. What it does
  NOT clear is the retired-match ledger A34 reconciles against: a phone still out on the field
  holding the old match is exactly what a new session is most likely to meet. **A43:** a roll that keeps the
  roster also keeps the A42 end watch (it ends at the next START) and the finished scorer: a late fact naming
  that match re-takes ITS recap, archive row and A34 ledger entry, and never touches the new match.
- **`readiness.roster_faults`** (round-2 fix pass, 2026-09-12; the predicate
  corrected 2026-09-13) is a separate, top-level list about the ROSTER AS A WHOLE rather than any one
  gun — today exactly one entry, *"ONLY ONE SIDE HAS PLAYERS"*, raised whenever a config declaring two
  or more teams has two or more players and fewer than **two populated `$TID`s**. Stated on the tids,
  not the team ids: two config teams sharing a tid are ONE side however they are named, and a third,
  EMPTY team is not a fault (a 2/2/0 plays). `ffa` and `lms` declare a single team and fall out of the
  rule; so does a solo roster. A non-empty list forces `go: false`, and `POST /api/lobby/push` and
  `POST /api/start` both refuse with that sentence — **`force` does NOT open it**, for
  `_refuse_push_in_play`'s reason: a one-side match cannot register a hit at all, so no amount of
  operator intent makes it playable. A mode pick no longer creates one: `set_config` re-teams by team
  INDEX and rebalances if a side would be left empty (`_reteam_for_config`).
- **`readiness.unrostered_phones`** (A39, 2026-09-13) is a COUNT, not a fault: connected companion
  phones that have a gun set, that nobody on the roster claims, and that are not the gun of a player
  parked on STANDBY either (`state.py unrostered_phone_count()`, the same `_find_player_for_gun`
  matcher ARMORY's claim card uses, asked a second time against `self.standby`). A phone with no gun
  yet does not count, and **(A40) neither does one that has gone SILENT** — the count skips a node the
  net layer has flagged `stale` (STALE_AFTER_MS), because a phone that said hello wearing a gun and
  then left the field kept the banner up for the ten minutes until the record was pruned, with nothing
  claimable on ARMORY behind it. It never blocks `go` and neither push nor start reads it; KIT and LOBBY render
  it as *"N CONNECTED PHONES NOT IN THE ROSTER"* linking to ARMORY, which is where the claim is made.
- **Kit → lobby:** `POST /api/players` assigns `player_num` in roster order (1–63); any player change re-sends `assign`
  (re-compiles + re-pushes `config` once pushed); a phone `loadout_request` goes through the same policy
  (`policy.py`) and is answered `loadout_ack {ok: false, reason: "THE MATCH HAS STARTED — YOUR KIT IS LOCKED UNTIL
  THE NEXT ONE", loadout}` in `armed`/`live`, with nothing stored and no `config` sent (same rule as the PATCH row
  above); `tryout` pushes `tutorial`, is ended by the player's `ready`, a policy reset or END TRY-OUT, and
  refuses once the lobby is pushed. Kit → lobby auto-advances only when every rostered player is ready.
- **LOAD and push are separate (2026-09-13):** `POST /api/games/load` tells the PHONES which game is loaded and
  writes no gun; `POST /api/lobby/push` is what configures guns, after kitting. Because that splits one event
  into two, the snapshot carries **`sync`** — the pre-arm check (`sync_summary()`): per rostered player
  `{bound, phone_game, gun_sent, gun_acked, gun_echo, ack_state}` plus `totals` and `unconfigured[]`. **A43:**
  `gun_sent`/`gun_acked` are false unless THIS lobby is pushed (a finished match left PUSHED ticks behind), and
  `ack_state` is `acked | waiting | failed | none` for the console: `waiting` is a push still in flight and is
  never a fault; `failed` is a refused ack, an unbound or quiet phone, or no answer in `SYNC_ACK_TIMEOUT_MS` (10 s). Every total is stated
  against `rostered`, and **`in_sync` is false for an empty roster**: a zero-of-zero must never read as ready
  (the `ALL GUNS ON THIS CONFIG (0/8)` defect — `all_acked()` is vacuously true with no node bound). `gun_echo`
  is `proven | mismatch | not_echoed | null`, and **only `mismatch` is a fault**: `not_echoed` is the ordinary
  answer on our v4.32 units (A37) and `null` means the check did not run at all.
- **Push and start are separate:** `POST /api/lobby/push` compiles every bundle and refuses on reds (names them)
  unless `force` — **except the four push-curable proof prefixes**, which the push CURES rather than trips over:
  a stale ack, echo mismatch, pool fault and query read-back mismatch all name the head, and a fresh head replaces
  it, so `POST /api/lobby/push` goes through unforced and re-acks. Stale ack and query mismatch are force-proof at
  the whistle; echo mismatch is forceable; the pool fault arises only in play. Every other red and every `waiting`
  row still refuses the push.
  `POST /api/start` mints `match_id`, stamps a monotonic `seq`, `go_live_t = now + runway_s`
  (default `DEFAULT_RUNWAY_S` 120; presets 60/120/180). A same-schedule re-push keeps `seq` + `match_id`; a
  reschedule mints both anew; abort reaches only nodes in range (`reached`/`unreachable`).
- **Scoring** (`scoring.py`, contracts §4): exact kills/assists, roster-based friendly (never in FFA), accuracy from
  victims' hits over own `shots_total` ("—" on a stale status; `acc_provisional` marks a number that has not
  settled — F119: hits arrive per EVENT and `shots` only on the ~2 s status heartbeat, so a row under 10 shots,
  or one whose `shots` sample predates its last landed hit, can spike and even exceed 100 %), `t_recv` re-basing for unsynced nodes, `match_id`
  parking, end freeze (`post_end_facts`), fresh-only `feedback`/`alert` (`FEEDBACK_MAX_AGE_MS`), the A11.4
  global-state alerts gated by `mc_confidence`.
- **S56 "what hit me" (2026-09-23).** `roster()` now carries each player's `weapons: [{weapon_id, hir}]`
  (`state._roster_weapons`) in slot order — `hir` off that player's own COMPILED `$WEAP` frame when MC
  holds one (a perk moves the numbers), else `WeaponCatalog.hir_magnitudes()`. A whole-roster repush
  (`_repush_lobby_config`, `push_config`) compiles every player before sending any of them, so a roster
  read mid-repush can never mix one player's fresh weapon_id with another player's stale `hir`.
  MC also relays `feedback{kind:"hit"}` to the SHOOTER's own node on a LIVE, first-ingest `hit_taken`
  fact (`state._relay_hit_feedback`/`_relay_batch_hits`, keyed off `Scorer.hits_log` growth so a
  duplicate seq, a parked fact, a post-end fact or a replay never re-fires it) — best-effort, same
  contract as the existing kill feedback.
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
  EVERY player's `rows`, the recipient's own `my`, `honors` (`{medal, key, player_id, display, stat}`, `key` the AWARDS row (A63) —
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
