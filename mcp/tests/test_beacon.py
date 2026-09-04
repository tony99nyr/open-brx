"""The advert codec must agree byte-for-byte with app/src/beacon.js (docs/spec/utility.md §2).

The vectors below are the ones app/test/beacon.test.mjs asserts; a change on either side that is not
mirrored here breaks the phones' ability to read each other.
"""
from brx_mcp.beacon import TEAM_ANY, PLAYER_STATE, decode, decode_any, encode


def test_station_round_trip_matches_the_js_vector():
    u = encode("station", 300, "respawn", team=1, state=1, value=0, seq=7, game=0x5A, threshold=-58)
    assert u.startswith("4f425258-01")
    assert u == "4f425258-0101-012c-0101-0100075ac600"
    a = decode(u)
    assert (a.role, a.id, a.kind, a.team, a.state, a.value, a.seq, a.game, a.threshold) == \
        ("station", 300, "respawn", 1, 1, 0, 7, 0x5A, -58)
    assert "station 300 respawn team=1" in a.describe()


def test_player_advert():
    u = encode("player", 19, team=2, state=PLAYER_STATE["alive"] | PLAYER_STATE["planting"])
    a = decode(u)
    assert a.role == "player" and a.id == 19 and a.kind is None and a.team == 2
    assert a.state & PLAYER_STATE["alive"] and a.state & PLAYER_STATE["planting"]
    assert a.threshold == 0
    assert "alive planting" in a.describe()


def test_case_and_dash_tolerance_and_rejections():
    u = encode("station", 1, "bomb", team=TEAM_ANY)
    assert decode(u.upper()) == decode(u) == decode(u.replace("-", ""))
    assert decode("6e400001-b5a3-f393-e0a9-e50e24dcca9e") is None      # Nordic UART
    assert decode(u.replace("4f425258-01", "4f425258-02")) is None      # a future version
    assert decode("garbage") is None
    assert decode_any(["6e400001-b5a3-f393-e0a9-e50e24dcca9e", u]).kind == "bomb"
    assert decode_any([]) is None


def test_threshold_int8_and_clamp():
    assert decode(encode("station", 1, "respawn", threshold=-90)).threshold == -90
    assert decode(encode("station", 1, "respawn", threshold=-200)).threshold == -128
    assert decode(encode("station", 1, "respawn", threshold=0)).threshold == 0
