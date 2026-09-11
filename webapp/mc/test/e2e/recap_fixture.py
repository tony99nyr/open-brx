"""Generate a koth RecapView from MC'S OWN SCORER, for the browser suite to inject.

Nothing on `app/src` sends the `possession` fact yet (mc/API.md, F70), so no browser run can reach a
recap that HAS one by playing a match. The alternative — hand-writing a JSON fixture in the .mjs —
is the failure mode `docs/` calls "guards read artefacts": rename `observed_s` on the server and a
hand-written fixture keeps the old name, the UI keeps rendering it, and the step keeps passing while
the real recap shows nothing.

So the payload is built by the real `Scorer` and the real `Session.settling()` instead. Rename a
field server-side and this script's output changes (or its key-set assertion fails), and the browser
step that asserts the rendered bar fails with it.

    python recap_fixture.py --coverage thin|full [--settling]

prints one JSON object: a RecapView with `possession` merged with the settling triple.
"""
from __future__ import annotations

import argparse
import json
import sys

from brx_mcp.mc.compile import Compiler
from brx_mcp.mc.fakes import FakeArmory, FakeNet, demo_armory
from brx_mcp.mc.scoring import Scorer
from brx_mcp.mc.state import Session

T0 = 1_000_000
TIME_LIMIT_S = 600
# 441 of 600 s is 73.5% — under the 75% the UI paints the coverage line AMBER at. 560 is 93%, over it.
OBSERVED_MS = {"thin": 441_000, "full": 560_000}


def build(coverage: str, settling: bool) -> dict:
    s = Session(Compiler(), FakeNet(), FakeArmory(demo_armory()), now_ms=lambda: T0)
    s.set_config({"mode": "koth", "time_limit_s": TIME_LIMIT_S})
    for i in range(4):
        s.add_player(f"OP{i}", gun_id=f"GUN-{chr(65 + i)}")

    # The settling triple's KEY NAMES come from the server, not from this file.
    base = s.settling()
    if set(base) != {"settling", "awaiting", "since_end_ms"}:
        sys.exit(f"Session.settling() no longer returns settling/awaiting/since_end_ms: {sorted(base)}")
    assert base["settling"] is False, base          # a session with no match is never settling

    players = list(s.players.values())
    node_player = {f"n{i}": p["player_id"] for i, p in enumerate(players)}
    end = T0 + TIME_LIMIT_S * 1000
    sc = Scorer("m-fixture", T0, TIME_LIMIT_S, "koth", s.players, s.teams, node_player,
                {n: True for n in node_player}, now_ms=lambda: end,
                win_by=s.config["scoring"]["win_by"])
    blue, green = s.config["teams"][0], s.config["teams"][1]
    # one cumulative tally, reported by all four nodes — merged by MAX, never summed (API.md)
    ev = {"type": "possession", "match_id": "m-fixture", "t": end, "site": "A",
          "hold_ms": {str(blue["tid"]): 214_000, str(green["tid"]): 131_000, "2": 96_000},
          "observed_ms": OBSERVED_MS[coverage]}
    for node in node_player:
        got = sc.ingest(node, ev, end)
        if got != "scored":
            sys.exit(f"the scorer refused a possession fact ({got!r}) — the fact shape has moved")
    sc.stats[players[0]["player_id"]].kills = 7
    sc.stats[players[1]["player_id"]].kills = 4
    for st in sc.stats.values():
        st.flushed = True                            # provisional is a different banner; keep it off

    rc = sc.recap()
    if "possession" not in rc:
        sys.exit("Scorer.recap() no longer carries `possession`")
    rc.update(dict(base))
    if settling:
        # `Session.settling()` cannot be driven to True without bound, silent nodes and a finished
        # match; flip the values it already named rather than inventing key names.
        rc["settling"] = True
        rc["awaiting"] = [players[2]["player_id"], players[3]["player_id"]]
        rc["since_end_ms"] = 4_200
    return rc


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--coverage", choices=sorted(OBSERVED_MS), default="thin")
    ap.add_argument("--settling", action="store_true")
    a = ap.parse_args()
    print(json.dumps(build(a.coverage, a.settling)))
