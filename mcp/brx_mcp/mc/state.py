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
from typing import TYPE_CHECKING, Any, Callable, Literal, NotRequired, TypedDict, cast, get_args
from urllib.parse import quote

from . import presentation as _pres
from .. import poolgauge as _pg
from .. import voices as _voices
from . import compile as _compile      # A31: `mc_verify` / `full_coverage` — one coverage model
from . import frames as _frames      # A36: reading a pushed head / a gun's echo back
from . import policy as _policy
from .interfaces import Compiler as CompilerPort
from .scoring import Scorer
from ..modes.hillbeacon import NEUTRAL_TEAM as _NEUTRAL_TEAM     # F82: the tid a NEUTRAL hill broadcasts
from ..modes.registry import default_params as _default_params, params_schema_json as _params_schema_json, \
    validate_mode_params as _validate_mode_params, \
    requires_coverage as _requires_coverage                        # A18: the mode's own rules, engine-declared
from .tunnel import TunnelError
from .types import (PHONE_RESPAWN_THRESHOLD_DBM, PHONE_POWERUP_THRESHOLD_DBM, PHONE_STATION_THRESHOLD_DBM, PHONE_THRESHOLD_ZERO_APP, CLOCK_TIE_MS, DEFAULT_RUNWAY_S, HEADSET_LINK_PROOF_MS, MAX_PLAYERS, MAX_TAG_LEN,
                    OBJECTIVE_MODES, OFFLINE_AFTER_MS, POOL_CHECK_SETTLE_MS, RESPAWN_PROFILE_MIN_APP,
                    STALE_AFTER_MS, STALE_LIVE_RETELL_MS, ADOPT_SLACK_MS, STATION_EDIT_AGE_UNKNOWN_MS, STATION_KINDS, STATION_LOCK_LOBBY_S, STATION_LOCK_MARGIN_S,
                    STATION_LOCK_MAX_S, STATION_REBOOT_SLACK_MS, STATUS_HEARTBEAT_MS, STATION_SOURCES, STATION_TEAM_ANY, SYNC_FRESH_MS, TX_POWERS, Event,
                    ConfigView, Coverage, EndDeliveryRow, EndDeliveryView, FrameBundle, GameAnnouncementView, GameConfig,
                    KitView, LanPublic, LanView, LobbyAck, LobbyView, Loadout, LoadoutOverrides, LoadoutPolicy,
                    LoadoutPool, McConfidence, NoticesView, OperatorActionResult, OperatorCmd, PerkView, ModeInfo, Phase, PhaseRefusalBody, Player,
                    LiveRow, ReadinessRow, ReadinessSnapshot, RecapStationRow, RecapView, Respawn, ScanRow, SessionOptions,
                    SnapshotFeedRow, SlotRule, State, StationAssignment, StationItem, PowerupSlot, PowerupsView, StationRef, StationControl, StationRange, StationReport, RangeEdit,
                    StationView, SyncAckState, SyncRow, SyncTotals, SyncView, VersionsView, RestoredFromView,
                    StartNodeView, StartView, Stun, OrphanMatchView, Team, Weapon, WeaponSel, WinnerView, LiveView, NodeView,
                    app_tier, compatible, is_arm_state, is_station_kind, parse_app_ver, parse_win_by)

from . import powerups as _pu

if TYPE_CHECKING:                      # `presets.PresetStore` is attached by `__main__`/`create_app`
    from .presets import PresetStore

PHASES = get_args(Phase)      # the vocabulary itself lives on `types.Phase`, so the console's is generated from it

# A25: the session option table. `log_sync` gates the AUTOMATIC `pull_log` asks (recap / offer /
# reconnect); the operator's LOGS button (`reason: "manual"`) is never gated -- the whole point of
# "manual" is that the operator still gets a log when they ask for one.
OPTION_DEFAULTS: dict[str, Any] = {"log_sync": "auto"}
OPTION_VALUES: dict[str, tuple[str, ...]] = {"log_sync": ("auto", "manual")}
LOG_STATES = ("none", "offered", "pulling", "held", "complete")
PULL_REASONS = ("recap", "offer", "manual", "reconnect")
# 2026-09-16: how long the PRE-ARM CHECK shows a pushed gun as WAITING before it calls the silence a
# failure. A gun echoes a head inside ~1.5 s and the phone heartbeats every ~2 s, so 10 s is generous.
SYNC_ACK_TIMEOUT_MS = 10_000

# A42: the END re-delivery ladder — the gap before the 1st, 2nd, … re-push to a HUD that has not confirmed
# the end. Short at first (the ordinary cause is one lost frame to a phone that is standing right there),
# backing off to a minute, and then STOPPING: past ~137 s a phone is not slow to answer, it is gone, and
# A34's reconcile answers it from its own first heartbeat for as long as MC remembers the match (`_ended`).
END_RETRY_MS = (2_000, 5_000, 10_000, 20_000, 40_000, 60_000)
# A42: the phone phases that are a RECEIPT for the end of a NAMED match. `engine.js _endLocal` writes
# `frames.end` and moves the HUD to `kitted` while deliberately KEEPING `match_id` -- that pairing is the
# whole ack, and nothing else on the wire says "I took your end". Every other phase the engine can report
# (`idle`, `connected`, `lobby`, `armed`, `live` -- PHASES in engine.js) is NO CLAIM: see `_note_end_confirm`
# for why the absence of a denial must never be read as one.
END_CONFIRM_PHASES = ("kitted",)


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
# F401: a station's name as the console's recap shows it (`Recap.tsx` STATION_KIND_LABEL), so LOAD's sync warning
# and the recap row above it name the same station the same way.
_STATION_KIND_LABEL = {"respawn": "RESPAWN", "powerup": "POWERUP", "extraction": "EXTRACTION",
                       "bomb": "BOMB SITE", "control": "CONTROL POINT"}

PUBLIC_OFF: LanPublic = {"ws_url": None, "status": "off", "provider": None, "available": False, "was_up": False}


class CoverageRequired(ValueError):
    """A28.4: this mode declares `requires_coverage` and coverage is not full. The API answers 409
    `{error, coverage}` — a ValueError so every existing `except ValueError` path still catches it."""

    def __init__(self, msg: str, coverage: Coverage):
        super().__init__(msg)
        self.coverage = coverage
        self.status = 409

TEAM_DEFS: dict[str, Team] = {  # $TID: 1=blue, 2=yellow, 0=red (protocol §7i); green provisional 3
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
class EndDeliveryRecord(TypedDict):
    match_id: str
    player_id: str
    since: int
    tries: int
    next_t: int
    confirmed: bool
    confirmed_t: int | None
    exhausted: bool
    last_ok: bool


class ModeRow(TypedDict):
    """One row of `MODES` below. The catalogue is data, not wire shape, so it lives here rather than in
    `types.py`; the keys are exactly what `default_config()`, `modes()` and `game_brief()` read."""
    mode: str
    name: str
    abbr: str
    desc: str
    brief: str
    teams_text: str
    win_text: str
    respawn_text: str
    teams: list[str]                    # keys into TEAM_DEFS
    win_by: str
    frag_limit: int | None
    respawn: Respawn
    preset: str                         # led-language.md §4 / G3: the presentation preset the mode resolves to
    proven: bool
    station_source: NotRequired[str]    # F70: only the modes with an objective emitter carry one


MODES: list[ModeRow] = [
    {"mode": "tdm", "name": "TEAM DEATHMATCH", "abbr": "TDM", "desc": "Teams score per elimination",
     "brief": "Squads score a point per elimination. Downed players respawn after the delay and rejoin. The highest score at the time limit takes the match; the operator can also set an optional score cap.",
     "teams_text": "2–4 TEAMS", "win_text": "TIME · OPTIONAL SCORE CAP", "respawn_text": "ON · TIMED",
     "teams": ["blue", "yellow"], "win_by": "kills", "frag_limit": None, "respawn": {"type": "auto", "delay_s": 15},
     "preset": "standard", "proven": True},
    {"mode": "ffa", "name": "FREE-FOR-ALL", "abbr": "FFA", "desc": "Every operator for themselves",
     "brief": "No teams — everyone is a target. Each elimination scores a point. The top score when time expires wins; the operator can also set an optional frag limit.",
     "teams_text": "NONE · ALL VS ALL", "win_text": "TIME · OPTIONAL FRAG LIMIT", "respawn_text": "ON · TIMED",
     "teams": ["ffa"], "win_by": "kills", "frag_limit": None, "respawn": {"type": "auto", "delay_s": 15},
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
    # `station_source: "phone"` on the row (Tony 2026-09-24: the MVP hill is a Bluetooth control point, a phone
    # station today and a StickS3 once its presence capture is bench-proven; the grenade hill is POST-MVP but
    # stays selectable, `_CONFIG_KEYS`).
    # 🔴 `teams` is BLUE + GREEN, tids 1 and 3, and the choice is load-bearing: YELLOW is tid 2,
    # which is the team a NEUTRAL hill broadcasts, so a yellow roster would read every uncaptured
    # point as its own and take no hill damage (F82). `assign_teams` defaults the same 1/3 pair, and
    # both `DominationEngine.add_player` and `Compiler.validate` refuse a tid-2 hill roster outright.
    # `win_by` is "objective" (possession time), the same value extraction already uses: MC has no
    # objective scorer, so `scoring.py` reports the winner as `undecided` rather than inventing one
    # from kills, and the UI renders that as "UNDECIDED — OBJECTIVE · HOST DECIDES" (Recap.tsx).
    {"mode": "koth", "name": "KING OF THE HILL", "abbr": "KOTH", "desc": "Hold the hill; possession scores",
     "brief": "One hill: a Bluetooth control point on the field, a spare phone in the utility role. Stand on the point to take it. An enemy point drains to neutral before it builds up for you, and the side with more living players on it moves it. Every second your side holds it banks possession. Most possession time when the clock runs out takes the match.",
     # `win_text` says HOST CALL on purpose, and it is the honest label until the phones report.
     # MC ingests a `possession` fact and names the winner from it the moment one arrives (API.md /
     # `scoring._possession`) -- but nothing on `app/src` sends one yet, so a card reading plain
     # "POSSESSION TIME" promises a number that does not exist and the operator gets a kills table
     # (operator review 2026-09-10). ➡ Drop "· HOST CALL" when the phone ships the fact.
     "teams_text": "2 TEAMS", "win_text": "POSSESSION TIME · HOST CALL", "respawn_text": "ON · TIMED",
     "teams": ["blue", "green"], "win_by": "objective", "frag_limit": None, "respawn": {"type": "auto", "delay_s": 15},
     "preset": "standard", "station_source": "phone", "proven": True},
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

# A36/F271's four push-curable proof prefixes, written once and matched once.
#
# They share a frame of reference: each answers "is this gun running the config we pushed?".
#
# They are also the exact set of blockers whose CURE IS THE PUSH ITSELF: a re-push replaces the head,
# clears the ack, the echo derived from it and the pool judgement made against it. `push_config`
# therefore does not count them as reds standing in its own way (A37) -- a blocker that says RE-PUSH
# while refusing the push is only clearable with `force`, which is the opposite of what it is for.
#
# START treats them differently: stale ack and query read-back are force-proof, echo is forceable,
# and the pool fault is earned only after the whistle.
# `_refuse_stale_ack` is force-PROOF -- the gun is on record naming another game's head, which is a
# fact, not a judgement -- while `_refuse_echo_mismatch` is FORCEABLE, because it rests on an
# inference nobody has benched (what a v4.32 gun emits in the 1.5 s after a `$WEAP` write; see that
# method). R2-5, polish loop iteration 2: this comment used to claim "START still refuses on every
# one of them" and START refused on exactly one -- an echo mismatch leaves the ack CURRENT, so
# `all_acked()` was true and the whistle blew on a gun that had just said it is carrying something
# else. The pool fault is deliberately not a START gate: it can only be earned
# in LIVE, by which time this game's whistle has already gone.
_STALE_ACK_FAULT = "ACKED AN OLDER CONFIG"
# Bench 2026-09-17: the readiness amber while the phone reports `preflight.gun_flapping` (headset off).
GUN_FLAPPING_LINE = "HEADSET OFF (GUN KEEPS DROPPING THE LINK): TURN THE HEADSET ON"
_ECHO_FAULT = "GUN ECHO ≠ CONFIG"
_POOL_FAULT = "GUN POOL ≠ CONFIG"
_GUN_CONFIG_FAULT = "GUN CONFIG ≠ PUSHED HEAD"
PUSH_CURES = (_STALE_ACK_FAULT, _ECHO_FAULT, _POOL_FAULT, _GUN_CONFIG_FAULT)

# R2-4/R2-6: the same question asked where the pool can only SUGGEST an answer. Both are AMBER --
# they ride in `ReadinessRow.ambers`, they gate nothing, and their instruction is the same one the
# red carries because a push is the only thing that settles any of it.
_POOL_BELOW_ADVISORY = "GUN POOL BELOW CONFIG"
_POOL_ARMOR_ADVISORY = "GUN ARMOR ABOVE CONFIG"


def cured_by_push(blocker: str) -> bool:
    """Is this readiness blocker one of the four proof prefixes a re-push replaces?"""
    return blocker.startswith(PUSH_CURES)


# F221 (Tony, 2026-09-25): every readiness line reads `WHAT IS WRONG: WHAT TO DO`, upper case, one colon.
# The list a line goes into (`blockers` or `ambers`) is the gate; the console picks the colour from the
# line's head (`webapp/mc/src/alerts/server.ts` SERVER_LINES). So a line never says "BLOCKS START" or
# "DOES NOT BLOCK": the list and the colour already say it. `test_mc_alert_wording.py` pins the rule.
WAITING_FOR_PHONE = "WAITING FOR THE PHONE: OPEN THE APP AND SET THE GUN"
GUN_LINK_LOST = "GUN LINK LOST: CHECK THE GUN IS ON AND RECONNECT IT"
CLOCK_NOT_SYNCED = "CLOCK NOT SYNCED: WAIT FOR THE PHONE TO SYNC"
WRONG_WIFI = "WRONG WI-FI OR MC UNREACHABLE: JOIN THE PHONE TO THE FIELD WI-FI"
TUNNEL_DOWN_ACT = "TUNNEL DOWN: TURN THE TUNNEL ON IN REACH"
IDENTITY_REVERTED = "IDENTITY REVERTED: RE-STAMP $NAME"
GUN_DID_NOT_ANSWER = "GUN DID NOT ANSWER CONFIG: CHECK THE HEADSET IS ON, THEN RE-PUSH"
BATTERY_UNREAD = "BATTERY UNREAD"
PHONE_BATTERY_LOW = "PHONE BATTERY LOW: CHARGE THE PHONE"
SCREEN_OFF = "SCREEN OFF OR APP IN THE BACKGROUND: BRING THE APP TO THE FRONT"
# A13.5 station attention lines (`_station_view`). The action is the one the ITEMS card offers.
STATION_REARM = "RE-ARM IT FROM ITEMS ON ARMORY"
STATION_BRING_BACK = "NOT RE-ARMED, OUT OF WI-FI RANGE: BRING IT BACK TO RE-ARM"
STATION_ARMED_OLDER = f"ARMED FOR AN OLDER GAME: {STATION_REARM}"
STATION_NOT_ARMED = f"PHONE SAYS NOT ARMED: {STATION_REARM}"
STATION_BATTERY_LOW = "BATTERY LOW: CHARGE OR SWAP IT BEFORE THE WHISTLE"
# F221 battery rule: under 30 % is AMBER for the gun, the phone and the station alike.
BATTERY_LOW_PCT = 30


def not_reached_line(age: str, tunnel_down: bool) -> str:
    """F155: a node whose last path to MC was the internet tunnel. ONE sentence shape, which the console's
    `staleReachReason` (webapp/mc/src/api/derive.ts) writes the same way."""
    return f"NOT REACHED FOR {age}" + (f", {TUNNEL_DOWN_ACT}" if tunnel_down else "")


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

    def body(self) -> PhaseRefusalBody:
        return {"error": str(self), "not_ready": self.not_ready,
                "greens": self.greens, "roster_size": self.roster_size}


_KIT_LOCKED_HOST = ("the match is {phase}: a player's kit is locked until it ends — changing {what} now would "
                    "re-arm that gun with the disarmed head and it could not fire or take damage again this "
                    "match. RECALL or END first")
_KIT_FIELDS = ("loadout", "voice", "voice_slots", "player_num", "gun_id")


def default_config(mode: str = "tdm") -> GameConfig:
    m = next(x for x in MODES if x["mode"] == mode)
    cfg: GameConfig = {"config_id": uuid.uuid4().hex[:8], "mode": mode, "environment": "outdoor", "night": False,
                       "time_limit_s": 600, "respawn": m["respawn"].copy(),
                       "scoring": {"frag_limit": m["frag_limit"], "win_by": parse_win_by(m["win_by"], "kills")},
                       "health": _compile.default_health(),      # S45: the Standard preset (45/70/0)
                       "teams": [TEAM_DEFS[t].copy() for t in m["teams"]],
                       "loadout_policy": _policy.default_policy(mode),      # A10: ffa → no_heavies, else open
                       "presentation": _pres.profile_from_preset(m.get("preset", "standard"))}   # A11 / G3: the mode row's own preset
    # Only the modes that HAVE an objective emitter carry the key at all, so every other mode's config
    # is byte-identical to what it was before the field existed (a saved game's identity is the whole
    # config -- `gameSummary.ts` `gameSig` -- and a null nobody set would have re-keyed all of them).
    #
    # S42's `recoil` follows the SAME rule, learned the hard way (2026-09-17): a first pass stored
    # "recoil": True here unconditionally, which re-keyed the signature of EVERY config that predates
    # the field (an old session.json restore, most concretely) against the fresh defaults — the STOCK
    # MODE rail read every restored game as "TUNED — NOT SAVED" forever, because its config could never
    # byte-match a fresh `default_config()` again. Absence already means ON (`recoilEnabled` in
    # engine.js: `!config || config.recoil !== false`), so nothing needs storing here at all; a host
    # sets `recoil: false` explicitly through `PUT /api/config` when they want it off.
    if src := m.get("station_source"):
        cfg["station_source"] = src
    # A18: the same rule for the mode's own parameters -- present and COMPLETE (every default) only when the
    # engine declares some (koth, lms, extraction); tdm / ffa / infection declare none and stay byte-identical.
    mp = _default_params(mode)
    if mp:
        cfg["mode_params"] = mp
    return cfg


# F337 (a): the per-station lock bookkeeping the session snapshot carries across an MC restart.
_STATION_LOCK_KEYS = ("lock", "lock_game", "locked_since", "unlocked_at", "restarts", "boot",
                      "tally")   # integration review (Low): the self-authoritative count only grows within a game

def _range_edit_ok(e: dict) -> bool:
    """A67: one well-formed `range_edits` row (the station's wire shape)."""
    def _int(v):
        return isinstance(v, int) and not isinstance(v, bool)
    if not (_int(e.get("seq")) and e["seq"] >= 0 and _int(e.get("age_ms")) and e["age_ms"] >= 0
            and isinstance(e.get("locked"), bool)):
        return False
    if e.get("field") == "threshold":
        return _int(e.get("from")) and _int(e.get("to"))
    return e.get("field") == "tx_power" and e.get("from") in TX_POWERS and e.get("to") in TX_POWERS


def _range_word(v) -> str:
    """A67: a range value in the operator's voice: a dBm number as is, a strength as a word ("ultra_low" → "ULTRA LOW")."""
    return str(v) if isinstance(v, int) else str(v).replace("_", " ").upper()


def _ago(ms: int) -> str:
    s = ms // 1000
    if s < 10:
        return "JUST NOW"
    if s < 60:
        return f"{s}s AGO"
    if s < 3600:
        return f"{s // 60} MIN AGO"
    return f"{s // 3600} H AGO"


def _tally_ok(t) -> bool:
    """A station tally from a snapshot has the shape `_keep_station_tally` writes: a key list, `hold_ms` as team id to
    non-negative int ms, and `revives` an int or None."""
    if not isinstance(t, dict) or not isinstance(t.get("key"), list) or not isinstance(t.get("hold_ms"), dict):
        return False
    if not all(isinstance(k, str) and isinstance(v, int) and not isinstance(v, bool) and v >= 0 for k, v in t["hold_ms"].items()):
        return False
    r = t.get("revives")
    return r is None or (isinstance(r, int) and not isinstance(r, bool))


def _check_tag(raw: str) -> str:
    """F366: the stored gamertag (trimmed, upper-cased). Longer than MAX_TAG_LEN is refused, never cut."""
    d = raw.strip().upper()
    if len(d) > MAX_TAG_LEN:
        raise ValueError(f"the gamertag is {len(d)} characters: {MAX_TAG_LEN} is the most")
    return d


class Session:
    def __init__(self, compiler: CompilerPort, net, armory, store=None, now_ms: Callable[[], int] | None = None,
                 lan: dict | None = None, voice_rng: random.Random | None = None):
        self.compiler, self.net, self.armory, self.store = compiler, net, armory, store
        # A15.1: every push rolls the un-picked $PSET voice fields (death scream, short pain, respawn cry) so two
        # players with the same character do not die with the same scream; inject a seeded Random in tests.
        self._voice_rng = voice_rng or random.Random()
        self.now_ms = now_ms or (lambda: int(time.time() * 1000))
        self.session_id = uuid.uuid4().hex[:8]
        self.phase: Phase = "muster"
        self.players: dict[str, Player] = {}
        # STANDBY (2026-09-12): players pulled out of the roster but not forgotten -- the record (callsign, team,
        # gun, loadout, voice) parks here so PLAY puts them straight back. Outside `players` on purpose: every
        # roster loop (readiness, kit counts, compile, push, scoring) then ignores them without a filter each.
        self.standby: dict[str, Player] = {}
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
        # F364 (Tony 2026-09-25): the station id MC handed each node_id this session, kept after a clear or a
        # release and saved in the snapshot, so a station keeps its number across its own restart, a relink and
        # an MC restart. `_auto_station_id` reads it; the operator never types an id.
        self._station_id_of: dict[str, int] = {}
        # A56 (S58): `--powerups`. Off (the default), MC refuses an item preset, compiles no spare slot, sends no
        # `item` and runs no spawn schedule; a stored item (a restored snapshot) is inert. `__main__` sets it.
        self.powerups_enabled = False
        # A56: the spawn schedule of the match in play, on MC's own clock: {"match_id", "go", "st": {nid: {...}}}.
        self._pu_sched: dict = {}
        # ...and the schedule a restarted MC read back from its snapshot (M1): adopted by `_powerup_tick` for
        # the SAME match only, so an MC restart mid-match does not bring every taken item back.
        self._pu_restored: dict | None = None
        # The per-match `game` byte a station is armed with (utility.md §5b.3 / roadmap C1). It changes on
        # the first config push AFTER a match has started, so a station in range at the next muster learns
        # that a new match exists -- `applyStationConfig` resets the point when the number changes, and
        # that reset is the ONLY between-match reset a station gets (F104 consequence c).
        self.game_no = 1
        self._game_no_started = False
        self._range_epoch = 0                  # A67: STARTs so far; a range-edit line lives for its match
        self.synced_at_lobby: dict[str, bool] = {}
        self.scan_rows: list[ScanRow] = []
        self.lan: LanView = cast(LanView, lan or {"mode": "unknown", "ip": "0.0.0.0", "port": 0, "ws_url": "", "qr": ""})
        # A28.2: 8 url-safe chars, random per session, PERSISTED with the snapshot so an MC restart does
        # not invalidate every QR already printed and taped to a wall. It is readable by anyone on the
        # LAN via GET /api/state, deliberately (§5b: the LAN is already the trust boundary) — its one
        # job is keeping internet strangers off the node socket once the tunnel is up.
        self.join_secret = secrets.token_urlsafe(6)
        self.lan.setdefault("public", PUBLIC_OFF.copy())
        # T3-A: the boot-time address warning, kept so `_refresh_lan_warning` can put it back if the public
        # path it is suppressed by goes away again.
        self._lan_warning: str | None = self.lan.get("warning")
        self.tunnel = None                        # A28.1: attached by __main__ (`attach_tunnel`)
        # F142 (field 2026-09-12): is THIS process a demo? Set by `__main__` when `--demo` seeds the
        # roster, persisted with the snapshot, and compared on restore — a demo roster must never wake
        # up inside a real match day, and a real roster must never be handed to a demo run.
        self.demo_session = False
        # F142: what the operator was never shown. Two demo players (ALPHA on GUN-A, BRAVO on GUN-B)
        # were restored into a real session; the only hint was ONE banner line in a terminal nobody was
        # looking at, and the Lobby then listed four players with two ghosts. `{at, players}` rides on
        # the state so the board can say "restored from <date>" beside a FRESH SESSION control.
        self.restored_from: RestoredFromView | None = None
        self.trying: dict[str, str] = {}          # player_id -> weapon_id
        self.browsing: dict[str, int] = {}        # A10: player_id -> t_ms the HUD opened its loadout browser
        self._policy_notice: str | None = None    # A10: "N LOADOUTS RESET BY …" — shown in config_warnings until the next config PUT
        self.active_preset_id: str | None = None  # A10 §8: the saved game that was APPLIED — GAMES marks it PLAYING (content-matching
                                                  # cannot tell a duplicate from its source: review 2026-08-27 #0)
        self.presets: PresetStore | None = None   # A10 §8: attached by __main__/create_app (memory store when absent)
        # A17: `lobby_pushed` is ALSO the real guard on `_pinned_hit_plan` below. It is set True in exactly
        # one place (`push_config`, which clears the pin as its first statement), and every path that can
        # compile (`_resend`, `_bind`, hydrate) is gated on it -- so a pin can never survive into a new
        # match even though `new_session`/`_finish`/`control` reset this flag without touching it. That
        # invariant is load-bearing and invisible from `_hit_plan` alone; do not gate a compile path on
        # anything else without re-checking it.
        self.lobby_pushed = False
        # LOAD (2026-09-13). The GAME has been announced to the phones -- mode, teams, health, night,
        # respawn, venue, the rules -- with NO frames, NO head and NO gun write. Deliberately a
        # SEPARATE fact from `lobby_pushed`: Tony, "weapons have to go with the arm". The first cut of
        # LOAD called the real config push, which compiles a weapon head per player -- and before
        # anyone has kitted that head carries policy DEFAULTS, so it wrote default loadouts to every
        # gun and re-pushed on every kit pick. `lobby_pushed` must stay FALSE through a LOAD, because
        # every guarantee hanging off it (the one-team refusal, config proofs, the stale-ack
        # gate, `kit_open`) belongs to the push that actually writes guns.
        self.game_loaded = False
        self.game_cfg: str | None = None          # the config_id the last announcement carried
        # player_id -> the ANNOUNCED `config_id` (`game_cfg`) a SOCKET accepted. Delivery, not receipt,
        # and written in ONE place (`_send_assign`) so every route that ships the same body counts.
        self.game_sent: dict[str, str] = {}
        # A LOAD can race the phone's websocket becoming writable.  Keep the retry cadence bounded;
        # a live heartbeat is the proof that the socket is available, so one later assign can cure
        # that transient without making the operator press LOAD again.
        self._game_retry_t: dict[str, int] = {}
        self._pinned_hit_plan = None      # A17: one hit-audio plan per MATCH -- see `_hit_plan`
        # Raised while a `set_config` edit is on its way to `_repush_lobby_config()`, so `_resend`'s
        # config leg stands down and ONE edit costs exactly ONE compile + push per gun.
        self._repush_pending = False
        self.acks: dict[str, dict] = {}
        self.bundles: dict[str, FrameBundle] = {}
        # 2026-09-16: player_id -> when MC last sent this player's head (a push or a hello hydrate). The
        # PRE-ARM CHECK uses it to tell a gun that is still answering from one that never will.
        self._head_sent_t: dict[str, int] = {}
        # A36: player_id -> the worded board line for a gun whose REPORTED pool disagreed with the
        # `$PSET` MC pushed it. Judged once per life in `_check_pool` (a settled frame, no hits yet)
        # and held until the next push re-arms that gun, so the operator still sees it after the
        # player has since been shot.
        self._pool_faults: dict[str, str] = {}
        # R2-4/R2-6 (polish loop iteration 2): the same judgement when the pool only SUGGESTS a stale
        # head rather than proving one -- a pool BELOW the compiled one on a clean first life (the
        # smaller stale head EXCEEDS-only is blind to), and armour ABOVE it (which `_SIR_GRANT` fn
        # 9-22 and the baked body_armor perk can both produce legitimately). Rendered as an AMBER on
        # the readiness row: it never gates a push, a CONTINUE or a whistle.
        self._pool_ambers: dict[str, str] = {}
        self.start_info: dict | None = None
        # A19: held-role pushes waiting for the node's own start / respawn flash to settle (`_queue_role`).
        self._role_due: list[tuple[int, str, str, bool, int | None]] = []
        self.start_seq = 0
        self.scorer: Scorer | None = None
        # 2026-09-16 (auto next match): the scorer of the match the operator ROLLED past. A phone that
        # flushes late still owes that match its facts, and they must reach its recap and archive row,
        # never the new match. Replaced by the next roll, dropped by a FRESH SESSION.
        self._retired_scorer: Scorer | None = None
        # F206 (2026-09-16): the station rows the retired match ended with, frozen at `_finish`.
        # `_ingest_retired` must recap the OLD match with these, not the CURRENT (next match's)
        # stations -- `_recap_stations()` reads `self.stations`, which has moved on by then.
        self._retired_stations: list[RecapStationRow] | None = None
        # F124: a frag cap reached while a BATCH is being scored waits for the batch (`ingest_batch`), so
        # the recap is snapshotted from every fact in it and not from the half the cap interrupted.
        self._batch_depth = 0
        self._pending_limit_t: int | None = None
        self._score_pushed: dict[str, dict] = {}   # A7: last ScoreRow pushed per player
        self._result_pushed: dict[str, dict] = {}  # A24: last `result` body pushed per player (minus `t`)
        # A34 (field 2026-09-12): the matches this MC has RETIRED, newest last -- match_id -> {recap, players,
        # ended_ms}. A phone that was off the network at the whistle comes back still LIVE in one of these
        # (its status says so), and MC, already on the next KIT, used to have nothing left to tell it with:
        # `start_info`, the scorer and `last_recap` were all gone. This ledger is what `_reconcile_stale_live`
        # answers from. `recap` is None for a match that was recalled / panicked / aborted (nothing to show).
        self._ended: dict[str, dict] = {}
        self._stale_told: dict[tuple[str, str | None], int] = {}   # (node_id, match_id) -> last time MC told it to end
        # Bench 2026-09-17 (MC restarted mid-match): the running match this process read back from
        # `session.json`, waiting for the store to attach (`resume_match`). None once handled.
        self._resume_pending: dict | None = None
        # Every match_id THIS process scheduled, resumed or adopted. A heartbeat naming one of these is never
        # "a match this MC did not start", even in the second between a reschedule and the new `start`.
        self._scheduled_ids: set[str] = set()
        # node_id -> {match_id, arm_state, t_minus_ms, t}: a BOUND phone reporting armed/live in a match
        # this MC did not start and never retired. Shown to the operator (`orphan_match`); nothing acts on
        # it until the operator presses RESUME MATCH or END THEIR MATCH.
        self._orphans: dict[str, dict] = {}
        # A47 operator outcome: player_id -> {match_id, cmd, state, why, sent_t, result_t}, the LAST operator
        # action sent to that player and the phone's answer (`operator_result`). Read by the LIVE row only.
        self._operator: dict[str, dict] = {}
        # (player_id, cmd) -> ms of the last accepted send: the double-tap guard (`OPERATOR_REPEAT_MS`).
        self._operator_sent_t: dict[tuple[str, str], int] = {}
        # (node_id, seq) of every `operator_result` already written to the feed: a replayed outbox is not news.
        self._operator_seen: set[tuple[str, object]] = set()
        # node_id -> (arm_state, match_id): the last claim each phone's heartbeat made (`phones_ended`).
        self._hb_claim: dict[str, tuple[object, object, int]] = {}
        # A42 (field 2026-09-12, twice): who has CONFIRMED the end of the match just ended.
        # node_id -> {match_id, player_id, since, tries, next_t, confirmed, confirmed_t, exhausted, last_ok}
        self._end_delivery: dict[str, EndDeliveryRecord] = {}
        self._end_delivery_told: str | None = None   # the match_id we have already said went unconfirmed
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
        # B7: node_ids with a log STREAM actually in flight (any `log_data` chunk received, not yet the
        # `last` one). Distinct from `_log_asked` above (which a manual ask deliberately never joins, and
        # which itself clears on the FIRST chunk so a `reconnect`+`offer` double-fire on the same hello
        # cannot re-ask a node that has already started answering). Without this, a `log_offer` the node
        # re-sends midway through an upload -- manual or automatic -- reads as a NEW offer: MC's `offer`
        # ask goes out again, the node queues it, the current upload finishes, the queued pull sends one
        # fresh line then offers again, and the pair free-runs until the per-node byte budget cuts it
        # (observed 44x, field session 2026-09-12). This set gates ONLY the log_offer handler's own
        # re-ask, never `pull_log` itself, so a manual re-press still always goes out.
        self._log_inflight: set[str] = set()
        # F121 polish review #2: node_id -> the `app_ver` string last told to the operator feed by
        # `_alert_app_withheld`. A single hello reaches `_bind` TWICE (net.py answers `_hydrate` first,
        # then fires the same hello through `_on_node`), so without this the operator would see the
        # WITHHELD line twice per hello, and again on every later heartbeat-driven `_bind` while the
        # phone stays on the same build. Cleared on `evict_node` so a genuine re-bind can say it again.
        self._app_blocked_alerted: dict[str, tuple[str, ...]] = {}
        # S16 review 2026-09-19: node_id -> the weapon ids last told to the feed by `_alert_plan_withheld`,
        # deduped for the same reason as the line above. Cleared beside it.
        self._plan_blocked_alerted: dict[str, tuple[str, ...]] = {}
        # A24/M2: the roster AS PLAYED. `_replay` must not build its Scorer from the LIVE roster --
        # the operator can re-team a player during recap, and a late flush would then replay the
        # finished match on the new teams. Frozen at `_schedule` and again at the whistle.
        self._match_players: dict[str, Player] | None = None
        # node_id -> player_id for EVERY node that spoke for a player in the match in play, connected or not.
        # `node_player` holds only the nodes bound to THIS process, so a snapshot built from it alone lost the
        # binding of a phone that had not said hello since the last restart (or that was hot-swapped out), and
        # the next resume replayed that phone's stored facts for nobody (chaos testing 2026-09-24).
        self._match_nodes: dict[str, str] = {}
        # F206: the station rows frozen at `_finish` for the match that just ended (see `_scorer_recap`).
        self._match_stations: list[RecapStationRow] | None = None
        # F401: that match's end time, kept alongside the frozen rows so LOAD can still say whether a
        # station has synced long after the operator has rolled forward (`_station_sync_warnings`).
        self._match_end_t: int | None = None
        # F401: the station nodes of that match not heard since its whistle; a heartbeat removes its node and
        # re-validates ONCE, so LOAD's warning clears without re-running `_validate` on every heartbeat.
        # Persisted (`_persist`), so an MC restart between matches, the usual routine, keeps the warning.
        self._sync_pending: dict[str, str] = {}      # node_id -> the station's label, e.g. "STICK 1"
        # F184: a station may become a HUD before the whistle. It leaves ITEMS/allow-lists immediately,
        # but its last self-authoritative report still belongs on this match's recap.
        self._departed_match_stations: dict[str, RecapStationRow] = {}
        # A58: the operator's UNLOCK STATIONS, or an END-shaped stop (abort-start). Every `station_config`
        # carries `lock_s: 0` while it is set; the next LOAD push or START clears it.
        self._stations_unlocked = False
        # A25 background log sync. `options` is the session option table (`PUT /api/options`);
        # `_log_match` is the match_id of the LAST match that ended, and `_log_done` the match whose log
        # each node has finished delivering -- the pair is the whole "did this node's log ever arrive?"
        # test that the `reconnect` ask is built on. Neither is cleared by NEW MATCH: a phone that was
        # out of coverage at the whistle still owes us that match's log ten minutes later.
        self.options: SessionOptions = cast(SessionOptions, dict(OPTION_DEFAULTS))
        self._log_match: str | None = None
        self._log_done: dict[str, str | None] = {}
        # A29: the app version on the GitHub Release, read ONCE at startup (a sidecar that changes
        # mid-session means someone cut an APK while a game was running; re-reading it per snapshot
        # would put a file read on the 4 Hz broadcast path).
        self.release_version: str | None = release_app_version()
        self.last_recap: RecapView | None = None
        self.feed: list[dict] = []
        self._listeners: list[Callable[[], None]] = []
        self._feed_listeners: list[Callable[[dict], None]] = []
        self._attach_net()
        self._render_join()
        self._gun_index()

    # ---------- the match in play ----------
    # ARMED and LIVE are the two phases with a match ON THE FIELD: a gun holds this match's head, a
    # phone counts to T-0 or scores, and MC may rewrite neither. Every guard that refuses a kit edit,
    # a head push, a station change or a phase move asks that one question, so it asks it here.
    # RECAP is deliberately NOT in play: the whistle has gone and the head is spent, so the recap
    # routes (`_live_view`, `recap()`, `snapshot()`) keep their own wider tests.

    def in_play(self) -> bool:
        """Is a match ARMED or LIVE right now?"""
        return self.phase in ("armed", "live")

    def current_match_id(self) -> str | None:
        """The match_id of the match in play, else None. None outside ARMED/LIVE even while `start_info`
        still names a match: a caller asking "is this the current match?" asks about the field, not
        about the last match MC scheduled."""
        return (self.start_info or {}).get("match_id") if self.in_play() else None

    def is_adopted(self) -> bool:
        """Is the match in play one MC ADOPTED (`adopt_orphan`, or a resume of one) rather than started?

        MC holds no config for an adopted match, so its `frag_limit`, its `time_limit_s` and its `seq`
        are the operator's CURRENT DRAFT, not the numbers the phones play to. What each caller does
        about that differs and stays at the caller; only the question is shared."""
        return bool((self.start_info or {}).get("adopted"))

    def _promote_phase(self, go: int, now: int) -> Phase:
        """Set the phase from the countdown -- ARMED before `go`, LIVE at or after it -- and return it.

        One rule for the three places that cross T-0: `tick()` at the countdown's end, and both
        pick-up paths (`resume_match`, `adopt_orphan`), which land either side of it depending on
        when MC came back."""
        self.phase = "armed" if now < go else "live"
        return self.phase

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
    _persist_path: Path | None = None   # set by __main__; None = persistence off (tests)
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
                    # F142: which KIND of run wrote this. Read back by `restore_snapshot`.
                    "demo": bool(self.demo_session),
                    "players": [{**p, "node_id": None, "ready": False} for p in self.players.values()],
                    "standby": [{**p, "node_id": None, "ready": False} for p in self.standby.values()],
                    "teams": self.teams, "config": self.config, "active_preset_id": self.active_preset_id,
                    "stations": stations, "game_no": self.game_no, "game_no_started": self._game_no_started,
                    "feed": [dict(row) for row in self.feed[:200] if isinstance(row, dict)],
                    # F401: the stations the last match still waits to hear from, and its whistle time.
                    "sync_pending": {"end_t": self._match_end_t, "nodes": dict(self._sync_pending)},
                    # F364: every id MC handed out, so a restarted MC gives a cleared station its old number back.
                    "station_ids": dict(self._station_id_of),
                    # F337 (a): the lock bookkeeping, so a restarted MC keeps an UNLOCK and every restart it counted.
                    "stations_unlocked": self._stations_unlocked,
                    "station_locks": {nid: {k: st[k] for k in _STATION_LOCK_KEYS if k in st}
                                      for nid, st in self.stations.items() if st.get("assigned")},
                    # A67: the on-station range edits already announced, so a restarted MC does not repeat them.
                    "station_range_seen": {nid: st["range_seen"] for nid, st in self.stations.items()
                                           if st.get("assigned") and st.get("range_seen")},
                    "range_epoch": self._range_epoch,
                    # A28.2: a restore must keep every printed QR valid, so the secret is human work too.
                    "join_secret": self.join_secret,
                    # Bench 2026-09-17: the match IN PLAY, so a restarted MC resumes it (`resume_match`).
                    # Absent outside armed/live: A46 still boots every other restart before any delivery.
                    **({"match": m} if (m := self._match_snapshot()) else {}),
                    # A34: the retired matches, so a restarted MC can still end a phone that missed the end.
                    "ended": self._ended_snapshot(),
                    # A56 (M1): the powerup schedule of the match in play, so a restart keeps taken items taken.
                    **({"powerups": self._pu_sched} if self._pu_sched and self.in_play()
                       and self._pu_sched.get("match_id") == self.current_match_id() else {})}
            tmp = self._persist_path.with_suffix(".tmp")
            tmp.write_text(json.dumps(snap))
            tmp.replace(self._persist_path)
        except Exception:
            import logging; logging.getLogger("brx.mc").exception("session snapshot failed (play continues)")

    def _match_snapshot(self) -> dict | None:
        """The running match, as `resume_match` needs it. Only while ARMED or LIVE with a scorer."""
        if not self.in_play() or not self.start_info or not self.scorer:
            return None
        si = self.start_info
        players = self._match_players if self._match_players is not None else self.players
        return {"match_id": si["match_id"], "go_live_t": si["go_live_t"], "seq": si["seq"],
                "countdown_s": si.get("countdown_s", 0), "adopted": self.is_adopted(),
                "config": self.config, "players": {pid: dict(p) for pid, p in players.items()},
                # node_id -> player_id as armed: the stored facts are keyed by node, and a resumed replay
                # must attribute them before any phone has said hello to the new process.
                "node_player": {nid: pid for nid, pid in {**self._match_nodes, **self.node_player}.items()
                                if pid in players},
                "synced_at_lobby": dict(self.synced_at_lobby),
                # A63: who hot-joined after go-live, and when. The stored facts cannot say it, and IRON MAN
                # and SURVIVOR both read it, so a resumed scorer must be handed it.
                "joined_t": dict(self.scorer.joined_t),
                # F356: when the frag cap's whistle blew, an arrival fact (`Scorer.cap_recv`). None in every
                # LIVE snapshot today (`_finish` rewrites the snapshot without the match), carried anyway.
                "cap_recv": self.scorer.cap_recv,
                # F362 (k): what the field was already told (the lead, cap - 1, the last survivor), so a
                # resume does not tell them again and still tells them what they never heard.
                "alerts": self.scorer.match_state_alerts(),
                # An accepted LIVE release removes the active row, but its frozen tally still belongs
                # to this match and must survive an MC restart before the whistle.
                "departed_stations": [dict(row) for row in sorted(
                    self._departed_match_stations.values(), key=lambda row: row["node_id"])],
                "bundles": self.bundles, "acks": self.acks,
                "store_path": str(self.store.path) if self.store is not None and getattr(self.store, "path", None) else None}

    def _ended_snapshot(self) -> list[dict]:
        """The newest few A34 ledger rows, JSON-safe. A bad row is dropped, never fatal."""
        out = []
        for mid, e in list(self._ended.items())[-4:]:
            out.append({"match_id": mid, "recap": e.get("recap"), "players": e.get("players"),
                        "ended_ms": e.get("ended_ms")})
        return out

    @staticmethod
    def _snapshot_player(row: object) -> Player | None:
        """Read a parked player from JSON without asserting that an arbitrary dict is a Player."""
        if not isinstance(row, dict):
            return None
        pid, num, display = row.get("player_id"), row.get("player_num"), row.get("display")
        voice, ready = row.get("voice"), row.get("ready")
        if not (isinstance(pid, str) and pid and isinstance(num, int) and not isinstance(num, bool)
                and isinstance(display, str) and isinstance(voice, str) and isinstance(ready, bool)):
            return None
        refs: dict[str, str | None] = {}
        for key in ("team_id", "node_id", "gun_id"):
            value = row.get(key)
            if value is not None and not isinstance(value, str):
                return None
            refs[key] = value
        raw_lo = row.get("loadout")
        if not isinstance(raw_lo, dict) or not isinstance(raw_lo.get("weapons"), list):
            return None
        weapons: list[WeaponSel] = []
        for weapon in raw_lo["weapons"]:
            if not isinstance(weapon, dict) or not isinstance(weapon.get("weapon_id"), str):
                return None
            weapons.append({"weapon_id": weapon["weapon_id"]})
        if not weapons or len(weapons) > 2:
            return None
        loadout: Loadout = {"weapons": weapons}
        perk = raw_lo.get("perk")
        if perk is not None:
            if not isinstance(perk, str):
                return None
            loadout["perk"] = perk
        overrides = raw_lo.get("overrides")
        if overrides is not None:
            if not isinstance(overrides, dict):
                return None
            clean: LoadoutOverrides = {}
            for key in ("max_hp", "max_armor"):
                value = overrides.get(key)
                if value is not None and (not isinstance(value, int) or isinstance(value, bool)):
                    return None
                if key == "max_hp" and value is not None:
                    clean["max_hp"] = value
                if key == "max_armor" and value is not None:
                    clean["max_armor"] = value
            # S50 (merge 2026-09-18): `easy_reload` lives in the same block and is the OTHER accessibility
            # switch, so a restore that copied the pool alone dropped it silently: restart MC between
            # matches and a player who needs ALT to reload loses it with no message anywhere.
            if overrides.get("easy_reload") is not None:
                if not isinstance(overrides["easy_reload"], bool):
                    return None
                if overrides["easy_reload"]:
                    clean["easy_reload"] = True
            if clean:
                loadout["overrides"] = clean
        player: Player = {"player_id": pid, "player_num": num, "display": display,
                          "team_id": refs["team_id"], "node_id": refs["node_id"],
                          "gun_id": refs["gun_id"], "loadout": loadout, "voice": voice, "ready": ready}
        slots = row.get("voice_slots")
        if slots is not None:
            if not isinstance(slots, dict) or not all(isinstance(k, str) and isinstance(v, str)
                                                       for k, v in slots.items()):
                return None
            player["voice_slots"] = slots
        return player

    @staticmethod
    def _snapshot_departed_station(row: object) -> RecapStationRow | None:
        """Read one frozen station tally from an untrusted JSON session snapshot."""
        if not isinstance(row, dict):
            return None
        nid, kind = row.get("node_id"), row.get("kind")
        sid, team, heard = row.get("id"), row.get("team"), row.get("heard")
        if not (isinstance(nid, str) and nid and is_station_kind(kind)
                and isinstance(sid, int) and not isinstance(sid, bool) and 1 <= sid <= 65535
                and isinstance(team, int) and not isinstance(team, bool)
                and (team in (0, 1, 2, 3) or team == STATION_TEAM_ANY)
                and isinstance(heard, bool)):
            return None
        out: RecapStationRow = {"node_id": nid, "kind": kind, "id": sid, "team": team, "heard": heard}
        if kind == "respawn":
            revives = row.get("revives")
            if revives is not None and (not isinstance(revives, int) or isinstance(revives, bool) or revives < 0):
                return None
            out["revives"] = revives
        elif kind == "control":
            hold_ms, owner = row.get("hold_ms"), row.get("owner")
            if hold_ms is not None and (not isinstance(hold_ms, dict)
                                        or not all(isinstance(k, str) and isinstance(v, int)
                                                   and not isinstance(v, bool) and v >= 0
                                                   for k, v in hold_ms.items())):
                return None
            if owner is not None and (not isinstance(owner, int) or isinstance(owner, bool)
                                      or owner not in (0, 1, 2, 3, STATION_TEAM_ANY)):
                return None
            if "hold_ms" in row:
                out["hold_ms"] = None if hold_ms is None else dict(hold_ms)
            if "owner" in row:
                out["owner"] = owner
        return out

    def restore_snapshot(self) -> int:
        """Load a prior session.json (if any). Returns the number of players restored.

        F142 (field 2026-09-12): a snapshot is restored only into a run of the SAME kind. Two demo
        players were silently restored into a real field session, sat on the roster with no phone, and
        tagging the two real phones then CREATED two more — a real match would have been pushed to a
        four-player roster with two ghosts. The kind is a marker in the file, not a guess about the
        roster, and the refusal is logged rather than silent.
        """
        if not self._persist_path or not self._persist_path.exists():
            return 0
        try:
            snap = json.loads(self._persist_path.read_text())
            was_demo = bool(snap.get("demo", False))
            if was_demo != bool(self.demo_session):
                import logging
                logging.getLogger("brx.mc").warning(
                    "session snapshot at %s is from a %s run and this is a %s run — NOT restoring its "
                    "%d player(s)", self._persist_path, "demo" if was_demo else "real",
                    "demo" if self.demo_session else "real", len(snap.get("players") or []))
                return 0
            self.players = {p["player_id"]: p for p in snap.get("players", [])}
            sp = snap.get("sync_pending")
            if isinstance(sp, dict) and isinstance(sp.get("end_t"), int) and isinstance(sp.get("nodes"), dict):
                self._match_end_t = sp["end_t"]
                self._sync_pending = {str(k): str(v) for k, v in sp["nodes"].items()}
            rows = snap.get("feed")
            self.feed = [dict(row) for row in rows if isinstance(row, dict)][:200] if isinstance(rows, list) else []
            # a snapshot from before STANDBY existed has no such list; a hand-edited one may hold junk rows
            parked: dict[str, Player] = {}
            invalid_parked = 0
            for q in snap.get("standby") or []:
                player = self._snapshot_player(q)
                if player is not None:
                    parked[player["player_id"]] = player
                else:
                    invalid_parked += 1
            if invalid_parked:
                import logging
                logging.getLogger("brx.mc").warning("ignored %d malformed standby player row(s) in %s",
                                                     invalid_parked, self._persist_path)
            self.standby = parked
            if snap.get("teams"):
                self.teams = snap["teams"]
            if snap.get("config"):
                self.config = snap["config"]
                # K8 (polish round 2): a hand-edited volume outside the range is dropped at load (the venue
                # default), rather than raising later, inside a compile.
                try:
                    if _compile.check_game_volume(self.config.get("volume")) is None:
                        self.config.pop("volume", None)
                except ValueError:
                    self.config.pop("volume", None)
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
                # F337 (a): the lock window, the restart count and the last boot seen, as the old process left them.
                kept = (snap.get("station_locks") or {}).get(nid)
                if isinstance(kept, dict):
                    self.stations[nid].update({k: kept[k] for k in _STATION_LOCK_KEYS if k in kept})
                    if not _tally_ok(self.stations[nid].get("tally")):   # polish r1: a bad tally must not raise per beat
                        self.stations[nid].pop("tally", None)
                seen = (snap.get("station_range_seen") or {}).get(nid)   # A67
                if isinstance(seen, dict) and isinstance(seen.get("max"), int) and isinstance(seen.get("edits"), list):
                    self.stations[nid]["range_seen"] = {"max": seen["max"],
                                                        "edits": [e for e in seen["edits"] if isinstance(e, dict) and _range_edit_ok(
                                                            {**e, "age_ms": 0})][-8:]}
                self.nodes.setdefault(nid, {"node_id": nid, "node_type": "utility", "arm_state": "idle",
                                            "synced": False, "last_seen_ms": 0})
            # F364: the ids MC handed out, then each restored assignment's own id (it wins over a stale entry).
            for nid, sid in (snap.get("station_ids") or {}).items():
                if isinstance(nid, str) and isinstance(sid, int) and not isinstance(sid, bool) and 1 <= sid <= 65535:
                    self._station_id_of[nid] = sid
            for nid, st in self.stations.items():
                if isinstance(sid := (st.get("assigned") or {}).get("id"), int):
                    self._station_id_of[nid] = sid
            self.game_no = snap.get("game_no", self.game_no)
            self._game_no_started = bool(snap.get("game_no_started", False))
            if isinstance(snap.get("range_epoch"), int):
                self._range_epoch = snap["range_epoch"]   # A67
            self._stations_unlocked = snap.get("stations_unlocked") is True   # F337 (a): an UNLOCK survives
            if isinstance(snap.get("join_secret"), str) and snap["join_secret"]:
                self.join_secret = snap["join_secret"]     # A28.2: the QRs already printed stay valid
                self._render_join()
            # A34: the retired-match ledger, so a phone still live in a match MC ended before the restart
            # is told to end. A row MC cannot read is skipped.
            for row in snap.get("ended") or []:
                if isinstance(row, dict) and isinstance(row.get("match_id"), str) and row["match_id"]:
                    players = row.get("players") if isinstance(row.get("players"), dict) else None
                    recap = row.get("recap") if isinstance(row.get("recap"), dict) else None
                    at = row.get("ended_ms")
                    self._ended[row["match_id"]] = {"recap": recap, "players": players,
                                                    "ended_ms": at if isinstance(at, int) else self.now_ms()}
            # Bench 2026-09-17: a match in play when the old process stopped. Held until the store is
            # attached, because the recap is rebuilt from the stored facts (`resume_match`).
            if isinstance(snap.get("match"), dict):
                # F-2026-09-17d: `resume_match` needs to know how OLD this snapshot is, to refuse
                # resuming a match nobody is playing any more. `saved_ms` lives on the outer snapshot,
                # not the nested match dict, so it is carried across here under its own key.
                self._resume_pending = {**snap["match"], "_saved_ms": snap.get("saved_ms")}
                if isinstance(snap.get("powerups"), dict):
                    self._pu_restored = snap["powerups"]      # A56 (M1): adopted for this same match only
            self._repair_player_nums()
            # S45: a snapshot persisted before `health.max_shield`/`preset` existed restores a 2-key
            # health blob -- normalize it to CUSTOM (the shield intent is unknown) rather than leaving
            # `.get("max_shield")` calls downstream to each guess 0 on their own. Idempotent on an
            # already-modern config, same "complete-or-absent" rule as `loadout_policy`/`mode_params` below.
            self.config["health"] = _compile.normalize_health(self.config.get("health"))
            # Pre-win_by snapshots carried only the cap. Restore the mode's rule explicitly so the scorer,
            # compiler and every screen cannot disagree about whether that cap is live.
            old_scoring = self.config.get("scoring") if isinstance(self.config.get("scoring"), dict) else {}
            mode_scoring = default_config(self.config["mode"])["scoring"]
            self.config["scoring"] = {
                "frag_limit": old_scoring.get("frag_limit", mode_scoring["frag_limit"]),
                "win_by": parse_win_by(old_scoring.get("win_by"), mode_scoring["win_by"]),
            }
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
            if self.players:
                # F142: the board says what came back, and from when. `saved_ms` is this machine's own
                # clock at the last write, which is exactly what "restored from <date>" needs — but
                # session.json is a file on disk that anything can write, and this value goes straight
                # out on `/api/state` for a UI to hand to `new Date(...)`. Coerce, and drop it rather
                # than publish a string or a null into a numeric field (round-2 review 2026-09-12).
                at = snap.get("saved_ms")
                at = int(at) if isinstance(at, (int, float)) and not isinstance(at, bool) else None
                self.restored_from = {"at": at, "players": len(self.players)}
            if self._sync_pending:
                self._validate()     # F401: LOAD's sync warning shows at once after a restart, not on the next edit
            return len(self.players)
        except Exception:
            import logging; logging.getLogger("brx.mc").exception("session snapshot restore failed — starting clean")
            # Polish review: a failure AFTER `self._resume_pending` was set above (e.g. `_repair_player_nums`
            # or `_gun_index` raising on a half-written file) left it holding a half-restored match dict, so
            # the NEXT `resume_match()` call -- the store attaches moments later -- would try to resume a
            # match this restore never actually finished loading. "Starting clean" must mean clean.
            self._resume_pending = None
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

    def _public(self) -> LanPublic:
        return self.lan.get("public") or PUBLIC_OFF.copy()

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

    def _refresh_lan_warning(self) -> None:
        """T3-A's "PHONES CANNOT REACH THIS ADDRESS" is a statement about the LAN address in the QR — and a
        phone that joins over the backhaul never dials it.

        MC on WSL with a tunnel up (A28) is a WORKING setup: the QR carries the public `wss://` URL
        (`_render_join`'s `&pub=`), phones connect over it, and the console was nonetheless showing a red
        alert on every screen telling the operator to go and find a Windows LAN address they do not need —
        beside a backhaul panel saying the field was reachable. A warning that fires on a working setup is
        how an operator learns to ignore the one that fires on a broken one.

        It comes BACK if the public path does (a tunnel that errors, a stop): at that moment the LAN
        address is the only way in again, and on WSL it is the wrong one. Suppressed, never deleted."""
        self.lan["warning"] = None if self._pub_url() else self._lan_warning

    def attach_tunnel(self, tunnel) -> None:
        """A28.1: MC owns at most one tunnel; its status changes drive `lan.public`, the QR and the
        `join` broadcast."""
        self.tunnel = tunnel
        tunnel.on_change(self._tunnel_changed)
        self._tunnel_changed(tunnel.public())

    def _tunnel_changed(self, pub: LanPublic) -> None:
        was = self._pub_url()
        self.lan["public"] = pub.copy()
        self._render_join()
        self._refresh_lan_warning()      # a public path makes the LAN-address warning moot (and back again)
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

    async def set_tunnel(self, on: bool) -> LanPublic:
        """`POST /api/tunnel` (A28.1). Returns `lan.public`; raises `TunnelError` (409) when there is
        nothing MC may start or stop."""
        t = self.tunnel
        if t is None:
            raise TunnelError("this Mission Control was built without tunnel support")
        if on:
            t.start(self._ws_port())
        else:
            await t.stop()
        return self._public().copy()

    @staticmethod
    def _independent_path(nv: dict) -> bool:
        """F309: can this phone reach MC WITHOUT the field Wi-Fi? Connected (not stale), through the
        tunnel (`reach`, MC's own stamp from the socket), and riding cellular by its own report
        (`transport`, the one fact only the phone has). F256: `reach` alone named only the URL, so
        two phones on one Wi-Fi behind one tunnel read as covered and were one point of failure."""
        return (nv.get("reach") == "backhaul" and not nv.get("stale")
                and nv.get("transport") == "cellular")

    def coverage(self) -> Coverage:
        """A28.4: coverage is DERIVED, not asserted. `on_backhaul` counts the bound player nodes that are
        connected (not stale) with `reach == "backhaul"`; `on_cellular` counts those with an
        independent path (`_independent_path`). `level` is `"full"` iff every bound node has one.

        A node that drops off the tunnel, goes stale, or reports Wi-Fi falls out of `on_cellular` at
        once, so coverage falls back to `"zones"` within `STALE_AFTER_MS` or one heartbeat."""
        bound = on = cell = 0
        for nid, pid in self.node_player.items():
            if pid not in self.players:
                continue
            bound += 1
            nv = self.nodes.get(nid) or {}
            if nv.get("reach") == "backhaul" and not nv.get("stale"):
                on += 1
            if self._independent_path(nv):
                cell += 1
        return {"level": "full" if bound and cell == bound else "zones",
                "on_backhaul": on, "on_cellular": cell, "bound": bound}

    # ---------- A10 loadout policy / catalog ----------
    def _catalog_rows(self) -> tuple[list[Weapon], list[PerkView]]:
        """(visible weapons, visible perks) — the rows the policy engine filters by tag."""
        return self.compiler.weapon_catalog(), self.compiler.perk_catalog()

    def policy(self) -> LoadoutPolicy:
        """The loadout ruleset in force. **PURE** — it returns a view and never writes.

        It used to store what it derived, which meant a plain `GET /api/state` mutated the session's
        config (with no `config_id` bump, so nothing downstream could tell it had moved). Every route
        that WRITES a policy already normalises — `_merge_config` runs `_policy.merge`, `set_config`
        heals whatever it ends up holding, `restore_snapshot` calls `normalize`, `default_config` uses
        `default_policy` — so the repair belongs there and this is only the fallback view for a config
        that reached `self.config` past all of them (a fixture, a direct write). Round-2 review
        2026-09-12."""
        return _policy.effective(self.config.get("loadout_policy"), self.config["mode"])

    def loadout_pool(self) -> LoadoutPool:
        weapons, perks = self._catalog_rows()
        return _policy.pool(self.policy(), weapons, perks)

    def _primary_pool_refusal(self) -> str | None:
        """F146: why is there no legal primary weapon? `None` when there is one.

        An empty primary pool blocks the push either way, but the operator has to be sent to the
        control that is actually wrong. A single "clear a class or id exclusion" line sent them to the
        class chips no matter what emptied the pool — including a `fixed_id` naming a weapon this
        game's catalog does not contain, where there are no exclusions to clear at all (round-2 review
        2026-09-12). The `kinds` case never reaches here: `policy()` heals it.
        """
        lp = self.loadout_pool()
        if lp["primary"]:
            return None
        rule = self.policy()["primary"]
        # One classifier, two vocabularies: `policy.pool()` hands out a CODE (its own copy is the HUD's,
        # shown verbatim to a player) and the console writes the operator's line for it.
        code = (lp.get("reasons") or {}).get("primary", "filtered")
        # Round-3 MERGE-4 (2026-09-13): `unplayable` is NOT a refusal. Every other code here is a rule
        # the operator wrote and can rewrite; this one says the weapon they asked for cannot be shipped
        # by THIS build (`policy.UNPLAYABLE_IDS`). `policy.apply()` has already re-fitted every loadout
        # to a legal primary, so the push is safe — blocking it would strand the operator behind a
        # limitation of ours with nothing on screen to change. `_unplayable_primary_notice()` is what
        # they see instead.
        if code == "unplayable":
            return None
        if code == "fixed_missing":
            return (f"PRIMARY FIXED TO {rule.get('fixed_id')!r}, WHICH IS NOT A WEAPON IN THIS GAME: "
                    "PICK THE FIXED PRIMARY AGAIN IN THE PRIMARY SLOT, OR SET THE SLOT BACK TO A PLAYER PICK")
        if code == "only_ids_missing":
            return ("PRIMARY LIMITED TO WEAPONS THIS GAME DOES NOT HAVE "
                    f"({', '.join(sorted(rule.get('only_ids') or []))}): CLEAR THE PRIMARY SLOT'S "
                    "ALLOW LIST, OR NAME WEAPONS THAT ARE IN THE CATALOGUE")
        return ("PRIMARY FILTER EXCLUDES EVERY WEAPON (NO LEGAL PRIMARY IS LEFT): CLEAR A CLASS OR ID "
                "EXCLUSION IN THE PRIMARY SLOT, OR PICK A PRESET")

    def _unplayable_primary_notice(self) -> str | None:
        """MERGE-4's other half: the WARNING that replaces the refusal above, naming the weapon.

        Silent self-correction is the failure this whole pass is about — every loadout quietly became
        an assault rifle and the operator's fixed pick was nowhere on screen."""
        rule = self.policy()["primary"]
        wid = _policy.unplayable_pick(rule)
        if not wid or self.loadout_pool()["primary"]:
            return None
        return (f"{wid.upper().replace('_', ' ')} CANNOT BE PLAYED (ITS HIT ROW DEALS NO DAMAGE IN THIS BUILD, "
                "SO THE PRIMARY SLOT FELL BACK TO A WEAPON THAT CAN): PICK A DIFFERENT PRIMARY IN THE GAME'S RULES")

    def health_pool(self, p: Player | None = None) -> int:
        """hp + armour a full-health player carries — what hits-to-kill is quoted against.

        Per-player `loadout.overrides` win over the game's `health`, exactly as `_gset` and
        `Compiler.validate()` read them, so the phone's stat block is the truth for THAT player.
        Field 2026-08-30 shipped a hardcoded 115 in `views.py`, so KIT and ARSENAL both claimed the
        AR takes 13 hits however the host had set health (docs/weapon-design.md §2.5).

        ⚠ This must mirror `Compiler._to_gc()`'s armour arithmetic EXACTLY — including the
        `body_armor` perk's pool-percentage grant (S50) and the 255 policy ceiling — because that is
        what actually goes out on `$PSET`. Review 2026-09-01 caught it missing the perk: a player
        holding `body_armor` is armed at a bigger pool than KIT quoted. A stat block that is wrong
        for the one perk that moves the pool is worse than one that never claimed to be per-player.
        The arithmetic itself lives in `compile.armed_pool()` (shared with `_to_gc()` and
        `Compiler.validate()`); this method's own job is just resolving which hp/armor/perk win for
        THIS player. Deliberately excludes shield (S50, `compile.armed_pool()`'s own docstring): a
        base-armour-0 game routes the grant into shield instead, and this number does not move for
        it, same as `Compiler.validate()`'s pool check."""
        h = self.config.get("health") or {}
        ov = ((p or {}).get("loadout") or {}).get("overrides") or {}

        def n(key: str, default: int) -> int:
            v = ov.get(key, h.get(key, default))
            try:
                return int(v)
            except (TypeError, ValueError):
                return default

        from .compile import armed_pool, is_shields_preset   # the one shared arithmetic (see docstring)
        pid = ((p or {}).get("loadout") or {}).get("perk")
        return max(1, armed_pool(n("max_hp", 45), n("max_armor", 70), pid, is_shields_preset(self.config)))

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
                "catalog": self._catalog_views(p), "policy": pol, "game": self.game_brief(),
                # A40: the bench fact is STATED on every assign AND every welcome, never left to be
                # inferred from an absent key. `standby` is PERSISTED on the phone (engine.js `_save`),
                # so "no key" cannot mean "you are playing" -- it means "keep believing whatever you last
                # believed". That is exactly how a benched player whose phone locked or walked out of
                # range before the operator tapped PLAY came back still SITTING OUT, with no frames, no
                # READY UP and no control on screen, while the console showed them rostered (T2 review S1).
                "standby": p["player_id"] in self.standby}

    def _send_assign(self, p: Player, extra: dict | None = None) -> bool:
        """Push `assign` to `p`'s node and record that this phone has been told the ANNOUNCED game.

        `game_sent` used to be written in exactly one place -- `load_game`'s own loop -- so it
        described the phones that happened to be bound AT THE MOMENT OF THE LOAD and nothing else.
        Every other route that delivers the same body leaves the phone genuinely holding the current
        game: `_resend` on a pick or a re-team, `_sync_kit_open`, and above all the welcome in
        `_hydrate` (`engine.js` stores `node.game` from the welcome and from `assign` alike). In the
        ordinary order of a night -- LOAD at build, players walking up afterwards -- almost every
        phone's first sight of the game arrives on one of those, so the column was permanently short.
        A check that always reads failure about phones that are fine is a check the operator learns to
        ignore, which is worse than not having it.

        Stamped with `game_cfg`, the ANNOUNCED game, and not with `self.config["config_id"]`: a head
        re-push mints a fresh config id without changing what the phones were told (the brief is the
        mode and the rules, never the head), so keying the tick to the head would blank the phone
        column on every re-team. Nothing is stamped before a LOAD -- with no announcement there is
        nothing a delivery could be evidence of.
        """
        nid = p.get("node_id")
        if not nid:
            return False
        body = self._assign_body(p)
        if extra:
            body = {**body, **extra}
        ok = bool(self.net.push(nid, "assign", body))
        if ok and self.game_loaded and self.game_cfg and p["player_id"] in self.players:
            self.game_sent[p["player_id"]] = self.game_cfg
        return ok

    def _off_grid(self) -> list[str]:
        """A28/A31: the rostered players whose phone cannot be reached after the whistle, by display name.

        A phone is off-grid when it has no backhaul — no route to MC from wherever the match is being
        played — so an MC-decided end (a frag cap, an objective, a survival win) never reaches it and the
        player has to come back to find out how it ended.

        F309: "has backhaul" is `_independent_path`, the same test `coverage()` uses: a phone on the
        tunnel that is riding the field Wi-Fi loses MC exactly when the field Wi-Fi does. This used to
        read a `backhaul` key nothing ever set, so every phone was off-grid (the safe direction). A
        player with no bound node at all is off-grid for the stronger reason: there is no phone to push
        anything to.
        """
        out: list[str] = []
        for p in self.players.values():
            nv = self.nodes.get(p.get("node_id") or "", {})
            if not p.get("node_id") or not self._independent_path(nv):
                out.append(str(p.get("display") or p["player_id"]))
        return out

    def _mc_verify_player_line(self) -> str | None:
        """A31: the line every PLAYER sees on ARMED, or None. Compiled once in `compile.mc_verify`."""
        return _compile.mc_verify(self.config, None, bool(self._off_grid()))

    def _notices(self) -> NoticesView:
        """A31: the HOST's standing lines (API.md `State.notices`). Same decision as the player's line —
        the compiler makes it once — but the host's copy NAMES the phones, because the host is the one
        who can walk over and tell those players to come back."""
        out: NoticesView = {}
        off = self._off_grid()
        if self._mc_verify_player_line():
            shown = ", ".join(off[:6]) + (f" +{len(off) - 6} MORE" if len(off) > 6 else "")
            out["mc_verify"] = (f"WIN IS CONFIRMED AT MC, {len(off)} PHONE{'S' if len(off) != 1 else ''} OFF-GRID "
                                f"({shown}): TELL PLAYERS TO RETURN AFTER THE WHISTLE")
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
        preset_lbl = _policy.PRESET_LABELS.get(pol.get("preset") or "", "")
        saved = None
        try:
            if self.presets is not None:
                sig = {k: v for k, v in cfg.items() if k not in ("config_id", "vip_player_id")}   # A19: never in a saved game, so never in the match
                saved = next((r for r in self.presets.list() if {k: v for k, v in r["config"].items() if k != "config_id"} == sig), None)
        except Exception:
            saved = None
        scoring = cfg.get("scoring") or {}
        if scoring.get("win_by") in (None, "", "kills"):
            cap = scoring.get("frag_limit")
            win_text = (f"{'FRAG LIMIT' if cfg.get('mode') == 'ffa' else 'SCORE CAP'} {cap} / TIME"
                        if cap is not None else "TIME ONLY")
        else:
            win_text = mode.get("win_text")
        return {
            "name": (saved or {}).get("name") or mode.get("name") or str(cfg.get("mode", "")).upper(),
            "desc": (saved or {}).get("desc") or mode.get("brief") or mode.get("desc") or "",
            "mode": cfg.get("mode"), "mode_name": mode.get("name"), "abbr": mode.get("abbr"),
            "teams_text": mode.get("teams_text"), "win_text": win_text, "respawn_text": mode.get("respawn_text"),
            "time_limit_s": cfg.get("time_limit_s"), "respawn": cfg.get("respawn"), "health": cfg.get("health"),
            "environment": cfg.get("environment"), "night": bool(cfg.get("night")),
            "loadout_line": ", ".join(parts) + ".", "ruleset": preset_lbl, "hud_select": bool(pol.get("hud_select")),
            # Q13: present ONLY where compile keeps team damage off (`compile.team_damage_on`); a solo game
            # (FFA, solo LMS) has no teammates, so the briefing shows no row.
            **({"team_damage": "off"} if not _compile.team_damage_on(cfg) else {}),
            # A31: present ONLY when this match needs it, so a node can treat presence as the rule.
            **({"mc_verify": mcv} if (mcv := self._mc_verify_player_line()) else {}),
            # F403: the game's pickups, each item once in station order; present ONLY when an item is active.
            **({"pickups": pk} if (pk := self._brief_pickups()) else {}),
        }

    def _brief_pickups(self) -> list[dict]:
        """F403: `[{name, color}]` for the BRIEFING's PICKUPS line, from the items this run carries (`_item_stations`)."""
        seen: set[str] = set()
        out: list[dict] = []
        for _nid, _a, item in self._item_stations():
            name = str(item.get("name") or item.get("weapon_id") or item.get("kind") or "")
            if name and name not in seen:
                seen.add(name)
                out.append({"name": name, "color": item.get("color") or ""})
        return out

    def load_game(self) -> dict:
        """LOAD: tell every bound phone WHICH GAME is loaded. No frames, no head, no gun write.

        Tony, 2026-09-13: "weapons have to go with the arm." The first cut of LOAD called
        `push_config`, which compiles a per-player weapon head -- and nobody has kitted at that point,
        so it wrote POLICY-DEFAULT loadouts to every gun and then re-pushed on every kit pick.

        This sends `assign`, the body a phone already gets on a hello or a roster change. It carries
        `game_brief()` (mode, teams, win condition, respawn, health, venue, night, the loadout rules)
        and the kit-open policy, and `engine.js _assign` stores them without touching the gun. It is
        `assign` and not `config` because `envelope.REQUIRED["config"]` makes `frames` MANDATORY: a
        frameless `config` is dropped by the node's own validator before the engine ever sees it, so
        "a config with no frames" is not a thing this wire can express. No contract change needed.

        `lobby_pushed` is NOT set. The LOBBY push remains the first and only write to a gun and keeps
        every gate that hangs off it; `start()` still refuses with "push config first".
        """
        if self.in_play():
            raise ValueError("cannot load a game once the match has started - ABORT or RECALL first")
        self._roll_forward_from_recap()        # a LOAD after the whistle loads the NEXT match
        cfg_id = self.config["config_id"]
        self.game_loaded = True
        self.game_cfg = cfg_id
        # DELIVERY, not receipt: `net.push` answers whether a socket took the frame. The phone cannot
        # tell us which game it holds -- its heartbeat reports `config_id` from `this.config`
        # (engine.js), which only a FRAMES push sets -- so this is the honest fact available, and the
        # console words it as "sent", never as "have".
        # A fresh announcement retires every earlier delivery, so the record is cleared here and
        # re-stamped by `_send_assign` -- the one place a delivery is written (see its docstring).
        self.game_sent = {}
        self._game_retry_t = {}
        for p in self.players.values():
            self._send_assign(p)
        if self.phase == "muster":
            self.phase = "build"
        self._changed()
        return {"ok": True, "config_id": cfg_id, "sent": len(self.game_sent), "total": len(self.players)}

    def game_sent_n(self) -> int:
        """How many rostered players a socket accepted the ANNOUNCED game's `assign` for.

        Counted against `game_cfg` and not against the live `config_id`: the two diverge whenever a
        head is re-pushed without a re-announcement (a re-team after the lobby push mints a fresh id
        so the new head can be proven -- `_fresh_head_repush` -- and tells the phones nothing new,
        because the GAME did not change). Counting against the head would read that as every phone
        having been un-told."""
        cur = self.game_cfg
        if not cur:
            return 0                 # nothing announced: no delivery is evidence of anything yet
        return sum(1 for p in self.players.values() if self.game_sent.get(p["player_id"]) == cur)

    def sync_summary(self) -> SyncView:
        """The pre-arm answer to "is the field in sync?" -- per player, and as an HONEST total.

        LOAD split one event into two. Before it, "the game is loaded" and "the guns are configured"
        happened together at the push; now a phone can hold the current game while its gun has never
        been given weapons at all, and the second half only happens at the LOBBY push. So arming has
        to verify BOTH halves and say which one is missing, for which player.

        Four independent facts per player, never collapsed into one tick:
          `phone_game`  a socket took the ANNOUNCED game's `assign` (delivery -- see `_send_assign`)
          `gun_sent`    MC compiled and SENT this config's frames for this player (`bundles`)
          `gun_acked`   the gun answered for THIS `config_id` (A36 `_ack_is_current`)
          `gun_echo`    "proven" | "mismatch" | "not_echoed" (`_echo_state`; `not_echoed` is the
                        ordinary v4.32 answer and is neutral, never a fault)

        NO COUNT MAY READ AS SATISFIED BECAUSE NOTHING WAS CHECKED. Every total is reported against
        the ROSTERED count, and `in_sync` is False for an empty roster -- the "ALL GUNS ON THIS CONFIG
        (0/8)" defect of 2026-09-13 was exactly a vacuously-true predicate (`all_acked()` skips every
        player with no node bound) rendered as a claim about everybody.
        """
        cur = self.config.get("config_id")
        now = self.now_ms()
        rows: list[SyncRow] = []
        for p in self.players.values():
            pid = p["player_id"]
            bundle = self.bundles.get(pid) or {}
            # 2026-09-16: the gun columns describe THIS lobby's push and nothing older. `bundles` outlives
            # `_finish()` (the victory cue reads it) and the config_id survives a finished match, so a
            # debrief used to show PUSHED for a head from the match before. No push, no gun facts.
            sent = self.lobby_pushed and bool(bundle) and bundle.get("config_id") == cur
            acked = self.lobby_pushed and self._ack_is_current(pid)
            rows.append({
                "player_id": pid, "display": p.get("display") or pid,
                "gun_id": p.get("gun_id") or "", "player_num": p.get("player_num") or 0,
                "bound": bool(p.get("node_id")),
                # the ANNOUNCED game (`game_cfg`), not the head: see `game_sent_n`. Guarded against
                # `game_cfg` being None, or "told nobody" would compare equal to "told everybody".
                "phone_game": bool(self.game_cfg) and self.game_sent.get(pid) == self.game_cfg,
                "gun_sent": sent,
                "gun_acked": acked,
                "gun_echo": self._echo_state(pid),
                "ack_state": self._sync_ack_state(p, sent, acked, now),
            })
        rows.sort(key=lambda r: r["player_num"])
        n = len(rows)
        tot: SyncTotals = {
            "rostered": n,
            "phone_game": sum(1 for r in rows if r["phone_game"]),
            "gun_sent": sum(1 for r in rows if r["gun_sent"]),
            "gun_acked": sum(1 for r in rows if r["gun_acked"]),
            "gun_echo_proven": sum(1 for r in rows if r["gun_echo"] == "proven"),
            "in_sync": False,
        }
        # The ARM question, stated once: every rostered gun has taken THIS config and answered for it.
        # `gun_echo` is deliberately NOT part of it -- `not_echoed` is what our v4.32 units normally
        # answer (A37), so requiring it would refuse every whistle in the field.
        tot["in_sync"] = n > 0 and tot["gun_sent"] == n and tot["gun_acked"] == n
        return {"rows": rows, "totals": tot,
                "unconfigured": [r["display"] for r in rows if not r["gun_acked"]]}

    def _sync_ack_state(self, p: Player, sent: bool, acked: bool, now: int) -> SyncAckState:
        """The PRE-ARM CHECK's ACKED cell as one word (2026-09-16). Presentation only: no gate reads it.

        `waiting` is the ordinary seconds after a push and must never look like a fault. `failed` is kept
        for the three things that will not cure themselves: the gun answered THIS head and refused it (or
        sent no echo), the phone is not bound or has gone quiet, or nothing came back inside
        `SYNC_ACK_TIMEOUT_MS`."""
        if acked:
            return "acked"
        if not sent:
            return "none"
        pid = p["player_id"]
        ack = self.acks.get(pid)
        if ack is not None and ack.get("config_id") == self.config.get("config_id"):
            return "failed"
        nid = p.get("node_id")
        if not nid or now - (self.nodes.get(nid) or {}).get("last_seen_ms", 0) > STALE_AFTER_MS:
            return "failed"
        t = self._head_sent_t.get(pid)
        if t is None or now - t > SYNC_ACK_TIMEOUT_MS:
            return "failed"
        return "waiting"

    def _refuse_unconfigured_gun(self, force: bool = False) -> None:
        """No whistle while a rostered player's gun has never taken THIS config AT ALL.

        `all_acked()` asks its question only of players WITH A NODE BOUND -- so a rostered player
        whose phone never arrived, or whose node was unbound after the push, was skipped entirely and
        the start went through with nothing said about them. ABSENCE and STALENESS are different
        failures and only staleness was caught: `_refuse_stale_ack` catches a gun naming an OLDER
        head, this catches a gun that has named NONE. LOAD is what makes the gap reachable in a new
        way -- a phone can now hold the game while its gun has no head at all.

        FORCEABLE, and deliberately so: a phone that has not arrived yet HOT JOINS on its bind
        (`_bind` pushes the bundle and the running `start`), which is a real and supported way to
        field a late player. What must not happen is starting without being TOLD -- so the refusal
        names every player it is about, and `force` is the operator saying they know.
        """
        if force:
            return
        # TWO failures, named separately, because they have different causes and different fixes.
        # A player whose phone IS bound but whose gun has not answered for this head is the case
        # `all_acked()` already asked about -- and the word it is asked by, "acked", is load-bearing
        # (`test_mc_state`'s MERGE-2 guard reads the refusal for it). A player with NO phone bound was
        # skipped by `all_acked()` ENTIRELY: that is the absence this gate exists for, and the one
        # LOAD makes newly reachable, because a phone can now hold the game while its gun has no head.
        unacked = [p.get("display") or pid for pid, p in self.players.items()
                   if p.get("node_id") and not self._ack_is_current(pid)]
        never = [p.get("display") or pid for pid, p in self.players.items()
                 if not p.get("node_id") and not self._ack_is_current(pid)]
        parts = []
        if unacked:
            parts.append(f"{len(unacked)} gun(s) have not acked this config: {', '.join(unacked)}")
        if never:
            parts.append(f"{len(never)} player(s) have no phone bound, so their gun has never been "
                         f"sent this config at all: {', '.join(never)}")
        if parts:
            raise ValueError(" · ".join(parts) + ". A gun with no head cannot play — PUSH CONFIG on "
                             "LOBBY (or move them to STANDBY) before the whistle")

    def _sync_kit_open(self) -> None:
        """Re-send `assign` to every bound node when kit_open flips (phase/push transitions) so the HUD switches
        between "setting up" and the kit editor without waiting for an unrelated change."""
        cur = self.kit_open()
        if cur == getattr(self, "_kit_open_sent", None):
            return
        self._kit_open_sent = cur
        for pl in self.players.values():
            if pl.get("node_id"):
                self._send_assign(pl)

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
            label = _policy.PRESET_LABELS.get(self.policy().get("preset") or "", "THE LOADOUT RULES")
            try:
                if self.active_preset_id and self.presets is not None:
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
            if self.lobby_pushed:
                self.arm_stations(relock=True)     # A58: back in a pushed LOBBY, the LOAD lock again (as set_phase)

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

    def _check_gun_free(self, gun_id: str, except_pid: str | None = None) -> None:
        """A gun belongs to one player: rostered OR parked on STANDBY (2026-09-12). The parked case names the
        way back -- an API caller or the ARMORY claim form used to be able to hand a benched player's gun to a
        new callsign, and PLAY then refused with the collision it had just been allowed to create."""
        g = gun_id.lower()
        for q in self.players.values():
            if q["player_id"] != except_pid and (q.get("gun_id") or "").lower() == g:
                raise ValueError(f"gun {gun_id} is already assigned to {q['display']}")
        for q in self.standby.values():
            if q["player_id"] != except_pid and (q.get("gun_id") or "").lower() == g:
                raise ValueError(f"gun {gun_id} is on standby with {q['display']} - PLAY puts them back")

    def add_player(self, display: str, team_id: str | None = None, gun_id: str | None = None,
                   voice: str = "male", loadout: dict | None = None, voice_slots: dict | None = None) -> Player:
        if len(self.players) >= MAX_PLAYERS:
            raise ValueError("roster full")
        voice_slots = _voices.check_slots(voice_slots)      # A15: {role: id} $PSET picks; bad role / off-gun id -> ValueError
        if gun_id:
            self._check_gun_free(gun_id)
        pid = uuid.uuid4().hex[:8]
        team_id = self._check_team(team_id)
        if team_id is None and self.teams:
            counts = {t["team_id"]: 0 for t in self.teams}
            for p in self.players.values():
                if p["team_id"] in counts:
                    counts[p["team_id"]] += 1
            team_id = min(counts, key=lambda k: (counts[k], list(counts).index(k)))
        lo: Loadout = self._check_loadout(loadout) if loadout else {"weapons": [{"weapon_id": "assault_rifle"}]}
        lo = _policy.apply(self.policy(), self.loadout_pool(), lo, *self._catalog_rows())   # §3.3: a new player obeys the ruleset
        p: Player = {"player_id": pid, "player_num": self._next_num(), "display": _check_tag(display) or f"OPERATOR {pid[:4]}",
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
            # ...and in the match roster the snapshot carries. `_match_snapshot` keeps a node's binding
            # only for a player in `_match_players`, so an MC restart dropped the hot joiner's binding and
            # the resumed scorer ignored every fact they had sent (chaos testing 2026-09-24).
            if self._match_players is not None:
                self._match_players[pid] = p.copy()
        if gun_id:
            self._adopt_node_for_gun(p)
        self._after_player_change(p)
        if self.in_play():               # F329: a hot joiner is in the snapshot before any crash can drop them
            self._persist_dirty = True
            self.persist_now()
        return p

    def patch_player(self, pid: str, **fields) -> Player:
        p = self.players[pid]
        if self.in_play():
            # Only the fields that would be COMPILED to the gun are refused. A ready flag and a gamertag
            # ride in `assign` (roster/display) and never touch the head, so they stay.
            locked = [k for k in _KIT_FIELDS if k in fields and fields[k] is not None]
            if locked:
                raise ConflictError(_KIT_LOCKED_HOST.format(phase=self.phase.upper(), what="/".join(locked)))
            # B1 (2026-09-12): a TEAM change is NOT a display-only `assign`. The gun's $TID lives in the
            # config head (compile.py), and A30 locks the head once the match starts -- so a mid-match
            # re-team used to move only the beacon/LED/scorer while combat kept resolving on the OLD team
            # (a same-team shot does no damage). MC must never let the roster's team and the gun's $TID
            # silently disagree, so this is refused LOUDLY. The scorer's own re-team (below) is reached
            # only in pre-start or recap now, where the head is free to be rewritten.
            # F-5 (2026-09-13): an explicit `team_id: null` used to hit this same check -- `_check_team(None)`
            # is `None`, which reads as a "change" against any rostered player's real team and 409'd on
            # what a caller meant as NO instruction (some client always carries the field). `None` here
            # is "no change": drop it before the equality check (and out of `fields` entirely, so the
            # general write loop below cannot re-apply it as a clear) rather than refuse it as one. An
            # actual named team that differs from the player's own is still refused exactly as before --
            # pre-match `team_id: null` still clears the team (test_mc_polish.py), only armed/live reads
            # `None` as "nothing asked".
            if "team_id" in fields and fields["team_id"] is None:
                fields = {k: v for k, v in fields.items() if k != "team_id"}
            elif "team_id" in fields and self._check_team(fields["team_id"]) != p.get("team_id"):
                raise ConflictError(
                    f"the match is {self.phase.upper()}: changing a player's TEAM now moves the beacon, "
                    "LEDs and scoring but NOT the gun's $TID -- combat would still resolve on the old "
                    "team and same-team shots would do no damage. RECALL to return the field to KIT, "
                    "change teams there, and re-push")
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
            d = _check_tag(str(fields["display"]))
            if not d:
                raise ValueError("display must not be empty")
            fields["display"] = d
        if fields.get("gun_id"):
            self._check_gun_free(str(fields["gun_id"]), except_pid=pid)
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
        """A9.1: best-effort `apply{preview}` of the voice family's INTRO line so a VOICE/gamertag change
        is audible on the bound tagger. One $PLAY frame — the node's preview gate drops anything that
        isn't $PLAY/$SFLASH and ignores a preview once past LOBBY, so this is safe to fire optimistically.

        S39 (field 2026-09-12, Tony): the preview used to play the KILL line, which tells the operator
        nothing about the character they just picked. The intro is that character introducing
        themselves. A family with no intro take falls back to the kill line rather than going silent."""
        nid = p.get("node_id")
        if not nid:
            return
        voice, slots = p.get("voice") or "male", p.get("voice_slots")
        try:
            prev = getattr(self.compiler, "voice_preview", None)
            cue = prev(voice, slots) if callable(prev) else self.compiler.cues(voice, slots).get("kill")
        except Exception:
            cue = None
        if cue:
            self.net.push(nid, "apply", {"preview": True, "frames": [cue]})

    def _voice_ids(self) -> set[str]:
        ids = {"male", "female"}
        for o in self.compiler.voice_options():
            if o["id"]:
                ids.add(o["id"])
        return ids

    def _check_loadout(self, lo) -> Loadout:
        """Loadout must be {weapons: [{weapon_id}] | [{primary}, {secondary}], perk?: perk_id,
        overrides?: {max_hp?, max_armor?, easy_reload?}}; ids from the catalog when known. A14: `perk`
        is its own slot beside the weapons (loadout.md §2). S50 (2026-09-17): Easy Reload moved OUT of
        the perk slot to `overrides.easy_reload` (accessibility, not balance) — the one pairing the
        hardware forbids (the ALT button + a second weapon, or a chain-reload primary) is still a
        POLICY reject, not a shape error: `policy.conflict`/`chain_conflict` read it from here."""
        if not isinstance(lo, dict) or not isinstance(lo.get("weapons"), list) or not lo["weapons"]:
            raise ValueError("loadout must be {weapons: [{weapon_id}, ...]}")
        if len(lo["weapons"]) > 2:
            raise ValueError("loadout.weapons holds at most a primary and a secondary")
        known = {w["weapon_id"] for w in self.compiler.weapon_catalog()}
        weapons: list[WeaponSel] = []
        for w in lo["weapons"]:
            if not isinstance(w, dict) or not isinstance(w.get("weapon_id"), str) or not w["weapon_id"]:
                raise ValueError("each loadout weapon needs a weapon_id")
            if known and w["weapon_id"] not in known:
                raise ValueError(f"unknown weapon_id {w['weapon_id']!r}")
            weapons.append({"weapon_id": w["weapon_id"]})
        out: Loadout = {"weapons": weapons}
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
            clean: LoadoutOverrides = {}
            # armour may be 0 (the game config allows it: "0 means one-shot with a sniper"), so a
            # per-player override must be able to say 0 too, or the handicap can raise a pool but
            # never strip one. HP 0 is not a pool, it is a corpse.
            for k, lo_ in (("max_hp", 1), ("max_armor", 0)):
                if k in ov and ov[k] is not None:
                    v = ov[k]
                    if isinstance(v, bool) or not isinstance(v, int) or not lo_ <= v <= 999:
                        raise ValueError(f"overrides.{k} must be an integer {lo_}..999")
                    if k == "max_hp":            # written key by key: `clean` is a TypedDict, not a bag
                        clean["max_hp"] = v
                    else:
                        clean["max_armor"] = v
            # S50: Easy Reload's ALT-button remap, now a per-player accessibility flag instead of a
            # perk pick (docs/spec/loadout.md §2) — "the host sets once" (FOLLOWUPS S50), independent
            # of `max_hp`/`max_armor` (a left-handed player takes it with no extra health; a younger
            # player takes it WITH one). Shape only here; the hardware pairing it can't ride with (a
            # second weapon, or a chain-reload primary) is `policy.conflict`/`chain_conflict`'s job,
            # read off `loadout.overrides.easy_reload` — same POLICY-reject split as before S50.
            if "easy_reload" in ov and ov["easy_reload"] is not None:
                v = ov["easy_reload"]
                if not isinstance(v, bool):
                    raise ValueError("overrides.easy_reload must be a boolean")
                if v:
                    clean["easy_reload"] = v
            if clean:
                out["overrides"] = clean
        return out

    def remove_player(self, pid: str) -> None:
        if pid in self.standby and pid not in self.players:
            self.standby.pop(pid)            # a parked player is not on any wire: dropping it needs no phase gate
            self._changed()
            return
        if self.phase not in self.ROSTER_PHASES:
            raise ValueError("cannot remove a player after the match has started")
        self._unroster(pid)
        self._changed()

    def _unroster(self, pid: str) -> Player:
        """Take `pid` off the roster: unbind its node, forget its acks/bundle/try-out/browse. The shared
        body of REMOVE and STAND DOWN; the caller decides whether the record is kept."""
        p = self.players.pop(pid)
        nid = p.get("node_id")
        if nid:
            self.node_player.pop(nid, None)
            nv = self.nodes.get(nid)
            if nv is not None:
                nv.pop("player_id", None)
        self.acks.pop(pid, None); self.bundles.pop(pid, None); self.trying.pop(pid, None); self.browsing.pop(pid, None)
        self._head_sent_t.pop(pid, None)
        # ...and what their phone was TOLD. The last thing it heard from us is `stand_down`'s benched
        # `assign`, which is the opposite of holding the game -- so a STAND DOWN + PLAY that left the
        # tick standing handed the player back a green phone column for a phone last told to sit out.
        self.game_sent.pop(pid, None)
        # A37: and the A36 pool judgement, which is a fact about the head that just went with the
        # bundle. It was outliving both, so a STAND DOWN + PLAY handed the player back their old red.
        # R2-4/R2-6: the amber grade of the same judgement goes with it, for the same reason.
        self._pool_faults.pop(pid, None); self._pool_ambers.pop(pid, None)
        return p

    def stand_down(self, pid: str) -> Player:
        """STANDBY: pull a player out of the roster without forgetting them (Tony 2026-09-12: "pull them out
        into standby" -- a player who walked away mid-lobby). The record parks in `self.standby`; the node is
        unbound and drops back to a plain connected phone, so the next push, the readiness board and the kit
        counts no longer wait on it. `reinstate` is the way back. Roster phases only, like REMOVE.

        T2-B item 2 (2026-09-13, closes the v1 gap documented until now): if the player's phone is still
        connected, it gets ONE extra `assign` -- the same shape `_assign_body` always builds, plus
        `standby: true` (contracts A38) -- so `engine.js` can drop it to a SITTING OUT screen instead of
        leaving its last `assign` to go stale. Still no `config`/frames: an unbound node is never in
        `self.players`, so `push_config`/`_repush_lobby_config` (which loop the roster, not the sockets)
        cannot reach it, re-push or no."""
        if pid not in self.players:
            raise KeyError(pid)
        if self.phase not in self.ROSTER_PHASES:
            raise ValueError("cannot stand a player down after the match has started")
        p = self._unroster(pid)
        nid = p.get("node_id")
        parked: Player = {**p, "node_id": None, "ready": False}
        self.standby[pid] = parked
        if nid:
            self.net.push(nid, "assign", {**self._assign_body(parked), "standby": True})
        self._changed()
        return parked

    def reinstate(self, pid: str) -> Player:
        """PLAY: put a parked player back on the roster. Mirrors `add_player` for everything that can have
        changed while they sat out -- the gun may have been handed to someone else (refused, naming them), the
        team may be gone (auto-balanced), the policy may have tightened (the loadout is re-fitted) -- and keeps
        their `player_num` when it is still free so the wire id they were briefed with survives."""
        if pid not in self.standby:
            raise KeyError(pid)
        if self.phase not in self.ROSTER_PHASES:
            raise ValueError("cannot reinstate a player after the match has started")
        if len(self.players) >= MAX_PLAYERS:
            raise ValueError("roster full")
        parked = self.standby[pid]
        gun_id = parked.get("gun_id")
        if gun_id:
            for q in self.players.values():
                if (q.get("gun_id") or "").lower() == gun_id.lower():
                    raise ValueError(f"gun {gun_id} is now assigned to {q['display']}")
        team_id = parked.get("team_id")
        if team_id is not None and not any(t["team_id"] == team_id for t in self.teams):
            team_id = None
        if team_id is None and self.teams:
            counts = {t["team_id"]: 0 for t in self.teams}
            for q in self.players.values():
                if q["team_id"] in counts:
                    counts[q["team_id"]] += 1
            team_id = min(counts, key=lambda k: (counts[k], list(counts).index(k)))
        lo = _policy.apply(self.policy(), self.loadout_pool(), parked.get("loadout") or {"weapons": [{"weapon_id": "assault_rifle"}]}, *self._catalog_rows())
        used = {q["player_num"] for q in self.players.values()}
        num = parked.get("player_num")
        if not isinstance(num, int) or num in used or not (1 <= num <= MAX_PLAYERS):
            num = self._next_num()
        self.standby.pop(pid)
        p: Player = {**parked, "player_num": num, "team_id": team_id, "node_id": None, "loadout": lo, "ready": False}
        self.players[pid] = p
        # (no scorer registration here, unlike add_player: reinstate is ROSTER_PHASES-only and the scorer
        # exists only from START, so that branch could never run -- review 2026-09-12)
        if gun_id:
            self._adopt_node_for_gun(p)
        self._after_player_change(p)
        return p

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

        The config leg is a WHOLE-ROSTER re-push under a fresh `config_id` (`_fresh_head_repush`), not
        a lone `_push_config_to(p)`. One player's pick changes one player's head, but the id that
        PROVES a head is MC-wide, so it cannot move for one gun alone -- see that method for why
        moving it is not optional.

        ⚠ ARMED/LIVE: the config leg is skipped for a node that has already TAKEN this match's config,
        because the kit is locked once a match starts (`KIT_LOCKED`, A30). `assign` still goes -- it is
        roster and display, it never reaches the gun -- and every caller that could change what is
        COMPILED refuses before it gets here, so that skip is a backstop, not a silent drop. A node that
        has NOT taken the config still gets it, plus the same `start`: that is the hot join (E5, see
        `_took_this_config`). Pinned by `tests/test_mc_loadout_after_start.py`."""
        nid = p.get("node_id")
        if nid:
            self._send_assign(p)
        # `_repush_pending`: a `set_config` edit is about to re-push the WHOLE roster from
        # `_repush_lobby_config()`, so taking the config leg here too pushes every re-kitted gun twice.
        if self.lobby_pushed and not self._repush_pending:
            if not self.in_play():
                # Round-2 fix pass H (2026-09-12) is covered by this too, and for free: an UNBOUND
                # player has no socket to push to, but `self.bundles[pid]` is what a RECONNECTING phone
                # is handed (`_hydrate` ships the stored frames beside the current `config_id`), so
                # leaving it on the pre-edit compile is the stale-head defect in its other clothes.
                # `_repush_lobby_config` compiles for EVERY player and sends only to those with a
                # socket, which is exactly the invariant that pass wanted; Round-3 MERGE-2's ack drop
                # rides along, because `_push_config_to` retires the ack beside every recompile.
                self._fresh_head_repush()
            elif nid and not self._took_this_config(p):
                # THE HOT JOIN, and the one recompile that must KEEP the id: `start` has already gone
                # out naming this match's config and `engine.js startAt()` refuses a start for a config
                # it does not hold, so a fresh id here would lock the late phone out of the match it is
                # joining. Nor could it re-push the roster -- those guns are in play and would take the
                # F121 disarmed head (`_refuse_push_in_play`). The in-flight-ack window stays open on
                # this path alone, and narrowly: `_took_this_config` has just established that this node
                # has neither acked this head nor reported itself armed.
                #
                # Polish review #2 (2026-09-18): this hot join is exactly the mid-match moment F121
                # named -- an add/patch on a gun whose own hello carries an app `compatible()` cannot
                # vouch for. Withhold the config (and, below, the start) rather than arm a gun that
                # never turns spawn protection off.
                if not self._hot_join_withheld(p, nid):
                    self._push_config_to(p)
        if nid and with_start and self.start_info and not self._hot_join_withheld(p, nid):
            self.net.push(nid, "start", self._start_body())

    def _after_player_change(self, p: Player):
        """Never moves the phase (bench 2026-09-17): a claim on ARMORY used to jump the whole console
        to KIT, so a first gamertag moved the screen out from under the operator while a second claim
        (already on KIT) looked, by contrast, "stuck". Adding or editing a player is a roster edit, not
        a navigation event: the operator's own way to KIT is `POST /api/phase` (CONTINUE TO KIT)."""
        self._resend(p, with_start=True)
        self._validate()
        self._changed()

    def team(self, team_id: str | None) -> Team | None:
        return next((t for t in self.teams if t["team_id"] == team_id), None)

    def roster(self) -> list[dict]:
        return [{"player_id": p["player_id"], "player_num": p["player_num"], "display": p["display"],
                  "team_id": p["team_id"], "weapons": self._roster_weapons(p)}
                for p in self.players.values()]

    def _roster_weapons(self, p: Player) -> list[dict]:
        """S56 ("what hit me"): `p`'s `weapons[]` for the wire roster (`RosterWeapon`), slot order
        (list index == gun slot, same as `loadout.weapons`).

        `hir` comes from `self.bundles[pid]`'s own compiled `$WEAP` frame for that slot when MC holds
        one -- a perk such as Armour Piercing changes the magnitudes at compile time, so the
        catalogue's base numbers would be WRONG for that player -- and falls back to the catalogue's
        own `weap_frame` (`self.compiler.weapon_catalog()`, the same lookup `patch_player` already
        uses) otherwise: no bundle yet (before the first compile), or a fake compiler in a test whose
        template frame carries no real numbers. A player with no loadout at all gets `weapons: []`."""
        weapons = (p.get("loadout") or {}).get("weapons") or []
        if not weapons:
            return []
        head = (self.bundles.get(p["player_id"]) or {}).get("head") or []
        weap_by_slot: dict[int, str] = {}
        for frame in head:
            if isinstance(frame, str) and frame.startswith("$WEAP,"):
                parts = frame.split(",")
                try:
                    slot = int(parts[1])
                except (IndexError, ValueError):
                    continue
                weap_by_slot[slot] = frame
        catalog_by_id = {w["weapon_id"]: w for w in self.compiler.weapon_catalog()}
        out: list[dict] = []
        for slot, sel in enumerate(weapons):
            weapon_id = sel.get("weapon_id")
            if not weapon_id:
                continue
            frame = weap_by_slot.get(slot)
            if frame is None:
                row = catalog_by_id.get(weapon_id)
                frame = row.get("weap_frame") if row else None
                # F315: with no bundle yet, a weapon the match's PINNED plan moved (`--distinct-weapon-cells`)
                # still reports the cell its frame will carry. Read the pin, never derive one: `_hit_plan()`
                # pins only once the lobby is pushed, and a roster read must not pin it early.
                cell = self._pinned_hit_plan.cell_for(weapon_id) if self._pinned_hit_plan is not None else None
                if isinstance(frame, str) and cell is not None:
                    frame = _compile.Compiler._rekey(frame, cell)
            hir = _compile.hir_from_weap(frame) if isinstance(frame, str) else []
            # F315: the cell each magnitude rides, from the same frame as `hir` (so the two never disagree).
            cells = _compile.cells_from_weap(frame) if isinstance(frame, str) else []
            out.append({"weapon_id": weapon_id, "hir": hir, "cells": cells})
        return out

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

    def ready_all(self) -> dict:
        """Bench 2026-09-17: the operator's roster-wide READY control.

        `push_config` and `_repush_lobby_config` retire acks while preserving READY. A roster that
        has not readied up can use this control instead of tapping each `HOST OVERRIDE`
        (`set_ready(..., host_override=True)`) one player at a time. It does what HOST OVERRIDE does, for every
        rostered, non-standby player at once (`self.players` never holds a benched record -- those
        live in `self.standby`).

        LOBBY only: readying up before a config exists, or after the match has gone live, is not
        this control's job. It never re-compiles, never touches `self.acks` and never opens the gun
        config proofs -- `set_ready` only ever flips `p["ready"]`, so arming still refuses on a stale
        ack, an echo mismatch or a missing config exactly as it does today.

        Each newly-readied player gets a fresh `assign` (`_send_assign`, no config leg) -- the same
        wire field `PATCH .../ready` already documents (API.md) and the phone already receives on
        every ordinary roster edit -- so the HUD picks up the green READY state MC just gave it, not
        only the console's own count."""
        if self.phase != "lobby":
            # Integration pass 2026-09-23: the operator is standing on the LOBBY tab when this fires, so naming the tab
            # says nothing. Name the phase MC is really in and the button that moves it on.
            step = "press NEXT MATCH first" if self.phase == "recap" else "load a game and send it to the phones first"
            raise ValueError(f"mark all ready needs the lobby, and MC is at {self.phase.upper()}: {step}")
        readied: list[str] = []
        for pid, p in self.players.items():
            if not p.get("ready"):
                self._on_ready(pid, True)
                readied.append(pid)
                self._send_assign(p)
        self._changed()
        return {"ok": True, "readied": readied}

    # ---------- config ----------
    def modes(self) -> list[ModeInfo]:
        # A18: `params` = the engine's own schema rows, so the Designer can render a mode's controls without a
        # second list of knobs living in the UI (the same rule `station_source` follows).
        rows: list[ModeInfo] = []
        for m in MODES:
            row: ModeInfo = {"mode": m["mode"], "name": m["name"], "abbr": m["abbr"],
                             "desc": m["desc"], "brief": m["brief"], "teams_text": m["teams_text"],
                             "win_text": m["win_text"], "respawn_text": m["respawn_text"],
                             "defaults": default_config(m["mode"]),
                             "params": _params_schema_json(m["mode"])}
            rows.append(row)
        return rows

    _CONFIG_KEYS = {"mode", "environment", "night", "time_limit_s", "respawn", "scoring",
                    "health", "teams", "led", "player_num_base", "loadout_policy", "presentation",
                    "station_source", "mode_params", "vip_player_id", "stun", "coverage", "recoil",
                    "volume"}

    def apply_preset(self, preset_id: str, config: GameConfig) -> dict:
        """A10 §8: apply a saved game — same path as PUT /api/config, but the state remembers WHICH game is playing."""
        self.active_preset_id = preset_id
        try:
            # K8: a saved game from before the volume knob carries no key; it plays at the venue volume,
            # never at whatever the previous game's knob said.
            return self.set_config({**dict(config), "volume": config.get("volume")}, _from_preset=True)
        except Exception:
            self.active_preset_id = None
            raise

    def _reteam_for_config(self, prev_teams: list[Team]) -> None:
        """FIELD-1 (round-3 fix pass, 2026-09-13). Carry the operator's SPLIT across a mode pick.

        The old rule was one line — anyone whose team the new config does not declare landed on
        `teams[0]` — which is how a TDM(blue/yellow) roster switched to KOTH(blue/green) or
        INFECTION(blue/red) arrived entirely on BLUE. With `one_team_fault()` refusing that push
        unforceably (and `force` deliberately not opening it), every cross-family mode pick became
        "re-drag half the field"; `webapp/mc/test/e2e/koth.mjs` grew a `rebalance()` helper to get
        past it, which is the symptom, not the fix.

        Three deterministic steps, in order:
          1. **By INDEX.** A player on the old `teams[i]` lands on the new `teams[i]` when it exists,
             so yellow -> green and the two sides the operator built stay two sides.
          2. **Least-count fill** for anyone whose old index the new config does not have (and for any
             otherwise-invalid `team_id`), stable by `player_num` — the same alternating fill
             `add_player` uses, so one rule decides where an unplaced player goes.
          3. **Rebalance ONLY if `one_team_fault()` is then true** (FFA -> TDM: one declared team
             becomes two and everyone is on index 0). A 2/2/0 across three declared teams already
             plays and is left exactly as the operator left it.

        Nobody is ever reordered inside a team, and a switch that changes nothing changes nothing."""
        new_ids = [t["team_id"] for t in self.teams]
        legal = set(new_ids)
        by_old_index = {t["team_id"]: i for i, t in enumerate(prev_teams)}
        unplaced: list[Player] = []
        for p in sorted(self.players.values(), key=lambda q: q["player_num"]):
            tid = p.get("team_id")
            if tid in legal:
                continue
            i = by_old_index.get(tid or "")
            if i is not None and i < len(new_ids):
                p["team_id"] = new_ids[i]
            else:
                unplaced.append(p)
        for p in unplaced:
            p["team_id"] = self._least_count_team()
        if self.one_team_fault():
            self._rebalance_sides()

    def _least_count_team(self) -> str | None:
        """The emptiest declared team, ties broken by config order — `add_player`'s alternating fill."""
        if not self.teams:
            return None
        counts = {t["team_id"]: 0 for t in self.teams}
        for q in self.players.values():
            if (t := q.get("team_id")) in counts and t is not None:
                counts[t] += 1
        return min(counts, key=lambda k: (counts[k], list(counts).index(k)))

    def _rebalance_sides(self) -> None:
        """Even the roster out across the declared teams — FIELD-1 step 3, reached ONLY from a true
        `one_team_fault()`. Moves the HIGHEST `player_num` off the fullest team onto the emptiest,
        which is deterministic and leaves the low numbers (the operator's first picks) where they are.
        Stops at a spread of 1, so four players on one side come out 2/2 rather than the 3/1 that
        merely clears the gate. A config whose teams all share one `$TID` cannot be fixed by moving
        anyone, so the loop simply runs out and the gate refuses — correctly."""
        order = [t["team_id"] for t in self.teams]
        if len(order) < 2:
            return
        for _ in range(len(self.players) * len(order) + 1):
            counts = {tid: 0 for tid in order}
            for p in self.players.values():
                if (t := p.get("team_id")) in counts and t is not None:
                    counts[t] += 1
            fullest = max(order, key=lambda k: (counts[k], -order.index(k)))
            emptiest = min(order, key=lambda k: (counts[k], order.index(k)))
            if counts[fullest] - counts[emptiest] <= 1:
                return
            movers = [p for p in self.players.values() if p.get("team_id") == fullest]
            if not movers:
                return
            max(movers, key=lambda q: q["player_num"])["team_id"] = emptiest

    def set_config(self, patch: dict, _from_preset: bool = False) -> dict:
        if not isinstance(patch, dict):
            raise ValueError("config must be an object")
        if not _from_preset and (set(patch) - {"environment", "night", "config_id"}):
            self.active_preset_id = None                     # any real edit means the draft is no longer that saved game
        # The match is OVER: any config edit is the operator starting the next one. Tony, 2026-08-26:
        # "i get an error bc match in progress, but MC knows its over". Tony, 2026-09-16, on the
        # mode-only rule that followed: "why? just make a new one". Every edit rolls forward now.
        self._roll_forward_from_recap()
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
            # Written key by key rather than through a loop variable: `cfg` is a `GameConfig` and the
            # three carried keys do not share a value type. The `in self.config` guards are kept: a
            # RESTORED snapshot's config is taken verbatim (`restore_snapshot`), so it is the one config
            # in MC that can be missing a key the type says is required.
            if "environment" not in patch and "environment" in self.config:
                cfg["environment"] = self.config["environment"]
            if "night" not in patch and "night" in self.config:
                cfg["night"] = self.config["night"]
            # K8 (polish round 2): the host sets the volume for the site, like the venue, so a mode switch
            # keeps it; the game editor already carried it, and the two now agree.
            if "volume" not in patch and (vol := self.config.get("volume")) is not None:
                cfg["volume"] = vol
            if "coverage" not in patch and (cov := self.config.get("coverage")) is not None:
                cfg["coverage"] = cov
        cfg = self._merge_config(cfg, patch, mode)
        # F146 round 2: `_merge_config` normalises a policy the PATCH names, and nothing else. A config
        # already holding a broken rule (a fixture, a restored file from another build) survived a PUT
        # of an unrelated key untouched. This is a write, with a fresh `config_id` below, so it is the
        # right place to repair it — `policy()` is a read and must not.
        _pol = cfg.get("loadout_policy") or _policy.default_policy(mode)
        if not _policy.admits_weapons(_pol.get("primary") or _policy.default_policy(mode)["primary"]):
            cfg["loadout_policy"] = _policy.normalize(cfg.get("loadout_policy"), mode)
        cfg["config_id"] = uuid.uuid4().hex[:8]
        prev_teams = list(self.teams)
        self.config = cfg
        self.teams = list(cfg["teams"])
        self._reteam_for_config(prev_teams)
        if self.phase == "muster":
            self.phase = "build"
        repush = self.lobby_pushed
        if repush:
            # ONE edit is ONE push. `apply_policy()` below re-kits every player the new ruleset moved and
            # `_resend`s them; with `lobby_pushed` still True that took the config leg -- a full compile
            # and push per re-kitted gun, immediately followed by `_repush_lobby_config()` doing the whole
            # roster AGAIN (measured: 2 `config` frames to one node for one preset edit, round-1 polish
            # review 2026-09-12). Worse, that first push compiled against the PREVIOUS `_pinned_hit_plan`,
            # so the two pushes could disagree about the shared hit-audio plan and a gun re-armed from the
            # earlier one has no row for a rekeyed cell (A17). The plan is cleared here, BEFORE anything
            # recompiles, and the flag stands `_resend` down until the single re-push below.
            self._pinned_hit_plan = None
            self._repush_pending = True
        try:
            self.apply_policy()                              # §3.3: every loadout obeys the (new) ruleset
            res = self._validate()
        finally:
            self._repush_pending = False
        # SAVE AND LOAD: a game that has been ANNOUNCED is re-announced on every edit, so the phones'
        # briefing never describes a game nobody is playing. Independent of the frames re-push below:
        # after a real LOBBY push both happen; before one, only this does.
        if self.game_loaded and res["ok"]:
            self.load_game()
        if repush:
            # B1/B3 (2026-09-12): editing a LOADED game in KIT/LOBBY used to silently drop the push here
            # (`lobby_pushed=False`, acks cleared) and NEVER re-compile -- every gun kept the STALE head
            # (old $TID/mode/health/weapons) with nothing on screen saying so. A TDM whose teams, mode or
            # health the operator tweaked then played on the PREVIOUS frames: the guns' effective $TID
            # never moved, so combat resolved them as one team -- "they can't shoot each other" (the
            # field P0 this traces). Re-push instead, as long as the new config is VALID (an invalid one
            # cannot arm a gun -- fall back to the old drop and let the errors show). Never armed/live
            # here: `set_config` refuses a config change once the match has started (above).
            if res["ok"]:
                self._repush_lobby_config()
            else:
                self.lobby_pushed = False
                self.acks = {}
                self.arm_stations(relock=True)   # F337 (d): no pushed game any more, so the LOAD lock goes too
        self._changed()
        return {"ok": res["ok"], "errors": res["errors"], "config": self.config}

    def _repush_lobby_config(self) -> None:
        """B1/B3 (2026-09-12): a config / team / loadout edit made while the lobby is ALREADY pushed, in
        KIT or LOBBY, re-compiles and re-pushes every bound node's frames so no gun is left holding a
        STALE head. `lobby_pushed` stays TRUE -- the lobby is still the source of truth -- and `acks`
        reset to {} then re-collect as each node echoes the new head, so the operator's "pushed X/Y"
        counter drops to 0 and climbs back rather than the push vanishing silently.

        `_pinned_hit_plan` is cleared first so the shared hit-audio plan re-derives ONCE across the whole
        roster (exactly as a full `push_config` does): every gun must be recompiled against the same
        plan, or a rekeyed cell on one gun has no row on another and those hits drop in silence (A17).

        NOT reachable in armed/live: `set_config` refuses a config change there and `patch_player`
        refuses a team change there (both name RECALL), so a gun in play is never re-armed with the
        disarmed head behind the operator's back (`_refuse_push_in_play` / `_push_config_to`)."""
        self._pinned_hit_plan = None
        self.acks = {}
        # Round-2 fix pass H (2026-09-12): EVERY player, not just the bound ones. `_push_config_to`
        # writes `self.bundles[pid]` before it looks for a socket, which is exactly why `push_config`
        # loops over the whole roster -- an unbound player (phone not up yet, or cleared by
        # `evict_node`, which drops `node_id` and the ack but KEEPS the bundle) used to be skipped here
        # and kept the PRE-EDIT frames. Their next hello then found the id already in `bundles`
        # (`_hydrate`), so the welcome shipped the NEW `config_id` beside the OLD frames: `engine.js`
        # `startAt` passes on the id it holds and the gun arms on the stale $TID/$GSET, while the board
        # reads pushed. Compiling for all and SENDING only to those with a socket is the invariant.
        #
        # S56: compile EVERY player first, THEN send. `roster()` (embedded in each `config` push)
        # reads OTHER players' `self.bundles` for their `hir` magnitudes, so one loop that compiled
        # and sent together could push an early player a roster naming a LATER player's new weapon_id
        # beside that player's OLD, not-yet-recompiled hir numbers.
        for p in self.players.values():
            self._compile_and_store(p)
        for p in self.players.values():
            self._send_config_to(p)
        # Round-2 fix pass J: the same A13.5 re-arm `push_config` does. Without it a team or
        # `station_source` edit left every assigned station on the PRE-EDIT allow-list.
        self.lobby_pushed = True
        self._stations_unlocked = False        # A58: a LOAD push locks the stations again
        self.arm_stations()

    def _fresh_head_repush(self) -> None:
        """A NEW HEAD FOR THE WHOLE ROSTER, under a fresh `config_id`. One operation, never two.

        The `config_id` is what a gun's ack NAMES, and MC has exactly one of them. So a head that
        changes must change the id or the change cannot be PROVEN -- and an id that changes must reach
        every gun, or the rest of the roster is instantly holding a head MC calls stale and
        `_refuse_stale_ack` blocks the whistle with no cure the operator was ever offered. Those two
        facts are why the mint and the roster-wide re-push cannot be separated.

        `push_config`'s re-push branch has minted and re-pushed together since F6. `_push_config_to` on
        its own did NEITHER: a per-player recompile after the lobby push -- a loadout pick, a re-team --
        popped that player's ack and wrote a fresh head to their gun under the OLD id. The ack already
        in flight for the head it had just replaced then landed carrying that same id, satisfied
        `_ack_is_current`, and the board certified the gun as holding the new team and weapons while it
        was in fact still running the pre-edit ones. That is precisely the failure A36 exists to catch,
        reached through the per-player door instead of the operator's.
        """
        self.config["config_id"] = uuid.uuid4().hex[:8]
        self._repush_lobby_config()

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

    def _merge_config(self, cfg: GameConfig, patch: dict, mode: str) -> GameConfig:
        """Whitelist + range-check every key of `patch` onto `cfg` (A8.3). Pure; raises ValueError.

        Every branch writes its LITERAL key rather than `cfg[k]`: `cfg` is a `GameConfig` and its keys do
        not share a value type. The optional ones (`coverage`, `led`, `station_source`, `mode_params`,
        `vip_player_id`, `stun`) are REMOVED on a null rather than set to one, and the sub-objects are
        rebuilt as their own shapes, so a patch that smuggles an extra key INSIDE `respawn` / `scoring` /
        `health` / `stun` no longer stores it -- the whitelist rule the top level has always had
        (2026-09-12: `led` and those four inner bags were the holes).
        """
        for k, v in patch.items():
            if k not in self._CONFIG_KEYS:
                continue                         # ignore unknown / client-injected keys
            if k == "time_limit_s":
                if v is not None and not (isinstance(v, int) and not isinstance(v, bool) and 1 <= v <= 7200):
                    raise ValueError("time_limit_s must be an integer 1..7200 or null")
                cfg["time_limit_s"] = v
            elif k == "environment":
                if v not in ("indoor", "outdoor"):
                    raise ValueError("environment must be indoor|outdoor")
                cfg["environment"] = v
            elif k == "night":
                cfg["night"] = bool(v)
            elif k == "recoil":
                cfg["recoil"] = bool(v)   # S42: default ON is absence, not a stored True -- see GameConfigBase.recoil
            elif k == "volume":
                # K8: the host's volume knob. `null` clears it back to the venue default (absent, as before K8).
                if _compile.check_game_volume(v) is None:
                    cfg.pop("volume", None)
                else:
                    cfg["volume"] = v
            elif k == "coverage":
                # A31/A4.8: the venue's radio coverage. "full" is an ASSERTION the operator makes about
                # the site (every phone on the LAN the whole match) and it unlocks a null `time_limit_s`
                # and suppresses the verify-at-MC warning, so it is spelled exactly or refused.
                if v is not None and v not in ("full", "partial"):
                    raise ValueError("coverage must be full|partial or null")
                if v is None:
                    cfg.pop("coverage", None)
                else:
                    cfg["coverage"] = v
            elif k in ("respawn", "scoring", "health"):
                if not isinstance(v, dict):
                    raise ValueError(f"{k} must be an object")
                current = cfg["respawn"] if k == "respawn" else cfg["scoring"] if k == "scoring" else cfg["health"]
                merged: dict[str, Any] = {**current, **v}
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
                    # 2026-09-19 respawn profiles: the timed and station protection and the weapon delay.
                    # `respawn_settings` refuses a value outside the options; an absent key keeps its default.
                    _compile.respawn_settings(merged)
                    respawn: Respawn = {"type": merged["type"], "delay_s": d}
                    if "protect_s" in merged:
                        respawn["protect_s"] = merged["protect_s"]
                    if "weapon_delay_ms" in merged:
                        respawn["weapon_delay_ms"] = merged["weapon_delay_ms"]
                    if "station_protect_s" in merged:
                        respawn["station_protect_s"] = merged["station_protect_s"]
                    # F325: the scanner gate (contracts §3 `respawn.gate`, A13.1). The node already reads it;
                    # MC used to drop it here, so no path could choose the presence gate. `null` clears it.
                    g = merged.get("gate")
                    if g is not None and merged["type"] == "scanner":   # scanner only: another type drops it
                        if g not in ("trigger", "presence"):
                            raise ValueError("respawn.gate must be trigger|presence (scanner respawn only)")
                        respawn["gate"] = g
                    cfg["respawn"] = respawn
                if k == "scoring":
                    fl = merged.get("frag_limit")
                    if fl is not None and not (isinstance(fl, int) and not isinstance(fl, bool) and fl > 0):
                        raise ValueError("scoring.frag_limit must be a positive integer or null")
                    # `merged["win_by"]` is not guaranteed: a RESTORED snapshot's config can be missing
                    # it (see `set_config`'s own comment on `cfg` above), and a patch that only touches
                    # `frag_limit` then leaves `merged` without one too -- so this fell through to a
                    # KeyError on `PUT /api/config {"scoring": {...}}` (2026-09-12).
                    cfg["scoring"] = {"frag_limit": fl,
                                      "win_by": parse_win_by(merged.get("win_by"),
                                                             default_config(mode)["scoring"]["win_by"])}
                if k == "health":
                    # S45 (FOLLOWUPS, weapon-design.md §7.3): a saved config from before this field
                    # existed carries no `max_shield` at all -- that is the one honest signal that it
                    # predates the presets, so it loads as CUSTOM rather than guessing which preset (if
                    # any) it meant. GameEditPanel/Designer always PUT the whole health object they
                    # hold (never a bare `{max_hp}`), so a genuine partial edit is rare enough that
                    # reading it as legacy too is the safe default. A patch NAMING a preset is exempt --
                    # `{"preset": "shields"}` alone is the whole point (mirrors `loadout_policy`'s own
                    # `{"preset": "no_heavies"}`), not a legacy caller that forgot the numbers.
                    pname = v.get("preset")
                    if pname is not None and pname not in _compile.HEALTH_PRESET_NAMES:
                        raise ValueError(f"health.preset must be one of {_compile.HEALTH_PRESET_NAMES}")
                    legacy = pname is None and "max_shield" not in v
                    if pname and pname != "custom":
                        # A preset NAME rewrites the pool from its own table (mirrors `policy.merge()`'s
                        # "a preset name REWRITES the rules"): any max_hp/max_armor/max_shield riding in
                        # the same patch is ignored, so PICKING Shields always means (45, 0, 105).
                        hp_v, armor_v, shield_v = _compile.HEALTH_PRESETS[pname]
                        merged = {**merged, "max_hp": hp_v, "max_armor": armor_v, "max_shield": shield_v}
                    pools: dict[str, int] = {}
                    for hk, lo in (("max_hp", 1), ("max_armor", 0), ("max_shield", 0)):
                        hv = merged.get(hk, 0)
                        if not (isinstance(hv, int) and not isinstance(hv, bool) and lo <= hv <= 255):
                            # 255 is a POLICY ceiling, not a hardware one -- $PSET pools are
                            # wider than 8 bits (bench 2026-08-27, see FOLLOWUPS/experiment-log).
                            raise ValueError(f"health.{hk} must be {lo}..255")
                        pools[hk] = hv
                    if legacy:
                        preset = "custom"
                    elif pname and pname != "custom":
                        preset = pname
                    elif pname == "custom":
                        preset = "custom"
                    else:
                        preset = _compile.resolve_health_preset(pools["max_hp"], pools["max_armor"], pools["max_shield"])
                    cfg["health"] = {"max_hp": pools["max_hp"], "max_armor": pools["max_armor"],
                                     "max_shield": pools["max_shield"], "preset": preset}
            elif k == "teams":
                if not (isinstance(v, list) and all(isinstance(t, dict) and "team_id" in t
                                                   and isinstance(t.get("tid"), int) and not isinstance(t.get("tid"), bool) for t in v)):
                    raise ValueError("teams must be a list of team objects with team_id + integer tid")
                # A36 belt-and-braces, alongside F35/F82/F97 below. Two teams sharing a `team_id`
                # make `Session.team()` (a `next(...)` over the list) resolve every player on either
                # one to the FIRST, so half the roster is silently re-teamed on the console while the
                # gun is armed from the other; two sharing a `$TID` are ONE side on the field however
                # they are named -- `populated_tids()` already says so, and `one_team_fault()` exists
                # because that shape shipped a match that could not register a hit. Neither is worth
                # detecting downstream when the config can simply refuse to hold it.
                for key, label in (("team_id", "team_id"), ("tid", "$TID")):
                    counts_: dict[str, int] = {}
                    for t in v:
                        counts_[str(t[key])] = counts_.get(str(t[key]), 0) + 1
                    dupes = sorted(k for k, n in counts_.items() if n > 1)
                    if dupes:
                        raise ValueError(
                            f"duplicate {label} {dupes} in teams: two teams "
                            f"sharing a {label} are one side on the field (a shared $TID cannot register a "
                            f"hit between them; a shared team_id resolves every player to the first of "
                            f"the two). Give each team its own.")
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
                cfg["teams"] = v
            elif k == "led":
                if v is not None and not isinstance(v, dict):
                    raise ValueError("led must be an object")
                if v is None:
                    # 2026-09-12: `led: null` used to STORE the null, alone among the nullable keys
                    # (coverage / station_source / vip_player_id / stun all drop theirs), and
                    # `GameConfig.led` says the value is an object. Nothing has ever sent it -- no
                    # caller in `webapp/mc` or `app/` names the key -- and the one reader
                    # (`compile.py`: `config.get("led") or {}`) cannot tell the two apart.
                    cfg.pop("led", None)
                else:
                    cfg["led"] = v
            elif k == "station_source":
                # F70: what is on the field emitting this game's objective. A CLOSED vocabulary --
                # the compiler used to accept any non-empty string, so a typo shipped a hill mode
                # with nothing emitting anything. `null` clears it (and `validate()` then refuses
                # the push for a station-gated mode, naming the valid values).
                if v is not None and v not in STATION_SOURCES:
                    raise ValueError("station_source must be null or one of: "
                                     + ", ".join(f"{k2} ({d})" for k2, d in sorted(STATION_SOURCES.items())))
                if v is None:
                    cfg.pop("station_source", None)
                else:
                    cfg["station_source"] = v
            elif k == "mode_params":
                # A18 (E1): the mode's own rules, checked against what ITS ENGINE declares (`modes/params.py`).
                # A partial patch merges onto the current values; what is stored is the COMPLETE resolved set
                # (defaults filled), so the wire config is self-describing. An unknown key or an out-of-range
                # value is refused in the operator's voice -- never dropped or clamped.
                if v is None:
                    v = {}
                if not isinstance(v, dict):
                    raise ValueError("mode_params must be an object (the mode's parameters, GET /api/modes .params)")
                resolved, errs = _validate_mode_params(mode, {**(cfg.get("mode_params") or {}), **v})
                if errs:
                    raise ValueError("; ".join(errs))
                if resolved:
                    cfg["mode_params"] = resolved
                else:
                    cfg.pop("mode_params", None)   # a mode with no parameters carries no key at all
            elif k == "vip_player_id":
                # A19 (S10): who the VIP is. Roster membership is `validate()`'s to check (this merge is pure);
                # here only the shape. `null` clears it.
                if v is not None and not (isinstance(v, str) and v):
                    raise ValueError("vip_player_id must be a player_id string or null")
                if v is None:
                    cfg.pop("vip_player_id", None)
                else:
                    cfg["vip_player_id"] = v
            elif k == "stun":
                # F15 / A20: `{duration_s?}` enables the EMP row; range and the source warning are `validate()`'s
                # (`compile._validate_stun`). `null` clears it. Until 2026-09-11 this key was not in
                # `_CONFIG_KEYS`, so a PUT dropped it in silence and no game could stun over MC.
                if v is not None and not isinstance(v, dict):
                    raise ValueError("stun must be an object {duration_s} or null (F15/A20)")
                if v is None:
                    cfg.pop("stun", None)
                else:
                    stun: Stun = {}
                    if "duration_s" in v:
                        stun["duration_s"] = v["duration_s"]
                    cfg["stun"] = stun
            elif k == "player_num_base":
                if not (isinstance(v, int) and not isinstance(v, bool) and 1 <= v <= MAX_PLAYERS):
                    raise ValueError("player_num_base must be 1..63")
                cfg["player_num_base"] = v
            elif k == "loadout_policy":
                # A10 §3: a preset name rewrites the rules; a rule edit that matches no preset → custom
                cfg["loadout_policy"] = _policy.merge(cfg.get("loadout_policy") or _policy.default_policy(mode), v)
            elif k == "presentation":
                # A11: a preset name replaces the profile; a field edit marks it custom; bad ids/colours raise
                cfg["presentation"] = _pres.merge(cfg.get("presentation") or _pres.default_for(mode), v)
            elif k == "config_id":
                continue                                     # never client-set; minted by set_config
            else:                                            # `mode` -- the only whitelisted key left
                cfg["mode"] = v
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
        # F146 (field 2026-09-12): a loadout policy whose filters leave NO legal primary is refused
        # HERE, where the pool is known — `compile.validate()` sees compiled loadouts, never the rules
        # that produced them. Until now the emptiness was resolved silently by `_policy.apply()`, which
        # falls through to whatever the player already held, and the operator's only clue was
        # "2 LOADOUTS RESET BY PISTOLS ONLY" (a warning) followed by a hard weapon error they could not
        # act on. A ruleset that excludes every weapon is the operator's mistake to fix, and this is the
        # sentence that tells them which control to touch.
        try:
            bad = self._primary_pool_refusal()
            if bad:
                self.config_errors.append(bad)
                # Mutated in place, never rebound: `res` carries the compiler's shape and a fresh
                # `dict(res, ...)` widened it enough to break the `warnings` read two lines down.
                res["ok"] = False
                res["errors"] = list(self.config_errors)
        except Exception:          # a broken pool must not take the validation down
            import logging; logging.getLogger("brx.mc").exception("loadout pool check failed")
        self.config_warnings = list(res.get("warnings", []))
        self.config_warnings.extend(self._station_warnings())
        self.config_warnings.extend(self._station_sync_warnings())   # F401
        if notice := self._unplayable_primary_notice():
            self.config_warnings.append(notice)          # round-3 MERGE-4: never a silent re-fit
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
            # F401: this new game byte is what resets an unsynced station's tally, so its result is gone and
            # "BRING IT INTO WI-FI BEFORE YOU LOAD" is no longer true. Stop asking.
            self._sync_pending = {}

    def _station_ids(self) -> list[StationRef]:
        rows: list[StationRef] = []
        for st in self.stations.values():
            if a := st.get("assigned"):
                row: StationRef = {"id": a["id"], "kind": a["kind"]}
                if item := self._active_item(a):
                    row["item"] = item                  # A56: the phone knows the item and its schedule without MC
                rows.append(row)
        return sorted(rows, key=lambda x: x["id"])

    # ---------- powerups (A56 / S58, docs/spec/powerups.md) ----------
    def powerups_view(self) -> PowerupsView:
        """`GET /api/powerups`: the flag and the item presets, expanded from `powerups.py`'s defaults."""
        return _pu.presets_view(self.powerups_enabled, getattr(self.compiler, "catalog", None))

    def _active_item(self, a: dict | None) -> StationItem | None:
        """The item a station assignment carries INTO THIS RUN: only with the flag on, only on a powerup station.
        Anything else (the flag off, a restored item on another kind) is inert, never sent and never compiled."""
        if not self.powerups_enabled or not a or a.get("kind") != "powerup":
            return None
        item = a.get("item")
        if item is None:
            return None
        if (why := _pu.invalid_reason(item)) is not None:
            # F331: a restored item never passed `expand`; drop it once, loudly, rather than hang or raise per tick
            a.pop("item", None)
            import logging
            logging.getLogger("brx.mc").warning("dropped an invalid item on powerup station #%s: %s", a.get("id"), why)
            return None
        return cast(StationItem, item)

    def _item_stations(self) -> list[tuple[str, dict, StationItem]]:
        """(node_id, assignment, item) for every assigned station with an active item, by station id."""
        out = [(nid, a, item) for nid, st in self.stations.items()
               if (a := st.get("assigned")) and (item := self._active_item(a))]
        return sorted(out, key=lambda r: r[1]["id"])

    def _powerup_slots(self) -> list[PowerupSlot]:
        """`GameConfig.powerups`: each distinct pickup weapon, by station id, into slot 2 then 3."""
        return _pu.weapon_slots(item for _nid, _a, item in self._item_stations())

    def _compile_config(self) -> GameConfig:
        """The config `compile()` reads: the operator's, plus the pickup weapons MC armed (A56)."""
        slots = self._powerup_slots()
        return cast(GameConfig, {**self.config, "powerups": slots}) if slots else self.config

    def _pu_update_body(self, nid: str) -> dict | None:
        """The `station_update` for one item station from the schedule in play, or None when there is none."""
        # Only for the match in play (M2): a station reconnecting in RECAP or LOBBY must not get the old
        # match's state and start counting down to a spawn that will never come.
        if not self.in_play() or self._pu_sched.get("match_id") != self.current_match_id():
            return None
        row = (self._pu_sched.get("st") or {}).get(nid)
        a = (self.stations.get(nid) or {}).get("assigned")
        if row is None or not a:
            return None
        # The time to the NEXT spawn instant, ALWAYS (even while the item is there): the station counts down
        # and spawns on its own, so a lost MC link never freezes it.
        return {"id": a["id"], "available": row["available"],
                "next_spawn_in_ms": max(0, _pu.spawn_at(row["item"], self._pu_sched["go"], row["next_k"]) - self.now_ms())}

    def _push_station_update(self, nid: str, reset: bool = False) -> None:
        body = self._pu_update_body(nid)
        if body is not None:
            if reset:
                body["reset"] = True   # the station tells an operator reset from a re-send of a spawn it awarded
            self.net.push(nid, "station_update", body)

    def _powerup_tick(self, now: int) -> None:
        """A56: the Halo schedule on MC's match clock. Items spawn at `first_at_s`, then every `spawn_every_s`
        after go-live; a spawn never stacks (an untaken item just stays). Built once per match, at the first
        tick that sees it armed, and each station is told its state then, at every spawn time, on a pickup
        and on its reconnect. A match resumed after an MC restart assumes an item is there if a spawn passed."""
        if not self.powerups_enabled or not self.start_info or self.phase not in ("armed", "live"):
            return
        mid, go = self.start_info["match_id"], int(self.start_info["go_live_t"])
        if self._pu_sched.get("match_id") != mid:
            rows = {}
            restored, self._pu_restored = self._pu_restored, None
            kept = (restored.get("st") or {}) if isinstance(restored, dict) and restored.get("match_id") == mid else {}
            for nid, _a, item in self._item_stations():
                old = kept.get(nid)
                if isinstance(old, dict) and isinstance(old.get("next_k"), int) and isinstance(old.get("since"), int):
                    # M1: the SAME match's schedule from before the restart, taken items and all; any spawn
                    # that passed while MC was down fires on the catch-up tick below.
                    rows[nid] = {"item": item, "available": bool(old.get("available")), "next_k": old["next_k"],
                                 "since": old["since"], "taken_by": old.get("taken_by")}
                    continue
                k = _pu.last_spawn_index(item, go, now)
                # `since`: when the item in the station now became available (a spawn or an operator reset);
                # a fact older than that is about an earlier item. `taken_by`: this spawn's taker, if any.
                rows[nid] = {"item": item, "available": k >= 0, "next_k": k + 1,
                             "since": _pu.spawn_at(item, go, k) if k >= 0 else go, "taken_by": None}
            self._pu_sched = {"match_id": mid, "go": go, "st": rows}
            self._pu_catch_up(now, go, push=False)
            for nid in rows:
                self._push_station_update(nid)
            if rows:
                self._changed()
            return
        if self._pu_catch_up(now, go, push=True):
            self._changed()

    def _pu_catch_up(self, now: int, go: int, push: bool) -> bool:
        """Fire every spawn time that has passed; True when any did."""
        changed = False
        for nid, row in self._pu_sched["st"].items():
            fired = False
            while now >= _pu.spawn_at(row["item"], go, row["next_k"]):
                row["next_k"] += 1
                fired = True
            if fired:
                row["available"], row["taken_by"] = True, None
                row["since"] = _pu.spawn_at(row["item"], go, row["next_k"] - 1)
                if push:
                    self._push_station_update(nid)  # at each spawn time, even one that finds the item still there
                changed = True
        return changed

    def _on_pickup(self, ev: Event, t_recv: int, parked: bool) -> None:
        """A56: a player's `pickup` fact. Stored by the caller and NEVER scored; here it only empties the
        station until its next spawn time on the schedule and tells the station. A second report of an item
        already taken (the station's own `taken`, or another pickup), or a late fact about an item that has
        spawned or been reset since, changes nothing."""
        if parked or not self.in_play() or not self._pu_sched or ev.get("match_id") != self._pu_sched.get("match_id"):
            return   # integration review (Low): a pickup flushed in RECAP or LOBBY changes nothing
        sid = ev.get("station_id")
        nid = next((n for n, st in self.stations.items()
                    if (st.get("assigned") or {}).get("id") == sid and n in self._pu_sched["st"]), None)
        if nid is None:
            return
        t = ev.get("t")
        t = t if isinstance(t, int) and not isinstance(t, bool) and t <= t_recv else t_recv
        self._take_item(nid, t, self.players.get(ev.get("player_id") or ""))

    def _take_item(self, nid: str, t: int, player: Player | None, player_num: int | None = None) -> bool:
        """Mark this spawn's item taken, once. The dedupe key is the station and its current item: an item
        already taken is a no-op, and so is a report from before the item became available (`since`)."""
        row = self._pu_sched["st"][nid]
        if not row["available"] or t < row["since"]:
            return False
        a = self.stations[nid]["assigned"]
        num = player.get("player_num") if player else player_num
        row["available"] = False
        row["taken_by"] = num if isinstance(num, int) and not isinstance(num, bool) else None
        who = (player or {}).get("display") or (f"PLAYER {num}" if row["taken_by"] is not None else "A PLAYER")
        self._on_feed({"t_match_s": self._operator_t_match(self.now_ms()), "tag": "POWERUP", "kind": "info",
                       "text": f"{str(who).upper()} TOOK {row['item']['name']} · STATION #{a['id']}"})
        self._push_station_update(nid)
        self._changed()
        return True

    def _reset_item(self, nid: str) -> None:
        """The operator reset: the item is available NOW. The fixed spawn times do not move (no restart, and
        the next spawn does not stack a second item)."""
        row = self._pu_sched["st"][nid]
        row["available"], row["taken_by"], row["since"] = True, None, self.now_ms()
        self._on_feed({"t_match_s": self._operator_t_match(self.now_ms()), "tag": "OPERATOR", "kind": "info",
                       "text": f"OPERATOR RESET · STATION #{self.stations[nid]['assigned']['id']}"})
        self._push_station_update(nid, reset=True)
        self._changed()

    def reset_station(self, nid: str) -> dict:
        """`POST /api/stations/{node_id}/reset`: the console's operator reset, the same as the station's own."""
        if nid not in self.stations:
            raise KeyError(nid)
        if not self.powerups_enabled:
            raise ValueError(_pu.REFUSED_FLAG_OFF)
        if self.phase not in ("armed", "live"):
            raise ValueError(f"the match is {self.phase.upper()}: an item can be reset only while a match is armed or live")
        self._powerup_tick(self.now_ms())          # make sure this match's schedule exists
        if nid not in (self._pu_sched.get("st") or {}):
            raise ValueError(f"{nid!r} is not a powerup station with an item in this match")
        self._reset_item(nid)
        return {"ok": True}

    def _on_station_action(self, nid: str, body: dict, t_recv: int) -> None:
        """A56: a station's live-only report (`StationAction`). Ignored unless it comes from the station that
        holds that id and an item schedule runs for it."""
        a = (self.stations.get(nid) or {}).get("assigned") or {}
        if (not self.powerups_enabled or not self.in_play() or not self._pu_sched
                or self._pu_sched.get("match_id") != self.current_match_id() or nid not in self._pu_sched["st"]
                or body.get("id") != a.get("id")):
            return
        if body.get("action") == "reset":
            self._reset_item(nid)
        elif body.get("action") == "taken":
            num = body.get("player_num")
            player = next((p for p in self.players.values() if p.get("player_num") == num), None) \
                if isinstance(num, int) and not isinstance(num, bool) else None
            # Dated by `age_ms` (how long ago the station awarded it), never by the station's `t`: a Stick has no
            # synced clock, and a report queued while the link was down must not take a LATER spawn.
            age = body.get("age_ms")
            t = t_recv - age if isinstance(age, int) and not isinstance(age, bool) and 0 <= age <= t_recv else t_recv
            self._take_item(nid, t, player, num if isinstance(num, int) else None)

    def _wire_config(self) -> GameConfig:
        """The config a NODE receives: the operator's config plus `stations`, the allow-list of station ids MC
        armed for this game (contracts A13.1), and `game_byte`, the advert byte its stations carry this match.
        Never written into `self.config` -- it is derived, and the operator does not edit it."""
        ids = self._station_ids()
        cfg = self.config
        if slots := self._powerup_slots():
            cfg = cast(GameConfig, {**cfg, "powerups": slots})    # A56: the pickup weapons compile armed
        if (cfg.get("respawn") or {}).get("type") == "scanner":
            assigned = [a for st in self.stations.values() if (a := st.get("assigned")) and a.get("kind") == "respawn"]
            if assigned and not any(a.get("team") == STATION_TEAM_ANY for a in assigned):
                covered = {a.get("team") for a in assigned}
                auto = [int(t["tid"]) for t in (cfg.get("teams") or []) if isinstance(t.get("tid"), int) and t["tid"] not in covered]
                if auto:
                    cfg = {**cfg, "respawn_auto_teams": auto}
        # One game byte per match: the SAME number `_arm_station` sends as `station_config.game`, read at
        # send time on both paths, so a phone and a station can never scope one match by different bytes.
        return cast(GameConfig, {**cfg, **({"stations": ids} if ids else {}), "game_byte": self._game_byte()})

    def _station_warnings(self) -> list[str]:
        """What the objective / respawn rules need on the FIELD that the ITEMS panel has not assigned.
        Advisory (a station may be armed by hand behind the phone's seven-tap gate) but loud, because a
        station-gated game with no station is the F104 failure mode: nothing on the field, nothing said."""
        out: list[str] = []
        kinds = {a["kind"] for st in self.stations.values() if (a := st.get("assigned"))}
        src = self.config.get("station_source")
        if src == "phone" and "control" not in kinds:
            out.append("SETUP: NO CONTROL STATION IS ASSIGNED (THE OBJECTIVE IS A BLUETOOTH CONTROL POINT, SO "
                       "NOTHING ON THE FIELD IS THE HILL): ASSIGN A STATION AS CONTROL IN ITEMS AND ARM IT")
        # Stick hills (2026-09-24): a CONTROL station advertises the same kind-5 point a phone does, and every
        # phone drops it unless the source is "phone" (`engine.js _hillSourceAllowed`). Say so; never switch.
        if src in ("grenade", "ir_station") and "control" in kinds:
            what = "THE GRENADE" if src == "grenade" else "AN IR STATION"
            out.append(f"SETUP: A CONTROL STATION IS ASSIGNED BUT THIS GAME'S OBJECTIVE IS {what} (EVERY PHONE "
                       "IGNORES THE STATION'S HILL): SET OBJECTIVE SOURCE TO PHONE, OR CLEAR THE CONTROL STATION IN ITEMS")
        if (self.config.get("respawn") or {}).get("type") == "scanner" and "respawn" not in kinds:
            out.append("SETUP: NO RESPAWN STATION IS ASSIGNED (RESPAWN IS SCANNER, SO A DOWNED PLAYER CAN ONLY COME "
                       "BACK AT A STATION): ASSIGN A STATION AS RESPAWN IN ITEMS AND ARM IT")
        if (self.config.get("respawn") or {}).get("type") == "scanner" and "respawn" in kinds:
            teams = self.config.get("teams") or []
            covered = {int(a.get("team")) for st in self.stations.values()
                       if (a := st.get("assigned")) and a.get("kind") == "respawn"
                       and isinstance(a.get("team"), int) and a.get("team") != STATION_TEAM_ANY}
            if not any(a.get("team") == STATION_TEAM_ANY for st in self.stations.values()
                       if (a := st.get("assigned")) and a.get("kind") == "respawn"):
                missing = [str(t.get("name") or t.get("team_id") or t.get("tid"))
                           for t in teams if isinstance(t.get("tid"), int) and t["tid"] not in covered]
                if missing:
                    out.append("SETUP: SCANNER RESPAWN HAS NO STATION FOR " + ", ".join(missing).upper()
                               + " (THOSE PLAYERS USE TIMED AUTO RESPAWN): ASSIGN ANOTHER RESPAWN STATION FOR "
                               "STATION RESPAWN ON BOTH TEAMS")
        return out

    def _station_sync_warnings(self) -> list[str]:
        """F401: a HELD station (e.g. a StickS3) can end a timed match on its own clock while out of
        Wi-Fi range, so MC gets its result only once it is brought back. Warn at LOAD -- on the Games
        screen the operator sees before the next START -- for any station of the LAST FINISHED match
        MC has not heard since that match's whistle. Say the consequence, not just the fact: the next
        LOAD's new game byte resets a station's own tally (`_arm_station`), so a station still out of
        range at LOAD loses that result for good. Advisory, like `_station_warnings()` beside it: it
        never blocks LOAD or START, and it clears the moment the station's node is heard again."""
        if self._match_end_t is None:
            return []
        return [f"{label} HAS NOT SYNCED THE LAST MATCH: BRING IT INTO WI-FI BEFORE YOU LOAD, OR ITS RESULT IS LOST"
                for nid, label in self._sync_pending.items()
                if self.nodes.get(nid, {}).get("last_seen_ms", 0) < self._match_end_t]

    def set_station(self, nid: str, a: dict) -> StationView:
        """The operator's ITEMS assignment for one utility phone: kind / team / id / threshold. Validated in
        the same voice as `set_config`, stored, and pushed as `station_config` at once (utility.md §5b.1)."""
        if not isinstance(a, dict):
            raise ValueError("assignment must be an object")
        if (view := self._set_station_range_only(nid, a)) is not None:
            return view                        # A67: a RANGE/STRENGTH-only edit, allowed in any phase
        self._refuse_station_change_in_play()
        kind = a.get("kind")
        if not is_station_kind(kind):
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
        # F364: MC assigns the id. An explicit `id` (an older console) is still accepted and validated below.
        sid = a.get("id")
        if sid is None:
            sid = self._auto_station_id(nid)
        if not (isinstance(sid, int) and not isinstance(sid, bool) and 1 <= sid <= 65535):
            raise ValueError("id must be an integer 1..65535 (the station id in the advert), or absent for MC to assign one")
        clash = next((n for n, st in self.stations.items() if n != nid and (st.get("assigned") or {}).get("id") == sid), None)
        if clash:
            raise ValueError(f"station id {sid} is already assigned to {clash}; ids must be unique on the field")
        # F345: 0 (and absent) = the station's own PLATFORM default, which it advertises in byte 14 (a respawn
        # station: a phone -70, a StickS3 -57, Tony 2026-09-24). Any other value is the operator's override.
        thr = a.get("threshold", 0)
        if not (isinstance(thr, int) and not isinstance(thr, bool) and (thr == 0 or -100 <= thr <= -30)):
            raise ValueError("threshold must be 0 (the station's own default) or an integer dBm in -100..-30 (the presence bubble)")
        # Only a phone that said hello as a UTILITY node can be a station. A player's HUD ignores
        # `station_config`, and assigning it would advertise a station id to every player that nothing
        # on the field emits (review 2026-09-11).
        if nid not in self.stations and (self.nodes.get(nid) or {}).get("node_type") != "utility":
            raise ValueError(f"{nid!r} is not a utility phone (no utility hello this session); open the app in the "
                             "UTILITY role on that phone and connect it to Mission Control first")
        # 2026-09-19 (field): a station's node record survives its phone going quiet -- on purpose, so
        # it can be re-armed the moment it comes back (`_arm_station`'s "bring it back to re-arm"). But
        # ASSIGNING one while it is stale (no message in STALE_AFTER_MS) just walks the operator into an
        # arm that fails against a dead socket: this exact node_id went quiet because the same physical
        # phone re-opened elsewhere under a NEW node_id (a player role, or its storage cleared) and is
        # never coming back to THIS one. Refuse here, same voice as the rest of this validation, rather
        # than let the push fail silently downstream.
        # A56 (S58): a powerup station's item, picked from MC's presets. The expanded item is what is stored.
        if "item" in a:
            raise ValueError("send item_preset (one of: " + ", ".join(_pu.PRESET_IDS) + "), not a raw item")
        item: StationItem | None = None
        if "item_preset" in a and a["item_preset"] is not None:
            if not self.powerups_enabled:
                raise ValueError(_pu.REFUSED_FLAG_OFF)
            if kind != "powerup":
                raise ValueError(f"item_preset is for a powerup station, not {kind!r}")
            if not isinstance(a["item_preset"], str):
                raise ValueError("item_preset must be one of: " + ", ".join(_pu.PRESET_IDS))
            item = _pu.expand(a["item_preset"], getattr(self.compiler, "catalog", None))
            others = [it for n, _a, it in self._item_stations() if n != nid]
            _pu.weapon_slots([*others, item])      # refuses a third different weapon
        if (self.nodes.get(nid) or {}).get("stale"):
            raise ValueError(f"{nid!r} has not been heard from recently (its link has gone stale); it cannot be "
                             "assigned until it reconnects -- if this phone reopened elsewhere, its NEW node_id "
                             "is the one to assign instead")
        prev_a = (self.stations.get(nid) or {}).get("assigned")
        if prev_a and prev_a["kind"] != kind and thr == prev_a["threshold"]:
            thr = 0                            # A67: a new kind starts at its own default, not the old kind's range
        rng = self._range_fields(prev_a, thr, a)   # A67: validates tx_power
        slots_before = self._powerup_slots()
        st = self.stations.setdefault(nid, {"node_id": nid, "assigned": None, "report": {}, "armed": None})
        assignment: StationAssignment = {"kind": kind, "team": team, "id": sid, "threshold": thr, "at": self.now_ms()}
        assignment.update(rng)
        if item is not None:
            assignment["item"] = item
        st["assigned"] = assignment
        self._station_id_of[nid] = sid
        self.nodes.setdefault(nid, {"node_id": nid, "node_type": "utility", "arm_state": "idle", "synced": False, "last_seen_ms": 0})
        # An assignment changes the allow-list every OTHER station echoes, so all of them are re-armed.
        self._after_station_change(slots_before)
        self._validate()
        self._changed()
        return self._station_view(nid)

    def _auto_station_id(self, nid: str) -> int:
        """F364: the id MC gives a station assigned with no `id`. A station keeps the id it already holds, then the
        one it was handed earlier this session (a clear, a restart or a relink never renumbers it), unless another
        station now holds that number. A new station takes the lowest id no station holds or was handed, so a
        phone and a Stick share one sequence: 1, 2, 3."""
        used = {a["id"] for n, st in self.stations.items() if n != nid and (a := st.get("assigned"))}
        own = ((self.stations.get(nid) or {}).get("assigned") or {}).get("id")
        for cand in (own, self._station_id_of.get(nid)):
            if isinstance(cand, int) and 1 <= cand <= 65535 and cand not in used:
                return cand
        taken = used | {i for n, i in self._station_id_of.items() if n != nid}
        sid = 1
        while sid in taken:
            sid += 1
        if sid > 65535:
            raise ValueError("no free station id is left (1..65535)")
        return sid

    def clear_station(self, nid: str) -> bool:
        st = self.stations.get(nid)
        if not st:
            return False
        self._refuse_station_change_in_play()
        slots_before = self._powerup_slots()
        st["assigned"] = None
        st["armed"] = None
        self._after_station_change(slots_before)   # the survivors' valid_ids shrink
        self._validate()
        self._changed()
        return True

    def release_station(self, nid: str) -> bool:
        """A41 (2026-09-13 field): the operator's cure for a phone stuck in utility mode, whether it
        landed there by accident (the HUD's own entry gesture caught by a jostle) or an operator wants a
        deployed station back as a HUD -- with no way out an operator could drive today: the phone's OWN
        exit is the same undiscoverable seven-tap gesture its settings drawer uses (F104-adjacent, field
        2026-09-12: an Android needed its app storage wiped, an iPhone needed someone walked through the
        gesture over chat). `control{cmd:"release_utility"}` to ONE utility node -- `utility.js` takes it
        exactly the way its own BACK TO HUD button does (`brx.role` back to `'hud'`, reload into the
        HUD). Deliberately NOT phase-gated (unlike `set_station`/`clear_station`): a stranded phone needs
        releasing in every phase, armed/live included. An accepted release re-arms surviving stations and
        re-pushes lobby HUDs only; `_repush_stations_to_players` protects armed/live guns on its own.
        Best-effort like `_arm_station`: a phone with no socket has nothing to retry against, and its own
        seven-tap gate is still there under this if the push never lands.

        ...and the ASSIGNMENT goes with the phone. A release used to leave it standing, so MC kept vouching
        for a field item that had walked away: the ITEMS card still rendered its kind/id/team as a deployed
        station, `_station_warnings` still counted it as the control point or respawn point this game's
        rules need (so a station-gated game read as SET UP with nothing on the field emitting anything --
        the F104 failure mode, produced by MC's own bookkeeping), and `_station_ids()` still handed its id
        to every player's `config.stations` allow-list.

        Cleared ONLY when the push was taken. A release that reached no socket changed nothing on the field
        -- that phone is still a station -- and clearing the row then would be the same lie pointing the
        other way. The cleanup is `clear_station`'s, minus its phase gate: `_repush_stations_to_players` is
        LOBBY-only on its own, so nothing re-arms a live gun here, which is what lets this stay ungated."""
        if nid not in self.stations:
            return False
        ok = self.net.push(nid, "control", {"cmd": "release_utility"}) is not False
        st = self.stations.get(nid)
        if ok and st is not None and (st.get("assigned") or st.get("armed")):
            if self.scorer and self.phase in ("armed", "live"):
                rec = self._station_recap_row(self._station_view(nid))
                if rec is not None:
                    self._departed_match_stations[nid] = rec
            slots_before = self._powerup_slots()
            st["assigned"], st["armed"], st["arm_pending"] = None, None, False
            for k in _STATION_LOCK_KEYS:
                if k != "boot":                # the last boot seen stays: a restart is judged against it
                    st.pop(k, None)            # A58: a release unlocks the Stick too (utility.md)
            self._after_station_change(slots_before)   # the survivors' valid_ids shrink
            self._validate()                       # ...and the SETUP warnings tell the truth again
            self._changed()
        return ok

    def _after_station_change(self, slots_before: list[PowerupSlot]) -> None:
        """Re-arm every station and re-push the players' allow-list -- or, when the pickup weapons moved (A56),
        a fresh head for the whole roster, because the spare slots are in the FRAMES, not only the config.
        Never in play: `_repush_stations_to_players` is lobby-only. `set_station`/`clear_station` refuse in
        play, but `release_station` does not: in play it drops the item's slot from `_powerup_slots()` at once,
        and the guns already armed keep the slot in their frames because nothing re-pushes a live gun here."""
        self._resend_brief_pickups()
        if self._powerup_slots() != slots_before and self.lobby_pushed and not self.in_play():
            self._fresh_head_repush()              # re-arms the stations too
            return
        self.arm_stations()
        self._repush_stations_to_players()

    def _resend_brief_pickups(self) -> None:
        """F403: a bound phone's BRIEFING carries `game_brief()["pickups"]`, delivered by `assign`. An item added,
        changed or cleared before the match re-sends `assign`, so the PICKUPS line never goes stale. Never in play."""
        if self.in_play():
            return
        for p in self.players.values():
            if p.get("node_id"):
                self._send_assign(p)

    def _refuse_station_change_in_play(self) -> None:
        """An assignment or clear is a `config` re-push to every player (below), and the phone's
        `_applyConfig` rewrites the gun head and sets `spawned = false` whatever the phase -- on a LIVE gun
        that silences every hit and death handler for the rest of the match (polish review 2026-09-11).
        So the ITEMS panel is a muster/lobby control: once a start is scheduled it is refused in the
        operator's voice rather than quietly re-arming the field."""
        if self.in_play():
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

    @staticmethod
    def _wire_threshold(nid: str, st: dict, a: StationAssignment) -> int:
        """F345: the `station_config.threshold` one station is sent. 0 means "your own platform default", but a phone
        app older than PHONE_THRESHOLD_ZERO_APP clamps 0 to -30 dBm (a few cm: no revive is possible). Such a phone,
        or one whose version MC cannot parse, gets the explicit value instead: the new phone respawn default for a
        respawn station, the old -74 for any other kind. A StickS3 (platform `esp32`) has always read 0 correctly."""
        thr = a["threshold"]
        if thr != 0 or st.get("platform") == "esp32" or nid.startswith("stick-"):
            return thr
        v = parse_app_ver(st.get("app_ver"))
        if v is not None and v >= PHONE_THRESHOLD_ZERO_APP:
            return 0
        if a["kind"] == "respawn":
            return PHONE_RESPAWN_THRESHOLD_DBM
        return PHONE_POWERUP_THRESHOLD_DBM if a["kind"] == "powerup" else PHONE_STATION_THRESHOLD_DBM

    def _range_fields(self, prev: StationAssignment | None, thr: int, a: dict) -> dict:
        """A67 (F365): the range bookkeeping for an operator's assignment. A value that CHANGED (or a new
        assignment) is the operator's edit: source "mc", set now. An unchanged value keeps who set it and when,
        so re-arming with the same numbers does not beat a newer on-station edit. `tx_power` absent from the
        body keeps the assignment's; MC sends none until one is set."""
        now = self.now_ms()
        out: dict = {}
        if "tx_power" in a and a["tx_power"] is not None:
            if a["tx_power"] not in TX_POWERS:
                raise ValueError("tx_power must be one of " + ", ".join(TX_POWERS))
            tx = a["tx_power"]
        else:
            tx = (prev or {}).get("tx_power")
        for f, value in (("threshold", thr), ("tx_power", tx)):
            if value is None:
                continue
            out[f] = value
            if prev and prev.get(f) == value:
                out[f + "_set_at"] = prev.get(f + "_set_at", prev.get("at", 0))
                out[f + "_src"] = prev.get(f + "_src", "mc")
            else:
                out[f + "_set_at"], out[f + "_src"] = now, "mc"
        out.pop("threshold", None)             # the caller already holds the validated threshold
        return out

    def _set_station_range_only(self, nid: str, a: dict) -> StationView | None:
        """A67 (F365): a PUT that changes only RANGE (threshold) and/or STRENGTH (tx_power) of an assigned station.
        The allow-list and every player's config are unchanged, so it re-arms THIS station only and is allowed in
        every phase, LIVE included (a station re-armed mid-match keeps its game byte: the same as a reconnect).
        None = not a range-only change; `set_station` goes on as before."""
        st = self.stations.get(nid)
        prev = (st or {}).get("assigned")
        if not prev or a.get("kind") != prev["kind"] or ("id" in a and a["id"] != prev["id"]):
            return None
        team = a.get("team", STATION_TEAM_ANY)
        if team in ("any", "ffa"):
            team = STATION_TEAM_ANY
        if team != prev["team"]:
            return None
        if "item" in a:
            return None
        preset = a.get("item_preset")
        if preset is not None:
            try:
                if _pu.expand(preset, getattr(self.compiler, "catalog", None)) != prev.get("item"):
                    return None
            except (ValueError, KeyError, TypeError):
                return None
        thr = a.get("threshold", 0)
        if not (isinstance(thr, int) and not isinstance(thr, bool) and (thr == 0 or -100 <= thr <= -30)):
            raise ValueError("threshold must be 0 (the station's own default) or an integer dBm in -100..-30 (the presence bubble)")
        rng = self._range_fields(prev, thr, a)
        if thr == prev["threshold"] and rng.get("tx_power") == prev.get("tx_power"):
            # nothing moved. In play that is not a refusal (the card re-sent what it shows): the view as it is.
            # Outside play the full path runs as before (it re-arms every station).
            return self._station_view(nid) if self.in_play() else None
        new = cast(StationAssignment, {**prev, "threshold": thr, **rng, "at": self.now_ms()})
        assert st is not None                  # `prev` came from it
        st["assigned"] = new
        self._arm_station(nid)
        self._changed()
        return self._station_view(nid)

    def _note_station_range(self, nid: str, st: dict, body: dict, t_recv: int) -> None:
        """A67 (F365): last edit wins, per field. A station that reports `<field>_src: "station"` with an edit age
        dates that edit on MC's clock (t_recv - age). When it is newer than MC's own `<field>_set_at`, MC ADOPTS
        the station's value into the assignment (no re-arm: the station already has it). A Stick that rebooted
        reports a LARGE age, so its edit is older than anything MC set and MC's value wins on the next arm."""
        edit_ats = st["range_edit_at"] = {}   # the report's own edit time per field (MC clock), for the view
        for f in ("threshold", "tx_power"):
            age = body.get(f + "_edit_age_ms")
            if body.get(f + "_src") == "station" and isinstance(age, int) and not isinstance(age, bool) and age >= 0:
                edit_ats[f] = t_recv - age
        a = st.get("assigned")
        if a:
            for f in ("threshold", "tx_power"):
                value, src, age = body.get(f), body.get(f + "_src"), body.get(f + "_edit_age_ms")
                if src != "station" or not (isinstance(age, int) and not isinstance(age, bool) and age >= 0):
                    continue
                ok = (isinstance(value, int) and not isinstance(value, bool) and -100 <= value <= -30) if f == "threshold" \
                    else value in TX_POWERS
                if not ok:
                    continue
                edit_at = t_recv - age
                if edit_at <= a.get(f + "_set_at", a.get("at", 0)):
                    continue                   # MC's value is newer: the station applies it on the next arm
                if a.get(f) == value and a.get(f + "_src") == "station":
                    continue                   # already adopted (a beat's latency jitter is not a new edit)
                a[f], a[f + "_src"], a[f + "_set_at"] = value, "station", edit_at
                self._log(nid, "range_adopted", {"field": f, "value": value, "edit_at": edit_at}, t_recv)
        self._note_range_edits(st, body.get("range_edits"), t_recv)

    def _note_range_edits(self, st: dict, edits: object, t_recv: int) -> None:
        """A67: each new on-station edit, once: a feed line and a card attention line for this game. Deduped by
        `seq`, which rises per edit and survives a reboot; the high-water mark is persisted (`station_range_seen`)
        so an MC restart does not announce them again. A list whose highest seq is BELOW the mark is a station
        whose count restarted (a reinstall wiped its storage): the mark starts again from 0."""
        if not isinstance(edits, list):
            return
        rows = [e for e in edits if isinstance(e, dict) and _range_edit_ok(e)]
        if not rows:
            return
        seen = st.setdefault("range_seen", {"max": 0, "edits": []})
        if max(e["seq"] for e in rows) < seen["max"]:
            seen["max"] = 0
        a = st.get("assigned") or {}
        sid = a.get("id") or (st.get("report") or {}).get("station_id") or "?"
        for e in sorted(rows, key=lambda e: e["seq"]):
            if e["seq"] <= seen["max"]:
                continue
            seen["max"] = e["seq"]
            known = e["age_ms"] < STATION_EDIT_AGE_UNKNOWN_MS
            row = {"seq": e["seq"], "field": e["field"], "from": e["from"], "to": e["to"], "locked": e["locked"],
                   "at": t_recv - e["age_ms"] if known else None, "match": self._range_edit_match()}
            seen["edits"] = [*seen["edits"], row][-8:]
            what = "RANGE" if e["field"] == "threshold" else "STRENGTH"
            text = (f"STATION #{sid} {what} CHANGED {_range_word(e['from'])} → {_range_word(e['to'])}"
                    + (" (LOCKED)" if e["locked"] else "") + " · " + (_ago(e["age_ms"]) if known else "BEFORE A RESTART"))
            self._on_feed({"t_match_s": self._operator_t_match(t_recv), "tag": "STATION", "kind": "info", "text": text})

    def _range_edit_match(self) -> int:
        """A67 polish: the match an on-station edit belongs to, for its attention line. In play or in RECAP it is the
        match that started last; before a START (muster to lobby) it is the match about to start. A line shows while
        its match is the current one, so it clears at the START after its match."""
        return self._range_epoch if self.phase in ("armed", "live", "recap") else self._range_epoch + 1

    def _station_range_view(self, st: dict, rep: StationReport, now: int) -> tuple[StationRange, list[RangeEdit], list[str]]:
        """A67: `StationView.range`, `.range_edits` and the attention lines for this game's on-station edits."""
        a = st.get("assigned") or {}
        rng: dict = {}                         # a StationRange, built key by key
        for f in ("threshold", "tx_power"):
            # STRENGTH is only ever what the station REPORTS (a phone that cannot set power reports its real value);
            # RANGE falls back to the assignment until the first beat.
            value = rep.get(f) if rep.get(f) is not None or f == "tx_power" else a.get(f)
            if value is None:
                continue
            rng[f] = value
            if rep.get(f) is not None and a.get(f) is not None and rep.get(f) != a.get(f):
                # the station applies something other than MC's record: say what the STATION says about it
                src, at = rep.get(f + "_src"), (st.get("range_edit_at") or {}).get(f)
            else:
                src, at = a.get(f + "_src") or rep.get(f + "_src"), a.get(f + "_set_at")
            if src in ("station", "mc"):
                rng[f + "_src"] = src
            if src == "station" and isinstance(at, int) and now - at < STATION_EDIT_AGE_UNKNOWN_MS:
                rng[f + "_edit_age_ms"] = max(0, now - at)
        edits: list[RangeEdit] = []
        lines: list[str] = []
        epoch = self._range_epoch
        last: dict[str, dict] = {}
        for e in (st.get("range_seen") or {}).get("edits") or []:
            age = now - e["at"] if isinstance(e.get("at"), int) else STATION_EDIT_AGE_UNKNOWN_MS
            edits.append(cast(RangeEdit, {"seq": e["seq"], "field": e["field"], "from": e["from"], "to": e["to"],
                                          "locked": e["locked"], "age_ms": max(0, age)}))
            if isinstance(e.get("match"), int) and e["match"] >= epoch:
                last[e["field"]] = e           # this match's edit: shown until the next START
        for f, e in last.items():
            what = "RANGE" if f == "threshold" else "STRENGTH"
            lines.append(f"{what} EDITED ON STATION {_range_word(e['from'])} → {_range_word(e['to'])}"
                         + (" (LOCKED)" if e["locked"] else ""))
        return cast(StationRange, rng), edits, lines

    def _arm_station(self, nid: str, relock: bool = False) -> bool:
        """Push `station_config` to one assigned station. Best-effort: an offline phone is flagged
        `arm_pending` (roadmap A4 "bring back to re-arm") and armed on its next hello, never retried on a timer."""
        st = self.stations.get(nid)
        if st is None:
            return False
        a = st.get("assigned")
        if not a:
            return False
        body = {"kind": a["kind"], "team": a["team"], "id": a["id"], "threshold": self._wire_threshold(nid, st, a),
                "game": self._game_byte(), "valid_ids": [x["id"] for x in self._station_ids()]}
        # A67 (F365): how old MC's range values are. The station keeps its own edit when that edit is YOUNGER.
        now = self.now_ms()
        # An ADOPTED edit (src station) carries ADOPT_SLACK_MS more, so the station's own edit stays the younger one.
        def _age(f: str) -> int:
            return max(0, now - a.get(f + "_set_at", a.get("at", now))) + (ADOPT_SLACK_MS if a.get(f + "_src") == "station" else 0)
        body["threshold_age_ms"] = _age("threshold")
        if a.get("tx_power") in TX_POWERS:
            body["tx_power"] = a["tx_power"]
            body["tx_power_age_ms"] = _age("tx_power")
        if item := self._active_item(a):
            body["item"] = item                    # A56: an older Stick ignores it
        body["lock_s"] = lock = self._station_lock_s()   # A58: a phone station ignores it
        # RECALL/PANIC leave the session in KIT with the same game byte. A connected hill
        # must stop then, and a later hello must not restart its tally by omitting this field.
        # An aborted countdown clears _game_no_started, so its same-game re-start stays possible.
        if self.phase == "recap" or (not self.in_play() and self._game_no_started and not self.lobby_pushed):
            body["ends_in_ms"] = 0
        elif self.phase in ("armed", "live") and self.start_info and not self.is_adopted():
            body["starts_in_ms"] = self.start_info["go_live_t"] - now
            if tl_s := self.config.get("time_limit_s"):
                body["ends_in_ms"] = max(0, self.start_info["go_live_t"] + tl_s * 1000 - now)
        if not self.is_adopted() and (self.lobby_pushed or self.phase in ("armed", "live")) and (tl_s := self.config.get("time_limit_s")):
            body["duration_ms"] = tl_s * 1000
        if lock == 0 and st.get("locked_since") is not None and st.get("unlocked_at") is None:
            st["unlocked_at"] = self.now_ms()  # the window closes at the unlock, heard or not
        elif lock > 0 and st.get("lock_game") == body["game"]:
            st["unlocked_at"] = None           # ...and reopens at a re-lock, heard or not (abort, then START)
        ok = self.net.push(nid, "station_config", body)
        if ok is False:                        # NetServer says "no live socket"; a fake returns None
            # A58: a lock-only re-send (START, END, RECALL, abort, unlock) missing a muster station that is out
            # of Wi-Fi by design is not an assignment it missed, so it raises no BRING IT BACK TO RE-ARM.
            if not relock:
                st["arm_pending"] = True
            return False
        st["arm_pending"] = False
        st["armed"] = {"game": body["game"], "at": self.now_ms(), "kind": a["kind"], "team": a["team"], "id": a["id"]}
        self._note_station_lock(st, body["game"], lock)
        return True

    def _station_lock_s(self) -> int:
        """A58: the `lock_s` every `station_config` carries now. A pushed game before START (LOAD) covers the lobby
        wait and the match, since a muster station hears nothing more; ARMED/LIVE is the exact time left
        (a START re-send, or a station back mid-match); anything else, or the operator's unlock, is 0."""
        if self._stations_unlocked:
            return 0
        tl = self.config.get("time_limit_s")
        if self.phase in ("armed", "live") and self.start_info:
            # F337 (c): MC holds no config for an ADOPTED match (`is_adopted`), so `tl` is the operator's
            # draft, not the phones' limit. The draft could unlock a station before the phones stop; the cap
            # cannot. MC never learns the adopted match's own limit, so there is no better number to use.
            if not tl or self.is_adopted():
                return STATION_LOCK_MAX_S
            left_ms = self.start_info["go_live_t"] + tl * 1000 - self.now_ms()
            return max(STATION_LOCK_MARGIN_S, min(STATION_LOCK_MAX_S, -(-left_ms // 1000) + STATION_LOCK_MARGIN_S))
        # F337 (d): a game that is loaded and pushed keeps its stations locked in every pre-match phase, so
        # stepping LOBBY back to KIT (or further) does not unlock a held station that stays in the field.
        # Only END, RECALL, abort, the operator's unlock or a new session send 0 (each clears `lobby_pushed`
        # or sets `_stations_unlocked`).
        if self.phase in ("muster", "build", "kit", "lobby") and self.lobby_pushed:
            return min(STATION_LOCK_MAX_S, tl + STATION_LOCK_LOBBY_S + STATION_LOCK_MARGIN_S) if tl else STATION_LOCK_MAX_S
        return 0

    def _note_station_lock(self, st: dict, game: int, lock: int) -> None:
        """A58: remember what this station was told, and the lock window a restart is judged against. The
        window opens at the game's first nonzero lock and closes at the first unlock after it."""
        now = self.now_ms()
        st["lock"] = {"s": lock, "at": now}
        if lock > 0 and st.get("lock_game") != game:
            st.update(lock_game=game, locked_since=now, unlocked_at=None, restarts=0)
        elif lock > 0:
            st["unlocked_at"] = None             # locked again for the same game (an abort, then a new START)
        elif st.get("locked_since") is not None and st.get("unlocked_at") is None:
            st["unlocked_at"] = now

    def _note_station_boot(self, st: dict, body: dict, t_recv: int) -> None:
        """A58: a station dates its own boot by `uptime_s`, so a restart shows even in the first heartbeat after
        it rejoins (a muster station is out of Wi-Fi for the whole match). A new boot is a `boot_count` rise, or
        a boot instant that moved; it counts when the boot falls inside this game's lock window."""
        up, count = body.get("uptime_s"), body.get("boot_count")
        up = up if isinstance(up, int) and not isinstance(up, bool) and up >= 0 else None
        count = count if isinstance(count, int) and not isinstance(count, bool) else None
        if up is None and count is None:
            return
        boot_at = t_recv - up * 1000 if up is not None else None
        prev = st.get("boot") or {}
        new = 0
        if count is not None and isinstance(prev.get("count"), int):
            # trusted alone when both beats carry it (a late beat is not a boot); a lower count is a wiped NVS, one boot
            new = count - prev["count"] if count >= prev["count"] else 1
        elif boot_at is not None and prev.get("at") is not None and boot_at - prev["at"] > STATION_REBOOT_SLACK_MS:
            new = 1
        st["boot"] = {"at": boot_at if boot_at is not None else prev.get("at"), "count": count if count is not None else prev.get("count")}
        since, until = st.get("locked_since"), st.get("unlocked_at")
        when = boot_at if boot_at is not None else t_recv
        if new and since is not None and when >= since and (until is None or when <= until):
            st["restarts"] = st.get("restarts", 0) + new

    def _keep_station_tally(self, st: dict, t_recv: int) -> None:
        """A58 (brx4): a restarted Stick resumes its tally from the one saved at its last capture, so a report can
        DROP mid-match. A station's count within one game only grows, so MC keeps the per-team maximum of
        `control.hold_ms` and the largest `revives` for the game the station is armed with, and writes them back
        into the report. A new game or a new assignment starts clean; a beat within one heartbeat of that arming may
        still carry the old tally, so it passes through without seeding the new one (a beat later than that, from a
        station slow to apply the arming, can still seed it: a small race the self-authoritative design accepts)."""
        armed = st.get("armed") or {}
        game, rep = armed.get("game"), st["report"]
        if game is None or t_recv < (armed.get("at") or 0) + STATUS_HEARTBEAT_MS:
            return
        key = [game, armed.get("kind"), armed.get("id")]   # a re-assigned station is a new tally, same game or not
        tally = st.get("tally")
        if not tally or tally.get("key") != key:
            tally = st["tally"] = {"key": key, "hold_ms": {}, "revives": None}
        control = rep.get("control")
        hold = control.get("hold_ms") if isinstance(control, dict) else None
        if isinstance(hold, dict):
            for tid, ms in hold.items():
                if isinstance(ms, int) and not isinstance(ms, bool) and ms > tally["hold_ms"].get(tid, -1):
                    tally["hold_ms"][tid] = ms
            rep["control"] = {**control, "hold_ms": {**hold, **tally["hold_ms"]}}
        rv = rep.get("revives")
        if isinstance(rv, int) and not isinstance(rv, bool):
            tally["revives"] = max(rv, tally["revives"] or 0)
            rep["revives"] = tally["revives"]

    def unlock_stations(self) -> dict:
        """A58 `POST /api/stations/unlock`: `lock_s: 0` to every assigned station now. A muster station out of
        Wi-Fi hears it only when it rejoins. The next LOAD push or START locks them again."""
        self._stations_unlocked = True
        out = self.arm_stations(relock=True)
        self._changed()
        return {"ok": True, **out}

    def arm_stations(self, relock: bool = False) -> dict:
        """Re-arm every assigned station with the current game number and allow-list. `relock` (A58): only the
        lock moved, so a station out of Wi-Fi is not flagged for re-arming."""
        armed = [nid for nid in self.stations if self._arm_station(nid, relock)]
        pending = [nid for nid, st in self.stations.items() if st.get("assigned") and st.get("arm_pending")]
        return {"armed": len(armed), "pending": pending}

    def _station_view(self, nid: str) -> StationView:
        st = self.stations[nid]
        now = self.now_ms()
        seen = st.get("last_seen_ms")
        a = st.get("assigned")
        armed = st.get("armed")
        rep = st.get("report") or {}
        attention: list[str] = []
        if a and st.get("arm_pending"):
            attention.append(STATION_BRING_BACK)            # assignment changed with the phone out of range
        if a and armed and armed.get("game") != self._game_byte():
            attention.append(STATION_ARMED_OLDER)            # it missed the muster push
        # The phone's own report only contradicts the arming if it arrived AFTER the push -- the heartbeat
        # from before an assignment naturally says "not armed" / the old id (review 2026-09-11).
        fresh = bool(armed) and seen is not None and seen > (armed.get("at") or 0)
        if a and fresh and rep.get("armed") is False:
            attention.append(STATION_NOT_ARMED)               # the push was sent; the phone never applied it
        if a and fresh and rep.get("station_id") not in (None, a["id"]):
            attention.append(f"PHONE ADVERTISES ID {rep.get('station_id')}, ASSIGNED {a['id']}: {STATION_REARM}")
        if isinstance(rep.get("battery"), (int, float)) and rep["battery"] < BATTERY_LOW_PCT:
            attention.append(STATION_BATTERY_LOW)
        report: StationReport = {}
        kind = rep.get("kind")
        if is_station_kind(kind):
            report["kind"] = kind
        for key in ("team", "station_id", "threshold", "revives", "uptime_s", "boot_count"):
            value = rep.get(key)
            if isinstance(value, int) and not isinstance(value, bool):
                report[key] = value
        if (assoc := rep.get("assoc")) in ("muster", "held"):
            report["assoc"] = assoc
        if rep.get("tx_power") in TX_POWERS:          # A67
            report["tx_power"] = rep["tx_power"]
        if (src := rep.get("threshold_src")) in ("station", "mc"):
            report["threshold_src"] = src
        if (src := rep.get("tx_power_src")) in ("station", "mc"):
            report["tx_power_src"] = src
        for key in ("live", "armed"):
            value = rep.get(key)
            if isinstance(value, bool):
                report[key] = value
        battery = rep.get("battery")
        if isinstance(battery, (int, float)) and not isinstance(battery, bool):
            report["battery"] = battery
        control = rep.get("control")
        if isinstance(control, dict):
            decoded_control: StationControl = {}
            for key in ("owner", "progress"):
                value = control.get(key)
                if isinstance(value, int) and not isinstance(value, bool):
                    decoded_control[key] = value
            contested = control.get("contested")
            if isinstance(contested, bool):
                decoded_control["contested"] = contested
            hold_ms = control.get("hold_ms")
            if isinstance(hold_ms, dict) and all(isinstance(k, str) and isinstance(v, int) and not isinstance(v, bool)
                                                for k, v in hold_ms.items()):
                decoded_control["hold_ms"] = hold_ms
            report["control"] = decoded_control
        # 2026-09-19 (field, twice in one day): a station's `online` used to ask `OFFLINE_AFTER_MS`
        # (10 min) -- the "has this record left the field entirely" line, not "can I reach it right
        # now". A phone that had re-opened elsewhere under a NEW node_id (a fresh player node, or the
        # app's storage cleared) left THIS node_id's record sitting `online: True` for minutes with
        # nothing behind it: still assignable, still "armable", and arming it just failed silently
        # against a dead socket. `self.nodes[nid]["stale"]` is the fact that already answers this (the
        # net layer's own STALE_AFTER_MS = 8 s freshness judgement) -- reuse it instead of a second,
        # much more lenient rule that disagreed with it.
        node_stale = bool((self.nodes.get(nid) or {}).get("stale"))
        lock = st.get("lock") or {}
        restarts = st.get("restarts", 0) if st.get("lock_game") == self._game_byte() else 0
        if a:
            attention.extend(self._station_tamper_flags(a["id"], report.get("assoc"), lock, restarts,
                                                        online=bool(seen) and not node_stale, now=now))
        view: StationView = {"node_id": nid, "assigned": a, "armed": armed, "arm_pending": bool(st.get("arm_pending")),
                "report": report, "app_ver": st.get("app_ver"), "platform": st.get("platform"),   # A29
                "last_seen_ms": (now - seen) if seen else None,
                "online": bool(seen) and not node_stale,
                "attention": attention, "game": self._game_byte()}
        if lock.get("s"):
            view["lock_until_ms"] = lock["at"] + lock["s"] * 1000
        if restarts:
            view["restarts"] = restarts
        rng, edits, lines = self._station_range_view(st, report, now)   # A67
        if rng:
            view["range"] = rng
        if edits:
            view["range_edits"] = edits
        if a:
            attention.extend(lines)
        pu = self._pu_update_body(nid) if self.phase in ("armed", "live") else None
        if pu is not None:                         # A56: only while a schedule runs for the match in play
            row = self._pu_sched["st"][nid]
            view["item_available"] = row["available"]
            view["next_spawn_at_ms"] = _pu.spawn_at(row["item"], self._pu_sched["go"], row["next_k"])
            if row.get("taken_by") is not None:
                view["taken_by"] = row["taken_by"]
        return view

    def _station_tamper_flags(self, sid: int, assoc: str | None, lock: dict, restarts: int, *, online: bool,
                              now: int) -> list[str]:
        """A58: the tamper flags. A restart inside the lock window; a HELD station gone stale while the match
        is in play (a muster station is out of Wi-Fi by design); and, in LOBBY, a muster station (or a HELD one gone
        offline) whose LOAD lock would run out before the match could end, so the operator can send it through muster again."""
        out: list[str] = []
        if restarts:
            out.append(f"STATION #{sid} RESTARTED" + (f" {restarts} TIMES" if restarts > 1 else "")
                       + ": CHECK THE STATION")
        if assoc == "held" and not online and self.phase in ("armed", "live"):
            out.append(f"STATION #{sid} OFFLINE: CHECK IT IS ON AND IN RANGE")
        tl = self.config.get("time_limit_s")
        # A HELD Stick carried out of Wi-Fi before START (the A68 field model) cannot hear START's relock either.
        if ((assoc == "muster" or (assoc == "held" and not online)) and self.phase == "lobby" and tl and lock.get("s")
                and now + (DEFAULT_RUNWAY_S + tl) * 1000 > lock["at"] + lock["s"] * 1000):
            out.append(f"STATION #{sid} LOCK EXPIRES MID-MATCH: TAKE IT BACK THROUGH MUSTER")
        return out

    def stations_view(self) -> list[StationView]:
        return [self._station_view(nid) for nid in sorted(self.stations)]

    def _scorer_recap(self, sc: Scorer, stations: list[RecapStationRow] | None = None) -> RecapView:
        """THE recap: the scorer's sheet plus the stations rows (A6). Every call site goes through here -- the
        late-fact re-store (`_restore_recap`) used to call `scorer.recap()` bare, so the first fact after END
        (the outbox flush, i.e. the normal case) silently dropped `stations` from `last_recap` and the DB row
        (polish review 2026-09-11).

        The scorer is PASSED, not read off `self`: all three callers already hold a non-None one, and
        naming it here is what makes that visible (there is no recap without a scorer).

        `stations` lets a caller pass FROZEN rows for a match that is no longer current (F206) --
        `self._recap_stations()` always reads the CURRENT stations, which is wrong once a later
        match has started."""
        recap = sc.recap(stations=stations if stations is not None else self._recap_stations())
        # F319: the match length, only once the whistle has a time; without one the console falls back
        # to its own clock arithmetic rather than show a length that keeps growing.
        if sc.end_t is not None and sc.go_live_t is not None and (self.phase == "recap" or sc.end_t <= self.now_ms()):
            recap["played_s"] = max(0, round((sc.end_t - sc.go_live_t) / 1000))   # rounded, as the console always did
        # F401: once the match has ended, say whether MC has heard each station's node SINCE the whistle
        # -- a HELD station can end a timed match on its own clock while out of Wi-Fi range, and MC only
        # gets its result once it is heard again (`settling()` is the same idea for players). Computed
        # LIVE off `self.nodes`, never frozen onto the row: the node may come back into range long after
        # `_finish` ran, even carrying a NEW assignment for the next match, and that reconnection is what
        # `synced` reports -- independent of whose count `heard`/`revives` still belong to.
        if sc.end_t is not None and self.now_ms() >= sc.end_t:   # `end_t` is a DEADLINE until it has passed
            end_t = sc.end_t
            for row in recap.get("stations") or []:
                row["synced"] = self.nodes.get(row["node_id"], {}).get("last_seen_ms", 0) >= end_t
        return recap

    def _recap_stations(self) -> list[RecapStationRow]:
        """Roadmap A6: a stations row for the recap sheet, one per ASSIGNED station, from its own
        self-authoritative heartbeat (utility.md §5c/§5d.6 -- a station answers to nobody mid-match, so
        this is the only place its count is ever seen). `heard` (True once at least one heartbeat has
        landed in `report`) is set on EVERY row regardless of kind -- a station of a kind with no count
        of its own (extraction/powerup/bomb) still needs to say "reported" vs "never heard from"
        (review 2026-09-11, Finding 1: the UI had nothing to render for those kinds and a silent station
        looked identical to a reporting one). `revives` for a respawn point, `hold_ms`/`owner` from
        `report.control` for a control point; a station never heard from reports what it can -- `None`,
        not a fabricated zero, so the recap can tell "zero revives" from "never heard"."""
        out = [rec for row in self.stations_view() if (rec := self._station_recap_row(row)) is not None]
        live_ids = {row["node_id"] for row in out}
        out.extend(row.copy() for nid, row in self._departed_match_stations.items() if nid not in live_ids)
        return out

    @staticmethod
    def _station_recap_row(row: StationView) -> RecapStationRow | None:
        """Freeze one current station view without requiring it to remain in the active ITEMS roster."""
        a = row.get("assigned")
        if not a:
            return None
        rep = row.get("report") or {}
        rec: RecapStationRow = {"node_id": row["node_id"], "kind": a["kind"], "id": a["id"], "team": a["team"],
                                "heard": bool(rep)}
        if a["kind"] == "respawn":
            rec["revives"] = None
        Session._merge_station_recap_report(rec, rep)
        return rec

    @staticmethod
    def _merge_station_recap_report(row: RecapStationRow, report: StationReport) -> None:
        """Advance a frozen tally only with complete, sanitized counters named by this heartbeat."""
        row["heard"] = row["heard"] or bool(report)
        revives = report.get("revives")
        if row["kind"] == "respawn" and isinstance(revives, int) and not isinstance(revives, bool) and revives >= 0:
            row["revives"] = revives
        control = report.get("control")
        if row["kind"] == "control" and isinstance(control, dict):
            hold_ms = control.get("hold_ms")
            if isinstance(hold_ms, dict) and all(isinstance(v, int) and not isinstance(v, bool) and v >= 0
                                                 for v in hold_ms.values()):
                row["hold_ms"] = dict(hold_ms)
            owner = control.get("owner")
            if isinstance(owner, int) and not isinstance(owner, bool) and owner in (0, 1, 2, 3, STATION_TEAM_ANY):
                row["owner"] = owner

    def _late_station_report(self, nid: str) -> None:
        """utility.md §5c/§5d.6: a station is self-authoritative and "reports ... to MC when it is next
        in Wi-Fi range" -- so a station out of coverage at the whistle must still be able to land its
        tally once it re-joins, while still in RECAP and before any roll (F206 addendum, 2026-09-17).

        `_finish` freezes `self._match_stations` at the whistle so a NEXT match's stations cannot leak
        into THIS match's debrief (F206). That freeze must not also block a report from the SAME
        station the row was frozen for -- only an ASSIGNMENT that moved on (node_id + kind + id) is the
        next match's setup, not a late report for this one. A changed assignment is refused; a match
        heartbeat updates the frozen row in place and re-derives the recap through the existing
        late-fact path (`_restore_recap`), same as a late scoring fact would."""
        if self.phase != "recap" or self._match_stations is None:
            return
        frozen = next((r for r in self._match_stations if r["node_id"] == nid), None)
        if frozen is None:
            return
        live = self.stations.get(nid) or {}
        a = live.get("assigned")
        departed = self._departed_match_stations.get(nid)
        same_live = bool(a and a.get("kind") == frozen["kind"] and a.get("id") == frozen["id"])
        same_departed = bool(departed and departed["kind"] == frozen["kind"] and departed["id"] == frozen["id"])
        if not (same_live or same_departed):
            return   # the assignment moved on -- this heartbeat belongs to the NEXT match's setup
        rep = self._station_view(nid)["report"]
        self._merge_station_recap_report(frozen, rep)
        self._restore_recap()

    # ---------- nodes ----------
    def _on_disconnect(self, nid: str):
        """A28.3: the socket is gone, so its PATH is gone with it -- `coverage()` must not keep counting
        a phone as on backhaul until it goes stale STALE_AFTER_MS later. `NodeRecord.view()` already
        nulls `reach` on a dead socket, but the snapshot is built from THESE dicts and never consults
        that view, so nulling it there alone would have been dead code (the F33/F40 shape)."""
        if self._orphans.pop(nid, None) is not None:
            self._changed()                  # a phone MC cannot hear makes no claim about a match
        nv = self.nodes.get(nid)
        if nv is not None:
            # `NetServer.push` queues an async send and can return before the socket disappears.  If
            # that queued send loses the race, the LOAD ledger must not keep claiming delivery; the
            # next heartbeat/reconnect will send the announcement again.
            pid = self.node_player.get(nid)
            if pid:
                self.game_sent.pop(pid, None)
                self._game_retry_t.pop(pid, None)
            gone = nv.pop("reach", None)
            if gone is not None:
                nv["last_reach"] = gone      # F155: the PATH it was last heard over outlives the socket
                self._changed()

    def _touch(self, nid: str, stale: bool | None = None):
        nv = self._node_view(nid)
        if stale is not None:
            nv["stale"] = stale
        self._changed()

    def _find_player_for_gun(self, gun_name: str | None, gun_tail: str | None,
                              roster: dict[str, Player] | None = None, *,
                              tail_claim: bool = True) -> Player | None:
        """`roster` defaults to the active roster (`self.players`); F-3 (2026-09-13) passes `self.standby`
        too, so a gun still worn by a PARKED player resolves the same way for whoever asks — the ARMORY
        claim card's own "ON STANDBY" check and the KIT/LOBBY unrostered-phone count now share one
        matcher instead of the count re-deriving it without the registry the card has.

        TWO PASSES, and a caller may ask for only the first. The REGISTRY pass compares the node's gun
        against the armory row (sticker base, BLE tail) or against the whole `gun_id` string. The second,
        `tail_claim`, is the device-first fallback for a `gun_id` that IS a bare tail with no registry row
        behind it — a TRAILING FRAGMENT of the name the node reported, which is a far looser thing to match
        on: any short id can be the tail of somebody else's gun name. It is right for a claim form, where a
        false match is visible and reversible; it is wrong wherever a match silently EXCLUDES a node from
        something (`_standby_node_ids`), so those callers pass `tail_claim=False`."""
        if not gun_name and not gun_tail:
            return None
        roster = self.players if roster is None else roster
        base = (gun_name or "").rsplit("-", 1)[0].lower()
        tail = (gun_tail or (gun_name or "").rsplit("-", 1)[-1]).lower()
        full = (gun_name or "").lower()
        for p in roster.values():
            gid = (p.get("gun_id") or "").lower()
            if not gid:
                continue                      # a gun-less roster entry never matches (an empty name would equal "")
            g = self.guns.get(p.get("gun_id") or "")
            _sticker = g["sticker"].lower() if g else ""
            if g and (((base and _sticker == base) and not _sticker.startswith("tactix")) or (tail and g["ble"].get("tail", "").lower() == tail)):
                return p
            if gid in {x for x in (base, full) if x}:
                return p
        if tail_claim:
            for p in roster.values():
                gid = (p.get("gun_id") or "").lower()
                if gid and tail and gid == tail:  # device-first claim: gun_id may be just the tail —
                    return p                      # SECOND pass: an exact registry match always wins first
        return None

    def unrostered_phone_count(self) -> int:
        """F-3 (2026-09-13, field 2026-09-12: "4 guns connected, only 2 in lobby"). A connected companion
        phone that has a gun set, is not claimed by anyone on the active roster, and is not the gun of a
        player currently on STANDBY (a deliberate stand-down, not a stray) — exactly what ARMORY's own
        NodeCard renders a claim form for. Feeds the KIT/LOBBY 'N CONNECTED PHONES NOT IN THE ROSTER'
        banner so that confusion is visible on the screens an operator is actually looking at, not only
        on ARMORY. A phone with no gun set yet ("WAITING FOR ITS GUN") is a different situation and does
        not count here."""
        n = 0
        for nv in self.nodes.values():
            if nv.get("node_type") == "utility":
                continue
            # T2 review S5: a phone that said hello with a gun and then LEFT kept this banner up with
            # nothing claimable on ARMORY behind it. `stale` is the flag the net layer already raises
            # (`_attach_net`'s `on_stale`, STALE_AFTER_MS = 8 s) and `_on_status` clears on the next
            # heartbeat, so it is the established freshness rule in this file and it reads within
            # seconds. NOT a `last_seen_ms` vs `OFFLINE_AFTER_MS` comparison: that constant is 600_000,
            # exactly the window `_prune_unbound_nodes` already drops these records at, so gating on it
            # would have changed nothing an operator could see.
            if nv.get("stale"):
                continue
            name, tail = nv.get("gun_name") or "", nv.get("gun_tail") or ""
            if not (name or tail):
                continue
            if self._find_player_for_gun(name or None, tail or None) is not None:
                continue
            if self._find_player_for_gun(name or None, tail or None, roster=self.standby) is not None:
                continue
            n += 1
        return n

    def _standby_node_ids(self) -> set[str]:
        """A40: the node ids whose reported gun belongs to a player parked on STANDBY.

        A parked player has no `node_id` -- that is precisely what `_unroster` takes away -- so the only
        route back to their phone is the gun it reports, through the same matcher the unrostered count
        and the ARMORY claim card use. Callers use this to leave a benched phone out of a fan-out that
        would otherwise reach every socket.

        THE REGISTRY PASS ONLY (`tail_claim=False`). Every use of this set EXCLUDES a node from something
        -- today, from the addressed `start` -- and an exclusion made on a TRAILING FRAGMENT of a gun name
        is an exclusion nobody can see. A benched player whose `gun_id` is a short device id equal to the
        tail of an ACTIVE player's gun name shadowed that player's node, and their phone then silently
        never received the start: no error, no red row, one player standing on the field with a gun that
        never spawned. `_check_gun_free` -- the rule that decides whether two players may hold one gun at
        all -- compares whole `gun_id` strings, so a fragment match here was also claiming a collision the
        roster does not consider a collision."""
        out: set[str] = set()
        if not self.standby:
            return out
        for nid, nv in self.nodes.items():
            name, tail = nv.get("gun_name") or "", nv.get("gun_tail") or ""
            if not (name or tail):
                continue
            if self._find_player_for_gun(name or None, tail or None, roster=self.standby,
                                         tail_claim=False) is not None:
                out.add(nid)
        return out

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

    def _app_incompatible(self, nid: str) -> bool:
        """F121 compat, the hot-join/welcome twin of `_refuse_incompatible_app`: true when the node's
        own hello carries an app `compatible()` cannot vouch for -- refused outright, or unparsable.

        `start()`'s gate only runs at the whistle; a node can connect or reconnect at any OTHER moment
        the lobby is already pushed (`_bind`'s hot join, `_hydrate`'s welcome), and each of those is a
        chance to hand a phone `frames` it will run without ever sending F121's `$TMP` off frame."""
        return compatible((self.nodes.get(nid) or {}).get("app_ver")) is not True

    def _alert_app_withheld(self, p: Player, nid: str, reasons: list[str] | None = None) -> None:
        """The operator feed line for `_app_incompatible`: names the node and its reported version, so
        an invulnerable player mid-match is a fact the operator can see, not a silent gap.

        Deduped by `_app_blocked_alerted` (nid -> last version told): the same hello reaches this via
        BOTH `_bind` call sites in one breath (`_hydrate`'s own `_bind`, then `_on_node`'s), and every
        later heartbeat-driven `_bind` on an unchanged build would otherwise say it again."""
        av = (self.nodes.get(nid) or {}).get("app_ver")
        shown = av if isinstance(av, str) and av else "unknown"
        reasons = reasons or [f"APP {shown} CANNOT RUN F121 SPAWN PROTECTION (NEEDS {app_tier()})"]
        key = tuple(reasons)
        if self._app_blocked_alerted.get(nid) == key:
            return
        self._app_blocked_alerted[nid] = key
        who = p.get("display") or p["player_id"]
        self._on_feed({"t_match_s": self._operator_t_match(self.now_ms()), "tag": "WITHHELD", "kind": "alert",
                       "text": f"{str(who).upper()}'S GAME WAS WITHHELD — " + " · ".join(reasons)})

    def _plan_gaps(self, p: Player) -> list[str]:
        """S16 review 2026-09-19: the weapons in `p`'s loadout that the match's PINNED hit plan cannot carry
        (`Compiler.plan_gaps`). Only a hot join into an ARMED or LIVE match compiles against a pin that
        predates the player: before the whistle, an add or a loadout change re-pushes the whole roster.

        Such a weapon keys a conditional `$SIR` row (a catalogue `sir_fn`: the Toxin Rifle, the Breacher, the
        Haze) that no gun in the match holds, and a `dot` weapon is missing from every gun's `dot` table. Every
        hit it lands would vanish with both ends reporting healthy, and the guns in play cannot take a new
        table (F121). So the hot join is withheld, and the operator is told why."""
        if not self.in_play() or self._pinned_hit_plan is None:
            return []
        fn = getattr(self.compiler, "plan_gaps", None)     # a test double need not carry the whole compiler
        return list(fn(self._pinned_hit_plan, p)) if fn is not None else []

    def _hot_join_withheld(self, p: Player, nid: str) -> bool:
        """The one gate a hot join passes before it gets frames: True (and one WITHHELD feed line) when the
        node's app cannot run F121, or when the player's weapons are not in the match's hit plan."""
        if not self.lobby_pushed:
            return False
        reasons = []
        if self._app_incompatible(nid):
            av = (self.nodes.get(nid) or {}).get("app_ver")
            shown = av if isinstance(av, str) and av else "unknown"
            reasons.append(f"APP {shown} CANNOT RUN F121 SPAWN PROTECTION (NEEDS {app_tier()})")
        reasons.extend(self._weapon_app_blockers(self.nodes.get(nid) or {}))
        if reasons:
            self._alert_app_withheld(p, nid, reasons)
            return True
        gaps = self._plan_gaps(p)
        if gaps:
            self._alert_plan_withheld(p, nid, gaps)
            return True
        return False

    def _alert_plan_withheld(self, p: Player, nid: str, gaps: list[str]) -> None:
        """The operator feed line for `_plan_gaps`, deduped per node like `_alert_app_withheld`."""
        key = tuple(gaps)
        if self._plan_blocked_alerted.get(nid) == key:
            return
        self._plan_blocked_alerted[nid] = key
        rows = getattr(getattr(self.compiler, "catalog", None), "_by_id", {}) or {}
        names = ", ".join(str((rows.get(w) or {}).get("name") or w).upper() for w in gaps)
        who = p.get("display") or p["player_id"]
        self._on_feed({"t_match_s": self._operator_t_match(self.now_ms()), "tag": "WITHHELD", "kind": "alert",
                       "text": f"{str(who).upper()}'S GAME WAS WITHHELD: {names} WAS NOT IN THIS MATCH AT THE "
                               f"START, SO NO GUN WOULD REGISTER ITS HITS. THEY JOIN THE NEXT MATCH"})

    def _bind(self, nid: str, p: Player):
        # Whoever loses this socket loses the record of what it was told along with it: the phone
        # speaks for somebody else now, so "their phone has the game" is no longer a fact about them.
        old = self.node_player.get(nid)
        if old and old != p["player_id"] and old in self.players:
            self.players[old]["node_id"] = None
            self.game_sent.pop(old, None)
        for q in self.players.values():
            if q.get("node_id") == nid and q["player_id"] != p["player_id"]:
                q["node_id"] = None
                self.game_sent.pop(q["player_id"], None)
        prev = p.get("node_id")
        if prev and prev != nid:
            if self.scorer:
                self.scorer.rebind_node(p["player_id"])      # A6.2 hot-swap shots baseline
            if self.node_player.get(prev) == p["player_id"]:
                self.node_player.pop(prev, None)             # the old node no longer speaks for this player
            if prev in self.nodes:
                self.nodes[prev].pop("player_id", None)
        self.node_player[nid] = p["player_id"]
        new_match_binding = self.in_play() and self._match_nodes.get(nid) != p["player_id"]
        if self.in_play():
            self._match_nodes[nid] = p["player_id"]
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
            # Polish review #2 (2026-09-18): this hot join is exactly the moment F121 named -- a node
            # that connects mid-lobby-push or mid-match on an app `compatible()` cannot vouch for. Send
            # it nothing playable and say so on the feed, rather than arm a gun that never turns spawn
            # protection off.
            if not self._hot_join_withheld(p, nid):
                self._push_config_to(p)
                if self.start_info:
                    self.net.push(nid, "start", self._start_body())
        if new_match_binding:
            # F329: a node that joins the match in play is written to the snapshot NOW, not after the 2 s
            # debounce. A crash inside that window resumed without the binding, and the node's stored
            # facts then scored for nobody.
            self._persist_dirty = True
            self.persist_now()

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
                self.game_sent.pop(p["player_id"], None)   # the phone is gone: what it was told is not a fact about them
        self.nodes.pop(nid, None)
        self.synced_at_lobby.pop(nid, None)
        self._app_blocked_alerted.pop(nid, None)   # F121: a re-bind after this can say WITHHELD again
        self._plan_blocked_alerted.pop(nid, None)
        # A42: and the end-delivery watch over it. This was the one watch-ending path that did not clear
        # the ledger (`_schedule`, `new_session` and `_arm_end_delivery`'s own match filter are the
        # others), so evicting a node during RECAP left an entry re-pushing `control{end}` at a socket MC
        # has just closed and naming that player as a straggler on LIVE and RECAP for the rest of the
        # session. Bounded by the ladder, but a delivery fact about a node that no longer exists is not a
        # fact at all.
        self._end_delivery.pop(nid, None)
        self._station_id_of.pop(nid, None)     # F364: an evicted node (a reinstall) frees its number; a CLEAR keeps it
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
                self._station_id_of.pop(nid, None)   # F364: a pruned row releases its reserved id
                self._app_blocked_alerted.pop(nid, None)   # F121: a re-hello after this can say WITHHELD again
                self._plan_blocked_alerted.pop(nid, None)

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

    def _release_stale_gun_claim(self, nid: str, gun_name: str | None, gun_tail: str | None) -> None:
        """2026-09-19 (field): a phone whose storage was cleared, or that swapped role, rejoins under a
        NEW node_id -- and the OLD node_id's record is left holding `gun_name`/`gun_tail` that are no
        longer true of anything (`_bind` already moves the PLAYER off it; nothing moved the gun fields).
        Left alone, ARMORY shows the same gun on two cards: the live node, and a stale ghost still
        reading LINKED/KITTED off last session's `preflight`.

        Only a STALE other record's claim is cleared -- a FRESH one is net.py's `_claim_gun`/A8 gun
        rule to arbitrate (it may legitimately refuse this very hello), and this must never race ahead
        of that refusal by unclaiming a gun a live, contested holder still has every right to."""
        if not (gun_name or gun_tail):
            return
        for other_nid, other in self.nodes.items():
            if other_nid == nid or not other.get("stale"):
                continue
            if (gun_name and other.get("gun_name") == gun_name) or (gun_tail and other.get("gun_tail") == gun_tail):
                other.pop("gun_name", None)
                other.pop("gun_tail", None)

    def _on_node(self, n: dict):
        nid = n["node_id"]
        # A25: a hello is a NEW socket. Any `pull_log` we sent the old one never landed, so the ask
        # stops being outstanding here -- before the `reconnect` trigger below decides to make a new one.
        self._log_asked.discard(nid)
        self._log_inflight.discard(nid)   # B7: the old socket's stream is dead too; no more chunks are coming on it
        nv = self._node_view(nid)
        nv.update({k: v for k, v in n.items() if k in ("node_type", "gun_name", "gun_tail", "fw", "reach", "reach_claimed")})
        # F155 (field 2026-09-12): `reach` is nulled the moment the socket dies, and the readiness reason
        # for a node MC can no longer hear DEPENDS on which path it was last heard over. Keeping the last
        # known path is what lets a tunnel outage say "NOT REACHED FOR 40 s" instead of accusing a phone
        # on the right Wi-Fi of being on the wrong one.
        if nv.get("reach"):
            nv["last_reach"] = nv["reach"]
        self._note_version(nid, n.get("app_ver"), n.get("platform"))   # A29
        nv["last_seen_ms"] = self.now_ms()
        self._release_stale_gun_claim(nid, nv.get("gun_name"), nv.get("gun_tail"))
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
                self.game_sent.pop(pid, None)      # a station is not a phone holding this player's game
            # A13.5: a station phone. No gun, never bound; if the operator already assigned it, this hello
            # (first contact, or a reconnect after a reboot) is what arms it -- with the CURRENT game number,
            # which is how a station that missed the muster push still resets for the new match.
            st = self.stations.setdefault(nid, {"node_id": nid, "assigned": None, "report": {}, "armed": None})
            st["last_seen_ms"] = nv["last_seen_ms"]
            st["app_ver"] = n.get("app_ver") or st.get("app_ver")
            st["platform"] = nv.get("platform") or st.get("platform")   # A29: stations report the same way
            if st.get("assigned"):
                self._arm_station(nid)
                self._push_station_update(nid)     # A56: a powerup station re-anchors its spawn countdown
            self._changed()
            return None
        # F184 (field 2026-09-22): RELEASE can only ask a utility phone to reload as a HUD; until this
        # plain hello arrives MC deliberately keeps the station row because the push alone cannot prove
        # the role changed. The hello is that proof. Remove the station now so ITEMS does not leave the
        # same physical phone behind as OUT OF WI-FI until CLEAR. Also handle a phone that used its own
        # BACK TO HUD control while still assigned: its id must leave every station/HUD allow-list.
        prior_nid = str(n.get("prior_utility_node_id") or nid)
        prior_station = self.stations.get(prior_nid)
        if prior_station and self.scorer and self.phase in ("armed", "live"):
            rec = self._station_recap_row(self._station_view(prior_nid))
            if rec is not None:
                self._departed_match_stations[prior_nid] = rec
        if prior_station:
            self.stations.pop(prior_nid, None)
            self._station_id_of.pop(prior_nid, None)   # F364: a station that became a HUD frees its number
            if prior_nid != nid:
                # NetServer consumed the old authenticated identity too. Do not leave its utility node
                # ghost on ARMORY or in per-node bookkeeping after ITEMS has accepted the role handoff.
                self.nodes.pop(prior_nid, None)
                self.synced_at_lobby.pop(prior_nid, None)
                self._app_blocked_alerted.pop(prior_nid, None)
                self._plan_blocked_alerted.pop(prior_nid, None)
                self._end_delivery.pop(prior_nid, None)
        station_allowlist_changed = bool(prior_station and (prior_station.get("assigned") or prior_station.get("armed")))
        if station_allowlist_changed:
            self.arm_stations()
        # The gun the node reports NOW wins over a hydrate-era player_id (a re-bind to another gun moves the node).
        p = self._find_player_for_gun(n.get("gun_name"), n.get("gun_tail")) if (n.get("gun_name") or n.get("gun_tail")) else None
        if p is None and n.get("player_id") in self.players:
            p = self.players[n["player_id"]]
        if p:
            self._bind(nid, p)
        if station_allowlist_changed:
            # Bind first: the welcome was hydrated before this callback and still held the old allow-list.
            # In lobby this corrected config must reach the returning HUD identity too, not only its old holder.
            self._repush_stations_to_players()
            self._validate()
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
            # A40: the returning holder of a PARKED gun. `stand_down` pops them out of `self.players` AND
            # clears `node_player`, so neither lookup above can see them and this used to answer a
            # reconnecting benched phone with no `node` at all -- the one case where saying nothing is
            # indistinguishable from "nobody here claims you". Same matcher F-3 already asks of
            # `self.standby` for the unrostered count. They are deliberately NOT bound (a parked player
            # has no `node_id`; that is what being parked IS) and get no config, no frames and no start:
            # the body is their own context plus the bench fact, and nothing that could arm a gun.
            parked = self._find_player_for_gun(gun.get("name"), gun.get("tail"), roster=self.standby)
            if parked is not None:
                return self._assign_body(parked)
        if not p:
            return None
        self._bind(hello["node_id"], p)
        node = self._assign_body(p)                          # A10: welcome carries catalog + policy too
        # ...and it carries `game_brief()` exactly as an `assign` does (`engine.js _welcome` stores
        # `node.game` from both), so this IS a delivery of the announced game and is recorded as one.
        # It is the commonest delivery there is: a night LOADs at build and the players walk up
        # afterwards, so for most phones the game arrives HERE and on no other route.
        if self.game_loaded and self.game_cfg:
            self.game_sent[p["player_id"]] = self.game_cfg
        # Polish review #2 (2026-09-18): the welcome twin of `_bind`'s hot join. A phone that hellos mid-
        # lobby-push or mid-match on an app `compatible()` cannot vouch for gets no frames and no start --
        # both are what F121 needs the node to run, and an old build never sends the `$TMP` off frame
        # that ends spawn protection.
        blocked = self._hot_join_withheld(p, hello["node_id"])
        if not blocked:
            self._app_blocked_alerted.pop(hello["node_id"], None)   # F121: an upgraded app can say WITHHELD again if it ever regresses
        if self.lobby_pushed and not blocked:
            if p["player_id"] not in self.bundles:          # A5.6 late joiner hydrated on first hello
                self.bundles[p["player_id"]] = self._compile_rolled(p)
                self._head_sent_t[p["player_id"]] = self.now_ms()
                self.acks.pop(p["player_id"], None)
            node["config"] = self._wire_config()
            node["frames"] = self.bundles[p["player_id"]]
        if self.start_info and not self.is_adopted() and not blocked:
            # A RESUMED match re-sends the same match and seq, which a phone in play takes as a no-op. An
            # ADOPTED one has a seq and config this MC made up, and must never reach a phone as a start.
            node["start"] = self._start_body()
            node["match_id"] = self.start_info["match_id"]
        if self.scorer:
            rows = self.scorer.rows()
            row = next((r for r in rows if r["player_id"] == p["player_id"]), None)
            if row:
                node["score"] = dict(row, board=self._score_board(self.scorer), rows=rows)   # same shape as the live push: the swapped phone's DOWN recap has the race
        if self.phase == "recap" and self.last_recap and self._played_this_match(p["player_id"]):
            # A24: a phone that comes back into coverage AFTER the whistle still learns how it ended —
            # the only route to a result for a node that was off the LAN when `_finish` pushed it.
            # A player added DURING the debrief was not in it, so there is no result to carry.
            node["result"] = self._result_body(self.last_recap, p)
        return node

    def _on_status(self, nid: str, body: dict, t_recv: int):
        nv = self._node_view(nid)
        was_alive = nv.get("alive")          # A36: read BEFORE the update -- a life starts on the edge
        nv.update({k: body.get(k) for k in ("arm_state", "synced", "preflight", "battery", "fw", "hp", "armor", "ammo", "alive", "t_minus_ms", "shots", "dropped", "pending", "config_id") if k in body})
        # F208: the pool-staleness claim is re-stated on EVERY heartbeat, so absent means "not stale" and
        # must clear the last one. Only a known reason is kept, and only a whole non-negative age.
        reason, stale_ms = body.get("pool_stale"), body.get("pool_stale_ms")
        nv.pop("pool_stale", None)
        nv.pop("pool_stale_ms", None)
        if reason in ("silent", "no_fire", "write_lost", "pool_wrong"):
            nv["pool_stale"] = reason
            if isinstance(stale_ms, int) and not isinstance(stale_ms, bool) and stale_ms >= 0:
                nv["pool_stale_ms"] = stale_ms
        # F264: the node's own outcome after probing a `pool_stale` gun, re-stated on EVERY heartbeat
        # the same way `pool_stale` is. Absent means "not acted" and must clear the last claim. Only a
        # known value is kept, so an older app (or junk) leaves the field cleared, not stale.
        cure = body.get("cure")
        nv.pop("cure", None)
        if cure in ("asking", "dead", "alive", "no_answer"):
            nv["cure"] = cure
        # F272: this is a positive verdict, never a truthy flag. Every heartbeat restates it, so
        # false, absence, junk and an older app all clear the previous claim.
        nv.pop("gun_locked", None)
        if body.get("gun_locked") is True:
            nv["gun_locked"] = True
        # F289: the phone still owes the write that ends spawn protection. True-only and restated on
        # every heartbeat like `gun_locked`, so a status without it is the newest evidence that it ended.
        nv.pop("protect_owed", None)
        if body.get("protected") is True:
            nv["protect_owed"] = True
        # F309: the phone's own connection, restated on every heartbeat; absence or junk clears it.
        nv.pop("transport", None)
        if body.get("transport") in ("wifi", "cellular", "none", "unknown"):
            nv["transport"] = body["transport"]
        # A28.3: `reach` is NOT taken from the status body. It feeds `coverage()` (which can gate a whole
        # mode) and the readiness amber (which un-blocks a start), so a client-asserted value would let a
        # phone claim its way past both. MC stamps it from the socket in `net._hello_gate`; the node's
        # own claim is kept beside it, unused, so a disagreement is visible instead of silent.
        if "reach" in body:
            nv["reach_claimed"] = body.get("reach")
        nv["last_seen_ms"] = t_recv
        nv["stale"] = False
        # LOAD is an announcement, and its delivery can race a phone that has just opened its socket.
        # The heartbeat arrives only after that socket is live; retry once per cadence until the
        # delivery ledger is stamped, so a transient miss does not leave a false red PHONE cell.
        pid = self.node_player.get(nid)
        if self.game_loaded and self.game_cfg and pid and self.game_sent.get(pid) != self.game_cfg:
            last = self._game_retry_t.get(pid, 0)
            if t_recv - last >= 5_000:
                self._game_retry_t[pid] = t_recv
                if (p := self.players.get(pid)) is not None:
                    self._send_assign(p)
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
                                                     "armed", "control", "battery", "uptime_s", "boot_count", "assoc",
                                                     "threshold_src", "tx_power", "tx_power_src")
                            if k in body}
            self._note_station_range(nid, st, body, t_recv)   # A67: last edit wins; new on-station edits announced
            self._note_station_boot(st, body, t_recv)   # A58: before last_seen moves, a restart is judged on this beat
            self._keep_station_tally(st, t_recv)
            st["last_seen_ms"] = t_recv
            if body.get("app_ver"):                # roadmap A3: the heartbeat, not just the hello, keeps this fresh
                st["app_ver"] = body["app_ver"]
            if body.get("platform"):
                st["platform"] = body["platform"]
            nv["node_type"] = "utility"
            # RELEASE freezes a fallback row before asking the phone to reload, but the old utility
            # socket may have one final, newer self-authoritative tally already in flight. Preserve the
            # released assignment metadata and advance only counters that this heartbeat actually names.
            if self.phase in ("armed", "live") and (departed := self._departed_match_stations.get(nid)):
                report = self._station_view(nid)["report"]
                self._merge_station_recap_report(departed, report)
            self._late_station_report(nid)   # F206 addendum: a station back in range during RECAP
            # F401: this heartbeat is what proves the node itself is back in Wi-Fi range, whichever match
            # it is now assigned to -- `_late_station_report`'s own guard (RECAP only, same assignment)
            # must not also gate LOAD's sync warning, which has to clear after a roll forward too.
            if nid in self._sync_pending and self._match_end_t is not None \
                    and self.nodes.get(nid, {}).get("last_seen_ms", 0) >= self._match_end_t:
                self._sync_pending.pop(nid, None)
                self._validate()
        # A8: the server's binding is authoritative — a status body's player_id never rebinds a node.
        if self.phase in ("kit", "lobby", "armed") and body.get("synced"):
            self.synced_at_lobby[nid] = True   # any node synced before it goes live keeps its own t (A5.7)
        self._log(nid, "status", body, t_recv)
        if self.scorer:
            self.scorer.ingest_status(nid, body, t_recv)
            self._push_scores()       # F265: misses change shots/accuracy only through this heartbeat
        if nv.get("node_type") != "utility" and body.get("arm_state") in ("armed", "live"):
            self._check_stale_live(nid, body.get("match_id"), t_recv)   # A34
        if nv.get("node_type") != "utility":
            self._note_orphan(nid, body, t_recv)       # bench 2026-09-17: a match this MC did not start
            self._hb_claim[nid] = (body.get("arm_state"), body.get("match_id"), t_recv)   # A47: `phones_ended`
        if nv.get("node_type") != "utility":
            self._note_end_confirm(nid, body)          # A42: this heartbeat IS the ack for the last end
        if nv.get("node_type") != "utility":
            self._check_pool(nid, body, t_recv, was_alive)              # A36
        self._changed()

    def _note_pool_life(self, nid: str, events: list[Event]) -> None:
        """A36/A37: a node's facts, read ONLY for what they say about its pool this life.

        A `respawn` starts a fresh life, so the settle window opens again. It comes from the node's
        OWN engine, the same authority as the heartbeat it qualifies. Deliberately runs BEFORE the
        parked/scorer gates that follow it: a fact parked because it names another match still tells
        us this node's gun re-spawned.

        A37 (polish-loop 2026-09-13) removed the other half of this. `hit_taken` used to retire the
        RED for the life it landed in, and that was a rule about a fact the engine only emits when
        it can ATTRIBUTE a hit (a `$HIR` latch < 1000 ms old, `spawned`, `dmg > 0`) while the POOL
        moves unconditionally on `$LCD`/`$HP` -- see `_check_pool`.

        R2-4 brings the flag back for the AMBER only, where its weakness does not matter: a missed
        `hit_taken` there costs an advisory that says "re-push before the next game", not a red that
        strands a gun running the right head. The red never reads it.

        F4 (iteration 3): the flag is CLEARED HERE, on the `respawn` that starts the life, and
        nowhere else. It used to be cleared by `_check_pool`'s life-start branch instead -- but this
        stream and the `status` stream are not ordered against each other, so a `hit_taken` that
        beat the first heartbeat of its life was written and then immediately erased, and a player
        who had been shot was judged as if they had not. One writer, on the fact that actually
        starts a life."""
        nv = self._node_view(nid)
        for ev in events:
            if ev.get("type") == "respawn":
                nv.pop("pool_life_t", None)
                nv["pool_life_hit"] = False
                nv.pop("pool_amber_pending", None)
            elif ev.get("type") == "hit_taken":
                nv["pool_life_hit"] = True

    # ---------- A36/A37: is the gun holding MORE pool than the head we pushed grants? ----------
    def _check_pool(self, nid: str, body: dict, t_recv: int, was_alive) -> None:
        """The check that caught the 2026-09-12 staleness retroactively, re-stated so that it can
        only ever make a claim the pool actually supports (A37, polish-loop 2026-09-13).

        A gun still holding a PREVIOUS head spawns into that head's pool and then says so on every
        ~2 s heartbeat for the whole match. Nothing read it. This does, once per life, against the
        `$PSET` in the bundle MC actually pushed (`frames.head_pool`) -- so per-player overrides and
        the `body_armor` perk are already baked in and there is no second arithmetic to drift.

        THE RULE, in three grades (R2-3/R2-4/R2-6, polish loop iteration 2):

          * RED, `_pool_faults`: reported hp ABOVE the compiled hp. Nothing can put more HEALTH on a
            gun than the head it is running wrote, so this is the one claim the pool can prove.
          * AMBER, `_pool_ambers`: reported armor above the compiled armor. A37 called this red too,
            and it is not proof: `compile._SIR_GRANT` (fn 9-22) and `engine.js armour_up` add armour
            mid-life, and the replayed field store (session-25eebce5) shows a body-armor node's first
            life going 70 -> 120 at +2.0 s as the baked perk arrives on `$LCD`. Whether the gun
            CLAMPS such a grant at the `$PSET` ceiling is unbenched -- see TODO-FOLLOWUP below.
          * AMBER: reported pool BELOW the compiled one, on the FIRST gun-sourced settled frame of
            the FIRST life of a match, with no `hit_taken` that life. EXCEEDS-only is blind in this
            direction, and it is a real field shape: match 1 grants 45/0, match 2 grants 100/70, and
            a gun still holding match 1's head reports 45 <= 100 in silence for the whole match. A
            later life, or any hit, has an ordinary explanation and makes NO claim.

        Both AMBERS need TWO CONSECUTIVE AGREEING frames past the settle window, the RED needs one
        (F5, iteration 3): the settle window is 2000 ms and the replayed store has a body-armor pool
        landing at +2.0 s, so a correct gun can be sampled mid-application exactly once. Nothing can
        ADD health, so a single frame of excess health is already the whole claim.

        And every grade is judged ONLY on a pool the GUN reported (`pool_src == "gun"`, R2-3).
        `engine.js` sets hp/armor from `config.health` at spawn and the gun's own pool arrives after,
        on `$LCD`/`$HP`; `$PSET` bakes the per-player `overrides.max_hp/max_armor` and the body_armor
        perk. A player overridden DOWN to 30 hp under a 45 hp config therefore reported 45 -- the
        MODEL's number -- until that first gun frame landed, and 45 > 30 is a false red every life. A
        model-sourced settled frame is NO CLAIM: the life stays unjudged and the check keeps waiting
        for a frame the gun actually authored. An app that says nothing about where its pool came
        from makes no claim either (the A36 rule for every optional field: silence is not evidence).

        TODO-FOLLOWUP: bench "does the gun clamp an fn 9-22 grant at the `$PSET` ceiling?" If it
        does, armour above the ceiling becomes provable again and can go back to red.

        The rule it replaces asked for EQUALITY and excused itself with the node's own `hit_taken`
        fact, and that pair could not be made honest:
          * the engine emits `hit_taken` only for a hit it could ATTRIBUTE (a `$HIR` latch < 1000 ms
            old, with `spawned`, `dmg > 0` -- engine.js), while the pool moves unconditionally on
            `$LCD`/`$HP`. A hit whose `$HIR` was lost or merged (protocol §2) dropped the pool with
            no fact behind it, and MC latched "THE GUN IS ON ANOTHER HEAD" onto a gun running the
            right head -- with `push_config` refused in armed/live, unclearable for the whole match;
          * and the flag was cleared by the life-start branch below, so a respawn followed by a hit
            that beat the next ~2 s heartbeat erased the excuse as well (C-1).
        An excess pool has no such second explanation: no perk, no damage and no missed fact can put
        MORE hp or armor on a gun than the head it is running wrote.

        Two deliberate silences remain, each a way this check could otherwise LIE:
          * inside `POOL_CHECK_SETTLE_MS` of the life starting -- `$SPAWN` and the head's `$PSET` are
            two BLE writes and a relay apart, and the heartbeat can be sampled between them;
          * when the head carries no readable `$PSET` (a stub compiler) or the body no integer pool.
        """
        nv = self._node_view(nid)
        if body.get("arm_state") != "live" or not body.get("alive"):
            if body.get("alive") is False:
                nv.pop("pool_life_t", None)          # dead: the next alive frame is a NEW life
            return
        if not was_alive or nv.get("pool_life_t") is None:
            nv["pool_life_t"] = t_recv
            nv["pool_life_judged"] = False
            # F4: `setdefault`, never `= False`. `_note_pool_life` writes this flag from the EVENT
            # stream, which is not ordered against `status` -- a `hit_taken` that arrived before the
            # first heartbeat of this life was erased right here, and a damaged player was then judged
            # as never shot. The `respawn` fact clears it; this branch only fills in a life that has
            # no flag at all (the first one of the match).
            nv.setdefault("pool_life_hit", False)
            nv.pop("pool_amber_pending", None)       # F5: a new life re-opens the two-frame agreement
            nv["pool_life_n"] = int(nv.get("pool_life_n") or 0) + 1
            return
        if nv.get("pool_life_judged"):
            return
        if t_recv - int(nv["pool_life_t"]) < POOL_CHECK_SETTLE_MS:
            return
        pid = self.node_player.get(nid)
        if not pid or pid not in self.players:
            return
        want = _frames.head_pool((self.bundles.get(pid) or {}).get("head"))
        hp, armor = body.get("hp"), body.get("armor")
        # Spelled out rather than looped: the comparison below is arithmetic, and a checker that
        # cannot see the narrowing is telling the truth about a body field that may be anything.
        if (want is None or not isinstance(hp, int) or isinstance(hp, bool)
                or not isinstance(armor, int) or isinstance(armor, bool)):
            return
        # R2-3: and ONLY a pool the gun itself authored. Not marking the life judged is the point --
        # the check has not run, so it stays open for the first gun-sourced frame of this same life.
        if body.get("pool_src") != "gun":
            return
        got = (hp, armor)
        tail = "RE-PUSH BEFORE THE NEXT GAME"    # R2-7: this can only be READ in play, where push is refused
        if hp > want[0]:
            nv["pool_life_judged"] = True
            # Worded as a SUSPICION, not a verdict: one ~2 s sample against one compiled frame. It is
            # red on the board because a gun on an older head is the field failure this whole
            # amendment is about, and the cure -- a re-push, which A37 also stopped this row from
            # blocking -- replaces the head and clears it.
            self._pool_ambers.pop(pid, None)
            self._pool_faults[pid] = (f"{_POOL_FAULT} (REPORTS {got[0]}/{got[1]}, THIS CONFIG GRANTS "
                                      f"{want[0]}/{want[1]}, HP/ARMOR, LIKELY AN OLDER HEAD): {tail}")
            who = (self.players[pid].get("display") or pid).upper()
            self._on_feed({"t_match_s": max(0, (t_recv - self.scorer.go_live_t) // 1000) if self.scorer else 0,
                           "tag": "CONFIG", "kind": "alert",
                           "text": f"{who}'S GUN POOL ≠ CONFIG (REPORTS {got[0]}/{got[1]}, THIS CONFIG "
                                   f"GRANTS {want[0]}/{want[1]}, HP/ARMOR, LIKELY AN OLDER HEAD): {tail}"})
            return
        # The health is within what this head grants, so nothing here supports the red any more.
        self._pool_faults.pop(pid, None)
        # F5 (iteration 3): BOTH ambers need TWO CONSECUTIVE AGREEING gun-sourced frames past the
        # settle window, with no hit recorded either time. `POOL_CHECK_SETTLE_MS` is 2000 ms and the
        # replayed field store (session-25eebce5) has a body-armor pool landing at +2.0 s exactly --
        # so the very first frame a correct gun is judged on can be sampled mid-application (70 of
        # 120 armour, or 45/0 of a 45/70 head) and an advisory fired on a gun that is about to be
        # right. A gun that says the same smaller pool twice in a row is not mid-application. The
        # hp-above RED keeps its single-frame rule above: nothing can ADD health, so one frame of
        # excess health is already the whole claim.
        amber: str | None = None
        if armor > want[1] and not nv.get("pool_life_hit"):
            amber = (f"{_POOL_ARMOR_ADVISORY} (REPORTS {got[0]}/{got[1]}, THIS CONFIG "
                     f"GRANTS {want[0]}/{want[1]}, HP/ARMOR): {tail}")
        elif (nv.get("pool_life_n") == 1 and not nv.get("pool_life_hit")
                and (hp < want[0] or armor < want[1])):
            amber = (f"{_POOL_BELOW_ADVISORY} (REPORTS {got[0]}/{got[1]}, THIS CONFIG "
                     f"GRANTS {want[0]}/{want[1]}, HP/ARMOR): {tail}")
        if amber is not None:
            if nv.get("pool_amber_pending") == list(got):
                nv["pool_life_judged"] = True
                nv.pop("pool_amber_pending", None)
                self._pool_ambers[pid] = amber
            else:
                # The first of the pair. The life stays UNJUDGED on purpose: the check has not made a
                # claim yet, and the frame that settles it is the next one of this same life.
                nv["pool_amber_pending"] = list(got)
            return
        nv.pop("pool_amber_pending", None)
        nv["pool_life_judged"] = True
        if got == want:
            # The only POSITIVE evidence this check ever gets: the gun reported exactly the pool the
            # head grants. A damaged later life proves nothing either way, so it clears nothing.
            self._pool_ambers.pop(pid, None)

    # ---------- A34: a phone that comes back still LIVE in a match MC has already retired ----------
    _ENDED_KEEP = 16

    def _record_ended(self, match_id: str | None, recap: RecapView | None, players: dict[str, Player] | None) -> None:
        """Remember a retired match so a late phone can still be told how (and that) it ended."""
        if not match_id:
            return
        self._ended.pop(match_id, None)
        self._ended[match_id] = {"recap": recap, "players": dict(players) if players else None, "ended_ms": self.now_ms()}
        for old in list(self._ended)[:-self._ENDED_KEEP]:
            self._ended.pop(old, None)

    def _check_stale_live(self, nid: str, mid: str | None, t_recv: int) -> None:
        """Field 2026-09-12: a phone dropped off the Wi-Fi at the whistle, came back a minute later still
        LIVE in the match everyone else had finished, and MC -- already on the next KIT -- had nothing that
        told it. The status heartbeat is the moment we KNOW it is reachable and wrong, so the answer goes
        out from here: `control{end, match_id}` (+ that match's `result` if we hold one, + the current
        `start` if a new match is already scheduled, so it hot-joins per E5). Never for a node reporting
        the CURRENT match while MC is armed/live -- that is a phone doing its job."""
        current = self.current_match_id()
        if mid:
            if mid == current:
                return
            if mid not in self._ended:
                # Round-1 polish review 2026-09-12: this used to be skipped whenever `current is None`,
                # which is exactly the state a RESTARTED MC is in -- `_ended` empty, phase `muster`, so
                # `current` is None and the first heartbeat off a phone playing a REAL match was answered
                # with `control{end}`: MC ended a live game because it had forgotten it. Only a match MC
                # KNOWS it retired may be reconciled; one it cannot account for (another session's, or
                # its own from before a restart) is left strictly alone.
                return
        elif current is not None:
            return              # no match_id and MC is running one: an old app, not a stale phone
        elif not self._ended:
            # Round-3 T1-A, the same hole the round-1 review closed for a NAMED match: with no
            # `match_id` on the heartbeat AND nothing running, `current` is None and this fell
            # through to `control{end}` -- so a RESTARTED MC (empty `_ended`, phase `muster`) would
            # end a real, running game reported by an older app, for exactly the reason it must not
            # end a named one: it cannot account for the match. MC may only reconcile a match it
            # KNOWS it retired, and with the ledger empty it has retired none.
            #
            # Unreachable from today's app -- `transport.js` always stamps `match_id` -- which is
            # precisely why both shapes are pinned in `test_mc_stale_live`: the only thing that can
            # reach this branch is an older build, on the field, mid-match.
            return
        last = self._stale_told.get((nid, mid))
        if last is not None and t_recv - last < STALE_LIVE_RETELL_MS:
            return
        self._stale_told[(nid, mid)] = t_recv
        self._reconcile_stale_live(nid, mid)

    def _reconcile_stale_live(self, nid: str, mid: str | None) -> None:
        body: dict = {"cmd": "end"}
        if mid:
            body["match_id"] = mid
        ok = self.net.push(nid, "control", body)
        if mid:
            # A42: A34's push and A42's retry are the SAME delivery. Recording it here is what stops the
            # two pushing in the same breath (this fires from the heartbeat, `_retry_end_delivery` from
            # the tick 2 Hz later) and what makes the operator's try counter the truth.
            self._end_delivery_tried(nid, mid, ok is not False)
        pid = self.node_player.get(nid)
        p = self.players.get(pid) if pid else None
        ended = self._ended.get(mid) if mid else None
        recap = ended.get("recap") if ended else None
        told_result = False
        if p and ended and recap and (ended.get("players") is None or p["player_id"] in ended["players"]):
            roster = ended.get("players") or self.players
            self.net.push(nid, "result", self._result_body(recap, p, match_id=mid, roster=roster))
            told_result = True
        # The `start` is the E5 hot join, and it is NOT sent in the same breath as a `result`: `startAt`
        # CLEARS `this.result` on a new match (`app/src/engine.js`), so the phone would end M1 and hot-join
        # M2 without ever showing M1's outcome -- which is the whole thing A34 exists to deliver. A node
        # told how its match ended hot-joins on the normal hello/welcome path instead, which carries
        # `start` anyway. Gated on `p` for a second reason: an UNBOUND node has no roster row and no
        # scorer entry, so handing it a start would spawn it into the match under a stale `player_num`
        # that `_next_num` may since have given to somebody else (round-1 polish review 2026-09-12).
        if (p and not told_result and self.start_info and not self.is_adopted() and self.in_play()
                and not self._hot_join_withheld(p, nid)):
            self.net.push(nid, "start", self._start_body())
        who = (p or {}).get("display") or nid
        self._on_feed({"t_match_s": 0, "tag": "RECONCILED", "kind": "alert",
                       "text": f"{who}'S PHONE CAME BACK STILL LIVE IN AN ENDED MATCH — TOLD TO END"})

    # ---------- Bench 2026-09-17: a restarted MC resumes the match in play ----------
    # MC was restarted during a LIVE match. The new process came up in MUSTER, both phones stayed LIVE in
    # the old match, and MC could neither recognise nor end it (A34's rule: never end a match MC cannot
    # account for). A crash, a laptop lid or a restart can all do this on the field, so the snapshot now
    # carries the running match and the new process picks it up (`resume_match`). With no snapshot the
    # phones' heartbeats are the only record, and the operator decides (`orphan_match_view`).
    def _build_scorer(self, match_id: str, go_live_t: int, node_player: dict[str, str],
                      joined_t: dict[str, int] | None = None, *, cap_recv: int | None = None,
                      derive_cap: bool = False, alerts: dict | None = None) -> Scorer:
        """A scorer for a match this process did not schedule, replayed from the stored facts.

        The replay runs with no callbacks (no cue re-fires at a player), and with the ARMED node map merged
        in, because the facts are keyed by node and no phone has said hello to this process yet. The
        live scorer then reads the Session's own map, as `_schedule`'s does."""
        scoring = self.config.get("scoring") or {}
        sc = Scorer(match_id, go_live_t, self.config.get("time_limit_s"), self.config["mode"], self.players,
                    self.teams, {**node_player, **self.node_player}, self.synced_at_lobby, now_ms=self.now_ms,
                    frag_limit=scoring.get("frag_limit"), win_by=scoring.get("win_by"))
        sc.joined_t = dict(joined_t or {})       # A63: the snapshot's hot joiners (not in any stored fact)
        facts = self._match_facts(match_id)
        # F356: the replay runs in `t` order, but "did this team kill arrive after the whistle" is an ARRIVAL
        # fact. The snapshot's `cap_recv` wins (keep the first); else, when the snapshot predates the whistle
        # (its post-whistle write was lost), find it the way the live scorer did, in arrival order.
        sc.cap_recv = cap_recv
        if sc.cap_recv is None and derive_cap:
            sc.cap_recv = self._arrival_cap_recv(sc, self._match_facts(match_id, arrival=True))
        for r in facts:
            body: Event = r["body"]
            sc.ingest(r["node_id"], body.copy(), r.get("t_recv") or 0, seq=r.get("seq"))
        if derive_cap and sc.cap_recv is None and sc.limit_reached_t is not None:
            # F363: the live scorer takes facts in ARRIVAL order, and it never reached the cap (no
            # `cap_recv` in the snapshot, none from `_arrival_cap_recv`). The `t`-order replay above can pass
            # the cap for a moment (a clock jump, then a team kill takes it back). That is not a whistle the
            # field heard, so forget it: the resume must not end the match on it, and a real cap reached
            # later must still end the match.
            sc.limit_reached_t = None
            sc._announced.discard("frag_limit")
        # F362 (k): the replay skips the match-state alerts of every stale fact, so take what the field was
        # already told from the snapshot. An older snapshot without it: take it from the board.
        if isinstance(alerts, dict):
            sc.restore_match_state_alerts(alerts)
        else:
            sc.prime_match_state_alerts()
        sc.node_player = self.node_player
        sc.on_feed = self._on_feed
        sc.on_alert = self._alert
        sc.on_feedback = lambda pid, body: self._feedback(pid, body)
        sc.on_limit = lambda t, _sc=sc: self._on_frag_limit(t, _sc)
        return sc

    def _import_facts(self, match_id: str, store_path: object) -> None:
        """Copy one match's envelopes from the OLD process's store file into this one.

        Each process writes its own `session-<id>.sqlite`, so the facts the phones sent before the restart
        are in another file. After the copy, every later replay (`_reconcile_end`, the archive row) reads
        one store, as it does for a match that never saw a restart."""
        if not self.store or not isinstance(store_path, str) or not store_path:
            return
        old_path = Path(store_path)
        if old_path == Path(getattr(self.store, "path", "")) or not old_path.exists():
            return
        try:
            from .store import Store
            old = Store("resume", old_path, read_only=True)   # F-2026-09-17e: never write to it
            try:
                rows = old.events(match_id=match_id)
            finally:
                old.close()
            for r in rows:
                self.store.log(r["node_id"], r["kind"], r["seq"], r["t"], r["t_recv"], r["match_id"],
                               r["parked"], r["body"])
        except Exception:
            import logging
            logging.getLogger("brx.mc").exception("could not read the facts from %s (resume scores from here)",
                                                  store_path)
            # Polish review: the log line above is easy to miss. `resume_match` still says "RESUMED THE
            # MATCH IN PLAY" right after this, which reads as an ordinary resume -- the operator needs a
            # LOUD, separate line saying the old facts are gone and scores are starting from zero.
            self._on_feed({"t_match_s": 0, "tag": "NOTE", "kind": "alert",
                           "text": "MC RESTARTED. COULD NOT READ THE OLD SESSION'S FACTS: SCORES START FROM ZERO"})

    def resume_match(self) -> str | None:
        """Pick up the match the snapshot says was in play. Call once the store is attached.

        Returns the phase it resumed into, or None when there was nothing to resume. Rules:
          * the clock is still before the end: restore ARMED or LIVE, the scorer rebuilt from the stored
            facts, so heartbeats for this match are the current match and the whistle and recap work;
          * the end has passed (the time limit, or a frag cap the stored facts reach): finish it, so the
            recap is built, the archive row written, and A34/A42 end any phone still live in it.
        Nothing is pushed here. A re-hello carries the SAME `start` (same match and seq, a no-op on a phone
        in play) and never a config or frames (`lobby_pushed` stays false)."""
        m, self._resume_pending = self._resume_pending, None
        if not isinstance(m, dict):
            return None
        mid, go, seq = m.get("match_id"), m.get("go_live_t"), m.get("seq")
        cfg = m.get("config")
        if not (isinstance(mid, str) and mid and isinstance(go, int) and isinstance(seq, int)
                and isinstance(cfg, dict) and cfg.get("mode")):
            import logging
            logging.getLogger("brx.mc").warning("session snapshot names a match MC cannot read -- not resumed")
            return None
        if self.phase not in ("muster", "build", "kit", "lobby") or self.start_info:
            return None
        self.config = cast(GameConfig, cfg)
        self.config["health"] = _compile.normalize_health(self.config.get("health"))   # S45: same legacy fill as restore_snapshot()
        raw_players = m.get("players")
        players: dict = raw_players if isinstance(raw_players, dict) else {}
        node_player = {n: p for n, p in (m.get("node_player") or {}).items()
                       if isinstance(n, str) and isinstance(p, str) and p in self.players}
        self._match_nodes = dict(node_player)     # carried into this process's own snapshots
        for nid, synced in (m.get("synced_at_lobby") or {}).items():
            if isinstance(nid, str) and synced is True:
                self.synced_at_lobby[nid] = True
        if isinstance(m.get("bundles"), dict):
            self.bundles = m["bundles"]
        if isinstance(m.get("acks"), dict):
            self.acks = m["acks"]
        self._departed_match_stations = {}
        invalid_departed = 0
        raw_departed = m.get("departed_stations")
        if isinstance(raw_departed, list):
            for raw in raw_departed:
                row = self._snapshot_departed_station(raw)
                if row is None or row["node_id"] in self._departed_match_stations:
                    invalid_departed += 1
                    continue
                self._departed_match_stations[row["node_id"]] = row
        elif raw_departed is not None:
            invalid_departed = 1
        if invalid_departed:
            import logging
            logging.getLogger("brx.mc").warning(
                "session snapshot has %d invalid or duplicate departed station row(s) -- ignored",
                invalid_departed)
        self._import_facts(mid, m.get("store_path"))
        self.start_seq = max(self.start_seq, seq)
        cd = m.get("countdown_s")
        self.start_info = {"match_id": mid, "go_live_t": go, "seq": seq,
                           "countdown_s": cd if isinstance(cd, int) else 0}
        if m.get("adopted"):
            self.start_info["adopted"] = True
        self._scheduled_ids.add(mid)
        self._game_no_started = True
        self._match_players = {pid: cast(Player, dict(p)) for pid, p in players.items() if isinstance(p, dict)} or \
            {pid: p.copy() for pid, p in self.players.items()}
        self._end_delivery, self._end_delivery_told = {}, None
        joined = {p: t for p, t in (m.get("joined_t") or {}).items()
                  if isinstance(p, str) and isinstance(t, int) and not isinstance(t, bool)}
        cap_recv = m.get("cap_recv")
        cap_recv = cap_recv if isinstance(cap_recv, int) and not isinstance(cap_recv, bool) else None
        self.scorer = self._build_scorer(mid, go, node_player, joined, cap_recv=cap_recv,
                                         derive_cap=not m.get("adopted"),
                                         alerts=m.get("alerts") if isinstance(m.get("alerts"), dict) else None)
        if self.store:
            try:
                snap = dict(self.config)
                snap["_heads"] = {pid: (b or {}).get("head", []) for pid, b in self.bundles.items()}
                self.store.match_started(mid, snap, go)
            except Exception:
                pass
        now = self.now_ms()
        tl = self.config.get("time_limit_s")
        if self._promote_phase(go, now) == "armed":
            # F-2026-09-17e: `_schedule()` queues the VIP role announcement for go-live; a resume that
            # lands back in ARMED (the restart beat the countdown) skipped this, so a resumed match's
            # VIP never heard it.
            self._queue_roles_for_live()
        # A47 review: a phone that still heartbeats this match is proof it is in play (read before the
        # orphan list forgets it). `tick()` can run this after phones have said hello.
        still_played = bool(self._fresh_orphans(mid))
        adopted = bool(m.get("adopted"))
        self._orphans = {n: o for n, o in self._orphans.items() if o["match_id"] != mid}
        # F-2026-09-17d: no age cap used to mean a snapshot from hours or days ago (a crash, a laptop
        # lid) resumed straight into ARMED/LIVE -- an UNTIMED config has no clock of its own to catch
        # this. Bound: twice the time limit, or one hour for an untimed match.
        saved_ms = m.get("_saved_ms")
        bound_ms = (2 * tl * 1000) if tl else 3_600_000
        too_old = isinstance(saved_ms, int) and (now - saved_ms) > bound_ms
        past_clock = bool(tl and now >= go + tl * 1000 + 5000)
        if adopted and (self.scorer.limit_reached_t is not None or too_old or past_clock):
            # A47 review: an ADOPTED match was never scored on a config MC holds (`adopt_orphan`), so its
            # limits and its age are the operator's draft, not the phones' rules. Finishing it here armed
            # the end delivery at phones still playing it. The phones end themselves, or the operator does.
            self._on_feed({"t_match_s": max(0, (now - go) // 1000), "tag": "NOTE", "kind": "alert",
                           "text": "MC RESTARTED. RESUMED A MATCH THIS MC DID NOT START. MC DOES NOT END IT "
                                   "ON A LIMIT IT CANNOT CONFIRM: PRESS END IF THE PHONES HAVE STOPPED"})
        elif too_old and not tl and not past_clock and still_played and self.scorer.limit_reached_t is None:
            # A47 review: the one-hour bound for an UNTIMED match is a guess about a crash long ago. A phone
            # that heartbeats this match right now says the guess is wrong, so do not end it under them.
            self._on_feed({"t_match_s": max(0, (now - go) // 1000), "tag": "NOTE", "kind": "alert",
                           "text": "MC RESTARTED. THE SAVED MATCH IS OVER AN HOUR OLD BUT A PHONE STILL PLAYS IT: "
                                   "RESUMED. PRESS END WHEN IT IS OVER"})
        elif self.scorer.limit_reached_t is not None:
            self.scorer.set_end(self.scorer.limit_reached_t)
            self.end_reason = "frag_limit"
            self._finish()
            self._on_feed({"t_match_s": 0, "tag": "RESUMED", "kind": "alert",
                           "text": "MC RESTARTED. THE MATCH REACHED ITS FRAG LIMIT WHILE MC WAS DOWN: RECAP BUILT"})
        elif too_old or past_clock:
            self.end_reason = "time"
            self._finish()
            self._on_feed({"t_match_s": 0, "tag": "RESUMED", "kind": "alert",
                           "text": "MC RESTARTED. THE MATCH ENDED WHILE MC WAS DOWN: RECAP BUILT"})
        else:
            self._on_feed({"t_match_s": max(0, (now - go) // 1000), "tag": "RESUMED", "kind": "alert",
                           "text": "MC RESTARTED. RESUMED THE MATCH IN PLAY"})
        self._changed()
        self.persist_now()
        return self.phase

    def _note_orphan(self, nid: str, body: dict, t_recv: int) -> None:
        """Track a phone that reports ARMED/LIVE in a match this MC did not start and never retired.

        F261, bench 2026-09-18: a FRESH MC (restarted with no roster, the field case of MC coming up on a
        different laptop) has no `node_player` binding for anyone, so requiring one here dropped the orphan
        on every heartbeat -- exactly the scenario the feature exists for. The node need not be bound;
        `adopt_orphan` creates the binding when the operator resumes. Every heartbeat restates the claim,
        so anything else clears it."""
        arm, mid = body.get("arm_state"), body.get("match_id")
        if (arm in ("armed", "live") and isinstance(mid, str) and mid
                and mid not in self._scheduled_ids and mid not in self._ended
                and mid != (self.start_info or {}).get("match_id")):
            t_minus = body.get("t_minus_ms")
            gb = body.get("game_byte")
            # X2: the advert byte the phone plays this match under. An older phone omits it (None).
            self._orphans[nid] = {"match_id": mid, "arm_state": arm, "t": t_recv,
                                  "t_minus_ms": t_minus if isinstance(t_minus, int) and t_minus >= 0 else None,
                                  "game_byte": gb if isinstance(gb, int) and not isinstance(gb, bool)
                                  and 1 <= gb <= 255 else None}
        else:
            self._orphans.pop(nid, None)

    def _fresh_orphans(self, match_id: str | None = None) -> dict[str, dict]:
        # F261: no `nid in self.node_player` gate here either -- an unbound node's orphan claim is the one
        # a fresh MC most needs to see. `orphan_match_view` already falls back to the node id when it has
        # no player display name.
        now = self.now_ms()
        return {nid: o for nid, o in self._orphans.items()
                if now - o["t"] <= STALE_AFTER_MS
                and not (self.nodes.get(nid) or {}).get("stale")
                and (match_id is None or o["match_id"] == match_id)}

    def orphan_match_view(self) -> OrphanMatchView | None:
        """`State.orphan_match`: the unknown match most bound phones report. Absent when there is none."""
        fresh = self._fresh_orphans()
        if not fresh:
            return None
        by_match: dict[str, list[str]] = {}
        for nid, o in fresh.items():
            by_match.setdefault(o["match_id"], []).append(nid)
        mid = max(by_match, key=lambda k: (len(by_match[k]), max(fresh[n]["t"] for n in by_match[k])))
        nids = by_match[mid]
        names = sorted((self.players.get(self.node_player.get(n, "")) or {}).get("display") or n for n in nids)
        return {"match_id": mid, "phones": len(nids), "players": names,
                "arm_state": "live" if any(fresh[n]["arm_state"] == "live" for n in nids) else "armed",
                "can_resume": self.phase in ("muster", "build", "kit", "lobby") and not self.start_info}

    def adopt_orphan(self, match_id: str) -> dict:
        """RESUME MATCH (operator only): run the match the phones report as this MC's match, scoring from here.

        MC holds no config for it, so the current draft config scores it; the go-live time is the phones'
        countdown when they are ARMED, else the earliest stored fact for it, else now. MC therefore never
        ends it EARLIER than the phones do. Nothing is pushed: no config, no frames and no `start`."""
        nids = self._fresh_orphans(match_id)
        if not nids:
            raise ConflictError("no phone reports that match any more")
        if self.phase not in ("muster", "build", "kit", "lobby") or self.start_info:
            raise ConflictError(f"MC is in {self.phase.upper()}: end or leave that first, then resume their match")
        now = self.now_ms()
        armed = [o["t"] + o["t_minus_ms"] for o in nids.values() if o["arm_state"] == "armed" and o["t_minus_ms"] is not None]
        facts = self._match_facts(match_id)
        if armed and not any(o["arm_state"] == "live" for o in nids.values()):
            go = min(armed)
        elif facts:
            go = min(now, min((r.get("t_recv") or now) for r in facts))
        else:
            go = now
        self.lobby_pushed = False
        self.acks = {}
        self.bundles = {}
        self._pool_faults, self._pool_ambers = {}, {}
        self.start_seq += 1
        self.start_info = {"match_id": match_id, "go_live_t": go, "seq": self.start_seq, "countdown_s": 0,
                           "adopted": True}
        self._scheduled_ids.add(match_id)
        # X2: take the game byte the phones play under, so a station re-arm during this match keeps it.
        # A fresh MC has game_no 1, and a re-arm on byte 1 cleared every station's tally and schedule. The
        # step keeps game_no monotonic. No phone reports a byte (older phones): keep today's number.
        bytes_seen = [o["game_byte"] for o in nids.values() if o.get("game_byte")]
        if bytes_seen:
            gb = max(set(bytes_seen), key=lambda b: (bytes_seen.count(b), b))
            self.game_no += (gb - self._game_byte()) % 255
        self._game_no_started = True
        self._range_epoch += 1                 # A67: an adopted match is a START too
        self._match_players = {pid: p.copy() for pid, p in self.players.items()}
        self._match_nodes = dict(self.node_player)      # F327: never the previous match's bindings
        self._end_delivery, self._end_delivery_told = {}, None
        self.end_reason = None
        self.last_recap = None
        self._result_pushed = {}
        self.feed = []
        self.scorer = self._build_scorer(match_id, go, {})
        if self.store:
            try:
                self.store.match_started(match_id, {**self.config, "_adopted": True}, go)
            except Exception:
                pass
        self._promote_phase(go, now)
        self._orphans = {n: o for n, o in self._orphans.items() if o["match_id"] != match_id}
        self._on_feed({"t_match_s": max(0, (now - go) // 1000), "tag": "RESUMED", "kind": "alert",
                       "text": f"RESUMED A MATCH THIS MC DID NOT START ({len(nids)} PHONE"
                               f"{'S' if len(nids) != 1 else ''}). SCORING FROM HERE"})
        # F-2026-09-17c: mirrors `resume_match`'s check for a cap the REPLAYED facts already reach — but
        # MC holds no config for an orphan, so `frag_limit`/`time_limit_s` here are the operator's CURRENT
        # DRAFT, not the number the phones are actually playing to. Record it for the board only; an
        # adopted match is never ended by MC on it (see `tick()` and `_on_frag_limit`) — the phones end
        # themselves, or the operator presses END.
        if self.scorer.limit_reached_t is not None:
            self._on_feed({"t_match_s": max(0, (self.scorer.limit_reached_t - go) // 1000), "tag": "NOTE",
                           "kind": "alert",
                           "text": f"THE REPLAYED FACTS ALREADY REACH THE DRAFT'S FRAG LIMIT "
                                   f"({self.scorer.frag_limit}) — MC DOES NOT END AN ADOPTED MATCH ON A "
                                   f"CAP IT CANNOT CONFIRM IS THEIRS. PRESS END IF THE PHONES HAVE STOPPED"})
        self._changed()
        self.persist_now()
        return {"ok": True, "match_id": match_id, "phase": self.phase, "phones": len(nids)}

    OPERATOR_CMDS = ("resync", "respawn", "relink")
    OPERATOR_WORD = {"resync": "RESYNC", "respawn": "RESPAWN", "relink": "RELINK"}
    # The phone refuses `resync`/`respawn` unless LIVE (`engine.js _operator`); `relink` also runs in ARMED.
    OPERATOR_LIVE_ONLY = ("resync", "respawn")
    OPERATOR_REPEAT_MS = 2000   # the same action for the same player inside this window is a double tap
    # pl4: a "sent" with no `operator_result` this long after the send reads "no_answer" (an older app that
    # ignores the command, a dropped socket). A late answer still replaces it.
    OPERATOR_NO_ANSWER_MS = 15_000

    def operator_action(self, player_id: str, cmd: str, match_id: str) -> OperatorActionResult:
        """A47 (bench 2026-09-17): the LIVE board's operator menu for ONE player in a bad state.

        `control{cmd, player_id, match_id}` to that player's bound phone, and nowhere else:
        - `resync`: the phone re-sends the live `$SIR` take, `$TID`, `$BMAP,0,0` and its current `$AMMO`.
        - `respawn`: the phone runs a normal revive (full pools, A44 spawn protection), no death, no kill.
        - `relink`: the phone drops and reconnects its gun, as the HUD's RELINK GUN.

        Refused (409) outside ARMED/LIVE (and outside LIVE for resync/respawn, which the phone refuses
        until T-0), for a match that is not the current one (a stale board), for a phone that is not
        bound or has not heartbeated within STALE_AFTER_MS, for FORCE RESPAWN of a down player in a mode
        with no respawn (it would change who survives), and for the same action on the same player
        inside OPERATOR_REPEAT_MS (a double tap). None of these is a config or head push, so none can
        clear `spawned` on a gun in play. `pushed` means a socket took it; the phone's `operator_result`
        fact is the receipt (`_on_operator_result`)."""
        if cmd not in self.OPERATOR_CMDS:
            raise ValueError(f"unknown operator action {cmd!r}")
        current = self.current_match_id()
        if not current:
            raise ConflictError(f"no match is ARMED or LIVE (phase {self.phase.upper()})")
        if not match_id or match_id != current:
            raise ConflictError("that match is over: the board was stale. Look at the player again")
        word = self.OPERATOR_WORD[cmd]
        if cmd in self.OPERATOR_LIVE_ONLY and self.phase != "live":
            raise ConflictError(f"{word} NEEDS A LIVE MATCH: the phone refuses it before T-0")
        p = self.players.get(player_id)
        if p is None:
            raise ValueError("unknown player")
        who = (p.get("display") or player_id).upper()
        if cmd == "respawn" and (self.config.get("respawn") or {}).get("type") == "none":
            st = self.scorer.stats.get(player_id) if self.scorer else None
            if st is not None and not st.alive:
                raise ConflictError(f"{who} IS OUT: THIS MODE HAS NO RESPAWN, SO FORCE RESPAWN WOULD CHANGE WHO SURVIVES")
        nid = p.get("node_id")
        seen = (self.nodes.get(nid) or {}).get("last_seen_ms") if nid else None
        now = self.now_ms()
        if not nid or seen is None or now - seen > STALE_AFTER_MS:
            raise ConflictError(f"{who}'S PHONE IS OUT OF REACH: nothing was sent")
        last = self._operator_sent_t.get((player_id, cmd))
        if last is not None and now - last < self.OPERATOR_REPEAT_MS:
            raise ConflictError(f"{word} WAS JUST SENT TO {who}: wait for the phone")
        pushed = self.net.push(nid, "control", {"cmd": cmd, "player_id": player_id,
                                                "match_id": match_id}) is not False
        if not pushed:
            raise ConflictError(f"{who}'S PHONE HAS NO CONNECTION: nothing was sent")
        self._operator_sent_t[(player_id, cmd)] = now
        self._operator[player_id] = {"match_id": match_id, "cmd": cmd, "state": "sent", "why": None,
                                     "sent_t": now, "result_t": None}
        self._on_feed({"t_match_s": self._operator_t_match(now), "tag": "OPERATOR", "kind": "alert",
                       "text": f"SENT {word} TO {who}"})
        self._changed()
        return {"ok": True, "cmd": cast(OperatorCmd, cmd), "player_id": player_id, "match_id": match_id, "pushed": pushed}

    def _operator_t_match(self, now: int) -> int:
        go = self.scorer.go_live_t if self.scorer else None
        return max(0, (now - go) // 1000) if go and self.phase == "live" else 0

    def _on_operator_result(self, nid: str, ev: Event, t_recv: int) -> None:
        """A47: the phone's `operator_result{cmd, ok, why?}` fact. It writes the feed line from the RESULT
        (the send only says SENT) and updates the player's LIVE row. It never reaches the scorer.

        Ignored for another match, for a node bound to nobody, and for a replay of a fact already told."""
        current = (self.start_info or {}).get("match_id")
        cmd = ev.get("cmd")
        if cmd not in self.OPERATOR_CMDS or not current or ev.get("match_id") != current:
            return
        pid = self.node_player.get(nid) or ev.get("player_id")
        if not pid or (ev.get("player_id") and ev.get("player_id") != pid):
            return
        p = self.players.get(pid)
        if p is None:
            return
        seq = ev.get("seq")
        key = (nid, seq if seq is not None else (cmd, ev.get("t")))
        if key in self._operator_seen:
            return
        self._operator_seen.add(key)
        ok = ev.get("ok") is True
        raw_why = ev.get("why")
        why = str(raw_why).strip().upper()[:80] if raw_why else None
        who = (p.get("display") or pid).upper()
        word = self.OPERATOR_WORD[cmd]
        if ok:
            # pl4: a relink's `ok` means the phone STARTED it; whether the gun came back is its own heartbeat
            text = (f"RESPAWNED {who} (OPERATOR)" if cmd == "respawn"
                    else f"RELINK STARTED: {who}" if cmd == "relink" else f"{word} DONE: {who}")
        else:
            text = f"{word} REFUSED BY {who}: {why or 'NO REASON GIVEN'}"
        prev = self._operator.get(pid) or {}
        # pl4: the row is the LAST action sent. A result for an earlier, different action (RESYNC answered after
        # FORCE RESPAWN was sent) is only a feed line: it must not turn the newer "sent" into a stale "done".
        if prev.get("cmd") == cmd and prev.get("match_id") == current:
            self._operator[pid] = {"match_id": current, "cmd": cmd, "state": "done" if ok else "refused",
                                   "why": None if ok else (why or "NO REASON GIVEN"),
                                   "sent_t": prev.get("sent_t") or t_recv, "result_t": t_recv}
        self._on_feed({"t_match_s": self._operator_t_match(t_recv), "tag": "OPERATOR",
                       "kind": "alert", "text": text})
        self._changed()

    def _operator_no_answer(self, now: int) -> None:
        """pl4: a "sent" the phone never answered reads "no_answer" after OPERATOR_NO_ANSWER_MS. Called from `tick`."""
        changed = False
        for o in self._operator.values():
            if o["state"] == "sent" and o.get("sent_t") is not None and now - o["sent_t"] >= self.OPERATOR_NO_ANSWER_MS:
                o["state"] = "no_answer"
                changed = True
        if changed:
            self._changed()

    def _with_operator(self, rows: list[LiveRow], match_id: str) -> list[LiveRow]:
        """A47: stamp each LIVE row with the last operator action for that player in THIS match."""
        for row in rows:
            o = self._operator.get(row["player_id"])
            if o and o["match_id"] == match_id:
                row["operator"] = {"cmd": o["cmd"], "state": o["state"], "why": o["why"],
                                   "sent_t": o["sent_t"] or 0, "result_t": o["result_t"]}
        return rows

    def _phones_ended(self, match_id: str) -> bool:
        """A47 review: every bound player phone that has made a claim says `match_id` is over for it
        (`kitted` for this match, or another match), and at least one does. `idle`/`connected` and a
        missing `arm_state` are NO claim (A42's rule), so they neither count nor block.

        pl4: nothing is claimed until EVERY bound player phone has heartbeated since this MC started (a
        phone not heard yet may still be playing), and a heartbeat older than STALE_AFTER_MS neither counts
        nor blocks: an old "another match" from before a restart is not news about this one."""
        ended = 0
        now = self.now_ms()
        for p in self.players.values():
            nid = p.get("node_id")
            if not nid or (self.nodes.get(nid) or {}).get("node_type") == "utility":
                continue
            if nid not in self._hb_claim:
                return False
            arm, mid, t = self._hb_claim[nid]
            if now - t > STALE_AFTER_MS:
                continue
            if isinstance(mid, str) and mid and mid != match_id:
                ended += 1
            elif mid == match_id and arm in END_CONFIRM_PHASES:
                ended += 1
            elif arm in ("armed", "live"):
                return False
        return ended > 0

    def end_orphan(self, match_id: str) -> dict:
        """END THEIR MATCH (operator only): `control{end, match_id}` to the phones reporting that match.

        The match joins the A34 ledger, so a phone that misses this push is told again on its next
        heartbeat (rate-limited), exactly like a match MC retired itself."""
        nids = self._fresh_orphans(match_id)
        if not nids:
            raise ConflictError("no phone reports that match any more")
        now = self.now_ms()
        pushed = 0
        for nid in nids:
            if self.net.push(nid, "control", {"cmd": "end", "match_id": match_id}) is not False:
                pushed += 1
            self._stale_told[(nid, match_id)] = now
        self._record_ended(match_id, None, None)
        self._orphans = {n: o for n, o in self._orphans.items() if o["match_id"] != match_id}
        self._on_feed({"t_match_s": 0, "tag": "RECONCILED", "kind": "alert",
                       "text": f"TOLD {len(nids)} PHONE{'S' if len(nids) != 1 else ''} TO END A MATCH THIS MC DID NOT START"})
        self._changed()
        return {"ok": True, "match_id": match_id, "phones": len(nids), "pushed": pushed}

    # ---------- A42: the END is a DELIVERY, and the heartbeat is the receipt ----------
    # Field 2026-09-12, TWICE: the operator ended the match and a player's tagger played on. `reached` was
    # never the statement it reads as — `net.push` answers False only when a node has NO SOCKET, and the
    # send that follows is a fire-and-forget task whose exception is swallowed (`net.py _send`) — so "END
    # REACHED 2 OF 2" has always been a fact about sockets, never about any HUD. There is no `ack` kind for
    # `control` (`types.py MC_KINDS`), and inventing one would be confirmed only by phones carrying a NEW
    # build: useless on the night it is needed.
    #
    # The receipt already exists, twice a second, from the build in players' hands TODAY. A bound phone
    # heartbeats `arm_state` and `match_id` (`engine.js statusBody`), and `_endLocal` moves it to `kitted`
    # while deliberately KEEPING `match_id`. A phone that took the end says `kitted` for that match; one
    # that missed it says `live`. MC watches for that, re-delivers to the ones still saying `live` on a
    # backoff, and — the point of the whole thing — SHOWS the operator who has not confirmed.
    #
    # ⚠ IT NEVER GATES. `_finish()` has written the recap and moved MC to recap before the first retry is
    # even due. A player who walks out of range at the whistle is normal and expected: there is no `await`
    # on a phone anywhere in the end path, and there must never be one.
    def _arm_end_delivery(self, match_id: str | None) -> None:
        """Watch every bound player HUD for its confirmation that `match_id` ended.

        The population is the BOUND PLAYER nodes — the same one the operator reads as `nodes`, and the only
        one with a name to put on a board. A benched player has no node and is never expected to confirm; a
        station is not in the match (`node_type: utility`); an UNBOUND node is still pushed the end by
        `_broadcast_control` (a HUD whose binding was lost is still running the match on its gun) but has no
        roster row, so there is nobody to name and it is not counted against the operator."""
        if not match_id:
            return
        now = self.now_ms()
        if any(e["match_id"] != match_id for e in self._end_delivery.values()):
            self._end_delivery = {n: e for n, e in self._end_delivery.items() if e["match_id"] == match_id}
            self._end_delivery_told = None
        for p in self.players.values():
            nid = p.get("node_id")
            if not nid or (self.nodes.get(nid) or {}).get("node_type") == "utility" or nid in self._end_delivery:
                continue
            self._end_delivery[nid] = {"match_id": match_id, "player_id": p["player_id"], "since": now,
                                       "tries": 0, "next_t": now + END_RETRY_MS[0], "confirmed": False,
                                       "confirmed_t": None, "exhausted": False, "last_ok": False}

    def _end_delivery_tried(self, nid: str, match_id: str, ok: bool) -> None:
        """Record ONE attempt at `nid` — the whistle's own push, A34's reconcile or A42's retry, which are
        all the same delivery — and set when the next one is due."""
        e = self._end_delivery.get(nid)
        if not e or e["match_id"] != match_id or e["confirmed"]:
            return
        e["tries"] += 1
        e["last_ok"] = ok
        e["next_t"] = self.now_ms() + END_RETRY_MS[min(e["tries"] - 1, len(END_RETRY_MS) - 1)]
        e["exhausted"] = e["tries"] >= 1 + len(END_RETRY_MS)

    def _note_end_confirm(self, nid: str, body: dict) -> None:
        """The ack, read off the heartbeat the phone was already sending — no new wire kind.

        A CONFIRMATION IS SOMETHING THE PHONE SAYS, NEVER THE ABSENCE OF A DENIAL. This was written the
        other way round: it returned early only for `armed`/`live` and confirmed on EVERY other value. That
        is the exact false assurance A42 exists to remove, re-introduced inside the fix for it — a phone
        that force-closes and relaunches mid-match comes back as `idle` until its gun relinks (`engine.js
        _load`: *"Phase is re-derived when the gun reconnects; until then we are idle"*), ships that `idle`
        on its next ~2 s heartbeat, and MC marked it confirmed PERMANENTLY: it stopped re-delivering, took
        the name off the board, and told the operator every HUD had confirmed the end while that tagger may
        still have been in the match. A restarted phone is not a rare shape — it is what a player does when
        the app misbehaves, mid-match, which is exactly when this matters.

        So only two shapes confirm, and both are positive claims:
          * `END_CONFIRM_PHASES` (`kitted`) FOR THIS `match_id` — the receipt A42 names: `_endLocal` moves
            the HUD there and deliberately keeps the match id, so the pair means "I ran your end";
          * a DIFFERENT `match_id` — whatever phase it reports, it is in another match, and an end for this
            one is no longer anything it could act on (A34's node-side rule, from the other side).

        Everything else is NO CLAIM and the watch stays open: `idle`/`connected` (restarting, or a lost
        context), `lobby`/`armed`/`live`, and a body with no `arm_state` at all. The cost of that is a
        straggler line for a phone that is merely quiet; the cost of the other direction was a match.

        The TAGGER was never the exposure: A34's reconcile still ends the gun on its next `armed`/`live`
        heartbeat for a retired match (`_check_stale_live`). What lied was the OPERATOR's green line, and
        that is what this restores.
        """
        e = self._end_delivery.get(nid)
        if not e or e["confirmed"]:
            return
        arm, mid = body.get("arm_state"), body.get("match_id")
        moved_on = mid is not None and mid != e["match_id"]          # it is playing something else
        took_ours = arm in END_CONFIRM_PHASES and mid == e["match_id"]
        if not (moved_on or took_ours):
            return
        confirmed_t = self.now_ms()
        e["confirmed"], e["confirmed_t"] = True, confirmed_t
        if e["tries"] > 1:
            # A line only when the FIRST push did NOT do it — that is the phone the operator was watching.
            # Every other confirmation is the system working, and belongs in no feed.
            p = self.players.get(e["player_id"]) or {}
            secs = max(0, confirmed_t - e["since"]) // 1000
            self._on_feed({"t_match_s": 0, "tag": "END", "kind": "alert",
                           "text": f"{(p.get('display') or e['player_id']).upper()}'S HUD CONFIRMED THE END "
                                   f"— {secs}S AFTER THE WHISTLE, ON DELIVERY {e['tries']}"})
        self._changed()

    def _retry_end_delivery(self, now: int) -> None:
        """Re-push `control{end, match_id}` to the HUDs that have not confirmed. Called from `tick()` (2 Hz).

        ⚠ `tick()` calls this ABOVE its `if not self.start_info: return`: `_finish()` clears `start_info`,
        and RECAP is the only phase this ever runs in. Below that gate it would be dead code."""
        for nid, e in list(self._end_delivery.items()):
            if e["confirmed"] or e["exhausted"] or e["next_t"] > now:
                continue
            ok = self.net.push(nid, "control", {"cmd": "end", "match_id": e["match_id"]}) is not False
            self._end_delivery_tried(nid, e["match_id"], ok)
        self._say_end_unconfirmed()

    def _say_end_unconfirmed(self) -> None:
        """Once, when the ladder is spent: NAME the phones that never confirmed, and say what to do about
        it. A fact about DELIVERY — it says nothing about how anyone played, and must never read as if it
        does."""
        if not self._end_delivery:
            return
        mid = next(iter(self._end_delivery.values()))["match_id"]
        if self._end_delivery_told == mid:
            return
        left = [e for e in self._end_delivery.values() if not e["confirmed"]]
        if not left or any(not e["exhausted"] for e in left):
            return
        self._end_delivery_told = mid
        who = ", ".join(sorted((self.players.get(e["player_id"]) or {}).get("display") or e["player_id"]
                               for e in left))
        self._on_feed({"t_match_s": 0, "tag": "WITHHELD", "kind": "alert",
                       "text": f"{len(left)} HUD{'S' if len(left) != 1 else ''} NEVER CONFIRMED THE END ({who}) "
                               f"— TOLD {1 + len(END_RETRY_MS)} TIMES. THAT TAGGER MAY STILL BE IN THE MATCH: "
                               f"END IT ON THE GUN"})
        self._changed()

    def _end_delivery_view(self) -> EndDeliveryView | None:
        """`API.md State.end_delivery` — what the operator reads while the match is ending and on RECAP.

        Both halves matter: the operator asked to know that every HUD acked, so a clean `4 of 4` is as much
        the answer as a straggler is. A DELIVERY fact about a phone, never a judgement about a player."""
        if not self._end_delivery:
            return None
        now = self.now_ms()
        rows: list[EndDeliveryRow] = []
        for nid, e in self._end_delivery.items():
            if e["confirmed"]:
                continue
            p = self.players.get(e["player_id"]) or {}
            rows.append({"player_id": e["player_id"], "display": p.get("display") or e["player_id"],
                         "node_id": nid, "tries": e["tries"], "since_ms": now - e["since"],
                         "reached": bool(e["last_ok"]), "retrying": not e["exhausted"]})
        rows.sort(key=lambda r: r["display"])
        total = len(self._end_delivery)
        return {"match_id": next(iter(self._end_delivery.values()))["match_id"], "total": total,
                "confirmed": total - len(rows), "unconfirmed": rows,
                "retrying": any(r["retrying"] for r in rows)}

    def _on_event(self, nid: str, ev: Event, t_recv: int):
        # `seq` is stamped onto the fact by `net.py` (`ev["seq"] = seq`) before it reaches here.
        # It used to be read from `_seq` first; NOTHING has ever written that key, so that half was dead.
        seq = ev.get("seq")
        self._node_view(nid)["last_seen_ms"] = t_recv
        parked = bool(self.scorer and ev.get("match_id") != self.scorer.match_id) or not self.scorer
        if ev.get("type") == "operator_result":
            # A47: stored like every fact, told to the operator, and kept away from every scorer -- the retired
            # match's scorer too (pl4: it used to reach `_ingest_retired` first).
            self._log(nid, "operator_result", ev, t_recv, seq=seq, parked=parked)
            self._on_operator_result(nid, ev, t_recv)
            return
        if ev.get("type") == "pickup":
            # A56: stored like every fact, never scored; it moves only the station's item state.
            self._log(nid, "pickup", ev, t_recv, seq=seq, parked=parked)
            self._on_pickup(ev, t_recv, parked)
            return
        self._note_pool_life(nid, [ev])            # A36
        self._note_protect(nid, [ev])              # F289
        self._ingest_retired(nid, [ev], t_recv)    # a late fact for the match the operator rolled past
        self._log(nid, ev.get("type", "event"), ev, t_recv, seq=seq, parked=parked)
        if not parked and ev.get("type") == "respawn":
            # A19: a respawn clears every held role on the node (engine.js) -- the VIP is still the VIP.
            pid = self.node_player.get(nid)
            if pid and pid == self.config.get("vip_player_id"):
                self._queue_role(pid, "vip", True)
        if self.scorer:
            before = len(self.scorer.hits_log)
            self.scorer.ingest(nid, ev, t_recv, seq=seq)
            # S56 ("what hit me"): `hits_log` only grows for a hit_taken fact that was genuinely
            # scored just now -- never a duplicate seq, never parked onto another match, never past
            # the A6.1 end freeze (see `_relay_hit_feedback`) -- so its length is the exact "is this
            # new" signal, with no need to touch `scoring.py`'s own dedup.
            if ev.get("type") == "hit_taken" and len(self.scorer.hits_log) > before:
                t, shooter, victim, dmg = self.scorer.hits_log[-1]
                self._relay_hit_feedback(shooter, victim, dmg, t, ev.get("weapon_id"), ev.get("shot_group"))
            self._flush_pending_limit()   # a cap deferred by a batch never waits on the NEXT batch
            self._reconcile_end(nid, [ev], t_recv)   # A24/M2: a late fact can move the END itself
            self._restore_recap()
            self._push_scores()
            self._changed()

    def ingest_batch(self, nid: str, events: list[Event], t_recv: int):
        self._node_view(nid)["last_seen_ms"] = t_recv
        # A47: an `operator_result` is stored and told to the operator, never scored (and it must not
        # count toward a batch's re-base or SYNC POINT either).
        results = [ev for ev in events if ev.get("type") == "operator_result"]
        if results:
            for ev in results:
                self._log(nid, "operator_result", ev, t_recv, seq=ev.get("seq"),
                          parked=not self.scorer or ev.get("match_id") != self.scorer.match_id)
                self._on_operator_result(nid, ev, t_recv)
            events = [ev for ev in events if ev.get("type") != "operator_result"]
            if not events:
                return
        pickups = [ev for ev in events if ev.get("type") == "pickup"]
        if pickups:
            # A56: stored, never scored, and kept out of the batch's re-base and SYNC POINT.
            for ev in pickups:
                parked = not self.scorer or ev.get("match_id") != self.scorer.match_id
                self._log(nid, "pickup", ev, t_recv, seq=ev.get("seq"), parked=parked)
                self._on_pickup(ev, t_recv, parked)
            events = [ev for ev in events if ev.get("type") != "pickup"]
            if not events:
                return
        self._note_pool_life(nid, events)          # A36
        self._note_protect(nid, events)            # F289
        self._ingest_retired(nid, events, t_recv)  # a late fact for the match the operator rolled past
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
                before = len(self.scorer.hits_log)
                self.scorer.ingest_batch(nid, events, t_recv)
                self._relay_batch_hits(self.scorer.hits_log[before:])   # S56 ("what hit me")
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
            self.last_recap = self._scorer_recap(self.scorer, self._match_stations)
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
            body["board"] = self._score_board(self.scorer)  # the race to the cap, for the HUD's DOWN-screen recap (review 2026-09-03 #25/#26)
            body["rows"] = rows                     # A24: EVERY player's row, all modes — the phone's mid-match leaderboard
            if self._score_pushed.get(pid) == body:
                continue
            self._score_pushed[pid] = body
            self.net.push(p["node_id"], "score", body)

    # ---------- A24: the match result reaches EVERY node, losers included ----------
    def _as_played(self, p: Player, roster: dict[str, Player] | None = None) -> Player:
        """The recipient AS THE FIELD WORE THEM (A24/M2 round-2 review).

        `_replay` was already fixed to score `_match_players`, the roster frozen at the whistle — but
        the RESULT still read the live one, so the same late flush could hand yellow the win and tell
        the player who won it `outcome: "lose"`, because the operator had moved them to blue for the
        next match. Which side a recipient wore is a fact about the match that was played.
        """
        roster = self._match_players if roster is None else roster
        if roster is None:
            return p
        return roster.get(p["player_id"], p)

    def _played_this_match(self, pid: str) -> bool:
        """Was this player on the roster at the whistle? A player ADDED during the debrief was being
        pushed a win or a loss for a match they were standing in the car park for (and `add_player`
        registered them into the finished scorer, growing the archived recap a 0/0 row). They get no
        `result` at all -- the HUD's neutral "no result for you" state, contracts §5 `result`."""
        return self._match_players is None or pid in self._match_players

    def _outcome_for(self, winner: WinnerView, p: Player, roster: dict[str, Player] | None = None) -> str:
        """"win" | "lose" | "draw" | "undecided", FOR THIS RECIPIENT (A24).

        The node never infers this: silence means "you lost" and "your phone dropped off the LAN"
        identically (game test 2026-09-11 D3), so MC is the only thing that may say the word.
        The recipient's team is read AS PLAYED (`_as_played`), never as the debrief has it.
        """
        p = self._as_played(p, roster)
        if not winner or winner.get("undecided"):
            return "undecided"
        tie = winner.get("tie")
        if tie:
            mine = p["player_id"] if self.config.get("mode") == "ffa" else p.get("team_id")
            return "draw" if mine in tie else "lose"
        team_id = winner.get("team_id")
        if team_id is not None:
            return "win" if p.get("team_id") == team_id else "lose"
        player_id = winner.get("player_id")
        if player_id is not None:
            return "win" if p["player_id"] == player_id else "lose"
        return "undecided"

    def _result_team_scores(self, recap: RecapView) -> list[dict]:
        """`[{team_id, name, score}]` for the results screen. TEAM modes only — in FFA there are no teams
        and `rows` is already the leaderboard, so this is `[]` rather than three players wearing a team
        shape (which is what `score.board` does, for a different job: the DOWN screen's race to the cap)."""
        if self.config.get("mode") == "ffa":
            return []
        totals = recap.get("score") or {}
        names = {t["team_id"]: str(t.get("name") or t["team_id"]) for t in self.teams}
        return [{"team_id": tid, "name": names.get(tid, tid), "score": sc} for tid, sc in totals.items()]

    def _result_body(self, recap: RecapView, p: Player, *, match_id: str | None = None,
                     roster: dict[str, Player] | None = None) -> dict:
        """The `result` envelope for ONE player (contracts §5 `result`).

        A34: `match_id` and `roster` name a PAST match (from the `_ended` ledger) when a phone comes back
        still live in one; left None they read the current scorer and the roster frozen at the whistle,
        exactly as before."""
        if roster is None:
            roster = self._match_players if self._match_players is not None else self.players
        p = self._as_played(p, roster)           # the side, the name and the row AS PLAYED, not as edited
        winner = recap.get("winner") or {}
        rows = recap.get("rows") or []
        display = {pl["player_id"]: pl.get("display") for pl in roster.values()}
        body = {
            "match_id": match_id if match_id is not None else (self.scorer.match_id if self.scorer else None),
            "outcome": self._outcome_for(winner, p, roster),
            "winner": winner,
            "mode": self.config.get("mode"),
            "win_by": (self.config.get("scoring") or {}).get("win_by"),
            "team_scores": self._result_team_scores(recap),
            "rows": rows,
            "my": next((r for r in rows if r["player_id"] == p["player_id"]), None),
            # `display` is the PLAYER's name, so a phone can render the honours roll without the roster.
            # integration review (Low): a pre-A63 recap has no `key`; `Honor.key` is NotRequired, so it is left out
            "honors": [{"medal": h.get("award"), **({"key": k} if (k := h.get("key")) else {}), "player_id": h.get("player_id"),
                        "display": display.get(h.get("player_id")) or h.get("player_id"), "stat": h.get("stat")}
                       for h in (recap.get("honors") or [])],
            "provisional": bool(recap.get("provisional")),
            "t": self.now_ms(),
        }
        for k in ("possession", "after_end"):
            value = recap.get(k)
            if value is not None:
                body[k] = value
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

    def _match_facts(self, match_id: str, *, arrival: bool = False) -> list[dict]:
        """Every persisted fact for this match, in EFFECTIVE-t order (the order it should have been
        scored in, not the order it arrived in). `store.events` returns insertion order, and the sort
        is stable, so two facts on the same millisecond keep their arrival order. `arrival=True` skips
        the sort and returns insertion order (the order MC received them), for `_arrival_cap_recv`.

        ⚠ Known gap: an `event_batch` from a NEVER-SYNCED node is re-based once per flush (A5.7,
        `offset = t_recv - t_newest`) and the store keeps no batch grouping, so on replay those facts
        fall back to `t_recv` — the same approximation the live path makes for a single event from such
        a node. Their window awards are suppressed either way.

        Integration review 2026-09-25 (A63): the live path judges streak medals and KILLJOY in ARRIVAL order,
        this replay in `t` order (the cap move needs it), so a re-scored recap can differ from the medals
        heard live, the multi-kill chain included (in `t` order no kill is late). A63's text says so; replaying in arrival order would move the frag-cap end.
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
        if arrival:
            return facts      # polish r1: store insertion order, which is the order MC received them
        def eff(r):
            t, tr = r.get("t"), r.get("t_recv") or 0
            return t if (t is not None and self.synced_at_lobby.get(r.get("node_id"), False)) else tr
        return sorted(facts, key=eff)

    def _arrival_cap_recv(self, like: Scorer, facts: list[dict]) -> int | None:
        """F356: the `t_recv` at which these facts, taken in the order MC RECEIVED them, first reach the
        frag cap -- the moment the live scorer's whistle blew. None when they never do (or no cap is set).
        A scratch scorer with no callbacks, so nothing is cued, fed or ended."""
        if not like.frag_limit or like.win_by != "kills":
            return None
        probe = Scorer(like.match_id, like.go_live_t, like.time_limit_s, like.mode, like.players,
                       list(like.teams.values()), like.node_player, like.synced_at_lobby, now_ms=self.now_ms,
                       win_by=like.win_by, frag_limit=like.frag_limit)
        probe.joined_t = dict(like.joined_t)
        # `facts` come in store insertion order (`_match_facts(arrival=True)`), which IS the order MC received
        # them, across a restart too (`_import_facts` copies the old rows first). No sort on `t_recv`: two facts
        # on one millisecond keep their order, and a new process's clock cannot reorder the old one's facts.
        for r in facts:
            probe.ingest(r["node_id"], cast(Event, dict(r["body"])), r.get("t_recv") or 0, seq=r.get("seq"))
            if probe.limit_reached_t is not None:
                return r.get("t_recv") or 0
        return None

    def _replay(self, old: Scorer, facts: list[dict], freeze_at: int | None = None) -> Scorer:
        """Re-derive a Scorer for THIS match from stored facts. Pure: no feedback, no alerts, no feed,
        no cap callback — a replay must never re-fire a cue at a player standing in the debrief.

        Every constructor argument comes from the scorer being replaced, not from `self.config`: the
        operator can edit the draft config during recap, and the match that was played does not change
        when they do. The ROSTER is the frozen copy taken at the whistle for the same reason —
        `old.players` IS `self.players`, so a re-team made in the debrief would otherwise replay the
        finished match on the new teams and hand the win to a side that never held it.
        """
        # The stored facts are keyed by node, so the replay binds them through EVERY node that spoke for a
        # player in this match (`_match_nodes`), not only the nodes connected now: a phone offline since an
        # MC restart, or hot-swapped out, still played this match (chaos testing 2026-09-24). The match's
        # own map WINS over the live one: a phone handed to someone else in the debrief played the match as
        # its first holder. The scorer then reads the live map again, as `_build_scorer`'s does.
        sc = Scorer(old.match_id, old.go_live_t, old.time_limit_s, old.mode,
                    self._match_players if self._match_players is not None else old.players,
                    list(old.teams.values()), {**old.node_player, **self._match_nodes}, old.synced_at_lobby,
                    now_ms=self.now_ms, win_by=old.win_by, frag_limit=old.frag_limit)
        if freeze_at is not None:
            sc.set_end(freeze_at)
        sc.joined_t = dict(old.joined_t)         # A63: a hot join is not a fact the replay can re-derive
        sc.cap_recv = old.cap_recv               # F356: when the field heard the whistle is an arrival fact
        for r in facts:
            body: Event = r["body"]
            sc.ingest(r["node_id"], body.copy(), r.get("t_recv") or 0, seq=r.get("seq"))
        sc.node_player = old.node_player
        return sc

    def _adopt_scorer(self, old: Scorer, sc: Scorer) -> None:
        """Swap a replayed Scorer in for the live one, carrying the state facts cannot re-derive.

        `shots` arrives on the ~2 s status heartbeat and is a LATEST-WINS sample, not an event log, so
        the old scorer's copy is the only one there is — replaying it would mean re-ingesting every
        status envelope to land on the same number. `flushed` is sticky for the same reason: a node
        marked flushed by `_mark_flushed_live` (connected, fresh, nothing pending) never sent a fact to
        prove it, and losing that mark would make a settled recap provisional again.
        """
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

    def _reconcile_end(self, nid: str, events: list[Event], t_recv: int) -> bool:
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
        live = self.scorer            # a local, because the genexp below is its own scope
        end_t = live.end_t
        if end_t is None:
            return False
        # A death inside the scored window can move the cap EARLIER; one inside the clock band just
        # after the end can reveal a DEAD HEAT (`check_cap_tie`). Anything later than that changes
        # neither, and is already reported as an after-the-whistle fact.
        if not any(ev.get("type") == "death" and live.eff_t(nid, ev, t_recv) <= end_t + CLOCK_TIE_MS
                   for ev in events if isinstance(ev, dict)):
            return False
        facts = self._match_facts(live.match_id)
        if not facts:
            return False
        probe = self._replay(live, facts)        # no freeze: where does the cap fall on ALL the facts?
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
        sc = self._replay(live, facts, freeze_at=cap_t)
        sc.cap_tie = sc.check_cap_tie(CLOCK_TIE_MS)
        before = (live.winner(), end_t)
        self._adopt_scorer(live, sc)
        if cap_t < end_t:
            # F357: a kill the moved end un-scores is now an after-the-whistle kill, and the feed line MC wrote
            # when it counted cannot say so. Mark each one again, AFTER WHISTLE, as the live path marks a late one.
            # keyed on the fact's content: a stored body and a live batch body do not both carry `seq`
            def key(n: str, ev: Event) -> tuple:
                return (n, ev.get("t"), ev.get("player_id"), ev.get("shooter_num"))
            was = {key(n, ev) for n, ev, _t in live.post_end}
            for n, ev, t_recv in sc.post_end:
                if ev.get("type") == "death" and key(n, ev) not in was:
                    sc._after_whistle_feed(n, ev, sc.eff_t(n, ev, t_recv))
            moved = (end_t - cap_t) / 1000.0
            self._on_feed({"t_match_s": max(0, (cap_t - sc.go_live_t) // 1000), "tag": "RESCORED", "kind": "alert",
                           "text": f"END MOVED BACK {moved:.1f}s — a late flush shows the cap was reached earlier. "
                                   f"Everything after that moment is un-scored and reported as after the whistle"})
        if before[0] != sc.winner():
            self._on_feed({"t_match_s": max(0, (cap_t - sc.go_live_t) // 1000), "tag": "RESCORED", "kind": "alert",
                           "text": "THE WINNER CHANGED on re-scored facts — the field has been re-told the result"})
        return True

    def _score_board(self, scorer: Scorer) -> dict:
        """Team totals + the frag cap; in FFA the top three players stand in for teams.

        The scorer is PASSED for the same reason `_scorer_recap` takes one: both callers are already
        inside an `if self.scorer` and there is no board without one. Spelled `scorer`, not `sc`: the
        team comprehension below already binds `sc` to a SCORE."""
        scoring = self.config.get("scoring") or {}
        cap = scoring.get("frag_limit") if scoring.get("win_by") in (None, "", "kills") else None
        if self.config.get("mode") == "ffa":
            top = sorted(scorer.rows(), key=lambda r: -r["kills"])[:3]
            return {"teams": [{"team_id": "ffa", "name": r["display"], "score": r["kills"]} for r in top], "cap": cap}
        totals = scorer.team_scores()
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
            # A36: `config_id` is KEPT. It has always been on the wire (`envelope.REQUIRED`) and was
            # dropped here, so an ack for a PREVIOUS head satisfied `all_acked()` on truthiness alone
            # and the whistle blew on a roster still running last game's frames (field 2026-09-12).
            ack = {"ok": bool(body.get("ok")), "gun_echo": body.get("gun_echo"),
                   "err": body.get("err"), "config_id": body.get("config_id")}
            readback = body.get("gun_config")
            fields = ("player_id", "team", "hp", "armor", "shield")
            if (isinstance(readback, dict)
                    and all(isinstance(readback.get(k), int) and not isinstance(readback.get(k), bool)
                            and readback[k] >= 0 for k in fields)):
                ack["gun_config"] = {k: readback[k] for k in fields}
            self.acks[pid] = ack
            if body.get("ok") and body.get("gun_echo"):
                self.nodes[nid]["headset"] = "proven"
        elif kind == "event_batch":
            self.ingest_batch(nid, body.get("events", []), t_recv)
            return
        elif kind == "station_action":
            self._on_station_action(nid, body, t_recv)    # A56 (S58)
        elif kind == "log_offer":
            # A25: the node is telling us what it holds. Record it, then ask (gated by `log_sync` and
            # by the ~1 MB per-node budget, both inside `pull_log`).
            self._set_log(nid, "offered",
                          reason=body.get("reason") if isinstance(body.get("reason"), str) else None,
                          lines=body.get("lines") if isinstance(body.get("lines"), int) else None,
                          nbytes=body.get("bytes") if isinstance(body.get("bytes"), int) else None)
            # B7: a stream from this node is already in flight (manual or automatic) -- a `log_offer`
            # arriving mid-upload is the node re-announcing what it holds, not a fresh request. Answering
            # it with another `pull_log` queues a second ask the node runs the moment the first finishes,
            # which re-offers, which asks again... free-running until the byte budget cuts it (B7, field
            # session 2026-09-12). The already-running stream is the single legitimate ask; do not stack
            # a second one on top of it.
            if nid not in self._log_inflight:
                self.pull_log(nid, "offer")
        elif kind == "log_data":
            self._log_asked.discard(nid)          # A25: the node is answering; the ask is no longer outstanding
            self._log_inflight.add(nid)           # B7: ...and the stream itself is running until its `last` chunk
            n = len(str(body.get("chunk", "")))
            self._log_bytes[nid] = self._log_bytes.get(nid, 0) + n
            # A25: only a COMPLETE `last`-terminated stream counts as delivered -- a half-uploaded log
            # that the node abandoned mid-match must still read as owed, or the `reconnect` ask never
            # fires for exactly the node that needs it.
            if body.get("last"):
                self._set_log(nid, "complete", nbytes=self._log_bytes.get(nid, 0))
                self._log_done[nid] = self._log_match
                self._log_inflight.discard(nid)   # B7: stream over -- the NEXT log_offer is a new ask, not a loop
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
        if self.in_play():
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
        self._roll_forward_from_recap()        # leaving RECAP by the nav is starting the next match too
        was = self.phase
        self.phase = cast(Phase, phase)  # validated against PHASES above
        # F337 (d): no station re-send here. A pushed game keeps the LOAD lock in every pre-match phase
        # (`_station_lock_s`), so moving between them changes nothing a station was told.
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

    def versions(self) -> VersionsView:
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
            ambers.append(f"APP VERSION UNKNOWN ({av}): UPDATE THE APP" if isinstance(av, str) and av else "APP VERSION UNKNOWN: UPDATE THE APP")
            return blockers, ambers
        if not ok:
            # `compatible()` answered a bool, so `parse_app_ver` parsed `av`: it is a version STRING.
            shown = av.split("+", 1)[0] if isinstance(av, str) else av
            blockers.append(f"APP {shown} INCOMPATIBLE WITH MC (NEEDS {app_tier()}): UPDATE THE APP")
            return blockers, ambers
        mine = parse_app_ver(av)
        newest = self._newest_field_version()
        if newest and mine and mine < newest:
            ambers.append(f"APP OLDER THAN THE FIELD ({'.'.join(str(x) for x in mine)} < {'.'.join(str(x) for x in newest)}): UPDATE THE APP")
        rel = parse_app_ver(self.release_version)
        if rel and mine and mine < rel:
            ambers.append(f"APP OLDER THAN THE RELEASE ({'.'.join(str(x) for x in mine)} < {self.release_version}): UPDATE THE APP")
        return blockers, ambers

    def _respawn_rules_warning(self) -> str | None:
        """Review finding, 2026-09-19: a mixed fleet is ALLOWED — the 0.4 compatibility gate
        (`_refuse_incompatible_app`) is unrelated and untouched — but an app below `RESPAWN_PROFILE_MIN_APP`
        has no `respawn_profile` at all and keeps the OLD spawn-protection rules (protected at go-live,
        the trigger live at respawn), not today's (protected only when the game sets it, the trigger held
        until the weapon delay). Names every bound player still on one, in a friendly, never-blocking line
        for the readiness board. `None` when nobody is behind, or their version cannot be read at all."""
        behind = [self.players[pid].get("display") or pid
                  for pid, p in self.players.items()
                  if (nid := p.get("node_id")) and (nv := self.nodes.get(nid))
                  and compatible(av := nv.get("app_ver")) and (v := parse_app_ver(av)) and v < RESPAWN_PROFILE_MIN_APP]
        if not behind:
            return None
        return (f"APP TOO OLD FOR TODAY'S RESPAWN RULES ({', '.join(behind)}): UPDATE THE APP TO "
                + ".".join(str(x) for x in RESPAWN_PROFILE_MIN_APP))

    def _weapon_app_blockers(self, nv: dict) -> list[str]:
        """Required victim-side engines for weapons anywhere on this roster.

        The victim cannot infer the shooter's catalog row. Node-driven effects therefore arrive in the
        game-wide bundle and every phone must know how to execute them. Keep this generic so the next
        weapon feature gets an explicit release boundary instead of another partial field deployment.
        """
        present = {w.get("weapon_id")
                   for p in self.players.values()
                   for w in ((p.get("loadout") or {}).get("weapons") or [])}
        catalog = getattr(self.compiler, "catalog", None)
        raw_requirements = catalog.app_requirements() if catalog is not None else self.compiler.weapon_catalog()
        requirements = {w["weapon_id"]: (parse_app_ver(w.get("min_app")), w.get("name") or w["weapon_id"])
                        for w in raw_requirements if w.get("min_app")}
        have = parse_app_ver(nv.get("app_ver"))
        if have is None:
            return []  # the existing version-unknown path is amber here and a hard refusal at START
        out = []
        for wid in sorted(present):
            requirement = requirements.get(wid or "")
            if requirement and (minimum := requirement[0]) is not None and have < minimum:
                _, label = requirement
                out.append(f"APP CANNOT RUN {str(label).upper()} (NEEDS {'.'.join(str(x) for x in minimum)}): UPDATE THE APP")
        return out

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
            if g:
                claimed.add(g.get("sticker", "").lower())
            scan = next((s for s in self.scan_rows if s.get("gun_id") == p.get("gun_id")), None)
            identity = scan["identity"] if scan else ("ok" if g else "unknown")
            if not nid:
                # NOT a fault: before a phone has ever connected this is the expected state.
                # It still blocks the start (a player with no phone cannot play), but it must not
                # read as a broken gun — Tony, 2026-09-01: "it makes it look like the guns are
                # broken. They are simply disconnected."
                blockers.append(WAITING_FOR_PHONE)
            elif nv.get("last_seen_ms") and (now - nv["last_seen_ms"]) > OFFLINE_AFTER_MS:
                # Gone, not faulty. Say it once instead of listing the four symptoms of it.
                # Guarded on the key EXISTING: a node that has never reported has no last_seen at all,
                # and treating the epoch as its timestamp read "OFFLINE (LAST SEEN 20698D16H)".
                blockers.append(f"OFFLINE (LAST SEEN {self._human_age(now - nv['last_seen_ms']).upper()}): RECONNECT THE PHONE")
            else:
                age = now - nv.get("last_seen_ms", 0)
                if age > STALE_AFTER_MS:
                    ambers.append(f"STALE LINK ({self._human_age(age).upper()})")
                if not nv.get("synced"):
                    blockers.append(CLOCK_NOT_SYNCED)
                if pf.get("ssid_ok") is False or pf.get("mc_reachable") is False:
                    # A28.3: for a node that is actually TALKING to us over backhaul, the field Wi-Fi is
                    # not the path that matters — §5c gates (d)/(f) become warnings, not reds. Blocking
                    # the start on "wrong Wi-Fi" for a phone whose status arrived over its data plan
                    # would make backhaul unusable on exactly the fields it exists for.
                    if nv.get("reach") == "backhaul":
                        # F144 (field 2026-09-12): not even amber. A phone MC IS TALKING TO is ready, and
                        # an amber CHECK on every backhaul player made the first real tunnel match read as
                        # a board full of faults. The path is a TAG on the row (`reach`), not a complaint.
                        pass
                    elif nv.get("last_reach") == "backhaul":
                        # F155: this phone's last known path to MC was the internet, so "WRONG WI-FI" is
                        # a lie — it is on the network it has always been on and the TUNNEL is what went
                        # away. Say the thing the operator can act on: how long since we heard from it.
                        pub = (self.lan.get("public") or {}).get("status")
                        blockers.append(not_reached_line(self._human_age(max(0, age)).upper(), pub == "error"))
                    else:
                        blockers.append(WRONG_WIFI)
                # Bench 2026-09-17: the config-push ack, read early so the flapping amber below can tell
                # an UNPROVEN headset from one that already answered THIS push. `self.acks` survives a
                # link drop (only `_on_status`'s `nv["headset"]` gets popped), so it is the one fact this
                # check can trust once the gun has gone dark.
                push_ack = self.acks.get(p["player_id"])
                echoed_this_push = bool(self.lobby_pushed and push_ack and push_ack.get("ok") and push_ack.get("gun_echo"))
                if pf.get("gun_flapping") is True and not (echoed_this_push and pf.get("gun_linked") is False):
                    # Bench 2026-09-17: a gun whose headset is off takes the link and drops it within
                    # seconds, again and again. The row used to swap GUN LINK LOST (red) for HEADSET
                    # CONFIRMING (amber) with every cycle. The phone counts the quick drops and says so;
                    # the board shows one steady amber line instead — but only while the headset/echo is
                    # still UNPROVEN. A gun that already answered this push and then goes dark is a real
                    # fault, not a flapping headless gun, so the red returns (F-2026-09-17b).
                    ambers.append(GUN_FLAPPING_LINE)
                elif pf.get("gun_linked") is False:
                    blockers.append(GUN_LINK_LOST)
                if nv.get("battery") is None:
                    ambers.append(BATTERY_UNREAD)
                if pf.get("phone_batt") is not None and pf["phone_batt"] < BATTERY_LOW_PCT:
                    ambers.append(PHONE_BATTERY_LOW)
                if pf.get("screen_on") is False or pf.get("foreground") is False:
                    ambers.append(SCREEN_OFF)
                # Bench 2026-09-17 (Tony): firmware is often unreadable over BLE and says nothing about health, so an
                # unread version is not an amber. The card still shows the version when the phone reports one.
                vb, va = self._version_flags(nv)          # A29: the app build this phone is actually running
                blockers.extend(vb)
                ambers.extend(va)
                blockers.extend(self._weapon_app_blockers(nv))
            if identity in ("reverted", "unknown") and g:
                blockers.append(IDENTITY_REVERTED)
            ack = self.acks.get(p["player_id"])
            if self.lobby_pushed and ack is not None and (not ack.get("ok") or not ack.get("gun_echo")):
                blockers.append(GUN_DID_NOT_ANSWER)
                headset, headset_proof = "absent", None
            elif nv.get("headset") == "proven":
                headset, headset_proof = "proven", "echo"     # the gun answered the push: settled
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
                    headset, headset_proof = "proven", "link"
                else:
                    headset, headset_proof = "unknown", None
                    if since is not None and pf.get("gun_flapping") is not True:
                        ambers.append(f"HEADSET CONFIRMING (LINK {(now - since) // 1000} S)")
            # A36 — THE THREE PROOFS THAT THE GUN IS RUNNING THE CONFIG WE PUSHED. Kept apart from
            # the headset chain above: that chain answers "did the gun answer AT ALL", these answer
            # "did it answer for THIS game, with THIS weapon, and is it still holding THAT pool".
            # Every one of them compares against the head MC ACTUALLY PUSHED
            # (`self.bundles[pid]["head"]`), never a fresh re-derivation of it.
            if self.lobby_pushed and (older := self._stale_ack_id(p["player_id"])):
                blockers.append(f"{_STALE_ACK_FAULT} ({older}): RE-PUSH")
            if self.lobby_pushed and (echo := self._echo_fault(p["player_id"])):
                blockers.append(echo)
            if self.lobby_pushed and (readback := self._gun_config_fault(p["player_id"])):
                blockers.append(readback)
            if (pool := self._pool_faults.get(p["player_id"])) is not None:
                blockers.append(pool)
            # R2-4/R2-6: the same check where it can only suggest. Amber, so it never gates.
            if (pool_a := self._pool_ambers.get(p["player_id"])) is not None:
                ambers.append(pool_a)
            # The heartbeat's own answer to "which head am I on". Amber, not red: the ack is the
            # authority (it is the gun's word at the moment of the write) and this is a ~2 s sample
            # that can legitimately be one beat behind a fresh push -- so it stands only until the
            # node re-acks.
            if (self.lobby_pushed and nv.get("config_id")
                    and nv["config_id"] != self.config.get("config_id")
                    and not self._ack_is_current(p["player_id"])):
                ambers.append(f"HOLDING OLDER CONFIG ({nv['config_id']})")
            # ONE literal, at the end: `ReadinessRow` is total and its docstring is the promise that
            # every path fills every key. Built incrementally that promise was unenforceable; built here
            # the checker holds it.
            row: ReadinessRow = {
                "gun_id": p.get("gun_id") or "", "sticker": g.get("sticker", p.get("gun_id") or "—"),
                "tail": g.get("ble", {}).get("tail", ""), "player_id": p["player_id"], "player_num": p["player_num"],
                "present": bool(nid), "node": "linked" if nid else "none", "identity": identity,
                "headset": headset, "headset_proof": headset_proof,
                # A37: the WEAPON check's own three-state answer, beside the blocker it may also have
                # produced. `not_echoed` is the field's NORMAL answer and is neutral, never green.
                "echo": self._echo_state(p["player_id"]),
                "battery_pct": nv.get("battery"), "battery_age_ms": (now - nv.get("last_seen_ms", now)) if nid else None,
                "last_seen_age_ms": (now - nv.get("last_seen_ms", now)) if nid else None,   # the UI showed "0s AGO" reading a field that didn't exist (2026-08-26)
                "gun_linked": pf.get("gun_linked"),
                "gun_flapping": pf.get("gun_flapping") is True,   # the Armory card shows one steady HEADSET OFF
                # F208: passed through, never judged here. Stale-link cards hide it (the link age says more).
                "pool_stale": nv.get("pool_stale") if nid else None,
                "pool_stale_ms": nv.get("pool_stale_ms") if nid else None,
                # F264: the node's own outcome after a `pool_stale` probe, passed through verbatim.
                "cure": nv.get("cure") if nid else None,
                # A28.3/F144: the path MC is reaching this phone over right now, and the last one it was
                # heard on. The Armory card renders the first as a tag and the second is what makes an
                # unreachable row's reason honest (F155). `ReadinessRow` requires both.
                "reach": nv.get("reach"), "last_reach": nv.get("last_reach"),
                "fw": nv.get("fw"), "phone_batt": pf.get("phone_batt"), "ssid_ok": pf.get("ssid_ok"),
                "mc_reachable": pf.get("mc_reachable"), "synced": nv.get("synced"), "screen_on": pf.get("screen_on"),
                "foreground": pf.get("foreground"),
                "app_ver": nv.get("app_ver"), "platform": nv.get("platform"),   # A29
                "log": nv.get("log"),                                           # A25
                # kept APART. Merging them meant the lobby printed every blocker and every advisory
                # as one run-on blocker string, so a real fault read the same as a shrug.
                "blockers": blockers, "ambers": ambers,
                # `waiting` blocks exactly like `red` but is not a fault: nothing has gone
                # wrong, the phone simply has not arrived yet. Only when the MISSING NODE is
                # the sole complaint — a real problem alongside it still reads red.
                # `waiting` covers BOTH "no phone yet" and "the phone went away": each blocks
                # the start, neither is a fault, and both must read as inactive rather than red.
                "status": ("waiting" if len(blockers) == 1 and (not nid or blockers[0].startswith(("OFFLINE", WAITING_FOR_PHONE)))
                           else "red") if blockers else ("amber" if ambers else "green")}
            # F272 is additive and positive-only: omit it rather than serializing false/null, so an
            # older console and an older persisted snapshot both keep their existing meaning.
            if nid and nv.get("gun_locked") is True:
                row["gun_locked"] = True
            board.append(row)
        unclaimed = [s for s in self.scan_rows if s.get("basename", "").lower() not in claimed]
        greens = sum(1 for r in board if r["status"] == "green")
        # Round-2 B: a fault about the ROSTER AS A WHOLE, not about any one gun, so it cannot live in a
        # board row. Top-level and rendered red by the console, which must not have to recompute the
        # rule client-side to know the push is going to be refused.
        roster_faults = [f] if (f := self._one_team_fault()) else []
        return {"t": now, "roster_size": len(board), "greens": greens, "board": board, "unclaimed": unclaimed,
                "roster_faults": roster_faults, "unrostered_phones": self.unrostered_phone_count(),
                "respawn_rules_warning": self._respawn_rules_warning(),   # review finding: never in `go`
                "go": all(r["status"] not in ("red", "waiting") for r in board) and bool(board) and not roster_faults}

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
        if ok and self.in_play():
            ok, reason = False, KIT_LOCKED          # the kit locks at START: nothing is stored, nothing is pushed
        if ok and not self.lobby_pushed and self.phase != "kit":
            # before KIT the phones are on "setting up" (§4.6); after the push the existing path below still applies
            # the pick (re-push) and only reports the try-out as closed
            ok, reason = False, "Mission Control is still setting up the game"
        dropped = None
        # `new` is only READ under the same `ok` that assigns it below, but nothing said so; bound here
        # to the untouched kit, which is also what a refused pick leaves in place.
        before: Loadout = p.get("loadout") or {"weapons": []}
        new = before
        if ok:
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
        if self.lobby_pushed or self.in_play():
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
        Cells move under `hit_audio_rekey` and under `--distinct-weapon-cells` (F315); either one makes the pin load-
        bearing. With both off the cells never move and the pin is inert.

        `push_config()` clears the pin, so a deliberate full re-push re-derives; nothing else does.

        A LATE JOINER whose weapons the pinned plan never saw is safe only when those weapons sit on a
        STOCK cell: `Plan.cell_for()` returns None, `Compiler._rekey` returns the frame unchanged, and the
        weapon stays on its stock cell, which every gun's table carries because `sir_table` never removes
        a stock row. That is pinned by
        `test_a_player_whose_weapons_the_pinned_plan_never_saw_falls_back_to_STOCK_cells`.

        It is NOT safe for a weapon whose row is conditional (a catalogue `sir_fn` on a cell the base table
        lacks: the Toxin Rifle, the Breacher, the Haze) or that declares `dot`. No gun in the match carries
        that row or that `dot` entry, so its hits vanish in silence. `_plan_gaps` finds such a weapon and the
        hot join is WITHHELD (`_hot_join_withheld`, S16 review 2026-09-19)."""
        fn = getattr(self.compiler, "hit_plan", None)      # a test double need not carry the whole compiler
        if fn is None:
            return None
        if self._pinned_hit_plan is None:
            # `roster()` is the public wire view. S56 added a `weapons[]`/`hir` summary to it, but it
            # still carries no perk or override -- using it here produced an empty plan: conditional
            # Breacher/Toxin rows never reached any head and A17 stopped the push. The compiler needs
            # the authoritative Player records.
            # A56: the pickup weapons ride as a stand-in carrier, so every gun's `$SIR` covers their cells.
            carrier = _compile.Compiler._pickup_carrier(self._powerup_slots())
            self._pinned_hit_plan = fn(list(self.players.values()) + carrier,
                                       rekey=bool(self.config.get("hit_audio_rekey", False)))
        return self._pinned_hit_plan

    def _compile_rolled(self, p: Player):
        """Compile with this push's voice roll (A15.1) and say what was drawn."""
        kw = {"roll": self._voice_rng}
        plan = self._hit_plan()
        if plan is not None:
            kw["plan"] = plan
        bundle = self.compiler.compile(self._compile_config(), p, self.teams, **kw)
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
        if self._ack_is_current(p["player_id"]):     # A36: an ack for a PREVIOUS head proves nothing here
            return True
        return (self.nodes.get(p.get("node_id") or "") or {}).get("arm_state") in ("armed", "live")

    def _compile_and_store(self, p: Player) -> None:
        """The COMPILE half of `_push_config_to`: recompute `p`'s frames and store them, sending
        nothing yet.

        Split out (S56) so a whole-roster repush (`_repush_lobby_config`, and the first `push_config`
        loop) can finish recompiling EVERY player before any push goes out. `roster()`, embedded in
        each `config` push, reads OTHER players' `self.bundles` for their `hir` magnitudes; sending
        inside the same pass that recompiles could hand an early player a roster naming a LATER
        player's brand-new weapon_id beside that later player's OLD, not-yet-recompiled hir numbers --
        a real defect this split exists to close, not a hypothetical one."""
        # The guard `push_config` carries, narrowed to ONE player: a `config` is a head write, and in
        # armed/live that head is the F121 disarmed table with nothing to re-spawn a gun already in play.
        # A node that never took this match's config is the exception — that write is its hot join.
        if self.in_play() and self._took_this_config(p):
            raise ConflictError(_KIT_LOCKED_HOST.format(phase=self.phase.upper(), what="the frames"))
        bundle = self._compile_rolled(p)
        self.bundles[p["player_id"]] = bundle
        self._head_sent_t[p["player_id"]] = self.now_ms()
        self.acks.pop(p["player_id"], None)
        # A36: a fresh head retires every judgement made about the old one. The ack above, the echo
        # that rode with it (derived from the ack, so it goes too) and the pool fault this gun earned
        # against the PREVIOUS `$PSET` all describe a head that no longer exists.
        self._pool_faults.pop(p["player_id"], None); self._pool_ambers.pop(p["player_id"], None)
        if nid := p.get("node_id"):
            # R2-4: `pool_life_n` and `pool_life_hit` too -- the "first life of the match" the below-
            # config advisory is judged on is the first life under THIS head, and a fresh head is a
            # fresh count. (`push_config` is refused in armed/live, so this never renumbers a life
            # inside a running match.)
            for k in ("pool_life_t", "pool_life_judged", "pool_life_hit", "pool_life_n",
                      "pool_amber_pending"):
                self._node_view(nid).pop(k, None)

    def _send_config_to(self, p: Player) -> None:
        """The SEND half of `_push_config_to` (see `_compile_and_store`): push the bundle already
        stored for `p`. A no-op for a player with no node or no stored bundle."""
        nid = p.get("node_id")
        bundle = self.bundles.get(p["player_id"])
        if nid and bundle is not None:
            self.net.push(nid, "config", {"config": self._wire_config(), "frames": bundle, "roster": self.roster()})

    def _push_config_to(self, p: Player):
        self._compile_and_store(p)
        self._send_config_to(p)

    _ONE_TEAM_REFUSAL = "ONLY ONE SIDE HAS PLAYERS (NO HIT CAN REGISTER): MOVE PLAYERS BETWEEN TEAMS"

    def populated_tids(self) -> set[int]:
        """The distinct `$TID` values that actually have somebody rostered on them.

        `$TID` and not `team_id`, because the TID is what the gun reads: two config teams sharing one
        tid are ONE side on the field however they are named, and `_merge_config` does not (yet —
        Tier 1) refuse that shape."""
        by_team = {t["team_id"]: int(t["tid"]) for t in (self.config.get("teams") or []) if "tid" in t}
        return {by_team[t] for p in self.players.values() if (t := p.get("team_id")) in by_team}

    def one_team_fault(self) -> bool:
        """THE team-fault predicate — round-2 fix pass B, corrected by round-3 MERGE-0 (2026-09-13).

        `(declared teams >= 2) and (rostered players >= 2) and (populated $TIDs < 2)`. Defined ONCE
        and read by the push/start gate (`_refuse_one_team`), the readiness fault
        (`readiness()["roster_faults"]`), FIELD-1's rebalance trigger (`_reteam_for_config`) and the
        console's demo mirror (`webapp/mc/src/mock/backend.ts rosterFault`). Two rules for this could
        disagree, and the one place they would disagree is a match that scores nothing.

        Field cause: `set_config` used to re-team every player whose team the new mode does not have
        onto `teams[0]`, so switching a four-player FFA session to TDM put all four on BLUE. The gun
        refuses friendly damage, so such a match registers NOTHING for its whole length and says
        nothing about it — the worst kind of failure this console can ship. (FIELD-1 now re-teams by
        INDEX and rebalances, so the gate should fire far less often; it is still the backstop.)

        Round-3 MERGE-0 replaced "every declared team is populated", which was wrong twice:
          * TDM advertises 2–4 teams and the objective modes allow three, so a 2/2/0 over three
            declared sides PLAYS — and the old rule refused it unforceably.
          * `counts` was keyed by `team_id`, so two teams sharing one `$TID` both read "populated"
            and the gate PASSED a roster where no hit can register.

        Scoped on the TEAM COUNT rather than the mode name: `ffa` AND `lms` both declare the single
        `ffa` team, where sharing it is the design. `< 2` players: "one side" says nothing about a
        roster that holds one person — a solo session has nobody to shoot whatever the teams say, and
        single-player fixtures/bench sessions are an ordinary way to drive MC. Uneven is not a fault —
        1 v 3 plays, and full auto-balance is a later tier.

        Deliberately NOT bypassable by `force`, for `_refuse_push_in_play`'s reason: `force` overrides a
        READINESS judgement the operator can see and accept. This is a statement about what the field
        can physically do, and no amount of operator intent changes it.
        """
        if len(self.config.get("teams") or []) < 2 or len(self.players) < 2:
            return False
        if self.config.get("mode") == "ffa":
            # Belt: `default_config("ffa")` declares the single `ffa` team, so the team-count clause
            # above already covers it HERE — but the console's demo backend applies a bare `{mode}`
            # patch without rebuilding `teams`, and sharing the one team is the design in FFA however
            # many teams the config still carries. One predicate for both sides means both clauses.
            return False
        return len(self.populated_tids()) < 2

    def _one_team_fault(self) -> str | None:
        """The one predicate, worded for the operator. Never a second rule."""
        return self._ONE_TEAM_REFUSAL if self.one_team_fault() else None

    def _refuse_one_team(self) -> None:
        if fault := self._one_team_fault():
            raise ValueError(fault)

    def _refuse_stale_ack(self) -> None:
        """A36: no whistle while a gun is on record as holding a PREVIOUS head.

        Deliberately NOT bypassable by `force`, for `_refuse_push_in_play`'s reason. `force` is the
        operator's override of a READINESS judgement they can see and accept -- a phone that is off,
        a battery MC never read. This is not a judgement: it is the gun telling us, in its own
        words, which game it is running, and it is exactly the field failure of 2026-09-12 (guns ran
        a previous push in nearly every match and nothing on screen said so). RE-PUSH clears it in
        one click; dropping the player to STANDBY clears it too.
        """
        stale = [(self.players[pid].get("display") or pid, cid)
                 for pid in self.players if (cid := self._stale_ack_id(pid))]
        if stale:
            who = ", ".join(f"{d} (acked {c})" for d, c in stale)
            raise ValueError(
                f"{len(stale)} gun(s) last answered an OLDER config: {who}. The head they are holding "
                f"is not the game you are about to start — RE-PUSH the config (or move them to "
                f"STANDBY) before the whistle")

    _RE_PUSH_ON_LOBBY = "RE-PUSH CONFIG on LOBBY"

    def _refuse_echo_mismatch(self, force: bool = False) -> None:
        """R2-5: nor while a gun has answered THIS head with another weapon's magazine.

        A36's echo proof was red on the board and silent at the whistle. An echo
        mismatch leaves the ack CURRENT (it is this config's ack; it is the ECHO inside it that
        disagrees), so `all_acked()` was true and `start()` had nothing to refuse on -- while the
        board was telling the operator the gun is carrying last game's loadout.

        FORCEABLE, unlike `_refuse_stale_ack` (F3-lane iteration 3, 2026-09-13). The stale ack is
        the gun NAMING another game; this one rests on an INFERENCE we have never benched.
        `protocol/brx-protocol.md` records `$ALCD` as streaming one frame per round FIRED and one
        per round RELOADED, and `engine.js` latches the first slot-0 `$ALCD` of the 1.5 s window
        after the head write -- nobody has measured what a v4.32 gun actually emits there. If a
        `$WEAP` write makes it emit a RELOAD burst, the echo carries a partial magazine, every
        re-push reproduces that byte for byte, and a force-proof refusal would leave STANDBY as the
        only way to field that player. The refusal therefore names BOTH exits.

        TODO-FOLLOWUP: bench what a v4.32 gun emits in the 1.5 s after a `$WEAP` head write (a full
        magazine `$ALCD`, a reload burst, or nothing). That measurement decides whether this
        refusal can go back to being force-proof.

        `not_echoed` NEVER refuses: on our v4.32 units the ordinary answer to a head write is
        `$START`'s `$LCD` and nothing more (A37), so refusing on it would refuse every whistle in
        the field. The absence of a proof is not a fault.
        """
        if force:
            return
        bad = [(self.players[pid].get("display") or pid) for pid in self.players
               if self._echo_state(pid) == "mismatch"]
        if bad:
            raise ValueError(
                f"{len(bad)} gun(s) echoed a weapon this config did not compile: {', '.join(bad)}. "
                f"They answered this push holding another loadout — {self._RE_PUSH_ON_LOBBY}, or "
                f"HOST OVERRIDE if the gun keeps echoing the same magazine (the echo rule is "
                f"unbenched on this firmware)")

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
        if self.in_play():
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
        # A push after the whistle is for the NEXT match. The roll is the one side effect that may come
        # before a refusal below: the operator has already moved on, and the roll is what they asked for.
        self._roll_forward_from_recap()
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
                    f"{self.config.get('mode')} needs FULL coverage (every player's phone on cellular "
                    f"through the tunnel); {cov['on_cellular']} of {cov['bound']} bound phone(s) are", cov)
        # Round-2 B: read the BOARD, not `go` — `go` is now also false for a `roster_faults` entry,
        # which is a different refusal with its own (unforceable) wording further down. Gating the
        # override on `go` printed "readiness has reds — clear them before pushing" with an EMPTY list
        # for a one-team roster, and `force` then walked straight past the safety gate's own message.
        #
        # A37/F271: …minus the four proof prefixes that SAY "RE-PUSH" and are cured by
        # this very call (a fresh head clears the ack, the echo derived from it and the pool
        # judgement made against it), so counting them as reds in the push's own way left the
        # operator with `force` as the only exit from a state the board had just told them to leave.
        # `force` is the override of a judgement they can see and accept; this is not that. START is
        # untouched — `_refuse_stale_ack` refuses the whistle and `force` does not open it either.
        # F3 (iteration 3): `waiting` blocks the FIRST push only. A phone that has not arrived cannot
        # be handed a head it has never been offered one of -- that is the field rule of 2026-09-01 and
        # it still stands. But a RE-push is a different question: `lobby_pushed` is already True, this
        # roster has a compiled bundle per player (`_repush_lobby_config` loops the whole roster, not
        # the bound ones), and `_hydrate` hands the bundle over on the node's hello. So the head IS
        # delivered to the phone that is still walking to the field, and counting it as a blocker made
        # the ordinary re-push render on the console as the forcing variant -- "RE-PUSH CONFIG OVER 1
        # BLOCKED" -- because one operator had not switched their phone on yet.
        is_repush = self.lobby_pushed

        def _blocks_push(r) -> bool:
            if r["status"] == "waiting":
                return not is_repush              # first push only: no push reaches a phone that is not here
            return r["status"] == "red" and any(not cured_by_push(b) for b in r["blockers"])

        rows_blocked = any(_blocks_push(r) for r in rd["board"])
        if rows_blocked and not force:
            # R2-10 (polish loop iteration 2): NAME WHAT ACTUALLY BLOCKS. This listed the RED rows
            # only, so a roster held up solely by a phone that has never arrived -- the `waiting`
            # branch above, the commonest refusal of the whole muster -- printed "readiness has reds
            # ... : " and then nothing at all after the colon. An empty list is worse than no list:
            # it reads as a bug in MC rather than as a phone somebody has to go and switch on.
            waiting = [self.players[r["player_id"]].get("display") or r["sticker"]
                       for r in rd["board"] if _blocks_push(r) and r["status"] == "waiting"
                       and r["player_id"] in self.players]
            reds = [f"{r['player_num']}:{'/'.join(b for b in r['blockers'] if not cured_by_push(b))}"
                    for r in rd["board"] if r["status"] == "red" and _blocks_push(r)]
            parts = []
            if waiting:
                parts.append(f"{len(waiting)} phone(s) not arrived: " + ", ".join(waiting))
            if reds:
                parts.append("red: " + "; ".join(reds))
            raise ValueError("readiness blocks the push — clear it before pushing, or push with force: "
                             + " · ".join(parts))
        if rows_blocked:
            import logging
            logging.getLogger("brx.mc").warning(
                "FORCED push over %d red row(s): %s", sum(1 for r in rd["board"] if r["status"] == "red"),
                        "; ".join(f"{r['player_num']}:{'/'.join(r['blockers'])}"
                                  for r in rd["board"] if r["status"] == "red"))
        res = self._validate()
        if not res["ok"]:
            raise ValueError("config invalid: " + "; ".join(res["errors"]))
        # Round-2 B, AFTER `_validate()`: a config broken in its own right (F82's neutral team, a
        # missing objective source) has a more specific thing to say than "move somebody", and those
        # errors name the actual repair. This is the last gate before anything is sent.
        self._refuse_one_team()
        self.trying.clear()
        # R2-1 (polish loop iteration 2): a push onto an ALREADY-PUSHED lobby is a RE-PUSH, and it is
        # the same action `set_config` performs after an edit -- so it runs the SAME body. It had its
        # own inline version here, which bumped the game number (`_next_game_no`) for a game nobody
        # has started and re-derived "pushed" from scratch. Two bodies for one action is how the
        # console ended up with a button for only one of them: every new fault line says RE-PUSH, and
        # the only control that reached this path was labelled PUSH CONFIG & ARM, which disappears
        # the moment the first push lands. `repushed` is what lets the console say which one it did.
        if is_repush:
            # F6 (iteration 3): and it MINTS A FRESH `config_id`, exactly as the edit path does.
            # R2-1 kept the id on the grounds that a re-push is "the same head again" -- and that made
            # the re-push impossible to PROVE. `_repush_lobby_config` clears `acks`; an ack that was
            # already on the wire when it did lands a moment later carrying the SAME id, satisfies
            # `_ack_is_current`, and the board reads ACKED for a head that gun never took. That is the
            # exact failure A36 exists to catch, re-introduced by its own cure. With a fresh id the
            # in-flight ack is simply stale (the row says so, naming the old id) until the gun answers
            # the head it now holds, and the phone's own "start for a config I do not hold" check does
            # the same work on its side. No new wire field buys that.
            # ...the same operation a per-player recompile takes (`_fresh_head_repush`): fresh id,
            # fresh heads for everybody, acks/echo/pool judgements dropped.
            self.phase = "lobby"               # A58: before the re-push, which re-arms the stations with the LOAD lock
            self._fresh_head_repush()
            self._changed()
            return {"ok": True, "acks": self.acks, "repushed": True,
                    "config_id": self.config["config_id"]}
        self._next_game_no()
        # S56: compile everybody first, then send -- see `_repush_lobby_config`'s own note on why a
        # roster read (`hir`) needs every player's bundle to be the CURRENT one before any push goes out.
        for p in self.players.values():
            self._compile_and_store(p)
        for p in self.players.values():
            self._send_config_to(p)
        self.lobby_pushed = True
        self.phase = "lobby"
        self._stations_unlocked = False        # A58: the LOAD lock (`_station_lock_s` reads the phase set above)
        self.arm_stations()                    # A13.5: every assigned station learns this game's number
        self._changed()
        self.persist_now()                     # A59: a crash in the snapshot debounce must not lose the game_no bump
        return {"ok": True, "acks": self.acks, "repushed": False,
                "config_id": self.config["config_id"]}

    # ---------- A36: is the ack we are holding an ack for the config we are about to start? ----------
    def _ack_is_current(self, pid: str) -> bool:
        """An ack proves the CURRENT head or it proves nothing.

        An ack with no `config_id` at all is NOT current. Every app that has ever shipped sends one
        (`envelope.REQUIRED["ack_config"]` has required it since the wire existed) and MC's own fakes
        send one, so the only way to reach this is a hand-built body -- and "I could not tell you
        which game I took" must never read as "I took yours"."""
        ack = self.acks.get(pid) or {}
        return bool(ack.get("ok") and ack.get("gun_echo")
                    and ack.get("config_id") == self.config.get("config_id"))

    def _stale_ack_id(self, pid: str) -> str | None:
        """The PREVIOUS `config_id` this player's gun answered for, when that is what it answered for.

        Only for an ack that is otherwise good (ok + an echo): a `{ok: false}` ack is already the
        board's "GUN DID NOT ANSWER CONFIG" and saying both about one row helps nobody."""
        ack = self.acks.get(pid) or {}
        if not (ack.get("ok") and ack.get("gun_echo")):
            return None
        cid = ack.get("config_id")
        return str(cid) if cid and cid != self.config.get("config_id") else None

    def _echo_fault(self, pid: str) -> str | None:
        """A36: does the gun's own answer to the head match the WEAPON that head wrote?

        `gun_echo` was only ever tested for truthiness. It is the gun repeating back the magazine it
        was just given (`$ALCD,<mag>,<acc>,<slot>,<reserve>,<heat>,*`), and comparing it to the
        `$WEAP,0` frame in the bundle MC pushed is the cheapest proof that the write landed -- a gun
        still on last game's loadout echoes last game's magazine.

        Silent (None) whenever the echo is not a slot-0 `$ALCD`, or the head carries no readable
        `$WEAP,0`. `$START` answers the head with `$LCD,0,0,0,0,0,0,*`, which proves the gun answered
        and says nothing about ammo, and an older app reports exactly that -- so "no evidence" has to
        stay quiet. `test_mc_config_proof` pins both halves so this can never quietly become a check
        that only ever reads its own artefact.

        A37: gated on `_ack_is_current`, not on `ack.ok` alone. The echo is DERIVED FROM the ack, so
        an ack that answered a previous head carries a previous head's magazine: reading it as a
        weapon mismatch printed two reds for one cause, and only one of them named the cause.
        """
        if self._echo_state(pid) != "mismatch":
            return None
        ack = self.acks.get(pid) or {}
        got = _frames.alcd_ammo(ack.get("gun_echo"))
        want = _frames.head_spawn_ammo((self.bundles.get(pid) or {}).get("head"))
        assert got is not None and want is not None      # `_echo_state` only says "mismatch" for these
        return (f"{_ECHO_FAULT} (WEAPON {got[0]}/{got[1]} ECHOED, {want[0]}/{want[1]} "
                f"EXPECTED, MAG/RESERVE): RE-PUSH")

    def _echo_state(self, pid: str) -> Literal["proven", "mismatch", "not_echoed"] | None:
        """A37: `"proven"` / `"mismatch"` / `"not_echoed"`, or None when there is no check to report.

        THREE states, because the field has three. `protocol/brx-protocol.md` records the `$WEAP`
        echo as "never seen from our v4.32 units" and `$ALCD` as streaming on AMMO EVENTS only, so
        the ordinary answer to a head write on a real gun is `$START`'s `$LCD,0,0,0,0,0,0,*` and
        nothing more. Under the two-state reading that is "no fault", which on a board full of green
        rows says the weapon check PASSED -- a check that cannot fail, dressed as a proof. It now
        says out loud that it did not run, and the console paints it neutral rather than green.

        None (no check at all) when nothing has been pushed, when no ack has come back, when the ack
        answered ANOTHER head (`ACKED AN OLDER CONFIG` owns that row, `_echo_fault`'s A37 note), or
        when the head carries no readable `$WEAP,0` -- a stub compiler leaves nothing to compare, and
        that is a fact about MC, not about the gun.
        """
        if not self.lobby_pushed or not self._ack_is_current(pid):
            return None
        want = _frames.head_spawn_ammo((self.bundles.get(pid) or {}).get("head"))
        if want is None:
            return None
        got = _frames.alcd_ammo((self.acks.get(pid) or {}).get("gun_echo"))
        if got is None:
            return "not_echoed"
        return "proven" if got == want else "mismatch"

    def _gun_config_fault(self, pid: str) -> str | None:
        """F271: compare `$QUERY` read-back with the actual effective `$PSET`/`$TID` push."""
        if not self._ack_is_current(pid):
            return None
        got = (self.acks.get(pid) or {}).get("gun_config")
        if not isinstance(got, dict):
            return None
        want = _frames.head_gun_config((self.bundles.get(pid) or {}).get("head"))
        if want is None:
            return None
        differences = [f"{key.upper()} {got.get(key)} READ BACK, {want[key]} PUSHED"
                       for key in ("player_id", "team", "hp", "armor", "shield")
                       if got.get(key) != want[key]]
        if not differences:
            return None
        return f"{_GUN_CONFIG_FAULT} ({'; '.join(differences)}): RE-PUSH"

    def _refuse_gun_config_mismatch(self) -> None:
        bad = [(self.players[pid].get("display") or pid, fault)
               for pid in self.players if (fault := self._gun_config_fault(pid))]
        if bad:
            who = "; ".join(f"{display}: {fault}" for display, fault in bad)
            raise ValueError(f"Gun config read-back does not match the pushed head: {who}")

    def all_acked(self) -> bool:
        return bool(self.players) and all(
            self._ack_is_current(p["player_id"])
            for p in self.players.values() if p.get("node_id"))

    # ---------- start ----------
    def _start_body(self) -> dict:
        s = self.start_info
        if s is None:
            # Unreachable today: every caller is inside `if self.start_info`, and `_schedule` writes it
            # one statement before broadcasting. Said out loud so it stays that way.
            raise ConflictError("no match is scheduled — there is no start to send")
        return {"match_id": s["match_id"], "go_live_t": s["go_live_t"], "config_id": self.config["config_id"],
                "seq": s["seq"], "countdown_s": s["countdown_s"]}

    def _refuse_incompatible_app(self) -> None:
        """F121 compat (polish review, added after the merge): never start a match with a bound node
        MC knows cannot run it.

        `push_config`'s readiness board already reds a node whose `app_ver` it has SEEN by push time --
        but a node with no hello yet reads as WAITING FOR THE PHONE, the readiness board's single
        commonest row, and `push_config` is routinely forced past that (it must be: the whole point of
        a first push is to reach a phone that has not arrived). A phone that then connects between the
        push and the whistle, on an app below the tier, was never version-checked at all. An app that
        old never sends F121's `$TMP` off frame (`spawn_protect_off`), so its player would take no
        damage for the rest of that life — invisibly, since nothing on the gun says so.

        An UNPARSABLE version is amber on the readiness board (A1: amber never blocks a push), but it
        is not a version `compatible()` can vouch for either, so a bound node that has said hello with
        one blocks the START GATE here even though it leaves the board amber (polish review #2,
        2026-09-18): the board's amber wording is for the operator weighing a push; the whistle needs a
        yes/no.

        Deliberately NOT bypassable by `force`, for `_refuse_stale_ack`'s reason: this is a fact the
        node's own hello carries, not a readiness judgement the operator can see and weigh."""
        bad = [(self.players[pid].get("display") or pid, nv.get("app_ver"))
               for pid, p in self.players.items()
               if (nid := p.get("node_id")) and (nv := self.nodes.get(nid))
               and compatible(nv.get("app_ver")) is not True]
        if bad:
            who = ", ".join(f"{d} (app {v})" if v else f"{d} (app version unknown)" for d, v in bad)
            raise ValueError(
                f"{len(bad)} gun(s) are running an app MC cannot start a match with: {who}. An app not "
                f"on {app_tier()} never ends spawn protection (F121) — its player would take no damage "
                f"all life. UPDATE THE APP before the whistle")
        feature_bad = [(self.players[pid].get("display") or pid, blockers)
                       for pid, p in self.players.items()
                       if (nid := p.get("node_id")) and (nv := self.nodes.get(nid))
                       and (blockers := self._weapon_app_blockers(nv))]
        if feature_bad:
            who = "; ".join(f"{display}: {', '.join(blockers)}" for display, blockers in feature_bad)
            raise ValueError(f"phone app update required before this weapon can play: {who}")

    def start(self, runway_s: int | None = None, force: bool = False) -> dict:
        if not self.lobby_pushed:
            raise ValueError("push config first")
        self._refuse_one_team()           # round-2 B: a team can empty out between the push and the whistle
        self._refuse_stale_ack()          # A36: and a gun can answer for LAST game's head at any moment
        self._refuse_incompatible_app()   # F121: and a gun can arrive on an old app at any moment too
        self._refuse_gun_config_mismatch() # F271: direct gun read-back is force-proof like a stale ack
        self._refuse_echo_mismatch(force)  # R2-5: ...or answer THIS head carrying another weapon (F2: forceable)
        # ...or never have answered at all. `all_acked()` below skips a player with no node bound, so
        # ABSENCE was invisible to it; LOAD makes that reachable in a new way (a phone can hold the
        # game while its gun has no head), which is why this gate arrives with it.
        self._refuse_unconfigured_gun(force)
        if not self.all_acked() and not force:
            raise ValueError("not every node has acked the config with a gun echo")
        return self._schedule(runway_s or DEFAULT_RUNWAY_S)

    def _schedule(self, runway_s: int) -> dict:
        self.start_seq += 1
        self._game_no_started = True           # the next muster push is a NEW match to every station
        self._range_epoch += 1                 # A67: the last match's range-edit lines clear at this START
        now = self.now_ms()
        # A42: whether the LAST match's end reached every HUD is not a fact about THIS one. The operator
        # has moved on, and a straggler line left standing over a live board would be read as this match's.
        self._end_delivery, self._end_delivery_told = {}, None
        self._departed_match_stations = {}
        self.start_info = {"match_id": uuid.uuid4().hex[:10], "go_live_t": now + runway_s * 1000,
                           "seq": self.start_seq, "countdown_s": runway_s}
        self._scheduled_ids.add(self.start_info["match_id"])
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
        for nv in self.nodes.values():
            nv.pop("protect_owed", None)       # F289: a window owed in the last match is not this one's
        # A24/M2: the roster AS IT GOES IN. `_replay` builds its Scorer from this, never from the live
        # dict, so a re-team made after the whistle cannot re-play the match on teams nobody wore.
        self._match_players = {pid: p.copy() for pid, p in self.players.items()}
        self._match_nodes = dict(self.node_player)
        # A25: the ~1 MB pulled-log budget is PER MATCH, not per session. It was never reset, so after
        # three or four matches of logs every node was over it and the recap ask stopped going out --
        # silently, on the match most likely to be the one worth debugging.
        self._log_bytes = {}
        self._log_asked = set()
        self._log_inflight = set()
        self._pending_limit_t = None           # a new match owes nothing to the last one's cap
        self._result_pushed = {}               # A24: nor to the last one's result
        self.end_reason = None
        self.feed = []
        # The delivery loop below must restate any WITHHELD phone after this feed reset. Keeping the
        # old dedupe keys erased the only operator-visible explanation on a reschedule.
        self._app_blocked_alerted.clear()
        self._plan_blocked_alerted.clear()
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
        # A40 (T2 review S2): ADDRESSED, not broadcast. `net.broadcast()` reaches every live socket, and
        # that included a BENCHED phone -- which still holds the frames it took before the bench, so its
        # `config_id` matched, `startAt` carried it armed -> live, and the gun SPAWNED at T-0 for a player
        # who is not in `_match_players` and therefore not in the scorer at all. Utility nodes are skipped
        # for the reason `abort_start` already skips them: a station never held this start.
        start_body = self._start_body()
        parked_nodes = self._standby_node_ids()
        for nid, nv in list(self.nodes.items()):
            if nv.get("node_type") == "utility" or nid in parked_nodes:
                continue
            # F121: an incompatible app never took a `config` that can turn spawn protection off, so
            # a `start` here would arm it invulnerable. `_bind`'s hot join already said WITHHELD.
            pid = self.node_player.get(nid)
            player = self.players.get(pid or "")
            # Address only the phone currently bound to a roster slot. A hot-swap leaves the old
            # socket connected and it may still hold this config; starting that stale holder creates
            # an unscored duplicate player and can bypass a replacement phone's app-version gate.
            if player is None or self._hot_join_withheld(player, nid):
                continue
            self.net.push(nid, "start", start_body)
        self.phase = "armed"
        self._stations_unlocked = False
        self.arm_stations(relock=True)                    # A58: the exact lock, to every station still connected (held)
        self._role_due = []                    # a reschedule re-queues from scratch
        self._queue_roles_for_live()
        self._changed()
        self.persist_now()                     # bench 2026-09-17: a crash one second in still resumes this match
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
        # A utility station takes no player start. The same-game station_config clears a Stick hill clock.
        for nid, nv in list(self.nodes.items()):
            if nv.get("node_type") != "utility":
                self.net.push(nid, "control", {"cmd": "abort_start", "seq": self.start_info["seq"]})
        self._record_ended(self.start_info.get("match_id"), None, self._match_players)   # A34: a node that missed the abort
        self.start_info = None
        self.scorer = None
        # F106(a): no match ran on this game number, so the NEXT muster push must not treat it as a new
        # match (`_next_game_no` bumps only when `_game_no_started` is True -- an abort must not leave it
        # set, or the following push silently skips a game number and re-arms every station for nothing).
        self._game_no_started = False
        self.phase = "lobby"
        self._stations_unlocked = True         # A58: the whistle never blew; the next START locks them again
        self.arm_stations(relock=True)
        self._changed()
        self.persist_now()
        return {"ok": True, "reached": reached, "unreachable": unreachable}

    def mc_confidence(self) -> McConfidence:
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
        elif scope in ({p.get("team_id") for p in self.players.values()}
                       | ({st.team_id for st in self.scorer.stats.values()} if self.scorer else set())):
            def current_team(p: Player) -> str | None:
                stat = self.scorer.stats.get(p["player_id"]) if self.scorer else None
                return stat.team_id if stat else p.get("team_id")
            targets = [p for p in self.players.values() if current_team(p) == scope]
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
        if not p or not p.get("node_id") or not self.in_play():
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
        if body.get("kind") == "kill" and self.phase == "recap":
            return      # F357: no kill confirm after the whistle, any end (the Scorer gates it too: `_before_whistle`)
        p = self.players.get(pid)
        if p and p.get("node_id"):
            cues = (self.bundles.get(pid) or {}).get("cues") or {}
            kind = body.get("kind")
            if isinstance(kind, str) and (cue := cues.get(kind)):
                body = {**body, "cue": cue}   # A6.3: a full $PLAY frame
            body.setdefault("player_id", pid)                # envelope requires it; a node silently DROPS a feedback without it
            self.net.push(p["node_id"], "feedback", body)

    def _relay_hit_feedback(self, shooter_pid: str | None, victim_pid: str, dmg: int, t: int,
                             weapon_id: str | None = None, shot_group: int | str | None = None) -> None:
        """S56 ("what hit me"): tell the SHOOTER's own node the damage it just dealt, relaying the
        VICTIM's own `hit_taken` fact, so the shooter can book it as damage dealt. The shooter's own gun
        hears nothing of a hit it lands, so this relay is its only source; it may be late, or never come. The
        same best-effort contract as the existing "kill" feedback (`scoring.Scorer._death`, also
        relayed through `_feedback`): no queue, no retry -- a shooter with no socket simply misses it.

        LIVE only. Callers pass a hit ONLY from `Scorer.hits_log`'s own growth (`_on_event`,
        `ingest_batch`), which is already exactly "a genuinely new fact": never a duplicate seq,
        never parked onto another match, never past the A6.1 end freeze, and never a fact replayed
        while reconstructing a scorer (a replay's callbacks are wired up only AFTER the replay loop,
        so nothing here runs during one). `victim_pid == shooter_pid` (a self-inflicted `$HIR`, e.g.
        a grenade) never relays -- there is no THIRD party to tell."""
        if self.phase != "live" or not shooter_pid or shooter_pid == victim_pid:
            return
        vp = self.players.get(victim_pid) or {}
        body: dict = {"kind": "hit", "t": t, "victim": victim_pid, "victim_num": vp.get("player_num"),
                      "victim_display": vp.get("display"), "dmg": dmg}
        if weapon_id:
            body["weapon_id"] = weapon_id
        if shot_group is not None:
            body["shot_group"] = shot_group   # a two-word shot is two facts; the shooter counts it once by this
        self._feedback(shooter_pid, body)

    def _relay_batch_hits(self, new_hits: list[tuple[int, str, str, int]]) -> None:
        """S56: relay every hit `Scorer.ingest_batch` just newly scored (`new_hits`, a slice of
        `hits_log` -- see `_relay_hit_feedback`). No `weapon_id` here: `ingest_batch` sorts events by
        `t` before scoring them, so pairing one `hits_log` entry back to the wire event that produced
        it is not reliable across a whole batch. The single-fact path (`_on_event`) is where a
        `weapon_id` actually gets attached; a batched hit still relays, just without naming the gun.
        `shot_group` is also dropped here for the same reason, so the phone falls back to its own
        `DUAL_RELAY_MS` heuristic to tell a two-word shot from two separate hits."""
        for t, shooter, victim, dmg in new_hits:
            self._relay_hit_feedback(shooter, victim, dmg, t)

    def _on_feed(self, entry: dict):
        self.feed.insert(0, entry)
        del self.feed[200:]
        self._persist_dirty = True      # F319 (d): the feed is in the snapshot, so a feed-only change must flush too
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
        # The match this `end` is about. `start_info` is cleared by `_finish()`, so in RECAP -- where the
        # operator's SECOND end lands, the manual retry for a phone they can see did not stop -- it is
        # `_log_match` that names the match that just ended. Without this fallback that press carried no
        # `match_id` at all: nothing armed, nothing counted, and the try counter the operator is reading
        # never moved for the one delivery they made by hand. (A34's node rule makes the name safe: a phone
        # holding a different match ignores it, and A42's whole point is that an end may only ever stop the
        # match it names.)
        mid = (self.start_info or {}).get("match_id") or (self._log_match if self.phase == "recap" else None)
        # A42: the operator's END now NAMES its match. A34 gave `control{end}` an optional `match_id` and
        # taught the node to ignore an end naming a match it is not playing; the operator's end never
        # carried one, so re-delivering it would have been a blunt instrument able to stop a LATER match.
        # RECALL and PANIC stay deliberately unnamed: they are the stop-everything hammer, and a phone
        # running a match MC has lost track of is exactly what the operator reaches for them for.
        body = {"cmd": cmd, **({"match_id": mid} if cmd == "end" and mid else {})}
        bound_nodes = {p["node_id"] for p in self.players.values() if p.get("node_id")}
        if cmd == "end" and mid:
            self._arm_end_delivery(mid)
        reached = 0
        for nid, nv in list(self.nodes.items()):
            if nv.get("node_type") == "utility":
                continue
            ok = self.net.push(nid, "control", body)
            if nid in bound_nodes and ok is not False:
                reached += 1
            if cmd == "end" and mid and nid in bound_nodes:
                self._end_delivery_tried(nid, mid, ok is not False)
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
            if self.scorer is not None:                  # an END with no scorer already returned above
                self.scorer.set_end(self.now_ms())       # A6.1 end freeze
            self.end_reason = "host"                     # A24/M2: a whistle is a moment; it never moves
            self._finish()
        else:                                            # recall/panic stop a live game → KITTED (A5.9)
            self._record_ended((self.start_info or {}).get("match_id"), None, self._match_players)   # A34
            self.start_info = None
            self.scorer = None
            self.lobby_pushed = False
            self.acks = {}
            self.phase = "kit"
            self.arm_stations(relock=True)                          # A58: lock_s 0 (END's is in `_finish`)
        self._changed()
        self.persist_now()                               # the snapshot must stop naming a match that ended
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
        if not self.scorer or not self.in_play():
            return
        if self.is_adopted():
            # F-2026-09-17c: MC holds no config for an adopted match, so `frag_limit` here is the
            # operator's CURRENT DRAFT, not the number the phones are actually playing to. Never end
            # the phones' match on a cap MC cannot confirm is theirs.
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
        if not self.scorer or not self.in_play():
            return
        cap, t_match_s = self.scorer.frag_limit, max(0, (t - self.scorer.go_live_t) // 1000)
        reached = self._broadcast_control("end")
        bound = sum(1 for p in self.players.values() if p.get("node_id"))
        self.scorer.set_end(t)
        if self.scorer.cap_recv is None:     # F356: the whistle's arrival moment; keep the first
            self.scorer.cap_recv = self.now_ms()
        self.end_reason = "frag_limit"       # A24/M2: THE one end a later fact can move (an earlier cap kill)
        self._finish()
        # One line, after the fact, saying what actually happened — the same honesty rule `control`
        # now follows. A node MC could not reach ends on its own time limit, so the operator needs
        # to see that this END was partial while they are still standing on the field.
        self._on_feed({"t_match_s": t_match_s, "tag": "ALERT" if reached >= bound else "WITHHELD", "kind": "alert",
                       "text": f"FRAG LIMIT {cap} REACHED — MATCH OVER · END REACHED {reached} OF {bound} NODE(S)"})
        self._changed()

    def _push_victory(self, recap: RecapView | None) -> None:
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
        self._match_players = {pid: p.copy() for pid, p in self.players.items()}
        # F206: freeze the station rows HERE, at the whistle -- a late fact for THIS match must recap
        # against what the stations reported at end of match, not whatever the NEXT match's stations
        # say by the time that late fact lands (`_ingest_retired`).
        self._match_stations = self._recap_stations() if self.scorer else None
        self._match_end_t = self.scorer.end_t if self.scorer else None   # F401
        self._sync_pending = {r["node_id"]: f"{_STATION_KIND_LABEL.get(r['kind'], r['kind'].upper())} {r['id']}"
                              for r in self._match_stations or [] if r.get("node_id")}
        self.last_recap = self._scorer_recap(self.scorer, self._match_stations) if self.scorer else None
        self._record_ended(self._log_match, self.last_recap, self._match_players)   # A34: what a late phone is told
        # A42: watch for every bound HUD to confirm this end. Here rather than only in `_broadcast_control`
        # because the TIMED end pushes no `control` at all — every phone ends on its own clock — and that
        # is precisely the end where the operator has least to go on about the one phone that did not.
        self._arm_end_delivery(self._log_match)
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
        # ...and the ANNOUNCED game goes with the pushed one. A finished match is not a loaded game:
        # the GAMES tab keys its ACTIVE GAME CONFIG state on `game_loaded`, so leaving it true would
        # strand the operator on the last match's settings instead of the card picker. The next match
        # starts from RECAP's NEXT MATCH, or from any GAMES action (`_roll_forward_from_recap`). RECALL is
        # deliberately NOT this: it returns the field to KIT with the same game still loaded.
        self.game_loaded = False
        self.game_cfg = None
        self.game_sent = {}
        self._game_retry_t = {}
        self.acks = {}
        # A32: `acks` is what turns the echo into a red "GUN DID NOT ANSWER CONFIG" for the NEXT lobby,
        # so the proof it set resets with it -- otherwise a gun whose headset died in the debrief reads
        # PROVEN through the whole next muster on an echo from the match before.
        for _nv in self.nodes.values():
            _nv.pop("headset", None)
        for p in self.players.values():
            p["ready"] = False
        self.arm_stations(relock=True)               # A58: lock_s 0 to every station still connected
        self._validate()                  # F401: config_warnings must carry the fresh sync warning at once
        self._changed()
        self.persist_now()                # the snapshot must stop naming a match that ended

    def tick(self) -> None:
        """Call periodically (≥1 Hz): armed→live at go_live_t; live→recap at the timed end (+5 s grace)."""
        if self._resume_pending is not None:
            self.resume_match()       # `__main__` resumes once the store attaches; this is the fallback
        self._flush_pending_limit()   # last resort: a cap deferred mid-batch ends even if no fact follows
        # A42 — ABOVE the `start_info` gate on purpose: `_finish()` clears `start_info`, and RECAP is the
        # only phase an end re-delivery ever runs in. Below the gate it would be dead code.
        self._retry_end_delivery(self.now_ms())
        if not self.start_info:
            return
        now = self.now_ms()
        if self.phase == "armed" and self._promote_phase(self.start_info["go_live_t"], now) == "live":
            self._changed()
        self._push_due_roles(now)
        self._powerup_tick(now)                     # A56: the item spawn schedule (a no-op with the flag off)
        self._operator_no_answer(now)
        tl = self.config.get("time_limit_s")
        # F-2026-09-17c: an ADOPTED match has no config of its own at MC — `tl` is the operator's CURRENT
        # DRAFT, which need not match what the phones are actually running. Arming a timed end on it can
        # cut a running match short, so MC never ends an adopted match on the clock; the phones end
        # themselves, or the operator presses END.
        if (self.phase == "live" and tl and not self.is_adopted()
                and now >= self.start_info["go_live_t"] + tl * 1000 + 5000):
            self.end_reason = "time"         # A6.1: the clock every phone ran; it is not re-derived
            self._finish()

    def recap(self) -> RecapView | None:
        if self.scorer:
            self._mark_flushed_live()
            # F206: in RECAP the stations must be the rows frozen at the whistle, not whatever the
            # (possibly re-armed) stations report right now (`_restore_recap` has the same fix).
            stations = self._match_stations if self.phase == "recap" else None
            r = self._scorer_recap(self.scorer, stations)             # A6: live recap gets the row too, not just the final one
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
                    and self.nodes.get(p["node_id"] or "", {}).get("last_seen_ms", 0) < end_t]
        return {"settling": bool(awaiting), "awaiting": awaiting, "since_end_ms": now - end_t}

    def _roll_forward_from_recap(self) -> bool:
        """In RECAP, start the next match: roster kept, config kept (same mode and settings).

        Tony, 2026-09-16: "why? just make a new one". MC rolls on the operator's FIRST action for the next
        match (NEXT MATCH, a config edit, LOAD, a push, a phase move), never at the whistle itself. The
        debrief keeps everything it reads while nobody has moved on, and a roll hides nothing that must
        outlive it: `new_session` keeps the finished scorer for late facts and the A42 end watch."""
        if self.phase != "recap":
            return False
        self.new_session(keep_roster=True)
        return True

    def next_match(self) -> dict:
        """`POST /api/match/next`: RECAP's NEXT MATCH. Roll forward, then LOAD the same game, so the operator
        lands on GAMES with the game loaded and one tap from KIT. LOAD's own rule (it never writes a gun,
        and it keeps the operator on GAMES) is unchanged."""
        if self.in_play():
            raise ConflictError(f"the match is {self.phase.upper()} — END it before starting the next one")
        self._roll_forward_from_recap()
        return self.load_game()

    def _retire_scorer(self) -> None:
        """Keep the finished scorer for late facts, with every callback muted: a fact for an old match
        must never cue a gun, write the new match's feed, raise an alert or end anything."""
        sc = self.scorer
        if sc is None:
            return
        sc.on_feed = lambda e: None
        sc.on_alert = lambda kind, scope, extra: None
        sc.on_feedback = lambda pid, body: None
        sc.on_limit = lambda t: None
        self._retired_scorer = sc
        self._retired_stations = self._match_stations   # F206: this match's frozen rows, not the next one's

    def _ingest_retired(self, nid: str, events: list[Event], t_recv: int) -> None:
        """A late fact for the match the operator rolled past goes to THAT match's recap (2026-09-16).

        The fact is already in the store under its own match_id (`_log`). This re-takes the finished
        recap, rewrites its archive row (the RECAP history picker) and the A34 ledger (what a late phone
        is told). The field is not re-told: every phone was sent the new match's `assign` at the roll.
        A frag-cap END cannot move any more (A24/M2 `_reconcile_end` runs in RECAP only)."""
        sc = self._retired_scorer
        if sc is None or sc is self.scorer:
            return
        mid = sc.match_id
        moved = False
        for ev in events:
            if isinstance(ev, dict) and ev.get("match_id") == mid:
                moved = sc.ingest(nid, cast(Event, dict(ev)), t_recv, seq=ev.get("seq")) not in ("dup", "ignored", "parked") or moved
        if not moved:
            return
        try:
            recap = self._scorer_recap(sc, self._retired_stations)
            if mid in self._ended:
                self._ended[mid]["recap"] = recap
            if self.store:
                self.store.match_ended(mid, recap)
        except Exception:
            import logging
            logging.getLogger("brx.mc").exception("late-fact re-store for a retired match failed (play continues)")
        self._changed()

    def new_session(self, keep_roster: bool = True) -> None:
        if self.start_info and self.in_play():
            self._record_ended(self.start_info.get("match_id"), None, self._match_players)   # A34
        # 2026-09-16: leaving a finished match with the roster kept is the NEXT MATCH, and the finished
        # match is still being delivered: late facts (`_ingest_retired`), the A42 end watch and the A34
        # re-tell ledger all carry across. A FRESH SESSION drops them, as before.
        rolling = keep_roster and self.phase == "recap"
        if rolling:
            self._retire_scorer()
        else:
            self._retired_scorer = None
            self._retired_stations = None
            self._match_nodes = {}
        self.session_id = uuid.uuid4().hex[:8]
        self.phase = "muster"
        self.start_info = None
        self.lobby_pushed = False              # F337 (d): before the re-send, or a pushed game would keep the lock
        self.arm_stations(relock=True)         # A58: a new session ends any match: lock_s 0
        self.scorer = None
        self.last_recap = None
        self.end_reason = None
        self._score_pushed = {}
        self._result_pushed = {}
        self._departed_match_stations = {}
        self.feed = []
        self.lobby_pushed = False
        self.game_loaded = False          # ...and the announced game goes with it
        self.game_cfg = None
        self.game_sent = {}
        self._game_retry_t = {}
        self.acks = {}
        self.bundles = {}
        self._head_sent_t = {}
        # A36 — RECAP → NEXT MATCH is a DETERMINISTIC RESET. Nothing about the last game may be
        # carried into this one, and with `lobby_pushed` false above, `start()` refuses until a FULL
        # fresh head has been pushed to every gun (`_resend`'s config leg is gated on the same flag,
        # so there is no incremental path back in either). `_pinned_hit_plan` in particular used to
        # survive: it is cleared in `push_config`, which made the invariant true by luck rather than
        # by statement, and one caller compiling before that would have re-used the last match's
        # plan (A17: a rekeyed cell on one gun with no row on another drops those hits in silence).
        self._pinned_hit_plan = None
        self._repush_pending = False
        self._pool_faults = {}
        self._pool_ambers = {}
        for nv in self.nodes.values():
            for k in ("pool_life_t", "pool_life_judged", "pool_life_hit", "pool_life_n",
                      "pool_amber_pending", "config_id"):
                nv.pop(k, None)
        self.trying = {}
        self.browsing = {}
        self.synced_at_lobby = {}
        # A34: who we have already told to END. Never pruned and never cleared, an entry from the last
        # session could suppress a legitimate reconcile in this one -- and a phone still out on the field
        # holding the old match is exactly the case a NEW session is most likely to meet.
        #
        # 2026-09-16: except on a roll. A roll can come seconds after the whistle, and clearing the ledger
        # there would make the heartbeat re-tell and the A42 retry push in the same breath.
        if not rolling:
            self._stale_told = {}
            # A42: a new session ends the last watch. A ROLL does not: `_schedule` ends it at the next
            # START, the same as a match that never left RECAP, and the ~137 s ladder is often still going.
            self._end_delivery, self._end_delivery_told = {}, None
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
            self.standby = {}
            self.node_player = {}
            for nv in self.nodes.values():
                nv.pop("player_id", None)
            self.restored_from = None      # F142: FRESH SESSION is the answer to the restore notice
            # F364: a fresh session hands ids out from 1 again; a station still assigned keeps its own.
            self._station_id_of = {n: a["id"] for n, st in self.stations.items() if (a := st.get("assigned"))}
        self._changed()
        if keep_roster:
            self.persist_now()                       # roster survives a crash right after NEW MATCH
        elif self._persist_path:
            self._persist_dirty = False              # nothing to flush — and remove the file LAST so
            try: self._persist_path.unlink(missing_ok=True)   # our own _changed can't resurrect it
            except Exception: pass

    # ---------- snapshot ----------
    def _live_view(self, now: int) -> LiveView | None:
        if not self.scorer or self.phase not in ("armed", "live", "recap"):
            return None
        time_limit_s = self.config.get("time_limit_s")
        if time_limit_s is None:
            raise RuntimeError("active scorer has no time limit")
        view: LiveView = {"match_id": self.scorer.match_id, "go_live_t": self.scorer.go_live_t,
                          "time_limit_s": time_limit_s, "ends_t": self.scorer.go_live_t + time_limit_s * 1000,
                          "score": self.scorer.team_scores(),
                          "rows": self._with_operator(self._with_pool_stale(self.scorer.live_rows(
                              now, {nid: nv.get("last_seen_ms", 0) for nid, nv in self.nodes.items()})),
                              self.scorer.match_id)}
        if self.phase == "live" and self.is_adopted() and self._phones_ended(self.scorer.match_id):
            view["phones_ended"] = True
        # Visual QA H2 (2026-09-23): an objective match is won on possession, so the board needs the
        # tally the recap already has. Read-only, and absent until a node reports one.
        if (poss := self.scorer.possession()) is not None:
            view["possession"] = poss
        return view

    def _note_protect(self, nid: str, events: list[Event]) -> None:
        """F289 (Tony, 2026-09-23): a `respawn` or infection `team_change` fact with `protect_ms > 0`
        says the phone armed spawn protection and owes the write that ends it. Only the phone lifts it,
        so a phone that dies inside the window leaves the gun unhittable. Facts go out at once, so MC
        learns of the window even when no status follows. A later status restates the truth either way:
        a replayed batch only reaches MC from a phone that is back, and its next heartbeat corrects this."""
        mid = self.scorer.match_id if self.scorer else None
        for ev in events:
            ms = ev.get("protect_ms")
            if (ev.get("type") in ("respawn", "team_change") and mid and ev.get("match_id") == mid
                    and isinstance(ms, int) and not isinstance(ms, bool) and ms > 0):
                self._node_view(nid)["protect_owed"] = True

    def _with_pool_stale(self, rows: list[LiveRow]) -> list[LiveRow]:
        """F208: stamp each LIVE row with its node's `pool_stale` claim, only while the node makes one.
        F264: also stamps `cure`, the node's own outcome, the same way.
        F272: stamps the positive `gun_locked` verdict; absence remains absent for older clients.
        F289: stamps `possibly_protected` on a stale row whose phone still owed the end of protection."""
        pid_node = {pid: nid for nid, pid in self.node_player.items()}
        for row in rows:
            nv = self.nodes.get(pid_node.get(row["player_id"], ""), {})
            if nv.get("pool_stale"):                     # `_on_status` keeps only a valid claim
                row["pool_stale"] = nv["pool_stale"]
                if "pool_stale_ms" in nv:
                    row["pool_stale_ms"] = nv["pool_stale_ms"]
            if nv.get("cure"):                            # F264: same gate, `_on_status` keeps only a valid claim
                row["cure"] = nv["cure"]
            if nv.get("gun_locked") is True:               # F272: strict true-only gate from `_on_status`
                row["gun_locked"] = True
            # F289: only for a phone MC can no longer hear. A connected phone ends its own protection
            # within seconds, so flagging it would cry wolf on every respawn.
            if row["status"] == "stale" and nv.get("protect_owed") is True:
                row["possibly_protected"] = True
        return rows

    def _start_view(self, now: int) -> StartView | None:
        if not self.start_info:
            return None
        per_node: dict[str, StartNodeView] = {}
        for nid, pid in self.node_player.items():
            nv = self.nodes.get(nid, {})
            raw_arm_state = nv.get("arm_state")
            arm_state = raw_arm_state if is_arm_state(raw_arm_state) else "idle"
            raw_t_minus = nv.get("t_minus_ms")
            per_node[pid] = {"arm_state": arm_state,
                             "t_minus_ms": raw_t_minus if type(raw_t_minus) is int else None,
                             "synced": nv.get("synced") is True,
                             "last_seen_ms": now - nv.get("last_seen_ms", 0)}
        body = self._start_body()
        return {"match_id": body["match_id"], "go_live_t": body["go_live_t"],
                "config_id": body["config_id"], "seq": body["seq"],
                "countdown_s": body["countdown_s"], "per_node": per_node}

    def _snapshot_config(self) -> ConfigView:
        """The served config is complete even though request-side GameConfig permits omissions."""
        if "loadout_policy" not in self.config:
            raise RuntimeError("served config is missing its normalized loadout policy")
        return cast(ConfigView, self.config)

    def _snapshot_kit(self, kitted: int) -> KitView:
        return {"kitted": kitted, "total": len(self.players), "trying": dict(self.trying),
                "browsing": dict(self.browsing)}

    def _updating(self) -> int:
        """F178 (Tony, 2026-09-23): READY stays the player's intent, and this is the part of it ARM
        (`start()`) will still refuse on. A READY player with a phone bound whose gun has not answered the head
        MC pushed: no ack yet, or an ack for an older `config_id` (`_refuse_stale_ack`). A refused
        `{ok: false}` ack is a red on the board, not an update in flight, so it is not counted."""
        if not self.lobby_pushed:
            return 0
        return sum(1 for pid, p in self.players.items()
                   if p.get("ready") and p.get("node_id")
                   and (pid not in self.acks or self._stale_ack_id(pid)))

    def _snapshot_lobby(self) -> LobbyView:
        return {"ready": sum(1 for p in self.players.values() if p["ready"]),
                "updating": self._updating(),
                "total": len(self.players), "pushed": self.lobby_pushed,
                "acks": cast(dict[str, LobbyAck], self.acks), "all_acked": self.all_acked()}

    def _snapshot_game(self) -> GameAnnouncementView:
        config_id = self.game_cfg
        view: GameAnnouncementView = {"loaded": self.game_loaded, "sent": self.game_sent_n(),
                                      "total": len(self.players)}
        if config_id is not None:
            view["config_id"] = config_id
        return view

    def _snapshot_options(self) -> SessionOptions:
        return cast(SessionOptions, dict(self.options))

    def _snapshot_feed(self) -> list[SnapshotFeedRow]:
        return cast(list[SnapshotFeedRow], self.feed[:50])

    def snapshot(self) -> State:
        now = self.now_ms()
        kitted = sum(1 for p in self.players.values() if p.get("node_id"))
        self._prune_browsing()
        live = self._live_view(now)
        start = self._start_view(now)
        end_delivery = self._end_delivery_view()        # A42: absent until a match has ended
        nodes: list[NodeView] = []
        for nv in self.nodes.values():
            # The node record stores an absolute receive timestamp; the public view exposes only its
            # age, and excludes internal bookkeeping such as `reach_claimed`.
            row = cast(NodeView, {
                key: nv[key] for key in (
                    "node_id", "node_type", "arm_state", "synced", "gun_name", "gun_tail", "player_id",
                    "preflight", "battery", "fw", "hp", "armor", "ammo", "alive", "pending", "app_ver",
                    "platform", "transport", "log", "reach", "last_reach", "pool_stale", "pool_stale_ms", "cure",
                    "gun_locked") if key in nv
            })
            row.setdefault("node_id", "")
            row.setdefault("node_type", "phone")
            row.setdefault("arm_state", "idle")
            row.setdefault("synced", False)
            row["last_seen_ms"] = now - nv.get("last_seen_ms", 0)
            # 2026-09-19: MC's own freshness judgement (the net layer's `stale`, STALE_AFTER_MS = 8 s),
            # not left for the console to re-derive from `last_seen_ms` with a threshold of its own
            # invention -- three different ones had grown up in `webapp/mc/src` (8 s, 60 s, and none at
            # all), and none of them agreed with the one MC already computes.
            row["stale"] = bool(nv.get("stale"))
            nodes.append(row)
        state: State = {"session_id": self.session_id, "phase": self.phase, "t": now, "lan": self.lan,
                "coverage": self.coverage(),                    # A28.4: derived, not asserted
                "mc_confidence": self.mc_confidence(),          # A11.5: gates MC-driven global-state events
                "nodes": nodes,
                "stations": self.stations_view(), "game_byte": self._game_byte(),   # A13.5: the ITEMS panel
                # X10: `game_no` is the old name for the same byte (it wraps at 255; the count does not). Kept
                # for an older console. Remove it once every console reads `game_byte`.
                "game_no": self._game_byte(),
                "readiness": self.readiness(), "config": self._snapshot_config(), "config_errors": self.config_errors,
                "options": self._snapshot_options(),      # A25: session options (log_sync)
                "versions": self.versions(),        # A29: the muster version header
                "config_warnings": self.config_warnings,
                "players": list(self.players.values()), "teams": self.teams,
                "standby": list(self.standby.values()),      # STANDBY: parked players, never counted above
                "kit": self._snapshot_kit(kitted),
                "loadout_pool": self.loadout_pool(),
                "active_preset_id": self.active_preset_id,
                "lobby": self._snapshot_lobby(),
                # LOAD: the GAME the phones have been told about. `loaded` is what the GAMES tab keys
                # its ACTIVE GAME CONFIG state on -- `lobby.pushed` no longer becomes true at LOAD,
                # which is the whole point of the split. `sent` is DELIVERY (see `load_game`).
                # `config_id` is `game_cfg`, the game that was ANNOUNCED -- NOT the live one. The two
                # diverge the moment a head is re-pushed without a re-announcement (a re-team after the
                # lobby push mints a fresh id: `_fresh_head_repush`), and reporting the live id here
                # made this block say the phones had been told about a game that never left MC.
                # ABSENT, not null, when nothing has been announced: the UI contract is
                # `config_id?: string` and "no announcement" is the absence, not an id.
                "game": self._snapshot_game(),
                "sync": self.sync_summary(),      # the pre-arm "is the field in sync" summary
                "start": start, "live": live, "recap": self.recap() if self.phase in ("live", "recap") else None,
                "notices": self._notices(),      # A31: standing host lines (absent keys = nothing to say)
                "feed": self._snapshot_feed()}
        if self.restored_from is not None:
            state["restored_from"] = self.restored_from
        bench_volume = getattr(self.compiler, "bench_volume", None)   # `--bench-volume`: the compiler owns it
        if bench_volume is not None:
            state["bench_volume"] = bench_volume
        if end_delivery is not None:
            state["end_delivery"] = end_delivery
        orphan = self.orphan_match_view()
        if orphan is not None:
            state["orphan_match"] = orphan
        # S50 build 4: the SAME resolved perk numbers `FrameBundle.perk_effects` carries, per player,
        # for the console — `Compiler.perk_effects_resolved()` is the one arithmetic both read, so the
        # two can never disagree. Absent players carry no perk; the whole key absent when nobody does.
        # `getattr` (not a straight call): a test double need not carry the whole compiler, same as
        # `_hit_plan()`'s own guard above.
        pe_fn = getattr(self.compiler, "perk_effects_resolved", None)
        if pe_fn is not None:
            pe_map = {pid: pe for pid, p in self.players.items() if (pe := pe_fn(self.config, p)) is not None}
            if pe_map:
                state["perk_effects"] = pe_map
        return state
