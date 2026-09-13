"""LOAD (2026-09-13) — announcing the game to the phones WITHOUT writing a gun, and the arm-time
validation that the split makes necessary.

Tony: "weapons have to go with the arm." The first cut of LOAD called the real config push, which
compiles a weapon head per player — and nobody has kitted at that point, so it wrote policy-DEFAULT
loadouts to every gun and re-pushed on every kit pick.

LOAD now sends `assign` (no frames, no head) and leaves `lobby_pushed` FALSE, so the LOBBY push is
still the only thing that ever configures a gun. That split means "the game is loaded" and "the guns
are configured" are two events instead of one, and the second is the arm — so `start()` has to verify
BOTH halves and say which is missing for whom.

Every check below is written the way the coordinator asked for: it proves the check fails when the
thing it checks is ABSENT, not merely when it is wrong. The `ALL GUNS ON THIS CONFIG (0/8)` defect of
the same day was exactly a predicate that was vacuously true being rendered as a claim.
"""
from test_mc_state import mk, online


def kinds_to(net, node_id=None):
    return [k for (nid, k, _b) in net.pushed if node_id is None or nid == node_id]


# ---------------------------------------------------------------- LOAD writes no gun
def test_load_game_announces_the_game_and_writes_no_gun():
    s, net, clock, ps = mk(2)
    for i, p in enumerate(ps):
        online(s, net, clock, p, i)
    net.pushed.clear()
    r = s.load_game()

    assert r["ok"] and r["sent"] == 2 and r["total"] == 2
    # the announcement is an `assign` — the kind that carries a game and no head
    assert kinds_to(net, "node0") == ["assign"], kinds_to(net, "node0")
    # ...and NOT a `config`. `envelope.REQUIRED["config"]` makes `frames` mandatory, so there is no
    # such thing as a frameless config on this wire: a `config` here would mean a head was written.
    assert "config" not in kinds_to(net), kinds_to(net)
    # nothing was compiled for anybody
    assert s.bundles == {}, "LOAD must not compile a weapon head — nobody has kitted yet"
    # and the announcement really carries the game the phone's briefing renders
    body = next(b for (_n, k, b) in net.pushed if k == "assign")
    for key in ("mode", "health", "respawn", "environment", "night", "loadout_line"):
        assert key in body["game"], f"the announcement must carry {key}: {sorted(body['game'])}"


def test_load_game_does_not_make_the_lobby_pushed():
    """The whole point of the split: LOAD must satisfy NONE of the push's guarantees."""
    s, net, clock, ps = mk(2)
    for i, p in enumerate(ps):
        online(s, net, clock, p, i)
    s.load_game()
    assert s.lobby_pushed is False
    assert s.game_loaded is True
    # `start()` still refuses for the original reason — a loaded game is not a configured gun
    try:
        s.start()
        raise AssertionError("start() accepted a game that was only ANNOUNCED")
    except ValueError as e:
        assert "push config first" in str(e), e


def test_load_game_counts_delivery_and_never_invents_it():
    """`sent` is DELIVERY — a socket took the frame. A player with no phone bound is never counted."""
    s, net, clock, ps = mk(2)
    online(s, net, clock, ps[0], 0)          # only ONE phone is here
    r = s.load_game()
    assert (r["sent"], r["total"]) == (1, 2), r
    assert s.game_sent_n() == 1
    # …and the count is per CONFIG: an edit that re-announces re-stamps it, and a config nobody has
    # been told about counts nobody.
    s.game_sent = {}
    assert s.game_sent_n() == 0


# ---------------------------------------------------------------- SAVE AND LOAD, both paths
def test_save_and_load_re_announces_the_game_to_the_phones():
    s, net, clock, ps = mk(2)
    for i, p in enumerate(ps):
        online(s, net, clock, p, i)
    s.load_game()
    first = s.config["config_id"]
    net.pushed.clear()

    s.set_config({"night": True})
    assert s.config["config_id"] != first, "control: the edit really produced a new config"
    assert "assign" in kinds_to(net), "an edit to a LOADED game re-announces it"
    assert s.game_cfg == s.config["config_id"], "and the announcement is stamped with the NEW config"
    assert s.lobby_pushed is False, "…without quietly configuring a gun"
    assert s.bundles == {}


def test_save_and_load_also_repushes_the_frames_once_the_lobby_has_been_pushed():
    """The other path: after a REAL push, an edit must re-announce AND re-push, or the guns drift."""
    s, net, clock, ps = mk(2)
    for i, p in enumerate(ps):
        online(s, net, clock, p, i)
    s.load_game()
    s.push_config()
    for i in range(2):
        net.simulate_node_message(f"node{i}", "ack_config",
                                  {"config_id": s.config["config_id"], "ok": True, "gun_echo": "$LCD"}, clock["t"])
    assert s.all_acked(), "control: everybody acked the real push"
    net.pushed.clear()

    s.set_config({"night": True})
    assert "assign" in kinds_to(net), "the phones are told about the new game"
    assert "config" in kinds_to(net), "and the guns are re-pushed, or they keep the old head"
    assert s.lobby_pushed is True, "a re-push stays pushed (B1/B3)"
    assert s.acks == {}, "the acks clear and re-collect — the operator watches the count move"


# ---------------------------------------------------------------- the arm gate: ABSENCE
def test_start_refuses_a_rostered_player_whose_gun_never_took_this_config():
    """THE hole LOAD makes reachable, and the one this gate exists for.

    `all_acked()` asks its question only of players WITH A NODE BOUND, so a rostered player whose
    phone never arrived was skipped entirely: the predicate was vacuously true and the whistle blew.
    """
    s, net, clock, ps = mk(2)
    online(s, net, clock, ps[0], 0)          # player 1's phone never arrives
    s.load_game()
    s.push_config(force=True)                # forced past the readiness board, as the operator can
    net.simulate_node_message("node0", "ack_config",
                              {"config_id": s.config["config_id"], "ok": True, "gun_echo": "$LCD"}, clock["t"])

    assert s.all_acked() is True, "CONTROL: the old predicate really is vacuously true here"
    try:
        s.start()
        raise AssertionError("start() blew the whistle for a gun that never took this config")
    except ValueError as e:
        msg = str(e)
        assert ps[1]["display"] in msg, f"the refusal must NAME who: {msg}"
        assert "no phone bound" in msg, msg


def test_that_refusal_is_forceable_and_says_so_by_letting_a_forced_start_through():
    """A late phone HOT JOINS on its bind, so this is a judgement the operator may accept — what must
    not happen is starting without being told."""
    s, net, clock, ps = mk(2)
    online(s, net, clock, ps[0], 0)
    s.load_game()
    s.push_config(force=True)
    net.simulate_node_message("node0", "ack_config",
                              {"config_id": s.config["config_id"], "ok": True, "gun_echo": "$LCD"}, clock["t"])
    assert s.start(force=True)["match_id"], "force is the operator saying they know"


def test_a_bound_gun_that_has_not_acked_is_named_differently_from_an_absent_one():
    """Two failures, two fixes: 'has not acked' is a gun that is here and silent; 'no phone bound' is
    a player who is not here at all. Collapsing them tells the operator to do the wrong thing."""
    s, net, clock, ps = mk(2)
    for i, p in enumerate(ps):
        online(s, net, clock, p, i)
    s.load_game()
    s.push_config()
    net.simulate_node_message("node0", "ack_config",
                              {"config_id": s.config["config_id"], "ok": True, "gun_echo": "$LCD"}, clock["t"])
    try:
        s.start()
        raise AssertionError("start() accepted a gun that never answered")
    except ValueError as e:
        msg = str(e)
        assert "not acked" in msg, msg
        assert ps[1]["display"] in msg, msg
        assert "no phone bound" not in msg, f"player 2 IS bound — do not send the operator hunting: {msg}"


# ---------------------------------------------------------------- the summary is honest
def test_sync_summary_is_not_satisfied_by_an_empty_roster():
    """A zero-of-zero must never read as in sync. This is the `ALL GUNS (0/8)` lesson as a test."""
    s, _net, _clock, _ps = mk(0)
    tot = s.sync_summary()["totals"]
    assert tot["rostered"] == 0
    assert tot["in_sync"] is False, "nothing was checked, so nothing may read as satisfied"


def test_sync_summary_reports_absence_as_absence():
    s, net, clock, ps = mk(2)
    online(s, net, clock, ps[0], 0)
    s.load_game()
    rows = {r["display"]: r for r in s.sync_summary()["rows"]}
    here, away = rows[ps[0]["display"]], rows[ps[1]["display"]]

    assert here["phone_game"] is True and here["bound"] is True
    # the phone that is not here was told nothing, and nothing was compiled or acked for it
    assert away["phone_game"] is False and away["bound"] is False
    assert away["gun_sent"] is False and away["gun_acked"] is False
    # ...and NOBODY's gun has been configured yet: LOAD writes no head
    assert all(r["gun_sent"] is False for r in rows.values())
    assert s.sync_summary()["totals"]["in_sync"] is False
    assert ps[1]["display"] in s.sync_summary()["unconfigured"]


def test_sync_summary_totals_agree_with_its_own_rows_and_go_green_only_when_everything_is_true():
    s, net, clock, ps = mk(2)
    for i, p in enumerate(ps):
        online(s, net, clock, p, i)
    s.load_game()
    s.push_config()
    for i in range(2):
        net.simulate_node_message(f"node{i}", "ack_config",
                                  {"config_id": s.config["config_id"], "ok": True, "gun_echo": "$LCD"}, clock["t"])
    sm = s.sync_summary()
    rows, tot = sm["rows"], sm["totals"]
    assert tot["rostered"] == len(rows) == 2
    assert tot["phone_game"] == sum(1 for r in rows if r["phone_game"]) == 2
    assert tot["gun_sent"] == sum(1 for r in rows if r["gun_sent"]) == 2
    assert tot["gun_acked"] == sum(1 for r in rows if r["gun_acked"]) == 2
    assert tot["in_sync"] is True and sm["unconfigured"] == []
    # and the whistle now goes
    assert s.start()["match_id"]


def test_sync_summary_does_not_count_an_ack_for_an_older_config():
    """A36 again, in the summary: the gun answered — for the game before this one."""
    s, net, clock, ps = mk(2)
    for i, p in enumerate(ps):
        online(s, net, clock, p, i)
    s.push_config()
    for i in range(2):
        net.simulate_node_message(f"node{i}", "ack_config",
                                  {"config_id": s.config["config_id"], "ok": True, "gun_echo": "$LCD"}, clock["t"])
    assert s.sync_summary()["totals"]["gun_acked"] == 2, "control: acked for the config they hold"

    s.set_config({"night": True})            # a new config_id; the old acks are retired
    tot = s.sync_summary()["totals"]
    assert tot["gun_acked"] == 0, "an ack for an older head proves nothing about this one"
    assert tot["in_sync"] is False
