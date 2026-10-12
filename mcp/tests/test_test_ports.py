"""scripts/lib/ports.mjs: the ports test-all gives its e2e jobs (F523).

WHY (2026-10-11). mc-game-edit died with `could not bind 127.0.0.1:42823 (Address already in use)`. The old picker
listened on port 0 and closed the socket, so the number came from the kernel's ephemeral range, and the kernel gave
it to another port-0 listen before MC bound it (a repro: 11 of 200 picks, with 300 port-0 listens after each). The
fix gives each job a block of ports below that range. These tests call the real module.
"""
import json
import re
from pathlib import Path

from _node import run_node_json

REPO = Path(__file__).resolve().parents[2]
PORTS = (REPO / "scripts" / "lib" / "ports.mjs").as_uri()
JOBS = (REPO / "scripts" / "lib" / "jobs.mjs").as_uri()
E2E = REPO / "webapp" / "mc" / "test" / "e2e"
RANGE = Path("/proc/sys/net/ipv4/ip_local_port_range")


def _node(body: str) -> dict:
    """`body` runs in an async function with `m` bound to ports.mjs and `net` to node:net; it returns the result."""
    expr = (f"import net from 'node:net'; const m = await import({json.dumps(PORTS)});\n"
            f"const out = await (async () => {{ {body} }})();\nconsole.log(JSON.stringify(out));")
    return run_node_json(expr, cwd=REPO)


_HOLD = ("const hold = p => new Promise((ok, no) => { const s = net.createServer(); s.once('error', no);"
         " s.listen(p, '127.0.0.1', () => ok(s)); });"
         # a free run of ports to test in: the first block of the range whose ports all bind now
         "let lo = m.PORT_LO; for (;; lo += m.BLOCK_SIZE) {"
         " let ok = true; for (let p = lo; p < lo + 2 * m.BLOCK_SIZE; p++) if (!(await m.canBind(p))) { ok = false; break; }"
         " if (ok) break; }")


def test_job_blocks_sit_below_the_ephemeral_range_and_never_share_a_port():
    out = _node("const next = m.blockAllocator(); const envs = []; for (let i = 0; i < 6; i++) envs.push(await next());"
                " return { envs, hi: m.portHi(), size: m.BLOCK_SIZE };")
    eph_lo = int(RANGE.read_text().split()[0]) if RANGE.exists() else 49152
    assert out["hi"] < eph_lo
    seen = set()
    for env in out["envs"]:
        named = [int(env[k]) for k in ("MC_PORT", "MC_WS_PORT", "VITE_PORT")]
        nxt, end = int(env["BRX_PORT_NEXT"]), int(env["BRX_PORT_END"])
        block = set(range(end - out["size"], end))
        assert set(named) <= block and len(set(named)) == 3, env
        assert nxt == named[2] + 1 and all(p < eph_lo for p in block), env
        assert not (block & seen), f"two jobs share a port block: {env}"
        seen |= block


def test_a_port_held_by_another_socket_is_skipped_and_the_job_still_gets_three():
    # The F523 test: something else holds the block's first port; the job's named ports avoid it and bind.
    out = _node(_HOLD + " const s = await hold(lo);"
                " const env = await m.blockAllocator({ lo, hi: lo + 2 * m.BLOCK_SIZE - 1, rand: () => 0 })();"
                " const binds = []; for (const k of ['MC_PORT', 'MC_WS_PORT', 'VITE_PORT']) {"
                " const t = await hold(Number(env[k])); binds.push(Number(env[k])); t.close(); }"
                " s.close(); return { lo, env, binds };")
    assert out["lo"] not in out["binds"]
    assert out["binds"] == [out["lo"] + 1, out["lo"] + 2, out["lo"] + 3]


def test_free_port_walks_the_jobs_block_skips_a_held_port_and_says_when_the_block_is_spent():
    out = _node(_HOLD + " const s = await hold(lo + 1);"
                " const env = { BRX_PORT_NEXT: String(lo), BRX_PORT_END: String(lo + 4) };"
                " const got = [await m.freePort({ env }), await m.freePort({ env }), await m.freePort({ env })];"
                " let err = ''; try { await m.freePort({ env }); } catch (e) { err = e.message; }"
                " s.close(); return { lo, got, err };")
    lo = out["lo"]
    assert out["got"] == [lo, lo + 2, lo + 3]
    assert "no free test port left" in out["err"]


def test_free_port_outside_test_all_still_returns_a_port():
    out = _node("return await m.freePort({ env: {} });")
    assert isinstance(out, int) and 0 < out < 65536


def test_every_mc_e2e_job_gets_its_ports_from_a_block():
    expr = (f"const m = await import({json.dumps(JOBS)});"
            "const jobs = m.resolveJobs({ budgetMb: 8000, cpus: 8, python: 'python3', noSkip: [], logs: '/tmp/x',"
            " ui: true, filters: [], tasks: 4000 });"
            "const out = {}; for (const j of jobs) if (j.name.startsWith('mc-') && typeof j.env === 'function')"
            " out[j.name] = Object.keys(await j.env()).sort();"
            "console.log(JSON.stringify(out));")
    out = run_node_json(expr, cwd=REPO)
    assert len(out) >= 15, out
    for name, keys in out.items():
        assert keys == ["BRX_PORT_END", "BRX_PORT_NEXT", "MC_PORT", "MC_WS_PORT", "VITE_PORT"], name


def test_no_mc_e2e_script_picks_a_port_from_the_ephemeral_range():
    # A script with its own port-0 picker brings the F523 race back for every port it picks that way.
    own = re.compile(r"const freePort\s*=|\.listen\(0\b")
    offenders = [p.relative_to(REPO).as_posix() for p in sorted(E2E.rglob("*.mjs")) if own.search(p.read_text())]
    assert not offenders, f"take freePort from scripts/lib/ports.mjs instead: {offenders}"
