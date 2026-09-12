"""M-LOADOUT loadout policy (docs/spec/loadout.md §3) — the ONE rule engine.

Who may pick what, per slot. Presets are named here; the derived pool (allowed ids per slot) is
computed once server-side and published in `State.loadout_pool` + each node's `assign.policy`, so
neither UI carries rule logic. Everything returns plain dicts (contracts shapes) — no classes to share.

A14 (2026-09-04, Tony: "you should be able to have AR and pistol and quick switch perk"): a perk is its
OWN slot, not a thing that displaces the secondary weapon. Three rules — `primary`, `secondary`
(weapons / sidearms only) and `perk`. The one hardware exception: a perk that takes the ALT button
(`effects.alt_reload`, Easy Reload) leaves no button to switch weapons with, so it cannot ride with a
second weapon — the server drops the other one and says so; the UIs warn before the tap.
F123 (2026-09-11, field): the SAME perk also cannot reload a weapon whose reload is a HELD per-shell chain.
`easy_reload` compiles to `$BMAP,1,97` — a MOMENTARY alt-fire remap — and one tap emits one reload event, so on
the Shotgun (`reload_type: "chain"`, six shells at ~420 ms each, driven by holding the physical handle) the
magazine simply never comes back. Tony's call: exclude the pairing rather than fake it. Same shape as the
second-weapon rule above, and for the same reason — the gun cannot do it.
No pre-A14 shape is read (FOLLOWUPS S6, Tony: "we dont need to support legacy at all"): a stored policy that
still says "perk" inside `secondary.kinds` is a validation error and `normalize` falls back to the mode default.
"""
from __future__ import annotations

import copy
import functools
import json
import pathlib
from typing import Any, Mapping, Sequence

from .types import (ItemKind, Loadout, LoadoutPolicy, LoadoutPool, LoadoutPreset, PerkView, SlotChoice,
                    SlotRule, Weapon, WeaponSel)

CHOICES = ("player", "host", "fixed", "off")
SEC_KINDS = ("weapon", "sidearm")              # A14: slot 2 admits weapons only; "sidearm" (A12) = only the `sidearm`-tagged pistols
PRIMARY_KINDS = ("weapon", "sidearm")          # a perk never goes in slot 1; "sidearm" alone = a pistol round
PERK_KINDS = ("perk",)
SLOTS = ("primary", "secondary", "perk")
SIDEARM_TAG = "sidearm"
PRESET_NAMES = ("open", "no_heavies", "snipers", "custom")
PRESET_LABELS = {"open": "OPEN", "no_heavies": "NO HEAVIES", "snipers": "SNIPERS ONLY", "custom": "CUSTOM RULES"}

# Human copy for rejections — the HUD shows `reason` verbatim (loadout.md §4.2).
_R_LOCKED = "Set by the host — this slot is locked for this game"
_R_HUD_OFF = "Loadout picks are host-side for this game"
_R_OFF = "No secondary this game"
_R_NO_PERKS = "No perks this game"
_R_FIXED = "{what} is fixed to {name} for this game — change it in BUILD"
_R_NOT_ALLOWED = "{name} isn't allowed in this game"
_R_HEAVY = "Heavies are off for this game"
_R_KIND = "{kind} can't go in the {slot} slot this game"
_R_PERK_SLOT = "Perks have their own slot this game"
_R_ONLY_PERKS = "Only a perk goes in the perk slot"
_R_SIDEARM_ONLY = "Only sidearms go in the {slot} slot this game"
_R_UNKNOWN = "Unknown {kind}"
_R_ALT_BOTH = "{perk} takes the ALT button, so it can't ride with a second weapon"
_R_ALT_CHAIN = "{weapon} loads shell by shell — {perk} only taps the button once, so it can't reload it"
# `loadout_ack.reason` when a pick applied but knocked the other thing out (A14 §4.2)
_R_DROPPED_WEAPON = "{perk} takes the ALT button — {weapon} dropped"
_R_DROPPED_PERK = "{weapon} needs the ALT button to switch — {perk} dropped"
_R_DROPPED_PERK_CHAIN = "{weapon} loads shell by shell — {perk} dropped"


def takes_alt(row: PerkView | None) -> bool:
    """Does this perk claim the ALT button (`effects.alt_reload`)? Then no second weapon can be switched to."""
    return bool(((row or {}).get("effects") or {}).get("alt_reload"))


@functools.lru_cache(maxsize=1)
def _chain_reload_ids() -> frozenset[str]:
    """Weapon ids whose reload is a HELD per-shell chain, read from `weapons.json`'s explicit `reload_type`.

    ⚠ NOT derived from `$WEAP` t19. t19 is labelled `reloadType` in the APK and the Shotgun does carry 2
    there, but `protocol/callsign-extract/protocol-classes.md` retracts the reading: the Plasma Sniper has an
    operator-confirmed shell reload at t19 = 0. Inferring "chain" from the token would therefore be wrong in
    both directions, so the attribute is stated per weapon and only where the wire proved it.

    LAST RESORT ONLY. The rows this module is given are COMPILED catalog entries
    (`compile.WeaponCatalog.all()`), which publish `tags`/`stats` and not the raw weapon record, so a row with
    no `reload_type` of its own still has to be answered for. `chain_reload()` prefers the row's own field
    whenever it carries one and every caller now looks the id up in the CATALOG IN PLAY first
    (`_weapon_row(weapons, wid)`), so a game running a catalog of its own is never answered from this file —
    the day the compiled shape publishes `reload_type` this lookup stops being consulted at all."""
    try:
        data = json.loads((pathlib.Path(__file__).with_name("weapons.json")).read_text(encoding="utf-8"))
    except (OSError, ValueError):                 # a synthetic catalog with no data file: no chain weapons
        return frozenset()
    return frozenset(w["weapon_id"] for w in data.get("weapons", []) if w.get("reload_type") == "chain")


def chain_reload(row: Mapping[str, Any] | None) -> bool:
    """Does this weapon reload shell by shell, by HOLDING the handle? Then a momentary button can't do it.

    `row` is a catalog `Weapon` in the common case, but every caller also falls back to a bare
    `{"weapon_id": wid}` when the id is not in the catalog (`_weapon_row(...) or {"weapon_id": wid}`) --
    a partial, untrusted shape -- so this stays a loose `Mapping`, not `Weapon`."""
    row = row or {}
    if row.get("reload_type"):
        return row["reload_type"] == "chain"
    wid = row.get("weapon_id")
    return bool(wid) and wid in _chain_reload_ids()


def _rule(choice: SlotChoice = "player", kinds: Sequence[ItemKind] = ("weapon",),
         exclude_tags: Sequence[str] = (), exclude_ids: Sequence[str] = (),
         only_ids: Sequence[str] = (), fixed_id: str | None = None) -> SlotRule:
    return {"choice": choice, "kinds": list(kinds), "exclude_tags": list(exclude_tags),
            "exclude_ids": list(exclude_ids), "only_ids": list(only_ids), "fixed_id": fixed_id}


def preset_rules(name: str) -> LoadoutPolicy:
    """The rules a named preset stands for (§3.1). `custom` has no rules of its own → open."""
    if name == "no_heavies":
        return {"preset": name, "hud_select": True,
                "primary": _rule("player", ("weapon",), exclude_tags=("heavy",)),
                "secondary": _rule("player", ("weapon",), exclude_tags=("heavy",)),
                "perk": _rule("player", PERK_KINDS)}
    if name == "snipers":
        return {"preset": name, "hud_select": False,
                "primary": _rule("fixed", ("weapon",), fixed_id="sniper_rifle"),
                "secondary": _rule("off", ("weapon",)),
                "perk": _rule("off", PERK_KINDS)}
    return {"preset": "open" if name != "custom" else "custom", "hud_select": True,
            "primary": _rule("player", ("weapon",)),
            "secondary": _rule("player", ("weapon",)),
            "perk": _rule("player", PERK_KINDS)}


MODE_DEFAULT_PRESET = {"ffa": "no_heavies"}


def default_policy(mode: str) -> LoadoutPolicy:
    return preset_rules(MODE_DEFAULT_PRESET.get(mode, "open"))


def _matches_preset(pol: Mapping[str, Any], name: str) -> bool:
    ref = dict(preset_rules(name))
    return all(pol.get(k) == ref[k] for k in ("hud_select", "primary", "secondary", "perk"))


def _check_rule(slot: str, r: Any) -> SlotRule:
    if not isinstance(r, dict):
        raise ValueError(f"loadout_policy.{slot} must be an object")
    out = _rule()
    out["kinds"] = ["perk"] if slot == "perk" else ["weapon"]
    if "choice" in r:
        if r["choice"] not in CHOICES or (slot == "primary" and r["choice"] == "off"):
            raise ValueError(f"loadout_policy.{slot}.choice must be one of {CHOICES}")
        out["choice"] = r["choice"]
    if "kinds" in r and slot != "perk":            # the perk slot's kinds are always ["perk"]
        ks = r["kinds"]
        allowed = SEC_KINDS if slot == "secondary" else PRIMARY_KINDS
        if not isinstance(ks, list) or not ks or any(k not in allowed for k in ks):
            raise ValueError(f"loadout_policy.{slot}.kinds must be a non-empty list of {'|'.join(allowed)}")
        out["kinds"] = list(dict.fromkeys(ks))
    for key in ("exclude_tags", "exclude_ids", "only_ids"):
        if key in r:
            v = r[key]
            if not isinstance(v, list) or not all(isinstance(x, str) for x in v):
                raise ValueError(f"loadout_policy.{slot}.{key} must be a list of strings")
            out[key] = list(dict.fromkeys(v))
    if "fixed_id" in r:
        v = r["fixed_id"]
        if v is not None and not isinstance(v, str):
            raise ValueError(f"loadout_policy.{slot}.fixed_id must be a string or null")
        out["fixed_id"] = v or None
    if out["choice"] == "fixed" and not out["fixed_id"]:
        raise ValueError(f"loadout_policy.{slot}: choice 'fixed' needs a fixed_id")
    return out


def merge(current: LoadoutPolicy | None, patch: Mapping[str, Any]) -> LoadoutPolicy:
    """Apply a partial policy patch (§3). A `preset` name REWRITES the rules; a rule edit that no longer
    matches a preset flips `preset` to `custom`.

    `patch` is untrusted (a raw `PUT`/`PATCH` body, or a stored config predating this shape) -- every
    field is validated below, so it stays a loose `Mapping`, not `LoadoutPolicy`."""
    if not isinstance(patch, dict):
        raise ValueError("loadout_policy must be an object")
    # `LoadoutPolicy` only supports its five known keys, but every rule below is keyed by a runtime
    # `slot` string -- worked on here as a plain dict and reassembled into the TypedDict at the end.
    base: dict[str, Any] = dict(copy.deepcopy(current)) if current else dict(preset_rules("open"))
    for slot in SLOTS:
        base.setdefault(slot, dict(preset_rules("open"))[slot])
    pname = patch.get("preset")
    if pname is not None:
        if pname not in PRESET_NAMES:
            raise ValueError(f"loadout_policy.preset must be one of {PRESET_NAMES}")
        if pname != "custom":
            # in-place, not `base = dict(...)`: a rebind would narrow `base` to the literal union of
            # `LoadoutPolicy`'s own field types for the rest of the function, undoing the `dict[str, Any]`
            # annotation above (this dict is worked on by runtime `slot` string, not by literal key).
            base.clear()
            base.update(dict(preset_rules(pname)))
    for slot in SLOTS:
        if slot in patch:
            if isinstance(patch[slot], dict):
                base[slot] = {**base[slot], **{k: v for k, v in patch[slot].items() if k in base[slot]}}
            else:
                base[slot] = patch[slot]
    for slot in SLOTS:
        base[slot] = _check_rule(slot, base[slot])
    if "hud_select" in patch:
        base["hud_select"] = bool(patch["hud_select"])
    preset_candidates: tuple[LoadoutPreset, ...] = ("open", "no_heavies", "snipers")
    preset_val: LoadoutPreset = "custom"
    if pname != "custom":
        for n in preset_candidates:
            if _matches_preset(base, n):
                preset_val = n
                break
    base["preset"] = preset_val
    # `preset_val` (typed) rather than `base["preset"]` here: pyright narrows a dict subscript written
    # through a literal key, so re-reading `base["preset"]` after the line above would carry the plain
    # `str` it was narrowed to instead of the `LoadoutPreset` this return needs.
    return {"preset": preset_val, "hud_select": base["hud_select"], "primary": base["primary"],
            "secondary": base["secondary"], "perk": base["perk"]}


def normalize(pol: LoadoutPolicy | None, mode: str = "tdm") -> LoadoutPolicy:
    """A stored config may predate policies (session.json) or carry a shape this engine no longer reads — the mode default then."""
    if not pol:
        return default_policy(mode)
    try:
        return merge(preset_rules("open"), pol)
    except ValueError:
        return default_policy(mode)


# ---- pool ---------------------------------------------------------------------
def _filter(rule: SlotRule, rows: Sequence[Mapping[str, Any]], id_key: str) -> list[str]:
    ex_tags = set(rule.get("exclude_tags") or ())
    ex_ids = set(rule.get("exclude_ids") or ())
    only = set(rule.get("only_ids") or ())
    out = []
    for r in rows:
        rid = r[id_key]
        if only and rid not in only:
            continue
        if rid in ex_ids or (ex_tags & set(r.get("tags") or ())):
            continue
        out.append(rid)
    return out


def weapon_kind_rows(rule: SlotRule, weapons: Sequence[Weapon]) -> list[Weapon]:
    """The weapon rows a slot's `kinds` admits BEFORE the tag/id filters: "weapon" = every visible
    weapon (a pistol is a weapon too); "sidearm" alone = only the `sidearm`-tagged rows; neither = none."""
    kinds = rule.get("kinds") or ()
    if "weapon" in kinds:
        return list(weapons)
    if SIDEARM_TAG in kinds:
        return [w for w in weapons if SIDEARM_TAG in set(w.get("tags") or ())]
    return []


def admits_weapons(rule: SlotRule) -> bool:
    return bool({"weapon", SIDEARM_TAG} & set(rule.get("kinds") or ()))


def pool(policy: LoadoutPolicy, weapons: Sequence[Weapon], perks: Sequence[PerkView]) -> LoadoutPool:
    """Allowed ids per slot (catalog order) — `State.loadout_pool` (§3.2). `weapons`/`perks` are the
    VISIBLE catalog rows (each with `tags`)."""
    prim, sec, pr = policy["primary"], policy["secondary"], policy["perk"]
    if prim["choice"] == "fixed":
        prim_fid = prim["fixed_id"]     # `_check_rule` refuses choice "fixed" with no fixed_id
        primary = [prim_fid] if prim_fid and any(w["weapon_id"] == prim_fid for w in weapons) else []
    else:
        primary = _filter(prim, weapon_kind_rows(prim, weapons), "weapon_id")
    if sec["choice"] == "off":
        sw = []
    elif sec["choice"] == "fixed":
        sec_fid = sec["fixed_id"]
        sw = [sec_fid] if sec_fid and any(w["weapon_id"] == sec_fid for w in weapons) else []
    else:
        sw = _filter(sec, weapon_kind_rows(sec, weapons), "weapon_id")
    if pr["choice"] == "off":
        sp = []
    elif pr["choice"] == "fixed":
        pr_fid = pr["fixed_id"]
        sp = [pr_fid] if pr_fid and any(p["perk_id"] == pr_fid for p in perks) else []
    else:
        sp = _filter(pr, perks, "perk_id")
    return {"primary": primary, "secondary_weapons": sw, "perks": sp}


# ---- validation / auto-apply ------------------------------------------------------
def _name(rows: Sequence[Mapping[str, Any]], key: str, rid: str) -> str:
    return next((r["name"] for r in rows if r[key] == rid), rid)


def _perk_row(perks: Sequence[PerkView], pid: str | None) -> PerkView | None:
    return next((p for p in perks if p.get("perk_id") == pid), None) if pid else None


def _weapon_row(weapons: Sequence[Weapon], wid: str | None) -> Weapon | None:
    return next((w for w in weapons if w.get("weapon_id") == wid), None) if wid else None


def conflict(loadout: Loadout, perks: Sequence[PerkView]) -> dict | None:
    """A14: the perk takes the ALT button AND a second weapon is loaded → `{perk, weapon}` (ids); else None."""
    lo = loadout
    ws = lo.get("weapons") or []
    sec_w = ws[1]["weapon_id"] if len(ws) > 1 else None
    perk = lo.get("perk") or None
    if sec_w and perk and takes_alt(_perk_row(perks, perk)):
        return {"perk": perk, "weapon": sec_w}
    return None


def chain_conflict(loadout: Loadout, weapons: Sequence[Weapon], perks: Sequence[PerkView]) -> dict | None:
    """F123: the perk takes the ALT button AND an equipped weapon chain-reloads → `{perk, weapon}`; else None.

    Checked over EVERY equipped weapon, not just the primary. `conflict` above already rules out a second
    weapon beside an ALT perk, so in practice this is the primary — but the two rules are independent and a
    later change to either must not quietly re-open this pairing."""
    lo = loadout
    perk = lo.get("perk") or None
    if not perk or not takes_alt(_perk_row(perks, perk)):
        return None
    for w in lo.get("weapons") or []:
        wid = (w or {}).get("weapon_id")
        if chain_reload(_weapon_row(weapons, wid) or {"weapon_id": wid}):
            return {"perk": perk, "weapon": wid}
    return None


def _why_not(rule: SlotRule, rows: Sequence[Mapping[str, Any]], key: str, rid: str, slot: str = "secondary") -> str:
    r = next((x for x in rows if x[key] == rid), None)
    if r is None:
        return _R_UNKNOWN.format(kind="weapon" if key == "weapon_id" else "perk")
    kinds = set(rule.get("kinds") or ())
    if key == "weapon_id" and SIDEARM_TAG in kinds and "weapon" not in kinds and SIDEARM_TAG not in set(r.get("tags") or ()):
        return _R_SIDEARM_ONLY.format(slot=slot)
    if "heavy" in set(rule.get("exclude_tags") or ()) and "heavy" in set(r.get("tags") or ()):
        return _R_HEAVY
    return _R_NOT_ALLOWED.format(name=r["name"])


def validate_loadout(policy: LoadoutPolicy, lp: LoadoutPool, loadout: Loadout, weapons: Sequence[Weapon],
                     perks: Sequence[PerkView]) -> tuple[bool, str | None]:
    """Host-side check (PATCH /api/players): does this loadout obey the policy? `lp` = pool(policy, …)."""
    ws = loadout.get("weapons") or []
    prim = ws[0]["weapon_id"] if ws else None
    sec_w = ws[1]["weapon_id"] if len(ws) > 1 else None
    perk = loadout.get("perk") or None
    pr, sr, kr = policy["primary"], policy["secondary"], policy["perk"]
    if prim is None:
        return False, "A primary weapon is required"
    if prim not in lp["primary"]:
        if pr["choice"] == "fixed":
            return False, _R_FIXED.format(what="Primary", name=_name(weapons, "weapon_id", pr["fixed_id"] or ""))
        return False, _why_not(pr, weapons, "weapon_id", prim, "primary")
    if sr["choice"] == "off" and sec_w:
        return False, _R_OFF
    if sr["choice"] == "fixed" and sec_w != sr["fixed_id"]:
        return False, _R_FIXED.format(what="Secondary", name=_name(weapons, "weapon_id", sr["fixed_id"] or ""))
    if sec_w and sec_w not in lp["secondary_weapons"]:
        if not admits_weapons(sr):
            return False, _R_KIND.format(kind="A weapon", slot="secondary")
        return False, _why_not(sr, weapons, "weapon_id", sec_w)
    if kr["choice"] == "off" and perk:
        return False, _R_NO_PERKS
    if kr["choice"] == "fixed" and perk != kr["fixed_id"]:
        return False, _R_FIXED.format(what="Perk", name=_name(perks, "perk_id", kr["fixed_id"] or ""))
    if perk and perk not in lp["perks"]:
        return False, _why_not(kr, perks, "perk_id", perk, "perk")
    c = conflict(loadout, perks)
    if c:
        return False, _R_ALT_BOTH.format(perk=_name(perks, "perk_id", c["perk"]))
    cc = chain_conflict(loadout, weapons, perks)
    if cc:
        return False, _R_ALT_CHAIN.format(weapon=_name(weapons, "weapon_id", cc["weapon"]),
                                          perk=_name(perks, "perk_id", cc["perk"]))
    return True, None


def apply(policy: LoadoutPolicy, lp: LoadoutPool, loadout: Loadout, weapons: Sequence[Weapon],
         perks: Sequence[PerkView]) -> Loadout:
    """Auto-fix a loadout to the policy (§3.3): fixed → set; off → cleared; out-of-pool → primary falls to
    the first allowed weapon (assault_rifle when allowed), secondary / perk cleared. An ALT-button perk
    beside a second weapon keeps the perk (the host's rule put it there) and drops the weapon. Returns a NEW dict."""
    out = copy.deepcopy(loadout)
    ws = list(out.get("weapons") or [])
    prim = ws[0]["weapon_id"] if ws else None
    sec_w = ws[1]["weapon_id"] if len(ws) > 1 else None
    perk = out.get("perk") or None
    sr, kr = policy["secondary"], policy["perk"]
    if prim not in lp["primary"]:
        prim = ("assault_rifle" if "assault_rifle" in lp["primary"] else (lp["primary"][0] if lp["primary"] else prim or "assault_rifle"))
    # every branch above (and every value already in `lp["primary"]`, a list of ids -- never None) ends
    # in a string; the fallback chain's own `prim or "assault_rifle"` covers the last empty-pool case.
    assert prim is not None
    if sr["choice"] == "off":
        sec_w = None
    elif sr["choice"] == "fixed":
        sec_w = sr["fixed_id"] if sr["fixed_id"] in lp["secondary_weapons"] else None
    elif sec_w and sec_w not in lp["secondary_weapons"]:
        sec_w = None
    if kr["choice"] == "off":
        perk = None
    elif kr["choice"] == "fixed":
        perk = kr["fixed_id"] if kr["fixed_id"] in lp["perks"] else None
    elif perk and perk not in lp["perks"]:
        perk = None
    if sec_w and perk and takes_alt(_perk_row(perks, perk)):
        sec_w = None
    # F123: an ALT-button perk beside a CHAIN-reload weapon loses the perk, not the weapon — the opposite
    # resolution to the rule above, and for a plain reason: a primary weapon is mandatory and a perk is not.
    if perk and takes_alt(_perk_row(perks, perk)) and chain_reload(_weapon_row(weapons, prim) or {"weapon_id": prim}):
        perk = None
    new_weapons: list[WeaponSel] = [{"weapon_id": prim}]
    if sec_w:
        new_weapons.append({"weapon_id": sec_w})
    out["weapons"] = new_weapons
    if perk:
        out["perk"] = perk
    else:
        out.pop("perk", None)
    return out


def check_request(policy: LoadoutPolicy, lp: LoadoutPool, slot: str, kind: str, rid: str | None,
                  weapons: Sequence[Weapon], perks: Sequence[PerkView],
                  loadout: Loadout | None = None) -> tuple[bool, str | None]:
    """Phone-side check for a `loadout_request` (§4.2).

    `loadout` is the player's CURRENT kit, and is only needed for rules that depend on what is already
    equipped. There is one: F123's `easy_reload` + chain-reload weapon. Optional, because every other rule
    here is about the pick alone — omit it and that one rule simply does not fire (`set_slot` still refuses
    to store the pairing, so a caller that cannot supply it gets a silent no-op rather than a broken gun)."""
    if slot not in SLOTS:
        return False, "Unknown slot"
    rule = policy[slot]
    if rule["choice"] == "off":
        return False, _R_NO_PERKS if slot == "perk" else _R_OFF   # the most specific reason first: "no secondary" beats "host-side"
    if not policy.get("hud_select"):
        return False, _R_HUD_OFF
    if rule["choice"] in ("host", "fixed"):
        return False, _R_LOCKED
    if kind == "none":
        if slot == "primary":
            return False, "A primary weapon is required"
        return True, None
    if kind not in ("weapon", "perk") or not rid:       # a pistol is requested as kind "weapon" (contracts §2: WeaponSel)
        return False, "Unknown pick"
    if slot == "perk":
        if kind != "perk":
            return False, _R_ONLY_PERKS
        if rid not in lp["perks"]:
            return False, _why_not(rule, perks, "perk_id", rid, "perk")
        # F123: an ALT-button perk cannot reload a chain-reload weapon the player already has equipped.
        # Refused rather than resolved: the conflicting weapon is the PRIMARY, and a primary is mandatory,
        # so there is nothing to drop in its place the way a second weapon can be dropped.
        cc = chain_conflict({**loadout, "perk": rid}, weapons, perks) if loadout else None
        if cc:
            return False, _R_ALT_CHAIN.format(weapon=_name(weapons, "weapon_id", cc["weapon"]),
                                              perk=_name(perks, "perk_id", rid))
        return True, None
    if kind != "weapon":
        return False, _R_KIND.format(kind="A perk", slot="primary") if slot == "primary" else _R_PERK_SLOT
    if slot == "primary":
        if rid not in lp["primary"]:
            return False, _why_not(rule, weapons, "weapon_id", rid, "primary")
        return True, None
    if not admits_weapons(rule):
        return False, _R_KIND.format(kind="A weapon", slot="secondary")
    if rid not in lp["secondary_weapons"]:
        return False, _why_not(rule, weapons, "weapon_id", rid)
    return True, None


def set_slot(loadout: Loadout, slot: str, kind: str, rid: str | None, perks: Sequence[PerkView] = (),
             weapons: Sequence[Weapon] = ()) -> Loadout:
    """Write one slot of a loadout (already validated). The thing just picked wins an ALT-button conflict:
    Easy Reload over a second weapon drops the weapon; a second weapon over Easy Reload drops the perk
    (Tony 2026-09-04: "when you pick that it will invalidate your secondary gun selection"). Returns a NEW dict.

    `weapons` is the catalog IN PLAY, so the chain-reload question is asked of the row this game is using
    rather than of the shipped data file (see `chain_reload`). Optional: with no catalog the id lookup
    still answers for the stock roster."""
    out: dict[str, Any] = dict(copy.deepcopy(loadout))
    ws = list(out.get("weapons") or [])
    prim = ws[0]["weapon_id"] if ws else "assault_rifle"
    sec_w = ws[1]["weapon_id"] if len(ws) > 1 else None
    perk = out.get("perk") or None
    def chains(wid):
        return chain_reload(_weapon_row(weapons, wid) or {"weapon_id": wid})
    if slot == "primary":
        prim = rid
        # `check_request` refuses kind="none"/slot="primary" (a primary is mandatory) before a caller
        # ever reaches here, so `rid` is never None on this path -- narrowed for the WeaponSel below,
        # rather than the wire silently getting a weapon_id of None if that contract were ever violated.
        assert prim is not None
        # F123: picking a chain-reload primary while holding an ALT-button perk drops the PERK. The perk
        # cannot win here the way it wins over a second weapon — a primary is mandatory — so the pick that
        # just happened is the one that stands, which is the same rule, applied to the only slot that can move.
        if perk and chains(prim) and takes_alt(_perk_row(perks, perk)):
            perk = None
    elif slot == "secondary":
        sec_w = rid if kind == "weapon" else None
        if sec_w and perk and takes_alt(_perk_row(perks, perk)):
            perk = None
    else:
        perk = rid if kind == "perk" else None
        # F123 backstop FIRST: a primary is mandatory, so an ALT-button perk picked onto a chain-reload
        # primary has nothing it can displace. `check_request` refuses it with a reason when it was given
        # the current loadout; here, with no way to say why, the pick simply does not take — never a stored
        # pairing the gun cannot perform.
        #
        # ⚠ Order matters, and it used to be the other way round (polish review 2026-09-12): a chain primary
        # + a second weapon + a pick of Easy Reload dropped the WEAPON on the ALT rule below and then reverted
        # the perk here, so the player lost their secondary to a pick that never applied and `dropped_by` —
        # which reads the perk, not the weapon — reported nothing. A pick that cannot take must move NOTHING,
        # so the two rules are now exclusive rather than sequential.
        if perk and takes_alt(_perk_row(perks, perk)) and chains(prim):
            perk = out.get("perk") or None
        elif perk and sec_w and takes_alt(_perk_row(perks, perk)):
            sec_w = None
    new_weapons: list[WeaponSel] = [{"weapon_id": prim}]
    if sec_w:
        new_weapons.append({"weapon_id": sec_w})
    out["weapons"] = new_weapons
    if perk:
        out["perk"] = perk
    else:
        out.pop("perk", None)
    # `out` stays a plain dict throughout (it is worked on by key names the loop above never fixes to
    # literals); reassembled into the TypedDict here, `overrides` carried through untouched since
    # nothing above ever reads or writes it.
    result: Loadout = {"weapons": new_weapons}
    if "perk" in out:
        result["perk"] = out["perk"]
    if "overrides" in out:
        result["overrides"] = out["overrides"]
    return result


def dropped_by(before: Loadout, after: Loadout, weapons: Sequence[Weapon],
               perks: Sequence[PerkView]) -> tuple[dict | None, str | None]:
    """What a `set_slot` knocked out of the OTHER slot, as `loadout_ack.dropped {slot, id, name}` + the reason line."""
    b_ws, a_ws = before.get("weapons") or [], after.get("weapons") or []
    b_sec = b_ws[1]["weapon_id"] if len(b_ws) > 1 else None
    a_sec = a_ws[1]["weapon_id"] if len(a_ws) > 1 else None
    b_perk, a_perk = before.get("perk") or None, after.get("perk") or None
    b_prim = b_ws[0]["weapon_id"] if b_ws else None
    a_prim = a_ws[0]["weapon_id"] if a_ws else None
    if b_perk and not a_perk and a_prim and a_prim != b_prim and chain_reload(_weapon_row(weapons, a_prim) or {"weapon_id": a_prim}):
        pname = _name(perks, "perk_id", b_perk)   # F123: a chain-reload primary knocked the ALT-button perk out
        return {"slot": "perk", "id": b_perk, "name": pname}, _R_DROPPED_PERK_CHAIN.format(weapon=_name(weapons, "weapon_id", a_prim), perk=pname)
    if b_sec and not a_sec and a_perk and a_perk != b_perk:
        wname = _name(weapons, "weapon_id", b_sec)
        return {"slot": "secondary", "id": b_sec, "name": wname}, _R_DROPPED_WEAPON.format(perk=_name(perks, "perk_id", a_perk), weapon=wname)
    if b_perk and not a_perk and a_sec and a_sec != b_sec:
        pname = _name(perks, "perk_id", b_perk)
        return {"slot": "perk", "id": b_perk, "name": pname}, _R_DROPPED_PERK.format(weapon=_name(weapons, "weapon_id", a_sec), perk=pname)
    return None, None


def node_view(policy: LoadoutPolicy, lp: LoadoutPool) -> dict:
    """The per-player `assign.policy` the phone renders from (§4.1)."""
    return {"hud_select": bool(policy.get("hud_select")),
            "primary": {"choice": policy["primary"]["choice"], "allowed_ids": list(lp["primary"])},
            "secondary": {"choice": policy["secondary"]["choice"], "kinds": list(policy["secondary"]["kinds"]),
                          "allowed_weapon_ids": list(lp["secondary_weapons"])},
            "perk": {"choice": policy["perk"]["choice"], "allowed_perk_ids": list(lp["perks"])}}
