"""F52: the A16.3 readout timings have ONE owner (mc/types.py). The phone engine and the stage must fall back to
the named constants, never to a literal that would silently disagree after a bench retune.

Run: python3 run_tests.py readout_timings_one_owner
"""
import pathlib
import re

from brx_mcp import poolgauge as pg
from brx_mcp.mc import types as T
from _phone_src import phone_sources

ROOT = pathlib.Path(__file__).resolve().parents[2]
KEYS = ("lead_ms", "blink_gap_ms", "step_ms", "blink_ms", "min_gap_ms", "hold_s")


def test_poolgauge_takes_its_values_from_the_one_owner():
    assert (pg.READOUT_LEAD_MS, pg.READOUT_BLINK_GAP_MS, pg.READOUT_STEP_MS, pg.READOUT_BLINK_MS,
            pg.READOUT_MIN_GAP_MS) == (T.READOUT_LEAD_MS, T.READOUT_BLINK_GAP_MS, T.READOUT_STEP_MS,
                                       T.READOUT_BLINK_MS, T.READOUT_MIN_GAP_MS)


def test_the_phone_engine_has_no_literal_fallback():
    for name, src in phone_sources().items():
        for k in KEYS:
            bad = re.findall(rf"readout\.{k} != null \? readout\.{k} : \d", src)
            assert not bad, f"{name} falls back to a literal for {k}: {bad}"


def test_phone_sources_reads_the_engine_siblings_and_catches_a_pattern_in_ammo():
    import tempfile
    src = phone_sources()
    assert "ammo.js" in src and "reconcile.js" in src and "engine.js" in src
    assert not any(n.endswith(".gen.js") for n in src)
    with tempfile.TemporaryDirectory() as d:
        root = pathlib.Path(d)
        (root / "engine.js").write_text("clean\n")
        (root / "ammo.js").write_text("x = readout.step_ms != null ? readout.step_ms : 5\n")
        (root / "contract.gen.js").write_text("ignored readout.step_ms != null ? readout.step_ms : 5\n")
        hits = {n for n, t in phone_sources(root).items() if re.search(r"readout\.step_ms != null \? readout\.step_ms : \d", t)}
        assert hits == {"ammo.js"}, hits


def test_the_stage_has_no_literal_fallback():
    src = (ROOT / "mcp/brx_mcp/stage/stage.py").read_text(encoding="utf-8")
    for k in KEYS:
        bad = re.findall(rf'readout\.get\("{k}", \d', src)
        assert not bad, f"stage.py falls back to a literal for {k}: {bad}"
