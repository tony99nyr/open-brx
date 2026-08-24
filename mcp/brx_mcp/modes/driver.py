"""GameDriver — runs a mode engine live against real taggers (M0.2).

The driver is the ONE place that touches I/O. It:
  1. applies a GameConfig (setup frames + per-gun team/spawn),
  2. feeds each parsed rx event into the engine tagged with the gun it came from,
  3. runs engine.tick() on a clock,
  4. executes the Actions the engine emits (Respawn→sequence, Heal→$LIFE,
     PlaySound→$PLAY, SendFrame→raw, Score/GameOver→scoreboard).

The `sender` is injected — a coroutine `send(player_id, frame)` — so the driver
is unit-tested with a fake sender (no Bluetooth). `run_live()` wires the real
BLE ConnectionManager.
"""

from __future__ import annotations

import asyncio
import time
from typing import Awaitable, Callable, Optional

from ..gameconfig import GameConfig, RESPAWN_SEQUENCE, SPAWN_SEQUENCE, END_SEQUENCE
from .base import (
    Action, Callout, Eliminate, GameEngine, GameOver, Heal, PlaySound, Respawn,
    Score, SendFrame, SetTeam,
)

Sender = Callable[[str, str], Awaitable[None]]


def build_engine(config: GameConfig, now: float = 0.0) -> GameEngine:
    """Factory: config.mode → the engine instance."""
    from .deathmatch import DeathmatchEngine
    from .survival import InfectionEngine
    from .lms import LastManStandingEngine
    m = config.mode
    if m in ("tdm", "ffa"):
        return DeathmatchEngine(config, now)
    if m in ("infection", "survival"):
        return InfectionEngine(config, now)
    if m == "lms":
        return LastManStandingEngine(config, now)
    raise ValueError(f"unknown mode {m!r} (tdm|ffa|infection|lms)")


class GameDriver:
    def __init__(self, config: GameConfig, players: dict[str, int],
                 sender: Sender, now: float = 0.0,
                 announce: Optional[Callable[[str], None]] = None):
        """`players` maps player_id → team. `sender(pid, frame)` does the write."""
        self.config = config
        self.players = players
        self.sender = sender
        self.engine = build_engine(config, now)
        self.announce = announce or (lambda s: print(s))
        for pid, team in players.items():
            self.engine.add_player(pid, team)

    # -- action execution ---------------------------------------------------- #
    async def execute(self, actions: list[Action]) -> None:
        for a in actions:
            if isinstance(a, SendFrame):
                await self.sender(a.player_id, a.frame)
            elif isinstance(a, Respawn):
                for f in RESPAWN_SEQUENCE:
                    await self.sender(a.player_id, f)
                self.announce(f"↻ respawn {a.player_id}")
            elif isinstance(a, Heal):
                await self.sender(a.player_id, f"$LIFE,{a.hp},{a.armor},{a.shield},*")
            elif isinstance(a, SetTeam):
                await self.sender(a.player_id, f"$TID,{a.team},*")
            elif isinstance(a, PlaySound):
                frame = f"$PLAY,{a.sound_id},4,6,,,,,*"
                if a.scope == "all":
                    for pid in self.players:
                        await self.sender(pid, frame)
                else:
                    await self.sender(a.scope, frame)
            elif isinstance(a, Callout):
                self.announce(f"📢 {a.text}")
            elif isinstance(a, Score):
                self.announce(f"🎯 {a.who}: {a.total} (+{a.delta})")
            elif isinstance(a, Eliminate):
                self.announce(f"☠ {a.player_id} eliminated")
            elif isinstance(a, GameOver):
                self.announce(f"🏆 GAME OVER — {a.winner}  {a.detail}")

    # -- lifecycle ----------------------------------------------------------- #
    async def setup(self) -> None:
        """Push per-game config to every gun, then per-gun team + spawn (synchronised:
        config all, THEN spawn all back-to-back — B10)."""
        setup_frames = self.config.setup_frames()
        # config every gun fully first (incl. team) ...
        for pid in self.players:
            for f in setup_frames:
                await self.sender(pid, f)
            await self.sender(pid, f"$TID,{self.players[pid]},*")
        # ... THEN spawn all guns back-to-back so they start ~together (B10 barrier)
        for f in SPAWN_SEQUENCE:
            for pid in self.players:
                await self.sender(pid, f)
        self.announce(f"game live: {self.config.summary()}")

    async def teardown(self) -> None:
        for pid in self.players:
            for f in END_SEQUENCE:
                try:
                    await self.sender(pid, f)
                except Exception:
                    pass

    def feed(self, player_id: str, ev: dict, now: float) -> list[Action]:
        """Feed one parsed rx event; returns the Actions (caller executes)."""
        return self.engine.on_event(player_id, ev, now)

    def tick(self, now: float) -> list[Action]:
        return self.engine.tick(now)

    @property
    def over(self) -> bool:
        return getattr(self.engine, "over", False)

    def snapshot(self) -> dict:
        return self.engine.snapshot()


# --------------------------------------------------------------------------- #
# Live wiring — the only Bluetooth-touching part                              #
# --------------------------------------------------------------------------- #
async def run_live(config: GameConfig, addresses: list[str]) -> dict:
    """Connect the given taggers, run the configured mode to completion, return
    the final snapshot. `players` are keyed by address; team from config.teams or
    round-robin (FFA gives each its own team)."""
    from ..ble import ConnectionManager
    from ..protocol import parse_event

    mgr = ConnectionManager()
    # assign teams: explicit config.teams, else FFA=unique per gun, else alternate
    players: dict[str, int] = {}
    for i, addr in enumerate(addresses):
        if addr in config.teams:
            players[addr] = config.teams[addr]
        elif config.mode == "ffa":
            players[addr] = i + 1
        else:
            players[addr] = (i % 2) + 1

    async def sender(pid: str, frame: str) -> None:
        await mgr.send(pid, frame, reply_window_ms=250)

    driver = GameDriver(config, players, sender, now=time.monotonic())
    for addr in addresses:
        await mgr.connect(addr, addr)
    last_seq = {addr: mgr.sessions[addr].seq for addr in addresses}
    try:
        await driver.setup()
        while not driver.over:
            await asyncio.sleep(0.5)
            now = time.monotonic()
            for addr in addresses:
                for ev in mgr.get_events(addr, since_seq=last_seq[addr])["events"]:
                    last_seq[addr] = ev["seq"]
                    if ev["direction"] != "rx":
                        continue
                    parsed = parse_event(ev["raw"])
                    parsed["raw"] = ev["raw"]
                    await driver.execute(driver.feed(addr, parsed, now))
            await driver.execute(driver.tick(now))
        return driver.snapshot()
    finally:
        await driver.teardown()
        for addr in addresses:
            await mgr.disconnect(addr)
