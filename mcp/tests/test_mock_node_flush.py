"""F458: the e2e stand-in's `nodes.cmd` resolved once a frame was QUEUED, not sent (`MockNode._send` fired the socket
write as an untracked task). Under load the death frame sat unsent past the ten seconds mc-vqa2 waits for MC to score
the kill. `flush()` waits for every queued send, and the e2e node runners await it before they answer `ok`."""
import asyncio

from brx_mcp.mc.mock_node import MockNode


class _SlowWs:
    def __init__(self):
        self.sent = []

    async def send(self, text):
        await asyncio.sleep(0.05)   # a loaded loop: the write lands later than the call
        self.sent.append(text)


def test_flush_returns_only_after_the_queued_frames_are_sent():
    async def run():
        node = MockNode("ws://127.0.0.1:1/ws", gun_name="GUN-B")
        node._ws = _SlowWs()
        node._welcomed.set()
        node.alive = True
        node.die(7, 0)
        assert node._ws.sent == [], "the write is still in flight when die() returns"
        await node.flush()
        assert len(node._ws.sent) == 1 and '"death"' in node._ws.sent[0]
    asyncio.run(run())


def test_flush_with_nothing_queued_returns_at_once():
    async def run():
        node = MockNode("ws://127.0.0.1:1/ws")
        await asyncio.wait_for(node.flush(), 1)
    asyncio.run(run())


def test_send_status_puts_one_status_on_the_socket_now():
    """T5 (maintainability review 2026-10-10): `lost` and `status` only changed `extra_status`, so the change rode the next
    2 s heartbeat and two back-to-back commands collapsed into one. `send_status()` sends it at once."""
    async def run():
        node = MockNode("ws://127.0.0.1:1/ws", gun_name="GUN-B")
        node._ws = _SlowWs()
        node.extra_status["outbox_lost"] = {"match_id": "m1", "n": 3}
        assert node.send_status() is True
        await node.flush()
        assert len(node._ws.sent) == 1 and '"status"' in node._ws.sent[0] and '"outbox_lost"' in node._ws.sent[0]
    asyncio.run(run())


def test_die_and_take_hit_say_whether_they_sent_anything():
    """T5: on a dead node `die` and `take_hit` sent nothing and said nothing, so a harness answered `ok` for no frame."""
    async def run():
        node = MockNode("ws://127.0.0.1:1/ws", gun_name="GUN-B")
        node._ws = _SlowWs()
        node.alive = False
        assert node.die(7, 0) is False and node.take_hit(7, 0) is False
        node.alive = True
        assert node.take_hit(7, 0) is True and node.die(7, 0) is True
    asyncio.run(run())


def test_send_status_with_no_socket_says_so():
    """T5 review (Codex r1): after `drop` there is no socket, and the runner must not answer `ok` for nothing."""
    node = MockNode("ws://127.0.0.1:1/ws")
    assert node.send_status() is False
