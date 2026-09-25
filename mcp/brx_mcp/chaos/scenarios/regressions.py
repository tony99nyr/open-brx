"""Regression scenarios: the minimal action scripts of bugs chaos testing found. Each one ran red
before its fix and runs in CI from then on (its `ci_seeds`). The seed does not matter to a script;
it only names the run.

Add one per bug: shrink the failing trace (`python -m brx_mcp.chaos replay <trace> --shrink`),
paste its actions here, and name the FOLLOWUPS row or the commit in `doc`.
"""
from __future__ import annotations

from ..invariants import credited_enemy_kills, kill_feedback
from ..registry import InvariantError, Scenario, scenario
from ..world import World


def every_kill_cued(world: World) -> None:
    """The other direction of `kill_feedback_matches_credit`, for a script with none of MC's designed
    skips (no drop, no clock jump, every node synced and connected when its kill lands): every credited
    enemy kill got exactly one kill cue, and the unrostered shooter's death got none."""
    sc = world.session.scorer
    if sc is None:
        raise InvariantError("every_kill_cued", "the match has no scorer")
    want = credited_enemy_kills(world, sc)
    got = kill_feedback(world)
    if got != want:
        raise InvariantError("every_kill_cued", f"cues {dict(got)} != credited enemy kills {dict(want)}")
    unknown = [k for k in sc.kills if k["killer"] is None]
    if len(unknown) != 1:
        raise InvariantError("every_kill_cued", f"want one death with no credited killer, MC holds {unknown}")

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
    name="game-byte-across-restarts", mode="tdm", nodes=4,
    doc="Hotfix 0.4.10: player phones and MC-armed stations scoped presence by different game bytes. "
        "`game_byte_matches_stations` checks every step; this script walks a restart, a crash and a hot join.",
    script=[
        {"name": "kill", "params": {"victim": 1, "shooter": 2}},
        {"name": "mc_restart", "params": {}},
        {"name": "late_join", "params": {}},
        {"name": "drop", "params": {"node": 1}},
        {"name": "mc_crash", "params": {}},
        {"name": "reconnect", "params": {"node": 1}},
        {"name": "end", "params": {}},
    ],
    ci_seeds=(1,),
))

scenario(Scenario(
    name="clock-back-assist", mode="tdm", nodes=4,
    doc="Chaos 2026-09-24 (F330): after a backward clock jump, a hit from the victim's NEXT life sorts before "
        "its death, and a replay credited an assist the live board never gave. The assist now skips a hit "
        "whose seq on the victim's node is after the death's.",
    script=[
        # nodes 0 and 2 are blue, 1 and 3 are yellow
        {"name": "kill", "params": {"victim": 0, "shooter": 1}},
        {"name": "respawn", "params": {"node": 0}},
        {"name": "clock_jump", "params": {"node": 0, "delta_ms": -3000}},
        {"name": "hit", "params": {"victim": 0, "shooter": 3, "dmg": 5, "words": 1}},
        {"name": "mc_restart", "params": {}},
        {"name": "end", "params": {}},
    ],
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

scenario(Scenario(
    name="unknown-shooter-no-kill-cue", mode="tdm", nodes=4,
    doc="Field 2026-09-24 (brx1, brx4): a player died to `shooter_num` 11 in a match with no player 11. MC must "
        "credit nobody and cue nobody, and every other kill still gets its one cue, through a resend of the "
        "kill, a team kill and an MC restart.",
    script=[
        # nodes 0 and 2 are blue, 1 and 3 are yellow; the roster holds player numbers 1 to 4 only
        {"name": "kill", "params": {"victim": 0, "shooter": 1}},
        {"name": "unknown_shooter_death", "params": {"victim": 2, "shooter_num": 11}},
        {"name": "resend_death", "params": {"node": 0, "as_batch": False}},
        {"name": "team_kill", "params": {"victim": 3, "shooter": 1}},
        {"name": "mc_restart", "params": {}},
        {"name": "resend_death", "params": {"node": 0, "as_batch": True}},
        {"name": "respawn", "params": {"node": 0}},
        {"name": "respawn", "params": {"node": 2}},
        {"name": "kill", "params": {"victim": 1, "shooter": 2}},
        {"name": "kill", "params": {"victim": 0, "shooter": 1}},
        {"name": "end", "params": {}},
    ],
    checks=(every_kill_cued,),
    ci_seeds=(1,),
))

scenario(Scenario(
    name="frag-cap-team-kill-live", mode="tdm", nodes=12,
    doc="F356 (chaos 2026-09-24, tdm-frag-race seed 10057): node 10 drops, and its team kill (stamped "
        "before the capping kill) flushes after the whistle. MC credited its -1 because its t is inside "
        "the window, so the match ended on the frag cap with a top score one BELOW it. Fixed: a late "
        "team kill that would take the capping side below the cap parks as an after-the-whistle fact.",
    config={"scoring": {"frag_limit": 5, "win_by": "kills"}},
    script=[
        {"name": "kill", "params": {"victim": 3, "shooter": 10}},
        {"name": "drop", "params": {"node": 10}},
        {"name": "kill", "params": {"victim": 5, "shooter": 2}},
        {"name": "kill", "params": {"victim": 9, "shooter": 8}},
        {"name": "team_kill", "params": {"victim": 10, "shooter": 4}},
        {"name": "kill", "params": {"victim": 1, "shooter": 2}},
        {"name": "kill", "params": {"victim": 11, "shooter": 4}},
    ],
    ci_seeds=(1,),
))

scenario(Scenario(
    name="frag-cap-recap-cue-then-parked", mode="tdm", nodes=12,
    doc="F357 (chaos 2026-09-24, tdm-frag-race seeds 10095 and 20162): the frag cap ends the match, then two "
        "dropped nodes flush. Node 6's batch lands first: its pre-whistle kill is credited and CUED in "
        "RECAP (fresh, well inside FEEDBACK_MAX_AGE_MS). Node 7's batch then moves the cap end earlier "
        "and parks that kill. The cue cannot be taken back, but `credited_enemy_kills` exempts only kills "
        "MC held at the whistle (`world.end_delivered`). The runner's aftermath reconnects every dropped "
        "node at once, so the flush order was a socket race: this script fixes it (7 then 6 passes). "
        "Fixed: MC sends no kill confirm once the match has ended, so node 6's late kill scores uncued.",
    config={"scoring": {"frag_limit": 5, "win_by": "kills"}},
    script=[
        {"name": "drop", "params": {"node": 7}},
        {"name": "trade", "params": {"a": 10, "b": 3}},
        {"name": "respawn", "params": {"node": 3}},
        {"name": "kill", "params": {"victim": 5, "shooter": 6}},
        {"name": "drop", "params": {"node": 6}},
        {"name": "kill", "params": {"victim": 7, "shooter": 4}},
        {"name": "kill", "params": {"victim": 9, "shooter": 6}},
        {"name": "kill", "params": {"victim": 1, "shooter": 0}},
        {"name": "respawn", "params": {"node": 9}},
        {"name": "kill", "params": {"victim": 6, "shooter": 9}},
        {"name": "respawn", "params": {"node": 5}},
        {"name": "respawn", "params": {"node": 11}},
        {"name": "kill", "params": {"victim": 5, "shooter": 10}},
        {"name": "reconnect", "params": {"node": 6}},
        {"name": "reconnect", "params": {"node": 7}},
    ],
    ci_seeds=(1,),
))

scenario(Scenario(
    name="resume-transient-cap", mode="tdm", nodes=10,
    doc="F363 (chaos 2026-09-25, frag-cap-team-kills seed 3009): the resume replay runs in `t` order. A clock "
        "jump lets that replay pass the frag cap for a moment before a team kill takes it back, and the live "
        "board, scored in arrival order, never reached the cap. The resume ended the match on the cap anyway, "
        "at 4-3 against a cap of 5. Fixed: a resume forgets a cap the arrival-order check does not reach.",
    config={"scoring": {"frag_limit": 5, "win_by": "kills"}},
    script=[
        {"name": "kill", "params": {"victim": 5, "shooter": 0}},
        {"name": "trade", "params": {"a": 4, "b": 9}},
        {"name": "drop", "params": {"node": 4}},
        {"name": "clock_jump", "params": {"node": 7, "delta_ms": -240000}},
        {"name": "trade", "params": {"a": 2, "b": 3}},
        {"name": "hit", "params": {"victim": 1, "shooter": 7, "dmg": 25, "words": 1}},
        {"name": "respawn", "params": {"node": 0}},
        {"name": "respawn", "params": {"node": 5}},
        {"name": "kill", "params": {"victim": 5, "shooter": 4}},
        {"name": "team_kill", "params": {"victim": 0, "shooter": 4}},
        {"name": "kill", "params": {"victim": 7, "shooter": 4}},
        {"name": "drop", "params": {"node": 5}},
        {"name": "hit", "params": {"victim": 6, "shooter": 4, "dmg": 25, "words": 1}},
        {"name": "mc_restart", "params": {}},
        {"name": "end", "params": {}},
    ],
    ci_seeds=(1,),
))

scenario(Scenario(
    name="host-end-then-late-cap", mode="tdm", nodes=10,
    doc="F362 (l) (chaos 2026-09-25, frag-cap-team-kills seeds 14 and 20): the operator ENDs the match below "
        "the cap, then the dropped nodes flush kills stamped before the END. They are inside the scored window, "
        "so the board rises to the cap. The operator's END stands: a late flush never re-labels it as a "
        "frag-cap win (`frag_cap_ends_match` judges a host or time end on the facts MC held at the end).",
    config={"scoring": {"frag_limit": 5, "win_by": "kills"}},
    script=[
        {"name": "kill", "params": {"victim": 6, "shooter": 7}},
        {"name": "trade", "params": {"a": 2, "b": 9}},
        {"name": "kill", "params": {"victim": 3, "shooter": 4}},
        {"name": "kill", "params": {"victim": 5, "shooter": 8}},
        {"name": "team_kill", "params": {"victim": 4, "shooter": 8}},
        {"name": "kill", "params": {"victim": 8, "shooter": 7}},
        {"name": "drop", "params": {"node": 2}},
        {"name": "hit", "params": {"victim": 0, "shooter": 7, "dmg": 40, "words": 1}},
        {"name": "drop", "params": {"node": 0}},
        {"name": "clock_jump", "params": {"node": 4, "delta_ms": -240000}},
        {"name": "trade", "params": {"a": 7, "b": 0}},
        {"name": "drop", "params": {"node": 5}},
        {"name": "respawn", "params": {"node": 4}},
        {"name": "trade", "params": {"a": 4, "b": 9}},
        {"name": "respawn", "params": {"node": 6}},
        {"name": "clock_jump", "params": {"node": 6, "delta_ms": 2000}},
        {"name": "respawn", "params": {"node": 6}},
        {"name": "mc_restart", "params": {}},
        {"name": "end", "params": {}},
    ],
    ci_seeds=(1,),
))

scenario(Scenario(
    name="late-kill-after-host-end-no-cue", mode="tdm", nodes=4,
    doc="F357 (Tony 2026-09-25): node 1 is out of coverage when it dies, and flushes the kill just after the "
        "operator's END. The kill is stamped before the END, so it counts, but MC sends no kill confirm for it "
        "(`no_kill_cue_after_end`). A team-only kill (A65) before the END scores for blue and for no player "
        "(`team_score_equals_facts`).",
    script=[
        # nodes 0 and 2 are blue, 1 and 3 are yellow
        {"name": "team_credit_kill", "params": {"victim": 3, "shooter": 0}},
        {"name": "drop", "params": {"node": 1}},
        {"name": "kill", "params": {"victim": 1, "shooter": 2}},
        {"name": "end", "params": {}},
    ],
    ci_seeds=(1,),
))
