# The BRX diagnostic game — end-to-end test suite

A **structured, repeatable** test of every BRX capability, producing a **pass/fail scorecard**. It
formalises the ad-hoc hardware sessions (experiment-log #33–40) into a catalog you re-run on any tagger
or setup as a **regression baseline**. Code: `mcp/brx_mcp/diag/`. Run it:

```
python -m brx_mcp diag-game <address>            # 1 gun + human checks
python -m brx_mcp diag-game <address> 2guns      # + a second tagger as shooter
python -m brx_mcp diag-game <address> 2guns ir   # + the ESP32 IR bridge (when built)
```

## How it works

- **Declarative cases** (`diag/cases.py`) — each says what it needs (`requires`), what it sends, and how
  it's verified. Categories: connectivity · config · buttons · audio · leds · health · hits · grenade · ir.
- **Verification is pure** (`diag/model.py`) — predicates over the parsed rx stream (`saw $PONG`,
  `armor fell below spawn`, `$HIR token2==15` = grenade, `mag decremented`, …). Unit-tested with no BLE
  (`tests/test_diag.py`).
- **Human-in-the-loop** where wire evidence can't judge — "did you hear the sound?", "are the LEDs blue?",
  "pull the trigger now" — answered y/N at the prompt (or via an injected asker when automation drives it).
- **Graceful skips** — a case whose gear isn't present (2nd gun, IR bridge) **SKIPs**, it doesn't FAIL. A
  run is **CLEAN** if nothing failed or errored.
- **Saved report** — JSON to `~/.brx-mcp/diag-reports/` + a printed scorecard.

## What it covers today (BLE only, works now)

- **connectivity:** ping/pong, firmware version, battery telemetry.
- **config/spawn:** config accepted (`$ALCD`/`$LCD` echoes), spawn → live health.
- **buttons:** trigger fires (mag decrements), button events stream.
- **audio:** play a sound by id (human-heard), volume audible at 75.
- **leds:** team 1 → blue, team 2 → yellow.
- **health (needs a 2nd gun):** take damage (armor absorbs), `$LIFE` heals.
- **hits (needs a 2nd gun):** `$HIR` shooter-team attribution.
- **grenade:** Hill/Respawn beacon surfaces as `$HIR` token2=15.

## What SKIPs until hardware (the ESP32 IR bridge)

The `ir` category — capture a 25-bit frame, emit IR → gun reacts, sweep every `$SIR` function/sound —
needs the ESP32 bridge (`hardware/ir-prototype-plan.md`). Those cases already exist in the catalog and
turn on with the `ir` capability flag once the board is wired + the bridge tools are added to `brx-mcp`.

## Why this matters

- **Repeatable** — instead of re-deriving "does health-write work?" each session, run the game and read
  the scorecard.
- **Regression baseline** — a firmware update or a new tagger? Re-run; diff the scorecard.
- **Onboarding** — a new tagger's full capability profile in one command.
- **Extensible** — new capability → add a `DiagCase` + a pure predicate + a test. The IR cases show the
  pattern for hardware-gated tests.
