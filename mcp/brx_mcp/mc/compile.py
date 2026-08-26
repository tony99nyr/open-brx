"""M-MODES — the FrameBundle compiler (docs/spec/modes.md §1.1–§8, contracts §3, A5/A6).

MC-side, pure (no clock, no BLE). Turns a GameConfig + Player + teams into the per-player
`FrameBundle` the node writes VERBATIM. Wraps the frame builders in `gameconfig.py`; the node never
compiles. Implements the `interfaces.Compiler` Protocol.

A6: `cues(voice)` returns **pre-composed `$PLAY` frames** (not bare ids); `validate()` returns
`{ok, errors, warnings}`. A5.1: `player_num` is 1..63 on the wire, 0 reserved (tutorial / unknown).
"""
from __future__ import annotations

import json
import pathlib
from typing import Any

from ..gameconfig import END_SEQUENCE, WEAPON_TAILS, _SIR_TABLE, GameConfig as _GC
from ..protocol import PANIC_SEQUENCE
from .types import MAX_PLAYERS, FrameBundle, GameConfig, Player, ScoreRow, Team, Weapon

VOL_PLAY = 69  # house rule — 30 is inaudible for game audio

# $WEAP full-frame token indices (0-based over the comma-split of "$WEAP,<slot>,<tail>"),
# protocol-classes §WEAP: 5=primaryDamage, 15=rateOfFire, 16=maxClip, 18=reloadSpeed(ms),
# 39=clipStartingAmmo, 40=ammoReserv, 41=gunRange%.
_W_MAG, _W_RELOAD, _W_CLIPSTART, _W_RESERVE = 17, 19, 40, 41   # doc tokN == split()[N+1]; the old values wrote MAG into the RoF token (found 2026-08-26)

# Kill-line id per voice family (§5/§5b). VA (male) + V3A (heavy "kill") are hardware-confirmed;
# the rest are the family's kill slot, best-effort until pinned.
_KILL_LINE = {"male": "VAA", "heavy": "V3A", "scout": "VBA", "medic": "V8S",
              "valkyrie": "VHR", "female": "VAA"}
_CONFIRMED_CUES = {"countdown", "kill"}   # everything else in cues() is provisional (real bank ids)

_HERE = pathlib.Path(__file__).resolve().parent


def _load_weapons() -> list[dict]:
    data = json.loads((_HERE / "weapons.json").read_text())
    return data["weapons"]


class WeaponCatalog:
    """§3 roster. `resolve(id, slot)` → "$WEAP,<slot>,<tail>"; `spawn_ammo(id)` → (mag, reserve)."""

    def __init__(self, rows: list[dict] | None = None) -> None:
        self._rows = rows if rows is not None else _load_weapons()
        self._by_id = {w["weapon_id"]: w for w in self._rows}

    def all(self) -> list[Weapon]:
        """Visible catalog (hidden melee excluded), as contracts §3 Weapon shape."""
        out: list[Weapon] = []
        for w in self._rows:
            if w.get("hidden"):
                continue
            out.append({
                "weapon_id": w["weapon_id"], "name": w["name"], "cls": str(w["cls"]),
                "desc": w.get("desc", ""),
                "stats": {"mag": w["mag"], "reserve": w["reserve"], "reload_ms": w["reload_ms"],
                          "dmg": w["dmg"], "rof": w["rof"], "rng": w["rng"]},
                "weap_frame": self.resolve(w["weapon_id"], 0),
                "verified": bool(w.get("verified", False)),
            })
        return out

    def _row(self, weapon_id: str) -> dict:
        if weapon_id not in self._by_id:
            raise KeyError(f"unknown weapon_id {weapon_id!r}")
        return self._by_id[weapon_id]

    # §6 sample frames (tail after "$WEAP,<slot>") — hardware/capture-derived. "laser"/"rocket" are the
    # slot-2/slot-5 Callsign captures (protocol §6): proto 10 + C03 identifies slot 5 as the rocket launcher.
    SAMPLES = {
        "ar":     WEAPON_TAILS["ar"] if "ar" in WEAPON_TAILS else WEAPON_TAILS["primary"],
        "charge": WEAPON_TAILS.get("charge", WEAPON_TAILS["primary"]),
        "laser":  ",,100,0,0,150,0,,,,,,,,1000,850,2,32768,2000,0,7,100,100,,0,,,E07,D32,D31,,D17,D16,D15,A73,,,,,2,9999999,75,,",
        "rocket": ",1,90,10,0,115,0,,,,,,115,80,1000,850,2,32768,1200,0,7,100,100,,0,,,C03,,,,D14,D13,D12,D18,,,,,2,9999999,30,20,",
    }
    # token map indices (protocol-classes.md "WEAP exact token positions"; doc tokN == split()[N+1])
    _T = {"proto": 3, "subtype": 4, "dmg": 5, "charge": 14, "fire": 15, "mag": 16, "reload": 18,
          "snd_fire": 27, "snd_up": 28, "snd_down": 29, "rel1": 31, "rel2": 32, "rel3": 33, "noammo": 34,
          "clipstart": 39}

    def resolve(self, weapon_id: str, slot: int) -> str:
        """$WEAP frame for a slot. Verified weapons emit their exact hardware tail. Provisional ones are
        built from the closest CAPTURED sample frame with the weapon's `wire` table applied: IR
        protocol/subtype (so the victim's $SIR row interprets rail/rocket/energy correctly), real damage,
        fire cadence, mag/reload and the per-family sound block — 2026-08-26, after the bench showed every
        templated weapon sounding and behaving like the AR. Still provisional until each is bench-fired."""
        w = self._row(weapon_id)
        if w.get("verified"):
            base = w.get("base", "ar")
            return f"$WEAP,{slot}{WEAPON_TAILS[base]}"
        wire = w.get("wire")
        if not wire:                                   # no wire table: old mag/reload substitution
            base = w.get("base", "ar")
            full = f"$WEAP,{slot}{WEAPON_TAILS[base]}"
            p = full.split(",")
            p[_W_MAG] = str(w["mag"]); p[_W_CLIPSTART] = str(w["mag"])
            p[_W_RESERVE] = str(w["reserve"]); p[_W_RELOAD] = str(w["reload_ms"])
            return ",".join(p)
        tail = self.SAMPLES[wire.get("sample", "ar")]
        p = f"$WEAP,{slot}{tail}".split(",")
        T = self._T
        def put(key: str, val) -> None:
            p[T[key] + 1] = str(val)
        put("proto", wire["proto"]); put("subtype", wire["subtype"]); put("dmg", wire["dmg"])
        put("fire", wire["fire_ms"]); put("mag", w["mag"]); put("clipstart", w["mag"]); put("reload", w["reload_ms"])
        if wire.get("charge_ms") is not None:
            put("charge", wire["charge_ms"])
        snd = wire.get("sounds") or {}
        put("snd_fire", snd.get("fire", "")); put("snd_up", snd.get("up", "")); put("snd_down", snd.get("down", ""))
        rel = snd.get("rel") or ["", "", ""]
        put("rel1", rel[0]); put("rel2", rel[1]); put("rel3", rel[2]); put("noammo", snd.get("noammo", ""))
        return ",".join(p)

    def spawn_ammo(self, weapon_id: str) -> tuple[int, int]:
        w = self._row(weapon_id)
        return int(w["mag"]), int(w["reserve"])


class Compiler:
    """Implements interfaces.Compiler."""

    def __init__(self, catalog: WeaponCatalog | None = None) -> None:
        self.catalog = catalog or WeaponCatalog()

    # -- helpers -----------------------------------------------------------
    def _to_gc(self, config: GameConfig, player: Player | None = None) -> _GC:
        """Map the contracts §3 GameConfig (TypedDict) onto the gameconfig.py dataclass — only the
        fields whose frames we reuse (_gset/_pset/_bmap/_led_frames). Weapons + ammo come from the
        catalog, not the dataclass, so primary/secondary are left at their defaults."""
        led = config.get("led") or {}
        ov = ((player or {}).get("loadout", {}) or {}).get("overrides") or {}   # per-player HP/armor (modes §1.1)
        return _GC(
            mode=config["mode"],
            game_time_s=config["time_limit_s"] or 0,
            respawn_s=config["respawn"]["delay_s"],
            respawns=0 if config["respawn"]["type"] == "none" else None,
            frag_limit=config["scoring"].get("frag_limit") or 0,
            volume=VOL_PLAY,
            outdoor=config["environment"] == "outdoor",
            # blackout LED-off on night OR an explicit led.mode=="off" (modes §6)
            leds=(led.get("mode", "team") != "off") and not config.get("night", False),
            friendly_fire=(config["mode"] == "ffa"),  # FFA needs the gun to register same-$TID hits
            hp=int(ov.get("max_hp", config["health"]["max_hp"])),
            armor=int(ov.get("max_armor", config["health"]["max_armor"])),
        )

    @staticmethod
    def _tid(player: Player, teams: list[Team]) -> int:
        by_id = {t["team_id"]: t for t in teams}
        tm = by_id.get(player.get("team_id") or "")
        return int(tm["tid"]) if tm else 0

    def _weapon_ids(self, player: Player) -> tuple[str, str]:
        w = player.get("loadout", {}).get("weapons", [])
        primary = w[0]["weapon_id"] if len(w) > 0 else "assault_rifle"
        secondary = w[1]["weapon_id"] if len(w) > 1 else "shotgun"
        return primary, secondary

    # -- Compiler Protocol -------------------------------------------------
    def compile(self, config: GameConfig, player: Player, teams: list[Team]) -> FrameBundle:
        gc = self._to_gc(config, player)
        pnum = int(player["player_num"])
        if not 1 <= pnum <= MAX_PLAYERS:
            raise ValueError(f"player_num {pnum} out of range 1..{MAX_PLAYERS} (0 reserved, A5.1)")
        tid = self._tid(player, teams)
        w0, w1 = self._weapon_ids(player)

        # head — config, per player, SILENT (no $SPAWN, no $PLAY,VA81); ends with $TID (§1.1)
        head = [f"$VOL,{VOL_PLAY},0,*", "$CLEAR,*", "$START,*",
                gc._gset(), gc._pset(pnum),
                self.catalog.resolve(w0, 0), self.catalog.resolve(w1, 1),
                self.catalog.resolve("melee", 4)]
        head += list(_SIR_TABLE) + list(gc._bmap()) + gc._led_frames() + [f"$TID,{tid},*"]

        pmag, pres = self.catalog.spawn_ammo(w0)
        smag, sres = self.catalog.spawn_ammo(w1)
        ammo = [f"$AMMO,0,{pmag},{pres},1,*", f"$AMMO,1,{smag},{sres},1,*"]

        # spawn = $PLAYX,0 -> $SPAWN -> $AMMOs -> $BMAP,0,0 (the T-0 tail; M-START wraps VA81 + $SFLASH)
        spawn = ["$PLAYX,0,*", "$SPAWN,,*"] + ammo + ["$BMAP,0,0,,,,,*"]
        # revive = $SPAWN + loadout $AMMOs (NO $HLOOP, NO $BMAP — §1.1 replaces RESPAWN_SEQUENCE)
        revive = ["$SPAWN,,*"] + ammo

        bundle: FrameBundle = {
            "config_id": config["config_id"],
            "player_id": player["player_id"],
            "head": head,
            "spawn": spawn,
            "revive": revive,
            "end": list(END_SEQUENCE),
            "panic": list(PANIC_SEQUENCE),
            "cues": self.cues(player.get("voice", "male")),
        }
        if config["mode"] == "infection":
            # move THIS gun to each other team's $TID on death, then re-arm (node emits team_change)
            flip: dict[str, list[str]] = {}
            for t in teams:
                if int(t["tid"]) != tid:
                    flip[str(t["tid"])] = [f"$TID,{t['tid']},*"] + revive
            bundle["team_flip"] = flip
        return bundle

    def tutorial_frames(self, weapon: Weapon, environment: str) -> list[str]:
        """§4 private try-out: one weapon, identity 0 (uncredited), audible (VOL 69). Needs $START + a $TID to
        actually fire (bench 2026-08-25); identity 0 keeps any stray hit off the scoreboard."""
        outdoor = 1 if environment == "outdoor" else 0
        wid = weapon["weapon_id"]
        mag, reserve = self.catalog.spawn_ammo(wid)
        # $PSET,0 = "no identity" (A5.1) so a stray try-out hit reports shooter 0, never credited.
        pset = "$PSET,0,0,45,70,70,50,,H44,JAD,V33,V3I,V3C,V3G,V3E,V37,H06,H55,H13,H21,H02,U15,W71,A10,*"
        return [
            "$VOL,69,0,*", "$CLEAR,*", "$START,*",   # $START IS required — bench 2026-08-25: without it the gun
                                                     # spawns but the trigger only reloads, it will not fire IR
            f"$GSET,0,{outdoor},1,0,1,0,50,1,*",   # FF off, env
            pset,
            "$SIR,0,0,,1,0,0,1,,*",                # standard-weapon IR interpretation so a try-out shot registers
            "$TID,1,*",                            # a team is needed to spawn-to-live (identity stays 0 → uncredited)
            self.catalog.resolve(wid, 0),          # the one weapon, slot 0
            "$SPAWN,,*", "$PLAYX,0,*",              # live, then silence the spawn chirp
            f"$AMMO,0,{mag},{reserve},1,*",
            "$BMAP,0,0,,,,,*",
        ]

    def cues(self, voice: str) -> dict[str, str]:
        """A6: pre-composed `$PLAY` frames (node writes verbatim; only $SFLASH/$PLAYX,0 are its own
        templates). Two-slot `$PLAY,<fx>,4,6,<voice>,,,,*`: token1 = SFX, token4 = voice line."""
        kill = _KILL_LINE.get(voice, "VAA")
        return {
            "countdown": "$PLAY,VA81,4,6,,,,,*",         # confirmed 3-2-1-GO (VA81, slot 1)
            "kill":      f"$PLAY,,4,6,{kill},,,,*",       # confirmed kill line (slot 4, voice-family)
            "game_over": "$PLAY,VA33,4,6,,,,,*",         # CONFIRMED by ear 2026-08-25: "game over" (neutral — a node ending on its own timer does not know the winner)
            "victory":   "$PLAY,VSF,4,6,JAY,,,,*",        # CONFIRMED by ear 2026-08-25: victory sting + "victory" (winners only, MC-sent at recap when in coverage)
            "tick":      "$PLAY,U16,4,6,,,,,*",             # provisional id; 4,6 required — the empty-token form is SILENT (bench 2026-08-25) SFX tick (real bank id)
            "klaxon":    "$PLAY,U16,4,6,,,,,*",             # provisional id; 4,6 required — the empty-token form is SILENT (bench 2026-08-25)
            "multi":     "$PLAY,,4,6,VA46,,,,*",          # provisional (nRF-native is silent over BLE)
            "medal":     f"$PLAY,,4,6,{kill},,,,*",       # provisional (reuse kill line until pinned)
            "runway_30": "",                              # SILENT for now — VA85 at 30 AND 20 AND 10 stacked the same counting track (bench 2026-08-25); pin distinct lines by ear
            "runway_20": "",                              # SILENT (see runway_30)
            "runway_10": "$PLAY,,4,6,VA85,,,,*",          # provisional
        }

    def validate(self, config: GameConfig, roster: list[Player],
                 opts: dict | None = None) -> dict:
        """§7 rules → {ok, errors, warnings} (A6: frag-limit-without-coverage is a WARNING)."""
        opts = opts or {}
        errors: list[str] = []
        warnings: list[str] = []
        mode = config.get("mode", "tdm")
        covered = opts.get("coverage") == "full"

        # time limit: required (>0) on the phone path unless a fully-covered venue is asserted
        tl = config.get("time_limit_s")
        if not covered and (tl is None or tl <= 0):
            errors.append("time_limit_s is required (>0) unless opts.coverage=='full' (A4.8)")

        # player_num: unique + 1..63 across the roster
        nums = [p.get("player_num") for p in roster]
        for n in nums:
            if n is None or not (1 <= int(n) <= MAX_PLAYERS):
                errors.append(f"player_num {n} out of range 1..{MAX_PLAYERS} (0 reserved, A5.1)")
        dupes = {n for n in nums if nums.count(n) > 1}
        if dupes:
            errors.append(f"duplicate player_num across roster: {sorted(dupes)}")

        # team tids unique
        tids = [t["tid"] for t in config.get("teams", [])]
        if len(tids) != len(set(tids)):
            errors.append("duplicate team tid")

        # ffa ⇒ exactly one team (one $TID); friendly fire is forced on in compile (§2/A5.2)
        if mode == "ffa" and len({t["tid"] for t in config.get("teams", [])}) > 1:
            errors.append("ffa requires a single $TID (one team); identity is $PSET, not $TID (A4.1)")

        # lms ⇔ no auto-respawn (none / finite lives)
        if mode == "lms" and config.get("respawn", {}).get("type") == "auto":
            errors.append("lms cannot use respawn.type=='auto'")

        # station-gated objective modes need a Tier-1 station/objective source (modes §7).
        # `extraction` is deliberately NOT gated: its objective logic runs MC-side on gun events
        # (modes §2 — coverage-zone gameplay), no IR station required.
        if mode in {"domination", "koth", "ctf", "cs", "bomb"} and not opts.get("station_source"):
            errors.append(f"mode {mode!r} needs a station/objective source (Tier 1) — set opts.station_source")

        # unknown weapon ids
        for p in roster:
            for w in p.get("loadout", {}).get("weapons", []):
                if w["weapon_id"] not in self.catalog._by_id:
                    errors.append(f"unknown weapon_id {w['weapon_id']!r}")

        # frag-limit on a non-covered venue is a coverage-zone early end, not a guaranteed win (C1/M7)
        if (config.get("scoring", {}).get("frag_limit") or 0) > 0 and not covered:
            warnings.append("frag_limit on a non-full-coverage venue is an in-coverage early end only; "
                            "the guaranteed end is time_limit_s (A4.8) — winner is provisional until recap")

        return {"ok": not errors, "errors": errors, "warnings": warnings}

    def weapon_catalog(self) -> list[Weapon]:
        return self.catalog.all()

    def award_medals(self, rows: list[ScoreRow], kills: list[dict]) -> dict[str, list[str]]:
        """§5b award rules → {player_id: [medal_id]}. Exact per-player (A4.1)."""
        out: dict[str, list[str]] = {r["player_id"]: [] for r in rows}
        # honors need an audience: with < 3 scored players every medal is a participation trophy
        # ("MVP · 0 K · 0.0 K/D" on a 1-player recap — design review 2026-08-26 #3)
        if len(rows) < 3:
            return out

        def add(pid: str, medal: str) -> None:
            if pid in out and medal not in out[pid]:
                out[pid].append(medal)

        # single-winner medals (ties broken as noted)
        mvp = max(rows, key=lambda r: (r["kills"] - r["deaths"], r["kd"]))
        if mvp["kills"] > 0:                      # an MVP with zero kills is noise, not an honor
            add(mvp["player_id"], "MVP")
        top = max(rows, key=lambda r: r["kills"])
        if top["kills"] > 0:
            add(top["player_id"], "TOP_GUN")
        # K/D floored so a 1-0 isn't crowned
        kd_pool = [r for r in rows if (r["deaths"] + r["shots"]) > 0]
        if kd_pool:
            best_kd = max(kd_pool, key=lambda r: r["kd"])
            add(best_kd["player_id"], "HIGHEST_KD")
        acc_pool = [r for r in rows if r["accuracy"] is not None and r["shots"] >= 10]
        if acc_pool:
            sharp = max(acc_pool, key=lambda r: r["accuracy"] or 0.0)
            add(sharp["player_id"], "SHARP_SHOOTER")
        surv = min(rows, key=lambda r: r["deaths"])
        if surv["deaths"] < max(r["deaths"] for r in rows):   # only when someone actually outlived the field
            add(surv["player_id"], "SURVIVALIST")
        most_assist = max(rows, key=lambda r: r["assists"])
        if most_assist["assists"] > 0:
            add(most_assist["player_id"], "ASSISTANT")

        # first blood — earliest kill by t
        real_kills = [k for k in kills if k.get("killer")]
        if real_kills:
            fb = min(real_kills, key=lambda k: k["t"])
            add(fb["killer"], "FIRST_BLOOD")
        # double / triple — per-player, repeatable
        for k in kills:
            m = k.get("multi") or 0
            if k.get("killer") and m >= 2:
                add(k["killer"], "TRIPLE_KILL" if m >= 3 else "DOUBLE_KILL")
        return out


# Module singleton + the committed golden bundle other lanes import as their fixture (M10).
_DEFAULT = Compiler()


def default_compiler() -> Compiler:
    return _DEFAULT


def golden_bundle() -> FrameBundle:
    """One canonical bundle (M10) — the shared fixture for M-NODE/M-START/M-MC so no lane hand-rolls
    its own copy. Blue player #7, assault_rifle + shotgun, TDM."""
    config: GameConfig = {
        "config_id": "golden-tdm", "mode": "tdm", "environment": "indoor", "night": False,
        "time_limit_s": 600, "respawn": {"type": "auto", "delay_s": 15},
        "scoring": {"frag_limit": 0, "win_by": "kills"},
        "health": {"max_hp": 45, "max_armor": 70},
        "teams": [{"team_id": "blue", "name": "Blue", "color": "blue", "tid": 1},
                  {"team_id": "yellow", "name": "Yellow", "color": "yellow", "tid": 2}],
    }
    player: Player = {
        "player_id": "p-golden", "player_num": 7, "display": "REAPER", "team_id": "blue",
        "node_id": None, "gun_id": None, "voice": "male", "ready": True,
        "loadout": {"weapons": [{"weapon_id": "assault_rifle"}, {"weapon_id": "shotgun"}]},
    }
    return _DEFAULT.compile(config, player, config["teams"])
