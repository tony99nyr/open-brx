"""The shared advert vectors (app/test/fixtures/advert-vectors.json) against mcp/brx_mcp/beacon.py.

app/test/beacon-vectors.test.mjs (beacon.js) and hardware/m5sticks3/test/test_advert_vectors.cpp (brx_advert.h) read
the same file, so the three codecs agree byte for byte."""
from __future__ import annotations

import json
import pathlib

from brx_mcp.beacon import PLAYER_STATE, decode, encode
from brx_mcp.mc.types import ADVERT_PLAYER_STATE

DOC = json.loads((pathlib.Path(__file__).resolve().parents[2] / "app" / "test" / "fixtures"
                  / "advert-vectors.json").read_text(encoding="utf-8"))


def _fields(c: dict) -> dict:
    return {"role": c["role"], "id": c["id"], "kind": c["kind_name"], "team": c["team"], "state": c["state"],
            "value": c["value"], "seq": c["seq"], "game": c["game"], "threshold": c["threshold"], "taker": c["taker"]}


def test_every_vector_encodes_to_its_uuid_and_decodes_back():
    for c in DOC["cases"]:
        got = encode(c["role"], id=c["id"], kind=c["kind"], team=c["team"], state=c["state"], value=c["value"],
                     seq=c["seq"], game=c["game"], threshold=c["threshold"], taker=c["taker"])
        assert got == c["uuid"], f"encode: {c['name']}"
        a = decode(c["uuid"])
        assert a is not None and a.__dict__ == _fields(c), f"decode: {c['name']}"


def test_other_spellings_decode_to_the_same_advert():
    for v in (x for x in DOC["variants"] if "mcp" in x["runners"]):
        c = next(x for x in DOC["cases"] if x["name"] == v["decodes_as"])
        a = decode(v["uuid"])
        assert a is not None and a.__dict__ == _fields(c), v["name"]


def test_every_reject_vector_decodes_to_none():
    for r in DOC["reject"]:
        assert decode(r["uuid"]) is None, r["name"]


def test_each_player_state_bit_vector_carries_the_generated_bit():
    named = [c for c in DOC["cases"] if c.get("bit")]
    assert [c["bit"] for c in named] == list(ADVERT_PLAYER_STATE), "one vector per generated bit, in order"
    for c in named:
        assert c["state"] == ADVERT_PLAYER_STATE[c["bit"]], c["name"]
        assert PLAYER_STATE[c["bit"]] == c["state"], c["name"]
