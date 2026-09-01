"""Every published weapon number must be derivable from the frame we actually ship.

W3, handoff-post-first-match. The two worst defects of the 2026-08-30 field session were **numbers
that disagreed with other numbers in the same repo** — `weapons.json` shipped the Assault Rifle at
`rof: 53` against a derived 54, and `docs/weapon-design.md` §2.2's DPS/sustained columns were stale
for the same weapon. Both were hand-edited, both were found by a person reading a screen. Nothing
here needs hardware, and a machine should be checking it.

Three ledgers, one source of truth (`WeaponCatalog.resolve()` — the literal `$WEAP` frame MC pushes):

  1. `weapons.json`'s `stats` block  — `dmg`, `rof`, `rng`, `htk`, `ttk_ms`
  2. `docs/weapon-design.md` §2.2    — the balance table, DPS and sustained DPS included
  3. `docs/weapon-design.md` §2.5    — hits-to-kill at four health configs (this is what W2 fixed:
                                       the UIs used to quote the 115 column whatever the host set)

If a test here fails, the frame is right and the number beside it is stale. Fix the number.
"""
import json
import math
import pathlib
import re

from brx_mcp.mc.compile import DEFAULT_POOL, WeaponCatalog
from brx_mcp.mc.views import weapon_views

ROOT = pathlib.Path(__file__).resolve().parents[2]
DESIGN = ROOT / "docs" / "weapon-design.md"
ROWS = json.loads((ROOT / "mcp" / "brx_mcp" / "mc" / "weapons.json").read_text())["weapons"]
CAT = WeaponCatalog()


def _tok(weapon_id: str, key: str) -> str:
    """One named doc token of the shipped frame, as text."""
    return CAT.resolve(weapon_id, 0).split(",")[WeaponCatalog._T[key] + 1]


# ---------------------------------------------------------------- 1. weapons.json


def test_shipped_stats_are_derived_from_the_shipped_frame():
    """`dmg`/`rof`/`rng`/`htk`/`ttk_ms` are documentation of the frame. Recompute all five."""
    bad = []
    for w in ROWS:
        wid = w["weapon_id"]
        want = {"dmg": CAT.damage_bar(wid), "rof": CAT.rate_of_fire(wid),
                "rng": int(_tok(wid, "range") or 0),
                "htk": CAT.hits_to_kill(wid, DEFAULT_POOL),
                "ttk_ms": CAT.time_to_kill(wid, DEFAULT_POOL)}
        for k, v in want.items():
            if w.get(k) != v:
                bad.append(f"{wid}.{k}: weapons.json says {w.get(k)!r}, the frame derives {v!r}")
    assert not bad, "hand-edited weapon stats disagree with the wire:\n  " + "\n  ".join(bad)


def test_the_frame_builder_does_not_lose_an_ammo_value():
    """Not a check on `weapons.json` — `resolve()` writes these FROM it, so it cannot catch a bad
    number there (§2.2's test does). What it catches is the FRAME BUILDER dropping or misplacing a
    write: a missing `reload`, a `clipstart` off by one, a `reserve_half` that stops mirroring."""
    bad = []
    for w in ROWS:
        wid = w["weapon_id"]
        for key, want in (("mag", w["mag"]), ("clipstart", w["mag"]),
                          ("reserve", w["reserve"]), ("reserve_half", w["reserve"] // 2),
                          ("reload", w["reload_ms"])):
            got = int(_tok(wid, key) or 0)
            if got != want:
                bad.append(f"{wid} t{WeaponCatalog._T[key]}: frame has {got}, weapons.json says {want}")
    assert not bad, "\n  ".join(bad)


def test_every_weapon_has_a_derivable_damage_and_cycle():
    """A weapon with no t5 or no t14 silently disables every check above — catch it directly."""
    for w in ROWS:
        wid = w["weapon_id"]
        assert CAT.damage(wid) > 0, f"{wid}: no damage on the wire"
        assert CAT.fire_ms(wid) > 0, f"{wid}: no fire interval on the wire"
        assert CAT.cycle_ms(wid) > 0, f"{wid}: no cycle"


def test_burst_and_charge_classification_matches_the_frame():
    """The two behaviours `cycle_ms`/`time_to_kill` branch on, pinned against t20 so a re-capture
    that changes a fire mode cannot quietly change a published TTK."""
    burst = {w["weapon_id"] for w in ROWS
             if int(_tok(w["weapon_id"], "mode") or 0) == WeaponCatalog._BURST_MODE}
    charge = {w["weapon_id"] for w in ROWS
              if int(_tok(w["weapon_id"], "mode") or 0) in WeaponCatalog._CHARGE_MODES}
    assert burst == {"burst_rifle", "force_rifle"}, burst
    assert charge == {"charge_rifle", "rail_gun", "laser_cannon"}, charge
    # a burst weapon sustains SLOWER than its t14, and that is the whole point of cycle_ms
    for wid in burst:
        assert CAT.cycle_ms(wid) > CAT.fire_ms(wid), wid
    # a charge weapon pays for its FIRST shot, so even a one-shot kill has a non-zero TTK
    for wid in charge:
        assert CAT.time_to_kill(wid, DEFAULT_POOL) > 0, wid


# ---------------------------------------------------------------- 2. weapon-design.md §2.2


def _table(after: str) -> list[list[str]]:
    """The first markdown table following `after` in weapon-design.md, as rows of cells."""
    text = DESIGN.read_text()
    assert after in text, f"weapon-design.md has no heading {after!r} any more — this test parses it by name"
    body = text.split(after, 1)[1]
    rows = []
    for line in body.splitlines():
        line = line.strip()
        if not line.startswith("|"):
            if rows:
                break
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if set("".join(cells)) <= set("-: "):
            continue                                    # the header separator
        rows.append(cells)
    return rows


def _by_name() -> dict[str, str]:
    return {w["name"].lower(): w["weapon_id"] for w in ROWS}


def _cell(v: str) -> str:
    return v.replace("**", "").replace("*", "").strip()


def test_weapon_design_balance_table_matches_the_wire():
    """§2.2 is the balance table a human reads. Every numeric column is recomputed here.

    `dps` is damage per cycle second; `sust` folds one reload into a whole magazine — the two
    columns that were stale for the AR after the 2026-08-30 retune, because nothing recomputed them.
    """
    rows = _table("### 2.2 The table")
    header = [_cell(c).lower() for c in rows[0]]
    ix = {name: header.index(name) for name in
          ("weapon", "dmg", "cycle ms", "htk", "ttk s", "dps", "sust", "mag", "reserve", "reload",
           "mag/total kills", "heat")}
    by_name, seen, bad = _by_name(), set(), []
    for r in rows[1:]:
        name = _cell(r[ix["weapon"]]).lower()
        wid = by_name.get(name)
        assert wid, f"§2.2 lists a weapon that is not in weapons.json: {name!r}"
        seen.add(wid)
        row = next(w for w in ROWS if w["weapon_id"] == wid)
        dmg, cycle, htk = CAT.damage(wid), CAT.cycle_ms(wid), CAT.hits_to_kill(wid, DEFAULT_POOL)
        mag, reserve, reload_ms = row["mag"], row["reserve"], row["reload_ms"]
        # "100 +250" on a burst weapon: the intra-burst interval and the gap after the burst
        gap = int(_tok(wid, "burst") or 0)
        cycle_txt = f"{CAT.fire_ms(wid)} +{gap}" if wid in ("burst_rifle", "force_rifle") else str(CAT.fire_ms(wid))
        heat = int(_tok(wid, "heat") or 0)
        want = {
            "dmg": str(dmg),
            "cycle ms": cycle_txt,
            "htk": str(htk),
            "ttk s": f"{CAT.time_to_kill(wid, DEFAULT_POOL) / 1000:.2f}",
            "dps": f"{round(dmg / (cycle / 1000), 1)}",
            "sust": f"{round(dmg * mag / (mag * cycle / 1000 + reload_ms / 1000), 1)}",
            "mag": str(mag), "reserve": str(reserve), "reload": str(reload_ms),
            "mag/total kills": f"{mag // htk} / {(mag + reserve) // htk}" if htk else None,
            "heat": str(heat) if heat else "—",
        }
        for col, expect in want.items():
            if expect is None:
                continue
            got = _cell(r[ix[col]])
            if got != expect:
                bad.append(f"§2.2 {name} · {col}: table says {got!r}, the wire derives {expect!r}")
    missing = {w["weapon_id"] for w in ROWS} - seen
    assert not missing, f"§2.2 omits {sorted(missing)} — every weapon must appear in the balance table"
    assert not bad, "docs/weapon-design.md §2.2 is stale:\n  " + "\n  ".join(bad)


def test_weapon_design_health_sensitivity_table_matches_the_wire():
    """§2.5: hits-to-kill at four health configs — the table W2's pool-aware views must agree with."""
    rows = _table("### 2.5 Health-config sensitivity")
    pools = []
    for c in rows[0][1:]:
        m = re.search(r"\((\d+)\)", _cell(c)) or re.search(r"(\d+)\s*$", _cell(c))
        pools.append(int(m.group(1)))
    assert pools == [100, DEFAULT_POOL, 150, 200], pools
    by_name, bad, covered = _by_name(), [], set()
    for r in rows[1:]:
        label = _cell(r[0])
        if label.lower().startswith("power tier"):
            ids = [w["weapon_id"] for w in ROWS if CAT.damage(w["weapon_id"]) >= DEFAULT_POOL]
        else:
            names = [n.strip() for n in label.split("/")]
            # EVERY name must resolve. The old version filtered unresolvable ones out and kept going,
            # so the row "Assault / Burst / Energy Rifle" silently validated the Energy Rifle alone —
            # the Assault Rifle, the weapon this whole section is about, was never checked at all
            # (review 2026-09-01). A row that names something we cannot resolve is a stale row.
            unknown = [n for n in names if n.lower() not in by_name]
            assert not unknown, f"§2.5 row {label!r} names {unknown}, which is not in weapons.json"
            ids = [by_name[n.lower()] for n in names]
        covered.update(ids)
        for i, pool in enumerate(pools):
            want = _cell(r[i + 1])
            for wid in ids:
                got = str(CAT.hits_to_kill(wid, pool))
                if got != want:
                    bad.append(f"§2.5 {label} @ {pool}: table says {want}, {wid} needs {got}")
    # ...and the table must cover the whole arsenal, or deleting a row makes the problem vanish
    missing = {w["weapon_id"] for w in ROWS if not w.get("hidden")} - covered
    assert not missing, f"§2.5 omits {sorted(missing)} — every weapon's htk moves with the health config"
    assert not bad, "docs/weapon-design.md §2.5 is stale:\n  " + "\n  ".join(bad)


# ---------------------------------------------------------------- 3. the views the UIs draw


def test_weapon_views_follow_the_hosts_health_config():
    """W2: KIT and ARSENAL shipped `HITS TO KILL 13 · TTK 1.68S` for the AR at every health config.

    The view must recompute against the pool it is given, and say which pool that was."""
    at = {p: {v["weapon_id"]: v for v in weapon_views(CAT.all(), p)} for p in (100, 115, 150, 200)}
    assert [at[p]["assault_rifle"]["htk"] for p in (100, 115, 150, 200)] == [12, 13, 17, 23]
    assert [at[p]["sniper_rifle"]["htk"] for p in (100, 115, 150, 200)] == [2, 2, 3, 4]
    # the power tier stops one-shotting at 150 — the reason it ships 2+2 and not 1+3 (§2.5)
    assert at[115]["rail_gun"]["htk"] == 1 and at[150]["rail_gun"]["htk"] == 2
    for p in (100, 115, 150, 200):
        for v in at[p].values():
            assert v["pool"] == p, (v["weapon_id"], v["pool"])
            # damage per hit is a property of the WEAPON, not of the pool it is fired at
            assert v["dmg_per_hit"] == at[115][v["weapon_id"]]["dmg_per_hit"]
            if v["htk"]:
                assert v["htk"] == math.ceil(p / v["dmg_per_hit"])
    # and TTK moves with it, or the ARSENAL's TIME TO KILL column is decoration
    assert at[200]["assault_rifle"]["ttk_ms"] > at[115]["assault_rifle"]["ttk_ms"]


def test_weapon_views_at_the_default_pool_still_publish_the_shipped_numbers():
    """The regression guard for W2: nothing about the default game may have moved."""
    views = {v["weapon_id"]: v for v in weapon_views(CAT.all())}
    for w in ROWS:
        if w.get("hidden"):
            continue
        v = views[w["weapon_id"]]
        assert v["htk"] == w["htk"] and v["ttk_ms"] == w["ttk_ms"], w["weapon_id"]
        assert v["pool"] == DEFAULT_POOL
        assert v["dmg_per_hit"] == CAT.damage(w["weapon_id"])


def test_a_synthetic_catalog_without_the_chain_still_renders():
    """Fakes and test rows carry no `dmg_hit`/`cycle_ms`. The view must degrade, never raise —
    `_catalog_views` runs on every hydrate and bind, and has no fallback behind it."""
    from brx_mcp.mc.fakes import weapon_views as fake_views
    assert fake_views()                                     # the demo arsenal still builds
    thin = [{"weapon_id": "x", "name": "X", "stats": {"mag": 10, "reserve": 20, "dmg": 8, "htk": 13}}]
    v = weapon_views(thin)[0]
    assert v["dmg_per_hit"] == 9                            # read back out of the 115-pool share
    assert v["htk"] == 13 and weapon_views(thin, 200)[0]["htk"] == 23   # published htk scaled by pool
    # ...but a bar on an unknown scale must NOT become a confident per-hit magnitude behind htk
    demo = [{"weapon_id": "z", "name": "Z", "stats": {"dmg": 55, "htk": 13}}]
    assert weapon_views(demo)[0]["htk"] == 13
    # a row with a non-numeric stat must not take node assignment down with it
    junk = [{"weapon_id": "y", "name": "Y", "stats": {"dmg": "lots", "htk": None}}]
    assert weapon_views(junk)[0]["dmg_per_hit"] is None


def test_the_quoted_pool_is_the_pool_the_gun_is_ACTUALLY_armed_with():
    """`Session.health_pool()` must equal hp+armour on the `$PSET` the compiler emits for that player.

    Review 2026-09-01: it ignored the `body_armor` perk's `max_armor_add`, which `_to_gc()` does
    write. A player holding it was armed at a 165 pool while KIT quoted the AR at 13 hits / 1.68 s;
    the truth is 19 / 2.52 s. W2's whole claim is that the number on screen is the truth for THAT
    player, so the two arithmetics have to be pinned to each other, not just written to match once.
    """
    from brx_mcp.mc.compile import Compiler
    from brx_mcp.mc.fakes import FakeArmory, FakeNet, demo_armory
    from brx_mcp.mc.state import Session

    s = Session(Compiler(), FakeNet(), FakeArmory(demo_armory()))
    p = s.add_player("ALPHA", gun_id="GUN-A")
    pid = p["player_id"]

    def armed_pool(player):
        head = s.compiler.compile(s.config, player, s.teams)["head"]
        t = next(f for f in head if f.startswith("$PSET")).split(",")
        return int(t[3]) + int(t[4])            # $PSET hp, armor

    cases = [
        ({"weapons": [{"weapon_id": "assault_rifle"}], "perk": None}, None),
        ({"weapons": [{"weapon_id": "assault_rifle"}], "perk": "body_armor"}, None),
        ({"weapons": [{"weapon_id": "assault_rifle"}], "perk": None}, {"max_hp": 100, "max_armor": 100}),
        ({"weapons": [{"weapon_id": "assault_rifle"}], "perk": "body_armor"}, {"max_hp": 50, "max_armor": 0}),
        # over the 255 policy ceiling: `_to_gc()` clamps armour, so `health_pool()` must clamp too or
        # it quotes a pool no gun was ever armed with (the sweep's one miss, 2026-09-01)
        ({"weapons": [{"weapon_id": "assault_rifle"}], "perk": "body_armor"}, {"max_hp": 45, "max_armor": 250}),
        ({"weapons": [{"weapon_id": "assault_rifle"}], "perk": None}, {"max_hp": 45, "max_armor": 255}),
    ]
    seen = set()
    for loadout, health in cases:
        if health:
            s.set_config({"health": health})
        s.patch_player(pid, loadout=loadout)
        q = s.players[pid]
        want, got = armed_pool(q), s.health_pool(q)
        assert got == want, f"{loadout['perk']} @ {health}: quoted {got}, the gun is armed at {want}"
        # and the figure the screens draw is computed against it
        v = next(x for x in weapon_views(CAT.all(), got) if x["weapon_id"] == "assault_rifle")
        assert v["pool"] == want and v["htk"] == math.ceil(want / v["dmg_per_hit"])
        seen.add(want)
    assert len(seen) > 1, "the cases must actually move the pool, or this proves nothing"
    # 45 + min(255, 250+50) — a config that WOULD exceed the ceiling must land on it
    assert 45 + 255 in seen, f"the 255 ceiling must be exercised, saw {sorted(seen)}"


def test_the_perk_that_moves_the_pool_changes_the_quoted_numbers():
    """The regression in plain terms: body_armor must visibly change HITS TO KILL, not silently."""
    from brx_mcp.mc.compile import Compiler
    from brx_mcp.mc.fakes import FakeArmory, FakeNet, demo_armory
    from brx_mcp.mc.state import Session

    s = Session(Compiler(), FakeNet(), FakeArmory(demo_armory()))
    p = s.add_player("ALPHA", gun_id="GUN-A")
    base = s.health_pool(s.players[p["player_id"]])
    s.patch_player(p["player_id"], loadout={"weapons": [{"weapon_id": "assault_rifle"}], "perk": "body_armor"})
    armoured = s.health_pool(s.players[p["player_id"]])
    assert armoured == base + 50, (base, armoured)          # perks.json body_armor max_armor_add
    htk = lambda pool: next(v for v in weapon_views(CAT.all(), pool) if v["weapon_id"] == "assault_rifle")["htk"]
    assert htk(armoured) > htk(base), "body_armor must move HITS TO KILL"
