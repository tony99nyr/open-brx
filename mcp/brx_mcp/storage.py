"""Persistence: known-device registry and session capture files.

Everything lives under ~/.brx-mcp/ on whichever machine runs the server
(on Windows that is C:\\Users\\<you>\\.brx-mcp).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

BASE_DIR = Path.home() / ".brx-mcp"
CAPTURES_DIR = BASE_DIR / "captures"
REGISTRY_PATH = BASE_DIR / "known-devices.json"


def ensure_dirs() -> None:
    CAPTURES_DIR.mkdir(parents=True, exist_ok=True)


def load_registry() -> dict[str, Any]:
    if REGISTRY_PATH.exists():
        return json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
    return {"devices": []}


def save_device(address: str, alias: str | None = None,
                generation: str | None = None, name: str | None = None) -> None:
    ensure_dirs()
    registry = load_registry()
    for dev in registry["devices"]:
        if dev["address"] == address:
            if alias:
                dev["alias"] = alias
            if generation:
                dev["generation"] = generation
            if name:
                dev["name"] = name
            break
    else:
        registry["devices"].append({
            "address": address, "alias": alias,
            "generation": generation, "name": name,
        })
    REGISTRY_PATH.write_text(json.dumps(registry, indent=2), encoding="utf-8")


def capture_path(label: str) -> Path:
    safe = "".join(c if c.isalnum() or c in "-_." else "_" for c in label)
    return CAPTURES_DIR / f"{safe}.jsonl"


def list_captures() -> list[str]:
    ensure_dirs()
    return sorted(p.stem for p in CAPTURES_DIR.glob("*.jsonl"))


def diff_captures(file_a: str, file_b: str) -> dict[str, Any]:
    """Token-level diff of two capture files.

    Pairs up frames by command name and occurrence order, then reports which
    token positions differ — the workhorse for cracking $WEAP field meanings
    by diffing official-app captures that change one setting at a time.
    """
    from .protocol import command_name, tokenize

    def load(path_str: str) -> list[dict[str, Any]]:
        path = Path(path_str)
        if not path.exists():
            path = capture_path(path_str)  # allow bare labels
        rows = []
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                rows.append(json.loads(line))
        return rows

    rows_a, rows_b = load(file_a), load(file_b)

    def by_command(rows: list[dict[str, Any]]) -> dict[str, list[str]]:
        grouped: dict[str, list[str]] = {}
        for r in rows:
            grouped.setdefault(command_name(r["raw"]), []).append(r["raw"])
        return grouped

    grouped_a, grouped_b = by_command(rows_a), by_command(rows_b)
    diffs: list[dict[str, Any]] = []
    for cmd in sorted(set(grouped_a) | set(grouped_b)):
        frames_a = grouped_a.get(cmd, [])
        frames_b = grouped_b.get(cmd, [])
        if len(frames_a) != len(frames_b):
            diffs.append({"command": cmd, "count_a": len(frames_a),
                          "count_b": len(frames_b),
                          "note": "frame count differs between captures"})
        for i, (fa, fb) in enumerate(zip(frames_a, frames_b)):
            if fa == fb:
                continue
            ta, tb = tokenize(fa), tokenize(fb)
            changed = [
                {"token_index": idx, "a": (ta[idx] if idx < len(ta) else None),
                 "b": (tb[idx] if idx < len(tb) else None)}
                for idx in range(max(len(ta), len(tb)))
                if (ta[idx] if idx < len(ta) else None)
                != (tb[idx] if idx < len(tb) else None)
            ]
            diffs.append({"command": cmd, "occurrence": i,
                          "frame_a": fa, "frame_b": fb,
                          "changed_tokens": changed})
    return {"file_a": file_a, "file_b": file_b,
            "frames_a": len(rows_a), "frames_b": len(rows_b), "diffs": diffs}
