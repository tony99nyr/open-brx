"""Phone and station stand-ins over the real wire, for `vqa2.mjs` (MC visual QA round 2, 2026-09-24).

The `--fake-net` demo cannot say hello as a utility station from outside the process, and it cannot make a
phone report `pool_stale`. This script runs both against a real `python -m brx_mcp.mc --demo` on its real
node socket, and takes commands on stdin, one per line:

    set <name> key=value [key=value ...]   # a station: report fields (battery=20, assoc=muster)
                                           # a phone: extra status fields (pool_stale=pool_wrong, pool_stale=none)
    die <gun> <shooter_num> <shooter_tid>  # this gun's player is killed by that shooter
    quit

    python vqa2_nodes.py ws://127.0.0.1:PORT/ws phone:GUN-A:3D4F util:util-e2e-1:android

It prints `ready <name> <node_id>` for each node once MC has welcomed it, then `ok <cmd> <name>` or
`err <why>` for each command, so the browser suite waits on a line and never on a sleep.

A station stand-in behaves like `app/src/utility.js`: it says hello as `node_type: "utility"`, sends the
utility heartbeat (`role: "utility"`, what it is and whether it is armed) every second, and applies a
`station_config` push the way the phone does (its kind, team, id and `armed` follow MC's arming).
"""
from __future__ import annotations

import asyncio
import contextlib
import sys
import uuid

import websockets

from brx_mcp.mc import envelope as E
from brx_mcp.mc.fakes import fake_app_ver
from brx_mcp.mc.mock_node import MockNode


class Phone(MockNode):
    """A MockNode whose heartbeat carries `extra` (the fields this suite sets)."""

    def __init__(self, *a, **kw):
        super().__init__(*a, **kw)
        self.extra: dict = {}

    def status_body(self) -> dict:
        return {**super().status_body(), **self.extra}


class Station:
    """A utility station on MC's node socket (utility.js `connectMc` + `utilityStatusBody`)."""

    def __init__(self, url: str, node_id: str, platform: str):
        self.url, self.node_id, self.platform = url, node_id, platform
        self.report: dict = {"kind": "respawn", "team": 255, "station_id": 0, "threshold": -70 if platform != "esp32" else -57,
                             "live": False, "revives": 0, "armed": False, "battery": 80, "uptime_s": 1, "boot_count": 1}
        self.configs: list[dict] = []
        self.welcomed = asyncio.Event()
        self._task: asyncio.Task | None = None

    async def start(self) -> None:
        self._task = asyncio.create_task(self._run())

    def _status(self) -> dict:
        return {"node_id": self.node_id, "arm_state": "idle", "synced": False, "role": "utility",
                "app_ver": fake_app_ver(), "platform": self.platform, **self.report}

    async def _run(self) -> None:
        async with websockets.connect(self.url) as ws:
            await ws.send(E.encode(E.make_envelope("hello", {
                "node_id": self.node_id, "node_type": "utility", "app_ver": fake_app_ver(),
                "platform": self.platform, "seq_next": 1})))
            env = E.decode(await asyncio.wait_for(ws.recv(), 5), direction="mc")
            if env["kind"] != "welcome":
                raise RuntimeError(f"expected welcome, got {env['kind']}")
            self.welcomed.set()

            async def beat():
                while True:
                    self.report["uptime_s"] = self.report.get("uptime_s", 0) + 1
                    await ws.send(E.encode(E.make_envelope("status", self._status())))
                    await asyncio.sleep(1.0)
            hb = asyncio.create_task(beat())
            try:
                async for raw in ws:
                    env = E.decode(raw, direction="mc")
                    if env["kind"] == "station_config":
                        b = env["body"]
                        self.configs.append(b)
                        self.report.update(kind=b.get("kind"), team=b.get("team"), station_id=b.get("id"), armed=True, live=True)
                        if b.get("threshold"):
                            self.report["threshold"] = b["threshold"]
                        await ws.send(E.encode(E.make_envelope("status", self._status())))
            finally:
                hb.cancel()

    async def close(self) -> None:
        if self._task:
            self._task.cancel()
            with contextlib.suppress(BaseException):
                await self._task


def _value(v: str):
    if v == "none":
        return None
    with contextlib.suppress(ValueError):
        return int(v)
    return v


async def main(url: str, specs: list[str]) -> None:
    phones: dict[str, Phone] = {}
    stations: dict[str, Station] = {}
    for spec in specs:
        kind, name, tail = (spec.split(":") + ["", ""])[:3]
        if kind == "phone":
            n = Phone(url, gun_name=name, gun_tail=tail or "3D4F", gun_echo="$LCD,45,70,0,0,36,216,*", app_ver=fake_app_ver())
            phones[name] = n
            await n.start()
        elif kind == "util":
            st = Station(url, name or f"util-e2e-{uuid.uuid4().hex[:6]}", tail or "android")
            stations[st.node_id] = st
            await st.start()
        else:
            raise SystemExit(f"unknown spec {spec!r}")
    for name, n in phones.items():
        await n.wait_connected(10)
        print(f"ready {name} {n.node_id}", flush=True)
    for name, st in stations.items():
        await asyncio.wait_for(st.welcomed.wait(), 10)
        print(f"ready {name} {st.node_id}", flush=True)
    loop = asyncio.get_running_loop()
    try:
        while True:
            line = await loop.run_in_executor(None, sys.stdin.readline)
            if not line:
                break
            parts = line.split()
            if not parts:
                continue
            cmd, args = parts[0], parts[1:]
            try:
                if cmd == "quit":
                    break
                name = args[0]
                if cmd == "set":
                    kv = {k: _value(v) for k, v in (a.split("=", 1) for a in args[1:])}
                    if name in stations:
                        stations[name].report.update({k: v for k, v in kv.items() if v is not None})
                        for k, v in kv.items():
                            if v is None:
                                stations[name].report.pop(k, None)
                    else:
                        ph = phones[name]
                        for k, v in kv.items():
                            if v is None:
                                ph.extra.pop(k, None)
                            else:
                                ph.extra[k] = v
                elif cmd == "die":
                    phones[name].die(int(args[1]), int(args[2]))
                else:
                    raise RuntimeError(f"unknown command {cmd}")
                print(f"ok {cmd} {name}", flush=True)
            except Exception as e:  # noqa: BLE001 - reported on stdout for the suite to fail on
                print(f"err {cmd} {e!r}", flush=True)
    finally:
        for n in phones.values():
            await n.close()
        for st in stations.values():
            await st.close()


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1], sys.argv[2:]))
