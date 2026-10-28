# Experiment log — index

The lab notebook: what was sent, what happened, what it means, one entry per session. **Append after every
session** to the current month's file, `experiment-log/<yyyy-mm>.md` (the last row below; a new month is a new
file and a new row here). Entry = date, machine, tagger state, experiment, wire evidence, human observation,
conclusion. Name guns by `Tactix-XXXX` (MAC suffix), never by the headset sticker.

**Do not read the log for orientation.** Entries were inserted above older ones and retractions sit beside what
they retract, so a skim returns superseded conclusions. Current state is `HANDOFF.md`; open work is
`FOLLOWUPS.md`; confirmed facts are `manual/` and `../protocol/`. **Use the log for the evidence behind one claim:
grep the date or the phrase** (`grep -rn "fn 36" docs/experiment-log/`). Superseded A–G followup lists that used
to live in this file are in `archive/followups-closed.md`.

**This index is per month, not per entry**, because a per-entry row needs a manual edit here on top of the
append to the month file, and that second edit is not one of the three session-close writes in `CLAUDE.md` — it
kept being skipped (this table once ran five sessions and ~18 entries behind the month file it was meant to
summarise). A month's own headline-per-session list already exists for free: `grep -nE "^#{2,3} 20" experiment-log/2026-10.md`
(August and September use `##`, October `###`). October's entries are not in date order: grep the date.

| month | file | span |
|---|---|---|
| 2026-08 | [2026-08](experiment-log/2026-08.md) | first contact through the docs cold-read audit |
| 2026-09 | [2026-09](experiment-log/2026-09.md) | King of the Hill, the LED night, the manual rebuild, the 2026-09-13 field night, the arsenal merge and on |
| 2026-10 | [2026-10](experiment-log/2026-10.md) | the 0.4.16 standard bench, the 0.4.22 re-bench, the 2026-10-17 field matches and the field push, the Stick IR bench, the CI and land-lane work |

Add a row here **only when a new month's file is created**; append every session's own entry to the current
month's file regardless.
