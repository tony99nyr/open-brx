"""The node<->MC envelope rule (app/test/fixtures/envelope-cases.json, DRY review 2026-10-10 #1) against envelope.py decode().

app/test/envelope-cases.test.mjs decodes the same frames through app/src/transport/envelope.js. A malformed frame must
raise EnvelopeError: net.py counts that toward the malformed limit, while any other exception drops the node's socket."""
from __future__ import annotations

import json
import pathlib

from brx_mcp.mc import envelope as E

DOC = json.loads((pathlib.Path(__file__).resolve().parents[2] / "app" / "test" / "fixtures"
                  / "envelope-cases.json").read_text(encoding="utf-8"))


def _wire_text(c: dict) -> str:
    """The case's wire text: `text` as written or `frame` as compact JSON (as JSON.stringify writes it), then each fill."""
    text = c["text"] if "text" in c else json.dumps(c["frame"], separators=(",", ":"), ensure_ascii=False)
    for f in c.get("fill", ()):
        text = text.replace(f["token"], f["with"] * f["times"])
    return text


def _outcome(c: dict) -> str:
    """"ok", or the EnvelopeError reason; any other exception is a validator bug and fails the case."""
    try:
        E.decode(_wire_text(c), direction=c["direction"])
    except E.EnvelopeError as e:
        return e.reason
    return "ok"


def test_every_envelope_case_decodes_at_mc_as_the_file_says():
    assert len(DOC["cases"]) >= 60
    wrong = []
    for c in DOC["cases"]:
        want = c.get("differs", {}).get("py", c["expect"])
        try:
            got = _outcome(c)
        except Exception as e:   # noqa: BLE001 -- the point: a non-EnvelopeError is the bug
            got = f"raised {type(e).__name__}"
        if got != want:
            wrong.append((c["name"], got, want))
    assert wrong == [], wrong


def test_a_difference_is_named_with_its_reason():
    for c in DOC["cases"]:
        if "differs" in c:
            assert set(c["differs"]) <= {"py", "js"} and c.get("why"), c["name"]
