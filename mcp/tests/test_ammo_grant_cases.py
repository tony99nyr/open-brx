"""The AMMO pickup grant on the bench stage, against the cases the phone shares (app/test/fixtures/ammo-grant-cases.json;
the phone reads the same file in app/test/ammo-grant-cases.test.mjs).

Run: python3 run_tests.py ammo_grant_cases
"""
import asyncio
import json
import pathlib

from _stage import mk_stage, settle

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
        await st.grant_ammo({"name": "AMMO", "refill": "reserve"})
        assert st._prev_ammo.get(0) == 12 and st._prev_reserve.get(0) == 120
    asyncio.run(go())
