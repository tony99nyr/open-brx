# Plan: research with the stock firmware images (R4)

Status: T1 and T2 screamers complete 2026-09-21; T2 untested-levers pass complete 2026-09-21; T3 complete
2026-09-22; T4 audio-pack comparison complete 2026-09-22. The T2 full `$SIR` table is blocked at an unresolved
gun-to-controller forwarding boundary, and T5 is decision first. Follow-up id: **R4** in `FOLLOWUPS.md`.

## What we have

A member of the BRX Facebook group posted a Google Drive folder called `Firmware`. Tony downloaded it on
2026-09-19. The folder holds seven stock firmware images and one audio pack:

| file | date | what it is | sha256 (first 16) |
|---|---|---|---|
| `BCgunV4_32.bin` | 2024-06-25 | tagger, v4.32 (the version on our guns) | `cf92f690325d4bc3` |
| `BCgunV2_08b.bin` | 2020-01-07 | tagger, v2.08b | `9a68848a1f77aae7` |
| `BCgunV2_02e.bin` | 2019-02-16 | tagger, v2.02e | `d95962f121762a0c` |
| `BCgunV2_02c.bin` | 2019-02-16 | tagger, v2.02c | `8772ccdb5cebe86d` |
| `BCgunV2_01U.bin` | 2019-02-16 | tagger, v2.01U | `c5ba9df7b93f3e5c` |
| `Headset/LTPV2headV1_34.bin` | 2020-01-07 | headset, v1.34 | `3818d52a3c06593e` |
| `Headset/LTPV2headV1_27.bin` | 2019-02-16 | headset, v1.27 | `9cd08de7257ae97b` |
| `BRX audio update v5 to v6.zip` | 2023-12-15 | 213 ZIP entries: 211 `.LTP` files and 2 directories | `9d3ea47f33bfb0c9` |

The first quick pass (strings only, no disassembly) found:

- The images are ARM Cortex-M code. An 8-byte updater header comes before the vector table. T2 corrected the first
  import guess: the payload maps at `0x8008`, not `0x8000`. The v4.32 main processor is a Kinetis/Teensy-class MCU;
  the "NRF52 v1 retail" and "NRF52 v2 retail" strings describe the separate radio module, not the main processor.
- The first `strings` pass reported 103 distinct `$` command names, but that tool's four-character floor silently
  omitted short real names such as `$AS` and `$SP`. T1's byte-level bounded scan finds 111 command-shaped names
  in v4.32. Treat this as firmware vocabulary, not proof that every name is an inbound dispatcher entry.
- The image spells the earlier quick-pass `$CLEARDE` finding as `$CLEARDEVICE`; `$FREE` is also present. `$YIYH`
  does not survive the bounded scan and was a false positive from an unbounded surrounding string.
- The v1.34 headset image holds its own command set, which includes `$ZOM`, `$ZON`, `$ZOFF`, `$ZTOG`, `$BOOM`,
  `$SGREN`, `$HLOOP` and `$VERSION`. We have never mapped the headset's own command set.

The Drive documents from 2026-09-18 (the V4_30 and V4_31 notes) were descriptions of the firmware. These files are
the first actual code we hold. That changes what we can answer at the desk: a claim in the levers sheet can now be
read in the code before it goes to the bench.

## Rules for the images

1. **Do not commit, host or pass on any image or any sound file.** Battle Company owns them. We do not know that the
   poster had the right to share them, and "someone posted it" is not a licence. This also covers disassembly
   listings, decompiled code and long verbatim string dumps.
2. **Keep the images out of the repo.** The extracted copy is in `~/brx-firmware-private/` (WSL). Keep the Ghidra
   project there too. The repo records only the sha256 of each image, so a reader can check that they hold the same
   file.
3. **What goes into the repo is facts, in our own words.** A command name, an argument meaning, a table size, or a
   timing is a fact. The same rule applies as for the restricted Drive documents: a fact reaches `docs/manual/`
   only after our own bench confirms it. The code tells us what to test. The bench tells us what is true.
4. **Never flash a modified image.** This is the hard rule in `CLAUDE.md`. Do not flash a stock image either until
   Tony decides that we need a recovery path and the DFU (device firmware update) procedure is understood.
5. **Credit.** Credit LaserTagMods for protocol discovery as usual. Credit the source of the images as "a community
   member's post", with no name.
6. **Ask Battle Company.** The outreach thread with Battle Company is open (2026-09-18). Add one question to it: may
   we publish facts derived from the stock images, and may we host the images for recovery? Until they answer, the
   answer is no to hosting.

## Research tracks, in priority order

Each track names its output and the model size for the agent that does it.

### T1. The command inventory (desk, 1 hour, small model)

**Complete 2026-09-21.** The extractor is `mcp/tools/fw_commands.py`; the 128-name, seven-version table is
[`reference/firmware-commands.md`](reference/firmware-commands.md). Six protocol gaps are F301-F306. No command
was sent. The scan also corrected the quick-pass 103 count and its `$CLEARDE`/`$YIYH` false readings above.

Write `mcp/tools/fw_commands.py`. The script takes an image path in `argv`, never a repo path, and prints the
`$` command names it finds. Run it on all seven images. Then build one table in
`docs/reference/firmware-commands.md` with these columns:

- the command name
- the versions that contain it (2.01U to 4.32, and the headset versions)
- the documented state: in `brx-protocol.md` or not, on the known-safe list or not
- the bench state: proven, claimed, or never sent

Output: the table, plus a FOLLOWUPS row for each command that nobody has documented yet. `$CLEARDE`, `$FREE`,
`$YIYH` and the headset's `$Z*` group come first. Do not send any new command to a gun from this track. A new
command goes through the confirm path in `protocol.py`.

### T2. Read the open bench claims in the code (desk, 1-2 sessions, strongest model)

**Screamers and untested-levers passes complete 2026-09-21.** The v4.32 code-read confirms the blocking audio wait, two 1,024-slot
UART rings (1,023 usable bytes), split-frame persistence with no parser timeout, and `$*`'s all-token cleanup.
The second pass found two direct contradictions (`$BHIT` is a one-byte event path, and `$SPAWN` does not read a
shield argument) and several boundaries where the gun image only forwards state to another controller. The evidence
and precise bench checks are in the 2026-09 experiment log and the two bench sheets. The full `$SIR`, `$TMP` and
F264 questions below are still open.

Load `BCgunV4_32.bin` into Ghidra as ARM Cortex-M (Kinetis/Teensy-class memory map; skip the 8-byte updater header
and map the payload at `0x8008`). Find the serial command dispatcher first. T1 found 111 command-shaped names in
v4.32, but vocabulary presence is not proof that a name is an inbound dispatcher entry. Then answer these questions from the code, in this
order:

1. **Screamers (P0).** Why does `$DPLAY` on a loop sound hang the gun? How big is the serial receive buffer? What
   does the parser do with a split frame and with `$*`? This feeds `bench-screamers-2026-09-19.md` directly.
2. **The untested levers claims** in `bench-firmware-levers-2026-09-19.md`: rows 2, 3, 7, 8, 9, 12, 16 and 18
   (melee, `$BHIT`, `$SPAWN` shield, `$PRES`/`$INVU`, the fuse functions, splash, `$RADSK`, the protocol-15 station
   words).
3. **The `$SIR` function table.** List every function number that the hit handler knows. We have probed them one at
   a time on the bench so far.
4. **`$TMP` token semantics** for each token: absolute, additive or one-shot (F285). S55 depends on this.
5. **The F264 stall**: the state where the gun is dead but the HUD shows the player alive.

Output: an experiment-log entry per question, marked **CODE-READ, NOT BENCH-PROVEN**, plus a precise bench step for
each one. A code read that contradicts a bench result means one of the two is wrong: log it, and do not pick one.

### T3. Version diff (desk, 1 session, mid model)

**Complete 2026-09-22.** The T1 table now has a deterministic “needs firmware” vocabulary gate for all 128 names,
records the embedded identifiers and gives the older-tagger field rule. Core Open BRX vocabulary appears in every
sampled tagger; the five known-safe candidates `$AS`, `$IT`, `$KK`, `$SP` and `$UP`, including the `$SP,99,*`
panic tail, are v4.32-only vocabulary. Presence does not
prove a handler or make a command safe, so `$VERSION,*` then `$PING,*` is the first compatibility probe and the
existing safety tier still decides whether a send is automatic, confirmed or refused.

Compare the command sets and the version strings across 2.01U, 2.02c, 2.02e, 2.08b and 4.32, and across headset
1.27 and 1.34. The goal is narrow: tell a field operator which features have vocabulary only in v4.x, and which
commands are candidates on an older gun. Output: a "needs firmware" column in the T1 table. A string comparison
cannot prove older-firmware handler behavior; only an older-hardware bench or handler trace can promote support.

### T4. The audio pack (desk, 30 minutes, small model)

**Complete 2026-09-22.** `mcp/tools/fw_audio_compare.py` streams the caller-supplied ZIP without extraction,
checks its known archive hash and expected payload count, and emits normalized ids, aggregate counts, the public
archive SHA-256 and one aggregate bank-manifest fingerprint. It emits no paths, per-file hashes, metadata or bytes.
The original “213 files” description was two high: the archive has 213 entries, of which 211 are `.LTP` files
and two are directories. Against the 2,477-file off-gun bank, 193 payloads are byte-identical, 18 are changed and
none are new. Every id already exists in `sound_catalog.json`, so the pack fills no catalog id gap and the catalog
was not changed. The exact facts-only partition is
[`reference/firmware-audio-pack-v5-v6.json`](reference/firmware-audio-pack-v5-v6.json). Hash inequality does not
identify speech or justify changing a descriptor. No audio was copied.

Reproduce it without extracting the pack (the placeholders must stay off-repo):

```sh
python mcp/tools/fw_audio_compare.py <private-pack.zip> <off-repo-AUDIO-dir> \
  --expect-archive-sha256 9d3ea47f33bfb0c9707fa41d6ecf8719bd57bd5d29a62e0af4edb4df1b6391b1 \
  --expect-ltp-count 211
```

The report's aggregate bank-manifest fingerprint binds the result to the exact 2,477 bank payloads without
publishing their individual hashes or paths.

### T5. A recovery path (decision first, then research)

A gun that stops responding (a screamer) needs a power cycle today. If a gun ever stops booting, we have no path back.
The stock image and a known DFU procedure would give us one. The firmware contains `$CDFU`, which is probably the
command that enters DFU mode. Do not send it. Research only: read what `$CDFU` does in the code, and what Battle
Company's own update tool expects. Tony decides whether we ever flash, and only a stock image, byte for byte.

## How the work gets into the repo

| goes in | stays out |
|---|---|
| this plan, and the sha256 of each image | the images, the audio pack |
| `mcp/tools/fw_commands.py` (reads a path from `argv`) | the Ghidra project, disassembly, decompiled code |
| `docs/reference/firmware-commands.md` (our table) | verbatim string dumps longer than a command name |
| experiment-log entries marked CODE-READ | any claim in `docs/manual/` before the bench confirms it |
| new FOLLOWUPS rows and bench steps | the name of the person who posted the files |

Add one guard with T1: a line in `.gitignore` for `*.bin` and `*.LTP` at the repo root, and a check in
`mcp/tests/test_docs_hygiene.py` that no tracked file has one of the sha256 values in the table above. Break the
check once and watch it fail.

## Decisions for Tony

- Hosting: the default is no. Change it only if Battle Company says yes in writing.
- Flashing: the default is never. T5 asks for a decision before any research goes past reading the code.
- Priority: T1 and the screamers part of T2 first, because the screamers are P0. The rest waits behind the
  weekend game.
