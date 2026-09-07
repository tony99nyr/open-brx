"""Shape-correct fakes for the lanes M-MC depends on (README §5 rule 3): FakeCompiler,
FakeNet (in-memory NetServer you can drive from tests / the --demo driver), FakeArmory."""
from __future__ import annotations

import asyncio
import random
import time
from typing import Callable

from .compile import HEADSET_ALERT_BRIGHTNESS, VOL_TRYOUT, play_volume   # one volume policy for the real and the fake paths
from .types import (ArmoryRecord, FrameBundle, GameConfig, Player, ScanRow, ScoreRow, Team, Weapon,
                    MAX_PLAYERS)

_WEAPONS = [  # (weapon_id, name, cls, clip, mags, reload_s, dmg, rpm, rng)
    ("assault_rifle", "Assault Rifle", "AR", 32, 12, 1.4, 55, 85, 55),
    ("burst_rifle", "Burst Rifle", "AR", 36, 6, 1.7, 65, 70, 80),
    ("sniper_rifle", "Sniper Rifle", "SNIPER", 4, 6, 1.7, 90, 20, 100),
    ("shotgun", "Shotgun", "SHOTGUN", 6, 4, 0.4, 85, 25, 25),
    ("smg", "SMG", "SMG", 72, 4, 2.5, 35, 95, 40),
    ("amr", "AMR", "SNIPER", 14, 4, 1.4, 85, 55, 85),
    ("energy_launcher", "Energy Launcher", "HEAVY", 1, 6, 1.4, 100, 10, 55),
    ("rail_gun", "Rail Gun", "HEAVY", 1, 6, 2.4, 100, 10, 85),
    ("rocket_launcher", "Rocket Launcher", "HEAVY", 2, 4, 1.2, 100, 12, 60),
    ("laser_cannon", "Laser Cannon", "HEAVY", 4, 2, 2.0, 95, 18, 85),
    ("charge_rifle", "Charge Rifle", "LMG", 100, 2, 2.5, 80, 60, 60),
    ("bolt_rifle", "Bolt Rifle", "AR", 18, 10, 2.0, 60, 50, 65),
    ("plasma_sniper", "Plasma Sniper", "SNIPER", 10, 8, 2.0, 85, 30, 90),
    ("force_rifle", "Force Rifle", "AR", 36, 4, 1.7, 55, 75, 60),
    ("stinger", "Stinger", "AR", 18, 4, 1.7, 80, 45, 70),
    ("energy_rifle", "Energy Rifle", "LMG", 300, 2, 2.4, 40, 90, 50),
    ("suppressor", "Suppressor", "SMG", 48, 6, 2.0, 75, 65, 55),
    ("ion_sniper", "Ion Sniper", "SNIPER", 2, 6, 2.0, 85, 15, 90),
]


# A10 policy tags for the fake catalog (mirrors weapons.json: heavy = the power guns, sniper = the long guns)
_HEAVY = {"energy_launcher", "rail_gun", "rocket_launcher", "laser_cannon", "ion_sniper"}
_SNIPER = {"sniper_rifle", "plasma_sniper", "ion_sniper", "amr"}


def _tags(wid: str, cls: str) -> list[str]:
    t = [cls.lower()]
    if wid in _HEAVY:
        t.append("heavy")
    if wid in _SNIPER:
        t.append("sniper")
    return t


def weapon_views() -> list[dict]:
    """The demo/fallback catalog. Ranked `bars` are added the same way the real one gets them — without
    that, whenever `/api/weapons` fell back to this list the UI reverted to reading raw `dmg` and showed
    exactly the near-empty meters the ranked bars exist to replace (review finding, 2026-08-31)."""
    from .views import weapon_views as rank
    rows = [{"weapon_id": w[0], "name": w[1], "cls": w[2],
             "stats": {"mag": w[3], "reserve": w[3] * w[4], "reload_ms": int(w[5] * 1000),
                       "dmg": w[6], "rof": w[7], "rng": w[8],
                       "htk": max(1, round(13 * 55 / max(w[6], 1)))},
             "verified": w[0] in ("assault_rifle", "charge_rifle"),
             "tags": _tags(w[0], w[2]), "role": w[2].lower()} for w in _WEAPONS]
    out = rank(rows)
    for v, w in zip(out, _WEAPONS):
        v["mags"] = w[4]          # the demo list expresses reserve as a MAG COUNT; keep that field
    return out


class FakeCompiler:
    """Trivial but shape-correct: $PSET carries player_num, head has no $SPAWN, spawn has one."""

    def compile(self, config: GameConfig, player: Player, teams: list[Team], roll=None) -> FrameBundle:
        tid = next((t["tid"] for t in teams if t["team_id"] == player.get("team_id")), 0)
        hp, ar = config["health"]["max_hp"], config["health"]["max_armor"]
        weapons = [w["weapon_id"] for w in player["loadout"]["weapons"]] or ["assault_rifle"]
        head = [f"$VOL,{play_volume(config.get('environment'))},0,*", "$CLEAR,*", "$START,*",
                f"$GSET,{1 if config['mode'] == 'ffa' else 0},{1 if config['environment'] == 'outdoor' else 0},1,0,1,0,50,1,*",
                f"$PSET,{player['player_num']},0,{hp},{ar},{ar},50,,H44,JAD,V33,V3I,V3C,V3G,V3E,V37,H06,H55,H13,H21,H02,U15,W71,A10,*"]
        head += [f"$WEAP,{i},<{w}>,*" for i, w in enumerate(weapons[:2])] + ["$WEAP,4,<melee>,*"]
        head += ["$SIR,0,0,,1,0,0,1,,*", "$BMAP,0,0,,,,,*", f"$TID,{tid},*"]
        ammo = [f"$AMMO,{i},36,108,1,*" for i in range(len(weapons[:2]))]
        return {"config_id": config["config_id"], "player_id": player["player_id"], "head": head,
                "spawn": ["$PLAYX,0,*", "$SPAWN,,*", *ammo, "$BMAP,0,0,,,,,*"],
                "revive": ["$SPAWN,,*", *ammo],
                "end": ["$SPAWN,,*", "$PLAYX,0,*", "$STOP,*", "$CLEAR,*", "$HLOOP,0,0,*", "$HLED,0,0,0,0,0,0,*"],
                "panic": ["$CLEAR,*", "$SP,99,*"],
                "team_flip": {str(t["tid"]): [f"$TID,{t['tid']},*"] for t in teams if t["tid"] != tid},
                "cues": self.cues(player.get("voice", "male"))}

    def tutorial_frames(self, weapon: Weapon, environment: str) -> list[str]:
        # ⚠️ The `$SIR` row is NOT decoration. `$CLEAR` wipes the `$SIR` table and a gun with no rows
        # silently ignores EVERY hit while reporting alive and healthy (F11, bench-proven 2026-09-02).
        # This class is a RUNTIME FALLBACK -- `mc/__main__.py` selects it whenever the real compiler
        # raises -- so this bundle can reach a real tagger, and without the row it would leave that
        # player unhittable for the match. `test_clear_safety` now enumerates this file.
        return [f"$VOL,{VOL_TRYOUT},0,*", "$CLEAR,*", f"$GSET,0,{1 if environment == 'outdoor' else 0},1,0,1,0,50,1,*",
                "$PSET,0,0,45,70,70,50,,H44,JAD,V33,V3I,V3C,V3G,V3E,V37,H06,H55,H13,H21,H02,U15,W71,A10,*",
                "$SIR,0,0,,1,0,0,1,,*",
                f"$WEAP,0,<{weapon['weapon_id']}>,*", "$SPAWN,,*", "$PLAYX,0,*", "$AMMO,0,36,108,1,*", "$BMAP,0,0,,,,,*"]

    def cues(self, voice: str, slots: dict | None = None) -> dict[str, str]:   # A15: slots as the real compiler
        # A6.3: cues are pre-composed $PLAY frames the node writes verbatim
        # `hurt`/`hurt_led` are here so the demo and every fake-backed test exercise the same key set
        # the real compiler emits — without them the low-health alert path is unreachable in the
        # demo, and a node bug in it could only ever be found on hardware (review 2026-09-01).
        return {"countdown": "$PLAY,VA81,4,6,,,,,*", "kill": "$PLAY,,4,6,VAA,,,,*",
                "game_over": "$PLAY,VSF,4,6,JAY,,,,*",
                "hurt": "$PLAY,VA8B,3,6,,,,,*", "hurt_led": f"$HLED,7,4,90,90,{HEADSET_ALERT_BRIGHTNESS},15,*"}

    def validate(self, config: GameConfig, roster: list[Player], opts: dict | None = None) -> dict:
        errors, warnings = [], []
        opts = opts or {}
        if not config.get("time_limit_s") and opts.get("coverage") != "full":
            errors.append("time_limit_s is required on the phone path")
        if config.get("scoring", {}).get("frag_limit") and opts.get("coverage") != "full":
            warnings.append("frag_limit only ends the match for nodes in coverage; everyone stops at time_limit_s")
        nums = [p["player_num"] for p in roster]
        if len(set(nums)) != len(nums):
            errors.append("player_num must be unique")
        if any(n < 1 or n > MAX_PLAYERS for n in nums):
            errors.append(f"player_num must be 1..{MAX_PLAYERS}")
        tids = [t["tid"] for t in config.get("teams", [])]
        if len(set(tids)) != len(tids):
            errors.append("duplicate team tid")
        if config.get("mode") == "ffa" and len(config.get("teams", [])) != 1:
            errors.append("ffa needs exactly one team")
        if config.get("mode") == "lms" and config.get("respawn", {}).get("type") == "auto":
            errors.append("lms cannot use auto respawn")
        known = {w[0] for w in _WEAPONS}
        for p in roster:
            for w in p["loadout"]["weapons"]:
                if w["weapon_id"] not in known:
                    errors.append(f"unknown weapon_id {w['weapon_id']}")
        return {"ok": not errors, "errors": errors, "warnings": warnings}

    def weapon_catalog(self) -> list[Weapon]:
        return [{"weapon_id": w[0], "name": w[1], "cls": w[2],
                 "stats": {"damage": w[6], "mag": w[3], "reserve": w[3] * w[4], "rof": w[7], "reload_ms": int(w[5] * 1000),
                           "htk": max(1, round(13 * 55 / max(w[6], 1)))},   # fake: AR bar 55 → 13 hits, scaled
                 "weap_frame": f"$WEAP,<slot>,<{w[0]}>,*", "verified": w[0] in ("assault_rifle", "charge_rifle"),
                 "tags": _tags(w[0], w[2]), "role": w[2].lower()}
                for w in _WEAPONS]

    def perk_catalog(self) -> list[dict]:
        """A10: the REAL perks.json rows — static data, no hardware, safe for the fake."""
        from .perks import default_perks
        return default_perks().all()

    def award_medals(self, rows: list[ScoreRow], kills: list[dict]) -> dict[str, list[str]]:
        return {}


class FakeNet:
    """In-memory NetServer. Tests call the simulate_* helpers; pushes are recorded in .pushed."""

    def __init__(self):
        self._hydrate = None
        self._cb = {"node": [], "event": [], "status": [], "msg": [], "stale": [], "return": []}
        self.pushed: list[tuple[str | None, str, dict]] = []
        self.host, self.port, self.ws_path = "0.0.0.0", 0, "/ws"
        self.session_id = "fake-session"

    # NetServer surface
    def start(self, host: str, port: int, ws_path: str = "/ws") -> None:
        self.host, self.port, self.ws_path = host, port, ws_path
    def join_info(self) -> dict:
        url = f"ws://{self.host}:{self.port}{self.ws_path}"
        return {"url": url, "session_id": self.session_id, "qr": url}
    def hydrate(self, cb): self._hydrate = cb
    def on_node(self, cb): self._cb["node"].append(cb)
    def on_event(self, cb): self._cb["event"].append(cb)
    def on_status(self, cb): self._cb["status"].append(cb)
    def on_node_message(self, cb): self._cb["msg"].append(cb)
    def on_stale(self, cb): self._cb["stale"].append(cb)
    def on_return(self, cb): self._cb["return"].append(cb)
    def push(self, node_id: str, kind: str, body: dict) -> None: self.pushed.append((node_id, kind, body))
    def broadcast(self, kind: str, body: dict) -> None: self.pushed.append((None, kind, body))

    # simulation helpers (what a node would cause)
    def simulate_hello(self, node_id: str, gun_name: str, node_type: str = "phone", fw: str | None = "v4.32") -> dict | None:
        tail = gun_name.rsplit("-", 1)[-1] if "-" in gun_name else ""
        hello = {"node_id": node_id, "node_type": node_type, "app_ver": "fake", "seq_next": 1,
                 "gun": {"name": gun_name, "tail": tail, "fw": fw}}
        node = self._hydrate(hello) if self._hydrate else None
        for cb in self._cb["node"]:
            cb({"node_id": node_id, "node_type": node_type, "gun_name": gun_name, "gun_tail": tail, "fw": fw})
        return node
    def simulate_bind(self, node_id: str, gun_name: str, player_id: str | None = None):
        tail = gun_name.rsplit("-", 1)[-1]
        for cb in self._cb["node"]:
            cb({"node_id": node_id, "node_type": "phone", "gun_name": gun_name, "gun_tail": tail, "player_id": player_id, "bind": True})
    def simulate_status(self, node_id: str, body: dict, t_recv: int):
        for cb in self._cb["status"]: cb(node_id, body, t_recv)
    def simulate_event(self, node_id: str, ev: dict, t_recv: int, seq: int | None = None):
        if seq is not None: ev = {**ev, "_seq": seq}
        for cb in self._cb["event"]: cb(node_id, ev, t_recv)
    def simulate_node_message(self, node_id: str, kind: str, body: dict, t_recv: int):
        for cb in self._cb["msg"]: cb(node_id, kind, body, t_recv)
    def simulate_stale(self, node_id: str, age_ms: int):
        for cb in self._cb["stale"]: cb(node_id, age_ms)
    def simulate_return(self, node_id: str):
        for cb in self._cb["return"]: cb(node_id)
    def pushes(self, kind: str | None = None, node_id: str | None = None):
        return [p for p in self.pushed if (kind is None or p[1] == kind) and (node_id is None or p[0] in (node_id, None))]


class FakeArmory:
    def __init__(self, records: list[ArmoryRecord] | None = None):
        self.records = records or []
    def list(self) -> list[ArmoryRecord]: return list(self.records)
    async def scan(self, duration_s: int = 6) -> list[ScanRow]:
        now = int(time.time() * 1000)
        return [{"tail": r["ble"].get("tail", "0000"), "name": f"{r['sticker']}-{r['ble'].get('tail','0000')}",
                 "basename": r["sticker"], "gun_id": r["gun_id"], "rssi": -60, "identity": "ok", "t": now}
                for r in self.records]
    def bind_player(self, gun_id: str, player_id: str) -> None:
        if gun_id not in {r["gun_id"] for r in self.records}:
            raise KeyError(gun_id)


def demo_armory(n: int = 8) -> list[ArmoryRecord]:
    recs = []
    for i in range(n):
        tail = f"{0x3D4F + i * 0x111:04X}"
        recs.append({"gun_id": f"GUN-{chr(65 + i)}", "sticker": f"GUN-{chr(65 + i)}", "headset_pin": "*****",
                     "ble": {"tail": tail}, "gen": "gen2_3", "fw": "v4.32", "labeled": True})
    return recs


DEMO_NAMES = ["REAPER", "VIPER", "NOMAD", "GHOST", "HAVOC", "SABLE", "ONYX", "DRIFT"]


class DemoDriver:
    """Drives a FakeNet as if N phones were on the LAN: hello/bind, 2 s status, ready-up, acks,
    and — once live — random hits/deaths/respawns so the board moves. Runs as an asyncio task."""

    def __init__(self, session, net: FakeNet, n: int = 8, seed: int = 7, speed: float = 1.0):
        self.s, self.net, self.n, self.rng, self.speed = session, net, n, random.Random(seed), speed
        self.nodes: list[dict] = []
        self.task: asyncio.Task | None = None

    def _now(self) -> int: return self.s.now_ms()

    async def run(self):
        players = list(self.s.players.values())[: self.n]
        guns = {r["gun_id"]: r for r in self.s.armory.list()}
        for i, p in enumerate(players):
            g = guns.get(p.get("gun_id") or "", {"sticker": f"GUN-{i}", "ble": {"tail": "0000"}})
            name = f"{g['sticker']}-{g['ble'].get('tail', '0000')}"
            nid = f"node-{i}"
            self.nodes.append({"node_id": nid, "player_id": p["player_id"], "gun": name, "alive": True,
                               "shots": 0, "dead_until": 0, "seq": 1, "synced": True})
            self.net.simulate_hello(nid, name)
            self.net.simulate_bind(nid, name, p["player_id"])
            self.net.simulate_node_message(nid, "ready", {"node_id": nid, "player_id": p["player_id"], "ready": True}, self._now())
        while True:
            await asyncio.sleep(2.0 / self.speed)
            self.tick()

    def tick(self):
        now = self._now()
        phase = self.s.phase
        for nd in self.nodes:
            st = self.s.scorer.stats.get(nd["player_id"]) if self.s.scorer else None
            arm = {"muster": "kitted", "build": "kitted", "kit": "kitted", "lobby": "lobby" if self.s.lobby_pushed else "kitted",
                   "armed": "armed", "live": "live", "recap": "kitted"}[phase]
            body = {"node_id": nd["node_id"], "player_id": nd["player_id"], "hp": 45 if nd["alive"] else 0, "armor": 70 if nd["alive"] else 0,
                    "ammo": 36, "alive": nd["alive"], "shots": nd["shots"], "battery": 60 + (hash(nd["node_id"]) % 40),
                    "fw": "v4.32", "arm_state": arm, "synced": True, "match_id": self.s.start_info["match_id"] if self.s.start_info else None,
                    "preflight": {"ssid_ok": True, "mc_reachable": True, "auto_join_ok": True, "cellular_off": True, "dnd_on": True,
                                  "phone_batt": 80, "screen_on": True, "foreground": True, "gun_linked": True, "headset_ok": True}}
            if arm == "armed" and self.s.start_info:
                body["t_minus_ms"] = max(0, self.s.start_info["go_live_t"] - now)
            if not nd["alive"]:
                body["deadline_s"] = max(0, (nd["dead_until"] - now) // 1000)
            self.net.simulate_status(nd["node_id"], body, now)
        # answer config pushes with acks
        for (nid, kind, body) in list(self.net.pushed):
            if kind == "config" and not body.get("_acked"):
                body["_acked"] = True
                target = [n for n in self.nodes if n["player_id"] == body["frames"]["player_id"]]
                for n in target:
                    self.net.simulate_node_message(n["node_id"], "ack_config",
                        {"config_id": body["config"]["config_id"], "ok": True, "gun_echo": "$LCD,0,0,0,0,0,0,*"}, now)
        if phase != "live" or not self.s.start_info:
            return
        mid = self.s.start_info["match_id"]
        alive = [n for n in self.nodes if n["alive"]]
        for nd in self.nodes:
            if not nd["alive"] and now >= nd["dead_until"]:
                nd["alive"] = True
                self.net.simulate_event(nd["node_id"], {"type": "respawn", "t": now, "match_id": mid, "node_id": nd["node_id"], "player_id": nd["player_id"]}, now, seq=nd["seq"]); nd["seq"] += 1
        if len(alive) >= 2 and self.rng.random() < 0.6:
            shooter, victim = self.rng.sample(alive, 2)
            sp = self.s.players[shooter["player_id"]]
            shooter["shots"] += self.rng.randint(3, 9)
            for k in range(self.rng.randint(1, 3)):
                self.net.simulate_event(victim["node_id"], {"type": "hit_taken", "t": now - 300 + k * 50, "match_id": mid, "node_id": victim["node_id"],
                    "player_id": victim["player_id"], "shooter_num": sp["player_num"], "shooter_team": 1, "dmg": 9}, now, seq=victim["seq"]); victim["seq"] += 1
            if self.rng.random() < 0.35:
                victim["alive"] = False
                victim["dead_until"] = now + 1000 * self.s.config["respawn"]["delay_s"]
                self.net.simulate_event(victim["node_id"], {"type": "death", "t": now, "match_id": mid, "node_id": victim["node_id"],
                    "player_id": victim["player_id"], "shooter_num": sp["player_num"], "shooter_team": 1}, now, seq=victim["seq"]); victim["seq"] += 1
