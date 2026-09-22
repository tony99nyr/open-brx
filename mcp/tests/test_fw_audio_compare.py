"""R4/T4: compare a private firmware audio pack without extracting or publishing audio."""
from __future__ import annotations

import hashlib
import json
import pathlib
import subprocess
import sys
import tempfile
import zipfile

TOOLS = pathlib.Path(__file__).resolve().parents[1] / "tools"
sys.path.insert(0, str(TOOLS))

import fw_audio_compare as C  # noqa: E402


def _assert_raises(exc_type, message: str, fn) -> None:
    try:
        fn()
    except exc_type as exc:
        assert message in str(exc), str(exc)
    else:
        raise AssertionError(f"expected {exc_type.__name__}: {message}")


def _write_zip(path: pathlib.Path, members: dict[str, bytes]) -> None:
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("audio/", b"")
        for name, payload in members.items():
            archive.writestr(name, payload)


def _expected_manifest(payloads: dict[str, bytes]) -> str:
    manifest = b"".join(
        sound_id.encode("ascii") + b"\0" + hashlib.sha256(payload).hexdigest().encode("ascii") + b"\n"
        for sound_id, payload in sorted(payloads.items())
    )
    return hashlib.sha256(manifest).hexdigest()


def _with_tmp_path(fn):
    def run() -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            fn(pathlib.Path(temp_dir))
    return run


@_with_tmp_path
def test_compare_streams_a_sorted_id_only_partition(tmp_path: pathlib.Path):
    pack = tmp_path / "private.zip"
    bank = tmp_path / "bank"
    bank.mkdir()
    _write_zip(pack, {
        "audio/A01.LTP": b"same",
        "audio/a02.ltp": b"new bytes",
        "audio/VNEW.LTP": b"pack only",
    })
    (bank / "A01.LTP").write_bytes(b"same")
    (bank / "A02.LTP").write_bytes(b"old bytes")
    (bank / "B01.LTP").write_bytes(b"bank only")

    result = C.compare_pack(pack, bank, expected_ltp_count=3)

    assert result == {
        "archive_sha256": hashlib.sha256(pack.read_bytes()).hexdigest(),
        "bank_ltp_count": 3,
        "bank_manifest_sha256": _expected_manifest({
            "A01": b"same", "A02": b"old bytes", "B01": b"bank only",
        }),
        "pack_ltp_count": 3,
        "same_count": 1,
        "changed_count": 1,
        "new_count": 1,
        "same": ["A01"],
        "changed": ["A02"],
        "new": ["VNEW"],
    }

    second_bank = tmp_path / "second-bank"
    (second_bank / "nested").mkdir(parents=True)
    (second_bank / "nested" / "B01.LTP").write_bytes(b"bank only")
    (second_bank / "A02.LTP").write_bytes(b"old bytes")
    (second_bank / "A01.LTP").write_bytes(b"same")
    second = C.compare_pack(pack, second_bank)
    assert second["bank_manifest_sha256"] == result["bank_manifest_sha256"]
    (second_bank / "A02.LTP").write_bytes(b"one byte changed")
    changed_bank = C.compare_pack(pack, second_bank)
    assert changed_bank["bank_manifest_sha256"] != result["bank_manifest_sha256"]


@_with_tmp_path
def test_compare_rejects_duplicate_or_unexpected_members(tmp_path: pathlib.Path):
    bank = tmp_path / "bank"
    bank.mkdir()
    duplicate = tmp_path / "duplicate.zip"
    _write_zip(duplicate, {"one/A01.LTP": b"a", "two/a01.ltp": b"b"})
    _assert_raises(
        ValueError, "duplicate normalized sound id A01",
        lambda: C.compare_pack(duplicate, bank),
    )

    unexpected = tmp_path / "unexpected.zip"
    _write_zip(unexpected, {"audio/A01.LTP": b"a", "notes.txt": b"private metadata"})
    _assert_raises(ValueError, "non-LTP file", lambda: C.compare_pack(unexpected, bank))


@_with_tmp_path
def test_compare_checks_archive_identity_and_expected_count(tmp_path: pathlib.Path):
    pack = tmp_path / "private.zip"
    bank = tmp_path / "bank"
    bank.mkdir()
    _write_zip(pack, {"A01.LTP": b"a"})
    digest = hashlib.sha256(pack.read_bytes()).hexdigest()

    assert C.compare_pack(pack, bank, expected_archive_sha256=digest)["new"] == ["A01"]
    _assert_raises(
        ValueError, "archive SHA-256 does not match",
        lambda: C.compare_pack(pack, bank, expected_archive_sha256="0" * 64),
    )
    _assert_raises(
        ValueError, "expected 2 LTP files; found 1",
        lambda: C.compare_pack(pack, bank, expected_ltp_count=2),
    )


@_with_tmp_path
def test_cli_success_report_contains_only_counts_and_normalized_ids(tmp_path: pathlib.Path):
    pack = tmp_path / "secret-pack.zip"
    bank = tmp_path / "private-bank"
    bank.mkdir()
    _write_zip(pack, {"private-layout/A01.LTP": b"same"})
    (bank / "A01.LTP").write_bytes(b"same")

    run = subprocess.run(
        [sys.executable, str(TOOLS / "fw_audio_compare.py"), str(pack), str(bank), "--expect-ltp-count", "1"],
        capture_output=True, text=True, timeout=10,
    )
    assert run.returncode == 0, run.stderr
    assert json.loads(run.stdout) == {
        "archive_sha256": hashlib.sha256(pack.read_bytes()).hexdigest(),
        "bank_ltp_count": 1,
        "bank_manifest_sha256": _expected_manifest({"A01": b"same"}),
        "pack_ltp_count": 1,
        "same_count": 1,
        "changed_count": 0,
        "new_count": 0,
        "same": ["A01"],
        "changed": [],
        "new": [],
    }
    assert "secret-pack" not in run.stdout
    assert "private-bank" not in run.stdout
    assert "private-layout" not in run.stdout
    assert "73616d65" not in run.stdout


@_with_tmp_path
def test_cli_failures_never_print_private_paths_or_member_names(tmp_path: pathlib.Path):
    secret_pack = tmp_path / "sentinel-secret-pack.zip"
    secret_bank = tmp_path / "sentinel-private-bank"
    secret_bank.mkdir()
    secret_pack.write_bytes(b"not a zip")
    cases = (
        [str(tmp_path / "sentinel-missing-pack.zip"), str(secret_bank)],
        [str(secret_pack), str(secret_bank)],
        [str(secret_pack), str(tmp_path / "sentinel-missing-bank")],
    )
    for args in cases:
        run = subprocess.run(
            [sys.executable, str(TOOLS / "fw_audio_compare.py"), *args],
            capture_output=True, text=True, timeout=10,
        )
        assert run.returncode == 2
        combined = run.stdout + run.stderr
        for secret in (str(tmp_path), "sentinel-secret-pack", "sentinel-private-bank",
                       "sentinel-missing-pack", "sentinel-missing-bank"):
            assert secret not in combined
