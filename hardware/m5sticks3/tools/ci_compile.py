#!/usr/bin/env python3
"""T9 (2026-10-10): compile the Stick firmware in CI with the pinned toolchain, twice.

The bench builds through tools/stick.py on Windows. CI has a Linux arduino-cli on PATH instead, so this script reuses
stick.py's pins (toolchain.json), staging, build flags and toolchain check, and only swaps the executable and the
staging folder. It installs the pinned core and libraries, refuses any other installed version (the same rule as
`stick.py compile`), then compiles the flashed build and the revive-feedback build (`stick.py compile --revive-on`).

    python3 hardware/m5sticks3/tools/ci_compile.py            # install, check, compile twice
    python3 hardware/m5sticks3/tools/ci_compile.py --dry-run  # print the commands only
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import stick  # noqa: E402

CLI = "arduino-cli"


def install_argvs(pins: dict, cli: str = CLI) -> list[list[str]]:
    url = ["--additional-urls", stick.BOARD_URL]
    out = [[cli, "core", "update-index", *url]]
    out += [[cli, "core", "install", f"{core}@{v}", *url] for core, v in pins["core"].items()]
    # --no-deps: a library's undeclared-version dependency would float to its latest release, which the bench never
    # saw. Every library the sketch needs is pinned in toolchain.json instead; a missing one fails the compile.
    out += [[cli, "lib", "install", "--no-deps", f"{lib}@{v}"] for lib, v in pins["libraries"].items()]
    return out


def compile_argvs(sketch: str, fw_sha: str | None, cli: str = CLI) -> list[list[str]]:
    return [stick.compile_argv(cli_exe=cli, win_path=sketch, revive_on=r, fw_sha=fw_sha) for r in (False, True)]


def check_installed(pins: dict, listed) -> None:
    """stick.py's rule: exit 2 unless the installed core and libraries are the pinned ones. `listed(*sub)` returns
    arduino-cli's JSON for `core list` or `lib list --all`."""
    bad = stick.toolchain_mismatches(pins, listed("core", "list"), listed("lib", "list", "--all"))
    if bad:
        print("error: the installed toolchain is not the one toolchain.json pins:\n  " + "\n  ".join(bad), file=sys.stderr)
        sys.exit(2)


def run(argv: list[str]) -> str:
    print("+ " + " ".join(argv), flush=True)
    proc = subprocess.run(argv, capture_output=True, text=True)
    if proc.returncode != 0:
        print(proc.stdout)
        print(proc.stderr, file=sys.stderr)
        sys.exit(proc.returncode)
    return proc.stdout


def main(argv: list[str]) -> None:
    dry = "--dry-run" in argv
    pins = stick.load_toolchain()
    with tempfile.TemporaryDirectory() as tmp:
        sketch = Path(tmp) / stick.SKETCH_DIR.name   # arduino-cli needs the folder named after the .ino
        compiles = compile_argvs(str(sketch), stick.firmware_sha())
        if dry:
            for a in install_argvs(pins) + compiles:
                print(" ".join(a))
            return
        for a in install_argvs(pins):
            run(a)
        check_installed(pins, lambda *sub: json.loads(run([CLI, *sub, "--format", "json"])))
        stick.stage(stick.SKETCH_DIR, sketch)
        for a in compiles:
            out = run(a)
            print("\n".join(l for l in out.splitlines() if "Sketch uses" in l or "Global variables" in l))


if __name__ == "__main__":
    main(sys.argv[1:])
