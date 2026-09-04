"""M-LOADOUT perk catalog (docs/spec/loadout.md §1.2).

A perk is the third slot of a player's kit (A14: it rides beside the weapons). v1 perks are passive
head-frame tweaks; `slot_frame` rows are catalogued but hidden until benched. Static data lives in
`perks.json` next to `weapons.json` — same discipline: the compiler only acts on effect keys it names.
"""
from __future__ import annotations

import json
import pathlib

_HERE = pathlib.Path(__file__).resolve().parent

# Effect keys the compiler understands. Anything else in `effects` is a data error, not a silent no-op.
EFFECT_KEYS = frozenset({"max_armor_add", "ammo_mult", "reload_mult", "alt_reload", "switch_mult"})   # switch_mult: scales $WEAP tok15, the gun's swap delay (bench 2026-09-04)


def _load_perks() -> list[dict]:
    return json.loads((_HERE / "perks.json").read_text())["perks"]


class PerkCatalog:
    def __init__(self, rows: list[dict] | None = None) -> None:
        self._rows = rows if rows is not None else _load_perks()
        self._by_id = {r["perk_id"]: r for r in self._rows}
        for r in self._rows:
            bad = set(r.get("effects") or {}) - EFFECT_KEYS
            if bad:
                raise ValueError(f"perks.json {r['perk_id']}: unknown effect keys {sorted(bad)}")

    def all(self) -> list[dict]:
        """Visible rows (hidden excluded), API/phone `PerkView` shape."""
        return [self.view(r) for r in self._rows if not r.get("hidden")]

    @staticmethod
    def view(r: dict) -> dict:
        return {"perk_id": r["perk_id"], "name": r["name"], "desc": r.get("desc", ""),
                "tags": list(r.get("tags") or []), "mechanism": r.get("mechanism", "passive"),
                "effects": dict(r.get("effects") or {}), "verified": bool(r.get("verified")),
                "hidden": bool(r.get("hidden"))}

    def visible_ids(self) -> list[str]:
        return [r["perk_id"] for r in self._rows if not r.get("hidden")]

    def row(self, perk_id: str) -> dict:
        if perk_id not in self._by_id:
            raise KeyError(f"unknown perk_id {perk_id!r}")
        return self._by_id[perk_id]

    def has(self, perk_id: str) -> bool:
        return perk_id in self._by_id

    def effects(self, perk_id: str | None) -> dict:
        """Effect knobs for a perk id (empty dict for None / unknown)."""
        if not perk_id or perk_id not in self._by_id:
            return {}
        return dict(self._by_id[perk_id].get("effects") or {})


_DEFAULT = PerkCatalog()


def default_perks() -> PerkCatalog:
    return _DEFAULT
