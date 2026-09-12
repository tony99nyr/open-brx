"""The diagnostic-game test catalog — every BRX capability, as declarative cases.

Grouped by category. Each case declares what it needs (`requires`), what it sends,
and how it's verified (auto predicate, or a human prompt/question). BLE cases run
today; IR cases carry Capability.IR and SKIP. The bridge itself exists
(`brx_mcp/irbridge.py`, `hardware/esp32-ir-bridge/`) — the `ir.*` cases just carry no
send/verify yet, so wiring them to `IRBridge` is what un-skips them.

Frame constants are IMPORTED from `gameconfig` so the diag game arms a gun exactly the way a
real game does. They used to be copied here "kept in sync" by hand, and had drifted.
"""

from __future__ import annotations

from ..gameconfig import _BMAP, _SIR_TABLE
from .model import (
    Capability as Cap,
    DiagCase,
    saw_pong,
    saw_command,
    hp_dropped,
    ammo_decremented,
    grenade_beacon,
)

# --- shared frame blocks (imported from gameconfig, never copied) ----------- #
VOL = "$VOL,75,0,*"
CONFIG = (
    "$CLEAR,*", "$START,*", "$GSET,1,0,1,0,1,0,50,1,*",
    "$PSET,0,0,45,70,70,50,,H44,JAD,V33,V3I,V3C,V3G,V3E,V37,H06,H55,H13,H21,H02,U15,W71,A10,*",
    "$WEAP,0,,100,0,3,9,0,,,,,,,,75,850,36,216,1700,0,9,100,100,275,0,,,R18,,,,D04,D03,D02,D18,,,,,36,108,75,*",
    # IMPORTED, never copied. These used to be inline and had drifted to FIVE of the ten $SIR rows
    # (no rocket, no rail gun, no melee), which means a diag gun silently ignored that IR while
    # reporting alive and healthy -- F11, in the one tool whose job is to answer "can this gun be
    # hit?". Pinned by tests/test_diag_config_parity.py.
    *_SIR_TABLE,
    *_BMAP,
)
SPAWN = ("$SPAWN,,*", "$AMMO,0,36,108,1,*", "$BMAP,0,0,,,,,*")
# (There was an `END = ("$STOP,*", "$CLEAR,*")` here. It was never referenced by anything, and a
# dead constant shaped like a correct teardown is a trap: the next person wires it up and ships the
# F11 fault. The real teardown lives in `runner.py` and restores the $SIR table. Deleted 2026-09-07.)


CATALOG: list[DiagCase] = [
    # --- connectivity ------------------------------------------------------- #
    DiagCase(
        id="conn.ping", name="Ping / Pong", category="connectivity",
        requires=(Cap.BLE,), frames=("$PING,*",), verify=saw_pong(),
        proves="the BLE link + command path is alive",
    ),
    DiagCase(
        id="conn.version", name="Firmware version", category="connectivity",
        requires=(Cap.BLE,), frames=("$VERSION,*",), verify=saw_command("VERSION"),
        proves="the tagger reports its firmware over BLE",
    ),
    DiagCase(
        id="conn.battery", name="Battery telemetry", category="connectivity",
        requires=(Cap.BLE,), frames=(), window_ms=1500, verify=saw_command("VOLTS"),
        proves="$VOLTS telemetry streams (battery health)",
    ),

    # --- config + go-live --------------------------------------------------- #
    DiagCase(
        id="cfg.accept", name="Config accepted (LCD echo)", category="config",
        requires=(Cap.BLE,), setup=(VOL,), frames=CONFIG, window_ms=1200,
        verify=saw_command("ALCD"),
        proves="weapon/config lands — the gun echoes $ALCD/$LCD",
    ),
    DiagCase(
        id="cfg.spawn", name="Spawn → live (LCD health)", category="config",
        requires=(Cap.BLE,), frames=SPAWN, window_ms=1200,
        verify=saw_command("LCD"),
        proves="$SPAWN takes the gun live; $LCD shows spawn health",
    ),

    # --- buttons / trigger (human + auto) ----------------------------------- #
    DiagCase(
        id="btn.trigger", name="Trigger fires (mag decrements)", category="buttons",
        requires=(Cap.BLE, Cap.HUMAN),
        prompt_before="Pull the TRIGGER a few times now.",
        window_ms=4000, verify=ammo_decremented(),
        proves="the gun is live and firing IR (ammo counts down in $ALCD)",
    ),
    DiagCase(
        id="btn.events", name="Button events stream", category="buttons",
        requires=(Cap.BLE, Cap.HUMAN),
        prompt_before="Press SELECT / RELOAD / the D-pad a few times.",
        window_ms=4000, verify=saw_command("BUT"),
        proves="button presses surface as $BUT events",
    ),

    # --- audio (human) ------------------------------------------------------ #
    DiagCase(
        id="audio.play", name="Play a sound by id", category="audio",
        requires=(Cap.BLE, Cap.HUMAN), frames=("$PLAY,VA20,4,6,,,,,*",),
        window_ms=1500, ask_after="Did you HEAR a voice/sound play?",
        proves="arbitrary $PLAY sound ids are audible (audio path works)",
    ),
    DiagCase(
        id="audio.volume", name="Volume is audible at 75", category="audio",
        requires=(Cap.BLE, Cap.HUMAN),
        setup=("$VOL,75,0,*",), frames=("$PLAY,VA81,4,6,,,,,*",),
        window_ms=1500, ask_after="Was it clearly audible (not too quiet)?",
        proves="the play/game volume (~75) is loud enough",
    ),

    # --- LEDs / teams (human) ----------------------------------------------- #
    DiagCase(
        id="led.team_blue", name="Team 1 → BLUE LEDs", category="leds",
        requires=(Cap.BLE, Cap.HUMAN), frames=("$TID,1,*",),
        window_ms=800, ask_after="Are the gun/headset LEDs BLUE?",
        proves="$TID,1 sets the blue team colour",
    ),
    DiagCase(
        id="led.team_yellow", name="Team 2 → YELLOW LEDs", category="leds",
        requires=(Cap.BLE, Cap.HUMAN), frames=("$TID,2,*",),
        window_ms=800, ask_after="Are the LEDs now YELLOW?",
        proves="$TID,2 sets the yellow team colour (team=LED mapping)",
    ),

    # --- health writes (auto, needs a 2nd gun for damage) ------------------- #
    DiagCase(
        id="health.damage", name="Take damage from a 2nd gun", category="health",
        requires=(Cap.BLE, Cap.TWO_GUNS, Cap.HUMAN),
        prompt_before="Shoot THIS gun's headset with the OTHER (enemy-team) gun a few times.",
        window_ms=8000, verify=hp_dropped(),
        proves="incoming IR registers as $HIR + $HP damage (armor absorbs first)",
    ),
    DiagCase(
        id="health.heal", name="$LIFE heals (armor climbs)", category="health",
        requires=(Cap.BLE, Cap.TWO_GUNS, Cap.HUMAN),
        setup=("$LIFE,0,40,0,*",),
        prompt_before="Now shoot this gun ONCE more so it reports its (healed) armor.",
        window_ms=6000, verify=saw_command("HP"),
        proves="$LIFE grant takes effect (additive, clamped) — read on next hit",
    ),

    # --- hits / attribution (2 guns) ---------------------------------------- #
    DiagCase(
        id="hit.attribution", name="Hit reports shooter team", category="hits",
        requires=(Cap.BLE, Cap.TWO_GUNS, Cap.HUMAN),
        prompt_before="Shoot this gun once with the enemy gun.",
        window_ms=6000, verify=saw_command("HIR"),
        proves="$HIR carries the shooter's team id (token 4)",
    ),

    # --- grenade (needs a grenade nearby, beacon over BLE) ------------------ #
    DiagCase(
        id="gren.beacon", name="Grenade beacon over BLE", category="grenade",
        requires=(Cap.BLE, Cap.HUMAN),
        prompt_before="Set a grenade to HILL or RESPAWN and aim its emitter at this headset.",
        window_ms=8000, verify=grenade_beacon(),
        proves="Hill/Respawn grenade IR surfaces as $HIR token2=15 (relay-readable)",
    ),

    # --- IR bridge (ESP32) — the hardware EXISTS (irbridge.py); these three     #
    #     cases are unwired (no send/verify) and skip until routed through it.  #
    DiagCase(
        id="ir.capture", name="Capture a BRX IR frame (ESP32)", category="ir",
        requires=(Cap.IR,), proves="ESP32 decodes the 25-bit IR frame from a gun shot (B13)",
    ),
    DiagCase(
        id="ir.emit", name="Emit IR → gun reacts (ESP32)", category="ir",
        requires=(Cap.IR,), proves="ESP32-emitted IR triggers a $HIR on a stock gun",
    ),
    DiagCase(
        id="ir.sir_sweep", name="$SIR function/sound sweep (ESP32)", category="ir",
        requires=(Cap.IR,), proves="catalog every IR type → effect + sound",
    ),
]


def cases_for(available: set[Capability]) -> list[DiagCase]:
    """All cases (in catalog order); a case whose requirements aren't all in
    `available` will SKIP at run time. Returned whole so the scorecard shows skips."""
    return list(CATALOG)
