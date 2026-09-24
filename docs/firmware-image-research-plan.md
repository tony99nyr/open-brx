# Plan: research with the stock firmware images (R4)

Status: T1 and T2 screamers complete 2026-09-21; T2 untested-levers pass complete 2026-09-21; T3 complete
2026-09-22; T4 audio-pack comparison complete 2026-09-22. A companion decompile now recovers the
hosted function switch for IDs 0–52. Native hits use compiled rules; hosted hits use a RAM table.
Tony authorised broader read-only image research on 2026-09-23; flashing
still needs a separate decision. Follow-up id: **R4** in `FOLLOWUPS.md`.

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

- The images are ARM Cortex-M code. An 8-byte updater header comes before the vector table. Map the full file at
  `0x8000`; the vector table then starts at `0x8008`. The v4.32 main processor is a Kinetis/Teensy-class MCU;
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

The extractor accepts an image path and prints bounded command names. The reference table records version,
documentation, safety and bench state. F301–F306 track the remaining protocol gaps. A new command still goes
through the confirm path in `protocol.py`; a firmware string alone never makes a send safe.

### T2. Read the open bench claims in the code (desk, 1-2 sessions, strongest model)

**Screamers and untested-levers passes complete 2026-09-21.** The v4.32 code-read confirms the blocking audio wait, two 1,024-slot
UART rings (1,023 usable bytes), split-frame persistence with no parser timeout, and `$*`'s all-token cleanup.
The second pass found two direct contradictions (`$BHIT` is a one-byte event path, and `$SPAWN` does not read a
shield argument) and several boundaries where the gun image only forwards state to another controller. The evidence
and precise bench checks are in the 2026-09 experiment log and the two bench sheets. The hosted function
switch is now code-mapped for IDs 0–52. The RAM-table loading path, `$TMP` and F264 questions remain open.

The Ghidra read mapped the full v4.32 file at `0x8000`, leaving the vector table at `0x8008`. T1 found 111
command-shaped names in v4.32; name presence does not prove an inbound handler. The completed pass covered:

1. **Screamers (P0).** Why does `$DPLAY` on a loop sound hang the gun? How big is the serial receive buffer? What
   does the parser do with a split frame and with `$*`? This feeds `bench-screamers-2026-09-19.md` directly.
2. **The untested levers claims** in `bench-firmware-levers-2026-09-19.md`: rows 2, 3, 7, 8, 9, 12, 16 and 18
   (melee, `$BHIT`, `$SPAWN` shield, `$PRES`/`$INVU`, the fuse functions, splash, `$RADSK`, the protocol-15 station
   words).
3. **The `$SIR` function table.** List every function number that the hit handler knows. We have probed them one at
   a time on the bench so far.
4. **`$TMP` token semantics** for each token: absolute, additive or one-shot (F285). S55 depends on this.
5. **The F264 stall**: the state where the gun is dead but the HUD shows the player alive.

The dated experiment log holds the code readings and their bench checks. A contradiction remains unresolved
until a controlled bench run explains it.

### T3. Version diff (desk, 1 session, mid model)

**Complete 2026-09-22.** The T1 table now has a deterministic “needs firmware” vocabulary gate for all 128 names,
records the embedded identifiers and gives the older-tagger field rule. Core Open BRX vocabulary appears in every
sampled tagger; the five known-safe candidates `$AS`, `$IT`, `$KK`, `$SP` and `$UP`, including the `$SP,99,*`
panic tail, are v4.32-only vocabulary. Presence does not
prove a handler or make a command safe, so `$VERSION,*` then `$PING,*` is the first compatibility probe and the
existing safety tier still decides whether a send is automatic, confirmed or refused.

The completed comparison covers tagger 2.01U, 2.02c, 2.02e, 2.08b and 4.32, plus headset 1.27 and 1.34.
The T1 table holds its "needs firmware" column. A string match cannot prove an older handler works;
only an older-hardware bench or handler trace can promote support.

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

### T5. A recovery path (read-only research; flashing decision first)

A gun that stops responding (a screamer) needs a power cycle today. If a gun ever stops booting, we have no path back.
The stock image and a known DFU procedure would give us one. The firmware contains `$CDFU`, which is probably the
command that enters DFU mode. Do not send it. Research only: read what `$CDFU` does in the code, and what Battle
Company's own update tool expects. Tony decides whether we ever flash, and only a stock image, byte for byte.

**2026-09-23 desk result:** the first 32-bit header word equals the payload size in all five tagger images.
The second word has a fixed low half `0x3412` and a version-varying high half with no verified meaning.
The `$CDFU` spelling is present, but adjacent literal references do not establish an inbound handler or a
bootloader call. The documented USB programming disk uses SELECT plus power and a root `.BIN`; no updater
executable is available locally to inspect its validation. Keep `$CDFU` unsent. Research can continue from
official updater material if it becomes available; any flash remains a separate decision.

## 2026-09-23 desk findings, ranked

These are code readings from the stock v4.32 tagger and v1.34 headset, not bench proof. The headset analysis uses
flash base `0x4000`. The tagger analysis uses the original `0x8000` file mapping: its reset vector reaches a valid
initialisation path there. A trial import that removed the 8-byte updater header reached the middle of that path,
so its results were discarded. Some tagger command comparisons point into neighbouring strings. Do not assign a
handler from a literal address alone.

1. **S48, indoor IR control.** The v4.32 emitter routine at `0xc984` computes the gun carrier as
   `38000 - 125 × (100 - range)` Hz below range 100. It selects one of two fixed output settings from the gun's
   indoor-level flag. The v2.08b routine at `0xb160` has the same range slope and output settings. Startup at
   `0x16c10` initialises that flag from stored mode 0, 1 or 2. This supports the earlier finding that changing
   `$WEAP` t2 detunes the carrier; it does not scale emitted power. The current code read does not establish a safe
   per-game serial control for the output setting. **Bench:** keep `$WEAP` t2 at 100, scope carrier and IR duty in
   each physical mode, then repeat with the documented `$GSET` t2 and `$IRLVL` controls. Run aimed and bounced
   shots against a shaded receiver, discarding the first two pulls of each group (F198/F231/F232).
2. **F293, joint Bluetooth drops.** The ordinary v4.32 loop calls `0x20f5c`. That routine checks a 6,000 ms
   timer and drives a selected GPIO low, then high after more than 500 ms. The code does not prove that the pin
   resets both radio links, or identify the inbound frame that refreshes the timer. The radio module's own
   firmware is absent. The pin selector yields GPIO 3 or 31 for the mapped hardware IDs. **Bench:** record that
   GPIO, both link states and Android Bluetooth logs across
   several 5–12 s drops. A low pulse before each joint drop would identify a gun-driven reset. If there is no
   pulse, investigate the radio and Android path.
3. **Protocol-15 callouts.** In the v1.34 headset, the corrected `0x8e60` hit path emits a
   25-bit word after a fatal hit. One stored mode selects protocol 15, the incoming player/team IDs and magnitude
   2; another selects protocol 8. This is a candidate explanation for the captured native TDM post-kill word,
   not proof of its source. A dead headset skips local hit application, but this read does not settle whether
   the gun forwards a received word as `$HIR`. **Bench:** place an IR receiver beside the victim headset during
   native and hosted kills. Record the full word and both `$HIR` sensor IDs. Reserve protocol-15 magnitude 2
   until its native role is confirmed. Deduplicate one word across sensor 0 and sensor 4: a previous capture
   reported the same beacon twice, 14 ms apart.
4. **F308, trigger release order.** The current code read does not establish whether `$BUT,0,0` can arrive after
   the last `$ALCD`, or be lost during full auto. A previous two-gun run saw one press and one release per burst,
   without ordering data. **Bench:** capture raw, timestamped frames through short bursts and full auto. Check
   each release against the final `$ALCD` for that burst.
5. **Screamers and `$SIR`.** T2 already established the blocking `$DPLAY` wait, 1,023-byte usable receive rings,
   persistent split frames and `$*` cleanup. A five-field forwarding function at `0x9470` can use a second
   destination. Independent literal decoding found an empty appended string. The initial runtime string
   remains unidentified, so the adjacent `$SIR` literal does not identify this function.
   The recovered v4.32 switch maps hosted function IDs 0–52, including timed IDs 24–27 and inert IDs 39–49.
   The RAM-table loading path and headset/controller routing still need tracing. Keep the existing screamer bench
   steps and test selected `$SIR` effects with the receiving controller present.
6. **Headset version difference.** The protocol-15 magnitude-2 death word is already present in headset v1.27
   (`0x7c60`) and remains in v1.34 (`0x8e60`). V1.34 also reads stored identity slot `0x15c` and compares it with
   an incoming player ID; v1.27 uses fixed `0x3f` or `0x7f` selectors. The gameplay effect is unproved. **Bench:**
   vary the configured headset ID and send matching and different player IDs with equal team and magnitude.
7. **Undocumented commands and recovery.** A branch adjacent to `$CLEARDEVICE` appears to call `0x19760`, which
   changes stored bytes and resets firmware state. The command mapping is provisional, but its potential effect
   supports the existing deny rule. `$FREE` has no confirmed handler; a nearby branch belongs to `$SFLASH`.
   The `$CDFU` spelling alone does not prove a callable updater entry. Keep all three commands unsent. T5 records
   the firmware header facts and the separate official USB programming path.

No firmware, sound file, decompile or disassembly was added to the repo, and no command was sent to a gun.

**Native-mode follow-up (2026-09-23):** v4.32 `$AS` stores base mode and rules in separate RAM bytes. The
initialisation path groups modes 0–2, 3–4 and 5–6; modes 0–2 and 5–6 use different five-value default
writers. The values and addresses are in the native setup entry of
[`experiment-log/2026-09.md`](experiment-log/2026-09.md). Two values feed armour and health recovery.
At zero additional modifiers, the nonzero value adds 33 or 34 units per permitted one-second call.
The shared `200` drains about two shield units per allowed call, and `100` bounds the shield path.
The active-state gates remain partly open. Both menu and `$AS` action-1 starts enable same-team hits
for FFA and clear them for TDM and Survival. Remote TDM/Survival team choice can depend on prior scratch
state. Do not promote the menu descriptions to firmware-derived defaults.
The `$AS` lighting field can be replaced by stored setting 199 under an unresolved selector.
Capture `$QUERY` and IR after setting up native FFA, Death Match and Survival on a gun.

**Mode field refinement:** FFA selects one shared team value, 1, and enables a same-team hit flag. TDM
selects team 0 or 1. Survival selects team 0 or 3; its death branch later writes team 3. The remote
`$AS` path sets the same mode flag through `0x1c95c`; its other team choices can use prior scratch state. The selected
game time becomes an end timestamp; a zero time disables that timer. The timeout path does not compare
scores before choosing its result/audio code. See the experiment log for addresses and limits.

**Native hit follow-up:** the hosted IR handler at `0x24aec` reads a RAM `$SIR`-style table. Native hits take
compiled branches at `0x21dcc`, with protocol 15 at `0x26338`; no nine-field stock `$SIR` rows were found
on that path. Native death queues an eleven-field serial request containing protocol 15, magnitude 2,
and the killer ID and team. The full serial command prefix remains unresolved.
The killer gun has a matching receive-and-credit branch. Modes 5–6 have a one-time death branch that writes
team 3 and rebuilds the loadout. The native hit entry of the experiment log records guards and addresses.
That entry now has a bounded map of protocols 0–14. The gun formatter appends `M` and
eleven numeric fields after an unresolved runtime string. The headset has both serial and autonomous
fatal-hit transmit paths. Its serial parser can load those fields into the IR encoder, but the command
match is unresolved. One parser branch requests one send; another can request an immediate send plus
repeats. A victim-side capture should identify the route and count the frames.

## 2026-09-23 broader pass: additional code findings

The seven images have private function indexes and decompiles, but this is not a complete behaviour map. The
v2.01U and v4.32 gun images each contain one large function that needed separate decompilation. The other sampled
functions decompiled, but many branches still need interpretation and bench checks.
All five sampled tagger versions have the same two native five-value default sequences:
`100,3333,3333,200,15000` and `100,0,0,200,6000`. Their runtime gates may differ by version.
All five also contain a death-path call with the same eleven numeric arguments for protocol 15,
magnitude 2 and the killer identity. The serial prefix and per-version gates remain unverified.

| Gun version | Range step below 100 | Emitter routine |
|---|---:|---|
| 2.01U | 300 Hz per point | `0xb704` |
| 2.02c | 75 Hz per point | `0xb2ec` |
| 2.02e | 125 Hz per point | `0xb2ec` |
| 2.08b | 125 Hz per point | `0xb160` |
| 4.32 | 125 Hz per point | `0xc984` |

Each routine caps the carrier at 38 kHz when the range setting reaches 100. The same two output settings appear
in these routines. This is a code-level reason to calibrate an older gun separately: identical `$WEAP` vocabulary
does not mean identical range behaviour. No older gun was bench-tested.

The v4.32 gun decoder at `0x233c8` routes protocol-15 words in native mode to `0x26338`. A magnitude-2 word
must pass the active/running state, team and player-ID checks. It also passes a 161 ms repeat gate before the gun
updates a native string field and toggles GPIO 8/7. Hosted reception instead follows `0x24aec`. This joins the
headset death-word finding above, but the exact native game effect remains unproved. Keep protocol 15 reserved
for native signalling until its word meanings and dead-state forwarding are benched.

Native death increments telemetry byte `0x1fffae14`; setup clears it, while spoken-number and event paths
read it. No inspected read compares it to a winning score. The timeout/end routine also has two command
callers, but its body reads no score. The missing radio module could hold further match logic.

The v4.32 hit processor at `0x21dcc` applies distinct 55, 125, 160 and 250 ms suppression checks before hit
effects. The checks compare different combinations of source ID, team, protocol, magnitude and subtype. The
timer is the SysTick millisecond counter. These gates can make rapid repeated IR words disappear even when the
receiver sees every pulse.

The hosted handler `0x24aec` has four direct callers. The gun IR decoder passes source 4, while the `$HIT`
parser passes a dynamic source value. A second parser branch also passes a dynamic byte; the periodic
caller passes 0. Functions 30, 36 and 37 use that source value. The code supports source values below 4,
but the automatic headset-to-gun forwarding route remains unproved. The generic seven-field hit record
goes to `0x24aec` in hosted mode and compiled native handler `0x21dcc` in native mode.

Headset v1.34 separates 20-interval and 25-interval IR frames at `0x98cc`; both paths check parity. The
25-interval path can apply a hit after a health check. Protocols 9 and 10 start another IR output sequence.
The v1.34 encoder copies the incoming protocol, ID, team and magnitude into a 25-bit word, sets an extra bit,
and selects subtype 0 in the 6-bit ID layout. Its game meaning and on-air repeat count remain open.
The headset transmitter at `0x7920` blocks another emission within 51 clock
ticks, probably milliseconds. V1.34 adds a stored mode-5 death branch absent from v1.27: it sets the configured
LED colour immediately; another branch sets a delayed LED state. Its duration and visible effect need a bench check.

**Still unextracted:** several native protocol/subtype effect meanings, the game meaning of protocol-15 event
branches, the exact FFA/TDM/Survival score and win checks, and the serial versus autonomous headset trigger
on a native kill. The headset's protocol-9/10 game effect, mode-5 feedback block, F308 ordering and the
RAM-table loading and some helper semantics also remain open. The hosted function switch itself is mapped
for IDs 0–52. The radio module's own firmware is absent. The private indexes
make the available code paths explicit targets for further desk work.

## How the work gets into the repo

| goes in | stays out |
|---|---|
| this plan, and the sha256 of each image | the images, the audio pack |
| `mcp/tools/fw_commands.py` (reads a path from `argv`) | the Ghidra project, disassembly, decompiled code |
| `docs/reference/firmware-commands.md` (our table) | verbatim string dumps longer than a command name |
| experiment-log entries marked CODE-READ | any claim in `docs/manual/` before the bench confirms it |
| new FOLLOWUPS rows and bench steps | the name of the person who posted the files |

T1 added root `.gitignore` rules for `*.bin` and `*.LTP`. The tracked-file hash guard lives in
`mcp/tests/test_docs_hygiene.py`.

## Decisions for Tony

- Hosting: the default is no. Change it only if Battle Company says yes in writing.
- Flashing: the default is never. Read-only T5 research is authorised; any flash needs a separate decision.
- Priority: T1 and the screamers part of T2 first, because the screamers are P0. The rest waits behind the
  weekend game.
