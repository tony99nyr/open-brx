"""The `soak` subcommand: an unattended liveness-and-traffic soak for one gun.

docs/bench-screamers-2026-09-19.md Phase C. `patterns.py` holds the traffic patterns (data);
`runner.py` holds the run loop (connect, arm, probe, classify, log, summarise). The CLI glue is
`brx_mcp/__main__.py _soak`/`_dispatch_soak` (`python -m brx_mcp soak ...`).

`--phone-pacing` (F283) makes the run send each frame with the phone's own chunk size and pacing
(`app/src/brxlink.js` `WRITE_PACING`) via `ble.py ConnectionManager.send_phone_paced()`, instead of
this instrument's own flatter, slower `_write()` pacing. A Phase C run counts as a pass only when it
ran with this flag.
"""
from .patterns import PATTERNS, SoakPattern, ScheduledFrames, HANG_LIST, assert_pattern_is_safe
from .runner import Clock, SoakSummary, run_soak

__all__ = [
    "PATTERNS", "SoakPattern", "ScheduledFrames", "HANG_LIST", "assert_pattern_is_safe",
    "Clock", "SoakSummary", "run_soak",
]
