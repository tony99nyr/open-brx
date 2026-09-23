"""UI/phone view shapes built from contracts rows (API.md `WeaponView`) — one builder for HTTP + the wire."""
from __future__ import annotations

import math

from typing import Sequence

from .compile import CHARGE_TAP_CADENCE_MS, DEFAULT_POOL, hir_from_weap
from .types import Weapon, WeaponView

# The pool one hit is measured against when the caller does not say: 45 HP + 70 armour (GameConfig
# defaults). `stats.dmg` in weapons.json is the SHARE of that pool a single hit removes.
POOL = DEFAULT_POOL

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


def _num(v):
    """`v` when it is a real number, else None. Guards every derived stat below.

    The HTTP route falls back to fakes on error, but `_catalog_views` (every hydrate/bind) has no
    such net — a non-numeric stat must not break node assignment.
    """
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    return v if not isinstance(v, float) or math.isfinite(v) else None


def weapon_view(w: Weapon, pool: int = DEFAULT_POOL) -> WeaponView:
    """contracts §3 `Weapon` → API.md `WeaponView`. A10 adds `tags` + `role`.

    Emits the REAL numbers (damage per hit, reload seconds, mag/reserve, hits- and time-to-kill).
    `bars` is added by `weapon_views` once the whole arsenal is known — a single weapon cannot be
    ranked against weapons it has not seen.

    `pool` is the host's CURRENT health config (hp + armour), not the 115 default: hits-to-kill and
    time-to-kill move with it (docs/weapon-design.md §2.5 — at a 100/100 pool the AR needs 23 hits,
    not 13). Field 2026-08-30 shipped both screens quoting 13/1.68 s whatever the host had set.
    `dmg` is the one stat that cannot follow, because its definition IS "share of a 115 pool"; the
    pool-independent magnitude is `dmg_per_hit`.
    """
    st = w.get("stats", {}) or {}
    mag = max(0, int(_num(st.get("mag")) or 0))
    reserve_num = _num(st.get("reserve"))
    reserve = max(0, int(reserve_num)) if reserve_num is not None else None
    reload_num = _num(st.get("reload_ms"))
    reload_ms = max(0, int(reload_num)) if reload_num is not None else None
    dmg_num = _num(st.get("dmg"))
    rpm = _num(st.get("rof", st.get("rpm", 50)))
    rng = _num(st.get("rng", st.get("range_pct", 50)))
    pool = max(1, int(_num(pool) or DEFAULT_POOL))   # a non-positive pool would publish htk 0
    # The real per-hit magnitude ($WEAP t5). Synthetic catalogs (fakes, test rows) carry no `dmg_hit`;
    # for THEM `dmg` is read back as the 115-pool share it is defined to be — which is how the real
    # one was derived — but that is a display fallback only. htk is NOT derived from it: the demo
    # catalog's `damage` is an old decorative 0-100 bar on no scale at all, and inventing a magnitude
    # from it would put a confident wrong number on the screen. Scale its published htk instead —
    # htk is proportional to the pool, whatever the damage behind it was.
    real_hit = _num(st.get("dmg_hit"))
    dmg_hit = real_hit if real_hit is not None else (
        round(DEFAULT_POOL * dmg_num / 100) if dmg_num is not None else None)
    published = _num(st.get("htk"))
    # F225/F226/S43 (2026-09-17): a CELL weapon (the Charge Rifle) counts TRIGGER ACTIONS, not
    # equal-sized hits -- one charge (`real_hit`) plus however many taps (`tap_dmg`) close the rest of
    # `pool`. `WeaponCatalog.hits_to_kill()`/`time_to_kill()` do the same maths server-side at the
    # default pool; this redoes it here because the view must recompute at whatever pool the HOST set
    # (W2), and a synthetic/demo row carries no `tap_dmg` at all (falls through to the plain branch).
    tap_dmg = _num(st.get("tap_dmg"))
    if real_hit and tap_dmg:
        htk = 1 if pool <= real_hit else 1 + math.ceil((pool - real_hit) / tap_dmg)
    elif real_hit:
        htk = math.ceil(pool / real_hit)
    elif published:
        htk = max(1, math.ceil(published * pool / DEFAULT_POOL))
    else:
        htk = published
    cycle = _num(st.get("cycle_ms"))
    if tap_dmg and htk:
        # release-to-kill: the pre-built charge lands at zero delay, only the taps that follow cost time
        ttk_ms = (htk - 1) * CHARGE_TAP_CADENCE_MS
    elif htk and cycle and "charged" in st:
        ttk_ms = int(round(cycle * (htk if st["charged"] else htk - 1)))
    else:
        # no derivation chain (a synthetic row): the published figure still holds at the pool it was
        # published for, and is a lie at any other. Show nothing rather than the wrong number.
        ttk_ms = _num(st.get("ttk_ms")) if pool == DEFAULT_POOL else None
    view: WeaponView = {"weapon_id": w["weapon_id"], "name": w["name"], "cls": w.get("cls", ""),
            "weapon_class": w.get("weapon_class", "ballistic"), "desc": w.get("desc", ""),
            "clip": mag, "mags": ((reserve or 0) // max(mag, 1)),
            "reserve": reserve,
            # None, not 0.0: a missing reload time must read "—", not a confident "RELOAD 0.0S"
            "reload_s": round(reload_ms / 1000, 1) if reload_ms else None,
            "reload_ms": reload_ms,
            "dmg": dmg_num, "rpm": rpm,
            "rng": rng,
            # real, human-facing numbers (the bars above are only for ranking)
            "dmg_per_hit": dmg_hit,
            "dual_emitter": bool(w.get("dual_emitter")),
            "pool": pool,
            "verified": bool(w.get("verified")),
            "tags": list(w.get("tags") or []), "role": w.get("role", ""),
            "htk": htk, "ttk_ms": ttk_ms}                                       # A10, now at the host's pool
    # A48: the cost of one full charge, for the HUD's NOT ENOUGH ENERGY line. Resolved, not raw: the
    # catalogue omits the key wherever it is 1 (`_note`: "Absent = 1"), and a consumer must never have to
    # know that. `WeaponCatalog.rounds_per_charge()` is the same rule in the one place it belongs.
    view["rounds_per_charge"] = int(w.get("rounds_per_charge") or 1)
    if caution := w.get("caution"):
        view["caution"] = caution                                      # A10: known live problem
    if w.get("pickup_only"):
        view["pickup_only"] = True                    # 2026-09-17: catalogue-visible, never in a loadout pool
    if w.get("lethal") is False:
        # 2026-09-18 (weapon-design.md §7.4): this weapon deliberately cannot kill and may never be a
        # PRIMARY. Both UIs mirror that rule client-side, so the field has to travel with the row or the
        # console happily offers an operator a pick the server refuses at arming.
        view["lethal"] = False
    if recoil := w.get("recoil"):
        view["recoil"] = recoil                         # S42: the declared target profile -- the node's only source of it
    if (crit_pct := w.get("crit_pct")) is not None:
        view["crit_pct"] = crit_pct                      # F62 (2026-09-18): the declared t6 crit chance
    # S56 ("what hit me"): the base `$HIR` t5 magnitudes this weapon can emit, read off the SAME
    # `weap_frame` the row already carries (`WeaponCatalog._to_weapon()`), so this never re-resolves
    # the catalogue a second time or drifts from it. `.get` and a str() guard: a synthetic/demo row
    # (fakes, hand-built test fixtures) can carry no `weap_frame` at all, and this view must degrade,
    # never raise -- it runs on every hydrate and bind with no fallback behind it.
    frame = w.get("weap_frame")
    view["hir"] = hir_from_weap(frame) if isinstance(frame, str) else []
    return view


def weapon_views(catalog: Sequence[Weapon], pool: int = DEFAULT_POOL) -> list[WeaponView]:
    """Every weapon as a `WeaponView`, plus a `bars` block ranked ACROSS the arsenal.

    bars.power  — damage per hit, ranked (weapons.json `dmg`)
    bars.rof    — cycle rate, ranked (weapons.json `rof`, already relative to the fastest gun)
    bars.ammo   — rounds carried (mag + reserve), ranked
    bars.ttk    — kill SPEED, ranked and INVERTED, so a faster kill is a longer bar
    Range is absent on purpose: it is identical on every gun on the wire.
    """
    views = [weapon_view(w, pool) for w in catalog]
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
    ammo = _rank_bars([v.get("ammo_total") for v in views])
    # inverted: the QUICKEST kill must get the fullest bar
    ttk = _rank_bars([kill_ms(v) for v in views], invert=True)
    for i, v in enumerate(views):
        v["bars"] = {"power": power[i], "rof": rof[i], "ammo": ammo[i], "ttk": ttk[i]}
    return views
