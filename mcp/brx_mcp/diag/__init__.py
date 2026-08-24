"""BRX diagnostic game — a structured, repeatable end-to-end test suite.

Formalises the ad-hoc hardware sessions (experiment-log #33–40) into a catalog of
test cases, each verified from wire evidence or a human check, producing a pass/fail
scorecard. Works over BLE today; IR cases are marked needs-hardware and SKIP until the
ESP32 bridge exists (`hardware/ir-prototype-plan.md`).

The verification logic (predicates, scorecard aggregation, requirement gating) is pure
and transport-free — unit-tested without Bluetooth. The runner is the thin BLE layer.
"""

from .model import DiagCase, Outcome, Result, Report, Capability
from .cases import CATALOG, cases_for

__all__ = [
    "DiagCase", "Outcome", "Result", "Report", "Capability",
    "CATALOG", "cases_for",
]
