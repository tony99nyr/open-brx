"""Storyboard of the gun stage's voice cards (section 8, the SOUNDBOARD): every frame is the real
`stage/page.html` in an iframe, fed a real `GunStage.state()` through a stubbed `fetch`, scrolled to the cards.

    cd mcp && ../.venv/bin/python tools/stage_storyboard.py <out dir>

Writes `<out dir>/index.html`. No gun, no server, no network: the stage runs on a FakeConnectionManager.
"""
from __future__ import annotations

import html
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))   # this checkout's brx_mcp, not the venv's copy
from brx_mcp.fake import FakeConnectionManager, FakeTagger
from brx_mcp.stage.stage import GunStage

PAGE = pathlib.Path(__file__).resolve().parents[1] / "brx_mcp" / "stage" / "page.html"


def _stage(**profile) -> GunStage:
    mgr = FakeConnectionManager([FakeTagger("FA:KE:00:00:00:01", "FAKE-STAGE", team=1)])
    st = GunStage(mgr, None, sleep=lambda _s: None, voice_verdict_sink=lambda _r: None)
    if profile:
        st.set_profile(**profile)
    return st


def _state(voice: str = "male", pick: dict | None = None, edit=None) -> dict:
    st = _stage(voice=voice)
    for role, sid in (pick or {}).items():
        st.set_voice_slot(role, sid)
    s = json.loads(json.dumps(st.state(), default=str))
    if edit:
        edit(s)
    return s


def _no_heal_cue(s: dict) -> None:
    s["voice"]["heal"] = []   # what the stage sends for a bundle with no `cues.healed`


def _stale(s: dict) -> None:
    s["voice"].pop("heal", None), s["voice"].pop("heal_line", None)   # a stage server that predates the card


# (id, group, caption, state)
FRAMES = [
    ("H1", "HEAL LINE", "Male player, the default game voice: the card lists VA7, the line the phone plays on a heal.",
     lambda: _state("male")),
    ("H2", "HEAL LINE", "Heavy as the game voice: the card follows the voice and lists V37.",
     lambda: _state("heavy")),
    ("H3", "HEAL LINE", "A pain_relief pick of VA6 (Male): the card says PICKED and lists the picked line.",
     lambda: _state("male", {"pain_relief": "VA6"})),
    ("H4", "HEAL LINE", "A bundle with no heal cue (state edited: voice.heal is empty): the card says OFF and names the voice's line.",
     lambda: _state("male", edit=_no_heal_cue)),
    ("H5", "BEFORE", "A stage server that predates the card (no voice.heal): the old PAIN RELIEF picker, with no options.",
     lambda: _state("male", edit=_stale)),
]

_STUB = """<script>(() => {
  const S = %s;
  const ok = b => Promise.resolve(new Response(JSON.stringify(b), {status: 200, headers: {'content-type': 'application/json'}}));
  window.fetch = (url) => ok(S);
  addEventListener('load', () => setTimeout(() => {
    const el = document.getElementById('slotshint'); if (el) el.scrollIntoView({block: 'start'}); scrollBy(0, -100);
  }, 300));
})();</script>"""


def frame_doc(state: dict) -> str:
    page = PAGE.read_text()
    stub = _STUB % json.dumps(state).replace("</", "<\\/")
    head, _, rest = page.partition("\n")   # keep `<!doctype html>` first, or the frame renders in quirks mode
    return head + "\n" + stub + rest


def build(out: pathlib.Path) -> pathlib.Path:
    out.mkdir(parents=True, exist_ok=True)
    cards = []
    for fid, group, cap, mk in FRAMES:
        doc = html.escape(frame_doc(mk()), quote=True)
        cards.append(f'<section class="f" data-frame="{fid}"><h2>{fid} <span>{group}</span></h2><p>{html.escape(cap)}</p>'
                     f'<iframe title="{fid}" srcdoc="{doc}"></iframe></section>')
    idx = out / "index.html"
    idx.write_text("<!DOCTYPE html><html><head><meta charset='utf-8'><title>Gun stage: HEAL LINE card</title><style>"
                   "body{background:#0b0d10;color:#dde;font:14px system-ui;margin:16px}"
                   ".f{margin:0 0 28px}.f h2{font:700 15px monospace;margin:0 0 4px}.f h2 span{color:#8a9;font-weight:400}"
                   ".f p{margin:0 0 8px;color:#aab}iframe{width:1280px;max-width:100%;height:620px;border:1px solid #334;background:#000}"
                   "</style></head><body><h1 style='font-size:18px'>Gun stage SOUNDBOARD: the HEAL LINE card (F685)</h1>"
                   + "".join(cards) + "</body></html>")
    return idx


if __name__ == "__main__":
    print(build(pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "stage-storyboard")))
