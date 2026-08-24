"""Tests for the customizable GameConfig → frames mapping (M0)."""

from brx_mcp.gameconfig import GameConfig, WEAPON_TAILS


def _find(frames, prefix):
    return [f for f in frames if f.startswith(prefix)]


def test_defaults_produce_a_valid_setup():
    frames = GameConfig().setup_frames()
    assert _find(frames, "$VOL,75")
    assert _find(frames, "$GSET,")
    assert _find(frames, "$PSET,")
    assert _find(frames, "$WEAP,0")
    assert _find(frames, "$WEAP,1")
    assert "$START,*" in frames


def test_volume_maps():
    assert _find(GameConfig(volume=90).setup_frames(), "$VOL,90,0,*")


def test_hp_armor_shield_land_in_pset():
    # $PSET tokens 3,4,5 = HP, armor, shield
    frames = GameConfig(hp=99, armor=88, shield=77).setup_frames()
    pset = _find(frames, "$PSET,")[0]
    toks = pset.strip("$").rstrip(",*").split(",")
    assert toks[3] == "99" and toks[4] == "88" and toks[5] == "77"


def test_outdoor_and_friendly_fire_in_gset():
    # $GSET,friendlyFire,outdoorMode,... ; ff off + outdoor on
    frames = GameConfig(outdoor=True, friendly_fire=False, crit_modifier=25).setup_frames()
    gset = _find(frames, "$GSET,")[0]
    toks = gset.strip("$").rstrip(",*").split(",")
    assert toks[1] == "0"    # friendlyFire off
    assert toks[2] == "1"    # outdoorMode on
    assert toks[7] == "25"   # crit modifier


def test_weapon_selection():
    frames = GameConfig(primary="charge", secondary="melee").setup_frames()
    w0 = _find(frames, "$WEAP,0")[0]
    w1 = _find(frames, "$WEAP,1")[0]
    assert w0 == "$WEAP,0" + WEAPON_TAILS["charge"]
    assert w1 == "$WEAP,1" + WEAPON_TAILS["melee"]


def test_night_mode_is_outdoor_plus_leds_off():
    cfg = GameConfig(outdoor=True, leds=False)
    assert cfg.is_night_mode()
    frames = cfg.setup_frames()
    # LEDs-off emits a (best-effort) $GLED; a leds-on config emits none
    assert _find(frames, "$GLED,")
    assert not _find(GameConfig(outdoor=True, leds=True).setup_frames(), "$GLED,")


def test_kid_mode_preset_boosts_health_and_disables_ff():
    s = GameConfig(kid_mode=True, hp=45, armor=70).apply_presets()
    assert s.hp >= 75 and s.armor >= 100 and s.friendly_fire is False


def test_class_preset_sets_loadout():
    s = GameConfig(game_class="heavy").apply_presets()
    assert s.primary == "charge" and s.hp == 60 and s.armor == 100


def test_explicit_field_not_clobbered_by_kid_preset():
    # kid_mode raises hp to >=75, but if caller set hp higher it stays
    s = GameConfig(kid_mode=True, hp=120).apply_presets()
    assert s.hp == 120


def test_lives_and_respawn_ramp():
    cfg = GameConfig(respawns=3, respawn_ramp=True, respawn_s=15)
    assert cfg.lives() == 4
    assert cfg.respawn_delay(0) == 15
    assert cfg.respawn_delay(1) == 30
    assert cfg.respawn_delay(3) == 90
    assert cfg.respawn_delay(9) == 90     # caps
    # ramp off → constant
    assert GameConfig(respawn_s=20).respawn_delay(5) == 20


def test_unlimited_lives_default():
    assert GameConfig().lives() is None


def test_player_frames_sets_team_and_spawns():
    pf = GameConfig().player_frames(2)
    assert pf[0] == "$TID,2,*"
    assert "$SPAWN,,*" in pf


def test_summary_reflects_presets():
    s = GameConfig(kid_mode=True, mode="ffa").summary()
    assert s["mode"] == "ffa" and s["kid_mode"] is True and s["friendly_fire"] is False
