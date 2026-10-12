"""Write four session.json fixtures with the pre-constructor Session paths.

These are reviewed goldens: regenerate only on purpose, and read the diff. Run from mcp:
python3 tests/_session_json_fixtures.py
"""
import json
import pathlib
import secrets
import sys
import tempfile
import uuid
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from _session import mk_kit_session, online  # noqa: E402


OUT = pathlib.Path(__file__).resolve().parent / "fixtures" / "session-json"


class _Id:
    def __init__(self):
        self.next = 0

    def __call__(self):
        self.next += 1
        return uuid.UUID(hex=f"{self.next:08x}" + "0" * 24)


def generate():
    with patch("uuid.uuid4", side_effect=_Id()), patch("secrets.token_urlsafe", return_value="fixture-join-secret"):
        with tempfile.TemporaryDirectory() as root:
            s, net, clock, players = mk_kit_session()
            s._persist_path = pathlib.Path(root) / "session.json"
            for i, player in enumerate(players):
                online(s, net, clock, player, i)
            net.simulate_utility_hello("station-left")
            s.set_station("station-left", {"kind": "respawn", "team": "blue", "id": 3})
            s.push_config()
            for i in range(2):
                net.simulate_node_message(f"node{i}", "ack_config",
                                          {"config_id": s.config["config_id"], "ok": True,
                                           "gun_echo": "$LCD"}, clock["t"])
            info = s.start(runway_s=10)
            s.powerup_ledger.tick(clock["t"])
            output = {}

            def save(name):
                s._persist_last = 0.0
                s._persist()
                output[name] = json.loads(s._persist_path.read_text(encoding="utf-8"))

            save("armed")
            clock["t"] = info["go_live_t"] + 1
            s.tick()
            s.evict_node("node0")
            net.simulate_utility_hello("node1")
            joined = s.add_player("JOINER", gun_id="GUN-C")
            net.simulate_hello("hot-joined", "GUN-C-0000")
            assert joined["player_id"] in s.scorer.joined_t
            s.release_station("station-left")
            save("live")
            s.control("end")
            save("recap")
            s.next_match()
            s.set_phase("kit")
            s.add_player("NEXT", gun_id="GUN-D")
            save("retired")
            return output


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for name, snapshot in generate().items():
        (OUT / name / "session.json").parent.mkdir(exist_ok=True)
        (OUT / name / "session.json").write_text(json.dumps(snapshot, indent=2, sort_keys=True) + "\n",
                                                  encoding="utf-8")


if __name__ == "__main__":
    main()
