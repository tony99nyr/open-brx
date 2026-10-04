"""Team id -> colour is written in three languages, with no guard until now (DRY drift, 2026-09-17).

`mcp/brx_mcp/mc/presentation.py`'s `PALETTE` (colour -> id: 0 red, 1 blue, 2 yellow, 3 green, plus five
unused colours) is the canonical WIRE/LED palette. `app/src/engine.js` (`TEAM_KEY`), `app/src/utility.js`
(`TEAM_KEYS`) and `webapp/mc/src/mock/data.ts` (`TEAMS`) each repeat team colour-keys by hand, and
nothing stops one of them drifting the way FFA's frag limit did (see `test_ui_catalog_generated.py`).
F82 (2026-09-10) is a live example of why this matters: KOTH's teams are BLUE/PURPLE specifically
because tid 2 is what a NEUTRAL hill broadcasts, so a wrong colour-to-id mapping anywhere silently
breaks that rule.

**F423 (bench part 1, 2026-09-26) split tid 3 off from the palette on purpose.** Team 3 still fights as
GREEN on the wire (`PALETTE[3]`, its combat identity, F35 -- green is reserved for the headset's own
death out-blink) but the gun and headset PAINT it purple, and MC's own roster (`state.py` TEAM_DEFS)
now names it team_id "purple" to match. The three colour-key sources below are read by the PLAYER and
OPERATOR facing UI -- they must track MC's roster team_id (so `team_id === teamKey` comparisons in
`hud.js`/`deathscreen.js` keep working), not the raw wire palette, so tid 3 is pinned to "purple" here
while 0/1/2 still track `PALETTE` exactly.

This reads all four sources as plain text (no browser, no TS/JS runtime) and pins them against the
expected team colour table (`PALETTE`, with tid 3 overridden to "purple").

Run: python3 run_tests.py team_color
"""
from __future__ import annotations

import ast
import pathlib
import re

from brx_mcp.mc.state import TEAM_DEFS

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


def _generated_team_keys() -> dict[int, str]:
    """Reads the generated team-key array used by the phone, console, and Stick."""
    text = (REPO / "app" / "src" / "transport" / "contract.gen.js").read_text(encoding="utf-8")
    m = re.search(r"export const TEAM_KEYS = Object\.freeze\(\[([^]]*)\]\);", text)
    assert m, "contract.gen.js has no generated TEAM_KEYS array"
    return {tid: key for tid, key in enumerate(re.findall(r"'([^']+)'", m.group(1)))}


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
    "app/src/transport/contract.gen.js TEAM_KEYS": _generated_team_keys,
    "webapp/mc/src/mock/data.ts": lambda: _mock_teams(REPO / "webapp" / "mc" / "src" / "mock" / "data.ts"),
}


def test_the_phone_maps_derive_from_the_generated_team_keys():
    """Review #4: engine.js and utility.js hold no literal tid -> colour map of their own. Each builds its map from the
    generated TEAM_KEYS (checked against the server palette above), so a literal map coming back fails here."""
    literal_map = re.compile(r"\{\s*0\s*:\s*'red'\s*,\s*1\s*:\s*'blue'")
    derived = {"app/src/engine.js": r"const TEAM_KEY = Object\.fromEntries\(TEAM_KEYS\.map\(",
               "app/src/utility.js": r"const TEAM_KEY_BY_TID = \{ \.\.\.Object\.fromEntries\(CONTRACT_TEAM_KEYS\.map\("}
    for rel, pattern in derived.items():
        text = (REPO / rel).read_text(encoding="utf-8")
        assert re.search(pattern, text), f"{rel} no longer builds its tid -> key map from the generated TEAM_KEYS"
        assert not literal_map.search(text), f"{rel} carries a literal tid -> colour map again"


def test_team_colours_match_the_server_palette():
    canonical = _server_palette()
    want = {tid: canonical[tid] for tid in TEAM_IDS}
    want[3] = "purple"   # F423: MC's roster (state.py TEAM_DEFS) renamed tid 3 to team_id "purple";
                          # PALETTE[3] stays "green" (the wire/combat identity, F35) and is checked on
                          # its own further down -- this table is what the PLAYER/OPERATOR UI must say.
    assert canonical[3] == "green", (
        "F35: tid 3's WIRE/combat identity is green (presentation.PALETTE) -- if this ever changes, "
        "the F423 override above (want[3] = 'purple') needs a second look, not a silent pass")
    mismatches = []
    for name, load in SOURCES.items():
        got_full = load()
        got = {tid: got_full.get(tid) for tid in TEAM_IDS}
        if got != want:
            mismatches.append(f"{name}: has {got}, want {want}")
    assert not mismatches, "a team id maps to a different colour than expected:\n" + "\n".join(mismatches)


def _relative_luminance(hex_color: str) -> float:
    hex_color = hex_color.lstrip("#")
    r, g, b = (int(hex_color[i:i + 2], 16) / 255 for i in (0, 2, 4))

    def lin(c: float) -> float:
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = lin(r), lin(g), lin(b)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _contrast_ratio(hex_a: str, hex_b: str) -> float:
    la, lb = _relative_luminance(hex_a), _relative_luminance(hex_b)
    lighter, darker = max(la, lb), min(la, lb)
    return (lighter + 0.05) / (darker + 0.05)


def test_team_purple_clears_the_contrast_floor():
    """F427 (2026-09-26): #7b2cbf read ~2.4-2.8:1 against MC's dark panel and the phone's chip ink,
    under the 4.5:1 floor every other team colour clears. Pins the *hex* MC serves (`state.py`
    TEAM_DEFS) against MC's panel background and the phone's purple-chip ink so a future edit cannot
    quietly slide the colour back into fail range."""
    purple = TEAM_DEFS["purple"]["color"]
    mc_panel = "#0c1016"        # webapp/mc/src/tokens.ts T.panel
    phone_chip_ink = "#140a1c"  # app/www/index.html [data-team="purple"] --team-ink
    for background, label in ((mc_panel, "MC panel"), (phone_chip_ink, "phone chip ink")):
        ratio = _contrast_ratio(purple, background)
        assert ratio >= 4.5, f"team purple {purple} against {label} {background} is {ratio:.2f}:1, under the 4.5:1 floor"
