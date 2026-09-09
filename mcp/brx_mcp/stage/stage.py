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

from .. import poolgauge as _pg
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
LOW_HEALTH_HP = 15             # engine.js LOW_HEALTH_HP (A17.2): HP below which the once-per-life low-health alert fires
MEDAL_GAP_S = 2.0              # engine.js MEDAL_GAP_MS
READOUT_COALESCE_S = 0.3       # engine.js READOUT_COALESCE_MS (A16 §3.1): a repaint within this of the last WRITE only restarts the hold
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


def _ro_pools(bundle: dict) -> list:
    """The compiled `gun.readout.pools`, or [] -- used by `state()` to publish the real level table."""
    return ((bundle.get("gun") or {}).get("readout") or {}).get("pools") or []


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
        # 2026-09-07: `gun`/`headset` are DISPLAY-ONLY until the operator explicitly picks one via
        # set_profile(); an untouched selector tracks whatever the preset/config's own gun.in_play /
        # headset.in_play resolves to (recompile() syncs it there) instead of always re-patching this
        # literal onto the presentation -- the old unconditional patch made every compile diverge from
        # its own preset's default the moment GUN_DEFAULT changed underneath it, so EVERY game read
        # `preset: "custom"` even with nothing actually customised.
        self._gun_touched = False
        self._headset_touched = False
        self.auto_react = True
        self.log: deque = deque(maxlen=400)
        self.tele: dict[str, Any] = {"hp": None, "armor": None, "shield": None, "mag": None, "reserve": None,
                                     "last_hir": None, "last_rx": None}
        # the phone-side model (what engine.js keeps) so the overlay plays like the phone's
        self.spawned = False
        self.alive = False
        self.hp = 45
        self.armor = 70
        self.shield = 0
        self.max_hp = 45
        self.max_armor = 70
        self.carrying: int | None = None
        self._active_role: tuple[str, int | None] | None = None   # A16 §3.3: the one held role (name, tid) currently on the headset
        self._hs_gen = 0
        self._gun_band: str | None = None
        # A16 §3.1/§5: the transient gun-body pool readout state (mirrors engine.js's `_readout*` fields)
        self._readout_frame: str | None = None
        self._readout_last_write_at: float | None = None
        self._readout_last_pool: str | None = None
        self._readout_gen = 0
        # A16.3 (bar-spec.md, 2026-09-07): the 7-level drop-animation readout, per pool -- `_level_state`
        # keeps each configured pool's own last known level so a pool NOT currently on the strip resumes
        # from ITS OWN level (Node rules: "animate from the last DISPLAYED level"), not the strip's.
        # `_level_current`/`_level_partial` describe whatever IS on the strip right now (None: nothing --
        # reverted to rest, or a bundle with no `levels` at all, in which case the older `bands` path
        # below is what is actually driving the strip).
        self._level_state: dict[str, int] = {}
        self._level_current: int | None = None
        self._level_partial: bool = False
        self._level_gen = 0
        self._level_last_start: float | None = None   # review 2026-09-07: the rapid-retrigger guard's clock
        self._last_event_led: float | None = None
        self._hurt_fired = False
        self._last_seq = 0
        self._reacted_seq = 0          # highest rx seq already turned into a reaction -- distinct from
                                        # `_last_seq` (poll's own fetch cursor) so the instant on_frame
                                        # callback and a later poll() never react to the same frame twice
        self.scream_this_life: str | None = None   # A15.3: the death-scream id last written into a $PSET, or None
        self._last_pain_at: float | None = None    # A15.3: the 600 ms pain gate (PAIN_GAP_S)
        self._last_hir_proto: int | None = None    # A15.3: the ir protocol of the last $HIR (melee = 13), read on the next $HP/$LCD
        self._pending: list[asyncio.Task] = []
        self._loop: asyncio.AbstractEventLoop | None = None   # reactions run here; see _spawn_task (2026-09-07)
        # 2026-09-07 (bench): `state()` measured 527-658 ms on real hardware -- almost entirely
        # `voices.options()` / `board_view()` / `voice_view()` re-walking the ~2477-id sound catalog
        # (`sounds.on_gun_ids()` rebuilds its set from scratch every call), and the page polls
        # `/api/state` every 700 ms. `_cache` memoizes everything below that depends only on the
        # compiled bundle/profile -- cleared in ONE place, the top of `recompile()`, which is the only
        # place `self.bundle`/`self.config`/`self.profile["voice"/"voice_slots"]` are ever assigned
        # (grep confirms it). Genuinely live fields (telemetry, the log, `board_playing`,
        # `voice_verdicts`, `rolled`, `scream_this_life`) are never put in here -- they are merged back
        # in fresh on every call, on top of the cached base, so caching can never go stale.
        self._cache: dict = {}
        self._voices_options_cache: list[dict] | None = None   # process-static (VOICE_PACKS + the catalog file)
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
            if k == "gun":
                self._gun_touched = True                          # an explicit pick: honour it over the preset from now on
            if k == "headset":
                self._headset_touched = True
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
        self._gun_touched = False; self._headset_touched = False   # showing this config's OWN truth until touched again
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
        self._cache = {}    # every profile/bundle-derived state() cache below is now stale
        p = self.profile
        # 2026-09-07: only re-patch gun/headset onto the presentation when the OPERATOR actually chose
        # one (`_gun_touched`/`_headset_touched`, set by set_profile()) -- re-patching the selector's
        # literal unconditionally, on every recompile, made every game read `preset: "custom"` the
        # moment its value stopped matching the preset's own default (exactly what happened when
        # GUN_DEFAULT changed under it). An untouched selector leaves the preset's own choice alone.
        gun_patch: dict = {"in_play": p["gun"]} if self._gun_touched else {}
        hs_patch: dict = {"in_play": p["headset"]} if self._headset_touched else {}
        if getattr(self, "_external", None):
            cfg = dict(self._external)
            cfg["night"] = p["night"]
            ext_patch = {k: v for k, v in {"gun": gun_patch, "headset": hs_patch}.items() if v}
            cfg["presentation"] = _pres.merge(cfg.get("presentation"), ext_patch)
        else:
            cfg = default_config(p["mode"])
            cfg["environment"] = p["environment"]
            cfg["night"] = p["night"]
            patch: dict = {}
            if p["preset"]:
                patch["preset"] = p["preset"]
            if gun_patch:
                patch["gun"] = gun_patch
            if hs_patch:
                patch["headset"] = hs_patch
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
        # an UNTOUCHED selector shows the truth: whatever the preset/config actually resolved to, not
        # a stale literal from before GUN_DEFAULT/HEADSET_DEFAULT last changed underneath it.
        eff = (cfg.get("presentation") or {})
        if not self._gun_touched:
            eg = (eff.get("gun") or {}).get("in_play")
            if eg in GUN_IN_PLAY:
                self.profile["gun"] = eg
        if not self._headset_touched:
            eh = (eff.get("headset") or {}).get("in_play")
            if eh in HEADSET_IN_PLAY:
                self.profile["headset"] = eh

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

    def _pain(self, dmg: int, proto: int | None, pool: str | None = None) -> None:
        """A15.3 (Tony 2026-09-06 bench): the three `$PSET` pain fields ship EMPTY and WE play the grunt on
        each SURVIVED hit -- `pain_melee` on a melee word (ir protocol 13), `pain_long` when the hit took at
        least `voice.pain_long_min` (shotgun / snipers / power weapons), else `pain_short`; one random take of
        that pool. Gated to one grunt per PAIN_GAP_S (dropped, never queued). Never called on the lethal hit
        (the caller returns on death before reaching this). Mirrors engine.js `_pain`.

        A17 (Tony 2026-09-07): the grunt is the CHARACTER being hurt, so it only plays when the hit reached
        HEALTH. `pool` is the innermost pool that moved; a hit absorbed by armour or shield is a hit on
        EQUIPMENT and the firmware's own material sound ($PSET hitArrmor / hitShield) is the feedback."""
        f = self.bundle
        if pool and pool != "health":
            self._log(f"pain: not played -- {pool} absorbed it (A17: the character grunts for HEALTH only)", "info")
            return
        # A17.3 (Tony, bench 2026-09-07, answered "total"): `dmg` is the TOTAL pools lost, armour and shield
        # included, NOT the HP portion. A big hit sounds big regardless of what stopped it -- so the hit that
        # breaks THROUGH armour sums absorbed armour plus HP taken and can trip the long pain for a small HP
        # loss. Deliberate; the one place the A17 gate and the pain SIZING disagree. Mirrors engine.js.
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
        await self.mgr.connect(address, self.alias, on_frame=self._on_frame)
        self.address = address
        self.connected = True
        self._last_seq = 0
        self._reacted_seq = 0
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
        await self.mgr.connect(self.address, self.alias, on_frame=self._on_frame)
        self.connected = True
        self._last_seq = 0
        self._reacted_seq = 0
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
        """Schedule a reaction, from EITHER the asyncio loop thread or a BLE notification thread.

        ⚠ 2026-09-07, measured on hardware: this used to be a bare
        `asyncio.get_event_loop().create_task(coro)`. `_on_frame` — the instant path — runs INSIDE the
        BLE backend's notify callback, which is not the loop thread, and off-thread `get_event_loop()`
        does not return the running loop (3.12 raises). ble.py wraps the callback in try/except so a
        callback bug cannot drop the link, so the failure was SILENT: the instant reaction never ran and
        the frame was only handled later by the 0.2 s fallback poll. Cost: ~600 ms from the gun
        reporting a hit to the first frame we wrote, against ~150 ms for the gun to report it at all —
        i.e. our own bench tool was four times slower than the hardware it was measuring, and the
        'event-driven' rewrite that was supposed to fix it was never actually on the fast path.

        Now the loop is captured once (`bind_loop`) and a call from another thread is handed to it with
        `call_soon_threadsafe`. Same failure shape as everything else tonight: it reported success (a
        task object) while doing nothing.
        """
        loop = self._loop
        if loop is not None:
            try:
                running = asyncio.get_running_loop()
            except RuntimeError:
                running = None
            if running is not loop:                     # called from the BLE notify thread
                loop.call_soon_threadsafe(self._spawn_on_loop, coro)
                return
        self._spawn_on_loop(coro)

    def _spawn_on_loop(self, coro) -> None:
        t = (self._loop or asyncio.get_event_loop()).create_task(coro)
        t.add_done_callback(self._task_done)
        self._pending.append(t)
        self._pending = [x for x in self._pending if not x.done()]

    def _task_done(self, t: asyncio.Task) -> None:
        """Review 2026-09-07: `_spawn_task` fires reactions and forgets them -- nothing ever awaits
        `_pending`, so an exception inside one (a write, an animation step, `write()`'s second `_send()`
        after a failed reconnect, ...) used to vanish into Python's default 'Task exception was never
        retrieved' logging, never reaching `_log()` or the operator's page. That is the exact silent-
        failure shape the rest of tonight cost us. A cancellation (none of our own generation-counter
        cancels use `.cancel()` -- they just check-and-return -- but something outside could) is not a
        failure worth alarming the operator over."""
        if t.cancelled():
            return
        exc = t.exception()
        if exc is not None:
            self._log(f"background task failed: {exc!r}", "warn")

    def bind_loop(self, loop=None) -> None:
        """Remember the loop reactions must run on. Called once from the server's lifespan (and by
        `connect()`), so `_spawn_task` can hand work over from the BLE notify thread."""
        try:
            self._loop = loop or asyncio.get_running_loop()
        except RuntimeError:
            self._loop = None

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

    # start-sequence.md §2: `cues.countdown` (VA81) runs 2.97 s and its built-in "GO" is timed to land ON
    # T-0, so a real node fires it at T-3 and writes `frames.spawn` three seconds later. The stage used to
    # write both back to back (0.1 s apart), so every bench spawn cut the countdown off mid-"2" -- the spawn
    # burst's own $PLAYX/$PLAY took the speaker (Tony, 2026-09-07: "the gun announced 3...2... and then was
    # cut off"). The bench must hear what a player hears, so wait the same T-3 -> T-0 the field does.
    COUNTDOWN_LEAD_S = 3.0

    async def spawn(self) -> dict:
        cues = self.bundle.get("cues", {})
        countdown = cues.get("countdown", "")
        await self.write([countdown], "countdown cue")
        if countdown:
            await self.sleep(self.COUNTDOWN_LEAD_S)   # self.sleep, not asyncio.sleep -- tests inject a no-op here
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
        self._event_now("respawned", sound=False)                     # the lights; the sound went out with the revive write
        self.carrying = None; self._active_role = None
        if hs.get("respawn"):
            self._headset(hs["respawn"], "headset respawn")
        return self.state()

    def _after_spawn(self) -> None:
        self.spawned = True; self.alive = True
        self.hp = self.max_hp; self.armor = self.max_armor; self.shield = 0   # engine.js `_afterSpawn`/`_revive`: shield always starts at 0, not a max
        self._hurt_fired = False
        self._gun_band = None; self._gun_taken = False
        # A16 §3.1/§5: a fresh life starts with no readout -- any hold from the last life is dead the
        # moment `_gun_taken` drops False (mirrors engine.js `_gunTake`'s reset).
        self._readout_frame = None; self._readout_last_write_at = None; self._readout_last_pool = None
        self._readout_gen += 1
        # A16.3: seed every configured pool's level from where it ACTUALLY starts this life -- shield
        # starts at 0 (just above), not max, so defaulting it to "level 6" on its first paint would read
        # a shield pickup as a DROP from full instead of the GAIN it is. Bumping `_level_gen` here stops
        # any animation/blink still running from the life that just ended (Node rules: cancel on revive).
        self._level_current = None; self._level_partial = False
        self._level_gen += 1
        self._level_last_start = None                  # a fresh life starts its own rapid-retrigger clock
        readout = (self.bundle.get("gun") or {}).get("readout") or {}
        self._level_state = {}
        for p in readout.get("pools") or []:
            lv = p.get("levels")
            if isinstance(lv, list) and len(lv) == 7:
                self._level_state[p["pool"]] = self._level_for(p, p["pool"])
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
        self._readout_frame = g.get("rest")           # A16 §5: the strip now shows `rest` -- dark until a pool change paints a band

    async def game_end(self, outcome: str = "game_over") -> dict:
        """What the phone does at the whistle: the game_over / victory cue (+ its burst), then the end frames.
        Walkthrough 2026-09-04: the END step wrote only the teardown and was failed for having no sound."""
        self._event_now(outcome if outcome in ("game_over", "victory", "survivors_win") else "game_over")
        await self.sleep(1.2)
        return await self.end()

    async def end(self) -> dict:
        await self.write(self.bundle["end"], "end")
        self.spawned = False; self.alive = False
        self._level_gen += 1                       # Node rules: cancel everything on end
        return self.state()

    async def panic(self) -> dict:
        await self.write(self.bundle["panic"], "PANIC")
        self.spawned = False; self.alive = False
        self._level_gen += 1                       # Node rules: cancel everything on panic
        self._log("⚠ the gun now has NO $SIR table: re-ARM before it can be hit (F11)", "warn")
        return self.state()

    # ---- events (A11) -------------------------------------------------------------------------------
    def event(self, kind: str, sound: bool = True) -> dict:
        """Play cues[kind] + leds[kind] like engine.js `_event`: the LED burst is gated to one per second,
        a static $HLED step is skipped while down and yields to a newer headset sequence. `sound=False` =
        the lights only (revive already wrote the spawn line, A15.2).

        ⚠ Returns `self.state()` because the HTTP layer wants it — and `state()` is EXPENSIVE (measured
        527-658 ms on hardware 2026-09-07: it rebuilds the bundle view, the walkthrough plan and the
        sound-catalog descriptions). `_on_pools` calls this synchronously on every hit, so that cost sat
        directly between the gun reporting a hit and us painting the pool readout — the whole ~600 ms
        "LED lag" Tony saw at the bench, with nothing to do with BLE, the emitter or the firmware (which
        reports a hit in ~150 ms). Internal callers must use `_event_now()`, which does the work and
        returns nothing; only the HTTP action pays for the state build.
        """
        self._event_now(kind, sound)
        return self.state()

    def _event_now(self, kind: str, sound: bool = True) -> None:
        """`event()` without the state build — the path every in-game reaction uses (see the warning there)."""
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
            return
        t = self.now()
        if self._last_event_led is not None and t - self._last_event_led < EVENT_MIN_GAP_S:
            self._log(f"event {kind}: LED burst dropped (another inside 1 s)", "info")
            return
        self._last_event_led = t
        steps = [s for s in seq if not (str(s[0]).startswith("$HLED") and not self.alive)]
        self._spawn_task(self._event_leds(steps, kind))

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

    def _role_seq(self, name: str, tid: int | None) -> list | None:
        """A16 §3.3: the frames for one held role. `carrier`/`vip`/`beacon`/`extracted` are flat (a
        single sequence, no tid needed -- carrier is WHITE now, never the flag's team colour, finding
        #11); `infected` is keyed by tid, the one role whose colour is a team fact. Falls back to the
        pre-A16 `headset.carrier` table (`carrier` only) when this bundle predates `headset.role`."""
        hs = self.bundle.get("headset") or {}
        role = hs.get("role")
        if role:
            entry = role.get(name)
            return entry.get(str(tid)) if isinstance(entry, dict) else entry
        if name == "carrier":
            return (hs.get("carrier") or {}).get(str(tid)) if tid is not None else None
        return None

    def headset(self, name: str, tid: int | None = None) -> dict:
        hs = self.bundle.get("headset") or {}
        if not hs:
            self._log("headset: LEDs are off in this profile (night / blackout) -- nothing to paint", "warn")
            return self.state()
        if name in _pres.ROLE_STATES:
            t = int(tid) if tid is not None else (self.enemy_tid() if name in ("carrier", "infected") else None)
            seq = self._role_seq(name, t)
            if seq:
                self._active_role = (name, t)
                if name == "carrier":
                    self.carrying = t             # kept for state()'s "carrying" display + older callers
        elif name in ("carrier_off", "role_off"):
            self.carrying = None; self._active_role = None
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
    def _on_frame(self, ev) -> None:
        """The INSTANT path: `ble.ConnectionManager.connect(on_frame=...)` calls this the moment a BLE
        notification decodes a NEW rx frame -- like `app/src/engine.js` reacting to a notification, not
        on our next poll tick. `ev` duck-types `protocol.BufferedEvent` (`.direction`, `.seq`, `.raw`);
        the fake manager used by the tests has no notifications, so this is never called there and
        poll() alone drives it (see `_reacted_seq` below). Runs synchronously inside the BLE backend's
        notify callback, so it must never block -- `_on_rx` only ever spawns tasks (A11 events, pain,
        headset), it never awaits."""
        if getattr(ev, "direction", None) != "rx":
            return
        seq = int(getattr(ev, "seq", 0))
        if seq <= self._reacted_seq:
            return
        self._reacted_seq = seq
        raw = ev.raw
        self.tele["last_rx"] = raw
        self._log(raw, "rx")
        self._on_rx(raw)

    def poll(self) -> list[str]:
        """Drain new rx frames; with auto-react on, play the victim-side overlay the phone would.

        Reconciler/fallback for whatever the instant `_on_frame` callback did not see -- the fake gun
        (no notifications) is driven by this alone; on a real link it mainly just advances the fetch
        cursor, since `_reacted_seq` (bumped by `_on_frame` the moment a frame lands) makes every rx
        frame it already reacted to a no-op here, so nothing is ever handled twice."""
        if not self.connected:
            return []
        is_up = getattr(self.mgr, "is_connected", None)
        if is_up is not None and not is_up(self.alias):
            self.connected = False
            self._level_gen += 1                   # Node rules: cancel everything on a BLE drop
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
            seq = int(e.get("seq", 0))
            if seq <= self._reacted_seq:
                continue                      # the instant callback already reacted to this one
            self._reacted_seq = seq
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
                # $LCD's tokens 3+ are undocumented and read 0 in every observed frame (engine.js
                # `feedFrame`'s LCD case, same note): treating that 0 as a real shield report would
                # phantom-reset a live shield on every LCD, then read it as a "gain" on the next real
                # $HP -- masking real damage behind a fake pool increase. `None` here means "not
                # reported", not "zero"; `_on_pools` then keeps whatever shield it already had.
                shield = int(t[3] or 0) if cmd == "HP" and len(t) > 3 and t[3] != "" else None
                self.tele.update(hp=hp, armor=armor, **({"shield": shield} if shield is not None else {}))
                self._on_pools(hp, armor, shield)
        except ValueError:
            pass

    def _on_pools(self, hp: int, armor: int, shield: int | None = None) -> None:
        if shield is None:
            shield = self.shield          # not reported on this frame (an $LCD): keep the last known value
        if not (self.auto_react and self.spawned):
            self.hp, self.armor, self.shield = hp, armor, shield
            return
        before = self.hp + self.armor + self.shield
        prev_hp, prev_armor, prev_shield = self.hp, self.armor, self.shield
        dmg = max(0, before - (hp + armor + shield))
        # A16 §3.1/§5: which pool actually moved -- health, then armour, then shield (mirrors engine.js
        # `_onHp` / `poolgauge.changed_pool`: BRX depletes shield -> armour -> health, so if a hit went
        # all the way through to HP, health -- the innermost pool -- is the one worth showing).
        moved = "health" if hp != prev_hp else "armor" if armor != prev_armor else "shield" if shield != prev_shield else None
        self.hp, self.armor, self.shield = hp, armor, shield
        cues = self.bundle.get("cues", {})
        hs = self.bundle.get("headset") or {}
        if hp == 0 and self.alive:
            self.alive = False
            self._level_gen += 1                   # Node rules: cancel everything on death
            self._log("☠ down -- the firmware's own out-flash takes over; nothing extra written to the headset", "info")
            self._event_now("died")
            if hs.get("death"):
                self._headset(hs["death"], "headset death")
            down = hs.get("down")
            if down and down.get("rearm"):
                self._spawn_task(self._down_rearm(getattr(self, "_life", 0), down))
            self.carrying = None; self._active_role = None
            return

        if dmg > 0 and self.alive:
            hurt_now = False
            # A17.2 (Tony, bench 2026-09-07): an ACTUAL health threshold, not "armour just ran out". The
            # old condition fired on the FIRST health hit of a life, so an alert named "low health" meant
            # "your armour failed" -- audible at 44/45 HP. Mirrors engine.js.
            if hp > 0 and hp < LOW_HEALTH_HP and not self._hurt_fired:
                self._hurt_fired = True; hurt_now = True
                fr = [cues.get("hurt", ""), cues.get("hurt_led", "")]
                self._hs_gen += 1
                self._spawn_task(self.write(fr, "low health", gap_ms=0))
            self._event_now("hit_taken")
            self._pain(dmg, self._last_hir_proto, moved)   # A15.3: pain by damage; A17: only when it reached HEALTH -- never on a death (that returned above)
            if hs and not hurt_now:
                # A16 §3.3: whatever role is held (carrier/infected/vip/beacon/extracted) survives the
                # hit -- the native flash wipes the headset on every registered hit, so re-assert it.
                name, tid = self._active_role or (None, None)
                role_seq = self._role_seq(name, tid) if name else None
                if role_seq:
                    self._headset(role_seq, f"role {name} after hit")
                elif hs.get("hit"):
                    self._headset(hs["hit"], "headset hit")
        # A16 §3.1/§5 (readout) / A11.7 legacy (health bands): a hit does not clear a held paint, only
        # a real pool change writes a new one -- mirrors engine.js `_onHp`'s `if (hp > 0) this._gunPoolPaint(...)`,
        # called on ANY pool change (gains included), not only damage.
        if hp > 0:
            self._gun_pool_paint(moved)

    def _gun_pool_paint(self, pool: str | None) -> None:
        """A16 §3.1/§5: repaint the gun-body pool readout for whichever pool actually moved (mirrors
        engine.js `_gunPoolPaint`). A bundle with `gun.readout` pools gets the new segmented per-pool
        band; an older bundle (or a profile with `readout.pools` emptied) falls back unchanged to the
        pre-A16 health-only whole-strip band."""
        g = self.bundle.get("gun")
        if not g or not self.alive or not self.spawned or not getattr(self, "_gun_taken", False):
            return
        readout = g.get("readout")
        if readout and readout.get("pools"):
            if pool:
                self._readout_paint(pool)
            return
        if g.get("in_play") == "health":
            r = self._gun_rest()
            if r and r != self._gun_band:
                self._gun_band = r
                self._spawn_task(self.write([r], "gun health band", gap_ms=0))

    def _readout_band(self, entry: dict) -> list | None:
        """A16 §5: the highest band whose fraction the pool's CURRENT level/max exceeds (bands ordered
        highest-first, the same `frac > threshold` rule as `_gun_rest`). Mirrors engine.js `_readoutBand`."""
        pool = entry.get("pool")
        level = self.hp if pool == "health" else self.armor if pool == "armor" else self.shield
        maximum = entry.get("max") or 0
        frac = (level / maximum) if maximum > 0 else 0
        bands = entry.get("bands") or []
        for thr, frame in bands:
            if frac > thr:
                return [thr, frame]
        return bands[-1] if bands else None

    def _pool_values(self) -> dict:
        """The node's own view of its pools, keyed the way `poolgauge.handover_pool` expects."""
        return {"shield": self.shield, "armor": self.armor, "health": self.hp}

    def _readout_configured(self) -> list:
        return [p.get("pool") for p in ((self.bundle.get("gun") or {}).get("readout") or {}).get("pools") or []]

    def _readout_entry(self, pool: str):
        entry = next((p for p in ((self.bundle.get("gun") or {}).get("readout") or {}).get("pools") or []
                      if p.get("pool") == pool), None)
        lv = (entry or {}).get("levels")
        return entry if isinstance(lv, list) and len(lv) == 7 else None

    def _readout_paint(self, pool: str) -> None:
        """A16 §3.1 (bands) / A16.3 (levels): write the moved pool's readout if it differs from what is
        currently on the strip. `levels` (bar-spec.md, 2026-09-07: a 7-level scale with a drop/rise
        animation between the last DISPLAYED level and the new one) takes over when the compiled bundle
        carries it; falls back to the older single-write per-band behaviour below for a profile/bundle
        that has not been migrated (defensive -- the MC lane lands `levels` separately, in parallel)."""
        g = self.bundle.get("gun") or {}
        readout = g.get("readout") or {}
        entry = next((p for p in (readout.get("pools") or []) if p.get("pool") == pool), None)
        if not entry:
            return
        levels = entry.get("levels")
        if isinstance(levels, list) and len(levels) == 7:
            self._level_paint(readout, entry, pool)
            return
        if not entry.get("bands"):
            return
        # A16 §3.1: write the moved pool's band if it differs from what is currently believed to be on
        # the strip, and (re)start its hold; a repaint inside READOUT_COALESCE_S of the last WRITE
        # restarts the hold but is not written again (mirrors engine.js `_gunReadoutPaint`; a generation
        # counter stands in for its tick-poll -- it cancels a pending revert instead of needing one).
        band = self._readout_band(entry)
        if not band:
            return
        self._readout_last_pool = pool          # which pool a reload would glance -- not built here (no reload path on the stage yet)
        frame = band[1]
        if frame == self._readout_frame:
            return
        now = self.now()
        hold_s = float(readout.get("hold_s", 4))
        self._readout_gen += 1
        gen = self._readout_gen
        if self._readout_last_write_at is not None and now - self._readout_last_write_at < READOUT_COALESCE_S:
            self._spawn_task(self._readout_revert(gen, hold_s))     # coalesced: restart the hold, drop the write
            return
        self._readout_frame = frame
        self._readout_last_write_at = now
        self._spawn_task(self.write([frame], f"readout {pool}", gap_ms=0))
        self._spawn_task(self._readout_revert(gen, hold_s))

    async def _readout_revert(self, gen: int, hold_s: float) -> None:
        await self.sleep(hold_s)
        if gen != self._readout_gen or not self.alive:
            return                                  # a newer paint (or the life itself) superseded this hold
        g = self.bundle.get("gun") or {}
        rest = g.get("rest")
        if rest and self._readout_frame != rest:
            self._readout_frame = rest
            await self.write([rest], "readout rest", gap_ms=0)

    # ---- A16.3: the 7-level pool bar with a drop animation (bar-spec.md, 2026-09-07) ------------------
    def _level_for(self, entry: dict, pool: str) -> int:
        """`poolgauge.level_for` IS the formula (`clamp(round(fraction * 6), 0, 6)`, floored to 1 while
        the pool holds anything) -- delegate to it rather than re-deriving it, so the node's rounding
        can never quietly drift from what MC's own `levels` frame table assumes."""
        amount = self.hp if pool == "health" else self.armor if pool == "armor" else self.shield
        return _pg.level_for(amount, entry.get("max") or 0)

    def _level_paint(self, readout: dict, entry: dict, pool: str) -> None:
        """A16.3: (re)target the drop/rise animation at this pool's new level.

        "Animate from the last DISPLAYED level" (bar-spec.md Node rules) means: if the strip is
        currently showing THIS pool (mid-animation or settled), start from `_level_current` -- wherever
        it actually is; otherwise start from this pool's OWN last known level (`_level_state`, seeded at
        spawn from where it actually starts -- shield at 0, not 6, see `_after_spawn`). A change mid-
        animation therefore retargets the one running task rather than queuing a second (never queue,
        per spec) -- bumping `_level_gen` is enough since `_level_animate` checks it at every step.

        RAPID-RETRIGGER GUARD (review 2026-09-07, safety): a change landing within `min_gap_ms` (default
        400) of the last one is `rapid` -- `_level_animate` skips the lead freeze AND the all-off blink
        for it and steps straight from wherever the strip already is. Automatic fire is a burst of drops
        inside one second; without this, EVERY one of them replays its own dark all-off blink, which is a
        dark->lit transition each time -- `poolgauge.py`'s own docstring already flags that band as a
        photosensitivity risk ("looks like it's having a seizure"). The steps still carry the damage; the
        blink was never information, only ceremony."""
        levels = entry["levels"]
        target = self._level_for(entry, pool)
        if pool == self._readout_last_pool and self._level_current is not None:
            prev = self._level_current
        else:
            prev = self._level_state.get(pool, target)
        # ⚠ `_level_state[pool]` is written by `paint()` ONLY, i.e. only for a level a step actually put on
        # the strip. It used to be set to `target` here, before the animation ran, so an animation cut short
        # by ANOTHER pool's change (one shared `_level_gen` cancels across pools) left this pool remembering
        # a level it never reached -- and its next drop then animated from there while the phone animated
        # from where it actually got to. `engine.js` records inside its own paint (`_roLevels[pool] = lvl`),
        # so this is the phone's rule, not a new one. Found at session close, 2026-09-07.
        if pool == self._readout_last_pool and prev == target:
            return                                   # already showing this pool at this exact level
        self._readout_last_pool = pool
        lead_s = float(readout.get("lead_ms", 180)) / 1000
        gap_s = float(readout.get("blink_gap_ms", 80)) / 1000
        step_s = float(readout.get("step_ms", 120)) / 1000
        blink_s = float(readout.get("blink_ms", 400)) / 1000
        hold_s = float(readout.get("hold_s", 4))
        min_gap_s = float(readout.get("min_gap_ms", 400)) / 1000
        now = self.now()
        rapid = self._level_last_start is not None and (now - self._level_last_start) < min_gap_s
        self._level_last_start = now
        self._level_gen += 1
        gen = self._level_gen
        self._spawn_task(self._level_animate(gen, levels, prev, target, pool, rapid, lead_s, gap_s, step_s, blink_s, hold_s))

    async def _level_animate(self, gen: int, levels: list, prev: int, target: int, pool: str, rapid: bool,
                              lead_s: float, gap_s: float, step_s: float, blink_s: float, hold_s: float) -> None:
        """The whole life of one change, ONE task start to finish (never split across concurrent tasks --
        the settle-blink and the hold-then-revert used to race in an earlier draft of this, see git
        history): show the level you were at (`lead_s`) and, for a drop, one all-off blink (`gap_s`) --
        both skipped when `rapid` (see `_level_paint`) -- step one level per `step_s` until the target (no
        re-lighting -- a gain has no lead and no blink either way, review 2026-09-07: it steps up
        immediately, matching engine.js), settle, blink the target if it is a partial level for `hold_s`
        worth of `blink_s` cycles (a plain countdown, not a wall-clock deadline, so it terminates the
        same way under a test's instant `sleep` stub as it does on real hardware), then revert to the
        gun's rest frame. `gen` is checked before every write; a newer paint (`_level_paint`) or the life
        ending bumps `_level_gen` and every checkpoint below sees it and returns -- nothing here is ever
        cancelled from outside."""
        def live() -> bool:
            return gen == self._level_gen and self.alive

        async def paint(l: int) -> None:
            frame = levels[l][0]
            self._readout_frame = frame
            self._level_current = l
            self._level_state[pool] = l          # what this pool has actually SHOWN (see _level_paint)
            await self.write([frame], f"readout {pool} level {l}/6", gap_ms=0)

        if not live():
            return
        if target == prev:
            await paint(prev)                        # a pool switch with no level change: still show it
        elif target < prev:
            if not rapid:
                await paint(prev)
                await self.sleep(lead_s)
                if not live():
                    return
                off = levels[0][0]                   # "all segments off" IS level 0's solid frame (dark)
                self._readout_frame = off
                # ⚠ deliberately NOT `_level_current = 0`. The all-off blink is ceremony, not a level, and
                # `engine.js` leaves its own level bookkeeping untouched here. Recording it meant a same-pool
                # retrigger landing inside the 80 ms gap read prev=0, saw target > prev, and ran the GAIN
                # branch -- stepping UP, with no lead and no blink, for what was actually a continuing drop.
                await self.write([off], f"readout {pool} blink", gap_ms=0)
                await self.sleep(gap_s)
                if not live():
                    return
            for l in range(prev - 1, target - 1, -1):
                await paint(l)
                if l != target:
                    await self.sleep(step_s)
                    if not live():
                        return
        else:                                         # a gain: no lead, no blink, ever -- step up immediately
            await paint(prev)                        # engine.js: `step(from)` unconditionally, rapid or not
            for l in range(prev + 1, target + 1):
                await paint(l)
                if l != target:
                    await self.sleep(step_s)
                    if not live():
                        return
        # A16.5 (2026-09-09, found on the gun): the drain has finished. If THIS pool is now empty and
        # something inward still has value, hand over and show that instead of holding an all-dark
        # strip for `hold_s`. Dark is the reading a player takes as "nothing left", and the shot that
        # exposed this took armour 35 -> 0 while health was untouched at 45/45 -- the body went dark
        # while the player was at full health. The drain still played in full, so nothing is hidden;
        # the handover only replaces the dead hold that followed it. Mirrors `engine.js`.
        if target == 0:
            nxt = _pg.handover_pool(pool, self._pool_values(), self._readout_configured())
            if nxt != pool:
                inner = self._readout_entry(nxt)
                if inner:
                    await self.sleep(step_s)                 # a beat, so "it is gone" registers first
                    if not live():
                        return
                    pool, levels = nxt, inner["levels"]
                    target = self._level_for(inner, nxt)
                    self._level_state[pool] = target
                    # The handed-over pool is now what a RELOAD would glance. The stage has no reload
                    # path yet (F54), so this line changes nothing here today -- it is written to match
                    # `engine.js`, which does have one and where omitting it makes a glance straight
                    # after a handover re-derive the EMPTIED pool and repaint the very dark frame this
                    # feature exists to remove. Mirroring it now costs a line; discovering the
                    # divergence the day F54 is built costs a bench evening, which is this week's
                    # recurring bill.
                    self._readout_last_pool = pool
                    await paint(target)
        partial = levels[target][1] is not None
        self._level_partial = partial
        if partial:
            reps = max(1, round(hold_s / blink_s)) if blink_s > 0 else 1
            on = True
            for _ in range(reps):
                await self.sleep(blink_s)
                if not live():
                    return
                on = not on
                frame = levels[target][0] if on else levels[target][1]
                self._readout_frame = frame
                await self.write([frame], f"readout {pool} blink", gap_ms=0)
        else:
            await self.sleep(hold_s)
        if not live():
            return
        g = self.bundle.get("gun") or {}
        rest = g.get("rest")
        self._readout_last_pool = None
        self._level_current = None
        self._level_partial = False
        if rest and self._readout_frame != rest:
            self._readout_frame = rest
            await self.write([rest], "readout rest", gap_ms=0)

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
        # `can_ir` depends on `set_emitter()` (attach/detach), which does NOT go through `recompile()` --
        # baked into the cache KEY (not just cleared by recompile) so plugging in the emitter mid-bench
        # immediately flips every step's `available`, never serving a stale plan from before it was attached.
        can_ir = self.bridge is not None or hasattr(self.mgr, "inject_hit")
        return self._memo(("walk_plan", can_ir), lambda: self._build_walk_plan(can_ir))

    def _build_walk_plan(self, can_ir: bool) -> list[dict]:
        b = self.bundle; hs = b.get("headset") or {}; cues = b.get("cues", {}); leds = b.get("leds") or {}
        prof = _pres.resolve(self.config); g = b.get("gun")
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
                "gun: native hit flash, then " + ("the pool readout's band for whatever moved (shield/armour/health)" if g and g.get("readout") else "our hit_taken burst" if g else "no gun feedback") +
                (" · headset: " + ("flash then rest" if hs.get("hit") else "nothing") if hs else "") + (" · sound: hit_taken" if cues.get("hit_taken") else " · no hit sound"),
                "ir", {"kind": "shot"}, needs_ir=True)
            add("low_health", "LOW HEALTH (HP below 15, armour irrelevant)",
                "sound: the hurt line · headset: Callsign's fast blink · " + ("gun body: pool readout shows the health band" if g and g.get("readout") else "gun body: YELLOW then RED bands" if g and g.get("in_play") == "health" else "gun: hit flash only"),
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
        # A16 §3.3: held roles. `carrier`/`vip`/`beacon`/`extracted` are ONE flat state each (carrier is
        # WHITE now, never the flag's team colour, finding #11); `infected` alone stays per-team (the
        # one role whose colour is a team fact). A bundle that predates `headset.role` offers none of
        # these -- the stage never builds walkthrough steps off the pre-A16 `headset.carrier` shim, but
        # that shim itself stays in `presentation.headset_frames()` on purpose: every phone still in the
        # field runs an APK that predates `role` and falls back to reading it (FOLLOWUPS S10) -- this
        # slice ending at the BLE boundary is not the same as nothing on the other side reading it.
        role = hs.get("role") or {}
        if role.get("carrier"):
            add("carrier", "CARRYING A FLAG / OBJECTIVE", "headset: WHITE blink held; a hit keeps it blinking", "headset", {"name": "carrier"})
        if role.get("vip"):
            add("role_vip", "VIP", "headset: WHITE held; a hit keeps it lit", "headset", {"name": "vip"})
        if role.get("beacon"):
            add("role_beacon", "CARRYING THE RESPAWN BEACON", "headset: ORANGE blink held; a hit keeps it blinking", "headset", {"name": "beacon"})
        if role.get("extracted"):
            add("role_extracted", "EXTRACTED", "headset: WHITE held; a hit keeps it lit", "headset", {"name": "extracted"})
        for t in self.config["teams"]:
            if (role.get("infected") or {}).get(str(t["tid"])):
                add(f"infected_{t['tid']}", f"INFECTED (survivors see {t['name'].upper()})", "headset: that team's colour held; a hit keeps it lit", "headset", {"name": "infected", "tid": int(t["tid"])})
        if role:
            add("carrier_off", "ROLE ENDED (flag scored/lost, cured, extraction closed…)", "headset: back to the in-play rest (dark or team)", "headset", {"name": "carrier_off"})
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

    def _voices_options(self) -> list[dict]:
        """`voices.options()` -- the full voice picker -- depends on nothing but `VOICE_PACKS` and the
        catalog file, never on this instance's profile/bundle, so it is cached ONCE and never
        invalidated (unlike `_memo`, which is cleared on every `recompile()`). Measured the single
        biggest cost in `state()`: it calls `voices.lines()` once per family in `VOICE_PACKS`, and each
        of those walks the ~2477-id catalog rebuilding `sounds.on_gun_ids()` from scratch."""
        if self._voices_options_cache is None:
            self._voices_options_cache = _voices.options()
        return self._voices_options_cache

    def _memo(self, key, builder: Callable[[], Any]):
        """One entry of the `state()` cache (see `__init__`): built once per `recompile()`, kept until
        the next one. Never for a field that can change WITHOUT a recompile -- those get merged back in
        fresh by the caller, on top of whatever this returns."""
        if key not in self._cache:
            self._cache[key] = builder()
        return self._cache[key]

    def event_catalog(self) -> list[dict]:
        return self._memo("event_catalog", self._build_event_catalog)

    def _build_event_catalog(self) -> list[dict]:
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
        v = self.board_voice
        out = dict(self._memo(("board_view", v), lambda: self._build_board_view(v)))
        # LIVE: changes without a recompile (soundboard playback, a verdict click) -- never cached.
        out["playing"] = self.board_playing
        out["verdicts"] = self.voice_verdicts.get(v, {})
        return out

    def _build_board_view(self, v: str) -> dict:
        fam = _voices.family(v)
        return {"voice": v, "family": fam, "speaker": _voices.family_name(fam), "lines": self.board_lines(),
                "candidates": _voices.candidates(v), "is_game_voice": v == self.profile["voice"]}

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
        out = dict(self._memo("voice_view", self._build_voice_view))
        # LIVE: change per ARM/REROLL or per life, without necessarily going through a recompile
        # (`scream_this_life` is set by `_scream_take()` on every spawn/revive) -- never cached.
        out["rolled"] = dict(self.rolled)
        out["scream_this_life"] = self.scream_this_life
        return out

    def _build_voice_view(self) -> dict:
        voice, slots = self.profile["voice"], self.profile["voice_slots"]
        fam = _voices.family(voice)
        bv = self.bundle.get("voice") or {}
        return {"id": voice, "family": fam, "speaker": _voices.family_name(fam),
                "pset": _voices.pset_ids(voice, slots), "kill": _voices.role_id(voice, "kill", slots),
                "slots": dict(slots), "roles": list(_voices.VOICE_ROLES), "sound_roles": list(_voices.SOUND_ROLES),
                "fields": dict(_voices.PSET_FIELD), "plays_on": dict(_voices.PSET_PLAYS_ON),
                "lines": _voices.lines(voice, slots), "candidates": _voices.candidates(voice),
                "pools": dict(bv.get("pools") or {}),
                "spawn": self.spawn_takes(),                     # A15.2: the takes one of which plays on every spawn / revive
                "cue_pools": {ev: [{"id": _cue_id(f), "words": _snd.describe(_cue_id(f) or "")} for f in pool]
                              for ev, pool in (self.bundle.get("cue_pools") or {}).items() if isinstance(pool, list)},
                # A15.3: the death-scream takes (one $PSET write per life) and the pain pools (one per SURVIVED hit,
                # chosen by damage) -- both [] for a pre-A15.3 bundle, so the page falls back to the old pickers.
                "pset_pool": [{"id": i, "words": _snd.describe(i)} for i in (bv.get("pset_pool") or [])],
                "pain": {"short": self._role_takes("pain_short"), "long": self._role_takes("pain_long"),
                         "melee": self._role_takes("pain_melee"), "long_min": bv.get("pain_long_min", _voices.PAIN_LONG_MIN_DAMAGE)}}

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
                      "shield": self.shield, "max_hp": self.max_hp, "max_armor": self.max_armor,
                      "carrying": self.carrying, "auto_react": self.auto_react},
            "tele": dict(self.tele),
            # the flat sequences (start/hit/death/respawn/rest…) plus the A16 §3.3 held roles -- carrier
            # is ONE flat state now (WHITE, never the flag's team colour), not a per-team table, so it is
            # its own "roles" shape rather than living in this list any more (the deleted `carrier` shim
            # used to ride here).
            "headset_seqs": sorted(k for k, v in hs.items() if isinstance(v, list) and v and k != "pregame"),
            "roles": {n: (sorted((hs.get("role") or {}).get(n, {}).keys())
                          if isinstance((hs.get("role") or {}).get(n), dict) else bool((hs.get("role") or {}).get(n)))
                      for n in _pres.ROLE_STATES},
            "active_role": {"name": self._active_role[0], "tid": self._active_role[1]} if self._active_role else None,
            # A16 §3.1/§5: the transient gun-body pool readout, for the bench to watch shield/armour/health
            # move live -- `configured` is empty for a profile/older bundle with no readout at all.
            # A16.3: `level` (0-6) + `partial` (odd level -- currently blinking) are populated only while
            # a `levels`-bundle pool is actually shown; a `bands`-only bundle (or nothing painted yet)
            # leaves them null and the page falls back to decoding `frame` as a 3-segment strip.
            "readout": {"pool": self._readout_last_pool, "frame": self._readout_frame,
                        "level": self._level_current, "level_max": 6, "partial": self._level_partial,
                        "configured": [p.get("pool") for p in ((self.bundle.get("gun") or {}).get("readout") or {}).get("pools", [])],
                        # A16.3: the COMPILED level table and timings, so the page's LED simulator replays the
                        # frames MC actually ships rather than a hand-typed copy of them. A simulator fed its own
                        # literals proves nothing about the bundle -- that is the F52 "fallback literal" shape
                        # applied to a display, and it would happily show a beautiful animation of frames the gun
                        # never receives. 3 pools x 7 levels x 2 frames is ~42 short strings; measured negligible.
                        "levels": {p["pool"]: p.get("levels") for p in _ro_pools(self.bundle) if p.get("levels")},
                        "rest": (self.bundle.get("gun") or {}).get("rest"),
                        "timings": {k: v for k, v in ((self.bundle.get("gun") or {}).get("readout") or {}).items()
                                    if k in ("lead_ms", "blink_gap_ms", "step_ms", "blink_ms", "min_gap_ms",
                                             "hold_s", "reload_glance_s")}},
            "events": self.event_catalog(),
            "voice": self.voice_view(),
            "voices": self._voices_options(),
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
