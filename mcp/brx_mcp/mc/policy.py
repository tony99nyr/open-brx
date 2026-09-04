"""M-LOADOUT loadout policy (docs/spec/loadout.md §3) — the ONE rule engine.

Who may pick what, per slot. Presets are named here; the derived pool (allowed ids per slot) is
computed once server-side and published in `State.loadout_pool` + each node's `assign.policy`, so
neither UI carries rule logic. Everything returns plain dicts (contracts shapes) — no classes to share.

A14 (2026-09-04, Tony: "you should be able to have AR and pistol and quick switch perk"): a perk is its
OWN slot, not a thing that displaces the secondary weapon. Three rules — `primary`, `secondary`
(weapons / sidearms only) and `perk`. The one hardware exception: a perk that takes the ALT button
(`effects.alt_reload`, Easy Reload) leaves no button to switch weapons with, so it cannot ride with a
second weapon — the server drops the other one and says so; the UIs warn before the tap.
No pre-A14 shape is read (FOLLOWUPS S6, Tony: "we dont need to support legacy at all"): a stored policy that
still says "perk" inside `secondary.kinds` is a validation error and `normalize` falls back to the mode default.
"""
from __future__ import annotations

import copy

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
# `loadout_ack.reason` when a pick applied but knocked the other thing out (A14 §4.2)
_R_DROPPED_WEAPON = "{perk} takes the ALT button — {weapon} dropped"
_R_DROPPED_PERK = "{weapon} needs the ALT button to switch — {perk} dropped"


def takes_alt(row: dict | None) -> bool:
    """Does this perk claim the ALT button (`effects.alt_reload`)? Then no second weapon can be switched to."""
    return bool(((row or {}).get("effects") or {}).get("alt_reload"))


def _rule(choice="player", kinds=("weapon",), exclude_tags=(), exclude_ids=(), only_ids=(), fixed_id=None) -> dict:
    return {"choice": choice, "kinds": list(kinds), "exclude_tags": list(exclude_tags),
            "exclude_ids": list(exclude_ids), "only_ids": list(only_ids), "fixed_id": fixed_id}


def preset_rules(name: str) -> dict:
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


def default_policy(mode: str) -> dict:
    return preset_rules(MODE_DEFAULT_PRESET.get(mode, "open"))


def _matches_preset(pol: dict, name: str) -> bool:
    ref = preset_rules(name)
    return all(pol.get(k) == ref[k] for k in ("hud_select", "primary", "secondary", "perk"))


def _check_rule(slot: str, r) -> dict:
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


def merge(current: dict | None, patch: dict) -> dict:
    """Apply a partial policy patch (§3). A `preset` name REWRITES the rules; a rule edit that no longer
    matches a preset flips `preset` to `custom`."""
    if not isinstance(patch, dict):
        raise ValueError("loadout_policy must be an object")
    base = copy.deepcopy(current) if current else preset_rules("open")
    for slot in SLOTS:
        base.setdefault(slot, preset_rules("open")[slot])
    pname = patch.get("preset")
    if pname is not None:
        if pname not in PRESET_NAMES:
            raise ValueError(f"loadout_policy.preset must be one of {PRESET_NAMES}")
        if pname != "custom":
            base = preset_rules(pname)
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
    if pname == "custom":
        base["preset"] = "custom"
    else:
        base["preset"] = next((n for n in ("open", "no_heavies", "snipers") if _matches_preset(base, n)), "custom")
    return base


def normalize(pol: dict | None, mode: str = "tdm") -> dict:
    """A stored config may predate policies (session.json) or carry a shape this engine no longer reads — the mode default then."""
    if not pol:
        return default_policy(mode)
    try:
        return merge(preset_rules("open"), pol)
    except ValueError:
        return default_policy(mode)


# ---- pool ---------------------------------------------------------------------
def _filter(rule: dict, rows: list[dict], id_key: str) -> list[str]:
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


def weapon_kind_rows(rule: dict, weapons: list[dict]) -> list[dict]:
    """The weapon rows a slot's `kinds` admits BEFORE the tag/id filters: "weapon" = every visible
    weapon (a pistol is a weapon too); "sidearm" alone = only the `sidearm`-tagged rows; neither = none."""
    kinds = rule.get("kinds") or ()
    if "weapon" in kinds:
        return list(weapons)
    if SIDEARM_TAG in kinds:
        return [w for w in weapons if SIDEARM_TAG in set(w.get("tags") or ())]
    return []


def admits_weapons(rule: dict) -> bool:
    return bool({"weapon", SIDEARM_TAG} & set(rule.get("kinds") or ()))


def pool(policy: dict, weapons: list[dict], perks: list[dict]) -> dict:
    """Allowed ids per slot (catalog order) — `State.loadout_pool` (§3.2). `weapons`/`perks` are the
    VISIBLE catalog rows (each with `tags`)."""
    prim, sec, pr = policy["primary"], policy["secondary"], policy["perk"]
    if prim["choice"] == "fixed":
        primary = [prim["fixed_id"]] if any(w["weapon_id"] == prim["fixed_id"] for w in weapons) else []
    else:
        primary = _filter(prim, weapon_kind_rows(prim, weapons), "weapon_id")
    if sec["choice"] == "off":
        sw = []
    elif sec["choice"] == "fixed":
        sw = [sec["fixed_id"]] if any(w["weapon_id"] == sec["fixed_id"] for w in weapons) else []
    else:
        sw = _filter(sec, weapon_kind_rows(sec, weapons), "weapon_id")
    if pr["choice"] == "off":
        sp = []
    elif pr["choice"] == "fixed":
        sp = [pr["fixed_id"]] if any(p["perk_id"] == pr["fixed_id"] for p in perks) else []
    else:
        sp = _filter(pr, perks, "perk_id")
    return {"primary": primary, "secondary_weapons": sw, "perks": sp}


# ---- validation / auto-apply ------------------------------------------------------
def _name(rows: list[dict], key: str, rid: str) -> str:
    return next((r["name"] for r in rows if r[key] == rid), rid)


def _perk_row(perks: list[dict], pid: str | None) -> dict | None:
    return next((p for p in perks if p.get("perk_id") == pid), None) if pid else None


def conflict(loadout: dict, perks: list[dict]) -> dict | None:
    """A14: the perk takes the ALT button AND a second weapon is loaded → `{perk, weapon}` (ids); else None."""
    lo = loadout or {}
    ws = lo.get("weapons") or []
    sec_w = ws[1]["weapon_id"] if len(ws) > 1 else None
    perk = lo.get("perk") or None
    if sec_w and perk and takes_alt(_perk_row(perks, perk)):
        return {"perk": perk, "weapon": sec_w}
    return None


def _why_not(rule: dict, rows: list[dict], key: str, rid: str, slot: str = "secondary") -> str:
    r = next((x for x in rows if x[key] == rid), None)
    if r is None:
        return _R_UNKNOWN.format(kind="weapon" if key == "weapon_id" else "perk")
    kinds = set(rule.get("kinds") or ())
    if key == "weapon_id" and SIDEARM_TAG in kinds and "weapon" not in kinds and SIDEARM_TAG not in set(r.get("tags") or ()):
        return _R_SIDEARM_ONLY.format(slot=slot)
    if "heavy" in set(rule.get("exclude_tags") or ()) and "heavy" in set(r.get("tags") or ()):
        return _R_HEAVY
    return _R_NOT_ALLOWED.format(name=r["name"])


def validate_loadout(policy: dict, lp: dict, loadout: dict, weapons: list[dict], perks: list[dict]) -> tuple[bool, str | None]:
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
            return False, _R_FIXED.format(what="Primary", name=_name(weapons, "weapon_id", pr["fixed_id"]))
        return False, _why_not(pr, weapons, "weapon_id", prim, "primary")
    if sr["choice"] == "off" and sec_w:
        return False, _R_OFF
    if sr["choice"] == "fixed" and sec_w != sr["fixed_id"]:
        return False, _R_FIXED.format(what="Secondary", name=_name(weapons, "weapon_id", sr["fixed_id"]))
    if sec_w and sec_w not in lp["secondary_weapons"]:
        if not admits_weapons(sr):
            return False, _R_KIND.format(kind="A weapon", slot="secondary")
        return False, _why_not(sr, weapons, "weapon_id", sec_w)
    if kr["choice"] == "off" and perk:
        return False, _R_NO_PERKS
    if kr["choice"] == "fixed" and perk != kr["fixed_id"]:
        return False, _R_FIXED.format(what="Perk", name=_name(perks, "perk_id", kr["fixed_id"]))
    if perk and perk not in lp["perks"]:
        return False, _why_not(kr, perks, "perk_id", perk, "perk")
    c = conflict(loadout, perks)
    if c:
        return False, _R_ALT_BOTH.format(perk=_name(perks, "perk_id", c["perk"]))
    return True, None


def apply(policy: dict, lp: dict, loadout: dict, weapons: list[dict], perks: list[dict]) -> dict:
    """Auto-fix a loadout to the policy (§3.3): fixed → set; off → cleared; out-of-pool → primary falls to
    the first allowed weapon (assault_rifle when allowed), secondary / perk cleared. An ALT-button perk
    beside a second weapon keeps the perk (the host's rule put it there) and drops the weapon. Returns a NEW dict."""
    out = copy.deepcopy(loadout or {})
    ws = list(out.get("weapons") or [])
    prim = ws[0]["weapon_id"] if ws else None
    sec_w = ws[1]["weapon_id"] if len(ws) > 1 else None
    perk = out.get("perk") or None
    sr, kr = policy["secondary"], policy["perk"]
    if prim not in lp["primary"]:
        prim = ("assault_rifle" if "assault_rifle" in lp["primary"] else (lp["primary"][0] if lp["primary"] else prim or "assault_rifle"))
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
    out["weapons"] = [{"weapon_id": prim}] + ([{"weapon_id": sec_w}] if sec_w else [])
    if perk:
        out["perk"] = perk
    else:
        out.pop("perk", None)
    return out


def check_request(policy: dict, lp: dict, slot: str, kind: str, rid: str | None,
                  weapons: list[dict], perks: list[dict]) -> tuple[bool, str | None]:
    """Phone-side check for a `loadout_request` (§4.2)."""
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


def set_slot(loadout: dict, slot: str, kind: str, rid: str | None, perks: list[dict] = ()) -> dict:
    """Write one slot of a loadout (already validated). The thing just picked wins an ALT-button conflict:
    Easy Reload over a second weapon drops the weapon; a second weapon over Easy Reload drops the perk
    (Tony 2026-09-04: "when you pick that it will invalidate your secondary gun selection"). Returns a NEW dict."""
    out = copy.deepcopy(loadout or {"weapons": []})
    ws = list(out.get("weapons") or [])
    prim = ws[0]["weapon_id"] if ws else "assault_rifle"
    sec_w = ws[1]["weapon_id"] if len(ws) > 1 else None
    perk = out.get("perk") or None
    if slot == "primary":
        prim = rid
    elif slot == "secondary":
        sec_w = rid if kind == "weapon" else None
        if sec_w and perk and takes_alt(_perk_row(perks, perk)):
            perk = None
    else:
        perk = rid if kind == "perk" else None
        if perk and sec_w and takes_alt(_perk_row(perks, perk)):
            sec_w = None
    out["weapons"] = [{"weapon_id": prim}] + ([{"weapon_id": sec_w}] if sec_w else [])
    if perk:
        out["perk"] = perk
    else:
        out.pop("perk", None)
    return out


def dropped_by(before: dict, after: dict, weapons: list[dict], perks: list[dict]) -> tuple[dict | None, str | None]:
    """What a `set_slot` knocked out of the OTHER slot, as `loadout_ack.dropped {slot, id, name}` + the reason line."""
    b_ws, a_ws = (before or {}).get("weapons") or [], (after or {}).get("weapons") or []
    b_sec = b_ws[1]["weapon_id"] if len(b_ws) > 1 else None
    a_sec = a_ws[1]["weapon_id"] if len(a_ws) > 1 else None
    b_perk, a_perk = (before or {}).get("perk") or None, (after or {}).get("perk") or None
    if b_sec and not a_sec and a_perk and a_perk != b_perk:
        wname = _name(weapons, "weapon_id", b_sec)
        return {"slot": "secondary", "id": b_sec, "name": wname}, _R_DROPPED_WEAPON.format(perk=_name(perks, "perk_id", a_perk), weapon=wname)
    if b_perk and not a_perk and a_sec and a_sec != b_sec:
        pname = _name(perks, "perk_id", b_perk)
        return {"slot": "perk", "id": b_perk, "name": pname}, _R_DROPPED_PERK.format(weapon=_name(weapons, "weapon_id", a_sec), perk=pname)
    return None, None


def node_view(policy: dict, lp: dict) -> dict:
    """The per-player `assign.policy` the phone renders from (§4.1)."""
    return {"hud_select": bool(policy.get("hud_select")),
            "primary": {"choice": policy["primary"]["choice"], "allowed_ids": list(lp["primary"])},
            "secondary": {"choice": policy["secondary"]["choice"], "kinds": list(policy["secondary"]["kinds"]),
                          "allowed_weapon_ids": list(lp["secondary_weapons"])},
            "perk": {"choice": policy["perk"]["choice"], "allowed_perk_ids": list(lp["perks"])}}
