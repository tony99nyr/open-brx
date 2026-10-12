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

    def clear_active(self) -> None:
        """Keep bindings and frozen rows when a match leaves play."""
        self.head = None
        self.scorer = None
