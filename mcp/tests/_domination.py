"""Shared Domination test helpers: a live Domination match on three control hills, and a phone's `own_change` fact.
Used by test_mc_domination and test_mc_score_pending (a test module must not import another: test_helpers_lint)."""
from _session import mk_session, mk_stored_session, online


def domination_live(mode, target, stored=False):
    s, net, clock, ps = mk_stored_session(2) if stored else mk_session(2)
    s.set_config({"mode": mode, "time_limit_s": 1800, "scoring": {"hold_target_s": target}})
    for i, p in enumerate(ps):
        online(s, net, clock, p, i)
    for nid in ("util-a", "util-b", "util-c"):
        net.simulate_utility_hello(nid)
        s.set_station(nid, {"kind": "control"})
    s.push_config(force=True)
    info = s.start(runway_s=1, force=True)
    clock["t"] = info["go_live_t"] + 5_000
    s.tick()
    assert s.phase == "live", s.phase
    return s, net, clock


_SEQ = {"n": 1000}


def own_fact(s, net, clock, node, hill, frm, own, at=None, mid=None):
    """A phone's `own_change` fact (Tony 2026-11-07: Domination is scored from the phones): the owner of `hill`'s advert
    went from `frm` to `own` at `at` (MC's clock; now by default)."""
    _SEQ["n"] += 1
    site = str(s.station_registry.stations[hill]["assigned"]["id"])
    at = clock["t"] if at is None else at
    recv = max(clock["t"], at)   # a fact reaches MC after the phone heard the step
    net.simulate_event(node, {"type": "own_change", "t": at, "match_id": mid or s._m().head["match_id"], "site": site,
                              "from_tid": frm, "owner_tid": own, "at_ms": at}, recv, seq=_SEQ["n"])
