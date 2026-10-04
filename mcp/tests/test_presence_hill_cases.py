"""The stage's reading of a hill against the cases the phone and the Stick share.

`app/test/fixtures/presence-hill-cases.json` is the one statement of F440's presence and hill rules
(architecture review 2026-10-04, item 3). `app/test/presence-hill-cases.test.mjs` runs it through beacon.js and
control.js, and `hardware/m5sticks3/test/test_presence_cases.cpp` through presence.h. The stage has no presence
model of its own: a station decides, the stage READS the three advert bytes (team, state, value). So this runner
takes each checkpoint's expected `hill` advert, puts it on the stage's air through `station_advert` (which
encodes and decodes it with the phone's 16-byte layout) and checks the hill the stage derives from it. A case
that does not name `stage` in its `only` list is run; a checkpoint with no `hill` is not the stage's business.

Limit: the stage echoes its input, so this runner cannot tell a WRONG expected value from a right one (a flipped
`value` in the file still passes here). The phone and Stick runners are what pin the numbers; the legality test
below guards the file's shape.
"""
from __future__ import annotations

import asyncio
import json
import pathlib

import pytest

from brx_mcp.stage import stage as S
from test_stage_mirror import mk_point

FIXTURE = pathlib.Path(__file__).resolve().parents[2] / "app" / "test" / "fixtures" / "presence-hill-cases.json"
CASES = json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]
STAGE_CASES = [c for c in CASES if "stage" in c.get("only", ["stage"])]


def _state_byte(names: list[str]) -> int:
    byte = 0
    for n in names:
        assert n in S.CONTROL_STATE, f"unknown hill state {n}"
        byte |= S.CONTROL_STATE[n]
    return byte


async def _stage_reads(hill: dict) -> dict:
    st, _mgr, _clock = mk_point(tid=1)
    flags = _state_byte(hill["state"])
    st.station_advert(id=1, team=hill["team"], flags=flags, value=hill["value"], present=True)
    return dict(st.hill)


@pytest.mark.parametrize("case", STAGE_CASES, ids=lambda c: c["name"])
def test_the_stage_reads_every_expected_hill_advert(case):
    for ex in case["expect"]:
        hill = ex.get("hill")
        if not hill:
            continue
        got = asyncio.run(_stage_reads(hill))
        held = "held" in hill["state"]
        at = f"t={ex['t']} hill {hill}"
        # control.js advert(): byte 9 is the owner while held, else the team building it, else 255.
        assert got["owner"] == (hill["team"] if held and S.claimable(hill["team"]) else S.HILL_NEUTRAL_TEAM), at
        assert got["progress"] == hill["value"], at
        assert got["holding"] == (hill["team"] if hill["team"] <= 3 else None), at
        assert got["contested"] == ("contested" in hill["state"]), at
        # §5d.3: rising and falling together read as direction unknown, never as either.
        both = "rising" in hill["state"] and "falling" in hill["state"]
        assert got["rising"] == ("rising" in hill["state"] and not both), at
        assert got["falling"] == ("falling" in hill["state"] and not both), at
        assert got["source"] == "station" and got["site"] == 1, at


def test_the_case_file_is_not_empty_and_the_stage_reads_some_of_it():
    assert len(CASES) >= 15
    assert any(ex.get("hill") for c in STAGE_CASES for ex in c["expect"])


def test_every_expected_hill_advert_is_one_a_station_may_send():
    """The stage only echoes a hill advert, so guard the case file itself: byte 11 is 0..100, a held point's owner
    is a claimable tid (F82 refuses 2), a point nobody holds names 255 or the team building it."""
    for c in CASES:
        for ex in c["expect"]:
            h = ex.get("hill")
            if not h:
                continue
            at = f"{c['name']} t={ex['t']}"
            assert 0 <= h["value"] <= 100, at
            if "held" in h["state"]:
                assert S.claimable(h["team"]), at
            else:
                assert h["team"] == S.STATION_TEAM_ANY or S.claimable(h["team"]), at
            assert not ("rising" in h["state"] and "falling" in h["state"]), at


def test_every_checkpoint_is_on_a_tick_once_and_names_a_player_the_case_has():
    for c in CASES:
        seen = set()
        for ex in c["expect"]:
            at = f"{c['name']} t={ex['t']}"
            assert ex["t"] <= c["until_ms"] and ex["t"] % c["setup"]["tick_ms"] == 0, at
            assert ex["t"] not in seen, f"duplicate checkpoint {at}"
            seen.add(ex["t"])
            for id in [*ex.get("in", {}), *ex.get("present", {})]:
                assert id in c["players"], f"{at} names player {id}, which the case does not have"
        kf = c.get("known_fail")
        if kf:
            assert kf["why"].startswith("F"), f"{c['name']}: a known_fail names its follow-up id"
            assert kf["at"] and all(t in seen for t in kf["at"]), f"{c['name']}: known_fail.at must name checkpoints"
