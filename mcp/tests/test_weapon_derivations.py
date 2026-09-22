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
# 2026-09-18, weapon-design.md §7.4: a row marked `lethal: false` deliberately cannot kill (the fn-20
# Breacher, the fn-23 Haze). Hits to kill and time to kill are undefined for it, and publishing the
# numbers the FRAME would imply -- 8 damage, 13 hits -- would lie to the player about a weapon that
# cannot take a point of health. So those rows carry zeros, they are exempt from the time-to-kill
# ladder in §2.2 and the health-sensitivity table in §2.5, and §7.6 documents them instead. The
# exemption is narrow and it is enforced: see `test_a_support_weapon_publishes_zeros_and_is_documented`.
SUPPORT = {w["weapon_id"] for w in ROWS if w.get("lethal") is False}
LETHAL_ROWS = [w for w in ROWS if w["weapon_id"] not in SUPPORT]
CAT = WeaponCatalog()


def _tok(weapon_id: str, key: str) -> str:
    """One named doc token of the shipped frame, as text."""
    return CAT.resolve(weapon_id, 0).split(",")[WeaponCatalog._T[key] + 1]


# ---------------------------------------------------------------- 1. weapons.json


def test_shipped_stats_are_derived_from_the_shipped_frame():
    """`dmg`/`rof`/`rng`/`htk`/`ttk_ms` are documentation of the frame. Recompute all five."""
    bad = []
    for w in LETHAL_ROWS:
        wid = w["weapon_id"]
        want = {"dmg": CAT.damage_bar(wid), "rof": CAT.rate_of_fire(wid),
                "rng": int(_tok(wid, "range_indoor") or 0),
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


def test_t41_is_pinned_byte_for_byte_at_every_venue():
    """F234 (2026-09-17 garden test corrected B6/F135, `docs/experiment-log/2026-09.md`): t41
    (`gunRangeIndoor`) was proven a null outdoors, so `resolve()` must never write it. This pins
    the invariant every venue must keep: t41 always reads back exactly what the capture carries,
    same as `weapons.json` `rng` (which is still a t41 mirror, unchanged by this fix).

    A future lane that "fixes" range by hand-editing t41 again, or by having `resolve()` write it,
    should watch this go red."""
    for w in ROWS:
        wid = w["weapon_id"]
        captured = _tok(wid, "range_indoor")
        no_venue = CAT.resolve(wid, 0).split(",")[WeaponCatalog._T["range_indoor"] + 1]
        indoor = CAT.resolve(wid, 0, environment="indoor").split(",")[WeaponCatalog._T["range_indoor"] + 1]
        outdoor = CAT.resolve(wid, 0, environment="outdoor").split(",")[WeaponCatalog._T["range_indoor"] + 1]
        assert captured == no_venue == indoor == outdoor == str(w["rng"]), (
            f"{wid}: t41 moved ({captured!r}/{no_venue!r}/{indoor!r}/{outdoor!r}) — t41 must stay "
            "exactly as captured, indoor is unmeasured (F231 open) and must never be guessed")


def test_t12_equals_the_declared_headset_dmg_on_every_weapon_whose_capture_carries_it():
    """2026-09-18 finding (Callsign capture cap30 + independent LaserTagMods confirmation,
    docs/weapon-design.md §7): t1 (`WeaponIRSource`) = 2 on exactly three stock weapons (shotgun,
    plasma sniper, rocket launcher), and on those t12 (`ExtraHeadsetDamage`) is an UNCONDITIONAL
    second word's damage, fired from the shooter's own headset, that STACKS with t5.

    `resolve()` no longer mirrors t5 onto t12 (that behaviour is gone, replaced 2026-09-18): it
    writes a DECLARED `wire.headset_dmg`, priced independently of t5 (see
    `WeaponCatalog.damage_per_pull()`). This test pins that every weapon whose capture already
    carries a t12 compiles it to exactly its declared `wire.headset_dmg`, not the raw captured
    word, and not a mirror of t5.

    Break the `wire.get("headset_dmg")` write in `resolve()` and watch this go red."""
    bad = []
    for w in ROWS:
        wid = w["weapon_id"]
        if not _tok(wid, "headset_dmg").strip():
            continue
        declared = (w.get("wire") or {}).get("headset_dmg")
        compiled_t12 = CAT.resolve(wid, 0).split(",")[WeaponCatalog._T["headset_dmg"] + 1]
        if compiled_t12 != str(declared):
            bad.append(f"{wid}: t12 compiled to {compiled_t12!r}, wire.headset_dmg declares {declared!r}")
    assert not bad, "t12 drifted from the declared wire.headset_dmg:\n  " + "\n  ".join(bad)


def test_a_captured_t12_with_no_declared_headset_dmg_is_refused():
    """The safety rule the old mirror behaviour used to enforce implicitly, now enforced directly:
    a weapon whose capture carries a t12 but declares no `wire.headset_dmg` must REFUSE to compile,
    not ship the raw captured second word unpriced: shipping it unpriced is the exact three-weapon
    balance hole this change exists to close (the Plasma Sniper priced its t5 down to 25 while its
    capture still carried an unpriced 80 in t12)."""
    by_id = {w["weapon_id"]: w for w in ROWS}
    plasma = json.loads(json.dumps(by_id["plasma_sniper"]))   # deep copy, never mutate the shared row
    assert plasma["wire"]["headset_dmg"] == 10, "fixture drift: plasma_sniper no longer declares headset_dmg 10"
    del plasma["wire"]["headset_dmg"]
    cat = WeaponCatalog([plasma])
    try:
        cat.resolve("plasma_sniper", 0)
        raise AssertionError("compiled a captured t12 with no declared wire.headset_dmg")
    except ValueError as e:
        assert "plasma_sniper" in str(e) and "headset_dmg" in str(e), str(e)


def test_a_weapon_with_no_captured_t12_still_compiles_with_the_cell_empty():
    """The common case (most shipped weapons carry no t12 at all) must keep compiling exactly as
    before: the cell stays blank, and no `wire.headset_dmg` is required."""
    checked = 0
    for w in ROWS:
        wid = w["weapon_id"]
        if _tok(wid, "headset_dmg").strip():
            continue
        if (w.get("overrides") or {}).get("t12"):
            continue  # an explicit evidence-carrying deviation may deliberately populate the empty capture
        compiled_t12 = CAT.resolve(wid, 0).split(",")[WeaponCatalog._T["headset_dmg"] + 1]
        assert compiled_t12 == "", f"{wid}: t12 should stay empty, compiled to {compiled_t12!r}"
        checked += 1
    assert checked > 5, "too few no-t12 weapons checked: the capture fixtures moved"


def test_smg_deliberately_adds_a_small_headset_word_that_the_headset_can_emit():
    """Playtest 2026-09-20: covering the SMG barrel produced no hit while the Shotgun control did.
    The pushed SMG had an empty t12, so its headset had no damage word to send. This is an explicit
    Open BRX deviation from the captured frame, priced as 8 barrel + 1 headset with reliable carriers."""
    frame = CAT.resolve("smg", 0, environment="outdoor").split(",")
    T = WeaponCatalog._T
    assert frame[2] == "2", "t1 must select gun + headset or the new t12 word is never emitted"
    assert frame[T["dmg"] + 1] == "8"
    assert frame[T["headset_dmg"] + 1] == "1"
    assert frame[T["headset_range_outdoor"] + 1] == "100"
    assert frame[T["headset_range_indoor"] + 1] == "100"
    assert CAT.damage_per_pull("smg") == 9


def test_an_invented_headset_word_requires_the_source_and_two_reliable_carriers():
    """An added t12 alone recreates the playtest bug: no headset source means no emission, while an
    empty or detuned range cell can make the new word inaudible. Refuse every incomplete shape."""
    smg = json.loads(json.dumps(next(w for w in ROWS if w["weapon_id"] == "smg")))
    cases = (("t1", "source"), ("t13", "range"), ("t42", "range"))
    for missing, hint in cases:
        broken = json.loads(json.dumps(smg))
        del broken["overrides"][missing]
        try:
            WeaponCatalog([broken]).resolve("smg", 0)
            raise AssertionError(f"invented headset word compiled without {missing}")
        except ValueError as e:
            assert hint in str(e).lower() or missing in str(e), str(e)


def test_damage_per_pull_adds_the_declared_headset_dmg_and_damage_stays_gun_body_only():
    """`damage()` must keep its exact old meaning (t5 alone, the Armour Piercing `dmg_abs` pricing
    base and `validate()`'s "x1 number"). `damage_per_pull()` is a SEPARATE, additive derivation,
    used only by `hits_to_kill()`/`time_to_kill()`/`damage_bar()`. On the three headset weapons the
    two must differ by exactly the declared `wire.headset_dmg`; everywhere else they must be equal,
    or a weapon with no headset word would silently gain one."""
    by_id = {w["weapon_id"]: w for w in ROWS}
    # read the declared extra off the row rather than typing it: the Shotgun's was 20 until F276
    # moved it to 19 (two identical words may be deduped by the receiving gun), and a hardcoded 20
    # here would have failed on a change that deliberately holds the per-pull total at 40.
    for wid in ("shotgun", "plasma_sniper", "rocket_launcher"):
        want_extra = int((by_id[wid].get("wire") or {})["headset_dmg"])
        assert CAT.damage_per_pull(wid) == CAT.damage(wid) + want_extra, (
            f"{wid}: per-pull {CAT.damage_per_pull(wid)} is not gun-body {CAT.damage(wid)} plus the "
            f"declared headset word {want_extra}")
    for w in ROWS:
        wid = w["weapon_id"]
        if (w.get("wire") or {}).get("headset_dmg") is not None:
            continue
        assert CAT.damage_per_pull(wid) == CAT.damage(wid), f"{wid}: gained a headset word it never declared"


def test_gun_range_outdoor_pct_ships_the_catalogue_value_outdoors_only():
    """F234: t2 (`gunRangeOutdoor`) is the confirmed venue lever. It sets the emitter's carrier
    frequency, not its power (2026-09-18, protocol/brx-protocol.md), so these values are a shipped
    table, not a calibrated metre ladder. Outdoor ships each weapon's
    catalogue starting value (`weapons.json` `wire.range_outdoor_pct`, docs/weapon-design.md §4.2);
    indoor and an unset venue both keep the weapon's captured t2, because indoor is unmeasured
    (F231 open) and must never be invented. A weapon with no catalogue value (every hidden/cut
    weapon, the sidearms, melee) keeps its captured t2 at every venue, same as before this fix."""
    shipped = {"sniper_rifle": 100, "amr": 85, "charge_rifle": 85, "assault_rifle": 70,
               "burst_rifle": 70, "suppressor": 55, "energy_rifle": 55, "smg": 30,
               "shotgun": 100, "rocket_launcher": 22, "rail_gun": 22}
    by_id = {w["weapon_id"]: w for w in ROWS}
    assert set(shipped) <= set(by_id), sorted(set(shipped) - set(by_id))
    for wid, want in shipped.items():
        assert (by_id[wid].get("wire") or {}).get("range_outdoor_pct") == want, (
            f"{wid}: weapons.json wire.range_outdoor_pct does not match the shipped table")
        outdoor = CAT.resolve(wid, 0, environment="outdoor").split(",")[WeaponCatalog._T["range_outdoor"] + 1]
        assert outdoor == str(want), f"{wid}: t2 outdoor should be {want}, frame has {outdoor}"
        captured = _tok(wid, "range_outdoor")
        for env in (None, "indoor"):
            got = (CAT.resolve(wid, 0).split(",") if env is None
                   else CAT.resolve(wid, 0, environment=env).split(","))[WeaponCatalog._T["range_outdoor"] + 1]
            assert got == captured, f"{wid} @ {env!r}: t2 moved off the captured value ({captured!r} -> {got!r})"
    # a weapon with no catalogue value keeps its captured t2 at every venue, outdoor included
    for wid in ("usp", "deagle", "melee"):
        captured = _tok(wid, "range_outdoor")
        for env in (None, "indoor", "outdoor"):
            got = (CAT.resolve(wid, 0).split(",") if env is None
                   else CAT.resolve(wid, 0, environment=env).split(","))[WeaponCatalog._T["range_outdoor"] + 1]
            assert got == captured, f"{wid} @ {env!r}: has no catalogue range value, t2 must stay captured"


def test_gun_range_outdoor_floor_refuses_a_value_below_13():
    """F231: t2=5 landed 0 hits from 38 shots at any distance, including muzzle on the dome, so a
    compiled t2 under the floor is a weapon that cannot hit anyone. Break it and watch it fail:
    both the raw function and a real weapon compiled with a below-floor catalogue value must raise."""
    from brx_mcp.mc.compile import RANGE_OUTDOOR_FLOOR, gun_range_outdoor_pct

    assert RANGE_OUTDOOR_FLOOR == 13
    for bad in (0, 1, 12):
        try:
            gun_range_outdoor_pct(100, bad, "outdoor")
        except ValueError:
            pass
        else:
            raise AssertionError(f"gun_range_outdoor_pct must refuse an outdoor override of {bad}")
    # the floor also applies to a captured base with no override at all — belt and braces
    try:
        gun_range_outdoor_pct(5, None, "indoor")
    except ValueError:
        pass
    else:
        raise AssertionError("gun_range_outdoor_pct must refuse a below-floor CAPTURED value too")
    # the values actually shipped are all comfortably clear of the floor
    for value in (13, 22, 30, 55, 70, 85, 100):
        assert gun_range_outdoor_pct(100, value, "outdoor") == value
    # and a full weapon compile with a synthetic below-floor catalogue entry must refuse the same way
    rows = json.loads((ROOT / "mcp" / "brx_mcp" / "mc" / "weapons.json").read_text())["weapons"]
    hot = next(w for w in rows if w["weapon_id"] == "assault_rifle")
    hot["wire"] = dict(hot.get("wire") or {}, range_outdoor_pct=5)
    bad_cat = WeaponCatalog(rows)
    try:
        bad_cat.resolve("assault_rifle", 0, environment="outdoor")
    except ValueError:
        pass
    else:
        raise AssertionError("resolve() must refuse to compile a below-floor t2, not just the bare function")


def test_range_band_and_range_target_m_are_declared_only_never_wired():
    """docs/weapon-design.md §4.2: `range_band` and `range_target_m` are human-facing catalogue
    copy in metres, for the armoury screens. `t2` (via `wire.range_outdoor_pct`) is the only range
    field the frame builder reads. Deleting the declared fields from a row must not move a single
    byte of the compiled frame — if it does, something started reading them as wire data."""
    rows = json.loads((ROOT / "mcp" / "brx_mcp" / "mc" / "weapons.json").read_text())["weapons"]
    declared = [w for w in rows if "range_band" in w or "range_target_m" in w]
    assert declared, "no weapon carries range_band/range_target_m — the guard has nothing to check"
    before = WeaponCatalog(rows)
    stripped = json.loads(json.dumps(rows))   # deep copy
    for w in stripped:
        w.pop("range_band", None)
        w.pop("range_target_m", None)
    after = WeaponCatalog(stripped)
    for w in declared:
        wid = w["weapon_id"]
        for env in (None, "indoor", "outdoor"):
            a = before.resolve(wid, 0) if env is None else before.resolve(wid, 0, environment=env)
            b = after.resolve(wid, 0) if env is None else after.resolve(wid, 0, environment=env)
            assert a == b, f"{wid} @ {env!r}: removing range_band/range_target_m changed the wire frame"


def test_every_weapon_has_a_derivable_damage_and_cycle():
    """A weapon with no t5 or no t14 silently disables every check above — catch it directly."""
    for w in ROWS:
        wid = w["weapon_id"]
        assert CAT.damage(wid) > 0, f"{wid}: no damage on the wire"
        assert CAT.fire_ms(wid) > 0, f"{wid}: no fire interval on the wire"
        assert CAT.cycle_ms(wid) > 0, f"{wid}: no cycle"


def test_rounds_per_charge_is_a_two_state_field_never_a_third():
    """Review finding (2026-09-13): `weapons.json`'s `_note` declares one rule for `rounds_per_charge`
    -- absent means 1, every other value is the real cost of one charge. A row that wrote an explicit
    1 would be a THIRD state (absent-means-1 on one row, explicit-means-1 on another) that forces a
    reader to know a row's history before trusting the number. `WeaponCatalog.rounds_per_charge()` is
    the one place that resolves the default; every consumer reads that, and this test keeps the raw
    catalogue itself honest about the two states it is allowed to have."""
    for w in ROWS:
        wid = w["weapon_id"]
        if "rounds_per_charge" not in w:
            continue
        rpc = w["rounds_per_charge"]
        assert isinstance(rpc, int) and rpc >= 1, f"{wid}: rounds_per_charge must be an integer >= 1, got {rpc!r}"
        assert rpc != 1, f"{wid}: an explicit 1 duplicates the 'absent' state -- drop the key instead"


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


def test_crit_pct_writes_t6_only_on_the_weapons_that_declare_it():
    """F62 (closed 2026-09-18): t6 (`primaryCritChance`) is a straight percentage the GUN rolls
    itself. `crit_pct` names two weapons only (burst_rifle, amr); every other row
    must keep whatever t6 its capture carries — which is 0 on every stock frame captured so far.

    Unlike `headset_dmg`, an ABSENT `crit_pct` is not a refusal: a weapon that never crits is not a
    balance hole, so `resolve()` must leave the token exactly as the capture carries it rather than
    writing a 0. Break the `crit_pct` write in `resolve()` and watch this go red."""
    declared = {"burst_rifle": 40, "amr": 30}
    # The Toxin Rifle carried 15 until 2026-09-19: every hit poisons now (S16), so no crit roll.
    by_id = {w["weapon_id"]: w for w in ROWS}
    assert {wid: by_id[wid]["crit_pct"] for wid in declared} == declared, \
        "fixture drift: the crit weapons no longer declare the expected crit_pct"
    for wid, want in declared.items():
        compiled_t6 = CAT.resolve(wid, 0).split(",")[WeaponCatalog._T["crit"] + 1]
        assert compiled_t6 == str(want), f"{wid}: t6 compiled to {compiled_t6!r}, crit_pct declares {want!r}"
    checked = 0
    for w in ROWS:
        wid = w["weapon_id"]
        if wid in declared:
            continue
        assert w.get("crit_pct") is None, f"{wid}: unexpectedly declares crit_pct — extend `declared` above"
        captured_t6 = _tok(wid, "crit")
        compiled_t6 = CAT.resolve(wid, 0).split(",")[WeaponCatalog._T["crit"] + 1]
        assert compiled_t6 == captured_t6, \
            f"{wid}: t6 compiled to {compiled_t6!r} but the capture carries {captured_t6!r} — an " \
            f"undeclared crit_pct must be left untouched, not written"
        checked += 1
    assert checked > 10, "too few undeclared weapons checked: the capture fixtures moved"


def test_crit_pct_outside_0_to_100_raises_with_the_weapon_named():
    """A `crit_pct` the gun cannot represent must refuse to compile, and the error must name the
    offending weapon so a bad catalogue edit is easy to place."""
    rows = json.loads((ROOT / "mcp" / "brx_mcp" / "mc" / "weapons.json").read_text())["weapons"]
    hot = next(w for w in rows if w["weapon_id"] == "amr")
    for bad in (-1, 101, 1000):
        hot["crit_pct"] = bad
        bad_cat = WeaponCatalog(rows)
        try:
            bad_cat.resolve("amr", 0)
            raise AssertionError(f"resolve() must refuse a crit_pct of {bad}")
        except ValueError as e:
            assert "amr" in str(e), str(e)


def test_htk_and_ttk_derive_from_base_damage_alone_with_no_crit_term():
    """The design decision the whole crit-chance feature turns on (docs/weapon-design.md, F62): a
    published hits-to-kill is the GUARANTEED number, and a crit only ever beats it. The BASE damage
    was cut on the three crit weapons to pay for the chance (burst_rifle 11→10, amr 24→21, both
    average-preserving at their `crit_pct`), and `htk`/`ttk_ms` were republished from that cut base —
    they must never be a discount FROM the old number, only a plain re-derivation.

    The guard: `hits_to_kill()` is exactly `ceil(pool / damage_per_pull())` for every ordinary
    weapon (a cell weapon like the Charge Rifle counts trigger actions, not equal hits, and is
    already covered by `hits_to_kill()`'s own charge+tap branch — see its docstring), whatever
    `crit_pct` the row declares. There must be no crit term anywhere in the chain. Break it by
    folding an expected-value discount into `damage()`, `damage_per_pull()` or `hits_to_kill()` and
    watch this go red."""
    for w in LETHAL_ROWS:
        wid = w["weapon_id"]
        if CAT.rounds_per_charge(wid) > 1 and CAT.tap_damage(wid) > 0:
            continue   # cell weapon (Charge Rifle): trigger actions, not equal hits -- hits_to_kill()'s own branch
        dpp = CAT.damage_per_pull(wid)
        want_htk = math.ceil(DEFAULT_POOL / dpp) if dpp > 0 else 0
        assert CAT.hits_to_kill(wid, DEFAULT_POOL) == want_htk, \
            f"{wid}: hits_to_kill() disagrees with ceil(pool / damage_per_pull()) -- a crit term crept into the chain"
        assert w["htk"] == want_htk, f"{wid}: catalogue htk is stale against the guaranteed derivation"
    # the crit weapons, and the Toxin Rifle that dropped its crit, pinned to the numbers this change shipped (F62, 2026-09-18)
    for wid, want_htk, want_ttk in (("burst_rifle", 12, 1558), ("amr", 6, 2000), ("toxin_rifle", 15, 1540)):
        assert CAT.hits_to_kill(wid, DEFAULT_POOL) == want_htk, wid
        assert CAT.time_to_kill(wid, DEFAULT_POOL) == want_ttk, wid
        assert CAT.damage_per_pull(wid) == CAT.damage(wid), \
            f"{wid}: damage_per_pull() must equal the base t5 magnitude, with no crit discount folded in"


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


def _one_mag_kill_p(shots: int, htk: int, p: float = 0.7) -> float:
    """P(at least `htk` hits in `shots` trials at hit chance `p`) -- binomial, exact. 2026-09-17
    arsenal review: the dominance axis that replaced "total kills from a full kit"
    (`test_mc_compile.py::_one_mag_kill_p`, kept the same formula here to avoid a cross-file import)."""
    if htk <= 0:
        return 1.0
    if shots < htk:
        return 0.0
    return sum(math.comb(shots, k) * p ** k * (1 - p) ** (shots - k) for k in range(htk, shots + 1))


def test_weapon_design_balance_table_matches_the_wire():
    """§2.2 is the balance table a human reads. Every numeric column is recomputed here.

    `dps` is damage per cycle second; `sust` folds one reload into a whole magazine — the two
    columns that were stale for the AR after the 2026-08-30 retune, because nothing recomputed them.
    """
    rows = _table("### 2.2 The table")
    header = [_cell(c).lower() for c in rows[0]]
    ix = {name: header.index(name) for name in
          ("weapon", "dmg", "cycle ms", "htk", "ttk s", "dps", "sust", "mag", "reserve", "reload",
           "one-mag kill % (p=0.7)", "heat")}
    by_name, seen, bad = _by_name(), set(), []
    for r in rows[1:]:
        name = _cell(r[ix["weapon"]]).lower()
        wid = by_name.get(name)
        assert wid, f"§2.2 lists a weapon that is not in weapons.json: {name!r}"
        seen.add(wid)
        row = next(w for w in ROWS if w["weapon_id"] == wid)
        dmg, cycle, htk = CAT.damage(wid), CAT.cycle_ms(wid), CAT.hits_to_kill(wid, DEFAULT_POOL)
        mag, reserve, reload_ms = row["mag"], row["reserve"], row["reload_ms"]
        # F226/S43 (2026-09-17): a charge weapon's mag counts ROUNDS of the cell, not hits -- sust and
        # the one-magazine kill chance both need full CHARGES, or the Charge Rifle's 40-round cell
        # reads as 40 hits instead of the 4 it actually is.
        mag_charges = CAT.charges(wid, mag)
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
            "sust": f"{round(dmg * mag_charges / (mag_charges * cycle / 1000 + reload_ms / 1000), 1)}",
            "mag": str(mag), "reserve": str(reserve), "reload": str(reload_ms),
            # The probabilistic axis models a CELL weapon as repeated full charges (a charge is
            # near-certain once released; no per-action-type accuracy model exists to mix that with a
            # tap's p=0.7 trigger pull), so it uses the SIMPLE ceil(pool/charge_dmg) htk, not the real
            # charge+tap combo `htk` publishes -- same split as `test_mc_compile.py`'s dominance test.
            "one-mag kill % (p=0.7)": (
                f"{round(100 * _one_mag_kill_p(mag_charges, math.ceil(DEFAULT_POOL / dmg)))}%"
                if dmg else None),
            "heat": str(heat) if heat else "—",
        }
        for col, expect in want.items():
            if expect is None:
                continue
            got = _cell(r[ix[col]])
            if got != expect:
                bad.append(f"§2.2 {name} · {col}: table says {got!r}, the wire derives {expect!r}")
    missing = {w["weapon_id"] for w in LETHAL_ROWS} - seen
    assert not missing, f"§2.2 omits {sorted(missing)} — every LETHAL weapon must appear in the balance table"
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
    missing = {w["weapon_id"] for w in LETHAL_ROWS if not w.get("hidden")} - covered
    assert not missing, f"§2.5 omits {sorted(missing)} — every LETHAL weapon's htk moves with the health config"
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
            # F225/F226/S43 (2026-09-17): a CELL weapon (the Charge Rifle) counts trigger ACTIONS, not
            # equal-sized hits -- 1 charge plus however many taps close the rest of the pool, never the
            # plain ceil(pool/dmg) every other weapon uses. See views.weapon_view()'s tap_dmg branch.
            if v["htk"] and v["weapon_id"] != "charge_rifle":
                assert v["htk"] == math.ceil(p / v["dmg_per_hit"])
    assert [at[p]["charge_rifle"]["htk"] for p in (100, 115, 150, 200)] == [2, 3, 5, 7]
    # and TTK moves with it, or the ARSENAL's TIME TO KILL column is decoration
    assert at[200]["assault_rifle"]["ttk_ms"] > at[115]["assault_rifle"]["ttk_ms"]


def test_weapon_views_at_the_default_pool_still_publish_the_shipped_numbers():
    """The regression guard for W2: nothing about the default game may have moved."""
    views = {v["weapon_id"]: v for v in weapon_views(CAT.all())}
    for w in ROWS:
        if w.get("hidden") or w["weapon_id"] in SUPPORT:
            continue       # a support weapon has no htk/ttk to publish: see the SUPPORT note above
        v = views[w["weapon_id"]]
        assert v["htk"] == w["htk"] and v["ttk_ms"] == w["ttk_ms"], w["weapon_id"]
        assert v["pool"] == DEFAULT_POOL
        # `dmg_per_hit` is `damage_per_pull()` (t5 plus a declared `wire.headset_dmg`), not `damage()`
        # (t5 alone), 2026-09-18, so the client's own htk/ttk re-derivation agrees with the server's.
        assert v["dmg_per_hit"] == CAT.damage_per_pull(w["weapon_id"])


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
    junk = [{"weapon_id": "y", "name": "Y", "stats": {"mag": "many", "reserve": "plenty",
             "reload_ms": "soon", "dmg": "lots", "rof": "fast", "rng": "far", "htk": None}}]
    bad_view = weapon_views(junk)[0]
    assert bad_view["clip"] == 0 and bad_view["reserve"] is None
    assert bad_view["reload_s"] is None and bad_view["reload_ms"] is None
    assert bad_view["dmg"] is None and bad_view["rpm"] is None and bad_view["rng"] is None
    nonfinite = [{"weapon_id": "n", "name": "N", "stats": {"mag": float("inf"),
                  "dmg_hit": float("nan"), "rof": float("inf")}}]
    finite_view = weapon_views(nonfinite)[0]
    assert finite_view["clip"] == 0 and finite_view["dmg_per_hit"] is None
    assert finite_view["rpm"] is None


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
    # S50 (2026-09-17, docs/perk-design.md §2): body_armor's grant is now +25 flat (Tony: "maybe 50
    # is too much armor and it should be 25"), not the old flat +50.
    assert armoured == base + 25, (base, armoured)
    htk = lambda pool: next(v for v in weapon_views(CAT.all(), pool) if v["weapon_id"] == "assault_rifle")["htk"]
    assert htk(armoured) > htk(base), "body_armor must move HITS TO KILL"


def test_recoil_is_declared_not_wired_by_the_compiler():
    """S42 (2026-09-17): every weapon declares a `recoil` target profile
    `{ceiling, floor, per_shot, recover_ms}`, and `resolve()` must never write t21/t22 from it. The
    native accuracy walk is unreliable (F230: one gun of three decayed under sustained fire), so every
    weapon ships t21 == t22 == 100 whatever its declared profile says. The ONLY thing that drives
    recoil is `app/src/engine.js`'s accuracy writer at runtime, which pins both tokens to the live
    value on every write. Wiring `recoil` into `resolve()` to "make it real" is the mistake this test
    exists to catch: break it and it goes red."""
    for w in ROWS:
        wid = w["weapon_id"]
        recoil = w.get("recoil")
        assert isinstance(recoil, dict) and {"ceiling", "floor", "per_shot", "recover_ms"} <= set(recoil), wid
        for env in (None, "indoor", "outdoor"):
            p = (CAT.resolve(wid, 0).split(",") if env is None
                 else CAT.resolve(wid, 0, environment=env).split(","))
            assert p[WeaponCatalog._T["acc_ceiling"] + 1] == "100", f"{wid} @ {env!r}: t21 moved"
            assert p[WeaponCatalog._T["acc_floor"] + 1] == "100", f"{wid} @ {env!r}: t22 moved"


def test_no_mc_data_file_ships_a_duplicate_json_key():
    """A repeated key inside one JSON object is legal JSON and silently DISCARDS every value but the
    last, so a hand-merged file can carry a whole block of tuning that never reaches the compiler.

    That is not hypothetical: the 2026-09-17 arsenal merge left `weapons.json` with TWO `recoil`
    blocks in 13 of 22 weapons (35 occurrences of the key), one from each lane. `json.loads` kept the
    second and threw the first away, the parsed catalogue looked correct, and every test here passed.
    The playtest session found it by reading the raw file. This test reads the pairs BEFORE the parser
    collapses them, so the next merge conflict of that shape fails instead of shipping."""
    for path in sorted((ROOT / "mcp" / "brx_mcp" / "mc").glob("*.json")):
        dupes: list[str] = []

        def flag_repeated_keys(pairs, _seen=dupes, _path=path):
            seen: dict = {}
            for key, value in pairs:
                if key in seen:
                    _seen.append(f"{_path.name}: {key!r} appears twice in one object")
                seen[key] = value          # last wins, exactly as a plain json.loads would
            return seen

        json.loads(path.read_text(), object_pairs_hook=flag_repeated_keys)
        assert not dupes, "\n".join(dupes)


def test_a_support_weapon_publishes_zeros_and_is_documented():
    """The exemption above is narrow, and this is what keeps it honest.

    A `lethal: false` row is exempt from the time-to-kill ladder because hits-to-kill is undefined for a
    weapon that cannot take a point of health. That exemption would be a hole if a row could claim it and
    then publish the numbers its FRAME implies: the Breacher's frame carries 9 damage, which derives an
    8 damage bar and 13 hits to kill, and a player reading that would expect it to kill in 13 hits. It
    cannot kill at all. So a support row must publish ZEROS for the three kill numbers, and it must be
    documented in §7.6, where the reader is told what it actually does instead."""
    assert SUPPORT, "no support weapon in the catalogue: delete this guard or the exemption above"
    design = DESIGN.read_text()
    for wid in sorted(SUPPORT):
        w = next(r for r in ROWS if r["weapon_id"] == wid)
        assert w["dmg"] == 0 and w["htk"] == 0 and w["ttk_ms"] == 0, (
            f"{wid} is lethal: false but publishes kill numbers {w['dmg']}/{w['htk']}/{w['ttk_ms']}; "
            f"its frame would derive {CAT.damage_bar(wid)}/{CAT.hits_to_kill(wid, DEFAULT_POOL)} and that "
            f"would be a lie to the player")
        assert w["name"] in design, f"{wid} ({w['name']}) is exempt from §2.2 and undocumented in §7.6"


def test_the_poison_block_is_declared_and_never_reaches_the_wire():
    """S16 (2026-09-18): the Toxin Rifle declares a `dot` block, and `resolve()` must never write it.

    Nothing on the WIRE can tick. The bench that day proved the whole fn 24-27 family applies no damage
    at all and instead leaves the victim's gun faking a hit every 5.07 s, so the native route is dead and
    the poison can only be a tick clock on the victim's own phone (`spec/node.md` §3.17). The
    gun's only job is to land the direct hit and to carry protocol 11 in `$HIR` token 2 so the node knows
    which weapon hit it.

    So the frame a poison weapon pushes must be an ORDINARY weapon frame: the damage type says gas, and
    no token anywhere encodes the tick. Wiring `dot` into `resolve()` to "make it real" is the mistake
    this guard exists to catch, and it is the same shape as the recoil and range guards above."""
    dot_rows = [w for w in ROWS if w.get("dot")]
    assert dot_rows, "no weapon declares a `dot` block: delete this guard or the field"
    for w in dot_rows:
        wid = w["weapon_id"]
        d = w["dot"]
        assert {"per_tick", "tick_ms", "duration_ms", "refresh", "stack"} <= set(d), wid
        assert d["stack"] is False, f"{wid}: poison REFRESHES, it never stacks (§6.3b)"
        frame = CAT.resolve(wid, 0)
        for value in (str(d["per_tick"]), str(d["tick_ms"]), str(d["duration_ms"])):
            assert f",{value}," not in frame.replace(f",{w['wire']['fire_ms']},", ",_,"), (
                f"{wid}: the frame carries {value}, which looks like the declared `dot` reaching the wire:\n  {frame}")
        # the damage type IS on the wire, because the victim's node keys the tick clock off it
        assert frame.split(",")[WeaponCatalog._T["proto"] + 1] == str(w["cls"]), wid

def test_every_weapon_is_tagged_with_the_class_it_is_actually_in():
    """`role` is what a player SEES; `tags` is what loadout policy FILTERS on. They must agree.

    Found by Tony 2026-09-18, reading the arsenal page: the AMR showed the SNIPER class beside tags
    of `['support', 'sniper']`. Four weapons (AMR, Suppressor, Energy Rifle, Charge Rifle) moved out
    of the `support` role that morning, because support had become a dumping ground holding a .50
    anti-materiel rifle next to a smoke launcher. Their `role` moved and their `tags` did not.

    That is not cosmetic. `policy.py` filters the pickable pool on `exclude_tags` (see the
    `no_heavies` preset and `_check_loadout`), so a host who excluded support weapons would silently
    have banned the AMR, the Suppressor, the Energy Rifle and the Charge Rifle as well, while every
    screen told the player they were snipers and assault rifles.

    The rule: a weapon's tags must contain the tag for the role it is in. Extra tags are allowed and
    deliberate -- the Ion Sniper is genuinely both a heavy and a sniper -- so this checks presence,
    never equality, and does NOT strip a tag a designer added on purpose."""
    role_tag = {"assault": "assault", "cqb": "cqb", "marksman": "sniper", "support": "support",
                "power": "heavy", "sidearm": "sidearm", "melee": "melee"}
    wrong = []
    for w in ROWS:
        role = w.get("role")
        assert role in role_tag, f"{w['weapon_id']} has role {role!r}, which has no tag: add it here and to tokens.ts ROLE"
        if role_tag[role] not in (w.get("tags") or []):
            wrong.append(f"{w['weapon_id']}: role {role!r} but tags {w.get('tags')} (wants {role_tag[role]!r})")
    assert not wrong, ("loadout policy filters on `tags`, so a weapon tagged for a class it is not in "
                       "gets excluded by a rule the player never sees:\n  " + "\n  ".join(wrong))
    # ⚠ Presence alone is NOT enough, and the first version of this guard proved it: the AMR's real
    # fault was an EXTRA tag (`['support', 'sniper']`), and since 'sniper' was present the check
    # passed with the bug planted. A guard that cannot fail is worse than no guard.
    # So `support` gets its own rule, because it is the one tag that carries a MEANING rather than a
    # grouping: support is the class that CANNOT KILL (the Breacher strips, the Haze denies). A
    # lethal weapon wearing it is the dumping-ground bug by definition. Extra tags stay legal
    # otherwise -- the Ion Sniper is deliberately both a heavy and a sniper.
    mislabelled = [f"{w['weapon_id']}: tagged 'support' but it kills (lethal is not False)"
                   for w in ROWS if "support" in (w.get("tags") or []) and w.get("lethal") is not False]
    assert not mislabelled, ("'support' means the weapon cannot kill; it is not a bucket for weapons "
                             "nobody has classified:\n  " + "\n  ".join(mislabelled))

def test_a_two_word_weapon_never_also_carries_a_crit_chance():
    """The crit flag rides on BOTH IR words but the multiplier applies only to the barrel word, so a
    two-word weapon with a crit chance deals a damage split nothing in the catalogue models.

    ⚠️ THIS GUARD USED TO CARRY A SECOND RULE, THAT THE TWO WORDS MUST NEVER BE PRICED EQUALLY, AND
    THAT RULE IS NOW DISPROVEN. The fear was the V4_30/V4_31 "beacon block": the receiving gun drops
    an IR word identical to one it took within 159 ms, and our Shotgun shipped t5 20 / t12 20 about
    88 ms apart with the same `$SIR` key, which would have made it a 6-pull weapon against a
    catalogue publishing 3. F276 benched it on 2026-09-18: five single pulls, TWO `$HIR` of 20 every
    time, 60 to 75 ms apart, and on one pull both words landed on sensor 0 as byte-identical frames
    and BOTH still registered. The block does not apply to this pair. The Shotgun is back at 20/20
    and the equal-pricing assertion is deleted rather than left standing on a disproven reason.

    The crit half survives on its own footing: it never depended on the words being distinguishable,
    only on the multiplier reaching one of them. It is also still UNMEASURED, because F276 ran with
    t6 = 0, so the guard is a refusal to ship the untested combination rather than a known result."""
    critting = []
    for w in ROWS:
        wire = w.get("wire") or {}
        headset = wire.get("headset_dmg")
        if headset is None or int(headset) == 0:
            continue                       # one word, or a second word deliberately silenced
        if w.get("crit_pct"):
            critting.append(f"{w['weapon_id']}: second word {headset} AND crit_pct {w['crit_pct']}")
    assert not critting, ("the crit flag rides on both words but the multiplier applies only to the "
                          "barrel word, and the combination has never been measured:\n  "
                          + "\n  ".join(critting))
