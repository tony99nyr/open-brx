"""Goldens for the M-MODES FrameBundle compiler (docs/spec/modes.md §8, contracts §3, A5/A6).

Run: python3 run_tests.py mc_compile
Asserts the bundle STRUCTURE (head silent + ends $TID + carries $PSET,<1..63>; spawn/revive/end/panic
shapes), the catalog, validate() {ok,errors,warnings}, tutorial, cues-as-frames, and medals.
"""
from brx_mcp.mc.compile import Compiler, WeaponCatalog, golden_bundle
from brx_mcp.mc.types import MAX_PLAYERS

C = Compiler()

_TEAMS = [{"team_id": "blue", "name": "Blue", "color": "blue", "tid": 1},
          {"team_id": "yellow", "name": "Yellow", "color": "yellow", "tid": 2}]


def _cfg(mode="tdm", frag=0, time_limit_s=600, led=None):
    c = {"config_id": "c1", "mode": mode, "environment": "indoor", "night": False,
         "time_limit_s": time_limit_s, "respawn": {"type": "auto", "delay_s": 15},
         "scoring": {"frag_limit": frag, "win_by": "kills"},
         "health": {"max_hp": 45, "max_armor": 70}, "teams": _TEAMS}
    if led is not None:
        c["led"] = led
    return c


def _player(num=7, team="blue", weapons=("assault_rifle", "shotgun"), voice="male"):
    return {"player_id": f"p{num}", "player_num": num, "display": "REAPER", "team_id": team,
            "node_id": None, "gun_id": None, "voice": voice, "ready": True,
            "loadout": {"weapons": [{"weapon_id": w} for w in weapons]}}


# ---- head goldens (§8 task 4) --------------------------------------------
def test_head_is_silent_and_ends_with_tid():
    b = C.compile(_cfg(), _player(num=7, team="blue"), _TEAMS)
    head = b["head"]
    assert not any(f.startswith("$SPAWN") for f in head), "head must NOT contain $SPAWN"
    assert not any("VA81" in f for f in head), "head must NOT contain the $PLAY,VA81 countdown"
    assert head[-1] == "$TID,1,*", f"head must end with $TID,<tid>, got {head[-1]}"
    from brx_mcp.mc.compile import play_volume
    assert head[0] == f"$VOL,{play_volume('indoor')},0,*" and head[1] == "$CLEAR,*" and head[2] == "$START,*"


def test_play_volume_follows_the_venue():
    """Field 2026-08-30: $VOL,69 (iOS Callsign's value) played at ~on-gun level 2 and was too quiet
    outdoors. Volume now follows the venue — L3 indoors, L4 outdoors (protocol $VOL: L1=60 .. L5=100)."""
    from brx_mcp.mc.compile import play_volume
    assert play_volume("outdoor") == 90 and play_volume("indoor") == 80
    # An unknown venue must fail QUIET. Guessing "outdoor" means blasting L4 into someone's ear
    # indoors, and the wrong direction on a hearing-exposure default is not a neutral choice.
    assert all(play_volume(v) == 80 for v in (None, "", "mixed", "INDOOR", " Indoor ")), "unknown venue -> quieter"
    assert play_volume("OUTDOOR") == 90, "case-insensitive"
    from brx_mcp.mc.compile import VOL_TRYOUT
    assert VOL_TRYOUT == 69, "a try-out is fired at arm's length — it keeps the quiet value"
    out = C.compile(dict(_cfg(), environment="outdoor"), _player(), _TEAMS)["head"][0]
    assert out == "$VOL,90,0,*", out


def test_head_carries_player_num_in_pset():
    b = C.compile(_cfg(), _player(num=42), _TEAMS)
    pset = [f for f in b["head"] if f.startswith("$PSET,")][0]
    assert pset.startswith("$PSET,42,0,45,70,70,"), pset


def test_tid_resolves_from_team_id():
    b = C.compile(_cfg(), _player(team="yellow"), _TEAMS)
    assert b["head"][-1] == "$TID,2,*"


# ---- spawn / revive / end / panic ----------------------------------------
def test_spawn_shape():
    b = C.compile(_cfg(), _player(), _TEAMS)
    sp = b["spawn"]
    assert sp[0] == "$PLAYX,0,*" and sp[1] == "$SPAWN,,*"
    assert sp[-1] == "$BMAP,0,0,,,,,*"
    assert any(f.startswith("$AMMO,0,") for f in sp) and any(f.startswith("$AMMO,1,") for f in sp)


def test_revive_is_spawn_plus_ammo_no_bmap_no_hloop():
    b = C.compile(_cfg(), _player(), _TEAMS)
    rv = b["revive"]
    assert rv[0] == "$SPAWN,,*"
    assert all(f.startswith("$AMMO,") for f in rv[1:])
    assert not any(f.startswith("$BMAP") for f in rv), "revive must not re-map buttons"
    assert not any("HLOOP" in f for f in rv), "revive drops $HLOOP,0,0 (belongs in end)"


def test_end_and_panic_are_the_known_sequences():
    b = C.compile(_cfg(), _player(), _TEAMS)
    assert b["end"][0] == "$SPAWN,,*" and "$PLAYX,0,*" in b["end"] and b["end"][-1].startswith("$HLED")
    assert b["panic"] == ["$CLEAR,*", "$SP,99,*"]


def test_ammo_comes_from_selected_weapons():
    # assault_rifle mag/reserve = 32/192 ; shotgun = 6/24 (weapons.json)
    b = C.compile(_cfg(), _player(weapons=("assault_rifle", "shotgun")), _TEAMS)
    a0 = [f for f in b["spawn"] if f.startswith("$AMMO,0,")][0]
    a1 = [f for f in b["spawn"] if f.startswith("$AMMO,1,")][0]
    assert a0 == "$AMMO,0,32,192,1,*", a0
    assert a1 == "$AMMO,1,6,24,1,*", a1


# ---- player_num bounds (A5.1) --------------------------------------------
def test_player_num_zero_rejected():
    try:
        C.compile(_cfg(), _player(num=0), _TEAMS)
        assert False, "player_num 0 must be rejected (reserved)"
    except ValueError:
        pass


def test_player_num_over_max_rejected():
    try:
        C.compile(_cfg(), _player(num=MAX_PLAYERS + 1), _TEAMS)
        assert False, "player_num > 63 must be rejected"
    except ValueError:
        pass


# ---- infection team_flip --------------------------------------------------
def test_infection_emits_team_flip():
    b = C.compile(_cfg(mode="infection"), _player(team="blue"), _TEAMS)
    assert "team_flip" in b
    assert "2" in b["team_flip"], "blue player flips to the other team's tid (2)"
    assert b["team_flip"]["2"][0] == "$TID,2,*"


def test_tdm_has_no_team_flip():
    b = C.compile(_cfg(mode="tdm"), _player(), _TEAMS)
    assert "team_flip" not in b


# ---- cues are pre-composed $PLAY frames (A6) -----------------------------
def test_cues_are_full_play_frames():
    cues = C.cues("male")
    assert cues["countdown"] == "$PLAY,VA81,4,6,,,,,*"
    assert cues["kill"] == "$PLAY,,4,6,VAA,,,,*"
    # a cue may be "" = deliberately silent (runway_30/20 until distinct lines are pinned — bench 2026-08-25)
    # Cues are frames the node writes VERBATIM. All are $PLAY except the headset half of the
    # low-health alert, which is the $HLED Callsign sends alongside VA8B (capture 2026-08-23).
    assert all(v.startswith("$PLAY") for k, v in cues.items() if v and not k.endswith("_led"))
    assert cues["hurt_led"] == "$HLED,7,4,90,90,10,15,*"
    assert all(v.startswith("$") and v.endswith(",*") for v in cues.values() if v)
    assert cues["runway_10"].startswith("$PLAY"), "the T-10 count stays audible"


def test_cues_kill_line_varies_by_voice():
    assert C.cues("heavy")["kill"] == "$PLAY,,4,6,V3A,,,,*"


# ---- tutorial (§4) --------------------------------------------------------
def test_tutorial_is_reduced_and_identity_zero():
    frames = C.tutorial_frames({"weapon_id": "smg", "name": "SMG", "cls": "1", "stats": {},
                                "weap_frame": ""}, "outdoor")
    # bench 2026-08-25: a try-out gun must actually FIRE, which needs $START + a $TID + a $SIR row
    # (without $START the trigger only reloads); identity 0 keeps any stray hit off the scoreboard.
    assert "$START,*" in frames, "tutorial needs $START to fire"
    assert any(f.startswith("$TID") for f in frames), "tutorial needs a team to spawn-to-live"
    assert any(f.startswith("$SIR") for f in frames), "tutorial needs a $SIR row so a shot registers"
    assert any(f.startswith("$SPAWN") for f in frames), "tutorial spawns the gun live"
    assert any(f.startswith("$PSET,0,") for f in frames), "tutorial identity is 0 (uncredited)"
    from brx_mcp.mc.compile import VOL_TRYOUT
    assert f"$VOL,{VOL_TRYOUT},0,*" in frames  # audible
    assert any(f.startswith("$WEAP,0,") for f in frames)


# ---- validate() → {ok, errors, warnings} (A6) ----------------------------
def test_validate_ok_tdm():
    r = C.validate(_cfg(), [_player(num=1), _player(num=2)])
    assert r["ok"] and not r["errors"]


def test_validate_requires_time_limit_unless_full_coverage():
    r = C.validate(_cfg(time_limit_s=None), [_player(num=1)])
    assert not r["ok"] and any("time_limit_s" in e for e in r["errors"])
    r2 = C.validate(_cfg(time_limit_s=None), [_player(num=1)], {"coverage": "full"})
    assert r2["ok"], "full coverage lifts the time_limit requirement"


def test_validate_duplicate_player_num():
    r = C.validate(_cfg(), [_player(num=5), _player(num=5)])
    assert not r["ok"] and any("duplicate player_num" in e for e in r["errors"])


def test_validate_player_num_zero_is_error():
    r = C.validate(_cfg(), [_player(num=0)])
    assert not r["ok"]


def test_validate_frag_limit_without_coverage_warns_not_errors():
    r = C.validate(_cfg(frag=25), [_player(num=1)])
    assert r["ok"], "frag_limit must not be a hard error"
    assert any("frag_limit" in w for w in r["warnings"]), "it should WARN (A6)"


def test_validate_unknown_weapon():
    p = _player()
    p["loadout"]["weapons"] = [{"weapon_id": "death_ray"}]
    r = C.validate(_cfg(), [p])
    assert not r["ok"] and any("death_ray" in e for e in r["errors"])


# ---- catalog --------------------------------------------------------------
def test_catalog_excludes_hidden_melee_and_flags_verified():
    cat = WeaponCatalog()
    ids = [w["weapon_id"] for w in cat.all()]
    assert "melee" not in ids, "hidden melee is not in the visible picker"
    assert len(ids) == 18, f"the §3 roster is 18 weapons, got {len(ids)}"
    by = {w["weapon_id"]: w for w in cat.all()}
    # `verified` now means SHIPPED EXACTLY AS CAPTURED — the AR is rebalanced (140ms, not the
    # captured 100ms), the burst rifle ships stock. Every weapon has its own captured base frame.
    assert by["assault_rifle"]["verified"] is False
    assert by["burst_rifle"]["verified"] is True
    # every visible weapon carries an armory blurb (weapons.json `desc` -> Weapon.desc)
    blank = [w["weapon_id"] for w in cat.all() if not (w.get("desc") or "").strip()]
    assert not blank, f"weapons missing desc: {blank}"
    assert "140ms" in by["assault_rifle"]["desc"], by["assault_rifle"]["desc"]
    assert by["rail_gun"]["desc"].strip().endswith("."), by["rail_gun"]["desc"]


def test_every_weapon_is_based_on_its_own_captured_frame():
    """The whole roster is re-based on real Callsign frames (protocol/captures/raw/) — no templates."""
    import json, pathlib
    rows = json.loads((pathlib.Path(__file__).resolve().parents[1]
                       / "brx_mcp/mc/weapons.json").read_text())["weapons"]
    assert len(rows) == 19
    for w in rows:
        cap = w.get("capture") or {}
        assert cap.get("frame", "").startswith("$WEAP,"), f"{w['weapon_id']} has no captured frame"
        assert cap.get("src", "").endswith(".btsnoop"), f"{w['weapon_id']} has no capture source"
        assert w.get("captured") is True


def test_resolve_changes_only_the_balance_tokens_of_the_captured_frame():
    """resolve() emits the weapon's OWN captured frame; only slot + the balance tokens move."""
    import json, pathlib
    rows = {w["weapon_id"]: w for w in json.loads(
        (pathlib.Path(__file__).resolve().parents[1] / "brx_mcp/mc/weapons.json").read_text())["weapons"]}
    T = WeaponCatalog._T
    balance = {1, T["dmg"] + 1, T["fire"] + 1, T["mag"] + 1, T["clipstart"] + 1,
               T["reserve"] + 1, T["reserve_half"] + 1, T["reload"] + 1}
    cat = WeaponCatalog()
    for wid, row in rows.items():
        allowed = balance | {int(k.lstrip("tT")) + 1 for k in (row.get("overrides") or {})}
        got = cat.resolve(wid, 0).split(",")
        want = row["capture"]["frame"].split(",")
        assert len(got) == len(want), wid
        for i, (a, b) in enumerate(zip(got, want)):
            if i not in allowed:
                assert a == b, f"{wid} tok{i - 1} drifted from the capture: {b!r} -> {a!r}"


def test_every_override_is_declared_named_and_justified():
    """`overrides` is the only sanctioned deviation from a capture outside the balance tokens, so
    every entry must name a documented token, carry a value, and say why (bench evidence)."""
    import json, pathlib
    rows = json.loads((pathlib.Path(__file__).resolve().parents[1]
                       / "brx_mcp/mc/weapons.json").read_text())["weapons"]
    seen = 0
    for w in rows:
        for key, ov in (w.get("overrides") or {}).items():
            seen += 1
            assert int(key.lstrip("tT")) in WeaponCatalog._NAMED, f"{w['weapon_id']} {key} unnamed"
            assert str(ov.get("value", "")).strip(), f"{w['weapon_id']} {key} has no value"
            assert len(str(ov.get("why", "")).strip()) > 20, f"{w['weapon_id']} {key} needs a real why"
    assert seen >= 4, "the bench sound swaps should still be declared"


def test_override_mechanism_rejects_undeclared_and_unnamed_writes():
    base = {"weapon_id": "x", "name": "X", "cls": 0, "mag": 4, "reserve": 8, "reload_ms": 1000,
            "dmg": 1, "rof": 1, "rng": 1,
            "capture": {"src": "t.btsnoop", "frame": "$WEAP,0,,100,0,0,40,0,,,,,,,,300,850,4,8,"
                                                    "1000,0,7,100,100,,0,,,S16,,,,D04,D03,D21,D18,"
                                                    ",,,,4,4,75,*"}}
    ok = WeaponCatalog(rows=[{**base, "overrides": {"t33": {"value": "D02", "why": "bench: D21 chirps"}}}])
    assert ok.resolve("x", 0).split(",")[34] == "D02"
    for bad in ({"t33": {"value": "D02"}},                       # no why
                {"t33": {"why": "because"}},                     # no value
                {"t99": {"value": "D02", "why": "out of range"}},  # not a named token
                {"nope": {"value": "D02", "why": "bad key shape"}}):
        try:
            WeaponCatalog(rows=[{**base, "overrides": bad}]).resolve("x", 0)
            assert False, f"override {bad} should have been rejected"
        except ValueError:
            pass


def test_bench_sound_swaps_are_applied():
    """Field range 2026-08-26: D21 fires a 'disable' chirp; the Energy Launcher's J15 is a music sting."""
    cat, T = WeaponCatalog(), WeaponCatalog._T
    for wid in ("sniper_rifle", "amr", "force_rifle"):
        chain = [cat.resolve(wid, 0).split(",")[T[k] + 1] for k in ("rel1", "rel2", "rel3")]
        assert "D21" not in chain, f"{wid} still plays the disable chirp: {chain}"
        assert chain[2] == "D02", chain
    assert cat.resolve("bolt_rifle", 0).split(",")[T["rel3"] + 1] == "D02", \
        "bolt_rifle never carried D21 — its captured chain already ended on D02, so it needs no override"
    p = cat.resolve("energy_launcher", 0).split(",")
    assert p[T["snd_fire"] + 1] == "O01" and "J15" not in p


def test_resolve_keeps_the_captured_ammo_invariants():
    """Every captured frame obeys tok39 == tok16 and tok17 == 2 * tok40; our rewrites must too."""
    cat, T = WeaponCatalog(), WeaponCatalog._T
    for w in cat.all():
        p = w["weap_frame"].split(",")
        assert p[T["clipstart"] + 1] == p[T["mag"] + 1], f"{w['weapon_id']}: tok39 != tok16"
        assert int(p[T["reserve"] + 1]) == 2 * int(p[T["reserve_half"] + 1]), \
            f"{w['weapon_id']}: tok17 != 2*tok40"


def test_resolve_provisional_substitutes_mag_reserve():
    """Fallback path for a provisional weapon WITHOUT a wire table: mag/clipstart/reserve/reload land on the
    CORRECT tokens (doc tokN == split()[N+1]; the old indices wrote mag into rate-of-fire)."""
    from brx_mcp.mc.compile import WeaponCatalog
    cat = WeaponCatalog(rows=[{"weapon_id": "x", "name": "X", "cls": 0, "mag": 9, "reserve": 99,
                               "reload_ms": 777, "dmg": 1, "rof": 1, "rng": 1, "base": "ar", "verified": False}])
    p = cat.resolve("x", 0).split(",")
    assert p[17] == "9" and p[40] == "9", "mag + clipStartingAmmo"
    assert p[41] == "99", "ammo reserve"
    assert p[19] == "777", "reload ms"
    assert p[16] == "850", "rate-of-fire keeps the sample value (was being clobbered by mag)"

# ---- mag >= htk invariant (docs/weapon-design.md §2.1) ---------------------
def test_hits_to_kill_reads_the_resolved_frame():
    cat = WeaponCatalog()
    # rebalanced: wire.dmg wins. sniper 60 -> 2 hits at the 45+70 default pool
    assert cat.damage("sniper_rifle") == 60
    assert cat.hits_to_kill("sniper_rifle", 115) == 2
    # untuned damage is read back out of the captured frame — the AR really deals 9 (bench exp 2),
    # the manual's 24 was stale (docs/reference/weapons.md)
    assert cat.damage("assault_rifle") == 9
    assert cat.hits_to_kill("assault_rifle", 115) == 13


def test_validate_rejects_weapon_that_cannot_kill_on_one_magazine():
    """The invariant the pre-rebalance rail gun broke: mag 1 while needing 2 hits at the 115 pool.
    Pinned on a synthetic row so the test keeps testing the RULE after the roster is retuned."""
    broken = WeaponCatalog(rows=[{"weapon_id": "coilgun", "name": "Coilgun", "cls": 7, "mag": 1,
                                  "reserve": 6, "reload_ms": 2400, "dmg": 78, "rof": 25, "rng": 75,
                                  "base": "ar", "wire": {"dmg": 90}}])
    r = Compiler(broken).validate(_cfg(), [_player(weapons=("coilgun",))])
    assert not r["ok"]
    assert any("coilgun cannot kill on one magazine: mag 1 < 2 hits at 90 dmg vs 115 pool" in e
               for e in r["errors"]), r["errors"]


def test_validate_accepts_weapons_that_can_kill_on_one_magazine():
    r = C.validate(_cfg(), [_player(weapons=("assault_rifle", "shotgun"))])
    assert not any("one magazine" in e for e in r["errors"]), r["errors"]


def test_mag_invariant_follows_the_per_player_health_override():
    """Pool is per-player: an override that raises hp/armor can push a legal weapon over the line.
    sniper_rifle is mag 4 / 60 dmg -> 2 hits at 115 (legal), 5 hits at 300 (illegal)."""
    ok = _player(weapons=("sniper_rifle",))
    assert not any("one magazine" in e for e in C.validate(_cfg(), [ok])["errors"])
    over = _player(weapons=("sniper_rifle",))
    over["loadout"]["overrides"] = {"max_hp": 150, "max_armor": 150}
    errs = C.validate(_cfg(), [over])["errors"]
    assert any("sniper_rifle cannot kill on one magazine" in e for e in errs), errs
    assert any("mag 4 < 5 hits at 60 dmg vs 300 pool" in e for e in errs), errs


def test_mag_invariant_reports_each_weapon_once_per_pool():
    """Two players carrying the same broken weapon is one error, not two."""
    ov = {"max_hp": 150, "max_armor": 150}
    a, b = _player(num=7, weapons=("sniper_rifle",)), _player(num=8, weapons=("sniper_rifle",))
    a["loadout"]["overrides"] = b["loadout"]["overrides"] = ov
    errs = [e for e in C.validate(_cfg(), [a, b])["errors"] if "one magazine" in e]
    assert len(errs) == 1, errs


# ---- $SIR effect guard (weapon-design.md §6.2) -----------------------------
def test_sir_effect_guard_is_WARNING_ONLY_promote_to_error_with_the_energy_launcher_fix():
    """⚠ INTENTIONALLY A WARNING, TEMPORARILY.

    A weapon's damage is a property of the (weapon, `$SIR` table) PAIR — its `<t3,t4>` keys a row
    whose FUNCTION decides what the IR magnitude does. The Energy Launcher keys `$SIR,9,3,,24`, a
    status row, and deals ZERO damage in every game we ship — while passing the mag>=htk invariant
    clean, because that computes on raw t5.

    Promote the missing-row and no-pool cases to ERRORS in the same commit that fixes the Energy
    Launcher (flatten `_SIR_TABLE` to fn 1, or move the weapon off `<9,3>`), when a clean pass is
    achievable. This test name is the reminder; rename it when you do.
    """
    r = C.validate(_cfg(), [_player(weapons=("energy_launcher",))])
    assert r["ok"] is True, "warning-only for now — promote with the Energy Launcher fix"
    assert not r["errors"]
    assert any("DEALS NO DAMAGE" in w and "energy_launcher" in w for w in r["warnings"]), r["warnings"]


def test_sir_guard_flags_multiplier_rows_because_published_htk_is_computed_on_raw_t5():
    r = C.validate(_cfg(), [_player(weapons=("burst_rifle", "sniper_rifle"))])
    warns = " ".join(r["warnings"])
    assert "burst_rifle" in warns and "2.0x" in warns, r["warnings"]      # $SIR <0,3> -> fn 37
    assert "sniper_rifle" in warns and "1.25x" in warns, r["warnings"]    # $SIR <0,1> -> fn 36


def test_sir_guard_stays_quiet_for_plain_damage_weapons():
    r = C.validate(_cfg(), [_player(weapons=("assault_rifle", "shotgun"))])
    assert not any("$SIR" in w for w in r["warnings"]), r["warnings"]


def test_sir_guard_flags_a_weapon_with_no_row_at_all():
    """The quietest failure of the lot: no row means every hit is silently dropped."""
    orphan = WeaponCatalog(rows=[{"weapon_id": "orphan", "name": "Orphan", "cls": 0, "mag": 8,
                                  "reserve": 8, "reload_ms": 1000, "dmg": 1, "rof": 1, "rng": 1,
                                  "capture": {"src": "t.btsnoop",
                                              "frame": "$WEAP,0,,100,4,2,40,0,,,,,,,,300,850,8,8,1000,"
                                                       "0,7,100,100,,0,,,S16,,,,D04,D03,D02,D18,,,,,"
                                                       "8,4,75,*"}}])
    r = Compiler(orphan).validate(_cfg(), [_player(weapons=("orphan",))])
    assert any("NO ROW" in w for w in r["warnings"]), r["warnings"]


def test_sir_guard_flags_the_uncharacterised_and_helpful_functions():
    """The guard is an ALLOW-LIST on purpose.

    Only the bench-confirmed plain-damage set {1,4,5,7,29,30,33,38} is silent. Everything else
    warns — because the failure we are guarding against (a weapon that cannot hurt anyone, or one
    that HEALS what it shoots) lives precisely in the functions nobody has characterised. The
    shipped `_SIR_TABLE` only exercises fns {1,24,36,37,38}, so these branches are unreachable
    without repointing the table.
    """
    import brx_mcp.mc.compile as CM
    base = [r for r in CM._SIR_TABLE if not r.startswith("$SIR,0,0,")]

    def warns_for(fn):
        orig = CM._SIR_TABLE
        try:
            CM._SIR_TABLE = tuple(base + [f"$SIR,0,0,,{fn},0,0,1,,*"])
            return " ".join(C.validate(_cfg(), [_player(weapons=("assault_rifle",))])["warnings"])
        finally:
            CM._SIR_TABLE = orig

    assert "a GRANT" in warns_for(11), "fn 11 adds SHIELDS — it would heal the target"
    dual = warns_for(16)
    assert "a GRANT" in dual and "DUAL-POLARITY" in dual, "fn 16 heals allies but still damages enemies"
    assert "ARMOR-PIERCING" in warns_for(2), "fn 2 bypasses armor AND shields — htk is ceil(hp/dmg)"
    assert "uncharacterised" in warns_for(99), "an unknown function must never pass silently"
    assert warns_for(1) == "" or "assault_rifle" not in warns_for(1), "fn 1 is plain damage: stay quiet"


def test_sir_guard_reports_each_weapon_once():
    a, b = _player(num=7, weapons=("energy_launcher",)), _player(num=8, weapons=("energy_launcher",))
    warns = [w for w in C.validate(_cfg(), [a, b])["warnings"] if "energy_launcher" in w]
    assert len(warns) == 1, warns


# ---- medals ---------------------------------------------------------------
def test_award_medals_basic():
    rows = [
        {"player_id": "a", "display": "A", "team_id": "blue", "kills": 10, "deaths": 2,
         "assists": 3, "shots": 100, "hits": 40, "accuracy": 0.4, "kd": 5.0, "streak": 4, "medals": []},
        {"player_id": "b", "display": "B", "team_id": "yellow", "kills": 4, "deaths": 8,
         "assists": 1, "shots": 90, "hits": 20, "accuracy": 0.22, "kd": 0.5, "streak": 1, "medals": []},
        {"player_id": "c", "display": "C", "team_id": "yellow", "kills": 1, "deaths": 6,
         "assists": 0, "shots": 40, "hits": 5, "accuracy": 0.13, "kd": 0.17, "streak": 1, "medals": []},
    ]
    kills = [{"t": 100, "killer": "b", "victim": "a", "multi": 1},
             {"t": 200, "killer": "a", "victim": "b", "multi": 2}]
    m = C.award_medals(rows, kills)
    assert "MVP" in m["a"] and "TOP_GUN" in m["a"]
    assert "FIRST_BLOOD" in m["b"], "b got the earliest kill"
    assert "DOUBLE_KILL" in m["a"]
    assert "SURVIVALIST" in m["a"], "a has fewer deaths"


# ---- the shared golden bundle (M10) --------------------------------------
def test_golden_bundle_json_matches_the_compiler():
    """The checked-in fixture is consumed by the phone app's tests and its demo mode, so a compiler
    change that does not regenerate it silently splits the two. It drifted exactly that way when play
    volume moved off 69 (review 2026-08-31), and the shape-only test below could not see it."""
    import json, pathlib
    p = pathlib.Path(__file__).resolve().parents[1] / "brx_mcp" / "mc" / "golden_bundle.json"
    on_disk = json.loads(p.read_text())
    assert on_disk == golden_bundle(), (
        "golden_bundle.json is stale — regenerate it:\n"
        "  python -c \"import json;from brx_mcp.mc.compile import golden_bundle;"
        "open('mcp/brx_mcp/mc/golden_bundle.json','w').write(json.dumps(golden_bundle(),indent=2)+chr(10))\"")


def test_golden_bundle_is_well_formed():
    b = golden_bundle()
    for k in ("head", "spawn", "revive", "end", "panic", "cues"):
        assert k in b and b[k]
    assert b["head"][-1] == "$TID,1,*"
    assert b["player_id"] == "p-golden" and b["config_id"] == "golden-tdm"


def test_award_medals_gated_for_tiny_rosters():
    """Design review 2026-08-26 #3: no participation trophies — < 3 scored players → no honors."""
    row = {"player_id": "a", "display": "A", "team_id": "blue", "kills": 0, "deaths": 1,
           "assists": 0, "shots": 10, "hits": 0, "accuracy": 0.0, "kd": 0.0, "streak": 0, "medals": []}
    assert C.award_medals([row], []) == {"a": []}
    assert C.award_medals([row, {**row, "player_id": "b"}], []) == {"a": [], "b": []}


# ---- native behaviour inherited from the captured frames --------------------
def test_captured_native_behaviour_survives_resolve():
    """The point of re-basing: behaviours we cannot synthesise ride along in the captured frame."""
    cat, T = WeaponCatalog(), WeaponCatalog._T
    tok = lambda wid, n: cat.resolve(wid, 0).split(",")[n + 1]
    assert tok("burst_rifle", T["burst"]) == "275", "3-round burst time (tok23) is Callsign's own"
    assert tok("force_rifle", T["burst"]) == "250"
    assert tok("burst_rifle", T["burst"]) != tok("force_rifle", T["burst"]), "two distinct bursts"
    for wid, heat in (("smg", "5"), ("charge_rifle", "14"), ("plasma_sniper", "30"),
                      ("energy_rifle", "6")):
        assert tok(wid, T["heat"]) == heat, f"{wid} overheat (tok24)"
    assert tok("shotgun", 19) == "2", "shotgun reload type = Shells — never set by the old templates"
    assert tok("melee", 3) == "13", "melee damage type = MeleeDamage (tok3)"
    assert tok("rocket_launcher", 3) == "10" and tok("rail_gun", 3) == "6"
    # per-weapon reload chains, not one shared D04+D03+D02
    chains = {w["weapon_id"]: tuple(w["weap_frame"].split(",")[T[k] + 1] for k in ("rel1", "rel2", "rel3"))
              for w in cat.all()}
    assert chains["shotgun"] == ("D01", "D28", "D27")
    assert chains["smg"] == ("D26", "D25", "D24")
    assert len(set(chains.values())) >= 8, f"expected many distinct reload chains, got {len(set(chains.values()))}"
    # charge tell: the rail gun and laser cannon have a charge-up sound the old build blanked
    assert tok("rail_gun", T["snd_up"]) == "C08"
    assert tok("laser_cannon", T["snd_up"]) == "C11"


def test_fire_interval_is_written_at_tok14_and_850_is_never_touched():
    cat, T = WeaponCatalog(), WeaponCatalog._T
    p = cat.resolve("assault_rifle", 0).split(",")
    assert p[T["fire"] + 1] == "140", "rebalanced fire interval lands at tok14 (raw idx15)"
    assert p[T["fire"] + 2] == "850", "the unidentified constant at tok15 is never written"


def test_shipped_roster_satisfies_the_mag_invariant_at_the_default_pool():
    """Regression guard for the whole roster, not just the two weapons that used to break."""
    cat = WeaponCatalog()
    bad = [w["weapon_id"] for w in cat.all()
           if int(cat._row(w["weapon_id"])["mag"]) < cat.hits_to_kill(w["weapon_id"], 115)]
    assert not bad, f"weapons that cannot kill on one magazine at the 115 pool: {bad}"


def test_ttk_band_and_no_strictly_dominant_weapon():
    """docs/weapon-design.md §2: every picker weapon lands in the 1.5-3.5s band (one-shot power
    weapons excepted), and no weapon beats another on TTK, sustained DPS and total kills at once."""
    cat = WeaponCatalog()
    rows = []
    for w in cat.all():
        r = cat._row(w["weapon_id"])
        htk = cat.hits_to_kill(w["weapon_id"], 115)
        p = w["weap_frame"].split(",")
        fire = int(p[WeaponCatalog._T["fire"] + 1])
        burst = p[WeaponCatalog._T["burst"] + 1]
        per = (2 * fire + int(burst)) / 3 if burst else fire
        ttk = htk * fire if w["weapon_id"] in ("charge_rifle", "laser_cannon", "rail_gun") \
            else (htk - 1) * per
        rows.append({"id": w["weapon_id"], "htk": htk, "ttk": ttk,
                     "sust": r["mag"] * cat.damage(w["weapon_id"]) / (r["mag"] * per + r["reload_ms"]),
                     "tk": (r["mag"] + r["reserve"]) // htk})
    for r in rows:
        if r["htk"] > 1:
            assert 1500 <= r["ttk"] <= 3500, f"{r['id']} TTK {r['ttk']}ms is outside the 1.5-3.5s band"
    pick = [r for r in rows if r["htk"] > 1]
    for a in pick:
        for b in pick:
            if a is b:
                continue
            dominates = (a["ttk"] <= b["ttk"] and a["sust"] >= b["sust"] and a["tk"] >= b["tk"]
                         and (a["ttk"] < b["ttk"] or a["sust"] > b["sust"] or a["tk"] > b["tk"]))
            assert not dominates, f"{a['id']} strictly dominates {b['id']}"


import json
import pathlib


# ── polish-loop 2026-08-26 deferred lows, closed 2026-09-01 ──────────────────────────────────────
def test_an_odd_reserve_never_splits_the_frame_from_the_hud():
    """`tok17 == 2 * tok40` holds on all 19 captured frames, so an odd reserve cannot be written.

    It used to floor tok40 inside `resolve()` alone — the gun got one round less than `spawn_ammo()`
    had already told the phone's HUD it had. Both now round through `_mods`, so they cannot disagree.
    """
    from brx_mcp.mc.compile import WeaponCatalog
    cat = WeaponCatalog()
    # the NO-MODS path too: there it is the catalog's own reserve that reaches the wire, and an odd
    # one would break the invariant just as quietly (review 2026-09-01)
    odd = WeaponCatalog([{**json.loads((pathlib.Path(__file__).resolve().parents[1] /
                                        "brx_mcp" / "mc" / "weapons.json").read_text())["weapons"][0],
                          "reserve": 193}])
    f = odd.resolve("assault_rifle", 0).split(",")
    t17, t40 = int(f[WeaponCatalog._T["reserve"] + 1]), int(f[WeaponCatalog._T["reserve_half"] + 1])
    assert t17 == 2 * t40 and t17 == 192, f"odd catalog reserve broke the invariant: {t17}/{t40}"
    assert odd.spawn_ammo("assault_rifle")[1] == t17, "the HUD must be told what the gun got"

    for mult in (0.5, 0.77, 1.0, 1.15, 1.5, 2.0):
        for wid in ("assault_rifle", "shotgun", "energy_rifle", "rocket_launcher"):
            mods = {"ammo_mult": mult}
            _mag, reserve = cat.spawn_ammo(wid, mods)
            f = cat.resolve(wid, 0, mods).split(",")
            t16, t17 = int(f[WeaponCatalog._T["mag"] + 1]), int(f[WeaponCatalog._T["reserve"] + 1])
            t39, t40 = int(f[WeaponCatalog._T["clipstart"] + 1]), int(f[WeaponCatalog._T["reserve_half"] + 1])
            assert t17 == reserve, f"{wid} @ {mult}: frame says {t17}, the HUD was told {reserve}"
            assert t17 == 2 * t40 and t39 == t16, f"{wid} @ {mult}: invariant broken"
            assert reserve % 2 == 0, f"{wid} @ {mult}: odd reserve {reserve} cannot be expressed"


def test_an_override_may_not_write_an_ammo_token():
    """An override runs LAST, after the ammo trio, so an ammo token there lands outside `resolve()`'s
    invariants and ships a frame no captured Callsign frame has ever looked like."""
    from brx_mcp.mc.compile import WeaponCatalog
    base = dict(weapon_id="x", name="X", cls=0, mag=10, reserve=20, reload_ms=1000,
                dmg=9, rof=50, rng=75,
                capture={"frame": WeaponCatalog().resolve("assault_rifle", 0)})
    for tok in ("t16", "t17", "t18", "t39", "t40"):
        cat = WeaponCatalog([{**base, "overrides": {tok: {"value": "7", "why": "because"}}}])
        try:
            cat.resolve("x", 0)
            assert False, f"{tok} was accepted as an override"
        except ValueError as e:
            assert "AMMO token" in str(e), e
    # a NON-ammo token is still allowed — this guard must not close the escape hatch itself
    cat = WeaponCatalog([{**base, "overrides": {"t33": {"value": "D09", "why": "bench: reload chirps"}}}])
    assert cat.resolve("x", 0).split(",")[34] == "D09"


def test_validate_grades_against_the_pool_the_gun_is_ARMED_with():
    """`validate()`'s mag>=htk gate used to build a THIRD pool arithmetic that omitted the
    `body_armor` perk and the 255 cap, so it graded that player at 115 while the gun was armed at
    165 — and used the raw catalog mag rather than the one an `ammo_mult` perk actually grants
    (review 2026-09-01). All three arithmetics must agree."""
    from brx_mcp.mc.compile import Compiler
    c = Compiler()
    cfg = dict(_cfg(), health={"max_hp": 45, "max_armor": 70})

    def roster(perk, wid="sniper_rifle"):
        return [{"player_id": "p", "display": "P", "player_num": 1, "team_id": "blue",
                 "loadout": {"weapons": [{"weapon_id": wid}], "perk": perk}}]

    # the pool the compiler ARMS with, straight off $PSET, for both perk states
    def armed_pool(perk):
        head = c.compile(cfg, roster(perk)[0], cfg["teams"])["head"]
        t = next(f for f in head if f.startswith("$PSET")).split(",")
        return int(t[3]) + int(t[4])

    assert armed_pool(None) == 115 and armed_pool("body_armor") == 165

    # a weapon whose magazine is exactly enough at 115 but NOT at 165 must be reported for the
    # armoured player. The sniper: 60 dmg, mag 4 -> htk 2 at 115, htk 3 at 165; still fine. Use a
    # synthetic roster pool instead so the assertion does not depend on the shipped balance.
    hi = dict(cfg, health={"max_hp": 45, "max_armor": 250})       # 295 base, +50 perk -> capped 255
    head = c.compile(hi, roster("body_armor")[0], hi["teams"])["head"]
    t = next(f for f in head if f.startswith("$PSET")).split(",")
    assert int(t[4]) == 255, "armour is capped at the policy ceiling"
    armed = 45 + 255                                     # what the gun is actually armed with
    # validate() must quote that CAPPED pool, not the uncapped 45 + (250 + 50) = 345
    errs = c.validate(hi, roster("body_armor", "rail_gun"))["errors"]
    quoted = [e for e in errs if " pool " in e]
    assert quoted, "the rail gun cannot kill on one magazine at this pool — expected an error"
    for e in quoted:
        assert f" {armed} pool" in e, f"validate did not use the armed pool ({armed}): {e}"
        assert " 345 pool" not in e, f"validate used the UNCAPPED pool: {e}"

    # and the perk must actually move the grade: without it the same config is a smaller pool
    plain = [e for e in c.validate(hi, roster(None, "rail_gun"))["errors"] if " pool " in e]
    assert plain and " 295 pool" in plain[0], plain


def test_validate_uses_the_magazine_the_perk_actually_grants():
    """An `ammo_mult` perk changes the magazine the gun is given; the gate must grade THAT."""
    from brx_mcp.mc.compile import Compiler, WeaponCatalog
    c = Compiler()
    # a weapon that cannot kill on one mag at the base size, but can once a perk enlarges it
    rows = [{**json.loads((pathlib.Path(__file__).resolve().parents[1] / "brx_mcp" / "mc" /
                           "weapons.json").read_text())["weapons"][0],
             "weapon_id": "tiny", "mag": 4, "reserve": 8}]
    c.catalog = WeaponCatalog(rows)
    cfg = dict(_cfg(), health={"max_hp": 45, "max_armor": 70})

    def player(perk):
        return [{"player_id": "p", "display": "P", "player_num": 1, "team_id": "blue",
                 "loadout": {"weapons": [{"weapon_id": "tiny"}], "perk": perk}}]

    # mag 4 vs htk 13 at the 115 pool: cannot kill on one magazine
    errs = c.validate(cfg, player(None))["errors"]
    assert any("mag 4 <" in e for e in errs), errs

    # `extended_mags` doubles it (perks.json ammo_mult: 2). The gate must grade the magazine the gun
    # is GIVEN, not the catalog's — the raw-`mag` version reported 4 for a gun that was handed 8.
    errs2 = c.validate(cfg, player("extended_mags"))["errors"]
    granted = c.catalog._ammo("tiny", {"ammo_mult": 2})[0]
    assert granted == 8, granted
    quoted = [e for e in errs2 if "cannot kill on one magazine" in e]
    assert quoted, errs2
    for e in quoted:
        assert f"mag {granted} <" in e, f"validate graded the catalog mag, not the granted one: {e}"
        assert "mag 4 <" not in e, e


def test_what_the_captures_actually_say_about_HLED():
    """The `$HLED` head frame's comment cites captures on disk. Check it against them.

    Review 2026-09-01 found the original comment overstated the evidence: it called the frame one
    Callsign "sends in EVERY captured game" as part of the game head, and asserted that its token 1
    is a team colour. The captures say something narrower, and this pins what they actually contain
    so the comment cannot drift back. If a NEW capture changes these numbers, update the comment in
    `compile.py` in the same commit.
    """
    import re
    caps = sorted((pathlib.Path(__file__).resolve().parents[2] / "protocol" / "captures").glob("*.txt"))
    assert caps, "no captures on disk to check against"

    hled, gled, tid_frames = [], [], 0
    lobby_evidence = []
    for c in caps:
        lines = c.read_text(errors="replace").splitlines()
        stamped = []
        for ln in lines:
            m = re.match(r"\[\s*([\d.]+)s\]\s*>>\s*(\$\w+)", ln)
            if m:
                stamped.append((float(m.group(1)), m.group(2), ln))
        tid_frames += sum(1 for _, f, _ in stamped if f == "$TID")
        first_arm = next((t for t, f, _ in stamped if f in ("$CLEAR", "$START")), None)
        for t, f, ln in stamped:
            if f == "$HLED":
                hled.append((c.name, t, ln))
                # token 7 is the in-play low-health alert and 6/empty is the end-of-game blank;
                # only the COLOUR frames (0/1) are the lobby ones this claim is about
                if first_arm is not None and ln.split(",")[1].strip() in ("0", "1"):
                    lobby_evidence.append((c.name, t, first_arm))
            elif f == "$GLED":
                gled.append((c.name, t, ln))

    assert hled, "no $HLED in any capture"
    # 1. every COLOUR $HLED lands BEFORE the arm sequence — it is a lobby frame, not a head frame
    for name, t, arm in lobby_evidence:
        assert t < arm, f"{name}: $HLED colour at {t}s is not before the arm sequence at {arm}s"
    assert lobby_evidence, "expected at least one colour $HLED to compare against an arm sequence"

    # 1b. ...and the token-7 alert is the opposite: it fires DURING play, which is why the node
    # sends it as a cue rather than in the head
    alerts = [(n, t) for n, t, ln in hled if ln.split(",")[1].strip() == "7"]
    assert alerts, "no $HLED,7 alert in any capture"


    # 2. token 1 is only ever 0, 1 or 7 (7 = the low-health alert). Never a team id above 1.
    tokens = {ln.split(",")[1].strip() for _, _, ln in hled}
    assert tokens <= {"", "0", "1", "7"}, f"$HLED token 1 took an unseen value: {sorted(tokens)}"

    # 3. NOTHING correlates that token with a team: no capture contains a $TID at all
    assert tid_frames == 0, (f"a capture now contains {tid_frames} $TID frames — the claim that "
                             "$HLED token 1 is a team colour may finally be testable; re-read compile.py")

    # 4. a lit $HLED is always preceded by a $GLED with the SAME token 1, within ~1s
    for name, t, ln in hled:
        tok = ln.split(",")[1].strip()
        if tok in ("", "6", "7"):
            continue
        near = [g for gn, gt, g in gled if gn == name and 0 <= t - gt <= 1.0
                and g.split(",")[1].strip() == tok]
        assert near, f"{name}: $HLED,{tok} at {t}s has no matching $GLED,{tok} in the preceding second"

def test_every_voice_id_exists_in_the_shipped_sound_bank():
    """The rule is "never write a token we cannot name". `$PSET`'s trailing tokens are a positional
    voice pack (APK-derived: deathScream, battleRespawnCry, meleeGrunt, shortPain, longPain,
    painRelief) and we now build them per family by prefix. Every id we can emit must be a REAL
    entry in Callsign's 2166-sound bank — a typo'd family would otherwise ship a silent gun.
    """
    import json, pathlib
    from brx_mcp.gameconfig import VOICE_PACKS, voice_tail
    from brx_mcp.mc.compile import kill_line
    bank_path = pathlib.Path(__file__).resolve().parents[2] / "protocol" / "callsign-extract" / "Sounds.json"
    bank = set(json.loads(bank_path.read_text())["SoundsLengthMap"])
    missing = [(v, i) for v in VOICE_PACKS for i in voice_tail(v) + [kill_line(v)] if i not in bank]
    assert not missing, f"voice ids not in the sound bank: {missing}"


def test_voice_slot_roles_hold_across_every_family():
    """The per-family swap rests on the packs sharing a layout. Two independent checks, both from
    the shipped bank: every family carries all six slot ids, and the DURATIONS agree by role —
    shortPain is the briefest slot in every family and longPain runs materially longer.
    """
    import json, pathlib
    from brx_mcp.gameconfig import VOICE_PACKS, voice_tail
    bank_path = pathlib.Path(__file__).resolve().parents[2] / "protocol" / "callsign-extract" / "Sounds.json"
    lens = json.loads(bank_path.read_text())["SoundsLengthMap"]
    for v in VOICE_PACKS:
        ids = voice_tail(v)                       # death, respawnCry, meleeGrunt, shortPain, longPain, painRelief
        assert all(i in lens for i in ids), v
        short, long_ = lens[ids[3]], lens[ids[4]]
        assert short < long_, f"{v}: shortPain {short:.2f}s is not shorter than longPain {long_:.2f}s"
        assert short <= min(lens[i] for i in ids), f"{v}: shortPain is not the briefest slot"


def test_the_voice_pack_is_per_player_not_hardcoded():
    """It shipped as a constant: every player got the HEAVY pack whatever their `voice` said."""
    hp = next(f for f in C.compile(_cfg(), dict(_player(), voice="heavy"), _TEAMS)["head"] if f.startswith("$PSET,"))
    mp = next(f for f in C.compile(_cfg(), dict(_player(), voice="medic"), _TEAMS)["head"] if f.startswith("$PSET,"))
    assert hp != mp, "the voice pack must follow the player"
    assert ",V33,V3I,V3C,V3G,V3E,V37," in hp      # unchanged from what we shipped
    assert ",V83,V8I,V8C,V8G,V8E,V87," in mp
    # an unknown name falls back rather than emitting a bad family
    assert next(f for f in C.compile(_cfg(), dict(_player(), voice="nope"), _TEAMS)["head"] if f.startswith("$PSET,"))
