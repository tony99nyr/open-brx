"""Assign every on-gun sound a CATEGORY and a plain-English description, from the analysis rows.

Input: `catalog.jsonl` from `soundbank_analyze.py` (descriptors + Whisper transcripts per id) and the
app's `Sounds.json` (which ids the app knows). Output: a derived catalog -- id, family, duration,
category, description, transcript (voices only), on_gun / in_app -- for the server to load and for
game modes to pick from by MEANING rather than by prefix. No audio, no raw Battle Company data.

How the labels are decided (bench 2026-09-03, all 1274 voice transcripts read end to end):

VOICES. Two kinds of family.
  * CHARACTER voices (V0-V9, VC-VP: Fury, Grenadier, Guardian, Heavy, Hive Queen, …, Sentinel,
    Sniper, Soldier, Stalker, Technician, Valkyrie, Viper, Wraith, …) share ONE 22-slot layout,
    read off V0/V3/V8 and confirmed across the rest:
        1 intro/catchphrase · 2 idle loop (~6 s) · 3,4,5 death screams · 6 hurt loop (~6 s) ·
        7 healed line · 8,9,A kill-confirm lines · B defeat/taunt · C-H pain grunts (short) ·
        I boast/kill taunt · J long death (~6 s) · K,L taunts · M character name.
    The slot is authoritative for the role; the transcript is the description. The `$PSET` voice
    tail we ship for Heavy is V33 V3I V3C V3G V3E V37 = death scream, boast, pain, pain, pain,
    healed -- which is what the firmware's deathAlarm/pain/hit slots want.
  * ANNOUNCER / SYSTEM voices (VA, VB, VQ, VR, VS, VT, VX, VZ, V1xx): the words decide. Numbers,
    countdowns, clock, game start/over, lead changes, medals, kill confirms, objective callouts
    (flag / hill / codes / base / bomb / hostage), team callouts, player status (health / armour /
    shield / lives / battery), killstreak callouts (airstrike, UAV, care package, missile, nuke,
    EMP, sentry, chopper, mortar, hijack), weapon and perk names, game-mode names, menu prompts,
    and system/pairing messages.
  Whisper on a pure effect HALLUCINATES ("You", "Thanks for watching") -- so non-V transcripts are
  never used as descriptions, and are kept only as `speech_untrusted` for the record.

EFFECTS (everything else): the David Knox prefix legend gives the family meaning (H hit, U beep,
X explosion, W reload, G/P/R/S/T gunshots, L electrical, J music, K fly-by, …), and the descriptors
say what SHAPE it is (one-shot impact / decaying / sustained loop / rising, duration, tonal vs
noisy, bright vs dull, repeating). Category = family meaning; description = the shape in words.

Usage: python soundbank_classify.py <analysis_dir> <Sounds.json> <out_catalog.json> [--md out.md]
"""
import argparse
import collections
import json
import re

# --- families ----------------------------------------------------------------- #
CHARACTERS = {
    "V0": "Fury", "V1": "Grenadier", "V2": "Guardian", "V3": "Heavy", "V4": "Hive Queen",
    "V5": "Creature", "V6": "Infiltrator", "V7": "Marauder", "V8": "Medic", "V9": "Raider",
    "VC": "Sentinel", "VD": "Sniper (female)", "VE": "Soldier", "VF": "Stalker", "VG": "Technician",
    "VH": "Valkyrie", "VJ": "Viper", "VK": "Wraith", "VL": "Russian (clean)", "VM": "Female (clean)",
    "VN": "Mercenary", "VP": "Male (clean)",
}
SLOT_ROLE = {
    "1": "intro", "2": "idle_loop", "3": "death_scream", "4": "death_scream", "5": "death_scream",
    "6": "hurt_loop", "7": "healed", "8": "kill_confirm", "9": "kill_confirm", "A": "kill_confirm",
    "B": "defeat_taunt", "C": "pain", "D": "pain", "E": "pain", "F": "pain", "G": "pain", "H": "pain",
    "I": "boast", "J": "long_death", "K": "taunt", "L": "taunt", "M": "name",
}
# scout / male-player voices live at the tail of the announcer families with the same slot idea
PLAYER_VOICE_TAILS = {"VA": ("Male player", re.compile(r"^VA[A-R]$")),
                      "VB": ("Scout (female)", re.compile(r"^VB[1-9A-M]$"))}
COMMANDERS = {"VQ": "Nexus commander", "VR": "Vanguard commander", "VS": "Resistance commander"}

FX_FAMILY = {  # David Knox legend, restated
    "A": ("scifi_fx", "sci-fi effect"), "E": ("scifi_fx", "sci-fi effect"), "C": ("scifi_fx", "sci-fi effect"),
    "Y": ("scifi_fx", "odd sci-fi effect"), "B": ("bow", "bow / arrow"), "CC": ("retro_fx", "Contra-style effect"),
    "D": ("mechanical", "cocking / mechanical"), "F": ("fire_fx", "fire / novelty"),
    "G": ("gunshot", "gunshot"), "P": ("gunshot", "gunshot"), "R": ("gunshot", "gunshot"),
    "S": ("gunshot", "gunshot"), "T": ("gunshot", "gunshot"), "Q": ("gunshot_silenced", "silenced shot"),
    "H": ("hit", "hit / impact"), "HM": ("hit", "hit / impact (melee?)"), "J": ("music", "music / sting"),
    "JA": ("music", "music / sting"), "JAA": ("music", "music / sting"), "K": ("flyby", "fly-by / air strike"),
    "L": ("electrical", "electrical"), "M": ("retro_fx", "Mortal-Kombat-style effect"),
    "N": ("misc_fx", "misc effect"), "O": ("ordnance", "big gun / ordnance"), "SH": ("swish", "swipe / swish"),
    "ST": ("rocket", "sci-fi mortar / rocket"), "SW": ("scifi_fx", "Star-Wars-style effect"),
    "TK": ("misc_fx", "misc effect (TK)"), "U": ("ui_beep", "beep / boop"), "W": ("reload", "reload"),
    "X": ("explosion", "grenade / explosion"), "Z": ("splat", "creature splat"),
}

# Roles established outside the transcripts: captures, the shipped tables, the firmware's own use,
# and Tony's ear (2026-09-04 audit). Carried into the catalog as `known_use`.
KNOWN_USES = {
    "VA20": "connection established; CONNECT",
    "N41": "native respawn countdown ping: beeps 3-5 times before a respawn, Halo-style (Tony, by ear 2026-09-04); RESPAWN_PING",
    "NA0": "death loud-beep (community); DEATH_BEEP",
    "H29": "respawn / add-HP cue in the shipped table; ADD_HP",
    "X13": "explosion in the shipped $SIR row for protocol 10 (explosive); BOMB_DETONATED",
    "VA81": "3-2-1 spawn countdown sent by Callsign at game start (capture)",
    "VA8B": "Callsign's low-health alert voice, sent once per life at armour 0 with the pink $HLED blink",
    "VA33": "game over (Callsign end-of-game tail, confirmed by ear)",
    "VA85": "countdown to game over, no music; GAME_OVER_QUIET",
    "VA46": "Life's depleted; LIVES_DEPLETED (not a multi-kill cue)",
    "VSF": "victory sting, winners only (Callsign, confirmed by ear)",
    "VA2": "tear-gas victim voice: coughing then dying (shipped $SIR,11 row; Tony, by ear 2026-09-03)",
    "V3A": "Heavy kill-confirm slot; the per-kill line Callsign sends in the announcer slot",
    "VB17": "lead-change line Callsign sends -- names the RED team; VA6D/VA6E are team-neutral",
    "U16": "tick used for the pre-game runway (provisional)",
    "VA1G": "Body Armor; ADD_ARMOR (VA16 is the Armor Suit menu line)",
    "VA8C": "Shields online; ADD_SHIELD",
    "VB0E": "flag taken; OBJECTIVE_TAKEN",
    "VB0C": "Flag captured; OBJECTIVE_SCORED",
    "VA23": "HEARD 2026-09-10, transcript accurate. Male Control Point set; superseded by VB0N/O/P for hill modes; POINT_CAPTURED",
    "VB0N": "HEARD 2026-09-10. Hill Captured; female objectives announcer with a music bed; preferred hosted KotH set; HILL_CAPTURED",
    "VB0O": "HEARD 2026-09-10. Hill Contested; preferred hosted KotH set; HILL_CONTESTED",
    "VB0P": "HEARD 2026-09-10. Hill Lost; preferred hosted KotH set; HILL_LOST",
    "VB0Q": "HEARD 2026-09-10. Hill Moved; only for a rotating hill mode, not a single-hill mode",
    "VA1I": "Bomb Planted; BOMB_PLANTED",
    "VB0D": "Flag returned; FLAG_RETURNED",
    "VA1H": "Bomb Defused; BOMB_DEFUSED",
    "VA1C": "Black Hawk inbound; EXTRACTION_CALLED",
    "VA1U": "Incoming Chopper; EXTRACTION_OPEN",
    "VA1S": "Enemy chopper detected; EXTRACTION_ALERT",
    "VS7": "Objective Complete (Resistance commander); EXTRACTED",
    "VA8X": "Fail; EXTRACTION_FAILED",
    "VA1Q": "Care Package; LOOT_PICKED",
    "VA3U": "Incoming air raid, find cover; RAID_ENDING",
    "X20": "artillery bombardment (Tony, by ear 2026-09-04); BOMBARDMENT",
    "JAS": "cool extraction / intro-hype music; Open BRX extraction tick (Tony, by ear 2026-09-11)",
    "JAQ": "extraction-style music with ticking in the background; window-open candidate (Tony, by ear 2026-09-11)",
    "U15": "disabled-trigger sound; emptyUnboundButtonSound (Tony, by ear 2026-09-11)",
    "W71": "military gear-adjusting sound; ammoOrGearPickUp (Tony, by ear 2026-09-11)",
    "H43": "sounds like a gun dropped on the ground; rejected critical-hit cue (Tony, by ear 2026-09-11)",
    "X49": "metal hit; Open BRX critical-hit cue (Tony, by ear 2026-09-11)",
    "O06": "rocket launch; Open BRX Energy Launcher fire (Tony, by ear 2026-09-11)",
    "O04": "missile launch; Energy Launcher runner-up (Tony, by ear 2026-09-11)",
    "O01": "blast, not a launch (Tony, by ear 2026-09-11)",
    "O02": "blast, not a launch (Tony, by ear 2026-09-11)",
    "O05": "blast, not a launch (Tony, by ear 2026-09-11)",
    "O03": "rifle shot, not a launcher (Tony, by ear 2026-09-11)",
    "N74": "heartbeat; Open BRX low-health cue (Tony, by ear 2026-09-11)",
    "N75": "second heartbeat take; pool candidate (Tony, by ear 2026-09-11)",
    "N25": "faster heartbeat; tier candidate (Tony, by ear 2026-09-11)",
    "H18": "heartbeat with creepy Halloween texture; infection candidate (Tony, by ear 2026-09-11)",
    "JAW": "neutral game-ending music climax, not a defeat sting (Tony, by ear 2026-09-11)",
    "JAX": "neutral game-ending music climax, not a defeat sting (Tony, by ear 2026-09-11)",
    "P09": "pronounced pistol shot; Deagle candidate (Tony, by ear 2026-09-11)",
    "P16": "pistol shot; Open BRX Glock fire (Tony, by ear 2026-09-11)",
    "Q04": "silenced pistol shot; Open BRX USP-S fire (Tony, by ear 2026-09-11)",
    "X14": "heavy rifle shot; Open BRX Deagle fire (Tony, by ear 2026-09-11)",
    "D08": "first sound in the working D08-D07-D06 reload chain (Tony, by ear 2026-09-11)",
    "D07": "second sound in the working D08-D07-D06 reload chain (Tony, by ear 2026-09-11)",
    "D06": "third sound in the working D08-D07-D06 reload chain (Tony, by ear 2026-09-11)",
    "D11": "overheat / vent sound; chosen for Open BRX Energy Rifle (Tony, by ear 2026-09-17)",
    "D122": "reload-like sound; captured Energy Rifle overheat slot but rejected by ear (Tony, 2026-09-17)",
    "C19": "Charge Rifle early-release sound, not an overheat sound (Tony, by ear 2026-09-17)",
    "A34": "smooth shield-recharge rise; play twice during refill (Tony, by ear 2026-09-17)",
    "VA6Y": "Shields Online; shield-recharge completion (Tony, by ear 2026-09-17)",
    "VX73": "reload nag (Tony, by ear 2026-09-18)",
    "N101": "shield-depleted cue (Tony, by ear 2026-09-18)",
    "N102": "shield-recharge-start cue (Tony, by ear 2026-09-18)",
    "U100": "HEARD 2026-09-10. Clock-like single tick at a 1 s cadence; shield-loop trial after extraction moved to JAS",
    "U104": "HEARD 2026-09-10. Tick, viable but less clock-like than U100",
    "V8Q": "HEARD 2026-09-10. Says Kill Confirmed, not Hill Confirmed; corrected out of the hill category",
    "VA21": "HEARD 2026-09-10, transcript accurate. Male Control Point set",
    "VA22": "HEARD 2026-09-10, transcript accurate. Male Control Point set",
    "VA93": "HEARD 2026-09-10, transcript accurate. Usable as a KotH mode intro",
    "VA7E": "Double Kill; Open BRX multi-kill 2 medal line (Tony, by ear 2026-09-24)",
    "VA7Q": "Triple Kill; Open BRX multi-kill 3 medal line (Tony, by ear 2026-09-24)",
    "VA7M": "Killtacular; Open BRX multi-kill 4 (preferred over V124) medal line (Tony, by ear 2026-09-24)",
    "VA7O": "Killtrocity; Open BRX multi-kill 5 medal line (Tony, by ear 2026-09-24)",
    "VA7J": "Killamanjaro; Open BRX multi-kill 6 medal line (Tony, by ear 2026-09-24)",
    "VA7N": "Killtastrophe; Open BRX multi-kill 7 medal line (Tony, by ear 2026-09-24)",
    "VA7L": "Killionaire; Open BRX multi-kill 8 and beyond medal line (Tony, by ear 2026-09-24)",
    "VA7K": "Killing Spree; Open BRX killing spree, 5 without dying medal line (Tony, by ear 2026-09-24)",
}

# These meanings came from a person listening at the bench, rather than only a capture, field table
# or machine transcript. Keep the confidence separate so the public page can mark the distinction.
VERIFIED_BY_EAR = {
    "VA33", "VSF", "VA2", "VA1G", "VA8C", "VB0N", "VB0O", "VB0P", "VS7", "X20",
    "JAS", "JAQ", "U15", "W71", "H43", "X49", "O06", "O04", "O01", "O02", "O05", "O03",
    "N74", "N75", "N25", "H18", "JAW", "JAX", "P09", "P16", "Q04", "X14", "D08", "D07",
    "D06", "D11", "D122", "C19", "A34", "VA6Y", "VX73", "N101", "N102", "U100", "U104",
    "V8Q", "V116", "VA21", "VA22", "VA23", "VA93", "VB0Q",
    "VA7E", "VA7Q", "VA7M", "VA7O", "VA7J", "VA7N", "VA7L", "VA7K",
}

# A row can be reviewed without its machine transcript being checked (VA2 was identified as a gas-
# death cough, but nobody endorsed Whisper's gibberish syllables). Keep transcript confidence apart.
TRANSCRIPT_VERIFIED_BY_EAR = {
    "V8Q", "V116", "VA21", "VA22", "VA23", "VA33", "VA93", "VA1G", "VA6Y", "VA8C",
    "VB0N", "VB0O", "VB0P", "VB0Q", "VS7", "VSF", "VX73",
    "VA7E", "VA7Q", "VA7M", "VA7O", "VA7J", "VA7N", "VA7L", "VA7K",
}

# --------------------------------------------------------------------------- #
# BY-EAR CORRECTIONS: where the Whisper transcript is WRONG.                   #
#                                                                             #
# These live here, in the generator, and NOT as a hand-edit to the generated   #
# JSON -- that would be silently reverted the next time anyone re-runs this    #
# script, which is exactly how a fixed bug comes back.                        #
#                                                                             #
# A wrong transcript is not cosmetic. `V8Q` was catalogued "Hill Confirmed",   #
# says "KILL Confirmed", and was filed under voice:objective_hill -- so a hill #
# mode picking callouts BY CATEGORY would have shipped a kill-feed line as a   #
# hill announcement. One letter, and the classifier propagated it into the     #
# category. Heard 2026-09-10, bench rung S.                                    #
# --------------------------------------------------------------------------- #
BY_EAR_CORRECTIONS = {
    # id: (heard transcript, corrected category)
    "V8Q": ("Kill Confirmed", "voice:kill_confirm"),
    "V116": ("gained the lead", "voice:line"),
    # Halo 3's multi-kill ladder, heard by Tony at volume 69 on 2026-09-24 (Whisper had "Kill them in Juro!",
    # "Killian Air", "GO TACULAR!", "Joltastrophe", "CULTURUSITY" and filed three under the wrong category)
    "VA7E": ("Double Kill", "voice:medal"),
    "VA7Q": ("Triple Kill", "voice:medal"),
    "VA7M": ("Killtacular", "voice:medal"),
    "VA7O": ("Killtrocity", "voice:medal"),
    "VA7J": ("Killamanjaro", "voice:medal"),
    "VA7N": ("Killtastrophe", "voice:medal"),
    "VA7L": ("Killionaire", "voice:medal"),
    "VA7K": ("Killing Spree", "voice:medal"),
}


def app_durations(data: dict) -> dict[str, float]:
    """Read either raw Sounds.json or the repo's restated derivative.

    The latter may be the 2,634-row union catalog, so only rows explicitly in the app belong here.
    `sound_ids.json` predates `in_app`; all of its rows are app rows by definition.
    """
    if "SoundsLengthMap" in data:
        return {k.upper(): v for k, v in data["SoundsLengthMap"].items()}
    return {r["id"].upper(): r["duration_s"] for r in data["sounds"] if r.get("in_app", True)}

# --- announcer intents, first match wins ----------------------------------------- #
INTENTS = [
    ("countdown",       r"^(three,? two,? one\.?|10,? 9|ten,? nine)"),
    ("status_health",   r"\b(lives? remaining|life'?s? depleted|health)\b"),
    ("clock",           r"\b(seconds?|minutes?|remain(ing)?|overtime|sudden death|game time)\b"),
    ("medal",           r"\b(double kill|triple kill|killing spree|first blood|flawless|fatality|tacular|multi.?kill|kill(ing)? ?streak|killstrike|lucky shot|headshot|bullseye)\b"),
    ("game_over",       r"\b(game over|victory|defeat|wins\b|the end|mission complete|we failed|objective complete)"),
    ("lead",            r"\b(takes? the lead|lost the lead|closing in on victory|one player remaining|scored)\b"),
    ("kill_confirm",    r"^(kill\.?!?|kill confirmed|target down|tango down|tangle down|terminated|all clear|that'?s a kill|eradicat|destroyed|sterilized|sanitized|toasted|coasted|target lost|the target is lost|lost visual)"),
    ("status_health",   r"\b(health|life'?s? depleted|lives? remaining|lives|second life|shared lives)\b"),
    ("status_armor",    r"\barmou?r(ed)? (depleted|critical|low)\b"),
    ("status_shield",   r"\bshields? (depleted|online|engaged|equipped|pulse)\b|^shield$"),
    ("status_battery",  r"\bbattery\b"),
    ("objective_flag",  r"\bflag\b|\bflight\b|carrier"),
    ("objective_hill",  r"\bhill\b"),
    ("objective_codes", r"\bcodes?\b"),
    ("objective_other", r"\b(base|fortress|control point|bomb|hostage|checkpoint|vip|captured|contested|infected|infection|survivor|swarm|hive|storm)\b"),
    ("team",            r"\b(alpha|bravo|charlie|delta|echo|foxtrot|blue|red|green|yellow|purple|pink|cyan|s[ck]i[eo]n) team\b|\bteam\b"),
    ("killstreak",      r"\b(air ?raid|airstrike|uav|uab|care package|share package|weapons? box|chopper|black ?hawk|missile|mortar|nuke|nuclear|emp|sentry|century|hijack|system hack|self.destruct|hellstorm|ordinance|ordnance|proximity|blockade|phoenix|deployment|swarm|many rockets|strike)\b"),
    ("system",          r"\b(connect\w*|disconnect\w*|pair\w*|update\w*|device|bootloader|test(ing)? mode|debug|demo mode|volume|loading|scanning|searching|calibration|admin|version|error|pass|fail|game found|game host|game joined|initiating|hud|phone|headset|battle company systems|stress test|field id|browse|gesture|sensors? offline|weapon ready for duty|systems? online|primary|secondary)\b"),
    ("menu",            r"\b(select|choose|mode|friendly fire|respawn|indoor|outdoor|region|unlimited|random|on|off|low|medium|short|long|lethal|tactical|human|kids|rank|upgrade|specialists|offense|defense|support|tank|assault|recovery|finesse|speed|stealth|toughness|thick skin|damage|focus|awareness|accuracy|quick hands|fast track|scavenger|dead eye|second life|body armor|armor suit|flak jacket|first aid|medkit|healing kit|ammo pouch|double mags|extended mags|long barrel|laser sight|silencer|suppressor|water cooling|double trigger|select fire|swap lift|hold trigger|hold reload|reload|weapon swap|read generation|tracker|frost|poison|sticky|grenade|stimpak|medigel|lifesteal|rally|shield|regen|melee|grip|dual|target mode|storm|ticket|checkpoint|deaths|kills|no\.?)\b"),
    ("weapon_name",     r"\b(rifle|shotgun|pistol|smg|submachine|sniper|launcher|cannon|glock|m4|mg7|mgr|9mm|desert eagle|tac 87|tar 33|sr 100|gatling|guttling|machine gun|blaster|laser|flamethrower|taser|crossbow|bow staff|baton|axe|knife|saber|sword|claymore|trip mine|frag|flashbang|concussion|cluster|pepper spray|slug|hollow point|hallow point|fmj|explosive rounds|armor piercing|bfg)\b"),
    ("game_mode",       r"\b(deathmatch|free for all|king of the hill|capture the flag|domination|slayer|supremacy|survival|battle royale|gun game|generals|commanders|siege|last stand|infection|ticket mode|borderlands|battle (lines|strike|watch|world|360|reality)|raw game|target mode|night mode)\b"),
    ("greeting",        r"\b(welcome|hello|hi\b|let the battle begin|get ready|go, go, go|battle begins|join)"),
    ("number",          r"^\W*(\d+|one|two|too|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|well)\W*$"),
]
GRUNT = re.compile(r"^[\W]*([aeiouhmrgwyn'!\-\.\s]{1,60})$", re.I)   # AHHH / UGH / MMM / Oh / Ha!


def shape_words(r: dict) -> str:
    if r.get("empty"):
        return "silent / near-empty"
    parts = []
    env = r.get("envelope", "")
    parts.append({"impact": "one-shot impact", "decaying": "one-shot, decaying tail",
                  "sustained": "sustained / loop-like", "rising": "rising / charge-up",
                  "varying": "varying", "tiny": "very short"}.get(env, env))
    d = r.get("duration_s", 0)
    parts.append(f"{d:.1f} s")
    fl = r.get("flatness", 0)
    parts.append("noisy" if fl > 0.25 else ("tonal" if fl < 0.06 else "mixed"))
    c = r.get("centroid_hz", 0)
    parts.append("bright" if c > 3000 else ("dull/low" if c < 1200 else "mid"))
    if (r.get("onset_rate_hz") or 0) >= 4 and d >= 0.8:
        parts.append("repeating / rattling")
    if r.get("pitch_hz") and fl < 0.06 and (r.get("pitch_stability") or 1) < 0.05:
        parts.append(f"steady pitch ~{r['pitch_hz']} Hz")
    if r.get("centroid_trend") == "up":
        parts.append("rising pitch/brightness")
    elif r.get("centroid_trend") == "down":
        parts.append("falling pitch/brightness")
    return ", ".join(parts)


def classify_voice(r: dict) -> tuple[str, str, str]:
    """-> (category, speaker, description)"""
    sid = r["id"]
    text = (r.get("speech") or {}).get("text", "").strip()
    fam2 = sid[:2]
    # character voices: V<d><slot> and V<L><slot>, plus the player-voice tails of VA / VB
    m = re.fullmatch(r"(V[0-9A-Z])([1-9A-Z])", sid)      # slots past M are extra lines (Medic has 34)
    speaker = None
    if m and m.group(1) in CHARACTERS:
        speaker, slot = CHARACTERS[m.group(1)], m.group(2)
    else:
        for fam, (name, rx) in PLAYER_VOICE_TAILS.items():
            if rx.match(sid):
                speaker, slot = name, sid[-1]
    if speaker:
        role = SLOT_ROLE.get(slot)
        if role is None:                                    # an extra slot: let the words decide
            low = text.lower()
            role = next((cat for cat, rx in INTENTS if re.search(rx, low)), "line") if text else "line"
        # V4R..V4W are Infection announcer lines living in the Hive Queen block; V1xx are callouts
        if role in ("death_scream", "pain", "long_death", "idle_loop", "hurt_loop") and text and \
                not GRUNT.match(text) and len(text.split()) >= 3:
            role = "line"                          # words where a grunt was expected: trust the words
        return f"voice:{role}", speaker, text or f"({role.replace('_', ' ')}, no words)"
    # commanders
    if fam2 in COMMANDERS:
        speaker = COMMANDERS[fam2]
    elif sid.startswith("VZ"):
        speaker = "Announcer (upgrades)"
    elif sid.startswith("VX"):
        speaker = "Announcer (numbers / menu)"
    elif sid.startswith("VT"):
        speaker = "Announcer (lives)"
    elif sid.startswith("VB"):
        speaker = "Announcer (female, objectives)"
    elif sid.startswith("VA"):
        speaker = "Announcer (male)"
    elif re.fullmatch(r"V1\d\d", sid):
        speaker = "Announcer (game callouts)"
    else:
        speaker = "Voice"
    if not text:
        return "voice:unknown", speaker, "(no words recognised)"
    low = text.lower()
    if GRUNT.match(text) and len(text) < 40:
        return "voice:grunt", speaker, text
    for cat, rx in INTENTS:
        if re.search(rx, low):
            return f"voice:{cat}", speaker, text
    return "voice:line", speaker, text


def classify_fx(r: dict) -> tuple[str, str]:
    fam = r["family"]
    cat, meaning = FX_FAMILY.get(fam, ("fx", f"effect ({fam} family)"))
    return f"fx:{cat}", f"{meaning}; {shape_words(r)}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("analysis_dir")
    ap.add_argument("sounds_json")
    ap.add_argument("out_json")
    ap.add_argument("--md")
    ap.add_argument("--audit", help="sound-audit.jsonl from `brx_mcp sounds ... --audit` (by-ear verdicts)")
    a = ap.parse_args()
    audit = {}
    if a.audit:
        import os
        if os.path.exists(a.audit):
            for ln in open(a.audit):
                try:
                    v = json.loads(ln)
                    audit[v["id"]] = v          # last verdict wins
                except Exception:
                    pass

    rows = [json.loads(l) for l in open(f"{a.analysis_dir}/catalog.jsonl")]
    app_data = json.load(open(a.sounds_json))
    # The repo's restated derivative is enough to regenerate the catalog without retaining the raw
    # APK asset. `app_durations` also accepts Sounds.json when that private input is available.
    app = app_durations(app_data)
    out = []
    for r in sorted(rows, key=lambda r: r["id"]):
        entry = {"id": r["id"], "family": r["family"], "duration_s": r.get("duration_s"),
                 "on_gun": True, "in_app": r["id"] in app}
        if r["family"].startswith("V"):
            cat, speaker, desc = classify_voice(r)
            entry.update(kind="voice", category=cat, speaker=speaker, description=desc,
                         transcript=(r.get("speech") or {}).get("text", ""))
        else:
            cat, desc = classify_fx(r)
            entry.update(kind="fx", category=cat, description=desc)
            t = (r.get("speech") or {}).get("text", "")
            if t:
                entry["speech_untrusted"] = t
        entry["shape"] = {k: r.get(k) for k in ("envelope", "flatness", "centroid_hz", "onset_rate_hz", "pitch_hz", "rms_db", "attack_s")}
        if r["id"] in BY_EAR_CORRECTIONS:
            heard, cat = BY_EAR_CORRECTIONS[r["id"]]
            entry["heard"] = heard
            entry["description"] = heard
            entry["transcript"] = heard
            entry["category"] = cat
            entry["verified_by_ear"] = True
            entry["speech_untrusted"] = f"Whisper heard: {(r.get('speech') or {}).get('text', '')}"
        if r["id"] in KNOWN_USES:
            entry["known_use"] = KNOWN_USES[r["id"]]
        if r["id"] in VERIFIED_BY_EAR:
            entry["verified_by_ear"] = True
        if r["id"] in TRANSCRIPT_VERIFIED_BY_EAR:
            entry["transcript_verified_by_ear"] = True
        v = audit.get(r["id"])
        if v:
            entry["verified_by_ear"] = True
            if v.get("heard"):
                # a note on a RIGHT label is context (what the sound is for / evokes); on a WRONG
                # label it is what was actually heard, and it overrides the description
                if v.get("ok"):
                    entry["context"] = v["heard"]
                else:
                    entry["heard"] = v["heard"]
                    entry["description"] = f"{v['heard']} (by ear; auto-label was: {entry['description']})"
        out.append(entry)
    seen = {e["id"] for e in out}
    for k in sorted(app):
        if k not in seen:
            out.append({"id": k, "family": re.match(r"[A-Z_]+", k).group(0), "duration_s": round(app[k], 3),
                        "on_gun": False, "in_app": True, "kind": "missing", "category": "missing:not_on_gun",
                        "description": "listed by the app, NOT present on the gun -- plays the fallback"})
    json.dump({"generated": "2026-09-03", "source": "on-gun AUDIO folder, gun firmware v4.32; analysis by mcp/tools/soundbank_analyze.py",
               "count_on_gun": len(seen), "count_app_only": len(out) - len(seen), "sounds": out},
              open(a.out_json, "w"), indent=1)
    cats = collections.Counter(e["category"] for e in out)
    print(f"{len(out)} entries -> {a.out_json}")
    for c, n in sorted(cats.items(), key=lambda kv: -kv[1]):
        print(f"  {n:5d} {c}")

    if a.md:
        write_md(out, a.md)


def community_suffix(e: dict) -> str:
    """Inline community-label note for a table row, or '' if the id has none. NEW_LABEL is marked
    prominently (our own description is only a machine guess there); DIFFERS shows both readings."""
    label = e.get("community_label")
    if not label:
        return " (community: reported NOISE since v4.30)" if e.get("community_flag_noise") else ""
    status = e.get("community_status")
    if status == "new_label":
        return f" · community label (NEW, unconfirmed): {label}"
    if status == "differs":
        return f" · community label (differs, unconfirmed): {label}"
    return f" · community label (agrees, unconfirmed): {label}"


def write_md(out, path, community_not_on_gun_count=None):
    voices = [e for e in out if e["kind"] == "voice"]
    fx = [e for e in out if e["kind"] == "fx"]
    L = []
    L.append("# BRX sound catalog (derived)\n")
    L.append("Every sound on a v4.32 tagger, read off the gun's own `AUDIO` folder on 2026-09-03 and analysed "
             "with `mcp/tools/soundbank_analyze.py` (transcripts by Whisper, shapes by librosa), then labelled by "
             "`soundbank_classify.py`. **Restated, derived data only: no audio and no Battle Company files live "
             "in this repo.** Machine-readable copy: `mcp/brx_mcp/data/sound_catalog.json`.\n")
    L.append(f"- **{len(out)} ids**: {sum(1 for e in out if e['on_gun'])} on the gun, "
             f"{sum(1 for e in out if not e['on_gun'])} listed by the app but NOT on the gun (they play the fallback), "
             f"{sum(1 for e in out if e['on_gun'] and not e['in_app'])} on the gun but unknown to the app.")
    L.append("- Format on the gun: headerless raw PCM, signed 16-bit little-endian, mono, 44 100 Hz, one `<ID>.LTP` per id.")
    L.append("- Transcripts are Whisper's; a word-level slip is possible on a single line (e.g. \"Flight captured\" for "
             "\"Flag captured\"). Where a family repeats a line three times (kill confirms), the majority reading is right.")
    n_new = sum(1 for e in out if e.get("community_status") == "new_label")
    n_differs = sum(1 for e in out if e.get("community_status") == "differs")
    n_agrees = sum(1 for e in out if e.get("community_status") == "agrees")
    n_noise = sum(1 for e in out if e.get("community_flag_noise"))
    if n_new or n_differs or n_agrees or n_noise:
        not_on_gun = f", {community_not_on_gun_count} sheet ids not on our gun" if community_not_on_gun_count else ""
        L.append(f"- **Community labels** (credit LaserTagMods' community-run BRX Audio sheet, shared by Jay): "
                 f"{n_new} new, {n_agrees} agree with ours, {n_differs} differ, {n_noise} flagged NOISE since "
                 f"firmware v4.30{not_on_gun}. Unconfirmed by us; see [Community labels](#community-labels) below.\n")
    else:
        L.append("")
    L.append("## Character voices — one 22-slot layout, every character\n")
    L.append("| slot | role | example (Heavy) |\n|---|---|---|")
    ex = {e["id"][-1]: e for e in voices if e["id"].startswith("V3") and len(e["id"]) == 3}
    for s, role in SLOT_ROLE.items():
        e = ex.get(s)
        L.append(f"| {s} | {role.replace('_', ' ')} | {('V3' + s) if e else ''} {e['transcript'] if e else ''} |")
    L.append("\nThe `$PSET` voice tail is six of these slots (death scream · boast · pain ×3 · healed for Heavy: "
             "V33 V3I V3C V3G V3E V37). Swap the character prefix to change the voice.\n")
    by_speaker = collections.defaultdict(list)
    for e in voices:
        by_speaker[e["speaker"]].append(e)
    for spk in sorted(by_speaker):
        es = by_speaker[spk]
        L.append(f"\n### {spk} ({len(es)})\n")
        L.append("| id | s | category | words |\n|---|---|---|---|")
        for e in sorted(es, key=lambda e: e["id"]):
            words = (e["transcript"] or "").replace("|", "/")
            if len(words) > 70:
                words = words[:67] + "..."
            words += community_suffix(e)
            L.append(f"| {e['id']} | {e['duration_s']:.1f} | {e['category'][6:]} | {words} |")
    L.append("\n## Effects — by family\n")
    L.append("Shape words come from the descriptors: impact (hits hard, dies fast) · decaying · sustained (loop-like) · "
             "rising (charge-up); tonal / mixed / noisy; bright / mid / dull.\n")
    by_fam = collections.defaultdict(list)
    for e in fx:
        by_fam[e["family"]].append(e)
    for fam in sorted(by_fam, key=lambda f: -len(by_fam[f])):
        es = sorted(by_fam[fam], key=lambda e: e["id"])
        cat, meaning = FX_FAMILY.get(fam, ("fx", f"{fam} family"))
        L.append(f"\n### {fam} — {meaning} ({len(es)})\n")
        L.append("| id | s | shape |\n|---|---|---|")
        for e in es:
            shape = e["description"].split("; ", 1)[-1] + community_suffix(e)
            L.append(f"| {e['id']} | {e['duration_s']:.1f} | {shape} |")
    L.append("\n## App-listed ids that are NOT on the gun\n")
    L.append(", ".join(e["id"] for e in out if not e["on_gun"]))
    open(path, "w").write("\n".join(L) + "\n")
    print(f"markdown -> {path}")


if __name__ == "__main__":
    main()
