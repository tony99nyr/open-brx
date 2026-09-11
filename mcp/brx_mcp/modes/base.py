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
        # wire player id ($PSET token 1, echoed as $HIR token 3) -> player_id.
        # Populated by the driver, which assigns those ids. Empty until it does, and
        # attribution then falls back to team resolution.
        self.wire_ids: dict[int, str] = {}

    def by_wire_id(self, wire_id: Optional[int]) -> Optional[Player]:
        """The gun that fired, resolved by its `$PSET` player id. None if unmapped."""
        if wire_id is None:
            return None
        pid = self.wire_ids.get(wire_id)
        return self.players.get(pid) if pid else None

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
    """Interface every mode implements.

    `PARAMS` (A18 / E1): the tunables this mode accepts on `GameConfig.mode_params`, as
    `{name: params.Param}`. Empty = the mode takes none, and MC refuses any key sent for it (a knob
    that "takes" a value the engine then ignores is a control that does nothing). Read the values with
    `params.resolve(type(self), config)`, which serves both the wire dict and the CLI dataclass."""

    PARAMS: dict = {}

    @abstractmethod
    def add_player(self, player_id: str, team: int) -> None: ...

    @abstractmethod
    def on_event(self, player_id: str, ev: dict, now: float) -> list[Action]: ...

    @abstractmethod
    def tick(self, now: float) -> list[Action]: ...

    @abstractmethod
    def snapshot(self) -> dict: ...


class ScoredEngine(GameEngine):
    """Shared foundation for the host-rule engines that keep a `Roster` and end
    the game once via a single `GameOver`: Deathmatch/FFA, LMS, Infection,
    Domination and CTF each hand-rolled this ~identical bookkeeping (clone
    review, 2026-09-07). Two engines deliberately do NOT inherit this because
    they answer a different shape of question: `cs.BombEngine` ends per-ROUND
    (best-of-N, `next_round()` resets mid-match) rather than once, and
    `extraction_adapter.ExtractionEngineAdapter` wraps its own wallet/`_Player`
    model instead of a `Roster`.

    Subclasses still implement `add_player` themselves — each seeds genuinely
    different extra state (lives, `team_score`, `_acc`, `caps`, ...) — and
    override `on_event` when they react to more than a bare death (Deathmatch's
    `$HIR` attribution + regen; Domination/CTF's station events)."""

    def __init__(self, config, now: float = 0.0) -> None:
        self.config = config
        self.roster = Roster()
        self.start = now
        self.over = False
        self.winner: Optional[str] = None

    def _live_player(self, player_id: str) -> Optional[Player]:
        """Resolve `player_id` to its live `Player`, or None once the game is
        over or the id was never registered — the on_event prologue every
        engine here re-implemented (`if self.over: return []` / `roster.get` /
        `if p is None: return []`)."""
        if self.over:
            return None
        return self.roster.get(player_id)

    def on_event(self, player_id: str, ev: dict, now: float) -> list[Action]:
        """Default for the modes that react to nothing but a fresh death (LMS,
        Infection): hand it to `self._handle_death`. Deathmatch (also reads
        `$HIR`/non-fatal `$HP`) and the objective modes (station events) define
        their own on_event instead of using this."""
        p = self._live_player(player_id)
        if p is None or not (is_death(ev) and p.alive):
            return []
        return self._handle_death(player_id, now)

    def _end(self, winner: str, detail: str = "") -> list[Action]:
        """End the match once: set over/winner, emit exactly one `GameOver`. A
        second call (already over) is a no-op — callers may compute `detail`
        unconditionally without double-firing."""
        if self.over:
            return []
        self.over = True
        self.winner = winner
        return [GameOver(winner, detail=detail)]


# --------------------------------------------------------------------------- #
# Event helpers — read the parsed rx frames uniformly                         #
# --------------------------------------------------------------------------- #
def is_hit(ev: dict) -> bool:
    return ev.get("command") == "HIR"


def shooter_team(ev: dict) -> Optional[int]:
    """$HIR token 4 = shooter team, or None when the hit has no creditable shooter.

    TWO exclusions, and the second was missing until 2026-09-10:

    * **token2 == 15** — a grenade/station BEACON. Never a player shot.
    * **token3 == 0 — "no identity".** A5.1 reserves wire 0 for the "tutorial arms,
      **unknown/environmental shooter**" case and `contracts.md` says it "is never a player";
      `compile.py` arms try-outs at `$PSET,0` precisely so a stray hit is "never credited".
      Nothing enforced it here, and a **grenade hill emits an ordinary `proto=0 mag=8` damage
      word carrying player id 0 every ~5 s** (F69). It sailed past the beacon check, was recorded
      as `_last_shot`, and — because `ATTRIB_FUSE_S` (6 s) is WIDER than the hill's ~5 s period, so
      the attribution never went stale — **credited the hill's owning team with a kill** when the
      ambient damage finally emptied a player. A wrong game outcome, not merely a blind spot.

      ⚠ **This is a TRADE, and the cost is real.** Wire 0 is not only environmental: a gun whose
      `$PSET` never landed also fires with id 0, and its kills are now dropped where they used to
      reach its team via `sole_member_of_team`. A single `$HIR` cannot separate the two cases, and
      no heuristic here should pretend otherwise — the fix belongs at arm time, where MC can verify
      `$PSET` landed instead of letting an identity-less gun into a match (F80).
    """
    t = ev.get("tokens", [])
    if len(t) > 2 and t[2] == "15":
        return None                     # grenade/station beacon, not a player shot
    if len(t) > 3 and str(t[3]).strip() == "0":
        return None                     # A5.1 "no identity": environmental/unknown, never credited
    try:
        return int(t[4]) if len(t) > 4 else None
    except (ValueError, TypeError):
        return None


def shooter_player_id(ev: dict) -> Optional[int]:
    """`$HIR` token 3 = shooter PLAYER id (0-63, set per gun by `$PSET` token 1).

    Preferred over `shooter_team()` for attribution: a team only identifies the shooter
    when it holds exactly one gun (FFA, 1v1), so team-based credit silently fails the
    moment two guns share a team, which is the normal case in TDM. Bench-confirmed
    2026-08-30: TDM 2v1 credited nobody, FFA and 1v1 credited correctly (Q17).

    Returns None for a shot with no creditable shooter -- a beacon (token2 == 15) or
    **wire id 0**, which A5.1 reserves for "no identity" and never assigns to a player.
    A grenade hill's ambient damage word arrives as exactly that (F69).
    """
    t = ev.get("tokens", [])
    if len(t) > 2 and t[2] == "15":
        return None                     # grenade/station beacon, not a player shot
    if len(t) > 3 and str(t[3]).strip() == "0":
        return None                     # A5.1 "no identity": environmental/unknown
    try:
        return int(t[3]) if len(t) > 3 else None
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

    ⚠ **An `$HP` is NOT a 'took damage' signal, and treating it as one is a live bug.** It is
    emitted on every REGISTERED IR word, damaging or not. Measured 2026-09-10 on hardware: a
    grenade hill beacon registering through a `$SIR,15,0,,28` row emits `$HIR` **and** `$HP`
    every ~5 s with the pools completely unchanged. Callers that want "took damage" must compare
    the pools against the previous reading, not merely observe that a frame arrived."""
    if ev.get("command") != "HP":
        return None
    t = ev.get("tokens", [])
    try:
        return int(t[1]), int(t[2]), int(t[3])
    except (IndexError, ValueError, TypeError):
        return None
