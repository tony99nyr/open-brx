# Native firmware: fatal-hit IR capture

Status: planned 2026-09-23. This sheet tests one question: who emits protocol-15 magnitude 2 after a native kill,
and what does the recipient do? The running order is in [`bench-plan.md`](bench-plan.md). Code readings and the
earlier native TDM capture are in the [experiment log](experiment-log/2026-09.md). A code reading alone is not a
bench result.

## Sittings 4a and 4b: source and receiver

Use two v4.32 guns with paired headsets, the ESP32 receiver and a laptop for timestamped IR and gun
traffic. Keep the receiver beside the victim headset, about 1 m from the emitter path. Keep both guns out of the
receiver's direct line. Use the phones and Mission Control only for the hosted control. Record the gun and headset
versions before the first trial. Carrier and indoor/outdoor duty belong to the separate S48 sitting.

Follow [`gotchas.md`](gotchas.md) for the stale-process check and power cycle of each gun and headset. Use
[`capture-runbook.md`](capture-runbook.md) for receiver geometry, decode and raw-frame handling. Before any IR
trial, run the [`bench-plan.md`](bench-plan.md) loopback with the active emitter and receiver ports. Its Windows
example is `loopback.py COM8 COM7 6`. Set `$VOL,65` through the documented arming
path. Confirm the victim's team, player ID, health, armour and shield; confirm the `$HIR` sensor ID on a normal
hit. Wait at least 3 s after each tool call. Never end on a bare `$CLEAR`.

| Time | Action | Stop or record |
|---|---|---|
| 0–15 min | Preflight, versions, power cycles, loopback, fixed receiver geometry. | Stop if the receiver misses loopback or the gun/headset pairing changes. |
| 15–23 min | Arm A and B with known IDs and opposite teams. Capture one non-fatal hit and baseline IR. | Record both pools and the `$HIR` sensor ID. Do not interpret a missing kill word without this control. |
| 23–55 min | Alternate native and hosted fatal hits: N1, H1, N2, H2. Re-arm and restore the same starting pools within each mode. Start native TDM with the gun menu. Use the documented phone/MC flow for hosted TDM. | For each trial, capture the 5 s before and 10 s after death. Keep each run's receiver log, gun frames and video under one trial ID. |
| 55–60 min | Close the sitting. | Record missing controls or unfinished trials as open, not negative results. |

Sitting 4b has a 45-minute cap. Repeat the preflight and ordinary-hit control (20 min), then capture N3 and H3
with the same geometry and starting pools (20 min). Use the last 5 min for the three close writes. If a trial
fails its controls, repeat that trial instead and leave the third pair open. Three clean alternating pairs are
required for a result; two pairs remain provisional. Keep the same two guns and headsets across both sittings.

Do not send `$AS,1`. It enters a native-game path flagged in the screamer plan. Do not run a magnitude sweep:
the prior hosted 1–39 sweep found no audible callout, while the earlier native TDM capture already saw magnitude 2.
Do not inject protocol-15 magnitude 2 until its source and recipient behaviour are clear. The ordinary native
menu is the planned way to start native TDM.

Use this row for each trial. Keep the raw capture files outside the prose log and link or name them from the dated
experiment entry.

| Trial | Mode, start method | A/B IDs, teams, versions | Starting and final pools | Fatal `$HIR` sensor, shooter ID/team | Receiver words and timestamps | Gun/headset feedback | Control valid? |
|---|---|---|---|---|---|---|---|
| N1 | native TDM, menu | | | | | | |
| H1 | hosted TDM, phone/MC | | | | | | |
| N2 | native TDM, menu | | | | | | |
| H2 | hosted TDM, phone/MC | | | | | | |
| N3 | native TDM, menu | | | | | | |
| H3 | hosted TDM, phone/MC | | | | | | |

For each protocol-15 word, record the full decoded 25-bit word, protocol, subtype, ID, team, magnitude, and its
offset from the fatal `$HIR` and `$HP,0,0,0`. Record which headset or receiver saw it. The runbook's normal
RAW-off capture protects frame timing; use a separate RAW-on capture only if a word needs fragment stitching.
Do not infer the repeat count from a truncated RAW dump. Record any same-word repeats, including a pair about
14 ms apart, before treating them as separate events.

If the documented headset UI can select a matching versus different player ID, reserve a follow-up A/B trial
with only that ID changed. Do not improvise an undocumented command during this sitting. A missing word is
evidence only when the loopback, non-fatal hit and receiver geometry controls passed in that same sitting.

At each close, write the result to the monthly experiment log, update the relevant FOLLOWUPS row, and replace only
the levers and screamers lane in `HANDOFF.md`. Keep native FFA same-team hits, Survival conversion and recovery
timing as later controlled sessions; this capture does not prove their complete rules. Keep F293 Android/GPIO
logging, F308 raw frame ordering and S48 scope work as separate setups.
