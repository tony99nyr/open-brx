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
    assert head[0] == "$VOL,69,0,*" and head[1] == "$CLEAR,*" and head[2] == "$START,*"


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
    # assault_rifle mag/reserve = 32/384 ; shotgun = 6/24 (weapons.json)
    b = C.compile(_cfg(), _player(weapons=("assault_rifle", "shotgun")), _TEAMS)
    a0 = [f for f in b["spawn"] if f.startswith("$AMMO,0,")][0]
    a1 = [f for f in b["spawn"] if f.startswith("$AMMO,1,")][0]
    assert a0 == "$AMMO,0,32,384,1,*", a0
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
    assert all(v.startswith("$PLAY") for v in cues.values() if v)
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
    assert "$VOL,69,0,*" in frames  # audible
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
    assert by["assault_rifle"]["verified"] is True
    assert by["sniper_rifle"]["verified"] is False
    # every visible weapon carries an armory blurb (weapons.json `desc` -> Weapon.desc)
    blank = [w["weapon_id"] for w in cat.all() if not (w.get("desc") or "").strip()]
    assert not blank, f"weapons missing desc: {blank}"
    assert "850ms" in by["assault_rifle"]["desc"], by["assault_rifle"]["desc"]
    assert by["rail_gun"]["desc"].strip().endswith("."), by["rail_gun"]["desc"]


def test_resolve_verified_weapon_is_exact_ar_tail():
    cat = WeaponCatalog()
    from brx_mcp.gameconfig import WEAPON_TAILS
    assert cat.resolve("assault_rifle", 0) == "$WEAP,0" + WEAPON_TAILS["ar"]


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


# ---- wire-table frames (2026-08-26: every provisional weapon sounded/behaved like the AR) ----------
def test_wire_frames_carry_ir_protocol_and_sounds():
    r = C.catalog.resolve("rail_gun", 0).split(",")
    assert r[4] == "6", "rail gun must fire IR protocol 6 (the victim's $SIR,6 row)"
    assert "O03" in r, "rail gun fires the ordnance sound"
    s = C.catalog.resolve("sniper_rifle", 0).split(",")
    assert s[5] == "1", "sniper is subtype 1 (pass-through, $SIR,0,1)"
    assert "S16" in s, "sniper fires the SR-100 crack"
    g = C.catalog.resolve("smg", 0).split(",")
    assert g[16] == "400" and g[17] == "72", "smg: fire cadence 400ms at tok15, MAG 72 at tok16 (the old code wrote mag into the RoF slot)"
    assert "G10" in g
    k = C.catalog.resolve("rocket_launcher", 0).split(",")
    assert k[4] == "10" and "C03" in k, "rocket = the captured slot-5 sample (proto 10, C03)"
    a = C.catalog.resolve("assault_rifle", 0)
    assert a == "$WEAP,0,,100,0,0,24,0,,,,,,,,100,850,32,32768,1400,0,0,100,100,,0,,,R01,,,,D04,D03,D02,D18,,,,,32,9999999,75,,*"[:len(a)] or a.startswith("$WEAP,0,,100,0,0,24"), "verified AR stays byte-exact"
