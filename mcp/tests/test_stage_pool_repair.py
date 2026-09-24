"""F341: the stage MIRRORS engine.js's pool read-back and repair (app/test/pool-readback.test.mjs is the phone side).

Field 2026-09-24 (app 0.4.11, a Pixel 5, Tactix-FE30): the last chunk of the spawn burst's `$PSET` failed with Android
status 201 and brxlink sent the `$PSET` again from its first byte. The gun's parser keeps tokens 1..59 across a `$`
(transport-hardening.md §1.3), so the second copy was appended to the partial first one, and the gun reported
`$HP,4545,7070,0` for the rest of the match. The spawn read-back only checked that an answer came.

These tests drive the stage against a FakeTagger whose `feed_bytes` fault knob models that parser byte for byte,
so 4545/7070 comes out of the bytes, not out of the test. Every test breaks one rule; the CONTROL pins the path
that must not move.

Run: python3 run_tests.py stage_pool_repair
"""
from __future__ import annotations

import asyncio

from brx_mcp.fake import FakeConnectionManager, FakeTagger
from brx_mcp.stage.stage import GunStage, PARSER_RESET
from test_stage import _Clock, _nosleep, settle

GUN = "FA:KE:00:00:00:01"


def _mk(garble: bool = False, ignore_repairs: bool = False):
    tagger = FakeTagger(GUN, "FAKE-STAGE", team=1)
    state = {"garble": False}
    real_write = tagger.write

    def write(frame: str) -> None:
        if ignore_repairs and state.get("armed") and (frame == PARSER_RESET or frame.startswith("$PSET,")
                                                      or (frame.startswith("$LIFE,") and frame.endswith(",1,*"))):
            return                                   # a gun that never takes a repair
        if state["garble"] and frame.startswith("$PSET,"):
            state["garble"] = False
            tagger.feed_bytes(frame[:60])            # the copy whose `*` chunk was lost (the incident)
        real_write(frame)

    tagger.write = write                             # type: ignore[method-assign]
    mgr = FakeConnectionManager([tagger])
    clock = _Clock()
    st = GunStage(mgr, None, sleep=_nosleep, now=clock, voice_verdict_sink=lambda _r: None)
    return st, tagger, clock, state


async def _adv(st, clock, s: float, step: float = 0.25):
    end = clock() + s
    while clock() < end:
        clock.advance(min(step, end - clock())); st.poll()
        await settle(st)


async def _spawned(garble: bool = False, ignore_repairs: bool = False):
    st, tagger, clock, state = _mk(garble, ignore_repairs)
    await st.connect(GUN)
    await st.arm(); await settle(st)
    state["garble"] = garble
    await st.spawn(); await settle(st)
    state["armed"] = True                            # `ignore_repairs` starts after the spawn burst
    await _adv(st, clock, 0.25)
    return st, tagger, clock


def _tx(st) -> list[str]:
    return [l["text"] for l in st.log if l["kind"] == "tx"]


def _has(st, needle: str) -> bool:
    return any(needle in l["text"] for l in st.log)


def test_control_a_clean_spawn_reads_back_and_repairs_nothing():
    async def run():
        st, tagger, clock = await _spawned()
        await _adv(st, clock, 4.0)
        assert (tagger.hp, tagger.armor) == (45, 70)
        assert not any(f.endswith(",1,*") and f.startswith("$LIFE,") for f in _tx(st))
        assert st.pool_stale() is None
    asyncio.run(run())


def test_the_fake_reproduces_4545_7070_from_a_partial_pset():
    async def run():
        st, tagger, clock = await _spawned(garble=True)
        rx = [l["text"] for l in st.log if l["kind"] == "rx"]
        assert any(f.startswith("$LCD,4545,7070,") for f in rx), "the `$SPAWN` armed the doubled pools"
    asyncio.run(run())


def test_the_spawn_read_back_catches_4545_and_repairs_it_with_a_parser_reset_the_pset_and_a_life_set():
    async def run():
        st, tagger, clock = await _spawned(garble=True)
        await _adv(st, clock, st.SPAWN_PROBE_S + st.POOL_REPAIR_READ_S + 1.0)
        sent = _tx(st)
        after = sent[sent.index("$SPAWN,,*"):]
        at = after.index(PARSER_RESET)
        assert after[at + 1].startswith("$PSET,") and ",45,70," in after[at + 1]
        assert "$LIFE,45,70,0,1,*" in after[at + 1:]
        assert (tagger.hp, tagger.armor) == (45, 70)
        assert (tagger.cfg_hp, tagger.cfg_armor) == (45, 70), "the gun holds the right ceilings again"
        assert _has(st, "gun pools 4545/7070/0 are above the armed ceiling 45/70")
        assert _has(st, "pool repair held")
        assert st.pool_stale() is None
    asyncio.run(run())


def test_a_gun_that_never_takes_the_repair_reads_pool_wrong_and_the_repair_is_bounded():
    async def run():
        st, tagger, clock = await _spawned(garble=True, ignore_repairs=True)
        await _adv(st, clock, st.SPAWN_PROBE_S + (st.POOL_REPAIR_READ_S + 0.6) * (st.POOL_REPAIR_TRIES + 1))
        sets = [f for f in _tx(st) if f.startswith("$LIFE,") and f.endswith(",1,*")]
        assert len(sets) == st.POOL_REPAIR_TRIES
        assert (st.pool_stale() or {}).get("why") == "pool_wrong"
        await _adv(st, clock, 30.0)
        assert len([f for f in _tx(st) if f.startswith("$LIFE,") and f.endswith(",1,*")]) == st.POOL_REPAIR_TRIES
    asyncio.run(run())


def test_control_a_real_hit_before_the_read_back_leaves_lower_pools_alone():
    async def run():
        st, tagger, clock = await _spawned()
        await _adv(st, clock, 1.0)
        tagger.armor = 55
        st._inject_rx("$HIR,0,0,19,2,15,0,0,*"); st._inject_rx("$HP,45,55,0,*")
        await settle(st)
        await _adv(st, clock, 4.0)
        assert not any(f.startswith("$LIFE,") and f.endswith(",1,*") for f in _tx(st))
    asyncio.run(run())
