"""No build state may live under node_modules or outside the checkout. Worktrees link node_modules to the main
checkout, so state written there is SHARED between checkouts and the land lane. On 2026-10-04 `tsc -b` read
another checkout's .tsbuildinfo from node_modules/.tmp, skipped the type check, and passed a branch that was red
(a false green, twice), and Vite's shared optimiser cache answered "504 Outdated Optimize Dep". This guard fails if
a tsconfig writes build info or output there, or if a Vite/Vitest config leaves cacheDir at its node_modules default."""
import json
import pathlib
import re
import subprocess

REPO = pathlib.Path(__file__).resolve().parents[2]
TS_STATE_KEYS = ("tsBuildInfoFile", "outDir", "declarationDir")


def _tracked(pattern: str) -> list[pathlib.Path]:
    out = subprocess.run(["git", "ls-files"], cwd=REPO, capture_output=True, text=True, check=True).stdout.split()
    return [REPO / p for p in out if re.search(pattern, p)]


def _strip_json_comments(text: str) -> str:
    out, i, in_str = [], 0, False
    while i < len(text):
        c = text[i]
        if in_str:
            out.append(c)
            if c == "\\":
                out.append(text[i + 1]); i += 1
            elif c == '"':
                in_str = False
        elif c == '"':
            in_str = True; out.append(c)
        elif text.startswith("//", i):
            while i < len(text) and text[i] != "\n":
                i += 1
            continue
        elif text.startswith("/*", i):
            i = text.index("*/", i) + 2
            continue
        else:
            out.append(c)
        i += 1
    return re.sub(r",(\s*[}\]])", r"\1", "".join(out))


def _bad_path(base: pathlib.Path, value: str) -> str | None:
    target = (base / value).resolve()
    if "node_modules" in pathlib.PurePath(value).parts or "node_modules" in target.parts:
        return "under node_modules (shared between checkouts)"
    if not target.is_relative_to(REPO.resolve()):
        return "outside the checkout"
    return None


def tsconfig_problems(files: list[pathlib.Path]) -> list[str]:
    out = []
    for f in files:
        opts = json.loads(_strip_json_comments(f.read_text(encoding="utf-8"))).get("compilerOptions", {})
        for key in TS_STATE_KEYS:
            if key in opts and (why := _bad_path(f.parent, opts[key])):
                out.append(f"{f.relative_to(REPO)}: {key} {opts[key]!r} is {why}")
    return out


def vite_problems(files: list[pathlib.Path]) -> list[str]:
    out = []
    for f in files:
        m = re.search(r"""\bcacheDir\s*:\s*['"`]([^'"`]+)['"`]""", f.read_text(encoding="utf-8"))
        if not m:
            out.append(f"{f.relative_to(REPO)}: no cacheDir, so Vite uses node_modules/.vite (shared between checkouts)")
        elif why := _bad_path(f.parent, m.group(1)):
            out.append(f"{f.relative_to(REPO)}: cacheDir {m.group(1)!r} is {why}")
    return out


def test_tsconfigs_keep_build_state_in_the_checkout():
    files = _tracked(r"(^|/)tsconfig[^/]*\.json$")
    assert files, "found no tsconfig: the guard is looking in the wrong place"
    assert not tsconfig_problems(files), tsconfig_problems(files)


def test_vite_and_vitest_configs_keep_their_cache_in_the_checkout():
    files = _tracked(r"(^|/)(vite|vitest)[^/]*\.config\.[mc]?[jt]s$")
    assert files, "found no vite/vitest config: the guard is looking in the wrong place"
    assert not vite_problems(files), vite_problems(files)


def test_the_checks_can_fail():
    import tempfile
    with tempfile.TemporaryDirectory(dir=REPO / "mcp") as d:
        root = pathlib.Path(d)
        (root / "tsconfig.x.json").write_text('{ // c\n "compilerOptions": { "tsBuildInfoFile": "./node_modules/.tmp/x", } }')
        (root / "tsconfig.y.json").write_text('{"compilerOptions": {"outDir": "../../../../outside"}}')
        (root / "tsconfig.ok.json").write_text('{"compilerOptions": {"tsBuildInfoFile": "./.tsbuild/x"}}')
        (root / "vite.config.ts").write_text("export default { plugins: [] }")
        (root / "vitest.config.ts").write_text("export default { cacheDir: 'node_modules/.vite' }")
        ts = tsconfig_problems(sorted(root.glob("tsconfig.*.json")))
        assert len(ts) == 2 and "node_modules" in ts[0] and "outside" in ts[1], ts
        vi = vite_problems(sorted(root.glob("vite*.config.ts")))
        assert len(vi) == 2 and "no cacheDir" in vi[0] and "node_modules" in vi[1], vi
