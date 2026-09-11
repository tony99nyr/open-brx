"""Mode name → engine class, in ONE table (the E2 seed; contracts A18).

`driver.build_engine`, MC's `GET /api/modes` param schema, `PUT /api/config` validation and
`Compiler.validate()` all resolve a mode name here. Registration used to be hardcoded in four places
(`docs/archive/mode-extensibility.md` G3); this table is the first of them to become data. A later
`register_mode(name, engine_cls, meta, preset, scorer)` grows THIS dict — nothing else should learn a
mode name by string comparison.

Imports are lazy on purpose: the engines import `..sounds`, `hillbeacon` and each other, and `driver.py`
already had to defer them to avoid an import cycle.
"""

from __future__ import annotations

from typing import Callable

from . import params as _params
from .params import Param, Schema


def _engines() -> dict[str, type]:
    from .cs import BombEngine
    from .deathmatch import DeathmatchEngine
    from .extraction_adapter import ExtractionEngineAdapter
    from .lms import LastManStandingEngine
    from .objectives import CtfEngine, DominationEngine
    from .survival import InfectionEngine
    return {
        "tdm": DeathmatchEngine, "ffa": DeathmatchEngine,
        "infection": InfectionEngine, "survival": InfectionEngine,
        "lms": LastManStandingEngine,
        "cs": BombEngine, "bomb": BombEngine,
        "domination": DominationEngine,
        "koth": DominationEngine,          # KotH = domination on ONE point (build_engine forces control_points=1)
        "ctf": CtfEngine,
        "extraction": ExtractionEngineAdapter,
    }


_EXTRA: dict[str, type] = {}     # register_mode() additions (E2) land here, ahead of the built-ins


def register_mode(name: str, engine_cls: type) -> None:
    """E2's first half: make `name` buildable and its `PARAMS` visible. The MC catalog row / presentation
    preset / scorer halves are still hand-registered (state.MODES, presentation.MODE_PRESET, scoring)."""
    if not isinstance(name, str) or not name:
        raise ValueError("mode name must be a non-empty string")
    _EXTRA[name] = engine_cls


def known_modes() -> list[str]:
    return sorted(set(_engines()) | set(_EXTRA))


def engine_class(mode: str) -> type:
    """The engine that runs `mode`; ValueError (naming the vocabulary) for an unknown name."""
    table = _engines()
    cls = _EXTRA.get(mode) or table.get(mode)
    if cls is None:
        raise ValueError(f"unknown mode {mode!r} ({'|'.join(sorted(set(table) | set(_EXTRA)))})")
    return cls


def params_schema(mode: str) -> Schema:
    """What `mode` lets an operator tune (`{}` for a mode that declares nothing, and for an unknown one —
    the name itself is refused elsewhere; this must not raise inside a config default)."""
    try:
        return _params.schema_of(engine_class(mode))
    except ValueError:
        return {}


def params_schema_json(mode: str) -> list[dict]:
    """The rows `GET /api/modes` serves as `params`."""
    return [p.to_json(k) for k, p in params_schema(mode).items()]


def default_params(mode: str) -> dict:
    return _params.defaults_of(params_schema(mode))


def validate_mode_params(mode: str, values: dict | None) -> tuple[dict, list[str]]:
    """`(resolved, errors)` for an operator's `mode_params` on `mode` — see `params.validate`."""
    return _params.validate(params_schema(mode), values, mode=mode)


__all__ = ["Param", "Schema", "register_mode", "known_modes", "engine_class", "params_schema",
           "params_schema_json", "default_params", "validate_mode_params"]
