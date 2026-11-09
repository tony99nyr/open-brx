"""Phone-owned ALT swaps and the independent stage query owner.

The phone changes the active loadout slot at ALT, holds the trigger for the target
weapon's delay, then binds that slot. Gun reports can request a rebind, but cannot
move the active slot.
"""
from __future__ import annotations

import asyncio

from brx_mcp.fake import FakeConnectionManager, FakeTagger
from brx_mcp.stage.stage import GunStage
from _stage import GUN, StageClock, _nosleep, settle
from brx_mcp.stage import stage as S


class _MuteQueryTagger(FakeTagger):
    """A gun that takes `$QUERY` and never answers it."""

    def write(self, frame: str) -> None:
        if frame.strip() == "$QUERY,*":
            return
        super().write(frame)


async def _live(tagger_cls=FakeTagger):
    clock = StageClock()
    gun = tagger_cls(GUN, "FAKE-STAGE", team=1, clock=clock)
    mgr = FakeConnectionManager([gun])
    st = GunStage(mgr, None, sleep=_nosleep, now=clock, voice_verdict_sink=lambda _r: None)
    await st.connect(GUN); await st.arm(); await st.spawn(); await settle(st)
    st.poll(); await settle(st)
    for _ in range(3):
        clock.t += 0.5; mgr.pump(); st.poll(); await settle(st)
    clock.t += S.GUN_SPAWN_AIR_S; st.poll(); await settle(st)   # past the gun's spawn wait and the frame's air time (SR23)
    assert st._slot_count() == 2 and st.active_slot == 0
    return st, gun, clock


def _tx(st) -> list[str]:
    return [e["raw"] for e in st.mgr.get_events("stage", max_events=10**6)["events"] if e["direction"] == "tx"]


def _texts(st) -> list[str]:
    return [e["text"] for e in st.log]


def _alt(st) -> None:
    st._on_rx("$BUT,1,1,*"); st._on_rx("$BUT,1,0,*")


async def _tick(st, clock, s: float) -> None:
    clock.t += s
    st.mgr.pump()
    st.poll(); await settle(st)
    st.poll(); await settle(st)


def _ask(st):
    replies: list[int] = []
    timeouts: list[int] = []
    ok = st._ask_slot("test slot read", replies.append, lambda: timeouts.append(1))
    return ok, replies, timeouts


def test_alt_changes_the_phone_slot_at_once_and_binds_after_target_delay():
    async def go():
        st, _gun, clock = await _live()
        before = len(_tx(st))
        _alt(st)
        await settle(st)
        assert st.active_slot == 1 and st._last_loadout == 1
        assert st._bind_due["slot"] == 1
        assert any(f.startswith("$BMAP,0,98,") for f in _tx(st)[before:])
        assert any("ALT: swap from slot 0 to slot 1" in t for t in _texts(st))
        assert any(f.startswith("$PLAY,,4,6,") for f in _tx(st)[before:]), _tx(st)[before:]
        delay = st._alt_lock_s(1)
        await _tick(st, clock, delay - 0.01)
        assert not any(f.startswith("$BMAP,0,1,") for f in _tx(st)[before:])
        await _tick(st, clock, 0.02)
        assert st._bind_due is None
        assert any(f.startswith("$BMAP,0,1,") for f in _tx(st)[before:])
        assert not any(f.startswith("$QUERY,") for f in _tx(st)[before:])
    asyncio.run(go())


def test_rapid_alt_retargets_the_pending_bind_and_holds_only_once():
    async def go():
        st, _gun, clock = await _live()
        before = len(_tx(st))
        _alt(st)
        await settle(st)
        first_due = st._bind_due["at"]
        clock.t += 0.1
        _alt(st)
        await settle(st)
        assert st.active_slot == 0 and st._last_loadout == 0
        assert st._bind_due["slot"] == 0 and st._bind_due["at"] > first_due
        rows = _tx(st)[before:]
        assert sum(f.startswith("$BMAP,0,98,") for f in rows) == 1, rows
        await _tick(st, clock, st._alt_lock_s(0) + 0.02)
        assert st._bind_due is None and st.active_slot == 0
        assert any(f.startswith("$BMAP,0,0,") for f in _tx(st)[before:])
    asyncio.run(go())


def test_a_round_from_an_unbound_slot_requests_a_rate_limited_rebind():
    async def go():
        st, _gun, clock = await _live()
        _alt(st)
        await settle(st)
        await _tick(st, clock, st._alt_lock_s(1) + 0.02)
        assert st.active_slot == 1
        await _tick(st, clock, 0.51)
        before = len(_tx(st))
        st._on_rx("$ALCD,31,100,0,182,0,*")
        await settle(st)
        assert st.active_slot == 1
        assert any(f.startswith("$BMAP,0,1,") for f in _tx(st)[before:])
        before = len(_tx(st))
        st._on_rx("$ALCD,30,100,0,182,0,*")
        await settle(st)
        assert st.active_slot == 1
        assert not any(f.startswith("$BMAP,0,1,") for f in _tx(st)[before:])
        await _tick(st, clock, 0.51)
        before = len(_tx(st))
        st._on_rx("$ALCD,29,100,0,182,0,*")
        await settle(st)
        assert any(f.startswith("$BMAP,0,1,") for f in _tx(st)[before:])
    asyncio.run(go())


def test_a_failed_trigger_bind_is_repaired_on_the_next_tick():
    async def go():
        st, _gun, clock = await _live()
        st._bmap_sent = 98
        real_send, real_reconnect = st._send, st._reconnect

        async def failed_send(*_args, **_kwargs):
            raise OSError("failed bind write")

        async def failed_reconnect():
            st.connected = True
            raise OSError("reconnect unavailable")

        st._send = failed_send  # type: ignore[method-assign]
        st._reconnect = failed_reconnect  # type: ignore[method-assign]
        try:
            await st.write(["$BMAP,0,0,,,,,*"], "test failed trigger bind", gap_ms=0)
            assert False, "the failed write must reach the caller"
        except OSError:
            pass
        assert st._bmap_sent is None, "a failed write must clear the binding the stage recorded"
        st._send, st._reconnect = real_send, real_reconnect  # type: ignore[method-assign]
        st.connected = True
        before = len(_tx(st))
        await _tick(st, clock, 0.51)
        assert any(f.startswith("$BMAP,0,0,") for f in _tx(st)[before:])
        assert st._bmap_sent == 0
    asyncio.run(go())


def test_a_gun_reload_of_an_unbound_slot_is_undone_once():
    async def go():
        st, _gun, _clock = await _live()
        # Record the counts at the lever, then simulate the gun's free refill.
        st._prev_ammo[0] = 10; st._prev_reserve[0] = 100
        st._gun_other = {"bound": 1, "snap": {0: {"mag": 10, "res": 100}}, "until": st.now() + 10, "life": st._life_queued, "energy": False}   # ammo.js `noteGunOther` at a lever on slot 1
        st._last_shot_slot = 0; st._last_shot_life = st._life_queued
        st.active_slot = 1
        before = len(_tx(st))
        st._on_rx("$ALCD,20,100,0,100,0,*")
        await settle(st)
        writes = [f for f in _tx(st)[before:] if f.startswith("$AMMO,0,")]
        assert writes == ["$AMMO,0,10,100,1,*"], writes
        assert st._prev_ammo[0] == 10 and st._prev_reserve[0] == 100
        before = len(_tx(st))
        st._on_rx("$ALCD,20,100,0,100,0,*")
        await settle(st)
        assert not [f for f in _tx(st)[before:] if f.startswith("$AMMO,0,")]
    asyncio.run(go())


def _seed_undo_slot(st):
    st.active_slot = 0
    st._prev_ammo[0] = 30; st._prev_reserve[0] = 180
    st._acct_wrote(0, 30, 180)
    return st._shot_acct[0]["echo_gen"], st._shot_acct[0]["echo_pending"]


def test_undo_gun_reload_books_once_and_retries_an_unsent_write():
    async def go():
        st, _gun, _clock = await _live()
        gen0, pending0 = _seed_undo_slot(st)
        calls = []

        async def retry_once(frames, why, *args, **kwargs):
            calls.append(frames)
            return False if len(calls) == 1 else None

        st.write = retry_once  # type: ignore[method-assign]
        st._undo_gun_reload(0, 10, 100)
        await settle(st)
        assert calls == [["$AMMO,0,10,100,1,*"], ["$AMMO,0,10,100,1,*"]]
        assert st._shot_acct[0]["echo_gen"] == gen0 + 1
        assert st._shot_acct[0]["echo_pending"] == pending0 + 1
        assert st._shot_acct[0]["mag"] == 10 and st._shot_acct[0]["res"] == 100
        assert (st._prev_ammo[0], st._prev_reserve[0], st.ammo, st.reserve) == (10, 100, 10, 100)
    asyncio.run(go())


def test_undo_gun_reload_rolls_back_books_after_two_unsent_failures():
    async def go():
        st, _gun, _clock = await _live()
        gen0, pending0 = _seed_undo_slot(st)
        calls = []

        async def always_fail(frames, why, *args, **kwargs):
            calls.append(frames)
            return False

        st.write = always_fail  # type: ignore[method-assign]
        st._undo_gun_reload(0, 10, 100)
        await settle(st)
        acct = st._shot_acct[0]
        assert calls == [["$AMMO,0,10,100,1,*"], ["$AMMO,0,10,100,1,*"]]
        assert acct["echo_gen"] == gen0 + 1 and acct["echo_pending"] == pending0
        assert acct["mag"] == 30 and acct["res"] == 180 and acct["echo_expect"] == 30
        assert (st._prev_ammo[0], st._prev_reserve[0], st.ammo, st.reserve) == (30, 180, 30, 180)
    asyncio.run(go())


def test_undo_gun_reload_does_not_retry_or_roll_back_after_frame_sent():
    async def go():
        st, _gun, _clock = await _live()
        gen0, pending0 = _seed_undo_slot(st)
        calls = []

        async def sent_then_failed(frames, why, *args, on_frame_sent=None, **kwargs):
            calls.append(frames)
            on_frame_sent(frames[0])
            raise OSError("write failed after the frame left")

        st.write = sent_then_failed  # type: ignore[method-assign]
        st._undo_gun_reload(0, 10, 100)
        await settle(st)
        acct = st._shot_acct[0]
        assert calls == [["$AMMO,0,10,100,1,*"]]
        assert acct["echo_gen"] == gen0 + 1 and acct["echo_pending"] == pending0 + 1
        assert acct["mag"] == 10 and acct["res"] == 100
        assert (st._prev_ammo[0], st._prev_reserve[0], st.ammo, st.reserve) == (10, 100, 10, 100)
    asyncio.run(go())


def test_a_soft_reload_holds_the_trigger_and_rebinds_when_it_ends():
    async def go():
        st, _gun, clock = await _live()
        # A last shot on slot 1 makes the lever reload that slot while slot 0 is in hand.
        st.active_slot = 0
        st._last_shot_slot = 1; st._last_shot_life = st._life_queued
        st.ammo = 10; st.reserve = 100
        st._prev_ammo[0] = 10; st._prev_reserve[0] = 100
        st._prev_ammo[1] = 4; st._prev_reserve[1] = 100
        before = len(_tx(st))
        st._on_rx("$BUT,2,1,*"); st._on_rx("$BUT,2,0,*")
        await settle(st)
        assert st.reloading and st.reloading["soft"]
        assert any(f.startswith("$BMAP,0,98,") for f in _tx(st)[before:])
        await _tick(st, clock, st.reloading["s"] + 0.02)
        assert st.reloading is None
        assert any(f.startswith("$BMAP,0,0,") for f in _tx(st)[before:])
        assert st.active_slot == 0
    asyncio.run(go())


def test_a_query_whose_reason_went_away_is_never_sent():
    """engine.js `shouldSend`: the write asks at its send point, after any wait, so a death while the `$QUERY` is
    queued sends nothing (Codex review). CONTROL: the same write with the reason still there goes out."""
    async def go():
        st, _gun, _clock = await _live()
        before = len(_tx(st))
        await st.write(["$QUERY,*"], "test", gap_ms=0, should_send=lambda: False)
        assert "$QUERY,*" not in _tx(st)[before:]
        await st.write(["$QUERY,*"], "test", gap_ms=0, should_send=lambda: True)
        assert "$QUERY,*" in _tx(st)[before:], "CONTROL"
        before = len(_tx(st))
        ok, replies, _timeouts = _ask(st)       # the query is queued as a task, not yet sent
        assert ok and st._mag_query is not None
        st._on_rx("$LCD,0,0,0,0,32,192,*")      # the player dies before the write runs
        await settle(st)
        assert not st.alive and st._mag_query is None
        assert "$QUERY,*" not in _tx(st)[before:] and replies == []
    asyncio.run(go())


def test_a_live_answer_reaches_the_reply_and_releases_the_owner():
    async def go():
        st, gun, _clock = await _live()
        gun.active_slot = 1
        ok, replies, timeouts = _ask(st)
        assert ok
        await settle(st); st.mgr.pump(); st.poll(); await settle(st)
        assert replies == [1] and timeouts == [] and st._mag_query is None
    asyncio.run(go())


def test_silence_past_the_reply_window_times_the_query_out():
    async def go():
        st, _gun, clock = await _live(_MuteQueryTagger)
        ok, replies, timeouts = _ask(st)
        assert ok
        await _tick(st, clock, 0.05)
        assert st._mag_query is not None and st._mag_query["at"] is not None
        await _tick(st, clock, st.QUERY_REPLY_S + 0.1)
        assert st._mag_query is None and replies == [] and timeouts == [1]
    asyncio.run(go())


def test_a_disconnect_drops_the_query():
    """F542 review (engine.js `onBleDropped`): a link drop clears the `$QUERY` in flight, so the relink cannot answer it."""
    async def go():
        st, _gun, clock = await _live(_MuteQueryTagger)
        ok, replies, timeouts = _ask(st)
        await _tick(st, clock, 0.05)
        assert ok and st._mag_query is not None
        await st.disconnect()
        assert st._mag_query is None
        clock.t += 3.0
        await st.connect(GUN); st.poll(); await settle(st)
        assert replies == [] and st.active_slot == 0
    asyncio.run(go())


def test_a_health_zero_answer_calls_nobody_and_releases_the_owner():
    """engine.js LCD case: a health-0 answer is no slot evidence, so neither callback runs."""
    async def go():
        st, _gun, clock = await _live(_MuteQueryTagger)
        ok, replies, timeouts = _ask(st)
        await _tick(st, clock, 0.05)
        assert ok and st._mag_query is not None and st._mag_query["at"] is not None
        st.auto_react = False
        st._on_rx("$LCD,0,0,0,1,6,24,*")
        assert st._mag_query is None and replies == [] and timeouts == []
    asyncio.run(go())


def test_a_query_write_that_raises_releases_the_owner_at_once():
    """engine.js 36f03987 (`settled(false)` on a rejected write): a `$QUERY` write that raises before its send frees
    the query owner and times it out now, not after HEAD_WRITE_CAP_S. (A raise from the real send path is a link drop:
    see the next test.)"""
    async def go():
        st, _gun, clock = await _live()
        real = st.write

        async def raising(frames, why, *a, **kw):
            if frames == ["$QUERY,*"]:
                raise RuntimeError("link refused")
            return await real(frames, why, *a, **kw)
        st.write = raising   # type: ignore[method-assign]
        ok, replies, timeouts = _ask(st)
        await _tick(st, clock, 0.05)
        assert ok and st._mag_query is None and timeouts == [1] and replies == []
    asyncio.run(go())


def test_a_send_exception_drops_the_query_and_is_not_retried_without_an_owner():
    """F542 r3 reviews: a real send exception is a link drop (engine.js `onBleDropped`): the query goes, and the
    reconnect's retry does not re-send a `$QUERY` that no longer has an owner."""
    async def go():
        st, _gun, clock = await _live()
        real = st._send
        calls: list[list[str]] = []

        async def failing(frames, *a, **kw):   # `_deliver`'s own send: the real exception path, reconnect included
            if frames == ["$QUERY,*"]:
                calls.append(frames)
                raise RuntimeError("Not connected")
            return await real(frames, *a, **kw)
        st._send = failing   # type: ignore[method-assign]
        ok, replies, _timeouts = _ask(st)
        await _tick(st, clock, 0.05)
        assert ok and len(calls) == 1, "the retry after the reconnect sent the ownerless $QUERY again"
        assert st._mag_query is None and replies == []
    asyncio.run(go())

def _pull(st) -> None:
    st._on_rx("$BUT,0,1,*"); st._on_rx("$BUT,0,0,*")


async def _tony_sequence():
    st, gun, clock = await _live()
    for mag in (31, 30, 29):
        _pull(st); st._on_rx(f"$ALCD,{mag},100,0,182,0,*")
    _alt(st); await settle(st)
    await _tick(st, clock, st._alt_lock_s(1) + 0.05)
    for mag in (5, 4, 3):
        _pull(st); st._on_rx(f"$ALCD,{mag},100,1,120,0,*")
    _alt(st); await settle(st)
    await _tick(st, clock, st._alt_lock_s(0) + 0.05)
    assert st.active_slot == 0
    return st, gun, clock


def test_old_slot_round_within_250ms_of_alt_is_in_flight():
    async def go():
        st, _gun, clock = await _live()
        _alt(st); await settle(st)
        clock.t += 0.249
        st._on_rx("$ALCD,31,100,0,182,0,*"); await settle(st)
        assert st.active_slot == 1
        assert not any("gun fired slot 0, bound 1" in t for t in _texts(st))
        clock.t += 0.001
        st._on_rx("$ALCD,30,100,0,182,0,*"); await settle(st)
        assert st.active_slot == 1
        assert any("gun fired slot 0, bound 1" in t for t in _texts(st))
    asyncio.run(go())


def test_gun_reload_undo_survives_a_swap_back_to_its_slot():
    async def go():
        st, _gun, clock = await _live()
        st._prev_ammo[0] = 10; st._prev_reserve[0] = 100
        st._gun_other = {"bound": 1, "snap": {0: {"mag": 10, "res": 100}}, "until": st.now() + 10, "life": st._life_queued, "energy": False}   # ammo.js `noteGunOther` at a lever on slot 1
        st._last_shot_slot = 0; st._last_shot_life = st._life_queued
        _alt(st); await settle(st)
        await _tick(st, clock, st._alt_lock_s(1) + 0.02)
        _alt(st); await settle(st)
        assert st.active_slot == 0
        before = len(_tx(st))
        st._on_rx("$ALCD,20,100,0,100,0,*"); await settle(st)
        assert "$AMMO,0,10,100,1,*" in _tx(st)[before:]
        assert st._prev_ammo[0] == 10
    asyncio.run(go())


def test_chain_reload_undoes_each_free_shell():
    async def go():
        st, _gun, _clock = await _live()
        st._prev_ammo[0] = 10; st._prev_reserve[0] = 100
        st._gun_other = {"bound": 1, "snap": {0: {"mag": 10, "res": 100}}, "until": st.now() + 10, "life": st._life_queued, "energy": False}   # ammo.js `noteGunOther` at a lever on slot 1
        st._last_shot_slot = 0; st._last_shot_life = st._life_queued
        catalog_row = st._catalog_row
        st._catalog_row = lambda table, key, value: ({"reload_type": "chain"} if table == "weapon_catalog" else catalog_row(table, key, value))
        before = len(_tx(st))
        st._on_rx("$ALCD,11,100,0,100,0,*"); await settle(st)
        st._on_rx("$ALCD,12,100,0,100,0,*"); await settle(st)
        undo = [f for f in _tx(st)[before:] if f.startswith("$AMMO,0,")]
        assert undo == ["$AMMO,0,10,100,1,*", "$AMMO,0,10,100,1,*"], undo
        assert st._gun_other is not None
    asyncio.run(go())


def test_soft_reload_dropped_link_writes_no_magazine():
    async def go():
        st, _gun, clock = await _tony_sequence()
        st.ammo = 10; st.reserve = 100
        st._prev_ammo[0] = 10; st._prev_reserve[0] = 100
        st._last_shot_slot = 1; st._last_shot_life = st._life_queued
        st._on_rx("$BUT,2,1,*"); st._on_rx("$BUT,2,0,*"); await settle(st)
        assert st.reloading and st.reloading["soft"]
        before = len(_tx(st))
        st.mgr.is_connected = lambda _alias: False
        clock.t += st.reloading["s"] + 0.1
        st.poll(); await settle(st)
        assert st.reloading is None and st.reload_outcome["why"] == "dropped"
        assert not any(f.startswith("$AMMO,0,") for f in _tx(st)[before:])
    asyncio.run(go())


def test_soft_reload_round_buffered_at_deadline_cancels_the_write():
    async def go():
        st, _gun, clock = await _tony_sequence()
        st.ammo = 10; st.reserve = 100
        st._prev_ammo[0] = 29; st._prev_reserve[0] = 182
        st._last_shot_slot = 1; st._last_shot_life = st._life_queued
        st._on_rx("$BUT,2,1,*"); st._on_rx("$BUT,2,0,*"); await settle(st)
        before = len(_tx(st))
        clock.t += st.reloading["s"] + 0.01
        sess = st.mgr.sessions["stage"]
        sess.record("rx", "$BUT,0,1,*"); sess.record("rx", "$ALCD,28,100,0,182,0,*"); sess.record("rx", "$BUT,0,0,*")
        st.poll(); await settle(st)
        assert not any(f.startswith("$AMMO,0,") for f in _tx(st)[before:])
        assert st.ammo == 28 and st.reload_outcome["why"] == "fired"
    asyncio.run(go())


def test_soft_reload_failed_write_restores_its_magazine_bookkeeping():
    async def go(raises=False):
        st, _gun, clock = await _tony_sequence()
        st._last_shot_slot = 1; st._last_shot_life = st._life_queued
        expected_mag, expected_reserve = st._prev_ammo[0], st._prev_reserve[0]
        st._on_rx("$BUT,2,1,*"); st._on_rx("$BUT,2,0,*"); await settle(st)
        async def failed(*_args, **_kwargs):
            if raises:
                raise RuntimeError("link error")
            return False
        st.write = failed
        await _tick(st, clock, st.reloading["s"] + 0.1)
        assert st._prev_ammo[0] == expected_mag and st._prev_reserve[0] == expected_reserve and st.ammo == expected_mag
    asyncio.run(go())
    asyncio.run(go(True))


def test_soft_chain_stops_before_a_queued_shell_is_sent():
    async def go():
        st, _gun, clock = await _live()
        catalog_row = st._catalog_row
        st._catalog_row = lambda table, key, value: ({**(catalog_row(table, key, value) or {}), "reload_type": "chain"}
                                                       if table == "weapon_catalog" else catalog_row(table, key, value))
        _pull(st); st._on_rx("$ALCD,31,100,0,182,0,*")
        _alt(st); await settle(st); await _tick(st, clock, st._alt_lock_s(1) + 0.02)
        assert st.active_slot == 1
        st.ammo = 2; st.reserve = 24
        st._prev_ammo[1] = 2; st._prev_reserve[1] = 24
        st._shot_acct[1]["mag"] = 2; st._shot_acct[1]["fired"] = 0
        spawn_task = st._spawn_task
        def without_watchdog(task):
            if getattr(task, "cr_code", None) and task.cr_code.co_name == "_reload_watchdog":
                task.close()
                return
            spawn_task(task)
        st._spawn_task = without_watchdog
        before = len(_tx(st))
        st._on_rx("$BUT,2,1,*"); st._on_rx("$BUT,2,0,*"); await settle(st)
        assert st.reloading and st.reloading["soft"] and st.reloading["chain"]
        gate = asyncio.Event()
        real = st.write
        async def queued(frames, why="", **kw):
            if any(f.startswith("$AMMO,1,") for f in frames):
                await gate.wait()
                send = kw.get("should_send")
                if send is not None and not send():
                    return None
            return await real(frames, why, **kw)
        st.write = queued
        tasks = []
        st._spawn_task = lambda task: tasks.append(asyncio.ensure_future(task))
        clock.t += st.reloading["s"] + 0.01
        st._reload_tick()
        st._on_rx("$BUT,0,1,*")
        gate.set()
        for task in tasks:
            await task
        assert st.reloading is None and st.reload_outcome["why"] == "fired", (st.reloading, st.reload_outcome)
        assert not any(f.startswith("$AMMO,1,") for f in _tx(st)[before:])
    asyncio.run(go())


def test_soft_chain_loads_one_shell_per_reload_interval():
    async def go():
        st, _gun, clock = await _live()
        catalog_row = st._catalog_row
        st._catalog_row = lambda table, key, value: ({**(catalog_row(table, key, value) or {}), "reload_type": "chain"}
                                                       if table == "weapon_catalog" else catalog_row(table, key, value))
        _pull(st); st._on_rx("$ALCD,31,100,0,182,0,*")
        _alt(st); await settle(st); await _tick(st, clock, st._alt_lock_s(1) + 0.02)
        st.ammo = 2; st.reserve = 24; st._prev_ammo[1] = 2; st._prev_reserve[1] = 24
        st._shot_acct[1]["mag"] = 2; st._shot_acct[1]["fired"] = 0
        before = len(_tx(st))
        st._on_rx("$BUT,2,1,*"); st._on_rx("$BUT,2,0,*"); await settle(st)
        assert st.reloading and st.reloading["chain"]
        interval = st.reloading["s"]
        await _tick(st, clock, interval + 0.01)
        shells = [f for f in _tx(st)[before:] if f.startswith("$AMMO,1,")]
        assert shells == ["$AMMO,1,3,23,1,*"], shells
        assert st.reloading and st.reloading["chain"]
        await _tick(st, clock, interval + 0.01)
        shells = [f for f in _tx(st)[before:] if f.startswith("$AMMO,1,")]
        assert shells == ["$AMMO,1,3,23,1,*", "$AMMO,1,4,22,1,*"], shells
    asyncio.run(go())


def test_soft_reload_newer_write_owns_same_count_after_failed_send():
    async def go():
        st, _gun, clock = await _tony_sequence()
        st._last_shot_slot = 1; st._last_shot_life = st._life_queued
        st._on_rx("$BUT,2,1,*"); st._on_rx("$BUT,2,0,*"); await settle(st)
        async def failed(*_args, **_kwargs):
            return False
        st.write = failed
        tasks = []
        st._spawn_task = tasks.append
        clock.t += st.reloading["s"] + 0.01
        st._reload_tick()
        mag, reserve = st._prev_ammo[0], st._prev_reserve[0]
        st._acct_wrote(0, mag, reserve)
        for task in tasks:
            await task
        assert st._prev_ammo[0] == mag and st._prev_reserve[0] == reserve
    asyncio.run(go())


def test_death_during_soft_reload_writes_no_magazine():
    async def go():
        st, _gun, clock = await _tony_sequence()
        st._last_shot_slot = 1; st._last_shot_life = st._life_queued
        st._on_rx("$BUT,2,1,*"); st._on_rx("$BUT,2,0,*"); await settle(st)
        assert st.reloading and st.reloading["soft"]
        before = len(_tx(st))
        st._on_rx("$HP,0,0,0,*"); await settle(st)
        assert not st.alive
        await _tick(st, clock, 3)
        assert not any(f.startswith("$AMMO,0,") for f in _tx(st)[before:])
    asyncio.run(go())
