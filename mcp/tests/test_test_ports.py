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
         # a free run of three blocks to test in: the first block of the range whose ports all bind now
         "let lo = m.PORT_LO; for (;; lo += m.BLOCK_SIZE) {"
         " let ok = true; for (let p = lo; p < lo + 3 * m.BLOCK_SIZE; p++) if (!(await m.canBind(p))) { ok = false; break; }"
         " if (ok) break; }"
         # a claim folder of the test's own, so the machine-wide one is never touched
         " const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');"
         " const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brx-ports-test-'));"
         " process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));"
         " const alloc = o => m.blockAllocator({ lo, hi: lo + 3 * m.BLOCK_SIZE - 1, rand: () => 0, dir, ...o });")


def _block(env: dict) -> int:
    return int(env["BRX_PORT_END"]) - 32


def test_job_blocks_sit_below_the_ephemeral_range_and_never_share_a_port():
    out = _node("const fs = await import('node:fs'); const dir = fs.mkdtempSync('/tmp/brx-ports-test-');"
                " process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));"
                " const next = m.blockAllocator({ dir });"
                " const envs = []; for (let i = 0; i < 6; i++) envs.push(await next());"
                " return { envs, hi: m.portHi(), size: m.BLOCK_SIZE };")
    eph_lo = int(RANGE.read_text().split()[0]) if RANGE.exists() else 49152
    assert out["hi"] < eph_lo and out["size"] == 32
    seen = set()
    for env in out["envs"]:
        named = [int(env[k]) for k in ("MC_PORT", "MC_WS_PORT", "VITE_PORT")]
        nxt, end = int(env["BRX_PORT_NEXT"]), int(env["BRX_PORT_END"])
        block = set(range(end - out["size"], end))
        assert set(named) <= block and len(set(named)) == 3, env
        assert nxt == named[2] + 1 and all(p < eph_lo for p in block), env
        assert not (block & seen), f"two jobs share a port block: {env}"
        seen |= block


def test_two_runs_at_once_never_get_the_same_block():
    # Both reviews (F523): the checkout lock is per checkout, so a lander gate and a lane's run allocate at the same time.
    # Two allocators that both start at the same block must still hand out different ones.
    # The probe always says free, so only the claim keeps them apart (two real probes can collide by chance).
    out = _node(_HOLD + " const probe = async () => true; const a = alloc({ probe }), b = alloc({ probe });"
                " const [ea, eb] = await Promise.all([a(), b()]);"
                " return { lo, a: ea, b: eb };")
    assert {_block(out["a"]), _block(out["b"])} == {out["lo"], out["lo"] + 32}


def test_two_processes_claiming_at_once_never_share_a_block():
    # Codex round 2: the race is between processes. Four processes each claim 12 blocks from the same start, at once;
    # the probe always says free, so only the claims keep them apart.
    out = _node(_HOLD + " const { spawn } = await import('node:child_process');"
                " const child = `const m = await import(${JSON.stringify(" + json.dumps(PORTS) + ")});"
                " const next = m.blockAllocator({ lo: ${lo}, hi: ${lo + 64 * m.BLOCK_SIZE - 1}, rand: () => 0,"
                " probe: async () => true, dir: ${JSON.stringify(dir)} });"
                " const got = []; for (let i = 0; i < 12; i++) got.push(Number((await next()).MC_PORT));"
                # a run holds its claims until it exits, so each child stays up until the parent says every one is done
                " console.log(JSON.stringify(got)); process.stdin.resume(); process.stdin.on('end', () => process.exit(0));`;"
                " const kids = [0, 1, 2, 3].map(() => spawn(process.execPath, ['--input-type=module', '-e', child]));"
                " const outs = await Promise.all(kids.map(c => new Promise(ok => { let o = '';"
                " c.stdout.on('data', d => { o += d; if (o.endsWith('\\n')) ok(o); }); c.on('exit', () => ok(o)); })));"
                " for (const c of kids) c.stdin.end();"
                " return outs.map(o => JSON.parse(o));")
    blocks = [p for got in out for p in got]
    assert len(blocks) == 48 and len(set(blocks)) == 48, sorted(blocks)


def test_a_dead_or_very_old_runs_claim_is_taken_over_and_a_live_ones_is_not():
    out = _node(_HOLD + " const f = pid => path.join(dir, `${lo}.${pid}.t.claim`);"
                " fs.writeFileSync(f(999999999), ''); const dead = await alloc()();"
                " for (const n of fs.readdirSync(dir)) fs.rmSync(path.join(dir, n));"
                " fs.writeFileSync(f(process.ppid), ''); const old = Date.now() / 1000 - 4 * 3600;"
                " fs.utimesSync(f(process.ppid), old, old); const aged = await alloc()();"
                " for (const n of fs.readdirSync(dir)) fs.rmSync(path.join(dir, n));"
                " fs.writeFileSync(f(process.ppid), ''); const live = await alloc()();"
                " return { lo, dead, aged, live };")
    assert _block(out["dead"]) == out["lo"]
    assert _block(out["aged"]) == out["lo"]
    assert _block(out["live"]) != out["lo"]


def test_a_block_with_a_port_held_by_another_socket_is_skipped():
    # The F523 test: something else holds a port of the first block; the job gets the next block, and its ports bind.
    out = _node(_HOLD + " const s = await hold(lo + 7); const env = await alloc()();"
                " const binds = []; for (const k of ['MC_PORT', 'MC_WS_PORT', 'VITE_PORT']) {"
                " const t = await hold(Number(env[k])); binds.push(Number(env[k])); t.close(); }"
                " s.close(); return { lo, env, binds };")
    lo = out["lo"]
    assert out["binds"] == [lo + 32, lo + 33, lo + 34]


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
            " out[j.name] = await j.env();"
            "console.log(JSON.stringify(out));")
    out = run_node_json(expr, cwd=REPO)
    assert len(out) >= 15, out
    for name, env in out.items():
        assert sorted(env) == ["BRX_PORT_END", "BRX_PORT_NEXT", "MC_PORT", "MC_WS_PORT", "VITE_PORT"], name
    ends = [env["BRX_PORT_END"] for env in out.values()]
    assert len(set(ends)) == len(ends), "two e2e jobs got the same port block"


def test_no_mc_e2e_script_picks_a_port_from_the_ephemeral_range():
    # A script with its own port-0 picker brings the F523 race back for every port it picks that way.
    own = re.compile(r"const freePort\s*=|\.listen\(0\b|\.listen\(\{\s*port:\s*0\b|'--port', '0'")
    offenders = [p.relative_to(REPO).as_posix() for p in sorted(E2E.rglob("*.mjs")) if own.search(p.read_text())]
    assert not offenders, f"take freePort from scripts/lib/ports.mjs instead: {offenders}"


def test_the_console_harness_finds_its_own_ports_without_the_pool():
    """A standalone `ONLY=... node test/e2e/vqa2.mjs` has no MC_PORT, MC_WS_PORT or VITE_PORT, so `ports()` must pick
    its own. brx3, 2026-10-18: mc-harness.mjs re-exported `freePort` without binding it, so this path threw
    "ReferenceError: freePort is not defined"; the gate never hit it because the pool sets the three ports."""
    harness = (E2E / "lib" / "mc-harness.mjs").as_uri()
    expr = (f"for (const k of ['MC_PORT', 'MC_WS_PORT', 'VITE_PORT']) delete process.env[k];\n"
            f"const h = await import({json.dumps(harness)});\n"
            f"const p = await h.ports();\n"
            f"console.log(JSON.stringify({{p, exported: typeof h.freePort}}));")
    out = run_node_json(expr, cwd=REPO)
    assert out["exported"] == "function", out
    assert all(isinstance(out["p"][k], int) and out["p"][k] > 0 for k in ("mc", "ws", "vite")), out
