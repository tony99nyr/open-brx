"""Integration scenario tests over the REAL stack (Session + NetServer + Compiler + MockNode).

Turns the match-day simulation's paper-findings into executable proof. Skips without `websockets`;
run for real: `.venv/bin/python run_tests.py mc_e2e`. Findings go to the M-NET/state lanes, not patches.
"""
from __future__ import annotations

from e2e_util import HAVE_WS, Stack, skip, run, until, GUN_ECHO
import asyncio


def _num(p):
    return p["player_num"]


def _tid(stack, p):
    return stack.session.team(p["team_id"])["tid"]


def _rows(stack):
    r = stack.session.recap() or {}
    return {row["player_id"]: row for row in r.get("rows", [])}


# --------------------------------------------------------------- happy path
def test_full_game_to_recap():
    if not HAVE_WS:
        return skip("full_game")

    async def go():
        async with Stack(mode="tdm", time_limit_s=30) as s:
            a = s.add_player("REAPER", "GUN-A", team_id="blue")
            b = s.add_player("VIPER", "GUN-B", team_id="yellow")
            na = await s.connect_node("GUN-A")
            nb = await s.connect_node("GUN-B")
            assert await until(lambda: na.player_id == a["player_id"] and nb.player_id == b["player_id"]), "nodes bound to players"
            assert await s.wait_ready(), f"readiness not go: {s.session.readiness()['board']}"

            await s.push_and_start(runway_s=1)
            assert await s.wait_live(), "nodes did not go live at T-0"

            # A guns down B twice (armor 70 + hp 45 → a few hits per kill)
            for _ in range(2):
                nb.respawn() if not nb.alive else None
                while nb.alive:
                    nb.take_hit(_num(a), _tid(s, a), dmg=40)
            assert await until(lambda: _rows(s).get(a["player_id"], {}).get("kills", 0) >= 2), \
                f"A's kills not credited: {_rows(s)}"

            s.session.control("end")
            r = s.session.recap()
            assert r and r["rows"], "recap has rows"
            assert _rows(s)[a["player_id"]]["kills"] >= 2 and _rows(s)[b["player_id"]]["deaths"] >= 2
            # a winner is named (team or player) and MVP honor exists
            assert r["winner"].get("team_id") or r["winner"].get("player_id")
    run(go())


# ------------------------------------------------ (a) long outage + batch flush, credited once
def test_long_outage_batch_flush_credits_once():
    if not HAVE_WS:
        return skip("outage")

    async def go():
        async with Stack(mode="tdm", time_limit_s=60) as s:
            a = s.add_player("A", "GUN-A", team_id="blue")
            b = s.add_player("B", "GUN-B", team_id="yellow")
            na = await s.connect_node("GUN-A")
            nb = await s.connect_node("GUN-B")
            assert await s.wait_ready()
            await s.push_and_start(runway_s=1)
            assert await s.wait_live()

            # B drops off the LAN, takes fatal damage + dies while offline (buffered in its ring)
            await nb.disconnect()
            while nb.alive:
                nb.take_hit(_num(a), _tid(s, a), dmg=40)
            assert nb.ring, "death buffered offline"
            assert _rows(s).get(a["player_id"], {}).get("kills", 0) == 0, "not credited while B offline"

            nb.reconnect()
            await nb.wait_connected(10)
            assert await until(lambda: _rows(s).get(a["player_id"], {}).get("kills", 0) == 1), \
                "kill credited exactly once after batch flush"
            # let a few more heartbeats/acks pass; still exactly one (dedup holds through the stack)
            await until(lambda: False, timeout=0.5)
            assert _rows(s)[a["player_id"]]["kills"] == 1, "kill not double-counted"
    run(go())


# ------------------------------------------------ (g) FFA: never friendly, winner = top row
def test_ffa_never_friendly_winner_is_top_row():
    if not HAVE_WS:
        return skip("ffa")

    async def go():
        # FFA: one team/$TID, friendly-fire on; winner is the top ScoreRow, not a team.
        async with Stack(mode="ffa", time_limit_s=60,
                         teams=[{"team_id": "ffa", "name": "All", "color": "red", "tid": 1}]) as s:
            a = s.add_player("A", "GUN-A", team_id="ffa")
            b = s.add_player("B", "GUN-B", team_id="ffa")
            c = s.add_player("C", "GUN-C", team_id="ffa")
            na = await s.connect_node("GUN-A")
            nb = await s.connect_node("GUN-B")
            nc = await s.connect_node("GUN-C")
            assert await s.wait_ready()
            await s.push_and_start(runway_s=1)
            assert await s.wait_live()

            # same $TID for everyone — A killing B must still credit +1 (roster friendly rule off in FFA)
            while nb.alive:
                nb.take_hit(_num(a), _tid(s, a), dmg=40)
            while nc.alive:
                nc.take_hit(_num(a), _tid(s, a), dmg=40)
            assert await until(lambda: _rows(s).get(a["player_id"], {}).get("kills", 0) == 2), \
                f"FFA kills under one $TID must count, not be friendly: {_rows(s)}"

            s.session.control("end")
            r = s.session.recap()
            assert r["winner"].get("player_id") == a["player_id"], f"FFA winner is the top row: {r['winner']}"
            assert not r["winner"].get("team_id"), "FFA has no team winner"
    run(go())


# ------------------------------------------------ (h) headset-off gun blocks start
def test_headset_off_blocks_start():
    if not HAVE_WS:
        return skip("headset")

    async def go():
        async with Stack(mode="tdm", time_limit_s=30) as s:
            s.add_player("A", "GUN-A", team_id="blue")
            s.add_player("B", "GUN-B", team_id="yellow")
            await s.connect_node("GUN-A")                      # healthy
            await s.connect_node("GUN-B", gun_echo=None)       # headset off → no config echo
            assert await s.wait_ready(), "pre-push readiness is go (headset is amber before the push)"

            # push proceeds; the headset-off gun answers ack_config{ok:false,no_echo} → its row goes red
            s.session.push_config()
            assert await until(lambda: not s.session.readiness()["go"], 6.0), \
                "post-push readiness must go red once the headset-off gun answers with an empty echo"
            red = [r for r in s.session.readiness()["board"] if r["status"] == "red"]
            assert red and any("HEADSET" in b for r in red for b in r["blockers"]), red
            assert not s.session.all_acked()
            try:
                s.session.start(runway_s=1)
                assert False, "start must be blocked when a gun did not answer the config"
            except ValueError:
                pass
    run(go())


async def _live_two(s, mode="tdm"):
    """Bring two bound, ready, LIVE nodes up. Returns (a, b, na, nb)."""
    a = s.add_player("A", "GUN-A", team_id=("ffa" if mode == "ffa" else "blue"))
    b = s.add_player("B", "GUN-B", team_id=("ffa" if mode == "ffa" else "yellow"))
    na = await s.connect_node("GUN-A")
    nb = await s.connect_node("GUN-B")
    assert await s.wait_ready(), s.session.readiness()["board"]
    await s.push_and_start(runway_s=1)
    assert await s.wait_live()
    return a, b, na, nb


async def _kill(s, killer, victim_node):
    while victim_node.alive:
        victim_node.take_hit(_num(killer), _tid(s, killer), dmg=40)


def _got_cue(node, kind):
    return any(e.get("kind") == "feedback" and (e.get("body") or {}).get("kind") == kind
               for e in node.received)


# ------------------------------------------------ victory cue → winning team only (at recap)
def test_victory_cue_to_winning_team_only():
    if not HAVE_WS:
        return skip("victory")

    async def go():
        async with Stack(mode="tdm", time_limit_s=120) as s:
            a, b, na, nb = await _live_two(s)      # a=blue, b=yellow
            await _kill(s, a, nb)                    # blue draws first blood → blue wins on end
            assert await until(lambda: _rows(s).get(a["player_id"], {}).get("kills", 0) >= 1)
            s.session.control("end")
            r = s.session.recap()
            assert r["winner"].get("team_id") == a["team_id"], f"blue should win: {r['winner']}"
            # the WINNER's node gets the victory cue; the LOSER's does not
            assert await until(lambda: _got_cue(na, "victory"), 5.0), "winning node receives the victory cue"
            await until(lambda: False, timeout=0.4)   # give any stray push time to (not) arrive
            assert not _got_cue(nb, "victory"), "losing node must NOT get the victory cue"
    run(go())


# ------------------------------------------------ (e) post-end parking (validates C1 end-freeze)
def test_post_end_parking_does_not_move_the_winner():
    if not HAVE_WS:
        return skip("post_end")

    async def go():
        async with Stack(mode="tdm", time_limit_s=120) as s:
            a, b, na, nb = await _live_two(s)
            await _kill(s, a, nb)
            assert await until(lambda: _rows(s).get(a["player_id"], {}).get("kills", 0) == 1)
            k0 = _rows(s)[a["player_id"]]["kills"]

            s.session.control("end")                     # freezes scoring at end_t (A6.1)
            end_t = s.session.scorer.end_t
            # a late kill (same match) that lands AFTER end_t must PARK, not score
            nb.emit({"type": "death", "shooter_num": _num(a), "shooter_team": _tid(s, a),
                     "t": (end_t or 0) + 5000})
            assert await until(lambda: len(s.session.scorer.post_end) >= 1, 4.0), "late fact parked as post_end"
            assert _rows(s)[a["player_id"]]["kills"] == k0, "post-end fact must not move the score"
    run(go())


# ------------------------------------------------ (i) stale match_id parks, never scores
def test_stale_match_id_is_parked():
    if not HAVE_WS:
        return skip("match_id")

    async def go():
        async with Stack(mode="tdm", time_limit_s=120) as s:
            a, b, na, nb = await _live_two(s)
            await _kill(s, a, nb)
            assert await until(lambda: _rows(s).get(a["player_id"], {}).get("kills", 0) == 1)
            before = _rows(s)[a["player_id"]]["kills"]
            # a death stamped with a DIFFERENT match_id (e.g. a stray from a prior/other match)
            nb.emit({"type": "death", "shooter_num": _num(a), "shooter_team": _tid(s, a),
                     "match_id": "stale-match-xyz"})
            assert await until(lambda: any(ev.get("match_id") == "stale-match-xyz"
                                           for _, ev, _ in s.session.scorer.parked), 4.0), "stale fact parked"
            assert _rows(s)[a["player_id"]]["kills"] == before, "foreign-match fact must not score"
    run(go())


# ------------------------------------------------ (k) score push to the killer's node after a kill
def test_score_push_reaches_killer_node():
    if not HAVE_WS:
        return skip("score_push")

    async def go():
        async with Stack(mode="tdm", time_limit_s=120) as s:
            a, b, na, nb = await _live_two(s)
            await _kill(s, a, nb)

            def scored_push():
                for e in na.received:
                    if e.get("kind") == "score":
                        body = e.get("body", {})
                        row = body.get("row", body)
                        if (row.get("kills") or 0) >= 1:
                            return True
                return False
            assert await until(scored_push, 5.0), \
                f"killer node should receive a score push with kills>=1; got kinds {[e.get('kind') for e in na.received]}"
    run(go())


# ------------------------------------------------ (j) timed-end mirror flips MC to recap
def test_timed_end_flips_mc_to_recap():
    if not HAVE_WS:
        return skip("timed_end")

    async def go():
        async with Stack(mode="tdm", time_limit_s=2) as s:      # 2s match
            a, b, na, nb = await _live_two(s)
            await _kill(s, a, nb)
            # drive the MC tick loop; at go_live_t + time_limit the mirror should end the match
            ok = False
            for _ in range(120):
                s.session.tick()
                if s.session.phase == "recap":
                    ok = True
                    break
                await until(lambda: False, timeout=0.1)
            assert ok, f"MC never mirrored the timed end to recap (phase={s.session.phase})"
            # the mirror flipping MC to recap is the point of (j); provisional stays True until every
            # victim's facts flush (A5.11) — correct, not a failure.
            r = s.session.recap()
            assert r and r.get("rows") is not None, "recap available after the timed end"
    run(go())


# ------------------------------------------------ (c) hot-swap keeps shots_total (accuracy ≤ 100%)
def test_hot_swap_preserves_shots_total():
    if not HAVE_WS:
        return skip("hot_swap")

    async def go():
        async with Stack(mode="tdm", time_limit_s=120) as s:
            a, b, na, nb = await _live_two(s)
            na.fire(10)                                    # A fires 10 → reported via status.shots
            assert await until(lambda: s.session.scorer.shots_total(a["player_id"]) >= 10, 5.0), \
                "A's shots reached the scorer"
            await na.close()                               # A's phone dies — its socket drops (A8: the record
            #   stays FRESH for STALE_AFTER_MS and blocks a keyless re-claim; only a stale one is displaced)
            s.net.stale_after_ms = 300; await asyncio.sleep(0.5)
            # hot-swap: a NEW node_id binds the SAME gun → old shots fold into the baseline (A6.2)
            na2 = await s.connect_node("GUN-A", node_id="GUN-A-swap")
            assert await until(lambda: na2.player_id == a["player_id"], 5.0), "swapped phone hydrated by gun"
            na2.arm_state, na2.alive, na2.match_id = "live", True, na.match_id
            na2.fire(5)                                    # 5 more shots on the new session
            assert await until(lambda: s.session.scorer.shots_total(a["player_id"]) >= 15, 5.0), \
                f"shots_total must fold baseline+new (10+5), got {s.session.scorer.shots_total(a['player_id'])}"
            row = _rows(s).get(a["player_id"], {})
            if row.get("accuracy") is not None:
                assert row["accuracy"] <= 1.0, f"accuracy must stay ≤100%, got {row['accuracy']}"
    run(go())


# ------------------------------------------------ (b) wiped install resumes seq (no silent drop)
def test_wiped_install_resumes_seq_and_scores():
    if not HAVE_WS:
        return skip("wiped")

    async def go():
        async with Stack(mode="tdm", time_limit_s=120) as s:
            a, b, na, nb = await _live_two(s)
            match = s.session.scorer.match_id
            await _kill(s, a, nb)
            assert await until(lambda: _rows(s).get(a["player_id"], {}).get("kills", 0) == 1)
            hi = s.net.nodes[nb.node_id].seq_hi
            bid = nb.node_id
            await nb.close()

            # reinstalled app: SAME node_id, storage wiped (seq_next back to 1, no node_key) — allowed once the
            # old record is STALE (A8/HIGH-3: a fresh one is still its owner's)
            s.net.stale_after_ms = 300; await asyncio.sleep(0.5)
            fresh = await s.connect_node("GUN-B", node_id=bid)
            assert await until(lambda: fresh.seq_hi_seen == hi and fresh.seq_next == hi + 1, 5.0), \
                f"reinstalled node must resume seq from MC high-water {hi} (welcome), got {fresh.seq_next}"
            # a new death from the fresh install is scored, not dropped as a replay
            fresh.arm_state, fresh.alive, fresh.match_id = "live", True, match
            fresh.emit({"type": "death", "shooter_num": _num(a), "shooter_team": _tid(s, a)})
            assert await until(lambda: _rows(s).get(a["player_id"], {}).get("kills", 0) == 2, 5.0), \
                "post-reinstall fact scored (not silently dropped by the dedup high-water)"
    run(go())


# ------------------------------------------------ (d) late joiner — CHARACTERIZATION of a KNOWN GAP
# FINDING (reported to the state lane): a player added AFTER the lobby push is NOT in `self.bundles`,
# so its `welcome` carries the `start` (from hydrate's start_info) but NO config/frames — it reaches
# arm_state "live" yet its gun was never configured (no loadout/health written). `add_player` after a
# push should compile + push that player's bundle (add to `bundles`, push `config`) so it truly arms.
# This test pins the CURRENT behavior; when the fix lands, strengthen it to assert has-config + alive.
def test_late_joiner_gets_bundle_and_start():
    if not HAVE_WS:
        return skip("late_join")

    async def go():
        async with Stack(mode="tdm", time_limit_s=120) as s:
            a, b, na, nb = await _live_two(s)
            c = s.add_player("LATE", "GUN-C", team_id="yellow")
            nc = await s.connect_node("GUN-C")
            assert await until(lambda: nc.player_id == c["player_id"], 6.0), "late joiner binds to its player"
            assert await until(lambda: nc.go_live_t is not None, 6.0), "late joiner receives the running start"
            # A5.6 late joiner: hydrated with a compiled bundle on its first hello (fixed 2026-08-25)
            assert c["player_id"] in s.session.bundles, "late joiner has a compiled bundle"
            assert await until(lambda: bool(nc.context.get("frames") or nc.context.get("config")), 6.0), "welcome carried config + frames for the late joiner"
    run(go())


# ------------------------------------------------ (f) abort lists a disconnected node as unreachable
def test_abort_start_lists_unreachable_node():
    if not HAVE_WS:
        return skip("abort")

    import brx_mcp.mc.state as _st
    old_stale = _st.STALE_AFTER_MS
    _st.STALE_AFTER_MS = 300  # so a disconnected node counts as unreachable within the test

    async def go():
        async with Stack(mode="tdm", time_limit_s=120) as s:
            a = s.add_player("A", "GUN-A", team_id="blue")
            b = s.add_player("B", "GUN-B", team_id="yellow")
            na = await s.connect_node("GUN-A")
            nb = await s.connect_node("GUN-B")
            assert await s.wait_ready()
            s.session.push_config()
            assert await until(s.session.all_acked, 6.0)
            s.session.start(runway_s=30)                 # long runway → stays ARMED
            assert s.session.phase == "armed"
            await nb.disconnect()
            await until(lambda: False, timeout=0.6)       # let B go stale (>300ms)
            res = s.session.abort_start()
            assert b["player_id"] in res.get("unreachable", []), f"disconnected B must be unreachable: {res}"
            assert a["player_id"] not in res.get("unreachable", []), "A is still reachable"
    try:
        run(go())
    finally:
        _st.STALE_AFTER_MS = old_stale
