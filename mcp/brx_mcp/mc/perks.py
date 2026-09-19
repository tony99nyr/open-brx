"""M-LOADOUT perk catalog (docs/spec/loadout.md §1.2).

A perk is the third slot of a player's kit (A14: it rides beside the weapons). v1 perks are passive
head-frame tweaks; `slot_frame` rows are catalogued but hidden until benched. Static data lives in
`perks.json` next to `weapons.json` — same discipline: the compiler only acts on effect keys it names.
"""
from __future__ import annotations

import json
import pathlib

from .types import PerkEffects, PerkView

_HERE = pathlib.Path(__file__).resolve().parent

# Effect keys the compiler understands. Anything else in `effects` is a data error, not a silent no-op.
# `alt_reload` has no current row (S50, 2026-09-17: `easy_reload` moved out of the perk slot to
# `loadout.overrides.easy_reload`, the per-player accessibility block -- it is accessibility, not
# balance, so it no longer competes with a perk pick). The key stays in the vocabulary for a future
# perk that claims the ALT button the same way (`policy.py`'s docstring: "a new perk that claims a
# button in future joins the rule by setting alt_reload").
# `armor_piercing` (S50, new): the primary's $SIR key is swapped to the armour-piercing cell and its
# damage is cut -- see `compile.py` `_MAX_ARMOR_ADD`, `_AP_CELL`, `_AP_DAMAGE_MULT`.
# `crit_pct_add` (F278, 2026-09-18): no row declares it yet -- the guard is filed and fixed before the
# perk exists. `compile.py`'s `_refuse_if_crit_perk_ineligible` refuses it at RUNTIME on a weapon
# declaring `wire.headset_dmg`, the same combination the catalogue-time guard
# `test_a_two_word_weapon_never_also_carries_a_crit_chance` already refuses on the row itself.
EFFECT_KEYS = frozenset({"max_armor_add", "ammo_mult", "reload_mult", "alt_reload", "switch_mult",
                        "armor_piercing", "crit_pct_add"})   # switch_mult: scales $WEAP tok15, the gun's swap delay (bench 2026-09-04)

# S50 gain/cost lines (2026-09-19, F-desc): the phone (`app/src/hud/hud.js` `perkEffect`) and the console
# (`webapp/mc/src/screens/Kit.tsx` `effectLine`) each used to derive their own "gain · cost" line from
# `effects`, and disagreed -- the console's own copy did not even read the sign right (every `reload_mult`
# printed "FASTER", including body_armor's 1.25, a COST), and neither carried a line for Armour Piercing's
# slower cycle. `gain_cost_lines` is the one place either UI reads this from now; both render the lists
# it returns rather than deriving anything. A key `EFFECT_KEYS` names but this function does not handle
# is a data error the same way an unknown key in `perks.json` is -- `_HANDLED_KEYS` below is asserted
# equal to `EFFECT_KEYS` in `test_mc_perk_slot.py`, so a new perk effect fails the build before it ships
# a silently blank line.
_NODE_LOCAL_GAIN = {
    # `effects: {}` on purpose (perks.json's `_note`): the node runs these against its own gun, nothing
    # for the compiler to write, so there is no lever here to read a line off. Named directly instead.
    "motion_tracker": "ENEMIES ON YOUR HUD",
    "second_wind": "SURVIVE ONE NEAR-KILL",
}
_HANDLED_KEYS = frozenset({"max_armor_add", "ammo_mult", "reload_mult", "switch_mult", "alt_reload",
                          "armor_piercing", "crit_pct_add"})


def _rate(m: float) -> str:
    """How many times faster/slower a multiplier reads, as a plain '1.3' or '2' -- callers add the ×
    and the word. A multiplier under 1 is inverted first (0.5 reload_mult -> reloads take half the
    time -> the player-facing number is '2', not '0.5'). Rounded to one decimal, then that decimal is
    dropped when it is a bare '.0' (`2.0` -> `2`) -- both UIs' kit plate is a fixed ~124 px wide, and
    a needless ".0" on the one perk whose rate happens to be a whole number (Quick Hands, Quick
    Switch) was enough to clip it (screens.mjs `se kitted-perk: invariants`)."""
    v = round(m if m > 1 else 1 / m, 1)
    return f"{v:g}"


def gain_cost_lines(perk_id: str, effects: PerkEffects) -> tuple[list[str], list[str]]:
    """Split one perk's resolved `effects` into player-facing GAIN and COST lines. Every key in
    `EFFECT_KEYS` is handled; an effects dict carrying a key this function does not know raises, the
    same discipline `PerkCatalog.__init__` already applies to `perks.json` itself. `perk_id` supplies
    `_NODE_LOCAL_GAIN` for a perk whose `effects` is empty by design."""
    bad = set(effects) - _HANDLED_KEYS
    if bad:
        raise ValueError(f"perks.gain_cost_lines {perk_id!r}: unhandled effect keys {sorted(bad)}")
    gain: list[str] = []
    cost: list[str] = []
    if "max_armor_add" in effects:
        n = effects["max_armor_add"]
        (gain if n > 0 else cost).append(f"{n:+d} ARMOR")
    if "ammo_mult" in effects:
        m = effects["ammo_mult"]
        (gain if m > 1 else cost).append(f"×{m:g} AMMO")
    if "reload_mult" in effects:
        m = effects["reload_mult"]
        (gain if m < 1 else cost).append(f"RELOADS {_rate(m)}× {'FASTER' if m < 1 else 'SLOWER'}")
    if "switch_mult" in effects:
        m = effects["switch_mult"]
        (gain if m < 1 else cost).append(f"SWAPS {_rate(m)}× {'FASTER' if m < 1 else 'SLOWER'}")
    if effects.get("alt_reload"):
        gain.append("ALT = RELOAD")
    if effects.get("armor_piercing"):
        gain.append("IGNORES ARMOR & SHIELDS")
        # ap_dmg/ap_fire_ms (weapon-design.md §7.7) live on the WEAPON (weapons.json), not the perk --
        # the exact numbers depend on which primary carries this perk, so the cost line names the two
        # levers rather than a figure that would be wrong on every weapon but one.
        cost.append("FIXED DAMAGE, SLOWER CYCLE")
    if "crit_pct_add" in effects:
        n = effects["crit_pct_add"]
        (gain if n > 0 else cost).append(f"{n:+d}% CRIT CHANCE")
    if not gain and perk_id in _NODE_LOCAL_GAIN:
        gain.append(_NODE_LOCAL_GAIN[perk_id])
    return gain, cost


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

    def all(self) -> list[PerkView]:
        """Visible rows (hidden excluded), API/phone `PerkView` shape."""
        return [self.view(r) for r in self._rows if not r.get("hidden")]

    @staticmethod
    def view(r: dict) -> PerkView:
        raw_effects = r.get("effects") or {}
        # Built key-by-key rather than `dict(raw_effects)`: `PerkEffects` fields each have their own
        # concrete type (int/float/bool), which a loop over a runtime key can't express -- `__init__`
        # already refused any row whose `effects` carries a key outside this same five, so this is a
        # reshape of already-validated data, not a second validation pass.
        effects: PerkEffects = {}
        if "max_armor_add" in raw_effects:
            effects["max_armor_add"] = raw_effects["max_armor_add"]
        if "ammo_mult" in raw_effects:
            effects["ammo_mult"] = raw_effects["ammo_mult"]
        if "reload_mult" in raw_effects:
            effects["reload_mult"] = raw_effects["reload_mult"]
        if "alt_reload" in raw_effects:
            effects["alt_reload"] = raw_effects["alt_reload"]
        if "switch_mult" in raw_effects:
            effects["switch_mult"] = raw_effects["switch_mult"]
        if "armor_piercing" in raw_effects:
            effects["armor_piercing"] = raw_effects["armor_piercing"]
        if "crit_pct_add" in raw_effects:
            effects["crit_pct_add"] = raw_effects["crit_pct_add"]
        gain, cost = gain_cost_lines(r["perk_id"], effects)
        return {"perk_id": r["perk_id"], "name": r["name"], "desc": r.get("desc", ""),
                "tags": list(r.get("tags") or []), "mechanism": r.get("mechanism", "passive"),
                "effects": effects, "gain": gain, "cost": cost, "verified": bool(r.get("verified")),
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
