"""F595 item 1 (field 2026-10-17): the MC MacBook slept through every timed whistle. The phones' results then waited for it
to wake: 355 of the 540 s of post-whistle wait measured. The runbook's `caffeinate` line was a step a person had to remember.
MC now holds the Mac awake itself, for as long as its own process lives.

`caffeinate -dimsu -w <pid>`: no display, idle, disk or system (on AC power) sleep until that pid exits, so a crashed MC
never leaves the Mac held awake. macOS only. Skipped for an --ephemeral run (most tests and every demo e2e); a Mac test
that starts MC without --ephemeral spawns one, and `-w` ends it with that MC. Never fatal: no `caffeinate`, or a failed
spawn, prints one line and MC carries on.
"""
from __future__ import annotations

import atexit
import logging
import os
import shutil
import subprocess
import sys
from typing import Any, Callable

log = logging.getLogger("brx.mc.keepawake")


def start(*, ephemeral: bool, platform: str = sys.platform, which: Callable[[str], str | None] = shutil.which,
          popen: Callable[..., Any] = subprocess.Popen, pid: int | None = None,
          register: Callable[..., Any] = atexit.register) -> Any | None:
    """Spawn `caffeinate` for this MC, or return None when it does not apply or cannot start."""
    if platform != "darwin" or ephemeral:
        return None
    exe = which("caffeinate")
    if not exe:
        print("  keep-awake: caffeinate not found -- the Mac may sleep during a match", flush=True)
        return None
    try:
        proc = popen([exe, "-dimsu", "-w", str(pid or os.getpid())],
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except OSError as e:
        print(f"  keep-awake: caffeinate did not start ({e}) -- the Mac may sleep during a match", flush=True)
        return None
    print("  keep-awake: caffeinate holds the Mac awake while MC runs", flush=True)
    log.info("keep-awake: caffeinate pid %s", getattr(proc, "pid", "?"))
    register(stop, proc)
    return proc


def stop(proc: Any | None) -> None:
    """End our `caffeinate` (MC's exit path). `-w` would end it anyway once MC's pid is gone."""
    if proc is not None and proc.poll() is None:
        try:
            proc.terminate()
        except OSError:
            pass
