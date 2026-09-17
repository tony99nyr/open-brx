"""Every browser gate runs in `npm run test:all`, and no gate binds a fixed port.

WHY (2026-09-17). `scripts/test-all.mjs` runs the repo's suites at once, and it can only run a gate that is in its
JOBS list. `app/tools/moments.mjs` (`npm run ui:moments`, 12 screen-truth checks) was never added, so no parallel run
executed it, and nothing said so. A gate with a fixed port has the second problem: two checkouts, or two agents,
cannot run it at the same time, and a leftover server on that port can answer for the wrong code.

The two rules:
- A script under `app/tools/` or `webapp/mc/test/e2e/` is named in scripts/test-all.mjs, or it is in NOT_GATES
  below with the reason it is not a pass/fail gate.
- A gate script does not bind or open a literal port. `process.env.X || 8792` is allowed: test-all passes the
  variable, and the default serves a person who runs the script by hand.
"""
from __future__ import annotations

import pathlib
import re

REPO = pathlib.Path(__file__).resolve().parents[2]
TEST_ALL = REPO / "scripts" / "test-all.mjs"
GATE_DIRS = [REPO / "app" / "tools", REPO / "webapp" / "mc" / "test" / "e2e"]

# Scripts in the gate folders that are not pass/fail gates. Name the reason; a gate does not belong here.
NOT_GATES = {
    "app/tools/stage.mjs": "the interactive stage harness (`npm run ui:stage`): a person drives it, nothing asserts",
    "app/tools/shots.mjs": "writes screenshots of the demo HUD for review; asserts nothing",
    "app/tools/rig.mjs": "drives a HUD against a live MC you started by hand; a screenshot rig, not a gate",
    "app/tools/scenarios.mjs": "drives scenarios against a live MC you started by hand; screenshots, not a gate",
    "webapp/mc/test/e2e/vite.m2.config.mjs": "a vite config that m2-ui.mjs loads",
    "webapp/mc/test/e2e/vite.proxy.config.mjs": "a vite config that the e2e scripts load",
}

# A literal port in a place that binds or dials it: `.listen(4187`, `127.0.0.1:4187`, `localhost:4187`.
FIXED_PORT = re.compile(r"\.listen\(\s*([1-9]\d{3,4})\b|(?:127\.0\.0\.1|localhost):([1-9]\d{3,4})\b")


def _scripts():
    for d in GATE_DIRS:
        for f in sorted(d.glob("*.mjs")):
            yield f.relative_to(REPO).as_posix(), f


def test_every_gate_script_is_registered_in_test_all():
    src = TEST_ALL.read_text()
    # app/tools gates are named by path (`tools/moments.mjs`); the webapp/mc e2e scripts by quoted stem (`'koth'`)
    def named(rel, f):
        return f"tools/{f.name}" in src if rel.startswith("app/") else f"'{f.stem}'" in src
    missing = [rel for rel, f in _scripts() if rel not in NOT_GATES and not named(rel, f)]
    assert not missing, (
        f"these gate scripts are not in scripts/test-all.mjs JOBS, so `npm run test:all -- --ui` never runs them: "
        f"{missing}. Add each one to JOBS (with its measured `mb` and `secs`), or, if it is not a pass/fail gate, "
        f"to NOT_GATES in {pathlib.Path(__file__).name} with the reason.")


def test_the_not_gates_list_names_real_files():
    """A stale exemption hides nothing today, but it would quietly exempt a new file that reuses the name."""
    gone = [rel for rel in NOT_GATES if not (REPO / rel).exists()]
    assert not gone, f"NOT_GATES names files that no longer exist: {gone}"


def test_gate_scripts_bind_no_fixed_port():
    offenders = []
    for rel, f in _scripts():
        if rel in NOT_GATES:
            continue
        for n, line in enumerate(f.read_text().splitlines(), 1):
            if line.lstrip().startswith("//"):
                continue
            if FIXED_PORT.search(line):
                offenders.append(f"{rel}:{n}: {line.strip()[:100]}")
    assert not offenders, (
        "gate scripts bind or dial a literal port, so two runs cannot share the machine. Listen on port 0 and read "
        "`server.address().port`, or read the port from an env var that test-all sets:\n  " + "\n  ".join(offenders))


def test_the_guard_can_fail():
    """Control: the port pattern matches the shapes it exists to catch, and passes the allowed default form."""
    assert FIXED_PORT.search("}).listen(4187);")
    assert FIXED_PORT.search("await page.goto('http://127.0.0.1:4187/?demo');")
    assert FIXED_PORT.search("const MC = 'http://localhost:8865';")
    assert not FIXED_PORT.search("const MC_PORT = Number(process.env.MC_PORT || 8792);")
    assert not FIXED_PORT.search("srv.listen(0, '127.0.0.1', r)")
    assert not FIXED_PORT.search("await page.goto(`http://127.0.0.1:${PORT}/?demo`);")
