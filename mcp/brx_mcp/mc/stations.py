"""Station assignment, range, tamper lock, departures and views for Mission Control."""
from __future__ import annotations

import copy
import time
from typing import Callable, Protocol, cast

from . import powerups as _pu
from .interfaces import Compiler as CompilerPort
from .scoring import Scorer
from .types import (ADOPT_SLACK_MS, STATION_ARMED_OLDER, STATION_BATTERY_LOW, STATION_BRING_BACK,
    STATION_NOT_ARMED, STATION_REARM, DEFAULT_RUNWAY_S, PHONE_CONTROL_THRESHOLD_DBM, POWERUP_STATION_ID_MAX,
    PHONE_POWERUP_THRESHOLD_DBM, PHONE_RESPAWN_THRESHOLD_DBM, PHONE_STATION_THRESHOLD_DBM,
    PHONE_THRESHOLD_ZERO_APP, STATION_EDIT_AGE_UNKNOWN_MS, STATION_KINDS,
    STATION_LOCK_LOBBY_S, STATION_LOCK_MARGIN_S, STATION_LOCK_MAX_S,
    STATION_REBOOT_SLACK_MS, STATION_TEAM_ANY, station_fw_too_old, STATUS_HEARTBEAT_MS, TX_POWERS,
    GameConfig, Phase, Player, PowerupSlot, RangeEdit, RecapStationRow, StationAssignment, StationControl,
    StationDeparture, StationItem, StationRange, StationRef, StationReport, StationRestore,
    StationView, Team, is_station_kind, parse_app_ver)

# F221 battery rule: under 30 % is AMBER for the gun, the phone and the station alike.
BATTERY_LOW_PCT = 30
_STATION_LOCK_KEYS = ("lock", "lock_game", "locked_since", "unlocked_at", "restarts", "boot", "tally")


class StationNet(Protocol):
    def push(self, node_id: str, kind: str, body: dict) -> bool: ...


class StationHost(Protocol):
    """The match interface required by the station registry."""
    compiler: CompilerPort
    nodes: dict[str, dict]
    @property
    def config(self) -> GameConfig: ...
    now_ms: Callable[[], int]
    powerups_enabled: bool
    net: StationNet
    @property
    def phase(self) -> Phase: ...
    players: dict[str, Player]
    node_player: dict[str, str]
    scorer: Scorer | None
    teams: list[Team]
    lobby_pushed: bool
    start_info: dict | None
    def _after_station_change(self, slots_before: list[PowerupSlot], pickups_before: list[dict] | None = None) -> None: ...
    def _brief_pickups(self) -> list[dict]: ...
    def _changed(self) -> None: ...
    def _validate(self, roster: list[Player] | None = None) -> dict: ...
    def _refuse_station_change_in_play(self) -> None: ...
    def _game_byte(self) -> int: ...
    def _node_loss(self, nv: dict, which: str) -> int: ...
    def pu_state(self, nid: str) -> tuple[dict | None, dict | None, int | None]: ...
    def _log(self, node_id: str, kind: str, body: dict, t_recv: int,
             seq: int | None = None, parked: bool = False) -> None: ...
    def _on_feed(self, entry: dict) -> None: ...
    def _operator_t_match(self, now: int) -> int: ...
    def in_play(self) -> bool: ...
    def is_adopted(self) -> bool: ...
    def note_departed_station(self, nid: str, row: RecapStationRow) -> None: ...
    def station_sync_state(self) -> tuple[int | None, dict[str, str]]: ...
    def game_no_started(self) -> bool: ...
    def ensure_utility_node(self, nid: str) -> None: ...
    def clear_claims_report(self, nid: str) -> None: ...

STATION_FW_TOO_OLD = "STICK FIRMWARE TOO OLD: REFLASH IT"


def is_stick(node: dict) -> bool:
    """O13: a StickS3 station, by its hello (`platform` esp32) or, before that arrives, its minted id (`stick-<mac>`).
    The one test for "is this a Stick, not a phone" (a phone has its own app version and threshold rules)."""
    return node.get("platform") == "esp32" or str(node.get("node_id") or "").startswith("stick-")


def station_nvs_line(n: int) -> str:
    """O12: the Stick's flash refused `n` writes since it booted (`status.nvs_fail`), so a restart would lose what it failed to save."""
    # No erase-flash command exists in stick.py, and an upload leaves the NVS partition as it was, so reflashing does not help.
    return f"STICK CANNOT SAVE TO FLASH [{n} FAILED WRITE{'' if n == 1 else 'S'}], A RESTART LOSES ITS SETTINGS: REPLACE IT"


def station_claims_dropped_line(n: int, station_id: object = None) -> str:
    """O10: a Stick's full queue evicted CLAIM reports this match (`status.actions_dropped`, counted since the Stick was armed for this game);
    MC never heard who took the item, so the recap's PICKUPS list (the phone's own `pickup` fact) is where to look."""
    where = f"STATION #{station_id}" if isinstance(station_id, int) and not isinstance(station_id, bool) else "THIS STATION"
    return f"{n} CLAIM REPORT{'' if n == 1 else 'S'} DROPPED BY THE STICK: CHECK THE RECAP'S PICKUPS FOR {where}"


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


def _tally_ok(t: object) -> bool:
    if not isinstance(t, dict) or not isinstance(t.get("key"), list) or not isinstance(t.get("hold_ms"), dict):
        return False
    if not all(isinstance(k, str) and isinstance(v, int) and not isinstance(v, bool) and v >= 0
               for k, v in t["hold_ms"].items()):
        return False
    r = t.get("revives")
    return r is None or (isinstance(r, int) and not isinstance(r, bool))


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


class StationRegistry:
    """Own station records. Callbacks expose only the match operations stations need."""

    _KOTH_HILL_FAULT_NONE = "KING OF THE HILL NEEDS A HILL: ASSIGN A PHONE OR STICK AS A HILL IN THE ARMORY"
    _KOTH_HILL_FAULT_SOURCE = ("KING OF THE HILL NEEDS A HILL: SET OBJECTIVE SOURCE TO PHONE, THEN ASSIGN A "
                                "PHONE OR STICK AS A HILL IN THE ARMORY")
    _DEPARTURE_NAME = {"control": "HILL", "respawn": "RESPAWN", "powerup": "POWERUP", "extraction": "EXTRACT", "bomb": "BOMB"}

    def __init__(self, host: StationHost):
        self.stations: dict[str, dict] = {}
        # F364 (Tony 2026-09-25): the station id MC handed each node_id this session, kept after a clear or a
        # release and saved in the snapshot, so a station keeps its number across its own restart, a relink and
        # an MC restart. `auto_station_id` reads it; the operator never types an id.
        self._station_id_of: dict[str, int] = {}
        # Bench 2026-10-02 (option B): an ASSIGNED station that left ITEMS (its own BACK TO HUD, or an MC RELEASE),
        # node_id -> what it was. Named in the LOAD refusal and on ITEMS; RESTORE re-applies it once the same node is
        # back. Kept across NEXT MATCH and an MC restart (the snapshot); gone when that node is assigned again or on a
        # FRESH SESSION. `line` and the view are derived (`departures_view`).
        self._station_departures: dict[str, dict] = {}
        self._stations_unlocked = False
        self._range_epoch = 0
        self._host = host

    def has(self, nid: str) -> bool:
        return nid in self.stations

    def record(self, nid: str) -> dict:
        return self.stations.get(nid) or {}

    def assignment(self, nid: str) -> StationAssignment | None:
        return (self.stations.get(nid) or {}).get("assigned")

    def required_assignment(self, nid: str) -> StationAssignment:
        return self.stations[nid]["assigned"]

    def assignments(self) -> list[tuple[str, StationAssignment]]:
        return [(nid, a) for nid, st in self.stations.items() if (a := st.get("assigned"))]

    def on_hello(self, nid: str, last_seen_ms: int, app_ver: str | None, platform: str | None) -> bool:
        st = self.stations.setdefault(nid, {"node_id": nid, "assigned": None, "report": {}, "armed": None})
        st["last_seen_ms"] = last_seen_ms
        st["app_ver"] = app_ver or st.get("app_ver")
        st["platform"] = platform or st.get("platform")
        if (gone := self._station_departures.get(nid)) is not None:
            gone["returned"] = True
        return bool(st.get("assigned"))

    def on_heartbeat(self, nid: str, body: dict, t_recv: int) -> None:
        st = self.stations.setdefault(nid, {"node_id": nid, "assigned": None, "report": {}, "armed": None})
        st["report"] = {k: body.get(k) for k in ("kind", "team", "station_id", "threshold", "live", "revives",
                                                 "armed", "control", "battery", "uptime_s", "boot_count", "nvs_fail", "assoc",
                                                 "threshold_src", "tx_power", "tx_power_src") if k in body}
        self._note_range(nid, st, body, t_recv)
        self._note_boot(st, body, t_recv)
        self._keep_tally(st, t_recv)
        st["last_seen_ms"] = t_recv
        if body.get("app_ver"):
            st["app_ver"] = body["app_ver"]
        if body.get("platform"):
            st["platform"] = body["platform"]

    def forget(self, nid: str) -> dict | None:
        # F364: only a removed node releases its reserved id. CLEAR keeps the reservation.
        self._station_id_of.pop(nid, None)
        return self.stations.pop(nid, None)

    def back_to_hud(self, nid: str, successor: str | None = None) -> None:
        self.record_departure(nid, "back_to_hud", successor=successor)
        self.forget(nid)

    def reset_for_load(self) -> None:
        self._stations_unlocked = False

    def begin_match(self) -> None:
        self._range_epoch += 1

    def lock_for_start(self) -> None:
        self._stations_unlocked = False

    def unlock_after_abort(self) -> None:
        self._stations_unlocked = True

    def reset_for_session(self) -> None:
        self._station_id_of = {n: a["id"] for n, st in self.stations.items() if (a := st.get("assigned"))}
        self._station_departures = {}

    def to_snapshot(self) -> dict:
        return {
            "stations": {nid: st["assigned"] for nid, st in self.stations.items() if st.get("assigned")},
            "station_ids": dict(self._station_id_of),
            "station_departures": {nid: {k: v for k, v in d.items() if k != "returned"}
                                   for nid, d in self._station_departures.items()},
            "stations_unlocked": self._stations_unlocked,
            "station_locks": {nid: {k: st[k] for k in _STATION_LOCK_KEYS if k in st}
                              for nid, st in self.stations.items() if st.get("assigned")},
            "station_range_seen": {nid: st["range_seen"] for nid, st in self.stations.items()
                                   if st.get("assigned") and st.get("range_seen")},
            "range_epoch": self._range_epoch,
        }

    def capture_state(self) -> dict:
        return copy.deepcopy({
            "stations": self.stations, "station_ids": self._station_id_of,
            "station_departures": self._station_departures,
            "stations_unlocked": self._stations_unlocked, "range_epoch": self._range_epoch,
        })

    def restore_state(self, state: dict) -> None:
        self.stations = state["stations"]
        self._station_id_of = state["station_ids"]
        self._station_departures = state["station_departures"]
        self._stations_unlocked = state["stations_unlocked"]
        self._range_epoch = state["range_epoch"]

    def restore(self, snap: dict) -> list[str]:
        restored: list[str] = []
        for nid, a in (snap.get("stations") or {}).items():
            if not isinstance(a, dict):
                continue
            self.stations[nid] = {"node_id": nid, "assigned": a, "report": {}, "armed": None, "arm_pending": True}
            kept = (snap.get("station_locks") or {}).get(nid)
            if isinstance(kept, dict):
                self.stations[nid].update({k: kept[k] for k in _STATION_LOCK_KEYS if k in kept})
                if not _tally_ok(self.stations[nid].get("tally")):
                    self.stations[nid].pop("tally", None)
            seen = (snap.get("station_range_seen") or {}).get(nid)
            if isinstance(seen, dict) and isinstance(seen.get("max"), int) and isinstance(seen.get("edits"), list):
                self.stations[nid]["range_seen"] = {"max": seen["max"],
                                                    "edits": [e for e in seen["edits"] if isinstance(e, dict) and _range_edit_ok(
                                                        {**e, "age_ms": 0})][-8:]}
            restored.append(nid)
        for nid, sid in (snap.get("station_ids") or {}).items():
            if isinstance(nid, str) and isinstance(sid, int) and not isinstance(sid, bool) and 1 <= sid <= 65535:
                self._station_id_of[nid] = sid
        for nid, st in self.stations.items():
            if isinstance(sid := (st.get("assigned") or {}).get("id"), int):
                self._station_id_of[nid] = sid
        # cross-lane #7: a snapshot from before the one-byte limit can hold a powerup id above it: renumber it (once every
        # station is in, so the free id cannot collide) and say so, rather than arm an id the claim advert cannot carry
        for nid in [n for n, st in self.stations.items() if (st.get("assigned") or {}).get("kind") == "powerup"
                    and isinstance(st["assigned"].get("id"), int) and st["assigned"]["id"] > POWERUP_STATION_ID_MAX]:
            old = self.stations[nid]["assigned"]["id"]
            self._station_id_of.pop(nid, None)
            self.stations[nid]["assigned"]["id"] = new = self.auto_station_id(nid, "powerup")
            self._station_id_of[nid] = new
            import logging
            logging.getLogger("brx.mc").warning("powerup station %s restored with id %s (above %s): renumbered to %s",
                                                nid, old, POWERUP_STATION_ID_MAX, new)
        for nid, d in (snap.get("station_departures") or {}).items():
            if isinstance(nid, str) and self._departure_ok(d) and not (self.stations.get(nid) or {}).get("assigned"):
                self._station_departures[nid] = {**d, "returned": False}
        if isinstance(snap.get("range_epoch"), int):
            self._range_epoch = snap["range_epoch"]
        self._stations_unlocked = snap.get("stations_unlocked") is True
        return restored

    def station_ids(self) -> list[StationRef]:
        rows: list[StationRef] = []
        for st in self.stations.values():
            if a := st.get("assigned"):
                row: StationRef = {"id": a["id"], "kind": a["kind"]}
                if item := self._active_item(a):
                    row["item"] = item                  # A56: the phone knows the item and its schedule without MC
                rows.append(row)
        return sorted(rows, key=lambda x: x["id"])

    def _active_item(self, a: dict | None) -> StationItem | None:
        """The item a station assignment carries INTO THIS RUN: only with the flag on, only on a powerup station.
        Anything else (the flag off, a restored item on another kind) is inert, never sent and never compiled."""
        if not self._host.powerups_enabled or not a or a.get("kind") != "powerup":
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

    def item_stations(self) -> list[tuple[str, dict, StationItem]]:
        """(node_id, assignment, item) for every assigned station with an active item, by station id."""
        out = [(nid, a, item) for nid, st in self.stations.items()
               if (a := st.get("assigned")) and (item := self._active_item(a))]
        return sorted(out, key=lambda r: r[1]["id"])

    def powerup_slots(self) -> list[PowerupSlot]:
        """`GameConfig.powerups`: each distinct pickup weapon, by station id, into slot 2 then 3."""
        return _pu.weapon_slots(item for _nid, _a, item in self.item_stations())

    def station_warnings(self) -> list[str]:
        """What the objective / respawn rules need on the FIELD that the ITEMS panel has not assigned.
        Advisory (a station may be armed by hand behind the phone's seven-tap gate) but loud, because a
        station-gated game with no station is the F104 failure mode: nothing on the field, nothing said."""
        out: list[str] = []
        kinds = {a["kind"] for st in self.stations.values() if (a := st.get("assigned"))}
        src = self._host.config.get("station_source")
        # F402 (Tony 2026-09-25): "no way to play it without it", for KOTH this is no longer an
        # advisory, it is a hard LOAD/push refusal (`koth_hill_fault`), so the amber line below would
        # otherwise say the same fact twice in two colours. Left in place for any OTHER mode that ever
        # sets `station_source: "phone"` without F402's own gate.
        if src == "phone" and "control" not in kinds and self._host.config.get("mode") != "koth":
            out.append("SETUP: NO CONTROL STATION IS ASSIGNED (THE OBJECTIVE IS A BLUETOOTH CONTROL POINT, SO "
                       "NOTHING ON THE FIELD IS THE HILL): ASSIGN A STATION AS CONTROL IN ITEMS AND ARM IT")
        # Stick hills (2026-09-24): a CONTROL station advertises the same kind-5 point a phone does, and every
        # phone drops it unless the source is "phone" (`engine.js _hillSourceAllowed`). Say so; never switch.
        if src in ("grenade", "ir_station") and "control" in kinds:
            what = "THE GRENADE" if src == "grenade" else "AN IR STATION"
            out.append(f"SETUP: A CONTROL STATION IS ASSIGNED BUT THIS GAME'S OBJECTIVE IS {what} (EVERY PHONE "
                       "IGNORES THE STATION'S HILL): SET OBJECTIVE SOURCE TO PHONE, OR CLEAR THE CONTROL STATION IN ITEMS")
        if (self._host.config.get("respawn") or {}).get("type") == "scanner" and "respawn" not in kinds:
            out.append("SETUP: NO RESPAWN STATION IS ASSIGNED (RESPAWN IS SET TO STATION, SO A DOWNED PLAYER CAN ONLY COME "
                       "BACK AT A STATION): ASSIGN A STATION AS RESPAWN IN ITEMS AND ARM IT")
        if (self._host.config.get("respawn") or {}).get("type") == "scanner" and "respawn" in kinds:
            teams = self._host.config.get("teams") or []
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

    def koth_hill_fault(self) -> str | None:
        """F402 (Tony 2026-09-25): "KOTH should require utility in the armory. no way to play it
        without it." Unlike `station_warnings()` (advisory, a station may be armed by hand behind
        the phone's seven-tap gate), this is a HARD refusal: a hill mode with nothing on the field
        that IS the hill cannot be played at all, not merely a readiness judgement an operator could
        see and accept. Both a phone utility and a Stick advertise the same kind-5 `control` point
        (`station_source: "phone"` covers both, spec/utility.md §5b), so this asks ITEMS, never the
        device type. The grenade and IR-station sources are POST-MVP and never satisfy it."""
        if self._host.config.get("mode") != "koth":
            return None
        if self._host.config.get("station_source") != "phone":
            return self._KOTH_HILL_FAULT_SOURCE
        kinds = {a["kind"] for st in self.stations.values() if (a := st.get("assigned"))}
        if "control" not in kinds:
            # Bench 2026-10-02: a hill that left (BACK TO HUD, RELEASE) is named, so the refusal says WHY.
            # overnight review L5: oldest first, the order ITEMS (`departures_view`) and the mock list them in
            gone = [self._departure_line(d) for d in sorted(self._station_departures.values(), key=lambda d: d["at_ms"])
                    if d["kind"] == "control"]
            return "KING OF THE HILL NEEDS A HILL: " + "; ".join(gone) if gone else self._KOTH_HILL_FAULT_NONE
        return None

    def koth_hill_offline_warning(self) -> list[str]:
        """F402 item 2: the assigned hill can go OFFLINE after LOAD with nothing else changing to
        re-run `_validate()` (a silent node, not an edit), so this is computed fresh at snapshot
        time, exactly like `station_view`'s own `online`, and never cached in `config_warnings`
        alongside `station_warnings()`. Advisory only: START is still allowed, unlike
        `koth_hill_fault` above, which `force` cannot open either."""
        if self._host.config.get("mode") != "koth" or self._host.config.get("station_source") != "phone":
            return []
        hills = [self.station_view(nid) for nid, st in self.stations.items()
                 if (a := st.get("assigned")) and a.get("kind") == "control"]
        if not hills or any(v["online"] for v in hills):
            return []               # one hill online is enough (several control points are allowed)
        # A muster or HELD Stick is out of Wi-Fi by design (A58/A68); the tamper flags speak for it.
        if any((v.get("report") or {}).get("assoc") in ("muster", "held") for v in hills):
            return []
        return ["SETUP: THE HILL IS OFFLINE: BRING IT INTO WI-FI OR RE-ARM IT BEFORE YOU START"]

    def station_sync_warnings(self) -> list[str]:
        """F401: a HELD station (e.g. a StickS3) can end a timed match on its own clock while out of
        Wi-Fi range, so MC gets its result only once it is brought back. Warn at LOAD -- on the Games
        screen the operator sees before the next START -- for any station of the LAST FINISHED match
        MC has not heard since that match's whistle. Say the consequence, not just the fact: the next
        LOAD's new game byte resets a station's own tally (`arm_station`), so a station still out of
        range at LOAD loses that result for good. Advisory, like `station_warnings()` beside it: it
        never blocks LOAD or START, and it clears the moment the station's node is heard again."""
        match_end_t, pending = self._host.station_sync_state()
        if match_end_t is None:
            return []
        return [f"{label} HAS NOT SYNCED THE LAST MATCH: BRING IT INTO WI-FI BEFORE YOU LOAD, OR ITS RESULT IS LOST"
                for nid, label in pending.items()
                if self._host.nodes.get(nid, {}).get("last_seen_ms", 0) < match_end_t]

    def set_station(self, nid: str, a: dict) -> StationView:
        """The operator's ITEMS assignment for one utility phone: kind / team / id / threshold. Validated in
        the same voice as `set_config`, stored, and pushed as `station_config` at once (utility.md §5b.1)."""
        if not isinstance(a, dict):
            raise ValueError("assignment must be an object")
        a = self._keep_stored_overrides(nid, a)
        if (view := self._set_station_range_only(nid, a)) is not None:
            return view                        # A67: a RANGE/STRENGTH-only edit, allowed in any phase
        self._host._refuse_station_change_in_play()
        kind = a.get("kind")
        if not is_station_kind(kind):
            raise ValueError(f"kind must be one of {', '.join(STATION_KINDS)}")
        team = a.get("team", STATION_TEAM_ANY)
        if isinstance(team, str):
            t = next((t for t in self._host.config.get("teams", []) if t.get("team_id") == team), None)
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
        game_tids = {int(t["tid"]) for t in self._host.config.get("teams", []) if "tid" in t}
        if team != STATION_TEAM_ANY and team not in game_tids:
            raise ValueError(f"team $TID {team} is not one of this game's teams ({sorted(game_tids) or 'none yet'}); "
                             "a station on it would serve nobody -- pick a team in the game, or 'any'")
        if kind == "control" and team != STATION_TEAM_ANY:
            raise ValueError("a control point starts NEUTRAL and is taken by presence (spec/utility.md §5d): team must be 'any'")
        # F364: MC assigns the id. An explicit `id` (an older console) is still accepted and validated below.
        sid = a.get("id")
        if sid is None:
            sid = self.auto_station_id(nid, kind)
        if not (isinstance(sid, int) and not isinstance(sid, bool) and 1 <= sid <= 65535):
            raise ValueError("id must be an integer 1..65535 (the station id in the advert), or absent for MC to assign one")
        if kind == "powerup" and sid > POWERUP_STATION_ID_MAX:
            raise ValueError(f"A POWERUP STATION NEEDS AN ID FROM 1 TO {POWERUP_STATION_ID_MAX} (ITS CLAIM ADVERT CARRIES ONE BYTE): "
                             f"GIVE IT A LOWER ID, OR CLEAR THE ID SO MC ASSIGNS ONE")
        clash = next((n for n, st in self.stations.items() if n != nid and (st.get("assigned") or {}).get("id") == sid), None)
        if clash:
            raise ValueError(f"station id {sid} is already assigned to {clash}; ids must be unique on the field")
        # F345: 0 (and absent) = the station's own PLATFORM default, which it advertises in byte 14 (a respawn
        # station: a phone -70, a StickS3 -57, Tony 2026-09-24; a StickS3 powerup -45, F434). Any other value is the operator's override.
        thr = a.get("threshold", 0)
        if not (isinstance(thr, int) and not isinstance(thr, bool) and (thr == 0 or -100 <= thr <= -30)):
            raise ValueError("threshold must be 0 (the station's own default) or an integer dBm in -100..-30 (the presence bubble)")
        # Only a phone that said hello as a UTILITY node can be a station. A player's HUD ignores
        # `station_config`, and assigning it would advertise a station id to every player that nothing
        # on the field emits (review 2026-09-11).
        if nid not in self.stations and (self._host.nodes.get(nid) or {}).get("node_type") != "utility":
            raise ValueError(f"{nid!r} is not a utility phone (no utility hello this session); open the app in the "
                             "UTILITY role on that phone and connect it to Mission Control first")
        # 2026-09-19 (field): a station's node record survives its phone going quiet -- on purpose, so
        # it can be re-armed the moment it comes back (`arm_station`'s "bring it back to re-arm"). But
        # ASSIGNING one while it is stale (no message in STALE_AFTER_MS) just walks the operator into an
        # arm that fails against a dead socket: this exact node_id went quiet because the same physical
        # phone re-opened elsewhere under a NEW node_id (a player role, or its storage cleared) and is
        # never coming back to THIS one. Refuse here, same voice as the rest of this validation, rather
        # than let the push fail silently downstream.
        # A56 (S58): a powerup station's item, picked from MC's presets. The expanded item is what is stored.
        if "item" in a:
            raise ValueError("send item_preset (one of: " + ", ".join(_pu.PRESET_IDS) + "), not a raw item")
        # S-powerup-overrides (2026-09-28): CHARGES/AMOUNT/RESPAWN are optional siblings of `item_preset`,
        # never free-standing -- there is no item to override without one.
        override_keys = [k for k in _pu.OVERRIDE_KEYS if a.get(k) is not None]
        if override_keys and not isinstance(a.get("item_preset"), str):
            raise ValueError(f"{override_keys[0].upper()} NEEDS item_preset IN THE SAME REQUEST")
        item: StationItem | None = None
        if "item_preset" in a and a["item_preset"] is not None:
            if not self._host.powerups_enabled:
                raise ValueError(_pu.REFUSED_FLAG_OFF)
            if kind != "powerup":
                raise ValueError(f"item_preset is for a powerup station, not {kind!r}")
            if not isinstance(a["item_preset"], str):
                raise ValueError("item_preset must be one of: " + ", ".join(_pu.PRESET_IDS))
            item = _pu.expand(a["item_preset"], getattr(self._host.compiler, "catalog", None))
            item = _pu.apply_overrides(item, a)    # S-powerup-overrides: charges/amount/spawn_every_s
            others = [it for n, _a, it in self.item_stations() if n != nid]
            _pu.weapon_slots([*others, item])      # refuses a third different weapon
        if (self._host.nodes.get(nid) or {}).get("stale"):
            raise ValueError(f"{nid!r} has not been heard from recently (its link has gone stale); it cannot be "
                             "assigned until it reconnects -- if this phone reopened elsewhere, its NEW node_id "
                             "is the one to assign instead")
        prev_a = (self.stations.get(nid) or {}).get("assigned")
        if prev_a and prev_a["kind"] != kind and thr == prev_a["threshold"]:
            thr = 0                            # A67: a new kind starts at its own default, not the old kind's range
        rng = self.range_fields(prev_a, thr, a)   # A67: validates tx_power
        slots_before, pickups_before = self.powerup_slots(), self._host._brief_pickups()
        st = self.stations.setdefault(nid, {"node_id": nid, "assigned": None, "report": {}, "armed": None})
        assignment: StationAssignment = {"kind": kind, "team": team, "id": sid, "threshold": thr, "at": self._host.now_ms()}
        assignment.update(rng)
        if item is not None:
            assignment["item"] = item
        st["assigned"] = assignment
        self._station_id_of[nid] = sid
        self._station_departures.pop(nid, None)   # bench 2026-10-02: assigned again (RESTORE or anew), so it is back
        if kind == "control":
            # polish r1 M2(a): KOTH has one hill, so a new hill answers every hill that left. Respawn and powerup
            # departures can coexist, so they wait for DISMISS, RESTORE, their own node, or a FRESH SESSION.
            for gone_nid in [n for n, d in self._station_departures.items() if d["kind"] == "control"]:
                self._station_departures.pop(gone_nid, None)
        self._host.ensure_utility_node(nid)
        # An assignment changes the allow-list every OTHER station echoes, so all of them are re-armed.
        self._host._after_station_change(slots_before, pickups_before)
        self._host._validate()
        self._host._changed()
        return self.station_view(nid)

    def _departure_label(self, d: dict) -> str:
        """Polish r1 M3: what the operator can SEE. Once the phone's HUD identity is bound, the player holding it
        ("NOW REAPER'S HUD"); else the device word and the id head the ITEMS card shows (`Items.tsx deviceOf`,
        `node_id.slice(0, 12)`). The phone never shows its own id, and MC knows no name or colour for it.
        Overnight review L8: once the same utility node is back (`returned`), it is not that player's HUD any more."""
        pid = None if d.get("returned") else self._host.node_player.get(d.get("successor") or "")
        if pid and (pl := self._host.players.get(pid)) and pl.get("node_id") == d.get("successor"):
            return f"NOW {str(pl.get('display') or pid).upper()}'S HUD"
        device = "STICKS3" if is_stick(d) else "PHONE"
        return f"{device} {d['node_id'][:12]}"

    def record_departure(self, nid: str, reason: str, successor: str | None = None) -> None:
        """Bench 2026-10-02 (option B): remember an ASSIGNED station that is leaving ITEMS, with everything RESTORE
        needs to put it back through the normal `set_station` path. `successor` is the HUD node the phone became
        (BACK TO HUD), so the label can name that player once it is bound."""
        st = self.stations.get(nid) or {}
        a = st.get("assigned")
        platform = st.get("platform") or (self._host.nodes.get(nid) or {}).get("platform")
        if not a:
            # Polish r1 M1: a node that came back and left again before anyone assigned it is not back any more.
            # Nothing new to restore: the record keeps describing the station it was.
            if (old := self._station_departures.get(nid)) is not None:
                # Polish r2: a GENUINE second departure (the node had come back) restamps when and how it left. The
                # HUD hello that follows a RELEASE (never back in between) must not overwrite the release.
                if old.get("returned"):
                    old["reason"] = reason
                    old["at_ms"] = self._host.now_ms()
                old["returned"] = reason == "released" and is_stick({"platform": platform, "node_id": nid})
                if successor:
                    old["successor"] = successor
            return
        restore: StationRestore = {"kind": a["kind"], "team": a["team"], "threshold": a["threshold"]}
        if a.get("tx_power"):
            restore["tx_power"] = a["tx_power"]
        item = a.get("item")
        if item and (preset := _pu.preset_of(item)):
            # the console's own full-replace contract: the effective value of every field the item carries
            restore["item_preset"] = preset
            restore["spawn_every_s"] = item["spawn_every_s"]
            if item["kind"] == "weapon" and isinstance(item.get("charges"), int):
                restore["charges"] = item["charges"]
            if item["kind"] == "overshield" and isinstance(item.get("amount"), int):
                restore["amount"] = item["amount"]
        rec: dict = {"node_id": nid, "kind": a["kind"], "id": a["id"], "team": a["team"], "threshold": a["threshold"],
                     "reason": reason, "at_ms": self._host.now_ms(),
                     # a released Stick has no HUD to go to: it stays linked, so it is back at once
                     "returned": reason == "released" and is_stick({"platform": platform, "node_id": nid}), "restore": restore}
        if a.get("tx_power"):
            rec["tx_power"] = a["tx_power"]
        if item:
            rec["item"] = dict(item)
        if platform:
            rec["platform"] = platform
        if successor:
            rec["successor"] = successor
        self._station_departures[nid] = rec

    @staticmethod
    def _departure_ok(d: object) -> bool:
        """A persisted departure MC can still read. A bad row is dropped, never fatal."""
        return (isinstance(d, dict) and is_station_kind(d.get("kind")) and d.get("reason") in ("back_to_hud", "released")
                and all(isinstance(d.get(k), int) and not isinstance(d.get(k), bool) for k in ("id", "team", "threshold", "at_ms"))
                and isinstance(d.get("restore"), dict)
                and isinstance(d.get("node_id"), str))

    def _departure_line(self, d: dict) -> str:
        """The one sentence for a departure, in the station voice. The LOAD refusal and ITEMS use it as it is."""
        stick = is_stick(d)
        what = ("WENT BACK TO HUD" if d["reason"] == "back_to_hud"
                else "WAS RELEASED" if stick else "WAS RELEASED TO ITS HUD")
        at = time.strftime("%H:%M", time.localtime(d["at_ms"] / 1000))
        online = d.get("returned") and not (self._host.nodes.get(d["node_id"]) or {}).get("stale")
        act = ("IT IS BACK, SO TAP RESTORE ON ITS ITEMS CARD TO ASSIGN IT AGAIN" if online
               else "IT IS BACK BUT OUT OF WI-FI: BRING IT BACK INTO WI-FI, THEN TAP RESTORE ON ITS ITEMS CARD"
               if d.get("returned") else "BRING IT BACK INTO WI-FI, THEN TAP RESTORE IN THE ARMORY TO ASSIGN IT AGAIN" if stick
               else "SWITCH IT BACK TO UTILITY, THEN TAP RESTORE IN THE ARMORY TO ASSIGN IT AGAIN")
        return (f"{self._DEPARTURE_NAME.get(d['kind'], str(d['kind']).upper())} {d['id']} ({self._departure_label(d)}) "
                f"{what} AT {at}: {act}")

    def departures_view(self) -> list[StationDeparture]:
        return [cast(StationDeparture, {**d, "returned": bool(d.get("returned")), "label": self._departure_label(d),
                                        "id_free": self._departure_id_free(nid, d), "line": self._departure_line(d)})
                for nid, d in sorted(self._station_departures.items(), key=lambda kv: kv[1]["at_ms"])]

    def _departure_id_free(self, nid: str, d: dict) -> bool:
        """Polish r1 L1: would RESTORE get the old number back (`auto_station_id`'s departure rule)?"""
        if d.get("kind") == "powerup" and d["id"] > POWERUP_STATION_ID_MAX:
            return False     # cross-lane #7: a powerup gets a new one-byte id, so RESTORE never offers the old one
        used = {a["id"] for n, st in self.stations.items() if n != nid and (a := st.get("assigned"))}
        return d["id"] not in used and d["id"] not in {i for n, i in self._station_id_of.items() if n != nid}

    def dismiss_departure(self, nid: str) -> bool:
        """Polish r1 M2(b): the operator's DISMISS on an away line. False when there is no such departure."""
        if self._station_departures.pop(nid, None) is None:
            return False
        self._host._validate()
        self._host._changed()
        return True

    def auto_station_id(self, nid: str, kind: str | None = None) -> int:
        """F364: the id MC gives a station assigned with no `id`. A station keeps the id it already holds, then the
        one it was handed earlier this session (a clear, a restart or a relink never renumbers it), unless another
        station now holds that number. A new station takes the lowest id no station holds or was handed, so a
        phone and a Stick share one sequence: 1, 2, 3. A powerup station's id fits its claim advert's one byte
        (cross-lane #7): a held or remembered id above POWERUP_STATION_ID_MAX is passed over for a free one."""
        top = POWERUP_STATION_ID_MAX if kind == "powerup" else 65535
        used = {a["id"] for n, st in self.stations.items() if n != nid and (a := st.get("assigned"))}
        own = ((self.stations.get(nid) or {}).get("assigned") or {}).get("id")
        for cand in (own, self._station_id_of.get(nid)):
            if isinstance(cand, int) and 1 <= cand <= top and cand not in used:
                return cand
        taken = used | {i for n, i in self._station_id_of.items() if n != nid}
        # Bench 2026-10-02: a departed station gets its old number back on RESTORE (or any new assignment) when no
        # station holds it and MC has not handed it to another node since; otherwise the rule below.
        gone = (self._station_departures.get(nid) or {}).get("id")
        if isinstance(gone, int) and 1 <= gone <= top and gone not in taken:
            return gone
        sid = 1
        while sid in taken:
            sid += 1
        if sid > top:
            raise ValueError(f"no free station id is left (1..{top})")
        return sid

    def clear_station(self, nid: str) -> bool:
        st = self.stations.get(nid)
        if not st:
            return False
        self._host._refuse_station_change_in_play()
        slots_before, pickups_before = self.powerup_slots(), self._host._brief_pickups()
        st["assigned"] = None
        st["armed"] = None
        self._host._after_station_change(slots_before, pickups_before)   # the survivors' valid_ids shrink
        self._host._validate()
        self._host._changed()
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
        Best-effort like `arm_station`: a phone with no socket has nothing to retry against, and its own
        seven-tap gate is still there under this if the push never lands.

        ...and the ASSIGNMENT goes with the phone. A release used to leave it standing, so MC kept vouching
        for a field item that had walked away: the ITEMS card still rendered its kind/id/team as a deployed
        station, `station_warnings` still counted it as the control point or respawn point this game's
        rules need (so a station-gated game read as SET UP with nothing on the field emitting anything --
        the F104 failure mode, produced by MC's own bookkeeping), and `station_ids()` still handed its id
        to every player's `config.stations` allow-list.

        Cleared ONLY when the push was taken. A release that reached no socket changed nothing on the field
        -- that phone is still a station -- and clearing the row then would be the same lie pointing the
        other way. The cleanup is `clear_station`'s, minus its phase gate: `_repush_stations_to_players` is
        LOBBY-only on its own, so nothing re-arms a live gun here, which is what lets this stay ungated."""
        if nid not in self.stations:
            return False
        ok = self._host.net.push(nid, "control", {"cmd": "release_utility"}) is not False
        st = self.stations.get(nid)
        if ok and st is not None:
            self.record_departure(nid, "released")   # bench 2026-10-02 (+ polish r1 M1: an unassigned return leaves again)
        if ok and st is not None and (st.get("assigned") or st.get("armed")):
            if self._host.scorer and self._host.phase in ("armed", "live"):
                rec = self._station_recap_row(self.station_view(nid))
                if rec is not None:
                    self._host.note_departed_station(nid, rec)
            slots_before, pickups_before = self.powerup_slots(), self._host._brief_pickups()
            st["assigned"], st["armed"], st["arm_pending"] = None, None, False
            for k in _STATION_LOCK_KEYS:
                if k != "boot":                # the last boot seen stays: a restart is judged against it
                    st.pop(k, None)            # A58: a release unlocks the Stick too (utility.md)
            self._host._after_station_change(slots_before, pickups_before)   # the survivors' valid_ids shrink
            self._host._validate()                       # ...and the SETUP warnings tell the truth again
            self._host._changed()
        return ok

    @staticmethod
    def wire_threshold(nid: str, st: dict, a: StationAssignment) -> int:
        """F345: the `station_config.threshold` one station is sent. 0 means "your own platform default", but a phone
        app older than PHONE_THRESHOLD_ZERO_APP clamps 0 to -30 dBm (a few cm: no revive is possible). Such a phone,
        or one whose version MC cannot parse, gets the explicit value instead: the new phone respawn default for a
        respawn station, F383's -75 for a control (hill) station, the old -74 for any other kind. A StickS3
        (platform `esp32`) has always read 0 correctly."""
        thr = a["threshold"]
        if thr != 0 or is_stick({**st, "node_id": nid}):
            return thr
        v = parse_app_ver(st.get("app_ver"))
        if v is not None and v >= PHONE_THRESHOLD_ZERO_APP:
            return 0
        if a["kind"] == "respawn":
            return PHONE_RESPAWN_THRESHOLD_DBM
        if a["kind"] == "powerup":
            return PHONE_POWERUP_THRESHOLD_DBM
        if a["kind"] == "control":
            return PHONE_CONTROL_THRESHOLD_DBM
        return PHONE_STATION_THRESHOLD_DBM

    def range_fields(self, prev: StationAssignment | None, thr: int, a: dict) -> dict:
        """A67 (F365): the range bookkeeping for an operator's assignment. A value that CHANGED (or a new
        assignment) is the operator's edit: source "mc", set now. An unchanged value keeps who set it and when,
        so re-arming with the same numbers does not beat a newer on-station edit. `tx_power` absent from the
        body keeps the assignment's; MC sends none until one is set."""
        now = self._host.now_ms()
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

    def _keep_stored_overrides(self, nid: str, a: dict) -> dict:
        """Overnight review L4: a console from before S-powerup-overrides sends `item_preset` ALONE. When that is the
        preset the stored item came from, the request carries no override key at all, so it cannot mean "back to the
        defaults" (a current console always names RESPAWN beside the preset): keep the stored CHARGES/AMOUNT/RESPAWN.
        Any override key, or a different preset, is the full-replace contract as before."""
        preset = a.get("item_preset")
        if not isinstance(preset, str) or any(k in a for k in _pu.OVERRIDE_KEYS):
            return a
        prev = ((self.stations.get(nid) or {}).get("assigned") or {}).get("item")
        if not prev or _pu.preset_of(prev) != preset:
            return a
        kept: dict = {"spawn_every_s": prev.get("spawn_every_s")}
        if prev.get("kind") == "weapon":
            kept["charges"] = prev.get("charges")
        if prev.get("kind") == "overshield":
            kept["amount"] = prev.get("amount")
        try:
            default = _pu.expand(preset, getattr(self._host.compiler, "catalog", None))
        except (ValueError, KeyError, TypeError):
            return a                           # the main path refuses an unknown preset in its own words
        # only what differs from the preset's default: an unchanged field needs no override (nor its range check)
        return {**a, **{k: v for k, v in kept.items() if v is not None and v != default.get(k)}}

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
                item = _pu.expand(preset, getattr(self._host.compiler, "catalog", None))
                item = _pu.apply_overrides(item, a)   # S-powerup-overrides: same item, overrides included
                if item != prev.get("item"):
                    return None
            except (ValueError, KeyError, TypeError):
                return None
        elif any(a.get(k) is not None for k in _pu.OVERRIDE_KEYS):
            return None   # an override with no item_preset is not a range-only shape; let the main path refuse it
        thr = a.get("threshold", 0)
        if not (isinstance(thr, int) and not isinstance(thr, bool) and (thr == 0 or -100 <= thr <= -30)):
            raise ValueError("threshold must be 0 (the station's own default) or an integer dBm in -100..-30 (the presence bubble)")
        rng = self.range_fields(prev, thr, a)
        if thr == prev["threshold"] and rng.get("tx_power") == prev.get("tx_power"):
            # nothing moved. In play that is not a refusal (the card re-sent what it shows): the view as it is.
            # Outside play the full path runs as before (it re-arms every station).
            return self.station_view(nid) if self._host.in_play() else None
        new = cast(StationAssignment, {**prev, "threshold": thr, **rng, "at": self._host.now_ms()})
        assert st is not None                  # `prev` came from it
        st["assigned"] = new
        self.arm_station(nid)
        self._host._changed()
        return self.station_view(nid)

    def _note_range(self, nid: str, st: dict, body: dict, t_recv: int) -> None:
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
                self._host._log(nid, "range_adopted", {"field": f, "value": value, "edit_at": edit_at}, t_recv)
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
            self._host._on_feed({"t_match_s": self._host._operator_t_match(t_recv), "tag": "STATION", "kind": "info", "text": text})

    def _range_edit_match(self) -> int:
        """A67 polish: the match an on-station edit belongs to, for its attention line. In play or in RECAP it is the
        match that started last; before a START (muster to lobby) it is the match about to start. A line shows while
        its match is the current one, so it clears at the START after its match."""
        return self._range_epoch if self._host.phase in ("armed", "live", "recap") else self._range_epoch + 1

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

    def arm_station(self, nid: str, relock: bool = False) -> bool:
        """Push `station_config` to one assigned station. Best-effort: an offline phone is flagged
        `arm_pending` (roadmap A4 "bring back to re-arm") and armed on its next hello, never retried on a timer."""
        self._host.clear_claims_report(nid)   # O10: the Stick restarts its count at this arm
        st = self.stations.get(nid)
        if st is None:
            return False
        a = st.get("assigned")
        if not a:
            return False
        body = {"kind": a["kind"], "team": a["team"], "id": a["id"], "threshold": self.wire_threshold(nid, st, a),
                "game": self._host._game_byte(), "valid_ids": [x["id"] for x in self.station_ids()]}
        # A67 (F365): how old MC's range values are. The station keeps its own edit when that edit is YOUNGER.
        now = self._host.now_ms()
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
        if self._host.phase == "recap" or (not self._host.in_play() and self._host.game_no_started() and not self._host.lobby_pushed):
            body["ends_in_ms"] = 0
        elif self._host.phase in ("armed", "live") and self._host.start_info and not self._host.is_adopted():
            body["starts_in_ms"] = self._host.start_info["go_live_t"] - now
            if tl_s := self._host.config.get("time_limit_s"):
                body["ends_in_ms"] = max(0, self._host.start_info["go_live_t"] + tl_s * 1000 - now)
        if not self._host.is_adopted() and (self._host.lobby_pushed or self._host.phase in ("armed", "live")) and (tl_s := self._host.config.get("time_limit_s")):
            body["duration_ms"] = tl_s * 1000
        if lock == 0 and st.get("locked_since") is not None and st.get("unlocked_at") is None:
            st["unlocked_at"] = self._host.now_ms()  # the window closes at the unlock, heard or not
        elif lock > 0 and st.get("lock_game") == body["game"]:
            st["unlocked_at"] = None           # ...and reopens at a re-lock, heard or not (abort, then START)
        ok = self._host.net.push(nid, "station_config", body)
        if ok is False:                        # NetServer says "no live socket"; a fake returns None
            # A58: a lock-only re-send (START, END, RECALL, abort, unlock) missing a muster station that is out
            # of Wi-Fi by design is not an assignment it missed, so it raises no BRING IT BACK TO RE-ARM.
            if not relock:
                st["arm_pending"] = True
            return False
        st["arm_pending"] = False
        st["armed"] = {"game": body["game"], "at": self._host.now_ms(), "kind": a["kind"], "team": a["team"], "id": a["id"]}
        self._note_station_lock(st, body["game"], lock)
        return True

    def _station_lock_s(self) -> int:
        """A58: the `lock_s` every `station_config` carries now. A pushed game before START (LOAD) covers the lobby
        wait and the match, since a muster station hears nothing more; ARMED/LIVE is the exact time left
        (a START re-send, or a station back mid-match); anything else, or the operator's unlock, is 0."""
        if self._stations_unlocked:
            return 0
        tl = self._host.config.get("time_limit_s")
        if self._host.phase in ("armed", "live") and self._host.start_info:
            # F337 (c): MC holds no config for an ADOPTED match (`is_adopted`), so `tl` is the operator's
            # draft, not the phones' limit. The draft could unlock a station before the phones stop; the cap
            # cannot. MC never learns the adopted match's own limit, so there is no better number to use.
            if not tl or self._host.is_adopted():
                return STATION_LOCK_MAX_S
            left_ms = self._host.start_info["go_live_t"] + tl * 1000 - self._host.now_ms()
            return max(STATION_LOCK_MARGIN_S, min(STATION_LOCK_MAX_S, -(-left_ms // 1000) + STATION_LOCK_MARGIN_S))
        # F337 (d): a game that is loaded and pushed keeps its stations locked in every pre-match phase, so
        # stepping LOBBY back to KIT (or further) does not unlock a held station that stays in the field.
        # Only END, RECALL, abort, the operator's unlock or a new session send 0 (each clears `lobby_pushed`
        # or sets `_stations_unlocked`).
        if self._host.phase in ("muster", "build", "kit", "lobby") and self._host.lobby_pushed:
            return min(STATION_LOCK_MAX_S, tl + STATION_LOCK_LOBBY_S + STATION_LOCK_MARGIN_S) if tl else STATION_LOCK_MAX_S
        return 0

    def _note_station_lock(self, st: dict, game: int, lock: int) -> None:
        """A58: remember what this station was told, and the lock window a restart is judged against. The
        window opens at the game's first nonzero lock and closes at the first unlock after it."""
        now = self._host.now_ms()
        st["lock"] = {"s": lock, "at": now}
        if lock > 0 and st.get("lock_game") != game:
            st.update(lock_game=game, locked_since=now, unlocked_at=None, restarts=0)
        elif lock > 0:
            st["unlocked_at"] = None             # locked again for the same game (an abort, then a new START)
        elif st.get("locked_since") is not None and st.get("unlocked_at") is None:
            st["unlocked_at"] = now

    def _note_boot(self, st: dict, body: dict, t_recv: int) -> None:
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

    def _keep_tally(self, st: dict, t_recv: int) -> None:
        """A58 (brx4): a restarted Stick resumes its tally from the one saved at its last capture, so a report can
        DROP mid-match. A station's count within one game only grows, so MC keeps the per-team maximum of
        `control.hold_ms` and the largest `revives` for the game the station is armed with, and writes them back
        into the report. A new game or a new assignment starts clean; a beat within one heartbeat of that arming may
        still carry the old tally, so it passes through without seeding the new one (a beat later than that, from a
        station slow to apply the arming, can still seed it: a small race the self-authoritative design accepts).

        F426: `hold_ms`'s keys are the STATION's own tids, and a tid nobody is ROSTERED on is nobody's team --
        most often 2, the sentinel a hill passes through on its way to a real owner (F82) and the same field
        `Scorer.possession()` already excludes from every team's total (`test_a_hills_neutral_time_is_nobodys`).
        Left in here, that neutral time rode the tally into the recap and the ITEMS panel read it back as a
        phantom team nobody picked. Only a rostered tid's ms is kept, mirroring `possession()`'s own rule for
        the same field -- and this runs BEFORE the timing gate below, so it applies even to a beat too close
        to arming to seed the tally (that beat's raw `control` still passes straight through to `rep`)."""
        armed = st.get("armed") or {}
        game, rep = armed.get("game"), st["report"]
        rostered = {t["tid"] for t in self._host.teams}

        def _rostered_tid(k: str) -> bool:
            try:
                return int(k) in rostered
            except (TypeError, ValueError):
                return False

        control = rep.get("control")
        if isinstance(control, dict) and isinstance(control.get("hold_ms"), dict):
            rep["control"] = control = {**control, "hold_ms": {tid: ms for tid, ms in control["hold_ms"].items()
                                                                if _rostered_tid(tid)}}
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
            # F431 (2026-09-26): `hold` above is filtered to rostered tids (F426), but `tally["hold_ms"]`
            # is RESTORED from `session.json` on a resume (`_tally_ok`, no rostered check at all) and
            # only ever grows -- an unrostered tid a past roster edit or an old snapshot left in there
            # would keep riding back into `rep["control"]` forever, unfiltered, because this merge puts
            # `tally["hold_ms"]` LAST. The same rostered-tid filter applies to it here too.
            rostered_tally = {tid: ms for tid, ms in tally["hold_ms"].items() if _rostered_tid(tid)}
            rep["control"] = {**control, "hold_ms": {**hold, **rostered_tally}}
        rv = rep.get("revives")
        if isinstance(rv, int) and not isinstance(rv, bool):
            tally["revives"] = max(rv, tally["revives"] or 0)
            rep["revives"] = tally["revives"]

    def unlock_stations(self) -> dict:
        """A58 `POST /api/stations/unlock`: `lock_s: 0` to every assigned station now. A muster station out of
        Wi-Fi hears it only when it rejoins. The next LOAD push or START locks them again."""
        self._stations_unlocked = True
        out = self.arm_stations(relock=True)
        self._host._changed()
        return {"ok": True, **out}

    def arm_stations(self, relock: bool = False) -> dict:
        """Re-arm every assigned station with the current game number and allow-list. `relock` (A58): only the
        lock moved, so a station out of Wi-Fi is not flagged for re-arming."""
        armed = [nid for nid in self.stations if self.arm_station(nid, relock)]
        pending = [nid for nid, st in self.stations.items() if st.get("assigned") and st.get("arm_pending")]
        return {"armed": len(armed), "pending": pending}

    def station_view(self, nid: str) -> StationView:
        st = self.stations[nid]
        now = self._host.now_ms()
        seen = st.get("last_seen_ms")
        a = st.get("assigned")
        armed = st.get("armed")
        rep = st.get("report") or {}
        attention: list[str] = []
        if a and st.get("arm_pending"):
            attention.append(STATION_BRING_BACK)            # assignment changed with the phone out of range
        if a and armed and armed.get("game") != self._host._game_byte():
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
        if (dropped := self._host._node_loss(self._host.nodes.get(nid) or {}, "claims")) > 0:
            attention.append(station_claims_dropped_line(dropped, a["id"] if a else rep.get("station_id")))   # O10
        if (nvs_fail := rep.get("nvs_fail")) and isinstance(nvs_fail, int) and not isinstance(nvs_fail, bool) and nvs_fail > 0:
            attention.append(station_nvs_line(nvs_fail))   # O12
        online_now = bool(seen) and not bool((self._host.nodes.get(nid) or {}).get("stale"))
        if online_now and is_stick(st) and station_fw_too_old(st.get("app_ver")):   # a stale report of an offline Stick says nothing now
            attention.append(STATION_FW_TOO_OLD)            # O13
        report: StationReport = {}
        kind = rep.get("kind")
        if is_station_kind(kind):
            report["kind"] = kind
        for key in ("team", "station_id", "threshold", "revives", "uptime_s", "boot_count", "nvs_fail"):
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
        # against a dead socket. `self._host.nodes[nid]["stale"]` is the fact that already answers this (the
        # net layer's own STALE_AFTER_MS = 8 s freshness judgement) -- reuse it instead of a second,
        # much more lenient rule that disagreed with it.
        node_stale = bool((self._host.nodes.get(nid) or {}).get("stale"))
        lock = st.get("lock") or {}
        restarts = st.get("restarts", 0) if st.get("lock_game") == self._host._game_byte() else 0
        if a:
            attention.extend(self.station_tamper_flags(a["id"], report.get("assoc"), lock, restarts,
                                                        online=bool(seen) and not node_stale, now=now))
        view: StationView = {"node_id": nid, "assigned": a, "armed": armed, "arm_pending": bool(st.get("arm_pending")),
                "report": report, "app_ver": st.get("app_ver"), "platform": st.get("platform"),   # A29
                "last_seen_ms": (now - seen) if seen else None,
                "online": bool(seen) and not node_stale,
                "attention": attention, "game": self._host._game_byte()}
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
        pu, row, go = self._host.pu_state(nid) if self._host.phase in ("armed", "live") else (None, None, None)
        if pu is not None and row is not None and go is not None:  # A56: only while a schedule runs for this match
            view["item_available"] = row["available"]
            view["next_spawn_at_ms"] = _pu.spawn_at(row["item"], go, row["next_k"])
            if row.get("taken_by") is not None:
                view["taken_by"] = row["taken_by"]
        return view

    def station_tamper_flags(self, sid: int, assoc: str | None, lock: dict, restarts: int, *, online: bool,
                              now: int) -> list[str]:
        """A58: the tamper flags. A restart inside the lock window; a HELD station gone stale while the match
        is in play (a muster station is out of Wi-Fi by design); and, in LOBBY, a muster station (or a HELD one gone
        offline) whose LOAD lock would run out before the match could end, so the operator can send it through muster again."""
        out: list[str] = []
        if restarts:
            out.append(f"STATION #{sid} RESTARTED" + (f" {restarts} TIMES" if restarts > 1 else "")
                       + ": CHECK THE STATION")
        if assoc == "held" and not online and self._host.phase in ("armed", "live"):
            out.append(f"STATION #{sid} OFFLINE: CHECK IT IS ON AND IN RANGE")
        tl = self._host.config.get("time_limit_s")
        # A HELD Stick carried out of Wi-Fi before START (the A68 field model) cannot hear START's relock either.
        if ((assoc == "muster" or (assoc == "held" and not online)) and self._host.phase == "lobby" and tl and lock.get("s")
                and now + (DEFAULT_RUNWAY_S + tl) * 1000 > lock["at"] + lock["s"] * 1000):
            out.append(f"STATION #{sid} LOCK EXPIRES MID-MATCH: TAKE IT BACK THROUGH MUSTER")
        return out

    def stations_view(self) -> list[StationView]:
        return [self.station_view(nid) for nid in sorted(self.stations)]

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
        StationRegistry._merge_station_recap_report(rec, rep)
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
