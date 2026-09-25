#!/usr/bin/env python3
"""The Stick's screen simulator: build it, run every scenario, check the screens, write a gallery.

    python3 hardware/m5sticks3/sim/stick_sim.py            # build, run, check, write sim/out/index.html
    python3 hardware/m5sticks3/sim/stick_sim.py --copy-to /mnt/c/Users/Tony/brx-stick-sim

Render path: the REAL station_render.h, compiled on the host against the real LovyanGFX sprite code
from the installed M5GFX library (sim/shim/M5Unified.h), so every PNG is pixel-exact with the Stick.
M5GFX is looked for in $M5GFX_SRC, then the Arduino libraries folders below. Without it the simulator
still runs every scenario through the real state machines and compute_screen(), and the gate checks
the screen kinds, but it draws nothing and cannot check text boxes.

The gate (mcp/tests/test_sticks3_screens.py) calls run() and check(). EXPECT below is the table of
what each scenario must show in the default build; EXPECT_REVIVE_ON the same with the post-MVP revive
feedback switched on (presence.h), which is built and checked too so those screens cannot rot. A
last-resort cut of any text fails the gate. KNOWN lists accepted design exceptions, each with its
reason (none today); an entry that stops failing fails the gate, so the table follows the screen.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import glob
import hashlib
import html
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys

SIM = pathlib.Path(__file__).resolve().parent
CORE = SIM.parent
BUILD = SIM / ".build"
OUT = SIM / "out"

# station_render.h's layout constants, read from the header itself (one source of truth).
_RENDER_H = (CORE / "station_render.h").read_text(encoding="utf-8")


def _const(name: str) -> int:
    m = re.search(rf"\b{name}\s*=\s*(\d+)", _RENDER_H)
    if not m:
        raise RuntimeError(f"station_render.h no longer defines {name}")
    return int(m.group(1))


SCREEN_W, SCREEN_H = _const("SCREEN_W"), _const("SCREEN_H")
STRIP_H, HINT_H = _const("STRIP_H"), _const("HINT_H")
MAIN_TOP, MAIN_BOTTOM = STRIP_H, SCREEN_H - HINT_H
SIDE_MARGIN = 8  # fitCenterText's widest box is SCREEN_W - 16: main-block ink stays 8 px off each side

GROUPS = [("bench", "Bench mode (no Wi-Fi set)"), ("link", "Joining and linked"), ("hill", "Hill"),
          ("pickup", "Pickup"), ("respawn", "Respawn"), ("operator", "Operator: reset, lock, restart, battery"),
          ("range", "Range editor (F365): radius and strength, on the station")]

# scenario -> expected kind, strings that must be drawn (`has`), strings that must not (`lacks`), and
# `same_as`: another scenario it may be pixel-identical to. Any other two scenarios must differ.
EXPECT: dict[str, dict] = {
    "bench_hill": {"kind": "SCR_NO_WIFI", "has": ["NO WI-FI", "HILL"], "lacks": ["SHOOT TO CAPTURE"]},
    "bench_bridge": {"kind": "SCR_NO_WIFI", "has": ["NO WI-FI", "BRIDGE"], "lacks": ["SHOOT TO CAPTURE"]},
    "bench_hill_shot": {"kind": "SCR_NO_WIFI", "has": ["HILL"]},
    "bench_bridge_beacon": {"kind": "SCR_NO_WIFI", "has": ["BRIDGE"], "same_as": "bench_bridge"},
    "bench_diagnostics": {"kind": "SCR_DIAGNOSTICS", "has": ["DIAGNOSTICS", "PASS", "P5 T1 M12 OK"]},
    "wifi_joining": {"kind": "SCR_JOINING", "has": ["JOINING WI-FI"],
                     "lacks": ["WI-FI CONNECTED", "LOOKING", "HOLD B"]},
    "looking_for_mc": {"kind": "SCR_JOINING", "has": ["LOOKING FOR MC", "WI-FI CONNECTED"], "lacks": ["HOLD B"]},
    "hello_sent": {"kind": "SCR_JOINING", "has": ["LOOKING FOR MC"]},
    "welcomed_unassigned": {"kind": "SCR_LINKED_WAITING", "has": ["LINKED", "ASSIGN ME IN MC"],
                            "lacks": ["LOOKING", "HOLD B"]},
    "welcomed_stats": {"kind": "SCR_STATS", "has": ["STATS", "LINKED, NOT ARMED"], "lacks": ["HOLD B"]},
    "released": {"kind": "SCR_LINKED_WAITING", "has": ["LINKED"], "same_as": "welcomed_unassigned"},
    "assigned_extraction": {"kind": "SCR_ASSIGNED", "has": ["EXTRACTION #5", "#5"]},
    "respawn_any": {"kind": "RESPAWN_OWNED", "has": ["ANY TEAM", "RESPAWN"], "lacks": ["REVIVES"], "once": ["RESPAWN"]},
    "respawn_yellow": {"kind": "RESPAWN_OWNED", "has": ["YELLOW", "RESPAWN"], "lacks": ["REVIVES"], "once": ["RESPAWN"]},
    "respawn_red": {"kind": "RESPAWN_OWNED", "has": ["RED", "RESPAWN"], "lacks": ["REVIVES"]},
    "respawn_red_player_revived": {"kind": "RESPAWN_OWNED", "lacks": ["REDEPLOY", "REVIVES"], "same_as": "respawn_red"},
    "respawn_advert_down": {"kind": "RESPAWN_IDLE", "has": ["ADVERT DOWN"]},
    "pickup_ready": {"kind": "PICKUP_READY", "has": ["ROCKETS", "STAND HERE TO TAKE"]},
    "pickup_ready_shield": {"kind": "PICKUP_READY", "has": ["OVERSHIELD"]},
    "pickup_ready_long_name": {"kind": "PICKUP_READY", "has": ["PLASMA RIFLE"]},
    "pickup_taken": {"kind": "PICKUP_TAKEN", "has": ["TAKEN BY P7", "NEXT SPAWN 1:30"]},
    "pickup_countdown": {"kind": "PICKUP_TAKEN", "has": ["NEXT SPAWN 0:30"]},
    "pickup_respawned": {"kind": "PICKUP_READY", "has": ["ROCKETS"], "same_as": "pickup_ready"},
    "pickup_stats": {"kind": "SCR_STATS", "has": ["PICKUP - ROCKETS", "P7"]},
    "pickup_stats_long_name": {"kind": "SCR_STATS", "has": ["PICKUP - PLASMA RIFLE"]},
    "hill_neutral": {"kind": "HILL_NEUTRAL", "has": ["NEUTRAL", "STAND HERE TO CAPTURE"],
                     "lines": ["STAND HERE", "TO CAPTURE"],  # the 9 pt two-line block (maxH 34) is live
                     "lacks": ["SHOOT TO CAPTURE"]},
    "hill_capturing_blue": {"kind": "HILL_CAPTURING", "has": ["BLUE CAPTURING"]},
    "hill_stalled_blue": {"kind": "HILL_CAPTURING", "has": ["BLUE STALLED"]},
    "hill_held_red": {"kind": "HILL_HELD", "has": ["RED HOLDS", "HELD 0:1"]},  # captured ~10 s in, shown at 26 s
    "hill_held_blue": {"kind": "HILL_HELD", "has": ["BLUE HOLDS"]},
    "hill_held_green": {"kind": "HILL_HELD", "has": ["GREEN HOLDS"]},
    "hill_yellow_refused": {"kind": "HILL_NEUTRAL", "has": ["NEUTRAL"], "same_as": "hill_neutral"},
    "hill_contested": {"kind": "HILL_CONTESTED", "has": ["CONTESTED", "TEAMS ON THE POINT"],
                       "lacks": ["BOTH TEAMS FIRING"]},
    "hill_losing_blue": {"kind": "HILL_CAPTURING", "has": ["BLUE LOSING"]},
    "hill_locked": {"kind": "HILL_HELD", "has": ["RED HOLDS", "LOCKED"]},
    "hill_restored": {"kind": "HILL_HELD", "has": ["RED HOLDS", "HELD 0:00"]},
    "reset_confirm": {"kind": "SCR_RESET_CONFIRM", "has": ["HOLD B AGAIN", "TO RESET STATION #4"]},
    "reset_confirm_unassigned": {"kind": "SCR_LINKED_WAITING", "lacks": ["#-1", "HOLD B AGAIN", "RESET"],
                                 "same_as": "welcomed_unassigned"},
    "reset_sent": {"kind": "SCR_RESET_SENT", "has": ["RESET SENT", "WAITING FOR MC"]},
    "reset_needs_mc": {"kind": "SCR_RESET_NEEDS_MC", "has": ["RESET NEEDS MC", "MC OFFLINE - TRY AGAIN LATER"],
                       "lines": ["RESET", "NEEDS MC", "MC OFFLINE", "TRY AGAIN LATER"]},
    "reset_refused_locked": {"kind": "SCR_RESET_LOCKED", "has": ["LOCKED", "MATCH IN PROGRESS", "UNLOCKS IN 9:59"]},
    "force_restart": {"kind": "SCR_FORCE_RESTART", "has": ["RESTART IN 4", "KEEP HOLDING A + B"]},
    "low_battery": {"kind": "SCR_LOW_BATTERY", "has": ["LOW BATTERY", "9%"]},
    "battery_ok_strip": {"kind": "PICKUP_READY", "has": ["76%", "#4"]},
    "hill_stats": {"kind": "SCR_STATS", "has": ["CONTROL #3"]},
    "stats_idle_home": {"kind": "HILL_NEUTRAL", "same_as": "hill_neutral"},
    "stats_range_cue": {"kind": "SCR_STATS", "has": ["HOLD FOR RANGE", "CONTROL #3"]},
    "range_radius_default": {"kind": "SCR_RANGE", "has": ["RADIUS", "STRENGTH", "-57", "~3 M", "HIGH", "+9 dBm",
                                                          "A CLOSER  B FARTHER", "HOLD B: DONE"], "lacks": ["EDITED"]},
    "range_radius_closer": {"kind": "SCR_RANGE", "has": ["-54", "~2 M", "EDITED"]},
    "range_radius_farther": {"kind": "SCR_RANGE", "has": ["-66", "~8 M", "EDITED"]},
    "range_strength": {"kind": "SCR_RANGE", "has": ["MEDIUM", "0 dBm", "A WEAKER  B STRONGER"]},
    "range_strength_ultra_low": {"kind": "SCR_RANGE", "has": ["ULTRA LOW", "-18 dBm"]},
    "range_locked": {"kind": "SCR_RANGE", "has": ["-60", "EDITED"]},
    "range_mc_value": {"kind": "SCR_RANGE", "has": ["-66", "LOW", "-9 dBm"], "lacks": ["EDITED"]},
    "range_refused_during_confirm": {"kind": "HILL_NEUTRAL", "lacks": ["RADIUS", "HOLD B AGAIN"], "same_as": "hill_neutral"},
    "range_released": {"kind": "SCR_STATS", "has": ["STATS"], "lacks": ["RADIUS"]},
    "range_idle_exit": {"kind": "SCR_STATS", "has": ["STATS"], "lacks": ["HOLD FOR RANGE"], "same_as": "hill_stats"},
}

# The same table with revive feedback ON (-DBRX_REVIVE_FEEDBACK=1, post-MVP): only the respawn rows differ.
EXPECT_REVIVE_ON: dict[str, dict] = {
    **EXPECT,
    "respawn_any": {"kind": "RESPAWN_OWNED", "has": ["ANY TEAM", "REVIVES 0"]},
    "respawn_yellow": {"kind": "RESPAWN_OWNED", "has": ["YELLOW RESPAWN", "REVIVES 0"]},
    "respawn_red": {"kind": "RESPAWN_OWNED", "has": ["RED RESPAWN", "REVIVES 0"]},
    "respawn_red_player_revived": {"kind": "RESPAWN_REDEPLOY", "has": ["REDEPLOY", "REVIVES 1"]},
}

# Screens the gate flags that are accepted as they are (a design exception, each with its reason).
# The 14 found on 2026-09-24 are fixed, so this is empty; a new entry needs a reason Tony agreed to.
KNOWN: dict[str, str] = {}


# ---- locating M5GFX and building -----------------------------------------------------------------
def find_m5gfx() -> pathlib.Path | None:
    if "M5GFX_SRC" in os.environ:  # set: that path only (set it to "" to run the model without rendering)
        cands = [os.environ["M5GFX_SRC"]]
    else:
        cands = glob.glob("/mnt/c/Users/*/Documents/Arduino/libraries/M5GFX/src")
        cands += [str(pathlib.Path.home() / p) for p in ("Documents/Arduino/libraries/M5GFX/src", "Arduino/libraries/M5GFX/src")]
    for c in cands:
        if c and (pathlib.Path(c) / "lgfx/v1/LGFX_Sprite.hpp").exists():
            return pathlib.Path(c)
    return None


def _run(argv, what: str, timeout: int = 600):
    r = subprocess.run(argv, capture_output=True, text=True, timeout=timeout)
    if r.returncode:
        raise RuntimeError(f"{what} failed:\n{r.stdout[-3000:]}\n{r.stderr[-3000:]}")
    return r


def _lgfx_lib(src: pathlib.Path) -> pathlib.Path:
    """LovyanGFX's sprite, font and image code as one static library, built once per M5GFX version.

    The CJK/Japanese u8g2 font tables (118 MB of C) are stubbed: the Stick draws none of them."""
    ver = "unknown"
    props = src.parent / "library.properties"
    if props.exists():
        m = re.search(r"^version=(\S+)", props.read_text(encoding="utf-8", errors="replace"), re.M)
        ver = m.group(1) if m else ver
    key = hashlib.sha1(f"{src}|{ver}".encode()).hexdigest()[:10]
    out = BUILD / f"lgfx-{ver}-{key}"
    lib = out / "liblgfx.a"
    if lib.exists():
        return lib
    out.mkdir(parents=True, exist_ok=True)
    v1 = src / "lgfx/v1"
    cpp = [v1 / "LGFXBase.cpp", v1 / "LGFX_Sprite.cpp", v1 / "lgfx_fonts.cpp", v1 / "panel/Panel_Device.cpp",
           v1 / "platforms/framebuffer/common.cpp", *sorted((v1 / "misc").glob("*.cpp"))]
    c = sorted((src / "lgfx/utility").glob("*.c"))
    fonts = (v1 / "lgfx_fonts.cpp").read_text(encoding="utf-8", errors="replace")
    stub_names = sorted(set(re.findall(r"\{\s*(lgfx_(?:efont|font_japan)_\w+)\s*\}", fonts)))
    stub = out / "cjk_font_stubs.c"
    stub.write_text("#include <stdint.h>\n" + "".join(f"const uint8_t {n}[1] = {{0}};\n" for n in stub_names))
    jobs = [(["g++", "-std=c++17", "-O1", "-w", "-DLGFX_LINUX_FB", f"-I{src}", "-c", str(f), "-o", str(out / (f.stem + ".o"))], f.name) for f in cpp]
    jobs += [(["gcc", "-O1", "-w", "-c", str(f), "-o", str(out / (f.stem + ".o"))], f.name) for f in [*c, stub]]
    with concurrent.futures.ThreadPoolExecutor(max_workers=min(8, os.cpu_count() or 2)) as pool:
        for fut in [pool.submit(_run, argv, f"compiling {name}") for argv, name in jobs]:
            fut.result()
    tmp = out / f"liblgfx.{os.getpid()}.tmp"
    _run(["ar", "rcs", str(tmp), *[str(p) for p in sorted(out.glob("*.o"))]], "ar")
    os.replace(tmp, lib)  # atomic: a parallel run never links a half-written archive
    return lib


def build(render: bool | None = None, revive_on: bool = False) -> tuple[pathlib.Path, bool]:
    """Build the simulator. Returns (binary, rendering?). Rebuilds only when a source changed.

    revive_on builds it with the post-MVP revive feedback switched on (presence.h)."""
    src = find_m5gfx() if render is not False else None
    if render and src is None:
        raise RuntimeError("M5GFX not found: set M5GFX_SRC to the library's src folder")
    rendering = src is not None
    inputs = sorted(CORE.glob("*.h")) + [SIM / "stick_sim.cpp", SIM / "shim/M5Unified.h", SIM / "stick_sim.py"]
    h = hashlib.sha1(str(src).encode())
    for p in inputs:
        h.update(p.name.encode())
        h.update(p.read_bytes())
    variant = ("render" if rendering else "model") + ("-reviveon" if revive_on else "")
    exe = BUILD / f"stick_sim-{variant}-{h.hexdigest()[:12]}"
    if exe.exists():
        return exe, rendering
    BUILD.mkdir(parents=True, exist_ok=True)
    tmp = exe.with_name(f"{exe.name}.{os.getpid()}.tmp")
    argv = ["g++", "-std=c++17", "-O1", "-Wall", "-Wextra", "-Werror", f"-I{CORE}", str(SIM / "stick_sim.cpp"), "-o", str(tmp)]
    if revive_on:
        argv.insert(1, "-DBRX_REVIVE_FEEDBACK=1")
    if rendering:
        lib = _lgfx_lib(src)
        argv[4:4] = [f"-I{SIM / 'shim'}", "-isystem", str(src), "-DLGFX_LINUX_FB", "-DBRX_SIM_RENDER"]
        argv += [str(lib), "-lpthread"]
    _run(argv, "building the simulator")
    for stale in BUILD.glob(f"stick_sim-{variant}-*"):
        if stale.suffix != ".tmp" and stale != exe and ("-reviveon-" in stale.name) == revive_on:
            stale.unlink(missing_ok=True)
    os.replace(tmp, exe)
    return exe, rendering


def run(out_dir: pathlib.Path | None = None, render: bool | None = None,
        revive_on: bool = False) -> tuple[list[dict], bool]:
    """Run every scenario. With out_dir (and rendering) the PNGs land there. Returns (results, rendered?)."""
    exe, rendering = build(render, revive_on)
    argv = [str(exe)]
    if out_dir is not None and rendering:
        out_dir.mkdir(parents=True, exist_ok=True)
        for old in out_dir.glob("*.png"):
            old.unlink()
        argv.append(str(out_dir))
    r = subprocess.run(argv, capture_output=True, text=True, timeout=120)
    if r.returncode:
        raise RuntimeError(f"the simulator crashed (exit {r.returncode}):\n{r.stdout[-2000:]}\n{r.stderr[-2000:]}")
    return [json.loads(line) for line in r.stdout.splitlines() if line.strip()], rendering


# ---- the gate ---------------------------------------------------------------------------------------
MIN_GAP = 2  # px of background between two strings' ink; less and they read as one smudge


def _overlap(a, b) -> bool:
    g = MIN_GAP
    return not (a[2] + g < b[0] or b[2] + g < a[0] or a[3] + g < b[1] or b[3] + g < a[1])


def text_problems(res: dict) -> list[str]:
    """Ink that leaves the screen, its band (strip / main block / hint bar), or lands on other ink."""
    out = []
    inked = [t for t in res.get("texts", []) if t["inked"]]
    for t in inked:
        x0, y0, x1, y1 = t["box"]
        label = f"'{t['text']}' ({t['font']}, ink x {x0}..{x1} y {y0}..{y1})"
        if x0 < 0 or y0 < 0 or x1 >= SCREEN_W or y1 >= SCREEN_H:
            out.append(f"{label} runs off the {SCREEN_W}x{SCREEN_H} screen")
            continue
        if t["ay"] < STRIP_H:
            if y1 > STRIP_H - 2:
                out.append(f"{label} spills out of the status strip")
        elif t["ay"] > MAIN_BOTTOM:
            if y0 <= MAIN_BOTTOM:
                out.append(f"{label} spills out of the hint bar")
        else:
            if y0 < MAIN_TOP or y1 >= MAIN_BOTTOM:
                out.append(f"{label} spills out of the main block (y {MAIN_TOP}..{MAIN_BOTTOM - 1})")
            if x0 < SIDE_MARGIN or x1 > SCREEN_W - 1 - SIDE_MARGIN:
                out.append(f"{label} overflows its box (x {SIDE_MARGIN}..{SCREEN_W - 1 - SIDE_MARGIN})")
    for i in range(len(inked)):
        for j in range(i + 1, len(inked)):
            if _overlap(inked[i]["box"], inked[j]["box"]):
                out.append(f"'{inked[i]['text']}' and '{inked[j]['text']}' overlap or touch (< {MIN_GAP} px apart)")
    return out


def check(results: list[dict], rendered: bool, expect: dict[str, dict] | None = None) -> dict[str, list[str]]:
    """Problems per scenario ({} = clean). Without rendering only the kinds and the table are checked."""
    EXPECT = expect if expect is not None else globals()["EXPECT"]  # noqa: N806 (the table in use)
    probs: dict[str, list[str]] = {}
    names = [r["name"] for r in results]
    for n in sorted(set(names) - set(EXPECT)):
        probs.setdefault(n, []).append("scenario has no row in EXPECT")
    for n in sorted(set(EXPECT) - set(names)):
        probs.setdefault(n, []).append("EXPECT row has no scenario")
    by_pixels: dict[str, list[str]] = {}
    for r in results:
        exp = EXPECT.get(r["name"])
        if exp is None:
            continue
        p = probs.setdefault(r["name"], [])
        if r["spec"]["kind"] != exp["kind"]:
            p.append(f"shows {r['spec']['kind']}, expected {exp['kind']}")
        if rendered:
            # Every string drawn, plus each fitter's whole text (a two-line block reads as one line here).
            strings = [t["text"] for t in r["texts"]] + r.get("logical", [])
            drawn = " | ".join(strings)
            for s in exp.get("has", []):
                if s not in drawn:
                    p.append(f"does not draw '{s}' (drew: {drawn})")
            for s in exp.get("lacks", []):
                if s in drawn:
                    p.append(f"draws '{s}', which is wrong in this state")
            for s in exp.get("lines", []):  # exact strings: proves a block really wrapped, not cut
                if s not in [t["text"] for t in r["texts"]]:
                    p.append(f"does not draw the line '{s}' on its own")
            for s in exp.get("once", []):
                n = sum(1 for t in r["texts"] if s in t["text"])
                if n != 1:
                    p.append(f"draws '{s}' {n} times (expected once)")
            for cut in r.get("cuts", []):
                p.append(f"'{cut}' did not fit even at 9 pt and was cut: give it a short form or room to wrap")
            p.extend(text_problems(r))
            by_pixels.setdefault(r["pixels"], []).append(r["name"])
    def root(n: str) -> str:  # follow same_as to the scenario a look-alike group is declared against
        seen = set()
        while EXPECT[n].get("same_as") and n not in seen:
            seen.add(n)
            n = EXPECT[n]["same_as"]
        return n
    for group in by_pixels.values():
        for a in group:
            for b in group:
                if a < b and root(a) != root(b):
                    probs.setdefault(a, []).append(f"is pixel-identical to {b}: two states, one picture")
    return {k: v for k, v in probs.items() if v}


# ---- the gallery ------------------------------------------------------------------------------------
def gallery(results: list[dict], probs: dict[str, list[str]], out_dir: pathlib.Path, scale: int = 3,
            revive_on: tuple[list[dict], dict[str, list[str]]] | None = None) -> pathlib.Path:
    by_group: dict[str, list[dict]] = {}
    for r in results:
        by_group.setdefault(r["group"], []).append(r)
    flagged = sum(1 for r in results if probs.get(r["name"]))
    parts = [f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Stick screens</title>
<style>
:root {{ --bg:#0b0f14; --card:#131a22; --ink:#e6eef5; --mut:#8aa0b4; --bad:#ff6b6b; --ok:#46d884; --edge:#243242; }}
body {{ margin:0; padding:16px; background:var(--bg); color:var(--ink); font:14px/1.4 system-ui, sans-serif; }}
h1 {{ font-size:20px; margin:0 0 4px; }} h2 {{ font-size:16px; margin:28px 0 10px; color:var(--mut); }}
.grid {{ display:flex; flex-wrap:wrap; gap:16px; }}
.card {{ background:var(--card); border:1px solid var(--edge); border-radius:8px; padding:10px; width:{SCREEN_W * scale}px; max-width:100%; }}
.card.flag {{ border-color:var(--bad); }}
.card img {{ width:100%; image-rendering:pixelated; display:block; border-radius:3px; }}
.name {{ font-weight:600; margin-top:8px; }} .kind {{ font-family:ui-monospace, monospace; color:var(--mut); font-size:12px; }}
.story {{ color:var(--mut); margin-top:4px; }} .probs {{ color:var(--bad); margin:6px 0 0; padding-left:18px; }}
.known {{ color:#ffb020; }} .sum {{ color:var(--mut); }}
</style></head><body><h1>M5StickS3 station screens</h1>
<p class="sum">{len(results)} scenarios, drawn by the real station_render.h at {scale}x. {flagged} flagged by the gate.
Review this page before flashing any screen change.</p>"""]
    sections = [(title, by_group.get(key, []), probs) for key, title in GROUPS]
    if revive_on:
        on_results, on_probs = revive_on
        sections.append(("Respawn with revive feedback ON (post-MVP build, -DBRX_REVIVE_FEEDBACK=1)",
                         [r for r in on_results if r["group"] == "respawn"], on_probs))
        flagged += sum(1 for r in on_results if on_probs.get(r["name"]))
        parts[0] = parts[0].replace(" flagged by the gate.", " flagged by the gate (both builds).")
    for title, rows, probs in sections:
        if not rows:
            continue
        parts.append(f"<h2>{html.escape(title)}</h2><div class='grid'>")
        for r in rows:
            p = probs.get(r["name"], [])
            known = KNOWN.get(r["name"])
            img = f"<img src='{html.escape(r['png'])}' alt='{html.escape(r['name'])}'>" if r.get("png") else ""
            plist = "".join(f"<li>{html.escape(x)}</li>" for x in p)
            parts.append(
                f"<div class='card{' flag' if p else ''}'>{img}<div class='name'>{html.escape(r['name'])}</div>"
                f"<div class='kind'>{html.escape(r['spec']['kind'])} &middot; link {html.escape(r['link_state'])}</div>"
                f"<div class='story'>{html.escape(r['story'])}</div>"
                + (f"<div class='known'>Known: {html.escape(known)}</div>" if known else "")
                + (f"<ul class='probs'>{plist}</ul>" if plist else "") + "</div>")
        parts.append("</div>")
    parts.append("</body></html>")
    out_dir.mkdir(parents=True, exist_ok=True)
    page = out_dir / "index.html"
    page.write_text("".join(parts), encoding="utf-8")
    return page


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--out", type=pathlib.Path, default=OUT, help="where index.html and the PNGs go")
    ap.add_argument("--copy-to", type=pathlib.Path, help="also copy the gallery here (e.g. a Windows folder)")
    args = ap.parse_args(argv)
    results, rendered = run(args.out)
    probs = check(results, rendered)
    on_dir = args.out / "revive-on"
    on_results, _ = run(on_dir, revive_on=True)
    for r in on_results:
        if r.get("png"):
            r["png"] = f"revive-on/{r['png']}"
    on_probs = check(on_results, rendered, EXPECT_REVIVE_ON)
    if not rendered:
        print("M5GFX not found: ran the model only (no PNGs, no text checks). Set M5GFX_SRC.")
    page = gallery(results, probs, args.out, revive_on=(on_results, on_probs))
    for label, pr in (("", probs), ("[revive on] ", on_probs)):
        for name, p in pr.items():
            tag = "KNOWN" if name in KNOWN else "FLAG"
            for line in p:
                print(f"{tag} {label}{name}: {line}")
    if args.copy_to:
        for sub in ("", "revive-on"):
            dst = args.copy_to / sub
            dst.mkdir(parents=True, exist_ok=True)
            for old in dst.glob("*.png"):
                old.unlink()
            for f in (args.out / sub).iterdir():
                if f.suffix in (".png", ".html"):
                    shutil.copyfile(f, dst / f.name)
        print(f"copied to {args.copy_to}")
    print(f"{len(results)} scenarios x 2 builds, {len(probs) + len(on_probs)} flagged. Gallery: {page}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
