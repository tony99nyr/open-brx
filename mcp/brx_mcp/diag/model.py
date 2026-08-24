"""Data model for the diagnostic game: cases, results, the scorecard report.

Everything here is pure (no I/O), so it unit-tests without hardware.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Callable, Optional


class Capability(str, Enum):
    """What a case needs available to run; missing → SKIP (not FAIL)."""
    BLE = "ble"            # one connected tagger (baseline; always present in a run)
    TWO_GUNS = "2guns"     # a second tagger as a shooter
    HUMAN = "human"        # a person to observe/answer (sound heard? LED colour?)
    IR = "ir"             # the ESP32 IR bridge (capture/emit) — not built yet


class Outcome(str, Enum):
    PASS = "pass"
    FAIL = "fail"
    SKIP = "skip"       # requirement unmet
    ERROR = "error"     # exception while running
    MANUAL = "manual"   # ran, but verification is a human's call (recorded, not auto-scored)


# A verify predicate takes the list of parsed rx events seen in the case's window
# and returns (passed: bool, detail: str). Pure → testable with synthetic events.
Verify = Callable[[list[dict]], "tuple[bool, str]"]


@dataclass
class DiagCase:
    id: str
    name: str
    category: str
    requires: tuple[Capability, ...] = ()
    # Frames to send before the measured window (config/spawn/etc.) — not verified.
    setup: tuple[str, ...] = ()
    # Frames whose effect we measure.
    frames: tuple[str, ...] = ()
    # How long to listen for rx after sending `frames`, in ms.
    window_ms: int = 800
    # Auto verification over the rx events (None → not auto-verified).
    verify: Optional[Verify] = None
    # A human instruction shown before the window (e.g. "pull the trigger now").
    prompt_before: str = ""
    # A yes/no question asked after the window; its answer is the result.
    ask_after: str = ""
    # One-line explanation of what the case proves.
    proves: str = ""


@dataclass
class Result:
    case_id: str
    name: str
    category: str
    outcome: Outcome
    detail: str = ""
    evidence: list[str] = field(default_factory=list)  # raw rx frames captured

    def to_dict(self) -> dict:
        return {
            "case_id": self.case_id,
            "name": self.name,
            "category": self.category,
            "outcome": self.outcome.value,
            "detail": self.detail,
            "evidence": self.evidence,
        }


@dataclass
class Report:
    target: str
    results: list[Result] = field(default_factory=list)

    def add(self, r: Result) -> None:
        self.results.append(r)

    def counts(self) -> dict[str, int]:
        c = {o.value: 0 for o in Outcome}
        for r in self.results:
            c[r.outcome.value] += 1
        return c

    def passed(self) -> bool:
        """A run is 'clean' if nothing FAILed or ERRORed (skips/manual are OK)."""
        return not any(r.outcome in (Outcome.FAIL, Outcome.ERROR) for r in self.results)

    def scorecard(self) -> str:
        """Human-readable summary grouped by category."""
        icon = {
            Outcome.PASS: "✅", Outcome.FAIL: "❌", Outcome.SKIP: "⏭️ ",
            Outcome.ERROR: "💥", Outcome.MANUAL: "📝",
        }
        lines = [f"\n=== BRX diagnostic scorecard — {self.target} ==="]
        cats: dict[str, list[Result]] = {}
        for r in self.results:
            cats.setdefault(r.category, []).append(r)
        for cat, rs in cats.items():
            lines.append(f"\n[{cat}]")
            for r in rs:
                d = f" — {r.detail}" if r.detail else ""
                lines.append(f"  {icon[r.outcome]} {r.name}{d}")
        c = self.counts()
        lines.append(
            f"\nTotals: {c['pass']} pass · {c['fail']} fail · {c['skip']} skip · "
            f"{c['manual']} manual · {c['error']} error   "
            f"→ {'CLEAN' if self.passed() else 'ISSUES'}"
        )
        return "\n".join(lines)

    def to_dict(self) -> dict:
        return {
            "target": self.target,
            "counts": self.counts(),
            "clean": self.passed(),
            "results": [r.to_dict() for r in self.results],
        }


# ---- reusable verify predicates (pure) -------------------------------------- #
def saw_command(name: str) -> Verify:
    def v(events: list[dict]) -> tuple[bool, str]:
        hits = [e for e in events if e.get("command") == name]
        return (bool(hits), f"{len(hits)}× ${name}" if hits else f"no ${name} seen")
    return v


def saw_pong() -> Verify:
    return saw_command("PONG")


def hp_dropped() -> Verify:
    """A $HP where armor or hp fell below the spawn baseline (took damage)."""
    def v(events: list[dict]) -> tuple[bool, str]:
        hps = [e for e in events if e.get("command") == "HP"]
        for e in hps:
            toks = e.get("tokens", [])
            # $HP,<hp>,<armor>,<shield>
            try:
                hp, armor = int(toks[1]), int(toks[2])
            except (IndexError, ValueError):
                continue
            if hp < 45 or armor < 70:  # below GAME_CONFIG spawn 45/70/70
                return (True, f"damage seen: {e['raw']}")
        return (False, "no $HP below spawn baseline")
    return v


def ammo_decremented() -> Verify:
    """$ALCD magazine count went down (the gun actually fired)."""
    def v(events: list[dict]) -> tuple[bool, str]:
        mags = []
        for e in events:
            if e.get("command") == "ALCD":
                try:
                    mags.append(int(e["tokens"][1]))
                except (IndexError, ValueError):
                    pass
        if len(mags) >= 2 and min(mags) < max(mags):
            return (True, f"mag {max(mags)}→{min(mags)}")
        return (False, "no mag decrement (did it fire?)")
    return v


def grenade_beacon() -> Verify:
    """A $HIR with token2==15 (grenade-sourced IR)."""
    def v(events: list[dict]) -> tuple[bool, str]:
        for e in events:
            if e.get("command") == "HIR":
                t = e.get("tokens", [])
                if len(t) > 2 and t[2] == "15":
                    return (True, f"grenade beacon: {e['raw']}")
        return (False, "no grenade beacon ($HIR token2=15)")
    return v
