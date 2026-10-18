#!/usr/bin/env python3
"""Balance review: is a proposed weapon, weapon change or perk change good for the Open BRX sandbox?

    python3 mcp/tools/balance_review.py --candidate cand.json --out verdict.json [--report r.md]
    python3 mcp/tools/balance_review.py --record-from verdict.json --call "Tony: ship it"

The skill `.claude/skills/balance-review/SKILL.md` is the loop around this tool. The decision log it
writes to is `docs/balance-decisions.md`.

WHAT IT DOES
------------
It builds two worlds from `weapons.json` and `perks.json`: the BASELINE (the shipped catalogue plus any
`with` context changes in the candidate file) and the CANDIDATE (the baseline plus the candidate). It
runs the same versioned scenario list in both, and prints a verdict with six named tests:

  value_addition         the candidate is near the top in at least one scenario, or it brings a trigger
                         mechanic the arsenal lacks (docs/weapon-design.md, trigger diversity).
  no_domination          no kit is near the top in every scenario (Tony's acceptance rule, criterion a).
  viable                 the candidate's field ratio clears `VIABLE_FIELD_FLOOR`, and it beats at least
                         one kit in at least one 1v1 band. A sidearm instead needs the R10a finish bar.
  balance_kept           no Balance rule (R1-R12, R10a, both presets) flips from pass to fail, and no
                         other kit loses its last near-top cell.
  op_rule                no non-pickup weapon one-shots the lowest pool a player can field on a gated
                         preset (rule 7: one-shot weapons are a pickup tier).
  marksman_rush_counter  marksman candidates only: strong against players who do not rush, beaten by
                         players who do (Tony, 2026-10-17).

WHY A SIBLING OF balance_sim.py
-------------------------------
`balance_sim.py` holds the shipped engines and the CI-gated rules R1-R12; its tests pin it. This tool is a
layer above it: kits (two guns and a perk), a different fight engine (`Fighter`, which carries a kit,
a swap and a peek window), the scenario list and the verdict. It imports `balance_sim` for everything
it shares (the team `Match`, the rule engines, `catalogue_with`, `semi_interval`, `BAND_FIT`, the
recoil model), so a change to a shared engine moves both.

DETERMINISM
-----------
Every cell seeds its own `random.Random` from `SEED` and the cell key (`balance_sim.cell_rng`). Rep
counts are fixed (`REPS`). `SCENARIO_VERSION` names the scenario list: change it whenever a scenario,
a constant or a rep count changes, so a recorded verdict says which list judged it. `--jobs` does not
change any number.

INVENTED ASSUMPTIONS
--------------------
Every number below that is not read from the catalogue is invented, named, and printed in every
report (`assumptions()`). The ones that move the answer most: the pull model (`PULL_MS`, the bolt's
lever and press gaps), the reaction delays, the range bands and the closing speed, and the peek
exposure windows.

NOT MODELLED (named, not silently dropped)
------------------------------------------
- A weapon with a DoT block (the Toxin Rifle): the kit engine has no tick. It is left out of the
  matrix, and a DoT candidate is refused.
- Overheat, stance, flinch, the Armour Piercing perk, the node-local perks.
- Shield regeneration (no fight here gives the 6.5 s quiet it needs).
- Perk exemption is read from the row: `reload_type: "bolt"` ignores the ammo and reload perks, as
  compile.py `_ammo` does after the Sniper bolt batch (brx2/sniper-bolt). On a main without that batch
  the compiled bolt still scales with the perks.
"""
from __future__ import annotations

import argparse
import copy
import datetime
import hashlib
import json
import math
import os
import subprocess
import sys
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass, replace
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
REPO = TOOLS.parents[1]
sys.path.insert(0, str(TOOLS))
sys.path.insert(0, str(TOOLS.parent))
import balance_sim as B  # noqa: E402
from brx_mcp.mc.compile import CHARGE_TAP_CADENCE_MS, HEALTH_PRESETS, PULL_SIGMA, WeaponCatalog  # noqa: E402
from brx_mcp.mc.perks import PerkCatalog  # noqa: E402
from brx_mcp.mc import compile as _compile_mod  # noqa: E402

# --------------------------------------------------------------------------- #
# The versioned scenario list and every invented constant
# --------------------------------------------------------------------------- #

SCENARIO_VERSION = 1
SEED = 7
# Rep counts per cell kind. Tests scale these down with `reps_scale`; a scaled verdict says so and is
# never recorded.
REPS = {"duel": 3000, "perk": 2000, "field": 600, "ambush": 3000, "peek": 3000, "rush": 3000,
        "ttk": 2000, "finish": 3000, "rule": 10000}
MIN_REPS = 4

AIM = 0.9                     # aim factor: hit chance = recoil accuracy x AIM x BAND_FIT, capped at 1
PULL_MS = B.DEFAULT_PULL_MS   # mean trigger-pull gap (lognormal, PULL_SIGMA): single shots, ALT, the bolt lever
REACTION_MEAN_MS = 250.0      # 1v1: each side opens after a normal reaction delay
REACTION_SD_MS = 80.0
RETARGET_MS = 400.0           # after a kill, a trigger release before the next target
BURST_LEN = (3, 5)            # a controlled burst on an automatic weapon: 3 to 5 rounds ...
BURST_PAUSE_MS = (150.0, 300.0)   # ... then a 150 to 300 ms pause
FIGHT_CAP_MS = 10_000.0       # a 1v1 still open at 10 s is decided on the remaining pool
LONG_CONTACT_AIM = 0.5        # the "long contact" column: a 20 s fight at a poor aim, mid range
LONG_CONTACT_CAP_MS = 20_000.0
PEEK_WINDOW_MS = 750.0        # a peeking marksman is exposed only within 375 ms of its own shots
PEEK_REACT_MS = 1000.0        # a peeked player reacts 1 s after the first landed hit ...
PEEK_P_ESCAPE = 0.3           # ... and breaks line of sight with this chance, else fights back
AMBUSH_REACT_MS = 1000.0      # 1v2 ambush: both enemies start firing 1 s after the first landed hit
CLOSE_EDGE_M = 10.0           # range bands for the rush model: close under 10 m, mid under 30 m
MID_EDGE_M = 30.0
RUSH_SPEED_MS = 5.0           # a rusher closes at 5 m/s ...
RUSH_MOVE_ACC = 0.5           # ... hits at half its normal chance while moving, full chance once close
RUSH_START_M = 20.0           # the rush starts 20 m away
RUSH_CAP_MS = 15_000.0
FIELD_NS = (2, 4, 6, 8)       # team sizes for the field ratio (geometric mean over them)
FIELD_VENUE = "outdoor"
SECONDARY = "deagle"          # every plain kit carries this secondary (plain kits never draw it)
FULL_AUTO = frozenset({"smg", "suppressor", "energy_rifle"})   # automatics held down; the rest burst
ANCHOR = "assault_rifle"      # the plain kit every perk, field and ambush number is measured against
# Mixed kits that open with the first gun's big round and finish with the second (Tony 2026-10-17).
COMBO_KITS = (("CR+Sniper+BA", "charge_rifle", "sniper_rifle", "body_armor"),
              ("CR+Sniper+QS", "charge_rifle", "sniper_rifle", "quick_switch"))

COLUMNS = ("1v1 close", "1v1 mid", "1v1 long", "long contact", "peek mid", "field", "ambush", "shields")
# Near-top margin: a kit within this of the column's best is "near the top". The duel columns are win
# rates (a 5 point margin is about two standard errors of a 3000-rep cell averaged over ten opponents);
# the field ratio and the ambush score are noisier and wider, so 0.10.
NEAR_TOP_MARGIN = {"1v1 close": 0.05, "1v1 mid": 0.05, "1v1 long": 0.05, "long contact": 0.05,
                   "peek mid": 0.05, "field": 0.10, "ambush": 0.10, "shields": 0.05}
# viable: the weakest shipped primaries sit at about 0.6 in the field (2026-10-18, scenario version 1:
# Shotgun 0.61 to 0.63, Suppressor 0.62 to 0.70). The floor is one field margin (0.10) under the weakest,
# rounded down, so every shipped primary clears it and a weapon that trades clearly worse than the
# arsenal's weakest choice does not.
VIABLE_FIELD_FLOOR = 0.50
MARKSMAN_STRONG_BAR = 0.50    # peek-kill rate against a player who does not rush
# The strong side also needs the marksman's kit near the top in this column. Pending brx1: it may move to
# "peek mid" (then peek-kill plus near the top at peek). A one-line switch; do not change it without Tony.
MARKSMAN_STRONG_COLUMN = "1v1 long"
MARKSMAN_RUSH_BAR = 0.50      # rush success against the same marksman from RUSH_START_M
SIDEARM_VALUE_MARGIN = 0.10   # a sidearm adds value when its finish time is within 10% of the best
R10_PRIMARY_BAR = 0.65        # a new sidearm: each of B.R10_PRIMARIES still beats it on Standard, as R10b (Shields: SHIELDS_BAR)
RULE_BAR_STANDARD = 0.65      # mirrors mcp/tests/test_balance_sim.py (RANGE_BAR_OVERRIDES)
RULE_BAR_OVERRIDES = {"R7": 0.55}
OP_GATED_PRESETS = ("standard", "shields")   # Hardcore is reported, never gated (one-shots are its point)
MODELLED_PERK_KEYS = frozenset({"max_armor_add", "ammo_mult", "ammo_mult_pistol", "reload_mult", "switch_mult"})


def assumptions() -> dict:
    """Every invented number this verdict rests on, printed in every report."""
    return {
        "scenario_version": SCENARIO_VERSION, "seed": SEED, "reps": dict(REPS),
        "aim": AIM, "pull_ms_mean": PULL_MS, "pull_sigma": PULL_SIGMA,
        "bolt": "a 1-round single-shot magazine: lever = one pull gap, then reload_ms, then one pull gap",
        "reaction_ms": [REACTION_MEAN_MS, REACTION_SD_MS], "retarget_ms": RETARGET_MS,
        "controlled_burst_rounds": list(BURST_LEN), "burst_pause_ms": list(BURST_PAUSE_MS),
        "fight_cap_ms": FIGHT_CAP_MS, "band_fit": {k: list(v) for k, v in B.BAND_FIT.items()},
        "long_contact": {"aim": LONG_CONTACT_AIM, "cap_ms": LONG_CONTACT_CAP_MS, "range": "mid"},
        "peek": {"window_ms": PEEK_WINDOW_MS, "react_ms": PEEK_REACT_MS, "p_escape": PEEK_P_ESCAPE},
        "ambush_react_ms": AMBUSH_REACT_MS,
        "rush": {"close_edge_m": CLOSE_EDGE_M, "mid_edge_m": MID_EDGE_M, "speed_m_s": RUSH_SPEED_MS,
                 "move_acc": RUSH_MOVE_ACC, "start_m": RUSH_START_M},
        "field": {"team_sizes": list(FIELD_NS), "venue": FIELD_VENUE, "anchor": ANCHOR,
                  "hit_probs": list(B.DEFAULT_HIT_PROBS), "contact_mean_s": 2.0, "gap_mean_s": 3.0},
        "charge_rifle": "starts every 1v1 and the ambush pre-charged, never recharges inside a fight",
        "kits": {"secondary": SECONDARY, "full_auto": sorted(FULL_AUTO), "combos": [list(c) for c in COMBO_KITS],
                 "perk": "each primary takes the perk with the best mean 1v1 against the BASELINE plain AR"},
        "anchors": "the perk choice, the field ratio and the ambush always use the baseline world's AR",
        "near_top_margin": dict(NEAR_TOP_MARGIN), "viable_field_floor": VIABLE_FIELD_FLOOR,
        "marksman_bars": {"strong": MARKSMAN_STRONG_BAR, "strong_column": MARKSMAN_STRONG_COLUMN,
                          "rush": MARKSMAN_RUSH_BAR},
        "perk_exemption": "a row with reload_type 'bolt' ignores ammo_mult, ammo_mult_pistol and reload_mult",
        "rule_bars": {"standard": RULE_BAR_STANDARD, "overrides": dict(RULE_BAR_OVERRIDES),
                      "shields": B.SHIELDS_BAR, "r10a_ms": B.R10_FINISH_BAR_MS},
        "op_gated_presets": list(OP_GATED_PRESETS),
    }


def _reps(kind: str, scale: float) -> int:
    return max(MIN_REPS, int(round(REPS[kind] * scale)))


def pull_gap(rng, pull_ms: float) -> float:
    """ONE sampled human press gap; 0 when `pull_ms` <= 0. Used for the bolt lever, the ALT press and the
    press after a bolt. It is `balance_sim.semi_interval` with a cycle shorter than any press, so the
    lognormal (mean `pull_ms`, log-sigma `PULL_SIGMA`) lives in one place."""
    if pull_ms <= 0:
        return 0.0
    return B.semi_interval(rng, 1e-9, pull_ms)


# --------------------------------------------------------------------------- #
# Worlds: a catalogue, a perk table and the sim-only style flag
# --------------------------------------------------------------------------- #

@dataclass
class World:
    cat: WeaponCatalog
    perks: PerkCatalog
    styles: dict = None                    # weapon id -> "burst" | "full" for an automatic

    def style(self, wid: str) -> str:
        return (self.styles or {}).get(wid) or ("full" if wid in FULL_AUTO else "burst")

    def fx(self, perk: str | None) -> dict:
        return self.perks.effects(perk)


def pool_parts(preset: str, fx: dict) -> tuple[int, int, int]:
    """(health, armour, shield) for a preset after a perk's `max_armor_add`. The same arithmetic as
    compile.armed_armor/armed_shield (an armour-0 preset routes the grant into the shield), read from the
    perk's own effects so a perk candidate's new number is used. `test_balance_review` pins the two."""
    hp, arm, sh = HEALTH_PRESETS[preset]
    add = int(fx.get("max_armor_add") or 0)
    if arm == 0:
        return hp, 0, max(0, min(255, sh + add))
    return hp, max(0, min(255, arm + add)), max(0, min(255, sh))


def pool_total(preset: str, fx: dict) -> int:
    return sum(pool_parts(preset, fx))


def fieldable_perks(perks: PerkCatalog) -> list[str]:
    """Every visible perk, whatever its effect keys: each one's `max_armor_add` sets a pool a player can field."""
    return list(perks.visible_ids())


def lowest_pools(perks: PerkCatalog) -> dict:
    """{preset: the lowest pool a player can field}: no perk, or any fieldable perk."""
    return {p: min(pool_total(p, perks.effects(k)) for k in [None] + fieldable_perks(perks)) for p in HEALTH_PRESETS}


def modelled_perks(perks: PerkCatalog) -> list[str]:
    """Visible perks whose effects the kit engine models (no Armour Piercing, no node-local perks)."""
    out = []
    for pid in perks.visible_ids():
        fx = perks.effects(pid)
        if fx and set(fx) <= MODELLED_PERK_KEYS:
            out.append(pid)
    return out


# --------------------------------------------------------------------------- #
# Guns and kits
# --------------------------------------------------------------------------- #

@dataclass(frozen=True)
class Gun:
    wid: str
    gun_dmg: int
    head_dmg: int
    fire_ms: float
    mode: str            # auto | semi | burst | charge | bolt
    burst_gap: float
    mag: int
    reserve: int
    reload_ms: float
    chain: bool
    crit: int
    profile: object
    band: str
    tap: int
    rpc: int


def make_gun(cat: WeaponCatalog, wid: str, mods: dict | None = None) -> Gun:
    row = cat._row(wid)
    mag, res, rel = cat._ammo(wid, mods)
    m = cat._frame_int(wid, "mode")
    rpc, tap = cat.rounds_per_charge(wid), cat.tap_damage(wid)
    if rpc > 1 and tap > 0:
        mode = "charge"
    elif m == cat._BURST_MODE:
        mode = "burst"
    elif m == B.SEMI_MODE:
        mode = "bolt" if mag == 1 else "semi"
    else:
        mode = "auto"    # a charge mode with no tap fires every t14, as `Match` does
    band = row.get("range_band") if row.get("range_band") in B.BAND_FIT else "mid"
    return Gun(wid, cat.damage(wid), cat.damage_per_pull(wid) - cat.damage(wid), float(cat.fire_ms(wid)), mode,
               float(cat._frame_int(wid, "burst")) if mode == "burst" else 0.0, mag, res, float(rel),
               row.get("reload_type") == "chain", int(row.get("crit_pct") or 0), B.recoil_profile(row), band,
               tap, rpc)


@dataclass(frozen=True)
class Kit:
    name: str
    guns: tuple            # (opener/primary, finisher/secondary)
    swap_ms: float         # the LARGER t15 of the two slots, perk-scaled (the gun takes the larger)
    perk: str | None
    plan: str              # single | combo
    style: str             # an automatic: burst (controlled) or full
    pools: tuple           # ((preset, pool), ...)
    marksman: bool         # peeks in the PEEK column

    def pool(self, preset: str) -> int:
        return dict(self.pools)[preset]


def _ammo_mods(world: World, wid: str, fx: dict) -> dict | None:
    # A bolt (`reload_type: "bolt"`) ignores the ammo and reload perks, as compile.py `_ammo` does once the
    # Sniper batch (branch brx2/sniper-bolt) lands: the compiled frame is mag 1 / 48 / 1500 under every perk.
    if world.cat._row(wid).get("reload_type") == "bolt":
        return None
    return {k: fx[k] for k in ("ammo_mult", "ammo_mult_pistol", "reload_mult") if k in fx} or None


def _bolt_exempt_sim_only(world: World) -> list[str]:
    """The bolt rows this review exempts from the ammo and reload perks although the compiler on this tree does
    not: on such a tree a pass describes a gun that only the bolt compile change ships (round-2 review)."""
    out = []
    for wid in sorted(world.cat._by_id):
        if world.cat._row(wid).get("reload_type") == "bolt" and \
                world.cat._ammo(wid, {"reload_mult": 0.5}) != world.cat._ammo(wid, None):
            out.append(wid)
    return out


def make_kit(world: World, name: str, primary: str, secondary: str | None = None, perk: str | None = None,
             plan: str = "single") -> Kit:
    cat, fx = world.cat, world.fx(perk)
    g0 = make_gun(cat, primary, _ammo_mods(world, primary, fx))
    sw = {"switch_mult": fx["switch_mult"]} if "switch_mult" in fx else None
    guns, swap = (g0,), 0.0
    if secondary:
        guns = (g0, make_gun(cat, secondary, None))
        swap = float(max(cat.swap_ms(primary, sw), cat.swap_ms(secondary, sw)))
    pools = tuple((p, pool_total(p, fx)) for p in ("standard", "shields"))
    marks = cat._row(primary).get("role") == "marksman" or plan == "combo"
    return Kit(name, guns, swap, perk, plan, world.style(primary), pools, marks)


# --------------------------------------------------------------------------- #
# The kit fight engine (1v1, 1v2, peek, rush, time to kill)
# --------------------------------------------------------------------------- #

class _GunState:
    __slots__ = ("ammo", "reserve", "count", "state", "blen", "charged")

    def __init__(self, g: Gun, charged=True):
        self.ammo, self.reserve = g.mag, g.reserve
        self.count, self.state, self.blen = 0, "crisp", 0
        self.charged = charged


class Fighter:
    """One player with a kit. Hit chance per round = recoil accuracy/100 x aim x BAND_FIT[band][distance],
    capped at 1. Damage = the gun word, plus the headset word at close. The pool is one number (no regen),
    as in the R-rule duels."""

    def __init__(self, kit: Kit, pool: int, aim: float, dist: int, rng, fit=True, pull_ms=PULL_MS):
        self.kit, self.pool, self.aim, self.dist, self.rng, self.fit, self.pull_ms = kit, pool, aim, dist, rng, fit, pull_ms
        self.peek_w = None          # exposure window (ms) around each own shot; None = always exposed
        self.last_shot_t = -math.inf
        self.gs = [_GunState(g, charged=(i == 0)) for i, g in enumerate(kit.guns)]  # a slot not in hand holds no charge
        self.active, self.phase, self.next_t, self.alive = 0, "open", 0.0, True
        self.targets: list = []
        self.kill_times: list = []

    def target(self):
        for f in self.targets:
            if f.alive:
                return f
        return None

    def _semi(self, ms):
        return B.semi_interval(self.rng, ms, self.pull_ms) if self.pull_ms > 0 else ms

    def act(self, t):
        """Fire one round at t (or start a reload). (dmg, hit_p, alpha) or None for no round."""
        r = self._act(t)
        if r is not None:
            self.last_shot_t = t
        return r

    def _act(self, t):
        g, s = self.kit.guns[self.active], self.gs[self.active]
        cost = g.rpc if (g.mode == "charge" and s.charged) else 1
        if s.ammo < cost:
            if s.reserve <= 0:
                if g.mode == "charge" and s.ammo > 0:
                    s.charged = False
                    return self._act(t)
                self.next_t = math.inf
                return None
            got = min(g.mag - s.ammo, s.reserve)
            s.reserve -= got
            s.ammo += got
            s.count, s.state, s.blen = 0, "crisp", 0
            self.next_t = t + (g.reload_ms * got if g.chain else g.reload_ms)
            return None
        acc = 1.0
        if g.profile is not None and g.mode == "auto":
            acc = B._accuracy_pct(g.profile, s.state) / 100.0
        fit = B.BAND_FIT[g.band][self.dist] if self.fit else 1.0
        hit_p = min(1.0, acc * self.aim * fit)
        if g.mode == "charge":
            was = s.charged
            dmg = g.gun_dmg + g.head_dmg if was else g.tap
            s.ammo -= cost
            s.charged = False
            self.next_t = t + CHARGE_TAP_CADENCE_MS
            return dmg, hit_p, was
        dmg = g.gun_dmg
        if g.crit and self.rng.random() * 100.0 < g.crit:
            dmg = int(dmg * B.CRIT_MULT)
        if self.dist == 0:
            dmg += g.head_dmg
        s.ammo -= 1
        if g.mode == "bolt":
            iv = self._semi(g.fire_ms)
            if s.reserve > 0:
                s.reserve -= 1
                s.ammo += 1
                iv = max(iv, pull_gap(self.rng, self.pull_ms) + g.reload_ms + pull_gap(self.rng, self.pull_ms))
            self.next_t = t + iv
        elif g.mode == "semi":
            self.next_t = t + self._semi(g.fire_ms)
        elif g.mode == "burst":
            s.count += 1
            self.next_t = t + (g.burst_gap if s.count % 3 == 0 else g.fire_ms)
        else:  # auto
            s.state, s.count = B._recoil_step(g.profile, s.state, s.count)
            self.next_t = t + g.fire_ms
            if self.kit.style == "burst" and g.profile is not None:
                if s.blen == 0:
                    s.blen = self.rng.randint(*BURST_LEN)
                s.blen -= 1
                if s.blen == 0:
                    if s.state == "crisp":
                        s.count = 0
                    pause = self.rng.uniform(*BURST_PAUSE_MS)
                    self.next_t += pause
                    if s.state != "crisp" and pause >= g.profile.settle_ms:
                        s.state, s.count = "crisp", 0
        return dmg, hit_p, (g.mode in ("bolt", "semi") and g.gun_dmg >= 50)

    def after(self, t, alpha: bool, killed: bool):
        """The plan step after a round. `alpha`: that round was the opener's big round."""
        if killed:
            s = self.gs[self.active]
            if s.state == "crisp":
                s.count = 0
            s.blen = 0
            self.next_t = max(self.next_t, t + RETARGET_MS)
        if self.kit.plan == "combo" and self.phase == "open" and self.active == 0 and alpha and not killed \
                and len(self.kit.guns) > 1:
            alt = t + pull_gap(self.rng, self.pull_ms)    # the ALT press
            self.active, self.phase = 1, "finish"
            self.next_t = alt + self._semi(self.kit.swap_ms)


def exposed(f, t: float) -> bool:
    """A peeking fighter is exposed only within peek_w/2 of its last round or its next one."""
    w = f.peek_w
    if not w:
        return True
    h = w / 2.0
    return (t - f.last_shot_t) <= h or (f.next_t - t) <= h


def fight(rng, side_a: list, side_b: list, cap_ms=FIGHT_CAP_MS, alert=None):
    """A race. `alert` {fighter: delay_ms}: that fighter idles until the delay after the first landed hit."""
    for f in side_a:
        f.targets = side_b
    for f in side_b:
        f.targets = side_a
    allf = side_a + side_b
    alert = alert or {}
    for f in alert:
        f.next_t = math.inf
    first_hit = None
    while True:
        cands = [f for f in allf if f.alive and f.next_t <= cap_ms and f.target() is not None]
        if not cands:
            break
        f = min(cands, key=lambda x: x.next_t)
        t = f.next_t
        tgt = f.target()
        r = f.act(t)
        if r is None:
            continue
        dmg, hp, alpha = r
        killed = False
        if rng.random() < hp and exposed(tgt, t):
            tgt.pool -= dmg
            if first_hit is None:
                first_hit = t
                for g in alert:
                    if g.alive:
                        g.next_t = t + alert[g]
            if tgt.pool <= 0:
                tgt.alive = False
                killed = True
                f.kill_times.append(t)
        f.after(t, alpha, killed)
        if all(not x.alive for x in side_a) or all(not x.alive for x in side_b):
            break


DIST = {"close": 0, "mid": 1, "long": 2}


def _reaction(rng):
    return max(0.0, rng.gauss(REACTION_MEAN_MS, REACTION_SD_MS))


def duel_rate(kit_a: Kit, kit_b: Kit, dist: str, preset="standard", reps=3000, aim=AIM, cap_ms=FIGHT_CAP_MS,
              peek=False) -> float:
    """Win rate of a over b in a 1v1 (a draw on equal pools is half). `peek`: a marksman kit peeks with
    PEEK_WINDOW_MS; a lone peeker opens at t=0 and the other side reacts from that shot."""
    pa = PEEK_WINDOW_MS if (peek and kit_a.marksman) else None
    pb = PEEK_WINDOW_MS if (peek and kit_b.marksman) else None
    rng = B.cell_rng(SEED, "kduel", kit_a.name, kit_b.name, dist, preset, aim, cap_ms, pa, pb)
    d = DIST[dist]
    wins = 0.0
    for _ in range(reps):
        a = Fighter(kit_a, kit_a.pool(preset), aim, d, rng)
        b = Fighter(kit_b, kit_b.pool(preset), aim, d, rng)
        a.next_t, b.next_t = _reaction(rng), _reaction(rng)
        a.peek_w, b.peek_w = pa, pb
        if pa and not pb:
            a.next_t = 0.0
        elif pb and not pa:
            b.next_t = 0.0
        fight(rng, [a], [b], cap_ms)
        if a.alive and not b.alive:
            wins += 1
        elif a.alive == b.alive:
            wins += 0.5 if a.pool == b.pool else (1.0 if a.pool > b.pool else 0.0)
    return wins / reps


def ambush(kit: Kit, enemy: Kit, dist: str, reps=3000) -> tuple[float, float]:
    """1 shooter v 2 enemies idle until AMBUSH_REACT_MS after the first landed hit. (P kill both, P kill one+)."""
    rng = B.cell_rng(SEED, "ambush", kit.name, enemy.name, dist, AMBUSH_REACT_MS)
    d = DIST[dist]
    both = one = 0
    for _ in range(reps):
        s = Fighter(kit, kit.pool("standard"), AIM, d, rng)
        e1 = Fighter(enemy, enemy.pool("standard"), AIM, d, rng)
        e2 = Fighter(enemy, enemy.pool("standard"), AIM, d, rng)
        s.next_t = 0.0
        fight(rng, [s], [e1, e2], FIGHT_CAP_MS, alert={e1: AMBUSH_REACT_MS, e2: AMBUSH_REACT_MS})
        both += (not e1.alive and not e2.alive)
        one += bool(s.kill_times)
    return both / reps, one / reps


def peek_encounter(rng, m: Fighter, v: Fighter):
    """`m` peeks and opens at t=0; `v` is unaware until m's first LANDED hit. PEEK_REACT_MS later, v breaks
    line of sight with PEEK_P_ESCAPE (the encounter ends) or fights back through m's exposure windows.
    (peek_kill, m_died, escaped)."""
    m.peek_w = PEEK_WINDOW_MS
    m.targets, v.targets = [v], [m]
    m.next_t, v.next_t = 0.0, math.inf
    t_alert, alerted, escaped = None, False, False
    while True:
        cands = [f for f in (m, v) if f.alive and f.next_t <= FIGHT_CAP_MS]
        nxt = min((f.next_t for f in cands), default=math.inf)
        if t_alert is not None and not alerted and t_alert <= nxt and t_alert <= FIGHT_CAP_MS:
            alerted = True
            if rng.random() < PEEK_P_ESCAPE:
                escaped = True
                break
            v.next_t = t_alert
            continue
        if not cands:
            break
        f = min(cands, key=lambda x: x.next_t)
        t = f.next_t
        r = f.act(t)
        if r is None:
            continue
        dmg, hp, alpha = r
        tgt = v if f is m else m
        killed = False
        if rng.random() < hp and exposed(tgt, t):
            tgt.pool -= dmg
            if f is m and t_alert is None:
                t_alert = t + PEEK_REACT_MS
            if tgt.pool <= 0:
                tgt.alive = False
                killed = True
        f.after(t, alpha, killed)
        if killed:
            break
    return (m.alive and not v.alive), (not m.alive), escaped


def _band_of(dist_m: float) -> int:
    return 0 if dist_m < CLOSE_EDGE_M else (1 if dist_m < MID_EDGE_M else 2)


def rush_encounter(rng, m: Fighter, v: Fighter, start_m: float):
    """The peeking marksman `m` opens at t=0 from `start_m`. Its first shot (hit or miss) alerts `v`, which
    rushes PEEK_REACT_MS later at RUSH_SPEED_MS, firing on the move at RUSH_MOVE_ACC. At close range cover
    no longer protects m. (marksman_kill, rush_success)."""
    m.peek_w = PEEK_WINDOW_MS
    m.targets, v.targets = [v], [m]
    m.next_t, v.next_t = 0.0, math.inf
    t_rush = None

    def dist_at(t):
        return start_m if t_rush is None or t <= t_rush else max(0.0, start_m - RUSH_SPEED_MS * (t - t_rush) / 1000.0)

    while True:
        cands = [f for f in (m, v) if f.alive and f.next_t <= RUSH_CAP_MS]
        if not cands:
            break
        f = min(cands, key=lambda x: x.next_t)
        t = f.next_t
        b = _band_of(dist_at(t))
        m.dist = v.dist = b
        if b == 0:
            m.peek_w = None
        r = f.act(t)
        if r is None:
            continue
        dmg, hp, alpha = r
        if f is v and b != 0:
            hp *= RUSH_MOVE_ACC
        tgt = v if f is m else m
        killed = False
        if rng.random() < hp and exposed(tgt, t):
            tgt.pool -= dmg
            if tgt.pool <= 0:
                tgt.alive = False
                killed = True
        if f is m and t_rush is None:
            t_rush = t + PEEK_REACT_MS
            v.next_t = t_rush
        f.after(t, alpha, killed)
        if killed:
            break
    return (m.alive and not v.alive), (v.alive and not m.alive)


def marksman_rush_counter(kit_m: Kit, kit_v: Kit, reps: int) -> dict:
    """Tony 2026-10-17: "sniper should feel strong until players recognize the strat to rush the sniper".
    peek_kill: the peek-kill rate at long range against a player who does not rush. rush_success: the rate
    a rusher from RUSH_START_M kills the same peeking marksman."""
    rng = B.cell_rng(SEED, "peek", kit_m.name, kit_v.name, PEEK_WINDOW_MS, PEEK_REACT_MS, PEEK_P_ESCAPE)
    k = dd = e = 0
    for _ in range(reps):
        m = Fighter(kit_m, kit_m.pool("standard"), AIM, 2, rng)
        v = Fighter(kit_v, kit_v.pool("standard"), AIM, 2, rng)
        a, b, c = peek_encounter(rng, m, v)
        k += a; dd += b; e += c  # noqa: E702
    rng = B.cell_rng(SEED, "rush", kit_m.name, kit_v.name, PEEK_WINDOW_MS, PEEK_REACT_MS, RUSH_START_M)
    mk = rs = 0
    for _ in range(reps):
        m = Fighter(kit_m, kit_m.pool("standard"), AIM, 2, rng)
        v = Fighter(kit_v, kit_v.pool("standard"), AIM, 2, rng)
        a, b = rush_encounter(rng, m, v, RUSH_START_M)
        mk += a; rs += b  # noqa: E702
    return {"peek_kill": k / reps, "peek_death": dd / reps, "escape": e / reps,
            "rush_success": rs / reps, "marksman_beats_rusher": mk / reps}


def time_to_kill(kit: Kit, pool: int, aim: float, reps: int, fit=False, reaction=False, dist="mid"):
    """Undefended target, one fighter, from its first round (or a reaction delay) to the kill.
    (median ms, mean rounds fired). inf when it runs dry inside FIGHT_CAP_MS."""
    rng = B.cell_rng(SEED, "ttk", kit.name, pool, aim, fit, reaction, dist)
    d = DIST[dist]
    times, rounds = [], []
    for _ in range(reps):
        a = Fighter(kit, 1, aim, d, rng, fit=fit)
        hp = pool
        a.next_t = _reaction(rng) if reaction else 0.0
        n, done = 0, math.inf
        while a.next_t < FIGHT_CAP_MS:
            t = a.next_t
            r = a.act(t)
            if r is None:
                continue
            dmg, p, alpha = r
            n += 1
            killed = False
            if rng.random() < p:
                hp -= dmg
                killed = hp <= 0
            a.after(t, alpha, killed)
            if killed:
                done = t
                break
        times.append(done)
        rounds.append(n)
    times.sort()
    return times[len(times) // 2], sum(rounds) / len(rounds)


# --------------------------------------------------------------------------- #
# The field (team) sim with kits: balance_sim.Match plus a swap step and a combo policy
# --------------------------------------------------------------------------- #

class KitPlayer(B.Player):
    __slots__ = ("kit", "models", "stash", "active", "phase", "swap_until", "kpool", "dist", "combo")


@dataclass(frozen=True)
class FieldKit:
    name: str
    models: tuple       # WeaponModel(s), opener first
    swap_ms: float
    pool: B.Pool
    combo: bool


def _wm(world: World, wid: str, fx: dict | None):
    m = B.weapon_model(world.cat, wid)
    mag, res, rel = world.cat._ammo(wid, _ammo_mods(world, wid, fx or {}))
    return replace(m, mag=mag, reserve=res, reload_ms=float(rel))


def field_kit(world: World, name: str, primary: str, secondary: str | None = None, perk: str | None = None,
              combo=False) -> FieldKit:
    fx = world.fx(perk)
    models, swap = (_wm(world, primary, fx),), 0.0
    if secondary:
        models += (_wm(world, secondary, None),)
        sw = {"switch_mult": fx["switch_mult"]} if "switch_mult" in fx else None
        swap = float(max(world.cat.swap_ms(primary, sw), world.cat.swap_ms(secondary, sw)))
    hp, arm, sh = pool_parts("standard", fx)
    return FieldKit(name, models, swap, B.Pool(hp, arm, sh, B.default_pool().respawn_ms),
                    combo and secondary is not None)


class KitMatch(B.Match):
    def _seek(self, p, t, _gen=0):
        if not p.alive:
            return
        enemies = [q for q in self.players if q.team != p.team and q.alive]
        if not enemies:
            self.push(t + 200.0, self.SEEK, p.pid)
            return
        targeted = [q for q in enemies if q.attackers > 0]
        target = self.rng.choice(targeted) if targeted and self.rng.random() < self.pj else self.rng.choice(enemies)
        p.engage_id += 1
        gen = p.engage_id
        p.target = target.pid
        p.contact_end = t + self.rng.expovariate(1.0 / self.cfg.contact_mean_s) * 1000.0
        target.attackers += 1
        p.hit_p = self.base_p
        p.dist = 1
        if self.cfg.range_model:     # as Match._seek: no range draw when the range model is off
            p.dist = self.rng.choices((0, 1, 2), weights=self.dist_w)[0]
            p.hit_p = min(1.0, p.hit_p * B.hit_multiplier(p.w, p.dist, self.cfg))
        p.burst_i = 0
        p.phase = "open"
        first = max(t, p.next_ready, p.swap_until)
        if p.w.charged and not p.w.charge_and_tap:
            first = max(first, t + p.w.fire_ms)
        self.push(first, self.SHOT, p.pid, gen)
        self.push(p.contact_end, self.CEND, p.pid, gen)

    def _start_reload(self, p, t):
        super()._start_reload(p, t)
        if p.w.semi and p.w.mag == 1:
            # a bolt: the lever is one pull gap before reload_ms, and the next round one press after it
            p.reload_until += pull_gap(self.rng, self.cfg.pull_ms) + pull_gap(self.rng, self.cfg.pull_ms)

    def _swap_to(self, p, idx, t_end):
        p.stash[p.active] = (p.ammo, p.reserve, p.reload_until)
        p.active = idx
        p.ammo, p.reserve, p.reload_until = p.stash[idx]
        p.w = p.models[idx]
        p.swap_until = t_end

    def _tactical_reload(self, p, t):
        if p.combo and p.active != 0:
            end = t + p.kit.swap_ms
            self._swap_to(p, 0, end)
            p.last_pull = end      # the charge builds only once the opener is back in hand
            p.next_ready = max(p.next_ready, end)
        super()._tactical_reload(p, t)

    def _shot(self, p, t, gen):
        if not p.alive or p.engage_id != gen or p.target is None or t > p.contact_end:
            return
        if t < p.swap_until:
            self.push(p.swap_until, self.SHOT, p.pid, gen)
            return
        if not p.combo:
            return super()._shot(p, t, gen)
        w = p.w
        alpha_ready = p.active == 0 and p.phase == "open" and p.ammo > 0 and t >= p.reload_until and (
            not w.charge_and_tap or (p.ammo >= w.rounds_per_charge and t - p.last_pull >= w.fire_ms))
        target = self.players[p.target]
        super()._shot(p, t, gen)
        if alpha_ready and p.alive and p.engage_id == gen and p.target is not None and target.alive:
            # drop the SHOT the base pushed for this engagement; schedule the swap and the finisher instead
            self.heap = [e for e in self.heap if not (e[2] == self.SHOT and e[3] == p.pid and e[4] == gen and e[0] >= t)]
            B.heapq.heapify(self.heap)
            alt = t + pull_gap(self.rng, self.cfg.pull_ms)
            self._swap_to(p, 1, alt + p.kit.swap_ms)
            p.phase = "finish"
            p.hit_p = min(1.0, self.base_p * B.hit_multiplier(p.w, p.dist, self.cfg))
            first = max(alt + B.semi_interval(self.rng, p.kit.swap_ms, self.cfg.pull_ms), p.reload_until)
            if first <= p.contact_end:
                self.push(first, self.SHOT, p.pid, gen)

    def _respawn(self, p, t, _gen=0):
        pool = p.kpool
        p.alive = True
        p.shield, p.armour, p.health = pool.shield, pool.armour, pool.health
        if len(p.models) > 1:
            p.stash = [(m.mag, m.reserve, -1.0) for m in p.models]
            p.active = 0
            p.w = p.models[0]
            p.swap_until = 0.0
        p.ammo, p.reserve = p.w.mag, p.w.reserve
        p.reload_until = -1.0
        p.poison_gen += 1
        p.poison_left = 0
        self.push(t, self.SEEK, p.pid)


def _kit_player(pid, team, fk: FieldKit):
    p = KitPlayer(pid, team, fk.models[0], fk.pool)
    p.kit, p.models, p.kpool, p.combo = fk, fk.models, fk.pool, fk.combo
    p.stash = [(m.mag, m.reserve, -1.0) for m in fk.models]
    p.active, p.phase, p.swap_until, p.dist = 0, "open", 0.0, 1
    return p


def field_ratio(test: FieldKit, anchor: FieldKit, n: int, reps: int) -> float:
    """Kill-rate ratio (test carriers / anchor carriers), one test carrier a side, team size n."""
    cfg = B.SimConfig(pool=B.default_pool(), venue=FIELD_VENUE)
    rng = B.cell_rng(SEED, "kfield", test.name, anchor.name, n)
    kt = ka = 0
    for r in range(reps):
        hp = cfg.hit_probs[r % len(cfg.hit_probs)]
        players = []
        for side in (0, 1):
            players.append(_kit_player(len(players), side, test))
            for _ in range(n - 1):
                players.append(_kit_player(len(players), side, anchor))
        KitMatch(players, rng, cfg, hp, n).run()
        for i, p in enumerate(players):
            if i % n == 0:
                kt += p.kills
            else:
                ka += p.kills
    mins_t = reps * 2 * cfg.match_ms / 60000.0
    mins_a = reps * 2 * (n - 1) * cfg.match_ms / 60000.0
    return (kt / mins_t) / (ka / mins_a) if ka else float("nan")


# --------------------------------------------------------------------------- #
# Cell jobs, a memo cache and the optional process pool
# --------------------------------------------------------------------------- #

_CACHE: dict = {}


def clear_cache() -> None:
    _CACHE.clear()


def _run_cell(job):
    kind = job[0]
    if kind == "duel":
        _, a, b, dist, preset, aim, cap, peek, reps = job
        return duel_rate(a, b, dist, preset, reps, aim, cap, peek)
    if kind == "field":
        _, fk, anchor, n, reps = job
        return field_ratio(fk, anchor, n, reps)
    if kind == "ambush":
        _, k, enemy, dist, reps = job
        return ambush(k, enemy, dist, reps)
    if kind == "rule":
        return _run_rule(*job[1:])
    if kind == "rush":
        _, km, kv, reps = job
        return marksman_rush_counter(km, kv, reps)
    raise ValueError(kind)


def run_cells(jobs: list, n_jobs: int = 1) -> list:
    """Results for `jobs`, in order. A job already run (same kits, same params) comes from the cache: two
    identical kits give identical cells, because every cell seeds from its own key."""
    todo = [j for j in dict.fromkeys(jobs) if j not in _CACHE]
    if n_jobs > 1 and len(todo) > 1:
        with ProcessPoolExecutor(max_workers=n_jobs) as ex:
            for j, r in zip(todo, ex.map(_run_cell, todo, chunksize=max(1, len(todo) // (n_jobs * 8)))):
                _CACHE[j] = r
    else:
        for j in todo:
            _CACHE[j] = _run_cell(j)
    return [_CACHE[j] for j in jobs]


# --------------------------------------------------------------------------- #
# The kit roster and the dominance matrix
# --------------------------------------------------------------------------- #

def roster_ids(world: World) -> tuple[list[str], list[str]]:
    """(primary ids in catalogue order, ids left out with the reason)."""
    out, skipped = [], []
    for r in world.cat._rows:
        wid = r["weapon_id"]
        if r.get("hidden") or r.get("lethal") is False or r.get("pickup_only"):
            continue
        if r.get("role") in ("sidearm", "melee", "support"):
            continue
        if r.get("dot"):
            skipped.append(f"{wid}: a DoT weapon, the kit engine has no tick")
            continue
        out.append(wid)
    return out, skipped


def _name(world: World, wid: str) -> str:
    return world.cat._row(wid).get("name", wid)


def choose_perks(world: World, primaries: list[str], scale: float, n_jobs: int,
                 anchor_world: World | None = None) -> tuple[dict, dict]:
    """({primary: best perk}, {primary: {perk: score}}). Score = mean 1v1 win rate against the plain AR of
    `anchor_world` (the baseline) over the three ranges; ties keep the earlier option (no perk first)."""
    options = [None] + modelled_perks(world.perks)
    plain_ar = make_kit(anchor_world or world, "AR (plain)", ANCHOR)
    reps = _reps("perk", scale)
    jobs, index = [], []
    for wid in primaries:
        for perk in options:
            k = make_kit(world, f"{_name(world, wid)}|{perk}", wid, SECONDARY, perk)
            for d in DIST:
                jobs.append(("duel", k, plain_ar, d, "standard", AIM, FIGHT_CAP_MS, False, reps))
                index.append((wid, perk))
    res = run_cells(jobs, n_jobs)
    scores: dict = {}
    for (wid, perk), v in zip(index, res):
        scores.setdefault(wid, {}).setdefault(str(perk), 0.0)
        scores[wid][str(perk)] += v / 3
    best = {}
    for wid in primaries:
        top = None
        for perk in options:
            if top is None or scores[wid][str(perk)] > scores[wid][str(top)] + 1e-12:
                top = perk
        best[wid] = top
    return best, scores


@dataclass
class KitSpec:
    name: str
    primary: str
    secondary: str | None
    perk: str | None
    combo: bool


def build_kits(world: World, scale: float, n_jobs: int, extra: list[str] = (),
               anchor_world: World | None = None) -> tuple[list[KitSpec], dict, list]:
    prim, skipped = roster_ids(world)
    for wid in extra:
        if wid not in prim:
            prim.append(wid)
    best, scores = choose_perks(world, prim, scale, n_jobs, anchor_world)
    specs, seen = [], set()
    for w in prim:
        name = _name(world, w)
        if name in seen:
            name = f"{name} ({w})"
        seen.add(name)
        specs.append(KitSpec(name, w, SECONDARY, best[w], False))
    for name, a, b, perk in COMBO_KITS:
        if world.cat._by_id.get(a) and world.cat._by_id.get(b) and world.perks.has(perk):
            specs.append(KitSpec(name, a, b, perk, True))
    return specs, {"best": {_name(world, w): best[w] for w in prim}, "scores": {_name(world, w): scores[w] for w in prim}}, skipped


def _top(values) -> float:
    """The column's best, ignoring NaN (a cell that did not run). NaN when nothing ran."""
    ok = [v for v in values if isinstance(v, (int, float)) and not math.isnan(v)]
    return max(ok) if ok else float("nan")


def dominance_matrix(world: World, specs: list[KitSpec], scale: float, n_jobs: int,
                     anchor_world: World | None = None) -> dict:
    """The kit matrix. The field anchor and the ambush enemies are `anchor_world`'s plain AR (the baseline), so
    an AR candidate is measured against today's AR, not against itself."""
    aw = anchor_world or world
    kits = {s.name: make_kit(world, s.name, s.primary, s.secondary, s.perk, "combo" if s.combo else "single")
            for s in specs}
    fks = {s.name: field_kit(world, s.name, s.primary, s.secondary, s.perk, s.combo) for s in specs}
    names = [s.name for s in specs]
    dr = _reps("duel", scale)
    cells = []
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            for preset in ("standard", "shields"):
                for d in DIST:
                    cells.append(((preset, d, a, b), ("duel", kits[a], kits[b], d, preset, AIM, FIGHT_CAP_MS, False, dr)))
            cells.append((("long", "mid", a, b), ("duel", kits[a], kits[b], "mid", "standard", LONG_CONTACT_AIM,
                                                  LONG_CONTACT_CAP_MS, False, dr)))
            cells.append((("peek", "mid", a, b), ("duel", kits[a], kits[b], "mid", "standard", AIM, FIGHT_CAP_MS, True, dr)))
    anchor_fk = field_kit(aw, "AR anchor", ANCHOR)
    enemy = make_kit(aw, "AR enemy", ANCHOR)
    fr, ar = _reps("field", scale), _reps("ambush", scale)
    for n in names:
        for N in FIELD_NS:
            cells.append((("field", N, n), ("field", fks[n], anchor_fk, N, fr)))
        for d in DIST:
            cells.append((("ambush", d, n), ("ambush", kits[n], enemy, d, ar)))
    res = run_cells([j for _, j in cells], n_jobs)
    duel, field, amb = {}, {}, {}
    for (key, _), r in zip(cells, res):
        if key[0] == "field":
            field.setdefault(key[2], []).append(r)
        elif key[0] == "ambush":
            amb.setdefault(key[2], []).append(r[0] + r[1])
        else:
            mode, d, a, b = key
            duel[f"{mode}|{d}|{a}|{b}"] = r
            duel[f"{mode}|{d}|{b}|{a}"] = 1.0 - r

    def mean1(mode, d, n):
        v = [duel[f"{mode}|{d}|{n}|{o}"] for o in names if o != n]
        return sum(v) / len(v) if v else float("nan")

    cols = {}
    for n in names:
        cols[n] = {"1v1 close": mean1("standard", "close", n), "1v1 mid": mean1("standard", "mid", n),
                   "1v1 long": mean1("standard", "long", n), "long contact": mean1("long", "mid", n),
                   "peek mid": mean1("peek", "mid", n), "field": B.geo_mean(field[n]),
                   "ambush": sum(amb[n]) / len(amb[n]),
                   "shields": sum(mean1("shields", d, n) for d in DIST) / 3}
    top = {c: _top([cols[n][c] for n in names]) for c in COLUMNS}
    near = {n: [c for c in COLUMNS if cols[n][c] >= top[c] - NEAR_TOP_MARGIN[c]] for n in names}
    keys = {s.name: (s.name if s.combo else s.primary) for s in specs}   # stable ids: weapon_id, or the combo name
    return {"kits": names, "keys": keys, "specs": {s.name: {"primary": s.primary, "secondary": s.secondary, "perk": s.perk,
                                               "combo": s.combo} for s in specs},
            "columns": cols, "top": top, "near_top": near, "duels": duel}


# --------------------------------------------------------------------------- #
# The Balance rules (R1-R12, R10a), per preset, from balance_sim's engines
# --------------------------------------------------------------------------- #

_KIND_IDS = {"smg": "smg", "shotgun": "shotgun", "burst_rifle": "burst_rifle", "ar_burst": ANCHOR,
             "ar_full": ANCHOR, "usp": "usp", "deagle": "deagle", "energy_rifle": "energy_rifle",
             "suppressor": "suppressor", "amr": "amr", "bolt_rifle": "bolt_rifle"}


def rule_list() -> list[tuple[str, tuple, str]]:
    """(rule id, weapon ids it reads, kind). R10a runs once (its 35 HP target has no preset)."""
    out = [("R1", ("charge_rifle", ANCHOR), "recoil"), ("R2", ("charge_rifle", ANCHOR), "recoil"),
           ("R3", (ANCHOR,), "recoil")]
    for key, (_d, _e, a, b, _band) in B.RANGE_RULES.items():
        out.append((f"R{key}", (_KIND_IDS[a], _KIND_IDS[b]), "range"))
    for p in B.R10_PRIMARIES:
        for s in B.R10_SIDEARMS:
            out.append((f"R10b {p}/{s}", (_KIND_IDS[p], s), "r10b"))
    for s in B.R10_SIDEARMS:
        out.append((f"R10a {s}", (s,), "r10a"))
    return out


def _rule_bar(rid: str, preset: str) -> float:
    if rid.startswith("R10a"):
        return B.R10_FINISH_BAR_MS
    if preset == "shields":
        return B.SHIELDS_BAR
    return RULE_BAR_OVERRIDES.get(rid, RULE_BAR_STANDARD)


def _run_rule(rid: str, kind: str, preset: str, rows_sig: str, reps: int):
    """One rule on one preset. `rows_sig` is the JSON of the rows the rule reads: the cache key, and the
    catalogue the rule runs on."""
    rows = json.loads(rows_sig)
    cat = WeaponCatalog(_complete_rows(rows))
    m = B.RecoilDuelModel.from_catalog(cat, health_preset=preset)
    if kind == "recoil":
        n = rid[1:]
        _d, expected, fn, tap_dep = B.RECOIL_RULES[n]
        args = (m, float(CHARGE_TAP_CADENCE_MS)) if tap_dep else (m,)
        # the CI gate's own labels (test_balance_sim.py "gate_rule1".."gate_rule3"), so at the same reps the
        # numbers here are the CI numbers
        return B.recoil_duel_batch(fn, expected, reps, SEED, f"gate_rule{n}", *args).win_rate
    if kind == "range":
        return B.range_duel_batch(m, rid[1:], reps, SEED).win_rate
    if kind == "r10b":
        p, s = rid.split(" ", 1)[1].split("/")
        return B.r10_duel_batch(m, p, s, reps, SEED).win_rate
    s = rid.split(" ", 1)[1]
    return B.finish_time_batch(m, s, reps, SEED).median_ms


_SHIPPED_ROWS = None


def _complete_rows(rows: dict) -> list:
    """The shipped rows with `rows` (id -> row) swapped in. `RecoilDuelModel.from_catalog` reads eleven fixed
    ids, so the rule catalogue must carry them all; only the ones the rule reads come from `rows`."""
    global _SHIPPED_ROWS
    if _SHIPPED_ROWS is None:
        _SHIPPED_ROWS = WeaponCatalog()._rows
    return [rows.get(r["weapon_id"], r) for r in _SHIPPED_ROWS]


def run_rules(world: World, scale: float, n_jobs: int) -> dict:
    reps = _reps("rule", scale)
    jobs, keys = [], []
    for rid, ids, kind in rule_list():
        sig = json.dumps({w: world.cat._row(w) for w in ids}, sort_keys=True)
        for preset in (("standard",) if kind == "r10a" else ("standard", "shields")):
            jobs.append(("rule", rid, kind, preset, sig, reps))
            keys.append((rid, preset))
    out = {}
    for (rid, preset), v in zip(keys, run_cells(jobs, n_jobs)):
        bar = _rule_bar(rid, preset)
        ok = v < bar if rid.startswith("R10a") else v >= bar
        out[f"{preset}|{rid}"] = {"value": v, "bar": bar, "pass": ok}
    return out


# --------------------------------------------------------------------------- #
# Trigger mechanics and the one-shot rule
# --------------------------------------------------------------------------- #

def _token(cat: WeaponCatalog, wid: str, t: int) -> str:
    try:
        return cat.resolve(wid, 0).split(",")[t + 1].strip()
    except (IndexError, ValueError, KeyError):
        return ""


def trigger_mechanics(cat: WeaponCatalog, wid: str) -> set:
    """How the trigger behaves, as a set of named features (Tony 2026-09-17: overheat, charge, burst and
    shell reloads add to dynamic gunplay). A stat change is not a mechanic."""
    mode = cat._frame_int(wid, "mode")
    names = {0: "full auto", B.SEMI_MODE: "single shot", cat._BURST_MODE: "3-round burst", 2: "auto-fire charge",
             3: "hold-and-release charge", 14: "charge and heat", 13: "melee"}
    out = {names.get(mode, f"fire mode {mode}")}
    mag, _res, _rel = cat._ammo(wid, None)
    if mode == B.SEMI_MODE and mag == 1:
        out.add("bolt action (1-round magazine)")
    if cat.rounds_per_charge(wid) > 1 and cat.tap_damage(wid) > 0:
        out.add("charge plus tap")
    if _token(cat, wid, 38) not in ("", "0"):
        out.add("overheat")
    if cat._row(wid).get("reload_type") == "chain":
        out.add("shell-by-shell reload")
    if cat.damage_per_pull(wid) > cat.damage(wid):
        out.add("two-word pull (gun + headset)")
    return out


def loadout_ids(cat: WeaponCatalog) -> list[str]:
    return [r["weapon_id"] for r in cat._rows
            if not r.get("hidden") and r.get("lethal") is not False and not r.get("pickup_only")
            and r.get("role") != "melee"]


def op_check(world: World, ids: list[str]) -> dict:
    """{weapon: {...}} for `ids`: the larger of the close pull (gun + headset word) and a crit's pull, against
    the lowest pool a player can field on each preset (no perk, or ANY visible perk's `max_armor_add`)."""
    lows = lowest_pools(world.perks)
    out = {}
    for wid in ids:
        row = world.cat._row(wid)
        pull = world.cat.damage_per_pull(wid)
        crit = int(row.get("crit_pct") or 0)
        crit_pull = int(world.cat.damage(wid) * B.CRIT_MULT) + (pull - world.cat.damage(wid)) if crit else pull
        worst = max(pull, crit_pull)
        one_shots = {p: worst >= lows[p] for p in HEALTH_PRESETS}
        out[wid] = {"pull": pull, "crit_pull": crit_pull, "worst_pull": worst, "lowest_pool": lows, "one_shots": one_shots,
                    "pickup_only": bool(row.get("pickup_only")),
                    "pass": bool(row.get("pickup_only")) or not any(one_shots[p] for p in OP_GATED_PRESETS)}
    return out


# --------------------------------------------------------------------------- #
# Candidate files
# --------------------------------------------------------------------------- #

def _facts(cat: WeaponCatalog, wid: str) -> dict:
    """The numbers the sim reads for one weapon: a diff that moves none of them had no effect."""
    row = cat._row(wid)
    mag, res, rel = cat._ammo(wid, None)
    return {"dmg": cat.damage(wid), "pull": cat.damage_per_pull(wid), "tap": cat.tap_damage(wid),
            "rounds_per_charge": cat.rounds_per_charge(wid), "fire_ms": cat.fire_ms(wid),
            "mode": cat._frame_int(wid, "mode"), "burst_gap": cat._frame_int(wid, "burst"),
            "mag": mag, "reserve": res, "reload_ms": rel, "swap_ms": cat.swap_ms(wid),
            "crit_pct": int(row.get("crit_pct") or 0), "range_band": row.get("range_band"),
            "role": row.get("role"), "reload_type": row.get("reload_type"), "pickup_only": bool(row.get("pickup_only")),
            "recoil": row.get("recoil"), "dot": row.get("dot"), "overheat": _token(cat, wid, 38)}


def normalise(entry: dict) -> dict:
    """One candidate entry -> {"kind": "diff" | "row" | "perk_diff" | "perk_row", ...}."""
    if not isinstance(entry, dict):
        raise ValueError("a candidate entry must be a JSON object")
    sim = dict(entry.get("sim") or {})
    if "perk_exempt" in sim:
        raise ValueError('sim.perk_exempt is gone: set "reload_type": "bolt" on the row (a bolt ignores the ammo and reload perks)')
    if set(sim) - {"style"}:
        raise ValueError(f"unknown sim keys {sorted(set(sim) - {'style'})}; the only one is style")
    if "perk_id" in entry and "changes" in entry:
        return {"kind": "perk_diff", "perk_id": entry["perk_id"], "changes": dict(entry["changes"]), "sim": sim}
    if "perk" in entry:
        return {"kind": "perk_row", "perk_id": entry["perk"]["perk_id"], "row": entry["perk"], "sim": sim}
    if "weapon_id" in entry and "changes" in entry:
        return {"kind": "diff", "weapon_id": entry["weapon_id"], "changes": dict(entry["changes"]), "sim": sim}
    row = entry.get("row")
    if row is None and "weapon_id" in entry and ("capture" in entry or "frame" in entry or "name" in entry):
        row = {k: v for k, v in entry.items() if k not in ("sim", "with", "title", "proposed_by", "notes_for_review")}
    if row is not None:
        return {"kind": "row", "weapon_id": row["weapon_id"], "row": row, "sim": sim}
    raise ValueError("a candidate is a weapons.json row, {weapon_id, changes}, {perk_id, changes} or {perk: row}")


def load_candidate(src) -> dict:
    """A path or a dict -> {"title", "entry", "with": [entries], "raw"}."""
    raw = json.loads(Path(src).read_text()) if not isinstance(src, dict) else src
    entry = normalise(raw)
    title = raw.get("title") or (entry.get("weapon_id") or entry.get("perk_id"))
    return {"title": title, "entry": entry, "with": [normalise(w) for w in raw.get("with") or []], "raw": raw}


def apply_entry(rows: list, perk_rows: list, entry: dict) -> tuple[list, list]:
    rows, perk_rows = copy.deepcopy(rows), copy.deepcopy(perk_rows)
    k = entry["kind"]
    if k == "diff":
        if not any(r["weapon_id"] == entry["weapon_id"] for r in rows):
            raise ValueError(f"diff on an unknown weapon {entry['weapon_id']!r}: send a full row for a new weapon")
        wid = entry["weapon_id"]
        before = _facts(WeaponCatalog(rows), wid)
        idx = next(i for i, r in enumerate(rows) if r["weapon_id"] == wid)
        # Every requested field on its own must move something the catalogue reads: a misspelt or unread
        # path, or a value equal to today's, is refused, never silently dropped.
        for path, value in entry["changes"].items():
            alone = copy.deepcopy(rows)
            B.set_field(alone[idx], path, value)
            try:
                moved = _facts(WeaponCatalog(alone), wid) != before
            except (KeyError, ValueError, TypeError, IndexError) as e:
                raise ValueError(f"{wid}: {path}={value!r} breaks the row: {e}") from e
            if not moved:
                raise ValueError(f"{wid}: {path}={value!r} moves nothing the catalogue reads (unread, misspelt, or "
                                 "already that value). Balance numbers live in wire.dmg, wire.tap_dmg, wire.fire_ms, "
                                 "wire.swap_ms, wire.headset_dmg, mag, reserve, reload_ms, reload_type.")
        for path, value in entry["changes"].items():
            B.set_field(rows[idx], path, value)
    elif k == "row":
        new = copy.deepcopy(entry["row"])
        idx = next((i for i, r in enumerate(rows) if r["weapon_id"] == new["weapon_id"]), None)
        if idx is None:
            rows.append(new)
        else:
            rows[idx] = new
        WeaponCatalog(rows).resolve(new["weapon_id"], 0)   # refuses a row the compiler cannot build
    elif k == "perk_diff":
        row = next((r for r in perk_rows if r["perk_id"] == entry["perk_id"]), None)
        if row is None:
            raise ValueError(f"perk diff on an unknown perk {entry['perk_id']!r}")
        for key, value in entry["changes"].items():
            if (row.get("effects") or {}).get(key) == value:
                raise ValueError(f"perk {entry['perk_id']}: {key}={value!r} is already that value")
        row.setdefault("effects", {}).update(entry["changes"])
    elif k == "perk_row":
        new = copy.deepcopy(entry["row"])
        idx = next((i for i, r in enumerate(perk_rows) if r["perk_id"] == new["perk_id"]), None)
        if idx is None:
            perk_rows.append(new)
        else:
            perk_rows[idx] = new
    PerkCatalog(perk_rows)   # refuses an unknown effect key
    return rows, perk_rows


def _world(rows, perk_rows, entries: list) -> World:
    styles = {}
    for e in entries:
        wid = e.get("weapon_id")
        if wid and e["sim"].get("style"):
            styles[wid] = e["sim"]["style"]
    return World(WeaponCatalog(rows), PerkCatalog(perk_rows), styles)


def shipped_world() -> World:
    """The catalogue as it ships, with no `with` context: the reference a `with` entry is judged against."""
    return _world(WeaponCatalog()._rows, PerkCatalog()._rows, [])


def build_worlds(cand: dict) -> tuple[World, World]:
    rows, perk_rows = WeaponCatalog()._rows, PerkCatalog()._rows
    for e in cand["with"]:
        rows, perk_rows = apply_entry(rows, perk_rows, e)
    base = _world(rows, perk_rows, cand["with"])
    rows2, perk_rows2 = apply_entry(rows, perk_rows, cand["entry"])
    return base, _world(rows2, perk_rows2, cand["with"] + [cand["entry"]])


# --------------------------------------------------------------------------- #
# The review
# --------------------------------------------------------------------------- #

def _test(passed, numbers: dict, why: str) -> dict:
    status = "n/a" if passed is None else ("pass" if passed else "fail")
    return {"status": status, "pass": passed, "numbers": numbers, "why": why}


def ttk_table(world: World, ids: list[str], scale: float) -> list[dict]:
    """Recoil and crit TTK columns: perfect aim against the recoil model (controlled bursts and full auto),
    and no-crit / expected / all-crit, at the 115 and 150 pools. Undefended target, no range fit."""
    reps = _reps("ttk", scale)
    out = []
    for wid in ids:
        k = make_kit(world, f"ttk:{wid}", wid)
        g = k.guns[0]
        dist = "close" if g.head_dmg else "mid"
        perfect = replace(k, name=k.name + ":perfect", guns=(replace(g, profile=None),), style="full")
        for pool in (115, 150):
            r = {"weapon": wid, "pool": pool, "htk": world.cat.hits_to_kill(wid, pool)}
            if g.crit:
                for tag, c in (("no_crit", 0), ("expected_crit", g.crit), ("all_crit", 100)):
                    kk = replace(perfect, name=perfect.name + f":crit{c}", guns=(replace(g, profile=None, crit=c),))
                    r[f"ttk_{tag}_ms"], r[f"rounds_{tag}"] = time_to_kill(kk, pool, 1.0, reps, dist=dist)
            else:
                r["ttk_perfect_ms"], r["rounds_perfect"] = time_to_kill(perfect, pool, 1.0, reps, dist=dist)
            if g.profile is not None and g.mode == "auto":
                for st in ("burst", "full"):
                    kk = replace(k, name=k.name + ":" + st, style=st)
                    r[f"ttk_recoil_{st}_ms"], r[f"rounds_recoil_{st}"] = time_to_kill(kk, pool, 1.0, reps, dist=dist)
            out.append(r)
    return out


def _git_sha() -> str:
    try:
        return subprocess.run(["git", "-C", str(REPO), "rev-parse", "--short", "HEAD"], capture_output=True,
                              text=True, timeout=10).stdout.strip() or "unknown"
    except (OSError, subprocess.SubprocessError):
        return "unknown"


def review(src, *, reps_scale: float = 1.0, n_jobs: int = 1) -> dict:
    """The whole review of one candidate. `reps_scale` is for tests only: same seeds, same code paths, fewer
    reps. A scaled verdict says so and `record()` refuses it."""
    cand = load_candidate(src)
    entry = cand["entry"]
    base, world = build_worlds(cand)
    is_perk = entry["kind"].startswith("perk")
    wid = None if is_perk else entry["weapon_id"]
    row = None if is_perk else world.cat._row(wid)
    role = None if is_perk else row.get("role")
    pickup = bool(row and row.get("pickup_only"))
    if row is not None and row.get("dot"):
        raise ValueError(f"{wid}: a DoT weapon. The kit engine has no tick (SCENARIO_VERSION {SCENARIO_VERSION}); "
                         "use balance_sim.py --sweep for it.")

    extra = [wid] if (wid and role == "sidearm") else []
    shipped = shipped_world()
    specs_b, perks_b, skipped = build_kits(base, reps_scale, n_jobs, anchor_world=base)
    specs_c, perks_c, _ = build_kits(world, reps_scale, n_jobs, extra, anchor_world=base)
    mb = dominance_matrix(base, specs_b, reps_scale, n_jobs, anchor_world=base)
    mc = dominance_matrix(world, specs_c, reps_scale, n_jobs, anchor_world=base)
    rules_s = run_rules(shipped, reps_scale, n_jobs)
    rules_b = run_rules(base, reps_scale, n_jobs)
    rules_c = run_rules(world, reps_scale, n_jobs)

    subject_kit = None
    if wid and not pickup:
        subject_kit = next((s.name for s in specs_c if s.primary == wid and not s.combo), None)
    tests = {}
    side = sidearm_r10(world, wid, reps_scale) if (role == "sidearm" and not pickup) else None

    # value_addition -------------------------------------------------------------------------------
    if is_perk:
        pid = entry["perk_id"]
        users = [k for k, p in perks_c["best"].items() if p == pid]
        others = set().union(*[set(world.fx(p)) for p in fieldable_perks(world.perks) if p != pid] or [set()])
        new_keys = sorted(set(world.fx(pid)) - others)
        tests["value_addition"] = _test(bool(users or new_keys), {"primaries_picking_it": users, "new_effect_keys": new_keys},
                                        "a perk adds value when at least one primary's best pick is it, or it brings an effect no other perk has")
    elif pickup:
        tests["value_addition"] = _test(None, {}, "pickup-only tier (rule 7): judged by op_rule and the pickup design, not the loadout matrix")
    else:
        others = [w for w in loadout_ids(world.cat) if w != wid]
        have = set().union(*[trigger_mechanics(world.cat, w) for w in others])
        new_mech = sorted(trigger_mechanics(world.cat, wid) - have)
        if role == "sidearm":
            fin = {w: sidearm_r10(world, w, reps_scale, duels=False)["finish_ms"]
                   for w in loadout_ids(world.cat) if world.cat._row(w).get("role") == "sidearm" and w != wid}
            fin[wid] = side["finish_ms"]
            best_other = min((v for w, v in fin.items() if w != wid), default=math.inf)
            ok_time = fin[wid] <= best_other * (1 + SIDEARM_VALUE_MARGIN)
            tests["value_addition"] = _test(bool(ok_time or new_mech),
                                            {"finish_ms": fin, "margin": SIDEARM_VALUE_MARGIN, "new_mechanics": new_mech},
                                            "a sidearm adds value when it finishes within 10% of the best sidearm, or brings a new trigger mechanic")
        else:
            near = mc["near_top"].get(subject_kit, []) if subject_kit else []
            tests["value_addition"] = _test(bool(near or new_mech),
                                            {"near_top_in": near, "new_mechanics": new_mech,
                                             "cells": mc["columns"].get(subject_kit), "top": mc["top"]},
                                            "near the top in at least one scenario, or a trigger mechanic the arsenal lacks")

    # no_domination ---------------------------------------------------------------------------------
    everywhere = [k for k in mc["kits"] if len(mc["near_top"][k]) == len(COLUMNS)]
    before = [k for k in mb["kits"] if len(mb["near_top"][k]) == len(COLUMNS)]
    tests["no_domination"] = _test(not everywhere, {"near_top_everywhere": everywhere, "baseline_near_top_everywhere": before,
                                                    "margin": NEAR_TOP_MARGIN},
                                   "no kit near the top (within the margin) in every scenario")

    # viable ------------------------------------------------------------------------------------------
    if is_perk:
        pid = entry["perk_id"]
        gains = {k: sc[pid] - sc["None"] for k, sc in perks_c["scores"].items() if pid in sc}
        tests["viable"] = _test(max(gains.values()) >= 0 if gains else None, {"score_minus_no_perk": gains},
                                "for at least one primary the perk is no worse than no perk" if gains
                                else "the kit engine does not model this perk's effects")
    elif pickup:
        tests["viable"] = _test(None, {}, "pickup-only tier (rule 7): no player spawns with it")
    elif role == "sidearm":
        tests["viable"] = _test(side["finish_ms"] < B.R10_FINISH_BAR_MS,
                                {"finish_ms": side["finish_ms"], "bar_ms": B.R10_FINISH_BAR_MS},
                                "a sidearm's job is to finish: 35 HP within the R10a bar")
    elif subject_kit is None:
        tests["viable"] = _test(None, {}, f"role {role!r} has no kit in the matrix")
    else:
        f = mc["columns"][subject_kit]["field"]
        beats = [o for o in mc["kits"] if o != subject_kit and
                 any(mc["duels"][f"standard|{d}|{subject_kit}|{o}"] > 0.5 for d in DIST)]
        tests["viable"] = _test(f >= VIABLE_FIELD_FLOOR and bool(beats),
                                {"field": f, "floor": VIABLE_FIELD_FLOOR, "beats_in_some_band": beats},
                                "field ratio (against the baseline AR) at or over the floor, and it beats at least one kit in some 1v1 band")

    # balance_kept ----------------------------------------------------------------------------------
    tests["balance_kept"] = balance_kept(rules_s, rules_b, rules_c, mb, mc, wid, side)

    # op_rule -------------------------------------------------------------------------------------------
    perk_in_play = is_perk or any(e["kind"].startswith("perk") for e in cand["with"])
    changed = ([] if is_perk else [wid]) + [e["weapon_id"] for e in cand["with"] if e.get("weapon_id")]
    scope = list(dict.fromkeys(changed + (loadout_ids(world.cat) if perk_in_play else [])))
    tests["op_rule"] = op_rule(shipped, base, world, scope, changed)

    # marksman_rush_counter -----------------------------------------------------------------------------
    rush_reps = _reps("rush", reps_scale)
    if role == "marksman" and not pickup:
        mk = make_kit(world, f"{_name(world, wid)} (plain)", wid)
        ar = make_kit(world, "AR (plain)", ANCHOR)
        ar_ba = make_kit(world, "AR+BA", ANCHOR, perk="body_armor") if world.perks.has("body_armor") else ar
        r, r_ba = run_cells([("rush", mk, ar, rush_reps), ("rush", mk, ar_ba, rush_reps)], n_jobs)
        tests["marksman_rush_counter"] = marksman_verdict(r, r_ba, mc["near_top"].get(subject_kit, []))
    else:
        tests["marksman_rush_counter"] = _test(None, {}, "not a marksman candidate")
    watch = marksman_watch(base, world, wid, rush_reps, n_jobs)

    ttk_ids = [w for w in roster_ids(world)[0]] + ([wid] if wid and wid not in roster_ids(world)[0] else [])
    verdict = {
        "tool": "balance_review", "scenario_version": SCENARIO_VERSION, "seed": SEED, "reps_scale": reps_scale,
        "date": datetime.date.today().isoformat(), "git_sha": _git_sha(), "fingerprint": fingerprint(),
        "dirty": tree_dirty(),
        "title": cand["title"], "candidate": cand["raw"], "subject": {"weapon_id": wid, "perk_id": entry.get("perk_id"),
                                                                      "kit": subject_kit, "role": role},
        "facts": ({"baseline": _facts(base.cat, wid) if wid in base.cat._by_id else None,
                   "candidate": _facts(world.cat, wid)} if wid else None),
        "sim_only_flags": {"styles": world.styles, "bolt_perk_exempt": _bolt_exempt_sim_only(world)},
        "tests": tests, "pass": all(t["pass"] is not False for t in tests.values()),
        "matrix": {"baseline": mb, "candidate": mc}, "perks": {"baseline": perks_b, "candidate": perks_c},
        "rules": {"shipped": rules_s, "baseline": rules_b, "candidate": rules_c}, "sidearm_r10": side,
        "marksman_watch": watch, "ttk": ttk_table(world, ttk_ids, reps_scale),
        "not_modelled": skipped, "assumptions": assumptions(),
    }
    return verdict


def balance_kept(rules_s: dict, rules_b: dict, rules_c: dict, mb: dict, mc: dict, subject: str | None,
                 side: dict | None = None) -> dict:
    """Rule cells fail when they pass in the shipped catalogue but fail in either world (this judges a `with`
    entry too), or pass in the baseline and fail in the candidate. A kit fails when, keyed by its weapon_id
    (or combo name), it had a near-top cell in the baseline and has none in the candidate."""
    flips = [k for k in rules_c if (rules_b[k]["pass"] and not rules_c[k]["pass"])
             or (rules_s[k]["pass"] and not (rules_b[k]["pass"] and rules_c[k]["pass"]))]
    already = [k for k in rules_s if not rules_s[k]["pass"]]
    by_key_c = {key: name for name, key in mc["keys"].items()}
    lost = [key for name, key in mb["keys"].items() if key != subject and mb["near_top"][name]
            and key in by_key_c and not mc["near_top"][by_key_c[key]]]
    nums = {"rule_flips": {k: {"shipped": rules_s[k]["value"], "baseline": rules_b[k]["value"],
                               "candidate": rules_c[k]["value"], "bar": rules_c[k]["bar"]} for k in flips},
            "already_failing_when_shipped": already, "kits_losing_last_near_top": lost}
    ok = not flips and not lost
    if side is not None:
        low = {k: v for k, v in side["r10b"].items()
               if v < (R10_PRIMARY_BAR if k.startswith("standard") else B.SHIELDS_BAR)}
        nums["r10b_primaries_beat_it"] = side["r10b"]
        nums["r10b_under_bar"] = low
        ok = ok and not low
    return _test(ok, nums, "no Balance rule cell flips to fail (against the shipped catalogue too), "
                           "and no other kit loses its last near-top cell")


def op_rule(shipped: World, base: World, world: World, scope: list[str], changed: list[str]) -> dict:
    """A changed or added row fails when it one-shots in either world. Any other row in scope (all loadout rows
    when a perk is in play) fails when it passes in the shipped catalogue but one-shots in either world."""
    op = op_check(world, scope)
    op_b = op_check(base, [w for w in scope if w in base.cat._by_id])
    op_s = op_check(shipped, [w for w in scope if w in shipped.cat._by_id])
    bad = []
    for w in scope:
        fails = not op[w]["pass"] or not op_b.get(w, {"pass": True})["pass"]
        if fails and (w in changed or op_s.get(w, {"pass": True})["pass"]):
            bad.append(w)
    return _test(not bad, {"checked": op, "failing": bad,
                           "already_one_shot_when_shipped": [w for w in op_s if not op_s[w]["pass"]]},
                 "no close or crit pull reaches the lowest pool a player can field on Standard or Shields, unless pickup-only")


def marksman_verdict(r: dict, r_ba: dict, near_cols: list) -> dict:
    """Tony 2026-10-17: strong until players learn to rush. Strong = peek-kill at or over MARKSMAN_STRONG_BAR
    AND the kit near the top in MARKSMAN_STRONG_COLUMN; counter = rush success at or over MARKSMAN_RUSH_BAR."""
    col_near = MARKSMAN_STRONG_COLUMN in near_cols
    strong = r["peek_kill"] >= MARKSMAN_STRONG_BAR and col_near
    counter = r["rush_success"] >= MARKSMAN_RUSH_BAR
    return _test(strong and counter, {
        "vs_plain_ar": r, "vs_ar_body_armor": r_ba, "strong_column": MARKSMAN_STRONG_COLUMN,
        "near_top_in_strong_column": col_near, "strong_ok": strong, "counter_ok": counter,
        "bars": {"strong": MARKSMAN_STRONG_BAR, "rush": MARKSMAN_RUSH_BAR}, "rush_start_m": RUSH_START_M},
        f"strong against non-rushers (peek-kill, and near the top in {MARKSMAN_STRONG_COLUMN!r}), beaten by rushers from 20 m")


def marksman_watch(base: World, world: World, subject: str | None, reps: int, n_jobs: int) -> dict:
    """The rush counter for every OTHER marksman row in both worlds (against each world's own AR), so a candidate
    that moves the Sniper's numbers without being a marksman (an AR change, a perk) shows it."""
    ids = [w for w in roster_ids(world)[0] if world.cat._row(w).get("role") == "marksman" and w != subject]
    jobs = []
    for w in ids:
        for wd in (base, world):
            jobs.append(("rush", make_kit(wd, f"{_name(wd, w)} (plain)", w), make_kit(wd, "AR (plain)", ANCHOR), reps))
    res = run_cells(jobs, n_jobs)
    out = {}
    for i, w in enumerate(ids):
        b, c = res[2 * i], res[2 * i + 1]
        out[w] = {"baseline": b, "candidate": c, "moved": b != c}
    return out


def sidearm_r10(world: World, wid: str, scale: float, duels: bool = True) -> dict:
    """R10 for a sidearm on balance_sim's own CI engine: R10a (`finish_time_batch`, median ms to finish 35 HP)
    and R10b (`r10_duel_batch`: each of `B.R10_PRIMARIES` against it, Standard and Shields). The USP and the
    Desert Eagle run as their own combatant kinds, so their numbers are the CI numbers; any other sidearm gets a
    combatant built from its row the way `_usp_combatant` is (single shot paced by the pull model)."""
    reps = _reps("rule", scale)
    kind, temp = wid, None
    if wid not in B.R10_SIDEARMS:
        cat, row = world.cat, world.cat._row(wid)
        mag, res, rel = cat._ammo(wid, None)
        dmg, fire, crit = cat.damage_per_pull(wid), float(cat.fire_ms(wid)), int(row.get("crit_pct") or 0)
        prof, semi = B.recoil_profile(row), cat._frame_int(wid, "mode") == B.SEMI_MODE

        def temp(t, m, band, rng):
            return B._ar_shots(t, dmg, fire, mag, res, float(rel), prof, m.aim_factor, rng=rng, crit_pct=crit,
                               pull_ms=m.pull_ms if semi else 0.0)
        kind = f"candidate:{wid}"
        B.RANGE_COMBATANTS[kind] = temp
    try:
        m = B.RecoilDuelModel.from_catalog(world.cat, health_preset="standard")
        out = {"finish_ms": B.finish_time_batch(m, kind, reps, SEED).median_ms, "r10b": {}}
        if duels:
            for preset in ("standard", "shields"):
                mp = m if preset == "standard" else B.RecoilDuelModel.from_catalog(world.cat, health_preset=preset)
                for p in B.R10_PRIMARIES:
                    out["r10b"][f"{preset}|{p}"] = B.r10_duel_batch(mp, p, kind, reps, SEED).win_rate
        return out
    finally:
        if temp is not None:
            B.RANGE_COMBATANTS.pop(kind, None)


def fingerprint() -> str:
    """A hash of everything a verdict depends on beside the seed: the assumptions, both sims, the compiler, the perk
    code and the two catalogue files."""
    h = hashlib.sha256(json.dumps(assumptions(), sort_keys=True, default=str).encode())
    data = Path(_compile_mod.__file__).resolve().parent     # the catalogue files the review actually read
    for f in (Path(B.__file__), Path(__file__), Path(_compile_mod.__file__), data / "perks.py",
              data / "weapons.json", data / "perks.json"):
        h.update(f.read_bytes())
    return h.hexdigest()[:16]


def tree_dirty() -> bool:
    """True when the checkout has uncommitted changes (the decision log itself excepted), or git cannot say."""
    try:
        out = subprocess.run(["git", "-C", str(REPO), "status", "--porcelain"], capture_output=True, text=True,
                             timeout=20)
    except (OSError, subprocess.SubprocessError):
        return True
    if out.returncode != 0:
        return True
    lines = [ln for ln in out.stdout.splitlines() if ln.strip() and not ln.endswith("docs/balance-decisions.md")]
    return bool(lines)


# --------------------------------------------------------------------------- #
# Reports and the decision record
# --------------------------------------------------------------------------- #

def _fmt(col: str, v: float) -> str:
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return "-"
    return f"{v:.2f}" if col in ("field", "ambush") else f"{v:.0%}"


def matrix_markdown(m: dict) -> str:
    lines = ["| kit | perk | " + " | ".join(COLUMNS) + " | near top |", "|" + "---|" * (len(COLUMNS) + 3)]
    for k in m["kits"]:
        cells = []
        for c in COLUMNS:
            s = _fmt(c, m["columns"][k][c])
            cells.append(f"**{s}**" if c in m["near_top"][k] else s)
        lines.append(f"| {k} | {m['specs'][k]['perk'] or '-'} | " + " | ".join(cells) + f" | {len(m['near_top'][k])} |")
    return "\n".join(lines)


def _num(v):
    if isinstance(v, float):
        return "inf" if math.isinf(v) else (round(v, 3) if abs(v) < 10 else round(v))
    return v


def _short(numbers: dict) -> str:
    keep = {}
    for k, v in numbers.items():
        if k in ("checked", "cells", "top", "margin", "bars"):
            continue
        if isinstance(v, dict):
            keep[k] = {kk: _num(vv) if not isinstance(vv, dict) else {a: _num(b) for a, b in vv.items()}
                       for kk, vv in v.items()}
        else:
            keep[k] = _num(v) if not isinstance(v, list) else v
    return json.dumps(keep, default=str)


def report_markdown(v: dict) -> str:
    t = v["tests"]
    out = [f"# Balance review: {v['title']}", "",
           f"Scenario version {v['scenario_version']}, seed {v['seed']}, git {v['git_sha']}, fingerprint "
           f"{v.get('fingerprint')}{' (dirty tree)' if v.get('dirty') else ''}, {v['date']}."
           + (f" **Reps scaled by {v['reps_scale']}: not a real verdict.**" if v["reps_scale"] != 1 else ""), "",
           f"**Verdict: {'PASS' if v['pass'] else 'FAIL'}**", "",
           "| test | result | numbers |", "|---|---|---|"]
    for name, r in t.items():
        out.append(f"| {name} | {r['status']} | {_short(r['numbers'])} |")
    out += ["", "## Candidate", "", "```json", json.dumps(v["candidate"], indent=1), "```", ""]
    if v["facts"]:
        fb, fc = v["facts"]["baseline"] or {}, v["facts"]["candidate"]
        out += ["| field | baseline | candidate |", "|---|---|---|"]
        for k in fc:
            if fb.get(k) != fc[k]:
                out.append(f"| {k} | {fb.get(k, '(new)')} | {fc[k]} |")
        out.append("")
    bolts = [w for w in ((v.get("facts") or {}).get("candidate") or {},) if w.get("reload_type") == "bolt"]
    if bolts:
        out += ["A bolt (`reload_type: \"bolt\"`): the ammo and reload perks do not act on it, as compile.py `_ammo` "
                "does after the Sniper bolt batch (brx2/sniper-bolt).", ""]
    op = t["op_rule"]["numbers"].get("checked") or {}
    if op:
        out += ["## One-shot check (op_rule)", "", "The gate uses the larger of the pull and the crit pull.", "",
                "| weapon | pull | crit pull | lowest pool std / shields / hardcore | gated |",
                "|---|---|---|---|---|"]
        for w, r in op.items():
            lp = r["lowest_pool"]
            out.append(f"| {w} | {r['pull']} | {r['crit_pull']} | {lp['standard']} / {lp['shields']} / {lp['hardcore']} | "
                       f"{'pickup-only' if r['pickup_only'] else ('ok' if r['pass'] else 'ONE-SHOTS')} |")
        out.append("")
    mr = t["marksman_rush_counter"]["numbers"]
    if mr:
        a, b = mr["vs_plain_ar"], mr["vs_ar_body_armor"]
        out += ["## Marksman rush counter", "",
                f"Against a plain AR: peek-kill {a['peek_kill']:.2f} (bar {MARKSMAN_STRONG_BAR}), near the top in "
                f"{mr['strong_column']!r}: {mr['near_top_in_strong_column']}; rush success from {RUSH_START_M:g} m {a['rush_success']:.2f} (bar {MARKSMAN_RUSH_BAR}). "
                f"Against an AR with Body Armor: peek-kill {b['peek_kill']:.2f}, rush success {b['rush_success']:.2f}.", ""]
    moved_m = {w: r for w, r in (v.get("marksman_watch") or {}).items() if r["moved"]}
    if moved_m:
        out += ["## Marksman numbers this candidate moves", "",
                "The candidate is not that marksman, but it moves its rush-counter numbers (against each world's AR):", ""]
        for w, r in moved_m.items():
            b, c = r["baseline"], r["candidate"]
            out.append(f"- {w}: peek-kill {b['peek_kill']:.2f} -> {c['peek_kill']:.2f}, rush success "
                       f"{b['rush_success']:.2f} -> {c['rush_success']:.2f}")
        out.append("")
    if v.get("sidearm_r10"):
        sr = v["sidearm_r10"]
        out += ["## Sidearm R10 (balance_sim's CI engine)", "", f"R10a finish: {_num(sr['finish_ms'])} ms "
                f"(bar {B.R10_FINISH_BAR_MS:g}). R10b, each primary's win rate against it: "
                + ", ".join(f"{k} {v2:.0%}" for k, v2 in sr["r10b"].items()), ""]
    out += ["## Dominance matrix, candidate world", "",
            "Bold = near the top (within the margin of the column's best). 1v1 columns are mean win rates against "
            "every other kit; field is the kill-rate ratio against AR carriers; ambush is P(kill both) + P(kill one or more).",
            "", matrix_markdown(v["matrix"]["candidate"]), "", "## Dominance matrix, baseline", "",
            matrix_markdown(v["matrix"]["baseline"]), ""]
    rs, rb, rc = v["rules"]["shipped"], v["rules"]["baseline"], v["rules"]["candidate"]
    moved = [k for k in rc if abs(rc[k]["value"] - rb[k]["value"]) > 1e-9 or abs(rc[k]["value"] - rs[k]["value"]) > 1e-9]
    out += ["## Balance rules", "",
            f"{sum(r['pass'] for r in rc.values())} of {len(rc)} rule cells pass in the candidate world "
            f"({sum(r['pass'] for r in rb.values())} in the baseline, {sum(r['pass'] for r in rs.values())} as shipped)."]
    if moved:
        out += ["", "| rule | shipped | baseline | candidate | bar | pass |", "|---|---|---|---|---|---|"]
        for k in moved:
            out.append(f"| {k} | {_num(rs[k]['value'])} | {_num(rb[k]['value'])} | {_num(rc[k]['value'])} | "
                       f"{_num(rc[k]['bar'])} | {rc[k]['pass']} |")
    else:
        out.append(" No rule cell moved: neither the candidate nor its context touches a weapon the rules read.")
    out += ["", "## Time to kill (perfect aim, recoil model, crits)", "",
            "| weapon | pool | htk | perfect | no crit | expected crit | all crit | recoil bursts | recoil full auto |",
            "|---|---|---|---|---|---|---|---|---|"]
    for r in v["ttk"]:
        def g(k):
            return _num(r[k]) if k in r else "-"
        out.append(f"| {r['weapon']} | {r['pool']} | {r['htk']} | {g('ttk_perfect_ms')} | {g('ttk_no_crit_ms')} | "
                   f"{g('ttk_expected_crit_ms')} | {g('ttk_all_crit_ms')} | {g('ttk_recoil_burst_ms')} | {g('ttk_recoil_full_ms')} |")
    sim_only = (v.get("sim_only_flags") or {}).get("bolt_perk_exempt") or []
    if sim_only:
        out += ["", f"**Sim only:** {', '.join(sim_only)} is exempted from the ammo and reload perks here, but the compiler on "
                    "this tree still scales it. Shipping this verdict needs the bolt compile change too."]
    out += ["", "## Invented assumptions", "", "```json", json.dumps(v["assumptions"], indent=1), "```"]
    if v["not_modelled"]:
        out += ["", "Not modelled: " + "; ".join(v["not_modelled"]) + "."]
    return "\n".join(out) + "\n"


DECISIONS = REPO / "docs" / "balance-decisions.md"


def record_guard(v: dict, call: str, *, dirty_now: bool | None = None, fingerprint_now: str | None = None) -> None:
    """Refuse to record a verdict that cannot be reproduced: a scaled run, no real call from Tony, a verdict made
    on a dirty tree, a tree dirty now, or source files that changed since the verdict (fingerprint)."""
    if v["reps_scale"] != 1:
        raise ValueError("refusing to record a verdict run with scaled reps")
    if not call or not call.strip() or call.strip().lower() == "pending":
        raise ValueError('refusing to record without Tony\'s call: pass --call "<his words>"')
    if v.get("dirty", True):
        raise ValueError("refusing to record: the verdict was made on a dirty tree (or says nothing); commit, then re-run")
    if (tree_dirty() if dirty_now is None else dirty_now):
        raise ValueError("refusing to record: the tree is dirty now")
    now = fingerprint() if fingerprint_now is None else fingerprint_now
    if v.get("fingerprint") != now:
        raise ValueError(f"refusing to record: the fingerprint moved ({v.get('fingerprint')} -> {now}); re-run the review")


def record(v: dict, call: str, path: Path = DECISIONS, command: str = "") -> str:
    """Append one decision section to the log, newest last. `main` runs `record_guard` first."""
    if v["reps_scale"] != 1:
        raise ValueError("refusing to record a verdict run with scaled reps")
    if not call or call.strip().lower() == "pending":
        raise ValueError("refusing to record without Tony's call")
    lines = [f"## {v['date']}: {v['title']}", "",
             f"- Verdict: **{'PASS' if v['pass'] else 'FAIL'}** (scenario version {v['scenario_version']}, seed {v['seed']}, "
             f"git `{v['git_sha']}`, fingerprint `{v.get('fingerprint')}`).",
             f"- Tony's call: {call}"]
    if command:
        lines.append(f"- Command: `{command}`")
    lines += ["", "| test | result | numbers |", "|---|---|---|"]
    for name, r in v["tests"].items():
        lines.append(f"| {name} | {r['status']} | {_short(r['numbers'])} |")
    lines += ["", "Candidate:", "", "```json", json.dumps(v["candidate"], indent=1), "```", ""]
    text = "\n".join(lines) + "\n"
    with open(path, "a", encoding="utf-8") as fh:
        fh.write(text)
    return text


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #

def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="balance_review.py", description=__doc__.split("\n\n")[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--candidate", help="a weapons.json row, {weapon_id, changes}, {perk_id, changes} "
                                         "or {perk: row}; optional title, sim and with keys")
    src.add_argument("--record-from", metavar="VERDICT", help="record an earlier --out verdict without re-running it")
    ap.add_argument("--out", help="write the verdict JSON here")
    ap.add_argument("--report", help="also write the markdown report here (it always goes to stdout)")
    ap.add_argument("--record", action="store_true",
                    help=f"append a decision section to {DECISIONS.relative_to(REPO)} (the only file it writes)")
    ap.add_argument("--call", default="", help="Tony's call, in his words; required by --record and --record-from")
    ap.add_argument("--jobs", type=int, default=min(4, os.cpu_count() or 1), help="worker processes (no effect on numbers)")
    ap.add_argument("--reps-scale", type=float, default=1.0, help=argparse.SUPPRESS)   # tests only
    return ap


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    if args.record_from:
        v = json.loads(Path(args.record_from).read_text())
        record_guard(v, args.call)
        record(v, args.call, DECISIONS, command=f"--record-from {Path(args.record_from).name}")
        return 0
    if args.record:
        # fail before a 90 s run, not after it
        if not args.call or args.call.strip().lower() == "pending":
            raise SystemExit('--record needs --call "<Tony\'s words>"')
    v = review(args.candidate, reps_scale=args.reps_scale, n_jobs=args.jobs)
    md = report_markdown(v)
    sys.stdout.write(md)
    if args.out:
        Path(args.out).write_text(json.dumps(v, indent=1, default=str))
    if args.report:
        Path(args.report).write_text(md)
    if args.record:
        record_guard(v, args.call)
        record(v, args.call, DECISIONS, command="python3 mcp/tools/balance_review.py --candidate " + args.candidate)
    return 0 if v["pass"] else 1


if __name__ == "__main__":
    sys.exit(main())
