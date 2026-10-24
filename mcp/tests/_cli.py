"""The CLI's fake Bluetooth manager on virtual time, shared by test_cli_arm_frames and test_cli_entry."""
import contextlib
import io

from brx_mcp import __main__ as cli


class _VirtualTime:
    """A fake clock and scheduler: `sleep` parks the caller until the clock is moved to its wake time, and the
    driver moves the clock only when every other task is idle. No wall-clock time passes, nothing races."""

    def __init__(self):
        import heapq
        self.now = 1000.0
        self.heap = []
        self.n = 0
        self._push, self._pop = heapq.heappush, heapq.heappop
        self.yield0 = None

    async def sleep(self, seconds):
        import asyncio
        if seconds <= 0:
            await self.yield0(0)
            return
        fut = asyncio.get_running_loop().create_future()
        self._push(self.heap, (self.now + seconds, self.n, fut))
        self.n += 1
        await fut

    async def drive(self, main):
        for _ in range(2_000_000):
            for _ in range(40):                      # let every runnable task run to its next wait
                await self.yield0(0)
            if main.done():
                return
            while self.heap:
                t, _n, fut = self._pop(self.heap)
                if not fut.done():
                    self.now = max(self.now, t)
                    fut.set_result(None)
                    break
        raise AssertionError("the virtual clock ran away")


def _fake_ble(vt, deaths=1, hook=None):
    """A stand-in for `brx_mcp.ble`: records every connect and send with its virtual time (`log.times`), pays
    each send's reply window in virtual time, and serves events by `since_seq`. `deaths` is a number (one
    `$HP,0` every second, the first half a second after the first poll) or a list of offsets in seconds from
    the first poll. `hook(alias, cmd)` may raise, to fail a write."""
    import types
    log = types.SimpleNamespace(sent=[], connects=[], disconnects=[], times=[])
    offsets = [0.5 + k for k in range(deaths)] if isinstance(deaths, int) else list(deaths)

    class Mgr:
        def __init__(self):
            self.sessions = {}
            self._first = {}

        def _visible(self, alias):
            t0 = self._first.get(alias)
            if t0 is None:
                return []
            return [{"seq": k + 1, "direction": "rx", "raw": "$HP,0,0,0,*", "t_ms": 1, "parsed": {}}
                    for k, off in enumerate(offsets) if vt.now >= t0 + off]

        async def connect(self, addr, alias):
            log.connects.append(alias)
            mgr = self

            class Session:
                @property
                def seq(self):              # live, as in ble.py: the newest event so far, polled or not
                    return len(mgr._visible(alias))
            self.sessions[alias] = Session()

        async def send(self, alias, cmd, reply_window_ms=0):
            log.sent.append((alias, cmd))
            log.times.append(vt.now)
            if hook:
                hook(alias, cmd)
            if reply_window_ms:
                await vt.sleep(reply_window_ms / 1000)
            return {"replies_within_window": []}

        def get_events(self, alias, since_seq=0):
            self._first.setdefault(alias, vt.now)
            vis = self._visible(alias)
            return {"events": [e for e in vis if e["seq"] > since_seq]}

        async def disconnect(self, alias):
            log.disconnects.append(alias)

    mod = types.ModuleType("brx_mcp.ble")
    mod.ConnectionManager = Mgr
    return mod, log


def _run_cli_game(coro_fn, deaths=1, out=None, hook=None):
    """Run a CLI coroutine against the fake manager on virtual time (see `_VirtualTime`)."""
    import asyncio
    import sys
    import types
    vt = _VirtualTime()
    vt.yield0 = cli.asyncio.sleep                     # the real sleep, for yielding only
    mod, log = _fake_ble(vt, deaths, hook)
    if out is not None:
        out["log"] = log
    real_mod = sys.modules.get("brx_mcp.ble")
    real_time, real_sleep = cli.time, cli.asyncio.sleep
    cli.time = types.SimpleNamespace(monotonic=lambda: vt.now, sleep=lambda s: None)
    cli.asyncio.sleep = vt.sleep

    async def main():
        task = asyncio.ensure_future(coro_fn())
        driver = asyncio.ensure_future(vt.drive(task))
        try:
            await asyncio.gather(task, driver)
        finally:
            driver.cancel()

    sys.modules["brx_mcp.ble"] = mod
    buf = io.StringIO()
    try:
        with contextlib.redirect_stderr(buf), contextlib.redirect_stdout(io.StringIO()):
            asyncio.run(main())
    finally:
        log.err = buf.getvalue()
        cli.time, cli.asyncio.sleep = real_time, real_sleep
        if real_mod is None:
            sys.modules.pop("brx_mcp.ble", None)
        else:
            sys.modules["brx_mcp.ble"] = real_mod
    return log, log.err
