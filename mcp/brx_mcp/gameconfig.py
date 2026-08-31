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
_PSET_TAIL = ["50", "", "H44", "JAD", "V33", "V3I", "V3C", "V3G", "V3E", "V37",
              "H06", "H55", "H13", "H21", "H02", "U15", "W71", "A10"]

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
    volume: int = 75                  # 0–100 ($VOL). ~75 indoor, ~85 outdoor.

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
        """The requested combo: outdoor behaviour with the LEDs off."""
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

    def _pset(self, player_id: int = 0) -> str:
        """`$PSET,<playerId>,0,<hp>,<armor>,<shield>,…`

        Token 1 is the PLAYER ID (protocol §7p, confirmed by cap10+cap11): 6 bits,
        **0-based, 0–63** on the wire, while the Callsign UI shows 1–64. Out-of-range
        values are clamped rather than silently wrapped — a wrapped id would collide
        with another player's and mis-attribute kills."""
        pid = max(0, min(int(player_id), MAX_PLAYER_ID))
        toks = ["PSET", str(pid), "0",
                str(self.hp), str(self.armor), str(self.shield)] + _PSET_TAIL
        return "$" + ",".join(toks) + ",*"

    def _gset(self) -> str:
        # $GSET,friendlyFire,outdoorMode,gunLaserRegion,autoAmbientLight,gyroscope,
        #       secondaryBluetoothWeapons,criticalShotModifier,gameMods,*
        return (f"$GSET,{int(self.friendly_fire)},{int(self.outdoor)},1,0,1,0,"
                f"{int(self.crit_modifier)},1,*")

    def _weap(self, slot: int, name: str) -> str:
        tail = WEAPON_TAILS.get(name, WEAPON_TAILS["primary"])
        return f"$WEAP,{slot}{tail}"

    def _led_frames(self) -> list[str]:
        # P17 CLOSED on hardware 2026-08-30. $GLED is NOT "mid/effect/optionA/optionB":
        # tokens 1-3 are the three gun LEDs, each a direct palette index, and TOKEN 4 = 3
        # blanks all three. This frame is the one Callsign itself sends on death, observed
        # blanking the gun; `$GLED,0,0,0,3,10,,*` (t4=3) was observed doing the same.
        # The previous value here ("$GLED,0,4,0,0,0,,*") was an unconfirmed guess built on
        # the retracted "colour index 0 = off" reading -- index 0 is RED, so that frame did
        # not turn anything off.
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
        """Respawn delay for the Nth death (ramps if enabled: 15/30/45/90…)."""
        if not self.respawn_ramp:
            return self.respawn_s
        ladder = [15, 30, 45, 90]
        return ladder[min(death_index, len(ladder) - 1)]

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
