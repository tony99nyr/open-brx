# Raw BLE captures (btsnoop)

The **unprocessed** iPhone Bluetooth HCI traces behind the decoded transcripts in the parent
directory. Committed because a raw trace answers questions we haven't thought of yet: the
`$SFLASH` kill-confirm decode (§7o, 2026-08-25) came out of a capture taken on **2026-08-23** and
sat unread for two days — we had the bytes, we just hadn't asked the right question.

**Provenance:** all captured on the MacBook with **PacketLogger** (`File ▸ New iOS Trace`, then
`File ▸ Export ▸ btsnoop`) against the official **iOS Callsign** app driving BRX taggers on
firmware `v4.32`/`devhost.03`. Format is **btsnoop datalink 1001** (unencapsulated HCI — Apple's
export; the ACL/event split lives in the record flags, not a leading type byte).

**Decode:**

```bash
python -m brx_mcp.btsnoop <file>                 # chronological $-frames, both directions
python -m brx_mcp.callsigndiff <file>            # + diff vs our own arm, per connection
python -m brx_mcp.gsetdiff <fileA> <fileB> ...   # token-by-token $GSET/$PSET/$WEAP comparison
```

**Privacy:** these contain BLE device addresses and the taggers' advertised name (`Tactix2`) and
firmware host string (`devhost.03`) — both already public in our docs. They were scanned against
`~/.brx-mcp/device-backups/` and contain **no headset PIN or serial**; those come from the USB
`QUERY`/`SETUP` console, never from BLE, and stay out of the repo by policy.

| File | What it is | Why it matters |
|---|---|---|
| `2026-08-25-two-gun-3-kills-sflash.btsnoop` | **The `$SFLASH` capture.** 2 taggers, 262 s, the captured gun is the **shooter** — 3 kills scored, never hit (`$ALCD` ammo 36→6, `$BUT` bursts, zero `$HIR`). 3× `$SFLASH` + 3× `$PLAY,,4,6,V3A`. | **Source of §7o.** Proves the green-sight kill-confirm and the announcer ride plain BLE, and that the app's arm is byte-identical to ours. The single most important capture we have. |
| `2026-08-23-two-tagger-combat.btsnoop` | Richest game trace: 421 s, **23 hits taken, 2 deaths, 4 kills scored**. Both sides of combat in one file. | Source of §7f (combat/death/respawn) and §7k (`$HIR` token 4 = shooter's team). Independently corroborates §7o — the same `$SFLASH → V3A → VB17` burst is at 295 s and 325 s. |
| `2026-08-23-solo-game-full-arm.btsnoop` | Clean 81 s solo game, no combat. The complete arm sequence with nothing else in the way. | The canonical reference for the config order our `GameConfig.setup_frames()` reproduces. Best file to diff a new capture against. |
| `2026-08-23-gset-respawn15.btsnoop` | Armed game, in-app respawn set to **15 s**. | One of the three that **settled §7n**: respawn is not in the protocol at all. |
| `2026-08-23-gset-respawn30.btsnoop` | Same, respawn **30 s** (game time also changed to 1 min on this run). | With the other two: `$GSET` and `$PSET` come out **byte-identical** across all three. |
| `2026-08-23-gset-respawn05.btsnoop` | Same, respawn **5 s**. | The confirming third point — the app keeps the clock and drives respawn itself. |
| `2026-08-23-no-headset-instant-disconnect.btsnoop` | The **failure mode**: app connects and drops immediately, 9 frames, never arms. | Evidence for §7m — no headset paired means no game, silently. Useful as a negative control when a session "won't work". |
| `2026-08-23-connect-attempts-no-headset.btsnoop` | 464 s of repeated connect attempts across two taggers; `$NAME` + `$VERSION` exchanged, never arms. | The long-form version of the same failure. Contains the `$VERSION` reply that identified `v4.32`/`devhost.03`. |

## Reading a capture correctly — one trap

**A kill you *score* is invisible in your own gun's stream.** The shooter's gun reports `$BUT`
(trigger) and `$ALCD` (ammo) and nothing else; `$HIR`/`$HP` only ever describe damage *taken*.
This is exactly why `$SFLASH` was logged for two days as "periodic, never near a hit" — the file
it was first seen in was the **victim's** gun. Correlate host→gun feedback against **`$BUT`
bursts**, not against `$HIR`.
