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
