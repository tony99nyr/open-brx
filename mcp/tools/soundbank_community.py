"""Fold community sound labels into `data/sound_catalog.json`, and re-render `sound-catalog.md`.

Source: the "BRX Audio" Google Sheet, an open community sheet shared by Jay of LaserTagMods (S1,
`docs/FOLLOWUPS.md`). The sheet names sounds by ear; we asked, and the owner agreed identified sounds
should be documented here. A community label is a **guess by a listener, not a transcript or a bench
finding**: it never overwrites `description`, `transcript` or `verified_by_ear`, which stay our own
evidence. It lands beside them as `community_label`, so a reader can compare the two.

Input: `data/community_sound_labels.csv` (id, label, status), a scrubbed restatement of the sheet
(id + description + our comparison status only; no sheet-owner name, no other columns) built once from
the parsed sheet and checked in here, the same way `sound_catalog.json` itself restates derived facts
without carrying any raw Battle Company or Google Sheets file. `status` is one of:

  new_label -- we had no real label for this id (our own `description` is a machine acoustic-shape
               guess), so the community label is the more useful read and the markdown shows it first.
  agrees    -- the community label and our own description point at the same thing.
  differs   -- the community label disagrees with our own description; the markdown shows both.

Twenty ids the sheet's "update audio V4_30" tab flags NOISE (broken by the on-gun v4.30 audio update,
per the community, not yet checked by our own ear) get `community_flag_noise: true` instead of a label:
none of the twenty have a sheet description of their own.

Usage: python soundbank_community.py [--catalog PATH] [--csv PATH] [--md PATH]
"""
from __future__ import annotations

import argparse
import collections
import csv
import json
import pathlib

HERE = pathlib.Path(__file__).resolve().parent
DEFAULT_CATALOG = HERE.parent / "brx_mcp" / "data" / "sound_catalog.json"
DEFAULT_CSV = HERE.parent / "brx_mcp" / "data" / "community_sound_labels.csv"
DEFAULT_MD = HERE.parent.parent / "docs" / "reference" / "sound-catalog.md"

COMMUNITY_SOURCE = "LaserTagMods BRX Audio sheet"

# The sheet's "update audio V4_30" tab: these ids broke (play as noise) after the gun's v4.30 audio
# update, per the community. None of the twenty have a sheet description, so they carry the noise
# flag only, no `community_label`. Pending our own ear check (S1, docs/FOLLOWUPS.md).
NOISE_IDS = frozenset({
    "HM10", "HM11", "HM12", "HM13", "HM14", "HM1B", "HM1F", "HM1O", "HM25", "MC2J",
    "MM0A", "TK0W", "TK0Z", "TK14", "TK15", "TK19", "TK1R", "TK2R", "TK2V", "TK2W",
})


def load_labels(csv_path: pathlib.Path) -> dict[str, dict]:
    with open(csv_path, newline="", encoding="utf-8") as f:
        return {row["id"]: row for row in csv.DictReader(f)}


def merge(catalog: dict, labels: dict[str, dict]) -> dict:
    """Add community_label / community_status / community_flag_noise to matching entries, in place.

    Never touches `description`, `transcript` or `verified_by_ear`: a community label is unconfirmed
    and lives beside our own evidence, not over it.
    """
    by_id = {e["id"]: e for e in catalog["sounds"]}
    matched, unmatched = 0, 0
    for sid, row in labels.items():
        entry = by_id.get(sid)
        if entry is None or not entry.get("on_gun"):
            # the sheet's label is for an id we don't have on the gun (or don't carry at all) --
            # not added to the on-gun catalog; counted in the markdown header instead.
            unmatched += 1
            continue
        # never overwrite our own evidence with an unconfirmed community guess (test_sound_catalog.py
        # pins this: test_community_label_never_overwrites_our_own_evidence).
        entry["community_label"] = row["label"]
        entry["community_status"] = row["status"]
        matched += 1

    noise_matched = 0
    for sid in NOISE_IDS:
        entry = by_id.get(sid)
        if entry is not None:
            entry["community_flag_noise"] = True
            noise_matched += 1

    catalog["community_source"] = COMMUNITY_SOURCE
    catalog["community_labels_count"] = matched
    catalog["community_noise_flagged_count"] = noise_matched
    return catalog


def write_catalog(catalog: dict, path: pathlib.Path) -> None:
    # indent=2 matches the file as checked in (soundbank_classify.py's own indent=1 default does not;
    # keep this tool's output byte-stable with the existing file so a re-run diffs only real changes).
    with open(path, "w", encoding="utf-8") as f:
        json.dump(catalog, f, indent=2)
        f.write("\n")


def write_md(catalog: dict, path: pathlib.Path, not_on_gun_count: int) -> None:
    """Re-render `sound-catalog.md` from the merged catalog, via `soundbank_classify.write_md`, then
    add a community-labels section describing the new fields."""
    import sys
    sys.path.insert(0, str(HERE))
    import soundbank_classify as sc

    out = catalog["sounds"]
    sc.write_md(out, str(path), community_not_on_gun_count=not_on_gun_count)

    new_labels = [e for e in out if e.get("community_status") == "new_label"]
    differs = [e for e in out if e.get("community_status") == "differs"]
    agrees = [e for e in out if e.get("community_status") == "agrees"]
    noisy = sorted(e["id"] for e in out if e.get("community_flag_noise"))

    L = ["\n## Community labels\n"]
    L.append(f"The {COMMUNITY_SOURCE}, an open community sheet shared by Jay of LaserTagMods, names "
             "sounds by ear. A community label is a guess by a listener, not a transcript or a bench "
             "finding: it never replaces our own `description`, `transcript` or `verified_by_ear`, and "
             "shows beside them instead.\n")
    L.append(f"- **{len(new_labels)} ids** had no real label of ours (our `description` was only a "
             "machine acoustic-shape guess); the community label is shown first, below, marked "
             "**NEW**.")
    L.append(f"- **{len(differs)} ids** have a community label that disagrees with our own "
             "description; both are shown.")
    L.append(f"- **{len(agrees)} ids** have a community label that agrees with our own description.")
    L.append(f"- **{not_on_gun_count} ids** named in the sheet are not on our gun and are left out of "
             "this catalog.\n")
    L.append(f"### {len(new_labels)} ids with a new community label (ours was a machine guess)\n")
    L.append("| id | community label | our description |\n|---|---|---|")
    for e in sorted(new_labels, key=lambda e: e["id"]):
        L.append(f"| {e['id']} | **NEW:** {e['community_label']} | {e['description']} |")
    L.append(f"\n### {len(differs)} ids where the community label differs from ours\n")
    L.append("| id | community label | our description |\n|---|---|---|")
    for e in sorted(differs, key=lambda e: e["id"]):
        L.append(f"| {e['id']} | {e['community_label']} | {e['description']} |")
    if noisy:
        L.append(f"\n### {len(noisy)} ids the community reports as broken since firmware v4.30\n")
        L.append("Reported NOISE on the sheet's \"update audio V4_30\" tab. Pending our own ear check "
                  "(S1, `docs/FOLLOWUPS.md`); not shipped in any game config.\n")
        L.append(", ".join(f"`{i}`" for i in noisy))
    with open(path, "a", encoding="utf-8") as f:
        f.write("\n".join(L) + "\n")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalog", default=str(DEFAULT_CATALOG))
    ap.add_argument("--csv", default=str(DEFAULT_CSV))
    ap.add_argument("--md", default=str(DEFAULT_MD))
    ap.add_argument("--not-on-gun-count", type=int, default=347,
                     help="sheet ids not on our gun, for the markdown header (counted once, offline, "
                          "from the full sheet -- see the docstring)")
    a = ap.parse_args()

    catalog_path = pathlib.Path(a.catalog)
    catalog = json.load(open(catalog_path, encoding="utf-8"))
    labels = load_labels(pathlib.Path(a.csv))
    merge(catalog, labels)
    write_catalog(catalog, catalog_path)

    cats = collections.Counter(e.get("community_status") for e in catalog["sounds"] if e.get("community_status"))
    print(f"community labels merged -> {catalog_path}")
    for c, n in sorted(cats.items(), key=lambda kv: -kv[1]):
        print(f"  {n:5d} {c}")
    print(f"  {catalog['community_noise_flagged_count']:5d} noise-flagged")

    if a.md:
        write_md(catalog, pathlib.Path(a.md), a.not_on_gun_count)
        print(f"markdown -> {a.md}")


if __name__ == "__main__":
    main()
