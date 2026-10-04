"""A repeating failure that must be COUNTED and shown, not logged once per occurrence (O7, O8).

`FailureTrack` is for a thing that runs often (every envelope, every 2 s snapshot, every 0.5 s tick) and
that can break for a long time (a full disk, a bad config). It logs the FIRST failure with its traceback,
then at most one line per `LOG_EVERY_MS` with the running count, and it exposes `{since, count, error}`
for the snapshot until the next success clears it. A transition (first failure, first success after one)
tells the caller to push a new snapshot to the console.
"""
from __future__ import annotations

import logging
from typing import Callable

LOG_EVERY_MS = 60_000
ERROR_TEXT_MAX = 200


class FailureTrack:
    def __init__(self, what: str, now_ms: Callable[[], int], log: logging.Logger | None = None):
        self.what = what
        self._now = now_ms
        self._log = log or logging.getLogger("brx.mc")
        self.since: int | None = None
        self.count = 0
        self.error = ""
        self._last_logged = 0

    @property
    def failing(self) -> bool:
        return self.since is not None

    def fail(self, exc: BaseException, detail: str = "") -> bool:
        """Record one failure. Returns True when this is the first of a streak (the view just changed)."""
        now = self._now()
        first = self.since is None
        self.count += 1
        self.error = f"{type(exc).__name__}: {exc}"[:ERROR_TEXT_MAX]
        suffix = f" ({detail})" if detail else ""
        if first:
            self.since = now
            self._last_logged = now
            self._log.error("%s failed%s: %s", self.what, suffix, self.error, exc_info=exc)
        elif now - self._last_logged >= LOG_EVERY_MS:
            self._last_logged = now
            self._log.error("%s still failing%s: %d failures since %d ms ago, last: %s",
                            self.what, suffix, self.count, now - (self.since or now), self.error)
        return first

    def ok(self) -> bool:
        """Record a success. Returns True when it ended a streak (the view just changed)."""
        if self.since is None:
            return False
        self._log.warning("%s recovered after %d failures", self.what, self.count)
        self.since = None
        self.count = 0
        self.error = ""
        return True

    def view(self) -> dict | None:
        if self.since is None:
            return None
        return {"since": self.since, "count": self.count, "error": self.error}
