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
runs the same versioned scenario list in both, and prints a verdict with eight named tests:

  value_addition         the candidate is near the top in at least one scenario, or it brings a trigger
                         mechanic the arsenal lacks (docs/weapon-design.md, trigger diversity).
  no_domination          no kit is near the top everywhere or in all priority columns, or exceeds
                         the field ratio ceiling.
  viable                 the candidate's plain primary field ratio clears `VIABLE_FIELD_FLOOR`, and its
                         kit beats another kit in a 1v1 band. A sidearm instead needs the R10a finish bar.
  balance_kept           no Balance rule (R1-R12, R10a, both presets) flips from pass to fail, and no
                         other kit loses its last near-top cell beyond sampling noise.
  op_rule                no non-pickup weapon one-shots the lowest pool a player can field on a gated
                         preset (rule 7: one-shot weapons are a pickup tier).
  marksman_rush_counter  marksman candidates only: strong against players who do not rush, beaten by
                         plain AR and AR with Body Armor rushes at 20 m (Tony, 2026-10-17).
  pickup_utility         pickup-only candidates: enough Standard kills per full stock and a prompt
                         undefended Standard first kill at REAL_AIM.
  heat_sensitivity       when heat is involved, no rule, last-cell, domination or pickup utility
                         failure appears in another cooling branch; only branch differences appear here.

An overall PASS requires a passing value test (value_addition, viable or pickup_utility).

Scenario version 12 models three catalogue heat cooling branches, Shields regeneration, secondary cover and finishing, Armour Piercing, Toxin Rifle
ticks, aim-scaled close melee finishes, field aim and density. It also reports 20 m and 30 m rushes,
close hill holds and contests, long hill overwatch, mid-range ammo stress with downtime-only incoming hits,
healing and a spawn-reserve pickup, and pistol
finishers after a dry primary. Haze runs in a separate optional report.
Ammo stress alone lets a Shotgun fire between shells. Bolt kits have no ammo stress score because
the down time rule measures bolt exposure instead of ammunition.
Semi fight rounds use t14 plus FIGHT_OVERSHOOT_MS. Compile's published ttk_ms uses the same field fit
(F576). Heat cooling while firing is unproven (F575).
The matrix reports REAL_AIM separately at close, mid and long range. Each matrix 1v1 column scores
the first kill within 10 s. Long contact uses 20 s. The field ratio
uses a 150 s kill-count match. `assumptions()` names every other scoring horizon. The Shields preset
regenerates its shield after 6.5 s without damage, in four grants one second apart.
The heat branches run only when the candidate affects a heated kit. They reuse unheated cells and rerun
heated matrix and rule cells only. A branch fails when a cell passes shipped or baseline under that
branch and fails in the candidate under the same branch. Standing shipped failures stay warnings.

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
- Stance, flinch and the node-local perks.
- Perk exemption is read from the row: `reload_type: "bolt"` ignores the ammo and reload perks, as
  compile.py `_ammo` does. The sim-only flag (`_bolt_exempt_sim_only`) fires only for a candidate bolt row
  on a tree whose compiler lacks that exemption; there the compiled bolt would still scale with the perks.
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
from brx_mcp.mc.compile import CHARGE_TAP_CADENCE_MS, FIGHT_OVERSHOOT_MS, HEALTH_PRESETS, PULL_SIGMA, WeaponCatalog  # noqa: E402
from brx_mcp.mc.perks import PerkCatalog  # noqa: E402
from brx_mcp.mc import compile as _compile_mod  # noqa: E402
from brx_mcp.mc.types import SHIELD_REGEN_DELAY_MS, SHIELD_REGEN_GRANTS, SHIELD_REGEN_STEP_MS  # noqa: E402

# --------------------------------------------------------------------------- #
# The versioned scenario list and every invented constant
# --------------------------------------------------------------------------- #

SCENARIO_VERSION = 15   # 15: a dry primary draws the secondary only when it finishes first (F601)
SEED = 7
# Rep counts per cell kind. Tests scale these down with `reps_scale`; a scaled verdict says so and is
# never recorded.
REPS = {"duel": 3000, "perk": 2000, "field": 600, "ambush": 3000, "peek": 3000, "rush": 3000,
        "rush_sweep": 1200, "aim_sweep": 120, "haze_sweep": 300,
        "ammo": 600,
        "ttk": 2000, "finish": 3000, "rule": 10000}
MIN_REPS = 4

AIM = 0.9                     # aim factor: hit chance = recoil accuracy x AIM x BAND_FIT, capped at 1
REAL_AIM = 0.4                # field fight hits per round: about 0.38 for a mid rifle at mid range
HAZE_BLIND_MS = 3000.0       # observed Haze blackout window
HAZE_BLIND_SWEEP_MS = (1000, 1500, 2000, 3000)
HAZE_WIN_BAR = 0.65           # about 0.65 against AR with Body Armor, from the critique
AIM_SWEEP = (0.33, 0.40, 0.48)  # observed in-fight aim interval
MELEE_SWING_MS = 150.0       # assumed time from the decision to the landed swing
MELEE_HIT_P = 0.9            # assumed close-range swing hit chance at aim 1
MELEE_REACH_M = 6.0          # assumed limit within the close band during a rush
PULL_MS = B.DEFAULT_PULL_MS   # mean trigger-pull gap (lognormal, PULL_SIGMA): ALT and the bolt lever
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
RUSH_SPEED_SWEEP = (2.5, 5.0, 8.0)
RUSH_MOVE_ACC = 0.5           # ... hits at half its normal chance while moving, full chance once close
RUSH_STARTS_M = (20.0, 30.0)  # the two reported rush starts; the verdict still gates at 20 m
RUSH_CAP_MS = 15_000.0
HILL_SECOND_ATTACKER_MS = 3500.0  # the second hill attacker enters this long after the first
HILL_ESCAPE_P = 0.0           # a holder who leaves the circle cannot count as holding it
FIELD_NS = (2, 4, 6, 8)       # team sizes for the field ratio (geometric mean over them)
FIELD_VENUE = "outdoor"
SECONDARY = "deagle"          # every plain kit carries this secondary
FULL_AUTO = frozenset({"smg", "suppressor", "energy_rifle"})   # automatics held down; the rest burst
ANCHOR = "assault_rifle"      # the plain kit every perk, field and ambush number is measured against
HILL_REFERENCES = (ANCHOR, "smg", "shotgun")  # the close-range KOTH attackers and contest opponents
AMMO_STRESS_GAP_MS = 1500.0  # the next AR arrives 1.5 s after the previous fight
AMMO_PICKUP_AFTER_KILLS = 4  # one AMMO pickup after the fourth kill
AMMO_STRESS_MAX_ATTACKERS = 128  # bound one life; report cap hits in the matrix
AMMO_STRESS_RANGE = "mid"  # all kits meet the attacker in the neutral band
AMMO_STRESS_ATTACKER_AIM = 0.2  # a streaking holder has twice the incoming AR's aim
AMMO_STRESS_DOWNTIME_ONLY = True  # the holder wins the exchange while able to fire; incoming rounds land only in down time
AMMO_STRESS_HEAL = True  # restore the holder's pool between fights, while ammo and heat persist
AMMO_STRESS_BAND_FIT = False  # mid-range ammo comparison does not penalise a kit's preferred band
AMMO_STRESS_ATTACKER_REACT_MS = 1000.0  # a ready holder gets the first exchange on a streak
AMMO_STRESS_FIGHT_CAP_MS = 120_000.0  # allow slow mid-range kits to finish a fight
PISTOL_FINISH_RANGE = "close"  # the chipped target is at close range
# Mixed kits that open with the first gun's big round and finish with the second (Tony 2026-10-17).
COMBO_KITS = (("CR+Sniper+BA", "charge_rifle", "sniper_rifle", "body_armor"),
              ("CR+Sniper+QS", "charge_rifle", "sniper_rifle", "quick_switch"))

COLUMNS = ("1v1 close", "1v1 mid", "1v1 long", "real aim close", "real aim mid", "real aim long", "long contact", "peek mid", "field", "ambush", "shields", "hill hold", "ammo stress")
# Near-top margin: a kit within this of the column's best is "near the top". The duel columns are win
# rates (a 5 point margin is about two standard errors of a 3000-rep cell averaged over ten opponents);
# the field ratio and the ambush score are noisier and wider, so 0.10. Ammo stress uses its 0.10
# as a relative ratio margin; the other columns use absolute margins.
NEAR_TOP_MARGIN = {"1v1 close": 0.05, "1v1 mid": 0.05, "1v1 long": 0.05, "long contact": 0.05,
                   "real aim close": 0.05, "real aim mid": 0.05, "real aim long": 0.05,
                   "peek mid": 0.05, "field": 0.10, "ambush": 0.10,
                   "shields": 0.05, "hill hold": 0.05, "ammo stress": 0.10}
# Viability checks a plain primary alone, so a sidearm or a perk cannot rescue a weak weapon. The 0.50 floor
# remains below every shipped primary in the version 2 field model.
VIABLE_FIELD_FLOOR = 0.50
MARKSMAN_STRONG_BAR = 0.50    # peek-kill rate against a player who does not rush
# The strong side also needs the marksman's kit near the top in this column. Pending brx1: it may move to
# "peek mid" (then peek-kill plus near the top at peek). A one-line switch; do not change it without Tony.
MARKSMAN_STRONG_COLUMN = "1v1 long"
MARKSMAN_RUSH_BAR = 0.50      # rush success against the same marksman from the 20 m start
SIDEARM_VALUE_MARGIN = 0.10   # a sidearm adds value when its finish time is within 10% of the best
PICKUP_STOCK_KILL_FLOOR = 1.00  # shipped minimum is about 1.62; leave about 0.62 kills of room
PICKUP_TTK_BAR_MS = 2500.0     # practical median against an undefended Standard target
PICKUP_STOCK_CAP_MS = 120_000.0
FIELD_RATIO_CEILING = 1.60      # Shipped max field ratio at full reps: 1.31946; no kit exceeded the ceiling.
DOMINATION_PRIORITY = ("1v1 close", "1v1 mid", "1v1 long", "field")  # No shipped kit neared the top in all four.
NOISE_Z = 2.0
R10_PRIMARY_BAR = 0.65        # a new sidearm: each of B.R10_PRIMARIES still beats it on Standard, as R10b (Shields: SHIELDS_BAR)
RULE_BAR_STANDARD = 0.65      # mirrors mcp/tests/test_balance_sim.py (RANGE_BAR_OVERRIDES)
RULE_BAR_OVERRIDES = {"R7": 0.55}
OP_GATED_PRESETS = ("standard", "shields")   # Hardcore is reported, never gated (one-shots are its point)
MODELLED_PERK_KEYS = frozenset({"max_armor_add", "ammo_mult", "ammo_mult_pistol", "reload_mult", "switch_mult", "armor_piercing"})


def assumptions(haze_blind_ms: float = HAZE_BLIND_MS, heat_cool_while_firing=True) -> dict:
    """Every invented number this verdict rests on, printed in every report."""
    return {
        "scenario_version": SCENARIO_VERSION, "seed": SEED, "reps": dict(REPS),
        "aim": AIM, "real_aim": REAL_AIM, "pull_ms_mean": PULL_MS, "pull_sigma": PULL_SIGMA,
        "fight_overshoot_ms": FIGHT_OVERSHOOT_MS,
        "fight_overshoot_fit": "lognormal median fitted to the USP, AMR and Deagle field median residuals",
        "compile_semi_ttk": "ordinary single-shot ttk_ms uses the fitted fight overshoot; the bolt keeps its pull model",
        "reload_swap": "a reload or lever vent progresses only in hand; a swap credits a finished reload and cancels an unfinished one",
        "revenge_seek": "a stale seek cannot replace an active engagement after respawn",
        "heat_cooling": heat_cool_while_firing,
        "heat_cooling_branches": list(B.HEAT_COOLING_BRANCHES),
        "heat_cooling_meanings": {"throughout": "catalogue cool_per_s between every shot",
                                  "after_lockout": "catalogue cool_per_s begins after the first completed lockout",
                                  "none": "no passive cooling; timed self lockout still resets heat"},
        "horizons": {"1v1 close": "10 s first kill", "1v1 mid": "10 s first kill",
                     "1v1 long": "10 s first kill", "real aim close": "10 s first kill",
                     "real aim mid": "10 s first kill", "real aim long": "10 s first kill",
                     "shields": "10 s first kill", "long contact": "20 s first kill",
                     "peek mid": "10 s first kill", "field": "150 s kill-count match",
                     "ambush": "10 s first kill against two enemies", "hill hold": "two first kills",
                     "ammo stress": "one life, up to 128 attackers and 120 s per fight",
                     "rush": "15 s first kill", "pistol finisher": "first kill from a dry primary",
                     "balance rules": "10 s first kill, except R2 charge-build and R10a finish time"},
        "shield_regen": {"quiet_ms": SHIELD_REGEN_DELAY_MS, "grants": SHIELD_REGEN_GRANTS,
                         "step_ms": SHIELD_REGEN_STEP_MS, "preset": "Shields only"},
        "haze_blind_ms": haze_blind_ms,
        "haze_blind_sweep_ms": list(HAZE_BLIND_SWEEP_MS), "haze_win_bar": HAZE_WIN_BAR,
        "aim_sweep": list(AIM_SWEEP), "rush_speed_sweep_m_s": list(RUSH_SPEED_SWEEP),
        "sweep_near_top_reference": "candidate matrix top at the standard 0.9 aim; only the subject kit is rerun",
        "melee": {"swing_ms": MELEE_SWING_MS, "hit_p_at_aim_1": MELEE_HIT_P,
                   "aim_scaling": "swing chance scales with aim and blindness",
                   "reach_m": MELEE_REACH_M},
        "bolt": "a 1-round single-shot magazine: lever = one pull gap, then reload_ms, then one pull gap",
        "reaction_ms": [REACTION_MEAN_MS, REACTION_SD_MS], "retarget_ms": RETARGET_MS,
        "controlled_burst_rounds": list(BURST_LEN), "burst_pause_ms": list(BURST_PAUSE_MS),
        "fight_cap_ms": FIGHT_CAP_MS, "band_fit": {k: list(v) for k, v in B.BAND_FIT.items()},
        "pickup_utility": {"stock_kill_floor": PICKUP_STOCK_KILL_FLOOR,
                            "median_ttk_bar_ms": PICKUP_TTK_BAR_MS, "stock_cap_ms": PICKUP_STOCK_CAP_MS,
                            "aim": REAL_AIM, "pool": "Standard", "range": "catalogue preferred band, mid by default",
                            "shipped_margin": "about 0.62 kills per stock and 900 ms at full repetitions"},
        "domination": {"field_ratio_ceiling": FIELD_RATIO_CEILING,
                       "shipped_field_max_approx": 1.32, "shipped_margin_approx": 0.28,
                       "priority_columns": list(DOMINATION_PRIORITY),
                       "priority_reason": "the three first-kill distance bands and 150 s field performance"},
        "near_top_noise_z": NOISE_Z,
        "near_top_noise": "a lost last cell counts only when its margin shortfall exceeds two standard errors; averaged binary cells use mean precision, field ratios use kill counts, and ambush and ammo use their own scales",
        "overall_value_requirement": "at least one of value_addition, viable or pickup_utility must pass",
        "long_contact": {"aim": LONG_CONTACT_AIM, "cap_ms": LONG_CONTACT_CAP_MS, "range": "mid"},
        "peek": {"window_ms": PEEK_WINDOW_MS, "react_ms": PEEK_REACT_MS, "p_escape": PEEK_P_ESCAPE},
        "ambush_react_ms": AMBUSH_REACT_MS,
        "rush": {"close_edge_m": CLOSE_EDGE_M, "mid_edge_m": MID_EDGE_M, "speed_m_s": RUSH_SPEED_MS,
                 "move_acc": RUSH_MOVE_ACC, "starts_m": list(RUSH_STARTS_M)},
        "hill": {"second_attacker_ms": HILL_SECOND_ATTACKER_MS, "references": list(HILL_REFERENCES),
                 "escape_p": HILL_ESCAPE_P, "range_hold_contest": "close", "range_overwatch": "long"},
        "ammo_stress": {"gap_ms": AMMO_STRESS_GAP_MS, "pickup_after_kills": AMMO_PICKUP_AFTER_KILLS,
                        "max_attackers": AMMO_STRESS_MAX_ATTACKERS, "holder_aim": REAL_AIM,
                        "attacker_aim": AMMO_STRESS_ATTACKER_AIM, "heal_between_fights": AMMO_STRESS_HEAL,
                        "downtime_only": AMMO_STRESS_DOWNTIME_ONLY,
                        "range": AMMO_STRESS_RANGE, "band_fit": AMMO_STRESS_BAND_FIT,
                        "attacker_react_ms": AMMO_STRESS_ATTACKER_REACT_MS,
                        "downtime_attacker_reaction_ms": [REACTION_MEAN_MS, REACTION_SD_MS],
                        "fight_cap_ms": AMMO_STRESS_FIGHT_CAP_MS,
                        "secondary_plan": "reload or vent the primary under fire; draw the secondary after the primary has no rounds",
                        "enemy_response": "the holder wins the exchange while able to fire; incoming AR rounds land only during reload, vent, heat lock, swap or dry down time",
                        "pickup": "once, top each held slot's reserve up to its compiled spawn reserve after a pending reload ends; leave magazines alone",
                        "chain_reload": "ammo stress only: credit each shell at its own interval; a loaded shell can interrupt the reload. Firing between shells is unproven on a gun",
                        "bolt_na": "a bolt's whole cycle is down time, so this column measures exposure instead of ammunition; bolt kits, including combos, are n/a"},
        "pistol_finisher": {"pool_hp": B.R10_FINISH_POOL_HP, "aim": AIM,
                            "range": PISTOL_FINISH_RANGE,
                            "pistol_time": "sampled R10a median, including misses and reaction, plus the kit swap",
                            "reload_time": "expected primary finish after reload and mean reaction"},
        "field": {"team_sizes": list(FIELD_NS), "venue": FIELD_VENUE, "anchor": ANCHOR,
                  "hit_probs": list(B.DEFAULT_HIT_PROBS), "contact_mean_s": B.SimConfig(pool=B.default_pool()).contact_mean_s,
                  "gap_mean_s": B.SimConfig(pool=B.default_pool()).gap_mean_s,
                  "respawn_seek_mean_s": B.SimConfig(pool=B.default_pool()).respawn_seek_mean_s},
        "charge_rifle": "starts every 1v1 and the ambush pre-charged, never recharges inside a fight",
        "kits": {"secondary": SECONDARY, "full_auto": sorted(FULL_AUTO), "combos": [list(c) for c in COMBO_KITS],
                 "perk": "each primary takes the best perk separately for Standard and Shields against the BASELINE plain AR"},
        "anchors": "the perk choice, the field ratio and the ambush always use the baseline world's AR",
        "near_top_margin": dict(NEAR_TOP_MARGIN), "viable_field_floor": VIABLE_FIELD_FLOOR,
        "marksman_bars": {"strong": MARKSMAN_STRONG_BAR, "strong_column": MARKSMAN_STRONG_COLUMN,
                          "rush": MARKSMAN_RUSH_BAR, "rush_start_m": RUSH_STARTS_M[0],
                          "rush_opponents": ["plain AR", "AR with Body Armor"]},
        "perk_exemption": "a row with reload_type 'bolt' ignores ammo_mult, ammo_mult_pistol and reload_mult",
        "rule_bars": {"standard": RULE_BAR_STANDARD, "overrides": dict(RULE_BAR_OVERRIDES),
                      "shields": B.SHIELDS_BAR, "r10a_ms": B.R10_FINISH_BAR_MS},
        "op_gated_presets": list(OP_GATED_PRESETS),
    }


def _reps(kind: str, scale: float) -> int:
    return max(MIN_REPS, int(round(REPS[kind] * scale)))


def bolt_gap(rng, reload_ms: float, pull_ms: float) -> float:
    """F581: one sampled bolt round. The lever pull, the bolt, then the first press after it (the renewal
    residual), as compile's `paced_cycle_ms` bolt branch and balance_sim's Match model it: about 2705 ms a
    round for the Sniper. At `pull_ms` 0 only the bolt runs."""
    if pull_ms <= 0:
        return float(reload_ms)
    # A bolt of 0 ms still waits for one press after the lever (`semi_interval` returns 0 for a 0 cycle).
    return pull_gap(rng, pull_ms) + B.semi_interval(rng, max(float(reload_ms), 1e-9), pull_ms)


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
    """Visible perks whose effects the kit engine models."""
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
    heat: tuple
    lethal: bool
    dot_per_tick: int
    dot_tick_ms: float
    dot_ticks: int
    sir_fn: int
    ap: bool = False


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
        mode = "bolt" if row.get("reload_type") == "bolt" else "semi"   # F581: as compile decides a bolt
    else:
        mode = "auto"    # a charge mode with no tap fires every t14, as `Match` does
    band = row.get("range_band") if row.get("range_band") in B.BAND_FIT else "mid"
    dot = row.get("dot") or {}
    if dot.get("stack") or dot.get("refresh") is False:
        raise ValueError(f"{wid}: unsupported damage over time rule")
    tick_ms = float(dot.get("tick_ms") or 1000)
    lethal = row.get("lethal") is not False
    return Gun(wid, cat.damage(wid) if lethal else 0,
               cat.damage_per_pull(wid) - cat.damage(wid) if lethal else 0, float(cat.fire_ms(wid)), mode,
               float(cat._frame_int(wid, "burst")) if mode == "burst" else 0.0, mag, res, float(rel),
               row.get("reload_type") == "chain", int(row.get("crit_pct") or 0), B.recoil_profile(row), band,
               tap, rpc, tuple(sorted((row.get("heat") or {}).items())), lethal,
               int(dot.get("per_tick") or 0), tick_ms, int((dot.get("duration_ms") or 0) // tick_ms),
               int(row.get("sir_fn") or 0))


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
    parts: tuple
    melee_dmg: int
    melee_ms: float

    def pool(self, preset: str) -> int:
        return dict(self.pools)[preset]

    def pool_parts(self, preset: str) -> tuple[int, int, int]:
        return dict(self.parts)[preset]


def _ammo_mods(world: World, wid: str, fx: dict) -> dict | None:
    # A bolt (`reload_type: "bolt"`) ignores the ammo and reload perks, as compile.py `_ammo` does (F573): the
    # compiled frame keeps the row's mag, reserve and reload_ms under every perk.
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
    if fx.get("armor_piercing"):
        row = cat._row(primary)
        if row.get("ap_dmg") is None or row.get("ap_fire_ms") is None:
            raise ValueError(f"{primary}: Armour Piercing needs ap_dmg and ap_fire_ms")
        g0 = replace(g0, gun_dmg=int(row["ap_dmg"]), head_dmg=0,
                     fire_ms=float(row["ap_fire_ms"]), ap=True)
    sw = {"switch_mult": fx["switch_mult"]} if "switch_mult" in fx else None
    guns, swap = (g0,), 0.0
    if secondary:
        guns = (g0, make_gun(cat, secondary, None))
        swap = float(max(cat.swap_ms(primary, sw), cat.swap_ms(secondary, sw)))
    parts = tuple((p, pool_parts(p, fx)) for p in ("standard", "shields"))
    pools = tuple((p, sum(v)) for p, v in parts)
    marks = cat._row(primary).get("role") == "marksman" or plan == "combo"
    melee_cat = cat if "melee" in cat._by_id else WeaponCatalog()
    return Kit(name, guns, swap, perk, plan, world.style(primary), pools, marks, parts,
               melee_cat.damage("melee"), float(melee_cat.fire_ms("melee")))


# --------------------------------------------------------------------------- #
# The kit fight engine (1v1, 1v2, peek, rush, time to kill)
# --------------------------------------------------------------------------- #

class _GunState:
    __slots__ = ("ammo", "reserve", "count", "state", "blen", "charged", "heat", "heat_t", "locked_until",
                 "vent_until", "ready_at", "reload_amount", "venting", "bolt_until", "pending_pickup",
                 "cooling_started", "vent_heat_after")

    def __init__(self, g: Gun, charged=True):
        self.ammo, self.reserve = g.mag, g.reserve
        self.count, self.state, self.blen = 0, "crisp", 0
        self.charged = charged
        self.heat, self.heat_t, self.locked_until, self.vent_until = 0.0, 0.0, 0.0, 0.0
        self.ready_at = 0.0
        self.reload_amount, self.venting = 0, False
        self.bolt_until, self.pending_pickup = 0.0, 0
        self.cooling_started = False
        self.vent_heat_after = 0.0


def _cools(mode, started=False):
    return mode is True or mode == "throughout" or (mode == "after_lockout" and started)


def _heat_seed(mode):
    """Preserve the former on/off random streams for the matching named branches."""
    branch = B.normalise_heat_cooling(mode)
    return "after_lockout" if branch == "after_lockout" else branch == "throughout"


def finish_estimate(g, *, pool, chance, ammo, reserve, reload_amount, ready_at, locked_until,
                    t, pull_ms, overshoot_ms, charged, count, dist, heat, heat_t,
                    heat_cool_while_firing, cooling_started=False):
    """Expected finish time for either kit engine, including reloads, heat and the first draw."""
    if not g.lethal or chance <= 0:
        return math.inf
    is_gun = isinstance(g, Gun)
    mode = g.mode if is_gun else ("bolt" if g.bolt else "charge" if g.charge_and_tap else
                                  "semi" if g.semi else "burst" if g.burst_gap_ms else "auto")
    rpc = g.rpc if is_gun else g.rounds_per_charge
    mag, reload_ms = g.mag, g.reload_ms
    chain = g.chain if is_gun else g.chain_reload
    fire_ms = g.fire_ms
    burst_gap = g.burst_gap if is_gun else g.burst_gap_ms
    tap = g.tap if is_gun else g.tap_dmg
    damage = (g.gun_dmg + (g.head_dmg if dist == 0 and not g.ap else 0)) if is_gun else g.pull_dmg
    heat_rule = dict(g.heat)
    # F576: `overshoot_ms` is the field fit's median; a round waits its lognormal mean, as the sampled fight and
    # compile's published cycle do
    overshoot_ms *= math.exp(PULL_SIGMA * PULL_SIGMA / 2)
    if mode == "charge" and charged and ammo + reload_amount >= rpc:
        ready_at = max(ready_at, t + fire_ms) if charged == "draw" else ready_at
    elapsed = max(0.0, ready_at - t)
    needs_lever_vent = locked_until == math.inf and heat_rule.get("vent") == "lever"
    if locked_until > t:
        elapsed = max(elapsed, locked_until - t if math.isfinite(locked_until) else pull_ms + reload_ms)
        if needs_lever_vent:
            elapsed = max(elapsed, B.vent_pulls(heat, heat_rule) * pull_ms + reload_ms)
            heat = max(0.0, heat - B.vent_pulls(heat, heat_rule) * heat_rule["vent_per_pull"])
        else:
            heat = 0.0
        cooling_started = True
        heat_t = t + elapsed
    ammo += reload_amount
    reserve -= reload_amount
    if needs_lever_vent:
        got = min(mag - ammo, reserve)
        ammo += got
        reserve -= got
    while ammo > 0 or reserve > 0:
        cost = rpc if mode == "charge" and charged else 1
        if ammo < cost:
            if ammo and mode == "charge":
                charged = False
                continue
            got = min(mag - ammo, reserve)
            if got <= 0:
                return math.inf
            ammo += got
            reserve -= got
            elapsed += reload_ms * got if chain else reload_ms
            continue
        dmg = damage if mode != "charge" or charged else tap
        if dmg <= 0:
            return math.inf
        if heat_rule and _cools(heat_cool_while_firing, cooling_started):
            heat = max(0.0, heat - max(0.0, t + elapsed - heat_t) *
                       float(heat_rule.get("cool_per_s", 0)) / 1000.0)
        fired_at = elapsed
        was_charged = mode == "charge" and charged
        ammo -= cost
        pool -= dmg * chance
        if pool <= 0:
            return elapsed
        if mode == "bolt":
            if reserve <= 0:
                return math.inf
            ammo += 1
            reserve -= 1
            # F581: compile's bolt cycle (`paced_cycle_ms`): one lever pull, the bolt, then the mean renewal
            # residual of the next press. It used to add a second full pull gap (about 95 ms a round slower).
            residual = pull_ms * math.exp(B.PULL_SIGMA * B.PULL_SIGMA) / 2
            elapsed += max(fire_ms + residual, pull_ms + reload_ms + residual)
        elif mode == "charge":
            charged = False
            elapsed += CHARGE_TAP_CADENCE_MS
        elif mode == "semi":
            elapsed += fire_ms + overshoot_ms
        elif mode == "burst":
            count += 1
            elapsed += burst_gap if count % 3 == 0 else fire_ms
        else:
            elapsed += fire_ms
        if heat_rule:
            heat += float(heat_rule.get("per_charge" if was_charged else "per_tap",
                                        heat_rule.get("per_shot", 0)))
            heat_t = t + fired_at
            if heat >= float(heat_rule["lock_at"]):
                if heat_rule["vent"] == "self":
                    elapsed = max(elapsed, fired_at + float(heat_rule["lockout_ms"]))
                    heat = 0.0
                else:
                    pulls = B.vent_pulls(heat, heat_rule)
                    elapsed = max(elapsed, fired_at + pulls * pull_ms + reload_ms)
                    heat = max(0.0, heat - pulls * heat_rule["vent_per_pull"])
                    got = min(mag - ammo, reserve)
                    ammo += got
                    reserve -= got
                cooling_started = True
                heat_t = t + elapsed
    return math.inf


class Fighter:
    """One player with a kit. Hit chance per round = recoil accuracy/100 x aim x BAND_FIT[band][distance],
    capped at 1. Damage = the gun word, plus the headset word at close. Shields refill after a quiet window."""

    def __init__(self, kit: Kit, pool: int, aim: float, dist: int, rng, fit=True, pull_ms=PULL_MS,
                 allow_melee=True, heat_cool_while_firing=True, persistent_reload=False):
        self.kit, self.aim, self.dist, self.rng, self.fit, self.pull_ms = kit, aim, dist, rng, fit, pull_ms
        self.allow_melee, self.heat_cool_while_firing = allow_melee, heat_cool_while_firing
        self.persistent_reload = persistent_reload
        self.health, self.armour, self.shield = pool if isinstance(pool, tuple) else (pool, 0, 0)
        self.shield_max = self.shield if self.armour == 0 else 0
        self.last_damage_t = 0.0
        self.shield_grants = 0
        self.blind_until = 0.0
        self.dot_next, self.dot_left, self.dot_dmg, self.dot_ms, self.dot_src = math.inf, 0, 0, 0.0, None
        self.last_effect = None
        self.melee_ready, self.melee_winding = 0.0, False
        self.dist_m = None
        self.peek_w = None          # exposure window (ms) around each own shot; None = always exposed
        self.last_shot_t = -math.inf
        self.swap_until = 0.0
        self.committed = False   # a drawn slot acts once (fires, reloads or waits) before the slot is reconsidered (F601)
        self.gs = [_GunState(g, charged=(i == 0)) for i, g in enumerate(kit.guns)]  # a slot not in hand holds no charge
        self.active, self.phase, self.next_t, self.alive = (1 if kit.plan == "haze" else 0), "open", 0.0, True
        self.targets: list = []
        self.kill_times: list = []
        self.shots = 0

    @property
    def pool(self):
        return self.health + self.armour + self.shield

    def advance_shield(self, t):
        """Apply the Shields preset's four one-second grants after 6.5 seconds without damage."""
        if not self.alive or self.shield_max <= 0 or self.shield >= self.shield_max:
            return
        first = self.last_damage_t + SHIELD_REGEN_DELAY_MS
        step = math.ceil(self.shield_max / SHIELD_REGEN_GRANTS)
        while self.shield_grants < SHIELD_REGEN_GRANTS and first + self.shield_grants * SHIELD_REGEN_STEP_MS <= t:
            self.shield = min(self.shield_max, self.shield + step)
            self.shield_grants += 1

    def receive(self, dmg, *, bypass=False, src=None, t=0.0, gun=None, haze_blind_ms=HAZE_BLIND_MS):
        self.advance_shield(t)
        if dmg > 0:
            self.last_damage_t, self.shield_grants = t, 0
        if bypass:
            self.health = max(0, self.health - dmg)
        else:
            take = min(self.shield, dmg)
            self.shield -= take
            dmg -= take
            take = min(self.armour, dmg)
            self.armour -= take
            dmg -= take
            self.health = max(0, self.health - dmg)
        if gun and gun.dot_ticks and gun.dot_per_tick:
            self.dot_next, self.dot_left = t + gun.dot_tick_ms, gun.dot_ticks
            self.dot_dmg, self.dot_ms, self.dot_src = gun.dot_per_tick, gun.dot_tick_ms, src
        if gun and gun.sir_fn == 23:
            self.blind_until = max(self.blind_until, t + haze_blind_ms)
        self.alive = self.health > 0
        return not self.alive

    def tick(self, t):
        if not self.alive or not self.dot_left or t != self.dot_next:
            return False
        self.advance_shield(t)
        self.last_damage_t, self.shield_grants = t, 0
        # Match._tick drains only the first non-empty layer on each tick.
        if self.shield:
            self.shield -= min(self.shield, self.dot_dmg)
        elif self.armour:
            self.armour -= min(self.armour, self.dot_dmg)
        else:
            self.health = max(0, self.health - self.dot_dmg)
        self.dot_left -= 1
        self.dot_next = t + self.dot_ms if self.dot_left else math.inf
        self.alive = self.health > 0
        if not self.alive and self.dot_src is not None:
            self.dot_src.kill_times.append(t)
        return not self.alive

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
            self.shots += 1
        return r

    def _swap(self, idx, t):
        old = self.gs[self.active]
        self._credit_reload(old, t)
        if old.reload_amount or old.venting:
            old.reload_amount, old.venting = 0, False
            old.vent_until = 0.0
            old.vent_heat_after = 0.0
            old.ready_at = min(old.ready_at, t)
            if old.pending_pickup:
                old.reserve = max(old.reserve, old.pending_pickup)
                old.pending_pickup = 0
        self.active = idx
        chosen = self.gs[idx]
        draw = t + self.kit.swap_ms
        self.swap_until = draw
        self.committed = True
        if self.kit.guns[idx].mode == "charge" and not chosen.charged:
            chosen.charged = True
            chosen.ready_at = max(chosen.ready_at, draw + self.kit.guns[idx].fire_ms)
        self.next_t = max(draw, chosen.ready_at)

    def _credit_reload(self, state, t):
        if state.reload_amount:
            gun = self.kit.guns[self.gs.index(state)]
            if gun.chain and self.persistent_reload:
                first = state.ready_at - (state.reload_amount - 1) * gun.reload_ms
                count = min(state.reload_amount, max(0, math.floor((t - first) / gun.reload_ms + 1e-9) + 1))
            else:
                count = state.reload_amount if t >= state.ready_at else 0
            if count:
                state.ammo += count
                state.reserve -= count
                state.reload_amount -= count
                if not state.reload_amount:
                    state.ready_at = t
                    if state.pending_pickup:
                        state.reserve = max(state.reserve, state.pending_pickup)
                        state.pending_pickup = 0
        if state.venting and t >= state.vent_until:
            state.heat = state.vent_heat_after
            state.locked_until = 0.0
            state.cooling_started = True
            state.venting, state.vent_until, state.vent_heat_after = False, 0.0, 0.0

    def _hit_chance(self, idx):
        g, s = self.kit.guns[idx], self.gs[idx]
        acc = B._accuracy_pct(g.profile, s.state) / 100.0 if g.profile and g.mode == "auto" else 1.0
        return min(1.0, acc * self.aim * (B.BAND_FIT[g.band][self.dist] if self.fit else 1.0))

    def _finish_ms(self, idx, target, t):
        g, s = self.kit.guns[idx], self.gs[idx]
        remaining = target.health if g.ap else target.pool
        charged = "draw" if g.mode == "charge" and idx != self.active and not s.charged else s.charged
        return finish_estimate(g, pool=remaining, chance=self._hit_chance(idx), ammo=s.ammo,
                               reserve=s.reserve, reload_amount=s.reload_amount, ready_at=s.ready_at,
                               locked_until=s.locked_until, t=t, pull_ms=self.pull_ms,
                               overshoot_ms=FIGHT_OVERSHOOT_MS if self.pull_ms > 0 else 0.0,
                               charged=charged, count=s.count, dist=self.dist, heat=s.heat,
                               heat_t=s.heat_t, heat_cool_while_firing=self.heat_cool_while_firing,
                               cooling_started=s.cooling_started)

    def _maybe_swap(self, t):
        if len(self.gs) < 2 or not self.kit.guns[1].lethal:
            return False
        target = self.target()
        if target is None:
            return False
        primary, secondary = self.kit.guns
        ps, ss = self.gs
        if self.persistent_reload:
            if self.active == 0 and ps.ammo == 0 and ps.reserve == 0 and not ps.reload_amount and \
                    (ss.ammo or ss.reserve):
                self._swap(1, t)
                return True
            if self.active == 1 and ss.ammo == 0 and ss.reserve == 0 and not ss.reload_amount and \
                    (ps.ammo or ps.reserve):
                self._swap(0, t)
                return True
            return False
        if self.kit.plan != "single":
            return False
        if self.active == 0:
            # A dry, reloading or locked primary draws the secondary only when the secondary still finishes
            # first after the swap (the same test as the way back), or when the primary cannot finish at all.
            # An unconditional draw ping-ponged: the way back counts the primary's reload, so a fast reload
            # (the Shotgun's chain, Quick Hands) swapped back to an empty primary, drew again at once, and fired
            # nothing all fight (F601).
            blocked = ps.ammo == 0 or ps.locked_until > t or ps.ready_at > t
            own = self._finish_ms(0, target, t)
            if ss.ammo and ((blocked and own == math.inf) or self.kit.swap_ms + self._finish_ms(1, target, t) < own):
                self._swap(1, t)
                return True
        elif (ss.ammo == 0 and (ps.ammo > 0 or ps.reserve > 0)) or \
                (ps.ready_at <= t and ps.locked_until <= t and
                 self.kit.swap_ms + self._finish_ms(0, target, t) < self._finish_ms(1, target, t)):
            self._swap(0, t)
            return True
        return False

    def _act(self, t):
        tgt = self.target()
        self._credit_reload(self.gs[self.active], t)
        if self.allow_melee and tgt and tgt.pool <= self.kit.melee_dmg and self.dist == 0 and \
                (self.dist_m is None or self.dist_m <= MELEE_REACH_M) and t >= self.melee_ready:
            if not self.melee_winding:
                self.melee_winding = True
                self.next_t = t + MELEE_SWING_MS
                return None
            self.melee_winding = False
            self.melee_ready = t + self.kit.melee_ms
            self.next_t = self.melee_ready
            self.last_effect = "melee"
            return self.kit.melee_dmg, MELEE_HIT_P * self.aim * (0.0 if t < self.blind_until else 1.0), False
        if self.committed:
            self.committed = False
        elif self._maybe_swap(t):
            return None
        g, s = self.kit.guns[self.active], self.gs[self.active]
        heat = dict(g.heat)
        if self.persistent_reload and g.chain and s.reload_amount and s.ammo:
            s.reload_amount = 0
            s.ready_at = t
            if s.pending_pickup:
                s.reserve = max(s.reserve, s.pending_pickup)
                s.pending_pickup = 0
        if t < s.ready_at:
            self.next_t = s.ready_at
            return None
        if s.reload_amount or s.venting:
            if s.reload_amount:
                s.ammo += s.reload_amount
                s.reserve -= s.reload_amount
            if s.venting:
                s.heat = s.vent_heat_after
                s.locked_until = 0.0
                s.cooling_started = True
            s.reload_amount, s.venting, s.vent_until, s.vent_heat_after = 0, False, 0.0, 0.0
        if heat:
            if t < s.vent_until:
                self.next_t = s.vent_until
                return None
            if s.locked_until == math.inf:
                s.reload_amount = min(g.mag - s.ammo, s.reserve)
                s.venting = True
                pulls = B.vent_pulls(s.heat, heat)
                s.vent_heat_after = max(0.0, s.heat - pulls * heat["vent_per_pull"])
                s.vent_until = t + sum(pull_gap(self.rng, self.pull_ms) for _ in range(pulls)) + g.reload_ms
                s.ready_at = s.vent_until
                self.next_t = s.ready_at
                return None
            if t < s.locked_until:
                self.next_t = s.locked_until
                return None
            if s.locked_until:
                s.heat, s.locked_until = 0.0, 0.0
                s.cooling_started = True
            if _cools(self.heat_cool_while_firing, s.cooling_started):
                s.heat = max(0.0, s.heat - (t - s.heat_t) * float(heat["cool_per_s"]) / 1000.0)
            s.heat_t = t
        cost = g.rpc if (g.mode == "charge" and s.charged) else 1
        if s.ammo < cost:
            if s.reserve <= 0:
                if g.mode == "charge" and s.ammo > 0:
                    s.charged = False
                    return self._act(t)
                self.next_t = math.inf
                return None
            got = min(g.mag - s.ammo, s.reserve)
            s.reload_amount = got
            s.count, s.state, s.blen = 0, "crisp", 0
            s.ready_at = t + (g.reload_ms * got if g.chain else g.reload_ms)
            self.next_t = t + g.reload_ms if g.chain and self.persistent_reload else s.ready_at
            return None
        acc = 1.0
        if g.profile is not None and g.mode == "auto":
            acc = B._accuracy_pct(g.profile, s.state) / 100.0
        fit = B.BAND_FIT[g.band][self.dist] if self.fit else 1.0
        hit_p = min(1.0, acc * self.aim * fit)
        if t < self.blind_until:
            hit_p = 0.0
        self.last_effect = g
        if g.mode == "charge":
            was = s.charged
            dmg = g.gun_dmg + g.head_dmg if was else g.tap
            s.ammo -= cost
            s.charged = False
            self.next_t = t + CHARGE_TAP_CADENCE_MS
            self._add_heat(g, s, t, was)
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
                iv = max(iv, bolt_gap(self.rng, g.reload_ms, self.pull_ms))
            self.next_t = t + iv
            s.bolt_until = self.next_t if s.ammo else 0.0
        elif g.mode == "semi":
            self.next_t = t + B.fight_semi_interval(self.rng, g.fire_ms)
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
        self._add_heat(g, s, t, False)
        if self.kit.plan == "haze" and g.sir_fn == 23:
            self._swap(0, t)
        return dmg, hit_p, (g.mode in ("bolt", "semi") and g.gun_dmg >= 50)

    def _add_heat(self, g, s, t, charged):
        heat = dict(g.heat)
        if not heat:
            return
        s.heat += float(heat.get("per_charge" if charged else "per_tap", heat.get("per_shot", 0)))
        if s.heat >= heat["lock_at"]:
            s.locked_until = t + heat["lockout_ms"] if heat["vent"] == "self" else math.inf

    def after(self, t, alpha: bool, killed: bool):
        """The plan step after a round. `alpha`: that round was the opener's big round."""
        if killed:
            s = self.gs[self.active]
            if s.state == "crisp":
                s.count = 0
            s.blen = 0
            self.next_t = max(self.next_t, t + RETARGET_MS)
            if self.persistent_reload and self.kit.plan == "combo":
                self.phase, self.active = "open", 0
                self.gs[0].charged = True
        if self.kit.plan == "combo" and self.phase == "open" and self.active == 0 and alpha and not killed \
                and len(self.kit.guns) > 1:
            alt = t + pull_gap(self.rng, self.pull_ms)    # the ALT press
            self.active, self.phase = 1, "finish"
            self.next_t = alt + self._semi(self.kit.swap_ms)
            self.swap_until = self.next_t


def exposed(f, t: float) -> bool:
    """A peeking fighter is exposed only within peek_w/2 of its last round or its next one."""
    w = f.peek_w
    if not w:
        return True
    h = w / 2.0
    return (t - f.last_shot_t) <= h or (f.next_t - t) <= h


def fight(rng, side_a: list, side_b: list, cap_ms=FIGHT_CAP_MS, alert=None, haze_blind_ms=HAZE_BLIND_MS,
          fire_during_reload=False, land_hit=None, on_step=None, stop_when=None):
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
        if stop_when and stop_when():
            break
        cands = [f for f in allf if f.alive and f.next_t <= cap_ms and f.target() is not None]
        ticks = [f for f in allf if f.alive and f.dot_next <= cap_ms]
        if not cands and not ticks:
            break
        if ticks and min(f.dot_next for f in ticks) <= min((f.next_t for f in cands), default=math.inf):
            f = min(ticks, key=lambda x: x.dot_next)
            f.tick(f.dot_next)
            continue
        f = min(cands, key=lambda x: x.next_t)
        t = f.next_t
        for contender in allf:
            contender.advance_shield(t)
        tgt = f.target()
        r = f.act(t)
        if r is None:
            if fire_during_reload and f in side_a and f.gs[f.active].reload_amount:
                for enemy in side_b:
                    if enemy.alive and enemy.next_t == math.inf:
                        enemy.next_t = t + _reaction(rng)
            if on_step:
                on_step(f, t)
            continue
        dmg, hp, alpha = r
        killed = False
        if (land_hit is None or land_hit(f, tgt, t)) and rng.random() < hp and exposed(tgt, t):
            effect = f.last_effect if isinstance(f.last_effect, Gun) else None
            killed = tgt.receive(dmg, bypass=bool(effect and effect.ap), src=f, t=t,
                                 gun=effect, haze_blind_ms=haze_blind_ms)
            if first_hit is None:
                first_hit = t
                for g in alert:
                    if g.alive and g.next_t == math.inf:
                        g.next_t = t + alert[g]
            if killed:
                f.kill_times.append(t)
        f.after(t, alpha, killed)
        if on_step:
            on_step(f, t)
    for contender in allf:
        contender.advance_shield(cap_ms)


DIST = {"close": 0, "mid": 1, "long": 2}


def _reaction(rng):
    return max(0.0, rng.gauss(REACTION_MEAN_MS, REACTION_SD_MS))


def duel_rate(kit_a: Kit, kit_b: Kit, dist: str, preset="standard", reps=3000, aim=AIM, cap_ms=FIGHT_CAP_MS,
              peek=False, haze_blind_ms=HAZE_BLIND_MS, heat_cool_while_firing=True) -> float:
    """Win rate of a over b in a 1v1 (a draw on equal pools is half). `peek`: a marksman kit peeks with
    PEEK_WINDOW_MS; a lone peeker opens at t=0 and the other side reacts from that shot."""
    pa = PEEK_WINDOW_MS if (peek and kit_a.marksman) else None
    pb = PEEK_WINDOW_MS if (peek and kit_b.marksman) else None
    rng = B.cell_rng(SEED, "kduel", kit_a.name, kit_b.name, dist, preset, aim, cap_ms, pa, pb,
                     haze_blind_ms, _heat_seed(heat_cool_while_firing))
    d = DIST[dist]
    wins = 0.0
    for _ in range(reps):
        a = Fighter(kit_a, kit_a.pool_parts(preset), aim, d, rng,
                    heat_cool_while_firing=heat_cool_while_firing)
        b = Fighter(kit_b, kit_b.pool_parts(preset), aim, d, rng,
                    heat_cool_while_firing=heat_cool_while_firing)
        a.next_t, b.next_t = _reaction(rng), _reaction(rng)
        a.peek_w, b.peek_w = pa, pb
        if pa and not pb:
            a.next_t = 0.0
        elif pb and not pa:
            b.next_t = 0.0
        fight(rng, [a], [b], cap_ms, haze_blind_ms=haze_blind_ms)
        if a.alive and not b.alive:
            wins += 1
        elif a.alive == b.alive:
            wins += 0.5 if a.pool == b.pool else (1.0 if a.pool > b.pool else 0.0)
    return wins / reps


def haze_report(world: World, reps: int, blind_ms: float = HAZE_BLIND_MS,
                heat_cool_while_firing=True) -> list[dict]:
    """The non-lethal Haze trial stays outside the primary dominance matrix."""
    plain = make_kit(world, "AR plain", ANCHOR, SECONDARY)
    haze = make_kit(world, "AR + Haze", ANCHOR, "smoke_gun", plan="haze")
    refs = ((ANCHOR, None), (ANCHOR, "body_armor"), ("shotgun", None), ("smg", None))
    out = []
    for wid, perk in refs:
        enemy = make_kit(world, f"{wid}|{perk}", wid, SECONDARY, perk=perk)
        for dist in ("close", "mid"):
            out.append({"opponent": enemy.name, "range": dist,
                        "plain": duel_rate(plain, enemy, dist, reps=reps,
                                           heat_cool_while_firing=heat_cool_while_firing),
                        "haze": duel_rate(haze, enemy, dist, reps=reps, haze_blind_ms=blind_ms,
                                          heat_cool_while_firing=heat_cool_while_firing)})
    return out


def haze_blind_sweep(world: World, reps: int, heat_cool_while_firing=True,
                     weapon_id: str = "smoke_gun") -> list[dict]:
    """AR plus Haze against AR plus Body Armor at mid range across blind windows."""
    haze = make_kit(world, "AR + Haze", ANCHOR, weapon_id, plan="haze")
    armoured = make_kit(world, "AR + Body Armor", ANCHOR, SECONDARY, perk="body_armor")
    return [{"blind_ms": ms,
             "win_vs_ar_body_armor": duel_rate(haze, armoured, "mid", reps=reps,
                                                haze_blind_ms=ms,
                                                heat_cool_while_firing=heat_cool_while_firing)}
            for ms in HAZE_BLIND_SWEEP_MS]


def haze_newly_selectable(baseline: World, candidate: World) -> bool:
    for row in candidate.cat._rows:
        if int(row.get("sir_fn") or 0) != 23 or row.get("hidden"):
            continue
        before = baseline.cat._by_id.get(row["weapon_id"])
        if before is None or before.get("hidden"):
            return True
    return False


def haze_gate(baseline: World, candidate: World, reps: int,
              heat_cool_while_firing=True) -> dict:
    """A selectable fn-23 row fails only when its blind sweep crosses the bar in the candidate."""
    def selectable(world):
        return {row["weapon_id"] for row in world.cat._rows
                if int(row.get("sir_fn") or 0) == 23 and not row.get("hidden")}

    candidate_ids = sorted(selectable(candidate))
    baseline_ids = selectable(baseline)
    rows, flips = [], []
    for wid in candidate_ids:
        after = haze_blind_sweep(candidate, reps, heat_cool_while_firing, weapon_id=wid)
        before = (haze_blind_sweep(baseline, reps, heat_cool_while_firing, weapon_id=wid)
                  if wid in baseline_ids else [])
        before_by_ms = {point["blind_ms"]: point["win_vs_ar_body_armor"] for point in before}
        for point in after:
            old = before_by_ms.get(point["blind_ms"])
            row = {"weapon_id": wid, "blind_ms": point["blind_ms"], "baseline": old,
                   "candidate": point["win_vs_ar_body_armor"], "bar": HAZE_WIN_BAR}
            rows.append(row)
            if point["win_vs_ar_body_armor"] > HAZE_WIN_BAR and (old is None or old <= HAZE_WIN_BAR):
                flips.append(row)
    shipped = shipped_world()
    standing = [{"weapon_id": wid, **point} for wid in sorted(selectable(shipped))
                for point in _shipped_haze_sweep(wid, reps, heat_cool_while_firing)
                if point["win_vs_ar_body_armor"] > HAZE_WIN_BAR]
    return {"rows": rows, "flips": flips, "fail": bool(flips),
            "standing_shipped_failures": standing}


def ambush(kit: Kit, enemy: Kit, dist: str, reps=3000, heat_cool_while_firing=True) -> tuple[float, float]:
    """1 shooter v 2 enemies idle until AMBUSH_REACT_MS after the first landed hit. (P kill both, P kill one+)."""
    rng = B.cell_rng(SEED, "ambush", kit.name, enemy.name, dist, AMBUSH_REACT_MS, _heat_seed(heat_cool_while_firing))
    d = DIST[dist]
    both = one = 0
    for _ in range(reps):
        s = Fighter(kit, kit.pool_parts("standard"), AIM, d, rng,
                    heat_cool_while_firing=heat_cool_while_firing)
        e1 = Fighter(enemy, enemy.pool_parts("standard"), AIM, d, rng,
                     heat_cool_while_firing=heat_cool_while_firing)
        e2 = Fighter(enemy, enemy.pool_parts("standard"), AIM, d, rng,
                     heat_cool_while_firing=heat_cool_while_firing)
        s.next_t = 0.0
        fight(rng, [s], [e1, e2], FIGHT_CAP_MS, alert={e1: AMBUSH_REACT_MS, e2: AMBUSH_REACT_MS})
        both += (not e1.alive and not e2.alive)
        one += bool(s.kill_times)
    return both / reps, one / reps


def peek_encounter(rng, m: Fighter, v: Fighter, escape_p=PEEK_P_ESCAPE):
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
        ticks = [f for f in (m, v) if f.alive and f.dot_next <= FIGHT_CAP_MS]
        tick_t = min((f.dot_next for f in ticks), default=math.inf)
        nxt = min(nxt, tick_t)
        if t_alert is not None and not alerted and t_alert <= nxt and t_alert <= FIGHT_CAP_MS:
            alerted = True
            if rng.random() < escape_p:
                escaped = True
                break
            v.next_t = t_alert
            continue
        if tick_t <= nxt and ticks:
            target = min(ticks, key=lambda x: x.dot_next)
            if target.tick(tick_t):
                break
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
            effect = f.last_effect if isinstance(f.last_effect, Gun) else None
            killed = tgt.receive(dmg, bypass=bool(effect and effect.ap), src=f, t=t, gun=effect)
            if f is m and t_alert is None:
                t_alert = t + PEEK_REACT_MS
            if killed:
                f.kill_times.append(t)
        f.after(t, alpha, killed)
        if killed:
            break
    return (m.alive and not v.alive), (not m.alive), escaped


def _band_of(dist_m: float) -> int:
    return 0 if dist_m < CLOSE_EDGE_M else (1 if dist_m < MID_EDGE_M else 2)


def rush_encounter(rng, m: Fighter, v: Fighter, start_m: float, speed_m_s=RUSH_SPEED_MS):
    """The peeking marksman `m` opens at t=0 from `start_m`. Its first shot (hit or miss) alerts `v`, which
    rushes PEEK_REACT_MS later at speed_m_s, firing on the move at RUSH_MOVE_ACC. At close range cover
    no longer protects m. (marksman_kill, rush_success)."""
    m.peek_w = PEEK_WINDOW_MS
    m.targets, v.targets = [v], [m]
    m.next_t, v.next_t = 0.0, math.inf
    t_rush = None

    def dist_at(t):
        return start_m if t_rush is None or t <= t_rush else max(0.0, start_m - speed_m_s * (t - t_rush) / 1000.0)

    while True:
        cands = [f for f in (m, v) if f.alive and f.next_t <= RUSH_CAP_MS and f.target() is not None]
        ticks = [f for f in (m, v) if f.alive and f.dot_next <= RUSH_CAP_MS]
        if not cands and not ticks:
            break
        if ticks and min(f.dot_next for f in ticks) <= min((f.next_t for f in cands), default=math.inf):
            target = min(ticks, key=lambda x: x.dot_next)
            target.tick(target.dot_next)
            continue
        f = min(cands, key=lambda x: x.next_t)
        t = f.next_t
        b = _band_of(dist_at(t))
        m.dist = v.dist = b
        m.dist_m = v.dist_m = dist_at(t)
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
            effect = f.last_effect if isinstance(f.last_effect, Gun) else None
            killed = tgt.receive(dmg, bypass=bool(effect and effect.ap), src=f, t=t, gun=effect)
            if killed:
                f.kill_times.append(t)
        if f is m and t_rush is None:
            t_rush = t + PEEK_REACT_MS
            v.next_t = t_rush
        f.after(t, alpha, killed)
        if killed:
            continue
    return (m.alive and not v.alive), (v.alive and not m.alive)


def marksman_rush_counter(kit_m: Kit, kit_v: Kit, reps: int, heat_cool_while_firing=True,
                          start_m=RUSH_STARTS_M[0], peek_result=None, speed_m_s=RUSH_SPEED_MS) -> dict:
    """Tony 2026-10-17: "sniper should feel strong until players recognize the strat to rush the sniper".
    peek_kill: the peek-kill rate at long range against a player who does not rush. rush_success: the rate
    a rusher from start_m kills the same peeking marksman."""
    if peek_result is None:
        rng = B.cell_rng(SEED, "peek", kit_m.name, kit_v.name, PEEK_WINDOW_MS, PEEK_REACT_MS,
                         PEEK_P_ESCAPE, _heat_seed(heat_cool_while_firing))
        k = dd = e = 0
        for _ in range(reps):
            m = Fighter(kit_m, kit_m.pool_parts("standard"), AIM, 2, rng,
                        heat_cool_while_firing=heat_cool_while_firing)
            v = Fighter(kit_v, kit_v.pool_parts("standard"), AIM, 2, rng,
                        heat_cool_while_firing=heat_cool_while_firing)
            a, b, c = peek_encounter(rng, m, v)
            k += a; dd += b; e += c  # noqa: E702
        peek_result = (k / reps, dd / reps, e / reps)
    rng = B.cell_rng(SEED, "rush", kit_m.name, kit_v.name, PEEK_WINDOW_MS, PEEK_REACT_MS,
                     start_m, _heat_seed(heat_cool_while_firing))
    mk = rs = 0
    for _ in range(reps):
        m = Fighter(kit_m, kit_m.pool_parts("standard"), AIM, 2, rng,
                    heat_cool_while_firing=heat_cool_while_firing)
        v = Fighter(kit_v, kit_v.pool_parts("standard"), AIM, 2, rng,
                    heat_cool_while_firing=heat_cool_while_firing)
        a, b = rush_encounter(rng, m, v, start_m, speed_m_s)
        mk += a; rs += b  # noqa: E702
    return {"peek_kill": peek_result[0], "peek_death": peek_result[1], "escape": peek_result[2],
            "rush_success": rs / reps, "marksman_beats_rusher": mk / reps}


def rush_speed_sweep(marksman: Kit, plain: Kit, armoured: Kit, reps: int,
                     heat_cool_while_firing=True, *, verdict_plain=None, verdict_armoured=None) -> list[dict]:
    """Only the subject marksman fights both declared rush opponents at 20 m."""
    return [{"speed_m_s": speed,
             "plain": verdict_plain if speed == RUSH_SPEED_MS and verdict_plain is not None else
                      marksman_rush_counter(marksman, plain, reps, heat_cool_while_firing,
                                            peek_result=(verdict_plain["peek_kill"], verdict_plain["peek_death"],
                                                         verdict_plain["escape"]) if verdict_plain else None,
                                            speed_m_s=speed),
             "body_armor": verdict_armoured if speed == RUSH_SPEED_MS and verdict_armoured is not None else
                           marksman_rush_counter(marksman, armoured, reps, heat_cool_while_firing,
                                                 peek_result=(verdict_armoured["peek_kill"],
                                                              verdict_armoured["peek_death"],
                                                              verdict_armoured["escape"]) if verdict_armoured else None,
                                                 speed_m_s=speed)}
            for speed in RUSH_SPEED_SWEEP]


def rush_sweep_flips(rows: list[dict], *, strong_ok: bool, verdict_pass: bool) -> bool:
    return any((strong_ok and row["plain"]["rush_success"] >= MARKSMAN_RUSH_BAR
                and row["body_armor"]["rush_success"] >= MARKSMAN_RUSH_BAR) != verdict_pass
               for row in rows)


def rush_table(world: World, specs: list[KitSpec], reps: int, n_jobs: int,
               heat_cool_while_firing=True) -> list[dict]:
    """Every marksman and combo kit against the three plain rushers at both starts."""
    pairs = []
    for spec in specs:
        if not (spec.combo or world.cat._row(spec.primary).get("role") == "marksman"):
            continue
        kit_name = spec.name if spec.combo else f"{spec.name} (plain)"
        marksman = make_kit(world, kit_name, spec.primary,
                            spec.secondary if spec.combo else None,
                            spec.perk if spec.combo else None,
                            "combo" if spec.combo else "single")
        for rusher_id in (ANCHOR, "smg", "shotgun"):
            rusher_name = "AR (plain)" if rusher_id == ANCHOR else f"{rusher_id} (plain)"
            pairs.append((spec.name, rusher_id, marksman, make_kit(world, rusher_name, rusher_id)))
    near_jobs = [("rush", m, r, reps, heat_cool_while_firing, RUSH_STARTS_M[0])
                 for _, _, m, r in pairs]
    near = run_cells(near_jobs, n_jobs)
    far_jobs = [("rush", m, r, reps, heat_cool_while_firing, RUSH_STARTS_M[1],
                 (v["peek_kill"], v["peek_death"], v["escape"]))
                for (_, _, m, r), v in zip(pairs, near)]
    far = run_cells(far_jobs, n_jobs)
    return [{"marksman": name, "rusher": rid, "start_m": start, **value}
            for (name, rid, _, _), near_v, far_v in zip(pairs, near, far)
            for start, value in zip(RUSH_STARTS_M, (near_v, far_v))]


def hill_hold(holder: Kit, attacker: Kit, reps: int, heat_cool_while_firing=True,
              second_attacker=True) -> float:
    """Chance that an alert, stationary holder kills two close attackers before dying."""
    rng = B.cell_rng(SEED, "hill_hold", holder.name, attacker.name, HILL_SECOND_ATTACKER_MS,
                     _heat_seed(heat_cool_while_firing))
    both = 0
    for _ in range(reps):
        h = Fighter(holder, holder.pool_parts("standard"), AIM, DIST["close"], rng,
                    heat_cool_while_firing=heat_cool_while_firing)
        e1 = Fighter(attacker, attacker.pool_parts("standard"), AIM, DIST["close"], rng,
                     heat_cool_while_firing=heat_cool_while_firing)
        e2 = Fighter(attacker, attacker.pool_parts("standard"), AIM, DIST["close"], rng,
                     heat_cool_while_firing=heat_cool_while_firing)
        h.next_t, e1.next_t = _reaction(rng), _reaction(rng)
        if not second_attacker:
            fight(rng, [h], [e1])
            both += h.alive and not e1.alive
            continue
        e2.next_t = HILL_SECOND_ATTACKER_MS + _reaction(rng)
        fight(rng, [h], [e1], cap_ms=HILL_SECOND_ATTACKER_MS)
        h.next_t = max(h.next_t, HILL_SECOND_ATTACKER_MS)
        if h.alive:
            fight(rng, [h], [e1, e2])
        both += h.alive and not e1.alive and not e2.alive
    return both / reps


def hill_overwatch(long_gun: Kit, holder: Kit, reps: int, heat_cool_while_firing=True) -> float:
    """Long-range peek kill when the holder cannot escape the circle."""
    rng = B.cell_rng(SEED, "hill_overwatch", long_gun.name, holder.name, HILL_ESCAPE_P,
                     _heat_seed(heat_cool_while_firing))
    kills = 0
    for _ in range(reps):
        m = Fighter(long_gun, long_gun.pool_parts("standard"), AIM, DIST["long"], rng,
                    heat_cool_while_firing=heat_cool_while_firing)
        h = Fighter(holder, holder.pool_parts("standard"), AIM, DIST["long"], rng,
                    heat_cool_while_firing=heat_cool_while_firing)
        kills += peek_encounter(rng, m, h, escape_p=HILL_ESCAPE_P)[0]
    return kills / reps


def hill_report(world: World, specs: list[KitSpec], reps: int, n_jobs: int,
                heat_cool_while_firing=True, anchor_world: World | None = None) -> dict:
    """Close hold and contest rows for all kits; long overwatch rows for marksmen, combos and the AR."""
    kits = {s.name: make_kit(world, s.name, s.primary, s.secondary, s.perk,
                             "combo" if s.combo else "single") for s in specs}
    aw = anchor_world or world
    refs = {r: make_kit(aw, f"{r} (plain)", r, SECONDARY) for r in HILL_REFERENCES}
    hold_jobs, contest_jobs, over_jobs = [], [], []
    overwatch_names = {s.name for s in specs if s.combo or world.cat._row(s.primary).get("role") == "marksman"
                       or s.primary == ANCHOR}
    for name, kit in kits.items():
        for ref, enemy in refs.items():
            hold_jobs.append(("hill_hold", kit, enemy, reps, heat_cool_while_firing))
            contest_jobs.append(("duel", kit, enemy, "close", "standard", AIM, FIGHT_CAP_MS, False,
                                 reps, heat_cool_while_firing))
        if name in overwatch_names:
            for ref, holder in refs.items():
                over_jobs.append(("hill_overwatch", kit, holder, reps, heat_cool_while_firing))
    pairs = [(n, r) for n in kits for r in HILL_REFERENCES]
    hold = [{"holder": n, "attacker": r, "kill_both": v}
            for (n, r), v in zip(pairs, run_cells(hold_jobs, n_jobs))]
    contest = [{"kit": n, "opponent": r, "win": v}
               for (n, r), v in zip(pairs, run_cells(contest_jobs, n_jobs))]
    over_pairs = [(n, r) for n in kits if n in overwatch_names for r in HILL_REFERENCES]
    overwatch = [{"long_gun": n, "holder": r, "peek_kill": v}
                 for (n, r), v in zip(over_pairs, run_cells(over_jobs, n_jobs))]
    return {"hold": hold, "contest": contest, "overwatch": overwatch}


def _ammo_pickup(holder: Fighter) -> None:
    """Top up each held reserve after its pending reload ends."""
    for gun, state in zip(holder.kit.guns, holder.gs):
        if state.reload_amount:
            state.pending_pickup = max(state.pending_pickup, gun.reserve)
        else:
            state.reserve = max(state.reserve, gun.reserve)


def ammo_stress(kit: Kit, attacker: Kit, reps: int, pickup=True,
                heat_cool_while_firing=True, report_caps=False, report_reasons=False):
    """Mean AR kills in one life. The pool heals; ammunition, reloads and heat persist."""
    rng = B.cell_rng(SEED, "ammo_stress", kit.name, attacker.name, AMMO_STRESS_GAP_MS,
                     AMMO_PICKUP_AFTER_KILLS, AMMO_STRESS_RANGE, AMMO_STRESS_ATTACKER_AIM,
                     AMMO_STRESS_HEAL, AMMO_STRESS_BAND_FIT, AMMO_STRESS_ATTACKER_REACT_MS,
                     AMMO_STRESS_FIGHT_CAP_MS, AMMO_STRESS_DOWNTIME_ONLY,
                     pickup, _heat_seed(heat_cool_while_firing))
    total = cap_hits = 0
    reasons = dict.fromkeys(("dry", "died_reloading", "died_heat_locked_or_venting",
                             "died_swapping", "cap"), 0)
    for _ in range(reps):
        holder = Fighter(kit, kit.pool_parts("standard"), REAL_AIM, DIST[AMMO_STRESS_RANGE], rng,
                         fit=AMMO_STRESS_BAND_FIT,
                         heat_cool_while_firing=heat_cool_while_firing, persistent_reload=True)
        arrival = 0.0
        end_reason = None

        def dry():
            return all(s.ammo + s.reserve + s.reload_amount == 0 for s in holder.gs)

        def downtime(t):
            state = holder.gs[holder.active]
            gun = kit.guns[holder.active]
            holder._credit_reload(state, t)
            if t < holder.swap_until:
                return "died_swapping"
            if state.locked_until > t or state.venting or state.vent_until > t:
                return "died_heat_locked_or_venting"
            if state.bolt_until > t or (state.reload_amount and (not gun.chain or not state.ammo)) or \
                    (state.ammo == 0 and state.reserve):
                return "died_reloading"
            if state.ammo == 0:
                return "died_swapping" if not dry() else "dry"
            return None

        for index in range(AMMO_STRESS_MAX_ATTACKERS):
            if dry():
                end_reason = "dry"
                break
            enemy = Fighter(attacker, attacker.pool_parts("standard"), AMMO_STRESS_ATTACKER_AIM,
                            DIST[AMMO_STRESS_RANGE], rng, fit=AMMO_STRESS_BAND_FIT,
                            heat_cool_while_firing=heat_cool_while_firing, persistent_reload=True)
            holder.next_t = max(holder.next_t, arrival)
            state = holder.gs[holder.active]
            holder._credit_reload(state, arrival)
            if kit.guns[holder.active].chain and state.reload_amount and state.ammo:
                holder.next_t = arrival
            under_fire = downtime(arrival) is not None
            enemy.next_t = arrival + _reaction(rng) if under_fire else math.inf
            before = len(holder.kill_times)
            alert = None if under_fire else {enemy: AMMO_STRESS_ATTACKER_REACT_MS}
            exposure = [None]

            def land_hit(shooter, target, t):
                if shooter is holder or not AMMO_STRESS_DOWNTIME_ONLY:
                    return True
                exposure[0] = downtime(t)
                return exposure[0] is not None

            def on_step(fighter, t):
                if fighter is holder and enemy.alive and enemy.next_t == math.inf and downtime(t):
                    enemy.next_t = t + _reaction(rng)

            fight(rng, [holder], [enemy], arrival + AMMO_STRESS_FIGHT_CAP_MS,
                  alert=alert, fire_during_reload=True, land_hit=land_hit,
                  on_step=on_step, stop_when=dry)
            if holder.alive and enemy.alive and any(s.ammo + s.reserve + s.reload_amount for s in holder.gs):
                raise ValueError(f"ammo stress fight cap hit after {AMMO_STRESS_FIGHT_CAP_MS:g} ms")
            if not holder.alive:
                end_reason = exposure[0]
                break
            if len(holder.kill_times) == before:
                if dry():
                    end_reason = "dry"
                break
            total += 1
            ended = holder.kill_times[-1]
            if AMMO_STRESS_HEAL:
                holder.health, holder.armour, holder.shield = kit.pool_parts("standard")
            if pickup and index + 1 == AMMO_PICKUP_AFTER_KILLS:
                _ammo_pickup(holder)
            if dry():
                end_reason = "dry"
                break
            state = holder.gs[holder.active]
            gun = kit.guns[holder.active]
            if state.ammo < gun.mag and state.reserve and not state.reload_amount:
                amount = min(gun.mag - state.ammo, state.reserve)
                state.reload_amount = amount
                state.ready_at = ended + (gun.reload_ms * amount if gun.chain else gun.reload_ms)
                holder.next_t = max(holder.next_t, ended + gun.reload_ms if gun.chain else state.ready_at)
            arrival = ended + AMMO_STRESS_GAP_MS
        else:
            cap_hits += 1
            end_reason = "cap"
        if end_reason is None:
            raise ValueError("ammo stress life ended without death, dry ammunition or cap")
        reasons[end_reason] += 1
    if cap_hits and not report_caps:
        raise ValueError(f"ammo stress attacker cap hit in {cap_hits}/{reps} reps")
    if report_reasons:
        return total / reps, cap_hits, reasons
    return (total / reps, cap_hits) if report_caps else total / reps


def pistol_finish_ms(gun: Gun, swap_ms: float, *, dry=False) -> float:
    """Expected finish from a dry click, including a swap or a primary reload."""
    chance = min(1.0, AIM * B.BAND_FIT[gun.band][DIST[PISTOL_FINISH_RANGE]])
    return REACTION_MEAN_MS + swap_ms + finish_estimate(
        gun, pool=B.R10_FINISH_POOL_HP, chance=chance,
        ammo=0 if dry else gun.mag, reserve=gun.reserve, reload_amount=0,
        ready_at=0.0, locked_until=0.0, t=0.0, pull_ms=PULL_MS,
        overshoot_ms=FIGHT_OVERSHOOT_MS, charged=not dry, count=0,
        dist=DIST[PISTOL_FINISH_RANGE], heat=0.0, heat_t=0.0, heat_cool_while_firing=True)


def pistol_finisher_report(world: World, scale: float = 1.0) -> list[dict]:
    """Every visible pistol as the secondary of every shipped primary at the R10a finish pool."""
    pistols = [r["weapon_id"] for r in world.cat._rows if r.get("role") == "sidearm"
               and not r.get("hidden") and r.get("lethal") is not False]
    model = B.RecoilDuelModel.from_catalog(world.cat, health_preset="standard")
    reps = _reps("finish", scale)
    sampled = {}
    for pistol in pistols:
        row = world.cat._row(pistol)
        if row.get("heat"):
            sampled[pistol] = time_to_kill(make_kit(world, f"r10:{pistol}", pistol),
                                           B.R10_FINISH_POOL_HP, AIM, reps, fit=False, reaction=True)[0]
            continue
        if pistol in B.R10_SIDEARMS:
            sampled[pistol] = B.finish_time_batch(model, pistol, reps, SEED).median_ms
            continue
        mag, reserve, reload_ms = world.cat._ammo(pistol, None)
        dmg = world.cat.damage_per_pull(pistol)
        fire_ms = float(world.cat.fire_ms(pistol))
        profile = B.recoil_profile(row)
        crit = int(row.get("crit_pct") or 0)
        semi = world.cat._frame_int(pistol, "mode") == B.SEMI_MODE

        def combatant(t, m, band, rng):
            return B._ar_shots(t, dmg, fire_ms, mag, reserve, float(reload_ms), profile,
                               m.aim_factor, rng=rng, crit_pct=crit, pull_ms=m.pull_ms if semi else 0.0,
                               overshoot_ms=m.fight_overshoot_ms)

        B.RANGE_COMBATANTS[pistol] = combatant
        try:
            sampled[pistol] = B.finish_time_batch(model, pistol, reps, SEED).median_ms
        finally:
            del B.RANGE_COMBATANTS[pistol]
    out = []
    for primary in roster_ids(world)[0]:
        for pistol in pistols:
            kit = make_kit(world, f"{primary}+{pistol}", primary, pistol)
            finish_ms = sampled[pistol] + kit.swap_ms
            reload_ms = pistol_finish_ms(kit.guns[0], 0.0, dry=True)
            out.append({"primary": primary, "pistol": pistol, "finish_ms": finish_ms,
                        "reload_finish_ms": reload_ms, "bar_ms": B.R10_FINISH_BAR_MS,
                        "beats_staying": finish_ms < reload_ms,
                        "under_bar": finish_ms < B.R10_FINISH_BAR_MS})
    return out


def time_to_kill(kit: Kit, pool: int, aim: float, reps: int, fit=False, reaction=False, dist="mid",
                 heat_cool_while_firing=True):
    """Undefended target, one fighter, from its first round (or a reaction delay) to the kill.
    (median ms, mean rounds fired). inf when it runs dry inside FIGHT_CAP_MS."""
    rng = B.cell_rng(SEED, "ttk", kit.name, pool, aim, fit, reaction, dist, _heat_seed(heat_cool_while_firing))
    d = DIST[dist]
    times, rounds = [], []
    for _ in range(reps):
        a = Fighter(kit, 1, aim, d, rng, fit=fit, allow_melee=False,
                    heat_cool_while_firing=heat_cool_while_firing)
        target = Fighter(kit, pool, 0, d, rng, fit=fit,
                         heat_cool_while_firing=heat_cool_while_firing)
        target.next_t = math.inf
        a.next_t = _reaction(rng) if reaction else 0.0
        fight(rng, [a], [target], FIGHT_CAP_MS)
        times.append(a.kill_times[0] if a.kill_times else math.inf)
        rounds.append(a.shots)
    times.sort()
    return times[len(times) // 2], sum(rounds) / len(rounds)


def pickup_utility(world: World, wid: str, scale: float,
                   heat_cool_while_firing=True) -> dict:
    """Count kills from one pickup's magazine and reserve, then check its first-kill median."""
    kit = make_kit(world, f"pickup {wid}", wid)
    gun = kit.guns[0]
    distance = tuple(DIST)[max(range(len(DIST)), key=lambda i: B.BAND_FIT[gun.band][i])]
    target_pool = HEALTH_PRESETS["standard"]
    reps = _reps("ttk", scale)
    rng = B.cell_rng(SEED, "pickup_stock", wid, distance, _heat_seed(heat_cool_while_firing))
    kills = 0
    for _ in range(reps):
        shooter = Fighter(kit, 1, REAL_AIM, DIST[distance], rng, fit=True,
                          allow_melee=False, heat_cool_while_firing=heat_cool_while_firing)
        for _stock in range(gun.mag + gun.reserve):
            target = Fighter(kit, target_pool, 0, DIST[distance], rng, fit=True,
                             heat_cool_while_firing=heat_cool_while_firing)
            target.next_t = math.inf
            fight(rng, [shooter], [target], shooter.next_t + PICKUP_STOCK_CAP_MS)
            if target.alive:
                break
            kills += 1
    median_ms, _ = time_to_kill(kit, target_pool, REAL_AIM, reps, fit=True, dist=distance,
                                heat_cool_while_firing=heat_cool_while_firing)
    stock_kills = kills / reps
    return _test(stock_kills >= PICKUP_STOCK_KILL_FLOOR and median_ms <= PICKUP_TTK_BAR_MS,
                 {"kills_per_stock": stock_kills, "stock_kill_floor": PICKUP_STOCK_KILL_FLOOR,
                  "median_ttk_ms": median_ms, "ttk_bar_ms": PICKUP_TTK_BAR_MS,
                  "stock_rounds": gun.mag + gun.reserve, "aim": REAL_AIM, "range": distance,
                  "pool": "Standard", "reps": reps},
                 "a pickup kills enough Standard targets per full stock and kills one promptly at realistic aim")


# --------------------------------------------------------------------------- #
# The field (team) sim with kits: balance_sim.Match plus a swap step and a combo policy
# --------------------------------------------------------------------------- #

class KitPlayer(B.Player):
    __slots__ = ("kit", "models", "stash", "active", "phase", "swap_until", "kpool", "dist", "combo", "ap", "committed")


@dataclass(frozen=True)
class FieldKit:
    name: str
    models: tuple       # WeaponModel(s), opener first
    swap_ms: float
    pool: B.Pool
    combo: bool
    ap: bool


def _wm(world: World, wid: str, fx: dict | None):
    m = B.weapon_model(world.cat, wid)
    mag, res, rel = world.cat._ammo(wid, _ammo_mods(world, wid, fx or {}))
    return replace(m, mag=mag, reserve=res, reload_ms=float(rel))


def field_kit(world: World, name: str, primary: str, secondary: str | None = None, perk: str | None = None,
              combo=False) -> FieldKit:
    fx = world.fx(perk)
    models, swap = (_wm(world, primary, fx),), 0.0
    ap = bool(fx.get("armor_piercing"))
    if ap:
        row = world.cat._row(primary)
        if row.get("ap_dmg") is None or row.get("ap_fire_ms") is None:
            raise ValueError(f"{primary}: Armour Piercing needs ap_dmg and ap_fire_ms")
        models = (replace(models[0], gun_dmg=int(row["ap_dmg"]), headset_dmg=0,
                          fire_ms=float(row["ap_fire_ms"])),)
    if secondary:
        models += (_wm(world, secondary, None),)
        sw = {"switch_mult": fx["switch_mult"]} if "switch_mult" in fx else None
        swap = float(max(world.cat.swap_ms(primary, sw), world.cat.swap_ms(secondary, sw)))
    hp, arm, sh = pool_parts("standard", fx)
    return FieldKit(name, models, swap, B.Pool(hp, arm, sh, B.default_pool().respawn_ms),
                    combo and secondary is not None, ap)


class KitMatch(B.Match):
    def _seek(self, p, t, _gen=0):
        if not p.alive or p.target is not None:
            return
        enemies = [q for q in self.players if q.team != p.team and q.alive]
        if not enemies:
            self.push(t + 200.0, self.SEEK, p.pid)
            return
        targeted = [q for q in enemies if q.attackers > 0]
        preferred = self.players[_gen - 1] if 0 < _gen <= len(self.players) else None
        if preferred is not None and preferred in enemies:
            target = preferred
        else:
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

    def _swap_to(self, p, idx, t_end):
        # A lever or reload stops when its gun leaves the hand. Keep heat and shot clocks per slot.
        self._finish_reload(p, t_end - p.kit.swap_ms)
        if dict(p.w.heat).get("vent") == "lever" and p.heat_lock_until > t_end - p.kit.swap_ms:
            p.heat_lock_until = math.inf
        p.reload_until, p.reload_amount = -1.0, 0
        p.stash[p.active] = (p.ammo, p.reserve, p.reload_until, p.heat, p.last_heat_ms,
                             p.heat_lock_until, p.next_ready, p.last_pull, p.burst_i, p.reload_amount,
                             p.heat_has_locked)
        p.active = idx
        if len(p.stash[idx]) == 10:
            p.stash[idx] += (False,)
        (p.ammo, p.reserve, p.reload_until, p.heat, p.last_heat_ms, p.heat_lock_until,
         p.next_ready, p.last_pull, p.burst_i, p.reload_amount, p.heat_has_locked) = p.stash[idx]
        p.w = p.models[idx]
        p.swap_until = t_end
        p.committed = True       # the drawn slot acts once before the slot is reconsidered (F601)
        if p.w.charge_and_tap:
            p.last_pull = t_end
            p.next_ready = max(p.next_ready, t_end + p.w.fire_ms)
        p.hit_p = min(1.0, self.base_p * B.hit_multiplier(p.w, p.dist, self.cfg))

    def _finish_ms(self, p, idx, t, pool):
        w = p.models[idx]
        if p.ap and idx == 0:
            pool = self.players[p.target].health
        stashed = p.stash[idx]
        if len(stashed) == 10:
            stashed += (False,)
        ammo, reserve, reload_until, _heat, _heat_t, lock_until, next_ready, last_pull, burst_i, reload_amount, cooling_started = (
            (p.ammo, p.reserve, p.reload_until, p.heat, p.last_heat_ms, p.heat_lock_until,
             p.next_ready, p.last_pull, p.burst_i, p.reload_amount, p.heat_has_locked)
             if idx == p.active else stashed)
        chance = min(1.0, self.base_p * B.hit_multiplier(w, p.dist, self.cfg))
        charged = ("draw" if idx != p.active else last_pull + w.fire_ms <= t) if w.charge_and_tap else False
        return finish_estimate(w, pool=pool, chance=chance, ammo=ammo, reserve=reserve,
                               reload_amount=reload_amount, ready_at=max(reload_until, next_ready),
                               locked_until=lock_until if w.heat else -1.0, t=t,
                               pull_ms=self.cfg.pull_ms,
                               overshoot_ms=self.cfg.fight_overshoot_ms if self.cfg.pull_ms > 0 else 0.0,
                               charged=charged, count=burst_i, dist=p.dist, heat=_heat,
                               heat_t=_heat_t, heat_cool_while_firing=self.cfg.effective_heat_cooling,
                               cooling_started=cooling_started)

    def _choose_slot(self, p, t):
        self._finish_reload(p, t)
        if p.combo or len(p.models) < 2 or p.target is None:
            return p.active
        target = self.players[p.target]
        pool = target.health + target.armour + target.shield
        other = 1 - p.active
        if not p.models[other].lethal:
            return p.active
        current = self._finish_ms(p, p.active, t, pool)
        alternative = self._finish_ms(p, other, t, pool) + p.kit.swap_ms
        # F601, as in Fighter._maybe_swap: a dry or locked primary draws the secondary only when the secondary
        # finishes first, or when the primary cannot finish; an unconditional draw ping-ponged with the way back.
        if p.active == 0 and (p.ammo <= 0 or p.w.heat and p.heat_lock_until > t) and p.stash[1][0] > 0 and \
                current == math.inf:
            return 1
        if p.active == 1 and p.ammo <= 0 and alternative < math.inf:
            return 0
        return other if alternative < current else p.active

    def _hit(self, src, tgt, dmg, t):
        if src.ap and src.active == 0:
            tgt.health -= min(tgt.health, dmg)
            if tgt.health <= 0:
                self._death(tgt, src, t, dot=False)
            return
        super()._hit(src, tgt, dmg, t)

    def _tactical_reload(self, p, t):
        if p.combo and p.active != 0:
            end = t + p.kit.swap_ms
            self._swap_to(p, 0, end)
            p.last_pull = end      # the charge builds only once the opener is back in hand
            p.next_ready = max(p.next_ready, end)
            t = end
        super()._tactical_reload(p, t)

    def _shot(self, p, t, gen):
        if not p.alive or p.engage_id != gen or p.target is None or t > p.contact_end:
            return
        if t < p.next_ready:
            self.push(p.next_ready, self.SHOT, p.pid, gen)
            return
        if t < p.swap_until:
            self.push(p.swap_until, self.SHOT, p.pid, gen)
            return
        if p.heat_lock_until == math.inf and dict(p.w.heat).get("vent") == "lever":
            lever = t + pull_gap(self.rng, self.cfg.pull_ms)
            self._start_reload(p, lever)
            p.heat_lock_until = max(lever + p.w.reload_ms, p.reload_until)
        if p.committed:
            p.committed = False
            self._finish_reload(p, t)
            idx = p.active
        else:
            idx = self._choose_slot(p, t)
        if idx != p.active:
            self._swap_to(p, idx, t + p.kit.swap_ms)
            first = max(p.swap_until, p.next_ready, p.reload_until)
            if first <= p.contact_end:
                self.push(first, self.SHOT, p.pid, gen)
            return
        if not p.combo:
            super()._shot(p, t, gen)
            if p.alive and p.engage_id == gen and p.target is not None and self.players[p.target].alive:
                idx = self._choose_slot(p, t)
                if idx != p.active:
                    self.heap = [e for e in self.heap if not (e[2] == self.SHOT and e[3] == p.pid and
                                                               e[4] == gen and e[0] >= t)]
                    B.heapq.heapify(self.heap)
                    self._swap_to(p, idx, t + p.kit.swap_ms)
                    first = max(p.swap_until, p.next_ready, p.reload_until)
                    if first <= p.contact_end:
                        self.push(first, self.SHOT, p.pid, gen)
            return
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
            first = max(alt + B.semi_interval(self.rng, p.kit.swap_ms, self.cfg.pull_ms),
                        p.reload_until, p.next_ready)
            if first <= p.contact_end:
                self.push(first, self.SHOT, p.pid, gen)

    def _respawn(self, p, t, _gen=0):
        pool = p.kpool
        p.alive = True
        p.committed = False
        p.shield, p.armour, p.health = pool.shield, pool.armour, pool.health
        if len(p.models) > 1:
            p.stash = [(m.mag, m.reserve, -1.0, 0.0, t, -1.0, 0.0, -1e9, 0, 0, False) for m in p.models]
            p.active = 0
            p.w = p.models[0]
            p.swap_until = 0.0
        p.ammo, p.reserve = p.w.mag, p.w.reserve
        p.reload_until = -1.0
        p.reload_amount = 0
        p.next_ready = t
        p.heat, p.last_heat_ms, p.heat_lock_until = 0.0, t, -1.0
        p.heat_has_locked = False
        p.poison_gen += 1
        p.poison_left = 0
        delay = self.rng.expovariate(1.0 / self.cfg.respawn_seek_mean_s) * 1000.0 if self.cfg.respawn_seek_mean_s > 0 else 0.0
        self.push(t + delay, self.SEEK, p.pid)


def _kit_player(pid, team, fk: FieldKit):
    p = KitPlayer(pid, team, fk.models[0], fk.pool)
    p.kit, p.models, p.kpool, p.combo, p.ap = fk, fk.models, fk.pool, fk.combo, fk.ap
    p.stash = [(m.mag, m.reserve, -1.0, 0.0, 0.0, -1.0, 0.0, -1e9, 0, 0, False) for m in fk.models]
    p.active, p.phase, p.swap_until, p.dist, p.committed = 0, "open", 0.0, 1, False
    return p


def field_ratio(test: FieldKit, anchor: FieldKit, n: int, reps: int, heat_cool_while_firing=True,
                report_counts=False) -> float | tuple[float, int, int]:
    """Kill-rate ratio (test carriers / anchor carriers), one test carrier a side, team size n."""
    cfg = B.SimConfig(pool=B.default_pool(), venue=FIELD_VENUE,
                      heat_cool_while_firing=heat_cool_while_firing)
    rng = B.cell_rng(SEED, "kfield", test.name, anchor.name, n, _heat_seed(heat_cool_while_firing))
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
    ratio = (kt / mins_t) / (ka / mins_a) if ka else float("nan")
    return (ratio, kt, ka) if report_counts else ratio


# --------------------------------------------------------------------------- #
# Cell jobs, a memo cache and the optional process pool
# --------------------------------------------------------------------------- #

_CACHE: dict = {}
_SHIPPED_HAZE_CACHE: dict = {}


def _shipped_haze_sweep(wid: str, reps: int, heat_cool_while_firing=True) -> list[dict]:
    # F582: keyed on the whole shipped catalogue and perks, because the sweep also fights the AR, the secondary and
    # Body Armor; a change to any of them must not return a stale sweep.
    shipped = shipped_world()
    content = json.dumps([shipped.cat._rows, shipped.perks._rows], sort_keys=True, default=str)
    key = (wid, reps, heat_cool_while_firing, haze_blind_sweep, content)
    if key not in _SHIPPED_HAZE_CACHE:
        _SHIPPED_HAZE_CACHE[key] = haze_blind_sweep(shipped, reps, heat_cool_while_firing, weapon_id=wid)
    return _SHIPPED_HAZE_CACHE[key]


def clear_cache() -> None:
    _CACHE.clear()
    _SHIPPED_HAZE_CACHE.clear()


def _run_cell(job):
    kind = job[0]
    if kind == "duel":
        _, a, b, dist, preset, aim, cap, peek, reps, *heat = job
        return duel_rate(a, b, dist, preset, reps, aim, cap, peek,
                         heat_cool_while_firing=heat[0] if heat else True)
    if kind == "field":
        _, fk, anchor, n, reps, *heat = job
        return field_ratio(fk, anchor, n, reps, heat[0] if heat else True, report_counts=True)
    if kind == "ambush":
        _, k, enemy, dist, reps, *heat = job
        return ambush(k, enemy, dist, reps, heat[0] if heat else True)
    if kind == "rule":
        return _run_rule(*job[1:])
    if kind == "rush":
        _, km, kv, reps, *options = job
        return marksman_rush_counter(km, kv, reps, options[0] if options else True,
                                      options[1] if len(options) > 1 else RUSH_STARTS_M[0],
                                      options[2] if len(options) > 2 else None)
    if kind == "hill_hold":
        _, holder, attacker, reps, *heat = job
        return hill_hold(holder, attacker, reps, heat[0] if heat else True)
    if kind == "hill_overwatch":
        _, long_gun, holder, reps, *heat = job
        return hill_overwatch(long_gun, holder, reps, heat[0] if heat else True)
    if kind == "ammo":
        _, kit, attacker, reps, *heat = job
        return ammo_stress(kit, attacker, reps, heat_cool_while_firing=heat[0] if heat else True,
                           report_caps=True, report_reasons=True)
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
        out.append(wid)
    return out, skipped


def _name(world: World, wid: str) -> str:
    return world.cat._row(wid).get("name", wid)


def choose_perks(world: World, primaries: list[str], scale: float, n_jobs: int,
                 anchor_world: World | None = None, heat_cool_while_firing=True) -> tuple[dict, dict]:
    """Choose each primary's perk on Standard and Shields against the baseline plain AR."""
    options = [None] + modelled_perks(world.perks)
    plain_ar = make_kit(anchor_world or world, "AR (plain)", ANCHOR, SECONDARY)
    reps = _reps("perk", scale)
    jobs, index = [], []
    for wid in primaries:
        for perk in options:
            if perk and world.fx(perk).get("armor_piercing") and \
                    any(world.cat._row(wid).get(k) is None for k in ("ap_dmg", "ap_fire_ms")):
                continue
            k = make_kit(world, f"{_name(world, wid)}|{perk}", wid, SECONDARY, perk)
            for preset in OP_GATED_PRESETS:
                for d in DIST:
                    jobs.append(("duel", k, plain_ar, d, preset, AIM, FIGHT_CAP_MS, False, reps,
                                 heat_cool_while_firing))
                    index.append((wid, preset, perk))
    res = run_cells(jobs, n_jobs)
    scores: dict = {}
    for (wid, preset, perk), v in zip(index, res):
        scores.setdefault(wid, {}).setdefault(preset, {}).setdefault(str(perk), 0.0)
        scores[wid][preset][str(perk)] += v / 3
    best = {}
    for wid in primaries:
        best[wid] = {}
        for preset in OP_GATED_PRESETS:
            top = None
            for perk in options:
                if str(perk) not in scores[wid][preset]:
                    continue
                if top is None or scores[wid][preset][str(perk)] > scores[wid][preset][str(top)] + 1e-12:
                    top = perk
            best[wid][preset] = top
    return best, scores


@dataclass
class KitSpec:
    name: str
    primary: str
    secondary: str | None
    perk: str | None
    combo: bool
    shield_perk: str | None = None


def build_kits(world: World, scale: float, n_jobs: int, extra: list[str] = (),
               anchor_world: World | None = None, heat_cool_while_firing=True) -> tuple[list[KitSpec], dict, list]:
    prim, skipped = roster_ids(world)
    for wid in extra:
        if wid not in prim:
            prim.append(wid)
    best, scores = choose_perks(world, prim, scale, n_jobs, anchor_world,
                               heat_cool_while_firing=heat_cool_while_firing)
    specs, seen = [], set()
    for w in prim:
        name = _name(world, w)
        if name in seen:
            name = f"{name} ({w})"
        seen.add(name)
        specs.append(KitSpec(name, w, SECONDARY, best[w]["standard"], False, best[w]["shields"]))
    for name, a, b, perk in COMBO_KITS:
        if world.cat._by_id.get(a) and world.cat._by_id.get(b) and world.perks.has(perk):
            specs.append(KitSpec(name, a, b, perk, True))
    return specs, {"best": {_name(world, w): best[w] for w in prim}, "scores": {_name(world, w): scores[w] for w in prim}}, skipped


def _top(values) -> float:
    """The column's best, ignoring NaN (a cell that did not run). NaN when nothing ran."""
    ok = [v for v in values if isinstance(v, (int, float)) and not math.isnan(v)]
    return max(ok) if ok else float("nan")


def _near_top(column: str, value: float, top: float) -> bool:
    if column == "ammo stress":
        return value >= top * (1 - NEAR_TOP_MARGIN[column])
    return value >= top - NEAR_TOP_MARGIN[column]


def _field_geo_mean(ratios) -> float:
    """A zero kill-rate ratio at any team size makes the field score zero."""
    ratios = list(ratios)
    return 0.0 if 0.0 in ratios else B.geo_mean(ratios)


def dominance_matrix(world: World, specs: list[KitSpec], scale: float, n_jobs: int,
                     anchor_world: World | None = None, heat_cool_while_firing=True) -> dict:
    """The kit matrix. The field anchor and the ambush enemies are `anchor_world`'s plain AR (the baseline), so
    an AR candidate is measured against today's AR, not against itself."""
    aw = anchor_world or world
    kits = {s.name: make_kit(world, s.name, s.primary, s.secondary, s.perk, "combo" if s.combo else "single")
            for s in specs}
    shields_kits = {s.name: make_kit(world, s.name, s.primary, s.secondary,
                                    s.perk if s.combo else s.shield_perk, "combo" if s.combo else "single")
                    for s in specs}
    fks = {s.name: field_kit(world, s.name, s.primary, s.secondary, s.perk, s.combo) for s in specs}
    names = [s.name for s in specs]
    dr = _reps("duel", scale)
    cells = []
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            for preset in ("standard", "shields"):
                for d in DIST:
                    pair = shields_kits if preset == "shields" else kits
                    cells.append(((preset, d, a, b), ("duel", pair[a], pair[b], d, preset, AIM, FIGHT_CAP_MS, False, dr,
                                                         heat_cool_while_firing)))
            for d in DIST:
                cells.append((("real", d, a, b), ("duel", kits[a], kits[b], d, "standard", REAL_AIM,
                                                    FIGHT_CAP_MS, False, dr, heat_cool_while_firing)))
            cells.append((("long", "mid", a, b), ("duel", kits[a], kits[b], "mid", "standard", LONG_CONTACT_AIM,
                                                  LONG_CONTACT_CAP_MS, False, dr, heat_cool_while_firing)))
            cells.append((("peek", "mid", a, b), ("duel", kits[a], kits[b], "mid", "standard", AIM, FIGHT_CAP_MS,
                                                  True, dr, heat_cool_while_firing)))
    anchor_fk = field_kit(aw, "AR anchor", ANCHOR, SECONDARY)
    enemy = make_kit(aw, "AR enemy", ANCHOR, SECONDARY)
    hill_refs = {r: make_kit(aw, f"{r} (plain)", r, SECONDARY) for r in HILL_REFERENCES}
    fr, ar, ammo_reps = _reps("field", scale), _reps("ambush", scale), _reps("ammo", scale)
    ammo_anchor = make_kit(aw, "AR ammo anchor", ANCHOR, SECONDARY)
    cells.append((("ammo_anchor",), ("ammo", ammo_anchor, enemy, ammo_reps, heat_cool_while_firing)))
    bolt_names = {n for n in names if any(world.cat._row(g.wid).get("reload_type") == "bolt"
                                          for g in kits[n].guns)}
    for n in names:
        for N in FIELD_NS:
            cells.append((("field", N, n), ("field", fks[n], anchor_fk, N, fr, heat_cool_while_firing)))
        for d in DIST:
            cells.append((("ambush", d, n), ("ambush", kits[n], enemy, d, ar, heat_cool_while_firing)))
        for ref, attacker in hill_refs.items():
            cells.append((("hill", ref, n), ("hill_hold", kits[n], attacker, dr,
                                           heat_cool_while_firing)))
        if n not in bolt_names:
            cells.append((("ammo", n), ("ammo", kits[n], enemy, ammo_reps, heat_cool_while_firing)))
    # Inspect both sides of each cell, including the anchor and reference kits.
    def carries_heat(job):
        return any(gun.heat for participant in job[1:-1]
                   for gun in getattr(participant, "guns", getattr(participant, "models", ())))

    # Unheated jobs keep the throughout seed and cache entry in every cooling branch.
    cells = [(key, job if carries_heat(job) else (*job[:-1], "throughout")) for key, job in cells]
    res = run_cells([j for _, j in cells], n_jobs)
    duel, field, field_counts, amb, hill, ammo, ammo_caps, ammo_reasons = {}, {}, {}, {}, {}, {}, {}, {}
    ammo_anchor_kills = 0.0
    ammo_anchor_caps = 0
    ammo_anchor_reasons = {}
    for (key, _), r in zip(cells, res):
        if key[0] == "ammo_anchor":
            ammo_anchor_kills, ammo_anchor_caps, ammo_anchor_reasons = r
        elif key[0] == "ammo":
            ammo[key[1]], ammo_caps[key[1]], ammo_reasons[key[1]] = r
        elif key[0] == "field":
            field.setdefault(key[2], []).append(r[0] if isinstance(r, tuple) else r)
            if isinstance(r, tuple):
                field_counts.setdefault(key[2], []).append((r[1], r[2]))
        elif key[0] == "ambush":
            amb.setdefault(key[2], []).append(r[0] + r[1])
        elif key[0] == "hill":
            hill.setdefault(key[2], []).append(r)
        else:
            mode, d, a, b = key
            duel[f"{mode}|{d}|{a}|{b}"] = r
            duel[f"{mode}|{d}|{b}|{a}"] = 1.0 - r
    for n in bolt_names:
        ammo[n], ammo_caps[n], ammo_reasons[n] = float("nan"), 0, {}

    def mean1(mode, d, n):
        v = [duel[f"{mode}|{d}|{n}|{o}"] for o in names if o != n]
        return sum(v) / len(v) if v else float("nan")

    cols = {}
    for n in names:
        cols[n] = {"1v1 close": mean1("standard", "close", n), "1v1 mid": mean1("standard", "mid", n),
                   "1v1 long": mean1("standard", "long", n),
                   **{f"real aim {d}": mean1("real", d, n) for d in DIST},
                   "long contact": mean1("long", "mid", n),
                   "peek mid": mean1("peek", "mid", n), "field": _field_geo_mean(field[n]),
                   "ambush": sum(amb[n]) / len(amb[n]),
                   "shields": sum(mean1("shields", d, n) for d in DIST) / 3,
                   "hill hold": sum(hill[n]) / len(hill[n]),
                   "ammo stress": ammo[n] / ammo_anchor_kills if ammo_anchor_kills else float("nan")}
    top = {c: _top([cols[n][c] for n in names]) for c in COLUMNS}
    near = {n: [c for c in COLUMNS if _near_top(c, cols[n][c], top[c])] for n in names}
    keys = {s.name: (s.name if s.combo else s.primary) for s in specs}   # stable ids: weapon_id, or the combo name
    return {"kits": names, "keys": keys, "specs": {s.name: {"primary": s.primary, "secondary": s.secondary, "perk": s.perk,
                                               "shields_perk": s.shield_perk,
                                               "combo": s.combo} for s in specs},
            "columns": cols, "top": top, "near_top": near, "duels": duel,
            "field_counts": field_counts,
            "reps": {"duel": dr, "field": fr, "ambush": ar, "ammo": ammo_reps},
            "ammo_stress_kills": ammo, "ammo_stress_anchor_kills": ammo_anchor_kills,
            "ammo_stress_cap_hits": ammo_caps, "ammo_stress_anchor_cap_hits": ammo_anchor_caps,
            "ammo_stress_end_reasons": ammo_reasons, "ammo_stress_anchor_end_reasons": ammo_anchor_reasons}


def aim_sweep_status(rows: list[dict], reference_top: dict) -> dict:
    """Compare the subject's sweep to the saved matrix top, without rerunning other kits."""
    marked = []
    for row in rows:
        marked.append({**row, "near_top": {dist: _near_top(f"1v1 {dist}", row[dist],
                                                           reference_top[f"1v1 {dist}"])
                                           for dist in ("mid", "long")}})
    changed = [dist for dist in ("mid", "long")
               if len({row["near_top"][dist] for row in marked}) > 1]
    return {"rows": marked, "reference_top": {dist: reference_top[f"1v1 {dist}"]
                                               for dist in ("mid", "long")},
            "near_top_changes": changed}


def subject_aim_sweep(world: World, matrix: dict, subject: str, reps: int,
                      heat_cool_while_firing=True) -> dict:
    """Mean 1v1 win rates for the subject kit only, against the candidate matrix opponents."""
    def kit(name):
        spec = matrix["specs"][name]
        return make_kit(world, name, spec["primary"], spec["secondary"], spec["perk"],
                        "combo" if spec["combo"] else "single")

    subject_kit = kit(subject)
    opponents = [kit(name) for name in matrix["kits"] if name != subject]
    rows = []
    for aim in AIM_SWEEP:
        row = {"aim": aim}
        for dist in ("mid", "long"):
            rates = [duel_rate(subject_kit, other, dist, reps=reps, aim=aim,
                               heat_cool_while_firing=heat_cool_while_firing)
                     for other in opponents]
            row[dist] = sum(rates) / len(rates) if rates else float("nan")
        rows.append(row)
    return aim_sweep_status(rows, matrix["top"])


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


def _run_rule(rid: str, kind: str, preset: str, rows_sig: str, reps: int,
              heat_cool_while_firing=True):
    """One rule on one preset. `rows_sig` is the JSON of the rows the rule reads: the cache key, and the
    catalogue the rule runs on. Heated combatants use the selected cooling branch."""
    rows = json.loads(rows_sig)
    cat = WeaponCatalog(_complete_rows(rows))
    m = B.RecoilDuelModel.from_catalog(cat, health_preset=preset,
                                       heat_cooling=B.normalise_heat_cooling(heat_cool_while_firing))
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


def run_rules(world: World, scale: float, n_jobs: int, heat_cool_while_firing=True) -> dict:
    reps = _reps("rule", scale)
    jobs, keys = [], []
    for rid, ids, kind in rule_list():
        sig = json.dumps({w: world.cat._row(w) for w in ids}, sort_keys=True)
        for preset in (("standard",) if kind == "r10a" else ("standard", "shields")):
            jobs.append(("rule", rid, kind, preset, sig, reps, heat_cool_while_firing))
            keys.append((rid, preset))
    out = {}
    for (rid, preset), v in zip(keys, run_cells(jobs, n_jobs)):
        bar = _rule_bar(rid, preset)
        ok = v < bar if rid.startswith("R10a") else v >= bar
        out[f"{preset}|{rid}"] = {"value": v, "bar": bar, "pass": ok}
    return out


def run_heated_rules(world: World, scale: float, n_jobs: int, branch: str, heated_rule_ids: set[str]) -> dict:
    """Run only rule cells containing a heated combatant under this branch."""
    reps = _reps("rule", scale)
    jobs, keys = [], []
    for rid, ids, kind in rule_list():
        if rid not in heated_rule_ids:
            continue
        sig = json.dumps({w: world.cat._row(w) for w in ids}, sort_keys=True)
        for preset in (("standard",) if kind == "r10a" else ("standard", "shields")):
            jobs.append(("rule", rid, kind, preset, sig, reps, branch))
            keys.append((rid, preset))
    out = {}
    for (rid, preset), value in zip(keys, run_cells(jobs, n_jobs)):
        bar = _rule_bar(rid, preset)
        out[f"{preset}|{rid}"] = {"value": value, "bar": bar,
                                  "pass": value < bar if rid.startswith("R10a") else value >= bar}
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
    ap_eligible = any(world.perks.effects(p).get("armor_piercing") for p in fieldable_perks(world.perks))
    low_health = {p: min(pool_parts(p, world.perks.effects(k))[0]
                         for k in [None] + fieldable_perks(world.perks)) for p in OP_GATED_PRESETS}
    out = {}
    for wid in ids:
        row = world.cat._row(wid)
        pull = world.cat.damage_per_pull(wid)
        crit = int(row.get("crit_pct") or 0)
        crit_pull = int(world.cat.damage(wid) * B.CRIT_MULT) + (pull - world.cat.damage(wid)) if crit else pull
        worst = max(pull, crit_pull)
        one_shots = {p: worst >= lows[p] for p in HEALTH_PRESETS}
        ap_dmg = row.get("ap_dmg") if ap_eligible and row.get("ap_fire_ms") is not None else None
        ap_one_shots = {p: ap_dmg is not None and ap_dmg >= low_health[p] for p in OP_GATED_PRESETS}
        out[wid] = {"pull": pull, "crit_pull": crit_pull, "worst_pull": worst, "lowest_pool": lows, "one_shots": one_shots,
                    "ap_dmg": ap_dmg, "lowest_health": low_health, "ap_one_shots": ap_one_shots,
                    "pickup_only": bool(row.get("pickup_only")),
                    "pass": bool(row.get("pickup_only")) or not any(one_shots[p] or ap_one_shots[p] for p in OP_GATED_PRESETS)}
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
            "recoil": row.get("recoil"), "dot": row.get("dot"), "heat": row.get("heat"),
            "ap_dmg": row.get("ap_dmg"), "ap_fire_ms": row.get("ap_fire_ms"),
            "overheat": _token(cat, wid, 38)}


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


def _overall_pass(tests: dict) -> bool:
    value_tests = ("value_addition", "viable", "pickup_utility")
    return (all(result["pass"] is not False for result in tests.values())
            and any(tests.get(name, {}).get("pass") is True for name in value_tests))


def _value_near_top_cells(near: list[str]) -> list[str]:
    """Treat the three real-aim distances as one value scenario."""
    real_aim = {f"real aim {distance}" for distance in DIST}
    return [column for column in near if column not in real_aim] + (["real aim"] if real_aim.intersection(near) else [])


def domination_verdict(baseline: dict, candidate: dict) -> dict:
    """Reject universal, priority-column or field-ratio dominance."""
    def near_everywhere(matrix, name):
        real_aim = {f"real aim {distance}" for distance in DIST}
        applicable = [column for column in COLUMNS
                      if not math.isnan(matrix["columns"][name][column])]
        near = set(matrix["near_top"][name])
        return (bool(applicable) and all(column in near for column in applicable if column not in real_aim)
                and (not real_aim.intersection(applicable) or (real_aim & set(applicable)) <= near))

    everywhere = [k for k in candidate["kits"] if near_everywhere(candidate, k)]
    before = [k for k in baseline["kits"] if near_everywhere(baseline, k)]
    field_exceeded = [k for k in candidate["kits"]
                      if candidate["columns"][k]["field"] > FIELD_RATIO_CEILING]
    priority_near = [k for k in candidate["kits"]
                     if all(c in candidate["near_top"][k] for c in DOMINATION_PRIORITY)]
    return _test(not (everywhere or field_exceeded or priority_near),
                 {"near_top_everywhere": everywhere, "baseline_near_top_everywhere": before,
                  "field_ceiling_exceeded": field_exceeded, "field_ratio_ceiling": FIELD_RATIO_CEILING,
                  "priority_near_top": priority_near, "priority_columns": DOMINATION_PRIORITY,
                  "margin": NEAR_TOP_MARGIN},
                 "no kit exceeds the field ceiling or nears the top in all priority columns or every scenario")


def _new_dominance_kits(before: dict, after: dict) -> list[str]:
    """Return kits that newly trigger any dominance gate in this branch."""
    keys = ("near_top_everywhere", "field_ceiling_exceeded", "priority_near_top")
    return sorted({kit for key in keys for kit in set(after[key]) - set(before[key])})


def _heat_sensitive_flips(flips: dict[str, list[str]], primary: str) -> dict[str, list[str]]:
    """Keep only failures introduced by another cooling branch."""
    primary_flips = set(flips.get(primary, []))
    return {branch: different for branch, branch_flips in flips.items() if branch != primary
            if (different := [flip for flip in branch_flips if flip not in primary_flips])}


def heat_rows(matrix: dict, weapon: str) -> dict | None:
    """Every matrix kit carrying a heated weapon, including secondary and combo slots."""
    names = [n for n, spec in matrix["specs"].items()
             if weapon in (spec["primary"], spec["secondary"])]
    if not names:
        return None
    name = names[0]
    return {
        "columns": matrix["columns"][name],
        "duels": {k: v for k, v in matrix["duels"].items() if name in k.split("|")[2:]},
        "kits": {n: {"columns": matrix["columns"][n],
                     "duels": {k: v for k, v in matrix["duels"].items() if n in k.split("|")[2:]}}
                 for n in names}}


def ttk_table(world: World, ids: list[str], scale: float, heat_cool_while_firing=True) -> list[dict]:
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
                    r[f"ttk_{tag}_ms"], r[f"rounds_{tag}"] = time_to_kill(
                        kk, pool, 1.0, reps, dist=dist, heat_cool_while_firing=heat_cool_while_firing)
            else:
                r["ttk_perfect_ms"], r["rounds_perfect"] = time_to_kill(
                    perfect, pool, 1.0, reps, dist=dist, heat_cool_while_firing=heat_cool_while_firing)
            if g.profile is not None and g.mode == "auto":
                for st in ("burst", "full"):
                    kk = replace(k, name=k.name + ":" + st, style=st)
                    r[f"ttk_recoil_{st}_ms"], r[f"rounds_recoil_{st}"] = time_to_kill(
                        kk, pool, 1.0, reps, dist=dist, heat_cool_while_firing=heat_cool_while_firing)
            out.append(r)
    return out


def _git_sha() -> str:
    try:
        return subprocess.run(["git", "-C", str(REPO), "rev-parse", "--short", "HEAD"], capture_output=True,
                              text=True, timeout=10).stdout.strip() or "unknown"
    except (OSError, subprocess.SubprocessError):
        return "unknown"


def review(src, *, reps_scale: float = 1.0, n_jobs: int = 1, haze: bool = False,
           haze_blind_ms: float = HAZE_BLIND_MS, heat_cool_while_firing=True) -> dict:
    """The whole review of one candidate. `reps_scale` is for tests only: same seeds, same code paths, fewer
    reps. A scaled verdict says so and `record()` refuses it."""
    heat_cool_while_firing = B.normalise_heat_cooling(heat_cool_while_firing)
    cand = load_candidate(src)
    entry = cand["entry"]
    base, world = build_worlds(cand)
    is_perk = entry["kind"].startswith("perk")
    wid = None if is_perk else entry["weapon_id"]
    row = None if is_perk else world.cat._row(wid)
    role = None if is_perk else row.get("role")
    pickup = bool(row and row.get("pickup_only"))

    extra = [wid] if (wid and role == "sidearm") else []
    shipped = shipped_world()
    specs_b, perks_b, skipped = build_kits(base, reps_scale, n_jobs, anchor_world=base,
                                          heat_cool_while_firing=heat_cool_while_firing)
    specs_c, perks_c, _ = build_kits(world, reps_scale, n_jobs, extra, anchor_world=base,
                                    heat_cool_while_firing=heat_cool_while_firing)
    mb = dominance_matrix(base, specs_b, reps_scale, n_jobs, anchor_world=base,
                          heat_cool_while_firing=heat_cool_while_firing)
    mc = dominance_matrix(world, specs_c, reps_scale, n_jobs, anchor_world=base,
                          heat_cool_while_firing=heat_cool_while_firing)
    touched = [e.get("weapon_id") for e in [entry] + cand["with"] if e.get("weapon_id")]
    changed_perks = {e.get("perk_id") for e in [entry] + cand["with"] if e.get("perk_id")}
    heated_specs = [s for s in specs_b + specs_c if any(
        x.cat._row(w).get("heat") for x in (base, world)
        for w in (s.primary, s.secondary) if w in x.cat._by_id)]
    heat_involved = any(s.primary in touched or s.secondary in touched or
                        s.perk in changed_perks or s.shield_perk in changed_perks
                        for s in heated_specs) or any(
                            w in x.cat._by_id and x.cat._row(w).get("heat")
                            for w in touched for x in (base, world))
    heat_involved = heat_involved or any(r.get("heat") for r in world.cat._rows)
    heated = [w for w in dict.fromkeys(w for s in heated_specs for w in (s.primary, s.secondary) if w)
              if any(w in x.cat._by_id and x.cat._row(w).get("heat") for x in (base, world))]
    heated += [w for w in touched if w not in heated and any(
        w in x.cat._by_id and x.cat._row(w).get("heat") for x in (base, world))]
    if not heat_involved:
        heated = []
    rules_s = run_rules(shipped, reps_scale, n_jobs, heat_cool_while_firing)
    rules_b = run_rules(base, reps_scale, n_jobs, heat_cool_while_firing)
    rules_c = run_rules(world, reps_scale, n_jobs, heat_cool_while_firing)

    subject_kit = None
    if wid and not pickup:
        subject_kit = next((s.name for s in specs_c if s.primary == wid and not s.combo), None)
    tests = {}
    side = sidearm_r10(world, wid, reps_scale, heat_cool_while_firing=heat_cool_while_firing) \
        if (role == "sidearm" and not pickup) else None

    # value_addition -------------------------------------------------------------------------------
    if is_perk:
        pid = entry["perk_id"]
        users = [f"{k}|{preset}" for k, picks in perks_c["best"].items()
                 for preset, p in picks.items() if p == pid]
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
        shipped_cat = shipped.cat
        if wid in shipped_cat._by_id:
            new_mech = sorted(set(new_mech) - trigger_mechanics(shipped_cat, wid))
        if role == "sidearm":
            fin = {w: sidearm_r10(world, w, reps_scale, duels=False,
                                 heat_cool_while_firing=heat_cool_while_firing)["finish_ms"]
                   for w in loadout_ids(world.cat) if world.cat._row(w).get("role") == "sidearm" and w != wid}
            fin[wid] = side["finish_ms"]
            best_other = min((v for w, v in fin.items() if w != wid), default=math.inf)
            ok_time = fin[wid] <= best_other * (1 + SIDEARM_VALUE_MARGIN)
            tests["value_addition"] = _test(bool(ok_time or new_mech),
                                            {"finish_ms": fin, "margin": SIDEARM_VALUE_MARGIN, "new_mechanics": new_mech},
                                            "a sidearm adds value when it finishes within 10% of the best sidearm, or brings a new trigger mechanic")
        else:
            near = _value_near_top_cells(mc["near_top"].get(subject_kit, [])) if subject_kit else []
            tests["value_addition"] = _test(bool(near or new_mech),
                                            {"near_top_in": near, "new_mechanics": new_mech,
                                             "cells": mc["columns"].get(subject_kit), "top": mc["top"]},
                                            "near the top in at least one scenario, or a trigger mechanic the arsenal lacks")

    # no_domination ---------------------------------------------------------------------------------
    tests["no_domination"] = domination_verdict(mb, mc)

    # viable ------------------------------------------------------------------------------------------
    if is_perk:
        pid = entry["perk_id"]
        gains = {f"{k}|{preset}": scores[pid] - scores["None"]
                 for k, by_preset in perks_c["scores"].items() for preset, scores in by_preset.items()
                 if pid in scores}
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
        spec = mc["specs"][subject_kit]
        primary_fk = field_kit(world, f"{subject_kit} primary only", spec["primary"])
        anchor_fk = field_kit(base, "AR anchor", ANCHOR)
        f = _field_geo_mean([field_ratio(primary_fk, anchor_fk, n, _reps("field", reps_scale),
                                         heat_cool_while_firing) for n in FIELD_NS])
        kit_f = mc["columns"][subject_kit]["field"]
        beats = [o for o in mc["kits"] if o != subject_kit and
                 any(mc["duels"][f"standard|{d}|{subject_kit}|{o}"] > 0.5 for d in DIST)]
        tests["viable"] = _test(f >= VIABLE_FIELD_FLOOR and bool(beats),
                                {"field": f, "kit_field": kit_f, "floor": VIABLE_FIELD_FLOOR,
                                 "beats_in_some_band": beats},
                                "plain primary-only field ratio (against the baseline AR) at or over the floor, and the kit beats another kit in a 1v1 band")

    tests["pickup_utility"] = (pickup_utility(world, wid, reps_scale, heat_cool_while_firing)
                               if pickup else _test(None, {}, "not a pickup-only candidate"))

    # balance_kept ----------------------------------------------------------------------------------
    haze_touched = any(int(world.cat._row(w).get("sir_fn") or 0) == 23
                       for w in touched if w in world.cat._by_id)
    haze_section = haze or haze_touched or haze_newly_selectable(base, world)
    haze_check = (haze_gate(base, world, _reps("haze_sweep", reps_scale), heat_cool_while_firing)
                  if haze_section else None)
    haze_failure = bool(haze_check and haze_check["fail"])
    tests["balance_kept"] = balance_kept(rules_s, rules_b, rules_c, mb, mc, wid, side,
                                         haze_failure=haze_failure)

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
        r, r_ba, r30, r_ba30 = run_cells([
            ("rush", mk, ar, rush_reps, heat_cool_while_firing, RUSH_STARTS_M[0]),
            ("rush", mk, ar_ba, rush_reps, heat_cool_while_firing, RUSH_STARTS_M[0]),
            ("rush", mk, ar, rush_reps, heat_cool_while_firing, RUSH_STARTS_M[1]),
            ("rush", mk, ar_ba, rush_reps, heat_cool_while_firing, RUSH_STARTS_M[1])], n_jobs)
        tests["marksman_rush_counter"] = marksman_verdict(
            r, r_ba, mc["near_top"].get(subject_kit, []), r30, r_ba30)
        rush_sweep = rush_speed_sweep(mk, ar, ar_ba, _reps("rush_sweep", reps_scale),
                                      heat_cool_while_firing, verdict_plain=r, verdict_armoured=r_ba)
        rush_flip = rush_sweep_flips(rush_sweep,
                                     strong_ok=tests["marksman_rush_counter"]["numbers"]["strong_ok"],
                                     verdict_pass=tests["marksman_rush_counter"]["pass"])
    else:
        tests["marksman_rush_counter"] = _test(None, {}, "not a marksman candidate")
        rush_sweep, rush_flip = None, False
    watch = marksman_watch(base, world, wid, rush_reps, n_jobs, heat_cool_while_firing)

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
        "tests": tests, "pass": _overall_pass(tests),
        "matrix": {"baseline": mb, "candidate": mc}, "perks": {"baseline": perks_b, "candidate": perks_c},
        "rules": {"shipped": rules_s, "baseline": rules_b, "candidate": rules_c}, "sidearm_r10": side,
        "marksman_watch": watch,
        "rush_speed_sweep": {"rows": rush_sweep, "verdict_flips": rush_flip} if rush_sweep else None,
        "aim_sweep": subject_aim_sweep(world, mc, subject_kit, _reps("aim_sweep", reps_scale),
                                        heat_cool_while_firing) if subject_kit else None,
        "rush_table": rush_table(world, specs_c, rush_reps, n_jobs, heat_cool_while_firing),
        "hill": hill_report(world, specs_c, _reps("duel", reps_scale), n_jobs, heat_cool_while_firing,
                            anchor_world=base),
        "pistol_finishers": pistol_finisher_report(world, reps_scale),
        "ttk": ttk_table(world, ttk_ids, reps_scale, heat_cool_while_firing),
        "not_modelled": skipped, "assumptions": assumptions(haze_blind_ms, heat_cool_while_firing),
        "heat": {},
        "haze": haze_report(world, _reps("duel", reps_scale), haze_blind_ms,
                            heat_cool_while_firing) if haze else None,
        "haze_gate": haze_check,
    }
    if heated:
        matrices = {heat_cool_while_firing: (mb, mc)}
        if pickup:
            verdict["heat_pickup_utility"] = {
                branch: (tests["pickup_utility"] if branch == heat_cool_while_firing else
                         pickup_utility(world, wid, reps_scale, branch))
                for branch in B.HEAT_COOLING_BRANCHES}
        heat_rule_ids = {rid for rid, ids, _ in rule_list() if any(
            w in x.cat._by_id and x.cat._row(w).get("heat")
            for w in ids for x in (shipped, base, world))}
        rule_branches = {heat_cool_while_firing: {"shipped": rules_s, "baseline": rules_b,
                                                 "candidate": rules_c}}
        for branch in B.HEAT_COOLING_BRANCHES:
            if branch == heat_cool_while_firing:
                continue
            matrices[branch] = (
                dominance_matrix(base, specs_b, reps_scale, n_jobs, anchor_world=base,
                                 heat_cool_while_firing=branch),
                dominance_matrix(world, specs_c, reps_scale, n_jobs, anchor_world=base,
                                 heat_cool_while_firing=branch))
            rule_branches[branch] = {}
            for label, x, original in (("shipped", shipped, rules_s), ("baseline", base, rules_b),
                                       ("candidate", world, rules_c)):
                rule_branches[branch][label] = {**original, **run_heated_rules(
                    x, reps_scale, n_jobs, branch, heat_rule_ids)}
        verdict["heat"] = {weapon: {branch: {
            "baseline": heat_rows(matrices[branch][0], weapon),
            "candidate": heat_rows(matrices[branch][1], weapon)}
            for branch in B.HEAT_COOLING_BRANCHES} for weapon in heated}
        verdict["heat_rules"] = {key: {branch: {label: rule_branches[branch][label][key]
                                               for label in ("shipped", "baseline", "candidate")}
                                      for branch in B.HEAT_COOLING_BRANCHES}
                                 for key in rules_c if key.split("|", 1)[1] in heat_rule_ids}
        failed = {}
        differences = []
        last_cell_losses = {}
        for branch in B.HEAT_COOLING_BRANCHES:
            branch_mb, branch_mc = matrices[branch]
            branch_rules = rule_branches[branch]
            flips = [key for key, values in verdict["heat_rules"].items()
                     if (values[branch]["shipped"]["pass"] or values[branch]["baseline"]["pass"])
                     and not values[branch]["candidate"]["pass"]]
            before_dom = domination_verdict(branch_mb, branch_mb)["numbers"]
            after_dom = domination_verdict(branch_mb, branch_mc)["numbers"]
            if _new_dominance_kits(before_dom, after_dom):
                flips.append("no_domination")
            kept = balance_kept({}, {}, {}, branch_mb, branch_mc, wid)
            last_cell_losses[branch] = kept["numbers"]["kits_losing_last_near_top"]
            flips.extend(f"balance_kept:{kit}" for kit in last_cell_losses[branch])
            if pickup and not verdict["heat_pickup_utility"][branch]["pass"]:
                flips.append("pickup_utility")
            if flips:
                failed[branch] = flips
        verdict["heat_last_cell_losses"] = last_cell_losses
        verdict["standing_heat_failures"] = {branch: [key for key, values in verdict["heat_rules"].items()
            if not values[branch]["shipped"]["pass"]] for branch in B.HEAT_COOLING_BRANCHES}
        for key, values in verdict["heat_rules"].items():
            if len({values[branch]["candidate"]["value"] for branch in B.HEAT_COOLING_BRANCHES}) > 1:
                differences.append(key)
        differing_matrix = []
        for weapon in heated:
            rows = verdict["heat"][weapon]
            primary_row = rows[heat_cool_while_firing]["candidate"]
            if primary_row is None:
                continue
            for kit_name in primary_row["kits"]:
                for column in COLUMNS:
                    values = [rows[branch]["candidate"]["kits"][kit_name]["columns"][column]
                              for branch in B.HEAT_COOLING_BRANCHES]
                    if any(abs(value - values[0]) > 1e-12 for value in values[1:]
                           if math.isfinite(value) and math.isfinite(values[0])):
                        differing_matrix.append(f"{kit_name}|{column}")
        sensitive = _heat_sensitive_flips(failed, heat_cool_while_firing)
        verdict["failed_heat_branches"] = sensitive
        verdict["tests"]["heat_sensitivity"] = _test(not sensitive,
            {"failed_branches": sensitive, "differing_rule_cells": differences,
             "differing_matrix_cells": sorted(set(differing_matrix))},
            "no new rule, last-cell, domination or pickup utility failure in another cooling branch")
        verdict["pass"] = verdict["pass"] and not sensitive
    return verdict


def _last_cell_material_loss(mb: dict, mc: dict, old_name: str, new_name: str) -> bool:
    """A last-cell loss matters only when its margin shortfall exceeds sampling noise."""
    def standard_error(matrix, name, column, score, reps):
        if column == "field":
            # The geometric mean combines kill-rate ratios; Poisson count error adds on log scale.
            counts = matrix.get("field_counts", {}).get(name)
            if counts:
                return score * math.sqrt(sum(1 / max(test, 0.5) + 1 / max(anchor, 0.5)
                                             for test, anchor in counts)) / len(counts)
            return math.sqrt((score + score * score) / (reps * len(FIELD_NS)))
        if column == "ammo stress":
            kills = matrix.get("ammo_stress_kills", {}).get(name)
            anchor = matrix.get("ammo_stress_anchor_kills")
            if kills is not None and anchor and kills > 0:
                return score * math.sqrt(1 / (kills * reps) + 1 / (anchor * reps))
            return math.sqrt((score + score * score) / reps)
        if column == "ambush":
            # The sum of two binary outcomes has range 0..2, and can exceed one.
            p = min(1.0, max(0.0, score / 2))
            return 2 * math.sqrt(p * (1 - p) / (reps * len(DIST)))
        averaged = max(1, len(matrix.get("kits", [])) - 1)
        if column == "shields":
            averaged *= len(DIST)
        elif column == "hill hold":
            averaged = len(HILL_REFERENCES)
        p = min(1.0, max(0.0, score))
        return math.sqrt(p * (1 - p) / (reps * averaged))

    material = []
    for column in mb["near_top"][old_name]:
        value = mc.get("columns", {}).get(new_name, {}).get(column)
        top = mc.get("top", {}).get(column)
        if value is None or top is None or not (math.isfinite(value) and math.isfinite(top)):
            return True
        limit = top * (1 - NEAR_TOP_MARGIN[column]) if column == "ammo stress" else top - NEAR_TOP_MARGIN[column]
        shortfall = limit - value
        kind = "ammo" if column == "ammo stress" else ("field" if column == "field" else
                ("ambush" if column == "ambush" else "duel"))
        reps = min(mb.get("reps", {}).get(kind, REPS[kind]), mc.get("reps", {}).get(kind, REPS[kind]))
        top_name = next((name for name in mc.get("kits", [])
                         if mc["columns"].get(name, {}).get(column) == top), new_name)
        se = math.hypot(standard_error(mc, top_name, column, top, reps),
                        standard_error(mc, new_name, column, value, reps))
        material.append(shortfall > NOISE_Z * se)
    return all(material)


def balance_kept(rules_s: dict, rules_b: dict, rules_c: dict, mb: dict, mc: dict, subject: str | None,
                 side: dict | None = None, *, haze_failure: bool = False) -> dict:
    """Rule cells fail when they pass in the shipped catalogue but fail in either world (this judges a `with`
    entry too), or pass in the baseline and fail in the candidate. A kit fails when, keyed by its weapon_id
    (or combo name), it had a near-top cell in the baseline and has none in the candidate."""
    flips = [k for k in rules_c if (rules_b[k]["pass"] and not rules_c[k]["pass"])
             or (rules_s[k]["pass"] and not (rules_b[k]["pass"] and rules_c[k]["pass"]))]
    already = [k for k in rules_s if not rules_s[k]["pass"]]
    by_key_c = {key: name for name, key in mc["keys"].items()}
    candidates = [(name, key, by_key_c[key]) for name, key in mb["keys"].items()
                  if key != subject and mb["near_top"][name] and key in by_key_c
                  and not mc["near_top"][by_key_c[key]]]
    lost = [key for name, key, new_name in candidates if _last_cell_material_loss(mb, mc, name, new_name)]
    noise_excused = [key for name, key, new_name in candidates
                     if not _last_cell_material_loss(mb, mc, name, new_name)]
    nums = {"rule_flips": {k: {"shipped": rules_s[k]["value"], "baseline": rules_b[k]["value"],
                               "candidate": rules_c[k]["value"], "bar": rules_c[k]["bar"]} for k in flips},
            "already_failing_when_shipped": already, "kits_losing_last_near_top": lost,
            "near_top_losses_within_noise": noise_excused, "noise_z": NOISE_Z,
            "haze_flip_over_bar": haze_failure, "haze_win_bar": HAZE_WIN_BAR}
    ok = not flips and not lost and not haze_failure
    if side is not None:
        low = {k: v for k, v in side["r10b"].items()
               if v < (R10_PRIMARY_BAR if k.startswith("standard") else B.SHIELDS_BAR)}
        nums["r10b_primaries_beat_it"] = side["r10b"]
        nums["r10b_under_bar"] = low
        ok = ok and not low
    return _test(ok, nums, "no Balance rule cell flips to fail (against the shipped catalogue too), "
                           "no other kit loses its last near-top cell, and no selectable Haze row "
                           "crosses the Haze win bar from a passing baseline")


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


def marksman_verdict(r: dict, r_ba: dict, near_cols: list,
                     r30: dict | None = None, r_ba30: dict | None = None) -> dict:
    """Tony 2026-10-17: strong until players learn to rush. Strong = peek-kill at or over MARKSMAN_STRONG_BAR
    AND the kit near the top in MARKSMAN_STRONG_COLUMN; counter = rush success at or over MARKSMAN_RUSH_BAR."""
    col_near = MARKSMAN_STRONG_COLUMN in near_cols
    strong = r["peek_kill"] >= MARKSMAN_STRONG_BAR and col_near
    counter = r["rush_success"] >= MARKSMAN_RUSH_BAR and r_ba["rush_success"] >= MARKSMAN_RUSH_BAR
    return _test(strong and counter, {
        "vs_plain_ar": r, "vs_ar_body_armor": r_ba,
        "vs_plain_ar_30m": r30, "vs_ar_body_armor_30m": r_ba30,
        "strong_column": MARKSMAN_STRONG_COLUMN,
        "near_top_in_strong_column": col_near, "strong_ok": strong, "counter_ok": counter,
        "plain_counter_ok": r["rush_success"] >= MARKSMAN_RUSH_BAR,
        "body_armor_counter_ok": r_ba["rush_success"] >= MARKSMAN_RUSH_BAR,
        "bars": {"strong": MARKSMAN_STRONG_BAR, "rush": MARKSMAN_RUSH_BAR},
        "rush_start_m": RUSH_STARTS_M[0]},
        f"strong against non-rushers (peek-kill, and near the top in {MARKSMAN_STRONG_COLUMN!r}), beaten by rushers from 20 m")


def marksman_watch(base: World, world: World, subject: str | None, reps: int, n_jobs: int,
                   heat_cool_while_firing=True) -> dict:
    """The rush counter for every OTHER marksman row in both worlds (against each world's own AR), so a candidate
    that moves the Sniper's numbers without being a marksman (an AR change, a perk) shows it."""
    ids = [w for w in roster_ids(world)[0] if world.cat._row(w).get("role") == "marksman" and w != subject]
    jobs = []
    for w in ids:
        for wd in (base, world):
            jobs.append(("rush", make_kit(wd, f"{_name(wd, w)} (plain)", w),
                         make_kit(wd, "AR (plain)", ANCHOR), reps, heat_cool_while_firing))
    res = run_cells(jobs, n_jobs)
    out = {}
    for i, w in enumerate(ids):
        b, c = res[2 * i], res[2 * i + 1]
        out[w] = {"baseline": b, "candidate": c, "moved": b != c}
    return out


def sidearm_r10(world: World, wid: str, scale: float, duels: bool = True,
                heat_cool_while_firing=True) -> dict:
    """R10 uses the CI duel engine for unheated pairs and the kit engine when either gun has heat.
    R10a is the median finish time for 35 HP. R10b tests each primary on Standard and Shields."""
    reps = _reps("rule", scale)
    sidearm_heated = bool(world.cat._row(wid).get("heat"))
    kind, temp = wid, None
    if wid not in B.R10_SIDEARMS:
        cat, row = world.cat, world.cat._row(wid)
        mag, res, rel = cat._ammo(wid, None)
        dmg, fire, crit = cat.damage_per_pull(wid), float(cat.fire_ms(wid)), int(row.get("crit_pct") or 0)
        prof, semi = B.recoil_profile(row), cat._frame_int(wid, "mode") == B.SEMI_MODE

        def temp(t, m, band, rng):
            return B._ar_shots(t, dmg, fire, mag, res, float(rel), prof, m.aim_factor, rng=rng, crit_pct=crit,
                               pull_ms=m.pull_ms if semi else 0.0,
                               overshoot_ms=m.fight_overshoot_ms)
        kind = f"candidate:{wid}"
        B.RANGE_COMBATANTS[kind] = temp
    try:
        m = B.RecoilDuelModel.from_catalog(world.cat, health_preset="standard")
        finish = (time_to_kill(make_kit(world, f"r10:{wid}", wid), 35, AIM, reps,
                               fit=False, reaction=True, heat_cool_while_firing=heat_cool_while_firing)[0]
                  if sidearm_heated else B.finish_time_batch(m, kind, reps, SEED).median_ms)
        out = {"finish_ms": finish, "r10b": {}}
        if duels:
            for preset in ("standard", "shields"):
                mp = m if preset == "standard" else B.RecoilDuelModel.from_catalog(world.cat, health_preset=preset)
                for p in B.R10_PRIMARIES:
                    primary_id = _KIND_IDS[p]
                    if sidearm_heated or world.cat._row(primary_id).get("heat"):
                        primary = make_kit(world, f"r10:{p}", primary_id)
                        if p == "ar_full":
                            primary = replace(primary, style="full")
                        sidearm = make_kit(world, f"r10:{wid}", wid)
                        value = duel_rate(primary, sidearm, "mid", preset, reps,
                                          heat_cool_while_firing=heat_cool_while_firing)
                    else:
                        value = B.r10_duel_batch(mp, p, kind, reps, SEED).win_rate
                    out["r10b"][f"{preset}|{p}"] = value
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
        return "n/a" if col == "ammo stress" else "-"
    return f"{v:.2f}" if col in ("field", "ambush", "ammo stress") else f"{v:.0%}"


def matrix_markdown(m: dict) -> str:
    lines = ["| kit | perk | " + " | ".join(COLUMNS) + " | near top |", "|" + "---|" * (len(COLUMNS) + 3)]
    for k in m["kits"]:
        cells = []
        for c in COLUMNS:
            s = _fmt(c, m["columns"][k][c])
            cells.append(f"**{s}**" if c in m["near_top"][k] else s)
        spec = m["specs"][k]
        perk = spec["perk"] or "-"
        shields_perk = spec.get("shields_perk", spec["perk"]) or "-"
        if shields_perk != perk:
            perk += f" / {shields_perk}"
        lines.append(f"| {k} | {perk} | " + " | ".join(cells) + f" | {len(m['near_top'][k])} |")
    return "\n".join(lines)


def _num(v):
    if v is None:
        return "n/a"
    if isinstance(v, float):
        if math.isnan(v):
            return "n/a"
        return "inf" if math.isinf(v) else (round(v, 3) if abs(v) < 10 else round(v))
    return v


def _json_finite(v):
    """Keep n/a cells as null when a verdict crosses the JSON output boundary."""
    if isinstance(v, float) and not math.isfinite(v):
        return None
    if isinstance(v, dict):
        return {key: _json_finite(value) for key, value in v.items()}
    if isinstance(v, (list, tuple)):
        return [_json_finite(value) for value in v]
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
                "does for a bolt row.", ""]
    op = t["op_rule"]["numbers"].get("checked") or {}
    if op:
        out += ["## One-shot check (op_rule)", "",
                "The gate checks the larger close pull and crit pull against the lowest pool. "
                "Eligible Armour Piercing checks `ap_dmg` against the lowest health.", "",
                "| weapon | pull | crit pull | AP | lowest pool std / shields / hardcore | lowest health std / shields | gated |",
                "|---|---|---|---|---|---|---|"]
        for w, r in op.items():
            lp = r["lowest_pool"]
            lh = r["lowest_health"]
            out.append(f"| {w} | {r['pull']} | {r['crit_pull']} | {r['ap_dmg']} | "
                       f"{lp['standard']} / {lp['shields']} / {lp['hardcore']} | "
                       f"{lh['standard']} / {lh['shields']} | "
                       f"{'pickup-only' if r['pickup_only'] else ('ok' if r['pass'] else 'ONE-SHOTS')} |")
        out.append("")
    mr = t["marksman_rush_counter"]["numbers"]
    if mr:
        a, b = mr["vs_plain_ar"], mr["vs_ar_body_armor"]
        out += ["## Marksman rush counter", "",
                f"Against a plain AR: peek-kill {a['peek_kill']:.2f} (bar {MARKSMAN_STRONG_BAR}), near the top in "
                f"{mr['strong_column']!r}: {mr['near_top_in_strong_column']}; rush success from {RUSH_STARTS_M[0]:g} m {a['rush_success']:.2f} (bar {MARKSMAN_RUSH_BAR}). "
                f"Against an AR with Body Armor: peek-kill {b['peek_kill']:.2f}, rush success {b['rush_success']:.2f}.", ""]
        if mr.get("vs_plain_ar_30m"):
            out += [f"From {RUSH_STARTS_M[1]:g} m: plain AR rush success "
                    f"{mr['vs_plain_ar_30m']['rush_success']:.2f}; AR with Body Armor "
                    f"{mr['vs_ar_body_armor_30m']['rush_success']:.2f}. The verdict bar remains at {RUSH_STARTS_M[0]:g} m.", ""]
    if v.get("rush_speed_sweep"):
        sweep = v["rush_speed_sweep"]
        out += ["## Rush speed sensitivity", "",
                f"Subject marksman against both AR rushers from {RUSH_STARTS_M[0]:g} m. "
                f"The rush success bar is {MARKSMAN_RUSH_BAR:.2f}. Verdict flips inside sweep: {sweep['verdict_flips']}.", "",
                "| speed (m/s) | plain AR rush success | AR with Body Armor rush success |",
                "|---:|---:|---:|"]
        for row in sweep["rows"]:
            out.append(f"| {row['speed_m_s']:g} | {row['plain']['rush_success']:.2f} | "
                       f"{row['body_armor']['rush_success']:.2f} |")
        out.append("")
    moved_m = {w: r for w, r in (v.get("marksman_watch") or {}).items() if r["moved"]}
    if v.get("rush_table"):
        out += ["## Marksman rushes", "", f"The verdict bar uses both plain AR and AR with Body Armor at {RUSH_STARTS_M[0]:g} m. Both starts are reported below.", "",
                "| marksman kit | rusher | start (m) | rush success | peek kill |",
                "|---|---|---:|---:|---:|"]
        for row in v["rush_table"]:
            out.append(f"| {row['marksman']} | {row['rusher']} | {row['start_m']:g} | "
                       f"{row['rush_success']:.2f} | {row['peek_kill']:.2f} |")
        out.append("")
    if moved_m:
        out += ["## Marksman numbers this candidate moves", "",
                "The candidate is not that marksman, but it moves its rush-counter numbers (against each world's AR):", ""]
        for w, r in moved_m.items():
            b, c = r["baseline"], r["candidate"]
            out.append(f"- {w}: peek-kill {b['peek_kill']:.2f} -> {c['peek_kill']:.2f}, rush success "
                       f"{b['rush_success']:.2f} -> {c['rush_success']:.2f}")
        out.append("")
    if v.get("hill"):
        hill = v["hill"]
        out += ["## Hill hold", "", f"P(holder kills both close attackers). The second arrives {HILL_SECOND_ATTACKER_MS / 1000:g} s later.", "",
                "| holder | attacker | kill both |", "|---|---|---:|"]
        for row in hill["hold"]:
            out.append(f"| {row['holder']} | {row['attacker']} | {row['kill_both']:.2f} |")
        out += ["", "## Hill overwatch", "", "Long-gun peek kill against a holder who cannot leave the circle.", "",
                "| long gun | holder | peek kill |", "|---|---|---:|"]
        for row in hill["overwatch"]:
            out.append(f"| {row['long_gun']} | {row['holder']} | {row['peek_kill']:.2f} |")
        out += ["", "## Hill contest", "", "Both kits start alert inside the circle at close range.", "",
                "| kit | opponent | win |", "|---|---|---:|"]
        for row in hill["contest"]:
            out.append(f"| {row['kit']} | {row['opponent']} | {row['win']:.2f} |")
        out.append("")
    if v.get("pistol_finishers"):
        out += ["## Pistol finishers", "", f"The primary runs dry with {B.R10_FINISH_POOL_HP:g} HP left on the target. Times start at the dry click.", "",
                "| primary | pistol | swap and finish (ms) | reload and finish (ms) | R10a bar (ms) | beats reload |",
                "|---|---|---:|---:|---:|---|"]
        for row in v["pistol_finishers"]:
            out.append(f"| {row['primary']} | {row['pistol']} | {_num(row['finish_ms'])} | "
                       f"{_num(row['reload_finish_ms'])} | {row['bar_ms']:g} | {row['beats_staying']} |")
        out.append("")
    matrix = v["matrix"]["candidate"]
    if matrix.get("ammo_stress_kills"):
        out += ["## Ammo stress", "",
                f"Mean kills in one life at mid range. The holder has {REAL_AIM:g} aim and heals between fights. "
                f"Plain AR attackers have {AMMO_STRESS_ATTACKER_AIM:g} aim. Their rounds land only while the holder reloads, "
                "vents, is heat-locked, swaps or has no rounds. "
                f"One AMMO pickup tops held reserves after {AMMO_PICKUP_AFTER_KILLS} kills. "
                "The chain reload can be interrupted only in ammo stress; firing between shells is unproven. "
                "Bolt kits are n/a because their whole cycle is down time, so this column measures exposure instead of ammunition.", "",
                f"Plain AR anchor: {matrix['ammo_stress_anchor_kills']:.2f} kills; "
                f"attacker cap hit in {matrix['ammo_stress_anchor_cap_hits']} reps. "
                f"End reasons: {matrix['ammo_stress_anchor_end_reasons']}.", "",
                "| kit | kills | ratio to AR | dry | died reloading | died heat-locked or venting | died swapping | cap |",
                "|---|---:|---:|---:|---:|---:|---:|---:|"]
        for name in matrix["kits"]:
            if matrix["columns"][name]["ammo stress"] is None or math.isnan(matrix["columns"][name]["ammo stress"]):
                out.append(f"| {name} | n/a | n/a | n/a | n/a | n/a | n/a | n/a |")
                continue
            reasons = matrix["ammo_stress_end_reasons"][name]
            out.append(f"| {name} | {matrix['ammo_stress_kills'][name]:.2f} | "
                       f"{matrix['columns'][name]['ammo stress']:.2f} | "
                       f"{reasons['dry']} | {reasons['died_reloading']} | "
                       f"{reasons['died_heat_locked_or_venting']} | {reasons['died_swapping']} | {reasons['cap']} |")
        out.append("")
    if v.get("sidearm_r10"):
        sr = v["sidearm_r10"]
        out += ["## Sidearm R10", "", "Heated pairs use the kit engine; other pairs use the CI rule engine.", "",
                f"R10a finish: {_num(sr['finish_ms'])} ms "
                f"(bar {B.R10_FINISH_BAR_MS:g}). R10b, each primary's win rate against it: "
                + ", ".join(f"{k} {v2:.0%}" for k, v2 in sr["r10b"].items()), ""]
    horizons = (v.get("assumptions") or {}).get("horizons") or {}
    if horizons:
        out += ["## Scoring horizons", "", "| result | horizon |", "|---|---|"]
        out += [f"| {name} | {horizon} |" for name, horizon in horizons.items()]
        out.append("")
    out += ["## Dominance matrix, candidate world", "",
            "Bold = near the top (within the margin of the column's best). 1v1 columns are mean win rates against "
            "every other kit for the first kill within 10 s; long contact allows 20 s. Field is the kill-rate ratio "
            "against AR carriers over 150 s; ambush is P(kill both) + P(kill one or more). "
            "Hill hold is P(kill both sequential attackers); ammo stress is kills divided by the plain AR anchor. "
            "Bolt kits have no ammo stress score.",
            "", matrix_markdown(v["matrix"]["candidate"]), "", "## Dominance matrix, baseline", "",
            matrix_markdown(v["matrix"]["baseline"]), ""]
    if v.get("aim_sweep"):
        sweep = v["aim_sweep"]
        out += ["## In-fight aim sensitivity", "",
                f"Only the subject kit is rerun against the candidate roster. Near-top uses the saved "
                f"{AIM:g}-aim matrix top as a fixed reference; other kits are not swept. "
                f"Near-top status changes inside sweep: {', '.join(sweep['near_top_changes']) or 'none'}.", "",
                "| aim | 1v1 mid win | near top | 1v1 long win | near top |",
                "|---:|---:|---|---:|---|"]
        for row in sweep["rows"]:
            out.append(f"| {row['aim']:.2f} | {row['mid']:.2f} | {row['near_top']['mid']} | "
                       f"{row['long']:.2f} | {row['near_top']['long']} |")
        out.append("")
    if v.get("haze"):
        out += ["## Haze trial", "", "| opponent | range | plain AR | AR + Haze |",
                "|---|---|---:|---:|"]
        for row in v["haze"]:
            out.append(f"| {row['opponent']} | {row['range']} | {row['plain']:.2f} | {row['haze']:.2f} |")
        out.append("")
    if v.get("haze_gate"):
        out += ["## Haze blind-duration sensitivity", "",
                "Each selectable fn-23 row fails only when its candidate sweep crosses the win bar "
                "from a passing baseline at the same blind duration.", "",
                "| row | blind (ms) | baseline win | candidate win | new failure |",
                "|---|---:|---:|---:|---|"]
        flip_keys = {(r["weapon_id"], r["blind_ms"]) for r in v["haze_gate"]["flips"]}
        for row in v["haze_gate"]["rows"]:
            before = "n/a" if row["baseline"] is None else f"{row['baseline']:.2f}"
            out.append(f"| {row['weapon_id']} | {row['blind_ms']:g} | {before} | "
                       f"{row['candidate']:.2f} | "
                       f"{(row['weapon_id'], row['blind_ms']) in flip_keys} |")
        for row in v["haze_gate"]["standing_shipped_failures"]:
            out.append(f"Standing shipped failure: {row['weapon_id']} at {row['blind_ms']:g} ms "
                       f"wins {row['win_vs_ar_body_armor']:.2f} (F577).")
        out.append("")
    elif v.get("haze_blind_sweep"):
        # Recorded verdicts from earlier scenario versions have only the single-row sweep.
        out += ["## Haze blind-duration sensitivity", "",
                "| blind (ms) | AR + Haze win | over bar |", "|---:|---:|---|"]
        for row in v["haze_blind_sweep"]:
            rate = row["win_vs_ar_body_armor"]
            out.append(f"| {row['blind_ms']:g} | {rate:.2f} | {rate > HAZE_WIN_BAR} |")
        out.append("")
    if v.get("heat"):
        out += ["## Heat: cooling throughout / after lockout / none", "",
                "Cooling while firing is unproven (F575). Each branch reruns the heated weapon's matrix row.", ""]
        for weapon, settings in v["heat"].items():
            out += [f"### {weapon}", "", "| setting | world | kit | " + " | ".join(COLUMNS) + " |",
                    "|---|---|---|" + "---:|" * len(COLUMNS)]
            for setting in B.HEAT_COOLING_BRANCHES:
                for label in ("baseline", "candidate"):
                    row = settings[setting][label]
                    if row is not None:
                        for kit_name, kit_row in row.get("kits", {weapon: row}).items():
                            out.append(f"| {setting} | {label} | {kit_name} | "
                                       + " | ".join(str(_num(kit_row["columns"][col])) for col in COLUMNS) + " |")
            out.append("")
    if v.get("heat_rules"):
        out += ["## Heated Balance rule cells", "",
                "Each cell uses its catalogue heat and all three cooling branches.", "",
                "| rule | branch | shipped | baseline | candidate | bar | pass |",
                "|---|---|---:|---:|---:|---:|---|"]
        for key, branches in v["heat_rules"].items():
            for branch in B.HEAT_COOLING_BRANCHES:
                cells = branches[branch]
                out.append(f"| {key} | {branch} | {_num(cells['shipped']['value'])} | "
                           f"{_num(cells['baseline']['value'])} | {_num(cells['candidate']['value'])} | "
                           f"{_num(cells['candidate']['bar'])} | {cells['candidate']['pass']} |")
        for branch, keys in v.get("standing_heat_failures", {}).items():
            if keys:
                out.append(f"Standing shipped failures under {branch}: {', '.join(keys)}. "
                           "They do not fail the candidate without a flip.")
        out.append("")
    if v.get("heat_pickup_utility"):
        out += ["## Heated pickup utility", "",
                "| branch | kills per stock | median first kill (ms) | pass |",
                "|---|---:|---:|---|"]
        for branch in B.HEAT_COOLING_BRANCHES:
            result = v["heat_pickup_utility"][branch]
            numbers = result["numbers"]
            out.append(f"| {branch} | {_num(numbers['kills_per_stock'])} | "
                       f"{_num(numbers['median_ttk_ms'])} | {result['pass']} |")
        out.append("")
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
                    "this tree still scales it (its `_ammo` lacks the bolt exemption). Shipping this verdict needs that compile change too."]
    out += ["", "## Invented assumptions", "", "```json", json.dumps(v["assumptions"], indent=1), "```"]
    if v.get("failed_heat_branches"):
        out += ["", "Heat branches failing a gate: " + "; ".join(
            f"{branch}: {', '.join(names)}" for branch, names in v["failed_heat_branches"].items()) + "."]
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
    if not v["pass"]:
        lines.append(f"- Fails: {', '.join(n for n, r in v['tests'].items() if r['status'] == 'fail')}.")
    lines += ["", "| test | result | numbers |", "|---|---|---|"]
    for name, r in v["tests"].items():
        lines.append(f"| {name} | {r['status']} | {_short(r['numbers'])} |")
    lines += ["", "Candidate:", "", "```json", json.dumps(v["candidate"], indent=1), "```", ""]
    text = "\n".join(lines) + "\n"
    old = path.read_text(encoding="utf-8") if path.exists() else ""
    if old and not old.endswith("\n\n"):
        text = ("\n" if old.endswith("\n") else "\n\n") + text
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
    ap.add_argument("--haze", action="store_true", help="report the hidden AR + Haze trial")
    ap.add_argument("--haze-blind-ms", type=float, default=HAZE_BLIND_MS, help="Haze blind window in milliseconds")
    ap.add_argument("--heat-cooling", choices=B.HEAT_COOLING_BRANCHES, default="throughout",
                    help="when catalogue heat cools (unproven, F575)")
    ap.add_argument("--heat-cool-while-firing", choices=("on", "off"), default=None,
                    help=argparse.SUPPRESS)
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
    v = review(args.candidate, reps_scale=args.reps_scale, n_jobs=args.jobs,
               haze=args.haze, haze_blind_ms=args.haze_blind_ms,
               heat_cool_while_firing=(args.heat_cooling if args.heat_cool_while_firing is None
                                       else ("throughout" if args.heat_cool_while_firing == "on" else "none")))
    md = report_markdown(v)
    sys.stdout.write(md)
    if args.out:
        Path(args.out).write_text(json.dumps(_json_finite(v), indent=1, default=str, allow_nan=False))
    if args.report:
        Path(args.report).write_text(md)
    if args.record:
        record_guard(v, args.call)
        record(v, args.call, DECISIONS, command="python3 mcp/tools/balance_review.py --candidate " + args.candidate)
    return 0 if v["pass"] else 1


if __name__ == "__main__":
    sys.exit(main())
