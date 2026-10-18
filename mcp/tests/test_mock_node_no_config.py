"""F549: the mock node can ack a push `err: "no_config"`, as the phone does when the gun loaded nothing, so a chaos
run or a hand test can reach MC's GUN DID NOT TAKE THE CONFIG blocker. Off by default: a stub head stays as it was."""
from brx_mcp.mc import envelope as E
from brx_mcp.mc.mock_node import MockNode


def _ack(node: MockNode) -> dict:
    sent: list[dict] = []
    node._send = sent.append            # capture, no socket
    node._handle(E.make_envelope("config", {"config": {"config_id": "c1"}, "frames": {}}))
    return [e for e in sent if e.get("kind") == "ack_config"][-1]["body"]


def test_no_config_acks_no_config_and_the_default_still_answers():
    assert _ack(MockNode("ws://x", no_config=True)) == {"config_id": "c1", "ok": False, "err": "no_config"}
    plain = _ack(MockNode("ws://x"))
    assert plain["ok"] is True and plain.get("gun_echo"), plain
