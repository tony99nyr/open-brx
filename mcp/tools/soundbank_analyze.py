"""Turn a folder of BRX sound files into a catalog Claude can READ: transcripts, tags, descriptors, spectrograms.

Why. The bank is 2166 ids with prefixes and durations and nothing else (`sound-bank.md`). Picking
sounds for a game mode by playing them one at a time through a gun does not scale, and an assistant
cannot listen. What it can do is read a transcript, read a set of acoustic descriptors, and look at a
spectrogram. So, per file:

  1. decode to 16 kHz mono WAV with ffmpeg (whatever the on-gun `.LTP` container turns out to be --
     `probe_format()` reports the header so the decode step can be fixed if ffmpeg refuses it);
  2. descriptors with librosa: duration, peak/RMS loudness, attack time, spectral centroid and
     flatness (tonal vs noisy), zero-crossing rate, onset count (one-shot vs repeating), pitch
     estimate, and a coarse envelope shape (impact / sustained / rising / decaying / looping);
  3. speech: faster-whisper on every clip whose prefix is V (voice) and on any clip with a
     speech-like spectral profile, giving the WORDS;
  4. a spectrogram PNG per clip for eyeballing;
  5. one JSON line per id -> `catalog.jsonl`, resumable (already-done ids are skipped), so a crash
     or a Ctrl-C loses nothing.

The output is a machine-readable inventory, not the classification itself: the game-event category
("hit_taken", "emp_hit", "kill_confirm", ...) is assigned afterwards from these rows, and then
audited by ear on a sample through a real gun. Keep raw Battle Company audio OUT of the repo
(`RAW_ASSETS_NOTE.md`); this writes only derived data.

Usage: python soundbank_analyze.py <audio_dir> <out_dir> [--whisper small|base|tiny] [--no-whisper] [--limit N]
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time

import numpy as np

FFMPEG = os.path.expanduser("~/.local/bin/ffmpeg") if os.path.exists(os.path.expanduser("~/.local/bin/ffmpeg")) else "ffmpeg"
SR = 16000


def probe_format(path: str) -> str:
    with open(path, "rb") as f:
        head = f.read(16)
    return head.hex()


# The on-gun `.LTP` files are HEADERLESS raw PCM: signed 16-bit little-endian, mono, 44.1 kHz.
# Read off the disk 2026-09-03: A01.LTP is 217278 bytes = 108639 samples, and the app's own
# duration table says A01 lasts 2.4635 s -> 44100 samples/s exactly; A03 (41138 B, 0.4664 s) agrees.
# The first bytes are tiny signed values climbing from zero -- a waveform, not a header.
LTP_RAW = ["-f", "s16le", "-ar", "44100", "-ac", "1"]


def to_wav(src: str, dst: str) -> bool:
    if os.path.exists(dst):
        return True
    pre = LTP_RAW if src.lower().endswith(".ltp") else []
    r = subprocess.run([FFMPEG, "-v", "error", "-y", *pre, "-i", src, "-ac", "1", "-ar", str(SR), dst],
                       capture_output=True, text=True)
    if r.returncode != 0:
        sys.stderr.write(f"ffmpeg failed on {src}: {r.stderr.strip()[:200]}\n")
        return False
    return True


def envelope_shape(rms: np.ndarray) -> str:
    """Coarse shape from the RMS envelope: where the energy sits and how it moves."""
    if len(rms) < 4:
        return "tiny"
    n = len(rms)
    peak_i = int(np.argmax(rms))
    q1, q3 = rms[: n // 3].mean(), rms[-n // 3:].mean()
    mid = rms[n // 3: -n // 3].mean() if n >= 9 else rms.mean()
    if peak_i < n * 0.15 and q3 < 0.25 * rms.max():
        return "impact"            # hits hard at the start and dies
    if q3 > 1.5 * q1:
        return "rising"
    if q1 > 1.5 * q3:
        return "decaying"
    if abs(q1 - q3) < 0.3 * rms.max() and mid > 0.5 * rms.max():
        return "sustained"
    return "varying"


def descriptors(y: np.ndarray, sr: int) -> dict:
    import librosa
    dur = len(y) / sr
    if len(y) < sr // 20:
        return {"duration_s": round(dur, 3), "empty": True}
    peak = float(np.max(np.abs(y)))
    rms = librosa.feature.rms(y=y)[0]
    hop = 512
    attack_i = int(np.argmax(rms >= 0.9 * rms.max()))
    centroid = librosa.feature.spectral_centroid(y=y, sr=sr)[0]
    flat = librosa.feature.spectral_flatness(y=y)[0]
    zcr = librosa.feature.zero_crossing_rate(y)[0]
    onsets = librosa.onset.onset_detect(y=y, sr=sr, units="time")
    try:
        f0 = librosa.yin(y, fmin=60, fmax=2000, sr=sr)
        voiced = f0[(f0 > 60) & (f0 < 2000)]
        pitch_hz = float(np.median(voiced)) if len(voiced) else None
        pitch_stability = float(np.std(voiced) / (np.mean(voiced) + 1e-9)) if len(voiced) > 2 else None
    except Exception:
        pitch_hz, pitch_stability = None, None
    return {
        "duration_s": round(dur, 3),
        "peak": round(peak, 3),
        "rms_db": round(float(20 * np.log10(rms.mean() + 1e-9)), 1),
        "attack_s": round(attack_i * hop / sr, 3),
        "centroid_hz": int(centroid.mean()),
        "centroid_trend": "up" if centroid[-len(centroid) // 3:].mean() > 1.3 * centroid[: len(centroid) // 3].mean()
                          else ("down" if centroid[-len(centroid) // 3:].mean() < 0.7 * centroid[: len(centroid) // 3].mean() else "flat"),
        "flatness": round(float(flat.mean()), 3),          # ~0 tonal, ->1 noise-like
        "zcr": round(float(zcr.mean()), 3),
        "onsets": int(len(onsets)),
        "onset_rate_hz": round(len(onsets) / dur, 2) if dur else 0,
        "pitch_hz": int(pitch_hz) if pitch_hz else None,
        "pitch_stability": round(pitch_stability, 3) if pitch_stability is not None else None,
        "envelope": envelope_shape(rms),
    }


def spectrogram_png(y: np.ndarray, sr: int, path: str) -> None:
    if os.path.exists(path):
        return
    import librosa
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    S = librosa.amplitude_to_db(np.abs(librosa.stft(y, n_fft=1024, hop_length=256)), ref=np.max)
    fig, ax = plt.subplots(figsize=(6, 2.2), dpi=80)
    librosa.display.specshow(S, sr=sr, hop_length=256, x_axis="time", y_axis="hz", ax=ax, cmap="magma")
    ax.set_ylim(0, 8000)
    ax.set_title(os.path.basename(path).replace(".png", ""), fontsize=9)
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)


_whisper = None


def transcribe(wav: str, model_name: str) -> dict:
    global _whisper
    from faster_whisper import WhisperModel
    if _whisper is None:
        _whisper = WhisperModel(model_name, device="cpu", compute_type="int8")
    segs, info = _whisper.transcribe(wav, language="en", beam_size=3, vad_filter=False)
    text = " ".join(s.text.strip() for s in segs).strip()
    return {"text": text, "lang_prob": round(float(info.language_probability), 2)}


def speechlike(d: dict) -> bool:
    """Cheap gate for running whisper on a non-V id: mid-band centroid, tonal-ish, syllabic onsets."""
    if d.get("empty"):
        return False
    return (300 <= d["centroid_hz"] <= 3500 and d["flatness"] < 0.35
            and 1.5 <= d["onset_rate_hz"] <= 8 and d["duration_s"] >= 0.4)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("audio_dir")
    ap.add_argument("out_dir")
    ap.add_argument("--whisper", default="small")
    ap.add_argument("--no-whisper", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()

    os.makedirs(os.path.join(a.out_dir, "wav"), exist_ok=True)
    os.makedirs(os.path.join(a.out_dir, "spec"), exist_ok=True)
    cat_path = os.path.join(a.out_dir, "catalog.jsonl")
    done = set()
    if os.path.exists(cat_path):
        for ln in open(cat_path):
            try:
                done.add(json.loads(ln)["id"])
            except Exception:
                pass

    files = sorted(f for f in os.listdir(a.audio_dir) if not f.startswith("."))
    if a.limit:
        files = files[: a.limit]
    print(f"{len(files)} files, {len(done)} already done -> {cat_path}", flush=True)
    import librosa
    t0 = time.time()
    with open(cat_path, "a") as out:
        for i, fn in enumerate(files):
            sid = os.path.splitext(fn)[0].upper()
            if sid in done:
                continue
            src = os.path.join(a.audio_dir, fn)
            wav = os.path.join(a.out_dir, "wav", sid + ".wav")
            row = {"id": sid, "src": fn, "family": re.match(r"[A-Z]+", sid).group(0) if re.match(r"[A-Z]+", sid) else "?",
                   "header_hex": probe_format(src)}
            if not to_wav(src, wav):
                row["error"] = "decode"
                out.write(json.dumps(row) + "\n"); out.flush()
                continue
            y, sr = librosa.load(wav, sr=SR, mono=True)
            d = descriptors(y, sr)
            row.update(d)
            try:
                spectrogram_png(y, sr, os.path.join(a.out_dir, "spec", sid + ".png"))
            except Exception as e:  # noqa: BLE001
                row["spec_error"] = str(e)[:80]
            if not a.no_whisper and not d.get("empty") and (row["family"].startswith("V") or speechlike(d)):
                try:
                    row["speech"] = transcribe(wav, a.whisper)
                except Exception as e:  # noqa: BLE001
                    row["speech"] = {"error": str(e)[:80]}
            out.write(json.dumps(row) + "\n"); out.flush()
            if (i + 1) % 25 == 0:
                print(f"  {i + 1}/{len(files)}  {time.time() - t0:.0f}s", flush=True)
    print(f"done in {time.time() - t0:.0f}s", flush=True)


if __name__ == "__main__":
    main()
