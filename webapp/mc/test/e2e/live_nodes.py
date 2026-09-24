"""Real phone stand-ins over the real wire, for `live-board.mjs` (visual QA 2026-09-23).

The LIVE board had no browser step with a node that goes quiet and comes back, and no KOTH step with a
possession tally, because the `--fake-net` demo never reports possession and cannot be told to drop a
node from outside the process. This script runs `MockNode`s (mc/mock_node.py, the same stand-in the
server suite uses) against a real `python -m brx_mcp.mc` on its real node socket, and takes commands
on stdin, one per line:

    possession <gun> <tid>=<ms>[,<tid>=<ms>...] [observed_ms]
    drop <gun>        # walk out of range: the socket closes and the node stays quiet
    up <gun>          # walk back: it reconnects and heartbeats again
    die <gun> <shooter_num> <shooter_tid>   # this gun's player is killed by that shooter
    quit

    python live_nodes.py ws://127.0.0.1:PORT/ws GUN-A:3D4F GUN-B:3E60

It prints `ready <gun> <node_id>` for each node once MC has welcomed it, then `ok <cmd>` or
`err <why>` for each command, so the browser suite waits on a line and never on a sleep.
"""
from __future__ import annotations

import asyncio
import sys

from brx_mcp.mc.fakes import fake_app_ver
from brx_mcp.mc.mock_node import MockNode


async def main(url: str, guns: list[str]) -> None:
    nodes: dict[str, MockNode] = {}
    for spec in guns:
        name, _, tail = spec.partition(":")
        # the shipped release, not the tier floor: a loadout gun can need a newer app than x.y.0
        n = MockNode(url, gun_name=name, gun_tail=tail or "3D4F", gun_echo="$LCD,45,70,0,0,36,216,*",
                     app_ver=fake_app_ver())
        nodes[name] = n
        await n.start()
    for name, n in nodes.items():
        await n.wait_connected(10)
        print(f"ready {name} {n.node_id}", flush=True)
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
                node = nodes[args[0]]
                if cmd == "possession":
                    hold = {k: int(v) for k, v in (kv.split("=") for kv in args[1].split(","))}
                    ev = {"type": "possession", "site": "A", "hold_ms": hold, "source": "beacon"}
                    if len(args) > 2:
                        ev["observed_ms"] = int(args[2])
                    if not node.match_id:
                        raise RuntimeError("the node has no match yet")
                    node.emit(ev)
                elif cmd == "drop":
                    await node.disconnect()
                elif cmd == "die":
                    node.die(int(args[1]), int(args[2]))
                elif cmd == "up":
                    node.reconnect()
                    await node.wait_connected(10)
                else:
                    raise RuntimeError(f"unknown command {cmd}")
                print(f"ok {cmd} {args[0]}", flush=True)
            except Exception as e:  # noqa: BLE001 - reported on stdout for the suite to fail on
                print(f"err {cmd} {e!r}", flush=True)
    finally:
        for n in nodes.values():
            await n.close()


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1], sys.argv[2:]))
