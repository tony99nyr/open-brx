"""The AMMO pickup grant on the bench stage, against the cases the phone shares (app/test/fixtures/ammo-grant-cases.json;
the phone reads the same file in app/test/ammo-grant-cases.test.mjs).

Run: python3 run_tests.py ammo_grant_cases
"""
import asyncio
import json
import pathlib

from _stage import StageClock, live_stage, mk_stage, settle

FIXTURE = pathlib.Path(__file__).resolve().parents[2] / "app" / "test" / "fixtures" / "ammo-grant-cases.json"
CASES = json.loads(FIXTURE.read_text())["cases"]


def _rows(obj):
    return {int(k): list(v) for k, v in obj.items()}


def test_the_stage_grants_ammo_as_the_phone_does():
    async def go():
        for c in CASES:
            st, _mgr = mk_stage()
            st._spawn_ammo = lambda c=c: _rows(c["spawn"])     # type: ignore[method-assign]
            st._live_ammo = lambda c=c: _rows(c["live"])       # type: ignore[method-assign]
            sent: list[str] = []
            st.spawned = st.alive = True
            st.active_slot = c.get("active", 0)
            acct: list = []
            shown: list = []
            real_acct = st._acct_wrote
            st._acct_wrote = lambda slot, mag, res=None, **kw: (acct.append([slot, mag, res]), real_acct(slot, mag, res, **kw))   # type: ignore[method-assign]
            st._show_slot_ammo = lambda slot: shown.append(slot)   # type: ignore[method-assign]

            async def write(frames, why, *a, **kw):
                sent.extend(frames)
                return True
            st.write = write   # type: ignore[method-assign]
            short = st._ammo_short(c["item"])
            got = None if short is None else {str(k): v for k, v in short.items()}
            assert got == c["short"], (c["name"], got)
            await st.grant_ammo({"name": "AMMO", **c["item"]})
            await settle(st)
            assert sent == c["frames"], (c["name"], sent)
            assert acct == c["acct"], (c["name"], acct)
            assert [[k, st._prev_ammo[k], st._prev_reserve[k]] for k, *_ in c["acct"]] == c["acct"], c["name"]
            assert shown == ([] if c["shown"] is None else [c["shown"]]), (c["name"], shown)
    asyncio.run(go())


def test_a_grant_books_the_new_reserve_so_its_echo_is_bookkeeping():
    """ammo.js `acctWrote` + `setPrev`: the gun's echo of the grant is our own write, never a shot or a reload."""
    async def go():
        st, _mgr = mk_stage()
        st._spawn_ammo = lambda: {0: [30, 120]}     # type: ignore[method-assign]
        st._live_ammo = lambda: {0: [12, 40]}       # type: ignore[method-assign]

        async def write(frames, why, *a, **kw):
            return True
        st.write = write   # type: ignore[method-assign]
        st.spawned = st.alive = True
        await st.grant_ammo({"name": "AMMO", "refill": "reserve"})
        assert st._prev_ammo.get(0) == 12 and st._prev_reserve.get(0) == 120
    asyncio.run(go())


def test_a_grant_to_a_down_player_writes_nothing():
    """Opus review: the phone grants only after an alive claim, and its writeMust drops a write once the life ends."""
    async def go():
        st, _mgr = mk_stage()
        st._spawn_ammo = lambda: {0: [30, 120]}     # type: ignore[method-assign]
        st._live_ammo = lambda: {0: [12, 40]}       # type: ignore[method-assign]
        sent: list[str] = []

        async def write(frames, why, *a, **kw):
            sent.extend(frames)
            return True
        st.write = write   # type: ignore[method-assign]
        st.spawned, st.alive = True, False
        assert await st.grant_ammo({"name": "AMMO", "refill": "reserve"}) is None and sent == []
        st.alive = True
        assert await st.grant_ammo({"name": "AMMO", "refill": "reserve"}) is not None and sent, "CONTROL"
    asyncio.run(go())


def test_a_failed_grant_write_is_sent_again_while_the_life_lasts():
    """The phone's writeMust (Codex review): a write the link refuses is retried for the life."""
    async def go():
        st, _mgr = mk_stage()
        st._spawn_ammo = lambda: {0: [30, 120]}     # type: ignore[method-assign]
        st._live_ammo = lambda: {0: [12, 40]}       # type: ignore[method-assign]
        st.spawned = st.alive = True
        tries: list[list[str]] = []

        async def write(frames, why, *a, **kw):
            tries.append(list(frames))
            return len(tries) > 1          # the first send fails, the retry lands
        st.write = write   # type: ignore[method-assign]
        await st.grant_ammo({"name": "AMMO", "refill": "reserve"})
        assert tries == [["$AMMO,0,12,120,1,*"]] * 2, tries
    asyncio.run(go())


def test_a_real_account_after_a_shot_keeps_the_magazine_it_reports():
    """Codex review: through the real `_spawn_ammo`/`_live_ammo`, not stubs: the grant writes the magazine the account
    holds after a round left, and the reserve goes to the spawn reserve."""
    async def go():
        clock = StageClock()
        st, mgr = mk_stage(now=clock)
        await live_stage(st, clock)
        spawn = st._spawn_ammo()
        assert 0 in spawn and spawn[0][1] > 0, spawn
        mag0, res0 = spawn[0]
        st._on_rx(f"$ALCD,{mag0 - 1},100,0,{res0 - 5},0,*")   # a round left, and the reserve is short
        await settle(st)
        live = st._live_ammo()[0]
        sent: list[str] = []

        async def write(frames, why, *a, **kw):
            sent.extend(frames)
            return True
        st.write = write   # type: ignore[method-assign]
        await st.grant_ammo({"name": "AMMO", "refill": "reserve"})
        assert sent == [f"$AMMO,0,{live[0]},{res0},1,*"], (sent, live, spawn)
        assert live[0] == mag0 - 1, live
    asyncio.run(go())
