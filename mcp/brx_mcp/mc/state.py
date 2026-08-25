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
        if self.store:
            mid = body.get("match_id") if isinstance(body, dict) else None
            self.store.log(node_id, kind, seq, body.get("t") if isinstance(body, dict) else None, t_recv, mid, parked, body)

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
        n.on_node(self._on_node)
        n.on_status(self._on_status)
        n.on_event(self._on_event)
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
        for n in range(1, MAX_PLAYERS + 1):
            if n not in used:
                return n
        raise ValueError("roster full")

    def add_player(self, display: str, team_id: str | None = None, gun_id: str | None = None,
                   voice: str = "male", loadout: dict | None = None) -> Player:
        if len(self.players) >= MAX_PLAYERS:
            raise ValueError("roster full")
        pid = uuid.uuid4().hex[:8]
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
        if gun_id:
            self._adopt_node_for_gun(p)
        if self.phase == "muster" and self.players:
            pass
        self._after_player_change(p, new=True)
        return p

    def patch_player(self, pid: str, **fields) -> Player:
        p = self.players[pid]
        if "player_num" in fields:
            n = int(fields["player_num"])
            if not 1 <= n <= MAX_PLAYERS:
                raise ValueError(f"player_num must be 1..{MAX_PLAYERS} (0 is reserved)")
            if any(q["player_num"] == n and q["player_id"] != pid for q in self.players.values()):
                raise ValueError("player_num already taken")
        for k in ("display", "team_id", "voice", "loadout", "player_num", "gun_id", "ready"):
            if k in fields and fields[k] is not None or (k in fields and k in ("team_id", "gun_id")):
                p[k] = fields[k] if k != "display" else str(fields[k]).strip().upper()
        if "gun_id" in fields:
            self._adopt_node_for_gun(p)
        self._after_player_change(p)
        return p

    def remove_player(self, pid: str) -> None:
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

    def set_config(self, patch: dict) -> dict:
        cfg = copy.deepcopy(self.config)
        if "mode" in patch and patch["mode"] != cfg["mode"]:
            cfg = default_config(patch["mode"])
        for k, v in patch.items():
            if k in ("respawn", "scoring", "health") and isinstance(v, dict):
                cfg[k] = {**cfg[k], **v}
            elif k != "config_id":
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
        for p in self.players.values():
            g = self.guns.get(p.get("gun_id") or "")
            if g and (g["sticker"].lower() == base or g["ble"].get("tail", "").lower() == tail):
                return p
            if (p.get("gun_id") or "").lower() in (base, gun_name and gun_name.lower()):
                return p
        return None

    def _adopt_node_for_gun(self, p: Player):
        g = self.guns.get(p.get("gun_id") or "")
        for nid, nv in self.nodes.items():
            name = nv.get("gun_name") or ""
            if (g and (name.rsplit("-", 1)[0].lower() == g["sticker"].lower())) or name.lower() == (p.get("gun_id") or "").lower():
                self._bind(nid, p)

    def _bind(self, nid: str, p: Player):
        old = self.node_player.get(nid)
        if old and old != p["player_id"] and old in self.players:
            self.players[old]["node_id"] = None
        for q in self.players.values():
            if q.get("node_id") == nid and q["player_id"] != p["player_id"]:
                q["node_id"] = None
        prev = p.get("node_id")
        if prev and prev != nid and self.scorer:
            self.scorer.rebind_node(p["player_id"])      # A6.2 hot-swap shots baseline
        self.node_player[nid] = p["player_id"]
        p["node_id"] = nid
        self.nodes.setdefault(nid, {"node_id": nid})["player_id"] = p["player_id"]

    def _on_node(self, n: dict):
        nid = n["node_id"]
        nv = self.nodes.setdefault(nid, {"node_id": nid, "arm_state": "idle", "synced": False})
        nv.update({k: v for k, v in n.items() if k in ("node_type", "gun_name", "gun_tail", "fw")})
        nv["last_seen_ms"] = self.now_ms()
        p = None
        if n.get("player_id") in self.players:
            p = self.players[n["player_id"]]
        else:
            p = self._find_player_for_gun(n.get("gun_name"), n.get("gun_tail"))
        if p:
            self._bind(nid, p)
        self._changed()

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
        if self.lobby_pushed and p["player_id"] in self.bundles:
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
        if body.get("player_id") in self.players and self.node_player.get(nid) != body["player_id"]:
            self._bind(nid, self.players[body["player_id"]])
        if self.phase in ("kit", "lobby") and body.get("synced"):
            self.synced_at_lobby[nid] = True
        self._log(nid, "status", body, t_recv)
        if self.scorer:
            self.scorer.ingest_status(nid, body, t_recv)
        self._changed()

    def _on_event(self, nid: str, ev: dict, t_recv: int):
        seq = ev.pop("_seq", None) if isinstance(ev, dict) else None
        self.nodes.setdefault(nid, {"node_id": nid})["last_seen_ms"] = t_recv
        parked = bool(self.scorer and ev.get("match_id") != self.scorer.match_id) or not self.scorer
        self._log(nid, ev.get("type", "event"), ev, t_recv, seq=seq, parked=parked)
        if self.scorer:
            self.scorer.ingest(nid, ev, t_recv, seq=seq)
            self._changed()

    def ingest_batch(self, nid: str, events: list[dict], t_recv: int):
        self.nodes.setdefault(nid, {"node_id": nid})["last_seen_ms"] = t_recv
        for ev in events:
            self._log(nid, ev.get("type", "event"), ev, t_recv, parked=not self.scorer or ev.get("match_id") != self.scorer.match_id)
        if self.scorer:
            self.scorer.ingest_batch(nid, events, t_recv)
            self.scorer.sync_point(t_recv, sum(1 for s in self.scorer.stats.values() if s.flushed), len(self.players))
            self._changed()

    def _on_node_message(self, nid: str, kind: str, body: dict, t_recv: int):
        self.nodes.setdefault(nid, {"node_id": nid})["last_seen_ms"] = t_recv
        pid = body.get("player_id") or self.node_player.get(nid)
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
            self.net.push(nid, "pull_log", {})
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
                             on_feedback=lambda pid, body: self._feedback(pid, body), on_feed=self._on_feed, now_ms=self.now_ms)
        self.feed = []
        self.last_recap = None
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
        else:
            self.start_info = None
            if cmd != "end":
                self.scorer = None
            self.lobby_pushed = False
            self.acks = {}
            self.phase = "kit"
        self._changed()
        return {"ok": True}

    def _finish(self):
        self.last_recap = self.scorer.recap() if self.scorer else None
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
