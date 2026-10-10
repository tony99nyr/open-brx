"""A18 (review 2026-10-10): the stage's write path is `write` (filter, team restore, fillers), `_send_job` (one group
per `$PLAY`) and `_deliver` (the PLAY gap, the audio wait, the send), with the shared fields in a `_WriteJob` that
mirrors engine.js `job`. These pin what the old `_chunk`/`_queued_at` re-entry did and no golden trace reaches."""
import asyncio
import pathlib
import sys

if __name__ == "__main__":
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from brx_mcp.stage.stage import PLAYX
from _stage import GUN, mk_stage, tx

TWO_CUES = ["$PLAY,VA81,4,6,,,,,*", "$PLAY,U16,4,6,,,,,*"]


async def _linked():
    st, mgr = mk_stage()
    await st.connect(GUN)
    return st, mgr


def test_a_write_with_two_cues_calls_on_start_once_with_the_first_group():
    async def run():
        st, mgr = await _linked()
        calls = []
        before = len(tx(mgr))
        await st.write(TWO_CUES, "two cues", on_start=lambda: calls.append(len(tx(mgr))))
        assert calls == [before], f"on_start must fire once, as the FIRST group starts: {calls} (before {before})"
        assert tx(mgr)[before:] == TWO_CUES
    asyncio.run(run())


def test_a_take_is_claimed_by_the_group_that_changes_the_sir_table():
    async def run():
        st, _ = await _linked()
        await st.write([*TWO_CUES, "$SIR,0,0,,1,0,0,1,,*"], "cues then a table row", take=True)
        assert st._sir_live is True, "the second group carries the $SIR row, so it claims the table"
        await st.write([*TWO_CUES, "$SIR,0,0,,1,0,0,1,,*"], "the same, not a take")
        assert st._sir_live is False
    asyncio.run(run())


def test_model_false_keeps_a_stop_out_of_the_gun_audio_model():
    async def run():
        st, mgr = await _linked()
        booked = []
        st._audio_write = lambda frames, why: booked.append(list(frames))   # type: ignore[method-assign]
        await st.write([PLAYX], "a stop the caller books itself", gap_ms=0, model=False)
        assert booked == [] and tx(mgr)[-1] == PLAYX
        await st.write([PLAYX], "an ordinary stop", gap_ms=0)
        assert booked == [[PLAYX]]
        booked.clear()
        # engine.js `_mustWrite` covers the whole write, so model=False holds for every group of a two-cue write
        await st.write(TWO_CUES, "two cues the caller books itself", gap_ms=0, model=False)
        assert booked == []
    asyncio.run(run())
