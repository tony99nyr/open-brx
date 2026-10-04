"""The Stick's hand-mirrored advert, presence and hill numbers against the phone's exports.

`hardware/m5sticks3/presence.h` and `brx_advert.h` copy numbers that live in `app/src/beacon.js` and
`app/src/control.js` (a C++ header cannot import a JS module). Each copy names its twin in a comment, and a
comment does not fail when one side moves. This reads both files with a regex and fails when a pair differs
(architecture review 2026-10-04, item 3, D11). The behaviour of those numbers is checked by the shared case file
(`app/test/fixtures/presence-hill-cases.json`); this file checks that the CONSTANTS agree.
"""
from __future__ import annotations

import pathlib
import re

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[2]
BEACON_JS = (ROOT / "app/src/beacon.js").read_text(encoding="utf-8")
CONTROL_JS = (ROOT / "app/src/control.js").read_text(encoding="utf-8")
UTILITY_JS = (ROOT / "app/src/utility.js").read_text(encoding="utf-8")
PRESENCE_H = (ROOT / "hardware/m5sticks3/presence.h").read_text(encoding="utf-8")
ADVERT_H = (ROOT / "hardware/m5sticks3/brx_advert.h").read_text(encoding="utf-8")
RANGE_H = (ROOT / "hardware/m5sticks3/station_range.h").read_text(encoding="utf-8")
NUM = r"(-?\d+(?:\.\d+)?)"


def _num(text: str, pattern: str, where: str) -> float:
    m = re.search(pattern, text)
    assert m, f"{where}: cannot find {pattern!r}; if the constant moved or was renamed, update this parity test"
    return float(m.group(1))


def cpp(text: str, name: str) -> float:
    """`constexpr <type> NAME = 12;` or `NAME = 12,` among several on one line."""
    return _num(text, rf"\b{name}\s*=\s*{NUM}", name)


def js_const(text: str, name: str) -> float:
    return _num(text, rf"\b{name}\s*=\s*{NUM}\s*;", name)


def js_ctor_default(text: str, name: str) -> float:
    """A default in the Presence constructor's destructuring: `expiryMs = 4000`."""
    return _num(text, rf"\b{name}\s*=\s*{NUM}\s*[,}}]", name)


def js_object(text: str, name: str) -> dict[str, float]:
    """`name = { a: 1, b: 2 }` or `name = Object.freeze({ a: 1 })` as {a: 1, b: 2}."""
    m = re.search(rf"\b{name}\s*=\s*(?:Object\.freeze\(\s*)?\{{([^}}]*)\}}", text)
    assert m, f"{name}: object literal not found; update this parity test"
    pairs = dict(re.findall(rf"(\w+)\s*:\s*{NUM}", m.group(1)))
    assert pairs, f"{name}: no numeric members parsed"
    return {k: float(v) for k, v in pairs.items()}


# (C++ name in presence.h, how to read the JS twin). Every pair here must be equal.
PRESENCE_PAIRS = [
    ("PRESENCE_HYSTERESIS_DB", lambda: js_const(BEACON_JS, "EXIT_BAND_DB")),
    ("PRESENCE_EXIT_GRACE_MS", lambda: js_const(BEACON_JS, "EXIT_GRACE_MS")),
    ("PRESENCE_SIGHT_MS", lambda: js_const(BEACON_JS, "SIGHT_MS")),
    ("PRESENCE_SIGHT_WINDOW_MS", lambda: js_const(BEACON_JS, "SIGHT_WINDOW_MS")),
    ("SIGHT_RECENT_MAX", lambda: js_const(BEACON_JS, "SIGHT_RECENT_MAX")),
    ("MEDIAN_SAMPLES", lambda: js_const(BEACON_JS, "MEDIAN_SAMPLES")),
    ("REVIVE_MARGIN_DB", lambda: js_const(BEACON_JS, "REVIVE_MARGIN_DB")),
    ("PRESENCE_EXPIRY_MS", lambda: js_ctor_default(BEACON_JS, "expiryMs")),
    ("PRESENCE_ALPHA", lambda: js_ctor_default(BEACON_JS, "alpha")),
    ("PRESENCE_DEFAULT_THRESHOLD_DBM", lambda: js_const(BEACON_JS, "STATION_THRESHOLD_DBM")),
    ("PRESENCE_DWELL_MS", lambda: _num(UTILITY_JS, rf"\bdwell:\s*{NUM}", "utility.js DEFAULTS.dwell")),
    ("STATION_TICK_MS", lambda: _num(UTILITY_JS, rf"setInterval\(tick,\s*{NUM}\)", "utility.js tick interval")),
    ("HILL_CAPTURE_S", lambda: js_const(CONTROL_JS, "DEFAULT_CAPTURE_S")),
    ("HILL_NET_CAP", lambda: js_const(CONTROL_JS, "DEFAULT_NET_CAP")),
    ("HILL_MAX_STEP_MS", lambda: js_const(CONTROL_JS, "MAX_STEP_MS")),
    ("HILL_REFUSED_TID", lambda: js_const(CONTROL_JS, "REFUSED_TID")),
    ("PLAYER_ALIVE", lambda: js_object(BEACON_JS, "PLAYER_STATE")["alive"]),
]


@pytest.mark.parametrize("name,twin", PRESENCE_PAIRS, ids=[p[0] for p in PRESENCE_PAIRS])
def test_presence_h_constant_matches_its_js_twin(name, twin):
    assert cpp(PRESENCE_H, name) == twin(), f"presence.h {name} differs from its JS twin"


def test_hill_neutral_is_the_any_team_byte():
    assert re.search(r"\bHILL_NEUTRAL\s*=\s*TEAM_ANY\b", PRESENCE_H), "presence.h HILL_NEUTRAL must stay TEAM_ANY (control.js NEUTRAL)"
    assert re.search(r"export const NEUTRAL\s*=\s*TEAM_ANY\b", CONTROL_JS)


def test_the_stick_threshold_defaults_match_the_phones_platform_table():
    assert cpp(RANGE_H, "STICK_DEFAULT_THRESHOLD_DBM") == js_object(BEACON_JS, "RESPAWN_RSSI_DBM")["sticks3"]
    assert cpp(RANGE_H, "STICK_HILL_DEFAULT_THRESHOLD_DBM") == js_object(BEACON_JS, "CONTROL_RSSI_DBM")["sticks3"]
    assert cpp(RANGE_H, "STICK_POWERUP_DEFAULT_THRESHOLD_DBM") == js_object(BEACON_JS, "POWERUP_RSSI_DBM")["sticks3"]


def test_the_advert_kind_role_and_team_tables_match():
    kinds = js_object(BEACON_JS, "KIND")
    assert kinds == {k.lower(): cpp(ADVERT_H, f"KIND_{k}") for k in ("RESPAWN", "POWERUP", "EXTRACTION", "BOMB", "CONTROL")}
    roles = js_object(BEACON_JS, "ROLE")
    assert roles == {"station": cpp(ADVERT_H, "ROLE_STATION"), "player": cpp(ADVERT_H, "ROLE_PLAYER")}
    assert cpp(ADVERT_H, "ADVERT_VERSION") == js_const(BEACON_JS, "VERSION")
    assert cpp(ADVERT_H, "TEAM_ANY") == js_const(BEACON_JS, "TEAM_ANY")
    magic = [int(x, 16) for x in re.search(r"MAGIC\s*=\s*\[([^\]]*)\]", BEACON_JS).group(1).replace(" ", "").split(",")]
    assert magic == [0x4F, 0x42, 0x52, 0x58]
    assert "0x4f, 0x42, 0x52, 0x58" in ADVERT_H, "brx_advert.h advert_bytes() magic"


def test_the_hill_state_and_player_state_bits_match():
    hill = js_object(CONTROL_JS, "CONTROL_STATE")
    assert hill == {k.lower(): cpp(ADVERT_H, f"CONTROL_{k}") for k in ("HELD", "CONTESTED", "RISING", "FALLING")}
    player = js_object(BEACON_JS, "PLAYER_STATE")
    assert player["claiming"] == cpp(ADVERT_H, "PLAYER_CLAIMING")
    assert player["claim_ready"] == cpp(ADVERT_H, "PLAYER_CLAIM_READY")


def test_the_parity_test_can_fail():
    """The reader must see a changed number, or the checks above are decoration."""
    assert js_const(BEACON_JS.replace("EXIT_BAND_DB = 3;", "EXIT_BAND_DB = 4;"), "EXIT_BAND_DB") == 4
    assert cpp(PRESENCE_H.replace("PRESENCE_HYSTERESIS_DB = 3;", "PRESENCE_HYSTERESIS_DB = 5;"), "PRESENCE_HYSTERESIS_DB") == 5
