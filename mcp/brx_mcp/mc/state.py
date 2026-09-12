"""M-MC Session — the match state machine (docs/spec/contracts.md §5/§6, mc/API.md).

Owns: phase, roster (player_num), teams, GameConfig draft, node registry, readiness rollup,
kit-out/tutorial pushes, lobby push + acks, start/reschedule/abort, controls, hydrate answer,
and the Scorer for the current match. Everything the UI sees is `snapshot()` (API.md State).
"""
from __future__ import annotations

import copy
import json
import random
import re
import secrets
import time
import uuid
from pathlib import Path
from typing import Any, Callable, get_args
from urllib.parse import quote

from . import presentation as _pres
from .. import poolgauge as _pg
from .. import voices as _voices
from . import compile as _compile      # A31: `mc_verify` / `full_coverage` — one coverage model
from . import policy as _policy
from .scoring import Scorer
from ..modes.hillbeacon import NEUTRAL_TEAM as _NEUTRAL_TEAM     # F82: the tid a NEUTRAL hill broadcasts
from ..modes.registry import default_params as _default_params, params_schema_json as _params_schema_json, \
    validate_mode_params as _validate_mode_params, \
    requires_coverage as _requires_coverage                        # A18: the mode's own rules, engine-declared
from .tunnel import TunnelError
from .types import (CLOCK_TIE_MS, DEFAULT_RUNWAY_S, HEADSET_LINK_PROOF_MS, MAX_PLAYERS,
                    OBJECTIVE_MODES, OFFLINE_AFTER_MS,
                    STALE_AFTER_MS, STATION_KINDS, STATION_SOURCES, STATION_TEAM_ANY, SYNC_FRESH_MS, GameConfig,
                    Phase, Player, ReadinessRow, ReadinessSnapshot, ScanRow, Team, app_tier, compatible,
                    parse_app_ver)

PHASES = get_args(Phase)      # the vocabulary itself lives on `types.Phase`, so the console's is generated from it

# A25: the session option table. `log_sync` gates the AUTOMATIC `pull_log` asks (recap / offer /
# reconnect); the operator's LOGS button (`reason: "manual"`) is never gated -- the whole point of
# "manual" is that the operator still gets a log when they ask for one.
OPTION_DEFAULTS: dict[str, Any] = {"log_sync": "auto"}
OPTION_VALUES: dict[str, tuple[str, ...]] = {"log_sync": ("auto", "manual")}
LOG_STATES = ("none", "offered", "pulling", "held", "complete")
PULL_REASONS = ("recap", "offer", "manual", "reconnect")


def release_app_version() -> str | None:
    """The app version on the GitHub Release, read from `webapp/download/build.json` (the sidecar
    `npm run android:apk` writes). Absent on a checkout that has never cut an APK, and absent in an
    installed/packaged MC -- both are fine: no sidecar simply means no RELEASE amber."""
    try:
        path = Path(__file__).resolve().parents[3] / "webapp" / "download" / "build.json"
        data = json.loads(path.read_text())
    except Exception:
        return None
    v = data.get("version") if isinstance(data, dict) else None
    return v if isinstance(v, str) and v else None


# A28.1: `lan.public` before anything has been started. `available` is overwritten the moment a Tunnel
# is attached; until then MC honestly says it has not looked.
PUBLIC_OFF = {"ws_url": None, "status": "off", "provider": None, "available": False}


class CoverageRequired(ValueError):
    """A28.4: this mode declares `requires_coverage` and coverage is not full. The API answers 409
    `{error, coverage}` — a ValueError so every existing `except ValueError` path still catches it."""

    def __init__(self, msg: str, coverage: dict):
        super().__init__(msg)
        self.coverage = coverage
        self.status = 409

TEAM_DEFS = {  # $TID: 1=blue, 2=yellow, 0=red (protocol §7i); green provisional 3
    "blue": {"team_id": "blue", "name": "BLUE TEAM", "color": "#3a86ff", "tid": 1},
    "yellow": {"team_id": "yellow", "name": "YELLOW TEAM", "color": "#ffd23f", "tid": 2},
    "red": {"team_id": "red", "name": "RED TEAM", "color": "#ff5252", "tid": 0},
    "green": {"team_id": "green", "name": "GREEN TEAM", "color": "#2ecc71", "tid": 3},
    "ffa": {"team_id": "ffa", "name": "FREE-FOR-ALL", "color": "#e8eef5", "tid": 1},
}

# Briefing copy verbatim from the Mission Control design export (A2 mode briefing panel).
# `preset` (led-language.md §4, mode-extensibility G3, 2026-09-07): the presentation preset each
# catalogued mode resolves to, so `default_config()` reads it straight off the mode row instead of
# `presentation.MODE_PRESET`'s own internal (and separately-keyed, "cs" not "counter_strike") table --
# a new mode added HERE picks up a preset the moment it names one, with no second table to update.
# `proven`: the mode has run a whole match on real taggers (TDM 2026-08-25 and 2026-09-01, FFA 2026-08-30,
# KotH through the gun 2026-09-10). The public site badges the others "in development" off this flag;
# flip it here, never on the site, when a mode has its first real match.
MODES = [
    {"mode": "tdm", "name": "TEAM DEATHMATCH", "abbr": "TDM", "desc": "Teams score per elimination",
     "brief": "Squads score a point per elimination. Downed players respawn after the delay and rejoin. First team to the score cap — or the highest score at the time limit — takes the match.",
     "teams_text": "2–4 TEAMS", "win_text": "SCORE CAP / TIME", "respawn_text": "ON · TIMED",
     "teams": ["blue", "yellow"], "win_by": "kills", "frag_limit": 25, "respawn": {"type": "auto", "delay_s": 15},
     "preset": "standard", "proven": True},
    {"mode": "ffa", "name": "FREE-FOR-ALL", "abbr": "FFA", "desc": "Every operator for themselves",
     "brief": "No teams — everyone is a target. Each elimination scores a point. First to the frag limit, or the top score when time expires, wins.",
     "teams_text": "NONE · ALL VS ALL", "win_text": "FRAG LIMIT / TIME", "respawn_text": "ON · TIMED",
     "teams": ["ffa"], "win_by": "kills", "frag_limit": 25, "respawn": {"type": "auto", "delay_s": 15},
     "preset": "standard", "proven": True},
    {"mode": "infection", "name": "INFECTION", "abbr": "INF", "desc": "One infected; survive the spread",
     "brief": "One operator starts infected. Survivors who go down switch sides and hunt their old squad. Survivors win by outlasting the clock; the infected win by converting everyone.",
     "teams_text": "SURVIVORS VS INFECTED", "win_text": "SURVIVE THE CLOCK", "respawn_text": "INFECTED ONLY",
     "teams": ["blue", "red"], "win_by": "survival", "frag_limit": None, "respawn": {"type": "auto", "delay_s": 10},
     "preset": "infection", "proven": False},
    {"mode": "lms", "name": "LAST MAN STANDING", "abbr": "LMS", "desc": "Limited lives, last alive wins",
     "brief": "Every operator carries a fixed pool of lives. Once they are spent there is no respawn. The last operator — or last squad — still standing takes the match.",
     "teams_text": "SOLO OR SQUADS", "win_text": "LAST ALIVE", "respawn_text": "OFF · LIVES",
     "teams": ["ffa"], "win_by": "survival", "frag_limit": None, "respawn": {"type": "none", "delay_s": 0},
     "preset": "last_stand", "proven": False},
    {"mode": "extraction", "name": "EXTRACTION", "abbr": "EXT", "desc": "Loot, reach the extract, survive the channel",
     "brief": "Gather loot, then reach an extraction point and channel the extract. It is loud: everyone hears the chopper coming and converges on you. Survive the timer and your loot is banked. Die and you drop it all for someone else to take.",
     "teams_text": "SOLO OR SQUADS", "win_text": "BANKED LOOT", "respawn_text": "ON · TIMED",
     "teams": ["blue", "yellow"], "win_by": "objective", "frag_limit": None, "respawn": {"type": "auto", "delay_s": 15},
     "preset": "extraction", "proven": False},
    # F70 (bench-proven end to end 2026-09-10): the hill is a BRX Smart Grenade in hill mode. It
    # broadcasts protocol-15 beacons carrying its OWNER's team, `hillbeacon.py` reads them and
    # `DominationEngine` scores possession, so the mode needs no station hardware at all -- hence
    # `station_source: "grenade"` on the row (the operator can change it, `_CONFIG_KEYS`).
    # 🔴 `teams` is BLUE + GREEN, tids 1 and 3, and the choice is load-bearing: YELLOW is tid 2,
    # which is the team a NEUTRAL hill broadcasts, so a yellow roster would read every uncaptured
    # point as its own and take no hill damage (F82). `assign_teams` defaults the same 1/3 pair, and
    # both `DominationEngine.add_player` and `Compiler.validate` refuse a tid-2 hill roster outright.
    # `win_by` is "objective" (possession time), the same value extraction already uses: MC has no
    # objective scorer, so `scoring.py` reports the winner as `undecided` rather than inventing one
    # from kills, and the UI renders that as "UNDECIDED — OBJECTIVE · HOST DECIDES" (Recap.tsx).
    {"mode": "koth", "name": "KING OF THE HILL", "abbr": "KOTH", "desc": "Hold the hill; possession scores",
     "brief": "One hill, and it is a real grenade on the field. Shoot the point and it flips to your team; every second your side holds it banks possession. A point your team does not own damages anyone standing on it, so taking one is a fight, and a defended hill costs an attacker exactly what the defenders put into it. Most possession time when the clock runs out takes the match.",
     # `win_text` says HOST CALL on purpose, and it is the honest label until the phones report.
     # MC ingests a `possession` fact and names the winner from it the moment one arrives (API.md /
     # `scoring._possession`) -- but nothing on `app/src` sends one yet, so a card reading plain
     # "POSSESSION TIME" promises a number that does not exist and the operator gets a kills table
     # (operator review 2026-09-10). ➡ Drop "· HOST CALL" when the phone ships the fact.
     "teams_text": "2 TEAMS", "win_text": "POSSESSION TIME · HOST CALL", "respawn_text": "ON · TIMED",
     "teams": ["blue", "green"], "win_by": "objective", "frag_limit": None, "respawn": {"type": "auto", "delay_s": 15},
     "preset": "standard", "station_source": "grenade", "proven": True},
]


# End of a private try-out: the gun goes idle and stays UNHITTABLE until the game is pushed. That is
# intended (it is a teardown), and it is a named constant so `test_clear_safety` can track the REAL
# list rather than a hand-copied duplicate that would drift silently.
TRYOUT_TEARDOWN = ("$SPAWN,,*", "$PLAYX,0,*", "$STOP,*", "$CLEAR,*", "$HLOOP,0,0,*",
                   "$HLED,0,0,0,0,0,0,*")

# The OPERATOR's line for an event whose subject MC could not name (`_alert_feed_text`). Every entry
# here is a `presentation.MC_TEXT` template that needs a `{who}`: with no subject, `feed_text` falls back
# to the HUD's own second-person copy, which is F118 all over again on the host console. These say the
# same thing about nobody in particular; the unresolved id is appended after them.
_MC_TEXT_NO_SUBJECT = {"lead_taken": "THE LEAD CHANGED", "lead_lost": "THE LEAD CHANGED",
                       "last_survivor": "ONE PLAYER IS LEFT STANDING", "infected": "A PLAYER WAS INFECTED"}

# THE KIT LOCKS AT START (2026-09-12). Everything a player carries is compiled into `frames`, and the only
# way to change a gun's frames is a `config` envelope -- which rewrites `frames.head`. Since A23/F121 that
# head is the DISARMED fn-28 `$SIR` table (the real one rides `frames.spawn`/`frames.revive`), and
# `engine.js _applyConfig` sets `spawned = false` while KEEPING an armed/live phase, with `resumeSchedule()`
# returning early in `live` -- so nothing re-spawns that gun. The player is then hit by everything, moves no
# pool and cannot fire, for the rest of the match. So no kit change is accepted once a match is running: the
# phone is told in its own words, the host in the operator's.
KIT_LOCKED = "THE MATCH HAS STARTED — YOUR KIT IS LOCKED UNTIL THE NEXT ONE"


class ConflictError(ValueError):
    """A refusal about the STATE OF PLAY rather than the request: correct, just not now (A30 → HTTP 409).

    Still a ValueError, so every existing caller and route keeps working unchanged; `api.py` reads
    `.status` where it matters. `PresetError` has carried the same field since the saved-games lane."""
    status = 409

class NotReadyError(ConflictError):
    """A27/F127: CONTINUE from KIT while somebody has not pressed READY. Not a bad request -- a state of
    play -- so it is a 409, and it CARRIES who is missing so the UI's second tap can name them rather
    than making the operator hunt the board."""

    def __init__(self, message: str, not_ready: list[str], greens: int, roster_size: int):
        super().__init__(message)
        self.not_ready = not_ready
        self.greens = greens
        self.roster_size = roster_size

    def body(self) -> dict:
        return {"error": str(self), "not_ready": self.not_ready,
                "greens": self.greens, "roster_size": self.roster_size}


_KIT_LOCKED_HOST = ("the match is {phase}: a player's kit is locked until it ends — changing {what} now would "
                    "re-arm that gun with the disarmed head and it could not fire or take damage again this "
                    "match. RECALL or END first")
_KIT_FIELDS = ("loadout", "voice", "voice_slots", "player_num", "gun_id")


def default_config(mode: str = "tdm") -> GameConfig:
    m = next(x for x in MODES if x["mode"] == mode)
    cfg: GameConfig = {"config_id": uuid.uuid4().hex[:8], "mode": mode, "environment": "outdoor", "night": False,
                       "time_limit_s": 600, "respawn": dict(m["respawn"]),
                       "scoring": {"frag_limit": m["frag_limit"], "win_by": m["win_by"]},
                       "health": {"max_hp": 45, "max_armor": 70},
                       "teams": [dict(TEAM_DEFS[t]) for t in m["teams"]],
                       "loadout_policy": _policy.default_policy(mode),      # A10: ffa → no_heavies, else open
                       "presentation": _pres.profile_from_preset(m.get("preset", "standard"))}   # A11 / G3: the mode row's own preset
    # Only the modes that HAVE an objective emitter carry the key at all, so every other mode's config
    # is byte-identical to what it was before the field existed (a saved game's identity is the whole
    # config -- `gameSummary.ts` `gameSig` -- and a null nobody set would have re-keyed all of them).
    if m.get("station_source"):
        cfg["station_source"] = m["station_source"]
    # A18: the same rule for the mode's own parameters -- present and COMPLETE (every default) only when the
    # engine declares some (koth, lms, extraction); tdm / ffa / infection declare none and stay byte-identical.
    mp = _default_params(mode)
    if mp:
        cfg["mode_params"] = mp
    return cfg


class Session:
    def __init__(self, compiler, net, armory, store=None, now_ms: Callable[[], int] | None = None,
                 lan: dict | None = None, voice_rng: random.Random | None = None):
        self.compiler, self.net, self.armory, self.store = compiler, net, armory, store
        # A15.1: every push rolls the un-picked $PSET voice fields (death scream, short pain, respawn cry) so two
        # players with the same character do not die with the same scream; inject a seeded Random in tests.
        self._voice_rng = voice_rng or random.Random()
        self.now_ms = now_ms or (lambda: int(time.time() * 1000))
        self.session_id = uuid.uuid4().hex[:8]
        self.phase = "muster"
        self.players: dict[str, Player] = {}
        self.teams: list[Team] = []
        self.config: GameConfig = default_config("tdm")
        self.teams = list(self.config["teams"])
        self.config_errors: list[str] = []
        self.config_warnings: list[str] = []
        self.nodes: dict[str, dict] = {}          # node_id -> NodeView
        self.node_player: dict[str, str] = {}     # node_id -> player_id
        # A13.5 / F104 (2026-09-11): the utility phones (stations). node_id -> {assigned, report, armed, ...};
        # `stations_view()` is the ITEMS panel's data. A utility node is never bound to a player and is
        # never pruned while it holds an assignment (the operator set it up; a 10-minute silence is a phone
        # propped on a hill, not a phantom).
        self.stations: dict[str, dict] = {}
        # The per-match `game` byte a station is armed with (utility.md §5b.3 / roadmap C1). It changes on
        # the first config push AFTER a match has started, so a station in range at the next muster learns
        # that a new match exists -- `applyStationConfig` resets the point when the number changes, and
        # that reset is the ONLY between-match reset a station gets (F104 consequence c).
        self.game_no = 1
        self._game_no_started = False
        self.synced_at_lobby: dict[str, bool] = {}
        self.scan_rows: list[ScanRow] = []
        self.lan = lan or {"mode": "unknown", "ip": "0.0.0.0", "port": 0, "ws_url": "", "qr": ""}
        # A28.2: 8 url-safe chars, random per session, PERSISTED with the snapshot so an MC restart does
        # not invalidate every QR already printed and taped to a wall. It is readable by anyone on the
        # LAN via GET /api/state, deliberately (§5b: the LAN is already the trust boundary) — its one
        # job is keeping internet strangers off the node socket once the tunnel is up.
        self.join_secret = secrets.token_urlsafe(6)
        self.lan.setdefault("public", dict(PUBLIC_OFF))
        self.tunnel = None                        # A28.1: attached by __main__ (`attach_tunnel`)
        self.trying: dict[str, str] = {}          # player_id -> weapon_id
        self.browsing: dict[str, int] = {}        # A10: player_id -> t_ms the HUD opened its loadout browser
        self._policy_notice: str | None = None    # A10: "N LOADOUTS RESET BY …" — shown in config_warnings until the next config PUT
        self.active_preset_id: str | None = None  # A10 §8: the saved game that was APPLIED — GAMES marks it PLAYING (content-matching
                                                  # cannot tell a duplicate from its source: review 2026-08-27 #0)
        self.presets = None                       # A10 §8: PresetStore, attached by __main__/create_app (memory store when absent)
        # A17: `lobby_pushed` is ALSO the real guard on `_pinned_hit_plan` below. It is set True in exactly
        # one place (`push_config`, which clears the pin as its first statement), and every path that can
        # compile (`_resend`, `_bind`, hydrate) is gated on it -- so a pin can never survive into a new
        # match even though `new_session`/`_finish`/`control` reset this flag without touching it. That
        # invariant is load-bearing and invisible from `_hit_plan` alone; do not gate a compile path on
        # anything else without re-checking it.
        self.lobby_pushed = False
        self._pinned_hit_plan = None      # A17: one hit-audio plan per MATCH -- see `_hit_plan`
        self.acks: dict[str, dict] = {}
        self.bundles: dict[str, dict] = {}
        self.start_info: dict | None = None
        # A19: held-role pushes waiting for the node's own start / respawn flash to settle (`_queue_role`).
        self._role_due: list[tuple[int, str, str, bool, int | None]] = []
        self.start_seq = 0
        self.scorer: Scorer | None = None
        # F124: a frag cap reached while a BATCH is being scored waits for the batch (`ingest_batch`), so
        # the recap is snapshotted from every fact in it and not from the half the cap interrupted.
        self._batch_depth = 0
        self._pending_limit_t: int | None = None
        self._score_pushed: dict[str, dict] = {}   # A7: last ScoreRow pushed per player
        self._result_pushed: dict[str, dict] = {}  # A24: last `result` body pushed per player (minus `t`)
        # A24/M2: WHAT ended the last match -- "frag_limit" | "host" | "time" | None. Only a frag cap has
        # an end time that a LATER fact can move (an earlier cap kill flushed minutes late); a whistle and
        # a clock are moments the field already lived through and are never re-derived.
        self.end_reason: str | None = None
        self._log_bytes: dict[str, int] = {}       # per-node pulled-log byte budget (per MATCH; reset in `_schedule`)
        # A25: node_ids with an AUTOMATIC `pull_log` ask still outstanding. A node that reconnects and
        # then offers its log fires `reconnect` and `offer` in the same breath, and asking twice makes
        # the phone upload the same log twice. Cleared by a fresh `hello` (the socket we asked is gone)
        # and by the first `log_data` chunk (the node is answering). The manual button is never deduped:
        # "manual" means the button is the only asker, not that the button stops working.
        self._log_asked: set[str] = set()
        # A24/M2: the roster AS PLAYED. `_replay` must not build its Scorer from the LIVE roster --
        # the operator can re-team a player during recap, and a late flush would then replay the
        # finished match on the new teams. Frozen at `_schedule` and again at the whistle.
        self._match_players: dict[str, Player] | None = None
        # A25 background log sync. `options` is the session option table (`PUT /api/options`);
        # `_log_match` is the match_id of the LAST match that ended, and `_log_done` the match whose log
        # each node has finished delivering -- the pair is the whole "did this node's log ever arrive?"
        # test that the `reconnect` ask is built on. Neither is cleared by NEW MATCH: a phone that was
        # out of coverage at the whistle still owes us that match's log ten minutes later.
        self.options: dict[str, Any] = dict(OPTION_DEFAULTS)
        self._log_match: str | None = None
        self._log_done: dict[str, str | None] = {}
        # A29: the app version on the GitHub Release, read ONCE at startup (a sidecar that changes
        # mid-session means someone cut an APK while a game was running; re-reading it per snapshot
        # would put a file read on the 4 Hz broadcast path).
        self.release_version: str | None = release_app_version()
        self.last_recap: dict | None = None
        self.feed: list[dict] = []
        self._listeners: list[Callable[[], None]] = []
        self._feed_listeners: list[Callable[[dict], None]] = []
        self._attach_net()
        self._render_join()
        self._gun_index()

    # ---------- plumbing ----------
    def on_change(self, cb): self._listeners.append(cb)
    def on_feed(self, cb): self._feed_listeners.append(cb)
    def _changed(self):
        self._sync_kit_open()          # A10: phase/push flips re-assign the phones (setting-up ⇄ kit editor)
        for cb in self._listeners:
            cb()
        self._persist()

    # An MC restart must not dump the roster: 3x on 2026-08-26 a restart mid-setup left connected
    # phones on "WAITING FOR KIT-OUT" with every gun ghosted NOT SEEN. Snapshot the human work
    # (players/teams/config) — never live link state (node_id, phase, acks).
    _persist_path = None            # set by __main__; None = persistence off (tests)
    _persist_last = 0.0
    _persist_dirty = False

    def persist_now(self):
        """Throttle-bypassing flush — atexit and phase transitions call this so the FINAL
        write of a burst is never lost to the 2s debounce (polish-loop 2026-08-26)."""
        if self._persist_path and self._persist_dirty:
            self._persist_last = 0.0
            self._persist()

    def _persist(self):
        if not self._persist_path:
            return
        now = time.monotonic()
        if now - self._persist_last < 2.0:
            self._persist_dirty = True      # a delayed flush (persist_now via atexit/transitions) picks this up
            return
        self._persist_last = now
        self._persist_dirty = False
        try:
            # S5(a): assignments used to live for the SESSION only, so an MC restart at the field forgot
            # every placed station -- the operator had to walk out and re-do ITEMS from scratch. Only an
            # ASSIGNED station is worth a line (an unassigned entry is just a hello nobody acted on, and
            # `restore_snapshot` re-derives it from the next hello anyway).
            stations = {nid: st["assigned"] for nid, st in self.stations.items() if st.get("assigned")}
            snap = {"v": 1, "saved_ms": self.now_ms(),
                    "players": [{**p, "node_id": None, "ready": False} for p in self.players.values()],
                    "teams": self.teams, "config": self.config, "active_preset_id": self.active_preset_id,
                    "stations": stations, "game_no": self.game_no, "game_no_started": self._game_no_started,
                    # A28.2: a restore must keep every printed QR valid, so the secret is human work too.
                    "join_secret": self.join_secret}
            tmp = self._persist_path.with_suffix(".tmp")
            tmp.write_text(json.dumps(snap))
            tmp.replace(self._persist_path)
        except Exception:
            import logging; logging.getLogger("brx.mc").exception("session snapshot failed (play continues)")

    def restore_snapshot(self) -> int:
        """Load a prior session.json (if any). Returns the number of players restored."""
        if not self._persist_path or not self._persist_path.exists():
            return 0
        try:
            snap = json.loads(self._persist_path.read_text())
            self.players = {p["player_id"]: p for p in snap.get("players", [])}
            if snap.get("teams"):
                self.teams = snap["teams"]
            if snap.get("config"):
                self.config = snap["config"]
            self.active_preset_id = snap.get("active_preset_id")
            # S5(a): a restored station comes back UNARMED -- `armed=None, arm_pending=True` -- because the
            # phone itself remembers nothing about MC across a restart; the existing "re-arm on next hello"
            # path (`_on_node`'s utility branch, `if st.get("assigned"): self._arm_station(nid)`) is what
            # actually pushes `station_config` again the moment the phone (still out on the field) says
            # hello. `game_no`/`game_no_started` come back too, so a restart mid-match still bumps the byte
            # on the next muster push instead of re-arming everyone for a game they already played.
            for nid, a in (snap.get("stations") or {}).items():
                if not isinstance(a, dict):
                    continue
                self.stations[nid] = {"node_id": nid, "assigned": a, "report": {}, "armed": None, "arm_pending": True}
                self.nodes.setdefault(nid, {"node_id": nid, "node_type": "utility", "arm_state": "idle",
                                            "synced": False, "last_seen_ms": 0})
            self.game_no = snap.get("game_no", self.game_no)
            self._game_no_started = bool(snap.get("game_no_started", False))
            if isinstance(snap.get("join_secret"), str) and snap["join_secret"]:
                self.join_secret = snap["join_secret"]     # A28.2: the QRs already printed stay valid
                self._render_join()
            self._repair_player_nums()
            self.config["loadout_policy"] = _policy.normalize(self.config.get("loadout_policy"), self.config["mode"])
            # A18: a snapshot persisted before mode_params existed restores a koth/lms/extraction config with
            # none, and `_validate` skips an ABSENT set, so the wire pushed without it (polish review 2026-09-11).
            # Complete-or-absent, the same rule as `default_config`.
            mp, _errs = _validate_mode_params(self.config["mode"], self.config.get("mode_params") or {})
            if mp:
                self.config["mode_params"] = mp
            else:
                self.config.pop("mode_params", None)
            # A11: a snapshot persisted before the presentation profile existed gets the mode default, so the
            # console still reads it as the stock mode it was (the UI compares configs to the mode defaults).
            if not isinstance(self.config.get("presentation"), dict):
                self.config["presentation"] = _pres.default_for(self.config["mode"])
            for pl in self.players.values():                      # a pre-A10 snapshot has no `perk` key; fine
                pl["loadout"] = _policy.apply(self.config["loadout_policy"], self.loadout_pool(), pl.get("loadout") or {"weapons": []},
                                              *self._catalog_rows())
            self._gun_index()
            return len(self.players)
        except Exception:
            import logging; logging.getLogger("brx.mc").exception("session snapshot restore failed — starting clean")
            return 0
    def _repair_player_nums(self) -> None:
        """Every restored player gets a UNIQUE 1..63 `player_num`, whatever the file said.

        `player_num` is what goes on the wire as the `$PSET` player id, so a duplicate is not a
        cosmetic problem: two guns answer to the same id and every hit either of them takes is
        attributed to whichever player MC looks up first. The restore path used to take the file's
        numbers verbatim and only re-derive them at the next config change — so a hand-edited,
        half-written or two-sessions-merged snapshot could arm a game that scores the wrong people
        (polish-loop deferred low). Order is stable: the first player to claim a number keeps it.
        """
        seen: set[int] = set()
        needs: list[Player] = []
        for p in self.players.values():
            n = p.get("player_num")
            ok = isinstance(n, int) and not isinstance(n, bool) and 1 <= n <= MAX_PLAYERS and n not in seen
            if ok:
                seen.add(n)
            else:
                needs.append(p)
        if not needs:
            return
        import logging
        base = int(self.config.get("player_num_base") or 1)
        # Prefer the configured base range (A6.5 keeps concurrent games disjoint), but fall back to
        # the numbers BELOW it before giving up: this path RESTORES a roster, and dropping a real
        # player while 1..base-1 sat free would destroy data the operator already had. The live add
        # path (`_next_num`) may refuse; this one must not (review 2026-09-01).
        start = max(1, min(base, MAX_PLAYERS))
        order = list(range(start, MAX_PLAYERS + 1)) + list(range(1, start))
        free = (n for n in order if n not in seen)
        for p in needs:
            n = next(free, None)
            if n is None:                                  # roster fuller than the wire allows
                logging.getLogger("brx.mc").error(
                    "snapshot has more players than player_nums (%d) — dropping %s", MAX_PLAYERS, p.get("display"))
                self.players.pop(p["player_id"], None)
                continue
            logging.getLogger("brx.mc").warning(
                "snapshot player_num %r for %s was invalid or taken — reassigned to %d",
                p.get("player_num"), p.get("display"), n)
            p["player_num"] = n
            seen.add(n)

    def _log(self, node_id, kind, body, t_recv, seq=None, parked=False):
        if not self.store:
            return
        try:
            mid = body.get("match_id") if isinstance(body, dict) else None
            self.store.log(node_id, kind, seq, body.get("t") if isinstance(body, dict) else None, t_recv, mid, parked, body)
        except Exception:   # a store error must never lose a fact the node has already pruned
            import logging; logging.getLogger("brx.mc").exception("store.log failed (fact still scored in memory)")

    def _gun_index(self):
        self.guns: dict[str, dict] = {}
        try:
            for r in self.armory.list():
                self.guns[r["gun_id"]] = r
        except Exception:
            self.guns = {}

    def _attach_net(self):
        n = self.net
        n.hydrate(self._hydrate)
        if hasattr(n, "resolve_gun"):
            n.resolve_gun(lambda name, tail: (self._find_player_for_gun(name or None, tail or None) or {}).get("player_id"))
        n.on_node(self._on_node)
        n.on_status(self._on_status)
        n.on_event(self._on_event)
        if hasattr(n, "on_batch"):
            n.on_batch(self.ingest_batch)      # real NetServer routes batches here (A5.7)
        n.on_node_message(self._on_node_message)
        n.on_stale(lambda nid, age: self._touch(nid, stale=True))
        n.on_return(lambda nid: self._touch(nid, stale=False))
        if hasattr(n, "on_disconnect"):
            n.on_disconnect(self._on_disconnect)
        try:
            ji = n.join_info()
            self.set_ws_url(ji.get("url", ""))
        except Exception:
            pass

    # ---------- A28 backhaul: the join QR, the tunnel, derived coverage ----------
    def set_ws_url(self, url: str) -> None:
        """The bare LAN node URL (`lan.ws_url`). `lan.qr` is DERIVED from it and never set directly —
        the two used to be the same string, and A28.2 made the QR carry a query the URL must not."""
        if url:
            self.lan["ws_url"] = url
        self._render_join()

    def _public(self) -> dict:
        return self.lan.get("public") or dict(PUBLIC_OFF)

    def _pub_url(self) -> str | None:
        """The public ws URL when it is usable — i.e. only while `status == "up"` (A28.2)."""
        pub = self._public()
        return pub.get("ws_url") if pub.get("status") == "up" else None

    def join_body(self) -> dict:
        """`welcome.join` / the MC→node `join` push (A28.2)."""
        return {"pub": self._pub_url(), "secret": self.join_secret}

    def _render_join(self) -> str:
        """`lan.qr` = `ws://<lan-ip>:<ws-port>/ws?s=<secret>[&pub=<url-encoded public ws_url>]`.

        Re-rendered whenever the ws URL, the secret or the public status changes, and the net is handed
        the same three values so `welcome.join` and the secret gate cannot drift from the printed QR."""
        base = self.lan.get("ws_url") or ""
        pub = self._pub_url()
        qr = base
        if base:
            qr = f"{base}{'&' if '?' in base else '?'}s={quote(self.join_secret, safe='')}"
            if pub:
                qr += f"&pub={quote(pub, safe='')}"
        self.lan["qr"] = qr
        self.lan["join_secret"] = self.join_secret
        setter = getattr(self.net, "set_join", None)
        if setter is not None:
            try:
                # `armed` is a CALLABLE, not `bool(pub)`: the QR only advertises a URL we can currently
                # use, but the secret gate must stay up for as long as the child process is routing --
                # including after its stdout dies and `status` has gone to `error`.
                setter(secret=self.join_secret, pub=pub, armed=self._gate_armed)
            except Exception:
                import logging; logging.getLogger("brx.mc").exception("net.set_join failed")
        return qr

    def _gate_armed(self) -> bool:
        """A28.2: is there a public path into the node socket right now? Read live off the Tunnel."""
        t = self.tunnel
        return bool(t is not None and t.armed)

    def attach_tunnel(self, tunnel) -> None:
        """A28.1: MC owns at most one tunnel; its status changes drive `lan.public`, the QR and the
        `join` broadcast."""
        self.tunnel = tunnel
        tunnel.on_change(self._tunnel_changed)
        self._tunnel_changed(tunnel.public())

    def _tunnel_changed(self, pub: dict) -> None:
        was = self._pub_url()
        self.lan["public"] = dict(pub)
        self._render_join()
        now = self._pub_url()
        if now != was:
            # A28.2: every connected node adopts the new `pub` and re-dials per A28.3. Best-effort, like
            # every other MC→node push: a node that misses it gets the same body in its next welcome.
            try:
                self.net.broadcast("join", self.join_body())
            except Exception:
                import logging; logging.getLogger("brx.mc").exception("join broadcast failed")
        self._changed()

    def _ws_port(self) -> int:
        p = getattr(self.net, "port", 0) or 0
        if p:
            return int(p)
        m = re.search(r":(\d+)", (self.lan.get("ws_url") or "").split("//")[-1])
        return int(m.group(1)) if m else 0

    async def set_tunnel(self, on: bool) -> dict:
        """`POST /api/tunnel` (A28.1). Returns `lan.public`; raises `TunnelError` (409) when there is
        nothing MC may start or stop."""
        t = self.tunnel
        if t is None:
            raise TunnelError("this Mission Control was built without tunnel support")
        if on:
            t.start(self._ws_port())
        else:
            await t.stop()
        return dict(self._public())

    def coverage(self) -> dict:
        """A28.4: coverage is DERIVED, not asserted — `"full"` iff every bound player node is connected
        with `reach == "backhaul"`.

        "Connected" is read as "not stale": that is the same freshness MC uses everywhere else, and it is
        what the operator is looking at on the board. A node that drops off the tunnel goes stale and
        coverage falls back to `"zones"` within `STALE_AFTER_MS` — one reconnect, exactly as A28.3
        describes."""
        bound = on = 0
        for nid, pid in self.node_player.items():
            if pid not in self.players:
                continue
            bound += 1
            nv = self.nodes.get(nid) or {}
            if nv.get("reach") == "backhaul" and not nv.get("stale"):
                on += 1
        return {"level": "full" if bound and on == bound else "zones", "on_backhaul": on, "bound": bound}

    # ---------- A10 loadout policy / catalog ----------
    def _catalog_rows(self) -> tuple[list[dict], list[dict]]:
        """(visible weapons, visible perks) — the rows the policy engine filters by tag."""
        try:
            weapons = [w for w in self.compiler.weapon_catalog() if isinstance(w, dict)]
        except Exception:
            weapons = []
        pc = getattr(self.compiler, "perk_catalog", None)
        try:
            perks = [r for r in pc()] if callable(pc) else []
        except Exception:
            perks = []
        return weapons, perks

    def policy(self) -> dict:
        pol = self.config.get("loadout_policy")
        if not pol:
            pol = self.config["loadout_policy"] = _policy.default_policy(self.config["mode"])
        return pol

    def loadout_pool(self) -> dict:
        weapons, perks = self._catalog_rows()
        return _policy.pool(self.policy(), weapons, perks)

    def health_pool(self, p: Player | None = None) -> int:
        """hp + armour a full-health player carries — what hits-to-kill is quoted against.

        Per-player `loadout.overrides` win over the game's `health`, exactly as `_gset` and
        `Compiler.validate()` read them, so the phone's stat block is the truth for THAT player.
        Field 2026-08-30 shipped a hardcoded 115 in `views.py`, so KIT and ARSENAL both claimed the
        AR takes 13 hits however the host had set health (docs/weapon-design.md §2.5).

        ⚠ This must mirror `Compiler._to_gc()`'s armour arithmetic EXACTLY — including the
        `body_armor` perk's `max_armor_add` and the 255 policy ceiling — because that is what
        actually goes out on `$PSET`. Review 2026-09-01 caught it missing the perk: a player holding
        `body_armor` is armed at a 165 pool while KIT quoted the AR at 13 hits / 1.68 s when the
        truth is 19 / 2.52 s. A stat block that is wrong for the one perk that moves the pool is
        worse than one that never claimed to be per-player. The arithmetic itself lives in
        `compile.armed_pool()` (shared with `_to_gc()` and `Compiler.validate()`); this method's
        own job is just resolving which hp/armor/perk win for THIS player."""
        h = self.config.get("health") or {}
        ov = ((p or {}).get("loadout") or {}).get("overrides") or {}

        def n(key: str, default: int) -> int:
            v = ov.get(key, h.get(key, default))
            try:
                return int(v)
            except (TypeError, ValueError):
                return default

        fx = {}
        if p is not None:
            try:
                fx = self.compiler._perk_effects(p)
            except Exception:      # a fake/older compiler has no perk model; the base pool still holds
                fx = {}
        from .compile import armed_pool                  # the one shared arithmetic (see docstring)
        return max(1, armed_pool(n("max_hp", 45), n("max_armor", 70), fx))

    def _catalog_views(self, p: Player | None = None) -> dict:
        """`assign.catalog` — what the phone browses (visible weapons as WeaponView + visible perks)."""
        from .views import weapon_views                  # one view builder for HTTP and the wire
        weapons, perks = self._catalog_rows()
        # `bars` need the whole arsenal; htk/ttk need this game's health pool
        return {"weapons": weapon_views(weapons, self.health_pool(p)), "perks": perks}

    def kit_open(self) -> bool:
        """A10 §4.1: phones may browse/pick/try only while the host is on KIT and the lobby is not pushed. Before
        that the HUD shows "Mission Control is setting up the game" (Tony, 2026-08-27)."""
        return self.phase == "kit" and not self.lobby_pushed

    def _assign_body(self, p: Player) -> dict:
        pol = _policy.node_view(self.policy(), self.loadout_pool())
        pol["kit_open"] = self.kit_open()
        return {"player": p, "team": self.team(p["team_id"]), "roster": self.roster(),
                "catalog": self._catalog_views(p), "policy": pol, "game": self.game_brief()}

    def _off_grid(self) -> list[str]:
        """A28/A31: the rostered players whose phone cannot be reached after the whistle, by display name.

        A phone is off-grid when it has no backhaul — no route to MC from wherever the match is being
        played — so an MC-decided end (a frag cap, an objective, a survival win) never reaches it and the
        player has to come back to find out how it ended.

        ⚠ TODO (A28): `backhaul` is the per-node boolean the A28 work adds to `status`/`NodeView`; nothing
        reports it yet. Until it does, a node that does not claim backhaul is treated as not having it,
        which is the safe direction (the warning appears; it never hides a phone that will miss the
        result). A player with no bound node at all is off-grid for the stronger reason: there is no
        phone to push anything to.
        """
        out: list[str] = []
        for p in self.players.values():
            nv = self.nodes.get(p.get("node_id") or "", {})
            if not p.get("node_id") or not nv.get("backhaul"):
                out.append(str(p.get("display") or p["player_id"]))
        return out

    def _mc_verify_player_line(self) -> str | None:
        """A31: the line every PLAYER sees on ARMED, or None. Compiled once in `compile.mc_verify`."""
        return _compile.mc_verify(self.config, None, bool(self._off_grid()))

    def _notices(self) -> dict:
        """A31: the HOST's standing lines (API.md `State.notices`). Same decision as the player's line —
        the compiler makes it once — but the host's copy NAMES the phones, because the host is the one
        who can walk over and tell those players to come back."""
        out: dict = {}
        off = self._off_grid()
        if self._mc_verify_player_line():
            shown = ", ".join(off[:6]) + (f" +{len(off) - 6} MORE" if len(off) > 6 else "")
            out["mc_verify"] = (f"WIN IS CONFIRMED AT MC · {len(off)} PHONE{'S' if len(off) != 1 else ''} OFF-GRID "
                                f"({shown}) · TELL PLAYERS TO RETURN AFTER THE WHISTLE")
        return out

    def game_brief(self) -> dict:
        """A10 §4.6: what the phone's BRIEFING screen shows — the chosen game in human terms. Saved-game name/desc
        when the live config matches one, else the stock mode; rules as short lines; the loadout rules as one line."""
        cfg = self.config
        mode = next((m for m in MODES if m["mode"] == cfg.get("mode")), None) or {}
        pol = self.policy()
        lp = self.loadout_pool()
        weapons, perks = self._catalog_rows()
        wname = lambda wid: next((w["name"] for w in weapons if w["weapon_id"] == wid), None) or next((k["name"] for k in perks if k.get("perk_id") == wid), wid)
        prim, sec = pol["primary"], pol["secondary"]
        parts = []
        if prim["choice"] == "fixed":
            parts.append(f"Everyone carries the {wname(prim.get('fixed_id'))}")
        else:
            n = len(lp["primary"])
            parts.append(("You pick your primary" if prim["choice"] == "player" and pol.get("hud_select") else "The host picks your primary") + (f" ({n} to choose from)" if prim["choice"] == "player" and pol.get("hud_select") else ""))
        if sec["choice"] == "off":
            parts.append("no secondary")
        elif sec["choice"] == "fixed":
            parts.append(f"everyone gets {wname(sec.get('fixed_id'))} in slot 2")
        else:
            kinds = [k for k in ("weapon", "sidearm") if k in sec.get("kinds", [])]
            if "weapon" in kinds:
                kinds = [k for k in kinds if k != "sidearm"]        # A12: "weapon" already includes the pistols
            what = " or ".join({"weapon": "a second weapon", "sidearm": "a sidearm"}[k] for k in kinds) or "nothing"
            parts.append(("slot 2: " + what) if pol.get("hud_select") and sec["choice"] == "player" else f"the host sets slot 2 ({what})")
        kr = pol.get("perk") or {"choice": "off"}                  # A14: the perk is its own slot
        if kr["choice"] == "off":
            parts.append("no perks")
        elif kr["choice"] == "fixed":
            parts.append(f"everyone gets {wname(kr.get('fixed_id'))}")
        else:
            n = len(lp["perks"])
            parts.append((f"a perk of your choice ({n})" if pol.get("hud_select") and kr["choice"] == "player" else "the host sets your perk"))
        preset_lbl = _policy.PRESET_LABELS.get(pol.get("preset"), "")
        saved = None
        try:
            if getattr(self, "presets", None) is not None:
                sig = {k: v for k, v in cfg.items() if k not in ("config_id", "vip_player_id")}   # A19: never in a saved game, so never in the match
                saved = next((r for r in self.presets.list() if {k: v for k, v in r["config"].items() if k != "config_id"} == sig), None)
        except Exception:
            saved = None
        return {
            "name": (saved or {}).get("name") or mode.get("name") or str(cfg.get("mode", "")).upper(),
            "desc": (saved or {}).get("desc") or mode.get("brief") or mode.get("desc") or "",
            "mode": cfg.get("mode"), "mode_name": mode.get("name"), "abbr": mode.get("abbr"),
            "teams_text": mode.get("teams_text"), "win_text": mode.get("win_text"), "respawn_text": mode.get("respawn_text"),
            "time_limit_s": cfg.get("time_limit_s"), "respawn": cfg.get("respawn"), "health": cfg.get("health"),
            "environment": cfg.get("environment"), "night": bool(cfg.get("night")),
            "loadout_line": ", ".join(parts) + ".", "ruleset": preset_lbl, "hud_select": bool(pol.get("hud_select")),
            # A31: present ONLY when this match needs it, so a node can treat presence as the rule.
            **({"mc_verify": mcv} if (mcv := self._mc_verify_player_line()) else {}),
        }

    def _sync_kit_open(self) -> None:
        """Re-send `assign` to every bound node when kit_open flips (phase/push transitions) so the HUD switches
        between "setting up" and the kit editor without waiting for an unrelated change."""
        cur = self.kit_open()
        if cur == getattr(self, "_kit_open_sent", None):
            return
        self._kit_open_sent = cur
        for pl in self.players.values():
            if pl.get("node_id"):
                self.net.push(pl["node_id"], "assign", self._assign_body(pl))

    def apply_policy(self) -> list[str]:
        """§3.3: force every loadout to obey the policy (fixed → set, off → cleared, out-of-pool → replaced).
        Returns the ids of the players whose loadout changed; each gets a fresh `assign` (and a re-push
        if the lobby was already pushed) exactly like a PATCH."""
        weapons, perks = self._catalog_rows()
        lp = self.loadout_pool()
        changed: list[str] = []
        for pl in self.players.values():
            new = _policy.apply(self.policy(), lp, pl.get("loadout") or {"weapons": []}, weapons, perks)
            if new != pl.get("loadout"):
                pl["loadout"] = new
                changed.append(pl["player_id"])
        for pid in changed:
            pl = self.players[pid]
            if pid in self.trying:                       # an in-flight try-out of a weapon the ruleset just took away
                self.tryout(pid, None)                   # → tutorial {end} teardown on the node
            self._resend(pl)
        if changed:
            label = _policy.PRESET_LABELS.get(self.policy().get("preset"), "THE LOADOUT RULES")
            try:
                if self.active_preset_id and getattr(self, "presets", None) is not None:
                    label = self.presets.get(self.active_preset_id)["name"].upper()
            except Exception:
                pass
            self._policy_notice = f"{len(changed)} LOADOUT{'S' if len(changed) != 1 else ''} RESET BY {label}"
        return changed

    def _prune_browsing(self) -> None:
        now = self.now_ms()
        for pid, t in list(self.browsing.items()):
            if now - t > 60_000 or pid not in self.players:
                self.browsing.pop(pid, None)

    def _all_ready(self) -> bool:
        return bool(self.players) and all(p.get("ready") for p in self.players.values())

    def _on_ready(self, pid: str, ready: bool) -> None:
        """Shared ready semantics (§4.4): ready ENDS that player's try-out (the gun must not stay armed with
        identity 0) and kit → lobby advances only when EVERY rostered player is ready."""
        p = self.players[pid]
        p["ready"] = ready
        if ready:
            self.browsing.pop(pid, None)
            if pid in self.trying:
                self.tryout(pid, None)
        if self.phase == "kit" and ready and self._all_ready():
            self.phase = "lobby"

    # ---------- roster ----------
    def _next_num(self) -> int:
        used = {p["player_num"] for p in self.players.values()}
        base = int(self.config.get("player_num_base") or 1)     # A6.5: disjoint ranges for concurrent games
        for n in range(max(1, min(base, MAX_PLAYERS)), MAX_PLAYERS + 1):
            if n not in used:
                return n
        raise ValueError("roster full")

    ROSTER_PHASES = ("muster", "build", "kit", "lobby")

    def _check_team(self, team_id):
        """A team_id must name one of config.teams (or be None); never park a player in an unknown team."""
        if team_id is None:
            return None
        if not any(t["team_id"] == team_id for t in self.teams):
            raise ValueError(f"unknown team_id {team_id!r}")
        return team_id

    def add_player(self, display: str, team_id: str | None = None, gun_id: str | None = None,
                   voice: str = "male", loadout: dict | None = None, voice_slots: dict | None = None) -> Player:
        if len(self.players) >= MAX_PLAYERS:
            raise ValueError("roster full")
        voice_slots = _voices.check_slots(voice_slots)      # A15: {role: id} $PSET picks; bad role / off-gun id -> ValueError
        if gun_id:
            for q in self.players.values():
                if (q.get("gun_id") or "").lower() == gun_id.lower():
                    raise ValueError(f"gun {gun_id} is already assigned to {q['display']}")
        pid = uuid.uuid4().hex[:8]
        team_id = self._check_team(team_id)
        if team_id is None and self.teams:
            counts = {t["team_id"]: 0 for t in self.teams}
            for p in self.players.values():
                if p["team_id"] in counts:
                    counts[p["team_id"]] += 1
            team_id = min(counts, key=lambda k: (counts[k], list(counts).index(k)))
        lo = self._check_loadout(loadout) if loadout else {"weapons": [{"weapon_id": "assault_rifle"}]}
        lo = _policy.apply(self.policy(), self.loadout_pool(), lo, *self._catalog_rows())   # §3.3: a new player obeys the ruleset
        p: Player = {"player_id": pid, "player_num": self._next_num(), "display": display.strip().upper() or f"OPERATOR {pid[:4]}",
                     "team_id": team_id, "node_id": None, "gun_id": gun_id,
                     "loadout": lo, "voice": voice, "ready": False}
        if voice_slots:
            p["voice_slots"] = voice_slots
        self.players[pid] = p
        if self.scorer and self.phase != "recap":
            # A5.6 late joiner: scorable in the RUNNING match. Never in a finished one -- registering
            # into the recap scorer put a 0/0 row for somebody who was not there into the archived
            # recap and the result every node is holding (round-2 review 2026-09-12).
            self.scorer.register_player(pid, p)
        if gun_id:
            self._adopt_node_for_gun(p)
        self._after_player_change(p, new=True)
        return p

    def patch_player(self, pid: str, **fields) -> Player:
        p = self.players[pid]
        if self.phase in ("armed", "live"):
            # Only the fields that would be COMPILED to the gun are refused. A mid-match re-team, a ready
            # flag and a gamertag ride in `assign` (roster/display) and never touch the head, so they stay.
            locked = [k for k in _KIT_FIELDS if k in fields and fields[k] is not None]
            if locked:
                raise ConflictError(_KIT_LOCKED_HOST.format(phase=self.phase.upper(), what="/".join(locked)))
        old_voice, old_display, old_slots = p.get("voice"), p.get("display"), dict(p.get("voice_slots") or {})
        if "player_num" in fields and fields["player_num"] is not None:
            if self.lobby_pushed:
                raise ValueError("player_num is fixed once config has been pushed")
            try:
                if isinstance(fields["player_num"], bool):
                    raise ValueError
                n = int(fields["player_num"])
                if isinstance(fields["player_num"], float) and fields["player_num"] != n:
                    raise ValueError
            except (TypeError, ValueError, OverflowError):
                raise ValueError("player_num must be an integer")
            fields["player_num"] = n
            if not 1 <= n <= MAX_PLAYERS:
                raise ValueError(f"player_num must be 1..{MAX_PLAYERS} (0 is reserved)")
            if any(q["player_num"] == n and q["player_id"] != pid for q in self.players.values()):
                raise ValueError("player_num already taken")
        if "team_id" in fields:
            fields["team_id"] = self._check_team(fields["team_id"])
        if "loadout" in fields and fields["loadout"] is not None:
            fields["loadout"] = self._check_loadout(fields["loadout"])
            weapons, perks = self._catalog_rows()
            ok, reason = _policy.validate_loadout(self.policy(), self.loadout_pool(), fields["loadout"], weapons, perks)
            if not ok:
                raise ValueError(reason)               # human copy — the UI shows it as-is (loadout.md §3.3)
        if "voice" in fields and fields["voice"] is not None:
            v = fields["voice"]
            if not isinstance(v, str) or v not in self._voice_ids():
                raise ValueError("unknown voice")
        if "voice_slots" in fields:
            fields["voice_slots"] = _voices.check_slots(fields["voice_slots"])   # A15; {} / null clears the picks
        if "ready" in fields and fields["ready"] is not None and not isinstance(fields["ready"], bool):
            raise ValueError("ready must be a boolean")
        if "display" in fields and fields["display"] is not None:
            d = str(fields["display"]).strip().upper()[:24]
            if not d:
                raise ValueError("display must not be empty")
            fields["display"] = d
        if fields.get("gun_id"):
            for q in self.players.values():
                if q["player_id"] != pid and (q.get("gun_id") or "").lower() == str(fields["gun_id"]).lower():
                    raise ValueError(f"gun {fields['gun_id']} is already assigned to {q['display']}")
        for k in ("display", "team_id", "voice", "loadout", "player_num", "gun_id", "ready"):
            if k in fields and fields[k] is not None or (k in fields and k in ("team_id", "gun_id")):
                p[k] = fields[k]
        if "voice_slots" in fields:
            if fields["voice_slots"]:
                p["voice_slots"] = fields["voice_slots"]
            else:
                p.pop("voice_slots", None)
        if "team_id" in fields and self.scorer and pid in self.scorer.stats:
            self.scorer.stats[pid].team_id = p["team_id"]   # team scores + friendly rule follow a mid-match re-team
        if "gun_id" in fields:
            self._adopt_node_for_gun(p)
        self._after_player_change(p)
        # A9.1 bench voice preview: if VOICE or the gamertag changed and the player has a bound node in a
        # pre-lobby phase, play a one-frame sample of the voice so the pick is audible on the tagger.
        if (p.get("voice") != old_voice or p.get("display") != old_display or dict(p.get("voice_slots") or {}) != old_slots) \
                and p.get("node_id") and self.phase in ("muster", "build", "kit"):
            self._push_voice_preview(p)
        return p

    def _push_voice_preview(self, p: Player) -> None:
        """A9.1: best-effort `apply{preview}` of the voice family's kill line so a VOICE/gamertag change is
        audible on the bound tagger. One $PLAY frame — the node's preview gate drops anything that isn't
        $PLAY/$SFLASH and ignores a preview once past LOBBY, so this is safe to fire optimistically."""
        nid = p.get("node_id")
        if not nid:
            return
        try:
            cue = self.compiler.cues(p.get("voice") or "male", p.get("voice_slots")).get("kill")
        except Exception:
            cue = None
        if cue:
            self.net.push(nid, "apply", {"preview": True, "frames": [cue]})

    def _voice_ids(self) -> set[str]:
        ids = {"male", "female"}
        opts = getattr(self.compiler, "voice_options", None)
        if callable(opts):
            try:
                ids |= {o.get("id") for o in opts() if isinstance(o, dict) and o.get("id")}
            except Exception:
                pass
        return ids

    def _check_loadout(self, lo) -> dict:
        """Loadout must be {weapons: [{weapon_id}] | [{primary}, {secondary}], perk?: perk_id, overrides?: {max_hp?, max_armor?}};
        ids from the catalog when known. A14: `perk` is its own slot beside the weapons (loadout.md §2); the one
        pairing the hardware forbids (an ALT-button perk + a second weapon) is a POLICY reject, not a shape error."""
        if not isinstance(lo, dict) or not isinstance(lo.get("weapons"), list) or not lo["weapons"]:
            raise ValueError("loadout must be {weapons: [{weapon_id}, ...]}")
        if len(lo["weapons"]) > 2:
            raise ValueError("loadout.weapons holds at most a primary and a secondary")
        known: set[str] = set()
        cat = getattr(self.compiler, "weapon_catalog", None)
        if callable(cat):
            try:
                known = {w.get("weapon_id") for w in cat() if isinstance(w, dict)}
            except Exception:
                known = set()
        weapons = []
        for w in lo["weapons"]:
            if not isinstance(w, dict) or not isinstance(w.get("weapon_id"), str) or not w["weapon_id"]:
                raise ValueError("each loadout weapon needs a weapon_id")
            if known and w["weapon_id"] not in known:
                raise ValueError(f"unknown weapon_id {w['weapon_id']!r}")
            weapons.append({"weapon_id": w["weapon_id"]})
        out: dict = {"weapons": weapons}
        perk = lo.get("perk")
        if perk is not None and perk != "":
            if not isinstance(perk, str):
                raise ValueError("loadout.perk must be a perk_id string or null")
            _, perks = self._catalog_rows()
            if perks and perk not in {r.get("perk_id") for r in perks}:
                raise ValueError(f"unknown perk_id {perk!r}")
            out["perk"] = perk                        # A14: a perk is its own slot — it rides beside a secondary weapon
        ov = lo.get("overrides")
        if ov is not None:
            if not isinstance(ov, dict):
                raise ValueError("loadout.overrides must be an object")
            clean = {}
            # armour may be 0 (the game config allows it: "0 means one-shot with a sniper"), so a
            # per-player override must be able to say 0 too, or the handicap can raise a pool but
            # never strip one. HP 0 is not a pool, it is a corpse.
            for k, lo_ in (("max_hp", 1), ("max_armor", 0)):
                if k in ov and ov[k] is not None:
                    if isinstance(ov[k], bool) or not isinstance(ov[k], int) or not lo_ <= ov[k] <= 999:
                        raise ValueError(f"overrides.{k} must be an integer {lo_}..999")
                    clean[k] = ov[k]
            if clean:
                out["overrides"] = clean
        return out

    def remove_player(self, pid: str) -> None:
        if self.phase not in self.ROSTER_PHASES:
            raise ValueError("cannot remove a player after the match has started")
        p = self.players.pop(pid)
        if p.get("node_id"):
            self.node_player.pop(p["node_id"], None)
        self.acks.pop(pid, None); self.bundles.pop(pid, None); self.trying.pop(pid, None); self.browsing.pop(pid, None)
        self._changed()

    def _resend(self, p: Player, with_start: bool = False) -> None:
        """Re-send `assign` to `p`'s node, plus a fresh `config` compile if the lobby is already
        pushed -- so a pick/policy change made after `push_config()` reaches the gun, not just the
        phone's browse screen. `with_start=True` also re-sends `start` when a match is running.

        Only `_after_player_change` passes `with_start=True`, and that asymmetry is CORRECT --
        investigated 2026-09-07 after a review suspected a post-`start()` loadout pick left the node
        "with a cleared ack and no schedule". Neither half holds, for reasons that live on the node:
        `engine.js` `_applyConfig()` keeps an armed/live phase and never touches `this.start`, so the
        schedule survives a config push; and the ack is cleared here on purpose (the node holds a new
        head it has not echoed -- calling it acked would be a lie) then restored by the node's own
        `ack_config` ~1.5 s later. Re-sending `start` would be a no-op anyway: `startAt()` returns
        `reason: 'noop'` for a repeat with the same seq and match_id.

        ⚠ ARMED/LIVE: the config leg is skipped for a node that has already TAKEN this match's config,
        because the kit is locked once a match starts (`KIT_LOCKED`, A30). `assign` still goes -- it is
        roster and display, it never reaches the gun -- and every caller that could change what is
        COMPILED refuses before it gets here, so that skip is a backstop, not a silent drop. A node that
        has NOT taken the config still gets it, plus the same `start`: that is the hot join (E5, see
        `_took_this_config`). Pinned by `tests/test_mc_loadout_after_start.py`."""
        if not p.get("node_id"):
            return
        self.net.push(p["node_id"], "assign", self._assign_body(p))
        if self.lobby_pushed and not (self.phase in ("armed", "live") and self._took_this_config(p)):
            self._push_config_to(p)
            if with_start and self.start_info:
                self.net.push(p["node_id"], "start", self._start_body())
        elif with_start and self.start_info:
            self.net.push(p["node_id"], "start", self._start_body())

    def _after_player_change(self, p: Player, new: bool = False):
        self._resend(p, with_start=True)
        self._validate()
        if self.phase in ("muster", "build") and new:
            self.phase = "kit"
        self._changed()

    def team(self, team_id: str | None) -> Team | None:
        return next((t for t in self.teams if t["team_id"] == team_id), None)

    def roster(self) -> list[dict]:
        return [{"player_id": p["player_id"], "player_num": p["player_num"], "display": p["display"], "team_id": p["team_id"]}
                for p in self.players.values()]

    def set_ready(self, pid: str, ready: bool, host_override: bool = False) -> Player:
        p = self.players[pid]
        nid = p.get("node_id")
        if ready and not host_override:
            nv = self.nodes.get(nid or "", {})
            if not nv.get("synced"):
                raise ValueError("node clock not synced — cannot ready")
        self._on_ready(pid, ready)                     # A10 §4.4: ends the try-out; all-ready advances
        self._changed()
        return p

    # ---------- config ----------
    def modes(self) -> list[dict]:
        # A18: `params` = the engine's own schema rows, so the Designer can render a mode's controls without a
        # second list of knobs living in the UI (the same rule `station_source` follows).
        return [{**m, "defaults": default_config(m["mode"]), "params": _params_schema_json(m["mode"])} for m in MODES]

    _CONFIG_KEYS = {"mode", "environment", "night", "time_limit_s", "respawn", "scoring",
                    "health", "teams", "led", "player_num_base", "loadout_policy", "presentation",
                    "station_source", "mode_params", "vip_player_id", "stun", "coverage"}

    def apply_preset(self, preset_id: str, config: dict) -> dict:
        """A10 §8: apply a saved game — same path as PUT /api/config, but the state remembers WHICH game is playing."""
        self.active_preset_id = preset_id
        try:
            return self.set_config(config, _from_preset=True)
        except Exception:
            self.active_preset_id = None
            raise

    def set_config(self, patch: dict, _from_preset: bool = False) -> dict:
        if not isinstance(patch, dict):
            raise ValueError("config must be an object")
        if not _from_preset and (set(patch) - {"environment", "night", "config_id"}):
            self.active_preset_id = None                     # any real edit means the draft is no longer that saved game
        if self.phase == "recap" and not (isinstance(patch, dict) and patch.get("mode")):
            # only an explicit MODE pick on Build (same mode = "run it back", or a new one) rolls the
            # finished session forward; other config edits from stale tabs get a clear error instead
            raise ValueError("match is over — pick a mode on Build (or press NEW MATCH) to roll the session; other config edits need a fresh session")
        if self.phase == "recap":
            # the match is OVER — a config change is the operator starting the next one (Tony,
            # 2026-08-26: "i get an error bc match in progress, but MC knows its over"). Roll the
            # session forward (roster kept, recap archived) instead of erroring.
            self.new_session(keep_roster=True)
        if self.phase not in ("muster", "build", "kit", "lobby"):
            raise ValueError("cannot change config after the match has started")
        mode = patch.get("mode", self.config["mode"])
        if not isinstance(mode, str) or mode not in {m["mode"] for m in MODES}:
            raise ValueError(f"unknown mode {mode!r}")
        if set(patch) - {"environment", "night", "config_id"}:     # a VENUE-only PUT (GAMES re-asserts it right after
            self._policy_notice = None                       # a saved game applies) must not eat the reset notice

        cfg = default_config(mode) if mode != self.config["mode"] else copy.deepcopy(self.config)
        if mode != self.config["mode"]:
            # A31/A4.8: the VENUE is a fact about the site, not about the game. `default_config()` knows
            # the mode's defaults and nothing about where you are standing, so picking a new mode used to
            # reset the venue keys to `outdoor`/day/partial. The UI re-sent `environment` and `night` in
            # the same patch and hid two thirds of it; `coverage` it did not, so a full-coverage site
            # silently became partial and the A31 verify-at-MC warning appeared out of nowhere. Anything
            # the patch itself names still wins -- this only fills what the swap would have dropped.
            for k in ("environment", "night", "coverage"):
                if k not in patch and k in self.config:
                    cfg[k] = copy.deepcopy(self.config[k])
        cfg = self._merge_config(cfg, patch, mode)
        cfg["config_id"] = uuid.uuid4().hex[:8]
        self.config = cfg
        self.teams = list(cfg["teams"])
        for p in self.players.values():
            if p["team_id"] not in {t["team_id"] for t in self.teams}:
                p["team_id"] = self.teams[0]["team_id"] if self.teams else None
        if self.phase == "muster":
            self.phase = "build"
        if self.lobby_pushed:
            self.lobby_pushed = False
            self.acks = {}
        self.apply_policy()                                  # §3.3: every loadout obeys the (new) ruleset
        res = self._validate()
        self._changed()
        return {"ok": res["ok"], "errors": res["errors"], "config": self.config}

    def sanitize_config(self, raw: dict) -> GameConfig:
        """A10 §8: the PUT /api/config validator as a pure function — a stored preset config is rebuilt from the
        mode's defaults + every known key of `raw` (unknown keys dropped, bad values raise ValueError). No session
        state is touched. `config_id` is stripped (assigned fresh on apply)."""
        if not isinstance(raw, dict):
            raise ValueError("config must be an object")
        mode = raw.get("mode", "tdm")
        if not isinstance(mode, str) or mode not in {m["mode"] for m in MODES}:
            raise ValueError(f"unknown mode {mode!r}")
        cfg = self._merge_config(default_config(mode), raw, mode)
        cfg.pop("config_id", None)
        cfg.pop("vip_player_id", None)       # A19: a saved game names no person; the VIP is picked per session
        return cfg

    def _merge_config(self, cfg: dict, patch: dict, mode: str) -> dict:
        """Whitelist + range-check every key of `patch` onto `cfg` (A8.3). Pure; raises ValueError."""
        for k, v in patch.items():
            if k not in self._CONFIG_KEYS:
                continue                         # ignore unknown / client-injected keys
            if k == "time_limit_s":
                if v is not None and not (isinstance(v, int) and not isinstance(v, bool) and 1 <= v <= 7200):
                    raise ValueError("time_limit_s must be an integer 1..7200 or null")
                cfg[k] = v
            elif k == "environment":
                if v not in ("indoor", "outdoor"):
                    raise ValueError("environment must be indoor|outdoor")
                cfg[k] = v
            elif k == "night":
                cfg[k] = bool(v)
            elif k == "coverage":
                # A31/A4.8: the venue's radio coverage. "full" is an ASSERTION the operator makes about
                # the site (every phone on the LAN the whole match) and it unlocks a null `time_limit_s`
                # and suppresses the verify-at-MC warning, so it is spelled exactly or refused.
                if v is not None and v not in ("full", "partial"):
                    raise ValueError("coverage must be full|partial or null")
                if v is None:
                    cfg.pop(k, None)
                else:
                    cfg[k] = v
            elif k in ("respawn", "scoring", "health"):
                if not isinstance(v, dict):
                    raise ValueError(f"{k} must be an object")
                merged = {**cfg[k], **v}
                if k == "respawn":
                    if merged.get("type") not in ("auto", "scanner", "none"):
                        raise ValueError("respawn.type must be auto|scanner|none")
                    d = merged.get("delay_s", 0)
                    if not (isinstance(d, int) and not isinstance(d, bool) and 0 <= d <= 600):
                        raise ValueError("respawn.delay_s must be 0..600")
                    # F34 (2026-09-07): 0 is the sentinel for "unset / no respawn" (respawn.type ==
                    # "none", e.g. Last Man Standing's default) and stays valid. 1-2 s is the one range
                    # actually forbidden: F13 (bench) wedges the headset in the relay's out-blink when
                    # $SPAWN lands within ~2 s of death (2.5 s measured clean) -- so every value strictly
                    # between "off" and "safe" is rejected rather than silently building a match that
                    # sticks headsets all night.
                    if d in (1, 2):
                        raise ValueError("respawn.delay_s of 1-2s wedges the headset in the relay's "
                                         "out-blink (F13); use 0 (no respawn) or >= 3")
                if k == "scoring":
                    fl = merged.get("frag_limit")
                    if fl is not None and not (isinstance(fl, int) and not isinstance(fl, bool) and fl > 0):
                        raise ValueError("scoring.frag_limit must be a positive integer or null")
                if k == "health":
                    for hk in ("max_hp", "max_armor"):
                        hv = merged.get(hk, 0)
                        lo = 1 if hk == "max_hp" else 0
                        if not (isinstance(hv, int) and not isinstance(hv, bool) and lo <= hv <= 255):
                            # 255 is a POLICY ceiling, not a hardware one -- $PSET pools are
                            # wider than 8 bits (bench 2026-08-27, see FOLLOWUPS/experiment-log).
                            raise ValueError(f"health.{hk} must be {lo}..255")
                cfg[k] = merged
            elif k == "teams":
                if not (isinstance(v, list) and all(isinstance(t, dict) and "team_id" in t
                                                   and isinstance(t.get("tid"), int) and not isinstance(t.get("tid"), bool) for t in v)):
                    raise ValueError("teams must be a list of team objects with team_id + integer tid")
                # F35 (bench 2026-09-07): the IR word's team field is 2 bits -- a gun armed on $TID 4-7
                # transmits tid&3 while the victim compares its own FULL tid, so teammates on either
                # side of that split damage each other and a tid>=4 player's shots can read as a lower,
                # friendly team to everyone else. Only 0-3 are valid team ids; the COLOUR painted for a
                # team (0-7, `poolgauge.display_colour`) is a separate, unaffected lookup.
                bad = [t["tid"] for t in v if t["tid"] not in _pg.TEAM_TIDS]
                if bad:
                    raise ValueError(f"team tid(s) {sorted(set(bad))} outside 0-3 (F35): the IR word's "
                                     f"team field is 2 bits -- a $TID of 4 or higher makes teammates "
                                     f"damage each other and can let a gun read its own shots as friendly")
                # 🔴 F82, and this was the LAST open route into it (operator review 2026-09-10). A hill
                # mode's config was allowed to CONTAIN a tid-2 team as long as nobody was on it yet --
                # `validate()` scans the roster, so an empty yellow team passed and the push succeeded.
                # The Lobby then renders every config team as a drop target, and one drag re-compiles
                # and re-pushes `$TID,2` from `_after_player_change` -> `_resend` BEFORE `_validate`
                # runs, leaving only an advisory error on a screen the operator has already left. So the
                # team must not EXIST in a hill config: refused here, roster or not.
                # F97: and it cannot have FOUR teams either -- with tid 2 gone, 0 / 1 / 3 are all a hill
                # mode has, so a four-player free-for-all hill is three players and a pair. Checked
                # before F82 so the operator is told the real limit rather than "use tid 0, 1 or 3",
                # which no fourth single-member team can obey.
                if mode in OBJECTIVE_MODES and len({t["tid"] for t in v}) > 3:
                    raise ValueError(
                        f"F97: mode {mode!r} supports at most three teams (tids 0, 1 and 3): a neutral "
                        f"hill broadcasts team {_NEUTRAL_TEAM} and the IR team field is 2 bits, so a "
                        "fourth player has to share a team -- an FFA hill caps at three players")
                if mode in OBJECTIVE_MODES and any(t["tid"] == _NEUTRAL_TEAM for t in v):
                    raise ValueError(
                        f"F82: mode {mode!r} cannot have a team on $TID {_NEUTRAL_TEAM} at all — that "
                        "is the value a NEUTRAL grenade hill broadcasts, so anyone put on it later reads "
                        "every uncaptured point as their own and takes no hill damage. Use tid 0, 1 or 3.")
                cfg[k] = v
            elif k == "led":
                if v is not None and not isinstance(v, dict):
                    raise ValueError("led must be an object")
                cfg[k] = v
            elif k == "station_source":
                # F70: what is on the field emitting this game's objective. A CLOSED vocabulary --
                # the compiler used to accept any non-empty string, so a typo shipped a hill mode
                # with nothing emitting anything. `null` clears it (and `validate()` then refuses
                # the push for a station-gated mode, naming the valid values).
                if v is not None and v not in STATION_SOURCES:
                    raise ValueError("station_source must be null or one of: "
                                     + ", ".join(f"{k2} ({d})" for k2, d in sorted(STATION_SOURCES.items())))
                if v is None:
                    cfg.pop(k, None)
                else:
                    cfg[k] = v
            elif k == "mode_params":
                # A18 (E1): the mode's own rules, checked against what ITS ENGINE declares (`modes/params.py`).
                # A partial patch merges onto the current values; what is stored is the COMPLETE resolved set
                # (defaults filled), so the wire config is self-describing. An unknown key or an out-of-range
                # value is refused in the operator's voice -- never dropped or clamped.
                if v is None:
                    v = {}
                if not isinstance(v, dict):
                    raise ValueError("mode_params must be an object (the mode's parameters, GET /api/modes .params)")
                merged = {**(cfg.get("mode_params") or {}), **v}
                resolved, errs = _validate_mode_params(mode, merged)
                if errs:
                    raise ValueError("; ".join(errs))
                if resolved:
                    cfg[k] = resolved
                else:
                    cfg.pop(k, None)             # a mode with no parameters carries no key at all
            elif k == "vip_player_id":
                # A19 (S10): who the VIP is. Roster membership is `validate()`'s to check (this merge is pure);
                # here only the shape. `null` clears it.
                if v is not None and not (isinstance(v, str) and v):
                    raise ValueError("vip_player_id must be a player_id string or null")
                if v is None:
                    cfg.pop(k, None)
                else:
                    cfg[k] = v
            elif k == "stun":
                # F15 / A20: `{duration_s?}` enables the EMP row; range and the source warning are `validate()`'s
                # (`compile._validate_stun`). `null` clears it. Until 2026-09-11 this key was not in
                # `_CONFIG_KEYS`, so a PUT dropped it in silence and no game could stun over MC.
                if v is not None and not isinstance(v, dict):
                    raise ValueError("stun must be an object {duration_s} or null (F15/A20)")
                if v is None:
                    cfg.pop(k, None)
                else:
                    cfg[k] = dict(v)
            elif k == "player_num_base":
                if not (isinstance(v, int) and not isinstance(v, bool) and 1 <= v <= MAX_PLAYERS):
                    raise ValueError("player_num_base must be 1..63")
                cfg[k] = v
            elif k == "loadout_policy":
                # A10 §3: a preset name rewrites the rules; a rule edit that matches no preset → custom
                cfg[k] = _policy.merge(cfg.get("loadout_policy") or _policy.default_policy(mode), v)
            elif k == "presentation":
                # A11: a preset name replaces the profile; a field edit marks it custom; bad ids/colours raise
                cfg[k] = _pres.merge(cfg.get("presentation") or _pres.default_for(mode), v)
            elif k == "config_id":
                continue                                     # never client-set; minted by set_config
            else:
                cfg[k] = v
        return cfg

    def _validate(self) -> dict:
        try:
            # A28.4: the DERIVED coverage rides on every validation (and so on the lobby push, which
            # calls this). `venue_coverage` — the assertion that would lift `time_limit_s` — is
            # deliberately NOT passed: nothing sets it today (compile.validate's docstring).
            res = self.compiler.validate(self.config, list(self.players.values()),
                                         {"coverage": self.coverage()["level"]})
        except Exception as e:  # a broken compiler must not take MC down
            res = {"ok": False, "errors": [f"validate failed: {e}"]}
        self.config_errors = list(res.get("errors", []))
        self.config_warnings = list(res.get("warnings", []))
        self.config_warnings.extend(self._station_warnings())
        if self._policy_notice:
            self.config_warnings.append(self._policy_notice)     # A10: the host sees the overwrite
        return res

    # ---------- utility stations (A13.5 / F104) ----------
    def _game_byte(self) -> int:
        """The advert `game` byte: 1..255, never 0 (0 = "any game", the v1 no-scoping value)."""
        return ((self.game_no - 1) % 255) + 1

    def _next_game_no(self) -> None:
        """Called by `push_config`: if a match has STARTED on the current number, this push is a new match.
        Bumping here rather than at start means a station armed at muster carries the right number before
        the whistle, and a station that missed the muster (out of Wi-Fi) gets it on its next hello."""
        if self._game_no_started:
            self.game_no += 1
            self._game_no_started = False

    def _station_ids(self) -> list[dict]:
        return sorted(({"id": a["id"], "kind": a["kind"]} for st in self.stations.values() if (a := st.get("assigned"))),
                      key=lambda x: x["id"])

    def _wire_config(self) -> GameConfig:
        """The config a NODE receives: the operator's config plus `stations`, the allow-list of station ids MC
        armed for this game (contracts A13.1). Never written into `self.config` -- it is derived, and the
        operator does not edit it."""
        ids = self._station_ids()
        if not ids:
            return self.config
        return {**self.config, "stations": ids}

    def _station_warnings(self) -> list[str]:
        """What the objective / respawn rules need on the FIELD that the ITEMS panel has not assigned.
        Advisory (a station may be armed by hand behind the phone's seven-tap gate) but loud, because a
        station-gated game with no station is the F104 failure mode: nothing on the field, nothing said."""
        out: list[str] = []
        kinds = {a["kind"] for st in self.stations.values() if (a := st.get("assigned"))}
        if self.config.get("station_source") == "phone" and "control" not in kinds:
            out.append("SETUP: NO CONTROL-POINT PHONE IS ASSIGNED — this game's objective is a phone (station_source "
                       "phone); assign a utility phone as CONTROL in ITEMS and arm it, or nothing on the field is the hill")
        if (self.config.get("respawn") or {}).get("type") == "scanner" and "respawn" not in kinds:
            out.append("SETUP: NO RESPAWN STATION IS ASSIGNED — respawn is SCANNER, so a downed player can only come "
                       "back at a station; assign a utility phone as RESPAWN in ITEMS and arm it")
        return out

    def set_station(self, nid: str, a: dict) -> dict:
        """The operator's ITEMS assignment for one utility phone: kind / team / id / threshold. Validated in
        the same voice as `set_config`, stored, and pushed as `station_config` at once (utility.md §5b.1)."""
        if not isinstance(a, dict):
            raise ValueError("assignment must be an object")
        self._refuse_station_change_in_play()
        kind = a.get("kind")
        if kind not in STATION_KINDS:
            raise ValueError(f"kind must be one of {', '.join(STATION_KINDS)}")
        team = a.get("team", STATION_TEAM_ANY)
        if isinstance(team, str):
            t = next((t for t in self.config.get("teams", []) if t.get("team_id") == team), None)
            if team in ("any", "ffa"):
                team = STATION_TEAM_ANY
            elif t is None:
                raise ValueError(f"team {team!r} is not a team_id in this game (or 'any')")
            else:
                team = int(t["tid"])
        if not (isinstance(team, int) and not isinstance(team, bool)) or not (team in (0, 1, 2, 3) or team == STATION_TEAM_ANY):
            raise ValueError("team must be a $TID 0-3, a team_id, or 'any' (255)")
        # A team-scoped station serves only the players on that $TID (`engine.js _stationAllowed` admits
        # `e.team === TEAM_ANY || e.team === tid`), so a tid nobody in this game is on -- or the F82 neutral
        # broadcast in a hill mode -- is a station that silently serves nobody (polish review 2026-09-11).
        game_tids = {int(t["tid"]) for t in self.config.get("teams", []) if "tid" in t}
        if team != STATION_TEAM_ANY and team not in game_tids:
            raise ValueError(f"team $TID {team} is not one of this game's teams ({sorted(game_tids) or 'none yet'}); "
                             "a station on it would serve nobody -- pick a team in the game, or 'any'")
        if kind == "control" and team != STATION_TEAM_ANY:
            raise ValueError("a control point starts NEUTRAL and is taken by presence (spec/utility.md §5d): team must be 'any'")
        sid = a.get("id")
        if not (isinstance(sid, int) and not isinstance(sid, bool) and 1 <= sid <= 65535):
            raise ValueError("id must be an integer 1..65535 (the station id in the advert)")
        clash = next((n for n, st in self.stations.items() if n != nid and (st.get("assigned") or {}).get("id") == sid), None)
        if clash:
            raise ValueError(f"station id {sid} is already assigned to {clash}; ids must be unique on the field")
        thr = a.get("threshold", -74)
        if not (isinstance(thr, int) and not isinstance(thr, bool) and -100 <= thr <= -30):
            raise ValueError("threshold must be an integer dBm in -100..-30 (the presence bubble; -74 ≈ 10 ft at high TX)")
        # Only a phone that said hello as a UTILITY node can be a station. A player's HUD ignores
        # `station_config`, and assigning it would advertise a station id to every player that nothing
        # on the field emits (review 2026-09-11).
        if nid not in self.stations and (self.nodes.get(nid) or {}).get("node_type") != "utility":
            raise ValueError(f"{nid!r} is not a utility phone (no utility hello this session); open the app in the "
                             "UTILITY role on that phone and connect it to Mission Control first")
        st = self.stations.setdefault(nid, {"node_id": nid, "assigned": None, "report": {}, "armed": None})
        st["assigned"] = {"kind": kind, "team": team, "id": sid, "threshold": thr, "at": self.now_ms()}
        self.nodes.setdefault(nid, {"node_id": nid, "node_type": "utility", "arm_state": "idle", "synced": False, "last_seen_ms": 0})
        # An assignment changes the allow-list every OTHER station echoes, so all of them are re-armed.
        self.arm_stations()
        self._repush_stations_to_players()
        self._validate()
        self._changed()
        return self._station_view(nid)

    def clear_station(self, nid: str) -> bool:
        st = self.stations.get(nid)
        if not st:
            return False
        self._refuse_station_change_in_play()
        st["assigned"] = None
        st["armed"] = None
        self.arm_stations()                    # the survivors' valid_ids shrink
        self._repush_stations_to_players()
        self._validate()
        self._changed()
        return True

    def _refuse_station_change_in_play(self) -> None:
        """An assignment or clear is a `config` re-push to every player (below), and the phone's
        `_applyConfig` rewrites the gun head and sets `spawned = false` whatever the phase -- on a LIVE gun
        that silences every hit and death handler for the rest of the match (polish review 2026-09-11).
        So the ITEMS panel is a muster/lobby control: once a start is scheduled it is refused in the
        operator's voice rather than quietly re-arming the field."""
        if self.phase in ("armed", "live"):
            raise ValueError(f"the match is {self.phase.upper()}: a station cannot be assigned or cleared now "
                             "(every player would be re-armed mid-game). RECALL or END first, or wait for the recap")

    def _repush_stations_to_players(self) -> None:
        """After a lobby push the players already HOLD a `config.stations`; an assignment made after that
        (a re-id, a late station, a cleared one) must reach them or `engine.js _stationAllowed` keeps
        filtering on the old list and nobody can respawn or capture at the new id (review 2026-09-11).
        The bundle is NOT recompiled and the acks are NOT cleared -- the frames are unchanged, only the
        config's allow-list moved. LOBBY only: `lobby_pushed` stays True through armed and live, and a
        `config` to a live gun re-arms it (see `_refuse_station_change_in_play`)."""
        if not self.lobby_pushed or self.phase != "lobby":
            return
        cfg = self._wire_config()
        roster = self.roster()
        for p in self.players.values():
            nid, pid = p.get("node_id"), p["player_id"]
            if nid and pid in self.bundles:
                self.net.push(nid, "config", {"config": cfg, "frames": self.bundles[pid], "roster": roster})

    def _arm_station(self, nid: str) -> bool:
        """Push `station_config` to one assigned station. Best-effort: an offline phone is flagged
        `arm_pending` (roadmap A4 "bring back to re-arm") and armed on its next hello, never retried on a timer."""
        st = self.stations.get(nid)
        a = st.get("assigned") if st else None
        if not a:
            return False
        body = {"kind": a["kind"], "team": a["team"], "id": a["id"], "threshold": a["threshold"],
                "game": self._game_byte(), "valid_ids": [x["id"] for x in self._station_ids()]}
        ok = self.net.push(nid, "station_config", body)
        if ok is False:                        # NetServer says "no live socket"; a fake returns None
            st["arm_pending"] = True
            return False
        st["arm_pending"] = False
        st["armed"] = {"game": body["game"], "at": self.now_ms(), "kind": a["kind"], "team": a["team"], "id": a["id"]}
        return True

    def arm_stations(self) -> dict:
        """Re-arm every assigned station with the current game number and allow-list."""
        armed = [nid for nid in self.stations if self._arm_station(nid)]
        pending = [nid for nid, st in self.stations.items() if st.get("assigned") and st.get("arm_pending")]
        return {"armed": len(armed), "pending": pending}

    def _station_view(self, nid: str) -> dict:
        st = self.stations[nid]
        now = self.now_ms()
        seen = st.get("last_seen_ms")
        a = st.get("assigned")
        armed = st.get("armed")
        rep = st.get("report") or {}
        attention: list[str] = []
        if a and st.get("arm_pending"):
            attention.append("BRING IT BACK TO RE-ARM")            # assignment changed with the phone out of range
        if a and armed and armed.get("game") != self._game_byte():
            attention.append("ARMED FOR AN OLDER GAME")            # it missed the muster push
        # The phone's own report only contradicts the arming if it arrived AFTER the push -- the heartbeat
        # from before an assignment naturally says "not armed" / the old id (review 2026-09-11).
        fresh = bool(armed) and seen is not None and seen > (armed.get("at") or 0)
        if a and fresh and rep.get("armed") is False:
            attention.append("PHONE SAYS NOT ARMED")               # the push was sent; the phone never applied it
        if a and fresh and rep.get("station_id") not in (None, a["id"]):
            attention.append(f"PHONE ADVERTISES ID {rep.get('station_id')}, ASSIGNED {a['id']}")
        if isinstance(rep.get("battery"), (int, float)) and rep["battery"] < 30:
            attention.append("BATTERY LOW")
        return {"node_id": nid, "assigned": a, "armed": armed, "arm_pending": bool(st.get("arm_pending")),
                "report": rep, "app_ver": st.get("app_ver"), "platform": st.get("platform"),   # A29
                "last_seen_ms": (now - seen) if seen else None,
                "online": bool(seen) and (now - seen) <= OFFLINE_AFTER_MS,
                "attention": attention, "game": self._game_byte()}

    def stations_view(self) -> list[dict]:
        return [self._station_view(nid) for nid in sorted(self.stations)]

    def _scorer_recap(self) -> dict:
        """THE recap: the scorer's sheet plus the stations rows (A6). Every call site goes through here -- the
        late-fact re-store (`_restore_recap`) used to call `scorer.recap()` bare, so the first fact after END
        (the outbox flush, i.e. the normal case) silently dropped `stations` from `last_recap` and the DB row
        (polish review 2026-09-11)."""
        return self.scorer.recap(stations=self._recap_stations())

    def _recap_stations(self) -> list[dict]:
        """Roadmap A6: a stations row for the recap sheet, one per ASSIGNED station, from its own
        self-authoritative heartbeat (utility.md §5c/§5d.6 -- a station answers to nobody mid-match, so
        this is the only place its count is ever seen). `heard` (True once at least one heartbeat has
        landed in `report`) is set on EVERY row regardless of kind -- a station of a kind with no count
        of its own (extraction/powerup/bomb) still needs to say "reported" vs "never heard from"
        (review 2026-09-11, Finding 1: the UI had nothing to render for those kinds and a silent station
        looked identical to a reporting one). `revives` for a respawn point, `hold_ms`/`owner` from
        `report.control` for a control point; a station never heard from reports what it can -- `None`,
        not a fabricated zero, so the recap can tell "zero revives" from "never heard"."""
        out: list[dict] = []
        for row in self.stations_view():
            a = row.get("assigned")
            if not a:
                continue
            rep = row.get("report") or {}
            rec = {"node_id": row["node_id"], "kind": a["kind"], "id": a["id"], "team": a["team"],
                   "heard": bool(rep)}
            if a["kind"] == "respawn":
                rec["revives"] = rep.get("revives")
            elif a["kind"] == "control" and isinstance(rep.get("control"), dict):
                rec["hold_ms"] = rep["control"].get("hold_ms")
                rec["owner"] = rep["control"].get("owner")
            out.append(rec)
        return out

    # ---------- nodes ----------
    def _on_disconnect(self, nid: str):
        """A28.3: the socket is gone, so its PATH is gone with it -- `coverage()` must not keep counting
        a phone as on backhaul until it goes stale STALE_AFTER_MS later. `NodeRecord.view()` already
        nulls `reach` on a dead socket, but the snapshot is built from THESE dicts and never consults
        that view, so nulling it there alone would have been dead code (the F33/F40 shape)."""
        nv = self.nodes.get(nid)
        if nv is not None and nv.pop("reach", None) is not None:
            self._changed()

    def _touch(self, nid: str, stale: bool | None = None):
        nv = self._node_view(nid)
        if stale is not None:
            nv["stale"] = stale
        self._changed()

    def _find_player_for_gun(self, gun_name: str | None, gun_tail: str | None) -> Player | None:
        if not gun_name and not gun_tail:
            return None
        base = (gun_name or "").rsplit("-", 1)[0].lower()
        tail = (gun_tail or (gun_name or "").rsplit("-", 1)[-1]).lower()
        full = (gun_name or "").lower()
        for p in self.players.values():
            gid = (p.get("gun_id") or "").lower()
            if not gid:
                continue                      # a gun-less roster entry never matches (an empty name would equal "")
            g = self.guns.get(p.get("gun_id") or "")
            _sticker = g["sticker"].lower() if g else ""
            if g and (((base and _sticker == base) and not _sticker.startswith("tactix")) or (tail and g["ble"].get("tail", "").lower() == tail)):
                return p
            if gid in {x for x in (base, full) if x}:
                return p
        for p in self.players.values():
            gid = (p.get("gun_id") or "").lower()
            if gid and tail and gid == tail:  # device-first claim: gun_id may be just the tail —
                return p                      # SECOND pass: an exact registry match always wins first
        return None

    def _adopt_node_for_gun(self, p: Player):
        """Roster changed after nodes said hello: bind any connected node whose reported gun resolves to THIS
        player — same matcher as the hello path (sticker base, armory tail, or full gun id). Bench 2026-08-25: a
        phone holding `Tactix-XXXX` was left unbound when a gun (matched by its armory tail) was added afterwards."""
        for nid, nv in list(self.nodes.items()):
            name, tail = nv.get("gun_name") or "", nv.get("gun_tail") or ""
            if not (name or tail):
                continue
            q = self._find_player_for_gun(name or None, tail or None)
            if q is not None and q["player_id"] == p["player_id"]:
                self._bind(nid, p)

    def _bind(self, nid: str, p: Player):
        old = self.node_player.get(nid)
        if old and old != p["player_id"] and old in self.players:
            self.players[old]["node_id"] = None
        for q in self.players.values():
            if q.get("node_id") == nid and q["player_id"] != p["player_id"]:
                q["node_id"] = None
        prev = p.get("node_id")
        if prev and prev != nid:
            if self.scorer:
                self.scorer.rebind_node(p["player_id"])      # A6.2 hot-swap shots baseline
            if self.node_player.get(prev) == p["player_id"]:
                self.node_player.pop(prev, None)             # the old node no longer speaks for this player
            if prev in self.nodes:
                self.nodes[prev].pop("player_id", None)
        self.node_player[nid] = p["player_id"]
        p["node_id"] = nid
        self._node_view(nid)["player_id"] = p["player_id"]
        if self.phase in ("kit", "lobby", "armed") and self.nodes.get(nid, {}).get("synced"):
            self.synced_at_lobby[nid] = True   # same pre-live gate as _on_status (A5.7)
        # A5.6 late joiner: a node binding a player after the lobby push gets its bundle (+ the running start) now.
        # Mid-match too: a node that never took this match's config HOT JOINS on it (contracts §5 `start`,
        # node.md M-START E5). A30's lock is about a gun already in play, and this path DECIDES it rather
        # than letting `_push_config_to` raise: a node that acked this config or reports itself armed/live
        # is bound and left alone, no config and no start. Round-2 review 2026-09-12 -- everything above
        # has already run by the time we get here (the node rebound, the previous holder cleared, the
        # scorer rebased), so an exception escaping from HERE leaves a half-bound node, and the route is
        # real: a bundle-less player added mid-match adopting a phone that is already playing.
        if self.lobby_pushed and p["player_id"] not in self.bundles and not self._took_this_config(p):
            self._push_config_to(p)
            if self.start_info:
                self.net.push(nid, "start", self._start_body())

    def evict_node(self, nid: str) -> bool:
        """Operator recovery: kick a node (e.g. a stranger that hello'd with a live gun name before its owner's phone).
        Closes its socket, unbinds its player and forgets everything it claimed (ready/ack) so the next legit hello
        re-hydrates by gun (A5.5). Returns False for an id nobody has heard of."""
        known = nid in self.nodes or nid in self.node_player or nid in getattr(self.net, "nodes", {})
        if hasattr(self.net, "evict"):
            self.net.evict(nid)
        pid = self.node_player.pop(nid, None)
        for p in self.players.values():
            if p.get("node_id") == nid or p["player_id"] == pid:
                p["node_id"] = None
                p["ready"] = False
                self.acks.pop(p["player_id"], None)
        self.nodes.pop(nid, None)
        self.synced_at_lobby.pop(nid, None)
        if (self.stations.pop(nid, None) or {}).get("assigned"):
            # An assigned station left with its id still in every other station's `valid_ids` and every
            # HUD's `config.stations` (polish review 2026-09-11): shrink both, as `clear_station` does.
            self.arm_stations()
            self._repush_stations_to_players()
            self._validate()
        self._changed()
        return known

    def _prune_unbound_nodes(self):
        """Drop hello-only node records that never bound a player (net.md §8 memory). Any unbound record
        silent for >10 min goes — the old count-gated rule let phantom phones pile up on the Armory board
        for hours (15 of them on the bench, 2026-08-26)."""
        now = self.now_ms()
        for nid in [n for n, _ in self.nodes.items() if n not in self.node_player]:
            if (self.stations.get(nid) or {}).get("assigned"):
                continue                       # A13.5: an assigned station is placed, not phantom
            if now - self.nodes[nid].get("last_seen_ms", 0) > 600_000:
                self.nodes.pop(nid, None)
                self.stations.pop(nid, None)

    def _node_view(self, nid: str) -> dict:
        """The ONE place a player `NodeView` is created, so it always has its defaults.

        It used to be created by whichever handler ran first, each with its own dict literal, and the
        order is not the one it looks like: `_hydrate` fires BEFORE `_on_node` (net.py answers the
        hello first), so `_note_version`'s `setdefault` pre-created the node and `_on_node`'s
        `{"arm_state": "idle", "synced": False}` silently never applied. A node that said hello and
        then went quiet had NO `arm_state` and NO `synced` at all, and the board read them as absent
        rather than as the idle, unsynced phone it is (`API.md` NodeView says both are always there).
        """
        nv = self.nodes.setdefault(nid, {"node_id": nid})
        nv.setdefault("node_type", "phone")
        nv.setdefault("arm_state", "idle")
        nv.setdefault("synced", False)
        nv.setdefault("last_seen_ms", 0)
        return nv

    def _on_node(self, n: dict):
        nid = n["node_id"]
        # A25: a hello is a NEW socket. Any `pull_log` we sent the old one never landed, so the ask
        # stops being outstanding here -- before the `reconnect` trigger below decides to make a new one.
        self._log_asked.discard(nid)
        nv = self._node_view(nid)
        nv.update({k: v for k, v in n.items() if k in ("node_type", "gun_name", "gun_tail", "fw", "reach", "reach_claimed")})
        self._note_version(nid, n.get("app_ver"), n.get("platform"))   # A29
        nv["last_seen_ms"] = self.now_ms()
        if n.get("node_type") == "utility":
            # F106(c): the SAME node_id said hello as a player once (a phone switched OUT of the HUD role
            # on the field) -- `node_player`/the player's `node_id` must not keep pointing at a socket that
            # is now a station, or a later push (`config`, `start`, `control`) is sent to a utility phone
            # that silently drops it, and the player looks bound but hears nothing.
            pid = self.node_player.pop(nid, None)
            if pid and (pl := self.players.get(pid)) and pl.get("node_id") == nid:
                pl["node_id"] = None
                pl["ready"] = False                # as `evict_node`: kit->lobby must not advance on a phone that is now a station
                self.acks.pop(pid, None)
            # A13.5: a station phone. No gun, never bound; if the operator already assigned it, this hello
            # (first contact, or a reconnect after a reboot) is what arms it -- with the CURRENT game number,
            # which is how a station that missed the muster push still resets for the new match.
            st = self.stations.setdefault(nid, {"node_id": nid, "assigned": None, "report": {}, "armed": None})
            st["last_seen_ms"] = nv["last_seen_ms"]
            st["app_ver"] = n.get("app_ver") or st.get("app_ver")
            st["platform"] = nv.get("platform") or st.get("platform")   # A29: stations report the same way
            if st.get("assigned"):
                self._arm_station(nid)
            self._changed()
            return None
        # The gun the node reports NOW wins over a hydrate-era player_id (a re-bind to another gun moves the node).
        p = self._find_player_for_gun(n.get("gun_name"), n.get("gun_tail")) if (n.get("gun_name") or n.get("gun_tail")) else None
        if p is None and n.get("player_id") in self.players:
            p = self.players[n["player_id"]]
        if p:
            self._bind(nid, p)
        # A25 `reconnect`: this node's log for the LAST match never arrived. A phone that was out of
        # coverage at the whistle (or whose upload was cut off mid-stream) comes back minutes later and
        # this hello is the only moment we know it is reachable again -- so ask once, here.
        if self._log_match and self._log_done.get(nid) != self._log_match:
            self.pull_log(nid, "reconnect")
        self._prune_unbound_nodes()
        self._changed()
        return self.node_player.get(nid)

    def _hydrate(self, hello: dict) -> dict | None:
        # A29: `net.py _fire_node` forwards `app_ver` but not `platform`, and this callback is the one
        # place the WHOLE hello body reaches the session -- capture both here, before any early return,
        # so a utility phone and an unbound player node are covered too.
        if hello.get("node_id"):
            self._note_version(str(hello["node_id"]), hello.get("app_ver"), hello.get("platform"))
        if hello.get("node_type") == "utility":
            return None                        # A13.5: a station is never a player, whatever it remembers
        gun = hello.get("gun") or {}
        p = self._find_player_for_gun(gun.get("name"), gun.get("tail"))
        if not p:
            pid = self.node_player.get(hello.get("node_id", ""))
            p = self.players.get(pid) if pid else None
        if not p:
            return None
        self._bind(hello["node_id"], p)
        node = self._assign_body(p)                          # A10: welcome carries catalog + policy too
        if self.lobby_pushed:
            if p["player_id"] not in self.bundles:          # A5.6 late joiner hydrated on first hello
                self.bundles[p["player_id"]] = self._compile_rolled(p)
                self.acks.pop(p["player_id"], None)
            node["config"] = self._wire_config()
            node["frames"] = self.bundles[p["player_id"]]
        if self.start_info:
            node["start"] = self._start_body()
            node["match_id"] = self.start_info["match_id"]
        if self.scorer:
            rows = self.scorer.rows()
            row = next((r for r in rows if r["player_id"] == p["player_id"]), None)
            if row:
                node["score"] = dict(row, board=self._score_board(), rows=rows)   # same shape as the live push: the swapped phone's DOWN recap has the race
        if self.phase == "recap" and self.last_recap and self._played_this_match(p["player_id"]):
            # A24: a phone that comes back into coverage AFTER the whistle still learns how it ended —
            # the only route to a result for a node that was off the LAN when `_finish` pushed it.
            # A player added DURING the debrief was not in it, so there is no result to carry.
            node["result"] = self._result_body(self.last_recap, p)
        return node

    def _on_status(self, nid: str, body: dict, t_recv: int):
        nv = self._node_view(nid)
        nv.update({k: body.get(k) for k in ("arm_state", "synced", "preflight", "battery", "fw", "hp", "armor", "ammo", "alive", "t_minus_ms", "shots", "dropped", "pending") if k in body})
        # A28.3: `reach` is NOT taken from the status body. It feeds `coverage()` (which can gate a whole
        # mode) and the readiness amber (which un-blocks a start), so a client-asserted value would let a
        # phone claim its way past both. MC stamps it from the socket in `net._hello_gate`; the node's
        # own claim is kept beside it, unused, so a disagreement is visible instead of silent.
        if "reach" in body:
            nv["reach_claimed"] = body.get("reach")
        nv["last_seen_ms"] = t_recv
        nv["stale"] = False
        # A32: when this node's BLE link to the gun was last (re)established, as the heartbeats tell it.
        # A gun with no headset holds a link for only ~6 s, so the DURATION of the link is the proof --
        # `readiness()` reads this, not the instantaneous flag. A false or missing `gun_linked` resets it,
        # so a drop un-proves the headset and a re-link has to earn it again.
        if ((nv.get("preflight") or {}).get("gun_linked")) is True:
            nv.setdefault("gun_linked_since", t_recv)
        else:
            nv.pop("gun_linked_since", None)
            # …and the ECHO proof goes with it. `headset = "proven"` set by an `ack_config` gun echo was
            # never cleared, so A32's "falls back to unknown when the link drops" did not apply to a gun
            # that had answered once: the operator could switch the headset off, watch GUN LINK LOST go
            # red, and still read HEADSET · CONNECTED beside it. The echo proves the head answered THEN;
            # the link is the only thing that proves it is still on (round-2 review 2026-09-12).
            nv.pop("headset", None)
        self._note_version(nid, body.get("app_ver"), body.get("platform"))   # A29: the heartbeat carries it too
        if (parsed := self._parse_log_status(body.get("log"))) is not None:  # A25: the node's own log state
            self._set_log(nid, parsed[0], reason=parsed[1])
        # A8 + polish review 2026-09-11: a STATUS body never changes what a BOUND node IS. A player HUD that
        # (however it happened) sends `role: utility` used to be re-typed here without being unbound, so END /
        # PANIC skipped it (`_control` skips utility nodes) and `_finish` pulled no log from it -- a HUD silenced
        # by one status field. Only the utility HELLO (`_on_node`) may turn a node into a station; a bound
        # node's station-shaped heartbeat is ignored as a station report.
        if body.get("role") == "utility" and nid in self.node_player and nv.get("node_type") != "utility":
            self._log(nid, "status", {"ignored": "role: utility from a BOUND player node -- a hello, not a status, changes a node's type"}, t_recv)
        elif body.get("role") == "utility" or nv.get("node_type") == "utility":
            # A13.5: the station heartbeat is the ITEMS panel's whole data source and, for a control point,
            # the self-authoritative recap (owner / progress / hold_ms / capture log, utility.md §5c). The
            # player whitelist above dropped every one of these fields, so nothing MC showed came from a station.
            st = self.stations.setdefault(nid, {"node_id": nid, "assigned": None, "report": {}, "armed": None})
            st["report"] = {k: body.get(k) for k in ("kind", "team", "station_id", "threshold", "live", "revives",
                                                     "armed", "control", "battery") if k in body}
            st["last_seen_ms"] = t_recv
            if body.get("app_ver"):                # roadmap A3: the heartbeat, not just the hello, keeps this fresh
                st["app_ver"] = body["app_ver"]
            if body.get("platform"):
                st["platform"] = body["platform"]
            nv["node_type"] = "utility"
        # A8: the server's binding is authoritative — a status body's player_id never rebinds a node.
        if self.phase in ("kit", "lobby", "armed") and body.get("synced"):
            self.synced_at_lobby[nid] = True   # any node synced before it goes live keeps its own t (A5.7)
        self._log(nid, "status", body, t_recv)
        if self.scorer:
            self.scorer.ingest_status(nid, body, t_recv)
        self._changed()

    def _on_event(self, nid: str, ev: dict, t_recv: int):
        seq = (ev.pop("_seq", None) if isinstance(ev, dict) else None) or (ev.get("seq") if isinstance(ev, dict) else None)
        self._node_view(nid)["last_seen_ms"] = t_recv
        parked = bool(self.scorer and ev.get("match_id") != self.scorer.match_id) or not self.scorer
        self._log(nid, ev.get("type", "event"), ev, t_recv, seq=seq, parked=parked)
        if not parked and ev.get("type") == "respawn":
            # A19: a respawn clears every held role on the node (engine.js) -- the VIP is still the VIP.
            pid = self.node_player.get(nid)
            if pid and pid == self.config.get("vip_player_id"):
                self._queue_role(pid, "vip", True)
        if self.scorer:
            self.scorer.ingest(nid, ev, t_recv, seq=seq)
            self._flush_pending_limit()   # a cap deferred by a batch never waits on the NEXT batch
            self._reconcile_end(nid, [ev], t_recv)   # A24/M2: a late fact can move the END itself
            self._restore_recap()
            self._push_scores()
            self._changed()

    def ingest_batch(self, nid: str, events: list[dict], t_recv: int):
        self._node_view(nid)["last_seen_ms"] = t_recv
        for ev in events:
            self._log(nid, ev.get("type", "event"), ev, t_recv, seq=ev.get("seq"),
                      parked=not self.scorer or ev.get("match_id") != self.scorer.match_id)
        if self.scorer:
            # F124 (polish review 2026-09-12): the cap callback fires from INSIDE this loop, so ending the
            # match there snapshotted the recap (`store.match_ended`) and pushed the victory cue while the
            # rest of the batch was still being scored — two deaths on the same millisecond, one batch, and
            # the stored recap (and the winner it names) was taken from a half-ingested batch. The end
            # FREEZE is still taken at the winning kill, inside the loop (so the A6.1 rule is unchanged and
            # a later fact in the batch still parks as post_end); only the finish waits for the batch.
            self._batch_depth += 1
            try:
                self.scorer.ingest_batch(nid, events, t_recv)
                if any(ev.get("match_id") == self.scorer.match_id for ev in events):   # no SYNC POINT for an all-parked batch
                    self.scorer.sync_point(t_recv, sum(1 for s in self.scorer.stats.values() if s.flushed), len(self.players))
            finally:
                # Round-2 review 2026-09-12: the flush belongs INSIDE the `finally`. The freeze is taken
                # at the winning kill; if a later event in the batch raised, the deferred finish was
                # simply dropped and nothing else ever flushed it — a scorer frozen by A6.1 (no fact can
                # score again) under a phase stuck on `live`. `tick()` and the single-event path flush it
                # too, so a cap left pending by any route is finished by the next thing that happens.
                self._batch_depth -= 1
                self._flush_pending_limit()
            self._reconcile_end(nid, events, t_recv)  # A24/M2: the store-and-forward flush is the CASE
            self._restore_recap()
            self._push_scores()
            self._changed()

    def _restore_recap(self) -> None:
        """Re-write the stored recap when a fact lands AFTER the match ended.

        `_finish()` wrote it once. Facts held in a node's store-and-forward outbox arrive later — that
        is the whole point of the outbox — and they updated the live scorer but never the stored row,
        so the archive drifted from reality. Measured on real sessions: one match stored 4 kills / 38
        hits against 126 `hit_taken` and 12 deaths on the wire; another matched exactly, because
        nothing arrived late. The RECAP history picker serves these rows, so an archived match was
        showing understated scores (review 2026-09-01).
        """
        if self.phase != "recap" or not self.scorer:
            return
        try:
            self.last_recap = self._scorer_recap()
            if self.store:               # the ARCHIVE row; the live recap above is re-taken either way
                self.store.match_ended(self.scorer.match_id, self.last_recap)
            self._push_result()          # A24: the field is re-told whenever the recap moves
        except Exception:
            import logging
            logging.getLogger("brx.mc").exception("late-fact recap re-store failed (play continues)")

    def _push_scores(self):
        """A7: push each player's ScoreRow to its node when it changed (best-effort; only reaches nodes in coverage)."""
        if not self.scorer:
            return
        plist = self.players.values() if isinstance(self.players, dict) else self.players
        by_pid = {p["player_id"]: p for p in plist}
        rows = self.scorer.rows()
        for row in rows:
            pid = row["player_id"]; p = by_pid.get(pid)
            if not p or not p.get("node_id"):
                continue
            body = dict(row); body["shots_total"] = self.scorer.shots_total(pid)
            body["board"] = self._score_board()     # the race to the cap, for the HUD's DOWN-screen recap (review 2026-09-03 #25/#26)
            body["rows"] = rows                     # A24: EVERY player's row, all modes — the phone's mid-match leaderboard
            if self._score_pushed.get(pid) == body:
                continue
            self._score_pushed[pid] = body
            self.net.push(p["node_id"], "score", body)

    # ---------- A24: the match result reaches EVERY node, losers included ----------
    def _as_played(self, p: Player) -> Player:
        """The recipient AS THE FIELD WORE THEM (A24/M2 round-2 review).

        `_replay` was already fixed to score `_match_players`, the roster frozen at the whistle — but
        the RESULT still read the live one, so the same late flush could hand yellow the win and tell
        the player who won it `outcome: "lose"`, because the operator had moved them to blue for the
        next match. Which side a recipient wore is a fact about the match that was played.
        """
        if self._match_players is None:
            return p
        return self._match_players.get(p["player_id"], p)

    def _played_this_match(self, pid: str) -> bool:
        """Was this player on the roster at the whistle? A player ADDED during the debrief was being
        pushed a win or a loss for a match they were standing in the car park for (and `add_player`
        registered them into the finished scorer, growing the archived recap a 0/0 row). They get no
        `result` at all -- the HUD's neutral "no result for you" state, contracts §5 `result`."""
        return self._match_players is None or pid in self._match_players

    def _outcome_for(self, winner: dict, p: Player) -> str:
        """"win" | "lose" | "draw" | "undecided", FOR THIS RECIPIENT (A24).

        The node never infers this: silence means "you lost" and "your phone dropped off the LAN"
        identically (game test 2026-09-11 D3), so MC is the only thing that may say the word.
        The recipient's team is read AS PLAYED (`_as_played`), never as the debrief has it.
        """
        p = self._as_played(p)
        if not winner or winner.get("undecided"):
            return "undecided"
        tie = winner.get("tie")
        if tie:
            mine = p["player_id"] if self.config.get("mode") == "ffa" else p.get("team_id")
            return "draw" if mine in tie else "lose"
        if winner.get("team_id") is not None:
            return "win" if p.get("team_id") == winner["team_id"] else "lose"
        if winner.get("player_id") is not None:
            return "win" if p["player_id"] == winner["player_id"] else "lose"
        return "undecided"

    def _result_team_scores(self, recap: dict) -> list[dict]:
        """`[{team_id, name, score}]` for the results screen. TEAM modes only — in FFA there are no teams
        and `rows` is already the leaderboard, so this is `[]` rather than three players wearing a team
        shape (which is what `score.board` does, for a different job: the DOWN screen's race to the cap)."""
        if self.config.get("mode") == "ffa":
            return []
        totals = recap.get("score") or {}
        names = {t["team_id"]: str(t.get("name") or t["team_id"]) for t in self.teams}
        return [{"team_id": tid, "name": names.get(tid, tid), "score": sc} for tid, sc in totals.items()]

    def _result_body(self, recap: dict, p: Player) -> dict:
        """The `result` envelope for ONE player (contracts §5 `result`)."""
        p = self._as_played(p)                   # the side, the name and the row AS PLAYED, not as edited
        winner = recap.get("winner") or {}
        rows = recap.get("rows") or []
        roster = self._match_players if self._match_players is not None else self.players
        display = {pl["player_id"]: pl.get("display") for pl in roster.values()}
        body = {
            "match_id": self.scorer.match_id if self.scorer else None,
            "outcome": self._outcome_for(winner, p),
            "winner": winner,
            "mode": self.config.get("mode"),
            "win_by": (self.config.get("scoring") or {}).get("win_by"),
            "team_scores": self._result_team_scores(recap),
            "rows": rows,
            "my": next((r for r in rows if r["player_id"] == p["player_id"]), None),
            # `display` is the PLAYER's name, so a phone can render the honours roll without the roster.
            "honors": [{"medal": h.get("award"), "player_id": h.get("player_id"),
                        "display": display.get(h.get("player_id")) or h.get("player_id"), "stat": h.get("stat")}
                       for h in (recap.get("honors") or [])],
            "provisional": bool(recap.get("provisional")),
            "t": self.now_ms(),
        }
        for k in ("possession", "after_end"):
            if recap.get(k) is not None:
                body[k] = recap[k]
        return body

    def _push_result(self) -> int:
        """A24: push `result` to every BOUND player node, best-effort, and again whenever it changes.

        Sent at `_finish()` and re-sent on every late fact that moves the recap — including the A24/M2
        reconciliation, where the winner itself can change minutes after the whistle. De-duplicated on
        the body MINUS `t` (the timestamp moves on every call and would defeat the compare), so a node
        that is already holding the current result is not re-told; a node out of coverage simply misses
        the push and picks the result up from `welcome.node.result` when it comes back.
        """
        if not self.scorer or not self.last_recap:
            return 0
        sent = 0
        # The FROZEN roster decides who is told; the LIVE one says where to send it (a phone that
        # rebound to a different socket in the debrief is still that player's node).
        roster = self._match_players if self._match_players is not None else self.players
        for pid in roster:
            p = self.players.get(pid)
            if not p or not p.get("node_id"):
                continue
            body = self._result_body(self.last_recap, p)
            key = {k: v for k, v in body.items() if k != "t"}
            if self._result_pushed.get(p["player_id"]) == key:
                continue
            self._result_pushed[p["player_id"]] = key
            self.net.push(p["node_id"], "result", body)
            sent += 1
        return sent

    # ---------- A24/M2: the recap as a REPLAY of the stored facts ----------
    _FACT_KINDS = ("hit_taken", "death", "respawn", "team_change", "possession")

    def _match_facts(self, match_id: str) -> list[dict]:
        """Every persisted fact for this match, in EFFECTIVE-t order (the order it should have been
        scored in, not the order it arrived in). `store.events` returns insertion order, and the sort
        is stable, so two facts on the same millisecond keep their arrival order.

        ⚠ Known gap: an `event_batch` from a NEVER-SYNCED node is re-based once per flush (A5.7,
        `offset = t_recv - t_newest`) and the store keeps no batch grouping, so on replay those facts
        fall back to `t_recv` — the same approximation the live path makes for a single event from such
        a node. Their window awards are suppressed either way.
        """
        if not self.store:
            return []
        try:

            # The `kind` filter is SQL: a 10-minute match's envelope table is mostly `status`
            # heartbeats, and reading them back meant a `json.loads` per heartbeat, twice per late
            # death, only to discard them here.
            rows = self.store.events(match_id=match_id, kinds=self._FACT_KINDS)
        except Exception:
            import logging
            logging.getLogger("brx.mc").exception("store read failed (recap left as scored live)")
            return []
        facts = [r for r in rows if r.get("kind") in self._FACT_KINDS and isinstance(r.get("body"), dict)]
        def eff(r):
            t, tr = r.get("t"), r.get("t_recv") or 0
            return t if (t is not None and self.synced_at_lobby.get(r.get("node_id"), False)) else tr
        return sorted(facts, key=eff)

    def _replay(self, facts: list[dict], freeze_at: int | None = None) -> Scorer:
        """Re-derive a Scorer for THIS match from stored facts. Pure: no feedback, no alerts, no feed,
        no cap callback — a replay must never re-fire a cue at a player standing in the debrief.

        Every constructor argument comes from the scorer being replaced, not from `self.config`: the
        operator can edit the draft config during recap, and the match that was played does not change
        when they do. The ROSTER is the frozen copy taken at the whistle for the same reason —
        `old.players` IS `self.players`, so a re-team made in the debrief would otherwise replay the
        finished match on the new teams and hand the win to a side that never held it.
        """
        old = self.scorer
        sc = Scorer(old.match_id, old.go_live_t, old.time_limit_s, old.mode,
                    self._match_players if self._match_players is not None else old.players,
                    list(old.teams.values()), old.node_player, old.synced_at_lobby,
                    now_ms=self.now_ms, win_by=old.win_by, frag_limit=old.frag_limit)
        if freeze_at is not None:
            sc.set_end(freeze_at)
        for r in facts:
            sc.ingest(r["node_id"], dict(r["body"]), r.get("t_recv") or 0, seq=r.get("seq"))
        return sc

    def _adopt_scorer(self, sc: Scorer) -> None:
        """Swap a replayed Scorer in for the live one, carrying the state facts cannot re-derive.

        `shots` arrives on the ~2 s status heartbeat and is a LATEST-WINS sample, not an event log, so
        the old scorer's copy is the only one there is — replaying it would mean re-ingesting every
        status envelope to land on the same number. `flushed` is sticky for the same reason: a node
        marked flushed by `_mark_flushed_live` (connected, fresh, nothing pending) never sent a fact to
        prove it, and losing that mark would make a settled recap provisional again.
        """
        old = self.scorer
        for pid, st in sc.stats.items():
            o = old.stats.get(pid)
            if o is None:
                continue
            for f in ("shots", "shots_baseline", "shots_t", "last_status_t", "alive", "hp", "armor", "deadline_s"):
                setattr(st, f, getattr(o, f))
            st.flushed = st.flushed or o.flushed
        sc.mismatched = old.mismatched
        # Facts for ANOTHER match (a phone still flushing the previous one) never reach the replay --
        # `_match_facts` reads this match_id only -- so the count the recap reports would reset to 0.
        sc.parked = list(old.parked)
        # The replay ran with no callbacks (it must never re-fire a cue at a player in the debrief).
        # The scorer that comes OUT of it is the LIVE one again: everything that lands from here on is
        # a fact arriving now, and it has to reach the operator's feed and the match-state alerts the
        # same way it would have before the reconcile. `on_feedback` stays age-gated inside the Scorer
        # (`FEEDBACK_MAX_AGE_MS`), so a fact flushed minutes late still cues nobody's gun.
        sc.on_feed = self._on_feed
        sc.on_alert = self._alert
        sc.on_feedback = lambda pid, body: self._feedback(pid, body)
        sc.on_limit = lambda t, _sc=sc: self._on_frag_limit(t, _sc)
        self.scorer = sc

    def _reconcile_end(self, nid: str, events: list[dict], t_recv: int) -> bool:
        """A24/M2: a fact landed after the whistle that can move the END ITSELF. Re-derive everything.

        The match ends at the TIMESTAMP of the kill that reached the cap — not when MC learned of it.
        A phone that was out of coverage can flush minutes late and reveal that somebody ELSE reached
        the cap EARLIER, which moves the end backwards and means every kill MC scored after that moment
        must be un-scored. That cannot be patched onto a running tally, so the recap is a pure function
        of (the stored facts, the end rule) and this re-runs it: find the cap in a clean pass, freeze a
        second pass at it, check for a dead heat, adopt the result.

        Only a frag cap has a movable end. A host END and a time limit are moments the whole field
        lived through, and A6.1 keeps their whistle exactly where it was.
        """
        if self.phase != "recap" or not self.scorer or not self.store or self.end_reason != "frag_limit":
            return False
        end_t = self.scorer.end_t
        if end_t is None:
            return False
        # A death inside the scored window can move the cap EARLIER; one inside the clock band just
        # after the end can reveal a DEAD HEAT (`check_cap_tie`). Anything later than that changes
        # neither, and is already reported as an after-the-whistle fact.
        if not any(ev.get("type") == "death" and self.scorer.eff_t(nid, ev, t_recv) <= end_t + CLOCK_TIE_MS
                   for ev in events if isinstance(ev, dict)):
            return False
        facts = self._match_facts(self.scorer.match_id)
        if not facts:
            return False
        probe = self._replay(facts)              # no freeze: where does the cap fall on ALL the facts?
        cap_t = probe.limit_reached_t
        if cap_t is None:                        # the cap no longer stands (it cannot un-happen; be safe)
            return False
        if cap_t > end_t:
            # Contracts §4: the end may move EARLIER only. A late friendly-fire death inside the tie
            # band SUBTRACTS a kill, so the re-derived cap can fall LATER than the whistle the field
            # already heard -- and adopting it would promote facts the live scorer parked as post-end
            # into the official tally, minutes after everyone was told `control{end}`. Leave the end
            # where it was; the late fact stays an after-the-whistle fact (round-2 review 2026-09-12).
            return False
        sc = self._replay(facts, freeze_at=cap_t)
        sc.cap_tie = sc.check_cap_tie(CLOCK_TIE_MS)
        before = (self.scorer.winner(), end_t)
        self._adopt_scorer(sc)
        if cap_t < end_t:
            moved = (end_t - cap_t) / 1000.0
            self._on_feed({"t_match_s": max(0, (cap_t - sc.go_live_t) // 1000), "tag": "RESCORED", "kind": "alert",
                           "text": f"END MOVED BACK {moved:.1f}s — a late flush shows the cap was reached earlier. "
                                   f"Everything after that moment is un-scored and reported as after the whistle"})
        if before[0] != sc.winner():
            self._on_feed({"t_match_s": max(0, (cap_t - sc.go_live_t) // 1000), "tag": "RESCORED", "kind": "alert",
                           "text": "THE WINNER CHANGED on re-scored facts — the field has been re-told the result"})
        return True

    def _score_board(self) -> dict:
        """Team totals + the frag cap; in FFA the top three players stand in for teams."""
        cap = (self.config.get("scoring") or {}).get("frag_limit")
        if self.config.get("mode") == "ffa":
            top = sorted(self.scorer.rows(), key=lambda r: -r["kills"])[:3]
            return {"teams": [{"team_id": "ffa", "name": r["display"], "score": r["kills"]} for r in top], "cap": cap}
        totals = self.scorer.team_scores()
        names = {t["team_id"]: str(t.get("name") or t["team_id"]).replace(" TEAM", "") for t in self.teams}
        return {"teams": [{"team_id": tid, "name": names.get(tid, tid), "score": sc} for tid, sc in totals.items()], "cap": cap}

    def _on_node_message(self, nid: str, kind: str, body: dict, t_recv: int):
        self._node_view(nid)["last_seen_ms"] = t_recv
        pid = self.node_player.get(nid)   # authoritative binding, not a client-supplied player_id
        if kind == "ready" and pid in self.players:
            self._on_ready(pid, bool(body.get("ready")))     # A10 §4.4
        elif kind == "loadout_request" and pid in self.players:
            self._on_loadout_request(nid, pid, body)
        elif kind == "loadout_browse" and pid in self.players:
            if body.get("open"):
                self.browsing[pid] = t_recv
            else:
                self.browsing.pop(pid, None)
        elif kind == "ack_config" and pid in self.players:
            self.acks[pid] = {"ok": bool(body.get("ok")), "gun_echo": body.get("gun_echo"), "err": body.get("err")}
            if body.get("ok") and body.get("gun_echo"):
                self.nodes[nid]["headset"] = "proven"
        elif kind == "event_batch":
            self.ingest_batch(nid, body.get("events", []), t_recv)
            return
        elif kind == "log_offer":
            # A25: the node is telling us what it holds. Record it, then ask (gated by `log_sync` and
            # by the ~1 MB per-node budget, both inside `pull_log`).
            self._set_log(nid, "offered",
                          reason=body.get("reason") if isinstance(body.get("reason"), str) else None,
                          lines=body.get("lines") if isinstance(body.get("lines"), int) else None,
                          nbytes=body.get("bytes") if isinstance(body.get("bytes"), int) else None)
            self.pull_log(nid, "offer")
        elif kind == "log_data":
            self._log_asked.discard(nid)          # A25: the node is answering; the ask is no longer outstanding
            n = len(str(body.get("chunk", "")))
            self._log_bytes[nid] = self._log_bytes.get(nid, 0) + n
            # A25: only a COMPLETE `last`-terminated stream counts as delivered -- a half-uploaded log
            # that the node abandoned mid-match must still read as owed, or the `reconnect` ask never
            # fires for exactly the node that needs it.
            if body.get("last"):
                self._set_log(nid, "complete", nbytes=self._log_bytes.get(nid, 0))
                self._log_done[nid] = self._log_match
            else:
                self._set_log(nid, "pulling", nbytes=self._log_bytes.get(nid, 0))
        self._log(nid, kind, body, t_recv)
        self._changed()

    def set_phase(self, phase: str, force: bool = False) -> str:
        """`POST /api/phase`. Two guards: the SOURCE phase, and A27's KIT → LOBBY.

        The destination check was never enough. `armed` and `live` are not phases a route may leave
        either: `{phase: "kit"}` from LIVE used to succeed, and `tick()` returns early unless the phase
        is `armed`/`live`, so the match could never reach its timed end — it just sat there while the
        field played on with no whistle coming. Ending a running match is `control{end}` (A30 is the
        same rule for the kit), so this is a 409: correct request, not now.

        Everything a player carries is compiled at the lobby push, so advancing past KIT while somebody
        is still choosing takes their half-made kit into the match (loadout.md §4.4 -- the node says so
        in its own words). The host may still do it deliberately; `force` is that deliberate second tap."""
        if phase not in PHASES or phase in ("armed", "live", "recap"):
            raise ValueError("phase must be one of muster|build|kit|lobby (armed/live/recap are driven by start/end)")
        if self.phase in ("armed", "live"):
            raise ConflictError(
                f"the match is {self.phase.upper()} — end it (control END) before moving the session back to "
                f"{str(phase).upper()}; `force` does not apply")
        if phase == "lobby" and self.phase == "kit" and not force:
            not_ready = [p.get("display") or p["player_id"] for p in self.players.values() if not p.get("ready")]
            if not_ready:
                greens = len(self.players) - len(not_ready)
                raise NotReadyError(
                    f"{len(not_ready)} of {len(self.players)} are not READY: {', '.join(not_ready)}",
                    not_ready, greens, len(self.players))
        self.phase = phase
        self._changed()
        return self.phase

    # ---------- A25 background log sync / A29 versions ----------
    def set_option(self, key: str, value: Any) -> dict:
        """`PUT /api/options`. Unknown keys and out-of-table values are a 400, not a silent no-op --
        an option the operator set and MC quietly ignored is the F40 shape."""
        if key not in OPTION_DEFAULTS:
            raise ValueError(f"unknown option {key!r}")
        allowed = OPTION_VALUES.get(key)
        if allowed and value not in allowed:
            raise ValueError(f"{key} must be one of {'|'.join(allowed)}")
        self.options[key] = value
        self._changed()
        return dict(self.options)

    def _log_sync_auto(self) -> bool:
        return self.options.get("log_sync", "auto") == "auto"

    def pull_log(self, nid: str, reason: str = "manual") -> bool:
        """Ask ONE node for its log (contracts A25 `pull_log {reason}`). Returns whether the ask went out.

        Refused for a utility phone (F106(d): a station never binds a match, so its log holds nothing
        about one), for a node past the ~1 MB budget, and -- for every reason but `manual` -- when
        `log_sync` is `"manual"`. The NODE decides when to answer; MC never waits on it."""
        if reason not in PULL_REASONS:
            raise ValueError(f"pull_log reason must be one of {'|'.join(PULL_REASONS)}")
        nv = self.nodes.get(nid)
        if nv is None or nv.get("node_type") == "utility":
            return False
        if reason != "manual" and not self._log_sync_auto():
            return False
        if reason != "manual" and nid in self._log_asked:
            return False                                  # one outstanding automatic ask per node
        if self._log_bytes.get(nid, 0) >= 1_000_000:      # the existing per-MATCH cap
            return False
        try:
            self.net.push(nid, "pull_log", {"reason": reason})
        except Exception:
            return False
        if reason != "manual":
            self._log_asked.add(nid)
        return True

    def _set_log(self, nid: str, state: str, *, reason: str | None = None,
                 lines: int | None = None, nbytes: int | None = None) -> None:
        """`NodeView.log` -- the operator's per-node view of the log sync, fed ONLY by what the node
        reports (`status.log`, `log_offer`, the `log_data` stream). MC asking does not make it
        `offered`: the phone answers when it is safe, and the board must show the phone's truth."""
        nv = self._node_view(nid)
        cur = dict(nv.get("log") or {})
        # A completed stream stays COMPLETE until something new happens. The phone idles back to
        # `none` the moment it finishes, and taking that literally would erase the one state the
        # operator is looking for two seconds after it appeared.
        if cur.get("state") == "complete" and state == "none":
            return
        cur["state"] = state
        cur["last_t"] = self.now_ms()
        if reason is not None:
            cur["reason"] = reason
        else:
            cur.pop("reason", None)      # never carry a stale reason ("2 facts pending") into a new state
        if lines is not None:
            cur["lines"] = lines
        if nbytes is not None:
            cur["bytes"] = nbytes
        nv["log"] = cur

    @staticmethod
    def _parse_log_status(raw: Any) -> tuple[str, str | None] | None:
        """`"held(2 facts pending)"` → `("held", "2 facts pending")`; `"none"`/`"offered"`/`"pulling"`
        pass through. Anything else is ignored rather than shown -- the node is the only writer of
        this string and a shape we do not know is a bug to fix on the node, not a state to render."""
        if not isinstance(raw, str) or not raw:
            return None
        s = raw.strip()
        if s.startswith("held(") and s.endswith(")"):
            return ("held", s[5:-1] or None)
        if s in ("none", "offered", "pulling", "held", "complete"):
            return (s, None)
        return None

    def _note_version(self, nid: str, app_ver: Any, platform: Any) -> None:
        """A29: keep the node's REAL build. Never blank a known value with an absent one -- a status
        body that omits the field is a heartbeat, not a downgrade."""
        nv = self._node_view(nid)
        if isinstance(app_ver, str) and app_ver:
            nv["app_ver"] = app_ver
        if isinstance(platform, str) and platform:
            nv["platform"] = platform

    def _in_the_field(self, nv: dict, now: int) -> bool:
        """Is this node part of THE FIELD for A29's version comparisons?

        `self.nodes` is every node that ever said hello this session, and a bound one is never pruned,
        so a phone swapped out an hour ago still sat in the muster header and -- worse -- could still be
        `newest`, ambering every phone actually on the pitch with OLDER THAN THE FIELD for a build
        nobody is carrying. The line is the one the readiness board already draws (`OFFLINE_AFTER_MS`):
        past it a node is not quiet, it is gone. A station is excluded outright -- a utility phone is
        not in the match."""
        if nv.get("node_type") == "utility":
            return False
        seen = nv.get("last_seen_ms") or 0
        return not (seen and (now - seen) > OFFLINE_AFTER_MS)

    def _newest_field_version(self) -> tuple[int, int, int] | None:
        """The highest PARSABLE app version among the PLAYER nodes still in the field -- what "older
        than the field" measures against."""
        best = None
        now = self.now_ms()
        for nv in self.nodes.values():
            if not self._in_the_field(nv, now):
                continue
            # An INCOMPATIBLE build is not "the field" -- it is a phone that cannot play. Counting it
            # would let one rogue 0.2.0 amber every correct phone on the board with OLDER THAN THE FIELD.
            if not compatible(nv.get("app_ver")):
                continue
            v = parse_app_ver(nv.get("app_ver"))
            if v and (best is None or v > best):
                best = v
        return best

    def versions(self) -> dict:
        """A29 muster header: `PHONES · 3 × 0.1.9 · 1 × 0.1.8`. `field` counts the PLAYER nodes by the
        version string each reported (an unparsable one included, verbatim -- the operator needs to see
        `hud-0.2` said out loud); `newest`/`release` are the two things a phone can be behind. A node MC
        has not heard from in `OFFLINE_AFTER_MS` has left the field and is counted in neither."""
        field: dict[str, int] = {}
        now = self.now_ms()
        for nv in self.nodes.values():
            if not self._in_the_field(nv, now):
                continue
            av = nv.get("app_ver")
            if isinstance(av, str) and av:
                field[av] = field.get(av, 0) + 1
        newest = self._newest_field_version()
        return {"field": field,
                "newest": ".".join(str(x) for x in newest) if newest else None,
                "release": self.release_version,
                "mc_major": app_tier()}

    def _version_flags(self, nv: dict) -> tuple[list[str], list[str]]:
        """The A29 readiness lines for one node: (blockers, ambers).

        RED only for a build MC knows it cannot play with. An UNPARSABLE version is amber by design
        (A1: amber never blocks) -- the old hard-coded `hud-0.2` would otherwise have red-flagged every
        phone in the field the day this landed."""
        blockers, ambers = [], []
        av = nv.get("app_ver")
        ok = compatible(av)
        if ok is None:
            ambers.append(f"APP VERSION UNKNOWN ({av})" if isinstance(av, str) and av else "APP VERSION UNKNOWN")
            return blockers, ambers
        if not ok:
            blockers.append(f"APP {av.split('+', 1)[0]} INCOMPATIBLE WITH MC (NEEDS {app_tier()}) — UPDATE THE APP")
            return blockers, ambers
        mine = parse_app_ver(av)
        newest = self._newest_field_version()
        if newest and mine and mine < newest:
            ambers.append(f"APP OLDER THAN THE FIELD ({'.'.join(str(x) for x in mine)} < {'.'.join(str(x) for x in newest)})")
        rel = parse_app_ver(self.release_version)
        if rel and mine and mine < rel:
            ambers.append(f"APP OLDER THAN THE RELEASE ({'.'.join(str(x) for x in mine)} < {self.release_version})")
        return blockers, ambers

    # ---------- readiness ----------
    def readiness(self) -> ReadinessSnapshot:
        now = self.now_ms()
        board: list[ReadinessRow] = []
        claimed = set()
        for p in self.players.values():
            g = self.guns.get(p.get("gun_id") or "", {})
            nid = p.get("node_id")
            nv = self.nodes.get(nid, {}) if nid else {}
            pf = nv.get("preflight") or {}
            blockers, ambers = [], []
            row: ReadinessRow = {"gun_id": p.get("gun_id") or "", "sticker": g.get("sticker", p.get("gun_id") or "—"),
                                 "tail": g.get("ble", {}).get("tail", ""), "player_id": p["player_id"], "player_num": p["player_num"],
                                 "present": bool(nid), "node": "linked" if nid else "none"}
            if g:
                claimed.add(g.get("sticker", "").lower())
            scan = next((s for s in self.scan_rows if s.get("gun_id") == p.get("gun_id")), None)
            row["identity"] = scan["identity"] if scan else ("ok" if g else "unknown")
            if not nid:
                # NOT a fault: before a phone has ever connected this is the expected state.
                # It still blocks the start (a player with no phone cannot play), but it must not
                # read as a broken gun — Tony, 2026-09-01: "it makes it look like the guns are
                # broken. They are simply disconnected."
                blockers.append("WAITING FOR THE PHONE — OPEN THE APP AND SET THE GUN")
            elif nv.get("last_seen_ms") and (now - nv["last_seen_ms"]) > OFFLINE_AFTER_MS:
                # Gone, not faulty. Say it once instead of listing the four symptoms of it.
                # Guarded on the key EXISTING: a node that has never reported has no last_seen at all,
                # and treating the epoch as its timestamp read "OFFLINE — LAST SEEN 20698d16h".
                blockers.append(f"OFFLINE — LAST SEEN {self._human_age(now - nv['last_seen_ms'])}")
            else:
                age = now - nv.get("last_seen_ms", 0)
                if age > STALE_AFTER_MS:
                    ambers.append(f"STALE LINK ({self._human_age(age)}) — DOES NOT BLOCK")
                if not nv.get("synced"):
                    blockers.append("CLOCK NOT SYNCED — BLOCKS START")
                if pf.get("ssid_ok") is False or pf.get("mc_reachable") is False:
                    # A28.3: for a node that is actually TALKING to us over backhaul, the field Wi-Fi is
                    # not the path that matters — §5c gates (d)/(f) become warnings, not reds. Blocking
                    # the start on "wrong Wi-Fi" for a phone whose status arrived over its data plan
                    # would make backhaul unusable on exactly the fields it exists for.
                    if nv.get("reach") == "backhaul":
                        ambers.append("NOT ON THE FIELD WI-FI — ON BACKHAUL, DOES NOT BLOCK")
                    else:
                        blockers.append("WRONG WI-FI / MC UNREACHABLE — BLOCKS START")
                if pf.get("gun_linked") is False:
                    blockers.append("GUN LINK LOST — BLOCKS START")
                if nv.get("battery") is None:
                    ambers.append("BATTERY UNREAD — DOES NOT BLOCK")
                if pf.get("phone_batt") is not None and pf["phone_batt"] < 20:
                    ambers.append("PHONE BATTERY LOW — DOES NOT BLOCK")
                if pf.get("screen_on") is False or pf.get("foreground") is False:
                    ambers.append("SCREEN OFF / BACKGROUNDED — DOES NOT BLOCK YET")
                if not nv.get("fw"):
                    ambers.append("FIRMWARE UNREAD — DOES NOT BLOCK")
                vb, va = self._version_flags(nv)          # A29: the app build this phone is actually running
                blockers.extend(vb)
                ambers.extend(va)
            if row["identity"] in ("reverted", "unknown") and g:
                blockers.append("IDENTITY REVERTED — RE-STAMP $NAME")
            ack = self.acks.get(p["player_id"])
            if self.lobby_pushed and ack is not None and (not ack.get("ok") or not ack.get("gun_echo")):
                blockers.append("GUN DID NOT ANSWER CONFIG — HEADSET OFF? BLOCKS START")
                row["headset"], row["headset_proof"] = "absent", None
            elif nv.get("headset") == "proven":
                row["headset"], row["headset_proof"] = "proven", "echo"   # the gun answered the push: settled
            else:
                # A32: no echo yet, so the LINK is the evidence. A headless gun drops inside ~6 s, so a link
                # this node has held for HEADSET_LINK_PROOF_MS is a headset. Until then the board says so out
                # loud and counts up, instead of the old "HEADSET UNPROVEN UNTIL CONFIG PUSH" that sat amber
                # for the whole muster and told the operator to do something they were going to do anyway.
                # Not for a node that has gone OFFLINE: its `gun_linked_since` is a fact about a phone that
                # is no longer here, and ageing it into a proof would print PROVEN over a dead row.
                since = nv.get("gun_linked_since")
                if since is not None and (now - nv.get("last_seen_ms", 0)) > OFFLINE_AFTER_MS:
                    since = None
                if since is not None and (now - since) >= HEADSET_LINK_PROOF_MS:
                    row["headset"], row["headset_proof"] = "proven", "link"
                else:
                    row["headset"], row["headset_proof"] = "unknown", None
                    if since is not None:
                        ambers.append(f"HEADSET · CONFIRMING (LINK {(now - since) // 1000} s)")
            row.update({"battery_pct": nv.get("battery"), "battery_age_ms": (now - nv.get("last_seen_ms", now)) if nid else None,
                        "last_seen_age_ms": (now - nv.get("last_seen_ms", now)) if nid else None,   # the UI showed "0s AGO" reading a field that didn't exist (2026-08-26)
                        "gun_linked": pf.get("gun_linked"),
                        "fw": nv.get("fw"), "phone_batt": pf.get("phone_batt"), "ssid_ok": pf.get("ssid_ok"),
                        "mc_reachable": pf.get("mc_reachable"), "synced": nv.get("synced"), "screen_on": pf.get("screen_on"),
                        "foreground": pf.get("foreground"),
                        "app_ver": nv.get("app_ver"), "platform": nv.get("platform"),   # A29
                        "log": nv.get("log"),                                           # A25
                        # kept APART. Merging them meant the lobby printed "GUN LINK LOST - BLOCKS
                        # START, STALE LINK - DOES NOT BLOCK, SCREEN OFF - DOES NOT BLOCK YET" as one
                        # run-on blocker string, so a real fault read the same as a shrug.
                        "blockers": blockers, "ambers": ambers,
                        # `waiting` blocks exactly like `red` but is not a fault: nothing has gone
                        # wrong, the phone simply has not arrived yet. Only when the MISSING NODE is
                        # the sole complaint — a real problem alongside it still reads red.
                        # `waiting` covers BOTH "no phone yet" and "the phone went away": each blocks
                        # the start, neither is a fault, and both must read as inactive rather than red.
                        "status": ("waiting" if len(blockers) == 1 and (not nid or blockers[0].startswith("OFFLINE"))
                                   else "red") if blockers else ("amber" if ambers else "green")})
            board.append(row)
        unclaimed = [s for s in self.scan_rows if s.get("basename", "").lower() not in claimed]
        greens = sum(1 for r in board if r["status"] == "green")
        return {"t": now, "roster_size": len(board), "greens": greens, "board": board, "unclaimed": unclaimed,
                "go": all(r["status"] not in ("red", "waiting") for r in board) and bool(board)}

    async def scan(self, duration_s: int = 6) -> list[ScanRow]:
        self.scan_rows = await self.armory.scan(duration_s)
        self._gun_index()
        self._changed()
        return self.scan_rows

    # ---------- kit-out ----------
    def _on_loadout_request(self, nid: str, pid: str, body: dict) -> None:
        """A10 §4.2: validate against the policy → apply → re-assign → optional try-out → ALWAYS `loadout_ack`.
        A14: `slot` may be "perk"; a pick that knocks the other thing out (ALT-button perk vs second weapon)
        still applies, and the ack carries `dropped {slot, id, name}` + the reason line."""
        p = self.players[pid]
        slot, kind = str(body.get("slot") or ""), str(body.get("kind") or "")
        rid = body.get("id") if isinstance(body.get("id"), str) else None
        weapons, perks = self._catalog_rows()
        # F123: the last argument is the player's CURRENT kit. Only one rule needs it -- `easy_reload` on a
        # chain-reload weapon -- and without it the phone's pick came back ok:true and then silently did not
        # apply (`set_slot` refuses to store the pairing), so the player got no reason at all. The host path
        # (PATCH /api/players) already refused it; this is the phone path catching up.
        ok, reason = _policy.check_request(self.policy(), self.loadout_pool(), slot, kind, rid, weapons, perks,
                                           p.get("loadout"))
        if ok and self.phase in ("armed", "live"):
            ok, reason = False, KIT_LOCKED          # the kit locks at START: nothing is stored, nothing is pushed
        if ok and not self.lobby_pushed and self.phase != "kit":
            # before KIT the phones are on "setting up" (§4.6); after the push the existing path below still applies
            # the pick (re-push) and only reports the try-out as closed
            ok, reason = False, "Mission Control is still setting up the game"
        dropped = None
        if ok:
            before = p.get("loadout") or {"weapons": []}
            new = _policy.set_slot(before, slot, kind, rid, perks, weapons)
            try:
                new = self._check_loadout(new)
            except ValueError as e:
                ok, reason = False, str(e)
            else:
                dropped, why = _policy.dropped_by(before, new, weapons, perks)   # A14: Easy Reload vs a second weapon
                if dropped:
                    reason = why
        if ok:
            p["loadout"] = new
            self.browsing.pop(pid, None)
            self._resend(p)
            self._validate()
            if body.get("try") and kind == "weapon" and rid:
                try:
                    self.tryout(pid, rid)
                except (ValueError, KeyError) as e:
                    self.net.push(nid, "loadout_ack", {"slot": slot, "ok": True, "reason": str(e), "loadout": p["loadout"]})
                    self._changed()
                    return
        self.net.push(nid, "loadout_ack", {"slot": slot, "ok": bool(ok), **({"reason": reason} if reason else {}),
                                           **({"dropped": dropped} if dropped else {}), "loadout": p["loadout"]})
        self._changed()

    def tryout(self, pid: str, weapon_id: str | None) -> None:
        p = self.players[pid]
        if weapon_id is None:
            self.trying.pop(pid, None)
            # tell the NODE too — without this the phone stayed on the try-out screen and the gun stayed
            # armed until the next config push (e2e find, 2026-08-26). Teardown = the known end sequence.
            if p.get("node_id"):
                self.net.push(p["node_id"], "tutorial", {"end": True,
                                                          "frames": list(TRYOUT_TEARDOWN)})
            self._changed()
            return
        if self.lobby_pushed or self.phase in ("armed", "live"):
            raise ValueError("Try-outs are closed — the game has been pushed to the guns")   # A10 §4.4 (was: any node in LOBBY)
        w = next((w for w in self.compiler.weapon_catalog() if w["weapon_id"] == weapon_id), None)
        if not w:
            raise KeyError(weapon_id)
        frames = self.compiler.tutorial_frames(w, self.config["environment"])
        self.trying[pid] = weapon_id
        if p.get("node_id"):
            # A WeaponView, not the raw catalog row: the HUD's stat block draws from `bars`, which only
            # `weapon_views` produces (it needs the whole arsenal to rank against). Pushing the raw row
            # sent the try-out card back to the near-empty `stats.dmg` meter (review 2026-08-31).
            from .views import weapon_views
            wv = next((v for v in weapon_views(self._catalog_rows()[0], self.health_pool(p))
                       if v["weapon_id"] == w["weapon_id"]), None)
            self.net.push(p["node_id"], "tutorial", {"weapon": wv or w, "frames": frames})
        self._changed()

    # ---------- lobby ----------
    def _hit_plan(self):
        """A17: ONE hit-audio plan per MATCH, from the whole roster -- PINNED, not recomputed per call.

        It has to be shared. Every gun must carry a row for every cell any weapon in the match keys --
        a hit into a cell the victim's table lacks is dropped in silence (the F11 shape) -- so the plan
        is a property of the MATCH, never of the player being compiled.

        ⚠️ WHY IT IS CACHED, not just derived from the roster each time. This is called on SINGLE-PLAYER
        recompiles too: `_push_config_to` via `_resend` (a loadout or policy change after the lobby is
        pushed, including mid-match) and the late-joiner hydration in the hello path. `hitaudio.plan()`
        allocates free cells as a pure function of the CURRENT roster's weapon mix, so re-deriving it
        after that mix has shifted can hand the recompiled player a table keyed differently from the guns
        already armed. Those guns keep firing on the old cells; the new table has no row for them; every
        such hit is dropped in silence with both ends reporting healthy. `assert_sir_covers_weapons`
        cannot catch it -- it checks ONE head's internal consistency, never cross-player agreement.
        Inert while `hit_audio_rekey` is off (cells never move), and a live landmine the moment it is on.

        `push_config()` clears the pin, so a deliberate full re-push re-derives; nothing else does.

        A LATE JOINER whose weapons the pinned plan never saw degrades SAFELY rather than dangerously:
        `Plan.cell_for()` returns None, `Compiler._rekey` returns the frame unchanged, and that weapon
        stays on its STOCK cell -- which every gun's table always carries, because `sir_table` never
        removes a stock row. So their hits still register on everyone and everyone's on them. That rests
        on two behaviours that look incidental (a None cell being a no-op; stock rows never dropped), so
        it is pinned by `test_a_player_whose_weapons_the_pinned_plan_never_saw_falls_back_to_STOCK_cells`."""
        fn = getattr(self.compiler, "hit_plan", None)      # a test double need not carry the whole compiler
        if fn is None:
            return None
        if self._pinned_hit_plan is None:
            self._pinned_hit_plan = fn(self.roster(), rekey=bool(self.config.get("hit_audio_rekey", False)))
        return self._pinned_hit_plan

    def _compile_rolled(self, p: Player):
        """Compile with this push's voice roll (A15.1) and say what was drawn."""
        kw = {"roll": self._voice_rng}
        plan = self._hit_plan()
        if plan is not None:
            kw["plan"] = plan
        bundle = self.compiler.compile(self.config, p, self.teams, **kw)
        rolled = (bundle.get("voice") or {}).get("rolled") if isinstance(bundle, dict) else None
        if rolled:
            import logging
            logging.getLogger("brx.mc").debug("voice roll for %s: %s", p.get("display"), rolled)
        return bundle

    def _took_this_config(self, p: Player) -> bool:
        """Is this player's node already PLAYING this match's config?

        Two independent signals, either of which is enough: it acked the config it was pushed (an ack is
        cleared by every push, so one that is standing belongs to the head the node holds now), or its own
        status reports it armed/live. Both mean a fresh head would un-spawn a gun that is in play.

        A node with neither has never taken this match's config — a late joiner, or a phone that arrived
        after the push — and for it a `config` + the same `start` is the HOT JOIN (contracts §5 `start`,
        node.md M-START E5): `engine.js resumeSchedule()` sees a phase that is not `live`, so it reaches
        `_spawn()` and logs "hot-join (+N s)". That path must stay open."""
        if (self.acks.get(p["player_id"]) or {}).get("ok"):
            return True
        return (self.nodes.get(p.get("node_id")) or {}).get("arm_state") in ("armed", "live")

    def _push_config_to(self, p: Player):
        # The guard `push_config` carries, narrowed to ONE player: a `config` is a head write, and in
        # armed/live that head is the F121 disarmed table with nothing to re-spawn a gun already in play.
        # A node that never took this match's config is the exception — that write is its hot join.
        if self.phase in ("armed", "live") and self._took_this_config(p):
            raise ConflictError(_KIT_LOCKED_HOST.format(phase=self.phase.upper(), what="the frames"))
        bundle = self._compile_rolled(p)
        self.bundles[p["player_id"]] = bundle
        self.acks.pop(p["player_id"], None)
        if p.get("node_id"):
            self.net.push(p["node_id"], "config", {"config": self._wire_config(), "frames": bundle, "roster": self.roster()})

    def _refuse_push_in_play(self) -> None:
        """A full config push during a running match is a SAFETY refusal, not a readiness one.

        The node writes `frames.head` on every `config` (`engine.js _applyConfig`) and sets
        `spawned = false` with no spawn or revive behind it. Since A23/F121 that head is the fn-28
        DISARMED `$SIR` table — every cell registers a `$HIR` with no sound, no flash and no pool
        movement — and the REAL table now rides `frames.spawn` / `frames.revive`. So a push to a live
        gun leaves a player who still hears their own gun fire, still gets hit, and takes no damage
        until their next life. Before F121 the same push merely re-armed the live table, which is why
        it was only ever a note ("never push config after START") and is now a guard.

        Deliberately NOT bypassable by `force`: `force` is the operator's override of a READINESS
        judgement (a red row they can see and accept). This is a statement about what the push does to
        a gun that is in play, and no amount of operator intent changes it. RECALL or END first.
        """
        if self.phase in ("armed", "live"):
            raise ValueError(f"the match is {self.phase.upper()}: pushing the config now would re-arm every "
                             "gun with the DISARMED head and leave it unable to take damage until its next "
                             "life. RECALL to return the field to KIT, or END the match first")

    def push_config(self, force: bool = False) -> dict:
        """Compile + push every player's bundle. `force` is the OPERATOR OVERRIDE.

        Field 2026-08-30: one phone dropped its BLE link, its row went red, and the push was refused
        with no way past it — the operator could see the whole field was otherwise ready and had no
        recourse. `start()` has had a `force` since A6; push did not, which is the inconsistency that
        stranded the session. A forced push still compiles and sends to every BOUND node; a player
        whose gun is not linked simply will not ack, which the lobby already shows.

        ⚠ NOT in ARMED or LIVE, and `force` does not open that door (`_refuse_push_in_play`).
        """
        self._refuse_push_in_play()       # before any side effect: a refused push must change nothing
        self._pinned_hit_plan = None      # A17: a full re-push is the ONE place the hit-audio plan re-derives
        rd = self.readiness()
        if not self.players:
            raise ValueError("no players — add someone to the roster first")   # force must not bypass this
        # A28.4: a mode that declares `requires_coverage` needs FULL coverage at push time. Not a red on
        # the board and not `force`-able: the mode is asking for something no gun can do alone, so a
        # push without it would arm a game that cannot be scored.
        if _requires_coverage(self.config.get("mode", "")):
            cov = self.coverage()
            if cov["level"] != "full":
                raise CoverageRequired(
                    f"{self.config.get('mode')} needs FULL coverage (every player's phone on backhaul); "
                    f"{cov['on_backhaul']} of {cov['bound']} bound node(s) are", cov)
        if not rd["go"] and not force:
            reds = [f"{r['player_num']}:{'/'.join(r['blockers'])}" for r in rd["board"] if r["status"] == "red"]
            raise ValueError("readiness has reds — clear them before pushing, or push with force: "
                             + "; ".join(reds))
        if not rd["go"]:
            import logging
            logging.getLogger("brx.mc").warning(
                "FORCED push over %d red row(s): %s", sum(1 for r in rd["board"] if r["status"] == "red"),
                        "; ".join(f"{r['player_num']}:{'/'.join(r['blockers'])}"
                                  for r in rd["board"] if r["status"] == "red"))
        res = self._validate()
        if not res["ok"]:
            raise ValueError("config invalid: " + "; ".join(res["errors"]))
        self.trying.clear()
        self._next_game_no()
        for p in self.players.values():
            self._push_config_to(p)
        self.arm_stations()                    # A13.5: every assigned station learns this game's number
        self.lobby_pushed = True
        self.phase = "lobby"
        self._changed()
        return {"ok": True, "acks": self.acks}

    def all_acked(self) -> bool:
        return bool(self.players) and all(
            self.acks.get(p["player_id"], {}).get("ok") and self.acks.get(p["player_id"], {}).get("gun_echo")
            for p in self.players.values() if p.get("node_id"))

    # ---------- start ----------
    def _start_body(self) -> dict:
        s = self.start_info
        return {"match_id": s["match_id"], "go_live_t": s["go_live_t"], "config_id": self.config["config_id"],
                "seq": s["seq"], "countdown_s": s["countdown_s"]}

    def start(self, runway_s: int | None = None, force: bool = False) -> dict:
        if not self.lobby_pushed:
            raise ValueError("push config first")
        if not self.all_acked() and not force:
            raise ValueError("not every node has acked the config with a gun echo")
        return self._schedule(runway_s or DEFAULT_RUNWAY_S)

    def _schedule(self, runway_s: int) -> dict:
        self.start_seq += 1
        self._game_no_started = True           # the next muster push is a NEW match to every station
        now = self.now_ms()
        self.start_info = {"match_id": uuid.uuid4().hex[:10], "go_live_t": now + runway_s * 1000,
                           "seq": self.start_seq, "countdown_s": runway_s}
        sc = Scorer(self.start_info["match_id"], self.start_info["go_live_t"], self.config["time_limit_s"],
                    self.config["mode"], self.players, self.teams, self.node_player, self.synced_at_lobby,
                    on_feedback=lambda pid, body: self._feedback(pid, body), on_feed=self._on_feed, now_ms=self.now_ms,
                    on_alert=self._alert, frag_limit=(self.config.get("scoring") or {}).get("frag_limit"),
                    win_by=(self.config.get("scoring") or {}).get("win_by"))
        # The cap callback names the scorer that fired it. A Scorer outlives the Session's pointer to it
        # (a recap's frozen scorer, a scorer replaced by a re-start, a copy a caller kept), and a late fact
        # ingested into one of those would otherwise end the match that is running NOW.
        sc.on_limit = lambda t, _sc=sc: self._on_frag_limit(t, _sc)
        self.scorer = sc
        # A24/M2: the roster AS IT GOES IN. `_replay` builds its Scorer from this, never from the live
        # dict, so a re-team made after the whistle cannot re-play the match on teams nobody wore.
        self._match_players = {pid: dict(p) for pid, p in self.players.items()}
        # A25: the ~1 MB pulled-log budget is PER MATCH, not per session. It was never reset, so after
        # three or four matches of logs every node was over it and the recap ask stopped going out --
        # silently, on the match most likely to be the one worth debugging.
        self._log_bytes = {}
        self._log_asked = set()
        self._pending_limit_t = None           # a new match owes nothing to the last one's cap
        self._result_pushed = {}               # A24: nor to the last one's result
        self.end_reason = None
        self.feed = []
        self.last_recap = None
        if self.store:
            try:
                # The config AND the compiled head we actually pushed. Tony, 2026-09-01: "as we debug,
                # you should be able to see every single setting for a game on MC. i had to tell you i
                # ran it again on outdoor." That round cost us a whole theory: I built a case on
                # `$GSET` outdoorMode without being able to see which venue had been used, or the
                # frame that carried it. The head is the ground truth — it shows the token, not a
                # setting that maps to it.
                snap = dict(self.config)
                snap["_heads"] = {pid: (b or {}).get("head", []) for pid, b in self.bundles.items()}
                self.store.match_started(self.start_info["match_id"], snap, self.start_info["go_live_t"])
            except Exception:
                pass
        self.net.broadcast("start", self._start_body())
        self.phase = "armed"
        self._role_due = []                    # a reschedule re-queues from scratch
        self._queue_roles_for_live()
        self._changed()
        return dict(self.start_info)

    def reschedule(self, runway_s: int) -> dict:
        if self.phase not in ("armed",):
            raise ValueError("can only reschedule a pending start")
        return self._schedule(runway_s)

    def abort_start(self) -> dict:
        if self.phase != "armed" or not self.start_info:
            raise ValueError("no pending start")
        now = self.now_ms()
        reached = [pid for nid, pid in self.node_player.items() if now - self.nodes.get(nid, {}).get("last_seen_ms", 0) <= STALE_AFTER_MS]
        unreachable = [p["player_id"] for p in self.players.values() if p["player_id"] not in reached]
        # F106(d): a utility phone never held this start (it is not a player, §5c) and has nothing to
        # abort; `broadcast()` reached it anyway, on a wire that is supposed to need it no LAN mid-match.
        for nid, nv in list(self.nodes.items()):
            if nv.get("node_type") != "utility":
                self.net.push(nid, "control", {"cmd": "abort_start", "seq": self.start_info["seq"]})
        self.start_info = None
        self.scorer = None
        # F106(a): no match ran on this game number, so the NEXT muster push must not treat it as a new
        # match (`_next_game_no` bumps only when `_game_no_started` is True -- an abort must not leave it
        # set, or the following push silently skips a game number and re-arms every station for nothing).
        self._game_no_started = False
        self.phase = "lobby"
        self._changed()
        return {"ok": True, "reached": reached, "unreachable": unreachable}

    def mc_confidence(self) -> dict:
        """A11.5: is MC's picture of the match complete RIGHT NOW? True only when every rostered player's
        HUD has a live socket, was heard from in the last few seconds, and reports nothing left to flush.
        MC-driven global-state events (lead, next-kill-wins, last survivor) are sent only then -- with a
        HUD offline, MC's alive/score picture is exactly what is most likely stale (Tony, 2026-09-04)."""
        now = self.now_ms()
        missing, stale, unflushed = [], [], []
        for p in self.players.values():
            nid = p.get("node_id")
            nv = self.nodes.get(nid or "", {})
            # liveness: the real NetServer keeps a socket per node; a net without that table (fakes,
            # tests) is judged on recency alone.
            table = getattr(self.net, "nodes", None)
            if nid and isinstance(table, dict):
                rec = table.get(nid)
                live = bool(rec is not None and getattr(rec, "ws", None) is not None)
            else:
                live = bool(nid) and bool(nv)
            if not nid or not live:
                missing.append(p["player_id"])
            elif now - nv.get("last_seen_ms", 0) > 6_000:
                stale.append(p["player_id"])
            elif nv.get("pending") not in (0, None):
                unflushed.append(p["player_id"])
        ok = not (missing or stale or unflushed) and bool(self.players)
        return {"confident": ok, "missing": missing, "stale": stale, "unflushed": unflushed}

    def _display_for(self, ident: str | None) -> str | None:
        """An alert's subject id → what the OPERATOR reads: a player's display name, a team's name.

        F118, field 2026-09-11: the console printed `Your Team Takes The Lead (002803e7)`. The KILL
        rows in the same feed resolve their ids (`Scorer._name`) and the alert path simply did not —
        so the one line that names a winner named a hex string instead. Returns None for an id on
        neither the roster nor the team list; the caller decides what to say about that.
        """
        if not ident or ident == "all":
            return None
        p = self.players.get(ident)
        if p:
            return str(p.get("display") or ident)
        t = self.team(ident)
        if t:
            return str(t.get("name") or ident).replace(" TEAM", "")   # "RED TEAM" is the roster label, not a sentence
        return None

    def _alert_feed_text(self, kind: str, scope: str, extra: dict | None = None) -> str:
        """The MC console's line for an alert: third person, mode-aware, ids resolved (F118).

        The SUBJECT is whatever the event is about — `extra.player_id` when it carries one (who turned,
        who is the last standing), otherwise the `scope` itself, which for a lead change IS the new
        leader: a team_id in a team mode, a PLAYER id in FFA. `presentation.feed_text` supplies the
        operator's wording, so "YOUR TEAM TAKES THE LEAD" (right on the player's own phone, wrong on a
        host console, and meaningless in an FFA with no teams) becomes "ROCCO takes the lead".
        """
        who = self._display_for((extra or {}).get("player_id")) or self._display_for(scope)
        tmpl = _pres.MC_TEXT.get(kind) or ""
        if who is None and "{who}" in tmpl:
            # F118 again (polish 2026-09-12): `feed_text` degrades a subject-less `{who}` template to the
            # HUD's own copy, and the HUD's copy is SECOND PERSON — so an id MC could not resolve put
            # "YOUR TEAM TAKES THE LEAD" back on the host console, which is the exact line F118 fixed.
            # The subject is unknown, not the sentence: say it in the third person and let the caller
            # append the raw id below.
            text = _MC_TEXT_NO_SUBJECT.get(kind, kind.replace("_", " ").upper())
        else:
            text = _pres.feed_text(kind, who)
        if who is None and scope != "all":
            text += f" ({scope})"        # an id on neither list: say so plainly rather than drop it
        return text

    def _alert(self, kind: str, scope: str, extra: dict | None = None) -> int:
        """A11.4: push a named game event to every node it concerns. `scope` = "all" | team_id | player_id.
        The node plays `cues[kind]` + `leds[kind]` from its OWN bundle (its presentation profile) and shows
        the text as a HUD alert; MC sends only the name. Returns how many nodes were reached.

        A11.5 gates: the profile's `mc_events` switch, and for GLOBAL-STATE kinds the confidence check --
        a "takes the lead" said on a stale picture is worse than silence."""
        prof = _pres.resolve(self.config)
        if not prof.get("mc_events", True):
            return 0
        if kind in _pres.GLOBAL_STATE_EVENTS and prof.get("mc_confidence", True):
            conf = self.mc_confidence()
            if not conf["confident"]:
                self._on_feed({"t_match_s": max(0, (self.now_ms() - (self.scorer.go_live_t if self.scorer else self.now_ms())) // 1000),
                               "text": f"{self._alert_feed_text(kind, scope, extra)} — withheld: MC not confident "
                                       f"(offline {len(conf['missing'])}, stale {len(conf['stale'])}, unflushed {len(conf['unflushed'])})",
                               "tag": "WITHHELD", "kind": "alert"})
                return 0
        if scope == "all":
            targets = list(self.players.values())
        elif scope in {p.get("team_id") for p in self.players.values()}:
            targets = [p for p in self.players.values() if p.get("team_id") == scope]
        else:
            targets = [p for p in self.players.values() if p["player_id"] == scope]
        n = 0
        base = _pres.alert_body(kind, extra)
        for p in targets:
            if not p.get("node_id"):
                continue
            body = {**base, "player_id": p["player_id"], "t": self.now_ms()}
            if self.net.push(p["node_id"], "alert", body) is not False:   # fakes return None; the real net False = no socket
                n += 1
        self._on_feed({"t_match_s": max(0, (self.now_ms() - (self.scorer.go_live_t if self.scorer else self.now_ms())) // 1000),
                       "text": self._alert_feed_text(kind, scope, extra), "tag": "ALERT", "kind": "alert"})
        return n

    # ---------- held headset roles (A19 / S10, led-language.md §3.3) ----------
    # The node's own start flash (+1.0 s after $SPAWN, ~1 s long) and respawn flash paint the headset AFTER any
    # frame written just before them, so a role pushed at the whistle would be wiped a second later while the
    # node still believes it holds it (it re-asserts only on the next hit). MC therefore waits ROLE_SETTLE_MS
    # past go-live / past a respawn fact before pushing. ➡ A node that re-asserted its held role after its own
    # flashes would make this delay unnecessary; until then it is the honest timing.
    ROLE_SETTLE_MS = 3000

    def _queue_roles_for_live(self) -> None:
        vip = self.config.get("vip_player_id")
        if vip in self.players and self.start_info:
            self._role_due.append((self.start_info["go_live_t"] + self.ROLE_SETTLE_MS, vip, "vip", True, None))

    def _queue_role(self, pid: str, name: str, on: bool, tid: int | None = None) -> None:
        self._role_due.append((self.now_ms() + self.ROLE_SETTLE_MS, pid, name, on, tid))

    def _push_due_roles(self, now: int) -> None:
        due = [r for r in self._role_due if r[0] <= now]
        if not due:
            return
        self._role_due = [r for r in self._role_due if r[0] > now]
        for _, pid, name, on, tid in due:
            self._push_role(pid, name, on, tid)

    def _push_role(self, pid: str, name: str, on: bool, tid: int | None = None) -> int:
        """Hand `pid`'s node a held headset role NOW (`alert.role`, contracts A19). Deliberately NOT gated by the
        profile's `mc_events` switch: a role is a rule of the match, not a flourish, and a silenced game must
        still tell its VIP who they are. Returns 1 if a socket took it, else 0."""
        p = self.players.get(pid)
        if not p or not p.get("node_id") or self.phase not in ("armed", "live"):
            return 0
        body = {**_pres.role_alert_body(name, on, tid), "player_id": pid, "t": self.now_ms()}
        ok = self.net.push(p["node_id"], "alert", body) is not False
        # The feed line is what the operator reads; a VIP whose phone is out of Wi-Fi at go-live is never
        # retried (MC is not live mid-match), so the line must say the role did NOT land rather than claim it.
        self._on_feed({"t_match_s": max(0, (self.now_ms() - (self.scorer.go_live_t if self.scorer else self.now_ms())) // 1000),
                       "text": f"{name.upper()}: {p.get('display') or pid}" + ("" if on else " (ended)") + ("" if ok else " (NOT REACHED: phone offline)"),
                       "tag": "ROLE" if ok else "WITHHELD", "kind": "alert"})
        return 1 if ok else 0

    def _feedback(self, pid: str, body: dict):
        p = self.players.get(pid)
        if p and p.get("node_id"):
            cues = (self.bundles.get(pid) or {}).get("cues") or {}
            if cues.get(body.get("kind")):
                body = {**body, "cue": cues[body["kind"]]}   # A6.3: a full $PLAY frame
            body.setdefault("player_id", pid)                # envelope requires it; a node silently DROPS a feedback without it
            self.net.push(p["node_id"], "feedback", body)

    def _on_feed(self, entry: dict):
        self.feed.insert(0, entry)
        del self.feed[200:]
        for cb in self._feed_listeners:
            cb(entry)

    def _broadcast_control(self, cmd: str) -> int:
        """Push `control{cmd}` to every non-utility node; return how many BOUND PLAYER nodes took it.

        broadcast() returns how many nodes it actually reached and `control` used to discard it, so END
        MATCH EARLY reported success even when it landed on nobody (field 2026-09-01: "end game early on
        MC did not go to each hud"). F31 residual (2026-09-11): `broadcast` counted every live SOCKET (a
        utility phone, a phone with no player) while `nodes` counts PLAYERS with a bound node, so
        "END REACHED 3 OF 2" was possible and "2 of 2" did not mean both HUDs.

        Delivery goes to EVERY non-utility node MC knows — a HUD whose binding was lost mid-match still
        runs the match on its gun and must still get END/PANIC (review 2026-09-11) — while the COUNT is
        over the bound player nodes, so it is the same population the operator sees as `nodes`.
        """
        body = {"cmd": cmd}
        bound_nodes = {p["node_id"] for p in self.players.values() if p.get("node_id")}
        reached = 0
        for nid, nv in list(self.nodes.items()):
            if nv.get("node_type") == "utility":
                continue
            ok = self.net.push(nid, "control", body)
            if nid in bound_nodes and ok is not False:
                reached += 1
        return reached

    def control(self, cmd: str, confirm: bool = False) -> dict:
        """`reached` counts nodes an END/RECALL/PANIC that ACTUALLY HAPPENED got to — never a push alone.

        F125, field 2026-09-11: *"MC says end reached 2 of 2 nodes but game is still going."* `reached`
        was counted BEFORE the branch that ends anything, so an `end` that ended nothing still returned
        `{ok: True, reached: 2, nodes: 2}` (measured against the pre-fix build). The node ran on ~18 s
        and ended on its OWN time limit — `write end (time-expiry)` in the Android's log. That count has
        now been wrong three times; it is reported after the fact from here on.

        ⚠ The sheet's note on the old `:2018` branch ("NEVER sets phase") is not what the code did: the
        recall/panic branch DOES set `phase = "kit"`, so an END with no scorer used to perform a
        recall-shaped transition — silently, on a press that wrote no recap. That is the second half of
        the defect, and it is why the no-scorer case now changes no phase at all and names RECALL
        instead: an END press must never quietly do something else.
        """
        if cmd not in ("end", "recall", "panic"):
            raise ValueError("unknown control")
        if cmd == "panic" and not confirm:
            raise ValueError("panic requires confirm")
        bound = sum(1 for p in self.players.values() if p.get("node_id"))
        if cmd == "end" and self.phase == "recap":
            # The match is already over and its recap is written. A second END used to run `set_end` +
            # `_finish` again on the frozen scorer — re-writing the recap and re-pushing the victory cue to
            # the winners, who are standing in a debrief (polish review 2026-09-12). The press is still
            # FORWARDED (a node that missed the first END is exactly why an operator presses it twice), but
            # it ends nothing, so it must not claim to. PANIC and RECALL are untouched.
            pushed = self._broadcast_control("end")
            self._on_feed({"t_match_s": 0, "tag": "WITHHELD", "kind": "alert",
                           "text": f"END AGAIN — the match already ended and the recap stands. "
                                   f"{pushed} node(s) were told to stop again"})
            self._changed()
            return {"ok": False, "ended": False, "reached": 0, "pushed": pushed, "nodes": bound,
                    "phase": self.phase,
                    "error": "this match has already ended — the recap stands (RECALL returns the field to KIT)"}
        if cmd == "end" and self.scorer is None:
            # Nothing is being scored: there is no match to freeze and no recap to write, so this END
            # ends NOTHING and must not claim otherwise. The nodes are still told to stop — one of them
            # may well be running a match MC lost track of, which is exactly how this is reached.
            pushed = self._broadcast_control("end")
            self._on_feed({"t_match_s": 0, "tag": "WITHHELD", "kind": "alert",
                           "text": f"END DID NOTHING — no match is being scored (phase {self.phase.upper()}). "
                                   f"{pushed} node(s) were told to stop; RECALL returns the field to KIT"})
            self._changed()
            return {"ok": False, "ended": False, "reached": 0, "pushed": pushed, "nodes": bound,
                    "phase": self.phase,
                    "error": "no match is being scored — nothing to end (RECALL returns the field to KIT)"}
        reached = self._broadcast_control(cmd)
        if cmd == "end":
            self.scorer.set_end(self.now_ms())           # A6.1 end freeze
            self.end_reason = "host"                     # A24/M2: a whistle is a moment; it never moves
            self._finish()
        else:                                            # recall/panic stop a live game → KITTED (A5.9)
            self.start_info = None
            self.scorer = None
            self.lobby_pushed = False
            self.acks = {}
            self.phase = "kit"
        self._changed()
        return {"ok": True, "ended": True, "reached": reached, "pushed": reached, "nodes": bound,
                "phase": self.phase}

    def _on_frag_limit(self, t: int, scorer=None) -> None:
        """F124: the cap is reached — end the match, down the same path `control('end')` takes.

        `compile.py` already documents the intent ("frag_limit on a non-full-coverage venue is an
        in-coverage EARLY END only"): MC ends on the kills it can see. That is precisely why every node
        is pushed `control{end}` and not just the ones that scored — the cap is display-only on the HUD
        and the gun never reads `frag_limit` at all, so this push IS the thing that stops the field.

        `scorer` is the Scorer that fired, and it must be the one being played: a frozen recap scorer or
        one replaced by a re-start can still be handed a late fact, and it must not end the CURRENT match.

        The freeze is taken here, at the winning kill. The finish is not, when this arrives mid-batch:
        see `ingest_batch`.
        """
        if scorer is not None and scorer is not self.scorer:
            return
        if not self.scorer or self.phase not in ("armed", "live"):
            return
        self.scorer.set_end(t)                           # A6.1 end freeze, at the kill that won it
        if self._batch_depth:
            self._pending_limit_t = t if self._pending_limit_t is None else min(self._pending_limit_t, t)
            return
        self._end_on_frag_limit(t)

    def _flush_pending_limit(self) -> None:
        """Finish a cap that was reached mid-batch, now that the whole batch is scored."""
        t, self._pending_limit_t = self._pending_limit_t, None
        if t is not None:
            self._end_on_frag_limit(t)

    def _end_on_frag_limit(self, t: int) -> None:
        if not self.scorer or self.phase not in ("armed", "live"):
            return
        cap, t_match_s = self.scorer.frag_limit, max(0, (t - self.scorer.go_live_t) // 1000)
        reached = self._broadcast_control("end")
        bound = sum(1 for p in self.players.values() if p.get("node_id"))
        self.scorer.set_end(t)
        self.end_reason = "frag_limit"       # A24/M2: THE one end a later fact can move (an earlier cap kill)
        self._finish()
        # One line, after the fact, saying what actually happened — the same honesty rule `control`
        # now follows. A node MC could not reach ends on its own time limit, so the operator needs
        # to see that this END was partial while they are still standing on the field.
        self._on_feed({"t_match_s": t_match_s, "tag": "ALERT" if reached >= bound else "WITHHELD", "kind": "alert",
                       "text": f"FRAG LIMIT {cap} REACHED — MATCH OVER · END REACHED {reached} OF {bound} NODE(S)"})
        self._changed()

    def _push_victory(self, recap: dict | None) -> None:
        """At recap, the WINNING team's (or FFA winner's) connected nodes get the `victory` cue; losers
        get nothing extra. In-coverage only — a dispersed node just played its neutral `game_over` on its
        own timer. A6-shaped: `_feedback` attaches the pre-composed `$PLAY,VSF,4,6,JAY` frame from the bundle."""
        w = (recap or {}).get("winner") or {}
        wt, wp = w.get("team_id"), w.get("player_id")
        if wt is None and wp is None:
            return
        for p in self.players.values():
            if not p.get("node_id"):
                continue
            won = (wt is not None and p.get("team_id") == wt) or (wp is not None and p["player_id"] == wp)
            if won:
                # feedback.player_id is required by the envelope contract (contracts §5)
                self._feedback(p["player_id"], {"kind": "victory", "player_id": p["player_id"], "t": self.now_ms()})

    def _finish(self):
        # A24/M2: before the recap is taken, ask whether the cap was a DEAD HEAT — a second cap kill
        # inside the clock-sync band parks as post_end (A6.1) and would otherwise hand the match to
        # whichever of two indistinguishable kills MC happened to order first.
        if self.scorer and self.end_reason == "frag_limit":
            self.scorer.cap_tie = self.scorer.check_cap_tie(CLOCK_TIE_MS)
        # A6: the stations row rides IN the recap dict from the moment it exists, same as `possession` --
        # a station is self-authoritative and reports at recap (§5c), so its own last heartbeat is all
        # there ever is to show, and it must be here even after the live scorer object is gone.
        # A25: which match the logs we are about to ask for belong to. Captured HERE because
        # `start_info` is cleared a few lines down and the scorer object goes with the recap.
        self._log_match = (self.start_info or {}).get("match_id") or (self.scorer.match_id if self.scorer else None)
        # A24/M2: the roster as the field WORE it at the whistle -- mid-match re-teams included, recap
        # edits excluded. Everything `_replay` re-derives is measured against this copy.
        self._match_players = {pid: dict(p) for pid, p in self.players.items()}
        self.last_recap = self._scorer_recap() if self.scorer else None
        self._push_victory(self.last_recap)              # winners' guns play the victory sting (in coverage)
        self._push_result()                              # A24: EVERY node learns the outcome, losers included
        if self.store and self.start_info and self.last_recap:
            try:
                self.store.match_ended(self.start_info["match_id"], self.last_recap)
            except Exception:
                pass
        self.start_info = None            # no re-hydrating a finished match's `start`
        self.phase = "recap"
        # F106(d): a utility phone's log holds nothing about a MATCH (it never binds one, §5c) -- only
        # a player node's log is match debug gold.
        for _nid in list(self.nodes):
            self.pull_log(_nid, "recap")        # A25: gated by `log_sync`; utility nodes refused inside
        self.lobby_pushed = False
        self.acks = {}
        # A32: `acks` is what turns the echo into a red "GUN DID NOT ANSWER CONFIG" for the NEXT lobby,
        # so the proof it set resets with it -- otherwise a gun whose headset died in the debrief reads
        # PROVEN through the whole next muster on an echo from the match before.
        for _nv in self.nodes.values():
            _nv.pop("headset", None)
        for p in self.players.values():
            p["ready"] = False
        self._changed()

    def tick(self) -> None:
        """Call periodically (≥1 Hz): armed→live at go_live_t; live→recap at the timed end (+5 s grace)."""
        self._flush_pending_limit()   # last resort: a cap deferred mid-batch ends even if no fact follows
        if not self.start_info:
            return
        now = self.now_ms()
        if self.phase == "armed" and now >= self.start_info["go_live_t"]:
            self.phase = "live"
            self._changed()
        self._push_due_roles(now)
        tl = self.config.get("time_limit_s")
        if self.phase == "live" and tl and now >= self.start_info["go_live_t"] + tl * 1000 + 5000:
            self.end_reason = "time"         # A6.1: the clock every phone ran; it is not re-derived
            self._finish()

    def recap(self) -> dict | None:
        if self.scorer:
            self._mark_flushed_live()
            r = self._scorer_recap()                                 # A6: live recap gets the row too, not just the final one
            if self.phase != "recap":
                r["provisional"] = True
            r.update(self.settling())     # advisory only — never gates, see settling()
            return r
        return self.last_recap

    @staticmethod
    def _human_age(ms: int) -> str:
        """`1093m32s` is not a duration anyone can read. Give it the right unit."""
        s = max(0, ms // 1000)
        if s < 60:
            return f"{s}s"
        if s < 3600:
            return f"{s // 60}m"
        if s < 86400:
            return f"{s // 3600}h{(s % 3600) // 60:02d}m"
        return f"{s // 86400}d{(s % 86400) // 3600:02d}h"

    def _mark_flushed_live(self) -> None:
        """A node that is CONNECTED, fresh, and reports pending == 0 has nothing left to flush — count its
        player as flushed even if it never sent a single fact (2026-08-26: a zero-event match stayed
        PROVISIONAL forever with the phone sitting right there)."""
        if not self.scorer:
            return
        now = self.now_ms()
        for pid, st in self.scorer.stats.items():
            if st.flushed:
                continue
            p = self.players.get(pid) or {}
            nv = self.nodes.get(p.get("node_id") or "", {})
            fresh = nv and (now - nv.get("last_seen_ms", 0)) < 30_000
            if fresh and nv.get("pending") == 0:
                st.flushed = True

    def settling(self) -> dict:
        """Which bound nodes have NOT been heard from since the whistle (A8, field 2026-08-30).

        Tony: *"it kinda was showing the final results as if it was final and then it finally popped up
        and the totals changed."* `provisional` could not have caught that — `Scorer.ingest` marks a
        player flushed on their FIRST event, so anyone who fired a shot is flushed from second one and
        `missing()` is empty well before the end. The totals moved because late facts were still
        arriving, which is a different question: *has every node reported since the match ended?*

        This is deliberately ADVISORY and additive — it gates nothing. An earlier attempt folded this
        condition into `_mark_flushed_live` instead, which left a phone that went quiet at the whistle
        permanently un-flushable and the recap permanently PROVISIONAL. Never gate on this.
        """
        if not self.scorer or self.scorer.end_t is None:
            return {"settling": False, "awaiting": [], "since_end_ms": None}
        end_t, now = self.scorer.end_t, self.now_ms()
        if now < end_t:
            return {"settling": False, "awaiting": [], "since_end_ms": None}
        awaiting = [p["player_id"] for p in self.players.values()
                    if p.get("node_id")
                    and self.nodes.get(p["node_id"], {}).get("last_seen_ms", 0) < end_t]
        return {"settling": bool(awaiting), "awaiting": awaiting, "since_end_ms": now - end_t}

    def new_session(self, keep_roster: bool = True) -> None:
        self.session_id = uuid.uuid4().hex[:8]
        self.phase = "muster"
        self.start_info = None
        self.scorer = None
        self.last_recap = None
        self.end_reason = None
        self._score_pushed = {}
        self._result_pushed = {}
        self.feed = []
        self.lobby_pushed = False
        self.acks = {}
        self.bundles = {}
        self.trying = {}
        self.browsing = {}
        self.synced_at_lobby = {}
        if keep_roster:
            for p in self.players.values():
                p["ready"] = False
            # tell every bound node the new session exists — without this the HUD sat on MATCH COMPLETE
            # forever after NEW MATCH (Tony, 2026-08-26): a fresh assign resets the node to KITTED.
            for p in self.players.values():
                if p.get("node_id"):
                    try:
                        self.net.push(p["node_id"], "assign", self._assign_body(p))
                    except Exception:
                        pass
        else:
            self.players = {}
            self.node_player = {}
            for nv in self.nodes.values():
                nv.pop("player_id", None)
        self._changed()
        if keep_roster:
            self.persist_now()                       # roster survives a crash right after NEW MATCH
        elif self._persist_path:
            self._persist_dirty = False              # nothing to flush — and remove the file LAST so
            try: self._persist_path.unlink(missing_ok=True)   # our own _changed can't resurrect it
            except Exception: pass

    # ---------- snapshot ----------
    def snapshot(self) -> dict:
        now = self.now_ms()
        kitted = sum(1 for p in self.players.values() if p.get("node_id"))
        self._prune_browsing()
        live = None
        if self.scorer and self.phase in ("armed", "live", "recap"):
            tl = self.config.get("time_limit_s")
            live = {"match_id": self.scorer.match_id, "go_live_t": self.scorer.go_live_t, "time_limit_s": tl,
                    "ends_t": (self.scorer.go_live_t + tl * 1000) if tl else None,
                    "score": self.scorer.team_scores(),
                    "rows": self.scorer.live_rows(now, {nid: nv.get("last_seen_ms", 0) for nid, nv in self.nodes.items()})}
        start = None
        if self.start_info:
            per = {}
            for nid, pid in self.node_player.items():
                nv = self.nodes.get(nid, {})
                per[pid] = {"arm_state": nv.get("arm_state", "idle"), "t_minus_ms": nv.get("t_minus_ms"),
                            "synced": nv.get("synced", False), "last_seen_ms": now - nv.get("last_seen_ms", 0)}
            start = {**self._start_body(), "per_node": per}
        return {"session_id": self.session_id, "phase": self.phase, "t": now, "lan": self.lan,
                "coverage": self.coverage(),                    # A28.4: derived, not asserted
                "mc_confidence": self.mc_confidence(),          # A11.5: gates MC-driven global-state events
                "nodes": [{**nv, "last_seen_ms": now - nv.get("last_seen_ms", 0)} for nv in self.nodes.values()],
                "stations": self.stations_view(), "game_no": self._game_byte(),   # A13.5: the ITEMS panel
                "readiness": self.readiness(), "config": self.config, "config_errors": self.config_errors,
                "options": dict(self.options),      # A25: session options (log_sync)
                "versions": self.versions(),        # A29: the muster version header
                "config_warnings": self.config_warnings,
                "players": list(self.players.values()), "teams": self.teams,
                "kit": {"kitted": kitted, "total": len(self.players), "trying": dict(self.trying), "browsing": dict(self.browsing)},
                "loadout_pool": self.loadout_pool(),
                "active_preset_id": self.active_preset_id,
                "lobby": {"ready": sum(1 for p in self.players.values() if p["ready"]), "total": len(self.players),
                          "pushed": self.lobby_pushed, "acks": self.acks, "all_acked": self.all_acked()},
                "start": start, "live": live, "recap": self.recap() if self.phase in ("live", "recap") else None,
                "notices": self._notices(),      # A31: standing host lines (absent keys = nothing to say)
                "feed": self.feed[:50]}
