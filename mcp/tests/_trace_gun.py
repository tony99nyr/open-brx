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
        self.spawn_ammo: list[int] | None = None
        # a trace's own `spawn_ammo` stands in for its spawn burst's `$AMMO` rows, which a real gun takes AFTER the refill
        self.spawn_ammo_set: list[int] | None = (opts or {}).get("spawn_ammo") or None
        self.replies: list[str] = []
        self.alcd_replies: list[str] = []

    def pools(self) -> str:
        return f"{self.hp},{self.armor},{self.shield}"

    def wrote(self, frames: list[str]) -> None:
        for f in frames:
            t = f.split(",")
            if t[0] == "$PSET":
                for i in range(3):
                    if len(t) > i + 3 and re.fullmatch(r"-?\d+", t[i + 3]):
                        self.maxima[i] = int(t[i + 3])
            elif t[0] == "$SPAWN" and self.o["spawn"]:
                self.hp, self.armor = self.maxima[0], self.maxima[1]; self.shield = 0; self.spawned = True; self.slot = 0
                self.mag, self.reserve = self.spawn_ammo or [32, 192]
                self.replies.append(f"$LCD,{self.pools()},{self.slot},{self.mag},{self.reserve},*")
                if self.spawn_ammo_set:
                    self.mag, self.reserve = self.spawn_ammo_set
            elif f == PROBE_LIFE:
                if self.o["probe"] and self.answer:
                    # a dead gun answers $HP,0,0,0 whatever pools a lethal $LIFE left (fake.py checks death before the pools)
                    self.replies.append("$HP,0,0,0,*" if self.spawned and self.hp == 0 else f"$HP,{self.pools()},*")
            elif f == "$QUERY,*":
                if self.o["probe"] and self.answer:
                    self.replies.append(f"$LCD,{self.pools()},{self.slot},{self.mag},{self.reserve},*")
            elif t[0] == "$LIFE" and self.o["life"] and re.fullmatch(r"\$LIFE,-?\d+,-?\d+,-?\d+,(?:-?\d+,)?\*", f):
                dh, da, ds = (int(x) for x in t[1:4])
                if self.spawned and self.hp == 0 and dh == da == ds == 0:
                    self.replies.append("$HP,0,0,0,*")
                    continue
                mode = int(t[4]) if t[4] != "*" else None
                caps = [10 ** 6] * 3 if mode == 2 else self.maxima
                start = [0, 0, 0] if mode in (1, 2) else [self.hp, self.armor, self.shield]
                self.hp, self.armor, self.shield = (max(0, min(cap, cur + v)) for v, cap, cur in zip((dh, da, ds), caps, start))
                self.replies.append(f"$LCD,0,0,0,{self.slot},{self.mag},{self.reserve},*" if self.hp == 0 else f"$HP,{self.pools()},*")
            elif t[0] == "$AMMO":
                if self.o["ammo"] and int(t[1]) == self.slot:
                    self.mag, self.reserve = int(t[2]), int(t[3])
                if self.o["alcd_echo"]:
                    self.alcd_replies.append(f"$ALCD,{t[2]},100,{t[1]},{t[3]},0,*")
            elif t[0] == "$WEAP":
                # F207 (bench 2026-09-16), as fake.py: the echoed reserve is t40 (index 41), else half of t17 (index 18)
                t40 = int(t[41]) if len(t) > 41 and t[41].isdigit() else (int(t[18]) // 2 if len(t) > 18 and t[18].isdigit() else 0)
                if len(t) > 1 and t[1] == "0":
                    clip = int(t[17]) if len(t) > 17 and t[17].isdigit() else None
                    carried = int(t[18]) if len(t) > 18 and t[18].isdigit() else None
                    if clip is not None:
                        self.mag = clip
                    if carried is not None or (len(t) > 41 and t[41].isdigit()):
                        self.reserve = t40
                        if clip is not None:
                            self.spawn_ammo = [clip, carried if carried is not None else t40]
                if self.o["alcd_echo"]:
                    if len(t) > 1 and t[1] == "0":
                        self.alcd_replies.append(f"$ALCD,{self.mag},100,0,{self.reserve},0,*")
                    else:
                        self.alcd_replies.append(f"$ALCD,{(t[17] if len(t) > 17 else '') or 0},100,{t[1]},{t40},0,*")

    def heard(self, f: str) -> None:
        t = f.split(",")
        if t[0] == "$HP" and len(t) >= 4:
            self.hp, self.armor, self.shield = _js_num(t[1]), _js_num(t[2]), _js_num(t[3])
        elif t[0] == "$LCD" and len(t) >= 7 and t[1] != "":
            self.hp, self.armor, self.shield = _js_num(t[1]), _js_num(t[2]), _js_num(t[3])

    def take(self) -> list[str]:
        r = self.replies + self.alcd_replies
        self.replies, self.alcd_replies = [], []
        return r
