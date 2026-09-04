"""M-MODES — the FrameBundle compiler (docs/spec/modes.md §1.1–§8, contracts §3, A5/A6).

MC-side, pure (no clock, no BLE). Turns a GameConfig + Player + teams into the per-player
`FrameBundle` the node writes VERBATIM. Wraps the frame builders in `gameconfig.py`; the node never
compiles. Implements the `interfaces.Compiler` Protocol.

A6: `cues(voice)` returns **pre-composed `$PLAY` frames** (not bare ids); `validate()` returns
`{ok, errors, warnings}`. A5.1: `player_num` is 1..63 on the wire, 0 reserved (tutorial / unknown).
"""
from __future__ import annotations

import json
import math
import pathlib
from typing import Any

from ..gameconfig import END_SEQUENCE, WEAPON_TAILS, _SIR_TABLE, GameConfig as _GC
from ..protocol import PANIC_SEQUENCE
from .perks import PerkCatalog
from .types import MAX_PLAYERS, FrameBundle, GameConfig, Player, ScoreRow, Team, Weapon
from . import presentation as _pres
from .. import poolgauge as pg

# Field-corrected 2026-08-30 (first live 2-player match on the Mac): $VOL,69 — the value iOS
# Callsign sends — plays at roughly **on-gun level 2** and Tony called it "super low" outdoors.
# The on-gun menu maps L1=60 L2=70 L3=80 L4=90 L5=100 (protocol/brx-protocol.md $VOL), so play
# volume is now taken from the venue: L3 indoors, L4 outdoors (the level he asked for).
# `$HLED` token 5: Callsign ships **10** in every populated LED frame on disk. Tony asked for the
# on-hit alert to be brighter and I raised it to 100 — that was WRONG and is reverted.
# ⛔ We do NOT know this token is brightness. The 2026-08-30 per-field sweep pinned token 5 on
# `$GLED` (the GUN), not on `$HLED` (the HEADSET), and the two commands demonstrably do not share a
# layout: `$GLED,,,,5` blanks by APPLYING empty colour tokens, `$HLED,,6` blanks via token 2. The APK's headset LED
# family exposes `LedColorType` / `BlinkLoopType(Once, ThreeTimes, Infinite)` / `LedEffectType` —
# counts and effects, not a brightness scale. Given tokens 3/4 are `90,90` (an on/off ms pair), the
# likeliest alternative is a REPEAT COUNT, in which case 100 would turn Callsign's ~1.8 s alert into
# ~18 s of blinking: it would light a player up for the next ten seconds of a firefight.
# It also destroyed the experiment. Raising it in the same commit that added the "did the cue fire?"
# log meant the next field test could not separate "our code never fired" from "the gun rejected the
# value". Callsign's 10 is the known-good control and it stays until the cue is confirmed firing.
# ➡ 2026-09-02, from the Windows lane's video rig: on `$GLED` token 5 is a brightness with exactly
#   TWO levels above off — 1 is dim (~70%), anything >=2 is full, identical all the way to 255 —
#   and **Callsign's 10 already sits in the saturated region**. If `$HLED` behaves the same, 10 is
#   ALREADY maximum and raising it can do nothing: a dim on-hit alert would be a hardware limit,
#   not a value we are under-driving. Measured on the GUN LEDs, so still an inference for the
#   headset — but it is now the likely answer, and it is cheaper to test than to sweep.
HEADSET_ALERT_BRIGHTNESS = 10

VOL_BY_ENV = {"indoor": 80, "outdoor": 90}
VOL_PLAY = VOL_BY_ENV["indoor"]    # unknown venue -> the QUIETER of the two (see play_volume)
VOL_TRYOUT = 69                    # a try-out is fired at ARM'S LENGTH from the player's own head,
                                   # so it keeps the quieter Callsign value (review 2026-08-31).
                                   # The field complaint was about hearing a game across a field.


# The health pool every published weapon stat is quoted against: 45 HP + 70 armour, the GameConfig
# default. It is a DEFAULT, not a constant of the game — MC lets the host change `health`, and
# `weapon_view(..., pool=)` follows it (docs/weapon-design.md §2.5). Only `stats.dmg`, whose
# definition *is* "share of a 115 pool", is pinned here.
DEFAULT_POOL = 115


# Token 1 is a headset colour index. Across all 23 captures it is only ever 0, 1, 7 or empty, and the
# APK's `LedColorType` has only a handful of members — so a 4-team game's tid 2/3, and certainly any
# larger tid, would be a token we cannot name. Emit it only for the values Callsign has been seen to
# send, and stay silent otherwise rather than guess.
# 2026-09-02/03: the headset palette was read off hardware -- indices 0-7 render the same hues as the
# gun (0 red · 1 blue · 2 yellow · 3 green · 4 purple · 5 teal · 6 white · 7 pink), so a 4-team
# game's tid 2/3 now has a known colour and is emitted too. ⚠ 3 is GREEN, the headset's own death
# out-blink colour; a green team's headset is ambiguous while a player is down. Larger tids stay silent.
_HLED_SEEN_COLOURS = (0, 1, 2, 3)


def _headset_colour(tid: int, leds: bool) -> list[str]:
    """The pre-game headset team colour, or nothing.

    Skipped when the game has LEDs off: `gc._led_frames()` blanks the GUN for night/blackout play, and
    lighting the headset in the same head would mark every player in the lobby — exactly what that
    setting exists to prevent (review 2026-09-01).
    """
    if not leds or tid not in _HLED_SEEN_COLOURS:
        return []
    return [f"$HLED,{tid},0,,,10,,*"]


def play_volume(environment: str | None) -> int:
    """$VOL for game audio at this venue. See VOL_BY_ENV — 69 was measurably too quiet outdoors.

    An unrecognised venue resolves to the INDOOR value. `set_config` validates `indoor|outdoor`, so
    this is only reachable through a preset or a hand-edited config — but the failure has to be quiet,
    not loud: guessing "outdoor" for an unknown venue means blasting L4 into someone's ear indoors.
    """
    return VOL_BY_ENV.get((environment or "").strip().lower(), VOL_PLAY)

# ---- $SIR effect classes (bench-measured 2026-08-26; experiment-log "the COMPLETE two-sided $SIR
# function map + crit multiplier + FF enforcement"). A weapon's <t3,t4> is the composite key into the
# $SIR table MC pushes in every game head, and the ROW'S FUNCTION decides what the IR word's magnitude
# does. So damage is a property of the (weapon, table) PAIR, never of the weapon alone.
# ⚠ fn 3 was REMOVED from this set 2026-08-29 (exp-log "FLOOR ARTIFACT CLOSED: fn 3 is DAMAGE").
# It only looked inert because the original sweep ran with the shield at 0; re-measured with a shield
# granted first, it drains exactly what fn 1 drains. It is plain damage and lives in _SIR_PLAIN_DAMAGE.
_SIR_NO_POOL = frozenset({8, 23, 24, 25, 26, 27, 28, 35, 31, 32, 34})     # registers a $HIR, moves no pool
# ✅ CONFIRMED 2026-09-02 (bench item 0.1 CLOSED): fn 36 lands floor(magnitude * 1.25) and fn 37 lands
# magnitude * 2. 16 trials, magnitudes 20/40/9/7, 8 $SIR row-tail shapes, with an fn 1 control on
# subtype 0 in every trial. The x1.25 TRUNCATES: 7 * 1.25 = 8.75 lands as 8, not 9. Row tails do not
# gate it. Measured through OUR $SIR table (the victim's row picks the function), which is what we ship.
# Retracted: the 2026-08-27 "DISPUTED" reading, whose 24-cell matrix read x1.0 with a valid fn 1
# control -- that run is OUTVOTED, NOT EXPLAINED. See docs/weapon-design.md §6 and brx-protocol.md §5.
_SIR_MULTIPLIER = {36: 1.25, 37: 2.0}                # magnitude scaling; applied = floor(mag * mult)
_SIR_ARMOR_PIERCING = frozenset({2, 6})           # bypasses armor AND shields -> straight to bare HP
_SIR_GRANT = frozenset(range(9, 23))              # heals/armor/shields: a "damage" weapon here HELPS the target
# ALLOW-LIST, deliberately: only these are bench-confirmed plain 1x damage. Anything not listed is
# warned about, because the failure we are guarding against (a weapon that cannot hurt anyone, or
# worse, heals what it shoots) lives precisely in the functions we have NOT characterised.
_SIR_PLAIN_DAMAGE = frozenset({1, 3, 4, 5, 7, 29, 30, 33, 38})   # 3 added 2026-08-29, see above


def _sir_index(table) -> dict[tuple[str, str], int]:
    """`$SIR,<proto>,<sub>,<snd>,<fn>,...` → {(proto, sub): fn}."""
    out: dict[tuple[str, str], int] = {}
    for row in table:
        t = row.strip().lstrip("$").rstrip("*").rstrip(",").split(",")
        if len(t) > 4 and t[0] == "SIR":
            try:
                out[(t[1] or "0", t[2] or "0")] = int(t[4] or 0)
            except ValueError:
                continue
    return out


# $WEAP full-frame token indices (0-based over the comma-split of "$WEAP,<slot>,<tail>"),
# protocol-classes §WEAP: 5=primaryDamage, 15=rateOfFire, 16=maxClip, 18=reloadSpeed(ms),
# 39=clipStartingAmmo, 40=ammoReserv, 41=gunRange%.
_W_MAG, _W_RELOAD, _W_CLIPSTART, _W_RESERVE = 17, 19, 40, 41   # doc tokN == split()[N+1]; the old values wrote MAG into the RoF token (found 2026-08-26)

# Kill-line id per voice family (§5/§5b). VA (male) + V3A (heavy "kill") are hardware-confirmed;
# the rest are the family's kill slot, best-effort until pinned.
# Kill lines LISTED in protocol/callsign-extract/sound-bank.md's pack examples. ⚠ Not confirmed by
# ear — that file's only 'heard' annotations are V3I, H29, VA8C and VA16. Unlike the six $PSET
# voice slots these do NOT share a suffix across families (A, S, A, A, R, A), so they are listed
# rather than derived — a family with no confirmed line falls back to its own "<fam>A", which is
# the majority pattern, and finally to VAA.
_KILL_LINE_DOCUMENTED = {"heavy": "V3A", "medic": "V8S", "male": "VAA", "scout": "VBA",
                        "valkyrie": "VHR", "clean_male": "VEA"}


def kill_line(voice: str | None) -> str:
    from ..gameconfig import VOICE_PACKS
    v = (voice or "male").lower()
    if v in _KILL_LINE_DOCUMENTED:
        return _KILL_LINE_DOCUMENTED[v]
    fam = VOICE_PACKS.get(v)
    return f"{fam}A" if fam else "VAA"
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
                "tags": list(w.get("tags") or []), "role": w.get("role", ""),   # A10 policy vocabulary
                "stats": {"mag": w["mag"], "reserve": w["reserve"], "reload_ms": w["reload_ms"],
                          "dmg": w["dmg"], "rof": w["rof"], "rng": w["rng"],
                          "htk": w.get("htk"), "ttk_ms": w.get("ttk_ms"),   # A10: HITS TO KILL replaces the flat RANGE bar in the UIs
                          # the pool-INDEPENDENT chain the views re-derive htk/ttk from when the host
                          # changes `health` (W2, docs/weapon-design.md §2.5). `dmg` above is a share
                          # of the 115 default and cannot be rescaled; `dmg_hit` is the real magnitude.
                          "dmg_hit": self.damage(w["weapon_id"]),
                          "cycle_ms": self.cycle_ms(w["weapon_id"]),
                          "charged": self._frame_int(w["weapon_id"], "mode") in self._CHARGE_MODES},
                "weap_frame": self.resolve(w["weapon_id"], 0),
                "verified": bool(w.get("verified", False)),
                **({"caution": w["caution"]} if w.get("caution") else {}),  # A10: known live problem, human copy
            })
        return out

    def _row(self, weapon_id: str) -> dict:
        if weapon_id not in self._by_id:
            raise KeyError(f"unknown weapon_id {weapon_id!r}")
        return self._by_id[weapon_id]

    # doc token positions (protocol-classes.md, cross-checked against 19 captured frames by
    # `python -m brx_mcp.weapmap`). doc tokN == frame.split(",")[N+1] — `put()` adds the +1.
    # idx15 (tok14) is the FIRE INTERVAL — bench-proven 2026-08-26. tok15 is the WEAPON-SWAP DELAY (ms) —
    # bench-proven 2026-09-04 (850 → 1700 doubled the swap, 425 halved it, 100 ran at 100; linear, no floor).
    # The gun applies the LARGER of the two loaded slots' values whichever direction you swap, so a swap
    # perk must scale every slot (docs/bench-weap-tokens-2026-09-04.md).
    _T = {"proto": 3, "subtype": 4, "dmg": 5, "fire": 14, "swap": 15, "mag": 16, "reserve": 17, "reload": 18,
          "mode": 20, "burst": 23, "heat": 24, "snd_fire": 27, "snd_up": 28, "snd_down": 29,
          "rel1": 31, "rel2": 32, "rel3": 33, "noammo": 34, "clipstart": 39, "reserve_half": 40,
          "range": 41}
    # The ammo trio + its two mirrors. `resolve()` owns these — they carry the invariants — so an
    # `overrides` entry may not name one (see `_override_index`).
    _AMMO_TOKENS = frozenset({16, 17, 18, 39, 40})
    # Doc-token positions that protocol-classes.md gives a NAME to. `overrides` may only name one of
    # these — the hard rule is "never write a token we cannot name", and an override is still a write.
    _NAMED = frozenset({0, 2, 3, 4, 5, 6, 12, 13, 14, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
                        27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42})

    # Legacy 4-sample tails, kept only for rows with no `capture` block (synthetic catalogs in tests).
    SAMPLES = {"ar": WEAPON_TAILS.get("ar", WEAPON_TAILS["primary"]),
               "charge": WEAPON_TAILS.get("charge", WEAPON_TAILS["primary"])}

    def swap_ms(self, weapon_id: str, mods: dict | None = None) -> int:
        """tok15 as it will be written: the weapon's captured swap delay (850 on every stock gun, 100 on
        melee) scaled by a `switch_mult` perk. Bench 2026-09-04: the gun honours it linearly with no floor."""
        w = self._by_id[weapon_id]
        frame = (w.get("capture") or {}).get("frame")
        base = 850
        if (w.get("wire") or {}).get("swap_ms") is not None:          # a per-weapon draw time (sidearms); NB the gun enforces
            base = int(w["wire"]["swap_ms"])                          # the LARGER of slots 0/1, so it only bites when both are quick
        elif frame:
            tok = frame.split(",")
            if len(tok) > 16 and tok[16].strip().isdigit():
                base = int(tok[16])
        sm = float((mods or {}).get("switch_mult") or 1)
        return max(0, int(round(base * sm)))

    @staticmethod
    def _mods(mods: dict | None, mag: int, reserve: int, reload_ms: int) -> tuple[int, int, int]:
        """Apply passive-perk knobs (loadout.md §2): `ammo_mult` scales mag + reserve, `reload_mult`
        scales reload_ms. Integers, never below 1 round / 0 ms."""
        if not mods:
            return mag, reserve, reload_ms
        am = float(mods.get("ammo_mult") or 1)
        rm = float(mods.get("reload_mult") or 1)
        return (max(1, int(round(mag * am))), int(round(reserve * am)),
                max(0, int(round(reload_ms * rm))))

    def _ammo(self, weapon_id: str, mods: dict | None) -> tuple[int, int, int]:
        """(mag, reserve, reload_ms) as they will ACTUALLY be written for this weapon.

        The single answer `resolve()` and `spawn_ammo()` both take, so the frame the gun gets and the
        number the phone's HUD is told can never disagree — an `ammo_mult` perk used to produce an
        odd reserve that `resolve()` floored onto the `tok17 == 2 * tok40` invariant while
        `spawn_ammo()` reported the odd value, i.e. a gun one round short of what the HUD claimed.

        The rounding follows the INVARIANT, not the code path: only a captured frame carries the
        tok40 mirror, so a legacy-template row (synthetic test catalogs, no `capture`) writes its
        reserve straight to tok41 and must keep an odd one intact (review 2026-09-01).
        """
        w = self._row(weapon_id)
        mag, reserve, reload_ms = self._mods(mods, int(w["mag"]), int(w["reserve"]), int(w["reload_ms"]))
        if (w.get("capture") or {}).get("frame"):
            reserve = (reserve // 2) * 2
        return mag, reserve, reload_ms

    def resolve(self, weapon_id: str, slot: int, mods: dict | None = None) -> str:
        """`$WEAP` frame for a slot, built from the weapon's OWN captured Callsign frame.

        Every weapon carries `capture.frame` — the real frame Battle Company sent for that gun, pulled
        out of `protocol/captures/raw/` (see `weapons.json._note`). Emitting it verbatim inherits every
        native behaviour we cannot synthesise from a template: the 3-round burst (tok23), bolt/single
        shot, charge, overheat (tok24/35), the per-weapon reload chain, damage type (tok3), reload type
        (tok19) and muzzle flash (tok25/26). On top of that we write ONLY the balance tokens — damage,
        fire interval, and the ammo/reload trio — preserving the two invariants every captured frame
        obeys: `tok39 == tok16` (clip start == max clip) and `tok17 == 2 * tok40`.

        A weapon may additionally declare `overrides` — an explicit, per-token escape hatch for bench
        findings that contradict a stock value (see `_override_index`). Each entry must name a
        documented token and carry a `why`; nothing else in the frame can move.

        Rows without a `capture` block fall back to the old template path (synthetic test catalogs)."""
        w = self._row(weapon_id)
        cap = w.get("capture") or {}
        frame = cap.get("frame")
        if not frame:                                  # legacy template path
            base = w.get("base", "ar")
            p = f"$WEAP,{slot}{WEAPON_TAILS[base]}".split(",")
            _mag, _res, _rel = self._mods(mods, int(w["mag"]), int(w["reserve"]), int(w["reload_ms"]))
            p[_W_MAG] = str(_mag); p[_W_CLIPSTART] = str(_mag)
            p[_W_RESERVE] = str(_res); p[_W_RELOAD] = str(_rel)
            return ",".join(p)
        p = frame.split(",")
        p[1] = str(slot)
        T = self._T

        def put(key: str, val) -> None:
            p[T[key] + 1] = str(val)

        wire = w.get("wire") or {}
        if wire.get("dmg") is not None:
            put("dmg", int(wire["dmg"]))
        if wire.get("fire_ms") is not None:
            put("fire", int(wire["fire_ms"]))
        mag, reserve, reload_ms = self._ammo(weapon_id, mods)
        put("mag", mag); put("clipstart", mag)                 # tok39 == tok16
        put("reserve", reserve); put("reserve_half", reserve // 2)   # tok17 == 2 * tok40 (`_ammo` keeps it even)
        put("reload", reload_ms)
        put("swap", self.swap_ms(weapon_id, mods))
        for key, ov in (w.get("overrides") or {}).items():
            idx = self._override_index(weapon_id, key, ov)   # validates before we touch the frame
            p[idx + 1] = str(ov["value"])
        return ",".join(p)

    @staticmethod
    def _override_index(weapon_id: str, key: str, ov) -> int:
        """Validate one `overrides` entry and return its doc-token index.

        An override is the ONLY sanctioned way to deviate from a captured frame outside the balance
        tokens, so it is deliberately awkward: it must name a documented token and it must say why.
        Bench findings that contradict a stock sound (a reload part that chirps, a fire sound that is
        actually a music sting) are what this is for — not a general-purpose token writer."""
        if not isinstance(ov, dict) or not str(ov.get("value", "")).strip() or not str(ov.get("why", "")).strip():
            raise ValueError(f"{weapon_id}: override {key!r} needs both a 'value' and a 'why'")
        try:
            idx = int(str(key).lstrip("tT"))
        except ValueError:
            raise ValueError(f"{weapon_id}: override key {key!r} must look like 't33'") from None
        if idx not in WeaponCatalog._NAMED:
            raise ValueError(f"{weapon_id}: override tok{idx} is not a token we have a name for")
        # An override runs LAST, after the ammo trio is written, so an ammo token here would land
        # outside `resolve()`'s two invariants — tok39 == tok16 and tok17 == 2 * tok40 — and ship a
        # frame no captured Callsign frame has ever looked like. Ammo is a catalog field; edit that.
        if idx in WeaponCatalog._AMMO_TOKENS:
            raise ValueError(f"{weapon_id}: override tok{idx} is an AMMO token — set mag/reserve/reload_ms "
                             f"on the weapon instead, or the tok39==tok16 / tok17==2*tok40 invariants break")
        return idx

    def damage(self, weapon_id: str) -> int:
        """The weapon's `$WEAP` t5 — the MAGNITUDE it emits, which is NOT always what lands.

        ⚠ The victim's `$SIR` row for this weapon's `<t3,t4>` decides what the magnitude does: a
        multiplier row lands floor(t5 x 1.25) (fn 36) or t5 x 2 (fn 37), a status row lands nothing, and
        a missing row drops the hit entirely (bench 2026-08-26, multipliers confirmed 2026-09-02;
        docs/weapon-design.md §6.2). `validate()` warns about all three.
        For plain damage rows — the majority — this is the applied damage and `$HIR` token 5 echoes it.

        Rebalanced weapons carry it in `wire.dmg`; untuned ones read it back out of their captured
        frame rather than being treated as unknown."""
        w = self._row(weapon_id)
        dmg = (w.get("wire") or {}).get("dmg")
        if dmg:
            return int(dmg)
        try:
            return int(self.resolve(weapon_id, 0).split(",")[self._T["dmg"] + 1])
        except (IndexError, ValueError):
            return 0

    def hits_to_kill(self, weapon_id: str, pool: int) -> int:
        """Hits to drop a `pool`-point target (hp + armor), computed on RAW t5.

        Armor absorbs at face value and spills into HP (bench §7r). ⚠ Two things this does not model
        (docs/weapon-design.md §6). First, a `$SIR` multiplier row: **fn 36 lands floor(magnitude x
        1.25) and fn 37 lands magnitude x 2 — CONFIRMED 2026-09-02** (16 trials, magnitudes 20/40/9/7,
        8 row-tail shapes, fn 1 control in every trial; the x1.25 truncates, so 7 lands as 8, not 9).
        Because this function computes on raw t5, it **OVER-ESTIMATES** htk for the five weapons on
        fn 36/37 — that behaviour is deliberate and unchanged here; `validate()` warns on those rows.
        Second, the SHIELD pool, which sits above armor and is granted only by an IR function-11 event.
        0 = damage unknown, caller skips."""
        dmg = self.damage(weapon_id)
        return math.ceil(pool / dmg) if dmg > 0 and pool > 0 else 0

    # ---- derived numbers -------------------------------------------------
    # Everything below is computed from the SHIPPED frame, never read out of weapons.json. The five
    # hand-set stat fields (`dmg`, `rof`, `rng`, `htk`, `ttk_ms`) are documentation of these, and
    # `test_weapon_derivations.py` fails if any of them drifts from what the wire actually says.
    # Field 2026-08-30 found the AR shipping `rof: 53` against a derived 54 for exactly that reason.
    _BURST_MODE = 9                          # $WEAP t20 fireMode: 3-round burst (t23 = the gap after it)
    _CHARGE_MODES = frozenset({2, 3, 14})    # 2 auto-fires when charged, 3 must be held, 14 charge+heat

    def _frame_int(self, weapon_id: str, key: str, default: int = 0) -> int:
        """One named doc token of the shipped frame as an int (wire overrides already applied)."""
        try:
            return int(self.resolve(weapon_id, 0).split(",")[self._T[key] + 1] or default)
        except (IndexError, ValueError, KeyError):
            return default

    def fire_ms(self, weapon_id: str) -> int:
        """The `$WEAP` t14 fire interval as SHIPPED — a `wire.fire_ms` override wins, as on the AR."""
        return self._frame_int(weapon_id, "fire")

    def cycle_ms(self, weapon_id: str) -> float:
        """Mean ms between landed hits: t14, except on a burst weapon.

        A 3-round burst (t20 == 9) spaces two rounds at t14 and then waits t23 before the next burst,
        so what a player sustains is (2*t14 + t23)/3 — the "cycle 75 +275" column of
        docs/weapon-design.md §2.2, and the number `ttk_ms` is built from."""
        fire = self.fire_ms(weapon_id)
        if self._frame_int(weapon_id, "mode") == self._BURST_MODE:
            gap = self._frame_int(weapon_id, "burst")
            if gap:
                return (2 * fire + gap) / 3
        return float(fire)

    def rate_of_fire(self, weapon_id: str) -> int:
        """weapons.json `stats.rof` — the 0-100 UI bar, `round(7500 / t14)` (weapons.json `_note`).

        Deliberately the RAW t14, not `cycle_ms`: the bar is "how fast does this thing fire", and a
        burst weapon does fire at t14 — it just cannot keep it up."""
        fire = self.fire_ms(weapon_id)
        return round(7500 / fire) if fire else 0

    def damage_bar(self, weapon_id: str, pool: int = DEFAULT_POOL) -> int:
        """weapons.json `stats.dmg` — the SHARE of `pool` one hit removes, 0-100 (weapons.json `_note`)."""
        return round(100 * self.damage(weapon_id) / pool) if pool > 0 else 0

    def time_to_kill(self, weapon_id: str, pool: int) -> int:
        """ms from the first shot to the killing hit at `pool`; 0 when the weapon one-shots.

        (htk - 1) cycles, because the first hit costs no wait — EXCEPT on a charge weapon, where the
        first shot has to be charged too, so it is htk cycles. That is the whole reason the Rail Gun
        and the Laser Cannon publish a TTK (1.20 s / 1.50 s) while the Rocket Launcher, equally a
        one-shot kill, publishes 0.00."""
        htk = self.hits_to_kill(weapon_id, pool)
        if not htk:
            return 0
        charged = self._frame_int(weapon_id, "mode") in self._CHARGE_MODES
        return int(round(self.cycle_ms(weapon_id) * (htk if charged else htk - 1)))

    def spawn_ammo(self, weapon_id: str, mods: dict | None = None) -> tuple[int, int]:
        """What the phone's HUD is told the player is carrying — the SAME numbers `resolve()` writes."""
        mag, reserve, _ = self._ammo(weapon_id, mods)
        return mag, reserve


class Compiler:
    """Implements interfaces.Compiler."""

    def __init__(self, catalog: WeaponCatalog | None = None, perks: PerkCatalog | None = None) -> None:
        self.catalog = catalog or WeaponCatalog()
        self.perks = perks or PerkCatalog()

    def _perk_effects(self, player: Player | None) -> dict:
        """The passive knobs of the player's slot-2 perk (loadout.md §1.2/§2); {} when none."""
        pid = ((player or {}).get("loadout") or {}).get("perk")
        return self.perks.effects(pid) if pid else {}

    # -- helpers -----------------------------------------------------------
    def _to_gc(self, config: GameConfig, player: Player | None = None) -> _GC:
        """Map the contracts §3 GameConfig (TypedDict) onto the gameconfig.py dataclass — only the
        fields whose frames we reuse (_gset/_pset/_bmap/_led_frames). Weapons + ammo come from the
        catalog, not the dataclass, so primary/secondary are left at their defaults."""
        led = config.get("led") or {}
        ov = ((player or {}).get("loadout", {}) or {}).get("overrides") or {}   # per-player HP/armor (modes §1.1)
        fx = self._perk_effects(player)
        return _GC(
            mode=config["mode"],
            game_time_s=config["time_limit_s"] or 0,
            respawn_s=config["respawn"]["delay_s"],
            respawns=0 if config["respawn"]["type"] == "none" else None,
            frag_limit=config["scoring"].get("frag_limit") or 0,
            volume=play_volume(config["environment"]),
            outdoor=config["environment"] == "outdoor",
            # blackout LED-off on night OR an explicit led.mode=="off" (modes §6)
            leds=(led.get("mode", "team") != "off") and not config.get("night", False),
            friendly_fire=(config["mode"] == "ffa"),  # FFA needs the gun to register same-$TID hits
            hp=int(ov.get("max_hp", config["health"]["max_hp"])),
            # body_armor perk: +N on $PSET armor (loadout.md §2) — capped at the wire's 255
            # NOTE: 255 is OUR POLICY CEILING, not a device limit. Bench 2026-08-27: $PSET
            # pools are not 8-bit -- armor and HP store and decrement exactly to at least 1000,
            # clamping at zero with no wrap (shield was never measured that far). Keep the cap,
            # but do not "fix" it believing the hardware requires it.
            armor=min(255, int(ov.get("max_armor", config["health"]["max_armor"])) + int(fx.get("max_armor_add") or 0)),
            alt_reload=bool(fx.get("alt_reload")),          # easy_reload perk: $BMAP,1,97
        )

    @staticmethod
    def _tid(player: Player, teams: list[Team]) -> int:
        by_id = {t["team_id"]: t for t in teams}
        tm = by_id.get(player.get("team_id") or "")
        return int(tm["tid"]) if tm else 0

    def _weapon_ids(self, player: Player) -> tuple[str, str | None]:
        """(primary, secondary-or-None). A10: no silent default secondary — an empty slot 1 is what the host
        asked for (ALT then falls back to reload; hardware-verified, loadout.md §2)."""
        w = player.get("loadout", {}).get("weapons", [])
        primary = w[0]["weapon_id"] if len(w) > 0 else "assault_rifle"
        secondary = w[1]["weapon_id"] if len(w) > 1 else None
        return primary, secondary

    # -- Compiler Protocol -------------------------------------------------
    def compile(self, config: GameConfig, player: Player, teams: list[Team]) -> FrameBundle:
        gc = self._to_gc(config, player)
        pnum = int(player["player_num"])
        if not 1 <= pnum <= MAX_PLAYERS:
            raise ValueError(f"player_num {pnum} out of range 1..{MAX_PLAYERS} (0 reserved, A5.1)")
        tid = self._tid(player, teams)
        w0, w1 = self._weapon_ids(player)
        fx = self._perk_effects(player)                    # ammo/reload knobs act on the PRIMARY only …
        mods = {k: fx[k] for k in ("ammo_mult", "reload_mult", "switch_mult") if fx.get(k)}
        swap_mods = {k: mods[k] for k in ("switch_mult",) if k in mods}   # … the swap delay must scale on EVERY slot (the gun takes the larger)

        # head — config, per player, SILENT (no $SPAWN, no $PLAY,VA81); ends with $TID (§1.1)
        head = [f"$VOL,{play_volume(config.get('environment'))},0,*", "$CLEAR,*", "$START,*",
                gc._gset(), gc._pset(pnum, player.get("voice")),   # the voice pack is per-PLAYER (§PSET)
                self.catalog.resolve(w0, 0, mods)]
        if w1:
            head.append(self.catalog.resolve(w1, 1, swap_mods))   # slot 1 only when a secondary exists (A10)
        head.append(self.catalog.resolve("melee", 4, swap_mods))
        bmap = list(gc._bmap())
        if not w1 and not gc.alt_reload:
            # Empty slot 2 (A10 §2): the stock ALT row cycles to slot 1, which we no longer load — an UNVERIFIED
            # button-map state on real guns (brx-opus review 2026-08-27). Cycle only to slot 0 instead, so ALT is a
            # no-op by construction ("alt-fire does nothing"). easy_reload keeps ALT→97. Bench item: bench-tomorrow.md.
            bmap = [("$BMAP,1,100,0,0,99,99,*" if row.startswith("$BMAP,1,") else row) for row in bmap]
        # Headset colour. We never sent ANY lit-state $HLED, which is why our headsets sat dark for a
        # whole match (field 2026-08-30) — that part is solid, and this frame is the fix.
        #
        # ⚠ WHAT THE CAPTURES ACTUALLY SHOW, corrected 2026-09-01 after review found the original
        # comment here overstated them. Read this before trusting the value:
        #   · Callsign sends it in the LOBBY, not in the arm sequence. In every capture it lands
        #     seconds BEFORE $CLEAR/$START (game-start.txt: $HLED @21.429s, $CLEAR @25.012s;
        #     two-tagger-combat: @211.7s vs @274.5s). We send it mid-head, after $BMAP. Position is
        #     therefore OURS, not Callsign's.
        #   · It is always PAIRED with a $GLED carrying the identical token 1 ~200 ms earlier. We
        #     send it alone: `_led_frames()` returns [] when LEDs are on.
        #   · Token 1 is only ever 0, 1 or 7 across every capture on disk (7 = the hurt alert), and
        #     NO capture contains a $TID at all — so nothing observed correlates this token with a
        #     team id. "tid is the colour" is an inference from $GLED's palette, not a measurement.
        #     A tid of 2..63 has never been sent to a headset by anything.
        # Keeping the behaviour deliberately: it is the only way to test it, and it cannot be worse
        # than the dark headsets we shipped. But it is UNVERIFIED — see FOLLOWUPS F10, which is an
        # eyeball test, and do not cite this frame as confirmed until that is done.
        hled = _headset_colour(tid, gc.leds)
        head += list(_SIR_TABLE) + bmap + gc._led_frames() + hled + [f"$TID,{tid},*"]

        pmag, pres = self.catalog.spawn_ammo(w0, mods)
        ammo = [f"$AMMO,0,{pmag},{pres},1,*"]
        if w1:
            smag, sres = self.catalog.spawn_ammo(w1)
            ammo.append(f"$AMMO,1,{smag},{sres},1,*")

        # spawn = $PLAYX,0 -> $SPAWN -> $AMMOs -> $BMAP,0,0 (the T-0 tail; M-START wraps VA81 + $SFLASH)
        # ... + the headset team colour LAST. Bench 2026-09-03 (hled_spawned.py): `$SPAWN` CLEARS
        # the headset, which is exactly why the lobby frame above showed up "on death, not pre-game"
        # in the field (G4/V3) -- it was gone the moment the game started. A static $HLED painted
        # after spawn holds solid, and one sent 1 s after spawn lit; it goes at the end of the tail
        # so the $AMMO writes give the headset relay a beat first. Token 5 = 10 is already maximum
        # brightness (1 dim, 2/10/255 identical), measured the same day.
        spawn = ["$PLAYX,0,*", "$SPAWN,,*"] + ammo + ["$BMAP,0,0,,,,,*"] + hled
        # revive = $SPAWN + loadout $AMMOs (NO $HLOOP, NO $BMAP — §1.1 replaces RESPAWN_SEQUENCE)
        revive = ["$SPAWN,,*"] + ammo + hled

        bundle: FrameBundle = {
            "config_id": config["config_id"],
            "player_id": player["player_id"],
            "head": head,
            "spawn": spawn,
            "revive": revive,
            "end": list(END_SEQUENCE),
            "panic": list(PANIC_SEQUENCE),
            "cues": self.cues(player.get("voice", "male")),
            # the swap delay the gun will actually enforce between slots 0 and 1: the larger tok15 of the two
            # (bench 2026-09-04). The HUD's SWITCHING takeover runs for exactly this long.
            "swap_ms": max([int(f.split(",")[16]) for f in head if f.startswith("$WEAP,0,") or f.startswith("$WEAP,1,")] or [850]),
        }
        # Every registered hit wipes the headset (native flash, then dark; bench 2026-09-03). The
        # node re-sends this after each hit so the team colour is back for the rest of the life.
        # Empty when LEDs are off or the tid has no known headset colour -- the node writes nothing.
        bundle["cues"]["team_led"] = hled[0] if hled else ""

        # A11: the PRESENTATION profile -- per-event sounds + lights, preset or custom (presentation.py).
        # Cues it names override the fixed table above; `announcer: false` mutes the voice groups but
        # keeps the $SFLASH; `gun_flash: false` empties the LED table; `headset_team: false` drops the
        # team-colour repaint frames added above.
        prof = _pres.resolve(config)
        frames = _pres.cue_frames(prof, kill_line(player.get("voice", "male")))
        low = frames.pop("low_health", None)
        bundle["cues"].update(frames)
        # low_health is the node's existing `hurt` cue. Callsign's byte-identical frame
        # ($PLAY,VA8B,3,6) stays unless the profile chose a DIFFERENT sound or muted it.
        if low is not None and prof["events"]["low_health"].get("sound") != "VA8B":
            bundle["cues"]["hurt"] = low
        bundle["leds"] = _pres.led_table(prof, tid, gc.is_night_mode(), gc.leds)
        if not prof.get("headset_team", True):
            bundle["cues"]["team_led"] = ""
            bundle["spawn"] = [f for f in bundle["spawn"] if not f.startswith("$HLED,")]
            bundle["revive"] = [f for f in bundle["revive"] if not f.startswith("$HLED,")]
        bundle["presentation"] = _pres.summary(config.get("presentation") or _pres.default_for(config.get("mode")))
        if config["mode"] == "infection":
            # move THIS gun to each other team's $TID on death, then re-arm (node emits team_change)
            flip: dict[str, list[str]] = {}
            for t in teams:
                if int(t["tid"]) != tid:
                    flip[str(t["tid"])] = [f"$TID,{t['tid']},*"] + revive
            bundle["team_flip"] = flip
        return bundle

    def tutorial_frames(self, weapon: Weapon, environment: str) -> list[str]:
        """§4 private try-out: one weapon, identity 0 (uncredited), audible (VOL_TRYOUT). Needs $START + a $TID to
        actually fire (bench 2026-08-25); identity 0 keeps any stray hit off the scoreboard."""
        outdoor = 1 if environment == "outdoor" else 0
        wid = weapon["weapon_id"]
        mag, reserve = self.catalog.spawn_ammo(wid)
        # $PSET,0 = "no identity" (A5.1) so a stray try-out hit reports shooter 0, never credited.
        pset = "$PSET,0,0,45,70,70,50,,H44,JAD,V33,V3I,V3C,V3G,V3E,V37,H06,H55,H13,H21,H02,U15,W71,A10,*"
        return [
            f"$VOL,{VOL_TRYOUT},0,*", "$CLEAR,*", "$START,*",   # $START IS required — bench 2026-08-25: without it the gun
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

    def voice_options(self) -> list[dict]:
        """The selectable personas (`Session._voice_ids` picks this up to validate a PATCH).

        `$PSET`'s trailing tokens are a positional voice pack and the sound bank carries one for
        every character family; the roster accepted only male/female, so the other ~13 were
        unreachable. Only HEAVY is confirmed by ear — see gameconfig.VOICE_PACKS.
        """
        from ..gameconfig import VOICE_PACKS
        return [{"id": v, "name": v.replace("_", " ").upper(), "family": fam,
                 "kill_line": kill_line(v), "verified": v == "heavy"}
                for v, fam in VOICE_PACKS.items()]

    def cues(self, voice: str) -> dict[str, str]:
        """A6: pre-composed `$PLAY` frames (node writes verbatim; only $SFLASH/$PLAYX,0 are its own
        templates). Two-slot `$PLAY,<fx>,4,6,<voice>,,,,*`: token1 = SFX, token4 = voice line."""
        kill = kill_line(voice)
        return {
            "countdown": "$PLAY,VA81,4,6,,,,,*",         # confirmed 3-2-1-GO (VA81, slot 1)
            "kill":      f"$PLAY,,4,6,{kill},,,,*",       # confirmed kill line (slot 4, voice-family)
            "game_over": "$PLAY,VA33,4,6,,,,,*",         # CONFIRMED by ear 2026-08-25: "game over" (neutral — a node ending on its own timer does not know the winner)
            "victory":   "$PLAY,VSF,4,6,JAY,,,,*",        # CONFIRMED by ear 2026-08-25: victory sting + "victory" (winners only, MC-sent at recap when in coverage)
            # Victim-side low-health alert, byte-identical to Callsign. Fires once per life shortly
            # after ARMOUR reaches 0 and HP starts dropping — 2 deaths, 2 alerts, both at $HP,34,0,0
            # in 2026-08-23-two-tagger-combat (@340.5s, @361.5s). This, not a per-hit flash, is almost
            # certainly the "headset blinks green" Tony remembered (he flagged his own uncertainty).
            "hurt":      "$PLAY,VA8B,3,6,,,,,*",
            "hurt_led":  f"$HLED,7,4,90,90,{HEADSET_ALERT_BRIGHTNESS},15,*",
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

        # unknown weapon / perk ids; a perk never rides with a secondary weapon (loadout.md §2)
        for p in roster:
            lo = p.get("loadout", {}) or {}
            for w in lo.get("weapons", []):
                if w["weapon_id"] not in self.catalog._by_id:
                    errors.append(f"unknown weapon_id {w['weapon_id']!r}")
            perk = lo.get("perk")
            if perk and not self.perks.has(perk):
                errors.append(f"unknown perk_id {perk!r}")
            if perk and len(lo.get("weapons", [])) > 1:
                errors.append(f"{p.get('display', p.get('player_id'))}: a perk and a secondary weapon cannot both fill slot 2")

        # a weapon must be able to kill on one magazine: mag >= ceil(pool / dmg).
        # `docs/weapon-design.md` §2.1 — the rail gun and energy launcher shipped at mag 1 needing 2 hits,
        # so a kill cost charge + shot + full reload + charge again. Pool is per-player: loadout overrides
        # win over config health, exactly as `_gset` reads them.
        health = config.get("health") or {}
        seen: set[tuple[str, int, int]] = set()
        for p in roster:
            ov = ((p.get("loadout") or {}).get("overrides")) or {}
            hp, armor = ov.get("max_hp", health.get("max_hp")), ov.get("max_armor", health.get("max_armor"))
            if hp is None or armor is None:
                continue                                     # no health model to check against
            # THE SAME arithmetic as `_to_gc()` and `Session.health_pool()` — the perk's armour and
            # the 255 ceiling included. This used to be a third, simpler version, so it graded a
            # `body_armor` player at 115 while the gun was armed at 165 and the mag>=htk gate could
            # pass a weapon that cannot actually kill on one magazine (review 2026-09-01).
            fx = self._perk_effects(p)
            pool = int(hp) + min(255, int(armor) + int(fx.get("max_armor_add") or 0))
            mods = {k: fx[k] for k in ("ammo_mult", "reload_mult", "switch_mult") if fx.get(k)}
            for w in (p.get("loadout", {}) or {}).get("weapons", []):
                wid = w.get("weapon_id")
                if wid not in self.catalog._by_id:
                    continue                                 # unknown ids already reported above
                # ...and the MODDED magazine, which is what the gun is actually given
                mag = self.catalog._ammo(wid, mods)[0]
                if (wid, pool, mag) in seen:
                    continue
                seen.add((wid, pool, mag))
                htk = self.catalog.hits_to_kill(wid, pool)
                if htk and mag < htk:
                    errors.append(f"{wid} cannot kill on one magazine: mag {mag} < {htk} hits at "
                                  f"{self.catalog.damage(wid)} dmg vs {pool} pool "
                                  f"(docs/weapon-design.md §2.1)")

        # Does each loadout weapon's <t3,t4> key a $SIR row that actually DEALS DAMAGE?
        # The mag>=htk invariant above computes on raw t5 and cannot see this: it passed an Energy
        # Launcher (mag 2, htk 1) that lands on $SIR,9,3,,24 — a status row — and deals ZERO damage
        # in every game we ship. Validating the weapon alone is not enough; the effect lives in the
        # (weapon, table) pair. Bench-confirmed 2026-08-26, see docs/weapon-design.md §6.2.
        #
        # ⚠ WARNING-ONLY BY DESIGN, TEMPORARILY. Promote the first two cases to `errors` in the SAME
        # commit that fixes the Energy Launcher (flatten _SIR_TABLE to fn 1, or move the weapon off
        # <9,3>) — at that point a clean pass is achievable. It must not sit here as a permanent
        # warning; the test name records the intent.
        sir = _sir_index(_SIR_TABLE)
        T = self.catalog._T
        # KeyError here is a CODE bug, not bad data — raise loudly rather than letting every
        # weapon `continue` and silently turn the whole guard into a no-op.
        _pi, _si = T["proto"] + 1, T["subtype"] + 1
        flagged: set[str] = set()
        for p in roster:
            for w in (p.get("loadout", {}) or {}).get("weapons", []):
                wid = w.get("weapon_id")
                if wid not in self.catalog._by_id or wid in flagged:
                    continue
                try:
                    frame = self.catalog.resolve(wid, 0).split(",")
                    key = (frame[_pi] or "0", frame[_si] or "0")
                except (IndexError, ValueError):
                    continue   # a malformed catalog row is another check's problem, not a crash here
                fn = sir.get(key)
                if fn is None:
                    flagged.add(wid)
                    warnings.append(f"{wid} keys $SIR {key[0]},{key[1]} — NO ROW in the pushed table, so "
                                    f"every hit is silently dropped (weapon-design.md §6.2)")
                elif fn in _SIR_NO_POOL:
                    flagged.add(wid)
                    warnings.append(f"{wid} keys $SIR {key[0]},{key[1]} → function {fn}, which registers a "
                                    f"hit but moves no pool: the weapon DEALS NO DAMAGE (weapon-design.md §6.2)")
                elif fn in _SIR_GRANT:
                    flagged.add(wid)
                    dual = " (16/17/20/21 are DUAL-POLARITY: they still damage enemies, 17/21 armor-piercing)" \
                           if fn in (16, 17, 20, 21) else ""
                    warnings.append(f"{wid} keys $SIR {key[0]},{key[1]} → function {fn}, a GRANT "
                                    f"(heal/armor/shield): it HEALS an ally it hits{dual} "
                                    f"(weapon-design.md §6.2)")
                elif fn in _SIR_MULTIPLIER:
                    flagged.add(wid)
                    mult = _SIR_MULTIPLIER[fn]
                    warnings.append(f"{wid} keys $SIR {key[0]},{key[1]} → function {fn}, a CONFIRMED "
                                    f"multiplier row: it lands floor({mult}x its $WEAP t5) "
                                    f"(bench 2026-09-02). The published htk/ttk_ms are computed on raw "
                                    f"t5, so they OVER-ESTIMATE hits-to-kill for this weapon "
                                    f"(weapon-design.md §6.2)")
                elif fn in _SIR_ARMOR_PIERCING:
                    flagged.add(wid)
                    warnings.append(f"{wid} keys $SIR {key[0]},{key[1]} → function {fn}, ARMOR-PIERCING: it "
                                    f"bypasses armor and shields, so htk is ceil(hp/dmg), not ceil(pool/dmg) "
                                    f"(weapon-design.md §6.2)")
                elif fn not in _SIR_PLAIN_DAMAGE:
                    flagged.add(wid)
                    warnings.append(f"{wid} keys $SIR {key[0]},{key[1]} → function {fn}, which is NOT in the "
                                    f"bench-confirmed plain-damage set {sorted(_SIR_PLAIN_DAMAGE)}: its effect "
                                    f"on the victim is uncharacterised (weapon-design.md §6.2)")

        # frag-limit on a non-covered venue is a coverage-zone early end, not a guaranteed win (C1/M7)
        if (config.get("scoring", {}).get("frag_limit") or 0) > 0 and not covered:
            warnings.append("frag_limit on a non-full-coverage venue is an in-coverage early end only; "
                            "the guaranteed end is time_limit_s (A4.8) — winner is provisional until recap")

        return {"ok": not errors, "errors": errors, "warnings": warnings}

    def weapon_catalog(self) -> list[Weapon]:
        return self.catalog.all()

    def perk_catalog(self) -> list[dict]:
        """Visible perks (loadout.md §1.2) — `PerkView` rows."""
        return self.perks.all()

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
