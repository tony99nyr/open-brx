"""Write session.json fixtures with the pre-constructor Session paths.

These are reviewed goldens: regenerate only on purpose, and read the diff. Run from mcp:
python3 tests/_session_json_fixtures.py
"""
from _session import scorer_of
import json
import pathlib
import secrets
import sqlite3
import sys
import tempfile
import uuid
from contextlib import contextmanager
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from _session import heartbeat, kill, mk_kit_session, online  # noqa: E402
from brx_mcp.mc.store import Store  # noqa: E402


OUT = pathlib.Path(__file__).resolve().parent / "fixtures" / "session-json"


class _Id:
    def __init__(self):
        self.next = 0

    def __call__(self):
        self.next += 1
        return uuid.UUID(hex=f"{self.next:08x}" + "0" * 24)


@contextmanager
def fixture_run():
    """Keep each fixture's SQLite store available while the restart test copies it."""
    with patch("uuid.uuid4", side_effect=_Id()), patch("secrets.token_urlsafe", return_value="fixture-join-secret"):
        with tempfile.TemporaryDirectory() as root:
            root = pathlib.Path(root)
            output, stores, scores = {}, {}, {}
            opened = []
            cfg = {"scoring": {"frag_limit": 3, "win_by": "kills"}}

            def new_session(store_name):
                store = Store(store_name, root / f"{store_name}.sqlite")
                opened.append(store)
                session, net, clock, players = mk_kit_session(cfg=cfg, store=store)
                session.mono_ms = lambda: clock["t"]
                session._persist_path = root / "session.json"
                return session, net, clock, players

            def save(name, session):
                session._persist_last = 0.0
                session._persist()
                snapshot = json.loads(session._persist_path.read_text(encoding="utf-8"))
                if "match" in snapshot:
                    # The production path is absolute and unique to this run. The test replaces this
                    # stable filename with its copied store's absolute path before restoring.
                    snapshot["match"]["store_path"] = "session.sqlite"
                    scores[name] = scorer_of(session).team_scores()
                    destination = root / name / "session.sqlite"
                    destination.parent.mkdir()
                    with sqlite3.connect(destination) as copy:
                        session.store.db.backup(copy)
                    stores[name] = destination
                output[name] = snapshot

            def start(session, net, clock, players):
                for i, player in enumerate(players):
                    online(session, net, clock, player, i)
                session.push_config()
                for i in range(2):
                    net.simulate_node_message(f"node{i}", "ack_config",
                                              {"config_id": session.config["config_id"], "ok": True,
                                               "gun_echo": "$LCD"}, clock["t"])
                return session.start(runway_s=10)

            def two_kills(session, net, clock, players, info):
                heartbeat(session, net, clock, players)
                kill(session, net, clock, players, 0, 1, info, seq=1)
                clock["t"] += 1000
                net.simulate_event("node1", {"type": "respawn", "t": clock["t"],
                                                    "match_id": info["match_id"],
                                                    "player_id": players[1]["player_id"]}, clock["t"], seq=2)
                kill(session, net, clock, players, 0, 1, info, seq=3)

            def two_return_kills(session, net, clock, players, info):
                heartbeat(session, net, clock, players)
                for seq in (1, 3):
                    clock["t"] += 1000
                    net.simulate_event("node0", {"type": "death", "t": clock["t"],
                                                       "match_id": info["match_id"],
                                                       "player_id": players[0]["player_id"],
                                                       "shooter_num": players[1]["player_num"],
                                                       "shooter_team": 2}, clock["t"], seq=seq)
                    if seq == 1:
                        clock["t"] += 1000
                        net.simulate_event("node0", {"type": "respawn", "t": clock["t"],
                                                            "match_id": info["match_id"],
                                                            "player_id": players[0]["player_id"]},
                                           clock["t"], seq=2)

            try:
                s, net, clock, players = new_session("ordinary")
                net.simulate_utility_hello("station-left")
                s.set_station("station-left", {"kind": "respawn", "team": "blue", "id": 3})
                info = start(s, net, clock, players)
                s.powerup_ledger.tick(clock["t"])
                save("armed", s)
                clock["t"] = info["go_live_t"] + 1
                s.tick()
                two_kills(s, net, clock, players, info)
                assert scorer_of(s).team_scores()["red"] == 2
                two_return_kills(s, net, clock, players, info)
                assert scorer_of(s).team_scores() == {"red": 2, "blue": 2}
                s.evict_node("node0")
                net.simulate_utility_hello("node1")
                joined = s.add_player("JOINER", gun_id="GUN-C")
                net.simulate_hello("hot-joined", "GUN-C-0000")
                assert joined["player_id"] in scorer_of(s).joined_t
                s.release_station("station-left")
                # The saved alerts outlive the feedback window. A replay cannot recreate them.
                clock["t"] += 20_000
                save("live", s)
                s.control("end")
                save("recap", s)
                s.finalise_recap()
                s.next_match()
                s.set_phase("kit")
                s.add_player("NEXT", gun_id="GUN-D")
                save("retired", s)

                capped, cap_net, cap_clock, cap_players = new_session("capped")
                cap_info = start(capped, cap_net, cap_clock, cap_players)
                cap_clock["t"] = cap_info["go_live_t"] + 1
                capped.tick()
                two_kills(capped, cap_net, cap_clock, cap_players, cap_info)
                cap_clock["t"] += 1000
                cap_net.simulate_event("node1", {"type": "respawn", "t": cap_clock["t"],
                                                        "match_id": cap_info["match_id"],
                                                        "player_id": cap_players[1]["player_id"]},
                                       cap_clock["t"], seq=4)
                broadcast = capped._broadcast_control
                finish = capped._finish

                def delayed_broadcast(cmd):
                    reached = broadcast(cmd)
                    cap_clock["t"] += 50
                    return reached

                def capture_before_finish():
                    # The cap has reached the scorer, but _finish has not cleared the match.
                    save("live-capped", capped)
                    finish()

                capped._broadcast_control = delayed_broadcast
                capped._finish = capture_before_finish
                kill(capped, cap_net, cap_clock, cap_players, 0, 1, cap_info, seq=5)
                assert capped.phase == "recap"

                adopted, adopt_net, adopt_clock, adopt_players = new_session("adopted")
                for i, player in enumerate(adopt_players):
                    online(adopted, adopt_net, adopt_clock, player, i)
                adopt_net.simulate_status("node0", {"arm_state": "live", "match_id": "orphan-match",
                                                        "game_byte": adopted._game_byte(), "synced": True},
                                          adopt_clock["t"])
                adopted.adopt_orphan("orphan-match")
                adopted.powerup_ledger.tick(adopt_clock["t"])
                save("adopted", adopted)
                yield output, stores, scores
            finally:
                for store in opened:
                    store.close()


def generate():
    with fixture_run() as (output, _stores, _scores):
        return output


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for name, snapshot in generate().items():
        (OUT / name / "session.json").parent.mkdir(exist_ok=True)
        (OUT / name / "session.json").write_text(json.dumps(snapshot, indent=2, sort_keys=True) + "\n",
                                                  encoding="utf-8")


if __name__ == "__main__":
    main()
