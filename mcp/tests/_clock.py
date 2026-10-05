"""A virtual clock for async tests that would otherwise sleep for real (test_helpers_lint.py guards the copy)."""
import asyncio


class FakeClock:
    """Advances instantly: `sleep(s)` moves the virtual clock forward and yields once, instead of
    actually waiting. Every call is recorded so a test can pin exact delay values and detect a call
    that should never have happened."""

    def __init__(self):
        self.t = 0.0
        self.sleep_calls: list[float] = []

    def now(self) -> float:
        return self.t

    async def sleep(self, seconds: float) -> None:
        self.sleep_calls.append(seconds)
        self.t += max(0.0, seconds)
        await asyncio.sleep(0)
