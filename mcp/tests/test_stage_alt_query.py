"""F542 on the stage: past the swap window, ALT asks the live gun for its slot (ammo.js `switchTick`/`finishAlt`,
engine.js `_askSlot`/`_askMagazine`/`_expireMagazineQuery`).

Each test pins one rule, so a regression names it and not only a golden-trace checkpoint:
  - a queried `$LCD` on another slot moves the trigger and the ALT pointer ("swap (queried)");
  - a reply on the HUD's own slot closes the card with no swap (the press was swallowed);
  - silence past QUERY_REPLY_S, or a link that refuses the write, books the unconfirmed swap;
  - a game-state refusal (here a stun) sends nothing and keeps the last confirmed slot;
  - a death `$LCD` answering the query closes the card with no swap;
  - a confirmed pickup slot (2) never moves the ALT pointer, which stays on 0 or 1;
  - a reload follows the slot whose magazine rises (ammo.js `onAmmo`).
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


async def _alt_past_window(st, clock, extra_s: float = 0.05) -> int:
    """Press ALT, then run the tick just past the swap window. Returns the tx count before the tick."""
    st._on_rx("$BUT,1,1,*"); st._on_rx("$BUT,1,0,*")
    assert st.switching is not None and st.switching["to"] == 1
    before = len(_tx(st))
    clock.t += st._switch_window_s() + extra_s
    st.poll(); await settle(st)
    return before


async def _tick(st, clock, s: float) -> None:
    clock.t += s
    st.mgr.pump()
    st.poll(); await settle(st)
    st.poll(); await settle(st)


def test_a_queried_lcd_on_the_other_slot_moves_the_trigger():
    async def go():
        st, gun, clock = await _live()
        gun.active_slot = 1; gun.mag[1] = 6; gun.reserve[1] = 24
        before = await _alt_past_window(st, clock)
        assert "$QUERY,*" in _tx(st)[before:], "past the window the stage asks the gun"
        await _tick(st, clock, 0.05)
        assert st.switching is None
        assert st.active_slot == 1 and st._alt_ptr == 1
        assert any("confirmed by $LCD" in t for t in _texts(st)), _texts(st)[-5:]
        assert not any("assumed after" in t for t in _texts(st))
    asyncio.run(go())


def test_a_reply_on_the_huds_slot_closes_the_card_with_no_swap():
    async def go():
        st, gun, clock = await _live()
        gun.active_slot = 0
        await _alt_past_window(st, clock)
        await _tick(st, clock, 0.05)
        assert st.switching is None
        assert st.active_slot == 0 and st._alt_ptr == 0, "the gun is still on slot 0: the press was swallowed"
        assert any("the press was swallowed" in t for t in _texts(st)), _texts(st)[-5:]
    asyncio.run(go())


def test_silence_books_the_unconfirmed_swap():
    async def go():
        st, _gun, clock = await _live(_MuteQueryTagger)
        before = await _alt_past_window(st, clock)
        assert "$QUERY,*" in _tx(st)[before:]
        await _tick(st, clock, 1.0)
        assert st.switching is not None, "inside QUERY_REPLY_S the card still waits"
        assert st.active_slot == 0
        await _tick(st, clock, 0.6)
        assert st.switching is None
        assert st.active_slot == 1 and st._alt_ptr == 1 and st._alt_evidence_pending == 1
        assert any("unconfirmed: $QUERY had no answer" in t for t in _texts(st)), _texts(st)[-5:]
    asyncio.run(go())


def test_a_link_that_refuses_the_query_books_the_unconfirmed_swap():
    async def go():
        st, _gun, clock = await _live()
        real = st.write

        async def refusing(frames, why, *a, **kw):
            if frames == ["$QUERY,*"]:
                return False
            return await real(frames, why, *a, **kw)
        st.write = refusing   # type: ignore[method-assign]
        await _alt_past_window(st, clock)
        await _tick(st, clock, 0.05)
        assert st.switching is None
        assert st.active_slot == 1
        assert any("unconfirmed: $QUERY had no answer" in t for t in _texts(st)), _texts(st)[-5:]
    asyncio.run(go())


def test_a_stun_refuses_the_query_and_keeps_the_last_confirmed_slot():
    async def go():
        st, _gun, clock = await _live()
        st._on_rx("$BUT,1,1,*"); st._on_rx("$BUT,1,0,*")
        assert st.switching is not None
        st.stunned = {"at": clock.t, "until": clock.t + 30.0, "ammo": {}}
        before = len(_tx(st))
        await _tick(st, clock, st._switch_window_s() + 0.05)
        assert "$QUERY,*" not in _tx(st)[before:], "a stunned gun is never asked"
        assert st.switching is not None, "inside the reply window the card waits"
        await _tick(st, clock, 1.5)
        assert st.switching is None
        assert st.active_slot == 0 and st._alt_evidence_pending is None
        assert any("keeping the last confirmed slot" in t for t in _texts(st)), _texts(st)[-5:]
    asyncio.run(go())


def test_a_death_lcd_answering_the_query_closes_the_card_with_no_swap():
    async def go():
        st, _gun, clock = await _live(_MuteQueryTagger)
        await _alt_past_window(st, clock)
        st._on_rx("$LCD,0,0,0,1,6,24,*")
        st.poll(); await settle(st)
        assert not st.alive
        assert st.switching is None
        await _tick(st, clock, 2.0)
        assert st.active_slot == 0, "a dead reply is no slot evidence"
        assert not any("confirmed by $LCD" in t or "unconfirmed" in t for t in _texts(st))
    asyncio.run(go())


def test_a_confirmed_pickup_slot_never_moves_the_alt_pointer():
    async def go():
        st, gun, clock = await _live()
        gun.active_slot = 2; gun.mag[2] = 2; gun.reserve[2] = 0
        await _alt_past_window(st, clock)
        await _tick(st, clock, 0.05)
        assert st.switching is None
        assert st.active_slot == 2
        assert st._alt_ptr in (0, 1), st._alt_ptr
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
