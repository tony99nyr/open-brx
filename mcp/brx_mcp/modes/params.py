"""Mode parameters — what an engine lets an operator tune, declared BY THE ENGINE (E1, contracts A18).

The wire `GameConfig` used to be mode-agnostic: `mode, health, respawn, scoring, teams, loadout_policy,
presentation` and nothing else, so an objective mode's own knobs (`score_target`, `channel_s`, `detonation_s`,
…) lived only in the CLI dataclass (`gameconfig.py`) and could not be set from Mission Control at all
(`docs/archive/mode-extensibility.md` G1). `GameConfig.mode_params` is the slot; THIS module is how an engine
says what may go in it.

An engine declares a `PARAMS` class attribute:

    class DominationEngine(ScoredEngine):
        PARAMS = {
            "score_target": Param("int", 0, "point-seconds a team needs to win; 0 = most possession at the clock", lo=0, hi=36000),
            "points_per_s": Param("float", 1.0, "points a held point earns its owner per second", lo=0.1, hi=60),
        }

and reads its values through `resolve(cls, config)`, which takes them from `config.mode_params` when the config
carries one (the wire form) and from a same-named attribute otherwise (the CLI dataclass), so one engine serves
both paths without a shim. `validate()` is what MC runs at `PUT /api/config` and again in `Compiler.validate()`:
unknown keys and out-of-range values are refused in the operator's voice, never silently dropped or clamped —
a knob that "took" a value it then ignored is the failure mode the whole E-series exists to prevent.

Nothing here knows a mode NAME: `registry.py` maps names to engine classes, and that is the single table a later
`register_mode()` (E2) will grow.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

PARAM_TYPES = ("int", "float", "bool", "str")


@dataclass(frozen=True)
class Param:
    """One tunable: its JSON type, default, human description and bounds.

    `lo`/`hi` are inclusive and apply to `int`/`float`; `choices` is the closed vocabulary of a `str` param
    (a `str` param without `choices` accepts any non-empty string up to 64 chars)."""
    type: str
    default: Any
    desc: str
    lo: float | None = None
    hi: float | None = None
    choices: tuple[str, ...] | None = None

    def __post_init__(self) -> None:
        if self.type not in PARAM_TYPES:
            raise ValueError(f"Param type must be one of {PARAM_TYPES}, not {self.type!r}")
        ok, err = self.check("default", self.default)
        if err:
            raise ValueError(f"Param default is not a valid value of its own schema: {err}")

    def check(self, name: str, value: Any) -> tuple[Any, str | None]:
        """Coerce `value` into this param's type, or explain why it cannot be. Returns (value, error)."""
        if self.type == "bool":
            if not isinstance(value, bool):
                return None, f"{name} must be true or false, not {value!r}"
            return value, None
        if self.type == "str":
            if not isinstance(value, str) or not value or len(value) > 64:
                return None, f"{name} must be a short non-empty string, not {value!r}"
            if self.choices and value not in self.choices:
                return None, f"{name} must be one of {', '.join(self.choices)}, not {value!r}"
            return value, None
        # numeric: never a bool (JSON true is not 1 here), and an int param takes a whole number only
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return None, f"{name} must be a number, not {value!r}"
        if self.type == "int":
            if isinstance(value, float):
                if not value.is_integer():
                    return None, f"{name} must be a whole number, not {value!r}"
                value = int(value)
        else:
            value = float(value)
        if self.lo is not None and value < self.lo:
            return None, f"{name} must be at least {self.lo:g}, not {value:g}"
        if self.hi is not None and value > self.hi:
            return None, f"{name} must be at most {self.hi:g}, not {value:g}"
        return value, None

    def to_json(self, name: str) -> dict:
        """The schema row `GET /api/modes` serves, so a UI can render the control without knowing the mode."""
        row: dict = {"name": name, "type": self.type, "default": self.default, "desc": self.desc}
        if self.lo is not None:
            row["min"] = self.lo
        if self.hi is not None:
            row["max"] = self.hi
        if self.choices:
            row["choices"] = list(self.choices)
        return row


Schema = dict[str, Param]


def schema_of(engine_cls: type) -> Schema:
    """The `PARAMS` an engine class declares (empty for one that declares nothing).

    Non-`Param` entries are FILTERED OUT: A28.4 lets a mode declare the flag `requires_coverage: True`
    alongside its tunables, and a bare `True` here would blow up `defaults_of` (`p.default`) inside a
    config default. Flags are read by name (`registry.requires_coverage`), never as parameters."""
    return {k: v for k, v in (getattr(engine_cls, "PARAMS", {}) or {}).items() if isinstance(v, Param)}


def defaults_of(schema: Schema) -> dict:
    return {k: p.default for k, p in schema.items()}


def validate(schema: Schema, values: dict | None, *, mode: str) -> tuple[dict, list[str]]:
    """Check `values` against `schema` and fill the defaults in. Returns (resolved, errors).

    `resolved` always carries EVERY schema key (defaults for the ones `values` omits), so what is stored and
    pushed is the complete rule set and a node needs no schema of its own to read it (contracts §3: no hidden
    state). It is meaningful only when `errors` is empty."""
    errors: list[str] = []
    values = values or {}
    if not isinstance(values, dict):
        return defaults_of(schema), [f"mode_params must be an object of {mode!r}'s parameters"]
    known = ", ".join(sorted(schema)) if schema else "none"
    for k in values:
        if k not in schema:
            if schema:
                errors.append(f"mode {mode!r} has no parameter {k!r} — its parameters are: {known}")
            else:
                errors.append(f"mode {mode!r} takes no mode_params, so {k!r} would be a control that does nothing")
    resolved = defaults_of(schema)
    for k, p in schema.items():
        if k in values:
            v, err = p.check(f"mode_params.{k}", values[k])
            if err:
                errors.append(f"mode {mode!r}: {err}")
            else:
                resolved[k] = v
    return resolved, errors


def resolve(engine_cls: type, config: Any, fallback: dict | None = None) -> dict:
    """The values an ENGINE runs on, from either config shape.

    * wire form (a dict, or any object with a `mode_params` mapping): the params are read from there;
    * CLI dataclass (`gameconfig.GameConfig`, no `mode_params`): each param falls back to a same-named
      attribute (`config.score_target`), or to `fallback[name]` when the caller supplies one, or to the default.

    Raises ValueError on a value the schema refuses — an engine must not start on a rule it cannot honour."""
    schema = schema_of(engine_cls)
    if not schema:
        return {}
    mode = str(config.get("mode") if isinstance(config, dict) else getattr(config, "mode", "?"))
    if isinstance(config, dict):
        mp = config.get("mode_params")
    else:
        mp = getattr(config, "mode_params", None)
    if isinstance(mp, dict):
        values = mp
    else:
        values = {}
        fallback = fallback or {}
        for k in schema:
            if k in fallback and fallback[k] is not None:
                values[k] = fallback[k]
            elif not isinstance(config, dict) and hasattr(config, k):
                v = getattr(config, k)
                if v is not None and not callable(v):
                    values[k] = v
    resolved, errors = validate(schema, values, mode=mode)
    if errors:
        raise ValueError("; ".join(errors))
    return resolved
