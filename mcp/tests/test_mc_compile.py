"""Goldens for the M-MODES FrameBundle compiler (docs/spec/modes.md §8, contracts §3, A5/A6).

Run: python3 run_tests.py mc_compile
Asserts the bundle STRUCTURE (head silent + ends $TID + carries $PSET,<1..63>; spawn/revive/end/panic
shapes), the catalog, validate() {ok,errors,warnings}, tutorial, cues-as-frames, and medals.
"""
import math

from brx_mcp import poolgauge as pg
from brx_mcp.mc.compile import Compiler, WeaponCatalog, golden_bundle
from brx_mcp.mc.types import MAX_PLAYERS
from _session import match_config

C = Compiler()


def test_validate_rejects_an_untyped_win_by_typo():
    cfg = _cfg()
    cfg["scoring"]["win_by"] = "kils"
    result = C.validate(cfg, [])
    assert any("scoring.win_by" in error for error in result["errors"]), result

_TEAMS = [{"team_id": "blue", "name": "Blue", "color": "blue", "tid": 1},
          {"team_id": "yellow", "name": "Yellow", "color": "yellow", "tid": 2}]


def _cfg(mode="tdm", frag=0, time_limit_s=600, led=None):
    return match_config(mode, frag=frag, time_limit_s=time_limit_s, led=led, teams=_TEAMS)


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
    # F121/A23: the REAL $SIR table leads the burst -- the head shipped the same cells disarmed, and
    # this is where hit reception is armed, immediately before the `$SPAWN` that makes the player live.
    sir = [f for f in sp if f.startswith("$SIR")]
    assert sp[:len(sir)] == sir, "the $SIR rows lead the spawn burst"
    rest = sp[len(sir):]
    assert rest[0] == "$PLAYX,0,*" and rest[1] == "$SPAWN,,*"
    sp = rest
    assert not any(f.startswith("$GLED") for f in sp)                    # A11.7: the node takes the body on a timer, not in the burst
    # $BMAP,0,0 closes the T-0 tail. A11.6: the headset is DARK in play by default, so no $HLED follows;
    # with headset.in_play == "team" one does -- see test_headset_team.py.
    assert sp[-1] == "$BMAP,0,0,,,,,*"
    assert any(f.startswith("$AMMO,0,") for f in sp) and any(f.startswith("$AMMO,1,") for f in sp)


def test_revive_is_spawn_plus_ammo_plus_trigger_no_hloop():
    b = C.compile(_cfg(), _player(), _TEAMS)
    rv = b["revive"]
    # F121/A23: the real table leads a revive too -- `engine.js _resyncNotLive` re-writes the (disarmed)
    # HEAD on a live node and revives from there, so a revive that did not re-arm leaves that player
    # immortal for the rest of the match.
    sir = [f for f in rv if f.startswith("$SIR")]
    assert rv[:len(sir)] == sir and sir, "the $SIR rows lead the revive write"
    rv = rv[len(sir):]
    assert rv[0] == "$SPAWN,,*"
    # Bench 2026-09-16: the head holds the trigger, so the revive maps it again (a live resync re-writes the head)
    assert rv[-1] == "$BMAP,0,0,,,,,*"
    assert all(f.startswith("$AMMO,") for f in rv[1:-1])          # A11.6: dark headset in play -> no $HLED tail; A11.7: no $GLED here
    assert [f for f in rv if f.startswith("$BMAP")] == ["$BMAP,0,0,,,,,*"], "revive maps only the trigger"
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


def test_infection_ships_the_take_for_the_team_a_flipped_gun_lands_on():
    """F86: `gun.take` is compiled for the ARMING team; after a flip the node must take the gun with the
    team it is on NOW, or the old colour is painted back over a body the firmware just moved."""
    from brx_mcp import poolgauge as pg
    b = C.compile(_cfg(mode="infection"), _player(team="blue"), _TEAMS)
    assert "team_flip_take" in b and set(b["team_flip_take"]) == set(b["team_flip"])
    take = b["team_flip_take"]["2"]
    assert take[0] == pg.GUN_BLANK and take[1].startswith("$GLED,"), take
    assert take != b["gun"]["take"], "the flipped take must differ from the arming team's"
    assert pg.display_colour(2) != pg.display_colour(1)
    assert str(pg.display_colour(2)) in take[1].split(",")[1:4], take


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
    from brx_mcp.mc.compile import HEADSET_ALERT_BRIGHTNESS
    # token 5 is BRIGHTNESS (same position as $GLED's, pinned 2026-08-30). Callsign ships 10;
    # we run brighter because the alert has to read in daylight. Scale unverified — see the constant.
    assert cues["hurt_led"] == f"$HLED,7,4,90,90,{HEADSET_ALERT_BRIGHTNESS},15,*"
    assert cues["hurt_led"].split(",")[5] == str(HEADSET_ALERT_BRIGHTNESS)
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
    r2 = C.validate(_cfg(time_limit_s=None), [_player(num=1)], {"venue_coverage": "full"})
    assert r2["ok"], "an ASSERTED full-coverage venue lifts the time_limit requirement"
    # A28.4: the DERIVED coverage (every phone on backhaul) must NOT -- a cell signal is less
    # trustworthy than a venue assertion, and a phone that loses data mid-match still needs an end it
    # can reach alone. This is the whole reason the two opts are separate.
    r3 = C.validate(_cfg(time_limit_s=None), [_player(num=1)], {"coverage": "full"})
    assert not r3["ok"] and any("time_limit_s" in e for e in r3["errors"]), \
        "observed backhaul coverage must not unlock time_limit_s: null"


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


def test_validate_rejects_a_team_tid_above_3_f35():
    """F35 (bench 2026-09-07): the IR word's team field is 2 bits -- a $TID of 4+ makes teammates
    damage each other. `state.py` already rejects this at PUT time; this is the compiler's own
    belt-and-braces check for any config that reaches it another way."""
    cfg = _cfg()
    cfg["teams"] = [{"team_id": "blue", "name": "Blue", "color": "blue", "tid": 0},
                    {"team_id": "purple", "name": "Purple", "color": "purple", "tid": 4}]
    r = C.validate(cfg, [_player(team="blue")])
    assert not r["ok"] and any("F35" in e for e in r["errors"])
    ok_cfg = _cfg()
    ok_cfg["teams"] = _TEAMS
    r2 = C.validate(ok_cfg, [_player()])
    assert not any("F35" in e for e in r2["errors"])


# ---- catalog --------------------------------------------------------------
def test_catalog_excludes_hidden_melee_and_flags_verified():
    cat = WeaponCatalog()
    ids = [w["weapon_id"] for w in cat.all()]
    assert "melee" not in ids, "hidden melee is not in the visible picker"
    # 2026-09-17 (arsenal review): force_rifle/bolt_rifle/stinger/plasma_sniper/laser_cannon/
    # ion_sniper/energy_launcher/glock joined melee as `hidden` — 9 pickable primaries + 2 pickable
    # sidearms (usp/deagle) + 2 catalogue-visible-but-pickup_only heavies (rocket_launcher/rail_gun) = 13.
    assert len(ids) == 13, f"the §3 roster is 9 primaries + 2 sidearms + 2 pickup-only heavies, got {len(ids)}"
    by = {w["weapon_id"]: w for w in cat.all()}
    # `verified` now means SHIPPED EXACTLY AS CAPTURED. 2026-09-17 moved two more weapons off it: the
    # AR is rebalanced (now at the captured 100 ms rather than the earlier 140 ms throttle), and the
    # Burst Rifle is rebalanced twice over (dmg 9 -> 11 in the balance pass, and its own outdoor
    # range value t2 in F234's table), so neither ships byte-for-byte any more.
    assert by["assault_rifle"]["verified"] is False
    assert by["burst_rifle"]["verified"] is False
    # every visible weapon carries an armory blurb (weapons.json `desc` -> Weapon.desc)
    blank = [w["weapon_id"] for w in cat.all() if not (w.get("desc") or "").strip()]
    assert not blank, f"weapons missing desc: {blank}"
    assert "100ms" in by["assault_rifle"]["desc"], by["assault_rifle"]["desc"]
    assert by["rail_gun"]["desc"].strip().endswith("."), by["rail_gun"]["desc"]


def test_every_weapon_is_based_on_its_own_captured_frame():
    """The whole roster is re-based on real Callsign frames (protocol/captures/raw/) — no templates."""
    import json, pathlib
    rows = json.loads((pathlib.Path(__file__).resolve().parents[1]
                       / "brx_mcp/mc/weapons.json").read_text())["weapons"]
    assert len(rows) == 22
    for w in rows:
        cap = w.get("capture") or {}
        if w.get("based_on"):        # a sidearm rides another weapon's captured frame (weapons.json `_note`, based_on)
            assert w.get("captured") is False and w["based_on"]["weapon_id"] in {r["weapon_id"] for r in rows}, w["weapon_id"]
            base = next(r for r in rows if r["weapon_id"] == w["based_on"]["weapon_id"])
            assert cap == base["capture"], f"{w['weapon_id']}: capture block must be a verbatim copy of {base['weapon_id']}'s"
        assert cap.get("frame", "").startswith("$WEAP,"), f"{w['weapon_id']} has no captured frame"
        assert cap.get("src", "").endswith(".btsnoop"), f"{w['weapon_id']} has no capture source"
        assert w.get("captured") is (not w.get("based_on"))   # own frame ⇒ captured; a based_on row is honest about not being


def test_resolve_changes_only_the_balance_tokens_of_the_captured_frame():
    """resolve() emits the weapon's OWN captured frame; only slot + the balance tokens move."""
    import json, pathlib
    rows = {w["weapon_id"]: w for w in json.loads(
        (pathlib.Path(__file__).resolve().parents[1] / "brx_mcp/mc/weapons.json").read_text())["weapons"]}
    T = WeaponCatalog._T
    balance = {1, T["dmg"] + 1, T["fire"] + 1, T["mag"] + 1, T["clipstart"] + 1,
               T["reserve"] + 1, T["reserve_half"] + 1, T["reload"] + 1,
               T["swap"] + 1}                                   # tok15 = draw time: `wire.swap_ms` on the sidearms (bench 2026-09-04)
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
    """Field range 2026-08-26: D21 fires a 'disable' chirp; the Energy Launcher's J15 is a music sting.
    The launcher's fire sound was re-picked by ear 2026-09-11 (W4a audition): O06 ("shooting a rocket")
    over the earlier O01 placeholder."""
    cat, T = WeaponCatalog(), WeaponCatalog._T
    for wid in ("sniper_rifle", "amr", "force_rifle"):
        chain = [cat.resolve(wid, 0).split(",")[T[k] + 1] for k in ("rel1", "rel2", "rel3")]
        assert "D21" not in chain, f"{wid} still plays the disable chirp: {chain}"
        assert chain[2] == "D02", chain
    assert cat.resolve("bolt_rifle", 0).split(",")[T["rel3"] + 1] == "D02", \
        "bolt_rifle never carried D21 — its captured chain already ended on D02, so it needs no override"
    p = cat.resolve("energy_launcher", 0).split(",")
    assert p[T["snd_fire"] + 1] == "O06" and "J15" not in p and "O01" not in p


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


def test_validate_warns_when_a_primary_cannot_kill_on_one_magazine():
    """The invariant the pre-rebalance rail gun broke: mag 1 while needing 2 hits at the 115 pool.
    Pinned on a synthetic row so the test keeps testing the RULE after the roster is retuned.

    F146 (field 2026-09-12): a WARNING, not an error. It is a guideline out of a design doc, and as a
    hard error it stood between an operator and the whistle twice at a real match with a line they
    could not act on. It still has to say the slot, the weapon and both numbers."""
    broken = WeaponCatalog(rows=[{"weapon_id": "coilgun", "name": "Coilgun", "cls": 7, "mag": 1,
                                  "reserve": 6, "reload_ms": 2400, "dmg": 78, "rof": 25, "rng": 75,
                                  "base": "ar", "wire": {"dmg": 90}}])
    r = Compiler(broken).validate(_cfg(), [_player(weapons=("coilgun",))])
    assert not any("one magazine" in e for e in r["errors"]), r["errors"]
    said = [w for w in r["warnings"] if "ONE MAGAZINE" in w]
    assert said, r["warnings"]
    assert "PRIMARY COILGUN CANNOT KILL ON ONE MAGAZINE" in said[0], said
    assert "mag 1 < 2 rounds for 2 hits at 90 dmg vs a 115 pool" in said[0], said


# A synthetic pistol that genuinely CANNOT finish a kill on one magazine at the default 115 pool:
# mag 1, 90 dmg -> 2 hits. Tagged `sidearm`, so it is the same row in every slot and the only thing
# that changes between the legs below is WHERE it is carried.
_SIDEARM_ROW_115 = {"weapon_id": "coilgun", "name": "Coilgun", "cls": 7, "mag": 1, "reserve": 6,
                    "reload_ms": 2400, "dmg": 78, "rof": 25, "rng": 75, "base": "ar",
                    "wire": {"dmg": 90}, "tags": ["sidearm"], "role": "sidearm"}
# ...and a plain primary to carry beside it, so the "backup" leg has something in slot 0.
_PRIMARY_ROW = {"weapon_id": "bigrifle", "name": "Big Rifle", "cls": 0, "mag": 30, "reserve": 90,
                "reload_ms": 1400, "dmg": 60, "rof": 54, "rng": 75, "base": "ar", "wire": {"dmg": 60}}


def test_f146_round2_a_sidearm_that_needs_a_reload_WARNS_in_every_slot_and_never_blocks():
    """Round-2 fix pass C (2026-09-12). Two things were wrong here.

    (1) The OLD version of this test was VACUOUS. `sniper_rifle + deagle` and a lone `usp` both kill
    comfortably inside one magazine at the default 115 pool, so neither leg ever reached the guard —
    it asserted the absence of a warning that could not have been emitted whatever the rule said.

    (2) A sidearm carried as the player's ONLY gun was an ERROR. F146 is Tony's field decision that a
    guideline never blocks: the tuning of a weapon against the host's health model is not something an
    operator can act on in the thirty seconds before the whistle, and nothing unkillable ships either
    way — a reload still kills. So every magazine case is a WARNING now, and the wording branches on
    the REAL shape instead of calling a slot-0 sidearm "beside a primary"."""
    side = Compiler(WeaponCatalog(rows=[_SIDEARM_ROW_115, _PRIMARY_ROW]))

    # (i) the LONE sidearm — the gun they fight with
    r = side.validate(_cfg(), [_player(weapons=("coilgun",))])
    assert r["ok"], r["errors"]
    assert not any("one magazine" in e.lower() for e in r["errors"]), r["errors"]
    said = [w for w in r["warnings"] if "one magazine" in w.lower()]
    assert len(said) == 1, r["warnings"]
    assert "coilgun is your only weapon and cannot kill on one magazine" in said[0], said
    assert "mag 1 < 2 rounds for 2 hits at 90 dmg vs 115 pool" in said[0], said

    # (ii) the same pistol as a BACKUP, behind a real primary
    r = side.validate(_cfg(), [_player(weapons=("bigrifle", "coilgun"))])
    assert r["ok"], r["errors"]
    said = [w for w in r["warnings"] if "one magazine" in w.lower()]
    assert len(said) == 1, r["warnings"]
    assert "coilgun is your backup and cannot kill on one magazine" in said[0], said

    # (iii) the same pistol in SLOT 0 with a backup behind it — still the gun they fight with, and the
    # old copy called this one "riding beside a primary", which is exactly backwards.
    r = side.validate(_cfg(), [_player(weapons=("coilgun", "bigrifle"))])
    assert r["ok"], r["errors"]
    said = [w for w in r["warnings"] if "one magazine" in w.lower()]
    assert len(said) == 1, r["warnings"]
    assert "coilgun is the gun you fight with" in said[0], said
    assert "backup" not in said[0].lower(), said

    # CONTROL: a weapon that CAN kill on one magazine says nothing at all, in any slot.
    quiet = side.validate(_cfg(), [_player(weapons=("bigrifle",))])
    assert not any("one magazine" in w.lower() for w in quiet["warnings"]), quiet["warnings"]


def test_f146_the_guard_grades_the_BASE_pool_so_one_players_perk_cannot_ban_a_weapon():
    """Field 2026-09-12: graded against the perk-ARMED pool, Body Armor (+50) took a 140-point pool to
    190 — past what any pistol's magazine can do — so one player taking that perk banned every sidearm
    in the game. A weapon's design is a fact about the weapon and the host's health setting; what a
    player straps on top is not the weapon's fault."""
    tiny = WeaponCatalog(rows=[{"weapon_id": "popgun", "name": "Popgun", "cls": 0, "mag": 13,
                                "reserve": 90, "reload_ms": 1400, "dmg": 10, "rof": 54, "rng": 75,
                                "base": "ar", "wire": {"dmg": 10}}])
    c = Compiler(tiny)
    cfg = dict(_cfg(), health={"max_hp": 45, "max_armor": 70})       # base pool 115 -> htk 12, mag 13
    plain = c.validate(cfg, [_player(weapons=("popgun",))])
    assert not any("ONE MAGAZINE" in w for w in plain["warnings"]), plain["warnings"]
    armoured = _player(weapons=("popgun",))
    armoured["loadout"]["perk"] = "body_armor"                        # armed at 165 -> htk 17 > mag 13
    r = c.validate(cfg, [armoured])
    assert not any("ONE MAGAZINE" in w for w in r["warnings"]), (
        "a perk on one player re-graded the weapon for everyone: " + repr(r["warnings"]))


def test_sidearm_that_cannot_kill_on_one_magazine_is_a_warning_not_an_error():
    """A12 sidearm at a big pool: the backup is allowed to need a reload (Tony's push was blocked twice by
    deagle + body_armor at a 190 pool, 2026-09-12). Same rule, same numbers, a WARNING; a rifle on the
    same numbers is still REPORTED — as F146's primary line. (Integration 2026-09-12 demoted every
    un-killing PRIMARY to a warning; round-2 pass C demoted the last hard case — a sidearm carried as
    the player's only gun — for the same reason, so the whole magazine rule is now advisory. See
    `test_f146_round2_a_sidearm_that_needs_a_reload_WARNS_in_every_slot_and_never_blocks`.)"""
    row = {"weapon_id": "coilgun", "name": "Coilgun", "cls": 7, "mag": 1, "reserve": 6, "reload_ms": 2400,
           "dmg": 78, "rof": 25, "rng": 75, "base": "ar", "wire": {"dmg": 90}}
    # ...as the SECONDARY, beside a primary that can (round-1 polish review 2026-09-12: the exemption is
    # about the slot, not the tag -- as somebody's only gun the same pistol is still an error, below).
    side = Compiler(WeaponCatalog(rows=[{**row, "weapon_id": "workhorse", "mag": 32, "reserve": 96, "tags": ["rifle"]},
                                        {**row, "tags": ["sidearm"], "role": "sidearm"}]))
    r = side.validate(_cfg(), [_player(weapons=("workhorse", "coilgun"))])
    assert not any("one magazine" in e for e in r["errors"]), r["errors"]
    assert any("coilgun is your backup and cannot kill on one magazine at this pool - it will need a reload" in w
               for w in r["warnings"]), r["warnings"]
    rifle = Compiler(WeaponCatalog(rows=[{**row, "tags": ["rifle"]}]))
    r = rifle.validate(_cfg(), [_player(weapons=("coilgun",))])
    # A non-sidearm PRIMARY on the same numbers is F146's warning, not an error: the tuning of a
    # primary against the host's health model is not something the operator can act on at the
    # whistle. What this leg pins is that the sidearm's line is a DIFFERENT, softer one.
    assert not any("one magazine" in e for e in r["errors"]), r["errors"]
    assert any("PRIMARY COILGUN CANNOT KILL ON ONE MAGAZINE" in w for w in r["warnings"]), r["warnings"]
    assert not any("is a sidearm" in w for w in r["warnings"]), r["warnings"]


def test_deagle_with_body_armor_at_a_big_pool_warns_and_does_not_block():
    """The field case itself: the shipped deagle, body_armor, hp/armor raised to a ~190 pool."""
    p = _player(weapons=("assault_rifle", "deagle"))
    p["loadout"]["perk"] = "body_armor"
    p["loadout"]["overrides"] = {"max_hp": 100, "max_armor": 90}
    r = C.validate(_cfg(), [p])
    assert not any("deagle" in e for e in r["errors"]), r["errors"]
    # Counted on the FACT, not on one branch's wording: the old `startswith("deagle is a sidearm")`
    # only matched the "beside a primary" copy, so the same finding said in any other shape read as
    # zero warnings and this test would have gone quietly green on a regression (round-2 pass C).
    side = [w for w in r["warnings"] if "deagle" in w and "one magazine" in w.lower()]
    assert len(side) == 1, r["warnings"]
    assert "backup" in side[0].lower(), side


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
    # F146: a WARNING now, and still per-player — an override is the HOST's health model for that
    # player, not a perk the player chose, so it still moves the pool the weapon is graded against.
    warns = C.validate(_cfg(), [over])["warnings"]
    assert any("PRIMARY SNIPER RIFLE CANNOT KILL ON ONE MAGAZINE" in w for w in warns), warns
    assert any("mag 4 < 5 rounds for 5 hits at 60 dmg vs a 300 pool" in w for w in warns), warns


def test_mag_invariant_reports_each_weapon_once_per_pool():
    """Two players carrying the same broken weapon is one error, not two."""
    ov = {"max_hp": 150, "max_armor": 150}
    a, b = _player(num=7, weapons=("sniper_rifle",)), _player(num=8, weapons=("sniper_rifle",))
    a["loadout"]["overrides"] = b["loadout"]["overrides"] = ov
    said = [w for w in C.validate(_cfg(), [a, b])["warnings"] if "ONE MAGAZINE" in w]
    assert len(said) == 1, said


# ---- $SIR effect guard (weapon-design.md §6.2) -----------------------------
def test_sir_effect_guard_is_an_ERROR_for_a_weapon_that_deals_no_damage():
    """A weapon's damage is a property of the (weapon, `$SIR` table) PAIR — its `<t3,t4>` keys a row
    whose FUNCTION decides what the IR magnitude does. The Energy Launcher used to key `$SIR,9,3,,24`,
    a status row, and dealt ZERO damage in every game we shipped, while passing the mag>=htk invariant
    clean because that invariant computes on raw t5.

    The bench fixed that row on 2026-09-18 (`gameconfig._SIR_TABLE` now carries `$SIR,9,3,,1,...`), so
    the Energy Launcher deals its full damage and no shipped weapon trips this guard any more. The rule
    is still correct: a weapon whose `<t3,t4>` key lands on a `_SIR_NO_POOL` function is unkillable, and
    that stays an ERROR. This test proves the guard by repointing the assault rifle's own `$SIR` cell
    (key 0,0) at function 28, a bench-confirmed no-pool function, for the duration of the call."""
    import brx_mcp.mc.compile as CM
    orig = CM._SIR_TABLE
    try:
        CM._SIR_TABLE = tuple(row for row in orig if not row.startswith("$SIR,0,0,")) \
                         + ("$SIR,0,0,,28,0,0,1,,*",)
        r = C.validate(_cfg(), [_player(weapons=("assault_rifle",))])
    finally:
        CM._SIR_TABLE = orig
    assert r["ok"] is False, r
    assert any("DEALS NO DAMAGE" in e and "assault_rifle" in e for e in r["errors"]), r["errors"]


def test_sir_guard_flags_multiplier_rows_because_published_htk_is_computed_on_raw_t5():
    """`_to_gc()` never maps `crit_modifier` off the compiled `config` dict at all -- it is not a
    per-game configurable field on the wire, only the `gameconfig.py` GameConfig dataclass default
    (compile.py `_to_gc`), so `C.validate()` always sees THAT default, currently 0 (2026-09-17,
    arsenal review). At 0 a headset hit on a $SIR 36/37 row lands the SAME as a gun-body hit, and the
    warning must say so rather than claim a kill needs fewer hits than published (only true above 1x).
    The bench-confirmed 1.25x/2.0x formula itself (crit_modifier=50) is tested directly against
    `headset_multiplier()` in test_headset_multiplier.py."""
    r = C.validate(_cfg(), [_player(weapons=("burst_rifle", "sniper_rifle"))])
    warns = " ".join(r["warnings"])
    assert "burst_rifle" in warns and "1.0x" in warns and "same as a gun-body hit" in warns, r["warnings"]
    assert "sniper_rifle" in warns and "1.0x" in warns, r["warnings"]
    assert "needs fewer hits than published" not in warns, r["warnings"]


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
    assert any("NO ROW" in e for e in r["errors"]), r     # round-2 K: an ERROR, not an advisory
    assert not r["ok"], r


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
    """Two players carrying the same broken weapon is one error, not two. Uses the same synthesised
    no-pool cell as `test_sir_effect_guard_is_an_ERROR_for_a_weapon_that_deals_no_damage` -- the real
    Energy Launcher row was fixed on the bench 2026-09-18 and no longer trips this guard."""
    import brx_mcp.mc.compile as CM
    orig = CM._SIR_TABLE
    try:
        CM._SIR_TABLE = tuple(row for row in orig if not row.startswith("$SIR,0,0,")) \
                         + ("$SIR,0,0,,28,0,0,1,,*",)
        a, b = _player(num=7, weapons=("assault_rifle",)), _player(num=8, weapons=("assault_rifle",))
        r = C.validate(_cfg(), [a, b])
    finally:
        CM._SIR_TABLE = orig
    said = [x for x in r["errors"] + r["warnings"] if "assault_rifle" in x]
    assert len(said) == 1, said


# ---- F70/F79: the objective/hill grenade beacon row -------------------------
def test_koth_and_domination_ship_the_silent_beacon_row():
    """F70: a hill's ambient `$HIR` is protocol 15, magnitude 8, owner team in the team field. It
    registers through fn 28 (F73, ZERO player feedback), so the compiled head for an objective/hill
    mode must carry exactly that row or the beacon lands on a gun with no matching cell and is
    silently dropped (F60/F72's failure shape, one layer up)."""
    for mode in ("koth", "domination"):
        head = C.compile(_cfg(mode=mode), _player(), _TEAMS)["head"]
        assert "$SIR,15,0,,28,0,0,1,,*" in head, f"{mode} head is missing the proto-15 beacon row: {head}"


def test_non_objective_modes_do_not_gain_the_beacon_row():
    """The row is specific to objective/hill configs -- an ordinary TDM head must not grow a cell it
    has no use for."""
    head = C.compile(_cfg(mode="tdm"), _player(), _TEAMS)["head"]
    assert not any(f.startswith("$SIR,15,0,") for f in head), head


def test_sir_covers_objective_guard_raises_when_the_beacon_row_is_missing():
    """F79: `assert_sir_covers_weapons` only knows `$WEAP` cells -- it has no concept of this
    non-weapon cell, so a config that declares an objective but ships no protocol-15 row must be
    caught by a sibling guard instead of sailing through silently."""
    import brx_mcp.mc.compile as CM
    # direct unit check of the guard, independent of compile()'s own wiring:
    try:
        CM.assert_sir_covers_objective(["$CLEAR,*", "$SIR,0,0,,1,0,0,1,,*"], "koth")
        assert False, "expected the F79 guard to raise on a koth head with no $SIR,15,0 row"
    except ValueError as e:
        assert "F79" in str(e) and "koth" in str(e)
    # a covered head and a non-objective mode both pass clean
    CM.assert_sir_covers_objective(["$SIR,15,0,,28,0,0,1,,*"], "koth")
    CM.assert_sir_covers_objective(["$CLEAR,*"], "tdm")


def test_compile_raises_via_the_objective_guard_if_the_beacon_row_were_ever_dropped():
    """End-to-end: monkeypatch the row list to empty (simulating F79's exact bug -- an objective
    config with nothing wired to protocol 15) and confirm `compile()` itself refuses to ship it,
    not just the unit-level guard above."""
    import brx_mcp.mc.compile as CM
    orig = CM._OBJECTIVE_SIR_ROW
    try:
        CM._OBJECTIVE_SIR_ROW = "$SIR,0,0,,1,0,0,1,,*"   # a row that keys an EXISTING cell, not 15,0 -- the row silently "vanishes" as a beacon row
        try:
            C.compile(_cfg(mode="koth"), _player(), _TEAMS)
            assert False, "expected the F79 guard to raise when no protocol-15 row reaches the head"
        except ValueError as e:
            assert "F79" in str(e)
    finally:
        CM._OBJECTIVE_SIR_ROW = orig


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
    assert p[T["fire"] + 1] == "100", "rebalanced fire interval lands at tok14 (raw idx15)"
    assert p[T["fire"] + 2] == "850", "the unidentified constant at tok15 is never written"


def test_shipped_roster_satisfies_the_mag_invariant_at_the_default_pool():
    """Regression guard for the whole roster, not just the two weapons that used to break.

    Grades against ROUNDS, not trigger actions: a charge weapon spends `rounds_per_charge` rounds on
    one charge (10 on the Charge Rifle, bench 2026-09-17), so `hits_to_kill` (which counts the charge
    and the taps that finish the kill) understates what the magazine has to hold. `compile.py`'s own
    loadout warning grades the same way (F226/S43); a cell weapon with a costlier charge must break
    this guard rather than ship unable to kill on one magazine."""
    cat = WeaponCatalog()
    bad = [w["weapon_id"] for w in cat.all()
           if int(cat._row(w["weapon_id"])["mag"]) < cat.rounds_to_kill(w["weapon_id"], 115)]
    assert not bad, f"weapons that cannot kill on one magazine at the 115 pool: {bad}"


def test_validate_grades_a_cell_weapon_in_ROUNDS_not_trigger_actions():
    """Polish round 2 (2026-09-17): the round-versus-actions guard was only asserted as arithmetic, so
    reverting `validate()` to `rtk = htk` left the whole suite green. This drives `validate()` itself.

    The synthetic cell weapon kills in 2 trigger actions (a charge plus one tap) but spends 11 ROUNDS
    doing it, and its magazine holds 6: a guard that counts actions sees 6 >= 2 and says nothing, and a
    guard that counts rounds sees 6 < 11 and warns. Break `compile.py`'s `rtk` back to `htk` and this
    test goes red, which is the point of it."""
    real = WeaponCatalog()._row("charge_rifle")       # its captured frame carries the t37 tap (20)
    cell = dict(real, weapon_id="cellgun", name="Cell Gun", mag=6, reserve=12,
                rounds_per_charge=10, wire={"dmg": 100}, hidden=False)
    cat = WeaponCatalog(rows=[cell])
    assert cat.hits_to_kill("cellgun", 115) == 2, "one charge plus one tap kills at the 115 pool"
    assert cat.rounds_to_kill("cellgun", 115) == 11, "and that combo costs 11 of the 6 rounds it has"

    r = Compiler(cat).validate(_cfg(), [_player(weapons=("cellgun",))])
    assert r["ok"], r["errors"]                      # a guideline never blocks (F146)
    said = [w for w in r["warnings"] if "one magazine" in w.lower()]
    assert len(said) == 1, r["warnings"]
    assert "CELLGUN" in said[0] and "mag 6 < 11 rounds" in said[0], said


def test_a_charge_costs_more_rounds_than_trigger_actions():
    """The arithmetic the one-magazine guard rests on: a cell weapon's kill costs more ROUNDS than
    trigger actions. The guard itself is driven end to end by
    `test_validate_grades_a_cell_weapon_in_ROUNDS_not_trigger_actions` (polish round 2); this one only
    pins the numbers the shipped Charge Rifle carries."""
    cat = WeaponCatalog()
    row = dict(cat._row("charge_rifle"))
    assert cat.rounds_to_kill("charge_rifle", 115) > cat.hits_to_kill("charge_rifle", 115), (
        "the Charge Rifle must cost more ROUNDS than trigger actions, or this guard proves nothing")
    assert int(row["mag"]) >= cat.rounds_to_kill("charge_rifle", 115), (
        "shipped Charge Rifle cell must cover one kill in rounds")


def _one_mag_kill_p(shots: int, htk: int, p: float = 0.7) -> float:
    """P(at least `htk` hits in `shots` independent trials at hit chance `p`) -- binomial, exact.

    2026-09-17 arsenal review, Tony's decision: replaces "total kills from a full kit" as a dominance
    axis (see `docs/reference/ttk-model.md` §Sidearm proposal for the same formula on the three
    pistols). Reserve is no longer an axis at all -- a respawn refills the kit, so how many kills a
    whole KIT could theoretically produce says nothing about a single life."""
    if htk <= 0:
        return 1.0
    if shots < htk:
        return 0.0
    return sum(math.comb(shots, k) * p ** k * (1 - p) ** (shots - k) for k in range(htk, shots + 1))


def _weapon_family(cat: WeaponCatalog, w: dict) -> tuple:
    """2026-09-17, Tony's decision: the dominance check used to run globally (43 dominated pairs on
    the stock roster before the first retune); it now runs WITHIN a family, because cross-family
    dominance (an SMG beating a Sniper Rifle on every 2026-09-17 axis) is expected and correct until
    range and recoil actually reach the wire (F231, S42) -- a Sniper Rifle's whole identity is range,
    which the model cannot see yet. Family = fire mode (`t20`) + `weapon_class`, EXCEPT a sidearm,
    which is its own family regardless of mode/class (a slot-2 backup was never meant to compete with
    a primary at all -- the old bespoke "primary beats sidearm" exemption falls out of this for free,
    since a primary and a sidearm are never in the same family to begin with)."""
    if w.get("role") == "sidearm":
        return ("sidearm",)
    return (cat._frame_int(w["weapon_id"], "mode"), w.get("weapon_class"))


def test_ttk_band_and_no_strictly_dominant_weapon():
    """docs/weapon-design.md §2.3: every picker weapon lands in the 1.2-3.5s band (one-shot power
    weapons AND cell weapons excepted -- see below), no weapon strictly beats another weapon IN THE
    SAME FAMILY on {ideal TTK, kills per clip, one-magazine kill chance at p=0.7, sustained DPS} at
    once, and every visible weapon LEADS its family on at least one of those four axes or on one of
    the two declared-but-not-yet-wired qualifiers (`range_band`, `recoil`) (2026-09-17 balance pass).

    **Why four axes, and why per-family.** Tony's call, following the Assault Rifle's native 100ms
    cycle reintroducing the exact cross-weapon dominance the 2026-08-30 retune existed to avoid:
    dominance now runs within a FAMILY (`_weapon_family()`) instead of globally, because a fast
    automatic beating a Sniper Rifle on every axis here is not a bug -- it is the model's blind spot
    (the MODEL sees no range or recoil: range ships on `t2` and the node writes `t21`/`t22`, so neither
    reaches the derived columns here, F231/S42), not a balance failure. Reserve/"total
    kills from a kit" is retired (a respawn refills it); "kills per clip" (`mag // rounds_to_kill`,
    deterministic -- felt every reload) and sustained DPS (a full-magazine dump plus one reload) take
    its place alongside ideal TTK and the probabilistic one-magazine kill chance.

    **The lead rule.** A weapon that cannot win, or at least tie, ANY of the four axes against its own
    family has no felt identity in this model -- ties count as leading (the family's best value), and
    a weapon may also lead via the mildest `recoil.floor` in its family (S42's planned node-driven
    profile, not yet on the wire) or a `range_band` no other family member shares (Q15's planned
    per-venue metres, not yet on the wire -- `t41`/`t2` stay whatever the capture carries). Both are
    declared DATA for a lever that does not exist yet; `test_range_and_recoil_are_declared_not_wired`
    below is the guard that keeps them that way until F231/S42 ship for real.

    **Cell weapons and the band.** A cell weapon (`rounds_per_charge` > 1 with a tap magnitude --
    today, the Charge Rifle) is release-to-kill, not first-shot-to-kill (`time_to_kill()`): the charge
    is pre-built behind cover, so its `ttk_ms` is deliberately allowed BELOW the 1.2s floor, the same
    way a one-shot weapon's `htk == 1` already exempts it -- the floor describes sustained-fire combat
    time, and a pre-charged ambush is not that."""
    cat = WeaponCatalog()
    rows = []
    for w in cat.all():
        wid = w["weapon_id"]
        r = cat._row(wid)
        htk = cat.hits_to_kill(wid, 115)
        ttk = cat.time_to_kill(wid, 115)
        mag = r["mag"]
        rtk = cat.rounds_to_kill(wid, 115)
        kpc = mag // rtk if rtk else 0
        per = cat.cycle_ms(wid)
        rpc = cat.rounds_per_charge(wid)
        dmg = cat.damage(wid)
        # A cell weapon's SUSTAINED output and one-magazine-kill CHANCE are modelled on repeated full
        # charges (the steady-state action if you just keep charging), not on the ambush combo `htk`
        # counts (§2.2/§2.3): the two questions are different ("how hard can this hit while it keeps
        # firing" vs "what does the one pre-built kill cost"), and no per-action-type accuracy model
        # exists to mix a charge's near-certain release with a tap's p=0.7 trigger pull.
        if rpc > 1 and cat.tap_damage(wid) > 0:
            charges = cat.charges(wid, mag)
            sust = charges * dmg / (charges * per / 1000 + r["reload_ms"] / 1000)
            pk = _one_mag_kill_p(charges, math.ceil(115 / dmg))
        else:
            sust = dmg * mag / (mag * per / 1000 + r["reload_ms"] / 1000)
            pk = _one_mag_kill_p(mag, htk)
        rows.append({"id": wid, "fam": _weapon_family(cat, w), "htk": htk, "ttk": ttk, "sust": sust,
                     "pk": pk, "kpc": kpc, "recoil_floor": (r.get("recoil") or {}).get("floor"),
                     "range_band": r.get("range_band"), "is_cell": rpc > 1 and cat.tap_damage(wid) > 0})
    for r in rows:
        if r["htk"] > 1 and not r["is_cell"]:
            assert 1200 <= r["ttk"] <= 3500, f"{r['id']} TTK {r['ttk']}ms is outside the 1.2-3.5s band"

    pick = [r for r in rows if r["htk"] > 1]
    fams: dict[tuple, list] = {}
    for r in pick:
        fams.setdefault(r["fam"], []).append(r)

    AXES = ("ttk", "sust", "pk", "kpc")
    BETTER = {"ttk": "lower", "sust": "higher", "pk": "higher", "kpc": "higher"}

    def not_worse(a, b, axis):
        return a[axis] <= b[axis] if BETTER[axis] == "lower" else a[axis] >= b[axis]

    def strictly_better(a, b, axis):
        return a[axis] < b[axis] if BETTER[axis] == "lower" else a[axis] > b[axis]

    for fam, members in fams.items():
        for a in members:
            for b in members:
                if a is b:
                    continue
                dominates = all(not_worse(a, b, ax) for ax in AXES) and any(strictly_better(a, b, ax) for ax in AXES)
                assert not dominates, f"{a['id']} strictly dominates {b['id']} within family {fam}"

    starved = []
    for fam, members in fams.items():
        if len(members) == 1:
            continue                                   # a family of one trivially leads (nothing to compare)
        best_by_axis = {axis: (min if BETTER[axis] == "lower" else max)(m[axis] for m in members) for axis in AXES}
        for m in members:
            # ⚠ The lead must come from an axis that REACHES A PLAYER. `recoil` and `range_band` are
            # declared-only targets (F231 range, S42 recoil) that no code writes to the wire, so a lead
            # claimed on either would be satisfied by inert data -- a guard that cannot fail. Add them
            # here in the same commit that wires them, and not before (polish round 2, 2026-09-17).
            if not any(m[axis] == best_by_axis[axis] for axis in AXES):
                starved.append(m["id"])
    assert not starved, (f"{starved} cannot lead their family on any felt axis (ttk/kpc/pk/sust) -- "
                          f"docs/weapon-design.md §2.3")


def test_the_energy_rifle_ships_its_overheat_tokens_on_the_wire():
    """F229 (bench 2026-09-17): `t38` = 150 is what switches the Energy Rifle's overheat ON, and `t35`
    = D11 is the ear-confirmed overheat sound. Both ride as `overrides`, so deleting that block would
    silently ship a weapon whose `caution` promises an overheat it no longer has. This asserts the
    COMPILED frame, not the catalogue row (polish round 3, 2026-09-17)."""
    cat, T = WeaponCatalog(), WeaponCatalog._T
    p = cat.resolve("energy_rifle", 0).split(",")
    assert p[T["heat"] + 1] == "6", "captured heat-per-shot is untouched"
    assert p[38 + 1] == "150", "t38 = 150 switches the overheat on (F229)"
    assert p[35 + 1] == "D11", "t35 = D11 is the ear-confirmed overheat sound (F229)"


def test_range_and_recoil_are_declared_not_wired():
    """S48/S42/Q15 (2026-09-17): `range_band` and `recoil` are catalogue TARGETS for levers that do not
    exist yet (F231 range calibration, S42 node-driven recoil). Every visible weapon carries both, but
    neither may reach a `$WEAP` token: `t41`/`t2` stay whatever the capture carries (F135, F231 -- no
    code path writes them from `range_band`), and `t21`/`t22` (the accuracy ceiling/floor) still ship
    100/100 (native walk off, F230) regardless of a weapon's declared `recoil` profile."""
    cat = WeaponCatalog()
    for w in cat.all():
        row = cat._row(w["weapon_id"])
        assert row.get("range_band") in ("close", "close-mid", "mid", "long"), w["weapon_id"]
        assert isinstance(row.get("range_target_m"), str) and row["range_target_m"], w["weapon_id"]
        recoil = row.get("recoil")
        assert isinstance(recoil, dict) and {"ceiling", "floor", "per_shot", "recover_ms"} <= set(recoil), \
            w["weapon_id"]
        frame = cat.resolve(w["weapon_id"], 0).split(",")
        assert frame[WeaponCatalog._T["acc_ceiling"] + 1] == "100", w["weapon_id"]
        assert frame[WeaponCatalog._T["acc_floor"] + 1] == "100", w["weapon_id"]
        # ...and the RANGE half of the same claim, which this test used to assert in prose only
        # (polish round 2, 2026-09-17): the compiled range token must still be the captured value,
        # so wiring `range_band` into it fails here and not only in a distant derivations test.
        captured = row["capture"]["frame"].split(",")
        for tok in ("range", "range_outdoor"):
            i = WeaponCatalog._T.get(tok)
            if i is None:
                continue
            assert frame[i + 1] == captured[i + 1], (
                f"{w['weapon_id']}: {tok} must stay the captured value until F231 calibrates it")


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
    """The two ARMING arithmetics (`health_pool()` and `_to_gc()`'s `$PSET`) must agree, perk and 255
    ceiling included — that is what the first half pins, and it is unchanged.

    The one-magazine guard was a third site that used to be pinned to them (review 2026-09-01). F146
    (field 2026-09-12) deliberately un-pinned it: it grades the WEAPON against the host's health
    model, so it reads neither the perk's armour nor the perk's magazine. See the F146 tests above."""
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

    # S50 (2026-09-17, docs/perk-design.md §2): body_armor's grant is now a flat +25, not a flat +50.
    assert armed_pool(None) == 115 and armed_pool("body_armor") == 140

    # F146 (field 2026-09-12): the one-magazine GUARD no longer reads the armed pool — see
    # `test_f146_the_guard_grades_the_BASE_pool_so_one_players_perk_cannot_ban_a_weapon` for why one
    # player's perk must not re-grade a weapon for the whole field. The two ARMING arithmetics above
    # are unchanged and still pinned to each other; what the guard quotes is the BASE pool, clamped
    # the same way.
    hi = dict(cfg, health={"max_hp": 45, "max_armor": 250})       # 295 base, +50 perk -> capped 255
    head = c.compile(hi, roster("body_armor")[0], hi["teams"])["head"]
    t = next(f for f in head if f.startswith("$PSET")).split(",")
    assert int(t[4]) == 255, "armour is capped at the policy ceiling"
    warns = c.validate(hi, roster("body_armor", "rail_gun"))["warnings"]
    quoted = [w for w in warns if " pool" in w and "ONE MAGAZINE" in w]
    assert quoted, f"the rail gun cannot kill on one magazine at this pool — expected a warning: {warns}"
    # 45 + min(255, 250) = 295, with NO +50 from the perk
    assert "vs a 295 pool" in quoted[0], quoted
    assert " 345 pool" not in quoted[0], f"the guard used the UNCAPPED pool: {quoted[0]}"
    # ...and the perk must make NO difference to the grade (F146): the same config, no perk, same line
    plain = [w for w in c.validate(hi, roster(None, "rail_gun"))["warnings"] if "ONE MAGAZINE" in w]
    assert plain and plain[0] == quoted[0], (plain, quoted)


def test_validate_uses_the_weapons_own_magazine_not_the_perks():
    """F146 (field 2026-09-12): the guard reads the weapon's own magazine against the base pool. It
    used to read the perk-granted one against the perk-armed pool, which is how Body Armor on one
    player banned every sidearm in the game as a HARD ERROR."""
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
    warns = c.validate(cfg, player(None))["warnings"]
    assert any("mag 4 <" in w for w in warns), warns

    # F146 (field 2026-09-12) REVERSED this leg on purpose. The guard is a statement about the WEAPON
    # against the host's health model, so both halves of the comparison are now perk-free: the base
    # pool and the base magazine. Reading `extended_mags` here while ignoring `body_armor` there would
    # be the worst of both, and reading both is what let one player's Body Armor ban every sidearm.
    # What the gun is actually GIVEN is still pinned, by the $PSET and $WEAP tests.
    warns2 = c.validate(cfg, player("extended_mags"))["warnings"]
    granted = c.catalog._ammo("tiny", {"ammo_mult": 2})[0]
    assert granted == 8, granted
    quoted = [w for w in warns2 if "ONE MAGAZINE" in w]
    assert quoted, warns2
    for w in quoted:
        assert "mag 4 <" in w, f"the guard read a perk's magazine, not the weapon's: {w}"


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
    bank_path = pathlib.Path(__file__).resolve().parents[1] / "brx_mcp" / "data" / "sound_ids.json"
    bank = {s["id"] for s in json.loads(bank_path.read_text())["sounds"]}
    missing = [(v, i) for v in VOICE_PACKS for i in voice_tail(v) + [kill_line(v)] if i and i not in bank]   # A15.2: the cry token is empty
    assert not missing, f"voice ids not in the sound bank: {missing}"


def test_voice_slot_roles_hold_across_every_family():
    """The per-family swap rests on the packs sharing a layout. Two independent checks, both from the shipped
    bank: every family still carries the ids for the fields that ship in $PSET (death scream, pain relief) plus
    the node's own pain picks (pain_melee / pain_short / pain_long -- A15.3 emptied these OUT of $PSET, so they
    are read via `voices.role_id`, not `voice_tail`, but they are the same ids the family used to ship there),
    and the DURATIONS agree by role -- shortPain is the briefest slot in every family and longPain runs
    materially longer.
    """
    import json, pathlib
    from brx_mcp.gameconfig import VOICE_PACKS, voice_tail
    from brx_mcp import voices as V
    bank_path = pathlib.Path(__file__).resolve().parents[1] / "brx_mcp" / "data" / "sound_ids.json"
    lens = {s["id"]: s["duration_s"] for s in json.loads(bank_path.read_text())["sounds"]}
    for v in VOICE_PACKS:
        tail = voice_tail(v)                       # death, respawnCry, meleeGrunt, shortPain, longPain, painRelief
        assert tail[1] == tail[2] == tail[3] == tail[4] == "", v    # A15.3: cry + all three pains ship EMPTY
        death, relief = tail[0], tail[5]
        melee, short_id, long_id = V.role_id(v, "pain_melee"), V.role_id(v, "pain_short"), V.role_id(v, "pain_long")
        ids = [death, melee, short_id, long_id, relief]
        assert all(i in lens for i in ids), v
        assert lens[death[:2] + "I"] > 0, v            # the family still HAS a spawn line for the node to say
        short, long_ = lens[short_id], lens[long_id]
        assert short < long_, f"{v}: shortPain {short:.2f}s is not shorter than longPain {long_:.2f}s"
        if v not in ("creature", "stalker"):
            # A15 added creature (V5) and stalker (VF): both keep G < E, but their briefest slot is ANOTHER pain
            # line (the monster's grunts are all long; stalker's C is 0.45 s to G's 0.46 s), so "briefest" is
            # not a layout signal for them. The commander packs (VQ/VR/VS) fail G < E outright and are excluded.
            assert short <= min(lens[i] for i in ids), f"{v}: shortPain is not the briefest slot"


def test_the_voice_pack_is_per_player_not_hardcoded():
    """It shipped as a constant: every player got the HEAVY pack whatever their `voice` said."""
    hp = next(f for f in C.compile(_cfg(), dict(_player(), voice="heavy"), _TEAMS)["head"] if f.startswith("$PSET,"))
    mp = next(f for f in C.compile(_cfg(), dict(_player(), voice="medic"), _TEAMS)["head"] if f.startswith("$PSET,"))
    assert hp != mp, "the voice pack must follow the player"
    assert ",V33,,,,,V37," in hp      # A15.3: the cry AND the three pain fields are EMPTY (the node plays them)
    assert ",V83,,,,,V87," in mp
    # an unknown name falls back rather than emitting a bad family
    assert next(f for f in C.compile(_cfg(), dict(_player(), voice="nope"), _TEAMS)["head"] if f.startswith("$PSET,"))


def test_voice_slots_pick_which_line_of_the_family_the_gun_holds():
    """A15: `voice_slots` = {role: id} replaces one $PSET voice field (a different death scream) and the kill cue;
    the bundle reports what the gun holds in `voice`. An off-gun id or an unknown role is refused."""
    b = C.compile(_cfg(), dict(_player(), voice="heavy", voice_slots={"death_scream": "V34", "kill": "V38"}), _TEAMS)
    pset = next(f for f in b["head"] if f.startswith("$PSET,"))
    assert ",V34,,,,,V37," in pset      # A15.3: melee_grunt / short_pain / long_pain still ship EMPTY -- only death_scream was picked
    assert b["cues"]["kill"] == "$PLAY,,4,6,V38,,,,*"
    assert {k: b["voice"][k] for k in ("id", "family", "kill", "pset")} == {"id": "heavy", "family": "V3", "kill": "V38",
                          "pset": {"death_scream": "V34", "respawn_cry": "", "melee_grunt": "", "short_pain": "", "long_pain": "", "pain_relief": "V37"}}
    assert b["voice"]["rolled"] == {} and b["voice"]["pools"]["death_scream"] == ["V33", "V34", "V35"]   # A15.1: no roll without `roll=`
    plain = C.compile(_cfg(), dict(_player(), voice="heavy"), _TEAMS)
    assert plain["voice"]["kill"] == "V3A" and ",V33,,,,,V37," in next(f for f in plain["head"] if f.startswith("$PSET,"))
    for bad in ({"dance": "V34"}, {"death_scream": "E_J10"}):
        try:
            C.compile(_cfg(), dict(_player(), voice="heavy", voice_slots=bad), _TEAMS)
        except ValueError:
            pass
        else:
            raise AssertionError(f"accepted {bad}")
    opts = {o["id"]: o for o in C.voice_options()}
    assert opts["heavy"]["kill_line"] == "V3A" and opts["heavy"]["speaker"] == "Heavy" and opts["heavy"]["lines"] == 22



def test_gun_in_play_team_puts_the_blank_and_the_paint_right_after_every_spawn():
    """A11.7 / S4: native leaves spawn/revive untouched; the DEFAULT `in_play` inserts blank + team-rest
    right after $SPAWN.

    Tony, 2026-09-09: "instead of going dark lets put the team color on the gun led" -- DEFAULT is
    "team" again (presentation.GUN_DEFAULT's comment has the full back-and-forth: it was "team" until
    the 2026-09-07 readout review moved it to "dark" on the theory that the transient readout made a
    static paint redundant, which missed that the readout is transient and a dark rest reads as a dead
    gun for the rest of the match). This test exercises "team" both as the default and as the explicit
    config, since they are now the same path."""
    base = C.compile({**_cfg(), "presentation": {"gun": {"in_play": "native"}}}, _player(), _TEAMS)
    assert "gun" not in base and not any(f.startswith("$GLED,,,,5") for f in base["spawn"] + base["revive"])
    # A16.4 (2026-09-09): the in-play rest is DIM -- brightness is what separates the resting body from
    # the (full-brightness) readout bar. Pregame's own paint (below, `head`) is untouched and stays full.
    rest = pg.team_frame(1, False, dim=True)
    dflt = C.compile(_cfg(), _player(), _TEAMS)         # the default rests on the TEAM colour, no readout event bursts by default
    assert dflt["gun"]["in_play"] == "team" and dflt["gun"]["rest"] == rest
    b = C.compile({**_cfg(), "presentation": {"gun": {"in_play": "team"}}}, _player(), _TEAMS)
    assert not any(f.startswith("$GLED") for f in b["spawn"] + b["revive"]), "a blank inside the spawn burst does not take (bench 2026-09-04)"
    assert b["gun"]["in_play"] == "team" and b["gun"]["blank"] == "$GLED,,,,5,,,*" and b["gun"]["rest"] == rest
    assert b["gun"]["after_spawn_s"] == 2.5 and b["gun"]["take"] == ["$GLED,,,,5,,,*", rest]
    assert b["head"][-2:] == ["$GLED,1,1,1,0,10,,*", "$TID,1,*"]         # pregame: armed body in the team colour, head still ends with $TID
    off = C.compile({**_cfg(), "presentation": {"gun": {"pregame": "off"}}}, _player(), _TEAMS)["head"]
    assert off[-1] == "$TID,1,*" and not off[-2].startswith("$GLED,1,1,1")
    # "extraction_failed" (default RED) stands in for the old hit_taken check -- hit_taken carries no
    # default gun burst any more (finding #5).
    assert b["leds"]["extraction_failed"][-1][0] == rest
    h = C.compile({**_cfg(), "presentation": {"gun": {"in_play": "health"}}}, _player(), _TEAMS)
    assert h["gun"]["take"] == ["$GLED,,,,5,,,*", "$GLED,3,3,3,0,10,,*"] and len(h["gun"]["bands"]) == 3
    off = C.compile({**_cfg(led={"mode": "off"}), "presentation": {"gun": {"in_play": "team"}}}, _player(), _TEAMS)
    assert "gun" not in off and not any(f.startswith("$GLED") for f in off["spawn"])


def test_every_mode_and_preset_paints_headset_and_gun_body_pregame():
    """Locked in (Tony, walkthrough 2026-09-04): "seeing hled and gled on all equipment after arm is a good indicator
    that everything is connected pregame. lets lock that in for every mode." With LEDs on, every mode's default and
    every preset's head carries the headset team paint AND the gun-body team paint, before the closing $TID."""
    from brx_mcp.mc import presentation as P
    from brx_mcp.mc.state import default_config, MODES
    from brx_mcp import poolgauge as _pg
    for m in MODES:
        for preset in [None] + sorted(P.PRESETS):
            cfg = default_config(m["mode"])
            cfg["config_id"] = "c1"
            if preset:
                cfg["presentation"] = P.merge(cfg["presentation"], {"preset": preset})
            ffa = m["mode"] == "ffa"
            for t in cfg["teams"]:
                tid, team = int(t["tid"]), t["team_id"]
                b = C.compile(cfg, _player(team=team), cfg["teams"])
                head = b["head"]
                assert head[-1] == f"$TID,{tid},*", (m["mode"], preset)
                # led-language.md §6 finding #11 / Q19 (2026-09-07): FFA paints WHITE on both surfaces,
                # not the tid's identity colour -- there is no team to protect. Non-FFA paints
                # `display_colour(tid)` (F35: green stays green on the wire but PAINTS purple), never
                # the raw tid.
                hled_colour = _pg.FFA_COLOUR if ffa else _pg.display_colour(tid)
                assert f"$HLED,{hled_colour},0,,,10,,*" in head, ("headset pregame missing", m["mode"], preset)
                gled = [f for f in head if f.startswith("$GLED,") and not f.startswith("$GLED,,,,5")]
                want = _pg.FFA_COLOUR if ffa else _pg.display_colour(tid)
                assert gled and gled[-1].startswith(f"$GLED,{want},"), ("gun pregame missing", m["mode"], preset, gled)


def test_a_roll_draws_the_pset_voice_fields_and_the_kill_cue_is_a_pool():
    """A15.1 (Tony, 2026-09-06): with `roll=` the un-picked $PSET fields are drawn from the family pools and the
    bundle says what was drawn; without it the compile is the deterministic default (the golden bundle). A15.3
    narrows the roll to death_scream alone (the three pain fields ship empty and are never rolled -- the node
    plays them itself). The kill cue is a POOL of five frames the node rolls from; `cues["kill"]` stays its first."""
    import random
    hv = dict(_player(), voice="heavy")
    screams = set()
    for seed in range(10):
        b = C.compile(_cfg(), hv, _TEAMS, roll=random.Random(seed))
        pset = next(f for f in b["head"] if f.startswith("$PSET,")).split(",")
        ds, cry, melee, sp, lp = pset[10], pset[11], pset[12], pset[13], pset[14]
        assert ds in ("V33", "V34", "V35") and cry == melee == sp == lp == "", (ds, cry, melee, sp, lp)
        assert b["voice"]["rolled"] == {"death_scream": ds}      # A15.3: the only field left to draw
        assert b["voice"]["pset"]["death_scream"] == ds and b["voice"]["pools"]["death_scream"] == ["V33", "V34", "V35"]
        screams.add(ds)
    assert len(screams) > 1
    plain = C.compile(_cfg(), hv, _TEAMS)
    assert ",V33,,,,,V37," in next(f for f in plain["head"] if f.startswith("$PSET,")) and plain["voice"]["rolled"] == {}
    assert plain["cue_pools"]["kill"] == [f"$PLAY,,4,6,{i},,,,*" for i in ("V3A", "V38", "V39", "V3K", "V3L")]
    assert plain["cues"]["kill"] == plain["cue_pools"]["kill"][0]
    # an explicit pick is never rolled over, and collapses the kill pool to that line
    picked = C.compile(_cfg(), dict(hv, voice_slots={"death_scream": "V35", "kill": "V39"}), _TEAMS, roll=random.Random(1))
    assert ",V35," in next(f for f in picked["head"] if f.startswith("$PSET,")) and "death_scream" not in picked["voice"]["rolled"]
    assert "kill" not in picked["cue_pools"] and picked["cues"]["kill"] == "$PLAY,,4,6,V39,,,,*"


def test_the_spawn_line_is_ours_and_respawned_draws_from_the_same_pool():
    """A15.2 (bench 2026-09-06, Tony: "what if we dont rely on the firmware to make the sound on spawn and we just
    control it?"): the head's $PSET ships an EMPTY battleRespawnCry (verified: the firmware then says nothing on
    $SPAWN), `cues.spawn` is the character's spawn line for the node to write right after the spawn / revive
    frames, `cue_pools.spawn` is the pool when the family has several (VAI / VAN / VAO for the Male player), and
    the `respawned` event carries the same pool."""
    m = C.compile(_cfg(), dict(_player(), voice="male"), _TEAMS)
    pset = next(f for f in m["head"] if f.startswith("$PSET,")).split(",")
    assert pset[11] == "" and pset[10] == "VA3"                        # cry EMPTY, scream still the firmware's
    assert m["cues"]["spawn"] == "$PLAY,,4,6,VAI,,,,*"
    assert m["cue_pools"]["spawn"] == [f"$PLAY,,4,6,{i},,,,*" for i in ("VAI", "VAN", "VAO")]
    assert m["cues"]["respawned"] == m["cues"]["spawn"] and m["cue_pools"]["respawned"] == m["cue_pools"]["spawn"]
    assert m["voice"]["spawn"] == ["VAI", "VAN", "VAO"] and m["voice"]["pset"]["respawn_cry"] == ""
    h = C.compile(_cfg(), dict(_player(), voice="heavy"), _TEAMS)
    assert h["cues"]["spawn"] == "$PLAY,,4,6,V3I,,,,*" and "spawn" not in h["cue_pools"] and "respawned" not in h["cue_pools"]
    # a $PSET pick puts a firmware cry back (the escape hatch); a `spawn` pick collapses the node's pool
    back = C.compile(_cfg(), dict(_player(), voice="male", voice_slots={"respawn_cry": "VAN"}), _TEAMS)
    assert next(f for f in back["head"] if f.startswith("$PSET,")).split(",")[11] == "VAN"
    one = C.compile(_cfg(), dict(_player(), voice="male", voice_slots={"spawn": "VAO"}), _TEAMS)
    assert one["cues"]["spawn"] == "$PLAY,,4,6,VAO,,,,*" and "spawn" not in one["cue_pools"]


def test_voice_switch_gates_the_players_own_lines():
    """S12 (Tony, 2026-09-11: "let the config drive it. silenced snipers no grunts could be legit"):
    `presentation.voice` gates the player's OWN pain + spawn cues, independent of `announcer`. `spawn`
    (the first life) and `respawned` (every revive after it, `_spawn`/`_revive` in engine.js) are the
    SAME line and must move together -- otherwise a player would still speak on every respawn but the
    first. The native death scream (`pset_pool`) and the A17 material hit sounds are unaffected."""
    pain = ("pain_short", "pain_long", "pain_melee")

    def _voice_cfg(v):
        return {**_cfg(), "presentation": {"voice": v}}

    on = C.compile(_voice_cfg("on"), _player(), _TEAMS)
    hits_only = C.compile(_voice_cfg("hits_only"), _player(), _TEAMS)
    off = C.compile(_voice_cfg("off"), _player(), _TEAMS)

    for role in pain:
        assert role in on["cues"], role
    assert "spawn" in on["cues"] and "respawned" in on["cues"]

    for role in pain:
        # hits_only keeps the pain cues/pools byte-for-byte the same as "on" ...
        assert hits_only["cues"].get(role) == on["cues"].get(role)
        assert hits_only["cue_pools"].get(role) == on["cue_pools"].get(role)
        # ... "off" drops them
        assert role not in off["cues"] and role not in off["cue_pools"]

    # both hits_only and off drop the spawn line, on BOTH bundle keys
    for b in (hits_only, off):
        assert "spawn" not in b["cues"] and "spawn" not in b["cue_pools"]
        assert "respawned" not in b["cues"] and "respawned" not in b["cue_pools"]

    # unaffected in all three: the native death scream re-roll and the A17 material hit sounds
    for b in (on, hits_only, off):
        assert b["pset_pool"], "pset_pool must be present regardless of the voice switch"
        assert b["hit_audio"]["material"]


# ---- F15 / A20: the host-driven stun (EMP) -----------------------------------
def _sir_fn(head, cell=("8", "0")):
    from brx_mcp.mc.compile import _sir_index
    return _sir_index([f for f in head if f.startswith("$SIR,")]).get(cell)


def test_stun_ships_the_emp_row_only_when_the_config_asks():
    """`config.stun` present -> the `<8,0>` cell is **fn 23**; absent -> the stock charge-rifle row,
    byte-for-byte (the golden bundle must not move).

    F253 (bench 2026-09-18) moved this cell off fn 24. fn 24 does no damage AND leaves the victim's gun
    manufacturing a fake `$HIR` every 5.07 s until the next `$SPAWN`, so a stunned player was told they
    were being shot by nobody for the rest of the life. fn 23 is the real primitive, measured the same
    session: live accuracy 100 -> 0 in the same millisecond as the `$HIR`, no pool moves, the gun still
    fires but every shot misses, and it recovers on its own. Tony calls it smoke rather than a stun,
    which is the better name for it.

    F121/A23 moved the LIVE table out of the head, and F209 moved it again, into the `sir_pool` take the node
    writes once the gun can fire, so the stun row is asserted where it now lands. The head's copy of the cell is a disarmed fn-28 registrar in both cases -- a
    countdown EMP must not stun either."""
    from brx_mcp.mc.compile import _STUN_SIR_ROW
    from brx_mcp.gameconfig import _SIR_TABLE
    # CONTROL: no stun -> the stock table, in stock order, untouched
    b = C.compile(_cfg(), _player(), _TEAMS)
    # A44 (ours): the spawn write carries the fn-28 twin table; the REAL table is the `sir_pool` take.
    assert _sir_fn(b["sir_pool"][0]) == 1, "stock: the charge rifle's plain damage (fn 1 since F225, 2026-09-17)"
    assert [f for f in b["sir_pool"][0] if f.startswith("$SIR,")] == list(_SIR_TABLE)
    assert _sir_fn(b["head"]) == 28, "F121: the head's copy of the cell moves no pool"
    # stun on -> fn 23 on the SAME cell, in the SAME position, nothing else moved
    on = C.compile(dict(_cfg(), stun={"duration_s": 10}), _player(), _TEAMS)
    # The carrier is A44's `sir_pool` take, not the spawn write: a player inside spawn protection cannot
    # be smoked before their gun can answer, so the spawn write carries the disarmed fn-28 twin.
    rows_on = [f for f in on["sir_pool"][0] if f.startswith("$SIR,")]
    assert _sir_fn(on["sir_pool"][0]) == 23
    assert _sir_fn(on["head"]) == 28, "F121: a countdown EMP must not smoke anyone pregame either"
    assert _sir_fn(on["spawn"]) == 28, "A44: the spawn write is the twin, so protection covers the EMP too"
    assert rows_on.index(_STUN_SIR_ROW) == list(_SIR_TABLE).index("$SIR,8,0,,1,0,0,1,,*"), "in place, not appended"
    assert [r for r in rows_on if not r.startswith("$SIR,8,0,")] == [r for r in _SIR_TABLE if not r.startswith("$SIR,8,0,")]
    assert "$SIR,8,0,,23,0,0,1,,*" in rows_on and _STUN_SIR_ROW.split(",")[3] == "", "the sound token stays EMPTY (F43: never invent a sound id)"
    assert not ({int(r.split(",")[4]) for r in rows_on if r.split(",")[4].isdigit()} & {24, 25, 26, 27}), \
        "F253: the phantom family must not reach ANY shipped table"
    # `{}` is the 10 s default and still ships the row
    assert _sir_fn(C.compile(dict(_cfg(), stun={}), _player(), _TEAMS)["sir_pool"][0]) == 23


def test_stun_row_rides_every_sir_pool_take_too():
    """A17's class layer re-writes a whole `$SIR` table before every revive; if those takes kept the stock
    row the first respawn would silently un-stun the game. The function is fn 23 since F253 (2026-09-18)."""
    b = C.compile(dict(_cfg(), stun={"duration_s": 5}, hit_audio_class=True), _player(), _TEAMS)
    assert b["sir_pool"], "class sounds on: the pool exists"
    for take in b["sir_pool"]:
        assert _sir_fn(take) == 23, take
    # CONTROL: the same pool without stun keeps fn 1 in every take (F225, 2026-09-17)
    b0 = C.compile(dict(_cfg(), hit_audio_class=True), _player(), _TEAMS)
    assert all(_sir_fn(take) == 1 for take in b0["sir_pool"])


def test_validate_stun_shape_and_names_the_source():
    roster = [_player(num=7, weapons=("charge_rifle", "shotgun")), _player(num=8, team="yellow", weapons=("assault_rifle",))]
    v = C.validate(dict(_cfg(), stun={"duration_s": 10}), roster)
    assert v["ok"], v
    assert any("charge_rifle" in w and "<8,0>" in w for w in v["warnings"]), v["warnings"]
    # nothing on the roster can stun: say so (a knob that does nothing is the E1 failure)
    v = C.validate(dict(_cfg(), stun={}), [_player(num=7, weapons=("assault_rifle",))])
    assert v["ok"] and any("nothing in this game can stun" in w for w in v["warnings"]), v
    # shape: not an object / out of range / a bool
    for bad in ("10", 10, ["x"]):
        assert not C.validate(dict(_cfg(), stun=bad), roster)["ok"], bad
    for d in (0, 61, -1, True, "10"):
        v = C.validate(dict(_cfg(), stun={"duration_s": d}), roster)
        assert not v["ok"] and any("duration_s" in e for e in v["errors"]), (d, v)
    # refused with the re-key (it would move the charge rifle off the EMP cell with its damage intact)
    v = C.validate(dict(_cfg(), stun={}, hit_audio_rekey=True), roster)
    assert not v["ok"] and any("hit_audio_rekey" in e for e in v["errors"]), v
    # CONTROL: the plain config validates clean with no stun chatter at all
    v = C.validate(_cfg(), roster)
    assert v["ok"] and not any("stun" in w for w in v["warnings"]), v


# ---------------------------------------------------------------------------------------------
# Round-1 polish review 2026-09-12 — the A12 exemption is about the SLOT, not the tag
# ---------------------------------------------------------------------------------------------
_SIDEARM_ROW = {"weapon_id": "coilgun", "name": "Coilgun", "cls": 7, "mag": 1, "reserve": 6,
                "reload_ms": 2400, "dmg": 78, "rof": 25, "rng": 75, "base": "ar",
                "wire": {"dmg": 90}, "tags": ["sidearm"], "role": "sidearm"}

def test_a_sidearm_that_is_the_players_only_weapon_warns_in_ITS_OWN_WORDS_and_still_plays():
    """The A12 exemption tested the weapon's TAG and not its SLOT. `policy.PRIMARY_KINDS` admits
    `"sidearm"` (`_R_SIDEARM_ONLY` is the copy for it), so a pistols-only round puts the sidearm in
    slot 1 as the player's ONLY gun — and calling that "a sidearm riding beside a primary" was simply
    false. It gets its own sentence.

    Round-2 pass C: a WARNING, not an error. It was promoted to an error by the round-1 review on the
    reasoning that a main gun which cannot finish a kill on one magazine is a broken kit — but F146 is
    the field decision that a guideline never blocks, the operator cannot retune a weapon at the
    whistle, and a reload still kills. Nothing unkillable ships either way (that is pass K's job)."""
    side = Compiler(WeaponCatalog(rows=[_SIDEARM_ROW]))
    r = side.validate(_cfg(), [_player(weapons=("coilgun",))])
    assert r["ok"], r["errors"]
    assert not any("one magazine" in e.lower() for e in r["errors"]), r["errors"]
    assert any("coilgun is your only weapon and cannot kill on one magazine" in w for w in r["warnings"]), r["warnings"]


# ---------------------------------------------------------------------------------------------
# Round-2 fix pass K (2026-09-12) - the severity ordering of the loadout gate
# ---------------------------------------------------------------------------------------------
def test_k_a_weapon_whose_hits_cannot_move_the_pool_is_an_ERROR_not_a_warning():
    """The ordering was inverted. "needs a reload" was the only ERROR, while "keys NO $SIR row" (every
    hit silently dropped) and "registers a hit but moves no pool" (deals NO damage) were warnings - so
    a kit that could still win was blocked and a kit that cannot kill AT ALL went through.

    `hits_to_kill` returns 0 for zero damage, so the magazine gate skips such a weapon entirely and
    nothing else was going to catch it. These two conditions are the definition of unkillable.

    The Energy Launcher used to be case (a) below, on a real shipped row. The bench fixed that row
    2026-09-18 (see test_sir_effect_guard_is_an_ERROR_for_a_weapon_that_deals_no_damage), so case (a)
    now synthesises the same failure by repointing the assault rifle's own `$SIR` cell at function 28,
    a bench-confirmed no-pool function."""
    from brx_mcp.mc.compile import _SIR_NO_POOL, _sir_index
    import brx_mcp.mc.compile as CM
    real = Compiler()
    T = real.catalog._T

    # (a) a synthesised no-pool weapon: the assault rifle's own $SIR cell repointed to function 28,
    # which registers a $HIR and moves no pool.
    orig = CM._SIR_TABLE
    try:
        CM._SIR_TABLE = tuple(row for row in orig if not row.startswith("$SIR,0,0,")) \
                         + ("$SIR,0,0,,28,0,0,1,,*",)
        fr = real.catalog.resolve("assault_rifle", 0).split(",")
        fn = _sir_index(CM._SIR_TABLE)[(fr[T["proto"] + 1] or "0", fr[T["subtype"] + 1] or "0")]
        assert fn in _SIR_NO_POOL, fn
        r = real.validate(_cfg(), [_player(weapons=("assault_rifle",))])
    finally:
        CM._SIR_TABLE = orig
    assert not r["ok"], r
    assert any("DEALS NO DAMAGE" in e for e in r["errors"]), r["errors"]

    # (b) a weapon keyed to a cell with NO row in the pushed table at all
    src = real.catalog._by_id["energy_launcher"]
    frame = src["capture"]["frame"].split(",")
    frame[T["proto"] + 1] = "30"          # an unused protocol: no cell for it in _SIR_TABLE
    orphan = {"weapon_id": "ghostgun", "name": "Ghost", "cls": 0, "mag": 30, "reserve": 90,
              "reload_ms": 1400, "dmg": 40, "rof": 54, "rng": 75, "wire": {"dmg": 40},
              "capture": {"frame": ",".join(frame)}}
    cat = WeaponCatalog(rows=[orphan])
    fr = cat.resolve("ghostgun", 0).split(",")
    key = (fr[T["proto"] + 1] or "0", fr[T["subtype"] + 1] or "0")
    sir = _sir_index(CM._SIR_TABLE)
    assert sir.get(key) is None, f"the fixture must key an ABSENT $SIR cell (got {key} -> {sir.get(key)})"
    r = Compiler(cat).validate(_cfg(), [_player(weapons=("ghostgun",))])
    assert not r["ok"], r
    assert any("NO ROW" in e for e in r["errors"]), r["errors"]


def test_k_a_real_pistol_that_cannot_kill_on_one_magazine_is_still_only_a_WARNING():
    """CONTROL for the promotion above: the magazine cases stay warnings (pass C). The deagle at a
    190 pool deals real damage through a real row - it just needs a reload, which still kills."""
    p = _player(weapons=("deagle",))
    p["loadout"]["overrides"] = {"max_hp": 100, "max_armor": 90}
    r = C.validate(_cfg(), [p])
    assert r["ok"], r["errors"]
    assert any("one magazine" in w.lower() for w in r["warnings"]), r["warnings"]


def test_k_no_stock_weapon_and_no_shipped_pool_is_blocked_by_the_new_errors():
    """THE GUARD. Promoting two conditions to errors is only safe if nothing an operator can pick from
    a shipped pool trips them - a stock pick that cannot be pushed is the F146 failure all over again.

    `energy_launcher` is the one row in `weapons.json` that does (its captured word keys $SIR 9,3, a
    status function). It is therefore excluded from EVERY pool (`policy.UNPLAYABLE_IDS`), so no player
    can be handed it; the catalogue page still lists it with its `caution`. The day the launcher's row
    is fixed on the bench, delete the id from that set."""
    from brx_mcp.mc import policy as _policy
    real = Compiler()
    weapons, perks = real.weapon_catalog(), real.perk_catalog()
    for w in weapons:
        wid = w["weapon_id"]
        r = real.validate(_cfg(), [_player(weapons=(wid,))])
        if wid in _policy.UNPLAYABLE_IDS:
            assert not r["ok"], f"{wid} is in UNPLAYABLE_IDS but validates clean - drop it from the set"
            continue
        assert r["ok"], f"stock weapon {wid} is BLOCKED by validate(): {r['errors']}"

    for name in ("open", "no_heavies", "snipers"):
        pol = _policy.preset_rules(name)
        pl = _policy.pool(pol, weapons, perks)
        for slot in ("primary", "secondary_weapons"):
            for wid in pl[slot]:
                assert wid not in _policy.UNPLAYABLE_IDS, f"preset {name} offers {wid} in {slot}"
                r = real.validate(_cfg(), [_player(weapons=(wid,))])
                assert r["ok"], f"preset {name} offers {wid} in {slot}, which validate() blocks: {r['errors']}"


def test_round3_field4_zero_damage_on_a_DAMAGE_row_is_an_error_and_a_grant_row_is_not():
    """FIELD-4 (round-3 fix pass, 2026-09-13) — completes pass K.

    K's two new ERRORS key off the `$SIR` FUNCTION: no row for the weapon's cell, or a row on a
    function that moves no pool. Neither sees a weapon whose own DAMAGE is zero on a perfectly
    ordinary damage row — a catalog row or an override at `dmg: 0` compiles, pushes, registers every
    hit and kills nobody, which is the same unkillable class by a different door. `hits_to_kill`
    returns 0 for zero damage, so the magazine guard skips it too.

    GRANT rows stay exempt: a heal/armour/shield weapon is not meant to deal damage."""
    from brx_mcp.mc import compile as compile_mod
    from brx_mcp.mc.compile import _SIR_GRANT, _SIR_TABLE, _sir_index
    sir = _sir_index(_SIR_TABLE)
    real = Compiler()
    T = real.catalog._T
    frame = real.catalog._by_id["assault_rifle"]["capture"]["frame"]
    parts = frame.split(",")
    fn = sir[(parts[T["proto"] + 1] or "0", parts[T["subtype"] + 1] or "0")]
    assert fn not in _SIR_GRANT, f"control: the rifle's cell is a plain damage row (got fn {fn})"

    dud = {"weapon_id": "dudgun", "name": "Dud", "cls": 0, "mag": 30, "reserve": 90,
           "reload_ms": 1400, "dmg": 0, "rof": 54, "rng": 75, "wire": {"dmg": 0},
           "capture": {"frame": frame}}
    r = Compiler(WeaponCatalog(rows=[dud])).validate(_cfg(), [_player(weapons=("dudgun",))])
    assert not r["ok"], r
    assert any("dudgun" in e and "0 DAMAGE" in e.upper() for e in r["errors"]), r["errors"]

    # The same weapon on a GRANT row is a HEAL, not a broken gun: warned about, never blocked. The
    # shipped table carries no grant row (functions 1, 24, 36, 37, 38 only), so the exemption is
    # pinned against a table that does -- a bench fix that adds one must not start erroring.
    assert 11 in _SIR_GRANT and not any(v in _SIR_GRANT for v in sir.values()), sorted(set(sir.values()))
    hp = list(parts)
    hp[T["proto"] + 1], hp[T["subtype"] + 1] = "7", "5"
    heal = {**dud, "weapon_id": "healgun", "name": "Heal", "capture": {"frame": ",".join(hp)}}
    # patched by hand, not via the pytest fixture: `run_tests.py` is a bare runner with no fixtures
    compile_mod._SIR_TABLE = tuple(_SIR_TABLE) + ("$SIR,7,5,,11,0,0,1,,*",)
    try:
        r2 = Compiler(WeaponCatalog(rows=[heal])).validate(_cfg(), [_player(weapons=("healgun",))])
    finally:
        compile_mod._SIR_TABLE = _SIR_TABLE
    assert r2["ok"], r2["errors"]
    assert any("healgun" in w and "GRANT" in w for w in r2["warnings"]), r2["warnings"]
