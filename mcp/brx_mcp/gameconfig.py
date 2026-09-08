"""GameConfig — the fully-customizable BRX game setup (M0).

Every knob the operator can set, mapped to the BRX frame(s) that apply it. This
replaces hardcoded config constants: build a GameConfig, call `.setup_frames()`
for the per-game config and `.player_frames(team)` for a gun's team/spawn, and the
driver sends them. Arbitrary combos work (e.g. outdoor + LEDs-off = "night mode").

What maps to the GUN (over BLE) vs the HOST engine:
  GUN   : volume, indoor/outdoor, friendly-fire, crit modifier, HP/armor/shield,
          primary/secondary weapon, team, LEDs.
  HOST  : game time, respawn time (+ ramp), number of respawns/lives, mode, classes'
          rule side — the gun has no respawn/time/lives token (protocol §7n), so the
          engine owns those.

Fields flagged (UNCONFIRMED) emit a best-effort frame + are tracked in FOLLOWUPS —
we don't silently guess a wrong value.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Optional

# --- weapon library (frame TAIL after "$WEAP,<slot>") ----------------------- #
# Mirrors mcp/brx_mcp/__main__.py WEAPON_TAILS (verified ones from the iOS capture).
# ⚠ NAMES vs REALITY (cap14, 2026-08-26): these keys are our own labels, and one is
# misleading — **"primary" (R18) is the BURST RIFLE** (3-round burst, one pull per
# burst), not a plain rifle. The actual full-auto Assault Rifle is **"ar" (R01)**.
# Every game we have run with the default loadout used a burst rifle. Keys are kept
# stable because the CLI takes them as arguments; prefer "ar" for a standard rifle.
WEAPON_TAILS: dict[str, str] = {
    "primary":   ",,100,0,3,9,0,,,,,,,,75,850,36,216,1700,0,9,100,100,275,0,,,R18,,,,D04,D03,D02,D18,,,,,36,108,75,*",
    "secondary": ",2,100,0,0,45,0,,,,,,70,80,900,850,6,24,400,2,7,100,100,,0,,,T01,,,,D01,D28,D27,D18,,,,,6,12,75,30,*",
    "melee":     ",1,90,13,1,90,0,,,,,,,,1000,100,1,0,0,10,13,100,100,,0,0,,M92,,,,,,,,,,,,1,0,20,*",
    "ar":        ",,100,0,0,24,0,,,,,,,,100,850,32,32768,1400,0,0,100,100,,0,,,R01,,,,D04,D03,D02,D18,,,,,32,9999999,75,,*",
    "charge":    ",,100,8,0,150,0,,,,,,,,1250,850,100,32768,2500,0,14,100,100,,14,,,E03,C15,C17,,D30,D29,D37,A73,C19,C04,20,150,100,9999999,75,,*",
}
WEAPONS = tuple(WEAPON_TAILS)

# (mag, reserve) per weapon — mirrors __main__.py WEAPON_AMMO. Spawn $AMMO is built
# from the SELECTED weapons, not hardcoded.
WEAPON_AMMO: dict[str, tuple[int, int]] = {
    "primary": (36, 108), "secondary": (6, 12), "melee": (1, 0),
    "ar": (32, 9999999), "charge": (20, 9999999),
}

# $PSET template — the app's voice-pack tail; tokens 3–5 (HP,armor,shield) are ours.
# tokenize: PSET,0,0,<HP>,<armor>,<shield>,50,,H44,...,A10
# $PSET token 1 = player id (§7p): a 6-bit wire value. The BRX hardware accepts 0–63; the
# platform reserves wire 0 for "no identity" (tutorial / unknown shooter) and assigns real
# players 1–63 (contracts A5.1). The MC compiler passes `player_num` (1–63) straight through.
MAX_PLAYER_ID = 63
# `$PSET`'s trailing tokens are a POSITIONAL VOICE PACK, one named game-event sound per slot
# (source-derived from the APK — protocol/callsign-extract/protocol-classes.md "PSET"):
#   deathAlarm, stealthDeathScream, musicMixOnDeath, deathScream, battleRespawnCry, meleeGrunt,
#   shortPain, longPain, painRelief, missShothit, hitHp, hitArrmor, hitShield, hitCrit,
#   emptyUnboundButtonSound, ammoOrGearPickUp, energyShieldLoop
# Only SIX of those are the character's own voice; the rest are shared effects. The shipped frame
# used the HEAVY pack (V3*) for every player, so persona was never per-player on the gun at all.
_PSET_HEAD = ["50", "", "H44", "JAD"]           # criticalDamageBonus, deathAlarm, stealthDeathScream, musicMixOnDeath
# A17 MATERIAL LAYER: tokens 2-5 of this foot are hitHp / hitArrmor / hitShield / hitCrit -- the
# firmware's own branch on WHICH POOL a hit bit into. They shipped as Callsign's inherited ids in
# every game we have run; `hitaudio.MATERIAL_POOLS` chooses and rolls them instead (metal for armour,
# body for health, energy for shield). `pset_foot(None)` still returns the inherited frame.
_PSET_FOOT_INHERITED = ["H06", "H55", "H13", "H21", "H02", "U15", "W71", "A10"]   # shared, not voice
_PSET_FOOT = _PSET_FOOT_INHERITED                                                 # back-compat alias


def pset_foot(hits: dict | None = None) -> list[str]:
    """The eight shared (non-voice) `$PSET` tail tokens, with the four A17 hit slots overridable.

    `hits` = `{hitaudio.MATERIAL_ROLES role: sound id}`. A role it omits gets the EAR-CONFIRMED default
    (`hitaudio.MATERIAL_DEFAULT`), NOT Callsign's inherited id -- A17 deliberately changed the shipped
    bytes, because three of the four inherited ids were wrong on the bench. Only the tokens outside the
    four hit slots and `energyShieldLoop` are still inherited untouched."""
    from .hitaudio import MATERIAL_DEFAULT, MATERIAL_ROLES, SHIELD_LOOP, SHIELD_LOOP_INDEX
    foot = list(_PSET_FOOT_INHERITED)
    foot[SHIELD_LOOP_INDEX] = SHIELD_LOOP     # A17: Callsign's A10 LOOPS a geiger tick while shield is up
    # A17: the four hit slots default to the EAR-CONFIRMED heads, not the inherited ids, so a gun that
    # is armed but not yet spawned already sounds right. `hits` (a roll or an operator pin) overrides.
    for i, role in enumerate(MATERIAL_ROLES, start=1):
        foot[i] = MATERIAL_DEFAULT[role]
    if hits:
        for i, role in enumerate(MATERIAL_ROLES, start=1):      # foot[0] is missShothit, then the four hits
            v = hits.get(role)
            if v is not None:            # "" is a DELIBERATE pick meaning the field ships EMPTY (A17
                foot[i] = str(v)         # health). Only a MISSING role keeps the default above.
    return foot

# The six voice slots, as suffixes on the family prefix, in $PSET order.
# Read off the HEAVY pack, which is decoded BY EAR in protocol/callsign-extract/sound-bank.md:
# V33 death scream · V3I "Get Some" respawn cry · V3G/V3E gasps. Slot "I" (the cry) is no longer WRITTEN
# (A15.2: the field ships empty, see voice_tail); it stays here as the family's spawn-pool default.
_VOICE_SLOTS = ("3", "I", "C", "G", "E", "7")

# Family prefix -> display name (docs/reference/sound-catalog.md "Character voices", read off the gun;
# sound-bank.md's older "VE clean male" is wrong -- the catalog's transcripts put VE = Soldier, VP = Male (clean)).
# The pack layout is shared: every family here carries all six slot ids, the by-ear doc shows the death
# scream at suffix 3/4/5 for Heavy, Medic, Male AND Scout alike, and the durations agree by role
# across every family (shortPain runs shorter than longPain everywhere; it is the briefest slot in all
# but creature and stalker). The three COMMANDER packs (VQ / VR / VS) are deliberately absent: they do not
# share the player layout (their G slot is a 3.3 s line, not a gasp). VK/VL, V0/VN and VD/VM have identical
# durations slot for slot, so they are probably the same audio under two names.
# ⚠ Only HEAVY is confirmed by ear. The rest are a well-founded inference from that structure — a
# wrong id would play a real but wrong sound, which is cosmetic and instantly audible. Confirm by
# picking a persona and dying once. The full line list per family: `voices.lines()`.
VOICE_PACKS = {
    "heavy": "V3", "medic": "V8", "male": "VA", "scout": "VB", "valkyrie": "VH",
    "clean_male": "VP", "soldier": "VE", "female_sniper": "VD", "female": "VM", "fury": "V0",
    "grenadier": "V1", "guardian": "V2", "hive_queen": "V4", "infiltrator": "V6",
    "marauder": "V7", "raider": "V9", "sentinel": "VC", "stalker": "VF", "technician": "VG",
    "viper": "VJ", "wraith": "VK", "russian": "VL", "mercenary": "VN", "creature": "V5",
}
DEFAULT_VOICE = "male"


# An unknown name falls back to HEAVY, not to the default: Heavy is the pack Callsign itself ships in
# every captured $PSET and the only one decoded by ear, so garbage input lands on measured ground
# rather than on an inferred family (review 2026-09-01 — the docstring used to promise this and the
# code did something else).
FALLBACK_VOICE = "heavy"


def voice_tail(voice: str | None, slots: dict | None = None) -> list[str]:
    """The six voice-slot tokens for a family, or HEAVY's if the name is unknown. `slots` = `{role: id}`
    overrides per `$PSET` field (roles in `voices.PSET_ROLES`, ids validated ON THE GUN) -- how a player
    picks WHICH death scream / pain line of the family the gun plays (A15).

    A15.2 (bench 2026-09-06, Tony): the battleRespawnCry token is EMPTY -- an empty field makes the firmware
    play NO voice line on `$SPAWN` (verified), and the node says the spawn line itself right after the spawn
    frames (`cues.spawn` / `cue_pools.spawn`), one random take per spawn. An explicit `respawn_cry` pick
    puts a firmware cry back. A15.3 (same bench): the meleeGrunt / shortPain / longPain tokens are EMPTY too --
    a `$PSET` with the voice fields empty still registers hits -- and the node plays the pain by damage
    (`cues.pain_short` / `pain_long` / `pain_melee`); the death scream stays the firmware's, rolled per spawn
    through `pset_frames`."""
    from .voices import pset_ids, PSET_ROLES          # local: voices imports this module
    ids = pset_ids(voice, slots)
    return [ids[r] for r in PSET_ROLES]

# $SIR incoming-IR effect table — ALL 10 rows, verbatim from __main__.py GAME_CONFIG
# (weapons + railgun + rocket + the 3 melee rows). Missing rows leave incoming
# melee/railgun/rocket IR with no effect mapping.
_SIR_TABLE = (
    "$SIR,0,0,,1,0,0,1,,*", "$SIR,0,1,,36,0,0,1,,*", "$SIR,0,3,,37,0,0,1,,*",
    "$SIR,8,0,,38,0,0,1,,*", "$SIR,9,3,,24,10,0,,,*",
    "$SIR,10,0,X13,1,0,100,2,60,*", "$SIR,6,0,H02,1,0,90,1,40,*",
    "$SIR,13,1,H57,1,0,0,1,,*", "$SIR,13,0,H50,1,0,0,1,,*",
    "$SIR,13,3,H49,1,0,100,0,60,*",
)
# $BMAP button map — mandatory or the trigger gives the "disabled" chirp.
_BMAP = (
    "$BMAP,0,0,,,,,*", "$BMAP,1,100,0,1,99,99,*", "$BMAP,2,97,,,,,*",
    "$BMAP,3,98,,,,,*", "$BMAP,4,98,,,,,*", "$BMAP,5,98,,,,,*", "$BMAP,8,4,,,,,*",
)
# Default spawn (default primary/secondary ammo). Prefer GameConfig.spawn_frames(),
# which recomputes $AMMO from the SELECTED weapons.
SPAWN_SEQUENCE = ("$SPAWN,,*", "$AMMO,0,36,108,1,*", "$AMMO,1,6,12,1,*", "$BMAP,0,0,,,,,*")
# ⚠️ F13 (bench-measured 2026-09-02): a respawn sent within ~2 s of the kill is never executed by
# the HEADSET -- it sticks in the green out-blink while the gun is alive and registering normally.
# 1.0 s and 2.0 s stick; 2.5 s, 3.0 s and 6.0 s are clean. The headset is a second device behind a
# relay, so a command it must also execute needs a settling gap. 3 s buys margin over the 2.0-2.5 s
# boundary without being noticeable next to a normal respawn timer.
def assert_sir_follows_clear(frames) -> None:
    """A bundle containing `$CLEAR` MUST send `$SIR` rows after it. Raises if it does not.

    ⚠️ F11, the worst bug this project has had (bench-proven 2026-09-02, deterministic 5/5):
    `$CLEAR` WIPES the `$SIR` table, and unmatched `$SIR` cells are silently ignored -- so a gun left
    with NO rows discards EVERY incoming hit. No `$HIR`, no headset flash, pools untouched, while it
    reports alive, in-game and healthy to `$QUERY`. It presents as a dead headset or a broken sensor
    and it is neither. Re-sending the `$SIR` rows alone restores it; `$START`, `$GSET`, `$PSET`,
    `$TID` and any number of `$SPAWN`s do not.

    Table SIZE is irrelevant (one row and ten both registered 24/24 in an interleaved A/B); only
    ABSENCE matters. So this checks ORDER and PRESENCE, not count.
    """
    last_clear = last_sir = -1
    for i, f in enumerate(frames):
        if f.startswith("$CLEAR"):
            last_clear = i
        elif f.startswith("$SIR"):
            last_sir = i
    if last_clear >= 0 and last_sir < last_clear:
        raise ValueError(
            "F11 GUARD: this frame bundle sends $CLEAR with no $SIR after it. $CLEAR wipes the "
            "$SIR table and a gun with no rows silently ignores EVERY hit while reporting healthy. "
            "Send the $SIR rows after the $CLEAR."
        )


MIN_RESPAWN_S = 3

RESPAWN_SEQUENCE = ("$HLOOP,0,0,*", "$SPAWN,,*")
# Game-over teardown (verified 2026-08-25 on Tactix-FE30): revive so a gun left DEAD at
# game end isn't stuck showing the death-glow ($SPAWN restores 45/70), immediately
# silence the spawn voice ($PLAYX,0), settle the game state ($STOP/$CLEAR), and blank
# the headset LED. Deliberately does NOT touch $TID — the gun pulses its LAST-GAME
# team colour (blue/yellow), a nice "you were on team X" end-of-match indicator.
END_SEQUENCE = ("$SPAWN,,*", "$PLAYX,0,*", "$STOP,*", "$CLEAR,*",
                "$HLOOP,0,0,*", "$HLED,0,0,0,0,0,0,*")

# on-gun volume 1–5 → $VOL (Tony's field-tested estimate), for the operator UI.
VOLUME_LEVELS = {1: 60, 2: 70, 3: 80, 4: 90, 5: 100}


@dataclass
class GameConfig:
    # -- mode + host-side timing (the gun has no token for these) ------------ #
    mode: str = "tdm"                 # tdm | ffa | infection | lms | extraction
    game_time_s: int = 300            # 0 = unlimited
    respawn_s: int = 15               # host-driven respawn delay
    respawn_ramp: bool = False        # ramp 15→30→45→90 per death (community pattern)
    respawns: Optional[int] = None    # max respawns (lives-1); None = unlimited
    frag_limit: int = 0               # 0 = none (mode-dependent)

    # -- audio --------------------------------------------------------------- #
    volume: int = 80                  # 0–100 ($VOL). MC sets this per venue via
                                      # `mc.compile.play_volume()` (80 indoor / 90 outdoor) — this
                                      # default is the indoor value so the CLI path agrees with it.
                                      # 69 (Callsign's) measures as on-gun level 2 (field 2026-08-30).

    # -- environment / LEDs -------------------------------------------------- #
    outdoor: bool = False             # $GSET outdoorMode (IR range/behaviour)
    leds: bool = True                 # False = blank all three gun LEDs (CONFIRMED, see _led_frames)
    kid_mode: bool = False            # gentle preset (applied in __post_init__-style)

    # -- combat rules -------------------------------------------------------- #
    friendly_fire: bool = True        # $GSET friendlyFire
    crit_modifier: int = 50           # $GSET criticalShotModifier (%)
    alt_reload: bool = False          # remap the orange ALT button → RELOAD ($BMAP,1,97)
                                      # for kids who can't work the lever; also removes the
                                      # secondary weapon-switch. Per-tagger pre-game option.

    # -- starting pools (tunable — Tony's ask) ------------------------------- #
    hp: int = 45
    armor: int = 70
    shield: int = 70                  # ⚠ shield pool inactive until activated (P16)

    # -- A17 hit audio ------------------------------------------------------- #
    # `{hitaudio.MATERIAL_ROLES role: sound id}` PINNED for this game: an operator's explicit pick
    # for what a hit on health / armour / shield / a crit sounds like. Roles left out are rolled per
    # $PSET write (`pset_frames(rng=…)`); None pins nothing and rolls all four.
    hit_sounds: Optional[dict] = None

    # -- CS / bomb mode ------------------------------------------------------ #
    attackers_team: int = 2
    defenders_team: int = 1
    detonation_s: float = 40.0
    rounds_to_win: int = 0            # 0 → single round

    # -- objective modes (domination / koth / ctf) --------------------------- #
    control_points: int = 3          # domination points (koth forces 1)
    score_target: int = 0            # domination: point-seconds to win (0 = time only)
    cap_target: int = 3              # ctf: flag captures to win

    # -- extraction mode ----------------------------------------------------- #
    channel_s: float = 45.0          # time to hold the extraction point
    win_target: int = 0              # banked value to win (0 = host ends; else score_target)
    loot_per_kill: int = 10          # loot a killer gains per kill
    drop_policy: str = "ground"      # dropped-loot policy: ground | killer | pool
    extract_removes_player: bool = True   # extracting leaves the raid (else respawn clean)

    # -- health variants (host-driven, confirmed via $LIFE — exp-log #33) ----- #
    syphon: bool = False              # heal the killer on each kill (Fortnite/CoD)
    syphon_armor: int = 30            # armor granted to the killer per kill
    syphon_hp: int = 0
    regen: bool = False               # Halo-style: refill after no damage for a delay
    regen_delay_s: float = 6.0        # no-damage window before regen kicks in

    # -- loadout ------------------------------------------------------------- #
    primary: str = "primary"          # a WEAPON_TAILS key
    secondary: str = "secondary"
    game_class: Optional[str] = None  # a preset that overrides weapon/hp/etc. (below)

    # -- teams (player_id → team) ; the driver also assigns $TID per gun ------ #
    teams: dict = field(default_factory=dict)

    # -- per-gun PLAYER ID (§7p) — {player_id: wire_id}, 0-based 0–63 ---------- #
    # Empty = the driver auto-numbers the fleet 0,1,2…. Pin ids only when they must
    # match something external (a printed roster, a previous game's scoreboard).
    player_ids: dict = field(default_factory=dict)

    # --------------------------------------------------------------------- #
    def apply_presets(self) -> "GameConfig":
        """Return a copy with class then kid_mode presets applied.

        Order matters: **class first**, then kid_mode's health *floors* (so a
        low-HP class like scout can't drop below the kid-mode minimum). kid_mode is
        deliberately protective — it forces friendly-fire OFF and caps crits — so
        those override even an explicit setting (that's the point of kid mode)."""
        cfg = replace(self)
        # class loadout first
        cls = (cfg.game_class or "").lower()
        if cls in _CLASSES:
            c = _CLASSES[cls]
            cfg = replace(cfg, primary=c.get("primary", cfg.primary),
                          secondary=c.get("secondary", cfg.secondary),
                          hp=c.get("hp", cfg.hp), armor=c.get("armor", cfg.armor))
        # then kid-mode protective floors/overrides
        if cfg.kid_mode:
            cfg = replace(cfg, hp=max(cfg.hp, 75), armor=max(cfg.armor, 100),
                          friendly_fire=False, crit_modifier=min(cfg.crit_modifier, 25))
        return cfg

    def is_night_mode(self) -> bool:
        """The requested combo: outdoor behaviour with the LEDs off.

        ⚠ The MC compiler (`mc.compile.Compiler`) no longer calls this (led-language.md §6 finding #2):
        conflating "outdoor and LEDs off" with "night" is exactly what made night mode delete the down
        signal along with every other light. MC reads `config["night"]` directly and treats it as a
        brightness/hold OVERLAY (`presentation.py`'s `night: bool` frame-builder arguments), separate
        from the `presentation.blackout` switch that actually turns every light off. This method stays
        for the legacy per-tagger CLI driver (`modes/driver.py`), which still uses this exact combo."""
        return self.outdoor and not self.leds

    # -- frame builders ------------------------------------------------------ #
    def _bmap(self) -> list[str]:
        """Button map. With `alt_reload`, the orange alt-fire button (id 1) is remapped
        from weapon-cycle (fn 100) to RELOAD (fn 97) — a kid-friendly reload that also
        drops the secondary weapon-switch. The reload handle (id 2) stays reload too."""
        bmap = list(_BMAP)
        if self.alt_reload:
            bmap[1] = "$BMAP,1,97,,,,,*"
        return bmap

    def _pset(self, player_id: int = 0, voice: str | None = None, slots: dict | None = None,
              hits: dict | None = None) -> str:
        """`$PSET,<playerId>,0,<hp>,<armor>,<shield>,…`

        Token 1 is the PLAYER ID (protocol §7p, confirmed by cap10+cap11): 6 bits,
        **0-based, 0–63** on the wire, while the Callsign UI shows 1–64. Out-of-range
        values are clamped rather than silently wrapped — a wrapped id would collide
        with another player's and mis-attribute kills."""
        pid = max(0, min(int(player_id), MAX_PLAYER_ID))
        toks = ["PSET", str(pid), "0",
                str(self.hp), str(self.armor), str(self.shield)] \
            + _PSET_HEAD + voice_tail(voice or getattr(self, "voice", None), slots) \
            + pset_foot(hits if hits is not None else getattr(self, "hit_sounds", None))
        return "$" + ",".join(toks) + ",*"

    def pset_frames(self, player_id: int = 0, voice: str | None = None, slots: dict | None = None,
                    rng=None) -> list[str]:
        """A15.3: one full `$PSET` frame per death-scream take of the family (`voices.roll_pool`), so the node can
        write ONE of them at random right before every `$SPAWN` and the firmware screams a different take each
        life. A pinned `death_scream` (or a family with one take) gives a single frame -- the same as `_pset`.
        Bench 2026-09-06: a `$PSET` re-sent mid-game keeps `$SIR`, does not heal, and the gun still fires.

        A17: when `rng` is given, EACH frame also carries its own draw from the material pools, so the same
        write that re-rolls the death scream re-rolls the four hit sounds. That is the whole anti-repetition
        mechanism for the material layer -- variety arrives between hits, never as a BLE round trip inside one.
        A pinned `hit_sounds` on the config still wins per role (`hitaudio.roll_material`)."""
        from .voices import check_slots, roll_pool
        from .hitaudio import roll_material
        fixed = check_slots(slots)
        pinned = getattr(self, "hit_sounds", None)
        def hits():
            return roll_material(rng, pinned) if rng is not None else pinned
        if "death_scream" in fixed:
            return [self._pset(player_id, voice, slots, hits())]
        takes = roll_pool(voice, "death_scream") or [None]
        return [self._pset(player_id, voice, {**(slots or {}), "death_scream": t} if t else slots, hits())
                for t in takes]

    def _gset(self) -> str:
        # $GSET,friendlyFire,outdoorMode,gunLaserRegion,autoAmbientLight,gyroscope,
        #       secondaryBluetoothWeapons,criticalShotModifier,gameMods,*
        return (f"$GSET,{int(self.friendly_fire)},{int(self.outdoor)},1,0,1,0,"
                f"{int(self.crit_modifier)},1,*")

    def _weap(self, slot: int, name: str) -> str:
        tail = WEAPON_TAILS.get(name, WEAPON_TAILS["primary"])
        return f"$WEAP,{slot}{tail}"

    def _led_frames(self) -> list[str]:
        # P17 CLOSED on hardware 2026-08-30. $GLED is NOT "mid/effect/optionA/optionB": tokens 1-3
        # are the three gun LEDs, each a direct palette index (0 red, 1 blue, 2 yellow, 3 green,
        # 4 purple, 5 teal, 6 white, 7 pink, 8 orange; 9+ dark -- all nine measured 2026-09-02).
        #
        # ⚠ CORRECTED 2026-09-02: TOKEN 4 IS AN APPLY GATE, not an effect enum and not an off
        # switch. 0/6/7/8/9/10 apply the frame's colour tokens at full brightness; 5 applies them
        # at about 1/3 brightness; 1/2/3/4 are NO-OPs that ignore the colour tokens and leave the
        # gun showing whatever it already showed. Nothing animates.
        # So THE SHIPPED FRAME BELOW BLANKS BECAUSE ITS COLOUR TOKENS ARE EMPTY AND t4=5 APPLIES
        # THEM -- applying an empty colour is what turns the LEDs off. 5 is not "the off value";
        # there may be no dedicated off value at all. (This also retracts two older claims in this
        # comment's history: "t4=3 blanks all three" -- no, 3 is a no-op, which is why a lit red gun
        # stayed red at [91,29,36] -> [94,35,50]; and "t4=5 is the off value" -- no, it is an apply.)
        # THE FRAME ITSELF WAS ALWAYS CORRECT and has never changed: it is Callsign's own death
        # frame, and it does blank. Only the explanation beside it was wrong.
        #
        # Token 5 (brightness) is separate and three-state: 0 off, 1 dim (~70%), >=2 full
        # (saturates at 2). $GLED therefore has two apparent brightness controls (t4=5 and token 5);
        # whether they compose or one overrides the other is UNTESTED.
        #
        # The value before that ("$GLED,0,4,0,0,0,,*") was an unconfirmed guess built on the
        # retracted "colour index 0 = off" reading -- index 0 is RED, so it turned nothing off.
        if self.leds:
            return []
        return ["$GLED,,,,5,,,*"]  # blank all three (bench + Callsign capture)

    def setup_frames(self, player_id: int = 0) -> list[str]:
        """Ordered config frames for ONE gun. `player_id` is that gun's identity
        (wire 0–63; the platform uses 1–63, reserving 0 — contracts A5.1) and rides in
        `$PSET` token 1 — see `_pset`. Everything else
        is per-game and identical across guns."""
        cfg = self.apply_presets()
        frames = [f"$VOL,{cfg.volume},0,*", "$CLEAR,*", "$START,*", cfg._gset(),
                  cfg._pset(player_id), cfg._weap(0, cfg.primary), cfg._weap(1, cfg.secondary),
                  cfg._weap(4, "melee")]              # the app always loads a melee slot
        frames += list(_SIR_TABLE) + cfg._bmap()
        frames += cfg._led_frames()
        frames += ["$PLAYX,0,*", "$PLAY,VA81,4,6,,,,,*"]  # game-start sound
        assert_sir_follows_clear(frames)
        return frames

    def spawn_frames(self) -> list[str]:
        """Spawn live with $AMMO computed from the SELECTED primary/secondary."""
        cfg = self.apply_presets()
        pmag, pres = WEAPON_AMMO.get(cfg.primary, WEAPON_AMMO["primary"])
        smag, sres = WEAPON_AMMO.get(cfg.secondary, WEAPON_AMMO["secondary"])
        return ["$SPAWN,,*", f"$AMMO,0,{pmag},{pres},1,*",
                f"$AMMO,1,{smag},{sres},1,*", "$BMAP,0,0,,,,,*"]

    def player_frames(self, team: int) -> list[str]:
        """Per-gun frames: set team, then spawn live (loadout-correct ammo)."""
        return [f"$TID,{team},*"] + self.spawn_frames()

    def lives(self) -> Optional[int]:
        """Total lives = respawns + 1 (None = unlimited)."""
        return None if self.respawns is None else self.respawns + 1

    def respawn_delay(self, death_index: int) -> int:
        """Respawn delay for the Nth death (ramps if enabled: 15/30/45/90…).

        Floored at MIN_RESPAWN_S: a respawn sent too soon after the kill is never executed by the
        HEADSET, which then sticks in the green out-blink while the gun plays on normally (F13).
        """
        if not self.respawn_ramp:
            return max(MIN_RESPAWN_S, self.respawn_s)
        ladder = [15, 30, 45, 90]
        return max(MIN_RESPAWN_S, ladder[min(death_index, len(ladder) - 1)])

    def summary(self) -> dict:
        cfg = self.apply_presets()
        return {
            "mode": cfg.mode, "game_time_s": cfg.game_time_s,
            "respawn_s": cfg.respawn_s, "respawn_ramp": cfg.respawn_ramp,
            "respawns": cfg.respawns, "lives": cfg.lives(), "volume": cfg.volume,
            "outdoor": cfg.outdoor, "leds": cfg.leds, "night_mode": cfg.is_night_mode(),
            "kid_mode": cfg.kid_mode, "friendly_fire": cfg.friendly_fire,
            "crit_modifier": cfg.crit_modifier, "hp": cfg.hp, "armor": cfg.armor,
            "shield": cfg.shield, "primary": cfg.primary, "secondary": cfg.secondary,
            "class": cfg.game_class,
        }


# Class presets (from the APK class list; loadout-level — a starting point).
# NOTE: `assault`/`heavy` use the `ar`/`charge` weapons, which are §6 doc examples our
# hardware has NOT fired yet — treat those two as provisional until verified.
_CLASSES: dict[str, dict] = {
    "assault":   {"primary": "ar", "secondary": "secondary", "hp": 45, "armor": 70},     # provisional weapon
    "heavy":     {"primary": "charge", "secondary": "secondary", "hp": 60, "armor": 100}, # provisional weapon
    "scout":     {"primary": "primary", "secondary": "secondary", "hp": 35, "armor": 50},
    "guardian":  {"primary": "primary", "secondary": "secondary", "hp": 75, "armor": 125},
}
