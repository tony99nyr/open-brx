"""Extraction (raid-and-extract) game mode — a host-side rules engine.

The extraction-shooter loop (Tarkov / Hunt / DMZ / Marathon), mapped onto BRX per
`docs/game-modes.md` §Extraction:

    loot  ->  reach an extraction point  ->  channel a LOUD extraction while
    exposed  ->  survive it to BANK the loot (score + boosts)  ->  die and you
    DROP everything for others to grab.

Design notes (why this shape):
- The gun keeps no state (protocol §7n), so the **loot wallet lives here**, keyed by
  player id. A "player" is really a node (Companion/phone) that owns one tagger.
- This engine is **transport-free and clock-injected**: every method takes an
  explicit `now` (monotonic seconds) and returns a list of `Action`s. That makes it
  fully unit-testable with synthetic events — essential, since the dev box has no
  Bluetooth. A thin driver turns Actions into BLE frames / audio.
- Extraction is mostly a rules module over primitives we already have: the
  King-of-the-Hill channel/hold, the `$HP,0` death hook, and the `$LIFE`/`$WEAP`
  boost writes (§Health/regen variants). Nothing here needs new firmware.

The engine is intentionally strict-but-simple for v1: standing in the extraction
zone accrues a channel; **leaving the zone or dying resets it to zero** ("you must
hold it"). Later we can make leaving *pause* instead of reset (config hook noted).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


# --------------------------------------------------------------------------- #
# Actions — pure data the engine emits; a driver executes them.               #
# --------------------------------------------------------------------------- #
@dataclass
class Action:
    """Base class for everything the engine emits. Subclasses carry the detail."""


@dataclass
class Callout(Action):
    """A callout to play. `scope="all"` = field-wide (the loud extraction alarm);
    `scope=<player_id>` = that node only."""
    text: str
    scope: str = "all"


@dataclass
class SendFrame(Action):
    """A BRX frame to write to a specific player's tagger (e.g. a `$LIFE` boost)."""
    player_id: str
    frame: str


@dataclass
class Bank(Action):
    """Score bookkeeping / UI: `player_id` banked `value`, now at `total`."""
    player_id: str
    value: int
    total: int


@dataclass
class ChannelStarted(Action):
    player_id: str
    zone: str


@dataclass
class ChannelReset(Action):
    player_id: str
    zone: str
    reason: str  # "left_zone" | "died"


@dataclass
class Extracted(Action):
    player_id: str
    value: int
    zone: str


@dataclass
class LootDropped(Action):
    """Loot that fell when a player went down — pickable by anyone (incl. by
    returning to base). `by` is where it went under the drop policy."""
    drop_id: int
    value: int
    from_player: str
    by: str  # "ground" | "killer" | "pool"
    killer: Optional[str] = None


@dataclass
class GameOver(Action):
    winner: str
    total: int


# --------------------------------------------------------------------------- #
# Config + player state                                                        #
# --------------------------------------------------------------------------- #
class Status(Enum):
    ALIVE = "alive"
    DOWN = "down"          # killed, awaiting respawn
    EXTRACTED = "extracted"  # left the raid safe (if extract_removes_player)


@dataclass
class ExtractionConfig:
    channel_s: float = 45.0          # time to hold the extraction point
    win_target: int = 0              # banked value to win; 0 = no target (host ends)
    loot_per_kill: int = 10          # loot a killer gains per kill
    drop_policy: str = "ground"      # "ground" | "killer" | "pool"
    extract_removes_player: bool = True   # extracting leaves the raid (else respawn clean)
    # Frames granted to a node after a successful extraction (its "stash" boost on
    # the next raid). Default: a 50-point overshield via $LIFE (added shields).
    boost_per_extract: tuple[str, ...] = ("$LIFE,0,0,50,*",)
    # Callout text; {p}=player, {z}=zone.
    start_callout: str = "Extraction inbound at {z}!"
    extract_callout: str = "{p} has extracted!"


@dataclass
class _Player:
    player_id: str
    status: Status = Status.ALIVE
    carried: int = 0
    banked: int = 0
    zone: Optional[str] = None            # extraction zone currently occupied
    channel_start: Optional[float] = None  # monotonic time the channel began


# --------------------------------------------------------------------------- #
# The engine                                                                   #
# --------------------------------------------------------------------------- #
class ExtractionGame:
    """A single Extraction match. Feed it events + `tick(now)`; act on the returns."""

    def __init__(self, players: list[str], config: ExtractionConfig | None = None,
                 now: float = 0.0) -> None:
        self.config = config or ExtractionConfig()
        self.players: dict[str, _Player] = {p: _Player(p) for p in players}
        self.dropped: dict[int, LootDropped] = {}
        self._next_drop_id = 1
        self._last_now = now
        self.over = False
        self.winner: Optional[str] = None

    # -- introspection helpers (handy for drivers/UI/tests) ----------------- #
    def carried(self, pid: str) -> int:
        return self.players[pid].carried

    def banked(self, pid: str) -> int:
        return self.players[pid].banked

    def status(self, pid: str) -> Status:
        return self.players[pid].status

    def channel_progress(self, pid: str, now: float) -> float:
        """0.0–1.0 fraction of the extraction channel held so far."""
        p = self.players[pid]
        if p.channel_start is None:
            return 0.0
        return min(1.0, (now - p.channel_start) / self.config.channel_s)

    # -- loot --------------------------------------------------------------- #
    def loot_pickup(self, pid: str, value: int) -> list[Action]:
        """Player grabbed loot (IR loot box / objective). Dead players can't."""
        p = self._live(pid)
        if p is None or self.over:
            return []
        p.carried += value
        return []

    def pickup_dropped(self, pid: str, drop_id: int) -> list[Action]:
        """Player grabbed a dropped loot token off the ground."""
        p = self._live(pid)
        if p is None or self.over or drop_id not in self.dropped:
            return []
        token = self.dropped.pop(drop_id)
        p.carried += token.value
        return []

    # -- combat ------------------------------------------------------------- #
    def on_death(self, victim_id: str, killer_id: str | None, now: float) -> list[Action]:
        """Victim goes down: their carried loot drops (per policy), their channel
        resets, and a killer (if any) gains kill-loot."""
        if self.over:
            return []
        v = self.players.get(victim_id)
        if v is None or v.status is not Status.ALIVE:
            return []
        actions: list[Action] = []

        # interrupt an in-progress extraction
        if v.channel_start is not None and v.zone is not None:
            actions.append(ChannelReset(victim_id, v.zone, "died"))
            actions.append(Callout(f"Extraction at {v.zone} interrupted!", "all"))
            v.channel_start = None
            v.zone = None

        v.status = Status.DOWN

        # drop the loot
        if v.carried > 0:
            actions.append(self._drop_loot(v, killer_id))

        # kill-loot to the killer (if alive and not self)
        if killer_id and killer_id != victim_id:
            k = self._live(killer_id)
            if k is not None and self.config.loot_per_kill:
                k.carried += self.config.loot_per_kill
        return actions

    def respawn(self, pid: str) -> list[Action]:
        """Bring a downed player back (empty-handed — loot was dropped on death)."""
        p = self.players.get(pid)
        if p is None or p.status is not Status.DOWN or self.over:
            return []
        p.status = Status.ALIVE
        return []

    # -- extraction zone ---------------------------------------------------- #
    def enter_zone(self, pid: str, zone: str, now: float) -> list[Action]:
        """Player is now standing in extraction zone `zone` and initiating.

        Starts (or is already in) the channel; fires the LOUD field-wide callout
        the moment a fresh channel begins — this is the genre's signature "everyone
        now knows where you are" (and it counters extract-camping)."""
        p = self._live(pid)
        if p is None or self.over:
            return []
        if p.zone == zone and p.channel_start is not None:
            return []  # already channelling here
        p.zone = zone
        p.channel_start = now
        return [
            ChannelStarted(pid, zone),
            Callout(self.config.start_callout.format(p=pid, z=zone), "all"),
        ]

    def leave_zone(self, pid: str, now: float) -> list[Action]:
        """Player left the extraction zone before completing → channel resets."""
        p = self.players.get(pid)
        if p is None or p.channel_start is None:
            return []
        zone = p.zone or "?"
        p.channel_start = None
        p.zone = None
        return [ChannelReset(pid, zone, "left_zone")]

    # -- time --------------------------------------------------------------- #
    def tick(self, now: float) -> list[Action]:
        """Advance channels; complete any extraction whose channel has elapsed."""
        self._last_now = now
        if self.over:
            return []
        actions: list[Action] = []
        # snapshot: completing an extraction may end the game mid-loop
        for pid, p in list(self.players.items()):
            if (p.status is Status.ALIVE and p.channel_start is not None
                    and now - p.channel_start >= self.config.channel_s):
                actions.extend(self._complete_extraction(p, now))
                if self.over:
                    break
        return actions

    # -- internals ---------------------------------------------------------- #
    def _live(self, pid: str) -> _Player | None:
        p = self.players.get(pid)
        return p if p is not None and p.status is Status.ALIVE else None

    def _drop_loot(self, victim: _Player, killer_id: str | None) -> LootDropped:
        policy = self.config.drop_policy
        drop = LootDropped(
            drop_id=self._next_drop_id,
            value=victim.carried,
            from_player=victim.player_id,
            by=policy,
            killer=killer_id,
        )
        self._next_drop_id += 1
        if policy == "killer" and killer_id and self._live(killer_id) is not None:
            # loot goes straight to the killer's wallet
            self.players[killer_id].carried += victim.carried
        elif policy == "pool":
            # returns to the shared pool: not pickable off the ground, host re-seeds
            pass
        else:  # "ground" (default) — a token others can grab
            self.dropped[drop.drop_id] = drop
        victim.carried = 0
        return drop

    def _complete_extraction(self, p: _Player, now: float) -> list[Action]:
        value = p.carried
        p.banked += value
        p.carried = 0
        p.channel_start = None
        zone = p.zone or "?"
        p.zone = None
        actions: list[Action] = [
            Extracted(p.player_id, value, zone),
            Bank(p.player_id, value, p.banked),
            Callout(self.config.extract_callout.format(p=p.player_id, z=zone), "all"),
        ]
        # grant the stash boost for the next raid
        for frame in self.config.boost_per_extract:
            actions.append(SendFrame(p.player_id, frame))
        # remove from the raid (or leave alive to keep playing)
        if self.config.extract_removes_player:
            p.status = Status.EXTRACTED
        # win check
        if self.config.win_target and p.banked >= self.config.win_target:
            self.over = True
            self.winner = p.player_id
            actions.append(GameOver(p.player_id, p.banked))
        return actions
