"""UI/phone view shapes built from contracts rows (API.md `WeaponView`) — one builder for HTTP + the wire."""
from __future__ import annotations

# The pool one hit is measured against: 45 HP + 70 armour (GameConfig defaults). `stats.dmg` in
# weapons.json is the SHARE of that pool a single hit removes, so damage-per-hit = pool * dmg/100.
POOL = 115

# Field 2026-08-30 (first live match): every damage meter read near-empty and all 18 weapons looked
# identical. Nothing was miscomputed — `stats.dmg` really is 7–11 ("% of a 115 pool per hit"), so a
# raw 0–100 bar can only ever fill a tenth of the way. A bar has one job: rank this weapon against
# the others. So bars are normalised across the ARSENAL, and the real numbers ship beside them.
# `rng` is deliberately NOT a bar: t41 gunRange is identical on all 18 guns (weapons.json _note,
# weapon-design.md §4.2), so a range meter shows the same 75 for everything and is pure noise.
BAR_FLOOR = 20   # the weakest weapon still reads as a bar, not as an empty trough


def _rank_bars(values: list[float | None], invert: bool = False) -> list[int | None]:
    """Map each value onto BAR_FLOOR..100 by its RANK among the distinct values present.

    Linear min-max was the obvious choice and it did not work: this arsenal has extreme outliers (a
    rocket hits for 115, an assault rifle for 9), so on a linear scale every ordinary weapon collapsed
    into the bottom fifth — Assault Rifle 21, Bolt Rifle 23, Energy Rifle 21 — which is the same
    "it looks super low for all" the bars were rewritten to fix, just less severe. A meter's only job
    is to say *where this weapon sits among the others*, and the true magnitudes are printed beside it,
    so rank spreads the scale over the weapons a player actually chooses between. Equal values share a
    rank; a single distinct value gives everything a flat 60.
    """
    present = sorted({v for v in values if v is not None})
    if not present:
        return [None] * len(values)
    if len(present) == 1:
        return [None if v is None else 60 for v in values]
    order = {v: i for i, v in enumerate(present if not invert else list(reversed(present)))}
    span = len(present) - 1
    return [None if v is None else round(BAR_FLOOR + (100 - BAR_FLOOR) * order[v] / span) for v in values]


def weapon_view(w: dict) -> dict:
    """contracts §3 `Weapon` → API.md `WeaponView`. A10 adds `tags` + `role`.

    Emits the REAL numbers (damage per hit, reload seconds, mag/reserve, hits- and time-to-kill).
    `bars` is added by `weapon_views` once the whole arsenal is known — a single weapon cannot be
    ranked against weapons it has not seen.
    """
    st = w.get("stats", {}) or {}
    mag = st.get("mag") or 0
    dmg = st.get("dmg", st.get("damage", 50))
    dmg_num = dmg if isinstance(dmg, (int, float)) and not isinstance(dmg, bool) else None
    return {"weapon_id": w["weapon_id"], "name": w["name"], "cls": w.get("cls", ""), "desc": w.get("desc", ""),
            "clip": mag, "mags": ((st.get("reserve") or 0) // max(mag or 1, 1)),
            "reserve": st.get("reserve"), "reload_s": round((st.get("reload_ms") or 0) / 1000, 1),
            "reload_ms": st.get("reload_ms"),
            "dmg": dmg, "rpm": st.get("rof", st.get("rpm", 50)),
            "rng": st.get("rng", st.get("range_pct", 50)),
            # real, human-facing numbers (the bars above are only for ranking)
            # guarded: the HTTP route falls back to fakes on error, but `_catalog_views` (every
            # hydrate/bind) has no such net — a non-numeric `dmg` must not break node assignment.
            "dmg_per_hit": round(POOL * dmg_num / 100) if dmg_num is not None else None,
            "pool": POOL,
            "verified": bool(w.get("verified")),
            "tags": list(w.get("tags") or []), "role": w.get("role", ""),
            "htk": st.get("htk"), "ttk_ms": st.get("ttk_ms"),                    # A10 (htk: hits to drop a 115 pool)
            **({"caution": w["caution"]} if w.get("caution") else {})}           # A10: known live problem


def weapon_views(catalog: list[dict]) -> list[dict]:
    """Every weapon as a `WeaponView`, plus a `bars` block ranked ACROSS the arsenal.

    bars.power  — damage per hit, ranked (weapons.json `dmg`)
    bars.rof    — cycle rate, ranked (weapons.json `rof`, already relative to the fastest gun)
    bars.ammo   — rounds carried (mag + reserve), ranked
    bars.ttk    — kill SPEED, ranked and INVERTED, so a faster kill is a longer bar
    Range is absent on purpose: it is identical on every gun on the wire.
    """
    views = [weapon_view(w) for w in catalog]
    if not views:
        return views

    def kill_ms(v):
        """TTK for ranking, or None when the weapon has no meaningful one.

        A one-shot weapon stores `ttk_ms: 0` (it is `(htk-1) * fire_ms`, and htk is 1). Ranked as a
        number that reads as *instant*, which handed the Energy Launcher — the weapon flagged as
        dealing no damage at all — a full 100 KILL SPEED bar. A weapon that kills in one hit has no
        time-to-kill to compare; it shows no bar rather than the best one.
        """
        t = v.get("ttk_ms")
        return None if not t else t

    for v in views:
        v["ammo_total"] = (v["clip"] or 0) + (v["reserve"] or 0)
    power = _rank_bars([v["dmg"] for v in views])
    rof = _rank_bars([v["rpm"] for v in views])
    ammo = _rank_bars([v["ammo_total"] for v in views])
    # inverted: the QUICKEST kill must get the fullest bar
    ttk = _rank_bars([kill_ms(v) for v in views], invert=True)
    for i, v in enumerate(views):
        v["bars"] = {"power": power[i], "rof": rof[i], "ammo": ammo[i], "ttk": ttk[i]}
    return views
