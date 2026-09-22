#!/usr/bin/env python3
"""Hash-compare a caller-supplied BRX audio update ZIP with an off-repo bank.

The ZIP is streamed in place and never extracted. Successful output contains normalized sound IDs,
aggregate counts, the archive SHA-256, and one aggregate bank-manifest fingerprint: no audio bytes,
per-file hashes, private paths, or ZIP metadata.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import re
import stat
import zipfile

_ID = re.compile(r"[A-Z][A-Z0-9]{1,7}")
_CHUNK = 1024 * 1024


def _normalized_id(name: str) -> str:
    sound_id = pathlib.PurePosixPath(name).stem.upper()
    if not _ID.fullmatch(sound_id):
        raise ValueError("pack contains a malformed sound id")
    return sound_id


def _hash_reader(reader) -> str:
    digest = hashlib.sha256()
    while chunk := reader.read(_CHUNK):
        digest.update(chunk)
    return digest.hexdigest()


def _hash_file(path: pathlib.Path) -> str:
    with path.open("rb") as source:
        return _hash_reader(source)


def _bank_hashes(bank_dir: pathlib.Path) -> dict[str, str]:
    if not bank_dir.is_dir():
        raise ValueError("bank is not a directory")
    hashes: dict[str, str] = {}
    for path in sorted(bank_dir.rglob("*")):
        if path.suffix.lower() != ".ltp":
            continue
        if path.is_symlink() or not path.is_file():
            raise ValueError("bank contains a non-regular LTP entry")
        sound_id = _normalized_id(path.name)
        if sound_id in hashes:
            raise ValueError(f"duplicate normalized bank sound id {sound_id}")
        hashes[sound_id] = _hash_file(path)
    return hashes


def _manifest_sha256(hashes: dict[str, str]) -> str:
    """Fingerprint a bank without publishing any individual file hash or path."""
    digest = hashlib.sha256()
    for sound_id, file_digest in sorted(hashes.items()):
        digest.update(sound_id.encode("ascii") + b"\0" + file_digest.encode("ascii") + b"\n")
    return digest.hexdigest()


def _pack_hashes(pack_zip: pathlib.Path) -> dict[str, str]:
    if not pack_zip.is_file():
        raise ValueError("audio pack is not a regular file")
    hashes: dict[str, str] = {}
    with zipfile.ZipFile(pack_zip) as archive:
        for member in archive.infolist():
            if member.is_dir():
                continue
            file_type = (member.external_attr >> 16) & 0o170000
            if file_type and not stat.S_ISREG(file_type):
                raise ValueError("pack contains a non-regular entry")
            if pathlib.PurePosixPath(member.filename).suffix.lower() != ".ltp":
                raise ValueError("pack contains a non-LTP file")
            sound_id = _normalized_id(member.filename)
            if sound_id in hashes:
                raise ValueError(f"duplicate normalized sound id {sound_id}")
            with archive.open(member, "r") as source:
                hashes[sound_id] = _hash_reader(source)
    return hashes


def compare_pack(
    pack_zip: pathlib.Path,
    bank_dir: pathlib.Path,
    *,
    expected_archive_sha256: str | None = None,
    expected_ltp_count: int | None = None,
) -> dict[str, int | str | list[str]]:
    """Return a deterministic, facts-only partition of pack IDs against the bank."""
    archive_sha256 = _hash_file(pack_zip)
    if expected_archive_sha256 is not None:
        if archive_sha256.lower() != expected_archive_sha256.lower():
            raise ValueError("archive SHA-256 does not match")
    pack = _pack_hashes(pack_zip)
    if expected_ltp_count is not None and len(pack) != expected_ltp_count:
        raise ValueError(f"expected {expected_ltp_count} LTP files; found {len(pack)}")
    bank = _bank_hashes(bank_dir)
    same = sorted(sound_id for sound_id, digest in pack.items() if bank.get(sound_id) == digest)
    changed = sorted(sound_id for sound_id, digest in pack.items() if sound_id in bank and bank[sound_id] != digest)
    new = sorted(set(pack) - set(bank))
    return {
        "archive_sha256": archive_sha256,
        "bank_ltp_count": len(bank),
        "bank_manifest_sha256": _manifest_sha256(bank),
        "pack_ltp_count": len(pack),
        "same_count": len(same),
        "changed_count": len(changed),
        "new_count": len(new),
        "same": same,
        "changed": changed,
        "new": new,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="compare a private BRX audio update ZIP with an off-repo bank")
    parser.add_argument("pack_zip", type=pathlib.Path, help="caller-supplied private audio update ZIP")
    parser.add_argument("bank_dir", type=pathlib.Path, help="caller-supplied off-repo AUDIO bank directory")
    parser.add_argument("--expect-archive-sha256", help="refuse an archive with a different SHA-256")
    parser.add_argument("--expect-ltp-count", type=int, help="refuse a different number of LTP payloads")
    args = parser.parse_args(argv)
    try:
        result = compare_pack(
            args.pack_zip,
            args.bank_dir,
            expected_archive_sha256=args.expect_archive_sha256,
            expected_ltp_count=args.expect_ltp_count,
        )
    except ValueError as exc:
        parser.error(str(exc))
    except zipfile.BadZipFile:
        parser.error("audio pack is not a readable ZIP")
    except RuntimeError:
        parser.error("audio pack member could not be read")
    except OSError:
        parser.error("cannot read the private audio inputs")
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
