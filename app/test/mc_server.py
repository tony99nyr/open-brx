"""Test helper: run the REAL NetServer on an ephemeral port; speak JSON lines on stdio.
stdout: {"port":N} first, then {"ev":"node"|"event"|"status"|"msg", ...} per callback.
stdin:  {"push":{"node_id":..., "kind":..., "body":{...}}} | {"broadcast":{"kind":..,"body":..}} | {"quit":1}
"""
import asyncio, json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "mcp"))
from brx_mcp.mc.net import NetServer  # noqa: E402

WELCOME_NODE = {"player": {"player_id": "p1", "player_num": 7, "display": "REAPER", "team_id": "blue"},
                "team": {"team_id": "blue", "name": "Blue", "color": "blue", "tid": 1},
                "roster": [{"player_id": "p1", "player_num": 7, "display": "REAPER", "team_id": "blue"}],
                "score": {"kills": 0, "deaths": 0, "shots_total": 0}}

def out(obj):
    sys.stdout.write(json.dumps(obj) + "\n"); sys.stdout.flush()

async def main():
    net = NetServer()
    net.hydrate(lambda hello: dict(WELCOME_NODE, hello_seq_next=hello.get("seq_next")))
    net.on_node(lambda n: out({"ev": "node", **n}))
    net.on_event(lambda nid, ev, t: out({"ev": "event", "node_id": nid, "seq": ev.get("seq"), "type": ev.get("type"), "match_id": ev.get("match_id"), "shooter_num": ev.get("shooter_num")}))
    net.on_status(lambda nid, b, t: out({"ev": "status", "node_id": nid, "arm_state": b.get("arm_state"), "synced": b.get("synced"), "hp": b.get("hp")}))
    net.on_node_message(lambda nid, k, b, t: out({"ev": "msg", "node_id": nid, "kind": k, "body": b}))
    await net.start("127.0.0.1", 0, "/ws")
    out({"port": net.port, "url": net.join_info()["url"]})
    loop = asyncio.get_running_loop()
    while True:
        line = await loop.run_in_executor(None, sys.stdin.readline)
        if not line: break
        try: cmd = json.loads(line)
        except ValueError: continue
        if "quit" in cmd: break
        if "push" in cmd: p = cmd["push"]; out({"ev": "pushed", "ok": net.push(p["node_id"], p["kind"], p["body"])})
        if "broadcast" in cmd: b = cmd["broadcast"]; out({"ev": "broadcast", "n": net.broadcast(b["kind"], b["body"])})
    await net.stop()

asyncio.run(main())
