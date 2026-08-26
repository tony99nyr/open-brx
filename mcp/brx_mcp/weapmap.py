"""Align every `$WEAP` frame across captures into one token x weapon table.

The `$WEAP` field map (callsign-extract/protocol-classes.md) was derived from just
TWO live frames, so most positions are inferred and some can't be validated at all:
a token that holds the same value in both samples is not discriminable, and the
secondary-fire block (tokens 7-13) was empty in both. More weapons = more columns =
positions that finally move.

Feed it captures of Callsign arming games with different weapons:

  python -m brx_mcp.weapmap cap13.log cap14.log ...
  python -m brx_mcp.weapmap --slot 0 cap*.log      # only primary-slot frames

Each weapon becomes a column, keyed by its fire-sound id (token 27) which is the
closest thing the wire has to a weapon identity. Rows flag which tokens VARY (the
informative ones) and which are constant across every weapon seen so far.
"""

from __future__ import annotations

import sys
from pathlib import Path

from .btsnoop import extract_att, parse_btsnoop, reconstruct_frames

# From protocol-classes.md — index -> field name, for the positions we have names for.
FIELDS = {
    0: "slot", 2: "(scale/const)", 3: "primaryPowerType", 4: "primaryDamageType",
    5: "primaryDamage", 6: "primaryCritChance",
    7: "secondaryFireChance", 8: "secondaryDamageType", 9: "secondaryPowerType",
    10: "secondaryDamage", 11: "secondaryCritChance", 12: "extraHeadsetDamage",
    13: "extraHeadsetRangeOut",
    14: "chargeUp/ROF", 15: "rateOfFire", 16: "maxClip", 17: "maxAmmo",
    18: "reloadSpeed", 19: "reloadType", 20: "(secondary/overheat)",
    21: "maxAccuracy", 22: "singleShotAccuracy", 23: "burstWeaponTime", 24: "overheat",
    25: "muzzleFlash", 27: "primaryFire_Snd", 28: "chargeUp_Snd", 29: "chargeDown_Snd",
    30: "secondary_Mix_Snd", 31: "reload1_Snd", 32: "reload2_Snd", 33: "reload3_Snd",
    34: "noAmmo_Snd", 35: "weaponFeatureA", 36: "weaponFeatureB",
    37: "headsetDirection", 38: "headsetRepeat", 39: "clipStartingAmmo",
    40: "ammoReserv", 41: "gunRangeIndoor", 42: "extraHeadsetRangeIn",
}
# Positions the 2-frame derivation could not validate — the ones worth watching.
UNVALIDATED = set(range(7, 14)) | {17, 40, 21, 22, 2, 19, 30, 37, 38}


def toks(frame: str) -> list[str]:
    """Tokens indexed the way protocol-classes.md indexes them: **t0 = slot**.

    The command word is dropped, so `$WEAP,0,,100,…` -> ['0','','100',…]. Keeping
    'WEAP' at index 0 would shift every column by one against the published field
    map — which is exactly the kind of silent off-by-one that produces a confident,
    wrong decode."""
    s = frame.strip()
    if s.endswith(",*"):
        s = s[:-2]
    elif s.endswith("*"):
        s = s[:-1]
    parts = s.lstrip("$").split(",")
    return parts[1:] if parts and parts[0] == "WEAP" else parts


def main() -> None:
    argv = list(sys.argv[1:])
    slot_filter = None
    if "--slot" in argv:
        i = argv.index("--slot")
        slot_filter = argv[i + 1]
        del argv[i:i + 2]
    if not argv:
        print(__doc__, file=sys.stderr)
        sys.exit(2)

    # weapon key -> (label, tokens)
    weapons: dict[str, tuple[str, list[str]]] = {}
    for path in argv:
        try:
            frames = reconstruct_frames(extract_att(parse_btsnoop(path)))
        except Exception as e:  # noqa: BLE001
            print(f"!! {path}: {type(e).__name__}: {e}", file=sys.stderr)
            continue
        found = 0
        for f in frames:
            if f["direction"] != "tx" or not f["raw"].startswith("$WEAP,"):
                continue
            t = toks(f["raw"])
            slot = t[0] if t else "?"
            if slot_filter is not None and slot != slot_filter:
                continue
            snd = t[27] if len(t) > 27 else ""
            # Key on the FULL stat line, not the fire sound: cap18 showed `C03` on
            # BOTH the Rail Gun and the Rocket Launcher with completely different
            # stats, so token 27 is a SOUND, not a weapon identity. Keying by sound
            # would silently merge two distinct weapons into one column.
            key = ",".join(t[1:])
            if key not in weapons:
                dupes = sum(1 for lab, _ in weapons.values()
                            if lab.startswith(f"{snd or '(nosnd)'} s{slot}"))
                label = f"{snd or '(nosnd)'} s{slot}" + (f"#{dupes + 1}" if dupes else "")
                weapons[key] = (label, t)
                found += 1
        print(f"{Path(path).name}: {found} new weapon frame(s)", file=sys.stderr)

    if not weapons:
        print("no $WEAP frames found", file=sys.stderr)
        sys.exit(1)

    keys = list(weapons)
    labels = [weapons[k][0] for k in keys]
    width = max(len(weapons[k][1]) for k in keys)

    colw = max(12, max(len(x) for x in labels) + 1)
    print(f"\n{len(keys)} distinct weapon frame(s)\n")
    head = f"{'tok':>4} {'field':>22} | " + " | ".join(f"{x:>{colw}}" for x in labels)
    print(head)
    print("-" * len(head))
    varying, constant = [], []
    for i in range(0, width):
        vals = [(weapons[k][1][i] if i < len(weapons[k][1]) else "") for k in keys]
        name = FIELDS.get(i, "?")
        mark = ""
        if len(set(vals)) > 1:
            varying.append(i)
            mark = "  <-- VARIES"
            if i in UNVALIDATED:
                mark = "  <-- VARIES **NEW INFO**"
        else:
            constant.append(i)
        cells = " | ".join(f"{v!r:>{colw}}" for v in vals)
        print(f"{i:>4} {name:>22} | {cells}{mark}")

    print(f"\nvarying tokens: {varying}")
    newly = [i for i in varying if i in UNVALIDATED]
    if newly:
        print(f"\n>>> {len(newly)} previously-unvalidated position(s) finally moved: {newly}")
        for i in newly:
            print(f"      tok {i:>2} ({FIELDS.get(i,'?')}): "
                  + ", ".join(f"{lab}={weapons[k][1][i]!r}"
                              for k, lab in zip(keys, labels)
                              if i < len(weapons[k][1])))
    else:
        print("\nno previously-unvalidated position moved — these weapons differ only "
              "where we already had confidence. Try a weapon with a real SECONDARY FIRE "
              "(tokens 7-13) or LIMITED ammo (17/40).")
    print(f"\nconstant across all {len(keys)}: {constant}")


if __name__ == "__main__":
    main()
