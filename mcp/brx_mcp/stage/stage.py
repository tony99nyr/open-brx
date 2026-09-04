"""GunStage: the engine behind the stage page. No HTTP in here, so tests drive it directly.

It owns ONE gun link (a `ConnectionManager` alias -- real bleak or `fake.FakeConnectionManager`), an
optional IR emitter (`irbridge.IRBridge`, or None), and the compiled bundle for the chosen profile.
Actions write the SAME frames the phone engine writes (`app/src/engine.js`): spawn/revive tails, the
`cues` + `leds` of an event with their holds, the A11.6 headset sequences under a generation counter,
the A11.7 gun-body health band. `poll()` reads what the gun says back and, with auto-react on, plays
the victim-side overlay the phone would (hit flash, low-health alert, death blink, respawn) -- so a
real IR shot from the emitter shows the whole picture, firmware + ours, on the bench.
"""
from __future__ import annotations

import asyncio
import time
from collections import deque
from typing import Any, Callable, Awaitable

from ..irbridge import encode_word
from ..mc import presentation as _pres
from ..mc.compile import Compiler
from ..mc.state import default_config

SFLASH = "$SFLASH,*"
EVENT_MIN_GAP_S = 1.0          # engine.js EVENT_MIN_GAP_MS: never two LED bursts inside a second
MEDAL_GAP_S = 2.0              # engine.js MEDAL_GAP_MS
GUN_IN_PLAY = list(_pres.GUN_IN_PLAY)
HEADSET_IN_PLAY = ["dark", "team"]
MODES = ["tdm", "ffa", "infection", "lms", "extraction"]

# IR words the emitter can send at the gun (bench-derived; see protocol/brx-protocol.md + experiment-log).
#   shot     plain hit, proto 0, mag = damage (25 = an assault-rifle hit against the 45/70 defaults)
#   kill     one heavy plain hit (mag 200) -- takes a full-health 45/70 gun down in one word
#   emp      the Sentinel EMP: proto 8, mag 15 (stuns a native gun; our $SIR,8 row registers a $HIR)
#   medic    the Medic heal pair: proto 1, sub 2, crit 1, mags 8 then 14
#   beacon   the grenade's Respawn-station beacon: proto 15, owner team, mag 6 (native games only)
#   button   the station's button word: beacon + crit 1
IR_KINDS = ("shot", "kill", "emp", "medic", "beacon", "button")


def ir_words(kind: str, team: int, damage: int | None = None) -> list[str]:
    """The 25-bit word(s) for an IR button. `team` = the SHOOTER's tid (0-3 on the wire)."""
    t = int(team) & 3
    if kind == "shot":
        return [encode_word(player=42, team=t, damage=int(damage or 25), proto=0)]
    if kind == "kill":
        return [encode_word(player=42, team=t, damage=int(damage or 200), proto=0)]
    if kind == "emp":
        return [encode_word(player=42, team=t, damage=15, proto=8, subtype=0)]
    if kind == "medic":
        return [encode_word(player=42, team=t, damage=8, proto=1, subtype=2, crit=1),
                encode_word(player=42, team=t, damage=14, proto=1, subtype=2, crit=1)]
    if kind == "beacon":
        return [encode_word(player=0, team=t, damage=6, proto=15)]
    if kind == "button":
        return [encode_word(player=0, team=t, damage=6, proto=15, crit=1)]
    raise ValueError(f"unknown IR kind {kind!r}; known: {IR_KINDS}")


def _append_verdict(rec: dict) -> None:
    """Default verdict sink: one JSON line per verdict in ~/.brx-mcp/stage-verdicts.jsonl."""
    import json, pathlib
    p = pathlib.Path.home() / ".brx-mcp" / "stage-verdicts.jsonl"
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("a", encoding="utf-8") as f:
        f.write(json.dumps(rec) + "\n")


MEDAL_STACKS = [("kill", []), ("first_blood", ["first_blood"]), ("double_kill", ["double_kill"]),
                ("triple_spree", ["triple_kill", "killing_spree"]), ("killtacular_unstoppable", ["killtacular", "unstoppable"])]


def _toks(frame: str) -> list[str]:
    return frame.strip().lstrip("$").rstrip("*").split(",")


class GunStage:
    def __init__(self, mgr, bridge=None, *, compiler: Compiler | None = None,
                 sleep: Callable[[float], Awaitable[None]] | None = None, now: Callable[[], float] = time.monotonic,
                 verdict_sink: Callable[[dict], None] | None = None):
        self.mgr = mgr
        self.bridge = bridge
        self.compiler = compiler or Compiler()
        self.sleep = sleep or asyncio.sleep
        self.now = now
        self.alias = "stage"
        self.address: str | None = None
        self.connected = False
        self.scan_results: list[dict] = []
        self.profile: dict[str, Any] = {"mode": "tdm", "preset": None, "gun": "native", "headset": "dark",
                                        "night": False, "tid": 1, "environment": "outdoor"}
        self.auto_react = True
        self.log: deque = deque(maxlen=400)
        self.tele: dict[str, Any] = {"hp": None, "armor": None, "shield": None, "mag": None, "reserve": None,
                                     "last_hir": None, "last_rx": None}
        # the phone-side model (what engine.js keeps) so the overlay plays like the phone's
        self.spawned = False
        self.alive = False
        self.hp = 45
        self.armor = 70
        self.max_hp = 45
        self.max_armor = 70
        self.carrying: int | None = None
        self._hs_gen = 0
        self._gun_band: str | None = None
        self._last_event_led: float | None = None
        self._hurt_fired = False
        self._last_seq = 0
        self._pending: list[asyncio.Task] = []
        self.config: dict = {}
        self.bundle: dict = {}
        self.walk: dict | None = None          # the guided walkthrough (walk_start / walk_verdict)
        self.verdict_sink = verdict_sink or _append_verdict
        self._external: dict | None = None     # a GameConfig pulled from MC (load_config); None = the selectors
        self._local_pres: dict | None = None   # a patched presentation for the selector-built game
        self.recompile()

    # ---- profile / bundle -------------------------------------------------------------------------
    def set_profile(self, **kw) -> dict:
        for k, v in kw.items():
            if k not in self.profile:
                raise ValueError(f"unknown profile key {k!r}")
            if k == "mode" and v not in MODES:
                raise ValueError(f"mode must be one of {MODES}")
            if k == "gun" and v not in GUN_IN_PLAY:
                raise ValueError(f"gun must be one of {GUN_IN_PLAY}")
            if k == "headset" and v not in HEADSET_IN_PLAY:
                raise ValueError(f"headset must be one of {HEADSET_IN_PLAY}")
            if k == "preset" and v not in (None, "") and v not in _pres.PRESETS:
                raise ValueError(f"preset must be one of {sorted(_pres.PRESETS)}")
            if k == "night":
                v = bool(v)
            if k == "tid":
                v = int(v)
            if k == "preset" and v == "":
                v = None
            if k in ("mode", "preset") and self.profile.get(k) != v:
                self._external = None; self._local_pres = None    # the selectors take over from a pulled config
            if k == "mode" and self.profile.get(k) != v:
                self.profile["preset"] = None                     # a new mode starts on ITS default preset
            self.profile[k] = v
        self.recompile()
        self._log(f"profile: {self.profile}", "info")
        return self.state()

    def load_config(self, config: dict, source: str = "mc") -> dict:
        """Drive the stage from a FULL GameConfig (what a running MC has applied) instead of the selectors.
        Everything on the page -- event buttons, bursts, headset sequences, gun body -- is then exactly
        what that game's bundle carries. The selectors keep showing what the config says."""
        if not isinstance(config, dict) or "mode" not in config:
            raise ValueError("config must be a GameConfig object with a mode")
        self._external = dict(config)
        pres = _pres.resolve(config)
        self.profile.update(mode=config["mode"], preset=pres.get("preset") if pres.get("preset") in _pres.PRESETS else None,
                            gun=pres.get("gun", {}).get("in_play", "native"), headset=pres.get("headset", {}).get("in_play", "dark"),
                            night=bool(config.get("night", False)), environment=config.get("environment", "outdoor"))
        self.recompile()
        self._log(f"config loaded from {source}: {config.get('mode')} / {pres.get('preset')} (id {config.get('config_id')})", "ok")
        return self.state()

    def patch_presentation(self, patch: dict) -> dict:
        """Merge a presentation patch (the PUT /api/config {"presentation": …} shape) into the current game
        and recompile -- so an event's sound / colours can be changed and tried in the same minute."""
        base = (self._external or self.config).get("presentation")
        merged = _pres.merge(base, patch)          # raises ValueError on anything the server would refuse
        if self._external is not None:
            self._external["presentation"] = merged
        else:
            self._local_pres = merged
        self.recompile()
        self._log(f"presentation patched: {patch}", "ok")
        return self.state()

    def recompile(self) -> None:
        p = self.profile
        if getattr(self, "_external", None):
            cfg = dict(self._external)
            cfg["night"] = p["night"]
            pres = _pres.merge(cfg.get("presentation"), {"gun": {"in_play": p["gun"]}, "headset": {"in_play": p["headset"]}})
            cfg["presentation"] = pres
        else:
            cfg = default_config(p["mode"])
            cfg["environment"] = p["environment"]
            cfg["night"] = p["night"]
            patch: dict = {}
            if p["preset"]:
                patch["preset"] = p["preset"]
            patch["gun"] = {"in_play": p["gun"]}
            patch["headset"] = {"in_play": p["headset"]}
            base = getattr(self, "_local_pres", None) if not p["preset"] else None
            cfg["presentation"] = _pres.merge(base or cfg.get("presentation"), patch)
        teams = cfg["teams"]
        team = next((t for t in teams if int(t["tid"]) == int(p["tid"])), teams[0])
        self.profile["tid"] = int(team["tid"])
        self.max_hp = int(cfg["health"]["max_hp"]); self.max_armor = int(cfg["health"]["max_armor"])
        player = {"player_id": "stage", "player_num": 7, "display": "STAGE", "team_id": team["team_id"],
                  "node_id": None, "gun_id": None, "voice": "male", "ready": True,
                  "loadout": {"weapons": [{"weapon_id": "assault_rifle"}, {"weapon_id": "shotgun"}]}}
        self.config = cfg
        self.bundle = self.compiler.compile(cfg, player, teams)

    def enemy_tid(self) -> int:
        mine = int(self.profile["tid"])
        others = [int(t["tid"]) for t in self.config["teams"] if int(t["tid"]) != mine]
        return others[0] if others else (2 if mine == 1 else 1)

    # ---- link -------------------------------------------------------------------------------------
    async def scan(self, duration_s: int = 6) -> list[dict]:
        self._log(f"scanning {duration_s} s…", "info")
        self.scan_results = await self.mgr.scan(duration_s)
        self._log(f"scan: {len(self.scan_results)} device(s)", "info")
        return self.scan_results

    async def connect(self, address: str) -> dict:
        if self.connected:
            await self.disconnect()
        await self.mgr.connect(address, self.alias)
        self.address = address
        self.connected = True
        self._last_seq = 0
        self._log(f"connected {address}", "ok")
        return self.state()

    async def disconnect(self) -> dict:
        if self.connected:
            try:
                await self.mgr.disconnect(self.alias)
            except Exception as e:   # the link may already be gone
                self._log(f"disconnect: {e}", "warn")
        self.connected = False
        self._log("disconnected", "info")
        return self.state()

    # ---- writes -----------------------------------------------------------------------------------
    async def write(self, frames: list[str], why: str, gap_ms: int = 60) -> None:
        frames = [f for f in frames if f]
        if not frames:
            return
        for f in frames:
            self._log(f, "tx", why)
        if self.connected:
            if hasattr(self.mgr, "send_batch"):
                await self.mgr.send_batch(self.alias, frames, gap_ms=gap_ms)
            else:                                   # the fake manager: one send per frame
                for f in frames:
                    await self.mgr.send(self.alias, f, reply_window_ms=0)

    async def _seq(self, steps: list, why: str, headset: bool = False) -> None:
        """[[frame, hold_s], …] with real holds, like engine.js `_event` / `_headset`."""
        gen = self._hs_gen
        for i, step in enumerate(steps):
            frame, hold = step[0], float(step[1] or 0)
            if headset and i > 0 and self._hs_gen != gen:
                return                       # a newer headset sequence took over
            await self.write([frame], why, gap_ms=0)
            if hold > 0:
                await self.sleep(hold)

    def _spawn_task(self, coro) -> None:
        t = asyncio.get_event_loop().create_task(coro)
        self._pending.append(t)
        self._pending = [x for x in self._pending if not x.done()]

    # ---- game -------------------------------------------------------------------------------------
    async def arm(self) -> dict:
        await self.write(self.bundle["head"], "arm (head)")
        self.spawned = False; self.alive = False
        hs = self.bundle.get("headset") or {}
        if hs.get("pregame"):
            await self.write(hs["pregame"], "headset pregame")
        return self.state()

    async def spawn(self) -> dict:
        cues = self.bundle.get("cues", {})
        await self.write([cues.get("countdown", "")], "countdown cue")
        await self.write(list(self.bundle["spawn"]) + [SFLASH], "spawn")
        self._after_spawn()
        hs = self.bundle.get("headset") or {}
        if hs.get("start"):
            self._headset(hs["start"], "headset start")
        await self.write([cues.get("klaxon", "")], "klaxon cue")
        return self.state()

    async def revive(self) -> dict:
        await self.write(self.bundle["revive"], "revive")
        self._after_spawn()
        self.event("respawned")
        hs = self.bundle.get("headset") or {}
        self.carrying = None
        if hs.get("respawn"):
            self._headset(hs["respawn"], "headset respawn")
        return self.state()

    def _after_spawn(self) -> None:
        self.spawned = True; self.alive = True
        self.hp = self.max_hp; self.armor = self.max_armor
        self._hurt_fired = False
        g = self.bundle.get("gun")
        self._gun_band = g["rest"] if g else None

    async def end(self) -> dict:
        await self.write(self.bundle["end"], "end")
        self.spawned = False; self.alive = False
        return self.state()

    async def panic(self) -> dict:
        await self.write(self.bundle["panic"], "PANIC")
        self.spawned = False; self.alive = False
        self._log("⚠ the gun now has NO $SIR table: re-ARM before it can be hit (F11)", "warn")
        return self.state()

    # ---- events (A11) -------------------------------------------------------------------------------
    def event(self, kind: str) -> dict:
        """Play cues[kind] + leds[kind] like engine.js `_event`: the LED burst is gated to one per second,
        a static $HLED step is skipped while down and yields to a newer headset sequence."""
        cues = self.bundle.get("cues", {})
        cue = cues.get(kind)
        if cue:
            self._spawn_task(self.write([cue], f"event cue {kind}", gap_ms=0))
        elif kind in cues:
            self._log(f"event {kind}: sound muted (\"\")", "info")
        seq = (self.bundle.get("leds") or {}).get(kind) or []
        if not seq:
            if not cue and kind not in cues:
                self._log(f"event {kind}: nothing configured in this profile", "warn")
            return self.state()
        t = self.now()
        if self._last_event_led is not None and t - self._last_event_led < EVENT_MIN_GAP_S:
            self._log(f"event {kind}: LED burst dropped (another inside 1 s)", "info")
            return self.state()
        self._last_event_led = t
        steps = [s for s in seq if not (str(s[0]).startswith("$HLED") and not self.alive)]
        self._spawn_task(self._event_leds(steps, kind))
        return self.state()

    async def _event_leds(self, steps: list, kind: str) -> None:
        await self._seq(steps, f"event led {kind}")
        g = self.bundle.get("gun")
        if g and g.get("in_play") == "health" and self.alive:
            r = self._gun_rest()
            if r:
                self._gun_band = r
                await self.write([r], f"gun health after {kind}", gap_ms=0)

    def kill(self, medals: list[str] | None = None) -> dict:
        """What the shooter's phone plays on MC's kill feedback: $SFLASH, then the medal stack (or the kill line)."""
        cues = self.bundle.get("cues", {})
        medals = [m for m in (medals or []) if cues.get(m)]
        frames: list = [[SFLASH, 0.12]]
        if medals:
            for i, m in enumerate(medals):
                frames.append([cues[m], MEDAL_GAP_S if i < len(medals) - 1 else 0])
        elif cues.get("kill"):
            frames.append([cues["kill"], 0])
        self._spawn_task(self._seq(frames, "kill" + (" + " + "+".join(medals) if medals else "")))
        return self.state()

    def headset(self, name: str, tid: int | None = None) -> dict:
        hs = self.bundle.get("headset") or {}
        if not hs:
            self._log("headset: LEDs are off in this profile (night / blackout) -- nothing to paint", "warn")
            return self.state()
        if name == "carrier":
            seq = (hs.get("carrier") or {}).get(str(tid if tid is not None else self.enemy_tid()))
            if seq:
                self.carrying = int(tid if tid is not None else self.enemy_tid())
        elif name == "carrier_off":
            self.carrying = None
            seq = [[hs["rest"], 0]]
        elif name == "rest":
            seq = [[hs["rest"], 0]]
        else:
            seq = hs.get(name)
        if not seq:
            self._log(f"headset {name}: not configured in this profile", "warn")
            return self.state()
        self._headset(seq, f"headset {name}")
        return self.state()

    def _headset(self, seq: list, why: str) -> None:
        self._hs_gen += 1
        self._spawn_task(self._seq(seq, why, headset=True))

    # ---- IR ---------------------------------------------------------------------------------------
    async def ir(self, kind: str, team: int | None = None, damage: int | None = None, repeat: int = 1) -> dict:
        t = int(team) if team is not None else (self.profile["tid"] if kind in ("beacon", "button") else self.enemy_tid())
        words = ir_words(kind, t, damage)
        for w in words:
            self._log(f"IR {kind} team {t}: {w}", "ir")
            if self.bridge is not None:
                ack = await asyncio.get_event_loop().run_in_executor(None, self.bridge.emit, w, int(repeat))
                self._log(f"emitter: {ack or 'no ack'}", "ir")
            elif hasattr(self.mgr, "inject_hit") and self.connected and kind in ("shot", "kill"):
                n = 1 if kind == "shot" else 30
                for _ in range(n):            # the fake tagger takes 25 per hit; a kill is "until dead"
                    self.mgr.inject_hit(self.alias, t)
            else:
                self._log("no emitter attached (--ir PORT) -- word logged only", "warn")
            if len(words) > 1:
                await self.sleep(0.15)
        return self.state()

    # ---- what the gun says back ---------------------------------------------------------------------
    def poll(self) -> list[str]:
        """Drain new rx frames; with auto-react on, play the victim-side overlay the phone would."""
        if not self.connected:
            return []
        try:
            ev = self.mgr.get_events(self.alias, since_seq=self._last_seq)
        except Exception as e:
            self._log(f"link lost: {e}", "warn"); self.connected = False
            return []
        events = ev.get("events", [])
        # advance past everything we were handed; the fake manager has no last_seq, so take it from the events
        self._last_seq = max([self._last_seq, ev.get("last_seq") or 0] + [int(e.get("seq", 0)) for e in events])
        seen: list[str] = []
        for e in events:
            if e.get("direction") != "rx":
                continue
            raw = e.get("raw", "")
            seen.append(raw)
            self.tele["last_rx"] = raw
            self._log(raw, "rx")
            self._on_rx(raw)
        return seen

    def _on_rx(self, raw: str) -> None:
        t = _toks(raw)
        if not t:
            return
        cmd = t[0]
        try:
            if cmd == "HIR":
                self.tele["last_hir"] = raw
            elif cmd == "ALCD" and len(t) > 4:
                self.tele["mag"], self.tele["reserve"] = int(t[1] or 0), int(t[4] or 0)
            elif cmd in ("HP", "LCD") and len(t) > 2:
                hp, armor = int(t[1] or 0), int(t[2] or 0)
                shield = int(t[3] or 0) if cmd == "HP" and len(t) > 3 and t[3] != "" else 0
                self.tele.update(hp=hp, armor=armor, shield=shield)
                self._on_pools(hp, armor)
        except ValueError:
            pass

    def _on_pools(self, hp: int, armor: int) -> None:
        if not (self.auto_react and self.spawned):
            self.hp, self.armor = hp, armor
            return
        before = self.hp + self.armor
        dmg = max(0, before - (hp + armor))
        self.hp, self.armor = hp, armor
        cues = self.bundle.get("cues", {})
        hs = self.bundle.get("headset") or {}
        if hp == 0 and self.alive:
            self.alive = False
            self._log("☠ down -- playing the death overlay", "info")
            self.event("died")
            if hs.get("death"):
                self._headset(hs["death"], "headset death")
            self.carrying = None
            return
        if dmg > 0 and self.alive:
            hurt_now = False
            if armor == 0 and hp < self.max_hp and not self._hurt_fired and self.max_armor > 0:
                self._hurt_fired = True; hurt_now = True
                fr = [cues.get("hurt", ""), cues.get("hurt_led", "")]
                self._hs_gen += 1
                self._spawn_task(self.write(fr, "low health", gap_ms=0))
            self.event("hit_taken")
            if hs and not hurt_now:
                if self.carrying is not None and (hs.get("carrier") or {}).get(str(self.carrying)):
                    self._headset(hs["carrier"][str(self.carrying)], "carrier after hit")
                elif hs.get("hit"):
                    self._headset(hs["hit"], "headset hit")
            g = self.bundle.get("gun")
            if g and g.get("in_play") == "health":
                r = self._gun_rest()
                if r and r != self._gun_band:
                    self._gun_band = r
                    self._spawn_task(self.write([r], "gun health band", gap_ms=0))

    def _gun_rest(self) -> str | None:
        g = self.bundle.get("gun")
        if not g or not g.get("rest"):
            return None
        if g.get("in_play") != "health" or not g.get("bands"):
            return g["rest"]
        frac = self.hp / self.max_hp if self.max_hp > 0 else 1
        for thr, frame in g["bands"]:
            if frac > thr:
                return frame
        return g["bands"][-1][1]

    # ---- the guided walkthrough ---------------------------------------------------------------------------
    def walk_plan(self) -> list[dict]:
        """Every state this CONFIG can put the headset, gun body and sounds in, as ordered steps. Built from
        the compiled bundle, so a profile with the announcer off has no sound steps, night has no LED steps,
        and an event with nothing configured is not a step. Each step names what to look and listen for."""
        b = self.bundle; hs = b.get("headset") or {}; cues = b.get("cues", {}); leds = b.get("leds") or {}
        prof = _pres.resolve(self.config); g = b.get("gun"); can_ir = self.bridge is not None or hasattr(self.mgr, "inject_hit")
        gun_txt = {"native": "firmware breathing in the team colour", "team": "held SOLID team colour (no breathing)",
                   "dark": "DARK body", "health": "full-health GREEN body"}[self.profile["gun"]]
        steps: list[dict] = []
        def add(sid, title, look, action, args=None, needs_ir=False):
            steps.append({"id": sid, "title": title, "look": look, "action": action, "args": args or {}, "needs_ir": needs_ir,
                          "available": (not needs_ir) or can_ir})
        add("arm", "PRE-GAME (armed, unspawned)",
            ("headset: TEAM COLOUR held" if hs.get("pregame") else "headset: dark") + " · gun body: the firmware lobby look · no sound", "arm")
        add("spawn", "GAME START",
            (("headset: WHITE double flash, then " + ("TEAM colour" if hs.get("in_play") == "team" else "DARK")) if hs else "headset: nothing (LEDs off)")
            + f" · gun body: {gun_txt} · sounds: countdown{', klaxon' if cues.get('klaxon') else ''}", "spawn")
        if can_ir:
            add("hit", "TAKING A HIT (emitter shoots you)",
                "gun: native hit flash, then our hit_taken burst" + (" ending on the held body" if g else "") +
                (" · headset: " + ("flash then rest" if hs.get("hit") else "nothing") if hs else "") + (" · sound: hit_taken" if cues.get("hit_taken") else " · no hit sound"),
                "ir", {"kind": "shot"}, needs_ir=True)
            add("low_health", "LOW HEALTH (armour gone, first HP hit)",
                "sound: the hurt line · headset: Callsign's fast blink · " + ("gun body: YELLOW then RED bands" if g and g.get("in_play") == "health" else "gun: hit burst only"),
                "ir", {"kind": "shot", "repeat": 1}, needs_ir=True)
            add("death", "DEATH (emitter kills you)",
                ("headset: " + ("our slow blink while out" if hs.get("death") else "native (dark in a hosted game)") + " · ") if hs else ""
                + "gun: died burst · sound: died line" if cues.get("died") else "no died sound", "ir", {"kind": "kill"}, needs_ir=True)
        else:
            add("death_overlay", "DEATH OVERLAY (no emitter: the frames only)",
                "headset out-blink + died burst + died line, without a real death", "event", {"kind": "died"})
        add("revive", "RESPAWN", (("headset: WHITE double flash then rest · " if hs.get("respawn") else "") + f"gun body: re-blanked, {gun_txt} · respawned burst/sound"), "revive")
        for t in self.config["teams"]:
            if (hs.get("carrier") or {}).get(str(t["tid"])):
                add(f"carrier_{t['tid']}", f"CARRYING {t['name'].upper()}'S FLAG", "headset: BLINKS the flag colour; a hit keeps it blinking", "headset", {"name": "carrier", "tid": int(t["tid"])})
        if hs.get("carrier"):
            add("carrier_off", "FLAG SCORED / LOST", "headset: back to the in-play rest (dark or team)", "headset", {"name": "carrier_off"})
        for sid, medals in MEDAL_STACKS:
            have = [m for m in medals if cues.get(m)] if medals else (["kill"] if cues.get("kill") else [])
            if have:
                add(f"medal_{sid}", "KILL FEEDBACK: " + " + ".join(have).upper(), "sight: green $SFLASH · sound: " + " then ".join(have) + " (2 s apart)", "kill", {"medals": medals})
        covered = {"hit_taken", "died", "respawned", "low_health", "kill", "first_blood", "double_kill", "triple_kill", "killing_spree", "killtacular", "unstoppable"}
        for ev, spec in prof["events"].items():
            if ev in covered:
                continue
            has = bool(cues.get(ev)) or bool(leds.get(ev))
            if not has:
                continue
            look = ("sound: " + ev if cues.get(ev) else "no sound") + (" · gun: 3-flash burst" if leds.get(ev) else "") + (" + headset colour" if any(str(s[0]).startswith("$HLED") for s in leds.get(ev, [])) else "")
            add(f"event_{ev}", f"EVENT {ev.upper()} ({spec.get('source', 'mc').upper()}-driven)", look + " · " + (spec.get("desc") or ""), "event", {"kind": ev})
        add("end", "GAME END", "sounds: game_over / victory · LEDs: end sequence · headset dark", "end")
        return steps

    def walk_start(self) -> dict:
        self.walk = {"steps": self.walk_plan(), "i": 0, "verdicts": {}, "started": self.now(), "done": False,
                     "profile": dict(self.profile), "summary": self.bundle.get("presentation")}
        self._log(f"walkthrough: {len(self.walk['steps'])} steps for {self.profile['mode']} / {self.bundle.get('presentation', {}).get('preset')}", "ok")
        return self.state()

    def walk_current(self) -> dict | None:
        w = self.walk
        if not w or w["done"]:
            return None
        return w["steps"][w["i"]]

    async def walk_play(self) -> dict:
        """(Re)play the current step's action."""
        step = self.walk_current()
        if not step:
            return self.state()
        if not step["available"]:
            self._log(f"walkthrough {step['id']}: needs the emitter -- skip it", "warn")
            return self.state()
        fn = getattr(self, step["action"])
        out = fn(**step["args"])
        if asyncio.iscoroutine(out):
            await out
        self._log(f"walkthrough {self.walk['i'] + 1}/{len(self.walk['steps'])}: {step['title']}", "info")
        return self.state()

    def walk_verdict(self, ok: bool | None, note: str = "") -> dict:
        """Record PASS (True) / FAIL (False) / SKIP (None) for the current step and advance."""
        w = self.walk; step = self.walk_current()
        if not w or not step:
            return self.state()
        rec = {"t": time.time(), "step": step["id"], "title": step["title"], "ok": ok, "note": note,
               "mode": self.profile["mode"], "preset": (self.bundle.get("presentation") or {}).get("preset"),
               "gun": self.profile["gun"], "headset": self.profile["headset"], "night": self.profile["night"], "config_id": self.config.get("config_id")}
        w["verdicts"][step["id"]] = {"ok": ok, "note": note}
        try:
            self.verdict_sink(rec)
        except Exception as e:                       # a full disk must not stop the walk
            self._log(f"verdict not saved: {e}", "warn")
        self._log(f"verdict {step['id']}: {'PASS' if ok else 'SKIP' if ok is None else 'FAIL'}{' -- ' + note if note else ''}", "ok" if ok else "warn" if ok is False else "info")
        w["i"] += 1
        if w["i"] >= len(w["steps"]):
            w["done"] = True
            fails = [k for k, v in w["verdicts"].items() if v["ok"] is False]
            self._log(f"walkthrough done: {len(w['steps']) - len(fails)} pass, {len(fails)} fail" + (" -- " + ", ".join(fails) if fails else ""), "ok" if not fails else "warn")
        return self.state()

    def walk_stop(self) -> dict:
        self.walk = None
        self._log("walkthrough stopped", "info")
        return self.state()

    # ---- state / log --------------------------------------------------------------------------------
    def _log(self, text: str, kind: str = "info", why: str = "") -> None:
        self.log.append({"t": round(self.now(), 2), "kind": kind, "text": text, "why": why})

    def event_catalog(self) -> list[dict]:
        prof = _pres.resolve(self.config)
        out = []
        for ev, spec in prof["events"].items():
            out.append({"event": ev, "group": spec.get("group"), "source": spec.get("source"),
                        "desc": spec.get("desc"), "has_sound": bool(spec.get("sound")),
                        "gun_led": spec.get("gun_led"), "headset": spec.get("headset")})
        return out

    def state(self) -> dict:
        hs = self.bundle.get("headset") or {}
        return {
            "link": {"connected": self.connected, "address": self.address, "alias": self.alias,
                     "emitter": getattr(self.bridge, "port", None) if self.bridge is not None else None,
                     "fake": hasattr(self.mgr, "inject_hit")},
            "profile": dict(self.profile),
            "presets": sorted(_pres.PRESETS), "modes": MODES, "gun_modes": GUN_IN_PLAY, "headset_modes": HEADSET_IN_PLAY,
            "teams": [{"tid": int(t["tid"]), "team_id": t["team_id"], "name": t["name"]} for t in self.config["teams"]],
            "summary": self.bundle.get("presentation"),
            "config_source": "mc" if self._external else "selectors",
            "config_id": self.config.get("config_id"),
            "presentation": self.config.get("presentation"),
            "model": {"spawned": self.spawned, "alive": self.alive, "hp": self.hp, "armor": self.armor,
                      "max_hp": self.max_hp, "max_armor": self.max_armor, "carrying": self.carrying,
                      "auto_react": self.auto_react},
            "tele": dict(self.tele),
            "headset_seqs": sorted(k for k, v in hs.items() if isinstance(v, list) and v and k != "pregame") + (["carrier"] if hs.get("carrier") else []),
            "events": self.event_catalog(),
            "ir_kinds": list(IR_KINDS),
            "log": list(self.log)[-250:],
            "walk": self._walk_view(),
        }

    def _walk_view(self) -> dict | None:
        w = self.walk
        if not w:
            return None
        return {"i": w["i"], "n": len(w["steps"]), "done": w["done"], "current": self.walk_current(),
                "steps": [{"id": s["id"], "title": s["title"], "available": s["available"],
                           "verdict": (w["verdicts"].get(s["id"]) or {}).get("ok", "pending") if s["id"] in w["verdicts"] else "pending"} for s in w["steps"]]}
