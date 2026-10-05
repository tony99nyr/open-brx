"""Session snapshot persistence and restore."""
from __future__ import annotations

import copy
import json
import re
import time
from pathlib import Path
from typing import Any, Callable, Protocol, cast

from . import compile as _compile
from .clockwatch import ClockWatch
from . import gamepick as _gamepick
from . import policy as _policy
from . import presentation as _pres
from .failures import FailureTrack
from .scoring import Scorer
from ..modes.registry import validate_mode_params as _validate_mode_params
from .stations import StationRegistry
from .types import (MAX_PLAYERS, SESSION_STORE_V, STATION_TEAM_ANY, FrameBundle, GameConfig,
                    GamePick, LastMatch, Loadout, LoadoutOverrides, LoadoutPool, PerkView, Phase,
                    Player, RecapStationRow, RestoredFromView, RestoreFailedView, Team, Weapon,
                    WeaponSel, is_station_kind, parse_win_by)


class SnapshotHost(Protocol):
    station_registry: StationRegistry
    _persist_path: Path | None
    _persist_last: float
    _persist_dirty: bool
    now_ms: Callable[[], int]
    players: dict[str, Player]
    standby: dict[str, Player]
    teams: list[Team]
    config: GameConfig
    nodes: dict[str, dict]
    feed: list[dict]
    _feed_seq: int
    game_pick: GamePick
    last_match: LastMatch | None
    game_no: int
    _game_no_started: bool
    join_secret: str
    _ended: dict[str, dict]
    _resume_pending: dict | None
    _pu_restored: dict | None
    _match_end_t: int | None
    _sync_pending: dict[str, str]
    restored_from: RestoredFromView | None
    demo_session: bool
    _pu_sched: dict
    _match_players: dict[str, Player] | None
    _match_nodes: dict[str, str]
    _departed_match_stations: dict[str, RecapStationRow]
    phase: Phase
    start_info: dict | None
    scorer: Scorer | None
    node_player: dict[str, str]
    synced_at_lobby: dict[str, bool]
    clock_watch: ClockWatch
    bundles: dict[str, FrameBundle]
    acks: dict[str, dict]
    store: Any

    @property
    def restore_failed(self) -> RestoreFailedView | None: ...

    @restore_failed.setter
    def restore_failed(self, value: RestoreFailedView | None) -> None: ...

    @property
    def _snapshot_failures(self) -> FailureTrack: ...

    def _notify_listeners(self) -> None: ...
    def _render_join(self) -> str: ...
    def _validate(self, roster: list[Player] | None = None) -> dict: ...
    def _gun_index(self) -> Any: ...
    def _catalog_rows(self) -> tuple[list[Weapon], list[PerkView]]: ...
    def _keep_bad_snapshot(self) -> Path | None: ...
    def loadout_pool(self) -> LoadoutPool: ...
    def in_play(self) -> bool: ...
    def is_adopted(self) -> bool: ...
    def current_match_id(self) -> str | None: ...


class SnapshotCodec:
    def __init__(self, host: SnapshotHost, defaults: Callable[[str], GameConfig],
                 mvp_modes: frozenset[str], migrate_teams: Callable[[Any], list[Team]],
                 migrate_player: Callable[[Any], Any]):
        self.host = host
        self.defaults = defaults
        self.mvp_modes = mvp_modes
        self.migrate_teams = migrate_teams
        self.migrate_player = migrate_player
        self.snapshot_failures = FailureTrack("session snapshot", host.now_ms)
        self.restore_failed: RestoreFailedView | None = None

    def _persist(self):
        if not self.host._persist_path:
            return
        now = time.monotonic()
        if now - self.host._persist_last < 2.0:
            self.host._persist_dirty = True      # a delayed flush (persist_now via atexit/transitions) picks this up
            return
        self.host._persist_last = now
        self.host._persist_dirty = False
        try:
            # S5(a): keep assigned stations across an MC restart. Unassigned hellos need no saved row.
            station = self.host.station_registry.to_snapshot()
            snap = {"v": SESSION_STORE_V, "saved_ms": self.host.now_ms(),
                    # F142: mark the run kind so a demo roster cannot enter a real session.
                    "demo": bool(self.host.demo_session),
                    "players": [{**p, "node_id": None, "ready": False} for p in self.host.players.values()],
                    "standby": [{**p, "node_id": None, "ready": False} for p in self.host.standby.values()],
                    "teams": self.host.teams, "config": self.host.config, "game_pick": self.host.game_pick,
                    **({"last_match": self.host.last_match} if self.host.last_match else {}),
                    "stations": station["stations"],
                    "game_no": self.host.game_no, "game_no_started": self.host._game_no_started,
                    "feed": [dict(row) for row in self.host.feed[:200] if isinstance(row, dict)],
                    "sync_pending": {"end_t": self.host._match_end_t, "nodes": dict(self.host._sync_pending)},
                    "station_ids": station["station_ids"],
                    "station_departures": station["station_departures"],
                    "stations_unlocked": station["stations_unlocked"],
                    "station_locks": station["station_locks"],
                    "station_range_seen": station["station_range_seen"],
                    "range_epoch": station["range_epoch"],
                    "join_secret": self.host.join_secret,
                    **({"match": m} if (m := self._match_snapshot()) else {}),
                    "ended": self._ended_snapshot(),
                    **({"powerups": self.host._pu_sched} if self.host._pu_sched and self.host.in_play()
                       and self.host._pu_sched.get("match_id") == self.host.current_match_id() else {})}
            # 0600: the snapshot holds the join secret. Atomic writing preserves the previous file on a crash.
            from ..storage import atomic_write_text
            atomic_write_text(self.host._persist_path, json.dumps(snap), mode=0o600)
            if self.host._snapshot_failures.ok():
                self.host._notify_listeners()
        except Exception as e:
            if self.host._snapshot_failures.fail(e, "play continues"):
                self.host._notify_listeners()

    def _match_snapshot(self) -> dict | None:
        """The running match, as `resume_match` needs it. Only while ARMED or LIVE with a scorer."""
        if not self.host.in_play() or not self.host.start_info or not self.host.scorer:
            return None
        si = self.host.start_info
        players = self.host._match_players if self.host._match_players is not None else self.host.players
        return {"match_id": si["match_id"], "go_live_t": si["go_live_t"], "seq": si["seq"],
                "countdown_s": si.get("countdown_s", 0), "adopted": self.host.is_adopted(),
                "live": self.host.phase == "live",   # F451: a resume after a backward clock step must not re-arm it
                "config": self.host.config, "players": {pid: dict(p) for pid, p in players.items()},
                "node_player": {nid: pid for nid, pid in {**self.host._match_nodes, **self.host.node_player}.items()
                                if pid in players},
                "synced_at_lobby": dict(self.host.synced_at_lobby),
                "clock_suspect": self.host.clock_watch.to_snapshot(),    # F474
                "joined_t": dict(self.host.scorer.joined_t),
                "cap_recv": self.host.scorer.cap_recv,
                "alerts": self.host.scorer.match_state_alerts(),
                "departed_stations": [dict(row) for row in sorted(
                    self.host._departed_match_stations.values(), key=lambda row: row["node_id"])],
                "bundles": self.host.bundles, "acks": self.host.acks,
                "store_path": str(self.host.store.path) if self.host.store is not None and getattr(self.host.store, "path", None) else None}

    def _ended_snapshot(self) -> list[dict]:
        """The newest few A34 ledger rows, JSON-safe. A bad row is dropped, never fatal."""
        out = []
        for mid, e in list(self.host._ended.items())[-4:]:
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
    def snapshot_departed_station(row: object) -> RecapStationRow | None:
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

    _RESTORE_ATTRS = ("players", "feed", "standby", "teams", "config", "game_pick", "last_match",
                      "nodes", "game_no", "_game_no_started", "join_secret", "_ended",
                      "_resume_pending", "_pu_restored", "_feed_seq", "_match_end_t", "_sync_pending", "restored_from")

    def _move_aside(self, suffix: str) -> Path | None:
        path = self.host._persist_path
        if path is None:
            return None
        from ..storage import move_aside_exclusive
        kept = move_aside_exclusive(path, suffix)
        if kept is not None:
            import contextlib, os
            with contextlib.suppress(OSError):
                os.chmod(kept, 0o600)
        return kept

    def _keep_bad_snapshot(self) -> Path | None:
        if self.host._persist_path is None:
            return None
        kept = self._move_aside("bad")
        if kept is None:
            import logging
            logging.getLogger("brx.mc").error("could not move the bad session snapshot aside")
        return kept

    def restore_snapshot(self) -> int:
        """Load a session snapshot of the same demo or real kind.

        F142: a demo roster once appeared in a real session as ghost players. The file's run kind
        decides whether restore is safe; the roster cannot identify that kind reliably.
        """
        if not self.host._persist_path or not self.host._persist_path.exists():
            return 0
        before = {a: copy.deepcopy(getattr(self.host, a)) for a in self._RESTORE_ATTRS}
        before_registry = self.host.station_registry.capture_state()
        try:
            snap = json.loads(self.host._persist_path.read_text())
            v = snap.get("v") if isinstance(snap, dict) else None
            if isinstance(snap, dict) and "v" in snap and (type(v) is not int or v != SESSION_STORE_V):
                tag = re.sub(r"[^0-9A-Za-z]", "", str(v))[:8] or "x"
                kept = self._move_aside(f"v{tag}")
                import logging
                logging.getLogger("brx.mc").warning(
                    "session snapshot has store version %r; this MC reads %d. Kept as %s; starting clean",
                    v, SESSION_STORE_V, kept)
                version = json.dumps(v)[:80]
                if kept is None:
                    self.host._persist_path = None
                    self.host.restore_failed = {"reason": f"snapshot version {version} could not be kept aside",
                                                "kept": None}
                else:
                    # the banner adds "KEPT AT <path>" itself: the reason names only the cause
                    self.host.restore_failed = {"reason": f"saved by an MC with store version {version}; this MC reads {SESSION_STORE_V}",
                                                "kept": str(kept)}
                return 0
            was_demo = bool(snap.get("demo", False))
            if was_demo != bool(self.host.demo_session):
                import logging
                logging.getLogger("brx.mc").warning(
                    "session snapshot at %s is from a %s run and this is a %s run — NOT restoring its "
                    "%d player(s)", self.host._persist_path, "demo" if was_demo else "real",
                    "demo" if self.host.demo_session else "real", len(snap.get("players") or []))
                return 0
            self.host.players = {p["player_id"]: self.migrate_player(p) for p in snap.get("players", [])}
            sp = snap.get("sync_pending")
            if isinstance(sp, dict) and isinstance(sp.get("end_t"), int) and isinstance(sp.get("nodes"), dict):
                self.host._match_end_t = sp["end_t"]
                self.host._sync_pending = {str(k): str(v) for k, v in sp["nodes"].items()}
            rows = snap.get("feed")
            self.host.feed = [dict(row) for row in rows if isinstance(row, dict)][:200] if isinstance(rows, list) else []
            # F454: feed row ids never repeat; the counter resumes from the highest restored id
            self.host._feed_seq = max([r["id"] for r in self.host.feed if isinstance(r.get("id"), int)]
                                      + [self.host._feed_seq])
            parked: dict[str, Player] = {}
            invalid_parked = 0
            for q in snap.get("standby") or []:
                player = self._snapshot_player(self.migrate_player(q))
                if player is not None:
                    parked[player["player_id"]] = player
                else:
                    invalid_parked += 1
            if invalid_parked:
                import logging
                logging.getLogger("brx.mc").warning("ignored %d malformed standby player row(s) in %s",
                                                     invalid_parked, self.host._persist_path)
            self.host.standby = parked
            if snap.get("teams"):
                self.host.teams = self.migrate_teams(snap["teams"])
            if snap.get("config"):
                self.host.config = snap["config"]
                if isinstance(self.host.config.get("teams"), list):
                    self.host.config["teams"] = self.migrate_teams(self.host.config["teams"])
                try:
                    if _compile.check_game_volume(self.host.config.get("volume")) is None:
                        self.host.config.pop("volume", None)
                except ValueError:
                    self.host.config.pop("volume", None)
            gp = snap.get("game_pick")
            self.host.game_pick = cast(GamePick, gp if _gamepick.looks_like_pick(gp) else
                                       _gamepick.derive_pick_from_config(self.host.config, self.mvp_modes))
            lm = snap.get("last_match")
            self.host.last_match = cast(LastMatch, lm) if isinstance(lm, dict) else None
            # S5(a): the phone forgets MC across a restart. Restore the assignment unarmed;
            # its next hello sends station_config. Restore the game byte so the next muster advances it.
            for nid in self.host.station_registry.restore(snap):
                self.host.nodes.setdefault(nid, {"node_id": nid, "node_type": "utility", "arm_state": "idle",
                                                 "synced": False, "last_seen_ms": 0})
            self.host.game_no = snap.get("game_no", self.host.game_no)
            self.host._game_no_started = bool(snap.get("game_no_started", False))
            if isinstance(snap.get("join_secret"), str) and snap["join_secret"]:
                self.host.join_secret = snap["join_secret"]     # A28.2: the QRs already printed stay valid
                self.host._render_join()
            for row in snap.get("ended") or []:
                if isinstance(row, dict) and isinstance(row.get("match_id"), str) and row["match_id"]:
                    players = row.get("players") if isinstance(row.get("players"), dict) else None
                    recap = row.get("recap") if isinstance(row.get("recap"), dict) else None
                    at = row.get("ended_ms")
                    self.host._ended[row["match_id"]] = {"recap": recap, "players": players,
                                                    "ended_ms": at if isinstance(at, int) else self.host.now_ms()}
            if isinstance(snap.get("match"), dict):
                # F-2026-09-17d: resume needs the outer saved time to reject an old match.
                self.host._resume_pending = {**snap["match"], "_saved_ms": snap.get("saved_ms")}
                rp = self.host._resume_pending
                if isinstance(rp.get("config"), dict) and isinstance(rp["config"].get("teams"), list):
                    rp["config"] = {**rp["config"], "teams": self.migrate_teams(rp["config"]["teams"])}
                if isinstance(rp.get("players"), dict):
                    rp["players"] = {k: self.migrate_player(v) for k, v in rp["players"].items()}
                if isinstance(snap.get("powerups"), dict):
                    self.host._pu_restored = snap["powerups"]      # A56 (M1): adopted for this same match only
            self._repair_player_nums()
            self.host.config["health"] = _compile.normalize_health(self.host.config.get("health"))
            old_scoring = self.host.config.get("scoring") if isinstance(self.host.config.get("scoring"), dict) else {}
            mode_scoring = self.defaults(self.host.config["mode"])["scoring"]
            self.host.config["scoring"] = cast(Any, {
                "frag_limit": old_scoring.get("frag_limit", mode_scoring["frag_limit"]),
                "win_by": parse_win_by(old_scoring.get("win_by"), mode_scoring["win_by"]),
            })
            self.host.config["loadout_policy"] = _policy.normalize(self.host.config.get("loadout_policy"), self.host.config["mode"])
            mp, _errs = _validate_mode_params(self.host.config["mode"], self.host.config.get("mode_params") or {})
            if mp:
                self.host.config["mode_params"] = mp
            else:
                self.host.config.pop("mode_params", None)
            if not isinstance(self.host.config.get("presentation"), dict):
                self.host.config["presentation"] = _pres.default_for(self.host.config["mode"])
            for pl in self.host.players.values():                      # a pre-A10 snapshot has no `perk` key; fine
                pl["loadout"] = _policy.apply(self.host.config["loadout_policy"], self.host.loadout_pool(), pl.get("loadout") or {"weapons": []},
                                              *self.host._catalog_rows())
            self.host._gun_index()
            if self.host.players:
                # F142: show the restored roster on the board. Validate the file's saved time before
                # the UI uses it as a date; an edited snapshot may contain a string or null.
                at = snap.get("saved_ms")
                at = int(at) if isinstance(at, (int, float)) and not isinstance(at, bool) else None
                self.host.restored_from = {"at": at, "players": len(self.host.players)}
            if self.host._sync_pending:
                self.host._validate()     # F401: LOAD's sync warning shows at once after a restart, not on the next edit
            return len(self.host.players)
        except Exception as exc:
            import logging; logging.getLogger("brx.mc").exception("session snapshot restore failed — starting clean")
            for attr, value in before.items():     # nothing half-restored: every assigned field goes back
                setattr(self.host, attr, value)
            self.host.station_registry.restore_state(before_registry)
            try:
                self.host._render_join()
                self.host._validate()
            except Exception:
                logging.getLogger("brx.mc").exception("rebuilding derived state after a failed restore also failed")
            kept = self.host._keep_bad_snapshot()
            if kept is None:
                logging.getLogger("brx.mc").error("session saving is OFF for this run: %s could not be moved aside",
                                                  self.host._persist_path)
                self.host._persist_path = None
            self.host.restore_failed = {"reason": f"{type(exc).__name__}: {exc}"[:200],
                                   "kept": str(kept) if kept else None}
            return 0
    def _repair_player_nums(self) -> None:
        """Give every restored player a unique 1..63 `player_num`.

        The number is the `$PSET` player id. A duplicate makes two guns answer to one id,
        so hits can count for the wrong player. Old restores trusted file numbers until a
        config change, which let an edited or merged snapshot arm with duplicate ids.
        The first player keeps a valid number.
        """
        seen: set[int] = set()
        needs: list[Player] = []
        for p in self.host.players.values():
            n = p.get("player_num")
            ok = isinstance(n, int) and not isinstance(n, bool) and 1 <= n <= MAX_PLAYERS and n not in seen
            if ok:
                seen.add(n)
            else:
                needs.append(p)
        if not needs:
            return
        import logging
        base = int(self.host.config.get("player_num_base") or 1)
        # Prefer the configured range, but use free numbers below it before dropping a player.
        # Restoring a roster must preserve every player the wire's 1..63 range can hold.
        start = max(1, min(base, MAX_PLAYERS))
        order = list(range(start, MAX_PLAYERS + 1)) + list(range(1, start))
        free = (n for n in order if n not in seen)
        for p in needs:
            n = next(free, None)
            if n is None:                                  # roster fuller than the wire allows
                logging.getLogger("brx.mc").error(
                    "snapshot has more players than player_nums (%d) — dropping %s", MAX_PLAYERS, p.get("display"))
                self.host.players.pop(p["player_id"], None)
                continue
            logging.getLogger("brx.mc").warning(
                "snapshot player_num %r for %s was invalid or taken — reassigned to %d",
                p.get("player_num"), p.get("display"), n)
            p["player_num"] = n
            seen.add(n)
