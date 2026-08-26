"""M-MC Session — the match state machine (docs/spec/mission-control.md, contracts.md §5/§6 A5).

Owns: phase, roster (player_num), teams, GameConfig draft, node registry, readiness rollup,
kit-out/tutorial pushes, lobby push + acks, start/reschedule/abort, controls, hydrate answer,
and the Scorer for the current match. Everything the UI sees is `snapshot()` (API.md State).
"""
from __future__ import annotations

import copy
import time
import uuid
from typing import Any, Callable

from .scoring import Scorer
from .types import (DEFAULT_RUNWAY_S, MAX_PLAYERS, STALE_AFTER_MS, SYNC_FRESH_MS, GameConfig, Player,
                    ReadinessRow, ReadinessSnapshot, ScanRow, Team)

PHASES = ("muster", "build", "kit", "lobby", "armed", "live", "recap")

TEAM_DEFS = {  # $TID: 1=blue, 2=yellow, 0=red (protocol §7i); green provisional 3
    "blue": {"team_id": "blue", "name": "BLUE TEAM", "color": "#3a86ff", "tid": 1},
    "yellow": {"team_id": "yellow", "name": "YELLOW TEAM", "color": "#ffd23f", "tid": 2},
    "red": {"team_id": "red", "name": "RED TEAM", "color": "#ff5252", "tid": 0},
    "green": {"team_id": "green", "name": "GREEN TEAM", "color": "#2ecc71", "tid": 3},
    "ffa": {"team_id": "ffa", "name": "FREE-FOR-ALL", "color": "#e8eef5", "tid": 1},
}

# Briefing copy verbatim from the Mission Control design export (A2 mode briefing panel).
MODES = [
    {"mode": "tdm", "name": "TEAM DEATHMATCH", "abbr": "TDM", "desc": "Teams score per elimination",
     "brief": "Squads score a point per elimination. Downed players respawn after the delay and rejoin. First team to the score cap — or the highest score at the time limit — takes the match.",
     "teams_text": "2–4 TEAMS", "win_text": "SCORE CAP / TIME", "respawn_text": "ON · TIMED",
     "teams": ["blue", "yellow"], "win_by": "kills", "frag_limit": 25, "respawn": {"type": "auto", "delay_s": 15}},
    {"mode": "ffa", "name": "FREE-FOR-ALL", "abbr": "FFA", "desc": "Every operator for themselves",
     "brief": "No teams — everyone is a target. Each elimination scores a point. First to the frag limit, or the top score when time expires, wins.",
     "teams_text": "NONE · ALL VS ALL", "win_text": "FRAG LIMIT / TIME", "respawn_text": "ON · TIMED",
     "teams": ["ffa"], "win_by": "kills", "frag_limit": 25, "respawn": {"type": "auto", "delay_s": 15}},
    {"mode": "infection", "name": "INFECTION", "abbr": "INF", "desc": "One infected; survive the spread",
     "brief": "One operator starts infected. Survivors who go down switch sides and hunt their old squad. Survivors win by outlasting the clock; the infected win by converting everyone.",
     "teams_text": "SURVIVORS VS INFECTED", "win_text": "SURVIVE THE CLOCK", "respawn_text": "INFECTED ONLY",
     "teams": ["blue", "red"], "win_by": "survival", "frag_limit": None, "respawn": {"type": "auto", "delay_s": 10}},
    {"mode": "lms", "name": "LAST MAN STANDING", "abbr": "LMS", "desc": "Limited lives, last alive wins",
     "brief": "Every operator carries a fixed pool of lives. Once they are spent there is no respawn. The last operator — or last squad — still standing takes the match.",
     "teams_text": "SOLO OR SQUADS", "win_text": "LAST ALIVE", "respawn_text": "OFF · LIVES",
     "teams": ["ffa"], "win_by": "survival", "frag_limit": None, "respawn": {"type": "none", "delay_s": 0}},
    {"mode": "extraction", "name": "EXTRACTION", "abbr": "EXT", "desc": "Reach the objective and hold it",
     "brief": "Attackers push to the extraction point and hold it through the capture timer. Defenders deny until time expires. Sides swap between rounds.",
     "teams_text": "2 TEAMS", "win_text": "HOLD TO CAPTURE", "respawn_text": "ON · TIMED",
     "teams": ["blue", "yellow"], "win_by": "objective", "frag_limit": None, "respawn": {"type": "auto", "delay_s": 15}},
]


def default_config(mode: str = "tdm") -> GameConfig:
    m = next(x for x in MODES if x["mode"] == mode)
    return {"config_id": uuid.uuid4().hex[:8], "mode": mode, "environment": "outdoor", "night": False,
            "time_limit_s": 600, "respawn": dict(m["respawn"]),
            "scoring": {"frag_limit": m["frag_limit"], "win_by": m["win_by"]},
            "health": {"max_hp": 45, "max_armor": 70},
            "teams": [dict(TEAM_DEFS[t]) for t in m["teams"]]}


class Session:
    def __init__(self, compiler, net, armory, store=None, now_ms: Callable[[], int] | None = None,
                 lan: dict | None = None):
        self.compiler, self.net, self.armory, self.store = compiler, net, armory, store
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
        self.synced_at_lobby: dict[str, bool] = {}
        self.scan_rows: list[ScanRow] = []
        self.lan = lan or {"mode": "unknown", "ip": "0.0.0.0", "port": 0, "ws_url": "", "qr": ""}
        self.trying: dict[str, str] = {}          # player_id -> weapon_id
        self.lobby_pushed = False
        self.acks: dict[str, dict] = {}
        self.bundles: dict[str, dict] = {}
        self.start_info: dict | None = None
        self.start_seq = 0
        self.scorer: Scorer | None = None
        self._score_pushed: dict[str, dict] = {}   # A7: last ScoreRow pushed per player
        self._log_bytes: dict[str, int] = {}       # per-node pulled-log byte budget
        self.last_recap: dict | None = None
        self.feed: list[dict] = []
        self._listeners: list[Callable[[], None]] = []
        self._feed_listeners: list[Callable[[dict], None]] = []
        self._attach_net()
        self._gun_index()

    # ---------- plumbing ----------
    def on_change(self, cb): self._listeners.append(cb)
    def on_feed(self, cb): self._feed_listeners.append(cb)
    def _changed(self):
        for cb in self._listeners:
            cb()
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
        try:
            ji = n.join_info()
            self.lan.update({"ws_url": ji.get("url", ""), "qr": ji.get("qr", ji.get("url", ""))})
        except Exception:
            pass

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
                   voice: str = "male", loadout: dict | None = None) -> Player:
        if len(self.players) >= MAX_PLAYERS:
            raise ValueError("roster full")
        pid = uuid.uuid4().hex[:8]
        team_id = self._check_team(team_id)
        if team_id is None and self.teams:
            counts = {t["team_id"]: 0 for t in self.teams}
            for p in self.players.values():
                if p["team_id"] in counts:
                    counts[p["team_id"]] += 1
            team_id = min(counts, key=lambda k: (counts[k], list(counts).index(k)))
        p: Player = {"player_id": pid, "player_num": self._next_num(), "display": display.strip().upper() or f"OPERATOR {pid[:4]}",
                     "team_id": team_id, "node_id": None, "gun_id": gun_id,
                     "loadout": loadout or {"weapons": [{"weapon_id": "assault_rifle"}]}, "voice": voice, "ready": False}
        self.players[pid] = p
        if self.scorer:
            self.scorer.register_player(pid, p)      # A5.6 late joiner: scorable in the running match
        if gun_id:
            self._adopt_node_for_gun(p)
        self._after_player_change(p, new=True)
        return p

    def patch_player(self, pid: str, **fields) -> Player:
        p = self.players[pid]
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
        if "voice" in fields and fields["voice"] is not None:
            v = fields["voice"]
            if not isinstance(v, str) or v not in self._voice_ids():
                raise ValueError("unknown voice")
        if "ready" in fields and fields["ready"] is not None and not isinstance(fields["ready"], bool):
            raise ValueError("ready must be a boolean")
        if "display" in fields and fields["display"] is not None:
            d = str(fields["display"]).strip().upper()[:24]
            if not d:
                raise ValueError("display must not be empty")
            fields["display"] = d
        for k in ("display", "team_id", "voice", "loadout", "player_num", "gun_id", "ready"):
            if k in fields and fields[k] is not None or (k in fields and k in ("team_id", "gun_id")):
                p[k] = fields[k]
        if "team_id" in fields and self.scorer and pid in self.scorer.stats:
            self.scorer.stats[pid].team_id = p["team_id"]   # team scores + friendly rule follow a mid-match re-team
        if "gun_id" in fields:
            self._adopt_node_for_gun(p)
        self._after_player_change(p)
        return p

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
        """Loadout must be {weapons: [{weapon_id: str}, …], overrides?: {max_hp?, max_armor?}}; ids from the catalog when known."""
        if not isinstance(lo, dict) or not isinstance(lo.get("weapons"), list) or not lo["weapons"]:
            raise ValueError("loadout must be {weapons: [{weapon_id}, ...]}")
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
        ov = lo.get("overrides")
        if ov is not None:
            if not isinstance(ov, dict):
                raise ValueError("loadout.overrides must be an object")
            clean = {}
            for k in ("max_hp", "max_armor"):
                if k in ov and ov[k] is not None:
                    if isinstance(ov[k], bool) or not isinstance(ov[k], int) or not 1 <= ov[k] <= 999:
                        raise ValueError(f"overrides.{k} must be an integer 1..999")
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
        self.acks.pop(pid, None); self.bundles.pop(pid, None); self.trying.pop(pid, None)
        self._changed()

    def _after_player_change(self, p: Player, new: bool = False):
        if p.get("node_id"):
            self.net.push(p["node_id"], "assign", {"player": p, "team": self.team(p["team_id"]), "roster": self.roster()})
            if self.lobby_pushed:
                self._push_config_to(p)
                if self.start_info:
                    self.net.push(p["node_id"], "start", self._start_body())
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
        p["ready"] = ready
        if self.phase in ("kit",) and ready:
            self.phase = "lobby"
        self._changed()
        return p

    # ---------- config ----------
    def modes(self) -> list[dict]:
        return [{**m, "defaults": default_config(m["mode"])} for m in MODES]

    _CONFIG_KEYS = {"mode", "environment", "night", "time_limit_s", "respawn", "scoring",
                    "health", "teams", "led", "player_num_base"}

    def set_config(self, patch: dict) -> dict:
        if not isinstance(patch, dict):
            raise ValueError("config must be an object")
        if self.phase not in ("muster", "build", "kit", "lobby"):
            raise ValueError("cannot change config after the match has started")
        mode = patch.get("mode", self.config["mode"])
        if not isinstance(mode, str) or mode not in {m["mode"] for m in MODES}:
            raise ValueError(f"unknown mode {mode!r}")
        cfg = default_config(mode) if mode != self.config["mode"] else copy.deepcopy(self.config)
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
                if k == "scoring":
                    fl = merged.get("frag_limit")
                    if fl is not None and not (isinstance(fl, int) and not isinstance(fl, bool) and fl > 0):
                        raise ValueError("scoring.frag_limit must be a positive integer or null")
                if k == "health":
                    for hk in ("max_hp", "max_armor"):
                        hv = merged.get(hk, 0)
                        lo = 1 if hk == "max_hp" else 0
                        if not (isinstance(hv, int) and not isinstance(hv, bool) and lo <= hv <= 255):
                            raise ValueError(f"health.{hk} must be {lo}..255")
                cfg[k] = merged
            elif k == "teams":
                if not (isinstance(v, list) and all(isinstance(t, dict) and "team_id" in t
                                                   and isinstance(t.get("tid"), int) and not isinstance(t.get("tid"), bool) for t in v)):
                    raise ValueError("teams must be a list of team objects with team_id + integer tid")
                cfg[k] = v
            elif k == "led":
                if v is not None and not isinstance(v, dict):
                    raise ValueError("led must be an object")
                cfg[k] = v
            elif k == "player_num_base":
                if not (isinstance(v, int) and not isinstance(v, bool) and 1 <= v <= MAX_PLAYERS):
                    raise ValueError("player_num_base must be 1..63")
                cfg[k] = v
            else:
                cfg[k] = v
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
        res = self._validate()
        self._changed()
        return {"ok": res["ok"], "errors": res["errors"], "config": self.config}

    def _validate(self) -> dict:
        try:
            res = self.compiler.validate(self.config, list(self.players.values()), None)
        except Exception as e:  # a broken compiler must not take MC down
            res = {"ok": False, "errors": [f"validate failed: {e}"]}
        self.config_errors = list(res.get("errors", []))
        self.config_warnings = list(res.get("warnings", []))
        return res

    # ---------- nodes ----------
    def _touch(self, nid: str, stale: bool | None = None):
        nv = self.nodes.setdefault(nid, {"node_id": nid, "node_type": "phone", "arm_state": "idle", "last_seen_ms": 0, "synced": False})
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
            if g and ((base and g["sticker"].lower() == base) or (tail and g["ble"].get("tail", "").lower() == tail)):
                return p
            if gid in {x for x in (base, full) if x}:
                return p
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
        self.nodes.setdefault(nid, {"node_id": nid})["player_id"] = p["player_id"]
        if self.phase in ("kit", "lobby", "armed") and self.nodes.get(nid, {}).get("synced"):
            self.synced_at_lobby[nid] = True   # same pre-live gate as _on_status (A5.7)
        # A5.6 late joiner: a node binding a player after the lobby push gets its bundle (+ the running start) now.
        if self.lobby_pushed and p["player_id"] not in self.bundles:
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
        self._changed()
        return known

    def _prune_unbound_nodes(self):
        """Cap hello-only node records that never bound a player (net.md §8 memory)."""
        unbound = [nid for nid, nv in self.nodes.items() if nid not in self.node_player]
        if len(unbound) > 256:
            now = self.now_ms()
            for nid in sorted(unbound, key=lambda x: self.nodes[x].get("last_seen_ms", 0))[:len(unbound) - 256]:
                if now - self.nodes[nid].get("last_seen_ms", 0) > 600_000:
                    self.nodes.pop(nid, None)

    def _on_node(self, n: dict):
        nid = n["node_id"]
        nv = self.nodes.setdefault(nid, {"node_id": nid, "arm_state": "idle", "synced": False})
        nv.update({k: v for k, v in n.items() if k in ("node_type", "gun_name", "gun_tail", "fw")})
        nv["last_seen_ms"] = self.now_ms()
        # The gun the node reports NOW wins over a hydrate-era player_id (a re-bind to another gun moves the node).
        p = self._find_player_for_gun(n.get("gun_name"), n.get("gun_tail")) if (n.get("gun_name") or n.get("gun_tail")) else None
        if p is None and n.get("player_id") in self.players:
            p = self.players[n["player_id"]]
        if p:
            self._bind(nid, p)
        self._prune_unbound_nodes()
        self._changed()
        return self.node_player.get(nid)

    def _hydrate(self, hello: dict) -> dict | None:
        gun = hello.get("gun") or {}
        p = self._find_player_for_gun(gun.get("name"), gun.get("tail"))
        if not p:
            pid = self.node_player.get(hello.get("node_id", ""))
            p = self.players.get(pid) if pid else None
        if not p:
            return None
        self._bind(hello["node_id"], p)
        node = {"player": p, "team": self.team(p["team_id"]), "roster": self.roster()}
        if self.lobby_pushed:
            if p["player_id"] not in self.bundles:          # A5.6 late joiner hydrated on first hello
                self.bundles[p["player_id"]] = self.compiler.compile(self.config, p, self.teams)
                self.acks.pop(p["player_id"], None)
            node["config"] = self.config
            node["frames"] = self.bundles[p["player_id"]]
        if self.start_info:
            node["start"] = self._start_body()
            node["match_id"] = self.start_info["match_id"]
        if self.scorer:
            row = next((r for r in self.scorer.rows() if r["player_id"] == p["player_id"]), None)
            if row:
                node["score"] = row
        return node

    def _on_status(self, nid: str, body: dict, t_recv: int):
        nv = self.nodes.setdefault(nid, {"node_id": nid, "node_type": "phone"})
        nv.update({k: body.get(k) for k in ("arm_state", "synced", "preflight", "battery", "fw", "hp", "armor", "ammo", "alive", "t_minus_ms", "shots", "dropped") if k in body})
        nv["last_seen_ms"] = t_recv
        nv["stale"] = False
        # A8: the server's binding is authoritative — a status body's player_id never rebinds a node.
        if self.phase in ("kit", "lobby", "armed") and body.get("synced"):
            self.synced_at_lobby[nid] = True   # any node synced before it goes live keeps its own t (A5.7)
        self._log(nid, "status", body, t_recv)
        if self.scorer:
            self.scorer.ingest_status(nid, body, t_recv)
        self._changed()

    def _on_event(self, nid: str, ev: dict, t_recv: int):
        seq = (ev.pop("_seq", None) if isinstance(ev, dict) else None) or (ev.get("seq") if isinstance(ev, dict) else None)
        self.nodes.setdefault(nid, {"node_id": nid})["last_seen_ms"] = t_recv
        parked = bool(self.scorer and ev.get("match_id") != self.scorer.match_id) or not self.scorer
        self._log(nid, ev.get("type", "event"), ev, t_recv, seq=seq, parked=parked)
        if self.scorer:
            self.scorer.ingest(nid, ev, t_recv, seq=seq)
            self._push_scores()
            self._changed()

    def ingest_batch(self, nid: str, events: list[dict], t_recv: int):
        self.nodes.setdefault(nid, {"node_id": nid})["last_seen_ms"] = t_recv
        for ev in events:
            self._log(nid, ev.get("type", "event"), ev, t_recv, seq=ev.get("seq"),
                      parked=not self.scorer or ev.get("match_id") != self.scorer.match_id)
        if self.scorer:
            self.scorer.ingest_batch(nid, events, t_recv)
            if any(ev.get("match_id") == self.scorer.match_id for ev in events):   # no SYNC POINT for an all-parked batch
                self.scorer.sync_point(t_recv, sum(1 for s in self.scorer.stats.values() if s.flushed), len(self.players))
            self._push_scores()
            self._changed()

    def _push_scores(self):
        """A7: push each player's ScoreRow to its node when it changed (best-effort; only reaches nodes in coverage)."""
        if not self.scorer:
            return
        plist = self.players.values() if isinstance(self.players, dict) else self.players
        by_pid = {p["player_id"]: p for p in plist}
        for row in self.scorer.rows():
            pid = row["player_id"]; p = by_pid.get(pid)
            if not p or not p.get("node_id"):
                continue
            body = dict(row); body["shots_total"] = self.scorer.shots_total(pid)
            if self._score_pushed.get(pid) == body:
                continue
            self._score_pushed[pid] = body
            self.net.push(p["node_id"], "score", body)

    def _on_node_message(self, nid: str, kind: str, body: dict, t_recv: int):
        self.nodes.setdefault(nid, {"node_id": nid})["last_seen_ms"] = t_recv
        pid = self.node_player.get(nid)   # authoritative binding, not a client-supplied player_id
        if kind == "ready" and pid in self.players:
            self.players[pid]["ready"] = bool(body.get("ready"))
            if self.phase == "kit" and body.get("ready"):
                self.phase = "lobby"
        elif kind == "ack_config" and pid in self.players:
            self.acks[pid] = {"ok": bool(body.get("ok")), "gun_echo": body.get("gun_echo"), "err": body.get("err")}
            if body.get("ok") and body.get("gun_echo"):
                self.nodes[nid]["headset"] = "proven"
        elif kind == "event_batch":
            self.ingest_batch(nid, body.get("events", []), t_recv)
            return
        elif kind == "log_offer":
            got = self._log_bytes.get(nid, 0)
            if got < 1_000_000:            # cap total pulled log per node at ~1 MB
                self.net.push(nid, "pull_log", {})
        elif kind == "log_data":
            self._log_bytes[nid] = self._log_bytes.get(nid, 0) + len(str(body.get("chunk", "")))
        self._log(nid, kind, body, t_recv)
        self._changed()

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
                blockers.append("NO NODE — OPEN THE APP AND SET THE GUN")
            else:
                age = now - nv.get("last_seen_ms", 0)
                if age > STALE_AFTER_MS:
                    ambers.append(f"STALE LINK ({age // 1000}s) — DOES NOT BLOCK")
                if not nv.get("synced"):
                    blockers.append("CLOCK NOT SYNCED — BLOCKS START")
                if pf.get("ssid_ok") is False or pf.get("mc_reachable") is False:
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
            if row["identity"] in ("reverted", "unknown") and g:
                blockers.append("IDENTITY REVERTED — RE-STAMP $NAME")
            ack = self.acks.get(p["player_id"])
            if self.lobby_pushed and ack is not None and (not ack.get("ok") or not ack.get("gun_echo")):
                blockers.append("GUN DID NOT ANSWER CONFIG — HEADSET OFF? BLOCKS START")
                row["headset"] = "absent"
            elif nv.get("headset") == "proven":
                row["headset"] = "proven"
            else:
                row["headset"] = "unknown"
                if nid and not self.lobby_pushed:
                    ambers.append("HEADSET UNPROVEN UNTIL CONFIG PUSH")
            row.update({"battery_pct": nv.get("battery"), "battery_age_ms": (now - nv.get("last_seen_ms", now)) if nid else None,
                        "fw": nv.get("fw"), "phone_batt": pf.get("phone_batt"), "ssid_ok": pf.get("ssid_ok"),
                        "mc_reachable": pf.get("mc_reachable"), "synced": nv.get("synced"), "screen_on": pf.get("screen_on"),
                        "foreground": pf.get("foreground"), "blockers": blockers + ambers,
                        "status": "red" if blockers else ("amber" if ambers else "green")})
            board.append(row)
        unclaimed = [s for s in self.scan_rows if s.get("basename", "").lower() not in claimed]
        greens = sum(1 for r in board if r["status"] == "green")
        return {"t": now, "roster_size": len(board), "greens": greens, "board": board, "unclaimed": unclaimed,
                "go": all(r["status"] != "red" for r in board) and bool(board)}

    async def scan(self, duration_s: int = 6) -> list[ScanRow]:
        self.scan_rows = await self.armory.scan(duration_s)
        self._gun_index()
        self._changed()
        return self.scan_rows

    # ---------- kit-out ----------
    def tryout(self, pid: str, weapon_id: str | None) -> None:
        p = self.players[pid]
        if weapon_id is None:
            self.trying.pop(pid, None)
            # tell the NODE too — without this the phone stayed on the try-out screen and the gun stayed
            # armed until the next config push (e2e find, 2026-08-26). Teardown = the known end sequence.
            if p.get("node_id"):
                self.net.push(p["node_id"], "tutorial", {"end": True, "frames": [
                    "$SPAWN,,*", "$PLAYX,0,*", "$STOP,*", "$CLEAR,*", "$HLOOP,0,0,*", "$HLED,0,0,0,0,0,0,*"]})
            self._changed()
            return
        if any(nv.get("arm_state") in ("lobby", "armed", "live") for nv in self.nodes.values()):
            raise ValueError("try-outs disabled once any node is in LOBBY (interim safety rule)")
        w = next((w for w in self.compiler.weapon_catalog() if w["weapon_id"] == weapon_id), None)
        if not w:
            raise KeyError(weapon_id)
        frames = self.compiler.tutorial_frames(w, self.config["environment"])
        self.trying[pid] = weapon_id
        if p.get("node_id"):
            self.net.push(p["node_id"], "tutorial", {"weapon": w, "frames": frames})
        self._changed()

    # ---------- lobby ----------
    def _push_config_to(self, p: Player):
        bundle = self.compiler.compile(self.config, p, self.teams)
        self.bundles[p["player_id"]] = bundle
        self.acks.pop(p["player_id"], None)
        if p.get("node_id"):
            self.net.push(p["node_id"], "config", {"config": self.config, "frames": bundle, "roster": self.roster()})

    def push_config(self) -> dict:
        rd = self.readiness()
        if not rd["go"]:
            raise ValueError("readiness has reds — clear them before pushing")
        res = self._validate()
        if not res["ok"]:
            raise ValueError("config invalid: " + "; ".join(res["errors"]))
        self.trying.clear()
        for p in self.players.values():
            self._push_config_to(p)
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
        now = self.now_ms()
        self.start_info = {"match_id": uuid.uuid4().hex[:10], "go_live_t": now + runway_s * 1000,
                           "seq": self.start_seq, "countdown_s": runway_s}
        self.scorer = Scorer(self.start_info["match_id"], self.start_info["go_live_t"], self.config["time_limit_s"],
                             self.config["mode"], self.players, self.teams, self.node_player, self.synced_at_lobby,
                             on_feedback=lambda pid, body: self._feedback(pid, body), on_feed=self._on_feed, now_ms=self.now_ms,
                             win_by=(self.config.get("scoring") or {}).get("win_by"))
        self.feed = []
        self.last_recap = None
        if self.store:
            try:
                self.store.match_started(self.start_info["match_id"], self.config, self.start_info["go_live_t"])
            except Exception:
                pass
        self.net.broadcast("start", self._start_body())
        self.phase = "armed"
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
        self.net.broadcast("control", {"cmd": "abort_start", "seq": self.start_info["seq"]})
        self.start_info = None
        self.scorer = None
        self.phase = "lobby"
        self._changed()
        return {"ok": True, "reached": reached, "unreachable": unreachable}

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

    def control(self, cmd: str, confirm: bool = False) -> dict:
        if cmd not in ("end", "recall", "panic"):
            raise ValueError("unknown control")
        if cmd == "panic" and not confirm:
            raise ValueError("panic requires confirm")
        self.net.broadcast("control", {"cmd": cmd})
        if cmd == "end" and self.scorer:
            self.scorer.set_end(self.now_ms())           # A6.1 end freeze
            self._finish()
        else:                                            # recall/panic stop a live game → KITTED (A5.9)
            self.start_info = None
            self.scorer = None
            self.lobby_pushed = False
            self.acks = {}
            self.phase = "kit"
        self._changed()
        return {"ok": True}

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
        self.last_recap = self.scorer.recap() if self.scorer else None
        self._push_victory(self.last_recap)              # winners' guns play the victory sting (in coverage)
        if self.store and self.start_info and self.last_recap:
            try:
                self.store.match_ended(self.start_info["match_id"], self.last_recap)
            except Exception:
                pass
        self.start_info = None            # no re-hydrating a finished match's `start`
        self.phase = "recap"
        self.lobby_pushed = False
        self.acks = {}
        for p in self.players.values():
            p["ready"] = False
        self._changed()

    def tick(self) -> None:
        """Call periodically (≥1 Hz): armed→live at go_live_t; live→recap at the timed end (+5 s grace)."""
        if not self.start_info:
            return
        now = self.now_ms()
        if self.phase == "armed" and now >= self.start_info["go_live_t"]:
            self.phase = "live"
            self._changed()
        tl = self.config.get("time_limit_s")
        if self.phase == "live" and tl and now >= self.start_info["go_live_t"] + tl * 1000 + 5000:
            self._finish()

    def recap(self) -> dict | None:
        if self.scorer:
            r = self.scorer.recap()
            if self.phase != "recap":
                r["provisional"] = True
            return r
        return self.last_recap

    def new_session(self, keep_roster: bool = True) -> None:
        self.session_id = uuid.uuid4().hex[:8]
        self.phase = "muster"
        self.start_info = None
        self.scorer = None
        self.last_recap = None
        self.feed = []
        self.lobby_pushed = False
        self.acks = {}
        self.bundles = {}
        self.trying = {}
        self.synced_at_lobby = {}
        if keep_roster:
            for p in self.players.values():
                p["ready"] = False
        else:
            self.players = {}
            self.node_player = {}
            for nv in self.nodes.values():
                nv.pop("player_id", None)
        self._changed()

    # ---------- snapshot ----------
    def snapshot(self) -> dict:
        now = self.now_ms()
        kitted = sum(1 for p in self.players.values() if p.get("node_id"))
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
                "nodes": [{**nv, "last_seen_ms": now - nv.get("last_seen_ms", 0)} for nv in self.nodes.values()],
                "readiness": self.readiness(), "config": self.config, "config_errors": self.config_errors,
                "config_warnings": self.config_warnings,
                "players": list(self.players.values()), "teams": self.teams,
                "kit": {"kitted": kitted, "total": len(self.players), "trying": dict(self.trying)},
                "lobby": {"ready": sum(1 for p in self.players.values() if p["ready"]), "total": len(self.players),
                          "pushed": self.lobby_pushed, "acks": self.acks, "all_acked": self.all_acked()},
                "start": start, "live": live, "recap": self.recap() if self.phase in ("live", "recap") else None,
                "feed": self.feed[:50]}
