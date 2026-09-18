"""Team id -> colour is written in three languages, with no guard until now (DRY drift, 2026-09-17).

`mcp/brx_mcp/mc/presentation.py`'s `PALETTE` (colour -> id: 0 red, 1 blue, 2 yellow, 3 green, plus five
unused colours) is the canonical mapping. `app/src/engine.js` (`TEAM_KEY`), `app/src/utility.js`
(`TEAM_KEYS`) and `webapp/mc/src/mock/data.ts` (`TEAMS`) each repeat the same four ids by hand. They
agree today, but nothing stops one of them drifting the way FFA's frag limit did (see
`test_ui_catalog_generated.py`). F82 (2026-09-10) is a live example of why this matters: KOTH's teams
are BLUE/GREEN specifically because tid 2 is what a NEUTRAL hill broadcasts, so a wrong colour-to-id
mapping anywhere silently breaks that rule.

This reads all four sources as plain text (no browser, no TS/JS runtime) and pins them against
`PALETTE`.

Run: python3 run_tests.py team_color
"""
from __future__ import annotations

import ast
import pathlib
import re

REPO = pathlib.Path(__file__).resolve().parents[2]

# The four ids every other source repeats. PALETTE also carries purple/teal/white/pink/orange (4-8),
# which nothing outside `presentation.py` uses yet, so this only pins the ids that are actually shared.
TEAM_IDS = (0, 1, 2, 3)


def _server_palette() -> dict[int, str]:
    text = (REPO / "mcp" / "brx_mcp" / "mc" / "presentation.py").read_text(encoding="utf-8")
    anchor = "PALETTE = {"
    start = text.index(anchor) + len(anchor) - 1        # the anchor's own trailing "{"
    depth, end = 0, None
    for i in range(start, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    assert end is not None, "PALETTE dict in presentation.py has no closing brace — did its shape change?"
    by_color: dict[str, int] = ast.literal_eval(text[start:end])
    by_id = {v: k for k, v in by_color.items()}
    assert len(by_id) == len(by_color), f"PALETTE has two colours sharing one id: {by_color}"
    return by_id


def _js_team_key(path: pathlib.Path, const_name: str) -> dict[int, str]:
    """Reads a `const NAME = { 0: 'red', 1: 'blue', ... }` object literal as plain text. Extra
    non-numeric keys (`utility.js`'s `[TEAM_ANY]: 'any'`) are ignored — only the numbered ids matter
    here."""
    text = path.read_text(encoding="utf-8")
    m = re.search(rf"const {re.escape(const_name)}\s*=\s*\{{([^}}]*)\}}", text)
    assert m, f"{path.relative_to(REPO)} has no `const {const_name} = {{ ... }}`"
    body = m.group(1)
    out: dict[int, str] = {}
    for tid_s, color in re.findall(r"(\d+)\s*:\s*'(\w+)'", body):
        out[int(tid_s)] = color
    return out


def _mock_teams(path: pathlib.Path) -> dict[int, str]:
    """`webapp/mc/src/mock/data.ts`'s `TEAMS` array: one `{ ..., color: 'x', tid: N }` object per team."""
    text = path.read_text(encoding="utf-8")
    m = re.search(r"export const TEAMS: Team\[\] = \[(.*?)\n\];", text, re.S)
    assert m, f"{path.relative_to(REPO)} has no `export const TEAMS: Team[] = [ ... ]`"
    out: dict[int, str] = {}
    for color, tid_s in re.findall(r"color:\s*'(\w+)',\s*tid:\s*(\d+)", m.group(1)):
        out[int(tid_s)] = color
    return out


SOURCES = {
    "app/src/engine.js": lambda: _js_team_key(REPO / "app" / "src" / "engine.js", "TEAM_KEY"),
    "app/src/utility.js": lambda: _js_team_key(REPO / "app" / "src" / "utility.js", "TEAM_KEYS"),
    "webapp/mc/src/mock/data.ts": lambda: _mock_teams(REPO / "webapp" / "mc" / "src" / "mock" / "data.ts"),
}


def test_team_colours_match_the_server_palette():
    canonical = _server_palette()
    want = {tid: canonical[tid] for tid in TEAM_IDS}
    mismatches = []
    for name, load in SOURCES.items():
        got_full = load()
        got = {tid: got_full.get(tid) for tid in TEAM_IDS}
        if got != want:
            mismatches.append(f"{name}: has {got}, presentation.PALETTE has {want}")
    assert not mismatches, "a team id maps to a different colour than presentation.PALETTE:\n" + "\n".join(mismatches)
