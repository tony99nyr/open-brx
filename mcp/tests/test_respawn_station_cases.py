"""F658 (A86): the stage's twin of the phone's respawn-station pick, against the cases it shares with the phone.

`app/test/fixtures/respawn-station-cases.json` is the one statement of the rule; `app/test/respawn-station-cases.test.mjs`
runs it through beacon.js (Presence and `respawnStation`, which engine.js reads). This runner runs the same cases
through `stage.heard_by_player` and `stage.respawn_station`."""
from __future__ import annotations

import json
import pathlib

from brx_mcp.stage import stage as S

FIXTURE = pathlib.Path(__file__).resolve().parents[2] / "app" / "test" / "fixtures" / "respawn-station-cases.json"
CASES = json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]


def _run(case: dict) -> None:
    config = {} if case["config_stations"] is None else {"stations": case["config_stations"]}
    kept: dict[int, dict] = {}
    for game in case["player"]["games"]:
        # Presence's game setter: a new byte drops what another non-zero byte taught it, except an any-game kind
        kept = {i: e for i, e in kept.items() if S.heard_by_player(e, game)}
        for s in case["heard"]:
            if S.heard_by_player({**s, "role": "station"}, game):
                kept[s["id"]] = {**s, "role": "station"}
        entries = sorted(kept.values(), key=lambda e: -e["rssi"])
        at = f"{case['name']}: game {game}"
        if "expect_heard" in case:
            assert sorted(kept) == case["expect_heard"], at
        got = S.respawn_station(entries, config, case["player"]["tid"])
        assert (got["id"] if got else None) == case["expect"], at


def test_the_stage_picks_the_respawn_station_the_phone_picks():
    for case in CASES:   # a plain loop: run_tests.py runs these under system python, with no parametrize
        _run(case)


def test_the_case_file_covers_the_f658_rules():
    assert len(CASES) >= 8
    names = " ".join(c["name"] for c in CASES)
    for words in ("not list", "another game byte", "old game", "team"):
        assert words in names, words
