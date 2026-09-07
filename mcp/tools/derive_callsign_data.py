"""Restate raw Callsign APK config assets as our own derived JSON, in our own shape.

Why. `protocol/callsign-extract/RAW_ASSETS_NOTE.md` states the repo policy: document facts in our
own words, never commit raw APK assets. Two raw files (`Sounds.json`, `game-medals-config.json`)
were a deliberate, temporary exception, closed 2026-09-07 now that the repo is heading for a public
MIT release. This script is how a maintainer regenerates the derived files below if the source ids,
durations or medal text ever change on a newer Callsign build -- it never ships or reads a raw file
from inside the repo.

Inputs are pulled fresh per `protocol/callsign-extract/apk-harvest.md` "Reproduce" into a LOCAL,
gitignored path (e.g. `protocol/callsign-extract/.raw-assets/`, see `.gitignore`) -- never into a
tracked path. This script only ever reads from wherever you point it; it does not know or assume
that path itself.

Outputs (committed, ours):
  mcp/brx_mcp/data/sound_ids.json  <- Sounds.json's SoundsLengthMap: id -> duration_s, restated as
                                       a list of {id, duration_s} objects (the shape sound_catalog.json
                                       already uses), sorted by id. Read by test_sounds.py and
                                       test_mc_compile.py to check every id we ship against the app's
                                       own bank and to compare voice-pack slot durations.
  mcp/brx_mcp/data/medals.json     <- game-medals-config.json's MedalTypeIdToSpecification, restated
                                       as {key, name, description, window_s}; window_s is parsed out
                                       of the "within N secs" descriptions (null when there isn't
                                       one). Drops the app's internal ImageName/Id (UUID) fields --
                                       nothing in this repo uses them.

Usage:
  python derive_callsign_data.py sounds <path to raw Sounds.json>            [out=mcp/brx_mcp/data/sound_ids.json]
  python derive_callsign_data.py medals <path to raw game-medals-config.json> [out=mcp/brx_mcp/data/medals.json]
"""
from __future__ import annotations

import argparse
import datetime
import json
import pathlib
import re

DATA_DIR = pathlib.Path(__file__).resolve().parents[1] / "brx_mcp" / "data"

_WINDOW_RE = re.compile(r"(\d+)\s*secs?\b")


def derive_sounds(raw_path: pathlib.Path, out_path: pathlib.Path) -> dict:
    raw = json.loads(raw_path.read_text())
    length_map = raw["SoundsLengthMap"]
    sounds = [{"id": sid, "duration_s": round(float(dur), 3)}
              for sid, dur in sorted(length_map.items())]
    out = {
        "generated": datetime.date.today().isoformat(),
        "source": ("Callsign app's Sounds.json (raw asset, not committed -- see "
                    "protocol/callsign-extract/RAW_ASSETS_NOTE.md); derived by "
                    "mcp/tools/derive_callsign_data.py"),
        "count": len(sounds),
        "max_music_volume": raw.get("MaxMusicVolume"),
        "sounds": sounds,
    }
    out_path.write_text(json.dumps(out, indent=1) + "\n")
    return out


def derive_medals(raw_path: pathlib.Path, out_path: pathlib.Path) -> dict:
    raw = json.loads(raw_path.read_text())
    medals = []
    for entry in raw["MedalTypeIdToSpecification"]:
        v = entry["Value"]
        desc = v["Description"]
        m = _WINDOW_RE.search(desc)
        medals.append({
            "key": entry["Key"],
            "name": v["Name"],
            "description": desc,
            "window_s": int(m.group(1)) if m else None,
        })
    medals.sort(key=lambda m: m["key"])
    out = {
        "generated": datetime.date.today().isoformat(),
        "source": ("Callsign app's game-medals-config.json (raw asset, not committed -- see "
                    "protocol/callsign-extract/RAW_ASSETS_NOTE.md); derived by "
                    "mcp/tools/derive_callsign_data.py"),
        "count": len(medals),
        "medals": medals,
    }
    out_path.write_text(json.dumps(out, indent=1) + "\n")
    return out


DERIVERS = {
    "sounds": (derive_sounds, DATA_DIR / "sound_ids.json"),
    "medals": (derive_medals, DATA_DIR / "medals.json"),
}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                  formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("kind", choices=sorted(DERIVERS))
    ap.add_argument("raw_path", type=pathlib.Path, help="path to the raw APK config JSON (local, gitignored)")
    ap.add_argument("out_path", type=pathlib.Path, nargs="?", help="defaults under mcp/brx_mcp/data/")
    args = ap.parse_args()

    fn, default_out = DERIVERS[args.kind]
    out_path = args.out_path or default_out
    result = fn(args.raw_path, out_path)
    print(f"wrote {out_path} ({result['count']} entries)")


if __name__ == "__main__":
    main()
