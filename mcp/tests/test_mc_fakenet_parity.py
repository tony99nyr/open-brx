"""F506: FakeNet answers a hello the way net.py does, where Session can see the answer.

One script runs against the real NetServer (over a socket, with MockNode) and against FakeNet. Both must give the same
observations: the A8 keyless-hello refusal, `seq_hi` in the node callback, `seq_reset` after a storage reset, and
`push` on a node with no socket. The live half needs `websockets` and skips cleanly without it."""
from __future__ import annotations

from _async import until
from _net_harness import NetHarness, net_until, run_net
from _session import mk_online_session
from _skip import needs

from brx_mcp.mc.fakes import FakeNet

try:
    import websockets  # noqa: F401
    HAVE_WS = True
except ImportError:  # system python
    HAVE_WS = False


def _hello_view(info: dict | None) -> tuple:
    """What Session reads from one hello's node callback; None is a refused hello."""
    if info is None:
        return ("refused",)
    return ("accepted", info.get("seq_hi"), bool(info.get("seq_reset")))


# The script both servers run: (step, expected observation).
EXPECTED = [
    ("first hello", ("accepted", 0, False)),
    ("keyless hello a beat after a disconnect", ("refused",)),
    ("keyed reconnect after three facts", ("accepted", 3, False)),
    ("keyless hello with seq_next 1 once stale", ("accepted", 3, True)),
    ("the old key after that keyless takeover rotated it", ("refused",)),
    ("push with no socket", False),
    ("push to a node that never said hello", False),
    ("fresh gun holder", ("accepted", 0, False)),
    ("different id without holder key", ("refused",)),
    ("different gun name with holder's tail", ("refused",)),
    ("tail-only claim of fresh holder", ("refused",)),
    ("keyless hot-swap after holder goes stale", ("accepted", 0, False)),
    ("stale holder key recorded on displacer", True),
    ("returning owner against fresh displacer", ("refused",)),
    ("returning owner after displacer goes stale", ("accepted", 0, False)),
    ("returning owner records no displaced key", True),
    ("displacer's key against fresh returned owner", ("refused",)),
    ("new id proves fresh holder's key", ("accepted", 0, False)),
]


def _fake_script() -> list:
    net = FakeNet()
    infos: list[dict] = []
    net.on_node(infos.append)

    def hello(**kw):
        n = len(infos)
        net.simulate_hello("n1", "GUN-A-3D4F", **kw)
        return infos[-1] if len(infos) > n else None

    out = [hello()]
    old_key = net.nodes["n1"].node_key
    for seq in (1, 2, 3):
        net.simulate_event("n1", {"type": "hit_taken"}, 0, seq=seq)
    net.simulate_disconnect("n1")
    out.append(hello(node_key=""))
    out.append(hello())
    net.simulate_disconnect("n1")
    net.simulate_stale("n1", 60_000)
    out.append(hello(node_key="", seq_next=1))
    net.simulate_disconnect("n1")
    out.append(hello(node_key=old_key))
    result = [_hello_view(i) for i in out] + [net.push("n1", "control", {"cmd": "end"}),
                                               net.push("n9", "control", {"cmd": "end"})]
    net.resolve_gun(lambda name, tail: "player-x" if tail == "AB12" else None)

    def gun_hello(node_id, gun, **kw):
        n = len(infos)
        net.simulate_hello(node_id, gun, **kw)
        return _hello_view(infos[-1] if len(infos) > n else None)

    result.append(gun_hello("owner", "GUN-X-AB12"))
    net.nodes["owner"].player_id = "player-x"
    owner_key = net.nodes["owner"].node_key
    net.simulate_disconnect("owner")
    result.append(gun_hello("swap", "GUN-X-AB12", node_key=""))
    result.append(gun_hello("variant", "GUN-OTHER-AB12", node_key=""))
    result.append(gun_hello("tail-only", "", gun_tail="AB12", node_key=""))
    net.simulate_stale("owner", 60_000)
    result.append(gun_hello("swap", "GUN-X-AB12", node_key=""))
    swap_key = net.nodes["swap"].node_key
    result.append(owner_key in getattr(net.nodes["swap"], "displaced_keys", set()))
    result.append(gun_hello("owner", "GUN-X-AB12", node_key=owner_key))
    net.simulate_disconnect("swap")
    net.simulate_stale("swap", 60_000)
    result.append(gun_hello("owner", "GUN-X-AB12", node_key=owner_key))
    result.append(getattr(net.nodes["owner"], "displaced_keys", None) == set())
    result.append(gun_hello("swap", "GUN-X-AB12", node_key=swap_key))
    result.append(gun_hello("proved", "GUN-X-AB12", node_key=owner_key))
    return result


def _live_script() -> list:
    from brx_mcp.mc.mock_node import MockNode

    async def go():
        async with NetHarness() as h:
            h.net.resolve_gun(lambda name, tail: "player-x" if tail == "AB12" else None)
            out = []

            async def hello(node):
                n, rejected = len(h.nodes), h.net.stats["rejected"]
                await node.start()
                await until(lambda: len(h.nodes) > n or h.net.stats["rejected"] > rejected, what="hello answered")
                return h.nodes[n] if len(h.nodes) > n else None

            a = MockNode(h.url, node_id="n1", heartbeat_ms=100)
            out.append(await hello(a))
            await a.wait_connected()
            a.arm_state, a.alive, a.match_id = "live", True, "m1"
            for _ in range(3):
                a.take_hit(19, 2, 9)
            assert await net_until(lambda: h.net.nodes["n1"].seq_hi == 3)
            key = a.node_key
            await a.close()
            await until(lambda: h.net.nodes["n1"].ws is None, what="n1 disconnected")
            rogue = MockNode(h.url, node_id="n1", heartbeat_ms=100)
            out.append(await hello(rogue))
            await rogue.close()
            back = MockNode(h.url, node_id="n1", heartbeat_ms=100)
            back.node_key, back.seq_next = key, 4
            out.append(await hello(back))
            await back.close()
            await until(lambda: h.net.nodes["n1"].ws is None, what="n1 disconnected again")
            h.net.stale_after_ms = 300
            await until(lambda: not h.net._fresh(h.net.nodes["n1"]), what="n1 becomes stale")
            wiped = MockNode(h.url, node_id="n1", heartbeat_ms=100)
            out.append(await hello(wiped))
            await wiped.close()
            await until(lambda: h.net.nodes["n1"].ws is None, what="n1 disconnected a third time")
            h.net.stale_after_ms = 60_000
            old = MockNode(h.url, node_id="n1", heartbeat_ms=100)
            old.node_key = key
            out.append(await hello(old))
            await old.close()
            result = [_hello_view(i) for i in out] + [h.net.push("n1", "control", {"cmd": "end"}),
                                                       h.net.push("n9", "control", {"cmd": "end"})]

            async def gun_hello(node_id, key="", gun="GUN-X-AB12", tail="AB12"):
                import asyncio
                import json
                from websockets.asyncio.client import connect
                from websockets.exceptions import ConnectionClosed
                from brx_mcp.mc import envelope as E
                ws = await connect(h.url)
                n = len(h.nodes)
                body = {"node_id": node_id, "node_type": "phone", "app_ver": "x", "seq_next": 1,
                        "gun": {"name": gun, "tail": tail}}
                if key:
                    body["node_key"] = key
                await ws.send(E.encode(E.make_envelope("hello", body)))
                try:
                    msg = json.loads(await asyncio.wait_for(ws.recv(), 2))
                    assert await net_until(lambda: len(h.nodes) > n)
                    return _hello_view(h.nodes[n]), msg["body"].get("node_key"), ws
                except ConnectionClosed as exc:
                    assert exc.rcvd and exc.rcvd.code == 4003 and exc.rcvd.reason == "gun in use"
                    return ("refused",), None, ws

            view, owner_key, owner_ws = await gun_hello("owner")
            result.append(view)
            h.net.nodes["owner"].player_id = "player-x"
            await owner_ws.close()
            await until(lambda: h.net.nodes["owner"].ws is None, what="owner disconnected")
            view, _, rejected_ws = await gun_hello("swap")
            result.append(view)
            await rejected_ws.close()
            view, _, rejected_ws = await gun_hello("variant", gun="GUN-OTHER-AB12")
            result.append(view)
            await rejected_ws.close()
            view, _, rejected_ws = await gun_hello("tail-only", gun="")
            result.append(view)
            await rejected_ws.close()
            h.net.nodes["owner"].last_seen = -1e9
            view, swap_key, swap_ws = await gun_hello("swap")
            result.append(view)
            result.append(owner_key in h.net.nodes["swap"].displaced_keys)
            view, _, rejected_ws = await gun_hello("owner", owner_key)
            result.append(view)
            await rejected_ws.close()
            await swap_ws.close()
            await until(lambda: h.net.nodes["swap"].ws is None, what="swap disconnected")
            h.net.nodes["swap"].last_seen = -1e9
            view, _, returned_ws = await gun_hello("owner", owner_key)
            result.append(view)
            result.append(h.net.nodes["owner"].displaced_keys == set())
            view, _, rejected_ws = await gun_hello("swap", swap_key)
            result.append(view)
            await rejected_ws.close()
            view, _, proved_ws = await gun_hello("proved", owner_key)
            result.append(view)
            await proved_ws.close()
            await returned_ws.close()
            return result
    return run_net(go())


def test_f506_the_fake_and_the_real_server_answer_the_same_hello_script():
    assert _fake_script() == [e for _, e in EXPECTED], "FakeNet"
    needs(HAVE_WS, "websockets")
    assert _live_script() == [e for _, e in EXPECTED], "net.py"


def test_f506_a_keyless_hello_after_a_disconnect_never_reaches_session():
    s, net, clock, ps = mk_online_session(2)
    hydrated = []
    real = net._hydrate
    net.hydrate(lambda hello: hydrated.append(hello) or real(hello))
    net.simulate_disconnect("node0")
    assert net.simulate_hello("node0", "GUN-A", node_key="") is None
    assert hydrated == [] and net.nodes["node0"].ws is None
    assert net.simulate_hello("node0", "GUN-A") is not None, "the phone's own key reclaims its node"
    assert len(hydrated) == 1 and net.nodes["node0"].ws is not None


def test_f506_session_drops_the_seq_anchor_on_a_fresh_process_and_a_storage_reset_only():
    s, net, clock, ps = mk_online_session(1)
    drops = []
    s.clock_watch.drop_seq = drops.append
    net.simulate_disconnect("node0")
    net.simulate_hello("node0", "GUN-A")
    assert drops == ["node0"], "seq_hi 0: this process has never stored a fact from node0"
    assert s._node_seq_hi("node0") == 0
    net.simulate_event("node0", {"type": "hit_taken"}, clock["t"], seq=5)
    assert s._node_seq_hi("node0") == 5
    net.simulate_disconnect("node0")
    net.simulate_hello("node0", "GUN-A")
    assert drops == ["node0"], "a keyed reconnect that resumes its counter keeps the anchor"
    net.simulate_disconnect("node0")
    net.simulate_hello("node0", "GUN-A", seq_next=1)
    assert drops == ["node0", "node0"], "a restarted counter drops it"


def test_f506_an_evicted_node_stays_stale_and_its_old_key_reclaims_nothing():
    """net.py `evict`: the record is stale at once and its key rotates. A frame cannot arrive with no socket, so a
    late simulated status must not make the record fresh again."""
    net = FakeNet()
    net.simulate_hello("n1", "GUN-A-3D4F")
    old_key = net.nodes["n1"].node_key
    assert net.evict("n1")
    net.simulate_status("n1", {"arm_state": "kitted"}, 0)
    assert net.nodes["n1"].fresh is False
    assert net.nodes["n1"].node_key != old_key
    infos: list[dict] = []
    net.on_node(infos.append)
    net.simulate_hello("n1", "GUN-A-3D4F", node_key="")
    assert len(infos) == 1 and net.nodes["n1"].ws is not None, "a keyless hello takes a stale record"


def test_f506_a_replayed_seq_never_reaches_session():
    """net.py `_ingest` drops a fact whose seq it already applied, before any callback."""
    net = FakeNet()
    got = []
    net.on_event(lambda nid, ev, t: got.append(ev["seq"]))
    net.simulate_hello("n1", "GUN-A-3D4F")
    for seq in (1, 2, 2, 1, 3):
        net.simulate_event("n1", {"type": "hit_taken"}, 0, seq=seq)
    assert got == [1, 2, 3]


def test_f506_the_demo_never_answers_a_control_that_had_no_socket():
    from brx_mcp.mc.fakes import DemoDriver
    s, net, clock, ps = mk_online_session(1)
    net.simulate_disconnect("node0")
    assert net.push("node0", "control", {"cmd": "relink", "player_id": ps[0]["player_id"]}) is False
    demo = DemoDriver(s, net, n=1)
    demo.nodes.append({"node_id": "node0", "player_id": ps[0]["player_id"], "alive": True, "seq": 1})
    demo._answer_operator(clock["t"], "live")
    assert not net.pushes("control")[-1][2].get("_answered")


def test_f506_batches_and_old_seqs_are_deduplicated_as_net_py_does():
    net = FakeNet()
    got = []
    net.on_batch(lambda nid, evs, t: got.append([e["seq"] for e in evs]))
    net.on_event(lambda nid, ev, t: got.append(ev["seq"]))
    net.simulate_hello("n1", "GUN-A-3D4F")
    net.simulate_batch("n1", [{"type": "hit_taken", "seq": 1}, {"type": "hit_taken", "seq": 2}], 0)
    net.simulate_batch("n1", [{"type": "hit_taken", "seq": 2}, {"type": "hit_taken", "seq": 3}], 0)
    net.simulate_batch("n1", [{"type": "hit_taken", "seq": 1}], 0)
    net.simulate_batch("n1", [{"type": "hit_taken", "seq": 300}, {"type": "hit_taken", "seq": 4}], 0)   # 4 is judged after 300
    net.simulate_event("n1", {"type": "hit_taken"}, 0, seq=50)     # inside the 256-seq reorder window
    net.simulate_event("n1", {"type": "hit_taken"}, 0, seq=40)     # below it
    assert got == [[1, 2], [3], [300], 50]


def test_f506_the_demo_never_answers_a_control_that_failed_even_after_a_reconnect():
    from brx_mcp.mc.fakes import DemoDriver
    s, net, clock, ps = mk_online_session(1)
    net.simulate_disconnect("node0")
    assert net.push("node0", "control", {"cmd": "relink", "player_id": ps[0]["player_id"]}) is False
    net.simulate_hello("node0", "GUN-A")
    demo = DemoDriver(s, net, n=1)
    demo.nodes.append({"node_id": "node0", "player_id": ps[0]["player_id"], "alive": True, "seq": 1})
    demo._answer_operator(clock["t"], "live")
    assert not net.pushes("control")[-1][2].get("_answered")
