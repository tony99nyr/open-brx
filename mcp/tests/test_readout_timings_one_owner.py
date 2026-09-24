"""F52: the A16.3 readout timings have ONE owner (mc/types.py). The phone engine and the stage must fall back to
the named constants, never to a literal that would silently disagree after a bench retune.

Run: python3 run_tests.py readout_timings_one_owner
"""
import pathlib
import re

from brx_mcp import poolgauge as pg
from brx_mcp.mc import types as T

ROOT = pathlib.Path(__file__).resolve().parents[2]
KEYS = ("lead_ms", "blink_gap_ms", "step_ms", "blink_ms", "min_gap_ms", "hold_s")


def test_poolgauge_takes_its_values_from_the_one_owner():
    assert (pg.READOUT_LEAD_MS, pg.READOUT_BLINK_GAP_MS, pg.READOUT_STEP_MS, pg.READOUT_BLINK_MS,
            pg.READOUT_MIN_GAP_MS) == (T.READOUT_LEAD_MS, T.READOUT_BLINK_GAP_MS, T.READOUT_STEP_MS,
                                       T.READOUT_BLINK_MS, T.READOUT_MIN_GAP_MS)


def test_the_phone_engine_has_no_literal_fallback():
    src = (ROOT / "app/src/engine.js").read_text(encoding="utf-8")
    for k in KEYS:
        bad = re.findall(rf"readout\.{k} != null \? readout\.{k} : \d", src)
        assert not bad, f"engine.js falls back to a literal for {k}: {bad}"


def test_the_stage_has_no_literal_fallback():
    src = (ROOT / "mcp/brx_mcp/stage/stage.py").read_text(encoding="utf-8")
    for k in KEYS:
        bad = re.findall(rf'readout\.get\("{k}", \d', src)
        assert not bad, f"stage.py falls back to a literal for {k}: {bad}"
