"""The append-only logs (docs/archive/followups-closed.md, docs/experiment-log/*.md) carry `merge=union` in
.gitattributes, so two branches that each append a row merge with no conflict and keep both rows. The land lane's
`git merge` honours the attribute because it merges inside a checkout of main, where .gitattributes lives."""
import pathlib
import shutil
import subprocess
import tempfile

from _skip import needs

REPO = pathlib.Path(__file__).resolve().parents[2]
GIT = shutil.which("git")
LOGS = ["docs/archive/followups-closed.md", "docs/experiment-log/2026-10.md"]


def _git(root, *args, check=True):
    return subprocess.run([GIT, *args], cwd=root, capture_output=True, text=True, check=check)


def _merge_two_appends(attributes: str) -> tuple[int, dict[str, str]]:
    with tempfile.TemporaryDirectory() as d:
        root = pathlib.Path(d)
        _git(root, "init", "-q", "-b", "main")
        _git(root, "config", "user.email", "t@example.invalid")
        _git(root, "config", "user.name", "t")
        (root / ".gitattributes").write_text(attributes, encoding="utf-8")
        for rel in LOGS:
            (root / rel).parent.mkdir(parents=True, exist_ok=True)
            (root / rel).write_text("# log\n- 2026-10-01 **F1** closed\n", encoding="utf-8")
        _git(root, "add", "-A")
        _git(root, "commit", "-q", "-m", "base")
        for branch, row in (("a", "- 2026-10-04 **F2** closed (lane a)\n"), ("b", "- 2026-10-04 **F3** closed (lane b)\n")):
            _git(root, "checkout", "-q", "-b", branch, "main")
            for rel in LOGS:
                with open(root / rel, "a", encoding="utf-8") as f:
                    f.write(row)
            _git(root, "commit", "-q", "-am", branch)
        _git(root, "checkout", "-q", "a")
        r = _git(root, "merge", "--no-edit", "-q", "b", check=False)
        return r.returncode, {rel: (root / rel).read_text(encoding="utf-8") for rel in LOGS}


def test_two_appends_to_the_logs_merge_and_keep_both_rows():
    needs(GIT, "git")
    code, files = _merge_two_appends((REPO / ".gitattributes").read_text(encoding="utf-8"))
    assert code == 0, "two appends to an append-only log must merge with no conflict"
    for rel, text in files.items():
        assert "F2" in text and "F3" in text and "<<<<<<<" not in text, (rel, text)


def test_without_the_attribute_the_same_appends_conflict():
    """The control: proves the test above passes because of the attribute, not because git merges anyway."""
    needs(GIT, "git")
    code, _ = _merge_two_appends("")
    assert code != 0, "without merge=union the two appends should conflict"
