"""A11 stage 1: scripts/land.mjs's command line and flake ledger as lib modules (lib/land-cli.mjs, lib/land-flakes.mjs).

WHY. land.mjs was about 1550 lines (the 2026-10-10 tooling review). These parts are pure or take their file as an
argument, so these tests drive them directly; test_land.py still runs the real lander against a bare remote.
"""
import datetime as dt
import json
import tempfile
from pathlib import Path

from _node import run_node_json

REPO = Path(__file__).resolve().parents[2]
LIB = REPO / "scripts" / "lib"


def _node(body: str, mod: str):
    return run_node_json(f"const m = await import({json.dumps((LIB / f'{mod}.mjs').as_uri())});\n"
                         f"console.log(JSON.stringify(await (async () => {{ {body} }})()));", cwd=REPO)


def test_number_options_refuse_a_bad_value_instead_of_using_the_default():
    got = _node("const n = (argv, ...a) => m.parseLandArgs(argv).numberOpt(...a);"
                " return [n(['wait', 'x'], '--timeout-min', 60, 0, 1e6, true), n(['wait', 'x', '--timeout-min', '0'], '--timeout-min', 60, 0, 1e6, true),"
                " n(['wait', 'x', '--timeout-min', 'abc'], '--timeout-min', 60), n(['run', '--batch'], '--batch', 4, 1, 50),"
                " n(['run', '--batch', '0'], '--batch', 4, 1, 50), n(['wait', 'x', '--timeout-min', '1e308'], '--timeout-min', 60)];", "land-cli")
    assert got[0] == {"value": 60} and got[1] == {"value": 0}
    assert got[2] == {"error": '--timeout-min needs a number above 0, at most 1000000 (got "abc")'}
    assert got[3] == {"error": "--batch needs a number, 1 or more, at most 50 (got nothing)"}
    assert "error" in got[4] and "error" in got[5]


def test_positionals_skip_the_values_of_valued_flags():
    got = _node("return m.parseLandArgs(['submit', '--owner', 'brx2', '--note', 'a note', 'stray']).positional;", "land-cli")
    assert got == ["stray"]


def test_check_flags_names_the_typo_the_other_commands_flag_and_extra_ids():
    got = _node("const c = argv => m.checkFlags(argv, argv[0], m.parseLandArgs(argv).positional);"
                " return [c(['wait', 'x', '--timeout', '5']), c(['wait', 'x', '--dry-run']), c(['run', '--batch', '--dryrun']),"
                " c(['submit', '--owner', 'b', '--note', '--not-a-flag']), c(['wait', 'a', 'b']), c(['wait', 'x', '\\u2014timeout-min', '5']),"
                " c(['status', '--no-drive'])];", "land-cli")
    assert got[0] == "unknown flag --timeout; did you mean --timeout-min?"
    assert got[1] == "wait does not take --dry-run"
    assert got[2] == "unknown flag --dryrun; did you mean --dry-run?"   # a number value never hides a typo
    assert got[3] is None                                                # a free-text value may start with --
    assert got[4] == "wait takes 1 id; unexpected b"
    assert got[5] == "unknown flag —timeout-min; did you mean --timeout-min?"
    assert got[6] is None


def _iso(minutes_ago: float) -> str:
    return (dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=minutes_ago)).isoformat()


def test_the_flake_ledger_counts_the_last_day_outside_incidents_and_load():
    rows = [{"job": "mc-koth", "time": _iso(60)}, {"job": "mc-koth", "time": _iso(30), "outside_load": True},
            {"job": "mc-koth", "time": _iso(25 * 60)}, {"job": "mc-koth", "time": _iso(-30)},   # too old; in the future
            {"job": "mc-koth", "time": _iso(200)}, {"incident": {"from": _iso(210), "to": _iso(190), "note": "n"}, "time": _iso(1)},
            {"job": "mcp", "time": _iso(10), "exit": 1}]
    with tempfile.TemporaryDirectory() as d:
        f = Path(d) / "state" / "flakes.jsonl"
        f.parent.mkdir()
        f.write_text("".join(json.dumps(r) + "\n" for r in rows) + "not json\n")
        got = _node(f"const l = m.createFlakeLedger({json.dumps(str(f))});"
                    " const before = [l.counted('mc-koth'), l.counted('mcp'), l.counted('mc-koth', Date.now() - 200 * 60000)];"
                    " l.record({ job: 'mcp', exit: 2 });"
                    " const fresh = m.createFlakeLedger(" + json.dumps(str(Path(d) / "new-state" / "flakes.jsonl")) + ");"
                    " fresh.record({ job: 'site' });"   # record() makes a missing state folder itself
                    " return { before, after: l.counted('mcp'), summary: l.summary(), rows: l.rows().length, budget: m.FLAKE_BUDGET,"
                    " fresh: fresh.rows().map(r => r.job) };",
                    "land-flakes")
    assert got["before"] == [1, 1, None]     # mc-koth: only the one an hour ago; a moment inside an incident counts nothing
    assert got["after"] == 2 and got["rows"] == len(rows) + 1 and got["budget"] == 3
    s = got["summary"]
    assert s.startswith("flakes this run: mcp x1 (exit 2); last 7 days: ")
    # 7 days: every mc-koth row but the one inside the incident (outside load and future rows still show), both mcp rows
    assert "last 7 days: mc-koth x4, mcp x2 (exit 2); 1 excluded as incident noise (n)" in s, s
    assert s.endswith("(a job that keeps coming back here is a FOLLOWUPS row)") and got["fresh"] == ["site"]


def test_a_command_name_from_the_object_prototype_is_refused_with_the_usage():
    # Opus review (older bug): COMMANDS['constructor'] was truthy, so `land constructor --x` passed the usage check and
    # then threw inside the flag check.
    import subprocess
    from _node import NODE_BIN
    from _skip import needs
    needs(NODE_BIN, "node")
    r = subprocess.run([NODE_BIN, str(REPO / "scripts" / "land.mjs"), "constructor", "--x"], cwd=REPO,
                       capture_output=True, text=True, timeout=30)
    assert r.returncode == 4 and r.stdout.startswith("usage: node scripts/land.mjs"), r.stdout + r.stderr


def test_the_lander_lock_has_one_holder_reaps_a_dead_one_and_releases_in_order():
    # A11 stage 2 (lib/land-lock.mjs). Two locks on one folder: the second cannot take it while the first holds it; a
    # dead lander's entry is reaped; release runs onRelease while this entry still exists, then removes it.
    with tempfile.TemporaryDirectory() as d:
        got = _node(f"const fs = await import('node:fs'); const dir = {json.dumps(d)} + '/lock'; let seen = null;"
                    " fs.mkdirSync(dir); const dead = String(Date.now() - 60000).padStart(15, '0') + '-999999999-dead00';"
                    " fs.writeFileSync(dir + '/' + dead, ''); const old = (Date.now() - 60000) / 1000; fs.utimesSync(dir + '/' + dead, old, old);"
                    " const a = m.createLanderLock(dir, { onRelease: () => { seen = fs.readdirSync(dir); } });"
                    " const b = m.createLanderLock(dir);"
                    " const gotA = await a.acquire(); const gotB = await b.acquire();"
                    " const state = { gotA, gotB, entries: fs.readdirSync(dir), holder: a.holder(), still: a.stillHolder(), bStill: b.stillHolder() };"
                    " const entry = a.entry; a.release();"
                    " return { ...state, entry, seen, after: fs.readdirSync(dir), entryAfter: a.entry, holderAfter: b.holder() };",
                    "land-lock")
    assert got["gotA"] is True and got["gotB"] is False
    assert got["entries"] == [got["entry"]]                      # the dead entry was reaped
    assert got["holder"]["pid"] > 0 and got["still"] is True and got["bStill"] is False
    assert got["seen"] == [got["entry"]] and got["after"] == []    # onRelease saw the entry; then it went
    assert got["entryAfter"] is None and got["holderAfter"] is None
