# Handoff — Open BRX

**State as of 2026-09-14 (the 2026-09-12 field night, the fix run it drove, app 0.2.1, the range control that
ruled out three theories, and one desk session on the Stick).** One screen. Open work: `FOLLOWUPS.md`; evidence: `experiment-log/`; old banners:
`git log -p -- docs/HANDOFF.md`.

## Where the tree is
`origin/main` = `3833898`. App release **0.2.1** published (`app-v0.2.1`, debug-signed, Android only).
Everything below shipped on 2026-09-13 after the 2026-09-12 field night.

## What shipped, by the failure it answers
- **Teams that could not shoot each other.** A mode switch dumped every invalid-team player onto one side, and a silent
  un-push meant a team drag never reached the guns. Re-teamed by index, a one-team roster cannot be pushed or armed,
  and an edit to a loaded game re-pushes automatically.
- **No proof the guns had the config.** Four proofs on the board (ack currency, weapon echo, health pool, heartbeat
  config id), a RE-PUSH CONFIG button that cures the three a push can cure, and a post-match diagnostic
  (`python -m brx_mcp.mc.diag <session.sqlite>`).
- **A tagger still in the game after the whistle.** Delivery is now proven from the heartbeat every phone already
  sends, with a retry ladder that never delays the end, and stragglers named on the recap as a delivery fact.
- **A phone stuck in utility mode.** A tap counter, a hold-to-exit, and a RELEASE button on ITEMS so the operator can
  free a phone without touching it.
- **Phones could not reach MC.** A boot banner and a console banner when the advertised address is unreachable, and
  `--advertise <ip>` to override what the QR and mDNS carry without changing the bind.
- **The deagle blocked arming.** A weapon that cannot kill in one magazine warns; only a weapon that cannot damage at
  all is an error.
- Plus: benching a player who walks away, a banner for connected phones not in the roster, ready-up after a re-push,
  a confirm before a mode tile reshapes teams, and test runs no longer writing into `~/.brx-mcp`.

## Desk work since (no hardware touched)
- **The M5StickS3 takes its kind from MC over Wi-Fi** (Tony, 2026-09-14): armed at muster, then carried out and
  placed. Specified as `spec/utility.md` §5g, filed as **H8**. The finding that sizes it: **the wire needs no
  amendment** — MC gates a station on the one string `node_type: "utility"` and never validates its value, so an
  ESP32 speaking the M-NET envelope is a utility node today and `station_config` reaches it unchanged. All the
  work is Stick-side (a four-kind WS client, `WIFI`/`MC` serial commands + mDNS, Wi-Fi dropped for the match).
  Arm it respawn or control — the other three kinds have no player side. Still blocked behind H7: **no Stick has
  ever been powered on**, and the coexistence/battery claims in §5g.4 are reasoning, not measurements.

## Deliberately silent or staged off, and why
- `DRIVE_IO_MODE` is **off**. MC does not drive the gun's indoor/outdoor mode. The compiled head is byte-identical to
  what the field ran, pinned by a test.
- The BLE link watchdog ships **off** (needs a bench number).
- The echo-mismatch START refusal is **forceable**, because what a v4.32 gun emits after a `$WEAP` write is unmeasured.
  The stale-ack refusal is force-proof.
- Armour above the compiled ceiling is an **amber advisory**, not a fault, because whether a grant clamps is unmeasured.

## Fair-play rule until S7.1 is fixed
Backgrounding the HUD for more than six seconds re-arms from the spawn magazine, as does a genuine BLE drop and relink.
Tell players not to background the app.

## The one thing to do next
**Do not try to fix outdoor range before running the control.** On 2026-09-13 Tony measured native, in a real game, at
~200 ft: hits, with both weapons, in both toggle states. A stuck indoor mode is NOT the cause. The toggle turned out to
be a beam-width control worth about double the aim tolerance outdoors, not a range control. Our range token already
matches native. So the only surviving suspect is the difference between our compiled frames and native's, and one
measurement decides it: **push MC's config to that same gun, same spot, same light, and fire at the far mark and at
30-40 ft.** If it lands, our config is exonerated. If it fails, diff our frames against a native capture.
