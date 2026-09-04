"""Convert any audio file into a BRX on-gun sound (`<ID>.LTP`) — headerless raw PCM, s16le, mono, 44.1 kHz.

    python mcp/tools/ltp_convert.py glock_fire.wav P09          # → P09.LTP next to the source
    python mcp/tools/ltp_convert.py deagle.mp3 deagle --out ~/out   # pistol names resolve to their fire id

The three sidearms (weapons.json, 2026-09-04) fire on ids no other weapon uses, so overwriting that one
file on the gun changes only that pistol:  glock → P09 · usp → Q04 · deagle → P16  (reload run D08/D07/D06
is shared by all three). The file goes onto the tagger over the micro-USB DATA port into `AUDIO/`
(docs/reference/community-notes.md, "Custom sounds ON the tagger") — keep the original `.LTP` first;
Battle Company's USB updater is the factory restore. Nothing here touches firmware.

Needs `ffmpeg` on PATH. Trims leading silence, normalises peak to -1 dBFS, caps the clip at --max-s
(a fire sound longer than the weapon's cycle just gets cut off by the next shot anyway).
"""
from __future__ import annotations

import argparse
import pathlib
import shutil
import subprocess
import sys

PISTOL_FIRE_ID = {"glock": "P09", "usp": "Q04", "deagle": "P16"}


def convert(src: pathlib.Path, sound_id: str, out_dir: pathlib.Path, max_s: float) -> pathlib.Path:
    if shutil.which("ffmpeg") is None:
        sys.exit("ffmpeg not found on PATH")
    sound_id = PISTOL_FIRE_ID.get(sound_id.lower(), sound_id).upper()
    out = out_dir / f"{sound_id}.LTP"
    filters = f"silenceremove=start_periods=1:start_threshold=-50dB,atrim=0:{max_s},volume=-1dB:precision=fixed,alimiter=limit=0.89"
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", str(src), "-af", filters,
           "-ac", "1", "-ar", "44100", "-f", "s16le", "-acodec", "pcm_s16le", str(out)]
    subprocess.run(cmd, check=True)
    secs = out.stat().st_size / (2 * 44100)
    print(f"{out}  ({secs:.2f} s, raw s16le mono 44.1k)")
    return out


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src", type=pathlib.Path)
    ap.add_argument("sound_id", help="on-gun id (P09) or a pistol name (glock|usp|deagle)")
    ap.add_argument("--out", type=pathlib.Path, default=None, help="output directory (default: beside the source)")
    ap.add_argument("--max-s", type=float, default=1.5, help="cap the clip length in seconds (default 1.5)")
    a = ap.parse_args(argv)
    convert(a.src, a.sound_id, a.out or a.src.parent, a.max_s)


if __name__ == "__main__":
    main()
