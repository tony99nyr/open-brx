"""O8 browser gate: make a real MC's match tick (and, at start-up, join_info) raise on demand.

observability.mjs puts this directory on PYTHONPATH of the MC it launches. With OBS_FLAG_DIR set,
`Session.tick` raises while the file `tick-fail` exists there, `Store.log` raises while `store-fail` exists; with OBS_JOIN_FAIL=1, `FakeNet.join_info`
raises. Nothing else changes, so the failure the console shows is MC's own code path, not a mock.
"""
import os
import sys

_flag = os.environ.get("OBS_FLAG_DIR")
if _flag:
    sys.path.insert(0, os.environ["OBS_MCP_DIR"])
    from brx_mcp.mc import fakes, state, store

    _tick = state.Session.tick

    def _failing_tick(self):
        if os.path.exists(os.path.join(_flag, "tick-fail")):
            raise RuntimeError("OBS: forced tick failure")
        return _tick(self)

    state.Session.tick = _failing_tick

    _store_log = store.Store.log

    def _failing_log(self, *a, **k):
        if os.path.exists(os.path.join(_flag, "store-fail")):
            raise OSError(28, "No space left on device (OBS: forced)")
        return _store_log(self, *a, **k)

    store.Store.log = _failing_log
    if os.environ.get("OBS_JOIN_FAIL") == "1":
        def _bad_join(self):
            raise RuntimeError("OBS: no network interface")
        fakes.FakeNet.join_info = _bad_join
