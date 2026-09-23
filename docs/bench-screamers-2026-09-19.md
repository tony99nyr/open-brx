# Bench: screamers, reproduce and prevent (P0, 2026-09-19)

A "screamer" is a BRX gun that locks up in play: a sound plays on and on, no BLE command gets through, and only a
power cycle recovers it. Jay (LaserTagMods) sees at least one a day in games of 20 or more players under Callsign, and
says 60 players is "a nightmare". Battle Company will not change the firmware, and we never modify it. So the goal is
to make our system never create the conditions that lock a gun, and to recover fast if one locks anyway.

**Tony, 2026-09-18: this is P0.**

Phase A also carries the transport steps of the levers sheet (`bench-firmware-levers-2026-09-19.md` §14 maps them; A4 runs as levers §25).

## What the v4.32 code says (2026-09-21)

Evidence level for every bullet here is **CODE-READ, NOT BENCH-PROVEN**. The private stock image stays outside the
repository; these are restated facts, not disassembly.

- **The reachable audio wait has no exit for a loop.** The sound command selects one of five audio channels,
  starts playback, then polls that channel's playing flag every 10 ms. It does not call either serial parser in the
  wait, has no timeout, and leaves only when the flag clears. A looping clip can therefore hold the main loop and
  its serial reader forever. A1/A2 partly agree, but A1 dropped and recovered on reconnect rather than producing a
  permanent screaming lock; A1c and A3 keep that contradiction visible.
- **Both radio-facing UART paths use 1,024-slot receive rings with 1,023 usable bytes.** Each producer advances a
  0..1023 index and refuses the arriving byte when the next index equals the consumer index. The application parser
  consumes one received byte per invocation, so a busy main loop can still let the ring fill.
- **Ordinary split frames reassemble.** Parser state is global across invocations and there is no inter-byte timeout.
  A comma advances the token index (wrapping token 60 to token 1); a new `$` clears token 0 and resets the index but
  deliberately leaves tokens 1..59 alone. A7b measures a deliberate 60 ms and 2 s split rather than relying on BLE's
  normal 20-byte packetization.
- **`$*` reaches the common cleanup path.** `$` opens a frame and clears token 0/index. `*` snapshots the 60-token
  working set, dispatches the unmatched empty command, and the common return path clears every working token.
  That makes `$*` a code-supported parser reset; A4 remains the bench proof before the node sends it automatically.

The earlier V4_30/V4_31 leads below remain useful context. The v4.32 reading supersedes their processor and parser
uncertainties, but it does not turn a code result into a field result.

## Earlier leads

These are leads from the V4_30/V4_31 firmware disassembly. None is bench-proven on v4.32; the first three have the
narrower v4.32 code confirmation described above:

- **Hang loops.** Six places wait for an audio channel to finish playing, with no timeout, and none of them reads the
  serial port while it waits. If the channel holds a looping sound, the wait never ends: the audio keeps playing and
  the gun stops reading commands. `$DPLAY` is one of these waits, and a phone can send it.
- **A slow reader.** The gun reads one serial byte per pass of its main loop, through a 1 KB buffer. A burst can
  overflow the buffer while the loop is busy.
- **A fragile parser.** A frame that loses its closing `*` leaves stale tokens behind, and they corrupt the next frame:
  `$` resets only token 0 and the token index, so even a resend of the same frame lands on the stale tokens. A token
  has no length limit.
- **Load grows with players.** Callsign's host relays game traffic to every gun, so each gun's traffic grows with the
  player count. That fits Jay's report that screamers get worse with more players, not only with time.

Our own traffic, measured 2026-09-18: 43 frames and 75 BLE packets to arm one gun, sent in about 1.2 s with no
confirmation. A later reading of `compile.py` (the current F209 flow, counted by hand, not run) gives about
**58 frames / 1,357 B / 104 packets**. That is larger than the gun's 1 KB receive buffer, so the A7/A8 block-pacing
results matter: they decide where the arm must pause. The biggest writer during a match is the S42 recoil (live accuracy) writer: a `$WEAP` plus an `$AMMO`
for each accuracy change, up to about 1,700 packets a minute on today's 250 ms throttle. Tony decided on 2026-09-18
to keep it, so it must fit the per-gun write budget (F274): Phase C soaks it.

## Rules for every session

- A screamer is recovered by a power cycle of the gun. Power-cycle the headset too if it stays lit. Before the
  power cycle, send `$PLAYX,0,*`, then `$HLED,,6,*`, then `$STOP,*`, and note whether any of them gets through.
- Use `$VOL,65`. Volume is not a factor here.
- **Definitions.** Record every event as one of these:
  - **LOCK-UP**: no `$PONG` for 10 s after a `$PING`, and the gun does not recover without a power cycle. Note
    whether it screams (a stuck sound) or is silent.
  - **LINK DROP**: the BLE link drops but the gun reconnects and answers.
  - **BAD FRAME**: the gun answers, but a frame we sent did not apply (read back with `$QUERY` or `$ALCD`).
- Probe liveness with `$PING,*` every 2 s throughout, and log every frame both ways with a timestamp. **A4/A7b
  exception:** from the first incomplete fragment until `$*` or the final fragment has completed, pause the probe
  and every other writer on that connection; record the intentional quiet interval and resume immediately after.
  A complete frame injected inside either window would change the parser state and invalidate the result.
- One variable per run. Every run that locks a gun is repeated three times before it counts.

## Phase A: make a screamer on demand (one gun, about 60 min)

Each step tries one suspected trigger. Arm the gun with the bench victim head (`bench-perks-2026-09-18.md`) first.

| step | trigger | how | expect if the lead is right |
|---|---|---|---|
| A1 | hang loop | `$DPLAY,A10,4,*` (the shield loop, a looping sound; token 3 is untraced). Send it with `confirm=true` AND `allow_hang=true` on the `send` tool, one frame, never in a batch | LOCK-UP with the loop still playing |
| A2 | control for A1 | `$DPLAY` with a short one-shot sound, sent as A1 is: `confirm=true` AND `allow_hang=true` on the `send` tool, one frame, never in a batch | the gun answers again after the sound ends |
| A1c | nonblocking loop control | send `$PLAY,A10,4,6,,,,,*`, keep `$PING,*` running for 10 s, then stop it with `$PLAYX,0,*`; repeat three times | the loop plays but every ping answers. This separates a healthy looping decoder from `$DPLAY`'s blocking wait |
| A3 | hang loop, other channel | repeat A1 with token 2 = 1, 2 and 3 | shows which channels hang |
| A4 | lost `*` (stale tokens) | **F269's raw-byte helper is built (command lines below):** use its post-write chunk log for the incomplete `$AMMO,0,17,50,1` bytes and for `$*`. Then send `$AMMO,0,23,50,1,*` and read `$ALCD`. Run with and without `$*` before the complete frame. Full sequence: levers §25 | without `$*`: BAD FRAME, the magazine is not 23; with `$*`: 23. (The old `$QUERY` form could not show this: `$QUERY` ignores its tokens) |
| A5 | long token | send a `$PLAY` frame with one 400-character token. Use `$PLAY` only: never a frame that writes stored settings (`$NAME`, `$PIN`, `$PAIR`) | LOCK-UP or BAD FRAME |
| A6 | many tokens | send a `$PLAY` frame with 70 tokens. The A5 rule applies: no `$NAME`, `$PIN` or `$PAIR` frame | the token index wraps; BAD FRAME |
| A7 | burst | **Zero-gap half: F269's raw-byte helper (command lines below).** Send 100 short frames as one zero-application-gap byte stream; then the same frames in blocks of 10 with a 300 ms pause between blocks. Nine of every 10 are `$PLAY,U37,3,10,,,,,*`; every 10th is `$QUERY,*`, so each run carries 10 queries | count the `$QUERY` replies at each pacing (10 expected; each missing reply is a lost frame); any LOCK-UP. Existing transports can run the paced control but not the zero-gap comparison |
| A7b | deliberate split frame | **F269's raw-byte helper (command lines below):** it must preserve each supplied GATT write, accept an explicit inter-write delay, and log actual writes. On a fresh arm set magazine 10, then write `$AMMO,0,2`, wait 60 ms, and write `3,50,1,*`; repeat with a 2 s gap, three times each, and read `$ALCD` | magazine 23 in all six runs. This tests parser persistence, not ordinary BLE chunking that the stack may coalesce |
| A7c | receive-ring boundary | **F269's raw-byte helper, zero-gap stream mode (command lines below):** it must split one supplied byte stream only at 20-byte ATT boundaries, with no application sleep, and log chunk times. Alternate three streams of 146 `$PING,*` frames (1,022 B) and 147 frames (1,029 B), count `$PONG`s, then repeat with phone pacing | the exact code size is already 1,024 slots/1,023 usable; this measures the practical boundary while the parser is draining and must not be presented as an allocation measurement. Existing `send`, `send_batch`, and stage `raw` inject delay and cannot run the zero-gap case |
| A8 | burst of long frames | **Zero-gap half: F269's raw-byte helper (command lines below).** Send 50 × the bench AR `$WEAP` (102 bytes with t6 empty, 6 packets) as one zero-application-gap byte stream; then 200 × `$WEAP` frames with the phone's pacing (8 ms per packet, 18 ms per frame). In both runs, alternate the magazine size (t16 and t39) between 32 and 30 on each frame. In the paced run, read `$ALCD` after each frame; after the zero-gap run, read it once | a paced frame counts as lost when the `$ALCD` magazine does not change to that frame's value; the zero-gap run must end on the last frame's value; count lost frames; any LOCK-UP. Existing transports can run the phone-paced control but not the zero-gap comparison |
| A8b | trimmed runt `$SIR` rows | one gun, armed alternately with two variants, 50 arms each: the compiled `$SIR` rows as shipped, and the same rows with their trailing empty tokens dropped so each row fits one 20-byte packet | count BAD FRAME per variant. After the last arm of each variant, the IR rig (`ir-emit`) fires one control shot per `$SIR` row; every row must register a hit |
| A9 | IR load | set the gun's `<0,0>` row to fn 28 (`$SIR,0,0,,28,0,0,1,,*`: registers, no pool change), then the IR rig fires enemy-team `<0,0>` words at the gun at 10 per second for 5 min, while `$PING` runs. The fn 28 row means 3,000 words cannot kill the gun | does IR load alone slow or hang the gun |
| A10 | IR plus BLE | A9 and A7 together | the player-count case: many hits and much traffic at once |
| A11 | headset drop | switch the headset off during A7 | the gun resets its radio link; does it lock |
| A12 | low battery | repeat A7 on a pack below 20 % | any difference |
| A13 | our peak writer | replay the live S42 recoil writer at today's throttle (a `$WEAP` plus an `$AMMO` every 250 ms) for up to 20 min | the time and frame count at any LOCK-UP: the per-gun traffic budget |

**Running the split and zero-gap steps (F269, built 2026-09-23).** Use `python -m brx_mcp raw-bytes <address> …`; the next sitting's order is [`bench-2026-09-24.md`](bench-2026-09-24.md).
Single-quote every frame: in double quotes the shell turns `$AMMO` into nothing, and the tool then refuses the payload.
The gun sends `$ALCD` only on a shot or a reload, so the A4, A7b and A8 lines hold the link open for 10 s: fire one round
inside that window and read the printed last `$ALCD` (the magazine reads one lower than the value set). A run that
ends on a complete frame then sends one `$PING,*` and reports a missing `$PONG` within 10 s.

| step | arguments |
|---|---|
| A4 (no reset) | `--segment '$AMMO,0,10,50,1,*' --segment '$AMMO,0,17,50,1' --segment '$AMMO,0,23,50,1,*' --allow-incomplete --read-ms 10000` |
| A4 (reset) | as above, with `--segment '$*'` before the last segment |
| A7 zero-gap | `--stream` of nine `$PLAY,U37,3,10,,,,,*` then one `$QUERY,*`, concatenated, `--repeat 10`; read `QUERY=` in the reply counts |
| A7 paced | the same, plus `--phone-pacing --block-frames 10 --block-pause-ms 300` |
| A7b | `--segment '$AMMO,0,10,50,1,*' --segment '$AMMO,0,2' --segment '3,50,1,*' --delays-ms 0,60 --read-ms 10000`, then `--delays-ms 0,2000` |
| A7c | `--stream '$PING,*' --repeat 146 --read-ms 5000`, then `--repeat 147`; read `PONG=` |
| A8 zero-gap | `--stream` of the stock AR `$WEAP,0` at magazine 32 then at magazine 30 (`armgen.py 1 5 ar`, then with `t16=30 t39=30`; 111 B each), concatenated, `--repeat 25 --read-ms 10000` (50 frames) |
| A8 paced | the same, plus `--phone-pacing`; add `--with-response` for the F270 comparison |

**→ 2026-09-18, A1/A2 run.** A1: no `$PONG` to two pings 8 s apart, no reply to a follow-up `$PLAYX,0`, and no
audio played at all; the gun spoke only "connected" and "phone disconnected" over the session, and the BLE link
dropped about 15 s in. A reconnect answered `$PING` at once, with no power cycle needed. A2
(`$DPLAY,U37,4,*`, one-shot): answered `$PING` immediately, no hang. Reading: A1 blocked the gun and A2 did not,
but A1 recovered on a reconnect rather than needing a power cycle, so call it a partial screamer. `$DPLAY` stays
on the never-send list either way.

**Reading.** A1 blocking and A2 not blocking support the blocking-audio-path hypothesis, but A1 was silent and
recovered after reconnect, so they do not prove the permanent screamer mechanism. A1c must pass as the responsive
looping-audio control, while A3 (or another `$DPLAY` condition) must reproduce the defined **LOCK-UP** three times
before this becomes a bench-proven prevention rule. If nothing in Phase A locks a gun, the lock-up needs time or
conditions we have not reproduced. Then Phase C and D carry the whole weight, and we ask Jay for the frames Callsign
was sending when his guns screamed.

## Phase B: turn each trigger into a rule (desk, after Phase A)

For every trigger that Phase A reproduces, write one rule and enforce it in code, with a test that fails without it:

| trigger reproduced | rule | where it is enforced |
|---|---|---|
| a hang-loop frame | the frame is on the node's never-send list | the node's one write path, `_write` in `app/src/engine.js`, drops any `NODE_DENIED_COMMANDS` frame; `protocol.py` refuses a `DENIED_COMMANDS` frame even with confirm, and passes `$DPLAY` (`HANG_PRONE_COMMANDS`) only with confirm plus `allow_hang` |
| lost `*` / parser corruption | every frame is complete and ends with `*`; nothing is sent mid-frame by a second writer | the link's single writer |
| stale tokens after a lost `*` (A4) | the link sends the 2-byte `$*` parser reset before each burst and before every resend | `brxlink.write` |
| burst overflow | the node paces writes: a gap between frames and a pause between blocks, at the values Phase A shows are safe | `brxlink.js` pacing constants |
| long frames lost | multi-packet frames are sent with write-with-response, or split into shorter frames where the firmware allows | the link, after an A/B run |
| any BAD FRAME | after arming, MC reads the config back and refuses START on a mismatch | MC config proof |

Record each rule in the transport-hardening design note with its evidence.

**Frames to never send.** The write-traffic review of the V4_30 disassembly adds these to the never-send list, beside
the `$DPLAY` hang-loop row above. `$SITE` is already in `DENIED_COMMANDS`; the others are not yet enforced in code,
and each needs a Phase A result or a code reading before it goes into the node's never-send list:
- `$PB*` and `$AS`: they start the gun's own game paths, which hold 4 of the 6 blocking audio waits.
- `$SITE` and `$INVU`: both can force team 2 on a later reset. Protect a spawn with `$TMP` t8 (levers §23), not `$INVU`.
- `$SPAWN,*`: the gun never goes live on v4.32. Send `$SPAWN,,*`.
- A `$TMP` frame whose `*` lands on a live token (t1-t11): the gun stores that token as 0. Send the full 12-comma
  vector (levers §21).
- A second `$TMP` t9 write: each t9 write tops up every slot's magazine again.
- Any frame with more than 59 tokens.

## Phase C: soak one gun with our real traffic (instrument, can run unattended)

**The tool is built:** `python -m brx_mcp soak <address> <pattern> <minutes>`. It replays a traffic pattern, runs the
`$PING` liveness probe, and logs every event in the definitions above. It is a CLI subcommand, not an ad-hoc script,
so every bench run uses the same code.

⚠️ **The soak does not pace like the phone.** The MCP instrument (`ble.py`) sleeps 20 ms after every 20-byte chunk and
adds no frame gap. For a 101-byte frame that is about 0.84 B/ms, against the phone's peak of about 1.5 B/ms, so the
soak under-stresses long frames by about 1.8 times. **Tool change needed:** add a `soak --phone-pacing` mode (in
`mcp/brx_mcp/soak/runner.py`) that copies the phone's `brxlink.js` pacing. A Phase C run counts as a pass only when it
ran with `--phone-pacing`.

Patterns:

- `match`: our real per-gun match traffic after the fixes: the arm sequence, then per-hit `$PLAY` cues, LED readouts,
  a revive every 3 minutes that re-sends the `$SIR` table, and the recoil writer. The recoil writer is the biggest
  load in a match, so `match` carries its three `$WEAP` + `$AMMO` writes per burst (degraded, heavy, then crisp
  600 ms after the trigger is released), one burst every 10 s.
- `match-x10`: the same pattern at ten times the rate. This is the margin test.
- `recoil-oscillate`: the recoil writer's worst case. The player fires three rounds, releases for 600 ms, and repeats:
  two `$WEAP` + `$AMMO` writes per 0.8 s cycle, about 150 a minute.
- `callsign`: a Callsign-like load, where the gun hears relayed traffic for every player (use the rate for 20 players).

Runs:
1. `match` for 2 hours. Pass: zero LOCK-UP, zero BAD FRAME.
2. `match-x10` for 2 hours. Pass: zero LOCK-UP. This shows margin, not just survival.
3. `recoil-oscillate` for 2 hours. **Run the levers sheet §21 first:** if `$TMP` token 4 drives accuracy, the recoil writer moves to that one short frame, and this run must soak the `$TMP` form instead of `$WEAP` plus `$AMMO`. Pass: zero LOCK-UP, zero BAD FRAME. This is the F274 gate: the recoil writer ships
   only inside the budget that this run proves.
4. `callsign` for 2 hours, as the comparison. If Callsign-like load locks the gun and our pattern does not, we have
   shown the cause and the cure on one gun.

## Phase D: multi-gun match soak (all guns, 3 hours)

Every gun we own, each with its phone, armed by MC, in a long team match with respawns. The IR rig fires at the guns
to stand in for other players. Run it after Phase B's rules are built.

- Pass: zero LOCK-UP across the whole run.
- **Be honest about the numbers.** Jay's rate is about one screamer per 20 guns over a day, roughly 160 gun-hours. Four
  guns for 3 hours is 12 gun-hours, so a clean run alone cannot prove we beat that rate. That is why Phase A and
  `match-x10` matter: a reproduced cause, a rule that removes it, and a 10x margin together make the case. Phase D
  proves the whole system works together.
- Repeat Phase D at every playtest by logging lock-ups as a standing metric, so field gun-hours add up over time.

## Phase E: the safety net (20 min)

Even with every rule in place, a gun may still lock up. The player must know at once.

1. Lock a gun with the Phase A trigger during a live match.
2. The phone must detect it: no `$PONG` and no gun frames for 10 s, while the link says connected.
3. The HUD must tell the player to power-cycle the gun, and MC must show the gun as locked, not as alive (F208).
4. After the power cycle, the phone must reconnect and re-arm the gun into the match without operator help.

Pass: detection within 15 s, and the player back in the match within 60 s of the power cycle.

## Close

1. One experiment-log entry per session, with every run, including nulls and controls.
2. FOLLOWUPS: one row per reproduced trigger, one for the `soak` tool, one for the safety net.
3. Send Jay the result: which trigger we reproduced and which rule prevents it. Credit LaserTagMods for the report that
   started this.
