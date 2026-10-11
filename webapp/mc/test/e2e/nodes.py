"""Phone and station stand-ins over the real wire, for the browser gates `live-board.mjs`, `observability.mjs` and
`vqa2.mjs` (they share `startNodes` in `lib/mc-harness.mjs`).

The `--fake-net` demo cannot drop a node from outside the process, cannot report possession, cannot say hello as a
utility station and cannot make a phone report `pool_stale`. This script runs `MockNode`s (phones) and
`UtilityNode`s (stations, the real utility heartbeat) from `brx_mcp.mc.mock_node` against a real `python -m
brx_mcp.mc` on its real node socket, and takes commands on stdin, one per line:

    possession <gun> <tid>=<ms>[,<tid>=<ms>...] [observed_ms]
    lost <gun> <n> [match_id]            # a phone's own per-match drop count (O6 `outbox_lost`); the match it plays unless named
    status <name> <key>=<int|text|none>[,...]   # extra heartbeat fields now (O6 dropped_total, O10 actions_dropped);
                                         # for a station: its report fields (station_id=4,platform=esp32). `none` removes one
    set <name> key=value [key=value ...] # the same as `status`, space separated (battery=20, assoc=muster, pool_stale=none)
    drop <gun>                           # walk out of range: the socket closes and the node stays quiet
    up <gun>                             # walk back: it reconnects and heartbeats again
    die <gun> <shooter_num> <shooter_tid> [match_id]   # this gun's player is killed by that shooter (F489: once it is live in match_id)
    slowstart <gun> <ms>                 # F489's reproduction: the phone applies MC's `start` <ms> late
    quit

    python nodes.py ws://127.0.0.1:PORT/ws phone:GUN-A:3D4F util:util-e2e-1:android

A spec is `phone:<name>:<gun tail>` or `util:<node id>:<platform>`. The script prints `ready <name> <node_id>` for
each node once MC has welcomed it, then `ok <cmd> <name>` or `err <why>` for each command, so the browser suite
waits on a line and never on a sleep. `ok` means the command's frame is on the socket (T5).
"""
from __future__ import annotations

import asyncio
import contextlib
import sys
import uuid

from brx_mcp.mc.fakes import fake_app_ver
from brx_mcp.mc.mock_node import MockNode, UtilityNode


class Phone(MockNode):
    """A MockNode that can apply MC's `start` late (`slowstart`)."""

    start_delay_ms = 0

    def _apply_start(self, body: dict) -> None:
        """Stand in for a loaded phone that reads `start` late (F489)."""
        if self.start_delay_ms:
            asyncio.get_running_loop().call_later(self.start_delay_ms / 1000, super()._apply_start, body)
        else:
            super()._apply_start(body)


def _value(v: str):
    if v == "none":
        return None
    with contextlib.suppress(ValueError):
        return int(v)
    return v


def _change(fields: dict, kv: dict) -> None:
    for k, v in kv.items():
        if v is None:
            fields.pop(k, None)
        else:
            fields[k] = v


async def main(url: str, specs: list[str]) -> None:
    phones: dict[str, Phone] = {}
    stations: dict[str, UtilityNode] = {}
    for spec in specs:
        kind, name, tail = (spec.split(":") + ["", ""])[:3]
        if kind == "phone":
            # the shipped release, not the tier floor: a loadout gun can need a newer app than x.y.0
            n = Phone(url, gun_name=name, gun_tail=tail or "3D4F", gun_echo="$LCD,45,70,0,0,36,216,*", app_ver=fake_app_ver())
            phones[name] = n
            await n.start()
        elif kind == "util":
            st = UtilityNode(url, name or f"util-e2e-{uuid.uuid4().hex[:6]}", tail or "android")
            stations[st.node_id] = st
            await st.start()
        else:
            raise SystemExit(f"unknown spec {spec!r}")
    for name, n in phones.items():
        await n.wait_connected(10)
        print(f"ready {name} {n.node_id}", flush=True)
    for name, st in stations.items():
        await st.wait_connected(10)
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
                if name in stations and cmd not in ("status", "set"):
                    raise RuntimeError(f"`{cmd}` is a phone command: {name} is a station")
                if cmd in ("status", "set"):
                    pairs = args[1].split(",") if cmd == "status" else args[1:]
                    kv = {k: _value(v) for k, v in (p.split("=", 1) for p in pairs)}
                    target = stations[name] if name in stations else phones[name]
                    _change(target.report if isinstance(target, UtilityNode) else target.extra_status, kv)
                    if not target.send_status():   # T5: the change goes out now, not on the next heartbeat
                        raise RuntimeError("the node is offline: the status went nowhere")
                    await target.flush()
                    print(f"ok {cmd} {name}", flush=True)
                    continue
                node = phones[name]
                if cmd == "possession":
                    hold = {k: int(v) for k, v in (kv.split("=") for kv in args[1].split(","))}
                    ev = {"type": "possession", "site": "A", "hold_ms": hold, "source": "beacon"}
                    if len(args) > 2:
                        ev["observed_ms"] = int(args[2])
                    if not node.match_id:
                        raise RuntimeError("the node has no match yet")
                    node.emit(ev)
                    await node.flush()   # T5: `ok` once the fact is on the socket, not queued
                elif cmd == "lost":
                    node.extra_status["outbox_lost"] = {"match_id": args[2] if len(args) > 2 else node.match_id, "n": int(args[1])}
                    if not node.send_status():   # T5: now, not on the next 2 s beat (two back-to-back `lost`s collapsed)
                        raise RuntimeError("the node is offline: the status went nowhere")
                    await node.flush()
                elif cmd == "drop":
                    await node.disconnect()
                elif cmd == "die":
                    if len(args) > 3:
                        await node.wait_live(args[3])   # F489: never a death for a match the phone is not playing yet
                    if not node.die(int(args[1]), int(args[2])):
                        raise RuntimeError("the phone is not alive: `die` sent nothing")   # F489/T5: never a silent ok
                    await node.flush()   # F458: answer `ok` once the death frame is on the socket, not queued
                elif cmd == "slowstart":
                    node.start_delay_ms = int(args[1])
                elif cmd == "up":
                    node.reconnect()
                    await node.wait_connected(10)
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
