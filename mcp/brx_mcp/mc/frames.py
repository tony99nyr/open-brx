"""Reading BACK the handful of tagger frames MC needs to check a gun against its own push.

Pure, stdlib-only, no package dependencies -- `state.py`, `fakes.py` and `mock_node.py` all import
it, and `mock_node` must stay runnable on its own.

Everything here is a READER. `compile.py` owns emitting frames; this module owns the one direction
that used to be done nowhere: taking a head MC actually sent, or an echo a gun actually answered,
and turning it back into the two or three numbers a comparison needs.

⚠ Every function returns `None` rather than a guess when the frame is not the shape it expects. A
caller must treat `None` as NO EVIDENCE and say nothing -- never as a mismatch. A red on every row
of a field running an older app would be worse than the silence these checks replace.

Frame shapes (protocol/brx-protocol.md, docs/manual/dev.md):
  `$PSET,<playerId>,0,<hp>,<armor>,<shield>,…`            -- the pool the head arms
  `$WEAP,<slot>,…` 44 fields, t16 = maxClip, t17 = ammoReserv, t40 = ammoReserv // 2, the value the
    gun's own `$ALCD` echoes back (`compile.WeaponCatalog._T`, F207)
  `$ALCD,<mag>,<accuracy>,<slot>,<reserve>,<heat>,*`      -- the gun's ammo/weapon stream
"""
from __future__ import annotations

# Index into the comma-split frame. `$WEAP` token N lives at index N + 1 (index 1 is the slot),
# which is the same arithmetic `compile.WeaponCatalog.resolve()` writes with (`p[T[key] + 1]`).
_WEAP_MAG = 17            # t16 maxClip -- what `$ALCD` reports as the magazine at spawn
_WEAP_RESERVE = 18        # t17 ammoReserv -- the CONFIGURED reserve, not what the gun echoes back
# F207: the gun's own `$ALCD` reserve field mirrors t40, not t17. `compile.py` keeps the invariant
# `tok17 == 2 * tok40` on every captured head (sniper+extended_mags 8/48 echoes 8,..,24; amr 14/56
# echoes 14,..,28; burst_rifle 36/216 echoes 36,..,108), so t40 is what a comparison against the
# gun's echo must use. Fall back to `t17 // 2` only when t40 is missing (a shorter, older frame).
_WEAP_RESERVE_ECHO = 41   # t40
# The split length of a `$WEAP` frame `compile.py` WRITES: `$WEAP` + slot + t0..t41 + `*`. A frame
# captured off a gun runs a token or two longer (protocol §6 §"$WEAP" shows 45+ on several rows), so
# this is a FLOOR and is only ever asked with `>=`: anything shorter than the compiler's own output
# cannot be carrying t16/t17 and is a template/stub, not evidence.
_WEAP_FIELDS = 44

_PSET_HP = 3
_PSET_ARMOR = 4
_PSET_SHIELD = 5

_ALCD_MAG = 1
_ALCD_SLOT = 3
_ALCD_RESERVE = 4


def _int(parts: list[str], i: int) -> int | None:
    """`parts[i]` as a non-negative int, or None. Empty tokens are ordinary in these frames."""
    if i >= len(parts):
        return None
    tok = parts[i].strip()
    if not tok or not tok.isdigit():      # `isdigit` also rejects the sign: no pool or count is negative
        return None
    return int(tok)


def _find(head: list[str] | None, prefix: str) -> list[str] | None:
    for f in head or []:
        if isinstance(f, str) and f.startswith(prefix):
            return f.split(",")
    return None


def head_spawn_ammo(head: list[str] | None) -> tuple[int, int] | None:
    """(mag, reserve) the PRIMARY slot's `$ALCD` echo is expected to carry, or None.

    `reserve` is t40 (the field the gun's own echo mirrors), not t17 (the configured reserve
    `compile.py` writes for the HUD) -- see F207. Falls back to `t17 // 2` when t40 is missing.

    None for a stub frame (`FakeCompiler` emits `$WEAP,0,<assault_rifle>,*`, which carries no
    numbers at all) -- the caller then has nothing to compare and must say nothing.
    """
    p = _find(head, "$WEAP,0,")
    if p is None or len(p) < _WEAP_FIELDS:
        return None
    mag = _int(p, _WEAP_MAG)
    reserve = _int(p, _WEAP_RESERVE_ECHO)
    if reserve is None:
        full = _int(p, _WEAP_RESERVE)
        reserve = None if full is None else full // 2
    return None if mag is None or reserve is None else (mag, reserve)


def head_pool(head: list[str] | None) -> tuple[int, int] | None:
    """(hp, armor) the head's `$PSET` arms, or None. This is the pool AS PUSHED -- per-player
    overrides and the `body_armor` perk are already baked into the frame by `Compiler._to_gc`, so a
    caller comparing against it needs no perk model of its own and cannot drift from one."""
    p = _find(head, "$PSET,")
    if p is None:
        return None
    hp, armor = _int(p, _PSET_HP), _int(p, _PSET_ARMOR)
    return None if hp is None or armor is None else (hp, armor)


def head_gun_config(head: list[str] | None) -> dict[str, int] | None:
    """The five `$QUERY` fields expected from the head exactly as it was pushed.

    `$PSET` writes all five values and a later `$TID` can overwrite the gun's team byte.  Walk in
    frame order so the result describes the effective gun state, not merely the first template.
    Return no evidence when the effective `$PSET` is incomplete.
    """
    config: dict[str, int] | None = None
    for frame in head or []:
        if not isinstance(frame, str):
            continue
        parts = frame.split(",")
        if frame.startswith("$PSET,"):
            player_id = _int(parts, 1)
            team = _int(parts, 2)
            hp = _int(parts, _PSET_HP)
            armor = _int(parts, _PSET_ARMOR)
            shield = _int(parts, _PSET_SHIELD)
            if player_id is None or team is None or hp is None or armor is None or shield is None:
                config = None
                continue
            config = {"player_id": player_id, "team": team, "hp": hp,
                      "armor": armor, "shield": shield}
        elif frame.startswith("$TID,") and config is not None:
            team = _int(parts, 1)
            if team is not None:
                config["team"] = team
    return config


def head_shield(head: list[str] | None) -> int:
    """The shield CEILING the head's `$PSET` arms (token 5), or 0.

    A separate reader rather than a third element on `head_pool`, which six callers destructure as a
    pair. Bench 2026-09-17 (step 7): t5 is the maximum, never a starting pool -- a gun spawns at shield
    0 and `$LIFE` grants fill it, clamped there by the firmware. 0 means this game has no shield to
    fill, which is what a missing or unreadable token should say too.
    """
    p = _find(head, "$PSET,")
    shield = None if p is None else _int(p, _PSET_SHIELD)
    return 0 if shield is None else shield


def alcd_ammo(frame: str | None, slot: int = 0) -> tuple[int, int] | None:
    """(mag, reserve) from an `$ALCD` frame for `slot`, or None when it is not one.

    Not an `$ALCD` at all, a different slot, or an unparseable token → None. `$START` answers the
    head with `$LCD,0,0,0,0,0,0,*` (protocol §3), which is a perfectly good proof that the gun
    ANSWERED and no evidence whatsoever about the magazine: it lands here as None by design.
    """
    if not isinstance(frame, str) or not frame.startswith("$ALCD,"):
        return None
    p = frame.split(",")
    if _int(p, _ALCD_SLOT) != slot:
        return None
    mag, reserve = _int(p, _ALCD_MAG), _int(p, _ALCD_RESERVE)
    return None if mag is None or reserve is None else (mag, reserve)
