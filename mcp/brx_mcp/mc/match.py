"""The data held by one scheduled Mission Control match."""
from __future__ import annotations

from dataclasses import dataclass, field

from .scoring import Scorer
from .types import Player, RecapStationRow


@dataclass
class Match:
    head: dict | None = None
    scorer: Scorer | None = None
    played: dict[str, Player] | None = None
    nodes: dict[str, str] = field(default_factory=dict)
    current: dict[str, str] = field(default_factory=dict)
    evicted: set[str] = field(default_factory=set)
    unbound: set[str] = field(default_factory=set)
    departed_stations: dict[str, RecapStationRow] = field(default_factory=dict)
    frozen_stations: list[RecapStationRow] | None = None

    @classmethod
    def begin(cls, head: dict, scorer: Scorer, played: dict[str, Player], nodes: dict[str, str], *,
              current: dict[str, str] | None = None, evicted: set[str] | None = None,
              unbound: set[str] | None = None,
              departed_stations: dict[str, RecapStationRow] | None = None) -> Match:
        """Install the prepared fields for a scheduled, resumed or adopted match."""
        return cls(head=head, scorer=scorer, played=played, nodes=nodes,
                   current=current if current is not None else {},
                   evicted=evicted if evicted is not None else set(),
                   unbound=unbound if unbound is not None else set(),
                   departed_stations=departed_stations if departed_stations is not None else {})

    def clear_active(self) -> None:
        """Keep bindings and frozen rows when a match leaves play."""
        self.head = None
        self.scorer = None
