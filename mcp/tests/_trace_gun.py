"""The golden-trace runners' gun (`TraceGun`), shared so the cross-check against CI's gun can import it without one test
module importing another (mcp/tests rule). app/test/golden-trace-runner.mjs `TraceGun` is the JS twin, rule for rule;
test_trace_gun_cases.py holds this one to app/test/fixtures/gun-replies.json (CI's FakeTagger)."""
from __future__ import annotations

import re

from brx_mcp.stage.stage import PROBE_LIFE


def _js_num(tok: str) -> int:
    """JavaScript's `+tok`: an empty token (a `$HP` that omits the shield) reads as 0, as in the engine runner."""
    return int(tok) if tok.strip() else 0


class TraceGun:
    """golden-trace-runner.mjs `TraceGun`, rule for rule (the README states the rules once)."""

    def __init__(self, opts: dict | None, maxima: list[int]):
        self.o = {"spawn": True, "probe": True, "life": False, "ammo": False, "alcd_echo": False, "spawn_ammo": [32, 192], **(opts or {})}
        self.maxima = maxima
        self.spawned = False; self.answer = True
        self.hp = self.armor = self.shield = 0
        self.slot = self.mag = self.reserve = 0
        self.replies: list[str] = []

    def pools(self) -> str:
        return f"{self.hp},{self.armor},{self.shield}"

    def wrote(self, frames: list[str]) -> None:
        for f in frames:
            t = f.split(",")
            if t[0] == "$SPAWN" and self.o["spawn"]:
                self.hp, self.armor = self.maxima[0], self.maxima[1]; self.shield = 0; self.spawned = True; self.slot = 0
                self.mag, self.reserve = self.o["spawn_ammo"]
                self.replies.append(f"$LCD,{self.pools()},{self.slot},{self.mag},{self.reserve},*")
            elif f == PROBE_LIFE:
                if self.o["probe"] and self.answer:
                    self.replies.append(f"$HP,{self.pools()},*")
            elif f == "$QUERY,*":
                if self.o["probe"] and self.answer:
                    self.replies.append(f"$LCD,{self.pools()},{self.slot},{self.mag},{self.reserve},*")
            elif t[0] == "$LIFE" and self.o["life"] and re.fullmatch(r"\$LIFE,-?\d+,-?\d+,-?\d+,\*", f):
                dh, da, ds = (int(x) for x in t[1:4])
                self.hp = max(0, min(self.maxima[0], self.hp + dh)); self.armor = max(0, min(self.maxima[1], self.armor + da))
                self.shield = max(0, self.shield + ds)
                self.replies.append(f"$LCD,0,0,0,{self.slot},{self.mag},{self.reserve},*" if self.hp == 0 else f"$HP,{self.pools()},*")
            elif t[0] == "$AMMO":
                if self.o["ammo"] and int(t[1]) == self.slot:
                    self.mag, self.reserve = int(t[2]), int(t[3])
                if self.o["alcd_echo"]:
                    self.replies.append(f"$ALCD,{t[2]},100,{t[1]},{t[3]},0,*")
            elif t[0] == "$WEAP" and self.o["alcd_echo"]:
                # F207 (bench 2026-09-16), as fake.py: the echoed reserve is t40 (index 41), else half of t17 (index 18)
                t40 = int(t[41]) if len(t) > 41 and t[41].isdigit() else (int(t[18]) // 2 if len(t) > 18 and t[18].isdigit() else 0)
                self.replies.append(f"$ALCD,{(t[17] if len(t) > 17 else '') or 0},100,{t[1]},{t40},0,*")

    def heard(self, f: str) -> None:
        t = f.split(",")
        if t[0] == "$HP" and len(t) >= 4:
            self.hp, self.armor, self.shield = _js_num(t[1]), _js_num(t[2]), _js_num(t[3])
        elif t[0] == "$LCD" and len(t) >= 7 and t[1] != "":
            self.hp, self.armor, self.shield = _js_num(t[1]), _js_num(t[2]), _js_num(t[3])

    def take(self) -> list[str]:
        r, self.replies = self.replies, []
        return r
