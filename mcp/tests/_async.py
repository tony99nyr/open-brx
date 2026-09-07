"""One way to run a coroutine in the suite — `from _async import run`.

WHY THIS EXISTS (2026-09-07). Eleven test files each carried their own copy of

    def _run(coro):
        return asyncio.get_event_loop().run_until_complete(coro)

which is both duplicated and, more importantly, ORDER-DEPENDENT. `get_event_loop()` reuses a
persistent default loop; `asyncio.run()` creates a fresh loop, closes it, and leaves no current loop
behind. So the moment ONE test file used `asyncio.run()`, every later file using the old helper
started failing -- on the loop, not on anything it was testing.

That is not hypothetical: adding `test_diag_runner.py` (which correctly uses `asyncio.run`) took
`test_fake_game` and `test_diagnose_flow` from green to 15 failures, while both still passed in
isolation. The new file was fine; the old helper was the bug.

Order-dependent tests are the worst thing to have under a refactor, because they fail for reasons
that have nothing to do with the change being made, and the natural response is to distrust the
refactor rather than the suite. One helper, one policy, no shared loop.
"""
import asyncio
import atexit


def run(coro):
    """Run `coro` to completion on its own fresh event loop. Use this unless `own_loop()` applies."""
    return asyncio.run(coro)


def own_loop():
    """A `run(coro)` bound to a PRIVATE persistent loop, for a file that genuinely needs one.

    `run()` above is right for almost everything. It is wrong when the code under test spawns a
    BACKGROUND task during one call that a later call has to await -- a task belongs to the loop that
    created it, and `asyncio.run` cancels what is still pending when its coroutine returns. So the
    task is dead (or cancelled mid-flight) by the time the next call looks for it.

    `GameDriver`'s LED bursts are exactly that shape: `execute()` starts the burst and the test drains
    it afterwards to assert on the frames it sent.

    The difference from what this module replaced: that loop is OWNED BY THE CALLING FILE, not
    borrowed from asyncio's process-wide default. A file's need for a persistent loop therefore stops
    at that file, instead of making every other file's result depend on sorting order.
    """
    loop = asyncio.new_event_loop()
    atexit.register(loop.close)
    return loop.run_until_complete
