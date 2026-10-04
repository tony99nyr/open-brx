"""Contract tests for the content-addressed test runner cache."""
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from _skip import needs

REPO = Path(__file__).resolve().parents[2]
CACHE_MOD = REPO / "scripts" / "lib" / "cache.mjs"
LAND_GATE_MOD = REPO / "scripts" / "lib" / "land-gate.mjs"
NODE = shutil.which("node")
GIT = shutil.which("git")


def _node(expr: str, cwd: Path = REPO, env=None):
    needs(NODE, "node")
    res = subprocess.run([NODE, "--input-type=module", "-e", expr], cwd=cwd,
                         env={**os.environ, **(env or {})}, capture_output=True, text=True, timeout=30)
    assert res.returncode == 0, res.stderr
    return res.stdout.strip()


def _temporary_path(test):
    def run():
        with tempfile.TemporaryDirectory() as directory:
            return test(Path(directory))
    return run


def _git_repo(test):
    def run():
        needs(GIT, "git")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "repo"
            root.mkdir()
            subprocess.run([GIT, "init", "-q"], cwd=root, check=True)
            subprocess.run([GIT, "config", "user.email", "test@example.invalid"], cwd=root, check=True)
            subprocess.run([GIT, "config", "user.name", "Cache Test"], cwd=root, check=True)
            (root / "src").mkdir()
            (root / "src" / "input.txt").write_text("one\n")
            (root / "other.txt").write_text("other\n")
            subprocess.run([GIT, "add", "-A"], cwd=root, check=True)
            subprocess.run([GIT, "commit", "-qm", "initial"], cwd=root, check=True)
            return test(root)
    return run


def _input_hash(root: Path, inputs=("src/**",)) -> str:
    expr = (f"import({json.dumps(CACHE_MOD.as_uri())}).then(async m => "
            f"console.log(await m.inputTreeHash({json.dumps(str(root))}, {json.dumps(list(inputs))})))")
    return _node(expr, cwd=root)


def _needs_node_git(root: Path):
    # Some sandboxes allow Python to spawn git but deny Node's child_process access.
    expr = "const {spawnSync}=await import('node:child_process'); const r=spawnSync('git',['--version']); if(r.status!==0) process.exit(1)"
    needs(NODE and subprocess.run([NODE, "--input-type=module", "-e", expr], cwd=root,
                                  capture_output=True, timeout=10).returncode == 0,
          "Node child_process git access")


@_git_repo
def test_input_tree_hash_tracks_tracked_and_untracked_files_but_ignores_unrelated(git_repo):
    _needs_node_git(git_repo)
    initial = _input_hash(git_repo)
    (git_repo / "src" / "input.txt").write_text("changed tracked\n")
    tracked_changed = _input_hash(git_repo)
    assert tracked_changed != initial

    (git_repo / "src" / "new.txt").write_text("untracked\n")
    untracked_changed = _input_hash(git_repo)
    assert untracked_changed != tracked_changed

    (git_repo / "outside.txt").write_text("outside input set\n")
    assert _input_hash(git_repo) == untracked_changed


@_git_repo
def test_input_tree_hash_does_not_change_the_real_git_index(git_repo):
    _needs_node_git(git_repo)
    before = subprocess.check_output([GIT, "write-tree"], cwd=git_repo, text=True).strip()
    index = git_repo / ".git" / "index"
    before_bytes = index.read_bytes()
    _input_hash(git_repo)
    assert index.read_bytes() == before_bytes
    after = subprocess.check_output([GIT, "write-tree"], cwd=git_repo, text=True).strip()
    assert after == before


@_git_repo
def test_input_tree_hash_tracks_same_size_edit_in_same_second(git_repo):
    _needs_node_git(git_repo)
    path = git_repo / "src" / "input.txt"
    initial = _input_hash(git_repo)
    stamp = path.stat().st_mtime
    path.write_text("two\n")
    os.utime(path, (stamp, stamp))
    assert _input_hash(git_repo) != initial


def test_cache_key_includes_job_command_environment_fingerprint_and_input_hash():
    expr = (f"import({json.dumps(CACHE_MOD.as_uri())}).then(m => {{"
            "const base={job:'mcp',cmd:['python','run_tests.py'],env:{MODE:'test'},fingerprint:'tools',inputHash:'tree'};"
            "console.log(JSON.stringify([m.cacheKey(base),m.cacheKey({...base,inputHash:'changed'}),"
            "m.cacheKey({...base,env:{MODE:'other'}}),m.cacheKey({...base,cmd:['python','other.py']}),"
            "m.cacheKey({...base,fingerprint:'new tools'}),m.cacheKey({...base,job:'site'})]));})")
    keys = json.loads(_node(expr))
    assert len(set(keys)) == len(keys)


@_git_repo
def test_cache_stores_only_success_and_rejects_before_after_input_mismatch(git_repo):
    _needs_node_git(git_repo)
    expr = (f"import({json.dumps(CACHE_MOD.as_uri())}).then(async m => {{"
            f"const root={json.dumps(str(git_repo))};"
            "await m.storePass(root,{job:'mcp',key:'failed',exit:1,secs:1,head:'head',before:'a',after:'a'});"
            "await m.storePass(root,{job:'mcp',key:'flake',exit:0,secs:1,head:'head',before:'a',after:'a',flake:true});"
            "await m.storePass(root,{job:'mcp',key:'mismatch',exit:0,secs:1,head:'head',before:'a',after:'b'});"
            "await m.storePass(root,{job:'mcp',key:'passed',exit:0,secs:1,head:'head',before:'a',after:'a'});"
            "const failed=await m.readCache(root,'failed');"
            "const flake=await m.readCache(root,'flake');"
            "const mismatch=await m.readCache(root,'mismatch');"
            "const passed=await m.readCache(root,'passed');"
            "console.log(JSON.stringify({failed,flake,mismatch,passed}));})")
    result = json.loads(_node(expr, cwd=git_repo))
    assert result["failed"] is None and result["flake"] is None and result["mismatch"] is None
    assert result["passed"]["exit"] == 0


@_git_repo
def test_expired_cache_entries_are_ignored(git_repo):
    _needs_node_git(git_repo)
    expr = (f"import({json.dumps(CACHE_MOD.as_uri())}).then(async m => {{"
            f"const root={json.dumps(str(git_repo))};"
            "await m.writeCache(root,{job:'mcp',key:'old',exit:0,secs:1,t:Date.now()-15*86400000,head:'head'});"
            "const ignored=await m.readCache(root,'old');"
            "await m.writeCache(root,{job:'mcp',key:'old-again',exit:0,secs:1,t:Date.now()-15*86400000,head:'head'});"
            "await m.pruneCache(root);"
            "console.log(JSON.stringify({ignored}));})")
    assert json.loads(_node(expr, cwd=git_repo)) == {"ignored": None}
    assert not (git_repo / ".git" / "brx-test-cache" / "old-again.json").exists()


def test_all_cached_decision_is_true_only_when_every_selected_job_hits():
    expr = (f"import({json.dumps(CACHE_MOD.as_uri())}).then(m => console.log(JSON.stringify(["
            "m.allCached([{name:'mcp'},{name:'site'}],new Map([['mcp',{}],['site',{}]])),"
            "m.allCached([{name:'mcp'},{name:'site'}],new Map([['mcp',{}]]))])))")
    assert json.loads(_node(expr)) == [True, False]


def test_ambient_test_controls_disable_cache_lookups_and_stores():
    runner = (REPO / "scripts/test-all.mjs").read_text()
    assert "cacheBypassReason" in runner
    expr = ("import('./scripts/lib/cache.mjs').then(m => console.log(JSON.stringify(["
            "m.cacheBypassReason({ONLY:'one'}),m.cacheBypassReason({SCREENS_SHARD:'1/2'}),"
            "m.cacheBypassReason({SCREENS_EXPECT_STEPS:'1'}),m.cacheBypassReason({ALLOW_STALE:'1'}),"
            "m.cacheBypassReason({BRX_CHAOS_SEEDS:'2'}),m.cacheBypassReason({BEFORE_WWW:'old'}),"
            "m.cacheBypassReason({SITE_ROOT:'/tmp/other'}),m.cacheBypassReason({PATH:'/usr/bin'})])))")
    values = json.loads(_node(expr))
    assert all(values[:-1]) and values[-1] is None


@_git_repo
def test_environment_allowlist_and_git_index_flags(git_repo):
    expr = (f"import({json.dumps(CACHE_MOD.as_uri())}).then(m => console.log(JSON.stringify(["
            "m.cacheBypassReason({PATH:'/bin',HOME:'/home/test',WSL_DISTRO_NAME:'Ubuntu',XDG_RUNTIME_DIR:'/run/user/1',"
            "MC_PY:'python',BRX_MCP_HOME:'/tmp/mcp'}),m.cacheBypassReason({LANG:'C'}),"
            "m.cacheBypassReason({UNEXPECTED_TEST_FLAG:'1'})])))")
    values = json.loads(_node(expr, cwd=git_repo))
    assert values == [None, "environment variable affects test results: LANG",
                      "environment variable affects test results: UNEXPECTED_TEST_FLAG"]
    source = CACHE_MOD.read_text()
    assert "core.splitIndex=false" in source and "core.fsmonitor=false" in source


def test_pnpm_environment_does_not_bypass_but_node_options_does():
    expr = (f"import({json.dumps(CACHE_MOD.as_uri())}).then(m => console.log(JSON.stringify(["
            "m.cacheBypassReason({INIT_CWD:'/repo',PNPM_SCRIPT_SRC_DIR:'/repo',npm_lifecycle_event:'test',"
            "npm_package_name:'brx',npm_config_registry:'https://registry.npmjs.org'}),"
            "m.cacheBypassReason({NODE_OPTIONS:'--require=hook'}),"
            "m.cacheBypassReason({npm_config_node_options:'--require=hook'}),"
            "m.cacheBypassReason({npm_config_script_shell:'/bin/bash'})])))")
    assert json.loads(_node(expr)) == [None, "environment variable affects test results: NODE_OPTIONS",
                                      "environment variable affects test results: npm_config_node_options",
                                      "environment variable affects test results: npm_config_script_shell"]


@_git_repo
def test_input_tree_hash_bypasses_assume_unchanged_and_skip_worktree(git_repo):
    _needs_node_git(git_repo)
    expr = (f"import({json.dumps(CACHE_MOD.as_uri())}).then(m => {{try {{m.inputTreeHash("
            f"{json.dumps(str(git_repo))}, ['src/**']); process.exit(0)}} catch {{process.exit(4)}}}})")
    for flag in ("--assume-unchanged", "--skip-worktree"):
        subprocess.run([GIT, "update-index", flag, "src/input.txt"], cwd=git_repo, check=True)
        result = subprocess.run([NODE, "--input-type=module", "-e", expr], cwd=git_repo,
                                capture_output=True, text=True, timeout=30)
        assert result.returncode == 4
        subprocess.run([GIT, "update-index", "--no-" + flag[2:], "src/input.txt"], cwd=git_repo, check=True)


@_temporary_path
def test_installed_npm_dependency_fingerprint_and_missing_marker(tmp_path):
    expr = (f"import({json.dumps(CACHE_MOD.as_uri())}).then(m => {{"
            f"const root={json.dumps(str(tmp_path))};"
            "console.log(JSON.stringify([m.installedNpmState(root,'app'),m.installedNpmState(root,'site')]));})")
    assert json.loads(_node(expr)) == [None, None]
    pkg = tmp_path / "app" / "node_modules"
    pkg.mkdir(parents=True)
    marker = pkg / ".package-lock.json"
    marker.write_text('{"installed":"one"}')
    first = _node(f"import({json.dumps(CACHE_MOD.as_uri())}).then(m => console.log(m.installedNpmState({json.dumps(str(tmp_path))},'app')))")
    marker.write_text('{"installed":"two"}')
    second = _node(f"import({json.dumps(CACHE_MOD.as_uri())}).then(m => console.log(m.installedNpmState({json.dumps(str(tmp_path))},'app')))")
    assert first != second


@_git_repo
def test_mcp_cache_context_changes_with_head_and_local_date(git_repo):
    _needs_node_git(git_repo)
    expr = (f"import({json.dumps(CACHE_MOD.as_uri())}).then(m => console.log(JSON.stringify(["
            f"m.jobContext({json.dumps(str(git_repo))},'mcp',new Date(2026,0,1)),"
            f"m.jobContext({json.dumps(str(git_repo))},'mcp',new Date(2026,0,2)),"
            f"m.jobContext({json.dumps(str(git_repo))},'chaos',new Date(2026,0,2))])))")
    before = json.loads(_node(expr, cwd=git_repo))
    (git_repo / "other.txt").write_text("changed\n")
    subprocess.run([GIT, "add", "other.txt"], cwd=git_repo, check=True)
    subprocess.run([GIT, "commit", "-qm", "next"], cwd=git_repo, check=True)
    after = json.loads(_node(expr, cwd=git_repo))
    assert before[0] != before[1]
    assert before[0] != after[0]
    assert before[2] == after[2]
    expr = (f"import({json.dumps(CACHE_MOD.as_uri())}).then(m => console.log(JSON.stringify(["
            "m.cacheKey({job:'mcp',cmd:['python'],env:{},fingerprint:'f',inputHash:'i',context:{head:'a',date:'2026-01-01'}}),"
            "m.cacheKey({job:'mcp',cmd:['python'],env:{},fingerprint:'f',inputHash:'i',context:{head:'b',date:'2026-01-01'}})])))")
    keys = json.loads(_node(expr))
    assert keys[0] != keys[1]


def test_cache_key_ignores_worker_counts_and_shard_parallelism():
    expr = (f"import({json.dumps(CACHE_MOD.as_uri())}).then(m => console.log(JSON.stringify(["
            "m.cacheKey({job:'site',cmd:['npx','playwright','test','--workers=2'],env:{SCREENS_SHARDS:'2'},fingerprint:'f',inputHash:'i'}),"
            "m.cacheKey({job:'site',cmd:['npx','playwright','test','--workers=8'],env:{SCREENS_SHARDS:'8'},fingerprint:'f',inputHash:'i'}),"
            "m.cacheKey({job:'site',cmd:['npx','playwright','test','--workers=8','--ui'],env:{SCREENS_SHARDS:'8'},fingerprint:'f',inputHash:'i'})])))")
    keys = json.loads(_node(expr))
    assert keys[0] == keys[1] == keys[2]
    expr = (f"import({json.dumps(CACHE_MOD.as_uri())}).then(m => console.log(JSON.stringify(["
            "m.cacheKey({job:'mcp',cmd:['python','run_tests.py','-j','2'],env:{},fingerprint:'f',inputHash:'i'}),"
            "m.cacheKey({job:'mcp',cmd:['python','run_tests.py','-j','8'],env:{},fingerprint:'f',inputHash:'i'}),"
            "m.cacheKey({job:'mc-vitest',cmd:['vitest','--maxWorkers=2'],env:{},fingerprint:'f',inputHash:'i'}),"
            "m.cacheKey({job:'mc-vitest',cmd:['vitest','--maxWorkers=8'],env:{},fingerprint:'f',inputHash:'i'})])))")
    other = json.loads(_node(expr))
    assert other[0] == other[1] and other[2] == other[3]


@_git_repo
def test_old_orphaned_temporary_files_are_pruned(git_repo):
    _needs_node_git(git_repo)
    folder = git_repo / ".git" / "brx-test-cache"
    folder.mkdir()
    old = folder / ".orphan.tmp"
    fresh = folder / ".fresh.tmp"
    old.write_text("old")
    fresh.write_text("fresh")
    os.utime(old, (0, 0))
    _node(f"import({json.dumps(CACHE_MOD.as_uri())}).then(m => m.pruneCache({json.dumps(str(git_repo))}))", cwd=git_repo)
    assert not old.exists() and fresh.exists()


@_git_repo
def test_stopping_prevents_cache_store(git_repo):
    _needs_node_git(git_repo)
    expr = (f"import({json.dumps(CACHE_MOD.as_uri())}).then(m => console.log(m.storePass("
            f"{json.dumps(str(git_repo))},{{job:'mcp',key:'stopping',exit:0,secs:1,head:'h',before:'a',after:'a',stopping:true}})))")
    assert _node(expr, cwd=git_repo) == "false"


def test_runner_hashes_before_shared_builds_and_checks_outputs_before_all_hit_exit():
    runner = (REPO / "scripts/test-all.mjs").read_text()
    assert runner.index("cachePlan(JOBS)") < runner.index("const builds = []")
    assert "canExitAllCached" in runner
    expr = (f"import({json.dumps(CACHE_MOD.as_uri())}).then(m => console.log(JSON.stringify(["
            "m.canExitAllCached([{name:'mcp'}],new Map([['mcp',{}]])),"
            "m.canExitAllCached([{name:'app-test',www:true}],new Map([['app-test',{}]])),"
            "m.canExitAllCached([{name:'app-e2e',dist:true}],new Map([['app-e2e',{}]]))])))")
    assert json.loads(_node(expr)) == [True, False, False]


@_temporary_path
def test_output_freshness_rejects_missing_and_stale_bundles(tmp_path):
    (tmp_path / "app/src").mkdir(parents=True)
    (tmp_path / "app/src/view.js").write_text("source")
    (tmp_path / "webapp/mc/src").mkdir(parents=True)
    (tmp_path / "webapp/mc/src/view.ts").write_text("source")
    def fresh():
        expr = (f"import({json.dumps(CACHE_MOD.as_uri())}).then(m => console.log(JSON.stringify(["
                f"m.outputsFresh({json.dumps(str(tmp_path))},{{www:true}}),"
                f"m.outputsFresh({json.dumps(str(tmp_path))},{{dist:true}})])))")
        return json.loads(_node(expr))
    assert fresh() == [False, False]
    (tmp_path / "app/www").mkdir()
    (tmp_path / "app/www/index.html").write_text("index")
    (tmp_path / "app/www/app.js").write_text("bundle")
    (tmp_path / "webapp/mc/dist/assets").mkdir(parents=True)
    (tmp_path / "webapp/mc/dist/index.html").write_text("index")
    (tmp_path / "webapp/mc/dist/assets/bundle.js").write_text("bundle")
    assert fresh() == [True, True]
    (tmp_path / "app/src/view.js").write_text("changed")
    (tmp_path / "webapp/mc/src/view.ts").write_text("changed")
    future = 4102444800
    os.utime(tmp_path / "app/src/view.js", (future, future))
    os.utime(tmp_path / "webapp/mc/src/view.ts", (future, future))
    assert fresh() == [False, False]


def test_tool_fingerprint_names_git_and_installed_npm_markers():
    source = CACHE_MOD.read_text()
    assert "command('git', ['--version'])" in source
    assert "installedNpmState(root, p)" in source
    runner = (REPO / "scripts/test-all.mjs").read_text()
    assert "outputsFresh(ROOT, j)" in runner
    assert "installedAfterBuild" in runner
    assert "fs.copyFileSync(realIndex, index)" in source


def test_land_parse_gate_accepts_cached_result_rows():
    expr = (f"import({json.dumps(LAND_GATE_MOD.as_uri())}).then(m => console.log(JSON.stringify(m.parseGate("
            "'job               result  secs\\nmcp                ok      0\\n\\nmcp cached'))))")
    result = json.loads(_node(expr))
    assert result["rows"] == [{"name": "mcp", "ok": True}]
