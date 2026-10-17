"""The ALT swap on the stage (ammo.js `switchTick`/`onAmmo`/`reloadPulled`, brx4 d7194e82).

Bench 2026-10-17 (Tactix-FE30, 0.4.24): the `$LCD` slot token is the slot of the LAST SHOT, not the selected slot, so
the node never asks the gun for its slot after ALT. Each test pins one rule:
  - past the window the swap is assumed, with no `$QUERY`;
  - the next shot's `$ALCD` slot corrects the trigger and the ALT pointer;
  - a lever pulled inside the swap reloads the OLD slot: that rise books on the old slot and the trigger stays;
  - a reload follows the slot whose magazine rises, and a round on any slot ends it (ammo.js `onAmmo`);
  - the one magazine query owner (engine.js `_askSlot`, which nothing calls now) still releases on every path.
"""
from __future__ import annotations

import asyncio

from brx_mcp.fake import FakeConnectionManager, FakeTagger
from brx_mcp.stage.stage import GunStage
from _stage import GUN, StageClock, _nosleep, settle


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
    for _ in range(3):   # let the fake's delayed `$ALCD` echoes of the spawn rows land before the test presses anything
        clock.t += 0.5; mgr.pump(); st.poll(); await settle(st)
    assert st._slot_count() == 2 and st.active_slot == 0
    return st, gun, clock


def _tx(st) -> list[str]:
    return [e["raw"] for e in st.mgr.get_events("stage", max_events=10**6)["events"] if e["direction"] == "tx"]


def _texts(st) -> list[str]:
    return [e["text"] for e in st.log]


def _alt(st) -> None:
    st._on_rx("$BUT,1,1,*"); st._on_rx("$BUT,1,0,*")
    assert st.switching is not None and st.switching["to"] == 1


async def _tick(st, clock, s: float) -> None:
    clock.t += s
    st.mgr.pump()
    st.poll(); await settle(st)
    st.poll(); await settle(st)


def _ask(st):
    """Open the one magazine query directly (engine.js `_askSlot`). Returns the replies and timeouts it books."""
    replies: list[int] = []
    timeouts: list[int] = []
    ok = st._ask_slot("test slot read", replies.append, lambda: timeouts.append(1))
    return ok, replies, timeouts


def test_alt_past_the_window_assumes_the_swap_and_asks_nothing():
    async def go():
        st, gun, clock = await _live()
        assert gun.active_slot == 0   # the gun's last shot was slot 0: a `$QUERY` would read the swap as swallowed
        _alt(st)
        before = len(_tx(st))
        await _tick(st, clock, st._switch_window_s() + 0.05)
        assert "$QUERY,*" not in _tx(st)[before:], "the stage never asks the gun for its slot after ALT"
        assert st.switching is None
        assert st.active_slot == 1 and st._alt_ptr == 1
        assert any("swap to slot 1 assumed after" in t for t in _texts(st)), _texts(st)[-5:]
        await _tick(st, clock, 2.0)
        assert st.active_slot == 1, "nothing later moves the trigger back without a shot"
    asyncio.run(go())


def test_the_next_shot_on_the_old_slot_moves_the_trigger_and_the_pointer_back():
    async def go():
        st, _gun, clock = await _live()
        st._on_rx("$ALCD,20,100,0,192,0,*")
        _alt(st)
        await _tick(st, clock, st._switch_window_s() + 0.05)
        assert st.active_slot == 1 and st._alt_ptr == 1
        st._on_rx("$ALCD,19,100,0,192,0,*")   # the gun swallowed the press: the round leaves slot 0
        assert st.active_slot == 0 and st._alt_ptr == 0, (st.active_slot, st._alt_ptr)
    asyncio.run(go())


def _bench_reload_setup(st):
    """bench 2026-10-17: an AR shot on slot 0, the secondary's counts known, then ALT."""
    st._on_rx("$ALCD,6,100,1,120,0,*")
    st._on_rx("$ALCD,31,100,0,182,0,*")
    st._on_rx("$ALCD,30,100,0,182,0,*")
    assert st.active_slot == 0
    _alt(st)


def test_a_lever_inside_the_swap_reloads_the_old_slot_and_the_trigger_stays():
    """The bench trace: ALT, the lever 450 ms later, `$ALCD,32,100,0,182` inside the window, then a USP shot."""
    async def go():
        st, _gun, clock = await _live()
        _bench_reload_setup(st)
        await _tick(st, clock, 0.45)
        st._on_rx("$BUT,2,1,*"); st._on_rx("$BUT,2,0,*")
        assert st.reloading and st.reloading["slot"] == 0 and st.reloading["swap_to"] == 1, st.reloading
        await _tick(st, clock, 0.2)
        ptr, pending = st._alt_ptr, st._alt_evidence_pending
        st._on_rx("$ALCD,32,100,0,182,0,*")   # the old slot's magazine rises
        assert st.switching is not None, "the swap is still open"
        assert st.active_slot == 0 and (st._alt_ptr, st._alt_evidence_pending) == (ptr, pending)
        assert st.reload_outcome and st.reload_outcome["slot"] == 0, st.reload_outcome   # the reload block still books first
        assert st._prev_ammo[0] == 32 and st._prev_reserve[0] == 182
        assert any("reload landed on slot 0 after the swap to slot 1; the trigger stays" in t for t in _texts(st)), _texts(st)[-5:]
        await _tick(st, clock, st._switch_window_s())
        assert st.switching is None and st.active_slot == 1 and st._alt_ptr == 1
        st._on_rx("$ALCD,5,100,1,120,0,*")    # the USP shot
        assert st.active_slot == 1 and st._alt_ptr == 1
    asyncio.run(go())


def test_the_old_slot_reload_landing_after_the_assumed_swap_leaves_the_trigger():
    async def go():
        st, _gun, clock = await _live()
        _bench_reload_setup(st)
        await _tick(st, clock, 0.45)
        st._on_rx("$BUT,2,1,*"); st._on_rx("$BUT,2,0,*")
        assert st.reloading and st.reloading["swap_to"] == 1
        await _tick(st, clock, st._switch_window_s())
        assert st.switching is None and st.active_slot == 1
        st._on_rx("$ALCD,32,100,0,182,0,*")   # the old slot's rise lands after the swap was assumed
        assert st.active_slot == 1 and st._alt_ptr == 1, (st.active_slot, st._alt_ptr)
        assert st._prev_ammo[0] == 32
    asyncio.run(go())


def test_a_reload_with_no_swap_open_records_no_swap_target():
    async def go():
        st, _gun, _clock = await _live()
        st._on_rx("$ALCD,20,100,0,192,0,*")
        st._on_rx("$BUT,2,1,*")
        assert st.reloading and st.reloading["swap_to"] is None
    asyncio.run(go())


def test_a_reload_follows_the_slot_whose_magazine_rises():
    async def go():
        st, _gun, clock = await _live()
        st._on_rx("$ALCD,20,100,0,192,0,*")
        st._on_rx("$ALCD,4,100,1,24,0,*")    # the secondary reports (the gun swapped without our seeing ALT)
        st.active_slot = 0
        st._on_rx("$BUT,2,1,*")
        assert st.reloading and st.reloading["slot"] == 0
        await _tick(st, clock, 0.2)
        st._on_rx("$ALCD,6,100,1,22,0,*")    # the magazine that rises is slot 1's
        assert st.reloading is None or st.reloading["slot"] == 1, st.reloading
        assert st.active_slot == 1 and st._alt_ptr == 1
        assert any("reload moved from slot 0 to gun slot 1" in t for t in _texts(st)), _texts(st)[-5:]
    asyncio.run(go())


def test_a_round_on_any_slot_ends_the_reload():
    async def go():
        st, _gun, clock = await _live()
        st._on_rx("$ALCD,20,100,0,192,0,*")
        st._on_rx("$ALCD,6,100,1,24,0,*")
        st.active_slot = 0
        st._on_rx("$BUT,2,1,*")
        assert st.reloading and st.reloading["slot"] == 0
        await _tick(st, clock, 0.2)
        st._on_rx("$ALCD,5,100,1,24,0,*")    # a round leaves slot 1: the gun is firing, not reloading
        assert st.reloading is None
        assert st.reload_outcome and st.reload_outcome["why"] == "fired", st.reload_outcome
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


def test_an_lcd_rise_on_the_old_slot_is_no_reload_landing():
    """ammo.js `oldSlotReload` needs a real `$ALCD`: an `$LCD` report on the old slot books through the usual path."""
    async def go():
        st, _gun, clock = await _live()
        _bench_reload_setup(st)
        await _tick(st, clock, 0.45)
        st._on_rx("$BUT,2,1,*"); st._on_rx("$BUT,2,0,*")
        st._on_ammo(32, 182, 0, lcd=True)
        assert not any("reload landed on slot" in t for t in _texts(st)), _texts(st)[-5:]
    asyncio.run(go())


def test_the_poll_that_finds_a_dropped_link_books_no_assumed_swap():
    """F542 r1 reviews: the phone's `onBleDropped` cancels the swap before its tick can assume it."""
    async def go():
        st, _gun, clock = await _live()
        _alt(st)
        ptr = st._alt_ptr
        st.mgr.is_connected = lambda _alias: False   # type: ignore[attr-defined]
        clock.t += st._switch_window_s() + 0.05
        st.poll(); await settle(st)
        assert st.active_slot == 0 and st._alt_ptr == ptr and st.switching is None, (st.active_slot, st._alt_ptr)
        assert not any("assumed after" in t for t in _texts(st))
    asyncio.run(go())
