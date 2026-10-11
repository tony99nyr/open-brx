"""Run a generator script with an audit hook and write every repo file it opens or imports to a JSON list.

    python py_audit.py <log.json> <repo-root> <script> [args...]

mcp/tests/test_generated_fresh.py uses it to hold scripts/generated.json's `sources` to what a generator really reads.
Both `open` events and `sys.modules` are read, because a cached .pyc import never opens the .py source."""
import json
import os
import runpy
import sys

log_path, root, script, *args = sys.argv[1:]
root = os.path.realpath(root)
seen: set[str] = set()


def note(path) -> None:
    if not isinstance(path, str):
        return
    real = os.path.realpath(path)
    if real == os.path.realpath(__file__):
        return
    if real.startswith(root + os.sep) and "__pycache__" not in real and f"{os.sep}.venv{os.sep}" not in real \
            and f"{os.sep}.git{os.sep}" not in real and os.path.isfile(real):
        seen.add(os.path.relpath(real, root))


def hook(event, event_args):
    if event == "open":
        note(event_args[0])


sys.addaudithook(hook)
sys.argv = [script, *args]
code = 0
try:
    runpy.run_path(script, run_name="__main__")
except SystemExit as exc:
    code = exc.code if isinstance(exc.code, int) else (0 if exc.code is None else 1)
for module in list(sys.modules.values()):
    note(getattr(module, "__file__", None))
with open(log_path, "w", encoding="utf-8") as fh:
    json.dump(sorted(seen), fh)
sys.exit(code)
