# Contributing to Open BRX

Thanks for looking at this. Open BRX turns stock **Battle Company BRX** laser taggers into a hosted
laser tag system: a laptop Mission Control plus a per-player phone app (or, later, a Companion ESP32)
driving each gun over Bluetooth LE, on stock firmware. Start with [`README.md`](README.md) and
[`docs/README.md`](docs/README.md) (the docs index) before you touch anything.

## The one hard safety rule

**Stock BRX firmware is never modified.** Every capability comes from talking to the tagger over its
documented Bluetooth serial protocol (`protocol/brx-protocol.md`), never from flashing or patching the
gun itself. Power-cycling a tagger always restores it to factory state; that's the safety net, and no
PR may weaken it.

Two things that follow from this:

- The MCP server refuses malformed frames and requires `confirm=true` for any command outside the
  known-safe list enforced in `mcp/brx_mcp/protocol.py`. If you're adding a new command, add it there
  deliberately, don't bypass the guard.
- The panic sequence (`$CLEAR,*` then `$SP,99,*`) stops and silences a gun immediately, but it leaves
  it with **no `$SIR` table**, so the gun cannot register a hit until it's re-armed or power-cycled.
  That's correct for an emergency stop and wrong for anything else. Never end a bench session on a bare
  `$CLEAR`; always re-arm or power-cycle before walking away.

If a change you're proposing could brick a tagger, weaken that guard, or leave a gun in a state where
it can't be hit, it needs to be justified explicitly in the PR, not just tested.

## Running things

The repo has several independently-testable pieces. Run the one you touched before opening a PR.

**Python server + Mission Control (`mcp/`)** — zero external test runner, works under plain system
Python:
```bash
cd mcp && python3 run_tests.py            # everything
cd mcp && python3 run_tests.py modes cs   # only files matching these substrings
```
No hardware needed; tests that require optional extras (websockets etc.) skip cleanly if they're
missing rather than failing the run.

**Phone app (`app/`)**, native Capacitor app for Android + iOS:
```bash
cd app && npm test
```
This runs `node --test` over `test/*.test.mjs`. Two of those files spin up their own server for an
integration test, so run them as separate files rather than as one `node --test test/` sweep if you
hit a resource clash. See `app/README.md` for build/signing/APK details; that file is the authority on
anything platform-specific.

**Mission Control web UI (`webapp/mc/`)**, Vite/React/TS:
```bash
cd webapp/mc && npm run build   # tsc -b && vite build
cd webapp/mc && npm test        # vitest run
cd webapp/mc && npm run dev     # local dev server; add ?mock for the in-browser demo, no server needed
```

**Public website generator (`site/`)**, builds `webapp/` from `docs/manual/`:
```bash
cd site && npm run build && npm test
```
`npm test` builds first, then runs the Playwright suite. That suite is the UI verification checklist
for the generated site and refuses to run against a stale build, so always let it build rather than
reusing an old `webapp/`. A push to `main` deploys the site automatically (Cloudflare builds `webapp/`
straight from the repo), so a stale committed `webapp/` publishes stale content. If you change
`docs/manual/`, rebuild and commit `webapp/` in the same commit.

## The evidence culture

The heart of this repo is that **a claim about the hardware needs provenance**, not just plausibility.
`docs/manual/` is the canonical home for confirmed BRX facts (the same source the public site is built
from); `docs/spec/contracts.md` is the spec of record for the software's data model and wire protocol.
Read [`docs/manual/README.md`](docs/manual/README.md) before adding or editing a manual page — in
short:

- Every fact block in the manual carries a provenance badge: ✅ verified on our bench, 📖 official
  Battle Company docs, 🔍 decoded from the Callsign APK, or 👥 community-reported, plus a `src:` line
  pointing at the evidence (an experiment-log entry, a capture, a reference note).
- Nothing unconfirmed, hedged, or contradicted between sources gets published. If it's a guess, it
  belongs in that file's "Research backlog (held, NOT published)" section, not the page itself.
- A fact lives in exactly one manual file. Other docs link to it; they don't restate it.
- If you're wrong and something needs retracting, fix it **at the source**: the `protocol/` row, the
  manual page, the spec, and the code/comment built on it, in the same change. A stale answer left in
  place recruits the next person who reads it; an open question only warns them.

`docs/manual/` also has a house style worth knowing before you write a page: no em dashes anywhere (the
site build fails if one lands on a rendered page), short sentences, write for a player not a spec
reviewer, except the developer-reference section where exact command/token/field names matter more
than prose style.

## Session-close discipline

If you're doing anything beyond a small, self-contained fix, the project tracks state in three living
files (see [`docs/README.md`](docs/README.md)):

1. **`docs/experiment-log/`** — an append-only, dated lab notebook, one file per month. Add an entry
   for what you did and observed; never edit past entries.
2. **`docs/FOLLOWUPS.md`** — every open item and nothing else. Strike or add rows as a diff, not prose.
   A closed item moves to `docs/archive/followups-closed.md` as one dated line with a link to the log
   entry. **Ids are permanent**: never renumbered, never reused, even after an item closes.
3. **`docs/HANDOFF.md`** — one screen: what's true today, what changed, the next few actions. It's
   overwritten each session, not stacked.

A new confirmed fact goes into `protocol/` or `docs/manual/` in the same commit that introduces it, or
gets a FOLLOWUPS row saying "promote X" if it isn't ready yet.

## Hardware contributions

Most claims about tagger behavior need a real gun to back them. If your change asserts something about
hardware behavior (a command's effect, a timing value, an LED pattern), it needs a bench observation
behind it, not just a reading of the protocol docs or the APK teardown. `docs/FOLLOWUPS.md` has a
"Needs Tony at the bench" section (§9) for exactly this: things that need someone with hands on a gun
and headset to settle. If you can't get bench time, open the question there instead of guessing at an
answer and writing it into the manual.

## What never gets committed

- **No raw third-party assets.** Anything extracted from Battle Company's own APK or app data is
  restated in our own words, never committed verbatim. See
  `protocol/callsign-extract/RAW_ASSETS_NOTE.md` for the one deliberate, temporary exception and its
  ground rules.
- **No device identifiers.** Headset sticker ids and Bluetooth MAC/UUID addresses never enter the repo.
  Use a placeholder like `Tactix-XXXX` or `GUN-A` in examples. `mcp/tests/test_docs_hygiene.py`
  mechanically checks tracked files for sticker-id patterns and will fail the build if one lands; keep
  MAC addresses and other device-specific identifiers out on the same principle even where nothing
  greps for them yet.
- **No em dashes in `docs/manual/`.** The site build enforces it.
- **No hand-edits to generated output.** `app/ios/`, `app/android/`, `app/www/app.js`, and `webapp/`
  are all built from source and git-ignored or committed-as-built; a regeneration wipes anything you
  hand-edited there. If something in a generated tree is wrong, fix the generator or the source it
  reads, not the output.

## Proposing a change

Open an issue or a pull request against `main`. Small, well-scoped changes are easier to review than
large ones, especially anything touching the protocol layer or the spec.

For a **hardware/protocol** bug report or finding, include what you'd want if you were debugging it
cold:
- The tagger's firmware/generation (e.g. Tactix2 v4.32) and whether a headset was paired and powered.
- The exact command(s) sent, or the app/mode that triggered the behavior.
- What the gun actually did (LEDs, sound, `$HP`/`$SIR` state) versus what you expected.
- Whether the result was one-off or repeatable, and under what conditions.

For a **software** PR, run the relevant test suite above first and say which one you ran (and its
result) in the PR description. If you added or changed a fact in `docs/manual/`, note the `src:`
evidence in the PR body even though it's already in the file.

## Credit

Protocol discovery for BRX originates with **[LaserTagMods](https://github.com/LaserTagMods)**
(the JEDGE/JBOX projects). This project is an independent implementation built on that discovery work,
not a fork of theirs, and anything public-facing (docs, the website, release notes) needs to credit
them. If your change draws on LaserTagMods material, JEDGE/JBOX, or another named community source, say
so in the PR and cite it the way `docs/reference/` already does.
