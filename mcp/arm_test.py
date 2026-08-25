"""Robust multi-gun arm (Tony's approach): connect all → config each (reconnect +
reconfig any that drop) → once ALL are live simultaneously, fire $SPAWN to all
back-to-back for a SYNCED start. Then log frames for the multikill test.

Usage:  python arm_test.py <shooter> <t1> <t2> [seconds]
"""
import asyncio
import sys
import time

from brx_mcp.gameconfig import GameConfig
from brx_mcp.ble import ConnectionManager


def _t(a):
    return a.replace(":", "")[-4:]


async def main():
    args = sys.argv[1:]
    secs = 140
    if args and args[-1].isdigit():
        secs = int(args[-1]); args = args[:-1]
    shooter, targets = args[0], args[1:]
    guns = args
    cfg = GameConfig(mode="tdm", volume=69, respawn_s=8)
    setup, spawn = cfg.setup_frames(), cfg.spawn_frames()
    mgr = ConnectionManager()

    async def ensure_connected(a):
        if mgr.is_connected(a):
            return True
        try:
            await mgr.disconnect(a)
        except Exception:
            pass
        try:
            await mgr.connect(a, a, attempts=3)
            print(f"# (re)connected {_t(a)}", file=sys.stderr)
            return True
        except Exception as e:
            print(f"# connect {_t(a)} failed: {type(e).__name__}", file=sys.stderr)
            return False

    async def configure(a):
        for f in setup:
            try:
                await mgr.send(a, f, reply_window_ms=45)   # ~gentle for a marginal link
            except Exception:
                return False
        try:
            await mgr.send(a, f"$TID,{1 if a == shooter else 2},*", reply_window_ms=45)
        except Exception:
            return False
        return True

    # 1. connect + config each; loop until ALL are live + configured simultaneously
    configured: set[str] = set()
    print(f"# arming {[_t(g) for g in guns]} — config each, hold all live, then synced start")
    for attempt in range(12):
        for a in guns:
            ok = await ensure_connected(a)
            if ok and a not in configured:
                if await configure(a):
                    configured.add(a)
                    print(f"# configured {_t(a)}", file=sys.stderr)
            elif not ok:
                configured.discard(a)      # dropped → must reconfig after reconnect
        live_now = [a for a in guns if mgr.is_connected(a)]
        if len(live_now) == len(guns) and configured.issuperset(guns):
            print(f"# ALL {len(guns)} live + configured — firing synced start", file=sys.stderr)
            break
        print(f"# attempt {attempt+1}: live={[ _t(a) for a in live_now]} "
              f"configured={[_t(a) for a in configured]} — retrying", file=sys.stderr)
        await asyncio.sleep(0.5)
    else:
        print("# could not get all guns live+configured together", file=sys.stderr)

    # 2. SYNCED start: $SPAWN + ammo + bmap to all, back-to-back, fast
    for f in spawn:
        for a in guns:
            if mgr.is_connected(a):
                try:
                    await mgr.send(a, f, reply_window_ms=15)
                except Exception:
                    pass
    await asyncio.sleep(0.4)
    armed = [a for a in guns if mgr.is_connected(a)]
    print(f"\n# STARTED {[_t(a) for a in armed]}. shooter={_t(shooter)}(t1) "
          f"targets={[_t(t) for t in targets if t in armed]}(t2)")
    print("# All should have counted down together. KILL t1 then t2 (listen for 'double kill').\n")

    # 3. log
    last = {a: mgr.sessions[a].seq for a in armed if a in mgr.sessions}
    t0 = time.monotonic()
    while time.monotonic() - t0 < secs:
        await asyncio.sleep(0.2)
        for a in list(last):
            try:
                evs = mgr.get_events(a, since_seq=last[a])["events"]
            except Exception:
                continue
            for ev in evs:
                last[a] = ev["seq"]
                if ev["direction"] == "rx":
                    print(f"[{ev['t_ms']:>7}ms] {_t(a)}{'*' if a == shooter else ' '}>> {ev['raw']}", flush=True)
    for a in guns:
        try:
            await mgr.send(a, "$STOP,*", reply_window_ms=15); await mgr.disconnect(a)
        except Exception:
            pass


asyncio.run(main())
