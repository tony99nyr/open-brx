"""The real MC stack in one process, for chaos testing and the e2e scenario tests.

`Stack` is the REAL Session + NetServer + Compiler on an ephemeral port, driven by real MockNodes
over a real WebSocket. It moved here from `tests/e2e_util.py` (which re-exports it) so the chaos CLI
can use it outside the test runner.

`ChaosStack` adds what a chaos run needs on top: a real session store (so an MC restart can rebuild
the scorer from the stored facts), a session snapshot file, an MC clock offset (so a run can reach a
time limit without waiting for it), and `restart_mc()`, which replaces the Session and the NetServer
the way a new MC process does.

Needs `websockets`. Import it only after checking (see `tests/e2e_util.py`).
"""
from __future__ import annotations

import asyncio
import pathlib
import time

from ..mc.compile import Compiler
from ..mc.mock_node import MockNode
from ..mc.net import NetServer
from ..mc.state import Session
from ..mc.store import Store

# A healthy configured-gun echo (headset proven); None = headset off / gun asleep.
GUN_ECHO = "$LCD,45,70,0,0,36,216,*"


async def until(pred, timeout=6.0, step=0.02):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if pred():
            return True
        await asyncio.sleep(step)
    return pred()


class FakeArmory:
    """No enrolled guns: nodes self-identify, and binding is by gun_id == gun_name (state._find_player_for_gun)."""
    def list(self):
        return []

    async def scan(self, duration_s: int = 6):
        return []


_FakeArmory = FakeArmory     # the old private name, still imported by some tests


class Stack:
    """Real Session + NetServer + Compiler on an ephemeral port. `async with Stack() as s: ...`."""

    node_cls: type = MockNode

    def __init__(self, mode: str = "tdm", time_limit_s: int = 30, **cfg):
        self.net = NetServer()
        self.session = self._make_session(self.net)
        self._mode = mode
        self._time_limit_s = time_limit_s
        self._cfg = cfg
        self.nodes: list = []

    def _make_session(self, net) -> Session:
        return Session(Compiler(), net, FakeArmory())

    async def __aenter__(self):
        await self.net.start("127.0.0.1", 0, "/ws", advertise_host="127.0.0.1")
        self.url = self.net.join_info()["url"]
        patch = {"mode": self._mode, "time_limit_s": self._time_limit_s}
        patch.update(self._cfg)
        self.session.set_config(patch)
        return self

    async def __aexit__(self, *a):
        for n in self.nodes:
            await n.close()
        await self.net.stop()

    # -- driving helpers ---------------------------------------------------
    def add_player(self, display: str, gun: str, team_id: str | None = None, **kw):
        return self.session.add_player(display, team_id=team_id, gun_id=gun, **kw)

    async def connect_node(self, gun: str, *, gun_echo: str | None = GUN_ECHO,
                           node_id: str | None = None, heartbeat_ms: int = 40, **kw) -> MockNode:
        node = self.node_cls(self.url, node_id=node_id, gun_name=gun, gun_tail=gun.rsplit("-", 1)[-1],
                             gun_echo=gun_echo, heartbeat_ms=heartbeat_ms, backoff_cap_s=0.2, **kw)
        self.nodes.append(node)
        await node.start()
        await node.wait_connected()
        return node

    async def wait_ready(self, timeout=6.0) -> bool:
        """Every node bound + synced + a green readiness row → go."""
        return await until(lambda: self.session.readiness()["go"], timeout=timeout)

    async def push_and_start(self, runway_s: int = 1):
        self.session.push_config()
        assert await until(self.session.all_acked, 6.0), "not all nodes acked the config"
        info = self.session.start(runway_s=runway_s)
        return info

    async def wait_live(self, timeout=6.0) -> bool:
        return await until(lambda: all(n.arm_state == "live" and n.alive for n in self.nodes), timeout=timeout)


class ChaosStack(Stack):
    """A `Stack` with a store, a snapshot file, an MC clock offset and an MC restart.

    `workdir` must be a folder that belongs to this run only (parallel safety): the store files and
    `session.json` go there."""

    def __init__(self, mode: str, time_limit_s: int, workdir: pathlib.Path, **cfg):
        self.workdir = pathlib.Path(workdir)
        self.workdir.mkdir(parents=True, exist_ok=True)
        self.mc_skew_ms = 0          # added to MC's clock only; the nodes keep real time
        self.generation = 0          # how many MC processes this run has had (0 = the first)
        self.sessions: list[Session] = []
        super().__init__(mode, time_limit_s, **cfg)

    def mc_now(self) -> int:
        return int(time.time() * 1000) + self.mc_skew_ms

    def _make_session(self, net) -> Session:
        store = Store(f"chaos{self.generation}", self.workdir / f"store-{self.generation}.sqlite")
        s = Session(Compiler(), net, FakeArmory(), store=store, now_ms=self.mc_now)
        s._persist_path = self.workdir / "session.json"
        self.sessions.append(s)
        return s

    def snapshot_now(self) -> None:
        """Write session.json now, past the 2 s debounce (what a process writes on its last change)."""
        self.session._persist_last = 0.0
        self.session._persist_dirty = True
        self.session._persist()

    async def restart_mc(self, *, crash: bool = False, on_session=None) -> str | None:
        """Stop this MC (socket server down, every node link drops) and start a new one from the snapshot.

        Mirrors `__main__`: a new NetServer, a new store FILE, `restore_snapshot()`, then
        `resume_match()` once the store is attached. The nodes keep running and reconnect to the new
        URL on their own backoff. Returns the phase the new MC resumed into (None = nothing resumed).

        `crash=False` is a clean stop: the last snapshot write is flushed past its 2 s debounce, as
        `atexit` does. `crash=True` skips that flush, so the new MC reads whatever the old one last wrote.
        `on_session(session)` runs on the new Session before it resumes (to hook it)."""
        if not crash:
            self.snapshot_now()
        old_net, old_session = self.net, self.session
        await old_net.stop()
        if old_session.store is not None:
            old_session.store.close()
        self.generation += 1
        self.net = NetServer()
        self.session = self._make_session(self.net)
        if on_session is not None:
            on_session(self.session)
        self.session.restore_snapshot()
        phase = self.session.resume_match()
        await self.net.start("127.0.0.1", 0, "/ws", advertise_host="127.0.0.1")
        self.url = self.net.join_info()["url"]
        for n in self.nodes:
            n.url = self.url
        return phase

    async def __aexit__(self, *a):
        await super().__aexit__(*a)
        for s in self.sessions:
            if s.store is not None:
                s.store.close()
