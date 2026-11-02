"""F644 (field 2026-11-01): one console socket that stops reading must not hold up any other tab's snapshots.

MC awaited each `/ui-ws` send in turn, so a socket whose TCP window had shut (a locked phone, a sleeping laptop, a dead
path through the Windows port proxy) blocked every later snapshot for every tab, and the operator refreshed after each
match. The browser path is `webapp/mc/test/e2e/stalled-tab.mjs`; this is the same fault on the Broadcaster alone, fast
enough for every run. Skips cleanly without starlette (system python)."""
import asyncio

from _skip import needs

try:
    import starlette  # noqa: F401
    HAVE = True
except Exception:
    HAVE = False


class _Ws:
    """A stand-in console socket. `stuck` never completes a send, as a socket with a shut window does."""

    def __init__(self, stuck=False):
        self.stuck, self.sent, self.scope = stuck, [], {}

    async def send_text(self, data):
        if self.stuck:
            await asyncio.Event().wait()
        self.sent.append(data)


def _bc():
    from brx_mcp.mc.api import Broadcaster
    from brx_mcp.mc.fakes import FakeArmory, FakeCompiler, FakeNet, demo_armory
    from brx_mcp.mc.state import Session
    s = Session(FakeCompiler(), FakeNet(), FakeArmory(demo_armory()))
    return Broadcaster(s), s


async def _until(pred, secs=2.0):
    end = asyncio.get_running_loop().time() + secs
    while not pred():
        if asyncio.get_running_loop().time() > end:
            return False
        await asyncio.sleep(0.01)
    return True


def test_a_stuck_socket_does_not_hold_up_the_others_and_is_dropped():
    needs(HAVE, "starlette")

    async def go():
        bc, s = _bc()
        bc.SEND_TIMEOUT_S = 0.3
        run = asyncio.ensure_future(bc.run())
        await asyncio.sleep(0)
        stuck, ok = _Ws(stuck=True), _Ws()
        bc.add(stuck)
        bc.add(ok)
        assert await _until(lambda: len(ok.sent) == 1), "the healthy tab gets its first snapshot"
        s.set_option("log_sync", "manual")              # a state change: one snapshot to every tab
        assert await _until(lambda: len(ok.sent) == 2), \
            "the healthy tab gets the next snapshot while the stuck one has not taken its first"
        assert '"log_sync": "manual"' in ok.sent[-1]
        bc._feed({"kind": "x", "text": "a feed row"})
        assert await _until(lambda: any('"kind": "feed"' in m for m in ok.sent)), "and the feed row"
        assert await _until(lambda: stuck not in bc.clients), "the stuck socket is dropped after SEND_TIMEOUT_S"
        assert ok in bc.clients, "the healthy one stays"
        s.set_option("log_sync", "auto")
        assert await _until(lambda: '"log_sync": "auto"' in ok.sent[-1]), "and keeps getting snapshots"
        run.cancel()

    asyncio.run(go())


def test_a_slow_socket_gets_the_newest_snapshot_not_a_backlog():
    needs(HAVE, "starlette")
    from brx_mcp.mc.api import _UiClient
    c = _UiClient(_Ws())
    c.put("snapshot", "s1")
    c.put("feed", "f1")
    c.put("snapshot", "s2")
    c.put("heartbeat", "h1")
    c.put("heartbeat", "h2")
    assert list(c.outbox) == [("snapshot", "s2"), ("feed", "f1"), ("heartbeat", "h2")]


def test_a_quiet_mc_sends_a_heartbeat():
    needs(HAVE, "starlette")

    async def go():
        bc, _ = _bc()
        bc.HEARTBEAT_S = 0.05
        run = asyncio.ensure_future(bc.run())
        await asyncio.sleep(0)
        ws = _Ws()
        bc.add(ws)
        assert await _until(lambda: any('"kind": "heartbeat"' in m for m in ws.sent)), \
            "a console can tell a quiet MC from a dead link"
        run.cancel()

    asyncio.run(go())
