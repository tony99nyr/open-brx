"""A3: every constant `GunStage` mirrors from the phone's JS equals the JS value, in the stage's units.

The stage exists to PREDICT `app/src/engine.js`. UNITS: the JS runs on `Date.now()` (ms); the stage runs on
`time.monotonic` (SECONDS), so a `*_MS` constant is a `*_S` float here. One table row per mirrored constant:
(stage name, JS file, JS name, divisor). A divisor of 1000 is the ms-to-s conversion, 1 is a plain copy.

A second test fails when a stage constant that has a JS counterpart is missing from the table, so a new mirror
cannot go unchecked. A constant that is deliberately not mirrored goes in NOT_MIRRORED with its reason.
"""
from __future__ import annotations

import ast
import pathlib
import re

from brx_mcp.stage import stage as S

_REPO = pathlib.Path(__file__).resolve().parents[2]
_SRC = _REPO / "app" / "src"
_STAGE_PY = pathlib.Path(S.__file__)

# (stage name, JS file under app/src, JS name, divisor)
TABLE = [
    # frames the stage writes verbatim
    ("SFLASH", "engine.js", "SFLASH", 1),
    ("PLAYX", "engine.js", "PLAYX", 1),
    ("QUERY", "engine.js", "QUERY", 1),
    ("PROBE_LIFE", "engine.js", "PROBE_LIFE", 1),
    ("PARSER_RESET", "engine.js", "PARSER_RESET", 1),
    ("STUN_PLAY", "engine.js", "STUN_PLAY", 1),
    # the audio queue
    ("PLAY_GAP_S", "announcer.js", "PLAY_GAP_MS", 1000),
    ("ANNOUNCE_DEFAULT_CLIP_S", "announcer.js", "ANNOUNCE_DEFAULT_CLIP_MS", 1000),
    ("ANNOUNCE_GAP_MS", "announcer.js", "ANNOUNCE_GAP_MS", 1),                    # F478: the gun audio model and the pool lines
    ("ANNOUNCE_AUDIO_LATE_DEFAULT_MS", "announcer.js", "ANNOUNCE_AUDIO_LATE_DEFAULT_MS", 1),
    ("DEAD_QUEUE_TTL_MS", "announcer.js", "DEAD_QUEUE_TTL_MS", 1),
    ("PAIN_STALE_MS", "engine.js", "PAIN_STALE_MS", 1),
    ("DEATH_LATE_WRITE_MS", "engine.js", "DEATH_LATE_WRITE_MS", 1),
    ("SHIELD_CHARGING_MIN_MS", "engine.js", "SHIELD_CHARGING_MIN_MS", 1),
    # LEDs, pain, low health
    ("EVENT_MIN_GAP_S", "engine.js", "EVENT_MIN_GAP_MS", 1000),
    ("PAIN_GAP_S", "engine.js", "PAIN_GAP_MS", 1000),
    ("TEAM_REPAINT_S", "engine.js", "TEAM_REPAINT_MS", 1000),
    ("LOW_HEALTH_HP", "engine.js", "LOW_HEALTH_HP", 1),
    ("HURT_DEBOUNCE_S", "engine.js", "HURT_DEBOUNCE_MS", 1000),
    ("HURT_MAX_WAIT_S", "engine.js", "HURT_MAX_WAIT_MS", 1000),
    ("RELOAD_NAG_FIRST", "ammo.js", "RELOAD_NAG_FIRST", 1),
    ("RELOAD_NAG_EVERY", "ammo.js", "RELOAD_NAG_EVERY", 1),
    # the shield
    ("SHIELD_REGEN_DELAY_S", "engine.js", "SHIELD_REGEN_DELAY_MS", 1000),
    ("SHIELD_REGEN_GRANTS", "engine.js", "SHIELD_REGEN_GRANTS", 1),
    ("SHIELD_REGEN_STEP_S", "engine.js", "SHIELD_REGEN_STEP_MS", 1000),
    ("SHIELD_REGEN_MAX_GRANTS_SLACK", "engine.js", "SHIELD_REGEN_MAX_GRANTS_SLACK", 1),
    ("SPAWN_SHIELD_FULL", "engine.js", "SPAWN_SHIELD_FULL", 1),
    ("SELF_HIT_ECHO_S", "engine.js", "SELF_HIT_ECHO_MS", 1000),
    ("SHIELD_LOOP_S", "engine.js", "SHIELD_LOOP_MS", 1000),
    ("MEDAL_GAP_S", "engine.js", "MEDAL_GAP_MS", 1000),
    ("READOUT_COALESCE_S", "engine.js", "READOUT_COALESCE_MS", 1000),
    # the hill and the control point
    ("HILL_MAG", "engine.js", "HILL_MAG", 1),
    ("HILL_CAPTURE_MAG", "engine.js", "HILL_CAPTURE_MAG", 1),
    ("HILL_WAS_NEUTRAL_MAG", "engine.js", "HILL_WAS_NEUTRAL_MAG", 1),
    ("HILL_NEUTRAL_TEAM", "transport/contract.gen.js", "HILL_REFUSED_TID", 1),   # engine.js aliases it (review #4)
    ("HILL_TICK_S", "engine.js", "HILL_TICK_MS", 1000),
    ("HILL_PRESENCE_S", "engine.js", "HILL_PRESENCE_MS", 1000),
    ("CONTROL_STALE_S", "engine.js", "CONTROL_STALE_MS", 1000),
    ("CONTROL_RECONNECT_S", "engine.js", "CONTROL_RECONNECT_MS", 1000),
    ("HILL_CALLOUT_MIN_S", "engine.js", "HILL_CALLOUT_MIN_MS", 1000),
    ("HILL_TICK_LOSING_S", "engine.js", "HILL_TICK_LOSING_MS", 1000),
    ("RARE_GUARD_S", "engine.js", "RARE_GUARD_MS", 1000),
    ("STUN_DEFAULT_S", "engine.js", "STUN_DEFAULT_S", 1),      # already seconds in the JS
    ("DOT_ECHO_S", "engine.js", "DOT_ECHO_MS", 1000),
    ("DOT_KILL_S", "engine.js", "DOT_KILL_MS", 1000),
    ("STATION_TEAM_ANY", "transport/contract.gen.js", "STATION_TEAM_ANY", 1),
]

# Stage constants deliberately absent from the table, each with the reason.
NOT_MIRRORED = {
    # F478: announcer.js keeps it as one field of `ANNOUNCE_TTL_MS` (an object, not a literal this table can read);
    # test_stage_hp_mirror.py pins it against that field.
    "STATUS_TTL_MS": "announcer.js ANNOUNCE_TTL_MS.status, pinned in test_stage_hp_mirror.py",
    "BEACON_DEDUPE_S": "an inline literal in engine.js (`< 150`), pinned by test_stage.py's regex",
    "HILL_CUES": "a dict, pinned cue by cue in test_stage.py",
    "HILL_AUDIO_EXCLUDED_MODES": "a Set, pinned in test_stage.py",
    "CONTROL_STATE": "an object literal in control.js, pinned in test_stage.py",
}


def _js_value(file: str, name: str):
    """The literal behind `const NAME = ...` (or `, NAME = ...` in a comma list) in an app/src file."""
    text = (_SRC / file).read_text(encoding="utf-8")
    pat = (rf"(?:\bconst\s+|,\s*)(?:export\s+)?{re.escape(name)}\s*=\s*"
           r"('[^']*'|\"[^\"]*\"|-?\d+(?:\.\d+)?|true|false)\s*[,;]")
    m = re.search(pat, text)
    if not m:
        return None
    raw = m.group(1)
    if raw in ("true", "false"):
        return raw == "true"
    if raw[0] in "'\"":
        return raw[1:-1]
    return float(raw) if "." in raw else int(raw)


def _mismatch(stage_name, js_file, js_name, divisor):
    """None when the stage constant equals the JS one in the stage's units, else a message naming both values."""
    js = _js_value(js_file, js_name)
    if js is None:
        return f"{js_file} no longer defines a literal {js_name} (stage.{stage_name} mirrors it)"
    want = js / divisor if divisor != 1 and not isinstance(js, bool) else js
    got = getattr(S, stage_name)
    if isinstance(want, bool) or isinstance(got, bool):
        ok = got is want
    elif isinstance(want, (int, float)):
        ok = abs(got - want) < 1e-9
    else:
        ok = got == want
    if ok:
        return None
    return (f"stage.{stage_name} = {got!r} but {js_file} {js_name} = {js!r}"
            f"{f' (/{divisor} = {want!r})' if divisor != 1 else ''}")


def test_stage_constants_match_the_engine():
    bad = [m for row in TABLE if (m := _mismatch(*row))]
    assert not bad, "stage constants drifted from the engine:\n  " + "\n  ".join(bad)


def test_every_stage_constant_with_a_js_counterpart_is_in_the_table():
    """A new mirror must get a row. A stage constant counts as a mirror when its line cites a `.js` file, or when
    its name (with `_S` read as `_MS`) is a literal constant in engine.js or announcer.js."""
    src = _STAGE_PY.read_text(encoding="utf-8")
    lines = src.splitlines()
    tabled = {r[0] for r in TABLE}
    missing = []
    for node in ast.parse(src).body:
        if not isinstance(node, ast.Assign):
            continue
        names = [n.id for t in node.targets for n in ([t] if isinstance(t, ast.Name) else getattr(t, "elts", []))
                 if isinstance(n, ast.Name)]
        cites_js = bool(re.search(r"\b\w+\.js\b", lines[node.lineno - 1]))
        for name in names:
            if name.startswith("_") or name in tabled or name in NOT_MIRRORED:
                continue
            cands = [name] + ([name[:-2] + "_MS"] if name.endswith("_S") else [])
            has_twin = any(_js_value(f, c) is not None for f in ("engine.js", "announcer.js") for c in cands)
            if cites_js or has_twin:
                missing.append(name)
    assert not missing, (f"stage constants that mirror a JS constant but have no row in TABLE: {missing}. "
                         "Add a row, or list the name in NOT_MIRRORED with a reason.")


def test_every_table_row_names_a_real_stage_constant_and_not_twice():
    names = [r[0] for r in TABLE]
    assert len(names) == len(set(names)), "a stage constant has two rows"
    assert not [n for n in names if not hasattr(S, n)], "a row names a stage constant that does not exist"
    assert not [n for n in NOT_MIRRORED if not hasattr(S, n)], "NOT_MIRRORED names a missing constant"
