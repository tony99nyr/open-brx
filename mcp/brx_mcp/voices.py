"""The character VOICES: every line a voice family carries, what each line is for, and which of them the
gun (via `$PSET`) or the bundle (via a `voice:<role>` sound) actually plays.

Ground truth is the on-gun catalog (`data/sound_catalog.json`, read off a v4.32 tagger 2026-09-03): every
player character is one family prefix (`V3` Heavy, `VA` Male player, …) with a shared 22-slot layout,
suffixes `1`-`9` then `A`-`M` (docs/reference/sound-catalog.md "Character voices"). The `$PSET` tail names SIX
of those slots and the firmware plays them on its own (death scream on death, respawn cry on `$SPAWN`, the
pains on hits, pain relief on a heal); everything else -- intro, taunts, kill confirms, name -- is a line WE
can play with `$PLAY` at a moment we choose (a "personality moment", Tony 2026-09-06). Slot 2 is the tear-gas
death (coughing; VA2 is the documented `$SIR,11` victim sound), not an idle line.

A15.1 VARIETY (Tony, 2026-09-06 bench: "they are all equal and should be picked at random to make the sounds
more dynamic"): the `$PSET` fields are written once per arm, so `roll_pset()` picks each field from a curated
pool (`ROLL_POOLS`) per push / per arm; the lines we send ourselves come as POOLS (`role_ids()`) and the node
picks one at random per event -- three kill confirms + two taunts on a single kill.

A15.2 THE SPAWN LINE IS OURS (Tony, 2026-09-06 bench, both probes verified clean): the `$PSET` battleRespawnCry
field is shipped EMPTY, which makes the firmware play no voice line on `$SPAWN`, and the node writes one
`$PLAY` of the character's spawn pool (`role_ids(voice, "spawn")`: the boast, plus VAI / VAN / VAO for the Male
player -- "all good at spawn picked randomly") immediately after the spawn / revive frames. So every spawn gets
a fresh draw with no `$PSET` re-write, and `respawned` carries `voice:spawn`. (A `$PLAYX,0` after `$SPAWN` was
tried first and cut the firmware's cry mid-word; re-sending `$PSET` mid-game did not wipe `$SIR`.)

A15.3 THE PAINS ARE OURS, THE SCREAM STAYS NATIVE (Tony, 2026-09-06 bench): our `$PLAY` on the death was "a
little off" (a BLE round trip after the hit), so the death scream stays a `$PSET` field -- but the node writes ONE
of `FrameBundle.pset_pool` (a full `$PSET` per death-scream take) right before every `$SPAWN`, so the firmware
screams a different take each life (re-sending `$PSET` mid-game keeps `$SIR`, does not heal, the gun still fires).
The three pain fields (meleeGrunt / shortPain / longPain) ship EMPTY and the node plays the pain itself on each
`$HIR`, choosing the pool by DAMAGE: "A big sniper shot -> long pain. A normal round -> short pain" (`pain_long`
at or above `PAIN_LONG_MIN_DAMAGE`, else `pain_short`; a melee word -> `pain_melee`).

Not here: the family -> name table (`gameconfig.VOICE_PACKS`, so the `$PSET` builder and this module agree)
and the frame shape (`presentation.play_frame`).
"""
from __future__ import annotations

import re
from typing import TypedDict

from . import sounds as snd
from .gameconfig import VOICE_PACKS, DEFAULT_VOICE, FALLBACK_VOICE, _VOICE_SLOTS

# suffix -> (role, group). `hit` = the firmware's own reactions; `personality` = lines we place ourselves.
SLOT_ROLES: dict[str, tuple[str, str]] = {
    "1": ("intro", "personality"), "2": ("gas_death", "hit"),
    "3": ("death_scream", "hit"), "4": ("death_scream", "hit"), "5": ("death_scream", "hit"),
    "6": ("hurt_loop", "hit"), "7": ("healed", "hit"),
    "8": ("kill_confirm", "personality"), "9": ("kill_confirm", "personality"), "A": ("kill_confirm", "personality"),
    "B": ("defeat_taunt", "personality"),
    "C": ("pain", "hit"), "D": ("pain", "hit"), "E": ("pain", "hit"), "F": ("pain", "hit"), "G": ("pain", "hit"), "H": ("pain", "hit"),
    "I": ("boast", "personality"), "J": ("long_death", "extra"),
    "K": ("taunt", "personality"), "L": ("taunt", "personality"), "M": ("name", "personality"),
}
ROLE_WORDS = {"intro": "intro", "gas_death": "gas death (tear gas)", "death_scream": "death scream", "hurt_loop": "hurt loop",
              "healed": "healed", "kill_confirm": "kill confirm", "defeat_taunt": "defeat taunt", "pain": "pain",
              "boast": "boast", "long_death": "long death (unused)", "taunt": "taunt", "name": "name", "extra": "extra line",
              "spawn": "spawn line", "pain_short": "short pain", "pain_long": "long pain", "pain_melee": "melee grunt",
              "reload_nag": "reload nag", "shield_down": "shield depleted", "shield_charging": "shield charging",
              "shield_full": "shields online", "shield_loop": "shield-down heartbeat"}

# The six `$PSET` voice fields (APK field names), in frame order, and the slot each takes by default
# (`gameconfig._VOICE_SLOTS`: 3 I C G E 7). `kill` is the seventh voice-dependent id: the bundle's kill cue.
PSET_ROLES = ("death_scream", "respawn_cry", "melee_grunt", "short_pain", "long_pain", "pain_relief")
PSET_FIELD = {"death_scream": "deathScream", "respawn_cry": "battleRespawnCry", "melee_grunt": "meleeGrunt",
              "short_pain": "shortPain", "long_pain": "longPain", "pain_relief": "painRelief"}
PSET_PLAYS_ON = {"death_scream": "died", "respawn_cry": "respawned", "melee_grunt": "hit_taken",
                 "short_pain": "hit_taken", "long_pain": "hit_taken", "pain_relief": "healed"}
# Roles the node plays for a STATE of the gun rather than for the character: the reload nag and the four
# shield moments. They are here, and not as literal ids in `presentation.EVENTS`, for two reasons.
#
#   1. A per-pack pick. The reload nag fires on the 5th dry pull and every 3rd after it, so a player hears it
#      hundreds of times a match. One fixed id means every player in every pack hears the same voice, which
#      wears out and undoes the point of choosing a character. `voice_slots: {reload_nag: "<id>"}` gives a
#      player or a host their own line, exactly as it does for the kill line.
#   2. One place to swap. Tony decides these by ear at the bench and has changed his mind twice already, so
#      the id has to be a one-line edit, not a rewrite. That line is `ROLE_FIXED` below.
#
# ⚠ HONEST LIMIT, and do not read the mechanism as more than it is: the character families carry no line for
# any of these. The gun's 22-slot family layout has no imperative "Reload" (`VX73` is the announcer's, and the
# per-pack `VD7`/`VH7`/`VL7`/`VM7`/`VP7` "Reloaded" are past tense AND already the `healed` slot), and the
# shield moments are effects and the `VA6` announcer. So today every pack resolves to the SAME id and
# `FAMILY_ROLE` is empty. The wiring is per-pack; the bank is not. A family earns a row the moment a line for
# it is confirmed by ear.
NODE_ROLES = ("reload_nag", "shield_down", "shield_charging", "shield_full", "shield_loop")
VOICE_ROLES = PSET_ROLES + ("kill", "spawn") + NODE_ROLES   # A15.2: `spawn` pins the node's spawn line (a one-id pool)
# A15.3: a pick in `melee_grunt` / `short_pain` / `long_pain` puts a FIRMWARE pain back into that `$PSET` field
# (the escape hatch); by default the three ship empty and the node plays `pain_*` itself.
# which of the family's slots make sense in each `$PSET` field (first = the default), for the pickers
# Tony, 2026-09-06 (bench): the hurt loop (slot 6) is good for critical-health; the long death (slot J)
# "is ridiculous, probably dont use that one for anything" -- so it stays catalogued but unused.
# A15.2: the respawn cry has no candidates -- the field ships EMPTY and the spawn line is the node's `spawn` pool.
# A15.3: neither have the three pains -- they ship EMPTY too and the node plays `pain_short` / `pain_long` /
# `pain_melee` by the hit's damage.
PSET_CANDIDATES = {"death_scream": "345", "respawn_cry": "", "melee_grunt": "",
                   "short_pain": "", "long_pain": "", "pain_relief": "7", "kill": "A89KL"}
# sounds a presentation event may name: "voice:<role>" resolves per player to that role's line (A15)
SOUND_ROLES = ("kill", "spawn", "intro", "gas_death", "death_scream", "hurt_loop", "healed", "kill_confirm", "defeat_taunt",
               "pain", "pain_short", "pain_long", "pain_melee", "boast", "taunt", "name") + NODE_ROLES

# THE ONE PLACE TO SWAP A NODE-ROLE ID. Every one of these is Tony's ear, at a bench, against the real thing,
# and every one of them is expected to change again -- there are live A/B candidates for most of them. Editing
# a row here changes the id everywhere: the compiled bundle, the stage, the pickers.
#
#   reload_nag       VX73  "Reload" (voice:menu, 1.0 s). The bank's only imperative. EAR-CONFIRMED on a gun
#                          2026-09-18, Tony: "yes that is the right sound".
#   shield_down      N101  Tony 2026-09-18, by ear through a gun: the shield-DEPLETED cue. It overturns the
#                          2026-09-17 decision to have no cue at the break at all. Catalogued as a 2.6 s
#                          falling one-shot, which is the right shape for a pool failing.
#   shield_charging  N102  Tony 2026-09-18, same session: the CHARGING-UP sound, played once on the first
#                          grant of a recharge. It replaces `A34` played twice through the refill (2026-09-17).
#                          Catalogued "rising / charge-up, 2.1 s" -- the shape the pick needs.
#   shield_full      VA6Y  "Shields Online" (2.0 s), Tony 2026-09-17 against a real 3.6 s refill: "that last
#                          one was the best one yet". NOT ruled on again since `shield_charging` moved, so it
#                          stands until he says otherwise.
#   shield_loop      N74   The heartbeat, looped by the node while the shield is down (2026-09-17). Also NOT
#                          re-ruled. ⚠ `presentation.EVENTS["low_health"]` plays the SAME id at HP < 15, so a
#                          shieldless player on low health hears one sound meaning two things -- flagged, not
#                          fixed here, because both were chosen by ear and only Tony can separate them.
#
# Still to A/B at the bench, from the same conversation: `W20` + `VA8B` (Callsign's own recipe, from a capture
# on 2026-09-18) against `N101`, and `A34` against `N102`.
ROLE_FIXED = {"reload_nag": ["VX73"], "shield_down": ["N101"], "shield_charging": ["N102"],
              "shield_full": ["VA6Y"], "shield_loop": ["N74"]}
# Per-FAMILY takes of a `ROLE_FIXED` role: `{family prefix: {role: [ids]}}`. Empty on purpose -- see NODE_ROLES.
FAMILY_ROLE: dict[str, dict[str, list[str]]] = {}
# role -> every slot that carries it, in slot order (the first is the deterministic default; the whole list is
# the pool the node rolls from, A15.1). `kill` = the kill confirms + the taunts, the documented kill line first.
ROLE_SLOTS = {"intro": "1", "gas_death": "2", "death_scream": "345", "hurt_loop": "6", "healed": "7",
              "kill_confirm": "89A", "defeat_taunt": "B", "pain": "CDEFGH", "boast": "I", "taunt": "KL", "name": "M",
              "spawn": "I",
              # A15.3: the pains the NODE plays on a `$HIR`, chosen by damage -- the short gasps (G H D C, the
              # briefest slots), the long ones (E F), the melee grunt (C); `pain` above = all six for an event.
              "pain_short": "GHDC", "pain_long": "EF", "pain_melee": "C"}
# A15.3: a hit at or above this wire damage (`$HIR` token 5) plays a LONG pain, below it a short one. The
# weapon table (wire tok5 per hit, mc/weapons.json): rifles / SMG / pistols / AMR 8-18 · shotgun 45 · snipers
# 80 · melee word 90 · charge rifle 100 · power weapons 115. A 1.5x crit on the heaviest rifle (18 -> 27) stays short.
PAIN_LONG_MIN_DAMAGE = 40
KILL_POOL_SLOTS = "A89KL"
# A15.2: what the node may say at every spawn (the boast; the Male player's extra lines VAN "Hoorah!" and VAO
# "Good to go." too -- Tony, 2026-09-06). Other families widen here once their extra lines are audited on the stage.
FAMILY_SPAWN = {"VA": "INO"}
_ROLE_SLOT = {r: s[0] for r, s in ROLE_SLOTS.items()} | {"kill": "A"}

# What the `$PSET` fields ROLL from (A15.1) -- Tony's ear, 2026-09-06: the three death screams "are all equal".
# Since A15.3 the death scream is the ONLY rolled field, and it is rolled per SPAWN (the node writes one of
# `pset_pool` before every `$SPAWN`), not only per push. The respawn cry and the three pains are not rolled: those
# fields ship empty (A15.2 / A15.3) and the node plays the line itself from `spawn` / `pain_*` pools.
ROLL_POOLS = {"death_scream": "345", "pain_relief": "7"}
# The `$PSET` fields that ship EMPTY because the node plays the line itself (A15.2 cry, A15.3 pains).
OURS = ("respawn_cry", "melee_grunt", "short_pain", "long_pain")
FAMILY_ROLL: dict[str, dict[str, str]] = {}


def family(voice: str | None) -> str:
    return VOICE_PACKS.get((voice or DEFAULT_VOICE).lower(), VOICE_PACKS[FALLBACK_VOICE])


def family_name(fam: str) -> str:
    """The catalog's speaker label for a family prefix ("Heavy", "Scout (female)")."""
    for suf in ("I", "3", "A"):
        e = snd._catalog().get(fam + suf)
        if e and e.get("speaker"):
            return e["speaker"]
    return fam


class VoiceCatalogOption(TypedDict):
    id: str
    name: str
    family: str
    speaker: str
    lines: int
    verified: bool


def options() -> list[VoiceCatalogOption]:
    """The picker: every selectable voice with its family, catalog name and line count."""
    out: list[VoiceCatalogOption] = []
    for v, fam in VOICE_PACKS.items():
        out.append({"id": v, "name": v.replace("_", " ").upper(), "family": fam, "speaker": family_name(fam),
                    "lines": len(lines(v)), "verified": v == "heavy"})
    return out


def check_slots(slots: dict | None) -> dict[str, str]:
    """Validate `{role: id}` overrides for the `$PSET` fields (+ `kill`): known role, an id ON THE GUN."""
    if not slots:
        return {}
    if not isinstance(slots, dict):
        raise ValueError("voice_slots must be an object {role: sound id}")
    out: dict[str, str] = {}
    on = snd.on_gun_ids()
    for role, sid in slots.items():
        if role not in VOICE_ROLES:
            raise ValueError(f"voice slot {role!r} is not one of {VOICE_ROLES}")
        if sid in (None, ""):
            continue
        if not isinstance(sid, str) or not re.fullmatch(r"[A-Z0-9_]{2,6}", sid.upper()):
            raise ValueError(f"voice slot {role}: {sid!r} is not a sound id")
        if sid.upper() not in on:
            raise ValueError(f"voice slot {role}: {sid!r} is not on the gun")
        out[role] = sid.upper()
    return out


def pset_ids(voice: str | None, slots: dict | None = None) -> dict[str, str]:
    """`{pset role: id}` for a voice -- the family's default slot, or the override. `respawn_cry` is "" (A15.2:
    the firmware says nothing on `$SPAWN`; the node plays the spawn pool) and so are the three pains (A15.3: the
    node plays `pain_short` / `pain_long` / `pain_melee` by damage) unless a pick puts a firmware line back."""
    fam = family(voice)
    ov = check_slots(slots)
    out = {role: fam + suf for role, suf in zip(PSET_ROLES, _VOICE_SLOTS)}
    for role in OURS:
        out[role] = ""
    out.update({r: i for r, i in ov.items() if r in PSET_ROLES})
    return out


def role_ids(voice: str | None, role: str, slots: dict | None = None) -> list[str]:
    """Every id a `voice:<role>` sound may resolve to for this player, default first (A15.1: the node picks one
    at random per event). An explicit override is the whole pool. `kill` = the documented kill line, then the
    other kill confirms and the two taunts (slot order 8 9 A K L minus the kill line)."""
    if role not in SOUND_ROLES:
        return []
    ov = check_slots(slots)
    if role in ov:
        return [ov[role]]
    fam = family(voice)
    on = snd.on_gun_ids()
    if role in ROLE_FIXED:
        # A node-state role (NODE_ROLES): this family's own take if it has one, else the shared default.
        return [i for i in ((FAMILY_ROLE.get(fam) or {}).get(role) or ROLE_FIXED[role]) if i in on]
    if role == "kill":
        from .mc.compile import kill_line
        first = kill_line(voice)
        rest = [fam + s for s in "89AKL" if fam + s in on and fam + s != first]
        return ([first] if first in on else []) + rest
    sufs = FAMILY_SPAWN.get(fam, ROLE_SLOTS[role]) if role == "spawn" else ROLE_SLOTS[role]
    return [fam + s for s in sufs if fam + s in on]


def role_id(voice: str | None, role: str, slots: dict | None = None) -> str | None:
    """The deterministic id for a `voice:<role>` sound: the first of `role_ids` (None when the family has none)."""
    ids = role_ids(voice, role, slots)
    return ids[0] if ids else None


def roll_pool(voice: str | None, role: str) -> list[str]:
    """The on-gun ids a `$PSET` field may be rolled from for this family, the family default first."""
    fam = family(voice)
    sufs = FAMILY_ROLL.get(fam, {}).get(role) or ROLL_POOLS.get(role, "")
    on = snd.on_gun_ids()
    default = fam + _VOICE_SLOTS[PSET_ROLES.index(role)] if role in PSET_ROLES and role not in OURS else None
    ids = [fam + s for s in sufs if fam + s in on]
    if default and default in on and default not in ids:
        ids.insert(0, default)
    return ids


def roll_pset(voice: str | None, slots: dict | None, rng) -> dict[str, str]:
    """`{pset role: id}` with every field an explicit pick did not fix ROLLED from its pool (`rng.choice`;
    a one-id pool is the default, no draw). Deterministic for a seeded `random.Random`."""
    ov = check_slots(slots)
    out = pset_ids(voice, slots)
    for role in PSET_ROLES:
        if role in ov:
            continue
        pool = roll_pool(voice, role)
        if len(pool) > 1:
            out[role] = rng.choice(pool)
    return out


def lines(voice: str | None, slots: dict | None = None) -> list[dict]:
    """Every line of the voice's family, in slot order, with its role, its words, and `uses`: which `$PSET`
    field carries it (so the firmware plays it), `cue:kill` (the bundle's kill line), and the pools the line
    sits in -- `pool:kill` / `pool:spawn` / `pool:pain_short` / `pool:pain_long` / `pool:pain_melee` (the node's
    per-event draw, A15.1/A15.2/A15.3) and `pool:death_scream` (the `$PSET` field rolled per spawn via
    `pset_pool`, A15.3)."""
    fam = family(voice)
    pset = pset_ids(voice, slots)
    kill = role_id(voice, "kill", slots)
    used: dict[str, list[str]] = {}
    for role, sid in pset.items():
        if sid:
            used.setdefault(sid, []).append(f"pset:{role}")
    if kill:
        used.setdefault(kill, []).append("cue:kill")
    fixed = check_slots(slots)
    for pool_role in ("kill", "spawn", "pain_short", "pain_long", "pain_melee"):
        if pool_role.startswith("pain_") and any(r in fixed for r in ("melee_grunt", "short_pain", "long_pain")):
            continue                                   # a pinned firmware pain: the node's pain pools are off
        ids = role_ids(voice, pool_role, slots)
        if len(ids) > 1 or pool_role.startswith("pain_"):
            for sid in ids:
                used.setdefault(sid, []).append(f"pool:{pool_role}")
    for role in PSET_ROLES:
        pool = roll_pool(voice, role)
        if len(pool) > 1 and role not in fixed:
            for sid in pool:
                used.setdefault(sid, []).append(f"pool:{role}")
    out = []
    cat = snd._catalog()
    for sid, e in cat.items():
        if not (sid.startswith(fam) and len(sid) == len(fam) + 1 and e.get("on_gun")):
            continue
        suf = sid[-1]
        role, group = SLOT_ROLES.get(suf, ("extra", "extra"))
        out.append({"id": sid, "slot": suf, "role": role, "role_words": ROLE_WORDS[role], "group": group,
                    "words": e.get("transcript") or e.get("description") or "", "duration_s": e.get("duration_s"),
                    "uses": used.get(sid, [])})
    out.sort(key=lambda l: (len(l["slot"]), l["slot"]))
    # an override from OUTSIDE the family still has to show up somewhere
    for sid, uses in used.items():
        if not any(l["id"] == sid for l in out):
            e = cat.get(sid) or {}
            out.append({"id": sid, "slot": "", "role": "extra", "role_words": "outside the family", "group": "extra",
                        "words": e.get("transcript") or e.get("description") or "", "duration_s": e.get("duration_s"), "uses": uses})
    return out


def candidates(voice: str | None) -> dict[str, list[str]]:
    """`{role: [ids]}` -- the family's sensible picks for each `$PSET` field and the kill line, default first."""
    fam = family(voice)
    on = snd.on_gun_ids()
    return {role: [fam + s for s in sufs if fam + s in on] for role, sufs in PSET_CANDIDATES.items()}


def play_line_frame(sid: str) -> str:
    """One voice line on the announcer slot -- the same shape the bundle uses for every V-family cue."""
    return f"$PLAY,,4,6,{sid},,,,*"
