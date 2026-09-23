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
          anchor weapons of its own slot kind (assumption 5). The number is the kill-rate ratio, test carriers'
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
  (spec/node.md §3.17). A stacking DoT (``stack: true``) or a non-refreshing one (``refresh: false``)
  is refused: no row carries either.

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
5. Anchors by slot kind (``anchor_for()``): a sidearm is compared with ``usp``, every other weapon
   with ``assault_rifle``. ``--anchor`` overrides both. A pick-up-only weapon gets a ratio but no
   DOMINATES / DOMINATED flag: no loadout weapon competes with it for a slot.
6. Tactical reload (switch off with ``--no-tactical-reload``): when a contact ends with less than
   half a magazine, the player reloads before the next contact.
7. Match length 150 s. Kills per minute is a rate, so a short match widens the variance but does
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
from brx_mcp.mc.compile import CHARGE_TAP_CADENCE_MS, HEALTH_PRESETS, WeaponCatalog  # noqa: E402

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
    if dot and dot.get("refresh") is False:
        # `_hit()` always resets `poison_left`/`poison_dmg`/`poison_tick_ms` to a fresh clock on every hit --
        # that models `refresh: true` only. A row that declares `refresh: false` would need a hit to leave an
        # existing clock alone, which nothing here does, so it is refused the same way a stacking DoT is above.
        raise ValueError(f"{weapon_id}: a non-refreshing DoT is not modelled (no catalogue row carries refresh: false)")
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
        """Between contacts, a player below half a magazine reloads (assumption 6)."""
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
# Recoil duel mode (F291): Tony's three 2026-09-23 balance rules, checked stochastically
# --------------------------------------------------------------------------- #
#
# `--scenario recoil-duel` runs a discrete-event 1v1 between an Assault Rifle and a Charge Rifle (rules
# 1-2) or two Assault Rifles (rule 3), rolling a hit for every round and applying the SAME recoil
# accuracy model the phone runs. It is deliberately a separate, simpler engine from `Match` above:
# `Match` models a many-player skirmish with range bands and DoT; this models one specific mechanic
# (rounds-per-pull recoil) that `Match` does not touch at all.
#
# THE RECOIL MODEL IS COPIED FROM `app/src/engine.js`, NOT RE-DERIVED. `_recoilProfile()` there is the
# source of truth (S54/F268/F280, 2026-09-23): if the two ever disagree, engine.js is right and
# `recoil_profile()` below needs to change, not the other way round. `test_balance_sim.py` pins this
# function's Assault Rifle output against the same numbers `app/test/engine.test.mjs` pins, so a change
# to either file's constants shows up as a red test in the other.
RECOIL_CLEAN_ROUNDS = 5          # engine.js RECOIL_CLEAN_ROUNDS
RECOIL_HEAVY_EXTRA_ROUNDS = 3    # engine.js RECOIL_HEAVY_EXTRA_ROUNDS
RECOIL_REF_DMG = 8               # engine.js RECOIL_REF_DMG (the Assault Rifle/SMG/Energy Rifle's own dmg)
RECOIL_SETTLE_MIN_MS = 600.0     # engine.js RECOIL_SETTLE_MIN_MS
# The Charge Rifle's own build time is a bench "by feel" figure, not a wire number (weapons.json
# charge_rifle notes, 2026-09-23): the wire's t14 reads 1250 ms, but a full charge takes about 3.5 s to
# build. Rule 2 (an AR catching an uncharged CR) uses it as the duel's time cap: past that point the CR
# is no longer "uncharged" by the rule's own premise, so the fight is out of scope for this rule.
CHARGE_BUILD_MS = 3500.0


def _js_round(x: float) -> int:
    """`Math.round()`: half rounds toward +Infinity, unlike Python's round-half-to-even. None of the
    shipped catalogue rows land exactly on a .5 today, but a copy of engine.js should still copy its
    rounding rule, not Python's."""
    return math.floor(x + 0.5)


@dataclass(frozen=True)
class RecoilProfile:
    crisp: float
    degraded: float
    heavy: float | None
    after_shots: int
    heavy_after: int
    settle_ms: float


def recoil_profile(row: dict) -> RecoilProfile | None:
    """A raw `weapons.json` row's `recoil` block, resolved to the three-state shape the gun is actually
    driven with. A line-for-line mirror of `Engine.prototype._recoilProfile()` in `app/src/engine.js`
    (S54/F268/F280): read that function's own docstring for what each field means and why. `None` for a
    weapon with no `recoil` block, or whose floor is not below its ceiling (a one-press trigger such as
    the Burst Rifle: it cannot be held in full auto, so it has nothing to degrade)."""
    r = row.get("recoil")
    if not r:
        return None
    crisp = float(r["crisp"] if r.get("crisp") is not None else r["ceiling"])
    bottom = float(r["heavy"] if r.get("heavy") is not None else r["floor"])
    if not (crisp > 0) or not (bottom < crisp):
        return None
    stats = row.get("stats") or {}
    dmg = float(stats["dmg"] if stats.get("dmg") is not None else (row.get("dmg") or 0))
    k = RECOIL_REF_DMG / dmg if dmg > 0 else 1.0
    clean = max(2, _js_round(RECOIL_CLEAN_ROUNDS * k))
    derived_after = clean + 1
    after = _js_round(r["after_shots"] if r.get("after_shots") is not None else derived_after)
    settle = max(RECOIL_SETTLE_MIN_MS,
                 float((r["settle_ms"] if r.get("settle_ms") is not None else r.get("recover_ms")) or 0))
    if not (after > 0):
        return None
    mid = _js_round(r["degraded"] if r.get("degraded") is not None else math.floor((crisp + bottom) / 2))
    two = bottom < mid < crisp
    extra = _js_round(RECOIL_HEAVY_EXTRA_ROUNDS * k)
    derived_heavy_after = max(after + 1, clean + extra + 1)
    heavy_after = _js_round(r["after_heavy"] if r.get("after_heavy") is not None else derived_heavy_after) \
        if two else 0
    return RecoilProfile(crisp=crisp, degraded=(mid if two else bottom), heavy=(bottom if two else None),
                         after_shots=after, heavy_after=heavy_after, settle_ms=settle)


def _recoil_step(profile: RecoilProfile | None, state: str, burst: int) -> tuple[str, int]:
    """One landed round: bump the trigger-pull round count and return the state it earns. Mirrors
    engine.js `_recoilStep()`: the BURST COUNT decides the state outright, it never walks one rung at a
    time from whatever the state was before this round."""
    if profile is None:
        return state, burst
    burst += 1
    if profile.heavy is not None and burst >= profile.heavy_after:
        state = "heavy"
    elif burst >= profile.after_shots:
        state = "degraded"
    else:
        state = "crisp"
    return state, burst


def _accuracy_pct(profile: RecoilProfile | None, state: str) -> float:
    if profile is None:
        return 100.0
    return {"crisp": profile.crisp, "degraded": profile.degraded, "heavy": profile.heavy}[state]


def _ar_shots(first_time: float, dmg: int, fire_ms: float, mag: int, reserve: int, reload_ms: float,
             profile: RecoilProfile | None, aim_factor: float, *, burst_min: int | None = None,
             burst_max: int | None = None, pause_min_ms: float = 0.0, pause_max_ms: float = 0.0,
             rng: random.Random | None = None):
    """Yields `(t, hit_p, dmg)` for one Assault Rifle combatant, in firing order. Full auto
    (`burst_min` is None) empties the magazine in one unbroken hold: the recoil ladder is never
    released, so it walks up and stays wherever the round count lands it, all the way to the reload.
    Controlled bursts (`burst_min`/`burst_max` given) fire a random `[burst_min, burst_max]` rounds,
    then release: the app's own `_onButton` resets the round count OUTRIGHT the moment the state is
    still crisp on release (no settle needed), so a burst short enough never degrades the weapon at
    all. A burst that DID degrade only recovers if the pause is at least `settle_ms` (600 ms floor) —
    a 150-300 ms pause between bursts is not, so a weapon that got hot in one burst stays hot into the
    next. A reload is a trigger release too, and it is always far longer than `settle_ms`."""
    ammo, res = mag, reserve
    state, burst = "crisp", 0
    t = first_time
    burst_mode = burst_min is not None
    while True:
        if ammo <= 0:
            if res <= 0:
                return
            got = min(mag, res)
            t += reload_ms
            ammo, res = got, res - got
            state, burst = "crisp", 0   # the reload is a release: the gun comes back crisp
        blen = min(ammo, rng.randint(burst_min, burst_max)) if burst_mode else ammo
        for _ in range(blen):
            hit_p = (_accuracy_pct(profile, state) / 100.0) * aim_factor
            yield (t, hit_p, dmg)
            ammo -= 1
            state, burst = _recoil_step(profile, state, burst)
            t += fire_ms
        if not burst_mode:
            continue   # full auto never releases; the mag running dry is the only interruption
        if state == "crisp":
            burst = 0
        pause = rng.uniform(pause_min_ms, pause_max_ms)
        t += pause
        if state != "crisp" and profile is not None and pause >= profile.settle_ms:
            state, burst = "crisp", 0


def _cr_shots(first_time: float, charge_dmg: int, tap_dmg: int, rounds_per_charge: int, tap_ms: float,
             mag: int, reserve: int, reload_ms: float, aim_factor: float, *, start_charged: bool):
    """Yields `(t, hit_p, dmg)` for one Charge Rifle combatant. The Charge Rifle's own `recoil` block
    (`ceiling == floor == 100`) carries no profile at all, so its accuracy is always 100: every hit
    chance here is `aim_factor` alone, charge or tap. `start_charged` fires the pre-built charge as the
    first action (rule 1); otherwise the combatant is caught mid-fight with no charge ready and taps
    only, for the whole duel — rule 2's own premise, not a thing this generator re-derives."""
    ammo, res = mag, reserve
    t = first_time
    charged = start_charged
    while True:
        need = rounds_per_charge if charged else 1
        if ammo < need:
            if res <= 0:
                return
            got = min(mag, res)
            if got <= 0:
                return
            t += reload_ms
            ammo, res = got, res - got
            continue
        dmg = charge_dmg if charged else tap_dmg
        yield (t, aim_factor, dmg)
        ammo -= need
        charged = False
        t += tap_ms


def _pump_shots(first_time: float, dmg: int, fire_ms: float, mag: int, reserve: int, reload_ms: float,
                aim_factor: float):
    """Yields `(t, hit_p, dmg)` for a single-word-per-pull, no-recoil, chain-reload combatant (the
    Shotgun): a fixed `fire_ms` between pulls (t14, the gun-enforced PUMP gap, not a recoil model --
    weapon-design.md's Balance rules table row 6/R8), reload PER SHELL (`reload_type: chain`) once the
    tube runs dry, same convention as `Match._start_reload()`'s chain branch."""
    ammo, res = mag, reserve
    t = first_time
    while True:
        if ammo <= 0:
            if res <= 0:
                return
            got = min(mag, res)
            t += reload_ms * got            # chain reload: reload_ms is PER SHELL
            ammo, res = got, res - got
        yield (t, aim_factor, dmg)
        ammo -= 1
        t += fire_ms


def _burst3_shots(first_time: float, dmg: int, fire_ms: float, gap_ms: float, mag: int, reserve: int,
                  reload_ms: float, aim_factor: float):
    """Yields `(t, hit_p, dmg)` for a gun-ENFORCED 3-round burst combatant (t20 == 9, the Burst Rifle):
    three rounds at `fire_ms` spacing, then `gap_ms` (t23) before the next burst -- continuous, no
    player control and no recoil to hold or release (the row's `recoil.floor == ceiling`, so
    `recoil_profile()` is always `None` for it; unlike `_ar_shots`'s controlled-burst mode, there is no
    player-chosen pause here, only the gun's own enforced gap)."""
    ammo, res = mag, reserve
    t = first_time
    while True:
        if ammo <= 0:
            if res <= 0:
                return
            got = min(mag, res)
            t += reload_ms
            ammo, res = got, res - got
        blen = min(3, ammo)
        for i in range(blen):
            yield (t, aim_factor, dmg)
            ammo -= 1
            if i < blen - 1:
                t += fire_ms
        t += gap_ms


def _race(rng: random.Random, gen_a, gen_b, hp_a: int, hp_b: int, time_cap_ms: float) -> str | None:
    """Runs two shot generators against each other's health pool in time order, rolling a hit for every
    round. Returns `"a"`/`"b"` for the first to die, or `None` for a draw (both alive, or tied health,
    at `time_cap_ms`)."""
    hp = [hp_a, hp_b]
    gens = [gen_a, gen_b]
    nxt = [next(g, None) for g in gens]
    while True:
        cands = [i for i in (0, 1) if nxt[i] is not None and nxt[i][0] <= time_cap_ms]
        if not cands:
            break
        i = min(cands, key=lambda i: nxt[i][0])
        _, hit_p, dmg = nxt[i]
        if rng.random() < hit_p:
            j = 1 - i
            hp[j] -= dmg
            if hp[j] <= 0:
                return "a" if i == 0 else "b"
        nxt[i] = next(gens[i], None)
    if hp[0] == hp[1]:
        return None
    return "a" if hp[0] > hp[1] else "b"


@dataclass(frozen=True)
class RecoilDuelModel:
    """Every number the three duel rules need, read once from `WeaponCatalog` and the game's Standard
    health preset — nothing here is typed in by hand."""
    pool_hp: int
    ar_dmg: int
    ar_fire_ms: float
    ar_mag: int
    ar_reserve: int
    ar_reload_ms: float
    ar_profile: RecoilProfile | None
    cr_charge_dmg: int
    cr_tap_dmg: int
    cr_rounds_per_charge: int
    cr_mag: int
    cr_reserve: int
    cr_reload_ms: float
    # R4-R9 (F308): the SMG, the Shotgun and the Burst Rifle, read the same way -- see `run_range_duel()`.
    smg_gun_dmg: int
    smg_headset_dmg: int
    smg_fire_ms: float
    smg_mag: int
    smg_reserve: int
    smg_reload_ms: float
    smg_profile: RecoilProfile | None
    sg_gun_dmg: int
    sg_headset_dmg: int
    sg_fire_ms: float
    sg_mag: int
    sg_reserve: int
    sg_reload_ms: float
    br_dmg: int
    br_fire_ms: float
    br_gap_ms: float
    br_mag: int
    br_reserve: int
    br_reload_ms: float
    aim_factor: float
    reaction_mean_ms: float
    reaction_sd_ms: float
    burst_min: int
    burst_max: int
    burst_pause_min_ms: float
    burst_pause_max_ms: float
    time_cap_ms: float

    @classmethod
    def from_catalog(cls, cat: WeaponCatalog, *, aim_factor: float = 0.9, reaction_mean_ms: float = 250.0,
                     reaction_sd_ms: float = 80.0, burst_min: int = 3, burst_max: int = 5,
                     burst_pause_min_ms: float = 150.0, burst_pause_max_ms: float = 300.0,
                     time_cap_ms: float = 10_000.0) -> "RecoilDuelModel":
        hp, armour, _shield = HEALTH_PRESETS["standard"]
        ar_mag, ar_reserve, ar_reload_ms = cat._ammo("assault_rifle", None)
        cr_mag, cr_reserve, cr_reload_ms = cat._ammo("charge_rifle", None)
        smg_mag, smg_reserve, smg_reload_ms = cat._ammo("smg", None)
        sg_mag, sg_reserve, sg_reload_ms = cat._ammo("shotgun", None)
        br_mag, br_reserve, br_reload_ms = cat._ammo("burst_rifle", None)
        return cls(pool_hp=hp + armour, ar_dmg=cat.damage_per_pull("assault_rifle"),
                   ar_fire_ms=float(cat.fire_ms("assault_rifle")), ar_mag=ar_mag, ar_reserve=ar_reserve,
                   ar_reload_ms=float(ar_reload_ms), ar_profile=recoil_profile(cat._row("assault_rifle")),
                   cr_charge_dmg=cat.damage_per_pull("charge_rifle"), cr_tap_dmg=cat.tap_damage("charge_rifle"),
                   cr_rounds_per_charge=cat.rounds_per_charge("charge_rifle"), cr_mag=cr_mag,
                   cr_reserve=cr_reserve, cr_reload_ms=float(cr_reload_ms),
                   smg_gun_dmg=cat.damage("smg"), smg_headset_dmg=cat.damage_per_pull("smg") - cat.damage("smg"),
                   smg_fire_ms=float(cat.fire_ms("smg")), smg_mag=smg_mag, smg_reserve=smg_reserve,
                   smg_reload_ms=float(smg_reload_ms), smg_profile=recoil_profile(cat._row("smg")),
                   sg_gun_dmg=cat.damage("shotgun"),
                   sg_headset_dmg=cat.damage_per_pull("shotgun") - cat.damage("shotgun"),
                   sg_fire_ms=float(cat.fire_ms("shotgun")), sg_mag=sg_mag, sg_reserve=sg_reserve,
                   sg_reload_ms=float(sg_reload_ms),
                   br_dmg=cat.damage_per_pull("burst_rifle"), br_fire_ms=float(cat.fire_ms("burst_rifle")),
                   br_gap_ms=float(cat._frame_int("burst_rifle", "burst")), br_mag=br_mag,
                   br_reserve=br_reserve, br_reload_ms=float(br_reload_ms),
                   aim_factor=aim_factor,
                   reaction_mean_ms=reaction_mean_ms, reaction_sd_ms=reaction_sd_ms, burst_min=burst_min,
                   burst_max=burst_max, burst_pause_min_ms=burst_pause_min_ms,
                   burst_pause_max_ms=burst_pause_max_ms, time_cap_ms=time_cap_ms)

    def _reaction(self, rng: random.Random) -> float:
        return max(0.0, rng.gauss(self.reaction_mean_ms, self.reaction_sd_ms))


def run_recoil_duel_rule1(rng: random.Random, m: RecoilDuelModel, tap_ms: float) -> str | None:
    """Rule 1: a Charge Rifle player with a charge already built releases it the moment they act; the
    Assault Rifle reacts on its own clock and opens full auto. `"cr"`/`"ar"`/`None` (a draw)."""
    t_cr, t_ar = m._reaction(rng), m._reaction(rng)
    gen_cr = _cr_shots(t_cr, m.cr_charge_dmg, m.cr_tap_dmg, m.cr_rounds_per_charge, tap_ms, m.cr_mag,
                       m.cr_reserve, m.cr_reload_ms, m.aim_factor, start_charged=True)
    gen_ar = _ar_shots(t_ar, m.ar_dmg, m.ar_fire_ms, m.ar_mag, m.ar_reserve, m.ar_reload_ms, m.ar_profile,
                       m.aim_factor)
    return {"a": "cr", "b": "ar", None: None}[_race(rng, gen_cr, gen_ar, m.pool_hp, m.pool_hp, m.time_cap_ms)]


def run_recoil_duel_rule2(rng: random.Random, m: RecoilDuelModel, tap_ms: float) -> str | None:
    """Rule 2: the Assault Rifle catches an uncharged Charge Rifle and gets the first shot; the CR's own
    reaction is added ON TOP of the AR's (it reacts to being caught, not to a shared start). The AR
    player is the skilled one here (Tony, 2026-09-23 correction): the same controlled-burst discipline
    as rule 3, not full auto. The CR fights back with taps only, for the whole duel: it cannot build a
    fresh charge in time (about 3.5 s, `CHARGE_BUILD_MS`), which is also this duel's time cap — past it
    the CR is no longer "uncharged" by the rule's own premise. `"ar"`/`"cr"`/`None` (a draw)."""
    t_ar = m._reaction(rng)
    t_cr = t_ar + m._reaction(rng)
    gen_ar = _ar_shots(t_ar, m.ar_dmg, m.ar_fire_ms, m.ar_mag, m.ar_reserve, m.ar_reload_ms, m.ar_profile,
                       m.aim_factor, burst_min=m.burst_min, burst_max=m.burst_max,
                       pause_min_ms=m.burst_pause_min_ms, pause_max_ms=m.burst_pause_max_ms, rng=rng)
    gen_cr = _cr_shots(t_cr, m.cr_charge_dmg, m.cr_tap_dmg, m.cr_rounds_per_charge, tap_ms, m.cr_mag,
                       m.cr_reserve, m.cr_reload_ms, m.aim_factor, start_charged=False)
    return {"a": "ar", "b": "cr", None: None}[_race(rng, gen_ar, gen_cr, m.pool_hp, m.pool_hp, CHARGE_BUILD_MS)]


def run_recoil_duel_rule3(rng: random.Random, m: RecoilDuelModel) -> str | None:
    """Rule 3: two Assault Rifles. One fires controlled bursts (`burst_min`-`burst_max` rounds, a
    150-300 ms pause between); the other holds full auto until the magazine or the target runs out.
    `"burst"`/`"full_auto"`/`None` (a draw)."""
    t_burst, t_full = m._reaction(rng), m._reaction(rng)
    gen_burst = _ar_shots(t_burst, m.ar_dmg, m.ar_fire_ms, m.ar_mag, m.ar_reserve, m.ar_reload_ms,
                          m.ar_profile, m.aim_factor, burst_min=m.burst_min, burst_max=m.burst_max,
                          pause_min_ms=m.burst_pause_min_ms, pause_max_ms=m.burst_pause_max_ms, rng=rng)
    gen_full = _ar_shots(t_full, m.ar_dmg, m.ar_fire_ms, m.ar_mag, m.ar_reserve, m.ar_reload_ms,
                         m.ar_profile, m.aim_factor)
    winner = _race(rng, gen_burst, gen_full, m.pool_hp, m.pool_hp, m.time_cap_ms)
    return {"a": "burst", "b": "full_auto", None: None}[winner]


@dataclass
class RecoilDuelResult:
    label: str
    expected_winner: str
    reps: int
    wins: float   # duels the expected winner took; a draw counts half

    @property
    def win_rate(self) -> float:
        return self.wins / self.reps if self.reps else float("nan")

    def ci(self) -> tuple[float, float]:
        p, n = self.win_rate, self.reps
        half = 1.96 * math.sqrt(max(p * (1 - p), 1e-9) / n) if n else float("nan")
        return max(0.0, p - half), min(1.0, p + half)


def recoil_duel_batch(fn, expected_winner: str, reps: int, seed: int, label: str, *fn_args) -> RecoilDuelResult:
    """`reps` seeded, independent duels of `fn(rng, *fn_args)`; `expected_winner` is the label the rule
    claims wins most of the time. A draw counts half a win for both sides, same convention as `duel()`."""
    rng = cell_rng(seed, "recoil_duel", label)
    wins = 0.0
    for _ in range(reps):
        winner = fn(rng, *fn_args)
        wins += 1.0 if winner == expected_winner else (0.5 if winner is None else 0.0)
    return RecoilDuelResult(label, expected_winner, reps, wins)


RECOIL_RULES = {
    "1": ("Rule 1: charged CR beats AR", "cr", run_recoil_duel_rule1, True),
    "2": ("Rule 2: AR catches uncharged CR", "ar", run_recoil_duel_rule2, True),
    "3": ("Rule 3: AR burst beats AR full auto", "burst", run_recoil_duel_rule3, False),
}


def recoil_duel_report(m: RecoilDuelModel, reps: int, seed: int, rules=("1", "2", "3"),
                       tap_ms_current: float = CHARGE_TAP_CADENCE_MS,
                       tap_ms_proposed: float = 350.0) -> list[RecoilDuelResult]:
    """One `RecoilDuelResult` per rule; rules 1 and 2 run once at each tap cadence (the shipped
    `CHARGE_TAP_CADENCE_MS` and a proposed value), rule 3 once (it never touches the Charge Rifle)."""
    out = []
    for key in rules:
        _desc, expected, fn, tap_dependent = RECOIL_RULES[key]
        if tap_dependent:
            for tap_label, tap_ms in (("current", tap_ms_current), ("proposed", tap_ms_proposed)):
                out.append(recoil_duel_batch(fn, expected, reps, seed, f"rule{key}_tap_{tap_label}", m, tap_ms))
        else:
            out.append(recoil_duel_batch(fn, expected, reps, seed, f"rule{key}", m))
    return out


def recoil_duel_summary_text(results: list[RecoilDuelResult], m: RecoilDuelModel, tap_ms_current: float,
                             tap_ms_proposed: float) -> str:
    hp, armour, _shield = HEALTH_PRESETS["standard"]
    lines = [
        "RECOIL DUEL: Tony's three 2026-09-23 balance rules (F291), stochastic 1v1",
        f"pool {m.pool_hp} (Standard: {hp} health + {armour} armour); aim factor {m.aim_factor:g} "
        "(hit chance = accuracy/100 x aim factor -- the accuracy-to-hit-rate mapping is UNPROVEN on "
        f"the bench); reaction N({m.reaction_mean_ms:.0f}, {m.reaction_sd_ms:.0f}) ms/player; "
        f"burst {m.burst_min}-{m.burst_max} rounds, {m.burst_pause_min_ms:.0f}-{m.burst_pause_max_ms:.0f} ms pause",
        f"Charge Rifle tap cadence: current {tap_ms_current:g} ms (CHARGE_TAP_CADENCE_MS), "
        f"proposed {tap_ms_proposed:g} ms", "",
        f"{'rule':<45}{'tap':<10}{'win rate':>9}{'95% CI':>16}  flag",
    ]
    for r in results:
        rule_key = r.label.split("_")[0].replace("rule", "")
        desc = RECOIL_RULES[rule_key][0]
        tap = "-"
        if "_tap_" in r.label:
            tap = r.label.rsplit("_tap_", 1)[1]
        lo, hi = r.ci()
        flag = "UNDER 60%" if r.win_rate < 0.6 else ""
        lines.append(f"{desc:<45}{tap:<10}{r.win_rate:>9.1%}{f'[{lo:.1%}, {hi:.1%}]':>16}  {flag}")
    lines += ["", "\"most of the time\" = clearly above 50%; a rule under 60% is flagged."]
    return "\n".join(lines) + "\n"


# --------------------------------------------------------------------------- #
# Range duel mode (F308): Tony's 2026-09-23 R4-R9 close/mid-range balance rules, checked stochastically
# --------------------------------------------------------------------------- #
#
# `--scenario range-duel` extends the recoil-duel engine above with a RANGE BAND: "close" (both the gun
# word and a declared headset word land, `wire.headset_dmg`) or "mid" (past the headset word's own
# reach -- unmeasured, F275 -- the gun word only). The band is a fixed setting per duel, not a per-shot
# draw: Tony's rules are framed as "at close range" / "past the headset range", not a probability of
# being in range. It reuses `_ar_shots`, `_race`, `recoil_profile()` and `RecoilDuelModel` from the
# section above; only the SMG/Shotgun/Burst Rifle combatants and the band lookup are new.
#
# crit_pct (the Burst Rifle's 40%) is NOT modelled here, same simplification as rules 1-3's engine
# (which never had a crit weapon to leave out): `damage_per_pull()` is the whole per-round number.

def _pull_dmg(gun_dmg: int, headset_dmg: int, band: str) -> int:
    """What one pull delivers at a range band: both words at "close", the gun word alone past the
    headset word's own reach ("mid" -- F275, the headset word's real range is unmeasured)."""
    return gun_dmg + headset_dmg if band == "close" else gun_dmg


def _smg_combatant(t: float, m: RecoilDuelModel, band: str, rng: random.Random):
    dmg = _pull_dmg(m.smg_gun_dmg, m.smg_headset_dmg, band)
    return _ar_shots(t, dmg, m.smg_fire_ms, m.smg_mag, m.smg_reserve, m.smg_reload_ms, m.smg_profile,
                     m.aim_factor)   # full auto: R4/R8's "SMG on full auto, its best close use"


def _shotgun_combatant(t: float, m: RecoilDuelModel, band: str, rng: random.Random):
    dmg = _pull_dmg(m.sg_gun_dmg, m.sg_headset_dmg, band)
    return _pump_shots(t, dmg, m.sg_fire_ms, m.sg_mag, m.sg_reserve, m.sg_reload_ms, m.aim_factor)


def _burst_rifle_combatant(t: float, m: RecoilDuelModel, band: str, rng: random.Random):
    # No headset word declared on the Burst Rifle -- `band` never changes its damage.
    return _burst3_shots(t, m.br_dmg, m.br_fire_ms, m.br_gap_ms, m.br_mag, m.br_reserve, m.br_reload_ms,
                         m.aim_factor)


def _ar_burst_combatant(t: float, m: RecoilDuelModel, band: str, rng: random.Random):
    """"a bursting AR": the same controlled-3-to-5-round-burst discipline as recoil-duel rules 2/3."""
    return _ar_shots(t, m.ar_dmg, m.ar_fire_ms, m.ar_mag, m.ar_reserve, m.ar_reload_ms, m.ar_profile,
                     m.aim_factor, burst_min=m.burst_min, burst_max=m.burst_max,
                     pause_min_ms=m.burst_pause_min_ms, pause_max_ms=m.burst_pause_max_ms, rng=rng)


def _ar_full_combatant(t: float, m: RecoilDuelModel, band: str, rng: random.Random):
    """"a full-auto AR": held down, the same as recoil-duel rule 3's full-auto side."""
    return _ar_shots(t, m.ar_dmg, m.ar_fire_ms, m.ar_mag, m.ar_reserve, m.ar_reload_ms, m.ar_profile,
                     m.aim_factor)


RANGE_COMBATANTS = {
    "smg": _smg_combatant, "shotgun": _shotgun_combatant, "burst_rifle": _burst_rifle_combatant,
    "ar_burst": _ar_burst_combatant, "ar_full": _ar_full_combatant,
}


def run_range_duel(rng: random.Random, m: RecoilDuelModel, a_kind: str, b_kind: str, band: str) -> str | None:
    """One duel between two `RANGE_COMBATANTS` at a range band. Returns the WINNING KIND (not "a"/"b"),
    or `None` for a draw."""
    t_a, t_b = m._reaction(rng), m._reaction(rng)
    gen_a = RANGE_COMBATANTS[a_kind](t_a, m, band, rng)
    gen_b = RANGE_COMBATANTS[b_kind](t_b, m, band, rng)
    winner = _race(rng, gen_a, gen_b, m.pool_hp, m.pool_hp, m.time_cap_ms)
    return {"a": a_kind, "b": b_kind, None: None}[winner]


# (description, expected winner, side a, side b, band). R5 tests only against "a rifle" -- the
# bursting AR, the same reference discipline rules 1-3 use -- not also against the Burst Rifle: R4 is
# the rule that explicitly names BOTH ("a bursting AR, and the Burst Rifle"), R5 says only "a rifle".
RANGE_RULES = {
    "4a": ("R4 close range: the SMG (full auto) beats a bursting AR", "smg", "smg", "ar_burst", "close"),
    "4b": ("R4 close range: the SMG (full auto) beats the Burst Rifle", "smg", "smg", "burst_rifle", "close"),
    "4c": ("R4 close range: the Shotgun beats a bursting AR", "shotgun", "shotgun", "ar_burst", "close"),
    "4d": ("R4 close range: the Shotgun beats the Burst Rifle", "shotgun", "shotgun", "burst_rifle", "close"),
    "5a": ("R5 past headset range: a bursting AR beats the SMG (full auto)", "ar_burst", "ar_burst", "smg", "mid"),
    "5c": ("R5 past headset range: a bursting AR beats the Shotgun", "ar_burst", "ar_burst", "shotgun", "mid"),
    "6": ("R6: a bursting AR beats the Burst Rifle", "ar_burst", "ar_burst", "burst_rifle", "mid"),
    "7": ("R7: the Burst Rifle beats a full-auto AR", "burst_rifle", "burst_rifle", "ar_full", "mid"),
    "8": ("R8 close range: the Shotgun beats the SMG (full auto)", "shotgun", "shotgun", "smg", "close"),
    "9": ("R9 past headset range: the SMG (full auto) beats the Shotgun", "smg", "smg", "shotgun", "mid"),
}


def range_duel_batch(m: RecoilDuelModel, key: str, reps: int, seed: int) -> RecoilDuelResult:
    """`reps` seeded, independent duels of `RANGE_RULES[key]`. A draw counts half a win, same
    convention as `duel()`/`recoil_duel_batch()`."""
    _desc, expected, a_kind, b_kind, band = RANGE_RULES[key]
    rng = cell_rng(seed, "range_duel", key)
    wins = 0.0
    for _ in range(reps):
        winner = run_range_duel(rng, m, a_kind, b_kind, band)
        wins += 1.0 if winner == expected else (0.5 if winner is None else 0.0)
    return RecoilDuelResult(f"range_{key}", expected, reps, wins)


def range_duel_report(m: RecoilDuelModel, reps: int, seed: int, keys=tuple(RANGE_RULES)) -> list[RecoilDuelResult]:
    return [range_duel_batch(m, key, reps, seed) for key in keys]


def range_duel_summary_text(results: list[RecoilDuelResult], m: RecoilDuelModel) -> str:
    lines = [
        "RANGE DUEL: Tony's 2026-09-23 close/mid-range balance rules R4-R9 (F308), stochastic 1v1",
        f"pool {m.pool_hp}; aim factor {m.aim_factor:g}; reaction N({m.reaction_mean_ms:.0f}, "
        f"{m.reaction_sd_ms:.0f}) ms/player; bursting AR: {m.burst_min}-{m.burst_max} rounds, "
        f"{m.burst_pause_min_ms:.0f}-{m.burst_pause_max_ms:.0f} ms pause; close = gun word + declared "
        "headset word, mid = gun word only (past the headset word's own reach, unmeasured -- F275)", "",
        f"{'rule':<62}{'win rate':>9}{'95% CI':>16}  flag",
    ]
    for r in results:
        key = r.label.replace("range_", "", 1)
        desc = RANGE_RULES[key][0]
        lo, hi = r.ci()
        flag = "UNDER 65%" if r.win_rate < 0.65 else ""
        lines.append(f"{desc:<62}{r.win_rate:>9.1%}{f'[{lo:.1%}, {hi:.1%}]':>16}  {flag}")
    lines += ["", "\"most of the time\" = at least 65% (docs/weapon-design.md's Balance rules table)."]
    return "\n".join(lines) + "\n"


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #

def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="balance_sim.py", description=__doc__.split("\n\n")[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter,
                                 epilog="Assumptions and simplifications: see the module docstring.")
    ap.add_argument("--scenario", choices=("all", "duel", "team", "sweep", "recoil-duel", "range-duel"),
                    default="all",
                    help="all = duel matrix + team table (default); --sweep implies sweep; recoil-duel = "
                         "F291's stochastic AR/CR 1v1 (rules 1-3); range-duel = F308's stochastic "
                         "close/mid-range 1v1 (rules R4-R9), see the module docstring")
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
    g = ap.add_argument_group("recoil-duel (F291)")
    g.add_argument("--recoil-rule", choices=("1", "2", "3", "all"), default="all",
                   help="which of Tony's three rules to run (default all)")
    g.add_argument("--recoil-reps", type=int, default=10_000, help="duels per rule/tap-cadence cell")
    g.add_argument("--recoil-seed", type=int, default=None, help="default: --seed")
    g.add_argument("--aim-factor", type=float, default=0.9,
                   help="base aim factor: hit chance = accuracy/100 x this (unproven on the bench)")
    g.add_argument("--tap-ms", type=float, default=None,
                   help="Charge Rifle tap cadence, the 'current' column (default: CHARGE_TAP_CADENCE_MS, "
                        "285, the player's own bench-measured pull rate -- NOT a $WEAP token, the gun "
                        "does not read or enforce it, see the module's CHARGE_TAP_CADENCE_MS comment)")
    g.add_argument("--tap-ms-proposed", type=float, default=350.0,
                   help="a second cadence column for comparison only; changing it tests a hypothesis "
                        "about how fast a player can physically tap, never a lever the gun ships")
    g.add_argument("--reaction-mean-ms", type=float, default=250.0)
    g.add_argument("--reaction-sd-ms", type=float, default=80.0)
    g.add_argument("--burst-min", type=int, default=3, help="rule 3: shortest controlled burst, rounds")
    g.add_argument("--burst-max", type=int, default=5, help="rule 3: longest controlled burst, rounds")
    g.add_argument("--burst-pause-min-ms", type=float, default=150.0)
    g.add_argument("--burst-pause-max-ms", type=float, default=300.0)
    g2 = ap.add_argument_group("range-duel (F308)")
    g2.add_argument("--range-rule", choices=sorted(RANGE_RULES) + ["all"], default="all",
                    help="which of Tony's R4-R9 rules to run (default all)")
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


def _run_recoil_duel(args) -> int:
    cat = WeaponCatalog()
    m = RecoilDuelModel.from_catalog(cat, aim_factor=args.aim_factor, reaction_mean_ms=args.reaction_mean_ms,
                                     reaction_sd_ms=args.reaction_sd_ms, burst_min=args.burst_min,
                                     burst_max=args.burst_max, burst_pause_min_ms=args.burst_pause_min_ms,
                                     burst_pause_max_ms=args.burst_pause_max_ms)
    seed = args.recoil_seed if args.recoil_seed is not None else args.seed
    tap_current = args.tap_ms if args.tap_ms is not None else float(CHARGE_TAP_CADENCE_MS)
    rules = ("1", "2", "3") if args.recoil_rule == "all" else (args.recoil_rule,)
    t0 = walltime.time()
    results = recoil_duel_report(m, args.recoil_reps, seed, rules, tap_current, args.tap_ms_proposed)
    text = recoil_duel_summary_text(results, m, tap_current, args.tap_ms_proposed)
    summary_path = args.summary or (os.path.splitext(args.out)[0] + "_summary.txt")
    with open(summary_path, "w") as f:
        f.write(text)
    sys.stdout.write(text)
    print(f"\n{len(results)} cells, {sum(r.reps for r in results)} duels in {walltime.time() - t0:.1f} s -> "
         f"{summary_path}", file=sys.stderr)
    return 0


def _run_range_duel(args) -> int:
    cat = WeaponCatalog()
    m = RecoilDuelModel.from_catalog(cat, aim_factor=args.aim_factor, reaction_mean_ms=args.reaction_mean_ms,
                                     reaction_sd_ms=args.reaction_sd_ms, burst_min=args.burst_min,
                                     burst_max=args.burst_max, burst_pause_min_ms=args.burst_pause_min_ms,
                                     burst_pause_max_ms=args.burst_pause_max_ms)
    seed = args.recoil_seed if args.recoil_seed is not None else args.seed
    keys = tuple(sorted(RANGE_RULES)) if args.range_rule == "all" else (args.range_rule,)
    t0 = walltime.time()
    results = range_duel_report(m, args.recoil_reps, seed, keys)
    text = range_duel_summary_text(results, m)
    summary_path = args.summary or (os.path.splitext(args.out)[0] + "_summary.txt")
    with open(summary_path, "w") as f:
        f.write(text)
    sys.stdout.write(text)
    print(f"\n{len(results)} cells, {sum(r.reps for r in results)} duels in {walltime.time() - t0:.1f} s -> "
         f"{summary_path}", file=sys.stderr)
    return 0


def main(argv=None) -> int:
    ap = build_parser()
    args = ap.parse_args(argv)
    if args.preset:
        _apply_preset(args, ap)
    if args.sweep and args.scenario == "all":
        args.scenario = "sweep"

    if args.scenario == "recoil-duel":
        return _run_recoil_duel(args)
    if args.scenario == "range-duel":
        return _run_range_duel(args)

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
