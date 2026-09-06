# Decoded capture transcripts

> Section references of the form §7e, §7n, §7o point into `../session-findings-2026-08.md` (the archived
> session write-ups); the current reading of each fact is in `../brx-protocol.md`.

Decoded with `python -m brx_mcp.btsnoop <btsnoop-file>`. `>>` is host→tagger,
`<<` is tagger→host.

**These are the decoded transcripts only, not the raw btsnoop captures.** A raw
capture records *all* of the phone's Bluetooth traffic, not just the tagger, so it is
not appropriate for a repo that will be published. The transcripts contain BRX protocol
frames and nothing else.

| File | What it shows |
|---|---|
| `2026-08-23-ios-callsign-game-start.txt` | The full working game-start sequence (protocol §7e) — the capture that solved remote game start |
| `2026-08-23-ios-callsign-two-tagger-combat.txt` | Two-tagger combat: `$HIR`/`$HP` damage, death, host-driven respawn (§7f) |
| `2026-08-23-gset-respawn15.txt` | Respawn 15 s, 1-minute clock. **Also contains a complete game ENDING** — the evidence that the app never queries the gun for results (§7n) |
| `2026-08-23-gset-respawn30.txt` | Respawn 30 s. Secondary weapon differs unintentionally — see §7n method note |
| `2026-08-23-gset-respawn05.txt` | Respawn 5 s, the clean third data point |
| `2026-08-23-no-headset-disconnects.txt` | Callsign with **no headset paired**: ritual completes, zero frames back, hangs up ~1.2 s later (§7m) |

To re-verify the §7n negative result:

```bash
python -m brx_mcp.gsetdiff <capA> <capB> [capC]     # raw btsnoop files, not these
```

The `$GSET` frames in the three `gset-respawn*` transcripts are byte-identical.
