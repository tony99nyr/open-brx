# Shared contracts (M-CONTRACTS) — freeze before building anything

- **Status:** Draft for ratification (Wave 0). After freeze, changes are **amendments** (§9), not edits.
- **Consumers:** every module. Bind to *these shapes*, never another module's internals.

Transport-agnostic where possible. JSON on the wire. All ids are opaque strings. Times are
**Unix ms** (`t`) unless noted; wall-clock coordination uses the synced clock in §7.

---

## 1. Identity & the armory

The permanent, bench-produced map. One record per gun. Lives in MC (`~/.brx-mcp/armory.json` today).

```jsonc
ArmoryRecord {
  gun_id:      string,   // stable internal id (e.g. headset PIN) — the primary key
  sticker:     string,   // physical label written as $NAME (e.g. "R0BAT"); advert = "<sticker>-<tail>"
  headset_pin: string,   // read over USB at enroll
  ble:         { address?: string, uuid?: string, tail: string }, // MAC (Android/Win) OR CoreBluetooth UUID (mac); tail = last 4
  gen:         "gen2_3" | "gen1",
  fw:          string | null,     // e.g. "v4.32"
  labeled:     boolean,           // physically stickered
  notes?:      string
}
```
- **`ble.address` is not portable across hosts/OS** (mac gives per-device UUIDs). Correlate by
  `sticker`/advert name, never a cached address. (iOS-findings §5.)
- Duplicate `sticker` is illegal (can't map two guns to one name).

## 2. People, teams, loadouts

```jsonc
Player {
  player_id:   string,       // session-stable
  display:     string,       // vanity name the host types at kit-out
  team_id:     string | null,
  node_id:     string | null,// the node currently bound to this player (§5)
  gun_id:      string | null,// assigned gun (ArmoryRecord.gun_id)
  loadout:     Loadout,
  voice:       "male" | "female" | string,  // sound-bank voice set
  ready:       boolean
}

Team { team_id: string, name: string, color: "blue"|"yellow"|"red"|"green"|string, tid: number } // tid → $TID

Loadout {
  weapons: WeaponSel[],      // ordered; index maps to the gun's weapon slots
  // per-player tunables the mode allows (health/armor caps come from the mode, not here, unless overridden)
  overrides?: { max_hp?: number, max_armor?: number }
}
WeaponSel { weapon_id: string }   // references WeaponCatalog (M-MODES)
```

## 3. Game config & modes (authoring output of M-MODES)

`GameConfig` is the **complete, serializable description** of a match — the single object MC pushes and
the node compiles into BRX frames. It MUST round-trip (author → JSON → frames) with no hidden state.

```jsonc
GameConfig {
  config_id:   string,
  mode:        "tdm" | "ffa" | "infection" | "lms" | "extraction" | string,
  environment: "indoor" | "outdoor",
  night:       boolean,               // drives LED/HUD blackout choices
  time_limit_s: number | null,        // null = untimed
  respawn:     { type: "auto"|"scanner"|"none", delay_s: number },
  scoring:     { frag_limit: number|null, win_by: "kills"|"survival"|"objective"|string },
  health:      { max_hp: number, max_armor: number },   // mode defaults; Loadout may override
  teams:       Team[],
  led?:        object,                // indoor/outdoor/night LED customization (M-MODES defines shape)
  // The frames the node sends to arm this config for a given team/loadout are produced by
  // M-MODES armFrames(config, player) — NOT stored here. This object is data, frames are derived.
}
```

`WeaponCatalog` (static data owned by M-MODES; see `reference/callsign-ui.md`):
```jsonc
Weapon {
  weapon_id: string, name: string, class: string,
  stats: { damage:number, mag:number, reserve:number, rof:number, reload_ms:number, range?:string },
  weap_frame: string,   // the $WEAP,... template (token positions per callsign-extract)
  icon?: string
}
```

## 4. The event model (the heart of scoring)

Nodes emit **facts they can observe**; MC derives **cross-player truth**. Never invent a fact a node
can't see (the gun is host-blind about its own kills).

**Node-observable events** (a node emits these about ITS gun/player):
```jsonc
Event =
 | { type:"shot",        t, node_id, player_id, weapon_id, ammo_after }          // trigger/ammo delta
 | { type:"hit_taken",   t, node_id, player_id, shooter_team, shooter_id?, dmg } // from $HIR (+ $HP delta)
 | { type:"death",       t, node_id, player_id, shooter_team, shooter_id? }      // $HP→0; shooter_id only if IR-decoded (P2)
 | { type:"respawn",     t, node_id, player_id }
 | { type:"status",      t, node_id, player_id, hp, armor, ammo, alive, deadline_s?, battery?, arm_state?, t_minus_ms?, synced? } // heartbeat; arm_state: idle|kitted|lobby|armed|live; t_minus_ms only when ARMED; synced=clock-sync is fresh (else degraded)
```
- `shooter_team` is **always available** (from `$HIR` token 4). `shooter_id` (individual) is **optional**:
  present when a Companion **IR-decodes** the shot's player-id (P2, the robust path), or *potentially* via
  a **native per-player `$TID`** (protocol §7k — bounded: `$TID` also drives the 4-colour LED, and max-N is
  untested). MC must handle its absence and fall back to team-level attribution.
- Events are **idempotent** by `(node_id, seq)` (§5 envelope) so store-and-forward replays are safe.

**MC-derived facts** (computed, never sent by nodes):
```jsonc
Kill   { t, victim: player_id, killer: player_id|null, team: team_id, weapon_id?, multi?: number }
Assist { t, victim: player_id, assister: player_id, dmg }
ScoreRow { player_id, display, team_id, kills, deaths, assists, shots, hits, accuracy, kd, streak, medals[] }
```
- **Kill attribution:** from a `death` event, MC credits the shooter. With `shooter_id` → exact. Without
  it → team-level; MC MAY best-effort individual-attribute from timing/proximity, flagged `approx`.
- **Assist:** any player who dealt `hit_taken` dmg to the victim within `ASSIST_WINDOW_MS` before death
  and isn't the killer. Player-level assists need `shooter_id`; team-level otherwise.
- **Accuracy** = confirmed hits-on-enemies / shots. Hits-on-enemies come from victims' `hit_taken`
  reports correlated to shooters — so accuracy is an **MC** number; nodes show "—" until told.

## 5. Node ↔ MC protocol (M-NET)

**Transport:** WebSocket over the field LAN. **Discovery:** MC advertises `_openbrx._tcp` via mDNS/
Bonjour; nodes resolve it (fallback: host types MC's IP). Node opens one WS to MC and keeps it warm;
all messages are JSON envelopes.

```jsonc
Envelope { v:1, kind:string, id:string, seq?:number, t:number, body:object }
```
`seq` is a per-node monotonic counter on `Event` messages for idempotent replay.

**Node → MC** (`kind`):
| kind | body | when |
|---|---|---|
| `hello` | `{ node_id, node_type:"phone"|"companion", app_ver, gun?: {tail,name} }` | on connect |
| `bind` | `{ node_id, player_id?, gun_tail }` | node claims/confirms its gun & player |
| `event` | one `Event` (§4) | as they happen (queued if offline) |
| `event_batch` | `{ events: Event[] }` | store-and-forward flush on reconnect |
| `ack_config` | `{ config_id, ok:boolean, err? }` | after applying a pushed GameConfig |
| `time_req` | `{ t_node }` | clock-sync ping (§7) |
| `log_offer` | `{ node_id, bytes, lines }` | node has a diagnostic log MC can pull |
| `ready` | `{ node_id, player_id, ready:boolean }` | lobby ready-up toggle (phase 4) |

**MC → Node** (`kind`):
| kind | body | when |
|---|---|---|
| `welcome` | `{ session_id, server_t, config?: GameConfig }` | reply to hello |
| `assign` | `{ player: Player, team: Team }` | kit-out: set player+team → **KITTED**. Carries **no config** (that's the lobby `config` push) so a node can reach KITTED to enable the phase-3a tutorial. |
| `tutorial` | `{ weapon: Weapon }` | silent try-out arming (phase 3a; requires KITTED) |
| `config` | `{ config: GameConfig }` | **lobby** push of the full game → node stores it + replies `ack_config`; enters **LOBBY**. Separate from `assign` so kit-out (phase 3) and the config push (phase 4) don't collide. |
| `start` | `{ go_live_t, config_id, seq, countdown_s }` | schedule the dispersed start (§M-START). MC stamps a **monotonic `seq` per session**; a higher `seq` supersedes a prior schedule. |
| `feedback` | `{ player_id, kind:"kill"|"multi"|"medal", sound?:string }` | MC scored you a kill → node greens sight + audio |
| `control` | `{ cmd, seq?, ... }`, cmd ∈ `end`\|`pause`\|`panic`\|`abort_start`\|`recall` | host controls — **one meaning each**: `abort_start`=cancel a *pending* scheduled start (by `seq`) → back to LOBBY; `recall`=stop a *live/armed* game → IDLE (node sends its end frames); `end`=normal match end; `pause`=hold; `panic`=`$CLEAR,*`→`$SP,99,*`. |
| `time_res` | `{ t_node, server_t }` | clock-sync reply |
| `pull_log` | `{}` | request the offered log |
| `ack` | `{ seq_hi }` | MC has durably ingested this node's events up to `seq_hi` (store-and-forward ring-prune signal) |

**Store-and-forward semantics (mandatory):**
- A node **runs its own gun with the WS down.** Events queue locally (bounded ring, persisted) and flush
  as `event_batch` on reconnect. MC dedups by `(node_id, seq)`.
- `feedback`/`start` are **best-effort**; the node's own loop never depends on receiving them (start uses
  the pre-shared `go_live_t`, §7).
- MC treats missing nodes as **stale, not gone** — the scoreboard shows last-known + a staleness age.

## 6. Node lifecycle (state the HUD + MC both reason about)

```
IDLE ─setGun─► CONNECTED ─assign(player+team)─► KITTED ─config(GameConfig)─► LOBBY ─start(seq,go_live_t)─► ARMED(countdown)
   ▲                                                        (ready:bool toggles within LOBBY)                    │
   └──────────────── recall / end ◄──────── LIVE ◄───────────────────── T = go_live_t ──────────────────────────┘
LIVE: {ALIVE ⇄ DOWN(respawn timer)}; LIVE ends on `recall`/`end` OR **local time-expiry** (deadline reached
      while dispersed — the node ends its own match, symmetric to the timed start; see M-NODE).
ARMED ends early on `abort_start` → LOBBY.  Link state (CONNECTED/DISCONNECTED, auto-reconnect → resume prior
      state) is **orthogonal** to the game phases above — a node can be DISCONNECTED in any phase and keep running.
```

## 7. Clock sync (drives the dispersed start)

Nodes and MC agree on time so a pre-shared `go_live_t` fires together without a T-0 signal.
- On connect and periodically, node sends `time_req{t_node}`; MC replies `time_res{t_node, server_t}`.
  Node computes `offset = server_t - (t_node + rtt/2)` (NTP-lite) and keeps a smoothed offset.
- **synced_now() = local_now() + offset.** All `go_live_t` and `deadline_s` math uses synced time.
- Phone clocks drift <<1 s over a match; re-sync at lobby is enough. A node that never synced falls back
  to counting `now + duration` from the moment it *received* `start` (degraded, logged).

## 8. BRX frame contract (what a node writes to the gun)

Nodes never invent frames; they use **M-MODES `armFrames()`** + the known-safe set (`protocol.py`).
Canonical references (do not restate — link): arm/spawn/respawn, `$WEAP`/`$GSET`/`$PSET`, feedback
(`$SFLASH` + token-4 `$PLAY`), battery `$VOLTS`, hit `$HIR`, health `$HP`/`$LCD`/`$ALCD` — all in
`protocol/brx-protocol.md` + `protocol/callsign-extract/`. **Panic:** `$CLEAR,*` then `$SP,99,*`.
Volume **69** for real games (30 is inaudible). BLE writes chunk at 20 bytes (§app).

## 9. Versioning & amendments

- `Envelope.v` gates protocol compatibility; `app_ver`/`server_ver` are informational.
- **Three distinct `seq` namespaces** (do not conflate): `Envelope.seq` = per-node event counter (dedup);
  `start.seq` = MC's per-session schedule counter; `control.seq` = a reference *to* a `start.seq` (which
  schedule an `abort_start` targets). Different counters, different owners.
- **Config staleness:** `config_id` is the identity + integrity token for a pushed `GameConfig`; a node
  keys "is my stored config current" on `config_id` (no separate hash). A node with a stale/absent
  `config_id` at `start` re-requests via `hello`→`welcome{config}`. Optional `CONFIG_TTL_MS` bounds how
  long a stored config is trusted without a refresh.
- Post-freeze changes: add an **Amendment** entry here (date, what, why, migration) and bump `v` only for
  wire-breaking changes. Additive fields are non-breaking; consumers ignore unknown fields.
- **Constants** (single source): `ASSIST_WINDOW_MS = 4000`, `MULTI_KILL_MS = 4000`, `ATTRIB_FUSE_MS =
  6000`, `STATUS_HEARTBEAT_MS = 2000`, `STALE_AFTER_MS = 8000`, `MAX_HP`/`MAX_AR` from GameConfig.

### Amendments
- **A1 (2026-08-25, additive, non-breaking, no `v` bump):** module drafts surfaced four missing
  shapes, all additive (unknown fields are ignored by older consumers):
  - Node→MC **`ready`** — lobby ready-up toggle (was implied by phase 4, unspecified). *(M-MC)*
  - MC→Node **`ack {seq_hi}`** — lets a node prune its store-and-forward ring once MC has durably
    ingested events, instead of holding them forever. *(M-NET)*
  - **`start`** gains **`seq`** + **`countdown_s`**, and **`control`** gains **`abort_start`** — a
    scheduled dispersed start must be reschedulable/abortable, keyed by `seq`. *(M-START)*
  - **`status`** event gains **`arm_state`** (`idle|kitted|lobby|armed|live`) so MC's board can show
    per-node lifecycle (contracts §6) without inferring it. *(M-START/M-MC)*
  - Policy: readiness battery is **amber, not red**, on a missed `$VOLTS` — a missing reading is not a
    flat pack. *(M-ARMORY)*
- **A2 (2026-08-25, review polish-loop, additive/clarifying):**
  - **Split `assign` (kit-out, no config → KITTED) from a new `config` message (lobby push → LOBBY)** so
    phase-3 kit-out and phase-4 config-push don't collide and the phase-3a tutorial has a legal KITTED
    precondition. *(consistency review, Critical)*
  - **`recall` vs `abort_start` disambiguated** (control table): `abort_start`=cancel a pending schedule,
    `recall`=stop a live game. *(consistency/completeness)*
  - `status` gains **`t_minus_ms`**/**`synced`**; `start.seq` clarified **MC-stamped**; link state declared
    **orthogonal** to game phase; three `seq` namespaces named; `config_id` = staleness key. *(all reviews)*
  - Attribution note: individual `shooter_id` may also come from a **native per-player `$TID`** (§7k),
    not IR-decode alone. *(feasibility)*
