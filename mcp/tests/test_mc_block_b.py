"""Block B of the 2026-09-11 game-test sheet — the five confirmed MC-server defects.

Every test here reproduces a symptom Tony saw on the field with two real taggers, and each one FAILS
against the code as it was that night:

* **B1 / F124** the frag limit was configured, announced at cap-1 and enforced by nobody — ROCCO
  finished a cap-7 match on 9 kills with the phase still `live`.
* **B2 / F125** END reported "reached 2 of 2 nodes" and the match ran on to its own time limit.
* **B3 / F116** the score row carried an empty `medals` list and the CURRENT streak (0 for whoever
  died last), so a 9-kill match read "streak 0 medals []".
* **B4 / F118** the MC feed printed the HUD's second-person copy and a raw player id:
  `Your Team Takes The Lead (002803e7)` — in an FFA match, where there are no teams.
* **B5 / F119** ACC swung wildly because hits arrive per event and shots on a ~2 s heartbeat.
"""
from brx_mcp.mc import presentation as _pres
from brx_mcp.mc.fakes import FakeArmory, FakeCompiler, FakeNet, demo_armory
from brx_mcp.mc import scoring as S
from brx_mcp.mc.scoring import Scorer
from brx_mcp.mc.state import Session
from brx_mcp.mc.types import ACC_MIN_SHOTS

T0 = 5_000_000


# --------------------------------------------------------------------------------------------------
# Session harness: a real Session on fakes, driven to LIVE with N players on the field.
# --------------------------------------------------------------------------------------------------
class DeafNet(FakeNet):
    """A FakeNet where named nodes are out of coverage: `push` returns False, as the real net does."""

    def __init__(self, deaf=()):
        super().__init__()
        self.deaf = set(deaf)

    def push(self, node_id, kind, body):
        super().push(node_id, kind, body)
        return False if node_id in self.deaf else None


def mk(n_players=2, mode="tdm", cfg=None, net=None):
    clock = {"t": T0}
    net = net or FakeNet()
    s = Session(FakeCompiler(), net, FakeArmory(demo_armory()), now_ms=lambda: clock["t"])
    s.set_config({"mode": mode, "time_limit_s": 600, **(cfg or {})})
    ps = [s.add_player(f"OP{i}", gun_id=f"GUN-{chr(65 + i)}") for i in range(n_players)]
    return s, net, clock, ps


def online(s, net, clock, p, i):
    tail = demo_armory()[i]["ble"]["tail"]
    net.simulate_hello(f"node{i}", f"GUN-{chr(65 + i)}-{tail}")
    net.simulate_status(f"node{i}", {"player_id": p["player_id"], "hp": 45, "armor": 70, "ammo": 36, "alive": True,
                                     "shots": 0, "battery": 80, "fw": "v4.32", "arm_state": "kitted", "synced": True,
                                     "preflight": {"ssid_ok": True, "mc_reachable": True, "phone_batt": 90,
                                                   "screen_on": True, "foreground": True, "gun_linked": True}}, clock["t"])


def go_live(n_players=2, mode="tdm", cfg=None, net=None):
    s, net, clock, ps = mk(n_players, mode, cfg, net)
    for i, p in enumerate(ps):
        online(s, net, clock, p, i)
    s.push_config()
    for i in range(n_players):
        net.simulate_node_message(f"node{i}", "ack_config", {"config_id": s.config["config_id"], "ok": True,
                                                             "gun_echo": "$LCD"}, clock["t"])
    info = s.start(runway_s=10)
    clock["t"] = info["go_live_t"] + 1
    s.tick()
    assert s.phase == "live"
    heartbeat(s, net, clock, ps)
    return s, net, clock, ps, info


def heartbeat(s, net, clock, ps, shots=0):
    """A11.5: MC withholds a global-state alert while any node is stale, so a live-feed test has to
    keep the board fresh or it measures the WITHHELD path instead of the one it means to."""
    for i, p in enumerate(ps):
        net.simulate_status(f"node{i}", {"player_id": p["player_id"], "shots": shots, "alive": True,
                                         "synced": True, "pending": 0}, clock["t"])
    assert s.mc_confidence()["confident"], s.mc_confidence()


def kill(s, net, clock, ps, killer_i, victim_i, info, seq, dt=1000):
    """`killer` shoots `victim`, one second later than the last fact."""
    clock["t"] += dt
    net.simulate_event(f"node{victim_i}", {"type": "death", "t": clock["t"], "match_id": info["match_id"],
                                           "player_id": ps[victim_i]["player_id"],
                                           "shooter_num": ps[killer_i]["player_num"], "shooter_team": 1},
                       clock["t"], seq=seq)


# --------------------------------------------------------------------------------------------------
# B1 · F124 — the frag limit ends the match
# --------------------------------------------------------------------------------------------------
def test_the_frag_limit_ends_an_ffa_match_on_the_leader_s_kills():
    """*"the player got the 7th kill after the 'next kill wins' audio and the game didnt end."*

    In FFA the cap is a PER-PLAYER count (`scoring.py` scores per player there), so the match ends the
    moment anyone reaches it — not when the roster's total does.
    """
    s, net, clock, ps, info = go_live(2, "ffa", {"scoring": {"frag_limit": 3, "win_by": "kills"}})
    for n in range(2):
        kill(s, net, clock, ps, 0, 1, info, seq=n + 1)
    assert s.phase == "live", "two kills of three is not the cap"
    kill(s, net, clock, ps, 0, 1, info, seq=3)
    assert s.phase == "recap", "the third kill reached the cap and the match must be over"
    r = s.recap()
    assert r["winner"]["player_id"] == ps[0]["player_id"]
    assert max(row["kills"] for row in r["rows"]) == 3


def test_the_cap_end_goes_down_the_same_path_a_manual_end_does():
    """`control('end')` pushes `control{end}`, freezes the scorer and calls `_finish()` — so victory,
    recap and the stored match all happen. A cap end must be indistinguishable from it: the cap is
    display-only on the HUD and the gun never reads `frag_limit`, so this push IS what stops the field.
    """
    s, net, clock, ps, info = go_live(2, "ffa", {"scoring": {"frag_limit": 1, "win_by": "kills"}})
    kill(s, net, clock, ps, 0, 1, info, seq=1)
    assert s.phase == "recap" and s.start_info is None
    ends = [p for p in net.pushes("control") if p[2].get("cmd") == "end"]
    assert {p[0] for p in ends} == {"node0", "node1"}, f"every node is told, in coverage or not: {ends}"
    assert [p for p in net.pushes("feedback") if p[2].get("kind") == "victory"], "winners still get the sting"
    assert any("FRAG LIMIT 1 REACHED" in e["text"] for e in s.feed), s.feed[:4]
    # A6.1: the freeze is at the winning kill, so a later fact is recorded and not scored
    clock["t"] += 5000
    net.simulate_event("node0", {"type": "death", "t": clock["t"], "match_id": info["match_id"],
                                 "player_id": ps[0]["player_id"], "shooter_num": ps[1]["player_num"]},
                       clock["t"], seq=9)
    assert s.recap()["post_end"] == 1 and s.recap()["rows"][0]["kills"] == 1


def test_in_a_team_mode_the_cap_is_the_TEAM_score_not_one_player_s():
    s, net, clock, ps, info = go_live(4, "tdm", {"scoring": {"frag_limit": 2, "win_by": "kills"}})
    assert ps[0]["team_id"] == ps[2]["team_id"] != ps[1]["team_id"], "fixture: even players share a team"
    kill(s, net, clock, ps, 0, 1, info, seq=1)
    assert s.phase == "live", "one kill of two"
    kill(s, net, clock, ps, 2, 3, info, seq=2)      # a DIFFERENT player on the same team
    assert s.phase == "recap", "the team reached the cap even though neither player did"
    assert s.recap()["winner"]["team_id"] == ps[0]["team_id"]


def test_the_cap_never_ends_a_match_that_is_not_won_on_kills():
    """A `win_by` of objective or survival is settled by possession or by the last player standing. A
    kill cap means nothing there and MC must not invent an ending from one.
    """
    s, net, clock, ps, info = go_live(2, "ffa", {"scoring": {"frag_limit": 1, "win_by": "objective"}})
    kill(s, net, clock, ps, 0, 1, info, seq=1)
    assert s.phase == "live"
    assert not [p for p in net.pushes("control") if p[2].get("cmd") == "end"]


def test_next_kill_wins_still_fires_at_cap_minus_one_and_the_cap_fires_once():
    """The announcement and the enforcement are separate: cap-1 warns, cap ends, neither repeats."""
    alerts, limits = [], []
    ps = {f"p{i}": {"player_id": f"p{i}", "player_num": i + 1, "display": n, "team_id": "ffa"}
          for i, n in enumerate(["ROCCO", "TONY"])}
    sc = Scorer("m1", T0, 600, "ffa", ps, [{"team_id": "ffa", "name": "FFA", "color": "#fff", "tid": 1}],
                {"n0": "p0", "n1": "p1"}, {"n0": True, "n1": True}, now_ms=lambda: T0 + 1000,
                win_by="kills", frag_limit=2,
                on_alert=lambda k, s_, e: alerts.append(k), on_limit=limits.append)

    def death(t):
        sc.ingest("n1", {"type": "death", "t": t, "match_id": "m1", "player_id": "p1", "shooter_num": 1}, t)

    death(T0 + 100)
    assert alerts.count("next_kill_wins") == 1 and limits == []
    death(T0 + 200)
    assert limits == [T0 + 200] and sc.limit_reached_t == T0 + 200
    death(T0 + 300)                       # a straggling fact must not re-end the match
    assert limits == [T0 + 200]


# --------------------------------------------------------------------------------------------------
# B2 · F125 — the END count means "ended", not "pushed"
# --------------------------------------------------------------------------------------------------
def test_end_with_no_scorer_ends_nothing_and_says_so():
    """The exact F125 scenario: `end` arrives while `self.scorer is None`.

    Measured against the pre-fix build, this returned `{'ok': True, 'reached': 2, 'nodes': 2}` — the
    "END REACHED 2 OF 2 NODE(S)" the operator read while the node ran on ~18 s and ended on its own
    time limit (`write end (time-expiry)` in the Android's log).

    ⚠ The sheet says that branch "NEVER sets phase". It does: the old code fell through to
    recall/panic, which sets `phase = "kit"`. So the second half of the defect is that an END press
    silently performed a recall-shaped transition and wrote no recap. An END that ends nothing now
    moves no phase at all and names RECALL as the way out.
    """
    s, net, clock, ps, info = go_live(2)
    s.scorer = None                                   # however MC lost it, this is the state END met
    r = s.control("end")
    assert r["ended"] is False and r["ok"] is False and r["reached"] == 0, r
    assert r["nodes"] == 2 and r["error"], r
    assert s.phase == "live", "an END that ended nothing must not silently look like a recall either"
    assert r["pushed"] == 2, "the nodes are still told to stop — one of them may be running the match"
    assert any(e["tag"] == "WITHHELD" and "END DID NOTHING" in e["text"] for e in s.feed), s.feed[:3]


def test_a_real_end_reports_only_the_nodes_it_reached():
    s, net, clock, ps, info = go_live(2, net=DeafNet(deaf={"node1"}))
    r = s.control("end")
    assert r["ended"] is True and s.phase == "recap"
    assert (r["reached"], r["nodes"]) == (1, 2), f"node1 was out of coverage: {r}"


def test_a_clean_end_reports_every_node():
    s, net, clock, ps, info = go_live(2)
    r = s.control("end")
    assert (r["ok"], r["ended"], r["reached"], r["nodes"], r["phase"]) == (True, True, 2, 2, "recap")


# --------------------------------------------------------------------------------------------------
# B3 · F116 — medals and the right streak reach the score row
# --------------------------------------------------------------------------------------------------
def _duel(cap=None):
    """A 1v1, the shape that produced `TONY … streak 0 medals []` with 9 kills on the board."""
    fb = []
    ps = {f"p{i}": {"player_id": f"p{i}", "player_num": i + 1, "display": n, "team_id": "ffa"}
          for i, n in enumerate(["ROCCO", "TONY"])}
    return Scorer("m1", T0, 600, "ffa", ps, [{"team_id": "ffa", "name": "FFA", "color": "#fff", "tid": 1}],
                  {"n0": "p0", "n1": "p1"}, {"n0": True, "n1": True}, now_ms=lambda: T0 + 1000,
                  win_by="kills", frag_limit=cap, on_feedback=lambda pid, b: fb.append(b)), fb


def _die(sc, node, pid, shooter_num, t):
    sc.ingest(node, {"type": "death", "t": t, "match_id": "m1", "player_id": pid, "shooter_num": shooter_num}, t)


def test_the_row_carries_best_streak_multi_best_and_first_blood():
    """All three were computed at event time and exposed by NONE of them — `streak` is the CURRENT
    streak, which is 0 for whoever died last, hence "9 kills, streak 0"."""
    sc, _fb = _duel()
    for i in range(5):                                  # ROCCO takes five straight
        _die(sc, "n1", "p1", 1, T0 + 1000 + i * 100)
    _die(sc, "n0", "p0", 2, T0 + 9000)                  # then dies: current streak back to 0
    row = {r["player_id"]: r for r in sc.rows()}["p0"]
    assert row["streak"] == 0, "the old field keeps its old meaning (UI compatibility)"
    assert row["best_streak"] == 5 and row["multi_best"] == 5 and row["first_blood"] is True
    assert {r["player_id"]: r for r in sc.rows()}["p1"]["first_blood"] is False


def test_a_1v1_shows_medals_even_though_honors_needs_three_players():
    """`honors()` hard-returns [] below three scored players (a 1-player recap once crowned itself
    MVP) — so in ANY 1v1 the medals column was empty all match, while the feed showed FIRST BLOOD and
    STREAK ×3 from the very same per-kill computation."""
    sc, fb = _duel()
    for i in range(5):
        _die(sc, "n1", "p1", 1, T0 + 1000 + i * 100)
    assert sc.honors() == [], "honors still need an audience — that rule is unchanged"
    assert fb[0]["medals"] == ["first_blood"], "the medals were always computed; they were discarded"
    medals = {r["player_id"]: r["medals"] for r in sc.rows()}
    assert medals["p0"] == ["FIRST BLOOD", "DOUBLE KILL", "TRIPLE KILL", "KILLTACULAR ×2", "KILLING SPREE"], medals
    assert medals["p1"] == []


def test_honors_and_the_per_kill_medals_do_not_print_first_blood_twice():
    ps = {f"p{i}": {"player_id": f"p{i}", "player_num": i + 1, "display": n, "team_id": "ffa"}
          for i, n in enumerate(["ROCCO", "TONY", "VIPER"])}
    sc = Scorer("m1", T0, 600, "ffa", ps, [{"team_id": "ffa", "name": "FFA", "color": "#fff", "tid": 1}],
                {f"n{i}": f"p{i}" for i in range(3)}, {f"n{i}": True for i in range(3)},
                now_ms=lambda: T0 + 1000, win_by="kills")
    _die(sc, "n1", "p1", 1, T0 + 1000)
    _die(sc, "n2", "p2", 1, T0 + 1100)
    row = {r["player_id"]: r for r in sc.rows()}["p0"]
    assert row["medals"].count("FIRST BLOOD") == 1, row["medals"]
    # …and not the multi-kill twice either (polish 2026-09-12): the honor is called MULTIKILL and the
    # thing it is awarded for is called DOUBLE KILL, so the row printed one event as two chips.
    assert "MVP" in row["medals"] and "MULTIKILL" in row["medals"], row["medals"]
    assert not [m for m in row["medals"] if m.split(" ×")[0] in S.HONOR_ALIAS], row["medals"]
    assert row["medals"].index("MVP") < row["medals"].index("MULTIKILL"), "the whole-match verdicts lead"
    # CONTROL: under three players there are no honors at all, so the earned chip is the only one and stands
    solo, _fb = _duel()
    _die(solo, "n1", "p1", 1, T0 + 1000)
    _die(solo, "n1", "p1", 1, T0 + 1100)
    assert "DOUBLE KILL" in {r["player_id"]: r for r in solo.rows()}["p0"]["medals"]


def test_best_streak_reaches_the_csv_and_an_archived_row_without_it_still_exports():
    from brx_mcp.mc.scoring import rows_csv
    sc, _fb = _duel()
    for i in range(3):
        _die(sc, "n1", "p1", 1, T0 + 1000 + i * 100)
    header, first = sc.csv().splitlines()[:2]
    assert header.split(",")[7:9] == ["streak", "best_streak"]
    assert first.split(",")[8] == "3"
    assert rows_csv([{"display": "OLD", "kills": 1}]).splitlines()[1].split(",")[8] == "0"


# --------------------------------------------------------------------------------------------------
# B4 · F118 — the MC feed is third person, mode-aware and resolves ids
# --------------------------------------------------------------------------------------------------
def test_the_operator_copy_is_third_person_and_the_hud_copy_is_untouched():
    assert _pres.TEXT["lead_taken"] == "YOUR TEAM TAKES THE LEAD", "the player's own phone is right as it is"
    assert _pres.feed_text("lead_taken", "ROCCO") == "ROCCO takes the lead"
    assert _pres.feed_text("lead_lost", "RED") == "RED loses the lead"
    assert _pres.feed_text("last_survivor", "TONY") == "TONY is the last one standing"
    assert _pres.feed_text("next_kill_wins") == "NEXT KILL WINS", "a line with no subject is already fine"
    assert _pres.feed_text("point_captured") == "POINT CAPTURED"
    assert _pres.feed_text("lead_taken") == "YOUR TEAM TAKES THE LEAD", "no subject: never print the word None"
    assert "YOUR" not in " ".join(_pres.MC_TEXT.values()).upper(), "no second person on the host console"


def test_the_ffa_feed_names_the_player_who_took_the_lead_not_your_team_and_not_an_id():
    """The F118 line verbatim: `{"text": "Your Team Takes The Lead (002803e7)", "tag": "ALERT"}` — in
    an FFA match, so `leader` was a PLAYER id and there were no teams at all."""
    s, net, clock, ps, info = go_live(2, "ffa", {"scoring": {"win_by": "kills"}})
    kill(s, net, clock, ps, 0, 1, info, seq=1)
    lead = [e for e in s.feed if e["kind"] == "alert" and "lead" in e["text"].lower()]
    assert lead, [e["text"] for e in s.feed]
    assert lead[0]["text"] == f"{ps[0]['display']} takes the lead", lead[0]
    assert ps[0]["player_id"] not in lead[0]["text"], "a raw id never reaches the console"


def test_a_team_mode_feed_names_the_TEAM():
    s, net, clock, ps, info = go_live(2, "tdm", {"scoring": {"win_by": "kills"}})
    kill(s, net, clock, ps, 0, 1, info, seq=1)
    lead = [e for e in s.feed if e["kind"] == "alert" and "lead" in e["text"].lower()]
    team = s.team(ps[0]["team_id"])
    assert lead and lead[0]["text"] == f"{str(team['name']).replace(' TEAM', '')} takes the lead", lead


def test_an_unresolvable_subject_is_named_rather_than_dropped():
    """The id is still printed, but NEVER under the HUD's second-person line: falling back to
    `presentation.TEXT` put "YOUR TEAM TAKES THE LEAD" back on the host console, which is F118 itself
    (polish 2026-09-12). An unknown subject gets a neutral third-person line and the raw id after it."""
    s, _net, _clock, _ps = mk(1)
    line = s._alert_feed_text("lead_taken", "ghost-id")
    assert line == "THE LEAD CHANGED (ghost-id)", line
    assert "YOUR" not in line.upper(), "the player's own copy never reaches the operator"
    assert s._alert_feed_text("last_survivor", "ghost-id") == "ONE PLAYER IS LEFT STANDING (ghost-id)"
    # CONTROL: a resolvable subject still reads as before, and a line that needs no subject is untouched
    assert s._alert_feed_text("point_captured", "all") == "POINT CAPTURED"
    assert s._display_for("all") is None and s._display_for(None) is None


# --------------------------------------------------------------------------------------------------
# B5 · F119 — ACC is marked provisional instead of swinging
# --------------------------------------------------------------------------------------------------
def _status(sc, node, pid, shots, t):
    sc.ingest_status(node, {"player_id": pid, "shots": shots, "alive": True}, t)


def _hit(sc, node, victim, shooter_num, t):
    sc.ingest(node, {"type": "hit_taken", "t": t, "match_id": "m1", "player_id": victim,
                     "shooter_num": shooter_num, "dmg": 9}, t)


def test_accuracy_is_provisional_below_the_small_sample_floor():
    """`honors()` has refused SHARPSHOOTER below ten shots for months; the live number never said so."""
    sc, _fb = _duel()
    _status(sc, "n0", "p0", ACC_MIN_SHOTS - 1, T0 + 1000)
    _hit(sc, "n1", "p1", 1, T0 + 900)
    row = {r["player_id"]: r for r in sc.rows()}["p0"]
    assert row["accuracy"] is not None and row["acc_provisional"] is True
    assert row["shots"] == ACC_MIN_SHOTS - 1, "the row carries the denominator so the UI can say why"


def test_accuracy_is_provisional_while_the_shot_count_predates_the_last_hit():
    """The F119 mechanism exactly: hits are facts, pushed per event; `shots` is SAMPLED off the ~2 s
    heartbeat. Land two hits between samples and the numerator has moved and the denominator has not.
    """
    sc, _fb = _duel()
    _status(sc, "n0", "p0", 20, T0 + 1000)
    assert {r["player_id"]: r for r in sc.rows()}["p0"]["acc_provisional"] is False, "settled at the sample"
    _hit(sc, "n1", "p1", 1, T0 + 1500)
    _hit(sc, "n1", "p1", 1, T0 + 1800)
    assert {r["player_id"]: r for r in sc.rows()}["p0"]["acc_provisional"] is True, "denominator is stale"
    _status(sc, "n0", "p0", 24, T0 + 3000)
    row = {r["player_id"]: r for r in sc.rows()}["p0"]
    assert row["acc_provisional"] is False and row["accuracy"] == round(100 * 2 / 24, 1)


def test_a_row_with_no_accuracy_at_all_is_provisional_not_settled():
    sc, _fb = _duel()
    row = {r["player_id"]: r for r in sc.rows()}["p0"]
    assert row["accuracy"] is None and row["acc_provisional"] is True


def test_the_over_100_percent_case_is_exactly_what_the_flag_catches():
    """Two hits against one sampled shot is the spike Tony saw. The number is left alone — accuracy is
    still a faithful report of the facts MC holds — and the row now says it is not settled."""
    sc, _fb = _duel()
    _status(sc, "n0", "p0", 1, T0 + 1000)
    _hit(sc, "n1", "p1", 1, T0 + 1200)
    _hit(sc, "n1", "p1", 1, T0 + 1400)
    row = {r["player_id"]: r for r in sc.rows()}["p0"]
    assert row["accuracy"] == 200.0 and row["acc_provisional"] is True


def test_the_live_board_carries_the_flag_too():
    s, net, clock, ps, info = go_live(2)
    net.simulate_status("node0", {"player_id": ps[0]["player_id"], "shots": 3, "alive": True, "synced": True},
                        clock["t"])
    row = next(r for r in s.snapshot()["live"]["rows"] if r["player_id"] == ps[0]["player_id"])
    assert row["acc_provisional"] is True and row["best_streak"] == 0 and row["medals"] == []


# --------------------------------------------------------------------------------------------------
# Polish 2026-09-12 — the two presses that must not re-do a finished match, and the push that must not
# re-arm a live one
# --------------------------------------------------------------------------------------------------
def test_a_config_push_is_refused_while_the_match_is_armed_or_live_even_with_force():
    """A `config` rewrites `frames.head` on the node and clears `spawned` with no spawn behind it, and
    since A23/F121 that head is the DISARMED fn-28 `$SIR` table — so a push to a gun in play leaves a
    player who registers every hit and loses no health until their next life.

    `force` is the operator's override of a READINESS judgement and must not reach this one."""
    s, net, clock, ps, info = go_live(2)
    pushes = len(net.pushes("config", "node0"))
    cfg_id, bundle = s.config["config_id"], dict(s.bundles[ps[0]["player_id"]])
    for force in (False, True):
        try:
            s.push_config(force=force)
            assert False, f"a config push was accepted in {s.phase} (force={force})"
        except ValueError as e:
            assert "LIVE" in str(e) and ("RECALL" in str(e) and "END" in str(e)), e
    assert s.phase == "live" and s.config["config_id"] == cfg_id, "a refused push changes nothing"
    assert len(net.pushes("config", "node0")) == pushes, "no config envelope may reach a gun in play"
    assert s.bundles[ps[0]["player_id"]] == bundle and s.acks.get(ps[0]["player_id"], {}).get("ok")
    # ARMED is the same refusal — the guns already hold the disarmed head and are counting down
    s.control("recall")
    s.push_config(force=True)
    for i in range(2):
        net.simulate_node_message(f"node{i}", "ack_config", {"config_id": s.config["config_id"], "ok": True,
                                                             "gun_echo": "$LCD"}, clock["t"])
    s.start(runway_s=30)
    assert s.phase == "armed", s.phase
    try:
        s.push_config(force=True)
        assert False, "a config push was accepted in ARMED"
    except ValueError as e:
        assert "ARMED" in str(e), e
    # CONTROL: back in KIT the same push is fine — this is a phase guard, not a new readiness gate
    s.control("recall")
    assert s.push_config(force=True)["ok"] is True


def test_a_second_end_in_recap_ends_nothing_and_leaves_the_recap_alone():
    """END, then END again: the second press used to re-freeze the scorer, re-write the recap and
    re-push the victory cue to the winners standing in a debrief. It is forwarded to the nodes (a node
    that missed the first END is why an operator presses it twice) and reports honestly."""
    s, net, clock, ps, info = go_live(2)
    kill(s, net, clock, ps, 0, 1, info, seq=1)
    assert s.control("end")["ended"] is True and s.phase == "recap"
    recap, victories = dict(s.last_recap), len(net.pushes("feedback", ps[0]["node_id"]))
    r = s.control("end")
    assert (r["ok"], r["ended"], r["reached"]) == (False, False, 0), r
    assert r["error"] and r["phase"] == "recap" and r["nodes"] == 2, r
    assert r["pushed"] == 2, "the press still reaches the nodes"
    assert s.last_recap == recap, "the recap was re-written by a press that ended nothing"
    assert len(net.pushes("feedback", ps[0]["node_id"])) == victories, "the victory cue was pushed twice"
    assert any(e["tag"] == "WITHHELD" and "END AGAIN" in e["text"] for e in s.feed), s.feed[:3]
    # CONTROL: PANIC is still allowed in recap, and RECALL still returns the field to KIT
    assert s.control("panic", confirm=True)["ok"] is True
    assert s.control("recall")["ok"] is True and s.phase == "kit"


def test_a_cap_reached_mid_batch_finishes_on_the_WHOLE_batch():
    """Polish review 2026-09-12: `on_limit` fires from inside the ingest loop, so MC used to snapshot the
    recap and push the victory cue while the rest of the batch was still being scored.

    Two deaths on the same millisecond in one batch (a phone's store-and-forward outbox draining) and the
    cap falls on the first: the second still scores — same millisecond, so the A6.1 freeze does not touch
    it — but it landed after `_finish()` had already decided who won.

    A24/M2 (2026-09-12) changed what that second kill MEANS, not whether it is scored: two players
    reaching the cap inside `CLOCK_TIE_MS` is a DEAD HEAT (`winner.tie`), not a win for whichever of two
    indistinguishable kills MC ordered first. Same millisecond is inside any tolerance. The guard this
    test exists for is unchanged and in fact stronger: a tie naming BOTH players is only reachable if
    both kills were scored before the recap was taken — a half-batch recap has ROCCO alone on the cap."""
    s, net, clock, ps, info = go_live(3, "ffa", {"scoring": {"frag_limit": 2, "win_by": "kills"}})
    kill(s, net, clock, ps, 0, 2, info, seq=1)       # ROCCO 1 kill
    kill(s, net, clock, ps, 1, 0, info, seq=2)       # TONY 1 kill, ROCCO 1 death
    assert s.phase == "live", "one kill each of two is not the cap"
    clock["t"] += 1000
    t = clock["t"]
    ev = lambda killer_i, seq: {"type": "death", "t": t, "match_id": info["match_id"],
                                "player_id": ps[2]["player_id"], "shooter_num": ps[killer_i]["player_num"],
                                "shooter_team": 1, "seq": seq}
    net.simulate_node_message("node2", "event_batch", {"events": [ev(0, 3), ev(1, 4)]}, t)
    assert s.phase == "recap", "the cap was reached inside the batch"
    rows = {r["player_id"]: r for r in s.last_recap["rows"]}
    assert rows[ps[0]["player_id"]]["kills"] == 2 and rows[ps[1]["player_id"]]["kills"] == 2, rows
    assert s.last_recap["post_end"] == 0, "a same-millisecond fact is scored, not frozen out"
    assert s.last_recap["winner"].get("tie") == sorted([ps[0]["player_id"], ps[1]["player_id"]]), (
        f"the recap was taken from half a batch: {s.last_recap['winner']}")
    assert s.last_recap["winner"].get("player_id") is None, "a dead heat names no winner"
    won = {p[0] for p in net.pushes("feedback") if p[2].get("kind") == "victory"}
    assert won == set(), f"a dead heat has no winner to sting: {won}"
    # A24: and both of them are told it was a draw, rather than being left to guess from silence.
    res = {p[0]: p[2] for p in net.pushes("result")}
    assert res["node0"]["outcome"] == "draw" and res["node1"]["outcome"] == "draw"
    assert res["node2"]["outcome"] == "lose"


def test_a_cap_from_a_replaced_scorer_cannot_end_the_match_that_is_running():
    """A Scorer outlives the Session's pointer to it, and a late fact can still be ingested into one. The
    callback now names the scorer that fired, so only the one being played can end anything."""
    s, net, clock, ps, info = go_live(2, "ffa", {"scoring": {"frag_limit": 2, "win_by": "kills"}})
    old = s.scorer
    s.control("recall")
    s.push_config(force=True)
    for i in range(2):
        net.simulate_node_message(f"node{i}", "ack_config", {"config_id": s.config["config_id"], "ok": True,
                                                             "gun_echo": "$LCD"}, clock["t"])
    info2 = s.start(runway_s=10)
    clock["t"] = info2["go_live_t"] + 1
    s.tick()
    assert s.phase == "live" and s.scorer is not old
    # the old match's outbox drains at last: two kills into the FROZEN scorer, which reaches its own cap
    for n in range(2):
        old.ingest("node1", {"type": "death", "t": info["go_live_t"] + 100 + n, "match_id": info["match_id"],
                             "player_id": ps[1]["player_id"], "shooter_num": ps[0]["player_num"]},
                   clock["t"], seq=50 + n)
    assert old.limit_reached_t is not None, "fixture: the old scorer really did reach its cap"
    assert s.phase == "live", "a replaced scorer ended the match that was running"
    assert s.last_recap is None and s.start_info == info2


def test_a_batch_that_RAISES_after_the_cap_still_finishes_the_match():
    """Round-2 review 2026-09-12: the mid-batch flush sat OUTSIDE the `try/finally`.

    `_on_frag_limit` takes the A6.1 end freeze at the winning kill and defers the FINISH to the end of
    the batch. If anything later in that batch raised, the deferred finish was never run and nothing
    else ever flushed it: the scorer was frozen (no fact could score again) while the phase stayed
    `live` for the rest of the session -- a match that can neither end nor be played."""
    s, net, clock, ps, info = go_live(3, "ffa", {"scoring": {"frag_limit": 1, "win_by": "kills"}})
    clock["t"] += 1000
    t = clock["t"]
    ev = lambda killer_i, seq: {"type": "death", "t": t, "match_id": info["match_id"],
                                "player_id": ps[2]["player_id"], "shooter_num": ps[killer_i]["player_num"],
                                "shooter_team": 1, "seq": seq}
    real = s.scorer.ingest

    def boom(node_id, e, t_recv, **kw):
        if e.get("seq") == 4:
            raise RuntimeError("a malformed fact out of a draining outbox")
        return real(node_id, e, t_recv, **kw)

    s.scorer.ingest = boom
    raised = False
    try:
        net.simulate_node_message("node2", "event_batch", {"events": [ev(0, 3), ev(1, 4)]}, t)
    except RuntimeError:
        raised = True
    assert raised, "fixture: the second event of the batch must really raise"
    assert s.scorer.limit_reached_t is not None, "fixture: the cap was reached on the FIRST event"
    assert s.phase == "recap", (
        f"the batch raised and took the deferred finish with it: phase {s.phase}")
    assert s._pending_limit_t is None, "the deferred cap must not still be pending after the batch"
    assert s.last_recap and s.last_recap["winner"]["player_id"] == ps[0]["player_id"], s.last_recap


def test_a_deferred_cap_is_finished_by_the_next_single_fact():
    """Nothing but `ingest_batch` used to flush `_pending_limit_t`, so a cap left pending by any other
    path (a batch that bailed, a nested depth) waited forever. The single-event path flushes it now."""
    s, net, clock, ps, info = go_live(2, "ffa", {"scoring": {"frag_limit": 5, "win_by": "kills"}})
    kill(s, net, clock, ps, 0, 1, info, seq=1)
    assert s.phase == "live", "fixture: one kill of five is not the cap"
    s.scorer.set_end(clock["t"])            # exactly what `_on_frag_limit` does when it defers
    s._pending_limit_t = clock["t"]
    kill(s, net, clock, ps, 0, 1, info, seq=2)
    assert s.phase == "recap", f"a deferred cap survived a whole single-event ingest: phase {s.phase}"
    assert s._pending_limit_t is None


def test_a_deferred_cap_is_finished_by_a_tick():
    """The other flush call site: with no more facts arriving at all, the periodic tick finishes it."""
    s, net, clock, ps, info = go_live(2, "ffa", {"scoring": {"frag_limit": 5, "win_by": "kills"}})
    kill(s, net, clock, ps, 0, 1, info, seq=1)
    s.scorer.set_end(clock["t"])
    s._pending_limit_t = clock["t"]
    clock["t"] += 1000
    s.tick()
    assert s.phase == "recap", f"a deferred cap survived a tick: phase {s.phase}"
    assert s._pending_limit_t is None
