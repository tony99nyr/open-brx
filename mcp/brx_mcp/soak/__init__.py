"""The `soak` subcommand: an unattended liveness-and-traffic soak for one gun.

docs/bench-screamers-2026-09-19.md Phase C. `patterns.py` holds the traffic patterns (data);
`runner.py` holds the run loop (connect, arm, probe, classify, log, summarise). The CLI glue is
`brx_mcp/__main__.py _soak`/`_dispatch_soak` (`python -m brx_mcp soak ...`).
"""
from .patterns import PATTERNS, SoakPattern, ScheduledFrames, HANG_LIST, assert_pattern_is_safe
from .runner import Clock, SoakSummary, run_soak

__all__ = [
    "PATTERNS", "SoakPattern", "ScheduledFrames", "HANG_LIST", "assert_pattern_is_safe",
    "Clock", "SoakSummary", "run_soak",
]
