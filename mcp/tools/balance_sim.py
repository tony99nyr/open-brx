#!/usr/bin/env python3
"""Monte Carlo balance simulation for every weapon in the Open BRX catalogue.

Standard library only. Run ``python3 mcp/tools/balance_sim.py --help`` from the repo root, or
import it (``from balance_sim import ...`` with ``mcp/tools`` on ``sys.path``) and call the library
functions below. It grew out of the one-weapon Toxin Rifle sim; the toxin sweep is the ``toxin``
preset (``--preset toxin``), so ``docs/weapon-design.md`` §7.5b stays reproducible.

WHAT IT MODELS
--------------
Two teams fight a timed deathmatch. Each player runs a seek -> engage -> break -> seek cycle against
the other team. Every state change (a shot, a poison tick, a contact window ending, a death, a
respawn) is an event on a priority queue, processed in time order.

Scenarios:
  duel    every weapon against every weapon, 1v1, win rate (more kills at the whistle wins, a tie
          counts half).
  team    per weapon under test and team size N = 2..10: each team fields ONE test weapon and N-1
          anchor weapons of its own slot kind (assumption 7). The number is the kill-rate ratio, test carriers'
          kills per minute over anchor carriers' kills per minute, with a 95% interval.
  sweep   one weapon, a grid over any numeric catalogue fields (``--sweep dmg=5..9
          dot.per_tick=2..6``), each grid point run as a team table plus a duel against the anchor.

EVERY PER-WEAPON NUMBER COMES FROM ``WeaponCatalog`` (``mcp/brx_mcp/mc/compile.py``), never from this
file: damage per pull (the gun word plus a declared headset word, t5 + t12), the charge and tap
magnitudes, rounds per charge, fire interval (t14, a ``wire.fire_ms`` wins), the burst gap (t23),
the fire mode (t20: burst, charge), mag / reserve / reload_ms, ``reload_type``, ``crit_pct``, the
``dot`` block, ``role``, ``class``, ``range_band``, ``hidden``, ``lethal`` and ``pickup_only``. The
sweep edits a COPY of the catalogue rows and rebuilds a ``WeaponCatalog`` from them, so a swept
number goes through the same code path the compiler uses.

The pool and the respawn delay come from ``brx_mcp.mc.state.default_config()`` (45 health, 70 armour,
15 s). The shield is 0: a spawn shield is always 0 (weapon-design.md §7.3).

MECHANICS MODELLED
------------------
- Damage spills shield -> armour -> health at face value (weapon-design.md §0).
- A pull lands ``damage_per_pull()``: both words of a two-word weapon (Shotgun) land together or miss
  together.
- Crits: the gun rolls ``crit_pct`` per hit; a crit lands int(gun word x 1.5).
- Burst (t20 = 9): two gaps of t14, then one gap of t23.
- Charge with a tap (Charge Rifle): a charge (``damage_per_pull()``, costs ``rounds_per_charge``
  rounds) is ready when the player has not pulled for t14 ms. The player fires the charge the
  moment a contact opens, then taps (``tap_damage()``, 1 round) at ``CHARGE_TAP_CADENCE_MS``.
- Charge without a tap (Rail Gun, Laser Cannon): every shot, the first included, waits t14.
- ``reload_type: chain`` (Shotgun): ``reload_ms`` is per shell.
- The DoT block: ``per_tick`` every ``tick_ms`` for ``duration_ms``, refreshed on each hit, never
  stacked. A tick takes damage from the outermost non-empty layer only, with no spill
  (spec/node.md §3.17). A stacking DoT is refused: no row carries one.

INVENTED ASSUMPTIONS (the numbers that move the answer most)
------------------------------------------------------------
1. Focus fire: a free player joins an enemy who is already under fire with probability
   p_join(N) = min(0.7, 0.08 x (N - 1)); otherwise it picks a fresh random enemy.
2. Contact windows are exponential with mean ``--contact-mean-s`` (2.0 s); the gap between contacts
   is exponential with mean ``--gap-mean-s`` (3.0 s).
3. Base hit chance per shot: ``--hit-prob`` (default 0.35, 0.5, 0.65, cycled per match).
4. Range (switch off with ``--no-range``). Each engagement draws a distance class from the venue:
     indoor  close 0.55, mid 0.40, long 0.05
     outdoor close 0.25, mid 0.45, long 0.30
   The hit chance is multiplied by ``BAND_FIT[range_band][distance]`` (capped at 1.0):
                close  mid   long
     close      1.30  0.50  0.25
     close-mid  1.15  0.80  0.40
     mid        1.00  1.00  0.50
     long/full  0.80  0.90  1.20
   Each band has the best multiplier at its own distance. A close weapon gains up close and a long
   gun loses there. ``mid`` (the anchor's band) is the reference. A row with no ``range_band``
   (only hidden rows) counts as mid. The venue defaults to the game default
   (``state.default_config()['environment']``, outdoor).
7. Anchors by slot kind (``anchor_for()``): a sidearm is compared with ``usp``, every other weapon
   with ``assault_rifle``. ``--anchor`` overrides both. A pick-up-only weapon gets a ratio but no
   DOMINATES / DOMINATED flag: no loadout weapon competes with it for a slot.
5. Tactical reload (switch off with ``--no-tactical-reload``): when a contact ends with less than
   half a magazine, the player reloads before the next contact.
6. Match length 150 s. Kills per minute is a rate, so a short match widens the variance but does
   not bias the ratio.

SIMPLIFICATIONS (things the model leaves out)
---------------------------------------------
- One slot per player: no secondary, so no swap delay (t15).
- The fn 36/37 headset multiplier ($SIR) is left out, as ``hits_to_kill()`` leaves it out.
- Overheat (t24/t35/t38), recoil, stance, flinch and the accuracy walk are left out.
- Non-lethal weapons (``lethal: false``: the Breacher and the Haze) are not simulated. They cannot
  win a duel or score a kill, so a kill-rate number means nothing for them.
- Both words of a two-word pull use one hit roll.
- The distance class belongs to the attacker's engagement; the target draws its own when it shoots
  back.
- Pick-up-only weapons (the heavies) are run as if a player spawned with them. Read their rows as a
  stress test, not a target.

Reproducibility: every cell seeds its own ``random.Random`` from a string of the seed and the cell
key, so a cell's result does not depend on the order or the process that ran it, and ``--jobs``
does not change the CSV.
"""

from __future__ import annotations

import argparse
import copy
import csv
import heapq
import itertools
import math
import os
import random
import sys
import time as walltime
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass, replace

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parents[1]))
from brx_mcp.mc import state as _state  # noqa: E402
from brx_mcp.mc.compile import CHARGE_TAP_CADENCE_MS, WeaponCatalog  # noqa: E402

# --------------------------------------------------------------------------- #
# Invented model constants (see the module docstring)
# --------------------------------------------------------------------------- #

DISTANCE_CLASSES = ("close", "mid", "long")
VENUE_DISTANCE = {
    "indoor": (0.55, 0.40, 0.05),
    "outdoor": (0.25, 0.45, 0.30),
}
# Hit-chance multiplier by range band (row) and distance class (close, mid, long). Invented. Each band has
# the highest multiplier at its own distance, so a close weapon GAINS up close and a long gun loses there.
# `mid` (the anchor's band) is the reference: 1.0 wherever it is at home.
BAND_FIT = {
    "close": (1.30, 0.50, 0.25),
    "close-mid": (1.15, 0.80, 0.40),
    "mid": (1.00, 1.00, 0.50),
    "long": (0.80, 0.90, 1.20),
}
BAND_FIT["full"] = BAND_FIT["long"]
DEFAULT_BAND = "mid"
# Slot-kind anchors: a weapon is compared with an anchor of its own kind (`anchor_for()`).
ROLE_ANCHORS = {"sidearm": "usp"}
CRIT_MULT = 1.5
INITIAL_JITTER_MS = 500.0    # avoids lock-step artefacts at match start
DEFAULT_ANCHOR = "assault_rifle"
DEFAULT_N = tuple(range(2, 11))
DEFAULT_HIT_PROBS = (0.35, 0.5, 0.65)


def p_join(n: int) -> float:
    """Probability that a free player joins an enemy already under fire. Rises with team size."""
    return min(0.7, 0.08 * (n - 1))


# --------------------------------------------------------------------------- #
# Game settings and weapon model
# --------------------------------------------------------------------------- #

@dataclass(frozen=True)
class Pool:
    health: int
    armour: int
    shield: int
    respawn_ms: float


def default_pool(mode: str = "tdm") -> Pool:
    """The game's own default pool and respawn delay, read from MC's `default_config()`."""
    cfg = _state.default_config(mode)
    h = cfg["health"]
    return Pool(health=int(h["max_hp"]), armour=int(h["max_armor"]), shield=0,
                respawn_ms=float(cfg["respawn"]["delay_s"]) * 1000.0)


def default_venue(mode: str = "tdm") -> str:
    return str(_state.default_config(mode).get("environment") or "outdoor")


@dataclass(frozen=True)
class SimConfig:
    pool: Pool
    venue: str = "outdoor"
    range_model: bool = True
    tactical_reload: bool = True
    hit_probs: tuple = DEFAULT_HIT_PROBS
    match_ms: float = 150_000.0
    contact_mean_s: float = 2.0
    gap_mean_s: float = 3.0


@dataclass(frozen=True)
class WeaponModel:
    weapon_id: str
    name: str
    role: str
    weapon_class: str
    range_band: str
    band_declared: bool
    hidden: bool
    lethal: bool
    pickup_only: bool
    gun_dmg: int            # t5, the word a crit multiplies
    headset_dmg: int        # a declared wire.headset_dmg (t12), 0 when none
    tap_dmg: int            # t37, 0 when none
    rounds_per_charge: int
    fire_ms: float          # t14
    burst_gap_ms: float     # t23 on a burst weapon, else 0
    charged: bool           # t20 in the charge modes
    mag: int
    reserve: int
    reload_ms: float
    chain_reload: bool
    crit_pct: int
    dot_per_tick: int
    dot_tick_ms: float
    dot_ticks: int

    @property
    def pull_dmg(self) -> int:
        return self.gun_dmg + self.headset_dmg

    @property
    def charge_and_tap(self) -> bool:
        return self.rounds_per_charge > 1 and self.tap_dmg > 0


def weapon_model(cat: WeaponCatalog, weapon_id: str) -> WeaponModel:
    """Build the sim's view of one weapon, reading every number from `cat`."""
    row = cat._row(weapon_id)
    wire = row.get("wire") or {}
    dot = row.get("dot") or {}
    if dot and dot.get("stack"):
        raise ValueError(f"{weapon_id}: a stacking DoT is not modelled (no catalogue row carries one)")
    mag, reserve, reload_ms = cat._ammo(weapon_id, None)
    burst = cat._frame_int(weapon_id, "burst") if cat._frame_int(weapon_id, "mode") == cat._BURST_MODE else 0
    band = row.get("range_band")
    tick_ms = float(dot.get("tick_ms") or 1000) if dot else 1000.0
    return WeaponModel(
        weapon_id=weapon_id, name=row.get("name", weapon_id), role=row.get("role", ""),
        weapon_class=row.get("class", "ballistic"),
        range_band=band if band in BAND_FIT else DEFAULT_BAND, band_declared=band in BAND_FIT,
        hidden=bool(row.get("hidden")), lethal=row.get("lethal") is not False,
        pickup_only=bool(row.get("pickup_only")),
        gun_dmg=cat.damage(weapon_id),
        headset_dmg=cat.damage_per_pull(weapon_id) - cat.damage(weapon_id),
        tap_dmg=cat.tap_damage(weapon_id), rounds_per_charge=cat.rounds_per_charge(weapon_id),
        fire_ms=float(cat.fire_ms(weapon_id)), burst_gap_ms=float(burst),
        charged=cat._frame_int(weapon_id, "mode") in cat._CHARGE_MODES,
        mag=mag, reserve=reserve, reload_ms=float(reload_ms),
        chain_reload=row.get("reload_type") == "chain",
        crit_pct=int(row.get("crit_pct") or 0),
        dot_per_tick=int(dot.get("per_tick") or 0) if dot else 0,
        dot_tick_ms=tick_ms,
        dot_ticks=int((dot.get("duration_ms") or 0) // tick_ms) if dot else 0,
    )


def catalogue_ids(cat: WeaponCatalog, include_hidden: bool = False) -> tuple[list[str], list[str]]:
    """(simulated ids, skipped non-lethal ids), in catalogue order."""
    sim, skipped = [], []
    for row in cat._rows:
        if row.get("hidden") and not include_hidden:
            continue
        (skipped if row.get("lethal") is False else sim).append(row["weapon_id"])
    return sim, skipped


def anchor_for(m: WeaponModel, override: str | None = None) -> str:
    """The anchor this weapon is judged against: `override` when given, else one of its own slot kind."""
    return override or ROLE_ANCHORS.get(m.role, DEFAULT_ANCHOR)


def hit_multiplier(m: WeaponModel, dist_idx: int, cfg: SimConfig) -> float:
    if not cfg.range_model:
        return 1.0
    return BAND_FIT[m.range_band][dist_idx]


# --------------------------------------------------------------------------- #
# Player state and the event engine
# --------------------------------------------------------------------------- #

class Player:
    __slots__ = ("pid", "team", "w", "alive", "shield", "armour", "health", "ammo", "reserve",
                 "reload_until", "next_ready", "last_pull", "burst_i", "target", "contact_end",
                 "engage_id", "attackers", "hit_p", "poison_gen", "poison_src", "poison_left",
                 "poison_dmg", "poison_tick_ms", "kills", "deaths", "dot_kills", "shots")

    def __init__(self, pid: int, team: int, w: WeaponModel, pool: Pool):
        self.pid, self.team, self.w = pid, team, w
        self.alive = True
        self.shield, self.armour, self.health = pool.shield, pool.armour, pool.health
        self.ammo, self.reserve = w.mag, w.reserve
        self.reload_until = -1.0
        self.next_ready = 0.0
        self.last_pull = -1e9
        self.burst_i = 0
        self.target = None
        self.contact_end = 0.0
        self.engage_id = 0
        self.attackers = 0
        self.hit_p = 0.0
        self.poison_gen = 0
        self.poison_src = None
        self.poison_left = 0
        self.poison_dmg = 0
        self.poison_tick_ms = 1000.0
        self.kills = self.deaths = self.dot_kills = self.shots = 0


class Match:
    def __init__(self, players: list[Player], rng: random.Random, cfg: SimConfig, hit_prob: float, n: int):
        self.players, self.rng, self.cfg, self.base_p = players, rng, cfg, hit_prob
        self.pj = p_join(n)
        self.heap: list = []
        self._seq = itertools.count()
        self.dist_w = VENUE_DISTANCE[cfg.venue]

    def push(self, t: float, kind: int, pid: int, gen: int = 0) -> None:
        heapq.heappush(self.heap, (t, next(self._seq), kind, pid, gen))

    SEEK, SHOT, CEND, TICK, RESPAWN = range(5)

    def run(self) -> None:
        for p in self.players:
            self.push(self.rng.uniform(0, INITIAL_JITTER_MS), self.SEEK, p.pid)
        handlers = (self._seek, self._shot, self._contact_end, self._tick, self._respawn)
        end = self.cfg.match_ms
        while self.heap:
            t, _s, kind, pid, gen = heapq.heappop(self.heap)
            if t > end:
                break
            handlers[kind](self.players[pid], t, gen)

    # -- engagement ------------------------------------------------------------

    def _seek(self, p: Player, t: float, _gen: int = 0) -> None:
        if not p.alive:
            return
        enemies = [q for q in self.players if q.team != p.team and q.alive]
        if not enemies:
            self.push(t + 200.0, self.SEEK, p.pid)
            return
        targeted = [q for q in enemies if q.attackers > 0]
        if targeted and self.rng.random() < self.pj:
            target = self.rng.choice(targeted)
        else:
            target = self.rng.choice(enemies)
        p.engage_id += 1
        gen = p.engage_id
        p.target = target.pid
        p.contact_end = t + self.rng.expovariate(1.0 / self.cfg.contact_mean_s) * 1000.0
        target.attackers += 1
        p.hit_p = self.base_p
        if self.cfg.range_model:
            d = self.rng.choices((0, 1, 2), weights=self.dist_w)[0]
            p.hit_p = min(1.0, p.hit_p * hit_multiplier(p.w, d, self.cfg))
        p.burst_i = 0
        first = max(t, p.next_ready)
        if p.w.charged and not p.w.charge_and_tap:
            first = max(first, t + p.w.fire_ms)   # the first shot has to be charged too
        self.push(first, self.SHOT, p.pid, gen)
        self.push(p.contact_end, self.CEND, p.pid, gen)

    def _release(self, p: Player, t: float) -> None:
        """End p's engagement and schedule its next seek."""
        if p.target is not None:
            self.players[p.target].attackers -= 1
        p.target = None
        p.engage_id += 1
        if self.cfg.tactical_reload and p.alive:
            self._tactical_reload(p, t)
        self.push(t + self.rng.expovariate(1.0 / self.cfg.gap_mean_s) * 1000.0, self.SEEK, p.pid)

    def _contact_end(self, p: Player, t: float, gen: int) -> None:
        if p.alive and p.engage_id == gen:
            self._release(p, t)

    def _tactical_reload(self, p: Player, t: float) -> None:
        """Between contacts, a player below half a magazine reloads (assumption 5)."""
        if p.ammo * 2 < p.w.mag and p.reserve > 0 and p.reload_until < t:
            self._start_reload(p, t)

    def _start_reload(self, p: Player, t: float) -> None:
        w = p.w
        amt = min(w.mag - p.ammo, p.reserve)
        p.reserve -= amt
        p.ammo += amt
        p.reload_until = t + (w.reload_ms * amt if w.chain_reload else w.reload_ms)

    # -- firing ------------------------------------------------------------------

    def _shot(self, p: Player, t: float, gen: int) -> None:
        if not p.alive or p.engage_id != gen or p.target is None or t > p.contact_end:
            return
        if t < p.reload_until:
            self.push(p.reload_until, self.SHOT, p.pid, gen)
            return
        w = p.w
        if p.ammo <= 0:
            if p.reserve <= 0:
                return  # dry until respawn
            self._start_reload(p, t)
            self.push(p.reload_until, self.SHOT, p.pid, gen)
            return
        target = self.players[p.target]
        # what this pull is
        if w.charge_and_tap:
            if p.ammo >= w.rounds_per_charge and t - p.last_pull >= w.fire_ms:
                gun, extra, cost = w.gun_dmg, w.headset_dmg, w.rounds_per_charge
            else:
                gun, extra, cost = w.tap_dmg, 0, 1
            interval = float(CHARGE_TAP_CADENCE_MS)
        else:
            gun, extra, cost = w.gun_dmg, w.headset_dmg, min(w.rounds_per_charge, p.ammo)
            if w.burst_gap_ms:
                p.burst_i += 1
                interval = w.burst_gap_ms if p.burst_i % 3 == 0 else w.fire_ms
            else:
                interval = w.fire_ms
        p.ammo -= cost
        p.last_pull = t
        p.next_ready = t + interval
        if target.alive:
            p.shots += 1
            if self.rng.random() < p.hit_p:
                if w.crit_pct and self.rng.random() * 100.0 < w.crit_pct:
                    gun = int(gun * CRIT_MULT)
                self._hit(p, target, gun + extra, t)
        if not p.alive or p.target is None or p.engage_id != gen:
            return
        nxt = t + interval
        if p.ammo <= 0 and p.reserve > 0:
            self._start_reload(p, t)
            nxt = max(nxt, p.reload_until)
        elif p.ammo <= 0:
            return
        if nxt <= p.contact_end:
            self.push(nxt, self.SHOT, p.pid, gen)

    # -- damage ------------------------------------------------------------------

    def _hit(self, src: Player, tgt: Player, dmg: int, t: float) -> None:
        rem = dmg
        if tgt.shield:
            take = min(tgt.shield, rem); tgt.shield -= take; rem -= take  # noqa: E702
        if rem and tgt.armour:
            take = min(tgt.armour, rem); tgt.armour -= take; rem -= take  # noqa: E702
        if rem:
            tgt.health -= min(tgt.health, rem)
        w = src.w
        if w.dot_ticks and w.dot_per_tick:
            tgt.poison_gen += 1
            tgt.poison_src = src.pid
            tgt.poison_left = w.dot_ticks
            tgt.poison_dmg = w.dot_per_tick
            tgt.poison_tick_ms = w.dot_tick_ms
            self.push(t + w.dot_tick_ms, self.TICK, tgt.pid, tgt.poison_gen)
        if tgt.health <= 0:
            self._death(tgt, src, t, dot=False)

    def _tick(self, tgt: Player, t: float, gen: int) -> None:
        if not tgt.alive or tgt.poison_gen != gen or tgt.poison_left <= 0:
            return
        d = tgt.poison_dmg
        if tgt.shield > 0:
            tgt.shield -= min(tgt.shield, d)
        elif tgt.armour > 0:
            tgt.armour -= min(tgt.armour, d)
        else:
            tgt.health -= min(tgt.health, d)
        tgt.poison_left -= 1
        if tgt.health <= 0:
            self._death(tgt, self.players[tgt.poison_src], t, dot=True)
        elif tgt.poison_left > 0:
            self.push(t + tgt.poison_tick_ms, self.TICK, tgt.pid, gen)

    def _death(self, dead: Player, killer: Player, t: float, dot: bool) -> None:
        dead.deaths += 1
        killer.kills += 1
        if dot:
            killer.dot_kills += 1
        if dead.target is not None:
            self.players[dead.target].attackers -= 1
        dead.target = None
        dead.engage_id += 1
        dead.alive = False
        dead.poison_gen += 1
        dead.poison_left = 0
        if dead.attackers > 0:
            for q in self.players:
                if q.alive and q.target == dead.pid:
                    q.target = None
                    q.engage_id += 1
                    if self.cfg.tactical_reload:
                        self._tactical_reload(q, t)
                    self.push(t + self.rng.expovariate(1.0 / self.cfg.gap_mean_s) * 1000.0,
                              self.SEEK, q.pid)
            dead.attackers = 0
        self.push(t + self.cfg.pool.respawn_ms, self.RESPAWN, dead.pid)

    def _respawn(self, p: Player, t: float, _gen: int = 0) -> None:
        pool = self.cfg.pool
        p.alive = True
        p.shield, p.armour, p.health = pool.shield, pool.armour, pool.health
        p.ammo, p.reserve = p.w.mag, p.w.reserve
        p.reload_until = -1.0
        p.poison_gen += 1
        p.poison_left = 0
        self.push(t, self.SEEK, p.pid)


def run_match(rng: random.Random, roster: list[tuple[int, WeaponModel]], cfg: SimConfig,
              hit_prob: float, n: int) -> list[Player]:
    """One match. `roster` is (team, weapon) in player-id order; `n` is the team size for p_join."""
    players = [Player(i, team, w, cfg.pool) for i, (team, w) in enumerate(roster)]
    Match(players, rng, cfg, hit_prob, n).run()
    return players


# --------------------------------------------------------------------------- #
# Scenarios
# --------------------------------------------------------------------------- #

def cell_rng(seed: int, *key) -> random.Random:
    return random.Random(":".join(str(k) for k in (seed,) + key))


@dataclass
class DuelResult:
    a: str
    b: str
    reps: int
    wins: float           # a's wins, a tie counts half
    kills_a: int
    kills_b: int

    @property
    def win_rate(self) -> float:
        return self.wins / self.reps if self.reps else float("nan")

    def ci(self) -> tuple[float, float]:
        p, n = self.win_rate, self.reps
        half = 1.96 * math.sqrt(max(p * (1 - p), 1e-9) / n) if n else float("nan")
        return max(0.0, p - half), min(1.0, p + half)


def duel(a: WeaponModel, b: WeaponModel, cfg: SimConfig, reps: int, seed: int, key: str = "") -> DuelResult:
    rng = cell_rng(seed, "duel", key, a.weapon_id, b.weapon_id)
    res = DuelResult(a.weapon_id, b.weapon_id, reps, 0.0, 0, 0)
    for r in range(reps):
        hp = cfg.hit_probs[r % len(cfg.hit_probs)]
        pa, pb = run_match(rng, [(0, a), (1, b)], cfg, hp, 1)
        res.kills_a += pa.kills
        res.kills_b += pb.kills
        res.wins += 1.0 if pa.kills > pb.kills else (0.5 if pa.kills == pb.kills else 0.0)
    return res


@dataclass
class TeamResult:
    test: str
    anchor: str
    n: int
    reps: int
    kills_test: int
    kills_anchor: int
    minutes_test: float
    minutes_anchor: float
    dot_kills_test: int

    @property
    def ratio(self) -> float:
        if not self.kills_anchor or not self.minutes_test:
            return float("nan")
        return (self.kills_test / self.minutes_test) / (self.kills_anchor / self.minutes_anchor)

    def ci(self) -> tuple[float, float]:
        """95% interval on the rate ratio, from the Poisson counts behind it."""
        if self.kills_test <= 0 or self.kills_anchor <= 0:
            return float("nan"), float("nan")
        se = math.sqrt(1.0 / self.kills_test + 1.0 / self.kills_anchor)
        return self.ratio * math.exp(-1.96 * se), self.ratio * math.exp(1.96 * se)


def team(test: WeaponModel, anchor: WeaponModel, n: int, cfg: SimConfig, reps: int, seed: int,
         key: str = "") -> TeamResult:
    """Each side: one `test` carrier and n-1 `anchor` carriers. Both sides pool into the result."""
    rng = cell_rng(seed, "team", key, test.weapon_id, anchor.weapon_id, n)
    roster = []
    for side in (0, 1):
        roster.append((side, test))
        roster.extend((side, anchor) for _ in range(n - 1))
    mins = cfg.match_ms / 60000.0
    res = TeamResult(test.weapon_id, anchor.weapon_id, n, reps, 0, 0, 0.0, 0.0, 0)
    for r in range(reps):
        hp = cfg.hit_probs[r % len(cfg.hit_probs)]
        players = run_match(rng, roster, cfg, hp, n)
        for i, p in enumerate(players):
            if i % n == 0:     # the first slot of each side is the test carrier
                res.kills_test += p.kills
                res.minutes_test += mins
                res.dot_kills_test += p.dot_kills
            else:
                res.kills_anchor += p.kills
                res.minutes_anchor += mins
    return res


# --------------------------------------------------------------------------- #
# Sweep parsing and catalogue editing
# --------------------------------------------------------------------------- #

# Keys the catalogue reads out of the row's `wire` block, not its top level.
WIRE_KEYS = frozenset({"dmg", "fire_ms", "headset_dmg", "swap_ms"})


def parse_values(spec: str) -> list:
    """`5..9` (inclusive), `5..9:2` (a step), or `3000,5000,7000`. Ints where possible."""
    def num(s):
        f = float(s)
        return int(f) if f.is_integer() else f
    if ".." in spec:
        lo, rest = spec.split("..", 1)
        hi, _, step = rest.partition(":")
        lo, hi, st = num(lo), num(hi), num(step) if step else 1
        out, v = [], lo
        while v <= hi + 1e-9:
            out.append(num(round(v, 9)))
            v += st
        return out
    return [num(s) for s in spec.split(",") if s.strip()]


def parse_sweep(items: list[str]) -> list[tuple[str, list]]:
    axes = []
    for it in items:
        path, sep, spec = it.partition("=")
        if not sep or not path or not spec:
            raise ValueError(f"--sweep {it!r}: expected FIELD=VALUES, e.g. dmg=5..9")
        axes.append((path.strip(), parse_values(spec.strip())))
    return axes


def set_field(row: dict, path: str, value) -> None:
    """Write one swept number into a copied catalogue row. `dmg`, `fire_ms`, `headset_dmg` and `swap_ms`
    go into `wire` (where the catalogue reads them); a dotted path walks nested blocks (`dot.per_tick`)."""
    parts = path.split(".")
    if len(parts) == 1 and parts[0] in WIRE_KEYS:
        parts = ["wire", parts[0]]
    node = row
    for p in parts[:-1]:
        node = node.setdefault(p, {})
    node[parts[-1]] = value


def catalogue_with(cat: WeaponCatalog, weapon_id: str, changes: dict) -> WeaponCatalog:
    rows = copy.deepcopy(cat._rows)
    row = next(r for r in rows if r["weapon_id"] == weapon_id)
    for path, value in changes.items():
        set_field(row, path, value)
    return WeaponCatalog(rows)


# --------------------------------------------------------------------------- #
# Batch drivers (parallel-safe: every cell carries its own seed)
# --------------------------------------------------------------------------- #

def _run_job(job):
    kind = job[0]
    if kind == "duel":
        _, a, b, cfg, reps, seed, key = job
        return duel(a, b, cfg, reps, seed, key)
    _, t, anc, n, cfg, reps, seed, key = job
    return team(t, anc, n, cfg, reps, seed, key)


def run_jobs(jobs: list, n_jobs: int = 1) -> list:
    if n_jobs <= 1 or len(jobs) < 2:
        return [_run_job(j) for j in jobs]
    with ProcessPoolExecutor(max_workers=n_jobs) as ex:
        return list(ex.map(_run_job, jobs, chunksize=max(1, len(jobs) // (n_jobs * 8))))


def duel_matrix(models: list[WeaponModel], cfg: SimConfig, reps: int, seed: int, n_jobs: int = 1,
                key: str = "") -> dict:
    """{(a, b): win rate of a}. Both orders are filled from one run per unordered pair."""
    pairs = [(a, b) for i, a in enumerate(models) for b in models[i:]]
    res = run_jobs([("duel", a, b, cfg, reps, seed, key) for a, b in pairs], n_jobs)
    out = {}
    for r in res:
        out[(r.a, r.b)] = r
        if r.a != r.b:
            out[(r.b, r.a)] = DuelResult(r.b, r.a, r.reps, r.reps - r.wins, r.kills_b, r.kills_a)
    return out


def team_table(models: list[WeaponModel], anchor, ns, cfg: SimConfig, reps: int, seed: int,
               n_jobs: int = 1, key: str = "") -> dict:
    """{(weapon, n): TeamResult}. `anchor` is one WeaponModel for every weapon, or a dict
    {weapon_id: WeaponModel} (see `anchor_for()`)."""
    pick = anchor.get if isinstance(anchor, dict) else (lambda _wid: anchor)
    jobs = [("team", m, pick(m.weapon_id), n, cfg, reps, seed, key) for m in models for n in ns]
    return {(r.test, r.n): r for r in run_jobs(jobs, n_jobs)}


# --------------------------------------------------------------------------- #
# Summary
# --------------------------------------------------------------------------- #

def geo_mean(xs) -> float:
    xs = [x for x in xs if x > 0 and math.isfinite(x)]
    return math.exp(sum(math.log(x) for x in xs) / len(xs)) if xs else float("nan")


def rank_weapons(models: list[WeaponModel], teams: dict, duels: dict, ns,
                 anchors: dict | None = None) -> list[dict]:
    """One line per weapon, furthest from parity first. `duel_field` is the mean 1v1 win rate against the
    weapons that share its anchor (its own slot kind), NaN when no duel ran. A pick-up-only weapon gets
    no flag."""
    anchors = anchors or {}
    rows = []
    for m in models:
        cells = [teams[(m.weapon_id, n)] for n in ns if (m.weapon_id, n) in teams]
        gm = geo_mean(c.ratio for c in cells)
        cis = [c.ci() for c in cells]
        dominates = bool(cis) and all(lo > 1.0 for lo, _ in cis)
        dominated = bool(cis) and all(hi < 1.0 for _, hi in cis)
        if m.pickup_only:
            dominates = dominated = False
        group = anchors.get(m.weapon_id)
        others = [duels[(m.weapon_id, o.weapon_id)].win_rate for o in models
                  if o is not m and (m.weapon_id, o.weapon_id) in duels
                  and anchors.get(o.weapon_id) == group]
        rows.append({
            "weapon": m.weapon_id, "role": m.role, "band": m.range_band + ("" if m.band_declared else "?"),
            "anchor": cells[0].anchor if cells else (group or ""),
            "team_gm": gm, "team_n2": cells[0].ratio if cells else float("nan"),
            "team_nmax": cells[-1].ratio if cells else float("nan"),
            "duel_field": sum(others) / len(others) if others else float("nan"),
            "distance": abs(math.log(gm)) if gm > 0 and math.isfinite(gm) else float("inf"),
            "flag": "DOMINATES" if dominates else ("DOMINATED" if dominated else ""),
            "pickup_only": m.pickup_only, "hidden": m.hidden,
        })
    rows.sort(key=lambda r: -r["distance"])
    return rows


def summary_text(ranked: list[dict], cfg: SimConfig, anchor: str, ns, skipped: list[str], header: str) -> str:
    """`anchor` describes the anchor rule in one phrase; each row names its own anchor too."""
    lines = [header,
             f"pool {cfg.pool.health} health / {cfg.pool.armour} armour / {cfg.pool.shield} shield, "
             f"respawn {cfg.pool.respawn_ms / 1000:g} s; venue {cfg.venue}; range model "
             f"{'on' if cfg.range_model else 'off'}; tactical reload {'on' if cfg.tactical_reload else 'off'}; "
             f"hit chance {','.join(f'{h:g}' for h in cfg.hit_probs)}; contact {cfg.contact_mean_s:g} s, "
             f"gap {cfg.gap_mean_s:g} s; match {cfg.match_ms / 1000:g} s",
             f"team ratio = test carriers' kills/min over anchor carriers' kills/min ({anchor}), "
             f"one test carrier a side, N = {ns[0]}..{ns[-1]}",
             "",
             f"{'weapon':<17}{'role':<10}{'band':<11}{'anchor':<15}{'team gm':>8}{'N=' + str(ns[0]):>7}"
             f"{'N=' + str(ns[-1]):>7}{'duel/field':>11}  flag"]
    num = lambda x, fmt: format(x, fmt) if isinstance(x, float) and math.isfinite(x) else "-"  # noqa: E731
    for r in ranked:
        note = " ".join(x for x in (r["flag"], "pickup-only" if r["pickup_only"] else "",
                                    "hidden" if r["hidden"] else "") if x)
        lines.append(f"{r['weapon']:<17}{r['role']:<10}{r['band']:<11}{r['anchor']:<15}"
                     f"{num(r['team_gm'], '.2f'):>8}{num(r['team_n2'], '.2f'):>7}{num(r['team_nmax'], '.2f'):>7}"
                     f"{num(r['duel_field'], '.0%'):>11}  {note}")
    lines += ["", "DOMINATES / DOMINATED: the 95% interval of the team ratio sits above / below 1.00 at every N.",
              "A pick-up-only weapon gets no flag. duel/field: mean 1v1 win rate against the weapons with the same "
              "anchor; '-' when that did not run.",
              "band ending in '?': no range_band on the row, counted as mid."]
    if skipped:
        lines.append("not simulated (lethal: false, cannot score a kill): " + ", ".join(skipped))
    return "\n".join(lines) + "\n"


# --------------------------------------------------------------------------- #
# CSV
# --------------------------------------------------------------------------- #

FIELDS = ["scenario", "weapon", "opponent", "n", "params", "venue", "range_model", "reps",
          "kills_weapon", "kills_opponent", "ratio", "ci_lo", "ci_hi", "win_rate", "win_ci_lo",
          "win_ci_hi", "dot_kill_share"]


def _r(x, nd=4):
    return round(x, nd) if isinstance(x, float) and math.isfinite(x) else ("" if isinstance(x, float) else x)


def team_row(r: TeamResult, cfg: SimConfig, scenario="team", params="") -> dict:
    lo, hi = r.ci()
    return {"scenario": scenario, "weapon": r.test, "opponent": r.anchor, "n": r.n, "params": params,
            "venue": cfg.venue, "range_model": int(cfg.range_model), "reps": r.reps,
            "kills_weapon": r.kills_test, "kills_opponent": r.kills_anchor, "ratio": _r(r.ratio),
            "ci_lo": _r(lo), "ci_hi": _r(hi), "win_rate": "", "win_ci_lo": "", "win_ci_hi": "",
            "dot_kill_share": _r(r.dot_kills_test / r.kills_test if r.kills_test else 0.0)}


def duel_row(r: DuelResult, cfg: SimConfig, scenario="duel", params="") -> dict:
    lo, hi = r.ci()
    return {"scenario": scenario, "weapon": r.a, "opponent": r.b, "n": 1, "params": params,
            "venue": cfg.venue, "range_model": int(cfg.range_model), "reps": r.reps,
            "kills_weapon": r.kills_a, "kills_opponent": r.kills_b, "ratio": "", "ci_lo": "", "ci_hi": "",
            "win_rate": _r(r.win_rate), "win_ci_lo": _r(lo), "win_ci_hi": _r(hi), "dot_kill_share": ""}


# --------------------------------------------------------------------------- #
# Presets
# --------------------------------------------------------------------------- #

# The Toxin Rifle sweep behind docs/weapon-design.md §7.5b, restated in this tool's terms. The old
# sim had no range model and no tactical reload, and averaged three hit chances; so does this.
PRESETS = {
    "toxin": {
        "weapon": "toxin_rifle", "anchor": "assault_rifle", "include_hidden": True,
        "sweep": ["dmg=5..9", "dot.per_tick=2..6", "dot.duration_ms=3000,5000,7000"],
        "no_range": True, "no_tactical_reload": True, "hit_prob": "0.35,0.5,0.65",
        "contact_mean_s": 2.0, "reps": 180, "duel_reps": 900,
    },
}


def toxin_preset_config(pool: Pool | None = None) -> SimConfig:
    """The toxin preset's SimConfig, for tests and callers that want the §7.5b conditions."""
    return SimConfig(pool=pool or default_pool(), venue=default_venue(), range_model=False,
                     tactical_reload=False, hit_probs=(0.35, 0.5, 0.65), contact_mean_s=2.0)


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #

def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="balance_sim.py", description=__doc__.split("\n\n")[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter,
                                 epilog="Assumptions and simplifications: see the module docstring.")
    ap.add_argument("--scenario", choices=("all", "duel", "team", "sweep"), default="all",
                    help="all = duel matrix + team table (default); --sweep implies sweep")
    ap.add_argument("--preset", choices=sorted(PRESETS), help="a saved sweep (toxin = weapon-design.md §7.5b)")
    ap.add_argument("--weapon", help="the weapon under test for a sweep, or to limit the team table to one")
    ap.add_argument("--anchor", default=None,
                    help="one anchor for every weapon (default: by slot kind, usp for sidearms, else assault_rifle)")
    ap.add_argument("--sweep", nargs="+", default=[], metavar="FIELD=VALUES",
                    help="e.g. dmg=5..9 dot.per_tick=2..6 dot.duration_ms=3000,5000,7000 fire_ms=90..130:10")
    ap.add_argument("--include-hidden", action="store_true", help="simulate hidden rows too")
    ap.add_argument("--n", default="2..10", help="team sizes (default 2..10)")
    ap.add_argument("--hit-prob", default="0.35,0.5,0.65", help="base hit chances, cycled per match")
    ap.add_argument("--venue", choices=sorted(VENUE_DISTANCE), help="default: the game default venue")
    ap.add_argument("--no-range", action="store_true", help="switch the range model off")
    ap.add_argument("--no-tactical-reload", action="store_true", help="reload only on an empty magazine")
    ap.add_argument("--health", type=int, help="override the game's max_hp")
    ap.add_argument("--armour", type=int, help="override the game's max_armor")
    ap.add_argument("--shield", type=int, help="override the spawn shield (default 0)")
    ap.add_argument("--respawn-s", type=float, help="override the game's respawn delay")
    ap.add_argument("--match-seconds", type=float, default=150.0)
    ap.add_argument("--contact-mean-s", type=float, default=2.0)
    ap.add_argument("--gap-mean-s", type=float, default=3.0)
    ap.add_argument("--reps", type=int, default=120, help="matches per team cell")
    ap.add_argument("--duel-reps", type=int, default=300, help="matches per duel pair")
    ap.add_argument("--seed", type=int, default=20260919)
    ap.add_argument("--jobs", type=int, default=min(8, os.cpu_count() or 1), help="worker processes")
    ap.add_argument("--out", default="balance_results.csv", help="CSV path (default: current directory)")
    ap.add_argument("--summary", default=None, help="summary path (default: the CSV name with _summary.txt)")
    return ap


def _apply_preset(args, ap) -> None:
    preset = PRESETS[args.preset]
    defaults = {a.dest: a.default for a in ap._actions}
    for k, v in preset.items():
        if k in ("no_range", "no_tactical_reload", "include_hidden"):
            setattr(args, k, getattr(args, k) or v)
        elif getattr(args, k) == defaults.get(k):
            setattr(args, k, v)
    args.scenario = "sweep"


def main(argv=None) -> int:
    ap = build_parser()
    args = ap.parse_args(argv)
    if args.preset:
        _apply_preset(args, ap)
    if args.sweep and args.scenario == "all":
        args.scenario = "sweep"

    base = default_pool()
    pool = replace(base,
                   health=base.health if args.health is None else args.health,
                   armour=base.armour if args.armour is None else args.armour,
                   shield=base.shield if args.shield is None else args.shield,
                   respawn_ms=base.respawn_ms if args.respawn_s is None else args.respawn_s * 1000.0)
    cfg = SimConfig(pool=pool, venue=args.venue or default_venue(), range_model=not args.no_range,
                    tactical_reload=not args.no_tactical_reload,
                    hit_probs=tuple(float(x) for x in parse_values(args.hit_prob)),
                    match_ms=args.match_seconds * 1000.0, contact_mean_s=args.contact_mean_s,
                    gap_mean_s=args.gap_mean_s)
    ns = [int(n) for n in parse_values(args.n)]
    cat = WeaponCatalog()
    summary_path = args.summary or (os.path.splitext(args.out)[0] + "_summary.txt")
    t0 = walltime.time()
    rows: list[dict] = []

    if args.scenario == "sweep":
        if not args.weapon or not args.sweep:
            ap.error("a sweep needs --weapon and --sweep")
        anchor_id = anchor_for(weapon_model(cat, args.weapon), args.anchor)
        anchor = weapon_model(cat, anchor_id)
        axes = parse_sweep(args.sweep)
        results = []
        combos = list(itertools.product(*[vals for _, vals in axes]))
        jobs, meta = [], []
        for combo in combos:
            changes = dict(zip([p for p, _ in axes], combo))
            params = " ".join(f"{k}={v}" for k, v in changes.items())
            m = weapon_model(catalogue_with(cat, args.weapon, changes), args.weapon)
            for n in ns:
                jobs.append(("team", m, anchor, n, cfg, args.reps, args.seed, params))
                meta.append(params)
            jobs.append(("duel", m, anchor, cfg, args.duel_reps, args.seed, params))
            meta.append(params)
        out = run_jobs(jobs, args.jobs)
        by_params: dict = {}
        for params, r in zip(meta, out):
            if isinstance(r, TeamResult):
                rows.append(team_row(r, cfg, "sweep_team", params))
                by_params.setdefault(params, {"team": [], "duel": None})["team"].append(r)
            else:
                rows.append(duel_row(r, cfg, "sweep_duel", params))
                by_params.setdefault(params, {"team": [], "duel": None})["duel"] = r
        for params, d in by_params.items():
            gm = geo_mean(r.ratio for r in d["team"])
            results.append((abs(math.log(gm)) if gm > 0 else float("inf"), params, gm, d))
        results.sort()
        lines = [f"SWEEP {args.weapon} against {anchor_id}: {len(combos)} grid points, closest to parity first",
                 f"pool {pool.health}/{pool.armour}/{pool.shield}, respawn {pool.respawn_ms / 1000:g} s, venue "
                 f"{cfg.venue}, range {'on' if cfg.range_model else 'off'}, tactical reload "
                 f"{'on' if cfg.tactical_reload else 'off'}, N {ns[0]}..{ns[-1]}", "",
                 f"{'params':<50}{'team gm':>8}{'N=' + str(ns[0]):>7}{'N=' + str(ns[-1]):>7}{'1v1':>6}{'dot kills':>10}"]
        for _dist, params, gm, d in results[:25]:
            t = d["team"]
            kt = sum(r.kills_test for r in t)
            dk = sum(r.dot_kills_test for r in t) / kt if kt else 0.0
            lines.append(f"{params:<50}{gm:>8.2f}{t[0].ratio:>7.2f}{t[-1].ratio:>7.2f}"
                         f"{d['duel'].win_rate:>6.0%}{dk:>10.0%}")
        text = "\n".join(lines) + "\n"
    else:
        ids, skipped = catalogue_ids(cat, args.include_hidden)
        if args.weapon:
            ids = [args.weapon]
        models = [weapon_model(cat, i) for i in ids]
        anchor_ids = {m.weapon_id: anchor_for(m, args.anchor) for m in models}
        anchor_models = {a: weapon_model(cat, a) for a in set(anchor_ids.values())}
        anchors = {wid: anchor_models[a] for wid, a in anchor_ids.items()}
        duels: dict = {}
        teams: dict = {}
        if args.scenario in ("all", "duel"):
            duels = duel_matrix(models, cfg, args.duel_reps, args.seed, args.jobs)
            rows += [duel_row(duels[(a.weapon_id, b.weapon_id)], cfg) for a in models for b in models]
        if args.scenario in ("all", "team"):
            teams = team_table(models, anchors, ns, cfg, args.reps, args.seed, args.jobs)
            rows += [team_row(teams[(m.weapon_id, n)], cfg) for m in models for n in ns]
        ranked = rank_weapons(models, teams, duels, ns, anchor_ids)
        rule = args.anchor or ", ".join(f"{k}s vs {v}" for k, v in ROLE_ANCHORS.items()) + f", else {DEFAULT_ANCHOR}"
        text = summary_text(ranked, cfg, rule, ns, skipped,
                            f"BALANCE: {len(models)} weapons"
                            f"{' (hidden included)' if args.include_hidden else ''}, furthest from parity first")

    with open(args.out, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        w.writerows(rows)
    with open(summary_path, "w") as f:
        f.write(text)
    sys.stdout.write(text)
    print(f"\n{len(rows)} rows in {walltime.time() - t0:.1f} s -> {args.out}, {summary_path}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
