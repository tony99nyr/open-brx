"""Regression scenarios: the minimal action scripts of bugs chaos testing found. Each one ran red
before its fix and runs in CI from then on (its `ci_seeds`). The seed does not matter to a script;
it only names the run.

Add one per bug: shrink the failing trace (`python -m brx_mcp.chaos replay <trace> --shrink`),
paste its actions here, and name the FOLLOWUPS row or the commit in `doc`.
"""
from __future__ import annotations

from ..registry import Scenario, scenario

scenario(Scenario(
    name="restart-after-hot-join", mode="tdm", nodes=4,
    doc="Chaos 2026-09-24 (koth-mixed seed 6): an MC restart mid-match lost every fact of a player who "
        "hot-joined, because the match snapshot kept only the roster as the match went in.",
    script=[
        {"name": "late_join", "params": {}},
        # node 4 is the hot joiner (blue); node 1 is yellow
        {"name": "hit", "params": {"victim": 4, "shooter": 1, "dmg": 12, "words": 1}},
        {"name": "kill", "params": {"victim": 4, "shooter": 1}},
        {"name": "mc_restart", "params": {}},
        {"name": "respawn", "params": {"node": 4}},
        {"name": "kill", "params": {"victim": 1, "shooter": 4}},
        {"name": "end", "params": {}},
    ],
    ci_seeds=(1,),
))

scenario(Scenario(
    name="restart-twice-while-offline", mode="tdm", nodes=4,
    doc="Chaos 2026-09-24 (koth-mixed seed 122): a SECOND MC restart lost the facts of a node that had not "
        "said hello since the first, because each snapshot kept only the bindings of connected nodes.",
    script=[
        # node 1 is yellow, node 2 is blue
        {"name": "kill", "params": {"victim": 1, "shooter": 2}},
        {"name": "drop", "params": {"node": 1}},
        {"name": "mc_restart", "params": {}},
        {"name": "mc_restart", "params": {}},
        {"name": "reconnect", "params": {"node": 1}},
        {"name": "end", "params": {}},
    ],
    ci_seeds=(1,),
))

scenario(Scenario(
    name="crash-after-hot-join", mode="tdm", nodes=4,
    doc="Chaos 2026-09-24 (F329): an MC CRASH inside the 2 s snapshot debounce of a hot join resumed without the "
        "joiner's binding, and the joiner's stored facts scored for nobody.",
    script=[
        {"name": "late_join", "params": {}},
        {"name": "hit", "params": {"victim": 4, "shooter": 1, "dmg": 12, "words": 1}},
        {"name": "kill", "params": {"victim": 4, "shooter": 1}},
        {"name": "mc_crash", "params": {}},
        {"name": "end", "params": {}},
    ],
    ci_seeds=(1,),
))

scenario(Scenario(
    name="clock-back-assist", mode="tdm", nodes=4,
    doc="Chaos 2026-09-24 (F330, OPEN): after a backward clock jump, a hit from the victim's NEXT life sorts before "
        "its death, and a replay credits an assist the live board never gave.",
    script=[
        # nodes 0 and 2 are blue, 1 and 3 are yellow
        {"name": "kill", "params": {"victim": 0, "shooter": 1}},
        {"name": "respawn", "params": {"node": 0}},
        {"name": "clock_jump", "params": {"node": 0, "delta_ms": -3000}},
        {"name": "hit", "params": {"victim": 0, "shooter": 3, "dmg": 5, "words": 1}},
        {"name": "mc_restart", "params": {}},
        {"name": "end", "params": {}},
    ],
    xfail="F330: a replay credits an assist from the victim's next life after a backward clock jump",
    xfail_invariant="snapshot_survives_restart",
    ci_seeds=(1,),
))

scenario(Scenario(
    name="cap-after-restart-offline-node", mode="tdm", nodes=4,
    doc="Chaos 2026-09-24 (tdm-frag-race seed 202): the frag cap's re-derivation (`_replay`) bound the "
        "stored facts through the nodes connected NOW, so a phone offline since an MC restart lost its "
        "kills from the recap the moment the cap was reached.",
    config={"scoring": {"frag_limit": 2, "win_by": "kills"}},
    script=[
        # nodes 0 and 2 are blue, 1 and 3 are yellow. Yellow: +1, then a team kill (-1) on node 3,
        # which then goes offline across an MC restart; +1, +1 reaches the cap. A replay that cannot
        # attribute node 3's facts sees the cap one kill EARLIER and re-scores the match without it.
        {"name": "kill", "params": {"victim": 0, "shooter": 1}},
        {"name": "team_kill", "params": {"victim": 3, "shooter": 1}},
        {"name": "drop", "params": {"node": 3}},
        {"name": "mc_restart", "params": {}},
        {"name": "respawn", "params": {"node": 0}},
        {"name": "kill", "params": {"victim": 0, "shooter": 1}},
        {"name": "kill", "params": {"victim": 2, "shooter": 1}},
    ],
    ci_seeds=(1,),
))
