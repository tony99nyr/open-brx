"""NIGHT OPS is the day LED language, dimmed. It is never darker than that (Tony, bench 2026-09-17).

`config.night` on the Games venue must give the gun and the headset the same signals as a day game, at
low brightness (token 5 = 1) and with the shorter holds of led-language.md §3.4. This file compiles a REAL
FrameBundle for the same player twice, day and night, and walks the two side by side: every frame that is
lit by day must be lit at night, in the same colours and with the same effect, only dimmer. A night frame
that is blank where the day frame is lit is the old blackout (finding #2) coming back.

The bench question behind it: "leds unchanged on headset and gun". The brightness tokens below are the
measurable difference a gun sees: `$GLED,c,c,c,0,10` by day, `$GLED,c,c,c,0,1` at night; `$HLED,c,e,...,10`
by day, `$HLED,c,e,...,1` at night.
"""
from brx_mcp import poolgauge as pg
from brx_mcp.mc.compile import Compiler
from brx_mcp.mc.state import MODES
from _session import match_config

TEAMS = [{"team_id": "blue", "name": "Blue", "color": "blue", "tid": 1},
         {"team_id": "yellow", "name": "Yellow", "color": "yellow", "tid": 2}]
DARK = 9   # palette index 9+ is dark on both surfaces


def _player(team="blue"):
    return {"player_id": "p7", "player_num": 7, "display": "REAPER", "team_id": team,
            "node_id": None, "gun_id": None, "voice": "male", "ready": True,
            "loadout": {"weapons": [{"weapon_id": "assault_rifle"}, {"weapon_id": "shotgun"}]}}


def _num(tok: str) -> int | None:
    try:
        return int(tok)
    except ValueError:
        return None


def _paint(frame: str):
    """(cmd, colours, effect, brightness) for a `$GLED`/`$HLED` paint; None for anything else."""
    t = frame.split(",")
    if t[0] == "$GLED":
        return "GLED", tuple(_num(x) for x in t[1:4]), _num(t[4]), _num(t[5])
    if t[0] == "$HLED":
        return "HLED", (_num(t[1]),), _num(t[2]), _num(t[5])
    return None


def _lit(p) -> bool:
    return p is not None and p[3] != 0 and any(c is not None and 0 <= c < DARK for c in p[1])   # token 5 = 0 is off


def _walk(day, night, where, out):
    """Pair every string in `day` with the string at the same place in `night`; a missing place is a finding."""
    if isinstance(day, str):
        out.append((where, day, night if isinstance(night, str) else None))
    elif isinstance(day, dict):
        for k, v in day.items():
            _walk(v, night.get(k) if isinstance(night, dict) else None, f"{where}.{k}", out)
    elif isinstance(day, (list, tuple)):
        for i, v in enumerate(day):
            n = night[i] if isinstance(night, (list, tuple)) and i < len(night) else None
            _walk(v, n, f"{where}[{i}]", out)


# Every mode MC offers, plus the second team (a different colour through every table).
CASES = [(m["mode"], "blue") for m in MODES] + [("tdm", "yellow")]


def _pairs(mode, team):
    c = Compiler()
    day = c.compile(match_config(mode, night=False, teams=TEAMS), _player(team), TEAMS)
    night = c.compile(match_config(mode, night=True, teams=TEAMS), _player(team), TEAMS)
    out: list = []
    _walk(day, night, "bundle", out)
    return [(w, d, n) for w, d, n in out if d.startswith(("$GLED", "$HLED", "$HLOOP"))]


def test_every_frame_lit_by_day_is_lit_at_night_in_the_same_colours_only_dimmer():
    bad = []
    for mode, team in CASES:
        lit_by_day = [p for p in _pairs(mode, team) if _lit(_paint(p[1]))]
        assert lit_by_day, f"setup: a {mode} day bundle with no lit frame proves nothing"
        bad += _dim_findings(mode, lit_by_day)
    assert not bad, "\n".join(bad)


def _dim_findings(mode, lit_by_day):
    bad = []
    for where, d, n in lit_by_day:
        where = f"{mode}:{where}"
        pd, pn = _paint(d), (_paint(n) if n else None)
        if not _lit(pn):
            bad.append(f"{where}: lit by day {d!r}, blank or missing at night {n!r}")
            continue
        if (pd[0], pd[1], pd[2]) != (pn[0], pn[1], pn[2]):
            bad.append(f"{where}: night changed the signal, not the brightness: {d!r} -> {n!r}")
        if pn[3] != pg.BRIGHT_DIM:
            bad.append(f"{where}: a lit night frame must be dim (token 5 = {pg.BRIGHT_DIM}): {n!r}")
    return bad


def test_night_adds_no_light_and_keeps_the_down_loop():
    """Night never lights a frame the day leaves dark, and the `$HLOOP` down signal is the same frame (no dim exists)."""
    bad = []
    for mode, team, where, d, n in [(m, t, *p) for m, t in CASES for p in _pairs(m, t)]:
        where = f"{mode}:{where}"
        if d.startswith("$HLOOP") and n != d:
            bad.append(f"{where}: the down loop changed at night: {d!r} -> {n!r}")
        elif not _lit(_paint(d)) and n and _lit(_paint(n)):
            bad.append(f"{where}: dark by day, lit at night: {d!r} -> {n!r}")
    assert not bad, "\n".join(bad)


def test_the_bench_numbers_head_and_low_health():
    """The frames a player sees first: the pregame body and head in `head`, and the low-health head blink."""
    c = Compiler()
    day = c.compile(match_config("tdm", night=False, teams=TEAMS), _player(), TEAMS)
    night = c.compile(match_config("tdm", night=True, teams=TEAMS), _player(), TEAMS)
    head_d = [f for f in day["head"] if f.startswith(("$GLED", "$HLED"))]
    head_n = [f for f in night["head"] if f.startswith(("$GLED", "$HLED"))]
    assert head_d == ["$HLED,1,0,,,10,,*", "$GLED,1,1,1,0,10,,*"]
    assert head_n == ["$HLED,1,0,,,1,,*", "$GLED,1,1,1,0,1,,*"]
    assert day["cues"]["hurt_led"] == "$HLED,7,4,90,90,10,15,*"
    assert night["cues"]["hurt_led"] == "$HLED,7,4,90,90,1,15,*"
