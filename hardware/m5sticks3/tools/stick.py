#!/usr/bin/env python3
"""Bench CLI for the M5StickS3 station node. Run with WSL system python3 -- it never imports pyserial
or bleak itself; every command that needs a serial port or BLE shells out to Windows-side programs.

Why: WSL cannot see USB, so the board and the two IR-rig CH343 boards are only visible to Windows.
Windows arduino-cli also cannot build from a \\wsl.localhost path, so `compile`/`flash` stage the
sketch onto the Windows filesystem first (see `stage()`). Every Windows-side argument crosses via
argv, never an environment variable -- WSL -> Windows env vars do not cross and silently vanish.

Subcommands:
  ports                    list COM ports with vid/pid/serial, label the Stick and the rig boards
  compile                  stage the sketch and run arduino-cli compile, print the size line
  flash [--port COMn]      stage + compile + upload to the auto-detected Stick port
  cmd <secs> [cmd ...]     send serial commands, print every line for secs (delegates to sercmd.py)
  raw <secs>               toggle RAW on, capture for secs, summarise with rawscan.py
  ble [secs]               scan BLE adverts for secs (delegates to blescan.py)
  status                   send STATUS and print the parsed fields

`ports` is the only subcommand safe to run without a Stick plugged in; every other subcommand that
touches the board fails loudly (never silently) when none is found.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

TOOLS_DIR = Path(__file__).resolve().parent
SKETCH_DIR = TOOLS_DIR.parent  # hardware/m5sticks3

# ---------------------------------------------------------------------------
# Windows-side paths and IDs (2026-09-23 bench facts; see hardware/m5sticks3/README.md)
# ---------------------------------------------------------------------------
CLI_EXE = ("/mnt/c/Users/Tony/AppData/Local/Programs/Arduino IDE/resources/app/lib/backend/"
           "resources/arduino-cli.exe")
WIN_PYTHON = "/mnt/c/Users/Tony/.brx-mcp/venv/Scripts/python.exe"
BOARD_URL = "https://static-cdn.m5stack.com/resource/arduino/package_m5stack_index.json"
FQBN = "m5stack:esp32:m5stack_sticks3:PartitionScheme=default_8MB,CDCOnBoot=cdc"
STAGE_DIR_WSL = Path("/mnt/c/Users/Tony/brx-sticks3/m5sticks3")  # folder name must match the .ino
STAGE_DIR_WIN = r"C:\Users\Tony\brx-sticks3\m5sticks3"
STAGE_CWD = "/mnt/c"  # avoid the UNC-cwd warning arduino-cli prints when launched from a WSL path

# USB identity (2026-09-23 bench): the Stick enumerates vendor id 0x303a; pid 0x1001 running our
# firmware or in download mode, 0x832b the factory firmware. The IR rig boards are CH343 (0x1a86).
STICK_VID = 0x303A
STICK_PID_FW = 0x1001
STICK_PID_FACTORY = 0x832B
RIG_VID = 0x1A86
RIG_SERIALS = {"5C93045958": "IR rig receiver", "5C4C136487": "IR rig emitter"}

# A one-shot probe run on the Windows side with `-c`; needs no file on either filesystem.
_PORT_PROBE_SRC = (
    "import json, serial.tools.list_ports as lp\n"
    "for p in lp.comports():\n"
    "    print(json.dumps({'device': p.device, 'vid': p.vid, 'pid': p.pid, 'serial': p.serial_number}))\n"
)

_STATUS_KV = re.compile(r"(\w+)=(\S+)")


# ---------------------------------------------------------------------------
# Pure helpers -- unit-tested in mcp/tests/test_stick_cli.py without hardware or Windows.
# ---------------------------------------------------------------------------

def sketch_files(src_dir: Path) -> list[Path]:
    """The .ino/.h files that make up the sketch, sorted by name."""
    return sorted(p for p in src_dir.iterdir() if p.suffix in (".ino", ".h"))


def stage(src_dir: Path, dest_dir: Path) -> list[Path]:
    """Copy the sketch's .ino/.h files into dest_dir. Returns the copied paths.

    dest_dir must be named after the .ino (arduino-cli requires it); the real bench target is
    STAGE_DIR_WSL, but tests pass a throwaway directory so this never touches the real one.
    """
    dest_dir.mkdir(parents=True, exist_ok=True)
    wanted = {f.name for f in sketch_files(src_dir)}
    for old in dest_dir.iterdir():   # a renamed or deleted .h must not keep compiling from the staging folder
        if old.is_file() and old.suffix in (".ino", ".h") and old.name not in wanted:
            old.unlink()
    copied = []
    for f in sketch_files(src_dir):
        target = dest_dir / f.name
        shutil.copyfile(f, target)
        copied.append(target)
    return copied


def ports_argv(win_python: str = WIN_PYTHON) -> list[str]:
    return [win_python, "-c", _PORT_PROBE_SRC]


def compile_argv(cli_exe: str = CLI_EXE, fqbn: str = FQBN, board_url: str = BOARD_URL,
                  win_path: str = STAGE_DIR_WIN) -> list[str]:
    return [cli_exe, "compile", "--fqbn", fqbn, "--additional-urls", board_url, win_path]


def upload_argv(port: str, cli_exe: str = CLI_EXE, fqbn: str = FQBN, board_url: str = BOARD_URL,
                 win_path: str = STAGE_DIR_WIN) -> list[str]:
    return [cli_exe, "upload", "--fqbn", fqbn, "-p", port, "--additional-urls", board_url, win_path]


def cmd_argv(port: str, secs: float, commands: list[str], win_python: str = WIN_PYTHON,
             sercmd_path: str | None = None) -> list[str]:
    sercmd_path = sercmd_path or str(TOOLS_DIR / "sercmd.py")
    return [win_python, sercmd_path, port, str(secs), *commands]


def ble_argv(secs: float | None, win_python: str = WIN_PYTHON, blescan_path: str | None = None) -> list[str]:
    blescan_path = blescan_path or str(TOOLS_DIR / "blescan.py")
    argv = [win_python, blescan_path]
    if secs is not None:
        argv.append(str(secs))
    return argv


def classify_port(vid, pid, serial: str | None) -> str:
    """Label a port from its USB identity, so `ports` can mark the Stick and the rig boards."""
    if vid == STICK_VID:
        if pid == STICK_PID_FW:
            return "Stick (firmware / download mode)"
        if pid == STICK_PID_FACTORY:
            return "Stick (factory firmware)"
        return f"Stick (unknown pid 0x{pid:04x})"
    if vid == RIG_VID:
        return RIG_SERIALS.get(serial or "", "IR rig board (unknown serial)")
    return "unknown"


def parse_ports_json(output: str) -> list[dict]:
    """Parse the port probe's JSON-lines stdout into a list of dicts. Blank lines are ignored."""
    ports = []
    for line in output.splitlines():
        line = line.strip()
        if not line:
            continue
        ports.append(json.loads(line))
    return ports


def select_stick_port(ports: list[dict], explicit: str | None = None) -> str:
    """Pick the Stick's COM port by vendor id. Raises (never guesses) when it is ambiguous."""
    if explicit:
        # An explicit port must still BE a Stick: a mistyped COM number must never reach a rig board or anything else.
        match = [p for p in ports if p.get("device", "").upper() == explicit.upper()]
        if not match:
            raise SystemExit(f"{explicit} is not an enumerated port -- run `stick.py ports`")
        if match[0].get("vid") != STICK_VID:
            raise SystemExit(f"{explicit} is not a Stick (vendor id {match[0].get('vid')!r}, want 0x303a) -- refusing")
        return match[0]["device"]
    sticks = [p for p in ports if p.get("vid") == STICK_VID]
    if not sticks:
        raise SystemExit("no Stick found (USB vendor id 0x303a) -- is it plugged in and enumerated?")
    if len(sticks) > 1:
        found = ", ".join(p.get("device", "?") for p in sticks)
        raise SystemExit(f"{len(sticks)} Stick-vid ports found ({found}) -- pass --port to pick one")
    return sticks[0]["device"]


def parse_status(lines: list[str]) -> dict | None:
    """Pull the STATUS reply's key=value fields out of raw (possibly timestamp-prefixed) serial
    lines. Returns None if no STATUS line is present. `charges` is split into a list of ints."""
    for line in lines:
        idx = line.find("STATUS mode=")
        if idx == -1:
            continue
        body = line[idx + len("STATUS "):]
        fields = dict(_STATUS_KV.findall(body))
        if "charges" in fields:
            fields["charges"] = [int(x) for x in fields["charges"].split(",")]
        return fields
    return None


# ---------------------------------------------------------------------------
# Subcommands
# ---------------------------------------------------------------------------

def _run(argv: list[str], timeout: float, cwd: str | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(argv, cwd=cwd, capture_output=True, text=True, timeout=timeout)


def _list_ports() -> list[dict]:
    proc = _run(ports_argv(), timeout=20)
    if proc.returncode != 0:
        sys.exit(f"port probe failed:\n{proc.stderr}")
    return parse_ports_json(proc.stdout)


def do_ports(_args) -> None:
    for p in _list_ports():
        vid, pid, serial = p.get("vid"), p.get("pid"), p.get("serial")
        if vid is None:
            print(f"{p['device']}  (no USB vid)")
            continue
        label = classify_port(vid, pid, serial)
        print(f"{p['device']}  vid={vid:#06x} pid={pid:#06x} serial={serial}  {label}")


def do_compile(_args) -> None:
    copied = stage(SKETCH_DIR, STAGE_DIR_WSL)
    print(f"staged {len(copied)} files to {STAGE_DIR_WSL}")
    proc = _run(compile_argv(), timeout=300, cwd=STAGE_CWD)
    if proc.returncode != 0:
        print(proc.stdout)
        print(proc.stderr, file=sys.stderr)
        sys.exit(proc.returncode)
    for line in proc.stdout.splitlines():
        if "Sketch uses" in line or "Global variables" in line:
            print(line)


def do_flash(args) -> None:
    port = select_stick_port(_list_ports(), explicit=args.port)
    copied = stage(SKETCH_DIR, STAGE_DIR_WSL)
    print(f"staged {len(copied)} files to {STAGE_DIR_WSL}")
    cproc = _run(compile_argv(), timeout=300, cwd=STAGE_CWD)
    if cproc.returncode != 0:
        print(cproc.stdout)
        print(cproc.stderr, file=sys.stderr)
        sys.exit(cproc.returncode)
    for line in cproc.stdout.splitlines():
        if "Sketch uses" in line or "Global variables" in line:
            print(line)
    print(f"uploading to {port} ...")
    uproc = _run(upload_argv(port), timeout=120, cwd=STAGE_CWD)
    print(uproc.stdout)
    if uproc.stderr:
        print(uproc.stderr, file=sys.stderr)
    sys.exit(uproc.returncode)


def do_cmd(args) -> None:
    port = select_stick_port(_list_ports(), explicit=args.port)
    proc = _run(cmd_argv(port, args.secs, args.commands), timeout=args.secs + 15)
    print(proc.stdout)
    if proc.stderr:
        print(proc.stderr, file=sys.stderr)
    if proc.returncode:
        sys.exit(proc.returncode)


def do_raw(args) -> None:
    """Toggle RAW on, capture for secs, pipe the capture through rawscan.py for a summary.

    Leaves RAW on afterwards (the firmware's `r` is a toggle that survives until power-cycle;
    `sercmd.py`'s own STATUS/`s` check exists in native_capture.py, not needed for one bench look)."""
    port = select_stick_port(_list_ports(), explicit=args.port)
    proc = _run(cmd_argv(port, args.secs, ["RAW ON"]), timeout=args.secs + 15)
    if proc.stderr:
        print(proc.stderr, file=sys.stderr)
    if proc.returncode:
        sys.exit(proc.returncode)
    summary = subprocess.run([sys.executable, str(TOOLS_DIR / "rawscan.py")], input=proc.stdout,
                              capture_output=True, text=True, timeout=30)
    print(summary.stdout)
    if summary.stderr:
        print(summary.stderr, file=sys.stderr)
    if summary.returncode:
        sys.exit(summary.returncode)


def do_ble(args) -> None:
    proc = _run(ble_argv(args.secs), timeout=(args.secs or 10) + 15)
    print(proc.stdout)
    if proc.stderr:
        print(proc.stderr, file=sys.stderr)
    if proc.returncode:
        sys.exit(proc.returncode)


def do_status(args) -> None:
    port = select_stick_port(_list_ports(), explicit=args.port)
    proc = _run(cmd_argv(port, 1.5, ["STATUS"]), timeout=15)
    if proc.stderr:
        print(proc.stderr, file=sys.stderr)
    fields = parse_status(proc.stdout.splitlines())
    if fields is None:
        print("no STATUS reply seen; raw output:")
        print(proc.stdout)
        sys.exit(1)
    for k, v in fields.items():
        print(f"{k}: {v}")


# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="stick.py", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="subcommand", required=True)

    sp = sub.add_parser("ports", help="list COM ports, mark the Stick and the rig boards")
    sp.set_defaults(func=do_ports)

    sp = sub.add_parser("compile", help="stage the sketch and compile it")
    sp.set_defaults(func=do_compile)

    sp = sub.add_parser("flash", help="stage + compile + upload to the Stick")
    sp.add_argument("--port", help="COM port, if auto-detect is ambiguous or wrong")
    sp.set_defaults(func=do_flash)

    sp = sub.add_parser("cmd", help="send serial commands, print output for secs")
    sp.add_argument("secs", type=float)
    sp.add_argument("commands", nargs="*")
    sp.add_argument("--port", help="COM port, if auto-detect is ambiguous or wrong")
    sp.set_defaults(func=do_cmd)

    sp = sub.add_parser("raw", help="RAW capture for secs, summarised by rawscan.py")
    sp.add_argument("secs", type=float)
    sp.add_argument("--port", help="COM port, if auto-detect is ambiguous or wrong")
    sp.set_defaults(func=do_raw)

    sp = sub.add_parser("ble", help="scan BLE adverts for secs")
    sp.add_argument("secs", type=float, nargs="?", default=None)
    sp.set_defaults(func=do_ble)

    sp = sub.add_parser("status", help="send STATUS, print the parsed fields")
    sp.add_argument("--port", help="COM port, if auto-detect is ambiguous or wrong")
    sp.set_defaults(func=do_status)

    return p


def main(argv: list[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
