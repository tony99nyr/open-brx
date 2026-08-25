"""Integration scenario tests over the REAL stack (Session + NetServer + Compiler + MockNode).

Turns the match-day simulation's paper-findings into executable proof. Skips without `websockets`;
run for real: `.venv/bin/python run_tests.py mc_e2e`. Findings go to the M-NET/state lanes, not patches.
"""
from __future__ import annotations

from e2e_util import HAVE_WS, Stack, skip, run, until, GUN_ECHO


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
