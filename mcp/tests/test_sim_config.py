"""Exhaustive GameConfig → BRX-frame correctness, setup/teardown lifecycle, and
environment/loadout knobs — verified through both GameConfig directly and the
SimGame harness (config-all-then-spawn driver path, no Bluetooth).

This is the "the CONFIG must produce EXACTLY the right frames on real guns" test:
every knob in the gameconfig.py / modes/ docstrings (docs/m0-game-engine.md was retired 2026-09-06) config table is asserted against the
frame it is documented to drive, NOT blindly against whatever the code emits.

⚠ UNCONFIRMED-on-hardware bits (docs table + gameconfig docstrings): the LEDs-off
`$GLED` frame (FOLLOWUPS P17) and the `$PSET` shield token (P16). For those two we
assert the frame the code EMITS today and flag that hardware confirmation is still
pending — see the per-test comments. Everything else asserts documented behavior.

Any real config→frame MISMATCH vs the documented mapping is demoted to a
`scenario_*` function (not collected as a test) with a `# SUSPECTED BUG:` note.
"""

from brx_mcp.gameconfig import (
    GameConfig,
    WEAPON_TAILS,
    WEAPON_AMMO,
    RESPAWN_SEQUENCE,
    END_SEQUENCE,
    VOLUME_LEVELS,
)
from brx_mcp.sim import SimGame


# --------------------------------------------------------------------------- #
# helpers                                                                      #
# --------------------------------------------------------------------------- #
def _find(frames, prefix):
    return [f for f in frames if f.startswith(prefix)]


def _toks(frame):
    """BRX frame → token list, e.g. '$GSET,1,0,...,*' → ['GSET','1','0',...]."""
    return frame.strip().lstrip("$").rstrip("*").rstrip(",").split(",")


# --------------------------------------------------------------------------- #
# Setup ordering — B10 barrier: ALL guns fully configured (incl $TID) BEFORE   #
# any gun is spawned.                                                          #
# --------------------------------------------------------------------------- #
def test_b10_all_config_before_any_spawn():
    g = SimGame(GameConfig(mode="tdm", game_time_s=0)).setup()
    frames = g.all_frames()  # [(pid, frame), ...] in send order
    # $SPAWN / $AMMO are unique to the spawn phase ($BMAP/$CLEAR also appear in
    # setup, so they are NOT valid spawn markers).
    spawn_idx = [i for i, (_, f) in enumerate(frames)
                 if f.startswith("$SPAWN") or f.startswith("$AMMO")]
    assert spawn_idx, "expected spawn frames to be sent"
    first_spawn = spawn_idx[0]
    before = frames[:first_spawn]
    # nothing spawn-ish may precede the barrier
    assert not any(f.startswith("$SPAWN") or f.startswith("$AMMO")
                   for _, f in before)
    # every gun must have received its full config INCLUDING $TID before it
    for pid in g.teams:
        assert any(p == pid and f.startswith("$TID,") for p, f in before), \
            f"{pid} was not fully configured (no $TID) before first spawn"


def test_b10_every_gun_gets_full_setup_config():
    # Each gun individually receives $VOL/$CLEAR/$START/$GSET/$PSET/$WEAP/$TID.
    g = SimGame(GameConfig(mode="tdm", game_time_s=0)).setup()
    for pid in g.teams:
        ff = g.frames_to(pid)
        for pfx in ("$VOL,", "$CLEAR,", "$START,", "$GSET,", "$PSET,",
                    "$WEAP,0", "$WEAP,1", "$TID,"):
            assert _find(ff, pfx), f"{pid} missing {pfx}"


# --------------------------------------------------------------------------- #
# $GSET tokens — friendly_fire (t1), outdoor (t2), crit_modifier (t7)          #
# $GSET,friendlyFire,outdoorMode,gunLaserRegion,autoAmbientLight,gyroscope,    #
#       secondaryBluetoothWeapons,criticalShotModifier,gameMods,*             #
# --------------------------------------------------------------------------- #
def test_gset_friendly_fire_token1():
    on = _toks(_find(GameConfig(friendly_fire=True).setup_frames(), "$GSET,")[0])
    off = _toks(_find(GameConfig(friendly_fire=False).setup_frames(), "$GSET,")[0])
    assert on[1] == "1" and off[1] == "0"


def test_gset_outdoor_token2():
    ind = _toks(_find(GameConfig(outdoor=False).setup_frames(), "$GSET,")[0])
    out = _toks(_find(GameConfig(outdoor=True).setup_frames(), "$GSET,")[0])
    assert ind[2] == "0" and out[2] == "1"


def test_gset_crit_modifier_token7():
    lo = _toks(_find(GameConfig(crit_modifier=25).setup_frames(), "$GSET,")[0])
    hi = _toks(_find(GameConfig(crit_modifier=90).setup_frames(), "$GSET,")[0])
    assert lo[7] == "25" and hi[7] == "90"


# --------------------------------------------------------------------------- #
# $PSET tokens 3–5 = HP / armor / shield                                       #
# --------------------------------------------------------------------------- #
def test_pset_hp_armor_shield_tokens():
    toks = _toks(_find(GameConfig(hp=99, armor=88, shield=77).setup_frames(),
                       "$PSET,")[0])
    assert toks[3] == "99"   # HP
    assert toks[4] == "88"   # armor
    # ⚠ UNCONFIRMED (FOLLOWUPS P16): the shield pool is inactive until activated on
    # hardware. We assert the code writes it to $PSET token 5, pending confirmation.
    assert toks[5] == "77"   # shield (P16 — hardware-confirmation pending)


def test_pset_changes_with_config():
    a = _toks(_find(GameConfig(hp=10, armor=20, shield=30).setup_frames(), "$PSET,")[0])
    b = _toks(_find(GameConfig(hp=60, armor=50, shield=40).setup_frames(), "$PSET,")[0])
    assert (a[3], a[4], a[5]) == ("10", "20", "30")
    assert (b[3], b[4], b[5]) == ("60", "50", "40")


# --------------------------------------------------------------------------- #
# Volume → $VOL,<n>,0,* and VOLUME_LEVELS mapping                              #
# --------------------------------------------------------------------------- #
def test_volume_frame():
    assert _find(GameConfig(volume=69).setup_frames(), "$VOL,69,0,*")
    assert _find(GameConfig(volume=30).setup_frames(), "$VOL,30,0,*")


def test_volume_levels_constant():
    # on-gun level 1–5 ≈ 60/70/80/90/100 (docs config table)
    assert VOLUME_LEVELS == {1: 60, 2: 70, 3: 80, 4: 90, 5: 100}


# --------------------------------------------------------------------------- #
# Weapon selection → $WEAP slots 0/1 (+ melee slot 4); spawn $AMMO matches the #
# SELECTED primary/secondary (loadout-correct ammo).                          #
# --------------------------------------------------------------------------- #
def test_weap_slots_0_1_and_melee_4():
    frames = GameConfig(primary="charge", secondary="ar").setup_frames()
    assert _find(frames, "$WEAP,0")[0] == "$WEAP,0" + WEAPON_TAILS["charge"]
    assert _find(frames, "$WEAP,1")[0] == "$WEAP,1" + WEAPON_TAILS["ar"]
    # the app always loads a melee weapon in slot 4
    assert _find(frames, "$WEAP,4")[0] == "$WEAP,4" + WEAPON_TAILS["melee"]


def test_spawn_ammo_matches_selected_loadout():
    # $AMMO,0 = primary mag/reserve, $AMMO,1 = secondary mag/reserve
    frames = GameConfig(primary="charge", secondary="secondary").spawn_frames()
    pmag, pres = WEAPON_AMMO["charge"]
    smag, sres = WEAPON_AMMO["secondary"]
    assert _find(frames, "$AMMO,0")[0] == f"$AMMO,0,{pmag},{pres},1,*"
    assert _find(frames, "$AMMO,1")[0] == f"$AMMO,1,{smag},{sres},1,*"


def test_spawn_ammo_default_loadout():
    frames = GameConfig().spawn_frames()
    assert _find(frames, "$AMMO,0")[0] == "$AMMO,0,36,108,1,*"   # primary
    assert _find(frames, "$AMMO,1")[0] == "$AMMO,1,6,12,1,*"     # secondary


def test_sim_spawn_ammo_reflects_loadout():
    # Through the real driver path: the ammo pushed to a gun matches the class weapon.
    g = SimGame(GameConfig(mode="tdm", primary="charge", game_time_s=0)).setup()
    pmag, pres = WEAPON_AMMO["charge"]
    assert f"$AMMO,0,{pmag},{pres},1,*" in g.frames_to("G1")


# --------------------------------------------------------------------------- #
# Class presets — apply the right hp/armor/loadout.                            #
# --------------------------------------------------------------------------- #
def test_class_assault():
    s = GameConfig(game_class="assault").apply_presets()
    assert s.primary == "ar" and s.hp == 45 and s.armor == 70


def test_class_heavy():
    s = GameConfig(game_class="heavy").apply_presets()
    assert s.primary == "charge" and s.hp == 60 and s.armor == 100


def test_class_scout():
    s = GameConfig(game_class="scout").apply_presets()
    assert s.primary == "primary" and s.hp == 35 and s.armor == 50


def test_class_guardian():
    s = GameConfig(game_class="guardian").apply_presets()
    assert s.primary == "primary" and s.hp == 75 and s.armor == 125


def test_class_loadout_reaches_pset_and_weap():
    # apply_presets() must actually feed setup_frames() (not just summary()).
    frames = GameConfig(game_class="guardian").setup_frames()
    pset = _toks(_find(frames, "$PSET,")[0])
    assert pset[3] == "75" and pset[4] == "125"   # guardian hp/armor


# --------------------------------------------------------------------------- #
# kid_mode — floors health AND forces friendly_fire off; class-first then      #
# kid-mode floors (a low-HP class can't drop below the kid minimum).           #
# --------------------------------------------------------------------------- #
def test_kid_mode_floors_and_disables_ff():
    s = GameConfig(kid_mode=True, hp=45, armor=70, friendly_fire=True,
                   crit_modifier=90).apply_presets()
    assert s.hp >= 75 and s.armor >= 100
    assert s.friendly_fire is False        # protective override
    assert s.crit_modifier <= 25           # soft crits


def test_presets_class_first_then_kid_floor():
    # scout is a LOW-hp class (35/50); kid-mode must FLOOR it up to 75/100, proving
    # class applies first and kid-mode floors on top (can't drop below kid minimum).
    s = GameConfig(game_class="scout", kid_mode=True).apply_presets()
    assert s.primary == "primary"          # scout loadout preserved
    assert s.hp == 75 and s.armor == 100    # floored, not scout's 35/50


def test_kid_mode_does_not_lower_high_class():
    # guardian (75/125) already exceeds the kid floor → unchanged upward.
    s = GameConfig(game_class="guardian", kid_mode=True).apply_presets()
    assert s.hp == 75 and s.armor == 125


def test_kid_mode_keeps_explicit_higher_hp():
    s = GameConfig(kid_mode=True, hp=120).apply_presets()
    assert s.hp == 120


# --------------------------------------------------------------------------- #
# Night mode — outdoor + LEDs off. is_night_mode() and the $GLED emission.     #
# --------------------------------------------------------------------------- #
def test_is_night_mode_combo():
    assert GameConfig(outdoor=True, leds=False).is_night_mode() is True
    assert GameConfig(outdoor=True, leds=True).is_night_mode() is False
    assert GameConfig(outdoor=False, leds=False).is_night_mode() is False


def test_leds_off_emits_gled():
    # ⚠ UNCONFIRMED (FOLLOWUPS P17): turning LEDs OFF is a best-effort $GLED guess,
    # NOT hardware-confirmed. We assert the frame the code EMITS today so a change to
    # it is caught; the mapping itself still needs verification on a real gun.
    frames = GameConfig(outdoor=True, leds=False).setup_frames()
    assert _find(frames, "$GLED,") == ["$GLED,,,,5,,,*"]  # P17 CLOSED 2026-08-30: blanks all three


def test_leds_on_emits_no_gled():
    assert not _find(GameConfig(outdoor=True, leds=True).setup_frames(), "$GLED,")
    assert not _find(GameConfig(outdoor=False, leds=True).setup_frames(), "$GLED,")


# --------------------------------------------------------------------------- #
# respawn_delay — ramp 15/30/45/90; constant respawn_s without ramp.           #
# --------------------------------------------------------------------------- #
def test_respawn_ramp_progression():
    cfg = GameConfig(respawn_ramp=True, respawn_s=15)
    assert [cfg.respawn_delay(i) for i in range(4)] == [15, 30, 45, 90]
    assert cfg.respawn_delay(9) == 90       # caps at the top rung


def test_respawn_constant_without_ramp():
    cfg = GameConfig(respawn_ramp=False, respawn_s=20)
    assert all(cfg.respawn_delay(i) == 20 for i in range(6))


# --------------------------------------------------------------------------- #
# Teardown — END_SEQUENCE ($SPAWN revive + $PLAYX,0 silence + $STOP/$CLEAR +    #
# headset blank $HLED) to EVERY gun.                                          #
# --------------------------------------------------------------------------- #
def test_teardown_end_sequence_to_every_gun():
    g = SimGame(GameConfig(mode="tdm", game_time_s=0)).setup()
    n = len(g.all_frames())            # snapshot boundary: only look at teardown output
    g.teardown()
    tail = {}
    for pid, f in g.all_frames()[n:]:
        tail.setdefault(pid, []).append(f)
    for pid in g.teams:
        for frame in END_SEQUENCE:
            assert frame in tail[pid], f"{pid} teardown missing {frame}"
    # spot-check the documented roles are present
    for pid in g.teams:
        assert "$SPAWN,,*" in tail[pid]          # revive a gun left DEAD at game end
        assert "$PLAYX,0,*" in tail[pid]         # silence the spawn voice
        assert "$STOP,*" in tail[pid] and "$CLEAR,*" in tail[pid]
        assert "$HLED,0,0,0,0,0,0,*" in tail[pid]  # blank the headset LED


def test_respawn_sequence_constant():
    # RESPAWN_SEQUENCE is the mid-game revive the driver replays on a Respawn action.
    assert RESPAWN_SEQUENCE == ("$HLOOP,0,0,*", "$SPAWN,,*")


# --------------------------------------------------------------------------- #
# summary() — expected dict shape/values (reflects presets).                   #
# --------------------------------------------------------------------------- #
def test_summary_shape_and_preset_reflection():
    s = GameConfig(mode="ffa", kid_mode=True, hp=45, armor=70,
                   outdoor=True, leds=False, volume=69).summary()
    expected_keys = {
        "mode", "game_time_s", "respawn_s", "respawn_ramp", "respawns", "lives",
        "volume", "outdoor", "leds", "night_mode", "kid_mode", "friendly_fire",
        "crit_modifier", "hp", "armor", "shield", "primary", "secondary", "class",
    }
    assert set(s.keys()) == expected_keys
    assert s["mode"] == "ffa"
    assert s["kid_mode"] is True
    assert s["friendly_fire"] is False        # kid-mode override reflected
    assert s["hp"] >= 75 and s["armor"] >= 100  # kid-mode floors reflected
    assert s["night_mode"] is True             # outdoor + leds off
    assert s["volume"] == 69


def test_summary_lives_from_respawns():
    assert GameConfig(respawns=3).summary()["lives"] == 4
    assert GameConfig().summary()["lives"] is None      # unlimited


def test_alt_reload_remaps_orange_button_to_reload():
    # default: orange alt button (id 1) = weapon-cycle (fn 100)
    off = GameConfig(mode="tdm").setup_frames()
    assert any(f.startswith("$BMAP,1,100") for f in off)
    assert not any(f.startswith("$BMAP,1,97") for f in off)
    # alt_reload: id 1 → reload (fn 97); reload handle (id 2) stays reload
    on = GameConfig(mode="tdm", alt_reload=True).setup_frames()
    assert "$BMAP,1,97,,,,,*" in on
    assert not any(f.startswith("$BMAP,1,100") for f in on)
    assert "$BMAP,2,97,,,,,*" in on                 # the lever still reloads too
    # and it reaches the guns through the driver
    from brx_mcp.sim import SimGame
    g = SimGame(GameConfig(mode="tdm", alt_reload=True)).setup()
    assert "$BMAP,1,97,,,,,*" in g.frames_to("G1")
