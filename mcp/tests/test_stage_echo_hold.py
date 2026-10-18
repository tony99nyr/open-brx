"""F570 on the stage (engine.js `_write`, ammo.js `holdEchoes`/`restampEchoes`; milestone review 2026-10-18).

The gun echoes each `$WEAP`/`$AMMO` row as it READS it, so a long write's early rows echo while it is still on the link,
past a 0.7 s window stamped at the call. On a real link the stage's head write takes seconds (`send_batch`, 60 ms gaps),
so the stage must hold a write's windows open until it settles, then restart them, as the phone does.

Run: python3 run_tests.py stage_echo_hold
"""
import asyncio

from _stage import GUN, StageClock, mk_stage, settle


def _slow_link(st):
    """Hold any write that carries a `$WEAP` row until the test releases it, as a real link does for seconds."""
    gate = asyncio.Event()
    real = st._send

    async def send(frames, *a, **kw):
        if any(f.startswith("$WEAP,") for f in frames):
            await gate.wait()
        return await real(frames, *a, **kw)
    st._send = send   # type: ignore[method-assign]
    return gate


def test_an_echo_that_lands_while_the_head_is_still_on_the_link_is_bookkeeping():
    async def go():
        clock = StageClock()
        st, _mgr = mk_stage(now=clock)
        await st.connect(GUN)
        gate = _slow_link(st)
        arm = asyncio.ensure_future(st.arm())
        await asyncio.sleep(0)
        clock.t += 1.5                                  # the head is still on the link, well past ACC_ECHO_S
        st._on_rx("$ALCD,32,100,0,96,0,*")
        st._on_rx("$ALCD,1,100,4,0,0,*")                # the melee row's echo
        assert st.active_slot == 0, "the melee echo took the trigger"
        gate.set()
        await arm; await settle(st)
        clock.t += 1.0                                  # the write landed; its windows close ACC_ECHO_S later
        assert not st._acct_echoing(4), "the held window never closed"
    asyncio.run(go())


def test_a_write_that_never_settles_holds_its_windows_at_most_the_cap():
    async def go():
        clock = StageClock()
        st, _mgr = mk_stage(now=clock)
        await st.connect(GUN)
        _slow_link(st)
        arm = asyncio.ensure_future(st.arm())
        await asyncio.sleep(0)
        clock.t += 2.0
        assert st._acct_echoing(4), "held while the head is on the link"
        clock.t += 7.0
        assert not st._acct_echoing(4), "never held for ever (ECHO_HOLD_MAX_S)"
        arm.cancel()
    asyncio.run(go())


def test_r3_a_write_that_sent_a_group_then_failed_restarts_the_windows():
    """Codex and Opus round 2: rows in a group that went out may still echo, so a later group's failure must not put their
    windows back to before the write."""
    async def go():
        clock = StageClock()
        st, _mgr = mk_stage(now=clock)
        await st.connect(GUN)
        st._acct_wrote(0, 10, 20)
        closes = st._shot_acct[0]["echo_until"]

        async def partial(frames, why, *a, **kw):
            await st._send(["$VOL,30,*"], 60)          # the first group went out
            clock.t += 2.0
            return False                               # a later group could not be delivered
        st._write_frames = partial   # type: ignore[method-assign]
        await st.write(["$AMMO,0,10,20,1,*"], "test")
        assert st._shot_acct[0]["echo_until"] > closes, "the sent row's window was put back"
        assert st._shot_acct[0]["echo_until"] == clock.t + st.ACC_ECHO_S
    asyncio.run(go())


def test_r4_another_writes_send_does_not_count_as_this_writes():
    """Codex round 3: the send count was global, so a write that failed unsent while another write sent restarted its
    windows instead of putting them back. Each write counts only its own groups."""
    async def go():
        clock = StageClock()
        st, _mgr = mk_stage(now=clock)
        await st.connect(GUN)
        st._acct_wrote(0, 10, 20)
        closes = st._shot_acct[0]["echo_until"]
        dead = asyncio.Event()

        async def frames_path(frames, why, *a, **kw):
            if any(f.startswith("$AMMO,") for f in frames):
                await dead.wait()                      # this write waits on a dead link, then fails unsent
                return False
            await st._send(frames, 60)                 # the other write goes out meanwhile
            return None
        st._write_frames = frames_path   # type: ignore[method-assign]
        a = asyncio.ensure_future(st.write(["$AMMO,0,10,20,1,*"], "dead"))
        await asyncio.sleep(0)
        await st.write(["$VOL,30,*"], "other")
        clock.t += 0.1
        dead.set()
        await a
        assert st._shot_acct[0]["echo_until"] == closes, "a write that never left restarted its window"
    asyncio.run(go())
