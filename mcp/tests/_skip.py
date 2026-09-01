"""The suite's SKIP sentinel — `run_tests.py` counts these separately from passes.

`python3 run_tests.py` has to stay green under SYSTEM python, which has no starlette/httpx, so the
tests that need those extras bow out. They used to do it with a bare `return`, which the runner
counted as a PASS: the totals were byte-identical with and without the extras, and "572 passed" under
system python meant "540 passed and 32 did nothing". CLAUDE.md promises they "skip cleanly" — this is
what makes that true and visible (review 2026-09-01).

    from _skip import needs
    def test_x():
        needs(HAVE, "starlette + httpx")
"""


class Skipped(Exception):
    """Raised by `needs()`. Caught by run_tests.py and reported as a skip, never as a pass."""


def needs(condition, what: str) -> None:
    if not condition:
        raise Skipped(what)
