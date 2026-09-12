"""SimGame — a deterministic, synchronous scenario harness over the real
GameDriver + FakeTaggers, for hardening every mode without hardware.

Drives ANY mode uniformly:
  * `hit(victim, shooter_team)` / `kill(...)`  — a gun takes IR (real HP/death model)
  * `station(node, frame)`                     — an objective/station event
                                                 (`$CAPTURE`/`$GRAB`/`$PLANT`/`$ZONE`/…)
  * `tick(now)` / `run_until_over()`           — advance the clock (host respawn, timers)
  * `snapshot()`, `frames_to(pid)`, `over`     — assert outcomes AND the frames actually sent

It exercises the whole stack a real game uses: config-all-then-spawn setup, the
engine's rules, the driver's Action→frame execution, host respawn, and teardown —
just with an in-memory gun instead of Bluetooth. Synchronous (each step runs the
async driver to completion on a held loop) so scenarios read like a script.

NOT a substitute for the bench: no BLE timing/reliability, no physical LED/audio.
See docs/experiment-log/ for what's earned on real guns.

TEST-ONLY harness. It lives in `mcp/tests/` (not in the shipped `brx_mcp` package)
because every one of its importers is a test: `from sim import SimGame`, the same way
the suite already does `from _skip import Skipped`.
"""
from __future__ import annotations

import asyncio

from brx_mcp.fake import FakeTagger
from brx_mcp.gameconfig import GameConfig
from brx_mcp.modes.driver import GameDriver, assign_teams
from brx_mcp.protocol import parse_event


class SimGame:
    def __init__(self, config: GameConfig, guns=None, damage: int = 200):
        """`guns`: a list of addresses (teams via assign_teams) OR a dict addr→team.
        Default: 2 guns (3 for FFA). `damage=200` makes a single `hit` lethal so
        combat scenarios are terse; lower it (or use the real 25) to test health
        variants numerically."""
        self.config = config
        if guns is None:
            guns = ["G1", "G2", "G3"] if config.mode == "ffa" else ["G1", "G2"]
        if isinstance(guns, dict):
            self.teams = dict(guns)
        else:
            self.teams = assign_teams(config.mode, list(guns), config.teams or None)
        self.taggers = {
            a: FakeTagger(a, team=t, damage=damage, hp=config.hp, armor=config.armor)
            for a, t in self.teams.items()
        }
        self.sent: list[tuple[str, str]] = []
        self.loop = asyncio.new_event_loop()

        async def sender(pid: str, frame: str) -> None:
            self.sent.append((pid, frame))
            tg = self.taggers.get(pid)
            if tg is not None:            # keep gun state in sync: $TID team, $SPAWN revive, $PSET
                tg.write(frame)

        self.drv = GameDriver(config, self.teams, sender)

    # -- plumbing ------------------------------------------------------------ #
    def _r(self, coro):
        return self.loop.run_until_complete(coro)

    def close(self) -> None:
        """Close the held event loop (silences the __del__ fd noise at shutdown)."""
        try:
            self.loop.close()
        except Exception:  # noqa: BLE001
            pass

    def __del__(self):
        self.close()

    def _feed(self, pid: str, frame: str, now: float) -> None:
        ev = parse_event(frame)
        ev["raw"] = frame
        self._r(self.drv.execute(self.drv.feed(pid, ev, now)))

    # -- scenario verbs ------------------------------------------------------ #
    def setup(self) -> "SimGame":
        self._r(self.drv.setup())
        return self

    def hit(self, victim: str, shooter_team: int, now: float = 0.0) -> "SimGame":
        """One IR hit on `victim` from `shooter_team` (real damage/death model)."""
        tg = self.taggers[victim]
        tg.receive_ir(shooter_team)
        for f in tg.drain():
            self._feed(victim, f, now)
        return self

    def kill(self, victim: str, shooter_team: int, now: float = 0.0,
             shooter_id: int = 1) -> "SimGame":
        """Shoot `victim` until down (one clean kill).

        `shooter_id` is the shooter's PLAYER id ($HIR token 3). Pass it to model a
        team that holds more than one gun, where the team alone cannot identify the
        killer (Q17)."""
        tg = self.taggers[victim]
        n = 0
        while tg.alive and n < 50:
            tg.receive_ir(shooter_team, shooter_id)
            n += 1
        for f in tg.drain():
            self._feed(victim, f, now)
        return self

    def station(self, node: str, frame: str, now: float = 0.0) -> "SimGame":
        """Feed an objective/station event (e.g. `$CAPTURE,A,1,*`, `$ZONE,Alpha,*`).
        `node` may be a station id (objective engines read the team from the token)
        or a gun id (extraction zone/loot events are keyed to the player)."""
        self._feed(node, frame, now)
        return self

    def event(self, pid: str, frame: str, now: float = 0.0) -> "SimGame":
        """Feed an arbitrary parsed frame on `pid` (escape hatch)."""
        self._feed(pid, frame, now)
        return self

    def tick(self, now: float) -> "SimGame":
        self._r(self.drv.execute(self.drv.tick(now)))
        return self

    def run_until_over(self, dt: float = 1.0, start: float = 1.0,
                       max_ticks: int = 2000) -> "SimGame":
        """Tick the clock until the game ends (or max_ticks) — for time/hold-based ends."""
        now = start
        n = 0
        while not self.drv.over and n < max_ticks:
            self.tick(now)
            now += dt
            n += 1
        return self

    def teardown(self) -> "SimGame":
        self._r(self.drv.teardown())
        return self

    # -- assertions ---------------------------------------------------------- #
    @property
    def over(self) -> bool:
        return self.drv.over

    def snapshot(self) -> dict:
        return self.drv.snapshot()

    def frames_to(self, pid: str) -> list[str]:
        return [f for (p, f) in self.sent if p == pid]

    def all_frames(self) -> list[tuple[str, str]]:
        return list(self.sent)

    def alive(self, pid: str) -> bool:
        return self.taggers[pid].alive
