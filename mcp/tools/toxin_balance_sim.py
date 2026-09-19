#!/usr/bin/env python3
"""Monte Carlo combat balance simulation for the Toxin Rifle (Open BRX laser tag).

Standard library only. Run with ``python3 mcp/tools/toxin_balance_sim.py --help``.

WHAT THIS MODELS
-----------------
Two teams of N players (N = 2..10) fight a timed deathmatch. Each team fields one
Toxin Rifle carrier and (N - 1) Assault Rifle carriers ("team mode"), and a
separate table runs bare 1v1 duels (toxin vs rifle, toxin vs toxin, "duel mode").
Players cycle between searching for a target and trading fire with one, using an
event-driven (not fixed-time-step) simulation clock: every state change (a shot,
a poison tick, a contact window ending, a death, a respawn) is a discrete event on
a priority queue (heapq), processed in time order. This is mathematically
equivalent to a fixed 10 ms time-step sweep for this model (nothing changes state
between events) and is far cheaper to run, which matters for the size of the sweep
below.

SOURCE NUMBERS (read from mcp/brx_mcp/mc/weapons.json, "wire" over top-level)
------------------------------------------------------------------------------
  Toxin Rifle : wire.dmg=8, wire.fire_ms=110, mag=30, reserve=180, reload_ms=1600
                dot.per_tick=4, dot.tick_ms=1000, dot.duration_ms=5000, refresh,
                no stack.
  Assault Rifle (anchor): dmg=8 (no wire.dmg override), wire.fire_ms=100, mag=32,
                reserve=192, reload_ms=1400.
  Standard pool (mcp/brx_mcp/mc/compile.py DEFAULT_CONFIG / state.py mode
  defaults): shield 0, armour 70, health 45 = 115.
  Respawn delay: CONFIRMED as 15 s (mcp/brx_mcp/mc/state.py GAME_MODES,
  "standard"/"ffa" -> respawn.delay_s = 15; the brief's fallback guess of 10 s was
  NOT used because the real value was found).

MODELLING ASSUMPTIONS (every one the brief asked us to state)
----------------------------------------------------------------
1.  Direct-hit damage spills normally through the pool in order shield -> armour
    -> health (each pool fully drained before the next is touched), with no
    damage-reduction multiplier. This is `WeaponCatalog.hits_to_kill()`'s model: armour
    absorbs at face value and spills into health, so the rifle's 9 reproduces the
    catalogue's htk of 13 against the 115 pool.
2.  A poison tick takes its damage from the OUTERMOST non-empty pool only
    (shield, then armour, then health), with NO spill to the next pool inside
    one tick, matching spec/node.md S3.17 exactly.
3.  Every direct hit from the Toxin Rifle applies poison: no proc chance, and
    crit_pct (15% in the catalogue) is ignored for this weapon per the brief.
4.  Poison refreshes rather than stacks: a new hit resets the remaining tick
    count to the full duration and reassigns the credited "applier" to the
    most recent shooter. This is the brief's explicit assumption for kill
    credit, since spec/node.md S3.17 calls attribution "an open decision".
5.  A poison stack ends on expiry (its tick counter reaches zero without a
    kill), on death, and on respawn -- it never survives a life.
6.  Kill credit: a direct-hit kill credits the shooter. A poison-tick kill
    credits the current applier (the most recent Toxin Rifle shooter to hit
    that victim).
7.  "Wasted poison" (reported per Toxin Rifle carrier, summed over the match):
    all poison-tick damage dealt to a victim during a life that ends in a
    DIRECT-hit death instead of a poison death -- that tick damage bought
    nothing towards the kill. Reported both as a damage amount and as a share
    of the carrier's total poison damage dealt.
8.  "Wasted refresh": a poison hit landing on a target whose existing stack
    has not yet ticked once (remaining ticks == the full duration's tick
    count). Such a hit only reassigns credit; it cannot add a tick that the
    old stack did not already have queued up.
9.  "Kills stolen": a poison-tick kill credited to the Toxin Rifle carrier
    where that carrier's own cumulative damage (direct + poison, over the
    victim's current life) is under 50% of the total damage the victim took
    that life. This can happen because a teammate's direct fire did most of
    the work while the poison tick landed the final point.
10. "Invisible kill": a poison-tick kill that lands after the applying
    carrier's own contact window with that victim had already ended (i.e. the
    carrier was no longer trading fire with the victim when the fatal tick
    fired). We record the contact-window end time at the moment the fatal
    stack was last applied/refreshed and compare it to the tick's fire time.
11. Engagement / focus-fire model: each player independently runs a
    seek -> engage -> break -> seek cycle against the OPPOSING team (we do not
    force symmetric 1:1 pairing; mutual fights emerge statistically because
    both sides run the same process). On a seek attempt a free player joins
    an already-engaged enemy (adding to the attacker count on that target,
    i.e. focus fire) with probability p_join(N); otherwise it picks a fresh
    random enemy. p_join(N) = min(0.7, 0.08 * (N - 1)), an explicit,
    documented, monotonically increasing function of team size N (0 at N=1,
    0.08 at N=2, capped at 0.7 from about N=9.75 up). Contact-window duration
    is exponential with a swept mean (this is where "line of sight windows"
    lives); the gap between contacts is exponential with a fixed 3.0 s mean
    (not swept -- kept fixed to bound the grid; see the runtime note below).
12. Magazines and reloads follow the catalogue values; a reload blocks firing
    for reload_ms and refills the magazine from reserve ammunition. Running
    the reserve dry stops that life from firing again until respawn refills
    both mag and reserve (rare in these short matches).
13. Both teams in "team mode" run an identical weapon composition (one Toxin
    Rifle, N-1 Assault Rifles), so every cell pools both teams' Toxin Rifle
    (and both teams' Assault Rifle) carriers together for statistics --
    doubling the effective sample without extra matches.
14. Match length is cut from the brief's illustrative 10 minutes to 150 s
    (2.5 min) by default, which keeps the full sweep (5 damage values x 5
    tick values x 3 durations x 3 hit-chances x 9 team sizes = 2 025
    team-mode cells, at full grid resolution, plus a 450-cell duel table and
    a 27-cell line-of-sight sensitivity table) inside the ~10 minute runtime
    budget with reps to spare: measured on this machine, 8 team-mode reps
    per cell took 33 s total, so the default was raised to 60 reps per
    team-mode cell (300 for the much cheaper duel cells), which still
    finishes in well under 6 minutes. KPM is a rate, so a shorter match does
    not bias it, only widens each match's contribution to the variance,
    which more reps compensate for. Confidence intervals are computed
    analytically from the aggregated kill counts across all reps in a cell
    (Poisson-count relative standard error sqrt(1/Ka + 1/Kb) on the rate
    ratio) rather than by bootstrapping per-match ratios, which is far
    cheaper and is reported alongside every headline number.
15. All damage values in the sweep apply ONLY to the Toxin Rifle side; the
    Assault Rifle anchor is always run at its catalogue values (dmg 8,
    fire_ms 100). The poison tick interval is fixed at 1000 ms per the brief.

Reproducibility: one ``random.Random`` instance, seeded once from --seed
(default 20260919), is used for the whole run in a fixed iteration order, so a
re-run with the same seed and grid reproduces the same CSV byte-for-byte.
"""

from __future__ import annotations

import argparse
import csv
import heapq
import itertools
import math
import statistics
import sys
import time as walltime
from dataclasses import dataclass, field

# --------------------------------------------------------------------------- #
# Catalogue constants (mcp/brx_mcp/mc/weapons.json)
# --------------------------------------------------------------------------- #

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parents[1]))
from brx_mcp.mc.compile import WeaponCatalog  # noqa: E402

_CAT = WeaponCatalog()


def _row(weapon_id: str) -> dict:
    """The catalogue row, with its `wire` block (what the gun really does) laid over the top level."""
    row = _CAT._by_id[weapon_id]
    return {**row, **(row.get("wire") or {})}


# Read from the catalogue, never typed in: a hand copy of the rifle's damage (8, not the real 9)
# made the baseline weak and the first sweep flattered the Toxin Rifle.
_RIFLE, _TOXIN = _row("assault_rifle"), _row("toxin_rifle")
RIFLE_FIRE_MS = _RIFLE["fire_ms"]
RIFLE_MAG = _RIFLE["mag"]
RIFLE_RESERVE = _RIFLE["reserve"]
RIFLE_RELOAD_MS = _RIFLE["reload_ms"]
RIFLE_DMG = _CAT.damage_per_pull("assault_rifle")

TOXIN_FIRE_MS = _TOXIN["fire_ms"]
TOXIN_MAG = _TOXIN["mag"]
TOXIN_RESERVE = _TOXIN["reserve"]
TOXIN_RELOAD_MS = _TOXIN["reload_ms"]
TOXIN_TICK_MS = 1000  # fixed per the brief

POOL_SHIELD = 0
POOL_ARMOUR = 70
POOL_HEALTH = 45
RESPAWN_MS = 15_000  # confirmed, see module docstring

GAP_MEAN_S = 3.0  # fixed seek gap between contacts, not swept (see assumption 11)
INITIAL_JITTER_MS = 500  # avoids lock-step artefacts at match start


def p_join(n: int) -> float:
    """Probability a free player joins an already-engaged enemy instead of
    picking a fresh one. Explicit, documented, rising with team size N."""
    return min(0.7, 0.08 * (n - 1))


# --------------------------------------------------------------------------- #
# Player state
# --------------------------------------------------------------------------- #

@dataclass(slots=True)
class Player:
    pid: int
    team: int
    weapon: str  # "toxin" or "rifle"
    direct_dmg: int
    fire_ms: int
    mag: int
    reserve_max: int
    reload_ms: int
    tick_dmg: int = 0
    duration_ms: int = 0

    alive: bool = True
    shield: int = POOL_SHIELD
    armour: int = POOL_ARMOUR
    health: int = POOL_HEALTH
    ammo: int = 0
    reserve: int = 0
    reload_until: float = -1.0

    target: int | None = None
    contact_end: float = 0.0
    engage_id: int = 0
    attackers_count: int = 0

    poison_gen: int = 0
    poison_applier: int | None = None
    poison_ticks_remaining: int = 0
    poison_contact_end_at_apply: float = 0.0
    poison_max_ticks: int = 0

    damage_by: dict = field(default_factory=dict)       # this life: total dmg by source
    poison_damage_by: dict = field(default_factory=dict)  # this life: poison-only dmg by source

    # stats accumulated over the whole match
    kills: int = 0
    deaths: int = 0
    shots_fired: int = 0
    poison_ticks_applied: int = 0
    poison_damage_dealt: int = 0
    poison_damage_wasted: int = 0
    wasted_refresh_count: int = 0
    invisible_kills: int = 0
    kills_stolen: int = 0


# --------------------------------------------------------------------------- #
# Event-driven match simulation
# --------------------------------------------------------------------------- #

class Match:
    """One event-driven deathmatch. Call run() then read player stats."""

    __slots__ = ("players", "rng", "match_ms", "contact_mean_s", "heap", "_seq", "_hit_prob")

    def __init__(self, players: list[Player], rng, match_ms: float, contact_mean_s: float,
                 hit_prob: float = 0.5):
        self.players = players
        self.rng = rng
        self.match_ms = match_ms
        self.contact_mean_s = contact_mean_s
        self.heap: list = []
        self._seq = itertools.count()
        self._hit_prob = hit_prob

    def push(self, t: float, kind: str, pid: int, gen: int = 0) -> None:
        heapq.heappush(self.heap, (t, next(self._seq), kind, pid, gen))

    def run(self) -> None:
        rng = self.rng
        for p in self.players:
            self.push(rng.uniform(0, INITIAL_JITTER_MS), "seek", p.pid)

        match_ms = self.match_ms
        while self.heap:
            t, _seq, kind, pid, gen = heapq.heappop(self.heap)
            if t > match_ms:
                break
            p = self.players[pid]
            if kind == "seek":
                self._on_seek(p, t)
            elif kind == "shot":
                self._on_shot(p, t, gen)
            elif kind == "contact_end":
                self._on_contact_end(p, t, gen)
            elif kind == "poison_tick":
                self._on_poison_tick(p, t, gen)
            elif kind == "respawn":
                self._on_respawn(p, t)

    # -- engagement lifecycle ------------------------------------------------

    def _on_seek(self, p: Player, t: float) -> None:
        if not p.alive:
            return
        enemies = [q for q in self.players if q.team != p.team and q.alive]
        if not enemies:
            self.push(t + 200.0, "seek", p.pid)
            return
        targeted = [q for q in enemies if q.attackers_count > 0]
        n = sum(1 for q in self.players if q.team == p.team)
        if targeted and self.rng.random() < p_join(n):
            target = self.rng.choice(targeted)
        else:
            target = self.rng.choice(enemies)
        self._start_engagement(p, target, t)

    def _start_engagement(self, attacker: Player, target: Player, t: float) -> None:
        attacker.engage_id += 1
        gen = attacker.engage_id
        attacker.target = target.pid
        dur_ms = self.rng.expovariate(1.0 / self.contact_mean_s) * 1000.0
        attacker.contact_end = t + dur_ms
        target.attackers_count += 1
        self.push(t, "shot", attacker.pid, gen)
        self.push(attacker.contact_end, "contact_end", attacker.pid, gen)

    def _on_contact_end(self, p: Player, t: float, gen: int) -> None:
        if not p.alive or p.engage_id != gen:
            return
        if p.target is not None:
            self.players[p.target].attackers_count -= 1
        p.target = None
        p.engage_id += 1
        gap_ms = self.rng.expovariate(1.0 / GAP_MEAN_S) * 1000.0
        self.push(t + gap_ms, "seek", p.pid)

    def _on_shot(self, p: Player, t: float, gen: int) -> None:
        if not p.alive or p.engage_id != gen or p.target is None or t > p.contact_end:
            return
        if p.reload_until >= 0.0 and t < p.reload_until:
            self.push(p.reload_until, "shot", p.pid, gen)
            return
        if p.reload_until >= 0.0 and t >= p.reload_until:
            p.reload_until = -1.0  # reload finished, ammo already topped up below
        target = self.players[p.target]
        if target.alive and p.ammo > 0:
            p.shots_fired += 1
            if self.rng.random() < self._hit_prob:
                self._apply_direct_hit(p, target, t)
        if p.ammo > 0:
            p.ammo -= 1
        if p.ammo <= 0:
            if p.reserve > 0:
                reload_amt = min(p.mag, p.reserve)
                p.reserve -= reload_amt
                p.ammo = reload_amt
                p.reload_until = t + p.reload_ms
                next_t = p.reload_until
            else:
                return  # dry: no more shots this life
        else:
            next_t = t + p.fire_ms
        if next_t <= p.contact_end:
            self.push(next_t, "shot", p.pid, gen)
        # else: contact will end before the next shot would land; the
        # contact_end event already scheduled will send this player back to
        # seeking, so nothing further to schedule here.

    # -- damage ---------------------------------------------------------------

    def _apply_direct_hit(self, attacker: Player, target: Player, t: float) -> None:
        dmg = attacker.direct_dmg
        remaining = dmg
        for pool_name in ("shield", "armour", "health"):
            if remaining <= 0:
                break
            avail = getattr(target, pool_name)
            take = min(avail, remaining)
            setattr(target, pool_name, avail - take)
            remaining -= take
        target.damage_by[attacker.pid] = target.damage_by.get(attacker.pid, 0) + (dmg - remaining)

        if attacker.weapon == "toxin":
            n_ticks = attacker.duration_ms // TOXIN_TICK_MS
            if target.poison_ticks_remaining >= n_ticks and target.poison_ticks_remaining > 0:
                attacker.wasted_refresh_count += 1
            target.poison_gen += 1
            gen = target.poison_gen
            target.poison_applier = attacker.pid
            target.poison_ticks_remaining = n_ticks
            target.poison_max_ticks = n_ticks
            target.poison_contact_end_at_apply = attacker.contact_end
            target.tick_dmg = attacker.tick_dmg
            self.push(t + TOXIN_TICK_MS, "poison_tick", target.pid, gen)

        if target.health <= 0:
            self._handle_death(target, attacker.pid, t, direct=True)

    def _on_poison_tick(self, target: Player, t: float, gen: int) -> None:
        if not target.alive or target.poison_gen != gen or target.poison_ticks_remaining <= 0:
            return
        applier_id = target.poison_applier
        applier = self.players[applier_id]
        outer = "shield" if target.shield > 0 else ("armour" if target.armour > 0 else "health")
        avail = getattr(target, outer)
        take = min(avail, target.tick_dmg)
        setattr(target, outer, avail - take)

        applier.poison_damage_dealt += take
        applier.poison_ticks_applied += 1
        target.damage_by[applier_id] = target.damage_by.get(applier_id, 0) + take
        target.poison_damage_by[applier_id] = target.poison_damage_by.get(applier_id, 0) + take

        target.poison_ticks_remaining -= 1
        if target.health <= 0:
            self._handle_death(
                target, applier_id, t, direct=False,
                contact_end_at_apply=target.poison_contact_end_at_apply,
            )
        elif target.poison_ticks_remaining > 0:
            self.push(t + TOXIN_TICK_MS, "poison_tick", target.pid, gen)

    def _handle_death(self, dead: Player, killer_id: int, t: float, direct: bool,
                       contact_end_at_apply: float = 0.0) -> None:
        dead.deaths += 1
        killer = self.players[killer_id]
        killer.kills += 1

        if not direct:
            if t > contact_end_at_apply:
                killer.invisible_kills += 1
            total_dmg = sum(dead.damage_by.values())
            killer_dmg = dead.damage_by.get(killer_id, 0)
            if killer.weapon == "toxin" and total_dmg > 0 and killer_dmg < 0.5 * total_dmg:
                killer.kills_stolen += 1
        else:
            for src_id, amt in dead.poison_damage_by.items():
                self.players[src_id].poison_damage_wasted += amt

        if dead.target is not None:
            self.players[dead.target].attackers_count -= 1
        dead.target = None
        dead.engage_id += 1

        dead.alive = False
        dead.poison_gen += 1
        dead.poison_ticks_remaining = 0
        dead.damage_by = {}
        dead.poison_damage_by = {}

        # Release every player currently attacking the corpse: they stop
        # shooting immediately rather than waiting out their exponential
        # contact timer against a dead target (would otherwise waste shots
        # and delay re-engagement).
        if dead.attackers_count > 0:
            for q in self.players:
                if q.alive and q.target == dead.pid:
                    q.target = None
                    q.engage_id += 1
                    gap_ms = self.rng.expovariate(1.0 / GAP_MEAN_S) * 1000.0
                    self.push(t + gap_ms, "seek", q.pid)
            dead.attackers_count = 0

        self.push(t + RESPAWN_MS, "respawn", dead.pid)

    def _on_respawn(self, p: Player, t: float) -> None:
        p.alive = True
        p.shield, p.armour, p.health = POOL_SHIELD, POOL_ARMOUR, POOL_HEALTH
        p.ammo = p.mag
        p.reserve = p.reserve_max
        p.reload_until = -1.0
        p.damage_by = {}
        p.poison_damage_by = {}
        p.poison_gen += 1
        p.poison_ticks_remaining = 0
        self.push(t, "seek", p.pid)


def make_player(pid: int, team: int, weapon: str, hit_prob: float,
                 direct_dmg: int, tick_dmg: int, duration_ms: int) -> Player:
    if weapon == "toxin":
        p = Player(pid=pid, team=team, weapon="toxin", direct_dmg=direct_dmg,
                    fire_ms=TOXIN_FIRE_MS, mag=TOXIN_MAG, reserve_max=TOXIN_RESERVE,
                    reload_ms=TOXIN_RELOAD_MS, tick_dmg=tick_dmg, duration_ms=duration_ms)
    else:
        p = Player(pid=pid, team=team, weapon="rifle", direct_dmg=RIFLE_DMG,
                    fire_ms=RIFLE_FIRE_MS, mag=RIFLE_MAG, reserve_max=RIFLE_RESERVE,
                    reload_ms=RIFLE_RELOAD_MS)
    p.ammo = p.mag
    p.reserve = p.reserve_max
    return p


def run_match(rng, roster: list[tuple[int, str]], hit_prob: float, direct_dmg: int,
              tick_dmg: int, duration_ms: int, match_ms: float, contact_mean_s: float) -> list[Player]:
    """roster: list of (team_id, weapon) pairs, in player-id order."""
    players = [
        make_player(i, team, weapon, hit_prob, direct_dmg, tick_dmg, duration_ms)
        for i, (team, weapon) in enumerate(roster)
    ]
    m = Match(players, rng, match_ms, contact_mean_s, hit_prob=hit_prob)
    m.run()
    return players


# --------------------------------------------------------------------------- #
# Aggregation
# --------------------------------------------------------------------------- #

@dataclass
class Agg:
    """Running totals for one weapon role within one sweep cell."""
    kills: int = 0
    deaths: int = 0
    player_minutes: float = 0.0
    poison_damage_dealt: int = 0
    poison_damage_wasted: int = 0
    wasted_refresh_count: int = 0
    invisible_kills: int = 0
    kills_stolen: int = 0

    def add(self, p: Player, match_ms: float) -> None:
        self.kills += p.kills
        self.deaths += p.deaths
        self.player_minutes += match_ms / 60000.0
        self.poison_damage_dealt += p.poison_damage_dealt
        self.poison_damage_wasted += p.poison_damage_wasted
        self.wasted_refresh_count += p.wasted_refresh_count
        self.invisible_kills += p.invisible_kills
        self.kills_stolen += p.kills_stolen

    def kpm(self) -> float:
        return self.kills / self.player_minutes if self.player_minutes > 0 else 0.0


def rate_ratio_rel_se(k_a: int, k_b: int) -> float:
    """Relative standard error of a ratio of two Poisson-ish rates, from their
    kill counts. Returns +inf if either count is zero (ratio undefined)."""
    if k_a <= 0 or k_b <= 0:
        return float("inf")
    return math.sqrt(1.0 / k_a + 1.0 / k_b)


# --------------------------------------------------------------------------- #
# Sweep driver
# --------------------------------------------------------------------------- #

DIRECT_DMG_VALUES = [5, 6, 7, 8, 9]
TICK_DMG_VALUES = [2, 3, 4, 5, 6]
DURATION_S_VALUES = [3, 5, 7]
HIT_PROB_VALUES = [0.5, 0.35, 0.65]
N_VALUES = list(range(2, 11))
CONTACT_MEAN_S_DEFAULT = 2.0


def team_roster(n: int, hit_prob: int, direct_dmg: int, tick_dmg: int, duration_ms: int) -> list[tuple[int, str]]:
    roster = []
    for team in (0, 1):
        roster.append((team, "toxin"))
        roster.extend((team, "rifle") for _ in range(n - 1))
    return roster


def run_team_sweep(rng, reps: int, match_ms: float, contact_mean_s: float, writer: csv.DictWriter,
                    grid_n=N_VALUES, grid_hit=HIT_PROB_VALUES, grid_dd=DIRECT_DMG_VALUES,
                    grid_td=TICK_DMG_VALUES, grid_dur=DURATION_S_VALUES) -> int:
    n_cells = 0
    for direct_dmg, tick_dmg, dur_s in itertools.product(grid_dd, grid_td, grid_dur):
        duration_ms = dur_s * 1000
        for n in grid_n:
            for hit_prob in grid_hit:
                toxin_agg = Agg()
                rifle_agg = Agg()
                for _rep in range(reps):
                    roster = team_roster(n, hit_prob, direct_dmg, tick_dmg, duration_ms)
                    players = run_match(rng, roster, hit_prob, direct_dmg, tick_dmg,
                                         duration_ms, match_ms, contact_mean_s)
                    for i, (team, weapon) in enumerate(roster):
                        p = players[i]
                        if weapon == "toxin":
                            toxin_agg.add(p, match_ms)
                        else:
                            rifle_agg.add(p, match_ms)
                toxin_kpm = toxin_agg.kpm()
                rifle_kpm = rifle_agg.kpm()
                ratio = toxin_kpm / rifle_kpm if rifle_kpm > 0 else float("nan")
                rel_se = rate_ratio_rel_se(toxin_agg.kills, rifle_agg.kills)
                ci_lo = ratio * math.exp(-1.96 * rel_se) if math.isfinite(rel_se) and math.isfinite(ratio) else float("nan")
                ci_hi = ratio * math.exp(1.96 * rel_se) if math.isfinite(rel_se) and math.isfinite(ratio) else float("nan")
                wasted_share = (toxin_agg.poison_damage_wasted / toxin_agg.poison_damage_dealt
                                if toxin_agg.poison_damage_dealt > 0 else 0.0)
                invisible_share = (toxin_agg.invisible_kills / toxin_agg.kills
                                    if toxin_agg.kills > 0 else 0.0)
                stolen_share = (toxin_agg.kills_stolen / toxin_agg.kills
                                 if toxin_agg.kills > 0 else 0.0)
                writer.writerow({
                    "mode": "team", "n": n, "hit_prob": hit_prob,
                    "direct_dmg": direct_dmg, "tick_dmg": tick_dmg, "duration_s": dur_s,
                    "contact_mean_s": contact_mean_s, "reps": reps, "match_s": match_ms / 1000.0,
                    "toxin_kills": toxin_agg.kills, "rifle_kills": rifle_agg.kills,
                    "toxin_kpm": round(toxin_kpm, 4), "rifle_kpm": round(rifle_kpm, 4),
                    "kpm_ratio": round(ratio, 4) if math.isfinite(ratio) else "",
                    "kpm_ratio_ci_lo": round(ci_lo, 4) if math.isfinite(ci_lo) else "",
                    "kpm_ratio_ci_hi": round(ci_hi, 4) if math.isfinite(ci_hi) else "",
                    "invisible_kill_share": round(invisible_share, 4),
                    "poison_wasted_share": round(wasted_share, 4),
                    "wasted_refresh_count": toxin_agg.wasted_refresh_count,
                    "kills_stolen_share": round(stolen_share, 4),
                    "duel_win_rate": "", "duel_ties": "", "opponent": "",
                })
                n_cells += 1
    return n_cells


def run_duel_sweep(rng, reps: int, match_ms: float, contact_mean_s: float, writer: csv.DictWriter,
                    grid_hit=HIT_PROB_VALUES, grid_dd=DIRECT_DMG_VALUES,
                    grid_td=TICK_DMG_VALUES, grid_dur=DURATION_S_VALUES) -> int:
    n_cells = 0
    for opponent, roster_weapons in (("rifle", ("toxin", "rifle")), ("toxin", ("toxin", "toxin"))):
        for direct_dmg, tick_dmg, dur_s in itertools.product(grid_dd, grid_td, grid_dur):
            duration_ms = dur_s * 1000
            for hit_prob in grid_hit:
                toxin_agg = Agg()
                other_agg = Agg()
                wins = 0
                ties = 0
                for _rep in range(reps):
                    roster = [(0, roster_weapons[0]), (1, roster_weapons[1])]
                    players = run_match(rng, roster, hit_prob, direct_dmg, tick_dmg,
                                         duration_ms, match_ms, contact_mean_s)
                    a, b = players[0], players[1]
                    toxin_agg.add(a, match_ms)
                    other_agg.add(b, match_ms)
                    if a.kills > b.kills:
                        wins += 1
                    elif a.kills == b.kills:
                        ties += 1
                win_rate = (wins + 0.5 * ties) / reps
                toxin_kpm = toxin_agg.kpm()
                other_kpm = other_agg.kpm()
                ratio = toxin_kpm / other_kpm if other_kpm > 0 else float("nan")
                wasted_share = (toxin_agg.poison_damage_wasted / toxin_agg.poison_damage_dealt
                                if toxin_agg.poison_damage_dealt > 0 else 0.0)
                invisible_share = (toxin_agg.invisible_kills / toxin_agg.kills
                                    if toxin_agg.kills > 0 else 0.0)
                stolen_share = (toxin_agg.kills_stolen / toxin_agg.kills
                                 if toxin_agg.kills > 0 else 0.0)
                writer.writerow({
                    "mode": f"duel_toxin_vs_{opponent}", "n": 1, "hit_prob": hit_prob,
                    "direct_dmg": direct_dmg, "tick_dmg": tick_dmg, "duration_s": dur_s,
                    "contact_mean_s": contact_mean_s, "reps": reps, "match_s": match_ms / 1000.0,
                    "toxin_kills": toxin_agg.kills, "rifle_kills": other_agg.kills,
                    "toxin_kpm": round(toxin_kpm, 4), "rifle_kpm": round(other_kpm, 4),
                    "kpm_ratio": round(ratio, 4) if math.isfinite(ratio) else "",
                    "kpm_ratio_ci_lo": "", "kpm_ratio_ci_hi": "",
                    "invisible_kill_share": round(invisible_share, 4),
                    "poison_wasted_share": round(wasted_share, 4),
                    "wasted_refresh_count": toxin_agg.wasted_refresh_count,
                    "kills_stolen_share": round(stolen_share, 4),
                    "duel_win_rate": round(win_rate, 4), "duel_ties": ties, "opponent": opponent,
                })
                n_cells += 1
    return n_cells


def run_contact_sensitivity(rng, reps: int, match_ms: float, writer: csv.DictWriter,
                              baseline_dd=8, baseline_td=4, baseline_dur=5,
                              grid_n=N_VALUES, grid_hit=(0.5,),
                              grid_contact=(1.0, 2.0, 4.0)) -> int:
    """Small extra table: sweeps the line-of-sight (contact) mean duration at
    the current shipped row (8 direct / 4 per tick / 5 s), team mode only.
    Kept separate and small to keep the main grid's runtime bounded, per the
    brief's "reduce reps before reducing grid" instruction: this is a grid
    reduction, but on the LOS axis only, which the brief itself flagged as
    secondary ("make it a sweep parameter too") next to the primary
    damage/tick/duration grid."""
    n_cells = 0
    duration_ms = baseline_dur * 1000
    for contact_mean_s in grid_contact:
        for n in grid_n:
            for hit_prob in grid_hit:
                toxin_agg = Agg()
                rifle_agg = Agg()
                for _rep in range(reps):
                    roster = team_roster(n, hit_prob, baseline_dd, baseline_td, duration_ms)
                    players = run_match(rng, roster, hit_prob, baseline_dd, baseline_td,
                                         duration_ms, match_ms, contact_mean_s)
                    for i, (team, weapon) in enumerate(roster):
                        p = players[i]
                        (toxin_agg if weapon == "toxin" else rifle_agg).add(p, match_ms)
                toxin_kpm = toxin_agg.kpm()
                rifle_kpm = rifle_agg.kpm()
                ratio = toxin_kpm / rifle_kpm if rifle_kpm > 0 else float("nan")
                invisible_share = (toxin_agg.invisible_kills / toxin_agg.kills
                                    if toxin_agg.kills > 0 else 0.0)
                writer.writerow({
                    "mode": "contact_sensitivity", "n": n, "hit_prob": hit_prob,
                    "direct_dmg": baseline_dd, "tick_dmg": baseline_td, "duration_s": baseline_dur,
                    "contact_mean_s": contact_mean_s, "reps": reps, "match_s": match_ms / 1000.0,
                    "toxin_kills": toxin_agg.kills, "rifle_kills": rifle_agg.kills,
                    "toxin_kpm": round(toxin_kpm, 4), "rifle_kpm": round(rifle_kpm, 4),
                    "kpm_ratio": round(ratio, 4) if math.isfinite(ratio) else "",
                    "kpm_ratio_ci_lo": "", "kpm_ratio_ci_hi": "",
                    "invisible_kill_share": round(invisible_share, 4),
                    "poison_wasted_share": "", "wasted_refresh_count": toxin_agg.wasted_refresh_count,
                    "kills_stolen_share": "", "duel_win_rate": "", "duel_ties": "", "opponent": "",
                })
                n_cells += 1
    return n_cells


FIELDNAMES = [
    "mode", "n", "hit_prob", "direct_dmg", "tick_dmg", "duration_s", "contact_mean_s",
    "reps", "match_s", "toxin_kills", "rifle_kills", "toxin_kpm", "rifle_kpm",
    "kpm_ratio", "kpm_ratio_ci_lo", "kpm_ratio_ci_hi", "invisible_kill_share",
    "poison_wasted_share", "wasted_refresh_count", "kills_stolen_share",
    "duel_win_rate", "duel_ties", "opponent",
]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0],
                                  formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default="toxin_balance_results.csv", help="CSV output path")
    ap.add_argument("--seed", type=int, default=20260919, help="RNG seed (fixed for reproducibility)")
    ap.add_argument("--reps", type=int, default=60, help="repetitions per team-mode sweep cell")
    ap.add_argument("--duel-reps", type=int, default=300, help="repetitions per duel-mode sweep cell")
    ap.add_argument("--match-seconds", type=float, default=150.0,
                     help="simulated match length in seconds (reduced from the brief's "
                          "illustrative 10 minutes to keep the full sweep inside budget; "
                          "see assumption 14 in the module docstring)")
    ap.add_argument("--contact-mean-s", type=float, default=CONTACT_MEAN_S_DEFAULT,
                     help="mean line-of-sight contact duration, seconds")
    ap.add_argument("--quick", action="store_true",
                     help="tiny grid for a fast smoke test (not the real sweep)")
    ap.add_argument("--skip-contact-sensitivity", action="store_true",
                     help="skip the extra LOS-duration sensitivity table")
    args = ap.parse_args(argv)

    rng = __import__("random").Random(args.seed)
    match_ms = args.match_seconds * 1000.0

    grid_n = N_VALUES
    grid_hit = HIT_PROB_VALUES
    grid_dd = DIRECT_DMG_VALUES
    grid_td = TICK_DMG_VALUES
    grid_dur = DURATION_S_VALUES
    reps = args.reps
    duel_reps = args.duel_reps
    if args.quick:
        grid_n = [2, 6, 10]
        grid_hit = [0.5]
        grid_dd = [7, 8]
        grid_td = [4]
        grid_dur = [5]
        reps = 3
        duel_reps = 3

    t0 = walltime.time()
    with open(args.out, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        writer.writeheader()
        n_team = run_team_sweep(rng, reps, match_ms, args.contact_mean_s, writer,
                                 grid_n=grid_n, grid_hit=grid_hit, grid_dd=grid_dd,
                                 grid_td=grid_td, grid_dur=grid_dur)
        t_team = walltime.time()
        n_duel = run_duel_sweep(rng, duel_reps, match_ms, args.contact_mean_s, writer,
                                 grid_hit=grid_hit, grid_dd=grid_dd, grid_td=grid_td, grid_dur=grid_dur)
        t_duel = walltime.time()
        n_contact = 0
        if not args.skip_contact_sensitivity and not args.quick:
            n_contact = run_contact_sensitivity(rng, max(reps, 150), match_ms, writer, grid_n=grid_n)
        t_contact = walltime.time()

    print(f"team-mode cells: {n_team} ({t_team - t0:.1f}s)", file=sys.stderr)
    print(f"duel-mode cells: {n_duel} ({t_duel - t_team:.1f}s)", file=sys.stderr)
    if n_contact:
        print(f"contact-sensitivity cells: {n_contact} ({t_contact - t_duel:.1f}s)", file=sys.stderr)
    print(f"total runtime: {t_contact - t0:.1f}s -> {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
