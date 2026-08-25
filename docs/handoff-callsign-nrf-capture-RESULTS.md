# RESULTS — Callsign BLE capture: is native nRF feedback enabled over BLE?

**Answers:** `docs/handoff-callsign-nrf-capture.md` (WSL session, 2026-08-25).
**By:** the MacBook session, 2026-08-25. **Capture:** `protocol/captures/raw/2026-08-25-two-gun-3-kills-sflash.btsnoop`
(`cap8`) · decoded `protocol/captures/2026-08-25-callsign-2gun-kills-sflash.txt` · full write-up
**`protocol/brx-protocol.md` §7o**.

---

## Short version

**The premise held, the hypothesis was wrong, and the outcome is better than either branch you
planned for.**

You asked: does Callsign send a BLE frame that flips the guns into autonomous nRF peering? **No —
no such frame exists.** The app's arm is byte-identical to ours. But that was never how Callsign
produced the feedback. **The phone scores the game itself and sends the feedback over plain BLE**,
using two commands we already had in our captures and had misread:

- **`$SFLASH,*`** — the shooter's **green-sight kill-confirm flash**. One per kill.
- **`$PLAY,,4,6,<id>,,,,*`** — `$PLAY` has a **second sound slot at token 4**, the announcer channel.

So your Step-4 decision tree doesn't apply: it isn't "Route 1 live" (no enabler frame) and it isn't
"commit to Route 2" (BLE reaches the feedback layer fine). **A BLE-only Mission Control can deliver
the full native feel — including the visual.**

---

## Step 0 — the decisive pre-check

**The sight went GREEN**, three kills out of three, in the Callsign app game. Both taggers also
announced *"red team takes the lead"*. Premise confirmed; the capture contains the mechanism.

## Step 2/3 — what the app sends on a kill

The captured gun is the **shooter** — `$ALCD` ammo counting 36→6, `$BUT` trigger bursts, and
**zero `$HIR`/`$HP`** (it was never hit). Each kill, from the phone:

```
[215.031s] << $BUT,0,1,*              last shot of the burst
[215.423s] >> $SFLASH,*               <- green-sight kill confirm
[215.622s] >> $PLAY,,4,6,V3A,,,,*     <- "kill" on the announcer slot
[216.423s] >> $PLAY,,4,6,VB17,,,,*    <- score line, first kill only
```

Three kills → three `$SFLASH` + three `V3A`, each ~0.4 s after a burst ends. `V3A` is independently
documented as **"kill"** in our own `sound-bank.md`. `VB17` fired **only on the first kill** — the
moment the lead changed — and is the *"red team takes the lead"* line Tony heard. Game end is
`$PLAY,VSF,4,6,JAY,,,,*`, using **both** slots at once.

### Why the bench `$GLED` probes failed

Right observation, wrong command. `$GLED` is team-derived (§7i) and never drives this flash.
`$SFLASH` does. The conclusion *"the green-sight visual is nRF-internal and not BLE-drivable"*
should be struck.

### Why `$SFLASH` was misread for two days

`brx-protocol.md` had it as *"sent periodically, never near a hit or death, purpose unknown"*, and
FOLLOWUPS carried it as **P7**. That reading came from a **victim-side** capture. **A kill you
score is invisible in your own gun's stream** — the shooter's gun reports only `$BUT` and `$ALCD`;
`$HIR`/`$HP` describe damage *taken*. Correlate host→gun feedback against **`$BUT` bursts**, never
against `$HIR`.

This also explains **D4** ("no shooter-side kill event on BLE") without contradicting it: D4 is
correct, and it's why the *host* must be the one to decide a kill happened.

### Diff vs our arm

**Byte-identical.** `$CLEAR → $START → $GSET → $PSET → $WEAP×3 → $SIR×10 → $BMAP×7 → $PLAYX →
$PLAY,VA81 → $SPAWN → $AMMO → $BMAP`, same `$GSET,1,0,1,0,1,0,50,1`. **No channel, session,
network-id, `$PB*` or `$NRF*` frame anywhere in the trace.** Only differences: `$VOL,69` (vs our
75) and a different secondary in `$WEAP,1` (`J15`, 1/3 ammo — a launcher picked in-app).

Corroboration: the identical `$SFLASH → V3A → VB17` burst appears in the **2026-08-23** two-tagger
capture at 295 s and 325 s. Two independent captures, two days apart.

---

## What to change on your side

1. **`GameConfig`/driver — emit the kill burst.** On a scored kill: `$SFLASH,*`, then
   `$PLAY,,4,6,<killLine>,,,,*` ~0.2 s later, then a score line on a lead change ~0.8 s later.
   Copy the app's spacing; it's ~0.4 s behind the kill and reads as instant.
2. **B18 is no longer a compromise.** "Audio compensates for the lost visual" is retired — the
   visual is ours too. B18 has been updated with the frames.
3. **P7 → resolved.** `$SFLASH` is documented in §7o and the command table.
4. **Route 2 (nRF24 tap) is no longer needed for feedback.** It remains the only route to
   **per-player attribution (P2)** — `$HIR` still names the shooter's *team*, not the shooter. That
   is now the sole stock-feel gap over pure BLE, and it's worth re-scoping the nRF work around it.
5. **MC is structurally better placed than Callsign here.** Callsign is one-phone-per-player, so
   each phone sees only its own gun. MC connects to **every** gun, so it sees the victim's
   `$HP,0,0,0` and `$HIR` directly and can drive the shooter's feedback centrally.

## Tooling added

- `mcp/brx_mcp/callsigndiff.py` — decodes a capture and diffs it against `GameConfig.setup_frames()`
  in one command: per-gun chronological writes, novel commands, token diff, and a cross-gun scan.
- **`btsnoop.py` now keys byte streams on the ACL connection handle.** It previously keyed on
  `(direction, ATT handle)` — identical on identical taggers — so a genuine two-gun capture would
  have merged both streams and reassembled into garbage, **silently**. Pinned by
  `mcp/tests/test_btsnoop_multigun.py` (portable, synthesizes btsnoop bytes; no capture files).
- All 8 raw traces are now committed under `protocol/captures/raw/` with an index.

## Still open from this capture

- ~~How did the *second* tagger announce?~~ **RESOLVED (Tony, same session):** the second tagger
  was connected to **its own phone** — Callsign's normal one-phone-per-player model. So each phone
  independently tracked the score and sent `VB17` to *its own* gun. **Nothing propagates between
  guns; there is no nRF score sharing to chase.** This confirms the MC design directly: driving
  every gun individually is correct, not a workaround — and MC does it from one host instead of
  needing a phone per player.
- `VB17`'s exact wording, and the rest of the `VB*` announcer family → the voice-pack mapping (P3).
