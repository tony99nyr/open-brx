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
import random
import time
from collections import deque
from typing import Any, Callable, Awaitable

from .. import sounds as _snd
from .. import voices as _voices
from ..gameconfig import VOICE_PACKS
from ..irbridge import encode_word
from ..mc import presentation as _pres
from ..mc.compile import Compiler
from ..mc.state import default_config

SFLASH = "$SFLASH,*"
EVENT_MIN_GAP_S = 1.0          # engine.js EVENT_MIN_GAP_MS: never two LED bursts inside a second
PAIN_GAP_S = 0.6               # engine.js PAIN_GAP_MS (A15.3): at most one pain grunt per 600 ms -- dropped, never queued
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


def _append_verdict(rec: dict, name: str = "stage-verdicts.jsonl") -> None:
    """Default verdict sink: one JSON line per verdict in ~/.brx-mcp/<name>."""
    import json, pathlib
    p = pathlib.Path.home() / ".brx-mcp" / name
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("a", encoding="utf-8") as f:
        f.write(json.dumps(rec) + "\n")


def _append_voice_verdict(rec: dict) -> None:
    _append_verdict(rec, "voice-verdicts.jsonl")


def _load_voice_verdicts() -> dict:
    """{voice: {id: {ok, note}}} from ~/.brx-mcp/voice-verdicts.jsonl (best-effort; the latest line per id wins)."""
    import json, pathlib
    out: dict = {}
    try:
        p = pathlib.Path.home() / ".brx-mcp" / "voice-verdicts.jsonl"
        for line in p.read_text(encoding="utf-8").splitlines():
            try:
                r = json.loads(line)
                out.setdefault(r["voice"], {})[r["id"]] = {"ok": r.get("ok"), "note": r.get("note", "")}
            except Exception:
                continue
    except Exception:
        pass
    return out


MEDAL_STACKS = [("kill", []), ("first_blood", ["first_blood"]), ("double_kill", ["double_kill"]),
                ("triple_spree", ["triple_kill", "killing_spree"]), ("killtacular_unstoppable", ["killtacular", "unstoppable"])]


def _toks(frame: str) -> list[str]:
    return frame.strip().lstrip("$").rstrip("*").split(",")


def _cue_id(frame: str) -> str | None:
    """The sound id a `$PLAY` cue carries: the announcer slot (token 4) for a voice line, else the SFX slot."""
    t = _toks(frame or "")
    if not t or t[0] != "PLAY":
        return None
    return (t[4] if len(t) > 4 and t[4] else (t[1] if len(t) > 1 and t[1] else None))


class GunStage:
    def __init__(self, mgr, bridge=None, *, compiler: Compiler | None = None,
                 sleep: Callable[[float], Awaitable[None]] | None = None, now: Callable[[], float] = time.monotonic,
                 verdict_sink: Callable[[dict], None] | None = None,
                 voice_verdict_sink: Callable[[dict], None] | None = None, voice_verdicts: dict | None = None,
                 rng: random.Random | None = None):
        self.mgr = mgr
        self.rng = rng or random.Random()      # A15: the $PSET roll on ARM and the per-event cue-pool pick (tests seed it)
        self.rolled: dict = {}                 # the last roll's {role: id} -- what the gun holds since the last ARM (or REROLL)
        self.bridge = bridge
        self.compiler = compiler or Compiler()
        self.sleep = sleep or asyncio.sleep
        self.now = now
        self.alias = "stage"
        self.address: str | None = None
        self.connected = False
        self.scan_results: list[dict] = []
        self.profile: dict[str, Any] = {"mode": "tdm", "preset": None, "gun": "team", "headset": "dark",
                                        "night": False, "tid": 1, "environment": "outdoor",
                                        "voice": "male", "voice_slots": {}}
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
        self.scream_this_life: str | None = None   # A15.3: the death-scream id last written into a $PSET, or None
        self._last_pain_at: float | None = None    # A15.3: the 600 ms pain gate (PAIN_GAP_S)
        self._last_hir_proto: int | None = None    # A15.3: the ir protocol of the last $HIR (melee = 13), read on the next $HP/$LCD
        self._pending: list[asyncio.Task] = []
        self.config: dict = {}
        self.bundle: dict = {}
        self.walk: dict | None = None          # the guided walkthrough (walk_start / walk_verdict)
        self.verdict_sink = verdict_sink or _append_verdict
        self._external: dict | None = None     # a GameConfig pulled from MC (load_config); None = the selectors
        self._local_pres: dict | None = None   # a patched presentation for the selector-built game
        # the SOUNDBOARD (Tony 2026-09-06: "act as the character selection and let me hear and test all of these"):
        # a character chosen independently of the game voice, PLAY ALL through its lines, a verdict per line
        self.board_voice: str = self.profile["voice"]
        self.board_playing: str | None = None
        self._board_gen = 0
        self.voice_verdict_sink = voice_verdict_sink or _append_voice_verdict
        self.voice_verdicts: dict = voice_verdicts if voice_verdicts is not None else (_load_voice_verdicts() if voice_verdict_sink is None else {})
        self.recompile()

    # ---- profile / bundle -------------------------------------------------------------------------
    def set_profile(self, **kw) -> dict:
        voice_changed = False
        for k, v in kw.items():
            if k not in self.profile:
                raise ValueError(f"unknown profile key {k!r}")
            if k == "voice":
                v = str(v or "").lower()
                if v not in VOICE_PACKS:
                    raise ValueError(f"voice must be one of {sorted(VOICE_PACKS)}")
                if v != self.profile["voice"]:
                    self.profile["voice_slots"] = {}          # the slots were picked for the OLD family
                    voice_changed = True
            if k == "voice_slots":
                v = _voices.check_slots(v)
                voice_changed = voice_changed or v != self.profile["voice_slots"]
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
        if voice_changed:
            self.rolled = {}
            self._log(f"voice: {self.speaker()} -- re-ARM to write the new $PSET", "warn")
        return self.state()

    def speaker(self) -> str:
        return _voices.family_name(_voices.family(self.profile["voice"]))

    def set_voice_slot(self, role: str, id: str | None = None) -> dict:
        """Pick which of the family's lines sits in ONE `$PSET` voice field (or the kill cue); null clears it.
        The head is only written by ARM, so the page says re-ARM."""
        if role not in _voices.VOICE_ROLES:
            raise ValueError(f"voice slot role must be one of {_voices.VOICE_ROLES}")
        slots = dict(self.profile["voice_slots"])
        if id in (None, ""):
            slots.pop(role, None)
        else:
            slots.update(_voices.check_slots({role: id}))
        return self.set_profile(voice_slots=slots)

    # ---- the SOUNDBOARD ------------------------------------------------------------------------------
    def voice_board(self, voice: str | None = None) -> dict:
        """Point the board at a character (any of VOICE_PACKS) without touching the game's voice."""
        v = str(voice or self.profile["voice"]).lower()
        if v not in VOICE_PACKS:
            raise ValueError(f"voice must be one of {sorted(VOICE_PACKS)}")
        if v != self.board_voice:
            self.voice_board_stop()
        self.board_voice = v
        self._log(f"soundboard: {_voices.family_name(_voices.family(v))} ({_voices.family(v)})", "info")
        return self.state()

    def board_lines(self) -> list[dict]:
        v = self.board_voice
        slots = self.profile["voice_slots"] if v == self.profile["voice"] else None
        return _voices.lines(v, slots)

    def voice_board_play(self, voice: str | None = None, from_slot: str | None = None) -> dict:
        """PLAY ALL: every line of the board's character in slot order, `duration + 0.5 s` apart, as a background
        task (the page polls `board.playing`); a second PLAY ALL or STOP cancels the running one."""
        if voice:
            self.voice_board(voice)
        lines = self.board_lines()
        if from_slot:
            idx = next((i for i, l in enumerate(lines) if l["slot"] == str(from_slot).upper() or l["id"] == str(from_slot).upper()), 0)
            lines = lines[idx:]
        self._board_gen += 1
        self._log(f"soundboard: playing {len(lines)} lines of {_voices.family_name(_voices.family(self.board_voice))}", "ok")
        self._spawn_task(self._board_run(self._board_gen, lines))
        return self.state()

    async def _board_run(self, gen: int, lines: list[dict]) -> None:
        try:
            for l in lines:
                if gen != self._board_gen:
                    return
                self.board_playing = l["id"]
                self._log(f"board {l['id']} {l['role_words']}: {l['words']}", "info")
                await self.write([_voices.play_line_frame(l["id"])], f"soundboard {l['id']}", gap_ms=0)
                await self.sleep(float(l.get("duration_s") or 1.0) + 0.5)
            if gen == self._board_gen:
                self._log("soundboard: done", "ok")
        finally:
            if gen == self._board_gen:
                self.board_playing = None

    def voice_board_stop(self) -> dict:
        if self.board_playing is not None:
            self._log("soundboard: stopped", "info")
        self._board_gen += 1
        self.board_playing = None
        return self.state()

    def voice_verdict(self, voice: str | None, id: str, ok: bool | None, note: str = "") -> dict:
        """✓ / ✗ for one line of a character, appended to ~/.brx-mcp/voice-verdicts.jsonl and kept in memory."""
        v = str(voice or self.board_voice).lower()
        if v not in VOICE_PACKS:
            raise ValueError(f"voice must be one of {sorted(VOICE_PACKS)}")
        sid = str(id or "").upper()
        line = next((l for l in _voices.lines(v) if l["id"] == sid), None)
        if line is None:
            raise ValueError(f"{id!r} is not a line of {v}")
        if ok not in (True, False, None):
            raise ValueError("ok must be true, false or null")
        rec = {"t": time.time(), "voice": v, "family": _voices.family(v), "id": sid, "slot": line["slot"], "role": line["role"],
               "words": line["words"], "ok": ok, "note": note or ""}
        self.voice_verdicts.setdefault(v, {})
        if ok is None:
            self.voice_verdicts[v].pop(sid, None)
        else:
            self.voice_verdicts[v][sid] = {"ok": ok, "note": note or ""}
        try:
            self.voice_verdict_sink(rec)
        except Exception as e:
            self._log(f"voice verdict not saved: {e}", "warn")
        self._log(f"voice {v} {sid}: {'PASS' if ok else 'cleared' if ok is None else 'FAIL'}{' -- ' + note if note else ''}", "ok" if ok else "warn" if ok is False else "info")
        return self.state()

    async def voice_line(self, id: str) -> dict:
        """Play ONE line of the voice (a hit sound or a personality moment) on the announcer slot."""
        sid = str(id or "").upper()
        if sid not in _snd.on_gun_ids():
            raise ValueError(f"{id!r} is not a sound on the gun")
        line = next((l for l in _voices.lines(self.profile["voice"], self.profile["voice_slots"]) if l["id"] == sid), None)
        why = f"voice line {sid}" + (f" ({line['role_words']}: {line['words']})" if line else f" ({_snd.describe(sid)})")
        await self.write([_voices.play_line_frame(sid)], why, gap_ms=0)
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

    def recompile(self, roll: bool = False) -> None:
        """Rebuild the bundle. `roll=True` (ARM / REROLL only) draws the $PSET death scream / short pain
        from the family's equal takes (A15, Tony 2026-09-06: "they are all equal and should be picked at random to
        make the sounds more dynamic"); every other recompile is un-rolled so the pickers and the state stay put."""
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
                  "node_id": None, "gun_id": None, "voice": p["voice"], "voice_slots": dict(p["voice_slots"]), "ready": True,
                  "loadout": {"weapons": [{"weapon_id": "assault_rifle"}, {"weapon_id": "shotgun"}]}}
        self.config = cfg
        if roll:
            try:
                self.bundle = self.compiler.compile(cfg, player, teams, roll=self.rng)
            except TypeError:                                   # a compiler without the A15 roll: nothing to draw from
                self.bundle = self.compiler.compile(cfg, player, teams)
                self._log("this compiler has no $PSET roll (pre-A15): the family defaults are written", "warn")
            self.rolled = dict((self.bundle.get("voice") or {}).get("rolled") or {})
        else:
            self.bundle = self.compiler.compile(cfg, player, teams)

    def roll_text(self) -> str:
        """`death scream V34 "AHHH", short pain V3H "MMMM"` for the log and the page."""
        return ", ".join(f"{_voices.ROLE_WORDS.get(r, r) if r in _voices.ROLE_WORDS else r.replace('_', ' ')} {i} \"{_snd.describe(i)}\""
                         for r, i in self.rolled.items())

    def reroll(self) -> dict:
        """Draw the $PSET takes again WITHOUT writing: the picks show on the page; ARM writes (and re-rolls)."""
        self.recompile(roll=True)
        self._log("rolled: " + (self.roll_text() or "nothing to roll (every field is pinned or has one take)") + " -- written to the gun on ARM", "info")
        return self.state()

    def _pick_cue(self, kind: str) -> tuple[str | None, str]:
        """A15: one random take from `cue_pools[kind]` (kill confirms + taunts on a kill, the pains, …), else `cues[kind]`.
        Returns (frame, ' (V3K: Ooh, bet that hurt.)') so the log names the take."""
        cues = self.bundle.get("cues", {})
        if kind in cues and cues[kind] == "":
            return "", ""                                        # deliberately mute (announcer off): no pool override
        pool = (self.bundle.get("cue_pools") or {}).get(kind)
        if isinstance(pool, list) and len(pool) > 1:
            fr = self.rng.choice(pool)
            sid = _cue_id(fr)
            return fr, f" ({sid}: {_snd.describe(sid)})" if sid else ""
        return self.bundle.get("cues", {}).get(kind), ""

    def _pick_frame(self, kind: str) -> tuple[str | None, str, str]:
        """A15.3: one random full frame from `bundle[kind]` (a LIST of complete frames -- `pset_pool`: one
        `$PSET` per death-scream take). `(None, '', '')` when the bundle has no such pool (pre-A15.3
        compiler), so nothing extra is written. Mirrors engine.js `_pickFrame`."""
        pool = self.bundle.get(kind)
        if not isinstance(pool, list) or not pool:
            return None, "", ""
        i = self.rng.randrange(len(pool)) if len(pool) > 1 else 0
        frame = pool[i]
        tag = f" {i + 1}/{len(pool)}" if len(pool) > 1 else ""
        toks = _toks(frame)
        sid = toks[10] if kind == "pset_pool" and len(toks) > 10 else ""   # $PSET token 10 = deathScream
        return frame, tag, sid

    def _pain(self, dmg: int, proto: int | None) -> None:
        """A15.3 (Tony 2026-09-06 bench): the three `$PSET` pain fields ship EMPTY and WE play the grunt on
        each SURVIVED hit -- `pain_melee` on a melee word (ir protocol 13), `pain_long` when the hit took at
        least `voice.pain_long_min` (shotgun / snipers / power weapons), else `pain_short`; one random take of
        that pool. Gated to one grunt per PAIN_GAP_S (dropped, never queued). Never called on the lethal hit
        (the caller returns on death before reaching this). Mirrors engine.js `_pain`."""
        f = self.bundle
        long_min = ((f.get("voice") or {}).get("pain_long_min")) or 40
        kind = "pain_melee" if proto == 13 else ("pain_long" if dmg >= long_min else "pain_short")
        cues = f.get("cues", {})
        cue_pools = f.get("cue_pools") or {}
        if not (cues.get(kind) or cue_pools.get(kind)):
            return                          # pre-A15.3 bundle: the firmware's own pains play instead
        now = self.now()
        if self._last_pain_at is not None and now - self._last_pain_at < PAIN_GAP_S:
            self._log(f"pain {kind[5:]}: dropped (another inside {int(PAIN_GAP_S * 1000)} ms)", "info")
            return
        self._last_pain_at = now
        fr, tag = self._pick_cue(kind)
        if fr:
            self._spawn_task(self.write([fr], f"pain {kind[5:]}{tag} {dmg} dmg", gap_ms=0))

    @staticmethod
    def _line_tag(frame: str | None, tag: str) -> str:
        """` + spawn line (VAN: Hoorah!)` for a write reason (the pick's own tag, or the id + words of a single take)."""
        if not frame:
            return ""
        if tag:
            return " + spawn line" + tag
        sid = _cue_id(frame)
        return f" + spawn line ({sid}: {_snd.describe(sid)})" if sid else " + spawn line"

    def spawn_takes(self) -> list[dict]:
        """A15.2: the spawn pool `[{id, words}]` -- `bundle.voice.spawn` when the compiler says so, else read off the
        spawn cue / pool frames (a pre-A15.2 bundle: empty, the firmware's cry plays)."""
        v = self.bundle.get("voice") or {}
        ids = list(v.get("spawn") or [])
        if not ids:
            pool = (self.bundle.get("cue_pools") or {}).get("spawn")
            frames = pool if isinstance(pool, list) and pool else [self.bundle.get("cues", {}).get("spawn")]
            ids = [i for i in (_cue_id(f) for f in frames if f) if i]
        return [{"id": i, "words": _snd.describe(i)} for i in ids]

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
        if not self.connected:
            return
        try:
            await self._send(frames, gap_ms)
        except Exception as e:
            # 2026-09-04 walkthrough: the link dropped under the stage ("arm failed: Not connected" while the
            # page said LINKED). Mark it, reconnect once, retry once; only then surface the failure.
            self._log(f"link lost while writing ({e}) -- reconnecting", "warn")
            self.connected = False
            await self._reconnect()
            await self._send(frames, gap_ms)

    async def _send(self, frames: list[str], gap_ms: int) -> None:
        if hasattr(self.mgr, "send_batch"):
            await self.mgr.send_batch(self.alias, frames, gap_ms=gap_ms)
        else:                                       # the fake manager: one send per frame
            for f in frames:
                await self.mgr.send(self.alias, f, reply_window_ms=0)

    async def _reconnect(self) -> None:
        if not self.address:
            raise RuntimeError("no gun address to reconnect to")
        try:
            await self.mgr.disconnect(self.alias)
        except Exception:
            pass
        await self.mgr.connect(self.address, self.alias)
        self.connected = True
        self._last_seq = 0
        self._log(f"reconnected {self.address}", "ok")

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
        self.recompile(roll=True)                                # A15: a fresh draw of the $PSET takes every arm
        if self.rolled:
            self._log("rolled: " + self.roll_text(), "info")
        await self.write(self.bundle["head"], "arm (head)")
        self.spawned = False; self.alive = False; self.scream_this_life = None   # a fresh head: no scream written yet
        hs = self.bundle.get("headset") or {}
        if hs.get("pregame"):
            await self.write(hs["pregame"], "headset pregame")
        return self.state()

    def _scream_take(self) -> tuple[str | None, str]:
        """A15.3: the death scream stays the firmware's but is re-rolled per LIFE -- one of the bundle's
        pre-composed `$PSET` frames (one per scream take) goes out FIRST, in the same write as $SPAWN (bench
        2026-09-06: a `$PSET` re-sent in play keeps $SIR, does not heal, the gun fires). No `pset_pool`
        (pre-A15.3 compiler): nothing prepended, the head's `$PSET` stands. Returns (frame-or-None, write tag)."""
        ps, ps_tag, ps_id = self._pick_frame("pset_pool")
        if not ps:
            return None, ""
        self.scream_this_life = ps_id
        if ps_id:
            self._log(f"scream this life: {ps_id} \"{_snd.describe(ps_id)}\"", "info")
        return ps, f" + scream {ps_id}{ps_tag}"

    async def spawn(self) -> dict:
        cues = self.bundle.get("cues", {})
        await self.write([cues.get("countdown", "")], "countdown cue")
        # A15.2 (Tony 2026-09-06, bench-verified on the bench gun): the $PSET cry field is EMPTY, so the firmware says nothing at
        # $SPAWN and WE play one take of the spawn pool in the SAME write ($SPAWN then $PLAY plays clean; a $PLAYX in
        # between clipped the firmware's line). A pre-A15.2 bundle has no cues["spawn"]: nothing is appended.
        fr, tag = self._pick_cue("spawn")
        ps, ps_why = self._scream_take()
        await self.write(([ps] if ps else []) + list(self.bundle["spawn"]) + [SFLASH] + ([fr] if fr else []),
                          "spawn" + ps_why + self._line_tag(fr, tag))
        self._after_spawn()
        hs = self.bundle.get("headset") or {}
        if hs.get("start"):
            self._headset(hs["start"], "headset start")
        await self.write([cues.get("klaxon", "")], "klaxon cue")
        return self.state()

    async def revive(self) -> dict:
        hs = self.bundle.get("headset") or {}
        down = hs.get("down")
        if down and down.get("stop"):
            # §3.2: belt-and-braces -- $SPAWN clears the $HLOOP on its own, this just gives the relay a
            # settled frame first (mirrors engine.js `_revive`, written BEFORE the revive frames below).
            await self.write([down["stop"]], "down stop", gap_ms=0)
        fr, tag = self._pick_cue("respawned")                  # A15.2: the spawn line rides in the revive write (one line, never two)
        ps, ps_why = self._scream_take()                       # A15.3: a fresh death scream for this life, written before $SPAWN
        await self.write(([ps] if ps else []) + list(self.bundle["revive"]) + ([fr] if fr else []),
                          "revive" + ps_why + self._line_tag(fr, tag))
        self._after_spawn()
        self.event("respawned", sound=False)                     # the lights; the sound went out with the revive write
        self.carrying = None
        if hs.get("respawn"):
            self._headset(hs["respawn"], "headset respawn")
        return self.state()

    def _after_spawn(self) -> None:
        self.spawned = True; self.alive = True
        self.hp = self.max_hp; self.armor = self.max_armor
        self._hurt_fired = False
        self._gun_band = None; self._gun_taken = False
        self._life = getattr(self, "_life", 0) + 1
        g = self.bundle.get("gun")
        if g and g.get("take"):
            self._spawn_task(self._gun_take(self._life, g))

    async def _gun_take(self, life: int, g: dict) -> None:
        """A11.7: blank + paint `after_spawn_s` after $SPAWN -- inside the burst it does not take (ladder 2026-09-04)."""
        await self.sleep(float(g.get("after_spawn_s", 2.5)))
        if life != getattr(self, "_life", 0) or not self.alive:
            return                                   # died or respawned again before the timer
        await self.write(list(g["take"]), f"gun take (+{g.get('after_spawn_s', 2.5)} s after spawn)", gap_ms=60)
        self._gun_taken = True
        self._gun_band = g["rest"]

    async def game_end(self, outcome: str = "game_over") -> dict:
        """What the phone does at the whistle: the game_over / victory cue (+ its burst), then the end frames.
        Walkthrough 2026-09-04: the END step wrote only the teardown and was failed for having no sound."""
        self.event(outcome if outcome in ("game_over", "victory", "survivors_win") else "game_over")
        await self.sleep(1.2)
        return await self.end()

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
    def event(self, kind: str, sound: bool = True) -> dict:
        """Play cues[kind] + leds[kind] like engine.js `_event`: the LED burst is gated to one per second,
        a static $HLED step is skipped while down and yields to a newer headset sequence. `sound=False` =
        the lights only (revive already wrote the spawn line, A15.2)."""
        cues = self.bundle.get("cues", {})
        cue, tag = self._pick_cue(kind) if sound else (None, "")
        if cue:
            self._spawn_task(self.write([cue], f"event cue {kind}{tag}", gap_ms=0))
        elif kind in cues and sound:
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
        if g and g.get("in_play") == "health" and self.alive and getattr(self, "_gun_taken", False):
            r = self._gun_rest()
            if r:
                self._gun_band = r
                await self.write([r], f"gun health after {kind}", gap_ms=0)

    def kill(self, medals: list[str] | None = None) -> dict:
        """What the shooter's phone plays on MC's kill feedback: $SFLASH, then the medal stack (or the kill line)."""
        cues = self.bundle.get("cues", {})
        medals = [m for m in (medals or []) if cues.get(m)]
        frames: list = [[SFLASH, 0.12]]
        tag = ""
        if medals:
            for i, m in enumerate(medals):
                frames.append([cues[m], MEDAL_GAP_S if i < len(medals) - 1 else 0])
        else:
            fr, tag = self._pick_cue("kill")                    # A15: one of the kill confirms + taunts, at random
            if fr:
                frames.append([fr, 0])
        self._spawn_task(self._seq(frames, "kill" + (" + " + "+".join(medals) if medals else tag)))
        top = medals[0] if medals else "kill"
        seq = (self.bundle.get("leds") or {}).get(top) or []
        if seq:
            self._spawn_task(self._seq(list(seq), f"lights {top}"))   # A11.8: the small-LED flash (+ burst) for the top medal
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

    async def raw(self, frames: list[str], delay_s: float = 0.0, confirm: bool = False) -> dict:
        """Bench escape hatch: write known-safe frames (protocol.KNOWN_SAFE_COMMANDS) after an optional delay, so a
        timing / ordering hypothesis can be tried on the gun without recompiling. Unknown commands are refused
        unless `confirm` is true -- the same explicit-confirm rule as the MCP server (CLAUDE.md), and the write is
        logged as UNKNOWN so the experiment log can quote it."""
        from .. import protocol
        frames = [f.strip() for f in (frames or []) if f and f.strip()]
        bad = [f for f in frames if not protocol.is_known_safe(f)]
        if bad and not confirm:
            raise ValueError(f"not on the known-safe list: {bad} (pass confirm=true to send anyway)")
        for f in bad:
            self._log(f"UNKNOWN command sent on explicit confirm: {f}", "warn")
        if delay_s:
            await self.sleep(float(delay_s))
        await self.write(frames, f"raw{f' +{delay_s}s' if delay_s else ''}", gap_ms=60)
        return self.state()

    # ---- IR ---------------------------------------------------------------------------------------
    def set_emitter(self, port: str | None) -> dict:
        """Attach (or swap) the ESP32 emitter at runtime; PINGs it so a wrong port is caught before a bench
        step reads 'no ack' as 'the gun ignored the shot' (2026-09-04: auto-detect picked COM3, the emitter
        was on COM8, and three walkthrough steps failed for nothing)."""
        if self.bridge is not None:
            try:
                self.bridge.close()
            except Exception:
                pass
            self.bridge = None
        if not port:
            self._log("emitter detached", "info")
            return self.state()
        from ..irbridge import IRBridge
        br = IRBridge(None if port == "auto" else port)
        ok = br.ping()
        if not ok:
            br.close()
            self._log(f"{br.port} did not answer PING -- not the emitter (or its firmware is not ir_emit). Ports: {self.serial_ports()}", "warn")
            raise ValueError(f"{br.port} did not answer PING; pick another port")
        self.bridge = br
        self._log(f"emitter on {br.port}: PONG", "ok")
        return self.state()

    @staticmethod
    def serial_ports() -> list[dict]:
        try:
            import serial.tools.list_ports as lp
            return [{"device": p.device, "desc": p.description} for p in lp.comports()]
        except Exception:
            return []

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
        is_up = getattr(self.mgr, "is_connected", None)
        if is_up is not None and not is_up(self.alias):
            self.connected = False
            self._log("the gun dropped the BLE link -- press CONNECT (or any write reconnects)", "warn")
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
                # $HIR,<sensor>,<irProto>,<shooterId>,<shooterTeam>,<magnitude>,<crit>,<subtype>,* -- proto 13 = melee
                self._last_hir_proto = int(t[2]) if len(t) > 2 and t[2] != "" else None
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
            self._log("☠ down -- the firmware's own out-flash takes over; nothing extra written to the headset", "info")
            self.event("died")
            if hs.get("death"):
                self._headset(hs["death"], "headset death")
            down = hs.get("down")
            if down and down.get("rearm"):
                self._spawn_task(self._down_rearm(getattr(self, "_life", 0), down))
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
            self._pain(dmg, self._last_hir_proto)   # A15.3: our pain grunt by damage -- never on a death (that returned above)
            if hs and not hurt_now:
                if self.carrying is not None and (hs.get("carrier") or {}).get(str(self.carrying)):
                    self._headset(hs["carrier"][str(self.carrying)], "carrier after hit")
                elif hs.get("hit"):
                    self._headset(hs["hit"], "headset hit")
            g = self.bundle.get("gun")
            if g and g.get("in_play") == "health" and getattr(self, "_gun_taken", False):
                r = self._gun_rest()
                if r and r != self._gun_band:
                    self._gun_band = r
                    self._spawn_task(self.write([r], "gun health band", gap_ms=0))

    async def _down_rearm(self, life: int, down: dict) -> None:
        """§3.2 (2026-09-07 bench, led-language.md): the firmware runs its OWN bright out-flash on the
        headset's small LED for the whole life, for free -- we write NOTHING to the headset at death any
        more (the old node-driven pulse this replaced was >=2x dimmer and cost ~80 writes/min). This is
        belt-and-braces ONLY: one `down['rearm']` write ($HLOOP) after the hands-off window, restoring the
        flash at native drive or better for any life where a blank slipped through (an older node, a
        teardown race, a mode that still paints effect 6). Gated on the life counter, like `_gun_take`, so
        a revive before the window elapses cancels it -- `revive()` also writes `down['stop']` directly."""
        await self.sleep(float(down.get("rearm_after_ms", 2500)) / 1000)
        if self.alive or life != getattr(self, "_life", 0):
            return                                                    # revived (or died again) before the window
        await self.write([down["rearm"]], "down rearm (belt-and-braces -- the native flash is already running)", gap_ms=0)

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
            ("headset: TEAM COLOUR held" if hs.get("pregame") else "headset: dark") + (" · gun body: TEAM COLOUR held" if _pres.gun_pregame(prof, self.profile["tid"], self.profile["night"], bool(hs) or bool(g)) else " · gun body: dark") + " · no sound", "arm")
        takes = self.spawn_takes()                               # A15.2: the spawn line is ours; the first take is the family's boast
        cry = takes[0]["id"] if takes else _voices.role_id(self.profile["voice"], "boast", self.profile["voice_slots"])
        add("voice", f"VOICE: {self.speaker().upper()}",
            f"sound: {self.speaker()} '{_snd.describe(cry)}' -- the voice the gun will use for its death scream / pains / heal",
            "voice_line", {"id": cry})
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
                # §3.2 (2026-09-07 bench): the FIRMWARE flashes the headset's small LED brightly on its own
                # while you're down -- we write nothing extra there beyond a belt-and-braces $HLOOP rearm.
                ("headset: FIRMWARE flash (native, ~0.75s cycle) -- our $HLOOP rearm is insurance only"
                 + (", plus our slow big-LED blink in the opt-in colour" if hs.get("death") else "") + " · ") if hs else ""
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
        add("end", "GAME END (everyone)", ("sound: game over line" if cues.get("game_over") else "no game_over sound") + (" · gun: burst" if leds.get("game_over") else "") + " · then the teardown: LEDs off, headset dark", "game_end", {"outcome": "game_over"})
        if cues.get("victory"):
            add("end_victory", "GAME END (winners)", "sound: Victory! + sting, then the teardown", "game_end", {"outcome": "victory"})
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
        voice, slots = self.profile["voice"], self.profile["voice_slots"]
        pset = _voices.pset_ids(voice, slots)
        out = []
        for ev, spec in prof["events"].items():
            snd = spec.get("sound")
            row = {"event": ev, "group": spec.get("group"), "source": spec.get("source"),
                   "desc": spec.get("desc"), "has_sound": bool(snd), "sound": snd,
                   "gun_led": spec.get("gun_led"), "headset": spec.get("headset")}
            if isinstance(snd, str) and snd.startswith("voice:"):
                vid = _voices.role_id(voice, snd[6:], slots)
                row["voice_id"] = vid
                row["voice_words"] = _snd.describe(vid) if vid else ""
            fw = [{"role": r, "field": _voices.PSET_FIELD[r], "id": pset[r], "words": _snd.describe(pset[r])}
                  for r in _voices.PSET_ROLES if _voices.PSET_PLAYS_ON.get(r) == ev and pset.get(r)]   # an EMPTY field (A15.2 cry) plays nothing
            if fw:
                row["firmware"] = fw
            out.append(row)
        return out

    def board_view(self) -> dict:
        v = self.board_voice; fam = _voices.family(v)
        return {"voice": v, "family": fam, "speaker": _voices.family_name(fam), "lines": self.board_lines(),
                "candidates": _voices.candidates(v), "playing": self.board_playing,
                "verdicts": self.voice_verdicts.get(v, {}), "is_game_voice": v == self.profile["voice"]}

    def _role_takes(self, role: str) -> list[dict]:
        """`[{id, words}]` for a role the node plays from a pool, read off the compiled bundle's `cue_pools`
        (2+ takes) or `cues` (one take) -- what will ACTUALLY play. `[]` for a bundle that carries neither
        (a pre-A15.3 compiler has no `pain_*` cue)."""
        pool = (self.bundle.get("cue_pools") or {}).get(role)
        cue = self.bundle.get("cues", {}).get(role)
        frames = pool if isinstance(pool, list) and pool else ([cue] if cue else [])
        ids = [i for i in (_cue_id(f) for f in frames if f) if i]
        return [{"id": i, "words": _snd.describe(i)} for i in ids]

    def voice_view(self) -> dict:
        voice, slots = self.profile["voice"], self.profile["voice_slots"]
        fam = _voices.family(voice)
        bv = self.bundle.get("voice") or {}
        return {"id": voice, "family": fam, "speaker": _voices.family_name(fam),
                "pset": _voices.pset_ids(voice, slots), "kill": _voices.role_id(voice, "kill", slots),
                "slots": dict(slots), "roles": list(_voices.VOICE_ROLES), "sound_roles": list(_voices.SOUND_ROLES),
                "fields": dict(_voices.PSET_FIELD), "plays_on": dict(_voices.PSET_PLAYS_ON),
                "lines": _voices.lines(voice, slots), "candidates": _voices.candidates(voice),
                # A15: what the last ARM / REROLL drew, the equal takes each field draws from, and the per-event pools
                "rolled": dict(self.rolled), "pools": dict(bv.get("pools") or {}),
                "spawn": self.spawn_takes(),                     # A15.2: the takes one of which plays on every spawn / revive
                "cue_pools": {ev: [{"id": _cue_id(f), "words": _snd.describe(_cue_id(f) or "")} for f in pool]
                              for ev, pool in (self.bundle.get("cue_pools") or {}).items() if isinstance(pool, list)},
                # A15.3: the death-scream takes (one $PSET write per life) and the pain pools (one per SURVIVED hit,
                # chosen by damage) -- both [] for a pre-A15.3 bundle, so the page falls back to the old pickers.
                "pset_pool": [{"id": i, "words": _snd.describe(i)} for i in (bv.get("pset_pool") or [])],
                "pain": {"short": self._role_takes("pain_short"), "long": self._role_takes("pain_long"),
                         "melee": self._role_takes("pain_melee"), "long_min": bv.get("pain_long_min", _voices.PAIN_LONG_MIN_DAMAGE)},
                "scream_this_life": self.scream_this_life}

    def ir_registers(self) -> dict:
        """Which IR buttons this game's gun will even REGISTER: a word registers only if the head carries a `$SIR`
        row for its protocol (F11: no row = silently ignored). Walkthrough 2026-09-04: medic and the station words
        'did not work' -- the table has no proto 1 / 15 rows (F15 / B23). EMP has `$SIR,8,0,,38` = PLAIN damage today."""
        protos = set()
        for f in self.bundle.get("head", []):
            if f.startswith("$SIR,"):
                t = f.split(",")
                if len(t) > 1 and t[1].isdigit():
                    protos.add(int(t[1]))
        need = {"shot": 0, "kill": 0, "emp": 8, "medic": 1, "beacon": 15, "button": 15}
        return {k: {"proto": p, "registers": p in protos} for k, p in need.items()}

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
            "voice": self.voice_view(),
            "voices": _voices.options(),
            "board": self.board_view(),
            "voice_verdicts": self.voice_verdicts,
            "ir_kinds": list(IR_KINDS),
            "ir_registers": self.ir_registers(),
            "serial_ports": self.serial_ports(),
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
