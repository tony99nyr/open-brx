"""Shared Scorer fixtures (a four-player roster on fake nodes n0..n3).

Moved out of `test_mc_scoring.py` (A19) so `test_toxin_dot.py` does not import a test module.
"""
from brx_mcp.mc.scoring import Scorer


SCORER_T0 = 1_000_000


def death(sc, victim_node, victim, shooter_num, t, **kw):
    return sc.ingest(victim_node, {"type": "death", "t": t, "match_id": "m1", "node_id": victim_node, "player_id": victim,
                                   "shooter_num": shooter_num, "shooter_team": 1, **kw}, t)


def mk_scorer(mode="tdm", now=None, synced=True, tl=600):
    fb, feed = [], []
    ps = scoring_players(mode)
    sc = Scorer("m1", SCORER_T0, tl, mode, ps, scoring_teams(mode), {f"n{i}": f"p{i}" for i in range(4)},
                {f"n{i}": synced for i in range(4)}, on_feedback=lambda pid, b: fb.append((pid, b)),
                on_feed=feed.append, now_ms=(lambda: now if now is not None else SCORER_T0 + 2000))
    return sc, fb, feed


def scoring_players(mode="tdm"):
    team = (lambda i: "ffa") if mode == "ffa" else (lambda i: "blue" if i % 2 == 0 else "yellow")
    ps = {}
    for i, n in enumerate(["REAPER", "VIPER", "NOMAD", "GHOST"]):
        ps[f"p{i}"] = {"player_id": f"p{i}", "player_num": i + 1, "display": n, "team_id": team(i), "node_id": f"n{i}",
                       "gun_id": None, "loadout": {"weapons": []}, "voice": "male", "ready": True}
    return ps


def scoring_teams(mode="tdm"):
    if mode == "ffa":
        return [{"team_id": "ffa", "name": "FFA", "color": "#fff", "tid": 1}]
    return [{"team_id": "blue", "name": "B", "color": "#00f", "tid": 1}, {"team_id": "yellow", "name": "Y", "color": "#ff0", "tid": 2}]
