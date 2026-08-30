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
import sys
import time
from typing import Awaitable, Callable, Optional

from .. import sounds as snd
from ..gameconfig import GameConfig, RESPAWN_SEQUENCE, END_SEQUENCE
from .base import (
    Action, Callout, Eliminate, GameEngine, GameOver, Heal, KillConfirm, PlaySound, Respawn,
    Score, SendFrame, SetTeam,
)

Sender = Callable[[str, str], Awaitable[None]]


CALLSIGN_MAX = 12   # BRX gun name field is short (stock name e.g. "Tactix2")


def clean_callsign(name: Optional[str]) -> str:
    """Sanitize a gamertag for a `$NAME` frame: drop comma/`$`/`*`/control chars
    (they'd break the framing) and cap the length. Returns "" for None/blank."""
    if not name:
        return ""
    safe = "".join(c for c in str(name).strip()
                   if c.isprintable() and c not in ",$*")
    return safe[:CALLSIGN_MAX].strip()


def assign_teams(mode: str, addresses: list[str],
                 explicit: Optional[dict[str, int]] = None) -> dict[str, int]:
    """Map each gun → team. Explicit wins; else FFA = unique team per gun;
    infection/survival = exactly ONE seed infected (team 2), rest human (team 1);
    other modes = alternate 1/2."""
    explicit = explicit or {}
    out: dict[str, int] = {}
    for i, addr in enumerate(addresses):
        if addr in explicit:
            out[addr] = explicit[addr]
        elif mode in ("ffa", "extraction"):
            out[addr] = i + 1                  # unique team → 1:1 kill attribution
        elif mode in ("infection", "survival"):
            out[addr] = 2 if i == 0 else 1     # first gun = the single seed infected
        else:
            out[addr] = (i % 2) + 1
    return out


def build_engine(config: GameConfig, now: float = 0.0) -> GameEngine:
    """Factory: config.mode → the engine instance."""
    from .deathmatch import DeathmatchEngine
    from .survival import InfectionEngine
    from .lms import LastManStandingEngine
    from .cs import BombEngine
    from .objectives import DominationEngine, CtfEngine
    import dataclasses
    m = config.mode
    if m in ("tdm", "ffa"):
        return DeathmatchEngine(config, now)
    if m in ("infection", "survival"):
        return InfectionEngine(config, now)
    if m == "lms":
        return LastManStandingEngine(config, now)
    if m in ("cs", "bomb"):
        return BombEngine(config, now)
    if m == "domination":
        return DominationEngine(config, now)
    if m == "koth":
        # KotH = domination on a single point (hold the hill for time)
        return DominationEngine(dataclasses.replace(config, control_points=1), now)
    if m == "ctf":
        return CtfEngine(config, now)
    if m == "extraction":
        from .extraction_adapter import ExtractionEngineAdapter
        return ExtractionEngineAdapter(config, now)
    raise ValueError(f"unknown mode {m!r} "
                     "(tdm|ffa|infection|lms|cs|domination|koth|ctf|extraction)")


class GameDriver:
    def __init__(self, config: GameConfig, players: dict[str, int],
                 sender: Sender, now: float = 0.0,
                 announce: Optional[Callable[[str], None]] = None,
                 callsigns: Optional[dict[str, str]] = None):
        """`players` maps player_id → team. `sender(pid, frame)` does the write.
        `callsigns` maps player_id → vanity gamertag; a DISPLAY layer only — echoed
        in `snapshot()` so a scoreboard can label by gamertag. NOT pushed to the gun
        (the gun's `$NAME` is its permanent sticker-id hardware identity)."""
        self.config = config
        self.players = players
        self.sender = sender
        self.engine = build_engine(config, now)
        self.announce = announce or (lambda s: print(s, flush=True))
        self.callsigns = {pid: clean_callsign(n) for pid, n in (callsigns or {}).items()
                          if clean_callsign(n)}
        # Per-gun PLAYER ID -> $PSET token 1 (protocol §7p). Distinct ids are what make
        # per-player attribution possible at all; with every gun on the default id the
        # shooter field is a constant. Auto-number the fleet 0,1,2… unless the operator
        # pinned ids in config.player_ids. Assignment is computed ONCE here so a
        # mid-game resetup re-sends the SAME id (a changed id mid-game would re-identify
        # the player and orphan their kills).
        pinned = dict(getattr(config, "player_ids", {}) or {})
        self.player_ids: dict[str, int] = {}
        for idx, pid in enumerate(players):
            self.player_ids[pid] = int(pinned.get(pid, idx))
        for pid, team in players.items():
            self.engine.add_player(pid, team)
        # Hand the engine the reverse map so it can credit a kill to the SPECIFIC gun
        # from $HIR token 3, instead of guessing from the shooter's team (Q17).
        roster = getattr(self.engine, "roster", None)
        if roster is not None and hasattr(roster, "wire_ids"):
            roster.wire_ids = {wire: pid for pid, wire in self.player_ids.items()}

    async def _send(self, pid: str, frame: str) -> None:
        """One write, guarded — a single gun's BLE error must NOT abort the game
        (e.g. a broadcast $PLAY to a gun that just disconnected)."""
        try:
            await self.sender(pid, frame)
        except Exception as e:  # noqa: BLE001
            self.announce(f"(send to {pid} failed: {type(e).__name__}: {e})")

    # -- action execution ---------------------------------------------------- #
    async def execute(self, actions: list[Action]) -> None:
        for a in actions:
            if isinstance(a, SendFrame):
                await self._send(a.player_id, a.frame)
            elif isinstance(a, Respawn):
                for f in RESPAWN_SEQUENCE:
                    await self._send(a.player_id, f)
                self.announce(f"↻ respawn {a.player_id}")
            elif isinstance(a, Heal):
                await self._send(a.player_id, f"$LIFE,{a.hp},{a.armor},{a.shield},*")
            elif isinstance(a, SetTeam):
                await self._send(a.player_id, f"$TID,{a.team},*")
            elif isinstance(a, KillConfirm):
                await self._send(a.scope, "$SFLASH,*")   # green-sight kill confirm (§7o)
            elif isinstance(a, PlaySound):
                # two slots: token 1 = effect, token 4 = announcer voice (§7o)
                frame = (f"$PLAY,,4,6,{a.sound_id},,,,*" if a.slot == "voice"
                         else f"$PLAY,{a.sound_id},4,6,,,,,*")
                if a.scope == "all":
                    for pid in self.players:
                        await self._send(pid, frame)
                else:
                    await self._send(a.scope, frame)
            elif isinstance(a, Callout):
                self.announce(f"📢 {a.text}")
            elif isinstance(a, Score):
                self.announce(f"🎯 {a.who}: {a.total} (+{a.delta})")
            elif isinstance(a, Eliminate):
                self.announce(f"☠ {a.player_id} eliminated")
            elif isinstance(a, GameOver):
                self.announce(f"🏆 GAME OVER — {a.winner}  {a.detail}")
                for pid in self.players:            # grounded game-over announcer (all guns)
                    await self._send(pid, f"$PLAY,{snd.GAME_OVER},4,6,,,,,*")

    # -- lifecycle ----------------------------------------------------------- #
    async def setup(self) -> None:
        """Push per-game config to every gun, then per-gun team + spawn (synchronised:
        config all, THEN spawn all back-to-back — B10)."""
        spawn_frames = self.config.spawn_frames()   # loadout-correct $AMMO
        # config every gun fully first (incl. team) ...
        # NOTE: callsigns are a DISPLAY layer only (echoed in snapshot for the
        # scoreboard) — we deliberately do NOT push $NAME here. The gun's $NAME is
        # its permanent hardware identity (the headset sticker id, set at Armory
        # Setup); a per-game vanity gamertag must never clobber it. See
        # docs/field-process.md + the tagger-naming architecture.
        for pid in self.players:
            for f in self.config.setup_frames(self.player_ids[pid]):
                await self._send(pid, f)
            await self._send(pid, f"$TID,{self.players[pid]},*")
        # ... THEN spawn all guns back-to-back so they start ~together (B10 barrier)
        for f in spawn_frames:
            for pid in self.players:
                await self._send(pid, f)
        self.announce(f"game live: {self.config.summary()}")

    def _player_alive(self, pid: str) -> bool:
        """Best-effort: does the ENGINE consider this player alive? Used by the
        reconnect path so we don't revive a gun the engine has dead/eliminated
        (which would desync the physical gun from the scoreboard). Unknown → True."""
        roster = getattr(self.engine, "roster", None)
        if roster is not None:
            p = roster.get(pid)
            if p is not None:
                return bool(getattr(p, "alive", True))
        return True

    async def resetup(self, pid: str) -> None:
        """Re-config ONE gun (after a mid-game reconnect) so it rejoins. Re-sends
        config + team always, but only SPAWNS it live if the engine still considers
        it alive — a gun that dropped while dead stays dead (the engine's own Respawn
        action brings it back on schedule), avoiding a gun-alive/engine-dead desync."""
        for f in self.config.setup_frames(self.player_ids[pid]):
            await self._send(pid, f)
        await self._send(pid, f"$TID,{self.players[pid]},*")
        if self._player_alive(pid):
            for f in self.config.spawn_frames():
                await self._send(pid, f)

    async def teardown(self) -> None:
        for pid in self.players:
            for f in END_SEQUENCE:
                await self._send(pid, f)

    def feed(self, player_id: str, ev: dict, now: float) -> list[Action]:
        """Feed one parsed rx event; returns the Actions (caller executes)."""
        return self.engine.on_event(player_id, ev, now)

    def tick(self, now: float) -> list[Action]:
        return self.engine.tick(now)

    @property
    def over(self) -> bool:
        return getattr(self.engine, "over", False)

    def snapshot(self) -> dict:
        snap = self.engine.snapshot()
        if self.callsigns:
            snap["callsigns"] = dict(self.callsigns)
        return snap


# --------------------------------------------------------------------------- #
# Live wiring — the only Bluetooth-touching part                              #
# --------------------------------------------------------------------------- #
async def run_live(config: GameConfig, addresses: list[str],
                   callsigns: Optional[dict[str, str]] = None,
                   manager=None, tick_s: float = 0.5,
                   max_s: Optional[float] = None) -> dict:
    """Connect the given taggers, run the configured mode to completion, return
    the final snapshot. `players` are keyed by address; team from config.teams or
    round-robin (FFA gives each its own team). `callsigns` maps address → gamertag
    (echoed in the snapshot; display-only, not written to the gun).

    `manager` injects a connection manager (a `FakeConnectionManager` for
    hardware-free tests); default is the real BLE `ConnectionManager`. `tick_s` is
    the game-loop poll interval (tiny in tests to run fast)."""
    from ..protocol import parse_event

    if manager is None:
        from ..ble import ConnectionManager
        manager = ConnectionManager()
    mgr = manager

    async def sender(pid: str, frame: str) -> None:
        await mgr.send(pid, frame, reply_window_ms=250)

    # Connect-grace: BLE establishment is flaky (~1 in 3, §7e). Connect each gun and
    # play with whoever comes up rather than aborting the whole game on one failure.
    connected: list[str] = []
    for addr in addresses:
        try:
            await mgr.connect(addr, addr)
            connected.append(addr)
        except Exception as e:  # noqa: BLE001 — a gun that won't connect is skipped, not fatal
            print(f"(could not connect {addr}: {type(e).__name__}: {e} — skipping)",
                  file=sys.stderr)
    if not connected:
        return {"over": False, "error": "no taggers connected", "requested": addresses}
    if len(connected) < len(addresses):
        print(f"(playing with {len(connected)}/{len(addresses)} taggers: {connected})",
              file=sys.stderr)

    players = assign_teams(config.mode, connected, config.teams or None)
    driver = GameDriver(config, players, sender, now=time.monotonic(),
                        callsigns=callsigns)
    try:
        last_seq = {addr: mgr.sessions[addr].seq for addr in connected}
        await driver.setup()
        # Wall-clock safety: a game with no clock (frag/objective) whose events
        # stall (e.g. a gun dropped) must never loop forever. Default = the game
        # clock + 1 min, else a 1-hour hard cap.
        deadline = (config.game_time_s + 60) if config.game_time_s else 3600.0
        limit = max_s if max_s is not None else deadline
        game_start = time.monotonic()
        reconnect_tries: dict[str, int] = {addr: 0 for addr in connected}
        last_reconnect: dict[str, float] = {addr: -1e9 for addr in connected}
        RECONNECT_CAP = 6          # TOTAL reconnects/gun — bounds a flapping link
        MIN_RECONNECT_S = 8.0      # rate-limit between attempts for the same gun
        RECONNECT_TIMEOUT_S = 3.0  # time-box ONE attempt so a slow connect can't freeze the loop
        loops = 0
        while not driver.over:
            await asyncio.sleep(tick_s)
            now = time.monotonic()
            loops += 1
            # Mid-game reconnection: bring a dropped gun back so it rejoins. Guarded:
            # only if the manager reports link state; time-boxed so a slow real connect
            # can't freeze live players; rate-limited + total-capped so a flapping link
            # can't churn the game forever.
            if loops % 5 == 0 and hasattr(mgr, "is_connected"):
                for addr in connected:
                    if (mgr.is_connected(addr)
                            or reconnect_tries[addr] >= RECONNECT_CAP
                            or now - last_reconnect[addr] < MIN_RECONNECT_S):
                        continue
                    last_reconnect[addr] = now
                    reconnect_tries[addr] += 1
                    try:
                        try:
                            await mgr.disconnect(addr)
                        except Exception:  # noqa: BLE001
                            pass
                        await asyncio.wait_for(mgr.connect(addr, addr, attempts=1),
                                               timeout=RECONNECT_TIMEOUT_S)
                        await driver.resetup(addr)
                        last_seq[addr] = mgr.sessions[addr].seq
                        print(f"(reconnected {addr})", file=sys.stderr)
                    except Exception as e:  # noqa: BLE001 — stay in the game if it fails
                        print(f"(reconnect {addr} failed: {type(e).__name__})", file=sys.stderr)
            for addr in connected:
                for ev in mgr.get_events(addr, since_seq=last_seq[addr])["events"]:
                    last_seq[addr] = ev["seq"]
                    if ev["direction"] != "rx":
                        continue
                    parsed = parse_event(ev["raw"])
                    parsed["raw"] = ev["raw"]
                    await driver.execute(driver.feed(addr, parsed, now))
            await driver.execute(driver.tick(now))
            if now - game_start > limit:
                print(f"(game exceeded {limit:.0f}s with no end — force-stopping)",
                      file=sys.stderr)
                snap = driver.snapshot()
                snap["force_stopped"] = True
                return snap
        return driver.snapshot()
    finally:
        try:
            await driver.teardown()
        except Exception:  # noqa: BLE001
            pass
        for addr in connected:
            try:
                await mgr.disconnect(addr)
            except Exception:  # noqa: BLE001
                pass
