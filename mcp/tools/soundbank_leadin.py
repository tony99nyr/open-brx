"""Measure LEAD-IN SILENCE inside bank clips, for F59 (on-gun audio lands ~1 s after the LED on a hit).

Why. F59's stage measurement (2026-09-09) rules out our own scheduling: the node writes `$PLAY`
BEFORE `$GLED`, and the gun still renders sound about a second after light. That leaves two
candidates, and they want different fixes -- firmware audio latency after `$PLAY` (nothing fixable
here), or lead-in silence baked into the clip itself (fixable by picking or trimming ids). This tool
answers only the second question, offline, with no gun involved: for a given id it finds how long the
waveform stays below a noise floor before the real signal starts (`lead_in_s`), how long it takes to
reach a near-peak level once it does (`attack_to_peak_s`), and how much silence trails the last loud
sample (`tail_s` -- A17's tail problem, F43, is the same measurement run from the other end).

Format: the on-gun `.LTP` files are HEADERLESS raw PCM, signed 16-bit little-endian, mono, 44.1 kHz
(confirmed against `sound_catalog.json`'s `duration_s` for several ids -- file bytes / 2 / 44100
matches the catalog to the millisecond; see `soundbank_analyze.py`'s LTP_RAW note for the original
proof). stdlib + numpy only; no librosa dependency.

Usage:
  soundbank_leadin.py ID [ID ...] [--audio-dir DIR] [--threshold-db -40]
  soundbank_leadin.py --all [--audio-dir DIR] [--threshold-db -40] [--top N]
"""
from __future__ import annotations

import argparse
import os
import sys

import numpy as np

DEFAULT_AUDIO_DIR = os.path.expanduser("~/brx-audio-bank/AUDIO")
SR = 44100
WINDOW_S = 0.005            # ~5 ms RMS windows, per the ask
WINDOW_N = max(1, int(SR * WINDOW_S))
DEFAULT_THRESHOLD_DB = -40.0


def load_ltp(path: str) -> np.ndarray:
    """Headerless s16le mono 44.1 kHz -> float samples in [-1, 1]."""
    raw = np.fromfile(path, dtype="<i2")
    return raw.astype(np.float64) / 32768.0


def window_rms(y: np.ndarray, win: int = WINDOW_N) -> np.ndarray:
    """RMS per non-overlapping `win`-sample window; the tail shorter than a full window is dropped."""
    n = len(y) // win
    if n == 0:
        return np.array([])
    trimmed = y[: n * win].reshape(n, win)
    return np.sqrt(np.mean(trimmed ** 2, axis=1))


def measure(path: str, threshold_db: float = DEFAULT_THRESHOLD_DB) -> dict:
    """duration_s / lead_in_s / attack_to_peak_s / tail_s for one clip, threshold relative to the
    clip's OWN peak (a quiet clip and a loud clip are judged on the same relative scale)."""
    y = load_ltp(path)
    n = len(y)
    duration_s = n / SR
    if n < WINDOW_N:
        return {"duration_s": round(duration_s, 4), "lead_in_s": 0.0, "attack_to_peak_s": 0.0,
                "tail_s": 0.0, "note": "shorter than one window"}
    rms = window_rms(y)
    peak_rms = float(np.max(rms))
    if peak_rms <= 0.0:
        return {"duration_s": round(duration_s, 4), "lead_in_s": round(duration_s, 4),
                "attack_to_peak_s": 0.0, "tail_s": round(duration_s, 4), "note": "silent clip"}
    peak_db_rms = rms / peak_rms
    thresh_lin = 10 ** (threshold_db / 20.0)
    above = np.where(peak_db_rms >= thresh_lin)[0]
    first_i = int(above[0]) if len(above) else len(rms)
    last_i = int(above[-1]) if len(above) else -1
    lead_in_s = first_i * WINDOW_S
    tail_s = duration_s - (last_i + 1) * WINDOW_S if last_i >= 0 else duration_s
    # attack: from first-above-threshold to the first window hitting 90% of the clip's peak RMS
    ninety = np.where(rms >= 0.9 * peak_rms)[0]
    peak_i = int(ninety[0]) if len(ninety) else int(np.argmax(rms))
    attack_to_peak_s = max(0.0, (peak_i - first_i) * WINDOW_S)
    return {"duration_s": round(duration_s, 4), "lead_in_s": round(lead_in_s, 4),
            "attack_to_peak_s": round(attack_to_peak_s, 4), "tail_s": round(max(0.0, tail_s), 4)}


def resolve_path(audio_dir: str, sound_id: str) -> str | None:
    p = os.path.join(audio_dir, sound_id.upper() + ".LTP")
    return p if os.path.exists(p) else None


def all_ids(audio_dir: str) -> list[str]:
    return sorted(os.path.splitext(f)[0].upper() for f in os.listdir(audio_dir) if f.upper().endswith(".LTP"))


def print_table(rows: list[tuple[str, dict]]) -> None:
    print(f"{'id':<8}{'duration_s':>12}{'lead_in_s':>12}{'attack_to_peak_s':>18}{'tail_s':>10}  note")
    for sid, m in rows:
        note = m.get("note", "")
        print(f"{sid:<8}{m['duration_s']:>12.4f}{m['lead_in_s']:>12.4f}{m['attack_to_peak_s']:>18.4f}{m['tail_s']:>10.4f}  {note}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("ids", nargs="*", help="sound ids, e.g. H02 H36 VA33")
    ap.add_argument("--all", action="store_true", help="measure every .LTP in --audio-dir")
    ap.add_argument("--audio-dir", default=DEFAULT_AUDIO_DIR)
    ap.add_argument("--threshold-db", type=float, default=DEFAULT_THRESHOLD_DB,
                     help="signal-present threshold, dBFS relative to the clip's own peak RMS (default -40)")
    ap.add_argument("--top", type=int, default=20, help="with --all, how many longest lead-ins to print")
    a = ap.parse_args()

    if not os.path.isdir(a.audio_dir):
        sys.exit(f"no such audio dir: {a.audio_dir}")

    if a.all:
        ids = all_ids(a.audio_dir)
        rows = []
        for sid in ids:
            path = resolve_path(a.audio_dir, sid)
            if path:
                rows.append((sid, measure(path, a.threshold_db)))
        rows.sort(key=lambda r: r[1]["lead_in_s"], reverse=True)
        print(f"{len(rows)} ids measured, threshold {a.threshold_db} dBFS\n")
        print(f"-- top {a.top} longest lead_in_s --")
        print_table(rows[: a.top])
        buckets = [0.1, 0.3, 0.5, 1.0]
        print("\n-- distribution --")
        for b in buckets:
            n = sum(1 for _, m in rows if m["lead_in_s"] > b)
            print(f"  lead_in_s > {b:>4}: {n}")
        return

    if not a.ids:
        sys.exit("give one or more ids, or --all")
    rows = []
    for sid in a.ids:
        path = resolve_path(a.audio_dir, sid)
        if not path:
            print(f"{sid:<8} NOT FOUND in {a.audio_dir}")
            continue
        rows.append((sid.upper(), measure(path, a.threshold_db)))
    print(f"threshold {a.threshold_db} dBFS\n")
    print_table(rows)


if __name__ == "__main__":
    main()
