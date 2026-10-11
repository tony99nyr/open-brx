"""scripts/regen.mjs's exit contract, against a throwaway registry (--registry): 0 fresh, 1 stale, 2 a generator failed.

Every generator's --check exits 3 when stale, 0 when fresh, anything else on error. regen.mjs reads nothing but the
exit code, so a crash whose message says "stale" is still a failure."""
from __future__ import annotations

import importlib.util
import json
import pathlib
import subprocess
import sys
import tempfile

from _node import NODE_BIN
from _skip import needs

REPO = pathlib.Path(__file__).resolve().parents[2]


def _regen(check_argv):
    needs(NODE_BIN, "node")
    entry = {"name": "probe", "sources": ["a"], "outputs": ["b"], "write": ["{python}", "-c", "pass"], "check": check_argv}
    with tempfile.TemporaryDirectory() as tmp:
        reg = pathlib.Path(tmp) / "reg.json"
        reg.write_text(json.dumps({"generators": [entry], "not_registered": []}), encoding="utf-8")
        return subprocess.run([NODE_BIN, "scripts/regen.mjs", "--check", "--registry", str(reg)], cwd=REPO,
                              capture_output=True, text=True, timeout=60)


def _py(code):
    return ["{python}", "-c", code]


def test_exit_0_is_fresh():
    assert _regen(_py("import sys; sys.exit(0)")).returncode == 0


def test_exit_3_is_stale_and_names_the_entry():
    r = _regen(_py("import sys; sys.exit(3)"))
    assert r.returncode == 1 and "node scripts/regen.mjs --write probe" in r.stderr, r.stderr
    assert "{python}" not in r.stderr and "/bin/python" not in r.stderr, "the hint must not print the interpreter"


def test_a_crash_that_says_stale_is_a_failure_not_a_stale_report():
    r = _regen(_py("import sys; print('stale', file=sys.stderr); sys.exit(1)"))
    assert r.returncode == 2, (r.returncode, r.stderr)
    r = _regen(_py("raise RuntimeError('output is stale')"))
    assert r.returncode == 2, (r.returncode, r.stderr)


def test_a_missing_interpreter_is_a_failure():
    assert _regen(["/no/such/interpreter"]).returncode == 2


def test_an_unknown_flag_or_name_is_refused():
    needs(NODE_BIN, "node")
    for argv in (["--check", "--frobnicate"], ["--check", "no-such-generator"], [], ["--check", "--registry", "--write"], ["--check", "--registry"]):
        r = subprocess.run([NODE_BIN, "scripts/regen.mjs", *argv], cwd=REPO, capture_output=True, text=True, timeout=60)
        assert r.returncode == 2, (argv, r.returncode, r.stderr)


def _load(rel, name):
    spec = importlib.util.spec_from_file_location(name, REPO / rel)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def test_the_python_tools_exit_3_when_stale_and_a_missing_output_is_stale():
    """In process: patch each tool so the on-disk file differs, or is absent, and read main()'s code."""
    sys.path.insert(0, str(REPO / "mcp"))
    ghost = REPO / "mcp" / "no-such-output.js"

    clip = _load("mcp/tools/gen_clip_ms.py", "gen_clip_ms_probe")
    clip.render = lambda: "something else\n"
    assert clip.main(["--check"]) == 3
    clip.JS_OUT = ghost
    assert clip.main(["--check"]) == 3, "a missing output must read as stale"

    contract = _load("mcp/tools/gen_contract.py", "gen_contract_probe")
    contract.render = lambda: {ghost: "x\n"}
    assert contract.main(["--check"]) == 3
    contract.render = lambda: {contract.JS_OUT: "x\n"}
    assert contract.main(["--check"]) == 3

    ui = _load("mcp/tools/gen_ui_catalog.py", "gen_ui_catalog_probe")
    ui.render = lambda: {ghost: "x\n"}
    assert ui.main(["--check"]) == 3, "a missing output must read as stale"
    ui.render = lambda: {ui.DEMO_JS: "x\n"}
    assert ui.main(["--check"]) == 3

    gun = _load("app/test/fixtures/gen_gun_replies.py", "gen_gun_replies_probe")
    gun.OUT = ghost
    assert gun.main(["--check"]) == 3, "a missing output must read as stale"
    gun.document = lambda: {"cases": []}
    gun.OUT = REPO / "app" / "test" / "fixtures" / "gun-replies.json"
    assert gun.main(["--check"]) == 3


def test_the_node_check_exits_3_for_a_stale_or_missing_copy_and_ignores_crlf():
    """medalicons in a scratch tree: missing -> 3, fresh -> 0, drift -> 3, a CRLF checkout -> 0."""
    needs(NODE_BIN, "node")
    src = (REPO / "app" / "scripts" / "gen-medalicons.mjs").read_text(encoding="utf-8")
    with tempfile.TemporaryDirectory() as tmp:
        root = pathlib.Path(tmp)
        (root / "app" / "scripts").mkdir(parents=True)
        (root / "app" / "src" / "hud").mkdir(parents=True)
        (root / "webapp" / "mc" / "src" / "api").mkdir(parents=True)
        gen = root / "app" / "scripts" / "gen-medalicons.mjs"
        gen.write_text(src, encoding="utf-8")
        (root / "app" / "src" / "hud" / "medalicons.js").write_text("export const a = 1;\nexport const b = 2;\n", encoding="utf-8", newline="\n")
        out = root / "webapp" / "mc" / "src" / "api" / "medalicons.gen.ts"

        def check():
            return subprocess.run([NODE_BIN, str(gen), "--check"], capture_output=True, text=True, timeout=60).returncode

        assert check() == 3, "a missing copy must read as stale"
        subprocess.run([NODE_BIN, str(gen)], check=True, capture_output=True, timeout=60)
        assert check() == 0
        out.write_text(out.read_text(encoding="utf-8") + "// drift\n", encoding="utf-8", newline="\n")
        assert check() == 3
        subprocess.run([NODE_BIN, str(gen)], check=True, capture_output=True, timeout=60)
        out.write_bytes(out.read_bytes().replace(b"\n", b"\r\n"))
        assert check() == 0, "a CRLF checkout is not a stale copy"


def _python_mjs(root, env_extra=None, unset=("MC_PY",)):
    needs(NODE_BIN, "node")
    import os
    env = {k: v for k, v in os.environ.items() if k not in unset}
    env.update(env_extra or {})
    r = subprocess.run([NODE_BIN, "-e", f"import('{REPO}/scripts/lib/python.mjs').then(m => console.log(JSON.stringify(m.findPython({json.dumps(str(root))}))))"],
                       capture_output=True, text=True, timeout=60, env=env)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def test_find_python_resolves_in_order_and_says_whether_a_repo_venv_won():
    import os
    with tempfile.TemporaryDirectory() as tmp:
        base = pathlib.Path(os.path.realpath(tmp))
        # 1. MC_PY wins and is never a "repo venv"
        assert _python_mjs(base, {"MC_PY": "/opt/py"}) == {"python": "/opt/py", "foundVenv": False}
        # 2. the checkout's own .venv
        own = base / "own"
        (own / ".venv" / "bin").mkdir(parents=True)
        (own / ".venv" / "bin" / "python").write_text("", encoding="utf-8")
        assert _python_mjs(own) == {"python": str(own / ".venv" / "bin" / "python"), "foundVenv": True}
        # 3. only the main checkout's .venv, found through git's common dir from a worktree
        main = base / "main"
        (main / ".venv" / "bin").mkdir(parents=True)
        (main / ".venv" / "bin" / "python").write_text("", encoding="utf-8")
        git = ["git", "-c", "user.name=t", "-c", "user.email=t@example.com"]
        subprocess.run([*git, "init", "-q"], cwd=main, check=True)
        (main / "f").write_text("x", encoding="utf-8")
        subprocess.run([*git, "add", "f"], cwd=main, check=True)
        subprocess.run([*git, "commit", "-q", "-m", "x"], cwd=main, check=True)
        wt = base / "wt"
        subprocess.run([*git, "worktree", "add", "-q", str(wt)], cwd=main, check=True)
        assert _python_mjs(wt) == {"python": str(main / ".venv" / "bin" / "python"), "foundVenv": True}
        # 4. none: system python3, and not a repo venv
        bare = base / "bare"
        bare.mkdir()
        assert _python_mjs(bare) == {"python": "python3", "foundVenv": False}


def test_soundbank_community_check_exits_3_when_the_files_are_stale_or_missing():
    import io
    import shutil
    import contextlib
    sys.path.insert(0, str(REPO / "mcp" / "tools"))
    sbc = _load("mcp/tools/soundbank_community.py", "soundbank_community_probe")
    with tempfile.TemporaryDirectory() as tmp:
        t = pathlib.Path(tmp)
        cat, md = t / "sound_catalog.json", t / "sound-catalog.md"
        shutil.copy(sbc.DEFAULT_CATALOG, cat)
        shutil.copy(sbc.DEFAULT_MD, md)
        args = ["--check", "--catalog", str(cat), "--md", str(md)]
        quiet = contextlib.redirect_stdout(io.StringIO())
        with quiet, contextlib.redirect_stderr(io.StringIO()):
            assert sbc.main(args) == 0
            md.write_text(md.read_text(encoding="utf-8") + "drift\n", encoding="utf-8")
            assert sbc.main(args) == 3
            shutil.copy(sbc.DEFAULT_MD, md)
            cat.write_text(cat.read_text(encoding="utf-8").replace('"community_status": "agrees"', '"community_status": "differs"', 1), encoding="utf-8")
            assert sbc.main(args) == 3
            shutil.copy(sbc.DEFAULT_CATALOG, cat)
            md.unlink()
            assert sbc.main(args) == 3, "a missing markdown file is stale"
