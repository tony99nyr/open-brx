"""M-LOADOUT loadout policy (docs/spec/loadout.md §3) — the ONE rule engine.

Who may pick what, per slot. Presets are named here; the derived pool (allowed ids per slot) is
computed once server-side and published in `State.loadout_pool` + each node's `assign.policy`, so
neither UI carries rule logic. Everything returns plain dicts (contracts shapes) — no classes to share.

A14 (2026-09-04, Tony: "you should be able to have AR and pistol and quick switch perk"): a perk is its
OWN slot, not a thing that displaces the secondary weapon. Three rules — `primary`, `secondary`
(weapons / sidearms only) and `perk`.

S50 (2026-09-17, perk balance pass): Easy Reload moved OUT of the perk slot to
`loadout.overrides.easy_reload` (docs/spec/loadout.md §2) — it is accessibility, not balance, so it no
longer competes with a perk pick and the host sets it once (`state._check_loadout`). The hardware
exception it carries moved WITH it, not away: the ALT button leaves no button to switch weapons with,
so `overrides.easy_reload` still cannot ride with a second weapon (`conflict`) or a weapon whose reload
is a HELD per-shell chain (F123, 2026-09-11 field — `chain_conflict`; on the Shotgun, `reload_type:
"chain"`, one ALT tap emits one reload event and the magazine never comes back). Both are host-side
POLICY rejects now (`validate_loadout`), not a phone `loadout_request` pick — no perk carries
`effects.alt_reload` any more, so `set_slot`/`check_request`/`dropped_by`'s old ALT-conflict branches
are gone with it.
No pre-A14 shape is read (FOLLOWUPS S6, Tony: "we dont need to support legacy at all"): a stored policy that
still says "perk" inside `secondary.kinds` is a validation error and `normalize` falls back to the mode default.
"""
from __future__ import annotations

import copy
import functools
import json
import pathlib
from typing import Any, Mapping, Sequence, cast, get_args

from .types import (ItemKind, Loadout, LoadoutOverrides, LoadoutPolicy, LoadoutPool, LoadoutPreset, PerkView, PoolEmptyCode, SlotChoice,
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
# S50: Easy Reload is a name now, not a perk lookup — it moved to `overrides.easy_reload` and is never
# picked from a list, so there is no perk row left to format a name out of.
_R_ALT_BOTH = "Easy Reload takes the ALT button, so it can't ride with a second weapon"
_R_ALT_CHAIN = "{weapon} loads shell by shell — Easy Reload only taps the button once, so it can't reload it"
# S37 (field 2026-09-12, Tony): a swap perk with nothing to swap to
_R_NO_SWITCH = "{perk} switches between two weapons, and there is no second weapon this game"


def easy_reload_on(loadout: Loadout) -> bool:
    """S50: does this loadout's per-player override claim the ALT button? Replaces the old
    `takes_alt(perk)` — Easy Reload is `overrides.easy_reload` now, not a perk pick."""
    return bool((loadout.get("overrides") or {}).get("easy_reload"))


def swaps_weapons(row: PerkView | None) -> bool:
    """Does this perk do NOTHING without a second weapon? (`effects.switch_mult` < 1 — a perk whose
    WHOLE value is a faster swap, Quick Switch, which compiles to the `$WEAP` tok15 swap delay.)

    S37 (field 2026-09-12, Tony): "if either weapon slot is disabled, the Quick Switch perk must be
    disabled too — with one weapon there is nothing to swap." Asked of the EFFECT rather than of the
    perk id, so a second swap-benefit perk is covered the day it exists.

    S50 (2026-09-17): `< 1` is deliberate, not `bool(...)`. Extended Mags now carries `switch_mult:
    1.3` too — a COST paid on the same lever Quick Switch buys, not a benefit — and that cost simply
    does nothing with no second weapon to slow the draw to; it must not also prune Extended Mags'
    real (ammo_mult) value out of the pool the way a genuine swap-benefit perk should be pruned."""
    sm = ((row or {}).get("effects") or {}).get("switch_mult")
    return bool(sm) and sm < 1


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


def effective(pol: LoadoutPolicy | None, mode: str = "tdm") -> LoadoutPolicy:
    """The ruleset a reader should apply, derived and NEVER stored (round-2 review 2026-09-12).

    `Session.policy()` used to repair a broken rule by writing it back, so a `GET /api/state` mutated
    the session config with no `config_id` bump. The write paths all normalise already; this is the
    pure view for a policy that got past them — absent, or a primary rule that admits no kind of
    weapon, which empties the pool for a reason no operator set and none of them can see."""
    if not pol:
        return default_policy(mode)
    if not admits_weapons(pol.get("primary") or _rule()):
        return normalize(pol, mode)
    return pol


def normalize(pol: LoadoutPolicy | None, mode: str = "tdm") -> LoadoutPolicy:
    """A stored config may predate policies (session.json) or carry a shape this engine no longer reads — the mode default then."""
    if not pol:
        return default_policy(mode)
    try:
        return merge(preset_rules("open"), pol)
    except ValueError:
        return default_policy(mode)


# ---- pool ---------------------------------------------------------------------
# 🔴 Round-2 fix pass K (2026-09-12): weapons that are NOT OFFERABLE in this build, whatever the policy
# says. A weapon whose <t3,t4> keys a $SIR row that cannot move the pool deals no damage at all, and
# `Compiler.validate()` now refuses a loadout carrying one (an ERROR, not an advisory -- it is the
# definition of unkillable). A pick that cannot be pushed is the exact F146 failure: the operator finds
# out at the whistle and has nothing to do about it. So the pool never offers it in the first place.
#
# `energy_launcher` is the only such row today: its captured word keys $SIR 9,3 (function 24, a status
# cell), which is why the catalogue has carried `caution: "deals no damage in our shipped config"` since
# 2026-08-26. It is still in `weapons.json` and still on the CATALOGUE page with that caution -- this
# removes it from the KIT/DESIGNER pools only. **Delete the id the moment its row is fixed on the
# bench** (flatten `_SIR_TABLE` to fn 1, or move the weapon off <9,3>); `test_mc_compile.py`
# `test_k_no_stock_weapon_and_no_shipped_pool_is_blocked_by_the_new_errors` holds the two halves
# together in both directions, so a stale entry here fails loudly rather than quietly hiding a weapon.
# Mirrored in `webapp/mc/src/screens/gameSummary.ts` (`UNPLAYABLE_IDS`).
UNPLAYABLE_IDS = frozenset({"energy_launcher"})


def _filter(rule: SlotRule, rows: Sequence[Mapping[str, Any]], id_key: str) -> list[str]:
    ex_tags = set(rule.get("exclude_tags") or ())
    ex_ids = set(rule.get("exclude_ids") or ())
    only = set(rule.get("only_ids") or ())
    out = []
    for r in rows:
        rid = r[id_key]
        if id_key == "weapon_id" and rid in UNPLAYABLE_IDS:
            continue                      # never offerable, whatever the policy says (round-2 K)
        if id_key == "weapon_id" and r.get("pickup_only"):
            continue                      # 2026-09-17: heavies reserved for a future pickup/station
            #                                mechanism (docs/spec/loadout.md), never in a starting pool
        if only and rid not in only:
            continue
        if rid in ex_ids or (ex_tags & set(r.get("tags") or ())):
            continue
        out.append(rid)
    return out


def _pickup_only_ids(weapons: Sequence[Weapon]) -> frozenset[str]:
    """The `weapon_id`s this game's catalog marks `pickup_only` (2026-09-17) — never a legal loadout
    pick, whatever a `fixed_id`/`only_ids` rule asks for, mirroring `UNPLAYABLE_IDS` for that one check."""
    return frozenset(w["weapon_id"] for w in weapons if w.get("pickup_only"))


def _support_ids(weapons: Sequence[Weapon]) -> frozenset[str]:
    """The `weapon_id`s this game's catalog marks `lethal: false` (2026-09-18, weapon-design.md §7.4):
    weapons that deliberately cannot kill, today the fn-20 stripper and the fn-23 smoke. They are legal
    SECONDARIES, where carrying one costs the player their backup gun, and never a primary. The
    compiler refuses one in slot 0 as a hard error; this keeps it out of the primary POOL so a player is
    never offered a pick that would be refused at arming."""
    return frozenset(w["weapon_id"] for w in weapons if w.get("lethal") is False)


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


# Why a slot's pool came out EMPTY. A closed vocabulary of CODES, not sentences: this module's copy is
# the HUD's (`_R_*`, shown verbatim to a player) and the console needs its own words for the same fact,
# so the one classifier hands out a code and each audience writes its own line. Round-2 review
# 2026-09-12 — the console blamed the PERK slot's filters when S37 had pruned the last perk for having
# no second weapon to switch to, which is a fact about the SECONDARY slot.
POOL_EMPTY_CODES = get_args(PoolEmptyCode)


def _empty_code(rule: SlotRule, rows: Sequence[Mapping[str, Any]], key: str) -> PoolEmptyCode:
    """Why `_filter`/the choice left this slot with nothing. See `POOL_EMPTY_CODES`.

    Round-3 UX-2 (2026-09-13) added `unplayable`, and it BEATS `filtered`. `rows` is the UNFILTERED
    catalog on purpose (a fixed id missing from the whole game is `fixed_missing` whichever filter
    would also have excluded it) — but that made a slot fixed to a weapon in `UNPLAYABLE_IDS` read
    `filtered`, and the console's line for that code tells the operator to clear a filter or set the
    slot to FIXED. It IS fixed, there is no filter, and the sentence never named the weapon. The
    candidate being unplayable is its own fact, on the slot and on an allow-list that names nothing
    else."""
    if rule.get("choice") == "off":
        return "off"
    ids = {r[key] for r in rows}
    unplayable = UNPLAYABLE_IDS if key == "weapon_id" else frozenset()
    if rule.get("choice") == "fixed":
        fid = rule.get("fixed_id")
        if fid not in ids:
            return "fixed_missing"
        return "unplayable" if fid in unplayable else "filtered"
    only = set(rule.get("only_ids") or ())
    if only:
        hit = only & ids
        if not hit:
            return "only_ids_missing"
        if hit <= unplayable:
            return "unplayable"
    return "filtered"


def unplayable_pick(rule: SlotRule) -> str | None:
    """The `UNPLAYABLE_IDS` weapon this slot's rule is asking for, when that is why its pool is empty.

    One accessor so the console line, the config warning and the HUD copy all name the SAME weapon
    rather than each re-deriving it from the rule."""
    if rule.get("choice") == "fixed":
        return fid if (fid := rule.get("fixed_id")) in UNPLAYABLE_IDS else None
    only = set(rule.get("only_ids") or ())
    return sorted(only)[0] if only and only <= UNPLAYABLE_IDS else None


def pool(policy: LoadoutPolicy, weapons: Sequence[Weapon], perks: Sequence[PerkView]) -> LoadoutPool:
    """Allowed ids per slot (catalog order) — `State.loadout_pool` (§3.2). `weapons`/`perks` are the
    VISIBLE catalog rows (each with `tags`).

    An empty slot also gets an entry in `reasons` (absent when every slot has something), so a UI can
    say WHICH control emptied it instead of guessing at the nearest one."""
    prim, sec, pr = policy["primary"], policy["secondary"], policy["perk"]
    pickup_only_ids = _pickup_only_ids(weapons)
    support_ids = _support_ids(weapons)
    if prim["choice"] == "fixed":
        prim_fid = prim["fixed_id"]     # `_check_rule` refuses choice "fixed" with no fixed_id
        primary = [prim_fid] if prim_fid and prim_fid not in UNPLAYABLE_IDS \
            and prim_fid not in pickup_only_ids and prim_fid not in support_ids \
            and any(w["weapon_id"] == prim_fid for w in weapons) else []
    else:
        primary = [wid for wid in _filter(prim, weapon_kind_rows(prim, weapons), "weapon_id")
                   if wid not in support_ids]
    if sec["choice"] == "off":
        sw = []
    elif sec["choice"] == "fixed":
        sec_fid = sec["fixed_id"]
        sw = [sec_fid] if sec_fid and sec_fid not in UNPLAYABLE_IDS \
            and sec_fid not in pickup_only_ids \
            and any(w["weapon_id"] == sec_fid for w in weapons) else []
    else:
        sw = _filter(sec, weapon_kind_rows(sec, weapons), "weapon_id")
    if pr["choice"] == "off":
        sp = []
    elif pr["choice"] == "fixed":
        pr_fid = pr["fixed_id"]
        sp = [pr_fid] if pr_fid and any(p["perk_id"] == pr_fid for p in perks) else []
    else:
        sp = _filter(pr, perks, "perk_id")
    pruned_swap: list[str] = []
    if not sw:
        # S37: with no legal secondary there is nothing to switch to, so a swap perk is not a choice —
        # it is a dead slot. Removing it from the POOL is what makes it disappear from both UIs and
        # from a stored loadout (`apply` clears a perk that is not in the pool) with no extra rule.
        keep = [rid for rid in sp if not swaps_weapons(_perk_row(perks, rid))]
        pruned_swap, sp = [rid for rid in sp if rid not in keep], keep
    out: LoadoutPool = {"primary": primary, "secondary_weapons": sw, "perks": sp}
    reasons: dict[str, PoolEmptyCode] = {}
    if not primary:
        reasons["primary"] = _empty_code(prim, weapons, "weapon_id")
    if not sw:
        reasons["secondary_weapons"] = _empty_code(sec, weapons, "weapon_id")
    if not sp:
        # The S37 prune first: it is the only cause that is NOT about this slot's own rule, and blaming
        # the perk filters for it sends the operator to the wrong control entirely.
        reasons["perks"] = "needs_secondary" if pruned_swap else _empty_code(pr, perks, "perk_id")
    if reasons:
        out["reasons"] = reasons
    return out


# ---- validation / auto-apply ------------------------------------------------------
def _name(rows: Sequence[Mapping[str, Any]], key: str, rid: str) -> str:
    return next((r["name"] for r in rows if r[key] == rid), rid)


def _perk_row(perks: Sequence[PerkView], pid: str | None) -> PerkView | None:
    return next((p for p in perks if p.get("perk_id") == pid), None) if pid else None


def _weapon_row(weapons: Sequence[Weapon], wid: str | None) -> Weapon | None:
    return next((w for w in weapons if w.get("weapon_id") == wid), None) if wid else None


def conflict(loadout: Loadout) -> dict | None:
    """S50: `overrides.easy_reload` takes the ALT button AND a second weapon is loaded → `{weapon}` (id);
    else None. Was `{perk, weapon}` keyed off a perk pick before S50 moved Easy Reload to the override."""
    ws = loadout.get("weapons") or []
    sec_w = ws[1]["weapon_id"] if len(ws) > 1 else None
    if sec_w and easy_reload_on(loadout):
        return {"weapon": sec_w}
    return None


def chain_conflict(loadout: Loadout, weapons: Sequence[Weapon]) -> dict | None:
    """F123/S50: `overrides.easy_reload` AND an equipped weapon chain-reloads → `{weapon}`; else None.

    Checked over EVERY equipped weapon, not just the primary. `conflict` above already rules out a second
    weapon beside Easy Reload, so in practice this is the primary — but the two rules are independent and a
    later change to either must not quietly re-open this pairing."""
    if not easy_reload_on(loadout):
        return None
    for w in loadout.get("weapons") or []:
        wid = (w or {}).get("weapon_id")
        if chain_reload(_weapon_row(weapons, wid) or {"weapon_id": wid}):
            return {"weapon": wid}
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
        if swaps_weapons(_perk_row(perks, perk)) and not lp["secondary_weapons"]:
            return False, _R_NO_SWITCH.format(perk=_name(perks, "perk_id", perk))   # S37
        return False, _why_not(kr, perks, "perk_id", perk, "perk")
    if conflict(loadout):
        return False, _R_ALT_BOTH
    cc = chain_conflict(loadout, weapons)
    if cc:
        return False, _R_ALT_CHAIN.format(weapon=_name(weapons, "weapon_id", cc["weapon"]))
    return True, None


def apply(policy: LoadoutPolicy, lp: LoadoutPool, loadout: Loadout, weapons: Sequence[Weapon],
         perks: Sequence[PerkView]) -> Loadout:
    """Auto-fix a loadout to the policy (§3.3): fixed → set; off → cleared; out-of-pool → primary falls to
    the first allowed weapon (assault_rifle when allowed), secondary / perk cleared. S50: `overrides.easy_reload`
    beside a second weapon keeps the override (it is the host's explicit accessibility setting) and drops the
    weapon; beside a chain-reload primary it is the override that gives way, since a primary is mandatory and
    the weapon just resolved is the one that stands (mirrors the old ALT-button-perk resolution, now on the
    override instead of a perk pick). Returns a NEW dict."""
    out = copy.deepcopy(loadout)
    ws = list(out.get("weapons") or [])
    prim = ws[0]["weapon_id"] if ws else None
    sec_w = ws[1]["weapon_id"] if len(ws) > 1 else None
    perk = out.get("perk") or None
    sr, kr = policy["secondary"], policy["perk"]
    # Round-3 MERGE-4 (2026-09-13): drop an UNPLAYABLE pick BEFORE the fallback chain. `prim not in
    # lp["primary"]` is already true for one (the pool never offers it), but the chain's last resort is
    # `prim or "assault_rifle"` — which KEEPS the stored id whenever the pool came out empty, which is
    # exactly the fixed-to-`energy_launcher` case. The loadout then carried a weapon
    # `compile.validate()` refuses as unkillable, so the push died naming a weapon the Designer no
    # longer offers and no control on screen could change it (the F146 shape). `UNPLAYABLE_IDS` is OUR
    # build's limitation, not the operator's mistake: the slot falls to a legal weapon and the
    # `unplayable` pool reason explains what happened.
    if prim in UNPLAYABLE_IDS:
        prim = None
    if sec_w in UNPLAYABLE_IDS:
        sec_w = None
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
    # S50: the ALT-button pairing moved from perk+weapon to override+weapon (see the docstring above).
    # `out` is `dict[str, Any]` (a `copy.deepcopy(loadout)` worked on by runtime key, like `base` in
    # `merge()` above) so `out.get("overrides")` carries no static shape of its own; `cast` says
    # "this is a `LoadoutOverrides`, on my authority" the same way `merge()`'s own final return does.
    ov = cast(LoadoutOverrides, dict(out.get("overrides") or {}))
    if ov.get("easy_reload"):
        # F123 first: a primary is mandatory, so if the (already policy-resolved) primary chain-reloads,
        # the OVERRIDE gives way, not the weapon.
        if chain_reload(_weapon_row(weapons, prim) or {"weapon_id": prim}):
            ov.pop("easy_reload", None)
        elif sec_w:
            sec_w = None
    if ov != (out.get("overrides") or {}):
        if ov:
            out["overrides"] = ov
        else:
            out.pop("overrides", None)
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

    S50: `overrides.easy_reload` is host-set only (`state._check_loadout`), never a `loadout_request`
    pick, so the old F123 chain-reload check that lived here (asked whenever the REQUEST was a perk id
    of `easy_reload`) has nothing to fire on any more — no perk carries `effects.alt_reload`, and the
    override cannot arrive through this channel. `loadout` stays a parameter for callers that already
    pass one; it is not read below."""
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
            if swaps_weapons(_perk_row(perks, rid)) and not lp["secondary_weapons"]:
                return False, _R_NO_SWITCH.format(perk=_name(perks, "perk_id", rid))   # S37
            return False, _why_not(rule, perks, "perk_id", rid, "perk")
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
    """Write one slot of a loadout (already validated). Returns a NEW dict.

    S50: Easy Reload moved to `overrides.easy_reload`, which this channel never writes (it is host-set
    only, `state._check_loadout`) — so a `loadout_request` pick can no longer create or resolve the
    ALT-button conflict; the old per-pick drop logic (perk over weapon / weapon over perk) is gone with
    it. `overrides` rides through untouched, same as before.

    `weapons` is the catalog IN PLAY (kept for callers that already pass it; no longer read here since
    the chain-reload question moved to `apply`/`validate_loadout`)."""
    out: dict[str, Any] = dict(copy.deepcopy(loadout))
    ws = list(out.get("weapons") or [])
    prim = ws[0]["weapon_id"] if ws else "assault_rifle"
    sec_w = ws[1]["weapon_id"] if len(ws) > 1 else None
    perk = out.get("perk") or None
    if slot == "primary":
        prim = rid
        # `check_request` refuses kind="none"/slot="primary" (a primary is mandatory) before a caller
        # ever reaches here, so `rid` is never None on this path -- narrowed for the WeaponSel below,
        # rather than the wire silently getting a weapon_id of None if that contract were ever violated.
        assert prim is not None
    elif slot == "secondary":
        sec_w = rid if kind == "weapon" else None
    else:
        perk = rid if kind == "perk" else None
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
    """What a `set_slot` knocked out of the OTHER slot, as `loadout_ack.dropped {slot, id, name}` + the reason line.

    S50: with Easy Reload moved to the host-only `overrides.easy_reload`, `set_slot` (the phone's
    `loadout_request` writer) can no longer create the ALT-button conflict, so there is nothing left
    for THIS function to report — a phone pick only ever moves `weapons`/`perk`, never `overrides`."""
    return None, None


def node_view(policy: LoadoutPolicy, lp: LoadoutPool) -> dict:
    """The per-player `assign.policy` the phone renders from (§4.1)."""
    return {"hud_select": bool(policy.get("hud_select")),
            "primary": {"choice": policy["primary"]["choice"], "allowed_ids": list(lp["primary"])},
            "secondary": {"choice": policy["secondary"]["choice"], "kinds": list(policy["secondary"]["kinds"]),
                          "allowed_weapon_ids": list(lp["secondary_weapons"])},
            "perk": {"choice": policy["perk"]["choice"], "allowed_perk_ids": list(lp["perks"])}}
