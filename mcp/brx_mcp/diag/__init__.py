"""BRX diagnostic game — a structured, repeatable end-to-end test suite.

Formalises the ad-hoc hardware sessions (experiment-log #33–40) into a catalog of
test cases, each verified from wire evidence or a human check, producing a pass/fail
scorecard. Works over BLE today; IR cases are marked needs-hardware and SKIP.

The ESP32 bridge now EXISTS (`brx_mcp/irbridge.py`, `hardware/esp32-ir-bridge/`) and
is driven by `python -m brx_mcp ir-capture|ir-emit|ir-range`. What is still missing is
the wiring: the two `ir.*` cases below have no send/verify, so they skip until someone
routes them through `IRBridge` (`hardware/esp32-ir-bridge/README.md`, ~line 137).

The verification logic (predicates, scorecard aggregation, requirement gating) is pure
and transport-free — unit-tested without Bluetooth. The runner is the thin BLE layer.
"""

from .model import DiagCase, Outcome, Result, Report, Capability
from .cases import CATALOG, cases_for

__all__ = [
    "DiagCase", "Outcome", "Result", "Report", "Capability",
    "CATALOG", "cases_for",
]
