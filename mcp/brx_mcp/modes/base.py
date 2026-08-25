"""Shared foundation for host-side game-mode engines (M0).

The BRX tagger keeps no host-readable game state, so a *mode engine* is a pure
rules object: it consumes the parsed BLE event stream + clock ticks and emits
`Action`s that a driver executes (frames to send, respawns, heals, sounds,
score updates). Engines are transport-free → unit-tested without Bluetooth.

Uniform engine interface:
    add_player(player_id, team)      register a gun (one BLE session = one player)
    on_event(player_id, ev, now)     ev = a parsed rx frame from THAT player's gun
    tick(now)                         advance timers → Actions
    snapshot()                        current scoreboard/state (for a UI)

Kill attribution: a victim's gun reports `$HIR` (shooter TEAM in token 4) then
`$HP,0` (it died). The driver tags each event with the player_id that emitted it
(= the victim), so the engine credits the shooter's team. Per-player credit works
when each gun has a unique team (`$TID`) — FFA — or once P2 sets a real PlayerID.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional


# --------------------------------------------------------------------------- #
# Actions — pure data the engine emits; the driver turns them into I/O.        #
# --------------------------------------------------------------------------- #
@dataclass
class Action:
    """Base type."""


@dataclass
class SendFrame(Action):
    """Raw BRX frame to write to a player's gun."""
    player_id: str
    frame: str


@dataclass
class Respawn(Action):
    """Bring a downed player back (driver sends the respawn sequence)."""
    player_id: str


@dataclass
class Heal(Action):
    """Grant health via `$LIFE` (additive, clamped). Refill armor+HP; shields
    need activation (P16) so default shield=0."""
    player_id: str
    hp: int = 0
    armor: int = 0
    shield: int = 0


@dataclass
class SetTeam(Action):
    """Reassign a player's team (e.g. infection flips a human to infected)."""
    player_id: str
    team: int


@dataclass
class PlaySound(Action):
    """Play a bank sound id. scope='all' or a specific player_id.

    `$PLAY` has **two independent sound slots** (protocol §7o, from cap8):
      slot="effect" -> `$PLAY,<id>,4,6,,,,,*`   token 1: local/effect sound
      slot="voice"  -> `$PLAY,,4,6,<id>,,,,*`   token 4: the ANNOUNCER channel
    The official app speaks every voice line on the token-4 slot, so announcer
    lines should use slot="voice"; effects (explosions, stings) use the default.
    """
    sound_id: str
    scope: str = "all"
    slot: str = "effect"


@dataclass
class KillConfirm(Action):
    """The shooter's green-sight kill-confirm flash -> `$SFLASH,*` (§7o).

    Captured from the official app: exactly one per kill scored, ~0.4 s after the
    shot. This is the *visual* half of native feedback, and it IS BLE-drivable —
    the earlier "green-sight is nRF-only" reading probed `$GLED`, the wrong command.
    """
    scope: str


@dataclass
class Callout(Action):
    """A textual announcement (driver logs it / maps to a PlaySound if it has an
    id for the phrase). scope='all' or a player_id."""
    text: str
    scope: str = "all"


@dataclass
class Score(Action):
    """Scoreboard update: `who` (team or player) now has `total` (delta applied)."""
    who: str
    delta: int
    total: int


@dataclass
class Eliminate(Action):
    """A player is out (no lives left) — UI/state, distinct from a respawnable death."""
    player_id: str


@dataclass
class GameOver(Action):
    winner: str
    detail: str = ""


# --------------------------------------------------------------------------- #
# Roster — per-player bookkeeping shared by modes                             #
# --------------------------------------------------------------------------- #
@dataclass
class Player:
    player_id: str
    team: int
    alive: bool = True
    lives: Optional[int] = None       # None = unlimited
    kills: int = 0
    deaths: int = 0
    dead_since: Optional[float] = None  # monotonic time of death (for respawn timing)


class Roster:
    """Players keyed by id, with team lookups. Modes compose this."""

    def __init__(self) -> None:
        self.players: dict[str, Player] = {}

    def add(self, player_id: str, team: int, lives: Optional[int] = None) -> Player:
        p = Player(player_id, team, lives=lives)
        self.players[player_id] = p
        return p

    def get(self, player_id: str) -> Optional[Player]:
        return self.players.get(player_id)

    def team_members(self, team: int) -> list[Player]:
        return [p for p in self.players.values() if p.team == team]

    def alive_players(self) -> list[Player]:
        return [p for p in self.players.values() if p.alive]

    def alive_teams(self) -> set[int]:
        return {p.team for p in self.players.values() if p.alive}

    def still_in(self) -> list[Player]:
        """Players not yet out — alive OR still holding a life to respawn on.
        (A dead-but-respawning player is still IN the game.)"""
        return [p for p in self.players.values()
                if p.alive or (p.lives is None) or p.lives > 0]

    def standing_teams(self) -> set[int]:
        return {p.team for p in self.still_in()}

    def sole_member_of_team(self, team: int) -> Optional[Player]:
        m = self.team_members(team)
        return m[0] if len(m) == 1 else None


class GameEngine(ABC):
    """Interface every mode implements."""

    @abstractmethod
    def add_player(self, player_id: str, team: int) -> None: ...

    @abstractmethod
    def on_event(self, player_id: str, ev: dict, now: float) -> list[Action]: ...

    @abstractmethod
    def tick(self, now: float) -> list[Action]: ...

    @abstractmethod
    def snapshot(self) -> dict: ...


# --------------------------------------------------------------------------- #
# Event helpers — read the parsed rx frames uniformly                         #
# --------------------------------------------------------------------------- #
def is_hit(ev: dict) -> bool:
    return ev.get("command") == "HIR"


def shooter_team(ev: dict) -> Optional[int]:
    """$HIR token 4 = shooter team (grenade beacons have token2==15; skip those)."""
    t = ev.get("tokens", [])
    if len(t) > 2 and t[2] == "15":
        return None                     # grenade IR, not a player shot
    try:
        return int(t[4]) if len(t) > 4 else None
    except (ValueError, TypeError):
        return None


def is_death(ev: dict) -> bool:
    """$HP,0,... = the reporting player died."""
    if ev.get("command") != "HP":
        return False
    t = ev.get("tokens", [])
    try:
        return len(t) > 1 and int(t[1]) == 0
    except (ValueError, TypeError):
        return False


def hp_values(ev: dict) -> Optional[tuple[int, int, int]]:
    """($HP,<hp>,<armor>,<shield>) → (hp, armor, shield), or None if not an $HP.
    An $HP is only emitted when the gun is HIT — so it's the 'took damage' signal."""
    if ev.get("command") != "HP":
        return None
    t = ev.get("tokens", [])
    try:
        return int(t[1]), int(t[2]), int(t[3])
    except (IndexError, ValueError, TypeError):
        return None
