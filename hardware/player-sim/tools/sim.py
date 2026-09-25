#!/usr/bin/env python3
"""Build and flash the player-sim sketch from WSL with the Windows arduino-cli.

Run with WSL system python3. Windows arduino-cli cannot build from a \\\\wsl.localhost path, so the
sketch is staged onto the Windows filesystem first (the same approach as hardware/m5sticks3/tools/stick.py).
Every Windows-side argument crosses via argv: WSL -> Windows environment variables do not cross.

  python3 hardware/player-sim/tools/sim.py compile
  python3 hardware/player-sim/tools/sim.py flash COMn     # the rig board's CH343 UART port
  python3 hardware/player-sim/tools/sim.py restore emit COMn      # put ir_emit.ino back (board B)
  python3 hardware/player-sim/tools/sim.py restore capture COMn   # put ir_capture.ino back (board A)
  (restore without a port only compiles the rig sketch)
"""
from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

SKETCH_DIR = Path(__file__).resolve().parent.parent  # hardware/player-sim
CLI_EXE = ("/mnt/c/Users/Tony/AppData/Local/Programs/Arduino IDE/resources/app/lib/backend/"
           "resources/arduino-cli.exe")
FQBN = "esp32:esp32:esp32s3"  # "ESP32S3 Dev Module", the IR-rig boards (hardware/esp32-ir-bridge)
STAGE_DIR_WSL = Path("/mnt/c/Users/Tony/brx-player-sim/player_sim")  # folder name must match the .ino
STAGE_DIR_WIN = r"C:\Users\Tony\brx-player-sim\player_sim"
RIG_DIR = SKETCH_DIR.parent / "esp32-ir-bridge"
RIG_SKETCHES = {"emit": "ir_emit", "capture": "ir_capture"}
STAGE_CWD = "/mnt/c"  # avoids the UNC-cwd warning arduino-cli prints when launched from a WSL path


def stage() -> None:
    STAGE_DIR_WSL.mkdir(parents=True, exist_ok=True)
    wanted = {p.name for p in SKETCH_DIR.iterdir() if p.suffix in (".ino", ".h")}
    for old in STAGE_DIR_WSL.iterdir():
        if old.is_file() and old.suffix in (".ino", ".h") and old.name not in wanted:
            old.unlink()
    for name in wanted:
        shutil.copyfile(SKETCH_DIR / name, STAGE_DIR_WSL / name)


def stage_rig(name: str) -> str:
    """Stage one rig sketch ALONE (its folder holds both .ino files, which must not build together)."""
    dest = Path("/mnt/c/Users/Tony/brx-player-sim") / name
    dest.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(RIG_DIR / f"{name}.ino", dest / f"{name}.ino")
    return rf"C:\Users\Tony\brx-player-sim\{name}"


def run(argv: list[str]) -> int:
    return subprocess.run(argv, cwd=STAGE_CWD).returncode


def main(args: list[str]) -> int:
    if args and args[0] == "restore" and len(args) in (2, 3) and args[1] in RIG_SKETCHES:
        win = stage_rig(RIG_SKETCHES[args[1]])
        rc = run([CLI_EXE, "compile", "--fqbn", FQBN, win])
        if rc or len(args) == 2:
            return rc
        return run([CLI_EXE, "upload", "--fqbn", FQBN, "-p", args[2], win])
    if not args or args[0] not in ("compile", "flash") or (args[0] == "flash" and len(args) != 2):
        print(__doc__)
        return 2
    stage()
    rc = run([CLI_EXE, "compile", "--fqbn", FQBN, STAGE_DIR_WIN])
    if rc or args[0] == "compile":
        return rc
    return run([CLI_EXE, "upload", "--fqbn", FQBN, "-p", args[1], STAGE_DIR_WIN])


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
