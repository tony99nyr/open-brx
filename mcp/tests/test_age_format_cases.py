"""The shared age wording (app/test/fixtures/age-format-cases.json) against state.py Session._human_age.

MC's readiness lines print the age upper-cased; the console's fmtAge reads the same file, so the two agree."""
from __future__ import annotations

import json
import pathlib

from brx_mcp.mc.state import Session

DOC = json.loads((pathlib.Path(__file__).resolve().parents[2] / "app" / "test" / "fixtures"
                  / "age-format-cases.json").read_text(encoding="utf-8"))


def test_every_age_case_prints_as_the_readiness_line_shows_it():
    assert len(DOC["cases"]) >= 10
    for c in DOC["cases"]:
        assert Session._human_age(c["ms"]).upper() == c["shown"], c


def test_the_cases_cover_every_unit_boundary():
    shown = {c["ms"]: c["shown"] for c in DOC["cases"]}
    for ms in (59_999, 60_000, 3_599_999, 3_600_000, 86_399_999, 86_400_000):
        assert ms in shown, ms
