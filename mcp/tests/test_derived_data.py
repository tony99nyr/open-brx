"""The derived Callsign data files are load-bearing, not decoration.

`protocol/callsign-extract/*.json` (the app's raw config assets) were removed on 2026-09-07 under the
repo's own no-raw-assets policy, and the facts our code depends on were restated into
`brx_mcp/data/` by `mcp/tools/derive_callsign_data.py`. That trade only holds if something FAILS when
the restated value and the constant built on it drift apart. `announcer.py` cited the medal window in
a comment, and a comment has never stopped a drift; this asserts it instead.

No pytest: plain test_* functions, run by run_tests.py under the system python.
"""
from __future__ import annotations

import json
import pathlib

from _skip import Skipped

DATA = pathlib.Path(__file__).resolve().parents[1] / "brx_mcp" / "data"


def _load(name: str) -> dict:
    p = DATA / name
    if not p.exists():
        raise Skipped(f"{p} (regenerate with mcp/tools/derive_callsign_data.py)")
    return json.loads(p.read_text(encoding="utf-8"))


def _provenance(doc: dict, name: str) -> None:
    for key in ("generated", "source"):
        assert doc.get(key), f"{name} has no '{key}' header: a derived file must say what it came from"
    assert "RAW_ASSETS_NOTE" in doc["source"], (
        f"{name}'s source line must point at protocol/callsign-extract/RAW_ASSETS_NOTE.md, "
        "so a reader learns why the raw asset is not in the repo"
    )


def test_medals_carries_its_provenance():
    _provenance(_load("medals.json"), "medals.json")


def test_sound_ids_carries_its_provenance():
    _provenance(_load("sound_ids.json"), "sound_ids.json")


def test_multikill_window_matches_the_medal_it_is_taken_from():
    """`MULTIKILL_WINDOW_S` is the app's own Double Kill window, not a number we chose."""
    from brx_mcp.modes.announcer import MULTIKILL_WINDOW_S

    medals = _load("medals.json")["medals"]
    double = [m for m in medals if m.get("name") == "Double Kill"]
    if not double:
        raise Skipped("no 'Double Kill' row in medals.json")
    window = double[0].get("window_s")
    assert window is not None, "the Double Kill row in medals.json has no window_s"
    assert float(window) == float(MULTIKILL_WINDOW_S), (
        f"announcer.MULTIKILL_WINDOW_S is {MULTIKILL_WINDOW_S} but medals.json says the app's "
        f"Double Kill window is {window}; change the constant, or say why we deliberately differ"
    )


def test_every_multikill_medal_shares_one_window():
    """Double / Triple / Killtacular all key off the same gap, which is why one constant is enough."""
    medals = _load("medals.json")["medals"]
    windows = {m["name"]: m["window_s"] for m in medals if m.get("window_s") is not None}
    if len(windows) < 2:
        raise Skipped("fewer than two windowed medals in medals.json")
    distinct = set(windows.values())
    assert len(distinct) == 1, (
        f"the windowed medals no longer share one gap ({windows}); announcer.py assumes a single "
        "MULTIKILL_WINDOW_S and needs a per-medal window if that stops being true"
    )


def test_sound_ids_is_the_app_bank_not_the_gun_bank():
    """2166 is the app's list. The gun holds 2477. Confusing the two has shipped wrong pages before."""
    doc = _load("sound_ids.json")
    n = len(doc.get("sounds", []))
    assert n == doc.get("count"), f"sound_ids.json count says {doc.get('count')} but carries {n} rows"
    assert n == 2166, (
        f"sound_ids.json holds {n} ids; the app's Sounds.json bank is 2166 (the gun's own bank is "
        "2477 and lives in sound_catalog.json). If the app list really changed, update this and the "
        "counts published in docs/manual/04-sound.md in the same commit"
    )
