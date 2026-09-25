"""The M5StickS3 screen gate: every station screen, from the real state machines to real pixels.

`hardware/m5sticks3/sim/stick_sim.py` drives StationLink, ControlPoint, PlayerPresence and the button
state machines through each scenario, maps the result through the firmware's own build_stick_state()
and compute_screen(), and draws it with the firmware's own station_render.h (against the installed
M5GFX, on the host). This fails when a scenario shows the wrong screen kind or copy (the EXPECT
table), when text runs off the screen, out of its band or over other text, when two different states
draw the same picture, or when the simulator crashes.

It runs twice: the default build, and the post-MVP build with revive feedback on (EXPECT_REVIVE_ON),
so the screens behind that switch cannot rot. A text the fitter had to cut fails it too. KNOWN in
stick_sim.py lists accepted design exceptions, each with its reason (none today); one that stops
reproducing fails, so the table follows the screen.
Without g++ the whole file skips; without M5GFX only the kinds are checked (the text checks skip).
Review the gallery (`python3 hardware/m5sticks3/sim/stick_sim.py`) before flashing a screen change.
"""
import importlib.util
import pathlib
import shutil

from _skip import needs

ROOT = pathlib.Path(__file__).resolve().parents[2]
_SPEC = importlib.util.spec_from_file_location("stick_sim", ROOT / "hardware/m5sticks3/sim/stick_sim.py")
sim = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(sim)
GXX = shutil.which("g++")

_cache: dict = {}


def _run():
    if "r" not in _cache:
        results, rendered = sim.run(None)
        _cache["r"] = (results, rendered, sim.check(results, rendered))
    return _cache["r"]


def test_stick_screens_pass_the_gate():
    needs(GXX, "g++")
    _results, _rendered, probs = _run()
    open_ = {k: v for k, v in probs.items() if k not in sim.KNOWN}
    assert not open_, "Stick screens flagged:\n" + "\n".join(f"  {k}: {x}" for k, v in open_.items() for x in v)


def test_stick_screen_text_was_measured():
    needs(GXX, "g++")
    results, rendered, _probs = _run()
    needs(rendered, "M5GFX (set M5GFX_SRC)")
    assert all(r.get("texts") for r in results), "a scenario drew no text at all"


def test_stick_screens_pass_the_gate_with_revive_feedback_on():
    needs(GXX, "g++")
    results, rendered = sim.run(None, revive_on=True)
    assert all(r["revive_feedback"] for r in results), "the revive-on build did not switch it on"
    probs = sim.check(results, rendered, sim.EXPECT_REVIVE_ON)
    assert not probs, "revive-on Stick screens flagged:\n" + "\n".join(f"  {k}: {x}" for k, v in probs.items() for x in v)


def test_min_gap_rule_at_1_2_and_3_px():
    """Two strings side by side: 1 px of background apart is a smudge, 2 px (MIN_GAP) and 3 px are fine."""
    assert sim.MIN_GAP == 2

    def res(gap):
        a = {"text": "A", "font": "f", "ax": 50, "ay": 60, "inked": True, "box": [40, 50, 60, 70]}
        b = {"text": "B", "font": "f", "ax": 90, "ay": 60, "inked": True, "box": [61 + gap, 50, 90, 70]}
        return {"texts": [a, b]}
    # box x1 = 60 and x0 = 61 + gap leaves `gap` px of background between the two inks
    assert any("overlap or touch" in p for p in sim.text_problems(res(0)))
    assert any("overlap or touch" in p for p in sim.text_problems(res(1)))
    assert not sim.text_problems(res(2))
    assert not sim.text_problems(res(3))


def test_known_stick_findings_still_reproduce():
    """A KNOWN entry whose screen is now clean must leave the table."""
    needs(GXX, "g++")
    _results, rendered, probs = _run()
    needs(rendered, "M5GFX (set M5GFX_SRC)")
    fixed = sorted(k for k in sim.KNOWN if k not in probs)
    assert not fixed, f"fixed, remove from KNOWN in stick_sim.py: {fixed}"
