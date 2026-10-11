"""Every generated artefact is fresh, and scripts/generated.json lists every generator (architecture round 2, candidate 14).

scripts/generated.json is the one list of generated files: each entry names its sources, its outputs and the argv that
writes or checks it. `node scripts/regen.mjs --check` runs every check; this test runs that once, so a stale output
fails here with the entry named. The content tests stay in each generator's own test file.

Guards that keep the list true:
- the audit tests run each generator's --check under a hook that records every repo file it reads or imports, and
  hold each one to a source glob or an output (a source the entry forgot would let `--changed` skip a stale file);
- the header test holds every file that says it is GENERATED to a registry output or a not_registered row;
- the filename test holds every gen-*.py/.mjs/.js/.ts/.cjs file to an entry.

Run: python3 run_tests.py test_generated_fresh
"""
from __future__ import annotations

import fnmatch
import glob
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile

from _node import NODE_BIN
from _skip import Skipped, needs

REPO = pathlib.Path(__file__).resolve().parents[2]
DOC = json.loads((REPO / "scripts" / "generated.json").read_text(encoding="utf-8"))
REGISTRY = DOC["generators"]
NOT_REGISTERED = DOC["not_registered"]
GENERATOR_FILE = re.compile(r"^gen[-_].*\.(py|mjs|js|ts|cjs)$")
GENERATOR_EXT = (".py", ".mjs", ".js", ".ts", ".cjs")
SKIP_DIRS = {"node_modules", ".git", ".venv", "dist", "www", "android", "ios"}
AUDIT = pathlib.Path(__file__).resolve().parent / "_audit"
STALE = 3


def _python_entries():
    return [g for g in REGISTRY if g["check"][0] == "{python}"]


def _node_entries():
    return [g for g in REGISTRY if g["check"][0] == "node"]


def _run_checks(node_bin, run=subprocess.run) -> list[str]:
    """Run every check. With node, one `regen.mjs --check`. Without it, the python entries run directly (they never
    needed node) and the call ends in a skip for the node entries. Returns the entry names that ran."""
    if node_bin:
        r = run([node_bin, "scripts/regen.mjs", "--check"], cwd=REPO, capture_output=True, text=True, timeout=240)
        if r.returncode == 1:
            stale = re.findall(r"regen: stale (\S+):", r.stderr)
            raise AssertionError("stale generated output: " + ", ".join(stale) + "\n" + r.stderr.strip())
        assert r.returncode != 2, "a generator itself failed (not stale):\n" + r.stderr.strip()
        assert r.returncode == 0, f"regen.mjs exited {r.returncode}:\n{r.stderr.strip()}"
        return [g["name"] for g in REGISTRY]
    ran, stale = [], []
    for g in _python_entries():
        argv = [sys.executable if a == "{python}" else a for a in g["check"]]
        r = run(argv, cwd=REPO, capture_output=True, text=True, timeout=240)
        assert r.returncode in (0, STALE), f"{g['name']} failed (exit {r.returncode}):\n{r.stderr.strip()}"
        if r.returncode == STALE:
            stale.append(g["name"])
        ran.append(g["name"])
    assert not stale, "stale generated output: " + ", ".join(stale)
    needs(False, "node, for the entries " + ", ".join(g["name"] for g in _node_entries()))
    return ran


def test_every_generated_output_is_fresh():
    _run_checks(NODE_BIN)


def test_without_node_the_python_entries_still_run_and_the_node_ones_skip():
    seen: list[list[str]] = []

    def spy(argv, *a, **k):
        seen.append(list(argv))
        return subprocess.run(argv, *a, **k)

    try:
        _run_checks(None, run=spy)
        skipped = False
    except Skipped:
        skipped = True
    assert skipped, "the node-less run must end in a skip for the node entries, never a quiet pass"
    assert len(seen) == len(_python_entries()) and all("--check" in s for s in seen), [s[1:] for s in seen]


def test_the_registry_entries_are_whole():
    names = [g["name"] for g in REGISTRY]
    assert len(names) == len(set(names)), "a generator name appears twice"
    for g in REGISTRY:
        assert g["outputs"] and g["sources"] and g["write"] and g["check"], g["name"]
        assert "--check" in g["check"] and "--check" not in g["write"], g["name"]
        for out in g["outputs"]:
            assert (REPO / out).is_file(), f"{g['name']}: output {out} does not exist"
        for pattern in g["sources"]:
            assert glob.glob(str(REPO / pattern)), f"{g['name']}: source {pattern} matches no file"
        script = next(a for a in g["write"] if a.endswith((".py", ".mjs")))
        assert script in g["sources"], f"{g['name']}: the generator {script} is not among its own sources"


# ----------------------------------------------------------------------------------- the audit guards #

def _segment_match(path: str, pattern: str) -> bool:
    """scripts/lib's glob dialect: `*` is one path segment's worth of characters, and there is no `**`."""
    p, g = path.split("/"), pattern.split("/")
    return len(p) == len(g) and all(fnmatch.fnmatchcase(a, b) for a, b in zip(p, g))


def _covered(path: str, entry: dict) -> bool:
    return path in entry["outputs"] or any(_segment_match(path, s) for s in entry["sources"])


def _uncovered(entry: dict, touched: list[str]) -> list[str]:
    return sorted(p for p in set(touched) if not _covered(p, entry))


def _audit_python(entry: dict) -> list[str]:
    script = next(a for a in entry["check"] if a.endswith(".py"))
    with tempfile.TemporaryDirectory() as tmp:
        log = os.path.join(tmp, "files.json")
        argv = [sys.executable, str(AUDIT / "py_audit.py"), log, str(REPO), script, "--check"]
        r = subprocess.run(argv, cwd=REPO, capture_output=True, text=True, timeout=240)
        assert r.returncode in (0, STALE), f"{entry['name']} --check failed under the audit (exit {r.returncode}):\n{r.stderr.strip()}"
        return json.loads(pathlib.Path(log).read_text(encoding="utf-8"))


def _audit_node(entry: dict) -> list[str]:
    script = next(a for a in entry["check"] if a.endswith(".mjs"))
    with tempfile.TemporaryDirectory() as tmp:
        log = os.path.join(tmp, "files.log")
        pathlib.Path(log).touch()
        env = dict(os.environ, REGEN_AUDIT_LOG=log)
        argv = [NODE_BIN, "--import", str(AUDIT / "node_preload.mjs"), script, "--check"]
        r = subprocess.run(argv, cwd=REPO, capture_output=True, text=True, timeout=240, env=env)
        assert r.returncode in (0, STALE), f"{entry['name']} --check failed under the audit (exit {r.returncode}):\n{r.stderr.strip()}"
        root = os.path.realpath(REPO)
        touched = set()
        for line in pathlib.Path(log).read_text(encoding="utf-8").splitlines():
            real = os.path.realpath(os.path.join(REPO, line))
            if real.startswith(root + os.sep) and os.path.isfile(real) and "/node_modules/" not in real:
                touched.add(os.path.relpath(real, root))
        return sorted(touched)


def test_every_python_generator_reads_only_its_declared_sources():
    for g in _python_entries():
        touched = _audit_python(g)
        assert touched, f"{g['name']}: the audit saw no file at all"
        bad = _uncovered(g, touched)
        assert not bad, f"{g['name']} reads files its sources do not cover (add a source glob): {bad}"


def test_every_node_generator_reads_only_its_declared_sources():
    needs(NODE_BIN, "node")
    for g in _node_entries():
        touched = _audit_node(g)
        assert touched, f"{g['name']}: the audit saw no file at all"
        bad = _uncovered(g, touched)
        assert not bad, f"{g['name']} reads files its sources do not cover (add a source glob): {bad}"


def test_the_audit_notices_a_missing_source():
    """The control: drop a glob and the guard must complain, for a python and for a node generator."""
    g = next(x for x in _python_entries() if x["name"] == "gen_clip_ms")
    trimmed = dict(g, sources=[s for s in g["sources"] if "sound_catalog" not in s])
    assert _uncovered(trimmed, _audit_python(g)), "the audit did not see the catalogue the generator reads"
    needs(NODE_BIN, "node")
    n = next(x for x in _node_entries() if x["name"] == "gen-medalicons")
    trimmed = dict(n, sources=[s for s in n["sources"] if "medalicons.js" not in s])
    assert _uncovered(trimmed, _audit_node(n)), "the audit did not see the icons the generator reads"


# --------------------------------------------------------------------------------------- the escapes #

HEADER = re.compile(r"\bGENERATED\b|\bGenerated by\b")
HEADER_EXT = {".py", ".mjs", ".js", ".ts", ".cjs", ".json", ".h", ".sh"}


def _tracked_files() -> list[str]:
    r = subprocess.run(["git", "ls-files"], cwd=REPO, capture_output=True, text=True, timeout=60)
    needs(r.returncode == 0, "a git checkout")
    return r.stdout.splitlines()


def _header_of(rel: str) -> str:
    try:
        with open(REPO / rel, encoding="utf-8") as fh:
            return "".join(fh.readline() for _ in range(3))
    except (OSError, UnicodeDecodeError):
        return ""


def _is_header_claim(head: str) -> bool:
    """A comment line starting with GENERATED, or a JSON `_comment`/`about` that says GENERATED / Generated by."""
    for line in head.splitlines():
        s = line.strip()
        if re.match(r"(//|#|/\*)\s*GENERATED\b", s):
            return True
        if re.match(r'"(_comment|about)"\s*:', s) and HEADER.search(s):
            return True
    return False


def test_every_file_that_says_generated_is_registered_or_excused():
    outputs = {o for g in REGISTRY for o in g["outputs"]}
    excused = [o for n in NOT_REGISTERED for o in n["outputs"]]
    claims = [f for f in _tracked_files() if os.path.splitext(f)[1] in HEADER_EXT and _is_header_claim(_header_of(f))]
    assert len(claims) >= 8, f"the header scan found only {claims}"
    loose = [f for f in claims if f not in outputs and not any(fnmatch.fnmatchcase(f, e) for e in excused)]
    assert not loose, f"files whose header says GENERATED but that no registry entry or not_registered row names: {loose}"


def test_the_not_registered_rows_are_whole():
    for n in NOT_REGISTERED:
        assert n["generator"] and n["outputs"] and len(n["reason"]) > 20, n
        assert (REPO / n["generator"]).is_file(), f"{n['generator']} does not exist"
        for pattern in n["outputs"]:
            assert glob.glob(str(REPO / pattern)), f"{n['generator']}: output {pattern} matches no file"
        assert n["generator"] not in {a for g in REGISTRY for a in g["write"]}, f"{n['generator']} is registered AND excused"


def test_every_generator_file_in_the_repo_has_an_entry():
    """A new gen-*.py/.mjs/.js/.ts/.cjs must be added to scripts/generated.json (generators or not_registered)."""
    registered = {a for g in REGISTRY for a in g["write"] if a.endswith(GENERATOR_EXT)}
    excused = {n["generator"] for n in NOT_REGISTERED}
    found = set()
    for root, dirs, files in os.walk(REPO):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for f in files:
            if GENERATOR_FILE.match(f):
                found.add(str((pathlib.Path(root) / f).relative_to(REPO)))
    assert found, "the walk found no generator at all"
    assert not found - registered - excused, f"generator file(s) with no entry in scripts/generated.json: {sorted(found - registered - excused)}"
    assert not registered - found, f"entries naming a generator file that does not exist: {sorted(registered - found)}"
