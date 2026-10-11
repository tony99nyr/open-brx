"""Every generated artefact is fresh, and scripts/generated.json lists every generator (architecture round 2, candidate 14).

scripts/generated.json is the one list of generated files: each entry names its sources, its outputs and the argv that
writes or checks it. `node scripts/regen.mjs --check` runs every check; this test runs that once, so a stale output
fails here with the entry named. It replaces the per-generator "is the file stale" asserts. The content tests stay in
each generator's own test file.

Run: python3 run_tests.py test_generated_fresh
"""
from __future__ import annotations

import glob
import json
import pathlib
import re
import subprocess

from _node import NODE_BIN
from _skip import needs

REPO = pathlib.Path(__file__).resolve().parents[2]
REGISTRY = json.loads((REPO / "scripts" / "generated.json").read_text(encoding="utf-8"))["generators"]
GENERATOR_FILE = re.compile(r"^gen[-_].*\.(py|mjs)$")
SKIP_DIRS = {"node_modules", ".git", ".venv", "dist", "www", "android", "ios"}


def test_every_generated_output_is_fresh():
    needs(NODE_BIN, "node")
    r = subprocess.run([NODE_BIN, "scripts/regen.mjs", "--check"], cwd=REPO, capture_output=True, text=True, timeout=240)
    if r.returncode == 1:
        stale = re.findall(r"regen: stale (\S+):", r.stderr)
        raise AssertionError("stale generated output: " + ", ".join(stale) + "\n" + r.stderr.strip())
    assert r.returncode != 2, "a generator itself failed (not stale):\n" + r.stderr.strip()
    assert r.returncode == 0, f"regen.mjs exited {r.returncode}:\n{r.stderr.strip()}"


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


def test_every_generator_file_in_the_repo_has_an_entry():
    """A new gen-*.py or gen_*.mjs must be added to scripts/generated.json, or it can go stale unseen."""
    listed = {a for g in REGISTRY for a in g["write"] if a.endswith((".py", ".mjs"))}
    found = set()
    for root, dirs, files in __import__("os").walk(REPO):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for f in files:
            if GENERATOR_FILE.match(f):
                found.add(str((pathlib.Path(root) / f).relative_to(REPO)))
    assert found, "the walk found no generator at all"
    assert not found - listed, f"generator file(s) with no entry in scripts/generated.json: {sorted(found - listed)}"
    assert not listed - found, f"entries naming a generator file that does not exist: {sorted(listed - found)}"
